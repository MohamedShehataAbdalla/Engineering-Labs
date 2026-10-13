/* Networking · HTTP و HTTPS و TLS Handshake
   The dashboard asks the API for vehicle positions over a fresh connection. The message flights follow each
   protocol's rules; each arrow takes one-way delay = RTT/2, and a side only sends once it has what it waits for:
     HTTP            TCP handshake → request → response                                         2 RTT
     TLS 1.2 (full)  TCP → ClientHello → ServerHello+Certificate+Done → KeyExchange+Finished
                     → Finished → request → response                                           4 RTT
     TLS 1.3 (full)  TCP → ClientHello+key share → ServerHello+…+Finished → Finished + request  3 RTT
     TLS 1.3 0-RTT   TCP → ClientHello + early data (the request, resumed session) → response   2 RTT
     HTTP/3 (QUIC)   QUIC+TLS 1.3 together over UDP → request                                   2 RTT
   Time to first byte is computed from the flights. Handshake byte sizes are typical, approximate values. */
(function () {
  "use strict";
  const { clamp, lerp, fmt, f1 } = Lab.util;
  const { box, tx, line, arrow, alpha } = Lab.draw;

  const SHOW = 6.5;
  const FLOWS = {
    http: [['c', 'SYN', 'tcp'], ['s', 'SYN-ACK', 'tcp'], ['c', 'ACK + GET /vehicles', 'req'], ['s', '200 OK (JSON)', 'res']],
    tls12: [['c', 'SYN', 'tcp'], ['s', 'SYN-ACK', 'tcp'], ['c', 'ACK + ClientHello', 'tls', 250], ['s', 'ServerHello, Certificate, Done', 'tls', 4000],
      ['c', 'ClientKeyExchange, Finished', 'tls', 130], ['s', 'Finished', 'tls', 50], ['c', 'GET /vehicles (encrypted)', 'req'], ['s', '200 OK', 'res']],
    tls13: [['c', 'SYN', 'tcp'], ['s', 'SYN-ACK', 'tcp'], ['c', 'ACK + ClientHello (key share)', 'tls', 300], ['s', 'ServerHello, Cert, Finished', 'tls', 4000],
      ['c', 'Finished + GET /vehicles', 'req', 80], ['s', '200 OK', 'res']],
    zero: [['c', 'SYN', 'tcp'], ['s', 'SYN-ACK', 'tcp'], ['c', 'ClientHello (PSK) + early data: GET', 'req', 400], ['s', 'ServerHello, Finished + 200 OK', 'res', 300]],
    quic: [['c', 'Initial: ClientHello (UDP)', 'tls', 1250], ['s', 'Initial+Handshake: ServerHello, Cert, Fin', 'tls', 4000], ['c', 'Handshake Fin + GET /vehicles', 'req', 100], ['s', '200 OK', 'res']]
  };

  function build(mode, rtt) {
    const ow = rtt / 2, flow = FLOWS[mode], ev = [];
    let t = 0, prev = null;
    flow.forEach(([from, label, kind, bytes]) => {
      if (prev && prev !== from) t += ow;          // wait for the other side's flight to arrive
      ev.push({ from, label, kind, bytes: bytes || 0, t0: t, t1: t + ow });
      prev = from;
    });
    const last = ev[ev.length - 1];
    return { ev, ttfb: last.t1, rtts: last.t1 / rtt, hsBytes: ev.filter(e => e.kind === 'tls' || e.bytes).reduce((a, e) => a + e.bytes, 0) };
  }

  Lab.registerSim('tls', {
    height: 380, warm: 0,
    init(s) { s.st = { ex: build(s.p.mode, s.p.rtt / 1000), t0: s.t, all: Object.fromEntries(Object.keys(FLOWS).map(k => [k, build(k, s.p.rtt / 1000)])) }; },
    onParam(s) { this.init(s); },
    step(s) { if (s.t - s.st.t0 > SHOW + 2.5) this.init(s); },

    draw(s) {
      const C = s.C, st = s.st, ex = st.ex, W = s.w, H = s.h, n = s.narrow;
      const cx = n ? 46 : W * 0.2, sx = n ? W - 46 : W * 0.62, top = 40, bot = H - 26, maxT = 2.2 * s.p.rtt / 1000 * 1.05;
      const k = clamp((s.t - st.t0) / SHOW, 0, 1), now = k * ex.ttfb * 1.05;
      const Y = t => lerp(top, bot, t / Math.max(ex.ttfb * 1.05, maxT));
      tx('browser', cx, 16, { m: 1, s: n ? 9.5 : 11.5, w: 700, c: C.accent });
      tx('api.fleet.com', sx, 16, { m: 1, s: n ? 9.5 : 11.5, w: 700, c: C.a2 });
      line(cx, top - 6, cx, bot, C.line, 2); line(sx, top - 6, sx, bot, C.line, 2);
      for (const e of ex.ev) {
        if (e.t0 > now) continue;
        const a = e.from === 'c' ? cx : sx, b = e.from === 'c' ? sx : cx, kk = clamp((now - e.t0) / (e.t1 - e.t0), 0, 1);
        const col = e.kind === 'tcp' ? C.muted : e.kind === 'tls' ? C.violet : e.kind === 'req' ? C.accent : C.a2;
        const xe = lerp(a, b, kk), ye = lerp(Y(e.t0), Y(e.t1), kk);
        if (kk >= 1) arrow(a, Y(e.t0), xe, ye, col, 1.8); else line(a, Y(e.t0), xe, ye, col, 1.8);
        if (kk > 0.45) tx(e.label + (e.bytes && !n ? `  ~${fmt(e.bytes)} B` : ''), (a + b) / 2, lerp(Y(e.t0), Y(e.t1), 0.5) - 8, { m: 1, s: n ? 7.5 : 9.5, w: 700, c: col });
      }
      if (now >= ex.ttfb) tx(`first byte of the answer: ${fmt(ex.ttfb * 1000)} ms = ${f1(ex.rtts)} RTT`, (cx + sx) / 2, bot + 12, { m: 1, s: n ? 9 : 11, w: 700, c: ex.rtts > 3 ? C.bad : ex.rtts > 2 ? C.accent : C.good });
      // comparison bars (wide)
      if (!n) {
        const bx = W * 0.7, bw = W - 14 - bx, names = { http: 'HTTP (no TLS)', tls12: 'TLS 1.2', tls13: 'TLS 1.3', zero: 'TLS 1.3 0-RTT', quic: 'HTTP/3 (QUIC)' };
        const maxv = Math.max(...Object.values(st.all).map(x => x.ttfb));
        tx('time to first byte, new connection', bx, top, { m: 1, s: 10, w: 700, a: 'left', c: C.muted });
        Object.entries(st.all).forEach(([key, v], i) => {
          const y = top + 18 + i * 42, cur = key === s.p.mode;
          tx(names[key], bx, y, { m: 1, s: 10, w: cur ? 700 : 500, a: 'left', c: cur ? C.ink : C.muted });
          box(bx, y + 8, bw * 0.72 * v.ttfb / maxv, 14, { r: 3, fill: cur ? C.accent : C.line, stroke: null });
          tx(`${fmt(v.ttfb * 1000)} ms`, bx + bw * 0.72 * v.ttfb / maxv + 4, y + 15, { m: 1, s: 9, a: 'left', c: C.muted });
        });
      }
    },

    stats(s) {
      const ex = s.st.ex, http = s.st.all.http;
      return [
        ['Time to first byte', fmt(ex.ttfb * 1000) + ' ms', ex.rtts > 3 ? 'bad' : ex.rtts > 2 ? 'warn' : 'good'],
        ['بالـ round trips', f1(ex.rtts) + ' RTT'],
        ['زيادة على HTTP من غير تشفير', '+' + fmt((ex.ttfb - http.ttfb) * 1000) + ' ms', ex.ttfb > http.ttfb ? 'warn' : 'good'],
        ['Handshake bytes (تقريبًا)', ex.hsBytes ? '~' + fmt(ex.hsBytes) + ' B' : '0'],
        ['Packets (flights)', String(ex.ev.length)]
      ];
    }
  });

  Lab.registerLesson({
    id: 'tls', lab: 'networking', title: 'HTTPS و TLS Handshake',
    html: Lab.tpl.lesson({
      sim: 'tls', level: 2,
      terms: ['HTTPS', 'TLS 1.2', 'TLS 1.3', '0-RTT', 'Certificate'],
      lede: 'الـ dashboard بيطلب مواقع العربيات على connection جديد. الرمادي TCP، والبنفسجي TLS handshake، والبرتقالي الـ request، والتركواز الرد. على اليمين كل البروتوكولات جنب بعض على نفس الـ RTT.',
      aria: 'sequence diagram لـ TLS handshake بإصداراته',
      controls: [
        { type: 'seg', p: 'mode', label: 'البروتوكول', value: 'tls12', opts: [['http', 'HTTP'], ['tls12', 'TLS 1.2'], ['tls13', 'TLS 1.3'], ['zero', 'TLS 1.3 0-RTT'], ['quic', 'HTTP/3']] },
        { type: 'range', p: 'rtt', label: 'RTT', min: 20, max: 400, step: 10, value: 120, unit: 'ms' }
      ],
      idea: `
        <p><b>HTTPS</b> = HTTP جوه <b>TLS</b>. قبل أول request، الطرفين لازم يتفقوا على مفاتيح تشفير، والسيرفر يثبت إنه هو بالـ <b>Certificate</b> (موقّع من جهة موثوقة). ده الـ handshake، وبياخد round trips فوق الـ TCP handshake.</p>
        <p><b>TLS 1.2</b> محتاج 2 RTT. <b>TLS 1.3</b> قلّلها لـ 1 RTT (العميل بيبعت مفتاحه من أول رسالة). ولو اتكلمتوا قبل كده، <b>0-RTT</b> بيسمح للعميل يبعت الـ request مع أول رسالة. و<b>HTTP/3</b> (QUIC) بيدمج handshake الـ transport والتشفير في round trip واحد.</p>`,
      real: `
        <p>تطبيق السواق على شبكة موبايل بـ RTT 150 ms: أول request على connection جديد بـ TLS 1.2 بياخد 600 ms قبل أول byte، ونص الوقت ده handshake بس. نفس الـ request على connection مفتوح من قبل بياخد 150 ms. عشان كده إعادة استخدام الـ connections (<a href="#/networking/keepalive">Keep-Alive</a>) أهم من أي تحسين تاني في الـ API.</p>`,
      try: 'قارن البارات على اليمين على RTT 120: TLS 1.2 ضعف HTTP من غير تشفير، وTLS 1.3 بيوفّر RTT كامل، و0-RTT زي HTTP من غير تشفير. ارفع الـ RTT لـ 400 (قمر صناعي أو شبكة ضعيفة): الفرق بالثواني. ولاحظ إن الـ certificate نفسه هو أكبر رسالة (~4 KB).',
      also: 'كل API بيستخدمه تطبيق موبايل، وبوابات الدفع (TLS إلزامي)، والـ gRPC بين الـ services. وبين الـ microservices جوه الـ data center الـ RTT صغير فالتكلفة أساسًا CPU مش وقت.',
      net: `
<pre><span class="c">// Kestrel: TLS 1.3 لو الـ OS بيدعمه، و HTTP/3 لو اتفعّل</span>
builder.WebHost.ConfigureKestrel(k =&gt; k.ListenAnyIP(443, o =&gt; {
    o.UseHttps();
    o.Protocols = HttpProtocols.Http1AndHttp2AndHttp3;
}));

<span class="c">// العميل: نفس HttpClient = نفس الـ connection = handshake مرة واحدة</span>
var http = new HttpClient(new SocketsHttpHandler {
    SslOptions = { EnabledSslProtocols = SslProtocols.Tls12 | SslProtocols.Tls13 }
}) { DefaultRequestVersion = HttpVersion.Version30, DefaultVersionPolicy = HttpVersionPolicy.RequestVersionOrLower };</pre>`,
      netTitle: 'في .NET',
      deep: [
        '<b>0-RTT ليه ثمن:</b> الـ early data ممكن حد يسجلها ويعيد بعتها (replay). عشان كده بيتسمح بيها بس للـ requests الآمنة اللي تكرارها مش بيضر (GET)، مش «ادفع» أو «اقفل الموتور». وأغلب السيرفرات مقفّلاها افتراضيًا.',
        '<b>الـ certificate chain:</b> السيرفر بيبعت شهادته والشهادات الوسيطة (intermediate) عادةً 3-5 KB. لو أكبر من الـ initial congestion window، بتحتاج round trip زيادة. وOCSP stapling بيوفّر على العميل إنه يروح يسأل هل الشهادة اتلغت.',
        '<b>Session resumption:</b> حتى من غير 0-RTT، الـ resumption بيوفّر حسابات الـ certificate (CPU) لأن الطرفين عندهم secret من المرة اللي فاتت.',
        '<b>TLS termination:</b> أغلب الأنظمة بتفك التشفير عند الـ load balancer أو الـ gateway، وجوه الشبكة الداخلية HTTP أو TLS تاني. أي hop زيادة فيه TLS = handshake زيادة لو الـ connections مش بتتعاد.',
        '<b>تبسيطات:</b> مفيش packet loss، والرسايل الكبيرة (certificate) بتتبعت في flight واحد، ومفيش وقت CPU للتشفير. الـ ClientHello في QUIC متكبّر لـ 1200 byte عمدًا (حماية من amplification attacks).'
      ]
    })
  });
})();
