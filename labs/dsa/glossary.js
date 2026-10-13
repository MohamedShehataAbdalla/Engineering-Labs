/* DSA · قاموس المعمل — every term, linked to the lesson where you can see it move. No simulation. */
(function () {
  "use strict";

  const G = [
    ['big-o', 'Big-O', [
      ['Big-O', 'عدد الخطوات بيكبر إزاي لما الداتا تكبر، من غير الثوابت'],
      ['O(1)', 'عدد خطوات ثابت مهما كان حجم الداتا'],
      ['O(log n)', 'كل خطوة بتقسم المشكلة نصين: مليون عنصر ≈ 20 خطوة'],
      ['O(n)', 'بتعدّي على كل عنصر مرة'],
      ['O(n log n)', 'أحسن sort عام بالمقارنات'],
      ['O(n²)', 'loop جوه loop على نفس الداتا'],
      ['Worst case', 'أسوأ حالة ممكنة، زي البحث عن مفتاح مش موجود']
    ]],
    ['array-list', 'Array vs Linked List', [
      ['Array', 'عناصر متجاورة في الذاكرة: العنوان = البداية + i × الحجم'],
      ['List<T>', 'array جوّاها Count و Capacity، بتتضاعف لما تتملي'],
      ['Capacity', 'عدد الخانات المحجوزة فعلًا (≥ Count)'],
      ['Amortized O(1)', 'عملية ساعات غالية بس متوسطها على المدى الطويل ثابت'],
      ['Linked List', 'كل عنصر node لوحده فيه pointer للي بعده'],
      ['Cache line', '64 byte الـ CPU بيقراهم مرة واحدة من الذاكرة'],
      ['Cache miss', 'الداتا مش في الـ cache: حوالي 100 ns انتظار']
    ]],
    ['stack-queue', 'Stack و Queue', [
      ['Stack / LIFO', 'آخر واحد دخل أول واحد يخرج: Push و Pop'],
      ['Queue / FIFO', 'أول واحد دخل أول واحد يخرج: Enqueue و Dequeue'],
      ['Circular buffer', 'array الـ head والـ tail فيها بيلفّوا لأولها'],
      ['Starvation', 'عنصر بيستنى للأبد لأن الأحدث دايمًا بيتخدم قبله'],
      ['p95 / p99', 'الوقت اللي 95% أو 99% من الطلبات أقل منه'],
      ['Little’s law', 'متوسط العدد المستني = معدل الدخول × متوسط الانتظار']
    ]],
    ['hash', 'Hash Table', [
      ['Hash function', 'دالة بتحوّل المفتاح لرقم (GetHashCode)'],
      ['Bucket', 'خانة في الجدول: hash % عدد الـ buckets'],
      ['Collision', 'مفتاحين وقعوا في نفس الـ bucket'],
      ['Chaining', 'المفاتيح المتصادمة بتتحط في قايمة تحت الـ bucket'],
      ['Load factor', 'عدد العناصر ÷ عدد الـ buckets'],
      ['Rehash / Resize', 'جدول أكبر وتوزيع كل المفاتيح عليه من جديد'],
      ['Hash flooding', 'هجوم بمفاتيح مقصودة تقع كلها في bucket واحد']
    ]],
    ['binary-search', 'Binary Search', [
      ['Binary search', 'بص في النص وارمي النص اللي مفيهوش الإجابة'],
      ['lo / hi / mid', 'حدود المنطقة اللي لسه ممكن تكون فيها الإجابة، والنص'],
      ['Floor search', 'آخر عنصر ≤ القيمة (مش لازم تساويها بالظبط)'],
      ['Invariant', 'شرط بيفضل صح في كل لفة: الإجابة دايمًا بين lo و hi'],
      ['Precondition', 'الداتا لازم تكون مترتبة، وإلا الإجابة غلط من غير error']
    ]],
    ['sorting', 'Sorting', [
      ['Insertion sort', 'كل عنصر بيتحط في مكانه في الجزء المترتب: ممتاز للداتا شبه المترتبة'],
      ['Merge sort', 'قسّم نصين، رتّب، وادمج: O(n log n) دايمًا'],
      ['Quick sort', 'pivot وتقسيم أصغر / أكبر: سريع بس O(n²) لو الـ pivot وحش'],
      ['Pivot', 'العنصر اللي بنقسم حواليه في Quick sort'],
      ['Stable sort', 'العناصر المتساوية بتحافظ على ترتيبها الأصلي'],
      ['Introsort', 'Quick + Heap + Insertion: اللي Array.Sort بيستخدمه']
    ]],
    ['bst', 'BST و Balanced Trees', [
      ['Binary Search Tree', 'كل node شمالها أصغر ويمينها أكبر'],
      ['Height', 'أطول طريق من الـ root لورقة = أقصى عدد مقارنات'],
      ['Degenerate tree', 'شجرة بقت خط مستقيم (Linked List) من مفاتيح مترتبة'],
      ['AVL / Red-Black', 'أشجار بتوزن نفسها عشان الارتفاع يفضل O(log n)'],
      ['Rotation', 'إعادة ترتيب 2-3 nodes عشان ترجع التوازن'],
      ['SortedDictionary', 'Red-Black tree في .NET']
    ]],
    ['heap', 'Heap / Priority Queue', [
      ['Priority Queue', 'طابور بيطلّع الأهم الأول مش الأقدم'],
      ['Min-heap', 'كل أب أصغر من أولاده، فالأصغر في الـ root'],
      ['Sift up / down', 'طلوع العنصر الجديد لفوق، أو نزول الـ root لتحت بعد السحب'],
      ['d-ary heap', 'كل node ليها d أبناء (PriorityQueue في .NET: d = 4)'],
      ['Heapify', 'بناء heap من n عنصر في O(n)']
    ]],
    ['graph', 'BFS و DFS', [
      ['Graph', 'nodes و edges: أي حاجة فيها «مين متوصل بمين»'],
      ['BFS', 'الأقرب الأول بـ Queue: أقل عدد edges'],
      ['DFS', 'لآخر الطريق وبعدين ارجع بـ Stack'],
      ['Frontier', 'اللي اتشاف ولسه ما اتزارش'],
      ['Visited set', 'عشان متزورش نفس الـ node مرتين']
    ]],
    ['dijkstra', 'Dijkstra', [
      ['Weighted graph', 'كل edge ليه تكلفة: وقت، مسافة، فلوس'],
      ['Dijkstra', 'احسم دايمًا الأقرب اللي لسه ما اتحسمش (بـ Priority Queue)'],
      ['A*', 'Dijkstra + تقدير للمسافة الباقية'],
      ['Admissible heuristic', 'تقدير عمره ما بيزوّد عن الحقيقة، فالنتيجة مضمونة'],
      ['Lazy deletion', 'ضيف نسخة جديدة في الـ heap وتجاهل القديمة لما تطلع']
    ]],
    ['geo', 'Geohash / QuadTree', [
      ['Spatial index', 'index بيقسم المكان لمربعات عشان «قريب من» يبقى سريع'],
      ['QuadTree', 'المربع بيتقسم 4 لما يتملي: بيتكيف مع الكثافة'],
      ['Geohash', 'كود للمربع في grid ثابت، والـ prefix المشترك = قرب غالبًا'],
      ['k-NN', 'أقرب k نقط لنقطة معينة'],
      ['Brute force', 'احسب المسافة لكل نقطة']
    ]],
    ['window', 'Sliding Window', [
      ['Sliding window', 'احسب على آخر جزء، وحدّث بالداخل والخارج بس'],
      ['Two pointers', 'L و R بيتحركوا لقدّام بس: كل عنصر بيدخل ويخرج مرة'],
      ['Running sum', 'مجموع بيتحدّث بالإضافة والطرح بدل ما يتحسب من الأول'],
      ['Monotonic deque', 'طابور بيحتفظ بالمرشحين بس عشان max/min الشباك']
    ]]
  ];

  const esc = s => s.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const rows = G.map(([id, title, terms]) =>
    `<tr class="grp"><td colspan="3">${title}</td></tr>` +
    terms.map(([t, d]) => `<tr><td>${esc(t)}</td><td>${d}</td><td><a href="#/dsa/${id}">${title}</a></td></tr>`).join('')
  ).join('');
  const count = G.reduce((a, g) => a + g[2].length, 0);

  Lab.registerLesson({
    id: 'glossary', lab: 'dsa', title: 'قاموس المعمل',
    html: `
  <article class="lab">
    <div class="lab-head">
      <div class="lab-title"><h2 class="terms" tabindex="-1">Glossary</h2><span class="level l1">${count} مصطلح</span></div>
      <p class="lede">كل مصطلحات معمل الـ Data Structures والخوارزميات في مكان واحد. اضغط على اسم التجربة عشان تشوف المصطلح بيتحرك.</p>
    </div>
    <div class="gloss-wrap"><table>
      <thead><tr><th>المصطلح</th><th>المعنى</th><th>تشوفه فين</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="explain">
      <div><h4>بعد المعمل ده</h4><p>الـ <b>Stack</b> والـ <b>Queue</b> هيرجعوا في معمل OS (الـ call stack والـ producer/consumer بـ Channels). والـ <b>Hash Table</b> والـ <b>Sliding Window</b> هيرجعوا في System Design (Caching و Rate Limiting). والـ <b>B-tree</b> اللي هو ابن عم الـ BST موجود في <a href="#/databases/btree-index">معمل Databases</a>.</p></div>
      <div><h4>اختبر نفسك</h4><p>عندك 10,000 عربية بتبعت كل 10 ثواني، وعايز: آخر مكان لكل عربية، وأقرب 5 عربيات لأي نقطة، ومسار أي عربية في أي يوم، وتنبيه لو عربية بعتت أكتر من 30 رسالة في دقيقة. هتستخدم إيه لكل واحدة؟ (Dictionary، QuadTree أو Geohash، List مترتبة + BinarySearch، Sliding Window)</p></div>
    </div>
  </article>`
  });
})();
