/* OS · Garbage Collector في .NET (generational)
   A small generational collector that actually runs on simulated objects:
     - objects are born in gen0; each has a lifetime (most die in milliseconds, a few are long-lived cache entries)
     - gen0 full  → gen0 GC: mark what is still alive, promote survivors to gen1, gen0 is empty again
     - gen1 over budget after a promotion → gen1 GC (gen0 + gen1), survivors go to gen2
     - gen2 over its budget (2× what survived the last full GC) → gen2 GC over everything, including the LOH
     - large objects (≥ 85,000 bytes) skip the generations and go to the LOH, freed only by gen2 GCs
   Pause = fixed cost + cost per surviving object (marking/copying is proportional to what lives, not to garbage).
   Counts, promotions and pauses come from the run; sizes and costs are scaled, illustrative numbers. */
(function () {
  "use strict";
  const { clamp, lerp, fmt, f1, expo } = Lab.util;
  const { box, tx, dot, line, alpha } = Lab.draw;

  const G0 = 120, G1 = 220, G2_MIN = 300, VIEW = 20;
  const COST = { base: [0.4, 1.2, 6], per: [0.03, 0.03, 0.025] };      // ms

  function fresh(s) {
    s.st = { now: 0, next: 0, nextL: 3, gens: [[], [], []], loh: [], g2budget: G2_MIN, events: [], counts: [0, 0, 0], pause: 0, promoted: 0, alloc: 0 };
  }
  function alive(o, now) { return o.die > now; }

  function collect(st, gen) {
    const now = st.now;
    // mark: everything still referenced in the collected generations survives
    let survivors = 0;
    const lives = [];
    for (let g = 0; g <= gen; g++) { lives[g] = st.gens[g].filter(o => alive(o, now)); survivors += lives[g].length; st.gens[g] = []; }
    // each survivor moves up exactly one generation (gen2 stays gen2)
    for (let g = 0; g <= gen; g++) { st.gens[Math.min(2, g + 1)].push(...lives[g]); if (g < 2) st.promoted += lives[g].length; }
    if (gen === 2) { st.loh = st.loh.filter(o => alive(o, now)); survivors += st.loh.length; st.g2budget = Math.max(G2_MIN, st.gens[2].length * 2); }
    const ms = COST.base[gen] + COST.per[gen] * survivors;
    st.events.push({ t: now, gen, ms, survivors });
    if (gen === 2) st.lastG2 = { ms, survivors };
    st.counts[gen]++; st.pause += ms;
    st.paused = now + ms / 1000;
  }

  Lab.registerSim('gc', {
    height: 380, warm: 8,

    init(s) { fresh(s); },
    onParam(s, k) { if (k === 'loh') return; },

    step(s, dt) {
      const st = s.st, rnd = s.rng;
      const end = st.now + dt;
      while (st.now < end) {
        const h = Math.min(0.01, end - st.now); st.now += h;
        if (st.paused && st.now < st.paused) continue;                // the app is stopped during a blocking GC
        st.next -= h * s.p.rate;
        while (st.next <= 0) {
          st.next += 1;
          const long = rnd() * 100 < s.p.longPct;
          const life = long ? 20 + rnd() * 160 : 0.01 + rnd() * rnd() * 0.4;
          st.gens[0].push({ die: st.now + life, long }); st.alloc++;
          if (st.gens[0].length >= G0) {
            // one GC, its generation decided up front from the older generations' budgets
            collect(st, st.gens[2].length > st.g2budget ? 2 : st.gens[1].length >= G1 ? 1 : 0);
          }
        }
        if (s.p.loh === 'on') {
          st.nextL -= h;
          if (st.nextL <= 0) { st.loh.push({ die: st.now + 0.5 + rnd() }); st.nextL = 0.8 + rnd() * 0.6; }
        }
      }
      st.events = st.events.filter(e => e.t > st.now - VIEW - 1);
    },

    draw(s) {
      const C = s.C, st = s.st, W = s.w, H = s.h, n = s.narrow, now = st.now;
      const x0 = 14, x1 = W - 14, cw = x1 - x0;
      const paused = st.paused && now < st.paused;
      tx(paused ? 'GC running: application threads paused' : 'application running: allocating', x0, 14, { m: 1, s: n ? 10 : 12, w: 700, a: 'left', c: paused ? C.bad : C.good });

      const region = (y, h, label, objs, cap, color) => {
        tx(label, x0, y - 7, { m: 1, s: n ? 9 : 10.5, w: 700, a: 'left', c: color });
        tx(`${objs.length}${cap ? ' / ' + cap : ''}`, x1, y - 7, { m: 1, s: n ? 9 : 10.5, a: 'right', c: C.muted });
        box(x0, y, cw, h, { r: 6, fill: C.bg, stroke: C.line });
        const per = Math.max(1, Math.floor(cw / 9)), rows = Math.max(1, Math.floor((h - 4) / 9));
        const max = per * rows, step = objs.length > max ? objs.length / max : 1;
        for (let i = 0, k = 0; i < objs.length && k < max; i += step, k++) {
          const o = objs[Math.floor(i)], x = x0 + 4 + (k % per) * 9, yy = y + 4 + Math.floor(k / per) * 9;
          box(x, yy, 7, 7, { r: 1.5, fill: alive(o, now) ? (o.long ? C.accent : color) : C.line, stroke: null });
        }
      };
      const top = 40;
      region(top, 30, 'gen0 (new objects)', st.gens[0], G0, C.a2);
      region(top + 56, 22, 'gen1', st.gens[1], G1, C.violet);
      region(top + 104, 48, 'gen2 (survived twice)', st.gens[2], st.g2budget, C.ink);
      if (s.p.loh === 'on') region(top + 178, 14, 'LOH (≥ 85 KB, only gen2 frees it)', st.loh, 0, C.bad);

      // pause timeline
      const ty = H - 54, th = 40, X = t => lerp(x0, x1, (t - (now - VIEW)) / VIEW);
      box(x0, ty, cw, th, { r: 6, fill: C.surface, stroke: C.line });
      tx(`GC pauses, last ${VIEW} s (height = pause length)`, x0, ty - 8, { m: 1, s: n ? 9 : 10, a: 'left', c: C.muted });
      const gc = [C.a2, C.violet, C.bad];
      for (const e of st.events) {
        const x = X(e.t), h = clamp(e.ms / 20 * th, 3, th - 4);
        box(x - 1.5, ty + th - 2 - h, 3, h, { r: 1, fill: gc[e.gen], stroke: null });
      }
      const g2 = st.lastG2;
      if (g2 && !n) tx(`last gen2: ${f1(g2.ms)} ms (${fmt(g2.survivors)} live objects to mark)`, x1, ty - 8, { m: 1, s: 10, w: 700, a: 'right', c: C.bad });
    },

    stats(s) {
      const st = s.st, pct = st.now ? st.pause / 1000 / st.now * 100 : 0;
      const g0 = st.events.filter(e => e.gen === 0).slice(-30), avg0 = g0.length ? g0.reduce((a, e) => a + e.ms, 0) / g0.length : 0;
      return [
        ['GCs: gen0 / gen1 / gen2', st.counts.join(' / ')],
        ['متوسط pause لـ gen0', f1(avg0) + ' ms', avg0 > 3 ? 'warn' : 'good'],
        ['آخر pause لـ gen2', st.lastG2 ? f1(st.lastG2.ms) + ' ms' : '—', 'bad'],
        ['% من الوقت في GC', f1(pct) + ' %', pct > 5 ? 'bad' : pct > 2 ? 'warn' : 'good'],
        ['اتعمل promote لـ gen أعلى', fmt(st.promoted)],
        ['objects حية في gen2 / LOH', `${fmt(st.gens[2].filter(o => alive(o, st.now)).length)} / ${st.loh.length}`]
      ];
    }
  });

  Lab.registerLesson({
    id: 'gc', lab: 'os', title: 'Garbage Collector في .NET',
    html: Lab.tpl.lesson({
      sim: 'gc', level: 2,
      terms: ['Garbage Collector', 'Gen 0 / 1 / 2', 'Promotion', 'LOH', 'GC Pause'],
      lede: 'كل مربع object. البرنامج بيعمل objects في gen0، أغلبها بيموت بسرعة (الرمادي = garbage)، والبرتقالي objects بتعيش طويل (cache). لما gen0 يتملي، الـ GC بيلم الحي ويرقّيه للجيل اللي بعده. تحت: كل GC وطول الـ pause بتاعه.',
      aria: 'محاكاة generational garbage collector بأجيال gen0 و gen1 و gen2',
      controls: [
        { type: 'range', p: 'rate', label: 'objects بتتعمل في الثانية', min: 50, max: 600, step: 25, value: 200 },
        { type: 'range', p: 'longPct', label: 'objects بتعيش طويل (cache)', min: 0, max: 20, step: 1, value: 3, unit: '%' },
        { type: 'seg', p: 'loh', label: 'arrays كبيرة (≥ 85 KB)', value: 'off', opts: [['off', 'لأ'], ['on', 'buffer كبير كل ثانية']] }
      ],
      idea: `
        <p>الـ <b>Garbage Collector</b> بيدوّر على الـ objects اللي محدش بيشاور عليها ويرجّع مكانها. الملاحظة اللي مبني عليها: <b>أغلب الـ objects بتموت صغيرة</b>. فالـ heap متقسم أجيال: <b>gen0</b> للجديد، ولو object عاش بعد GC بيتعمله <b>promotion</b> لـ <b>gen1</b>، ولو عاش تاني لـ <b>gen2</b>.</p>
        <p>الـ GC بيدوّر في gen0 كتير جدًا وبسرعة، لأن الشغل على قد اللي <b>عايش</b> مش اللي مات. gen2 فيه كل الداتا اللي عايشة فترة طويلة فـ GC بتاعه أغلى بكتير، ونادر. الـ objects الكبيرة (≥ 85,000 byte) بتروح الـ <b>LOH</b> على طول، ومبتتلمّش غير مع gen2.</p>`,
      real: `
        <p>كل رسالة GPS بتعمل objects مؤقتة (string، GpsPoint، lambda) بتموت بعد ميلي ثواني: gen0 بيلمّهم بسرعة في أقل من ميلي ثانية. المشكلة في الـ cache: كل آخر مكان لكل عربية بيعيش دقايق، بيتعمله promote لحد gen2، وبيكبّر gen2. ولما gen2 GC يجي، لازم يعدّي على كل العربيات في الـ cache.</p>`,
      try: 'سيبها على 3% وشوف الـ pauses الصغيرة التركواز (gen0) كل شوية. ارفع «objects بتعيش طويل» لـ 15%: gen2 بيكبر وبيظهر pause أحمر طويل. بعدين شغّل «buffer كبير كل ثانية»: الـ LOH بيتراكم ومبيتلمّش غير مع gen2. وارفع الـ objects في الثانية لـ 600: الـ gen0 GCs بتبقى أكتر بكتير.',
      also: 'الألعاب (GC pause في نص frame = تهنيج ملحوظ)، وأنظمة التداول (pause 50 ms ممكن يضيّع سعر)، وأي API عنده SLA على الـ p99: الـ gen2 pauses بتظهر في الـ p99 مش في المتوسط.',
      net: `
<pre><span class="c">// كام GC حصل لكل جيل؟ (مفيد في logs و metrics)</span>
Console.WriteLine($"gen0={GC.CollectionCount(0)} gen1={GC.CollectionCount(1)} gen2={GC.CollectionCount(2)}");
var info = GC.GetGCMemoryInfo();                      <span class="c">// آخر pause، الأحجام، fragmentation</span>

<span class="c">// buffer كبير متكرر = LOH. استخدم pool بدل ما تعمل واحد جديد كل مرة</span>
byte[] buf = ArrayPool&lt;byte&gt;.Shared.Rent(256 * 1024);
try { Fill(buf); } finally { ArrayPool&lt;byte&gt;.Shared.Return(buf); }</pre>
<pre><span class="c">&lt;!-- csproj: Server GC (heap لكل core، throughput أعلى) و Concurrent (gen2 في الخلفية) --&gt;</span>
&lt;ServerGarbageCollector&gt;true&lt;/ServerGarbageCollector&gt;
&lt;ConcurrentGarbageCollection&gt;true&lt;/ConcurrentGarbageCollection&gt;</pre>`,
      netTitle: 'في .NET',
      deep: [
        '<b>ليه gen0 رخيص؟</b> الـ GC بيبدأ من الـ roots (static fields، locals على الـ stacks، registers) ويعلّم كل اللي يوصله، فالتكلفة على قد الحي. لو 99% من gen0 garbage، الـ GC بيعدّي على 1% بس. بس إزاي يعرف إن object في gen2 بيشاور على object في gen0 من غير ما يعدّي على gen2 كله؟ بـ card table: الـ runtime بيعلّم الأماكن في gen2 اللي اتكتب فيها references جديدة.',
        '<b>Mid-life crisis:</b> أسوأ نمط: objects بتعيش ثواني (مش ميلي ثواني ومش ساعات). بتعدّي gen0 وgen1 وتوصل gen2 وتموت هناك، فتخلّي gen2 GCs تحصل. أمثلة: cache بـ expiry قصير، أو requests بطيئة شايلة objects كتير.',
        '<b>Background GC:</b> في .NET، الـ gen2 GC بيتعمل غالبًا في الخلفية (concurrent) والبرنامج شغال، فالـ pause الحقيقي أقصر من اللي هنا. الـ gen0 وgen1 دايمًا blocking. والـ LOH مش بيتعمله compact افتراضيًا، فممكن يتقطّع (fragmentation).',
        '<b>Server vs Workstation:</b> ASP.NET Core بيشغّل Server GC: heap وthread GC لكل core، gen0 أكبر بكتير (throughput أعلى، ذاكرة أكتر). Workstation GC أخف في الذاكرة. في container بذاكرة قليلة، Server GC ممكن ياكل أكتر من المتوقع.',
        '<b>تبسيطات:</b> كل الـ objects بنفس الحجم، وgen0 بيتملي عند 120 object وgen1 عند 60. الـ pause = تكلفة ثابتة + تكلفة لكل object حي، بأرقام توضيحية. الحقيقي: gen0 budget بالـ MBs وبيتغير ديناميكيًا.'
      ]
    })
  });
})();
