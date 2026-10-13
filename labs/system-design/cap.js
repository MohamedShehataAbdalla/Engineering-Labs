/* System Design · CAP و Eventual Consistency
   Which driver is assigned to which vehicle (20 vehicles), stored in two data centres: Cairo (primary) and Frankfurt.
   Dispatchers on both sides read and write their local replica. The model keeps both stores and the link:
     CP   writes go to the primary and are replicated synchronously; while the link is cut, Frankfurt refuses writes
          and reads (it can't prove it has the latest value) — consistent, not available there
     AP   every write is accepted locally and replicated asynchronously (~300 ms lag); while the link is cut, changes
          queue up; on heal they are exchanged and conflicts are settled by last-write-wins (newer timestamp wins,
          the other write is silently lost) — available, but stale reads and lost writes
   A read is "stale" if it returns something other than the latest write acknowledged anywhere.
   Availability, stale reads, divergence and lost writes are counted from the run. */
(function () {
  "use strict";
  const { clamp, lerp, fmt, f1, expo } = Lab.util;
  const { box, tx, dot, line, alpha } = Lab.draw;

  const K = 20, LAG = 0.3, SIDES = ['Cairo', 'Frankfurt'];

  function fresh(s) {
    const mk = () => { const m = new Map(); for (let k = 0; k < K; k++) m.set(k, { v: 0, t: 0 }); return m; };
    s.st = { store: [mk(), mk()], latest: new Map([...Array(K).keys()].map(k => [k, { v: 0, t: 0 }])), cut: false, repl: [], wid: 0, next: s.t + 0.1,
      ok: [0, 0], fail: [0, 0], reads: 0, stale: 0, lost: 0, flash: [] };
  }
  function color(C, v) { return v === 0 ? C.bg : [C.accent, C.a2, C.violet, C.good][v % 4]; }

  Lab.registerSim('cap', {
    height: 380, warm: 1,
    init(s) { fresh(s); },
    onParam(s) { fresh(s); },
    act: {
      partition(s) {
        const st = s.st; st.cut = !st.cut;
        if (!st.cut) st.healAt = s.t;
        st.flash.push({ t: s.t, txt: st.cut ? 'network partition: the link between the data centres is down' : 'link restored: replicas exchange changes' });
      }
    },

    step(s) {
      const st = s.st, t = s.t, cp = s.p.mode === 'cp';
      // asynchronous replication (AP): deliver when due and the link is up
      st.repl = st.repl.filter(r => {
        if (st.cut || t < r.due) return true;
        const cur = st.store[r.to].get(r.k);
        if (r.val.t > cur.t) st.store[r.to].set(r.k, r.val);
        else if (r.val.v !== cur.v) st.lost++;          // a concurrent write that lost last-write-wins
        return false;
      });
      while (st.next <= t) {
        const side = s.rng() < 0.5 ? 0 : 1, k = Math.floor(s.rng() * K), write = s.rng() < 0.4;
        const blocked = cp && st.cut && side === 1;
        if (blocked) { st.fail[side]++; st.flash.push({ t, side, err: true }); }
        else if (write) {
          const val = { v: ++st.wid, t: st.next };
          st.store[side].set(k, val);
          if (cp) st.store[1 - side].set(k, val);       // synchronous: both replicas before the ack
          else st.repl.push({ to: 1 - side, k, val, due: t + LAG });
          st.latest.set(k, val); st.ok[side]++; st.flash.push({ t, side, k, w: true });
        } else {
          const got = st.store[side].get(k), want = st.latest.get(k);
          st.reads++; if (got.v !== want.v) st.stale++;
          st.ok[side]++; st.flash.push({ t, side, k, w: false, stale: got.v !== want.v });
        }
        st.next += expo(s.p.rate, s.rng);
      }
      st.flash = st.flash.filter(f => t - f.t < (f.txt ? 3 : 0.6));
    },

    draw(s) {
      const C = s.C, st = s.st, t = s.t, W = s.w, H = s.h, n = s.narrow, cp = s.p.mode === 'cp';
      const bw = n ? (W - 60) / 2 : (W - 120) / 2, bx = [14, W - 14 - bw], by = 50, bh = H - 120;
      st.store.forEach((m, i) => {
        const down = cp && st.cut && i === 1;
        box(bx[i], by, bw, bh, { r: 10, fill: down ? C.bg : C.surface, stroke: down ? C.bad : C.violet, lw: 2 });
        tx(`${SIDES[i]}${i === 0 && cp ? ' (primary)' : ''}`, bx[i] + bw / 2, by - 12, { m: 1, s: n ? 10 : 12, w: 700, c: down ? C.bad : C.violet });
        if (down) tx('refusing reads & writes', bx[i] + bw / 2, by + bh + 14, { m: 1, s: 9.5, w: 700, c: C.bad });
        const cols = 5, cw = (bw - 20) / cols, ch = (bh - 20) / 4;
        for (let k = 0; k < K; k++) {
          const val = m.get(k), x = bx[i] + 10 + (k % cols) * cw, y = by + 10 + Math.floor(k / cols) * ch;
          const diff = st.store[1 - i].get(k).v !== val.v;
          box(x + 2, y + 2, cw - 4, ch - 4, { r: 5, fill: color(C, val.v), stroke: diff ? C.bad : null, lw: 2 });
          if (cw > 40) tx(`V${k + 1}`, x + cw / 2, y + 12, { m: 1, s: 8, w: 700, c: val.v ? C.surface : C.muted });
          if (cw > 40 && val.v) tx(`#${val.v}`, x + cw / 2, y + ch / 2 + 4, { m: 1, s: 8, c: C.surface });
        }
      });
      // the link
      const lx0 = bx[0] + bw, lx1 = bx[1], ly = by + bh / 2;
      line(lx0, ly, lx1, ly, st.cut ? C.bad : C.a2, 2.5, st.cut ? [6, 5] : null);
      if (st.cut) tx('✕', (lx0 + lx1) / 2, ly, { m: 1, s: 16, w: 700, c: C.bad });
      if (!cp && st.repl.length) tx(`${st.repl.length} queued`, (lx0 + lx1) / 2, ly + 18, { m: 1, s: 8.5, c: C.muted });
      for (const f of st.flash) {
        if (f.txt) { tx(f.txt, W / 2, 16, { m: 1, s: n ? 8.5 : 10.5, w: 700, c: st.cut ? C.bad : C.good }); continue; }
        const x = f.side === 0 ? bx[0] + bw / 2 : bx[1] + bw / 2, k = (t - f.t) / 0.6;
        dot(x + (f.side ? 1 : -1) * 4, by + bh + 34 - k * 20, 3.5, f.err ? C.bad : f.stale ? C.bad : f.w ? C.accent : C.a2);
      }
      const div = [...Array(K).keys()].filter(k => st.store[0].get(k).v !== st.store[1].get(k).v).length;
      const avail = i => { const a = st.ok[i] + st.fail[i]; return a ? st.ok[i] / a : 1; };
      tx(`available: Cairo ${f1(avail(0) * 100)}% · Frankfurt ${f1(avail(1) * 100)}% · stale reads ${f1(st.reads ? st.stale / st.reads * 100 : 0)}% · replicas differ on ${div} · lost writes ${st.lost}`, 14, H - 12, { m: 1, s: n ? 7.5 : 10, w: 700, a: 'left', c: st.lost || st.stale ? C.bad : C.good });
    },

    stats(s) {
      const st = s.st, a = i => { const x = st.ok[i] + st.fail[i]; return x ? st.ok[i] / x : 1; };
      const div = [...Array(K).keys()].filter(k => st.store[0].get(k).v !== st.store[1].get(k).v).length;
      return [
        ['Availability فرانكفورت', f1(a(1) * 100) + ' %', a(1) < 0.99 ? 'bad' : 'good'],
        ['قرايات قديمة (stale)', f1(st.reads ? st.stale / st.reads * 100 : 0) + ' %', st.stale ? 'warn' : 'good'],
        ['Replicas مختلفين على', `${div} عربية`, div ? 'warn' : 'good'],
        ['Writes ضاعت (last-write-wins)', String(st.lost), st.lost ? 'bad' : 'good'],
        ['Requests اترفضت', String(st.fail[0] + st.fail[1]), st.fail[1] ? 'bad' : '']
      ];
    }
  });

  Lab.registerLesson({
    id: 'cap', lab: 'system-design', title: 'CAP و Eventual Consistency',
    html: Lab.tpl.lesson({
      sim: 'cap', level: 3,
      terms: ['CAP', 'Partition', 'Consistency', 'Availability', 'Eventual Consistency'],
      lede: 'مين السواق المعيّن على كل عربية، متخزن في data centerين. كل خانة عربية ولونها هو آخر write وصلها. المربع اللي إطاره أحمر معناه إن النسختين مختلفين. اضغط «Partition» عشان تقطع الوصلة بينهم، وقارن CP بـ AP.',
      aria: 'محاكاة replicas في data centerين مع partition و CP مقابل AP',
      acts: [['partition', 'Partition / Heal']],
      controls: [
        { type: 'seg', p: 'mode', label: 'الاختيار وقت الـ partition', value: 'ap', opts: [['cp', 'CP: اتسق وارفض'], ['ap', 'AP: اقبل وصالح بعدين']] },
        { type: 'range', p: 'rate', label: 'Requests في الثانية', min: 2, max: 30, step: 1, value: 10 }
      ],
      idea: `
        <p><b>CAP</b>: لما الشبكة تتقطع بين نسخ الداتا (<b>Partition</b>)، لازم تختار: يا ترفض الطلبات اللي مش متأكد إنها على آخر نسخة (<b>Consistency</b>)، يا ترد بأي حاجة عندك وتتقبل إن الداتا ممكن تبقى قديمة أو متعارضة (<b>Availability</b>). الـ partitions بتحصل في الحقيقة، فالسؤال الحقيقي هو ده.</p>
        <p>أنظمة AP غالبًا بتبقى <b>Eventually Consistent</b>: لو الكتابة وقفت، كل النسخ هتتفق في الآخر. بس «في الآخر» ده ممكن يكون بعد ثواني، ووقت الخلاف لازم قاعدة تحسم (زي last-write-wins: الأحدث يكسب والتاني يضيع).</p>`,
      real: `
        <p>الوصلة بين القاهرة وفرانكفورت وقعت 30 ثانية. مع CP: dispatchers فرانكفورت مش قادرين يعيّنوا ولا يشوفوا السواقين (التطبيق بيرجّع error). مع AP: الاتنين شغالين، بس dispatcher في القاهرة عيّن أحمد على عربية 7 وواحد في فرانكفورت عيّن محمود على نفس العربية. لما الوصلة رجعت، الأحدث كسب، والتاني فاكر إن التعيين بتاعه اتسجل.</p>`,
      try: 'سيبها على AP من غير partition: الـ stale قليل (lag 300 ms بس)، وأحيانًا write بيضيع لو اتنين عدّلوا نفس العربية في نفس الـ 300 ms. اضغط Partition واستنى 20 ثانية: الخانات بتختلف (إطار أحمر) والـ stale بيعلى. اضغط تاني (heal): بيتصالحوا، و«writes ضاعت» بتزيد. بدّل لـ CP وكرر: صفر stale وصفر ضياع، بس فرانكفورت بيرفض كل حاجة طول الـ partition.',
      also: 'سلة المشتريات (Amazon اختار AP: الأحسن تضيف حاجة للسلة وتتصالح بعدين)، والرصيد في البنك (CP: أحسن ترفض من إنك تصرف فلوس مش موجودة)، وعدد المقاعد في رحلة طيران.',
      net: `
<pre><span class="c">-- SQL Server Always On: synchronous commit = الـ commit بيستنى الـ replica (CP ناحية)</span>
ALTER AVAILABILITY GROUP FleetAG MODIFY REPLICA ON 'FRA-SQL'
  WITH (AVAILABILITY_MODE = SYNCHRONOUS_COMMIT);
<span class="c">-- asynchronous commit = أسرع وبيفضل شغال لو الـ replica بعيدة، بس ممكن تفقد آخر ثواني في الـ failover</span></pre>
<pre><span class="c">// AP: كل كتابة معاها version/timestamp عشان تقدر تحسم التعارض بعدين</span>
public record Assignment(long VehicleId, long DriverId, DateTimeOffset At, string Region);
<span class="c">// optimistic concurrency بدل last-write-wins الأعمى: الكتابة تفشل لو حد غيّر قبلك</span>
modelBuilder.Entity&lt;Assignment&gt;().Property&lt;byte[]&gt;("RowVersion").IsRowVersion();</pre>`,
      netTitle: 'في SQL Server و .NET',
      deep: [
        '<b>PACELC:</b> CAP بيتكلم عن وقت الـ partition بس. في الوقت العادي فيه trade-off تاني: Latency مقابل Consistency. الـ synchronous replication بين قارات بيضيف RTT (عشرات الملي ثواني) على كل write.',
        '<b>Last-write-wins خطر:</b> الساعات بين data centers مش متزامنة تمامًا، فـ «الأحدث» ممكن يكون غلط. وفيه بدائل: vector clocks، أو CRDTs (هياكل بتتدمج من غير تعارض)، أو إنك تسجّل التعارض ويقرر إنسان.',
        '<b>Quorums:</b> مع 3 نسخ أو أكتر، read/write quorums (W + R > N) بتدّيك consistency مع availability طالما الأغلبية متصلة. الأقلية المعزولة هي اللي بترفض.',
        '<b>Read your writes:</b> حتى في AP، المستخدم لازم يشوف التعديل اللي هو عمله. الحل البسيط: اقرا من نفس الـ replica اللي كتبت فيها لفترة بعد الكتابة.',
        '<b>تبسيطات:</b> نسختين بس، وCP هنا = primary في القاهرة وsynchronous replication بلا تأخير. الـ timestamps مضبوطة تمامًا (الحقيقي clock skew). 40% من الطلبات writes.'
      ]
    })
  });
})();
