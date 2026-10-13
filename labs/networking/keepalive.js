/* Networking · Keep-Alive و Connection Pooling
   The dashboard loads N vehicle panels, one API call each (HTTPS, TLS 1.3). The schedule is computed from the rules:
     new connection per request  every request pays TCP (1 RTT) + TLS (1 RTT) + request (1 RTT); at most P at once
     HTTP/1.1 keep-alive pool    up to P connections; a connection's first request pays the handshakes, later ones
                                 1 RTT; one request at a time per connection (the rest wait for a free one)
     HTTP/2                      one connection, handshakes once, then every request is multiplexed on it at once
   Server time is 20 ms per request. The timeline is that schedule; totals and counts come from it. */
(function () {
  "use strict";
  const { clamp, lerp, fmt, f1 } = Lab.util;
  const { box, tx, line, alpha } = Lab.draw;

  const SRV = 0.02, SHOW = 5;

  function plan(p) {
    const R = p.rtt / 1000, N = p.n, P = p.mode === 'h2' ? 1 : p.par, rows = [];
    let conns = 0, handshakes = 0;
    if (p.mode === 'h2') {
      const row = []; rows.push(row); conns = 1; handshakes = 1;
      row.push({ a: 0, b: R, k: 'tcp' }, { a: R, b: 2 * R, k: 'tls' });
      for (let i = 0; i < N; i++) row.push({ a: 2 * R, b: 3 * R + SRV, k: 'req', lane: i });
      return { rows, total: 3 * R + SRV, conns, handshakes, R };
    }
    const free = Array.from({ length: P }, () => ({ t: 0, open: false, row: null }));
    for (let i = 0; i < N; i++) {
      // the slot that frees up first takes the next request
      free.sort((x, y) => x.t - y.t);
      const c = free[0];
      const fresh = p.mode === 'new' || !c.open;
      if (!c.row || p.mode === 'new') { c.row = []; rows.push(c.row); conns++; }
      let t = c.t;
      if (fresh) { c.row.push({ a: t, b: t + R, k: 'tcp' }, { a: t + R, b: t + 2 * R, k: 'tls' }); t += 2 * R; handshakes++; c.open = true; }
      c.row.push({ a: t, b: t + R + SRV, k: 'req' }); t += R + SRV;
      c.t = t;
    }
    const total = Math.max(...free.map(c => c.t));
    return { rows, total, conns, handshakes, R };
  }

  Lab.registerSim('keepalive', {
    height: 380, warm: 0,
    init(s) { s.st = { pl: plan(s.p), t0: s.t, all: { new: plan({ ...s.p, mode: 'new' }), ka: plan({ ...s.p, mode: 'ka' }), h2: plan({ ...s.p, mode: 'h2' }) } }; },
    onParam(s) { this.init(s); },
    step(s) { if (s.t - s.st.t0 > SHOW + 2.5) this.init(s); },

    draw(s) {
      const C = s.C, st = s.st, pl = st.pl, W = s.w, H = s.h, n = s.narrow;
      const x0 = n ? 40 : 60, x1 = W - 14, maxT = Math.max(...Object.values(st.all).map(v => v.total));
      const now = clamp((s.t - st.t0) / SHOW, 0, 1) * pl.total;
      const X = t => lerp(x0, x1, t / maxT);
      tx(`${s.p.n} API calls · RTT ${s.p.rtt} ms · server 20 ms each`, 14, 14, { m: 1, s: n ? 9 : 11, a: 'left', c: C.muted });
      const rowsShown = pl.rows.slice(0, 14), top = 32, rh = Math.min(26, (H - 110) / Math.max(rowsShown.length, 4));
      rowsShown.forEach((row, i) => {
        const y = top + i * rh;
        tx(`conn ${i + 1}`, 14, y + rh / 2, { m: 1, s: 8.5, a: 'left', c: C.violet });
        box(x0, y + 2, x1 - x0, rh - 4, { r: 3, fill: C.bg, stroke: null });
        const reqs = row.filter(sg => sg.k === 'req').length;
        row.forEach(sg => {
          if (sg.a > now) return;
          const b = Math.min(sg.b, now), col = sg.k === 'tcp' ? C.muted : sg.k === 'tls' ? C.violet : C.accent;
          // multiplexed requests share the row: draw them as thin stacked lines
          if (s.p.mode === 'h2' && sg.k === 'req') { const hh = Math.max(1, (rh - 6) / reqs); box(X(sg.a), y + 3 + sg.lane * hh, Math.max(1, X(b) - X(sg.a)), Math.max(1, hh - 0.5), { r: 0, fill: sg.b <= now ? C.a2 : C.accent, stroke: null }); return; }
          box(X(sg.a), y + 3, Math.max(1, X(b) - X(sg.a)), rh - 6, { r: 2, fill: sg.k === 'req' && sg.b <= now ? C.a2 : col, stroke: C.bg });
        });
      });
      if (pl.rows.length > rowsShown.length) tx(`+${pl.rows.length - rowsShown.length} more connections`, 14, top + rowsShown.length * rh + 8, { m: 1, s: 9, a: 'left', c: C.muted });
      // totals for all three
      const by = H - 70, names = { new: 'new connection each', ka: `keep-alive pool (${s.p.par})`, h2: 'HTTP/2 (1 conn)' };
      Object.entries(st.all).forEach(([k, v], i) => {
        const y = by + i * 20, cur = (k === 'ka' && s.p.mode === 'ka') || k === s.p.mode;
        tx(names[k], 14, y + 6, { m: 1, s: n ? 8 : 9.5, w: cur ? 700 : 500, a: 'left', c: cur ? C.ink : C.muted });
        box(x0 + (n ? 70 : 110), y, (x1 - x0 - (n ? 70 : 110) - 60) * v.total / maxT, 12, { r: 3, fill: cur ? C.accent : C.line, stroke: null });
        tx(`${fmt(v.total * 1000)} ms`, x0 + (n ? 70 : 110) + (x1 - x0 - (n ? 70 : 110) - 60) * v.total / maxT + 6, y + 6, { m: 1, s: 9, a: 'left', c: C.muted });
      });
    },

    stats(s) {
      const pl = s.st.pl, h2 = s.st.all.h2;
      return [
        ['الصفحة كلها اتحملت في', fmt(pl.total * 1000) + ' ms', pl.total > 2 * h2.total ? 'bad' : pl.total > 1.2 * h2.total ? 'warn' : 'good'],
        ['Connections اتفتحت', String(pl.conns), pl.conns > 6 ? 'bad' : 'good'],
        ['TCP + TLS handshakes', String(pl.handshakes), pl.handshakes > 6 ? 'bad' : ''],
        ['وقت الـ handshakes كله', fmt(pl.handshakes * 2 * pl.R * 1000) + ' ms']
      ];
    }
  });

  Lab.registerLesson({
    id: 'keepalive', lab: 'networking', title: 'Keep-Alive و Connection Pooling',
    html: Lab.tpl.lesson({
      sim: 'keepalive', level: 2,
      terms: ['Keep-Alive', 'Connection Pool', 'HTTP/1.1', 'HTTP/2', 'Multiplexing'],
      lede: 'الـ dashboard بيحمّل كذا panel، كل واحد API call على HTTPS. كل صف connection: الرمادي TCP handshake، والبنفسجي TLS، والبرتقالي request مستني رده (بيبقى تركواز لما يخلص). تحت: الطرق التلاتة جنب بعض.',
      aria: 'timeline لـ connections بـ keep-alive مقابل connection لكل request مقابل HTTP/2',
      controls: [
        { type: 'seg', p: 'mode', label: 'الطريقة', value: 'new', opts: [['new', 'connection لكل request'], ['ka', 'Keep-Alive pool'], ['h2', 'HTTP/2']] },
        { type: 'range', p: 'n', label: 'عدد الـ API calls', min: 1, max: 30, step: 1, value: 12 },
        { type: 'range', p: 'par', label: 'Connections متوازية (HTTP/1.1)', min: 1, max: 8, step: 1, value: 6 },
        { type: 'range', p: 'rtt', label: 'RTT', min: 10, max: 300, step: 10, value: 100, unit: 'ms' }
      ],
      idea: `
        <p>فتح connection HTTPS جديد بيكلّف round trip للـ TCP وround trip (أو أكتر) للـ TLS قبل أي request. <b>Keep-Alive</b> معناه إن الـ connection يفضل مفتوح بعد الرد، والـ request الجاي يعدّي عليه على طول: round trip واحد.</p>
        <p>الـ <b>Connection Pool</b> بيحتفظ بكذا connection مفتوحين ويوزّع عليهم الـ requests. في HTTP/1.1 الـ connection بيشيل request واحد في المرة، فالمتصفح بيفتح 6 بالكتير لكل سيرفر. <b>HTTP/2</b> بيبعت كل الـ requests على connection واحد في نفس الوقت (<b>Multiplexing</b>).</p>`,
      real: `
        <p>تطبيق الـ dispatcher بيعمل call لكل عربية على حدة. لو كل call بـ <code>new HttpClient()</code> (connection جديد كل مرة)، كل call بيدفع 3 round trips بدل واحد، وعلى RTT 100 ms ده 300 ms لكل عربية. ونفس الكلام بين الـ microservices: service بتنادي service تانية 1,000 مرة في الثانية من غير pooling = 1,000 handshake في الثانية من CPU وports.</p>`,
      try: 'سيبها على «connection لكل request»: 12 handshake. بدّل لـ Keep-Alive: 6 handshakes بس، والـ requests التانية على connections مفتوحة. وHTTP/2: handshake واحد وكل الـ requests مع بعض. خلّي الـ parallel connections = 1 مع Keep-Alive: الطلبات بتستنى ورا بعض (head-of-line على الـ connection).',
      also: 'الاتصال بقاعدة البيانات (<a href="#/databases/connection-pool">Connection Pool</a>)، وgRPC (HTTP/2 تحت الغطا)، وRedis وRabbitMQ: كلهم connection طويل العمر بيتعاد استخدامه.',
      net: `
<pre><span class="c">// HttpClient واحد (أو IHttpClientFactory) = pool مشترك وkeep-alive افتراضيًا</span>
builder.Services.AddHttpClient("vehicles", c =&gt; c.BaseAddress = new("https://api.fleet.com"))
    .ConfigurePrimaryHttpMessageHandler(() =&gt; new SocketsHttpHandler {
        PooledConnectionLifetime = TimeSpan.FromMinutes(5),     <span class="c">// يتجدد عشان الـ DNS</span>
        PooledConnectionIdleTimeout = TimeSpan.FromMinutes(1),
        MaxConnectionsPerServer = 20,                            <span class="c">// HTTP/1.1</span>
        EnableMultipleHttp2Connections = true
    });

<span class="c">// HTTP/2: request واحد على connection واحد لكل الطلبات</span>
var req = new HttpRequestMessage(HttpMethod.Get, url) { Version = HttpVersion.Version20 };</pre>`,
      netTitle: 'في .NET',
      deep: [
        '<b>Idle timeouts بين الطرفين:</b> الـ server والـ load balancer والـ client كل واحد ليه idle timeout. لو الـ server بيقفل بعد 60 ثانية والـ client فاكره مفتوح لـ 90، أول request بعد دقيقة بيفشل (connection reset). خلّي timeout العميل أقصر من السيرفر.',
        '<b>HTTP/2 مش سحر:</b> كل الـ streams على TCP connection واحد، فلو packet ضاع الكل بيستنى (head-of-line على مستوى TCP). على شبكات بفقد عالي، كذا connection HTTP/1.1 ممكن تبقى أحسن، وده اللي HTTP/3 (QUIC) اتعمل يحله.',
        '<b>Load balancing مع connections طويلة:</b> لو كل client عنده connection واحد HTTP/2 طويل العمر، الـ load balancer على مستوى الـ connection مش هيوزّع الطلبات. محتاج L7 balancing أو إن الـ connections تتجدد كل فترة.',
        '<b>Bandwidth مش محسوب هنا:</b> مع ردود كبيرة، الـ requests المتعددة على HTTP/2 بتتقاسم نفس الـ bandwidth ومش هتخلص كلها في نفس اللحظة.',
        '<b>تبسيطات:</b> TLS 1.3 (round trip واحد)، ومفيش packet loss، والسيرفر بيرد في 20 ms ثابت، والـ connections بتتفتح لما يحتاجها request.'
      ]
    })
  });
})();
