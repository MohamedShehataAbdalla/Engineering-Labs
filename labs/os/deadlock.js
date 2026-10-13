/* OS · Deadlock (inside one process)
   Worker threads move delivery jobs between drivers. Each driver's job list has its own lock, so a transfer needs
   two locks: the source driver's and the destination driver's. The model is a real lock table + wait-for graph:
     naive    lock(from) then lock(to): T1 does A→B while T2 does B→A → each holds what the other wants
     ordered  always lock the lower driver id first: a cycle in the wait-for graph becomes impossible
     timeout  Monitor.TryEnter(to, timeout): on failure release what you hold, back off a random time, retry
   Unlike SQL Server, .NET has no deadlock monitor: once the wait-for graph has a cycle those threads wait forever.
   Here, after 4 s stuck, the "process" is restarted so the run can continue. Counters come from the run. */
(function () {
  "use strict";
  const { clamp, lerp, fmt, f1 } = Lab.util;
  const { box, tx, dot, circ, line, arrow, alpha } = Lab.draw;

  const HOLD = 0.35, WORK = 0.45, THINK = 0.25, TIMEOUT = 0.6, STUCK_RESTART = 4;
  const NAMES = 'ABCDEF';

  function fresh(s) {
    const T = s.p.threads, K = s.p.drivers;
    s.st = {
      owner: new Array(K).fill(-1), done: 0, deadlocks: 0, retries: 0, restarts: 0, stuckSince: 0, cycle: [],
      th: Array.from({ length: T }, (_, i) => ({ i, state: 'think', until: 0.2 + i * 0.15, a: -1, b: -1, holds: [], wantLock: -1, waitStart: 0 }))
    };
  }
  function plan(s, t) {
    const K = s.p.drivers;
    const from = Math.floor(s.rng() * K); let to = Math.floor(s.rng() * (K - 1)); if (to >= from) to++;
    t.from = from; t.to = to;
    if (s.p.mode === 'ordered') { t.a = Math.min(from, to); t.b = Math.max(from, to); } else { t.a = from; t.b = to; }
    t.state = 'want1'; t.wantLock = t.a; t.waitStart = s.t;
  }
  function release(st, t) { for (const l of t.holds) st.owner[l] = -1; t.holds = []; }

  /** threads in a wait-for cycle (thread → owner of the lock it wants → …) */
  function findCycle(st) {
    for (const start of st.th) {
      const seen = []; let cur = start;
      while (cur && cur.wantLock >= 0 && (cur.state === 'want1' || cur.state === 'want2')) {
        const o = st.owner[cur.wantLock];
        if (o < 0) break;
        if (seen.includes(cur.i)) return seen.slice(seen.indexOf(cur.i));
        seen.push(cur.i); cur = st.th[o];
      }
    }
    return [];
  }

  Lab.registerSim('deadlock', {
    height: 380, warm: 0,
    init(s) { fresh(s); },
    onParam(s) { fresh(s); },

    step(s) {
      const st = s.st, t = s.t, mode = s.p.mode;
      for (const th of st.th) {
        if (th.state === 'think' && t >= th.until) plan(s, th);
        if (th.state === 'want1' || th.state === 'want2') {
          const l = th.wantLock;
          if (st.owner[l] < 0) {
            st.owner[l] = th.i; th.holds.push(l);
            if (th.state === 'want1') { th.state = 'hold1'; th.until = t + HOLD; }
            else { th.state = 'work'; th.until = t + WORK; }
            th.wantLock = -1;
          } else if (mode === 'timeout' && th.state === 'want2' && t - th.waitStart > TIMEOUT) {
            // TryEnter failed: give back the first lock and retry later
            release(st, th); st.retries++;
            th.state = 'think'; th.until = t + 0.1 + s.rng() * 0.5; th.wantLock = -1;
          }
        }
        if (th.state === 'hold1' && t >= th.until) { th.state = 'want2'; th.wantLock = th.b; th.waitStart = t; }
        if (th.state === 'work' && t >= th.until) { release(st, th); st.done++; th.state = 'think'; th.until = t + THINK * (0.5 + s.rng()); }
      }
      const cyc = findCycle(st);
      if (cyc.length && !st.cycle.length) { st.stuckSince = t; st.counted = false; }
      // a cycle that lasts is a deadlock (in timeout mode TryEnter breaks it first)
      if (cyc.length && !st.counted && t - st.stuckSince > 1) { st.deadlocks++; st.counted = true; }
      st.cycle = cyc;
      if (cyc.length && t - st.stuckSince > STUCK_RESTART) { const keep = { done: st.done, deadlocks: st.deadlocks, retries: st.retries, restarts: st.restarts + 1 }; fresh(s); Object.assign(s.st, keep); for (const th of s.st.th) th.until = t + 0.3 + th.i * 0.15; }
    },

    draw(s) {
      const C = s.C, st = s.st, W = s.w, H = s.h, n = s.narrow, K = s.p.drivers, T = st.th.length;
      const cx = W / 2, cy = H / 2 + 6, R = Math.min(W * 0.32, H * 0.36), lr = Math.min(R * 0.95, 70);
      const lockPos = k => ({ x: cx + Math.cos(-Math.PI / 2 + k / K * Math.PI * 2) * lr, y: cy + Math.sin(-Math.PI / 2 + k / K * Math.PI * 2) * lr });
      const thPos = i => ({ x: cx + Math.cos(-Math.PI / 2 + (i + 0.5) / T * Math.PI * 2) * (R + 40), y: cy + Math.sin(-Math.PI / 2 + (i + 0.5) / T * Math.PI * 2) * (R * 0.95 + 20) });
      const inCycle = new Set(st.cycle);
      const cycTxt = st.cycle.map(i => 'T' + (i + 1)).join(' → ');
      tx(!st.cycle.length ? 'transfers running' : s.p.mode === 'timeout' ? `cycle ${cycTxt}: TryEnter will time out and back off` : `DEADLOCK: ${cycTxt} → … wait forever (restart in ${f1(Math.max(0, STUCK_RESTART - (s.t - st.stuckSince)))}s)`, 14, 14, { m: 1, s: n ? 9 : 11.5, w: 700, a: 'left', c: st.cycle.length ? C.bad : C.good });
      // edges: holds (lock → thread), waits (thread → lock)
      for (const th of st.th) {
        const p = thPos(th.i);
        for (const l of th.holds) { const q = lockPos(l); line(q.x, q.y, p.x, p.y, C.a2, 2.4); }
        if (th.wantLock >= 0) {
          const q = lockPos(th.wantLock), bad = inCycle.has(th.i);
          const ang = Math.atan2(q.y - p.y, q.x - p.x);
          arrow(p.x, p.y, q.x - Math.cos(ang) * 22, q.y - Math.sin(ang) * 22, bad ? C.bad : C.accent, bad ? 2.4 : 1.6, [5, 4]);
        }
      }
      for (let k = 0; k < K; k++) {
        const q = lockPos(k), o = st.owner[k];
        dot(q.x, q.y, 20, C.surface); circ(q.x, q.y, 20, o >= 0 ? C.violet : C.line, 2.2);
        tx(NAMES[k], q.x, q.y, { m: 1, s: 13, w: 700, c: o >= 0 ? C.violet : C.muted });
      }
      for (const th of st.th) {
        const p = thPos(th.i), bad = inCycle.has(th.i), w = n ? 62 : 92, h = 38;
        box(p.x - w / 2, p.y - h / 2, w, h, { r: 8, fill: C.surface, stroke: bad ? C.bad : th.state === 'work' ? C.a2 : th.state.startsWith('want') ? C.accent : C.line, lw: bad ? 2.4 : 1.4 });
        tx(`T${th.i + 1}`, p.x, p.y - 8, { m: 1, s: 10, w: 700, c: bad ? C.bad : C.ink });
        const what = th.state === 'think' ? 'idle' : `${NAMES[th.from]}→${NAMES[th.to]}${th.state === 'work' ? ' ✓' : ''}`;
        tx(what, p.x, p.y + 8, { m: 1, s: 9, c: C.muted });
      }
    },

    stats(s) {
      const st = s.st, waiting = st.th.filter(t => t.state.startsWith('want')).length;
      return [
        ['Transfers خلصت', fmt(st.done), 'good'],
        ['Deadlocks حصلت', String(st.deadlocks), st.deadlocks ? 'bad' : 'good'],
        ['Restarts (مفيش حد بيكسرها)', String(st.restarts), st.restarts ? 'bad' : ''],
        ['Threads مستنية lock دلوقتي', `${waiting} / ${st.th.length}`, waiting === st.th.length ? 'bad' : waiting ? 'warn' : 'good'],
        ['Retries بعد timeout', String(st.retries), st.retries ? 'warn' : '']
      ];
    }
  });

  Lab.registerLesson({
    id: 'deadlock', lab: 'os', title: 'Deadlock',
    html: Lab.tpl.lesson({
      sim: 'deadlock', level: 2,
      terms: ['Deadlock', 'Wait-for Graph', 'Lock Ordering', 'Monitor.TryEnter'],
      lede: 'threads بتنقل طلبات توصيل من سواق لسواق. كل سواق ليه lock (الدواير في النص)، والنقل محتاج الاتنين. الخط التركواز = ماسك الـ lock، والسهم المتقطع = مستنيه. لما الأسهم تعمل دايرة يبقى <b>deadlock</b>: محدش هيتحرك تاني.',
      aria: 'محاكاة deadlock بين threads ماسكين locks',
      controls: [
        { type: 'seg', p: 'mode', label: 'ترتيب أخد الـ locks', value: 'naive', opts: [['naive', 'from ثم to'], ['ordered', 'الأصغر id الأول'], ['timeout', 'TryEnter + timeout']] },
        { type: 'range', p: 'threads', label: 'عدد الـ threads', min: 2, max: 6, step: 1, value: 4 },
        { type: 'range', p: 'drivers', label: 'عدد السواقين (locks)', min: 2, max: 6, step: 1, value: 3 }
      ],
      idea: `
        <p><b>Deadlock</b>: T1 ماسك A ومستني B، وT2 ماسك B ومستني A. محدش هيسيب اللي في إيده، فالاتنين هيستنوا للأبد. الشروط الأربعة: lock مبيتشاركش، اللي ماسك حاجة بيستنى حاجة تانية، محدش بياخد lock غصب، والانتظار دايرة.</p>
        <p>الـ <b>Wait-for Graph</b>: سهم من كل thread للـ thread اللي ماسك اللي هو مستنيه. لو فيه دايرة، فيه deadlock. أبسط علاج يكسر شرط الدايرة: <b>Lock Ordering</b>، كل الكود ياخد الـ locks بنفس الترتيب. أو تستخدم <b>timeout</b>: لو مقدرتش تاخد التاني، سيب الأول وجرّب بعدين.</p>`,
      real: `
        <p>تحويل طلب من سواق لسواق: <code>lock(from) { lock(to) { ... } }</code>. في نفس اللحظة dispatcher بيحوّل طلب من أحمد لمحمد، وdispatcher تاني من محمد لأحمد. على الـ dev مش هيحصل أبدًا، وفي الإنتاج تحت الحمل بيحصل مرة في الأسبوع: الـ threads دي بتقف للأبد، والـ API بيبدأ يعمل timeout لحد ما حد يعمل restart.</p>`,
      try: 'سيبها على «from ثم to» واستنى الدايرة الحمرا: الـ threads اللي فيها وقفت خالص. بعدين «الأصغر id الأول»: نفس الحمل ومفيش deadlock نهائيًا. و«TryEnter + timeout»: مفيش تعليق، بس فيه retries (شغل ضايع). وقلّل السواقين لـ 2 وزوّد الـ threads: الـ deadlock بيحصل أسرع.',
      also: 'تحويل فلوس بين حسابين في بنك (A→B و B→A في نفس الوقت)، وحجز مقعدين في نفس الرحلة، ولاعبين بيتبادلوا items في لعبة.',
      net: `
<pre><span class="c">// ❌ الترتيب بيعتمد على اتجاه التحويل</span>
lock (from.Gate) lock (to.Gate) Move(job, from, to);

<span class="c">// ✓ ترتيب ثابت لكل الكود: الأصغر id الأول</span>
var (first, second) = from.Id &lt; to.Id ? (from, to) : (to, from);
lock (first.Gate) lock (second.Gate) Move(job, from, to);

<span class="c">// ✓ أو timeout: متستناش للأبد</span>
if (Monitor.TryEnter(to.Gate, TimeSpan.FromMilliseconds(200)))
    try { Move(job, from, to); } finally { Monitor.Exit(to.Gate); }
else { /* سيب اللي معاك، استنى شوية، وجرّب تاني */ }

<span class="c">// async: lock مبيشتغلش مع await، استخدم SemaphoreSlim(1) بنفس الترتيب</span></pre>`,
      netTitle: 'في .NET',
      deep: [
        '<b>.NET مش هيكتشفها:</b> SQL Server عنده deadlock monitor بيختار ضحية (خطأ 1205، شوف <a href="#/databases/locking">Locking</a>). الـ CLR معندوش؛ الـ threads بتفضل واقفة. هتلاقيها في memory dump: <code>dotnet-dump analyze</code> ثم <code>syncblk</code> بيوريك مين ماسك إيه.',
        '<b>Deadlocks مستخبية:</b> <code>.Result</code> في تطبيق فيه SynchronizationContext (WinForms، WPF، ASP.NET القديم) بيعمل deadlock مع thread واحد بس: الـ continuation محتاجة نفس الـ thread اللي واقف. وفيه callback أو event بيتنده وانت ماسك lock ويحاول ياخد lock تاني.',
        '<b>Timeout مش حل كامل:</b> لو كل الـ threads عملت timeout وجربت تاني في نفس اللحظة، ممكن يفضلوا يتخانقوا من غير ما حد يخلّص (livelock). عشان كده الـ backoff لازم يبقى عشوائي.',
        '<b>أحسن lock هو اللي مش موجود:</b> لو كل الشغل على سواق معيّن بيتعمل في thread أو channel واحد (partitioning)، مش محتاج locks خالص. ده نفس فكرة الـ actor model وOrleans.',
        '<b>تبسيطات:</b> الأوقات ثابتة تقريبًا، والـ restart بعد 4 ثواني موجود عشان التجربة تكمّل؛ في الحقيقة مفيش حاجة هتفك الـ deadlock غير restart.'
      ]
    })
  });
})();
