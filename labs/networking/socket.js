/* Networking · IP و Port و Socket
   The server's kernel keeps a table of TCP connections keyed by the 4-tuple
     (source IP, source port, destination IP, destination port)
   plus listening sockets keyed by the local port only. For every incoming packet it really does the lookup here:
     exact 4-tuple match → that connection's socket (and the process that owns it)
     SYN to a listening port → a new connection row is created
     nothing listening on that port → RST
   Devices may each have their own public IP, or sit behind carrier-grade NAT and share one public IP: then only the
   source port tells them apart. Counters come from the lookups. */
(function () {
  "use strict";
  const { clamp, lerp, fmt, f1 } = Lab.util;
  const { box, tx, dot, line, arrow, alpha } = Lab.draw;

  const SERVER = '203.0.113.10', FLY = 0.9;

  function fresh(s) {
    const n = s.p.devices, rnd = s.rng, shared = s.p.nat === 'cgnat', clients = [], used = new Set();
    for (let i = 0; i < n; i++) {
      const ip = shared ? '198.51.100.7' : `198.51.100.${10 + i}`;
      // a NAT never hands the same public port to two devices
      let port; do port = 40000 + Math.floor(rnd() * 20000); while (used.has(port)); used.add(port);
      clients.push({ name: `GPS-${101 + i}`, ip, port, dport: 5000, proc: 'Ingest' });
    }
    clients.push({ name: 'dashboard', ip: '192.0.2.44', port: 51000 + Math.floor(rnd() * 9000), dport: 443, proc: 'Web' });
    s.st = { clients, conns: new Map(), flying: [], next: s.t + 0.2, hits: 0, rst: 0, newc: 0, hot: null, hotT: 0, log: [] };
  }
  const key = (c) => `${c.ip}:${c.port}→${SERVER}:${c.dport}`;

  Lab.registerSim('socket', {
    height: 400, warm: 0,
    init(s) { fresh(s); },
    onParam(s) { fresh(s); },

    act: {
      closed(s) { const c = s.st.clients[0]; s.st.flying.push({ c: { ...c, dport: 6000 }, t0: s.t, syn: true, stray: true }); }
    },

    step(s) {
      const st = s.st, t = s.t;
      if (t >= st.next) {
        const c = st.clients[Math.floor(s.rng() * st.clients.length)];
        st.flying.push({ c, t0: t, syn: !st.conns.has(key(c)) });
        st.next = t + 0.35 + s.rng() * 0.3;
      }
      st.flying = st.flying.filter(f => {
        if (t - f.t0 < FLY) return true;
        // the kernel's lookup
        const k = key(f.c), listening = f.c.dport === 5000 || f.c.dport === 443;
        if (st.conns.has(k)) { st.hits++; st.hot = k; st.log.unshift(`match ${k}`); }
        else if (f.syn && listening) { st.conns.set(k, { ...f.c, t: t }); st.newc++; st.hot = k; st.log.unshift(`SYN → listening :${f.c.dport} → new connection`); }
        else { st.rst++; st.hot = null; st.log.unshift(`nothing on :${f.c.dport} → RST`); }
        st.hotT = t; st.log.length = Math.min(st.log.length, 4);
        return false;
      });
    },

    draw(s) {
      const C = s.C, st = s.st, t = s.t, W = s.w, H = s.h, n = s.narrow;
      const lx = 14, lw = n ? 120 : 190, rx = n ? W * 0.42 : W * 0.44, rw = W - 14 - rx;
      tx('clients (public IP : source port)', lx, 14, { m: 1, s: n ? 8.5 : 10.5, w: 700, a: 'left', c: C.accent });
      tx(`server ${SERVER}`, rx, 14, { m: 1, s: n ? 8.5 : 10.5, w: 700, a: 'left', c: C.a2 });
      const rows = Math.min(st.clients.length, 14), ch = Math.min(24, (H - 40) / rows);
      const cy = i => 30 + i * ch + ch / 2;
      st.clients.slice(0, rows).forEach((c, i) => {
        const y = cy(i), dash = c.name === 'dashboard';
        tx(n ? c.name : `${c.name}  ${c.ip}:${c.port}`, lx, y, { m: 1, s: n ? 8 : 9.5, a: 'left', c: dash ? C.violet : C.ink });
      });
      if (st.clients.length > rows) tx(`+${st.clients.length - rows} more`, lx, H - 10, { m: 1, s: 9, a: 'left', c: C.muted });
      // listening sockets
      const lsY = 30;
      box(rx, lsY, rw, 38, { r: 6, fill: C.surface, stroke: C.violet });
      if (n) { tx('LISTEN *:5000 → Ingest', rx + 6, lsY + 12, { m: 1, s: 7.5, w: 700, a: 'left', c: C.violet }); tx('LISTEN *:443 → Web', rx + 6, lsY + 26, { m: 1, s: 7.5, w: 700, a: 'left', c: C.violet }); }
      else tx('LISTEN  *:5000 → Ingest.exe     LISTEN  *:443 → Web.exe', rx + 8, lsY + 19, { m: 1, s: 9.5, w: 700, a: 'left', c: C.violet });
      // connection table
      const tY = lsY + 52, conns = [...st.conns.values()];
      tx(`ESTABLISHED connections: ${conns.length}`, rx, tY - 4, { m: 1, s: n ? 8.5 : 10, w: 700, a: 'left', c: C.muted });
      const rh = Math.min(20, (H - tY - 90) / Math.max(8, Math.min(conns.length, 12)));
      conns.slice(-12).forEach((c, i) => {
        const y = tY + 6 + i * rh, k = key(c), hot = k === st.hot && t - st.hotT < 0.6;
        box(rx, y, rw, rh - 2, { r: 3, fill: hot ? C.a2 : C.surface, stroke: C.line });
        tx(n ? `${c.ip.split('.').pop()}:${c.port}→:${c.dport}` : `${c.ip}:${c.port} → ${SERVER}:${c.dport}   ${c.proc}`, rx + 6, y + rh / 2 - 1, { m: 1, s: n ? 7.5 : 9, a: 'left', c: hot ? C.surface : C.ink });
      });
      // packets in flight
      for (const f of st.flying) {
        const i = st.clients.indexOf(f.c.dport === 6000 ? st.clients[0] : f.c), k = (t - f.t0) / FLY;
        const y0 = cy(Math.min(Math.max(i, 0), rows - 1)), x = lerp(lx + lw, rx - 6, k), y = lerp(y0, lsY + 19, k);
        dot(x, y, 4.5, f.stray ? C.bad : f.syn ? C.violet : f.c.dport === 443 ? C.violet : C.accent);
      }
      st.log.forEach((l, i) => tx(l, rx, H - 58 + i * 15, { m: 1, s: n ? 7.5 : 9.5, a: 'left', c: l.includes('RST') ? C.bad : i ? C.muted : C.ink }));
    },

    stats(s) {
      const st = s.st, ips = new Set(st.clients.map(c => c.ip)).size, cg = st.clients.filter(c => c.ip === '198.51.100.7').length;
      return [
        ['Connections مفتوحة', String(st.conns.size)],
        ['IPs مختلفة / clients', `${ips} / ${st.clients.length}`, ips < st.clients.length / 2 ? 'warn' : ''],
        ['Packets اتوزعت بالـ 4-tuple', fmt(st.hits), 'good'],
        ['RST (مفيش حد بيسمع)', String(st.rst), st.rst ? 'bad' : ''],
        ['Ports مستخدمة من IP الـ NAT', cg ? `${cg} من ~64K` : '—']
      ];
    }
  });

  Lab.registerLesson({
    id: 'socket', lab: 'networking', title: 'IP و Port و Socket',
    html: Lab.tpl.lesson({
      sim: 'socket', level: 1,
      terms: ['IP Address', 'Port', 'Socket', '4-tuple', 'Listening Socket'],
      lede: 'أجهزة GPS ومتصفح dashboard بيكلموا سيرفر واحد. كل packet داخل، الـ kernel بيدوّر عليه في جدول الـ connections بالـ <b>4-tuple</b> (IP المصدر، port المصدر، IP الهدف، port الهدف) ويسلّمه للـ socket الصح. الـ SYN بيروح للـ listening socket ويعمل connection جديد.',
      aria: 'محاكاة جدول connections بيوزع packets بالـ 4-tuple',
      acts: [['closed', 'ابعت لـ port مقفول (6000)']],
      controls: [
        { type: 'range', p: 'devices', label: 'عدد الأجهزة', min: 3, max: 30, step: 1, value: 8 },
        { type: 'seg', p: 'nat', label: 'IPs الأجهزة', value: 'own', opts: [['own', 'كل جهاز IP لوحده'], ['cgnat', 'كلهم ورا IP واحد (CGNAT)']] }
      ],
      idea: `
        <p>الـ <b>IP Address</b> بيحدد الجهاز على الشبكة، والـ <b>Port</b> (رقم من 0 لـ 65535) بيحدد البرنامج جوه الجهاز. السيرفر بيعمل <b>Listening Socket</b> على port ثابت (5000 مثلًا) ويستنى.</p>
        <p>كل connection بعد كده <b>Socket</b> لوحده، متعرّف بالـ <b>4-tuple</b> كله. عشان كده السيرفر يقدر يبقى عنده آلاف الـ connections على نفس الـ port 5000: الفرق بينهم في IP وport العميل. ولو packet جه لـ port مفيش حد بيسمع عليه، الـ kernel بيرد بـ RST (connection refused).</p>`,
      real: `
        <p>10,000 جهاز GPS كلهم بيكلموا <code>ingest.fleet.com:5000</code>. أغلب شبكات الموبايل بتحط آلاف الأجهزة ورا IP عام واحد (CGNAT)، فالسيرفر بيشوف مئات الأجهزة بنفس الـ IP وports مختلفة. يعني: متعتمدش على الـ IP عشان تعرف الجهاز (اعتمد على ID جوه البروتوكول)، ومتعملش rate limit بالـ IP لوحده وإلا هتقفل على مئات العربيات مرة واحدة.</p>`,
      try: 'شوف السطر الأخضر في الجدول: كل packet بيتطابق مع row واحد بالظبط. اختار «كلهم ورا IP واحد»: الـ IP واحد للكل، والـ port بس هو اللي بيفرّق، والجدول لسه شغال صح. بعدين اضغط «ابعت لـ port مقفول»: RST.',
      also: 'web server عليه 50,000 متصفح على port 443، وsignalR hub، وقاعدة البيانات (port 1433) بآلاف الـ connections من الـ app servers. كله نفس الجدول.',
      net: `
<pre><span class="c">// السيرفر: socket واحد بيسمع، وكل Accept يدّيك socket جديد للـ connection</span>
var listener = new TcpListener(IPAddress.Any, 5000);
listener.Start();
var conn = await listener.AcceptSocketAsync();
Console.WriteLine($"{conn.RemoteEndPoint} → {conn.LocalEndPoint}");   <span class="c">// الـ 4-tuple</span>

<span class="c">// ASP.NET Core: نفس المعلومة جوه الـ request</span>
var remote = $"{HttpContext.Connection.RemoteIpAddress}:{HttpContext.Connection.RemotePort}";
<span class="c">// ورا load balancer أو proxy: الـ IP الحقيقي في X-Forwarded-For (UseForwardedHeaders)</span></pre>`,
      netTitle: 'في .NET',
      deep: [
        '<b>Port مش «قناة» محجوزة لعميل:</b> السيرفر مش بيستهلك port لكل connection؛ الـ 50,000 connection كلهم على 443. الحد الحقيقي ذاكرة وdescriptors (شوف <a href="#/os/fd">File Descriptors</a>). العميل هو اللي بيستهلك ephemeral port لكل connection.',
        '<b>حد الـ 64K:</b> من IP عميل واحد لنفس السيرفر ونفس الـ port، أقصى عدد connections متزامنة = عدد الـ source ports المتاحة. الـ CGNAT والـ proxies بيوصلوا للحد ده، وعشان كده بيستخدموا كذا IP عام.',
        '<b>RST مقابل timeout:</b> port مقفول على جهاز شغال = RST فورًا (connection refused). جهاز مش موجود أو firewall بيرمي الـ packets بصمت = timeout بعد ثواني. الفرق ده مهم في تشخيص المشاكل.',
        '<b>UDP:</b> مفيش connections؛ socket واحد بيستقبل من الكل، و<code>ReceiveFromAsync</code> بيقولك مين بعت كل datagram. البرنامج هو اللي يتابع مين مين.',
        '<b>تبسيطات:</b> IPv4 بس، والعناوين من المديات المخصصة للأمثلة (198.51.100.0/24 وغيرها). مفيش FIN ولا انتهاء connections.'
      ]
    })
  });
})();
