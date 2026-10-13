/* DSA · Hash Table و Collisions
   A real chained hash table built the way .NET's Dictionary<TKey,TValue> is:
     buckets[]  (prime size) hold 1-based indexes into entries[]; entries chain through `next`
     insert     hash → bucket = hash % size → walk the chain (duplicate check) → new entry becomes the chain head
     resize     when count == size: new size = smallest prime in .NET's table ≥ 2 × count, every entry rehashed
   Keys are VehicleIds (long): long.GetHashCode() = (int)v ^ (int)(v >> 32), i.e. the id itself for small ids.
   The "bad hash" option is a classic bug: a key type whose GetHashCode only uses RegionId (4 values).
   Every probe counted below is a chain entry actually visited. */
(function () {
  "use strict";
  const { clamp, lerp, fmt, f1 } = Lab.util;
  const { box, tx, dot, arrow, line, alpha } = Lab.draw;

  const PRIMES = [3, 7, 11, 17, 23, 29, 37, 47, 59, 71, 89, 107, 131, 163, 197];   // System.Collections.HashHelpers
  const nextPrime = min => PRIMES.find(p => p >= min) || PRIMES[PRIMES.length - 1];
  const MAXKEYS = 60, STEP = 0.24, REHASH = 1.4, FIXED = 13;

  function hashOf(s, e) { return s.p.hash === 'bad' ? e.region : e.id; }

  function fresh(s) {
    const st = s.st, size = s.p.grow === 'fixed' ? FIXED : 3;
    st.size = size; st.buckets = new Int32Array(size); st.entries = []; st.resizes = 0;
    st.probes = []; st.op = null; st.ids = new Set();
  }

  /* run one real operation and record its steps; the structure is updated when the animation reaches the end */
  function plan(s) {
    const st = s.st, rnd = s.rng;
    const lookup = st.entries.length > 4 && rnd() < 0.4;
    let e;
    if (lookup) e = st.entries[Math.floor(rnd() * st.entries.length)];
    else { let id; do id = 10000 + Math.floor(rnd() * 89999); while (st.ids.has(id)); e = { id, region: 1 + Math.floor(rnd() * 4) }; }
    const h = hashOf(s, e) >>> 0;
    const op = { kind: lookup ? 'get' : 'ins', e, h, t0: s.t, steps: [] };
    if (!lookup && st.entries.length === st.size && s.p.grow === 'auto') {
      op.steps.push({ t: 'resize', to: nextPrime(2 * st.entries.length), d: REHASH });
    }
    const size = op.steps.length ? op.steps[0].to : st.size;
    const b = h % size;
    op.b = b;
    op.steps.push({ t: 'hash', d: STEP * 1.6 });
    // walk the chain as it will be at that moment (after a resize the chains are rebuilt)
    const chain = chainOf(st, b, size);
    let found = -1;
    for (const ix of chain) { op.steps.push({ t: 'cmp', ix, d: STEP }); if (st.entries[ix].id === e.id) { found = ix; break; } }
    op.steps.push({ t: lookup ? 'found' : 'link', ix: found, d: STEP * 2 });
    op.probes = chain.indexOf(found) + 1 || chain.length;
    op.chainLen = chain.length;
    let acc = 0; for (const x of op.steps) { x.at = acc; acc += x.d; }
    op.dur = acc + 0.5;
    return op;
  }
  /** entry indexes in bucket b, head first, for a table of `size` buckets (rebuilt like a rehash would) */
  function chainOf(st, b, size) {
    if (size === st.size) { const out = []; for (let i = st.buckets[b] - 1; i >= 0; i = st.entries[i].next) out.push(i); return out; }
    const heads = rehashInto(st, size);
    const out = []; for (let i = heads.buckets[b] - 1; i >= 0; i = heads.next[i]) out.push(i);
    return out;
  }
  function rehashInto(st, size) {
    const buckets = new Int32Array(size), next = new Int32Array(st.entries.length);
    st.entries.forEach((en, i) => { const b = en.h % size; next[i] = buckets[b] - 1; buckets[b] = i + 1; });
    return { buckets, next };
  }
  function commit(s, op) {
    const st = s.st;
    if (op.steps[0].t === 'resize') {
      const r = rehashInto(st, op.steps[0].to);
      st.size = op.steps[0].to; st.buckets = r.buckets; st.entries.forEach((en, i) => { en.next = r.next[i]; }); st.resizes++;
    }
    if (op.kind === 'ins') {
      const i = st.entries.length, b = op.h % st.size;
      st.entries.push({ ...op.e, h: op.h, next: st.buckets[b] - 1 });
      st.buckets[b] = i + 1; st.ids.add(op.e.id);
    } else { st.probes.push(op.probes); if (st.probes.length > 40) st.probes.shift(); }
  }

  Lab.registerSim('hash', {
    height: 380, warm: 0,

    init(s) { s.st = {}; fresh(s); },
    onParam(s) { fresh(s); },

    step(s) {
      const st = s.st;
      if (!st.op) { if (st.entries.length >= MAXKEYS) fresh(s); st.op = plan(s); }
      const op = st.op, e = s.t - op.t0;
      op.cur = null; for (const x of op.steps) if (e >= x.at) op.cur = x;
      if (e >= op.dur) { commit(s, op); st.last = op; st.op = null; }
    },

    chains(s) {
      const st = s.st, out = [];
      for (let b = 0; b < st.size; b++) { const c = []; for (let i = st.buckets[b] - 1; i >= 0; i = st.entries[i].next) c.push(i); out.push(c); }
      return out;
    },

    draw(s) {
      const C = s.C, st = s.st, op = st.op, W = s.w, H = s.h, n = s.narrow;
      const x0 = 14, x1 = W - 14, cw = (x1 - x0) / st.size;
      const resizing = op && op.cur && op.cur.t === 'resize';
      const by = 104, bh = 22;

      /* the hash pipeline for the current operation */
      if (op) {
        const kind = op.kind === 'ins' ? 'Add' : 'TryGetValue';
        const key = s.p.hash === 'bad' ? `(${op.e.id}, region ${op.e.region})` : String(op.e.id);
        tx(`${kind}(${key})`, x0, 16, { m: 1, s: n ? 10 : 12, w: 700, a: 'left', c: C.accent });
        const hs = s.p.hash === 'bad' ? `GetHashCode() = RegionId = ${op.h}` : `GetHashCode() = ${op.h}`;
        const size = op.steps[0].t === 'resize' ? op.steps[0].to : st.size;
        tx(`${hs}   →   ${op.h} % ${size} = bucket ${op.b}`, x0, 36, { m: 1, s: n ? 9 : 11, a: 'left', c: C.ink });
        if (resizing) tx(`count (${st.entries.length}) = buckets (${st.size}) → resize to ${op.steps[0].to} (next prime ≥ 2×) and rehash every entry`, x0, 56, { m: 1, s: n ? 8.5 : 10.5, w: 700, a: 'left', c: C.bad });
      }
      tx(`buckets[${st.size}]  ·  count ${st.entries.length}  ·  load ${f1(st.entries.length / st.size)}`, x1, 76, { m: 1, s: n ? 9 : 10.5, a: 'right', c: C.muted });

      /* bucket array */
      const hot = op && op.cur && !resizing ? op.b : -1;
      for (let b = 0; b < st.size; b++) {
        const x = x0 + b * cw;
        box(x + 0.5, by, cw - 1, bh, { r: 3, fill: b === hot ? C.violet : C.surface, stroke: C.violet });
        if (cw > 16) tx(b, x + cw / 2, by + bh / 2, { m: 1, s: 9, w: 600, c: b === hot ? C.surface : C.violet });
      }
      if (op && hot >= 0 && op.cur.t !== 'hash') alpha(0.6, () => arrow(x0 + 120, 44, x0 + hot * cw + cw / 2, by - 3, C.violet, 1.3));
      if (op && op.cur && op.cur.t === 'hash') { const k = (s.t - op.t0 - op.cur.at) / op.cur.d; alpha(0.8, () => arrow(x0 + 120, 44, lerp(x0 + 120, x0 + op.b * cw + cw / 2, k), lerp(44, by - 3, k), C.accent, 1.5)); }

      /* chains hanging under each bucket (head first) */
      const chains = this.chains(s), maxLen = Math.max(1, ...chains.map(c => c.length));
      const cy0 = by + bh + 8, eh = clamp((H - cy0 - 8) / maxLen - 3, 5, 20), ew = Math.max(3, cw - 4);
      const cmpIx = op && op.cur && op.cur.t === 'cmp' ? op.cur.ix : -1;
      const foundIx = op && op.cur && op.cur.t === 'found' ? op.cur.ix : -1;
      chains.forEach((c, b) => {
        const x = x0 + b * cw + 2;
        c.forEach((ix, j) => {
          const y = cy0 + j * (eh + 3);
          const en = st.entries[ix], isCmp = ix === cmpIx, isFound = ix === foundIx;
          const fill = isCmp ? C.accent : isFound ? C.a2 : resizing ? C.bg : C.surface;
          const stroke = c.length > 3 ? C.bad : isFound ? C.a2 : C.a2;
          box(x, y, ew, eh, { r: 2, fill, stroke });
          if (ew > 34 && eh > 13) tx(en.id, x + ew / 2, y + eh / 2, { m: 1, s: 9, w: 600, c: isCmp ? C.surface : C.ink });
          if (j > 0 && eh > 8) line(x + ew / 2, y - 3, x + ew / 2, y, C.violet, 1);
        });
      });
      // the new entry arriving as the head of its chain
      if (op && op.kind === 'ins' && op.cur && op.cur.t === 'link') {
        const k = clamp((s.t - op.t0 - op.cur.at) / op.cur.d, 0, 1);
        const x = x0 + op.b * cw + 2;
        box(x, lerp(40, cy0 - eh - 4, k), ew, eh, { r: 2, fill: C.accent, stroke: C.accent });
      }
    },

    stats(s) {
      const st = s.st, chains = this.chains(s), longest = Math.max(0, ...chains.map(c => c.length));
      const used = chains.filter(c => c.length).length;
      const avgP = st.probes.length ? st.probes.reduce((a, b) => a + b, 0) / st.probes.length : 0;
      return [
        ['Count / Buckets', `${st.entries.length} / ${st.size}`],
        ['Load factor', f1(st.entries.length / st.size), st.entries.length / st.size > 1.5 ? 'bad' : ''],
        ['أطول chain', String(longest), longest > 4 ? 'bad' : longest > 2 ? 'warn' : 'good'],
        ['Buckets فيها داتا', `${used} / ${st.size}`, used < st.size / 3 && st.entries.length > st.size ? 'bad' : ''],
        ['متوسط المقارنات في البحث', avgP ? f1(avgP) : '—', avgP > 3 ? 'bad' : avgP > 1.6 ? 'warn' : 'good'],
        ['Resize لحد دلوقتي', String(st.resizes)]
      ];
    }
  });

  Lab.registerLesson({
    id: 'hash', lab: 'dsa', title: 'Hash Table و Collisions',
    html: Lab.tpl.lesson({
      sim: 'hash', level: 2,
      terms: ['Hash Table', 'GetHashCode', 'Bucket', 'Collision', 'Load Factor'],
      lede: 'جدول hash حقيقي متبني زي <code>Dictionary</code> في .NET. كل VehicleId بيتحسبله hash، والـ hash % عدد الـ buckets بيحدد مكانه. الأعمدة اللي تحت كل bucket هي الـ chain: المفاتيح اللي وقعت في نفس المكان (collision).',
      aria: 'محاكاة hash table بالـ buckets والـ chains والـ resize',
      controls: [
        { type: 'seg', p: 'hash', label: 'الـ GetHashCode', value: 'good', opts: [['good', 'VehicleId (كويس)'], ['bad', 'RegionId بس (غلط)']] },
        { type: 'seg', p: 'grow', label: 'عدد الـ buckets', value: 'auto', opts: [['auto', 'بيكبر زي Dictionary'], ['fixed', 'ثابت 13']] }
      ],
      idea: `
        <p>الـ <b>Hash Table</b> بتحوّل المفتاح لرقم (<b>hash</b>) وبعدين <code>hash % size</code> يدّيك رقم <b>bucket</b> مباشرة، من غير بحث. عشان كده <code>O(1)</code> في المتوسط.</p>
        <p>لما مفتاحين يقعوا في نفس الـ bucket ده <b>collision</b>، وبيتحطوا في <b>chain</b> (قايمة) تحت الـ bucket، والبحث بيمشي عليها ويقارن واحد واحد. الـ <b>Load Factor</b> = عدد العناصر ÷ عدد الـ buckets. .NET بيكبّر الجدول لما العناصر توصل لعدد الـ buckets، فالـ chains بتفضل قصيرة.</p>`,
      real: `
        <p>كاش آخر موقع لكل عربية: <code>Dictionary&lt;long, GpsPoint&gt;</code> فيه 10,000 مفتاح، وكل رسالة GPS (1,000 في الثانية) بتعمل lookup و update. مع hash كويس كل lookup مقارنة أو اتنين. لو حد عمل key type بـ <code>GetHashCode</code> بيرجّع <code>RegionId</code> بس، الـ 10,000 عربية هيقعوا في 4 buckets، وكل lookup هيقارن آلاف المفاتيح: الـ Dictionary بقى <code>List</code> بطيئة.</p>`,
      try: 'سيبها شوية على «VehicleId» وشوف الـ resize: الـ buckets بتقفز 3 ← 7 ← 17 ← 37 ← 89 وكل المفاتيح بتتوزع من جديد. بعدين اختار «RegionId بس»: كل المفاتيح في 4 buckets بس والـ chains بتطول مهما كبر الجدول. وجرّب «ثابت 13» مع الـ hash الكويس: التوزيع حلو بس الـ load factor بيعلى والـ chains بتطول.',
      also: 'الـ session store، وكاش الأسعار في التداول، وجدول الـ routing في load balancer، والـ <code>GROUP BY</code> و Hash Join في قاعدة البيانات نفسها.',
      net: `
<pre><span class="c">// الـ key type لازم يعرّف Equals و GetHashCode مع بعض، ويستخدم نفس الحقول</span>
public readonly record struct VehicleKey(long VehicleId, int RegionId);
<span class="c">// record struct بيولّد GetHashCode من كل الحقول تلقائيًا</span>

<span class="c">// الغلطة: hash من حقل واحد قيمه قليلة</span>
public override int GetHashCode() =&gt; RegionId;            <span class="c">// ❌ كل العربيات في 4 buckets</span>
public override int GetHashCode() =&gt; HashCode.Combine(VehicleId, RegionId);  <span class="c">// ✓</span>

<span class="c">// لو عارف العدد: خصّص الحجم مرة واحدة ووفّر كل الـ resizes</span>
var last = new Dictionary&lt;long, GpsPoint&gt;(capacity: 10_000);
last[p.VehicleId] = p;                        <span class="c">// O(1) في المتوسط</span>
if (last.TryGetValue(id, out var point)) { }</pre>`,
      netTitle: 'في .NET',
      deep: [
        '<b>.NET Dictionary من جوه:</b> مفيش node objects. فيه array <code>buckets</code> (int) و array <code>entries</code> (struct فيها hashCode و next و key و value). الـ chain هي indexes جوه نفس الـ array، فمفيش allocation لكل عنصر وده أسرع بكتير من chaining بـ linked list.',
        '<b>ليه prime؟</b> الـ <code>%</code> على عدد prime بيوزّع المفاتيح اللي بينها نمط (كلها مضاعفات 10 مثلًا) أحسن من عدد زي 16. فيه hash tables تانية بتستخدم power of 2 مع خلط للـ bits (bit mixing) بدل الـ prime عشان <code>&amp;</code> أسرع من <code>%</code>. .NET على 64-bit بيستخدم FastMod عشان يقرّب السرعة.',
        '<b>Hash flooding:</b> لو مهاجم يقدر يختار المفاتيح (مثلًا strings في JSON request) ويعرف دالة الـ hash، يقدر يحطهم كلهم في bucket واحد ويحوّل كل request لـ O(n²). عشان كده <code>string.GetHashCode()</code> في .NET (Core) عشوائي لكل process (Marvin). متخزنش hash الـ string في قاعدة بيانات ولا تبعته لـ process تاني.',
        '<b>مفتاح بيتغير = ضاع:</b> لو غيّرت حقل داخل في الـ hash بعد ما المفتاح اتحط في الـ Dictionary، هيفضل في الـ bucket القديم ومش هتلاقيه تاني. المفاتيح لازم تبقى immutable (record struct أو readonly).',
        '<b>تبسيطات:</b> الـ resize هنا بيحصل لما count = buckets زي .NET، وبيختار من نفس جدول الـ primes. .NET بيستخدم نفس الـ entries array ويعيد بناء الـ chains بس من غير ما يعيد حساب الـ hash (بيكون متخزن في الـ entry)، وده اللي بيحصل هنا كمان.'
      ]
    })
  });
})();
