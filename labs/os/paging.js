/* OS · Virtual Memory و Paging
   A process sees 64 virtual pages (think: 64 chunks of a big in-memory GPS cache, 4 KB each). Only `frames` of them
   fit in physical RAM. Every memory access goes through a real page table:
     resident     → hit, ~100 ns
     not resident → page fault: pick a victim frame with LRU (least recently used), write it out, read the page in
   Access patterns: a hot set (most accesses on a few pages), a loop over the working set (LRU's worst case when the
   working set doesn't fit), or uniform random. Hits, faults and the effective access time come from the run;
   100 ns for RAM and ~100 µs for a page read from an SSD are typical orders of magnitude. */
(function () {
  "use strict";
  const { clamp, lerp, fmt, f1 } = Lab.util;
  const { box, tx, line, alpha } = Lab.draw;

  const VP = 64, RATE = 140, RAM_NS = 100, FAULT_NS = 100000, WIN = 600;

  function fresh(s) {
    s.st = { table: new Array(VP).fill(-1), frames: [], lastUse: new Map(), clock: 0, hist: [], acc: 0, faults: 0, flash: [], cursor: 0, carry: 0 };
  }
  function nextPage(s) {
    const st = s.st, W = s.p.ws, r = s.rng();
    if (s.p.pattern === 'loop') { const p = st.cursor % W; st.cursor++; return p; }
    if (s.p.pattern === 'random') return Math.floor(r * W);
    // hot set: 80% of accesses go to the first 20% of the working set
    const hot = Math.max(1, Math.round(W * 0.2));
    return s.rng() < 0.8 ? Math.floor(r * hot) : hot + Math.floor(r * (W - hot));
  }
  function access(s) {
    const st = s.st, p = nextPage(s), F = s.p.frames;
    st.clock++; st.acc++;
    let fault = false, victim = -1;
    if (st.table[p] < 0) {
      fault = true; st.faults++;
      let frame;
      if (st.frames.length < F) { frame = st.frames.length; st.frames.push(p); }
      else {
        // LRU: the resident page that was used longest ago
        let best = Infinity, bf = 0;
        st.frames.forEach((vp, f) => { const u = st.lastUse.get(vp); if (u < best) { best = u; bf = f; } });
        victim = st.frames[bf]; st.table[victim] = -1; frame = bf; st.frames[bf] = p;
      }
      st.table[p] = frame;
    }
    st.lastUse.set(p, st.clock);
    st.hist.push(fault ? 1 : 0); if (st.hist.length > WIN) st.hist.shift();
    st.flash.push({ p, fault, victim, frame: st.table[p], t: s.t });
  }

  Lab.registerSim('paging', {
    height: 360, warm: 3,

    init(s) { fresh(s); },
    onParam(s, k) {
      if (k === 'frames') {
        // shrinking RAM evicts pages; growing just leaves free frames
        const st = s.st;
        while (st.frames.length > s.p.frames) { const vp = st.frames.pop(); st.table[vp] = -1; }
      }
      s.st.hist = [];
    },

    step(s, dt) {
      const st = s.st;
      st.carry += dt * RATE;
      while (st.carry >= 1) { st.carry--; access(s); }
      st.flash = st.flash.filter(f => s.t - f.t < 0.35);
    },

    metrics(s) {
      const h = s.st.hist, faults = h.reduce((a, b) => a + b, 0), rate = h.length ? faults / h.length : 0;
      const eat = RAM_NS + rate * FAULT_NS;
      return { rate, eat, slow: eat / RAM_NS };
    },

    draw(s) {
      const C = s.C, st = s.st, W = s.w, H = s.h, n = s.narrow, F = s.p.frames;
      const x0 = 14, x1 = W - 14, gap = n ? 14 : 30, half = (x1 - x0 - gap) / 2;
      const vx = x0, px = x0 + half + gap, top = 40;
      const cols = 8, cell = Math.min(half / cols, (H - top - 50) / 8);
      tx('Virtual pages (what the process sees)', vx, 16, { m: 1, s: n ? 8.5 : 11, w: 700, a: 'left', c: C.violet });
      tx(`Physical RAM: ${F} frames`, px, 16, { m: 1, s: n ? 8.5 : 11, w: 700, a: 'left', c: C.a2 });
      const lastFlash = new Map(); for (const f of st.flash) lastFlash.set(f.p, f);
      for (let p = 0; p < VP; p++) {
        const x = vx + (p % cols) * cell, y = top + Math.floor(p / cols) * cell, inWS = p < s.p.ws;
        const fl = lastFlash.get(p), res = st.table[p] >= 0;
        const fill = fl ? (fl.fault ? C.bad : C.accent) : res ? C.a2 : C.bg;
        box(x + 1.5, y + 1.5, cell - 3, cell - 3, { r: 3, fill, stroke: inWS ? C.violet : C.line, lw: inWS ? 1.2 : 0.8 });
        if (cell > 26) tx(p, x + cell / 2, y + cell / 2, { m: 1, s: 9, w: 600, c: fl || res ? C.surface : C.muted });
      }
      const fcols = 8, fcell = Math.min(half / fcols, (H - top - 50) / 8);
      for (let f = 0; f < 64; f++) {
        const x = px + (f % fcols) * fcell, y = top + Math.floor(f / fcols) * fcell;
        if (f >= F) { alpha(0.35, () => box(x + 1.5, y + 1.5, fcell - 3, fcell - 3, { r: 3, fill: null, stroke: C.line, dash: [2, 3] })); continue; }
        const vp = st.frames[f], fl = st.flash.find(z => z.frame === f && z.fault);
        box(x + 1.5, y + 1.5, fcell - 3, fcell - 3, { r: 3, fill: fl ? C.bad : vp !== undefined ? C.surface : C.bg, stroke: C.a2 });
        if (vp !== undefined && fcell > 22) tx(vp, x + fcell / 2, y + fcell / 2, { m: 1, s: 9, w: 600, c: fl ? C.surface : C.ink });
      }
      // the latest access through the page table
      const last = st.flash[st.flash.length - 1];
      if (last && last.frame >= 0 && last.frame < F) {
        const a = { x: vx + (last.p % cols + 0.5) * cell, y: top + (Math.floor(last.p / cols) + 0.5) * cell };
        const b = { x: px + (last.frame % fcols + 0.5) * fcell, y: top + (Math.floor(last.frame / fcols) + 0.5) * fcell };
        alpha(0.7, () => line(a.x, a.y, b.x, b.y, last.fault ? C.bad : C.accent, last.fault ? 2 : 1.2));
      }
      const m = this.metrics(s), y = H - 22;
      tx(`page faults ${f1(m.rate * 100)}% of accesses  ·  effective access ${m.eat < 1000 ? Math.round(m.eat) + ' ns' : f1(m.eat / 1000) + ' µs'}  ·  ${m.slow < 10 ? f1(m.slow) : fmt(m.slow)}× slower than RAM`, x0, y, { m: 1, s: n ? 8.5 : 11, w: 700, a: 'left', c: m.rate > 0.05 ? C.bad : m.rate > 0.005 ? C.accent : C.good });
    },

    stats(s) {
      const st = s.st, m = this.metrics(s);
      return [
        ['Working set / RAM', `${s.p.ws} / ${s.p.frames} pages`, s.p.ws > s.p.frames ? 'warn' : 'good'],
        ['Hit rate', f1((1 - m.rate) * 100) + ' %', m.rate > 0.05 ? 'bad' : m.rate > 0.005 ? 'warn' : 'good'],
        ['Page faults (آخر 600 وصول)', fmt(st.hist.reduce((a, b) => a + b, 0))],
        ['زمن الوصول الفعلي', m.eat < 1000 ? Math.round(m.eat) + ' ns' : f1(m.eat / 1000) + ' µs', m.slow > 10 ? 'bad' : m.slow > 2 ? 'warn' : 'good'],
        ['أبطأ من RAM بـ', '× ' + (m.slow < 10 ? f1(m.slow) : fmt(m.slow)), m.slow > 10 ? 'bad' : '']
      ];
    }
  });

  Lab.registerLesson({
    id: 'paging', lab: 'os', title: 'Virtual Memory و Paging',
    html: Lab.tpl.lesson({
      sim: 'paging', level: 3,
      terms: ['Virtual Memory', 'Page', 'Page Table', 'Page Fault', 'LRU', 'Thrashing'],
      lede: 'الـ process شايف 64 صفحة (شمال)، والـ RAM فيها مكان لعدد محدود منهم (يمين). التركواز صفحة موجودة في الـ RAM، والبرتقالي وصول ناجح، والأحمر <b>page fault</b>: الصفحة مش في الـ RAM ولازم تتقري من الديسك وتطرد صفحة تانية (LRU). المخطط البنفسجي هو الـ working set.',
      aria: 'محاكاة virtual memory بصفحات و frames و LRU',
      controls: [
        { type: 'range', p: 'frames', label: 'حجم الـ RAM', min: 8, max: 64, step: 4, value: 32, unit: 'frames' },
        { type: 'range', p: 'ws', label: 'الصفحات اللي البرنامج بيستخدمها (working set)', min: 8, max: 64, step: 4, value: 40, unit: 'pages' },
        { type: 'seg', p: 'pattern', label: 'شكل الوصول', value: 'hot', opts: [['hot', 'hot set (80/20)'], ['loop', 'loop على الكل'], ['random', 'عشوائي']] }
      ],
      idea: `
        <p>الـ <b>Virtual Memory</b>: كل process فاكر إن عنده ذاكرة كبيرة متصلة لوحده. الذاكرة دي متقسمة <b>pages</b> (عادةً 4 KB)، والـ OS بيحتفظ بـ <b>Page Table</b> بتقول كل صفحة virtual موجودة في أنهي frame في الـ RAM الحقيقية، أو مش موجودة خالص.</p>
        <p>لو الصفحة مش في الـ RAM يحصل <b>Page Fault</b>: الـ OS يجيبها من الديسك (swap أو pagefile)، ولو مفيش مكان يطرد صفحة تانية. أشهر طريقة يختار بيها هي <b>LRU</b>: اطرد اللي بقاله أطول وقت مستخدمش. لو البرنامج محتاج صفحات أكتر من الـ RAM باستمرار، بيقضي وقته كله في الـ faults: ده اسمه <b>Thrashing</b>.</p>`,
      real: `
        <p>cache لنقط GPS في الذاكرة كبر لحد ما عدّى الـ RAM المتاحة للـ container أو للسيرفر. البرنامج مش هيقع على طول؛ هيبدأ يعمل page faults، وكل وصول للذاكرة كان 100 ns بقى ممكن يبقى 100 µs (أبطأ بألف مرة). الـ CPU شكله فاضي، والسيرفر بطيء جدًا، والـ GC بيبقى أسوأ لأنه بيلف على الـ heap كله.</p>`,
      try: 'ابدأ بـ hot set: حتى والـ working set أكبر من الـ RAM، الـ hit rate عالي لأن أغلب الوصول على صفحات قليلة. بعدين «loop على الكل» مع working set 40 وRAM 32: الـ LRU بيطرد بالظبط الصفحة اللي هتحتاجها بعد شوية، فكل وصول تقريبًا fault. كبّر الـ RAM لـ 40: فجأة الـ faults تبقى صفر.',
      also: 'قاعدة البيانات نفسها بتعمل نفس الحكاية مع الـ buffer pool (صفحات 8 KB بدل 4 KB)، والـ CDN وأي cache بـ LRU بيقعوا في نفس الفخ لو الداتا اللي بتتلف عليها أكبر من الـ cache بشوية.',
      net: `
<pre><span class="c">// الذاكرة اللي في الـ RAM فعلًا مقابل اللي الـ process حاجزها</span>
var p = Process.GetCurrentProcess();
Console.WriteLine($"WorkingSet={p.WorkingSet64 / 1_048_576} MB, Private={p.PrivateMemorySize64 / 1_048_576} MB");

<span class="c">// الـ GC عارف حد الـ container (cgroup) ومش هيعدّيه، بس الـ cache بتاعك لأ</span>
var gcInfo = GC.GetGCMemoryInfo();
Console.WriteLine($"available to GC: {gcInfo.TotalAvailableMemoryBytes / 1_048_576} MB");

<span class="c">// حط حد للـ cache بدل ما يكبر لحد ما الـ OS يبدأ يعمل paging</span>
var cache = new MemoryCache(new MemoryCacheOptions { SizeLimit = 50_000 });
cache.Set(vehicleId, point, new MemoryCacheEntryOptions { Size = 1 });   <span class="c">// مع SizeLimit كل entry لازم يحدد Size</span></pre>`,
      netTitle: 'في .NET',
      deep: [
        '<b>LRU مش دايمًا الأحسن:</b> في الـ loop على working set أكبر من الـ cache، LRU بيبقى أسوأ حاجة ممكنة (كل وصول fault). لو طردت عشوائي كان هيبقى أحسن. عشان كده الأنظمة الحقيقية بتستخدم تقريبات (Clock / second chance) وخوارزميات بتقاوم الـ scan (زي LRU-K أو 2Q في قواعد البيانات).',
        '<b>الـ TLB:</b> حتى الـ hit مش بيعدّي على الـ page table كل مرة؛ الـ CPU عنده cache صغير للترجمات (TLB). مع heap ضخم ووصول عشوائي، الـ TLB misses نفسها بتكلّف. عشان كده فيه Large Pages (2 MB) لقواعد البيانات والـ GC heaps الكبيرة.',
        '<b>Containers وLinux:</b> كتير من الـ containers مفيهاش swap، فبدل الـ thrashing الـ process بيتقتل (OOMKilled) لما يعدّي حد الذاكرة. ده أحسن من سيرفر بطيء جدًا، بس لازم تكون محسوب حسابه.',
        '<b>الأرقام:</b> الـ RAM حوالي 100 ns، وقراية 4 KB من NVMe حوالي 100 µs، ومن HDD حوالي 10 ms (مع seek). يعني fault واحد في الألف بيضاعف متوسط زمن الوصول.',
        '<b>تبسيطات:</b> 64 صفحة بس، وLRU مظبوط (الحقيقي بيقرّبه)، ومفيش تكلفة لكتابة الصفحة المطرودة لو اتعدّلت (dirty page) وده بيضاعف التكلفة في الحقيقة.'
      ]
    })
  });
})();
