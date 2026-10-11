/* Databases · Replication & Replication Lag (Always On style: synchronous / asynchronous commit)
   Every write on the primary produces a log record that travels to the secondaries (network latency), gets hardened
   there, then replayed (REDO) at a limited speed. Synchronous commit makes the primary wait for the harden ACK of S1.
   Reads on a secondary see only replayed changes → stale reads are measured, not scripted. Failover counts
   committed transactions the new primary never received. */
(function () {
  "use strict";
  const { clamp, lerp, ease, fmt, f1, Meter, spawnLoop } = Lab.util;
  const { box, tx, dot, line, alpha, arrow, cyl } = Lab.draw;

  const VEH = 30, LOCAL = 0.05, S2_FACTOR = 3;

  Lab.registerSim('replication', {
    height: 330, warm: 6,
    init(s) {
      s.st = {
        lsn: 0, next: 0, nextRead: 0, pending: [], commits: [], commitLat: [], t: 0,
        prim: { ver: new Array(VEH).fill(0) },
        reps: [{ name: 'S1', recv: [], applied: 0, ver: new Array(VEH).fill(0), redoAcc: 0, hardened: 0 },
               { name: 'S2', recv: [], applied: 0, ver: new Array(VEH).fill(0), redoAcc: 0, hardened: 0 }],
        flying: [], acks: [], reads: [], readM: new Meter(10), staleM: new Meter(10), commitM: new Meter(5), fail: null
      };
    },
    onParam(s, k) { if (k === 'mode') this.init(s); },

    lat(s, i) { return s.p.lat * (i === 0 ? 1 : S2_FACTOR); },

    step(s, dt) {
      const st = s.st, p = s.p, t = s.t;
      if (st.fail) { if (t - st.fail.t > 6) this.init(s); return; }
      // writes: each is one log record; local harden, then shipped to both secondaries
      spawnLoop(st, t, p.writes, s.rng, () => {
        const v = Math.floor(s.rng() * VEH), rec = { lsn: ++st.lsn, v, ver: st.prim.ver[v] + 1, t0: t, committed: false };
        st.prim.ver[v] = rec.ver;               // the change is in the primary's data (uncommitted until commit returns)
        st.pending.push(rec);
        st.reps.forEach((r, i) => st.flying.push({ rec, to: i, t0: t, arr: t + LOCAL + this.lat(s, i) }));
      });
      // arrivals → harden on the secondary (+ ACK back to the primary for sync S1)
      for (const f of st.flying) if (t >= f.arr) {
        f.done = 1; const r = st.reps[f.to]; r.recv.push(f.rec); r.hardened = Math.max(r.hardened, f.rec.lsn);
        if (f.to === 0 && p.mode === 'sync') st.acks.push({ rec: f.rec, t0: t, arr: t + this.lat(s, 0) });
      }
      st.flying = st.flying.filter(f => !f.done);
      // commit completes: async = after local harden; sync = after S1's ACK comes back
      const commit = rec => { rec.committed = true; st.commits.push(rec); st.commitM.add(t); st.commitLat.push(t - rec.t0); if (st.commitLat.length > 40) st.commitLat.shift(); };
      if (p.mode === 'async') for (const rec of st.pending) if (!rec.committed && t - rec.t0 >= LOCAL) commit(rec);
      for (const a of st.acks) if (t >= a.arr) { a.done = 1; if (!a.rec.committed) commit(a.rec); }
      st.acks = st.acks.filter(a => !a.done);
      st.pending = st.pending.filter(r => !r.committed);
      if (st.commits.length > 400) st.commits.splice(0, st.commits.length - 400);
      // REDO on each secondary at a limited rate
      st.reps.forEach(r => {
        r.redoAcc += p.redo * dt;
        r.recv.sort((a, b) => a.lsn - b.lsn);
        while (r.redoAcc >= 1 && r.recv.length) { const rec = r.recv.shift(); r.ver[rec.v] = Math.max(r.ver[rec.v], rec.ver); r.applied = rec.lsn; r.lastT = rec.t0; r.redoAcc -= 1; }
        if (!r.recv.length) r.redoAcc = Math.min(r.redoAcc, 1);
      });
      // reads: "where is vehicle v now?" from the chosen replica, compared with the last committed version
      if (t >= st.nextRead) {
        st.nextRead = t + 0.25;
        const v = Math.floor(s.rng() * VEH);
        const truth = (() => { let x = 0; for (const c of st.commits) if (c.v === v) x = Math.max(x, c.ver); return x; })();
        const got = p.read === 'primary' ? st.prim.ver[v] : st.reps[0].ver[v];
        const stale = got < truth;
        st.readM.add(t); if (stale) st.staleM.add(t);
        st.reads.push({ t0: t, stale, to: p.read });
      }
      st.reads = st.reads.filter(r => t - r.t0 < 0.7);
    },

    failover(s) {
      const st = s.st; if (st.fail) return;
      // S1 becomes primary with whatever it hardened; committed transactions beyond that are gone
      const lost = st.commits.filter(c => c.lsn > st.reps[0].hardened).length;
      st.fail = { t: s.t, lost, inflight: st.pending.length };
    },

    draw(s) {
      const st = s.st, p = s.p, C = s.C, n = s.narrow, W = s.w, H = s.h, t = s.t;
      const pw = n ? 70 : 110, ph = 92, py = H / 2 - 40;
      const P = { x: 14, y: py }, S = [{ x: W * (n ? 0.5 : 0.52) - pw / 2, y: 26 }, { x: W - pw - 14, y: H - ph - 64 }];
      const down = !!st.fail;
      const node = (o, title, sub, col, dead) => {
        box(o.x, o.y, pw, ph, { r: 10, stroke: dead ? C.bad : col, lw: 1.8 });
        tx(title, o.x + pw / 2, o.y + 18, { m: 1, s: n ? 10 : 12, w: 700, c: dead ? C.bad : col });
        if (sub) tx(sub, o.x + pw / 2, o.y + 34, { m: 1, s: 9, c: C.muted });
      };
      node(P, down ? 'PRIMARY ✗' : 'PRIMARY', 'writes + reads', C.accent, down);
      node(S[0], down ? 'S1 → PRIMARY' : 'S1', p.mode === 'sync' ? 'sync commit' : 'async commit', C.violet, false);
      node(S[1], 'S2 (DR)', 'async · far', C.violet, false);
      // links
      const pr = { x: P.x + pw, y: P.y + ph / 2 };
      const sl = i => ({ x: S[i].x, y: S[i].y + ph / 2 });
      [0, 1].forEach(i => line(pr.x, pr.y, sl(i).x, sl(i).y, C.line, 1, [3, 4]));
      // log records in flight and ACKs back
      for (const f of st.flying) { const k = clamp((t - f.t0) / (f.arr - f.t0), 0, 1); dot(lerp(pr.x, sl(f.to).x, k), lerp(pr.y, sl(f.to).y, k), 3.2, C.accent); }
      for (const a of st.acks) { const k = clamp((t - a.t0) / (a.arr - a.t0), 0, 1); dot(lerp(sl(0).x, pr.x, k), lerp(sl(0).y, pr.y, k) + 6, 3, C.a2); }
      // queues inside nodes
      const bar = (o, k, label, col) => { box(o.x + 8, o.y + ph - 30, pw - 16, 8, { r: 3, fill: C.bg }); box(o.x + 8, o.y + ph - 30, (pw - 16) * clamp(k, 0, 1), 8, { r: 3, fill: col, stroke: null }); tx(label, o.x + pw / 2, o.y + ph - 12, { m: 1, s: 9, c: col }); };
      bar(P, st.pending.length / 20, `waiting commit ${st.pending.length}`, st.pending.length > 5 ? C.bad : C.accent);
      st.reps.forEach((r, i) => bar(S[i], r.recv.length / 40, `redo queue ${r.recv.length}`, r.recv.length > 20 ? C.bad : C.a2));
      // reads
      for (const r of st.reads) {
        const k = clamp((t - r.t0) / 0.7, 0, 1), tgt = r.to === 'primary' ? { x: P.x + pw / 2, y: P.y + ph } : { x: S[0].x + pw / 2, y: S[0].y + ph };
        dot(lerp(W / 2, tgt.x, ease(k)), lerp(H - 20, tgt.y, ease(k)), 3.5, r.stale ? C.bad : C.good);
      }
      tx(p.read === 'primary' ? 'reads → primary' : 'reads → S1 (ApplicationIntent=ReadOnly)', W / 2, H - 10, { m: 1, s: n ? 9 : 10, c: C.muted });
      if (down) {
        box(W / 2 - (n ? 150 : 190), H / 2 - 24, n ? 300 : 380, 48, { r: 10, fill: C.surface, stroke: st.fail.lost ? C.bad : C.good, lw: 2 });
        tx(st.fail.lost ? `FAILOVER: ${st.fail.lost} committed transactions lost` : 'FAILOVER: no committed data lost ✓', W / 2, H / 2 - 6, { m: 1, s: n ? 10 : 12, w: 700, c: st.fail.lost ? C.bad : C.good });
        tx(`in-flight (not committed): ${st.fail.inflight}`, W / 2, H / 2 + 12, { m: 1, s: 10, c: C.muted });
      }
    },

    stats(s) {
      const st = s.st, t = s.t, r1 = st.reps[0];
      const avg = st.commitLat.length ? st.commitLat.reduce((a, b) => a + b, 0) / st.commitLat.length : 0;
      const lag = r1.recv.length ? t - r1.recv[0].t0 : 0;
      const risk = st.commits.filter(c => c.lsn > r1.hardened).length;
      const reads = st.readM.sum(t), stale = st.staleM.sum(t), pct = reads ? stale / reads * 100 : 0;
      return [
        ['Commit latency', Math.round(avg * 1000) + ' ms (sim)', avg > 0.4 ? 'bad' : avg > 0.15 ? 'warn' : 'good'],
        ['Commits', f1(st.commitM.rate(t)) + ' /s'],
        ['Redo queue على S1', fmt(r1.recv.length), r1.recv.length > 20 ? 'bad' : r1.recv.length > 5 ? 'warn' : 'good'],
        ['Replication lag (S1)', f1(lag) + ' s', lag > 2 ? 'bad' : lag > 0.5 ? 'warn' : 'good'],
        ['Stale reads (آخر 10s)', Math.round(pct) + '%', pct > 5 ? 'bad' : pct ? 'warn' : 'good'],
        ['Committed مش على S1 (هيضيع لو وقع)', fmt(risk), risk ? 'bad' : 'good']
      ];
    },

    act: { failover(s) { s.def.failover(s); } }
  });

  Lab.registerLesson({
    id: 'replication', lab: 'databases', title: 'Replication و Replication Lag',
    html: Lab.tpl.lesson({
      sim: 'replication', level: 3,
      terms: ['Replication', 'Sync vs Async Commit', 'Replication Lag', 'Failover'],
      lede: 'كل تعديل على الـ Primary بيتبعت كـ log record للـ secondaries (البرتقالي)، وبيتطبق هناك في طابور الـ REDO. في الـ sync، الـ Primary بيستنى تأكيد (التركواز) قبل ما يرجّع COMMIT. القرايات الحمرا رجعت موقع قديم للعربية.',
      aria: 'محاكاة replication بين primary و secondaries مع lag و failover',
      acts: [['failover', '⚡ وقّع الـ Primary']],
      controls: [
        { type: 'seg', p: 'mode', label: 'S1 commit mode', value: 'async', opts: [['async', 'Asynchronous'], ['sync', 'Synchronous']] },
        { type: 'seg', p: 'read', label: 'القرايات رايحة فين', value: 'secondary', opts: [['primary', 'Primary'], ['secondary', 'S1 (readable secondary)']] },
        { type: 'range', p: 'writes', label: 'Writes', min: 1, max: 30, step: 1, value: 10, unit: 'tx/s' },
        { type: 'range', p: 'lat', label: 'Network latency لـ S1', min: 0.05, max: 1, step: 0.05, value: 0.2, unit: 's' },
        { type: 'range', p: 'redo', label: 'سرعة الـ REDO على الـ secondary', min: 4, max: 40, step: 1, value: 14, unit: 'rec/s' }
      ],
      idea: `
        <p><b>Replication</b> إن نسخة من الداتابيز تتحدث باستمرار على سيرفر تاني، عشان لو الأساسي وقع (<b>High Availability</b>)، أو عشان تقرا منها وتخفف الحمل (<b>read scale-out</b>). في SQL Server الأشهر هو <b>Always On Availability Groups</b>: الـ Primary بيبعت الـ transaction log للـ secondaries، وهما بيعيدوا تنفيذه (REDO).</p>
        <p>في <b>Asynchronous commit</b> الـ Primary مبيستناش حد، فالـ COMMIT سريع، بس لو وقع قبل ما الـ log يوصل، اللي اتعمله commit بيضيع. في <b>Synchronous commit</b> بيستنى الـ secondary يكتب الـ log عنده، فمفيش ضياع، بس كل COMMIT بيدفع round trip. والفرق بين اللي حصل على الـ Primary واللي اتطبق على الـ secondary اسمه <b>Replication Lag</b>.</p>`,
      real: `
        <p>شاشة التتبع اللايف بتقرا آخر موقع العربية من readable secondary عشان تخفف عن الـ Primary اللي بياخد 1,000 insert في الثانية. لو الـ REDO على الـ secondary اتأخر (مثلًا job تقارير تقيل شغال عليه)، العربية على الخريطة بتظهر في مكان قديم. والعميل بيشتكي إن «العربية واقفة» وهي ماشية.</p>`,
      try: 'سيبها Asynchronous وقلّل سرعة الـ REDO لـ 8: الـ redo queue بيكبر والـ stale reads بتزيد. اضغط «وقّع الـ Primary»: شوف كام transaction اتعمله commit وضاع. حوّل لـ Synchronous وكرر: صفر ضياع، بس الـ commit latency زاد. وخد بالك: حتى في Synchronous، القراية من S1 لسه ممكن تبقى قديمة.',
      also: 'أرصدة البنوك (لازم sync + القراية من الـ primary)، وتايملاين الشات والـ feeds (stale بثانية مقبول)، وجداول الأسعار في التداول.',
      net: `
<pre><span class="c">// القراية من الـ readable secondary (Always On listener)</span>
var cs = "Server=tcp:ag-listener,1433;Database=Tracking;" +
         "ApplicationIntent=ReadOnly;MultiSubnetFailover=True;";

<span class="c">// في EF Core: context منفصل للقراية</span>
services.AddDbContext&lt;TrackingReadDb&gt;(o =&gt; o.UseSqlServer(readOnlyCs));</pre>
<pre><span class="c">-- راقب الـ lag من الـ primary</span>
SELECT ar.replica_server_name, drs.synchronization_state_desc,
       drs.log_send_queue_size, drs.redo_queue_size,
       drs.secondary_lag_seconds
FROM sys.dm_hadr_database_replica_states drs
JOIN sys.availability_replicas ar ON ar.replica_id = drs.replica_id;</pre>`,
      deep: [
        '<b>Synchronous مش معناه إن القراية من الـ secondary محدّثة.</b> الـ sync commit بيستنى الـ secondary «يكتب» الـ log (harden)، مش «يطبّقه» (redo). لو الـ redo متأخر، القراية من الـ secondary بترجع قيمة قديمة حتى في sync. جرّبها في المحاكاة.',
        '<b>Read-your-writes:</b> لو المستخدم عدّل حاجة ورجع على طول يقراها من secondary، ممكن ميلاقيهاش. الحلول: القراية بعد الكتابة من الـ primary لفترة قصيرة، أو مقارنة LSN/timestamp، أو تقبل التأخير في الشاشات اللي تسمح بيه.',
        '<b>RPO و RTO:</b> الـ RPO هو قد إيه داتا ممكن تخسرها (async = ثواني، sync = صفر)، والـ RTO هو قد إيه وقت لحد ما النظام يرجع (automatic failover في sync = ثواني). الـ DR replica البعيدة غالبًا async لأن الـ latency عالي.',
        '<b>الـ sync commit بيبطّأ كل الكتابات بالـ round trip:</b> 1ms في نفس الـ datacenter مقبول، 40ms بين قارتين يعني كل transaction بتاخد 40ms زيادة. عشان كده الـ sync replica بتبقى قريبة.',
        '<b>Replication في SQL Server أنواع:</b> Availability Groups (الأشهر للـ HA)، و Transactional Replication (لنسخ جداول معينة)، و Log Shipping (أقدم، بفترات). المحاكاة دي أقرب للـ Availability Groups.',
        '<b>تبسيطات:</b> الأزمنة متكبّرة (مئات الـ ms بدل الـ ms) عشان تبان، والـ REDO بيطبّق log record في المرة بسرعة ثابتة.'
      ]
    })
  });
})();
