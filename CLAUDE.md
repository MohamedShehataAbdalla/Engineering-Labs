# Engineering Labs — قواعد المشروع

سلسلة **معامل تعليمية تفاعلية بالعربي** بتشرح مفاهيم هندسة البرمجيات بمحاكاة متحركة.
كل معمل صفحة مستقلة، وكل تجربة جواها بتورّي الداتا وهي بتتحرك (packets، requests، threads، rows...)،
والمستخدم بيغيّر الأرقام ويشوف النظام بيتصرف إزاي لحظيًا.

- **الجمهور:** مهندسين برمجيات من كل المستويات (Junior → Senior). كل تجربة لازم تنفع المبتدئ وتدّي الـ Senior حاجة أعمق.
- **المجال:** أنظمة كبيرة وحساسة: **تتبع المركبات (التركيز الأساسي)**، منصات التوصيل، IoT، المدن الذكية، بوابات الدفع، البنوك، التداول، الاتصالات والفوترة، اللوجستيات، الشات والمراسلة، الألعاب الجماعية أونلاين، البث المباشر.
- خطة المعامل والتقدم: `ROADMAP.md`.

---

## القيود التقنية
- HTML + CSS + JavaScript عادي (Vanilla). **مفيش framework ومفيش build step.**
- يشتغل بفتح الملف مباشرة (`file://`) أو من أي static server، وبيتنشر على **GitHub Pages**.
- **classic `<script>` بس، ممنوع ES modules**، لأن الـ modules مبتشتغلش من `file://`. كل الكود المشترك متسجل تحت global واحد اسمه `Lab`.
- المحاكاة على `<canvas>` مع `requestAnimationFrame`. فيه loop واحد للصفحة كلها والمحرك هو اللي بيديره.
- مفيش مكتبات خارجية إلا لو في سبب قوي، وتكون نسخة pinned من CDN، ولازم تسأل الأول.
- الخطوط من Google Fonts: **Reem Kufi** للعناوين، **IBM Plex Sans Arabic** للنصوص، **JetBrains Mono** للأرقام والكود والمصطلحات الإنجليزي.
- الروابط كلها **نسبية** (`../../shared/...`) عشان تشتغل على GitHub Pages تحت أي sub-path.

## هيكل الملفات
```
index.html              ← الصفحة الرئيسية: خريطة المعامل وترتيب المذاكرة وحالة كل معمل
shared/
  theme.css             ← الـ tokens والخطوط والـ layout ومكوّنات الـ lab card
  helpers.js            ← Lab.draw (box, tx, dot, ring, arrow, hatch, page, cyl...) + Lab.Meter + Lab.rng
  engine.js             ← Lab.registerSim / Lab.boot: الـ loop والـ controls والأرقام الحيّة والـ theme
labs/
  databases/index.html + sims/*.js   ← ملف لكل تجربة
  os/ · networking/ · dsa/ · system-design/
```
ترتيب التحميل في صفحة المعمل: `helpers.js` ثم `engine.js` ثم `sims/*.js` ثم `<script>Lab.boot()</script>`.

---

## عقد التجربة (Sim contract)
```js
Lab.registerSim('btree', {
  init(s) {},            // يبني الحالة في s.st
  step(s, dt) {},        // تحديث المنطق. dt بالثواني (≤ 0.05)، والوقت الكلي في s.t
  draw(s) {},            // الرسم بـ Lab.draw.* — السياق متظبط على dpr
  stats(s) { return [[label, value, tone]] }, // tone: 'good' | 'warn' | 'bad' | ''
  onParam(s, key) {},    // اختياري: لما control يتغير
  act: { burst(s) {} },  // أزرار إضافية [data-act="burst"]
  warm: 2.5,             // ثواني تشتغل قبل أول رسم (0 للتجارب الـ stepped)
  stepped: false,        // true: caption + أزرار ◀ ▶ (لازم يوفّر stepCount(s) و s.st.i)
  height: 290            // ارتفاع الـ canvas (اختياري)
});
```

الـ object `s` اللي المحرك بيمرره:

| الحقل | المعنى |
|---|---|
| `s.st` | حالة التجربة، والتجربة هي اللي بتملكها |
| `s.p` | قيم الـ controls. الأرقام بتوصل numbers، و `"true"/"false"` بتوصل booleans |
| `s.t` | وقت المحاكاة بالثواني، وبيقف لما التجربة تقف |
| `s.w`, `s.h` | المقاس بالـ CSS px |
| `s.rng()` | random بـ seed ثابت، فالـ «إعادة» بتجيب نفس السيناريو. **ممنوع `Math.random` جوه sim.** |
| `s.setCap(html)` | تحديث الـ caption |
| `s.drop(x,y,tone)` | جسيم بيقع (بيانات ضاعت أو اتشالت) |
| `s.C` | الألوان المقروءة من CSS، وبتتحدث مع الـ theme |
| `s.narrow` | `true` لو العرض أقل من 520px |

### الـ HTML attributes اللي المحرك بيربطها لوحده
- `<article class="lab" data-sim="KEY">`: الـ card.
- `input[type=range][data-p="k"][data-unit="ms"]` و `<output data-out="k">`.
- `.seg[data-p="k"] > button[data-v][aria-pressed]`: الاختيارات. `data-v="true|false"` بتتحول boolean.
- `[data-act="toggle|reset|NAME"]`: `toggle` و `reset` جاهزين، وأي اسم تاني بيروح لـ `def.act[NAME]`.
- `<dl data-stats>`: الأرقام الحيّة، بتتحدث كل 300ms.
- `<p class="caption">`: للتجارب الـ stepped أو أي شرح لحظي.

### المحرك مسؤول عن
loop واحد، IntersectionObserver (التجربة المخفية متتحركش)، ResizeObserver + devicePixelRatio، الأرقام الحيّة كل 300ms، الـ theme (زرار + localStorage جوه try/catch)، `prefers-reduced-motion` (التجربة تبدأ واقفة بعد الـ warm)، وعزل الأخطاء (لو تجربة رمت exception بتقف هي لوحدها ويظهر عليها شريط خطأ).

---

## التصميم
- الصفحة كلها **RTL** و `lang="ar"`. بلوكات الكود والأرقام والمصطلحات **LTR** (`direction:ltr` + `unicode-bidi:isolate`).
- Light و Dark mode بالـ tokens بس. **ممنوع لون hardcoded** في CSS أو في sim:
  `--bg --surface --sunk --ink --muted --line --accent --accent-2 --violet --good --bad`

| اللون | المعنى (ثابت في كل المعامل) |
|---|---|
| `--accent` (برتقالي) | طلب أو packet رايح، أو صف جديد داخل |
| `--accent-2` (تركواز) | رد راجع أو شغل خلص |
| `--violet` | لاعب تالت: Thread تاني، Replica، Index |
| `--good` | نجاح سريع، Hit، Seek |
| `--bad` | فشل، رفض، بيانات ضاعت، Scan مكلف |

- **مفتاح الألوان** في أول كل صفحة معمل.
- لازم يشتغل على **400px من غير scroll أفقي** (الجداول الواسعة جوه `.gloss-wrap` اللي عليها `overflow-x:auto`).
- الحركة متبطّأة عشان العين تلحقها، والـ hero بيقول كده صراحة.

## شكل كل تجربة (lab card)
1. **العنوان** `.terms`: المصطلحات بالإنجليزي مفصولة بـ `/`، وجنبه **badge المستوى** (`أساسي` / `متوسط` / `متقدم`)، وتحته `.lede`: سطر عربي بيوصف المشهد.
2. **Canvas** جوه `.stage` ومعاه `.stage-bar` (إيقاف، إعادة، وأزرار الـ act).
3. **Controls**: كل control عليه اسمه وقيمته ووحدته.
4. **أرقام حيّة** `<dl data-stats>`: بتتقاس من حالة المحاكاة نفسها.
5. **الشرح** `.explain` في 3 أعمدة:
   - **الفكرة**: المفهوم ومعنى كل مصطلح، بلغة تنفع الـ Junior.
   - **مثال من الواقع**: من تتبع المركبات بالأساس، ومعاه `<p class="try">` («جرّب:» تغيّر إيه وتلاحظ إيه). ولو المفهوم بيظهر بقوة في مجال تاني، ضيف سطر `<p class="also">` («نفس الفكرة في:» دفع، شات، ألعاب...).
   - **في .NET**: كود حقيقي قصير (C#، EF Core، T-SQL، RabbitMQ).
6. **`<details class="deep">` «أعمق (للـ Senior)»**: تفاصيل internals، trade-offs، أرقام حقيقية، وأخطاء شائعة في الإنتاج. اختياري لكن مفضّل.

وفي آخر كل معمل:
- **قاموس سريع**: جدول بكل المصطلحات، وكل مصطلح بلينك للتجربة بتاعته.
- **روابط للمعامل المرتبطة** (مثال: Replication بتلمّح لـ System Design).

## أسلوب المحتوى
- **عامية مصرية بسيطة**، والمصطلحات التقنية بالإنجليزي جوه الكلام زي ما بنقولها في الشغل.
- جمل قصيرة ومباشرة، من غير حشو ولا مقدمات.
- الأرقام واقعية. السيناريو الثابت: **10,000 جهاز GPS بيبعتوا كل 10 ثواني = 1,000 رسالة/ثانية**، وجدول `GpsPoints(Id, VehicleId, Ts, Lat, Lng, Speed)` وجدول `Vehicles`.
- **صحة المعلومة أهم حاجة.** أي سلوك محدد لـ SQL Server أو .NET لازم يكون مؤكد. لو مش متأكد: اسأل صاحب المشروع، أو اكتب على الصفحة إنه تقريب. الأرقام المبسّطة في المحاكاة لازم تتوضح (footer أو ملاحظة).

## الجودة
- المحاكاة لازم تكون **صادقة**: السلوك اللي بيظهر ناتج فعلًا عن المنطق (B-tree حقيقي، lock manager حقيقي، طابور حقيقي)، مش أنيميشن متجهز مسبقًا. التجارب الـ stepped (Race Condition، Isolation Levels) مستثناة وبتتعلّم `stepped: true`.
- بعد كل تجربة لازم تفتحها في المتصفح وتتأكد من: console من غير errors، عرض 400px من غير scroll أفقي، dark mode، و reduced-motion.
- **commit بعد كل تجربة** برسالة بالشكل ده: `labs(databases): add pages-rows sim`. ممنوع `git push` (صاحب المشروع بيرفع بنفسه).
- علّم على التجربة في `ROADMAP.md` في نفس الـ commit.
