/* DSA · Dijkstra: أقصر طريق
   The city grid again, but every street now has a travel time: normal 1 min, congested ×4, and one highway row and
   column at 0.4 min. Two real shortest-path searches with a binary min-heap run side by side:
     Dijkstra  always settles the unsettled intersection with the smallest known time from the depot
     A*        same, but orders by time-so-far + an admissible estimate (Manhattan distance × fastest street time)
   Both return the optimal time; A* settles fewer intersections. The BFS route (fewest streets, blind to traffic) is
   computed too and drawn dashed, with its real travel time. Settled counts and times come from the runs. */
(function () {
  "use strict";
  const { clamp, fmt, f1 } = Lab.util;
  const { box, tx, dot, line, circ, alpha } = Lab.draw;

  const RATE = 10, HOLD = 3.5, FAST = 0.4, SLOW = 4;
  const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

  /* small binary min-heap of [priority, node] */
  class Heap {
    constructor() { this.a = []; this.pushes = 0; }
    get size() { return this.a.length; }
    push(p, v) {
      const a = this.a; a.push([p, v]); this.pushes++;
      let i = a.length - 1;
      while (i > 0) { const q = (i - 1) >> 1; if (a[q][0] <= a[i][0]) break; [a[q], a[i]] = [a[i], a[q]]; i = q; }
    }
    pop() {
      const a = this.a, top = a[0], last = a.pop();
      if (a.length) {
        a[0] = last; let i = 0;
        for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; }
      }
      return top;
    }
  }

  function build(s) {
    const C = s.narrow ? 9 : 16, R = 9, rnd = s.rng, p = s.p.traffic / 100;
    const id = (x, y) => y * C + x, w = new Map();
    const hwY = 1, hwX = C - 3;                              // the highway: one row and one column
    for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) {
      const set = (u, v, fast) => w.set(Math.min(u, v) + '|' + Math.max(u, v), fast ? FAST : rnd() < p ? SLOW : 1);
      if (x + 1 < C) set(id(x, y), id(x + 1, y), y === hwY);
      if (y + 1 < R) set(id(x, y), id(x, y + 1), x === hwX);
    }
    return { C, R, w, id, start: id(1, R - 2), goal: id(C - 2, R - 3) };
  }
  function nbrs(g, v) {
    const x = v % g.C, y = Math.floor(v / g.C), out = [];
    for (const [dx, dy] of DIRS) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= g.C || ny >= g.R) continue; const u = g.id(nx, ny); out.push([u, g.w.get(Math.min(u, v) + '|' + Math.max(u, v))]); }
    return out;
  }
  const manhattan = (g, a, b) => Math.abs(a % g.C - b % g.C) + Math.abs(Math.floor(a / g.C) - Math.floor(b / g.C));

  function* search(g, info, astar) {
    const dist = new Map([[g.start, 0]]), h = v => astar ? manhattan(g, v, g.goal) * FAST : 0;
    const pq = new Heap(); pq.push(h(g.start), g.start); info.pq = pq;
    info.parent = new Map(); info.settled = new Set(); info.dist = dist;
    while (pq.size) {
      const [, v] = pq.pop();
      if (info.settled.has(v)) continue;                     // stale heap entry (lazy deletion)
      info.settled.add(v); info.cur = v; yield v;
      if (v === g.goal) { info.found = true; info.time = dist.get(v); return; }
      for (const [u, wt] of nbrs(g, v)) {
        const nd = dist.get(v) + wt;
        if (nd < (dist.has(u) ? dist.get(u) : Infinity)) { dist.set(u, nd); info.parent.set(u, v); pq.push(nd + h(u), u); }
      }
    }
  }
  function bfsRoute(g) {
    const q = [g.start], par = new Map([[g.start, -1]]);
    for (let i = 0; i < q.length; i++) { const v = q[i]; if (v === g.goal) break; for (const [u] of nbrs(g, v)) if (!par.has(u)) { par.set(u, v); q.push(u); } }
    const p = []; for (let v = g.goal; v !== -1; v = par.get(v)) p.push(v);
    p.reverse();
    let t = 0; for (let i = 1; i < p.length; i++) t += g.w.get(Math.min(p[i], p[i - 1]) + '|' + Math.max(p[i], p[i - 1]));
    return { path: p, time: t };
  }
  function pathOf(g, info) { const p = [g.goal]; let v = g.goal; while (v !== g.start) { v = info.parent.get(v); p.push(v); } return p.reverse(); }

  Lab.registerSim('dijkstra', {
    height: 380, warm: 0,

    init(s) { s.st = {}; this.restart(s); },
    onParam(s) { this.restart(s); },

    restart(s) {
      const g = build(s);
      const mk = (name, astar) => { const info = { found: false, settled: new Set(), cur: -1 }; return { name, astar, info, gen: search(g, info, astar), done: false, path: null, n: 0 }; };
      s.st = { g, t0: s.t, bfs: bfsRoute(g), lanes: [mk('Dijkstra', false), mk('A*  (Dijkstra + estimate)', true)], tEnd: null, narrow: s.narrow };
    },

    step(s) {
      const st = s.st;
      if (st.narrow !== s.narrow) { this.restart(s); return; }
      const want = Math.floor((s.t - st.t0) * RATE) + 1;
      for (const L of st.lanes) while (!L.done && L.n < want) { const r = L.gen.next(); if (r.done) { L.done = true; L.path = pathOf(st.g, L.info); } else L.n++; }
      if (st.lanes.every(L => L.done)) { if (st.tEnd === null) st.tEnd = s.t; else if (s.t - st.tEnd > HOLD) this.restart(s); }
    },

    draw(s) {
      const C = s.C, st = s.st, g = st.g, W = s.w, H = s.h, n = s.narrow;
      const panels = n ? [[14, 30, W - 28, (H - 40) / 2 - 8], [14, 30 + (H - 40) / 2 + 8, W - 28, (H - 40) / 2 - 8]]
                       : [[14, 30, (W - 44) / 2, H - 44], [30 + (W - 44) / 2, 30, (W - 44) / 2, H - 44]];
      tx(n ? 'red = traffic ×4 · teal = highway' : 'street time: normal 1 min · red = traffic ×4 · teal = highway 0.4 min · dashed = BFS route (fewest streets)', 14, 12, { m: 1, s: n ? 8.5 : 10.5, a: 'left', c: C.muted });
      st.lanes.forEach((L, k) => {
        const [px, py, pw, ph] = panels[k], info = L.info;
        const gx = pw / g.C, gy = (ph - 22) / g.R;
        const P = v => ({ x: px + (v % g.C + 0.5) * gx, y: py + 22 + (Math.floor(v / g.C) + 0.5) * gy });
        box(px, py, pw, ph, { r: 8, fill: C.surface, stroke: C.line });
        tx(L.name, px + 10, py + 12, { m: 1, s: n ? 10 : 11.5, w: 700, a: 'left', c: k ? C.violet : C.a2 });
        tx(L.done ? `${f1(info.time)} min · settled ${info.settled.size}` : `settled ${info.settled.size} · heap ${info.pq ? info.pq.size : 0}`, px + pw - 10, py + 12, { m: 1, s: n ? 9 : 10.5, w: 600, a: 'right', c: L.done ? C.good : C.muted });
        for (const [key, wt] of g.w) {
          const [a, b] = key.split('|').map(Number), A = P(a), B = P(b);
          line(A.x, A.y, B.x, B.y, wt === SLOW ? C.bad : wt === FAST ? C.a2 : C.line, wt === SLOW ? 2.6 : wt === FAST ? 3 : 1.2);
        }
        const r = Math.max(2.5, Math.min(gx, gy) * 0.2);
        for (const v of info.settled) { const p = P(v); dot(p.x, p.y, r, k ? C.violet : C.a2); }
        if (info.pq && !L.done) for (const [, v] of info.pq.a) if (!info.settled.has(v)) { const p = P(v); circ(p.x, p.y, r, C.accent, 1.5); }
        // BFS route (fewest streets) for contrast, then the optimal route
        alpha(0.9, () => { const b = st.bfs.path; for (let i = 1; i < b.length; i++) { const A = P(b[i - 1]), B = P(b[i]); line(A.x, A.y, B.x, B.y, C.ink, 1.6, [4, 4]); } });
        if (L.path) for (let i = 1; i < L.path.length; i++) { const A = P(L.path[i - 1]), B = P(L.path[i]); line(A.x, A.y, B.x, B.y, C.accent, 3.4); }
        if (!L.done && info.cur >= 0) { const p = P(info.cur); dot(p.x, p.y, r + 2.5, C.accent); }
        const S = P(g.start), G = P(g.goal);
        dot(S.x, S.y, r + 3, C.ink); tx('depot', S.x, S.y + r + 10, { m: 1, s: 9, w: 700, c: C.ink });
        circ(G.x, G.y, r + 4, C.bad, 2.4); tx('customer', G.x, G.y + r + 11, { m: 1, s: 9, w: 700, c: C.bad });
      });
    },

    stats(s) {
      const st = s.st, [D, A] = st.lanes;
      return [
        ['Dijkstra: وقت الطريق', D.done ? f1(D.info.time) + ' min' : '…', 'good'],
        ['A*: وقت الطريق', A.done ? f1(A.info.time) + ' min' : '…', 'good'],
        ['BFS (أقل شوارع): وقته', `${f1(st.bfs.time)} min · ${st.bfs.path.length - 1} شارع`, D.done && st.bfs.time > D.info.time + 0.01 ? 'bad' : ''],
        ['تقاطعات اتحسمت (Dijkstra / A*)', `${D.info.settled.size} / ${A.info.settled.size}`],
        ['Heap pushes (Dijkstra / A*)', `${D.info.pq ? D.info.pq.pushes : 0} / ${A.info.pq ? A.info.pq.pushes : 0}`]
      ];
    }
  });

  Lab.registerLesson({
    id: 'dijkstra', lab: 'dsa', title: 'Dijkstra: أقصر طريق',
    html: Lab.tpl.lesson({
      sim: 'dijkstra', level: 3,
      terms: ['Dijkstra', 'Weighted Graph', 'Priority Queue', 'A*', 'Heuristic'],
      lede: 'نفس المدينة، بس كل شارع ليه وقت: عادي دقيقة، زحمة ×4 (أحمر)، وطريق سريع 0.4 دقيقة (تركواز). Dijkstra على الشمال و A* على اليمين بيدوّروا على أسرع طريق. الخط المتقطع هو طريق BFS (أقل عدد شوارع).',
      aria: 'محاكاة Dijkstra و A* على شبكة طرق فيها زحمة وطريق سريع',
      controls: [
        { type: 'range', p: 'traffic', label: 'شوارع زحمة', min: 0, max: 50, step: 5, value: 25, unit: '%' }
      ],
      idea: `
        <p>لما الـ edges ليها <b>وزن</b> (وقت، مسافة، تكلفة)، أقل عدد edges مش معناه أقصر طريق. <b>Dijkstra</b> بيحتفظ بأقل وقت معروف لكل تقاطع، وفي كل خطوة بيختار التقاطع اللي وقته أقل حاجة ولسه ما اتحسمش، يحسمه، ويحدّث جيرانه. عشان «هات الأقل» بسرعة بيستخدم <a href="#/dsa/heap">Priority Queue</a>.</p>
        <p><b>A*</b> نفس الفكرة بالظبط، بس بيرتب بـ «الوقت لحد هنا + تقدير للباقي». لو التقدير عمره ما بيزوّد عن الحقيقة (<b>admissible</b>)، بيوصل لنفس أحسن طريق وبيحسم تقاطعات أقل لأنه بيتجه ناحية الهدف.</p>`,
      real: `
        <p>توجيه السواق لأسرع طريق للعميل بناءً على الزحمة الحالية: BFS هيختار الطريق اللي فيه أقل شوارع حتى لو كله زحمة. Dijkstra هيلف على الطريق السريع لو أسرع.</p>
        <p>والتقدير في A* هنا: المسافة بالبلوكات × وقت أسرع شارع (الطريق السريع). ده عمره ما هيزوّد عن الحقيقة، فالنتيجة مضمونة صح.</p>`,
      try: 'قارن «BFS (أقل شوارع): وقته» بوقت Dijkstra: الـ BFS غالبًا أبطأ بكتير. ارفع الزحمة لـ 50% والفرق يكبر. وبص على «تقاطعات اتحسمت»: الـ A* بيحسم أقل من Dijkstra وبيوصل لنفس الوقت بالظبط. ونزّل الزحمة لـ 0%: الطريق السريع لوحده بيغيّر المسار.',
      also: 'أرخص طريق لـ packet في شبكة (OSPF بيستخدم Dijkstra)، وأقل رسوم تحويل بين عملات أو بنوك، وحركة الشخصيات في الألعاب (A* هو الأشهر هناك).',
      net: `
<pre><span class="c">// Dijkstra بـ PriorityQueue في .NET (مفيش decrease-key: ضيف تاني وتجاهل القديم)</span>
var dist = new Dictionary&lt;int, double&gt; { [depot] = 0 };
var parent = new Dictionary&lt;int, int&gt;();
var settled = new HashSet&lt;int&gt;();
var pq = new PriorityQueue&lt;int, double&gt;();
pq.Enqueue(depot, 0);
while (pq.TryDequeue(out var v, out _)) {
    if (!settled.Add(v)) continue;          <span class="c">// نسخة قديمة في الـ heap</span>
    if (v == customer) break;
    foreach (var (u, minutes) in roads[v]) {
        var nd = dist[v] + minutes;
        if (nd &lt; dist.GetValueOrDefault(u, double.MaxValue)) {
            dist[u] = nd; parent[u] = v;
            pq.Enqueue(u, nd);               <span class="c">// A*: pq.Enqueue(u, nd + Estimate(u))</span>
        }
    }
}</pre>`,
      netTitle: 'في .NET',
      deep: [
        '<b>الأوزان السالبة بتكسر Dijkstra:</b> هو بيفترض إن التقاطع اللي اتحسم مستحيل يلاقيله طريق أرخص بعدين. لو فيه edge سالب (خصم مثلًا) لازم Bellman-Ford، وهو O(V·E).',
        '<b>التعقيد:</b> مع binary heap هو O((V + E) log V). في خرايط الطرق V وE بالملايين، فحتى ده بطيء لكل request. خدمات الخرايط بتعمل preprocessing (Contraction Hierarchies) وبتجاوب في ميلي ثواني.',
        '<b>التقدير في A*:</b> لو بيزوّد عن الحقيقة (مثلًا المسافة × وقت شارع عادي بدل الطريق السريع)، A* هيبقى أسرع بس ممكن يرجّع طريق مش الأحسن. لو صفر، A* = Dijkstra بالظبط.',
        '<b>الزحمة بتتغير:</b> الأوزان هنا ثابتة وقت البحث. في الحقيقة وقت الشارع بيتغير على حسب الساعة اللي هتوصله فيها (time-dependent)، وده بيخلّي المشكلة أصعب.',
        '<b>تبسيطات:</b> grid منتظمة، والشوارع في الاتجاهين بنفس الوقت، و«الزحمة» عشوائية لكل شارع.'
      ]
    })
  });
})();
