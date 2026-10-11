/* Engineering Labs — shared drawing + math helpers.
   Classic script (no modules) so pages work from file://. Everything lives under window.Lab. */
(function (G) {
  "use strict";
  const Lab = G.Lab || (G.Lab = {});

  const FB = '"IBM Plex Sans Arabic", system-ui, sans-serif';
  const FM = '"JetBrains Mono", ui-monospace, monospace';
  const AR = /[؀-ۿ]/;

  /* ---------- math ---------- */
  const lerp = (a, b, k) => a + (b - a) * k;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ease = k => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
  /** exponential inter-arrival time for a Poisson process of `rate` events/s */
  const expo = (rate, rnd) => (rate <= 0 ? 1e9 : -Math.log(1 - rnd()) / rate);
  const f1 = v => (Math.round(v * 10) / 10).toFixed(1);
  const fmt = v => Math.round(v).toLocaleString('en-US');
  /** bytes → "8 KB" / "1.2 MB" */
  const bytes = b => b < 1024 ? Math.round(b) + ' B' : b < 1048576 ? f1(b / 1024).replace(/\.0$/, '') + ' KB'
    : b < 1073741824 ? f1(b / 1048576).replace(/\.0$/, '') + ' MB' : b < 1099511627776 ? f1(b / 1073741824).replace(/\.0$/, '') + ' GB'
    : f1(b / 1099511627776).replace(/\.0$/, '') + ' TB';

  /** mulberry32: small, fast, seeded PRNG → reset gives the same scenario */
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** rate over a sliding window of `w` seconds */
  class Meter {
    constructor(w) { this.w = w; this.a = []; }
    add(t, v = 1) { this.a.push([t, v]); }
    rate(t) {
      while (this.a.length && this.a[0][0] < t - this.w) this.a.shift();
      let s = 0; for (const x of this.a) s += x[1];
      return s / Math.max(0.5, Math.min(this.w, t));
    }
    sum(t) { this.rate(t); let s = 0; for (const x of this.a) s += x[1]; return s; }
  }

  /** fire fn() for each Poisson arrival up to time t (st.next holds the next arrival time) */
  function spawnLoop(st, t, rate, rnd, fn) {
    let n = 0;
    while (st.next <= t && n++ < 30) {
      st.next += expo(rate, rnd);
      if (st.next < t - 1) st.next = t + expo(rate, rnd);
      fn();
    }
  }

  /** tween helpers: mv() starts a move, adv() advances it and returns true when finished */
  function mv(o, tx_, ty_, d, ph, t) { o.fx = o.x; o.fy = o.y; o.tx = tx_; o.ty = ty_; o.t0 = t; o.d = d; o.ph = ph; }
  function adv(o, t) {
    const k = Math.min(1, (t - o.t0) / o.d), e = ease(k);
    o.x = lerp(o.fx, o.tx, e); o.y = lerp(o.fy, o.ty, e);
    return k >= 1;
  }

  /* ---------- drawing (bound to the current canvas by the engine) ---------- */
  let X = null, C = {};
  function bind(ctx, colors) { X = ctx; C = colors; }

  function rr(x, y, w, h, r) {
    X.beginPath();
    if (X.roundRect) X.roundRect(x, y, Math.max(0, w), Math.max(0, h), Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
    else X.rect(x, y, w, h);
  }
  /** o: {fill, stroke, r, lw, dash} — fill/stroke null = none */
  function box(x, y, w, h, o = {}) {
    const fill = o.fill === undefined ? C.surface : o.fill;
    const stroke = o.stroke === undefined ? C.line : o.stroke;
    rr(x, y, w, h, o.r === undefined ? 8 : o.r);
    if (fill && fill !== 'transparent') { X.fillStyle = fill; X.fill(); }
    if (stroke) { X.lineWidth = o.lw || 1; X.strokeStyle = stroke; X.setLineDash(o.dash || []); X.stroke(); X.setLineDash([]); }
  }
  /** o: {s size, w weight, m mono, c color, a align, b baseline} */
  function tx(str, x, y, o = {}) {
    str = String(str);
    X.font = `${o.w || 500} ${o.s || 12}px ${o.m ? FM : FB}`;
    X.fillStyle = o.c || C.ink;
    X.textAlign = o.a || 'center';
    X.textBaseline = o.b || 'middle';
    X.direction = AR.test(str) ? 'rtl' : 'ltr';
    X.fillText(str, x, y);
  }
  function textW(str, o = {}) { X.font = `${o.w || 500} ${o.s || 12}px ${o.m ? FM : FB}`; return X.measureText(String(str)).width; }
  function dot(x, y, r, c) { X.beginPath(); X.arc(x, y, r, 0, Math.PI * 2); X.fillStyle = c; X.fill(); }
  function circ(x, y, r, c, lw = 1.5) { X.beginPath(); X.arc(x, y, r, 0, Math.PI * 2); X.strokeStyle = c; X.lineWidth = lw; X.stroke(); }
  /** progress ring, k in 0..1 */
  function ring(x, y, r, k, c, lw = 2.5) {
    X.beginPath(); X.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(k, 0, 1));
    X.strokeStyle = c; X.lineWidth = lw; X.stroke();
  }
  function line(x1, y1, x2, y2, c, lw = 1, dash) {
    X.beginPath(); X.moveTo(x1, y1); X.lineTo(x2, y2);
    X.strokeStyle = c; X.lineWidth = lw; X.setLineDash(dash || []); X.stroke(); X.setLineDash([]);
  }
  function arrow(x1, y1, x2, y2, c, lw = 1.5, dash) {
    line(x1, y1, x2, y2, c, lw, dash);
    const a = Math.atan2(y2 - y1, x2 - x1);
    X.beginPath(); X.moveTo(x2, y2);
    X.lineTo(x2 - 9 * Math.cos(a - 0.4), y2 - 9 * Math.sin(a - 0.4));
    X.lineTo(x2 - 9 * Math.cos(a + 0.4), y2 - 9 * Math.sin(a + 0.4));
    X.closePath(); X.fillStyle = c; X.fill();
  }
  function hatch(x, y, w, h, c) {
    X.save(); rr(x, y, w, h, 3); X.clip();
    X.strokeStyle = c; X.lineWidth = 1; X.globalAlpha *= 0.6;
    for (let i = -h; i < w; i += 6) { X.beginPath(); X.moveTo(x + i, y + h); X.lineTo(x + i + h, y); X.stroke(); }
    X.restore();
  }
  function alpha(a, fn) { const p = X.globalAlpha; X.globalAlpha = p * a; fn(); X.globalAlpha = p; }

  /** a database cylinder */
  function cyl(x, y, w, h, o = {}) {
    const e = Math.min(10, h * 0.18), fill = o.fill || C.surface, stroke = o.stroke || C.line;
    X.beginPath();
    X.ellipse(x + w / 2, y + e, w / 2, e, 0, Math.PI, 0, false);
    X.lineTo(x + w, y + h - e);
    X.ellipse(x + w / 2, y + h - e, w / 2, e, 0, 0, Math.PI, false);
    X.closePath(); X.fillStyle = fill; X.fill(); X.lineWidth = o.lw || 1; X.strokeStyle = stroke; X.stroke();
    X.beginPath(); X.ellipse(x + w / 2, y + e, w / 2, e, 0, 0, Math.PI, false); X.stroke();
  }

  /** page counts per B-tree level for a fully packed index, from the root down to the leaf.
      leafCap = rows per leaf page, fanout = child pointers per non-leaf page */
  function btreeLevels(rows, leafCap, fanout) {
    const lv = [Math.max(1, Math.ceil(rows / leafCap))];
    while (lv[0] > 1) lv.unshift(Math.ceil(lv[0] / fanout));
    return lv;
  }
  /** rows that fit in an 8 KB page: 8,096 usable bytes, 2-byte slot per row */
  const perPage = rowBytes => Math.floor(8096 / (rowBytes + 2));

  Lab.util = { lerp, clamp, ease, expo, f1, fmt, bytes, rng, Meter, spawnLoop, mv, adv, btreeLevels, perPage };
  Lab.draw = { bind, rr, box, tx, textW, dot, circ, ring, line, arrow, hatch, alpha, cyl, ctx: () => X, colors: () => C };
  Lab.FONT = { body: FB, mono: FM };
})(window);
