/* System Design · Capstone: صمّم نظام تتبع لـ 100 ألف عربية
   Pick a design; the diagram, the load on each tier and a requirements check are computed from these stated,
   order-of-magnitude assumptions (illustrative, not vendor numbers):
     ingest server      40K msgs/s over persistent TCP or UDP, 8K/s over HTTP (a request per point)
     DB write capacity  per node: rowstore single-row inserts 6K/s · rowstore batched (behind a queue) 40K/s ·
                        columnstore + partitions, batched 150K/s · time-series DB 250K/s
     storage            100 B per point; rowstore ×1.5 (indexes), columnstore ×0.15, time-series ×0.1 (compression)
     live map           read from the DB ~60 ms per query; from a Redis "last position" cache ~2 ms
     dashboards         2,000 users; polling every 5 s or WebSocket push
     availability       one region ~99.9% (~99.95% with a queue absorbing DB blips), two regions ~99.98%
     SQL Server         one write primary: more write nodes means sharding, so it stays 1 here
     monthly cost       ingest $150/server, DB node $900 (rowstore) / $1,200 (columnstore) / $1,000 (TSDB),
                        queue $400, Redis $300, storage $25/TB-month, second region ×1.9
   Peak = 2.5 × average. A tier is "hot" above 70% of its capacity at peak. */
(function () {
  "use strict";
  const { clamp, lerp, fmt, f1 } = Lab.util;
  const { box, tx, dot, line, alpha } = Lab.draw;

  const VEH = 100000, PEAK = 2.5, USERS = 2000;
  const DB = { row: { cap: 6000, capQ: 40000, size: 1.5, cost: 900, name: 'SQL rowstore' }, col: { cap: 20000, capQ: 150000, size: 0.15, cost: 1200, name: 'SQL columnstore' }, ts: { cap: 60000, capQ: 250000, size: 0.1, cost: 1000, name: 'Time-series DB' } };

  function evaluate(p) {
    const w = VEH / p.every, peak = w * PEAK;
    const ingCap = p.proto === 'http' ? 8000 : 40000;
    const ingest = Math.ceil(peak / (ingCap * 0.7)) + 1;
    const d = DB[p.db], cap = p.queue ? d.capQ : d.cap;
    // SQL Server has one write primary (scaling writes out means sharding); a time-series cluster scales out
    const dbNodes = p.db === 'ts' ? Math.max(1, Math.ceil(peak / (cap * 0.7))) : 1;
    const dbLoad = peak / (cap * dbNodes);
    const tbMonth = w * 86400 * 30 * 100 * d.size / 1e12;
    const retention = 3;                                  // months kept hot
    // live map: reads per second from dashboards
    const reads = p.ws ? USERS * 0.2 : USERS / 5;         // websocket: server-side fan-out reads ~0.2/s per user
    const readMs = p.cache ? 2 : 60;
    const dbReadLoad = p.cache ? 0 : reads * 0.06 / (dbNodes * 8);   // 8 concurrent queries per node
    const freshness = p.every / 2 + (p.queue ? 1 : 0.2) + (p.ws ? 0.1 : 2.5) + readMs / 1000;
    const avail = p.regions === 2 ? 0.9998 : p.queue ? 0.9995 : 0.999;   // a queue rides out DB blips and failovers
    let cost = ingest * 150 + dbNodes * d.cost + (p.queue ? 400 : 0) + (p.cache ? 300 : 0) + tbMonth * retention * 25;
    if (p.regions === 2) cost *= 1.9;
    const checks = [
      ['writes at peak', dbLoad <= 0.7, `DB at ${fmt(dbLoad * 100)}% of capacity${p.db !== 'ts' ? ' (one write primary)' : ''}`],
      ['live map freshness ≤ 15 s', freshness <= 15, `~${f1(freshness)} s behind`],
      ['live map read load', dbReadLoad <= 0.5, p.cache ? 'served from Redis' : `DB read load ${fmt(dbReadLoad * 100)}%`],
      ['availability ≥ 99.95%', avail >= 0.9995, `${(avail * 100).toFixed(2)}%`],
      ['survives a DB slowdown', p.queue, p.queue ? 'queue absorbs it' : 'ingest blocks on the DB']
    ];
    return { w, peak, ingest, ingCap, dbNodes, dbLoad, tbMonth, reads, freshness, avail, cost, checks, d, dbReadLoad };
  }

  Lab.registerSim('capstone', {
    height: 420, warm: 0,
    init(s) { s.st = { e: evaluate(s.p) }; },
    onParam(s) { s.st.e = evaluate(s.p); },
    step() {},

    draw(s) {
      const C = s.C, e = s.st.e, p = s.p, W = s.w, H = s.h, n = s.narrow, t = s.t;
      const tiers = [
        ['100K devices', `${fmt(e.w)}/s · peak ${fmt(e.peak)}/s`, C.accent, 0],
        [`ingest × ${e.ingest}`, p.proto === 'http' ? 'HTTP per point' : p.proto === 'udp' ? 'UDP' : 'persistent TCP', C.violet, e.peak / (e.ingest * e.ingCap)]
      ];
      if (p.queue) tiers.push(['queue + batch writer', 'Kafka / RabbitMQ', C.violet, 0.3]);
      tiers.push([`${e.d.name} × ${e.dbNodes}`, `${f1(e.tbMonth)} TB / month`, C.a2, e.dbLoad]);
      if (p.cache) tiers.push(['Redis last position', '~2 ms reads', C.a2, 0.2]);
      tiers.push([`${fmt(USERS)} dashboards`, p.ws ? 'WebSocket push' : 'poll every 5 s', C.good, 0]);
      const cols = tiers.length, cw = (W - 28) / cols, by = 40, bh = 86;
      tiers.forEach(([title, sub, col, load], i) => {
        const x = 14 + i * cw + 4, w = cw - 8, hot = load > 0.7;
        box(x, by, w, bh, { r: 10, fill: C.surface, stroke: hot ? C.bad : col, lw: 2 });
        tx(title, x + w / 2, by + 20, { m: 1, s: n ? 7 : 9.5, w: 700, c: hot ? C.bad : col });
        tx(sub, x + w / 2, by + 40, { m: 1, s: n ? 6.5 : 8.5, c: C.muted });
        if (load) {
          box(x + 8, by + 58, w - 16, 8, { r: 4, fill: C.bg, stroke: null });
          box(x + 8, by + 58, (w - 16) * clamp(load, 0, 1), 8, { r: 4, fill: hot ? C.bad : C.good, stroke: null });
          tx(`${fmt(load * 100)}%`, x + w / 2, by + 78, { m: 1, s: 8.5, c: hot ? C.bad : C.muted });
        }
        if (i) { const k = 3; for (let j = 0; j < k; j++) dot(x - 8 + ((t * 0.8 + j / k) % 1) * 8, by + bh / 2, 2.2, col); }
      });
      if (p.regions === 2) tx('× 2 regions (active / passive, async replication)', W / 2, by + bh + 16, { m: 1, s: n ? 8 : 10, w: 700, c: C.violet });
      // requirements
      const ry = by + bh + 34;
      e.checks.forEach(([label, ok, detail], i) => {
        const y = ry + i * 24;
        tx(ok ? '✓' : '✗', 18, y, { m: 1, s: 12, w: 700, a: 'left', c: ok ? C.good : C.bad });
        tx(label, 36, y, { m: 1, s: n ? 8.5 : 10.5, w: 700, a: 'left', c: C.ink });
        tx(detail, W - 14, y, { m: 1, s: n ? 8 : 10, a: 'right', c: ok ? C.muted : C.bad });
      });
      const passed = e.checks.filter(c => c[1]).length;
      tx(`${passed} / ${e.checks.length} requirements met · ~$${fmt(e.cost)} / month (illustrative)`, 14, H - 14, { m: 1, s: n ? 9 : 12, w: 700, a: 'left', c: passed === e.checks.length ? C.good : passed >= 3 ? C.accent : C.bad });
    },

    stats(s) {
      const e = s.st.e;
      return [
        ['Writes ذروة', fmt(e.peak) + ' /s'],
        ['DB nodes / حمل', `${e.dbNodes} / ${fmt(e.dbLoad * 100)}%`, e.dbLoad > 0.7 ? 'bad' : 'good'],
        ['تخزين في الشهر', f1(e.tbMonth) + ' TB', e.tbMonth > 50 ? 'warn' : ''],
        ['تأخير الخريطة الحية', f1(e.freshness) + ' s', e.freshness > 15 ? 'bad' : e.freshness > 8 ? 'warn' : 'good'],
        ['تكلفة شهرية تقريبية', '$' + fmt(e.cost), e.cost > 30000 ? 'bad' : e.cost > 12000 ? 'warn' : 'good']
      ];
    }
  });

  Lab.registerLesson({
    id: 'capstone', lab: 'system-design', title: 'صمّم نظام تتبع لـ 100 ألف عربية',
    html: Lab.tpl.lesson({
      sim: 'capstone', level: 3,
      terms: ['Trade-offs', 'Capacity', 'Latency', 'Availability', 'Cost'],
      lede: 'التجربة الختامية: 100,000 عربية، و2,000 dispatcher بيتابعوا الخريطة. اختار كل طبقة في التصميم، والرسم بيتبني من اختياراتك، وكل طبقة عليها حملها وقت الذروة (أحمر = فوق 70%). تحت: المتطلبات اتحققت ولا لأ، والتكلفة الشهرية التقريبية.',
      aria: 'مصمم تفاعلي لنظام تتبع مع فحص المتطلبات والتكلفة',
      controls: [
        { type: 'seg', p: 'every', label: 'الجهاز بيبعت كل', value: 10, opts: [[1, '1 s'], [5, '5 s'], [10, '10 s'], [30, '30 s']] },
        { type: 'seg', p: 'proto', label: 'Ingest', value: 'http', opts: [['tcp', 'TCP دايم'], ['udp', 'UDP'], ['http', 'HTTP لكل نقطة']] },
        { type: 'seg', p: 'queue', label: 'Queue + batching', value: 'false', opts: [['false', 'لأ (كتابة مباشرة)'], ['true', 'آه']] },
        { type: 'seg', p: 'db', label: 'التخزين', value: 'row', opts: [['row', 'SQL rowstore'], ['col', 'SQL columnstore'], ['ts', 'Time-series DB']] },
        { type: 'seg', p: 'cache', label: 'آخر مكان لكل عربية', value: 'false', opts: [['false', 'query من الـ DB'], ['true', 'Redis']] },
        { type: 'seg', p: 'ws', label: 'الـ dashboard', value: 'false', opts: [['false', 'Polling كل 5 s'], ['true', 'WebSocket']] },
        { type: 'seg', p: 'regions', label: 'Regions', value: 1, opts: [[1, 'واحدة'], [2, 'اتنين']] }
      ],
      idea: `
        <p>مفيش تصميم «صح»؛ فيه تصميم بيحقق المتطلبات بأقل تكلفة وتعقيد. كل قرار <b>Trade-off</b>: الـ queue بتزوّد <b>Capacity</b> وبتحمي من بطء الـ DB، بس بتزوّد ثانية <b>Latency</b> وطبقة تتراقب. منطقتين بيرفعوا الـ <b>Availability</b> بس <b>Cost</b> تقريبًا الضعف وبيدخّلوك في CAP.</p>
        <p>ابدأ بالأرقام (<a href="#/system-design/estimation">Back-of-the-envelope</a>)، وبعدين ابني أبسط حاجة تعدّي المتطلبات، وكبّر الطبقة اللي بتحمر بس. كل طبقة هنا اتشرحت في تجربة لوحدها في المعامل اللي فاتت.</p>`,
      real: `
        <p>المتطلبات: الخريطة الحية متأخرة أقل من 15 ثانية، ومفيش نقط بتضيع لو الـ DB بطأت ساعة، و99.95% availability، والتكلفة معقولة. التصميم الافتراضي هنا (HTTP لكل نقطة، وكتابة مباشرة في SQL rowstore، والخريطة بتسأل الـ DB) هو اللي فرق كتير بتبدأ بيه، وبيقع عند الحجم ده.</p>`,
      try: 'ابدأ بالإعدادات دي وشوف كام requirement وقع. غيّر الـ ingest لـ TCP دايم: سيرفرات أقل بكتير. شغّل الـ queue: الـ DB بتستحمل وبقى فيه حماية من البطء. شغّل Redis وWebSocket: الخريطة الحية بقت ثواني وحمل القرايات على الـ DB راح. جرّب columnstore أو TSDB: التخزين بيقع 10 مرات. ومنطقتين: الـ availability بيوصل 99.98%، والتكلفة بتتضاعف. وجرّب «كل 1 ثانية»: إيه اللي لازم يتغير؟',
      also: 'نفس التمرين لمنصة توصيل (الطلبات بدل نقط GPS)، أو شات (الرسايل والـ presence)، أو لعبة (state updates لكل لاعب)، أو IoT لعدادات كهربا ذكية: نفس الطبقات بأرقام مختلفة.',
      net: `
<pre><span class="c">// الهيكل اللي غالبًا بتوصله لـ 100K عربية في .NET</span>
<span class="c">// 1) Ingest: Kestrel / TcpListener بـ System.IO.Pipelines، connection دايم لكل جهاز</span>
<span class="c">// 2) Channel&lt;GpsPoint&gt; محدود جوه الـ process → publish batches لـ Kafka/RabbitMQ</span>
<span class="c">// 3) Writer: يقرا batches ويكتب بـ SqlBulkCopy في جدول columnstore متقسم بالأيام</span>
<span class="c">// 4) نفس الـ writer يحدّث Redis: HSET vehicle:{id} lat lng ts  (آخر مكان)</span>
<span class="c">// 5) SignalR hub (+ Redis backplane) يبعت التحديثات للـ dashboards حسب المنطقة</span>
using var bulk = new SqlBulkCopy(conn) { DestinationTableName = "dbo.GpsPoints", BatchSize = 5000 };
await bulk.WriteToServerAsync(batchReader, ct);</pre>`,
      netTitle: 'التصميم في .NET',
      deep: [
        '<b>ابدأ بسيط وقيس:</b> 10,000 عربية كل 10 ثواني = 1,000 write في الثانية، وسيرفر SQL واحد وAPI واحد كفاية. الـ queue والـ TSDB والمنطقتين بتيجي لما الأرقام تطلبها، مش من أول يوم.',
        '<b>الأرقام هنا تقريبية عمدًا:</b> قدرة كل node بتختلف جدًا بالـ hardware وشكل الداتا والـ indexes. قبل أي قرار: load test على الـ hardware بتاعك بالـ batch size بتاعك.',
        '<b>الـ hot path والـ cold path:</b> «آخر مكان» (hot: Redis، ثواني) و«تاريخ الرحلات» (cold: columnstore، دقايق مقبولة). فصلهم بيخلّي كل واحد بسيط ورخيص بدل نظام واحد بيحاول يعمل الاتنين.',
        '<b>المنطقة التانية مش ببلاش:</b> replication بين المناطق async (CAP)، والـ failover لازم يتجرّب، والأجهزة لازم تعرف تتحول (DNS أو anycast). كتير من الأنظمة 99.95% بمنطقة واحدة و3 availability zones أرخص وأبسط.',
        '<b>تبسيطات:</b> كل الأرقام توضيحية وبيتقارنوا ببعض بس، والـ availability تقدير ثابت لكل اختيار، والتكلفة من غير network egress ولا الفريق اللي هيشغّل كل ده.'
      ]
    })
  });
})();
