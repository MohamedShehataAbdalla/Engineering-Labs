/* OS · Race Condition و Lock و Interlocked
   Threads each run `trips++` on one shared counter. `x++` is really three machine steps:
     LOAD  r ← counter      ADD  r ← r + 1      STORE  counter ← r
   A random scheduler picks which thread runs the next step (switching more or less often). Modes:
     none         the three steps can interleave → two threads LOAD the same value and one update is lost
     lock         ACQUIRE before LOAD, RELEASE after STORE; a thread that finds the lock taken waits
     Interlocked  one atomic read-modify-write step (LOCK XADD on x86): nothing can get in between
   Lost updates are detected exactly: a STORE that overwrites a value other than the one this thread loaded.
   "Run 100,000" executes the same model without animation. */
(function () {
  "use strict";
  const { clamp, fmt, f1 } = Lab.util;
  const { box, tx, dot, line, arrow, alpha } = Lab.draw;

  const K = 40, RATE = 7;
  const CODE = {
    none: ['LOAD  r ← trips', 'ADD   r ← r + 1', 'STORE trips ← r'],
    lock: ['ACQUIRE lock', 'LOAD  r ← trips', 'ADD   r ← r + 1', 'STORE trips ← r', 'RELEASE lock'],
    atomic: ['XADD  trips += 1  (atomic)']
  };

  function mk(s, n) {
    return { mem: 0, lock: -1, steps: 0, waits: 0, lost: 0, cur: 0, log: [],
      th: Array.from({ length: n }, (_, i) => ({ i, pc: 0, r: 0, loaded: 0, done: 0 })) };
  }
  /* one scheduler step; returns a log line */
  function stepModel(m, mode, n, rnd, switchP, limit = K) {
    const live = m.th.filter(t => t.done < limit);
    if (!live.length) return null;
    // keep running the same thread unless the scheduler preempts it
    let t = m.th[m.cur];
    if (t.done >= limit || rnd() < switchP) { t = live[Math.floor(rnd() * live.length)]; m.cur = t.i; }
    m.steps++;
    const code = CODE[mode], ins = code[t.pc];
    let msg = '', bad = false;
    if (ins.startsWith('ACQUIRE')) {
      if (m.lock === -1) { m.lock = t.i; msg = 'got the lock'; t.pc++; }
      else { m.waits++; msg = `waits: T${m.lock + 1} holds the lock`; }
    } else if (ins.startsWith('LOAD')) { t.r = m.mem; t.loaded = m.mem; msg = `r = ${t.r}`; t.pc++; }
    else if (ins.startsWith('ADD')) { t.r++; msg = `r = ${t.r}`; t.pc++; }
    else if (ins.startsWith('STORE')) {
      if (m.mem !== t.loaded) { m.lost += m.mem - t.loaded; bad = true; msg = `trips = ${t.r}  ✗ overwrote ${m.mem} (lost ${m.mem - t.loaded})`; }
      else msg = `trips = ${t.r}`;
      m.mem = t.r; t.pc++;
      if (mode === 'none') { t.pc = 0; t.done++; }
    } else if (ins.startsWith('RELEASE')) { m.lock = -1; msg = 'released'; t.pc = 0; t.done++; }
    else if (ins.startsWith('XADD')) { m.mem++; t.r = m.mem; msg = `trips = ${m.mem}`; t.done++; }
    return { t: t.i, ins, msg, bad };
  }

  Lab.registerSim('race', {
    height: 380, warm: 0,

    init(s) { s.st = { m: mk(s, s.p.n), carry: 0, big: null, fin: 0 }; },
    onParam(s) { this.init(s); },

    act: {
      bulk(s) {
        // 100,000 increments on the same model, no animation
        const n = s.p.n, per = Math.floor(100000 / n), m = mk(s, n);
        let guard = 0;
        while (stepModel(m, s.p.mode, n, s.rng, s.p.sw / 100, per) && guard++ < 5e6) { /* run */ }
        s.st.big = { expected: per * n, actual: m.mem, lost: m.lost, steps: m.steps, waits: m.waits, mode: s.p.mode };
      }
    },

    step(s, dt) {
      const st = s.st, m = st.m;
      st.carry += dt * RATE;
      while (st.carry >= 1) {
        st.carry--;
        const r = stepModel(m, s.p.mode, s.p.n, s.rng, s.p.sw / 100);
        if (!r) { if (!st.fin) st.fin = s.t; if (s.t - st.fin > 3) { const big = st.big; this.init(s); st.big = big; } break; }
        m.log.push(r); if (m.log.length > 9) m.log.shift();
      }
    },

    draw(s) {
      const C = s.C, st = s.st, m = st.m, W = s.w, H = s.h, n = s.narrow, mode = s.p.mode, code = CODE[mode];
      const x0 = 14, x1 = W - 14, N = m.th.length;
      // shared memory
      const mx = (x0 + x1) / 2, my = 18;
      box(mx - 90, my, 180, 44, { r: 8, fill: C.surface, stroke: m.log.length && m.log[m.log.length - 1].bad ? C.bad : C.a2, lw: 2 });
      tx('trips (shared)', mx, my + 12, { m: 1, s: 9.5, c: C.muted });
      tx(m.mem, mx, my + 30, { m: 1, s: 16, w: 700, c: C.a2 });
      tx(`expected so far: ${m.th.reduce((a, t) => a + t.done, 0)}`, mx + 100, my + 22, { m: 1, s: n ? 8.5 : 10, a: 'left', c: C.muted });
      if (mode === 'lock') tx(m.lock < 0 ? 'lock: free' : `lock: T${m.lock + 1}`, mx - 100, my + 22, { m: 1, s: n ? 8.5 : 10, w: 700, a: 'right', c: m.lock < 0 ? C.good : C.violet });
      // threads
      const tw = (x1 - x0 - (N - 1) * 10) / N, ty = 84, lh = 16;
      m.th.forEach((t, i) => {
        const x = x0 + i * (tw + 10), active = m.log.length && m.log[m.log.length - 1].t === i;
        box(x, ty, tw, code.length * lh + 46, { r: 8, fill: C.surface, stroke: active ? C.accent : C.violet, lw: active ? 2 : 1 });
        tx(`T${i + 1}`, x + 8, ty + 12, { m: 1, s: 10.5, w: 700, a: 'left', c: C.violet });
        tx(`r = ${t.r} · ${t.done}/${K}`, x + tw - 8, ty + 12, { m: 1, s: n ? 8 : 9.5, a: 'right', c: C.muted });
        code.forEach((c, k) => {
          const y = ty + 30 + k * lh, cur = t.pc === k && t.done < K;
          if (cur) box(x + 4, y - 7, tw - 8, lh - 2, { r: 3, fill: active ? C.accent : C.bg, stroke: null });
          tx(n && tw < 150 ? c.replace('  (atomic)', '') : c, x + 10, y, { m: 1, s: n ? 8 : 9.5, a: 'left', c: cur && active ? C.surface : C.ink });
        });
      });
      // interleaving log
      const ly = ty + code.length * lh + 66;
      tx('what actually ran, in order:', x0, ly - 10, { m: 1, s: n ? 9 : 10.5, w: 700, a: 'left', c: C.muted });
      m.log.forEach((r, k) => {
        const y = ly + 6 + k * 15;
        if (y > H - 30) return;
        tx(`T${r.t + 1}  ${r.ins.padEnd(18)}  ${r.msg}`, x0, y, { m: 1, s: n ? 8 : 10, w: r.bad ? 700 : 500, a: 'left', c: r.bad ? C.bad : k === m.log.length - 1 ? C.ink : C.muted });
      });
      if (st.big) {
        const b = st.big;
        tx(`100,000 run (${b.mode}): ${fmt(b.actual)} / ${fmt(b.expected)}  ·  lost ${fmt(b.lost)}`, x1, H - 12, { m: 1, s: n ? 8.5 : 10.5, w: 700, a: 'right', c: b.lost ? C.bad : C.good });
      }
    },

    stats(s) {
      const m = s.st.m, exp = m.th.reduce((a, t) => a + t.done, 0), b = s.st.big;
      return [
        ['المتوقع / الفعلي', `${exp} / ${m.mem}`, m.lost ? 'bad' : 'good'],
        ['Updates ضاعت', String(m.lost), m.lost ? 'bad' : 'good'],
        ['خطوات لكل زيادة', exp ? f1(m.steps / exp) : '—'],
        ['خطوات انتظار على الـ lock', String(m.waits), m.waits ? 'warn' : ''],
        ['تشغيلة 100,000: ضاع', b ? `${fmt(b.lost)} (${f1(b.lost / b.expected * 100)}%)` : 'اضغط الزرار', b && b.lost ? 'bad' : '']
      ];
    }
  });

  Lab.registerLesson({
    id: 'race', lab: 'os', title: 'Race Condition و Lock',
    html: Lab.tpl.lesson({
      sim: 'race', level: 2,
      terms: ['Race Condition', 'Atomicity', 'lock', 'Interlocked', 'Critical Section'],
      lede: 'threads بيعملوا <code>trips++</code> على نفس العداد. السطر ده في الحقيقة 3 خطوات (LOAD و ADD و STORE)، والـ scheduler ممكن يوقف thread بين أي خطوتين. تحت السجل اللي اتنفّذ فعلًا بالترتيب، والأحمر update ضاع.',
      aria: 'محاكاة race condition على عداد مشترك مع lock و Interlocked',
      acts: [['bulk', 'شغّل 100,000 مرة']],
      controls: [
        { type: 'seg', p: 'mode', label: 'الحماية', value: 'none', opts: [['none', 'ولا حاجة (trips++)'], ['lock', 'lock'], ['atomic', 'Interlocked.Increment']] },
        { type: 'range', p: 'n', label: 'عدد الـ threads', min: 2, max: 4, step: 1, value: 2 },
        { type: 'range', p: 'sw', label: 'الـ scheduler بيبدّل كل قد إيه', min: 5, max: 60, step: 5, value: 35, unit: '%' }
      ],
      idea: `
        <p><b>Race Condition</b>: النتيجة بتعتمد على مين سبق مين. <code>x++</code> مش عملية واحدة (<b>Atomic</b>): بتقرا القيمة، تزوّد، تكتب. لو thread تاني قرا نفس القيمة قبل ما الأول يكتب، الاتنين هيكتبوا نفس الرقم وزيادة واحدة هتضيع (lost update).</p>
        <p>الحل إن الجزء ده (<b>Critical Section</b>) ميتنفّذش غير من thread واحد في نفس الوقت: <code>lock</code> بيخلّي الباقي يستنى. أو لو العملية بسيطة (زيادة، تبديل)، <code>Interlocked</code> بيعملها بأمر واحد atomic من الـ CPU من غير lock خالص.</p>`,
      real: `
        <p>عدّاد الرحلات أو إجمالي الكيلومترات لكل سواق بيتحدث من threads كتير بتعالج رسايل GPS في نفس الوقت. من غير حماية، الأرقام في آخر الشهر بتطلع أقل من الحقيقة شوية، مش crash ولا exception، والفاتورة اللي مبنية عليها غلط. وأسوأ حاجة: على جهاز المطوّر بـ core واحد ممكن ميظهرش خالص.</p>`,
      try: 'سيبها على «ولا حاجة» وراقب السجل لحد ما يظهر سطر أحمر: الاتنين عملوا LOAD لنفس القيمة. بعدين اضغط «شغّل 100,000 مرة» وشوف كام ضاع. بدّل لـ lock وشغّل تاني: صفر، بس «خطوات لكل زيادة» زادت وفيه انتظار. وInterlocked: صفر، وبخطوة واحدة.',
      also: 'رصيد حساب في بنك بيتعدّل من عمليتين في نفس الوقت، وعدد المقاعد المتاحة في حجز تذاكر، وعدد اللاعبين في غرفة في لعبة. وفي قاعدة البيانات نفس المشكلة مع <code>UPDATE ... SET Balance = @readValue + 10</code>.',
      net: `
<pre><span class="c">// ❌ مش atomic: read-modify-write</span>
_trips++;

<span class="c">// ✓ lock: critical section لـ thread واحد في المرة</span>
private readonly object _gate = new();
lock (_gate) { _trips++; _km += distance; }      <span class="c">// أكتر من حقل لازم يتغيروا مع بعض</span>

<span class="c">// ✓ Interlocked: أمر CPU واحد atomic، من غير lock</span>
Interlocked.Increment(ref _trips);
Interlocked.Add(ref _meters, (long)distance);

<span class="c">// ✓ في الـ collections: عملية atomic على مستوى الـ key</span>
counts.AddOrUpdate(driverId, 1, (_, c) =&gt; c + 1);   <span class="c">// ConcurrentDictionary</span></pre>`,
      netTitle: 'في .NET',
      deep: [
        '<b>Interlocked مش مجاني:</b> على x86 بيبقى instruction بـ prefix <code>LOCK</code>، والـ cache line بتاعة المتغير لازم تبقى عند core واحد بس. مع cores كتير بتزوّد نفس العداد، الـ cache line بتتنطط بينهم (contention). الحل للعدادات الساخنة: عداد لكل thread أو core وتجمعهم وقت القراية.',
        '<b>lock مش بيحمي غير اللي جوّاه:</b> لو حتة تانية في الكود بتعدّل <code>_trips</code> من غير نفس الـ lock، الحماية بقت صفر. ولو الـ check والـ update في lockين منفصلين (check-then-act) فيه race بينهم.',
        '<b>ConcurrentDictionary مش بيحمي القيمة:</b> <code>dict[id].Km += d</code> على object جوه ConcurrentDictionary لسه race، لأن الـ dictionary بيحمي إضافة وشيل المفاتيح بس. والـ <code>valueFactory</code> في <code>GetOrAdd</code> ممكن يتنفّذ أكتر من مرة.',
        '<b>Memory model:</b> غير الـ lost updates، الـ CPU والـ compiler ممكن يعيدوا ترتيب القرايات والكتابات، فـ thread ممكن يشوف flag اتغيّر قبل الداتا اللي اتكتبت قبله. <code>lock</code> و<code>Interlocked</code> و<code>Volatile</code> بيحطوا memory barriers تمنع ده.',
        '<b>تبسيطات:</b> كل خطوة بتاخد نفس الوقت، والـ scheduler بيبدّل بين الـ threads عشوائي بالنسبة اللي اخترتها. على multicore حقيقي الـ threads بتشتغل فعلًا في نفس اللحظة، فالـ race أسهل كمان. والـ thread اللي مستني الـ lock هنا بيلف (spin)؛ <code>lock</code> في .NET بيلف شوية وبعدين بينام.'
      ]
    })
  });
})();
