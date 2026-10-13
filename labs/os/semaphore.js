/* OS · Semaphore
   Our service asks an external maps API for routes. The API (a model, but a typical shape):
     up to 6 concurrent calls   ~200 ms each
     more than 6                every call slows down proportionally (shared CPU / DB on their side)
     14+ already in flight      new calls are rejected right away (503 / 429)
   Requests arrive at random, with a 4× burst every ~10 s (morning dispatch). Two modes:
     no limit        every request calls the API immediately
     SemaphoreSlim   at most N calls in flight; the rest wait (WaitAsync) in FIFO order for a permit
   Latency (end to end, including the wait), errors and throughput are measured from the run. */
(function () {
  "use strict";
  const { clamp, lerp, fmt, f1, expo, Meter } = Lab.util;
  const { box, tx, dot, circ, line, alpha, ring } = Lab.draw;

  const BASE = 0.2, GOOD = 6, REJECT = 14, BURST_EVERY = 10, BURST_LEN = 2;

  function fresh(s) {
    s.st = { next: s.t + 0.05, waiting: [], flight: [], done: new Meter(4), errs: new Meter(10), lat: [], errors: 0, ok: 0 };
  }
  const burst = t => (t % BURST_EVERY) < BURST_LEN;

  Lab.registerSim('semaphore', {
    height: 340, warm: 12,
    init(s) { fresh(s); },
    onParam(s, k) { if (k !== 'rate') fresh(s); },

    step(s) {
      const st = s.st, t = s.t, limited = s.p.mode === 'sem', N = s.p.permits;
      const rate = s.p.rate * (burst(t) ? 4 : 1);
      while (st.next <= t) { st.waiting.push({ arr: st.next }); st.next += expo(rate, s.rng); }
      // finished calls
      st.flight = st.flight.filter(c => {
        if (t < c.end) return true;
        if (c.err) { st.errors++; st.errs.add(t); s.drop(c.x || st.apiX || 0, c.y || st.apiY || 0, 'bad', (s.rng() - 0.5) * 60); }
        else { st.ok++; st.done.add(t); st.lat.push([t, t - c.arr]); }
        return false;
      });
      // start calls: everyone (no limit) or while a permit is free
      while (st.waiting.length && (!limited || st.flight.length < N)) {
        const r = st.waiting.shift(), inflight = st.flight.length;
        if (inflight >= REJECT) st.flight.push({ arr: r.arr, start: t, end: t + 0.03, err: true });
        else st.flight.push({ arr: r.arr, start: t, end: t + BASE * Math.max(1, (inflight + 1) / GOOD) * (0.85 + s.rng() * 0.3), err: false });
      }
      while (st.lat.length && st.lat[0][0] < t - 10) st.lat.shift();
    },

    m(s) {
      const l = s.st.lat.map(x => x[1]).sort((a, b) => a - b);
      return { p95: l.length ? l[Math.floor(l.length * 0.95)] : 0, avg: l.length ? l.reduce((a, b) => a + b, 0) / l.length : 0 };
    },

    draw(s) {
      const C = s.C, st = s.st, t = s.t, W = s.w, H = s.h, n = s.narrow, limited = s.p.mode === 'sem', N = s.p.permits;
      const x0 = 14, x1 = W - 14, mid = H / 2 + 8;
      tx(burst(t) ? 'BURST: 4× requests (morning dispatch)' : `requests: ${s.p.rate}/s`, x0, 14, { m: 1, s: n ? 9.5 : 11.5, w: 700, a: 'left', c: burst(t) ? C.accent : C.muted });
      // waiting line
      const qx0 = x0, qx1 = n ? W * 0.42 : W * 0.38;
      tx(limited ? `waiting for a permit: ${st.waiting.length}` : 'no waiting: straight to the API', qx0, mid - 58, { m: 1, s: n ? 9 : 10.5, w: 700, a: 'left', c: st.waiting.length > 20 ? C.bad : C.muted });
      const per = Math.max(1, Math.floor((qx1 - qx0) / 9));
      st.waiting.slice(0, per * 5).forEach((r, i) => dot(qx1 - 6 - (i % per) * 9, mid - 30 + Math.floor(i / per) * 9, 3.3, C.accent));
      // the gate
      const gx = qx1 + 24, gw = n ? 46 : 70;
      box(gx, mid - 60, gw, 120, { r: 8, fill: C.surface, stroke: limited ? C.violet : C.line, lw: limited ? 2 : 1, dash: limited ? null : [4, 4] });
      tx(limited ? 'Semaphore' : 'no limit', gx + gw / 2, mid - 70, { m: 1, s: 9.5, w: 700, c: limited ? C.violet : C.muted });
      if (limited) {
        const used = Math.min(N, st.flight.length);
        for (let i = 0; i < N; i++) { const x = gx + 12 + (i % 3) * ((gw - 24) / 2), y = mid - 44 + Math.floor(i / 3) * 16; if (i < used) dot(x, y, 5, C.violet); else circ(x, y, 5, C.violet, 1.4); }
        tx(`${used}/${N} permits`, gx + gw / 2, mid + 48, { m: 1, s: 9, c: C.muted });
      }
      // the API
      const ax = gx + gw + 30, aw = x1 - ax, inf = st.flight.length;
      st.apiX = ax + aw / 2; st.apiY = mid - 20;
      const load = inf / GOOD, col = inf >= REJECT ? C.bad : inf > GOOD ? C.accent : C.good;
      box(ax, mid - 60, aw, 120, { r: 10, fill: C.surface, stroke: col, lw: 2 });
      tx('Maps API (external)', ax + 10, mid - 46, { m: 1, s: n ? 9.5 : 11, w: 700, a: 'left' });
      tx(`${inf} in flight`, ax + aw - 10, mid - 46, { m: 1, s: n ? 9.5 : 11, w: 700, a: 'right', c: col });
      const slow = Math.max(1, (inf + 1) / GOOD);
      tx(inf >= REJECT ? 'overloaded: rejecting (503)' : `each call ≈ ${Math.round(BASE * slow * 1000)} ms`, ax + 10, mid + 46, { m: 1, s: n ? 9 : 10.5, a: 'left', c: col });
      st.flight.forEach((c, i) => {
        const k = clamp((t - c.start) / (c.end - c.start), 0, 1), cols = Math.max(1, Math.floor((aw - 20) / 14));
        const x = ax + 16 + (i % cols) * 14, y = mid - 22 + Math.floor(i / cols) * 14;
        c.x = x; c.y = y;
        if (y < mid + 34) { ring(x, y, 5, k, c.err ? C.bad : C.a2, 2.2); }
      });
      // capacity gauge
      box(ax + 10, mid + 22, aw - 20, 6, { r: 3, fill: C.bg, stroke: null });
      box(ax + 10, mid + 22, (aw - 20) * clamp(inf / REJECT, 0, 1), 6, { r: 3, fill: col, stroke: null });
      alpha(0.7, () => line(ax + 10 + (aw - 20) * GOOD / REJECT, mid + 18, ax + 10 + (aw - 20) * GOOD / REJECT, mid + 32, C.ink, 1));
      const m = this.m(s);
      tx(`p95 ${f1(m.p95)} s · errors ${fmt(st.errs.sum(t))} in the last 10 s`, x0, H - 14, { m: 1, s: n ? 9 : 11, w: 700, a: 'left', c: st.errs.sum(t) ? C.bad : m.p95 > 1 ? C.accent : C.good });
    },

    stats(s) {
      const st = s.st, m = this.m(s), tot = st.ok + st.errors;
      return [
        ['Throughput (ناجحة)', f1(st.done.rate(s.t)) + ' /s'],
        ['Calls شغالة على الـ API', String(st.flight.length), st.flight.length >= REJECT ? 'bad' : st.flight.length > GOOD ? 'warn' : 'good'],
        ['مستنية permit', fmt(st.waiting.length), st.waiting.length > 30 ? 'warn' : ''],
        ['Latency p95 (شامل الانتظار)', f1(m.p95) + ' s', m.p95 > 2 ? 'bad' : m.p95 > 0.6 ? 'warn' : 'good'],
        ['Errors (503) من الأول', `${fmt(st.errors)} (${tot ? f1(st.errors / tot * 100) : 0}%)`, st.errors ? 'bad' : 'good']
      ];
    }
  });

  Lab.registerLesson({
    id: 'semaphore', lab: 'os', title: 'Semaphore',
    html: Lab.tpl.lesson({
      sim: 'semaphore', level: 2,
      terms: ['Semaphore', 'SemaphoreSlim', 'Permits', 'Concurrency Limit', 'Bulkhead'],
      lede: 'خدمتنا بتطلب مسارات من Maps API خارجي. الـ API بيرد كويس لحد 6 calls في نفس الوقت، بعد كده بيبطأ، ولو وصل 14 بيرفض (503). كل 10 ثواني فيه burst بـ 4 أضعاف الطلبات. الـ semaphore بيسمح لـ N بس يدخلوا، والباقي يستنوا.',
      aria: 'محاكاة SemaphoreSlim بيحدد عدد الـ calls المتزامنة لـ API خارجي',
      controls: [
        { type: 'seg', p: 'mode', label: 'الحماية', value: 'none', opts: [['none', 'من غير حد'], ['sem', 'SemaphoreSlim(N)']] },
        { type: 'range', p: 'permits', label: 'N (عدد الـ permits)', min: 1, max: 14, step: 1, value: 6 },
        { type: 'range', p: 'rate', label: 'Requests في الثانية (عادي)', min: 4, max: 30, step: 1, value: 14 }
      ],
      idea: `
        <p>الـ <code>lock</code> بيسمح لـ thread واحد. الـ <b>Semaphore</b> بيسمح لـ <b>N</b> في نفس الوقت: عداد فيه N <b>permits</b>، كل واحد داخل ياخد permit (<code>WaitAsync</code>) ولما يخلص يرجّعه (<code>Release</code>). لو مفيش permit فاضي، يستنى.</p>
        <p>الاستخدام الأهم: <b>Concurrency Limit</b> على حاجة محدودة بره: API خارجي، قاعدة بيانات، ديسك. الطابور بيتنقل من عند الـ API (حيث بيبوّظ كل الناس) لعندك (حيث تقدر تتحكم فيه وتشوفه). ده نوع من الـ <b>Bulkhead</b>.</p>`,
      real: `
        <p>الصبح كل السواقين بيفتحوا التطبيق في نفس الوقت، وكل واحد محتاج مسار. من غير حد، 40 call بيروحوا للـ Maps API مرة واحدة: بيبطأ لكل الناس، وبعدين بيرفض، والتطبيق بيعمل retry فالحمل بيزيد (retry storm). مع <code>SemaphoreSlim(6)</code> الـ API شغال في أحسن حالاته، والطلبات الزيادة بتستنى في طابور عندنا ثواني قليلة وتخلص كلها.</p>`,
      try: 'سيبها على «من غير حد» واستنى الـ burst: الـ API بيحمر ويرفض، وحوالي 20% من الطلبات بتفشل (والـ p95 شكله كويس لأنه بيحسب الناجحة بس). بدّل لـ SemaphoreSlim(6): صفر errors، والـ p95 بيعلى وقت الـ burst لأن الطلبات بتستنى عندنا بدل ما تترفض. جرّب N = 1: الطابور مبيخلصش أبدًا. وN = 14: من غير errors بس كل call أبطأ، ومفيش throughput زيادة لأن الـ API نفسه مش بيلحق.',
      also: 'تحديد عدد التحويلات المتزامنة لبوابة الدفع، وعدد الـ downloads المتوازية في تطبيق موبايل، وعدد الـ queries التقيلة على replica واحدة.',
      net: `
<pre><span class="c">// حد واحد مشترك لكل الـ requests (static أو singleton)، مش واحد لكل request</span>
private static readonly SemaphoreSlim MapsGate = new(initialCount: 6, maxCount: 6);

public async Task&lt;Route&gt; GetRouteAsync(Point a, Point b, CancellationToken ct)
{
    await MapsGate.WaitAsync(ct);          <span class="c">// استنى permit (من غير ما تحجز thread)</span>
    try { return await maps.RouteAsync(a, b, ct); }
    finally { MapsGate.Release(); }        <span class="c">// لازم في finally، وإلا الـ permit بيضيع للأبد</span>
}

<span class="c">// .NET 7+: نفس الفكرة جاهزة مع طابور محدود</span>
var limiter = new ConcurrencyLimiter(new() { PermitLimit = 6, QueueLimit = 200 });</pre>`,
      netTitle: 'في .NET',
      deep: [
        '<b>Release في finally دايمًا:</b> لو exception حصلت وما اتعملش Release، الـ permit ضاع. بعد 6 مرات، الخدمة كلها واقفة على <code>WaitAsync</code> للأبد. ولو عملت Release أكتر من اللازم، الحد بيكبر لوحده (<code>maxCount</code> بيمنع ده برمي exception).',
        '<b>الطابور اللي عندك لازم يبقى محدود:</b> semaphore من غير timeout بيخلّي الطابور يكبر لو الـ API وقع خالص. استخدم <code>WaitAsync(timeout)</code> أو <code>ConcurrencyLimiter</code> بـ QueueLimit، وارفض بسرعة (fail fast) أحسن من request مستني دقيقة.',
        '<b>الحد على مستوى instance:</b> <code>SemaphoreSlim(6)</code> في كل instance، ولو عندك 5 instances يبقى 30 على الـ API. الحد الموزّع محتاج حاجة مشتركة (Redis) أو rate limit على الـ gateway. شوف <a href="#/system-design/rate-limit">Rate Limiting</a>.',
        '<b>SemaphoreSlim vs Semaphore:</b> <code>SemaphoreSlim</code> جوه الـ process، خفيف، وفيه <code>WaitAsync</code>. <code>Semaphore</code> (من غير Slim) kernel object ممكن يتشارك بين processes، أتقل، ومفيهوش async.',
        '<b>متوسط الناجح بيكدب:</b> من غير حد، الـ latency بتاع الطلبات الناجحة ممكن يبان أحسن، لأن الطلبات اللي كانت هتستنى اترفضت ومش داخلة في الحساب. دايمًا راقب الـ errors جنب الـ latency.',
        '<b>تبسيطات:</b> سلوك الـ API نموذج: خطي بعد 6 ورفض عند 14. الحقيقي غالبًا بيبقى أسوأ (latency بيتضاعف فجأة بعد نقطة معينة)، وده بيخلّي الحد أهم.'
      ]
    })
  });
})();
