/* OS · Blocking vs Async I/O
   An API endpoint: 5 ms CPU (parse, validate) → 100 ms database call → 5 ms CPU (map, serialize). A fixed set of
   threads serves a FIFO queue of work items. Simulated in 1 ms ticks, shown at 1/4 speed.
     blocking  the thread that started the request waits through the 100 ms call: it can't take other work
     async     the thread starts the call and goes back to the queue; when the database answers, the rest of the
               request is queued as a continuation and any free thread runs it
   Throughput, latency and how much of each thread's time was spent waiting are measured from the run. */
(function () {
  "use strict";
  const { clamp, lerp, fmt, f1, expo } = Lab.util;
  const { box, tx, dot, hatch, alpha } = Lab.draw;

  const CPU1 = 5, IO = 100, CPU2 = 5, SPEED = 250, VIEW = 600;      // ms; SPEED = simulated ms per real second

  function fresh(s) {
    const T = s.p.threads;
    s.st = {
      now: 0, next: 0, id: 0, queue: [], io: [], done: [], segs: [], waitMs: 0, busyMs: 0,
      threads: Array.from({ length: T }, () => ({ job: null, phase: null, until: 0 }))
    };
  }
  function seg(st, i, kind) {
    const a = st.segs;
    for (let k = a.length - 1; k >= Math.max(0, a.length - 2 * st.threads.length); k--) if (a[k].i === i) { if (a[k].kind === kind && a[k].e === st.now) { a[k].e = st.now + 1; return; } break; }
    a.push({ i, s: st.now, e: st.now + 1, kind });
  }

  function tick(s) {
    const st = s.st, async = s.p.mode === 'async';
    while (st.next <= st.now) { st.queue.push({ id: ++st.id, arr: st.next, part: 1 }); st.next += expo(s.p.rate / 1000, s.rng); }
    // database answers: in async mode the continuation goes back to the queue
    st.io = st.io.filter(op => { if (op.until <= st.now) { st.queue.push({ ...op.job, part: 2 }); return false; } return true; });
    st.threads.forEach((th, i) => {
      if (th.job && st.now >= th.until) {
        if (th.phase === 'cpu1') {
          if (async) { st.io.push({ job: th.job, until: st.now + IO }); th.job = null; }
          else { th.phase = 'wait'; th.until = st.now + IO; }
        } else if (th.phase === 'wait') { th.phase = 'cpu2'; th.until = st.now + CPU2; }
        else if (th.phase === 'cpu2') { st.done.push([st.now, st.now - th.job.arr]); th.job = null; }
      }
      if (!th.job && st.queue.length) {
        const j = st.queue.shift();
        th.job = j; th.phase = j.part === 1 ? 'cpu1' : 'cpu2'; th.until = st.now + (j.part === 1 ? CPU1 : CPU2);
      }
      const kind = !th.job ? 'idle' : th.phase === 'wait' ? 'wait' : 'cpu';
      if (kind === 'wait') st.waitMs++; if (kind === 'cpu') st.busyMs++;
      seg(st, i, kind);
    });
    st.now++;
    if (st.segs.length > 4000) st.segs.splice(0, st.segs.length - 4000);
    while (st.done.length && st.done[0][0] < st.now - 3000) st.done.shift();
  }

  Lab.registerSim('async-io', {
    height: 360, warm: 3,
    init(s) { fresh(s); },
    onParam(s, k) { if (k !== 'rate') fresh(s); },
    step(s, dt) { const target = s.st.now + dt * SPEED; while (s.st.now < target) tick(s); },

    m(s) {
      const st = s.st, lat = st.done.map(d => d[1]).sort((a, b) => a - b);
      return {
        thr: st.done.length / Math.min(3, st.now / 1000 || 1),
        avg: lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : 0,
        p95: lat.length ? lat[Math.floor(lat.length * 0.95)] : 0
      };
    },

    draw(s) {
      const C = s.C, st = s.st, W = s.w, H = s.h, n = s.narrow, async = s.p.mode === 'async';
      const x0 = n ? 34 : 48, x1 = W - 14, T = st.threads.length, now = st.now, t0 = now - VIEW;
      const X = ms => lerp(x0, x1, (ms - t0) / VIEW);
      tx(`request = 5 ms CPU → 100 ms database → 5 ms CPU   ·   last ${VIEW} ms (¼ speed)`, 14, 14, { m: 1, s: n ? 8.5 : 10.5, a: 'left', c: C.muted });
      const top = 34, rowH = Math.min(26, (H - 150) / T);
      for (let i = 0; i < T; i++) {
        const y = top + i * rowH;
        tx(`T${i + 1}`, 14, y + rowH / 2, { m: 1, s: 9, w: 700, a: 'left', c: C.violet });
        box(x0, y + 2, x1 - x0, rowH - 4, { r: 3, fill: C.bg, stroke: C.line });
      }
      for (const g of st.segs) {
        if (g.e < t0 || g.kind === 'idle') continue;
        const y = top + g.i * rowH + 3, h = rowH - 6, xa = Math.max(x0, X(g.s)), xb = X(g.e);
        if (g.kind === 'cpu') box(xa, y, Math.max(1, xb - xa), h, { r: 1, fill: C.accent, stroke: null });
        else { box(xa, y, Math.max(1, xb - xa), h, { r: 1, fill: C.bg, stroke: null }); alpha(0.9, () => hatch(xa, y, Math.max(1, xb - xa), h, C.bad)); }
      }
      // pending database calls that hold no thread (async), and the queue
      const by = top + T * rowH + 18;
      tx(async ? `in-flight database calls (no thread held): ${st.io.length}` : `threads blocked waiting for the database: ${st.threads.filter(t => t.phase === 'wait' && t.job).length} / ${T}`, 14, by, { m: 1, s: n ? 9 : 10.5, w: 700, a: 'left', c: async ? C.a2 : C.bad });
      if (async) for (let i = 0; i < Math.min(st.io.length, n ? 30 : 70); i++) dot(18 + i * 9, by + 16, 3.4, C.a2);
      const qy = by + 38;
      tx(`queue: ${fmt(st.queue.length)} waiting`, 14, qy, { m: 1, s: n ? 9 : 10.5, w: 700, a: 'left', c: st.queue.length > 20 ? C.bad : C.muted });
      for (let i = 0; i < Math.min(st.queue.length, n ? 30 : 70); i++) dot(18 + i * 9, qy + 16, 3.4, st.queue[i].part === 2 ? C.violet : C.accent);
      const m = this.m(s);
      tx(`latency avg ${fmt(m.avg)} ms · p95 ${fmt(m.p95)} ms`, x1, qy, { m: 1, s: n ? 9 : 11, w: 700, a: 'right', c: m.p95 > 400 ? C.bad : m.p95 > 150 ? C.accent : C.good });
    },

    stats(s) {
      const st = s.st, m = this.m(s), tot = st.now * st.threads.length;
      const cap = st.threads.length * 1000 / (s.p.mode === 'async' ? CPU1 + CPU2 : CPU1 + IO + CPU2);
      return [
        ['Throughput', f1(m.thr) + ' req/s'],
        ['أقصى طاقة نظريًا', fmt(cap) + ' req/s', cap < s.p.rate ? 'bad' : 'good'],
        ['Latency p95', fmt(m.p95) + ' ms', m.p95 > 400 ? 'bad' : m.p95 > 150 ? 'warn' : 'good'],
        ['وقت الـ threads: شغل / انتظار', `${f1(st.busyMs / tot * 100)}% / ${f1(st.waitMs / tot * 100)}%`, st.waitMs > st.busyMs ? 'bad' : ''],
        ['Requests في الطابور', fmt(st.queue.length), st.queue.length > 20 ? 'bad' : '']
      ];
    }
  });

  Lab.registerLesson({
    id: 'async-io', lab: 'os', title: 'Blocking vs Async I/O',
    html: Lab.tpl.lesson({
      sim: 'async-io', level: 2,
      terms: ['Blocking I/O', 'async / await', 'Continuation', 'I/O Completion'],
      lede: 'endpoint بيعمل 5 ms شغل CPU، وبعدين call لقاعدة البيانات 100 ms، وبعدين 5 ms CPU. كل صف thread. البرتقالي شغل فعلي، والأحمر المخطط thread واقف مستني الداتابيز ومش قادر يعمل حاجة تانية.',
      aria: 'محاكاة threads بتخدم requests بـ blocking I/O مقابل async I/O',
      controls: [
        { type: 'seg', p: 'mode', label: 'طريقة الكود', value: 'blocking', opts: [['blocking', 'Blocking (.Result / sync)'], ['async', 'async / await']] },
        { type: 'range', p: 'rate', label: 'Requests في الثانية', min: 10, max: 300, step: 10, value: 60 },
        { type: 'range', p: 'threads', label: 'عدد الـ threads', min: 2, max: 16, step: 1, value: 8 }
      ],
      idea: `
        <p>أغلب وقت أي API مش في الحسابات؛ في انتظار حاجة بره: قاعدة بيانات، HTTP، ديسك. في <b>Blocking I/O</b> الـ thread بيبعت الطلب ويقعد مستني الرد: thread كامل (بالـ stack بتاعه) محجوز وهو مبيعملش حاجة.</p>
        <p>في <b>async/await</b> الـ thread بيبعت الطلب ويرجع للـ pool يخدم requests تانية. الـ OS بيبلّغ لما الرد يوصل (<b>I/O Completion</b>)، والباقي من الـ method (<b>Continuation</b>) بيتحط في الطابور وأي thread فاضي يكمّله. مفيش thread «مستني» خالص.</p>`,
      real: `
        <p>زي المطعم: الجرسون اللي بياخد الطلب ويقف جنب المطبخ لحد ما الأكل يجهز (blocking) بيخدم ترابيزة واحدة في المرة. الجرسون اللي بيسلّم الطلب ويروح لترابيزة تانية ويرجع لما الأكل يجهز (async) بيخدم عشرات بنفس العدد.</p>
        <p>API تطبيق السواقين بيستقبل 60 request في الثانية وكل واحد فيه query 100 ms. بـ 8 threads blocking، الطاقة القصوى 72 request في الثانية. بـ async، نفس الـ 8 threads يقدروا يوصلوا لحوالي 800.</p>`,
      try: 'على Blocking ارفع الـ requests لـ 100: الطابور بيكبر بسرعة والـ latency بيوصل ثواني، والرسم كله أحمر (انتظار). بدّل لـ async/await بنفس الرقم: الـ threads أغلبها فاضية، والـ calls بتستنى من غير ما تحجز thread. وفي Blocking لو زودت الـ threads لـ 16 هتحل المشكلة شوية، بس كل thread ليه ذاكرة وcontext switches.',
      also: 'chat server عنده 100,000 اتصال WebSocket مفتوح أغلبهم ساكتين: thread لكل اتصال مستحيل، async لازم. ونفس الحكاية في بوابات الدفع اللي بتستنى رد البنك ثانية أو اتنين.',
      net: `
<pre><span class="c">// ❌ Blocking: الـ thread واقف 100 ms</span>
public IActionResult Get(long id)
{
    var v = db.Vehicles.Find(id);                        <span class="c">// sync I/O</span>
    var trip = http.GetFromJsonAsync&lt;Trip&gt;(url).Result;   <span class="c">// sync-over-async: أسوأ</span>
    return Ok(Map(v, trip));
}

<span class="c">// ✓ async: الـ thread بيرجع للـ pool وقت الانتظار</span>
public async Task&lt;IActionResult&gt; Get(long id, CancellationToken ct)
{
    var v = await db.Vehicles.FindAsync(new object[] { id }, ct);
    var trip = await http.GetFromJsonAsync&lt;Trip&gt;(url, ct);
    return Ok(Map(v, trip));
}</pre>`,
      netTitle: 'في .NET',
      deep: [
        '<b>async مش أسرع للـ request الواحد:</b> الـ latency لـ request لوحده تقريبًا هو هو (ممكن أبطأ بميكروثواني). الفرق في الـ throughput وتحت الحمل: نفس عدد الـ threads بيخدم requests أكتر بكتير، فالـ latency مبتنفجرش.',
        '<b>async على شغل CPU مش بيفيد:</b> <code>await Task.Run(Compute)</code> جوه ASP.NET Core بينقل الشغل من thread pool thread لـ thread pool thread تاني؛ مفيش مكسب. async بيفيد لما فيه انتظار I/O حقيقي.',
        '<b>sync-over-async خطر:</b> <code>.Result</code> و<code>.Wait()</code> بيحجزوا thread وفي نفس الوقت الـ continuation محتاجة thread تاني، وده بيأدي لـ thread pool starvation تحت الحمل. شوف <a href="#/os/threadpool">Thread Pool و Starvation</a>.',
        '<b>تحت الغطا:</b> على Windows الـ I/O completion بيوصل عن طريق IOCP، وعلى Linux epoll. الـ runtime عنده threads قليلة بتستقبل الإشعارات دي وتحط الـ continuations في الـ thread pool.',
        '<b>تبسيطات:</b> عدد الـ threads ثابت (الـ thread pool الحقيقي بيضيف threads ببطء لما يلاقيهم مشغولين)، وكل request نفس الأوقات بالظبط، وقاعدة البيانات نفسها مالهاش حد (في الحقيقة connection pool الداتابيز ممكن يبقى الـ bottleneck الجاي: شوف <a href="#/databases/connection-pool">Connection Pool</a>).'
      ]
    })
  });
})();
