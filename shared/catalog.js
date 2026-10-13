/* Engineering Labs — the catalog: every lab and every lesson, in study order.
   `file` set  = the lesson is built (its script is lazy-loaded when the lab opens).
   `file` null = shown as "قريبًا" in the sidebar, not a link.
   When you build a lesson: set its `file`, and make the file call Lab.registerLesson({ id, lab, ... }). */
(function (G) {
  "use strict";
  const Lab = G.Lab || (G.Lab = {});

  const L = (id, title, terms, file) => ({ id, title, terms, file: file || null });

  Lab.CATALOG = [
    {
      id: 'dsa', num: '01', title: 'الـ Data Structures والخوارزميات', en: 'Data Structures & Algorithms',
      blurb: 'Big-O بالعين، والـ Hash Table اللي جوه <code>Dictionary</code>، وDijkstra لأقصر طريق، وأقرب 5 عربيات لنقطة.',
      intro: `
        <p>نفس السيناريو: <b>10,000 عربية</b> بتبعت موقعها كل 10 ثواني. هنا السؤال مش «الداتا متخزنة فين»، السؤال «هتدوّر فيها إزاي». كل تجربة بتشغّل الخوارزمية الحقيقية على داتا حقيقية وبتعدّ الخطوات اللي اتعملت فعلًا: مقارنات، نقل عناصر، قفزات pointers. والكود في كل تجربة بالـ collections اللي بتستخدمها في .NET كل يوم.</p>
        <div class="legend" aria-label="مفتاح الألوان">
          <span><i style="background:var(--accent)"></i>الخطوة الحالية: العنصر اللي بيتقارن أو بيتنقل</span>
          <span><i style="background:var(--accent-2)"></i>عنصر متخزن، أو لقيناه، أو خلص</span>
          <span><i style="background:var(--violet)"></i>الهيكل نفسه: pointer، bucket، index</span>
          <span><i style="background:var(--good)"></i>رخيص: خطوات قليلة</span>
          <span><i style="background:var(--bad)"></i>مكلف: collision، scan، خطوات كتير</span>
        </div>`,
      related: [
        ['databases', 'Databases · B-Tree Index', 'الـ BST الـ balanced هو نفس فكرة الـ B-tree، بس بصفحات 8 KB بدل nodes.'],
        ['os', 'OS · Stack vs Heap و Channels', 'الـ Stack والـ Queue هما نفسهم الـ call stack والـ producer/consumer.'],
        ['system-design', 'System Design · Caching و Rate Limiting', 'الـ Hash Table تحت كل cache، والـ Sliding Window تحت كل rate limiter.']
      ],
      lessons: [
        L('big-o', 'Big-O بالعين', 'Big-O / O(1) / O(log n) / O(n²)', 'labs/dsa/big-o.js'),
        L('array-list', 'Array vs Linked List', 'Array / List<T> / Linked List / Cache Line', 'labs/dsa/array-list.js'),
        L('stack-queue', 'Stack و Queue', 'Stack / Queue / LIFO / FIFO', 'labs/dsa/stack-queue.js'),
        L('hash', 'Hash Table و Collisions', 'Hash Table / Bucket / Collision / Load Factor', 'labs/dsa/hash.js'),
        L('binary-search', 'Binary Search', 'Binary Search / Sorted Array / lo-hi-mid', 'labs/dsa/binary-search.js'),
        L('sorting', 'Sorting', 'Insertion / Merge / Quick / Stable', 'labs/dsa/sorting.js'),
        L('bst', 'BST و Balanced Trees', 'BST / AVL / Rotation / Height', 'labs/dsa/bst.js'),
        L('heap', 'Heap / Priority Queue', 'Heap / Priority Queue / Sift Up / Sift Down', 'labs/dsa/heap.js'),
        L('graph', 'Graph: BFS و DFS', 'Graph / BFS / DFS / Frontier', 'labs/dsa/graph.js'),
        L('dijkstra', 'Dijkstra: أقصر طريق', 'Dijkstra / Weighted Graph / A*', 'labs/dsa/dijkstra.js'),
        L('geo', 'Geohash / QuadTree', 'QuadTree / Geohash / k-Nearest / Spatial Index', 'labs/dsa/geo.js'),
        L('window', 'Two Pointers / Sliding Window', 'Two Pointers / Sliding Window'),
        L('glossary', 'قاموس المعمل', 'Glossary')
      ]
    },
    {
      id: 'os', num: '02', title: 'نظام التشغيل والتزامن', en: 'Operating System & Concurrency',
      blurb: 'Threads وThread Pool Starvation والـ GC في .NET، وRace Conditions، وDeadlock، وChannels.',
      lessons: [
        L('process-thread', 'Process vs Thread', 'Process / Thread'),
        L('scheduling', 'CPU Scheduling', 'Scheduling / Context Switch'),
        L('stack-heap', 'Stack vs Heap', 'Stack / Heap'),
        L('gc', 'Garbage Collector في .NET', 'GC / Gen 0-1-2 / LOH'),
        L('paging', 'Virtual Memory و Paging', 'Virtual Memory / Paging'),
        L('async-io', 'Blocking vs Async I/O', 'Blocking / Async I/O'),
        L('threadpool', 'Thread Pool و Starvation', 'Thread Pool / Starvation'),
        L('race', 'Race Condition و Lock', 'Race Condition / Lock / Interlocked'),
        L('deadlock', 'Deadlock', 'Deadlock'),
        L('semaphore', 'Semaphore', 'Semaphore'),
        L('fd', 'File Descriptors', 'File Descriptors'),
        L('channels', 'Producer/Consumer بـ Channels', 'Channels')
      ]
    },
    {
      id: 'networking', num: '03', title: 'الشبكات', en: 'Networking',
      blurb: 'TCP vs UDP لأجهزة الـ GPS، والـ TLS Handshake، وWebSocket، وTCP Framing (الرسايل اللي بتوصل متقطعة أو لازقة في بعض).',
      lessons: [
        L('layers', 'طبقات TCP/IP', 'TCP/IP Layers'),
        L('handshake', 'TCP 3-Way Handshake', '3-Way Handshake'),
        L('tcp-udp', 'TCP vs UDP', 'TCP / UDP'),
        L('socket', 'IP و Port و Socket', 'IP / Port / Socket'),
        L('nat', 'NAT', 'NAT'),
        L('dns', 'DNS Resolution', 'DNS'),
        L('tls', 'HTTPS و TLS Handshake', 'HTTP / HTTPS / TLS'),
        L('keepalive', 'Keep-Alive و Connection Pooling', 'Keep-Alive / Pooling'),
        L('websocket', 'WebSocket vs Polling', 'WebSocket / Polling'),
        L('bandwidth', 'Bandwidth و Latency', 'Bandwidth / Latency / Throughput'),
        L('rtt', 'RTT و Jitter', 'RTT / Jitter'),
        L('framing', 'TCP Framing', 'TCP Framing')
      ]
    },
    {
      id: 'databases', num: '04', title: 'قواعد البيانات', en: 'Databases',
      blurb: 'الداتا متخزنة إزاي على الديسك، والـ Index بيوفّر إيه فعلًا، وLocks وIsolation، وN+1 في EF Core، وReplication وSharding.',
      intro: `
        <p>السيناريو ثابت في المعمل كله: <b>10,000 جهاز GPS</b> كل واحد بيبعت موقعه كل 10 ثواني، يعني <b>1,000 insert في الثانية</b> في جدول <code>GpsPoints(Id, VehicleId, Ts, Lat, Lng, Speed)</code>، ومعاه جداول <code>Vehicles</code> و <code>Trips</code> و <code>Drivers</code>. كل تجربة بتوريك جزء من اللي بيحصل جوه SQL Server وأنت بتكتب وتقرا الجداول دي.</p>
        <div class="legend" aria-label="مفتاح الألوان">
          <span><i style="background:var(--accent)"></i>صف أو طلب جديد داخل</span>
          <span><i style="background:var(--accent-2)"></i>داتا متخزنة، رد، أو شغل خلص</span>
          <span><i style="background:var(--violet)"></i>metadata: header، index، replica</span>
          <span><i style="background:var(--good)"></i>كويس / سريع</span>
          <span><i style="background:var(--bad)"></i>مكلف: split، scan، lock، ضياع</span>
        </div>`,
      related: [
        ['dsa', 'DSA · BST و Balanced Trees', 'الـ B-tree اللي تحت كل index هو شجرة balanced بصفحات بدل nodes.'],
        ['os', 'OS · Deadlock و Thread Pool', 'نفس فكرة الـ Locks والـ Pool، بس جوه الـ process.'],
        ['system-design', 'System Design · Caching و CAP', 'لما Replication و Sharding يبقوا جزء من تصميم أكبر.']
      ],
      lessons: [
        L('pages', 'Pages و Rows و Page Split', 'Page / Row / Page Split / FILLFACTOR', 'labs/databases/pages.js'),
        L('btree-index', 'Full Scan vs Index Seek', 'Table Scan / B-Tree / Index Seek', 'labs/databases/btree-index.js'),
        L('index-types', 'Clustered vs Non-clustered vs Covering', 'Clustered / Non-clustered / Covering / Key Lookup', 'labs/databases/index-types.js'),
        L('execution-plan', 'Execution Plan بالعين', 'Execution Plan / Tipping Point / Estimates', 'labs/databases/execution-plan.js'),
        L('acid', 'Transactions و ACID', 'Transaction / ACID / WAL / Recovery', 'labs/databases/acid.js'),
        L('isolation', 'Isolation Levels', 'Dirty Read / Non-repeatable Read / Phantom', 'labs/databases/isolation.js'),
        L('locking', 'Locking و Blocking و Deadlock', 'Lock / Blocking / Deadlock / 1205', 'labs/databases/locking.js'),
        L('n-plus-1', 'N+1 في EF Core', 'N+1 / Include / Projection', 'labs/databases/n-plus-1.js'),
        L('connection-pool', 'Connection Pool', 'Connection Pool / Exhaustion', 'labs/databases/connection-pool.js'),
        L('normalization', 'Normalization vs Denormalization', 'Normalization / Denormalization', 'labs/databases/normalization.js'),
        L('replication', 'Replication و Replication Lag', 'Replication / Lag / Failover', 'labs/databases/replication.js'),
        L('sharding', 'Partitioning و Sharding', 'Sharding / Hot Shard / Consistent Hashing', 'labs/databases/sharding.js'),
        L('storage-engines', 'SQL vs NoSQL vs Time-series', 'SQL / NoSQL / Time-series', 'labs/databases/storage-engines.js'),
        L('glossary', 'قاموس المعمل', 'Glossary', 'labs/databases/glossary.js')
      ]
    },
    {
      id: 'system-design', num: '05', title: 'تصميم الأنظمة', en: 'System Design',
      blurb: 'Caching وMessage Queues وCAP وCircuit Breaker، والتجربة الختامية: صمّم نظام تتبع لـ 100 ألف عربية.',
      lessons: [
        L('estimation', 'Back-of-the-envelope', 'Requirements / Estimation'),
        L('lb', 'Load Balancer و Scaling', 'Load Balancer / Scaling'),
        L('stateless', 'Stateless vs Stateful', 'Stateless / Stateful'),
        L('cache', 'Caching', 'Cache / Hit / Miss / TTL / LRU'),
        L('cdn', 'CDN', 'CDN'),
        L('mq', 'Message Queue و Backpressure', 'Message Queue / Backpressure'),
        L('cap', 'CAP و Eventual Consistency', 'CAP / Eventual Consistency'),
        L('sync-events', 'Sync APIs vs Events', 'Sync / Events'),
        L('spof', 'Single Point of Failure', 'SPOF'),
        L('resilience', 'Timeout و Retry و Circuit Breaker', 'Timeout / Retry / Circuit Breaker'),
        L('rate-limit', 'Rate Limiting', 'Rate Limiting / Token Bucket'),
        L('observability', 'Observability', 'Logs / Metrics / Tracing / Alerts'),
        L('jwt', 'Auth بـ JWT', 'JWT'),
        L('capstone', 'صمّم نظام تتبع لـ 100 ألف عربية', 'Trade-offs')
      ]
    }
  ];
})(window);
