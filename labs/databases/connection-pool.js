/* Databases · Connection Pool (exhaustion, timeout, leak)
   ADO.NET-style pool: a request takes an idle connection, or opens a new physical one if the pool is below Max Pool
   Size (opening costs a login round), or waits in a FIFO queue. Waiting longer than the timeout fails the request
   ("Timeout expired … max pool size was reached"). With "leak" on, some requests never return their connection. */
(function () {
  "use strict";
  const { clamp, lerp, ease, fmt, f1, Meter, spawnLoop } = Lab.util;
  const { box, tx, dot, circ, ring, line, hatch, cyl, alpha } = Lab.draw;

  const OPEN_T = 0.3, TIMEOUT = 4;

  Lab.registerSim('connection-pool', {
    height: 290, warm: 6,
    init(s) {
      s.st = { conns: [], q: [], next: 0, done: new Meter(5), fails: new Meter(5), opens: 0, leaked: 0, waits: [], flash: [] };
    },
    onParam(s, k) {
      if (k === 'max') { const st = s.st; while (st.conns.length > s.p.max) { const i = st.conns.findIndex(c => c.state === 'idle'); if (i < 0) break; st.conns.splice(i, 1); } }
      if (k === 'leak' && !s.p.leak) { /* leaked connections stay leaked until reset — like a real leak */ }
    },

    step(s) {
      const st = s.st, p = s.p, t = s.t;
      spawnLoop(st, t, p.rps, s.rng, () => { if (st.q.length < 200) st.q.push({ born: t, y: s.rng() }); });
      // finish work / opening
      for (const c of st.conns) {
        if (c.state === 'opening' && t >= c.until) { c.state = 'busy'; c.until = t + p.dur * (0.7 + s.rng() * 0.6); }
        else if (c.state === 'busy' && t >= c.until) {
          st.done.add(t);
          if (p.leak && s.rng() < 0.1) { c.state = 'leaked'; st.leaked++; }   // forgot Dispose(): never comes back
          else { c.state = 'idle'; c.req = null; }
        }
      }
      // timeouts
      for (const r of st.q) if (t - r.born >= TIMEOUT) { r.dead = 1; st.fails.add(t); st.flash.push({ t, y: r.y }); }
      st.q = st.q.filter(r => !r.dead);
      st.flash = st.flash.filter(f => t - f.t < 1);
      // hand out connections FIFO
      while (st.q.length) {
        let c = st.conns.find(x => x.state === 'idle');
        if (!c && st.conns.length < p.max) { c = { state: 'opening', id: st.conns.length + 1 }; st.conns.push(c); st.opens++; }
        else if (!c) break;
        const r = st.q.shift();
        st.waits.push(t - r.born); if (st.waits.length > 60) st.waits.shift();
        c.req = r; c.t0 = t;
        if (c.state === 'opening') c.until = t + OPEN_T;
        else { c.state = 'busy'; c.until = t + p.dur * (0.7 + s.rng() * 0.6); }
      }
    },

    draw(s) {
      const st = s.st, p = s.p, C = s.C, n = s.narrow, W = s.w, H = s.h, t = s.t;
      const dbW = n ? 56 : 80, qx0 = W - 16, qx1 = W * (n ? 0.66 : 0.7);
      const px0 = dbW + (n ? 24 : 50), px1 = qx1 - (n ? 14 : 30), py0 = 46;
      const cols = Math.ceil(Math.sqrt(p.max * (px1 - px0) / (H - 102))), rows = Math.ceil(p.max / cols);
      const cw = (px1 - px0 - 12) / cols, ch = Math.min(46, (H - 114) / rows), py1 = py0 + rows * ch + 12;
      // DB
      cyl(12, H / 2 - 40, dbW, 80, { stroke: C.line }); tx('SQL', 12 + dbW / 2, H / 2 + 4, { m: 1, s: 11, w: 700 });
      // pool frame with Max Pool Size slots
      box(px0, py0, px1 - px0, py1 - py0, { r: 10, fill: 'transparent', stroke: C.violet, dash: [5, 4] });
      tx(`Connection Pool · Max Pool Size = ${p.max}`, (px0 + px1) / 2, py0 - 12, { m: 1, s: n ? 9 : 11, w: 700, c: C.violet });
      for (let i = 0; i < p.max; i++) {
        const x = px0 + 6 + (i % cols) * cw, y = py0 + 6 + Math.floor(i / cols) * ch, c = st.conns[i];
        const bw = cw - 6, bh = ch - 6;
        if (!c) { box(x, y, bw, bh, { r: 5, fill: 'transparent', stroke: C.line, dash: [2, 3] }); continue; }
        if (c.state === 'idle') box(x, y, bw, bh, { r: 5, stroke: C.good, lw: 1.5 });
        else if (c.state === 'opening') { box(x, y, bw, bh, { r: 5, fill: 'transparent', stroke: C.accent, dash: [3, 2], lw: 1.5 }); if (bw > 26) tx('open', x + bw / 2, y + bh / 2, { m: 1, s: 9, c: C.accent }); }
        else if (c.state === 'busy') {
          box(x, y, bw, bh, { r: 5, fill: C.a2, stroke: null });
          alpha(0.45, () => box(x + 3, y + bh - 6, (bw - 6) * clamp((t - c.t0) / Math.max(0.01, c.until - c.t0), 0, 1), 3, { r: 0, fill: C.ink, stroke: null }));
        } else { box(x, y, bw, bh, { r: 5, stroke: C.bad, lw: 1.5 }); hatch(x, y, bw, bh, C.bad); }
      }
      // links to DB for every physical connection
      const open = st.conns.length;
      alpha(0.6, () => { for (let i = 0; i < Math.min(open, 12); i++) line(dbW + 12, H / 2 - 30 + i * 5, px0, H / 2 - 30 + i * 5, C.line, 1); });
      // waiting requests (queue) with their wait timers
      tx('Requests', qx0, py0 - 12, { m: 1, s: 10, c: C.muted, a: 'right' });
      const slot = 13, perRow = Math.max(1, Math.floor((qx0 - qx1) / slot));
      st.q.forEach((r, i) => {
        if (i >= perRow * 14) return;
        const x = qx1 + 8 + (i % perRow) * slot, y = py0 + 8 + Math.floor(i / perRow) * slot;
        const k = (t - r.born) / TIMEOUT;
        dot(x, y, 4, k > 0.6 ? C.bad : C.accent);
      });
      if (st.q.length > perRow * 14) tx('+' + (st.q.length - perRow * 14), qx0, py1, { m: 1, s: 10, w: 700, c: C.bad, a: 'right' });
      for (const f of st.flash) alpha(1 - (t - f.t), () => tx('Timeout ✗', (qx0 + qx1) / 2, py1 - 8 - f.y * 40, { m: 1, s: 10, w: 700, c: C.bad }));
      // legend
      const ly = H - 18; let lx = 14;
      for (const [l, c, kind] of [['idle', C.good, 'o'], ['busy', C.a2, 'f'], ['opening', C.accent, 'd'], ['leaked', C.bad, 'h']]) {
        box(lx, ly - 6, 12, 12, { r: 3, fill: kind === 'f' ? c : 'transparent', stroke: kind === 'f' ? null : c, dash: kind === 'd' ? [2, 2] : null });
        if (kind === 'h') hatch(lx, ly - 6, 12, 12, c);
        tx(l, lx + 16, ly, { m: 1, s: 10, a: 'left', c: C.muted }); lx += Lab.draw.textW(l, { m: 1, s: 10 }) + 34;
      }
    },

    stats(s) {
      const st = s.st, p = s.p, t = s.t;
      const busy = st.conns.filter(c => c.state === 'busy' || c.state === 'opening').length;
      const need = p.rps * p.dur;
      const avgW = st.waits.length ? st.waits.reduce((a, b) => a + b, 0) / st.waits.length : 0;
      const fr = st.fails.rate(t);
      return [
        ["الـ connections المطلوبة", f1(need) + " conn", need > p.max - st.leaked ? 'bad' : need > (p.max - st.leaked) * 0.8 ? 'warn' : 'good'],
        ['In use / Max', `${busy + st.leaked} / ${p.max}`, busy + st.leaked >= p.max ? 'bad' : ''],
        ['Requests مستنية', fmt(st.q.length), st.q.length > 5 ? 'bad' : st.q.length ? 'warn' : 'good'],
        ['متوسط انتظار connection', f1(avgW) + ' s', avgW > 1 ? 'bad' : avgW > 0.2 ? 'warn' : 'good'],
        ['Timeouts', f1(fr) + ' /s', fr > 0.05 ? 'bad' : 'good'],
        ['Throughput', f1(st.done.rate(t)) + ' req/s'],
        ['Leaked connections', fmt(st.leaked), st.leaked ? 'bad' : 'good'],
        ['Physical opens', fmt(st.opens)]
      ];
    }
  });

  Lab.registerLesson({
    id: 'connection-pool', lab: 'databases', title: 'Connection Pool',
    html: Lab.tpl.lesson({
      sim: 'connection-pool', level: 2,
      terms: ['Connection Pool', 'Max Pool Size', 'Pool Exhaustion', 'Connection Leak'],
      lede: 'كل request محتاج connection للداتابيز. الـ pool بيدّي connection فاضي (أخضر)، أو يفتح واحد جديد لو لسه تحت الـ Max، أو الـ request يستنى على اليمين. لو استنى أكتر من 4 ثواني بياخد Timeout.',
      aria: 'محاكاة connection pool مع exhaustion و leak',
      controls: [
        { type: 'range', p: 'max', label: 'Max Pool Size', min: 2, max: 30, step: 1, value: 10 },
        { type: 'range', p: 'rps', label: 'Requests في الثانية', min: 1, max: 40, step: 1, value: 12, unit: 'req/s' },
        { type: 'range', p: 'dur', label: 'مدة الاستعلام', min: 0.1, max: 2, step: 0.1, value: 0.5, unit: 's' },
        { type: 'seg', p: 'leak', label: "إرجاع الـ connection للـ pool", value: "false", opts: [["false", "دايمًا بـ using"], ["true", "leak: 10% منهم بيضيعوا"]] }
      ],
      idea: `
        <p>فتح connection جديد للداتابيز مكلف: TCP، وTLS، وlogin. عشان كده ADO.NET بيحتفظ بـ <b>Connection Pool</b>: لما تعمل <code>Close</code> أو <code>Dispose</code> الـ connection بيرجع للـ pool بدل ما يتقفل، والـ request الجاي بياخده جاهز.</p>
        <p>الـ pool ليه حد: <b>Max Pool Size</b> (الـ default في SqlClient هو 100). لو كل الـ connections مشغولة، الـ request بيستنى. لو الانتظار عدّى الـ timeout، بياخد exception. ده <b>Pool Exhaustion</b>. وأشهر سبب ليه مش الحمل، هو الـ <b>Connection Leak</b>: كود فتح connection ومرجّعهوش.</p>`,
      real: `
        <p>Endpoint التقارير بيعمل query بياخد 2 ثانية، وبيجيله 60 request في الثانية. حسب <b>Little's Law</b> محتاج حوالي 120 connection في نفس اللحظة، والـ pool فيه 100. النتيجة: requests بتستنى وتاخد timeout، والـ API كله بيقف، حتى الـ endpoints السريعة، لأنهم بيستنوا في نفس الطابور. الحل عادة إنك تسرّع الاستعلام، مش تكبّر الـ pool.</p>`,
      try: 'خلّي RPS = 12 والمدة 0.5: «الـ connections المطلوبة» = 12 × 0.5 = 6 والـ pool فيه 10، فمفيش انتظار. ارفع المدة لـ 1.2: المحتاج بقى 14.4 وهتشوف الطابور والـ timeouts. بعدين رجّع المدة 0.5 وفعّل الـ leak: الـ pool بيتملي بالأحمر لوحده حتى مع حمل قليل.',
      also: 'أي service بيكلّم داتابيز أو Redis أو HTTP API تاني (<code>HttpClient</code> عنده pool هو كمان): بوابات الدفع، الشات، الـ microservices.',
      net: `
<pre><span class="c">// صح: using بيرجّع الـ connection للـ pool حتى لو حصل exception</span>
await using var conn = new SqlConnection(cs);
await conn.OpenAsync();

<span class="c">// غلط: لو حصل exception قبل Close، الـ connection ضاع (leak)</span>
var conn2 = new SqlConnection(cs);
await conn2.OpenAsync();
var data = await Query(conn2);  <span class="c">// throws</span>
conn2.Close();</pre>
<pre><span class="c">// إعدادات الـ pool في الـ connection string</span>
"Server=db;Database=Tracking;Max Pool Size=200;
 Min Pool Size=10;Connect Timeout=15;"

<span class="c">// EF Core: الـ DbContext بيفتح ويقفل لوحده</span>
builder.Services.AddDbContextPool&lt;TrackingDb&gt;(o =&gt; o.UseSqlServer(cs));</pre>`,
      deep: [
        '<b>الرسالة اللي هتشوفها:</b> <i>Timeout expired. The timeout period elapsed prior to obtaining a connection from the pool. This may have occurred because all pooled connections were in use and max pool size was reached.</i> ده مش timeout في الاستعلام نفسه، ده انتظار على الـ pool.',
        '<b>Little\'s Law</b>: عدد الـ connections المشغولة في المتوسط = معدل الوصول × مدة الاستخدام. ده بيقولك تحتاج pool قد إيه، وبيوضح ليه تسريع الاستعلام من 2 ثانية لـ 200ms بيقلل الاحتياج 10 مرات.',
        '<b>كل connection string مختلف = pool منفصل</b>، وكل process ليه pools بتاعته. 10 instances من الـ API في كل واحد Max 100 ممكن يفتحوا 1,000 connection على نفس الـ SQL Server. ابعت الحساب ده لمسؤول الداتابيز.',
        '<b>Sync over async بيستنزف الـ pool بطريقة غير مباشرة:</b> لو الـ thread pool جاع (starvation)، الـ connections بتفضل محجوزة لـ requests مش لاقية thread تكمّل بيه. شوف معمل OS (Thread Pool).',
        '<b>AddDbContextPool</b> بيعمل pool للـ DbContext objects نفسها (عشان يوفر تكلفة إنشائها)، وده غير الـ connection pool اللي في SqlClient. الاتنين شغالين مع بعض.',
        '<b>تبسيطات:</b> الـ timeout هنا 4 ثواني بدل 15 (الـ default في SqlClient)، وفتح connection بياخد 0.3 ثانية، والـ connections الفاضية مبتتقفلش. في الحقيقة SqlClient بيقفل الـ idle connections بعد بضع دقايق.'
      ]
    })
  });
})();
