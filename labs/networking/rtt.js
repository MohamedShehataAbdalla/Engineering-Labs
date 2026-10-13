/* Networking · RTT و Jitter
   A probe every 200 ms from the server to a device on a cellular link. Each RTT sample = base + random jitter
   (right-skewed) + optional handover spikes (the radio switching cells adds hundreds of ms for a few seconds).
   Two ways to decide "this reply is late, retry":
     fixed timeout     one number chosen by the developer
     adaptive (TCP)    Jacobson/Karels, as in RFC 6298:
                         RTTVAR = ¾·RTTVAR + ¼·|SRTT − R|,  SRTT = ⅞·SRTT + ⅛·R,  RTO = SRTT + 4·RTTVAR (min 200 ms, as Linux)
   A sample above the timeout counts as a spurious timeout (the reply was coming, we'd have retried for nothing).
   Jitter is the RFC 3550 smoothed mean difference between consecutive samples. Everything is computed per sample. */
(function () {
  "use strict";
  const { clamp, lerp, fmt, f1 } = Lab.util;
  const { box, tx, dot, line, alpha } = Lab.draw;

  const EVERY = 0.2, VIEW = 20;

  function fresh(s) { s.st = { next: s.t, samples: [], srtt: null, rttvar: 0, rto: 1000, jit: 0, last: null, spikeUntil: 0, nextSpike: s.t + 6, fAd: 0, fFix: 0, n: 0 }; }

  Lab.registerSim('rtt', {
    height: 360, warm: 8,
    init(s) { fresh(s); },
    onParam(s, k) { if (k === 'base' || k === 'jit') { const st = s.st; st.fAd = 0; st.fFix = 0; st.n = 0; } },

    step(s) {
      const st = s.st, t = s.t, rnd = s.rng;
      if (s.p.spikes && t >= st.nextSpike) { st.spikeUntil = t + 1.5 + rnd() * 2; st.nextSpike = t + 8 + rnd() * 8; }
      while (st.next <= t) {
        // right-skewed jitter: most samples near the base, a long tail
        const j = s.p.jit * (-Math.log(1 - rnd() * 0.999)) * 0.6;
        const spike = st.next < st.spikeUntil ? 250 + rnd() * 450 : 0;
        const R = s.p.base + j + spike;
        // judge the sample against the timeouts as they were *before* it arrived
        const late = { ad: R > st.rto, fix: R > s.p.fixed };
        if (late.ad) st.fAd++; if (late.fix) st.fFix++; st.n++;
        st.samples.push({ t: st.next, R, rto: st.rto, late });
        // RFC 6298 update
        if (st.srtt === null) { st.srtt = R; st.rttvar = R / 2; }
        else { st.rttvar = 0.75 * st.rttvar + 0.25 * Math.abs(st.srtt - R); st.srtt = 0.875 * st.srtt + 0.125 * R; }
        st.rto = Math.max(200, st.srtt + 4 * st.rttvar);
        // RFC 3550 interarrival jitter estimate
        if (st.last !== null) st.jit += (Math.abs(R - st.last) - st.jit) / 16;
        st.last = R;
        st.next += EVERY;
      }
      st.samples = st.samples.filter(x => x.t > t - 60);
    },

    pct(s, q) { const a = s.st.samples.map(x => x.R).sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * q))] : 0; },

    draw(s) {
      const C = s.C, st = s.st, t = s.t, W = s.w, H = s.h, n = s.narrow;
      const x0 = n ? 40 : 54, x1 = W - 14, y0 = 30, y1 = H - 60;
      const vis = st.samples.filter(x => x.t > t - VIEW), maxR = Math.max(s.p.fixed * 1.15, ...vis.map(x => x.R), ...vis.map(x => x.rto)) * 1.05;
      const X = v => lerp(x0, x1, (v - (t - VIEW)) / VIEW), Y = v => lerp(y1, y0, v / maxR);
      box(x0, y0, x1 - x0, y1 - y0, { r: 6, fill: C.surface, stroke: C.line });
      for (const ms of [100, 250, 500, 1000, 2000]) if (ms < maxR) { alpha(0.4, () => line(x0, Y(ms), x1, Y(ms), C.line, 1, [2, 4])); tx(ms + '', x0 - 4, Y(ms), { m: 1, s: 8, a: 'right', c: C.muted }); }
      if (st.spikeUntil > t) alpha(0.12, () => box(x0, y0, x1 - x0, y1 - y0, { r: 6, fill: C.bad, stroke: null }));
      // fixed timeout
      line(x0, Y(s.p.fixed), x1, Y(s.p.fixed), C.violet, 1.6, [6, 4]);
      tx(`fixed timeout ${s.p.fixed} ms`, x0 + 6, Y(s.p.fixed) - 7, { m: 1, s: 9, w: 700, a: 'left', c: C.violet });
      // adaptive RTO as it evolved
      const Xc = s.ctx; Xc.beginPath();
      vis.forEach((x, i) => { const px = X(x.t), py = Y(x.rto); if (i) Xc.lineTo(px, py); else Xc.moveTo(px, py); });
      Xc.strokeStyle = C.a2; Xc.lineWidth = 1.8; Xc.stroke();
      if (vis.length) tx('adaptive RTO', X(vis[vis.length - 1].t) - 4, Y(vis[vis.length - 1].rto) - 8, { m: 1, s: 9, w: 700, a: 'right', c: C.a2 });
      for (const x of vis) dot(X(x.t), Y(x.R), 2.6, x.late.ad || x.late.fix ? C.bad : C.accent);
      tx(`RTT now ${fmt(st.last || 0)} ms · SRTT ${fmt(st.srtt || 0)} · RTTVAR ${fmt(st.rttvar)} · RTO ${fmt(st.rto)} ms`, 14, 14, { m: 1, s: n ? 8.5 : 10.5, w: 700, a: 'left', c: C.ink });
      tx(`p50 ${fmt(this.pct(s, 0.5))} ms · p99 ${fmt(this.pct(s, 0.99))} ms · jitter ${fmt(st.jit)} ms`, 14, H - 38, { m: 1, s: n ? 8.5 : 10.5, w: 700, a: 'left', c: C.muted });
      tx(`spurious timeouts: adaptive ${st.fAd} · fixed ${st.fFix} (of ${st.n} probes)`, 14, H - 18, { m: 1, s: n ? 8.5 : 10.5, w: 700, a: 'left', c: st.fFix > st.fAd ? C.bad : C.muted });
    },

    stats(s) {
      const st = s.st;
      return [
        ['RTT p50 / p99', `${fmt(this.pct(s, 0.5))} / ${fmt(this.pct(s, 0.99))} ms`, this.pct(s, 0.99) > 3 * this.pct(s, 0.5) ? 'warn' : ''],
        ['Jitter', fmt(st.jit) + ' ms', st.jit > 50 ? 'warn' : ''],
        ['RTO (adaptive) دلوقتي', fmt(st.rto) + ' ms'],
        ['Timeouts غلط: adaptive', `${st.fAd} (${st.n ? f1(st.fAd / st.n * 100) : 0}%)`, st.fAd / Math.max(1, st.n) > 0.02 ? 'warn' : 'good'],
        ['Timeouts غلط: fixed', `${st.fFix} (${st.n ? f1(st.fFix / st.n * 100) : 0}%)`, st.fFix / Math.max(1, st.n) > 0.02 ? 'bad' : 'good']
      ];
    }
  });

  Lab.registerLesson({
    id: 'rtt', lab: 'networking', title: 'RTT و Jitter',
    html: Lab.tpl.lesson({
      sim: 'rtt', level: 3,
      terms: ['RTT', 'Jitter', 'Tail Latency', 'RTO', 'SRTT / RTTVAR'],
      lede: 'probe كل 200 ms لجهاز على شبكة موبايل. كل نقطة RTT اتقاس. الخط المتقطع timeout ثابت حطه مطوّر، والخط التركواز الـ timeout التلقائي اللي TCP بيحسبه من القياسات. النقطة الحمرا رد كان جاي فعلًا بس أبطأ من الـ timeout: retry على الفاضي.',
      aria: 'رسم RTT samples مع timeout ثابت و RTO متكيف',
      controls: [
        { type: 'range', p: 'base', label: 'أقل RTT', min: 20, max: 300, step: 10, value: 80, unit: 'ms' },
        { type: 'range', p: 'jit', label: 'Jitter', min: 0, max: 150, step: 5, value: 30, unit: 'ms' },
        { type: 'seg', p: 'spikes', label: 'Handover spikes', value: 'true', opts: [['true', 'آه'], ['false', 'لأ']] },
        { type: 'range', p: 'fixed', label: 'Timeout ثابت', min: 100, max: 2000, step: 50, value: 300, unit: 'ms' }
      ],
      idea: `
        <p>الـ <b>RTT</b> مش رقم واحد؛ بيتغير مع كل packet (طوابير في الـ routers، الراديو، إعادة إرسال على مستوى الـ link). التذبذب ده اسمه <b>Jitter</b>. والمهم مش المتوسط: الـ p99 (<b>Tail Latency</b>) ممكن يبقى أضعاف الـ p50.</p>
        <p>أي timeout لازم يكون أكبر من الـ RTT الطبيعي، وإلا هتعمل retry لرد كان جاي. TCP بيحسب الـ timeout بتاعه (<b>RTO</b>) من القياسات: متوسط ناعم (<b>SRTT</b>) + 4 أضعاف التذبذب (<b>RTTVAR</b>). فلو الشبكة اتقلبت، الـ RTO بيعلى لوحده.</p>`,
      real: `
        <p>الـ API بيبعت أمر للجهاز ومستني ack بـ timeout ثابت 300 ms (اتجرّب على الـ WiFi بتاع المكتب). على الطريق، العربية بتنقل بين أبراج والـ RTT بيقفز لـ 700 ms ثانيتين: كل الأوامر في الفترة دي بتتعاد، والتكرار نفسه بيزوّد الحمل على شبكة زحمة أصلًا. ولو الأمر مش idempotent («زوّد 10 لتر في العداد»)، بيتنفّذ مرتين.</p>`,
      try: 'سيبها على الإعدادات دي وشوف النقط الحمرا وقت الـ spikes (الخلفية الحمرا): الـ timeout الثابت بيضرب كتير، والـ adaptive بيعلى بعد أول spike ويقلّ الضرب. ارفع الـ timeout الثابت لـ 1000: ضرب أقل بس لو packet ضاع فعلًا هتستنى ثانية كاملة. وشيل الـ spikes وزوّد الـ jitter: لاحظ الفرق بين p50 و p99.',
      also: 'timeouts بين الـ microservices (شوف <a href="#/system-design/resilience">Timeout و Retry</a>)، والـ jitter buffer في المكالمات والفيديو (بيأخر التشغيل شوية عشان الصوت يبقى منتظم)، وألعاب الـ multiplayer (interpolation بين المواقع).',
      net: `
<pre><span class="c">// قيس الـ RTT الحقيقي بدل ما تفترضه</span>
using var ping = new Ping();
var reply = await ping.SendPingAsync(host, TimeSpan.FromSeconds(2), cancellationToken: ct);
Console.WriteLine(reply.RoundtripTime);

<span class="c">// timeout مبني على الـ p99 المتقاس، مش رقم من الـ WiFi</span>
using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
cts.CancelAfter(TimeSpan.FromMilliseconds(p99 * 2));
var ack = await device.SendCommandAsync(cmd with { RequestId = id }, cts.Token);   <span class="c">// id عشان التكرار يبقى آمن</span></pre>`,
      netTitle: 'في .NET',
      deep: [
        '<b>Karn’s algorithm:</b> متقيسش RTT من packet اتعاد إرساله، لأنك مش عارف الـ ack ده لأنهي نسخة. ولما الـ timeout يضرب فعلًا، TCP بيضاعف الـ RTO (exponential backoff) لحد ما قياس سليم يرجع.',
        '<b>Tail latency بيتضاعف:</b> لو صفحة بتعمل 50 call، احتمال إن واحد منهم على الأقل يجي في الـ p99 بتاعه حوالي 40%. يعني الـ p99 بتاع الـ call الواحد هو تقريبًا الـ median بتاع الصفحة.',
        '<b>Hedged requests:</b> بدل retry بعد timeout طويل، ابعت نسخة تانية بعد الـ p95 وخد أول رد. بيقلل الـ tail بتكلفة 5% requests زيادة بس، وينفع بس لو العملية idempotent.',
        '<b>الأرقام:</b> شبكات LTE عادةً RTT من 30 لـ 100 ms على الحالة الكويسة، وممكن تقفز لمئات وقت الـ handover أو لما الراديو يصحى من النوم (أول packet بعد سكون بيتأخر).',
        '<b>تبسيطات:</b> الـ probes مبتضيعش، والـ jitter توزيعه exponential تقريبًا، والـ spikes بتيجي كل 8-16 ثانية. الـ RTO هنا بيتحدث مع كل sample (TCP بيعمل كده مرة لكل RTT تقريبًا).'
      ]
    })
  });
})();
