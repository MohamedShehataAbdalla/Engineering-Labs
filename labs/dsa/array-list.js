/* DSA · Array vs Linked List
   Two real structures holding the same VehicleIds (long, 8 bytes):
     List<long>        one contiguous array + Count + Capacity. Full → allocate 2× and copy every element.
     LinkedList<long>  one node object per element (~48 bytes in .NET), scattered on the heap, linked by pointers.
   Each round runs one operation on both. The operation emits its real micro-steps (shift, copy, hop, pointer write)
   and the animation plays them at the same rate for both sides, mutating the structures as it goes.
   Cache lines are counted from addresses: array cells are 8 bytes apart (8 per 64-byte line), nodes sit in
   whatever heap slot they were allocated in. */
(function () {
  "use strict";
  const { clamp, lerp, fmt } = Lab.util;
  const { box, tx, dot, line, arrow, hatch, alpha } = Lab.draw;

  const MAXN = 26, SLOTS = 52, HOLD = 1.3;
  const NODE_BYTES = 48, SLOT_BYTES = 96, LINE = 64;   // a heap slot = our node + whatever got allocated next to it

  const OPS = {
    get: 'list[i]  (read by index)',
    front: 'Insert(0, x) / AddFirst(x)',
    append: 'Add(x) / AddLast(x)',
    iter: 'foreach (sum all)'
  };

  function fresh(s) {
    const n0 = s.p.n, st = s.st;
    st.nextVal = 101;
    st.arr = { cap: 4, items: [] };
    while (st.arr.cap < n0) st.arr.cap *= 2;
    for (let i = 0; i < n0; i++) st.arr.items.push(st.nextVal + i);
    // list nodes land in scattered heap slots (other objects were allocated in between)
    const slots = [...Array(SLOTS).keys()];
    for (let i = slots.length - 1; i > 0; i--) { const j = Math.floor(s.rng() * (i + 1)); [slots[i], slots[j]] = [slots[j], slots[i]]; }
    st.free = slots;
    st.nodes = st.arr.items.map(v => ({ v, slot: st.free.pop(), next: -1 }));
    st.nodes.forEach((nd, i) => { nd.next = i + 1 < st.nodes.length ? i + 1 : -1; });
    st.head = st.nodes.length ? 0 : -1; st.tail = st.nodes.length - 1;
    st.nextVal += n0;
    st.newArr = null;
    st.resizes = 0;
  }

  /* ---------- event generators (read the current state, mutate nothing) ---------- */
  function genArray(st, op, idx, v) {
    const a = st.arr, n = a.items.length, ev = [];
    if (op === 'get') ev.push({ t: 'read', i: idx });
    if (op === 'iter') for (let i = 0; i < n; i++) ev.push({ t: 'read', i });
    if (op === 'front' || op === 'append') {
      let cap = a.cap;
      if (n === cap) { cap *= 2; ev.push({ t: 'alloc', cap }); for (let i = 0; i < n; i++) ev.push({ t: 'copy', i }); ev.push({ t: 'swap' }); }
      if (op === 'front') { for (let i = n - 1; i >= 0; i--) ev.push({ t: 'move', from: i, to: i + 1 }); ev.push({ t: 'write', i: 0, v }); }
      else ev.push({ t: 'write', i: n, v });
    }
    return ev;
  }
  function genList(st, op, idx, v) {
    const ev = [];
    if (op === 'get' || op === 'iter') {
      let cur = st.head, k = 0;
      const last = op === 'get' ? idx : Infinity;
      while (cur !== -1 && k <= last) { ev.push({ t: 'hop', node: cur }); if (k === last) break; cur = st.nodes[cur].next; k++; }
    }
    if (op === 'front' || op === 'append') {
      ev.push({ t: 'alloc', v });
      ev.push({ t: op === 'front' ? 'linkFront' : 'linkBack' });
    }
    return ev;
  }

  /* ---------- applying one event = the real mutation + the step count ---------- */
  function applyArr(st, e) {
    const a = st.arr, r = st.r;
    r.aCur = e;
    if (e.t === 'read') { r.aSteps++; r.aLines.add(Math.floor(e.i * 8 / LINE)); }
    if (e.t === 'alloc') { st.newArr = { cap: e.cap, items: [] }; }
    if (e.t === 'copy') { st.newArr.items[e.i] = a.items[e.i]; r.aSteps++; r.aCopies++; }
    if (e.t === 'swap') { a.cap = st.newArr.cap; a.items = st.newArr.items; st.newArr = null; r.resized = true; }
    if (e.t === 'move') { a.items[e.to] = a.items[e.from]; r.aSteps++; r.aMoves++; }
    if (e.t === 'write') { a.items[e.i] = e.v; r.aSteps++; }
  }
  function applyList(st, e) {
    const r = st.r;
    r.lCur = e;
    if (e.t === 'hop') { r.lSteps++; r.lLines.add(Math.floor(st.nodes[e.node].slot * SLOT_BYTES / LINE)); r.lHit = e.node; }
    if (e.t === 'alloc') { st.nodes.push({ v: e.v, slot: st.free.pop(), next: -1 }); r.lSteps++; r.lNew = st.nodes.length - 1; }
    if (e.t === 'linkFront') { const k = st.nodes.length - 1; st.nodes[k].next = st.head; st.head = k; if (st.tail < 0) st.tail = k; r.lSteps++; r.lPtr += 2; }
    if (e.t === 'linkBack') { const k = st.nodes.length - 1; if (st.tail >= 0) st.nodes[st.tail].next = k; else st.head = k; st.tail = k; r.lSteps++; r.lPtr += 2; }
  }

  Lab.registerSim('array-list', {
    height: 360, warm: 0,

    init(s) { s.st = { rounds: 0, resizes: 0 }; fresh(s); this.round(s); },
    onParam(s, k) { if (k === 'n') { s.st.r = null; fresh(s); } this.round(s); },

    round(s) {
      const st = s.st, op = s.p.op, prev = st.r;
      // a round cut short (new parameter) still finishes its mutation, so the structures stay consistent
      if (prev) { while (prev.ai < prev.aEv.length) applyArr(st, prev.aEv[prev.ai++]); while (prev.li < prev.lEv.length) applyList(st, prev.lEv[prev.li++]); }
      if ((op === 'front' || op === 'append') && st.arr.items.length >= MAXN) fresh(s);
      const n = st.arr.items.length, idx = Math.floor(n * (0.55 + s.rng() * 0.4)), v = st.nextVal++;
      const aEv = genArray(st, op, Math.min(idx, n - 1), v), lEv = genList(st, op, Math.min(idx, n - 1), v);
      const total = Math.max(aEv.length, lEv.length);
      st.r = { op, idx, t0: s.t, aEv, lEv, ai: 0, li: 0, rate: Math.max(5, total / 3.2),
        aSteps: 0, aMoves: 0, aCopies: 0, aLines: new Set(), aCur: null, resized: false,
        lSteps: 0, lPtr: 0, lLines: new Set(), lCur: null, lHit: -1, lNew: -1, n };
      st.rounds++;
    },

    step(s) {
      const st = s.st, r = st.r, want = Math.floor((s.t - r.t0) * r.rate) + 1;
      while (r.ai < Math.min(want, r.aEv.length)) applyArr(st, r.aEv[r.ai++]);
      while (r.li < Math.min(want, r.lEv.length)) applyList(st, r.lEv[r.li++]);
      if (r.ai >= r.aEv.length && r.li >= r.lEv.length) {
        if (!r.tEnd) { r.tEnd = s.t; if (r.resized) st.resizes++; }
        if (s.t - r.tEnd > HOLD) this.round(s);
      }
    },

    draw(s) {
      const C = s.C, st = s.st, r = st.r, W = s.w, n = s.narrow;
      const x0 = 14, x1 = W - 14, cw = x1 - x0;
      tx(OPS[r.op] + (r.op === 'get' ? `   i = ${r.idx}` : ''), x0, 16, { m: 1, s: n ? 10 : 12, w: 600, a: 'left', c: C.accent });

      /* ---- array ---- */
      const a = st.arr, cap = Math.max(a.cap, st.newArr ? st.newArr.cap : 0);
      const cell = Math.min(34, cw / cap), ay = 50, ch = 26;
      tx(`List<long>  Count ${a.items.length} / Capacity ${a.cap}`, x0, 36, { m: 1, s: n ? 9.5 : 11, w: 600, a: 'left' });
      tx(`${r.aSteps} steps`, x1, 36, { m: 1, s: n ? 9.5 : 11, w: 700, a: 'right', c: r.aSteps > 4 ? C.bad : C.good });
      const drawRow = (arr, y, active) => {
        for (let i = 0; i < arr.cap; i++) {
          const x = x0 + i * cell, has = arr.items[i] !== undefined && i < (arr === a ? a.items.length : arr.items.length);
          if (i % 8 === 0 && !n) alpha(0.5, () => line(x, y - 4, x, y + ch + 4, C.violet, 1));
          if (!has) { box(x + 1, y, cell - 2, ch, { r: 3, fill: C.bg, stroke: C.line }); hatch(x + 1, y, cell - 2, ch, C.line); continue; }
          let fill = C.surface, stroke = C.a2;
          if (active && r.aCur) {
            const e = r.aCur;
            if ((e.t === 'read' && e.i === i) || (e.t === 'write' && e.i === i) || (e.t === 'move' && e.to === i)) { fill = C.accent; stroke = C.accent; }
          }
          box(x + 1, y, cell - 2, ch, { r: 3, fill, stroke });
          if (cell > 22) tx(arr.items[i], x + cell / 2, y + ch / 2, { m: 1, s: 10, w: 600, c: fill === C.accent ? C.surface : C.ink });
        }
      };
      drawRow(a, ay, true);
      if (st.newArr) {
        const ny = ay + ch + 18;
        tx('new array (2×) ← copy', x0, ny - 7, { m: 1, s: 9.5, a: 'left', c: C.bad });
        drawRow({ cap: st.newArr.cap, items: st.newArr.items }, ny + 3, false);
        const e = r.aCur;
        if (e && e.t === 'copy') alpha(0.8, () => arrow(x0 + e.i * cell + cell / 2, ay + ch, x0 + e.i * cell + cell / 2, ny + 3, C.bad, 1.4));
      } else if (!n) {
        tx('address = base + i × 8 bytes  ·  violet ticks = 64-byte cache lines', x0, ay + ch + 14, { m: 1, s: 9.5, a: 'left', c: C.muted });
      }

      /* ---- linked list on a scattered heap ---- */
      const ly0 = 148, lh = s.h - ly0 - 12;
      tx(`LinkedList<long>  ${st.nodes.length} nodes`, x0, ly0 - 8, { m: 1, s: n ? 9.5 : 11, w: 600, a: 'left' });
      tx(`${r.lSteps} steps`, x1, ly0 - 8, { m: 1, s: n ? 9.5 : 11, w: 700, a: 'right', c: r.lSteps > 4 ? C.bad : C.good });
      box(x0, ly0, cw, lh, { r: 8, fill: C.bg, stroke: C.line, dash: [4, 4] });
      const COLS = n ? 9 : 13, ROWS = Math.ceil(SLOTS / COLS);
      const sw = cw / COLS, sh = lh / ROWS, nw = Math.min(40, sw - 10), nh = Math.min(24, sh - 12);
      const pos = slot => ({ x: x0 + (slot % COLS + 0.5) * sw, y: ly0 + (Math.floor(slot / COLS) + 0.5) * sh });
      // pointers first, under the nodes
      st.nodes.forEach(nd => {
        if (nd.next < 0) return;
        const p = pos(nd.slot), q = pos(st.nodes[nd.next].slot);
        const ang = Math.atan2(q.y - p.y, q.x - p.x), ex = q.x - Math.cos(ang) * (nw / 2 + 2), ey = q.y - Math.sin(ang) * (nh / 2 + 2);
        alpha(0.55, () => arrow(p.x, p.y, ex, ey, C.violet, 1.1));
      });
      if (st.head >= 0) { const p = pos(st.nodes[st.head].slot); tx('head', p.x, p.y - nh / 2 - 7, { m: 1, s: 9, w: 700, c: C.violet }); }
      const hopIdx = r.lCur && r.lCur.t === 'hop' ? r.lCur.node : -1;
      st.nodes.forEach((nd, k) => {
        const p = pos(nd.slot), hot = k === hopIdx || (k === r.lNew && r.lCur && r.lCur.t !== 'hop');
        box(p.x - nw / 2, p.y - nh / 2, nw, nh, { r: 4, fill: hot ? C.accent : C.surface, stroke: hot ? C.accent : C.a2 });
        if (nw > 26) tx(nd.v, p.x, p.y, { m: 1, s: 10, w: 600, c: hot ? C.surface : C.ink });
      });
    },

    stats(s) {
      const r = s.st.r, done = r.tEnd !== undefined;
      return [
        ['Array: خطوات', fmt(r.aSteps), r.aSteps > 4 ? 'bad' : 'good'],
        ['Linked List: خطوات', fmt(r.lSteps), r.lSteps > 4 ? 'bad' : 'good'],
        ['Array: عناصر اتنقلت / اتنسخت', `${r.aMoves} / ${r.aCopies}`, r.aMoves + r.aCopies ? 'warn' : ''],
        ['Cache lines (Array / List)', r.op === 'get' || r.op === 'iter' ? `${r.aLines.size} / ${r.lLines.size}` : '—', r.lLines.size > r.aLines.size * 2 ? 'warn' : ''],
        ['Resize (copy to 2×) لحد دلوقتي', fmt(s.st.resizes + (r.resized && !done ? 1 : 0))],
        ['ذاكرة: Array / List', `${s.st.arr.cap * 8} B / ${s.st.nodes.length * NODE_BYTES} B`]
      ];
    }
  });

  Lab.registerLesson({
    id: 'array-list', lab: 'dsa', title: 'Array vs Linked List',
    html: Lab.tpl.lesson({
      sim: 'array-list', level: 1,
      terms: ['Array', 'List<T>', 'Linked List', 'Capacity', 'Cache Line'],
      lede: 'نفس الأرقام متخزنة مرتين: فوق في <code>List&lt;long&gt;</code> (array واحدة متجاورة في الذاكرة)، وتحت في <code>LinkedList&lt;long&gt;</code> (كل عنصر node لوحده في حتة مختلفة من الـ heap، والأسهم هي الـ pointers). اختار العملية وشوف كل واحد بيعمل كام خطوة.',
      aria: 'محاكاة بتقارن array متجاورة مع linked list متفرقة في الذاكرة',
      controls: [
        { type: 'seg', p: 'op', label: 'العملية', value: 'get', opts: [['get', 'قراية بالـ index'], ['front', 'إضافة في الأول'], ['append', 'إضافة في الآخر'], ['iter', 'المرور على الكل']] },
        { type: 'range', p: 'n', label: 'عدد العناصر في البداية', min: 4, max: 16, step: 1, value: 10 }
      ],
      idea: `
        <p>الـ <b>Array</b> حتة واحدة متجاورة في الذاكرة. عنوان العنصر رقم i = بداية الـ array + i × حجم العنصر، فالقراية بالـ index خطوة واحدة <code>O(1)</code>. بس الإضافة في الأول لازم تزق كل العناصر خانة <code>O(n)</code>.</p>
        <p><code>List&lt;T&gt;</code> هو array جوّاها <b>Capacity</b>. لما تتملي بيعمل array جديدة ضعف الحجم وينسخ الكل. ده بيحصل نادرًا فالـ <code>Add</code> في المتوسط <code>O(1)</code> (amortized).</p>
        <p>الـ <b>Linked List</b> كل عنصر فيها node فيه القيمة وpointer للي بعده. الإضافة في الأول أو الآخر تغيير pointers بس <code>O(1)</code>، لكن عشان توصل للعنصر رقم i لازم تمشي i خطوة <code>O(n)</code>.</p>`,
      real: `
        <p>آخر 500 نقطة GPS لكل عربية عشان ترسم المسار: دي <code>List</code> أو array. بتضيف في الآخر وبتقرا بالترتيب، والـ array أسرع بكتير في الحالتين لأن الـ CPU بيقرا 64 byte مرة واحدة (cache line) فيها 8 أرقام <code>long</code>. الـ Linked List كل node فيها ممكن تكون cache miss (حوالي 100 ns) لأنها في حتة تانية من الذاكرة.</p>`,
      try: 'اختار «قراية بالـ index»: الـ array خطوة واحدة والـ list بتمشي node node. بعدين «إضافة في الأول»: الآية بتتقلب، الـ array بتزق كل العناصر. وفي «إضافة في الآخر» استنى لحد ما الـ Capacity تتملي وشوف الـ copy لـ array ضعف الحجم.',
      also: 'سجل الرسايل في شات (Add في الآخر وقراية بالترتيب)، والـ order book في التداول، وطابور اللاعبين في لعبة. في الحالات دي كلها الـ array (أو List) بتكسب تقريبًا دايمًا.',
      net: `
<pre><span class="c">// List&lt;T&gt;: array + Count. Capacity بتبدأ 0، أول Add تبقى 4، وبعدين بتتضاعف</span>
var track = new List&lt;GpsPoint&gt;(capacity: 500);   <span class="c">// لو عارف الحجم: مفيش resize خالص</span>
track.Add(p);              <span class="c">// O(1) amortized</span>
var mid = track[250];      <span class="c">// O(1)</span>
track.Insert(0, p);        <span class="c">// O(n): Array.Copy لكل العناصر خانة لقدّام</span>

<span class="c">// LinkedList&lt;T&gt;: doubly linked، كل عنصر LinkedListNode&lt;T&gt; object لوحده</span>
var recent = new LinkedList&lt;GpsPoint&gt;();
var node = recent.AddFirst(p);   <span class="c">// O(1)</span>
recent.Remove(node);             <span class="c">// O(1) لو معاك الـ node نفسه</span>
<span class="c">// مفيش recent[250]: لازم تمشي من الأول</span></pre>`,
      netTitle: 'في .NET',
      deep: [
        '<b>Big-O مش كل حاجة:</b> حتى في العمليات اللي الـ Linked List المفروض تكسب فيها (إضافة في النص)، لازم الأول توصل للمكان (O(n) hops، كل واحدة cache miss محتملة). عمليًا <code>List&lt;T&gt;</code> مع <code>Insert</code> بيكسب لأحجام كبيرة لأن <code>Array.Copy</code> بيستخدم memmove/SIMD على ذاكرة متجاورة.',
        '<b>حجم الـ node في .NET:</b> <code>LinkedListNode&lt;long&gt;</code> object: header + method table (16 bytes على 64-bit) + list + next + prev (3 references × 8) + القيمة 8 = حوالي 48 bytes لرقم 8 bytes. يعني 6 أضعاف الذاكرة، وضغط أكتر على الـ GC.',
        '<b>الـ resize بيعمل garbage:</b> كل مرة الـ capacity تتضاعف، الـ array القديمة بتبقى garbage. فوق 85,000 byte الـ array بتروح الـ Large Object Heap. لو عارف الحجم ابعته في الـ constructor أو استخدم <code>EnsureCapacity</code>.',
        '<b>إمتى الـ Linked List تكسب فعلًا:</b> لما يكون معاك reference للـ node نفسه وعايز تشيله أو تضيف جنبه في O(1)، زي LRU cache: <code>Dictionary&lt;key, LinkedListNode&gt;</code> + <code>LinkedList</code>. ده تصميم أشهر cache في الـ interviews وفي الإنتاج.',
        '<b>تبسيطات:</b> الـ nodes هنا متوزعة عشوائي في الـ heap. في .NET الـ objects اللي اتعملت ورا بعض بتتحط جنب بعض (bump allocation)، فممكن تبقى متجاورة في الأول، وبتتفرق مع الوقت لما objects تانية تتعمل في النص. الـ LinkedList هنا singly linked في الرسم للتبسيط، و.NET doubly linked (next و prev).'
      ]
    })
  });
})();
