'use strict';
/* ==========================================================================
 * render.js – Isometrische Canvas-Darstellung
 * Alle Grafiken werden hier per Code gezeichnet. Statische Gebäudeteile
 * landen in einem Sprite-Cache (pro Zoomstufe), Animationen kommen pro Frame dazu.
 * ========================================================================== */

const Render = (() => {
  const HW = 32, HH = 16;                 // halbe Kachelbreite/-höhe in Weltpixeln
  const N = CONFIG.map.size;
  const OL = 'rgba(52,34,18,0.72)';      // Cartoon-Kontur
  let canvas, ctx, dpr = 1, W = 0, H = 0;
  const cam = { x: 0, y: 0, zoom: 1 };
  const ZMIN = 0.38, ZMAX = 2.3;
  const sprites = new Map();
  let bucket = 0;
  let time = 0;
  let forest = [], forestRl = -1;
  const drawList = [];
  const particles = [];
  const screenFx = [];
  const hudTargets = {};
  const view = { x0: 0, y0: 0, x1: 0, y1: 0 };
  let rain = [], confetti = [], mosquitos = [], fireflies = [];
  let flash = 0, nextLightning = 0;
  const hooks = { lightning: null };
  const gate = { _k: 4, _d: 0 };

  /* ---------------- Mathe & Koordinaten ---------------- */
  const P = (x, y, z) => [(x - y) * HW, (x + y) * HH - (z || 0)];
  function hash(x, y, s) {
    let h = (x * 374761393 + y * 668265263 + (s || 0) * 1442695041) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  const worldToScreen = (wx, wy) => ({ x: (wx - cam.x) * cam.zoom + W / 2, y: (wy - cam.y) * cam.zoom + H / 2 });
  const screenToWorld = (sx, sy) => ({ x: (sx - W / 2) / cam.zoom + cam.x, y: (sy - H / 2) / cam.zoom + cam.y });
  function screenToGrid(sx, sy) {
    const w = screenToWorld(sx, sy);
    return { x: (w.x / HW + w.y / HH) / 2, y: (w.y / HH - w.x / HW) / 2 };
  }
  function gridToScreen(gx, gy, z) { const p = P(gx, gy, z); return worldToScreen(p[0], p[1]); }

  /* ---------------- Farben ---------------- */
  const shadeCache = new Map();
  function shade(hex, amt) {
    const key = hex + '|' + amt;
    let v = shadeCache.get(key);
    if (v) return v;
    let r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    if (amt < 0) { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; }
    else { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
    v = `rgb(${r | 0},${g | 0},${b | 0})`;
    shadeCache.set(key, v);
    return v;
  }

  /* ---------------- Zeichen-Grundformen ---------------- */
  function poly(c, pts, fill, stroke, lw) {
    c.beginPath();
    c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    c.closePath();
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw || 1.4; c.stroke(); }
  }
  function quad(c, x0, y0, x1, y1, z, fill, stroke, lw) {
    poly(c, [P(x0, y0, z), P(x1, y0, z), P(x1, y1, z), P(x0, y1, z)], fill, stroke, lw);
  }
  // Quader: linke Front (y = y1), rechte Front (x = x1), Deckel
  function box(c, x0, y0, x1, y1, z, h, col, opt) {
    opt = opt || {};
    const ol = opt.ol === undefined ? OL : opt.ol;
    poly(c, [P(x0, y1, z), P(x1, y1, z), P(x1, y1, z + h), P(x0, y1, z + h)], opt.left || shade(col, -0.12), ol);
    poly(c, [P(x1, y1, z), P(x1, y0, z), P(x1, y0, z + h), P(x1, y1, z + h)], opt.right || shade(col, -0.3), ol);
    if (!opt.noTop) poly(c, [P(x0, y0, z + h), P(x1, y0, z + h), P(x1, y1, z + h), P(x0, y1, z + h)], opt.top || col, ol);
  }
  // Fläche auf der linken Front (y fest)
  function faceY(c, y, xa, xb, za, zb, fill, stroke) { poly(c, [P(xa, y, za), P(xb, y, za), P(xb, y, zb), P(xa, y, zb)], fill, stroke, 1.1); }
  // Fläche auf der rechten Front (x fest)
  function faceX(c, x, ya, yb, za, zb, fill, stroke) { poly(c, [P(x, yb, za), P(x, ya, za), P(x, ya, zb), P(x, yb, zb)], fill, stroke, 1.1); }

  function roofX(c, x0, y0, x1, y1, z, rh, col, wall, o) {
    o = o == null ? 0.14 : o;
    const ym = (y0 + y1) / 2;
    poly(c, [P(x0 - o, y0 - o, z), P(x1 + o, y0 - o, z), P(x1 + o, ym, z + rh), P(x0 - o, ym, z + rh)], shade(col, -0.25), OL);
    poly(c, [P(x1, y0, z), P(x1, y1, z), P(x1, ym, z + rh)], shade(wall, -0.3), OL);
    poly(c, [P(x0 - o, y1 + o, z), P(x1 + o, y1 + o, z), P(x1 + o, ym, z + rh), P(x0 - o, ym, z + rh)], col, OL);
    poly(c, [P(x1 + o, y1 + o, z), P(x1 + o, ym, z + rh), P(x1 + o, ym, z + rh - 3), P(x1 + o, y1 + o, z - 3)], shade(col, -0.4), OL, 1);
  }
  function roofY(c, x0, y0, x1, y1, z, rh, col, wall, o) {
    o = o == null ? 0.14 : o;
    const xm = (x0 + x1) / 2;
    poly(c, [P(x0 - o, y0 - o, z), P(x0 - o, y1 + o, z), P(xm, y1 + o, z + rh), P(xm, y0 - o, z + rh)], shade(col, -0.1), OL);
    poly(c, [P(x0, y1, z), P(x1, y1, z), P(xm, y1, z + rh)], shade(wall, -0.12), OL);
    poly(c, [P(x1 + o, y0 - o, z), P(x1 + o, y1 + o, z), P(xm, y1 + o, z + rh), P(xm, y0 - o, z + rh)], shade(col, -0.28), OL);
  }
  function roofPyr(c, x0, y0, x1, y1, z, rh, col, o) {
    o = o == null ? 0.12 : o;
    const A = P((x0 + x1) / 2, (y0 + y1) / 2, z + rh);
    const Nn = P(x0 - o, y0 - o, z), E = P(x1 + o, y0 - o, z), S = P(x1 + o, y1 + o, z), Wc = P(x0 - o, y1 + o, z);
    poly(c, [Wc, S, A], col, OL);
    poly(c, [S, E, A], shade(col, -0.25), OL);
  }
  function ellipseG(c, cx, cy, r, z, fill, stroke, lw) {
    const p = P(cx, cy, z);
    c.beginPath();
    c.ellipse(p[0], p[1], r * HW * 1.414, r * HH * 1.414, 0, 0, Math.PI * 2);
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw || 1.4; c.stroke(); }
  }
  function cylinder(c, cx, cy, r, z, h, col, top) {
    const p = P(cx, cy, z);
    const rx = r * HW * 1.414, ry = r * HH * 1.414;
    c.beginPath();
    c.moveTo(p[0] - rx, p[1] - h);
    c.lineTo(p[0] - rx, p[1]);
    c.ellipse(p[0], p[1], rx, ry, 0, Math.PI, 0, true);
    c.lineTo(p[0] + rx, p[1] - h);
    c.closePath();
    c.fillStyle = shade(col, -0.18); c.fill();
    c.strokeStyle = OL; c.lineWidth = 1.3; c.stroke();
    c.beginPath();
    c.ellipse(p[0], p[1] - h, rx, ry, 0, 0, Math.PI * 2);
    c.fillStyle = top || col; c.fill(); c.stroke();
  }
  function cone(c, cx, cy, r, z, h, col) {
    const p = P(cx, cy, z);
    const rx = r * HW * 1.414, ry = r * HH * 1.414;
    c.beginPath();
    c.moveTo(p[0] - rx, p[1]);
    c.lineTo(p[0], p[1] - h);
    c.lineTo(p[0] + rx, p[1]);
    c.ellipse(p[0], p[1], rx, ry, 0, 0, Math.PI, false);
    c.closePath();
    const g = c.createLinearGradient(p[0] - rx, 0, p[0] + rx, 0);
    g.addColorStop(0, shade(col, 0.1)); g.addColorStop(0.45, col); g.addColorStop(1, shade(col, -0.3));
    c.fillStyle = g; c.fill();
    c.strokeStyle = OL; c.lineWidth = 1.3; c.stroke();
  }
  function circle(c, x, y, r, fill, stroke, lw) {
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw || 1.3; c.stroke(); }
  }
  function line(c, a, b, col, lw) {
    c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]);
    c.strokeStyle = col; c.lineWidth = lw || 1.5; c.stroke();
  }
  function rr(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y);
    c.closePath();
  }
  function groundPatch(c, x0, y0, x1, y1, col, edge) {
    quad(c, x0, y0, x1, y1, 0, col, edge || shade(col, -0.22), 1.6);
  }
  function shadow(c, x0, y0, x1, y1, off) {
    off = off == null ? 0.22 : off;
    c.globalAlpha = 0.16;
    quad(c, x0 + off, y0, x1 + off, y1, 0, '#1f3a10');
    c.globalAlpha = 1;
  }
  function bush(c, x, y, s, col) {
    col = col || '#4fa63a';
    circle(c, x - 5 * s, y - 4 * s, 5.5 * s, shade(col, -0.1), OL, 1.1);
    circle(c, x + 5 * s, y - 4 * s, 5.5 * s, shade(col, -0.15), OL, 1.1);
    circle(c, x, y - 8 * s, 6.5 * s, col, OL, 1.1);
    circle(c, x - 2 * s, y - 10 * s, 2.2 * s, shade(col, 0.3));
  }
  function stageOf(L) { return L >= 7 ? 2 : L >= 4 ? 1 : 0; }

  /* ---------------- Gebäude-Zeichnungen (lokal: Kachel 0,0 = Ursprung) ---------------- */
  const DRAW = {
    reception(c, L) {
      const st = stageOf(L);
      const wall = ['#cf9358', '#d9a066', '#e2ad74'][st];
      const roof = ['#d64933', '#3f6e9a', '#8c1d2c'][st];
      const tall = L >= 5;
      const wh = tall ? 46 : 32;
      shadow(c, 0.3, 0.3, 3.8, 3.8, 0.35);
      groundPatch(c, 0.1, 0.1, 3.9, 3.9, '#d9c8a0');
      box(c, 0.3, 0.3, 3.7, 3.7, 0, 6, '#9ca3af');
      box(c, 0.4, 0.4, 3.6, 3.6, 6, wh, wall);
      c.globalAlpha = 0.25;
      for (let z = 12; z < 6 + wh; z += 6) {
        line(c, P(0.4, 3.6, z), P(3.6, 3.6, z), '#6b3f1d', 1);
        line(c, P(3.6, 3.6, z), P(3.6, 0.4, z), '#6b3f1d', 1);
      }
      c.globalAlpha = 1;
      // Tür & Fenster
      faceY(c, 3.6, 1.6, 2.4, 6, 28, '#6b3f1d', OL);
      faceY(c, 3.6, 1.72, 2.28, 6, 25, '#8a5530');
      circle(c, ...P(2.18, 3.6, 16), 1.4, '#fcd34d');
      const win = (x0, x1, z0, z1) => { faceY(c, 3.6, x0, x1, z0, z1, '#fff7e0', OL); faceY(c, 3.6, x0 + 0.06, x1 - 0.06, z0 + 2, z1 - 2, '#7cc4ea'); };
      const winR = (y0, y1, z0, z1) => { faceX(c, 3.6, y0, y1, z0, z1, '#fff7e0', OL); faceX(c, 3.6, y0 + 0.06, y1 - 0.06, z0 + 2, z1 - 2, '#5aa7d4'); };
      win(0.65, 1.25, 14, 26); win(2.75, 3.35, 14, 26);
      winR(0.9, 1.5, 14, 26); winR(2.4, 3.0, 14, 26);
      if (tall) { win(0.65, 1.25, 32, 44); win(1.7, 2.3, 32, 44); win(2.75, 3.35, 32, 44); winR(0.9, 1.5, 32, 44); winR(2.4, 3.0, 32, 44); }
      // Vordach über der Tür
      poly(c, [P(1.45, 3.6, 31), P(2.55, 3.6, 31), P(2.55, 4.0, 27), P(1.45, 4.0, 27)], shade(roof, 0.1), OL);
      // Dach
      roofX(c, 0.4, 0.4, 3.6, 3.6, 6 + wh, 34, roof, wall, 0.22);
      if (L >= 3) { box(c, 2.75, 1.75, 3.15, 2.15, 6 + wh + 20, 22, '#9ca3af'); }
      // Info-Schild
      const s = P(2, 3.62, 6 + wh - 4);
      circle(c, s[0], s[1], 7, '#16a34a', '#fff', 1.6);
      c.fillStyle = '#fff'; c.font = 'bold 10px ui-rounded, system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('i', s[0], s[1] + 0.5);
      // Fahnenmast
      line(c, P(3.85, 3.85, 0), P(3.85, 3.85, 92), '#e5e7eb', 2.2);
      circle(c, ...P(3.85, 3.85, 93), 2, '#fcd34d', OL, 1);
      if (L >= 2) { bush(c, ...P(0.35, 3.85), 0.8); }
      if (L >= 4) { bush(c, ...P(3.2, 3.95), 0.7, '#3f9a35'); }
      if (L >= 6) { // Blumenkästen
        faceY(c, 3.6, 0.6, 1.3, 11, 14, '#7c4a1e', OL);
        for (let i = 0; i < 5; i++) circle(c, ...P(0.67 + i * 0.14, 3.6, 15), 1.6, ['#f43f5e', '#facc15', '#a855f7'][i % 3]);
      }
      if (L >= 8) { // goldene Zier
        line(c, P(0.4, 3.6, 6 + wh), P(3.6, 3.6, 6 + wh), '#fbbf24', 2);
      }
    },

    tent(c, L) {
      const st = stageOf(L);
      const col = ['#f08a24', '#22a35a', '#3b7be0'][st];
      shadow(c, 0.3, 0.3, 1.7, 1.7, 0.15);
      groundPatch(c, 0.1, 0.1, 1.9, 1.9, '#d6c89a');
      const h = 26 + L * 1.3;
      const x0 = 0.42, x1 = 1.5, y0 = 0.32, y1 = 1.55, xm = (x0 + x1) / 2;
      // Heringe & Leinen
      line(c, P(x1, y0 + 0.1, 0), P(x1 + 0.25, y0 - 0.05, 0), '#555', 1);
      line(c, P(x1, y1 - 0.1, 0), P(x1 + 0.25, y1 + 0.05, 0), '#555', 1);
      poly(c, [P(x0, y0), P(x0, y1), P(xm, y1, h), P(xm, y0, h)], shade(col, -0.05), OL);
      poly(c, [P(x1, y0), P(x1, y1), P(xm, y1, h), P(xm, y0, h)], shade(col, -0.25), OL);
      poly(c, [P(x0, y1), P(x1, y1), P(xm, y1, h)], col, OL);
      poly(c, [P(xm - 0.22, y1), P(xm + 0.22, y1), P(xm, y1, h * 0.72)], shade(col, -0.55));
      poly(c, [P(xm + 0.02, y1), P(xm + 0.34, y1 + 0.02), P(xm, y1, h * 0.7)], shade(col, 0.25), OL, 1);
      line(c, P(xm, y0, h), P(xm, y1, h), shade(col, -0.45), 1.6);
      if (L >= 2) { // Campingstuhl
        const p = P(1.7, 1.75);
        c.fillStyle = '#2563eb'; rr(c, p[0] - 4, p[1] - 11, 8, 7, 2); c.fill(); c.strokeStyle = OL; c.lineWidth = 1; c.stroke();
        line(c, [p[0] - 3, p[1] - 4], [p[0] - 4, p[1]], '#444', 1); line(c, [p[0] + 3, p[1] - 4], [p[0] + 4, p[1]], '#444', 1);
      }
      if (L >= 4) { // Laterne
        const p = P(0.25, 1.75);
        line(c, p, [p[0], p[1] - 16], '#57534e', 1.4);
        c.fillStyle = '#fde68a'; rr(c, p[0] - 2.5, p[1] - 21, 5, 6, 1.5); c.fill(); c.stroke();
      }
      if (L >= 6) { // Picknicktisch
        box(c, 1.6, 0.25, 1.9, 0.75, 6, 2, '#b07a45');
        line(c, P(1.65, 0.75, 0), P(1.65, 0.75, 6), '#7a4a21', 1.2);
        line(c, P(1.85, 0.75, 0), P(1.85, 0.75, 6), '#7a4a21', 1.2);
      }
      if (L >= 8) { // Wimpel
        line(c, P(xm, y1, h), P(xm, y1, h + 14), '#57534e', 1.2);
        poly(c, [P(xm, y1, h + 14), P(xm + 0.3, y1, h + 11), P(xm, y1, h + 8)], '#facc15', OL, 1);
      }
      if (L >= 10) bush(c, ...P(0.25, 0.4), 0.55, '#f472b6');
    },

    rv(c, L) {
      const st = stageOf(L);
      const stripe = ['#ef4444', '#0ea5e9', '#8b5cf6'][st];
      shadow(c, 0.3, 0.6, 2.7, 2.2, 0.2);
      groundPatch(c, 0.12, 0.12, 2.88, 2.88, '#cfc6b2');
      c.globalAlpha = 0.35;
      for (let i = 0; i < 14; i++) circle(c, ...P(0.3 + hash(i, 1) * 2.4, 0.3 + hash(i, 2) * 2.4), 1.2, '#8b8578');
      c.globalAlpha = 1;
      // Stromsäule
      box(c, 2.55, 0.2, 2.75, 0.4, 0, 14, '#e5e7eb');
      circle(c, ...P(2.66, 0.42, 10), 1.5, '#22c55e');
      // Markise
      if (L >= 3) {
        poly(c, [P(0.6, 2.0, 24), P(1.9, 2.0, 24), P(1.9, 2.6, 16), P(0.6, 2.6, 16)], shade(stripe, 0.35), OL);
        for (let i = 0; i < 4; i++) poly(c, [P(0.6 + i * 0.325, 2.0, 24), P(0.6 + i * 0.325 + 0.16, 2.0, 24), P(0.6 + i * 0.325 + 0.16, 2.6, 16), P(0.6 + i * 0.325, 2.6, 16)], stripe);
        line(c, P(0.65, 2.6, 0), P(0.65, 2.6, 16), '#78716c', 1.2);
        line(c, P(1.85, 2.6, 0), P(1.85, 2.6, 16), '#78716c', 1.2);
      }
      const x0 = 0.4, x1 = 2.6, y0 = 0.85, y1 = 2.0;
      box(c, x0, y0, x1, y1, 4, 26, '#f8fafc', { left: '#eef2f7', right: '#cbd5e1' });
      // Alkoven über Fahrerhaus
      box(c, x1 - 0.55, y0, x1 + 0.12, y1, 22, 8, '#f8fafc', { left: '#eef2f7', right: '#cbd5e1' });
      faceY(c, y1, x0, x1, 9, 13, stripe);
      faceX(c, x1, y0, y1, 9, 13, stripe);
      faceY(c, y1, 0.65, 1.15, 16, 25, '#334155', OL);
      faceY(c, y1, 1.35, 1.65, 4.5, 24, '#e2e8f0', OL);
      faceX(c, x1, y0 + 0.12, y1 - 0.12, 15, 26, '#1e3a5f', OL);
      faceX(c, x1, y0 + 0.2, y1 - 0.5, 18, 24, '#5b8bb5');
      for (const wx of [0.8, 2.15]) {
        const p = P(wx, y1, 4);
        c.beginPath(); c.ellipse(p[0], p[1] - 1, 4.5, 4.5, 0, 0, Math.PI * 2);
        c.fillStyle = '#1f2937'; c.fill(); circle(c, p[0], p[1] - 1, 1.8, '#9ca3af');
      }
      if (L >= 5) { // Fahrräder
        const p = P(0.3, 2.3);
        c.strokeStyle = '#334155'; c.lineWidth = 1.2;
        c.beginPath(); c.arc(p[0] - 4, p[1] - 4, 3.5, 0, 7); c.stroke();
        c.beginPath(); c.arc(p[0] + 5, p[1] - 4, 3.5, 0, 7); c.stroke();
        line(c, [p[0] - 4, p[1] - 4], [p[0] + 1, p[1] - 9], stripe, 1.4); line(c, [p[0] + 1, p[1] - 9], [p[0] + 5, p[1] - 4], stripe, 1.4);
      }
      if (L >= 7) { box(c, 0.9, y0 + 0.15, 1.5, y1 - 0.15, 30, 4, '#94a3b8'); } // Dachbox
      if (L >= 9) { bush(c, ...P(2.6, 2.75), 0.7, '#f472b6'); }
    },

    mobilehome(c, L) {
      const st = stageOf(L);
      const wall = ['#f3e3c3', '#cfe8d5', '#d5e3f5'][st];
      const roof = ['#a2401b', '#475569', '#1e3a8a'][st];
      shadow(c, 0.3, 0.3, 2.7, 2.0, 0.3);
      groundPatch(c, 0.1, 0.1, 2.9, 2.9, '#a6d17e');
      box(c, 0.25, 1.95, 2.75, 2.85, 0, 4, '#c08850');
      c.globalAlpha = 0.35;
      for (let x = 0.5; x < 2.75; x += 0.25) line(c, P(x, 1.95, 4), P(x, 2.85, 4), '#7a4a21', 1);
      c.globalAlpha = 1;
      box(c, 0.35, 0.35, 2.65, 1.95, 3, 28, wall);
      faceY(c, 1.95, 1.85, 2.3, 3, 24, '#7c4a1e', OL);
      circle(c, ...P(2.22, 1.95, 13), 1.2, '#fcd34d');
      faceY(c, 1.95, 0.6, 1.15, 12, 24, '#fffaf0', OL); faceY(c, 1.95, 0.66, 1.09, 14, 22, '#7cc4ea');
      faceY(c, 1.95, 1.3, 1.65, 12, 24, '#fffaf0', OL); faceY(c, 1.95, 1.36, 1.59, 14, 22, '#7cc4ea');
      faceX(c, 2.65, 0.6, 1.4, 12, 24, '#fffaf0', OL); faceX(c, 2.65, 0.66, 1.34, 14, 22, '#5aa7d4');
      faceY(c, 1.95, 0.6, 1.15, 9, 12, '#7c4a1e', OL);
      for (let i = 0; i < 4; i++) circle(c, ...P(0.66 + i * 0.14, 1.95, 13), 1.6, ['#ef4444', '#facc15', '#ec4899', '#f97316'][i]);
      roofX(c, 0.35, 0.35, 2.65, 1.95, 31, 20, roof, wall, 0.16);
      if (L >= 4) { // Geländer
        for (let x = 0.3; x <= 2.75; x += 0.35) line(c, P(x, 2.85, 4), P(x, 2.85, 12), '#7a4a21', 1.3);
        line(c, P(0.3, 2.85, 12), P(2.75, 2.85, 12), '#7a4a21', 1.6);
      }
      if (L >= 6) { // Gartentisch
        cylinder(c, 1.0, 2.4, 0.18, 4, 7, '#f8fafc');
      }
      if (L >= 8) { // Solar
        poly(c, [P(0.7, 0.55, 36), P(1.6, 0.55, 36), P(1.6, 1.0, 46), P(0.7, 1.0, 46)], '#1e3a8a', '#cbd5e1', 1);
      }
      if (L >= 10) { bush(c, ...P(2.85, 0.4), 0.75); }
    },

    glamping(c, L) {
      const st = stageOf(L);
      const canvasCol = ['#f1e6cf', '#f5ecdc', '#fbf3e4'][st];
      shadow(c, 0.2, 0.2, 2.8, 2.8, 0.25);
      box(c, 0.15, 0.15, 2.85, 2.85, 0, 6, '#c48a52');
      c.globalAlpha = 0.3;
      for (let x = 0.4; x < 2.85; x += 0.27) line(c, P(x, 0.15, 6), P(x, 2.85, 6), '#6b3f1d', 1);
      c.globalAlpha = 1;
      cylinder(c, 1.45, 1.45, 0.95, 6, 15, canvasCol);
      cone(c, 1.45, 1.45, 1.08, 21, 40, canvasCol);
      // Eingang
      const p = P(1.45 + 0.67, 1.45 + 0.67, 6);
      c.beginPath(); c.moveTo(p[0] - 9, p[1] + 1); c.lineTo(p[0] - 2, p[1] - 26); c.lineTo(p[0] + 5, p[1] - 1); c.closePath();
      c.fillStyle = '#6b4a2b'; c.fill(); c.strokeStyle = OL; c.lineWidth = 1.1; c.stroke();
      const top = P(1.45, 1.45, 61);
      line(c, top, [top[0], top[1] - 10], '#6b4a2b', 1.6);
      if (L >= 3) { // Lichterkette
        const cols = ['#fde047', '#f472b6', '#60a5fa', '#4ade80'];
        for (let i = 0; i <= 10; i++) {
          const a = Math.PI * (0.05 + i * 0.09);
          const q = P(1.45 + Math.cos(a) * 1.0, 1.45 + Math.sin(a) * 1.0, 21 + Math.sin(i * 1.3) * 1.5);
          circle(c, q[0], q[1], 1.7, cols[i % 4]);
        }
      }
      if (L >= 5) { // Deckchairs
        poly(c, [P(0.3, 2.3, 6), P(0.75, 2.3, 6), P(0.75, 2.6, 9), P(0.3, 2.6, 9)], '#f8fafc', OL, 1);
        poly(c, [P(0.3, 2.3, 6), P(0.75, 2.3, 6), P(0.75, 2.25, 14), P(0.3, 2.25, 14)], '#e2e8f0', OL, 1);
      }
      if (L >= 7) { cylinder(c, 2.45, 0.5, 0.28, 6, 7, '#8b5a2b', '#38bdf8'); }
      if (L >= 9) { bush(c, ...P(0.3, 0.4, 6), 0.6, '#f472b6'); bush(c, ...P(2.7, 2.7, 6), 0.6); }
    },

    sanitary(c, L) {
      const st = stageOf(L);
      const roof = ['#3b82f6', '#0ea5e9', '#14b8a6'][st];
      shadow(c, 0.3, 0.4, 2.7, 2.7, 0.3);
      groundPatch(c, 0.1, 0.1, 2.9, 2.9, '#cbd5e1');
      box(c, 0.3, 0.4, 2.7, 2.7, 0, 30, '#f8fafc', { left: '#eef2f6', right: '#cfd8e3' });
      faceY(c, 2.7, 0.3, 2.7, 0, 8, '#93c5fd', OL);
      faceX(c, 2.7, 0.4, 2.7, 0, 8, '#60a5fa', OL);
      faceY(c, 2.7, 0.6, 1.05, 0, 21, '#e11d48', OL);
      faceY(c, 2.7, 1.95, 2.4, 0, 21, '#2563eb', OL);
      faceY(c, 2.7, 1.25, 1.75, 16, 26, '#e0f2fe', OL);
      faceX(c, 2.7, 0.7, 1.3, 20, 26, '#bae6fd', OL);
      faceX(c, 2.7, 1.7, 2.3, 20, 26, '#bae6fd', OL);
      box(c, 0.2, 0.3, 2.8, 2.8, 30, 4, roof);
      const s = P(1.5, 2.72, 12);
      c.fillStyle = '#1e40af'; c.font = 'bold 8px ui-rounded, system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('WC', s[0], s[1]);
      if (L >= 4) {
        poly(c, [P(0.5, 0.6, 34), P(1.4, 0.6, 34), P(1.4, 1.2, 42), P(0.5, 1.2, 42)], '#1e3a8a', '#e2e8f0', 1);
        poly(c, [P(1.6, 0.6, 34), P(2.5, 0.6, 34), P(2.5, 1.2, 42), P(1.6, 1.2, 42)], '#1e3a8a', '#e2e8f0', 1);
      }
      if (L >= 6) { box(c, 2.1, 0.5, 2.5, 0.9, 34, 12, '#e5e7eb'); } // Warmwasser
      if (L >= 7) { bush(c, ...P(0.2, 2.85), 0.6); bush(c, ...P(2.85, 0.5), 0.6); }
    },

    lumberjack(c, L) {
      const st = stageOf(L);
      shadow(c, 0.2, 0.2, 1.4, 1.4, 0.2);
      groundPatch(c, 0.08, 0.08, 1.92, 1.92, '#c7a77a');
      c.globalAlpha = 0.5;
      for (let i = 0; i < 10; i++) circle(c, ...P(0.2 + hash(i, 7) * 1.6, 0.2 + hash(i, 8) * 1.6), 1, '#f5deb3');
      c.globalAlpha = 1;
      const log = ['#a0673a', '#9a5f33', '#8f552c'][st];
      box(c, 0.2, 0.2, 1.3, 1.4, 0, 22, log);
      for (let z = 4; z < 22; z += 4.5) {
        line(c, P(0.2, 1.4, z), P(1.3, 1.4, z), shade(log, -0.4), 1);
        line(c, P(1.3, 1.4, z), P(1.3, 0.2, z), shade(log, -0.5), 1);
      }
      faceY(c, 1.4, 0.65, 0.95, 0, 15, '#4a2c14', OL);
      faceX(c, 1.3, 0.5, 0.85, 9, 16, '#fef3c7', OL);
      roofY(c, 0.2, 0.2, 1.3, 1.4, 22, 16, ['#5f7f3a', '#4d6b2f', '#3f5a28'][st], log, 0.16);
      box(c, 0.38, 0.45, 0.58, 0.65, 30, 14, '#78716c');
      // Holzstapel
      const piles = L >= 4 ? 2 : 1;
      for (let k = 0; k < piles; k++) {
        const y0 = 0.25 + k * 0.6;
        box(c, 1.45, y0, 1.85, y0 + 0.5, 0, 12 + st * 2, '#c08850');
        for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
          const q = P(1.85, y0 + 0.1 + i * 0.15, 3 + j * 6);
          circle(c, q[0], q[1] - 1, 2.6, '#e7c08b', '#7a4a21', 0.9);
        }
      }
      // Hackklotz mit Axt
      cylinder(c, 0.6, 1.7, 0.16, 0, 6, '#8b5a2b', '#d6a96b');
      const a = P(0.6, 1.7, 6);
      line(c, a, [a[0] + 6, a[1] - 10], '#7a4a21', 1.8);
      poly(c, [[a[0] + 4, a[1] - 9], [a[0] + 9, a[1] - 12], [a[0] + 8, a[1] - 7]], '#9ca3af', OL, 1);
      if (L >= 7) { box(c, 1.4, 1.5, 1.85, 1.62, 6, 2, '#b07a45'); }
    },

    campfire(c, L) {
      groundPatch(c, 0.08, 0.08, 1.92, 1.92, '#a6d17e', '#8fbf6a');
      ellipseG(c, 1, 1, 0.66, 0, '#e2cf9c', shade('#e2cf9c', -0.2));
      // Sitzbaumstämme
      const benches = L >= 7 ? 4 : L >= 4 ? 3 : 2;
      const spots = [[1, 0.25, 'x'], [0.25, 1, 'y'], [1.75, 1, 'y'], [1, 1.75, 'x']];
      for (let i = 0; i < benches; i++) {
        const [bx, by, ax] = spots[i];
        if (ax === 'x') { const a = P(bx - 0.35, by), b = P(bx + 0.35, by); line(c, [a[0], a[1] - 3], [b[0], b[1] - 3], '#5b3a1e', 7); line(c, [a[0], a[1] - 4], [b[0], b[1] - 4], '#9a6436', 5); }
        else { const a = P(bx, by - 0.35), b = P(bx, by + 0.35); line(c, [a[0], a[1] - 3], [b[0], b[1] - 3], '#5b3a1e', 7); line(c, [a[0], a[1] - 4], [b[0], b[1] - 4], '#9a6436', 5); }
      }
      // Steinkreis
      for (let i = 0; i < 11; i++) {
        const a = i / 11 * Math.PI * 2;
        const p = P(1 + Math.cos(a) * 0.32, 1 + Math.sin(a) * 0.32);
        c.beginPath(); c.ellipse(p[0], p[1] - 1.5, 3.4, 2.6, 0, 0, 7);
        c.fillStyle = i % 2 ? '#9ca3af' : '#a8a29e'; c.fill(); c.strokeStyle = OL; c.lineWidth = 0.9; c.stroke();
      }
      const p = P(1, 1);
      line(c, [p[0] - 7, p[1] + 1], [p[0] + 7, p[1] - 4], '#4a2c14', 3.2);
      line(c, [p[0] - 7, p[1] - 4], [p[0] + 7, p[1] + 1], '#5b3a1e', 3.2);
      if (L >= 6) { // Grillrost
        line(c, P(0.55, 1.45, 0), P(0.55, 1.45, 10), '#57534e', 1.2);
      }
      if (L >= 9) { bush(c, ...P(0.2, 0.2), 0.5, '#f59e0b'); }
    },

    kiosk(c, L) {
      const st = stageOf(L);
      const col = ['#fcd34d', '#f9a8d4', '#86efac'][st];
      const stripe = ['#ef4444', '#db2777', '#16a34a'][st];
      shadow(c, 0.3, 0.3, 1.7, 1.5, 0.2);
      groundPatch(c, 0.08, 0.08, 1.92, 1.92, '#e7dcc4');
      box(c, 0.3, 0.3, 1.7, 1.45, 0, 27, col);
      faceY(c, 1.45, 0.45, 1.55, 11, 22, '#3f2a1a', OL);
      box(c, 0.42, 1.45, 1.58, 1.62, 9, 3, '#f8fafc');
      box(c, 0.25, 0.25, 1.75, 1.5, 27, 3, '#f8fafc');
      for (let i = 0; i < 6; i++) {
        const xa = 0.25 + i * 0.25, xb = xa + 0.25;
        poly(c, [P(xa, 1.5, 28), P(xb, 1.5, 28), P(xb, 1.88, 21), P(xa, 1.88, 21)], i % 2 ? '#fff' : stripe, OL, 0.8);
      }
      // Eis-Schild
      const s = P(1, 0.9, 34);
      poly(c, [[s[0] - 5, s[1] - 6], [s[0] + 5, s[1] - 6], [s[0], s[1] + 7]], '#d4a056', OL, 1);
      circle(c, s[0], s[1] - 9, 6, '#f9a8d4', OL, 1.1);
      circle(c, s[0] - 2, s[1] - 11, 1.6, '#fff');
      if (L >= 3) {
        line(c, P(1.78, 1.78, 0), P(1.78, 1.78, 22), '#57534e', 1.2);
        const u = P(1.78, 1.78, 22);
        c.beginPath(); c.moveTo(u[0] - 12, u[1] + 4); c.quadraticCurveTo(u[0], u[1] - 10, u[0] + 12, u[1] + 4); c.closePath();
        c.fillStyle = stripe; c.fill(); c.strokeStyle = OL; c.lineWidth = 1; c.stroke();
      }
      if (L >= 6) { box(c, 0.08, 0.35, 0.25, 0.8, 0, 12, '#3b82f6'); } // Kühltruhe
    },

    playground(c, L) {
      groundPatch(c, 0.12, 0.12, 2.88, 2.88, '#f0dca0', '#b07a45');
      quad(c, 0.12, 0.12, 2.88, 2.88, 0, null, '#a0673a', 2.2);
      // Turm mit Rutsche
      box(c, 0.4, 0.4, 1.0, 1.0, 0, 24, '#c08850', { noTop: false });
      box(c, 0.35, 0.35, 1.05, 1.05, 24, 2, '#e9c38b');
      roofPyr(c, 0.4, 0.4, 1.0, 1.0, 26, 14, '#ef4444', 0.08);
      poly(c, [P(1.0, 0.5, 23), P(1.0, 0.9, 23), P(2.1, 0.9, 1), P(2.1, 0.5, 1)], '#facc15', OL);
      poly(c, [P(1.0, 0.9, 23), P(2.1, 0.9, 1), P(2.1, 0.9, 5), P(1.0, 0.9, 27)], '#eab308', OL, 1);
      // Schaukel
      const sx0 = 1.2, sx1 = 2.6, sy = 2.15;
      for (const x of [sx0, sx1]) {
        line(c, P(x, sy - 0.3, 0), P(x, sy, 30), '#2563eb', 2);
        line(c, P(x, sy + 0.3, 0), P(x, sy, 30), '#1d4ed8', 2);
      }
      line(c, P(sx0, sy, 30), P(sx1, sy, 30), '#1e40af', 2.4);
      for (const x of [1.6, 2.2]) {
        line(c, P(x - 0.1, sy, 30), P(x - 0.1, sy, 8), '#57534e', 1);
        line(c, P(x + 0.1, sy, 30), P(x + 0.1, sy, 8), '#57534e', 1);
        box(c, x - 0.14, sy - 0.08, x + 0.14, sy + 0.08, 7, 2, '#ef4444');
      }
      if (L >= 4) { // Wippe
        const a = P(0.5, 2.3, 8), b = P(1.1, 2.6, 3);
        line(c, P(0.8, 2.45, 0), P(0.8, 2.45, 6), '#57534e', 2);
        line(c, a, b, '#22c55e', 3);
      }
      if (L >= 6) { // Sandkasten
        box(c, 1.6, 1.15, 2.4, 1.6, 0, 3, '#b07a45', { top: '#f7e7b5' });
        circle(c, ...P(1.9, 1.35, 4), 2.2, '#3b82f6', OL, 0.8);
      }
      if (L >= 8) { bush(c, ...P(2.75, 0.3), 0.6); }
    },

    volleyball(c, L) {
      groundPatch(c, 0.08, 0.08, 3.92, 2.92, '#f2d38d', '#c9a25a');
      quad(c, 0.45, 0.4, 3.55, 2.6, 0, null, '#ffffff', 1.8);
      line(c, P(2, 0.4), P(2, 2.6), '#ffffff', 1.4);
      // Netz
      line(c, P(2, 0.3, 0), P(2, 0.3, 30), '#57534e', 2.4);
      poly(c, [P(2, 0.3, 18), P(2, 2.7, 18), P(2, 2.7, 29), P(2, 0.3, 29)], 'rgba(255,255,255,0.28)', '#f8fafc', 1.2);
      c.globalAlpha = 0.6;
      for (let y = 0.5; y < 2.7; y += 0.2) line(c, P(2, y, 18), P(2, y, 29), '#e5e7eb', 0.7);
      line(c, P(2, 0.3, 23.5), P(2, 2.7, 23.5), '#e5e7eb', 0.7);
      c.globalAlpha = 1;
      line(c, P(2, 2.7, 0), P(2, 2.7, 30), '#57534e', 2.4);
      if (L >= 3) { box(c, 0.2, 2.65, 1.2, 2.85, 5, 2, '#b07a45'); line(c, P(0.3, 2.85, 0), P(0.3, 2.85, 5), '#7a4a21'); line(c, P(1.1, 2.85, 0), P(1.1, 2.85, 5), '#7a4a21'); }
      if (L >= 5) { for (const p of [[0.2, 0.2], [3.8, 0.2]]) { line(c, P(p[0], p[1], 0), P(p[0], p[1], 28), '#57534e', 1.3); poly(c, [P(p[0], p[1], 28), P(p[0] + 0.3, p[1], 25), P(p[0], p[1], 22)], '#ef4444', OL, 1); } }
      if (L >= 7) { cylinder(c, 3.6, 2.6, 0.15, 0, 10, '#3b82f6'); }
    },

    lake(c, L) {
      groundPatch(c, 0.05, 0.05, 3.95, 3.95, '#86c95d', '#6fb04a');
      ellipseG(c, 2, 1.95, 1.9, 0, '#e3cf98', shade('#e3cf98', -0.25));
      ellipseG(c, 2, 1.95, 1.65, 0, '#3aa8de', '#2b7fb0', 1.5);
      ellipseG(c, 2, 1.95, 1.15, 0, '#2f95cf');
      ellipseG(c, 1.75, 1.7, 0.55, 0, 'rgba(255,255,255,0.12)');
      // Schilf
      for (let i = 0; i < 9; i++) {
        const a = Math.PI * (0.95 + i * 0.07);
        const p = P(2 + Math.cos(a) * 1.65, 1.95 + Math.sin(a) * 1.65);
        line(c, p, [p[0] + (hash(i, 3) - 0.5) * 4, p[1] - 12 - hash(i, 4) * 6], '#3f8f2f', 1.4);
        if (i % 3 === 0) { c.fillStyle = '#7a4a21'; rr(c, p[0] - 1.2, p[1] - 14, 2.4, 5, 1); c.fill(); }
      }
      // Seerosen
      for (const [x, y] of [[1.2, 2.5], [2.7, 1.2], [2.9, 1.5]]) {
        const p = P(x, y);
        c.beginPath(); c.ellipse(p[0], p[1], 4, 2, 0, 0.3, Math.PI * 2 - 0.3); c.lineTo(p[0], p[1]); c.closePath();
        c.fillStyle = '#4ade80'; c.fill();
      }
      circle(c, ...P(2.75, 1.25), 1.4, '#f9a8d4');
      // Steg
      box(c, 1.78, 2.25, 2.22, 3.95, 3, 3, '#c48a52');
      c.globalAlpha = 0.35;
      for (let y = 2.4; y < 3.95; y += 0.2) line(c, P(1.78, y, 6), P(2.22, y, 6), '#6b3f1d', 0.9);
      c.globalAlpha = 1;
      for (const y of [2.3, 3.1]) { line(c, P(2.22, y, -4), P(2.22, y, 8), '#6b3f1d', 2); line(c, P(1.78, y, -4), P(1.78, y, 8), '#6b3f1d', 2); }
      if (L >= 5) { // Ruderboot
        const p = P(2.6, 2.75);
        c.beginPath(); c.ellipse(p[0], p[1] - 1, 11, 4.5, -0.45, 0, Math.PI * 2);
        c.fillStyle = '#b45309'; c.fill(); c.strokeStyle = OL; c.lineWidth = 1.1; c.stroke();
        c.beginPath(); c.ellipse(p[0], p[1] - 2, 8, 2.6, -0.45, 0, Math.PI * 2); c.fillStyle = '#7c2d12'; c.fill();
      }
      if (L >= 7) { box(c, 0.2, 3.3, 0.9, 3.5, 5, 2, '#b07a45'); }
      if (L >= 3) { bush(c, ...P(3.7, 0.4), 0.7); }
      if (L >= 9) { bush(c, ...P(0.35, 0.5), 0.8, '#3f9a35'); }
    },

    pool(c, L) {
      const st = stageOf(L);
      box(c, 0.05, 0.05, 3.95, 3.95, 0, 4, '#e7e5e4');
      c.globalAlpha = 0.25;
      for (let i = 0.5; i < 3.95; i += 0.45) { line(c, P(i, 0.05, 4), P(i, 3.95, 4), '#a8a29e', 0.8); line(c, P(0.05, i, 4), P(3.95, i, 4), '#a8a29e', 0.8); }
      c.globalAlpha = 1;
      const x0 = 0.55, y0 = 0.55, x1 = 3.45, y1 = 3.0;
      poly(c, [P(x0, y0, 4), P(x1, y0, 4), P(x1, y0, -8), P(x0, y0, -8)], '#7dd3fc', OL, 1);
      poly(c, [P(x0, y0, 4), P(x0, y1, 4), P(x0, y1, -8), P(x0, y0, -8)], '#38bdf8', OL, 1);
      quad(c, x0, y0, x1, y1, -2, ['#22d3ee', '#2dd4bf', '#38bdf8'][st]);
      c.globalAlpha = 0.25;
      quad(c, x0 + 0.1, y0 + 0.1, x1 - 0.8, y1 - 0.9, -2, '#ffffff');
      c.globalAlpha = 1;
      quad(c, x0, y0, x1, y1, 4, null, '#f5f5f4', 2.2);
      // Leiter
      for (const dx of [0, 0.22]) line(c, P(3.0 + dx, y1, 4), P(3.0 + dx, y1 + 0.12, 13), '#cbd5e1', 1.6);
      // Liegestühle
      for (let i = 0; i < (L >= 4 ? 3 : 2); i++) {
        const xa = 0.4 + i * 0.85;
        poly(c, [P(xa, 3.3, 5), P(xa + 0.55, 3.3, 5), P(xa + 0.55, 3.75, 8), P(xa, 3.75, 8)], '#f8fafc', OL, 1);
        poly(c, [P(xa, 3.3, 5), P(xa + 0.55, 3.3, 5), P(xa + 0.55, 3.22, 14), P(xa, 3.22, 14)], ['#f97316', '#3b82f6', '#ec4899'][i], OL, 1);
      }
      // Sonnenschirm
      line(c, P(3.6, 3.55, 4), P(3.6, 3.55, 32), '#57534e', 1.4);
      const u = P(3.6, 3.55, 32);
      c.beginPath(); c.moveTo(u[0] - 15, u[1] + 5); c.quadraticCurveTo(u[0], u[1] - 12, u[0] + 15, u[1] + 5); c.closePath();
      c.fillStyle = ['#ef4444', '#f59e0b', '#8b5cf6'][st]; c.fill(); c.strokeStyle = OL; c.lineWidth = 1.1; c.stroke();
      if (L >= 5) { box(c, 1.4, 0.2, 1.8, 0.85, 4, 4, '#60a5fa'); poly(c, [P(1.45, 0.85, 8), P(1.75, 0.85, 8), P(1.75, 1.3, 9), P(1.45, 1.3, 9)], '#f8fafc', OL, 1); }
      if (L >= 8) { // Rutsche
        box(c, 0.1, 0.1, 0.45, 0.45, 4, 26, '#e5e7eb');
        c.beginPath(); const a = P(0.45, 0.3, 28), b = P(1.0, 0.6, 14), e = P(0.8, 1.2, 0);
        c.moveTo(a[0], a[1]); c.quadraticCurveTo(b[0] + 20, b[1], e[0], e[1]);
        c.strokeStyle = '#facc15'; c.lineWidth = 5; c.stroke();
      }
    },

    path(c, L, v) {
      const m = v || 0;
      const col = '#e2c690';
      quad(c, 0, 0, 1, 1, 0, col);
      const ed = shade(col, -0.18);
      // Kanten nur zu Nicht-Weg-Nachbarn
      if (!(m & 1)) line(c, P(1, 0), P(1, 1), ed, 1.6);
      if (!(m & 2)) line(c, P(0, 0), P(0, 1), ed, 1.6);
      if (!(m & 4)) line(c, P(0, 1), P(1, 1), ed, 1.6);
      if (!(m & 8)) line(c, P(0, 0), P(1, 0), ed, 1.6);
      c.globalAlpha = 0.55;
      for (let i = 0; i < 4; i++) circle(c, ...P(0.2 + hash(i, m, 5) * 0.6, 0.2 + hash(i, m, 6) * 0.6), 1.4, '#c7a874');
      c.globalAlpha = 1;
    },

    tree(c) {
      const p = P(0.5, 0.5);
      c.globalAlpha = 0.2; c.beginPath(); c.ellipse(p[0] + 4, p[1], 15, 7, 0, 0, 7); c.fillStyle = '#1f3a10'; c.fill(); c.globalAlpha = 1;
      c.fillStyle = '#7a4a21'; rr(c, p[0] - 3, p[1] - 24, 6, 24, 2); c.fill(); c.strokeStyle = OL; c.lineWidth = 1.1; c.stroke();
      circle(c, p[0] - 9, p[1] - 30, 11, '#3f9a35', OL);
      circle(c, p[0] + 9, p[1] - 31, 11, '#378a2e', OL);
      circle(c, p[0], p[1] - 42, 14, '#4caf3f', OL);
      circle(c, p[0] - 5, p[1] - 47, 5, '#6cc95a');
      circle(c, p[0] + 6, p[1] - 34, 2.4, '#ef4444');
      circle(c, p[0] - 8, p[1] - 28, 2.4, '#ef4444');
    },

    flowers(c) {
      quad(c, 0.12, 0.12, 0.88, 0.88, 0, '#7b4a26', '#5b3519', 1.2);
      const cols = ['#f43f5e', '#facc15', '#ffffff', '#a855f7', '#fb923c'];
      for (let i = 0; i < 9; i++) {
        const p = P(0.22 + hash(i, 1, 9) * 0.56, 0.22 + hash(i, 2, 9) * 0.56);
        line(c, p, [p[0], p[1] - 5], '#2f7d32', 1.2);
        const col = cols[i % cols.length];
        for (let k = 0; k < 4; k++) circle(c, p[0] + Math.cos(k * 1.57) * 2, p[1] - 6 + Math.sin(k * 1.57) * 2, 1.7, col);
        circle(c, p[0], p[1] - 6, 1.2, '#fde047');
      }
    },

    fence(c, L, m) {
      m = m || 0;
      const post = (x, y) => box(c, x - 0.06, y - 0.06, x + 0.06, y + 0.06, 0, 18, '#a8743f');
      const rail = (x0, y0, x1, y1) => {
        for (const z of [7, 14]) {
          const a = P(x0, y0, z), b = P(x1, y1, z);
          line(c, a, b, '#5b3a1e', 3.4); line(c, a, b, '#c08850', 2);
        }
      };
      if (!m) { rail(0.1, 0.5, 0.9, 0.5); post(0.1, 0.5); post(0.9, 0.5); return; }
      if (m & 8) rail(0.5, 0.5, 0.5, 0);    // hinten rechts (y-1)
      if (m & 2) rail(0.5, 0.5, 0, 0.5);    // hinten links (x-1)
      post(0.5, 0.5);
      if (m & 1) rail(0.5, 0.5, 1, 0.5);    // vorne rechts (x+1)
      if (m & 4) rail(0.5, 0.5, 0.5, 1);    // vorne links (y+1)
    },

    bench(c) {
      box(c, 0.2, 0.42, 0.8, 0.62, 6, 2, '#b07a45');
      box(c, 0.2, 0.36, 0.8, 0.42, 8, 8, '#9a6436');
      for (const x of [0.25, 0.75]) { line(c, P(x, 0.62, 0), P(x, 0.62, 6), '#3f3f46', 1.6); line(c, P(x, 0.42, 0), P(x, 0.42, 6), '#3f3f46', 1.6); }
    },

    lantern(c) {
      const p = P(0.5, 0.5);
      c.globalAlpha = 0.2; c.beginPath(); c.ellipse(p[0], p[1], 6, 3, 0, 0, 7); c.fillStyle = '#000'; c.fill(); c.globalAlpha = 1;
      c.fillStyle = '#334155'; rr(c, p[0] - 3, p[1] - 4, 6, 4, 1); c.fill();
      line(c, [p[0], p[1] - 2], [p[0], p[1] - 34], '#334155', 2.2);
      c.fillStyle = '#fde68a'; rr(c, p[0] - 4, p[1] - 42, 8, 9, 2); c.fill(); c.strokeStyle = '#1f2937'; c.lineWidth = 1.4; c.stroke();
      poly(c, [[p[0] - 6, p[1] - 42], [p[0] + 6, p[1] - 42], [p[0], p[1] - 47]], '#1f2937');
    },

    // ---- Bedürfnis-Gebäude: sport ----
    // Tischtennisplatte (2×2)
    tabletennis(c, L) {
      const st = stageOf(L);
      const top = ['#2f8a57', '#2563eb', '#1e40af'][st];
      const pave = ['#d6d0c4', '#d8d2c6', '#c8614f'][st];
      shadow(c, 0.2, 0.2, 1.8, 1.8, 0.1);
      groundPatch(c, 0.1, 0.1, 1.9, 1.9, pave);
      if (st < 2) { // Betonplatten bzw. Pflaster
        const step = st ? 0.3 : 0.45;
        c.globalAlpha = 0.35;
        for (let v = 0.1 + step; v < 1.88; v += step) {
          line(c, P(v, 0.1), P(v, 1.9), shade(pave, -0.3), 0.9);
          line(c, P(0.1, v), P(1.9, v), shade(pave, -0.3), 0.9);
        }
        c.globalAlpha = 1;
        quad(c, 0.1, 0.1, 1.9, 1.9, 0, null, st ? '#a8a29e' : '#9c958a', st ? 2.4 : 2.8);
      } else { // Kunststoffbelag mit Linie
        quad(c, 0.24, 0.24, 1.76, 1.76, 0, null, '#fde7e1', 1.2);
      }
      // Sonnenschirm hinten
      if (L >= 7) {
        line(c, P(0.24, 0.24, 0), P(0.24, 0.24, 27), '#57534e', 1.5);
      }
      // Wimpelkette
      if (L >= 9) {
        line(c, P(0.16, 1.62, 0), P(0.16, 1.62, 22), '#57534e', 1.3);
        const a = P(0.24, 0.24, 24), b = P(0.16, 1.62, 22);
        const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 7];
        c.beginPath(); c.moveTo(a[0], a[1]); c.quadraticCurveTo(m[0], m[1], b[0], b[1]);
        c.strokeStyle = '#57534e'; c.lineWidth = 0.8; c.stroke();
        const cols = ['#ef4444', '#facc15', '#3b82f6', '#22c55e', '#f97316'];
        for (let i = 1; i < 7; i++) {
          const u = i / 7, w = 1 - u;
          const qx = w * w * a[0] + 2 * w * u * m[0] + u * u * b[0], qy = w * w * a[1] + 2 * w * u * m[1] + u * u * b[1];
          poly(c, [[qx - 2.2, qy], [qx + 2.2, qy], [qx, qy + 4.5]], cols[i % 5]);
        }
      }
      // Bank hinten
      if (L >= 3) {
        for (const x of [0.66, 1.34]) { line(c, P(x, 0.2, 0), P(x, 0.2, 5), '#57534e', 1.4); line(c, P(x, 0.34, 0), P(x, 0.34, 5), '#57534e', 1.4); }
        box(c, 0.56, 0.12, 1.44, 0.17, 6, 6, '#9a6436');
        box(c, 0.56, 0.17, 1.44, 0.36, 5, 2, '#b07a45');
      }
      const x0 = 0.34, x1 = 1.66, y0 = 0.62, y1 = 1.38, zt = 11, th = st ? 3 : 4;
      const leg = ['#a8a29e', '#64748b', '#334155'][st];
      c.globalAlpha = 0.18; quad(c, x0 + 0.12, y0 + 0.06, x1 + 0.12, y1 + 0.06, 0, '#1f3a10'); c.globalAlpha = 1;
      // Füße
      if (st === 0) {
        box(c, 0.56, 0.8, 0.75, 1.2, 0, zt, leg);
        box(c, 1.25, 0.8, 1.44, 1.2, 0, zt, leg);
      } else {
        for (const x of [0.5, 1.5]) for (const y of [0.72, 1.28]) line(c, P(x, y, 0), P(x, y, zt), leg, 2);
        line(c, P(0.5, 1.28, 3), P(1.5, 1.28, 3), leg, 1.4);
      }
      // Platte
      box(c, x0, y0, x1, y1, zt, th, top, st ? null : { left: '#c4bdb1', right: '#a39b8e' });
      const zz = zt + th;
      quad(c, x0 + 0.04, y0 + 0.04, x1 - 0.04, y1 - 0.04, zz, null, '#ffffff', 1.1);
      line(c, P(x0 + 0.04, 1, zz), P(x1 - 0.04, 1, zz), '#ffffff', 0.8);
      if (st === 2) { c.globalAlpha = 0.18; quad(c, x0 + 0.1, y0 + 0.08, 0.85, y1 - 0.2, zz, '#ffffff'); c.globalAlpha = 1; }
      const paddle = (x, y, col, a) => {
        const p = P(x, y, zz), h = P(x + Math.cos(a) * 0.14, y + Math.sin(a) * 0.14, zz);
        line(c, p, h, '#8a5a2b', 2.2);
        c.beginPath(); c.ellipse(p[0], p[1], 4.4, 2.7, 0, 0, 7);
        c.fillStyle = col; c.fill(); c.strokeStyle = OL; c.lineWidth = 0.9; c.stroke();
      };
      paddle(0.6, 0.85, '#dc2626', Math.PI);
      // Netz
      const ny0 = y0 - 0.06, ny1 = y1 + 0.06;
      line(c, P(1, ny0, zz - 3), P(1, ny0, zz + 5), '#1f2937', 1.5);
      poly(c, [P(1, ny0, zz), P(1, ny1, zz), P(1, ny1, zz + 5), P(1, ny0, zz + 5)], 'rgba(30,41,59,0.45)');
      c.globalAlpha = 0.5;
      for (let y = ny0 + 0.08; y < ny1; y += 0.08) line(c, P(1, y, zz), P(1, y, zz + 5), '#0f172a', 0.6);
      c.globalAlpha = 1;
      line(c, P(1, ny0, zz + 5), P(1, ny1, zz + 5), '#f8fafc', 1.4);
      line(c, P(1, ny1, zz - 3), P(1, ny1, zz + 5), '#1f2937', 1.5);
      paddle(1.42, 1.14, '#1f2937', 0.35);
      // Schirmdach
      if (L >= 7) {
        const u = P(0.24, 0.24, 27);
        c.beginPath(); c.moveTo(u[0] - 15, u[1] + 5); c.quadraticCurveTo(u[0], u[1] - 9, u[0] + 15, u[1] + 5); c.closePath();
        c.fillStyle = st === 2 ? '#f59e0b' : '#ef4444'; c.fill(); c.strokeStyle = OL; c.lineWidth = 1.1; c.stroke();
        c.beginPath(); c.moveTo(u[0] - 5, u[1] + 5); c.quadraticCurveTo(u[0], u[1] - 7, u[0] + 5, u[1] + 5); c.closePath();
        c.fillStyle = '#fff7ed'; c.fill();
      }
      // Anzeigetafel
      if (L >= 9) {
        for (const x of [0.2, 0.58]) line(c, P(x, 1.8, 0), P(x, 1.8, 9), '#57534e', 1.4);
        box(c, 0.14, 1.74, 0.64, 1.82, 8, 11, '#1f2937');
        faceY(c, 1.82, 0.19, 0.37, 10, 17, '#f8fafc', OL);
        faceY(c, 1.82, 0.41, 0.59, 10, 17, '#f8fafc', OL);
        const p = P(0.28, 1.82, 13.5), q = P(0.5, 1.82, 13.5);
        c.fillStyle = '#1f2937'; c.font = 'bold 8px ui-rounded, system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText('9', p[0], p[1] + 0.5); c.fillText('7', q[0], q[1] + 0.5);
      }
      if (L >= 5) bush(c, ...P(1.82, 0.3), 0.55);
      if (L >= 10) bush(c, ...P(1.8, 1.82), 0.5, '#f472b6');
    },

    // Bolzplatz (4×3)
    soccer(c, L) {
      const st = stageOf(L);
      const turf = ['#54a043', '#4a9d3c', '#3f9a3c'][st];
      const g0 = st === 2 ? 0.17 : 0.06;
      shadow(c, 0.1, 0.1, 3.9, 2.9, 0.1);
      if (st === 2) groundPatch(c, 0.04, 0.04, 3.96, 2.96, '#c8614f');
      groundPatch(c, g0, g0, 4 - g0, 3 - g0, turf);
      // Mähstreifen
      const sw = (4 - 2 * g0) / 10;
      c.globalAlpha = st ? 0.9 : 0.5;
      for (let i = 1; i < 10; i += 2) quad(c, g0 + i * sw, g0 + 0.02, g0 + (i + 1) * sw, 3 - g0 - 0.02, 0, shade(turf, L >= 9 ? 0.16 : 0.12));
      c.globalAlpha = 1;
      if (st === 0) { // ausgetretene Stellen
        c.globalAlpha = 0.75;
        ellipseG(c, 0.62, 1.5, 0.26, 0, '#c9b27a');
        ellipseG(c, 3.38, 1.5, 0.26, 0, '#c9b27a');
        ellipseG(c, 2.1, 1.45, 0.2, 0, '#c9b27a');
        c.globalAlpha = 1;
      }
      // Linien
      const lx0 = 0.34, lx1 = 3.66, ly0 = 0.3, ly1 = 2.7;
      c.globalAlpha = st ? 0.95 : 0.8;
      quad(c, lx0, ly0, lx1, ly1, 0, null, '#ffffff', 1.4);
      line(c, P(2, ly0), P(2, ly1), '#ffffff', 1.3);
      ellipseG(c, 2, 1.5, 0.42, 0, null, '#ffffff', 1.3);
      quad(c, lx0, 0.9, 0.86, 2.1, 0, null, '#ffffff', 1.2);
      quad(c, 3.14, 0.9, lx1, 2.1, 0, null, '#ffffff', 1.2);
      circle(c, ...P(2, 1.5), 1.6, '#ffffff');
      c.globalAlpha = 1;
      // Ballfangnetz & Zaun hinten
      if (L >= 7) {
        const nz = 24;
        poly(c, [P(0.08, 0.25, 0), P(0.08, 2.75, 0), P(0.08, 2.75, nz), P(0.08, 0.25, nz)], 'rgba(255,255,255,0.12)');
        c.globalAlpha = 0.35;
        for (let y = 0.45; y < 2.75; y += 0.2) line(c, P(0.08, y, 0), P(0.08, y, nz), '#f1f5f9', 0.6);
        for (let z = 4; z < nz; z += 4) line(c, P(0.08, 0.25, z), P(0.08, 2.75, z), '#f1f5f9', 0.6);
        c.globalAlpha = 1;
        line(c, P(0.08, 0.25, nz), P(0.08, 2.75, nz), '#475569', 1.2);
        for (const y of [0.25, 1.5, 2.75]) line(c, P(0.08, y, 0), P(0.08, y, nz + 1), '#475569', 1.8);
        for (let x = 0.3; x < 3.95; x += 0.45) box(c, x - 0.03, 0.04, x + 0.03, 0.1, 0, 10, '#a8743f', { ol: null });
        for (const z of [4, 8]) { const a = P(0.25, 0.07, z), b = P(3.95, 0.07, z); line(c, a, b, '#5b3a1e', 2.6); line(c, a, b, '#c08850', 1.4); }
        // Anzeigetafel
        for (const x of [1.15, 1.65]) line(c, P(x, 0.12, 0), P(x, 0.12, 17), '#475569', 1.6);
        box(c, 1.05, 0.08, 1.75, 0.15, 16, 14, '#1f2937');
        const s = P(1.4, 0.15, 23);
        c.fillStyle = '#fde047'; c.font = 'bold 8px ui-rounded, system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText('2:1', s[0], s[1] + 0.5);
      }
      // Zuschauerbank
      if (L >= 3) {
        const xa = 2.35, xb = 3.45;
        for (const x of [xa + 0.1, xb - 0.1]) line(c, P(x, 0.2, 0), P(x, 0.2, 5), '#57534e', 1.4);
        box(c, xa, 0.08, xb, 0.12, 6, 7, '#9a6436');
        box(c, xa, 0.12, xb, 0.24, 5, 2, '#b07a45');
      }
      // Tore
      const goal = (xg, dir) => {
        const ya = 1.14, yb = 1.86, h = 15, xb = xg + dir * 0.26, hb = 9;
        const net = 'rgba(255,255,255,0.3)';
        const frame = () => {
          const seg = [[P(xg, ya, 0), P(xg, ya, h)], [P(xg, yb, 0), P(xg, yb, h)], [P(xg, ya, h), P(xg, yb, h)]];
          for (const s of seg) line(c, s[0], s[1], OL, 3.6);
          for (const s of seg) line(c, s[0], s[1], st === 2 ? '#ffffff' : '#f1f5f9', 2.1);
        };
        const mesh = () => {
          poly(c, [P(xb, ya, 0), P(xb, yb, 0), P(xb, yb, hb), P(xb, ya, hb)], net, '#e2e8f0', 0.8);
          poly(c, [P(xg, ya, 0), P(xg, ya, h), P(xb, ya, hb), P(xb, ya, 0)], net, '#e2e8f0', 0.8);
          poly(c, [P(xg, ya, h), P(xg, yb, h), P(xb, yb, hb), P(xb, ya, hb)], net, '#e2e8f0', 0.8);
          poly(c, [P(xg, yb, 0), P(xg, yb, h), P(xb, yb, hb), P(xb, yb, 0)], net, '#e2e8f0', 0.8);
          c.globalAlpha = 0.6;
          for (let k = 1; k < 6; k++) {
            const y = ya + (yb - ya) * k / 6;
            line(c, P(xg, y, h), P(xb, y, hb), '#f8fafc', 0.6);
            line(c, P(xb, y, hb), P(xb, y, 0), '#f8fafc', 0.6);
          }
          for (const z of [3, 6]) line(c, P(xb, ya, z), P(xb, yb, z), '#f8fafc', 0.6);
          c.globalAlpha = 1;
        };
        if (dir < 0) { mesh(); frame(); } else { frame(); mesh(); }
      };
      // Flutlicht
      const flood = (x, y) => {
        const b0 = P(x, y, 0), t0 = P(x, y, 33);
        line(c, b0, t0, OL, 3.8); line(c, b0, t0, '#94a3b8', 2.2);
        c.fillStyle = '#334155'; rr(c, t0[0] - 7.5, t0[1] - 8, 15, 9, 1.8); c.fill(); c.strokeStyle = OL; c.lineWidth = 1; c.stroke();
        for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) circle(c, t0[0] - 4.5 + i * 4.5, t0[1] - 5.6 + j * 3.6, 1.45, '#fef9c3');
      };
      // einfache Laterne (vor dem Flutlicht)
      const lamp = (x, y) => {
        const b0 = P(x, y, 0), t0 = P(x, y, 31);
        line(c, b0, t0, '#334155', 2);
        c.fillStyle = '#fde68a'; rr(c, t0[0] - 3, t0[1] - 6, 6, 7, 1.5); c.fill(); c.strokeStyle = '#1f2937'; c.lineWidth = 1.2; c.stroke();
        poly(c, [[t0[0] - 4.5, t0[1] - 6], [t0[0] + 4.5, t0[1] - 6], [t0[0], t0[1] - 10]], '#1f2937');
      };
      const flag = (x, y, col) => {
        line(c, P(x, y, 0), P(x, y, 13), '#f8fafc', 1.2);
        poly(c, [P(x, y, 13), P(x + 0.16, y - 0.08, 11), P(x, y, 9)], col, OL, 0.8);
      };
      if (L >= 9) flag(lx0, ly0, '#facc15');
      if (L >= 4) { // Trainingshütchen
        for (let i = 0; i < 4; i++) {
          const q = P(2.45 + i * 0.28, 0.58);
          poly(c, [[q[0] - 2.6, q[1]], [q[0] + 2.6, q[1]], [q[0], q[1] - 6]], '#f97316', OL, 0.8);
          line(c, [q[0] - 1.3, q[1] - 3], [q[0] + 1.3, q[1] - 3], '#ffffff', 1);
        }
      }
      goal(lx0, -1);
      for (const [x, y] of [[0.12, 2.88], [3.88, 0.12]]) { if (L >= 5) flood(x, y); else lamp(x, y); }
      if (L >= 9) { flag(lx1, ly0, '#ef4444'); flag(lx0, ly1, '#ef4444'); }
      // Reserveball
      const bp = P(0.6, 2.5, 2.6);
      circle(c, bp[0], bp[1], 2.7, '#ffffff', OL, 1);
      circle(c, bp[0] + 0.4, bp[1] - 0.3, 1, '#1f2937');
      goal(lx1, 1);
      if (L >= 9) flag(lx1, ly1, '#facc15');
    },

    // Kletterturm (2×2)
    climbing(c, L) {
      const st = stageOf(L);
      const x0 = 0.5, x1 = 1.5, y0 = 0.5, y1 = 1.5, H = 66;
      const gcol = ['#b98a5e', '#e6cf98', '#4f9e9a'][st];
      shadow(c, 0.35, 0.35, 1.75, 1.75, 0.3);
      groundPatch(c, 0.08, 0.08, 1.92, 1.92, gcol);
      c.globalAlpha = 0.45;
      for (let i = 0; i < 16; i++) circle(c, ...P(0.15 + hash(i, 3, 21) * 1.7, 0.15 + hash(i, 4, 21) * 1.7), 1.1, shade(gcol, st === 1 ? -0.2 : -0.28));
      c.globalAlpha = 1;
      // Turmkörper
      if (st === 0) {
        box(c, x0, y0, x1, y1, 0, H, '#c08850');
        c.globalAlpha = 0.28;
        for (let z = 6; z < H; z += 6) { line(c, P(x0, y1, z), P(x1, y1, z), '#6b3f1d', 1); line(c, P(x1, y1, z), P(x1, y0, z), '#6b3f1d', 1); }
        c.globalAlpha = 1;
        faceY(c, y1, x0, x0 + 0.07, 0, H, '#8a5a2b', OL);
        faceX(c, x1, y0, y0 + 0.07, 0, H, '#7a4a21', OL);
        poly(c, [P(x1 - 0.07, y1, 0), P(x1, y1, 0), P(x1, y1 - 0.07, 0), P(x1, y1 - 0.07, H), P(x1, y1, H), P(x1 - 0.07, y1, H)], '#9a6436', OL, 1.1);
      } else {
        const frame = st === 1 ? '#475569' : '#1e293b';
        box(c, x0, y0, x1, y1, 0, H, frame);
        // Stufe 2: nur zwei ruhige Töne im Schachbrett
        const pal = st === 1 ? ['#38bdf8', '#2dd4bf', '#60a5fa', '#34d399'] : ['#42a69c', '#6577a6'];
        const rows = 4, ph = (H - 4) / rows;
        for (let r = 0; r < rows; r++) for (let k = 0; k < 2; k++) {
          const za = 2 + r * ph + 1, zb = 2 + (r + 1) * ph - 1;
          const ia = st === 1 ? r * 2 + k : r + k;
          const ca = pal[ia % pal.length], cb = pal[(ia + 1) % pal.length];
          faceY(c, y1, x0 + 0.04 + k * 0.48, x0 + 0.48 + k * 0.48, za, zb, shade(ca, -0.06), OL);
          faceX(c, x1, y0 + 0.04 + k * 0.48, y0 + 0.48 + k * 0.48, za, zb, shade(cb, -0.24), OL);
        }
      }
      // Überhang
      if (L >= 7) {
        const ya = 0.58, yb = 1.22, za = 34, zb = 52, o = 0.2;
        poly(c, [P(x1, yb, za), P(x1, ya, za), P(x1 + o, ya, zb), P(x1 + o, yb, zb)], '#f97316', OL, 1.2);
        poly(c, [P(x1, yb, za), P(x1 + o, yb, zb), P(x1, yb, zb)], '#c2410c', OL, 1.1);
        poly(c, [P(x1, ya, zb), P(x1, yb, zb), P(x1 + o, yb, zb), P(x1 + o, ya, zb)], '#fdba74', OL, 1.1);
      }
      // Griffe
      // Stufe 2: warme Griffe, damit sie auf Türkis/Schieferblau lesbar bleiben
      const hc = st === 2 ? ['#facc15', '#f97316', '#fef3c7', '#ef4444', '#fbbf24', '#fb7185', '#fde68a'] : ['#ef4444', '#facc15', '#22c55e', '#3b82f6', '#a855f7', '#f97316', '#ec4899'];
      const n = [9, 10, 13][st];
      for (let i = 0; i < n; i++) {
        const z = 7 + (i + 0.5) * (H - 14) / n + (hash(i, 1, 33) - 0.5) * 4;
        const r = 1.7 + hash(i, 2, 33) * 1.2 + (st === 2 && i % 6 === 0 ? 1.2 : 0);
        const pl = P(x0 + 0.1 + hash(i, 3, 33) * 0.8, y1, z);
        circle(c, pl[0], pl[1], r, hc[i % 7], OL, 0.8);
        let xr = y0 + 0.1 + hash(i, 4, 33) * 0.8;
        let pr = P(x1, xr, z);
        if (L >= 7 && z > 34 && z < 52 && xr > 0.6 && xr < 1.2) pr = P(x1 + (z - 34) / 18 * 0.2, xr, z);
        circle(c, pr[0], pr[1], r, shade(hc[(i + 3) % 7], -0.15), OL, 0.8);
      }
      // Plattform
      const deck = ['#a0673a', '#b07a45', '#64748b'][st];
      const rail = ['#7a4a21', '#f8fafc', '#facc15'][st];
      const pa = x0 - 0.12, pb = x1 + 0.12, zp = H + 4, zr = zp + 10;
      const roof = L >= 9, zt = roof ? zr + 1 : zr;
      box(c, pa, pa, pb, pb, H, 4, deck);
      // Fahne (hinten)
      if (!roof) {
        line(c, P(pa + 0.04, pa + 0.04, zp), P(pa + 0.04, pa + 0.04, 92), '#57534e', 1.5);
        poly(c, [P(pa + 0.04, pa + 0.04, 91), P(pa + 0.34, pa + 0.04, 86), P(pa + 0.04, pa + 0.04, 81)], ['#ef4444', '#22c55e', '#8b5cf6'][st], OL, 1);
      }
      const rl = (a, b) => { line(c, a, b, OL, 2.8); line(c, a, b, rail, 1.6); };
      // Geländer hinten
      rl(P(pa, pa, zr), P(pb, pa, zr)); rl(P(pa, pa, zr), P(pa, pb, zr));
      for (const [x, y] of [[pa, pa], [pb, pa], [pa, pb]]) rl(P(x, y, zp), P(x, y, zt));
      // Geländer vorn
      c.globalAlpha = 0.5;
      for (let v = pa + 0.15; v < pb; v += 0.15) { line(c, P(v, pb, zp), P(v, pb, zr), rail, 1); line(c, P(pb, v, zp), P(pb, v, zr), rail, 1); }
      c.globalAlpha = 1;
      rl(P(pa, pb, zr), P(pb, pb, zr)); rl(P(pb, pa, zr), P(pb, pb, zr));
      rl(P(pb, pb, zp), P(pb, pb, zt));
      // Laterne am Eckpfosten
      const lp = P(pb + 0.03, pb + 0.03, zp + 1);
      c.fillStyle = '#fde68a'; rr(c, lp[0] - 2.5, lp[1] - 7, 5, 6, 1.5); c.fill(); c.strokeStyle = '#1f2937'; c.lineWidth = 1; c.stroke();
      // Spitzdach
      if (roof) {
        const o = 0.08, rc = '#f97316';
        const N = P(pa - o, pa - o, zt), E = P(pb + o, pa - o, zt), S = P(pb + o, pb + o, zt), Wc = P(pa - o, pb + o, zt), A = P(1, 1, zt + 7);
        poly(c, [N, E, A], shade(rc, 0.12), OL);
        poly(c, [Wc, N, A], shade(rc, 0.22), OL);
        poly(c, [Wc, S, A], rc, OL);
        poly(c, [S, E, A], shade(rc, -0.25), OL);
        line(c, [(Wc[0] + S[0]) / 2, (Wc[1] + S[1]) / 2], A, '#fff7ed', 1.4);
        line(c, [(S[0] + E[0]) / 2, (S[1] + E[1]) / 2], A, '#fed7aa', 1.4);
        circle(c, A[0], A[1] - 1.5, 1.9, '#facc15', OL, 0.9);
      }
      // Seilausleger & Seil
      box(c, 1.08, y1 + 0.05, 1.16, y1 + 0.22, H - 4, 3, '#57534e');
      line(c, P(1.12, y1 + 0.2, H - 4), P(1.12, y1 + 0.2, 6), '#f97316', 1.3);
      if (L >= 5) { // zweites Seil rechts
        box(c, x1 + 0.05, 1.32, x1 + 0.22, 1.4, H - 4, 3, '#57534e');
        line(c, P(x1 + 0.2, 1.36, H - 4), P(x1 + 0.2, 1.36, 6), '#e11d48', 1.3);
      }
      // Helmkiste
      if (L >= 3) {
        box(c, 1.62, 0.1, 1.9, 0.3, 0, 7, '#b07a45');
        const hc = ['#ef4444', '#facc15', '#3b82f6'];
        for (let i = 0; i < (L >= 6 ? 3 : 2); i++) {
          const q = P(1.68 + i * 0.1, 0.2 - i * 0.03, 7);
          c.beginPath(); c.arc(q[0], q[1], 2.6, Math.PI, 0); c.closePath();
          c.fillStyle = hc[i]; c.fill(); c.strokeStyle = OL; c.lineWidth = 0.8; c.stroke();
        }
      }
      // Matten
      const mat = st === 2 ? ['#dc2626', '#ef4444'] : ['#2563eb', '#3b82f6'];
      box(c, x1 + 0.04, 0.36, 1.92, y1, 0, 4, mat[0]);
      box(c, 0.36, y1 + 0.04, 1.92, 1.92, 0, 4, mat[1]);
      c.globalAlpha = 0.35;
      line(c, P(1.0, y1 + 0.04, 4), P(1.0, 1.92, 4), '#0f172a', 1);
      line(c, P(x1 + 0.04, 1.0, 4), P(1.92, 1.0, 4), '#0f172a', 1);
      c.globalAlpha = 1;
      // Seilrolle auf der Matte
      const cp = P(1.12, y1 + 0.2, 4);
      for (let i = 0; i < 2; i++) { c.beginPath(); c.ellipse(cp[0] + i * 1.5, cp[1] - i, 4.5 - i, 2.2, 0, 0, 7); c.strokeStyle = '#ea580c'; c.lineWidth = 1.3; c.stroke(); }
      if (L >= 5) { const q = P(x1 + 0.2, 1.36, 4); c.beginPath(); c.ellipse(q[0], q[1], 4, 2, 0, 0, 7); c.strokeStyle = '#be123c'; c.lineWidth = 1.3; c.stroke(); }
      if (L >= 4) bush(c, ...P(0.2, 1.75), 0.55);
      if (L >= 10) bush(c, ...P(0.2, 1.35), 0.5, '#f472b6');
    },
  

    // ---- Bedürfnis-Gebäude: kultur ----
    // Lesehütte (2×2)
    library(c, L) {
      const st = stageOf(L);
      const wall = ['#c48a52', '#d6a46a', '#b8432f'][st];
      const roof = ['#8b4a2b', '#2f7d5b', '#3b4a63'][st];
      const trim = ['#f3e2bf', '#fff7e0', '#ffffff'][st];
      const door = ['#4f7d3a', '#2563eb', '#1e3a8a'][st];
      const x0 = 0.25, y0 = 0.25, x1 = 1.5, y1 = 1.3, wh = 26, rh = L >= 7 ? 19 : 16, o = 0.14;
      const xm = (x0 + x1) / 2;
      shadow(c, 0.25, 0.25, 1.55, 1.4, 0.3);
      groundPatch(c, 0.08, 0.08, 1.92, 1.92, '#e3d3ac');
      if (L >= 3) bush(c, ...P(0.16, 1.62), 0.5, '#4fa63a');
      // Leselampe & Sessel (hinten rechts)
      if (L >= 4) {
        const lp = P(1.78, 0.42, 0);
        c.globalAlpha = 0.2; c.beginPath(); c.ellipse(lp[0], lp[1], 4, 2, 0, 0, 7); c.fillStyle = '#000'; c.fill(); c.globalAlpha = 1;
        line(c, lp, [lp[0], lp[1] - 22], '#44403c', 1.4);
        poly(c, [[lp[0] - 3, lp[1] - 29], [lp[0] + 3, lp[1] - 29], [lp[0] + 5, lp[1] - 22], [lp[0] - 5, lp[1] - 22]], st === 2 ? '#fcd34d' : '#fde68a', OL, 1);
      }
      // Sockel & Holzwände
      box(c, x0 - 0.04, y0 - 0.04, x1 + 0.04, y1 + 0.04, 0, 3, '#a8a29e');
      box(c, x0, y0, x1, y1, 3, wh - 3, wall);
      c.globalAlpha = 0.22;
      for (let z = 8; z < wh; z += 5) {
        line(c, P(x0, y1, z), P(x1, y1, z), '#3b2412', 1);
        line(c, P(x1, y1, z), P(x1, y0, z), '#3b2412', 1);
      }
      c.globalAlpha = 1;
      line(c, P(x1, y1, 3), P(x1, y1, wh), trim, 2);
      line(c, P(x0, y1, 3), P(x0, y1, wh), trim, 1.6);
      // Schaufenster mit Bücherregal
      const wx0 = 0.34, wx1 = 1.02;
      faceY(c, y1, wx0, wx1, 6, 23, trim, OL);
      faceY(c, y1, wx0 + 0.04, wx1 - 0.04, 8, 21, '#4a2c14');
      const cols = ['#ef4444', '#3b82f6', '#facc15', '#22c55e', '#a855f7', '#f97316', '#14b8a6', '#ec4899'];
      for (let r = 0; r < 2; r++) {
        const zs = 8 + r * 6.5;
        let bx = wx0 + 0.06, i = 0;
        while (bx < wx1 - 0.11) {
          const bw = 0.05 + hash(i, r, 3) * 0.025;
          const bh = 3.8 + hash(i, r, 4) * 1.7;
          faceY(c, y1, bx, bx + bw, zs + 0.8, zs + 0.8 + bh, cols[(i * 3 + r * 5 + (hash(i, r, 5) * 8 | 0)) % 8]);
          bx += bw + 0.014; i++;
        }
        faceY(c, y1, wx0 + 0.04, wx1 - 0.04, zs, zs + 0.9, '#c08850');
      }
      c.globalAlpha = 0.28;
      poly(c, [P(0.5, y1, 21), P(0.6, y1, 21), P(0.46, y1, 8), P(0.36, y1, 8)], '#ffffff');
      c.globalAlpha = 1;
      if (L >= 7) { // Blumenkasten
        box(c, wx0 - 0.02, y1, wx1 + 0.02, y1 + 0.09, 2, 4, '#7c4a1e');
        for (let i = 0; i < 6; i++) circle(c, ...P(wx0 + 0.06 + i * 0.11, y1 + 0.05, 7.5), 1.8, ['#f43f5e', '#facc15', '#ec4899'][i % 3]);
      } else box(c, wx0 - 0.03, y1, wx1 + 0.03, y1 + 0.07, 4.5, 1.8, trim);
      // Tür
      faceY(c, y1, 1.12, 1.4, 3, 21, door, OL);
      faceY(c, y1, 1.16, 1.36, 13, 19, '#9fd3ef', OL);
      circle(c, ...P(1.35, y1, 11), 1.1, '#fcd34d');
      // Türlampe
      const dl = P(1.455, y1, 18);
      c.fillStyle = '#fde68a'; rr(c, dl[0] - 1.8, dl[1] - 3, 3.6, 4.5, 1); c.fill(); c.strokeStyle = OL; c.lineWidth = 0.9; c.stroke();
      // Seitenfenster
      faceX(c, x1, 0.4, 0.8, 9, 20, trim, OL);
      faceX(c, x1, 0.44, 0.76, 11, 18, '#7cc4ea');
      line(c, P(x1, 0.6, 11), P(x1, 0.6, 18), trim, 1.2);
      if (L >= 5) { // Fensterläden
        faceX(c, x1, 0.3, 0.4, 9, 20, door, OL);
        faceX(c, x1, 0.8, 0.9, 9, 20, door, OL);
      }
      // Dach
      roofY(c, x0, y0, x1, y1, wh, rh, roof, wall, o);
      c.globalAlpha = 0.3;
      for (let f = 0.25; f < 1; f += 0.25) {
        const xx = xm + (x1 + o - xm) * f, zz = wh + rh * (1 - f);
        line(c, P(xx, y0 - o, zz), P(xx, y1 + o, zz), shade(roof, -0.5), 1);
      }
      c.globalAlpha = 1;
      line(c, P(xm, y0 - o, wh + rh), P(xm, y1 + o, wh + rh), shade(roof, -0.35), 2.2);
      if (L >= 9) { // goldene Giebelkante
        line(c, P(x0 - o, y1 + o, wh), P(xm, y1 + o, wh + rh), '#fbbf24', 1.6);
        line(c, P(xm, y1 + o, wh + rh), P(x1 + o, y1 + o, wh), '#fbbf24', 1.6);
      }
      if (L >= 7) {
        // Schornstein auf der vorderen Dachfläche
        const sz = x => wh + rh * (x1 + o - x) / (x1 + o - xm);
        const cx0 = 1.0, cx1 = 1.17, cy0 = 0.38, cy1 = 0.55, top = 50;
        poly(c, [P(cx0, cy1, sz(cx0)), P(cx1, cy1, sz(cx1)), P(cx1, cy1, top), P(cx0, cy1, top)], '#a8a29e', OL, 1.1);
        poly(c, [P(cx1, cy1, sz(cx1)), P(cx1, cy0, sz(cx1)), P(cx1, cy0, top), P(cx1, cy1, top)], '#78716c', OL, 1.1);
        box(c, cx0 - 0.03, cy0 - 0.03, cx1 + 0.03, cy1 + 0.03, top, 2.5, '#57534e');
        // rundes Dachbodenfenster im Giebel
        const g = P(xm, y1, wh + 7);
        c.save(); c.translate(g[0], g[1]); c.transform(1, 0.5, 0, 1, 0, 0);
        circle(c, 0, 0, 4.6, trim, OL, 1.1);
        circle(c, 0, 0, 3.2, '#fde68a');
        line(c, [-3.2, 0], [3.2, 0], trim, 1); line(c, [0, -3.2], [0, 3.2], trim, 1);
        c.restore();
      }
      // Schild mit Buch: im Giebel, ab L7 als Hängeschild an der Ecke
      const book = () => {
        c.beginPath(); c.moveTo(0, -2); c.quadraticCurveTo(-3, -3.8, -6, -2.6); c.lineTo(-6, 2.8); c.quadraticCurveTo(-3, 1.6, 0, 3.4);
        c.quadraticCurveTo(3, 1.6, 6, 2.8); c.lineTo(6, -2.6); c.quadraticCurveTo(3, -3.8, 0, -2); c.closePath();
        c.fillStyle = '#ffffff'; c.fill(); c.strokeStyle = '#b91c1c'; c.lineWidth = 1.3; c.stroke();
        line(c, [0, -2], [0, 3.4], '#b91c1c', 1);
      };
      if (L < 7) {
        const s = P(xm, y1, wh + 5);
        c.save(); c.translate(s[0], s[1]); c.transform(1, 0.5, 0, 1, 0, 0);
        c.fillStyle = st ? '#2f6b4f' : '#6b3f1d'; rr(c, -8, -4.5, 16, 9, 2.5); c.fill(); c.strokeStyle = OL; c.lineWidth = 1; c.stroke();
        c.scale(0.9, 0.9); book();
        c.restore();
      }
      // Lesebank vorne mit Buch
      box(c, 0.3, 1.52, 0.95, 1.57, 7, 6, '#9a6436');
      box(c, 0.3, 1.57, 0.95, 1.74, 5, 2, '#b07a45');
      for (const x of [0.34, 0.91]) line(c, P(x, 1.74, 0), P(x, 1.74, 5), '#3f3f46', 1.4);
      box(c, 0.48, 1.6, 0.62, 1.7, 7, 1.6, '#dc2626', { left: '#fff7e0', top: '#ef4444' });
      if (L >= 3) { // Bücherkiste
        box(c, 1.62, 1.5, 1.86, 1.72, 0, 6, '#b07a45');
        for (let i = 0; i < 4; i++) faceY(c, 1.6, 1.65 + i * 0.05, 1.69 + i * 0.05, 6, 9 + hash(i, 9) * 2, cols[(i * 3 + 1) % 8], OL);
      }
      if (L >= 5) quad(c, 1.12, 1.36, 1.42, 1.6, 0, '#b45309', shade('#b45309', -0.3), 1); // Fußmatte
      if (L >= 4) { // Lesesessel
        const ac = st === 2 ? '#9d174d' : '#e07a3f';
        box(c, 1.6, 0.66, 1.68, 1.08, 0, 16, ac);
        box(c, 1.62, 0.66, 1.9, 0.73, 0, 10, ac);
        box(c, 1.68, 0.73, 1.9, 1.01, 0, 6, ac, { top: shade(ac, 0.2) });
        box(c, 1.62, 1.01, 1.9, 1.08, 0, 10, ac);
      }
      if (L >= 7) { // Hängeschild an der rechten Wand, Tür bleibt frei
        const hy = y1 - 0.05;
        line(c, P(x1, hy, 25), P(x1 + 0.36, hy, 25), '#1f2937', 1.4);
        line(c, P(x1 + 0.12, hy, 25), P(x1 + 0.12, hy, 23), '#1f2937', 0.9);
        line(c, P(x1 + 0.3, hy, 25), P(x1 + 0.3, hy, 23), '#1f2937', 0.9);
        const s = P(x1 + 0.21, hy, 18.5);
        c.save(); c.translate(s[0], s[1]); c.transform(1, 0.5, 0, 1, 0, 0);
        c.fillStyle = '#1e3a8a'; rr(c, -6, -4.5, 12, 9, 2); c.fill(); c.strokeStyle = '#fbbf24'; c.lineWidth = 1.1; c.stroke();
        c.scale(0.72, 0.72); book();
        c.restore();
      }
      if (L >= 9) bush(c, ...P(1.86, 1.86), 0.45, '#f472b6');
    },

    // Freilichtbühne (4×4)
    stage(c, L) {
      const st = stageOf(L);
      const PI = Math.PI;
      const O = 0.2;
      const Q = (r, a, z) => P(O + r * Math.cos(a), O + r * Math.sin(a), z);
      const wood = ['#c48a52', '#c99357', '#b9824c'][st];
      groundPatch(c, 0.08, 0.08, 3.92, 3.92, '#a6d17e', '#8fbf6a');
      // Mittelgang (Kies)
      poly(c, [P(2.0, 2.4), P(2.4, 2.0), P(3.92, 3.6), P(3.6, 3.92)], '#e2cf9c', shade('#e2cf9c', -0.2), 1.2);
      // Bühnenpodest (Viertelkreis)
      const R = 2.45, ph = 9 + st, N = 14;
      const band = [];
      for (let i = 0; i <= N; i++) band.push(Q(R, i / N * PI / 2, ph));
      for (let i = N; i >= 0; i--) band.push(Q(R, i / N * PI / 2, 0));
      poly(c, band, shade(wood, -0.28), OL);
      c.globalAlpha = 0.3;
      for (let i = 1; i < N; i++) { const a = i / N * PI / 2; line(c, Q(R, a, 0), Q(R, a, ph), '#3b2412', 1); }
      c.globalAlpha = 1;
      const top = [P(O, O, ph)];
      for (let i = 0; i <= N; i++) top.push(Q(R, i / N * PI / 2, ph));
      poly(c, top, wood, OL);
      c.globalAlpha = 0.22;
      for (let i = 1; i < 8; i++) line(c, P(O, O, ph), Q(R, i / 8 * PI / 2, ph), '#5b3a1e', 1);
      c.globalAlpha = 1;
      // Muschel (Bühnendach) – Ebene x+y = cf zeigt direkt zum Betrachter
      const cf = st === 2 ? 2.4 : 2.3;
      const by = cf * 16 - ph;
      const hw = [54, 58, 64][st], hz = [40, 44, 47][st];
      const ext = ['#a86d3a', '#f8fafc', '#ffffff'][st];
      const inner = ['#f0d6a4', '#dbeafe', '#312e81'][st];
      const rim = ['#7a4a21', '#cbd5e1', '#f59e0b'][st];
      const rx = hw - 4, ry = hz - 4, fl = ry * 0.4;
      const E = (a, b, a0, a1, ccw) => c.ellipse(0, by, a, b, 0, a0, a1, ccw);
      c.lineWidth = 1.3; c.strokeStyle = OL;
      c.beginPath(); E(hw + 2, hz + 12, PI, 2 * PI); E(hw + 2, hz + 2, 2 * PI, PI, true); c.closePath();
      c.fillStyle = ext; c.fill(); c.stroke();
      c.globalAlpha = 0.4;
      for (let i = 1; i < 10; i++) { const a = PI + PI * i / 10, xx = (hw + 2) * Math.cos(a); line(c, [xx, by + (hz + 2) * Math.sin(a)], [xx, by + (hz + 12) * Math.sin(a)], shade(ext, -0.45), 1); }
      c.globalAlpha = 1;
      c.beginPath(); E(hw + 2, hz + 2, PI, 2 * PI); E(rx, ry, 2 * PI, PI, true); c.closePath();
      c.fillStyle = rim; c.fill(); c.stroke();
      c.save();
      c.beginPath(); E(rx, ry, PI, 2 * PI); E(rx, fl, 2 * PI, PI, true); c.closePath();
      c.fillStyle = inner; c.fill();
      c.clip();
      for (let k = 1; k <= 4; k++) {
        const f = k / 5;
        c.beginPath(); c.ellipse(0, by - fl * f, rx * (1 - f * 0.8), ry * (1 - f * 0.75), 0, 0, 2 * PI);
        c.fillStyle = shade(inner, k % 2 ? -0.12 : 0.04); c.fill();
      }
      if (st === 2) { // Sterne in der Muschel
        for (let i = 0; i < 9; i++) circle(c, (hash(i, 1, 7) - 0.5) * rx * 1.6, by - 8 - hash(i, 2, 7) * (ry - 8), 0.9 + hash(i, 3, 7), '#fde68a');
      }
      c.restore();
      c.beginPath(); E(rx, ry, PI, 2 * PI); E(rx, fl, 2 * PI, PI, true); c.closePath();
      c.strokeStyle = OL; c.lineWidth = 1.2; c.stroke();
      if (L >= 7) { // Klavier in der Muschel
        box(c, 0.72, 1.02, 1.12, 1.16, ph, 14, '#1f2937');
        box(c, 0.72, 1.16, 1.12, 1.28, ph + 7, 2, '#111827', { top: '#f8fafc' });
        box(c, 0.84, 1.36, 1.0, 1.48, ph, 5, '#7c2d12');
      }
      // Vorhang (rot), seitlich gerafft
      const cur = st === 2 ? '#b91c1c' : '#dc2626';
      for (const s of [-1, 1]) {
        c.beginPath();
        c.moveTo(s * rx, by);
        E(rx, ry, s < 0 ? PI : 2 * PI, s < 0 ? PI + 0.9 : 2 * PI - 0.9, s > 0);
        c.quadraticCurveTo(s * rx * 0.66, by - ry * 0.45, s * rx * 0.76, by - ry * 0.32);
        c.quadraticCurveTo(s * rx * 0.68, by - ry * 0.12, s * rx * 0.78, by);
        c.closePath();
        c.fillStyle = cur; c.fill(); c.strokeStyle = OL; c.lineWidth = 1.1; c.stroke();
        c.beginPath();
        c.moveTo(s * rx * 0.9, by - ry * 0.7); c.quadraticCurveTo(s * rx * 0.84, by - ry * 0.4, s * rx * 0.9, by - 1);
        c.strokeStyle = shade(cur, -0.35); c.lineWidth = 1; c.stroke();
        circle(c, s * rx * 0.76, by - ry * 0.32, 1.6, st === 2 ? '#fbbf24' : '#facc15');
      }
      // Volant oben
      c.beginPath();
      E(rx, ry, PI + 0.8, 2 * PI - 0.8);
      const n = 6;
      for (let i = n; i > 0; i--) {
        const a1 = PI + 0.8 + (PI - 1.6) * i / n, a2 = PI + 0.8 + (PI - 1.6) * (i - 1) / n, am = (a1 + a2) / 2;
        const q1 = [rx * Math.cos(a1) * 0.94, by + ry * Math.sin(a1) * 0.9];
        const q2 = [rx * Math.cos(a2) * 0.94, by + ry * Math.sin(a2) * 0.9];
        const qm = [rx * Math.cos(am) * 0.88, by + ry * Math.sin(am) * 0.8];
        if (i === n) c.lineTo(q1[0], q1[1]);
        c.quadraticCurveTo(qm[0], qm[1], q2[0], q2[1]);
      }
      c.closePath();
      c.fillStyle = cur; c.fill(); c.strokeStyle = OL; c.lineWidth = 1.1; c.stroke();
      if (st === 2) { // Glühbirnen am Rand
        for (let i = 0; i <= 12; i++) {
          const a = PI + PI * i / 12;
          circle(c, (hw - 1) * Math.cos(a), by + (hz - 1) * Math.sin(a), 1.5, i % 2 ? '#fff7d6' : '#fde047');
        }
      }
      if (L >= 9) { // Stern auf der Muschel
        const sx = 0, sy = by - hz - 7;
        c.beginPath();
        for (let i = 0; i < 10; i++) { const a = -PI / 2 + i * PI / 5, r = i % 2 ? 2.4 : 5.5; c.lineTo(sx + Math.cos(a) * r, sy + Math.sin(a) * r); }
        c.closePath(); c.fillStyle = '#fbbf24'; c.fill(); c.strokeStyle = OL; c.lineWidth = 1; c.stroke();
      }
      if (L >= 5) { // Mikrofon
        const m0 = P(1.45, 1.45, ph), m1 = P(1.45, 1.45, ph + 15);
        c.beginPath(); c.ellipse(m0[0], m0[1], 3, 1.5, 0, 0, 2 * PI); c.fillStyle = '#374151'; c.fill();
        line(c, m0, m1, '#374151', 1.3);
        circle(c, m1[0], m1[1] - 1, 1.9, '#9ca3af', OL, 0.9);
      }
      // Rampenlichter
      if (L >= 3) {
        for (let i = 1; i < 8; i++) {
          const q = Q(R - 0.1, i / 8 * PI / 2, ph);
          c.fillStyle = '#374151'; rr(c, q[0] - 2, q[1] - 2, 4, 2.5, 1); c.fill();
          circle(c, q[0], q[1] - 2.2, 1.3, '#fde68a');
        }
      }
      // Lautsprecher
      if (L >= 5) {
        for (const [x, y] of [[2.05, 0.3], [0.3, 2.05]]) {
          box(c, x, y, x + 0.26, y + 0.26, ph, 14, '#1f2937');
          circle(c, ...P(x + 0.13, y + 0.26, ph + 9), 2.4, '#4b5563', '#111827', 0.8);
          circle(c, ...P(x + 0.26, y + 0.13, ph + 9), 2.4, '#4b5563', '#111827', 0.8);
        }
      }
      // Lichttürme mit Scheinwerfern
      if (L >= 4) {
        const lens = st === 2 ? ['#f472b6', '#60a5fa', '#4ade80', '#facc15'] : ['#fde68a', '#fde68a', '#fde68a', '#fde68a'];
        [[2.9, 0.28, 1], [0.28, 2.9, -1]].forEach(([x, y, s], k) => {
          line(c, P(x, y, 0), P(x, y, 60), '#57534e', 2.4);
          line(c, P(x - 0.12, y + 0.12, 0), P(x, y, 22), '#57534e', 1.2);
          line(c, P(x + 0.12, y - 0.12, 0), P(x, y, 22), '#57534e', 1.2);
          const t = P(x, y, 58);
          line(c, [t[0] - 7, t[1]], [t[0] + 7, t[1]], '#44403c', 2);
          if (st === 2) { // Banner
            poly(c, [[t[0] - 5, t[1] + 4], [t[0] + 5, t[1] + 4], [t[0] + 5, t[1] + 24], [t[0], t[1] + 20], [t[0] - 5, t[1] + 24]], k ? '#7c3aed' : '#db2777', OL, 1);
            circle(c, t[0], t[1] + 11, 2.2, '#fbbf24');
          }
          for (let i = 0; i < 2; i++) {
            const hx = t[0] + (i ? 4 : -4), hy = t[1] + 3;
            c.save(); c.translate(hx, hy); c.rotate(s > 0 ? 2.5 : 0.64);
            c.fillStyle = '#1f2937'; rr(c, -3, -2.6, 7, 5.2, 1.5); c.fill(); c.strokeStyle = OL; c.lineWidth = 0.8; c.stroke();
            circle(c, 4, 0, 2.1, lens[k * 2 + i]);
            c.restore();
          }
        });
      }
      // Sitzbänke in Rängen
      const rows = L >= 3 ? 3 : 2;
      const seatCol = ['#d29a55', '#d9a660', '#c99357'][st];
      for (let r = 0; r < rows; r++) {
        const rad = 2.95 + r * 0.45;
        const amin = Math.max(0.22, Math.acos(Math.min(1, 3.6 / rad)));
        const gap = 0.26 / rad;
        for (const [a0, a1] of [[amin, PI / 4 - gap], [PI / 4 + gap, PI / 2 - amin]]) {
          const as = [];
          for (let i = 0; i <= 6; i++) as.push(a0 + (a1 - a0) * i / 6);
          const path = (rr0, z) => { c.beginPath(); as.forEach((a, i) => { const p = Q(rr0, a, z); if (i) c.lineTo(p[0], p[1]); else c.moveTo(p[0], p[1]); }); };
          path(rad, 3); c.strokeStyle = '#5b3a1e'; c.lineWidth = 7; c.stroke();
          path(rad, 5); c.strokeStyle = st === 2 ? '#dc2626' : seatCol; c.lineWidth = 4.4; c.stroke();
          const pts = as.map(a => Q(rad + 0.13, a, 11)).concat(as.slice().reverse().map(a => Q(rad + 0.13, a, 4)));
          poly(c, pts, shade(seatCol, -0.15), OL, 1.1);
          c.globalAlpha = 0.35;
          path(rad + 0.13, 7.5); c.strokeStyle = '#5b3a1e'; c.lineWidth = 0.9; c.stroke();
          c.globalAlpha = 1;
        }
      }
      if (L >= 7) { bush(c, ...P(3.75, 0.25), 0.55, '#3f9a35'); bush(c, ...P(0.25, 3.75), 0.55, '#3f9a35'); }
      else { // kleines Beet in den vorderen Ecken
        const fc = ['#f472b6', '#facc15', '#ffffff', '#a78bfa'];
        [[3.68, 0.3], [0.3, 3.68]].forEach(([x, y], k) => {
          ellipseG(c, x, y, 0.24, 0, '#8a6a3f', shade('#8a6a3f', -0.25), 1);
          bush(c, ...P(x - 0.05, y - 0.05), 0.5, '#4fa63a');
          for (let i = 0; i < 5; i++) { const a = i * 1.25 + k; circle(c, ...P(x + Math.cos(a) * 0.17, y + Math.sin(a) * 0.17, 1.5), 1.6, fc[(i + k) % 4], OL, 0.6); }
        });
      }
      if (L >= 9) { bush(c, ...P(3.8, 3.3), 0.5, '#f472b6'); bush(c, ...P(3.3, 3.8), 0.5, '#f472b6'); }
    },

    // Open-Air-Kino (4×3)
    cinema(c, L) {
      const st = stageOf(L);
      const PI = Math.PI;
      const big = L >= 7;
      const ys = 0.42, yb = 0.3;
      const xa = big ? 0.42 : 0.55, xb = big ? 3.58 : 3.45, za = big ? 16 : 20, zb = big ? 66 : 60;
      const frame = ['#7a4a21', '#475569', '#1f2937'][st];
      shadow(c, xa, 0.12, xb, 0.5, 0.4);
      groundPatch(c, 0.08, 0.08, 3.92, 2.92, '#a6d17e', '#8fbf6a');
      // Streben hinter der Leinwand
      for (const x of [xa + 0.4, (xa + xb) / 2, xb - 0.4]) {
        line(c, P(x, 0.12, 0), P(x, yb, za + 16), shade(frame, 0.15), 2);
        line(c, P(x, yb, 0), P(x, yb, za), frame, 2.6);
      }
      box(c, xa - 0.14, 0.26, xa, 0.46, 0, zb + 4, frame);
      // Leinwand mit schwarzem Rand
      box(c, xa, yb, xb, ys, za, zb - za, '#e5e7eb', { left: '#1f2937', right: '#94a3b8', top: '#cbd5e1' });
      faceY(c, ys, xa + 0.06, xb - 0.06, za + 2.5, zb - 2.5, '#eef2f7');
      faceY(c, ys, xa + 0.06, xb - 0.06, zb - 7, zb - 2.5, '#e2e8f0');
      box(c, xb, 0.26, xb + 0.14, 0.46, 0, zb + 4, frame);
      if (big) { // Vorhänge & Volant
        c.save();
        const q = P(0, ys + 0.03, 0);
        c.translate(q[0], q[1]); c.transform(1, 0.5, 0, 1, 0, 0);
        for (const s of [0, 1]) {
          const u0 = (s ? xb : xa) * 32, d = s ? -1 : 1;
          c.beginPath();
          c.moveTo(u0 - d * 7, -zb - 3); c.lineTo(u0 + d * 14, -zb - 3);
          c.quadraticCurveTo(u0 + d * 5, -za - 20, u0 + d * 9, -za - 8);
          c.quadraticCurveTo(u0 + d * 4, -za + 4, u0 + d * 8, 0); c.lineTo(u0 - d * 7, 0); c.closePath();
          c.fillStyle = '#b91c1c'; c.fill(); c.strokeStyle = OL; c.lineWidth = 1.1; c.stroke();
          line(c, [u0 + d * 1, -zb], [u0 + d * 1, -2], '#7f1d1d', 1);
          circle(c, u0 + d * 9, -za - 8, 1.6, '#fbbf24');
        }
        c.beginPath(); c.moveTo(xa * 32 - 7, -zb - 7);
        c.lineTo(xb * 32 + 7, -zb - 7); c.lineTo(xb * 32 + 7, -zb + 1);
        const nn = 8, w = (xb - xa) * 32 + 14;
        for (let i = nn; i > 0; i--) c.quadraticCurveTo(xa * 32 - 7 + w * (i - 0.5) / nn, -zb + 7, xa * 32 - 7 + w * (i - 1) / nn, -zb + 1);
        c.closePath(); c.fillStyle = '#b91c1c'; c.fill(); c.strokeStyle = OL; c.lineWidth = 1.1; c.stroke();
        line(c, [xa * 32 - 7, -zb - 4], [xb * 32 + 7, -zb - 4], '#fbbf24', 1.2);
        c.restore();
      }
      // Lichterkette
      const bulbs = ['#fde047', '#f472b6', '#60a5fa', '#4ade80', '#fb923c'];
      const string = (a, b, n) => {
        const pts = [];
        for (let i = 0; i <= n; i++) { const u = i / n; pts.push(P(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u - 9 * 4 * u * (1 - u))); }
        c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]));
        c.strokeStyle = '#3f3f46'; c.lineWidth = 0.9; c.stroke();
        for (let i = 1; i < n; i++) circle(c, pts[i][0], pts[i][1] + 1.5, 1.6, bulbs[i % 5]);
      };
      if (L >= 4) {
        line(c, P(0.12, 2.0, 0), P(0.12, 2.0, 42), '#57534e', 1.6);
        line(c, P(3.9, 1.55, 0), P(3.9, 1.55, 42), '#57534e', 1.6);
        string([xa - 0.07, 0.36, zb + 3], [0.12, 2.0, 42], 9);
        string([xb + 0.07, 0.36, zb + 3], [3.9, 1.55, 42], 9);
      }
      // Sitze
      const chair = (x, y, col) => {
        const u0 = x - 0.17, u1 = x + 0.17;
        poly(c, [P(u0, y - 0.3, 4), P(u1, y - 0.3, 4), P(u1, y, 6), P(u0, y, 6)], shade(col, -0.25), OL, 1);
        line(c, P(u0, y + 0.18, 0), P(u0, y + 0.1, 17), '#7a4a21', 1.4);
        line(c, P(u1, y + 0.18, 0), P(u1, y + 0.1, 17), '#7a4a21', 1.4);
        poly(c, [P(u0, y, 5), P(u1, y, 5), P(u1, y + 0.12, 17), P(u0, y + 0.12, 17)], col, OL, 1);
        poly(c, [P(x - 0.05, y, 5), P(x + 0.05, y, 5), P(x + 0.05, y + 0.12, 17), P(x - 0.05, y + 0.12, 17)], '#ffffff');
      };
      const bag = (x, y, col) => {
        const p = P(x, y, 0);
        c.beginPath(); c.ellipse(p[0], p[1] - 4.5, 8, 6, 0, 0, 2 * PI);
        c.fillStyle = col; c.fill(); c.strokeStyle = OL; c.lineWidth = 1.1; c.stroke();
        c.beginPath(); c.ellipse(p[0] + 2, p[1] - 7, 4.5, 2.6, -0.3, 0, 2 * PI); c.fillStyle = shade(col, -0.2); c.fill();
        circle(c, p[0] - 4, p[1] - 6, 1.6, 'rgba(255,255,255,0.5)');
      };
      // Kinosessel (von hinten): Sitz, Lehne mit Polster und Goldkante
      const red = (x, y) => {
        box(c, x - 0.17, y - 0.26, x + 0.17, y, 0, 7, '#b91c1c', { top: '#ef4444' });
        box(c, x - 0.19, y, x + 0.19, y + 0.09, 0, 17, '#dc2626', { top: '#f87171' });
        faceY(c, y + 0.09, x - 0.13, x + 0.13, 5, 14, '#991b1b');
        line(c, P(x - 0.19, y + 0.09, 16.2), P(x + 0.19, y + 0.09, 16.2), '#fbbf24', 1.1);
      };
      const rowsY = [1.35, 1.95, 2.55];
      const colsC = ['#f97316', '#3b82f6', '#ec4899', '#22c55e', '#eab308'];
      for (let r = 0; r < 3; r++) {
        const y = rowsY[r];
        let xs;
        if (st === 0) xs = r === 0 ? [0.95, 1.55, 2.15, 2.75] : r === 1 ? [1.25, 1.85, 2.45] : L >= 3 ? [1.55, 2.15] : [];
        else if (st === 1) xs = r < 2 ? [0.75, 1.3, 1.85, 2.4, 2.95] : [1.15, 1.75, 2.35];
        else xs = r < 2 ? [0.75, 1.25, 1.75, 2.25, 2.75, 3.25] : [1.05, 1.55, 2.05, 2.55];
        xs.forEach((x, i) => {
          if (st === 2) red(x, y);
          else if (r === 1 && st === 0 || r === 2) bag(x, y, colsC[(i + r * 2) % 5]);
          else chair(x, y, colsC[(i + r) % 5]);
        });
      }
      // Popcornwagen
      const px0 = 0.2, px1 = 0.66, py0 = 2.3, py1 = 2.76;
      box(c, px0, py0, px1, py1, 4, 11, '#ef4444');
      for (let i = 0; i < 4; i++) faceY(c, py1, px0 + 0.03 + i * 0.12, px0 + 0.09 + i * 0.12, 4, 15, '#ffffff');
      for (let i = 0; i < 4; i++) faceX(c, px1, py0 + 0.03 + i * 0.12, py0 + 0.09 + i * 0.12, 4, 15, '#f1f5f9');
      box(c, px0 + 0.04, py0 + 0.04, px1 - 0.04, py1 - 0.04, 15, 11, '#fef9c3', { left: '#fde68a', right: '#facc15', top: '#fffbeb' });
      for (let i = 0; i < 7; i++) circle(c, ...P(px0 + 0.1 + hash(i, 4) * 0.3, py1 - 0.04, 16 + hash(i, 5) * 5), 1.7, i % 2 ? '#fffbeb' : '#fde047');
      box(c, px0 - 0.03, py0 - 0.03, px1 + 0.03, py1 + 0.03, 26, 2.5, '#dc2626', { top: '#ef4444' });
      for (const x of [px0 + 0.1, px1 - 0.1]) { const p = P(x, py1, 3); circle(c, p[0], p[1], 3.4, '#1f2937'); circle(c, p[0], p[1], 1.3, '#9ca3af'); }
      if (L >= 5) { // Schirm über dem Wagen
        line(c, P(px1 - 0.05, py1 - 0.05, 28), P(px1 - 0.05, py1 - 0.05, 36), '#57534e', 1.2);
        const u = P(px1 - 0.05, py1 - 0.05, 36);
        c.beginPath(); c.moveTo(u[0] - 12, u[1] + 4); c.quadraticCurveTo(u[0], u[1] - 9, u[0] + 12, u[1] + 4); c.closePath();
        c.fillStyle = '#facc15'; c.fill(); c.strokeStyle = OL; c.lineWidth = 1; c.stroke();
      }
      // Vorführhäuschen mit Projektor
      const sm = st === 0, f = sm ? 0.76 : 1, bh = sm ? 20 : 24;
      const bx0 = sm ? 3.42 : 3.22, by0 = sm ? 2.32 : 2.08;
      const X = u => bx0 + u * f, Y = u => by0 + u * f;
      const bx1 = X(0.64), by1 = Y(0.76);
      const booth = ['#c48a52', '#64748b', '#334155'][st];
      box(c, bx0, by0, bx1, by1, 0, bh, booth);
      faceY(c, by1, X(0.16), X(0.42), 0, 16, shade(booth, -0.45), OL);
      circle(c, ...P(X(0.38), by1, 8), 0.9, '#fcd34d');
      faceX(c, bx1, Y(0.18), Y(0.54), 11, 19, '#fde68a', OL);
      box(c, bx0 - 0.05, by0 - 0.05, bx1 + 0.05, by1 + 0.05, bh, 3, st === 2 ? '#b91c1c' : '#475569');
      box(c, X(0.14), Y(0.22), X(0.5), Y(0.52), bh + 3, 6, '#374151');
      for (const u of [0.22, 0.44]) {
        const p = P(X(u), Y(0.37), bh + (sm ? 12.5 : 14)), rw = sm ? 4.8 : 5.6;
        circle(c, p[0], p[1], rw, '#1f2937', OL, 1);
        for (let k = 0; k < 3; k++) { const a = k * 2.09 + 0.4; circle(c, p[0] + Math.cos(a) * rw * 0.54, p[1] + Math.sin(a) * rw * 0.54, 1.3, '#9ca3af'); }
        circle(c, p[0], p[1], 1.1, '#e5e7eb');
      }
      if (L >= 9) { bush(c, ...P(3.85, 0.85), 0.55, '#3f9a35'); bush(c, ...P(0.15, 1.2), 0.5, '#f472b6'); }
    },
  

    // ---- Bedürfnis-Gebäude: kunst ----
    // Malatelier (2×2)
    atelier(c, L) {
      const st = stageOf(L);
      const wall = ['#dba56b', '#bfe6d3', '#fbf0de'][st];
      const roof = ['#4f86b8', '#e8704f', '#7457c9'][st];
      const door = ['#c2410c', '#2563eb', '#0f766e'][st];
      const paints = ['#ef4444', '#3b82f6', '#facc15', '#22c55e', '#a855f7', '#f97316'];
      const x0 = 0.2, y0 = 0.2, x1 = 1.4, y1 = 1.28, hf = 27, hb = 42;
      const rate = (hb - hf) / (y1 - y0);
      const zw = y => hb - rate * (y - y0);       // Wandhöhe rechts
      const zr = y => zw(y) + 2;                  // Dachfläche
      // Farbklecks mit Spritzern
      const splash = (p, r, col, k) => {
        circle(c, p[0], p[1], r, col);
        for (let i = 0; i < 3; i++) {
          const a = hash(k, i, 3) * 6.28, d = r + 1.5 + hash(k, i, 4) * 2.5;
          circle(c, p[0] + Math.cos(a) * d, p[1] + Math.sin(a) * d * 0.8, 0.8 + hash(k, i, 5) * 0.9, col);
        }
        c.fillStyle = col; c.fillRect(p[0] - 0.6, p[1], 1.3, r + 2);
      };
      // Staffelei mit Bild (Leinwand zeigt nach vorne links)
      const easel = (x, y, motif) => {
        const top = P(x, y - 0.06, 27);
        line(c, top, P(x, y - 0.3, 0), '#7a4a21', 1.5);
        const cv = [P(x - 0.18, y - 0.04, 10), P(x + 0.18, y - 0.04, 10), P(x + 0.18, y - 0.07, 23), P(x - 0.18, y - 0.07, 23)];
        c.save();
        poly(c, cv, motif ? '#fde68a' : '#93d0f5');
        c.clip();
        const m = P(x, y - 0.055, 16.5);
        if (!motif) { // Landschaft
          c.beginPath(); c.ellipse(m[0] - 3, m[1] + 8, 10, 6, 0, 0, 7); c.fillStyle = '#4caf50'; c.fill();
          c.beginPath(); c.ellipse(m[0] + 7, m[1] + 8, 8, 5, 0, 0, 7); c.fillStyle = '#2f8f3a'; c.fill();
          circle(c, m[0] + 4, m[1] - 4, 2.6, '#facc15');
        } else { // Abstrakt
          circle(c, m[0] - 3, m[1] - 1, 4, '#ef4444');
          poly(c, [[m[0] - 1, m[1] + 7], [m[0] + 8, m[1] + 5], [m[0] + 4, m[1] - 4]], '#3b82f6');
          line(c, [m[0] - 9, m[1] + 4], [m[0] + 9, m[1] - 7], '#111827', 1.3);
        }
        c.restore();
        poly(c, cv, null, OL, 1.1);
        line(c, P(x - 0.22, y - 0.04, 9.5), P(x + 0.22, y - 0.04, 9.5), '#7a4a21', 1.8);
        line(c, top, P(x - 0.17, y, 0), '#9a6436', 1.7);
        line(c, top, P(x + 0.17, y, 0), '#9a6436', 1.7);
      };

      shadow(c, 0.2, 0.2, 1.75, 1.6, 0.25);
      groundPatch(c, 0.08, 0.08, 1.92, 1.92, ['#d9cfb4', '#ddd3b9', '#e4d6b6'][st]);
      if (st === 2) { // Holzdeck vorne
        box(c, 0.12, y1, 1.88, 1.9, 0, 2, '#c99a62');
        c.globalAlpha = 0.35;
        for (let x = 0.32; x < 1.88; x += 0.2) line(c, P(x, y1, 2), P(x, 1.9, 2), '#7a4a21', 0.9);
        c.globalAlpha = 1;
      }
      // Farbkleckse am Boden
      c.globalAlpha = 0.75;
      for (let i = 0; i < 6; i++) {
        const p = P(0.25 + hash(i, 1, 11) * 1.5, y1 + 0.18 + hash(i, 2, 11) * 0.5, st === 2 ? 2 : 0);
        c.beginPath(); c.ellipse(p[0], p[1], 2.4, 1.2, 0, 0, 7); c.fillStyle = paints[i % 6]; c.fill();
      }
      c.globalAlpha = 1;

      // Wände (vorne niedrig, hinten hoch: Pultdach)
      const left = [P(x0, y1, 0), P(x1, y1, 0), P(x1, y1, hf), P(x0, y1, hf)];
      const right = [P(x1, y1, 0), P(x1, y0, 0), P(x1, y0, hb), P(x1, y1, hf)];
      poly(c, left, shade(wall, -0.08), OL, 1.3);
      poly(c, right, shade(wall, -0.26), OL, 1.3);
      if (st === 0) { // Bretter
        c.globalAlpha = 0.28;
        for (let z = 5; z < hf; z += 5) line(c, P(x0, y1, z), P(x1, y1, z), '#6b3f1d', 1);
        for (let z = 5; z < hb; z += 5) line(c, P(x1, z < hf ? y1 : y0 + (hb - z) / rate, z), P(x1, y0, z), '#6b3f1d', 1);
        c.globalAlpha = 1;
      } else { // Sockel & Eckleiste
        faceY(c, y1, x0, x1, 0, 3, shade(wall, -0.3));
        faceX(c, x1, y0, y1, 0, 3, shade(wall, -0.45));
        line(c, P(x1, y1, 0), P(x1, y1, hf), '#ffffff', 2);
      }
      // Kleckse bzw. Wandbild rechts (hinterer Teil)
      c.save(); poly(c, right); c.clip();
      if (L < 7) {
        splash(P(x1, 0.4, 14), 3, paints[1], 4);
        splash(P(x1, 0.72, 27), 2.4, paints[3], 5);
        splash(P(x1, 0.6, 4), 2.2, paints[0], 7);
        if (L >= 3) splash(P(x1, 0.86, 13), 2, paints[5], 6);
      } else { // Wandbild: Himmel, Sonne, Regenbogen, Welle
        const cols = ['#ef4444', '#f97316', '#facc15', '#22c55e', '#3b82f6', '#8b5cf6'];
        const ye = 0.92;
        poly(c, [P(x1, ye, 3), P(x1, y0 + 0.04, 3), P(x1, y0 + 0.04, hb - 2), P(x1, ye, zw(ye) - 2)], shade('#bae6fd', -0.15));
        circle(c, ...P(x1, 0.34, 32), 4.4, shade('#fde047', -0.05));
        c.lineWidth = 2.4;
        for (let k = 0; k < 6; k++) {
          const R = 0.32 - k * 0.04;
          c.beginPath();
          for (let i = 0; i <= 10; i++) {
            const a = Math.PI * i / 10, q = P(x1, 0.58 - Math.cos(a) * R, 4 + Math.sin(a) * R * 62);
            i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]);
          }
          c.strokeStyle = shade(cols[k], -0.12); c.stroke();
        }
        c.beginPath();
        for (let i = 0; i <= 9; i++) { const q = P(x1, y0 + i * (ye - y0) / 9, 5 + Math.sin(i * 1.6) * 1.6); i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); }
        c.lineTo(...P(x1, ye, 0)); c.lineTo(...P(x1, y0, 0)); c.closePath();
        c.fillStyle = shade('#0ea5e9', -0.2); c.fill();
        poly(c, [P(x1, ye, 0), P(x1, ye + 0.03, 0), P(x1, ye + 0.03, zw(ye + 0.03)), P(x1, ye, zw(ye))], '#ffffff');
      }
      c.restore();
      // Kleckse vorne
      c.save(); poly(c, left); c.clip();
      splash(P(1.3, y1, 6), 2.4, paints[0], 1);
      splash(P(0.24, y1, 21), 2, paints[2], 8);
      if (L >= 2) splash(P(1.24, y1, 19), 2, paints[4], 3);
      c.restore();

      // Großes Atelierfenster vorne
      const wx0 = 0.32, wx1 = 1.14, wz0 = 6, wz1 = 21;
      faceY(c, y1, wx0, wx1, wz0, wz1, '#ffffff', OL);
      faceY(c, y1, wx0 + 0.05, wx1 - 0.05, wz0 + 1.6, wz1 - 1.6, '#8fd0f2');
      poly(c, [P(wx0 + 0.1, y1, wz0 + 2), P(wx0 + 0.26, y1, wz0 + 2), P(wx0 + 0.48, y1, wz1 - 2), P(wx0 + 0.32, y1, wz1 - 2)], 'rgba(255,255,255,0.45)');
      for (const x of [0.525, 0.73, 0.935]) line(c, P(x, y1, wz0 + 1), P(x, y1, wz1 - 1), '#ffffff', 1.3);
      line(c, P(wx0 + 0.04, y1, 13.5), P(wx1 - 0.04, y1, 13.5), '#ffffff', 1.3);
      faceY(c, y1, wx0 - 0.04, wx1 + 0.04, wz0 - 2, wz0, shade(door, 0.15), OL);
      // Tür rechts mit Palette darüber
      faceX(c, x1, 0.98, 1.22, 0, 16, door, OL);
      faceX(c, x1, 1.02, 1.18, 9, 13.5, '#bfe3f5');
      circle(c, ...P(x1, 1.02, 8), 1.1, '#fcd34d');
      const pp = P(x1, 1.1, 20.2);
      c.beginPath(); c.ellipse(pp[0], pp[1], 6.2, 3.3, -0.4, 0, 7); c.fillStyle = '#e9c38b'; c.fill(); c.strokeStyle = OL; c.lineWidth = 1; c.stroke();
      circle(c, pp[0] + 2.8, pp[1] - 0.6, 1.1, shade(wall, -0.3));
      for (let i = 0; i < 4; i++) circle(c, pp[0] - 3.8 + i * 1.9, pp[1] + 1.4 - i * 1, 1.1, paints[i]);

      // Pultdach mit Oberlicht
      const o = 0.12;
      const ra = P(x0 - o, y0 - o, zr(y0 - o)), rb = P(x1 + o, y0 - o, zr(y0 - o)), rc = P(x1 + o, y1 + o, zr(y1 + o)), rd = P(x0 - o, y1 + o, zr(y1 + o));
      poly(c, [ra, rb, rc, rd], roof, OL, 1.3);
      poly(c, [rd, rc, [rc[0], rc[1] + 3], [rd[0], rd[1] + 3]], shade(roof, -0.35), OL, 1);
      poly(c, [rc, rb, [rb[0], rb[1] + 3], [rc[0], rc[1] + 3]], shade(roof, -0.45), OL, 1);
      c.globalAlpha = 0.25;
      for (let x = x0 + 0.2; x < x1; x += 0.24) line(c, P(x, y0 - o, zr(y0 - o)), P(x, y1 + o, zr(y1 + o)), shade(roof, -0.5), 1);
      c.globalAlpha = 1;
      const sky = (xa, xb) => {
        const ya = 0.36, yb = 0.92;
        poly(c, [P(xa, ya, zr(ya) + 1), P(xb, ya, zr(ya) + 1), P(xb, yb, zr(yb) + 1), P(xa, yb, zr(yb) + 1)], '#f8fafc', OL, 1);
        poly(c, [P(xa + 0.05, ya + 0.06, zr(ya) + 1.5), P(xb - 0.05, ya + 0.06, zr(ya) + 1.5), P(xb - 0.05, yb - 0.06, zr(yb) + 1.5), P(xa + 0.05, yb - 0.06, zr(yb) + 1.5)], '#7cc4ea');
        line(c, P(xa + 0.1, yb - 0.1, zr(yb) + 1.5), P(xa + 0.22, ya + 0.1, zr(ya) + 1.5), 'rgba(255,255,255,0.7)', 1.6);
      };
      if (st < 2) sky(0.42, 1.1); else { sky(0.3, 0.74); sky(0.84, 1.28); }
      if (L >= 3) cylinder(c, 1.22, 0.38, 0.05, zr(0.38) - 2, 10, '#9ca3af', '#4b5563'); // Ofenrohr
      if (L >= 9) { // Lichterkette an der Dachkante
        const a = P(x0 - o, y1 + o, zr(y1 + o) - 3), b = P(x1 + o, y1 + o, zr(y1 + o) - 3);
        for (let i = 0; i <= 9; i++) {
          const u = i / 9, sag = Math.sin(u * Math.PI * 3) * 1.2;
          circle(c, a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u + 0.5 + Math.abs(sag) * 0.6, 1.4, ['#fde047', '#f472b6', '#60a5fa', '#4ade80'][i % 4]);
        }
      }

      // Markise über dem Fenster (flach, damit die Scheiben frei bleiben)
      if (L >= 4) {
        const n = 6, cols = ['#ef4444', '#f97316', '#facc15', '#22c55e', '#3b82f6', '#a855f7'];
        const ax = wx0 - 0.04, aw = (wx1 - wx0 + 0.08) / n, ad = 0.1, za = 26.5, zb = 24.6;
        for (let i = 0; i < n; i++) poly(c, [P(ax + i * aw, y1, za), P(ax + (i + 1) * aw, y1, za), P(ax + (i + 1) * aw, y1 + ad, zb), P(ax + i * aw, y1 + ad, zb)], cols[i]);
        poly(c, [P(ax, y1, za), P(ax + n * aw, y1, za), P(ax + n * aw, y1 + ad, zb), P(ax, y1 + ad, zb)], null, OL, 1);
        for (let i = 0; i < n; i++) {
          const q = P(ax + (i + 0.5) * aw, y1 + ad, zb);
          c.beginPath(); c.arc(q[0], q[1], 1.5, 0, Math.PI); c.fillStyle = cols[i]; c.fill(); c.strokeStyle = OL; c.lineWidth = 0.8; c.stroke();
        }
      }
      // Farbtöpfe
      const pots = L >= 3 ? 3 : 2;
      for (let i = 0; i < pots; i++) {
        const px = [0.14, 0.2, 0.12][i], py = [1.42, 1.58, 1.74][i];
        cylinder(c, px, py, 0.07, st === 2 ? 2 : 0, 6, '#cbd5e1', paints[i]);
        if (i === 1) line(c, P(px, py, 6), P(px + 0.08, py - 0.1, 15), '#a16207', 1.4);
      }
      // Skulptur neben der Tür
      if (L >= 7) {
        box(c, 1.58, 0.56, 1.82, 0.8, 0, 8, '#f5f5f4');
        const q = P(1.7, 0.68, 8);
        const cap = c.lineCap; c.lineCap = 'round';
        c.beginPath(); c.moveTo(q[0] - 2, q[1]); c.bezierCurveTo(q[0] - 9, q[1] - 8, q[0] + 8, q[1] - 12, q[0] + 1, q[1] - 22);
        c.strokeStyle = OL; c.lineWidth = 5.6; c.stroke(); c.strokeStyle = '#ec4899'; c.lineWidth = 3.6; c.stroke();
        c.lineCap = cap;
        circle(c, q[0] + 1, q[1] - 24, 3, '#facc15', OL, 1);
        circle(c, q[0], q[1] - 25, 1, 'rgba(255,255,255,0.7)');
      }
      if (L >= 9) { // Blumenkübel
        cylinder(c, 1.76, 0.3, 0.11, 0, 7, '#c2410c');
        bush(c, ...P(1.76, 0.3, 7), 0.5, '#f472b6');
      }
      if (L >= 5) { // Hocker
        const q = P(1.08, 1.56, st === 2 ? 8 : 6);
        for (const d of [-3.5, 3.5]) line(c, [q[0] + d * 0.6, q[1]], [q[0] + d, q[1] + 6], '#7a4a21', 1.3);
        cylinder(c, 1.08, 1.56, 0.08, st === 2 ? 8 : 6, 2, '#b07a45');
      }
      // Staffeleien
      easel(0.56, 1.8, 0);
      if (L >= 4) easel(1.58, 1.84, 1);
    },

    // Skulpturengarten (3×3)
    sculpture(c, L) {
      const st = stageOf(L);
      const gravel = ['#e6d6b0', '#ebdfc3', '#efe8da'][st];
      const stone = ['#cfcac0', '#ece7df', '#f6f3ee'][st];
      const hedgeCol = ['#4a9a3e', '#43933a', '#3d8c37'][st];
      groundPatch(c, 0.08, 0.08, 2.92, 2.92, '#9fd47a', '#7fb85a');
      // Wege & Platz
      quad(c, 1.28, 0.08, 1.72, 2.92, 0, gravel);
      quad(c, 0.08, 1.28, 2.92, 1.72, 0, gravel);
      ellipseG(c, 1.5, 1.5, 0.56, 0, gravel);
      const ed = shade(gravel, -0.22);
      for (const [a, b] of [[[1.28, 0.08], [1.28, 1.1]], [[1.72, 0.08], [1.72, 1.1]], [[1.28, 1.9], [1.28, 2.92]], [[1.72, 1.9], [1.72, 2.92]],
        [[0.08, 1.28], [1.1, 1.28]], [[0.08, 1.72], [1.1, 1.72]], [[1.9, 1.28], [2.92, 1.28]], [[1.9, 1.72], [2.92, 1.72]]]) line(c, P(...a), P(...b), ed, 1.1);
      if (st === 2) { // Pflasterring
        ellipseG(c, 1.5, 1.5, 0.56, 0, null, '#c9b99a', 2.2);
        ellipseG(c, 1.5, 1.5, 0.4, 0, null, 'rgba(160,140,110,0.35)', 1);
      }
      c.globalAlpha = 0.5;
      for (let i = 0; i < 18; i++) {
        const u = hash(i, 1, 21), v = hash(i, 2, 21);
        const p = i % 2 ? P(1.32 + u * 0.36, 0.15 + v * 2.7) : P(0.15 + v * 2.7, 1.32 + u * 0.36);
        circle(c, p[0], p[1], 1, shade(gravel, -0.25));
      }
      c.globalAlpha = 1;
      if (st >= 1) { // Blümchen im Rasen
        const cols = ['#f472b6', '#facc15', '#ffffff', '#a78bfa'];
        for (let i = 0; i < 14; i++) {
          const q = (i % 4), bx = q % 2 ? 1.85 : 0.35, by = q > 1 ? 1.85 : 0.35;
          const p = P(bx + hash(i, 3, 22) * 0.8, by + hash(i, 4, 22) * 0.8);
          circle(c, p[0], p[1], 1.3, cols[i % 4]);
        }
      }
      const hedge = (xa, ya, xb, yb, h) => {
        box(c, xa, ya, xb, yb, 0, h, hedgeCol, { top: shade(hedgeCol, 0.18) });
        if (st === 2) for (let i = 0; i < 3; i++) circle(c, ...P(xa + (xb - xa) * (0.2 + i * 0.3), ya + (yb - ya) * (0.2 + i * 0.3), h + 0.5), 1.4, ['#f472b6', '#fde047', '#ffffff'][i]);
      };
      const hh = 7 + st;
      hedge(0.12, 0.12, 0.3, 1.2, hh); hedge(0.3, 0.12, 1.2, 0.3, hh);
      hedge(1.8, 0.12, 2.88, 0.3, hh); hedge(0.12, 1.8, 0.3, 2.88, hh);
      const ped = (x, y, s, h, col) => {
        box(c, x - s, y - s, x + s, y + s, 0, h, col);
        if (st === 2) { line(c, P(x - s, y + s, h - 1.5), P(x + s, y + s, h - 1.5), '#e0b53a', 1.4); line(c, P(x + s, y + s, h - 1.5), P(x + s, y - s, h - 1.5), '#c99a2a', 1.4); }
        return P(x, y, h);
      };
      const lamp = (x, y) => {
        const p = P(x, y);
        line(c, p, [p[0], p[1] - 22], '#334155', 2);
        c.fillStyle = '#fde68a'; rr(c, p[0] - 3, p[1] - 28, 6, 7, 1.6); c.fill(); c.strokeStyle = '#1f2937'; c.lineWidth = 1.1; c.stroke();
        poly(c, [[p[0] - 4.5, p[1] - 28], [p[0] + 4.5, p[1] - 28], [p[0], p[1] - 32]], '#1f2937');
      };
      const limb = (pts, w, col) => {
        const cap = c.lineCap; c.lineCap = 'round';
        c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
        c.strokeStyle = OL; c.lineWidth = w + 2; c.stroke();
        c.strokeStyle = col; c.lineWidth = w; c.stroke();
        c.lineCap = cap;
      };
      const cypress = (x, y, s) => {
        const p = P(x, y);
        c.globalAlpha = 0.18; c.beginPath(); c.ellipse(p[0] + 3, p[1], 7 * s, 3 * s, 0, 0, 7); c.fillStyle = '#10240a'; c.fill(); c.globalAlpha = 1;
        c.beginPath(); c.moveTo(p[0] - 5 * s, p[1] - 3); c.quadraticCurveTo(p[0] - 7 * s, p[1] - 22 * s, p[0], p[1] - 38 * s); c.quadraticCurveTo(p[0] + 7 * s, p[1] - 22 * s, p[0] + 5 * s, p[1] - 3); c.closePath();
        c.fillStyle = '#2f6e34'; c.fill(); c.strokeStyle = OL; c.lineWidth = 1.1; c.stroke();
        c.beginPath(); c.moveTo(p[0] - 3 * s, p[1] - 6); c.quadraticCurveTo(p[0] - 5 * s, p[1] - 22 * s, p[0], p[1] - 36 * s); c.quadraticCurveTo(p[0] - 1 * s, p[1] - 20 * s, p[0] - 0.5 * s, p[1] - 6); c.closePath();
        c.fillStyle = '#3f8a43'; c.fill();
      };

      // hinten: Zypresse & Büste
      cypress(0.48, 1.0, 1);
      {
        const q = L >= 9 ? ped(1.17, 0.45, 0.15, 14, stone) : ped(1.1, 0.48, 0.15, 14, stone);
        const m = '#f5f3ef';
        c.beginPath(); c.moveTo(q[0] - 9, q[1] - 1); c.quadraticCurveTo(q[0] - 9, q[1] - 9, q[0], q[1] - 9.5); c.quadraticCurveTo(q[0] + 9, q[1] - 9, q[0] + 9, q[1] - 1); c.closePath();
        c.fillStyle = m; c.fill(); c.strokeStyle = OL; c.lineWidth = 1.1; c.stroke();
        c.beginPath(); c.moveTo(q[0] + 2, q[1] - 9.3); c.quadraticCurveTo(q[0] + 9, q[1] - 9, q[0] + 9, q[1] - 1); c.lineTo(q[0] + 4, q[1] - 1); c.closePath(); c.fillStyle = '#d6d3cd'; c.fill();
        c.fillStyle = '#e7e4de'; c.fillRect(q[0] - 2, q[1] - 13, 4, 4.5);
        c.beginPath(); c.ellipse(q[0], q[1] - 16.5, 4.6, 5.6, 0, 0, 7); c.fillStyle = m; c.fill(); c.stroke();
        c.beginPath(); c.ellipse(q[0], q[1] - 16.5, 4.6, 5.6, 0, -1.2, 1.4); c.fillStyle = '#d6d3cd'; c.fill();
        c.beginPath(); c.ellipse(q[0], q[1] - 19, 5, 3.6, 0, Math.PI, 0); c.fillStyle = '#e2ded7'; c.fill(); c.stroke();
        poly(c, [[q[0] - 4.4, q[1] - 17], [q[0] - 6.2, q[1] - 14.5], [q[0] - 4.4, q[1] - 14]], m, OL, 0.8);
        if (st === 2) { c.beginPath(); c.ellipse(q[0], q[1] - 21.5, 5, 2, 0, Math.PI, 0); c.strokeStyle = '#4caf50'; c.lineWidth = 1.6; c.stroke(); } // Lorbeerkranz
      }
      // rechts: bunte Schleife
      if (L >= 3) {
        const q = ped(2.28, 0.72, 0.16, 9, ['#64748b', '#475569', '#334155'][st]);
        const ring = (cx, cy, rx, ry, rot, col, a0, a1) => {
          c.beginPath(); c.ellipse(cx, cy, rx, ry, rot, a0, a1);
          c.strokeStyle = OL; c.lineWidth = 6.4; c.stroke();
          c.strokeStyle = col; c.lineWidth = 4.2; c.stroke();
        };
        ring(q[0] - 1.5, q[1] - 15, 6.5, 12, 0.5, '#ef4444', 0, Math.PI * 2);
        ring(q[0] + 2, q[1] - 14, 6.5, 11, -0.6, '#3b82f6', 0, Math.PI * 2);
        ring(q[0] - 1.5, q[1] - 15, 6.5, 12, 0.5, '#ef4444', 0.2, 1.4);
        circle(c, q[0] + 1, q[1] - 29, 3.2, '#facc15', OL, 1);
        c.lineWidth = 1.2; c.strokeStyle = 'rgba(255,255,255,0.55)';
        c.beginPath(); c.ellipse(q[0] - 1.5, q[1] - 15, 6.5, 12, 0.5, 3.6, 4.4); c.stroke();
      }
      // links: Bronzefigur
      if (L >= 5) {
        const q = ped(0.72, 2.28, 0.16, 12, stone);
        const br = st === 2 ? '#c27c3a' : '#b06d32';
        limb([[q[0] - 3, q[1] - 1], [q[0] - 1.5, q[1] - 11]], 2.6, shade(br, -0.15));
        limb([[q[0] + 3.5, q[1] - 2], [q[0] + 4, q[1] - 6.5], [q[0] + 1, q[1] - 11]], 2.6, br);
        limb([[q[0] - 0.5, q[1] - 11], [q[0] + 0.5, q[1] - 19]], 4.6, br);
        limb([[q[0] - 1, q[1] - 18], [q[0] - 6.5, q[1] - 15]], 2.2, shade(br, -0.1));
        limb([[q[0] + 1.5, q[1] - 18], [q[0] + 5, q[1] - 26]], 2.2, br);
        circle(c, q[0] + 1, q[1] - 23, 3.1, br, OL, 1);
        line(c, [q[0] - 0.8, q[1] - 18], [q[0] - 0.3, q[1] - 12], '#e7b07a', 1);
        circle(c, q[0], q[1] - 24, 1, '#e7b07a');
      }
      lamp(1.84, 2.86);
      // Mitte: Beet, goldene Statue, Brunnen
      if (L >= 9) {
        cylinder(c, 1.5, 1.5, 0.5, 0, 6, '#d6d3d1', '#5ec8f0');
        ellipseG(c, 1.5, 1.5, 0.42, 6, null, 'rgba(255,255,255,0.5)', 1);
      }
      if (L >= 7) {
        const q = ped(1.5, 1.5, 0.13, 16, L >= 9 ? '#e7e5e4' : '#57534e');
        const g = '#f5c542', gd = '#c9921f';
        limb([[q[0] - 2, q[1] - 1], [q[0] - 2, q[1] - 11]], 2.6, gd);
        limb([[q[0] + 2, q[1] - 1], [q[0] + 2, q[1] - 11]], 2.6, g);
        limb([[q[0], q[1] - 10], [q[0], q[1] - 20]], 5.2, g);
        limb([[q[0] - 2, q[1] - 18], [q[0] - 6, q[1] - 27]], 2.2, gd);
        limb([[q[0] + 2, q[1] - 18], [q[0] + 6, q[1] - 27]], 2.2, g);
        circle(c, q[0], q[1] - 23.5, 3.2, g, OL, 1);
        line(c, [q[0] - 1, q[1] - 19], [q[0] - 1, q[1] - 12], '#fff3b0', 1.2);
        const sx = q[0], sy = q[1] - 33; // Stern
        c.beginPath();
        for (let i = 0; i < 10; i++) { const r = i % 2 ? 2.4 : 5.6, a = -Math.PI / 2 + i * Math.PI / 5; c.lineTo(sx + Math.cos(a) * r, sy + Math.sin(a) * r); }
        c.closePath(); c.fillStyle = '#fde047'; c.fill(); c.strokeStyle = OL; c.lineWidth = 1; c.stroke();
      } else { // Blumenbeet
        ellipseG(c, 1.5, 1.5, 0.3, 0, '#7b4a26', '#5b3519', 1.1);
        const cols = ['#f43f5e', '#facc15', '#ffffff', '#a855f7', '#fb923c'];
        for (let i = 0; i < 7; i++) {
          const a = i / 7 * 6.28, p = P(1.5 + Math.cos(a) * 0.17, 1.5 + Math.sin(a) * 0.17);
          line(c, p, [p[0], p[1] - 4], '#2f7d32', 1.1);
          circle(c, p[0], p[1] - 5, 2, cols[i % 5], OL, 0.6);
        }
        bush(c, ...P(1.5, 1.5), 0.42, '#3f9a35');
      }
      lamp(2.86, 1.84);
      // vorne: Steinstapel
      {
        const p = L >= 9 ? P(2.46, 2.46) : P(2.3, 2.3);
        c.beginPath(); c.ellipse(p[0], p[1], 12, 5.5, 0, 0, 7); c.fillStyle = '#b9b2a5'; c.fill(); c.strokeStyle = OL; c.lineWidth = 1; c.stroke();
        const stones = [[0, 2, 9.5, 4.2, '#8d939c'], [-1.2, 7.5, 7.8, 3.6, '#b8b2a7'], [1, 12, 6.2, 3.1, '#9ca3af'], [-0.5, 16, 4.6, 2.6, '#c9c3b8']];
        if (L >= 3) stones.push([0.6, 19.4, 3.2, 2.1, st === 2 ? '#f5c542' : '#a8a29e']);
        for (const [dx, dz, rx, ry, col] of stones) {
          c.beginPath(); c.ellipse(p[0] + dx, p[1] - dz, rx, ry, 0, 0, 7); c.fillStyle = col; c.fill(); c.strokeStyle = OL; c.lineWidth = 1; c.stroke();
          c.beginPath(); c.ellipse(p[0] + dx - rx * 0.3, p[1] - dz - ry * 0.35, rx * 0.4, ry * 0.3, 0, 0, 7); c.fillStyle = 'rgba(255,255,255,0.3)'; c.fill();
        }
      }
      // niedrige Hecken vorne
      if (st >= 1) {
        hedge(2.72, 0.3, 2.88, 1.04, 5); hedge(2.72, 1.96, 2.88, 2.88, 5);
        hedge(0.3, 2.72, 1.04, 2.88, 5); hedge(1.96, 2.72, 2.72, 2.88, 5);
      }
    },

    // Töpferei (3×3)
    pottery(c, L) {
      const st = stageOf(L);
      const wall = ['#df9566', '#eaa874', '#f6e3c4'][st];
      const roof = ['#c4552c', '#b8462a', '#a63c24'][st];
      const brick = '#b4532f';
      const wood = '#a8743f';
      const glaze = ['#2563eb', '#14b8a6', '#facc15', '#ef4444', '#c2652f', '#16a34a', '#f8fafc', '#8b5cf6'];
      const x0 = 0.3, y0 = 0.3, x1 = 1.8, y1 = 1.45, wh = 30, rh = 22, ym = (y0 + y1) / 2;
      // Gefäß: Bodenmitte p, Form k, Farbe, Größe s
      const vase = (p, k, col, s) => {
        const x = p[0], y = p[1];
        c.beginPath();
        if (k === 0) { c.moveTo(x - 2 * s, y); c.quadraticCurveTo(x - 5 * s, y - 3.5 * s, x - 2 * s, y - 6.5 * s); c.lineTo(x + 2 * s, y - 6.5 * s); c.quadraticCurveTo(x + 5 * s, y - 3.5 * s, x + 2 * s, y); }
        else if (k === 1) { c.moveTo(x - 1.8 * s, y); c.quadraticCurveTo(x - 4.2 * s, y - 5 * s, x - 1.1 * s, y - 8 * s); c.lineTo(x - 2.2 * s, y - 10 * s); c.lineTo(x + 2.2 * s, y - 10 * s); c.lineTo(x + 1.1 * s, y - 8 * s); c.quadraticCurveTo(x + 4.2 * s, y - 5 * s, x + 1.8 * s, y); }
        else { c.moveTo(x - 4.5 * s, y - 4 * s); c.quadraticCurveTo(x, y + 2 * s, x + 4.5 * s, y - 4 * s); }
        c.closePath();
        c.fillStyle = col; c.fill(); c.strokeStyle = OL; c.lineWidth = 0.9; c.stroke();
        c.fillStyle = 'rgba(255,255,255,0.5)'; c.fillRect(x - 2 * s, y - (k === 1 ? 6.5 : k === 0 ? 5 : 3.5) * s, 1.1 * s, 2.4 * s);
      };
      // Regal mit Gefäßen (vorne offen)
      const shelf = (xa, xb, y, seed) => {
        for (const x of [xa, xb]) box(c, x - 0.03, y - 0.12, x + 0.03, y + 0.06, 0, 25, wood);
        for (let j = 0; j < 3; j++) {
          const z = 2 + j * 10;
          box(c, xa - 0.03, y - 0.12, xb + 0.03, y + 0.06, z, 1.8, '#c08850');
          const k = Math.round((xb - xa) / 0.2);
          for (let i = 0; i < k; i++) {
            if (hash(i, j, seed) < 0.15) continue;
            const p = P(xa + (i + 0.5) * (xb - xa) / k, y - 0.03, z + 1.8);
            vase(p, (hash(i, j, seed + 1) * 3) | 0, glaze[(hash(i, j, seed + 2) * glaze.length) | 0], 0.75);
          }
        }
      };
      const bricks = (xa, ya, xb, yb, z0, z1) => {
        c.globalAlpha = 0.35;
        for (let z = z0 + 4; z < z1; z += 4) { line(c, P(xa, yb, z), P(xb, yb, z), '#5b2410', 0.9); line(c, P(xb, yb, z), P(xb, ya, z), '#5b2410', 0.9); }
        c.globalAlpha = 1;
      };

      shadow(c, 0.3, 0.3, 2.4, 1.6, 0.3);
      groundPatch(c, 0.08, 0.08, 2.92, 2.92, ['#e3cda4', '#e6d1aa', '#e9d6b2'][st]);
      c.globalAlpha = 0.45;
      for (let i = 0; i < 12; i++) circle(c, ...P(0.2 + hash(i, 1, 31) * 2.6, 1.6 + hash(i, 2, 31) * 1.3), 1.2, '#c9a77a');
      c.globalAlpha = 1;
      if (st === 2) quad(c, 1.15, y1, 1.62, 2.1, 0, '#d4a37a', '#b07a45', 1); // Pflaster vor der Tür

      // Haus
      box(c, x0, y0, x1, y1, 0, wh, wall);
      if (st === 2) { // Fachwerk
        const fw = '#7a4a21';
        for (const x of [x0 + 0.04, 0.9, 1.6, x1 - 0.02]) line(c, P(x, y1, 0), P(x, y1, wh), fw, 2);
        for (const y of [y0 + 0.05, 0.85, y1 - 0.02]) line(c, P(x1, y, 0), P(x1, y, wh), fw, 2);
        line(c, P(x0, y1, 15), P(x1, y1, 15), fw, 2); line(c, P(x1, y1, 15), P(x1, y0, 15), fw, 2);
        line(c, P(x0, y1, wh - 1), P(x1, y1, wh - 1), fw, 2); line(c, P(x1, y1, wh - 1), P(x1, y0, wh - 1), fw, 2);
        line(c, P(x1, 0.85, 15), P(x1, y1 - 0.02, wh - 1), fw, 1.6);
      } else {
        c.globalAlpha = 0.18;
        for (let i = 0; i < 8; i++) { const p = P(x0 + 0.1 + hash(i, 5, 31) * 1.3, y1, 4 + hash(i, 6, 31) * 22); c.fillStyle = '#7c2d12'; c.fillRect(p[0], p[1], 4, 2); }
        c.globalAlpha = 1;
      }
      faceY(c, y1, x0, x1, 0, 4, shade(brick, 0.05), OL);
      faceX(c, x1, y0, y1, 0, 4, shade(brick, -0.2), OL);
      // Fenster & Tür vorne
      faceY(c, y1, 0.48, 0.98, 10, 23, '#7a4a21', OL);
      faceY(c, y1, 0.53, 0.93, 11.5, 21.5, '#8fd0f2');
      line(c, P(0.73, y1, 11.5), P(0.73, y1, 21.5), '#7a4a21', 1.3);
      line(c, P(0.53, y1, 16.5), P(0.93, y1, 16.5), '#7a4a21', 1.3);
      faceY(c, y1, 0.44, 1.02, 8, 10, '#c08850', OL);
      if (L >= 5) { // Blumenkasten
        faceY(c, y1, 0.48, 0.98, 6, 8.5, '#7c4a1e', OL);
        for (let i = 0; i < 5; i++) circle(c, ...P(0.53 + i * 0.1, y1, 9.5), 1.6, ['#f43f5e', '#facc15', '#a855f7'][i % 3]);
      }
      faceY(c, y1, 1.2, 1.55, 0, 21, '#6b3f1d', OL);
      faceY(c, y1, 1.25, 1.5, 0, 19, '#8a5530');
      for (const z of [5, 10, 15]) line(c, P(1.25, y1, z), P(1.5, y1, z), '#6b3f1d', 0.8);
      circle(c, ...P(1.45, y1, 10), 1.2, '#fcd34d');
      // Fenster rechts
      faceX(c, x1, 1.0, 1.32, 12, 22, '#7a4a21', OL);
      faceX(c, x1, 1.04, 1.28, 13.5, 20.5, '#5aa7d4');
      // Ziegeldach
      roofX(c, x0, y0, x1, y1, wh, rh, roof, wall, 0.16);
      c.globalAlpha = 0.45;
      const span = y1 + 0.16 - ym;
      for (let k = 1; k < 4; k++) {
        const u = k / 4, y = y1 + 0.16 - u * span, z = wh + u * rh;
        line(c, P(x0 - 0.16, y, z), P(x1 + 0.16, y, z), shade(roof, -0.45), 1.1);
        for (let i = 0; i < 9; i++) {
          const x = x0 - 0.1 + (i + (k % 2) * 0.5) * 0.19;
          if (x < x1 + 0.12) line(c, P(x, y, z), P(x, y + span / 4, z - rh / 4), shade(roof, -0.45), 0.9);
        }
      }
      c.globalAlpha = 1;
      line(c, P(x0 - 0.16, ym, wh + rh), P(x1 + 0.16, ym, wh + rh), shade(roof, -0.5), 2.4);

      // Kamin
      box(c, 1.92, 0.26, 2.16, 0.5, 0, 64, brick, { top: '#3b1a0c' });
      bricks(1.92, 0.26, 2.16, 0.5, 30, 64);
      box(c, 1.89, 0.23, 2.19, 0.53, 61, 4, '#9a4527', { top: '#3b1a0c' });
      // Brennofen: klein bzw. große Kuppel
      if (L < 7) {
        box(c, 1.86, 0.52, 2.38, 1.06, 0, 18, brick);
        bricks(1.86, 0.52, 2.38, 1.06, 0, 18);
        const a = P(2.38, 0.94, 0), b = P(2.38, 0.64, 0), m = P(2.38, 0.79, 12);
        c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(a[0], a[1] - 7); c.quadraticCurveTo(m[0], m[1] - 3, b[0], b[1] - 7); c.lineTo(b[0], b[1]); c.closePath();
        c.fillStyle = '#3b1a0c'; c.fill(); c.strokeStyle = OL; c.lineWidth = 1.1; c.stroke();
        const g = P(2.38, 0.79, 3);
        c.beginPath(); c.ellipse(g[0], g[1], 3.4, 2.4, -0.45, 0, 7); c.fillStyle = '#f97316'; c.fill();
        c.beginPath(); c.ellipse(g[0], g[1], 1.8, 1.2, -0.45, 0, 7); c.fillStyle = '#fde047'; c.fill();
      } else {
        const p = P(2.4, 0.84), rx = 18, ry = 9, h = 27;
        c.beginPath(); c.ellipse(p[0], p[1], rx + 2.5, ry + 1.5, 0, 0, 7); c.fillStyle = '#9a8572'; c.fill(); c.strokeStyle = OL; c.lineWidth = 1; c.stroke();
        c.beginPath(); c.ellipse(p[0], p[1], rx, ry, 0, 0, Math.PI); c.ellipse(p[0], p[1], rx, h, 0, Math.PI, Math.PI * 2);
        const gr = c.createLinearGradient(p[0] - rx, 0, p[0] + rx, 0);
        gr.addColorStop(0, '#d0734a'); gr.addColorStop(0.5, '#b8582f'); gr.addColorStop(1, '#8a3a1c');
        c.fillStyle = gr; c.fill(); c.strokeStyle = OL; c.lineWidth = 1.3; c.stroke();
        c.globalAlpha = 0.35; c.strokeStyle = '#5b2410'; c.lineWidth = 0.9;
        for (const k of [0.3, 0.6, 0.85]) { c.beginPath(); c.ellipse(p[0], p[1] - h * k, rx * Math.sqrt(1 - k * k), ry * 0.5, 0, 0.15, Math.PI - 0.15); c.stroke(); }
        c.globalAlpha = 1;
        // Öffnung nach rechts vorne
        const ox = p[0] + 6;
        c.beginPath(); c.moveTo(ox - 5, p[1] + 7); c.lineTo(ox - 5, p[1] - 3); c.quadraticCurveTo(ox, p[1] - 12, ox + 5, p[1] - 4); c.lineTo(ox + 5, p[1] + 5); c.closePath();
        c.fillStyle = '#3b1a0c'; c.fill(); c.strokeStyle = OL; c.lineWidth = 1; c.stroke();
        c.beginPath(); c.ellipse(ox, p[1] + 2.5, 3.6, 3, 0, 0, 7); c.fillStyle = '#f97316'; c.fill();
        circle(c, ox, p[1] + 3, 1.7, '#fde047');
        box(c, 2.34, 0.78, 2.46, 0.9, 25, 5, brick, { top: '#3b1a0c' });
      }

      // Vordach mit Töpferscheibe
      const cx0 = 2.2, cx1 = 2.82, cy0 = 1.5, cy1 = 2.1, ch = 34;
      const post = (x, y) => box(c, x - 0.035, y - 0.035, x + 0.035, y + 0.035, 0, ch, wood);
      post(cx0, cy0); post(cx1, cy0); post(cx0, cy1);
      cylinder(c, 2.32, 1.8, 0.07, 6, 2, '#b07a45'); // Hocker
      line(c, P(2.32, 1.8, 0), P(2.32, 1.8, 6), '#7a4a21', 1.6);
      box(c, 2.44, 1.68, 2.7, 1.94, 0, 8, '#8b5a2b');
      cylinder(c, 2.57, 1.81, 0.17, 8, 2, '#9ca3af', '#cbd5e1');
      {
        const p = P(2.57, 1.81, 10);
        c.beginPath(); c.moveTo(p[0] - 4, p[1]); c.quadraticCurveTo(p[0] - 5.5, p[1] - 5, p[0] - 3, p[1] - 8); c.lineTo(p[0] + 3, p[1] - 8); c.quadraticCurveTo(p[0] + 5.5, p[1] - 5, p[0] + 4, p[1]); c.closePath();
        c.fillStyle = '#c8763f'; c.fill(); c.strokeStyle = OL; c.lineWidth = 1; c.stroke();
        c.beginPath(); c.ellipse(p[0], p[1] - 8, 3, 1.2, 0, 0, 7); c.fillStyle = '#8a4a22'; c.fill();
      }
      post(cx1, cy1);
      const rz0 = ch + 5, rz1 = ch, o = 0.08;
      const rc = st === 0 ? '#b07a45' : roof;
      poly(c, [P(cx0 - o, cy0 - o, rz0), P(cx1 + o, cy0 - o, rz1), P(cx1 + o, cy1 + o, rz1), P(cx0 - o, cy1 + o, rz0)], rc, OL, 1.2);
      poly(c, [P(cx0 - o, cy1 + o, rz0), P(cx1 + o, cy1 + o, rz1), P(cx1 + o, cy1 + o, rz1 - 2.5), P(cx0 - o, cy1 + o, rz0 - 2.5)], shade(rc, -0.35), OL, 1);
      poly(c, [P(cx1 + o, cy1 + o, rz1), P(cx1 + o, cy0 - o, rz1), P(cx1 + o, cy0 - o, rz1 - 2.5), P(cx1 + o, cy1 + o, rz1 - 2.5)], shade(rc, -0.45), OL, 1);
      c.globalAlpha = 0.35;
      for (let i = 1; i < 4; i++) { const y = cy0 - o + i * (cy1 - cy0 + 2 * o) / 4; line(c, P(cx0 - o, y, rz0), P(cx1 + o, y, rz1), shade(rc, -0.5), 1); }
      c.globalAlpha = 1;
      { // Laterne am Vordach
        const p = P(cx0 + 0.02, cy1 + 0.06, rz0 - 3);
        line(c, p, [p[0], p[1] + 4], '#334155', 1);
        c.fillStyle = '#fde68a'; rr(c, p[0] - 2.5, p[1] + 4, 5, 6, 1.5); c.fill(); c.strokeStyle = '#1f2937'; c.lineWidth = 1; c.stroke();
      }

      // Regal mit Gefäßen
      shelf(0.34, 1.34, 2.3, 7);
      if (L === 3) { // Tonblöcke & Eimer (ab L4 steht dort der Verkaufstisch)
        box(c, 1.62, 2.12, 1.82, 2.3, 0, 5, '#b9876a');
        box(c, 1.65, 2.15, 1.79, 2.27, 5, 4, '#a8765a');
        cylinder(c, 2.0, 2.24, 0.07, 0, 5, '#64748b', '#7cc4ea');
      }
      if (L >= 4) { // Verkaufstisch & Amphoren
        for (const [x, y] of [[2.2, 2.5], [2.76, 2.5], [2.2, 2.78], [2.76, 2.78]]) line(c, P(x, y, 0), P(x, y, 8), '#7a4a21', 1.5);
        box(c, 2.14, 2.44, 2.82, 2.84, 8, 2, '#c08850');
        for (let i = 0; i < 4; i++) vase(P(2.24 + i * 0.16, 2.64, 10), [0, 2, 1, 0][i], glaze[[1, 2, 0, 3][i]], 0.8);
        vase(P(0.24, 2.72), 1, '#c2652f', 1.4);
        vase(P(0.5, 2.82), 0, '#2563eb', 1.3);
      }
      if (L >= 7) { // Blumentopf & Schild
        vase(P(1.1, y1 + 0.12), 0, '#c2652f', 1);
        bush(c, ...P(1.1, y1 + 0.12, 5), 0.32, '#f472b6');
        line(c, P(1.74, y1, 28.5), P(1.74, y1 + 0.26, 28.5), '#3f3f46', 1.4);
        faceX(c, 1.74, y1 + 0.03, y1 + 0.23, 19, 28, '#f8fafc', OL);
        vase(P(1.74, y1 + 0.13, 20.3), 1, '#c2652f', 0.7);
      }
      if (L >= 9) { // Mosaikband & Prunkvase
        for (let i = 0; i < 10; i++) faceY(c, y1, x0 + i * 0.15, x0 + (i + 1) * 0.15, 25.5, 28.5, ['#2563eb', '#f8fafc', '#14b8a6', '#facc15'][i % 4]);
        vase(P(1.72, 2.22), 1, '#1d4ed8', 1.5);
        line(c, P(1.72, 2.22, 6), P(1.72, 2.22, 8), '#facc15', 3);
      }
    },
  

    // ---- Bedürfnis-Gebäude: party ----
    // Grillplatz (2×2)
    bbq(c, L) {
      const st = stageOf(L), big = L >= 4;
      const pave = ['#dccaa4', '#d3cab8', '#dfae84'][st];
      shadow(c, 0.25, 0.25, 1.85, 1.85, 0.18);
      groundPatch(c, 0.08, 0.08, 1.92, 1.92, pave);
      c.globalAlpha = 0.45;
      if (st === 0) { // Kies
        for (let i = 0; i < 14; i++) circle(c, ...P(0.2 + hash(i, 5, 31) * 1.6, 0.2 + hash(i, 6, 31) * 1.6), 1.2, '#a8956f');
      } else { // Platten
        const s = st === 1 ? 0.36 : 0.3;
        for (let v = 0.08 + s; v < 1.9; v += s) { line(c, P(v, 0.08), P(v, 1.92), shade(pave, -0.28), 0.9); line(c, P(0.08, v), P(1.92, v), shade(pave, -0.28), 0.9); }
      }
      c.globalAlpha = 1;
      if (L >= 9) bush(c, ...P(0.22, 0.28), 0.55, '#3f9a35');
      // Gemauerter Grill hinten rechts (ab L7 Naturstein mit Haube)
      const brick = st === 2 ? '#bfb4a2' : '#c45a3c';
      const gx0 = big ? 0.86 : 1.02, gx1 = 1.84, gy0 = 0.22, gy1 = big ? 0.74 : 0.68, gh = big ? 14 : 12;
      const mort = (x0, x1, y0, y1, z0, z1) => {
        c.globalAlpha = 0.35;
        for (let z = z0 + 3.5; z < z1 - 1; z += 3.5) { line(c, P(x0, y1, z), P(x1, y1, z), shade(brick, -0.55), 0.8); line(c, P(x1, y1, z), P(x1, y0, z), shade(brick, -0.6), 0.8); }
        c.globalAlpha = 1;
      };
      if (big) { // Rückwand mit Kamin
        box(c, gx0, 0.1, gx1, gy0, 0, 26, brick);
        mort(gx0, gx1, 0.1, gy0, 0, 26);
        box(c, 1.2, 0.08, 1.5, 0.24, 26, 8, brick);
        box(c, 1.16, 0.04, 1.54, 0.28, 34, 2.5, '#57534e');
      }
      box(c, gx0, gy0, gx1, gy1, 0, gh, brick);
      mort(gx0, gx1, gy0, gy1, 0, gh);
      // Grillbesteck an der Seite
      const sp = P(gx1 + 0.01, gy0 + 0.17, gh - 1), tg = P(gx1 + 0.01, gy0 + 0.33, gh - 1);
      line(c, sp, [sp[0], sp[1] + 6], '#3f3f46', 1.1);
      c.fillStyle = '#a1a1aa'; c.fillRect(sp[0] - 1.6, sp[1] + 6, 3.2, 3.2);
      line(c, tg, [tg[0] - 1.2, tg[1] + 8], '#71717a', 0.9); line(c, tg, [tg[0] + 1.2, tg[1] + 8], '#71717a', 0.9);
      const fx0 = gx0 + 0.1, fx1 = gx1 - 0.1, fy0 = gy0 + 0.07, fy1 = gy1 - 0.07;
      quad(c, fx0, fy0, fx1, fy1, gh, '#2b2420', OL, 1);
      quad(c, fx0 + 0.04, fy0 + 0.03, fx1 - 0.04, fy1 - 0.03, gh, '#7c2d12');
      for (let i = 0; i < 14; i++) circle(c, ...P(fx0 + 0.06 + hash(i, 1, 41) * (fx1 - fx0 - 0.12), fy0 + 0.05 + hash(i, 2, 41) * (fy1 - fy0 - 0.1), gh), 0.9, ['#f97316', '#fbbf24', '#ef4444'][i % 3]);
      for (let x = fx0 + 0.06; x < fx1; x += 0.08) line(c, P(x, fy0, gh + 1.5), P(x, fy1, gh + 1.5), '#a1a1aa', 0.8);
      if (!big) { // aufgeklappter Deckel & Ofenrohr
        poly(c, [P(fx0 - 0.02, fy0, gh), P(fx1 + 0.02, fy0, gh), P(fx1 + 0.02, fy0 - 0.08, gh + 13), P(fx0 - 0.02, fy0 - 0.08, gh + 13)], '#57534e', OL, 1.1);
        poly(c, [P(fx0 + 0.04, fy0 - 0.01, gh + 1.5), P(fx1 - 0.04, fy0 - 0.01, gh + 1.5), P(fx1 - 0.04, fy0 - 0.07, gh + 11.5), P(fx0 + 0.04, fy0 - 0.07, gh + 11.5)], '#78716c');
        line(c, P(fx0 + 0.2, fy0 - 0.09, gh + 14.5), P(fx1 - 0.2, fy0 - 0.09, gh + 14.5), '#d4d4d8', 1.6);
        cylinder(c, gx1 - 0.05, gy0 + 0.06, 0.045, gh, 20, '#71717a', '#3f3f46');
        box(c, gx1 - 0.11, gy0, gx1 + 0.01, gy0 + 0.12, gh + 20, 2, '#52525b');
      }
      // Grillgut: Würstchen, Mais, Spieße
      const ns = L >= 3 ? 4 : 3;
      for (let i = 0; i < ns; i++) {
        const x = fx0 + 0.1 + i * 0.12;
        const a = P(x, fy0 + 0.08, gh + 3), b = P(x, fy0 + 0.3, gh + 3);
        line(c, a, b, '#6b2410', 4); line(c, a, b, '#c2410c', 2.4);
        line(c, [a[0] + 1, a[1] - 0.8], [b[0] + 1, b[1] - 0.8], '#fb923c', 0.8);
      }
      if (L >= 3) { // Maiskolben
        const a = P(fx1 - 0.22, fy0 + 0.06, gh + 3), b = P(fx1 - 0.22, fy1 - 0.04, gh + 3);
        line(c, a, b, '#a16207', 5); line(c, a, b, '#facc15', 3.4);
        line(c, [b[0] - 1, b[1]], [b[0] - 5, b[1] + 3], '#65a30d', 2);
      }
      if (L >= 5) { // Spieße
        for (let k = 0; k < 2; k++) {
          const y = fy1 - 0.08 - k * 0.1;
          line(c, P(fx0 + 0.02, y, gh + 3), P(fx0 + 0.5, y, gh + 3), '#78716c', 0.8);
          for (let j = 0; j < 4; j++) circle(c, ...P(fx0 + 0.1 + j * 0.1, y, gh + 3.5), 1.7, ['#b45309', '#ef4444', '#7c2d12', '#22c55e'][(j + k) % 4], OL, 0.6);
        }
      }
      if (st === 2) { // Abzugshaube aus Kupfer
        poly(c, [P(gx0 + 0.1, gy0, 26), P(gx1 - 0.1, gy0, 26), P(gx1 - 0.04, gy0 + 0.22, 21), P(gx0 + 0.04, gy0 + 0.22, 21)], '#d97706', OL, 1);
        poly(c, [P(gx1 - 0.1, gy0, 26), P(gx1 - 0.04, gy0 + 0.22, 21), P(gx1 - 0.04, gy0 + 0.22, 19), P(gx1 - 0.1, gy0, 24)], '#92400e', OL, 0.8);
      }
      // Pergola (ab L7): hintere Pfosten
      const wood = ['#b07a45', '#a86c3c', '#93603a'][st];
      const px0 = 0.14, px1 = 1.38, py0 = 0.8, py1 = 1.86, pz = 26;
      const post = (x, y) => box(c, x - 0.045, y - 0.045, x + 0.045, y + 0.045, 0, pz, '#b07a45');
      if (L >= 7) { post(px0, py0); post(px1, py0); }
      // Picknicktisch mit Bänken
      const tx0 = 0.24, tx1 = 1.28, ty0 = 1.1, ty1 = 1.5;
      const bench = (y0, y1) => {
        for (const x of [tx0 + 0.1, tx1 - 0.1]) line(c, P(x, y1 - 0.03, 0), P(x, y1 - 0.03, 6), shade(wood, -0.45), 1.6);
        box(c, tx0, y0, tx1, y1, 6, 2, wood);
      };
      bench(0.86, 0.99);
      for (const x of [tx0 + 0.12, tx1 - 0.12]) {
        line(c, P(x, ty0 + 0.04, 0), P(x, ty1 - 0.12, 10), shade(wood, -0.45), 1.6);
        line(c, P(x, ty1 - 0.04, 0), P(x, ty0 + 0.12, 10), shade(wood, -0.35), 1.6);
      }
      box(c, tx0 - 0.04, ty0, tx1 + 0.04, ty1, 10, 2.5, ['#bd8a55', '#b57b48', '#a06a40'][st]);
      if (L >= 5) { // karierte Tischdecke
        quad(c, tx0 + 0.08, ty0 + 0.02, tx1 - 0.08, ty1 - 0.02, 12.6, '#fef2f2');
        c.globalAlpha = 0.75;
        for (let x = tx0 + 0.08; x < tx1 - 0.1; x += 0.2) quad(c, x, ty0 + 0.02, x + 0.1, ty1 - 0.02, 12.6, '#ef4444');
        c.globalAlpha = 1;
        faceY(c, ty1 - 0.02, tx0 + 0.08, tx1 - 0.08, 9.5, 12.6, '#dc2626');
      } else {
        c.globalAlpha = 0.35;
        for (let y = ty0 + 0.1; y < ty1 - 0.02; y += 0.1) line(c, P(tx0 - 0.04, y, 12.5), P(tx1 + 0.04, y, 12.5), shade(wood, -0.5), 0.8);
        c.globalAlpha = 1;
      }
      // Gedeck: Teller, Becher, Ketchup & Senf
      for (const [x, y] of [[0.48, 1.2], [0.98, 1.2], [0.72, 1.4]]) {
        const p = P(x, y, 12.6);
        c.beginPath(); c.ellipse(p[0], p[1], 4, 2, 0, 0, 7); c.fillStyle = '#ffffff'; c.fill(); c.strokeStyle = OL; c.lineWidth = 0.7; c.stroke();
        circle(c, p[0] + 0.5, p[1] - 0.6, 1.2, '#b45309');
      }
      for (const [x, y, col, h] of [[0.68, 1.22, '#dc2626', 6], [0.76, 1.24, '#facc15', 6], [1.14, 1.38, '#fde68a', 4.5]]) {
        const p = P(x, y, 12.6);
        c.fillStyle = col; rr(c, p[0] - 1.3, p[1] - h, 2.6, h, 0.8); c.fill(); c.strokeStyle = OL; c.lineWidth = 0.7; c.stroke();
      }
      // Windlicht
      const wl = P(0.3, 1.38, 12.6);
      c.fillStyle = 'rgba(255,240,200,0.75)'; rr(c, wl[0] - 2, wl[1] - 6, 4, 6, 1); c.fill(); c.strokeStyle = OL; c.lineWidth = 0.7; c.stroke();
      circle(c, wl[0], wl[1] - 2.6, 1.1, '#f59e0b');
      bench(1.62, 1.75);
      if (L >= 7) { post(px0, py1); post(px1, py1); }
      // Kühlbox bzw. Fass rechts vorne
      if (L >= 3) {
        box(c, 1.5, 1.22, 1.82, 1.48, 0, 7, '#2563eb', { top: '#f8fafc' });
        faceY(c, 1.48, 1.5, 1.82, 5, 7, '#f8fafc');
      }
      if (L >= 5) { cylinder(c, 1.68, 0.98, 0.11, 0, 9, '#9a6436', '#c08850'); line(c, P(1.57, 0.98, 3), P(1.68, 1.09, 3), '#57534e', 0.8); }
      // Pergola-Dach mit Latten (L7), Weinranken (L9)
      if (L >= 7) {
        for (const y of [py0, py1]) box(c, px0 - 0.1, y - 0.035, px1 + 0.1, y + 0.035, pz - 2.5, 2.5, '#c08850');
        // nur wenige dünne Latten, damit Teller und Windlicht sichtbar bleiben
        for (const x of [0.17, 0.48, 0.79, 1.27]) { const a = P(x, py0 - 0.12, pz + 0.8), b = P(x, py1 + 0.12, pz + 0.8); line(c, a, b, OL, 3); line(c, a, b, '#d9a066', 1.6); }
        if (L >= 9) { // Weinranke über die vordere Pfette
          for (let i = 0; i < 8; i++) {
            const p = P(px0 + 0.05 + i * (px1 - px0 - 0.1) / 7, py1 + 0.02, pz + 1);
            const dz = i % 2 ? 6 : 3;
            line(c, [p[0], p[1]], [p[0] + 1, p[1] + dz], '#2f7d32', 1);
            circle(c, p[0] + 1, p[1] + dz, 2.4, i % 2 ? '#4caf3f' : '#3f9a35', OL, 0.6);
            circle(c, p[0], p[1], 2.6, '#4caf3f', OL, 0.6);
            if (i % 3 === 1) circle(c, p[0] + 1.5, p[1] + dz + 1.5, 1.3, '#f472b6');
          }
        }
      }
      // Lichterkette (ab L4)
      if (big) {
        const pole = P(1.86, 1.86);
        line(c, pole, [pole[0], pole[1] - 30], '#57534e', 1.6);
        const chain = (a, b, sag, n) => {
          c.beginPath(); c.moveTo(a[0], a[1]); c.quadraticCurveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + sag * 2, b[0], b[1]);
          c.strokeStyle = '#3f3f46'; c.lineWidth = 0.8; c.stroke();
          const cols = ['#fde047', '#f472b6', '#60a5fa', '#4ade80', '#fb923c'];
          for (let i = 1; i < n; i++) {
            const u = i / n, w = 1 - u;
            const qx = w * w * a[0] + 2 * w * u * (a[0] + b[0]) / 2 + u * u * b[0];
            const qy = w * w * a[1] + 2 * w * u * ((a[1] + b[1]) / 2 + sag * 2) + u * u * b[1];
            circle(c, qx, qy + 1.5, 1.6, cols[i % 5]);
          }
        };
        const top = [pole[0], pole[1] - 30];
        chain(P(1.35, 0.16, 34), top, 6, 7);
        if (L >= 7) chain(top, P(px1, py1, pz + 1), 4, 4);
        else { const lp = P(0.14, 1.86); line(c, lp, [lp[0], lp[1] - 28], '#57534e', 1.6); chain([lp[0], lp[1] - 28], top, 7, 7); }
      }
    },

    // Strandbar (3×3)
    beachbar(c, L) {
      const st = stageOf(L), big = L >= 7;
      const sand = '#f3d99c';
      shadow(c, 0.3, 0.3, 2.8, 2.8, 0.25);
      groundPatch(c, 0.06, 0.06, 2.94, 2.94, sand, '#d6b06a');
      c.globalAlpha = 0.6; c.strokeStyle = '#dcb46c'; c.lineWidth = 1;
      for (let i = 0; i < 8; i++) {
        const p = P(0.3 + hash(i, 1, 23) * 2.4, 1.85 + hash(i, 2, 23) * 1.0);
        c.beginPath(); c.moveTo(p[0] - 5, p[1]); c.quadraticCurveTo(p[0], p[1] - 3, p[0] + 5, p[1]); c.stroke();
      }
      c.globalAlpha = 1;
      if (L >= 3) { // Seestern & Muschel
        const s = P(2.3, 2.75);
        c.beginPath();
        for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? 1.5 : 4; c.lineTo(s[0] + Math.cos(a) * r, s[1] + Math.sin(a) * r * 0.6); }
        c.closePath(); c.fillStyle = '#fb7185'; c.fill(); c.strokeStyle = OL; c.lineWidth = 0.7; c.stroke();
        const m = P(1.2, 2.85);
        c.beginPath(); c.arc(m[0], m[1], 2.6, Math.PI, 0); c.closePath(); c.fillStyle = '#fef3c7'; c.fill(); c.stroke();
      }
      // Hütte
      const hx0 = 0.5, hx1 = 2.45, hy0 = 0.42, hy1 = 1.38;
      const ez = big ? 40 : 37, rz = big ? 61 : 57, o = big ? 0.3 : 0.22;
      const straw = ['#e4b964', '#deb052', '#d9a646'][st];
      const wood = ['#cfa864', '#c99a52', '#8a5a33'][st];
      // Kisten & Fass hinten rechts
      if (L >= 3) {
        box(c, 2.62, 0.22, 2.9, 0.5, 0, 9, '#b07a45');
        line(c, P(2.62, 0.5, 4.5), P(2.9, 0.5, 4.5), '#7a4a21', 0.8);
        cylinder(c, 2.76, 0.78, 0.12, 0, 11, '#9a6436', '#c08850');
      }
      box(c, hx0 - 0.08, hy0 - 0.08, hx1 + 0.08, hy1 + 0.1, 0, 3, '#b98a52');
      faceY(c, hy0, hx0, hx1, 3, ez, shade(wood, -0.35), OL);
      // Regal mit Flaschen (Rückwand)
      for (const z of [16, 24]) {
        line(c, P(hx0 + 0.1, hy0, z), P(hx1 - 0.1, hy0, z), '#6b3f1d', 1.4);
        for (let i = 0; i < 9; i++) {
          const p = P(hx0 + 0.2 + i * 0.19, hy0, z);
          c.fillStyle = ['#16a34a', '#f59e0b', '#7dd3fc', '#dc2626'][(i + z) % 4]; c.fillRect(p[0] - 1, p[1] - 5, 2.2, 5);
        }
      }
      // Seitenwand rechts (Bambus)
      faceX(c, hx1, hy0, hy1, 3, ez, shade(wood, -0.18), OL);
      c.globalAlpha = 0.45;
      for (let y = hy0 + 0.09; y < hy1; y += 0.09) line(c, P(hx1, y, 3), P(hx1, y, ez), shade(wood, -0.5), 0.9);
      c.globalAlpha = 1;
      if (L >= 5) { // Tafel mit Getränkekarte
        faceX(c, hx1 + 0.01, hy0 + 0.25, hy1 - 0.2, 12, 28, '#334155', '#7a4a21');
        for (let k = 0; k < 3; k++) line(c, P(hx1 + 0.02, hy1 - 0.3, 24 - k * 4), P(hx1 + 0.02, hy0 + 0.35 + k * 0.05, 24 - k * 4), ['#fde047', '#f9a8d4', '#86efac'][k], 1);
      }
      // Pfosten vorne
      for (const x of [hx0, hx1]) box(c, x - 0.05, hy1 - 0.05, x + 0.05, hy1 + 0.05, 3, ez - 3, '#a47a42');
      // Theke
      const cy0 = hy1, cy1 = hy1 + 0.26, ch = 18;
      const front = ['#d6b06b', '#2dd4bf', '#7c4a2a'][st];
      box(c, hx0, cy0, hx1, cy1, 3, ch - 3, front, st === 0 ? null : { right: shade(front, -0.3) });
      c.globalAlpha = 0.5;
      for (let x = hx0 + 0.1; x < hx1 - 0.02; x += 0.1) line(c, P(x, cy1, 4), P(x, cy1, ch - 1), shade(front, -0.45), 1);
      c.globalAlpha = 1;
      if (st === 1) { faceY(c, cy1, hx0, hx1, 8, 11, '#f97316'); }
      if (st === 2) { // geschnitztes Tiki-Band
        faceY(c, cy1, hx0, hx1, 7, 13, '#4a2c17');
        const n = 9, wd = (hx1 - hx0) / n;
        for (let i = 0; i < n; i++) { const x = hx0 + i * wd; poly(c, [P(x + 0.03, cy1, 7.5), P(x + wd / 2, cy1, 12.5), P(x + wd - 0.03, cy1, 7.5)], i % 2 ? '#f59e0b' : '#fbbf24'); }
        faceX(c, hx1, cy0, cy1, 7, 13, '#3b2312');
      }
      box(c, hx0 - 0.06, cy0 - 0.03, hx1 + 0.06, cy1 + 0.06, ch, 2.5, ['#e9c88f', '#f5deb3', '#b07a45'][st]);
      // Cocktails
      const drinks = [['#f472b6', 0.8], ['#fb923c', 1.3], ['#38bdf8', 1.8], ['#a3e635', 2.2]].slice(0, L >= 5 ? 4 : L >= 3 ? 3 : 2);
      for (const [col, x] of drinks) {
        const p = P(x, cy0 + 0.16, ch + 2.5);
        poly(c, [[p[0] - 2.6, p[1] - 6], [p[0] + 2.6, p[1] - 6], [p[0] + 1.1, p[1]], [p[0] - 1.1, p[1]]], col, OL, 0.8);
        line(c, [p[0] + 1, p[1] - 5], [p[0] + 3, p[1] - 10], '#ef4444', 0.9);
        poly(c, [[p[0] - 4.5, p[1] - 8], [p[0] + 0.5, p[1] - 11.5], [p[0] + 0.5, p[1] - 7.5]], '#facc15', OL, 0.6);
      }
      if (L >= 6) { // Kokosnuss-Drink
        const p = P(1.05, cy0 + 0.14, ch + 2.5);
        circle(c, p[0], p[1] - 3, 3.2, '#7c4a1e', OL, 0.8); circle(c, p[0], p[1] - 4.5, 1.6, '#fef3c7');
      }
      // Strohdach (Walmdach)
      const rx0 = hx0 + 0.55, rx1 = hx1 - 0.55, ry = (hy0 + hy1) / 2;
      const A = P(hx0 - o, hy0 - o, ez), B = P(hx1 + o, hy0 - o, ez), C = P(hx1 + o, hy1 + o, ez), D = P(hx0 - o, hy1 + o, ez);
      const R0 = P(rx0, ry, rz), R1 = P(rx1, ry, rz);
      poly(c, [A, B, R1, R0], shade(straw, -0.12), OL);
      poly(c, [A, D, R0], shade(straw, -0.08), OL);
      poly(c, [D, C, R1, R0], straw, OL);
      poly(c, [C, B, R1], shade(straw, -0.22), OL);
      const lerp = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
      c.globalAlpha = 0.5;
      for (const u of [0.28, 0.55, 0.8]) {
        line(c, lerp(D, R0, u), lerp(C, R1, u), shade(straw, -0.35), 1);
        line(c, lerp(C, R1, u), lerp(B, R1, u), shade(straw, -0.45), 1);
      }
      c.globalAlpha = 1;
      const fringe = (a, b, n, col) => {
        c.beginPath(); c.moveTo(a[0], a[1]);
        for (let i = 1; i <= n; i++) { const m = lerp(a, b, (i - 0.5) / n), e = lerp(a, b, i / n); c.lineTo(m[0], m[1] + 4); c.lineTo(e[0], e[1]); }
        c.closePath(); c.fillStyle = col; c.fill(); c.strokeStyle = OL; c.lineWidth = 0.8; c.stroke();
      };
      fringe(D, C, big ? 16 : 13, shade(straw, -0.12));
      fringe(C, B, big ? 9 : 7, shade(straw, -0.3));
      line(c, R0, R1, shade(straw, -0.4), 2.4);
      if (big) { // Firstschmuck
        const t = lerp(R0, R1, 0.5);
        line(c, t, [t[0], t[1] - 4], '#7a4a21', 1.4);
        circle(c, t[0], t[1] - 4.5, 2, '#f97316', OL, 0.8);
      }
      // Lichterkette an der Traufe (ab L3)
      if (L >= 3) {
        const cols = ['#fde047', '#f472b6', '#60a5fa', '#4ade80', '#fb923c'];
        const pts = [D, lerp(D, C, 0.33), lerp(D, C, 0.66), C, lerp(C, B, 0.5), B];
        c.strokeStyle = '#3f3f46'; c.lineWidth = 0.8;
        for (let s = 0; s < pts.length - 1; s++) {
          const a = pts[s], b = pts[s + 1];
          c.beginPath(); c.moveTo(a[0], a[1] + 3); c.quadraticCurveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 10, b[0], b[1] + 3); c.stroke();
          for (let k = 1; k < 4; k++) {
            const u = k / 4, w = 1 - u;
            circle(c, w * w * a[0] + 2 * w * u * (a[0] + b[0]) / 2 + u * u * b[0], w * w * (a[1] + 3) + 2 * w * u * ((a[1] + b[1]) / 2 + 10) + u * u * (b[1] + 3) + 1.4, 1.6, cols[(s * 3 + k) % 5]);
          }
        }
      }
      // Surfbrett (L7)
      if (big) {
        const p = P(2.62, 0.95, 0);
        c.save(); c.translate(p[0], p[1] - 17); c.rotate(0.12);
        c.beginPath(); c.ellipse(0, 0, 4.6, 17, 0, 0, 7); c.fillStyle = '#38bdf8'; c.fill(); c.strokeStyle = OL; c.lineWidth = 1; c.stroke();
        c.fillStyle = '#f97316'; c.fillRect(-4.4, -2, 8.8, 3);
        c.restore();
      }
      // Barhocker
      const nst = L >= 5 ? 4 : 3;
      for (let i = 0; i < nst; i++) {
        const x = hx0 + 0.3 + i * (hx1 - hx0 - 0.6) / (nst - 1);
        const p = P(x, cy1 + 0.26);
        c.globalAlpha = 0.18; c.beginPath(); c.ellipse(p[0] + 2, p[1], 5, 2.2, 0, 0, 7); c.fillStyle = '#1f3a10'; c.fill(); c.globalAlpha = 1;
        line(c, p, [p[0], p[1] - 11], '#57534e', 1.6);
        c.beginPath(); c.ellipse(p[0], p[1] - 4, 3, 1.3, 0, 0, 7); c.strokeStyle = '#57534e'; c.lineWidth = 0.9; c.stroke();
        c.beginPath(); c.ellipse(p[0], p[1] - 12, 4.6, 2.3, 0, 0, 7); c.fillStyle = ['#c08850', '#f97316', '#e11d48'][st]; c.fill(); c.strokeStyle = OL; c.lineWidth = 1; c.stroke();
      }
      // Hängematte (ab L5)
      if (L >= 5) {
        const a = P(2.78, 1.95), b = P(2.78, 2.82);
        line(c, a, [a[0], a[1] - 18], '#8b5a2b', 2.2);
        c.beginPath(); c.moveTo(a[0], a[1] - 15); c.quadraticCurveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 2, b[0], b[1] - 15);
        c.quadraticCurveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 7, a[0], a[1] - 15);
        c.fillStyle = '#f43f5e'; c.fill(); c.strokeStyle = OL; c.lineWidth = 1; c.stroke();
        c.beginPath(); c.moveTo(a[0] + 2, a[1] - 13); c.quadraticCurveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 2, b[0] - 2, b[1] - 13);
        c.strokeStyle = '#fde047'; c.lineWidth = 1.4; c.stroke();
        line(c, b, [b[0], b[1] - 18], '#8b5a2b', 2.2);
      }
      // Sonnenschirm mit Sitzsäcken (ab L4)
      if (L >= 4) {
        const bag = (x, y, col) => {
          const p = P(x, y);
          c.globalAlpha = 0.18; c.beginPath(); c.ellipse(p[0] + 2, p[1], 8, 3, 0, 0, 7); c.fillStyle = '#1f3a10'; c.fill(); c.globalAlpha = 1;
          c.beginPath(); c.moveTo(p[0] - 7.5, p[1] - 1.5);
          c.bezierCurveTo(p[0] - 9, p[1] - 9, p[0] - 2, p[1] - 13, p[0] + 1.5, p[1] - 11.5);
          c.bezierCurveTo(p[0] + 6.5, p[1] - 10, p[0] + 9, p[1] - 6, p[0] + 7.5, p[1] - 1.5);
          c.quadraticCurveTo(p[0], p[1] + 2.5, p[0] - 7.5, p[1] - 1.5);
          c.fillStyle = col; c.fill(); c.strokeStyle = OL; c.lineWidth = 1; c.stroke();
          c.beginPath(); c.ellipse(p[0] - 1, p[1] - 5, 4, 2, -0.15, 0, 7); c.fillStyle = shade(col, -0.18); c.fill();
          c.beginPath(); c.ellipse(p[0] - 3, p[1] - 9.5, 2.4, 1.2, -0.4, 0, 7); c.fillStyle = shade(col, 0.45); c.fill();
        };
        bag(1.22, 2.7, '#22d3ee');
        const u = P(1.6, 2.72);
        line(c, u, [u[0], u[1] - 28], '#e5e7eb', 1.6);
        bag(1.98, 2.84, '#a855f7');
        const cp = [u[0], u[1] - 28], cols = st === 2 ? ['#f97316', '#ffffff'] : ['#ef4444', '#ffffff'];
        c.beginPath(); c.moveTo(cp[0] - 17, cp[1] + 6); c.quadraticCurveTo(cp[0], cp[1] - 12, cp[0] + 17, cp[1] + 6);
        c.quadraticCurveTo(cp[0], cp[1] + 2, cp[0] - 17, cp[1] + 6); c.fillStyle = cols[0]; c.fill();
        for (const [a, b] of [[-11, -4], [4, 11]]) poly(c, [[cp[0], cp[1] - 3], [cp[0] + a, cp[1] + 3.5 + Math.abs(a) * 0.12], [cp[0] + b, cp[1] + 3.5 + Math.abs(b) * 0.12]], cols[1]);
        c.beginPath(); c.moveTo(cp[0] - 17, cp[1] + 6); c.quadraticCurveTo(cp[0], cp[1] - 12, cp[0] + 17, cp[1] + 6);
        c.quadraticCurveTo(cp[0], cp[1] + 2, cp[0] - 17, cp[1] + 6); c.strokeStyle = OL; c.lineWidth = 1.1; c.stroke();
        circle(c, cp[0], cp[1] - 3.5, 1.4, '#e5e7eb', OL, 0.7);
      }
      // Palme links
      const pb = P(0.4, 2.55), ph = big ? 58 : 52, lean = -6;
      const pt = [pb[0] + lean, pb[1] - ph];
      c.beginPath(); c.moveTo(pb[0] - 3.2, pb[1]); c.quadraticCurveTo(pb[0] + 4, pb[1] - ph * 0.55, pt[0] - 1.6, pt[1]);
      c.lineTo(pt[0] + 1.6, pt[1]); c.quadraticCurveTo(pb[0] + 9, pb[1] - ph * 0.55, pb[0] + 3.2, pb[1]); c.closePath();
      c.fillStyle = '#a47148'; c.fill(); c.strokeStyle = OL; c.lineWidth = 1.1; c.stroke();
      c.globalAlpha = 0.45;
      for (let i = 1; i < 7; i++) { const u = i / 7, x = pb[0] + (pt[0] - pb[0]) * u * u + 6 * u * (1 - u) * 1.4, y = pb[1] - ph * u; line(c, [x - 2.5, y + 1], [x + 2.5, y - 0.5], '#6b4423', 0.9); }
      c.globalAlpha = 1;
      const leaves = [[-22, 8], [-15, 15], [-2, 16], [13, 13], [21, 5], [10, -6], [-12, -5]];
      for (const [dx, dy] of leaves) {
        c.beginPath(); c.moveTo(pt[0], pt[1]);
        c.quadraticCurveTo(pt[0] + dx * 0.5, pt[1] + dy * 0.1 - 7, pt[0] + dx, pt[1] + dy);
        c.quadraticCurveTo(pt[0] + dx * 0.55, pt[1] + dy * 0.45, pt[0], pt[1] + 2);
        c.fillStyle = dy < 0 ? '#2f8a3a' : '#3fa548'; c.fill(); c.strokeStyle = OL; c.lineWidth = 1; c.stroke();
      }
      circle(c, pt[0] - 2.5, pt[1] + 3, 2.4, '#7c4a1e', OL, 0.8);
      circle(c, pt[0] + 2, pt[1] + 3.5, 2.4, '#6b3f1d', OL, 0.8);
      // Tiki-Fackeln (L7) bzw. eine Fackel
      const torch = (x, y) => {
        const p = P(x, y);
        line(c, p, [p[0], p[1] - 24], '#7a4a21', 2.2);
        c.fillStyle = '#a16207'; rr(c, p[0] - 2.4, p[1] - 29, 4.8, 6, 1.5); c.fill(); c.strokeStyle = OL; c.lineWidth = 0.9; c.stroke();
      };
      torch(1.0, 2.82);
      if (big) { torch(2.85, 2.2); torch(0.2, 1.7); }
    },

    // Festzelt (4×4)
    festtent(c, L) {
      const st = stageOf(L), big = L >= 7;
      const x0 = big ? 0.3 : 0.5, x1 = big ? 3.7 : 3.5, y0 = big ? 0.28 : 0.42, y1 = big ? 3.52 : 3.38;
      const hw = big ? 33 : 32, zr = big ? 61 : 62, xm = (x0 + x1) / 2, o = 0.12;
      const s = (zr - hw) / (xm - x0 + o);
      const tarp = st ? '#fbf8f0' : '#fdf3df', acc = ['#16a34a', '#e11d48', '#2563eb'][st];
      const lerp = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
      shadow(c, 0.3, 0.3, 3.8, 3.8, 0.3);
      groundPatch(c, 0.08, 0.08, 3.92, 3.92, '#d9cba6');
      // Innenraum: Dielen und Innenseite der linken Wand
      quad(c, x0, y0, x1, y1, 0, '#c99a62', OL, 1);
      c.globalAlpha = 0.3;
      for (let x = x0 + 0.24; x < x1 - 0.05; x += 0.24) line(c, P(x, y0), P(x, y1), '#6b3f1d', 0.8);
      c.globalAlpha = 1;
      faceX(c, x0, y0, y1, 0, hw, '#bba98b', OL); // Innenseite im Schatten, damit die Öffnung lesbar ist
      faceX(c, x0, y0, y1, hw - 9, hw, 'rgba(70,45,20,0.22)');
      // Bühne an der linken Wand
      const sx1 = x0 + 1.1, sy0 = y1 - 1.3, sy1 = y1 - 0.05, sh = 6;
      faceX(c, x0 + 0.01, sy0, sy1, sh, hw - 3, ['#9f1239', '#7e22ce', '#1e3a8a'][st]);
      c.globalAlpha = 0.3;
      for (let y = sy0 + 0.14; y < sy1; y += 0.14) line(c, P(x0 + 0.01, y, sh), P(x0 + 0.01, y, hw - 3), '#000000', 0.8);
      c.globalAlpha = 1;
      line(c, P(x0 + 0.01, sy0, hw - 3), P(x0 + 0.01, sy1, hw - 3), '#fbbf24', 1.6);
      box(c, x0, sy0, sx1, sy1, 0, sh, '#5b3a22', { top: '#8b6540' });
      const guy = (x, y, z, shirt, hair, sc) => {
        const p = P(x, y, z);
        line(c, [p[0] - 1.5 * sc, p[1] - 7 * sc], [p[0] - 1.5 * sc, p[1]], '#334766', 2.2 * sc);
        line(c, [p[0] + 1.5 * sc, p[1] - 7 * sc], [p[0] + 1.5 * sc, p[1]], '#334766', 2.2 * sc);
        c.fillStyle = shirt; rr(c, p[0] - 4 * sc, p[1] - 15 * sc, 8 * sc, 9 * sc, 3 * sc); c.fill(); c.strokeStyle = OL; c.lineWidth = 1; c.stroke();
        circle(c, p[0], p[1] - 19 * sc, 3.7 * sc, '#f6d3b3', OL, 1);
        c.fillStyle = hair; c.beginPath(); c.arc(p[0], p[1] - 19.8 * sc, 3.8 * sc, Math.PI * 1.05, -0.05); c.fill();
        return p;
      };
      // Schlagzeug
      const bx = x0 + 0.16, by = sy0 + 0.12; // Band näher an der Öffnung
      guy(bx + 0.26, by + 0.4, sh, '#facc15', '#3b2a1a', 0.85);
      line(c, P(bx + 0.42, by + 0.22, sh), P(bx + 0.42, by + 0.22, sh + 18), '#71717a', 0.9);
      c.beginPath(); c.ellipse(...P(bx + 0.42, by + 0.22, sh + 18), 4.2, 1.4, 0, 0, 7); c.fillStyle = '#fbbf24'; c.fill(); c.strokeStyle = OL; c.lineWidth = 0.7; c.stroke();
      cylinder(c, bx + 0.48, by + 0.46, 0.13, sh, 8, '#dc2626', '#f8fafc');
      cylinder(c, bx + 0.38, by + 0.64, 0.07, sh + 6, 3, '#e5e7eb', '#f8fafc');
      // Gitarrist und Sängerin
      const g = guy(bx + 0.46, by + 0.8, sh, '#22c55e', '#7a4a21', 0.85);
      c.beginPath(); c.ellipse(g[0] + 2, g[1] - 8, 3.4, 2.4, -0.5, 0, 7); c.fillStyle = '#b45309'; c.fill(); c.strokeStyle = OL; c.lineWidth = 0.8; c.stroke();
      line(c, [g[0] + 3, g[1] - 9], [g[0] + 8, g[1] - 14], '#7a4a21', 1.2);
      guy(bx + 0.5, by + 1.1, sh, '#ec4899', '#d9a441', 0.85);
      const mic = P(bx + 0.72, by + 1.1, sh);
      line(c, mic, [mic[0], mic[1] - 15], '#3f3f46', 1);
      circle(c, mic[0] - 1, mic[1] - 16, 1.4, '#3f3f46');
      // Biertische (laufen in die Tiefe)
      for (const tx of [xm - 0.05, xm + 0.85]) {
        const ya = y1 - 1.6, yb = y1 - 0.18;
        for (const bx of [tx - 0.28, tx + 0.28]) box(c, bx - 0.06, ya, bx + 0.06, yb, 5, 1.5, '#a16b3a');
        line(c, P(tx, yb - 0.1, 0), P(tx, yb - 0.1, 9), '#57534e', 1.4);
        box(c, tx - 0.17, ya, tx + 0.17, yb, 9, 1.5, '#c08850');
        for (let k = 0; k < 3; k++) {
          const p = P(tx + (k % 2 ? 0.08 : -0.08), yb - 0.15 - k * 0.32, 10.5);
          c.fillStyle = '#fbbf24'; rr(c, p[0] - 1.6, p[1] - 5, 3.2, 5, 0.8); c.fill(); c.strokeStyle = OL; c.lineWidth = 0.6; c.stroke();
          circle(c, p[0], p[1] - 5, 1.6, '#ffffff');
        }
      }
      // Rechte Seitenwand mit Bogenfenstern
      faceX(c, x1, y0, y1, 0, hw, shade(tarp, -0.18), OL);
      c.globalAlpha = 0.35;
      for (let y = y0 + 0.4; y < y1; y += 0.4) line(c, P(x1, y, 0), P(x1, y, hw), '#a8a29e', 0.8);
      c.globalAlpha = 1;
      faceX(c, x1, y0, y1, 0, 3, acc);
      const nw = big ? 5 : 4;
      for (let i = 0; i < nw; i++) {
        const ya = y0 + 0.3 + i * (y1 - y0 - 0.4) / nw, yb = ya + 0.3;
        poly(c, [P(x1, yb, 9), P(x1, ya, 9), P(x1, ya, 19), P(x1, (ya + yb) / 2, 23), P(x1, yb, 19)], '#cde7f5', OL, 0.9);
        line(c, P(x1, (ya + yb) / 2, 9), P(x1, (ya + yb) / 2, 23), '#94a3b8', 0.7);
      }
      // Dach
      const E0 = P(x0 - o, y0 - o, hw), E1 = P(x0 - o, y1 + o, hw), F0 = P(x1 + o, y0 - o, hw), F1 = P(x1 + o, y1 + o, hw);
      const R0 = P(xm, y0 - o, zr), R1 = P(xm, y1 + o, zr);
      poly(c, [E0, E1, R1, R0], shade(tarp, -0.06), OL);
      poly(c, [F1, F0, R0, R1], shade(tarp, -0.2), OL);
      if (st >= 1) { // Streifen
        const n = 9;
        for (let i = 0; i < n; i += 2) {
          const u0 = i / n, u1 = (i + 1) / n;
          poly(c, [lerp(E1, E0, u0), lerp(E1, E0, u1), lerp(R1, R0, u1), lerp(R1, R0, u0)], shade(acc, -0.02));
          poly(c, [lerp(F1, F0, u0), lerp(F1, F0, u1), lerp(R1, R0, u1), lerp(R1, R0, u0)], shade(acc, -0.2));
        }
      } else { // Nähte der weißen Plane
        c.globalAlpha = 0.45;
        for (let u = 0.125; u < 1; u += 0.125) { line(c, lerp(E1, E0, u), lerp(R1, R0, u), '#c4b08e', 0.8); line(c, lerp(F1, F0, u), lerp(R1, R0, u), '#a8956f', 0.8); }
        c.globalAlpha = 1;
        // farbige Borte an den Traufen
        poly(c, [E1, E0, lerp(E0, R0, 0.13), lerp(E1, R1, 0.13)], shade(acc, 0.05));
        poly(c, [F1, F0, lerp(F0, R0, 0.13), lerp(F1, R1, 0.13)], shade(acc, -0.2));
        line(c, lerp(E1, R1, 0.09), lerp(E0, R0, 0.09), '#fdf3df', 1.1);
        line(c, lerp(F1, R1, 0.09), lerp(F0, R0, 0.09), '#e9dcc0', 1.1);
      }
      line(c, R0, R1, shade(tarp, -0.4), 1.6);
      // Spitzen (L1–6 eine, ab L7 zwei)
      const peak = (py, r, zt) => {
        const zb = zr - s * r;
        const q = u => P(xm - r + 2 * r * u, py + r, zr - s * Math.abs(2 * r * u - r));
        const ap = P(xm, py, zt);
        poly(c, [q(0), q(0.5), q(1), ap], tarp, OL);
        if (st >= 1) { poly(c, [q(0.25), q(0.5), ap], acc); poly(c, [q(0.75), q(1), ap], acc); }
        poly(c, [P(xm + r, py + r, zb), P(xm + r, py - r, zb), ap], shade(tarp, -0.25), OL);
        if (st >= 1) poly(c, [P(xm + r, py, zb), P(xm + r, py - r, zb), ap], shade(acc, -0.25));
        line(c, ap, [ap[0], ap[1] - 4], '#57534e', 1.4);
        circle(c, ap[0], ap[1] - 4.5, 1.5, '#fbbf24', OL, 0.7);
      };
      if (big) { peak(y0 + (y1 - y0) * 0.27, 0.5, 74); peak(y0 + (y1 - y0) * 0.73, 0.5, 74); }
      else peak((y0 + y1) / 2, 0.5, 74);
      // Giebel vorne: Kante, Volant, Vorhänge
      const G0 = P(x0 - o, y1 + o, hw), GM = P(xm, y1 + o, zr), G1 = P(x1 + o, y1 + o, hw);
      poly(c, [G0, GM, G1, [G1[0], G1[1] + 3], [GM[0], GM[1] + 3], [G0[0], G0[1] + 3]], acc, OL, 1);
      const scallop = (a, b, n, col, dp = 7) => {
        c.beginPath(); c.moveTo(a[0], a[1]);
        for (let i = 1; i <= n; i++) { const m = lerp(a, b, (i - 0.5) / n), e = lerp(a, b, i / n); c.quadraticCurveTo(m[0], m[1] + dp, e[0], e[1]); }
        c.closePath(); c.fillStyle = col; c.fill(); c.strokeStyle = OL; c.lineWidth = 0.8; c.stroke();
      };
      const g0 = [G0[0], G0[1] + 3], gm = [GM[0], GM[1] + 3], g1 = [G1[0], G1[1] + 3];
      scallop(g0, gm, 6, tarp, 4.5); scallop(gm, g1, 6, tarp, 4.5);
      // Vorhänge seitlich gerafft
      for (const [xa, xb, xt] of [[x0, x0 + 0.24, x0 + 0.08], [x1, x1 - 0.24, x1 - 0.08]]) {
        poly(c, [P(xa, y1, hw), P(xb, y1, hw), P(xt, y1, 13), P(xa + (xb - xa) * 0.5, y1, 0), P(xa, y1, 0)], shade(tarp, -0.05), OL, 1);
        line(c, P(xa, y1, 13), P(xt + (xb - xa) * 0.08, y1, 13), acc, 2.2);
      }
      line(c, P(x0, y1, 0), P(x0, y1, hw), '#a8a29e', 1.6);
      line(c, P(x1, y1, 0), P(x1, y1, hw), '#a8a29e', 1.6);
      // Volant an der rechten Traufe
      scallop(F1, F0, big ? 12 : 11, acc);
      // Wimpelkette am Giebel
      const cols = ['#ef4444', '#facc15', '#3b82f6', '#22c55e', '#f97316', '#ec4899'];
      const flags = (a, b, n, sag) => {
        const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + sag * 2];
        c.beginPath(); c.moveTo(a[0], a[1]); c.quadraticCurveTo(m[0], m[1], b[0], b[1]); c.strokeStyle = '#57534e'; c.lineWidth = 0.8; c.stroke();
        for (let i = 0; i < n; i++) {
          const u = (i + 0.5) / n, w = 1 - u;
          const qx = w * w * a[0] + 2 * w * u * m[0] + u * u * b[0], qy = w * w * a[1] + 2 * w * u * m[1] + u * u * b[1];
          poly(c, [[qx - 2.6, qy], [qx + 2.6, qy], [qx, qy + 5.5]], cols[i % cols.length]);
        }
      };
      flags(lerp(g0, gm, 0.08), lerp(gm, g1, 0.92), big ? 13 : 11, 4);
      if (L >= 4) {
        // Laternen im Eingang
        for (let i = 0; i < 3; i++) {
          const x = xm - 0.85 + i * 0.85;
          const zt = zr - s * Math.abs(x - xm) - 4;
          const a = P(x, y1, zt), b = P(x, y1, zt - 9);
          line(c, a, b, '#57534e', 0.8);
          c.beginPath(); c.ellipse(b[0], b[1] + 2, 3.2, 3.8, 0, 0, 7); c.fillStyle = ['#f97316', '#facc15', '#ef4444'][i]; c.fill(); c.strokeStyle = OL; c.lineWidth = 0.8; c.stroke();
          line(c, [b[0] - 3, b[1] + 2], [b[0] + 3, b[1] + 2], 'rgba(0,0,0,0.25)', 0.8);
        }
      }
      if (L >= 3) flags(lerp(F1, F0, 0.04), lerp(F1, F0, 0.96), big ? 15 : 13, 3);
      if (big) { // Lichterketten an Traufe und First
        const fairy = (a, b, n) => { for (let i = 0; i <= n; i++) circle(c, ...lerp(a, b, i / n), 1.3, i % 2 ? '#fef3c7' : '#fde047'); };
        fairy([F1[0], F1[1] + 2], [F0[0], F0[1] + 2], 22);
        fairy(R1, R0, 18);
        fairy(lerp(G0, GM, 0.05), GM, 9); fairy(GM, lerp(GM, G1, 0.95), 9);
      }
      // Außen: Bierfässer
      if (L >= 3) {
        cylinder(c, 3.78, 3.0, 0.12, 0, 10, '#9a6436', '#c08850');
        cylinder(c, 3.78, 3.32, 0.12, 0, 10, '#9a6436', '#c08850');
      }
      if (L >= 5) { // Aufsteller
        const p = P(0.3, 3.75);
        line(c, p, [p[0] + 2, p[1] - 16], '#7a4a21', 1.4);
        c.fillStyle = '#334155'; rr(c, p[0] - 7, p[1] - 22, 14, 10, 2); c.fill(); c.strokeStyle = '#7a4a21'; c.lineWidth = 1.4; c.stroke();
        c.fillStyle = '#fde047'; c.font = 'bold 7px ui-rounded, system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText('FEST', p[0], p[1] - 16.5);
      }
      if (L >= 9) { bush(c, ...P(3.82, 0.25), 0.6, '#3f9a35'); bush(c, ...P(3.85, 3.7), 0.55, '#f472b6'); }
    },
  

    // ---- Bedürfnis-Gebäude: hygiene ----
    // Waschhaus (2×2)
    laundry(c, L) {
      const st = stageOf(L);
      const roof = ['#4ba3e3', '#2389d6', '#3b5bdb'][st];
      const band = ['#bae6fd', '#99f6e4', '#c7d2fe'][st];
      const x0 = 0.45, y0 = 0.2, x1 = 1.72, y1 = 1.2;
      // Zeichnen in der Wandebene (y fest): Kreise liegen schräg auf der Fassade
      const onY = (x, y, z, fn) => { const p = P(x, y, z); c.save(); c.translate(p[0], p[1]); c.transform(1, 0.5, 0, 1, 0, 0); fn(); c.restore(); };
      shadow(c, 0.5, 0.25, 1.72, 1.4, 0.2);
      groundPatch(c, 0.08, 0.08, 1.92, 1.92, st === 2 ? '#e3edf5' : '#dfe4e8');
      c.globalAlpha = 0.3;
      for (let v = 0.48; v < 1.9; v += 0.4) { line(c, P(v, 0.08), P(v, 1.92), '#94a3b8', 0.8); line(c, P(0.08, v), P(1.92, v), '#94a3b8', 0.8); }
      c.globalAlpha = 1;
      if (st === 2) quad(c, 0.08, 0.08, 1.92, 1.92, 0, null, '#93c5fd', 2);
      // Haus
      box(c, x0, y0, x1, y1, 0, 30, '#f8fafc', { left: '#eef3f8', right: '#d3dce6' });
      faceY(c, y1, x0, x1, 0, 4, band, OL);
      faceX(c, x1, y0, y1, 0, 4, shade(band, -0.15), OL);
      // Offene Front mit Waschmaschinen
      faceY(c, y1, 0.55, 1.62, 2, 21, '#3b4a63', OL);
      faceY(c, y1, 0.55, 1.62, 19, 21, '#56657f');
      const n = L >= 4 ? 3 : 2;
      const mFront = ['#ffffff', '#ffffff', '#e8edf3'][st];
      const ring = ['#94a3b8', '#60a5fa', '#fbbf24'][st];
      for (let i = 0; i < 3; i++) {
        const xa = 0.59 + i * 0.335, xb = xa + 0.3, xm = (xa + xb) / 2;
        if (i >= n) { // Spülbecken mit Waschmittel
          box(c, xa, y1 - 0.14, xb, y1 + 0.02, 2, 10, '#e2e8f0', { left: '#cbd5e1', right: '#94a3b8', top: '#f1f5f9' });
          quad(c, xa + 0.05, y1 - 0.11, xb - 0.05, y1 - 0.02, 12, '#64748b');
          const f = P(xa + 0.15, y1 - 0.12, 12);
          line(c, f, [f[0], f[1] - 5], '#94a3b8', 1.6); line(c, [f[0], f[1] - 5], [f[0] + 3, f[1] - 3.5], '#94a3b8', 1.6);
          box(c, xb - 0.09, y1 - 0.12, xb - 0.02, y1 - 0.05, 12, 5, '#f97316');
          continue;
        }
        box(c, xa, y1 - 0.02, xb, y1 + 0.06, 2, 14, mFront, { left: mFront, right: '#cbd5e1', top: '#f1f5f9' });
        faceY(c, y1 + 0.06, xa, xb, 13, 16, shade(band, -0.1));
        circle(c, ...P(xb - 0.06, y1 + 0.06, 14.5), 0.9, st === 2 ? '#22c55e' : '#334155');
        onY(xm, y1 + 0.06, 7.5, () => {
          circle(c, 0, 0, 4.1, ring, OL, 0.9);
          circle(c, 0, 0, 2.9, '#38bdf8');
          circle(c, -0.9, -1, 0.9, 'rgba(255,255,255,0.9)');
        });
      }
      // Tür & Fenster rechts
      faceX(c, x1, 0.66, 1.04, 0, 21, '#f1f5f9', OL);
      faceX(c, x1, 0.71, 0.99, 1.5, 19, '#7dd3fc');
      c.globalAlpha = 0.5; faceX(c, x1, 0.75, 0.82, 4, 17, '#ffffff'); c.globalAlpha = 1;
      faceX(c, x1, 0.3, 0.54, 12, 22, '#f1f5f9', OL);
      faceX(c, x1, 0.33, 0.51, 13.5, 20.5, '#7dd3fc');
      if (L >= 4) { // Abluft des Trockners
        const v = P(x1, 0.42, 25.5);
        c.beginPath(); c.ellipse(v[0], v[1], 2.2, 2.8, 0, 0, 7); c.fillStyle = '#94a3b8'; c.fill(); c.strokeStyle = OL; c.lineWidth = 0.9; c.stroke();
      }
      // Markise über der Front
      if (L >= 4) {
        const za = 29, zb = 25.5, yb = y1 + 0.16;
        for (let i = 0; i < 6; i++) {
          const xa = 0.52 + i * 0.1883, xb = xa + 0.1883;
          poly(c, [P(xa, y1, za), P(xb, y1, za), P(xb, yb, zb), P(xa, yb, zb)], i % 2 ? '#ffffff' : roof);
          poly(c, [P(xa, yb, zb), P(xb, yb, zb), P(xb, yb, zb - 2.5), P(xa, yb, zb - 2.5)], i % 2 ? '#f1f5f9' : shade(roof, -0.15));
        }
        poly(c, [P(0.52, y1, za), P(1.65, y1, za), P(1.65, yb, zb), P(1.65, yb, zb - 2.5), P(0.52, yb, zb - 2.5), P(0.52, yb, zb)], null, OL, 1);
      }
      // Dach mit Schild am Giebel
      roofX(c, x0, y0, x1, y1, 30, 15, roof, '#f8fafc', 0.12);
      const s = P(x1 + 0.01, 0.7, 35.5);
      circle(c, s[0], s[1], 5.2, '#38bdf8', L >= 10 ? '#fbbf24' : '#ffffff', 1.3);
      poly(c, [[s[0] - 3.4, s[1] - 2.2], [s[0] - 1, s[1] - 3], [s[0] + 1, s[1] - 3], [s[0] + 3.4, s[1] - 2.2], [s[0] + 3, s[1] - 0.6], [s[0] + 1.9, s[1] - 0.6], [s[0] + 1.9, s[1] + 2.8], [s[0] - 1.9, s[1] + 2.8], [s[0] - 1.9, s[1] - 0.6], [s[0] - 3, s[1] - 0.6]], '#ffffff');
      if (L >= 3) cylinder(c, 1.38, 0.7, 0.07, 44, 5, '#cbd5e1', '#64748b'); // Lüfter
      if (L >= 7) { // Solar-Warmwasser
        poly(c, [P(0.65, 1.15, 35), P(1.3, 1.15, 35), P(1.3, 0.85, 42.4), P(0.65, 0.85, 42.4)], '#1e3a8a', '#e2e8f0', 1.1);
        c.globalAlpha = 0.5;
        for (let k = 1; k < 4; k++) { const xx = 0.65 + k * 0.1625; line(c, P(xx, 1.15, 35), P(xx, 0.85, 42.4), '#93c5fd', 0.8); }
        c.globalAlpha = 1;
        const a = P(0.63, 0.76, 47.5), b2 = P(1.32, 0.76, 47.5);
        line(c, a, b2, OL, 6.4); line(c, a, b2, '#e5e7eb', 4.6); line(c, [a[0], a[1] - 1.2], [b2[0], b2[1] - 1.2], '#ffffff', 1.4);
        c.beginPath(); c.ellipse(b2[0], b2[1], 1.8, 2.6, 0, 0, 7); c.fillStyle = '#cbd5e1'; c.fill(); c.strokeStyle = OL; c.lineWidth = 0.9; c.stroke();
      }
      // Pflanze rechts hinten, Bank & Korb vorne
      if (L >= 6) { cylinder(c, 1.83, 1.12, 0.07, 0, 4, '#e07a5f'); bush(c, ...P(1.83, 1.12, 4), 0.38, '#4fa63a'); }
      if (L >= 8) { // Blumenkasten & Türlampe
        box(c, x1, 0.3, x1 + 0.07, 0.54, 9, 3, '#9a6436');
        for (let k = 0; k < 4; k++) circle(c, ...P(x1 + 0.035, 0.34 + k * 0.06, 13), 1.5, ['#f43f5e', '#facc15', '#a855f7', '#f97316'][k]);
        circle(c, ...P(x1 + 0.03, 0.85, 23.5), 1.8, '#fde68a', OL, 0.8);
      }
      if (L >= 5) {
        box(c, 1.3, 1.5, 1.84, 1.66, 4, 2, '#b07a45');
        line(c, P(1.34, 1.66, 0), P(1.34, 1.66, 4), '#6b3f1d', 1.2); line(c, P(1.8, 1.66, 0), P(1.8, 1.66, 4), '#6b3f1d', 1.2);
      }
      if (L >= 3) { // Wäschekorb
        box(c, 0.98, 1.52, 1.22, 1.76, 0, 6, '#d6a35c');
        c.globalAlpha = 0.35; line(c, P(0.98, 1.76, 3), P(1.22, 1.76, 3), '#6b3f1d', 0.8); c.globalAlpha = 1;
        circle(c, ...P(1.07, 1.62, 7), 2.6, '#f9a8d4', OL, 0.8);
        circle(c, ...P(1.14, 1.67, 7), 2.4, '#93c5fd', OL, 0.8);
      }
      if (L >= 9) bush(c, ...P(1.84, 1.86), 0.5, '#f472b6');
      // Wäscheleine vorne links
      const ya = 1.84, la = 0.1, lb = 1.04, zl = 24;
      const post = x => { line(c, P(x, ya, 0), P(x, ya, zl + 2), OL, 3.2); line(c, P(x, ya, 0), P(x, ya, zl + 2), '#9a6436', 1.8); };
      post(la);
      const A = P(la, ya, zl), B = P(lb, ya, zl);
      c.beginPath(); c.moveTo(A[0], A[1]); c.quadraticCurveTo((A[0] + B[0]) / 2, (A[1] + B[1]) / 2 + 9, B[0], B[1]);
      c.strokeStyle = '#e5e7eb'; c.lineWidth = 0.9; c.stroke();
      const cols = ['#f87171', '#60a5fa', '#facc15', '#34d399', '#f472b6'];
      const kinds = ['shirt', 'towel', 'pants', 'sock', 'shirt'];
      const cnt = 3 + (L >= 3 ? 1 : 0) + (L >= 6 ? 1 : 0);
      for (let i = 0; i < cnt; i++) {
        const u = 0.13 + i * (0.74 / (cnt - 1));
        const sag = 4 * u * (1 - u) * 4.5;
        const col = cols[(i + st) % cols.length];
        onY(la + u * (lb - la), ya, zl - sag, () => {
          const k = kinds[i];
          c.scale(0.85, 0.85);
          if (k === 'shirt') poly(c, [[-4, 0], [4, 0], [6, 2.6], [4.2, 3.8], [3.6, 10], [-3.6, 10], [-4.2, 3.8], [-6, 2.6]], col, OL, 1);
          else if (k === 'towel') { poly(c, [[-3.3, 0], [3.3, 0], [3.3, 11], [-3.3, 11]], col, OL, 1); poly(c, [[-3.3, 8], [3.3, 8], [3.3, 9.3], [-3.3, 9.3]], '#ffffff'); }
          else if (k === 'pants') poly(c, [[-3.6, 0], [3.6, 0], [4.2, 11], [1.2, 11], [0, 4.5], [-1.2, 11], [-4.2, 11]], col, OL, 1);
          else poly(c, [[-1.3, 0], [1.3, 0], [1.3, 5.5], [3.2, 7], [2.6, 8.6], [-1.3, 7.8]], col, OL, 1);
          c.fillStyle = '#fde68a'; c.fillRect(-0.8, -1.4, 1.6, 2.6);
        });
      }
      post(lb);
    },

    // Wellness-Spa (4×3)
    spa(c, L) {
      const st = stageOf(L);
      const wood = ['#b98352', '#a8703f', '#8a5a33'][st];
      const slab = ['#57534e', '#44403c', '#292524'][st];
      const glass = '#a5dcf0';
      const water = ['#2dd4bf', '#22d3ee', '#38bdf8'][st];
      const onY = (x, y, z, fn) => { const p = P(x, y, z); c.save(); c.translate(p[0], p[1]); c.transform(1, 0.5, 0, 1, 0, 0); fn(); c.restore(); };
      shadow(c, 0.3, 0.3, 3.6, 2.8, 0.3);
      groundPatch(c, 0.06, 0.06, 3.94, 2.94, st === 2 ? '#ece5d6' : '#e8e2d2', '#c9bfa6');
      c.globalAlpha = 0.45;
      if (st === 2) { // Natursteinplatten
        for (let v = 0.5; v < 3.9; v += 0.45) line(c, P(v, 0.06), P(v, 2.94), '#b8ad94', 0.8);
        for (let v = 0.5; v < 2.9; v += 0.45) line(c, P(0.06, v), P(3.94, v), '#b8ad94', 0.8);
      } else for (let i = 0; i < 22; i++) circle(c, ...P(0.2 + hash(i, 3, 9) * 3.6, 1.4 + hash(i, 4, 9) * 1.5), 1, '#b8ad94');
      c.globalAlpha = 1;
      // Bambus (Hilfsfunktion)
      const bamboo = (x, y, n, h) => {
        for (let i = 0; i < n; i++) {
          const dx = (hash(i, 1, x * 10 | 0) - 0.5) * 0.22, dy = (hash(i, 2, y * 10 | 0) - 0.5) * 0.22;
          const hh = h * (0.75 + hash(i, 3, 7) * 0.35);
          const a = P(x + dx, y + dy, 0), b = P(x + dx, y + dy, hh);
          const lean = (i - n / 2) * 1.2;
          line(c, a, [b[0] + lean, b[1]], OL, 3.4);
          line(c, a, [b[0] + lean, b[1]], i % 2 ? '#84cc16' : '#65a30d', 2);
          for (let z = 8; z < hh - 2; z += 8) line(c, [a[0] + lean * z / hh - 1.4, a[1] - z], [a[0] + lean * z / hh + 1.4, a[1] - z], '#3f6212', 0.9);
          for (let k = 0; k < 3; k++) {
            const q = [b[0] + lean + (k - 1) * 3.5, b[1] + k * 3];
            c.beginPath(); c.ellipse(q[0], q[1], 4.2, 1.6, (k - 1) * 0.6 + (i % 2 ? 0.3 : -0.3), 0, 7);
            c.fillStyle = k === 1 ? '#4d7c0f' : '#65a30d'; c.fill(); c.strokeStyle = OL; c.lineWidth = 0.7; c.stroke();
          }
        }
      };
      // Hauptgebäude: Holz & Glas
      const bx0 = 0.25, by0 = 0.2, bx1 = 2.5, by1 = 1.35;
      const H = st === 2 ? 32 : 28;
      box(c, bx0 - 0.04, by0 - 0.03, bx1 + 0.04, by1 + 0.04, 0, 3, '#d6d3d1');
      box(c, bx0, by0, bx1, by1, 3, H, wood);
      c.globalAlpha = 0.28;
      for (let x = bx0 + 0.12; x < bx1; x += 0.12) line(c, P(x, by1, 3), P(x, by1, 3 + H), '#4a2c14', 0.8);
      for (let y = by0 + 0.12; y < by1; y += 0.12) line(c, P(bx1, y, 3), P(bx1, y, 3 + H), '#3b2410', 0.8);
      c.globalAlpha = 1;
      const pane = (xa, xb, za, zb, step) => {
        faceY(c, by1, xa, xb, za, zb, glass, OL);
        c.globalAlpha = 0.45;
        poly(c, [P(xa + (xb - xa) * 0.15, by1, za), P(xa + (xb - xa) * 0.35, by1, za), P(xa + (xb - xa) * 0.12, by1, zb), P(xa, by1, zb), P(xa, by1, zb - 4)], '#ffffff');
        c.globalAlpha = 1;
        for (let x = xa + step; x < xb - 0.05; x += step) line(c, P(x, by1, za), P(x, by1, zb), '#3f2a1a', 1.2);
      };
      const paneX = (ya, yb, za, zb, step) => {
        faceX(c, bx1, ya, yb, za, zb, shade(glass, -0.15), OL);
        for (let y = ya + step; y < yb - 0.05; y += step) line(c, P(bx1, y, za), P(bx1, y, zb), '#3f2a1a', 1.2);
      };
      if (st === 0) {
        pane(0.45, 1.25, 10, 25, 0.4);
        pane(1.95, 2.32, 3, 25, 1);
        paneX(0.55, 1.0, 12, 24, 1);
      } else if (st === 1) {
        pane(0.42, 1.65, 6, 27, 0.41);
        pane(1.95, 2.33, 3, 27, 1);
        paneX(0.4, 1.15, 6, 27, 0.375);
      } else {
        pane(0.35, 2.4, 3, 32, 0.41);
        paneX(0.32, 1.25, 3, 32, 0.31);
      }
      // Türgriff
      line(c, P(2.0, by1, 13), P(2.0, by1, 19), '#e5e7eb', 1.4);
      // Flachdach mit Überstand
      box(c, bx0 - 0.13, by0 - 0.12, bx1 + 0.13, by1 + 0.15, 3 + H, 4, slab, { top: ['#c2b9a9', '#8fbf5f', '#c8a27a'][st] });
      if (st === 2) { // Dachterrasse aus Holz
        c.globalAlpha = 0.3;
        for (let x = bx0 + 0.05; x < bx1 + 0.1; x += 0.14) line(c, P(x, by0 - 0.12, 7 + H), P(x, by1 + 0.15, 7 + H), '#6b3f1d', 0.8);
        c.globalAlpha = 1;
      } else if (st === 0) { // Kies, helle Attika, Lüfter & Oberlichter
        c.globalAlpha = 0.55;
        for (let i = 0; i < 26; i++) {
          const gx = 0.18 + hash(i, 7, 13) * 2.36, gy = 0.14 + hash(i, 8, 13) * 1.26;
          if (gy > 0.36 && gy < 0.8 && gx > 0.5 && gx < 1.76) continue;
          circle(c, ...P(gx, gy, 7 + H), 0.9 + hash(i, 9, 13) * 0.5, i % 3 ? '#a39a89' : '#e2dccf');
        }
        c.globalAlpha = 1;
        quad(c, bx0 - 0.08, by0 - 0.07, bx1 + 0.08, by1 + 0.1, 7 + H, null, '#ece6da', 1.6);
        box(c, 0.55, 0.42, 0.85, 0.75, 7 + H, 2.5, '#a5dcf0');
        box(c, 1.0, 0.42, 1.3, 0.75, 7 + H, 2.5, '#a5dcf0');
        cylinder(c, 2.15, 0.42, 0.05, 7 + H, 4, '#a8a29e', '#57534e');
        box(c, 2.32, 0.3, 2.5, 0.5, 7 + H, 3, '#d6d3d1');
      }
      faceY(c, by1 + 0.15, bx0 - 0.13, bx1 + 0.13, 3 + H, 4 + H, '#c8a27a');
      if (st === 2) { // Glas-Obergeschoss
        box(c, 0.55, 0.35, 1.75, 1.15, 7 + H, 16, wood);
        faceY(c, 1.15, 0.6, 1.7, 8 + H, 21 + H, glass, OL);
        faceX(c, 1.75, 0.42, 1.08, 8 + H, 21 + H, shade(glass, -0.15), OL);
        for (let x = 0.88; x < 1.7; x += 0.28) line(c, P(x, 1.15, 8 + H), P(x, 1.15, 21 + H), '#3f2a1a', 1.1);
        box(c, 0.47, 0.27, 1.83, 1.23, 23 + H, 3, slab, { top: '#8fbf5f' });
        line(c, P(0.47, 1.23, 23 + H), P(1.83, 1.23, 23 + H), '#fbbf24', 1.4);
      } else if (st === 1) { // Dachbegrünung
        bush(c, ...P(0.7, 0.75, 7 + H), 0.45, '#4fa63a');
        bush(c, ...P(1.3, 0.6, 7 + H), 0.4, '#5aa83c');
      } else if (L >= 3) { box(c, 1.45, 0.5, 1.7, 0.75, 7 + H, 3, '#8a5a33'); bush(c, ...P(1.575, 0.625, 10 + H), 0.38, '#4fa63a'); }
      // Lotus-Schild auf dem Dach
      const sx0 = 1.88, sx1 = 2.38, sy = 1.15, sz = 7 + H;
      line(c, P(sx0 + 0.08, sy, sz), P(sx0 + 0.08, sy, sz + 3), '#57534e', 1.4);
      line(c, P(sx1 - 0.08, sy, sz), P(sx1 - 0.08, sy, sz + 3), '#57534e', 1.4);
      faceY(c, sy, sx0, sx1, sz + 3, sz + 13, '#0f766e', OL);
      onY((sx0 + sx1) / 2, sy, sz + 8, () => {
        const pet = (a, col) => { c.save(); c.rotate(a); c.beginPath(); c.ellipse(0, -2.4, 1.5, 3, 0, 0, 7); c.fillStyle = col; c.fill(); c.restore(); };
        pet(-1.1, '#f9a8d4'); pet(1.1, '#f9a8d4'); pet(-0.5, '#f472b6'); pet(0.5, '#f472b6'); pet(0, '#fbcfe8');
        c.beginPath(); c.ellipse(0, 1.2, 4.5, 1, 0, 0, 7); c.fillStyle = '#5eead4'; c.fill();
      });
      if (st === 2) line(c, P(sx0, sy, sz + 13), P(sx1, sy, sz + 13), '#fbbf24', 1.4);
      // Sauna-Hütte
      const sa0 = 2.82, sb0 = 0.25, sa1 = 3.75, sb1 = 1.1;
      const log = ['#a0673a', '#9a5f33', '#8f552c'][st];
      box(c, sa0, sb0, sa1, sb1, 0, 20, log);
      for (let z = 4; z < 20; z += 4) {
        line(c, P(sa0, sb1, z), P(sa1, sb1, z), shade(log, -0.4), 0.9);
        line(c, P(sa1, sb1, z), P(sa1, sb0, z), shade(log, -0.5), 0.9);
      }
      faceY(c, sb1, 3.02, 3.3, 0, 15, '#5b3a1e', OL);
      faceY(c, sb1, 3.09, 3.23, 8, 13, '#fcd34d', OL);
      faceX(c, sa1, 0.45, 0.8, 9, 15, '#fcd34d', OL);
      line(c, P(sa1, 0.625, 9), P(sa1, 0.625, 15), '#5b3a1e', 1);
      const sroof = ['#7c4a2a', '#5f3b22', '#3f6b5a'][st];
      roofY(c, sa0, sb0, sa1, sb1, 20, 13, sroof, log, 0.12);
      cylinder(c, 3.56, 0.5, 0.06, 27, 14, '#57534e', '#292524');
      // Bambus
      bamboo(3.86, 1.3, L >= 8 ? 5 : 4, 34);
      bamboo(0.14, 1.55, L >= 4 ? 5 : 3, 38);
      // Mittelstreifen: Trittsteine bzw. Infinity-Pool
      if (L >= 7) {
        const px0 = 0.32, py0 = 1.55, px1 = 1.95, py1 = 2.1;
        // Überlaufkante vorne und rechts: Wasserfilm statt Beckenrand
        box(c, px0, py0, px1, py1, 0, 7, '#e7e5e4', { left: '#5eead4', right: '#2cc4b0' });
        c.globalAlpha = 0.6;
        for (let x = px0 + 0.12; x < px1; x += 0.22) line(c, P(x, py1, 6.5), P(x + 0.04, py1, 1), '#ffffff', 0.8);
        for (let y = py0 + 0.12; y < py1; y += 0.2) line(c, P(px1, y, 6.5), P(px1, y + 0.03, 1), '#ffffff', 0.8);
        c.globalAlpha = 1;
        quad(c, px0 + 0.07, py0 + 0.07, px1, py1, 7, water);
        c.globalAlpha = 0.3; quad(c, px0 + 0.15, py0 + 0.12, px1 - 0.6, py1 - 0.2, 7, '#ffffff'); c.globalAlpha = 1;
        line(c, P(px0, py1, 7), P(px1, py1, 7), '#ccfbf1', 1.4);
        line(c, P(px1, py0, 7), P(px1, py1, 7), '#ccfbf1', 1.4);
        box(c, px1, py0 - 0.02, px1 + 0.1, py1, 0, 2, '#94a3b8');
        box(c, px0 - 0.02, py1, px1 + 0.1, py1 + 0.1, 0, 2, '#94a3b8');
      } else {
        for (let i = 0; i < 3; i++) { const q = P(0.6 + i * 0.45, 1.75 + (i % 2) * 0.12); c.beginPath(); c.ellipse(q[0], q[1] - 2, 5 - i, 3.4 - i * 0.5, 0, 0, 7); c.fillStyle = ['#a8a29e', '#9ca3af', '#a8a29e'][i]; c.fill(); c.strokeStyle = OL; c.lineWidth = 1; c.stroke(); }
        if (L >= 3) bush(c, ...P(1.65, 1.62), 0.5, '#3f9a35');
      }
      for (const [x, y] of [[2.2, 1.58], [2.42, 1.85]]) ellipseG(c, x, y, 0.1, 0, '#d6d3d1', OL, 1);
      // Holzdeck mit Whirlpool
      box(c, 2.6, 1.45, 3.86, 2.86, 0, 3, '#c08850');
      c.globalAlpha = 0.35;
      for (let x = 2.75; x < 3.86; x += 0.15) line(c, P(x, 1.45, 3), P(x, 2.86, 3), '#6b3f1d', 0.8);
      c.globalAlpha = 1;
      const cx = 3.22, cy = 2.12, r = 0.5;
      const tub = ['#a0673a', '#a8a29e', '#f1f5f9'][st];
      const rim = ['#c08850', '#d6d3d1', '#ffffff'][st];
      cylinder(c, cx, cy, r, 3, 11, tub, rim);
      if (st === 0) { // Fassdauben
        for (let a = -0.6; a < 2.3; a += 0.3) line(c, P(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 3), P(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 14), '#6b3f1d', 0.8);
        const b1 = P(cx, cy, 6); c.beginPath(); c.ellipse(b1[0], b1[1], r * HW * 1.414, r * HH * 1.414, 0, 0, Math.PI); c.strokeStyle = '#57534e'; c.lineWidth = 1.3; c.stroke();
      } else if (st === 2) { // LED-Band, ab Stufe 10 mit Goldrand
        const b1 = P(cx, cy, 8); c.beginPath(); c.ellipse(b1[0], b1[1], r * HW * 1.414, r * HH * 1.414, 0, 0, Math.PI); c.strokeStyle = '#22d3ee'; c.lineWidth = 1.6; c.stroke();
        if (L >= 10) ellipseG(c, cx, cy, r, 14, null, '#fbbf24', 1.6);
      }
      ellipseG(c, cx, cy, r - 0.08, 14, water, shade('#0e7490', 0), 1);
      c.globalAlpha = 0.5; ellipseG(c, cx - 0.08, cy - 0.05, 0.2, 14, '#ffffff'); c.globalAlpha = 1;
      box(c, 2.92, 2.6, 3.3, 2.82, 3, 5, '#a0673a'); // Stufe
      // Handtücher
      box(c, 3.56, 2.58, 3.8, 2.8, 3, 2, '#f8fafc'); box(c, 3.56, 2.58, 3.8, 2.8, 5, 2, '#5eead4');
      // Liegen
      const cush = ['#f8fafc', '#ccfbf1', '#f5f5f4'][st];
      const frame = ['#a0673a', '#8a5a33', '#44403c'][st];
      const lounger = xa => {
        const ya = 2.3, xb = xa + 0.46, yb = 2.8;
        box(c, xa, ya, xb, yb, 0, 4, frame);
        poly(c, [P(xa, ya + 0.02, 4), P(xb, ya + 0.02, 4), P(xb, ya - 0.06, 14), P(xa, ya - 0.06, 14)], shade(cush, -0.1), OL, 1);
        poly(c, [P(xa, ya, 4), P(xb, ya, 4), P(xb, yb, 5.5), P(xa, yb, 5.5)], cush, OL, 1);
        const q = P(xa + 0.23, yb - 0.08, 7);
        c.beginPath(); c.ellipse(q[0], q[1], 4.5, 2, 0.45, 0, 7); c.fillStyle = st === 2 ? '#fbbf24' : '#5eead4'; c.fill(); c.strokeStyle = OL; c.lineWidth = 0.8; c.stroke();
      };
      const nl = L >= 4 ? 3 : 2;
      for (let i = 0; i < nl; i++) lounger(0.4 + i * 0.6);
      if (L >= 5) { cylinder(c, 2.2, 2.6, 0.1, 0, 7, '#f8fafc'); circle(c, ...P(2.2, 2.6, 9), 1.6, '#f472b6'); }
      // Laternen
      const lantern = (x, y) => {
        const p = P(x, y);
        line(c, p, [p[0], p[1] - 14], OL, 3); line(c, p, [p[0], p[1] - 14], '#57534e', 1.6);
        c.fillStyle = '#fde68a'; rr(c, p[0] - 2.6, p[1] - 21, 5.2, 7, 1.5); c.fill(); c.strokeStyle = OL; c.lineWidth = 1; c.stroke();
        poly(c, [[p[0] - 4, p[1] - 21], [p[0], p[1] - 24.5], [p[0] + 4, p[1] - 21]], '#292524', OL, 0.9);
      };
      lantern(2.5, 2.9);
      if (L >= 4) { lantern(0.14, 2.86); lantern(3.9, 1.48); }
      if (L >= 9) { bush(c, ...P(3.88, 2.9), 0.5, '#f472b6'); }
    },
  

    obs_tree(c, L, v) { pine(c, 0.5, 0.5, 1, v || 0); },
    obs_bush(c) {
      const p = P(0.5, 0.5);
      bush(c, p[0] - 4, p[1] + 2, 0.8, '#3d8b2f');
      bush(c, p[0] + 5, p[1] + 1, 0.7, '#4a9a38');
      circle(c, p[0] + 1, p[1] - 7, 1.5, '#7c3aed');
    },
    obs_rock(c) {
      const p = P(0.5, 0.5);
      poly(c, [[p[0] - 13, p[1] + 2], [p[0] - 10, p[1] - 12], [p[0] + 2, p[1] - 19], [p[0] + 13, p[1] - 9], [p[0] + 12, p[1] + 3]], '#9ca3af', OL);
      poly(c, [[p[0] - 10, p[1] - 12], [p[0] + 2, p[1] - 19], [p[0] + 3, p[1] - 6], [p[0] - 6, p[1] - 3]], '#c4c8ce');
      poly(c, [[p[0] + 3, p[1] - 6], [p[0] + 13, p[1] - 9], [p[0] + 12, p[1] + 3]], '#7b828c');
      circle(c, p[0] - 8, p[1] - 2, 2, '#6b8e23');
    },
    obs_stump(c) {
      cylinder(c, 0.5, 0.5, 0.24, 0, 10, '#8b5a2b', '#d9b07a');
      const p = P(0.5, 0.5, 10);
      c.beginPath(); c.ellipse(p[0], p[1], 6, 3, 0, 0, 7); c.strokeStyle = '#a87443'; c.lineWidth = 1; c.stroke();
      bush(c, ...P(0.8, 0.75), 0.4, '#5aa83c');
    },
  };

  /* Bedürfnis-Symbole (Canvas), z. B. für Wunschblasen und Platzhalter */
  function needIcon(c, need, x, y, r) {
    c.save();
    c.lineJoin = 'round'; c.lineCap = 'round';
    switch (need) {
      case 'hygiene': {
        c.beginPath(); c.moveTo(x, y - r); c.bezierCurveTo(x + r * 0.9, y - r * 0.1, x + r * 0.75, y + r * 0.85, x, y + r * 0.85);
        c.bezierCurveTo(x - r * 0.75, y + r * 0.85, x - r * 0.9, y - r * 0.1, x, y - r); c.closePath();
        c.fillStyle = '#38bdf8'; c.fill(); c.strokeStyle = '#075985'; c.lineWidth = Math.max(1, r * 0.12); c.stroke();
        circle(c, x - r * 0.25, y + r * 0.15, r * 0.18, 'rgba(255,255,255,0.85)');
        break;
      }
      case 'sport': {
        circle(c, x, y, r * 0.88, '#ffffff', '#14532d', Math.max(1, r * 0.12));
        c.beginPath(); c.arc(x, y, r * 0.88, -0.4, 0.9); c.moveTo(x - r * 0.88, y + r * 0.1); c.quadraticCurveTo(x, y - r * 0.25, x + r * 0.5, y - r * 0.72);
        c.moveTo(x - r * 0.3, y + r * 0.82); c.quadraticCurveTo(x - r * 0.1, y, x + r * 0.84, y + r * 0.2);
        c.strokeStyle = '#16a34a'; c.lineWidth = Math.max(1, r * 0.16); c.stroke();
        break;
      }
      case 'kultur': {
        c.beginPath(); c.moveTo(x - r * 0.8, y - r * 0.75); c.quadraticCurveTo(x, y - r * 0.95, x + r * 0.8, y - r * 0.75);
        c.quadraticCurveTo(x + r * 0.85, y + r * 0.6, x, y + r * 0.9); c.quadraticCurveTo(x - r * 0.85, y + r * 0.6, x - r * 0.8, y - r * 0.75); c.closePath();
        c.fillStyle = '#a78bfa'; c.fill(); c.strokeStyle = '#4c1d95'; c.lineWidth = Math.max(1, r * 0.12); c.stroke();
        c.fillStyle = '#4c1d95';
        c.beginPath(); c.ellipse(x - r * 0.33, y - r * 0.25, r * 0.17, r * 0.11, -0.3, 0, 7); c.fill();
        c.beginPath(); c.ellipse(x + r * 0.33, y - r * 0.25, r * 0.17, r * 0.11, 0.3, 0, 7); c.fill();
        c.beginPath(); c.arc(x, y + r * 0.15, r * 0.35, 0.15, Math.PI - 0.15); c.strokeStyle = '#4c1d95'; c.lineWidth = Math.max(1, r * 0.13); c.stroke();
        break;
      }
      case 'kunst': {
        c.beginPath(); c.ellipse(x, y, r * 0.95, r * 0.75, -0.2, 0, Math.PI * 2);
        c.fillStyle = '#f5d0a9'; c.fill(); c.strokeStyle = '#7c2d12'; c.lineWidth = Math.max(1, r * 0.12); c.stroke();
        circle(c, x + r * 0.35, y + r * 0.3, r * 0.17, '#fff8ee');
        const cols = ['#ef4444', '#facc15', '#3b82f6', '#22c55e', '#a855f7'];
        cols.forEach((col, i) => { const a = -2.6 + i * 0.75; circle(c, x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.45 - r * 0.05, r * 0.16, col); });
        break;
      }
      case 'party': {
        line(c, [x - r * 0.25, y + r * 0.2], [x - r * 0.05, y + r], '#7c2d12', Math.max(1, r * 0.08));
        line(c, [x + r * 0.35, y + r * 0.1], [x - r * 0.05, y + r], '#7c2d12', Math.max(1, r * 0.08));
        c.beginPath(); c.ellipse(x + r * 0.35, y - r * 0.35, r * 0.45, r * 0.55, 0.2, 0, 7); c.fillStyle = '#f472b6'; c.fill(); c.strokeStyle = '#831843'; c.lineWidth = Math.max(1, r * 0.1); c.stroke();
        c.beginPath(); c.ellipse(x - r * 0.25, y - r * 0.3, r * 0.48, r * 0.58, -0.15, 0, 7); c.fillStyle = '#fb923c'; c.fill(); c.strokeStyle = '#7c2d12'; c.stroke();
        circle(c, x - r * 0.4, y - r * 0.5, r * 0.12, 'rgba(255,255,255,0.8)');
        break;
      }
    }
    c.restore();
  }

  // Einfache Ersatzgrafik für Gebäude ohne eigene Zeichnung
  const NEED_TINT = { hygiene: '#7dd3fc', sport: '#86efac', kultur: '#c4b5fd', kunst: '#f9a8d4', party: '#fdba74' };
  function placeholderArt(type) {
    return (c, L) => {
      const d = BUILDINGS[type];
      const main = (d.needs && Object.keys(d.needs)[0]) || 'party';
      const col = NEED_TINT[main] || '#e5e7eb';
      const w = d.w, dd = d.d;
      shadow(c, 0.3, 0.3, w - 0.2, dd - 0.2, 0.2);
      groundPatch(c, 0.08, 0.08, w - 0.08, dd - 0.08, '#e7dcc4');
      const h = Math.max(18, Math.min(46, d.height * 0.6));
      box(c, 0.35, 0.35, w - 0.35, dd - 0.35, 0, h, '#f8fafc', { left: '#eef2f6', right: '#cfd8e3' });
      roofPyr(c, 0.35, 0.35, w - 0.35, dd - 0.35, h, 16 + w * 3, col);
      const p = P(w / 2, dd - 0.35, h * 0.5);
      needIcon(c, main, p[0], p[1], 9 + w * 1.5);
      void L;
    };
  }

  const drawFn = type => DRAW[type] || (DRAW[type] = placeholderArt(type));

  function pine(c, x, y, s, v) {
    const p = P(x, y);
    const cols = [['#2f7d3a', '#276b31', '#3d9a48'], ['#2a6e44', '#225c39', '#358a55'], ['#3b8a2e', '#2f7425', '#4ea53e']][v % 3];
    c.globalAlpha = 0.2; c.beginPath(); c.ellipse(p[0] + 4 * s, p[1], 14 * s, 6 * s, 0, 0, 7); c.fillStyle = '#10240a'; c.fill(); c.globalAlpha = 1;
    c.fillStyle = '#6b4226'; c.fillRect(p[0] - 2.5 * s, p[1] - 12 * s, 5 * s, 12 * s);
    for (let i = 0; i < 3; i++) {
      const by = p[1] - (10 + i * 15) * s, w = (17 - i * 4) * s, h = 24 * s;
      c.beginPath(); c.moveTo(p[0] - w, by); c.lineTo(p[0], by - h); c.lineTo(p[0] + w, by); c.closePath();
      c.fillStyle = cols[i === 1 ? 1 : 0]; c.fill(); c.strokeStyle = OL; c.lineWidth = 1.1; c.stroke();
      c.beginPath(); c.moveTo(p[0] - w * 0.6, by - 2 * s); c.lineTo(p[0], by - h); c.lineTo(p[0] - w * 0.1, by - 3 * s); c.closePath();
      c.fillStyle = cols[2]; c.fill();
    }
  }

  function drawSite(c, w, d) {
    groundPatch(c, 0.1, 0.1, w - 0.1, d - 0.1, '#c9a26b', '#a07a46');
    c.globalAlpha = 0.4;
    for (let i = 0; i < 6 * w; i++) circle(c, ...P(0.2 + hash(i, w, 1) * (w - 0.4), 0.2 + hash(i, d, 2) * (d - 0.4)), 1.3, '#8a6a3a');
    c.globalAlpha = 1;
    // Gerüstrahmen
    const fh = 14 + w * 5;
    const x0 = 0.35, y0 = 0.35, x1 = w - 0.35, y1 = d - 0.35;
    for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1]]) line(c, P(x, y, 0), P(x, y, fh), '#a8743f', 2.2);
    line(c, P(x0, y0, fh), P(x1, y0, fh), '#a8743f', 2);
    line(c, P(x0, y0, fh), P(x0, y1, fh), '#a8743f', 2);
    // Material
    box(c, w * 0.45, d * 0.55, w * 0.45 + 0.6, d * 0.55 + 0.3, 0, 3, '#e3b878');
    box(c, w * 0.45, d * 0.55, w * 0.45 + 0.6, d * 0.55 + 0.3, 3, 3, '#d9a866');
    if (w >= 2) {
      box(c, 0.3, d - 0.75, 0.75, d - 0.3, 0, 12, '#b07a45');
      line(c, P(0.3, d - 0.3, 0), P(0.75, d - 0.3, 12), '#6b3f1d', 1);
      line(c, P(0.75, d - 0.3, 0), P(0.3, d - 0.3, 12), '#6b3f1d', 1);
    }
    line(c, P(x1, y1, 0), P(x1, y1, fh), '#a8743f', 2.2);
    // Absperrband vorne
    c.setLineDash([4, 4]);
    line(c, P(0.1, d - 0.1, 8), P(w - 0.1, d - 0.1, 8), '#ef4444', 1.6);
    line(c, P(w - 0.1, d - 0.1, 8), P(w - 0.1, 0.1, 8), '#ef4444', 1.6);
    c.setLineDash([]);
    for (const [x, y] of [[0.1, d - 0.1], [w - 0.1, d - 0.1], [w - 0.1, 0.1]]) box(c, x - 0.05, y - 0.05, x + 0.05, y + 0.05, 0, 10, '#f8fafc');
  }

  // Baugerüst bei Verbesserungen: niedrig an der Vorderseite, damit das Gebäude erkennbar bleibt
  function drawScaffold(c, w, d, h) {
    const H = Math.min(34, Math.max(16, h * 0.45));
    const col = '#b5834a';
    const xs = [0.15, w / 2, w - 0.15], ys = [d - 0.15, d / 2, 0.15];
    for (const x of xs) line(c, P(x, d + 0.05, 0), P(x, d + 0.05, H), col, 2);
    for (const y of ys) line(c, P(w + 0.05, y, 0), P(w + 0.05, y, H), col, 2);
    for (const z of [H * 0.5, H]) {
      line(c, P(0.1, d + 0.05, z), P(w + 0.05, d + 0.05, z), '#8a5a2e', 3);
      line(c, P(w + 0.05, d + 0.05, z), P(w + 0.05, 0.1, z), '#8a5a2e', 3);
    }
    c.setLineDash([3, 3]);
    line(c, P(0.1, d + 0.05, 3), P(w + 0.05, d + 0.05, 3), '#ef4444', 1.4);
    line(c, P(w + 0.05, d + 0.05, 3), P(w + 0.05, 0.1, 3), '#ef4444', 1.4);
    c.setLineDash([]);
  }

  function drawGate(c) {
    // lokal: Kachel (0,0) = Straßenkachel direkt vor der Fläche
    const L = P(-0.08, 0.15), R = P(1.08, 0.15);
    for (const p of [L, R]) { c.fillStyle = '#7a4a21'; c.fillRect(p[0] - 3, p[1] - 46, 6, 46); c.strokeStyle = OL; c.lineWidth = 1.2; c.strokeRect(p[0] - 3, p[1] - 46, 6, 46); }
    line(c, [L[0] - 6, L[1] - 44], [R[0] + 6, R[1] - 44], '#5b3a1e', 6);
    line(c, [L[0] - 6, L[1] - 45], [R[0] + 6, R[1] - 45], '#9a6436', 3.5);
    const mx = (L[0] + R[0]) / 2, my = (L[1] + R[1]) / 2 - 36;
    c.save(); c.translate(mx, my); c.transform(1, 0.5, 0, 1, 0, 0);
    c.fillStyle = '#16a34a'; rr(c, -24, -7, 48, 13, 3); c.fill(); c.strokeStyle = '#fff'; c.lineWidth = 1.4; c.stroke();
    c.fillStyle = '#fff'; c.font = 'bold 8px ui-rounded, system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('CAMPING', 0, 0);
    c.restore();
  }

  /* ---------------- Sprite-Cache ---------------- */
  const MAX_BUCKET = 2.83;   // Sprite-Auflösung begrenzen (Speicher & Füllrate bei starkem Zoom)
  function bucketFor(s) { return Math.min(MAX_BUCKET, Math.pow(2, Math.round(Math.log2(Math.max(0.25, s)) * 2) / 2)); }
  function sprite(key, x0, y0, x1, y1, fn) {
    let s = sprites.get(key);
    if (s) return s;
    const cw = Math.max(1, Math.ceil((x1 - x0) * bucket)), ch = Math.max(1, Math.ceil((y1 - y0) * bucket));
    const cv = document.createElement('canvas');
    cv.width = cw; cv.height = ch;
    const c = cv.getContext('2d');
    c.setTransform(bucket, 0, 0, bucket, -x0 * bucket, -y0 * bucket);
    c.lineJoin = 'round'; c.lineCap = 'round';
    fn(c);
    s = { cv, x0, y0, w: x1 - x0, h: y1 - y0 };
    sprites.set(key, s);
    return s;
  }
  function boundsFor(w, d, h) { return [-d * HW - 16, -(h + 40), w * HW + 16, (w + d) * HH + 12]; }

  function maskOf(b, type) {
    const same = (x, y) => { const id = Game.occAt(x, y); if (id <= 0) return false; const o = Game.getBuilding(id); return !!o && o.type === type; };
    return (same(b.gx + 1, b.gy) ? 1 : 0) | (same(b.gx - 1, b.gy) ? 2 : 0) | (same(b.gx, b.gy + 1) ? 4 : 0) | (same(b.gx, b.gy - 1) ? 8 : 0);
  }
  function buildingSprite(type, level, variant) {
    const d = BUILDINGS[type];
    const key = type + '|' + level + '|' + (variant || 0);
    const bb = boundsFor(d.w, d.d, d.height);
    return sprite(key, bb[0], bb[1], bb[2], bb[3], c => drawFn(type)(c, level, variant || 0));
  }
  function spriteFor(b) {
    const d = BUILDINGS[b.type];
    if (b.level <= 0) {
      const bb = boundsFor(d.w, d.d, 30 + d.w * 5);
      return sprite('site|' + d.w + '|' + d.d, bb[0], bb[1], bb[2], bb[3], c => drawSite(c, d.w, d.d));
    }
    let v = 0;
    if (b.type === 'fence' || b.type === 'path') v = maskOf(b, b.type);
    else if (b.type === 'obs_tree') v = b.id % 3;
    return buildingSprite(b.type, b.level, v);
  }

  /* ---------------- Menschen & Tiere ---------------- */
  const SKIN = ['#f6d3b3', '#e8b48a', '#c98f5f', '#8f5b3a'];
  const HAIR = ['#3b2a1a', '#7a4a21', '#d9a441', '#1f1f1f', '#a0522d'];
  function drawPerson(c, x, y, o) {
    const s = o.scale || 1;
    const swing = o.moving ? Math.sin(o.walkT) * 2.4 * s : 0;
    const bob = o.moving ? Math.abs(Math.sin(o.walkT)) * 1.2 * s : 0;
    c.globalAlpha = 0.22; c.beginPath(); c.ellipse(x, y, 5 * s, 2.2 * s, 0, 0, 7); c.fillStyle = '#000'; c.fill(); c.globalAlpha = 1;
    c.lineCap = 'round';
    c.strokeStyle = o.pants || '#334766'; c.lineWidth = 2.3 * s;
    c.beginPath(); c.moveTo(x - 1.6 * s, y - 7 * s - bob); c.lineTo(x - 1.6 * s + swing, y - 0.6 * s); c.stroke();
    c.beginPath(); c.moveTo(x + 1.6 * s, y - 7 * s - bob); c.lineTo(x + 1.6 * s - swing, y - 0.6 * s); c.stroke();
    if (o.kind === 'backpacker') { c.fillStyle = '#7c5a2e'; rr(c, x - o.dir * 7 * s - 3 * s, y - 18 * s - bob, 6 * s, 11 * s, 2 * s); c.fill(); c.strokeStyle = OL; c.lineWidth = 1; c.stroke(); }
    c.fillStyle = o.shirt; rr(c, x - 4.2 * s, y - 15.5 * s - bob, 8.4 * s, 9.5 * s, 3 * s); c.fill();
    c.strokeStyle = OL; c.lineWidth = 1; c.stroke();
    c.strokeStyle = o.skin; c.lineWidth = 1.8 * s;
    c.beginPath(); c.moveTo(x - 4 * s, y - 13 * s - bob); c.lineTo(x - 5 * s - swing * 0.5, y - 8.5 * s - bob); c.stroke();
    c.beginPath(); c.moveTo(x + 4 * s, y - 13 * s - bob); c.lineTo(x + 5 * s + swing * 0.5, y - 8.5 * s - bob); c.stroke();
    const hy = y - 19.5 * s - bob;
    circle(c, x, hy, 3.9 * s, o.skin, OL, 1);
    if (o.kind === 'camper') {
      c.fillStyle = '#15803d'; c.beginPath(); c.arc(x, hy - 0.5 * s, 4 * s, Math.PI, 0); c.fill();
      c.fillRect(x + (o.dir > 0 ? 0 : -6 * s), hy - 1.2 * s, 6 * s, 1.6 * s);
    } else if (o.kind === 'senior' || o.kind === 'senior2') {
      c.fillStyle = '#d4d4d8'; c.beginPath(); c.arc(x, hy - 0.8 * s, 4 * s, Math.PI * 1.05, -0.05); c.fill();
      if (o.kind === 'senior') { c.fillStyle = '#d6c08a'; c.fillRect(x - 5 * s, hy - 3.6 * s, 10 * s, 1.5 * s); c.fillRect(x - 3 * s, hy - 6.4 * s, 6 * s, 3 * s); }
    } else {
      c.fillStyle = o.hair; c.beginPath(); c.arc(x, hy - 0.8 * s, 4 * s, Math.PI * 1.05, -0.05); c.fill();
    }
  }

  function drawGuest(g) {
    const T = GUESTS.types[g.type];
    const off = [[0, 0], [-0.22, 0.12], [0.18, 0.2]];
    const seed = g.id;
    for (let i = g.members.length - 1; i >= 0; i--) {
      const kind = g.members[i];
      const o = off[i] || [0, 0];
      const p = P(g.x + o[0], g.y + o[1]);
      let shirt = T.colors.shirt;
      if (kind === 'adult2' || kind === 'senior2') shirt = T.colors.shirt2 || shirt;
      if (kind === 'kid') shirt = T.colors.kid;
      drawPerson(ctx, p[0], p[1], {
        kind: kind === 'adult2' ? 'adult' : kind, shirt, scale: kind === 'kid' ? 0.68 : 1,
        skin: SKIN[(seed + i) % SKIN.length], hair: HAIR[(seed * 3 + i) % HAIR.length],
        walkT: g.walkT + i * 1.3, moving: g.moving, dir: g.dir,
        pants: kind === 'kid' ? '#3b82f6' : '#334766',
      });
    }
  }

  function drawDog(dog) {
    const p = P(dog.x, dog.y);
    const x = p[0], y = p[1], dir = dog.dir || 1;
    const legs = dog.moving ? Math.sin(dog.walkT * 1.5) * 2 : 0;
    ctx.globalAlpha = 0.22; ctx.beginPath(); ctx.ellipse(x, y, 7, 2.5, 0, 0, 7); ctx.fillStyle = '#000'; ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = '#7a4a21'; ctx.lineWidth = 2;
    for (const lx of [-4, 4]) { ctx.beginPath(); ctx.moveTo(x + lx, y - 5); ctx.lineTo(x + lx + legs, y); ctx.stroke(); }
    ctx.beginPath(); ctx.ellipse(x, y - 7, 7, 4, 0, 0, 7); ctx.fillStyle = '#b7793f'; ctx.fill(); ctx.strokeStyle = OL; ctx.lineWidth = 1; ctx.stroke();
    const wag = Math.sin(time * 18) * 3;
    line(ctx, [x - dir * 6, y - 8], [x - dir * 10, y - 13 + wag], '#b7793f', 2);
    circle(ctx, x + dir * 7, y - 11, 4, '#c58a4f', OL, 1);
    ctx.beginPath(); ctx.ellipse(x + dir * 5, y - 12, 1.8, 3.4, dir * 0.3, 0, 7); ctx.fillStyle = '#7a4a21'; ctx.fill();
    circle(ctx, x + dir * 10.5, y - 11, 1.2, '#1f1f1f');
    ctx.fillStyle = '#ef4444'; ctx.fillRect(x + dir * 3 - 1.5, y - 9, 3, 2);
  }

  /* ---------------- Animationen pro Frame ---------------- */
  function emitSmoke(b, gx, gy, z, rate, dt, big) {
    b._smoke = (b._smoke || 0) + dt * rate;
    while (b._smoke >= 1) {
      b._smoke -= 1;
      const p = P(gx, gy, z);
      particles.push({ k: 'smoke', x: p[0] + (Math.random() - 0.5) * 4, y: p[1], vx: 3 + Math.random() * 4, vy: -12 - Math.random() * 8, life: 0, max: 2.6 + Math.random(), r: big ? 4 : 3, gr: big ? 5 : 3.5 });
    }
  }
  // Zusätzliche Animationen je Gebäudetyp: fn(ctx, b, time, dt, fx); ctx ist auf den Gebäudeursprung verschoben
  const ANIM = {
    // ---- sport ----
    // Ballwechsel über das Netz
    tabletennis(ctx, b, t) {
      const ph = (t * 0.85 + b.id * 0.37) % 2;
      const s = ph % 1, dir = ph < 1 ? 1 : -1;
      const x = dir > 0 ? 0.42 + s * 1.16 : 1.58 - s * 1.16;
      const y = 1 + Math.sin(t * 1.3 + b.id) * 0.16;
      const zt = b.level >= 4 ? 14 : 15;
      let z;
      if (s < 0.75) { const k = s / 0.75; z = 20 + (zt - 20) * k + 9 * Math.sin(Math.PI * k); }
      else { const k = (s - 0.75) / 0.25; z = zt + 5 * k + 4 * Math.sin(Math.PI * k); }
      const g = P(x, y, x > 0.34 && x < 1.66 ? zt : 0), p = P(x, y, z);
      ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.ellipse(g[0], g[1], 2, 1, 0, 0, 7); ctx.fillStyle = '#000'; ctx.fill(); ctx.globalAlpha = 1;
      circle(ctx, p[0], p[1], 1.7, '#fb923c', OL, 0.7);
      circle(ctx, p[0] - 0.5, p[1] - 0.6, 0.6, '#ffffff');
    },
    // Ball rollt und hüpft übers Feld
    soccer(ctx, b, t) {
      const ph = (t * 0.2 + b.id * 0.29) % 2;
      const u = ph < 1 ? ph : 2 - ph;
      const s = u * u * (3 - 2 * u);
      const x = 0.85 + s * 2.3, y = 1.5 + Math.sin(t * 0.8 + b.id) * 0.75;
      const z = Math.abs(Math.sin(s * Math.PI * 3)) * 6;
      const g = P(x, y), p = P(x, y, z + 2.6);
      ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.ellipse(g[0], g[1], 3, 1.4, 0, 0, 7); ctx.fillStyle = '#000'; ctx.fill(); ctx.globalAlpha = 1;
      circle(ctx, p[0], p[1], 2.7, '#ffffff', OL, 1);
      circle(ctx, p[0] + Math.cos(t * 6) * 1, p[1] - 0.4, 1, '#1f2937');
    },
    // Kletterer: langsam hoch, schnell abseilen
    climbing(ctx, b, t) {
      const ph = (t / 16 + b.id * 0.37) % 1;
      const up = ph < 0.8;
      const z = up ? 8 + (ph / 0.8) * 48 : 56 - ((ph - 0.8) / 0.2) * 48;
      const p = P(0.98, 1.52, z);
      const x = p[0], y = p[1];
      const k = up ? Math.sin(t * 5 + b.id) : 0;
      const shirt = ['#ef4444', '#22c55e', '#f59e0b', '#8b5cf6'][b.id % 4];
      line(ctx, [x - 1.4, y - 5], [x - 3, y - 0.5 - k * 1.5], '#334766', 1.7);
      line(ctx, [x + 1.4, y - 5], [x + 3, y - 0.5 + k * 1.5], '#334766', 1.7);
      line(ctx, [x - 1.8, y - 10], [x - 3.2, y - 15 + k * 1.5], '#f6d3b3', 1.4);
      line(ctx, [x + 1.8, y - 10], [x + 3.2, y - 15 - k * 1.5], '#f6d3b3', 1.4);
      ctx.fillStyle = shirt; rr(ctx, x - 2.6, y - 11, 5.2, 6.5, 1.8); ctx.fill(); ctx.strokeStyle = OL; ctx.lineWidth = 0.8; ctx.stroke();
      circle(ctx, x, y - 13.2, 2.4, '#facc15', OL, 0.8);
    },
  
    // ---- kultur ----
    library(ctx, b, t, dt, fx) {
      if (b.level >= 7) fx.smoke(1.085, 0.465, 55, 0.7);
      if (fx.night < 0.05) return;
      // warmes Licht in den Fenstern
      ctx.globalAlpha = 0.5 * Math.min(1, fx.night * 1.3);
      faceY(ctx, 1.3, 0.38, 0.98, 8, 21, '#ffc861');
      faceX(ctx, 1.5, 0.44, 0.76, 11, 18, '#ffc861');
      faceY(ctx, 1.3, 1.16, 1.36, 13, 19, '#ffc861');
      ctx.globalAlpha = 1;
    },
    stage(ctx, b, t, dt, fx) {
      if (Math.random() < dt * (0.3 + fx.night * 0.6)) fx.note(1.1 + Math.random() * 0.4, 1.1 + Math.random() * 0.4, 34, ['#7c3aed', '#db2777', '#2563eb'][Math.random() * 3 | 0]);
      if (b.level < 4 || fx.night < 0.05) return;
      const k = Math.min(1, fx.night * 1.4);
      [[2.9, 0.28], [0.28, 2.9]].forEach(([x, y], i) => {
        const s = P(x, y, 61), f = P(1.25 + (i ? -0.15 : 0.15) + Math.sin(t * 0.7 + i * 2) * 0.25, 1.25 + (i ? 0.15 : -0.15) - Math.sin(t * 0.7 + i * 2) * 0.25, 10);
        const col = b.level >= 7 ? `hsla(${(t * 40 + i * 160) % 360},90%,70%,` : 'rgba(255,240,190,';
        ctx.beginPath(); ctx.moveTo(s[0], s[1]); ctx.lineTo(f[0] - 14, f[1]); ctx.lineTo(f[0] + 14, f[1]); ctx.closePath();
        ctx.fillStyle = col + (0.22 * k) + ')'; ctx.fill();
        ctx.beginPath(); ctx.ellipse(f[0], f[1], 14, 6, 0, 0, Math.PI * 2); ctx.fillStyle = col + (0.3 * k) + ')'; ctx.fill();
      });
    },
    cinema(ctx, b, t, dt, fx) {
      const k = Math.max(0, Math.min(1, (fx.night - 0.15) / 0.5));
      if (k <= 0) return;
      const big = b.level >= 7;
      const ys = 0.42;
      const xa = big ? 0.42 : 0.55, xb = big ? 3.58 : 3.45, za = big ? 16 : 20, zb = big ? 66 : 60;
      // Projektorstrahl
      const sm = b.level < 4, f = sm ? 0.76 : 1;
      const lens = P((sm ? 3.42 : 3.22) + 0.23 * f, (sm ? 2.32 : 2.08) + 0.24 * f, sm ? 27 : 31);
      const c1 = P(xa + 0.06, ys, za + 2.5), c2 = P(xa + 0.06, ys, zb - 2.5), c3 = P(xb - 0.06, ys, zb - 2.5), c4 = P(xb - 0.06, ys, za + 2.5);
      const g = ctx.createLinearGradient(lens[0], lens[1], (c2[0] + c4[0]) / 2, (c2[1] + c4[1]) / 2);
      g.addColorStop(0, `rgba(230,245,255,${0.32 * k})`); g.addColorStop(1, `rgba(230,245,255,${0.04 * k})`);
      ctx.beginPath(); ctx.moveTo(lens[0], lens[1]); ctx.lineTo(c1[0], c1[1]); ctx.lineTo(c2[0], c2[1]); ctx.lineTo(c3[0], c3[1]); ctx.lineTo(c4[0], c4[1]); ctx.closePath();
      ctx.fillStyle = g; ctx.fill();
      // Film auf der Leinwand (Ebene y = ys, schräg projiziert)
      const u0 = (xa + 0.06) * 32, u1 = (xb - 0.06) * 32, w0 = -(zb - 2.5), w1 = -(za + 2.5);
      const q = P(0, ys, 0);
      ctx.save();
      ctx.translate(q[0], q[1]); ctx.transform(1, 0.5, 0, 1, 0, 0);
      ctx.beginPath(); ctx.rect(u0, w0, u1 - u0, w1 - w0); ctx.clip();
      const sc = [[40, 70, 160], [240, 140, 60], [60, 150, 90], [150, 60, 170]];
      const ph = t / 6 + b.id * 0.37, i0 = Math.floor(ph) % 4, mix = Math.min(1, (ph % 1) * 4);
      const A = sc[i0], B = sc[(i0 + 3) % 4];
      const fl = 0.9 + 0.1 * Math.sin(t * 29) * Math.sin(t * 13);
      ctx.globalAlpha = k * fl;
      ctx.fillStyle = `rgb(${B[0] + (A[0] - B[0]) * mix | 0},${B[1] + (A[1] - B[1]) * mix | 0},${B[2] + (A[2] - B[2]) * mix | 0})`;
      ctx.fillRect(u0, w0, u1 - u0, w1 - w0);
      const m = u0 + ((t * 9 + b.id * 31) % (u1 - u0 + 30)) - 15;
      circle(ctx, m, w0 + 11, 7, 'rgba(255,240,200,0.85)');
      ctx.beginPath(); ctx.moveTo(u0, w1);
      for (let i = 0; i <= 6; i++) ctx.lineTo(u0 + (u1 - u0) * i / 6, w1 - 9 - 6 * Math.sin(i * 1.7 + t * 0.5 + b.id));
      ctx.lineTo(u1, w1); ctx.closePath();
      ctx.fillStyle = 'rgba(20,30,40,0.7)'; ctx.fill();
      ctx.fillStyle = `rgba(255,255,255,${0.12 * Math.max(0, Math.sin(t * 2.3))})`; ctx.fillRect(u0, w0, u1 - u0, w1 - w0);
      ctx.restore();
    },
  
    // ---- kunst ----
    sculpture(ctx, b, t, dt, fx) {
      if (b.level < 7) return;
      if (b.level >= 9) { // Brunnenstrahlen
        const s = P(1.5, 1.5, 12);
        ctx.strokeStyle = 'rgba(224,247,255,0.85)'; ctx.lineWidth = 1.4;
        for (let i = 0; i < 4; i++) {
          const a = i * Math.PI / 2 + 0.785, e = P(1.5 + Math.cos(a) * 0.36, 1.5 + Math.sin(a) * 0.36, 6);
          const k = 1 + Math.sin(t * 6 + i) * 0.08;
          ctx.beginPath(); ctx.moveTo(s[0], s[1]); ctx.quadraticCurveTo((s[0] + e[0]) / 2, s[1] - 9 * k, e[0], e[1]); ctx.stroke();
        }
        const ph = (t * 0.7) % 1, m = P(1.5, 1.5, 6);
        ctx.globalAlpha = 1 - ph;
        ctx.beginPath(); ctx.ellipse(m[0], m[1], 6 + ph * 16, 3 + ph * 8, 0, 0, 7); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      // Funkeln am Stern
      const u = (t * 0.6 + b.id * 0.37) % 1;
      if (u < 0.25) {
        const q = P(1.5, 1.5, 49), r = Math.sin(u / 0.25 * Math.PI) * 4.5;
        ctx.fillStyle = '#fffbe6';
        ctx.beginPath(); ctx.moveTo(q[0] + 3, q[1] - r); ctx.lineTo(q[0] + 3.8, q[1] - 0.8); ctx.lineTo(q[0] + 3 + r, q[1]); ctx.lineTo(q[0] + 3.8, q[1] + 0.8);
        ctx.lineTo(q[0] + 3, q[1] + r); ctx.lineTo(q[0] + 2.2, q[1] + 0.8); ctx.lineTo(q[0] + 3 - r, q[1]); ctx.lineTo(q[0] + 2.2, q[1] - 0.8); ctx.closePath(); ctx.fill();
      }
    },
    pottery(ctx, b, t, dt, fx) {
      fx.smoke(2.04, 0.38, 68, 1.1);
      // Drehscheibe dreht sich
      const p = P(2.57, 1.81, 10), a = t * 7;
      ctx.fillStyle = '#e2e8f0';
      ctx.beginPath(); ctx.ellipse(p[0] + Math.cos(a) * 6, p[1] + Math.sin(a) * 3, 1.3, 0.8, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(90,40,15,0.5)'; ctx.lineWidth = 0.8;
      const w = Math.sin(t * 7) * 2.5;
      ctx.beginPath(); ctx.moveTo(p[0] + w, p[1] - 1); ctx.lineTo(p[0] + w * 0.6, p[1] - 7); ctx.stroke();
      // Glut im Ofen flackert
      const g = b.level >= 7 ? P(2.4, 0.84) : P(2.38, 0.79, 3);
      if (b.level >= 7) g[0] += 6, g[1] += 3;
      ctx.globalAlpha = Math.max(0, 0.55 + Math.sin(t * 9) * 0.25 + Math.sin(t * 23) * 0.15);
      ctx.beginPath(); ctx.ellipse(g[0], g[1], 2.6, 1.6, 0, 0, 7); ctx.fillStyle = '#fef08a'; ctx.fill();
      ctx.globalAlpha = 1;
    },
  
    // ---- party ----
    bbq(ctx, b, t, dt, fx) {
      const big = b.level >= 4;
      const gx = big ? 1.35 : 1.43, gy = big ? 0.48 : 0.45;
      fx.smoke(gx, gy, big ? 18 : 16, b.level >= 7 ? 1 : 2.2, false);
      if (b.level >= 7) fx.smoke(1.35, 0.16, 38, 1.4, false);
      if (Math.random() < dt * 2.2) fx.spark(gx + (Math.random() - 0.5) * 0.5, gy, 16);
    },
    beachbar(ctx, b, t, dt, fx) {
      const big = b.level >= 7;
      const spots = big ? [[1.0, 2.82], [2.85, 2.2], [0.2, 1.7]] : [[1.0, 2.82]];
      for (let i = 0; i < spots.length; i++) {
        const p = P(spots[i][0], spots[i][1], 29);
        const f = Math.sin(t * 11 + i * 2) * 1.2 + Math.sin(t * 17 + i) * 0.8;
        ctx.beginPath(); ctx.moveTo(p[0] - 3, p[1]); ctx.quadraticCurveTo(p[0] - 3, p[1] - 6, p[0] + f, p[1] - 10 - f);
        ctx.quadraticCurveTo(p[0] + 3, p[1] - 6, p[0] + 3, p[1]); ctx.closePath();
        ctx.fillStyle = '#f97316'; ctx.fill();
        circle(ctx, p[0], p[1] - 3, 1.8, '#fde047');
      }
      if (Math.random() < dt * 0.5) fx.note(1.5, 1.7, 30, ['#ec4899', '#0ea5e9', '#f97316'][(Math.random() * 3) | 0]);
    },
    festtent(ctx, b, t, dt, fx) {
      const big = b.level >= 7;
      const x0 = big ? 0.3 : 0.5, x1 = big ? 3.7 : 3.5, y0 = big ? 0.28 : 0.42, y1 = big ? 3.52 : 3.38;
      const xm = (x0 + x1) / 2;
      const tips = big ? [y0 + (y1 - y0) * 0.27, y0 + (y1 - y0) * 0.73] : [(y0 + y1) / 2];
      const cols = ['#ef4444', '#facc15'];
      for (let i = 0; i < tips.length; i++) {
        const p = P(xm, tips[i], 78);
        const w = Math.sin(t * 6 + i * 1.7) * 1.8;
        ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.quadraticCurveTo(p[0] + 5, p[1] + w, p[0] + 11, p[1] + 2 + w * 1.4); ctx.lineTo(p[0], p[1] + 5); ctx.closePath();
        ctx.fillStyle = cols[i % 2]; ctx.fill(); ctx.strokeStyle = OL; ctx.lineWidth = 0.8; ctx.stroke();
      }
      if (fx.night > 0.05) { // Fenster leuchten
        const nw = big ? 5 : 4;
        ctx.globalAlpha = Math.min(1, fx.night * 1.1);
        for (let i = 0; i < nw; i++) {
          const ya = y0 + 0.3 + i * (y1 - y0 - 0.4) / nw, yb = ya + 0.3;
          poly(ctx, [P(x1, yb, 9), P(x1, ya, 9), P(x1, ya, 19), P(x1, (ya + yb) / 2, 23), P(x1, yb, 19)], '#fcd34d');
        }
        ctx.globalAlpha = 1;
      }
      if (Math.random() < dt * 1.1) fx.note(x0 + 0.7, y1 - 0.3, 34, ['#7c3aed', '#e11d48', '#0ea5e9', '#f59e0b'][(Math.random() * 4) | 0]);
    },
  
    // ---- hygiene ----
    laundry(ctx, b, t, dt, fx) {
      const L = b.level, n = L >= 4 ? 3 : 2;
      // Nachts: Licht aus dem Waschraum
      if (fx.night > 0.05) {
        ctx.globalAlpha = fx.night * 0.75;
        faceY(ctx, 1.2, 0.55, 1.62, 16, 19, '#fde68a');
        faceX(ctx, 1.72, 0.71, 0.99, 1.5, 19, '#fde68a');
        faceX(ctx, 1.72, 0.33, 0.51, 13.5, 20.5, '#fde68a');
        ctx.globalAlpha = 1;
      }
      // Wäsche dreht sich in der Trommel
      for (let i = 0; i < n; i++) {
        const p = P(0.74 + i * 0.335, 1.26, 7.5), a = t * (5 + i) + i * 2;
        ctx.save(); ctx.translate(p[0], p[1]); ctx.transform(1, 0.5, 0, 1, 0, 0);
        circle(ctx, Math.cos(a) * 1.4, Math.sin(a) * 1.4, 1.2, ['#f472b6', '#facc15', '#fb7185'][i]);
        ctx.restore();
      }
      // Seifenblasen: klein, weißlich, steigen nur bis zur Traufe und verblassen
      for (let i = 0; i < 4; i++) {
        const ph = (t * 0.3 + i * 0.25 + b.id * 0.13) % 1;
        const q = P(0.7 + i * 0.28, 1.4, 10 + ph * 17), x = q[0] + Math.sin(t * 2 + i * 1.7) * 2.5, r = 1.2 + ph * 0.7;
        ctx.globalAlpha = Math.min(1, ph * 6) * (1 - ph) * 0.95;
        circle(ctx, x, q[1], r, 'rgba(255,255,255,0.8)', '#93c5fd', 0.6);
        circle(ctx, x - r * 0.35, q[1] - r * 0.35, r * 0.35, '#ffffff');
      }
      ctx.globalAlpha = 1;
      if (L >= 4) fx.smoke(1.76, 0.42, 25.5, 0.5);
    },
    spa(ctx, b, t, dt, fx) {
      const cx = 3.22, cy = 2.12, st = stageOf(b.level);
      // Nachts: warmes Licht hinter den Glasfronten
      if (fx.night > 0.05) {
        ctx.globalAlpha = fx.night * 0.6;
        const g = '#fcd9a0';
        if (st === 0) { faceY(ctx, 1.35, 0.45, 1.25, 10, 25, g); faceY(ctx, 1.35, 1.95, 2.32, 3, 25, g); faceX(ctx, 2.5, 0.55, 1.0, 12, 24, g); }
        else if (st === 1) { faceY(ctx, 1.35, 0.42, 1.65, 6, 27, g); faceY(ctx, 1.35, 1.95, 2.33, 3, 27, g); faceX(ctx, 2.5, 0.4, 1.15, 6, 27, g); }
        else { faceY(ctx, 1.35, 0.35, 2.4, 3, 32, g); faceX(ctx, 2.5, 0.32, 1.25, 3, 32, g); faceY(ctx, 1.15, 0.6, 1.7, 40, 53, g); }
        ctx.globalAlpha = 1;
      }
      // Sprudelblasen im Whirlpool
      for (let i = 0; i < 6; i++) {
        const a = i * 1.05 + Math.sin(t * 0.7 + i) * 0.4, rr2 = 0.12 + ((t * 0.6 + i * 0.37) % 1) * 0.26;
        const q = P(cx + Math.cos(a) * rr2, cy + Math.sin(a) * rr2, 14);
        ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t * 6 + i * 2);
        circle(ctx, q[0], q[1] - 0.5, 1.1, '#ecfeff');
      }
      ctx.globalAlpha = 1;
      fx.smoke(cx, cy, 15, 1.3);
      fx.smoke(3.56, 0.5, 42, 0.5);
      if (b.level >= 7) { // Glitzern auf dem Infinity-Pool
        ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1;
        for (let i = 0; i < 2; i++) {
          const ph = (t * 0.4 + i * 0.5) % 1;
          const q = P(0.6 + i * 0.7 + ph * 0.3, 1.8, 7);
          ctx.globalAlpha = Math.sin(ph * Math.PI);
          ctx.beginPath(); ctx.moveTo(q[0] - 5, q[1]); ctx.lineTo(q[0] + 5, q[1]); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    },
  
  };
  function fxFor(b, dt) {
    return {
      smoke: (lx, ly, z, rate, big) => emitSmoke(b, b.gx + lx, b.gy + ly, z, rate, dt, big),
      note: (lx, ly, z, color) => { const q = P(b.gx + lx, b.gy + ly, z); particles.push({ k: 'note', x: q[0], y: q[1], vx: (Math.random() - 0.5) * 10, vy: -20, life: 0, max: 2.2, c: color || '#7c3aed' }); },
      spark: (lx, ly, z) => { const q = P(b.gx + lx, b.gy + ly, z); particles.push({ k: 'spark', x: q[0], y: q[1], vx: (Math.random() - 0.5) * 16, vy: -25 - Math.random() * 15, life: 0, max: 0.9 }); },
      night: dayInfo().dark,
    };
  }
  function animBuilding(b, dt, wx, wy) {
    if (b.level <= 0) return;
    const d = BUILDINGS[b.type];
    const t = time;
    ctx.save();
    ctx.translate(wx, wy);
    switch (b.type) {
      case 'campfire': {
        const p = P(1, 1);
        for (let i = 0; i < 3; i++) {
          const f = Math.sin(t * 11 + i * 2.1) * 0.5 + Math.sin(t * 7.3 + i) * 0.5;
          const h = 15 + f * 4 + (i === 1 ? 5 : 0);
          const ox = (i - 1) * 4;
          ctx.beginPath();
          ctx.moveTo(p[0] + ox - 4.5, p[1] - 2);
          ctx.quadraticCurveTo(p[0] + ox - 5, p[1] - h * 0.6, p[0] + ox + f * 2, p[1] - h);
          ctx.quadraticCurveTo(p[0] + ox + 5, p[1] - h * 0.6, p[0] + ox + 4.5, p[1] - 2);
          ctx.closePath();
          ctx.fillStyle = i === 1 ? '#f97316' : '#ef4444'; ctx.fill();
        }
        ctx.beginPath(); ctx.moveTo(p[0] - 3, p[1] - 2); ctx.quadraticCurveTo(p[0], p[1] - 14 - Math.sin(t * 13) * 2, p[0] + 3, p[1] - 2); ctx.closePath();
        ctx.fillStyle = '#fde047'; ctx.fill();
        ctx.restore();
        emitSmoke(b, b.gx + 1, b.gy + 1, 20, 2.2, dt, true);
        if (Math.random() < dt * 3) { const q = P(b.gx + 1, b.gy + 1, 14); particles.push({ k: 'spark', x: q[0], y: q[1], vx: (Math.random() - 0.5) * 16, vy: -25 - Math.random() * 15, life: 0, max: 0.9 }); }
        return;
      }
      case 'reception': {
        const base = P(3.85, 3.85, 86);
        ctx.beginPath();
        ctx.moveTo(base[0], base[1]);
        for (let i = 0; i <= 6; i++) { const u = i / 6; ctx.lineTo(base[0] + u * 22, base[1] + Math.sin(t * 5 + u * 4) * 2.5 * u - u * 2); }
        for (let i = 6; i >= 0; i--) { const u = i / 6; ctx.lineTo(base[0] + u * 22, base[1] + 12 + Math.sin(t * 5 + u * 4) * 2.5 * u - u * 2); }
        ctx.closePath();
        ctx.fillStyle = '#16a34a'; ctx.fill(); ctx.strokeStyle = OL; ctx.lineWidth = 1; ctx.stroke();
        const m = P(3.85, 3.85, 80);
        circle(ctx, m[0] + 9, m[1] + Math.sin(t * 5 + 2) * 1.2, 2.6, '#facc15');
        ctx.restore();
        if (b.level >= 3) emitSmoke(b, b.gx + 2.95, b.gy + 1.95, 6 + (b.level >= 5 ? 46 : 32) + 44, 0.9, dt);
        return;
      }
      case 'lumberjack': ctx.restore(); emitSmoke(b, b.gx + 0.48, b.gy + 0.55, 46, 1, dt); return;
      case 'glamping': {
        const top = P(1.45, 1.45, 71);
        ctx.beginPath(); ctx.moveTo(top[0], top[1]);
        ctx.lineTo(top[0] + 10, top[1] + 2 + Math.sin(t * 6) * 1.5); ctx.lineTo(top[0], top[1] + 5); ctx.closePath();
        ctx.fillStyle = '#ef4444'; ctx.fill();
        break;
      }
      case 'lake': {
        ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.2;
        for (let i = 0; i < 4; i++) {
          const ph = (t * 0.4 + i * 0.25) % 1;
          const p = P(1.3 + hash(i, 1) * 1.4, 1.2 + hash(i, 2) * 1.2);
          ctx.globalAlpha = Math.sin(ph * Math.PI) * 0.8;
          ctx.beginPath(); ctx.moveTo(p[0] - 6 - ph * 4, p[1]); ctx.lineTo(p[0] + 6 + ph * 4, p[1]); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        const a = t * 0.35 + b.id;
        const dx = 2 + Math.cos(a) * 0.9, dy = 1.95 + Math.sin(a) * 0.75;
        const q = P(dx, dy);
        const dir = Math.cos(a + Math.PI / 2) - Math.sin(a + Math.PI / 2) > 0 ? 1 : -1;
        ctx.beginPath(); ctx.ellipse(q[0], q[1] - 2, 5, 3, 0, 0, 7); ctx.fillStyle = '#fafafa'; ctx.fill(); ctx.strokeStyle = OL; ctx.lineWidth = 0.9; ctx.stroke();
        circle(ctx, q[0] + dir * 4, q[1] - 6, 2.3, '#16a34a', OL, 0.8);
        ctx.fillStyle = '#f59e0b'; ctx.fillRect(q[0] + dir * 6 - (dir < 0 ? 2 : 0), q[1] - 6, 2, 1.2);
        break;
      }
      case 'pool': {
        ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1.1;
        for (let i = 0; i < 5; i++) {
          const ph = (t * 0.5 + i * 0.2) % 1;
          const p = P(0.9 + hash(i, 5) * 2.2, 0.9 + hash(i, 6) * 1.8, -2);
          ctx.globalAlpha = Math.sin(ph * Math.PI) * 0.9;
          ctx.beginPath(); ctx.moveTo(p[0] - 5, p[1] + Math.sin(t * 3 + i)); ctx.quadraticCurveTo(p[0], p[1] - 2, p[0] + 5, p[1] + Math.sin(t * 3 + i)); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'volleyball': {
        const ph = (t * 0.8 + b.id) % 2;
        const u = ph < 1 ? ph : 2 - ph;
        const bx = 1 + u * 2, h = 6 + Math.sin(u * Math.PI) * 34;
        const p = P(bx, 1.5, h);
        const sp = P(bx, 1.5, 0);
        ctx.globalAlpha = 0.2; ctx.beginPath(); ctx.ellipse(sp[0], sp[1], 4, 2, 0, 0, 7); ctx.fillStyle = '#000'; ctx.fill(); ctx.globalAlpha = 1;
        circle(ctx, p[0], p[1], 3.6, '#fef08a', OL, 1);
        break;
      }
      default:
        if (ANIM[b.type]) ANIM[b.type](ctx, b, t, dt, fxFor(b, dt));
        break;
    }
    ctx.restore();
    void d;
  }

  function drawWorker(b, wx, wy) {
    const d = BUILDINGS[b.type];
    const gx = d.w, gy = d.d + 0.15;
    const p = P(gx * 0.5 + 0.25, gy);
    const x = wx + p[0], y = wy + p[1];
    drawPerson(ctx, x, y, { kind: 'worker', shirt: '#f97316', skin: SKIN[b.id % 4], hair: '#3b2a1a', walkT: 0, moving: false, dir: 1, pants: '#1e3a8a' });
    // Helm
    ctx.fillStyle = '#facc15'; ctx.beginPath(); ctx.arc(x, y - 20.5, 4.4, Math.PI, 0); ctx.fill(); ctx.strokeStyle = OL; ctx.lineWidth = 1; ctx.stroke();
    // Hammer
    const a = -0.6 + Math.abs(Math.sin(time * 7 + b.id)) * 1.4;
    ctx.save(); ctx.translate(x + 5, y - 12); ctx.rotate(-a);
    ctx.fillStyle = '#7a4a21'; ctx.fillRect(0, -1, 9, 2);
    ctx.fillStyle = '#6b7280'; ctx.fillRect(7, -3.5, 4, 7);
    ctx.restore();
    if (Math.random() < 0.04) particles.push({ k: 'dust', x: x + 12, y: y - 6, vx: (Math.random() - 0.5) * 20, vy: -10, life: 0, max: 0.6, r: 2 });
  }

  /* ---------------- Boden ---------------- */
  function buildForest() {
    forest = [];
    const rx = Game.roadX(), ry = Game.gateTile().y;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        if (Game.ownedTile(x, y)) continue;
        if (x >= rx - 1 && x <= rx + 1 && y >= ry) continue;
        if (hash(x, y, 1) > 0.52) continue;
        const fx = x + 0.5 + (hash(x, y, 2) - 0.5) * 0.5, fy = y + 0.5 + (hash(x, y, 3) - 0.5) * 0.5;
        forest.push({ _k: 1, x: fx, y: fy, v: (hash(x, y, 4) * 3) | 0, s: 0.85 + hash(x, y, 5) * 0.45, _d: fx + fy });
      }
    }
    forestRl = Game.G.landVersion;
  }

  function drawGround() {
    // ganze Karte
    ctx.fillStyle = '#5e9e3c';
    poly(ctx, [P(0, 0), P(N, 0), P(N, N), P(0, N)], '#6db546');
    // sichtbarer Bereich in Kacheln
    const c1 = screenToGrid(0, 0), c2 = screenToGrid(W, 0), c3 = screenToGrid(0, H), c4 = screenToGrid(W, H);
    const gx0 = Math.max(0, Math.floor(Math.min(c1.x, c2.x, c3.x, c4.x)) - 1), gx1 = Math.min(N, Math.ceil(Math.max(c1.x, c2.x, c3.x, c4.x)) + 1);
    const gy0 = Math.max(0, Math.floor(Math.min(c1.y, c2.y, c3.y, c4.y)) - 1), gy1 = Math.min(N, Math.ceil(Math.max(c1.y, c2.y, c3.y, c4.y)) + 1);
    ctx.beginPath();
    for (let y = gy0; y < gy1; y++) {
      for (let x = gx0 + ((gx0 + y) & 1); x < gx1; x += 2) {
        const p0 = P(x, y), p1 = P(x + 1, y), p2 = P(x + 1, y + 1), p3 = P(x, y + 1);
        ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.lineTo(p3[0], p3[1]); ctx.closePath();
      }
    }
    ctx.fillStyle = '#77bf4e'; ctx.fill();
    // Grasbüschel & Blümchen
    if (cam.zoom > 0.55) {
      ctx.beginPath();
      for (let y = gy0; y < gy1; y++) for (let x = gx0; x < gx1; x++) {
        const r = hash(x, y, 11);
        if (r > 0.35) continue;
        const p = P(x + 0.25 + hash(x, y, 12) * 0.5, y + 0.25 + hash(x, y, 13) * 0.5);
        ctx.moveTo(p[0] - 3, p[1] - 4); ctx.lineTo(p[0] - 1, p[1]); ctx.lineTo(p[0], p[1] - 5); ctx.lineTo(p[0] + 1, p[1]); ctx.lineTo(p[0] + 3, p[1] - 4);
      }
      ctx.strokeStyle = '#4f9a33'; ctx.lineWidth = 1.1; ctx.stroke();
      for (let y = gy0; y < gy1; y++) for (let x = gx0; x < gx1; x++) {
        if (hash(x, y, 14) > 0.05) continue;
        const p = P(x + 0.5, y + 0.5);
        circle(ctx, p[0], p[1] - 1, 1.6, hash(x, y, 15) > 0.5 ? '#fff' : '#fde047');
      }
    }
    // fremde Grundstücke abdunkeln (kaufbare etwas heller)
    const LN = Game.LN;
    for (let pi = 0; pi < LN * LN; pi++) {
      const r = Game.parcelRect(pi);
      if (Game.ownedTile(r.x0, r.y0)) continue;
      const adj = parcelIsNext(pi);
      quad(ctx, r.x0, r.y0, r.x1, r.y1, 0, adj ? 'rgba(28,70,24,0.22)' : 'rgba(20,52,18,0.5)');
    }
    // Straße
    const rx = Game.roadX(), ry = Game.gateTile().y + 1;
    quad(ctx, rx, ry, rx + 1, N, 0, '#c8a066');
    line(ctx, P(rx + 0.3, ry), P(rx + 0.3, N), 'rgba(120,85,40,0.35)', 2);
    line(ctx, P(rx + 0.7, ry), P(rx + 0.7, N), 'rgba(120,85,40,0.35)', 2);
    // Grenze der eigenen Fläche (nur Außenkanten)
    ctx.beginPath();
    for (let pi = 0; pi < LN * LN; pi++) {
      const r = Game.parcelRect(pi);
      if (!Game.ownedTile(r.x0, r.y0)) continue;
      const edge = (x, y, a, b) => { if (!Game.ownedTile(x, y)) { ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); } };
      edge(r.x0, r.y0 - 1, P(r.x0, r.y0), P(r.x1, r.y0));
      edge(r.x0, r.y1, P(r.x0, r.y1), P(r.x1, r.y1));
      edge(r.x0 - 1, r.y0, P(r.x0, r.y0), P(r.x0, r.y1));
      edge(r.x1, r.y0, P(r.x1, r.y0), P(r.x1, r.y1));
    }
    ctx.setLineDash([10, 7]); ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]);
  }
  const parcelIsNext = pi => { const r = Game.parcelRect(pi); return [[r.x0 - 1, r.y0], [r.x1, r.y0], [r.x0, r.y0 - 1], [r.x0, r.y1]].some(([x, y]) => Game.ownedTile(x, y)); };

  /* Schilder auf kaufbaren Grundstücken + Müll & Trinkgeld */
  function drawLandAndPickups() {
    const LN = Game.LN;
    const z = cam.zoom;
    if (z > 0.32) {
      const info0 = Game.parcelInfo(0);
      for (let pi = 0; pi < LN * LN; pi++) {
        const r = Game.parcelRect(pi);
        if (Game.ownedTile(r.x0, r.y0) || !parcelIsNext(pi)) continue;
        const pc = gridToScreen((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, 0);
        if (pc.x < -60 || pc.x > W + 60 || pc.y < -40 || pc.y > H + 40) continue;
        // weit herausgezoomt kleiner, damit die Schilder den Platz nicht zudecken
        const k = Math.max(0.6, Math.min(1, z * 1.6));
        ctx.save(); ctx.translate(pc.x, pc.y); ctx.scale(k, k);
        const p = { x: 0, y: 0 };
        const ok = info0.permitted;
        const txt = ok ? fmtShortMoney(info0.cost.euro) : 'Rez. ' + (info0.nextRl || '–');
        ctx.font = '900 12px ui-rounded, system-ui, sans-serif';
        const w = Math.max(54, ctx.measureText(txt).width + 34), h = 26;
        // Pfosten & Schild
        line(ctx, [p.x, p.y + 4], [p.x, p.y - 8], '#7c5a2e', 3);
        ctx.fillStyle = ok ? '#fff7e6' : '#e5e7eb'; ctx.strokeStyle = ok ? '#7c5a2e' : '#6b7280'; ctx.lineWidth = 2;
        rr(ctx, p.x - w / 2, p.y - 8 - h, w, h, 8); ctx.fill(); ctx.stroke();
        if (ok) drawCoinIcon(ctx, p.x - w / 2 + 13, p.y - 8 - h / 2, 7, 'euro');
        else { ctx.fillStyle = '#6b7280'; rr(ctx, p.x - w / 2 + 8, p.y - 8 - h / 2 - 2, 10, 8, 2); ctx.fill(); ctx.strokeStyle = '#6b7280'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x - w / 2 + 13, p.y - 8 - h / 2 - 3, 3.3, Math.PI, 0); ctx.stroke(); }
        ctx.fillStyle = ok ? '#5b3a12' : '#4b5563'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(txt, p.x - w / 2 + 24, p.y - 8 - h / 2 + 1);
        ctx.textAlign = 'center';
        ctx.restore();
      }
    }
    for (const k of Game.S.pickups) {
      const p = gridToScreen(k.x, k.y, 0);
      if (p.x < -30 || p.x > W + 30 || p.y < -30 || p.y > H + 30) continue;
      const s = Math.max(0.7, Math.min(1.3, z));
      if (k.k === 'litter') {
        ctx.globalAlpha = 0.25; circle(ctx, p.x, p.y, 7 * s, '#000'); ctx.globalAlpha = 1;
        // zerknülltes Papier + Dose
        poly(ctx, [[p.x - 6 * s, p.y - 2 * s], [p.x - 2 * s, p.y - 8 * s], [p.x + 3 * s, p.y - 7 * s], [p.x + 5 * s, p.y - 2 * s], [p.x, p.y + 1 * s]], '#f8fafc', '#475569', 1.2);
        line(ctx, [p.x - 3 * s, p.y - 4 * s], [p.x + 2 * s, p.y - 5 * s], '#94a3b8', 1);
        ctx.fillStyle = '#ef4444'; rr(ctx, p.x + 3 * s, p.y - 4 * s, 4 * s, 6 * s, 1.5); ctx.fill(); ctx.strokeStyle = '#7f1d1d'; ctx.lineWidth = 1; ctx.stroke();
        // kleine Fliege
        const fx = p.x + Math.cos(time * 7 + k.id) * 8 * s, fy = p.y - 12 * s + Math.sin(time * 9 + k.id) * 3 * s;
        circle(ctx, fx, fy, 1.4, '#1f2937');
      } else {
        const bob = Math.sin(time * 4 + k.id) * 3;
        ctx.globalAlpha = 0.25; circle(ctx, p.x, p.y, 6 * s, '#000'); ctx.globalAlpha = 1;
        drawCoinIcon(ctx, p.x, p.y - 14 * s + bob, 9 * s, 'euro');
        drawHeart(ctx, p.x + 8 * s, p.y - 22 * s + bob, 4 * s);
      }
    }
  }
  function fmtShortMoney(v) { return v >= 1e6 ? (v / 1e6).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' Mio. €' : v >= 1e4 ? Math.round(v / 1000) + ' Tsd. €' : v.toLocaleString('de-DE') + ' €'; }
  function hitPickup(sx, sy) {
    let best = null, bd = Math.max(24, 26 * cam.zoom);
    for (const k of Game.S.pickups) {
      const p = gridToScreen(k.x, k.y, 0);
      const dd = Math.hypot(p.x - sx, p.y - 8 * cam.zoom - sy);
      if (dd < bd) { bd = dd; best = k; }
    }
    return best;
  }
  // fremdes Grundstück unter dem Finger (oder am Schild)
  function hitParcel(sx, sy) {
    const g = screenToGrid(sx, sy + 20);
    for (const gg of [g, screenToGrid(sx, sy)]) {
      const x = Math.floor(gg.x), y = Math.floor(gg.y);
      const pi = Game.parcelAt(x, y);
      if (pi >= 0 && !Game.ownedTile(x, y)) return pi;
    }
    return -1;
  }

  /* ---------------- Partikel ---------------- */
  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life += dt;
      if (p.life >= p.max) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      const u = p.life / p.max;
      switch (p.k) {
        case 'smoke':
          ctx.globalAlpha = (1 - u) * 0.45;
          circle(ctx, p.x, p.y, p.r + u * p.gr * 3, '#d6d3d1');
          break;
        case 'spark':
          p.vy += 20 * dt;
          ctx.globalAlpha = 1 - u;
          circle(ctx, p.x, p.y, 1.2, '#fde047');
          break;
        case 'dust':
          ctx.globalAlpha = (1 - u) * 0.6;
          circle(ctx, p.x, p.y, p.r + u * 6, '#e7d3a8');
          break;
        case 'confetti':
          p.vy += 140 * dt; p.vx *= 0.98;
          ctx.globalAlpha = 1 - u * u;
          ctx.fillStyle = p.c;
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.life * 8 + p.r); ctx.fillRect(-2.5, -1.5, 5, 3); ctx.restore();
          break;
        case 'heart':
          ctx.globalAlpha = 1 - u;
          drawHeart(ctx, p.x + Math.sin(p.life * 6) * 3, p.y, 5);
          break;
        case 'note':
          ctx.globalAlpha = 1 - u;
          ctx.fillStyle = p.c; ctx.font = 'bold 12px system-ui, sans-serif'; ctx.textAlign = 'center';
          ctx.fillText('♪', p.x + Math.sin(p.life * 4) * 4, p.y);
          break;
        case 'text':
          ctx.globalAlpha = u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3;
          p.vy *= 0.96;
          outlined(ctx, p.text, p.x, p.y, 15 / Math.max(0.7, cam.zoom), p.c);
          break;
      }
    }
    ctx.globalAlpha = 1;
  }
  function drawHeart(c, x, y, r) {
    c.beginPath();
    c.moveTo(x, y + r * 0.9);
    c.bezierCurveTo(x - r * 1.6, y - r * 0.2, x - r * 0.6, y - r * 1.4, x, y - r * 0.4);
    c.bezierCurveTo(x + r * 0.6, y - r * 1.4, x + r * 1.6, y - r * 0.2, x, y + r * 0.9);
    c.fillStyle = '#f43f5e'; c.fill(); c.strokeStyle = '#fff'; c.lineWidth = 1.2; c.stroke();
  }
  function outlined(c, text, x, y, size, fill) {
    c.font = `800 ${size}px ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineWidth = Math.max(2, size * 0.22); c.strokeStyle = 'rgba(40,25,10,0.9)'; c.lineJoin = 'round';
    c.strokeText(text, x, y);
    c.fillStyle = fill || '#fff'; c.fillText(text, x, y);
  }

  /* ---------------- Tag & Nacht ---------------- */
  function dayInfo() {
    let hour;
    if (Game.S && Game.S.settings.realTime) { const d = new Date(); hour = d.getHours() + d.getMinutes() / 60; }
    else hour = ((((Date.now() - ((Game.S && Game.S.dayStart) || 0)) / 1000 / CONFIG.dayNight.cycleSec) * 24 + 8) % 24 + 24) % 24;   // neues Spiel startet um 8 Uhr
    let k;
    if (hour >= 7 && hour < 19) k = 0;
    else if (hour >= 19 && hour < 21) k = (hour - 19) / 2;
    else if (hour >= 5 && hour < 7) k = 1 - (hour - 5) / 2;
    else k = 1;
    k = k * k * (3 - 2 * k);
    return { hour, dark: k, night: k > 0.5 };
  }
  const glowCache = {};
  function glow(kind) {
    if (glowCache[kind]) return glowCache[kind];
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const c = cv.getContext('2d');
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    const col = { fire: '255,150,60', pool: '80,220,255', lamp: '255,220,140', warm: '255,200,120' }[kind] || '255,200,120';
    g.addColorStop(0, `rgba(${col},0.95)`); g.addColorStop(0.35, `rgba(${col},0.45)`); g.addColorStop(1, `rgba(${col},0)`);
    c.fillStyle = g; c.fillRect(0, 0, 128, 128);
    glowCache[kind] = cv;
    return cv;
  }

  function drawNight(k, hideId) {
    const s = dpr;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    // Farbton: warm in der Dämmerung, blau in der Nacht
    let r, g, b;
    if (k < 0.5) { const u = k * 2; r = 255; g = 255 - 70 * u; b = 255 - 110 * u; }
    else { const u = (k - 0.5) * 2; r = 255 - 175 * u; g = 185 - 85 * u; b = 145 + 15 * u; }
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    worldTransform();
    for (const b of Game.S.buildings) {
      const d = BUILDINGS[b.type];
      if (!d.lights || b.level <= 0 || b.id === hideId) continue;
      const bw = P(b.gx, b.gy);
      if (bw[0] < view.x0 - 200 || bw[0] > view.x1 + 200 || bw[1] < view.y0 - 200 || bw[1] > view.y1 + 200) continue;
      for (const L of d.lights) {
        const kind = L[3] || 'warm';
        const p = P(b.gx + L[0], b.gy + L[1], L[4] != null ? L[4] : 12);
        let rad = L[2];
        let alpha = k * 0.85;
        if (kind === 'fire') { rad *= 1 + Math.sin(time * 9 + b.id) * 0.06 + Math.sin(time * 23) * 0.04; alpha = k; }
        ctx.globalAlpha = alpha;
        ctx.drawImage(glow(kind), p[0] - rad, p[1] - rad * 0.75, rad * 2, rad * 1.5);
      }
    }
    // Glühwürmchen
    if (fireflies.length < 24) for (let i = fireflies.length; i < 24; i++) fireflies.push({ x: Math.random(), y: Math.random(), ph: Math.random() * 6 });
    for (const f of fireflies) {
      const gx = view.x0 + f.x * (view.x1 - view.x0) + Math.sin(time * 0.7 + f.ph) * 20;
      const gy = view.y0 + f.y * (view.y1 - view.y0) + Math.cos(time * 0.5 + f.ph * 2) * 14;
      ctx.globalAlpha = k * (0.5 + 0.5 * Math.sin(time * 3 + f.ph * 5));
      ctx.drawImage(glow('lamp'), gx - 5, gy - 5, 10, 10);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------------- Wetter ---------------- */
  function drawWeather(dt) {
    const ev = Game.S.event;
    const weather = ev && ev.until > Date.now() ? ev.weather : null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (weather === 'rain' || weather === 'storm') {
      const storm = weather === 'storm';
      ctx.fillStyle = storm ? 'rgba(30,40,70,0.22)' : 'rgba(40,60,90,0.14)';
      ctx.fillRect(0, 0, W, H);
      const want = storm ? 220 : 140;
      while (rain.length < want) rain.push({ x: Math.random() * (W + 200) - 100, y: Math.random() * H, v: 500 + Math.random() * 300, l: 10 + Math.random() * 10 });
      ctx.beginPath();
      const wind = storm ? 0.45 : 0.18;
      for (const r of rain) {
        r.y += r.v * dt; r.x += r.v * wind * dt;
        if (r.y > H) { r.y = -20; r.x = Math.random() * (W + 200) - 200; }
        ctx.moveTo(r.x, r.y); ctx.lineTo(r.x - r.l * wind, r.y - r.l);
      }
      ctx.strokeStyle = 'rgba(210,225,255,0.55)'; ctx.lineWidth = 1.2; ctx.stroke();
      if (storm) {
        if (time > nextLightning) { flash = 1; nextLightning = time + 4 + Math.random() * 6; if (hooks.lightning) hooks.lightning(); }
        if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${flash * 0.55})`; ctx.fillRect(0, 0, W, H); flash -= dt * 3; }
      }
    } else rain.length = 0;
    if (weather === 'heat') {
      ctx.fillStyle = `rgba(255,150,50,${0.08 + Math.sin(time * 2) * 0.02})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (weather === 'festival') {
      while (confetti.length < 50) confetti.push({ x: Math.random() * W, y: Math.random() * H - H, v: 40 + Math.random() * 50, r: Math.random() * 6, c: ['#f43f5e', '#facc15', '#22c55e', '#3b82f6', '#a855f7'][(Math.random() * 5) | 0] });
      for (const p of confetti) {
        p.y += p.v * dt; p.x += Math.sin(time * 2 + p.r) * 20 * dt;
        if (p.y > H) { p.y = -10; p.x = Math.random() * W; }
        ctx.fillStyle = p.c;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(time * 3 + p.r); ctx.fillRect(-3, -1.5, 6, 3); ctx.restore();
      }
      if (Math.random() < dt * 2) {
        const rec = Game.S.buildings.find(b => b.type === 'reception');
        if (rec) { const q = P(rec.gx + 2, rec.gy + 2, 90); particles.push({ k: 'note', x: q[0] + (Math.random() - 0.5) * 40, y: q[1], vx: (Math.random() - 0.5) * 10, vy: -20, life: 0, max: 2.5, c: ['#7c3aed', '#db2777', '#2563eb'][(Math.random() * 3) | 0] }); }
      }
    } else confetti.length = 0;
  }
  function drawMosquitos() {
    const ev = Game.S.event;
    if (!(ev && ev.weather === 'mosquito' && ev.until > Date.now())) { mosquitos.length = 0; return; }
    if (!mosquitos.length) {
      const pts = Game.S.buildings.filter(b => BUILDINGS[b.type].cat === 'pitch' || b.type === 'lake');
      for (let i = 0; i < 70 && pts.length; i++) {
        const b = pts[i % pts.length];
        mosquitos.push({ b, ox: Math.random() * 2, oy: Math.random() * 2, ph: Math.random() * 10 });
      }
    }
    ctx.fillStyle = '#1f2937';
    for (const m of mosquitos) {
      const p = P(m.b.gx + m.ox + Math.sin(time * 3 + m.ph) * 0.4, m.b.gy + m.oy + Math.cos(time * 2.3 + m.ph) * 0.4, 20 + Math.sin(time * 5 + m.ph) * 8);
      ctx.fillRect(p[0] - 1, p[1] - 1, 2, 2);
      ctx.globalAlpha = 0.5;
      ctx.fillRect(p[0] - 2.5, p[1] - 2 + Math.sin(time * 60 + m.ph), 1.5, 1);
      ctx.fillRect(p[0] + 1, p[1] - 2 - Math.sin(time * 60 + m.ph), 1.5, 1);
      ctx.globalAlpha = 1;
    }
  }

  /* ---------------- Bildschirm-Overlays ---------------- */
  function drawCoinIcon(c, x, y, r, res) {
    if (res === 'wood') {
      c.save(); c.translate(x, y); c.rotate(-0.4);
      c.fillStyle = '#9a6436'; rr(c, -r, -r * 0.45, r * 2, r * 0.9, r * 0.4); c.fill();
      c.strokeStyle = '#5b3a1e'; c.lineWidth = 1.2; c.stroke();
      c.beginPath(); c.ellipse(r * 0.95, 0, r * 0.3, r * 0.45, 0, 0, 7); c.fillStyle = '#e7c08b'; c.fill(); c.stroke();
      c.restore();
      return;
    }
    if (res === 'stars') { starShape(c, x, y, r, '#facc15'); return; }
    if (res === 'gems') {
      c.beginPath(); c.moveTo(x, y - r); c.lineTo(x + r * 0.85, y - r * 0.2); c.lineTo(x, y + r); c.lineTo(x - r * 0.85, y - r * 0.2); c.closePath();
      c.fillStyle = '#22c55e'; c.fill(); c.strokeStyle = '#14532d'; c.lineWidth = 1.2; c.stroke();
      c.beginPath(); c.moveTo(x - r * 0.4, y - r * 0.35); c.lineTo(x, y - r * 0.75); c.lineTo(x + r * 0.2, y - r * 0.35); c.fillStyle = '#bbf7d0'; c.fill();
      return;
    }
    circle(c, x, y, r, '#fbbf24', '#a16207', 1.4);
    circle(c, x, y, r * 0.72, '#fcd34d');
    c.fillStyle = '#a16207'; c.font = `900 ${r * 1.15}px ui-rounded, system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('€', x, y + r * 0.06);
  }
  function starShape(c, x, y, r, fill) {
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, rad = i % 2 ? r * 0.45 : r;
      c.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
    }
    c.closePath(); c.fillStyle = fill; c.fill(); c.strokeStyle = '#a16207'; c.lineWidth = 1.2; c.stroke();
  }

  // Blasen schrumpfen beim Herauszoomen etwas, damit sie sich nicht stapeln
  const bubbleScale = () => Math.min(1, 0.5 + cam.zoom * 0.55);
  function bubblePos(b) {
    const d = BUILDINGS[b.type];
    const s = bubbleScale();
    const p = gridToScreen(b.gx + d.w / 2, b.gy + d.d / 2, d.height * 0.8);
    return { x: p.x, y: p.y - 22 * s + Math.sin(time * 3 + b.id) * 3 * s };
  }
  function fmtShort(s) {
    s = Math.ceil(s);
    if (s < 60) return s + ' s';
    if (s < 3600) return Math.floor(s / 60) + ' m ' + String(s % 60).padStart(2, '0') + ' s';
    if (s < 86400) return Math.floor(s / 3600) + ' h ' + String(Math.floor(s / 60) % 60).padStart(2, '0') + ' m';
    return Math.floor(s / 86400) + ' T ' + Math.floor(s / 3600) % 24 + ' h';
  }

  function drawOverlays(dt, v) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const now = Date.now();
    drawLandAndPickups();
    for (const b of Game.S.buildings) {
      const d = BUILDINGS[b.type];
      if (b.id === v.hideId) continue;
      const wp = P(b.gx + d.w / 2, b.gy + d.d / 2);
      if (wp[0] < view.x0 - 120 || wp[0] > view.x1 + 120 || wp[1] < view.y0 - 60 || wp[1] > view.y1 + 200) continue;
      if (b.build) {
        // Baustelle (Level 0): Balken höchstens auf Höhe des Baugerüsts, nicht über dem späteren Gebäude
        const site = ((d.w + d.d) / 2 - 0.7) * HH + 14 + d.w * 5;
        const p = gridToScreen(b.gx + d.w / 2, b.gy + d.d / 2, b.level <= 0 ? Math.min(d.height * 0.8, site) : d.height * 0.8);
        const total = b.build.end - b.build.start;
        const u = total > 0 ? Math.min(1, (now - b.build.start) / total) : 1;
        const bw = 70, bh = 11, x = p.x - bw / 2, y = p.y - 26;
        ctx.fillStyle = 'rgba(30,20,10,0.75)'; rr(ctx, x - 2, y - 2, bw + 4, bh + 4, 6); ctx.fill();
        ctx.fillStyle = '#4b5563'; rr(ctx, x, y, bw, bh, 4); ctx.fill();
        if (u > 0.02) { ctx.fillStyle = '#4ade80'; rr(ctx, x, y, bw * u, bh, 4); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(x + 2, y + 2, Math.max(0, bw * u - 4), 2); }
        outlined(ctx, fmtShort((b.build.end - now) / 1000), p.x, y - 9, 13, '#fff');
      } else if (Game.canCollect(b)) {
        const bp = bubblePos(b);
        const s = bubbleScale();
        const full = b.stored >= Game.storageOfBuilding(b) * 0.98;
        ctx.globalAlpha = 0.25; circle(ctx, bp.x, bp.y + 22 * s, 8 * s, '#000'); ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.moveTo(bp.x - 6 * s, bp.y + 12 * s); ctx.lineTo(bp.x, bp.y + 21 * s); ctx.lineTo(bp.x + 6 * s, bp.y + 12 * s); ctx.fillStyle = '#fff'; ctx.fill();
        circle(ctx, bp.x, bp.y, 18 * s, '#ffffff', full ? '#ef4444' : 'rgba(60,40,20,0.85)', full ? 3 : 2);
        drawCoinIcon(ctx, bp.x, bp.y, 11 * s, d.produces);
      }
    }
    // Gäste-Wünsche
    for (const g of Game.G.guests) {
      if (!g.wish && g.wishPopT <= 0) continue;
      const p = gridToScreen(g.x, g.y, 0);
      if (p.x < -40 || p.x > W + 40 || p.y < -40 || p.y > H + 60) continue;
      const hy = p.y - 30 * cam.zoom - 16;
      if (g.wishPopT > 0) {
        drawHeart(ctx, p.x, hy - (2 - g.wishPopT) * 10, 7);
        continue;
      }
      if (g.wishDone || g.state === 'leave' || g.state === 'arrive') continue;
      const cyc = (time + g.id * 1.7) % 9;
      if (cyc > 3.5) continue;
      const a = Math.min(1, cyc * 4, (3.5 - cyc) * 4);
      ctx.globalAlpha = a;
      ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(60,40,20,0.8)'; ctx.lineWidth = 1.5;
      rr(ctx, p.x - 19, hy - 22, 38, 32, 11); ctx.fill(); ctx.stroke();
      circle(ctx, p.x - 4, hy + 15, 3, '#fff', 'rgba(60,40,20,0.8)', 1);
      wishIcon(ctx, g.wish, p.x, hy - 6, 15);
      ctx.globalAlpha = 1;
    }
    // Hund markieren
    if (Game.G.dog) {
      const p = gridToScreen(Game.G.dog.x, Game.G.dog.y, 0);
      const y = p.y - 28 * cam.zoom - 14 + Math.sin(time * 6) * 3;
      circle(ctx, p.x, y, 10, '#facc15', 'rgba(60,40,20,0.9)', 2);
      outlined(ctx, '!', p.x, y + 1, 14, '#fff');
    }
    // fliegende Ressourcen & Texte
    for (let i = screenFx.length - 1; i >= 0; i--) {
      const f = screenFx[i];
      f.t += dt;
      if (f.t < f.delay) continue;
      const u = Math.min(1, (f.t - f.delay) / f.dur);
      const e = u * u * (3 - 2 * u);
      const cx = (f.x0 + f.x1) / 2 + f.bend, cy = Math.min(f.y0, f.y1) - 60;
      const x = (1 - e) * (1 - e) * f.x0 + 2 * (1 - e) * e * cx + e * e * f.x1;
      const y = (1 - e) * (1 - e) * f.y0 + 2 * (1 - e) * e * cy + e * e * f.y1;
      drawCoinIcon(ctx, x, y, 9 + Math.sin(u * Math.PI) * 3, f.res);
      if (u >= 1) { screenFx.splice(i, 1); if (f.cb) f.cb(); }
    }
  }
  function wishIcon(c, w, x, y, r) {
    if (w.b) {
      const t = thumbSprite(w.b);
      const s = (r * 2.2) / Math.max(t.w, t.h);
      c.drawImage(t.cv, x - t.w * s / 2, y - t.h * s / 2, t.w * s, t.h * s);
    } else if (w.deco) {
      const t = thumbSprite('tree');
      const s = (r * 2.2) / Math.max(t.w, t.h);
      c.drawImage(t.cv, x - t.w * s / 2, y - t.h * s / 2, t.w * s, t.h * s);
    } else if (w.need) {
      needIcon(c, w.need, x, y, r * 0.9);
    } else {
      circle(c, x, y, r * 0.8, '#facc15', '#a16207', 1.2);
      circle(c, x - r * 0.28, y - r * 0.2, 1.2, '#78350f'); circle(c, x + r * 0.28, y - r * 0.2, 1.2, '#78350f');
      c.beginPath(); c.arc(x, y + r * 0.05, r * 0.4, 0.2, Math.PI - 0.2); c.strokeStyle = '#78350f'; c.lineWidth = 1.2; c.stroke();
    }
  }
  // kleine Sprites in fester Auflösung (für Wunschblasen)
  const thumbCache = new Map();
  function thumbSprite(type) {
    if (thumbCache.has(type)) return thumbCache.get(type);
    const d = BUILDINGS[type];
    const bb = [-d.d * HW - 4, -(d.height + 14), d.w * HW + 4, (d.w + d.d) * HH + 4];
    const sc = 1.2;
    const cv = document.createElement('canvas');
    cv.width = Math.ceil((bb[2] - bb[0]) * sc); cv.height = Math.ceil((bb[3] - bb[1]) * sc);
    const c = cv.getContext('2d');
    c.setTransform(sc, 0, 0, sc, -bb[0] * sc, -bb[1] * sc);
    c.lineJoin = 'round'; c.lineCap = 'round';
    drawFn(type)(c, 1, type === 'fence' ? 3 : 0);
    const t = { cv, w: bb[2] - bb[0], h: bb[3] - bb[1] };
    thumbCache.set(type, t);
    return t;
  }

  /* ---------------- Hauptzeichnung ---------------- */
  function worldTransform() {
    const s = cam.zoom * dpr;
    ctx.setTransform(s, 0, 0, s, (W / 2 - cam.x * cam.zoom) * dpr, (H / 2 - cam.y * cam.zoom) * dpr);
  }
  function visible(wx, wy, sp) {
    return wx + sp.x0 + sp.w > view.x0 && wx + sp.x0 < view.x1 && wy + sp.y0 + sp.h > view.y0 && wy + sp.y0 < view.y1;
  }

  function frame(dt, v) {
    time += dt;
    const S = Game.S;
    if (forestRl !== Game.G.landVersion) buildForest();
    const bk = bucketFor(cam.zoom * dpr);
    if (bk !== bucket) { sprites.clear(); bucket = bk; }
    const tl = screenToWorld(0, 0), br = screenToWorld(W, H);
    view.x0 = tl.x; view.y0 = tl.y; view.x1 = br.x; view.y1 = br.y;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#2e6b2b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    worldTransform();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    drawGround();

    // flache Objekte (Wege) zuerst
    for (const b of S.buildings) {
      if (!BUILDINGS[b.type].flat || b.id === v.hideId) continue;
      const sp = spriteFor(b);
      const wp = P(b.gx, b.gy);
      if (visible(wp[0], wp[1], sp)) ctx.drawImage(sp.cv, wp[0] + sp.x0, wp[1] + sp.y0, sp.w, sp.h);
    }

    // Auswahl-Markierung am Boden
    const sel = v.selectedId ? Game.getBuilding(v.selectedId) : null;
    if (sel && sel.id !== v.hideId) {
      const d = BUILDINGS[sel.type];
      const pulse = 0.55 + Math.sin(time * 5) * 0.25;
      poly(ctx, [P(sel.gx, sel.gy), P(sel.gx + d.w, sel.gy), P(sel.gx + d.w, sel.gy + d.d), P(sel.gx, sel.gy + d.d)], `rgba(255,255,255,${pulse * 0.25})`, `rgba(255,255,255,${pulse})`, 2.5);
    }

    // Tiefensortierte Objekte
    drawList.length = 0;
    for (const b of S.buildings) {
      const d = BUILDINGS[b.type];
      if (d.flat || b.id === v.hideId) continue;
      b._d = b.gx + d.w / 2 + b.gy + d.d / 2;
      b._k = 0;
      const wp = P(b.gx, b.gy);
      const sp = spriteFor(b);
      if (visible(wp[0], wp[1], sp)) drawList.push(b);
    }
    for (const f of forest) {
      const wp = P(f.x, f.y);
      if (wp[0] > view.x0 - 40 && wp[0] < view.x1 + 40 && wp[1] > view.y0 - 10 && wp[1] < view.y1 + 110) drawList.push(f);
    }
    for (const g of Game.G.guests) { g._d = g.x + g.y; g._k = 2; drawList.push(g); }
    if (Game.G.dog) { Game.G.dog._d = Game.G.dog.x + Game.G.dog.y; Game.G.dog._k = 3; drawList.push(Game.G.dog); }
    gate._d = Game.roadX() + 0.5 + Game.gateTile().y + 1.2;
    drawList.push(gate);
    drawList.sort((p, q) => p._d - q._d);

    for (const o of drawList) {
      if (o._k === 0) {
        const sp = spriteFor(o);
        const wp = P(o.gx, o.gy);
        ctx.drawImage(sp.cv, wp[0] + sp.x0, wp[1] + sp.y0, sp.w, sp.h);
        if (o.id === v.selectedId) {
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.12 + Math.sin(time * 5) * 0.08;
          ctx.drawImage(sp.cv, wp[0] + sp.x0, wp[1] + sp.y0, sp.w, sp.h);
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
        }
        animBuilding(o, dt, wp[0], wp[1]);
        if (o.build && o.level > 0) {
          const d = BUILDINGS[o.type];
          const bb = boundsFor(d.w, d.d, d.height);
          const sc = sprite('scaf|' + d.w + '|' + d.d + '|' + d.height, bb[0], bb[1], bb[2], bb[3], c => drawScaffold(c, d.w, d.d, d.height));
          ctx.drawImage(sc.cv, wp[0] + sc.x0, wp[1] + sc.y0, sc.w, sc.h);
        }
        if (o.build) drawWorker(o, wp[0], wp[1]);
      } else if (o._k === 1) {
        const sp = sprite('pine|' + o.v, -40, -110, 40, 30, c => pine(c, 0, 0, 1, o.v));
        const wp = P(o.x, o.y);
        ctx.drawImage(sp.cv, wp[0] + sp.x0 * o.s, wp[1] + sp.y0 * o.s, sp.w * o.s, sp.h * o.s);
      } else if (o._k === 2) drawGuest(o);
      else if (o._k === 3) drawDog(o);
      else if (o._k === 4) {
        const sp = sprite('gate', -60, -70, 60, 50, drawGate);
        const wp = P(Game.roadX(), Game.gateTile().y + 1);
        ctx.drawImage(sp.cv, wp[0] + sp.x0, wp[1] + sp.y0, sp.w, sp.h);
      }
    }

    // Geist beim Platzieren/Verschieben
    if (v.ghost) {
      const gh = v.ghost;
      const d = BUILDINGS[gh.type];
      const fp = [P(gh.gx, gh.gy), P(gh.gx + d.w, gh.gy), P(gh.gx + d.w, gh.gy + d.d), P(gh.gx, gh.gy + d.d)];
      poly(ctx, fp, gh.valid ? 'rgba(74,222,128,0.45)' : 'rgba(248,113,113,0.5)', gh.valid ? '#16a34a' : '#dc2626', 2.5);
      const lvl = gh.level || 1;
      const sp = buildingSprite(gh.type, lvl, gh.type === 'fence' ? 0 : 0);
      const wp = P(gh.gx, gh.gy);
      ctx.globalAlpha = 0.88;
      ctx.drawImage(sp.cv, wp[0] + sp.x0, wp[1] + sp.y0 - 8, sp.w, sp.h);
      ctx.globalAlpha = 1;
      // Pfeile
      const arrows = [[d.w / 2, -0.55, 0, -1], [d.w + 0.55, d.d / 2, 1, 0], [d.w / 2, d.d + 0.55, 0, 1], [-0.55, d.d / 2, -1, 0]];
      for (const [ax, ay, dx, dy] of arrows) {
        const c0 = P(gh.gx + ax, gh.gy + ay);
        const tip = P(gh.gx + ax + dx * 0.35, gh.gy + ay + dy * 0.35);
        const side = P(gh.gx + ax - dy * 0.22, gh.gy + ay + dx * 0.22), side2 = P(gh.gx + ax + dy * 0.22, gh.gy + ay - dx * 0.22);
        poly(ctx, [tip, side, side2], '#ffffff', 'rgba(40,25,10,0.8)', 1.5);
        void c0;
      }
    }

    updateParticles(dt);
    drawMosquitos();

    const di = dayInfo();
    if (di.dark > 0.01) drawNight(di.dark, v.hideId);
    drawWeather(dt);
    drawOverlays(dt, v);
  }

  /* ---------------- Trefferprüfung ---------------- */
  function pointInPoly(x, y, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  // Pixelgenau: liegt unter dem Finger (im Umkreis von tol Bildschirmpixeln) ein deckender Pixel des Sprites?
  function spriteHit(b, sx, sy, tol) {
    const sp = spriteFor(b), w = screenToWorld(sx, sy), o = P(b.gx, b.gy);
    const k = sp.cv.width / sp.w;
    const px = Math.floor((w.x - o[0] - sp.x0) * k), py = Math.floor((w.y - o[1] - sp.y0) * k);
    if (px < 0 || py < 0 || px >= sp.cv.width || py >= sp.cv.height) return false;
    const r = Math.min(12, Math.round(tol / cam.zoom * k));
    const x0 = Math.max(0, px - r), y0 = Math.max(0, py - r);
    const x1 = Math.min(sp.cv.width, px + r + 1), y1 = Math.min(sp.cv.height, py + r + 1);
    const data = sp.cv.getContext('2d').getImageData(x0, y0, x1 - x0, y1 - y0).data;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 90) return true;
    return false;
  }
  function hitBuilding(sx, sy, filter) {
    // zuerst die sichtbare Grafik (vorderste zuerst, wie gezeichnet) …
    const drawn = Game.S.buildings.filter(b => !BUILDINGS[b.type].flat && (!filter || filter(b)))
      .sort((p, q) => (q.gx + q.gy + (BUILDINGS[q.type].w + BUILDINGS[q.type].d) / 2) - (p.gx + p.gy + (BUILDINGS[p.type].w + BUILDINGS[p.type].d) / 2));
    for (const tol of [0, 5]) for (const b of drawn) if (spriteHit(b, sx, sy, tol)) return b;
    // … sonst die grobe Box (Wege, knapp daneben getippt)
    const list = Game.S.buildings.slice().sort((p, q) => (q.gx + q.gy + BUILDINGS[q.type].w + BUILDINGS[q.type].d) - (p.gx + p.gy + BUILDINGS[p.type].w + BUILDINGS[p.type].d));
    for (const b of list) {
      const d = BUILDINGS[b.type];
      if (filter && !filter(b)) continue;
      const h = b.level <= 0 ? 24 : Math.min(d.height, 70) * 0.9;
      const pts = [
        gridToScreen(b.gx, b.gy + d.d, 0), gridToScreen(b.gx + d.w, b.gy + d.d, 0), gridToScreen(b.gx + d.w, b.gy, 0),
        gridToScreen(b.gx + d.w, b.gy, h), gridToScreen(b.gx, b.gy, h), gridToScreen(b.gx, b.gy + d.d, h),
      ];
      if (pointInPoly(sx, sy, pts)) return b;
    }
    return null;
  }
  function hitBubble(sx, sy) {
    let best = null, bd = Math.max(22, 30 * bubbleScale());
    for (const b of Game.S.buildings) {
      if (b.build || !Game.canCollect(b)) continue;
      const p = bubblePos(b);
      const dd = Math.hypot(p.x - sx, p.y - sy);
      if (dd < bd) { bd = dd; best = b; }
    }
    return best;
  }
  function hitGuest(sx, sy) {
    let best = null, bd = 1e9;
    const test = (e, isDog) => {
      const p = gridToScreen(e.x, e.y, 0);
      const top = p.y - 26 * cam.zoom;
      const cx = p.x, cy = (p.y + top) / 2;
      const dd = Math.hypot(sx - cx, (sy - cy) * 0.7);
      const rad = Math.max(24, 16 * cam.zoom) + (isDog ? 10 : 0);
      if (dd < rad && dd < bd) { bd = dd; best = isDog ? 'dog' : e; }
    };
    for (const g of Game.G.guests) if (g.state !== 'checkin') test(g, false);
    if (Game.G.dog) test(Game.G.dog, true);
    return best;
  }

  /* ---------------- Effekte ---------------- */
  function floatText(gx, gy, z, text, color) {
    const p = P(gx, gy, z);
    particles.push({ k: 'text', x: p[0], y: p[1], vx: 0, vy: -38, life: 0, max: 1.6, text, c: color || '#fff' });
  }
  function puff(gx, gy, w, d) {
    for (let i = 0; i < 14; i++) {
      const p = P(gx + Math.random() * w, gy + Math.random() * d, 2);
      particles.push({ k: 'dust', x: p[0], y: p[1], vx: (Math.random() - 0.5) * 40, vy: -10 - Math.random() * 20, life: 0, max: 0.8 + Math.random() * 0.5, r: 4 });
    }
  }
  function confettiAt(gx, gy, w, d, h) {
    const cols = ['#f43f5e', '#facc15', '#22c55e', '#3b82f6', '#a855f7', '#fb923c'];
    for (let i = 0; i < 40; i++) {
      const p = P(gx + w / 2, gy + d / 2, h || 40);
      particles.push({ k: 'confetti', x: p[0], y: p[1], vx: (Math.random() - 0.5) * 160, vy: -90 - Math.random() * 120, life: 0, max: 1.4 + Math.random() * 0.6, r: Math.random() * 6, c: cols[i % cols.length] });
    }
  }
  function hearts(gx, gy) {
    for (let i = 0; i < 3; i++) {
      const p = P(gx, gy, 26);
      particles.push({ k: 'heart', x: p[0] + (i - 1) * 8, y: p[1], vx: 0, vy: -26 - i * 6, life: -i * 0.15, max: 1.4 });
    }
  }
  function flyRes(gx, gy, z, res, count, cb) {
    const s = gridToScreen(gx, gy, z);
    const t = hudTargets[res];
    if (!t) { if (cb) cb(); return; }
    count = Math.max(1, Math.min(10, count));
    for (let i = 0; i < count; i++) {
      screenFx.push({ x0: s.x + (Math.random() - 0.5) * 30, y0: s.y + (Math.random() - 0.5) * 20, x1: t.x, y1: t.y, t: 0, delay: i * 0.05, dur: 0.65, res, bend: (Math.random() - 0.5) * 80, cb: i === count - 1 ? cb : null });
    }
  }

  /* ---------------- Vorschaubilder für Menüs ---------------- */
  function thumb(type, level, size) {
    const d = BUILDINGS[type];
    const pr = Math.min(2, window.devicePixelRatio || 1);
    const bb = [-d.d * HW - 6, -(d.height + 18), d.w * HW + 6, (d.w + d.d) * HH + 6];
    const bw = bb[2] - bb[0], bh = bb[3] - bb[1];
    const sc = Math.min(size / bw, size / bh, 1.4);
    const cv = document.createElement('canvas');
    cv.width = Math.round(size * pr); cv.height = Math.round(size * pr);
    cv.style.width = size + 'px'; cv.style.height = size + 'px';
    const c = cv.getContext('2d');
    c.setTransform(sc * pr, 0, 0, sc * pr, (size / 2 - (bb[0] + bw / 2) * sc) * pr, (size / 2 - (bb[1] + bh / 2) * sc) * pr);
    c.lineJoin = 'round'; c.lineCap = 'round';
    drawFn(type)(c, level || 1, type === 'fence' ? 3 : 0);
    return cv;
  }

  /* ---------------- Kamera ---------------- */
  function clampCam() {
    const minZ = Math.max(ZMIN, Math.min(W / (N * HW * 1.6), 1));
    cam.zoom = Math.min(ZMAX, Math.max(minZ, cam.zoom));
    // die ganze Karte bleibt erreichbar (Grundstücke zum Kaufen ansehen)
    const a = { x0: 0, y0: 0, x1: N, y1: N };
    const pad = 2;
    const xs = [P(a.x0 - pad, a.y1 + pad)[0], P(a.x1 + pad, a.y0 - pad)[0]];
    const ys = [P(a.x0 - pad, a.y0 - pad)[1], P(a.x1 + pad, a.y1 + pad)[1]];
    cam.x = Math.min(xs[1], Math.max(xs[0], cam.x));
    cam.y = Math.min(ys[1], Math.max(ys[0], cam.y));
  }
  function zoomAt(sx, sy, factor) {
    const before = screenToWorld(sx, sy);
    cam.zoom *= factor;
    clampCam();
    const after = screenToWorld(sx, sy);
    cam.x += before.x - after.x;
    cam.y += before.y - after.y;
    clampCam();
  }
  function pan(dx, dy) { cam.x -= dx / cam.zoom; cam.y -= dy / cam.zoom; clampCam(); }
  function centerOn(gx, gy) { const p = P(gx, gy); cam.x = p[0]; cam.y = p[1]; clampCam(); }

  function resize(force) {
    const hq = Game.S && Game.S.settings.hq;
    const nd = Math.min(window.devicePixelRatio || 1, hq ? 3 : 2);
    // iOS meldet beim Ein-/Ausblenden der Leisten oft Resize ohne echte Änderung
    if (!force && nd === dpr && window.innerWidth === W && window.innerHeight === H) return;
    dpr = nd;
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    sprites.clear(); bucket = 0;
    clampCam();
  }

  function init(cv) {
    canvas = cv;
    ctx = canvas.getContext('2d', { alpha: false });
    resize(true);
  }

  return {
    init, resize, frame, cam, clampCam, zoomAt, pan, centerOn,
    screenToGrid, gridToScreen, worldToScreen, screenToWorld,
    hitBuilding, hitBubble, hitGuest, hitPickup, hitParcel,
    floatText, puff, confetti: confettiAt, hearts, flyRes, thumb, dayInfo,
    setHudTarget(res, x, y) { hudTargets[res] = { x, y }; },
    hooks, get size() { return { W, H }; },
    needIcon,
    // Zeichen-Bausteine & Registrierung – fürs Grafik-Labor und Erweiterungen
    art: { P, HW, HH, OL, shade, hash, poly, quad, box, faceX, faceY, roofX, roofY, roofPyr, ellipseG, cylinder, cone, circle, line, rr, groundPatch, shadow, bush, pine, stageOf, needIcon },
    defineArt(type, draw, anim) {
      if (draw) DRAW[type] = draw;
      if (anim) ANIM[type] = anim;
      sprites.clear(); thumbCache.delete(type);
    },
  };
})();
