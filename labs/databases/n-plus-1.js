/* Databases · N+1 in EF Core (Lazy loading vs Include vs AsSplitQuery vs Projection)
   A page that lists N vehicles with their recent trips (M each). Each strategy produces a list of real queries
   (rows, bytes). Time per query = network round trip + server work + transfer at 1 Gbps. Queries run one after the
   other, like awaited calls do. The clock only advances when a query finishes, by that query's computed time. */
(function () {
  "use strict";
  const { clamp, lerp, ease, fmt, f1, bytes } = Lab.util;
  const { box, tx, dot, line, alpha, cyl } = Lab.draw;

  const V_FULL = 420, T_FULL = 260, V_PROJ = 24, T_PROJ = 20;     // bytes per row (entity vs projected columns)
  const SERVER_BASE = 0.15, SERVER_ROW = 0.002, BW = 125000;       // ms per query, ms per row, bytes per ms (1 Gbps)
  const RTTS = { lan: 0.3, region: 1, far: 25 };

  function plan(p) {
    const N = p.n, M = p.m, q = [];
    const mk = (label, rows, rowBytes) => ({ label, rows, bytes: rows * rowBytes });
    if (p.mode === 'lazy') { q.push(mk('SELECT * FROM Vehicles', N, V_FULL)); for (let i = 0; i < N; i++) q.push(mk(`SELECT * FROM Trips WHERE VehicleId = @p`, M, T_FULL)); }
    if (p.mode === 'include') q.push(mk('SELECT v.*, t.* FROM Vehicles v LEFT JOIN Trips t …', N * M, V_FULL + T_FULL));
    if (p.mode === 'split') { q.push(mk('SELECT * FROM Vehicles', N, V_FULL)); q.push(mk('SELECT t.* FROM Trips t JOIN Vehicles v …', N * M, T_FULL)); }
    if (p.mode === 'proj') q.push(mk('SELECT v.Plate, t.Ts, t.Km FROM Vehicles v LEFT JOIN Trips t …', N * M, V_PROJ + T_PROJ));
    const rtt = RTTS[p.rtt];
    for (const x of q) { x.server = SERVER_BASE + SERVER_ROW * x.rows; x.wire = x.bytes / BW; x.ms = rtt + x.server + x.wire; }
    const tot = k => q.reduce((a, x) => a + x[k], 0);
    return { q, ms: tot('ms'), rows: tot('rows'), bytes: tot('bytes'), net: rtt * q.length, server: tot('server'), wire: tot('wire') };
  }

  Lab.registerSim('n-plus-1', {
    height: 320, warm: 0,
    init(s) { s.st = { pl: plan(s.p), t0: s.t, best: null }; s.st.best = Math.min(...['lazy', 'include', 'split', 'proj'].map(m => plan({ ...s.p, mode: m }).ms)); },
    onParam(s) { this.init(s); },

    /** visual pacing: the whole page load is animated in ~4 s whatever the query count */
    pace(pl) { return clamp(4 / pl.q.length, 0.012, 0.9); },

    step(s) {
      const st = s.st, per = this.pace(st.pl);
      if (s.t - st.t0 > per * st.pl.q.length + 2.2) st.t0 = s.t;
    },

    draw(s) {
      const st = s.st, pl = st.pl, C = s.C, n = s.narrow, W = s.w, H = s.h;
      const per = this.pace(pl), e = s.t - st.t0, doneN = clamp(Math.floor(e / per), 0, pl.q.length);
      const appX = n ? 50 : 90, dbX = W - (n ? 50 : 90), cy = 104;
      // boxes
      box(appX - 44, cy - 34, 88, 68, { r: 8 }); tx('App', appX, cy - 8, { m: 1, s: 12, w: 700 }); tx('EF Core', appX, cy + 10, { m: 1, s: 10, c: C.muted });
      cyl(dbX - 36, cy - 36, 72, 72, { stroke: C.line }); tx('SQL', dbX, cy + 4, { m: 1, s: 12, w: 700 });
      line(appX + 44, cy - 10, dbX - 36, cy - 10, C.line, 1, [3, 4]); line(appX + 44, cy + 10, dbX - 36, cy + 10, C.line, 1, [3, 4]);
      // the query in flight: request (orange) then rows back (teal, thicker with more rows)
      if (doneN < pl.q.length) {
        const k = clamp((e - doneN * per) / per, 0, 1), x = pl.q[doneN];
        if (k < 0.5) dot(lerp(appX + 44, dbX - 36, ease(k * 2)), cy - 10, 5, C.accent);
        else { const r = clamp(2 + Math.log10(x.rows + 1) * 2.2, 2, 11); dot(lerp(dbX - 36, appX + 44, ease((k - 0.5) * 2)), cy + 10, r, C.a2); }
        tx(x.label, W / 2, 34, { m: 1, s: n ? 8.5 : 11, w: 600, c: C.accent });
        tx(`→ ${fmt(x.rows)} rows · ${bytes(x.bytes)}`, W / 2, 52, { m: 1, s: n ? 9 : 10, c: C.muted });
      } else tx('الصفحة اتعرضت ✓', W / 2, 40, { s: 13, w: 700, c: C.good });
      // query counter
      tx(`round trips: ${fmt(doneN)} / ${fmt(pl.q.length)}`, W / 2, cy + 52, { m: 1, s: 12, w: 700, c: pl.q.length > 3 ? C.bad : C.good });

      // timeline: one segment per query, width ∝ its time; elapsed real ms on the right
      const L = 14, R = W - 14, ty = H - 70, tw = R - L;
      let acc = 0, elapsed = 0;
      tx('كل استعلام بيستنى اللي قبله', R, ty - 14, { s: 10, c: C.muted, a: 'right' });
      box(L, ty, tw, 18, { r: 4, fill: C.surface });
      pl.q.forEach((x, i) => {
        const x0 = L + tw * acc / pl.ms, w = Math.max(tw * x.ms / pl.ms, 0.6);
        if (i < doneN) { box(x0, ty + 1, w, 16, { r: 0, fill: i % 2 ? C.accent : C.a2, stroke: null }); elapsed += x.ms; }
        acc += x.ms;
      });
      // breakdown bar: network vs server vs transfer
      const by = ty + 30, segs = [['network round trips', pl.net, C.accent], ['server', pl.server, C.violet], ['transfer', pl.wire, C.a2]];
      let bx = L;
      for (const [lbl, v, c] of segs) { const w = tw * v / pl.ms; box(bx, by, Math.max(0, w), 10, { r: 0, fill: c, stroke: null }); bx += w; }
      let lx = L;
      for (const [lbl, v, c] of segs) { const t = `${lbl} ${f1(v)}ms`; dot(lx + 4, by + 24, 4, c); tx(t, lx + 12, by + 24, { m: 1, s: n ? 8 : 10, a: 'left', c: C.muted }); lx += Lab.draw.textW(t, { m: 1, s: n ? 8 : 10 }) + 24; }
      tx(`${f1(elapsed)} / ${f1(pl.ms)} ms`, L, ty - 14, { m: 1, s: 11, w: 700, a: 'left', c: C.ink });
    },

    stats(s) {
      const pl = s.st.pl, ratio = pl.ms / s.st.best;
      return [
        ['Queries (round trips)', fmt(pl.q.length), pl.q.length > 3 ? 'bad' : 'good'],
        ['Rows راجعة', fmt(pl.rows), pl.rows > s.p.n * s.p.m ? 'warn' : ''],
        ['Bytes على الشبكة', bytes(pl.bytes), pl.bytes > 5e6 ? 'bad' : pl.bytes > 5e5 ? 'warn' : 'good'],
        ['وقت تحميل الصفحة', f1(pl.ms) + ' ms', ratio > 3 ? 'bad' : ratio > 1.3 ? 'warn' : 'good'],
        ['مقارنة بأحسن طريقة', ratio < 1.05 ? 'الأحسن ✓' : '× ' + f1(ratio), ratio > 3 ? 'bad' : ratio > 1.3 ? 'warn' : 'good']
      ];
    }
  });

  Lab.registerLesson({
    id: 'n-plus-1', lab: 'databases', title: 'N+1 في EF Core',
    html: Lab.tpl.lesson({
      sim: 'n-plus-1', level: 2,
      terms: ['N+1', 'Lazy Loading', 'Include', 'AsSplitQuery', 'Projection'],
      lede: 'صفحة «العربيات ورحلاتها»: N عربية، ولكل عربية آخر M رحلة. نفس الصفحة بـ 4 طرق كتابة في EF Core. تحت: كل استعلام كأنه قطعة في الـ timeline، وتقسيم الوقت بين الشبكة والسيرفر ونقل الداتا.',
      aria: 'محاكاة N+1 queries مقابل Include و Projection',
      controls: [
        { type: 'seg', p: 'mode', label: 'طريقة الكود', value: 'lazy', opts: [['lazy', 'Lazy loading (N+1)'], ['include', 'Include'], ['split', 'AsSplitQuery'], ['proj', 'Select (projection)']] },
        { type: 'range', p: 'n', label: 'عدد العربيات N', min: 10, max: 500, step: 10, value: 100 },
        { type: 'range', p: 'm', label: 'رحلات لكل عربية M', min: 1, max: 50, step: 1, value: 10 },
        { type: 'seg', p: 'rtt', label: 'المسافة بين الـ App والداتابيز', value: 'region', opts: [['lan', 'Same rack · 0.3ms'], ['region', 'Same region · 1ms'], ['far', 'Cross-region · 25ms']] }
      ],
      idea: `
        <p><b>N+1</b> معناها: استعلام واحد يجيب N عنصر، وبعدين استعلام لكل عنصر عشان يجيب حاجة مرتبطة بيه. المجموع N+1 رحلة للداتابيز، وكل رحلة بتدفع تمن الشبكة (round trip) حتى لو الاستعلام نفسه سريع.</p>
        <p>في EF Core ده بيحصل مع <b>Lazy Loading</b> (لما تلمس <code>vehicle.Trips</code> جوه loop)، أو لما تعمل query جوه <code>foreach</code>. الحلول: <b>Include</b> بيجيب كله في استعلام واحد بـ JOIN، و <b>AsSplitQuery</b> بيقسمه لاستعلامين، و <b>Projection</b> بـ <code>Select</code> بيجيب الأعمدة اللي محتاجها بس.</p>`,
      real: `
        <p>داشبورد الأسطول بيعرض 100 عربية ولكل واحدة آخر 10 رحلات. بـ lazy loading دي 101 استعلام. على نفس الـ region (1ms round trip) ده حوالي 120ms، وبـ Include أقل من 10ms. لو الـ App اتنقل لـ region تاني (25ms) نفس الكود بقى 2.5 ثانية، من غير أي تغيير في الداتابيز. الاستعلام نفسه سريع، الرحلات هي اللي بتقتل.</p>`,
      try: 'ابدأ بـ Lazy loading وغيّر المسافة لـ «Cross-region»: الوقت بيتضرب. حوّل لـ Include: استعلام واحد، بس شوف عدد الـ bytes: بيانات العربية بتتكرر مع كل رحلة. زوّد M لـ 50 وقارن Include بـ AsSplitQuery. وفي الآخر Projection: أقل bytes بكتير.',
      also: 'قائمة المحادثات وآخر رسالة في كل واحدة في الشات، والطلبات ومنتجاتها في منصات التوصيل، والحسابات وآخر معاملاتها في البنوك.',
      net: `
<pre><span class="c">// N+1: كل vehicle.Trips بتعمل query (Lazy loading)</span>
foreach (var v in await db.Vehicles.ToListAsync())
    total += v.Trips.Count;

<span class="c">// Include: استعلام واحد بـ JOIN</span>
var list = await db.Vehicles.Include(v =&gt; v.Trips).ToListAsync();

<span class="c">// AsSplitQuery: استعلامين، من غير تكرار بيانات العربية</span>
var list = await db.Vehicles.Include(v =&gt; v.Trips)
    .AsSplitQuery().ToListAsync();

<span class="c">// Projection: الأعمدة اللي الشاشة محتاجاها بس</span>
var rows = await db.Vehicles.Select(v =&gt; new {
    v.Plate,
    Trips = v.Trips.OrderByDescending(t =&gt; t.StartTs)
                   .Take(10).Select(t =&gt; new { t.StartTs, t.Km })
}).ToListAsync();</pre>`,
      deep: [
        '<b>Lazy loading مش شغال في EF Core بشكل افتراضي.</b> لازم تفعّله بـ <code>UseLazyLoadingProxies()</code> والـ navigation properties تبقى <code>virtual</code>. بس الـ N+1 ممكن يحصل من غيره: <code>await db.Trips.Where(t =&gt; t.VehicleId == v.Id).ToListAsync()</code> جوه <code>foreach</code> هو نفس المشكلة.',
        '<b>Cartesian explosion:</b> الـ Include لـ collection بيرجّع صف لكل رحلة وبيكرر أعمدة العربية فيه. لو عملت Include لاتنين collections (رحلات و تنبيهات)، الصفوف بتبقى N × رحلات × تنبيهات. EF Core بيطلّع warning في الحالة دي، والحل <code>AsSplitQuery()</code> أو projection.',
        '<b>AsSplitQuery له تمن:</b> استعلامين يعني round trip زيادة، ولو الداتا اتغيرت بينهم ممكن النتيجة متبقاش متسقة (إلا لو جوه transaction بـ snapshot). ممكن تخليه الـ default بـ <code>UseQuerySplittingBehavior(QuerySplittingBehavior.SplitQuery)</code>.',
        '<b>اكتشاف الـ N+1:</b> فعّل logging لـ <code>Microsoft.EntityFrameworkCore.Database.Command</code> وعدّ الاستعلامات لكل request، أو استخدم OpenTelemetry/Application Insights وشوف عدد الـ dependency calls. أي request فيه عشرات الـ SQL calls المتشابهة هو مشتبه فيه.',
        '<b>الأرقام هنا:</b> 1 Gbps للنقل، و 0.15ms + 0.002ms لكل صف شغل على السيرفر، وأحجام صفوف تقريبية (420 B للعربية كاملة، 260 B للرحلة). الأرقام الحقيقية بتختلف، بس النسبة بين الطرق هي اللي بتفرق.'
      ]
    })
  });
})();
