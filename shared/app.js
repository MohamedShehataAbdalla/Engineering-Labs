/* Engineering Labs — single-page app shell.
   Hash routes:  #/  ·  #/<lab>  ·  #/<lab>/<lesson>
   Works from file:// : no fetch, no ES modules. Lesson scripts are lazy-loaded with <script src> when their lab opens. */
(function (G) {
  "use strict";
  const Lab = G.Lab || (G.Lab = {});
  const CAT = Lab.CATALOG;
  const LEVELS = { 1: ['أساسي', 'l1'], 2: ['متوسط', 'l2'], 3: ['متقدم', 'l3'] };
  const DONE_KEY = 'labs-done';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------- registry ---------- */
  const LESSONS = {};               // "lab/id" → lesson
  Lab.registerLesson = function (lesson) {
    const k = lesson.lab + '/' + lesson.id;
    if (LESSONS[k]) console.warn(`[Lab] lesson "${k}" registered twice`);
    LESSONS[k] = lesson;
  };

  const labById = id => CAT.find(l => l.id === id);
  const built = lab => lab.lessons.filter(x => x.file);

  /* ---------- progress (localStorage, never trusted to exist) ---------- */
  let done = new Set();
  try { done = new Set(JSON.parse(localStorage.getItem(DONE_KEY) || '[]')); } catch (e) { done = new Set(); }
  function saveDone() { try { localStorage.setItem(DONE_KEY, JSON.stringify([...done])); } catch (e) { /* private mode: progress lasts this session only */ } }
  const isDone = (lab, id) => done.has(lab + '/' + id);
  function labProgress(lab) { const b = built(lab); return { done: b.filter(x => isDone(lab.id, x.id)).length, total: b.length, all: lab.lessons.length }; }

  /* ---------- lazy script loading ---------- */
  const loaded = {};                // src → Promise
  function loadScript(src) {
    if (!loaded[src]) loaded[src] = new Promise((res, rej) => {
      const el = document.createElement('script');
      el.src = src; el.async = false;
      el.onload = () => res(); el.onerror = () => { delete loaded[src]; rej(new Error('تعذّر تحميل ' + src)); };
      document.body.appendChild(el);
    });
    return loaded[src];
  }
  const loadLab = lab => Promise.all(built(lab).map(x => loadScript(x.file)));

  /* ---------- lesson template ---------- */
  function ctl(c) {
    if (c.type === 'seg') {
      return `<div class="ctl"><span>${c.label}</span><div class="seg" data-p="${c.p}">${c.opts.map(([v, l]) =>
        `<button type="button" data-v="${v}" aria-pressed="${String(v) === String(c.value)}">${l}</button>`).join('')}</div></div>`;
    }
    const map = c.map ? ` data-map="${esc(c.map.join('|'))}"` : '';
    return `<label class="ctl"><span class="row">${c.label}<output data-out="${c.p}"></output></span><input type="range" data-p="${c.p}" min="${c.min}" max="${c.max}" step="${c.step}" value="${c.value}"${c.unit ? ` data-unit="${c.unit}"` : ''}${c.fmt ? ` data-fmt="${c.fmt}"` : ''}${map}></label>`;
  }
  /** builds the standard lesson card (CLAUDE.md → "شكل كل تجربة") */
  Lab.tpl = {
    lesson(o) {
      const lv = LEVELS[o.level || 1];
      const terms = o.terms.map(esc).join(' <span class="sep">/</span> ');
      const acts = (o.acts || []).map(([a, l]) => `<button type="button" class="btn act" data-act="${a}">${l}</button>`).join('');
      const stage = o.sim ? `
    <div class="stage"><canvas aria-label="${esc(o.aria || o.lede)}"></canvas>
      <div class="stage-bar"><button type="button" class="btn" data-act="toggle">إيقاف</button><button type="button" class="btn" data-act="reset">إعادة</button>${acts}</div></div>` : '';
      return `
  <article class="lab"${o.sim ? ` data-sim="${o.sim}"` : ''}>
    <div class="lab-head">
      <div class="lab-title"><h2 class="terms" tabindex="-1">${terms}</h2><span class="level ${lv[1]}">${lv[0]}</span></div>
      <p class="lede">${o.lede}</p>
    </div>${stage}
    ${o.caption ? '<p class="caption" aria-live="polite"></p>' : ''}
    ${o.controls && o.controls.length ? `<div class="controls">${o.controls.map(ctl).join('')}</div>` : ''}
    ${o.sim && o.stats !== false ? '<dl class="stats" data-stats></dl>' : ''}
    <div class="explain">
      <div><h4>الفكرة</h4>${o.idea}</div>
      <div><h4>مثال من الواقع</h4>${o.real}${o.try ? `<p class="try">${o.try}</p>` : ''}${o.also ? `<p class="also">${o.also}</p>` : ''}</div>
      <div><h4>${o.netTitle || 'في .NET و SQL Server'}</h4>${o.net}</div>
    </div>
    ${o.deep && o.deep.length ? `<details class="deep"><summary>أعمق (للـ Senior)</summary><ul>${o.deep.map(d => `<li>${d}</li>`).join('')}</ul></details>` : ''}
  </article>`;
    }
  };

  /* ---------- routing ---------- */
  function parse() {
    const h = (location.hash || '').replace(/^#\/?/, '');
    const [lab, lesson] = h.split('/').filter(Boolean);
    return { lab: lab || null, lesson: lesson || null };
  }
  /** linear path through the whole curriculum: built lessons, or the lab page if a lab has none yet */
  function sequence() {
    const seq = [];
    for (const lab of CAT) {
      const b = built(lab);
      if (b.length) b.forEach(x => seq.push({ lab, lesson: x, href: `#/${lab.id}/${x.id}`, label: x.title }));
      else seq.push({ lab, lesson: null, href: `#/${lab.id}`, label: `معمل ${lab.title}` });
    }
    return seq;
  }

  const main = () => document.getElementById('main');
  let renderToken = 0;

  async function route() {
    const token = ++renderToken;
    Lab.engine.unmount();
    closeDrawer();
    const r = parse();
    const lab = r.lab && labById(r.lab);
    if (lab) expanded[lab.id] = true;      // entering a lab opens its group; the user can still collapse it
    let view;
    try {
      if (!r.lab) view = viewHome();
      else if (!lab) view = viewMissing();
      else if (!r.lesson) view = viewLab(lab);
      else {
        const meta = lab.lessons.find(x => x.id === r.lesson);
        if (!meta) view = viewMissing();
        else if (!meta.file) view = viewSoon(lab, meta);
        else {
          main().innerHTML = '<p class="loading">بيحمّل التجربة…</p>';
          await loadLab(lab);
          if (token !== renderToken) return;     // user navigated again while loading
          view = viewLesson(lab, meta);
        }
      }
    } catch (e) {
      console.error(e);
      view = { title: 'خطأ', crumbs: [], html: `<section class="hero"><h1 tabindex="-1">حصلت مشكلة</h1><p>${esc(e.message)}</p><p><a href="#/">ارجع للرئيسية</a></p></section>` };
    }
    if (token !== renderToken) return;
    const m = main();
    m.innerHTML = view.html;
    document.title = view.title ? `${view.title} · Engineering Labs` : 'Engineering Labs';
    renderCrumbs(view.crumbs || []);
    renderSidebar(r);
    if (view.after) view.after(m);
    Lab.engine.mount(m);
    G.scrollTo(0, 0);
    const h = m.querySelector('h1, h2.terms');
    if (h && routedOnce) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    routedOnce = true;
  }
  let routedOnce = false;

  /* ---------- views ---------- */
  function viewHome() {
    const tiles = CAT.map(lab => {
      const p = labProgress(lab);
      const status = p.total ? `<span class="status ${p.total === p.all ? 'live' : 'wip'}">${p.total} من ${p.all} تجربة جاهزة${p.done ? ` · خلّصت ${p.done}` : ''}</span>
        <div class="progress" aria-hidden="true"><i style="width:${Math.round(p.done / p.all * 100)}%"></i></div>` : '<span class="status soon">قريبًا</span>';
      return `<a class="lab-tile" href="#/${lab.id}">
        <span class="num">${lab.num}</span>
        <h3>${lab.title}<span class="en">${lab.en}</span></h3>
        <p>${lab.blurb}</p>${status}</a>`;
    }).join('');
    return {
      title: '', crumbs: [], html: `
<section class="hero">
  <h1 tabindex="-1">معامل هندسة البرمجيات: شوف <span class="en">the system</span> وهو بيشتغل</h1>
  <p>كل مفهوم هنا ليه تجربة حيّة. الـ rows والـ packets والـ threads بتتحرك قدامك، وأنت بتغيّر الأرقام وتشوف النظام بيتصرف إزاي. الأمثلة كلها من أنظمة حقيقية بحمل حقيقي، وأغلبها من <b>تتبع المركبات</b>: 10,000 جهاز GPS، كل جهاز بيبعت موقعه كل 10 ثواني.</p>
  <p class="note">المعامل معمولة لكل المستويات. «الفكرة» و«جرّب» للي لسه بيبدأ، و«أعمق (للـ Senior)» فيها internals وأرقام إنتاج وأخطاء شائعة.</p>
</section>
<section class="chapter">
  <div class="chapter-head"><h2>خريطة المعامل</h2><p>الترتيب ده هو ترتيب المذاكرة المقترح</p></div>
  <div class="labs-grid">${tiles}</div>
</section>
<section class="chapter">
  <div class="chapter-head"><h2>إزاي تستفيد من كل تجربة</h2></div>
  <div class="explain" style="border-top:0">
    <div><h4>1. اتفرج الأول</h4><p>سيب التجربة تشتغل بالأرقام الافتراضية واقرا «الفكرة». الألوان معناها ثابت في كل المعامل: البرتقالي رايح، والتركواز راجع أو خلص، والأحمر فشل أو ضاع.</p></div>
    <div><h4>2. اكسرها</h4><p>نفّذ سطر «جرّب:» وراقب الأرقام الحيّة. الأرقام دي محسوبة من المحاكاة نفسها، مش مكتوبة ثابتة. زرار «إعادة» بيرجّع نفس السيناريو بالظبط، فتقدر تقارن قبل وبعد.</p></div>
    <div><h4>3. اربطها بالكود</h4><p>عمود «في .NET» فيه الكود اللي بيعمل نفس السلوك في الإنتاج. و«أعمق» فيها اللي بيفرق بين حد عارف المصطلح وحد فاهم بيحصل إيه تحته. ولما تخلّص تجربة علّم عليها «خلّصتها».</p></div>
  </div>
  <p class="note" style="margin-top:18px">نفس المفاهيم بتتكرر في منصات التوصيل، والـ IoT والمدن الذكية، وبوابات الدفع والبنوك والتداول، والاتصالات والفوترة، واللوجستيات، والشات، والألعاب الجماعية، والبث المباشر.</p>
</section>
<footer class="page-foot">الحركة في كل المعامل متبطّأة عشان العين تلحقها. في الإنتاج الأزمنة بالـ ms والأعداد بالآلاف، لكن السلوك هو هو.</footer>`
    };
  }

  function viewLab(lab) {
    const p = labProgress(lab);
    const items = lab.lessons.map((x, i) => {
      const n = String(i + 1).padStart(2, '0');
      const tag = !x.file ? '<span class="status soon">قريبًا</span>' : isDone(lab.id, x.id) ? '<span class="status live">✓ خلّصتها</span>' : '';
      const inner = `<span class="num">${n}</span><b>${x.title}</b><span class="en">${esc(x.terms)}</span>${tag}`;
      return x.file ? `<li><a class="lesson-row" href="#/${lab.id}/${x.id}">${inner}</a></li>` : `<li><div class="lesson-row soon" aria-disabled="true">${inner}</div></li>`;
    }).join('');
    const rel = (lab.related || []).map(([id, t, d]) => {
      const target = labById(id), live = target && built(target).length;
      return live ? `<a href="#/${id}"><b>${t}</b><span>${d}</span></a>` : `<div><b>${t}</b><span>${d} (قريبًا)</span></div>`;
    }).join('');
    const first = built(lab).find(x => !isDone(lab.id, x.id)) || built(lab)[0];
    return {
      title: lab.title, crumbs: [[lab.title, `#/${lab.id}`]], html: `
<section class="hero">
  <span class="num-lg">${lab.num}</span>
  <h1 tabindex="-1">${lab.title} <span class="en">${lab.en}</span></h1>
  ${lab.intro || `<p>${lab.blurb}</p>`}
  ${p.total ? `<p class="hero-cta"><a class="btn act" href="#/${lab.id}/${first.id}">${p.done ? 'كمّل من' : 'ابدأ بـ'}: ${first.title}</a> <span class="muted">خلّصت ${p.done} من ${p.total}</span></p>` : '<p class="note">المعمل ده لسه تحت الإنشاء. شوف ROADMAP.md للترتيب.</p>'}
</section>
<section class="chapter">
  <div class="chapter-head"><h2>التجارب</h2><p>بالترتيب</p></div>
  <ol class="lesson-list">${items}</ol>
</section>
${rel ? `<section class="chapter"><div class="chapter-head"><h2>معامل مرتبطة</h2></div><div class="related">${rel}</div></section>` : ''}`
    };
  }

  function viewLesson(lab, meta) {
    const lesson = LESSONS[lab.id + '/' + meta.id];
    if (!lesson) throw new Error(`الملف ${meta.file} اتحمّل بس مسجّلش الدرس "${meta.id}"`);
    const seq = sequence(), i = seq.findIndex(x => x.lesson && x.lab.id === lab.id && x.lesson.id === meta.id);
    const prev = seq[i - 1], next = seq[i + 1];
    const idx = lab.lessons.indexOf(meta) + 1;
    const doneNow = isDone(lab.id, meta.id);
    const navLink = (x, dir) => x ? `<a class="pager-${dir}" href="${x.href}"><span>${dir === 'prev' ? '→ السابق' : 'التالي ←'}</span><b>${x.label}</b>${x.lab.id !== lab.id ? `<i>معمل ${x.lab.title}</i>` : ''}</a>` : '<span></span>';
    return {
      title: meta.title, crumbs: [[lab.title, `#/${lab.id}`], [meta.title, `#/${lab.id}/${meta.id}`]], html: `
<p class="lesson-kicker">تجربة ${idx} من ${lab.lessons.length} · معمل ${lab.title}</p>
${lesson.html}
<div class="lesson-foot">
  <button type="button" class="done-btn" aria-pressed="${doneNow}">${doneNow ? '✓ خلّصتها' : 'علّم إنك خلّصتها'}</button>
  <nav class="pager" aria-label="التنقل بين التجارب">${navLink(prev, 'prev')}${navLink(next, 'next')}</nav>
</div>`,
      after(m) {
        const b = m.querySelector('.done-btn');
        b.addEventListener('click', () => {
          const k = lab.id + '/' + meta.id;
          if (done.has(k)) done.delete(k); else done.add(k);
          saveDone();
          const on = done.has(k);
          b.setAttribute('aria-pressed', String(on)); b.textContent = on ? '✓ خلّصتها' : 'علّم إنك خلّصتها';
          renderSidebar(parse());
        });
      }
    };
  }

  function viewSoon(lab, meta) {
    return { title: meta.title, crumbs: [[lab.title, `#/${lab.id}`], [meta.title, '']], html: `
<section class="hero"><h1 tabindex="-1">${meta.title} <span class="en">${esc(meta.terms)}</span></h1>
<p>التجربة دي لسه متبنتش. <a href="#/${lab.id}">ارجع لمعمل ${lab.title}</a>.</p></section>` };
  }
  function viewMissing() {
    return { title: 'مش موجود', crumbs: [], html: `<section class="hero"><h1 tabindex="-1">الصفحة دي مش موجودة</h1><p><a href="#/">ارجع للرئيسية</a></p></section>` };
  }

  /* ---------- chrome: breadcrumb + sidebar + drawer ---------- */
  function renderCrumbs(crumbs) {
    const el = document.getElementById('crumbs');
    const parts = [['الرئيسية', '#/'], ...crumbs];
    el.innerHTML = parts.map(([t, h], i) => i === parts.length - 1
      ? `<span aria-current="page">${t}</span>` : `<a href="${h}">${t}</a>`).join('<span class="crumb-sep" aria-hidden="true">‹</span>');
  }

  const expanded = {};
  function renderSidebar(r) {
    const side = document.getElementById('side-nav');
    side.innerHTML = CAT.map(lab => {
      const p = labProgress(lab), open = !!expanded[lab.id], cur = r.lab === lab.id;
      const pct = p.all ? Math.round(p.done / p.all * 100) : 0;
      const items = lab.lessons.map(x => {
        const active = cur && r.lesson === x.id, d = isDone(lab.id, x.id);
        if (!x.file) return `<li><span class="side-item soon" aria-disabled="true">${x.title}<em>قريبًا</em></span></li>`;
        return `<li><a class="side-item${active ? ' active' : ''}" href="#/${lab.id}/${x.id}"${active ? ' aria-current="page"' : ''}>${d ? '<i class="tick" aria-label="خلّصتها">✓</i>' : ''}${x.title}</a></li>`;
      }).join('');
      return `<div class="side-lab${cur ? ' current' : ''}">
        <div class="side-head">
          <a href="#/${lab.id}" class="side-title${cur && !r.lesson ? ' active' : ''}"><span class="num">${lab.num}</span>${lab.title}</a>
          <button type="button" class="side-toggle" data-lab="${lab.id}" aria-expanded="${open}" aria-controls="side-${lab.id}" aria-label="${open ? 'اقفل' : 'افتح'} تجارب ${lab.title}">${open ? '−' : '+'}</button>
        </div>
        <div class="side-prog" title="خلّصت ${p.done} من ${p.all}"><i style="width:${pct}%"></i></div>
        <span class="side-meta">${p.done} / ${p.all} · ${pct}%${p.total && p.total < p.all ? ` · جاهز ${p.total}` : ''}</span>
        <ul id="side-${lab.id}"${open ? '' : ' hidden'}>${items}</ul>
      </div>`;
    }).join('');
  }
  function onSideClick(e) {
    if (e.target.closest('a')) { closeDrawer(); return; }   // also covers re-clicking the current page (no hashchange)
    const t = e.target.closest('.side-toggle');
    if (!t) return;
    const id = t.dataset.lab;
    expanded[id] = !expanded[id];
    renderSidebar(parse());
    const again = document.querySelector(`.side-toggle[data-lab="${id}"]`);
    if (again) again.focus();
  }

  function openDrawer() { document.body.classList.add('drawer-open'); document.querySelector('.menu-btn').setAttribute('aria-expanded', 'true'); }
  function closeDrawer() { document.body.classList.remove('drawer-open'); const b = document.querySelector('.menu-btn'); if (b) b.setAttribute('aria-expanded', 'false'); }

  Lab.app = {
    start() {
      Lab.engine.init();
      document.getElementById('side-nav').addEventListener('click', onSideClick);
      document.querySelector('.menu-btn').addEventListener('click', () => document.body.classList.contains('drawer-open') ? closeDrawer() : openDrawer());
      document.querySelector('.scrim').addEventListener('click', closeDrawer);
      document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
      G.addEventListener('hashchange', route);
      route();
    },
    lessons: LESSONS
  };
})(window);
