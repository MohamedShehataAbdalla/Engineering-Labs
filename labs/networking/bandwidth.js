/* Networking · Bandwidth و Latency و Throughput و Packet Loss
   Downloading a 20 MB daily GPS export over one TCP connection. A round-by-round congestion-control model
   (Reno-style, one round = one RTT):
     slow start      cwnd starts at 10 segments and doubles every RTT until a loss or ssthresh
     avoidance       +1 segment per RTT
     loss            if any segment in the round is lost (each one independently with probability p): cwnd halves
     limits          segments sent per round = min(cwnd, receive window, bandwidth × RTT)
   Throughput, link utilisation and transfer time come from running the rounds. MSS = 1460 B. */
(function () {
  "use strict";
  const { clamp, lerp, fmt, f1 } = Lab.util;
  const { box, tx, dot, line, alpha } = Lab.draw;

  const BWS = [1, 5, 10, 50, 100, 500, 1000], FILE = 20 * 1024 * 1024, MSS = 1460, SHOW = 6;

  function run(p, rnd) {
    const bw = BWS[p.bw] * 1e6 / 8, rtt = p.rtt / 1000, loss = p.loss / 100;
    const rwnd = (p.win === 'small' ? 64 * 1024 : 4 * 1024 * 1024) / MSS;
    const pipe = Math.max(1, bw * rtt / MSS);              // segments the link can carry in one RTT (BDP)
    let cwnd = 10, ssth = Infinity, sent = 0, t = 0, losses = 0;
    const rounds = [];
    while (sent < FILE && rounds.length < 20000) {
      const n = Math.max(1, Math.floor(Math.min(cwnd, rwnd, pipe)));
      let lost = false;
      if (loss > 0) { const pNone = Math.pow(1 - loss, n); lost = rnd() > pNone; }
      sent += n * MSS; t += rtt;
      rounds.push({ t, cwnd, n, lost, limit: n >= Math.floor(pipe) ? 'link' : n >= Math.floor(rwnd) ? 'rwnd' : 'cwnd' });
      if (lost) { losses++; ssth = Math.max(2, cwnd / 2); cwnd = ssth; }
      else if (cwnd < ssth) cwnd *= 2; else cwnd += 1;
    }
    const thr = FILE / t;
    return { rounds, time: t, thr, util: thr / bw, pipe, rwnd, bw, losses, bdp: bw * rtt,
      mathis: loss > 0 ? (MSS / rtt) * 1.22 / Math.sqrt(loss) : Infinity };
  }

  const hum = b => b >= 1e6 ? f1(b * 8 / 1e6) + ' Mbit/s' : fmt(b * 8 / 1e3) + ' kbit/s';
  const secs = t => t < 1 ? fmt(t * 1000) + ' ms' : t < 120 ? f1(t) + ' s' : f1(t / 60) + ' min';

  Lab.registerSim('bandwidth', {
    height: 360, warm: 0,
    init(s) { s.st = { r: run(s.p, s.rng), t0: s.t }; },
    onParam(s) { this.init(s); },
    step(s) { if (s.t - s.st.t0 > SHOW + 3) s.st.t0 = s.t; },

    draw(s) {
      const C = s.C, r = s.st.r, W = s.w, H = s.h, n = s.narrow;
      const k = clamp((s.t - s.st.t0) / SHOW, 0, 1), shown = Math.max(1, Math.floor(r.rounds.length * k));
      // the pipe: bandwidth is its height, RTT its length; the dots are segments in flight right now
      const px0 = 14, px1 = W - 14, py = 40, ph = 34, cur = r.rounds[shown - 1];
      tx(`link ${hum(r.bw)} · RTT ${s.p.rtt} ms → the pipe holds ${fmt(r.bdp / 1024)} KB (bandwidth × delay)`, 14, 16, { m: 1, s: n ? 8.5 : 10.5, w: 700, a: 'left', c: C.muted });
      box(px0, py, px1 - px0, ph, { r: 6, fill: C.bg, stroke: C.line });
      const fill = Math.min(1, cur.n / r.pipe), per = Math.max(1, Math.floor((px1 - px0 - 10) / 7));
      const dots = Math.min(per * 4, Math.round(fill * per * 4));
      for (let i = 0; i < dots; i++) dot(px0 + 6 + (i % per) * 7, py + 6 + Math.floor(i / per) * 7, 2.4, cur.lost ? C.bad : C.accent);
      tx(`in flight: ${f1(fill * 100)}% of the pipe (limited by ${cur.limit === 'link' ? 'the link' : cur.limit === 'rwnd' ? 'the receive window' : 'congestion window'})`, px1, py + ph + 14, { m: 1, s: n ? 8.5 : 10, w: 700, a: 'right', c: cur.limit === 'link' ? C.good : C.accent });
      // cwnd over time
      const gx0 = 14, gx1 = W - 14, gy0 = py + ph + 34, gy1 = H - 46, maxT = r.time, maxW = Math.max(r.pipe, ...r.rounds.map(x => Math.min(x.cwnd, r.rwnd))) * 1.1;
      box(gx0, gy0, gx1 - gx0, gy1 - gy0, { r: 6, fill: C.surface, stroke: C.line });
      const X = t => lerp(gx0 + 6, gx1 - 6, t / maxT), Y = v => lerp(gy1 - 6, gy0 + 14, Math.min(v, maxW) / maxW);
      alpha(0.7, () => line(gx0, Y(r.pipe), gx1, Y(r.pipe), C.good, 1.2, [5, 4]));
      tx('link capacity (BDP)', gx1 - 8, Y(r.pipe) - 7, { m: 1, s: 9, a: 'right', c: C.good });
      if (r.rwnd < maxW) { alpha(0.7, () => line(gx0, Y(r.rwnd), gx1, Y(r.rwnd), C.violet, 1.2, [2, 3])); tx('receive window', gx0 + 8, Y(r.rwnd) - 7, { m: 1, s: 9, a: 'left', c: C.violet }); }
      const Xc = s.ctx; Xc.beginPath();
      r.rounds.slice(0, shown).forEach((rd, i) => { const x = X(rd.t), y = Y(rd.n); if (i) Xc.lineTo(x, y); else Xc.moveTo(x, y); });
      Xc.strokeStyle = C.accent; Xc.lineWidth = 1.8; Xc.stroke();
      r.rounds.slice(0, shown).forEach(rd => { if (rd.lost && r.rounds.length < 3000) dot(X(rd.t), Y(rd.n), 2.5, C.bad); });
      tx('segments sent per RTT', gx0 + 8, gy0 + 10, { m: 1, s: 9, a: 'left', c: C.accent });
      tx(`20 MB took ${secs(r.time)} · throughput ${hum(r.thr)} = ${f1(r.util * 100)}% of the link · ${r.losses} loss events`, 14, H - 22, { m: 1, s: n ? 8.5 : 11, w: 700, a: 'left', c: r.util < 0.3 ? C.bad : r.util < 0.7 ? C.accent : C.good });
    },

    stats(s) {
      const r = s.st.r;
      return [
        ['Throughput فعلي', hum(r.thr), r.util < 0.3 ? 'bad' : r.util < 0.7 ? 'warn' : 'good'],
        ['استغلال الـ link', f1(r.util * 100) + ' %', r.util < 0.3 ? 'bad' : r.util < 0.7 ? 'warn' : 'good'],
        ['وقت تحميل 20 MB', secs(r.time)],
        ['Bandwidth × Delay', fmt(r.bdp / 1024) + ' KB', r.rwnd * MSS < r.bdp ? 'warn' : ''],
        ['حد Mathis للـ loss ده', isFinite(r.mathis) ? hum(r.mathis) : '—']
      ];
    }
  });

  Lab.registerLesson({
    id: 'bandwidth', lab: 'networking', title: 'Bandwidth و Latency',
    html: Lab.tpl.lesson({
      sim: 'bandwidth', level: 3,
      terms: ['Bandwidth', 'Latency', 'Throughput', 'Packet Loss', 'BDP', 'Congestion Window'],
      lede: 'تحميل ملف export يومي 20 MB على connection TCP واحد. فوق: الـ «pipe» (عرضه الـ bandwidth وطوله الـ RTT) والـ packets اللي جواه دلوقتي. تحت: TCP بيبعت كام segment في كل round trip، والخط الأخضر هو اللي الـ link يقدر يشيله فعلًا.',
      aria: 'محاكاة TCP congestion window وthroughput على link بـ bandwidth و RTT و loss',
      controls: [
        { type: 'range', p: 'bw', label: 'Bandwidth', min: 0, max: 6, step: 1, value: 4, map: ['1', '5', '10', '50', '100', '500', '1000'], unit: 'Mbit/s' },
        { type: 'range', p: 'rtt', label: 'RTT', min: 5, max: 300, step: 5, value: 80, unit: 'ms' },
        { type: 'range', p: 'loss', label: 'Packet loss', min: 0, max: 2, step: 0.1, value: 0, unit: '%' },
        { type: 'seg', p: 'win', label: 'Receive window', value: 'big', opts: [['big', '4 MB (auto-tuning)'], ['small', '64 KB']] }
      ],
      idea: `
        <p><b>Bandwidth</b>: أقصى bytes ممكن تعدّي في الثانية (عرض الماسورة). <b>Latency</b>: الوقت اللي byte واحد بياخده عشان يوصل (طول الماسورة)، والـ RTT رايح جاي. <b>Throughput</b>: اللي اتنقل فعلًا في الثانية، ودايمًا أقل من الـ bandwidth.</p>
        <p>TCP مبيعرفش سعة الطريق، فبيبعت كمية (<b>congestion window</b>) ويستنى التأكيد، ويكبّرها كل RTT، ولو packet ضاع بيفتكر إن فيه زحمة فبيقسمها نصين. عشان يملا الماسورة لازم يكون بعت <b>Bandwidth × Delay (BDP)</b> قبل ما أول ACK يرجع. فـ RTT عالي أو <b>Packet Loss</b> بسيط ممكن يخلّي throughput link سريع جدًا ضعيف جدًا.</p>`,
      real: `
        <p>السيرفر في أوروبا والعميل في الخليج (RTT 80 ms) على link 100 Mbit/s: الماسورة بتشيل حوالي 1 MB. لو الـ receive window 64 KB، الـ throughput بيبقى حوالي 6.5 Mbit/s بس مهما كانت الـ bandwidth. ونسبة loss 1% على شبكة موبايل بتكسر الـ throughput أكتر من أي حاجة تانية.</p>`,
      try: 'ابدأ بـ 100 Mbit/s وRTT 80 ومن غير loss: الـ slow start بيطلع لحد الخط الأخضر بسرعة. اختار receive window 64 KB: الـ throughput بيقع لحوالي 6% من الـ link. ارجع لـ 4 MB وحط loss 1%: المنحنى سنان منشار وتحت الخط بكتير. بعدين نزّل الـ RTT لـ 10: نفس الـ loss بقى أقل ضرر بكتير.',
      also: 'رفع فيديوهات أو backups بين data centers بعيدة، وتحميل التحديثات للأجهزة، وreplication لقاعدة بيانات في region تانية (شوف <a href="#/databases/replication">Replication Lag</a>).',
      net: `
<pre><span class="c">// الـ buffers بتأثر على الـ window (الـ OS بيعمل auto-tuning افتراضيًا، متصغّرهاش)</span>
socket.ReceiveBufferSize = 4 * 1024 * 1024;

<span class="c">// Stream بدل ما تحمّل الملف كله في الذاكرة</span>
using var resp = await http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct);
await using var file = File.Create(path);
await resp.Content.CopyToAsync(file, ct);

<span class="c">// ملف كبير على RTT عالي: كذا range بالتوازي = كذا TCP window</span>
req.Headers.Range = new RangeHeaderValue(from, to);</pre>`,
      netTitle: 'في .NET',
      deep: [
        '<b>معادلة Mathis:</b> حد أعلى تقريبي لـ TCP Reno = (MSS/RTT) × 1.22/√p. يعني loss 1% وRTT 100 ms يدّيك حوالي 1.4 Mbit/s مهما كانت الـ bandwidth. الـ algorithms الأحدث (CUBIC وهو الافتراضي على Linux و Windows، وBBR) أحسن بكتير على الروابط السريعة، بس القاعدة لسه: loss + RTT = throughput ضعيف.',
        '<b>Window scaling:</b> الـ header الأصلي فيه 16 bit للـ window (أقصى 64 KB). الـ window scaling option بيكبّره. لو جهاز في النص بيشيل الـ option، كل الـ connections بتتحبس عند 64 KB.',
        '<b>Bufferbloat:</b> لو الـ router فيه buffer ضخم، الـ packets بتستنى فيه بدل ما تضيع، فالـ RTT بيعلى جدًا تحت الحمل وكل حاجة تفاعلية بتبطأ. الـ loss أحيانًا إشارة مفيدة.',
        '<b>Latency مش بتتحل بالـ bandwidth:</b> سرعة الضوء في الفايبر حوالي 200,000 km/s، يعني القاهرة-فرانكفورت (حوالي 3,000 km) ~30 ms رايح جاي كحد أدنى. الحل الوحيد إنك تقرّب الداتا (CDN، region أقرب، caching).',
        '<b>تبسيطات:</b> round واحد = RTT واحد بالظبط، والـ loss مستقل لكل segment، ومفيش timeouts (بس fast recovery يقسم النص)، ومفيش traffic تاني على الـ link.'
      ]
    })
  });
})();
