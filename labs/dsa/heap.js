/* DSA · Heap / Priority Queue
   A real d-ary min-heap stored in an array (children of i are d·i+1 … d·i+d, parent is (i−1)/d):
     Enqueue  append at the end, sift up: compare with the parent, swap while smaller
     Dequeue  take the root, move the last element to the root, sift down: swap with the smallest child
   d = 2 is the textbook binary heap; d = 4 is what .NET's PriorityQueue<TElement,TPriority> uses.
   The operations run as generators on the real array; every compare and swap shown is one they made.
   Priority = minutes left before a delivery's deadline (smaller = more urgent). */
(function () {
  "use strict";
  const { clamp, lerp, fmt, f1 } = Lab.util;
  const { box, tx, dot, line, circ, alpha } = Lab.draw;

  const RATE = 4.2, HOLD = 0.5;

  function* siftUp(a, i, d, info) {
    while (i > 0) {
      const p = Math.floor((i - 1) / d);
      info.cmp++; yield { c: [i, p] };
      if (a[i].p < a[p].p) { [a[i], a[p]] = [a[p], a[i]]; info.swp++; yield { s: [i, p] }; i = p; } else break;
    }
  }
  function* siftDown(a, i, d, info) {
    for (;;) {
      const first = d * i + 1;
      if (first >= a.length) break;
      let m = first;
      for (let c = first + 1; c < Math.min(first + d, a.length); c++) { info.cmp++; yield { c: [c, m] }; if (a[c].p < a[m].p) m = c; }
      info.cmp++; yield { c: [m, i] };
      if (a[m].p < a[i].p) { [a[i], a[m]] = [a[m], a[i]]; info.swp++; yield { s: [i, m] }; i = m; } else break;
    }
  }
  function* enqueue(a, item, d, info) { a.push(item); yield { add: a.length - 1 }; yield* siftUp(a, a.length - 1, d, info); }
  function* dequeue(a, d, info) {
    const top = a[0]; info.out = top;
    yield { take: 0 };
    const last = a.pop();
    if (a.length) { a[0] = last; yield { move: 0 }; yield* siftDown(a, 0, d, info); }
  }

  Lab.registerSim('heap', {
    height: 380, warm: 0,

    init(s) {
      s.st = { a: [], id: 0, op: null, hist: { enq: [], deq: [] }, served: [], sortedMoves: 0, pause: 0 };
      // start with a few deliveries already waiting
      for (let k = 0; k < 9; k++) { const g = enqueue(s.st.a, this.item(s), s.p.d, { cmp: 0, swp: 0 }); while (!g.next().done); }
    },
    onParam(s) { this.init(s); },
    item(s) { return { id: ++s.st.id, p: 5 + Math.floor(s.rng() * 115) }; },

    plan(s) {
      const st = s.st, size = st.a.length, target = s.p.size;
      const enq = size < 2 || (size < target * 1.3 && s.rng() < (size < target ? 0.72 : 0.3));
      const info = { cmp: 0, swp: 0, out: null };
      let gen, label, item = null;
      if (enq) {
        item = this.item(s);
        // what a sorted List would have to shift to keep order (for comparison)
        const sorted = st.a.map(x => x.p).sort((x, y) => x - y);
        let pos = sorted.findIndex(v => v > item.p); if (pos < 0) pos = sorted.length;
        info.sortedMoves = sorted.length - pos;
        gen = enqueue(st.a, item, s.p.d, info); label = `Enqueue(delivery #${item.id}, priority ${item.p} min)`;
      } else { gen = dequeue(st.a, s.p.d, info); label = 'Dequeue() → the most urgent delivery'; }
      st.op = { enq, gen, info, label, cur: null, t0: s.t, n: 0, done: false, item };
    },

    step(s) {
      const st = s.st;
      if (!st.op && s.t >= st.pause) this.plan(s);
      const op = st.op;
      if (!op) return;
      const want = Math.floor((s.t - op.t0) * RATE) + 1;
      while (!op.done && op.n < want) {
        const r = op.gen.next();
        if (r.done) { op.done = true; op.tDone = s.t; break; }
        op.n++; op.cur = r.value;
      }
      if (op.done && s.t - op.tDone > HOLD) {
        (op.enq ? st.hist.enq : st.hist.deq).push(op.info.cmp);
        for (const h of [st.hist.enq, st.hist.deq]) if (h.length > 30) h.shift();
        if (!op.enq && op.info.out) { st.served.unshift(op.info.out); st.served.length = Math.min(st.served.length, 6); }
        st.last = op; st.op = null; st.pause = s.t + 0.15;
      }
    },

    draw(s) {
      const C = s.C, st = s.st, a = st.a, d = s.p.d, W = s.w, H = s.h, n = s.narrow, op = st.op || st.last;
      const x0 = 14, x1 = W - 14;
      if (op) tx(op.label, x0, 14, { m: 1, s: n ? 9.5 : 12, w: 700, a: 'left', c: op.enq ? C.accent : C.a2 });
      const cur = st.op && st.op.cur;
      const hot = new Set(cur ? (cur.c || cur.s || [cur.add ?? cur.take ?? cur.move]) : []);
      const swapping = cur && cur.s;

      /* tree: level by level, children of i at d·i+1 … d·i+d */
      const levels = []; for (let i = 0, L = 0, cnt = 1; i < Math.max(1, a.length); L++) { levels.push([i, Math.min(a.length, i + cnt)]); i += cnt; cnt *= d; }
      const top = 44, treeH = H - 120, dy = Math.min(62, treeH / Math.max(1, levels.length - 1 || 1));
      const pos = i => {
        let L = 0, start = 0, cnt = 1; while (i >= start + cnt) { start += cnt; cnt *= d; L++; }
        return { x: x0 + (i - start + 0.5) / cnt * (x1 - x0), y: top + L * dy };
      };
      const r = clamp(Math.min(dy * 0.3, (x1 - x0) / Math.pow(d, levels.length - 1) * 0.45), 6, 15);
      for (let i = 1; i < a.length; i++) { const p = pos(i), q = pos(Math.floor((i - 1) / d)); line(p.x, p.y, q.x, q.y, C.line, 1.2); }
      for (let i = 0; i < a.length; i++) {
        const p = pos(i), isHot = hot.has(i);
        const stroke = i === 0 ? C.a2 : isHot ? C.accent : C.violet;
        dot(p.x, p.y, r, isHot ? (swapping ? C.violet : C.accent) : C.surface);
        circ(p.x, p.y, r, isHot ? (swapping ? C.violet : C.accent) : stroke, i === 0 ? 2.4 : 1.4);
        if (r >= 9) tx(a[i].p, p.x, p.y, { m: 1, s: r > 12 ? 10 : 8.5, w: 700, c: isHot ? C.surface : C.ink });
      }
      if (!a.length) tx('empty', (x0 + x1) / 2, top, { m: 1, s: 11, c: C.muted });
      tx('root = minimum', pos(0).x + r + 6, top - 4, { m: 1, s: 9.5, a: 'left', c: C.a2 });

      /* the same heap as the array it really is */
      const ay = H - 58, cw = Math.min(30, (x1 - x0) / Math.max(a.length, 16));
      tx(`array: children of i at ${d}·i+1 … ${d}·i+${d}`, x0, ay - 12, { m: 1, s: n ? 8.5 : 10, a: 'left', c: C.muted });
      for (let i = 0; i < a.length; i++) {
        const x = x0 + i * cw, isHot = hot.has(i);
        box(x + 0.5, ay, cw - 1, 22, { r: 3, fill: isHot ? (swapping ? C.violet : C.accent) : C.surface, stroke: i === 0 ? C.a2 : C.violet });
        if (cw > 20) tx(a[i].p, x + cw / 2, ay + 11, { m: 1, s: 9, w: 600, c: isHot ? C.surface : C.ink });
        if (cw > 20 && !n) tx(i, x + cw / 2, ay + 32, { m: 1, s: 8, c: C.muted });
      }
      // just-served deliveries leave in priority order
      if (st.served.length && !n) {
        tx('served: ' + st.served.map(x => x.p).join(' ← '), x1, ay - 12, { m: 1, s: 10, w: 600, a: 'right', c: C.a2 });
      }
    },

    stats(s) {
      const st = s.st, h = st.hist, avg = v => v.length ? f1(v.reduce((x, y) => x + y, 0) / v.length) : '—';
      const levels = st.a.length ? Math.floor(Math.log(st.a.length * (s.p.d - 1) + 1) / Math.log(s.p.d) - 1e-9) + 1 : 0;
      const last = st.last;
      return [
        ['عدد العناصر', String(st.a.length)],
        ['عدد المستويات', String(levels), 'good'],
        ['Enqueue: متوسط المقارنات', avg(h.enq), 'good'],
        ['Dequeue: متوسط المقارنات', avg(h.deq), ''],
        ['آخر عملية: مقارنات / swaps', last ? `${last.info.cmp} / ${last.info.swp}` : '—'],
        ['لو List مترتبة: نقل عناصر للإضافة', last && last.enq ? String(last.info.sortedMoves) : '—', last && last.enq && last.info.sortedMoves > 5 ? 'warn' : '']
      ];
    }
  });

  Lab.registerLesson({
    id: 'heap', lab: 'dsa', title: 'Heap / Priority Queue',
    html: Lab.tpl.lesson({
      sim: 'heap', level: 2,
      terms: ['Heap', 'Priority Queue', 'Sift Up', 'Sift Down', 'd-ary'],
      lede: 'طلبات توصيل والأولوية = الدقايق الباقية على الـ deadline (الأصغر أهم). فوق الـ heap كشجرة، وتحت نفس الـ heap زي ما هو فعلًا: array عادية. البرتقالي مقارنة، والبنفسجي swap.',
      aria: 'محاكاة min-heap بيتعمل فيها enqueue و dequeue',
      controls: [
        { type: 'seg', p: 'd', label: 'عدد الأبناء لكل node', value: 2, opts: [[2, 'Binary (2)'], [4, '4-ary (زي .NET)']] },
        { type: 'range', p: 'size', label: 'حجم الطابور تقريبًا', min: 6, max: 30, step: 1, value: 14 }
      ],
      idea: `
        <p>الـ <b>Priority Queue</b>: طابور بيطلّع الأهم الأول مش الأقدم. أشهر طريقة تبنيه هي <b>Heap</b>: شجرة كل أب فيها أصغر من (أو يساوي) أولاده، فالأصغر دايمًا في الـ root. ومش مرتبة بالكامل، وده سر سرعتها.</p>
        <p><b>Enqueue</b>: حط العنصر في الآخر واطلع بيه لفوق (<b>Sift Up</b>) طول ما هو أصغر من أبوه. <b>Dequeue</b>: خد الـ root، حط آخر عنصر مكانه، وانزل بيه (<b>Sift Down</b>) مع أصغر ابن. الاتنين <code>O(log n)</code>. والشجرة مش objects: هي array، وأبناء العنصر i في <code>2i+1</code> و<code>2i+2</code>.</p>`,
      real: `
        <p>Dispatcher بيوزّع طلبات التوصيل: كل ما سواق يفضى، عايز أكتر طلب مستعجل. لو عندك 5,000 طلب مستني في <code>List</code> مترتبة، كل طلب جديد بيزق آلاف العناصر. لو <code>List</code> مش مترتبة، كل Dequeue بيدوّر في الـ 5,000. الـ heap بيعمل الاتنين في حوالي 13 مقارنة.</p>
        <p>ونفس الشيء: «العربيات اللي ميعاد صيانتها قرّب»، و timers، و Dijkstra في <a href="#/dsa/dijkstra">أقصر طريق</a>.</p>`,
      try: 'راقب «لو List مترتبة: نقل عناصر» في كل Enqueue: ساعات عشرات النقلات، والـ heap بيعمل 1-3 مقارنات. بعدين بدّل لـ 4-ary: الشجرة بتبقى أقصر (مستويات أقل) فالـ Enqueue أرخص، بس الـ Dequeue بيقارن 4 أبناء في كل مستوى.',
      also: 'أولوية تنفيذ الأوامر في التداول، وأولوية المكالمات في call center، وأقرب حدث في game loop أو محاكاة، وأولوية التنبيهات (حادثة قبل تجاوز سرعة).',
      net: `
<pre><span class="c">// .NET 6+: PriorityQueue&lt;TElement, TPriority&gt; (min-heap، 4-ary)</span>
var pending = new PriorityQueue&lt;Delivery, DateTime&gt;();
pending.Enqueue(d, d.Deadline);                  <span class="c">// O(log n)</span>
if (pending.TryDequeue(out var next, out var due)) Assign(next);

<span class="c">// max-heap: اعكس الـ comparer</span>
var byScore = new PriorityQueue&lt;Player, int&gt;(Comparer&lt;int&gt;.Create((a, b) =&gt; b.CompareTo(a)));

<span class="c">// Top-K من stream كبير: heap بحجم K بدل ما ترتب الكل</span>
var top = new PriorityQueue&lt;Vehicle, double&gt;();
foreach (var v in fleet) { top.Enqueue(v, v.Speed); if (top.Count &gt; 10) top.Dequeue(); }</pre>`,
      netTitle: 'في .NET',
      deep: [
        '<b>ليه 4-ary؟</b> الارتفاع log₄ n بدل log₂ n (النص)، فالـ sift up أرخص. والـ sift down بيقارن 4 أبناء في كل مستوى، بس الأبناء الأربعة جنب بعض في الـ array (غالبًا نفس الـ cache line). عمليًا ده أسرع من الـ binary heap على hardware حديث.',
        '<b>مش stable ومفيش Update:</b> عنصرين بنفس الأولوية ممكن يطلعوا بأي ترتيب. و<code>PriorityQueue</code> في .NET مفيهوش «غيّر أولوية عنصر موجود» (decrease-key). الحل الشائع: ضيف نسخة جديدة بالأولوية الجديدة وتجاهل القديمة لما تطلع (lazy deletion).',
        '<b>Heapify في O(n):</b> لو عندك كل العناصر من الأول، <code>EnqueueRange</code> أو الـ constructor اللي بياخد items بيبني الـ heap في O(n) (sift down من النص للأول) بدل n × O(log n).',
        '<b>Heap ≠ Sorted:</b> الـ array مش مترتبة: بتضمن بس إن الـ root أصغر حاجة. لو عايز تعدّي على كل العناصر بالترتيب لازم تعمل Dequeue لكلهم (O(n log n)) = Heapsort، وده اللي Introsort بيلجأ له في <a href="#/dsa/sorting">Sorting</a>.',
        '<b>تبسيطات:</b> الأولويات أرقام صحيحة من 5 لـ 120 دقيقة. الطلبات بتدخل وتخرج بالتبادل عشان الطابور يفضل قريب من الحجم اللي اخترته.'
      ]
    })
  });
})();
