/* Databases · Full Table Scan vs B-Tree Index Seek
   The tree shape (pages per level, depth) is computed from real page capacities: 8,096 usable bytes,
   200-byte data rows in the leaf, ~17-byte entries (8-byte key + 6-byte page pointer + overhead + slot) above it.
   Each query picks a random key; the seek walks the real path root → leaf, the scan reads every leaf page.
   Logical reads shown are counted from those walks. */
(function () {
  "use strict";
  const { clamp, lerp, ease, fmt, bytes, btreeLevels, perPage } = Lab.util;
  const { box, tx, dot, line, alpha } = Lab.draw;

  const ROWS = [1e4, 1e5, 1e6, 1e7, 1e8, 1e9];
  const LEAF_CAP = perPage(200);       // 40 data rows per leaf page
  const FANOUT = perPage(15);          // ~476 child pointers per non-leaf page
  const HOP = 0.5, SCAN_T = 3.2, HOLD = 1.6;

  function rangeK(p) { return p.query === 'point' ? 1 : p.query === 'hour' ? 360 : 8640; }

  Lab.registerSim('btree-index', {
    height: 340, warm: 1,

    init(s) { s.st = { q: null, n: 0, last: null }; this.newQuery(s); },
    onParam(s) { this.newQuery(s); },

    newQuery(s) {
      const st = s.st, p = s.p, rows = ROWS[p.rows], k = Math.min(rangeK(p), rows);
      const lv = btreeLevels(rows, LEAF_CAP, FANOUT);
      const pos = Math.floor(s.rng() * (rows - k + 1));
      // page index on each level, root → leaf
      const leafFirst = Math.floor(pos / LEAF_CAP), leafLast = Math.floor((pos + k - 1) / LEAF_CAP);
      const path = []; let idx = leafFirst;
      for (let i = lv.length - 1; i >= 0; i--) { path.unshift(idx); idx = Math.floor(idx / FANOUT); }
      const rangePages = leafLast - leafFirst + 1;
      const seekReads = (lv.length - 1) + rangePages;
      st.q = { t0: s.t, rows, k, pos, lv, path, leafFirst, leafLast, rangePages, seekReads, scanReads: lv[lv.length - 1] };
      st.n++;
    },

    timing(q) {
      const seekEnd = (q.lv.length - 1) * HOP + (q.rangePages > 1 ? 0.8 : 0.15);
      return { seekEnd, end: Math.max(seekEnd, SCAN_T) + HOLD };
    },

    step(s) {
      const st = s.st, q = st.q, tm = this.timing(q);
      if (s.t - q.t0 >= tm.end) { st.last = q; this.newQuery(s); }
    },

    /** live read counters derived from how far each walk has gone */
    progress(s) {
      const q = s.st.q, e = s.t - q.t0, L = q.lv.length;
      const levelsDone = clamp(Math.floor(e / HOP) + 1, 1, L);
      let seek = levelsDone;
      if (levelsDone === L) {
        const re = clamp((e - (L - 1) * HOP) / 0.8, 0, 1);
        seek = (L - 1) + Math.max(1, Math.ceil(q.rangePages * (q.rangePages > 1 ? re : 1)));
      }
      const sk = clamp(e / SCAN_T, 0, 1);
      return { seek: Math.min(seek, q.seekReads), scan: Math.max(1, Math.round(q.scanReads * sk)), sk, e };
    },

    draw(s) {
      const st = s.st, q = st.q, C = s.C, p = s.p, W = s.w, n = s.narrow;
      const pr = this.progress(s), L = q.lv.length;
      const x0 = 14, x1 = W - 14, cx = (x0 + x1) / 2, labW = n ? 0 : 150;
      const top = 54, leafY = s.h - (n ? 104 : 92);
      const treeX0 = x0 + labW, treeX1 = x1, treeW = treeX1 - treeX0, tcx = (treeX0 + treeX1) / 2;

      const qtxt = p.query === 'point' ? `WHERE Id = ${fmt(q.pos + 1)}` : `WHERE VehicleId = @v AND Ts >= @from   → ${fmt(q.k)} rows`;
      tx(qtxt, x0, 18, { m: 1, s: n ? 10 : 12, w: 600, a: 'left', c: C.accent });
      tx(`${fmt(q.rows)} rows · depth ${L}`, x1, 18, { m: 1, s: n ? 10 : 11, a: 'right', c: C.muted });

      const ly = i => L === 1 ? leafY : lerp(top, leafY, i / (L - 1));
      const lw = i => L === 1 ? treeW : lerp(Math.min(70, treeW), treeW, Math.pow(i / (L - 1), 0.8));
      const pageX = (i, j) => tcx - lw(i) / 2 + (j + 0.5) / q.lv[i] * lw(i);

      for (let i = 0; i < L; i++) {
        const y = ly(i), w = lw(i), cnt = q.lv[i];
        const M = Math.max(1, Math.floor(w / 24));
        const shown = Math.min(cnt, M);
        const bw = Math.min(30, w / shown - 4), bh = 20;
        // links to the level below (just the fan for the highlighted page)
        if (i < L - 1) {
          const px = pageX(i, q.path[i]);
          const childFirst = q.path[i] * FANOUT, childLast = Math.min(q.lv[i + 1] - 1, childFirst + FANOUT - 1);
          alpha(0.5, () => {
            line(px, y + bh / 2, pageX(i + 1, childFirst), ly(i + 1) - bh / 2, C.line, 1);
            line(px, y + bh / 2, pageX(i + 1, childLast), ly(i + 1) - bh / 2, C.line, 1);
          });
        }
        for (let j = 0; j < shown; j++) {
          const gap = cnt > M && j === Math.floor(shown / 2);
          const x = tcx - w / 2 + (j + 0.5) / shown * w;
          if (gap) { tx('…', x, y, { m: 1, s: 12, c: C.muted }); continue; }
          box(x - bw / 2, y - bh / 2, bw, bh, { r: 3, fill: i === L - 1 ? C.surface : C.surface, stroke: i === L - 1 ? C.line : C.violet });
        }
        const name = L === 1 ? 'Root = Leaf' : i === 0 ? 'Root' : i === L - 1 ? 'Leaf (data rows)' : 'Intermediate';
        if (!n) {
          tx(name, x0, y - 6, { m: 1, s: 11, w: 600, a: 'left' });
          tx(`${fmt(cnt)} page${cnt > 1 ? 's' : ''}`, x0, y + 9, { m: 1, s: 10, c: C.muted, a: 'left' });
        } else tx(fmt(cnt), treeX1, y - 15, { m: 1, s: 9, c: C.muted, a: 'right' });
      }

      /* scan: every leaf page, left to right */
      const sy = leafY + 22, scanX = lerp(treeX0, treeX1, pr.sk);
      box(treeX0, sy - 3, treeW, 6, { r: 3, fill: C.bg, stroke: C.line });
      box(treeX0, sy - 3, scanX - treeX0, 6, { r: 3, fill: C.bad, stroke: null });
      if (pr.sk < 1) dot(scanX, sy, 5, C.bad);
      tx(`Table Scan: ${fmt(pr.scan)} / ${fmt(q.scanReads)} pages`, treeX0, sy + 16, { m: 1, s: n ? 10 : 11, w: 600, a: 'left', c: C.bad });

      /* seek: the real root → leaf path, then the range on the leaf level */
      const e = pr.e;
      for (let i = 0; i < L; i++) {
        if (e < i * HOP) break;
        const x = pageX(i, q.path[i]), y = ly(i);
        box(x - 9, y - 11, 18, 22, { r: 4, fill: C.good, stroke: null });
      }
      if (q.rangePages > 1 && e >= (L - 1) * HOP) {
        const re = clamp((e - (L - 1) * HOP) / 0.8, 0, 1);
        const xa = pageX(L - 1, q.leafFirst), xb = pageX(L - 1, q.leafLast);
        box(xa - 9, leafY - 11, Math.max(18, (xb - xa) * re + 18), 22, { r: 4, fill: C.good, stroke: null });
      }
      const segT = clamp(e / HOP, 0, L - 1), si = Math.min(L - 2, Math.floor(segT));
      if (L > 1 && e < (L - 1) * HOP) {
        const k = ease(segT - si);
        dot(lerp(pageX(si, q.path[si]), pageX(si + 1, q.path[si + 1]), k), lerp(ly(si), ly(si + 1), k), 5, C.accent);
      }
      tx(`Index Seek: ${fmt(pr.seek)} pages`, n ? treeX0 : treeX1, sy + (n ? 32 : 16), { m: 1, s: n ? 10 : 11, w: 600, a: n ? "left" : "right", c: C.good });
      if (q.rangePages > 1 && !n) tx(`range = ${fmt(q.rangePages)} contiguous leaf pages`, treeX1, sy + 32, { m: 1, s: 10, c: C.muted, a: 'right' });
    },

    stats(s) {
      const q = s.st.q, ratio = q.scanReads / q.seekReads;
      return [
        ['Rows في الجدول', fmt(q.rows)],
        ['عمق الشجرة (levels)', String(q.lv.length), q.lv.length <= 4 ? 'good' : 'warn'],
        ['Index Seek: logical reads', fmt(q.seekReads), 'good'],
        ['Table Scan: logical reads', fmt(q.scanReads), q.scanReads > 1000 ? 'bad' : 'warn'],
        ['الـ Scan أغلى بـ', '× ' + fmt(ratio), ratio > 100 ? 'bad' : ratio > 5 ? 'warn' : ''],
        ['داتا اتقرت (Seek / Scan)', `${bytes(q.seekReads * 8192)} / ${bytes(q.scanReads * 8192)}`]
      ];
    }
  });

  Lab.registerLesson({
    id: 'btree-index', lab: 'databases', title: 'Full Scan vs Index Seek',
    html: Lab.tpl.lesson({
      sim: 'btree-index', level: 1,
      terms: ['Table Scan', 'B-Tree', 'Index Seek', 'Logical Reads'],
      lede: 'نفس الاستعلام بطريقتين في نفس اللحظة: الـ Seek بينزل في الـ B-tree من الـ root للـ leaf (الأخضر)، والـ Scan بيقرا كل صفحات الجدول واحدة واحدة (الأحمر تحت). العدّاد بيعدّ الصفحات اللي اتقرت فعلًا.',
      aria: 'محاكاة B-tree بتقارن Index Seek مع Table Scan',
      controls: [
        { type: 'range', p: 'rows', label: 'حجم الجدول', min: 0, max: 5, step: 1, value: 2, map: ['10K', '100K', '1M', '10M', '100M', '1B'], unit: 'rows' },
        { type: 'seg', p: 'query', label: 'الاستعلام', value: 'point', opts: [['point', 'صف واحد بالـ Id'], ['hour', 'آخر ساعة لعربية (360)'], ['day', 'يوم كامل (8,640)']] }
      ],
      idea: `
        <p>الـ <b>Index</b> في SQL Server هو <b>B-tree</b> (بالتحديد B+tree): صفحات 8 KB مترتبة في مستويات. الـ <b>Root</b> فوق، وتحته <b>Intermediate</b>، وتحت خالص الـ <b>Leaf</b>. كل صفحة فوق فيها مئات المفاتيح، وكل مفتاح بيشاور على صفحة في المستوى اللي تحته.</p>
        <p><b>Index Seek</b> يعني ننزل من الـ root للـ leaf ونقرا صفحة واحدة في كل مستوى. <b>Table Scan</b> (أو Clustered Index Scan) يعني نقرا كل الصفحات ونفحص كل صف. الوحدة اللي بنقيس بيها هي <b>Logical Reads</b>: عدد الصفحات اللي اتقرت من الـ buffer pool.</p>`,
      real: `
        <p>10,000 عربية × نقطة كل 10 ثواني = 86 مليون صف في اليوم. بعد أسبوعين الجدول فيه أكتر من مليار صف. الـ Seek على <code>Id</code> بيقرا 4 صفحات بس، والـ Scan بيقرا 25 مليون صفحة (حوالي 190 GB). عشان كل مستوى بيضرب العدد في حوالي 470، الشجرة بتطول ببطء شديد: من 10 آلاف صف لمليار صف العمق بيزيد من 2 لـ 4 بس.</p>`,
      try: 'حرّك حجم الجدول من 10K لـ 1B وراقب عمق الشجرة وعدد قراءات الـ Seek: بيزيدوا بالكاد، والـ Scan بيتضرب في 100 ألف. بعدين اختار «يوم كامل»: الـ Seek بيقرا حوالي 217 صفحة متجاورة، بس برضه أرخص بكتير من الـ Scan.',
      also: 'البحث عن عملية دفع بالـ <code>TransactionId</code>، أو رسالة بالـ <code>MessageId</code>، أو شحنة برقم التتبع: كلها Seek على B-tree.',
      net: `
<pre><span class="c">-- شوف عدد الصفحات اللي اتقرت فعلًا</span>
SET STATISTICS IO ON;
SELECT * FROM GpsPoints WHERE Id = 734221;
<span class="c">-- Table 'GpsPoints'. Scan count 0, logical reads 4</span>

<span class="c">-- عمق الشجرة وعدد الصفحات في كل مستوى</span>
SELECT index_level, page_count, record_count
FROM sys.dm_db_index_physical_stats(DB_ID(),
  OBJECT_ID('GpsPoints'), 1, NULL, 'DETAILED');</pre>
<pre><span class="c">// EF Core: نفس الـ Seek</span>
var p = await db.GpsPoints.FindAsync(734221L);</pre>`,
      deep: [
        '<b>الـ fanout بيعتمد على حجم الـ key:</b> هنا الـ key <code>BIGINT</code> (8 bytes) فكل صفحة non-leaf فيها حوالي 470 مدخل. لو الـ key طويل (<code>NVARCHAR(200)</code> أو composite كبير) الـ fanout بيقل والشجرة بتطول. وكل non-clustered index بيشيل الـ clustered key جوّاه، فحجم الـ clustered key بيأثر على كل الـ indexes.',
        '<b>Logical vs Physical reads:</b> الـ Seek بيقرا 3-4 صفحات، والصفحات العليا (الـ root والـ intermediate) غالبًا موجودة في الذاكرة طول الوقت. الـ Scan الكبير بيطرد صفحات تانية مفيدة من الـ buffer pool، فبيبطّأ استعلامات تانية كمان.',
        '<b>Seek مش دايمًا أسرع:</b> لو هترجع جزء كبير من الجدول، القراية المتسلسلة (Scan) ممكن تبقى أرخص من آلاف القرايات العشوائية. ده الـ tipping point في تجربة <a href="#/databases/execution-plan">Execution Plan</a>.',
        '<b>الـ range:</b> بعد ما الـ Seek يوصل لأول صف، الـ leaf pages مربوطة ببعض (doubly linked list)، فبيكمّل يقرا الصفحات اللي جنبها من غير ما يطلع فوق تاني. عشان كده «يوم كامل لعربية» رخيص لو الـ index على <code>(VehicleId, Ts)</code>.',
        '<b>تبسيطات:</b> الشجرة هنا متملية 100% (زي بعد REBUILD). في الحقيقة، مع page splits، الامتلاء أقل وعدد الصفحات أكتر (شوف <a href="#/databases/pages">تجربة الصفحات</a>). عمق الشجرة نادرًا ما بيتأثر بده.'
      ]
    })
  });
})();
