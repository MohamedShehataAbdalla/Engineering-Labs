/* System Design · Single Point of Failure
   The tracking platform's request path: load balancer → API servers → Redis → SQL Server (+ broker for ingest).
   Every instance fails at random (exponential, mean time between failures 60 days) and takes ~4 hours to repair.
   A component is up while at least one of its instances is up (failover is assumed instant); the system is up only
   when every component is up. Simulated time: 2 days per real second, so a year takes ~3 minutes.
   Measured uptime comes from the run; the "expected" line is the formula: a = MTBF/(MTBF+MTTR),
   component = 1 − (1 − a)^copies, system = product over components. */
(function () {
  "use strict";
  const { clamp, lerp, fmt, f1, expo } = Lab.util;
  const { box, tx, line, alpha } = Lab.draw;

  const MTBF = 60 * 24, MTTR = 4, DAYS_PER_SEC = 2, YEAR = 365 * 24;     // hours
  const COMPS = [['lb', 'Load balancer'], ['api', 'API servers'], ['redis', 'Redis'], ['db', 'SQL Server'], ['mq', 'Broker']];

  function fresh(s) {
    const rnd = s.rng;
    s.st = { now: 0, up: 0, down: 0, incidents: 0, sysUp: true, strip: [],
      comps: COMPS.map(([k]) => ({ k, inst: Array.from({ length: s.p[k] }, () => ({ up: true, next: expo(1 / MTBF, rnd) })) })) };
  }
  const a1 = MTBF / (MTBF + MTTR);

  Lab.registerSim('spof', {
    height: 380, warm: 0,
    init(s) { fresh(s); },
    onParam(s) { fresh(s); },

    step(s, dt) {
      const st = s.st, rnd = s.rng, end = st.now + dt * DAYS_PER_SEC * 24;
      while (st.now < end) {
        const h = Math.min(0.25, end - st.now); st.now += h;
        for (const c of st.comps) for (const i of c.inst) {
          while (st.now >= i.next) {
            i.up = !i.up;
            i.next += i.up ? expo(1 / MTBF, rnd) : MTTR * (0.5 + rnd());
          }
        }
        const sysUp = st.comps.every(c => c.inst.some(i => i.up));
        if (sysUp) st.up += h; else st.down += h;
        if (!sysUp && st.sysUp) st.incidents++;
        st.sysUp = sysUp;
        const day = Math.floor(st.now / 24);
        if (!st.strip.length || st.strip[st.strip.length - 1].d !== day) st.strip.push({ d: day, down: 0 });
        if (!sysUp) st.strip[st.strip.length - 1].down += h;
      }
      if (st.now >= YEAR) fresh(s);
      if (st.strip.length > 365) st.strip.shift();
    },

    expected(s) { return COMPS.reduce((p, [k]) => p * (1 - Math.pow(1 - a1, s.p[k])), 1); },

    draw(s) {
      const C = s.C, st = s.st, W = s.w, H = s.h, n = s.narrow;
      const cw = (W - 28 - 4 * 12) / COMPS.length, top = 46, ch = 120;
      tx(`day ${fmt(st.now / 24)} of 365 · each instance fails ~every 60 days, repair ~4 h`, 14, 16, { m: 1, s: n ? 8.5 : 10.5, a: 'left', c: C.muted });
      st.comps.forEach((c, j) => {
        const x = 14 + j * (cw + 12), up = c.inst.some(i => i.up);
        box(x, top, cw, ch, { r: 10, fill: C.surface, stroke: up ? C.a2 : C.bad, lw: 2 });
        tx(COMPS[j][1], x + cw / 2, top + 16, { m: 1, s: n ? 7.5 : 10, w: 700, c: up ? C.ink : C.bad });
        const iw = Math.min(28, (cw - 16) / c.inst.length - 4);
        c.inst.forEach((i, k) => box(x + 8 + k * (iw + 4), top + 40, iw, 40, { r: 4, fill: i.up ? C.good : C.bad, stroke: null }));
        tx(c.inst.length === 1 ? 'SPOF' : `${c.inst.length} copies`, x + cw / 2, top + ch - 16, { m: 1, s: n ? 7.5 : 9.5, w: 700, c: c.inst.length === 1 ? C.bad : C.muted });
        if (j < COMPS.length - 1) alpha(0.5, () => line(x + cw, top + ch / 2, x + cw + 12, top + ch / 2, C.line, 2));
      });
      // the year, one tick per day: red where the system was down
      const sy = top + ch + 40, sh = 40, dw = (W - 28) / 365;
      box(14, sy, W - 28, sh, { r: 6, fill: C.bg, stroke: C.line });
      for (const d of st.strip) if (d.down > 0) box(14 + d.d * dw, sy, Math.max(1.5, dw), sh, { r: 0, fill: C.bad, stroke: null });
      tx('system down (by day)', 14, sy - 8, { m: 1, s: 9.5, a: 'left', c: C.muted });
      const tot = st.up + st.down, meas = tot ? st.up / tot : 1, exp = this.expected(s);
      const mins = v => (1 - v) * YEAR * 60;
      tx(`measured ${(meas * 100).toFixed(3)}% · expected ${(exp * 100).toFixed(4)}% ≈ ${mins(exp) >= 120 ? fmt(mins(exp) / 60) + ' h' : fmt(mins(exp)) + ' min'} down per year · ${st.incidents} outages so far`, 14, H - 14, { m: 1, s: n ? 8 : 10.5, w: 700, a: 'left', c: exp < 0.999 ? C.bad : exp < 0.9999 ? C.accent : C.good });
    },

    stats(s) {
      const st = s.st, tot = st.up + st.down, meas = tot ? st.up / tot : 1, exp = this.expected(s);
      const nines = v => v >= 1 ? '∞' : f1(-Math.log10(1 - v));
      return [
        ['Availability متقاسة', (meas * 100).toFixed(3) + ' %', meas < 0.999 ? 'bad' : meas < 0.9999 ? 'warn' : 'good'],
        ['المتوقعة بالمعادلة', (exp * 100).toFixed(4) + ' %'],
        ['عدد الـ nines', nines(exp), exp < 0.999 ? 'bad' : exp < 0.9999 ? 'warn' : 'good'],
        ['توقف في السنة (متوقع)', ((1 - exp) * YEAR) >= 2 ? f1((1 - exp) * YEAR) + ' h' : fmt((1 - exp) * YEAR * 60) + ' min'],
        ['أعطال وقّعت النظام لحد دلوقتي', String(st.incidents), st.incidents ? 'warn' : 'good']
      ];
    }
  });

  const seg = (p, label) => ({ type: 'seg', p, label, value: 1, opts: [[1, '1'], [2, '2']] });
  Lab.registerLesson({
    id: 'spof', lab: 'system-design', title: 'Single Point of Failure',
    html: Lab.tpl.lesson({
      sim: 'spof', level: 2,
      terms: ['SPOF', 'Redundancy', 'Availability', 'MTBF / MTTR', 'Nines'],
      lede: 'مسار الـ request في النظام: 5 مكونات ورا بعض، وكل مربع instance (أخضر شغال، أحمر واقع). كل instance بيقع عشوائي مرة كل حوالي 60 يوم وبياخد 4 ساعات يتصلح. المكون شغال لو فيه نسخة واحدة على الأقل شغالة، والنظام شغال لو كل المكونات شغالة. سنة كاملة في حوالي 3 دقايق.',
      aria: 'محاكاة أعطال مكونات النظام على مدار سنة مع redundancy',
      controls: [seg('lb', 'Load balancer'), { type: 'range', p: 'api', label: 'API servers', min: 1, max: 4, step: 1, value: 1 }, seg('redis', 'Redis'), seg('db', 'SQL Server'), seg('mq', 'Broker')],
      idea: `
        <p><b>SPOF</b>: أي جزء لو وقع، النظام كله يقع. المكونات اللي ورا بعض (series) الـ availability بتاعتها بتتضرب في بعض: 5 مكونات كل واحد 99.7% = حوالي 98.6% للنظام، يعني 5 أيام توقف في السنة.</p>
        <p>الحل <b>Redundancy</b>: نسختين من كل حاجة. نسختين مستقلين كل واحدة 99.7% = 99.999% للمكون، لأن الاتنين لازم يقعوا في نفس الوقت. الـ <b>Availability</b> بتتحسب من <b>MTBF</b> (متوسط الوقت بين الأعطال) و<b>MTTR</b> (متوسط وقت الإصلاح)، وبتتقال بالـ <b>nines</b>: 99.9% = 3 nines = حوالي 9 ساعات في السنة.</p>`,
      real: `
        <p>النظام فيه 3 API servers ورا load balancer، والكل مبسوط. بس الـ load balancer واحد، وقاعدة البيانات واحدة، وRedis واحد. أول ما Redis وقع ساعتين بالليل، كل العربيات اختفت من الخريطة رغم إن الـ 3 servers شغالين. الـ redundancy في مكان واحد مش بتنفع لو فيه SPOF في مكان تاني على نفس المسار.</p>`,
      try: 'ابدأ بكل حاجة 1: حوالي 98.6% وأيام توقف في السنة. زوّد الـ API servers لـ 4 بس: تقريبًا مفيش فرق، لأن الباقي لسه SPOF. بعدين خلّي كل حاجة 2: بتوصل لحوالي 99.99%، والشريط الأحمر بيختفي تقريبًا. وجرّب ترجّع واحد بس لـ 1 (مثلًا Redis): النظام كله بيرجع لمستواه.',
      also: 'شبكة الكهربا في data center (مصدرين و UPS)، وبوابة الدفع (provider احتياطي)، وDNS (أكتر من provider)، والفريق نفسه: لو شخص واحد بس عارف يعمل deploy، ده SPOF.',
      net: `
<pre><span class="c">// SPOF مستخبي: الـ app بيقع لو Redis مش موجود وقت التشغيل</span>
var mux = ConnectionMultiplexer.Connect("redis:6379");                      <span class="c">// ❌ exception لو وقع</span>
var mux2 = ConnectionMultiplexer.Connect("redis-a:6379,redis-b:6379,abortConnect=false");  <span class="c">// ✓</span>

<span class="c">// health checks لكل dependency، والـ load balancer يشيل الـ instance اللي مش سليم</span>
builder.Services.AddHealthChecks()
    .AddSqlServer(connStr, name: "sql")
    .AddRedis(redisConn, name: "redis", failureStatus: HealthStatus.Degraded);   <span class="c">// Redis واقع = degraded، مش down</span>
app.MapHealthChecks("/health");</pre>`,
      netTitle: 'في .NET',
      deep: [
        '<b>الأعطال مش مستقلة دايمًا:</b> نسختين على نفس الـ rack أو نفس الـ availability zone أو نفس الـ deploy بايظ هيقعوا مع بعض. المعادلة بتفترض استقلال؛ الحقيقة محتاجة توزيع على zones وdeploy تدريجي.',
        '<b>الـ failover نفسه بياخد وقت:</b> هنا الـ failover فوري. في الحقيقة SQL Server Always On بياخد ثواني لعشرات الثواني، وأحيانًا الـ failover نفسه بيفشل. اختبره (chaos testing) قبل ما تحتاجه.',
        '<b>Degraded mode:</b> مش كل dependency لازم توقّع النظام. لو Redis وقع والـ app بيقرا من الـ DB مباشرة (أبطأ بس شغال)، Redis مبقاش SPOF للـ availability، بس بقى SPOF للأداء.',
        '<b>MTTR أهم مما تتخيل:</b> نص الـ MTTR = نص التوقف. monitoring كويس، وrunbooks، وrollback بضغطة واحدة بيفرقوا زي ما الـ redundancy بيفرق. شوف <a href="#/system-design/observability">Observability</a>.',
        '<b>تبسيطات:</b> كل الـ instances نفس الـ MTBF والـ MTTR، والأعطال مستقلة، والـ failover فوري، والمكون شغال بنسخة واحدة (مفيش قلق إنها مش هتستحمل الحمل لوحدها).'
      ]
    })
  });
})();
