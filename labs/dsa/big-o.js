/* DSA · Big-O بالعين
   Five lanes answer the same kind of question on the same n, each with a different algorithm. Step counts are real:
     O(1)       Dictionary lookup: 1 bucket hit + the keys chained in that bucket (load factor ≤ 1 → Poisson chain)
     O(log n)   binary search on a sorted array for a key that is NOT there (worst case), counting probes
     O(n)       linear search for the same missing key: every element is compared
     O(n log n) merge sort comparisons, counted by actually sorting for n ≤ 100K (formula above that, labelled)
     O(n²)      "compare every pair" duplicate check: exactly n(n-1)/2 comparisons
   All lanes spend steps at the same animation rate (a full O(n) pass ≈ 3 s), so the race shows the ratio honestly.
   The wall-clock line assumes ~1 ns per step: an approximation, and it says so. */
(function () {
  "use strict";
  const { clamp, lerp, fmt } = Lab.util;
  const { box, tx, dot, line, alpha } = Lab.draw;

  const NS = [10, 100, 1e3, 1e4, 1e5, 1e6, 1e7];
  const CYCLE = 4.6, PASS = 3;            // seconds per round, seconds a full O(n) pass takes on screen
  const SORT_REAL_MAX = 1e5;

  const LANES = [
    { k: '1', name: 'O(1)', what: 'Dictionary[key]', sh: 'Dictionary', c: 'good' },
    { k: 'log', name: 'O(log n)', what: 'BinarySearch', sh: 'BinarySearch', c: 'good' },
    { k: 'n', name: 'O(n)', what: 'List.Contains', sh: 'Contains', c: 'accent' },
    { k: 'nlog', name: 'O(n log n)', what: 'Sort (merge)', sh: 'Sort', c: 'accent' },
    { k: 'n2', name: 'O(n²)', what: 'compare every pair', sh: 'all pairs', c: 'bad' }
  ];
  const curve = { '1': () => 1, log: n => Math.log2(n), n: n => n, nlog: n => n * Math.log2(n), n2: n => n * n };

  /** merge sort on random data, counting comparisons (bottom-up, no recursion) */
  function mergeCompares(n, rnd) {
    let a = new Float64Array(n), b = new Float64Array(n), cmp = 0;
    for (let i = 0; i < n; i++) a[i] = rnd();
    for (let w = 1; w < n; w *= 2) {
      for (let lo = 0; lo < n; lo += 2 * w) {
        const mid = Math.min(lo + w, n), hi = Math.min(lo + 2 * w, n);
        let i = lo, j = mid, k = lo;
        while (i < mid && j < hi) { cmp++; b[k++] = a[i] <= a[j] ? a[i++] : a[j++]; }
        while (i < mid) b[k++] = a[i++];
        while (j < hi) b[k++] = a[j++];
      }
      const t = a; a = b; b = t;
    }
    return cmp;
  }
  /** binary search over the implicit sorted array a[i] = i, counting probes (a key between two values is never found) */
  function binaryProbes(n, key) {
    let lo = 0, hi = n - 1, p = 0;
    while (lo <= hi) { p++; const mid = (lo + hi) >> 1; if (mid === key) return p; if (mid < key) lo = mid + 1; else hi = mid - 1; }
    return p;
  }
  /** linear search, counting comparisons */
  function linearCompares(n, key) { if (n > 1e6) return Number.isInteger(key) && key < n ? key + 1 : n; let c = 0; for (let i = 0; i < n; i++) { c++; if (i === key) break; } return c; }
  /** keys sharing a bucket with ours at load factor ~1: Poisson(1) */
  function poisson(lambda, rnd) { const L = Math.exp(-lambda); let k = 0, p = 1; do { k++; p *= rnd(); } while (p > L); return k - 1; }

  function human(ns) {
    if (ns < 1e3) return Math.round(ns) + ' ns';
    if (ns < 1e6) return (ns / 1e3).toFixed(ns < 1e4 ? 1 : 0) + ' µs';
    if (ns < 1e9) return (ns / 1e6).toFixed(ns < 1e7 ? 1 : 0) + ' ms';
    const s = ns / 1e9;
    if (s < 120) return s.toFixed(s < 10 ? 1 : 0) + ' s';
    if (s < 7200) return Math.round(s / 60) + ' min';
    if (s < 172800) return Math.round(s / 3600) + ' h';
    if (s < 3.15e7 * 2) return Math.round(s / 86400) + ' days';
    return fmt(s / 3.15e7) + ' years';
  }
  const short = v => v >= 1e12 ? (v / 1e12).toFixed(1) + 'T' : v >= 1e9 ? (v / 1e9).toFixed(1) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e4 ? (v / 1e3).toFixed(0) + 'K' : fmt(v);

  Lab.registerSim('big-o', {
    height: 330, warm: 0.6,

    init(s) { s.st = { r: null, rounds: 0 }; this.round(s); },
    onParam(s) { this.round(s); },

    round(s) {
      const n = NS[s.p.n], rnd = s.rng, target = Math.floor(rnd() * n) + 0.5;   // a vehicle id that is not in the fleet
      const sortReal = n <= SORT_REAL_MAX;
      const steps = {
        '1': 1 + poisson(1, rnd),
        log: binaryProbes(n, target),
        n: linearCompares(n, target),
        nlog: sortReal ? mergeCompares(n, rnd) : Math.round(n * Math.log2(n) - 1.25 * n),
        n2: n * (n - 1) / 2
      };
      s.st.r = { t0: s.t, n, target, steps, sortReal, rate: n / PASS };
      s.st.rounds++;
    },

    step(s) { if (s.t - s.st.r.t0 >= CYCLE) this.round(s); },

    done(s, k) { const r = s.st.r; return Math.min(r.steps[k], Math.floor((s.t - r.t0) * r.rate) + 1); },

    draw(s) {
      const C = s.C, r = s.st.r, W = s.w, H = s.h, n = s.narrow;
      const chartW = n ? 0 : Math.min(250, W * 0.32);
      const x0 = 14, x1 = W - 14 - (chartW ? chartW + 18 : 0);
      const nameW = n ? 78 : 118, barX = x0 + nameW, barW = x1 - barX;
      const head = `n = ${fmt(r.n)} · missing key (worst case)`, rate = `same speed for all: ${fmt(Math.round(r.rate))} steps/s`;
      tx(head, x0, 18, { m: 1, s: n ? 10 : 12, w: 600, a: 'left', c: C.accent });
      if (Lab.draw.textW(head, { m: 1, s: 12, w: 600 }) + Lab.draw.textW(rate, { m: 1, s: 10 }) + 30 < x1 - x0) tx(rate, x1, 18, { m: 1, s: 10, a: 'right', c: C.muted });

      const top = 44, laneH = (H - top - 14) / LANES.length;
      LANES.forEach((L, i) => {
        const y = top + i * laneH, cy = y + laneH * 0.42, col = C[L.c];
        const total = r.steps[L.k], did = this.done(s, L.k), k = did / total, fin = did >= total;
        tx(L.name, x0, cy - 7, { m: 1, s: n ? 11 : 13, w: 700, a: 'left', c: col });
        tx(n ? L.sh : L.what, x0, cy + 9, { m: 1, s: n ? 8.5 : 10, a: 'left', c: C.muted });
        box(barX, cy - 9, barW, 18, { r: 5, fill: C.surface, stroke: C.line });
        if (k > 0) box(barX, cy - 9, Math.max(6, barW * k), 18, { r: 5, fill: col, stroke: null });
        if (!fin) dot(barX + barW * k, cy, 4, C.ink);
        const lbl = `${short(did)} / ${short(total)} steps`;
        tx(lbl, barX + 6, cy + 20, { m: 1, s: n ? 9 : 10, a: 'left', c: C.muted });
        tx(fin ? '✓ ≈ ' + human(total) : '≈ ' + human(total), barX + barW, cy + 20, { m: 1, s: n ? 9 : 10, w: 600, a: 'right', c: fin ? C.a2 : col });
      });

      /* growth curves on log-log axes, with the current n marked */
      if (chartW) {
        const cx0 = W - 14 - chartW, cx1 = W - 14, cy0 = 44, cy1 = H - 34;
        box(cx0, cy0 - 10, chartW, cy1 - cy0 + 28, { r: 8, fill: C.surface, stroke: C.line });
        const px0 = cx0 + 12, px1 = cx1 - 10, py0 = cy0 + 6, py1 = cy1 - 8;
        const lx = v => lerp(px0, px1, Math.log10(v) / 7), ly = v => lerp(py1, py0, clamp(Math.log10(Math.max(1, v)) / 14, 0, 1));
        line(px0, py1, px1, py1, C.line); line(px0, py1, px0, py0, C.line);
        tx('n →', px1, py1 + 12, { m: 1, s: 9, a: 'right', c: C.muted });
        tx('steps (log)', px0 + 2, py0 - 2, { m: 1, s: 9, a: 'left', c: C.muted });
        LANES.forEach(L => {
          const X = s.ctx; X.beginPath();
          for (let e = 1; e <= 7.0001; e += 0.1) { const v = Math.pow(10, e), x = lx(v), y = ly(curve[L.k](v)); if (e === 1) X.moveTo(x, y); else X.lineTo(x, y); }
          X.strokeStyle = C[L.c]; X.lineWidth = 1.6; X.stroke();
          dot(lx(r.n), ly(r.steps[L.k]), 3.5, C[L.c]);
        });
        alpha(0.7, () => line(lx(r.n), py0, lx(r.n), py1, C.ink, 1, [3, 3]));
      }
    },

    stats(s) {
      const r = s.st.r, st = r.steps;
      return [
        ['n', fmt(r.n)],
        ['O(log n): probes', fmt(st.log), 'good'],
        ['O(n): مقارنات', fmt(st.n), st.n > 1e5 ? 'warn' : ''],
        [r.sortReal ? 'O(n log n): مقارنات (اتعدّت)' : 'O(n log n): مقارنات (بالمعادلة)', short(st.nlog), st.nlog > 1e7 ? 'warn' : ''],
        ['O(n²): مقارنات', short(st.n2), st.n2 > 1e9 ? 'bad' : st.n2 > 1e6 ? 'warn' : ''],
        ['O(n²) ÷ O(n log n)', '× ' + short(Math.max(1, st.n2 / st.nlog)), st.n2 / st.nlog > 1000 ? 'bad' : '']
      ];
    }
  });

  Lab.registerLesson({
    id: 'big-o', lab: 'dsa', title: 'Big-O بالعين',
    html: Lab.tpl.lesson({
      sim: 'big-o', level: 1,
      terms: ['Big-O', 'O(1)', 'O(log n)', 'O(n)', 'O(n log n)', 'O(n²)'],
      lede: '5 خوارزميات بتشتغل على نفس الـ n وبنفس السرعة بالظبط: كل واحدة بتصرف خطوة في نفس الوقت. اللي بيفرق بينهم هو عدد الخطوات بس. السؤال: «العربية دي في الـ fleet؟» لعربية مش موجودة، ودي أسوأ حالة للبحث. على اليمين منحنى كل واحدة والـ n الحالي عليه.',
      aria: 'سباق بين 5 خوارزميات بتعقيدات مختلفة على نفس عدد العناصر',
      controls: [
        { type: 'range', p: 'n', label: 'عدد العناصر n', min: 0, max: 6, step: 1, value: 2, map: ['10', '100', '1K', '10K', '100K', '1M', '10M'] }
      ],
      idea: `
        <p>الـ <b>Big-O</b> بيوصف عدد الخطوات بيكبر إزاي لما الداتا تكبر. مش بيقيس الوقت بالثواني، وبيهمل الثوابت. <code>O(n)</code> معناها لو الداتا اتضاعفت الخطوات بتتضاعف، و<code>O(n²)</code> معناها بتتضرب في 4.</p>
        <p><b>O(1)</b>: عدد خطوات ثابت مهما كان n (زي <code>Dictionary</code>). <b>O(log n)</b>: كل خطوة بتقسم المشكلة نصين، فمليون عنصر محتاجين حوالي 20 خطوة. <b>O(n)</b>: بتعدّي على كل عنصر مرة. <b>O(n log n)</b>: أحسن sort عام ممكن. <b>O(n²)</b>: loop جوه loop على نفس الداتا.</p>`,
      real: `
        <p>عندك 10,000 عربية وعايز تعرف «العربية دي موجودة في الـ fleet؟» على كل رسالة GPS. بـ <code>List.Contains</code> ده 10,000 مقارنة × 1,000 رسالة في الثانية = 10 مليون مقارنة كل ثانية. بـ <code>HashSet</code> هي مقارنة أو اتنين. ولو حد كتب «قارن كل عربية بكل عربية عشان نلاقي المتكرر» يبقى 50 مليون مقارنة على 10K بس، ولما الـ fleet توصل مليون تبقى نص تريليون.</p>`,
      try: 'ابدأ بـ 1K وبعدين زوّد لـ 1M. الـ O(log n) بالكاد بيتحرك (من 10 لـ 20 probe)، والـ O(n) بيتضرب في ألف، والـ O(n²) يوصل لسنين. لاحظ إن على 10 عناصر الكل تقريبًا زي بعض: الـ Big-O بيفرق لما n يكبر.',
      also: 'البحث عن عميل في نظام بنك، أو مطابقة عمليات الدفع مع كشف الحساب (join بـ loop جوه loop = O(n²))، أو لاعب بيدوّر على أقرب لاعبين في لعبة.',
      net: `
<pre><span class="c">// O(n): بيعدّي على الـ list كلها في كل مرة</span>
List&lt;long&gt; fleet = ...;
bool known = fleet.Contains(vehicleId);

<span class="c">// O(1) في المتوسط: hash للمفتاح ثم bucket واحد</span>
var fleetSet = new HashSet&lt;long&gt;(fleet);
bool known2 = fleetSet.Contains(vehicleId);

<span class="c">// O(n²): أشهر غلطة. Any جوه Where = loop جوه loop</span>
var dupes = points.Where(p =&gt; points.Any(q =&gt; q != p &amp;&amp; q.Id == p.Id));
<span class="c">// O(n): نفس النتيجة بـ hash</span>
var dupes2 = points.GroupBy(p =&gt; p.Id).Where(g =&gt; g.Count() &gt; 1);</pre>`,
      netTitle: 'في .NET',
      deep: [
        '<b>Big-O بيهمل الثوابت:</b> <code>O(n)</code> بـ cache-friendly loop على array ممكن يكسب <code>O(log n)</code> على tree مليانة pointers لما n يبقى صغير. عشان كده <code>Array.Sort</code> بيستخدم Insertion Sort (وهو O(n²)) للأجزاء اللي أصغر من 16 عنصر.',
        '<b>المتوسط vs أسوأ حالة:</b> <code>Dictionary</code> هو O(1) في المتوسط، بس لو كل المفاتيح وقعت في نفس الـ bucket يبقى O(n). وQuickSort متوسطه O(n log n) وأسوأ حالة O(n²). شوف تجربة <a href="#/dsa/hash">Hash Table</a> و<a href="#/dsa/sorting">Sorting</a>.',
        '<b>Amortized:</b> <code>List.Add</code> ساعات بيعمل copy لكل العناصر (لما الـ capacity تخلص)، بس متوسطه على المدى الطويل O(1) لأن الـ capacity بتتضاعف. شوف <a href="#/dsa/array-list">Array vs Linked List</a>.',
        '<b>LINQ بيخبّي الـ loops:</b> <code>Contains</code> و<code>Any</code> و<code>First</code> و<code>Count()</code> على <code>IEnumerable</code> كلها O(n). و<code>ToList()</code> جوه loop معناها O(n) allocation في كل لفة.',
        '<b>تبسيطات:</b> «≈ 1 ns للخطوة» تقريب لخطوة بسيطة في الـ cache. الخطوة الحقيقية بتفرق: مقارنة string أبطأ من مقارنة رقم، وcache miss حوالي 100 ns. الـ merge sort فوق 100K محسوب بالمعادلة (n log₂ n − 1.25n) بدل ما يتشغّل فعلًا في المتصفح.'
      ]
    })
  });
})();
