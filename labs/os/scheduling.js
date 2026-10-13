/* OS · CPU Scheduling و Context Switch
   A small round-robin scheduler in simulated milliseconds:
     - "long" threads always have CPU work (a report, a map-matching batch)
     - short API requests arrive at random, each needs 2 ms of CPU
     - one FIFO ready queue; a core runs a thread for at most one quantum, then it goes to the back of the queue
     - switching a core to a different thread costs ~50 µs (save/restore registers + cold caches/TLB, approximate)
   The Gantt chart is the schedule that actually ran. Response times are measured per request (finish − arrival),
   overhead is the time cores spent switching. Simulated time runs at 40 ms per real second. */
(function () {
  "use strict";
  const { clamp, lerp, fmt, f1, expo } = Lab.util;
  const { box, tx, line, alpha } = Lab.draw;

  const QS = [0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];
  const SCALE = 40, TICK = 0.05, CS = 0.05, SHORT = 2, RATE = 0.12, VIEW = 240, KEEP = 2000;

  function init(s) {
    const cores = s.p.cores;
    const st = {
      now: 0, id: 0, ready: [], segs: [], resp: [], csTime: 0, busyTime: 0, switches: 0, nextArr: expo(RATE, s.rng),
      cores: Array.from({ length: cores }, () => ({ th: null, sliceEnd: 0, swEnd: 0, last: null }))
    };
    for (let i = 0; i < s.p.longs; i++) st.ready.push({ id: ++st.id, long: true, rem: Infinity, name: 'L' + (i + 1) });
    s.st = st;
  }
  function seg(st, c, kind, th) {
    const a = st.segs;
    // extend the core's current segment when nothing changed
    for (let i = a.length - 1; i >= Math.max(0, a.length - 8); i--) {
      const g = a[i];
      if (g.c === c) { if (g.kind === kind && g.th === th && Math.abs(g.e - st.now) < 1e-9) { g.e = st.now + TICK; return; } break; }
    }
    a.push({ c, s: st.now, e: st.now + TICK, kind, th });
  }

  function tick(s) {
    const st = s.st, q = QS[s.p.q];
    while (st.nextArr <= st.now) { st.ready.push({ id: ++st.id, long: false, rem: SHORT, arr: st.nextArr, name: 'R' }); st.nextArr += expo(RATE, s.rng); }
    st.cores.forEach((core, ci) => {
      if (!core.th && st.ready.length) {
        core.th = st.ready.shift();
        const sw = core.last !== core.th.id;
        core.swEnd = st.now + (sw ? CS : 0); core.sliceEnd = core.swEnd + q;
        if (sw) st.switches++;
      }
      const th = core.th;
      if (!th) { seg(st, ci, 'idle', null); return; }
      if (st.now < core.swEnd) { seg(st, ci, 'cs', null); st.csTime += TICK; return; }
      seg(st, ci, th.long ? 'long' : 'short', th.long ? th.name : 'R');
      st.busyTime += TICK;
      th.rem -= TICK; core.last = th.id;
      if (th.rem <= 1e-9) { st.resp.push([st.now + TICK, st.now + TICK - th.arr]); core.th = null; return; }
      if (st.now + TICK >= core.sliceEnd - 1e-9) {
        if (st.ready.length) { st.ready.push(th); core.th = null; }        // preempted: back of the queue
        else core.sliceEnd = st.now + TICK + q;                             // nobody waiting: keep running
      }
    });
    st.now += TICK;
    if (st.segs.length > KEEP) st.segs.splice(0, st.segs.length - KEEP);
    while (st.resp.length && st.resp[0][0] < st.now - 1000) st.resp.shift();
  }

  Lab.registerSim('scheduling', {
    height: 340, warm: 6,

    init(s) { init(s); },
    onParam(s) { init(s); },

    step(s, dt) {
      const target = s.st.now + dt * SCALE;
      let guard = 0;
      while (s.st.now < target && guard++ < 4000) tick(s);
    },

    rstats(s) {
      const r = s.st.resp.map(x => x[1]).sort((a, b) => a - b);
      const avg = r.length ? r.reduce((a, b) => a + b, 0) / r.length : 0;
      return { avg, p95: r.length ? r[Math.floor(r.length * 0.95)] : 0, n: r.length };
    },

    draw(s) {
      const C = s.C, st = s.st, W = s.w, H = s.h, n = s.narrow, q = QS[s.p.q];
      const x0 = n ? 40 : 60, x1 = W - 14, now = st.now, t0 = now - VIEW;
      const X = ms => lerp(x0, x1, (ms - t0) / VIEW);
      tx(`quantum ${q} ms · context switch ≈ ${CS * 1000} µs · last ${VIEW} ms`, 14, 14, { m: 1, s: n ? 9 : 11, w: 600, a: 'left', c: C.muted });
      const rows = st.cores.length, top = 34, rowH = Math.min(rows === 1 ? 90 : 52, (H - 150) / rows);
      st.cores.forEach((core, ci) => {
        const y = top + ci * rowH;
        tx(`core ${ci}`, 14, y + rowH / 2 - 4, { m: 1, s: n ? 9 : 10.5, w: 700, a: 'left' });
        box(x0, y + 4, x1 - x0, rowH - 12, { r: 4, fill: C.bg, stroke: C.line });
      });
      for (const g of st.segs) {
        if (g.e < t0) continue;
        const y = top + g.c * rowH + 4, h = rowH - 12, xa = Math.max(x0, X(g.s)), xb = X(g.e);
        if (xb - xa <= 0) continue;
        if (g.kind === 'idle') continue;
        const c = g.kind === 'cs' ? C.bad : g.kind === 'short' ? C.accent : C.violet;
        box(xa, y + (g.kind === 'cs' ? 0 : 2), Math.max(1, xb - xa), g.kind === 'cs' ? h : h - 4, { r: 1, fill: c, stroke: null });
        if (g.kind === 'long' && xb - xa > 26) tx(g.th, (xa + xb) / 2, y + h / 2, { m: 1, s: 9, w: 700, c: C.surface });
      }
      // ready queue
      const qy = top + rows * rowH + 34;
      tx('ready queue (next in line →)', 14, qy - 20, { m: 1, s: n ? 9 : 10.5, w: 700, a: 'left', c: C.muted });
      const shown = st.ready.slice(0, n ? 12 : 26);
      shown.forEach((th, i) => {
        const x = 14 + i * 26;
        box(x, qy - 10, 22, 20, { r: 4, fill: th.long ? C.violet : C.accent, stroke: null });
        tx(th.long ? th.name : 'R', x + 11, qy, { m: 1, s: 9, w: 700, c: C.surface });
      });
      if (st.ready.length > shown.length) tx(`+${st.ready.length - shown.length}`, 14 + shown.length * 26 + 6, qy, { m: 1, s: 10, a: 'left', c: C.muted });
      const rs = this.rstats(s), lyy = H - 22;
      tx(`short requests (2 ms CPU): avg response ${f1(rs.avg)} ms · p95 ${f1(rs.p95)} ms`, 14, lyy, { m: 1, s: n ? 9 : 11, w: 700, a: 'left', c: rs.p95 > 40 ? C.bad : rs.p95 > 10 ? C.accent : C.good });
    },

    stats(s) {
      const st = s.st, rs = this.rstats(s), total = st.csTime + st.busyTime;
      const over = total ? st.csTime / total * 100 : 0;
      return [
        ['Request: متوسط الاستجابة', f1(rs.avg) + ' ms', rs.avg > 20 ? 'bad' : rs.avg > 6 ? 'warn' : 'good'],
        ['Request: p95', f1(rs.p95) + ' ms', rs.p95 > 40 ? 'bad' : rs.p95 > 10 ? 'warn' : 'good'],
        ['وقت الـ CPU في context switch', f1(over) + ' %', over > 10 ? 'bad' : over > 3 ? 'warn' : 'good'],
        ['Context switches / ثانية', fmt(st.now ? st.switches / st.now * 1000 : 0)],
        ['Threads مستنية في الطابور', String(st.ready.length)]
      ];
    }
  });

  Lab.registerLesson({
    id: 'scheduling', lab: 'os', title: 'CPU Scheduling',
    html: Lab.tpl.lesson({
      sim: 'scheduling', level: 2,
      terms: ['Scheduler', 'Time Slice', 'Context Switch', 'Preemption', 'Ready Queue'],
      lede: 'scheduler صغير بيوزّع الـ cores على threads. البنفسجي threads شغلها طويل (تقرير، معالجة batch)، والبرتقالي requests قصيرة (2 ms CPU)، والأحمر الرفيع هو الـ context switch. الرسم هو الجدول اللي اتنفّذ فعلًا في آخر 240 ms.',
      aria: 'محاكاة round-robin scheduler بيوزّع cores على threads',
      controls: [
        { type: 'range', p: 'q', label: 'الـ quantum (time slice)', min: 0, max: 8, step: 1, value: 6, map: ['0.2', '0.5', '1', '2', '5', '10', '20', '50', '100'], unit: 'ms' },
        { type: 'seg', p: 'cores', label: 'عدد الـ cores', value: 1, opts: [[1, '1'], [2, '2'], [4, '4']] },
        { type: 'range', p: 'longs', label: 'threads شغلها طويل', min: 0, max: 6, step: 1, value: 2 }
      ],
      idea: `
        <p>عندك threads أكتر من الـ cores، فالـ OS بيعمل <b>Scheduling</b>: كل core بيشغّل thread لفترة (<b>quantum</b> أو time slice)، وبعدين يوقفه (<b>Preemption</b>) ويرجّعه آخر الطابور (<b>Ready Queue</b>) ويشغّل اللي عليه الدور.</p>
        <p>التبديل نفسه (<b>Context Switch</b>) مش ببلاش: لازم يحفظ registers الـ thread القديم ويحمّل الجديد، والأغلى إن الـ cache والـ TLB بيبقوا «باردين» للـ thread الجديد. quantum طويل = تبديل أقل بس الـ request القصير بيستنى ورا الطويلين. quantum قصير = استجابة أسرع بس وقت ضايع في التبديل.</p>`,
      real: `
        <p>سيرفر الـ API بيرد على تطبيق السواقين (request صغير، 2 ms)، وفي نفس الوقت بيشغّل job تقيلة بتحسب تقارير الرحلات. على core واحد، لو الـ quantum طويل، كل request بيستنى الـ job يخلّص الـ slice بتاعه، فالتطبيق بيهنّج رغم إن الـ CPU مش مشغول بحاجة مهمة.</p>`,
      try: 'على core واحد وthreadين طوال: quantum = 50 ms يخلّي الـ p95 بتاع الـ requests فوق 100 ms. نزّله لـ 2 ms: بينزل لحوالي 12 ms. نزّله لـ 0.2 ms: الأحمر بيملا الرسم، و20% من الـ CPU بيروح في الـ context switch، والاستجابة بتسوء تاني. بعدين خليه 4 cores: الـ requests بتلاقي core فاضي على طول.',
      also: 'game server بيحسب الفيزياء (شغل طويل) ويرد على حركة اللاعبين (شغل قصير)، والـ call center (المكالمة القصيرة متستناش ورا الطويلة)، وأي database بتشغّل تقرير تقيل جنب الـ transactions.',
      net: `
<pre><span class="c">// threads أكتر من الـ cores = الكل بيستنى دوره</span>
Console.WriteLine(Environment.ProcessorCount);

<span class="c">// شغل CPU طويل: متحطوش على الـ thread pool وسط الـ requests</span>
var report = Task.Factory.StartNew(BuildDailyReport, TaskCreationOptions.LongRunning);

<span class="c">// خفّض أولويته عشان الـ scheduler يفضّل الـ requests (استخدمها بحذر)</span>
var t = new Thread(BuildDailyReport) { Priority = ThreadPriority.BelowNormal };

<span class="c">// spin بدل ما تتنازل عن الـ core لو الانتظار قصير جدًا</span>
SpinWait.SpinUntil(() =&gt; ready, millisecondsTimeout: 1);</pre>`,
      netTitle: 'في .NET',
      deep: [
        '<b>الأرقام الحقيقية:</b> الـ context switch المباشر بالميكروثواني، بس التكلفة الحقيقية في الـ cache: الـ thread الجديد بيلاقي L1/L2 مليانين داتا غيره. على Windows الـ quantum حوالي 2 clock ticks على الـ client (~30 ms) وأطول على Windows Server. وLinux (CFS) معندوش quantum ثابت؛ بيقسم فترة قصيرة (بضع ميلي ثواني) على الـ threads الجاهزة بالعدل.',
        '<b>الـ OS مش round-robin بسيط:</b> فيه أولويات، وthread بيصحى من انتظار I/O بياخد boost مؤقت (عشان التطبيقات التفاعلية تبقى سريعة)، وفيه طابور لكل core مش طابور واحد. الفكرة الأساسية زي هنا بالظبط.',
        '<b>Thread pool في .NET:</b> لو عملت threads أكتر من الـ cores لشغل CPU، مش هتخلّص أسرع؛ هتضيف context switches بس. عشان كده الـ thread pool بيبدأ بعدد threads = عدد الـ cores، ومبيزوّدش إلا لو الـ threads بتستنى. شوف <a href="#/os/threadpool">Thread Pool و Starvation</a>.',
        '<b>Containers:</b> لو الـ container ليه CPU limit (مثلًا 0.5 core)، الـ Linux بيوقف الـ process لما يخلّص حصته في الفترة (CFS quota) حتى لو الـ core فاضي، وده بيعمل latency spikes غريبة. .NET بيقرا الـ limit ويضبط <code>ProcessorCount</code> عليه.',
        '<b>تبسيطات:</b> طابور واحد، من غير أولويات، والـ context switch 50 µs ثابت (شامل أثر الـ cache تقريبًا). الـ requests بتوصل عشوائي بمعدل 120 في الثانية.'
      ]
    })
  });
})();
