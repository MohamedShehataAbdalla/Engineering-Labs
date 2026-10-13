/* System Design · Requirements و Back-of-the-envelope
   A calculator drawn as the system it sizes: devices → ingest → database → dashboards.
   Every number is arithmetic on the inputs plus a few stated assumptions:
     writes/s        = vehicles / interval;   peak = × peak factor
     inbound         = writes/s × (point size + ~80 B of TCP/IP/TLS framing)
     storage / day   = writes/day × point size × 1.5 (indexes + page fill, rough) × replicas
     ingest servers  = ⌈peak / 20,000 msg/s per server⌉ + 1 spare (N+1)
     DB write nodes  = ⌈peak / 15,000 batched inserts/s per node⌉   (order-of-magnitude assumption)
     dashboards      = users × 1 refresh / 5 s of a 200-vehicle view
   The dots only illustrate flow; their speed is logarithmic in the real rate. */
(function () {
  "use strict";
  const { clamp, lerp, fmt, f1 } = Lab.util;
  const { box, tx, dot, arrow, alpha } = Lab.draw;

  const VEH = [1e3, 1e4, 1e5, 1e6], RET = [7, 30, 90, 365, 730];
  const PER_INGEST = 20000, PER_DB = 15000, FRAME = 80, IDX = 1.5;

  function calc(p) {
    const v = VEH[p.veh], w = v / p.every, peak = w * p.peak, ret = RET[p.ret];
    const inBps = w * (p.size + FRAME) * 8, perDay = w * 86400, dayBytes = perDay * p.size * IDX * p.rep;
    const total = dayBytes * ret, ingest = Math.ceil(peak / PER_INGEST) + 1, db = Math.max(1, Math.ceil(peak / PER_DB));
    const reads = p.users / 5;
    return { v, w, peak, inBps, perDay, dayBytes, total, ingest, db, reads, ret };
  }
  const bytes = b => b >= 1e15 ? f1(b / 1e15) + ' PB' : b >= 1e12 ? f1(b / 1e12) + ' TB' : b >= 1e9 ? f1(b / 1e9) + ' GB' : f1(b / 1e6) + ' MB';
  const bps = b => b >= 1e9 ? f1(b / 1e9) + ' Gbit/s' : b >= 1e6 ? f1(b / 1e6) + ' Mbit/s' : f1(b / 1e3) + ' kbit/s';
  const num = x => x >= 1e9 ? f1(x / 1e9) + 'B' : x >= 1e6 ? f1(x / 1e6) + 'M' : x >= 1e4 ? fmt(x / 1e3) + 'K' : fmt(x);

  Lab.registerSim('estimation', {
    height: 360, warm: 0,
    init(s) { s.st = { c: calc(s.p) }; },
    onParam(s) { s.st.c = calc(s.p); },
    step() {},

    draw(s) {
      const C = s.C, c = s.st.c, W = s.w, H = s.h, n = s.narrow, t = s.t;
      const cols = n ? [W * 0.14, W * 0.42, W * 0.72] : [W * 0.11, W * 0.36, W * 0.62, W * 0.88];
      const cy = 120, bw = n ? 92 : 150, bh = 92;
      const boxes = [
        ['devices', `${num(c.v)} vehicles`, `every ${s.p.every} s`, C.accent],
        ['ingest', `${c.ingest} servers`, `${num(c.w)}/s · peak ${num(c.peak)}/s`, C.violet],
        ['database', `${c.db} write node${c.db > 1 ? 's' : ''}`, `${bytes(c.dayBytes)}/day`, C.a2]
      ];
      if (!n) boxes.push(['dashboards', `${num(s.p.users)} users`, `${num(c.reads)} reads/s`, C.good]);
      boxes.forEach(([title, big, small, col], i) => {
        const x = cols[i] - bw / 2;
        box(x, cy - bh / 2, bw, bh, { r: 10, fill: C.surface, stroke: col, lw: 2 });
        tx(title, cols[i], cy - 28, { m: 1, s: n ? 9 : 10.5, w: 700, c: col });
        tx(big, cols[i], cy - 4, { m: 1, s: n ? 11 : 15, w: 700, c: C.ink });
        tx(small, cols[i], cy + 20, { m: 1, s: n ? 8 : 9.5, c: C.muted });
        if (i) {
          const x0 = cols[i - 1] + bw / 2 + 4, x1 = x - 4;
          alpha(0.4, () => arrow(x0, cy, x1, cy, C.line, 1.4));
          // flow dots: speed ~ log of the rate on that edge
          const rate = i === 3 ? c.reads : c.w, sp = 0.15 + Math.log10(Math.max(10, rate)) * 0.12, k = 6;
          for (let j = 0; j < k; j++) { const ph = ((t * sp) + j / k) % 1; dot(lerp(x0, x1, ph), cy + (i === 3 ? 0 : 0), 3, i === 3 ? C.good : C.accent); }
        }
      });
      // the arithmetic, spelled out
      const lines = [
        `${num(c.v)} ÷ ${s.p.every} s = ${num(c.w)} writes/s  ·  × ${s.p.peak} peak = ${num(c.peak)}/s`,
        `inbound: ${num(c.w)}/s × (${s.p.size} + ${FRAME}) B = ${bps(c.inBps)}`,
        `per day: ${num(c.perDay)} points × ${s.p.size} B × ${IDX} (indexes) × ${s.p.rep} copies = ${bytes(c.dayBytes)}`,
        `kept ${c.ret} days → ${bytes(c.total)} on disk`,
        `ingest: ⌈${num(c.peak)} ÷ ${num(PER_INGEST)}⌉ + 1 spare = ${c.ingest}  ·  DB writes: ⌈${num(c.peak)} ÷ ${num(PER_DB)}⌉ = ${c.db}`
      ];
      lines.forEach((l, i) => tx(l, 14, 196 + i * 28, { m: 1, s: n ? 8 : 11, w: i === 3 ? 700 : 500, a: 'left', c: i === 3 ? (c.total > 1e14 ? C.bad : C.ink) : C.ink }));
      tx('assumptions are rough on purpose: the goal is the order of magnitude', 14, H - 10, { m: 1, s: n ? 7.5 : 9.5, a: 'left', c: C.muted });
    },

    stats(s) {
      const c = s.st.c;
      return [
        ['Writes / ث (متوسط · ذروة)', `${num(c.w)} · ${num(c.peak)}`, c.peak > 2e5 ? 'bad' : c.peak > 2e4 ? 'warn' : 'good'],
        ['داتا داخلة', bps(c.inBps)],
        ['تخزين في اليوم', bytes(c.dayBytes)],
        [`تخزين ${c.ret} يوم`, bytes(c.total), c.total > 1e14 ? 'bad' : c.total > 1e13 ? 'warn' : ''],
        ['Ingest servers / DB write nodes', `${c.ingest} / ${c.db}`, c.db > 4 ? 'warn' : '']
      ];
    }
  });

  Lab.registerLesson({
    id: 'estimation', lab: 'system-design', title: 'Back-of-the-envelope',
    html: Lab.tpl.lesson({
      sim: 'estimation', level: 1,
      terms: ['Requirements', 'Back-of-the-envelope', 'QPS', 'Peak', 'Capacity Planning'],
      lede: 'قبل أي رسم معماري: كام request في الثانية؟ كام GB في اليوم؟ كام سيرفر؟ حرّك الأرقام والنظام نفسه بيتحسب قدامك، وكل سطر تحت بيوريك الحسبة بالظبط.',
      aria: 'حاسبة تقدير الحمل والتخزين لنظام تتبع',
      controls: [
        { type: 'range', p: 'veh', label: 'عدد العربيات', min: 0, max: 3, step: 1, value: 1, map: ['1K', '10K', '100K', '1M'] },
        { type: 'range', p: 'every', label: 'نقطة كل', min: 1, max: 60, step: 1, value: 10, unit: 's' },
        { type: 'range', p: 'size', label: 'حجم النقطة', min: 40, max: 400, step: 20, value: 100, unit: 'B' },
        { type: 'range', p: 'ret', label: 'الاحتفاظ بالداتا', min: 0, max: 4, step: 1, value: 2, map: ['7 أيام', '30 يوم', '90 يوم', 'سنة', 'سنتين'] },
        { type: 'range', p: 'rep', label: 'نسخ (replicas)', min: 1, max: 3, step: 1, value: 2 },
        { type: 'range', p: 'peak', label: 'الذروة × المتوسط', min: 1, max: 5, step: 0.5, value: 3 },
        { type: 'range', p: 'users', label: 'مستخدمين dashboard في نفس الوقت', min: 100, max: 50000, step: 100, value: 2000 }
      ],
      idea: `
        <p><b>Requirements</b> نوعين: functional (النظام بيعمل إيه) وnon-functional (كام، وبأي سرعة، وإيه نسبة التوقف المسموحة). قبل ما تختار أي تقنية، احسب الأرقام بالتقريب على ورقة (<b>Back-of-the-envelope</b>): الـ <b>QPS</b>، والـ bandwidth، والتخزين، وعدد الأجهزة.</p>
        <p>المهم الـ order of magnitude: 1,000 في الثانية ولا 100,000؟ ده بيفرق بين سيرفر واحد وcluster. وصمّم على الـ <b>Peak</b> مش المتوسط: الساعة 8 الصبح كل العربيات بتتحرك مرة واحدة.</p>`,
      real: `
        <p>10,000 عربية كل 10 ثواني = 1,000 write في الثانية، وده سيرفر SQL واحد بيستحمله مرتاح. 100,000 عربية كل ثانية = 100,000 في الثانية، والذروة 300,000: محتاج تجميع (batching)، وqueue، وغالبًا قاعدة بيانات time-series أو sharding. ونفس الحسبة بتقولك إن الاحتفاظ بالداتا سنتين بدل 90 يوم بيضرب التخزين في 8.</p>`,
      try: 'ابدأ بـ 10K عربية كل 10 ثواني: 1,000 write في الثانية وأرقام صغيرة. خليها 1M كل ثانية: مليون في الثانية وكل حاجة بتتغير. بعدين ارجع لـ 100K وغيّر الاحتفاظ من 90 يوم لسنتين: التخزين بيتضرب في 8. وجرّب تقلل حجم النقطة من 100 لـ 40 byte (binary بدل JSON): التخزين بيقل 60%، بس الـ bandwidth بيقل الثلث بس، لأن الـ headers ثابتة.',
      also: 'منصة دفع (عمليات في الثانية وقت العروض)، وتطبيق شات (رسايل × مستخدمين × تخزين سنين)، ولعبة (لاعبين في نفس الوقت × updates في الثانية)، وbilling في الاتصالات (CDRs في اليوم).',
      net: `
<pre><span class="c">// أرقام لازم تكون في دماغك (order of magnitude)</span>
<span class="c">// L1 cache       ~1 ns      ·  RAM            ~100 ns</span>
<span class="c">// SSD read       ~100 µs    ·  Network same DC ~0.5 ms</span>
<span class="c">// Cross-region   ~50-150 ms ·  ثانية = 1e9 ns</span>
<span class="c">// يوم ≈ 86,400 ث ≈ 1e5      ·  شهر ≈ 2.6M ث    ·  سنة ≈ 31.5M ث</span>

<span class="c">// اكتبها كـ test عشان الأرقام تفضل قدامك وانت بتصمم</span>
const long Vehicles = 100_000; const int IntervalSec = 10;
var writesPerSec = Vehicles / IntervalSec;               <span class="c">// 10,000</span>
var bytesPerDay  = writesPerSec * 86_400L * 100 * 1.5;   <span class="c">// ~130 GB لنسخة واحدة</span></pre>`,
      netTitle: 'أرقام وحسابات',
      deep: [
        '<b>الافتراضات هي الشغل:</b> سيرفر ingest بيستحمل 20,000 رسالة في الثانية؟ قاعدة البيانات 15,000 insert؟ دي أرقام لازم تتقاس على الـ hardware والكود بتوعك (load test). الحاسبة بتوريك الأرقام دي بتأثر قد إيه، مش قيمتها الحقيقية.',
        '<b>N+1 والـ headroom:</b> لو محتاج 4 سيرفرات للذروة، اعمل 5 عشان واحد يقع أو يتعمله deploy. ومتشغلش أي حاجة فوق 60-70% في الذروة، لأن الـ latency بيتضاعف قرب الـ 100% (شوف <a href="#/dsa/stack-queue">Stack و Queue</a>).',
        '<b>الـ reads غالبًا أكتر:</b> هنا الـ writes هي الحمل الأساسي (IoT). في أنظمة تانية (e-commerce) الـ reads أضعاف الـ writes، والتصميم بيتمحور حوالين الـ cache والـ replicas بدل الـ write path.',
        '<b>التخزين بيكبر للأبد:</b> الـ writes ثابتة بس التخزين بيتراكم. خطة الاحتفاظ (hot لـ 30 يوم، cold مضغوط بعد كده، وحذف بعد سنتين) بتوفّر أضعاف أي تحسين تاني.',
        '<b>تبسيطات:</b> 80 byte framing لكل رسالة، و×1.5 للـ indexes، و20K/15K لكل سيرفر، كلها افتراضات تقريبية للتوضيح.'
      ]
    })
  });
})();
