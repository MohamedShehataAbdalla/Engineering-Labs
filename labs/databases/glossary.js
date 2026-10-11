/* Databases · قاموس المعمل — every term, linked to the lesson where you can see it move. No simulation. */
(function () {
  "use strict";

  const G = [
    ['pages', 'Pages و Rows', [
      ['Page', 'وحدة التخزين والقراية في SQL Server: 8 KB'],
      ['Extent', '8 صفحات متجاورة (64 KB)'],
      ['Slot array', '2 bytes لكل صف في آخر الصفحة، وهو اللي بيحفظ ترتيب الصفوف'],
      ['Page Split', 'صفحة مليانة بتتقسم لاتنين عشان صف جديد يدخل في نصها'],
      ['FILLFACTOR', 'نسبة امتلاء الصفحة وقت بناء الـ index أو الـ REBUILD'],
      ['Fragmentation', 'ترتيب الصفحات المنطقي مختلف عن ترتيبها على الديسك'],
      ['Hot page / PAGELATCH', 'كل الكتابة رايحة لنفس الصفحة فالـ threads بتستنى بعض']
    ]],
    ['btree-index', 'Scan vs Seek', [
      ['B-Tree', 'شجرة صفحات balanced: Root ثم Intermediate ثم Leaf'],
      ['Index Seek', 'نزول من الـ root للـ leaf: صفحة واحدة في كل مستوى'],
      ['Table / Index Scan', 'قراية كل صفحات الجدول أو الـ index'],
      ['Logical Reads', 'عدد الصفحات اللي اتقرت من الـ buffer pool'],
      ['Fanout', 'عدد الصفحات اللي كل صفحة non-leaf بتشاور عليها']
    ]],
    ['index-types', 'أنواع الـ Index', [
      ['Clustered Index', 'الجدول نفسه مترتب بالـ key. واحد بس لكل جدول'],
      ['Heap', 'جدول من غير clustered index'],
      ['Non-clustered Index', 'شجرة منفصلة فيها أعمدة الـ index وعنوان الصف'],
      ['Key Lookup / RID Lookup', 'رجوع للجدول لكل صف عشان أعمدة مش في الـ index'],
      ['Covering Index / INCLUDE', 'index فيه كل الأعمدة اللي الاستعلام محتاجها']
    ]],
    ['execution-plan', 'Execution Plan', [
      ['Execution Plan', 'الطريقة اللي SQL Server قرر ينفذ بيها الاستعلام'],
      ['Query Optimizer', 'الجزء اللي بيحسب تكلفة الخطط ويختار الأرخص'],
      ['Statistics', 'ملخص توزيع القيم اللي الـ optimizer بيقدّر منه عدد الصفوف'],
      ['Tipping Point', 'عدد الصفوف اللي بعده الـ Scan بيبقى أرخص من Seek + Lookup'],
      ['Parameter Sniffing', 'خطة اتعملت لقيمة parameter واتخزنت واتنفذت لقيم تانية']
    ]],
    ['acid', 'Transactions و ACID', [
      ['Transaction', 'مجموعة تعديلات بتتعامل كوحدة واحدة'],
      ['ACID', 'Atomicity و Consistency و Isolation و Durability'],
      ['COMMIT / ROLLBACK', 'تثبيت الـ transaction أو إلغاؤها كلها'],
      ['Write-Ahead Log', 'التعديل يتكتب في الـ log قبل الصفحات'],
      ['Checkpoint', 'كتابة الصفحات المتعدلة من الذاكرة للديسك'],
      ['Recovery (REDO / UNDO)', 'بعد crash: إعادة اللي في الـ log وإلغاء اللي ملوش COMMIT']
    ]],
    ['isolation', 'Isolation Levels', [
      ['Isolation Level', 'قد إيه transaction تشوف من شغل transactions تانية شغالة'],
      ['Dirty Read', 'قراية تعديل لسه متعملوش COMMIT'],
      ['Non-repeatable Read', 'نفس الصف بيرجع قيمتين في نفس الـ transaction'],
      ['Phantom', 'نفس الشرط بيرجع عدد صفوف مختلف'],
      ['RCSI / SNAPSHOT', 'قراية نسخة committed من الصف بدل انتظار الـ lock (row versioning)'],
      ['NOLOCK', 'READ UNCOMMITTED لجدول واحد']
    ]],
    ['locking', 'Locking و Deadlock', [
      ['Lock (S / X)', 'S للقراية، X للتعديل لحد آخر الـ transaction'],
      ['Blocking', 'session مستنية lock مع session تانية'],
      ['Deadlock', 'دايرة انتظار محدش فيها هيكمّل'],
      ['Deadlock victim / 1205', 'الـ transaction اللي SQL Server بيلغيها عشان يفك الدايرة'],
      ['Lock escalation', 'تحويل locks كتير على صفوف لـ lock واحد على الجدول']
    ]],
    ['n-plus-1', 'N+1 في EF Core', [
      ['N+1', 'استعلام لكل عنصر بعد استعلام القائمة'],
      ['Lazy Loading', 'الـ navigation property بيعمل query أول ما تلمسه'],
      ['Include', 'جلب البيانات المرتبطة في نفس الاستعلام بـ JOIN'],
      ['AsSplitQuery', 'تقسيم الـ Include لكذا استعلام عشان تتجنب تكرار الصفوف'],
      ['Projection', 'Select للأعمدة المطلوبة بس'],
      ['Cartesian explosion', 'الصفوف بتتضرب في بعض لما تعمل Include لأكتر من collection']
    ]],
    ['connection-pool', 'Connection Pool', [
      ['Connection Pool', 'connections مفتوحة جاهزة يعاد استخدامها'],
      ['Max Pool Size', 'أقصى عدد connections في الـ pool (الـ default في SqlClient هو 100)'],
      ['Pool Exhaustion', 'كل الـ connections مشغولة والـ requests بتستنى وتاخد timeout'],
      ['Connection Leak', 'connection اتفتح ومرجعش للـ pool'],
      ["Little's Law", 'المشغول في المتوسط = معدل الوصول × مدة الاستخدام']
    ]],
    ['normalization', 'Normalization', [
      ['Normalization', 'كل معلومة في مكان واحد، والجداول مربوطة بـ foreign keys'],
      ['Denormalization', 'نسخ معلومة عن قصد جنب المكان اللي بيقراها'],
      ['Update Anomaly', 'نسخ من نفس المعلومة مختلفة عن بعض بعد تعديل']
    ]],
    ['replication', 'Replication', [
      ['Replication', 'نسخة من الداتابيز بتتحدث باستمرار على سيرفر تاني'],
      ['Sync / Async commit', 'الـ primary بيستنى الـ secondary يكتب الـ log أو لأ'],
      ['Redo queue', 'log وصل للـ secondary ولسه متطبقش'],
      ['Replication Lag', 'قد إيه الـ secondary متأخر عن الـ primary'],
      ['Failover', 'secondary بيبقى primary لما الأساسي يقع'],
      ['RPO / RTO', 'قد إيه داتا ممكن تضيع / قد إيه وقت لحد ما النظام يرجع']
    ]],
    ['sharding', 'Partitioning و Sharding', [
      ['Partitioning', 'تقسيم جدول لأجزاء جوه نفس السيرفر'],
      ['Sharding', 'توزيع الداتا على كذا سيرفر'],
      ['Shard Key', 'العمود اللي بيحدد كل صف يروح أنهي shard'],
      ['Hot Shard', 'shard واحد شايل أغلب الحمل'],
      ['Consistent Hashing', 'توزيع على دايرة بيقلل النقل لما تضيف shard'],
      ['Scatter-gather', 'استعلام لازم يلف على كل الـ shards']
    ]],
    ['storage-engines', 'أنواع التخزين', [
      ['Rowstore', 'الصف كله جنب بعضه في الصفحة'],
      ['Columnstore', 'كل عمود متخزن لوحده ومضغوط'],
      ['Document Store', 'كل record كـ JSON/BSON مرن'],
      ['Time-series DB', 'تخزين متخصص لقيم مترتبة بالوقت مع ضغط عالي'],
      ['Retention', 'مدة الاحتفاظ بالداتا قبل حذفها أو أرشفتها']
    ]]
  ];

  const rows = G.map(([id, title, terms]) =>
    `<tr class="grp"><td colspan="3">${title}</td></tr>` +
    terms.map(([t, d]) => `<tr><td>${t}</td><td>${d}</td><td><a href="#/databases/${id}">${title}</a></td></tr>`).join('')
  ).join('');
  const count = G.reduce((a, g) => a + g[2].length, 0);

  Lab.registerLesson({
    id: 'glossary', lab: 'databases', title: 'قاموس المعمل',
    html: `
  <article class="lab">
    <div class="lab-head">
      <div class="lab-title"><h2 class="terms" tabindex="-1">Glossary</h2><span class="level l1">${count} مصطلح</span></div>
      <p class="lede">كل مصطلحات معمل قواعد البيانات في مكان واحد. اضغط على اسم التجربة عشان تشوف المصطلح بيتحرك.</p>
    </div>
    <div class="gloss-wrap"><table>
      <thead><tr><th>المصطلح</th><th>المعنى</th><th>تشوفه فين</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="explain">
      <div><h4>بعد المعمل ده</h4><p>الـ <b>Replication</b> و الـ <b>Sharding</b> بيكمّلوا في معمل System Design (CAP، Eventual Consistency، Caching). والـ <b>Locks</b> والـ <b>Connection Pool</b> ليهم نسخة جوه الـ process في معمل OS (Deadlock، Thread Pool، Semaphore).</p></div>
      <div><h4>اختبر نفسك</h4><p>عندك جدول <code>GpsPoints</code> فيه مليار صف، والاستعلام الأهم «مسار عربية ليوم». هتعمل الـ clustered key إيه؟ هتحتاج covering index؟ هتقسم بالشهر؟ هتقرا من الـ secondary؟ كل إجابة ليها تجربة هنا تقدر تتأكد منها.</p></div>
    </div>
  </article>`
  });
})();
