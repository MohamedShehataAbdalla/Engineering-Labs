/* System Design · Sync APIs vs Events
   "Trip completed" (5/s). Four other services care about it: Billing 80 ms, Notifications 50 ms, Analytics 120 ms,
   Loyalty 60 ms (typical call times). Two designs, run on the same requests:
     sync    the Trip API calls the four services one after another inside the request; a slow service slows every
             request, a down one fails it after a 2 s timeout
     events  the Trip API saves the trip, publishes TripCompleted (outbox, ~20 ms) and answers; each service has its
             own queue and consumes at its own pace — a broken service only builds up its own backlog
   A fault can be injected into one service (slow = 10× its time, down = not answering). Latency, success rate and
   each subscriber's backlog/lag come from the run. */
(function () {
  "use strict";
  const { clamp, lerp, fmt, f1, expo } = Lab.util;
  const { box, tx, dot, line, arrow, alpha } = Lab.draw;

  const SVC = [['Billing', 0.08], ['Notifications', 0.05], ['Analytics', 0.12], ['Loyalty', 0.06]];
  const TIMEOUT = 2, PUBLISH = 0.02, WIN = 15;

  function fresh(s) {
    s.st = { next: s.t + 0.1, reqs: [], done: [], subs: SVC.map(() => ({ q: [], cur: null, end: 0, processed: 0 })), id: 0 };
  }
  function health(s, i) { const f = s.p.fault; if (f === 'none') return 'ok'; const [name, kind] = f.split('-'); return SVC[i][0].toLowerCase() === name ? kind : 'ok'; }

  Lab.registerSim('sync-events', {
    height: 380, warm: 5,
    init(s) { fresh(s); },
    onParam(s, k) { if (k === 'mode') fresh(s); },

    step(s) {
      const st = s.st, t = s.t, sync = s.p.mode === 'sync';
      while (st.next <= t) {
        const r = { id: ++st.id, t0: st.next, step: 0, until: st.next, ok: true };
        if (!sync) { r.until = st.next + PUBLISH; st.subs.forEach(sb => sb.q.push({ id: r.id, t: st.next + PUBLISH })); }
        st.reqs.push(r);
        st.next += expo(s.p.rate, s.rng);
      }
      // sync: walk each request through the chain of calls
      st.reqs = st.reqs.filter(r => {
        if (!sync) { if (t >= r.until) { st.done.push({ t, lat: r.until - r.t0, ok: true }); return false; } return true; }
        while (t >= r.until) {
          if (r.step >= SVC.length) { st.done.push({ t, lat: r.until - r.t0, ok: r.ok }); return false; }
          const h = health(s, r.step);
          if (h === 'down') { r.until += TIMEOUT; r.ok = false; r.step = SVC.length; continue; }   // timeout fails the whole request
          r.until += SVC[r.step][1] * (h === 'slow' ? 10 : 1) * (0.8 + s.rng() * 0.4); r.step++;
        }
        return true;
      });
      // events: every subscriber works its own queue
      if (!sync) st.subs.forEach((sb, i) => {
        const h = health(s, i);
        if (sb.cur && t >= sb.end) { sb.processed++; sb.cur = null; }
        if (!sb.cur && sb.q.length && h !== 'down' && t >= sb.q[0].t) { sb.cur = sb.q.shift(); sb.end = t + SVC[i][1] * (h === 'slow' ? 10 : 1) * (0.8 + s.rng() * 0.4); }
      });
      st.done = st.done.filter(d => d.t > t - WIN);
    },

    m(s) {
      const d = s.st.done, l = d.map(x => x.lat).sort((a, b) => a - b);
      return { ok: d.length ? d.filter(x => x.ok).length / d.length : 1, p95: l.length ? l[Math.floor(l.length * 0.95)] : 0, inflight: s.st.reqs.length };
    },

    draw(s) {
      const C = s.C, st = s.st, t = s.t, W = s.w, H = s.h, n = s.narrow, sync = s.p.mode === 'sync';
      const ax = 14, aw = n ? 80 : 130, ay = H / 2 - 50, sx = W - 14 - (n ? 120 : 200), sw = W - 14 - sx;
      const m = this.m(s);
      box(ax, ay, aw, 100, { r: 10, fill: C.surface, stroke: m.ok < 0.99 ? C.bad : C.accent, lw: 2 });
      tx('Trip API', ax + aw / 2, ay + 18, { m: 1, s: n ? 10 : 12, w: 700, c: C.accent });
      tx(`${st.reqs.length} in progress`, ax + aw / 2, ay + 42, { m: 1, s: n ? 8 : 9.5, c: st.reqs.length > 10 ? C.bad : C.muted });
      tx(`p95 ${fmt(m.p95 * 1000)} ms`, ax + aw / 2, ay + 62, { m: 1, s: n ? 8.5 : 10, w: 700, c: m.p95 > 1 ? C.bad : m.p95 > 0.3 ? C.accent : C.good });
      tx(`ok ${f1(m.ok * 100)}%`, ax + aw / 2, ay + 80, { m: 1, s: n ? 8.5 : 10, w: 700, c: m.ok < 0.99 ? C.bad : C.good });
      let bx = ax + aw + 20;
      if (!sync) {
        const bw = n ? 60 : 100; bx = (ax + aw + sx) / 2 - bw / 2;
        box(bx, ay + 10, bw, 80, { r: 8, fill: C.surface, stroke: C.violet, lw: 2 });
        tx('broker', bx + bw / 2, ay + 38, { m: 1, s: n ? 9 : 11, w: 700, c: C.violet });
        tx('TripCompleted', bx + bw / 2, ay + 56, { m: 1, s: n ? 7 : 8.5, c: C.muted });
        alpha(0.5, () => arrow(ax + aw, ay + 50, bx - 4, ay + 50, C.accent, 1.4));
        bx += bw;
      }
      const rh = (H - 60) / SVC.length;
      SVC.forEach(([name, ms], i) => {
        const y = 30 + i * rh, h = health(s, i), sb = st.subs[i], col = h === 'down' ? C.bad : h === 'slow' ? C.accent : C.a2;
        box(sx, y, sw, rh - 10, { r: 8, fill: C.surface, stroke: col, lw: 1.6 });
        tx(`${name}${h !== 'ok' ? (h === 'down' ? ' (down)' : ' (slow ×10)') : ''}`, sx + 8, y + 14, { m: 1, s: n ? 8.5 : 10, w: 700, a: 'left', c: col });
        if (sync) tx(`~${fmt(ms * 1000)} ms per call`, sx + 8, y + 30, { m: 1, s: n ? 7.5 : 9, a: 'left', c: C.muted });
        else {
          const lag = sb.q.length ? t - sb.q[0].t : 0;
          tx(`backlog ${sb.q.length} · lag ${f1(lag)} s`, sx + 8, y + 30, { m: 1, s: n ? 7.5 : 9, a: 'left', c: lag > 3 ? C.bad : C.muted });
          box(sx + 8, y + 40, sw - 16, 5, { r: 2, fill: C.bg, stroke: null });
          box(sx + 8, y + 40, (sw - 16) * clamp(sb.q.length / 100, 0, 1), 5, { r: 2, fill: lag > 3 ? C.bad : C.violet, stroke: null });
        }
        alpha(0.4, () => line(bx + 4, ay + 50, sx, y + (rh - 10) / 2, sync ? C.accent : C.violet, 1, sync ? null : [4, 3]));
      });
      if (sync) {
        // requests walking along the chain
        st.reqs.slice(0, 30).forEach((r, j) => {
          const i = Math.min(SVC.length - 1, r.step), y = 30 + i * rh + (rh - 10) / 2;
          dot(sx - 10 - (j % 6) * 7, y + Math.floor(j / 6) * 7 - 10, 3, r.ok ? C.accent : C.bad);
        });
      }
      tx(sync ? 'sync: the request waits for all four calls, one after another' : 'events: the request ends after publishing; services catch up on their own', 14, H - 12, { m: 1, s: n ? 8 : 10.5, w: 700, a: 'left', c: C.muted });
    },

    stats(s) {
      const m = this.m(s), st = s.st, worst = Math.max(...st.subs.map(sb => sb.q.length ? s.t - sb.q[0].t : 0));
      return [
        ['Trip API: نجاح', f1(m.ok * 100) + ' %', m.ok < 0.99 ? 'bad' : 'good'],
        ['Trip API: p95', fmt(m.p95 * 1000) + ' ms', m.p95 > 1 ? 'bad' : m.p95 > 0.3 ? 'warn' : 'good'],
        ['Requests مستنية جوه الـ API', String(m.inflight), m.inflight > 10 ? 'bad' : ''],
        ['أكبر lag عند subscriber', s.p.mode === 'events' ? f1(worst) + ' s' : '—', worst > 3 ? 'warn' : '']
      ];
    }
  });

  Lab.registerLesson({
    id: 'sync-events', lab: 'system-design', title: 'Sync APIs vs Events',
    html: Lab.tpl.lesson({
      sim: 'sync-events', level: 2,
      terms: ['Synchronous Call', 'Event-driven', 'Publish/Subscribe', 'Temporal Coupling', 'Eventual Consistency'],
      lede: 'لما الرحلة تخلص، 4 خدمات لازم تعرف: الفواتير، والإشعارات، والتحليلات، ونقاط الولاء. إما الـ Trip API ينادي الأربعة بنفسه (sync)، أو ينشر event واحد وكل خدمة تقرا من الطابور بتاعها. اعمل عطل في خدمة وشوف مين بيتأثر.',
      aria: 'محاكاة sync calls مقابل events بين microservices مع عطل في خدمة',
      controls: [
        { type: 'seg', p: 'mode', label: 'التصميم', value: 'sync', opts: [['sync', 'Sync calls'], ['events', 'Events']] },
        { type: 'seg', p: 'fault', label: 'عطل في', value: 'none', opts: [['none', 'مفيش'], ['analytics-slow', 'Analytics بطيئة'], ['analytics-down', 'Analytics واقعة'], ['billing-down', 'Billing واقعة']] },
        { type: 'range', p: 'rate', label: 'رحلات بتخلص في الثانية', min: 1, max: 10, step: 1, value: 5 }
      ],
      idea: `
        <p><b>Synchronous Call</b>: الخدمة بتنادي التانية وتستنى الرد. بسيط وواضح، بس بيعمل <b>Temporal Coupling</b>: لازم الخدمتين يكونوا شغالين في نفس اللحظة. الـ latency بيتجمع، والـ availability بيتضرب: 4 خدمات كل واحدة 99.9% = 99.6% للـ request.</p>
        <p><b>Event-driven</b> (<b>Publish/Subscribe</b>): الخدمة بتعلن «حصل كذا» وتكمّل، واللي يهمه يسمع. الخدمات مش لازم تكون شغالة مع بعض، والعطل بيتحبس عند صاحبه. التمن: <b>Eventual Consistency</b> (النقاط بتظهر بعد ثواني)، وصعوبة تتبع اللي حصل، ومحتاج idempotency.</p>`,
      real: `
        <p>خدمة التحليلات (اللي محدش بيستنى نتيجتها) بقت بطيئة بعد migration. لأن الـ Trip API بينادي عليها sync، كل تطبيقات السواقين بقت تستنى ثانية ونص عشان تقفل الرحلة، وتحت الحمل الـ requests اتراكمت والـ API وقع. لو كانت event، التحليلات كانت هتتأخر شوية بس.</p>
        <p>بس الفواتير مختلفة: لو العميل لازم يشوف الفاتورة قبل ما يقفل التطبيق، ده رد مطلوب في نفس اللحظة، والـ sync منطقي.</p>`,
      try: 'سيبها sync واختار «Analytics بطيئة»: الـ p95 بتاع الـ Trip API بيقفز لأكتر من ثانية. «Analytics واقعة»: كل request بيفشل بعد timeout 2 ثانية، والـ requests بتتراكم جوه الـ API. بدّل لـ Events بنفس الأعطال: الـ API بيرد في 20 ms دايمًا، والـ backlog بيكبر عند الخدمة الواقعة بس. رجّعها «مفيش» وشوف الـ backlog بيخلص.',
      also: 'تأكيد طلب في e-commerce (المخزن والشحن والإيميل events، والدفع sync)، ورسالة في شات (الحفظ sync، والـ push notification event)، وتسجيل لاعب في لعبة (achievements وanalytics events).',
      net: `
<pre><span class="c">// Sync: كل dependency في مسار الـ request</span>
await billing.ChargeAsync(trip, ct);
await notifications.SendAsync(trip, ct);
await analytics.TrackAsync(trip, ct);          <span class="c">// لو بطيئة: الكل بطيء</span>

<span class="c">// Events: احفظ الرحلة والـ event في نفس الـ transaction (Transactional Outbox)</span>
db.Trips.Update(trip);
await publishEndpoint.Publish(new TripCompleted(trip.Id, trip.DriverId, trip.Fare), ct);   <span class="c">// MassTransit EF outbox</span>
await db.SaveChangesAsync(ct);                 <span class="c">// الاتنين مع بعض أو مفيش</span>

builder.Services.AddMassTransit(x =&gt; x.AddEntityFrameworkOutbox&lt;TripsDb&gt;(o =&gt; { o.UseSqlServer(); o.UseBusOutbox(); }));</pre>`,
      netTitle: 'في .NET',
      deep: [
        '<b>الـ Outbox ليه؟</b> لو حفظت الرحلة وبعدين نشرت الـ event ووقعت في النص، يا الرحلة اتحفظت من غير event، يا العكس. الـ outbox بيكتب الـ event في جدول بنفس الـ transaction، وprocess تاني ينشره (at-least-once، فالـ subscribers لازم idempotent).',
        '<b>Events مش حل لكل حاجة:</b> لو المستخدم محتاج النتيجة دلوقتي (السعر النهائي، هل الدفع نجح)، الـ event بيحوّل مشكلة بسيطة لـ polling أو push معقد. استخدم sync للي في مسار المستخدم فعلًا، وevents للباقي.',
        '<b>الـ sync ممكن يتحسن:</b> نادي الخدمات بالتوازي (<code>Task.WhenAll</code>) بدل ورا بعض، وحط timeouts قصيرة و<a href="#/system-design/resilience">circuit breaker</a>، والـ calls الاختيارية خليها fire-and-forget على طابور. بس الـ availability بيفضل حاصل ضرب.',
        '<b>Debugging:</b> في الـ events، «ليه النقاط مش ظاهرة؟» محتاج تتبع event عبر كذا طابور. لازم correlation id في كل رسالة وdistributed tracing. شوف <a href="#/system-design/observability">Observability</a>.',
        '<b>تبسيطات:</b> الـ sync calls ورا بعض، والـ timeout ثابت 2 ثانية، وكل subscriber بيعالج رسالة واحدة في المرة، والـ publish بياخد 20 ms ثابت.'
      ]
    })
  });
})();
