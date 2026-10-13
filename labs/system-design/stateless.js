/* System Design · Stateless vs Stateful
   30 dispatchers are logged in to the web app; each sends a request every ~2 s. Every request needs the user's
   session (who they are, the filters they picked). The model keeps real session tables:
     in-memory + round robin   each instance has its own dictionary; a request landing on another instance
                               finds nothing → "session not found" → the user is sent back to login
     in-memory + sticky        the load balancer pins each user to one instance (hash of the user id) —
                               works until that instance restarts (its sessions vanish) or you scale out
     Redis (shared store)      instances keep nothing; every request reads the session from Redis (+~1 ms)
   "Restart instance 1" wipes its memory and takes it offline for 3 s; instances can be added at any time.
   Errors, lost sessions and load per instance are counted from the run. */
(function () {
  "use strict";
  const { clamp, lerp, fmt, f1 } = Lab.util;
  const { box, tx, dot, line, alpha } = Lab.draw;

  const USERS = 30;

  function fresh(s) {
    const n = s.p.inst;
    s.st = {
      rr: 0, ok: 0, err: 0, lost: 0, hops: 0, redis: new Map(), fly: [], events: [],
      inst: Array.from({ length: n }, (_, i) => ({ id: i, mem: new Map(), down: 0, load: 0 })),
      users: Array.from({ length: USERS }, (_, i) => ({ id: i, next: s.t + s.rng() * 2, loggedIn: true, flash: 0 }))
    };
    // everyone starts logged in, their session created wherever they first landed
    for (const u of s.st.users) { const target = route(s, u); store(s, target, u, true); }
  }
  const hash = id => (id * 2654435761 >>> 0);
  function route(s, u) {
    const st = s.st, up = st.inst.filter(x => s.t >= x.down);
    if (!up.length) return null;
    if (s.p.lb === 'sticky') {
      // sticky: consistent with the instance list size, like hashing on the current pool
      const i = hash(u.id) % st.inst.length; const want = st.inst[i];
      return s.t >= want.down ? want : up[hash(u.id) % up.length];
    }
    return up[st.rr++ % up.length];
  }
  function store(s, inst, u, create) {
    if (s.p.store === 'redis') { if (create) s.st.redis.set(u.id, { user: u.id }); return s.st.redis.has(u.id); }
    if (create) inst.mem.set(u.id, { user: u.id });
    return inst.mem.has(u.id);
  }

  Lab.registerSim('stateless', {
    height: 380, warm: 2,
    init(s) { fresh(s); },
    onParam(s, k) {
      if (k === 'inst') {
        const st = s.st;
        while (st.inst.length < s.p.inst) st.inst.push({ id: st.inst.length, mem: new Map(), down: 0, load: 0 });
        while (st.inst.length > s.p.inst) st.inst.pop();
        st.events.push({ t: s.t, txt: `scaled to ${s.p.inst} instances` });
      } else fresh(s);
    },
    act: {
      restart(s) { const i = s.st.inst[0]; s.st.lost += i.mem.size; i.mem.clear(); i.down = s.t + 3; s.st.events.push({ t: s.t, txt: 'instance 1 restarted (deploy)' }); }
    },

    step(s) {
      const st = s.st, t = s.t;
      for (const u of st.users) {
        if (t < u.next) continue;
        u.next = t + 1.5 + s.rng();
        if (!u.loggedIn) { const inst = route(s, u); if (inst) { store(s, inst, u, true); u.loggedIn = true; } continue; }
        const inst = route(s, u);
        if (!inst) { st.err++; continue; }
        inst.load++;
        if (s.p.store === 'redis') st.hops++;
        const has = store(s, inst, u, false);
        st.fly.push({ u: u.id, i: inst.id, t, ok: has });
        if (has) st.ok++; else { st.err++; u.loggedIn = false; u.flash = t; }
      }
      st.fly = st.fly.filter(f => t - f.t < 0.4);
      st.events = st.events.filter(e => t - e.t < 4);
    },

    draw(s) {
      const C = s.C, st = s.st, t = s.t, W = s.w, H = s.h, n = s.narrow, redis = s.p.store === 'redis';
      const ux = 14, uw = n ? 70 : 110, ix = n ? W * 0.38 : W * 0.34, iw = n ? W * 0.36 : W * 0.34, N = st.inst.length;
      const uy = i => 30 + (i % 15) * ((H - 60) / 15), ux2 = i => ux + (i < 15 ? 10 : uw / 2 + 10);
      tx('dispatchers', ux, 16, { m: 1, s: n ? 9 : 10.5, w: 700, a: 'left', c: C.accent });
      st.users.forEach(u => {
        const x = ux2(u.id), y = uy(u.id), red = !u.loggedIn || t - u.flash < 1.2;
        dot(x, y, 5, red ? C.bad : C.accent);
        if (!n) tx(red ? 'login!' : `u${u.id + 1}`, x + 9, y, { m: 1, s: 8, a: 'left', c: red ? C.bad : C.muted });
      });
      const ih = Math.min(70, (H - 60) / N - 8);
      st.inst.forEach((inst, i) => {
        const y = 30 + i * (ih + 8), down = t < inst.down;
        box(ix, y, iw, ih, { r: 8, fill: down ? C.bg : C.surface, stroke: down ? C.bad : C.violet, lw: 1.6 });
        tx(`instance ${i + 1}${down ? ' (restarting)' : ''}`, ix + 10, y + 13, { m: 1, s: n ? 8.5 : 10, w: 700, a: 'left', c: down ? C.bad : C.violet });
        tx(redis ? 'no sessions here' : `sessions in memory: ${inst.mem.size}`, ix + 10, y + 30, { m: 1, s: n ? 8 : 9.5, a: 'left', c: C.muted });
        tx(`${inst.load} req`, ix + iw - 10, y + 13, { m: 1, s: 9, a: 'right', c: C.muted });
        inst._y = y + ih / 2;
      });
      if (redis) {
        const rx = ix + iw + (n ? 14 : 40), rw = W - 14 - rx;
        box(rx, H / 2 - 40, rw, 80, { r: 10, fill: C.surface, stroke: C.a2, lw: 2 });
        tx('Redis', rx + rw / 2, H / 2 - 14, { m: 1, s: n ? 10 : 12, w: 700, c: C.a2 });
        tx(`${st.redis.size} sessions`, rx + rw / 2, H / 2 + 6, { m: 1, s: n ? 8.5 : 10, c: C.muted });
        st.inst.forEach(inst => alpha(0.35, () => line(ix + iw, inst._y, rx, H / 2, C.a2, 1)));
      }
      for (const f of st.fly) { const inst = st.inst[f.i]; if (!inst) continue; const k = (t - f.t) / 0.4; dot(lerp(ux2(f.u) + 6, ix, k), lerp(uy(f.u), inst._y, k), 3, f.ok ? C.accent : C.bad); }
      st.events.forEach((e, i) => tx(e.txt, W - 14, H - 14 - i * 14, { m: 1, s: 9.5, w: 700, a: 'right', c: C.bad }));
    },

    stats(s) {
      const st = s.st, loads = st.inst.map(i => i.load), tot = st.ok + st.err;
      return [
        ['Requests نجحت', fmt(st.ok), 'good'],
        ['«Session not found» (رجع login)', fmt(st.err), st.err ? 'bad' : 'good'],
        ['Sessions ضاعت في restart', fmt(st.lost), st.lost ? 'bad' : ''],
        ['توزيع الحمل (أعلى / أقل)', loads.length ? `${Math.max(...loads)} / ${Math.min(...loads)}` : '—', Math.min(...loads) < Math.max(...loads) * 0.5 ? 'warn' : ''],
        ['Hops زيادة لـ Redis', fmt(st.hops) + (st.hops ? ' × ~1 ms' : '')]
      ];
    }
  });

  Lab.registerLesson({
    id: 'stateless', lab: 'system-design', title: 'Stateless vs Stateful',
    html: Lab.tpl.lesson({
      sim: 'stateless', level: 2,
      terms: ['Stateless', 'Stateful', 'Session', 'Sticky Sessions', 'Distributed Cache'],
      lede: '30 dispatcher فاتحين التطبيق، وكل request محتاج الـ session بتاعته (مين المستخدم والفلاتر اللي اختارها). النقطة الحمرا مستخدم اترمى على صفحة الـ login لأن الـ instance اللي وصله مش لاقي الـ session. اعمل restart وزوّد instances وشوف إيه اللي بيحصل.',
      aria: 'محاكاة sessions في ذاكرة السيرفر مقابل sticky sessions مقابل Redis',
      acts: [['restart', 'Restart instance 1 (deploy)']],
      controls: [
        { type: 'seg', p: 'store', label: 'الـ session متخزنة فين', value: 'memory', opts: [['memory', 'في ذاكرة الـ instance'], ['redis', 'Redis مشترك']] },
        { type: 'seg', p: 'lb', label: 'الـ load balancer', value: 'rr', opts: [['rr', 'Round robin'], ['sticky', 'Sticky sessions']] },
        { type: 'range', p: 'inst', label: 'عدد الـ instances', min: 1, max: 5, step: 1, value: 3 }
      ],
      idea: `
        <p><b>Stateful</b>: السيرفر فاكر حاجات عن المستخدم بين الـ requests (في الذاكرة). <b>Stateless</b>: كل request جاي معاه كل اللي محتاجه (token)، أو السيرفر بيجيب الـ state من مكان مشترك. أي instance يقدر يرد على أي request.</p>
        <p>الـ Stateful بيتعارض مع الـ scaling: الـ load balancer لازم يبعت المستخدم لنفس الـ instance دايمًا (<b>Sticky Sessions</b>)، والـ deploy أو الـ crash بيمسح sessions الناس. الحل المعتاد: الـ session في <b>Distributed Cache</b> (Redis) أو جوه token موقّع (<a href="#/system-design/jwt">JWT</a>).</p>`,
      real: `
        <p>كل deploy كان بيطلّع نص الـ dispatchers من التطبيق ويرجّعهم لصفحة الـ login وسط شغلهم. السبب: <code>Session</code> في الذاكرة + sticky sessions، والـ deploy بيعيد تشغيل الـ instances. ولما زوّدوا instance وقت الذروة، فضل فاضي تقريبًا لأن المستخدمين الموجودين لازقين في الـ instances القديمة.</p>`,
      try: 'ابدأ بـ «في الذاكرة» وRound robin: حوالي ربع الـ requests بتفشل والمستخدمين بيترموا على الـ login كل شوية، لأن الـ request بيروح instance مش عنده الـ session. بدّل لـ Sticky: كله تمام. اضغط Restart: كل اللي كانوا على instance 1 اترموا على الـ login. بعدين اختار Redis واعمل restart تاني: ولا حد اتأثر، بالتمن ده: hop زيادة لكل request.',
      also: 'سلة المشتريات في e-commerce، وحالة اللعبة في game server (غالبًا stateful عمدًا ومع sticky)، والـ WebSocket connections (stateful بطبيعتها: لازم backplane عشان الـ push يوصل).',
      net: `
<pre><span class="c">// ❌ الـ session في ذاكرة الـ instance (الافتراضي في AddSession)</span>
builder.Services.AddDistributedMemoryCache();
builder.Services.AddSession();

<span class="c">// ✓ الـ session في Redis: أي instance يقرا أي session</span>
builder.Services.AddStackExchangeRedisCache(o =&gt; o.Configuration = redisConn);
builder.Services.AddSession(o =&gt; o.IdleTimeout = TimeSpan.FromMinutes(30));

<span class="c">// ✓ ومفاتيح حماية الـ cookies لازم تبقى مشتركة كمان، وإلا cookie من instance مش هتتقري في التاني</span>
builder.Services.AddDataProtection().PersistKeysToStackExchangeRedis(redis, "DataProtection-Keys");</pre>`,
      netTitle: 'في ASP.NET Core',
      deep: [
        '<b>Data Protection keys:</b> غلطة شائعة جدًا: الـ session اتنقلت لـ Redis بس مفاتيح تشفير الـ auth cookie لسه على ديسك كل instance، فالـ cookie اللي عمله instance مش بيتقري في التاني. لازم المفاتيح نفسها تبقى مشتركة.',
        '<b>Sticky مش حل كامل:</b> بيكسّر التوزيع (مستخدمين تقال لازقين في instance واحد)، والـ scale-out مبيفيدش المستخدمين الموجودين، والـ restart بيمسح sessions. استخدمه بس لو الـ state غالي فعلًا تنقله (game state، WebSocket).',
        '<b>Redis بقى dependency:</b> لو Redis وقع، كل الـ requests بتقع. محتاج replica وfailover، أو تقبل إن المستخدمين يعملوا login تاني في الحالة دي (degraded mode).',
        '<b>Stateless تمامًا:</b> كل المعلومات في token موقّع (JWT) والسيرفر مش بيخزن حاجة. أسرع وأسهل في الـ scaling، بس إلغاء الـ token قبل ما ينتهي صعب. شوف <a href="#/system-design/jwt">JWT</a>.',
        '<b>تبسيطات:</b> الـ sticky هنا بالـ hash على عدد الـ instances الحالي، فلما تزوّد instance بعض المستخدمين بيتنقلوا (ونتيجتها login تاني في وضع الذاكرة). الـ load balancers الحقيقية غالبًا بتستخدم cookie للـ affinity، فالموجودين بيفضلوا مكانهم.'
      ]
    })
  });
})();
