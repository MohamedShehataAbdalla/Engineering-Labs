/* Databases · Isolation Levels: Dirty Read / Non-repeatable Read / Phantom  (stepped)
   Not a canned animation: a tiny lock manager + row-version store executes two transactions under the chosen
   isolation level and records every step. Blocking, versions and anomalies come out of these rules:
     READ UNCOMMITTED  reads take no locks, see uncommitted data
     READ COMMITTED    (locking) short S lock per row read → blocked by X locks, released right after the read
     RCSI              reads the last committed version, no S locks
     REPEATABLE READ   S locks held to the end of the transaction
     SERIALIZABLE      + key-range lock on the predicate (blocks matching INSERTs)
     SNAPSHOT          reads the committed version as of the transaction's first read; no S locks */
(function () {
  "use strict";
  const { clamp, ease } = Lab.util;
  const { box, tx, dot, line, alpha, arrow } = Lab.draw;

  const LEVELS = { ru: 'READ UNCOMMITTED', rc: 'READ COMMITTED', rcsi: 'READ COMMITTED SNAPSHOT', rr: 'REPEATABLE READ', ser: 'SERIALIZABLE', snap: 'SNAPSHOT' };
  const STEP = 2.4;

  const SCEN = {
    dirty: {
      title: 'Dirty Read',
      rows: [{ id: 7, Status: 'Active', Speed: 60 }],
      t1: [{ op: 'update', id: 7, set: { Status: 'Stolen' }, sql: "UPDATE Vehicles SET Status='Stolen' WHERE Id=7" }, { op: 'rollback', sql: 'ROLLBACK' }],
      t2: [{ op: 'read', id: 7, col: 'Status', sql: 'SELECT Status FROM Vehicles WHERE Id=7' }, { op: 'commit', sql: 'COMMIT' }],
      order: [1, 2, 1, 2],
      verdict(r) { const v = r.t2[0]; return v === 'Stolen' ? [true, 'T2 قرا «Stolen» وده عمره ما اتعمله commit. لو بعت تنبيه سرقة للعميل، يبقى بعت تنبيه غلط.'] : [false, `T2 قرا «${v}»: القيمة الـ committed بس.`]; }
    },
    nonrep: {
      title: 'Non-repeatable Read',
      rows: [{ id: 7, Status: 'Active', Speed: 60 }],
      t1: [{ op: 'read', id: 7, col: 'Speed', sql: 'SELECT Speed WHERE Id=7' }, { op: 'read', id: 7, col: 'Speed', sql: 'SELECT Speed WHERE Id=7' }, { op: 'commit', sql: 'COMMIT' }],
      t2: [{ op: 'update', id: 7, set: { Speed: 120 }, sql: 'UPDATE Vehicles SET Speed=120 WHERE Id=7' }, { op: 'commit', sql: 'COMMIT' }],
      order: [1, 2, 2, 1, 1],
      verdict(r) { const [a, b] = r.t1; return a !== b ? [true, `T1 قرا نفس الصف مرتين جوه نفس الـ transaction: ${a} وبعدين ${b}. التقرير اللي بيحسب على القراية الأولى بقى مش متسق مع التانية.`] : [false, `T1 قرا ${a} في المرتين.`]; }
    },
    phantom: {
      title: 'Phantom',
      rows: [{ id: 3, Status: 'Active', Speed: 115 }, { id: 4, Status: 'Active', Speed: 80 }, { id: 5, Status: 'Active', Speed: 105 }],
      t1: [{ op: 'count', where: r => r.Speed > 100, sql: 'SELECT COUNT(*) WHERE Speed > 100' }, { op: 'count', where: r => r.Speed > 100, sql: 'SELECT COUNT(*) WHERE Speed > 100' }, { op: 'commit', sql: 'COMMIT' }],
      t2: [{ op: 'insert', row: { id: 9, Status: 'Active', Speed: 130 }, sql: 'INSERT Vehicles (Id=9, Speed=130)' }, { op: 'commit', sql: 'COMMIT' }],
      order: [1, 2, 2, 1, 1],
      verdict(r) { const [a, b] = r.t1; return a !== b ? [true, `نفس الـ COUNT طلع ${a} وبعدين ${b}: صف جديد «ظهر» في النص.`] : [false, `الـ COUNT طلع ${a} في المرتين.`]; }
    }
  };

  /* ---------- the mini engine: run a scenario under a level, return the recorded steps ---------- */
  function run(scKey, level) {
    const sc = SCEN[scKey];
    let clock = 1;
    const rows = sc.rows.map(r => ({ id: r.id, versions: [{ v: { ...r }, ts: 0 }], pending: null, insertedBy: null }));
    const T = { 1: { id: 1, ops: sc.t1, i: 0, snap: null, held: new Set(), blocked: null, done: false, reads: [] },
                2: { id: 2, ops: sc.t2, i: 0, snap: null, held: new Set(), blocked: null, done: false, reads: [] } };
    const locks = {};                       // rowId → { S:Set, X:txnId|null }
    const range = new Set();                // txn ids holding a key-range lock on the predicate
    const steps = [];
    const L = id => locks[id] || (locks[id] = { S: new Set(), X: null });
    const committedAt = (row, ts) => { let best = null; for (const ver of row.versions) if (ver.ts <= ts) best = ver; return best && best.v; };
    const latest = row => row.versions[row.versions.length - 1].v;
    const snapTs = t => { if (t.snap === null) t.snap = clock; return t.snap; };
    const visibleRows = () => rows.filter(r => r.versions.length || r.pending);

    /** value of a row as seen by txn t, or {block: reason} */
    function readRow(t, row, col, hold) {
      const lk = L(row.id), other = lk.X && lk.X !== t.id;
      if (row.pending && row.pending.txn === t.id) return { val: row.pending.v };
      switch (level) {
        case 'ru': return { val: row.pending ? row.pending.v : latest(row) };
        case 'rcsi': { const v = row.versions.length ? latest(row) : null; return { val: v }; }
        case 'snap': { const v = committedAt(row, snapTs(t)); return { val: v }; }
        default: // locking levels
          if (other) return { block: `محتاج S lock على Id=${row.id} بس T${lk.X} ماسك X lock عليه` };
          if (hold) { lk.S.add(t.id); t.held.add(row.id); }
          return { val: row.versions.length ? latest(row) : null };
      }
    }

    function exec(t) {
      const o = t.ops[t.i];
      const holdS = level === 'rr' || level === 'ser';
      if (o.op === 'read') {
        const row = rows.find(r => r.id === o.id), res = readRow(t, row, o.col, holdS);
        if (res.block) return { block: res.block };
        const val = res.val[o.col]; t.reads.push(val);
        const how = level === 'ru' && row.pending && row.pending.txn !== t.id ? ' (قيمة uncommitted)'
          : (level === 'rcsi' || level === 'snap') && row.pending && row.pending.txn !== t.id ? ' (من الـ version store، من غير ما يستنى)' : '';
        return { msg: `T${t.id} قرا ${o.col} = <b>${val}</b>${how}${holdS ? ' وماسك S lock لحد آخر الـ transaction' : ''}.` };
      }
      if (o.op === 'count') {
        if (level === 'ser') {
          // key-range lock: blocked if someone holds an uncommitted matching insert
          const ins = rows.find(r => r.pending && r.pending.txn !== t.id && o.where(r.pending.v));
          if (ins) return { block: `T${ins.pending.txn} عامل INSERT لسه مش committed في نفس الـ range` };
          range.add(t.id);
        }
        let n = 0;
        for (const row of visibleRows()) {
          if (!row.versions.length && !(row.pending)) continue;
          const res = readRow(t, row, 'Speed', holdS);
          if (res.block) return { block: res.block };
          if (res.val && o.where(res.val)) n++;
        }
        t.reads.push(n);
        return { msg: `T${t.id}: COUNT = <b>${n}</b>${level === 'ser' ? ' وماسك key-range lock على Speed > 100' : holdS ? ' وماسك S locks على الصفوف اللي قراها' : ''}.` };
      }
      if (o.op === 'update') {
        const row = rows.find(r => r.id === o.id), lk = L(row.id);
        const sOthers = [...lk.S].filter(x => x !== t.id);
        if ((lk.X && lk.X !== t.id) || sOthers.length) return { block: `محتاج X lock على Id=${row.id} بس T${lk.X || sOthers[0]} ماسك ${lk.X ? 'X' : 'S'} lock عليه` };
        if (level === 'snap' && t.snap !== null && row.versions[row.versions.length - 1].ts > t.snap) return { msg: 'update conflict (3960)' };
        lk.X = t.id; t.held.add(row.id);
        row.pending = { txn: t.id, v: { ...(row.pending ? row.pending.v : latest(row)), ...o.set } };
        return { msg: `T${t.id} عدّل الصف في الذاكرة (لسه مش committed) وماسك X lock عليه.` };
      }
      if (o.op === 'insert') {
        if ([...range].some(x => x !== t.id)) return { block: `T${[...range].find(x => x !== t.id)} ماسك key-range lock على Speed > 100، والصف الجديد واقع جوّاه` };
        const row = { id: o.row.id, versions: [], pending: { txn: t.id, v: { ...o.row } }, insertedBy: t.id };
        rows.push(row); L(row.id).X = t.id; t.held.add(row.id);
        return { msg: `T${t.id} أضاف صف جديد (لسه مش committed).` };
      }
      if (o.op === 'commit' || o.op === 'rollback') {
        const ts = ++clock;
        for (const row of rows) if (row.pending && row.pending.txn === t.id) {
          if (o.op === 'commit') row.versions.push({ v: row.pending.v, ts });
          row.pending = null;
        }
        for (const id of t.held) { const lk = L(id); lk.S.delete(t.id); if (lk.X === t.id) lk.X = null; }
        range.delete(t.id); t.held.clear(); t.done = true;
        return { msg: o.op === 'commit' ? `T${t.id} عمل COMMIT وساب كل الـ locks.` : `T${t.id} عمل ROLLBACK: التعديل اتلغى، والـ locks اتسابت.` };
      }
    }

    function snapshot(cap, actor, kind) {
      steps.push({
        cap, actor, kind,
        t1i: T[1].i, t2i: T[2].i, b1: T[1].blocked, b2: T[2].blocked,
        rows: rows.map(r => ({ id: r.id, committed: r.versions.length ? { ...latest(r) } : null, pending: r.pending ? { txn: r.pending.txn, v: { ...r.pending.v } } : null, S: [...L(r.id).S], X: L(r.id).X })),
        range: [...range], reads: { 1: [...T[1].reads], 2: [...T[2].reads] }
      });
    }

    snapshot(`السيناريو: <b>${sc.title}</b> تحت <b>${LEVELS[level]}</b>. T1 فوق و T2 تحت، وكل خطوة بتتنفذ بالترتيب.`, 0, 'start');
    const order = [...sc.order];
    let guard = 0;
    const tryRun = (t) => {
      const r = exec(t);
      if (r.block) { t.blocked = r.block; snapshot(`T${t.id} <b>واقف</b>: ${r.block}.`, t.id, 'block'); return false; }
      t.blocked = null; t.i++;
      snapshot(r.msg, t.id, 'ok');
      return true;
    };
    while (order.length && guard++ < 40) {
      // next txn in the script that is not blocked
      let k = order.findIndex(id => !T[id].blocked && !T[id].done);
      if (k < 0) break;
      const t = T[order.splice(k, 1)[0]];
      const wasCommit = ['commit', 'rollback'].includes(t.ops[t.i].op);
      tryRun(t);
      if (wasCommit) for (const o of [1, 2]) { const w = T[o]; if (w.blocked && !w.done) { const before = w.blocked; if (tryRun(w)) steps[steps.length - 1].cap = `T${w.id} اتفك: ${steps[steps.length - 1].cap}`; else w.blocked = before; } }
    }
    const reads = { t1: T[1].reads, t2: T[2].reads };
    let [bad, why] = sc.verdict(reads);
    if (bad && scKey === 'phantom' && level === 'rr') why += ' الـ REPEATABLE READ مبيمنعش ده لأنه بيقفل الصفوف اللي قراها بس، مش المكان اللي ممكن صف جديد يتحط فيه.';
    const waited = steps.filter(x => x.kind === 'block').length;
    snapshot(`${bad ? '<b>✗ الظاهرة حصلت</b>' : '<b>✓ اتمنعت</b>'} ${why}${waited ? ` (حصل انتظار ${waited} مرة)` : ''}`, 0, bad ? 'bad' : 'good');
    return { steps, bad, waited, sc };
  }

  Lab.registerSim('isolation', {
    stepped: true, warm: 0, height: 330,
    init(s) { const r = run(s.p.scen, s.p.level); s.st = { r, i: 0, e: 0 }; },
    onParam(s) { this.init(s); },
    stepCount(s) { return s.st.r.steps.length; },
    step(s, dt) {
      const st = s.st; st.e += dt;
      const last = st.i >= st.r.steps.length - 1;
      if (st.e >= (last ? STEP * 2.2 : STEP)) { st.e = 0; st.i = last ? 0 : st.i + 1; }
    },
    draw(s) {
      const st = s.st, C = s.C, n = s.narrow, W = s.w, sc = st.r.sc, cur = st.r.steps[st.i];
      s.setCap(`<b>${st.i + 1}/${st.r.steps.length}</b>${cur.cap}`);
      const lane = (id, y) => {
        const ops = id === 1 ? sc.t1 : sc.t2, done = id === 1 ? cur.t1i : cur.t2i, blk = id === 1 ? cur.b1 : cur.b2;
        tx('T' + id, 14, y + 15, { m: 1, s: 14, w: 700, a: 'left', c: id === 1 ? C.accent : C.violet });
        const x0 = 46, bw = (W - x0 - 14) / ops.length;
        ops.forEach((o, i) => {
          const isCur = i === done && cur.actor === id, past = i < done;
          const col = o.op === 'commit' ? C.good : o.op === 'rollback' ? C.bad : id === 1 ? C.accent : C.violet;
          const waiting = blk && i === done;
          box(x0 + i * bw + 3, y, bw - 6, 30, { r: 6, fill: past ? col : 'transparent', stroke: waiting ? C.bad : past || isCur ? col : C.line, dash: waiting ? [4, 3] : null, lw: waiting || isCur ? 2 : 1 });
          const label = n ? (o.op === 'read' ? 'SELECT' : o.op === 'count' ? 'COUNT(*)' : o.op.toUpperCase()) : o.sql;
          let fs = 11; while (fs > 8 && Lab.draw.textW(label, { m: 1, s: fs, w: 600 }) > bw - 14) fs -= 0.5;
          tx(label, x0 + i * bw + bw / 2, y + 15, { m: 1, s: fs, w: 600, c: past ? C.surface : C.ink });
          if (waiting) tx('waiting…', x0 + i * bw + bw / 2, y + (id === 1 ? 42 : -10), { m: 1, s: 10, w: 700, c: C.bad });
        });
      };
      lane(1, 14); lane(2, s.h - 46);
      // the table: committed value + uncommitted (pending) value + locks
      const cols = sc === SCEN.dirty ? ['Status'] : ['Speed'];
      const tw = Math.min(W - 28, 460), tx0 = (W - tw) / 2, ty = 84, rh = 30;
      tx('Vehicles', tx0, ty - 10, { m: 1, s: 11, w: 700, a: 'left' });
      tx('committed', tx0 + tw * 0.38, ty - 10, { m: 1, s: 9, c: C.muted });
      tx('uncommitted', tx0 + tw * 0.62, ty - 10, { m: 1, s: 9, c: C.muted });
      if (!n) tx('locks', tx0 + tw * 0.88, ty - 10, { m: 1, s: 9, c: C.muted });
      cur.rows.forEach((r, i) => {
        const y = ty + i * rh;
        box(tx0, y, tw, rh - 4, { r: 5 });
        tx('Id ' + r.id, tx0 + 8, y + rh / 2 - 2, { m: 1, s: 11, w: 600, a: 'left' });
        tx(r.committed ? String(r.committed[cols[0]]) : '—', tx0 + tw * 0.38, y + rh / 2 - 2, { m: 1, s: 12, w: 700, c: C.a2 });
        if (r.pending) {
          box(tx0 + tw * 0.5, y + 3, tw * 0.24, rh - 10, { r: 4, fill: null, stroke: r.pending.txn === 1 ? C.accent : C.violet, dash: [3, 2] });
          tx(`${r.pending.v[cols[0]]} (T${r.pending.txn})`, tx0 + tw * 0.62, y + rh / 2 - 2, { m: 1, s: 11, w: 700, c: r.pending.txn === 1 ? C.accent : C.violet });
        }
        const lk = [...r.S.map(x => 'S:T' + x), ...(r.X ? ['X:T' + r.X] : [])].join(' ');
        if (lk) tx(lk, n ? tx0 + tw - 6 : tx0 + tw * 0.88, y + rh / 2 - 2, { m: 1, s: n ? 8 : 10, w: 700, c: C.bad, a: n ? 'right' : 'center' });
      });
      if (cur.range.length) tx(`key-range lock (Speed > 100): T${cur.range.join(',')}`, tx0 + tw, ty + cur.rows.length * rh + 6, { m: 1, s: 10, w: 700, c: C.bad, a: 'right' });
      const rd = cur.reads[1].length ? `T1 read: ${cur.reads[1].join(' → ')}` : cur.reads[2].length ? `T2 read: ${cur.reads[2].join(' → ')}` : '';
      if (rd) tx(rd, tx0, ty + cur.rows.length * rh + 6, { m: 1, s: 11, w: 700, a: 'left', c: C.ink });
      if (cur.kind === 'bad' || cur.kind === 'good') tx(cur.kind === 'bad' ? `✗ ${sc.title}` : '✓ متسق', W - 14, ty - 10, { m: 1, s: 12, w: 700, a: 'right', c: cur.kind === 'bad' ? C.bad : C.good });
    },
    stats(s) {
      const r = s.st.r;
      return [['الظاهرة', r.bad ? 'حصلت ✗' : 'اتمنعت ✓', r.bad ? 'bad' : 'good'], ['مرات الانتظار (blocking)', String(r.waited), r.waited ? 'warn' : 'good'], ['الخطوات', String(r.steps.length)]];
    }
  });

  Lab.registerLesson({
    id: 'isolation', lab: 'databases', title: 'Isolation Levels',
    html: Lab.tpl.lesson({
      sim: 'isolation', level: 3, caption: true,
      terms: ['Isolation Level', 'Dirty Read', 'Non-repeatable Read', 'Phantom', 'Snapshot'],
      lede: 'اتنين transactions شغالين على نفس الجدول في نفس الوقت. اختار السيناريو والـ Isolation Level، والمحاكاة بتنفذ الخطوات بقواعد الـ locks والـ versions الحقيقية. الأحمر المتقطع يعني transaction واقفة مستنية lock.',
      aria: 'محاكاة خطوة بخطوة لـ isolation levels',
      controls: [
        { type: 'seg', p: 'scen', label: 'السيناريو', value: 'dirty', opts: [['dirty', 'Dirty Read'], ['nonrep', 'Non-repeatable Read'], ['phantom', 'Phantom']] },
        { type: 'seg', p: 'level', label: 'Isolation Level', value: 'ru', opts: [['ru', 'READ UNCOMMITTED'], ['rc', 'READ COMMITTED'], ['rcsi', 'RCSI'], ['rr', 'REPEATABLE READ'], ['ser', 'SERIALIZABLE'], ['snap', 'SNAPSHOT']] }
      ],
      idea: `
        <p>الـ <b>Isolation Level</b> بيحدد transaction تقدر تشوف قد إيه من شغل transactions تانية لسه شغالة. كل مستوى بيمنع مشكلة أكتر، بس بتمن: locks أكتر وانتظار أكتر، أو نسخ قديمة من الصفوف.</p>
        <p><b>Dirty Read</b>: قريت تعديل لسه متعملوش COMMIT، وممكن يتلغي. <b>Non-repeatable Read</b>: قريت نفس الصف مرتين في نفس الـ transaction ولقيت قيمتين مختلفتين. <b>Phantom</b>: نفس الشرط رجّع عدد صفوف مختلف لأن صف جديد اتضاف. الـ <b>Snapshot</b> و الـ <b>RCSI</b> بيحلوا المشكلة بطريقة تانية: بيقروا نسخة committed قديمة من الصف (row versioning) بدل ما يستنوا الـ lock.</p>`,
      real: `
        <p>Job بيحسب فاتورة شهرية لعميل: أول خطوة بتعد العربيات اللي تعدّت السرعة، والخطوة التانية بتجيب تفاصيلها. لو عربية اتضافت في النص، العدد في الفاتورة مش هيطابق التفاصيل. والعكس: شاشة الـ dispatch اللي بتقرا بـ <code>NOLOCK</code> ممكن تعرض عربية «Stolen» لثانية من تعديل اتلغى، وتبعت تنبيه غلط.</p>`,
      try: 'Dirty Read مع READ UNCOMMITTED: T2 بيقرا Stolen. غيّر لـ READ COMMITTED: T2 بيستنى. غيّر لـ RCSI: T2 بيقرا Active من غير ما يستنى. بعدين Phantom مع REPEATABLE READ: الصف الجديد بيظهر. غيّر لـ SERIALIZABLE: الـ INSERT هو اللي بيستنى.',
      also: 'تقارير البنوك والـ reconciliation آخر اليوم، والحجوزات في الألعاب الجماعية (نفس المقعد أو نفس الـ item).',
      net: `
<pre><span class="c">-- مستوى الـ session (الـ default: READ COMMITTED)</span>
SET TRANSACTION ISOLATION LEVEL SNAPSHOT;

<span class="c">-- على مستوى الداتابيز (مرة واحدة)</span>
ALTER DATABASE Tracking SET READ_COMMITTED_SNAPSHOT ON;
ALTER DATABASE Tracking SET ALLOW_SNAPSHOT_ISOLATION ON;

<span class="c">-- NOLOCK = READ UNCOMMITTED للجدول ده</span>
SELECT * FROM Vehicles WITH (NOLOCK);</pre>
<pre><span class="c">// .NET / EF Core</span>
await using var tx = await db.Database
  .BeginTransactionAsync(IsolationLevel.Serializable);
<span class="c">// أو TransactionScope (خد بالك: الـ default بتاعه Serializable)</span>
using var scope = new TransactionScope(
  TransactionScopeOption.Required,
  new TransactionOptions { IsolationLevel = IsolationLevel.ReadCommitted },
  TransactionScopeAsyncFlowOption.Enabled);</pre>`,
      deep: [
        '<b>الـ default في SQL Server</b> هو READ COMMITTED بالـ locking. في <b>Azure SQL Database</b> الـ default إن <code>READ_COMMITTED_SNAPSHOT</code> شغال، فنفس الكود بيتصرف مختلف: القراية مبتستناش الكتابة.',
        '<b>RCSI مقابل SNAPSHOT:</b> الـ RCSI بياخد snapshot جديد مع كل statement، فالـ Non-repeatable Read لسه ممكن. الـ SNAPSHOT بياخد snapshot واحد للـ transaction كلها (من أول قراية)، فبيمنع الاتنين. التمن: الـ version store في <code>tempdb</code> بيكبر، ولو اتنين عدّلوا نفس الصف في SNAPSHOT التاني بياخد update conflict (error 3960).',
        '<b>NOLOCK مش «أسرع ببلاش»:</b> بيقرا داتا uncommitted، وممكن كمان يقرا نفس الصف مرتين أو ميقراهوش خالص لو حصل page split أثناء الـ scan. لو المشكلة إن القراية بتستنى الكتابة، RCSI غالبًا هو الحل الأنضف.',
        '<b>TransactionScope</b> الـ default بتاعه <code>Serializable</code>، وده سبب شائع لـ blocking و deadlocks في تطبيقات .NET. حدد الـ IsolationLevel صراحة.',
        '<b>SERIALIZABLE في SQL Server</b> بيستخدم key-range locks على الـ index. لو مفيش index مناسب للشرط، ممكن يقفل range كبير جدًا أو الجدول كله.',
        '<b>تبسيطات:</b> المحاكاة بتمثل الـ locks على مستوى الصف بس (من غير page/table locks ومن غير lock escalation)، والـ key-range lock على شرط واحد. الترتيب بين الخطوتين ثابت عشان الظاهرة تبان.'
      ]
    })
  });
})();
