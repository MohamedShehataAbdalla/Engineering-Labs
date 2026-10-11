/* Databases · Execution Plan بالعين: tipping point + estimated vs actual rows
   Two candidate plans for SELECT * FROM GpsPoints WHERE VehicleId = @v (non-covering NC index on VehicleId):
     A) Index Seek → Nested Loops → Key Lookup      B) Clustered Index Scan
   Costs use a simplified model built on SQL Server's published costing constants
   (random page 0.003125, sequential page 0.000740741, CPU per row 0.0000011 + 0.0001581 first row).
   The "optimizer" here picks the cheaper plan for the ESTIMATED rows; what you pay is the cost at the ACTUAL rows. */
(function () {
  "use strict";
  const { clamp, lerp, fmt, f1, perPage } = Lab.util;
  const { box, tx, dot, line, alpha, arrow } = Lab.draw;

  const TABLE_ROWS = 1e8, PAGES = Math.ceil(TABLE_ROWS / perPage(200));
  const NC_LEAF = perPage(19);
  const IO_RAND = 0.003125, IO_SEQ = 0.000740741, CPU_ROW = 0.0000011, CPU_FIRST = 0.0001581;
  const ACTUAL = [10, 100, 1e3, 1e4, 1e5, 1e6, 1e7];

  const costScan = () => IO_RAND + IO_SEQ * (PAGES - 1) + CPU_FIRST + CPU_ROW * (TABLE_ROWS - 1);
  const costSeek = r => {
    const seek = IO_RAND + IO_SEQ * Math.max(0, Math.ceil(r / NC_LEAF) - 1) + CPU_FIRST + CPU_ROW * Math.max(0, r - 1);
    const lookups = r * (IO_RAND + CPU_FIRST);
    return seek + lookups;
  };
  const tipping = () => { let lo = 1, hi = TABLE_ROWS; while (hi - lo > 1) { const m = Math.floor((lo + hi) / 2); if (costSeek(m) < costScan()) lo = m; else hi = m; } return lo; };
  const TIP = tipping();

  function estimate(p, actual) {
    if (p.est === 'small') return 10;          // plan compiled for a vehicle with 10 points, then reused
    if (p.est === 'big') return 5e6;           // plan compiled for a fleet-wide parameter
    return actual;
  }

  Lab.registerSim('execution-plan', {
    height: 380, warm: 1.5,
    init(s) { s.st = { flows: [], next: 0 }; },
    onParam(s) { s.st.flows = []; },

    calc(s) {
      const A = ACTUAL[s.p.rows], E = estimate(s.p, A);
      const chosen = costSeek(E) < costScan() ? 'seek' : 'scan';
      const best = costSeek(A) < costScan() ? 'seek' : 'scan';
      const paid = chosen === 'seek' ? costSeek(A) : costScan();
      const opt = Math.min(costSeek(A), costScan());
      return { A, E, chosen, best, paid, opt, ratio: paid / opt };
    },

    step(s, dt) {
      const st = s.st, c = this.calc(s);
      // row flow along the chosen plan's edges: rate grows with log(actual rows)
      const rate = 2 + Math.log10(c.A + 1) * 2.2;
      st.next -= dt;
      while (st.next <= 0) { st.next += 1 / rate; st.flows.push({ t0: s.t, lane: s.rng() }); }
      st.flows = st.flows.filter(f => s.t - f.t0 < 1.4);
    },

    draw(s) {
      const C = s.C, n = s.narrow, W = s.w, c = this.calc(s), st = s.st;
      /* ---- cost chart (log-log) ---- */
      const L = n ? 46 : 64, R = W - 16, T = 30, B = n ? 168 : 178;
      const xs = r => lerp(L, R, Math.log10(r) / 8);
      const ys = v => lerp(B, T, (Math.log10(v) + 2) / 8);
      tx('Estimated cost', L - 6, T - 14, { m: 1, s: 10, c: C.muted, a: 'left' });
      for (let e = -2; e <= 6; e += 2) { const y = ys(Math.pow(10, e)); line(L, y, R, y, C.line, 1, [2, 4]); tx({ '-2': '0.01', 0: '1', 2: '100', 4: '10K', 6: '1M' }[e], L - 6, y, { m: 1, s: 9, c: C.muted, a: 'right' }); }
      for (let e = 0; e <= 8; e += 2) { const x = xs(Math.pow(10, e)); tx(e === 0 ? '1' : e === 8 ? '100M' : fmt(Math.pow(10, e)).replace(',000,000', 'M').replace(',000', 'K'), x, B + 12, { m: 1, s: 9, c: C.muted }); }
      tx('rows', R, B + 24, { m: 1, s: 9, c: C.muted, a: 'right' });
      // scan line (flat) and seek+lookup curve
      line(L, ys(costScan()), R, ys(costScan()), C.bad, 2);
      const X = Lab.draw.ctx(); X.beginPath();
      for (let i = 0; i <= 80; i++) { const r = Math.pow(10, i / 10); const y = ys(costSeek(r)); if (i === 0) X.moveTo(xs(r), y); else X.lineTo(xs(r), Math.max(T - 6, y)); }
      X.strokeStyle = C.good; X.lineWidth = 2; X.stroke();
      tx('Scan', R - 4, ys(costScan()) - 9, { m: 1, s: 10, w: 700, c: C.bad, a: 'right' });
      tx('Seek + Key Lookup', xs(30), ys(costSeek(30)) - 12, { m: 1, s: 10, w: 700, c: C.good, a: 'left' });
      // tipping point
      const tx_ = xs(TIP);
      line(tx_, T, tx_, B, C.ink, 1, [4, 3]);
      tx(`tipping ≈ ${fmt(TIP)}`, tx_ - 4, T + 8, { m: 1, s: 9, w: 600, a: 'right' });
      // estimate and actual markers
      const ex = xs(c.E), ax = xs(c.A);
      line(ex, T, ex, B, C.violet, 2, [5, 3]); tx('Est', ex, B - 8, { m: 1, s: 9, w: 700, c: C.violet });
      line(ax, T, ax, B, C.accent, 2); tx('Actual', ax, T - 6, { m: 1, s: 9, w: 700, c: C.accent });
      dot(ax, ys(c.paid), 5, c.chosen === c.best ? C.good : C.bad);

      /* ---- the chosen plan, drawn like SSMS (data flows right → left) ---- */
      const py = B + (n ? 70 : 80), bh = 36, bw = n ? 86 : 132;
      const sel = { x: 14, y: py - bh / 2 };
      const ops = c.chosen === 'seek'
        ? [{ name: 'Nested Loops', x: n ? W * 0.44 : W * 0.30, y: py }, { name: 'Index Seek', sub: 'IX_VehicleId', x: W - bw / 2 - 14, y: py - 34 }, { name: 'Key Lookup', sub: 'PK (clustered)', x: W - bw / 2 - 14, y: py + 34 }]
        : [{ name: 'Clustered Index Scan', sub: 'PK + predicate', x: W - bw / 2 - 14, y: py }];
      const edges = c.chosen === 'seek' ? [[1, 0, c.A], [2, 0, c.A], [0, -1, c.A]] : [[0, -1, c.A]];
      const at = i => i < 0 ? { x: sel.x + 60, y: py } : ops[i];
      const thick = clamp(1 + Math.log10(c.A + 1) * 1.6, 1, 12);
      for (const [a, b] of edges) { const A_ = at(a), B_ = at(b); line(A_.x - bw / 2, A_.y, B_.x + (b < 0 ? 0 : bw / 2), B_.y, C.line, thick); }
      for (const f of st.flows) {
        const k = clamp((s.t - f.t0) / 1.4, 0, 1);
        const ed = edges[Math.floor(f.lane * edges.length)], A_ = at(ed[0]), B_ = at(ed[1]);
        dot(lerp(A_.x - bw / 2, B_.x + (ed[1] < 0 ? 0 : bw / 2), k), lerp(A_.y, B_.y, k), 3, C.accent);
      }
      box(sel.x, sel.y, 60, bh, { r: 6 }); tx('SELECT', sel.x + 30, py, { m: 1, s: 10, w: 700 });
      for (const o of ops) {
        const bad = c.chosen !== c.best;
        box(o.x - bw / 2, o.y - bh / 2, bw, bh, { r: 6, stroke: bad ? C.bad : C.good, lw: 1.6 });
        tx(o.name, o.x, o.y - (o.sub && !n ? 7 : 0), { m: 1, s: n ? 9 : 10, w: 700 });
        if (o.sub && !n) tx(o.sub, o.x, o.y + 9, { m: 1, s: 9, c: C.muted });
      }
      const lbl = `Est ${fmt(c.E)} · Actual ${fmt(c.A)} rows`;
      tx(lbl, W - 14, s.h - 16, { m: 1, s: n ? 9 : 11, w: 700, a: 'right', c: c.E === c.A ? C.ink : C.bad });
      tx(c.chosen === c.best ? 'الخطة مناسبة ✓' : 'الخطة غلط للداتا دي ✗', 14, s.h - 16, { s: 11, w: 700, a: 'left', c: c.chosen === c.best ? C.good : C.bad });
    },

    stats(s) {
      const c = this.calc(s);
      return [
        ['Estimated rows', fmt(c.E), c.E === c.A ? '' : 'warn'],
        ['Actual rows', fmt(c.A)],
        ['الخطة المختارة', c.chosen === 'seek' ? 'Seek + Lookup' : 'Clustered Scan', c.chosen === c.best ? 'good' : 'bad'],
        ['التكلفة الفعلية', f1(c.paid), c.chosen === c.best ? 'good' : 'bad'],
        ['أحسن تكلفة ممكنة', f1(c.opt)],
        ['أبطأ من الأحسن بـ', c.ratio < 1.05 ? '—' : '× ' + (c.ratio < 10 ? f1(c.ratio) : fmt(c.ratio)), c.ratio > 2 ? 'bad' : '']
      ];
    }
  });

  Lab.registerLesson({
    id: 'execution-plan', lab: 'databases', title: 'Execution Plan بالعين',
    html: Lab.tpl.lesson({
      sim: 'execution-plan', level: 2,
      terms: ['Execution Plan', 'Cost', 'Tipping Point', 'Estimated vs Actual', 'Parameter Sniffing'],
      lede: 'فوق: تكلفة الخطتين حسب عدد الصفوف. الأخضر Seek + Key Lookup، والأحمر Scan للجدول كله. الـ optimizer بيختار على الخط البنفسجي (<b>اللي هو فاكره</b>)، وأنت بتدفع على الخط البرتقالي (<b>اللي حصل فعلًا</b>). تحت: الخطة اللي اتنفذت، وسُمك الخطوط بيمثل عدد الصفوف اللي بتعدّي.',
      aria: 'منحنى تكلفة خطتين تنفيذ ونقطة الـ tipping',
      controls: [
        { type: 'range', p: 'rows', label: 'الصفوف الفعلية للعربية', min: 0, max: 6, step: 1, value: 2, map: ACTUAL.map(fmt), unit: 'rows' },
        { type: 'seg', p: 'est', label: 'الـ optimizer فاكر كام صف؟', value: 'accurate', opts: [['accurate', 'statistics مظبوطة'], ['small', 'خطة متخزنة لـ 10 صفوف'], ['big', 'خطة متخزنة لـ 5M صف']] }
      ],
      idea: `
        <p>الـ <b>Execution Plan</b> هو الطريقة اللي SQL Server قرر ينفذ بيها الاستعلام: أنهي index، وبأنهي ترتيب، وأنهي join. الـ <b>Query Optimizer</b> بيحسب <b>Cost</b> تقديري لكل خطة ويختار الأرخص. التقدير ده معتمد على <b>Estimated rows</b> اللي بيجيبها من الـ <b>Statistics</b>، مش على الداتا الحقيقية.</p>
        <p>الـ Key Lookup رخيص لما الصفوف قليلة، وبيغلى خطيًا مع كل صف. الـ Scan تمنه ثابت. النقطة اللي بيتقابلوا فيها اسمها <b>Tipping Point</b>. لو التقدير غلط، الـ optimizer بيختار خطة مناسبة لعدد صفوف مش هو اللي جه.</p>`,
      real: `
        <p>Stored procedure بتجيب نقط عربية. أول ما اتنادت كانت لعربية جديدة فيها 10 نقط، فالـ plan اتعمل Seek + Lookup واتخزن في الـ plan cache. بعدها نفس الـ procedure اتنادت لشاحنة شغالة من 3 سنين فيها 10 مليون نقطة. الـ plan المتخزن اتنفذ زي ما هو: 10 مليون Key Lookup بدل Scan، والتكلفة بقت حوالي 17 ضعف. والعكس أسوأ: plan اتعمل لعميل كبير (Scan) واتنفذ لعربية فيها 10 نقط بيقرا الجدول كله عشان 10 صفوف. ده اسمه <b>Parameter Sniffing</b>.</p>`,
      try: 'سيبها على «statistics مظبوطة» وحرّك الصفوف: الخطة بتقلب لـ Scan بعد الـ tipping point لوحدها. بعدين اختار «خطة متخزنة لـ 10 صفوف» وارفع الصفوف لـ 10 مليون: الخطة فضلت Seek وبقت أبطأ حوالي 17 مرة. وجرّب العكس: «5M صف» مع 10 صفوف بس، وشوف الرقم.',
      also: 'تقارير البنوك حسب العميل (عميل عادي مقابل شركة كبيرة)، وتقارير الشحنات حسب التاجر في منصات التوصيل: نفس مشكلة الـ data skew مع parameter sniffing.',
      net: `
<pre><span class="c">-- شوف الـ actual plan وعدد الصفوف الحقيقي</span>
SET STATISTICS IO, TIME ON;
SELECT * FROM GpsPoints WHERE VehicleId = @v;

<span class="c">-- حدّث الـ statistics</span>
UPDATE STATISTICS GpsPoints WITH FULLSCAN;

<span class="c">-- علاجات parameter sniffing (لكل واحد تمن)</span>
... OPTION (RECOMPILE);               <span class="c">-- plan جديد كل مرة</span>
... OPTION (OPTIMIZE FOR UNKNOWN);    <span class="c">-- تقدير متوسط</span></pre>
<pre><span class="c">// EF Core: شوف الـ SQL والـ parameters</span>
var sql = db.GpsPoints
    .Where(p =&gt; p.VehicleId == id).ToQueryString();</pre>`,
      deep: [
        '<b>الـ Cost مش ثواني:</b> رقم نسبي بيستخدمه الـ optimizer عشان يقارن الخطط. الأرقام هنا مبنية على ثوابت الـ costing المعروفة بتاعة SQL Server (قراية random = 0.003125، قراية متتالية = 0.000740741 لكل صفحة، و CPU لكل صف)، لكن الـ model مبسّط ومش هيطابق الأرقام اللي في SSMS بالظبط.',
        '<b>الـ tipping point هنا حوالي 0.6% من الجدول.</b> ده متسق مع القاعدة المشهورة إن الـ seek + lookup بيخسر لما الصفوف تعدّي حوالي ربع لتلت عدد صفحات الجدول. يعني جزء صغير جدًا من الصفوف. عشان كده الـ covering index (التجربة اللي فاتت) مهم: بيشيل الـ lookups فالـ tipping point بيختفي.',
        '<b>مصادر التقدير الغلط:</b> statistics قديمة (الـ auto update بيحصل بعد نسبة تغيير معينة)، وparameter sniffing، و table variables (تقديرها تاريخيًا صف واحد قبل SQL Server 2019)، ودوال على العمود في الـ WHERE (<code>WHERE YEAR(Ts) = 2026</code>) اللي بتمنع استخدام الـ index والـ statistics كويس.',
        '<b>في SSMS:</b> قارن <i>Estimated Number of Rows</i> بـ <i>Actual Number of Rows</i> على كل operator. فرق كبير بينهم هو أول علامة إن الخطة ممكن تكون غلط. ومن SQL Server 2022 فيه Parameter Sensitive Plan optimization بيخزن أكتر من plan لنفس الاستعلام حسب حجم الـ parameter.',
        '<b>الرسم تحت:</b> SSMS بيرسم الخطة من اليمين للشمال، والـ operator اللي على اليمين بيطلّع الصفوف اللي داخلة للي على شماله. وسُمك السهم بيمثل عدد الصفوف، زي هنا.'
      ]
    })
  });
})();
