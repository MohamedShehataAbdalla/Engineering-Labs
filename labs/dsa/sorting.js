/* DSA · Sorting
   Three real sorts run as generators on copies of the same input. Each yields its actual operations
   (compare i/j, write a value) and the animation replays them at the same rate for all three, so the race and the
   counters are the algorithms' own:
     Insertion   shift bigger elements right, drop the key in place                       O(n²), O(n) on sorted input
     Merge       top-down, merge halves back from an aux copy                            O(n log n) always, stable
     Quick       Lomuto partition, pivot = last element or median-of-three (what .NET uses)  O(n log n) avg, O(n²) worst
   Inputs are GPS points' timestamps: random, nearly sorted (a few late uploads), reversed, or few distinct values. */
(function () {
  "use strict";
  const { clamp, fmt } = Lab.util;
  const { box, tx, alpha } = Lab.draw;

  const HOLD = 2.5, MAXT = 45;

  function* insertion(a) {
    for (let i = 1; i < a.length; i++) {
      const key = a[i]; let j = i - 1;
      while (j >= 0) { yield { c: [j, i] }; if (a[j] > key) { a[j + 1] = a[j]; yield { w: j + 1 }; j--; } else break; }
      a[j + 1] = key; yield { w: j + 1 };
    }
  }
  function* merge(a) {
    const aux = a.slice();
    function* sort(lo, hi) {
      if (hi - lo < 1) return;
      const mid = (lo + hi) >> 1;
      yield* sort(lo, mid); yield* sort(mid + 1, hi);
      for (let k = lo; k <= hi; k++) aux[k] = a[k];
      let i = lo, j = mid + 1;
      for (let k = lo; k <= hi; k++) {
        if (i > mid) a[k] = aux[j++];
        else if (j > hi) a[k] = aux[i++];
        else { yield { c: [i, j] }; a[k] = aux[j] < aux[i] ? aux[j++] : aux[i++]; }
        yield { w: k };
      }
    }
    yield* sort(0, a.length - 1);
  }
  function* quick(a, pivotRule, info) {
    const stack = [[0, a.length - 1, 1]];
    while (stack.length) {
      const [lo, hi, depth] = stack.pop();
      if (lo >= hi) continue;
      info.depth = Math.max(info.depth, depth);
      if (pivotRule === 'median3') {
        const mid = (lo + hi) >> 1;
        // order a[lo], a[mid], a[hi] then move the median to hi
        yield { c: [lo, mid] }; if (a[mid] < a[lo]) { [a[lo], a[mid]] = [a[mid], a[lo]]; yield { w: lo, w2: mid }; }
        yield { c: [mid, hi] }; if (a[hi] < a[mid]) { [a[mid], a[hi]] = [a[hi], a[mid]]; yield { w: mid, w2: hi }; }
        yield { c: [lo, mid] }; if (a[mid] < a[lo]) { [a[lo], a[mid]] = [a[mid], a[lo]]; yield { w: lo, w2: mid }; }
        [a[mid], a[hi]] = [a[hi], a[mid]]; yield { w: mid, w2: hi };
      }
      const p = a[hi]; let i = lo;
      for (let j = lo; j < hi; j++) {
        yield { c: [j, hi], piv: hi };
        if (a[j] < p) { if (i !== j) { [a[i], a[j]] = [a[j], a[i]]; yield { w: i, w2: j, piv: hi }; } i++; }
      }
      if (i !== hi) { [a[i], a[hi]] = [a[hi], a[i]]; yield { w: i, w2: hi }; }
      stack.push([i + 1, hi, depth + 1], [lo, i - 1, depth + 1]);
    }
  }

  function makeInput(s) {
    const n = s.p.n, rnd = s.rng, kind = s.p.input, a = [];
    for (let i = 0; i < n; i++) a.push(i + 1);
    if (kind === 'random') for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    if (kind === 'nearly') for (let k = 0; k < Math.max(1, Math.round(n * 0.05)); k++) { const i = Math.floor(rnd() * n); const v = a.splice(i, 1)[0]; a.push(v); }
    if (kind === 'reversed') a.reverse();
    if (kind === 'few') for (let i = 0; i < n; i++) a[i] = 1 + Math.floor(rnd() * 4) * Math.ceil(n / 4);
    return a;
  }

  const ALGOS = [
    { k: 'ins', name: 'Insertion Sort', mk: (a) => insertion(a) },
    { k: 'mrg', name: 'Merge Sort', mk: (a) => merge(a) },
    { k: 'qck', name: 'Quick Sort', mk: (a, s, info) => quick(a, s.p.pivot, info) }
  ];

  Lab.registerSim('sorting', {
    height: 380, warm: 0,

    init(s) { s.st = {}; this.restart(s); },
    onParam(s) { this.restart(s); },

    restart(s) {
      const input = makeInput(s), n = input.length;
      const rate = Math.max(30, n * Math.log2(n) * 2 / 4.5);   // merge sort ≈ 4.5 s on screen
      s.st = {
        input, t0: s.t, rate, tEnd: null,
        lanes: ALGOS.map(A => { const a = input.slice(), info = { depth: 0 }; return { A, a, info, gen: A.mk(a, s, info), cmp: 0, wr: 0, done: false, cur: null, tDone: null, ops: 0 }; })
      };
    },

    step(s) {
      const st = s.st, want = Math.floor((s.t - st.t0) * st.rate);
      for (const L of st.lanes) {
        while (!L.done && L.ops < want) {
          const r = L.gen.next();
          if (r.done) { L.done = true; L.cur = null; L.tDone = s.t - st.t0; break; }
          L.ops++; L.cur = r.value;
          if (r.value.c) L.cmp++;
          if (r.value.w !== undefined) L.wr += r.value.w2 !== undefined ? 2 : 1;
        }
      }
      const all = st.lanes.every(L => L.done);
      if (all && st.tEnd === null) st.tEnd = s.t;
      if ((all && s.t - st.tEnd > HOLD) || s.t - st.t0 > MAXT) this.restart(s);
    },

    draw(s) {
      const C = s.C, st = s.st, W = s.w, H = s.h, n = s.narrow, N = st.input.length;
      const x0 = 14, x1 = W - 14, lh = (H - 12) / 3, maxV = Math.max(...st.input);
      st.lanes.forEach((L, k) => {
        const y0 = 8 + k * lh, top = y0 + 24, bh = lh - 34, bw = (x1 - x0) / N;
        const cmpd = L.done ? null : L.cur && L.cur.c, wr = L.done ? null : L.cur;
        const title = L.A.k === 'qck' ? `${L.A.name} (pivot: ${s.p.pivot === 'median3' ? 'median of 3' : 'last'})` : L.A.name;
        tx(title, x0, y0 + 9, { m: 1, s: n ? 10 : 12, w: 700, a: 'left', c: L.done ? C.a2 : C.ink });
        const info = `${fmt(L.cmp)} cmp · ${fmt(L.wr)} writes` + (L.A.k === 'qck' ? ` · depth ${L.info.depth}` : '') + (L.done ? `  ✓ ${L.tDone.toFixed(1)}s` : '');
        tx(info, x1, y0 + 9, { m: 1, s: n ? 8.5 : 10.5, w: 600, a: 'right', c: L.done ? C.a2 : C.muted });
        for (let i = 0; i < N; i++) {
          const h = Math.max(2, L.a[i] / maxV * bh), x = x0 + i * bw;
          let c = L.done ? C.a2 : C.muted;
          if (wr && (wr.w === i || wr.w2 === i)) c = C.violet;
          if (cmpd && (cmpd[0] === i || cmpd[1] === i)) c = C.accent;
          if (wr && wr.piv === i) c = C.bad;
          box(x + (bw > 5 ? 1 : 0), top + bh - h, Math.max(1, bw - (bw > 5 ? 2 : 0.5)), h, { r: bw > 6 ? 2 : 0, fill: c, stroke: null });
        }
      });
    },

    stats(s) {
      const [I, M, Q] = s.st.lanes, nlog = s.st.input.length * Math.log2(s.st.input.length);
      const tone = L => L.cmp > nlog * 3 ? 'bad' : L.cmp > nlog * 1.5 ? 'warn' : 'good';
      return [
        ['Insertion: مقارنات', fmt(I.cmp), tone(I)],
        ['Merge: مقارنات', fmt(M.cmp), tone(M)],
        ['Quick: مقارنات', fmt(Q.cmp), tone(Q)],
        ['n · log₂ n (للمقارنة)', fmt(Math.round(nlog))],
        ['Quick: عمق الـ recursion', String(Q.info.depth), Q.info.depth > 2 * Math.log2(s.st.input.length) ? 'bad' : ''],
        ['Writes (I / M / Q)', `${fmt(I.wr)} / ${fmt(M.wr)} / ${fmt(Q.wr)}`]
      ];
    }
  });

  Lab.registerLesson({
    id: 'sorting', lab: 'dsa', title: 'Sorting',
    html: Lab.tpl.lesson({
      sim: 'sorting', level: 2,
      terms: ['Insertion Sort', 'Merge Sort', 'Quick Sort', 'Pivot', 'Stable'],
      lede: '3 خوارزميات حقيقية بتترتب نفس الداتا (timestamps نقط GPS) وبنفس السرعة: كل عملية مقارنة أو كتابة بتاخد نفس الوقت. البرتقالي = مقارنة، والبنفسجي = كتابة، والأحمر = الـ pivot.',
      aria: 'سباق بين Insertion و Merge و Quick sort على نفس الداتا',
      controls: [
        { type: 'seg', p: 'input', label: 'شكل الداتا', value: 'random', opts: [['random', 'عشوائية'], ['nearly', 'شبه مترتبة'], ['reversed', 'معكوسة'], ['few', 'قيم قليلة متكررة']] },
        { type: 'seg', p: 'pivot', label: 'الـ pivot في Quick Sort', value: 'last', opts: [['last', 'آخر عنصر'], ['median3', 'median of 3 (زي .NET)']] },
        { type: 'range', p: 'n', label: 'عدد العناصر', min: 16, max: 120, step: 8, value: 64 }
      ],
      idea: `
        <p><b>Insertion Sort</b>: بتاخد عنصر عنصر وتحطه في مكانه في الجزء المترتب، زي ما بترتب كوتشينة في إيدك. <code>O(n²)</code>، بس لو الداتا شبه مترتبة بتبقى تقريبًا <code>O(n)</code>.</p>
        <p><b>Merge Sort</b>: قسّم نصين، رتّب كل نص، وادمجهم. دايمًا <code>O(n log n)</code> وبيحافظ على ترتيب العناصر المتساوية (<b>Stable</b>)، بس محتاج ذاكرة إضافية.</p>
        <p><b>Quick Sort</b>: اختار <b>pivot</b>، حط كل الأصغر منه شمال والأكبر يمين، وكرر على كل ناحية. متوسطه <code>O(n log n)</code> ومن غير ذاكرة إضافية، بس لو الـ pivot وحش في كل مرة بيبقى <code>O(n²)</code>.</p>`,
      real: `
        <p>نقط GPS بتوصل تقريبًا بالترتيب، وكام نقطة متأخرة. ده بالظبط «شبه مترتبة»: الـ Insertion Sort بيكسب الكل فيها لأن كل عنصر بيتحرك خطوات قليلة. والـ Quick Sort بـ pivot = آخر عنصر بيتعب مع أي جزء مترتب، لأن آخر عنصر فيه هو الأكبر، فالـ partition بيقسم لـ 0 و n−1 بدل نصين.</p>
        <p>ولو بترتب العربيات بالحالة (Active / Idle / Offline) وبعدين بالوقت، محتاج sort <b>stable</b> عشان الترتيب التاني ميبوظش الأول.</p>`,
      try: 'اختار «معكوسة» مع pivot «آخر عنصر»: الـ Quick Sort بيعمل نفس مقارنات الـ Insertion (n²/2) وعمق الـ recursion بيوصل n−1. غيّر الـ pivot لـ «median of 3» وشوف إزاي بيرجع سريع. بعدين «شبه مترتبة»: الـ Insertion Sort اللي كان أبطأ واحد بقى الأسرع.',
      also: 'ترتيب الـ order book بالسعر في التداول، وترتيب سجل العمليات البنكية بالتاريخ، وleaderboard في لعبة. وقاعدة البيانات بتعمل sort لما مفيش index ينفع للـ ORDER BY (Sort operator في الـ plan).',
      net: `
<pre><span class="c">// Array.Sort / List.Sort: Introsort، مش stable</span>
points.Sort((a, b) =&gt; a.Ts.CompareTo(b.Ts));
<span class="c">//  - partition صغير (≤ 16 عنصر) → Insertion Sort</span>
<span class="c">//  - الـ recursion عمق أكتر من حوالي 2·log₂(n) → Heapsort (ضمان O(n log n))</span>
<span class="c">//  - غير كده → Quicksort بـ median-of-three pivot</span>

<span class="c">// LINQ OrderBy: stable. الحالة الأول وبعدين الوقت من غير ما يبوظوا بعض</span>
var view = vehicles.OrderBy(v =&gt; v.Status).ThenBy(v =&gt; v.LastSeen);

<span class="c">// .NET 8+: لو مش محتاج تحتفظ بالأصل</span>
Span&lt;long&gt; ts = buffer.AsSpan(0, count);
ts.Sort();</pre>`,
      netTitle: 'في .NET',
      deep: [
        '<b>Introsort هو الإجابة العملية:</b> Quick Sort سريع في الواقع (cache-friendly، من غير allocation)، والـ median-of-three بيحل مشكلة الداتا المترتبة، والتحويل لـ Heapsort لما الـ recursion يعمق بيقفل باب الـ O(n²) نهائيًا، والـ Insertion Sort بيخلّص الأجزاء الصغيرة أسرع من أي حاجة.',
        '<b>الـ Stability:</b> <code>Array.Sort</code> مش stable: عنصرين متساويين ممكن يتبادلوا. لو محتاج stable استخدم <code>OrderBy</code> (بيعمل allocation) أو ضيف الـ index كـ tie-breaker في الـ comparer.',
        '<b>قيم كتير متكررة:</b> الـ Lomuto partition (اللي هنا) بيتعب مع التكرار لأن كل القيم المساوية للـ pivot بتروح ناحية واحدة. الحل three-way partition (أصغر / يساوي / أكبر)، أو partition بيوقف على المتساوي من الناحيتين زي Hoare.',
        '<b>Comparer وحش = نتيجة غلط أو exception:</b> الـ comparer لازم يكون متسق (لو a&lt;b يبقى b&gt;a، ومتعدّي). <code>(a, b) =&gt; a.Speed &gt; b.Speed ? 1 : -1</code> مش بيرجّع 0 أبدًا، وده ممكن يخلّي <code>Array.Sort</code> يرمي exception أو يرجّع ترتيب غلط من غير أي تحذير.',
        '<b>تبسيطات:</b> كل مقارنة وكل كتابة بتاخد نفس الوقت هنا. في الحقيقة Merge Sort بيكتب في array تانية (allocation + cache)، وQuick Sort بيبدّل في مكانه، وده بيخلّي Quick أسرع عمليًا رغم إن عدد مقارناته أكتر شوية.'
      ]
    })
  });
})();
