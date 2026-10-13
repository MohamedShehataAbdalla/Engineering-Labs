/* OS · Producer/Consumer بـ Channels
   A GPS receiver (producer) reads messages off the network and writes them into a Channel<T>; N DB writers
   (consumers) read from it, each ~8 messages/s. Every ~12 s a 3 s burst doubles the incoming rate.
     Unbounded           WriteAsync never waits: the channel (and memory, and latency) grows without limit
     Bounded · Wait      at capacity, WriteAsync waits: the producer stops reading the socket → backpressure
                         (the devices' TCP buffers fill up and they slow down / buffer on their side)
     Bounded · DropOldest at capacity, the oldest item is discarded to make room: fresh data, lost history
   Queue length, wait time, drops and latency (consume time − arrival time) are measured from the run. */
(function () {
  "use strict";
  const { clamp, lerp, fmt, f1, expo, Meter } = Lab.util;
  const { box, tx, dot, ring, line, arrow, alpha, hatch } = Lab.draw;

  const MU = 8, BYTES = 512, BURST_EVERY = 12, BURST_LEN = 3;
  const burst = t => (t % BURST_EVERY) < BURST_LEN;

  function fresh(s) {
    s.st = { q: [], next: s.t + 0.05, held: null, consumers: [], lat: [], dropped: 0, blockedT: 0, total: 0, done: new Meter(4), peak: 0 };
  }

  Lab.registerSim('channels', {
    height: 340, warm: 14,
    init(s) { fresh(s); },
    onParam(s, k) { if (k === 'mode' || k === 'cap') fresh(s); },

    step(s, dt) {
      const st = s.st, t = s.t, mode = s.p.mode, cap = s.p.cap, n = s.p.consumers;
      while (st.consumers.length < n) st.consumers.push({ cur: null, end: 0 });
      st.consumers.length = n;
      const rate = s.p.rate * (burst(t) ? 2 : 1);
      // producer: a message is read from the socket only when the previous one has been written
      if (st.held) {
        if (st.q.length < cap) { st.q.push(st.held); st.held = null; }
        else st.blockedT += dt;
      }
      while (!st.held && st.next <= t) {
        const m = { arr: st.next }; st.next += expo(rate, s.rng); st.total++;
        if (mode === 'unbounded' || st.q.length < cap) st.q.push(m);
        else if (mode === 'drop') { st.q.shift(); st.q.push(m); st.dropped++; s.drop(st.chX || 0, st.chY || 0, 'bad'); }
        else st.held = m;                                  // WriteAsync is waiting: stop reading
      }
      if (st.held) st.next = Math.max(st.next, t);         // nothing is read off the socket while we wait
      for (const c of st.consumers) {
        if (c.cur && t >= c.end) { st.lat.push([t, t - c.cur.arr]); st.done.add(t); c.cur = null; }
        if (!c.cur && st.q.length) { c.cur = st.q.shift(); c.end = t + (1 / MU) * (0.7 + s.rng() * 0.6); }
      }
      st.peak = Math.max(st.peak, st.q.length);
      while (st.lat.length && st.lat[0][0] < t - 15) st.lat.shift();
    },

    m(s) { const l = s.st.lat.map(x => x[1]).sort((a, b) => a - b); return { p95: l.length ? l[Math.floor(l.length * 0.95)] : 0 }; },

    draw(s) {
      const C = s.C, st = s.st, t = s.t, W = s.w, H = s.h, n = s.narrow, mode = s.p.mode, cap = s.p.cap;
      const x0 = 14, x1 = W - 14, mid = H / 2 - 6;
      tx(burst(t) ? 'BURST: 2× messages' : `incoming: ${s.p.rate}/s · consumers: ${s.p.consumers} × ${MU}/s = ${s.p.consumers * MU}/s`, x0, 14, { m: 1, s: n ? 9 : 11.5, w: 700, a: 'left', c: burst(t) ? C.accent : C.muted });
      // producer
      const pw = n ? 64 : 104, waiting = !!st.held;
      box(x0, mid - 34, pw, 68, { r: 8, fill: C.surface, stroke: waiting ? C.bad : C.accent, lw: 2 });
      tx('GPS receiver', x0 + pw / 2, mid - 18, { m: 1, s: n ? 8.5 : 10, w: 700, c: C.accent });
      tx(waiting ? 'WriteAsync waiting' : 'reading socket', x0 + pw / 2, mid + 2, { m: 1, s: n ? 8 : 9.5, c: waiting ? C.bad : C.muted });
      tx('(producer)', x0 + pw / 2, mid + 20, { m: 1, s: 8.5, c: C.muted });
      // channel
      const cx = x0 + pw + 22, cw = x1 - cx - (n ? 74 : 124) - 22, ch = 44;
      st.chX = cx + 10; st.chY = mid;
      const label = mode === 'unbounded' ? 'Channel.CreateUnbounded' : `Channel.CreateBounded(${cap}, ${mode === 'wait' ? 'Wait' : 'DropOldest'})`;
      tx(label, cx, mid - ch / 2 - 10, { m: 1, s: n ? 8.5 : 10.5, w: 700, a: 'left', c: C.violet });
      box(cx, mid - ch / 2, cw, ch, { r: 8, fill: C.bg, stroke: C.violet, lw: 1.6 });
      const len = st.q.length, slots = mode === 'unbounded' ? Math.max(cap, len) : cap;
      const per = Math.max(1, Math.floor((cw - 8) / 7)), rows = Math.max(1, Math.floor((ch - 6) / 7)), maxShown = per * rows;
      const shown = Math.min(len, maxShown);
      for (let i = 0; i < shown; i++) {
        const age = t - st.q[i].arr, x = cx + cw - 7 - (i % per) * 7, y = mid - ch / 2 + 5 + Math.floor(i / per) * 7;
        dot(x, y, 2.6, age > 5 ? C.bad : age > 2 ? C.accent : C.a2);
      }
      if (mode !== 'unbounded') { box(cx, mid + ch / 2 + 6, cw, 5, { r: 2, fill: C.bg, stroke: null }); box(cx, mid + ch / 2 + 6, cw * Math.min(1, len / cap), 5, { r: 2, fill: len >= cap ? C.bad : C.violet, stroke: null }); }
      tx(`${fmt(len)}${mode === 'unbounded' ? '' : ' / ' + cap} items · ~${len * BYTES < 1048576 ? fmt(len * BYTES / 1024) + ' KB' : f1(len * BYTES / 1048576) + ' MB'}`, cx + cw, mid - ch / 2 - 10, { m: 1, s: n ? 8.5 : 10, a: 'right', c: len >= cap && mode !== 'unbounded' ? C.bad : C.muted });
      if (len > maxShown) tx(`+${fmt(len - maxShown)} more`, cx + cw / 2, mid + ch / 2 + 22, { m: 1, s: 10, w: 700, c: C.bad });
      // consumers
      const kx = x1 - (n ? 74 : 124), kw = x1 - kx, N = st.consumers.length, kh = Math.min(30, (H - 90) / N - 6);
      st.consumers.forEach((c, i) => {
        const y = mid - (N * (kh + 6)) / 2 + i * (kh + 6);
        box(kx, y, kw, kh, { r: 6, fill: C.surface, stroke: c.cur ? C.a2 : C.line });
        tx(n ? `W${i + 1}` : `DB writer ${i + 1}`, kx + 8, y + kh / 2, { m: 1, s: 9, w: 700, a: 'left', c: C.a2 });
        if (c.cur) ring(kx + kw - 14, y + kh / 2, 7, 1 - (c.end - t) * MU, C.a2, 2.4);
      });
      alpha(0.5, () => { arrow(x0 + pw + 2, mid, cx - 4, mid, C.line, 1.4); arrow(cx + cw + 4, mid, kx - 4, mid, C.line, 1.4); });
      const m = this.m(s);
      tx(`latency p95 ${f1(m.p95)} s · dropped ${fmt(st.dropped)} · producer waited ${f1(st.blockedT)} s`, x0, H - 14, { m: 1, s: n ? 8.5 : 11, w: 700, a: 'left', c: m.p95 > 5 || st.dropped ? C.bad : C.good });
    },

    stats(s) {
      const st = s.st, m = this.m(s);
      return [
        ['رسايل في الـ channel', fmt(st.q.length), st.q.length > 500 ? 'bad' : st.q.length > 100 ? 'warn' : 'good'],
        ['ذاكرة الـ channel (تقريبًا)', st.q.length * BYTES < 1048576 ? fmt(st.q.length * BYTES / 1024) + ' KB' : f1(st.q.length * BYTES / 1048576) + ' MB', st.q.length > 500 ? 'bad' : ''],
        ['Latency p95', f1(m.p95) + ' s', m.p95 > 5 ? 'bad' : m.p95 > 1.5 ? 'warn' : 'good'],
        ['رسايل اترمت (DropOldest)', fmt(st.dropped), st.dropped ? 'bad' : ''],
        ['الـ producer استنى', f1(st.blockedT) + ' s', st.blockedT ? 'warn' : ''],
        ['Throughput', f1(st.done.rate(s.t)) + ' /s']
      ];
    }
  });

  Lab.registerLesson({
    id: 'channels', lab: 'os', title: 'Producer/Consumer بـ Channels',
    html: Lab.tpl.lesson({
      sim: 'channels', level: 2,
      terms: ['Producer / Consumer', 'Channel<T>', 'Bounded', 'Backpressure', 'DropOldest'],
      lede: 'الـ receiver بيقرا رسايل GPS ويحطها في <code>Channel</code>، والـ DB writers بيسحبوا منه ويكتبوا. كل نقطة رسالة مستنية، ولونها بيحمر كل ما تقدم. كل 12 ثانية فيه burst بضعف الرسايل. شوف كل نوع channel بيتصرف إزاي لما الكتابة أبطأ من الاستقبال.',
      aria: 'محاكاة producer و consumers بينهم Channel محدود أو غير محدود',
      controls: [
        { type: 'seg', p: 'mode', label: 'نوع الـ Channel', value: 'unbounded', opts: [['unbounded', 'Unbounded'], ['wait', 'Bounded · Wait'], ['drop', 'Bounded · DropOldest']] },
        { type: 'range', p: 'rate', label: 'رسايل داخلة في الثانية', min: 5, max: 40, step: 1, value: 20 },
        { type: 'range', p: 'consumers', label: 'عدد الـ DB writers', min: 1, max: 4, step: 1, value: 2 },
        { type: 'range', p: 'cap', label: 'سعة الـ channel', min: 20, max: 300, step: 20, value: 100 }
      ],
      idea: `
        <p>الـ <b>Producer/Consumer</b>: حد بينتج شغل وحد تاني بينفّذه، وبينهم طابور. الفايدة إن الاتنين يشتغلوا بسرعتهم من غير ما يستنوا بعض لحظة بلحظة. <code>Channel&lt;T&gt;</code> في .NET طابور thread-safe و async: القراية والكتابة بـ <code>await</code> من غير ما تحجز threads.</p>
        <p>السؤال المهم: لما الـ consumer أبطأ؟ <b>Unbounded</b>: الطابور بيكبر للأبد (الذاكرة والـ latency). <b>Bounded + Wait</b>: الكتابة بتستنى، فالبطء بيرجع للـ producer: ده <b>Backpressure</b>. <b>Bounded + DropOldest</b>: بيرمي الأقدم عشان الجديد يدخل.</p>`,
      real: `
        <p>الـ DB بطيئة الصبح وقت النسخ الاحتياطي، والـ writers بيكتبوا 16 رسالة في الثانية بدل 20. مع Unbounded الطابور بيكبر لحد مئات الآلاف والـ process بيتقتل (OOM) ومعاه كل الرسايل اللي في الذاكرة. مع Bounded + Wait الـ receiver بيبطّأ القراية من الـ socket، والأجهزة بتخزّن عندها وتبعت بعدين: لا ذاكرة بتنفجر ولا داتا بتضيع. ولو كل اللي يهمك آخر مكان للعربية (مش المسار)، DropOldest كفاية.</p>`,
      try: 'سيبها على Unbounded مع writerين (16/s) و20 رسالة: الطابور والذاكرة بيكبروا من غير حد، والـ latency بيوصل عشرات الثواني. بدّل لـ Bounded · Wait: الطابور بيقف عند 100 والـ producer بيستنى (backpressure). وDropOldest: الطابور ثابت بس عداد «اترمت» بيزيد، والـ latency لسه حوالي 6 ثواني (100 رسالة ÷ 16 في الثانية)؛ لو عايزه أصغر صغّر السعة. بعدين خليهم 3 writers: بين الـ bursts الطابور بيفضى.',
      also: 'طابور الأوامر في بورصة، و log shipping (لما الـ log server يبطأ)، ورسايل الشات قبل ما تتكتب في الداتابيز. وعلى مستوى أكبر: RabbitMQ و Kafka هم نفس الفكرة بين processes. شوف <a href="#/system-design/mq">Message Queue و Backpressure</a>.',
      net: `
<pre><span class="c">// Bounded: الكتابة بتستنى لما يتملي = backpressure</span>
var ch = Channel.CreateBounded&lt;GpsMessage&gt;(new BoundedChannelOptions(10_000) {
    FullMode = BoundedChannelFullMode.Wait,      <span class="c">// أو DropOldest / DropNewest / DropWrite</span>
    SingleWriter = true });

<span class="c">// Producer</span>
await foreach (var msg in ReadSocketAsync(ct))
    await ch.Writer.WriteAsync(msg, ct);           <span class="c">// بيستنى لو مليان</span>

<span class="c">// Consumers: كذا واحد بيقروا من نفس الـ channel، وبيكتبوا batches</span>
var writers = Enumerable.Range(0, 2).Select(_ =&gt; Task.Run(async () =&gt; {
    await foreach (var msg in ch.Reader.ReadAllAsync(ct)) await SaveAsync(msg, ct);
}));</pre>`,
      netTitle: 'في .NET',
      deep: [
        '<b>Unbounded مش «أسرع»:</b> هو بس بيأجّل المشكلة. لو المعدل المتوسط للدخول أكبر من الخروج، أي طابور unbounded هيكبر لحد ما الذاكرة تخلص. الطابور بيحل الـ bursts بس، مش الفرق الدايم في السرعة.',
        '<b>الـ backpressure لازم يوصل لحد:</b> لو الـ producer بيقرا من TCP، الانتظار بيملا الـ TCP window فالجهاز بيبطّأ (ده backpressure حقيقي). لو بيستقبل HTTP requests، الانتظار معناه requests معلّقة؛ ساعتها الأحسن ترد 429/503 بسرعة (<code>TryWrite</code> وتشوف لو false).',
        '<b>Batching:</b> الـ DB writer الحقيقي مبيكتبش رسالة رسالة؛ بيقرا كل المتاح (<code>TryRead</code> في loop) لحد 500 مثلًا ويعمل <code>SqlBulkCopy</code> واحد. ده بيضاعف الـ throughput أضعاف، والـ channel بيخليه سهل.',
        '<b>الإغلاق:</b> <code>Writer.Complete()</code> بيقول للـ consumers إن مفيش جديد، و<code>ReadAllAsync</code> بيخلّص بعد ما يفضّي الباقي. في الـ shutdown لازم تعمل ده وتستنى الـ consumers، وإلا الرسايل اللي في الطابور بتضيع.',
        '<b>تبسيطات:</b> كل writer بيكتب رسالة رسالة بسرعة ثابتة تقريبًا (8 في الثانية)، وكل رسالة حوالي 512 byte في الذاكرة. الـ latency هنا من لحظة قراية الرسالة من الـ socket؛ في وضع Wait الوقت اللي الرسالة استنته عند الجهاز قبل ما تتقري مش محسوب.'
      ]
    })
  });
})();
