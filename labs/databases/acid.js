/* Databases · Transactions & ACID — Write-Ahead Log, COMMIT, ROLLBACK, crash recovery.
   Real model: changes go to the buffer pool (RAM) and to the log buffer; COMMIT flushes the log (hardens it);
   a CHECKPOINT writes dirty pages to the data file (even uncommitted ones — after flushing the log first: WAL rule).
   "Pull the plug" wipes RAM. Recovery replays the hardened log: REDO every logged change, UNDO changes of
   transactions that have no COMMIT record. Consistency is checked on the data file per trip. */
(function () {
  "use strict";
  const { clamp, lerp, ease, fmt, f1 } = Lab.util;
  const { box, tx, dot, line, alpha, hatch } = Lab.draw;

  const F = ['c', 's', 'o'];                     // closed trip, summary row, odometer
  const FL = { c: 'Trips', s: 'Summary', o: 'Odometer' };
  const OP_T = 0.75, COMMIT_T = 0.45, GAP = 0.5, SHOW = 6;

  Lab.registerSim('acid', {
    height: 360, warm: 4, caption: true,
    init(s) {
      s.st = {
        trips: {}, nextTrip: 101, txnSeq: 0, w: null,
        hard: [], buf: [], lsn: 0, lastCkpt: 0, ckptAt: -9, flushAt: -9,
        phase: 'run', downAt: 0, rec: null, committed: 0, rolledBack: 0, crashes: 0, fx: []
      };
      this.startTrip(s);
      s.setCap('<b>BEGIN TRAN</b>قفل رحلة = 3 تعديلات لازم يحصلوا مع بعض: الرحلة تتقفل، ويتسجل ملخصها، وعدّاد العربية يزيد.');
    },
    onParam(s, k) { if (k === 'mode') this.init(s); },

    trip(st, id) { return st.trips[id] || (st.trips[id] = { id, disk: { c: 0, s: 0, o: 0 }, mem: { c: 0, s: 0, o: 0 }, dirty: { c: 0, s: 0, o: 0 }, bad: 0 }); },

    startTrip(s) {
      const st = s.st, id = st.nextTrip++;
      this.trip(st, id);
      const auto = s.p.mode === 'auto';
      const steps = auto ? ['c', 'commit', 's', 'commit', 'o', 'commit'] : ['c', 's', 'o', 'commit'];
      st.w = { trip: id, steps, i: 0, t0: s.t, txn: ++st.txnSeq, rollback: !auto && s.p.fail && s.rng() < 0.25 };
      if (st.w.rollback) st.w.steps = ['c', 's', 'rollback'];
      // prune old trips from view/memory
      const ids = Object.keys(st.trips).map(Number).sort((a, b) => a - b);
      while (ids.length > 40) delete st.trips[ids.shift()];
    },

    log(st, rec) { rec.lsn = ++st.lsn; st.buf.push(rec); },
    flush(s) { const st = s.st; if (st.buf.length) { st.hard.push(...st.buf); st.buf = []; st.flushAt = s.t; } if (st.hard.length > 600) st.hard.splice(0, st.hard.length - 600); },

    checkpoint(s) {
      const st = s.st;
      this.flush(s);                                   // WAL: log first, then pages
      let n = 0;
      for (const tr of Object.values(st.trips)) for (const f of F) if (tr.dirty[f]) { tr.disk[f] = tr.mem[f]; tr.dirty[f] = 0; n++; }
      st.lastCkpt = s.t; st.ckptAt = s.t; st.ckptPages = n;
    },

    step(s) {
      const st = s.st, t = s.t;
      if (st.phase === 'down') { if (t - st.downAt > 1.2) this.recover(s); return; }
      if (st.phase === 'recovered') { if (t - st.downAt > 4.5) { st.phase = 'run'; this.startTrip(s); } return; }
      if (t - st.lastCkpt >= s.p.ckpt) this.checkpoint(s);
      const w = st.w, stp = w.steps[w.i];
      const dur = stp === 'commit' || stp === 'rollback' ? COMMIT_T : stp === 'gap' ? GAP : OP_T;
      if (t - w.t0 < dur) return;
      const tr = this.trip(st, w.trip);
      if (F.includes(stp)) {
        tr.mem[stp] = 1; tr.dirty[stp] = 1;
        this.log(st, { txn: w.txn, trip: w.trip, f: stp, kind: 'op' });
      } else if (stp === 'commit') {
        this.log(st, { txn: w.txn, kind: 'commit' });
        this.flush(s);                               // durability: COMMIT returns after the log is on disk
        st.committed++;
        if (s.p.mode === 'auto') w.txn = ++st.txnSeq;
      } else if (stp === 'rollback') {
        // undo in memory using the log, and log the compensation
        for (const r of [...st.hard, ...st.buf].filter(r => r.txn === w.txn && r.kind === 'op')) { tr.mem[r.f] = 0; tr.dirty[r.f] = 1; }
        this.log(st, { txn: w.txn, kind: 'abort' });
        st.rolledBack++;
        s.setCap(`<b>ROLLBACK</b>الرحلة #${w.trip} حصل فيها error بعد خطوتين، فالـ transaction اترجعت كلها. التعديلات اتلغت من الذاكرة، والرحلة رجعت مفتوحة.`);
      }
      w.i++; w.t0 = t;
      if (stp === 'gap') { this.startTrip(s); return; }
      if (w.i >= w.steps.length) w.steps.push('gap');
    },

    crash(s) {
      const st = s.st;
      if (st.phase !== 'run') return;
      const w = st.w, inFlight = w.steps.slice(0, w.i).some(x => F.includes(x)) && !w.steps.slice(0, w.i).includes('commit') && !w.steps.slice(0, w.i).includes('rollback');
      st.lost = st.buf.length;
      st.crashTrip = w.trip; st.crashInFlight = inFlight;
      for (const tr of Object.values(st.trips)) { for (const f of F) { tr.mem[f] = tr.disk[f]; tr.dirty[f] = 0; } }
      st.buf = [];
      st.phase = 'down'; st.downAt = s.t; st.crashes++;
      s.setCap(`<b>⚡ CRASH</b>الكهربا قطعت والرحلة #${w.trip} في النص. الذاكرة كلها راحت: الـ buffer pool و ${st.lost} log record لسه متكتبوش على الديسك.`);
    },

    recover(s) {
      const st = s.st;
      const done = new Set(st.hard.filter(r => r.kind === 'commit' || r.kind === 'abort').map(r => r.txn));
      const committed = new Set(st.hard.filter(r => r.kind === 'commit').map(r => r.txn));
      let redo = 0, undo = 0;
      // REDO: replay every logged change (repeating history)
      for (const r of st.hard) if (r.kind === 'op') { const tr = this.trip(st, r.trip); if (!tr.disk[r.f]) { tr.disk[r.f] = 1; redo++; } }
      // re-apply rollbacks that were logged, then UNDO losers (no COMMIT and no ABORT record)
      for (const r of st.hard) if (r.kind === 'op' && !committed.has(r.txn)) { const tr = this.trip(st, r.trip); if (tr.disk[r.f]) { tr.disk[r.f] = 0; if (!done.has(r.txn)) undo++; } }
      for (const tr of Object.values(st.trips)) { tr.mem = { ...tr.disk }; tr.dirty = { c: 0, s: 0, o: 0 }; const v = tr.disk.c + tr.disk.s + tr.disk.o; tr.bad = v > 0 && v < 3 ? 1 : 0; }
      const bad = Object.values(st.trips).filter(t => t.bad).length;
      st.rec = { redo, undo, bad };
      st.phase = 'recovered'; st.downAt = s.t;
      const ct = this.trip(st, st.crashTrip), state = ct.disk.c + ct.disk.s + ct.disk.o;
      s.setCap(bad
        ? `<b>RECOVERY</b>اتعمل REDO لـ ${redo} تعديل و UNDO لـ ${undo}. بس الرحلة #${st.crashTrip} فاضلة نص متقفلة: كل خطوة كانت transaction لوحدها، فاللي اتعمل commit فضل. <b>الـ Atomicity ضاعت</b>.`
        : `<b>RECOVERY</b>اتعمل REDO لـ ${redo} تعديل من الـ log، و UNDO لـ ${undo} تعديل تبع transaction ملحقتش تعمل COMMIT. الرحلة #${st.crashTrip} ${state === 3 ? 'متقفلة كاملة' : 'رجعت مفتوحة كاملة'}، وكل الرحلات متسقة ✓`);
      st.nextTrip = Math.max(st.nextTrip, st.crashTrip + 1);
    },

    /* ---- drawing ---- */
    grid(s, x, y, w, ids, which, title, sub, col) {
      const st = s.st, C = s.C, n = s.narrow, rowH = n ? 17 : 20, cw = (w - 44) / 3;
      tx(title, x, y, { m: 1, s: n ? 10 : 11, w: 700, a: 'left', c: col });
      if (sub) tx(sub, x + w, y, { s: 10, c: C.muted, a: 'right' });
      F.forEach((f, j) => tx(n ? { c: 'Trip', s: 'Sum', o: 'Odo' }[f] : FL[f], x + 44 + cw * j + cw / 2, y + 16, { m: 1, s: 9, c: C.muted }));
      ids.forEach((id, i) => {
        const tr = st.trips[id], yy = y + 26 + i * rowH;
        tx('#' + id, x, yy + rowH / 2 - 1, { m: 1, s: 10, a: 'left', c: C.muted });
        F.forEach((f, j) => {
          const v = tr[which][f], xx = x + 44 + cw * j;
          box(xx + 2, yy + 2, cw - 4, rowH - 5, { r: 3, fill: v ? C.a2 : 'transparent', stroke: v ? null : C.line });
          if (which === 'mem' && tr.dirty[f]) dot(xx + cw - 8, yy + 7, 3, C.accent);
        });
        if (which === 'disk' && tr.bad) box(x + 40, yy, w - 40, rowH - 1, { r: 4, fill: null, stroke: C.bad, lw: 2 });
      });
    },

    draw(s) {
      const st = s.st, C = s.C, n = s.narrow, W = s.w, t = s.t;
      const ids = Object.keys(st.trips).map(Number).sort((a, b) => a - b).slice(-SHOW);
      const down = st.phase === 'down';
      const colW = n ? (W - 36) / 2 : (W - 60) / 4;
      const pos = n ? [[12, 12], [24 + colW, 12], [12, 186], [24 + colW, 186]] : [[12, 14], [24 + colW, 14], [36 + 2 * colW, 14], [48 + 3 * colW, 14]];

      /* 1) the transaction (app) */
      const [ax, ay] = pos[0], w = st.w;
      tx('Transaction', ax, ay, { m: 1, s: n ? 10 : 11, w: 700, a: 'left', c: C.accent });
      tx(s.p.mode === 'auto' ? 'autocommit' : 'BEGIN TRAN', ax + colW, ay, { m: 1, s: 9, c: C.muted, a: 'right' });
      if (w && st.phase === 'run') {
        const labels = { c: `UPDATE Trips #${w.trip}`, s: 'INSERT TripSummary', o: 'UPDATE Vehicles.Odo', commit: 'COMMIT', rollback: 'ROLLBACK', gap: '…' };
        w.steps.filter(x => x !== 'gap').forEach((stp, i) => {
          const yy = ay + 18 + i * (n ? 19 : 22), cur = i === w.i, past = i < w.i;
          const col = stp === 'commit' ? C.good : stp === 'rollback' ? C.bad : C.accent;
          box(ax, yy, colW, n ? 16 : 18, { r: 4, fill: past ? col : 'transparent', stroke: cur ? col : C.line, lw: cur ? 1.6 : 1 });
          tx(labels[stp], ax + 6, yy + (n ? 8 : 9), { m: 1, s: n ? 8 : 10, w: 600, a: 'left', c: past ? C.surface : C.ink });
          if (cur) { const k = clamp((t - w.t0) / (stp === 'commit' || stp === 'rollback' ? COMMIT_T : OP_T), 0, 1); box(ax, yy + (n ? 14 : 16), colW * k, 2, { r: 0, fill: col, stroke: null }); }
        });
      } else {
        tx(down ? 'السيرفر واقع' : 'Recovery ✓', ax + colW / 2, ay + 60, { s: 13, w: 700, c: down ? C.bad : C.good });
      }

      /* 2) buffer pool (RAM) */
      const [bx, by] = pos[1];
      if (down) { alpha(0.5, () => hatch(bx, by + 20, colW, 130, C.bad)); tx('RAM ضاعت', bx + colW / 2, by + 85, { s: 12, w: 700, c: C.bad }); tx('Buffer pool (RAM)', bx, by, { m: 1, s: n ? 10 : 11, w: 700, a: 'left', c: C.violet }); }
      else this.grid(s, bx, by, colW, ids, 'mem', 'Buffer pool (RAM)', n ? '' : '● dirty', C.violet);

      /* 3) log */
      const [lx, ly] = pos[2];
      tx('Transaction log', lx, ly, { m: 1, s: n ? 10 : 11, w: 700, a: 'left', c: C.ink });
      tx(n ? '' : 'على الديسك', lx + colW, ly, { s: 10, c: C.muted, a: 'right' });
      const recs = [...st.hard.slice(-9).map(r => [r, 1]), ...st.buf.map(r => [r, 0])].slice(-9);
      recs.forEach(([r, hard], i) => {
        const yy = ly + 14 + i * (n ? 16 : 17);
        const lbl = r.kind === 'op' ? `${r.lsn} T${r.txn} ${FL[r.f]} #${r.trip}` : `${r.lsn} T${r.txn} ${r.kind.toUpperCase()}`;
        const col = r.kind === 'commit' ? C.good : r.kind === 'abort' ? C.bad : C.ink;
        box(lx, yy, colW, n ? 14 : 15, { r: 3, fill: hard ? C.surface : 'transparent', stroke: hard ? C.line : C.accent, dash: hard ? null : [3, 2] });
        tx(lbl, lx + 4, yy + (n ? 7 : 7.5), { m: 1, s: n ? 8 : 9, a: 'left', c: col, w: r.kind === 'op' ? 500 : 700 });
      });
      if (t - st.flushAt < 0.5) tx('flush ↓', lx + colW, ly + 14 + recs.length * (n ? 16 : 17) + 6, { m: 1, s: 9, w: 700, c: C.good, a: 'right' });

      /* 4) data file (disk) */
      const [dx, dy] = pos[3];
      this.grid(s, dx, dy, colW, ids, 'disk', 'Data file (disk)', n ? '' : `checkpoint كل ${s.p.ckpt}s`, C.a2);
      if (t - st.ckptAt < 0.8) alpha(1 - (t - st.ckptAt) / 0.8, () => tx(`CHECKPOINT: ${st.ckptPages} pages`, dx + colW / 2, dy + 26 + SHOW * (n ? 17 : 20) + 12, { m: 1, s: 10, w: 700, c: C.a2 }));
      if (st.phase === 'recovered' && st.rec) tx(`REDO ${st.rec.redo} · UNDO ${st.rec.undo}`, dx + colW / 2, dy + 26 + SHOW * (n ? 17 : 20) + 12, { m: 1, s: 10, w: 700, c: st.rec.bad ? C.bad : C.good });
      if (down) { alpha(0.25 + 0.2 * Math.sin(t * 8), () => box(0, 0, W, s.h, { r: 0, fill: C.bad, stroke: null })); }
    },

    stats(s) {
      const st = s.st;
      const dirty = Object.values(st.trips).reduce((a, tr) => a + tr.dirty.c + tr.dirty.s + tr.dirty.o, 0);
      const bad = Object.values(st.trips).filter(t => t.bad).length;
      return [
        ['Transactions committed', fmt(st.committed), 'good'],
        ['Rollbacks', fmt(st.rolledBack), st.rolledBack ? 'warn' : ''],
        ['Dirty pages في الذاكرة', fmt(dirty), dirty > 6 ? 'warn' : ''],
        ['Log في الذاكرة (لسه مش على الديسك)', fmt(st.buf.length), st.buf.length ? 'warn' : 'good'],
        ['Crashes', fmt(st.crashes)],
        ['رحلات نص متقفلة (inconsistent)', fmt(bad), bad ? 'bad' : 'good']
      ];
    },

    act: { crash(s) { s.def.crash(s); } }
  });

  Lab.registerLesson({
    id: 'acid', lab: 'databases', title: 'Transactions و ACID',
    html: Lab.tpl.lesson({
      sim: 'acid', level: 2, caption: true,
      terms: ['Transaction', 'ACID', 'COMMIT', 'ROLLBACK', 'Write-Ahead Log', 'Recovery'],
      lede: 'قفل رحلة = 3 تعديلات في 3 جداول. التعديل بيتعمل في الذاكرة (Buffer pool) ويتسجل في الـ Log. الـ COMMIT بيكتب الـ Log على الديسك، والـ Checkpoint بيكتب الصفحات بعدين. اضغط «اقطع الكهربا» في أي لحظة وشوف الـ Recovery.',
      aria: 'محاكاة transaction log و buffer pool و crash recovery',
      acts: [['crash', '⚡ اقطع الكهربا']],
      controls: [
        { type: 'seg', p: 'mode', label: 'طريقة الكود', value: 'tran', opts: [['tran', 'Transaction واحدة'], ['auto', 'كل statement لوحده']] },
        { type: 'range', p: 'ckpt', label: 'Checkpoint كل', min: 1, max: 12, step: 1, value: 5, unit: 's' },
        { type: 'seg', p: 'fail', label: 'أخطاء في النص', value: 'false', opts: [['false', 'مفيش'], ['true', 'ربع الرحلات تفشل']] }
      ],
      idea: `
        <p><b>Transaction</b> مجموعة تعديلات بتتعامل كوحدة واحدة. <b>ACID</b> هي 4 ضمانات: <b>Atomicity</b> يا كله يحصل يا ولا حاجة. <b>Consistency</b> الداتا تفضل ماشية على القواعد (هنا: رحلة متقفلة لازم يكون ليها ملخص). <b>Isolation</b> الـ transactions اللي شغالة مع بعض متشوفش نص شغل بعض (التجربة الجاية). <b>Durability</b> اللي اتعمله COMMIT مش هيضيع حتى لو الكهربا قطعت.</p>
        <p>الطريقة: <b>Write-Ahead Logging</b>. أي تعديل بيتكتب في الـ <b>Log</b> الأول. الـ <b>COMMIT</b> مبيرجعش غير لما الـ log يتكتب على الديسك. الصفحات نفسها بتتكتب بعدين في الـ <b>Checkpoint</b>. بعد crash، الـ <b>Recovery</b> بيعيد كل اللي في الـ log (<b>REDO</b>) وبيلغي اللي ملوش COMMIT (<b>UNDO</b>).</p>`,
      real: `
        <p>رحلة شحنة خلصت: لازم <code>Trips.Status = Closed</code>، وصف في <code>TripSummary</code> بالمسافة، و <code>Vehicles.Odometer</code> يزيد. لو السيرفر وقع بعد أول تعديل وكل statement كان لوحده، هيبقى عندك رحلة متقفلة من غير ملخص، والفاتورة اللي معتمدة على الملخص مش هتطلع. جوه transaction واحدة، الرحلة يا متقفلة كاملة يا مفتوحة كاملة.</p>`,
      try: 'في وضع «كل statement لوحده»، اقطع الكهربا بعد أول COMMIT وقبل التالت: هتلاقي رحلة مكتوبة بالأحمر في الـ data file. ارجع لـ «Transaction واحدة» وكرر: مستحيل يحصل. خلّي الـ Checkpoint كل ثانية واقطع الكهربا في نص transaction: الصفحات اتكتبت على الديسك قبل الـ COMMIT، والـ UNDO هو اللي بيشيلها.',
      also: 'تحويل فلوس بين حسابين في بنك، وخصم رصيد وتسجيل مكالمة في الفوترة، وتأكيد طلب وحجز المخزون في التوصيل.',
      net: `
<pre><span class="c">// EF Core: SaveChanges واحدة = transaction واحدة</span>
trip.Status = TripStatus.Closed;
db.TripSummaries.Add(summary);
vehicle.Odometer += summary.Km;
await db.SaveChangesAsync();

<span class="c">// لو محتاج أكتر من SaveChanges في نفس الـ transaction</span>
await using var tx = await db.Database.BeginTransactionAsync();
await db.SaveChangesAsync();
await db.Database.ExecuteSqlRawAsync("EXEC dbo.Recalc @p0", id);
await tx.CommitAsync();   <span class="c">// من غيرها: rollback لما الـ tx يتعمله dispose</span></pre>
<pre><span class="c">-- T-SQL</span>
SET XACT_ABORT ON;   <span class="c">-- أي error يعمل rollback للكل</span>
BEGIN TRAN;
  UPDATE Trips SET Status = 'Closed' WHERE Id = @id;
  INSERT TripSummary (TripId, Km) VALUES (@id, @km);
  UPDATE Vehicles SET Odometer += @km WHERE Id = @v;
COMMIT;</pre>`,
      deep: [
        '<b>ليه الصفحات مش بتتكتب مع الـ COMMIT؟</b> الكتابة في الـ log متتالية (sequential) وسريعة. الصفحات متفرقة على الديسك، فكتابتها مع كل commit كانت هتبقى random IO كتير. الـ log كفاية عشان يعيد بناء أي حاجة بعد crash. عشان كده سرعة ديسك الـ log بتحدد سرعة الـ commits.',
        '<b>الـ Checkpoint بيكتب صفحات uncommitted عادي</b>، وده آمن لأن الـ log records بتاعتها اتكتبت الأول (قاعدة الـ WAL). ولو الـ transaction ماكملتش، الـ UNDO بيرجّعها. جرّبها بـ checkpoint كل ثانية.',
        '<b>SQL Server Recovery</b> بيتم على 3 مراحل: Analysis، ثم Redo، ثم Undo. من SQL Server 2019 فيه <b>Accelerated Database Recovery</b> بيخلّي الـ undo شبه فوري حتى للـ transactions الطويلة.',
        '<b>XACT_ABORT:</b> من غيره، بعض الأخطاء في T-SQL بتلغي الـ statement بس والـ transaction تفضل مفتوحة. الـ default بتاعه OFF، فلازم تشغّله في الـ stored procedures اللي فيها transactions.',
        '<b>Transaction طويلة = مشاكل:</b> الـ locks بتفضل ممسوكة (التجربة الجاية)، والـ log مبيقدرش يتمسح (VLFs بتكبر)، والـ recovery بعد crash بياخد وقت أطول. خلّي الـ transaction قصيرة، ومتعملش HTTP call جوّاها.',
        '<b>Delayed Durability</b> اختيار في SQL Server بيخلّي الـ COMMIT يرجع قبل ما الـ log يتكتب. أسرع، بس ممكن تخسر آخر transactions لو السيرفر وقع. ده Durability مقابل throughput بشكل صريح.',
        '<b>تبسيطات:</b> كل خلية في الرسم بتمثل صفحة، والـ log بيتكتب على الديسك مع كل COMMIT بس. الحقيقة إن الـ log buffer بيتكتب كمان لما يتملي أو قبل أي صفحة تتكتب.'
      ]
    })
  });
})();
