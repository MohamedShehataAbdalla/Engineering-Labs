/* System Design · Caching (Hit / Miss / TTL / LRU)
   Dashboards read vehicle details (1,000 vehicles) at 300 requests/s. Cache-aside in front of the database:
     hit   → answer from the cache (~1 ms)
     miss  → query the database, then store the answer with a TTL; the cache evicts the least recently used
             entry when it is full (a real LRU over a Map)
   The database gets slower with more concurrent queries (30 ms × (1 + in-flight/20)). Vehicles' data also changes
   (2 updates/s); unless writes invalidate the cache, readers can get a stale value until the TTL expires.
   Popularity can be uniform or Zipf-like (a few vehicles everyone watches). "Single-flight" lets concurrent misses
   for the same key wait for one database query instead of each sending their own (no stampede).
   Hit ratio, latency, database load and stale reads are measured from the run. */
(function () {
  "use strict";
  const { clamp, lerp, fmt, f1, expo } = Lab.util;
  const { box, tx, dot, line, alpha } = Lab.draw;

  const KEYS = 1000, RATE = 300, UPD = 2, HIT = 0.001, DB = 0.03, WIN = 5;

  function zipfCdf(sk) { const w = []; let sum = 0; for (let i = 1; i <= KEYS; i++) { sum += 1 / Math.pow(i, sk); w.push(sum); } return w.map(x => x / sum); }
  const CDF = { zipf: zipfCdf(1.1), uniform: null };
  function key(s) { const r = s.rng(); if (s.p.pop === 'uniform') return Math.floor(r * KEYS); const c = CDF.zipf; let lo = 0, hi = KEYS - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (c[m] < r) lo = m + 1; else hi = m; } return lo; }

  function fresh(s) {
    s.st = { now: 0, next: 0, nextUpd: 0, cache: new Map(), ver: new Int32Array(KEYS), inflight: new Map(), dbq: [], log: [], hot: [], stampede: 0 };
  }

  Lab.registerSim('cache', {
    height: 360, warm: 6,
    init(s) { fresh(s); },
    onParam(s, k) { if (k === 'size') { const c = s.st.cache; while (c.size > s.p.size) c.delete(c.keys().next().value); } if (k === 'pop') fresh(s);
      if (k === 'ttl') for (const e of s.st.cache.values()) e.exp = Math.min(e.exp, s.st.now + s.p.ttl);   // a new TTL applies to what is cached now
      s.st.log = []; s.st.stampede = 0; },

    step(s, dt) {
      const st = s.st, end = st.now + dt;
      while (st.now < end) {
        const t = st.now = Math.min(end, st.now + 0.002);
        // finished database queries fill the cache and answer everyone waiting on them
        st.dbq = st.dbq.filter(q => {
          if (q.end > t) return true;
          this.put(s, q.k, q.v, t);
          for (const w of q.waiters) st.log.push({ t, lat: t - w, hit: false, stale: false });
          st.inflight.delete(q.k);
          return false;
        });
        while (st.nextUpd <= t) {
          const k = Math.floor(s.rng() * KEYS); st.ver[k]++;                // any vehicle can change, popular or not
          if (s.p.inval) st.cache.delete(k);
          st.nextUpd += expo(UPD, s.rng);
        }
        while (st.next <= t) {
          const k = key(s), e = st.cache.get(k);
          if (e && e.exp > t) {
            st.cache.delete(k); st.cache.set(k, e);                      // LRU: move to most recent
            st.log.push({ t, lat: HIT, hit: true, stale: e.v !== st.ver[k] });
          } else {
            if (e) st.cache.delete(k);
            const q = st.inflight.get(k);
            if (q && s.p.single) q.waiters.push(st.next);                // join the query already running
            else {
              if (q) st.stampede++;
              const lat = DB * (1 + st.dbq.length / 20) * (0.7 + s.rng() * 0.6);
              const nq = { k, v: st.ver[k], end: t + lat, waiters: [st.next] };
              st.dbq.push(nq); if (!q) st.inflight.set(k, nq);
            }
          }
          st.next += expo(RATE, s.rng);
        }
      }
      st.log = st.log.filter(x => x.t > st.now - WIN);
      if ((st.hotT || 0) < st.now - 0.25) { st.hotT = st.now; st.hot.push([st.now, this.m(s).hit]); if (st.hot.length > 120) st.hot.shift(); }
    },

    put(s, k, v, t) {
      const c = s.st.cache; if (s.p.size <= 0) return;
      c.delete(k); c.set(k, { v, exp: t + s.p.ttl });
      while (c.size > s.p.size) c.delete(c.keys().next().value);       // evict least recently used
    },

    m(s) {
      const L = s.st.log, hits = L.filter(x => x.hit).length, lats = L.map(x => x.lat).sort((a, b) => a - b);
      return { hit: L.length ? hits / L.length : 0, avg: lats.length ? lats.reduce((a, b) => a + b, 0) / lats.length : 0,
        p99: lats.length ? lats[Math.floor(lats.length * 0.99)] : 0, db: (L.length - hits) / WIN, stale: hits ? L.filter(x => x.stale).length / L.length : 0 };
    },

    draw(s) {
      const C = s.C, st = s.st, W = s.w, H = s.h, n = s.narrow, m = this.m(s), now = st.now;
      // cache entries as a heat strip (one cell per vehicle; filled = cached, faded as TTL runs out)
      const x0 = 14, x1 = W - 14, cols = n ? 40 : 50, cell = (x1 - x0) / cols, rows = KEYS / cols;
      tx(`cache: ${st.cache.size} / ${s.p.size} entries · TTL ${s.p.ttl} s · one cell per vehicle (most popular first)`, x0, 14, { m: 1, s: n ? 8.5 : 10.5, w: 700, a: 'left', c: C.muted });
      const ch = Math.min(cell, 150 / rows);
      for (let k = 0; k < KEYS; k++) {
        const e = st.cache.get(k), x = x0 + (k % cols) * cell, y = 26 + Math.floor(k / cols) * ch;
        if (!e) { box(x + 0.5, y + 0.5, cell - 1, ch - 1, { r: 0, fill: C.bg, stroke: null }); continue; }
        const life = clamp((e.exp - now) / s.p.ttl, 0, 1), stale = e.v !== st.ver[k];
        alpha(0.35 + life * 0.65, () => box(x + 0.5, y + 0.5, cell - 1, ch - 1, { r: 0, fill: stale ? C.bad : C.a2, stroke: null }));
      }
      // database
      const dy = 26 + rows * ch + 16, dbl = st.dbq.length;
      box(x0, dy, x1 - x0, 26, { r: 6, fill: C.surface, stroke: dbl > 20 ? C.bad : C.line });
      box(x0, dy, (x1 - x0) * clamp(dbl / 60, 0, 1), 26, { r: 6, fill: dbl > 20 ? C.bad : C.violet, stroke: null });
      tx(`database: ${dbl} queries in flight · ${fmt(m.db)} queries/s · each ~${fmt(DB * (1 + dbl / 20) * 1000)} ms`, x0 + 8, dy + 13, { m: 1, s: n ? 8.5 : 10, w: 700, a: 'left', c: C.ink });
      // hit ratio over time
      const gy = dy + 40, gh = H - gy - 30, g = st.hot;
      box(x0, gy, x1 - x0, gh, { r: 6, fill: C.surface, stroke: C.line });
      const X = s.ctx; X.beginPath();
      g.forEach((p, i) => { const x = lerp(x0 + 4, x1 - 4, i / 119), y = lerp(gy + gh - 4, gy + 6, p[1]); if (i) X.lineTo(x, y); else X.moveTo(x, y); });
      X.strokeStyle = C.good; X.lineWidth = 1.8; X.stroke();
      tx('hit ratio (last 30 s)', x0 + 8, gy + 12, { m: 1, s: 9, a: 'left', c: C.good });
      tx(`hit ${f1(m.hit * 100)}% · avg ${f1(m.avg * 1000)} ms · p99 ${fmt(m.p99 * 1000)} ms · stale ${f1(m.stale * 100)}%`, x0, H - 12, { m: 1, s: n ? 8.5 : 11, w: 700, a: 'left', c: m.hit > 0.9 ? C.good : m.hit > 0.6 ? C.accent : C.bad });
    },

    stats(s) {
      const m = this.m(s), st = s.st;
      return [
        ['Hit ratio', f1(m.hit * 100) + ' %', m.hit > 0.9 ? 'good' : m.hit > 0.6 ? 'warn' : 'bad'],
        ['Latency متوسط / p99', `${f1(m.avg * 1000)} / ${fmt(m.p99 * 1000)} ms`, m.p99 > 0.1 ? 'bad' : ''],
        ['Queries على الـ DB في الثانية', fmt(m.db), m.db > 150 ? 'bad' : m.db > 50 ? 'warn' : 'good'],
        ['قرايات قديمة (stale)', f1(m.stale * 100) + ' %', m.stale > 0.02 ? 'bad' : m.stale ? 'warn' : 'good'],
        ['Queries مكررة لنفس الـ key (stampede)', fmt(st.stampede), st.stampede ? 'warn' : '']
      ];
    }
  });

  Lab.registerLesson({
    id: 'cache', lab: 'system-design', title: 'Caching',
    html: Lab.tpl.lesson({
      sim: 'cache', level: 2,
      terms: ['Cache-aside', 'Hit / Miss', 'TTL', 'LRU', 'Stampede'],
      lede: '300 request في الثانية على بيانات 1,000 عربية. كل خانة عربية: التركواز موجودة في الـ cache (بتبهت لما الـ TTL يقرب يخلص)، والأحمر في الـ cache بس الداتا اتغيرت في الـ DB (stale). تحت: الـ DB وحِمله، ونسبة الـ hits مع الوقت.',
      aria: 'محاكاة cache-aside بـ LRU و TTL قدام قاعدة بيانات',
      controls: [
        { type: 'range', p: 'size', label: 'حجم الـ cache', min: 0, max: 1000, step: 25, value: 200, unit: 'entries' },
        { type: 'range', p: 'ttl', label: 'TTL', min: 1, max: 120, step: 1, value: 30, unit: 's' },
        { type: 'seg', p: 'pop', label: 'الطلب على العربيات', value: 'zipf', opts: [['zipf', 'شوية عربيات الكل بيتابعها'], ['uniform', 'بالتساوي']] },
        { type: 'seg', p: 'inval', label: 'الـ write بيمسح من الـ cache', value: 'false', opts: [['false', 'لأ (TTL بس)'], ['true', 'آه']] },
        { type: 'seg', p: 'single', label: 'Single-flight', value: 'false', opts: [['false', 'لأ'], ['true', 'آه']] }
      ],
      idea: `
        <p><b>Cache-aside</b>: دوّر في الـ cache الأول؛ لو لقيت (<b>hit</b>) رد على طول، لو لأ (<b>miss</b>) هات من الـ DB وخزّن نسخة. الـ <b>TTL</b> بيحدد النسخة تفضل قد إيه، والـ <b>LRU</b> بيقرر مين يتشال لما الـ cache يتملي: اللي بقاله أطول وقت محدش طلبه.</p>
        <p>الـ cache بيشتغل كويس لما الطلب مش متساوي (شوية keys عليهم أغلب الطلب). وتمنه حاجتين: الداتا ممكن تبقى <b>قديمة</b> لحد ما الـ TTL يخلص، ولما key عليه طلب كتير ينتهي، مئات requests بتروح الـ DB في نفس اللحظة (<b>Stampede</b>).</p>`,
      real: `
        <p>صفحة تفاصيل العربية بتعمل query فيها joins لـ 50 ms. 300 مرة في الثانية = الـ DB مشغول على الآخر. أغلب الطلب على شوية عربيات بيتابعهم الـ dispatchers طول الوقت، فـ cache صغير بـ 200 entry بيشيل حوالي 3 أرباع الحمل. المشكلة: لما حالة العربية تتغير (اتقفلت، غيرت سواق)، الـ dashboard بيفضل يعرض القديم لحد 30 ثانية لو مفيش invalidation.</p>`,
      try: 'سيبها على الإعدادات دي: cache بـ 200 entry بس (20% من العربيات) بيرد على حوالي 75% من الطلب. اختار «بالتساوي»: نفس الـ cache بقى hit حوالي 20% والـ DB غرقان. ارجع لـ zipf وطوّل الـ TTL لـ 120: «stale» بتظهر (الداتا اتغيرت والـ cache لسه شايل القديم)، وشغّل «الـ write بيمسح»: بتقل جدًا، واللي فاضل هو الـ race اللي في «أعمق». وصغّر الـ TTL لـ 2: queries مكررة لنفس الـ key بتظهر (stampede)، وsingle-flight بيخليها صفر.',
      also: 'أسعار المنتجات في e-commerce، وprofile المستخدم في الشات، والـ leaderboard في لعبة، وأي API بيكلّم خدمة بطيئة. وقاعدة البيانات نفسها عندها cache (buffer pool) بنفس الفكرة.',
      net: `
<pre><span class="c">// .NET 9: HybridCache = memory + distributed (Redis) + single-flight جاهز</span>
builder.Services.AddHybridCache(o =&gt; o.DefaultEntryOptions = new() { Expiration = TimeSpan.FromSeconds(30) });

public async Task&lt;VehicleDto&gt; Get(long id, CancellationToken ct) =&gt;
    await cache.GetOrCreateAsync($"vehicle:{id}",
        async c =&gt; await db.Vehicles.Where(v =&gt; v.Id == id).Select(ToDto).FirstAsync(c), cancellationToken: ct);

<span class="c">// الـ write يمسح النسخة القديمة (invalidation)</span>
await db.SaveChangesAsync(ct);
await cache.RemoveAsync($"vehicle:{id}", ct);</pre>`,
      netTitle: 'في .NET',
      deep: [
        '<b>Stampede بالتفصيل:</b> key عليه 100 طلب في الثانية والـ query 50 ms: لما ينتهي، 5 requests على الأقل بيلاقوا miss قبل ما الأولاني يخلص، وكل واحد بيبعت query. على keys أسخن أو DB أبطأ ممكن يبقوا مئات. الحلول: single-flight (طلب واحد والباقي يستنى)، أو تجديد قبل الانتهاء في الخلفية، أو TTL عشوائي شوية عشان مش كل حاجة تنتهي مع بعض.',
        '<b>Invalidation صعبة:</b> «امسح بعد الـ write» فيها race: reader قرا القيمة القديمة من الـ DB قبل الـ write وخزّنها بعد المسح. الـ TTL بيفضل شبكة أمان حتى مع الـ invalidation.',
        '<b>Local vs distributed:</b> cache في ذاكرة كل instance سريع جدًا بس كل instance عنده نسخة ممكن تختلف، والـ invalidation لازم توصل للكل. Redis مشترك وثابت بس كل hit فيه network hop (حوالي ملي ثانية). HybridCache بيجمع الاتنين.',
        '<b>الـ cache مش بيصلح query بطيئة على الـ miss:</b> الـ p99 بيفضل وقت الـ miss. ولو الـ cache وقع (Redis restart)، كل الحمل بيرجع للـ DB مرة واحدة (cold start). الـ DB لازم تستحمل ده ولو لفترة قصيرة.',
        '<b>تبسيطات:</b> 1,000 key بس، وتوزيع Zipf بـ s = 1.1، والـ DB نموذج latency بسيط بيزيد مع عدد الـ queries، و hit = 1 ms ثابت.'
      ]
    })
  });
})();
