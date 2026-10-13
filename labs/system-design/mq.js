/* System Design · Message Queue و Backpressure
   "Trip completed" events go through a broker queue (RabbitMQ-style) to billing consumers. The model implements:
     prefetch      each consumer holds at most P unacknowledged messages
     ack           a message leaves the queue only when the consumer acks it after processing
     crash         the consumer's unacked messages are redelivered; if it had already charged the trip but not
                   acked yet, the redelivery charges it again — unless the consumer is idempotent (it records
                   processed message ids and skips repeats)
     poison        2% of messages always throw; they are retried, and after 3 attempts go to the dead-letter queue
                   (or, without a DLQ, are requeued forever and keep eating consumer time)
   Every second a burst may arrive. Depth, lag, duplicates and DLQ counts come from the run. */
(function () {
  "use strict";
  const { clamp, lerp, fmt, f1, expo, Meter } = Lab.util;
  const { box, tx, dot, ring, line, alpha } = Lab.draw;

  const SVC = 0.16, PREFETCH = 3, RESTART = 3, MAXTRY = 3;

  /** the side effect (charge the trip), with optional dedup by message id */
  function apply(s, m) {
    const st = s.st;
    if (s.p.idem && st.processed.has(m.id)) { st.deduped++; return; }
    st.processed.add(m.id);
    const n = (st.charged.get(m.id) || 0) + 1; st.charged.set(m.id, n);
    if (n > 1) st.dupCharges++;
  }

  function fresh(s) {
    s.st = { q: [], id: 0, next: s.t + 0.1, dlq: 0, charged: new Map(), processed: new Set(), dupCharges: 0, deduped: 0, retries: 0, done: new Meter(5), crashes: 0,
      cons: Array.from({ length: s.p.n }, () => ({ inflight: [], down: 0 })) };
  }

  Lab.registerSim('mq', {
    height: 380, warm: 6,
    init(s) { fresh(s); },
    onParam(s, k) {
      const st = s.st;
      if (k === 'n') { while (st.cons.length < s.p.n) st.cons.push({ inflight: [], down: 0 }); while (st.cons.length > s.p.n) { const c = st.cons.pop(); st.q.unshift(...c.inflight.map(f => f.m)); } }
    },
    act: {
      crash(s) {
        const st = s.st, c = st.cons.find(x => s.t >= x.down); if (!c) return;
        for (const f of c.inflight) {
          // processed already (side effect done) but the ack never reached the broker
          if ((s.t - f.start) / SVC > 0.6 && !f.m.poison) apply(s, f.m);
          f.m.redelivered = true; st.q.unshift(f.m);
        }
        c.inflight = []; c.down = s.t + RESTART; st.crashes++;
      }
    },

    step(s) {
      const st = s.st, t = s.t;
      const burst = (t % 12) < 2.5;
      while (st.next <= t) { st.q.push({ id: ++st.id, t: st.next, poison: s.rng() < 0.02, tries: 0 }); st.next += expo(s.p.rate * (burst ? 2.5 : 1), s.rng); }
      for (const c of st.cons) {
        if (t < c.down) continue;
        c.inflight = c.inflight.filter(f => {
          if (t < f.end) return true;
          if (f.m.poison) {
            f.m.tries++; st.retries++;
            if (f.m.tries >= MAXTRY && s.p.dlq) st.dlq++;
            else st.q.push(f.m);                          // nack + requeue
          } else { apply(s, f.m); st.done.add(t); }
          return false;
        });
        while (c.inflight.length < PREFETCH && st.q.length) { const m = st.q.shift(); c.inflight.push({ m, start: t, end: t + SVC * (0.7 + s.rng() * 0.6) * (c.inflight.length + 1) }); }
      }
      // processed-id set only needs recent ids
      if (st.processed.size > 5000) { const keep = [...st.processed].slice(-3000); st.processed = new Set(keep); }
    },

    draw(s) {
      const C = s.C, st = s.st, t = s.t, W = s.w, H = s.h, n = s.narrow;
      const burst = (t % 12) < 2.5, x0 = 14, x1 = W - 14;
      tx(burst ? 'burst: end of shift, trips closing together' : `trip events ${s.p.rate}/s`, x0, 16, { m: 1, s: n ? 9 : 11, w: 700, a: 'left', c: burst ? C.accent : C.muted });
      // producer → queue
      const qx = x0, qw = n ? W * 0.5 : W * 0.48, qy = 40, qh = 70;
      box(qx, qy, qw, qh, { r: 8, fill: C.bg, stroke: C.violet, lw: 1.6 });
      tx(`queue: ${fmt(st.q.length)} messages`, qx + 8, qy - 8, { m: 1, s: n ? 8.5 : 10, w: 700, a: 'left', c: C.violet });
      const per = Math.floor((qw - 10) / 7), max = per * 9;
      st.q.slice(0, max).forEach((m, i) => dot(qx + 6 + (i % per) * 7, qy + 6 + Math.floor(i / per) * 7, 2.6, m.poison ? C.bad : m.redelivered ? C.violet : t - m.t > 5 ? C.bad : C.accent));
      if (st.q.length > max) tx(`+${fmt(st.q.length - max)}`, qx + qw - 6, qy + qh - 8, { m: 1, s: 9, a: 'right', c: C.bad });
      const lag = st.q.length ? t - Math.min(...st.q.map(m => m.t)) : 0;
      tx(`oldest waiting: ${f1(lag)} s`, qx, qy + qh + 14, { m: 1, s: n ? 8.5 : 10, w: 700, a: 'left', c: lag > 5 ? C.bad : C.muted });
      // DLQ
      const dx = qx + qw + 16, dw = x1 - dx;
      box(dx, qy, dw, qh, { r: 8, fill: C.surface, stroke: s.p.dlq ? C.bad : C.line, dash: s.p.dlq ? null : [4, 4] });
      tx(s.p.dlq ? 'dead-letter queue' : 'no DLQ', dx + dw / 2, qy + 22, { m: 1, s: n ? 8.5 : 10, w: 700, c: s.p.dlq ? C.bad : C.muted });
      tx(s.p.dlq ? `${st.dlq} poison messages parked` : 'poison messages loop forever', dx + dw / 2, qy + 44, { m: 1, s: n ? 7.5 : 9, c: C.muted });
      // consumers
      const cy = qy + qh + 34, ch = Math.min(46, (H - cy - 40) / st.cons.length - 6);
      st.cons.forEach((c, i) => {
        const y = cy + i * (ch + 6), down = t < c.down;
        box(x0, y, x1 - x0, ch, { r: 8, fill: down ? C.bg : C.surface, stroke: down ? C.bad : C.a2 });
        tx(down ? `billing consumer ${i + 1}: crashed, restarting ${f1(c.down - t)} s` : `billing consumer ${i + 1} · prefetch ${PREFETCH}`, x0 + 10, y + ch / 2, { m: 1, s: n ? 8.5 : 10, w: 700, a: 'left', c: down ? C.bad : C.a2 });
        c.inflight.forEach((f, j) => {
          const k = clamp((t - f.start) / (f.end - f.start), 0, 1), x = x1 - 30 - j * 30;
          ring(x, y + ch / 2, 9, k, f.m.poison ? C.bad : f.m.redelivered ? C.violet : C.accent, 3);
        });
      });
      tx(`charged twice: ${st.dupCharges} · duplicates skipped: ${st.deduped} · wasted retries: ${st.retries}`, x0, H - 12, { m: 1, s: n ? 8 : 10.5, w: 700, a: 'left', c: st.dupCharges ? C.bad : C.good });
    },

    stats(s) {
      const st = s.st, lag = st.q.length ? s.t - Math.min(...st.q.map(m => m.t)) : 0;
      return [
        ['Messages في الطابور', fmt(st.q.length), st.q.length > 100 ? 'bad' : st.q.length > 20 ? 'warn' : 'good'],
        ['Lag (أقدم رسالة)', f1(lag) + ' s', lag > 5 ? 'bad' : lag > 2 ? 'warn' : 'good'],
        ['Throughput', f1(st.done.rate(s.t)) + ' /s'],
        ['رحلات اتحاسبت مرتين', fmt(st.dupCharges), st.dupCharges ? 'bad' : 'good'],
        ['Dead-letter / retries', `${st.dlq} / ${st.retries}`, !s.p.dlq && st.retries > 30 ? 'bad' : '']
      ];
    }
  });

  Lab.registerLesson({
    id: 'mq', lab: 'system-design', title: 'Message Queue و Backpressure',
    html: Lab.tpl.lesson({
      sim: 'mq', level: 3,
      terms: ['Message Queue', 'Ack', 'At-least-once', 'Idempotency', 'Dead-letter Queue'],
      lede: 'كل رحلة بتخلص بتنزل event في queue، وconsumers الـ billing بيسحبوا ويحاسبوا. كل consumer ماسك لحد 3 رسايل (الدواير). البنفسجي رسالة اتعادت بعد crash، والأحمر رسالة «سامة» بتفشل دايمًا. اعمل crash لـ consumer وشوف إيه اللي بيتحاسب مرتين.',
      aria: 'محاكاة message queue بـ ack و redelivery و dead-letter queue',
      acts: [['crash', 'Crash consumer']],
      controls: [
        { type: 'range', p: 'n', label: 'عدد الـ consumers', min: 1, max: 6, step: 1, value: 3 },
        { type: 'range', p: 'rate', label: 'Events في الثانية', min: 2, max: 30, step: 1, value: 8 },
        { type: 'seg', p: 'idem', label: 'الـ consumer idempotent', value: 'false', opts: [['false', 'لأ'], ['true', 'آه (dedup بالـ id)']] },
        { type: 'seg', p: 'dlq', label: 'Dead-letter queue', value: 'true', opts: [['true', 'آه'], ['false', 'لأ']] }
      ],
      idea: `
        <p>الـ <b>Message Queue</b> (RabbitMQ، Azure Service Bus، SQS) بتفصل اللي بينتج الشغل عن اللي بينفّذه: الـ producer بيرمي الرسالة ويمشي، والـ consumers يسحبوا بسرعتهم. لو حصل burst، الطابور بيمتص الفرق (backpressure على مستوى النظام).</p>
        <p>الرسالة مبتتشالش من الطابور غير لما الـ consumer يقول <b>Ack</b> (خلصت). لو وقع قبل الـ ack، الرسالة بترجع لـ consumer تاني. ده <b>At-least-once</b>: مفيش رسالة بتضيع، بس ممكن تتنفّذ مرتين. عشان كده الـ consumer لازم يكون <b>Idempotent</b> (تنفيذها مرتين = مرة). والرسالة اللي بتفشل دايمًا تروح <b>Dead-letter Queue</b> بعد كام محاولة بدل ما تلف للأبد.</p>`,
      real: `
        <p>consumer الـ billing بيحاسب العميل على الرحلة وبعدين يعمل ack. اتعمله restart (deploy) بعد ما خصم الفلوس وقبل الـ ack: الرسالة رجعت، consumer تاني خصم تاني. العميل اتحاسب مرتين على نفس الرحلة. الحل: سجل «الرحلة دي اتحاسبت» بنفس الـ transaction اللي بتخصم، وتجاهل أي تكرار.</p>`,
      try: 'اضغط «Crash consumer» كذا مرة وراقب «رحلات اتحاسبت مرتين». شغّل idempotent وكرر: الرقم بيقف، و«duplicates skipped» هي اللي بتزيد. بعدين قفّل الـ DLQ: الرسايل السامة بتلف للأبد وعدد الـ retries مبيوقفش. وقلّل الـ consumers لـ 1: طاقته أقل من معدل الـ events، فالطابور والـ lag بيكبروا من غير ما يقفوا. رجّعهم 3 أو 4: الـ bursts بتتمتص والـ lag بيرجع ثواني.',
      also: 'طلبات الدفع (لازم idempotency key)، وإرسال الإيميلات والـ SMS (التكرار مزعج)، ومعالجة الطلبات في e-commerce، وأي «event» بين microservices.',
      net: `
<pre><span class="c">// MassTransit (فوق RabbitMQ): retry، وبعدها الرسالة تروح billing_error (DLQ) أوتوماتيك</span>
x.AddConsumer&lt;TripCompletedConsumer&gt;();
x.UsingRabbitMq((ctx, cfg) =&gt; cfg.ReceiveEndpoint("billing", e =&gt; {
    e.PrefetchCount = 16;
    e.UseMessageRetry(r =&gt; r.Intervals(100, 500, 2000));
    e.ConfigureConsumer&lt;TripCompletedConsumer&gt;(ctx);
}));

public class TripCompletedConsumer(BillingDb db) : IConsumer&lt;TripCompleted&gt;
{
    public async Task Consume(ConsumeContext&lt;TripCompleted&gt; ctx)
    {
        var id = ctx.MessageId!.Value;
        <span class="c">// idempotency: سجل الـ id مع الخصم في نفس الـ transaction</span>
        if (await db.Processed.AnyAsync(p =&gt; p.MessageId == id)) return;
        await using var tx = await db.Database.BeginTransactionAsync();
        db.Charges.Add(new Charge(ctx.Message.TripId, ctx.Message.Amount));
        db.Processed.Add(new ProcessedMessage(id));
        await db.SaveChangesAsync();
        await tx.CommitAsync();
    }   <span class="c">// الـ ack بيتبعت بعد ما الـ method ترجع من غير exception</span>
}</pre>`,
      netTitle: 'في .NET',
      deep: [
        '<b>Exactly-once مش موجود (تقريبًا):</b> بين broker وقاعدة بيانات منفصلة مستحيل تضمن «مرة واحدة بالظبط» للـ side effects. الحل العملي: at-least-once + idempotency، أو outbox/inbox pattern بنفس الـ transaction.',
        '<b>الترتيب:</b> مع كذا consumer وredelivery، الرسايل ممكن تتنفّذ بترتيب مختلف («الرحلة اتلغت» قبل «الرحلة خلصت»). لو الترتيب مهم: partition بالـ key (رحلة واحدة دايمًا لنفس الـ consumer) أو versioning في الداتا.',
        '<b>Prefetch:</b> prefetch عالي = throughput أعلى بس الرسايل بتتحجز عند consumer واحد (ولو وقع كلها بتتعاد)، وتوزيع أسوأ لو الرسايل بتاخد أوقات مختلفة. prefetch = 1 أعدل وأبطأ.',
        '<b>Backpressure الحقيقي:</b> الطابور بيمتص الـ bursts، بس لو المعدل المتوسط أعلى من طاقة الـ consumers، الطابور هيكبر لحد ما الـ broker يقفل الـ producers (flow control) أو الديسك يتملي. راقب الـ lag مش عدد الرسايل بس.',
        '<b>تبسيطات:</b> crash بعد 60% من المعالجة بيعتبر الخصم حصل، والرسايل السامة 2%، وأوقات المعالجة ثابتة تقريبًا، ومفيش تأخير بين المحاولات.'
      ]
    })
  });
})();
