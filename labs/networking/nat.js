/* Networking · NAT
   Six GPS devices with private addresses (10.20.0.x) sit behind the mobile operator's NAT, public IP 198.51.100.7.
   The NAT table is real:
     outbound packet  → reuse the device's mapping if it is still alive, otherwise create one with a new public port;
                        either way the idle timer restarts
     inbound packet   → delivered only if a live mapping for that public port exists; otherwise dropped silently
     idle mapping     → removed after the NAT's UDP timeout
   The devices report over UDP at the chosen interval; the server sends commands at random times to the last public
   ip:port it saw. Optional keepalive: an empty packet every 20 s just to keep the mapping alive.
   Simulated time runs 10× faster than real time. Delivered/dropped counts come from the table. */
(function () {
  "use strict";
  const { clamp, lerp, fmt, f1, expo } = Lab.util;
  const { box, tx, dot, line, alpha } = Lab.draw;

  const N = 6, SPEED = 10, VIEW = 240, CMD_RATE = 1 / 45;      // sim seconds; a command per device every ~45 s

  function fresh(s) {
    const rnd = s.rng;
    s.st = {
      now: 0, nextPort: 40000, table: new Map(), ok: 0, drop: 0, newMaps: 0, kaPk: 0, reports: 0,
      dev: Array.from({ length: N }, (_, i) => ({ priv: `10.20.0.${11 + i}`, nextTx: rnd() * s.p.every, nextKa: rnd() * 20, nextCmd: expo(CMD_RATE, rnd), seen: null, ev: [], spans: [] }))
    };
  }
  function outbound(st, d, ka) {
    let m = st.table.get(d.priv);
    if (!m || m.until <= st.now) {
      m = { pub: st.nextPort++, since: st.now }; st.table.set(d.priv, m); st.newMaps++;
      d.spans.push({ a: st.now, b: st.now, port: m.pub });
    }
    m.until = st.now + st.timeout;
    d.spans[d.spans.length - 1].b = m.until;
    d.seen = m.pub;                                   // the server learns the current public port from this packet
    d.ev.push({ t: st.now, k: ka ? 'ka' : 'up' });
  }

  Lab.registerSim('nat', {
    height: 380, warm: 3,
    init(s) { fresh(s); },
    onParam(s) { fresh(s); },

    step(s, dt) {
      const st = s.st, end = st.now + dt * SPEED;
      st.timeout = s.p.timeout;
      while (st.now < end) {
        st.now = Math.min(end, st.now + 0.25);
        for (const d of st.dev) {
          if (st.now >= d.nextTx) { outbound(st, d, false); st.reports++; d.nextTx += s.p.every; }
          if (s.p.ka && st.now >= d.nextKa) { outbound(st, d, true); st.kaPk++; d.nextKa += 20; }
          if (st.now >= d.nextCmd) {
            const m = st.table.get(d.priv), alive = m && m.until > st.now && m.pub === d.seen;
            if (alive) st.ok++; else st.drop++;
            d.ev.push({ t: st.now, k: alive ? 'cmd' : 'lost' });
            d.nextCmd += expo(CMD_RATE, s.rng);
          }
          d.ev = d.ev.filter(e => e.t > st.now - VIEW); d.spans = d.spans.filter(x => x.b > st.now - VIEW);
        }
        for (const [k, m] of st.table) if (m.until <= st.now) st.table.delete(k);
      }
    },

    draw(s) {
      const C = s.C, st = s.st, W = s.w, H = s.h, n = s.narrow, now = st.now;
      const x0 = n ? 64 : 150, x1 = W - 14, X = t => lerp(x0, x1, (t - (now - VIEW)) / VIEW);
      tx(`NAT 198.51.100.7 · UDP timeout ${s.p.timeout} s · reports every ${s.p.every} s · last ${VIEW / 60} min (×10 speed)`, 14, 14, { m: 1, s: n ? 8.5 : 10.5, a: 'left', c: C.muted });
      const rowH = (H - 90) / N;
      st.dev.forEach((d, i) => {
        const y = 40 + i * rowH, mid = y + rowH / 2;
        const m = st.table.get(d.priv), alive = m && m.until > now;
        tx(d.priv, 14, mid - 6, { m: 1, s: n ? 8 : 10, w: 700, a: 'left', c: C.accent });
        tx(alive ? `→ :${m.pub}` : '→ no mapping', 14, mid + 8, { m: 1, s: n ? 8 : 9.5, a: 'left', c: alive ? C.a2 : C.bad });
        box(x0, mid - 7, x1 - x0, 14, { r: 3, fill: C.bg, stroke: null });
        for (const sp of d.spans) { const a = Math.max(x0, X(sp.a)), b = Math.min(x1, X(Math.min(sp.b, now))); if (b > a) box(a, mid - 7, b - a, 14, { r: 3, fill: C.a2, stroke: null }); if (X(sp.a) > x0 && !n) tx(':' + sp.port, X(sp.a) + 3, mid - 12, { m: 1, s: 8, a: 'left', c: C.muted }); }
        for (const e of d.ev) {
          const x = X(e.t);
          if (e.k === 'up') dot(x, mid, 2.6, C.accent);
          else if (e.k === 'ka') dot(x, mid, 1.8, C.violet);
          else if (e.k === 'cmd') { line(x, mid - 12, x, mid + 12, C.good, 2); }
          else { line(x, mid - 12, x, mid + 12, C.bad, 2); tx('✕', x, mid - 18, { m: 1, s: 10, w: 700, c: C.bad }); }
        }
      });
      const tot = st.ok + st.drop;
      tx(`server → device commands: ${st.ok} delivered · ${st.drop} dropped by the NAT (${tot ? f1(st.drop / tot * 100) : 0}%)`, 14, H - 36, { m: 1, s: n ? 9 : 11, w: 700, a: 'left', c: st.drop ? C.bad : C.good });
      tx('orange = GPS report · violet = keepalive · teal bar = live mapping · green/red line = command', 14, H - 16, { m: 1, s: n ? 7.5 : 9.5, a: 'left', c: C.muted });
    },

    stats(s) {
      const st = s.st, tot = st.ok + st.drop, hours = st.now / 3600;
      const perDev = hours ? (st.reports + st.kaPk) / N / hours : 0;
      return [
        ['Commands وصلت', tot ? f1(st.ok / tot * 100) + ' %' : '—', st.drop / Math.max(1, tot) > 0.1 ? 'bad' : 'good'],
        ['Commands اترمت في الصمت', String(st.drop), st.drop ? 'bad' : 'good'],
        ['Mappings جديدة (port اتغير)', String(st.newMaps)],
        ['Packets لكل جهاز في الساعة', fmt(perDev)],
        ['منهم keepalive', st.kaPk ? f1(st.kaPk / (st.reports + st.kaPk) * 100) + ' %' : '0']
      ];
    }
  });

  Lab.registerLesson({
    id: 'nat', lab: 'networking', title: 'NAT',
    html: Lab.tpl.lesson({
      sim: 'nat', level: 2,
      terms: ['NAT', 'Private IP', 'NAT Mapping', 'Idle Timeout', 'Keepalive'],
      lede: '6 أجهزة GPS بعناوين خاصة ورا NAT بتاع شركة الاتصالات. كل ما الجهاز يبعت، الـ NAT بيعمل أو يجدد <b>mapping</b> (الشريط التركواز). السيرفر بيحاول يبعت أوامر للأجهزة: لو الـ mapping عايش بتوصل (أخضر)، لو انتهى بتترمي في صمت (أحمر). الوقت هنا أسرع 10 مرات.',
      aria: 'محاكاة جدول NAT بـ mappings بتنتهي و أوامر من السيرفر للأجهزة',
      controls: [
        { type: 'range', p: 'every', label: 'الجهاز بيبعت كل', min: 10, max: 180, step: 10, value: 60, unit: 's' },
        { type: 'seg', p: 'timeout', label: 'UDP timeout في الـ NAT', value: 30, opts: [[30, '30 s'], [60, '60 s'], [120, '120 s']] },
        { type: 'seg', p: 'ka', label: 'Keepalive كل 20 s', value: 'false', opts: [['false', 'لأ'], ['true', 'آه']] }
      ],
      idea: `
        <p>أغلب الأجهزة ملهاش IP عام؛ ليها <b>Private IP</b> (زي 10.x أو 192.168.x) والـ <b>NAT</b> بيترجم. لما الجهاز يبعت لبرّه، الـ NAT بيعمل <b>mapping</b>: «الـ port العام 40017 = الجهاز 10.20.0.12». الرد اللي يرجع على 40017 يروح للجهاز ده.</p>
        <p>المشكلة: الـ NAT مش عارف إمتى المحادثة خلصت، فبيمسح أي mapping مستخدمش فترة (<b>Idle Timeout</b>)، وفي UDP على شبكات الموبايل ممكن تبقى 30 ثانية بس. بعد كده أي packet من برّه بيترمي، ومفيش أي error بيرجع للسيرفر. الحل إن الجهاز يبعت حاجة صغيرة كل شوية (<b>Keepalive</b>) عشان الـ mapping يفضل عايش.</p>`,
      real: `
        <p>الـ dispatcher عايز يبعت أمر «اقفل الموتور» أو «حدّث الإعدادات» لعربية. الجهاز بيبعت موقعه كل دقيقة، والـ NAT بيمسح الـ mapping بعد 30 ثانية: نص الوقت الأمر بيضيع، والسيرفر فاكر إنه اتبعت. ولما الجهاز يبعت تاني بياخد port جديد، فالسيرفر لازم يتعلم العنوان الجديد من آخر packet.</p>`,
      try: 'سيبها على تقرير كل 60 ثانية وtimeout 30: حوالي نص الأوامر بيضيع. شغّل الـ keepalive: كله بيوصل، بس عدد الـ packets لكل جهاز بيبقى 4 أضعاف (60 ← 240 في الساعة: باقة الداتا والبطارية). أو قلّل فترة التقرير لـ 20 ثانية. وجرّب timeout 120: المشكلة بتختفي على نفس الإعدادات.',
      also: 'تطبيقات الشات والـ push notifications بتعمل keepalive على الـ connection عشان نفس السبب، و VoIP وألعاب الموبايل. والـ home routers بتعمل نفس الـ NAT (الـ timeouts عادةً أطول).',
      net: `
<pre><span class="c">// السيرفر: رد على آخر عنوان عام شفته من الجهاز، مش العنوان المتخزن من ساعة</span>
var r = await udp.ReceiveAsync(ct);
var deviceId = ParseDeviceId(r.Buffer);
lastSeen[deviceId] = r.RemoteEndPoint;                 <span class="c">// ممكن يتغير بعد ما الـ NAT ينسى</span>
await udp.SendAsync(command, lastSeen[deviceId], ct);  <span class="c">// ولو الـ mapping مات؟ مفيش error</span>

<span class="c">// TCP: keepalive من الـ OS (أطول بكتير من 30 ثانية افتراضيًا، فاضبطه)</span>
socket.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.KeepAlive, true);
socket.SetSocketOption(SocketOptionLevel.Tcp, SocketOptionName.TcpKeepAliveTime, 25);     <span class="c">// ثواني</span>
socket.SetSocketOption(SocketOptionLevel.Tcp, SocketOptionName.TcpKeepAliveInterval, 5);</pre>`,
      netTitle: 'في .NET',
      deep: [
        '<b>الأوامر محتاجة تأكيد:</b> بما إن الـ NAT بيرمي في صمت، أي أمر مهم لازم الجهاز يرد عليه (ack)، والسيرفر يعيد أو يحطه في طابور يتبعت أول ما الجهاز يكلّمه تاني. ده أضمن من keepalive لوحده.',
        '<b>TCP مش محمي:</b> الـ NATs بتمسح TCP mappings كمان (أطول، دقايق لساعات)، والـ connection بيبان مفتوح عند الطرفين وهو ميت (half-open). الـ TCP keepalive الافتراضي في أغلب الأنظمة بعد ساعتين، فلازم تضبطه أو تعمل heartbeat في البروتوكول.',
        '<b>CGNAT:</b> شركات الموبايل بتحط آلاف المشتركين ورا IP واحد. يعني مستحيل السيرفر يبدأ connection للجهاز؛ لازم الجهاز هو اللي يبدأ دايمًا. شوف <a href="#/networking/socket">IP و Port و Socket</a>.',
        '<b>التكلفة:</b> keepalive صغير كل 20 ثانية = 4,320 packet في اليوم لكل جهاز، وكل مرة الراديو بيصحى. على 10,000 جهاز ده 43 مليون packet. الأحسن تخلّي فترة التقرير نفسها أقل من الـ timeout، أو تستخدم SMS/push للأوامر النادرة.',
        '<b>تبسيطات:</b> الـ NAT بيجدد الـ timer مع الـ packets الخارجة بس (فيه NATs بتجدده مع الداخلة كمان)، والأوامر بتتبعت في أوقات عشوائية بمتوسط واحد كل 45 ثانية لكل جهاز.'
      ]
    })
  });
})();
