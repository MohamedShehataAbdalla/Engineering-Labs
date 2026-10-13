/* Networking · TCP vs UDP (أجهزة الـ GPS)
   A device sends a GPS point every 0.5 s over a lossy cellular link (one-way delay = RTT/2 + jitter). The same
   points are sent both ways, and every transmission (including TCP retransmissions) draws its own loss:
     UDP  each datagram stands alone: lost means gone, everything else is delivered as soon as it arrives
     TCP  the receiver hands bytes to the app in order only: a lost segment is retransmitted after the RTO
          (max(200 ms, 1.5·RTT + 100 ms) here, roughly what an established Linux connection uses), and every
          point that arrived after it waits in the receive buffer until the hole is filled (head-of-line blocking)
   Delivery ratio, app-level delay and how stale the server's "current position" gets are measured. */
(function () {
  "use strict";
  const { clamp, lerp, fmt, f1 } = Lab.util;
  const { box, tx, dot, line, alpha } = Lab.draw;

  const EVERY = 0.5, VIEW = 16;

  function fresh(s) { s.st = { n: 0, next: s.t + 0.2, udp: [], tcp: [], tcpBuf: new Map(), expect: 0, retx: 0, inflight: [], lastU: null, lastT: null, staleU: [], staleT: [] }; }
  const owd = (s) => s.p.rtt / 2000 + s.rng() * s.p.jitter / 1000;
  const lost = (s) => s.rng() * 100 < s.p.loss;

  Lab.registerSim('tcp-udp', {
    height: 340, warm: 6,
    init(s) { fresh(s); },
    onParam(s) { fresh(s); },

    step(s) {
      const st = s.st, t = s.t, rto = Math.max(0.2, 1.5 * s.p.rtt / 1000 + 0.1);
      while (st.next <= t) {
        const id = st.n++, sent = st.next;
        // UDP: one shot
        const u = { id, sent, at: lost(s) ? null : sent + owd(s) };
        st.udp.push(u);
        // TCP: first transmission; retransmissions are scheduled when the RTO fires
        st.inflight.push({ id, sent, tx: sent, arrive: lost(s) ? null : sent + owd(s) });
        st.next += EVERY;
      }
      // TCP sender: RTO for segments not yet acknowledged (an arrival acks it after another one-way trip)
      for (const f of st.inflight) {
        if (f.arrive !== null && !f.got && t >= f.arrive) { f.got = true; st.tcpBuf.set(f.id, f); }
        if (!f.got && f.arrive === null && t >= f.tx + rto) {
          st.retx++; f.tx = t; f.arrive = lost(s) ? null : t + owd(s); f.retx = (f.retx || 0) + 1;
        }
        if (!f.got && f.arrive !== null && t >= f.arrive) { f.got = true; st.tcpBuf.set(f.id, f); }
      }
      // TCP receiver: deliver in order only
      while (st.tcpBuf.has(st.expect)) {
        const f = st.tcpBuf.get(st.expect); st.tcpBuf.delete(st.expect);
        st.tcp.push({ id: f.id, sent: f.sent, arrived: f.arrive, at: t, retx: f.retx || 0 });
        st.lastT = f.sent; st.expect++;
      }
      st.inflight = st.inflight.filter(f => !(f.got && f.id < st.expect));
      for (const u of st.udp) if (u.at !== null && u.at <= t && !u.seen) { u.seen = true; if (st.lastU === null || u.sent > st.lastU) st.lastU = u.sent; }
      // staleness: how old is the newest position the server knows
      st.staleU.push([t, st.lastU === null ? 0 : t - st.lastU]); st.staleT.push([t, st.lastT === null ? 0 : t - st.lastT]);
      const cut = t - 30;
      for (const k of ['udp', 'tcp']) st[k] = st[k].filter(x => x.sent > cut);
      while (st.staleU.length && st.staleU[0][0] < cut) st.staleU.shift();
      while (st.staleT.length && st.staleT[0][0] < cut) st.staleT.shift();
    },

    m(s) {
      const st = s.st, t = s.t, win = st.udp.filter(u => u.sent < t - 3 && u.sent > t - 28);
      const uDel = win.filter(u => u.at !== null), tWin = st.tcp.filter(x => x.sent > t - 28);
      const dU = uDel.map(u => u.at - u.sent).sort((a, b) => a - b), dT = tWin.map(x => x.at - x.sent).sort((a, b) => a - b);
      const p = (a, q) => a.length ? a[Math.min(a.length - 1, Math.floor(a.length * q))] : 0;
      return { uRatio: win.length ? uDel.length / win.length : 1, dU95: p(dU, 0.95), dT95: p(dT, 0.95), dTmax: p(dT, 1),
        stU: Math.max(0, ...st.staleU.map(x => x[1])), stT: Math.max(0, ...st.staleT.map(x => x[1])) };
    },

    draw(s) {
      const C = s.C, st = s.st, t = s.t, W = s.w, H = s.h, n = s.narrow;
      const x0 = n ? 44 : 64, x1 = W - 14, X = v => lerp(x0, x1, (v - (t - VIEW)) / VIEW);
      tx(`one GPS point every ${EVERY * 1000} ms · RTT ${s.p.rtt} ms · loss ${s.p.loss}% · last ${VIEW} s`, 14, 14, { m: 1, s: n ? 9 : 11, a: 'left', c: C.muted });
      const rows = [['sent', 44], ['UDP', 120], ['TCP', 210]];
      rows.forEach(([name, y]) => { tx(name, 14, y, { m: 1, s: n ? 9.5 : 11, w: 700, a: 'left', c: name === 'UDP' ? C.violet : name === 'TCP' ? C.a2 : C.accent }); line(x0, y, x1, y, C.line, 1); });
      for (const u of st.udp) {
        if (u.sent < t - VIEW) continue;
        dot(X(u.sent), 44, 3.5, C.accent);
        if (u.at === null) { if (u.sent + 0.2 < t) tx('✕', X(u.sent), 120, { m: 1, s: 12, w: 700, c: C.bad }); }
        else if (u.at <= t) { alpha(0.3, () => line(X(u.sent), 48, X(u.at), 116, C.violet, 1)); dot(X(u.at), 120, 3.5, C.violet); }
      }
      for (const x of st.tcp) {
        if (x.sent < t - VIEW) continue;
        const late = x.at - x.sent, col = late > 1 ? C.bad : late > 0.6 ? C.accent : C.a2;
        alpha(0.3, () => line(X(x.sent), 48, X(x.at), 206, col, 1));
        dot(X(x.at), 210, 3.5, col);
      }
      // waiting in the TCP receive buffer behind a hole
      let k = 0; for (const [id, f] of st.tcpBuf) { if (f.arrive >= t - VIEW) { dot(X(f.arrive), 236 + (k % 3) * 7, 3, C.bad); k++; } }
      if (st.tcpBuf.size) tx(`${st.tcpBuf.size} point${st.tcpBuf.size > 1 ? 's' : ''} arrived but held back: waiting for #${st.expect} (head-of-line blocking)`, x1, 260, { m: 1, s: n ? 8.5 : 10, w: 700, a: 'right', c: C.bad });
      const m = this.m(s);
      tx(`UDP: ${f1(m.uRatio * 100)}% delivered · p95 delay ${fmt(m.dU95 * 1000)} ms`, 14, H - 34, { m: 1, s: n ? 9 : 11, w: 700, a: 'left', c: C.violet });
      tx(`TCP: 100% delivered, in order · p95 delay ${fmt(m.dT95 * 1000)} ms · worst ${fmt(m.dTmax * 1000)} ms`, 14, H - 14, { m: 1, s: n ? 9 : 11, w: 700, a: 'left', c: m.dT95 > 1 ? C.bad : C.a2 });
    },

    stats(s) {
      const m = this.m(s), st = s.st;
      return [
        ['UDP: وصل', f1(m.uRatio * 100) + ' %', m.uRatio < 0.95 ? 'warn' : 'good'],
        ['UDP: تأخير p95', fmt(m.dU95 * 1000) + ' ms', 'good'],
        ['TCP: تأخير p95 (لحد الـ app)', fmt(m.dT95 * 1000) + ' ms', m.dT95 > 1 ? 'bad' : m.dT95 > 0.5 ? 'warn' : 'good'],
        ['أقدم مكان معروف للعربية (UDP / TCP)', `${f1(m.stU)} / ${f1(m.stT)} s`, m.stT > m.stU + 0.5 ? 'warn' : ''],
        ['TCP: retransmissions', fmt(st.retx), st.retx ? 'warn' : '']
      ];
    }
  });

  Lab.registerLesson({
    id: 'tcp-udp', lab: 'networking', title: 'TCP vs UDP',
    html: Lab.tpl.lesson({
      sim: 'tcp-udp', level: 2,
      terms: ['TCP', 'UDP', 'Retransmission', 'Head-of-line Blocking', 'Reliability'],
      lede: 'جهاز بيبعت نقطة GPS كل نص ثانية على شبكة موبايل بتضيّع packets. نفس النقط بتتبعت مرتين في نفس اللحظة: بـ UDP وبـ TCP. فوق لحظة الإرسال، وتحت لحظة ما البرنامج على السيرفر استلم النقطة فعلًا. الأحمر في TCP نقطة اتأخرت.',
      aria: 'محاكاة إرسال نقط GPS بـ TCP و UDP على شبكة فيها فقد',
      controls: [
        { type: 'range', p: 'loss', label: 'Packet loss', min: 0, max: 30, step: 1, value: 8, unit: '%' },
        { type: 'range', p: 'rtt', label: 'RTT', min: 40, max: 800, step: 20, value: 300, unit: 'ms' },
        { type: 'range', p: 'jitter', label: 'Jitter', min: 0, max: 200, step: 10, value: 40, unit: 'ms' }
      ],
      idea: `
        <p><b>UDP</b>: بيبعت الـ datagram وخلاص. مفيش connection ولا تأكيد ولا ترتيب. اللي ضاع ضاع، واللي وصل بيوصل على طول.</p>
        <p><b>TCP</b>: stream موثوق ومترتب. كل byte لازم يتأكد استلامه (ACK)، والضايع بيتعاد (<b>Retransmission</b>) بعد timeout. وعشان البرنامج بيستلم الـ bytes بالترتيب بس، أي packet ضايع بيوقف كل اللي جه بعده في الـ buffer لحد ما يوصل: ده <b>Head-of-line Blocking</b>.</p>`,
      real: `
        <p>لنقط GPS الحية، الجديد أهم من القديم: لو نقطة الثانية 10 ضاعت والـ 11 وصلت، الخريطة محتاجة الـ 11 دلوقتي. مع TCP، الـ 11 والـ 12 واقفين ورا الـ 10 لحد ما تتعاد، فالعربية على الخريطة بتقف ثانية وبعدين تنط. مع UDP بتتحرك على طول وناقصها نقطة.</p>
        <p>بس لما الداتا لازم تكتمل (رحلة لحساب فاتورة، أو أوامر للجهاز زي «اقفل الموتور»)، TCP، أو UDP بنظام تأكيد تعمله إنت.</p>`,
      try: 'سيبها على 8% loss وRTT 300: UDP بيوصله حوالي 92% بتأخير ثابت، وTCP بيوصله كله بس فيه نقط حمرا متأخرة وسطر «held back» بيظهر. ارفع الـ loss لـ 20%: تأخير TCP بيتضاعف. نزّل الـ loss لصفر: الاتنين نفس الشيء تقريبًا. وارفع الـ RTT لـ 800: كل retransmission بقى أغلى.',
      also: 'المكالمات والفيديو المباشر (packet متأخر = ملوش لازمة، فـ UDP)، والألعاب (position updates بـ UDP، والشراء والـ chat بـ TCP)، والـ DNS (UDP لأن السؤال packet واحد). وHTTP/3 بيستخدم QUIC فوق UDP عشان يتجنب head-of-line blocking بين الـ streams.',
      net: `
<pre><span class="c">// UDP: datagram لكل نقطة، من غير connection</span>
using var udp = new UdpClient();
await udp.SendAsync(packet, packet.Length, serverEp);
<span class="c">// السيرفر</span>
var r = await udpServer.ReceiveAsync();          <span class="c">// r.Buffer = datagram كامل، أو مفيش</span>

<span class="c">// TCP: stream؛ الترتيب والإعادة على الـ OS</span>
var stream = tcpClient.GetStream();
await stream.WriteAsync(packet);                  <span class="c">// مفيش ضمان إن ده هيوصل قراية واحدة: شوف TCP Framing</span></pre>`,
      netTitle: 'في .NET',
      deep: [
        '<b>UDP مش «أسرع» في كل حاجة:</b> على شبكة سليمة الاتنين بيوصلوا في نفس الوقت تقريبًا. الفرق بيظهر مع الفقد. وUDP مالوش congestion control: لو كل الأجهزة بعتت أكتر من سعة الشبكة، الكل بيخسر. لازم تحط rate limit بنفسك.',
        '<b>NAT وUDP:</b> شبكات الموبايل بتنسى الـ UDP mappings بسرعة (أحيانًا 30 ثانية)، فالسيرفر مبيقدرش يكلم الجهاز إلا لو الجهاز بيبعت باستمرار. شوف <a href="#/networking/nat">NAT</a>.',
        '<b>الـ RTO:</b> TCP بيحسبه من الـ RTT المتقاس (SRTT + 4·RTTVAR) بحد أدنى 200 ms على Linux، ولو نفس الـ segment ضاع تاني بيضاعف الـ timeout (exponential backoff). شوف <a href="#/networking/rtt">RTT و Jitter</a>.',
        '<b>Fast retransmit:</b> لو الـ sender بيبعت كتير، 3 ACKs مكررين بيكشفوا الفقد قبل الـ timeout. مع نقطة كل نص ثانية، مفيش packets كفاية، فالـ RTO هو اللي بيتحكم.',
        '<b>تبسيطات:</b> كل transmission (ومنهم الـ retransmissions) بيضيع بنفس الاحتمال، والـ ACKs مبتضيعش، والـ RTO ثابت مش متحسب.'
      ]
    })
  });
})();
