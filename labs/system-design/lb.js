/* System Design · Load Balancer و Horizontal/Vertical Scaling
   API requests arrive at random (Poisson) and a load balancer sends each one to a server. Every server works its own
   FIFO queue, one request at a time; service time is random around 50 ms ÷ server size, and the "degraded" server
   (noisy neighbour, bad disk) is 3× slower. Algorithms, as implemented here:
     round robin        next server in turn, blind to load
     random             any server
     least connections  the server with the fewest requests queued or in progress
     power of two       pick two at random, send to the less loaded one
   Simulated at 1/4 speed. Latency (queue wait + service), utilisation and queue lengths come from the run. */
(function () {
  "use strict";
  const { clamp, lerp, fmt, f1, expo } = Lab.util;
  const { box, tx, dot, ring, line, alpha } = Lab.draw;

  const BASE = 0.05, SPEED = 0.25, WIN = 20;

  function fresh(s) {
    s.st = { now: 0, next: 0, rr: 0, lat: [], fly: [], dropped: 0,
      sv: Array.from({ length: s.p.n }, (_, i) => ({ q: [], cur: null, end: 0, busy: 0, done: 0, slow: i === 0 && s.p.slow })) };
  }
  function pick(s) {
    const st = s.st, sv = st.sv, alg = s.p.alg, load = v => v.q.length + (v.cur ? 1 : 0);
    if (alg === 'rr') { const i = st.rr % sv.length; st.rr++; return i; }
    if (alg === 'random') return Math.floor(s.rng() * sv.length);
    if (alg === 'least') { let b = 0; sv.forEach((v, i) => { if (load(v) < load(sv[b])) b = i; }); return b; }
    const a = Math.floor(s.rng() * sv.length); let c = Math.floor(s.rng() * (sv.length - 1)); if (c >= a) c++;
    return load(sv[a]) <= load(sv[c]) ? a : c;
  }

  Lab.registerSim('lb', {
    height: 380, warm: 4,
    init(s) { fresh(s); },
    onParam(s, k) { if (k === 'n' || k === 'slow') fresh(s); },

    step(s, dt) {
      const st = s.st, end = st.now + dt * SPEED;
      while (st.now < end) {
        const h = Math.min(0.002, end - st.now), t = st.now = st.now + h;
        while (st.next <= t) {
          const i = pick(s), v = st.sv[i];
          if (v.q.length > 300) st.dropped++; else { v.q.push({ arr: st.next }); st.fly.push({ i, t: st.next }); }
          st.next += expo(s.p.rate, s.rng);
        }
        for (const v of st.sv) {
          if (v.cur && t >= v.end) { st.lat.push([t, t - v.cur.arr]); v.done++; v.cur = null; }
          if (!v.cur && v.q.length) { v.cur = v.q.shift(); v.end = t + expo(1, s.rng) * BASE * (v.slow ? 3 : 1) / s.p.size; }
          if (v.cur) v.busy += h;
        }
      }
      st.lat = st.lat.filter(x => x[0] > st.now - WIN);
      st.fly = st.fly.filter(f => st.now - f.t < 0.12);
    },

    m(s) {
      const l = s.st.lat.map(x => x[1]).sort((a, b) => a - b);
      return { p50: l.length ? l[Math.floor(l.length / 2)] : 0, p95: l.length ? l[Math.floor(l.length * 0.95)] : 0, thr: l.length / Math.min(WIN, Math.max(1, s.st.now)) };
    },

    draw(s) {
      const C = s.C, st = s.st, W = s.w, H = s.h, n = s.narrow, N = st.sv.length;
      const lbX = 14, lbW = n ? 64 : 110, sx = lbW + (n ? 60 : 120), sw = W - 14 - sx, rowH = (H - 70) / N;
      const names = { rr: 'round robin', random: 'random', least: 'least connections', p2c: 'power of two' };
      box(lbX, H / 2 - 40, lbW, 80, { r: 10, fill: C.surface, stroke: C.violet, lw: 2 });
      tx('load', lbX + lbW / 2, H / 2 - 12, { m: 1, s: n ? 9 : 11, w: 700, c: C.violet });
      tx('balancer', lbX + lbW / 2, H / 2 + 2, { m: 1, s: n ? 9 : 11, w: 700, c: C.violet });
      tx(names[s.p.alg], lbX + lbW / 2, H / 2 + 22, { m: 1, s: n ? 7.5 : 9, c: C.muted });
      tx(`${s.p.rate} req/s in · capacity ${f1(st.sv.reduce((a, v) => a + s.p.size / (BASE * (v.slow ? 3 : 1)), 0))} req/s`, 14, 16, { m: 1, s: n ? 8.5 : 10.5, w: 700, a: 'left', c: C.muted });
      st.sv.forEach((v, i) => {
        const y = 34 + i * rowH, h = rowH - 8, load = v.q.length + (v.cur ? 1 : 0), util = st.now ? v.busy / st.now : 0;
        alpha(0.35, () => line(lbX + lbW, H / 2, sx, y + h / 2, C.line, 1));
        box(sx, y, sw, h, { r: 8, fill: C.surface, stroke: v.slow ? C.bad : load > 10 ? C.accent : C.line, lw: v.slow ? 2 : 1 });
        tx(`server ${i + 1}${v.slow ? ' (degraded ×3)' : ''}`, sx + 10, y + 12, { m: 1, s: n ? 8.5 : 10, w: 700, a: 'left', c: v.slow ? C.bad : C.ink });
        tx(`util ${fmt(util * 100)}% · queue ${v.q.length}`, sx + sw - 10, y + 12, { m: 1, s: n ? 8 : 9.5, a: 'right', c: util > 0.9 ? C.bad : C.muted });
        if (v.cur) ring(sx + 18, y + h / 2 + 5, 7, 1 - (v.end - st.now) / (BASE * (v.slow ? 3 : 1) / s.p.size), C.accent, 2.5);
        const shown = Math.min(v.q.length, Math.floor((sw - 50) / 7));
        for (let k = 0; k < shown; k++) dot(sx + 36 + k * 7, y + h / 2 + 5, 2.6, v.q[k] && st.now - v.q[k].arr > 0.5 ? C.bad : C.accent);
      });
      for (const f of st.fly) { const k = (st.now - f.t) / 0.12, y = 34 + f.i * rowH + (rowH - 8) / 2; dot(lerp(lbX + lbW, sx, k), lerp(H / 2, y, k), 3.5, C.accent); }
      const m = this.m(s);
      tx(`latency p50 ${fmt(m.p50 * 1000)} ms · p95 ${fmt(m.p95 * 1000)} ms`, 14, H - 12, { m: 1, s: n ? 9 : 11, w: 700, a: 'left', c: m.p95 > 0.5 ? C.bad : m.p95 > 0.2 ? C.accent : C.good });
    },

    stats(s) {
      const st = s.st, m = this.m(s), utils = st.sv.map(v => st.now ? v.busy / st.now : 0);
      return [
        ['Latency p95', fmt(m.p95 * 1000) + ' ms', m.p95 > 0.5 ? 'bad' : m.p95 > 0.2 ? 'warn' : 'good'],
        ['Latency p50', fmt(m.p50 * 1000) + ' ms'],
        ['أعلى / أقل استغلال', `${fmt(Math.max(...utils) * 100)}% / ${fmt(Math.min(...utils) * 100)}%`, Math.max(...utils) > 0.95 ? 'bad' : ''],
        ['أطول طابور', String(Math.max(...st.sv.map(v => v.q.length))), Math.max(...st.sv.map(v => v.q.length)) > 30 ? 'bad' : ''],
        ['Throughput', f1(m.thr) + ' req/s']
      ];
    }
  });

  Lab.registerLesson({
    id: 'lb', lab: 'system-design', title: 'Load Balancer و Scaling',
    html: Lab.tpl.lesson({
      sim: 'lb', level: 2,
      terms: ['Load Balancer', 'Round Robin', 'Least Connections', 'Horizontal Scaling', 'Vertical Scaling'],
      lede: 'requests بتدخل على load balancer وبيوزّعها على السيرفرات. كل سيرفر عنده طابور (النقط) وبيخدم request واحد في المرة (الدايرة). السيرفر الأول ممكن يبقى «تعبان» (أبطأ 3 مرات). جرّب الخوارزميات وشوف مين بيلاحظ.',
      aria: 'محاكاة load balancer بيوزّع requests على سيرفرات بخوارزميات مختلفة',
      controls: [
        { type: 'seg', p: 'alg', label: 'خوارزمية التوزيع', value: 'rr', opts: [['rr', 'Round robin'], ['random', 'Random'], ['least', 'Least connections'], ['p2c', 'Power of two']] },
        { type: 'seg', p: 'slow', label: 'سيرفر 1 تعبان', value: 'true', opts: [['true', 'آه'], ['false', 'لأ']] },
        { type: 'range', p: 'n', label: 'عدد السيرفرات (horizontal)', min: 2, max: 8, step: 1, value: 4 },
        { type: 'range', p: 'size', label: 'قوة السيرفر (vertical)', min: 0.5, max: 3, step: 0.25, value: 1, unit: '×' },
        { type: 'range', p: 'rate', label: 'Requests في الثانية', min: 10, max: 150, step: 5, value: 50 }
      ],
      idea: `
        <p>الـ <b>Load Balancer</b> نقطة دخول واحدة بتوزّع الشغل على كذا سيرفر. <b>Round Robin</b> بيلف عليهم بالدور من غير ما يعرف حالتهم. <b>Least Connections</b> بيبعت للأقل شغل دلوقتي. <b>Power of two</b> بيختار اتنين عشوائي ويبعت للأخف: تقريبًا نفس جودة least connections من غير ما يتابع كل السيرفرات.</p>
        <p>لما الحمل يزيد: <b>Vertical Scaling</b> = سيرفر أكبر (بسيط، بس ليه سقف وغالي ونقطة فشل واحدة). <b>Horizontal Scaling</b> = سيرفرات أكتر ورا الـ LB (من غير سقف تقريبًا، بس التطبيق لازم يكون stateless).</p>`,
      real: `
        <p>4 سيرفرات API لتطبيق السواقين، وواحد فيهم على نفس الـ host مع VM تانية بتاكل الـ CPU. الـ Round Robin بيدّيه نفس الحصة، فطابوره بيكبر للأبد، وربع الـ requests (كل اللي بيروحوله) بتاخد ثواني. المتوسط شكله مقبول، والـ p95 كارثة. Least connections بيلاحظ الطابور ويبعد عنه لوحده.</p>`,
      try: 'سيبها على Round robin والسيرفر التعبان: طابوره بيكبر من غير حد والـ p95 بيطلع. بدّل لـ Least connections: نفس السيرفرات والـ p95 بيرجع طبيعي. Power of two: قريب منه. بعدين شيل السيرفر التعبان وارفع الـ requests لـ 75: زوّد السيرفرات (horizontal) أو قوة السيرفر (vertical) وشوف الاتنين بيحلوها.',
      also: 'توزيع المكالمات على موظفين في call center، وتوزيع الـ jobs على workers، وDNS بيرجّع كذا IP (round robin على مستوى DNS)، والـ GSLB بيوزّع على data centers.',
      net: `
<pre><span class="c">// YARP: reverse proxy / load balancer مكتوب بـ .NET</span>
builder.Services.AddReverseProxy().LoadFromConfig(builder.Configuration.GetSection("ReverseProxy"));
app.MapReverseProxy();</pre>
<pre>"Clusters": {
  "api": {
    "LoadBalancingPolicy": "LeastRequests",        <span class="c">// أو RoundRobin / PowerOfTwoChoices / Random</span>
    "HealthCheck": { "Active": { "Enabled": true, "Path": "/health", "Interval": "00:00:05" } },
    "Destinations": { "a": { "Address": "http://api-1:8080" }, "b": { "Address": "http://api-2:8080" } }
  }
}</pre>`,
      netTitle: 'في .NET (YARP)',
      deep: [
        '<b>Health checks مش كفاية:</b> السيرفر التعبان هنا بيرد على <code>/health</code> عادي، بس بطيء. الـ health check بيشيل السيرفرات الميتة؛ اللي بيشيل البطيئة هو خوارزمية بتشوف الحمل (least requests) أو outlier detection بالـ latency.',
        '<b>L4 مقابل L7:</b> L4 balancer بيوزع TCP connections (رخيص وسريع، مش شايف الـ requests). L7 بيفهم HTTP: بيوزّع كل request، ويعمل routing بالـ path، وretries. مع HTTP/2 وconnections طويلة، L4 بيوزّع وحش (connection واحد عليه آلاف requests).',
        '<b>الـ LB نفسه SPOF:</b> لازم يبقى أكتر من واحد (active/active أو active/passive بـ IP عائم) أو خدمة managed. شوف <a href="#/system-design/spof">Single Point of Failure</a>.',
        '<b>Least connections وسيرفر بيفشل بسرعة:</b> سيرفر بايظ بيرجّع 500 في 1 ms هيبان «فاضي» دايمًا، والـ LB هيبعتله كل حاجة. محتاج تحسب الأخطاء مش الحمل بس.',
        '<b>تبسيطات:</b> كل سيرفر بيخدم request واحد في المرة (الحقيقي كذا core وthread)، ووقت الخدمة exponential حوالين 50 ms، والـ LB مالوش تأخير.'
      ]
    })
  });
})();
