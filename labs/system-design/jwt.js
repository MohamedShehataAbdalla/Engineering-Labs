/* System Design · Auth بـ JWT
   A driver's app calls the API every ~20 s (simulated minutes run at 1 per real second). Three designs:
     session        the app holds a random session id; every request looks it up in the session store
     JWT            a signed access token carrying the claims (sub, role, exp); the API only checks the signature
                    and exp, no lookup; when it expires the app uses its refresh token, and the refresh endpoint
                    checks the database (is the account still active?)
     JWT + denylist like JWT, plus a cache lookup of revoked token ids on every request
   "Disable account" is the admin firing a driver; "Token stolen" is someone replaying the current access token.
   Lookups per request, refreshes, and how long a disabled/stolen token keeps working are measured from the run.
   The token shown is really base64url-encoded; its signature is a placeholder (no key here). */
(function () {
  "use strict";
  const { clamp, lerp, fmt, f1 } = Lab.util;
  const { box, tx, dot, line, alpha } = Lab.draw;

  const MIN_PER_SEC = 1, EVERY = 1 / 3, VIEW = 90;     // minutes

  const b64u = obj => btoa(unescape(encodeURIComponent(JSON.stringify(obj)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  function fresh(s) {
    s.st = { now: 0, next: 0.2, active: true, disabledAt: null, stolenAt: null, tok: null, events: [], lookups: 0, reqs: 0, refreshes: 0,
      exposureUser: null, exposureThief: null, jti: 1, revoked: new Set(), thiefNext: null };
    issue(s);
  }
  function issue(s) { const st = s.st; st.tok = { jti: st.jti++, iat: st.now, exp: st.now + s.p.ttl }; st.events.push({ t: st.now, k: 'issue' }); }
  /** does the API accept this request? (the logic of each design) */
  function accept(s, tok, who) {
    const st = s.st, mode = s.p.mode;
    st.reqs++;
    if (mode === 'session') { st.lookups++; return st.active && !(who === 'thief' && st.sessionKilled); }
    if (st.now >= tok.exp) return 'expired';
    if (mode === 'deny') { st.lookups++; if (st.revoked.has(tok.jti)) return false; }
    return true;                                          // signature + exp only: no idea the account is disabled
  }

  Lab.registerSim('jwt', {
    height: 380, warm: 0,
    init(s) { fresh(s); },
    onParam(s) { fresh(s); },
    act: {
      disable(s) { const st = s.st; if (!st.active) return; st.active = false; st.disabledAt = st.now; if (s.p.mode === 'deny' && st.tok) st.revoked.add(st.tok.jti); st.sessionKilled = true; },
      steal(s) { const st = s.st; if (st.stolenAt != null) return; st.stolenAt = st.now; st.stolen = { ...st.tok }; st.thiefNext = st.now; }
    },

    step(s, dt) {
      const st = s.st, end = st.now + dt * MIN_PER_SEC;
      while (st.now < end) {
        st.now = Math.min(end, st.now + 0.02);
        if (st.now >= st.next && !st.loggedOut) {
          st.next += EVERY;
          let ok = accept(s, st.tok, 'user');
          if (ok === 'expired') {
            // refresh: the refresh endpoint checks the account in the database
            st.refreshes++; st.lookups++;
            if (st.active) { issue(s); ok = accept(s, st.tok, 'user'); } else { ok = false; st.loggedOut = true; }   // refresh refused: the app is logged out
          }
          st.events.push({ t: st.now, k: 'req', ok: !!ok });
          if (s.p.mode === 'session' && !ok) st.loggedOut = true;
          if (st.disabledAt != null && ok) st.exposureUser = st.now - st.disabledAt;
        }
        if (st.thiefNext != null && st.now >= st.thiefNext) {
          st.thiefNext += EVERY;
          const ok = accept(s, st.stolen, 'thief');
          st.events.push({ t: st.now, k: 'thief', ok: ok === true });
          if (ok === true) st.exposureThief = st.now - st.stolenAt;
          if (ok === 'expired') st.thiefNext = null;          // the thief has no refresh token
        }
      }
      st.events = st.events.filter(e => e.t > st.now - VIEW - 2);
    },

    draw(s) {
      const C = s.C, st = s.st, W = s.w, H = s.h, n = s.narrow, now = st.now, mode = s.p.mode;
      const x0 = n ? 50 : 80, x1 = W - 14, X = m => lerp(x0, x1, (m - (now - VIEW)) / VIEW);
      tx(`minute ${fmt(now)} · access token lives ${s.p.ttl} min${mode === 'session' ? ' (not used)' : ''}`, 14, 14, { m: 1, s: n ? 8.5 : 10.5, a: 'left', c: C.muted });
      // token lifetimes
      const ty = 40;
      tx('tokens', 14, ty + 8, { m: 1, s: 9, w: 700, a: 'left', c: C.violet });
      if (mode !== 'session') st.events.filter(e => e.k === 'issue').forEach(e => {
        const a = Math.max(x0, X(e.t)), b = Math.min(x1, X(e.t + s.p.ttl));
        if (b > a) { box(a, ty, b - a - 2, 16, { r: 3, fill: C.violet, stroke: null }); alpha(0.9, () => line(a, ty - 4, a, ty + 20, C.ink, 1.2)); }
      });
      else tx('session id → looked up on every request', x0, ty + 8, { m: 1, s: 9, a: 'left', c: C.muted });
      // requests
      const rows = [['driver app', 'req', 90], ['stolen token', 'thief', 140]];
      rows.forEach(([label, k, y]) => {
        tx(label, 14, y, { m: 1, s: 9, w: 700, a: 'left', c: k === 'thief' ? C.bad : C.accent });
        line(x0, y, x1, y, C.line, 1);
        st.events.filter(e => e.k === k && e.t > now - VIEW).forEach(e => dot(X(e.t), y, 3.2, e.ok ? C.good : C.bad));
      });
      for (const [t, label] of [[st.disabledAt, 'account disabled'], [st.stolenAt, 'token stolen']]) {
        if (t == null || t < now - VIEW) continue;
        line(X(t), 30, X(t), 160, C.bad, 1.5, [4, 3]); tx(label, X(t) + 4, 170, { m: 1, s: 9, w: 700, a: 'left', c: C.bad });
      }
      // the token itself
      const header = { alg: 'RS256', typ: 'JWT' }, payload = { sub: 'driver-3512', role: 'driver', iat: Math.floor(st.tok.iat * 60), exp: Math.floor(st.tok.exp * 60), jti: String(st.tok.jti) };
      const py = 196;
      if (mode !== 'session') {
        const h = b64u(header), p = b64u(payload), cut = n ? 22 : 60;
        tx('current access token (header.payload.signature):', 14, py, { m: 1, s: n ? 8.5 : 10, w: 700, a: 'left', c: C.muted });
        tx(h.slice(0, cut / 2), 14, py + 18, { m: 1, s: n ? 8 : 9.5, a: 'left', c: C.bad });
        tx('.' + p.slice(0, cut) + '…', 14 + (n ? 70 : 160), py + 18, { m: 1, s: n ? 8 : 9.5, a: 'left', c: C.violet });
        tx(`payload → ${JSON.stringify(payload)}`, 14, py + 38, { m: 1, s: n ? 7.5 : 9.5, a: 'left', c: C.ink });
        tx('signature → RSA over header.payload with the auth server’s private key (placeholder here)', 14, py + 56, { m: 1, s: n ? 7.5 : 9, a: 'left', c: C.a2 });
      } else tx('session id: 9f2c…e1 (random, meaningless without the session store)', 14, py + 18, { m: 1, s: n ? 8 : 10, a: 'left', c: C.ink });
      const lpr = st.reqs ? st.lookups / st.reqs : 0;
      tx(`lookups per request: ${f1(lpr)} · refreshes: ${st.refreshes} · still accepted after disable: ${st.exposureUser != null ? fmt(st.exposureUser) + ' min' : '—'} · stolen token worked for: ${st.exposureThief != null ? fmt(st.exposureThief) + ' min' : '—'}`, 14, H - 14, { m: 1, s: n ? 7.5 : 10, w: 700, a: 'left', c: (st.exposureUser || st.exposureThief) ? C.bad : C.muted });
    },

    stats(s) {
      const st = s.st, lpr = st.reqs ? st.lookups / st.reqs : 0;
      return [
        ['Lookups لكل request', f1(lpr), lpr > 0.5 ? 'warn' : 'good'],
        ['Refresh calls', String(st.refreshes)],
        ['شغال بعد ما الحساب اتقفل', st.exposureUser != null ? fmt(st.exposureUser) + ' min' : (st.disabledAt != null ? '0' : '—'), st.exposureUser ? 'bad' : ''],
        ['الـ token المسروق اشتغل لمدة', st.exposureThief != null ? fmt(st.exposureThief) + ' min' : (st.stolenAt != null ? '0' : '—'), st.exposureThief ? 'bad' : '']
      ];
    }
  });

  Lab.registerLesson({
    id: 'jwt', lab: 'system-design', title: 'Auth بـ JWT',
    html: Lab.tpl.lesson({
      sim: 'jwt', level: 2,
      terms: ['JWT', 'Access Token', 'Refresh Token', 'Revocation', 'Session'],
      lede: 'تطبيق السواق بيكلّم الـ API كل 20 ثانية (كل ثانية هنا = دقيقة). البنفسجي عمر الـ access token. اضغط «اقفل الحساب» (السواق اتفصل) أو «Token اتسرق»، وشوف كل تصميم بيوقفه إمتى، وبيدفع إيه في كل request.',
      aria: 'محاكاة sessions مقابل JWT مقابل JWT مع denylist',
      acts: [['disable', 'اقفل حساب السواق'], ['steal', 'Token اتسرق']],
      controls: [
        { type: 'seg', p: 'mode', label: 'التصميم', value: 'jwt', opts: [['session', 'Session في store'], ['jwt', 'JWT'], ['deny', 'JWT + denylist']] },
        { type: 'range', p: 'ttl', label: 'عمر الـ access token', min: 5, max: 60, step: 5, value: 30, unit: 'min' }
      ],
      idea: `
        <p><b>Session</b>: السيرفر بيدّي العميل id عشوائي، ومع كل request بيدوّر عليه في store (Redis أو DB) يعرف مين ده. سهل تلغيه (امسح الـ session)، بس فيه lookup في كل request.</p>
        <p><b>JWT</b>: token فيه البيانات نفسها (مين، الصلاحيات، إمتى ينتهي) وعليه توقيع. أي سيرفر يتأكد منه بالمفتاح العام من غير ما يسأل حد: stateless وسريع. المشكلة <b>Revocation</b>: مفيش طريقة توقف token قبل ما ينتهي إلا لو رجعت تعمل lookup. عشان كده الـ <b>Access Token</b> بيبقى قصير العمر، ومعاه <b>Refresh Token</b> طويل بيتشيك عليه في الـ DB لما تجدد.</p>`,
      real: `
        <p>سواق اتفصل الساعة 2. الأدمن قفل الحساب، بس تطبيقه فضل شغال: بيستلم رحلات ويشوف عناوين العملاء لحد ما الـ access token خلص، لأن الـ API بيتأكد من التوقيع والتاريخ بس. لو الـ token عمره 24 ساعة، ده يوم كامل. الحل: access token 5-15 دقيقة، والـ refresh يتشيك على حالة الحساب، وللحالات الحساسة denylist.</p>`,
      try: 'سيبها على JWT بعمر 30 دقيقة واضغط «اقفل الحساب»: الـ requests بتفضل خضرا لحد ما الـ token ينتهي، والـ refresh هو اللي بيرفض. صغّر العمر لـ 5 دقايق وكرر: نافذة أصغر، بس refreshes أكتر. اختار Session: الرفض فوري بس فيه lookup في كل request. وJWT + denylist: فوري برضه، بس رجعت للـ lookup. جرّب «Token اتسرق» في كل وضع.',
      also: 'تطبيقات البنوك (access token دقايق قليلة)، والـ APIs بين الخدمات (tokens قصيرة جدًا)، وتسجيل الدخول بحساب Google أو Microsoft (OpenID Connect = JWT).',
      net: `
<pre><span class="c">// الـ API: بيتأكد من التوقيع والـ issuer والـ audience والـ exp، من غير أي lookup</span>
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o =&gt; {
        o.Authority = "https://auth.fleet.com";             <span class="c">// بيجيب المفاتيح العامة (JWKS)</span>
        o.Audience = "fleet-api";
        o.TokenValidationParameters.ClockSkew = TimeSpan.FromSeconds(30);   <span class="c">// الافتراضي 5 دقايق!</span>
    });

<span class="c">// denylist اختياري للحالات الحساسة (جوه نفس الـ AddJwtBearer)</span>
o.Events = new JwtBearerEvents { OnTokenValidated = async ctx =&gt; {
    var jti = ctx.Principal!.FindFirstValue(JwtRegisteredClaimNames.Jti);
    if (await denylist.ContainsAsync(jti)) ctx.Fail("revoked"); } };</pre>`,
      netTitle: 'في ASP.NET Core',
      deep: [
        '<b>JWT مش مشفّر:</b> الـ payload base64 بس، أي حد يقراه. متحطش فيه بيانات سرية. التوقيع بيضمن إن محدش غيّره، مش إن محدش شافه.',
        '<b>ClockSkew الافتراضي 5 دقايق:</b> في ASP.NET Core الـ token بيفضل مقبول 5 دقايق بعد الـ exp عشان فروق الساعات. لو الـ access token عمره 5 دقايق، ده بيضاعف النافذة. قلّله.',
        '<b>Refresh token rotation:</b> كل refresh يدّي refresh token جديد ويلغي القديم. لو حد استخدم refresh token قديم (يعني اتسرق)، الغِ كل العيلة. والـ refresh token مكانه آمن (httpOnly cookie أو secure storage)، مش localStorage.',
        '<b>RS256 مقابل HS256:</b> HS256 مفتاح سري واحد للتوقيع والتحقق، فكل خدمة بتتحقق تقدر كمان تصدر tokens. RS256 (مفتاح خاص للتوقيع وعام للتحقق) أأمن في الأنظمة الموزّعة.',
        '<b>تبسيطات:</b> request كل 20 ثانية، والـ thief معاه الـ access token بس (من غير refresh token)، والـ lookups كلها بنفس التكلفة. الـ refresh token نفسه عمره أطول من التجربة.'
      ]
    })
  });
})();
