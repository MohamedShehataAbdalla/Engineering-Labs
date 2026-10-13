/* DSA · Binary Search
   One vehicle's GPS points as an array of timestamps (one every ~10 s). Query: "where was it at time T?",
   i.e. the last point with Ts ≤ T (a floor search). Two real searches run on the real array at the same step rate:
     binary search  lo/hi/mid halving, every probe is one array read
     linear scan    from the start (stops early on sorted data, must read everything when the order is broken)
   "Late points" is what happens in production: a device was offline and uploaded 5% of its points later, so they
   were appended at the end. Binary search still runs and still returns an answer, and the linear scan (ground truth)
   shows when that answer is wrong. */
(function () {
  "use strict";
  const { clamp, lerp, fmt } = Lab.util;
  const { box, tx, dot, line, arrow, alpha, hatch } = Lab.draw;

  const NS = [16, 100, 1000, 8640, 1e6];
  const RATE = 2.4, HOLD = 2.6;

  const hms = sec => {
    const d = Math.floor(sec / 86400), r = sec - d * 86400;
    const h = Math.floor(r / 3600), m = Math.floor(r % 3600 / 60), s = Math.floor(r % 60);
    const p = v => String(v).padStart(2, '0');
    return (d ? `d${d + 1} ` : '') + `${p(h)}:${p(m)}:${p(s)}`;
  };

  function build(s) {
    const n = NS[s.p.n], rnd = s.rng, a = new Float64Array(n);
    for (let i = 0; i < n; i++) a[i] = 6 * 3600 + i * 10 + Math.floor(rnd() * 4);   // day starts 06:00, ~10 s apart
    let late = new Uint8Array(n);
    if (s.p.order === 'late' && n >= 16) {
      // 5% of the points arrived late: they sit at the end of the array, in their own (sorted) order
      const keep = [], moved = [];
      for (let i = 0; i < n; i++) (rnd() < 0.05 ? moved : keep).push(a[i]);
      const b = new Float64Array(n); let k = 0;
      for (const v of keep) b[k++] = v;
      for (const v of moved) { late[k] = 1; b[k++] = v; }
      return { a: b, late, n };
    }
    return { a, late, n };
  }

  function binary(a, T) {
    let lo = 0, hi = a.length - 1, ans = -1; const probes = [];
    while (lo <= hi) {
      const mid = (lo + hi) >> 1, go = a[mid] <= T;
      probes.push({ lo, hi, mid, v: a[mid], go });
      if (go) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return { ans, probes };
  }
  function linear(a, T, sorted) {
    let best = -1, reads = 0;
    for (let i = 0; i < a.length; i++) {
      reads++;
      if (a[i] <= T) { if (best < 0 || a[i] > a[best]) best = i; }
      else if (sorted) break;                 // sorted: the first bigger value ends the search
    }
    return { ans: best, reads };
  }

  Lab.registerSim('binary-search', {
    height: 340, warm: 0,

    init(s) { s.st = { data: build(s), q: null, wrong: 0, total: 0 }; this.query(s); },
    onParam(s) { s.st.data = build(s); s.st.wrong = 0; s.st.total = 0; this.query(s); },

    query(s) {
      const d = s.st.data, a = d.a, n = d.n;
      // ask about a moment inside the recorded day (anything between the first and last point)
      const T = 6 * 3600 + Math.floor(s.rng() * (n * 10));
      const b = binary(a, T), l = linear(a, T, s.p.order !== 'late');
      s.st.q = { T, b, l, t0: s.t, ok: b.ans === l.ans || (b.ans >= 0 && l.ans >= 0 && a[b.ans] === a[l.ans]), counted: false };
    },

    step(s) {
      const q = s.st.q, e = s.t - q.t0, endB = q.b.probes.length / RATE;
      if (!q.counted && e >= endB) { q.counted = true; s.st.total++; if (!q.ok) s.st.wrong++; }
      if (e >= endB + HOLD) this.query(s);
    },

    draw(s) {
      const C = s.C, st = s.st, d = st.data, q = st.q, a = d.a, n = d.n, W = s.w, N = s.narrow;
      const x0 = 14, x1 = W - 14, bw = x1 - x0, e = s.t - q.t0;
      const k = Math.min(q.b.probes.length, Math.floor(e * RATE) + 1);   // probes shown so far
      const cur = q.b.probes[k - 1], done = k >= q.b.probes.length && e * RATE >= q.b.probes.length;
      const X = i => x0 + (i + 0.5) / n * bw;

      tx(`where was the vehicle at ${hms(q.T)} ?   (last point with Ts ≤ T)`, x0, 16, { m: 1, s: N ? 9.5 : 12, w: 700, a: 'left', c: C.accent });
      tx(`${fmt(n)} points sorted by Ts${s.p.order === 'late' ? ', except 5% late uploads at the end' : ''}`, x0, 36, { m: 1, s: N ? 8.5 : 10.5, a: 'left', c: s.p.order === 'late' ? C.bad : C.muted });

      /* the whole array as one bar: discarded parts hatched, the live range [lo..hi] outlined */
      const by = 56, bh = 26;
      box(x0, by, bw, bh, { r: 4, fill: C.surface, stroke: C.line });
      if (s.p.order === 'late') {
        const step = Math.max(1, Math.floor(n / 400));
        for (let i = 0; i < n; i += step) if (d.late[i]) alpha(0.8, () => line(X(i), by + 2, X(i), by + bh - 2, C.bad, 1));
      }
      if (cur) {
        const lx = x0 + cur.lo / n * bw, rx = x0 + (cur.hi + 1) / n * bw;
        if (lx > x0) hatch(x0, by, lx - x0, bh, C.muted);
        if (rx < x1) hatch(rx, by, x1 - rx, bh, C.muted);
        box(lx, by - 3, Math.max(3, rx - lx), bh + 6, { r: 4, fill: null, stroke: C.violet, lw: 2 });
        const mx = X(cur.mid);
        line(mx, by - 8, mx, by + bh + 8, C.accent, 2);
        tx(`mid ${fmt(cur.mid)}: ${hms(cur.v)}`, clamp(mx, x0 + 60, x1 - 60), by + bh + 18, { m: 1, s: N ? 9 : 10.5, w: 700, c: C.accent });
      }
      tx('0', x0, by - 9, { m: 1, s: 9, a: 'left', c: C.muted });
      tx(fmt(n - 1), x1, by - 9, { m: 1, s: 9, a: 'right', c: C.muted });

      /* probe log */
      const ly = by + bh + 42, rows = N ? 5 : 6, first = Math.max(0, k - rows);
      tx('Binary Search', x0, ly - 4, { m: 1, s: N ? 10 : 11.5, w: 700, a: 'left', c: C.good });
      for (let i = first; i < k; i++) {
        const p = q.b.probes[i], y = ly + 14 + (i - first) * 17;
        const msg = `${i + 1}. a[${fmt(p.mid)}] = ${hms(p.v)} ${p.go ? '≤ T → right half' : '> T → left half'}`;
        tx(msg, x0, y, { m: 1, s: N ? 8.5 : 10.5, a: 'left', c: i === k - 1 ? C.ink : C.muted });
      }

      /* zoom: once the range is small, show the actual cells */
      if (cur && cur.hi - cur.lo < 18 && !N) {
        // while searching: the live range; when done: the answer with its neighbours
        const zlo = done && q.b.ans >= 0 ? Math.max(0, q.b.ans - 2) : cur.lo, zhi = done && q.b.ans >= 0 ? Math.min(n - 1, q.b.ans + 2) : cur.hi;
        const zx0 = W * 0.5, zw = x1 - zx0, cnt = zhi - zlo + 1, cw = Math.min(46, zw / cnt);
        tx(`a[${zlo}..${zhi}]`, zx0, ly - 4, { m: 1, s: 10, a: 'left', c: C.violet });
        for (let i = zlo; i <= zhi; i++) {
          const x = zx0 + (i - zlo) * cw, isMid = !done && i === cur.mid, isAns = done && i === q.b.ans;
          box(x + 1, ly + 8, cw - 2, 30, { r: 3, fill: isMid ? C.accent : isAns ? C.a2 : C.surface, stroke: d.late[i] ? C.bad : C.violet });
          if (cw > 40) tx(hms(a[i]).slice(-8, -3), x + cw / 2, ly + 23, { m: 1, s: 9, w: 600, c: isMid || isAns ? C.surface : C.ink });
        }
      }

      /* linear scan at the same rate */
      const sy = s.h - 44, lin = Math.min(q.l.reads, Math.floor(e * RATE) + 1);
      tx(`Linear scan: ${fmt(lin)} / ${fmt(q.l.reads)} reads`, x0, sy - 10, { m: 1, s: N ? 9.5 : 11, w: 700, a: 'left', c: q.l.reads > 64 ? C.bad : C.accent });
      box(x0, sy, bw, 10, { r: 5, fill: C.surface, stroke: C.line });
      box(x0, sy, Math.max(4, bw * lin / n), 10, { r: 5, fill: q.l.reads > 64 ? C.bad : C.accent, stroke: null });

      if (done) {
        const res = q.b.ans < 0 ? 'no point before T' : `a[${fmt(q.b.ans)}] = ${hms(a[q.b.ans])}`;
        const truth = q.l.ans < 0 ? 'none' : hms(a[q.l.ans]);
        tx(q.ok ? `✓ ${res} in ${q.b.probes.length} probes` : `✗ binary search says ${res}, the real answer is ${truth}`, x1, sy + 26, { m: 1, s: N ? 9 : 11, w: 700, a: 'right', c: q.ok ? C.good : C.bad });
      }
    },

    stats(s) {
      const st = s.st, q = st.q, n = st.data.n;
      return [
        ['عدد النقط', fmt(n)],
        ['Binary: probes', String(q.b.probes.length), 'good'],
        ['الحد الأقصى ⌈log₂(n+1)⌉', String(Math.ceil(Math.log2(n + 1)))],
        ['Linear: قرايات', fmt(q.l.reads), q.l.reads > 1000 ? 'bad' : q.l.reads > 50 ? 'warn' : ''],
        ['إجابات غلط من الـ Binary', `${st.wrong} / ${st.total}`, st.wrong ? 'bad' : 'good']
      ];
    }
  });

  Lab.registerLesson({
    id: 'binary-search', lab: 'dsa', title: 'Binary Search',
    html: Lab.tpl.lesson({
      sim: 'binary-search', level: 1,
      terms: ['Binary Search', 'Sorted Array', 'O(log n)', 'lo / hi / mid'],
      lede: 'نقط GPS لعربية واحدة مترتبة بالوقت، والسؤال: «العربية كانت فين الساعة كذا؟». الـ Binary Search بيبص في النص ويرمي نص الداتا في كل خطوة (المخطط بيبقى مرمي)، والـ Linear Scan تحت بيقرا بنفس السرعة من الأول.',
      aria: 'محاكاة binary search على timestamps نقط GPS',
      controls: [
        { type: 'range', p: 'n', label: 'عدد النقط', min: 0, max: 4, step: 1, value: 3, map: ['16', '100', '1K', '8,640 (يوم)', '1M (4 شهور)'] },
        { type: 'seg', p: 'order', label: 'ترتيب الداتا', value: 'sorted', opts: [['sorted', 'مترتبة بالوقت'], ['late', '5% وصلوا متأخر']] }
      ],
      idea: `
        <p>لو الداتا <b>مترتبة</b>، تقدر تبص على العنصر اللي في النص (<b>mid</b>): لو أصغر من اللي بتدوّر عليه يبقى الإجابة في النص اليمين، غير كده في الشمال. كل خطوة بترمي نص الباقي، فـ 1,000,000 عنصر محتاجين 20 خطوة بالكتير. ده <code>O(log n)</code>.</p>
        <p>المتغيرات التلاتة: <b>lo</b> و<b>hi</b> حدود المنطقة اللي لسه ممكن تكون فيها الإجابة، و<b>mid</b> اللي بنبص عليه دلوقتي. هنا بندوّر على «آخر نقطة وقتها ≤ T»، ودي أشهر نسخة في الشغل الحقيقي، مش «لاقيت الرقم بالظبط».</p>`,
      real: `
        <p>إعادة تشغيل رحلة (replay) أو حساب مكان العربية وقت حادثة: عندك 8,640 نقطة في اليوم مترتبين بالوقت، فالـ Binary Search بيوصل في 14 خطوة.</p>
        <p>المشكلة الحقيقية: جهاز فقد الشبكة ساعة وبعدين بعت النقط اللي فاتته. لو بتعمل append للنقط بترتيب الوصول، الـ array مبقتش مترتبة، والـ Binary Search مش هيرمي error: هيرجّع إجابة غلط بهدوء.</p>`,
      try: 'جرّب 1M نقطة: الـ Binary بيخلص في 20 probe والـ Linear لسه في أول البار. بعدين اختار «5% وصلوا متأخر» وسيبه شوية: عدّاد «إجابات غلط» بيزيد، والرسالة الحمرا بتقولك الإجابة الصح كانت إيه.',
      also: 'البحث في order book بالسعر، وإيجاد الشريحة في جدول أسعار مكالمات أو ضرايب، و <code>git bisect</code> لما بتدوّر على أول commit كسر حاجة.',
      net: `
<pre><span class="c">// Array/List.BinarySearch: لو مش لاقي القيمة بيرجّع ~index (complement) لأول عنصر أكبر</span>
long[] ts = track.Select(p =&gt; p.Ts.Ticks).ToArray();   <span class="c">// لازم مترتبة</span>
int i = Array.BinarySearch(ts, at.Ticks);
if (i &lt; 0) i = ~i - 1;          <span class="c">// آخر نقطة ≤ at (لو -1: مفيش)</span>

<span class="c">// الحل لمشكلة النقط المتأخرة: رتّب عند الإدخال، مش عند البحث</span>
int pos = list.BinarySearch(p, byTs);
list.Insert(pos &lt; 0 ? ~pos : pos, p);</pre>
<pre><span class="c">-- في SQL Server: index على (VehicleId, Ts) والـ Seek بيعمل نفس الفكرة في B-tree</span>
SELECT TOP (1) * FROM GpsPoints
WHERE VehicleId = @v AND Ts &lt;= @at
ORDER BY Ts DESC;</pre>`,
      netTitle: 'في .NET و SQL Server',
      deep: [
        '<b>Overflow في mid:</b> <code>(lo + hi) / 2</code> ممكن يعدّي <code>int.MaxValue</code> في arrays ضخمة. الصح <code>lo + (hi - lo) / 2</code>، وده اللي .NET بيعمله جوه. البج ده فضل موجود في Java سنين.',
        '<b>أغلب الـ bugs في الحدود:</b> <code>lo &lt;= hi</code> ولا <code>lo &lt; hi</code>؟ <code>hi = mid</code> ولا <code>mid - 1</code>؟ اكتب الـ invariant صريح («الإجابة دايمًا في [lo..hi]») واختبر على array فاضية وعنصر واحد وقيمة أصغر من الكل وأكبر من الكل.',
        '<b>Binary search على الإجابة:</b> نفس الفكرة بتشتغل على أي حاجة monotonic، مش arrays بس: أقل عدد servers يستحمل الحمل، أكبر batch size مش بيعمل timeout، أول نسخة فيها البج.',
        '<b>الـ Cache:</b> الـ probes الأولى بتقفز مسافات كبيرة في الذاكرة (cache misses)، وده اللي بيخلّي B-tree بصفحات 8 KB أسرع من binary search على array ضخمة على الديسك. شوف <a href="#/databases/btree-index">B-Tree Index</a>.',
        '<b>تبسيطات:</b> النقط هنا كل ~10 ثواني بالظبط مع شوية عشوائية، والـ 5% المتأخرين متحطوش في آخر الـ array بترتيبهم. في الحقيقة ممكن يوصلوا على دفعات في أي حتة.'
      ]
    })
  });
})();
