/* OS · Thread Pool و Starvation
   A thread pool with one global FIFO queue. It starts with `min` threads and, while work is waiting and no thread is
   free, injects one more thread every ~500 ms (the slow starvation-avoidance path; numbers approximate).
   Each request: 2 ms CPU → 50 ms database call → 2 ms CPU.
     async            the thread is released during the call; the continuation is queued when the call completes
     sync-over-async  the handler calls .Result: its thread blocks until the inner async method finishes, and that
                      inner continuation is itself a work item in the same queue, behind new requests
   When every thread is blocked, nobody runs the inner continuations: the pool is starved until it injects threads.
   Simulated in 1 ms ticks at 1/4 speed; queue lengths, thread counts and latencies come from the run. */
(function () {
  "use strict";
  const { clamp, lerp, fmt, f1, expo } = Lab.util;
  const { box, tx, dot, hatch, line, alpha } = Lab.draw;

  const CPU = 2, IO = 50, INNER = 0.3, INJECT = 500, SPEED = 250, VIEW = 500, MAXT = 64;

  function fresh(s) {
    const min = s.p.min;
    s.st = {
      now: 0, next: 0, id: 0, queue: [], io: [], done: [], segs: [], injections: 0, lastInject: 0, hist: [],
      threads: Array.from({ length: min }, () => ({ item: null, phase: null, until: 0, req: null }))
    };
  }
  function seg(st, i, kind) {
    const a = st.segs;
    for (let k = a.length - 1; k >= Math.max(0, a.length - 2 * st.threads.length - 2); k--) if (a[k].i === i) { if (a[k].kind === kind && a[k].e === st.now) { a[k].e = st.now + 1; return; } break; }
    a.push({ i, s: st.now, e: st.now + 1, kind });
  }

  function tick(s) {
    const st = s.st, sync = s.p.mode === 'sync';
    while (st.next <= st.now) { st.queue.push({ type: 'req', req: { id: ++st.id, arr: st.next } }); st.next += expo(s.p.rate / 1000, s.rng); }
    st.io = st.io.filter(op => { if (op.until <= st.now) { st.queue.push({ type: sync ? 'inner' : 'cont', req: op.req }); return false; } return true; });

    st.threads.forEach((th, i) => {
      // finish the current step
      if (th.item && th.phase !== 'blocked' && st.now >= th.until) {
        const it = th.item;
        if (it.type === 'req' && th.phase === 'cpu1') {
          st.io.push({ req: it.req, until: st.now + IO });
          if (sync) { th.phase = 'blocked'; th.req = it.req; } else th.item = null;
        } else if (it.type === 'inner') { it.req.innerDone = true; th.item = null; }
        else if (it.type === 'cont' || th.phase === 'cpu2') { st.done.push([st.now, st.now - it.req.arr]); th.item = null; th.req = null; }
      }
      // a blocked thread wakes up only when the inner async method has completed
      if (th.phase === 'blocked' && th.req.innerDone) { th.phase = 'cpu2'; th.until = st.now + CPU; }
      if (!th.item && st.queue.length) {
        const it = st.queue.shift();
        th.item = it;
        th.phase = it.type === 'req' ? 'cpu1' : it.type === 'inner' ? 'inner' : 'cpu2';
        th.until = st.now + (it.type === 'inner' ? INNER : CPU);
      }
      seg(st, i, !th.item ? 'idle' : th.phase === 'blocked' ? 'blocked' : th.item.type === 'inner' ? 'inner' : 'cpu');
    });

    // starvation: work is waiting and every thread is taken → add a thread, at most one per INJECT ms
    if (st.queue.length && st.threads.every(t => t.item) && st.now - st.lastInject >= INJECT && st.threads.length < MAXT) {
      st.threads.push({ item: null, phase: null, until: 0, req: null }); st.injections++; st.lastInject = st.now;
    }
    if (st.now % 20 === 0) { st.hist.push([st.now, st.threads.length, st.queue.length]); if (st.hist.length > 600) st.hist.shift(); }
    st.now++;
    if (st.segs.length > 6000) st.segs.splice(0, st.segs.length - 6000);
    while (st.done.length && st.done[0][0] < st.now - 2000) st.done.shift();
  }

  Lab.registerSim('threadpool', {
    height: 400, warm: 2,
    init(s) { fresh(s); },
    onParam(s, k) { if (k !== 'rate') fresh(s); },
    step(s, dt) { const target = s.st.now + dt * SPEED; while (s.st.now < target) tick(s); },

    m(s) {
      const st = s.st, lat = st.done.map(d => d[1]).sort((a, b) => a - b);
      return { thr: st.done.length / Math.min(2, st.now / 1000 || 1), p95: lat.length ? lat[Math.floor(lat.length * 0.95)] : 0 };
    },

    draw(s) {
      const C = s.C, st = s.st, W = s.w, H = s.h, n = s.narrow, now = st.now, T = st.threads.length;
      const x0 = n ? 30 : 44, x1 = W - 14, t0 = now - VIEW, X = ms => lerp(x0, x1, (ms - t0) / VIEW);
      tx(`pool: ${T} threads  ·  queue: ${fmt(st.queue.length)}  ·  +1 thread / ~${INJECT} ms while starved`, 14, 14, { m: 1, s: n ? 9 : 11, w: 700, a: 'left', c: st.queue.length > 50 ? C.bad : C.ink });
      const top = 30, area = H - 150, rowH = Math.min(18, area / Math.max(T, 8));
      for (let i = 0; i < T; i++) { const y = top + i * rowH; if (rowH >= 10) tx(`T${i + 1}`, 14, y + rowH / 2, { m: 1, s: 8, a: 'left', c: i >= s.p.min ? C.accent : C.violet }); }
      for (const g of st.segs) {
        if (g.e < t0 || g.kind === 'idle') continue;
        const y = top + g.i * rowH + 1, h = Math.max(1, rowH - 2), xa = Math.max(x0, X(g.s)), xb = X(g.e), w = Math.max(1, xb - xa);
        if (g.kind === 'blocked') { box(xa, y, w, h, { r: 1, fill: C.bg, stroke: null }); hatch(xa, y, w, h, C.bad); }
        else box(xa, y, w, h, { r: 1, fill: g.kind === 'inner' ? C.violet : C.accent, stroke: null });
      }
      // queue contents
      const qy = top + Math.max(T, 8) * rowH + 18;
      const reqs = st.queue.filter(q => q.type === 'req').length, inner = st.queue.length - reqs;
      tx(`queue: ${fmt(reqs)} new requests · ${fmt(inner)} ${s.p.mode === 'sync' ? 'inner continuations (the blocked threads wait for these!)' : 'continuations'}`, 14, qy, { m: 1, s: n ? 8.5 : 10, w: 700, a: 'left', c: inner && s.p.mode === 'sync' ? C.bad : C.muted });
      const shown = st.queue.slice(0, n ? 40 : 90);
      shown.forEach((q, i) => dot(18 + i * 7.5, qy + 14, 2.8, q.type === 'req' ? C.accent : C.violet));
      // threads and queue over time
      const gy = H - 58, gh = 46, gw = x1 - 14;
      box(14, gy, gw, gh, { r: 6, fill: C.surface, stroke: C.line });
      const hs = st.hist, maxQ = Math.max(10, ...hs.map(h => h[2])), maxT = Math.max(16, ...hs.map(h => h[1]));
      const plot = (idx, max, col) => { const Xc = s.ctx; Xc.beginPath(); hs.forEach((h, i) => { const x = 18 + i / 599 * (gw - 8), y = gy + gh - 4 - h[idx] / max * (gh - 10); if (i) Xc.lineTo(x, y); else Xc.moveTo(x, y); }); Xc.strokeStyle = col; Xc.lineWidth = 1.6; Xc.stroke(); };
      plot(2, maxQ, C.bad); plot(1, maxT, C.violet);
      tx('threads', 22, gy + 10, { m: 1, s: 9, w: 700, a: 'left', c: C.violet });
      tx('queue', 74, gy + 10, { m: 1, s: 9, w: 700, a: 'left', c: C.bad });
    },

    stats(s) {
      const st = s.st, m = this.m(s), blocked = st.threads.filter(t => t.phase === 'blocked').length;
      return [
        ['Threads في الـ pool', String(st.threads.length), st.threads.length > s.p.min * 3 ? 'warn' : ''],
        ['Threads واقفة على .Result', `${blocked} / ${st.threads.length}`, blocked === st.threads.length && blocked ? 'bad' : blocked ? 'warn' : 'good'],
        ['Work items في الطابور', fmt(st.queue.length), st.queue.length > 50 ? 'bad' : st.queue.length > 5 ? 'warn' : 'good'],
        ['Throughput', f1(m.thr) + ' req/s'],
        ['Latency p95', m.p95 > 1000 ? f1(m.p95 / 1000) + ' s' : fmt(m.p95) + ' ms', m.p95 > 500 ? 'bad' : m.p95 > 120 ? 'warn' : 'good'],
        ['Threads اتضافت (injection)', String(st.injections)]
      ];
    }
  });

  Lab.registerLesson({
    id: 'threadpool', lab: 'os', title: 'Thread Pool و Starvation',
    html: Lab.tpl.lesson({
      sim: 'threadpool', level: 3,
      terms: ['Thread Pool', 'Starvation', 'sync-over-async', 'Thread Injection'],
      lede: 'thread pool بطابور واحد. كل request فيه 2 ms CPU و call لقاعدة البيانات 50 ms. البرتقالي شغل، والأحمر المخطط thread واقف على <code>.Result</code>، والبنفسجي الـ continuation الداخلية اللي الـ threads الواقفة مستنياها. تحت: عدد الـ threads والطابور مع الوقت.',
      aria: 'محاكاة thread pool starvation بسبب sync over async',
      controls: [
        { type: 'seg', p: 'mode', label: 'كود الـ handler', value: 'sync', opts: [['sync', 'sync-over-async (.Result)'], ['async', 'async / await']] },
        { type: 'range', p: 'rate', label: 'Requests في الثانية', min: 20, max: 300, step: 10, value: 120 },
        { type: 'range', p: 'min', label: 'Min threads (عدد الـ cores)', min: 2, max: 32, step: 1, value: 4 }
      ],
      idea: `
        <p>الـ <b>Thread Pool</b>: threads جاهزة بتسحب شغل من طابور، بدل ما تعمل thread لكل request. بيبدأ بعدد قليل (حوالي عدد الـ cores)، ولما يلاقي شغل مستني وكل الـ threads مشغولة بيضيف threads (<b>Thread Injection</b>)، بس <b>ببطء</b>، عشان ميعملش آلاف الـ threads لو الشغل CPU.</p>
        <p><b>Starvation</b>: كل الـ threads «مشغولة» بس مش بتشتغل، واقفة مستنية. أشهر سبب <b>sync-over-async</b>: <code>.Result</code> بيقفل الـ thread لحد ما الـ async method تخلص، والـ async method نفسها محتاجة thread من نفس الـ pool عشان تكمّل. لو كل الـ threads واقفة، محدش هيكمّلها.</p>`,
      real: `
        <p>API الـ dispatch كان شغال كويس، لحد ما حد ضاف <code>.Result</code> على call لخدمة الخرايط جوه controller. على حمل خفيف محدش لاحظ. يوم الذروة: الـ requests بتتراكم، الـ latency بيبقى ثواني، والـ CPU 5% بس. السيرفر «عايش» بس مبيردش، والـ health check نفسه بيعمل timeout.</p>`,
      try: 'سيبها على sync-over-async و120 request: الطابور بيكبر، والـ threads كلها حمرا، والـ pool بيضيف thread كل نص ثانية والطابور برضه بيكبر. بدّل لـ async/await: 4 threads بس كفاية والطابور فاضي. ارجع لـ sync وارفع Min threads لـ 16: المشكلة بتختفي على الحمل ده، بس دي مسكّن مش علاج (ارفع الـ requests لـ 300 وشوف).',
      also: 'أي بيئة فيها pool وشغل بيستنى شغل في نفس الـ pool: connection pool في الداتابيز (query بتفتح connection تانية وهي ماسكة الأولى)، و workers في message queue بيستنوا رد من نفس الـ queue.',
      net: `
<pre><span class="c">// ❌ sync-over-async: الـ thread واقف، والـ continuation محتاجة thread تاني</span>
public IActionResult Route(long id) =&gt; Ok(maps.GetRouteAsync(id).Result);

<span class="c">// ✓ async من أول الـ controller لآخر call</span>
public async Task&lt;IActionResult&gt; Route(long id, CancellationToken ct) =&gt; Ok(await maps.GetRouteAsync(id, ct));

<span class="c">// المسكّن (مش العلاج): threads جاهزة أكتر من البداية</span>
ThreadPool.SetMinThreads(workerThreads: 64, completionPortThreads: 64);

<span class="c">// إزاي تكتشفها: الـ queue length بيزيد والـ CPU واطي</span>
<span class="c">// dotnet-counters monitor -n Dispatch.Api System.Runtime</span>
<span class="c">//   ThreadPool Queue Length / ThreadPool Thread Count</span></pre>`,
      netTitle: 'في .NET',
      deep: [
        '<b>ليه الـ injection بطيء؟</b> لو الشغل CPU-bound، threads أكتر من الـ cores بتبطّأ (context switches). فالـ pool بيضيف واحد ويقيس الـ throughput (hill climbing)، ولو شاف مفيش تقدّم خالص بيضيف thread كل حوالي نص ثانية. من .NET 6 الـ pool بيلاحظ الـ threads الواقفة على <code>Task.Wait</code>/<code>.Result</code> وبيضيف أسرع شوية، بس تحت حمل عالي المشكلة لسه موجودة.',
        '<b>الطابور FIFO هو المصيدة:</b> الـ continuations اللي هتحرر الـ threads الواقفة داخلة في نفس الطابور ورا requests جديدة. كل thread جديد بياخد request جديد ويقف هو كمان، فالـ spiral بيكمّل.',
        '<b>إزاي تكتشفها:</b> <code>dotnet-counters</code>: ThreadPool Queue Length عالي وThread Count بيزيد ببطء والـ CPU واطي. وفي dump: مئات الـ threads واقفة في <code>Task.Wait</code> أو <code>GetResult</code>.',
        '<b>أماكن مستخبية للـ blocking:</b> <code>.Result</code> و<code>.Wait()</code> و<code>GetAwaiter().GetResult()</code>، و<code>lock</code> حوالين شغل I/O، والـ sync APIs زي <code>File.ReadAllText</code> و<code>HttpClient.Send</code> و EF من غير Async، وconstructors أو DI factories بتعمل I/O.',
        '<b>تبسيطات:</b> طابور واحد (الحقيقي فيه local queue لكل thread + global queue)، ومفيش hill climbing ولا إن الـ pool بيشيل threads فاضية. «+1 كل 500 ms» تقريب لسلوك الـ starvation.'
      ]
    })
  });
})();
