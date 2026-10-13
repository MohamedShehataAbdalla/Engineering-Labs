/* Networking · TCP Framing
   A device writes GPS messages to a TCP stream. TCP delivers bytes, not messages: one ReadAsync can return half a
   message, or the end of one plus two more. The network's chunking here is random, like a busy cellular link with
   Nagle/coalescing ("messy"), or one read per write like localhost at low load ("clean").
   The receiver really parses the bytes it gets, three ways:
     one read = one message   treats every read as a full message (works on localhost, breaks in production)
     delimiter (\n)           appends reads to a buffer and cuts at each newline
     length prefix            each message starts with a 2-byte big-endian length; cut exactly that many bytes
   A message counts as OK only if the parsed bytes equal a message that was sent. */
(function () {
  "use strict";
  const { clamp, lerp, fmt, f1 } = Lab.util;
  const { box, tx, line, alpha } = Lab.draw;

  const MSG_EVERY = 0.45, READ_EVERY = 0.3, KEEP = 14;
  const enc = new TextEncoder(), dec = new TextDecoder();

  function fresh(s) {
    s.st = { id: 0, wire: [], buf: [], sent: new Set(), sentList: [], reads: [], parsed: [], ok: 0, bad: 0, readsN: 0, readBytes: 0, nextMsg: s.t + 0.1, nextRead: s.t + 0.3, colorOf: [] };
  }
  function makeMsg(s, id) {
    const lat = (30 + s.rng()).toFixed(5), lng = (31 + s.rng()).toFixed(5), sp = Math.floor(s.rng() * 120);
    const text = `$GPS,${3500 + (id % 40)},${lat},${lng},${sp}`;
    return text;
  }

  Lab.registerSim('framing', {
    height: 380, warm: 3,
    init(s) { fresh(s); },
    onParam(s) { fresh(s); },

    step(s) {
      const st = s.st, t = s.t, mode = s.p.rx;
      while (t >= st.nextMsg) {
        const id = st.id++, text = makeMsg(s, id);
        st.sent.add(text); st.sentList.push(text); if (st.sentList.length > 200) st.sent.delete(st.sentList.shift());
        let bytes;
        if (mode === 'length') { const body = enc.encode(text); bytes = [body.length >> 8, body.length & 255, ...body]; }
        else bytes = [...enc.encode(text + '\n')];
        // remember which message every byte belongs to (for colouring)
        for (const b of bytes) st.wire.push({ b, m: id });
        st.nextMsg += MSG_EVERY * (0.6 + s.rng() * 0.8);
      }
      if (t >= st.nextRead && st.wire.length) {
        let n;
        if (s.p.net === 'clean') {
          // one read returns exactly one written message
          const first = st.wire[0].m; n = 0; while (n < st.wire.length && st.wire[n].m === first) n++;
        } else n = Math.min(st.wire.length, 4 + Math.floor(s.rng() * 130));
        const chunk = st.wire.splice(0, n);
        st.readsN++; st.readBytes += n;
        st.reads.push(chunk); if (st.reads.length > KEEP) st.reads.shift();
        this.consume(s, chunk.map(x => x.b));
        // a busy reader sometimes comes back late and finds several messages waiting
        st.nextRead = t + (s.p.net === 'clean' ? READ_EVERY : 0.15 + s.rng() * 0.95);
      }
    },

    consume(s, bytes) {
      const st = s.st, mode = s.p.rx;
      const emit = (txt) => { const ok = st.sent.has(txt); if (ok) st.ok++; else st.bad++; st.parsed.push({ txt, ok }); if (st.parsed.length > 6) st.parsed.shift(); };
      if (mode === 'naive') { emit(dec.decode(new Uint8Array(bytes)).replace(/\n$/, '')); return; }
      st.buf.push(...bytes);
      if (mode === 'delim') {
        let i;
        while ((i = st.buf.indexOf(10)) >= 0) { const line = st.buf.splice(0, i + 1); emit(dec.decode(new Uint8Array(line.slice(0, -1)))); }
      } else {
        while (st.buf.length >= 2) {
          const len = (st.buf[0] << 8) | st.buf[1];
          if (st.buf.length < 2 + len) break;
          const msg = st.buf.splice(0, 2 + len).slice(2);
          emit(dec.decode(new Uint8Array(msg)));
        }
      }
    },

    draw(s) {
      const C = s.C, st = s.st, W = s.w, H = s.h, n = s.narrow;
      const x0 = 14, x1 = W - 14;
      const msgCol = m => m % 2 ? C.violet : C.accent;
      tx('what each ReadAsync returned (colour = which message the byte came from):', x0, 16, { m: 1, s: n ? 8.5 : 10.5, w: 700, a: 'left', c: C.muted });
      const rh = Math.min(18, (H * 0.5) / KEEP), bw = Math.max(1.2, (x1 - x0 - 50) / 80);
      st.reads.forEach((chunk, i) => {
        const y = 28 + i * rh;
        tx(`${chunk.length}B`, x0, y + rh / 2, { m: 1, s: 8, a: 'left', c: C.muted });
        chunk.forEach((c, j) => box(x0 + 40 + j * bw, y + 2, Math.max(1, bw - 0.4), rh - 5, { r: 0, fill: msgCol(c.m), stroke: null }));
        // where messages start inside this read
        chunk.forEach((c, j) => { if (j > 0 && chunk[j - 1].m !== c.m) line(x0 + 40 + j * bw, y, x0 + 40 + j * bw, y + rh - 1, C.ink, 1.6); });
      });
      // parsed result
      const py = 28 + KEEP * rh + 18;
      tx(`parsed messages (${s.p.rx === 'naive' ? 'one read = one message' : s.p.rx === 'delim' ? 'split at \\n' : '2-byte length prefix'}):`, x0, py, { m: 1, s: n ? 8.5 : 10.5, w: 700, a: 'left', c: C.muted });
      st.parsed.forEach((p, i) => {
        const y = py + 16 + i * 17, txt = p.txt.replace(/\n/g, '⏎');
        tx((p.ok ? '✓ ' : '✗ ') + (txt.length > (n ? 34 : 70) ? txt.slice(0, n ? 34 : 70) + '…' : txt), x0, y, { m: 1, s: n ? 8 : 10, w: p.ok ? 500 : 700, a: 'left', c: p.ok ? C.a2 : C.bad });
      });
    },

    stats(s) {
      const st = s.st, tot = st.ok + st.bad;
      return [
        ['رسايل اتبعتت', fmt(st.id)],
        ['اتقرت صح', fmt(st.ok), 'good'],
        ['اتقرت غلط (مقطوعة أو لازقة)', fmt(st.bad), st.bad ? 'bad' : 'good'],
        ['دقة الـ parser', tot ? f1(st.ok / tot * 100) + ' %' : '—', st.bad ? 'bad' : 'good'],
        ['متوسط bytes لكل read', st.readsN ? f1(st.readBytes / st.readsN) : '—']
      ];
    }
  });

  Lab.registerLesson({
    id: 'framing', lab: 'networking', title: 'TCP Framing',
    html: Lab.tpl.lesson({
      sim: 'framing', level: 2,
      terms: ['Byte Stream', 'Framing', 'Delimiter', 'Length Prefix', 'Partial Read'],
      lede: 'الجهاز بيكتب رسايل GPS على TCP، وكل صف هو اللي <code>ReadAsync</code> رجّعه مرة واحدة. اللونين بيفرّقوا بين رسالة والتانية، والخط الغامق مكان بداية رسالة جديدة جوه نفس الـ read. تحت: اللي الـ parser طلّعه فعلًا.',
      aria: 'محاكاة TCP stream بيتقسم عشوائي و parsers بطرق framing مختلفة',
      controls: [
        { type: 'seg', p: 'rx', label: 'الـ receiver', value: 'naive', opts: [['naive', 'كل read = رسالة'], ['delim', 'Delimiter (\\n)'], ['length', 'Length prefix']] },
        { type: 'seg', p: 'net', label: 'الشبكة', value: 'messy', opts: [['messy', 'حقيقية (تقطيع ولزق)'], ['clean', 'localhost (كل write = read)']] }
      ],
      idea: `
        <p>TCP <b>Byte Stream</b>: بيضمن إن الـ bytes توصل كلها وبالترتيب، بس <b>مش</b> بيحافظ على حدود الرسايل. كتبت رسالتين 40 byte؟ ممكن تقراهم في read واحد 80، أو 3 reads 10 و50 و20 (<b>Partial Read</b>). التقطيع بيعتمد على الـ MSS، والـ buffers، وNagle، والشبكة.</p>
        <p>عشان كده البروتوكول اللي فوق TCP لازم يعمل <b>Framing</b>: يقول الرسالة بتخلص فين. أشهر طريقتين: <b>Delimiter</b> (حرف معين في الآخر زي سطر جديد، وده يصلح للنصوص) أو <b>Length Prefix</b> (أول كام byte فيهم طول الرسالة، وده الأحسن للـ binary).</p>`,
      real: `
        <p>سيرفر GPS اتكتب واتجرّب على localhost: كل read رسالة، كله تمام. في الإنتاج على شبكة موبايل: نص الرسايل بيتقري نصين أو لازق في اللي بعده، والـ parser بيرمي exceptions أو أسوأ: بيقرا خط عرض من رسالة وخط طول من رسالة تانية، والعربية تظهر في البحر.</p>`,
      try: 'سيبها على «كل read = رسالة» مع شبكة «localhost»: كله صح. غيّر الشبكة لـ «حقيقية»: الدقة بتقع جدًا والرسايل بتطلع مقطوعة أو لازقة. اختار Delimiter: كله صح تاني مهما كان التقطيع. وLength prefix: نفس الشيء، ومش محتاج يدوّر على حرف.',
      also: 'HTTP/1.1 (Content-Length أو chunked)، وWebSocket frames، وgRPC (length prefix 4 bytes)، وRedis protocol (\\r\\n)، وأي بروتوكول أجهزة IoT بتصمّمه بنفسك.',
      net: `
<pre><span class="c">// ❌ بيفترض إن الـ read رسالة كاملة</span>
int n = await stream.ReadAsync(buf, ct);
var msg = Encoding.ASCII.GetString(buf, 0, n);

<span class="c">// ✓ System.IO.Pipelines: buffer وتقطيع عند \\n من غير نسخ كتير</span>
var reader = PipeReader.Create(stream);
while (true) {
    var result = await reader.ReadAsync(ct);
    var buffer = result.Buffer;
    while (buffer.PositionOf((byte)'\\n') is SequencePosition nl) {
        HandleLine(buffer.Slice(0, nl));
        buffer = buffer.Slice(buffer.GetPosition(1, nl));
    }
    reader.AdvanceTo(buffer.Start, buffer.End);         <span class="c">// الباقي (رسالة ناقصة) يستنى الـ read الجاي</span>
    if (result.IsCompleted) break;
}

<span class="c">// ✓ length prefix: اقرا بالظبط</span>
await stream.ReadExactlyAsync(header, ct);              <span class="c">// .NET 7+</span>
var len = BinaryPrimitives.ReadUInt16BigEndian(header);
await stream.ReadExactlyAsync(body.AsMemory(0, len), ct);</pre>`,
      netTitle: 'في .NET',
      deep: [
        '<b>UDP مختلف:</b> UDP بيحافظ على حدود الـ datagram: كل receive = datagram كامل أو مفيش. بس مفيش ترتيب ولا ضمان وصول. TCP العكس بالظبط.',
        '<b>Delimiter داخل الداتا:</b> لو الرسالة نفسها ممكن تحتوي على الـ delimiter (binary، أو نص فيه سطر جديد) لازم escaping. عشان كده الـ binary protocols بتستخدم length prefix.',
        '<b>حد أقصى للطول:</b> length prefix مكتوب فيه 4 GB من جهاز بايظ أو مهاجم = البرنامج هيحجز ذاكرة ضخمة أو يستنى للأبد. تحقّق من الطول قبل ما تحجز، واقفل الـ connection لو مش منطقي.',
        '<b>Nagle و NoDelay:</b> Nagle بيجمع الـ writes الصغيرة في packet واحد لحد ما ACK يرجع، فرسايل صغيرة كتير بتتأخر وتلزق في بعض. <code>NoDelay = true</code> بيقفله للتطبيقات التفاعلية، بس الـ framing لسه لازم: التقطيع ممكن يحصل في أي مكان تاني على الطريق.',
        '<b>تبسيطات:</b> الـ reads بتجيب من 4 لـ 133 byte عشوائي في وضع «حقيقية». الحقيقي بيعتمد على الـ MSS وتوقيت الـ ACKs والـ buffer sizes، بس النتيجة نفسها: الحدود مش مضمونة.'
      ]
    })
  });
})();
