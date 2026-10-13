/* Networking · DNS Resolution
   40 GPS devices resolve ingest.fleet.com through their operator's recursive resolver whenever they (re)connect.
   The resolver's cache is real: a hit answers right away; a miss walks root → .com → fleet.com's authoritative
   server (one round trip each) and caches the answer for its TTL. Each device also keeps the address it got for as
   long as the TTL says (as an OS resolver cache would).
   "Failover" changes the authoritative A record from the old server (now down) to the new one at that instant;
   devices keep using the old address until both caches have expired. Simulated time runs 30× faster.
   Lookup times are sums of the per-hop round trips (approximate typical values); counts come from the run. */
(function () {
  "use strict";
  const { clamp, lerp, fmt, f1, expo } = Lab.util;
  const { box, tx, dot, line, arrow, alpha } = Lab.draw;

  const N = 40, SPEED = 30, RTT = { dev: 30, root: 20, tld: 25, auth: 40 }, OLD = '203.0.113.10', NEW = '203.0.113.77';

  function fresh(s) {
    const rnd = s.rng;
    s.st = { now: 0, auth: OLD, cache: null, hits: 0, miss: 0, lat: [], last: null, failAt: null, allMovedAt: null, failedConns: 0,
      dev: Array.from({ length: N }, () => ({ ip: null, until: 0, next: rnd() * 120 })) };
  }
  function resolve(st, ttl) {
    let path, ms;
    if (st.cache && st.cache.until > st.now) { st.hits++; path = ['resolver']; ms = RTT.dev; }
    else { st.miss++; path = ['resolver', 'root', '.com', 'fleet.com']; ms = RTT.dev + RTT.root + RTT.tld + RTT.auth; st.cache = { ip: st.auth, until: st.now + ttl }; }
    st.lat.push(ms); if (st.lat.length > 200) st.lat.shift();
    st.last = { path, ip: st.cache.ip, t: st.now };
    return { ip: st.cache.ip, until: st.cache.until };
  }

  Lab.registerSim('dns', {
    height: 380, warm: 2,
    init(s) { fresh(s); },
    onParam(s) { fresh(s); },
    act: { failover(s) { const st = s.st; if (st.auth === OLD) { st.auth = NEW; st.failAt = st.now; st.allMovedAt = null; } } },

    step(s, dt) {
      const st = s.st, ttl = s.p.ttl, end = st.now + dt * SPEED;
      while (st.now < end) {
        st.now = Math.min(end, st.now + 0.5);
        for (const d of st.dev) {
          if (st.now < d.next) continue;
          // reconnect: use the cached address if it hasn't expired, otherwise ask the resolver
          if (!d.ip || d.until <= st.now) { const r = resolve(st, ttl); d.ip = r.ip; d.until = Math.min(r.until, st.now + ttl); }
          if (d.ip === OLD && st.failAt !== null) st.failedConns++;
          d.next = st.now + 60 + s.rng() * 60;
        }
        if (st.failAt !== null && st.allMovedAt === null && st.dev.every(d => d.ip === NEW)) st.allMovedAt = st.now;
      }
    },

    draw(s) {
      const C = s.C, st = s.st, W = s.w, H = s.h, n = s.narrow;
      // the resolution chain
      const nodes = [['device', 'GPS device'], ['resolver', 'operator resolver (cache)'], ['root', 'root  .'], ['.com', 'TLD  .com'], ['fleet.com', 'fleet.com (authoritative)']];
      const cx = n ? [40, W / 2 - 20, W - 60, W - 60, W - 60] : [70, 250, W - 150, W - 150, W - 150];
      const cy = n ? [60, 60, 30, 70, 110] : [80, 80, 36, 84, 132];
      const pos = Object.fromEntries(nodes.map(([k], i) => [k, { x: cx[i], y: cy[i] }]));
      nodes.forEach(([k, label], i) => {
        box(cx[i] - (n ? 34 : 60), cy[i] - 13, n ? 68 : 120, 26, { r: 6, fill: C.surface, stroke: k === 'fleet.com' ? C.a2 : k === 'resolver' ? C.violet : C.line });
        tx(n ? k : label, cx[i], cy[i], { m: 1, s: n ? 7.5 : 9, w: 700, c: C.ink });
      });
      const L = st.last, age = L ? (st.now - L.t) / SPEED : 9;
      if (L && age < 1.2) {
        const hops = ['device', ...L.path];
        for (let i = 1; i < hops.length; i++) { const a = pos[hops[i === 1 ? 0 : 1]], b = pos[hops[i]]; alpha(1 - age / 1.2, () => arrow(a.x + (n ? 34 : 60), a.y, b.x - (n ? 34 : 60), b.y, i === 1 ? C.accent : C.violet, 1.6)); }
        tx(L.path.length === 1 ? `cache hit · ${RTT.dev} ms` : `cache miss: 3 more round trips · ${RTT.dev + RTT.root + RTT.tld + RTT.auth} ms`, pos.resolver.x, pos.resolver.y + 28, { m: 1, s: n ? 8 : 10, w: 700, c: L.path.length === 1 ? C.good : C.accent });
      }
      const cacheTxt = st.cache && st.cache.until > st.now ? `resolver cache: ingest.fleet.com → ${st.cache.ip} · TTL left ${fmt(st.cache.until - st.now)} s` : 'resolver cache: empty';
      tx(cacheTxt, 14, n ? 140 : 168, { m: 1, s: n ? 8.5 : 10.5, w: 700, a: 'left', c: C.violet });
      tx(`authoritative A record: ${st.auth}${st.auth === NEW ? '  (old server is down)' : ''}`, 14, n ? 156 : 186, { m: 1, s: n ? 8.5 : 10.5, w: 700, a: 'left', c: st.auth === NEW ? C.bad : C.a2 });
      // devices: which address each one is using
      const gy = n ? 176 : 206, cols = n ? 10 : 20, cw = (W - 28) / cols, rh = 26;
      st.dev.forEach((d, i) => {
        const x = 14 + (i % cols) * cw, y = gy + Math.floor(i / cols) * rh, old = d.ip === OLD;
        box(x + 2, y, cw - 4, rh - 6, { r: 4, fill: !d.ip ? C.bg : old ? (st.failAt !== null ? C.bad : C.a2) : C.good, stroke: null });
      });
      const usingOld = st.dev.filter(d => d.ip === OLD).length;
      let msg = st.failAt === null ? `all ${N} devices use ${OLD}` : st.allMovedAt !== null ? `all devices moved to ${NEW} after ${fmt(st.allMovedAt - st.failAt)} s` : `${usingOld} of ${N} devices still connect to the dead server · ${fmt(st.now - st.failAt)} s since failover`;
      tx(msg, 14, H - 16, { m: 1, s: n ? 9 : 11, w: 700, a: 'left', c: st.failAt !== null && st.allMovedAt === null ? C.bad : C.good });
    },

    stats(s) {
      const st = s.st, tot = st.hits + st.miss, avg = st.lat.length ? st.lat.reduce((a, b) => a + b, 0) / st.lat.length : 0;
      return [
        ['Cache hit', tot ? f1(st.hits / tot * 100) + ' %' : '—', st.hits / Math.max(1, tot) > 0.8 ? 'good' : 'warn'],
        ['متوسط زمن الـ lookup', fmt(avg) + ' ms'],
        ['أسئلة للـ authoritative', fmt(st.miss)],
        ['Connections للسيرفر الميت', fmt(st.failedConns), st.failedConns ? 'bad' : ''],
        ['وقت لحد ما الكل يتحول', st.failAt === null ? '—' : st.allMovedAt !== null ? fmt(st.allMovedAt - st.failAt) + ' s' : '…', st.allMovedAt !== null && st.allMovedAt - st.failAt > 600 ? 'bad' : '']
      ];
    }
  });

  Lab.registerLesson({
    id: 'dns', lab: 'networking', title: 'DNS Resolution',
    html: Lab.tpl.lesson({
      sim: 'dns', level: 2,
      terms: ['DNS', 'Recursive Resolver', 'Authoritative', 'TTL', 'Cache'],
      lede: '40 جهاز بيسألوا عن <code>ingest.fleet.com</code> كل ما يتوصلوا. لو الإجابة في cache الـ resolver بتيجي على طول، لو لأ الـ resolver بيسأل الـ root ثم .com ثم السيرفر المسؤول عن fleet.com. اضغط «Failover» عشان تغيّر العنوان، وشوف الأجهزة (المربعات) بتتحول إمتى. الوقت أسرع 30 مرة.',
      aria: 'محاكاة DNS resolution مع cache و TTL و failover',
      acts: [['failover', 'Failover: السيرفر القديم وقع']],
      controls: [
        { type: 'seg', p: 'ttl', label: 'TTL للـ record', value: 300, opts: [[30, '30 s'], [300, '5 دقايق'], [3600, 'ساعة']] }
      ],
      idea: `
        <p><b>DNS</b> بيحوّل اسم (ingest.fleet.com) لعنوان IP. الجهاز بيسأل <b>Recursive Resolver</b> (غالبًا بتاع شركة الاتصالات)، وده لو مش عارف الإجابة بيسأل سلسلة: الـ root، ثم المسؤول عن .com، ثم السيرفر الـ <b>Authoritative</b> لـ fleet.com اللي عنده الإجابة الحقيقية.</p>
        <p>كل إجابة معاها <b>TTL</b>: «احتفظ بيها في الـ <b>cache</b> الثواني دي». TTL طويل = lookups أقل وأسرع، بس لو العنوان اتغير، الناس هتفضل تروح للقديم لحد ما الـ TTL يخلص.</p>`,
      real: `
        <p>سيرفر الـ ingest الأساسي وقع والفريق حوّل الـ DNS على سيرفر احتياطي. لو الـ TTL ساعة، العربيات هتفضل تحاول تتوصل بالسيرفر الميت لحد ساعة كمان (وأحيانًا أكتر، لأن فيه أجهزة وresolvers مبتحترمش الـ TTL). الحل إنك تقصّر الـ TTL قبل أي migration مخطط، أو تحط load balancer بـ IP ثابت قدام السيرفرات.</p>`,
      try: 'سيبها على 5 دقايق واضغط Failover: المربعات بتخضر واحد ورا التاني، والكل بيتحول في أقل من 5 دقايق تقريبًا (على حسب فاضل قد إيه في الـ TTL ساعتها). جرّب TTL ساعة: الـ lookup سريع وقليل، بس الـ failover بياخد قرب ساعة وفيه مئات المحاولات على السيرفر الميت. وTTL 30 ثانية: الـ authoritative بيتسأل 10 أضعاف، والتحول بقى محكوم بإمتى الجهاز بيعيد الاتصال (كل دقيقة أو اتنين).',
      also: 'تغيير IP موقع، أو نقل خدمة لـ cloud تاني، أو blue/green deployment بالـ DNS. وهجمات DNS cache poisoning بتستغل نفس الـ cache. والـ CDNs بتستخدم DNS عشان توجّه كل مستخدم لأقرب سيرفر.',
      net: `
<pre><span class="c">// الـ OS هو اللي بيحل الاسم ويعمل cache</span>
IPAddress[] addrs = await Dns.GetHostAddressesAsync("ingest.fleet.com", ct);

<span class="c">// HttpClient طويل العمر بيفضل على نفس الـ connection، يعني نفس الـ IP القديم:</span>
<span class="c">// PooledConnectionLifetime بيخلّيه يقفل ويحل الاسم من جديد كل فترة</span>
var http = new HttpClient(new SocketsHttpHandler { PooledConnectionLifetime = TimeSpan.FromMinutes(2) });</pre>
<pre><span class="c"># شوف الـ TTL اللي راجع</span>
nslookup -debug ingest.fleet.com
dig ingest.fleet.com +noall +answer      <span class="c"># ingest.fleet.com. 300 IN A 203.0.113.10</span></pre>`,
      netTitle: 'في .NET والأدوات',
      deep: [
        '<b>مفيش cache واحد:</b> فيه cache في المتصفح، وفي الـ OS، وفي الـ resolver، وأحيانًا في الـ app نفسه. وفوق ده connections مفتوحة بتفضل على الـ IP القديم مهما حصل في الـ DNS، لحد ما تتقفل.',
        '<b>الأجهزة المدمجة:</b> أجهزة GPS كتير بتحل الاسم مرة واحدة وقت التشغيل وتفضل بالـ IP ده لحد الـ reboot، أو أصلًا العنوان مكتوب فيها hard-coded. لو ده موقفك، مفيش TTL هينقذك: الـ IP لازم يفضل ثابت (load balancer أو anycast).',
        '<b>Negative caching:</b> لو الاسم مش موجود (NXDOMAIN) الإجابة دي كمان بتتعمل لها cache. غلطة في الـ DNS بتفضل موجودة بعد ما تصلّحها.',
        '<b>DNS بيبقى نقطة فشل:</b> لو الـ resolver وقع أو بطيء، كل connection جديد بيستنى. ومعظم الأنظمة بتعمل timeout للـ DNS بعد 5 ثواني أو أكتر. Monitor الـ DNS زي أي dependency.',
        '<b>تبسيطات:</b> resolver واحد لكل الأجهزة، والـ root والـ .com بيتسألوا مع كل miss (الحقيقي بيعمل لهم cache لأيام). أزمنة الـ round trips تقريبية.'
      ]
    })
  });
})();
