/* Networking · طبقات TCP/IP (التغليف وفك التغليف)
   One application message goes down the sender's stack, across the wire, and up the receiver's stack.
   Byte counts are computed, not drawn by hand:
     transport  TCP header 20 B (no options) or UDP 8 B; TCP splits the payload into MSS-sized segments
                (MSS = MTU 1500 − IP header − TCP header)
     network    IPv4 header 20 B or IPv6 40 B (UDP payloads larger than one packet are fragmented by IP)
     link       Ethernet header 14 B + FCS 4 B, frame payload padded to at least 46 B
     wire       + preamble/SFD 8 B + inter-frame gap 12 B per frame
   Overhead = everything that isn't application payload. */
(function () {
  "use strict";
  const { clamp, lerp, fmt, f1 } = Lab.util;
  const { box, tx, arrow, line, alpha } = Lab.draw;

  const SIZES = [20, 60, 300, 1400, 4000, 65000];
  const MTU = 1500, ETH = 18, WIRE = 20, PHASE = 0.9;

  function compute(p) {
    const P = SIZES[p.size], tcp = p.proto === 'tcp', ip = p.ip === 'v6' ? 40 : 20, th = tcp ? 20 : 8;
    const frames = [];
    if (tcp) {
      const mss = MTU - ip - th;
      for (let left = P; left > 0; left -= mss) frames.push({ data: Math.min(mss, left), th, ip });
    } else {
      // one UDP datagram; IP fragments it if it doesn't fit (IPv4 here; IPv6 does it at the sender only)
      const maxData = MTU - ip, total = P + th;
      for (let left = total, first = true; left > 0; left -= maxData, first = false) {
        const chunk = Math.min(maxData, left);
        frames.push({ data: first ? chunk - th : chunk, th: first ? th : 0, ip, frag: total > maxData });
      }
    }
    for (const f of frames) {
      const ipLen = f.data + f.th + f.ip;
      f.pad = Math.max(0, 46 - ipLen);
      f.frame = ipLen + f.pad + ETH;
      f.wire = f.frame + WIRE;
    }
    const wire = frames.reduce((a, f) => a + f.wire, 0);
    return { P, frames, wire, ip, th, tcp, overhead: wire - P };
  }

  Lab.registerSim('layers', {
    height: 360, warm: 0,
    init(s) { s.st = { t0: s.t, c: compute(s.p) }; },
    onParam(s) { this.init(s); },
    step(s) { if (s.t - s.st.t0 > PHASE * 11) this.init(s); },

    draw(s) {
      const C = s.C, st = s.st, c = st.c, W = s.w, H = s.h, n = s.narrow;
      const ph = (s.t - st.t0) / PHASE;            // 0..4 down, 4..6 wire, 6..10 up
      const layers = ['Application', c.tcp ? 'Transport · TCP' : 'Transport · UDP', `Network · IP${c.ip === 40 ? 'v6' : 'v4'}`, 'Link · Ethernet'];
      const colW = n ? 84 : 132, x0 = 14, xR = W - 14 - colW, top = 34, lh = (H - 90) / 4;
      layers.forEach((L, i) => {
        const y = top + i * lh;
        for (const x of [x0, xR]) { box(x, y, colW, lh - 8, { r: 6, fill: C.surface, stroke: C.line }); tx(L, x + colW / 2, y + 14, { m: 1, s: n ? 8 : 10, w: 700, c: C.ink }); }
      });
      tx('GPS device', x0 + colW / 2, 16, { m: 1, s: n ? 9 : 11, w: 700, c: C.accent });
      tx('server', xR + colW / 2, 16, { m: 1, s: n ? 9 : 11, w: 700, c: C.a2 });

      // which layer the message is at, and which headers it carries there
      let side, lvl;
      if (ph < 4) { side = 0; lvl = Math.floor(ph); }
      else if (ph < 6) { side = 2; lvl = 3; }
      else { side = 1; lvl = clamp(3 - Math.floor(ph - 6), 0, 3); }
      const f0 = c.frames[0];
      const parts = [];
      if (lvl >= 3) parts.push(['Eth', 14, C.muted]);
      if (lvl >= 2) parts.push([c.ip === 40 ? 'IPv6' : 'IPv4', f0.ip, C.a2]);
      if (lvl >= 1 && f0.th) parts.push([c.tcp ? 'TCP' : 'UDP', f0.th, C.violet]);
      parts.push(['data', lvl >= 1 ? f0.data : c.P, C.accent]);
      if (lvl >= 3 && f0.pad) parts.push(['pad', f0.pad, C.line]);
      if (lvl >= 3) parts.push(['FCS', 4, C.muted]);
      const total = parts.reduce((a, p) => a + p[1], 0);
      const bw = n ? 150 : Math.min(360, W - 2 * colW - 70), scale = bw / Math.max(total, 120);
      let bx, by;
      if (side === 2) { const k = (ph - 4) / 2; bx = lerp(x0 + colW + 10, xR - 10 - Math.min(bw, total * scale), k); by = top + 3 * lh + 10; }
      else { bx = side === 0 ? x0 + colW + 14 : xR - 14 - Math.min(bw, total * scale); by = top + lvl * lh + 14; }
      {
        let x = bx;
        const minW = 26;
        const widths = parts.map(p => Math.max(minW, p[1] * scale));
        const sum = widths.reduce((a, b) => a + b, 0), k = sum > bw ? bw / sum : 1;
        parts.forEach((p, i) => {
          const w = widths[i] * k;
          box(x, by, w, 26, { r: 3, fill: p[2], stroke: null });
          if (w > 22) tx(p[0], x + w / 2, by + 9, { m: 1, s: 8.5, w: 700, c: C.surface });
          if (w > 22) tx(fmt(p[1]) + 'B', x + w / 2, by + 19, { m: 1, s: 7.5, c: C.surface });
          x += w;
        });
      }
      if (side === 0 && lvl < 3) alpha(0.5, () => arrow(x0 + colW / 2, top + lvl * lh + lh - 10, x0 + colW / 2, top + (lvl + 1) * lh + 4, C.accent, 1.4));
      if (side === 1 && lvl > 0) alpha(0.5, () => arrow(xR + colW / 2, top + lvl * lh + 2, xR + colW / 2, top + (lvl - 1) * lh + lh - 12, C.a2, 1.4));
      line(x0 + colW, top + 3 * lh + 40, xR, top + 3 * lh + 40, C.line, 2);

      const verb = side === 0 ? (lvl === 0 ? 'the app writes its message' : `${layers[lvl]} adds its header`) : side === 2 ? 'on the wire (+ preamble & gap)' : (lvl === 0 ? 'the app reads the message back' : `${layers[lvl]} removes its header`);
      tx(verb, W / 2, H - 42, { m: 1, s: n ? 9 : 11, w: 700, c: side === 1 ? C.a2 : C.accent });
      tx(`${c.frames.length} frame${c.frames.length > 1 ? 's' : ''}${c.frames[0].frag ? ' (IP fragments)' : ''} · ${fmt(c.P)} B of data → ${fmt(c.wire)} B on the wire · overhead ${f1(c.overhead / c.wire * 100)}%`, W / 2, H - 20, { m: 1, s: n ? 8.5 : 10.5, w: 700, c: c.overhead / c.wire > 0.5 ? C.bad : C.muted });
    },

    stats(s) {
      const c = s.st.c, per = c.wire / c.P;
      return [
        ['Payload', fmt(c.P) + ' B'],
        ['Frames', String(c.frames.length) + (c.frames[0].frag ? ' (fragments)' : '')],
        ['Bytes على السلك', fmt(c.wire) + ' B'],
        ['Overhead', f1(c.overhead / c.wire * 100) + ' %', c.overhead / c.wire > 0.5 ? 'bad' : c.overhead / c.wire > 0.1 ? 'warn' : 'good'],
        ['10,000 جهاز × رسالة كل 10 ث', `${f1(1000 * c.wire * 8 / 1e6)} Mbit/s`]
      ];
    }
  });

  Lab.registerLesson({
    id: 'layers', lab: 'networking', title: 'طبقات TCP/IP',
    html: Lab.tpl.lesson({
      sim: 'layers', level: 1,
      terms: ['TCP/IP Layers', 'Encapsulation', 'Header', 'MTU', 'MSS'],
      lede: 'رسالة GPS واحدة بتنزل في طبقات الجهاز (كل طبقة بتلزق header قدامها)، بتعدّي على السلك، وبتطلع في طبقات السيرفر (كل طبقة بتشيل الـ header بتاعها). كل الأحجام محسوبة بالـ byte.',
      aria: 'محاكاة التغليف وفك التغليف في طبقات TCP/IP',
      controls: [
        { type: 'range', p: 'size', label: 'حجم الرسالة', min: 0, max: 5, step: 1, value: 1, map: ['20 B (binary)', '60 B (text)', '300 B (JSON)', '1,400 B', '4,000 B', '65,000 B'] },
        { type: 'seg', p: 'proto', label: 'Transport', value: 'tcp', opts: [['tcp', 'TCP'], ['udp', 'UDP']] },
        { type: 'seg', p: 'ip', label: 'IP', value: 'v4', opts: [['v4', 'IPv4'], ['v6', 'IPv6']] }
      ],
      idea: `
        <p>الشبكة متقسمة <b>طبقات</b>، كل طبقة بتحل مشكلة واحدة وبتعتمد على اللي تحتها: <b>Application</b> (الرسالة نفسها)، <b>Transport</b> (TCP أو UDP: أنهي برنامج على الجهاز، والترتيب والتأكيد)، <b>Network</b> (IP: أنهي جهاز في العالم)، <b>Link</b> (Ethernet أو WiFi أو 4G: الخطوة الجاية بس).</p>
        <p>كل طبقة بتحط <b>header</b> قدام اللي جالها من فوق (<b>Encapsulation</b>)، والطبقة المقابلة عند المستقبل بتشيله. وفيه حد لأكبر packet في الشبكة (<b>MTU</b>، عادةً 1500 B)، فـ TCP بيقسّم الداتا لأجزاء أكبرها <b>MSS</b> (1460 B مع IPv4).</p>`,
      real: `
        <p>رسالة GPS نصية 60 byte بتبقى على السلك حوالي 140 byte: النص تقريبًا headers. 10,000 جهاز كل 10 ثواني ده رقم صغير، بس على باقة موبايل بالـ MB، الفرق بين رسالة binary 20 B وJSON 300 B بيتضرب في 8,640 رسالة في اليوم لكل جهاز.</p>`,
      try: 'ابدأ بـ 20 B: حوالي 80% من اللي على السلك headers. اطلع لـ 1,400: الـ overhead بيبقى حوالي 5%. بعدين 4,000 مع TCP: 3 segments. نفس الحجم مع UDP: datagram واحد اتقسم IP fragments، ولو fragment واحد ضاع، الـ datagram كله ضاع.',
      also: 'تطبيقات الشات بتجمّع الرسايل الصغيرة وتضغطها، وألعاب الـ multiplayer بتبعت state مضغوط binary بدل JSON، وبروتوكولات IoT زي MQTT (header 2 byte) معمولة عشان الرسايل الصغيرة بالظبط.',
      net: `
<pre><span class="c">// كل طبقة في .NET</span>
var json = JsonSerializer.SerializeToUtf8Bytes(point);   <span class="c">// Application: ~300 B</span>
await stream.WriteAsync(json);                            <span class="c">// TCP: NetworkStream، الـ OS بيقسم ويحط headers</span>
await udp.SendAsync(json, json.Length, serverEp);        <span class="c">// UDP: UdpClient، datagram واحد</span>

<span class="c">// binary بدل JSON: 20 B بدل 300</span>
Span&lt;byte&gt; buf = stackalloc byte[20];
BinaryPrimitives.WriteInt32LittleEndian(buf, vehicleId);
BinaryPrimitives.WriteInt32LittleEndian(buf[4..], (int)(lat * 1e6));
BinaryPrimitives.WriteInt32LittleEndian(buf[8..], (int)(lng * 1e6));
...</pre>`,
      netTitle: 'في .NET',
      deep: [
        '<b>TCP options:</b> الـ header هنا 20 byte. عمليًا Linux بيضيف timestamps فبيبقى 32 byte في كل segment، وده بيقلّل الـ MSS الفعلي لـ 1448.',
        '<b>شبكات الموبايل:</b> مش Ethernet؛ فيه headers تانية (GTP tunneling جوه شبكة الموبايل، و PPP أو غيره)، وMTU أحيانًا أصغر من 1500. الـ VPN كمان بيضيف headers فبيقلّل الـ MTU. packets أكبر من الـ MTU بتتقسم أو بتتعطل في صمت (PMTUD black hole).',
        '<b>IP fragmentation وحشة:</b> fragment واحد يضيع = الـ datagram كله يضيع، وفيه firewalls بترمي الـ fragments. عشان كده بروتوكولات UDP الحديثة (DNS، QUIC) بتحاول تفضل تحت حوالي 1200 byte.',
        '<b>OSI vs TCP/IP:</b> نموذج OSI فيه 7 طبقات (session و presentation منفصلين). الشبكات الحقيقية ماشية بالـ 4 طبقات دول، والـ TLS قاعد بين الـ transport والـ application.',
        '<b>تبسيطات:</b> Ethernet عادي من غير VLAN، وTCP من غير options، ومن غير ACKs ولا retransmissions. الـ bytes على السلك شاملة preamble و gap (20 B لكل frame).'
      ]
    })
  });
})();
