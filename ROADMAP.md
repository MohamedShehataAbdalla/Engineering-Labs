# ROADMAP — Engineering Labs

علامة التجربة: `[x]` يعني اتبنت واتراجعت في المتصفح من `file://` (console نظيف، التنقل والرجوع، 390px، dark mode، reduced-motion) واتعمل لها commit.

| المعمل | المسار | الحالة |
|---|---|---|
| البنية المشتركة (SPA) | `index.html` + `shared/` | ✅ |
| 4. Databases | `labs/databases/` | 🟡 جاري |
| 1. DSA | `labs/dsa/` | ⏳ |
| 2. OS & Concurrency | `labs/os/` | ⏳ |
| 3. Networking | `labs/networking/` | ⏳ |
| 5. System Design | `labs/system-design/` | ⏳ |

> ترتيب المذاكرة: 1 → 5. ترتيب البناء: Databases الأول.

---

## 0. البنية المشتركة
- [x] `CLAUDE.md` و `ROADMAP.md`
- [x] `shared/theme.css`: الـ tokens، light/dark، الخطوط، الـ lab card، المستويات
- [x] `shared/helpers.js`: الرسم، `Meter`، `rng`، `page`، `cyl`
- [x] `shared/engine.js`: الـ loop، الـ controls، stats، الـ theme، reduced-motion، stepped، عزل الأخطاء
- [x] `index.html`: SPA واحد (sidebar + breadcrumb + hash routing + السابق/التالي + «خلّصتها»)
- [x] `shared/catalog.js` و `shared/app.js`: الـ router والـ lazy loading و `registerLesson`

## 4. Databases ← نبدأ بيه
- [x] `pages` — Pages & Rows و Page Split و FILLFACTOR (IDENTITY vs NEWID)
- [x] `btree-index` — Full Table Scan vs B-Tree Index Seek (logical reads، عمق الشجرة)
- [x] `index-types` — Clustered vs Non-clustered vs Covering (Key Lookup، RID Lookup، INCLUDE)
- [x] `execution-plan` — Execution Plan بالعين (tipping point، estimated vs actual)
- [x] `acid` — Transactions و ACID (Write-Ahead Log، crash و recovery)
- [x] `isolation` — Isolation Levels: Dirty / Non-repeatable / Phantom (stepped)
- [x] `locking` — Locking و Blocking و Deadlock (S/X/U، victim، 1205)
- [x] `n-plus-1` — N+1 في EF Core (Lazy / Include / AsSplitQuery / Projection)
- [x] `connection-pool` — Connection Pool (Max Pool Size، exhaustion، leak)
- [ ] `normalization` — Normalization vs Denormalization
- [ ] `replication` — Replication و Replication Lag (sync/async، stale reads)
- [ ] `sharding` — Partitioning و Sharding (Hot Shard، Consistent Hashing)
- [ ] `storage-engines` — SQL vs NoSQL vs Time-series (فين تتخزن نقط الـ GPS)
- [ ] `glossary` — قاموس المعمل + روابط المعامل المرتبطة

## 1. Data Structures & Algorithms
- [ ] `big-o` — Big-O بالعين (عدد الخطوات وهو بيكبر)
- [ ] `array-list` — Array vs Linked List
- [ ] `stack-queue` — Stack و Queue
- [ ] `hash` — Hash Table و Collisions (جوه `Dictionary`)
- [ ] `binary-search` — Binary Search
- [ ] `sorting` — Sorting (مقارنة بين أكتر من خوارزمية)
- [ ] `bst` — BST و Balanced Trees
- [ ] `heap` — Heap / Priority Queue
- [ ] `graph` — Graph: BFS و DFS
- [ ] `dijkstra` — Dijkstra (أقصر طريق لعربية على شبكة طرق)
- [ ] `geo` — Geohash / QuadTree (أقرب 5 عربيات لنقطة)
- [ ] `window` — Two Pointers / Sliding Window
- [ ] قاموس + روابط

## 2. Operating System & Concurrency
- [ ] `process-thread` — Process vs Thread
- [ ] `scheduling` — CPU Scheduling و Context Switch
- [ ] `stack-heap` — Stack vs Heap
- [ ] `gc` — Garbage Collector في .NET (Gen 0/1/2، LOH)
- [ ] `paging` — Virtual Memory و Paging
- [ ] `async-io` — Blocking vs Async I/O (مثال المطعم)
- [ ] `threadpool` — Thread Pool و Starvation
- [ ] `race` — Race Condition و Lock و Interlocked
- [ ] `deadlock` — Deadlock
- [ ] `semaphore` — Semaphore
- [ ] `fd` — File Descriptors وحد الـ connections
- [ ] `channels` — Producer/Consumer بـ Channels
- [ ] قاموس + روابط

## 3. Networking
- [ ] `layers` — طبقات TCP/IP (التغليف وفك التغليف)
- [ ] `handshake` — TCP 3-Way Handshake
- [ ] `tcp-udp` — TCP vs UDP (أجهزة GPS)
- [ ] `socket` — IP و Port و Socket
- [ ] `nat` — NAT
- [ ] `dns` — DNS Resolution
- [ ] `tls` — HTTP و HTTPS و TLS Handshake
- [ ] `keepalive` — Keep-Alive و Connection Pooling
- [ ] `websocket` — WebSocket vs Polling
- [ ] `bandwidth` — Bandwidth و Latency و Throughput و Packet Loss
- [ ] `rtt` — RTT و Jitter
- [ ] `framing` — TCP Framing (رسايل الأجهزة بتوصل متقطعة أو لازقة في بعض)
- [ ] قاموس + روابط

## 5. System Design
- [ ] `estimation` — Requirements و Back-of-the-envelope (حاسبة تفاعلية)
- [ ] `lb` — Load Balancer و Horizontal/Vertical Scaling
- [ ] `stateless` — Stateless vs Stateful (الـ session في Redis)
- [ ] `cache` — Caching (Hit/Miss/TTL/LRU)
- [ ] `cdn` — CDN
- [ ] `mq` — Message Queue و Backpressure
- [ ] `cap` — CAP و Eventual Consistency
- [ ] `sync-events` — Sync APIs vs Events
- [ ] `spof` — Single Point of Failure
- [ ] `resilience` — Timeout و Retry و Circuit Breaker
- [ ] `rate-limit` — Rate Limiting (Token Bucket)
- [ ] `observability` — Observability (Logs, Metrics, Tracing, Alerts)
- [ ] `jwt` — Auth بـ JWT
- [ ] `capstone` — صمّم نظام تتبع لـ 100 ألف عربية (Trade-offs: Latency و Availability والتكلفة)
- [ ] قاموس + روابط
