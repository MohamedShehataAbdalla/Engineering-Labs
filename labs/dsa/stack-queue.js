/* DSA · Stack و Queue
   The same stream of GPS messages (Poisson arrivals) is pushed into two real buffers at the same instants:
     Queue<T>  circular array: head/tail indices that wrap, grows 2× (copying from head) when full → FIFO
     Stack<T>  array + count: push and pop at the top                                              → LIFO
   Each buffer has its own worker with the same fixed service time. Wait times are measured per message
   (dequeue time − arrival time), so the averages and the starvation of old messages under LIFO come out of the
   run, not from a formula. */
(function () {
  "use strict";
  const { clamp, lerp, fmt, f1, expo } = Lab.util;
  const { box, tx, dot, ring, arrow, hatch, alpha } = Lab.draw;

  const WIN = 60;   // seconds of completed messages kept for the stats

  function mkQueue() { return { kind: 'queue', arr: new Array(8).fill(null), head: 0, tail: 0, count: 0, grows: 0 }; }
  function mkStack() { return { kind: 'stack', arr: new Array(8).fill(null), count: 0, grows: 0 }; }

  function push(b, m) {
    if (b.count === b.arr.length) {                       // full → new array 2×, copy (queue: unwrap from head)
      const na = new Array(b.arr.length * 2).fill(null);
      for (let i = 0; i < b.count; i++) na[i] = b.kind === 'queue' ? b.arr[(b.head + i) % b.arr.length] : b.arr[i];
      b.arr = na; b.grows++;
      if (b.kind === 'queue') { b.head = 0; b.tail = b.count; }
    }
    if (b.kind === 'queue') { b.arr[b.tail] = m; b.tail = (b.tail + 1) % b.arr.length; }
    else b.arr[b.count] = m;
    b.count++;
  }
  function pop(b) {
    if (!b.count) return null;
    let m;
    if (b.kind === 'queue') { m = b.arr[b.head]; b.arr[b.head] = null; b.head = (b.head + 1) % b.arr.length; }
    else { m = b.arr[b.count - 1]; b.arr[b.count - 1] = null; }
    b.count--;
    return m;
  }
  function oldest(b, t) { let o = 0; for (const m of b.arr) if (m) o = Math.max(o, t - m.t); return o; }

  function mkSide(b) { return { b, cur: null, curEnd: 0, waits: [], served: 0, out: [] }; }

  Lab.registerSim('stack-queue', {
    height: 330, warm: 20,

    init(s) {
      s.st = { next: 0, id: 0, sides: [mkSide(mkQueue()), mkSide(mkStack())] };
      s.st.next = expo(s.p.lambda, s.rng);
    },

    step(s, dt) {
      const st = s.st, t = s.t, svc = 1 / s.p.mu;
      while (st.next <= t) {
        const m = { id: ++st.id, t: st.next };
        for (const sd of st.sides) push(sd.b, { ...m });
        st.next += expo(s.p.lambda, s.rng);
      }
      for (const sd of st.sides) {
        if (sd.cur && t >= sd.curEnd) { sd.out.push({ m: sd.cur, t0: t }); sd.cur = null; }
        if (!sd.cur && sd.b.count) {
          const m = pop(sd.b);
          m.wait = t - m.t; sd.waits.push([t, m.wait]); sd.served++;
          sd.cur = m; sd.curEnd = t + svc;
        }
        while (sd.waits.length && sd.waits[0][0] < t - WIN) sd.waits.shift();
        sd.out = sd.out.filter(o => t - o.t0 < 0.6);
      }
    },

    sideStats(sd, t) {
      const w = sd.waits.map(x => x[1]);
      const avg = w.length ? w.reduce((a, b) => a + b, 0) / w.length : 0;
      const max = w.length ? Math.max(...w) : 0;
      const sorted = w.slice().sort((a, b) => a - b), p95 = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0;
      return { avg, max, p95, old: oldest(sd.b, t) };
    },

    draw(s) {
      const C = s.C, st = s.st, t = s.t, W = s.w, n = s.narrow;
      const x0 = 14, x1 = W - 14, wkW = n ? 54 : 84, arrX0 = x0 + (n ? 0 : 92), arrX1 = x1 - wkW - 26;
      const rho = s.p.lambda / s.p.mu;
      tx(`arrivals ${f1(s.p.lambda)}/s  ·  worker ${f1(s.p.mu)}/s  ·  load ${Math.round(rho * 100)}%`, x0, 16, { m: 1, s: n ? 9.5 : 11.5, w: 600, a: 'left', c: rho >= 1 ? C.bad : rho > 0.85 ? C.accent : C.muted });
      const ageCol = a => a < 2 ? C.a2 : a < 6 ? C.accent : C.bad;

      st.sides.forEach((sd, k) => {
        const b = sd.b, top = 42 + k * 142, y = top + (n ? 30 : 26), ch = 36;
        const title = b.kind === 'queue' ? 'Queue<T>  FIFO: first in, first out' : 'Stack<T>  LIFO: last in, first out';
        tx(title, x0, top, { m: 1, s: n ? 10 : 12, w: 700, a: 'left', c: b.kind === 'queue' ? C.a2 : C.violet });
        if (!n) tx(`array[${b.arr.length}]`, x0, y + ch / 2, { m: 1, s: 10, a: 'left', c: C.muted });
        const cap = b.arr.length, cw = (arrX1 - arrX0) / cap;
        if (cap > 64) {                       // overloaded: the array is too long to draw cell by cell
          box(arrX0, y, arrX1 - arrX0, ch, { r: 4, fill: C.bg, stroke: C.bad });
          box(arrX0, y, (arrX1 - arrX0) * b.count / cap, ch, { r: 4, fill: C.bad, stroke: null });
          tx(`${fmt(b.count)} waiting in array[${fmt(cap)}]: it only grows`, (arrX0 + arrX1) / 2, y + ch / 2, { m: 1, s: 10.5, w: 700, c: C.ink });
        }
        for (let i = 0; i < (cap > 64 ? 0 : cap); i++) {
          const x = arrX0 + i * cw, m = b.arr[i];
          if (!m) { box(x + 1, y, cw - 2, ch, { r: 4, fill: C.bg, stroke: C.line }); hatch(x + 1, y, cw - 2, ch, C.line); continue; }
          const a = t - m.t, c = ageCol(a);
          box(x + 1, y, cw - 2, ch, { r: 4, fill: C.surface, stroke: c, lw: 1.6 });
          if (cw > 26) tx(a < 10 ? f1(a) : Math.round(a), x + cw / 2, y + ch / 2, { m: 1, s: cw > 34 ? 11 : 9, w: 700, c });
        }
        // index markers: where the next pop/push happens
        const mark = (i, label, c, below) => {
          const x = arrX0 + (i + 0.5) * cw, yy = below ? y + ch + 12 : y - 9;
          tx(label, x, yy, { m: 1, s: 9.5, w: 700, c });
        };
        if (cap > 64) { /* no markers */ } else if (b.kind === 'queue') { mark(b.head, b.count ? '▲ head (pop)' : 'head', C.a2, true); mark(b.tail, 'tail (push) ▼', C.accent, false); }
        else if (cap <= 64) { mark(Math.max(0, b.count - 1), 'top: push & pop ▼', C.violet, false); }

        // worker
        const wx = x1 - wkW, wy = y - 4;
        box(wx, wy, wkW, ch + 8, { r: 8, fill: C.surface, stroke: sd.cur ? C.accent : C.line });
        tx('worker', wx + wkW / 2, wy - 8, { m: 1, s: 9.5, c: C.muted });
        if (sd.cur) {
          const k2 = 1 - (sd.curEnd - t) * s.p.mu;
          ring(wx + 16, wy + (ch + 8) / 2, 9, k2, C.accent, 3);
          if (wkW > 60) tx(`waited ${f1(sd.cur.wait !== undefined ? sd.cur.wait : 0)}`, wx + wkW - 6, wy + (ch + 8) / 2, { m: 1, s: 9, a: 'right', c: C.muted });
        }
        alpha(0.5, () => arrow(arrX1 + 4, y + ch / 2, wx - 4, y + ch / 2, C.line, 1.2));
        for (const o of sd.out) { const k3 = (t - o.t0) / 0.6; alpha(1 - k3, () => dot(wx + wkW / 2 + k3 * 20, wy - k3 * 10, 4, C.a2)); }

        const ss = this.sideStats(sd, t);
        const line2 = `waiting ${b.count}  ·  avg wait ${f1(ss.avg)}s  ·  max ${f1(ss.max)}s  ·  oldest now ${f1(ss.old)}s`;
        tx(line2, x0, y + ch + (n ? 40 : 34), { m: 1, s: n ? 8.5 : 10.5, w: 600, a: 'left', c: ss.old > 10 ? C.bad : C.muted });
      });
    },

    stats(s) {
      const [q, k] = s.st.sides.map(sd => this.sideStats(sd, s.t));
      const bad = v => v > 10 ? 'bad' : v > 4 ? 'warn' : 'good';
      return [
        ['Queue: متوسط الانتظار', f1(q.avg) + ' s', bad(q.avg)],
        ['Stack: متوسط الانتظار', f1(k.avg) + ' s', bad(k.avg)],
        ['Queue: أطول انتظار (آخر دقيقة)', f1(q.max) + ' s', bad(q.max)],
        ['Stack: أطول انتظار (آخر دقيقة)', f1(k.max) + ' s', bad(k.max)],
        ['Queue / Stack: p95', `${f1(q.p95)} / ${f1(k.p95)} s`],
        ['أقدم رسالة مستنية (Q / S)', `${f1(q.old)} / ${f1(k.old)} s`, k.old > 10 ? 'bad' : '']
      ];
    }
  });

  Lab.registerLesson({
    id: 'stack-queue', lab: 'dsa', title: 'Stack و Queue',
    html: Lab.tpl.lesson({
      sim: 'stack-queue', level: 1,
      terms: ['Stack', 'Queue', 'LIFO', 'FIFO', 'Circular Buffer'],
      lede: 'نفس الرسايل بالظبط بتوصل في نفس اللحظات لـ buffer-ين: <code>Queue</code> فوق و<code>Stack</code> تحت، وكل واحد عنده worker بنفس السرعة. الرقم جوه كل خانة هو عمر الرسالة بالثواني، واللون بيحمر كل ما تقدم.',
      aria: 'محاكاة رسايل داخلة على Queue و Stack بنفس المعدل',
      controls: [
        { type: 'range', p: 'lambda', label: 'الرسايل الداخلة', min: 1, max: 6, step: 0.2, value: 3.6, unit: '/s' },
        { type: 'range', p: 'mu', label: 'سرعة الـ worker', min: 1, max: 6, step: 0.2, value: 4, unit: '/s' }
      ],
      idea: `
        <p><b>Queue</b> (طابور): أول واحد دخل هو أول واحد يخرج، <b>FIFO</b>. بتضيف من ورا (<code>Enqueue</code>) وبتسحب من قدّام (<code>Dequeue</code>). في .NET هي array دايرية (<b>circular buffer</b>): الـ head والـ tail بيلفّوا لأول الـ array، فمفيش عناصر بتتزق.</p>
        <p><b>Stack</b> (كومة أطباق): آخر واحد دخل هو أول واحد يخرج، <b>LIFO</b>. الإضافة والسحب من فوق بس (<code>Push</code> و<code>Pop</code>). الاتنين <code>O(1)</code> لكل عملية، والفرق كله في <b>مين</b> بيخرج.</p>`,
      real: `
        <p>رسايل الـ GPS لازم تتعالج بالترتيب. لو استخدمت Stack، والحمل عالي (الـ worker بالعافية ملاحق)، الرسايل الجديدة بتتخدم على طول والقديمة بتتدفن تحت. المتوسط ممكن يبان كويس، بس فيه نقط بتستنى دقايق، وخريطة العربية بترجع لورا لما النقطة القديمة توصل متأخر.</p>
        <p>الـ Stack ليه مكانه الصح: الـ call stack نفسه، و Undo في محرر المسارات، والـ DFS، وتقييم المعادلات.</p>`,
      try: 'سيب الحمل 90%: متوسط الـ Stack يبان أحسن من الـ Queue، بس بص على «أقدم رسالة مستنية»: فيه رسايل مدفونة في قاع الـ Stack بقالها دقيقة، والمتوسط مش شايفها لأنها لسه مخرجتش. بعدين نزّل الرسايل لـ 2/s: الفرق بيختفي لأن الـ buffer فاضي أغلب الوقت. وارفعها فوق سرعة الـ worker: الاتنين بيكبروا (الـ array بتتضاعف) لحد ما الطابور يبقى لانهائي.',
      also: 'طابور طلبات الدفع، وطابور الـ jobs في أي background worker، والرسايل في شات (لازم تتعرض بالترتيب). الـ Stack: زرار Back في المتصفح وفي التطبيقات.',
      net: `
<pre><span class="c">// Queue&lt;T&gt;: circular array، Enqueue/Dequeue O(1)</span>
var inbox = new Queue&lt;GpsMessage&gt;();
inbox.Enqueue(msg);
if (inbox.TryDequeue(out var next)) Process(next);

<span class="c">// Stack&lt;T&gt;: array + count، Push/Pop O(1)</span>
var undo = new Stack&lt;RouteEdit&gt;();
undo.Push(edit);
var last = undo.Pop();

<span class="c">// بين threads: ConcurrentQueue أو Channel (bounded = backpressure)</span>
var ch = Channel.CreateBounded&lt;GpsMessage&gt;(10_000);
await ch.Writer.WriteAsync(msg);</pre>`,
      netTitle: 'في .NET',
      deep: [
        '<b>المتوسط بيكدب:</b> على المدى الطويل متوسط الانتظار في الاتنين واحد بالظبط: نفس الرسايل داخلة ونفس الـ worker، فمتوسط عدد الرسايل المستنية واحد (Little’s law). اللي بيفرق هو التوزيع: الـ FIFO بيوزّع الانتظار بالعدل، والـ LIFO بيخلّي أغلب الرسايل تعدّي بسرعة وقليل منها يستنى جدًا. وفي أي فترة قصيرة متوسط الـ Stack بيبان أحسن، لأن الرسايل اللي مستنية من بدري لسه ما اتحسبتش (survivorship). عشان كده راقب p99 و max وعمر أقدم رسالة، مش المتوسط.',
        '<b>الحمل قرب 100%:</b> لما معدل الدخول يقرب من سرعة الـ worker، طول الطابور والانتظار بيزيدوا بسرعة جدًا مش بشكل خطي (من نظرية الطوابير: الانتظار متناسب مع ρ/(1−ρ)). عند 90% الانتظار حوالي 10 أضعاف وقت الخدمة.',
        '<b>LIFO مقصود أحيانًا:</b> تحت ضغط شديد، بعض الأنظمة بتخدم الأحدث الأول عمدًا لأن الطلب القديم صاحبه غالبًا عمل timeout ومشي. و.NET ThreadPool نفسه: كل thread عنده local queue بيسحب منها LIFO (عشان الـ cache) والـ global queue FIFO.',
        '<b>الـ Queue في .NET بتكبر بس مبتصغرش:</b> لو حصل spike والطابور وصل مليون عنصر، الـ array بتفضل بالحجم ده. <code>TrimExcess()</code> بيصغّرها. وفي الإنتاج طابور من غير حد = memory leak مستني يحصل، عشان كده <code>Channel.CreateBounded</code>.',
        '<b>تبسيطات:</b> وقت الخدمة ثابت لكل رسالة، والوصول عشوائي (Poisson). الـ array بتبدأ 8 خانات للرسم؛ في .NET بتبدأ فاضية وأول إضافة بتعمل 4.'
      ]
    })
  });
})();
