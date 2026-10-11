/* Databases · Clustered vs Non-clustered vs Covering index (+ Key Lookup / RID Lookup)
   Query: SELECT Ts, Lat, Lng, Speed FROM GpsPoints WHERE VehicleId = @v AND Ts >= @from  → k rows.
   Page counts per structure come from real row sizes (perPage) and btreeLevels; logical reads = the walks the
   engine would do. The animation launches one lookup per matching row (capped visually), counters are exact. */
(function () {
  "use strict";
  const { clamp, lerp, ease, fmt, bytes, btreeLevels, perPage } = Lab.util;
  const { box, tx, dot, line, alpha } = Lab.draw;

  const ROWS = [1e6, 1e8];
  const KS = [1, 10, 100, 1000, 10000];
  // rows per page for each structure (bytes per row incl. overhead, see "أعمق")
  const CL_LEAF = perPage(200), CL_FAN = perPage(15);          // clustered on Id BIGINT: 40 / 476
  const NC_LEAF = perPage(27), NC_FAN = perPage(25);           // (VehicleId, Ts) + Id locator: 279 / 299
  const COV_LEAF = perPage(39);                                // + INCLUDE (Lat, Lng, Speed): 197
  const CL2_FAN = perPage(21);                                 // clustered on (VehicleId, Ts) + uniquifier: 352
  const HOP = 0.4;

  const MODES = {
    scan: { plan: 'Clustered Index Scan', ops: ['Clustered Index Scan'] },
    nc: { plan: 'Index Seek → Nested Loops → Key Lookup', ops: ['Index Seek', 'Key Lookup'] },
    cover: { plan: 'Index Seek (covering)', ops: ['Index Seek'] },
    clustered: { plan: 'Clustered Index Seek', ops: ['Clustered Index Seek'] },
    heap: { plan: 'Index Seek → Nested Loops → RID Lookup', ops: ['Index Seek', 'RID Lookup'] }
  };

  function plan(p) {
    const rows = ROWS[p.rows], k = KS[p.k], mode = p.idx;
    const cl = btreeLevels(rows, CL_LEAF, CL_FAN);
    const nc = btreeLevels(rows, NC_LEAF, NC_FAN);
    const cov = btreeLevels(rows, COV_LEAF, NC_FAN);
    const cl2 = btreeLevels(rows, CL_LEAF, CL2_FAN);
    const span = (cap) => Math.ceil((k - 1) / cap) + 1;          // k contiguous rows, worst-case page alignment
    const r = { rows, k, mode, cl, nc, cov, cl2, seek: 0, lookups: 0, perLookup: 0, scan: 0 };
    if (mode === 'scan') r.scan = cl[cl.length - 1];
    if (mode === 'nc') { r.seek = nc.length - 1 + span(NC_LEAF); r.lookups = k; r.perLookup = cl.length; }
    if (mode === 'heap') { r.seek = nc.length - 1 + span(NC_LEAF); r.lookups = k; r.perLookup = 1; }
    if (mode === 'cover') r.seek = cov.length - 1 + span(COV_LEAF);
    if (mode === 'clustered') r.seek = cl2.length - 1 + span(CL_LEAF);
    r.total = r.scan + r.seek + r.lookups * r.perLookup;
    return r;
  }

  Lab.registerSim('index-types', {
    height: 330, warm: 0.6,
    init(s) { s.st = { t0: 0, r: plan(s.p), dots: [], launched: 0, mark: 0 }; },
    onParam(s) { this.init(s); s.st.t0 = s.t; },

    timing(r) {
      const seekT = r.mode === 'scan' ? 0 : HOP * (r.mode === 'clustered' ? r.cl2.length : r.mode === 'cover' ? r.cov.length : r.nc.length);
      const lookT = r.lookups ? clamp(r.lookups * 0.12, 0.8, 3.2) : 0;
      const scanT = r.mode === 'scan' ? 3.2 : 0;
      return { seekT, lookT, scanT, end: seekT + lookT + scanT + 1.6 };
    },

    step(s, dt) {
      const st = s.st, r = st.r, tm = this.timing(r), e = s.t - st.t0;
      if (e >= tm.end) { st.t0 = s.t; st.launched = 0; st.dots = []; st.mark = s.rng(); return; }
      // launch lookup dots during the lookup phase (one per row, at most ~30 visible)
      if (r.lookups && e > tm.seekT) {
        const want = Math.min(r.lookups, Math.floor(clamp((e - tm.seekT) / tm.lookT, 0, 1) * Math.min(r.lookups, 30)));
        while (st.launched < want) { st.dots.push({ t0: s.t, leaf: s.rng() }); st.launched++; }
      }
      st.dots = st.dots.filter(d => s.t - d.t0 < 0.9);
    },

    /** reads counted so far in this run of the query */
    live(s) {
      const st = s.st, r = st.r, tm = this.timing(r), e = s.t - st.t0;
      const seekK = tm.seekT ? clamp(e / tm.seekT, 0, 1) : 1;
      const lookK = tm.lookT ? clamp((e - tm.seekT) / tm.lookT, 0, 1) : 0;
      const scanK = tm.scanT ? clamp(e / tm.scanT, 0, 1) : 0;
      return {
        seek: Math.round(r.seek * seekK), lookups: Math.round(r.lookups * lookK), scan: Math.round(r.scan * scanK),
        seekK, lookK, scanK
      };
    },

    tree(s, cx, top, w, h, levels, col, label, sub, dim) {
      const C = s.C, L = levels.length;
      alpha(dim ? 0.3 : 1, () => {
        const X = Lab.draw.ctx();
        X.beginPath(); X.moveTo(cx, top); X.lineTo(cx + w / 2, top + h); X.lineTo(cx - w / 2, top + h); X.closePath();
        X.fillStyle = C.surface; X.fill(); X.strokeStyle = col; X.lineWidth = 1.5; X.stroke();
        for (let i = 1; i < L; i++) { const y = top + h * i / (L - 1 || 1); if (i < L - 1) line(cx - w / 2 * i / (L - 1), y, cx + w / 2 * i / (L - 1), y, C.line, 1, [3, 3]); }
        tx(label, cx, top + h + 16, { m: 1, s: s.narrow ? 10 : 11, w: 700, c: col });
        if (sub) tx(sub, cx, top + h + 31, { m: 1, s: 10, c: C.muted });
        tx(`depth ${L}`, cx, top - 10, { m: 1, s: 10, c: C.muted });
      });
    },

    draw(s) {
      const st = s.st, r = st.r, C = s.C, n = s.narrow, W = s.w, lv = this.live(s), tm = this.timing(r);
      const e = s.t - st.t0;
      tx('SELECT Ts, Lat, Lng, Speed WHERE VehicleId = @v AND Ts >= @from', 14, 16, { m: 1, s: n ? 9 : 11, w: 600, a: 'left', c: C.accent });
      tx(MODES[r.mode].plan, 14, 33, { m: 1, s: n ? 9 : 11, a: 'left', c: C.ink });

      const top = 66, h = s.h - 140, tw = Math.min(n ? W * 0.42 : 260, W * 0.42);
      const leftX = W * 0.27, rightX = W * 0.73;
      const ncShown = r.mode === 'nc' || r.mode === 'heap' || r.mode === 'cover';
      const tableTree = r.mode === 'clustered' ? r.cl2 : r.cl;
      const tableLabel = r.mode === 'clustered' ? 'Clustered (VehicleId, Ts)' : r.mode === 'heap' ? 'Heap (no clustered index)' : 'Clustered (Id)';
      const ncLevels = r.mode === 'cover' ? r.cov : r.nc;
      const ncLabel = r.mode === 'cover' ? 'NC + INCLUDE' : 'NC (VehicleId, Ts)';
      const tableDim = r.mode === 'cover';

      if (ncShown) this.tree(s, leftX, top, tw, h, ncLevels, C.violet, ncLabel, `${fmt(ncLevels[ncLevels.length - 1])} leaf pages`, false);
      else alpha(0.35, () => tx('مفيش non-clustered index', leftX, top + h / 2, { s: 12, c: C.muted }));
      if (r.mode === 'heap') {
        alpha(1, () => {
          for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) box(rightX - tw / 2 + j * (tw / 4) + 4, top + 8 + i * (h / 6), tw / 4 - 8, h / 6 - 8, { r: 3, stroke: C.a2 });
          tx(tableLabel, rightX, top + h + 16, { m: 1, s: n ? 10 : 11, w: 700, c: C.a2 });
          tx('RID = file:page:slot', rightX, top + h + 31, { m: 1, s: 10, c: C.muted });
        });
      } else this.tree(s, rightX, top, tw, h, tableTree, C.a2, tableLabel, `${fmt(tableTree[tableTree.length - 1])} leaf pages`, tableDim);
      if (tableDim) tx('مش محتاجينه', rightX, top + h / 2, { s: 12, w: 600, c: C.good });

      // seek path
      if (r.mode !== 'scan') {
        const sx = ncShown ? leftX : rightX, k = ease(lv.seekK);
        const tgtX = sx + (st.mark - 0.5) * tw * 0.8;
        line(sx, top, lerp(sx, tgtX, k), top + h * k, C.good, 3);
        dot(lerp(sx, tgtX, k), top + h * k, 5, C.good);
        if (lv.seekK >= 1) {
          const leafCap = r.mode === 'cover' ? COV_LEAF : r.mode === 'clustered' ? CL_LEAF : NC_LEAF;
          const wr = clamp(r.k / leafCap / (ncShown ? ncLevels : tableTree).slice(-1)[0], 0, 1) * tw;
          box(tgtX - 3, top + h - 5, Math.max(6, wr), 10, { r: 3, fill: C.good, stroke: null });
        }
      }
      // lookups: from the NC leaf to the table, one per row
      if (r.lookups) {
        for (const d of st.dots) {
          const k = ease(clamp((s.t - d.t0) / 0.9, 0, 1));
          const fx = leftX + (st.mark - 0.5) * tw * 0.8, fy = top + h;
          const lx = rightX + (d.leaf - 0.5) * tw * 0.9, ly = top + h;
          let x, y;
          if (r.mode === 'heap') { x = lerp(fx, lx, k); y = lerp(fy, top + h * 0.5 - 30 * Math.sin(Math.PI * k), k); }
          else if (k < 0.45) { const kk = k / 0.45; x = lerp(fx, rightX, kk); y = lerp(fy, top, kk) - 20 * Math.sin(Math.PI * kk); }
          else { const kk = (k - 0.45) / 0.55; x = lerp(rightX, lx, kk); y = lerp(top, ly, kk); }
          dot(x, y, 3.5, C.accent);
        }
      }
      // scan
      if (r.mode === 'scan') {
        const bx0 = rightX - tw / 2, bx = lerp(bx0, rightX + tw / 2, lv.scanK);
        box(bx0, top + h - 4, bx - bx0, 8, { r: 3, fill: C.bad, stroke: null });
        if (lv.scanK < 1) dot(bx, top + h, 5, C.bad);
      }

      // counters
      const cy = s.h - 22;
      const parts = [];
      if (r.scan) parts.push([`Scan ${fmt(lv.scan)}`, C.bad]);
      if (r.seek) parts.push([`Seek ${fmt(lv.seek)}`, C.good]);
      if (r.lookups) parts.push([`${r.mode === 'heap' ? 'RID' : 'Key'} Lookups ${fmt(lv.lookups)} × ${r.perLookup} = ${fmt(lv.lookups * r.perLookup)}`, C.accent]);
      let x = 14;
      for (const [t, c] of parts) { tx(t, x, cy, { m: 1, s: n ? 9 : 11, w: 700, a: 'left', c }); x += Lab.draw.textW(t, { m: 1, s: n ? 9 : 11, w: 700 }) + 16; }
      tx(`= ${fmt(lv.scan + lv.seek + lv.lookups * r.perLookup)} reads`, W - 14, cy, { m: 1, s: n ? 10 : 12, w: 700, a: 'right' });
      if (e > tm.end - 1.6) tx('✓', W - 14, cy - 18, { s: 13, w: 700, c: C.good, a: 'right' });
    },

    stats(s) {
      const r = s.st.r;
      const tone = r.total > 10000 ? 'bad' : r.total > 300 ? 'warn' : 'good';
      return [
        ['Operators', MODES[r.mode].ops.join(' + ')],
        ['صفوف راجعة', fmt(r.k)],
        [r.mode === 'heap' ? 'RID Lookups' : 'Key Lookups', fmt(r.lookups), r.lookups > 100 ? 'bad' : r.lookups ? 'warn' : 'good'],
        ['Logical reads', fmt(r.total), tone],
        ['قراءات لكل صف راجع', (r.total / r.k < 10 ? (r.total / r.k).toFixed(2) : fmt(r.total / r.k)), r.total / r.k > 3 ? 'warn' : 'good'],
        ['داتا اتقرت', bytes(r.total * 8192), tone]
      ];
    }
  });

  Lab.registerLesson({
    id: 'index-types', lab: 'databases', title: 'Clustered vs Non-clustered vs Covering',
    html: Lab.tpl.lesson({
      sim: 'index-types', level: 2,
      terms: ['Clustered', 'Non-clustered', 'Covering Index', 'Key Lookup', 'INCLUDE'],
      lede: 'شاشة «مسار العربية»: هات <code>Ts, Lat, Lng, Speed</code> لعربية واحدة من وقت معين. نفس الاستعلام، بس غيّر الـ index وشوف SQL Server بيقرا كام صفحة. البنفسجي هو الـ non-clustered index، والتركواز هو الجدول نفسه.',
      aria: 'محاكاة Key Lookup بين non-clustered index والجدول',
      controls: [
        { type: 'seg', p: 'idx', label: 'الـ Index الموجود', value: 'nc', opts: [['scan', 'مفيش'], ['nc', 'Non-clustered'], ['cover', 'Covering (INCLUDE)'], ['clustered', 'Clustered (VehicleId, Ts)'], ['heap', 'Heap + NC']] },
        { type: 'range', p: 'k', label: 'عدد الصفوف الراجعة', min: 0, max: 4, step: 1, value: 2, map: KS.map(fmt), unit: 'rows' },
        { type: 'range', p: 'rows', label: 'حجم الجدول', min: 0, max: 1, step: 1, value: 1, map: ['1M', '100M'], unit: 'rows' }
      ],
      idea: `
        <p><b>Clustered index</b> هو الجدول نفسه: الـ leaf pages فيها الصفوف كاملة ومترتبة بالـ key. ينفع واحد بس لكل جدول. لو مفيش clustered index، الجدول اسمه <b>Heap</b>: صفوف من غير ترتيب.</p>
        <p><b>Non-clustered index</b> شجرة منفصلة، الـ leaf بتاعها فيها أعمدة الـ index بس ومعاها «عنوان» الصف: الـ clustered key، أو الـ RID في الـ Heap. لو الاستعلام محتاج أعمدة مش في الـ index، SQL Server بيرجع للجدول لكل صف لوحده. ده اسمه <b>Key Lookup</b> (أو <b>RID Lookup</b> في الـ Heap). الـ <b>Covering index</b> فيه كل الأعمدة المطلوبة (بـ <code>INCLUDE</code>)، فمبيحتاجش يرجع للجدول خالص.</p>`,
      real: `
        <p>جدول <code>GpsPoints</code> فيه 100 مليون صف، و clustered على <code>Id</code>. شاشة المسار بتطلب آخر ساعة لعربية: 360 صف. بـ non-clustered على <code>(VehicleId, Ts)</code> بس، كل صف من الـ 360 بيعمل Key Lookup بـ 4 قرايات: حوالي 1,440 قراية، وكلها random. لو ضفت <code>INCLUDE (Lat, Lng, Speed)</code> بيبقوا حوالي 6 قرايات بس.</p>`,
      try: 'ابدأ بـ Non-clustered و 100 صف، وشوف عدد الـ Key Lookups. بعدين اختار Covering. ارفع الصفوف لـ 10,000 وقارن Non-clustered بالـ Scan: هتلاقي الـ lookups قربت من تكلفة الـ Scan. ده اللي بيخلّي الـ optimizer يسيب الـ index (التجربة الجاية).',
      also: 'سجل المعاملات في البنوك (<code>AccountId, Date</code>)، ومحادثات الشات (<code>ConversationId, SentAt</code>): نفس الشكل بالظبط، فلتر بـ key ورينج زمني.',
      net: `
<pre><span class="c">-- Non-clustered عادي: هيعمل Key Lookup لكل صف</span>
CREATE INDEX IX_Gps_Vehicle_Ts
  ON GpsPoints (VehicleId, Ts);

<span class="c">-- Covering: الأعمدة المطلوبة في الـ leaf</span>
CREATE INDEX IX_Gps_Vehicle_Ts_Cover
  ON GpsPoints (VehicleId, Ts)
  INCLUDE (Lat, Lng, Speed);</pre>
<pre><span class="c">// EF Core 5+</span>
b.HasIndex(p =&gt; new { p.VehicleId, p.Ts })
 .IncludeProperties(p =&gt; new { p.Lat, p.Lng, p.Speed });

<span class="c">// اطلب الأعمدة اللي محتاجها بس، عشان الـ index يغطّي</span>
var path = await db.GpsPoints
  .Where(p =&gt; p.VehicleId == id &amp;&amp; p.Ts &gt;= from)
  .Select(p =&gt; new { p.Ts, p.Lat, p.Lng, p.Speed })
  .ToListAsync();</pre>`,
      deep: [
        '<b><code>SELECT *</code> بيبوّظ الـ covering:</b> لو الـ EF query بيرجّع الـ entity كاملة، أي عمود مش في الـ index (حتى لو مش هتستخدمه) بيرجّع الـ Key Lookups. الـ projection بـ <code>Select</code> مش بس بيقلل الـ bytes، ده ممكن يغيّر الـ plan كله.',
        '<b>الـ Key Lookup قراية random:</b> الـ 360 صف بتوع العربية متفرقين على الجدول (لأن الـ clustered key هو <code>Id</code> بترتيب وقت الوصول)، فكل lookup ممكن يبقى صفحة مختلفة. لو مش في الذاكرة، ده physical read منفصل.',
        '<b>RID Lookup أرخص في القراية (صفحة واحدة) بس للـ Heap مشاكل تانية:</b> الـ forwarded records لما صف يكبر ومايلاقيش مكان، وإن المساحة مبتترجعش بسهولة بعد الـ DELETE. عشان كده الـ Heap نادرًا ما يكون الاختيار الصح لجدول OLTP.',
        '<b>Clustered على (VehicleId, Ts)</b> أسرع حاجة للقراية دي، بس بيعمل page splits مع الكتابة (شوف <a href="#/databases/pages">تجربة الصفحات</a>)، ولأنه مش unique بيضيف uniquifier (4 bytes) للصفوف المكررة، وكل non-clustered index تاني بيشيله جوّاه.',
        '<b>تكلفة الـ INCLUDE:</b> الـ covering index نسخة تانية من الأعمدة دي، يعني مساحة أكبر، و كل INSERT بيكتب في الشجرتين. مع 1,000 insert في الثانية، كل index زيادة له تمن في الكتابة.',
        '<b>الأرقام هنا:</b> أحجام الصفوف تقريبية (200 B للجدول، 27 B لصف الـ non-clustered، 39 B مع الـ INCLUDE)، والشجر متملي 100%. الشكل العام هو المهم: Seek + range رخيص، و Lookups بتكبر خطيًا مع عدد الصفوف.'
      ]
    })
  });
})();
