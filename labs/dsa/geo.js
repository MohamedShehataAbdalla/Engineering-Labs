/* DSA · Geohash / QuadTree: أقرب 5 عربيات لنقطة
   N vehicles on a 40 × 40 km city map (spread evenly, or clustered around a few districts). A query point asks for
   the 5 nearest vehicles. Brute force measures the distance to every vehicle. Two real spatial indexes:
     QuadTree      a square splits into 4 when it holds more than `cap` vehicles; k-NN is best-first: visit cells in
                   order of their distance to the query, stop when the next cell is farther than the 5th best
     Geohash grid  fixed 2^p × 2^p cells (what a geohash prefix of a given length is); search the query's cell, then
                   rings of neighbours, until the 5th best is closer than the next ring
   Cells visited and distances computed are counted from the searches themselves. */
(function () {
  "use strict";
  const { clamp, lerp, fmt, f1 } = Lab.util;
  const { box, tx, dot, line, circ, alpha } = Lab.draw;

  const NS = [200, 500, 1000, 2000, 5000], K = 5, KM = 40, CELL_T = 0.11, HOLD = 2.6;

  function points(s) {
    const n = NS[s.p.n], rnd = s.rng, out = [];
    const centers = [[0.3, 0.35], [0.68, 0.3], [0.55, 0.72], [0.2, 0.78]];
    const gauss = () => { let u = 0; for (let i = 0; i < 6; i++) u += rnd(); return (u - 3) / 3; };
    for (let i = 0; i < n; i++) {
      if (s.p.spread === 'city' && rnd() < 0.85) { const c = centers[Math.floor(rnd() * centers.length)]; out.push({ x: clamp(c[0] + gauss() * 0.09, 0.001, 0.999), y: clamp(c[1] + gauss() * 0.09, 0.001, 0.999) }); }
      else out.push({ x: rnd(), y: rnd() });
    }
    return out;
  }

  /* ---------- QuadTree ---------- */
  function buildQT(pts, cap) {
    const root = { x: 0, y: 0, s: 1, pts: [], kids: null, depth: 0 };
    let maxDepth = 0, nodes = 1;
    const insert = (nd, p) => {
      if (nd.kids) { const h = nd.s / 2; insert(nd.kids[(p.x >= nd.x + h ? 1 : 0) + (p.y >= nd.y + h ? 2 : 0)], p); return; }
      nd.pts.push(p);
      if (nd.pts.length > cap && nd.depth < 10) {
        const h = nd.s / 2;
        nd.kids = [0, 1, 2, 3].map(i => ({ x: nd.x + (i & 1) * h, y: nd.y + (i >> 1) * h, s: h, pts: [], kids: null, depth: nd.depth + 1 }));
        nodes += 4; maxDepth = Math.max(maxDepth, nd.depth + 1);
        const old = nd.pts; nd.pts = []; for (const q of old) insert(nd, q);
      }
    };
    for (const p of pts) insert(root, p);
    return { root, maxDepth, nodes };
  }
  const rectDist = (r, q) => { const dx = Math.max(r.x - q.x, 0, q.x - (r.x + r.s)), dy = Math.max(r.y - q.y, 0, q.y - (r.y + r.s)); return Math.hypot(dx, dy); };
  function knnQT(qt, q) {
    const best = [], visited = [], pq = [[0, qt.root]]; let calcs = 0;
    const kth = () => best.length < K ? Infinity : best[K - 1].d;
    while (pq.length) {
      pq.sort((a, b) => a[0] - b[0]);
      const [d, nd] = pq.shift();
      if (d > kth()) break;
      visited.push(nd);
      if (nd.kids) { for (const c of nd.kids) pq.push([rectDist(c, q), c]); continue; }
      for (const p of nd.pts) { calcs++; const dd = Math.hypot(p.x - q.x, p.y - q.y); best.push({ p, d: dd }); best.sort((a, b) => a.d - b.d); if (best.length > K) best.pop(); }
    }
    return { best, visited: visited.filter(v => !v.kids), calcs };
  }

  /* ---------- Geohash-style fixed grid ---------- */
  function buildGrid(pts, cap) {
    const p = clamp(Math.round(Math.log(pts.length / cap) / Math.log(4)), 1, 7), G = 1 << p, cells = new Map();
    for (const pt of pts) { const k = Math.min(G - 1, Math.floor(pt.x * G)) + ',' + Math.min(G - 1, Math.floor(pt.y * G)); (cells.get(k) || cells.set(k, []).get(k)).push(pt); }
    return { G, bits: 2 * p, cells };
  }
  function knnGrid(g, q) {
    const cx = Math.min(g.G - 1, Math.floor(q.x * g.G)), cy = Math.min(g.G - 1, Math.floor(q.y * g.G)), cs = 1 / g.G;
    const best = [], visited = []; let calcs = 0;
    for (let r = 0; r < g.G; r++) {
      for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
        if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r || x < 0 || y < 0 || x >= g.G || y >= g.G) continue;
        visited.push({ x: x * cs, y: y * cs, s: cs });
        for (const p of g.cells.get(x + ',' + y) || []) { calcs++; const d = Math.hypot(p.x - q.x, p.y - q.y); best.push({ p, d }); best.sort((a, b) => a.d - b.d); if (best.length > K) best.pop(); }
      }
      // every cell in ring r+1 is at least r·cs away from the query
      if (best.length >= K && best[K - 1].d <= r * cs) break;
    }
    return { best, visited, calcs };
  }

  Lab.registerSim('geo', {
    height: 400, warm: 0,

    init(s) { s.st = {}; this.rebuild(s); },
    onParam(s) { this.rebuild(s); },

    rebuild(s) {
      const pts = points(s), cap = s.p.cap;
      s.st = { pts, qt: buildQT(pts, cap), grid: buildGrid(pts, cap), q: null, queries: 0, sum: 0 };
      this.query(s);
    },
    query(s) {
      const st = s.st, rnd = s.rng;
      // incidents happen where vehicles are: pick a spot near a random vehicle
      const a = st.pts[Math.floor(rnd() * st.pts.length)];
      const q = { x: clamp(a.x + (rnd() - 0.5) * 0.08, 0.01, 0.99), y: clamp(a.y + (rnd() - 0.5) * 0.08, 0.01, 0.99) };
      const res = s.p.index === 'grid' ? knnGrid(st.grid, q) : knnQT(st.qt, q);
      st.q = { q, res, t0: s.t, dur: res.visited.length * CELL_T };
      st.queries++; st.sum += res.calcs;
    },

    step(s) { const q = s.st.q; if (s.t - q.t0 > q.dur + HOLD) this.query(s); },

    draw(s) {
      const C = s.C, st = s.st, W = s.w, H = s.h, n = s.narrow, Q = st.q, res = Q.res;
      const side = Math.min(H - 20, n ? W - 28 : W * 0.56), mx = 14, my = 10;
      const X = v => mx + v * side, Y = v => my + v * side;
      box(mx, my, side, side, { r: 4, fill: C.surface, stroke: C.line });

      // index structure
      if (s.p.index === 'grid') {
        const G = st.grid.G;
        if (G <= 64) alpha(0.6, () => { for (let i = 1; i < G; i++) { line(X(i / G), my, X(i / G), my + side, C.line, 0.8); line(mx, Y(i / G), mx + side, Y(i / G), C.line, 0.8); } });
      } else {
        const walk = nd => { if (!nd.kids) return; const h = nd.s / 2; alpha(0.7, () => { line(X(nd.x + h), Y(nd.y), X(nd.x + h), Y(nd.y + nd.s), C.line, 0.9); line(X(nd.x), Y(nd.y + h), X(nd.x + nd.s), Y(nd.y + h), C.line, 0.9); }); nd.kids.forEach(walk); };
        walk(st.qt.root);
      }
      // cells the search has visited so far
      const e = s.t - Q.t0, shown = Math.min(res.visited.length, Math.floor(e / CELL_T) + 1);
      for (let i = 0; i < shown; i++) { const c = res.visited[i]; alpha(i === shown - 1 && shown < res.visited.length ? 0.45 : 0.18, () => box(X(c.x), Y(c.y), c.s * side, c.s * side, { r: 0, fill: C.violet, stroke: null })); }
      for (const p of st.pts) dot(X(p.x), Y(p.y), st.pts.length > 2000 ? 1.2 : 1.8, C.muted);
      const done = shown >= res.visited.length;
      if (done) {
        const r = res.best[K - 1].d * side;
        circ(X(Q.q.x), Y(Q.q.y), r, C.a2, 1.4);
        for (const b of res.best) { dot(X(b.p.x), Y(b.p.y), 4.5, C.a2); line(X(Q.q.x), Y(Q.q.y), X(b.p.x), Y(b.p.y), C.a2, 1); }
      }
      dot(X(Q.q.x), Y(Q.q.y), 5.5, C.accent); circ(X(Q.q.x), Y(Q.q.y), 9, C.accent, 1.6);

      if (n) {
        const y = my + side + 18;
        tx(`brute force: ${fmt(st.pts.length)} distances`, mx, y, { m: 1, s: 10.5, w: 700, a: 'left', c: C.bad });
        tx(`${s.p.index === 'grid' ? 'geohash grid' : 'quadtree'}: ${fmt(res.calcs)} distances · ${res.visited.length} cells`, mx, y + 20, { m: 1, s: 10.5, w: 700, a: 'left', c: C.good });
      }
      // side panel (wide only)
      if (!n) {
        const px = mx + side + 24, pw = W - 14 - px; let y = my + 8;
        const row = (label, val, c, big) => { tx(label, px, y, { m: 1, s: 10.5, a: 'left', c: C.muted }); tx(val, px + pw, y, { m: 1, s: big ? 14 : 11.5, w: 700, a: 'right', c: c || C.ink }); y += big ? 26 : 21; };
        tx('5 nearest vehicles to the incident', px, y, { m: 1, s: 12, w: 700, a: 'left', c: C.accent }); y += 26;
        row('brute force: distances', fmt(st.pts.length), C.bad, true);
        row((s.p.index === 'grid' ? 'geohash grid' : 'quadtree') + ': distances', fmt(res.calcs), C.good, true);
        row('cells visited', String(res.visited.length));
        if (s.p.index === 'grid') { row('grid', `${st.grid.G} × ${st.grid.G}  (${st.grid.bits}-bit geohash)`); row('busiest cell', fmt(Math.max(...[...st.grid.cells.values()].map(v => v.length))) + ' vehicles', C.accent); }
        else { row('tree nodes / depth', `${fmt(st.qt.nodes)} / ${st.qt.maxDepth}`); row('max per leaf', String(s.p.cap)); }
        if (done) row('5th nearest at', f1(res.best[K - 1].d * KM) + ' km', C.a2);
        y += 8;
        tx('violet = cells the search opened', px, y, { m: 1, s: 9.5, a: 'left', c: C.violet });
      }
    },

    stats(s) {
      const st = s.st, res = st.q.res;
      return [
        ['عدد العربيات', fmt(st.pts.length)],
        ['Brute force: حسابات مسافة', fmt(st.pts.length), 'bad'],
        ['الـ Index: حسابات مسافة', fmt(res.calcs), res.calcs < st.pts.length / 10 ? 'good' : 'warn'],
        ['متوسط آخر الاستعلامات', fmt(Math.round(st.sum / st.queries))],
        ['Cells اتفتحت', String(res.visited.length)],
        ['أبعد عربية من الـ 5', f1(res.best[K - 1].d * KM) + ' km']
      ];
    }
  });

  Lab.registerLesson({
    id: 'geo', lab: 'dsa', title: 'Geohash / QuadTree',
    html: Lab.tpl.lesson({
      sim: 'geo', level: 3,
      terms: ['QuadTree', 'Geohash', 'k-Nearest Neighbors', 'Spatial Index'],
      lede: 'خريطة مدينة 40×40 كم فيها عربيات، وحادثة حصلت (النقطة البرتقالي). عايزين أقرب 5 عربيات. الـ Brute force بيحسب المسافة لكل عربية، والـ index بيفتح المربعات القريبة بس (البنفسجي) لحد ما يتأكد إن مفيش أقرب.',
      aria: 'محاكاة بحث عن أقرب 5 عربيات باستخدام QuadTree و geohash grid',
      controls: [
        { type: 'seg', p: 'index', label: 'الـ Index', value: 'qt', opts: [['qt', 'QuadTree'], ['grid', 'Geohash grid']] },
        { type: 'seg', p: 'spread', label: 'توزيع العربيات', value: 'city', opts: [['city', 'متجمعة في أحياء'], ['even', 'متوزعة بالتساوي']] },
        { type: 'range', p: 'n', label: 'عدد العربيات', min: 0, max: 4, step: 1, value: 3, map: ['200', '500', '1,000', '2,000', '5,000'] },
        { type: 'range', p: 'cap', label: 'أقصى عدد في المربع', min: 2, max: 32, step: 2, value: 8 }
      ],
      idea: `
        <p>الـ index العادي (B-tree أو Hash) بيرتب على بُعد واحد. المكان بُعدين (lat و lng)، و«قريب من» مش «أكبر من». الـ <b>Spatial Index</b> بيقسم الخريطة لمربعات عشان تبص في المربعات القريبة بس.</p>
        <p><b>QuadTree</b>: أي مربع فيه عربيات أكتر من الحد بيتقسم 4. فالأحياء الزحمة مربعاتها صغيرة والصحرا مربع واحد كبير. <b>Geohash</b>: الخريطة متقسمة grid ثابت، وكل مربع ليه كود (string) وكل حرف زيادة بيصغّر المربع. المربعات المتجاورة غالبًا ليها نفس البداية (prefix)، فالبحث بيبقى «هات كل اللي كودهم بيبدأ بـ ...».</p>`,
      real: `
        <p>«ابعت أقرب 5 ونش للحادثة» أو «أقرب سواق فاضي للعميل» على 10,000 عربية كل ثانية: الـ brute force = 10,000 حساب مسافة لكل طلب. الـ index بيخليها عشرات.</p>
        <p>والعربيات بتتحرك، فالـ index لازم يتحدث مع كل نقطة GPS. ده أرخص في الـ grid الثابت (المربع بيتحسب من الإحداثيات مباشرة) منه في الـ QuadTree (ممكن مربع يتقسم أو يتدمج).</p>`,
      try: 'قارن «حسابات مسافة» بين الـ Brute force والـ index على 5,000 عربية. بعدين بدّل لـ «Geohash grid» مع «متجمعة في أحياء»: المربع اللي في نص الحي فيه مئات العربيات (busiest cell)، فالبحث بيحسب مسافات مئات العربيات حتى لو فتح 9 مربعات بس. الـ QuadTree بيتكيف مع الكثافة لأنه بيقسم على حسب العدد، فبيفضل عشرات. ومع «متوزعة بالتساوي» الاتنين قريبين من بعض.',
      also: 'أقرب مطعم في تطبيقات التوصيل، ومين حواليك في لعبة multiplayer (عشان تبعتلهم بس تحديثاتك)، وتغطية الأبراج في الاتصالات، والـ collision detection في الألعاب.',
      net: `
<pre><span class="c">-- SQL Server: geography + spatial index (grid من 4 مستويات)</span>
CREATE SPATIAL INDEX IX_Vehicles_Loc ON Vehicles(Location);
SELECT TOP (5) Id, Location.STDistance(@incident) AS Meters
FROM Vehicles
WHERE Location.STDistance(@incident) IS NOT NULL
ORDER BY Location.STDistance(@incident);   <span class="c">-- الشكل ده بيخلّي الـ optimizer يستخدم الـ index للـ nearest neighbor</span></pre>
<pre><span class="c">// Redis GEO (geohash 52-bit جوه sorted set) عن طريق StackExchange.Redis</span>
await db.GeoAddAsync("fleet", lng, lat, vehicleId);
var near = await db.GeoSearchAsync("fleet", lng, lat,
    new GeoSearchCircle(5, GeoUnit.Kilometers), count: 5, order: Order.Ascending);</pre>`,
      netTitle: 'في SQL Server و .NET',
      deep: [
        '<b>حدود المربع بتكذب:</b> أقرب عربية ممكن تكون في المربع اللي جنبك مش في مربعك. عشان كده البحث لازم يكمّل لحد ما يتأكد إن أي مربع لسه ما اتفتحش أبعد من الخامسة. بالـ geohash: دوّر في مربعك والـ 8 اللي حواليه على الأقل.',
        '<b>Geohash عند الحدود:</b> مربعين جنب بعض على الخريطة ممكن ميبقاش بينهم أي prefix مشترك، زي على جانبي خط جرينتش أو خط الاستوا. علشان كده البحث بيتعمل بالمربع وجيرانه الـ 8، مش بالـ prefix لوحده.',
        '<b>المسافة على الكرة:</b> المحاكاة هنا مسطحة (Euclidean). على الأرض لازم Haversine أو <code>geography</code> في SQL Server. والـ <code>geometry</code> type مسطح، ولو استخدمته بـ lat/lng هيدّيك مسافة بالدرجات مش بالمتر.',
        '<b>SQL Server spatial index:</b> مش QuadTree. هو grid هرمي بـ 4 مستويات (tessellation)، وكل شكل بيتسجل في الخلايا اللي بيغطيها، والنتيجة متخزنة في B-tree عادية. وفيه H3 (hexagons من Uber) وS2 (من Google) كبدائل.',
        '<b>تبسيطات:</b> الـ QuadTree بيتبني مرة واحدة والعربيات ثابتة وقت الاستعلام. والـ grid بيختار دقته بحيث متوسط العربيات في المربع قريب من «أقصى عدد في المربع».'
      ]
    })
  });
})();
