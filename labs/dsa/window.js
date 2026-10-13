/* DSA · Two Pointers / Sliding Window
   A stream of speed readings from one vehicle. Two real questions, each answered two ways as the stream advances:
     fixed window   "average speed of the last k readings"
                    naive: re-add the k values every step (k reads) · sliding: running sum + incoming − outgoing (2 ops)
     time window    "how many readings in the last 60 s?" (timestamps are irregular, so the window size varies)
                    naive: walk back from the newest until older than 60 s · two pointers: R moves on, L catches up
   Both pointers only ever move forward, so the sliding versions do O(n) work in total. Op counters are the code's. */
(function () {
  "use strict";
  const { clamp, lerp, fmt, f1 } = Lab.util;
  const { box, tx, dot, line, alpha, arrow } = Lab.draw;

  const RATE = 2.6, SPAN = 300, SHOW = 36;

  function genStream(s) {
    const rnd = s.rng, a = []; let t = 0, v = 60;
    for (let i = 0; i < SPAN; i++) {
      // irregular reporting: usually ~10 s, sometimes a burst of quick reports, sometimes a gap
      const r = rnd(); t += r < 0.15 ? 2 + rnd() * 3 : r > 0.92 ? 25 + rnd() * 20 : 7 + rnd() * 6;
      v = clamp(v + (60 - v) * 0.07 + (rnd() - 0.5) * 22 + (rnd() < 0.03 ? 40 : 0), 0, 140);   // drifts around city speed, occasional bursts
      a.push({ t: Math.round(t), v: Math.round(v) });
    }
    return a;
  }

  Lab.registerSim('window', {
    height: 360, warm: 0,

    init(s) { s.st = { a: genStream(s) }; this.reset(s); },
    onParam(s) { this.reset(s); },

    reset(s) {
      const st = s.st;
      Object.assign(st, { R: -1, L: 0, sum: 0, naive: 0, slide: 0, out: [], best: null, t0: s.t, lastStep: s.t, scan: 0, prevL: 0 });
    },

    /* advance R by one reading and update both methods for real */
    advance(s) {
      const st = s.st, a = st.a, k = s.p.k, mode = s.p.mode;
      if (st.R + 1 >= a.length) { this.reset(s); return; }
      const R = ++st.R;
      st.prevL = st.L;
      if (mode === 'fixed') {
        st.sum += a[R].v; st.slide++;
        if (R - st.L + 1 > k) { st.sum -= a[st.L].v; st.L++; st.slide++; }
        // naive: add up the whole window again
        let n = 0, sum = 0; for (let i = R; i >= Math.max(0, R - k + 1); i--) { sum += a[i].v; n++; }
        st.naive += n; st.scan = n;
        const val = st.sum / (R - st.L + 1);
        if (Math.abs(val - sum / n) > 1e-9) throw new Error('sliding sum drifted');
        st.out.push(val);
        if (R - st.L + 1 === k && (!st.best || val > st.best.v)) st.best = { v: val, L: st.L, R };
      } else {
        const W = k * 10;                                  // seconds
        st.slide++;                                        // R moved
        while (a[st.L].t <= a[R].t - W) { st.L++; st.slide++; }
        let n = 0, cnt = 0; for (let i = R; i >= 0; i--) { n++; if (a[i].t <= a[R].t - W) break; cnt++; }
        st.naive += n; st.scan = n;
        const val = R - st.L + 1;
        if (val !== cnt) throw new Error('two pointers disagree with the naive count');
        st.out.push(val);
        if (!st.best || val > st.best.v) st.best = { v: val, L: st.L, R };
      }
      st.lastStep = s.t;
    },

    step(s) {
      const st = s.st, want = Math.floor((s.t - st.t0) * RATE);
      while (st.R < want && st.R + 1 < st.a.length) this.advance(s);
      if (st.R + 1 >= st.a.length && s.t - st.lastStep > 2) { st.a = genStream(s); this.reset(s); }
    },

    draw(s) {
      const C = s.C, st = s.st, a = st.a, W = s.w, H = s.h, n = s.narrow, mode = s.p.mode, k = s.p.k;
      if (st.R < 0) return;
      const x0 = 14, x1 = W - 14, show = n ? 20 : SHOW;
      const first = Math.max(0, st.R - show + 3), cw = (x1 - x0) / show;
      const top = 54, bh = 120, base = top + bh;
      const q = mode === 'fixed' ? `average speed of the last ${k} readings` : `readings in the last ${k * 10} s`;
      tx(q, x0, 16, { m: 1, s: n ? 10 : 12, w: 700, a: 'left', c: C.accent });
      tx(`reading #${st.R + 1} of ${a.length}`, x1, 16, { m: 1, s: n ? 9 : 10.5, a: 'right', c: C.muted });

      // window band
      const wx0 = x0 + (st.L - first) * cw, wx1 = x0 + (st.R - first + 1) * cw;
      box(Math.max(x0, wx0), top - 6, wx1 - Math.max(x0, wx0), bh + 12, { r: 6, fill: null, stroke: C.violet, lw: 2 });
      alpha(0.1, () => box(Math.max(x0, wx0), top - 6, wx1 - Math.max(x0, wx0), bh + 12, { r: 6, fill: C.violet, stroke: null }));
      // naive rescan sweeping back over the window during this step
      const ph = clamp((s.t - st.lastStep) * RATE, 0, 1), scanTo = st.R - Math.floor(ph * (st.scan - 1));
      for (let i = first; i <= st.R; i++) {
        const x = x0 + (i - first) * cw, h = a[i].v / 140 * (bh - 14), inW = i >= st.L;
        const isNew = i === st.R, isOut = i < st.L && i >= st.prevL;
        const c = isNew ? C.accent : isOut ? C.bad : inW ? C.a2 : C.line;
        box(x + 1, base - h, cw - 2, h, { r: 2, fill: c, stroke: null });
        if (i >= scanTo && i <= st.R && ph < 1) alpha(0.9, () => dot(x + cw / 2, base + 8, 2.6, C.accent));
        if (cw > 22 && !n) tx(a[i].v, x + cw / 2, base - h - 7, { m: 1, s: 8.5, c: C.muted });
      }
      // pointers
      const lx = x0 + (st.L - first + 0.5) * cw, rx = x0 + (st.R - first + 0.5) * cw;
      if (st.L >= first) { arrow(lx, base + 34, lx, base + 18, C.violet, 1.6); tx('L', lx, base + 42, { m: 1, s: 10, w: 700, c: C.violet }); }
      else tx('◂ L', x0 + 8, base + 42, { m: 1, s: 10, w: 700, c: C.violet });
      arrow(rx, base + 34, rx, base + 18, C.accent, 1.6); tx('R', rx, base + 42, { m: 1, s: 10, w: 700, c: C.accent });
      tx(mode === 'time' ? `window = ${a[st.R].t - a[st.L].t} s span · ${st.R - st.L + 1} readings` : `window = ${st.R - st.L + 1} readings`, x0, 34, { m: 1, s: n ? 9 : 10.5, a: 'left', c: C.violet });

      // output series
      const oy0 = base + 60, oy1 = H - 12, out = st.out, from = Math.max(0, out.length - 120);
      const mx = Math.max(1, ...out.slice(from));
      box(x0, oy0, x1 - x0, oy1 - oy0, { r: 6, fill: C.surface, stroke: C.line });
      const X = s.ctx; X.beginPath();
      for (let i = from; i < out.length; i++) { const x = lerp(x0 + 6, x1 - 6, (i - from) / 119), y = lerp(oy1 - 6, oy0 + 14, out[i] / mx); if (i === from) X.moveTo(x, y); else X.lineTo(x, y); }
      X.strokeStyle = C.a2; X.lineWidth = 1.8; X.stroke();
      tx(mode === 'fixed' ? `avg = ${f1(out[out.length - 1])} km/h` : `count = ${out[out.length - 1]}`, x0 + 8, oy0 + 10, { m: 1, s: 10, w: 700, a: 'left', c: C.a2 });
    },

    stats(s) {
      const st = s.st, ratio = st.slide ? st.naive / st.slide : 0;
      return [
        ['قرايات لحد دلوقتي', fmt(Math.max(0, st.R + 1))],
        ['Naive: عمليات', fmt(st.naive), 'bad'],
        ['Sliding / Two Pointers: عمليات', fmt(st.slide), 'good'],
        ['Naive أغلى بـ', '× ' + f1(ratio), ratio > 5 ? 'bad' : ratio > 2 ? 'warn' : ''],
        [s.p.mode === 'fixed' ? 'أعلى متوسط لحد دلوقتي' : 'أكتر قرايات في شباك', st.best ? (s.p.mode === 'fixed' ? f1(st.best.v) + ' km/h' : String(st.best.v)) : '—']
      ];
    }
  });

  Lab.registerLesson({
    id: 'window', lab: 'dsa', title: 'Two Pointers / Sliding Window',
    html: Lab.tpl.lesson({
      sim: 'window', level: 2,
      terms: ['Sliding Window', 'Two Pointers', 'Running Sum', 'O(n)'],
      lede: 'قرايات سرعة عربية بتوصل واحدة ورا التانية. الشباك البنفسجي هو الجزء اللي بنحسب عليه، والمؤشرين <b>L</b> و <b>R</b> بيتحركوا لقدّام بس. النقط البرتقالي تحت هي الطريقة الساذجة وهي بتعيد قراية الشباك كله في كل خطوة.',
      aria: 'محاكاة sliding window على قرايات سرعة',
      controls: [
        { type: 'seg', p: 'mode', label: 'السؤال', value: 'fixed', opts: [['fixed', 'متوسط آخر k قراية'], ['time', 'عدد القرايات في آخر X ثانية']] },
        { type: 'range', p: 'k', label: 'حجم الشباك (k قراية أو k×10 ثانية)', min: 3, max: 30, step: 1, value: 12 }
      ],
      idea: `
        <p>كتير من الأسئلة على stream بتبقى «احسب حاجة على آخر جزء»: متوسط آخر 12 قراية، عدد الرسايل في آخر دقيقة. الطريقة الساذجة: كل ما قراية جديدة توصل، ارجع احسب الشباك من الأول، وده <code>O(n·k)</code>.</p>
        <p><b>Sliding Window</b>: احتفظ بالنتيجة (مثلًا مجموع الشباك)، ولما الشباك يتزحزح ضيف اللي دخل واطرح اللي خرج. <b>Two Pointers</b>: مؤشر <b>R</b> لآخر عنصر ومؤشر <b>L</b> لأول عنصر في الشباك، والاتنين بيمشوا لقدّام بس، فكل عنصر بيدخل مرة ويخرج مرة: <code>O(n)</code> في المجموع.</p>`,
      real: `
        <p>كشف السرعة الزايدة المستمرة: «متوسط آخر دقيقتين فوق 120» أهم من قراية واحدة عالية (ممكن تكون غلط GPS). وكشف جهاز بيبعت كتير: «أكتر من 30 رسالة في آخر دقيقة = جهاز فيه مشكلة أو حد بيعمل spam».</p>
        <p>النقط مش بتوصل كل 10 ثواني بالظبط، فشباك «آخر 60 ثانية» عدد عناصره بيتغير. هنا الـ Two Pointers بيكسب: L بيلحق R بالعدد اللي محتاجه بس.</p>`,
      try: 'شغّل «متوسط آخر k قراية» وكبّر k لـ 30: الـ Naive بيبقى أغلى بحوالي 15 مرة، والـ Sliding ثابت على عمليتين لكل قراية مهما كبر الشباك. بعدين «عدد القرايات في آخر X ثانية»: لاحظ إن الشباك بيضيق ويوسع مع الـ bursts والـ gaps في الإرسال.',
      also: 'الـ Rate Limiting (كام request في آخر دقيقة)، ومتوسط سعر السهم المتحرك (moving average)، وكشف الاحتيال (أكتر من 5 عمليات دفع في 10 دقايق)، وإحصائيات «آخر 5 دقايق» في أي dashboard.',
      net: `
<pre><span class="c">// Sliding window ثابت: running sum، O(1) لكل قراية</span>
var window = new Queue&lt;double&gt;(k);
double sum = 0;
void OnReading(double speed) {
    window.Enqueue(speed); sum += speed;
    if (window.Count &gt; k) sum -= window.Dequeue();
    double avg = sum / window.Count;
}

<span class="c">// شباك زمني: Two Pointers على Queue مترتبة بالوقت</span>
var recent = new Queue&lt;DateTime&gt;();
bool TooChatty(DateTime ts) {
    recent.Enqueue(ts);
    while (recent.Peek() &lt;= ts.AddSeconds(-60)) recent.Dequeue();   <span class="c">// L بيلحق</span>
    return recent.Count &gt; 30;
}</pre>
<pre><span class="c">-- في SQL Server: window function بتعمل نفس الحساب</span>
SELECT Ts, AVG(Speed) OVER (PARTITION BY VehicleId ORDER BY Ts
       ROWS BETWEEN 11 PRECEDING AND CURRENT ROW) AS Avg12
FROM GpsPoints;</pre>`,
      netTitle: 'في .NET و SQL Server',
      deep: [
        '<b>الـ float بيتراكم:</b> running sum بأرقام <code>double</code> بيجمع أخطاء تقريب مع ملايين الإضافات والطرح. لو الـ stream طويل جدًا، أعد حساب المجموع من الصفر كل فترة، أو استخدم <code>decimal</code> أو أعداد صحيحة (السرعة × 10).',
        '<b>مش كل حاجة بتتطرح:</b> المجموع والعدد سهل تطرح منهم. الـ max أو الـ min لأ: لو أكبر قيمة خرجت من الشباك محتاج تعرف التانية. الحل monotonic deque (طابور بيحتفظ بالمرشحين بس)، ولسه O(n).',
        '<b>Rate limiters:</b> الـ sliding window log (تخزين timestamps زي هنا) دقيق بس بياكل ذاكرة مع الحمل العالي. عشان كده أغلب الأنظمة بتستخدم sliding window counter (عدّادين لدقيقتين متتاليتين ونسبة بينهم) أو token bucket. .NET 7+ فيه <code>SlidingWindowRateLimiter</code> جاهز في <code>System.Threading.RateLimiting</code>.',
        '<b>RANGE مقابل ROWS:</b> في SQL Server، <code>ROWS BETWEEN 11 PRECEDING</code> شباك بالعدد. الشباك بالوقت (آخر 60 ثانية) مش مدعوم بـ <code>RANGE</code> و interval زي PostgreSQL، فبيتعمل بـ self-join أو في الكود.',
        '<b>تبسيطات:</b> 300 قراية لعربية واحدة. القرايات عادةً كل 7-13 ثانية، و15% منها بتيجي مستعجلة (bursts) و8% بعد انقطاع.'
      ]
    })
  });
})();
