/* OS · قاموس المعمل — every term, linked to the lesson where you can see it move. No simulation. */
(function () {
  "use strict";

  const G = [
    ['process-thread', 'Process vs Thread', [
      ['Process', 'برنامج شغّال بمساحة ذاكرة لوحده، معزول عن غيره'],
      ['Thread', 'مسار تنفيذ جوه process: ليه stack، ويشارك الـ heap'],
      ['Shared memory', 'الـ threads بيقروا ويكتبوا نفس الـ objects من غير نسخ'],
      ['IPC', 'كلام بين processes: pipe أو socket، فيه serialize ونسخ'],
      ['Isolation', 'process يقع والباقي شغال']
    ]],
    ['scheduling', 'CPU Scheduling', [
      ['Scheduler', 'جزء الـ OS اللي بيقرر أنهي thread يشتغل على أنهي core'],
      ['Quantum / Time slice', 'أقصى وقت thread بيشتغل قبل ما يتوقف لغيره'],
      ['Preemption', 'الـ OS بيوقف الـ thread غصب عنه'],
      ['Context switch', 'حفظ thread وتحميل غيره: registers + cache بارد'],
      ['Ready queue', 'الـ threads الجاهزة ومستنية core']
    ]],
    ['stack-heap', 'Stack vs Heap', [
      ['Stack', 'ذاكرة لكل thread، frames بتتحط وتتشال مع النداءات'],
      ['Stack frame', 'المتغيرات المحلية وعنوان الرجوع لنداء واحد'],
      ['Heap', 'ذاكرة مشتركة للـ objects، الـ GC بينضّفها'],
      ['Value type', 'struct: القيمة نفسها مكانها (في الـ frame أو جوه object)'],
      ['Reference type', 'class: object في الـ heap، والمتغير بيشيل عنوانه'],
      ['Boxing', 'نسخ struct لـ object في الـ heap'],
      ['StackOverflow', 'الـ stack خلص: الـ process بيقفل ومفيش catch']
    ]],
    ['gc', 'Garbage Collector', [
      ['Garbage collection', 'تحديد الـ objects اللي محدش بيشاور عليها وإرجاع مكانها'],
      ['Gen 0 / 1 / 2', 'أجيال: الجديد، اللي عاش مرة، اللي عاش أكتر'],
      ['Promotion', 'object عاش بعد GC بيتنقل للجيل اللي بعده'],
      ['LOH', 'objects ≥ 85,000 byte، مبتتلمّش غير مع gen2'],
      ['GC pause', 'وقت البرنامج بيقف فيه عشان الـ GC يشتغل'],
      ['Roots', 'statics و locals و registers: منها الـ GC بيبدأ يعلّم الحي']
    ]],
    ['paging', 'Virtual Memory', [
      ['Virtual memory', 'كل process شايف ذاكرة لوحده، والـ OS بيترجمها للحقيقية'],
      ['Page', 'وحدة الذاكرة (عادةً 4 KB)'],
      ['Page table', 'الترجمة من صفحة virtual لـ frame في الـ RAM'],
      ['Page fault', 'الصفحة مش في الـ RAM: لازم تتجاب من الديسك'],
      ['LRU', 'اطرد اللي بقاله أطول وقت مستخدمش'],
      ['Thrashing', 'البرنامج بيقضي وقته كله في page faults'],
      ['Working set', 'الصفحات اللي البرنامج بيستخدمها فعلًا']
    ]],
    ['async-io', 'Blocking vs Async I/O', [
      ['Blocking I/O', 'الـ thread واقف لحد ما الرد يوصل'],
      ['async / await', 'الـ thread بيرجع للـ pool وقت الانتظار'],
      ['Continuation', 'الباقي من الـ method بعد await، بيتحط في الطابور'],
      ['I/O completion', 'الـ OS بيبلّغ إن العملية خلصت (IOCP / epoll)']
    ]],
    ['threadpool', 'Thread Pool', [
      ['Thread pool', 'threads جاهزة بتسحب شغل من طابور'],
      ['Thread injection', 'الـ pool بيضيف threads ببطء لما يلاقيهم مشغولين'],
      ['Starvation', 'كل الـ threads واقفة والشغل مستني'],
      ['sync-over-async', '.Result أو .Wait على Task: thread محجوز بيستنى thread تاني'],
      ['SetMinThreads', 'threads جاهزة أكتر من البداية: مسكّن مش علاج']
    ]],
    ['race', 'Race Condition', [
      ['Race condition', 'النتيجة بتعتمد على مين سبق مين'],
      ['Atomic', 'عملية مينفعش حد يدخل في نصها'],
      ['Critical section', 'جزء من الكود لازم thread واحد بس يشغّله في المرة'],
      ['lock / Monitor', 'بيسمح لـ thread واحد جوه الـ critical section'],
      ['Interlocked', 'عمليات atomic بأمر CPU واحد من غير lock'],
      ['Lost update', 'كتابة غطّت على كتابة تانية فضاعت']
    ]],
    ['deadlock', 'Deadlock', [
      ['Deadlock', 'كل واحد ماسك حاجة ومستني اللي مع التاني: للأبد'],
      ['Wait-for graph', 'سهم من كل thread للي ماسك اللي هو مستنيه؛ دايرة = deadlock'],
      ['Lock ordering', 'كل الكود ياخد الـ locks بنفس الترتيب'],
      ['TryEnter / timeout', 'متستناش للأبد: سيب وجرّب تاني'],
      ['Livelock', 'الكل بيتراجع ويحاول في نفس اللحظة ومحدش بيخلّص']
    ]],
    ['semaphore', 'Semaphore', [
      ['Semaphore', 'عداد permits: N يدخلوا في نفس الوقت'],
      ['SemaphoreSlim', 'النسخة الخفيفة جوه الـ process، وفيها WaitAsync'],
      ['Concurrency limit', 'حد لعدد العمليات المتزامنة على مورد'],
      ['Bulkhead', 'عزل جزء من النظام عشان ضغطه ميغرّقش الباقي']
    ]],
    ['fd', 'File Descriptors', [
      ['File descriptor', 'رقم من الـ OS لكل ملف أو socket مفتوح'],
      ['ulimit -n', 'أقصى عدد descriptors للـ process'],
      ['EMFILE', 'Too many open files: وصلت الحد'],
      ['Ephemeral port', 'port مؤقت لكل connection خارجة'],
      ['TIME_WAIT', 'الـ port بعد قفل الـ connection: محجوز لفترة قبل إعادة الاستخدام'],
      ['Keep-alive / pooling', 'إعادة استخدام نفس الـ connection لطلبات كتير']
    ]],
    ['channels', 'Channels', [
      ['Producer / Consumer', 'حد بينتج شغل وحد بينفّذه وبينهم طابور'],
      ['Channel<T>', 'طابور thread-safe و async في .NET'],
      ['Bounded', 'طابور ليه سعة قصوى'],
      ['Backpressure', 'البطء بيرجع للمنتج بدل ما الطابور يكبر للأبد'],
      ['DropOldest', 'لما يتملي ارمي الأقدم عشان الجديد يدخل']
    ]]
  ];

  const esc = s => s.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const rows = G.map(([id, title, terms]) =>
    `<tr class="grp"><td colspan="3">${title}</td></tr>` +
    terms.map(([t, d]) => `<tr><td>${esc(t)}</td><td>${d}</td><td><a href="#/os/${id}">${title}</a></td></tr>`).join('')
  ).join('');
  const count = G.reduce((a, g) => a + g[2].length, 0);

  Lab.registerLesson({
    id: 'glossary', lab: 'os', title: 'قاموس المعمل',
    html: `
  <article class="lab">
    <div class="lab-head">
      <div class="lab-title"><h2 class="terms" tabindex="-1">Glossary</h2><span class="level l1">${count} مصطلح</span></div>
      <p class="lede">كل مصطلحات معمل نظام التشغيل والتزامن في مكان واحد. اضغط على اسم التجربة عشان تشوف المصطلح بيتحرك.</p>
    </div>
    <div class="gloss-wrap"><table>
      <thead><tr><th>المصطلح</th><th>المعنى</th><th>تشوفه فين</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="explain">
      <div><h4>بعد المعمل ده</h4><p>الـ <b>Locks</b> والـ <b>Deadlock</b> والـ <b>Pool</b> ليهم نسخة جوه قاعدة البيانات في <a href="#/databases/locking">معمل Databases</a>. والـ <b>Channel</b> والـ <b>Semaphore</b> بيكبروا لـ Message Queues و Rate Limiting في System Design. والـ <b>Socket</b> و <b>TIME_WAIT</b> هيرجعوا بالتفصيل في معمل Networking.</p></div>
      <div><h4>اختبر نفسك</h4><p>سيرفر الـ GPS بقى بطيء الصبح: الـ CPU 10%، والذاكرة بتزيد، و<code>dotnet-counters</code> بيقول ThreadPool Queue Length 4,000 وThread Count بيزيد واحد واحد. إيه أول حاجة هتدوّر عليها في الكود؟ وإيه اللي ممكن يكون بيخلّي الذاكرة تزيد في نفس الوقت؟ (sync-over-async، و Channel أو طابور unbounded)</p></div>
    </div>
  </article>`
  });
})();
