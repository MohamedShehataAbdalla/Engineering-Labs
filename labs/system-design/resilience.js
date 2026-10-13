/* System Design · Timeout و Retry و Circuit Breaker
   Our API (20 worker slots, 30 requests/s) needs an ETA from a maps dependency: ~100 ms, 1% errors. Every 30 s the
   dependency hangs for 10 s (accepts the connection, never answers). Strategies, implemented attempt by attempt:
     no timeout      wait for the reply (a hang lasts until the 30 s client default)
     timeout         give up after 1 s
     timeout + retry retry immediately, 3 tries — during the outage every request becomes 3 calls
     + backoff       retries wait 200 ms, 400 ms… with random jitter
     + breaker       a circuit breaker: if ≥50% of the last 20 calls failed it opens for 5 s (calls fail instantly and
                     the request falls back to a cached ETA), then lets one trial call through (half-open)
   A request that finds no free slot is rejected (503). Success, latency, slot use and the load we put on the
   dependency are measured from the run. */
(function () {
  "use strict";
  const { clamp, lerp, fmt, f1, expo } = Lab.util;
  const { box, tx, line, alpha } = Lab.draw;

  const SLOTS = 20, RATE = 30, CYCLE = 30, OUT = 10, DEP = 0.1, HANG = 30, WIN = 10;

  function fresh(s) {
    s.st = { next: s.t + 0.05, reqs: [], log: [], calls: [], br: { state: 'closed', until: 0, hist: [] }, rejected: 0, fallback: 0, series: [] };
  }
  const depDown = t => (t % CYCLE) >= CYCLE - OUT;

  Lab.registerSim('resilience', {
    height: 380, warm: 3,
    init(s) { fresh(s); },
    onParam(s) { fresh(s); },

    /** start one attempt for request r at time t */
    attempt(s, r, t) {
      const st = s.st, m = s.p.mode, br = st.br;
      if (m === 'breaker') {
        if (br.state === 'open' && t < br.until) { r.done = t; r.ok = true; r.fb = true; st.fallback++; return; }
        if (br.state === 'open') br.state = 'half';
        if (br.state === 'half' && br.trial) { r.done = t; r.ok = true; r.fb = true; st.fallback++; return; }
        if (br.state === 'half') br.trial = true;
      }
      st.calls.push(t);
      const timeout = m === 'none' ? HANG : 1;
      if (depDown(t)) { r.wait = t + timeout; r.fail = true; }
      else { r.wait = t + DEP * (0.6 + s.rng() * 0.8); r.fail = s.rng() < 0.01; }
      r.tries++;
    },
    record(s, ok) {
      const br = s.st.br; br.hist.push(ok); if (br.hist.length > 20) br.hist.shift();
      if (br.state === 'half') { br.trial = false; if (ok) { br.state = 'closed'; br.hist = []; } else { br.state = 'open'; br.until = s.t + 5; } return; }
      if (br.hist.length >= 10 && br.hist.filter(x => !x).length / br.hist.length >= 0.5) { br.state = 'open'; br.until = s.t + 5; br.hist = []; }
    },

    step(s) {
      const st = s.st, t = s.t, m = s.p.mode;
      while (st.next <= t) {
        if (st.reqs.length >= SLOTS) { st.rejected++; st.log.push({ t, ok: false, lat: 0, rej: true }); }
        else { const r = { t0: st.next, tries: 0 }; st.reqs.push(r); this.attempt(s, r, t); }
        st.next += expo(RATE, s.rng);
      }
      const maxTries = m === 'none' || m === 'timeout' ? 1 : 3;
      st.reqs = st.reqs.filter(r => {
        if (r.done) { st.log.push({ t, ok: r.ok, lat: r.done - r.t0, fb: r.fb }); return false; }
        if (r.backoff && t >= r.backoff) { r.backoff = 0; this.attempt(s, r, t); return true; }
        if (r.backoff || t < r.wait) return true;
        if (m === 'breaker') this.record(s, !r.fail);
        if (!r.fail) { st.log.push({ t, ok: true, lat: t - r.t0 }); return false; }
        if (r.tries < maxTries) {
          if (m === 'retry') this.attempt(s, r, t);
          else r.backoff = t + 0.2 * Math.pow(2, r.tries - 1) * (0.5 + s.rng());
          return true;
        }
        st.log.push({ t, ok: false, lat: t - r.t0 }); return false;
      });
      st.log = st.log.filter(x => x.t > t - WIN); st.calls = st.calls.filter(x => x > t - 1);
      if (!st.lastS || t - st.lastS > 0.2) { st.lastS = t; st.series.push({ t, calls: st.calls.length, busy: st.reqs.length, down: depDown(t) }); if (st.series.length > 200) st.series.shift(); }
    },

    m(s) {
      const L = s.st.log, l = L.filter(x => !x.rej).map(x => x.lat).sort((a, b) => a - b);
      return { ok: L.length ? L.filter(x => x.ok).length / L.length : 1, p95: l.length ? l[Math.floor(l.length * 0.95)] : 0, rej: L.filter(x => x.rej).length, fb: L.filter(x => x.fb).length };
    },

    draw(s) {
      const C = s.C, st = s.st, t = s.t, W = s.w, H = s.h, n = s.narrow, br = st.br;
      const x0 = 14, x1 = W - 14, down = depDown(t);
      tx(down ? 'maps API is hanging (outage)' : 'maps API healthy', x0, 16, { m: 1, s: n ? 9.5 : 11.5, w: 700, a: 'left', c: down ? C.bad : C.good });
      if (s.p.mode === 'breaker') {
        const col = br.state === 'closed' ? C.good : br.state === 'open' ? C.bad : C.accent;
        tx(`circuit breaker: ${br.state === 'half' ? 'half-open' : br.state}`, x1, 16, { m: 1, s: n ? 9 : 11, w: 700, a: 'right', c: col });
      }
      // slots in use
      const sy = 34, sw = (x1 - x0) / SLOTS;
      for (let i = 0; i < SLOTS; i++) box(x0 + i * sw + 1, sy, sw - 2, 22, { r: 3, fill: i < st.reqs.length ? (st.reqs.length >= SLOTS ? C.bad : C.accent) : C.bg, stroke: null });
      tx(`worker slots busy: ${st.reqs.length} / ${SLOTS}`, x0, sy + 36, { m: 1, s: n ? 8.5 : 10, w: 700, a: 'left', c: st.reqs.length >= SLOTS ? C.bad : C.muted });
      // series: calls/s to the dependency and busy slots
      const gy = sy + 52, gh = H - gy - 34, se = st.series, maxC = Math.max(60, ...se.map(x => x.calls));
      box(x0, gy, x1 - x0, gh, { r: 6, fill: C.surface, stroke: C.line });
      se.forEach((p, i) => { if (p.down) { const x = lerp(x0, x1, i / 199); alpha(0.12, () => box(x, gy, (x1 - x0) / 199 + 1, gh, { r: 0, fill: C.bad, stroke: null })); } });
      const plot = (key, max, col) => { const X = s.ctx; X.beginPath(); se.forEach((p, i) => { const x = lerp(x0 + 4, x1 - 4, i / 199), y = lerp(gy + gh - 4, gy + 14, p[key] / max); if (i) X.lineTo(x, y); else X.moveTo(x, y); }); X.strokeStyle = col; X.lineWidth = 1.8; X.stroke(); };
      plot('calls', maxC, C.violet); plot('busy', SLOTS, C.accent);
      tx('calls/s to the maps API', x0 + 8, gy + 10, { m: 1, s: 9, a: 'left', c: C.violet });
      tx('our busy slots', x0 + 150, gy + 10, { m: 1, s: 9, a: 'left', c: C.accent });
      const m = this.m(s);
      tx(`ok ${f1(m.ok * 100)}% (fallback ${m.fb}) · p95 ${m.p95 >= 1 ? f1(m.p95) + ' s' : fmt(m.p95 * 1000) + ' ms'} · rejected ${m.rej} (last 10 s)`, x0, H - 12, { m: 1, s: n ? 8.5 : 11, w: 700, a: 'left', c: m.ok < 0.9 ? C.bad : m.ok < 0.99 ? C.accent : C.good });
    },

    stats(s) {
      const m = this.m(s), st = s.st, peak = Math.max(0, ...st.series.map(x => x.calls));
      return [
        ['نجاح (شامل fallback)', f1(m.ok * 100) + ' %', m.ok < 0.9 ? 'bad' : m.ok < 0.99 ? 'warn' : 'good'],
        ['p95', m.p95 >= 1 ? f1(m.p95) + ' s' : fmt(m.p95 * 1000) + ' ms', m.p95 > 1 ? 'bad' : m.p95 > 0.3 ? 'warn' : 'good'],
        ['Requests اترفضت (مفيش slots)', String(m.rej), m.rej ? 'bad' : 'good'],
        ['أعلى calls/s على الـ dependency', String(peak), peak > 60 ? 'bad' : peak > 35 ? 'warn' : ''],
        ['ردود من الـ fallback', String(m.fb)]
      ];
    }
  });

  Lab.registerLesson({
    id: 'resilience', lab: 'system-design', title: 'Timeout و Retry و Circuit Breaker',
    html: Lab.tpl.lesson({
      sim: 'resilience', level: 3,
      terms: ['Timeout', 'Retry', 'Exponential Backoff', 'Jitter', 'Circuit Breaker'],
      lede: 'الـ API بتاعنا محتاج ETA من Maps API خارجي. كل 30 ثانية الـ Maps API بيعلّق 10 ثواني (الخلفية الحمرا). فوق: الـ worker slots بتاعتنا (20). تحت: كام call بنضرب بيه الـ dependency (بنفسجي) وكام slot مشغول (برتقالي). جرّب الاستراتيجيات.',
      aria: 'محاكاة timeout و retry و circuit breaker قدام dependency بيقع',
      controls: [
        { type: 'seg', p: 'mode', label: 'الاستراتيجية', value: 'none', opts: [['none', 'من غير timeout'], ['timeout', 'Timeout 1 s'], ['retry', '+ Retry ×3'], ['backoff', '+ Backoff'], ['breaker', '+ Circuit breaker']] }
      ],
      idea: `
        <p><b>Timeout</b>: متستناش للأبد. من غير timeout، dependency معلّق بيمسك كل الـ threads بتاعتك وانت كمان بتقع. <b>Retry</b> بيعالج الأعطال اللحظية، بس لو الـ dependency واقع، كل retry حمل زيادة عليه (retry storm).</p>
        <p><b>Exponential Backoff</b> بيستنى أكتر بين كل محاولة والتانية، و<b>Jitter</b> (وقت عشوائي) بيمنع إن كل العملاء يرجعوا في نفس اللحظة. والـ <b>Circuit Breaker</b> بيلاحظ إن الـ dependency بايظ ويبطّل يناديه فترة (open): يرجع رد احتياطي (fallback) فورًا، وبعدين يجرّب call واحد (half-open) يشوف رجع ولا لأ.</p>`,
      real: `
        <p>Maps API عمل outage. الـ dispatch API كان بيستناه من غير timeout، فكل الـ threads اتمسكت في ثواني، وحتى الـ endpoints اللي ملهاش علاقة بالخرايط بقت ترد 503: عطل خارجي وقّع نظامنا كله. بعد ما حطّوا retry ×3 من غير backoff، المرة اللي بعدها ضربوا الـ Maps API بـ 3 أضعاف الحمل وهو بيحاول يقوم. الحل: timeout قصير، وretry بـ backoff وjitter، وcircuit breaker يرجّع آخر ETA متخزن.</p>`,
      try: 'ابدأ «من غير timeout» واستنى الـ outage: الـ slots الـ 20 بتتملي، والـ requests بتترفض، وبتفضل كده حتى بعد ما الـ dependency يرجع. «Timeout 1 s»: الـ slots بتفضى أسرع بس كل request وقت الـ outage فاشل. «Retry ×3»: كل request بيمسك الـ slot 3 ثواني بدل واحدة وقت الـ outage، فالمرفوض بيتضاعف تقريبًا (هنا الـ 20 slot بيحطوا سقف على الـ calls؛ من غير سقف، زي آلاف العملاء، البنفسجي كان هيتضرب في 3: ده الـ retry storm). «Backoff»: نفس المشكلة تقريبًا. «Circuit breaker»: النجاح بيرجع لحوالي 97% بالـ fallback، والـ calls على الـ dependency وقت العطل بتقف.',
      also: 'أي call لبوابة دفع أو بنك أو SMS provider أو shipping API. وجوه الـ microservices نفسها: service بطيئة بتوقّع اللي بينادوها في سلسلة (cascading failure).',
      net: `
<pre><span class="c">// Microsoft.Extensions.Http.Resilience (فوق Polly v8): timeout + retry بـ backoff وjitter + circuit breaker</span>
builder.Services.AddHttpClient&lt;MapsClient&gt;(c =&gt; c.BaseAddress = new(mapsUrl))
    .AddResilienceHandler("maps", b =&gt; b
        .AddTimeout(TimeSpan.FromSeconds(3))                       <span class="c">// الكل، شامل الـ retries</span>
        .AddRetry(new HttpRetryStrategyOptions { MaxRetryAttempts = 2, BackoffType = DelayBackoffType.Exponential, UseJitter = true })
        .AddCircuitBreaker(new HttpCircuitBreakerStrategyOptions { FailureRatio = 0.5, MinimumThroughput = 10, BreakDuration = TimeSpan.FromSeconds(5) })
        .AddTimeout(TimeSpan.FromSeconds(1)));                     <span class="c">// لكل محاولة</span>

<span class="c">// الـ fallback عند الـ caller</span>
try { eta = await maps.GetEtaAsync(trip, ct); }
catch (BrokenCircuitException) { eta = cache.LastEta(trip.VehicleId); }</pre>`,
      netTitle: 'في .NET',
      deep: [
        '<b>ترتيب الطبقات:</b> timeout لكل محاولة جوّا، والـ retry بيلفّها، والـ circuit breaker بيشوف كل محاولة، وtimeout إجمالي برّه الكل. لو الـ timeout الإجمالي أقل من مجموع المحاولات، الـ retries الأخيرة مش هتحصل أصلًا.',
        '<b>Retry بس للحاجات اللي ينفع تتعاد:</b> GET و PUT idempotent ماشي. POST «اعمل حجز» ممكن يتنفّذ مرتين لو الرد بس هو اللي ضاع. استخدم idempotency key أو متعملش retry.',
        '<b>Retry budget:</b> بدل «كل request يعيد 3 مرات»، حط حد إجمالي: الـ retries متعديش 10% من الـ requests. ده بيمنع الـ storm حتى من غير breaker.',
        '<b>الـ timeout القيمة الصح:</b> مبنية على الـ p99 الحقيقي للـ dependency (شوف <a href="#/networking/rtt">RTT و Jitter</a>)، مش رقم مدوّر. وعمر الـ timeout ما يبقى أطول من الـ timeout اللي العميل بتاعك هيستناه أصلًا.',
        '<b>تبسيطات:</b> الـ outage «تعليق» كامل 10 ثواني كل 30، والـ default من غير timeout 30 ثانية (HttpClient الافتراضي 100 ثانية، فالواقع أسوأ)، والـ fallback بيعتبر نجاح.'
      ]
    })
  });
})();
