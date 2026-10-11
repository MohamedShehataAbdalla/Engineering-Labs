/* Databases · SQL vs NoSQL vs Time-series: where do GPS points live?
   This one is an estimation model, not a timing simulation: storage and bytes-read per query are computed from stated
   per-point sizes (see "أعمق" — they are approximations) for the configured fleet and retention. The ingest stream
   and the read bars animate those computed numbers. */
(function () {
  "use strict";
  const { clamp, lerp, ease, fmt, f1, bytes } = Lab.util;
  const { box, tx, dot, cyl, alpha, line } = Lab.draw;

  const DAYS = [1, 7, 30, 90, 365];
  const PER_DAY_VEH = 8640;                       // one point every 10 s
  // bytes stored per point (approximate, incl. the index needed for the queries)
  const STORE = [
    { id: 'sql', name: 'SQL rowstore', sub: 'SQL Server · clustered (VehicleId, Ts)', perPt: 47, col: 'a2' },
    { id: 'doc', name: 'Document', sub: 'doc per point + index', perPt: 150, col: 'violet' },
    { id: 'ts', name: 'Time-series', sub: 'columnar + compression', perPt: 6, col: 'good' }
  ];
  const PAGE = 8192;

  function model(p) {
    const veh = p.fleet, days = DAYS[p.days], pts = veh * PER_DAY_VEH * days;
    const out = {};
    for (const s of STORE) {
      const store = pts * s.perPt;
      let read;
      if (p.q === 'last') read = 4 * PAGE;                                      // index seek to the newest point
      else if (p.q === 'path') {                                                // one vehicle, one day (8,640 points)
        if (s.id === 'sql') read = (Math.ceil(PER_DAY_VEH / Math.floor(8096 / 47)) + 3) * PAGE;
        if (s.id === 'doc') read = (PER_DAY_VEH + 3) * PAGE;                    // points of one vehicle are scattered between other vehicles' docs
        if (s.id === 'ts') read = PER_DAY_VEH * s.perPt + 3 * PAGE;             // one compressed segment
      } else {                                                                  // fleet average speed over the whole retention
        if (s.id === 'sql') read = pts * 47;                                     // every row, every column
        if (s.id === 'doc') read = pts * 150;
        if (s.id === 'ts') read = pts * 1.2;                                     // only the Speed column, compressed
      }
      out[s.id] = { store, read };
    }
    return { pts, days, out };
  }

  Lab.registerSim('storage-engines', {
    height: 340, warm: 1,
    init(s) { s.st = { m: model(s.p), t0: s.t, dots: [], acc: 0 }; },
    onParam(s) { const st = s.st; st.m = model(s.p); st.t0 = s.t; },
    step(s, dt) {
      const st = s.st;
      st.acc += dt * 30;
      while (st.acc >= 1) { st.acc -= 1; if (st.dots.length < 60) st.dots.push({ t0: s.t, to: Math.floor(s.rng() * 3), y: s.rng() }); }
      st.dots = st.dots.filter(d => s.t - d.t0 < 0.9);
      if (s.t - st.t0 > 5) st.t0 = s.t;
    },
    draw(s) {
      const st = s.st, m = st.m, C = s.C, n = s.narrow, W = s.w, H = s.h, t = s.t;
      const colW = (W - 28) / 3, top = 30;
      // ingest stream from the devices (top) into the three stores
      tx(`${fmt(s.p.fleet)} devices × 1 point / 10 s = ${fmt(s.p.fleet / 10)} points/s`, W / 2, 14, { m: 1, s: n ? 9 : 11, w: 600, c: C.accent });
      for (const d of st.dots) {
        const k = ease(clamp((t - d.t0) / 0.9, 0, 1)), x = 14 + colW * d.to + colW / 2;
        dot(lerp(W / 2, x + (d.y - 0.5) * 30, k), lerp(20, top + 50, k), 2.6, C.accent);
      }
      const maxStore = Math.max(...STORE.map(x => m.out[x.id].store));
      const minRead = Math.min(...STORE.map(x => m.out[x.id].read)), maxRead = Math.max(...STORE.map(x => m.out[x.id].read));
      const logW = v => clamp(Math.log10(v) / Math.log10(maxRead * 10), 0.05, 1);
      const e = clamp((t - st.t0) / 2.2, 0, 1);
      STORE.forEach((sp, i) => {
        const x = 14 + colW * i, cx = x + colW / 2, o = m.out[sp.id], col = C[sp.col];
        cyl(cx - 26, top + 54, 52, 56, { stroke: col, lw: 1.6 });
        tx(sp.name, cx, top + 128, { m: 1, s: n ? 10 : 12, w: 700, c: col });
        if (!n) tx(sp.sub, cx, top + 145, { m: 1, s: 9, c: C.muted });
        // storage bar (linear vs the biggest)
        const by = top + 160, bw = colW - 30;
        if (!n) tx('Storage', x + 15, by, { m: 1, s: 9, c: C.muted, a: 'left' });
        box(x + 15, by + 8, bw, 10, { r: 3, fill: C.surface });
        box(x + 15, by + 8, bw * o.store / maxStore, 10, { r: 3, fill: col, stroke: null });
        tx(bytes(o.store), n ? cx : x + 15 + bw, by, { m: 1, s: n ? 9 : 10, w: 700, a: n ? 'center' : 'right' });
        // bytes read for the selected query (log scale, animated fill)
        const ry = by + 44, best = o.read === minRead;
        if (!n) tx('Read', x + 15, ry, { m: 1, s: 9, c: C.muted, a: 'left' });
        box(x + 15, ry + 8, bw, 10, { r: 3, fill: C.surface });
        box(x + 15, ry + 8, bw * logW(o.read) * e, 10, { r: 3, fill: best ? C.good : o.read > minRead * 50 ? C.bad : C.accent, stroke: null });
        tx(bytes(o.read), n ? cx : x + 15 + bw, ry, { m: 1, s: n ? 9 : 10, w: 700, a: n ? 'center' : 'right', c: best ? C.good : C.ink });
        if (best && e >= 1) tx('✓ أقل قراية', cx, ry + 34, { s: 11, w: 700, c: C.good });
      });
      tx(n ? 'bar 1 = storage · bar 2 = read (log)' : 'read bars: log scale', W - 14, H - 10, { m: 1, s: 9, c: C.muted, a: 'right' });
    },
    stats(s) {
      const m = s.st.m, o = m.out, minR = Math.min(o.sql.read, o.doc.read, o.ts.read), minS = Math.min(o.sql.store, o.doc.store, o.ts.store);
      const tone = (v, min) => v === min ? 'good' : v > min * 20 ? 'bad' : '';
      return [
        ['Storage: SQL rowstore', bytes(o.sql.store), tone(o.sql.store, minS)],
        ['Storage: Document', bytes(o.doc.store), tone(o.doc.store, minS)],
        ['Storage: Time-series', bytes(o.ts.store), tone(o.ts.store, minS)],
        ['Read: SQL rowstore', bytes(o.sql.read), tone(o.sql.read, minR)],
        ['Read: Document', bytes(o.doc.read), tone(o.doc.read, minR)],
        ['Read: Time-series', bytes(o.ts.read), tone(o.ts.read, minR)],
        [`Points في ${m.days} يوم`, fmt(m.pts)]
      ];
    }
  });

  Lab.registerLesson({
    id: 'storage-engines', lab: 'databases', title: 'SQL vs NoSQL vs Time-series',
    html: Lab.tpl.lesson({
      sim: 'storage-engines', level: 2,
      terms: ['Rowstore', 'Document Store', 'Time-series', 'Columnstore', 'Compression'],
      lede: 'نفس تيار نقط الـ GPS داخل لـ 3 أنواع تخزين. الشريط الأول المساحة اللي بتاخدها الداتا، والتاني قد إيه داتا لازم تتقري عشان ترد على الاستعلام المختار. ده نموذج تقديري مبني على أحجام تقريبية مكتوبة تحت.',
      aria: 'مقارنة تقديرية بين rowstore و document و time-series لتخزين نقط GPS',
      controls: [
        { type: 'seg', p: 'q', label: 'الاستعلام', value: 'path', opts: [['last', 'آخر موقع لعربية'], ['path', 'مسار عربية ليوم'], ['agg', 'متوسط سرعة الأسطول']] },
        { type: 'range', p: 'days', label: 'مدة الاحتفاظ بالداتا', min: 0, max: 4, step: 1, value: 2, map: DAYS.map(String), unit: 'days' },
        { type: 'range', p: 'fleet', label: 'عدد الأجهزة', min: 1000, max: 100000, step: 1000, value: 10000, fmt: 'k' }
      ],
      idea: `
        <p><b>Rowstore</b> (SQL Server العادي) بيخزن الصف كله جنب بعضه في الصفحة: ممتاز لما تجيب صفوف قليلة كاملة بالـ index. <b>Document store</b> (زي MongoDB) بيخزن كل record كـ JSON/BSON فيه أسماء الحقول، مرن جدًا بس أكبر حجمًا. <b>Time-series / Columnstore</b> بيخزن كل عمود لوحده مضغوط ومترتب بالوقت: القيم المتتالية متشابهة (الوقت بيزيد 10 ثواني، السرعة قريبة من اللي قبلها) فالضغط بيبقى عالي جدًا.</p>
        <p>مفيش «أحسن» مطلق. السؤال: أنهي استعلام بيتكرر أكتر، وحجم الداتا قد إيه، ومحتاج تحتفظ بيها قد إيه.</p>`,
      real: `
        <p>10,000 جهاز × نقطة كل 10 ثواني = 86 مليون نقطة في اليوم و 31 مليار في السنة. «آخر موقع» تقريبًا ببلاش في أي تخزين فيه index (والأحسن تخليه في جدول أو cache منفصل). «مسار يوم» بيحتاج الداتا تبقى مترتبة بالعربية ثم الوقت. «تقارير الأسطول على شهور» هي اللي بتفرق: الـ rowstore بيقرا كل الأعمدة لكل النقط، والـ columnstore بيقرا عمود السرعة المضغوط بس.</p>`,
      try: 'اختار «مسار عربية ليوم»: الـ document store من غير تصميم مناسب بيقرا آلاف الصفحات. غيّر لـ «متوسط سرعة الأسطول» وارفع المدة لـ 365 يوم: الفرق بين rowstore و time-series بيوصل لعشرات المرات في القراية والمساحة. بعدين اختار «آخر موقع»: الكل متساوي تقريبًا.',
      also: 'عدّادات الكهربا والمياه في المدن الذكية، وأسعار الأسهم tick by tick في التداول، والـ metrics في أي نظام monitoring: كلها time-series.',
      net: `
<pre><span class="c">-- SQL Server: columnstore للتاريخ، و rowstore للحديث</span>
CREATE CLUSTERED COLUMNSTORE INDEX CCI_GpsHistory
  ON GpsHistory;

<span class="c">-- آخر موقع: جدول صغير بيتحدث (upsert)</span>
MERGE VehicleLastPosition AS t
USING (SELECT @v AS VehicleId) AS s ON t.VehicleId = s.VehicleId
WHEN MATCHED THEN UPDATE SET Lat=@lat, Lng=@lng, Ts=@ts
WHEN NOT MATCHED THEN INSERT VALUES (@v, @lat, @lng, @ts);</pre>
<pre><span class="c">// كتابة سريعة لدفعة نقط من الـ queue</span>
using var bulk = new SqlBulkCopy(conn) {
    DestinationTableName = "GpsPoints", BatchSize = 5000 };
await bulk.WriteToServerAsync(pointsDataTable);</pre>`,
      deep: [
        '<b>أرقام النموذج (تقريبية):</b> rowstore حوالي 47 byte للنقطة (32 byte داتا + overhead الصف و الـ slot). document لكل نقطة حوالي 150 byte (أسماء الحقول متكررة في كل document + <code>_id</code> + index). time-series مضغوط حوالي 6 byte للنقطة. نسب الضغط الحقيقية بتتراوح كتير حسب الداتا، فالمهم الترتيب والفرق، مش الرقم بالظبط.',
        '<b>الـ document store مش لازم يبقى وحش:</b> الـ <i>bucket pattern</i> (document لكل عربية لكل ساعة فيه array من النقط) بيقلل الحجم والقراية جدًا، و MongoDB عنده time-series collections بتعمل كده لوحدها. النموذج هنا بيقارن التصميم الساذج (document لكل نقطة) عشان يوضح ليه التصميم بيفرق.',
        '<b>الـ columnstore في SQL Server</b> بيضغط الداتا في rowgroups (حوالي مليون صف)، وبيقرا الأعمدة المطلوبة بس، وفيه batch mode execution. ممكن تبقى عندك time-series كويسة جوه SQL Server من غير ما تضيف database تانية.',
        '<b>المعمارية الشائعة في التتبع:</b> آخر موقع في Redis أو جدول صغير (للشاشة اللايف)، والأيام الأخيرة في rowstore بـ index على <code>(VehicleId, Ts)</code> (للمسارات)، والتاريخ القديم في columnstore أو time-series DB (للتقارير)، و partition بالشهر عشان الحذف (التجربة اللي فاتت).',
        '<b>الكتابة:</b> 1,000 نقطة في الثانية أسهل بكتير لو اتكتبت دفعات (<code>SqlBulkCopy</code> أو TVP) بدل insert لكل نقطة، لأن كل insert لوحده بيدفع round trip و log flush عند الـ commit.',
        '<b>Read في «آخر موقع»</b> متقدّر بـ 4 صفحات لكل الأنواع (index seek)، و «مسار يوم» في الـ document store متقدّر بصفحة لكل نقطة لأن نقط العربية الواحدة متفرقة وسط نقط باقي العربيات حسب وقت الوصول.'
      ]
    })
  });
})();
