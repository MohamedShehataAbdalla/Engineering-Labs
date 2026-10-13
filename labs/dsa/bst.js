/* DSA · BST و Balanced Trees
   The same keys go into two real trees:
     BST  plain binary search tree: smaller left, bigger right, no rebalancing
     AVL  self-balancing: after each insert, any node whose subtrees differ in height by > 1 is rotated
          (LL / RR / LR / RL), so the height stays ≤ ~1.44·log₂ n
   Each operation first walks the real comparison path in both trees (the moving dots), then inserts.
   Rotations are the ones the AVL insert actually performed. Node positions = in-order rank × depth, tweened. */
(function () {
  "use strict";
  const { clamp, lerp, fmt, f1 } = Lab.util;
  const { box, tx, dot, line, circ, alpha } = Lab.draw;

  const MAXN = 31, STEP = 0.32, HOLD = 0.7;

  const H = n => n ? n.h : 0;
  const upd = n => { n.h = 1 + Math.max(H(n.l), H(n.r)); };
  function rotR(y, rots) { const x = y.l; y.l = x.r; x.r = y; upd(y); upd(x); rots.push(y.k); return x; }
  function rotL(x, rots) { const y = x.r; x.r = y.l; y.l = x; upd(x); upd(y); rots.push(x.k); return y; }
  function avlInsert(n, k, rots, kinds) {
    if (!n) return { k, l: null, r: null, h: 1 };
    if (k < n.k) n.l = avlInsert(n.l, k, rots, kinds); else n.r = avlInsert(n.r, k, rots, kinds);
    upd(n);
    const b = H(n.l) - H(n.r);
    if (b > 1 && k < n.l.k) { kinds.push('LL'); return rotR(n, rots); }
    if (b < -1 && k > n.r.k) { kinds.push('RR'); return rotL(n, rots); }
    if (b > 1) { kinds.push('LR'); n.l = rotL(n.l, rots); return rotR(n, rots); }
    if (b < -1) { kinds.push('RL'); n.r = rotR(n.r, rots); return rotL(n, rots); }
    return n;
  }
  function bstInsert(root, k) {
    const nn = { k, l: null, r: null, h: 1 };
    if (!root) return nn;
    let c = root; for (;;) { if (k < c.k) { if (!c.l) { c.l = nn; break; } c = c.l; } else { if (!c.r) { c.r = nn; break; } c = c.r; } }
    return root;
  }
  function height(n) { return n ? 1 + Math.max(height(n.l), height(n.r)) : 0; }
  /** keys compared on the way down to k (stops at k if present) */
  function path(n, k) { const p = []; while (n) { p.push(n.k); if (k === n.k) break; n = k < n.k ? n.l : n.r; } return p; }
  function inorder(n, out = [], d = 0) { if (!n) return out; inorder(n.l, out, d + 1); out.push({ k: n.k, d }); inorder(n.r, out, d + 1); return out; }
  function edges(n, out = []) { if (!n) return out; if (n.l) out.push([n.k, n.l.k]); if (n.r) out.push([n.k, n.r.k]); edges(n.l, out); edges(n.r, out); return out; }

  function fresh(s) {
    const st = s.st, n = MAXN, rnd = s.rng;
    let keys = [];
    for (let i = 0; i < n; i++) keys.push(100 + i * 3);
    if (s.p.order === 'random') for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [keys[i], keys[j]] = [keys[j], keys[i]]; }
    Object.assign(st, { keys, i: 0, bst: null, avl: null, pos: [{}, {}], rotations: 0, op: null, lookups: [[], []], flash: [], flashT: -9, kinds: [], pause: 0, doneAt: 0, lookedUp: false });
  }

  Lab.registerSim('bst', {
    height: 390, warm: 0,

    init(s) { s.st = {}; fresh(s); },
    onParam(s) { fresh(s); },

    plan(s) {
      const st = s.st;
      // every third operation (once there is something to find) is a lookup of an existing key
      const lookup = st.i > 4 && st.i % 3 === 0 && !st.lookedUp;
      let key;
      if (lookup) { key = st.keys[Math.floor(s.rng() * st.i)]; st.lookedUp = true; }
      else { key = st.keys[st.i]; st.lookedUp = false; }
      const pb = path(st.bst, key), pa = path(st.avl, key);
      const len = Math.max(pb.length, pa.length, 1), step = Math.min(STEP, 2.4 / len);   // long paths walk faster
      st.op = { key, lookup, pb, pa, t0: s.t, step, dur: len * step };
    },

    step(s, dt) {
      const st = s.st;
      if (!st.op && !(st.pause && s.t < st.pause)) {
        if (st.i >= MAXN) { if (!st.doneAt) st.doneAt = s.t; if (s.t - st.doneAt > 3) { fresh(s); st.doneAt = 0; } }
        else this.plan(s);
      }
      const op = st.op;
      if (op && s.t - op.t0 >= op.dur) {
        if (op.lookup) { st.lookups[0].push(op.pb.length); st.lookups[1].push(op.pa.length); }
        else {
          st.bst = bstInsert(st.bst, op.key);
          const rots = [], kinds = [];
          st.avl = avlInsert(st.avl, op.key, rots, kinds);
          if (rots.length) { st.rotations += kinds.length; st.flash = rots; st.flashT = s.t; st.kinds = kinds; }
          st.i++;
        }
        st.last = op; st.op = null; st.pause = s.t + HOLD;
      }
      // tween node positions toward their layout targets
      const k = Math.min(1, dt * 7);
      for (const p of st.pos) for (const id in p) { const o = p[id]; o.x += (o.tx - o.x) * k; o.y += (o.ty - o.y) * k; }
    },

    draw(s) {
      const C = s.C, st = s.st, W = s.w, Hh = s.h, n = s.narrow;
      const gap = 16, pw = (W - 28 - gap) / 2;
      const panels = [{ name: 'BST (no balancing)', root: st.bst, path: st.op ? st.op.pb : null, x0: 14 }, { name: 'AVL (self-balancing)', root: st.avl, path: st.op ? st.op.pa : null, x0: 14 + pw + gap }];
      const op = st.op;
      if (op) tx(op.lookup ? `lookup ${op.key}` : `insert ${op.key}  (${st.i + 1} / ${MAXN})`, 14, 14, { m: 1, s: n ? 10 : 12, w: 700, a: 'left', c: C.accent });
      else if (st.i >= MAXN) tx(`all ${MAXN} keys inserted`, 14, 14, { m: 1, s: n ? 10 : 12, w: 700, a: 'left', c: C.a2 });
      if (!n) tx(s.p.order === 'sorted' ? 'keys arrive in increasing order (timestamps, identity ids)' : 'keys arrive in random order', W - 14, 14, { m: 1, s: 10, a: 'right', c: C.muted });

      panels.forEach((P, pi) => {
        const top = 52, bottom = Hh - 14, hgt = height(P.root);
        box(P.x0, top - 22, pw, bottom - top + 30, { r: 8, fill: C.surface, stroke: C.line });
        tx(P.name, P.x0 + 10, top - 10, { m: 1, s: n ? 9.5 : 11, w: 700, a: 'left', c: pi ? C.a2 : C.ink });
        tx(`height ${hgt}`, P.x0 + pw - 10, top - 10, { m: 1, s: n ? 9.5 : 11, w: 700, a: 'right', c: hgt > 2 * Math.log2(st.i + 1) + 1 ? C.bad : C.good });
        const nodes = inorder(P.root), cnt = nodes.length, pos = st.pos[pi];
        const levels = Math.max(hgt, 5), dy = Math.min(46, (bottom - top - 16) / Math.max(1, levels - 1));
        const r = clamp(Math.min(dy * 0.36, pw / Math.max(cnt, 1) * 0.42), 3.5, 11);
        nodes.forEach((nd, i) => {
          const tx_ = P.x0 + 12 + (i + 0.5) / cnt * (pw - 24), ty_ = top + 10 + nd.d * dy;
          if (!pos[nd.k]) pos[nd.k] = { x: tx_, y: top - 30, tx: tx_, ty: ty_ };
          pos[nd.k].tx = tx_; pos[nd.k].ty = ty_;
        });
        for (const [a, b] of edges(P.root)) if (pos[a] && pos[b]) line(pos[a].x, pos[a].y, pos[b].x, pos[b].y, C.line, 1.2);
        const flashing = pi === 1 && s.t - st.flashT < 1.2 ? st.flash : [];
        nodes.forEach(nd => {
          const p = pos[nd.k], onPath = P.path && P.path.includes(nd.k);
          const fill = flashing.includes(nd.k) ? C.violet : onPath ? C.surface : C.surface;
          const stroke = flashing.includes(nd.k) ? C.violet : onPath ? C.accent : C.a2;
          dot(p.x, p.y, r, fill); circ(p.x, p.y, r, stroke, onPath ? 2 : 1.3);
          if (r >= 10) tx(nd.k, p.x, p.y, { m: 1, s: 8.5, w: 600, c: flashing.includes(nd.k) ? C.surface : C.ink });
        });
        // the comparison dot walking down the real path
        if (op && P.path && P.path.length) {
          const e = s.t - op.t0, k = clamp(e / op.step, 0, P.path.length - 1), i = Math.floor(k);
          const a = pos[P.path[i]], b = pos[P.path[Math.min(i + 1, P.path.length - 1)]];
          if (a && b) dot(lerp(a.x, b.x, k - i), lerp(a.y, b.y, k - i), 5, C.accent);
          tx(`${P.path.length} comparisons`, P.x0 + 10, bottom - 2, { m: 1, s: n ? 9 : 10.5, w: 600, a: 'left', c: P.path.length > 8 ? C.bad : C.accent });
        }
        if (pi === 1 && flashing.length) tx(`rotation ${st.kinds.join(' + ')}`, P.x0 + pw - 10, bottom - 2, { m: 1, s: n ? 9 : 10.5, w: 700, a: 'right', c: C.violet });
      });
    },

    stats(s) {
      const st = s.st, nb = height(st.bst), na = height(st.avl), ideal = Math.ceil(Math.log2(st.i + 1));
      const avg = a => a.length ? f1(a.reduce((x, y) => x + y, 0) / a.length) : '—';
      return [
        ['عدد المفاتيح', String(st.i)],
        ['BST: الارتفاع', String(nb), nb > 2 * ideal ? 'bad' : 'good'],
        ['AVL: الارتفاع', String(na), 'good'],
        ['أقل ارتفاع ممكن ⌈log₂(n+1)⌉', String(ideal)],
        ['متوسط مقارنات البحث (BST / AVL)', `${avg(st.lookups[0])} / ${avg(st.lookups[1])}`],
        ['Rotations في الـ AVL', String(st.rotations), st.rotations ? 'warn' : '']
      ];
    }
  });

  Lab.registerLesson({
    id: 'bst', lab: 'dsa', title: 'BST و Balanced Trees',
    html: Lab.tpl.lesson({
      sim: 'bst', level: 2,
      terms: ['Binary Search Tree', 'Height', 'AVL', 'Rotation', 'O(log n)'],
      lede: 'نفس المفاتيح بتدخل شجرتين: <b>BST</b> عادية على الشمال، و<b>AVL</b> بتوزن نفسها على اليمين. النقطة البرتقالي بتمشي على المقارنات الحقيقية لحد مكان المفتاح، والبنفسجي هو الـ nodes اللي اتعمل لها rotation.',
      aria: 'محاكاة binary search tree عادية مقابل AVL tree',
      controls: [
        { type: 'seg', p: 'order', label: 'ترتيب المفاتيح الداخلة', value: 'sorted', opts: [['sorted', 'متزايدة (timestamps)'], ['random', 'عشوائية']] }
      ],
      idea: `
        <p>الـ <b>Binary Search Tree</b>: كل node شمالها أصغر منها ويمينها أكبر. البحث بيبدأ من الـ root وينزل شمال أو يمين، فعدد المقارنات = <b>ارتفاع</b> الشجرة. لو الشجرة متوازنة، ارتفاعها حوالي <code>log₂ n</code>.</p>
        <p>المشكلة: لو المفاتيح داخلة مترتبة، كل مفتاح أكبر من اللي قبله فبيروح يمين دايمًا، والشجرة بتبقى خط مستقيم: Linked List بارتفاع n. الـ <b>Balanced Trees</b> (AVL، Red-Black) بتعمل <b>Rotation</b> بعد الإضافة لما ناحية تبقى أطول من التانية، فالارتفاع بيفضل <code>O(log n)</code> مهما كان الترتيب.</p>`,
      real: `
        <p>أغلب المفاتيح في أنظمة التتبع بتيجي <b>مترتبة</b>: timestamps، و IDENTITY، ورقم الرحلة. لو بنيت فهرس في الذاكرة بـ BST عادية على وقت النقط، هيبقى في الحقيقة list، والبحث عن نقطة في يوم فيه 8,640 نقطة هيعمل آلاف المقارنات بدل 14.</p>`,
      try: 'سيبها على «متزايدة»: الـ BST على الشمال بتبقى سلم نازل وارتفاعها = عدد المفاتيح، والـ AVL بتعمل rotation كل شوية وتفضل حوالي 5. بعدين جرّب «عشوائية»: الـ BST نفسها بتطلع معقولة، والـ AVL rotations أقل بكتير.',
      also: 'الـ order book بالسعر (SortedDictionary)، وجدول مواعيد الرحلات، وترتيب اللاعبين بالـ score، وأي «هات اللي بين X و Y» في الذاكرة.',
      net: `
<pre><span class="c">// SortedDictionary / SortedSet: Red-Black tree (balanced). Add/Remove/Find كلهم O(log n)</span>
var byTime = new SortedDictionary&lt;DateTime, GpsPoint&gt;();
byTime[p.Ts] = p;

<span class="c">// range query: كل النقط بين وقتين (O(log n + k))</span>
var set = new SortedSet&lt;DateTime&gt;(times);
foreach (var t in set.GetViewBetween(from, to)) { }

<span class="c">// SortedList: مش شجرة. arrays مترتبة + binary search:</span>
<span class="c">// البحث O(log n)، بس الإضافة في النص O(n). كويسة لو بتبني مرة وتقرا كتير</span>
var rates = new SortedList&lt;decimal, Tariff&gt;();</pre>`,
      netTitle: 'في .NET',
      deep: [
        '<b>AVL vs Red-Black:</b> الـ AVL أكثر توازنًا (ارتفاعها ≤ حوالي 1.44 log₂ n) فالبحث أسرع شوية، بس بتعمل rotations أكتر عند الإضافة والحذف. الـ Red-Black (اللي في .NET و Java و C++ std::map) بتسمح بارتفاع لحد 2 log₂ n مقابل rotations أقل. الاتنين O(log n).',
        '<b>ليه قواعد البيانات مش بتستخدم binary trees؟</b> كل node فيها مفتاح واحد ووصلتين، وعلى الديسك كل node = قراية. الـ B-tree بتحط مئات المفاتيح في صفحة 8 KB واحدة، فالارتفاع 3-4 لمليار صف بدل 30. شوف <a href="#/databases/btree-index">B-Tree Index</a>.',
        '<b>نفس المشكلة في الـ clustered index:</b> المفتاح المتزايد (IDENTITY) مش بيبوّظ الـ B-tree لأنها بتتوازن لوحدها، بس بيخلّي كل الإضافات تروح لآخر صفحة (hot page). شوف <a href="#/databases/pages">Pages و Page Split</a>.',
        '<b>الشجرة في الذاكرة غالية:</b> كل node في <code>SortedDictionary</code> object لوحده (pointers + لون + المفتاح والقيمة)، فالذاكرة أكتر بكتير والـ cache misses كتير. لو الداتا مش بتتغير، array مترتبة + <code>BinarySearch</code> أسرع وأخف.',
        '<b>تبسيطات:</b> الرسم بيحط كل node حسب ترتيبها (in-order) أفقيًا وعمقها رأسيًا. مفيش حذف هنا؛ الحذف في AVL برضه بيعمل rotations وممكن أكتر من واحدة.'
      ]
    })
  });
})();
