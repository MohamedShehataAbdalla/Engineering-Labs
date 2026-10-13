/* OS · File Descriptors و Sockets
   Two limits every server hits, modelled with a real port table and a real descriptor count (scaled down):
   1) Outbound: our service calls an internal API.
        new HttpClient per request → a new TCP connection each time: a fresh ephemeral port and descriptor; after the
                                     response the client closes first, so the port sits in TIME_WAIT before reuse
        one shared HttpClient       → a few keep-alive connections, reused for every request
      600 ephemeral ports here stand for ~16K (Windows 49152–65535) / ~28K (Linux), and 30 s of TIME_WAIT stands for
      60 s (Linux) to 240 s (Windows default).
   2) Inbound: GPS devices keep a TCP connection open to our ingest server. Every open socket is a file descriptor,
      and the process may not open more than `ulimit -n` of them (1,024 is a common default soft limit).
   Ports in use / TIME_WAIT, descriptors and failures are counted by the model. */
(function () {
  "use strict";
  const { clamp, lerp, fmt, f1, expo, Meter } = Lab.util;
  const { box, tx, dot, line, alpha } = Lab.draw;

  const PORTS = 600, TW = 30, REQ = 0.15, BASE_FD = 40, POOL_IDLE = 90;

  function fresh(s) {
    s.st = {
      ports: new Float64Array(PORTS),          // 0 free · >0 TIME_WAIT until · -1 in use
      next: s.t + 0.02, active: [], pool: [], ok: new Meter(5), fail: new Meter(5), fails: 0, oks: 0,
      devices: 0, rejected: 0, lastErr: ''
    };
  }
  function freePort(st, t) { for (let i = 0; i < PORTS; i++) { const v = st.ports[i]; if (v === 0 || (v > 0 && v <= t)) return i; } return -1; }

  Lab.registerSim('fd', {
    height: 360, warm: 4,
    init(s) { fresh(s); },
    onParam(s, k) { if (k === 'mode') fresh(s); },

    fds(s) { const st = s.st; return BASE_FD + this.outSockets(s) + st.devices; },
    // shared mode: requests ride on pooled connections, so only the pool holds sockets
    outSockets(s) { const st = s.st; return s.p.mode === 'shared' ? st.pool.length : st.active.length; },

    step(s, dt) {
      const st = s.st, t = s.t, shared = s.p.mode === 'shared', limit = s.p.ulimit;
      // inbound: devices connect (or disconnect) toward the chosen number
      const want = s.p.devices;
      let budget = Math.ceil(dt * 400);
      while (st.devices < want && budget-- > 0) {
        if (this.fds(s) >= limit) { st.rejected++; st.lastErr = 'accept(): Too many open files (EMFILE)'; break; }
        st.devices++;
      }
      while (st.devices > want) st.devices--;

      // outbound requests
      while (st.next <= t) {
        st.next += expo(s.p.rate, s.rng);
        if (shared) {
          let c = st.pool.find(x => !x.busy);
          if (!c) {
            const p = freePort(st, t);
            if (p < 0 || this.fds(s) >= limit) { st.fails++; st.fail.add(t); st.lastErr = p < 0 ? 'SocketException: no free ephemeral port' : 'Too many open files'; continue; }
            st.ports[p] = -1; c = { port: p, busy: false, idle: t }; st.pool.push(c);
          }
          c.busy = true; st.active.push({ conn: c, end: t + REQ * (0.6 + s.rng() * 0.8), shared: true });
        } else {
          const p = freePort(st, t);
          if (p < 0 || this.fds(s) >= limit) { st.fails++; st.fail.add(t); st.lastErr = p < 0 ? 'SocketException: no free ephemeral port' : 'Too many open files'; continue; }
          st.ports[p] = -1; st.active.push({ port: p, end: t + REQ * (0.6 + s.rng() * 0.8), shared: false });
        }
      }
      st.active = st.active.filter(a => {
        if (a.end > t) return true;
        st.oks++; st.ok.add(t);
        if (a.shared) { a.conn.busy = false; a.conn.idle = t; }
        else st.ports[a.port] = t + TW;                    // we closed first → TIME_WAIT
        return false;
      });
      // pooled connections idle too long are closed (they go to TIME_WAIT too)
      if (shared) st.pool = st.pool.filter(c => { if (!c.busy && t - c.idle > POOL_IDLE) { st.ports[c.port] = t + TW; return false; } return true; });
    },

    counts(s) {
      const st = s.st, t = s.t; let inUse = 0, tw = 0;
      for (let i = 0; i < PORTS; i++) { const v = st.ports[i]; if (v < 0) inUse++; else if (v > t) tw++; }
      return { inUse, tw, free: PORTS - inUse - tw };
    },

    draw(s) {
      const C = s.C, st = s.st, t = s.t, W = s.w, H = s.h, n = s.narrow, c = this.counts(s);
      const x0 = 14, x1 = W - 14, leftW = n ? x1 - x0 : (x1 - x0) * 0.58;
      tx(`outbound: ${s.p.mode === 'shared' ? 'one shared HttpClient (keep-alive pool)' : 'new HttpClient() per request'}`, x0, 14, { m: 1, s: n ? 9 : 11, w: 700, a: 'left', c: s.p.mode === 'shared' ? C.good : C.accent });
      // port table
      const cols = 30, rows = PORTS / cols, cs = Math.min(leftW / cols, (n ? 140 : 210) / rows);
      for (let i = 0; i < PORTS; i++) {
        const v = st.ports[i], x = x0 + (i % cols) * cs, y = 30 + Math.floor(i / cols) * cs;
        const col = v < 0 ? C.accent : v > t ? C.violet : C.bg;
        box(x + 0.5, y + 0.5, cs - 1, cs - 1, { r: 1, fill: col, stroke: v === 0 || (v > 0 && v <= t) ? C.line : null });
      }
      const ly = 30 + rows * cs + 14;
      tx(`ephemeral ports: ${c.inUse} in use · ${c.tw} TIME_WAIT · ${c.free} free`, x0, ly, { m: 1, s: n ? 8.5 : 10.5, w: 700, a: 'left', c: c.free < 30 ? C.bad : C.muted });

      // descriptors
      const fx = n ? x0 : x0 + leftW + 22, fw = x1 - fx, fy = n ? ly + 26 : 30;
      const fds = this.fds(s), lim = s.p.ulimit;
      tx(`process file descriptors (ulimit -n ${fmt(lim)})`, fx, fy, { m: 1, s: n ? 8.5 : 10.5, w: 700, a: 'left', c: fds >= lim ? C.bad : C.ink });
      const bh = n ? 18 : 26, by = fy + 12, scale = Math.max(lim, fds) * 1.05;
      box(fx, by, fw, bh, { r: 5, fill: C.bg, stroke: C.line });
      const segs = [[BASE_FD, C.muted, 'files, logs, epoll'], [st.devices, C.a2, 'device sockets'], [this.outSockets(s), C.accent, 'outbound sockets']];
      let acc = 0;
      segs.forEach(([v, col]) => { box(fx + fw * acc / scale, by, Math.max(0, fw * v / scale), bh, { r: 0, fill: col, stroke: null }); acc += v; });
      line(fx + fw * lim / scale, by - 4, fx + fw * lim / scale, by + bh + 4, C.bad, 2);
      if (!n) segs.forEach(([v, col, label], i) => tx(`${label}: ${fmt(v)}`, fx, by + bh + 16 + i * 15, { m: 1, s: 9.5, a: 'left', c: col }));
      tx(`${fmt(fds)} / ${fmt(lim)}`, fx + fw, fy, { m: 1, s: n ? 8.5 : 10.5, w: 700, a: 'right', c: fds >= lim ? C.bad : C.muted });

      const okR = st.ok.rate(t), failR = st.fail.rate(t);
      tx(`requests: ${f1(okR)}/s ok · ${f1(failR)}/s failed`, x0, H - 30, { m: 1, s: n ? 9 : 11, w: 700, a: 'left', c: failR ? C.bad : C.good });
      if (st.lastErr && (failR || st.rejected)) tx(st.lastErr, x0, H - 12, { m: 1, s: n ? 8.5 : 10, a: 'left', c: C.bad });
    },

    stats(s) {
      const st = s.st, c = this.counts(s), fds = this.fds(s);
      return [
        ['Ports في TIME_WAIT', fmt(c.tw), c.tw > PORTS * 0.7 ? 'bad' : c.tw > PORTS * 0.3 ? 'warn' : 'good'],
        ['Ports فاضية', `${fmt(c.free)} / ${PORTS}`, c.free < 30 ? 'bad' : ''],
        ['Requests فشلت', fmt(st.fails), st.fails ? 'bad' : 'good'],
        ['File descriptors', `${fmt(fds)} / ${fmt(s.p.ulimit)}`, fds >= s.p.ulimit ? 'bad' : fds > s.p.ulimit * 0.8 ? 'warn' : 'good'],
        ['Devices اترفضوا (EMFILE)', fmt(st.rejected), st.rejected ? 'bad' : '']
      ];
    }
  });

  Lab.registerLesson({
    id: 'fd', lab: 'os', title: 'File Descriptors',
    html: Lab.tpl.lesson({
      sim: 'fd', level: 3,
      terms: ['File Descriptor', 'Socket', 'Ephemeral Port', 'TIME_WAIT', 'ulimit'],
      lede: 'مشكلتين بيضربوا أي سيرفر. شمال: الـ ports اللي خدمتنا بتفتح منها connections (البرتقالي شغال، والبنفسجي <b>TIME_WAIT</b>: اتقفل بس لسه محجوز). يمين: عدد الـ <b>file descriptors</b> اللي الـ process فاتحها، والخط الأحمر هو الحد.',
      aria: 'محاكاة استهلاك ephemeral ports و file descriptors',
      controls: [
        { type: 'seg', p: 'mode', label: 'الـ HttpClient', value: 'new', opts: [['new', 'new HttpClient() لكل request'], ['shared', 'واحد مشترك (pool)']] },
        { type: 'range', p: 'rate', label: 'Requests خارجة في الثانية', min: 2, max: 40, step: 1, value: 25 },
        { type: 'range', p: 'devices', label: 'أجهزة GPS متوصلة', min: 0, max: 3000, step: 100, value: 600 },
        { type: 'seg', p: 'ulimit', label: 'ulimit -n', value: 1024, opts: [[1024, '1,024 (default)'], [65536, '65,536']] }
      ],
      idea: `
        <p>الـ <b>File Descriptor</b> رقم بيديه الـ OS للـ process عن كل حاجة مفتوحة: ملف، pipe، و<b>Socket</b>. كل connection TCP = descriptor، والـ process ليه حد أقصى (<b>ulimit -n</b> على Linux). لو وصله، أي <code>accept</code> أو <code>open</code> بيفشل بـ «Too many open files».</p>
        <p>كل connection خارجة كمان محتاجة <b>Ephemeral Port</b> من مدى محدود (عشرات الآلاف). واللي يقفل الـ connection الأول بيفضل الـ port بتاعه في <b>TIME_WAIT</b> لفترة (من دقيقة لـ 4 دقايق) قبل ما يتعاد استخدامه، عشان أي packets متأخرة متلخبطش connection جديد.</p>`,
      real: `
        <p>10,000 جهاز GPS متوصلين بـ TCP دايم بالسيرفر = 10,000 descriptor. على Linux الـ soft limit الافتراضي غالبًا 1,024 (systemd و Docker بيرفعوه غالبًا)، فالجهاز رقم ألف وشوية مش هيعرف يتوصل والـ log مليان EMFILE.</p>
        <p>وفي نفس السيرفر، كود بيعمل <code>using var http = new HttpClient()</code> لكل رسالة عشان يبعت notification: كل مرة connection جديد، وكل واحد بيفضل في TIME_WAIT. الحساب بسيط: على Windows حوالي 16,000 port ÷ 240 ثانية = أي حاجة فوق 68 request في الثانية لنفس السيرفر بتخلّص الـ ports، وبعدين <code>SocketException</code> رغم إن الـ CPU والذاكرة تمام. (هنا: 600 port ÷ 30 ثانية = 20 في الثانية.)</p>`,
      try: 'سيبها على «new HttpClient()» و25 request: البنفسجي بيملا الـ ports لحد ما الـ requests تبدأ تفشل. نزّلها لـ 15: 450 port بس في TIME_WAIT في أي وقت، فمبيخلصوش. بدّل لـ «واحد مشترك»: كام connection بس، بيتعاد استخدامهم، وصفر TIME_WAIT. بعدين ارفع الأجهزة لـ 1,500 مع ulimit 1,024: الأجهزة بتترفض. غيّر الـ ulimit لـ 65,536 والمشكلة بتختفي.',
      also: 'chat server بآلاف WebSockets مفتوحة، و game server، وأي proxy أو gateway (كل request داخل = 2 sockets: واحد للعميل وواحد للـ backend).',
      net: `
<pre><span class="c">// ❌ connection جديد لكل request + TIME_WAIT</span>
using var http = new HttpClient();
await http.PostAsJsonAsync(url, alert);

<span class="c">// ✓ IHttpClientFactory: pool مشترك بيتعاد استخدامه، وبيتجدد عشان تغيّر الـ DNS</span>
builder.Services.AddHttpClient&lt;AlertsClient&gt;(c =&gt; c.BaseAddress = new(alertsUrl));

<span class="c">// ✓ أو HttpClient واحد static مع SocketsHttpHandler</span>
static readonly HttpClient Http = new(new SocketsHttpHandler {
    PooledConnectionLifetime = TimeSpan.FromMinutes(5),
    MaxConnectionsPerServer = 50 });</pre>
<pre><span class="c"># Linux: الحد الحالي، وعدد الـ descriptors المفتوحة، وحالة الـ sockets</span>
ulimit -n
ls /proc/&lt;pid&gt;/fd | wc -l
ss -s                       <span class="c"># كام TIME_WAIT و ESTABLISHED</span></pre>`,
      netTitle: 'في .NET و Linux',
      deep: [
        '<b>TIME_WAIT مش bug:</b> بيحمي من packets متأخرة من connection قديم توصل لـ connection جديد بنفس الـ ports. بيحصل عند اللي يقفل الأول. الحل مش إنك تقصّره بإعدادات الـ kernel؛ الحل إنك متفتحش connections كتير (keep-alive و pooling).',
        '<b>HttpClient و Dispose:</b> <code>HttpClient</code> متعمل عشان يتعاد استخدامه. عمله ورميه في كل request بيقفل الـ connection. والعكس كمان مشكلة: HttpClient واحد عايش للأبد مش بيشوف تغيير الـ DNS، وعشان كده <code>PooledConnectionLifetime</code> أو <code>IHttpClientFactory</code>.',
        '<b>TIME_WAIT مش بياخد descriptor:</b> الـ socket اتقفل من ناحية الـ process (الـ descriptor رجع)، بس الـ kernel لسه ماسك الـ port. عشان كده ممكن تفشل بـ «no free port» والـ descriptors قليلة، أو العكس.',
        '<b>Limits تانية:</b> غير <code>ulimit -n</code> فيه حد على مستوى الـ system كله (<code>fs.file-max</code>)، وطابور الـ accept (<code>somaxconn</code>) لو الأجهزة بتتوصل أسرع من ما السيرفر بيقبل، وذاكرة الـ kernel لكل socket (buffers). 100,000 connection مفتوح محتاجين ضبط في كل دول.',
        '<b>تبسيطات:</b> 600 port و30 ثانية TIME_WAIT بدل ~16-28 ألف و60-240 ثانية عشان تشوفها تحصل في دقيقة. الـ pool المشترك بيقفل الـ connection لو فضل فاضي 90 ثانية.'
      ]
    })
  });
})();
