/* Networking · WebSocket vs Polling
   A vehicle's position changes on the server at random moments (on average every U seconds). A dashboard keeps it on
   screen. Each method is simulated message by message, one-way delay = RTT/2:
     polling       ask every P s; the response carries whatever is newest when it leaves the server (often nothing)
     long polling  the request waits on the server until there is an update (or 30 s); the client asks again at once
     WebSocket     one connection stays open; the server pushes each update when it happens
   Update delay = time the client sees an update − time it happened. Bytes: HTTP request ~400 B + response headers
   ~300 B + body 120 B; WebSocket frame header 2–6 B + body 120 B (typical, approximate). */
(function () {
  "use strict";
  const { clamp, lerp, fmt, f1, expo } = Lab.util;
  const { box, tx, dot, line, alpha, arrow } = Lab.draw;

  const REQ = 400, RESH = 300, BODY = 120, WSH = 6, LP_TIMEOUT = 30, VIEW = 20;

  function fresh(s) {
    s.st = { now: 0, nextUp: expo(1 / s.p.u, s.rng), ver: 0, ups: [], recv: [], msgs: [], bytes: 0, reqs: 0, empty: 0, seen: 0,
      pollNext: 0, lp: null, wsOpen: false, delays: [] };
  }

  Lab.registerSim('websocket', {
    height: 340, warm: 4,
    init(s) { fresh(s); },
    onParam(s) { fresh(s); },

    step(s, dt) {
      const st = s.st, ow = s.p.rtt / 2000, mode = s.p.mode, end = st.now + dt;
      while (st.now < end) {
        const t = st.now = Math.min(end, st.now + 0.01);
        if (t >= st.nextUp) { st.ver++; st.ups.push({ v: st.ver, t }); st.nextUp += expo(1 / s.p.u, s.rng);
          if (mode === 'ws') { st.msgs.push({ dir: 's', t0: t, t1: t + ow, v: st.ver, bytes: BODY + WSH }); }
          if (mode === 'long' && st.lp && st.lp.atServer <= t) { st.msgs.push({ dir: 's', t0: t, t1: t + ow, v: st.ver, bytes: RESH + BODY }); st.lp = null; }
        }
        if (mode === 'poll' && t >= st.pollNext) {
          st.reqs++; st.msgs.push({ dir: 'c', t0: t, t1: t + ow, bytes: REQ });
          st.msgs.push({ dir: 's', t0: t + ow, t1: t + 2 * ow, v: null, bytes: RESH + BODY, snap: true });
          st.pollNext = t + s.p.poll;
        }
        if (mode === 'long' && !st.lp && !st.msgs.some(m => m.dir === 's' && m.t1 > t)) {
          st.reqs++; st.lp = { sent: t, atServer: t + ow }; st.msgs.push({ dir: 'c', t0: t, t1: t + ow, bytes: REQ });
        }
        if (mode === 'long' && st.lp && t >= st.lp.atServer + LP_TIMEOUT) { st.msgs.push({ dir: 's', t0: t, t1: t + ow, v: null, bytes: RESH, emptyLP: true }); st.lp = null; }
        // a long poll that reaches the server while a newer version is waiting is answered at once
        if (mode === 'long' && st.lp && t >= st.lp.atServer && st.ver > st.seen && !st.msgs.some(m => m.dir === 's' && m.t1 > t)) {
          st.msgs.push({ dir: 's', t0: t, t1: t + ow, v: st.ver, bytes: RESH + BODY }); st.lp = null;
        }
        // deliveries
        for (const m of st.msgs) {
          if (m.done || t < m.t1) continue;
          m.done = true; st.bytes += m.bytes;
          if (m.dir !== 's') continue;
          // a polling response carries the newest version that existed when it left the server
          const v = m.snap ? st.ups.filter(u => u.t <= m.t0).reduce((a, u) => Math.max(a, u.v), 0) : m.v;
          if (v && v > st.seen) {
            for (const u of st.ups) if (u.v > st.seen && u.v <= v) st.delays.push([t, t - u.t]);
            st.seen = v; st.recv.push({ t, v });
          } else if (m.snap || m.emptyLP) st.empty++;
        }
        st.msgs = st.msgs.filter(m => !m.done || m.t1 > t - VIEW);
      }
      const cut = st.now - 60;
      st.ups = st.ups.filter(u => u.t > cut - 30); st.recv = st.recv.filter(r => r.t > cut); st.delays = st.delays.filter(d => d[0] > cut);
    },

    m(s) {
      const st = s.st, d = st.delays.map(x => x[1]).sort((a, b) => a - b), mins = Math.max(1 / 60, Math.min(st.now, 60) / 60);
      return { avg: d.length ? d.reduce((a, b) => a + b, 0) / d.length : 0, p95: d.length ? d[Math.floor(d.length * 0.95)] : 0,
        bpm: st.bytes / Math.max(1, st.now) * 60, rpm: st.reqs / Math.max(1, st.now) * 60 };
    },

    draw(s) {
      const C = s.C, st = s.st, W = s.w, H = s.h, n = s.narrow, now = st.now;
      const x0 = n ? 54 : 84, x1 = W - 14, X = t => lerp(x0, x1, (t - (now - VIEW)) / VIEW), yS = 70, yC = 190;
      tx(s.p.mode === 'poll' ? `polling every ${s.p.poll} s` : s.p.mode === 'long' ? 'long polling' : 'WebSocket (one open connection)', 14, 14, { m: 1, s: n ? 9.5 : 12, w: 700, a: 'left', c: C.accent });
      tx('server', 14, yS, { m: 1, s: 10, w: 700, a: 'left', c: C.a2 }); tx('dashboard', 14, yC, { m: 1, s: 10, w: 700, a: 'left', c: C.violet });
      line(x0, yS, x1, yS, C.line, 2); line(x0, yC, x1, yC, C.line, 2);
      if (s.p.mode === 'ws') alpha(0.15, () => box(x0, yS, x1 - x0, yC - yS, { r: 0, fill: C.a2, stroke: null }));
      for (const u of st.ups) if (u.t > now - VIEW) { dot(X(u.t), yS, 5, C.accent); tx('v' + u.v, X(u.t), yS - 12, { m: 1, s: 8, c: C.muted }); }
      for (const m of st.msgs) {
        if (m.t0 > now || m.t1 < now - VIEW) continue;
        const k = clamp((now - m.t0) / (m.t1 - m.t0), 0, 1), a = m.dir === 'c' ? yC : yS, b = m.dir === 'c' ? yS : yC;
        const col = m.dir === 'c' ? C.muted : (m.snap || m.emptyLP) ? C.line : C.a2;
        const xa = X(m.t0), xb = lerp(xa, X(m.t1), k), yb = lerp(a, b, k);
        if (k >= 1) arrow(xa, a, xb, yb, col, 1.2); else line(xa, a, xb, yb, col, 1.2);
      }
      if (s.p.mode === 'long' && st.lp && st.lp.atServer <= now) { const x = X(st.lp.atServer); alpha(0.6, () => line(x, yS + 6, X(now), yS + 6, C.violet, 3)); tx('request held open on the server', x + 4, yS + 18, { m: 1, s: 8.5, a: 'left', c: C.violet }); }
      for (const r of st.recv) if (r.t > now - VIEW) dot(X(r.t), yC, 5, C.violet);
      const mm = this.m(s);
      tx(`update delay: avg ${fmt(mm.avg * 1000)} ms · p95 ${fmt(mm.p95 * 1000)} ms`, 14, H - 50, { m: 1, s: n ? 9 : 11, w: 700, a: 'left', c: mm.p95 > 2 ? C.bad : mm.p95 > 0.5 ? C.accent : C.good });
      tx(`traffic per dashboard: ${fmt(mm.rpm)} requests/min · ${f1(mm.bpm / 1024)} KB/min  →  1,000 dashboards: ${f1(mm.bpm * 1000 / 1048576)} MB/min`, 14, H - 28, { m: 1, s: n ? 8 : 10.5, a: 'left', c: C.muted });
      tx('orange = update on the server · violet = seen by the dashboard · grey arrows = empty answers', 14, H - 8, { m: 1, s: n ? 7.5 : 9, a: 'left', c: C.muted });
    },

    stats(s) {
      const st = s.st, mm = this.m(s), tot = st.reqs || 1;
      return [
        ['Update delay p95', fmt(mm.p95 * 1000) + ' ms', mm.p95 > 2 ? 'bad' : mm.p95 > 0.5 ? 'warn' : 'good'],
        ['Requests في الدقيقة', fmt(mm.rpm), mm.rpm > 60 ? 'bad' : mm.rpm > 10 ? 'warn' : 'good'],
        ['ردود فاضية (مفيش جديد)', st.reqs ? f1(st.empty / tot * 100) + ' %' : '—', st.empty / tot > 0.5 ? 'bad' : ''],
        ['Bytes في الدقيقة', f1(mm.bpm / 1024) + ' KB'],
        ['× 1,000 dashboard', f1(mm.bpm * 1000 / 1048576) + ' MB/min']
      ];
    }
  });

  Lab.registerLesson({
    id: 'websocket', lab: 'networking', title: 'WebSocket vs Polling',
    html: Lab.tpl.lesson({
      sim: 'websocket', level: 2,
      terms: ['Polling', 'Long Polling', 'WebSocket', 'Server Push', 'SignalR'],
      lede: 'مكان العربية بيتغير على السيرفر في لحظات عشوائية (البرتقالي فوق)، والـ dashboard لازم يعرضه (البنفسجي تحت). الأسهم الرمادي requests وردود فاضية، والتركواز ردود فيها جديد. قارن التأخير والـ traffic في كل طريقة.',
      aria: 'محاكاة polling و long polling و WebSocket لتحديثات مكان عربية',
      controls: [
        { type: 'seg', p: 'mode', label: 'الطريقة', value: 'poll', opts: [['poll', 'Polling'], ['long', 'Long polling'], ['ws', 'WebSocket']] },
        { type: 'range', p: 'poll', label: 'Polling كل', min: 0.5, max: 10, step: 0.5, value: 3, unit: 's' },
        { type: 'range', p: 'u', label: 'العربية بتتحرك كل (متوسط)', min: 0.5, max: 20, step: 0.5, value: 4, unit: 's' },
        { type: 'range', p: 'rtt', label: 'RTT', min: 20, max: 400, step: 20, value: 100, unit: 'ms' }
      ],
      idea: `
        <p>HTTP العادي: العميل يسأل والسيرفر يرد، والسيرفر مبيقدرش يبدأ الكلام. <b>Polling</b>: العميل يسأل كل كام ثانية «فيه جديد؟». بسيط، بس أغلب الردود «لأ»، والتأخير لحد فترة الـ polling كاملة.</p>
        <p><b>Long polling</b>: السيرفر بيمسك الـ request لحد ما يحصل جديد، فيرد على طول، والعميل يسأل تاني. <b>WebSocket</b>: connection واحد بيفضل مفتوح والاتنين يبعتوا في أي وقت (<b>Server Push</b>). كل رسالة frame صغير (header بايتات قليلة) بدل request وresponse بـ headers كاملة.</p>`,
      real: `
        <p>dashboard الـ dispatcher فيه 200 عربية بتتحرك. بـ polling كل 3 ثواني: التحديث بيتأخر لحد 3 ثواني، و1,000 dispatcher = 20,000 request في الدقيقة أغلبها بترجع نفس الداتا. بـ WebSocket (SignalR) التحديث بيوصل في نص RTT، والـ traffic على قد التحديثات الحقيقية بس.</p>`,
      try: 'سيبها على polling كل 3 ثواني: التأخير متوسطه حوالي ثانية ونص، ونسبة الردود الفاضية كبيرة. نزّل الـ polling لنص ثانية: التأخير بيقل والـ requests بتنفجر. بدّل لـ WebSocket: التأخير = نص RTT والـ traffic أقل بكتير. وخلّي العربية تتحرك كل 20 ثانية: حوالي 75% من ردود الـ polling بترجع فاضية.',
      also: 'الشات (الرسالة لازم توصل لحظيًا)، وأسعار البورصة، والألعاب الـ multiplayer، والـ notifications في أي تطبيق ويب. وServer-Sent Events (SSE) بديل أبسط لو الـ push من السيرفر بس.',
      net: `
<pre><span class="c">// SignalR: WebSocket (وبيرجع لـ long polling تلقائيًا لو WebSocket مش متاح)</span>
public class FleetHub : Hub { }
app.MapHub&lt;FleetHub&gt;("/hubs/fleet");

<span class="c">// لما مكان عربية يتغير: push لكل الـ dashboards المتابعين للمنطقة دي</span>
await hub.Clients.Group($"region-{v.RegionId}").SendAsync("position", new { v.Id, v.Lat, v.Lng }, ct);</pre>
<pre><span class="c">// المتصفح</span>
const conn = new signalR.HubConnectionBuilder().withUrl("/hubs/fleet").withAutomaticReconnect().build();
conn.on("position", p =&gt; moveMarker(p.id, p.lat, p.lng));
await conn.start();</pre>`,
      netTitle: 'في .NET',
      deep: [
        '<b>WebSocket ليه ثمن على السيرفر:</b> كل dashboard connection مفتوح دايمًا (ذاكرة، descriptor). 100,000 connection محتاجين ضبط (شوف <a href="#/os/fd">File Descriptors</a>). ولو عندك كذا instance، الـ push لازم يعدّي على كلهم (SignalR Redis backplane أو Azure SignalR).',
        '<b>Proxies والـ idle timeouts:</b> بعض الـ proxies والـ load balancers بتقفل connection ساكت بعد 60 ثانية. SignalR بيبعت ping كل 15 ثانية افتراضيًا عشان كده. وشوف <a href="#/networking/nat">NAT</a> لنفس المشكلة.',
        '<b>Backpressure:</b> لو العميل بطيء (موبايل على 2G) والسيرفر بيبعت 50 تحديث في الثانية، الرسايل بتتراكم في الـ buffer. الأحسن تبعت آخر حالة بس (coalescing) مش كل تحديث.',
        '<b>Polling له مكانه:</b> لو التحديثات نادرة جدًا (مرة في الساعة) أو العملاء ملايين وكلهم مش محتاجين لحظي، polling بـ cache (ETag/304) ممكن يبقى أرخص من ملايين connections مفتوحة.',
        '<b>تبسيطات:</b> أحجام الـ headers تقريبية (الحقيقي بيعتمد على الـ cookies والـ auth، وHTTP/2 بيضغط الـ headers)، ومفيش packet loss، والـ long poll timeout 30 ثانية.'
      ]
    })
  });
})();
