/* DSA · Graph: BFS و DFS
   A city as a grid graph: intersections are nodes, street segments are edges, some streets are closed.
   Two real traversals start from the depot on the same graph and spend one "visit" per tick each:
     BFS  Queue<T>: visits by distance (1 street away, then 2, …) → the first path to the customer has the fewest streets
     DFS  Stack<T>: follows one street as deep as it can, backtracks when stuck → finds *a* path, often a long one
   Visited counts, frontier sizes and path lengths are the traversals' own. */
(function () {
  "use strict";
  const { clamp, lerp, fmt } = Lab.util;
  const { box, tx, dot, line, circ, alpha } = Lab.draw;

  const RATE = 11, HOLD = 3;
  const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];      // N, E, S, W

  function build(s) {
    const C = s.narrow ? 9 : 16, R = 9, rnd = s.rng, p = s.p.closed / 100;
    const open = new Map();                           // "a|b" (a<b) → true when the street is open
    const id = (x, y) => y * C + x;
    for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) {
      if (x + 1 < C && rnd() >= p) open.set(id(x, y) + '|' + id(x + 1, y), true);
      if (y + 1 < R && rnd() >= p) open.set(id(x, y) + '|' + id(x, y + 1), true);
    }
    const start = id(1, Math.floor(R / 2)), goal = id(C - 2, Math.floor(R / 2) + (rnd() < 0.5 ? -2 : 2));
    return { C, R, open, start, goal, id };
  }
  function neighbors(g, v) {
    const x = v % g.C, y = Math.floor(v / g.C), out = [];
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= g.C || ny >= g.R) continue;
      const u = g.id(nx, ny), key = Math.min(u, v) + '|' + Math.max(u, v);
      if (g.open.has(key)) out.push(u);
    }
    return out;
  }

  function* bfs(g, info) {
    const q = [g.start]; let head = 0;
    const seen = new Set([g.start]); info.parent = new Map();
    while (head < q.length) {
      info.frontier = new Set(q.slice(head + 1)); info.maxFront = Math.max(info.maxFront, q.length - head);
      const v = q[head++]; info.order.push(v); yield v;
      if (v === g.goal) { info.found = true; return; }
      for (const u of neighbors(g, v)) if (!seen.has(u)) { seen.add(u); info.parent.set(u, v); q.push(u); }
      info.frontier = new Set(q.slice(head));
    }
  }
  function* dfs(g, info) {
    const st = [g.start], seen = new Set(); info.parent = new Map();
    while (st.length) {
      info.maxFront = Math.max(info.maxFront, st.length);
      const v = st.pop();
      if (seen.has(v)) continue;
      seen.add(v); info.order.push(v); info.frontier = new Set(st); yield v;
      if (v === g.goal) { info.found = true; return; }
      // push in reverse so the first direction (N, E, …) is explored first
      const ns = neighbors(g, v);
      // a node can sit in the stack more than once; the copy pushed last is popped first, so its parent wins
      for (let i = ns.length - 1; i >= 0; i--) if (!seen.has(ns[i])) { st.push(ns[i]); info.parent.set(ns[i], v); }
      info.frontier = new Set(st);
    }
  }
  function pathOf(g, info) {
    if (!info.found) return [];
    const p = [g.goal]; let v = g.goal;
    while (v !== g.start) { v = info.parent.get(v); p.push(v); }
    return p.reverse();
  }

  Lab.registerSim('graph', {
    height: 380, warm: 0,

    init(s) { s.st = {}; this.restart(s); },
    onParam(s) { this.restart(s); },

    restart(s) {
      const g = build(s);
      const mk = (name, fn) => { const info = { order: [], frontier: new Set(), maxFront: 0, found: false, parent: null }; return { name, info, gen: fn(g, info), done: false, path: null }; };
      s.st = { g, t0: s.t, lanes: [mk('BFS  (Queue)', bfs), mk('DFS  (Stack)', dfs)], tEnd: null, narrow: s.narrow };
    },

    step(s) {
      const st = s.st;
      if (st.narrow !== s.narrow) { this.restart(s); return; }
      const want = Math.floor((s.t - st.t0) * RATE) + 1;
      for (const L of st.lanes) {
        while (!L.done && L.info.order.length < want) { const r = L.gen.next(); if (r.done) { L.done = true; L.path = pathOf(st.g, L.info); } }
      }
      if (st.lanes.every(L => L.done)) { if (st.tEnd === null) st.tEnd = s.t; else if (s.t - st.tEnd > HOLD) this.restart(s); }
    },

    draw(s) {
      const C = s.C, st = s.st, g = st.g, W = s.w, H = s.h, n = s.narrow;
      const panels = n ? [[14, 30, W - 28, (H - 40) / 2 - 8], [14, 30 + (H - 40) / 2 + 8, W - 28, (H - 40) / 2 - 8]]
                       : [[14, 30, (W - 44) / 2, H - 44], [30 + (W - 44) / 2, 30, (W - 44) / 2, H - 44]];
      st.lanes.forEach((L, k) => {
        const [px, py, pw, ph] = panels[k], info = L.info;
        const gx = pw / g.C, gy = (ph - 22) / g.R;
        const P = v => ({ x: px + (v % g.C + 0.5) * gx, y: py + 22 + (Math.floor(v / g.C) + 0.5) * gy });
        box(px, py, pw, ph, { r: 8, fill: C.surface, stroke: C.line });
        const res = L.done ? (info.found ? `path: ${L.path.length - 1} streets` : 'no route (closed streets)') : `visiting… frontier ${info.frontier.size}`;
        tx(L.name, px + 10, py + 12, { m: 1, s: n ? 10 : 11.5, w: 700, a: 'left', c: k ? C.violet : C.a2 });
        tx(res, px + pw - 10, py + 12, { m: 1, s: n ? 9 : 10.5, w: 600, a: 'right', c: L.done ? (info.found ? C.good : C.bad) : C.muted });
        // streets
        for (const key of g.open.keys()) { const [a, b] = key.split('|').map(Number), A = P(a), B = P(b); line(A.x, A.y, B.x, B.y, C.line, 1.4); }
        // visited (fades from strong to light by visit order)
        const vis = new Map(info.order.map((v, i) => [v, i]));
        const last = info.order[info.order.length - 1];
        const r = Math.max(2.5, Math.min(gx, gy) * 0.22);
        for (let v = 0; v < g.C * g.R; v++) {
          const p = P(v);
          if (vis.has(v)) { dot(p.x, p.y, r, k ? C.violet : C.a2); }
          else if (info.frontier.has(v)) { circ(p.x, p.y, r, C.accent, 1.6); }
          else dot(p.x, p.y, 1.6, C.line);
        }
        // the found path
        if (L.path && L.path.length > 1) {
          for (let i = 1; i < L.path.length; i++) { const A = P(L.path[i - 1]), B = P(L.path[i]); line(A.x, A.y, B.x, B.y, C.accent, 3.2); }
        }
        if (!L.done && last !== undefined) { const p = P(last); dot(p.x, p.y, r + 2.5, C.accent); }
        const S = P(g.start), G = P(g.goal);
        dot(S.x, S.y, r + 3, C.ink); tx('depot', S.x, S.y - r - 9, { m: 1, s: 9, w: 700, c: C.ink });
        circ(G.x, G.y, r + 4, C.bad, 2.4); tx('customer', G.x, G.y - r - 10, { m: 1, s: 9, w: 700, c: C.bad });
      });
      const md = Math.abs(g.goal % g.C - g.start % g.C) + Math.abs(Math.floor(g.goal / g.C) - Math.floor(g.start / g.C));
      tx(n ? `same speed · minimum ${md} streets` : `same city, same speed: one intersection per tick each  ·  straight-line minimum ${md} streets`, 14, 12, { m: 1, s: n ? 8.5 : 10.5, a: 'left', c: C.muted });
    },

    stats(s) {
      const [B, D] = s.st.lanes;
      const len = L => L.done ? (L.info.found ? String(L.path.length - 1) : '—') : '…';
      return [
        ['BFS: intersections زارها', fmt(B.info.order.length)],
        ['DFS: intersections زارها', fmt(D.info.order.length)],
        ['BFS: طول المسار (شوارع)', len(B), 'good'],
        ['DFS: طول المسار (شوارع)', len(D), D.done && B.done && D.info.found && D.path.length > B.path.length ? 'bad' : ''],
        ['أكبر frontier (Queue / Stack)', `${B.info.maxFront} / ${D.info.maxFront}`]
      ];
    }
  });

  Lab.registerLesson({
    id: 'graph', lab: 'dsa', title: 'Graph: BFS و DFS',
    html: Lab.tpl.lesson({
      sim: 'graph', level: 2,
      terms: ['Graph', 'BFS', 'DFS', 'Queue', 'Stack', 'Frontier'],
      lede: 'مدينة كـ graph: التقاطعات nodes والشوارع edges، وفيه شوارع مقفولة. الاتنين بيبدأوا من المخزن وبيدوّروا على العميل بنفس السرعة. الدواير البرتقالي هي الـ <b>frontier</b>: اللي اتشافوا ولسه ما اتزاروش.',
      aria: 'محاكاة BFS و DFS على شبكة طرق',
      controls: [
        { type: 'range', p: 'closed', label: 'شوارع مقفولة', min: 0, max: 40, step: 5, value: 15, unit: '%' }
      ],
      idea: `
        <p>الـ <b>Graph</b> نقط (<b>nodes</b>) ووصلات بينها (<b>edges</b>). أي حاجة فيها «مين متوصل بمين» graph: طرق، شبكات، علاقات.</p>
        <p><b>BFS</b> (Breadth-First): بيزور الأقرب الأول، شارع واحد بعيد ثم اتنين ثم تلاتة، باستخدام <b>Queue</b>. أول ما يوصل للهدف يبقى لقى أقصر طريق بعدد الشوارع.</p>
        <p><b>DFS</b> (Depth-First): بيمشي في اتجاه واحد لآخره، ولما يتزنق يرجع خطوة ويجرب غيره، باستخدام <b>Stack</b> (أو recursion). بيلاقي طريق، بس مش شرط الأقصر.</p>`,
      real: `
        <p>«أنهي عربيات على بعد 3 تقاطعات من الحادثة؟» ده BFS لحد مستوى 3. و«هل العميل ده ممكن نوصله أصلًا بعد قفل الكوبري؟» ده أي traversal (BFS أو DFS) لحد ما يلاقيه أو يخلّص.</p>
        <p>BFS بيدّيك أقل عدد شوارع، بس الشوارع مش متساوية: شارع زحمة أطول من 3 فاضيين. لما يبقى فيه وزن (وقت أو مسافة) لكل edge محتاج <a href="#/dsa/dijkstra">Dijkstra</a>.</p>`,
      try: 'قارن الأرقام تحت: الـ DFS غالبًا بيوصل للعميل بزيارات أقل، بس بمسار ضعف الـ BFS أو أكتر، والـ BFS مساره دايمًا الأقصر. بعدين ارفع الشوارع المقفولة لـ 35-40%: ساعات العميل يبقى مستحيل الوصول له، والاتنين بيضطروا يزوروا كل حاجة متوصلة بالمخزن عشان يتأكدوا.',
      also: 'اقتراح أصدقاء (أصدقاء الأصدقاء = BFS لمستوى 2)، وتتبع تأثير عطل في شبكة اتصالات، وفحص dependencies بين المشاريع، والـ garbage collector نفسه بيعمل traversal من الـ roots عشان يعرف إيه لسه مستخدم.',
      net: `
<pre><span class="c">// BFS: Queue + HashSet للي اتشاف</span>
var seen = new HashSet&lt;int&gt; { depot };
var parent = new Dictionary&lt;int, int&gt;();
var q = new Queue&lt;int&gt;(); q.Enqueue(depot);
while (q.TryDequeue(out var v)) {
    if (v == customer) break;
    foreach (var u in roads[v])
        if (seen.Add(u)) { parent[u] = v; q.Enqueue(u); }   <span class="c">// علّم لما تضيف، مش لما تزور</span>
}
<span class="c">// DFS: نفس الكود بـ Stack&lt;int&gt; بدل Queue&lt;int&gt;</span></pre>`,
      netTitle: 'في .NET',
      deep: [
        '<b>علّم وقت الإضافة:</b> في BFS لو علّمت الـ node وقت ما تزورها بدل وقت ما تضيفها للـ Queue، نفس الـ node ممكن تدخل الطابور مرات كتير، والذاكرة والوقت بيتضاعفوا في graphs كثيفة.',
        '<b>DFS بالـ recursion = StackOverflow:</b> DFS recursive على graph فيه مسار طوله 100 ألف هيعدي حجم الـ thread stack (1 MB افتراضيًا) ويوقع الـ process كله، و<code>StackOverflowException</code> في .NET مينفعش يتمسك. استخدم <code>Stack&lt;T&gt;</code> صريح زي هنا.',
        '<b>الذاكرة:</b> الـ frontier في BFS = كل nodes المستوى الحالي. في grid زي هنا ده صغير (خط مايل)، لكن في graph متفرّع زي شبكة اجتماعية بيبقى ملايين. الـ DFS الـ recursive بيحتفظ بالمسار الحالي بس، أما الـ DFS بـ Stack صريح (اللي هنا) فبيحط كل الجيران وفيهم تكرار، فالـ stack ممكن يكبر أكتر من الـ queue زي ما «أكبر frontier» بيوريك.',
        '<b>BFS = Dijkstra لما كل الأوزان 1:</b> عشان كده BFS بيدّي أقصر مسار بعدد الـ edges بس. أول ما الأوزان تختلف، الـ Queue العادية لازم تبقى <a href="#/dsa/heap">Priority Queue</a>.',
        '<b>تبسيطات:</b> المدينة grid منتظمة والشوارع في الاتجاهين. الطرق الحقيقية graph غير منتظم بشوارع اتجاه واحد (directed edges) وملايين التقاطعات.'
      ]
    })
  });
})();
