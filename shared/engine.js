/* Engineering Labs — simulation engine.
   One rAF loop for the whole app. The router mounts the sims of the current view and unmounts them on navigation
   (observers disconnected, removed from the loop) so nothing leaks between lessons.
   Contract: see CLAUDE.md → "عقد التجربة". */
(function (G) {
  "use strict";
  const Lab = G.Lab || (G.Lab = {});
  const { clamp } = Lab.util;
  const D = Lab.draw;

  const REGISTRY = {};
  let sims = [];
  const REDUCE = !!(G.matchMedia && G.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const THEME_KEY = 'labs-theme';
  let C = {};
  let started = false;

  /* ---------- theme ---------- */
  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const g = k => cs.getPropertyValue(k).trim();
    C = {
      bg: g('--sunk'), surface: g('--surface'), ink: g('--ink'), muted: g('--muted'), line: g('--line'),
      accent: g('--accent'), a2: g('--accent-2'), violet: g('--violet'), good: g('--good'), bad: g('--bad')
    };
    for (const s of sims) { s.C = C; if (s.w) render(s); }
  }
  function isDark() {
    const t = document.documentElement.getAttribute('data-theme');
    if (t) return t === 'dark';
    return !!(G.matchMedia && G.matchMedia('(prefers-color-scheme: dark)').matches);
  }
  function setupThemeButton() {
    const btn = document.querySelector('.theme-btn');
    if (!btn) return;
    const label = () => {
      const dark = isDark();
      btn.textContent = dark ? '☀ فاتح' : '☾ غامق';
      btn.setAttribute('aria-label', dark ? 'التحويل للوضع الفاتح' : 'التحويل للوضع الغامق');
    };
    label();
    btn.addEventListener('click', () => {
      const next = isDark() ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* storage blocked: theme just won't persist */ }
      label();
    });
    try { G.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', label); } catch (e) { }
  }

  /* ---------- per-sim lifecycle ---------- */
  function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  function fail(s, err) {
    s.dead = true; s.running = false;
    console.error(`[Lab] sim "${s.key}" stopped:`, err);
    if (!s.errEl) { s.errEl = document.createElement('div'); s.errEl.className = 'stage-err'; s.stage.appendChild(s.errEl); }
    s.errEl.textContent = `sim "${s.key}" error: ${err && err.message ? err.message : err}`;
    syncPlay(s);
  }
  function guard(s, fn) { if (s.dead) return; try { fn(); } catch (e) { fail(s, e); } }

  function tick(s, dt) {
    s.t += dt;
    s.def.step(s, dt);
    for (const d of s.drops) { d.vy += 380 * dt; d.y += d.vy * dt; d.x += d.vx * dt; d.a -= dt * 1.1; }
    s.drops = s.drops.filter(d => d.a > 0);
  }
  function warm(s, sec) { if (!s.w) return; for (let i = 0; i < sec * 30; i++) tick(s, 1 / 30); }

  function render(s) {
    if (!s.w) return;
    guard(s, () => {
      const X = s.ctx;
      D.bind(X, C);
      X.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
      X.globalAlpha = 1;
      X.clearRect(0, 0, s.w, s.h);
      X.fillStyle = C.bg; X.fillRect(0, 0, s.w, s.h);
      s.def.draw(s);
      for (const d of s.drops) { X.globalAlpha = Math.max(0, d.a); D.dot(d.x, d.y, 3.5, C[d.c] || C.bad); }
      X.globalAlpha = 1;
    });
  }
  function renderStats(s) {
    if (!s.statsEl || !s.def.stats) return;
    guard(s, () => {
      const rows = s.def.stats(s);
      const html = rows.map(r => `<div class="stat ${r[2] || ''}"><dt>${r[0]}</dt><dd>${r[1]}</dd></div>`).join('');
      if (html !== s._stats) { s._stats = html; s.statsEl.innerHTML = html; }
    });
  }
  function start(s) {
    s.t = 0; s.drops = []; s.rng = Lab.util.rng(s.seed); s.dead = false;
    if (s.errEl) { s.errEl.remove(); s.errEl = null; }
    s.started = true; s.warmed = false;
    guard(s, () => { s.def.init(s); if (s.w) { warm(s, s.def.warm === undefined ? 2.5 : s.def.warm); s.warmed = true; } });
    renderStats(s);
  }
  function syncPlay(s) {
    const b = s.card.querySelector('[data-act="toggle"]');
    if (!b) return;
    b.textContent = s.running ? 'إيقاف' : 'تشغيل';
    b.setAttribute('aria-pressed', String(!s.running));
  }
  function afterParam(s, k) {
    guard(s, () => { if (s.def.onParam) s.def.onParam(s, k); });
    if (!s.running) render(s);
    renderStats(s);
  }

  function addSteppedButtons(s) {
    const bar = s.card.querySelector('.stage-bar');
    if (!bar || bar.querySelector('[data-act="prev"]')) return;
    const mk = (act, txt, lbl) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.dataset.act = act; b.textContent = txt; b.setAttribute('aria-label', lbl); return b; };
    bar.appendChild(mk('prev', '▶ السابقة', 'الخطوة اللي فاتت'));
    bar.appendChild(mk('next', 'الجاية ◀', 'الخطوة الجاية'));
  }
  function stepTo(s, delta) {
    guard(s, () => {
      const st = s.st, n = s.def.stepCount(s);
      st.i = clamp((st.i || 0) + delta, 0, n - 1); st.e = 0;
    });
    s.running = false; syncPlay(s); render(s); renderStats(s);
  }

  function setup(card) {
    const key = card.dataset.sim, def = REGISTRY[key];
    if (!def) { console.warn(`[Lab] no sim registered for "${key}"`); return; }
    const cv = card.querySelector('canvas');
    if (def.height) cv.style.height = def.height + 'px';
    const s = {
      key, def, card, cv, stage: card.querySelector('.stage'), ctx: cv.getContext('2d'),
      w: 0, h: 0, dpr: 1, t: 0, p: {}, st: {}, C, narrow: false,
      running: !REDUCE, visible: true, drops: [], dead: false, warmed: false,
      seed: hash(key), rng: Lab.util.rng(hash(key)), observers: [],
      statsEl: card.querySelector('[data-stats]'), capEl: card.querySelector('.caption'), _cap: '', _stats: ''
    };
    s.setCap = html => { if (s.capEl && html !== s._cap) { s._cap = html; s.capEl.innerHTML = html; } };
    s.drop = (x, y, c = 'bad', vx = 0) => { s.drops.push({ x, y, vy: -70, vx, a: 1, c }); };

    card.querySelectorAll('input[data-p]').forEach(inp => {
      const k = inp.dataset.p, out = card.querySelector(`[data-out="${k}"]`);
      const upd = () => {
        s.p[k] = inp.type === 'checkbox' ? inp.checked : +inp.value;
        if (out) {
          const shown = inp.dataset.map ? inp.dataset.map.split('|')[+inp.value] : (inp.dataset.fmt === 'k' ? (+inp.value).toLocaleString('en-US') : inp.value);
          out.textContent = shown + (inp.dataset.unit ? ' ' + inp.dataset.unit : '');
        }
      };
      upd();
      inp.addEventListener('input', () => { upd(); afterParam(s, k); });
    });
    card.querySelectorAll('.seg[data-p]').forEach(seg => {
      const k = seg.dataset.p, btns = [...seg.querySelectorAll('button')];
      const set = (b, fire) => {
        btns.forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        const v = b.dataset.v;
        s.p[k] = v === 'true' ? true : v === 'false' ? false : (v !== '' && !isNaN(+v) ? +v : v);
        if (fire) afterParam(s, k);
      };
      set(btns.find(b => b.getAttribute('aria-pressed') === 'true') || btns[0], false);
      btns.forEach(b => b.addEventListener('click', () => set(b, true)));
    });
    if (def.stepped) addSteppedButtons(s);
    card.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
      const a = b.dataset.act;
      if (a === 'toggle') { if (s.dead) return; s.running = !s.running; syncPlay(s); }
      else if (a === 'reset') { start(s); render(s); }
      else if (a === 'prev' && def.stepped) stepTo(s, -1);
      else if (a === 'next' && def.stepped) stepTo(s, 1);
      else if (def.act && def.act[a]) {
        guard(s, () => def.act[a](s));
        if (!s.running && !s.dead) { s.running = true; syncPlay(s); }
        renderStats(s);
      }
    }));

    s.resize = () => {
      const r = cv.getBoundingClientRect();
      s.dpr = Math.min(2, G.devicePixelRatio || 1);
      s.w = r.width; s.h = r.height; s.narrow = r.width < 520;
      cv.width = Math.max(1, Math.round(r.width * s.dpr));
      cv.height = Math.max(1, Math.round(r.height * s.dpr));
      // a sim mounted while hidden (0 width) warms up the first time it gets a real size
      if (s.started && s.w && !s.warmed && !s.dead) { guard(s, () => warm(s, s.def.warm === undefined ? 2.5 : s.def.warm)); s.warmed = true; renderStats(s); }
    };
    s.resize();
    start(s);
    syncPlay(s);
    try { const ro = new ResizeObserver(() => { s.resize(); render(s); }); ro.observe(cv); s.observers.push(ro); }
    catch (e) { const h = () => { s.resize(); render(s); }; G.addEventListener('resize', h); s.observers.push({ disconnect: () => G.removeEventListener('resize', h) }); }
    try { const io = new IntersectionObserver(es => es.forEach(e => { s.visible = e.isIntersecting; }), { rootMargin: '120px' }); io.observe(card); s.observers.push(io); }
    catch (e) { }
    sims.push(s);
    render(s); renderStats(s);
  }

  /* ---------- loop ---------- */
  let last = 0;
  function frame(now) {
    const dt = clamp((now - last) / 1000, 0, 0.05); last = now;
    for (const s of sims) {
      if (!s.visible || s.dead) continue;
      if (s.running) guard(s, () => tick(s, dt));
      render(s);
    }
    G.requestAnimationFrame(frame);
  }

  /* ---------- public API ---------- */
  Lab.registerSim = function (key, def) {
    if (REGISTRY[key]) console.warn(`[Lab] sim "${key}" registered twice`);
    REGISTRY[key] = def;
  };
  Lab.engine = {
    /** once per page load: theme, colors, loop, live-stats timer */
    init() {
      if (started) return; started = true;
      readColors();
      setupThemeButton();
      try { G.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readColors); } catch (e) { }
      new MutationObserver(readColors).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      last = G.performance.now();
      G.requestAnimationFrame(frame);
      setInterval(() => { for (const s of sims) if (s.visible && s.running) renderStats(s); }, 300);
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => sims.forEach(render));
    },
    /** start every .lab[data-sim] inside root */
    mount(root) { root.querySelectorAll('.lab[data-sim]').forEach(setup); },
    /** stop and drop every running sim (called before the router swaps the view) */
    unmount() {
      for (const s of sims) { s.observers.forEach(o => o.disconnect()); s.running = false; s.dead = true; }
      sims = [];
    },
    count: () => sims.length
  };
  Lab.REDUCED_MOTION = REDUCE;

  /** console helpers for verification: Lab.debug.advance('pages', 10) runs 10 simulated seconds */
  Lab.debug = {
    get sims() { return sims; },
    get: key => sims.find(s => s.key === key),
    advance(key, sec) {
      const s = this.get(key); if (!s) return null;
      guard(s, () => { for (let i = 0; i < sec * 30; i++) tick(s, 1 / 30); });
      render(s); renderStats(s);
      return s.dead ? 'dead' : s.statsEl ? [...s.statsEl.querySelectorAll('.stat')].map(e => e.innerText.replace(/\n/, ': ')).join(' | ') : 'ok';
    }
  };
})(window);
