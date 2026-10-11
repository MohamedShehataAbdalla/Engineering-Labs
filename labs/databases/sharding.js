/* Databases · Partitioning & Sharding (Hot Shard, Consistent Hashing)
   2,000 vehicles owned by 40 customers with a realistic skew (one big fleet ≈ 30%). Every vehicle reports at the same
   rate; each write is routed by the chosen shard key and routing scheme. Load per shard and the share of keys that
   move when the shard count changes are computed over the whole population (mod-N vs a ring with 64 vnodes/shard). */
(function () {
  "use strict";
  const { clamp, lerp, ease, fmt, f1, Meter, spawnLoop } = Lab.util;
  const { box, tx, dot, circ, line, alpha } = Lab.draw;

  const VEH = 2000, CUST = 40, VNODES = 64;

  /** 32-bit integer hash (murmur3 finalizer) */
  function h32(x) { x = (x ^ (x >>> 16)) >>> 0; x = Math.imul(x, 0x85ebca6b) >>> 0; x = (x ^ (x >>> 13)) >>> 0; x = Math.imul(x, 0xc2b2ae35) >>> 0; return (x ^ (x >>> 16)) >>> 0; }
  const hs = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h32(h >>> 0); };

  // vehicle → customer with a Zipf-like skew: customer 0 owns ~30% of the fleet
  const OWNER = (() => {
    const w = []; let tot = 0; for (let c = 0; c < CUST; c++) { const x = 1 / Math.pow(c + 1, 1.15); w.push(x); tot += x; }
    const out = []; let c = 0, acc = w[0] / tot * VEH;
    for (let v = 0; v < VEH; v++) { while (v >= acc && c < CUST - 1) { c++; acc += w[c] / tot * VEH; } out.push(c); }
    return out;
  })();

  function makeRing(n) { const r = []; for (let s = 0; s < n; s++) for (let v = 0; v < VNODES; v++) r.push({ pos: hs(`shard-${s}-vn-${v}`), s }); return r.sort((a, b) => a.pos - b.pos); }
  function ringLookup(ring, h) { let lo = 0, hi = ring.length; while (lo < hi) { const m = (lo + hi) >> 1; if (ring[m].pos < h) lo = m + 1; else hi = m; } return ring[lo % ring.length].s; }

  function router(p, n) {
    const ring = makeRing(n);
    const keyOf = v => p.key === 'vehicle' ? h32(v + 1) : h32(1000003 + OWNER[v]);
    return v => {
      if (p.key === 'month') return n - 1;              // range by month: every new point lands in the newest partition
      const h = keyOf(v);
      return p.route === 'ring' ? ringLookup(ring, h) : h % n;
    };
  }

  Lab.registerSim('sharding', {
    height: 340, warm: 3,
    init(s) {
      const n = s.p.shards;
      s.st = { n, route: router(s.p, n), ring: makeRing(n), next: 0, load: Array.from({ length: n }, () => new Meter(4)), dots: [], moved: null, movedAt: -9 };
      this.share(s);
    },
    onParam(s, k) {
      if (k === 'shards') this.reshard(s, s.p.shards);
      else { this.init(s); }
    },

    /** exact share of the population per shard (what the bars converge to) */
    share(s) {
      const st = s.st, c = new Array(st.n).fill(0);
      for (let v = 0; v < VEH; v++) c[st.route(v)]++;
      st.share = c.map(x => x / VEH);
    },

    reshard(s, n) {
      const st = s.st, old = st.route, nw = router(s.p, n);
      let moved = 0;
      if (s.p.key !== 'month') for (let v = 0; v < VEH; v++) if (old(v) !== nw(v)) moved++;
      st.moved = { from: st.n, to: n, pct: moved / VEH * 100 }; st.movedAt = s.t;
      st.n = n; st.route = nw; st.ring = makeRing(n);
      st.load = Array.from({ length: n }, () => new Meter(4));
      st.dots = [];
      this.share(s);
    },

    step(s) {
      const st = s.st, t = s.t;
      spawnLoop(st, t, 40, s.rng, () => {
        const v = Math.floor(s.rng() * VEH), sh = st.route(v);
        st.load[sh].add(t);
        if (st.dots.length < 60) st.dots.push({ t0: t, sh, v });
      });
      st.dots = st.dots.filter(d => t - d.t0 < 0.8);
    },

    draw(s) {
      const st = s.st, p = s.p, C = s.C, n = s.narrow, W = s.w, H = s.h, t = s.t;
      const COL = i => [C.a2, C.violet, C.accent, C.good][i % 4];
      const leftW = n ? 0 : W * 0.38;
      // left: the routing picture
      if (!n) {
        const cx = leftW / 2 + 10, cy = H / 2 - 6, R = Math.min(leftW / 2 - 30, H / 2 - 40);
        if (p.key === 'month') {
          tx('Range partitioning by month', cx, 24, { m: 1, s: 11, w: 700 });
          for (let i = 0; i < st.n; i++) { const y = 50 + i * ((H - 90) / st.n); box(cx - 80, y, 160, (H - 90) / st.n - 8, { r: 6, stroke: i === st.n - 1 ? C.bad : C.line, lw: i === st.n - 1 ? 2 : 1 }); tx(i === st.n - 1 ? `P${i + 1} · current month` : `P${i + 1} · month -${st.n - 1 - i}`, cx, y + ((H - 90) / st.n - 8) / 2, { m: 1, s: 10, c: i === st.n - 1 ? C.bad : C.muted }); }
          tx('كل الكتابة الجديدة في الشهر الحالي', cx, H - 20, { s: 10, c: C.bad });
        } else if (p.route === 'ring') {
          tx('Consistent hashing ring', cx, 18, { m: 1, s: 11, w: 700 });
          circ(cx, cy, R, C.line, 2);
          for (const vn of st.ring) { const a = vn.pos / 4294967296 * Math.PI * 2 - Math.PI / 2; line(cx + Math.cos(a) * (R - 5), cy + Math.sin(a) * (R - 5), cx + Math.cos(a) * (R + 5), cy + Math.sin(a) * (R + 5), COL(vn.s), 2); }
          for (const d of st.dots) { const h = p.key === 'vehicle' ? h32(d.v + 1) : h32(1000003 + OWNER[d.v]); const a = h / 4294967296 * Math.PI * 2 - Math.PI / 2; alpha(1 - (t - d.t0) / 0.8, () => dot(cx + Math.cos(a) * R * 0.8, cy + Math.sin(a) * R * 0.8, 3, COL(d.sh))); }
          tx(`${VNODES} vnodes / shard`, cx, cy, { m: 1, s: 10, c: C.muted });
        } else {
          tx('hash(key) % N', cx, cy - 10, { m: 1, s: 16, w: 700 });
          tx(`N = ${st.n}`, cx, cy + 14, { m: 1, s: 12, c: C.muted });
        }
      }
      // right: shard bars (writes/s now) with the expected share marker
      const bx0 = leftW + 20, bx1 = W - 14, top = 40, bh = H - 100;
      const bw = Math.min(70, (bx1 - bx0) / st.n - 10);
      const rates = st.load.map(m => m.rate(t)), max = Math.max(1, ...rates), avg = 40 / st.n;
      const hot = rates.indexOf(Math.max(...rates));
      tx(`writes/s per shard (avg ${f1(avg)})`, bx0, 18, { m: 1, s: 10, c: C.muted, a: 'left' });
      const scale = v => bh * clamp(v / Math.max(avg * 2.2, max), 0, 1);
      line(bx0, top + bh - scale(avg), bx1, top + bh - scale(avg), C.ink, 1, [4, 4]);
      for (let i = 0; i < st.n; i++) {
        const x = bx0 + i * ((bx1 - bx0) / st.n) + 5, hgt = scale(rates[i]);
        const isHot = rates[i] > avg * 1.6;
        box(x, top, bw, bh, { r: 6, fill: C.surface });
        box(x, top + bh - hgt, bw, hgt, { r: 4, fill: isHot ? C.bad : COL(i), stroke: null });
        tx('S' + (i + 1), x + bw / 2, top + bh + 14, { m: 1, s: 11, w: 700, c: isHot ? C.bad : C.ink });
        tx(Math.round(st.share[i] * 100) + '%', x + bw / 2, top + bh + 30, { m: 1, s: 10, c: C.muted });
        if (isHot && i === hot) tx('HOT', x + bw / 2, top + bh - hgt - 10, { m: 1, s: 10, w: 700, c: C.bad });
      }
      for (const d of st.dots) {
        const k = clamp((t - d.t0) / 0.8, 0, 1), x = bx0 + d.sh * ((bx1 - bx0) / st.n) + 5 + bw / 2;
        dot(lerp((bx0 + bx1) / 2, x, ease(k)), lerp(H - 4, top + 6, ease(k)), 2.6, C.accent);
      }
      if (st.moved && t - st.movedAt < 3) alpha(1 - (t - st.movedAt) / 3, () => {
        box(W / 2 - 130, H / 2 - 20, 260, 40, { r: 8, fill: C.surface, stroke: st.moved.pct > 40 ? C.bad : C.good, lw: 2 });
        tx(`${st.moved.from} → ${st.moved.to} shards: ${f1(st.moved.pct)}% of keys moved`, W / 2, H / 2, { m: 1, s: 11, w: 700, c: st.moved.pct > 40 ? C.bad : C.good });
      });
    },

    stats(s) {
      const st = s.st, p = s.p, maxShare = Math.max(...st.share), hotF = maxShare * st.n;
      const ideal = p.route === 'mod' ? (1 - 1 / (st.n + 1)) * 100 : 100 / (st.n + 1);
      return [
        ['أكبر shard من الحمل', Math.round(maxShare * 100) + '%', hotF > 1.6 ? 'bad' : hotF > 1.25 ? 'warn' : 'good'],
        ['Hot factor (أكبر ÷ متوسط)', '× ' + f1(hotF), hotF > 1.6 ? 'bad' : hotF > 1.25 ? 'warn' : 'good'],
        ['أكبر عميل من الأسطول', Math.round(OWNER.filter(c => c === 0).length / VEH * 100) + '%'],
        ['آخر resharding: keys اتنقلت', st.moved ? f1(st.moved.pct) + '%' : '—', st.moved ? (st.moved.pct > 40 ? 'bad' : 'good') : ''],
        [p.key === 'month' ? 'إضافة partition' : `المتوقع عند ${st.n} → ${st.n + 1}`, p.key === 'month' ? 'مفيش نقل' : '≈ ' + f1(ideal) + '%']
      ];
    },

    act: { add(s) { if (s.st.n < 12) s.def.reshard(s, s.st.n + 1); } }
  });

  Lab.registerLesson({
    id: 'sharding', lab: 'databases', title: 'Partitioning و Sharding',
    html: Lab.tpl.lesson({
      sim: 'sharding', level: 3,
      terms: ['Partitioning', 'Sharding', 'Shard Key', 'Hot Shard', 'Consistent Hashing'],
      lede: 'نقط GPS من 2,000 عربية بتتوزع على كذا داتابيز (shards). الأعمدة هي الكتابة في الثانية على كل shard، والخط المتقطع هو المتوسط. الـ shard key وطريقة التوزيع بيحددوا مين بيشيل أكتر. «+ shard» بيقيس كام عربية لازم تتنقل.',
      aria: 'محاكاة sharding مع hot shard و consistent hashing',
      acts: [['add', '+ shard']],
      controls: [
        { type: 'seg', p: 'key', label: 'الـ Shard key', value: 'vehicle', opts: [['vehicle', 'VehicleId'], ['customer', 'CustomerId'], ['month', 'Range بالشهر']] },
        { type: 'seg', p: 'route', label: 'طريقة التوزيع', value: 'mod', opts: [['mod', 'hash % N'], ['ring', 'Consistent hashing']] },
        { type: 'range', p: 'shards', label: 'عدد الـ shards', min: 2, max: 8, step: 1, value: 4 }
      ],
      idea: `
        <p><b>Partitioning</b> إنك تقسم جدول كبير لأجزاء جوه نفس السيرفر (مثلًا partition لكل شهر)، فالاستعلام اللي بيدور على شهر يقرا الجزء ده بس، وتقدر تمسح شهر قديم كامل في ثانية. <b>Sharding</b> إنك توزّع الداتا على كذا سيرفر، كل واحد شايل جزء. ده بيكبّر قدرة الكتابة والتخزين بعدد السيرفرات.</p>
        <p>كل حاجة بتعتمد على الـ <b>Shard key</b>. لو مش متوزّع كويس، shard واحد بيشيل أغلب الحمل، وده الـ <b>Hot Shard</b>. ولما تضيف shard، الـ <code>hash % N</code> بيغيّر مكان أغلب المفاتيح. الـ <b>Consistent Hashing</b> بيحط الـ shards على دايرة، فإضافة shard بتنقل حوالي <code>1/(N+1)</code> بس من المفاتيح.</p>`,
      real: `
        <p>شركة تتبع عندها عميل كبير (شركة نقل بـ 600 عربية) و 39 عميل صغير. لو الـ shard key هو <code>CustomerId</code> عشان استعلامات العميل تبقى على shard واحد، الـ shard اللي عليه الشركة الكبيرة بيشيل 30% من الكتابة لوحده. ولو الـ key هو الشهر، كل الـ 1,000 insert في الثانية بتروح لنفس الـ partition. ده كويس للأرشفة والحذف، بس مش بيوزّع الكتابة.</p>`,
      try: 'ابدأ بـ VehicleId: الحمل متوزّع. غيّر لـ CustomerId: شوف الـ HOT. غيّر لـ «Range بالشهر»: shard واحد بياخد كل حاجة. ارجع لـ VehicleId واضغط «+ shard» مع hash % N: حوالي 80% من العربيات اتنقلت. اضغط إعادة، حوّل لـ Consistent hashing، واضغط «+ shard» تاني.',
      also: 'تقسيم المستخدمين في الشات حسب UserId، والحسابات في البنوك، والـ game servers حسب المنطقة. والمشكلة نفسها: مشهور واحد أو بطولة واحدة بتعمل hot shard.',
      net: `
<pre><span class="c">-- Partitioning في SQL Server: partition لكل شهر</span>
CREATE PARTITION FUNCTION pfMonth (datetime2)
  AS RANGE RIGHT FOR VALUES ('2026-08-01', '2026-09-01', '2026-10-01');
CREATE PARTITION SCHEME psMonth
  AS PARTITION pfMonth ALL TO ([PRIMARY]);
CREATE TABLE GpsPoints (..., Ts datetime2 NOT NULL)
  ON psMonth (Ts);

<span class="c">-- مسح شهر كامل في لحظة</span>
TRUNCATE TABLE GpsPoints WITH (PARTITIONS (1));</pre>
<pre><span class="c">// Sharding في التطبيق: اختار الـ connection حسب الـ key</span>
string ShardFor(int vehicleId) =&gt;
    _ring.GetNode(vehicleId.ToString());   <span class="c">// consistent hashing</span>
await using var db = _factory.Create(ShardFor(msg.VehicleId));</pre>`,
      deep: [
        '<b>Partitioning مش Sharding:</b> الـ partitioning في SQL Server بيفضل على نفس السيرفر ونفس الـ CPU والـ disk. بيفيد في الـ maintenance (حذف وأرشفة بالشهر) وفي الـ partition elimination، لكنه مش بيزوّد قدرة الكتابة. الـ sharding هو اللي بيوزّع الحمل على أجهزة.',
        '<b>تمن الـ sharding:</b> أي استعلام مش فيه الـ shard key لازم يروح لكل الـ shards (scatter-gather)، والـ JOINs والـ transactions بين shards بقت مشكلة التطبيق، والـ unique constraints عبر الـ shards صعبة. عشان كده اختار الـ key حسب أكتر استعلام مهم.',
        '<b>الـ vnodes:</b> من غيرها، كل shard بياخد قوس واحد عشوائي على الدايرة والتوزيع بيبقى غير متساوي. مع 64 أو أكتر لكل shard التوزيع بيقرب من المتساوي. ده اللي في Cassandra و DynamoDB.',
        '<b>حلول الـ hot key:</b> تقسيم العميل الكبير لوحده (dedicated shard)، أو key مركّب زي <code>(CustomerId, VehicleId % 8)</code> عشان العميل الكبير يتوزع على 8 أماكن، على حساب إن استعلاماته بقت بتلف على أكتر من مكان.',
        '<b>الأرقام هنا:</b> 2,000 عربية بنفس معدل الإرسال، وتوزيع العملاء Zipf (أكبر عميل حوالي 30%). نسبة المفاتيح اللي بتتنقل محسوبة فعلًا على كل العربيات: mod N بينقل حوالي <code>N/(N+1)</code>، والـ ring بينقل حوالي <code>1/(N+1)</code>.'
      ]
    })
  });
})();
