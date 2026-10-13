/* System Design · Observability (Logs, Metrics, Tracing, Alerts)
   The tracking API serves ~60 requests/s across three endpoints: GET /positions (~30 ms, 70%), POST /trips (~80 ms,
   25%), GET /reports (~400 ms, 5%). Every request produces a trace (spans for cache, DB and the maps service).
   "Bad deploy" changes POST /trips: 6% of calls take a slow DB path (~2.5 s) and 6% fail with a 500 (~1.5% of all traffic).
   Metrics are computed every second from the requests themselves: rate, error %, average and p99 latency.
   Each alert rule is evaluated on the last 30 s, must stay true for 10 s before it fires (like a "for:" clause),
   and the time from the deploy to the alert is measured. The waterfall is the slowest trace of the last 10 s. */
(function () {
  "use strict";
  const { clamp, lerp, fmt, f1, expo } = Lab.util;
  const { box, tx, line, alpha } = Lab.draw;

  const RATE = 60, VIEW = 90, HOLD = 10;
  const EP = [['GET /positions', 0.03, 0.70], ['POST /trips', 0.08, 0.25], ['GET /reports', 0.4, 0.05]];
  const RULES = { avg: ['avg latency > 200 ms', m => m.avg > 0.2], p99: ['p99 latency > 1 s', m => m.p99 > 1], err: ['error rate > 1%', m => m.err > 0.01] };

  function fresh(s) { s.st = { next: s.t, reqs: [], series: [], lastSec: Math.floor(s.t), bad: false, badAt: null, fired: {}, since: {}, logs: [], id: 1000 }; }

  function makeReq(s, t) {
    const st = s.st, r = s.rng(); let e = 0, acc = 0;
    for (let i = 0; i < EP.length; i++) { acc += EP[i][2]; if (r < acc) { e = i; break; } }
    const base = EP[e][1] * (0.6 + s.rng() * 0.8);
    const spans = [];
    let lat = base, err = false;
    const cache = 0.002 + s.rng() * 0.003; spans.push(['redis GET', 0, cache]);
    let db = base * 0.6, dbStart = cache;
    if (e === 1 && st.bad) {
      if (s.rng() < 0.06) { db = 2.2 + s.rng() * 0.8; lat = db + base; }      // the slow query path
      if (s.rng() < 0.06) err = true;
    }
    spans.push([e === 0 ? 'SELECT positions' : e === 1 ? 'INSERT trip + UPDATE vehicle' : 'SELECT report', dbStart, dbStart + db]);
    if (e === 1) spans.push(['POST maps/eta', dbStart + db, dbStart + db + base * 0.3]);
    const id = (++st.id).toString(16);
    if (err) st.logs.unshift({ t, txt: `ERR trace=${id} POST /trips → 500 SqlException: Timeout expired` });
    if (lat > 1.5) st.logs.unshift({ t, txt: `WRN trace=${id} POST /trips took ${fmt(lat * 1000)} ms (slow query)` });
    st.logs.length = Math.min(st.logs.length, 4);
    return { t, ep: e, lat: Math.max(lat, spans[spans.length - 1][2]), err, spans, id };
  }

  Lab.registerSim('observability', {
    height: 420, warm: 40,
    init(s) { fresh(s); },
    onParam(s) { const st = s.st; st.fired = {}; st.since = {}; },
    act: {
      deploy(s) { const st = s.st; st.bad = !st.bad; st.badAt = st.bad ? s.t : null; st.fired = {}; st.since = {}; }
    },

    window(s, sec) {
      const L = s.st.reqs.filter(r => r.t > s.t - sec), lat = L.map(r => r.lat).sort((a, b) => a - b);
      return { n: L.length, rate: L.length / sec, err: L.length ? L.filter(r => r.err).length / L.length : 0,
        avg: lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : 0, p99: lat.length ? lat[Math.floor(lat.length * 0.99)] : 0 };
    },

    step(s) {
      const st = s.st, t = s.t;
      while (st.next <= t) { st.reqs.push(makeReq(s, st.next)); st.next += expo(RATE, s.rng); }
      st.reqs = st.reqs.filter(r => r.t > t - 40);
      if (Math.floor(t) !== st.lastSec) {
        st.lastSec = Math.floor(t);
        const m1 = this.window(s, 1), m30 = this.window(s, 30);
        st.series.push({ t, ...m1, p99_30: m30.p99, avg30: m30.avg, err30: m30.err }); if (st.series.length > VIEW) st.series.shift();
        for (const [k, [, cond]] of Object.entries(RULES)) {
          if (cond(m30)) { if (st.since[k] == null) st.since[k] = t; if (!st.fired[k] && t - st.since[k] >= HOLD) st.fired[k] = t; }
          else { st.since[k] = null; st.fired[k] = null; }
        }
      }
    },

    draw(s) {
      const C = s.C, st = s.st, t = s.t, W = s.w, H = s.h, n = s.narrow, se = st.series;
      const x0 = 14, x1 = W - 14, gw = x1 - x0;
      tx(st.bad ? `bad deploy live for ${fmt(t - st.badAt)} s` : 'version 1.8.2 (healthy)', x0, 14, { m: 1, s: n ? 9.5 : 11.5, w: 700, a: 'left', c: st.bad ? C.bad : C.good });
      // charts: latency (avg vs p99 over 30 s) and error rate
      const chart = (y, h, title, lines, max, unit) => {
        box(x0, y, gw, h, { r: 6, fill: C.surface, stroke: C.line });
        tx(title, x0 + 8, y + 11, { m: 1, s: 9, w: 700, a: 'left', c: C.muted });
        for (const [key, col, label, thr] of lines) {
          const X = s.ctx; X.beginPath();
          se.forEach((p, i) => { const x = lerp(x0 + 4, x1 - 4, i / (VIEW - 1)), yy = lerp(y + h - 4, y + 18, clamp(p[key] / max, 0, 1)); if (i) X.lineTo(x, yy); else X.moveTo(x, yy); });
          X.strokeStyle = col; X.lineWidth = 1.8; X.stroke();
          if (thr != null) alpha(0.7, () => line(x0, lerp(y + h - 4, y + 18, thr / max), x1, lerp(y + h - 4, y + 18, thr / max), col, 1, [4, 4]));
          const last = se[se.length - 1];
          if (last) tx(`${label} ${unit === '%' ? f1(last[key] * 100) + '%' : fmt(last[key] * 1000) + ' ms'}`, x1 - 8, y + 11 + lines.indexOf(lines.find(l => l[0] === key)) * 12, { m: 1, s: 9, w: 700, a: 'right', c: col });
        }
      };
      chart(26, 92, 'latency (30 s window)', [['avg30', C.a2, 'avg', 0.2], ['p99_30', C.accent, 'p99', 1]], 3, 's');
      chart(124, 56, 'error rate (30 s window)', [['err30', C.bad, 'errors', 0.01]], 0.05, '%');
      // alerts
      const ay = 196;
      Object.entries(RULES).forEach(([k, [label]], i) => {
        const x = x0 + i * (gw / 3), fired = st.fired[k], pending = st.since[k] != null && !fired;
        box(x + 2, ay, gw / 3 - 4, 34, { r: 6, fill: fired ? C.bad : C.surface, stroke: fired ? C.bad : pending ? C.accent : C.line });
        tx(label, x + gw / 6, ay + 11, { m: 1, s: n ? 7.5 : 9, w: 700, c: fired ? C.surface : C.ink });
        tx(fired ? `FIRING · ${st.badAt != null ? fmt(fired - st.badAt) + ' s after deploy' : ''}` : pending ? 'pending…' : 'ok', x + gw / 6, ay + 25, { m: 1, s: n ? 7.5 : 9, c: fired ? C.surface : pending ? C.accent : C.muted });
      });
      // slowest trace of the last 10 s
      const recent = st.reqs.filter(r => r.t > t - 10).sort((a, b) => b.lat - a.lat)[0];
      const ty = ay + 50;
      if (recent) {
        tx(`slowest trace (10 s): ${EP[recent.ep][0]} · ${fmt(recent.lat * 1000)} ms · trace=${recent.id}`, x0, ty, { m: 1, s: n ? 8.5 : 10, w: 700, a: 'left', c: recent.lat > 1 ? C.bad : C.ink });
        const sx0 = x0 + (n ? 110 : 190), sw = x1 - sx0;
        box(sx0, ty + 10, sw, 14, { r: 3, fill: C.violet, stroke: null }); tx('request', x0, ty + 17, { m: 1, s: 9, a: 'left', c: C.muted });
        recent.spans.forEach((sp, i) => {
          const y = ty + 30 + i * 18, a = sx0 + sw * sp[1] / recent.lat, b = sx0 + sw * sp[2] / recent.lat;
          tx(sp[0], x0, y + 6, { m: 1, s: n ? 7.5 : 9, a: 'left', c: C.muted });
          box(a, y, Math.max(2, b - a), 12, { r: 3, fill: (sp[2] - sp[1]) > 1 ? C.bad : C.a2, stroke: null });
        });
      }
      st.logs.forEach((l, i) => tx(l.txt, x0, H - 12 - i * 14, { m: 1, s: n ? 7.5 : 9, a: 'left', c: l.txt.startsWith('ERR') ? C.bad : C.accent }));
    },

    stats(s) {
      const st = s.st, m = this.window(s, 30), det = k => st.fired[k] && st.badAt != null ? fmt(st.fired[k] - st.badAt) + ' s' : '—';
      return [
        ['Avg / p99 (30 s)', `${fmt(m.avg * 1000)} / ${fmt(m.p99 * 1000)} ms`, m.p99 > 1 ? 'bad' : 'good'],
        ['Error rate (30 s)', f1(m.err * 100) + ' %', m.err > 0.01 ? 'bad' : 'good'],
        ['Alert avg: اكتشف بعد', det('avg'), st.fired.avg ? 'good' : st.bad ? 'bad' : ''],
        ['Alert p99: اكتشف بعد', det('p99'), st.fired.p99 ? 'good' : ''],
        ['Alert errors: اكتشف بعد', det('err'), st.fired.err ? 'good' : '']
      ];
    }
  });

  Lab.registerLesson({
    id: 'observability', lab: 'system-design', title: 'Observability',
    html: Lab.tpl.lesson({
      sim: 'observability', level: 2,
      terms: ['Metrics', 'Logs', 'Distributed Tracing', 'p99', 'Alerting'],
      lede: 'الـ API بيخدم 60 request في الثانية. اضغط «Bad deploy»: 6% من طلبات POST /trips بقت بطيئة جدًا و6% بترجع 500 (حوالي 1.5% من كل الـ traffic). شوف أنهي alert بيكتشف المشكلة وبعد قد إيه، والـ trace بيقولك فين الوقت راح، والـ logs بتقولك ليه.',
      aria: 'محاكاة metrics و alerts و traces و logs وقت incident',
      acts: [['deploy', 'Bad deploy / Rollback']],
      idea: `
        <p><b>Metrics</b>: أرقام مجمّعة مع الوقت (عدد الـ requests، والـ errors، والـ latency). رخيصة وكويسة للـ alerts والـ dashboards، بس بتقولك «فيه مشكلة» مش «فين». <b>Logs</b>: أحداث بالتفصيل (مين، إيه، error). <b>Distributed Tracing</b>: رحلة request واحد عبر كل الخدمات، كل جزء (span) بوقته.</p>
        <p>الـ <b>Alerting</b> لازم يكون على الحاجة اللي المستخدم بيحس بيها، وعلى الـ <b>p99</b> مش المتوسط: 6% requests بطيئة جدًا بالكاد بتحرّك المتوسط، بس كل سواق بيقفل رحلات كتير هيقابلها.</p>`,
      real: `
        <p>Deploy جديد غيّر query في قفل الرحلات. أغلب الرحلات طبيعية، بس اللي فيها خصومات بتعمل table scan وتاخد ثانيتين ونص. الـ dashboard بتاع المتوسط شكله تمام، والـ alert على المتوسط مضربش. السواقين بيشتكوا إن التطبيق «بيهنّج ساعات». الـ p99 والـ trace كانوا هيوصّلوك للـ query في دقيقة.</p>`,
      try: 'اضغط «Bad deploy» واستنى: خط الـ avg (تركواز) بيطلع شوية بس، وخط الـ p99 (برتقالي) بيقفز فوق الثانية. الـ alert بتاع الـ avg مش بيضرب خالص، والـ p99 والـ errors بيضربوا عادةً بعد حوالي 30 ثانية (النافذة 30 ثانية لازم تتملي بالداتا الجديدة، وبعدين الشرط يفضل صح 10 ثواني). بص على الـ trace: الـ span الأحمر هو الـ query. واضغط تاني (rollback): الكل بيرجع ok.',
      also: 'بوابة دفع (p99 للتحويلات وerror rate لكل بنك)، وشات (تأخير توصيل الرسايل)، ولعبة (tick rate وlatency لكل منطقة). نفس القاعدة: alert على تجربة المستخدم، والباقي للتشخيص.',
      net: `
<pre><span class="c">// OpenTelemetry: traces + metrics لـ ASP.NET Core وHttpClient وSQL، وexport لأي backend</span>
builder.Services.AddOpenTelemetry()
    .WithTracing(t =&gt; t.AddAspNetCoreInstrumentation().AddHttpClientInstrumentation()
                       .AddSqlClientInstrumentation().AddOtlpExporter())
    .WithMetrics(m =&gt; m.AddAspNetCoreInstrumentation().AddRuntimeInstrumentation().AddOtlpExporter());

<span class="c">// logs structured بالـ trace id عشان تربطهم بالـ trace</span>
logger.LogWarning("Trip {TripId} close took {ElapsedMs} ms", trip.Id, sw.ElapsedMilliseconds);</pre>
<pre><span class="c"># Prometheus alert على الـ p99 مش المتوسط</span>
- alert: TripsCloseSlow
  expr: histogram_quantile(0.99, sum by (le) (rate(http_server_request_duration_seconds_bucket{route="/trips"}[5m]))) &gt; 1
  for: 5m</pre>`,
      netTitle: 'في .NET',
      deep: [
        '<b>RED و USE:</b> لكل خدمة: Rate وErrors وDuration (RED). لكل مورد (CPU، connections، queue): Utilization وSaturation وErrors (USE). دول بيغطوا أغلب الـ incidents.',
        '<b>الـ for clause:</b> الـ alert لازم يفضل صح فترة قبل ما يضرب، وإلا هيضرب على أي spike لحظي (alert fatigue)، والفريق هيبطّل يصدّق الـ alerts. التمن: الاكتشاف بيتأخر بنفس الفترة.',
        '<b>Percentiles مبتتجمعش:</b> متوسط الـ p99 بتاع 10 سيرفرات مش p99 النظام. لازم histograms (buckets) تتجمع وبعدين تحسب الـ quantile، زي <code>histogram_quantile</code>.',
        '<b>Sampling:</b> trace لكل request غالي. head sampling (عشوائي 1%) بيفوّت الـ requests النادرة البطيئة. tail sampling (احتفظ بالبطيء والفاشل) أحسن للتشخيص بس أعقد.',
        '<b>تبسيطات:</b> الـ alerts بتتقيم على آخر 30 ثانية ولازم تفضل صح 10 ثواني (الحقيقي غالبًا دقايق)، والـ trace هنا span لكل جزء من غير خدمات متعددة.'
      ]
    })
  });
})();
