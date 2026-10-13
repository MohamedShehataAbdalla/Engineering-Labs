/* System Design · CDN
   Dispatchers in four regions load map tiles (2,000 tiles, Zipf-popular: everyone looks at the same cities) from an
   origin in Frankfurt. Round trips (typical, approximate): user↔nearby edge 15 ms; user/edge↔origin from Cairo 60,
   Riyadh 90, Mumbai 130, São Paulo 200 ms.
     no CDN   every request crosses to the origin
     CDN      each region has an edge with its own LRU cache (TTL'd). Hit → served locally; miss → the edge fetches
              from the origin (one more round trip), stores it, answers
   "Purge" empties every edge (what a deploy with new tile styles does) and the origin takes the whole load again.
   Latency per region, edge hit ratio and origin load come from the run (one round trip per request, keep-alive). */
(function () {
  "use strict";
  const { clamp, lerp, fmt, f1, expo } = Lab.util;
  const { box, tx, dot, circ, line, alpha } = Lab.draw;

  const TILES = 2000, RATE = 80, EDGE = 15, SIZE_KB = 25, WIN = 6;
  const REG = [
    { name: 'Cairo', rtt: 60, x: 0.42, y: 0.55 }, { name: 'Riyadh', rtt: 90, x: 0.64, y: 0.72 },
    { name: 'Mumbai', rtt: 130, x: 0.86, y: 0.5 }, { name: 'São Paulo', rtt: 200, x: 0.12, y: 0.78 }
  ];
  const ORIGIN = { x: 0.5, y: 0.12 };   // positions are a schematic, not a map
  const cdf = (() => { const w = []; let s = 0; for (let i = 1; i <= TILES; i++) { s += 1 / Math.pow(i, 0.9); w.push(s); } return w.map(v => v / s); })();
  function tile(rnd) { const r = rnd(); let lo = 0, hi = TILES - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cdf[m] < r) lo = m + 1; else hi = m; } return lo; }

  function fresh(s) { s.st = { next: s.t, edges: REG.map(() => new Map()), log: [], fly: [], originLog: [] }; }

  Lab.registerSim('cdn', {
    height: 380, warm: 8,
    init(s) { fresh(s); },
    onParam(s, k) { if (k === 'cdn') fresh(s); s.st.log = []; },
    act: { purge(s) { s.st.edges.forEach(e => e.clear()); s.st.purged = s.t; } },

    step(s) {
      const st = s.st, t = s.t, cdn = s.p.cdn === 'on';
      while (st.next <= t) {
        const r = Math.floor(s.rng() * REG.length), k = tile(s.rng), R = REG[r];
        let ms, hit = false, origin = false;
        if (!cdn) { ms = R.rtt; origin = true; }
        else {
          const e = st.edges[r], c = e.get(k);
          if (c && c > t) { hit = true; ms = EDGE; e.delete(k); e.set(k, c); }
          else {
            ms = EDGE + R.rtt; origin = true;
            e.delete(k); e.set(k, t + s.p.ttl);
            while (e.size > s.p.size) e.delete(e.keys().next().value);
          }
        }
        ms *= 0.85 + s.rng() * 0.3;
        st.log.push({ t, r, ms, hit });
        if (origin) st.originLog.push(t);
        st.fly.push({ r, t, hit, origin });
        st.next += expo(RATE, s.rng);
      }
      st.log = st.log.filter(x => x.t > t - WIN);
      st.originLog = st.originLog.filter(x => x > t - WIN);
      st.fly = st.fly.filter(f => t - f.t < 0.5);
    },

    reg(s, i) { const L = s.st.log.filter(x => x.r === i); return { avg: L.length ? L.reduce((a, x) => a + x.ms, 0) / L.length : 0, hit: L.length ? L.filter(x => x.hit).length / L.length : 0 }; },

    draw(s) {
      const C = s.C, st = s.st, W = s.w, H = s.h, n = s.narrow, cdn = s.p.cdn === 'on', t = s.t;
      const P = p => ({ x: 14 + p.x * (W - 28), y: 20 + p.y * (H - 80) });
      const o = P(ORIGIN), oLoad = st.originLog.length / WIN;
      // origin
      box(o.x - 58, o.y - 20, 116, 40, { r: 8, fill: C.surface, stroke: oLoad > 60 ? C.bad : C.violet, lw: 2 });
      tx('origin · Frankfurt', o.x, o.y - 6, { m: 1, s: 9.5, w: 700, c: C.violet });
      tx(`${fmt(oLoad)} req/s`, o.x, o.y + 9, { m: 1, s: 9, c: oLoad > 60 ? C.bad : C.muted });
      REG.forEach((R, i) => {
        const p = P(R), e = st.edges[i], rs = this.reg(s, i);
        alpha(0.3, () => line(p.x, p.y, o.x, o.y + 20, C.line, 1, [4, 4]));
        if (cdn) { circ(p.x, p.y, 26, C.a2, 2); tx(`edge ${e.size}`, p.x, p.y - 34, { m: 1, s: 8.5, c: C.a2 }); }
        dot(p.x, p.y, 6, C.accent);
        tx(R.name, p.x, p.y + 14, { m: 1, s: n ? 9 : 10.5, w: 700, c: C.ink });
        tx(`${fmt(rs.avg)} ms${cdn ? ` · hit ${fmt(rs.hit * 100)}%` : ''}`, p.x, p.y + 28, { m: 1, s: n ? 8 : 9.5, w: 700, c: rs.avg > 100 ? C.bad : rs.avg > 40 ? C.accent : C.good });
      });
      for (const f of st.fly) {
        const p = P(REG[f.r]), k = (t - f.t) / 0.5;
        if (f.hit) { const a = k * Math.PI * 2; dot(p.x + Math.cos(a) * 16, p.y + Math.sin(a) * 16, 2.6, C.a2); }
        else { const kk = k < 0.5 ? k * 2 : 2 - k * 2; dot(lerp(p.x, o.x, kk), lerp(p.y, o.y + 20, kk), 2.6, cdn ? C.accent : C.violet); }
      }
      if (st.purged && t - st.purged < 3) tx('all edges purged: every tile is a miss again', W - 14, H - 34, { m: 1, s: 10, w: 700, a: 'right', c: C.bad });
      const all = st.log, avg = all.length ? all.reduce((a, x) => a + x.ms, 0) / all.length : 0;
      tx(`average ${fmt(avg)} ms · origin ${fmt(oLoad)} req/s (${f1(oLoad * SIZE_KB * 8 / 1000)} Mbit/s out of Frankfurt)`, 14, H - 14, { m: 1, s: n ? 8.5 : 11, w: 700, a: 'left', c: avg > 80 ? C.bad : C.good });
    },

    stats(s) {
      const st = s.st, L = st.log, oLoad = st.originLog.length / WIN, hit = L.length ? L.filter(x => x.hit).length / L.length : 0;
      const sp = this.reg(s, 3);
      return [
        ['Edge hit ratio', s.p.cdn === 'on' ? f1(hit * 100) + ' %' : '—', hit > 0.8 ? 'good' : hit > 0.5 ? 'warn' : ''],
        ['Requests على الـ origin', fmt(oLoad) + ' /s', oLoad > 60 ? 'bad' : oLoad > 20 ? 'warn' : 'good'],
        ['Bandwidth من الـ origin', f1(oLoad * SIZE_KB * 8 / 1000) + ' Mbit/s'],
        ['São Paulo: متوسط', fmt(sp.avg) + ' ms', sp.avg > 100 ? 'bad' : sp.avg > 40 ? 'warn' : 'good'],
        ['الكل: متوسط', fmt(L.length ? L.reduce((a, x) => a + x.ms, 0) / L.length : 0) + ' ms']
      ];
    }
  });

  Lab.registerLesson({
    id: 'cdn', lab: 'system-design', title: 'CDN',
    html: Lab.tpl.lesson({
      sim: 'cdn', level: 2,
      terms: ['CDN', 'Edge', 'Origin', 'Cache-Control', 'Purge'],
      lede: 'dispatchers في 4 مناطق بيحمّلوا map tiles من سيرفر في فرانكفورت. من غير CDN كل request بيعدّي البحر. مع CDN كل منطقة عندها edge قريب (الدايرة) بيرد من الـ cache بتاعه (النقط اللي بتلف)، وبيروح للـ origin بس لو مش عنده.',
      aria: 'محاكاة CDN edges في مناطق مختلفة قدام origin واحد',
      acts: [['purge', 'Purge (deploy جديد)']],
      controls: [
        { type: 'seg', p: 'cdn', label: 'CDN', value: 'off', opts: [['off', 'من غير'], ['on', 'مع CDN']] },
        { type: 'range', p: 'ttl', label: 'TTL على الـ edge', min: 5, max: 600, step: 5, value: 300, unit: 's' },
        { type: 'range', p: 'size', label: 'سعة كل edge', min: 50, max: 2000, step: 50, value: 500, unit: 'tiles' }
      ],
      idea: `
        <p>الـ <b>CDN</b> شبكة سيرفرات (<b>Edges</b>) موزّعة في العالم بتحتفظ بنسخ من الملفات قريب من المستخدمين. الـ request بيروح لأقرب edge؛ لو الملف عنده يرد على طول (RTT قصير)، لو لأ يجيبه من السيرفر الأصلي (<b>Origin</b>) مرة ويحتفظ بيه.</p>
        <p>المكسب اتنين: latency أقل (الضوء له سرعة، فالمسافة هي الـ RTT)، والـ origin بيشيل جزء صغير من الحمل والـ bandwidth. السيرفر بيقول للـ CDN يحتفظ بالملف قد إيه بـ <b>Cache-Control</b>. ولما تنزّل نسخة جديدة، إما <b>Purge</b> (امسح من كل الـ edges) أو اسم ملف جديد.</p>`,
      real: `
        <p>ملفات الخريطة وJavaScript الـ dashboard بيتحملوا من فرانكفورت لمستخدمين في الرياض وبومباي وساو باولو. من غير CDN، كل tile فيها RTT طويل والخريطة بتظهر حتة حتة. مع CDN، أشهر المناطق موجودة على edge في نفس البلد: 15 ms بدل 130، والـ origin بيبعت جزء صغير من الـ traffic.</p>`,
      try: 'سيبها من غير CDN: ساو باولو حوالي 200 ms والـ origin شايل الحمل كله. شغّل CDN: بعد ثواني الـ hit بيطلع والـ latency بينزل. اضغط Purge: الـ origin بيتضرب لحظة والـ latency بيرجع يطلع لحد ما الـ edges تتملي. وصغّر سعة الـ edge لـ 50: الـ hit بيقل.',
      also: 'صور المنتجات في e-commerce، وفيديوهات البث (chunks على الـ edge)، وتحديثات الألعاب (ملفات ضخمة لملايين في نفس اللحظة)، وحتى APIs: بعض ردود الـ GET العامة ممكن تتعمل لها cache على الـ edge لثواني.',
      net: `
<pre><span class="c">// static files بأسماء فيها hash: cache لمدة سنة، والـ deploy بيغيّر الاسم بدل الـ purge</span>
app.UseStaticFiles(new StaticFileOptions {
    OnPrepareResponse = ctx =&gt; ctx.Context.Response.Headers.CacheControl = "public,max-age=31536000,immutable"
});

<span class="c">// API response ينفع يتعمله cache على الـ CDN 30 ثانية</span>
[HttpGet("tiles/{z}/{x}/{y}")]
[ResponseCache(Duration = 30, Location = ResponseCacheLocation.Any)]
public IActionResult Tile(int z, int x, int y) =&gt; File(tiles.Get(z, x, y), "image/png");</pre>`,
      netTitle: 'في ASP.NET Core',
      deep: [
        '<b>متعملش cache لحاجة شخصية:</b> لو response فيه بيانات مستخدم معيّن واتعمله cache على الـ edge بـ <code>public</code>، المستخدم التاني ممكن يشوفه. <code>private</code> أو <code>no-store</code> لأي حاجة مرتبطة بـ auth.',
        '<b>Cache key:</b> الـ CDN بيفرّق الملفات بالـ URL (وأحيانًا headers زي Accept-Encoding). query string عشوائية (<code>?t=123</code>) بتخلّي كل request miss.',
        '<b>Purge مش فوري ومش مجاني:</b> بيوصل لكل الـ edges في ثواني لدقايق، وبعده الـ origin بياخد موجة misses. أسماء الملفات بالـ hash (<code>app.3f9a.js</code>) بتلغي الحاجة للـ purge خالص.',
        '<b>Origin shield:</b> طبقة cache في النص بين الـ edges والـ origin: بدل ما 200 edge يسألوا الـ origin عن نفس الملف، بيسألوا الـ shield والـ shield بيسأل مرة.',
        '<b>تبسيطات:</b> round trip واحد لكل request (connections مفتوحة)، و4 edges بس، والـ RTTs تقريبية. الحقيقي فيه TLS handshakes أقصر لأن الـ edge قريب، وده مكسب إضافي.'
      ]
    })
  });
})();
