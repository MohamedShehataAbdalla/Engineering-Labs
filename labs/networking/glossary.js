/* Networking · قاموس المعمل — every term, linked to the lesson where you can see it move. No simulation. */
(function () {
  "use strict";

  const G = [
    ['layers', 'طبقات TCP/IP', [
      ['Encapsulation', 'كل طبقة بتلزق header قدام اللي جالها من فوق'],
      ['Header', 'معلومات الطبقة: عناوين، ports، أرقام تسلسل'],
      ['MTU', 'أكبر packet في الشبكة (عادةً 1500 byte)'],
      ['MSS', 'أكبر داتا في segment TCP واحد (1460 مع IPv4)'],
      ['IP fragmentation', 'IP بيقسم packet أكبر من الـ MTU؛ fragment يضيع = الكل يضيع']
    ]],
    ['handshake', '3-Way Handshake', [
      ['SYN / SYN-ACK / ACK', 'الاتفاق على فتح connection TCP: round trip كامل'],
      ['Sequence number', 'رقم أول byte في الـ segment؛ الـ ACK بيقول «استلمت لحد هنا»'],
      ['FIN', 'قفل الـ connection من ناحية واحدة'],
      ['RTO', 'الوقت اللي TCP بيستناه قبل ما يعيد إرسال packet'],
      ['Backlog', 'طابور الـ connections اللي خلصت handshake ومستنية Accept']
    ]],
    ['tcp-udp', 'TCP vs UDP', [
      ['TCP', 'stream موثوق ومترتب: تأكيد وإعادة إرسال'],
      ['UDP', 'datagrams مستقلة: من غير تأكيد ولا ترتيب'],
      ['Retransmission', 'إعادة إرسال packet ما اتأكدش استلامه'],
      ['Head-of-line blocking', 'packet ضايع بيوقف كل اللي بعده لحد ما يوصل']
    ]],
    ['socket', 'IP و Port و Socket', [
      ['IP address', 'عنوان الجهاز على الشبكة'],
      ['Port', 'رقم البرنامج جوه الجهاز (0-65535)'],
      ['Socket', 'طرف connection: الـ OS بيعرّفه بالـ 4-tuple'],
      ['4-tuple', 'IP و port المصدر + IP و port الهدف'],
      ['RST', 'رد فوري: مفيش حد بيسمع على الـ port ده']
    ]],
    ['nat', 'NAT', [
      ['NAT', 'ترجمة عناوين خاصة لعنوان عام واحد'],
      ['Private IP', 'عناوين زي 10.x و 192.168.x، متشافش من الإنترنت'],
      ['NAT mapping', 'public port ↔ جهاز داخلي، بيتعمل لما الجهاز يبعت'],
      ['Idle timeout', 'الـ NAT بيمسح الـ mapping لو مفيش traffic'],
      ['CGNAT', 'NAT عند شركة الاتصالات: آلاف المشتركين ورا IP واحد'],
      ['Keepalive', 'packet صغير دوري عشان الـ mapping والـ connection يفضلوا عايشين']
    ]],
    ['dns', 'DNS', [
      ['DNS', 'تحويل اسم لعنوان IP'],
      ['Recursive resolver', 'السيرفر اللي بيدوّر بالنيابة عنك وبيعمل cache'],
      ['Authoritative server', 'السيرفر اللي عنده الإجابة الحقيقية للـ domain'],
      ['TTL', 'مدة صلاحية الإجابة في الـ cache'],
      ['Negative caching', 'حتى «الاسم مش موجود» بيتعمله cache']
    ]],
    ['tls', 'TLS', [
      ['HTTPS', 'HTTP جوه TLS'],
      ['TLS handshake', 'الاتفاق على مفاتيح التشفير وإثبات هوية السيرفر'],
      ['Certificate', 'إثبات إن السيرفر هو اللي بيقول عليه، موقّع من جهة موثوقة'],
      ['TLS 1.3', 'handshake في round trip واحد بدل اتنين'],
      ['0-RTT', 'إرسال الـ request مع أول رسالة لو اتكلمتوا قبل كده (فيه خطر replay)'],
      ['QUIC / HTTP/3', 'transport فوق UDP بيدمج الـ handshakes']
    ]],
    ['keepalive', 'Keep-Alive', [
      ['Keep-Alive', 'الـ connection يفضل مفتوح للـ requests الجاية'],
      ['Connection pool', 'connections مفتوحة جاهزة بتتوزع عليها الـ requests'],
      ['HTTP/2 multiplexing', 'requests كتير في نفس الوقت على connection واحد'],
      ['Idle timeout', 'كل طرف بيقفل الـ connection الساكت بعد فترة']
    ]],
    ['websocket', 'WebSocket', [
      ['Polling', 'العميل يسأل كل فترة «فيه جديد؟»'],
      ['Long polling', 'السيرفر يمسك الـ request لحد ما يحصل جديد'],
      ['WebSocket', 'connection مفتوح والاتنين يبعتوا في أي وقت'],
      ['Server push', 'السيرفر هو اللي يبدأ يبعت'],
      ['SignalR', 'مكتبة .NET للـ real-time فوق WebSocket مع fallback']
    ]],
    ['bandwidth', 'Bandwidth و Latency', [
      ['Bandwidth', 'أقصى bytes ممكن تعدّي في الثانية'],
      ['Latency', 'الوقت اللي byte واحد بياخده عشان يوصل'],
      ['Throughput', 'اللي اتنقل فعلًا في الثانية'],
      ['BDP', 'Bandwidth × Delay: اللي لازم يكون «في الطريق» عشان الماسورة تتملي'],
      ['Congestion window', 'كمية الداتا اللي TCP بيبعتها قبل ما يستنى ACK'],
      ['Slow start', 'الـ window بيتضاعف كل RTT في الأول']
    ]],
    ['rtt', 'RTT و Jitter', [
      ['RTT', 'وقت الرحلة رايح جاي'],
      ['Jitter', 'التذبذب في الـ RTT من packet للتاني'],
      ['Tail latency', 'الـ p99: البطء النادر اللي بيظهر مع الحجم'],
      ['SRTT / RTTVAR', 'متوسط الـ RTT الناعم وتذبذبه في حسابات TCP'],
      ['Spurious timeout', 'timeout ضرب ورد كان جاي فعلًا']
    ]],
    ['framing', 'TCP Framing', [
      ['Byte stream', 'TCP بيوصّل bytes بالترتيب، من غير حدود رسايل'],
      ['Framing', 'تحديد الرسالة بتبدأ وبتخلص فين'],
      ['Delimiter', 'حرف بيعلّم نهاية الرسالة (زي \\n)'],
      ['Length prefix', 'أول bytes في الرسالة فيها طولها'],
      ['Partial read', 'read رجّع جزء من رسالة'],
      ['Nagle', 'تجميع الـ writes الصغيرة في packet واحد (NoDelay بيقفله)']
    ]]
  ];

  const esc = s => s.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const rows = G.map(([id, title, terms]) =>
    `<tr class="grp"><td colspan="3">${title}</td></tr>` +
    terms.map(([t, d]) => `<tr><td>${esc(t)}</td><td>${d}</td><td><a href="#/networking/${id}">${title}</a></td></tr>`).join('')
  ).join('');
  const count = G.reduce((a, g) => a + g[2].length, 0);

  Lab.registerLesson({
    id: 'glossary', lab: 'networking', title: 'قاموس المعمل',
    html: `
  <article class="lab">
    <div class="lab-head">
      <div class="lab-title"><h2 class="terms" tabindex="-1">Glossary</h2><span class="level l1">${count} مصطلح</span></div>
      <p class="lede">كل مصطلحات معمل الشبكات في مكان واحد. اضغط على اسم التجربة عشان تشوف المصطلح بيتحرك.</p>
    </div>
    <div class="gloss-wrap"><table>
      <thead><tr><th>المصطلح</th><th>المعنى</th><th>تشوفه فين</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="explain">
      <div><h4>بعد المعمل ده</h4><p>الـ <b>Latency</b> والـ <b>Timeouts</b> والـ <b>Keep-Alive</b> هيبقوا قرارات تصميم في System Design: CDN، و Load Balancer، و Retry و Circuit Breaker. والـ <b>Sockets</b> والـ <b>Ports</b> ليهم حدود اتكلمنا عنها في <a href="#/os/fd">File Descriptors</a>.</p></div>
      <div><h4>اختبر نفسك</h4><p>جهاز GPS بيبعت كل 30 ثانية بـ TCP على شبكة موبايل، والسيرفر ساعات مبيعرفش يبعتله أمر، وساعات النقط بتوصل متقطعة والـ parser بيرمي exception، وبعد ما غيّرتوا IP السيرفر الأجهزة فضلت ساعة مش بتوصل. إيه الأسباب التلاتة؟ (NAT timeout، TCP framing، DNS TTL أو IP متخزن في الجهاز)</p></div>
    </div>
  </article>`
  });
})();
