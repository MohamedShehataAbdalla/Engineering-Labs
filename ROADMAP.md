# ROADMAP — Engineering Labs

علامة التجربة: `[x]` يعني اتبنت واتراجعت في المتصفح من `file://` (console نظيف، التنقل والرجوع، 390px، dark mode، reduced-motion) واتعمل لها commit.

| المعمل | المسار | الحالة |
|---|---|---|
| البنية المشتركة (SPA) | `index.html` + `shared/` | ✅ |
| 4. Databases | `labs/databases/` | ✅ 14 / 14 |
| 1. DSA | `labs/dsa/` | ✅ 13 / 13 |
| 2. OS & Concurrency | `labs/os/` | ✅ 13 / 13 |
| 3. Networking | `labs/networking/` | ✅ 13 / 13 |
| 5. System Design | `labs/system-design/` | 🚧 1 / 15 |

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
- [x] `normalization` — Normalization vs Denormalization
- [x] `replication` — Replication و Replication Lag (sync/async، stale reads)
- [x] `sharding` — Partitioning و Sharding (Hot Shard، Consistent Hashing)
- [x] `storage-engines` — SQL vs NoSQL vs Time-series (فين تتخزن نقط الـ GPS)
- [x] `glossary` — قاموس المعمل + روابط المعامل المرتبطة

## 1. Data Structures & Algorithms
- [x] `big-o` — Big-O بالعين (عدد الخطوات وهو بيكبر)
- [x] `array-list` — Array vs Linked List
- [x] `stack-queue` — Stack و Queue
- [x] `hash` — Hash Table و Collisions (جوه `Dictionary`)
- [x] `binary-search` — Binary Search
- [x] `sorting` — Sorting (مقارنة بين أكتر من خوارزمية)
- [x] `bst` — BST و Balanced Trees
- [x] `heap` — Heap / Priority Queue
- [x] `graph` — Graph: BFS و DFS
- [x] `dijkstra` — Dijkstra (أقصر طريق لعربية على شبكة طرق)
- [x] `geo` — Geohash / QuadTree (أقرب 5 عربيات لنقطة)
- [x] `window` — Two Pointers / Sliding Window
- [x] `glossary` — قاموس المعمل + روابط المعامل المرتبطة

## 2. Operating System & Concurrency
- [x] `process-thread` — Process vs Thread
- [x] `scheduling` — CPU Scheduling و Context Switch
- [x] `stack-heap` — Stack vs Heap
- [x] `gc` — Garbage Collector في .NET (Gen 0/1/2، LOH)
- [x] `paging` — Virtual Memory و Paging
- [x] `async-io` — Blocking vs Async I/O (مثال المطعم)
- [x] `threadpool` — Thread Pool و Starvation
- [x] `race` — Race Condition و Lock و Interlocked
- [x] `deadlock` — Deadlock
- [x] `semaphore` — Semaphore
- [x] `fd` — File Descriptors وحد الـ connections
- [x] `channels` — Producer/Consumer بـ Channels
- [x] `glossary` — قاموس المعمل + روابط المعامل المرتبطة

## 3. Networking
- [x] `layers` — طبقات TCP/IP (التغليف وفك التغليف)
- [x] `handshake` — TCP 3-Way Handshake
- [x] `tcp-udp` — TCP vs UDP (أجهزة GPS)
- [x] `socket` — IP و Port و Socket
- [x] `nat` — NAT
- [x] `dns` — DNS Resolution
- [x] `tls` — HTTP و HTTPS و TLS Handshake
- [x] `keepalive` — Keep-Alive و Connection Pooling
- [x] `websocket` — WebSocket vs Polling
- [x] `bandwidth` — Bandwidth و Latency و Throughput و Packet Loss
- [x] `rtt` — RTT و Jitter
- [x] `framing` — TCP Framing (رسايل الأجهزة بتوصل متقطعة أو لازقة في بعض)
- [x] `glossary` — قاموس المعمل + روابط المعامل المرتبطة

## 5. System Design
- [x] `estimation` — Requirements و Back-of-the-envelope (حاسبة تفاعلية)
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
