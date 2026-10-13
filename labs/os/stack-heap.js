/* OS · Stack vs Heap
   One thread handles GPS messages: HandleMessage calls Parse (which calls ToPoint), then Validate (which calls Distance). The model keeps a real
   call stack (frames pushed and popped with their locals) and a real heap (bump-pointer allocation, objects stay
   live while something references them, then become garbage).
     class   GpsPoint is a heap object (16 B header + 48 B fields = 64 B) and the frame holds an 8 B reference
     struct  GpsPoint lives inside the frame (48 B), copied by value into the cache
     span    struct + parsing straight from the receive buffer (ReadOnlySpan<byte>): no string per message
   The raw text is a string of 80 chars: 22 + 2·80 = 182 → 184 B on 64-bit .NET. Frame sizes are approximations.
   "Recursion" calls itself until the 1 MB stack is gone: StackOverflow ends the process. */
(function () {
  "use strict";
  const { clamp, lerp, fmt, f1 } = Lab.util;
  const { box, tx, dot, line, arrow, hatch, alpha } = Lab.draw;

  const STACK = 1024 * 1024, STEP = 0.32, HEAP_CAP = 64, OBJ = { str: 184, cls: 64 };

  /* the work for one message as a script of stack/heap operations */
  function script(mode) {
    const ops = [];
    ops.push({ push: 'HandleMessage', bytes: 64, locals: ['msg (ref)', 'p'] });
    if (mode !== 'span') ops.push({ push: 'Parse', bytes: 96, locals: ['raw (string ref)'], alloc: { k: 'str', label: 'string "353…,30.05,31.23,62"', bytes: OBJ.str, temp: true } });
    else ops.push({ push: 'Parse', bytes: 96, locals: ['ReadOnlySpan<byte>'] });
    if (mode === 'class') ops.push({ push: 'ToPoint', bytes: 80, locals: ['p (GpsPoint ref)'], alloc: { k: 'cls', label: 'GpsPoint object', bytes: OBJ.cls, keep: true } });
    else ops.push({ push: 'ToPoint', bytes: 80 + 48, locals: ['p (GpsPoint, 48 B inline)'] });
    ops.push({ pop: true }, { pop: true });                         // ToPoint returns p, Parse returns: the raw string is now garbage
    ops.push({ push: 'Validate', bytes: 48, locals: ['ok (bool)'] });
    ops.push({ push: 'Distance', bytes: 64, locals: ['dLat, dLng (double)'] });
    ops.push({ pop: true }, { pop: true });
    ops.push({ store: true }, { pop: true });
    return ops;
  }

  Lab.registerSim('stack-heap', {
    height: 380, warm: 0,

    init(s) {
      s.st = { frames: [], heap: [], i: 0, ops: script(s.p.mode), t0: s.t, msgs: 0, alloc: 0, perMsg: 0, cacheRef: null, gcs: 0,
        rec: null, crashed: 0, peak: 0, lastMsgAlloc: 0 };
    },
    onParam(s) { this.init(s); },

    act: {
      recurse(s) { const st = s.st; if (st.rec || st.crashed) return; st.rec = { depth: 0, base: st.frames.reduce((a, f) => a + f.bytes, 0) }; }
    },

    gc(st) {
      // compact: keep live objects only (what a gen0 GC does to short-lived garbage)
      st.heap = st.heap.filter(o => o.live); st.gcs++;
    },

    step(s, dt) {
      const st = s.st;
      if (st.crashed) { if (s.t > st.crashed) this.init(s); return; }
      if (st.rec) {
        st.rec.depth += Math.round(dt * 2600);        // frames per second (sped up)
        const used = st.rec.base + st.rec.depth * 128;
        st.peak = Math.max(st.peak, used);
        if (used >= STACK) { st.rec = null; st.crashed = s.t + 3.5; st.overflowDepth = Math.floor((STACK - 0) / 128); }
        return;
      }
      while (s.t - st.t0 >= (st.i + 1) * STEP) {
        const op = st.ops[st.i++];
        if (op.push) {
          const f = { name: op.push, bytes: op.bytes, locals: op.locals, obj: null };
          if (op.alloc) {
            if (st.heap.length >= HEAP_CAP) this.gc(st);
            const o = { ...op.alloc, live: true, id: st.alloc };
            st.heap.push(o); f.obj = o; st.alloc += o.bytes; st.lastMsgAlloc += o.bytes;
          }
          st.frames.push(f);
          st.peak = Math.max(st.peak, st.frames.reduce((a, x) => a + x.bytes, 0));
        }
        if (op.pop) {
          const f = st.frames.pop();
          // when a frame returns, only its temp objects lose their last reference
          if (f && f.obj && f.obj.temp) f.obj.live = false;
          if (f && f.obj && f.obj.keep) st.pending = f.obj;
        }
        if (op.store) {
          // cache[vehicleId] = p : a class keeps the new object alive and drops the previous one
          if (st.pending) { if (st.cacheRef) st.cacheRef.live = false; st.cacheRef = st.pending; st.pending = null; }
        }
        if (st.i >= st.ops.length) { st.msgs++; st.perMsg = st.lastMsgAlloc; st.lastMsgAlloc = 0; st.i = 0; st.t0 = s.t; break; }
      }
    },

    draw(s) {
      const C = s.C, st = s.st, W = s.w, H = s.h, n = s.narrow;
      const x0 = 14, x1 = W - 14, gap = 20, sw = n ? (W - 28) * 0.48 : Math.min(330, (W - 28) * 0.42), hx = x0 + sw + gap, hw = x1 - hx;
      const top = 40;

      /* ---- stack ---- */
      tx('Stack (this thread)', x0, 16, { m: 1, s: n ? 10 : 12, w: 700, a: 'left', c: C.violet });
      const used = st.rec ? st.rec.base + st.rec.depth * 128 : st.frames.reduce((a, f) => a + f.bytes, 0);
      box(x0, top - 10, sw, 8, { r: 4, fill: C.bg, stroke: C.line });
      box(x0, top - 10, Math.max(2, sw * Math.min(1, used / STACK)), 8, { r: 4, fill: used > STACK * 0.8 ? C.bad : C.violet, stroke: null });
      tx(`${fmt(used)} B of 1 MB`, x0 + sw, 16, { m: 1, s: n ? 8.5 : 10, a: 'right', c: C.muted });
      const fh = n ? 40 : 44;
      if (st.crashed) {
        box(x0, top + 8, sw, H - top - 20, { r: 8, fill: C.bg, stroke: C.bad, lw: 2 });
        tx('Stack overflow.', x0 + sw / 2, top + 50, { m: 1, s: 13, w: 700, c: C.bad });
        tx('the process was terminated', x0 + sw / 2, top + 72, { m: 1, s: 10, c: C.bad });
        tx(`after ~${fmt(st.overflowDepth)} calls`, x0 + sw / 2, top + 92, { m: 1, s: 10, c: C.muted });
        tx('(no catch can stop it)', x0 + sw / 2, top + 112, { m: 1, s: 10, c: C.muted });
      } else if (st.rec) {
        const show = 6;
        for (let i = 0; i < show; i++) {
          const y = top + 8 + i * (fh + 4);
          box(x0, y, sw, fh, { r: 6, fill: C.surface, stroke: C.accent });
          tx(`VisitPoint(depth ${fmt(Math.max(0, st.rec.depth - show + 1 + i))})`, x0 + 8, y + fh / 2, { m: 1, s: n ? 8.5 : 10, w: 600, a: 'left', c: C.accent });
        }
        tx(`… ${fmt(st.rec.depth)} frames, 128 B each`, x0 + sw / 2, top + 8 + show * (fh + 4) + 12, { m: 1, s: 10, w: 700, c: C.bad });
      } else {
        st.frames.forEach((f, i) => {
          const y = top + 8 + i * (fh + 4), last = i === st.frames.length - 1;
          box(x0, y, sw, fh, { r: 6, fill: C.surface, stroke: last ? C.accent : C.violet, lw: last ? 2 : 1 });
          tx(`${f.name}()`, x0 + 8, y + 13, { m: 1, s: n ? 9 : 10.5, w: 700, a: 'left', c: last ? C.accent : C.ink });
          tx(`${f.bytes} B`, x0 + sw - 8, y + 13, { m: 1, s: 9, a: 'right', c: C.muted });
          tx(f.locals.join(', '), x0 + 8, y + 31, { m: 1, s: n ? 8 : 9.5, a: 'left', c: C.muted });
          f._y = y + 31;
        });
        if (!st.frames.length) tx('(between messages)', x0 + sw / 2, top + 30, { m: 1, s: 10, c: C.muted });
      }

      /* ---- heap ---- */
      tx('Heap (shared by all threads)', hx, 16, { m: 1, s: n ? 10 : 12, w: 700, a: 'left', c: C.a2 });
      const cols = n ? 4 : 8, cw = hw / cols, rh = n ? 28 : 30;
      box(hx, top - 10, hw, H - top, { r: 8, fill: C.bg, stroke: C.line });
      st.heap.forEach((o, i) => {
        const x = hx + 4 + (i % cols) * cw, y = top - 4 + Math.floor(i / cols) * (rh + 4);
        if (y + rh > H - 8) return;
        box(x, y, cw - 8, rh, { r: 4, fill: o.live ? C.surface : C.bg, stroke: o.live ? (o.k === 'cls' ? C.accent : C.a2) : C.line });
        if (!o.live) hatch(x, y, cw - 8, rh, C.bad);
        tx(o.k === 'cls' ? 'GpsPoint' : 'string', x + (cw - 8) / 2, y + 10, { m: 1, s: 8.5, w: 700, c: o.live ? C.ink : C.muted });
        tx(`${o.bytes} B`, x + (cw - 8) / 2, y + 21, { m: 1, s: 8, c: C.muted });
        o._x = x + (cw - 8) / 2; o._y = y + rh / 2;
      });
      // references from stack frames to heap objects
      if (!st.rec && !st.crashed) st.frames.forEach(f => { if (f.obj && f.obj._x !== undefined) alpha(0.7, () => arrow(x0 + sw - 4, f._y, f.obj._x - (cw - 8) / 2 - 2, f.obj._y, f.obj.k === 'cls' ? C.accent : C.a2, 1.2)); });
      if (st.cacheRef && st.cacheRef._x !== undefined) tx('← cache', st.cacheRef._x, st.cacheRef._y + 22, { m: 1, s: 8.5, w: 700, c: C.accent });
      if (s.p.mode === 'span') tx('no heap allocation per message', hx + hw / 2, H - 24, { m: 1, s: 10.5, w: 700, c: C.good });
    },

    stats(s) {
      const st = s.st, garbage = st.heap.filter(o => !o.live).reduce((a, o) => a + o.bytes, 0);
      return [
        ['Heap لكل رسالة', `${st.perMsg || (s.p.mode === 'span' ? 0 : '…')} B`, st.perMsg > 200 ? 'bad' : st.perMsg ? 'warn' : 'good'],
        ['× 1,000 رسالة/ث', st.perMsg ? `${f1(st.perMsg * 1000 / 1024)} KB/s` : '0', st.perMsg > 200 ? 'bad' : ''],
        ['Garbage في الـ heap دلوقتي', `${fmt(garbage)} B`],
        ['GC اتعمل', String(st.gcs)],
        ['أقصى استخدام للـ stack', `${fmt(st.peak)} B`, st.peak > STACK * 0.8 ? 'bad' : 'good'],
        ['رسايل اتعالجت', fmt(st.msgs)]
      ];
    }
  });

  Lab.registerLesson({
    id: 'stack-heap', lab: 'os', title: 'Stack vs Heap',
    html: Lab.tpl.lesson({
      sim: 'stack-heap', level: 1,
      terms: ['Stack', 'Heap', 'Stack Frame', 'Value Type', 'Reference Type'],
      lede: 'thread واحد بيعالج رسالة GPS: كل function بتتنادى بتحط <b>frame</b> فوق الـ stack (شمال) وبتشيله لما ترجع. الـ objects بتتعمل في الـ <b>heap</b> (يمين)، والسهم هو الـ reference. لما مفيش حاجة بتشاور على object بيبقى garbage (المخطط الأحمر).',
      aria: 'محاكاة call stack و heap أثناء معالجة رسالة',
      acts: [['recurse', 'recursion من غير نهاية']],
      controls: [
        { type: 'seg', p: 'mode', label: 'GpsPoint متعرّف كـ', value: 'class', opts: [['class', 'class'], ['struct', 'struct'], ['span', 'struct + Span (من غير string)']] }
      ],
      idea: `
        <p>الـ <b>Stack</b>: لكل thread واحد، صغير (حوالي 1 MB على Windows) وسريع جدًا. كل نداء function بيحجز <b>frame</b> فيه المتغيرات المحلية وعنوان الرجوع، والـ frame بيتشال أوتوماتيك لما الـ function ترجع. مفيش garbage collection هنا.</p>
        <p>الـ <b>Heap</b>: مشترك بين كل الـ threads، وكبير. أي <code>class</code> (<b>Reference Type</b>) بيتعمل فيه، والـ stack بيشيل reference (عنوان، 8 bytes) بس. الـ <code>struct</code> (<b>Value Type</b>) بيتخزن مكانه: جوه الـ frame لو local، أو جوه الـ object لو field. الـ heap مش بيتنضف لوحده: الـ GC هو اللي بيشيل اللي محدش بيشاور عليه.</p>`,
      real: `
        <p>1,000 رسالة في الثانية، وكل رسالة بتعمل string للنص الخام (184 B) و object لـ GpsPoint (64 B). ده حوالي 240 KB في الثانية garbage، أغلبه بيموت بعد ميلي ثانية. الـ GC بيلمّه بسرعة، بس كل لمّة ليها تكلفة. لما الـ GpsPoint يبقى struct والـ parsing من الـ buffer على طول (Span)، الـ allocation لكل رسالة بيبقى صفر.</p>`,
      try: 'شوف «Heap لكل رسالة» في الـ 3 أوضاع: class بيعمل string + object، وstruct بيوفّر الـ object، وSpan مبيعملش أي حاجة في الـ heap. لاحظ في وضع class إن الـ GpsPoint الأخير بيفضل حي (الـ cache بيشاور عليه) واللي قبله بيبقى garbage. بعدين اضغط «recursion من غير نهاية».',
      also: 'الـ game loop اللي بيعمل objects في كل frame بيعمل GC pauses بتبان كـ «تهنيج»، فبيستخدموا structs و object pools. ونفس الفكرة في أنظمة التداول عالية السرعة: صفر allocation في المسار الساخن.',
      net: `
<pre><span class="c">// class: object في الـ heap + reference على الـ stack</span>
public sealed class GpsPointC { public long VehicleId; public DateTime Ts; public double Lat, Lng; public float Speed; }

<span class="c">// struct: القيمة نفسها جوه الـ frame، ومفيش garbage</span>
public readonly record struct GpsPoint(long Id, long VehicleId, DateTime Ts, double Lat, double Lng, float Speed);

<span class="c">// Parse من الـ buffer على طول: من غير string لكل رسالة</span>
static GpsPoint Parse(ReadOnlySpan&lt;byte&gt; line) {
    Span&lt;Range&gt; parts = stackalloc Range[6];          <span class="c">// على الـ stack</span>
    line.Split(parts, (byte)',');
    Utf8Parser.TryParse(line[parts[3]], out double lat, out _);
    ...
}</pre>`,
      netTitle: 'في .NET',
      deep: [
        '<b>struct مش دايمًا أحسن:</b> بيتنسخ كله في كل assignment وكل parameter. struct كبير (أكتر من 16-24 byte تقريبًا) بيتنسخ كتير ممكن يبقى أبطأ من class. استخدم <code>in</code> أو <code>ref readonly</code> للـ structs الكبيرة، وخليه <code>readonly</code>.',
        '<b>Boxing:</b> لما struct يتحط في <code>object</code> أو interface (مثلًا <code>List&lt;object&gt;</code> أو <code>IComparable</code> من غير generics) بيتعمل له نسخة في الـ heap. ده allocation مستخبي بيبوّظ كل فايدة الـ struct.',
        '<b>StackOverflow في .NET مبيتمسكش:</b> <code>StackOverflowException</code> بتقفل الـ process فورًا، ومفيش <code>catch</code> ولا <code>finally</code> بيشتغلوا. أي recursion عمقها بيعتمد على الداتا (شجرة، graph، JSON متداخل) لازم تتحول لـ loop بـ <code>Stack&lt;T&gt;</code> صريح.',
        '<b>الأحجام:</b> على 64-bit كل object ليه header 16 byte (sync block + method table) وأقل object 24 byte. string طوله L حرف = 22 + 2L byte تقريبًا (UTF-16)، متقرّب لمضاعف 8. عشان كده ملايين strings صغيرة بتاكل ذاكرة أكتر بكتير من النص نفسه.',
        '<b>تبسيطات:</b> أحجام الـ frames تقريبية (الحقيقي بيعتمد على الـ JIT والـ registers). الـ heap هنا بيعمل GC لما يوصل 64 object وبيشيل الـ garbage كله؛ الـ GC الحقيقي بالأجيال في <a href="#/os/gc">Garbage Collector</a>.'
      ]
    })
  });
})();
