/* Databases · Pages & Rows · Page Split · FILLFACTOR
   A real (leaf-level) model of a clustered index: 8 KB pages, sorted keys per page,
   50/50 mid-page splits, the "append at end of index" case, and REBUILD with FILLFACTOR.
   Everything shown (density, splits, fragmentation) is measured from this model. */
(function () {
  "use strict";
  const { clamp, lerp, ease, f1, fmt, Meter, spawnLoop } = Lab.util;
  const { box, tx, dot, line, hatch, alpha, textW } = Lab.draw;

  const PAGE = 8192, HEADER = 96, USABLE = PAGE - HEADER, SLOT = 2;
  const VEHICLES = 40;
  const FLY = 0.55;

  Lab.registerSim('pages', {
    warm: 3,
    height: 330,

    cap(p) { return Math.floor(USABLE / (p.row + SLOT)); },
    maxPages(s) { return clamp(Math.floor((s.w - 32) / 4), 40, 200); },

    init(s) {
      s.st = {
        pages: [], nextPhys: 0, seq: 0, rows: 0, next: 0,
        fly: [], last: null, lastKey: '', moved: 0,
        splits: new Meter(4), splitsTotal: 0, truncAt: -9, rebuildAt: -9, capAt: s.t
      };
      s.setCap('<b>INSERT</b>كل نقطة GPS بتتكتب كصف جوه صفحة 8 KB. الصف الجديد بيروح الصفحة اللي الـ key بتاعه مكانه فيها، مش أول مكان فاضي.');
    },

    /** caption: events can fire many times per second, so hold each message long enough to read */
    say(s, html, force) {
      const st = s.st;
      if (!force && s.t - (st.capAt === undefined ? -9 : st.capAt) < 3) return;
      st.capAt = s.t; s.setCap(html);
    },

    onParam(s, k) {
      if (k === 'row' || k === 'key') this.init(s);
      if (k === 'ff') this.say(s,'<b>FILLFACTOR</b>بيتطبّق بس وقت <code>CREATE</code> أو <code>REBUILD</code>. اضغط «REBUILD» عشان تشوف أثره، الـ inserts العادية بتملى الصفحة لآخرها.', true);
    },

    /* ---- key generation ---- */
    newKey(s) {
      const st = s.st, mode = s.p.key;
      st.seq++;
      if (mode === 'identity') return { k: st.seq, label: 'Id = ' + fmt(st.seq) };
      if (mode === 'vehicle') {
        const v = 1 + Math.floor(s.rng() * VEHICLES);
        const sec = st.seq;
        const hh = String(8 + Math.floor(sec / 3600) % 24).padStart(2, '0'), mm = String(Math.floor(sec / 60) % 60).padStart(2, '0'), ss = String(sec % 60).padStart(2, '0');
        return { k: v * 1e9 + st.seq, label: `(VehicleId ${v}, Ts ${hh}:${mm}:${ss})` };
      }
      const r = s.rng();
      const hex = Math.floor(r * 0xffffffff).toString(16).padStart(8, '0');
      return { k: r, label: `Id = ${hex}-…  (NEWID)` };
    },

    /* ---- B-tree leaf level ---- */
    findPage(st, k) {
      const P = st.pages; let lo = 0, hi = P.length - 1, ans = 0;
      while (lo <= hi) { const m = (lo + hi) >> 1; if (P[m].keys[0] <= k) { ans = m; lo = m + 1; } else hi = m - 1; }
      return ans;
    },
    newPage(st) { return { phys: st.nextPhys++, keys: [], touch: -9, split: -9 }; },
    insertSorted(arr, k) { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < k) lo = m + 1; else hi = m; } arr.splice(lo, 0, k); },

    insert(s, key) {
      const st = s.st, cap = this.cap(s.p), t = s.t;
      if (!st.pages.length) st.pages.push(this.newPage(st));
      let i = this.findPage(st, key.k), pg = st.pages[i];
      if (pg.keys.length >= cap) {
        const isLast = i === st.pages.length - 1 && key.k > pg.keys[pg.keys.length - 1];
        const q = this.newPage(st);
        if (isLast) {
          // end-of-index: new empty page, nothing moves
          st.pages.push(q); i++; pg = q;
          this.say(s, `<b>new page</b>الصفحة (1:${pg.phys - 1}) اتملت، والـ key أكبر من كل اللي قبله. SQL Server بيضيف صفحة جديدة فاضية في الآخر، ومفيش صفوف اتنقلت.`);
        } else {
          // mid-page split: move upper half of the rows to a new page allocated at the end of the file
          const half = Math.floor(pg.keys.length / 2);
          q.keys = pg.keys.splice(half);
          st.pages.splice(i + 1, 0, q);
          pg.split = q.split = t;
          st.splits.add(t); st.splitsTotal++; st.moved += q.keys.length;
          this.say(s, `<b>page split</b>الصفحة (1:${pg.phys}) مليانة والـ key لازم يدخل في نصها. اتنقل ${q.keys.length} صف لصفحة جديدة (1:${q.phys}) في آخر الملف، فالترتيب على الديسك بقى غير الترتيب المنطقي.`);
          if (key.k >= q.keys[0]) { i++; pg = q; }
        }
      }
      this.insertSorted(pg.keys, key.k);
      pg.touch = t; st.rows++; st.last = pg; st.lastKey = key.label;
      return pg;
    },

    rebuild(s) {
      const st = s.st, cap = this.cap(s.p);
      const per = Math.max(1, Math.floor(cap * s.p.ff / 100));
      const all = []; for (const p of st.pages) for (const k of p.keys) all.push(k);
      st.pages = []; st.nextPhys = 0;
      for (let i = 0; i < all.length; i += per) { const p = this.newPage(st); p.keys = all.slice(i, i + per); st.pages.push(p); }
      st.rebuildAt = s.t; st.fly = [];
      st.last = st.pages[st.pages.length - 1] || null;
      this.say(s, `<b>REBUILD</b>كل الصفوف اتكتبت من جديد بالترتيب، وكل صفحة اتملت لـ ${s.p.ff}% بس (${per} صف من ${cap}). الفراغ ده هو اللي هيستقبل الـ inserts الجاية من غير split.`, true);
    },

    step(s) {
      const st = s.st, t = s.t;
      let full = false;
      spawnLoop(st, t, s.p.rate, s.rng, () => {
        if (full || st.pages.length >= this.maxPages(s)) { full = true; return; }
        const pg = this.insert(s, this.newKey(s));
        if (st.fly.length < 90) st.fly.push({ pg, t0: t });
      });
      st.fly = st.fly.filter(f => t - f.t0 < FLY);
      if (full) {
        this.init(s); s.st.truncAt = t; s.st.next = t + 0.6;
        this.say(s, '<b>TRUNCATE</b>الجدول وصل لآخر المساحة اللي تترسم، فبدأنا من جدول فاضي والأرقام التراكمية اتصفّرت.', true);
      }
    },

    /* ---- drawing ---- */
    layout(s) {
      const n = s.narrow, barY = 30, barH = n ? 34 : 40;
      const legend = barY + barH + 14;                    // 1 line (wide) or 2 lines (narrow)
      const insertY = legend + (n ? 32 : 22);
      const capY = n ? insertY + 17 : insertY;            // same line on wide screens
      return { x0: 14, x1: s.w - 14, barY, barH, legend, insertY, capY, stripTop: capY + 22, stripB: s.h - 30 };
    },
    pageRect(s, g, i, n) {
      const W = g.x1 - g.x0, slot = Math.min(34, W / Math.max(n, 1));
      const pw = Math.min(30, slot - (slot > 6 ? 2 : 0.6));
      return { x: g.x0 + i * slot, w: Math.max(1, pw) };
    },

    draw(s) {
      const st = s.st, p = s.p, C = s.C, t = s.t, g = this.layout(s), cap = this.cap(p);
      const P = st.pages, n = P.length;

      /* page anatomy (latest touched page) */
      const pg = st.last;
      const bw = g.x1 - g.x0, sx = bw / PAGE;
      tx(pg ? `Page (1:${pg.phys})  ·  8 KB = 8,192 bytes` : 'Page · 8 KB', g.x0, g.barY - 16, { m: 1, s: 12, w: 600, a: 'left' });
      if (!s.narrow) tx('تشريح آخر صفحة اتكتب فيها', g.x1, g.barY - 16, { s: 11, c: C.muted, a: 'right' });
      box(g.x0, g.barY, bw, g.barH, { r: 4, fill: C.surface });
      const hw = Math.max(4, HEADER * sx);
      box(g.x0, g.barY, hw, g.barH, { r: 3, fill: C.violet, stroke: null });
      if (pg) {
        const rw = p.row * sx, k = pg.keys.length;
        const newest = st.lastKey && pg === st.last ? pg.keys.length - 1 : -1;
        for (let i = 0; i < k; i++) {
          const x = g.x0 + hw + i * rw;
          alpha(i % 2 ? 0.75 : 0.95, () => box(x, g.barY + 4, Math.max(0.8, rw - (rw > 4 ? 1 : 0)), g.barH - 8, { r: rw > 6 ? 2 : 0, fill: C.a2, stroke: null }));
        }
        if (newest >= 0 && t - pg.touch < 0.5) box(g.x0 + hw + (k - 1) * rw, g.barY + 2, Math.max(2, rw), g.barH - 4, { r: 2, fill: C.accent, stroke: null });
        const slotW = Math.max(3, k * SLOT * sx);
        box(g.x1 - slotW, g.barY, slotW, g.barH, { r: 3, fill: C.violet, stroke: null });
        const used = k * (p.row + SLOT), free = USABLE - used;
        const lbl = `header 96 B · ${k} rows × ${fmt(p.row)} B · free ${fmt(free)} B · slot array ${k * SLOT} B`;
        if (!s.narrow) tx(lbl, g.x0, g.legend, { m: 1, s: 11, c: C.muted, a: 'left' });
        else {
          tx(`header 96 B · ${k} rows × ${fmt(p.row)} B`, g.x0, g.legend, { m: 1, s: 10, c: C.muted, a: 'left' });
          tx(`free ${fmt(free)} B · slot array ${k * SLOT} B`, g.x0, g.legend + 14, { m: 1, s: 10, c: C.muted, a: 'left' });
        }
      }
      const rowsLine = g.insertY;
      tx(`INSERT ${st.lastKey || '—'}`, g.x0, g.insertY, { m: 1, s: s.narrow ? 10 : 11, c: C.accent, a: 'left', w: 600 });
      tx(`أقصى عدد صفوف في الصفحة = ${cap}`, g.x1, g.capY, { s: 11, c: C.ink, a: 'right', w: 600 });

      /* leaf level */
      const top = g.stripTop, bot = g.stripB, ph = bot - top;
      tx('Leaf level · key ↑ →', g.x0, bot + 20, { m: 1, s: 11, c: C.muted, a: 'left' });
      if (!s.narrow) tx('الملوّن = امتلاء الصفحة', g.x1, bot + 20, { s: 10, c: C.muted, a: 'right' });
      if (!n) tx('الجدول فاضي', (g.x0 + g.x1) / 2, top + ph / 2, { s: 12, c: C.muted });
      const rects = [];
      for (let i = 0; i < n; i++) {
        const r = this.pageRect(s, g, i, n), pgi = P[i];
        rects.push(r);
        const fill = pgi.keys.length / cap;
        box(r.x, top, r.w, ph, { r: r.w > 8 ? 3 : 0, fill: C.surface, stroke: r.w > 3 ? C.line : null });
        const fh = (ph - 2) * fill;
        box(r.x + (r.w > 3 ? 1 : 0), bot - 1 - fh, Math.max(0.8, r.w - (r.w > 3 ? 2 : 0)), fh, { r: 0, fill: C.a2, stroke: null });
        const sAge = t - pgi.split, tAge = t - pgi.touch;
        if (sAge < 0.8) box(r.x - 1, top - 1, r.w + 2, ph + 2, { r: 3, fill: null, stroke: C.bad, lw: 2 });
        else if (tAge < 0.35) box(r.x, top, r.w, ph, { r: 3, fill: null, stroke: C.accent, lw: 1.5 });
        if (i < n - 1 && P[i + 1].phys !== pgi.phys + 1) dot(r.x + r.w / 2, bot + 7, Math.min(2.5, r.w / 2 + 0.5), C.bad);
        if (r.w >= 22) tx(String(pgi.phys), r.x + r.w / 2, top + 9, { m: 1, s: 9, c: C.muted });
      }
      tx(s.narrow ? '● = fragmentation' : '● = الصفحة اللي بعدها مش جنبها على الديسك (fragmentation)', s.narrow ? g.x1 : (g.x0 + g.x1) / 2 + 40, bot + 20, { s: 10, c: C.muted, a: s.narrow ? 'right' : 'center' });
      if (t - st.rebuildAt < 1.2) alpha(1 - (t - st.rebuildAt) / 1.2, () => tx('REBUILD ✓', (g.x0 + g.x1) / 2, top + ph / 2, { m: 1, s: 16, w: 700, c: C.good }));
      if (t - st.truncAt < 1.2) alpha(1 - (t - st.truncAt) / 1.2, () => tx('TRUNCATE', (g.x0 + g.x1) / 2, top + ph / 2, { m: 1, s: 16, w: 700, c: C.muted }));

      /* rows in flight: from the INSERT source to the page that received them */
      const sx0 = g.x0 + 4, sy0 = rowsLine + 6;
      for (const f of st.fly) {
        const i = P.indexOf(f.pg); if (i < 0) continue;
        const r = rects[i], k = ease(clamp((t - f.t0) / FLY, 0, 1));
        const tx_ = r.x + r.w / 2, ty_ = top + 6;
        dot(lerp(sx0, tx_, k), lerp(sy0, ty_, k), 3.2, C.accent);
      }
    },

    stats(s) {
      const st = s.st, p = s.p, t = s.t, cap = this.cap(p), P = st.pages, n = P.length;
      const minPages = Math.ceil(st.rows / cap) || 0;
      const density = n ? st.rows / (n * cap) * 100 : 0;
      let ooo = 0; for (let i = 0; i < n - 1; i++) if (P[i + 1].phys !== P[i].phys + 1) ooo++;
      const frag = n > 1 ? ooo / (n - 1) * 100 : 0;
      const sr = st.splits.rate(t);
      const waste = (USABLE - cap * (p.row + SLOT)) / PAGE * 100;
      return [
        ['Rows', fmt(st.rows)],
        ['Pages (أقل عدد ممكن)', `${fmt(n)} (${fmt(minPages)})`, n > minPages * 1.3 ? 'warn' : ''],
        ['Page density', Math.round(density) + '%', density < 60 ? 'bad' : density < 85 ? 'warn' : 'good'],
        ['Page splits', `${f1(sr)}/s · ${fmt(st.splitsTotal)}`, sr > 0.5 ? 'bad' : st.splitsTotal ? 'warn' : 'good'],
        ['صفوف اتنقلت بسبب splits', fmt(st.moved), st.moved ? 'warn' : 'good'],
        ['Logical fragmentation', Math.round(frag) + '%', frag > 30 ? 'bad' : frag > 10 ? 'warn' : 'good'],
        ['فراغ ضايع في كل صفحة', Math.round(waste) + '%', waste > 20 ? 'bad' : '']
      ];
    },

    act: { rebuild(s) { s.def.rebuild(s); } }
  });

  Lab.registerLesson({
    id: 'pages', lab: 'databases', title: 'Pages و Rows و Page Split',
    html: Lab.tpl.lesson({
      sim: 'pages', level: 1, caption: true,
      terms: ['Page', 'Row', 'Page Split', 'FILLFACTOR', 'Fragmentation'],
      lede: 'نقط الـ GPS بتتكتب كصفوف جوه صفحات 8 KB. فوق: تشريح آخر صفحة اتكتب فيها. تحت: كل صفحات الجدول بترتيب الـ key، والجزء الملوّن هو نسبة امتلاء كل صفحة.',
      aria: 'محاكاة صفوف بتتكتب في صفحات 8 كيلوبايت وبتحصل Page Splits',
      acts: [['rebuild', 'REBUILD']],
      controls: [
        { type: 'seg', p: 'key', label: 'الـ Clustered key', value: 'identity', opts: [['identity', 'Id IDENTITY'], ['vehicle', '(VehicleId, Ts)'], ['newid', 'NEWID()']] },
        { type: 'seg', p: 'row', label: 'حجم الصف شامل الـ overhead', value: 200, opts: [[50, '50 B'], [200, '200 B'], [1000, '1000 B'], [4100, '4100 B']] },
        { type: 'range', p: 'rate', label: 'معدل الـ INSERT', min: 5, max: 120, step: 5, value: 25, unit: 'rows/s' },
        { type: 'range', p: 'ff', label: 'FILLFACTOR: بيتطبّق مع REBUILD', min: 50, max: 100, step: 5, value: 100, unit: '%' }
      ],
      idea: `
        <p>SQL Server مش بيقرا ويكتب صفوف، بيقرا ويكتب <b>Pages</b>. كل صفحة 8 KB (8,192 bytes): أول 96 byte <b>header</b>، وبعدين الصفوف، وفي آخر الصفحة <b>slot array</b> (2 bytes لكل صف) بيقول كل صف موجود فين. كل 8 صفحات بيكوّنوا <b>Extent</b> (64 KB).</p>
        <p>لو الجدول عليه <b>clustered index</b>، صفوفه مترتبة منطقيًا بالـ key. لو صف جديد لازم يدخل صفحة مليانة، بيحصل <b>Page Split</b>: حوالي نص الصفوف بيتنقل لصفحة جديدة. <b>FILLFACTOR</b> نسبة الملء وقت بناء الـ index، عشان يفضل مكان للـ inserts الجاية. <b>Fragmentation</b> معناها إن ترتيب الصفحات المنطقي بقى مختلف عن ترتيبها على الديسك.</p>`,
      real: `
        <p>جدول <code>GpsPoints</code> بياخد 1,000 insert في الثانية. لو الـ clustered key هو <code>Id IDENTITY</code>، كل الكتابة بتروح لآخر صفحة، والصفحات بتتملي 100% من غير splits. لو هو <code>NEWID()</code>، كل صف بيقع في مكان عشوائي، فالـ splits مبتقفش والصفحات بتستقر حوالي 69% مليانة. يعني نفس الداتا بتاخد صفحات أكتر بحوالي 45%، وده IO وذاكرة أكتر في كل قراءة.</p>`,
      try: 'قارن <code>IDENTITY</code> و <code>NEWID()</code> في Page density والـ Fragmentation. بعدين خلّي FILLFACTOR = 70 واضغط REBUILD: الـ splits هتختفي فترة لحد ما الفراغ يتملي وبعدين ترجع. وجرّب صف 4100 B: صف واحد بس يدخل الصفحة، ونصها بيفضل فاضي على طول.',
      also: 'بوابات الدفع والبنوك (<code>TransactionId</code> من نوع GUID)، والشات (<code>MessageId</code>)، وطلبات منصات التوصيل.',
      net: `
<pre><span class="c">-- key متزايد: الكتابة كلها في آخر صفحة</span>
CREATE TABLE GpsPoints (
  Id BIGINT IDENTITY PRIMARY KEY CLUSTERED,
  VehicleId INT NOT NULL, Ts DATETIME2(0) NOT NULL,
  Lat DECIMAL(9,6), Lng DECIMAL(9,6), Speed SMALLINT);

<span class="c">-- اترك 10% فاضي في كل صفحة</span>
ALTER INDEX ALL ON GpsPoints
  REBUILD WITH (FILLFACTOR = 90);

<span class="c">-- قيس الامتلاء والـ fragmentation</span>
SELECT avg_page_space_used_in_percent,
       avg_fragmentation_in_percent, page_count
FROM sys.dm_db_index_physical_stats(
  DB_ID(), OBJECT_ID('GpsPoints'), NULL, NULL, 'SAMPLED');</pre>
<pre><span class="c">// EF Core: الـ long key بيتعمل IDENTITY تلقائيًا</span>
modelBuilder.Entity&lt;GpsPoint&gt;()
    .HasIndex(p =&gt; new { p.VehicleId, p.Ts });</pre>`,
      deep: [
        '<b>المشكلة التانية للـ IDENTITY:</b> كل الـ threads بتكتب في نفس آخر صفحة، فبيحصل contention على الـ latch بتاعها (<code>PAGELATCH_EX</code>) لما الحمل يبقى عالي. من SQL Server 2019 فيه <code>OPTIMIZE_FOR_SEQUENTIAL_KEY = ON</code> على الـ index بيخفف ده.',
        '<b>ليه 69% بالذات؟</b> مع inserts عشوائية و split نص بنص، متوسط امتلاء الـ B-tree بيستقر حوالي ln 2 ≈ 69%. ده نتيجة رياضية معروفة، وهتشوفها بتطلع لوحدها في المحاكاة.',
        '<b>(VehicleId, Ts)</b> بيخلّي «مسار عربية في يوم» صفحات جنب بعض، فالقراءة سريعة جدًا. التمن إن الكتابة بتعمل splits في نص الـ index. فيه تصميم شائع: clustered على <code>Id</code> للكتابة، و non-clustered على <code>(VehicleId, Ts)</code> للقراءة. تجربة «Clustered vs Non-clustered» بتقيس الفرق ده.',
        '<b>GUIDs:</b> EF Core بيولّد للـ <code>Guid</code> keys قيم sequential من ناحية العميل (<code>SequentialGuidValueGenerator</code>) عشان يقلل الـ splits. لكن خد بالك: <code>Guid.CreateVersion7()</code> (.NET 9) مترتب بالوقت، بس SQL Server بيقارن الـ <code>uniqueidentifier</code> بآخر 6 bytes الأول، فـ UUIDv7 بيتصرف في الـ clustered index قريب من الـ NEWID.',
        '<b>الـ split مكلف في الـ log:</b> نقل الصفوف لصفحة جديدة بيتسجل كله في الـ transaction log، فالـ mid-page split بيولّد log أكتر بكتير من insert عادي.',
        '<b>Fragmentation مقابل Density:</b> على SSD تأثير الترتيب على الديسك أقل من زمان، لكن الـ density مهمة دايمًا: صفحات أكتر يعني buffer pool أكبر و IO أكتر لنفس عدد الصفوف.',
        '<b>ترتيب الصفوف جوه الصفحة</b> بيحفظه الـ slot array، مش مكان الصف نفسه. عشان كده الصف الجديد بيتكتب في آخر الجزء المستخدم (البرتقالي في الرسم) حتى لو الـ key بتاعه في النص.',
        '<b>تبسيطات في المحاكاة:</b> بنعمل الـ split نص بنص بعدد الصفوف، و SQL Server الحقيقي بيختار نقطة التقسيم بالحجم ومكان الـ insert، فالنتيجة «تقريبًا نص بنص». حجم الصف ثابت، وأقصى صف in-row في الحقيقة 8,060 bytes. والجدول بيتعمله TRUNCATE لما يوصل لآخر المساحة اللي تترسم.'
      ]
    })
  });
})();
