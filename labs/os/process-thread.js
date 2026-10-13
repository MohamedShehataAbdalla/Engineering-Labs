/* OS · Process vs Thread
   The same GPS ingest work done two ways:
     threads    one process, N worker threads, one shared in-memory cache (direct writes)
     processes  N processes with one worker each; the cache lives in its own process and every update crosses a
                pipe (serialize + copy + context switch), so each message costs more CPU
   Messages wait in an external queue (the socket / broker), workers take the next one when free.
   "Bad message" throws an unhandled exception inside one worker: in the threads model the whole process dies with all
   of its in-flight work and restarts; in the processes model only that one process does.
   Throughput, lost messages and downtime come from the run. Memory and costs are rough, labelled approximations. */
(function () {
  "use strict";
  const { clamp, lerp, fmt, f1, expo, Meter } = Lab.util;
  const { box, tx, dot, ring, line, arrow, alpha } = Lab.draw;

  const SVC = 0.2, IPC = 1.35, RESTART = 3, PROC_MB = 40, THREAD_MB = 0.15;

  Lab.registerSim('process-thread', {
    height: 360, warm: 4,

    init(s) {
      const n = s.p.n;
      s.st = {
        q: [], next: s.t + expo(s.p.rate, s.rng), id: 0, done: new Meter(5), lost: 0, dropped: 0, downtime: 0, crashes: 0, flash: [],
        workers: Array.from({ length: n }, (_, i) => ({ i, cur: null, end: 0, deadUntil: 0 }))
      };
    },
    onParam(s, k) { if (k === 'n' || k === 'mode') this.init(s); },

    /** which workers die together: the whole process in the threads model, one worker otherwise */
    act: {
      crash(s) {
        const st = s.st, alive = st.workers.filter(w => s.t >= w.deadUntil);
        if (!alive.length) return;
        const hit = alive[Math.floor(s.rng() * alive.length)];
        const victims = s.p.mode === 'threads' ? st.workers : [hit];
        for (const w of victims) { if (w.cur) { st.lost++; w.cur = null; } w.deadUntil = s.t + RESTART; }
        st.crashes++; st.flash.push({ t: s.t, i: hit.i });
      }
    },

    step(s, dt) {
      const st = s.st, t = s.t, svc = SVC * (s.p.mode === 'processes' ? IPC : 1);
      while (st.next <= t) { st.q.push({ id: ++st.id, t: st.next }); st.next += expo(s.p.rate, s.rng); }
      if (st.q.length > 400) { st.dropped += st.q.length - 400; st.q.splice(0, st.q.length - 400); }   // socket buffer full
      let down = 0;
      for (const w of st.workers) {
        if (t < w.deadUntil) { down++; continue; }
        if (w.cur && t >= w.end) { st.done.add(t); w.cur = null; }
        if (!w.cur && st.q.length) { w.cur = st.q.shift(); w.end = t + svc * (0.7 + s.rng() * 0.6); }
      }
      st.downtime += dt * down / st.workers.length;
      st.flash = st.flash.filter(f => t - f.t < 1.2);
    },

    draw(s) {
      const C = s.C, st = s.st, t = s.t, W = s.w, H = s.h, n = s.narrow, procs = s.p.mode === 'processes';
      const x0 = 14, x1 = W - 14, N = st.workers.length;
      // incoming queue
      const qx = x0, qw = n ? 54 : 90, qy = 46, qh = H - 70;
      box(qx, qy, qw, qh, { r: 8, fill: C.surface, stroke: C.line });
      tx('socket queue', qx + qw / 2, qy - 10, { m: 1, s: 9.5, c: C.muted });
      const shown = Math.min(st.q.length, 40);
      for (let i = 0; i < shown; i++) dot(qx + 10 + (i % (n ? 4 : 7)) * 11, qy + qh - 10 - Math.floor(i / (n ? 4 : 7)) * 11, 3.5, C.accent);
      tx(fmt(st.q.length), qx + qw / 2, qy + 14, { m: 1, s: 12, w: 700, c: st.q.length > 50 ? C.bad : C.ink });

      // workers area
      const ax = qx + qw + 26, aw = x1 - ax - (n ? 0 : 130), cacheX = x1 - 110;
      const laneH = Math.min(46, (H - 80) / N);
      const ly = i => 56 + i * laneH + (procs ? i * 4 : 0);
      if (!procs) {
        const dead = t < st.workers[0].deadUntil, fl = st.flash.length;
        box(ax - 10, 34, aw + 20, N * laneH + 34, { r: 10, fill: dead ? C.bg : C.surface, stroke: dead || fl ? C.bad : C.violet, lw: 2 });
        tx(dead ? `process crashed: restarting ${f1(st.workers[0].deadUntil - t)}s` : `1 process · ${N} threads · ~${Math.round(PROC_MB + N * THREAD_MB)} MB`, ax, 24, { m: 1, s: n ? 9.5 : 11, w: 700, a: 'left', c: dead ? C.bad : C.violet });
      } else tx(`${N} processes · 1 thread each · ~${N * PROC_MB} MB`, ax, 24, { m: 1, s: n ? 9.5 : 11, w: 700, a: 'left', c: C.violet });

      st.workers.forEach((w, i) => {
        const y = ly(i), dead = t < w.deadUntil, h = laneH - 10;
        if (procs) box(ax - 6, y - 4, aw + 12, h + 8, { r: 8, fill: dead ? C.bg : C.surface, stroke: dead ? C.bad : C.violet, lw: 1.6 });
        box(ax, y, aw, h, { r: 6, fill: C.bg, stroke: C.line });
        tx(procs ? `P${i + 1}` : `T${i + 1}`, ax + 8, y + h / 2, { m: 1, s: 10, w: 700, a: 'left', c: dead ? C.bad : C.violet });
        if (dead) { tx(procs ? `crashed · restart ${f1(w.deadUntil - t)}s` : '✕', ax + aw / 2, y + h / 2, { m: 1, s: 10, w: 700, c: C.bad }); return; }
        if (w.cur) {
          const k = 1 - (w.end - t) / (SVC * (procs ? IPC : 1));
          box(ax + 30, y + 4, (aw - 40) * clamp(k, 0, 1), h - 8, { r: 4, fill: C.accent, stroke: null });
          if (procs && k > 0.72) alpha(0.9, () => box(ax + 30 + (aw - 40) * 0.72, y + 4, (aw - 40) * (clamp(k, 0, 1) - 0.72), h - 8, { r: 4, fill: C.violet, stroke: null }));
        } else tx('idle', ax + aw / 2, y + h / 2, { m: 1, s: 9, c: C.muted });
        alpha(0.4, () => arrow(qx + qw + 4, y + h / 2, ax - 8, y + h / 2, C.line, 1));
      });

      // the cache: shared memory inside the process, or its own process behind pipes
      if (!n) {
        const cy = 56, ch = Math.min(120, N * laneH);
        box(cacheX, cy, 96, ch, { r: 8, fill: C.surface, stroke: procs ? C.violet : C.a2, lw: 1.6 });
        tx('last-location', cacheX + 48, cy + 16, { m: 1, s: 9.5, w: 700, c: C.a2 });
        tx('cache', cacheX + 48, cy + 30, { m: 1, s: 9.5, w: 700, c: C.a2 });
        tx(procs ? 'own process' : 'shared memory', cacheX + 48, cy + ch - 12, { m: 1, s: 9, c: C.muted });
        st.workers.forEach((w, i) => {
          if (!w.cur || t < w.deadUntil) return;
          const y = ly(i) + (laneH - 10) / 2;
          alpha(0.55, () => line(ax + aw + (procs ? 6 : 0), y, cacheX, cy + ch / 2, procs ? C.violet : C.a2, procs ? 1.6 : 1, procs ? [4, 3] : null));
        });
        if (procs) tx('pipe: serialize + copy', cacheX + 48, cy + ch + 14, { m: 1, s: 9, c: C.violet });
      }
    },

    stats(s) {
      const st = s.st, procs = s.p.mode === 'processes';
      const cap = st.workers.length / (SVC * (procs ? IPC : 1));
      return [
        ['Throughput (رسالة/ث)', f1(st.done.rate(s.t)), ''],
        ['أقصى طاقة نظريًا', f1(cap) + ' /s', cap < s.p.rate ? 'bad' : 'good'],
        ['رسايل في الطابور', fmt(st.q.length), st.q.length > 50 ? 'bad' : st.q.length > 10 ? 'warn' : 'good'],
        ['رسايل ضاعت في الـ crash', fmt(st.lost), st.lost ? 'bad' : ''],
        ['ذاكرة تقريبًا', procs ? `${st.workers.length * PROC_MB} MB` : `${Math.round(PROC_MB + st.workers.length * THREAD_MB)} MB`],
        ['Crashes / اتشالت لأن الطابور اتملى', `${st.crashes} / ${fmt(st.dropped)}`, st.dropped ? 'bad' : '']
      ];
    }
  });

  Lab.registerLesson({
    id: 'process-thread', lab: 'os', title: 'Process vs Thread',
    html: Lab.tpl.lesson({
      sim: 'process-thread', level: 1,
      terms: ['Process', 'Thread', 'Shared Memory', 'IPC', 'Isolation'],
      lede: 'نفس شغل استقبال رسايل الـ GPS بطريقتين: process واحد جوّاه كذا thread بيشاركوا cache واحد في الذاكرة، أو كذا process كل واحد بـ thread، والـ cache في process لوحده بيكلموه عن طريق pipe. اضغط «رسالة بايظة» وشوف الـ crash بيوقع إيه.',
      aria: 'محاكاة workers كـ threads جوه process واحد مقابل processes منفصلة',
      acts: [['crash', 'رسالة بايظة (crash)']],
      controls: [
        { type: 'seg', p: 'mode', label: 'الشكل', value: 'threads', opts: [['threads', 'process واحد، threads كتير'], ['processes', 'processes كتير']] },
        { type: 'range', p: 'n', label: 'عدد الـ workers', min: 2, max: 8, step: 1, value: 4 },
        { type: 'range', p: 'rate', label: 'الرسايل الداخلة', min: 4, max: 30, step: 1, value: 12, unit: '/s' }
      ],
      idea: `
        <p>الـ <b>Process</b> برنامج شغّال ليه مساحة ذاكرة لوحده: الـ OS بيمنع أي process إنه يلمس ذاكرة process تاني. الـ <b>Thread</b> مسار تنفيذ جوه الـ process: كل thread ليه stack وregisters، بس كل الـ threads في نفس الـ process بيشوفوا نفس الـ heap.</p>
        <p>عشان كده الـ threads بيتكلموا ببساطة (نفس الـ object في الذاكرة) بس بيقعوا مع بعض: exception مش متمسكة في أي thread بتقفل الـ process كله. والـ processes معزولين (<b>Isolation</b>): واحد يقع والباقي شغال، بس الكلام بينهم <b>IPC</b> (pipe، socket) فيه serialize ونسخ وتكلفة.</p>`,
      real: `
        <p>سيرفر الـ GPS في .NET هو process واحد بالـ thread pool جوّاه، وكل الـ threads بتكتب في نفس <code>ConcurrentDictionary</code> لآخر مكان كل عربية. سريع ومن غير نسخ. لكن رسالة جهاز واحد بايظة تعمل exception في thread من غير catch = السيرفر كله يقع، و10,000 عربية تختفي من الخريطة لحد ما يقوم.</p>`,
      try: 'سيبها على «process واحد» واضغط «رسالة بايظة»: كل الـ threads وقفت، والطابور بيتراكم 3 ثواني. بدّل لـ «processes كتير» واضغط تاني: worker واحد بس وقع. بس لاحظ «أقصى طاقة نظريًا» نزلت، لأن كل رسالة بتعدي على pipe (البنفسجي في آخر الشغل)، وارفع الرسايل لـ 16: الـ threads لسه ملاحقين، والـ processes الطابور عندهم بيكبر من غير ما يقف.',
      also: 'Chrome بيشغّل كل tab في process عشان tab واحدة بايظة متوقعش المتصفح. وبوابات الدفع بتفصل الجزء اللي بيلمس بيانات الكروت في process (أو container) لوحده. وفي الألعاب، كل match بتبقى process أو container لوحدها.',
      net: `
<pre><span class="c">// threads جوه نفس الـ process: نفس الـ object، من غير نسخ</span>
static readonly ConcurrentDictionary&lt;long, GpsPoint&gt; Last = new();
await Parallel.ForEachAsync(messages, async (m, ct) =&gt; Last[m.VehicleId] = Parse(m));

<span class="c">// exception مش متمسكة في أي thread = الـ process كله بيقع</span>
new Thread(() =&gt; throw new FormatException("bad packet")).Start();

<span class="c">// process تاني: ذاكرة منفصلة، والكلام عن طريق IPC</span>
using var p = Process.Start(new ProcessStartInfo("Ingest.Worker.exe") { RedirectStandardInput = true });
await p.StandardInput.WriteLineAsync(JsonSerializer.Serialize(msg));   <span class="c">// serialize + copy</span></pre>`,
      netTitle: 'في .NET',
      deep: [
        '<b>التكلفة بالأرقام (تقريب):</b> إنشاء thread عشرات الميكروثواني، وstack محجوز 1 MB على Windows بس المستخدم فعلًا صغير. إنشاء process .NET جديد عشرات لمئات الميلي ثواني (تحميل الـ runtime والـ JIT)، وذاكرة بالعشرات من الـ MB. عشان كده بنعيد استخدام الـ threads (thread pool) وما بنعملش process لكل request.',
        '<b>الـ crash في .NET:</b> من .NET 2.0 أي unhandled exception في أي thread بتقفل الـ process. الحل مش إنك تمسك كل حاجة وتكمّل؛ الحل تمسك الـ exception عند حدود كل رسالة (try/catch في الـ consumer loop)، وتبعت الرسالة البايظة لـ dead letter.',
        '<b>Isolation في الحقيقة:</b> الإنتاج غالبًا بيجمع الاتنين: كذا instance (processes أو containers) ورا load balancer، وكل instance جوّاه threads كتير. الـ crash بيوقّع instance واحد بس، والـ orchestrator (Kubernetes) بيقوّمه.',
        '<b>الـ cache المشترك بين processes:</b> لما تفصل processes، الـ <code>ConcurrentDictionary</code> مبقاش ينفع. إما كل process عنده نسخة (ومش متطابقين)، أو الـ cache بره (Redis) وكل قراية بقت network call. ده نفس الـ trade-off في <a href="#/system-design/stateless">Stateless vs Stateful</a>.',
        '<b>تبسيطات:</b> الـ restart 3 ثواني وتكلفة الـ pipe +35% أرقام توضيحية. الذاكرة: حوالي 40 MB لكل process .NET صغير و0.15 MB لكل thread، وده تقريب للـ working set مش قياس.'
      ]
    })
  });
})();
