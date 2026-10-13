/* System Design · Rate Limiting
   A partner's API key may make 10 requests per second. Four limiters, implemented exactly:
     fixed window      a counter per calendar second; resets at each boundary
     sliding log       keep every allowed timestamp of the last second; allow if fewer than 10
     sliding counter   current-second count + previous-second count × the part of it still inside the window
     token bucket      tokens refill at 10/s up to the bucket size; each request takes one
   Traffic patterns: steady (~8/s random), bursty (4/s plus a burst of 15 every 3 s), and a boundary attack
   (10 requests just before each second ends and 10 just after it starts). The true rate is measured over every
   sliding 1-second window of allowed requests. */
(function () {
  "use strict";
  const { clamp, lerp, fmt, f1, expo } = Lab.util;
  const { box, tx, dot, line, alpha } = Lab.draw;

  const LIMIT = 10, VIEW = 6;

  function fresh(s) {
    s.st = { next: s.t + 0.05, burstAt: s.t + 1, events: [], allowed: [], log: [], fixed: { w: -1, n: 0 }, sc: { w: -1, cur: 0, prev: 0 },
      tokens: s.p.bucket, last: s.t, ok: 0, no: 0, bndNext: Math.floor(s.t) + 1 };
  }
  function decide(s, t) {
    const st = s.st, a = s.p.alg;
    if (a === 'fixed') { const w = Math.floor(t); if (w !== st.fixed.w) { st.fixed = { w, n: 0 }; } if (st.fixed.n < LIMIT) { st.fixed.n++; return true; } return false; }
    if (a === 'log') { st.log = st.log.filter(x => x > t - 1); if (st.log.length < LIMIT) { st.log.push(t); return true; } return false; }
    if (a === 'counter') {
      const w = Math.floor(t);
      if (w !== st.sc.w) { st.sc = { w, prev: w === st.sc.w + 1 ? st.sc.cur : 0, cur: 0 }; }
      const est = st.sc.cur + st.sc.prev * (1 - (t - w));
      if (est < LIMIT) { st.sc.cur++; return true; } return false;
    }
    st.tokens = Math.min(s.p.bucket, st.tokens + (t - st.last) * LIMIT); st.last = t;
    if (st.tokens >= 1) { st.tokens -= 1; return true; } return false;
  }

  Lab.registerSim('rate-limit', {
    height: 340, warm: 4,
    init(s) { fresh(s); },
    onParam(s) { fresh(s); },

    step(s) {
      const st = s.st, t = s.t, times = [];
      if (s.p.traffic === 'steady') { while (st.next <= t) { times.push(st.next); st.next += expo(8, s.rng); } }
      else if (s.p.traffic === 'bursty') {
        while (st.next <= t) { times.push(st.next); st.next += expo(4, s.rng); }
        if (t >= st.burstAt) { for (let i = 0; i < 15; i++) times.push(st.burstAt + i * 0.012); st.burstAt += 3; }
      } else {
        // boundary attack: 10 in the last 60 ms of a second, 10 in the first 60 ms of the next
        while (t >= st.bndNext + 0.07) {
          for (let i = 0; i < 10; i++) times.push(st.bndNext - 0.06 + i * 0.006);
          for (let i = 0; i < 10; i++) times.push(st.bndNext + 0.002 + i * 0.006);
          st.bndNext += 2;
        }
      }
      times.sort((a, b) => a - b);
      for (const x of times) { const ok = decide(s, x); st.events.push({ t: x, ok }); if (ok) { st.ok++; st.allowed.push(x); } else st.no++; }
      st.events = st.events.filter(e => e.t > t - VIEW - 1);
      st.allowed = st.allowed.filter(x => x > t - 30);
    },

    /** most allowed requests in any 1-second (and 100 ms) sliding window, over the last 30 s */
    peaks(s) {
      const a = s.st.allowed; let p1 = 0, p01 = 0, j = 0, k = 0;
      for (let i = 0; i < a.length; i++) { while (a[i] - a[j] >= 1) j++; while (a[i] - a[k] >= 0.1) k++; p1 = Math.max(p1, i - j + 1); p01 = Math.max(p01, i - k + 1); }
      return { p1, p01 };
    },

    draw(s) {
      const C = s.C, st = s.st, t = s.t, W = s.w, H = s.h, n = s.narrow;
      const x0 = 14, x1 = W - 14, X = v => lerp(x0, x1, (v - (t - VIEW)) / VIEW), y0 = 40, y1 = H - 110;
      const names = { fixed: 'fixed window', log: 'sliding log', counter: 'sliding window counter', token: `token bucket (size ${s.p.bucket})` };
      tx(`limit ${LIMIT}/s · ${names[s.p.alg]}`, x0, 16, { m: 1, s: n ? 9.5 : 11.5, w: 700, a: 'left', c: C.violet });
      box(x0, y0, x1 - x0, y1 - y0, { r: 6, fill: C.surface, stroke: C.line });
      for (let sec = Math.ceil(t - VIEW); sec <= t; sec++) { const x = X(sec); alpha(0.5, () => line(x, y0, x, y1, C.line, 1, [3, 4])); tx(`${sec}s`, x + 3, y1 - 6, { m: 1, s: 8, a: 'left', c: C.muted }); }
      // stack each second's requests so bursts are visible
      const lane = {};
      for (const e of st.events) {
        if (e.t < t - VIEW) continue;
        const b = Math.floor(e.t * 20); lane[b] = (lane[b] || 0) + 1;
        dot(X(e.t), y1 - 14 - lane[b] * 7, 3, e.ok ? C.good : C.bad);
      }
      // allowed-rate meter: requests allowed in the trailing second
      const recent = st.allowed.filter(x => x > t - 1).length;
      const my = y1 + 18;
      box(x0, my, x1 - x0, 14, { r: 4, fill: C.bg, stroke: null });
      box(x0, my, (x1 - x0) * clamp(recent / (LIMIT * 2.2), 0, 1), 14, { r: 4, fill: recent > LIMIT ? C.bad : C.good, stroke: null });
      line(x0 + (x1 - x0) * LIMIT / (LIMIT * 2.2), my - 4, x0 + (x1 - x0) * LIMIT / (LIMIT * 2.2), my + 18, C.ink, 1.5);
      tx(`allowed in the last second: ${recent}`, x0, my + 30, { m: 1, s: n ? 9 : 10.5, w: 700, a: 'left', c: recent > LIMIT ? C.bad : C.muted });
      if (s.p.alg === 'token') tx(`tokens: ${f1(st.tokens)}`, x1, my + 30, { m: 1, s: n ? 9 : 10.5, w: 700, a: 'right', c: C.violet });
      const pk = this.peaks(s);
      tx(`worst 1 s window: ${pk.p1} allowed · worst 100 ms: ${pk.p01}`, x0, H - 12, { m: 1, s: n ? 9 : 11, w: 700, a: 'left', c: pk.p1 > LIMIT ? C.bad : C.good });
    },

    stats(s) {
      const st = s.st, pk = this.peaks(s), tot = st.ok + st.no;
      return [
        ['اتسمح / اترفض', `${fmt(st.ok)} / ${fmt(st.no)}`],
        ['نسبة الرفض', tot ? f1(st.no / tot * 100) + ' %' : '—'],
        ['أسوأ ثانية (أي ثانية متحركة)', String(pk.p1), pk.p1 > LIMIT ? 'bad' : 'good'],
        ['أسوأ 100 ms', String(pk.p01), pk.p01 > 5 ? 'warn' : ''],
        ['الحد', LIMIT + ' / s']
      ];
    }
  });

  Lab.registerLesson({
    id: 'rate-limit', lab: 'system-design', title: 'Rate Limiting',
    html: Lab.tpl.lesson({
      sim: 'rate-limit', level: 2,
      terms: ['Rate Limiting', 'Fixed Window', 'Sliding Window', 'Token Bucket', '429'],
      lede: 'شريك بيستخدم الـ API بتاعنا بمفتاح مسموحله بـ 10 requests في الثانية. كل نقطة request: الأخضر اتسمح والأحمر اترفض (429). الخطوط المتقطعة حدود الثواني. تحت: كام request اتسمح فعلًا في آخر ثانية.',
      aria: 'محاكاة خوارزميات rate limiting مع أنماط traffic مختلفة',
      controls: [
        { type: 'seg', p: 'alg', label: 'الخوارزمية', value: 'fixed', opts: [['fixed', 'Fixed window'], ['log', 'Sliding log'], ['counter', 'Sliding counter'], ['token', 'Token bucket']] },
        { type: 'seg', p: 'traffic', label: 'شكل الـ traffic', value: 'boundary', opts: [['steady', 'ثابت (~8/s)'], ['bursty', 'دفعات'], ['boundary', 'على حدود الثانية']] },
        { type: 'range', p: 'bucket', label: 'حجم الـ bucket (token bucket)', min: 1, max: 30, step: 1, value: 10 }
      ],
      idea: `
        <p><b>Rate Limiting</b>: حد لعدد الطلبات من عميل في فترة، عشان عميل واحد (بالغلط أو قصدًا) ميوقّعش الخدمة على الباقي. اللي بيعدّي الحد بياخد <b>429</b> Too Many Requests.</p>
        <p><b>Fixed Window</b>: عدّاد لكل ثانية بيتصفّر عند الحد. بسيط، بس يسمح بضعف الحد حوالين لحظة التصفير. <b>Sliding Window</b>: بيبص على آخر ثانية بالظبط (log دقيق بس بياكل ذاكرة، أو counter تقريبي بعدّادين). <b>Token Bucket</b>: tokens بتتملي بمعدل ثابت لحد سعة معينة، وكل request بياخد واحد: بيسمح بـ burst محدود ومتوسط ثابت.</p>`,
      real: `
        <p>شركة لوجستيات شريكة بتسحب مواقع العربيات من الـ API بتاعنا كل ثانية. حطينا fixed window 10 في الثانية، وسكريبت عندهم بيبعت كل الـ requests في آخر الثانية وأول اللي بعدها: 20 request في أقل من 100 ms، والقاعدة بتتضرب في لحظة. الـ sliding window بيقفل الثغرة دي.</p>`,
      try: 'سيبها على «على حدود الثانية» مع Fixed window: «أسوأ ثانية» بتوصل 20، ضعف الحد. بدّل لـ Sliding log: بتنزل لـ 10 بالظبط. Sliding counter: قريب جدًا من 10. Token bucket بحجم 10: حوالي 11 (الـ 10 اللي في الـ bucket واللي اتملى). بعدين «دفعات»: الـ token bucket بيعدّي الـ burst، وأسوأ ثانية ممكن توصل حجم الـ bucket + المعدل (حوالي 19)، والـ sliding log بيرفضه. صغّر الـ bucket لـ 3 وشوف الـ bursts بتترفض.',
      also: 'login (حماية من تخمين كلمات السر)، وإرسال OTP بالـ SMS (كل رسالة بفلوس)، والـ public APIs بخطط اشتراك، وحماية الـ webhooks الخارجة عشان متضربش سيستم عميل.',
      net: `
<pre><span class="c">// ASP.NET Core 7+: rate limiting جاهز (fixed / sliding / token bucket / concurrency)</span>
builder.Services.AddRateLimiter(o =&gt; {
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.AddPolicy("partner", ctx =&gt; RateLimitPartition.GetSlidingWindowLimiter(
        partitionKey: ctx.Request.Headers["X-Api-Key"].ToString(),
        factory: _ =&gt; new SlidingWindowRateLimiterOptions {
            PermitLimit = 10, Window = TimeSpan.FromSeconds(1), SegmentsPerWindow = 10 }));
});
app.UseRateLimiter();
app.MapGet("/v1/positions", GetPositions).RequireRateLimiting("partner");</pre>`,
      netTitle: 'في ASP.NET Core',
      deep: [
        '<b>Sliding window في .NET:</b> <code>SlidingWindowRateLimiter</code> بيقسم النافذة segments (هنا 10 × 100 ms) وبيعدّ لكل segment، وده حل وسط بين الـ log الدقيق والـ counter التقريبي: كل ما الـ segments تزيد يبقى أدق وأتقل.',
        '<b>موزّع ولا لأ؟</b> limiter في ذاكرة كل instance معناه إن 4 instances = 4 أضعاف الحد. الحد الحقيقي محتاج عدّاد مشترك (Redis بـ INCR + EXPIRE أو Lua script)، أو rate limit على الـ gateway.',
        '<b>Retry-After:</b> رد الـ 429 لازم يقول للعميل يستنى قد إيه، وإلا هيعيد فورًا ويزوّد الحمل. والعملاء المحترمين بيعملوا backoff (شوف <a href="#/system-design/resilience">Retry و Backoff</a>).',
        '<b>Rate limit مش load shedding:</b> الـ rate limit عادل بين العملاء. لكن لو الخدمة نفسها تعبانة، محتاج load shedding (ارفض الزيادة عن طاقتك أيًا كان مين)، و<a href="#/os/semaphore">concurrency limiter</a> بيعمل ده.',
        '<b>تبسيطات:</b> عميل واحد، والحد 10 في الثانية، ونمط «حدود الثانية» بيبعت 10 في آخر 60 ms من الثانية و10 في أول 60 ms من اللي بعدها كل ثانيتين.'
      ]
    })
  });
})();
