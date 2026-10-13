/* Networking · TCP 3-Way Handshake
   A sequence diagram generated from the TCP rules, for a GPS device that opens a connection, sends N messages of
   60 bytes and closes it:
     SYN(seq=x) → SYN-ACK(seq=y, ack=x+1) → ACK(ack=y+1), then data segments, each acknowledged,
     then FIN/ACK in both directions; the side that closes first ends in TIME_WAIT.
   One-way delay = RTT/2. Sequence/ack numbers advance by the real byte counts (SYN and FIN count as one).
   "Lose the first SYN": the client hears nothing and retransmits after its initial RTO (1 s, as on Linux).
   Times and packet counts are computed from the generated exchange. */
(function () {
  "use strict";
  const { clamp, lerp, fmt, f1 } = Lab.util;
  const { box, tx, line, arrow, dot, alpha } = Lab.draw;

  const MSG = 60, RTO = 1.0, SHOW = 7;

  function build(p, rnd) {
    const rtt = p.rtt / 1000, ow = rtt / 2, ev = [];
    let x = 1000 + Math.floor(rnd() * 8000), y = 5000 + Math.floor(rnd() * 8000), t = 0;
    const send = (from, label, sub, kind, lost) => {
      const prev = ev[ev.length - 1], e = { from, t0: t, t1: t + ow, label, sub, kind, lost, pos: 0.5 };
      // two packets leaving together: spread their labels along the arrows
      if (prev && prev.from === from && prev.t0 === t) { prev.pos = 0.28; e.pos = 0.72; }
      ev.push(e);
    };
    if (p.lose) { send('c', 'SYN', `seq=${x}`, 'ctl', true); t += RTO; }
    send('c', 'SYN', `seq=${x}`, 'ctl'); t += ow;
    send('s', 'SYN-ACK', `seq=${y} ack=${x + 1}`, 'ctl'); t += ow;
    const established = t;
    send('c', 'ACK', `ack=${y + 1}`, 'ctl');
    let cs = x + 1, firstData = null;
    for (let i = 0; i < p.msgs; i++) {
      send('c', `DATA ${MSG}B`, `seq=${cs}`, 'data'); if (firstData === null) firstData = t + ow; t += ow; cs += MSG;
      send('s', 'ACK', `ack=${cs}`, 'ack'); t += ow;
    }
    const finAt = t;
    send('c', 'FIN', `seq=${cs}`, 'ctl'); t += ow;
    send('s', 'ACK', `ack=${cs + 1}`, 'ack');
    send('s', 'FIN', `seq=${y + 1}`, 'ctl'); t += ow;
    send('c', 'ACK', `ack=${y + 2}`, 'ack');
    const end = t + ow;
    return { ev, rtt, established, firstData, end, finAt, x, y };
  }

  Lab.registerSim('handshake', {
    height: 400, warm: 0,
    init(s) { s.st = { ex: build(s.p, s.rng), t0: s.t }; },
    onParam(s) { this.init(s); },
    step(s) { if (s.t - s.st.t0 > SHOW + 2.5) this.init(s); },

    draw(s) {
      const C = s.C, st = s.st, ex = st.ex, W = s.w, H = s.h, n = s.narrow;
      const cx = n ? 60 : W * 0.24, sx = n ? W - 60 : W * 0.76, top = 40, bot = H - 30;
      const k = clamp((s.t - st.t0) / SHOW, 0, 1), now = k * ex.end * 1.02;
      const Y = t => lerp(top, bot, t / (ex.end * 1.02));
      tx('GPS device', cx, 16, { m: 1, s: n ? 9.5 : 11.5, w: 700, c: C.accent });
      tx('server :5000', sx, 16, { m: 1, s: n ? 9.5 : 11.5, w: 700, c: C.a2 });
      line(cx, top - 6, cx, bot, C.line, 2); line(sx, top - 6, sx, bot, C.line, 2);
      // connection state bands
      alpha(0.12, () => box(cx - 6, Y(ex.established), 12, Y(Math.min(now, ex.finAt)) - Y(ex.established), { r: 3, fill: C.good, stroke: null }));
      for (const e of ex.ev) {
        if (e.t0 > now) continue;
        const a = e.from === 'c' ? cx : sx, b = e.from === 'c' ? sx : cx;
        const kk = clamp((now - e.t0) / (e.t1 - e.t0), 0, 1), lostAt = 0.55;
        const col = e.kind === 'data' ? C.accent : e.kind === 'ack' ? C.a2 : C.violet;
        const endK = e.lost ? Math.min(kk, lostAt) : kk;
        const xe = lerp(a, b, endK), ye = lerp(Y(e.t0), Y(e.t1), endK);
        if (endK >= 1) arrow(a, Y(e.t0), xe, ye, col, 1.8); else line(a, Y(e.t0), xe, ye, col, 1.8);
        if (e.lost && kk >= lostAt) { tx('✕ lost', xe, ye - 10, { m: 1, s: 10, w: 700, c: C.bad }); }
        const mx = lerp(a, b, e.pos), my = lerp(Y(e.t0), Y(e.t1), e.pos);
        if (kk > e.pos - 0.1) {
          tx(e.label, mx, my - 8, { m: 1, s: n ? 8.5 : 10.5, w: 700, c: e.lost ? C.bad : col });
          if (!n) tx(e.sub, mx, my + 6, { m: 1, s: 9, c: C.muted });
        }
      }
      // time axis
      for (const [t, label, col] of [[ex.established, 'connection established', C.good], [ex.firstData, 'first GPS point delivered', C.accent], [ex.finAt, 'FIN: closing', C.violet]]) {
        if (t > now) continue;
        tx(`${label} · ${fmt(t * 1000)} ms`, n ? W / 2 : sx + 14, Y(t), { m: 1, s: n ? 8 : 9.5, w: 700, a: n ? 'center' : 'left', c: col });
      }
      if (now >= ex.end - ex.rtt / 2) tx('TIME_WAIT', cx - 8, bot - 6, { m: 1, s: 9, w: 700, a: 'right', c: C.violet });
      alpha(0.6, () => line(cx - 30, Y(now), sx + 30, Y(now), C.muted, 1, [3, 3]));
    },

    stats(s) {
      const ex = s.st.ex, p = s.p, pkts = ex.ev.length, dataPkts = p.msgs * 2;
      return [
        ['لحد ما الـ connection يتفتح', fmt(ex.established * 1000) + ' ms', ex.established > 0.5 ? 'bad' : ''],
        ['لحد أول نقطة توصل', fmt(ex.firstData * 1000) + ' ms', ex.firstData > 0.5 ? 'bad' : ex.firstData > 0.15 ? 'warn' : 'good'],
        ['Packets كلها / منها داتا وACK', `${pkts} / ${dataPkts}`],
        ['Packets لكل رسالة', f1(pkts / p.msgs), pkts / p.msgs > 4 ? 'bad' : 'good'],
        ['وقت الـ setup والقفل من الإجمالي', f1((1 - p.msgs * ex.rtt / ex.end) * 100) + ' %']
      ];
    }
  });

  Lab.registerLesson({
    id: 'handshake', lab: 'networking', title: 'TCP 3-Way Handshake',
    html: Lab.tpl.lesson({
      sim: 'handshake', level: 1,
      terms: ['3-Way Handshake', 'SYN / SYN-ACK / ACK', 'Sequence Number', 'FIN', 'RTT'],
      lede: 'جهاز GPS بيفتح connection TCP، يبعت رسايل 60 byte، ويقفل. الرسم sequence diagram: الوقت نازل لتحت، وكل سهم packet، وأرقام الـ seq والـ ack بتزيد بعدد الـ bytes الحقيقي. البنفسجي control، والبرتقالي داتا، والتركواز ACK.',
      aria: 'sequence diagram لـ TCP handshake و data و FIN',
      controls: [
        { type: 'range', p: 'rtt', label: 'RTT (رايح جاي)', min: 20, max: 600, step: 20, value: 120, unit: 'ms' },
        { type: 'range', p: 'msgs', label: 'رسايل في الـ connection', min: 1, max: 5, step: 1, value: 1 },
        { type: 'seg', p: 'lose', label: 'أول SYN', value: 'false', opts: [['false', 'وصل'], ['true', 'ضاع']] }
      ],
      idea: `
        <p>قبل أي داتا، TCP لازم يتفق الطرفين: <b>SYN</b> (أنا عايز أكلمك، وأول رقم عندي x)، <b>SYN-ACK</b> (ماشي، استلمت x، وأول رقم عندي y)، <b>ACK</b> (استلمت y). ده الـ <b>3-Way Handshake</b>، وبياخد رحلة رايح جاي كاملة (<b>RTT</b>) قبل ما أول byte داتا يتبعت.</p>
        <p>الـ <b>Sequence Number</b> بيعدّ الـ bytes: الـ ACK بيقول «استلمت كل حاجة لحد الرقم ده، ابعت اللي بعده». ده اللي بيخلّي TCP يكتشف الضايع ويعيد بعته. والقفل بـ <b>FIN</b> من كل ناحية.</p>`,
      real: `
        <p>على شبكة موبايل الـ RTT ممكن يبقى 100-300 ms. جهاز بيفتح connection جديد لكل نقطة GPS بيصرف 1.5 RTT عشان النقطة توصل، و 9 packets لكل رسالة 60 byte. جهاز بيفتح connection مرة ويسيبه مفتوح، كل نقطة بقت packet رايح وACK بس.</p>
        <p>ولو أول SYN ضاع (إشارة ضعيفة)، الجهاز مبيعرفش؛ بيستنى timeout (ثانية على Linux، وفي إعدادات Windows الافتراضية أطول) ويبعت تاني.</p>`,
      try: 'سيبها على رسالة واحدة وRTT 120: «لحد أول نقطة توصل» 180 ms. خلّي الرسايل 5: الـ handshake والقفل بقوا جزء أصغر من الوقت. بعدين خلّي أول SYN «ضاع»: ثانية كاملة ضايعة قبل ما أي حاجة تبدأ. وارفع الـ RTT لـ 600 (قمر صناعي): كل round trip بيبان.',
      also: 'كل HTTP request على connection جديد بيدفع ده، وكل اتصال بقاعدة البيانات (ومعاه login). عشان كده الـ connection pooling موجود في كل حتة: <a href="#/networking/keepalive">Keep-Alive</a> و<a href="#/databases/connection-pool">Connection Pool</a>.',
      net: `
<pre><span class="c">// السيرفر: listen على port، وكل AcceptAsync = handshake خلص</span>
var listener = new TcpListener(IPAddress.Any, 5000);
listener.Start(backlog: 1024);                     <span class="c">// طابور الـ connections اللي خلصت handshake</span>
while (true) {
    var client = await listener.AcceptTcpClientAsync();
    _ = HandleDeviceAsync(client);                    <span class="c">// connection واحد يفضل مفتوح لكل جهاز</span>
}

<span class="c">// العميل: ConnectAsync = SYN → SYN-ACK → ACK</span>
using var tcp = new TcpClient { NoDelay = true };
await tcp.ConnectAsync(host, 5000, ct);</pre>`,
      netTitle: 'في .NET',
      deep: [
        '<b>SYN flood:</b> السيرفر بيحجز state لكل SYN وصله قبل ما الـ handshake يخلص. مهاجم يبعت ملايين SYN من عناوين مزيفة يملا الطابور ده. الحل الشائع SYN cookies: السيرفر بيحط الـ state جوه رقم الـ seq نفسه ومبيحجزش حاجة.',
        '<b>الـ backlog:</b> الـ connections اللي خلصت handshake بتستنى في طابور لحد ما البرنامج يعمل <code>Accept</code>. لو البرنامج بطيء في الـ accept والطابور اتملى، الـ SYNs الجديدة بتترمي والأجهزة بتعمل retry بعد ثانية أو أكتر.',
        '<b>TCP Fast Open و QUIC:</b> TFO بيسمح بداتا مع الـ SYN لو اتكلمتوا قبل كده. HTTP/3 (QUIC على UDP) بيدمج الـ transport والـ TLS handshake في round trip واحد، ومع الـ resumption ممكن صفر. شوف <a href="#/networking/tls">TLS Handshake</a>.',
        '<b>الأرقام العشوائية:</b> الـ initial sequence number (x و y) عشوائي، مش صفر، عشان محدش يقدر يخمّنه ويحقن packets في connection مش بتاعه.',
        '<b>تبسيطات:</b> كل ACK منفصل (الحقيقي بيأخّر الـ ACK شوية ويجمعهم: delayed ACK)، ومفيش TLS، والـ RTO الأول ثانية واحدة زي Linux.'
      ]
    })
  });
})();
