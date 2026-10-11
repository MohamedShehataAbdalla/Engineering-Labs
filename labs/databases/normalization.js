/* Databases · Normalization vs Denormalization
   Dashboard reads "trip + driver name"; occasionally a driver's name changes.
   Normalized: name lives once in Drivers → read = trip + JOIN lookup, rename = 1 row.
   Denormalized: name copied into every trip → read = 1 row, rename = update every trip of that driver, done in
   batches at a fixed speed; reads that land on a not-yet-updated trip return the old name (counted, not scripted). */
(function () {
  "use strict";
  const { clamp, lerp, ease, fmt, f1, bytes, Meter, spawnLoop } = Lab.util;
  const { box, tx, dot, line, alpha, arrow } = Lab.draw;

  const D = 6, UPD_RATE = 400, SHOW = 10;          // drivers, rows/s for the batched UPDATE, cells per driver drawn
  const NAMES = [['Ahmed', 'Ahmed S.'], ['Mona', 'Mona K.'], ['Omar', 'Omar F.'], ['Sara', 'Sara M.'], ['Youssef', 'Youssef A.'], ['Nour', 'Nour H.']];

  Lab.registerSim('normalization', {
    height: 330, warm: 2,
    init(s) {
      s.st = {
        drv: NAMES.map((n, i) => ({ ver: 0, prop: 1, t0: 0, flash: -9 })),
        next: 0, nextRename: s.t + 3, reads: new Meter(5), stale: 0, total: 0, staleM: new Meter(10), readM: new Meter(10),
        dots: [], writes: 0, lastRenameRows: 0, renames: 0
      };
    },
    onParam(s, k) { if (k === 'mode' || k === 'trips') this.init(s); },

    rename(s, d) {
      const st = s.st, x = st.drv[d === undefined ? Math.floor(s.rng() * D) : d];
      x.ver++; x.t0 = s.t; x.flash = s.t; st.renames++;
      if (s.p.mode === 'norm') { x.prop = 1; st.writes += 1; st.lastRenameRows = 1; }
      else { x.prop = 0; st.writes += s.p.trips; st.lastRenameRows = s.p.trips; }
    },

    step(s, dt) {
      const st = s.st, p = s.p, t = s.t;
      for (const x of st.drv) if (x.prop < 1) x.prop = Math.min(1, x.prop + UPD_RATE * dt / p.trips);
      if (t >= st.nextRename) { this.rename(s); st.nextRename = t + 60 / p.renames; }
      spawnLoop(st, t, p.reads, s.rng, () => {
        const d = Math.floor(s.rng() * D), idx = s.rng();
        const x = st.drv[d];
        // denormalized trip rows that the batched UPDATE hasn't reached yet still carry the old name
        const stale = p.mode === 'denorm' && idx >= x.prop;
        st.total++; st.readM.add(t); if (stale) { st.stale++; st.staleM.add(t); }
        if (st.dots.length < 40) st.dots.push({ t0: t, d, idx, stale });
      });
      st.dots = st.dots.filter(o => t - o.t0 < 0.9);
    },

    draw(s) {
      const st = s.st, p = s.p, C = s.C, n = s.narrow, W = s.w, H = s.h, t = s.t;
      const norm = p.mode === 'norm';
      const dx0 = 14, dw = n ? 96 : 150, top = 40, rh = Math.min(34, (H - 110) / D);
      const gx0 = dx0 + dw + (n ? 18 : 60), gx1 = W - 14, gw = (gx1 - gx0) / D, ch = (H - 110) / SHOW;
      // Drivers table (normalized only holds the name)
      tx(norm && !n ? 'Drivers (Id, Name)' : 'Drivers', dx0, top - 14, { m: 1, s: 11, w: 700, a: 'left', c: C.violet });
      st.drv.forEach((x, i) => {
        const y = top + i * rh;
        box(dx0, y, dw, rh - 5, { r: 5, stroke: t - x.flash < 1 ? C.accent : C.line, lw: t - x.flash < 1 ? 2 : 1 });
        tx(NAMES[i][x.ver % 2], dx0 + 8, y + rh / 2 - 2, { m: 1, s: n ? 10 : 11, w: 600, a: 'left' });
      });
      // Trips grid: each column = one driver's trips (sampled)
      tx(n ? 'Trips' : norm ? 'Trips (…, DriverId)' : 'Trips (…, DriverId, DriverName)', gx0, top - 14, { m: 1, s: 11, w: 700, a: 'left', c: C.a2 });
      if (!n) tx(`${fmt(p.trips)} trips / driver`, gx1, top - 14, { m: 1, s: 10, c: C.muted, a: 'right' });
      st.drv.forEach((x, d) => {
        for (let j = 0; j < SHOW; j++) {
          const cx = gx0 + d * gw + 3, cy = top + j * ch, idx = (j + 0.5) / SHOW;
          const upd = norm || idx < x.prop;
          box(cx, cy, gw - 6, ch - 4, { r: 3, fill: upd ? C.surface : 'transparent', stroke: upd ? C.line : C.bad, dash: upd ? null : [3, 2], lw: upd ? 1 : 1.5 });
          if (!norm && gw > 70) tx(NAMES[d][upd ? x.ver % 2 : (x.ver + 1) % 2], cx + (gw - 6) / 2, cy + (ch - 4) / 2, { m: 1, s: 9, c: upd ? C.ink : C.bad });
          else if (norm && gw > 50) tx('#' + (d + 1), cx + (gw - 6) / 2, cy + (ch - 4) / 2, { m: 1, s: 9, c: C.muted });
        }
        if (!norm && x.prop < 1) tx(`UPDATE ${Math.round(x.prop * 100)}%`, gx0 + d * gw + gw / 2, top + SHOW * ch + 8, { m: 1, s: 9, w: 700, c: C.accent });
      });
      // reads: hit a trip cell; normalized also follows the FK to Drivers (the JOIN)
      for (const o of st.dots) {
        const k = clamp((t - o.t0) / 0.9, 0, 1), j = Math.min(SHOW - 1, Math.floor(o.idx * SHOW));
        const tx_ = gx0 + o.d * gw + gw / 2, ty_ = top + j * ch + ch / 2;
        if (norm && k > 0.5) { const kk = (k - 0.5) * 2; dot(lerp(tx_, dx0 + dw, kk), lerp(ty_, top + o.d * rh + rh / 2, kk), 3, C.violet); }
        else dot(lerp(W - 6, tx_, ease(Math.min(1, k * 2))), lerp(H - 40, ty_, ease(Math.min(1, k * 2))), 3.5, o.stale ? C.bad : C.accent);
      }
      const staleNow = st.staleM.sum(t), readsNow = st.readM.sum(t);
      tx(norm ? (n ? 'read = trip + JOIN' : 'read = trip row + Drivers lookup (JOIN)') : 'read = trip row only', 14, H - 16, { m: 1, s: n ? 9 : 10, a: 'left', c: C.muted });
      if (!norm) tx(`stale reads (last 10s): ${staleNow} / ${readsNow}`, W - 14, H - 16, { m: 1, s: 11, w: 700, a: 'right', c: staleNow ? C.bad : C.good });
    },

    stats(s) {
      const st = s.st, p = s.p, norm = p.mode === 'norm';
      const nameBytes = 40, trips = p.trips * D;
      const storage = norm ? D * nameBytes : trips * nameBytes;
      const pct = st.total ? st.stale / st.total * 100 : 0;
      return [
        ['Pages لكل قراية في الداشبورد', norm ? '2' : '1', norm ? 'warn' : 'good'],
        ['صفوف بتتكتب لكل تغيير اسم', fmt(norm ? 1 : p.trips), norm ? 'good' : p.trips > 500 ? 'bad' : 'warn'],
        ['وقت تحديث الاسم في كل مكان', norm ? 'فوري' : f1(p.trips / UPD_RATE) + ' s', norm ? 'good' : 'warn'],
        ['مساحة أسماء السواقين', bytes(storage), norm ? 'good' : 'warn'],
        ['Reads بقيمة قديمة', f1(pct) + '%', pct > 0.5 ? 'bad' : 'good'],
        ['تغييرات اسم', fmt(st.renames)]
      ];
    },

    act: { rename(s) { s.def.rename(s); } }
  });

  Lab.registerLesson({
    id: 'normalization', lab: 'databases', title: 'Normalization vs Denormalization',
    html: Lab.tpl.lesson({
      sim: 'normalization', level: 2,
      terms: ['Normalization', 'Denormalization', 'JOIN', 'Update Anomaly'],
      lede: 'داشبورد الرحلات بيعرض اسم السواق جنب كل رحلة. في الـ Normalized الاسم متخزن مرة واحدة في <code>Drivers</code>، وفي الـ Denormalized متنسخ في كل رحلة. اضغط «غيّر اسم سواق» وشوف التحديث بيوصل كل الصفوف إمتى، والقرايات اللي جت في النص.',
      aria: 'محاكاة normalized vs denormalized مع تحديث اسم السواق',
      acts: [['rename', 'غيّر اسم سواق']],
      controls: [
        { type: 'seg', p: 'mode', label: 'شكل الجداول', value: 'norm', opts: [['norm', 'Normalized (JOIN)'], ['denorm', 'Denormalized: نسخة في كل رحلة']] },
        { type: 'range', p: 'trips', label: 'رحلات لكل سواق', min: 100, max: 5000, step: 100, value: 1000, fmt: 'k' },
        { type: 'range', p: 'reads', label: 'قرايات الداشبورد', min: 2, max: 40, step: 2, value: 16, unit: '/s' },
        { type: 'range', p: 'renames', label: 'تغييرات الاسم', min: 1, max: 20, step: 1, value: 4, unit: '/min' }
      ],
      idea: `
        <p><b>Normalization</b> إن كل معلومة تتخزن في مكان واحد بس، والجداول تشاور على بعض بـ foreign keys. التعديل بيبقى في مكان واحد ومفيش نسختين يختلفوا. التمن إن القراية محتاجة <b>JOIN</b>.</p>
        <p><b>Denormalization</b> إنك تنسخ المعلومة عن قصد جنب المكان اللي بيقراها، عشان القراية تبقى أسرع وأبسط. التمن: مساحة أكبر، وكل تعديل لازم يوصل لكل النسخ. لحد ما يوصل، فيه نسخ قديمة، وده اسمه <b>Update Anomaly</b>.</p>`,
      real: `
        <p>جدول <code>Trips</code> فيه 50 مليون رحلة. لو اسم السواق متنسخ في كل رحلة، تغيير اسم سواق واحد عنده 3,000 رحلة معناه <code>UPDATE</code> لـ 3,000 صف. لو اتعمل batches عشان ميعملش locks طويلة، فيه دقايق التقارير بتعرض الاسمين. بس لو الداشبورد بيتقرا ملايين المرات في اليوم والاسم بيتغير مرة في السنة، الـ JOIN اللي اتوفر ممكن يستاهل.</p>`,
      try: 'في Normalized اضغط «غيّر اسم سواق»: التغيير فوري وصف واحد. حوّل لـ Denormalized وزوّد الرحلات لـ 5,000: التحديث بياخد 12.5 ثانية والقرايات اللي بتيجي في النص بتطلع حمرا. بعدين قارن «Pages لكل قراية» بين الاتنين.',
      also: 'اسم العميل جوه الفاتورة في الفوترة (وده denormalization مقصود: الفاتورة لازم تفضل بالاسم وقت إصدارها)، وعدد الرسايل غير المقروءة في الشات بدل ما يتحسب كل مرة.',
      net: `
<pre><span class="c">-- Normalized: الاسم في مكان واحد</span>
SELECT t.Id, t.StartTs, d.Name
FROM Trips t JOIN Drivers d ON d.Id = t.DriverId
WHERE t.VehicleId = @v;

<span class="c">-- Denormalized: تغيير الاسم = تحديث كل النسخ (batches)</span>
WHILE 1 = 1
BEGIN
  UPDATE TOP (1000) Trips SET DriverName = @new
  WHERE DriverId = @id AND DriverName &lt;&gt; @new;
  IF @@ROWCOUNT = 0 BREAK;
END</pre>
<pre><span class="c">// بديل وسط: الـ read model يتحدث من event</span>
public async Task Handle(DriverRenamed e) =&gt;
    await db.TripReadModels.Where(t =&gt; t.DriverId == e.Id)
      .ExecuteUpdateAsync(s =&gt; s.SetProperty(t =&gt; t.DriverName, e.Name));</pre>`,
      deep: [
        '<b>مش كل نسخة غلط:</b> الفاتورة اللي اتطبعت لازم تفضل بالسعر والاسم وقت إصدارها. ده snapshot مقصود، مش denormalization. اسأل دايمًا: لو الأصل اتغير، النسخة المفروض تتغير؟',
        '<b>ليه batches؟</b> <code>UPDATE</code> واحد لـ 50 ألف صف بيمسك locks كتير، وممكن يعمل lock escalation لـ table lock (حوالي 5,000 lock)، ويولّد log كبير في transaction واحدة. الـ batches بتقلل ده، بس بتفتح window فيه نسخ قديمة.',
        '<b>JOIN على PK مش غالي:</b> lookup في <code>Drivers</code> بالـ clustered key هو 2-3 صفحات، والصفحات العليا غالبًا في الذاكرة. الـ denormalization بيكسب لما الـ JOIN يبقى على جداول كبيرة، أو aggregations متكررة، أو لما تبعد الداتا لـ service تانية.',
        '<b>Indexed View</b> في SQL Server ممكن تخلّي الداتابيز هي اللي تحافظ على نسخة محسوبة مسبقًا (زي إجمالي الكيلومترات لكل عربية) بشكل متسق جوه نفس الـ transaction. له قيود، لكنه أأمن من التحديث اليدوي.',
        '<b>في الـ microservices:</b> كل service عندها نسخة من اللي محتاجاه من الداتا (مثلًا اسم السواق في service التقارير) وبتتحدث بـ events. ده denormalization على مستوى المعمارية، والـ stale reads اللي شايفها هنا هي نفسها الـ eventual consistency.',
        '<b>تبسيطات:</b> التحديث بيمشي بسرعة ثابتة 400 صف في الثانية، والقراية بتختار رحلة عشوائية، و«Pages لكل قراية» تقريب لعدد الـ lookups.'
      ]
    })
  });
})();
