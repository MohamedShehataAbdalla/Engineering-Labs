/* Databases · Locking / Blocking / Deadlock (victim + error 1205)
   Real lock manager: each session runs "UPDATE row a; UPDATE row b; COMMIT" holding exclusive (X) locks to the end.
   A lock that is taken puts you in a FIFO wait queue (blocking). A deadlock monitor wakes up periodically, builds the
   wait-for graph, finds cycles and kills the cheapest session in each cycle (fewest locks held → least to roll back). */
(function () {
  "use strict";
  const { clamp, lerp, fmt, f1, Meter } = Lab.util;
  const { box, tx, dot, circ, ring, line, arrow, alpha } = Lab.draw;

  const MONITOR = 1.5;           // sim seconds between deadlock searches (SQL Server: 5 s by default)

  Lab.registerSim('locking', {
    height: 340, warm: 4,
    init(s) {
      s.st = { sess: [], locks: {}, nextMon: MONITOR, commits: new Meter(6), dl: 0, dlMeter: new Meter(30), waits: [], victims: [], cycle: null, cycleAt: -9 };
      this.sync(s);
    },
    onParam(s, k) { if (k === 'sessions' || k === 'rows') this.init(s); },

    sync(s) {
      const st = s.st;
      for (let i = 0; i < s.p.sessions; i++) st.sess.push({ id: 51 + i, state: 'idle', next: s.rng() * 1.2, plan: null, k: 0, holds: [], want: null, waitT0: 0, until: 0, err: -9, t0: 0 });
      for (let r = 1; r <= s.p.rows; r++) st.locks[r] = { owner: null, q: [] };
    },

    plan(s, se) {
      const R = s.p.rows; let a = 1 + Math.floor(s.rng() * R), b = 1 + Math.floor(s.rng() * (R - 1)); if (b >= a) b++;
      if (s.p.order === 'sorted' && a > b) [a, b] = [b, a];
      se.plan = [a, b]; se.k = 0; se.holds = []; se.t0 = s.t; se.state = 'acquire';
    },

    release(s, se) {
      const st = s.st;
      for (const r of se.holds) {
        const lk = st.locks[r]; lk.owner = null;
        const nx = lk.q.shift();
        if (nx) { lk.owner = nx; nx.holds.push(r); nx.want = null; nx.state = 'work'; nx.until = s.t + this.hold(s); st.waits.push(s.t - nx.waitT0); if (st.waits.length > 40) st.waits.shift(); }
      }
      se.holds = []; se.want = null;
    },
    hold(s) { return s.p.hold * (0.6 + s.rng() * 0.8); },

    step(s) {
      const st = s.st, t = s.t;
      for (const se of st.sess) {
        if (se.state === 'idle' && t >= se.next) this.plan(s, se);
        if (se.state === 'acquire') {
          const r = se.plan[se.k], lk = st.locks[r];
          if (!lk.owner) { lk.owner = se; se.holds.push(r); se.state = 'work'; se.until = t + this.hold(s); }
          else { lk.q.push(se); se.want = r; se.state = 'wait'; se.waitT0 = t; }
        } else if (se.state === 'work' && t >= se.until) {
          se.k++;
          if (se.k < 2) se.state = 'acquire';
          else { this.release(s, se); st.commits.add(t); se.state = 'idle'; se.next = t + 0.3 + s.rng() * 0.8; }
        }
      }
      if (t >= st.nextMon) { st.nextMon = t + MONITOR; this.monitor(s); }
    },

    monitor(s) {
      const st = s.st;
      // wait-for graph: waiting session → owner of the row it wants
      const next = se => se.state === 'wait' ? st.locks[se.want].owner : null;
      for (const start of st.sess) {
        if (start.state !== 'wait') continue;
        const path = []; let cur = start, guard = 0;
        while (cur && guard++ < 20) {
          const i = path.indexOf(cur);
          if (i >= 0) {
            const cyc = path.slice(i);
            // victim: least work to roll back (fewest locks held), newest transaction on ties
            const victim = cyc.slice().sort((a, b) => a.holds.length - b.holds.length || b.t0 - a.t0)[0];
            st.dl++; st.dlMeter.add(s.t); st.cycle = cyc.map(x => x.id); st.cycleAt = s.t;
            const lk = st.locks[victim.want]; lk.q = lk.q.filter(x => x !== victim);
            this.release(s, victim);
            victim.state = 'idle'; victim.err = s.t; victim.next = s.t + 0.9;
            st.victims.push(victim.id);
            return this.monitor(s);           // look again: one kill can leave other cycles
          }
          path.push(cur); cur = next(cur);
        }
      }
    },

    draw(s) {
      const st = s.st, C = s.C, n = s.narrow, W = s.w, H = s.h, t = s.t;
      const R = s.p.rows, N = st.sess.length;
      const rx = W * (n ? 0.24 : 0.3), sx = W * (n ? 0.64 : 0.7);
      const ry = r => 30 + (H - 70) * (r - 0.5) / R, sy = i => 30 + (H - 70) * (i + 0.5) / N;
      const rw = n ? 78 : 120, rh = Math.min(36, (H - 70) / R - 8);
      const inCycle = id => st.cycle && t - st.cycleAt < 1.2 && st.cycle.includes(id);

      tx('Vehicles (rows)', rx, 12, { m: 1, s: 10, c: C.muted });
      tx('Sessions', sx, 12, { m: 1, s: 10, c: C.muted });
      // holds (solid) and waits (dashed arrows)
      st.sess.forEach((se, i) => {
        for (const r of se.holds) line(sx - 18, sy(i), rx + rw / 2, ry(r), inCycle(se.id) ? C.bad : C.a2, 3);
        if (se.state === 'wait') arrow(sx - 18, sy(i) + 4, rx + rw / 2 + 4, ry(se.want) + 6, inCycle(se.id) ? C.bad : C.muted, 1.6, [6, 4]);
      });
      for (let r = 1; r <= R; r++) {
        const lk = st.locks[r], y = ry(r);
        box(rx - rw / 2, y - rh / 2, rw, rh, { r: 6, stroke: lk.owner ? C.a2 : C.line, lw: lk.owner ? 1.8 : 1 });
        tx('Id ' + r, rx - rw / 2 + 8, y, { m: 1, s: 11, w: 700, a: 'left' });
        if (lk.owner) tx('X:' + lk.owner.id, rx + rw / 2 - 6, y, { m: 1, s: 10, w: 700, a: 'right', c: C.bad });
        if (lk.q.length && !n) tx(`queue ${lk.q.map(x => x.id).join(',')}`, rx - rw / 2 - 6, y, { m: 1, s: 9, c: C.muted, a: 'right' });
      }
      st.sess.forEach((se, i) => {
        const y = sy(i), r = Math.min(16, (H - 70) / N / 2 - 2);
        const col = se.state === 'wait' ? C.bad : se.state === 'work' || se.state === 'acquire' ? C.good : C.muted;
        dot(sx, y, r, C.surface); circ(sx, y, r, col, 1.8);
        if (se.state === 'wait') ring(sx, y, r + 4, clamp((t - se.waitT0) / 4, 0, 1), C.bad, 2.5);
        tx(String(se.id), sx, y, { m: 1, s: 10, w: 700 });
        const lbl = se.state === 'wait' ? `${n ? 'wait' : 'waiting'} ${f1(t - se.waitT0)}s` : se.state === 'idle' ? (t - se.err < 1 ? '' : 'idle') : `${n ? '' : 'UPDATE '}Id ${se.plan[se.k]}`;
        tx(lbl, sx + r + 8, y, { m: 1, s: n ? 9 : 10, a: 'left', c: col });
        if (t - se.err < 1.2) alpha(1 - (t - se.err) / 1.2, () => tx('✗ 1205 victim', sx + r + 8, y, { m: 1, s: 10, w: 700, a: 'left', c: C.bad }));
      });
      if (st.cycle && t - st.cycleAt < 1.2) alpha(1 - (t - st.cycleAt) / 1.2, () => {
        box(W / 2 - 70, H / 2 - 16, 140, 32, { r: 8, fill: C.surface, stroke: C.bad, lw: 2 });
        tx('DEADLOCK', W / 2, H / 2, { m: 1, s: 14, w: 700, c: C.bad });
      });
      tx(`deadlock monitor: next check in ${f1(Math.max(0, st.nextMon - t))}s`, 14, H - 12, { m: 1, s: 9, c: C.muted, a: 'left' });
    },

    stats(s) {
      const st = s.st, t = s.t;
      const blocked = st.sess.filter(x => x.state === 'wait');
      const longest = blocked.length ? Math.max(...blocked.map(x => t - x.waitT0)) : 0;
      const avgW = st.waits.length ? st.waits.reduce((a, b) => a + b, 0) / st.waits.length : 0;
      return [
        ['Commits', f1(st.commits.rate(t)) + ' tx/s', 'good'],
        ['Sessions blocked دلوقتي', `${blocked.length} / ${st.sess.length}`, blocked.length > st.sess.length / 2 ? 'bad' : blocked.length ? 'warn' : 'good'],
        ['أطول انتظار حالي', f1(longest) + ' s', longest > 2 ? 'bad' : longest > 0.8 ? 'warn' : ''],
        ['متوسط وقت الـ blocking', f1(avgW) + ' s'],
        ['Deadlocks (error 1205)', fmt(st.dl), st.dl ? 'bad' : 'good']
      ];
    }
  });

  Lab.registerLesson({
    id: 'locking', lab: 'databases', title: 'Locking و Blocking و Deadlock',
    html: Lab.tpl.lesson({
      sim: 'locking', level: 3,
      terms: ['Lock', 'Blocking', 'Deadlock', 'Victim', 'Error 1205'],
      lede: 'كل session بتعدّل صفين في transaction واحدة وبتمسك X lock على كل صف لحد الـ COMMIT. الخط التركواز يعني «ماسك»، والسهم المتقطع يعني «مستني». كل 1.5 ثانية الـ deadlock monitor بيدور على دايرة انتظار.',
      aria: 'محاكاة lock manager مع blocking و deadlock detection',
      controls: [
        { type: 'range', p: 'sessions', label: 'Sessions شغالة مع بعض', min: 2, max: 8, step: 1, value: 4 },
        { type: 'range', p: 'rows', label: 'عدد الصفوف الساخنة', min: 2, max: 8, step: 1, value: 4 },
        { type: 'range', p: 'hold', label: 'وقت كل UPDATE جوه الـ transaction', min: 0.2, max: 2, step: 0.1, value: 0.8, unit: 's' },
        { type: 'seg', p: 'order', label: 'ترتيب تعديل الصفوف', value: 'random', opts: [['random', 'أي ترتيب'], ['sorted', 'دايمًا بالـ Id']] }
      ],
      idea: `
        <p>عشان transaction متعدّلش صف وأنت بتعدّله، SQL Server بيحط <b>Lock</b>. التعديل بياخد <b>X lock</b> (exclusive) لحد آخر الـ transaction. لو session تانية عايزة نفس الصف بتستنى في طابور، وده اسمه <b>Blocking</b>. الـ blocking طبيعي، المشكلة لما يطول.</p>
        <p>الـ <b>Deadlock</b> دايرة: A ماسك صف 1 ومستني صف 2، و B ماسك صف 2 ومستني صف 1. محدش هيكمّل أبدًا. SQL Server عنده <b>deadlock monitor</b> بيدور على الدواير، ولما يلاقي واحدة بيختار <b>victim</b> (اللي rollback بتاعه أرخص)، يلغي الـ transaction بتاعته ويرجّعله <b>error 1205</b>، والباقيين يكمّلوا.</p>`,
      real: `
        <p>Worker بيحدّث آخر موقع للعربية في <code>Vehicles</code> وبعدين يقفل الرحلة في <code>Trips</code>، وشاشة الـ dispatch بتعدّل الرحلة الأول وبعدين حالة العربية. نفس الصفين بترتيب عكسي = deadlocks تحت الضغط. ومع 1,000 تحديث في الثانية على عدد صغير من العربيات النشطة، الـ blocking بيزيد بسرعة.</p>`,
      try: 'سيبها على «أي ترتيب» وزوّد الـ sessions لـ 8 وقلّل الصفوف لـ 3: الـ deadlocks هتبدأ. غيّر لـ «دايمًا بالـ Id»: الـ deadlocks بتختفي تمامًا، والـ blocking لسه موجود. بعدين قلّل وقت الـ UPDATE: الـ transaction القصيرة بتقلل الـ blocking نفسه.',
      also: 'تحويل بين حسابين في البنك (A→B و B→A في نفس اللحظة)، وحجز نفس المقعد في الألعاب أو التذاكر، وتحديث المخزون في منصات التوصيل.',
      net: `
<pre><span class="c">// retry للـ deadlock victim بس (1205)</span>
for (var attempt = 1; ; attempt++)
{
    try { await CloseTripAsync(tripId); break; }
    catch (SqlException ex) when (ex.Number == 1205 &amp;&amp; attempt &lt; 3)
    {
        await Task.Delay(50 * attempt);
    }
}

<span class="c">// أو في EF Core (SQL Server provider)</span>
o.UseSqlServer(cs, x =&gt; x.EnableRetryOnFailure());</pre>
<pre><span class="c">-- مين بيعمل block لمين دلوقتي</span>
SELECT session_id, blocking_session_id,
       wait_type, wait_time
FROM sys.dm_exec_requests
WHERE blocking_session_id &lt;&gt; 0;</pre>`,
      deep: [
        '<b>نفس الترتيب = مفيش deadlock من النوع ده.</b> الدايرة محتاجة اتنين بياخدوا الـ locks بترتيب عكسي. لو كل الكود بيعدّل الجداول والصفوف بترتيب ثابت (مثلًا بالـ Id)، الدايرة مستحيل تتقفل. ده بالظبط اللي بيحصل في المحاكاة.',
        '<b>الـ deadlock monitor</b> في SQL Server بيشتغل كل 5 ثواني بشكل افتراضي، ولو لقى deadlocks كتير بيقلل الفترة دي. المحاكاة بتستخدم 1.5 ثانية عشان تبان أسرع.',
        '<b>اختيار الـ victim:</b> SQL Server بيختار الـ transaction الأرخص في الـ rollback (حسب حجم الـ log اللي استخدمته)، إلا لو حددت <code>SET DEADLOCK_PRIORITY</code>. هنا بنحسب «الأرخص» بعدد الـ locks الممسوكة.',
        '<b>شوف الـ deadlocks اللي حصلت:</b> الـ <code>system_health</code> Extended Events session بيسجل كل deadlock graph تلقائيًا. افتحه من SSMS وهتلاقي الـ resources والـ statements.',
        '<b>Retry آمن بس لو العملية idempotent أو الـ transaction كلها بتتعاد.</b> الـ <code>EnableRetryOnFailure</code> في EF Core بيعيد الـ <code>SaveChanges</code> كلها، ومش هيشتغل مع transaction أنت فاتحها بإيدك إلا لو استخدمت <code>CreateExecutionStrategy()</code>.',
        '<b>الـ RCSI بيقلل blocking القراية مع الكتابة</b> (التجربة اللي فاتت)، لكن مبيحلّش الـ deadlocks بين اتنين بيكتبوا. وفيه كمان <b>lock escalation</b>: لو statement واحد مسك حوالي 5,000 lock على نفس الجدول، SQL Server بيحاول يحوّلهم لـ table lock واحد، وده ممكن يعمل blocking أوسع بكتير.',
        '<b>تبسيطات:</b> كل الـ locks هنا X على صف، من غير S/U/intent locks ومن غير lock timeout، والطابور FIFO.'
      ]
    })
  });
})();
