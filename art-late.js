/* art-late.js – Grafiken der späten Gebäude (Sternwarte, Baumhaus, Riesenrad, Wasserrutsche) und der Grundstücks-Funde.
 * Wird nach render.js geladen und meldet sich über Render.defineArt an. */
(() => {
  const { P, HW, HH, OL, shade, hash, poly, quad, box, faceX, faceY, roofX, roofY, roofPyr, ellipseG, cylinder, cone, circle, line, rr, groundPatch, shadow, bush, pine, stageOf, needIcon } = Render.art;
  const PI = Math.PI;

  // kleiner Vierzackstern
  const star4 = (c, x, y, r, col) => {
    c.beginPath();
    c.moveTo(x, y - r); c.quadraticCurveTo(x, y, x + r, y); c.quadraticCurveTo(x, y, x, y + r);
    c.quadraticCurveTo(x, y, x - r, y); c.quadraticCurveTo(x, y, x, y - r); c.closePath();
    c.fillStyle = col; c.fill();
  };
  // Laterne an einem Pfahl
  const lampPost = (c, x, y, h, col) => {
    const b0 = P(x, y, 0), t0 = P(x, y, h);
    line(c, b0, t0, '#334155', 2);
    c.fillStyle = col || '#fde68a'; rr(c, t0[0] - 2.6, t0[1] - 5.5, 5.2, 6, 1.4); c.fill(); c.strokeStyle = '#1f2937'; c.lineWidth = 1.1; c.stroke();
    poly(c, [[t0[0] - 4, t0[1] - 5.5], [t0[0] + 4, t0[1] - 5.5], [t0[0], t0[1] - 9]], '#1f2937');
  };
  // Bank (entlang x)
  const benchX = (c, x0, x1, y, col) => {
    for (const x of [x0 + 0.08, x1 - 0.08]) { line(c, P(x, y, 0), P(x, y, 5), '#57534e', 1.4); line(c, P(x, y + 0.14, 0), P(x, y + 0.14, 5), '#57534e', 1.4); }
    box(c, x0, y - 0.05, x1, y, 6, 6, shade(col, -0.1));
    box(c, x0, y, x1, y + 0.18, 5, 2, col);
  };

  /* ---------- Sternwarte: gemeinsame Geometrie für DRAW und ANIM ---------- */
  const OBS = { cx: 1.35, cy: 1.35, r: 0.82, h: 42 };
  const obsGeo = () => {
    const p = P(OBS.cx, OBS.cy, OBS.h);
    const rx = OBS.r * HW * 1.414 + 2, ry = OBS.r * HH * 1.414 + 1, hd = 30;
    // Punkt auf der Kuppel: Azimut f (0 = rechts, PI/2 = vorne), Höhe e
    const D = (f, e) => [p[0] + rx * Math.cos(e) * Math.cos(f), p[1] + ry * Math.cos(e) * Math.sin(f) - hd * Math.sin(e)];
    const f1 = 0.98, f2 = 1.3;
    const slit = [];
    for (let i = 0; i <= 6; i++) slit.push(D(f1, i / 6 * 1.42));
    for (let i = 6; i >= 0; i--) slit.push(D(f2, i / 6 * 1.42));
    const tb = D((f1 + f2) / 2, 0.62);                   // Fernrohr-Austritt
    const tip = [tb[0] + 17, tb[1] - 15];
    return { p, rx, ry, hd, D, slit, tb, tip };
  };

  /* ---------- Riesenrad ---------- */
  const FW = { zc: 60, R: 44 };
  const wheelColors = [
    ['#ef4444', '#3b82f6', '#facc15', '#22c55e', '#f97316', '#a855f7'],
    ['#ef4444', '#f97316', '#facc15', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7', '#ec4899'],
    ['#e11d48', '#f59e0b', '#fde047', '#10b981', '#0ea5e9', '#6366f1', '#a855f7', '#ec4899', '#f97316', '#14b8a6'],
  ];
  // drehender Teil: Speichen, Gondeln (Kranz ist statisch und rotationssymmetrisch)
  const wheelSpin = (c, L, ang, night) => {
    const st = stageOf(L), n = [6, 8, 10][st];
    const hub = P(1.5, 1.5, FW.zc), R = FW.R;
    const steel = ['#e5e7eb', '#f8fafc', '#fde68a'][st];
    // Speichen (ein Pfad)
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const a = ang + i * 2 * PI / n;
      c.moveTo(hub[0], hub[1]); c.lineTo(hub[0] + Math.cos(a) * R, hub[1] + Math.sin(a) * R);
      const a2 = a + PI / n;
      c.moveTo(hub[0] + Math.cos(a) * R, hub[1] + Math.sin(a) * R); c.lineTo(hub[0] + Math.cos(a2) * R * 0.62, hub[1] + Math.sin(a2) * R * 0.62);
    }
    c.strokeStyle = OL; c.lineWidth = 2.4; c.stroke();
    c.strokeStyle = steel; c.lineWidth = 1.2; c.stroke();
    // Gondeln hängen immer senkrecht
    const cols = wheelColors[st];
    for (let i = 0; i < n; i++) {
      const a = ang + i * 2 * PI / n;
      const x = hub[0] + Math.cos(a) * R, y = hub[1] + Math.sin(a) * R;
      c.fillStyle = cols[i % cols.length];
      rr(c, x - 4.5, y + 1.5, 9, 8, 2.5); c.fill(); c.strokeStyle = OL; c.lineWidth = 1; c.stroke();
      c.fillStyle = night > 0.05 ? '#fde68a' : 'rgba(255,255,255,0.75)'; c.fillRect(x - 3, y + 3.2, 6, 2.4);
    }
    // Nabe
    circle(c, hub[0], hub[1], 4.2, st === 2 ? '#f59e0b' : '#94a3b8', OL, 1.1);
    if (night > 0.05) { // Lichterkette auf dem Kranz
      c.globalAlpha = Math.min(1, night * 1.3);
      const nb = 16;
      for (let k = 0; k < 2; k++) {
        c.beginPath();
        for (let i = k; i < nb; i += 2) {
          const a = -ang * 0.5 + i * 2 * PI / nb, r = R + 2;
          const x = hub[0] + Math.cos(a) * r, y = hub[1] + Math.sin(a) * r;
          c.moveTo(x + 2.4, y); c.arc(x, y, 2.4, 0, 2 * PI);
        }
        c.fillStyle = k ? (st === 2 ? '#fde047' : '#f472b6') : '#fff7d6'; c.fill();
      }
      c.globalAlpha = 1;
    }
  };

  /* ---------- Wasserrutsche: Bahn als Catmull-Rom-Kurve ---------- */
  const crs = (pts, seg) => {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      for (let s = 0; s < seg; s++) {
        const t = s / seg, t2 = t * t, t3 = t2 * t;
        const f = k => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
        out.push([f(0), f(1), f(2)]);
      }
    }
    out.push(pts[pts.length - 1].slice());
    return out;
  };
  const SLIDE_A = crs([[1.25, 0.95, 64], [2.3, 0.75, 58], [3.4, 0.95, 50], [3.45, 1.75, 42], [2.6, 2.0, 34], [1.4, 1.75, 26], [1.05, 2.5, 18], [1.6, 3.05, 10], [2.2, 3.0, 3], [2.5, 2.85, 0]], 8);
  const SLIDE_B = crs([[0.95, 1.25, 64], [0.85, 2.0, 46], [1.15, 2.55, 30], [1.75, 2.45, 14], [2.15, 2.25, 3], [2.4, 2.2, 0]], 8);
  const tube = (c, pts, col) => {
    const sp = pts.map(q => P(q[0], q[1], q[2]));
    const path = () => { c.beginPath(); c.moveTo(sp[0][0], sp[0][1]); for (let i = 1; i < sp.length; i++) c.lineTo(sp[i][0], sp[i][1]); };
    path(); c.strokeStyle = OL; c.lineWidth = 8.5; c.stroke();
    c.strokeStyle = col; c.lineWidth = 6.5; c.stroke();
    c.strokeStyle = shade(col, -0.3); c.lineWidth = 2.2;
    c.beginPath(); c.moveTo(sp[0][0], sp[0][1] + 2); for (let i = 1; i < sp.length; i++) c.lineTo(sp[i][0], sp[i][1] + 2); c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.65)'; c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(sp[0][0], sp[0][1] - 2); for (let i = 1; i < sp.length; i++) c.lineTo(sp[i][0], sp[i][1] - 2); c.stroke();
  };
  const WPOOL = { x0: 1.75, y0: 1.95, x1: 3.75, y1: 3.75 };

  /* ---------- Baumhaus: Fenster für Nachtlicht ---------- */
  const TH = { x0: 0.85, y0: 0.95, x1: 1.95, y1: 2.0, z: 40, h: 18 };

  const DRAW_NEW = {
    // Sternwarte (3×3)
    observatory(c, L) {
      const st = stageOf(L);
      const wall = ['#b8b1a3', '#f4f1ea', '#f8f6f0'][st];
      const pave = ['#cfc8b8', '#d9d4c8', '#cfd6e6'][st];
      shadow(c, 0.2, 0.2, 2.9, 2.9, 0.15);
      groundPatch(c, 0.08, 0.08, 2.92, 2.92, '#9fcf78', '#86b95f');
      // Rundes Pflaster um den Turm
      ellipseG(c, OBS.cx + 0.1, OBS.cy + 0.1, 1.25, 0, pave, shade(pave, -0.25), 1.3);
      c.globalAlpha = 0.35;
      ellipseG(c, OBS.cx + 0.1, OBS.cy + 0.1, 1.05, 0, null, shade(pave, -0.35), 0.9);
      c.globalAlpha = 1;
      // Weg nach vorne
      poly(c, [P(1.15, 2.05), P(1.55, 2.05), P(1.6, 2.92), P(1.1, 2.92)], pave, shade(pave, -0.25), 1.1);
      if (L >= 9) { bush(c, ...P(0.3, 0.45), 0.5, '#3f9a35'); bush(c, ...P(2.55, 0.3), 0.5); }
      // Turm
      const g = obsGeo();
      const b0 = P(OBS.cx, OBS.cy, 0), rx0 = OBS.r * HW * 1.414, ry0 = OBS.r * HH * 1.414;
      cylinder(c, OBS.cx, OBS.cy, OBS.r, 0, OBS.h, wall);
      // Steinfugen / Bänder
      c.save();
      c.beginPath(); c.moveTo(b0[0] - rx0, b0[1] - OBS.h); c.lineTo(b0[0] - rx0, b0[1]); c.ellipse(b0[0], b0[1], rx0, ry0, 0, PI, 0, true); c.lineTo(b0[0] + rx0, b0[1] - OBS.h); c.closePath(); c.clip();
      const sh = c.createLinearGradient(b0[0] - rx0, 0, b0[0] + rx0, 0);
      sh.addColorStop(0, 'rgba(255,255,255,0.25)'); sh.addColorStop(0.4, 'rgba(255,255,255,0)'); sh.addColorStop(1, 'rgba(40,30,20,0.28)');
      c.fillStyle = sh; c.fillRect(b0[0] - rx0, b0[1] - OBS.h - ry0, rx0 * 2, OBS.h + ry0 * 2);
      if (st === 0) {
        c.globalAlpha = 0.4; c.strokeStyle = shade(wall, -0.45); c.lineWidth = 0.8;
        for (let z = 6, r = 0; z < OBS.h; z += 6, r++) {
          c.beginPath(); c.ellipse(b0[0], b0[1] - z, rx0, ry0, 0, 0, PI); c.stroke();
          for (let k = 0; k < 7; k++) {
            const a = (k + 0.5 + (r % 2) * 0.5) / 7 * PI;
            const x = b0[0] + rx0 * Math.cos(a), y = b0[1] - z + ry0 * Math.sin(a);
            c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + 6); c.stroke();
          }
        }
        c.globalAlpha = 1;
      } else {
        const band = st === 2 ? '#1e3a8a' : '#cbd5e1';
        for (const z of st === 2 ? [4, 34] : [4]) {
          c.beginPath(); c.ellipse(b0[0], b0[1] - z, rx0, ry0, 0, 0, PI); c.ellipse(b0[0], b0[1] - z - 4, rx0, ry0, 0, PI, 0, true); c.closePath();
          c.fillStyle = band; c.fill();
        }
        if (st === 2) for (let k = 0; k < 6; k++) { const a = (k + 0.5) / 6 * PI; star4(c, b0[0] + rx0 * Math.cos(a), b0[1] - 36 + ry0 * Math.sin(a), 2.2, '#fbbf24'); }
      }
      c.restore();
      // Fenster (Rundbogen)
      const win = (a, z, w, h) => {
        const x = b0[0] + rx0 * Math.cos(a), y = b0[1] - z + ry0 * Math.sin(a);
        c.beginPath(); c.moveTo(x - w, y); c.lineTo(x - w, y - h); c.arc(x, y - h, w, PI, 0); c.lineTo(x + w, y); c.closePath();
        c.fillStyle = '#334155'; c.fill(); c.strokeStyle = st === 2 ? '#f59e0b' : OL; c.lineWidth = 1; c.stroke();
        c.fillStyle = 'rgba(147,197,253,0.6)'; c.fillRect(x - w + 1, y - h, w - 1, 3);
      };
      win(0.35, 24, 2.6, 5); win(2.5, 24, 2.6, 5);
      // Tür vorne links mit kleiner Treppe
      const da = 1.95, dx = b0[0] + rx0 * Math.cos(da), dy = b0[1] + ry0 * Math.sin(da);
      c.beginPath(); c.moveTo(dx - 5, dy); c.lineTo(dx - 5, dy - 12); c.arc(dx, dy - 12, 5, PI, 0); c.lineTo(dx + 5, dy); c.closePath();
      c.fillStyle = ['#7a4a21', '#1e40af', '#1e3a8a'][st]; c.fill(); c.strokeStyle = OL; c.lineWidth = 1.1; c.stroke();
      circle(c, dx + 2.5, dy - 7, 0.9, '#fbbf24');
      const stc = ['#a8a29e', '#d6d3d1', '#cbd5e1'][st];
      box(c, 1.0, 2.1, 1.5, 2.36, 0, 2.5, stc);
      box(c, 1.03, 2.1, 1.47, 2.24, 2.5, 2.5, stc);
      // Kuppel
      const p = g.p;
      c.beginPath();
      c.ellipse(p[0], p[1], g.rx, g.hd, 0, PI, 2 * PI);
      c.ellipse(p[0], p[1], g.rx, g.ry, 0, 0, PI);
      c.closePath();
      const dome = ['#9ca3af', '#d1d5db', '#1e3a8a'][st];
      const gr = c.createLinearGradient(p[0] - g.rx, 0, p[0] + g.rx, 0);
      gr.addColorStop(0, shade(dome, 0.35)); gr.addColorStop(0.4, shade(dome, 0.12)); gr.addColorStop(1, shade(dome, -0.35));
      c.fillStyle = gr; c.fill(); c.strokeStyle = OL; c.lineWidth = 1.3; c.stroke();
      // Kuppelrippen
      c.globalAlpha = st === 2 ? 0.9 : 0.35;
      c.strokeStyle = st === 2 ? '#fbbf24' : shade(dome, -0.45); c.lineWidth = st === 2 ? 1 : 0.8;
      for (const f of [0.35, 1.9, 2.55, 3.0]) {
        c.beginPath();
        for (let i = 0; i <= 8; i++) { const q = g.D(f, i / 8 * 1.5); if (i) c.lineTo(q[0], q[1]); else c.moveTo(q[0], q[1]); }
        c.stroke();
      }
      c.globalAlpha = 1;
      // Kuppelkranz
      c.beginPath(); c.ellipse(p[0], p[1], g.rx, g.ry, 0, 0, PI); c.strokeStyle = st === 2 ? '#f59e0b' : shade(dome, -0.4); c.lineWidth = 2.2; c.stroke();
      // Spalt
      poly(c, g.slit, '#0f172a', OL, 1);
      // Fernrohr
      const tb = g.tb, tip = g.tip;
      const tcol = ['#57534e', '#e5e7eb', '#f59e0b'][st];
      line(c, [tb[0] - 4, tb[1] + 4], tip, OL, 6.4);
      line(c, [tb[0] - 4, tb[1] + 4], tip, tcol, 4.4);
      line(c, [tb[0] - 2, tb[1] + 1], [tip[0] - 1, tip[1] - 1], 'rgba(255,255,255,0.5)', 1);
      c.beginPath(); c.ellipse(tip[0], tip[1], 2.6, 3.4, 0.85, 0, 2 * PI); c.fillStyle = '#1e293b'; c.fill(); c.strokeStyle = OL; c.lineWidth = 1; c.stroke();
      line(c, [tb[0] + 3.5, tb[1] - 6], [tb[0] + 6, tb[1] - 4], st === 2 ? '#1e3a8a' : '#374151', 2.4);
      // Spitze
      const top = g.D(0, PI / 2);
      if (st === 2) { line(c, top, [top[0], top[1] - 6], '#b45309', 1.4); star4(c, top[0], top[1] - 8, 4, '#fbbf24'); }
      else circle(c, top[0], top[1] - 1.5, 2, shade(dome, -0.2), OL, 1);
      // Terrasse mit zweitem Fernrohr
      if (L >= 7) {
        box(c, 2.15, 1.75, 2.85, 2.6, 0, 4, '#a0703f', { top: '#c08a55' });
        c.globalAlpha = 0.3;
        for (let x = 2.25; x < 2.85; x += 0.12) line(c, P(x, 1.75, 4), P(x, 2.6, 4), '#5b3a1e', 0.8);
        c.globalAlpha = 1;
        const tp = P(2.5, 2.15, 4);
        line(c, tp, [tp[0] - 4, tp[1] - 12 + 12], '#374151', 1.2);
        line(c, [tp[0], tp[1] - 12], [tp[0] - 5, tp[1]], '#374151', 1.2);
        line(c, [tp[0], tp[1] - 12], [tp[0] + 5, tp[1]], '#374151', 1.2);
        line(c, [tp[0], tp[1] - 12], [tp[0], tp[1] + 1.5], '#374151', 1.2);
        line(c, [tp[0] - 6, tp[1] - 9], [tp[0] + 7, tp[1] - 17], OL, 4.6);
        line(c, [tp[0] - 6, tp[1] - 9], [tp[0] + 7, tp[1] - 17], '#f8fafc', 3);
        circle(c, tp[0] + 7, tp[1] - 17, 1.6, '#1e293b');
        // Geländer vorne
        for (const y of [1.85, 2.2, 2.5]) line(c, P(2.85, y, 4), P(2.85, y, 10), '#7a4a21', 1.2);
        line(c, P(2.85, 1.78, 10), P(2.85, 2.58, 10), '#7a4a21', 1.5);
      }
      // Bank rechts
      if (L >= 3) benchX(c, 2.2, 2.85, 0.45, st === 2 ? '#1e3a8a' : '#b07a45');
      // Sternkarte
      if (L >= 5) {
        for (const x of [0.32, 0.88]) line(c, P(x, 2.55, 0), P(x, 2.55, 12), '#57534e', 1.5);
        box(c, 0.25, 2.5, 0.95, 2.56, 10, 15, '#7a4a21');
        faceY(c, 2.56, 0.3, 0.9, 11.5, 23.5, '#1e293b', OL);
        const sx = [0.38, 0.5, 0.6, 0.72, 0.8, 0.46, 0.66];
        const sz = [14, 19, 16, 20, 14.5, 22, 22];
        c.strokeStyle = 'rgba(253,230,138,0.7)'; c.lineWidth = 0.6;
        c.beginPath();
        for (let i = 0; i < 5; i++) { const q = P(sx[i], 2.56, sz[i]); if (i) c.lineTo(q[0], q[1]); else c.moveTo(q[0], q[1]); }
        c.stroke();
        for (let i = 0; i < sx.length; i++) { const q = P(sx[i], 2.56, sz[i]); circle(c, q[0], q[1], i < 5 ? 1 : 0.7, '#fde68a'); }
      }
      if (L >= 9) lampPost(c, 0.25, 1.7, 22);
      if (L >= 10) { bush(c, ...P(0.3, 1.6), 0.45, '#f472b6'); bush(c, ...P(2.75, 2.8), 0.4, '#a78bfa'); }
    },

    // Riesenrad (3×3)
    ferris(c, L) {
      const st = stageOf(L);
      const pave = ['#d6cdb8', '#dcd4c4', '#e7c9a0'][st];
      const steel = ['#dc2626', '#f8fafc', '#f8fafc'][st];
      const steelD = ['#991b1b', '#94a3b8', '#b45309'][st];
      shadow(c, 0.2, 0.2, 2.9, 2.9, 0.15);
      groundPatch(c, 0.08, 0.08, 2.92, 2.92, pave);
      if (st > 0) {
        c.globalAlpha = 0.35;
        for (let v = 0.48; v < 2.9; v += 0.4) { line(c, P(v, 0.08), P(v, 2.92), shade(pave, -0.3), 0.8); line(c, P(0.08, v), P(2.92, v), shade(pave, -0.3), 0.8); }
        c.globalAlpha = 1;
      }
      // Fundamente
      for (const [x, y] of [[2.2, 0.3], [0.3, 2.2], [2.7, 0.8], [0.8, 2.7]]) box(c, x - 0.1, y - 0.1, x + 0.1, y + 0.1, 0, 3, '#a8a29e');
      // hinteres A-Gestell
      const aFrame = (k) => {
        const h = P(1.5 + k, 1.5 + k, FW.zc), fa = P(1.5 + k + 0.95, 1.5 + k - 0.95, 3), fb = P(1.5 + k - 0.95, 1.5 + k + 0.95, 3);
        for (const f of [fa, fb]) { line(c, f, h, OL, 5); line(c, f, h, steel, 3.2); }
        const m1 = [(fa[0] * 0.6 + h[0] * 0.4), (fa[1] * 0.6 + h[1] * 0.4)], m2 = [(fb[0] * 0.6 + h[0] * 0.4), (fb[1] * 0.6 + h[1] * 0.4)];
        line(c, m1, m2, OL, 3); line(c, m1, m2, steelD, 1.6);
      };
      aFrame(-0.25);
      // Achse
      line(c, P(1.25, 1.25, FW.zc), P(1.75, 1.75, FW.zc), OL, 4.5);
      line(c, P(1.25, 1.25, FW.zc), P(1.75, 1.75, FW.zc), '#64748b', 3);
      // Einstiegspodest
      box(c, 1.1, 1.1, 1.95, 1.95, 0, 5, st === 2 ? '#7c2d12' : '#9a6436', { top: st === 2 ? '#b45309' : '#c08850' });
      box(c, 1.95, 1.35, 2.25, 1.75, 0, 2.5, '#a8a29e');
      // Kranz (rotationssymmetrisch -> statisch)
      const hub = P(1.5, 1.5, FW.zc), R = FW.R;
      const rim = ['#dc2626', '#2563eb', '#f59e0b'][st];
      c.beginPath(); c.arc(hub[0], hub[1], R, 0, 2 * PI); c.strokeStyle = OL; c.lineWidth = 4.6; c.stroke();
      c.strokeStyle = rim; c.lineWidth = 3; c.stroke();
      c.beginPath(); c.arc(hub[0], hub[1], R * 0.62, 0, 2 * PI); c.strokeStyle = OL; c.lineWidth = 2.6; c.stroke();
      c.strokeStyle = shade(rim, 0.25); c.lineWidth = 1.3; c.stroke();
      if (st === 2) for (let i = 0; i < 20; i++) { const a = i / 20 * 2 * PI; circle(c, hub[0] + Math.cos(a) * R, hub[1] + Math.sin(a) * R, 1, '#fff7d6'); }
      // Vorschaubild (Menü) hat keine Animation: Speichen & Gondeln mitzeichnen
      if (c.canvas && c.canvas.style && c.canvas.style.width) wheelSpin(c, L, 0.2, 0);
      // vorderes A-Gestell
      aFrame(0.25);
      // Wartegitter und Weg
      poly(c, [P(2.05, 2.05), P(2.45, 2.05), P(2.92, 2.6), P(2.92, 2.92), P(2.6, 2.92), P(2.05, 2.45)], shade(pave, -0.08));
      const rope = st === 2 ? '#b91c1c' : '#dc2626', post = st === 2 ? '#f59e0b' : '#94a3b8';
      for (const [ax, ay, bx, by] of [[2.0, 1.95, 2.85, 2.5], [1.95, 2.05, 2.5, 2.85]]) {
        const pa = P(ax, ay, 7), pb = P(bx, by, 7), m = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2 + 4];
        c.beginPath(); c.moveTo(pa[0], pa[1]); c.quadraticCurveTo(m[0], m[1], pb[0], pb[1]); c.strokeStyle = rope; c.lineWidth = 1.6; c.stroke();
        for (const [x, y] of [[ax, ay], [bx, by]]) { line(c, P(x, y, 0), P(x, y, 8), OL, 2.8); line(c, P(x, y, 0), P(x, y, 8), post, 1.6); circle(c, ...P(x, y, 8.5), 1.4, post, OL, 0.6); }
      }
      // Kassenhäuschen vorne links
      const bx0 = 0.35, bx1 = 0.95, by0 = 2.1, by1 = 2.7;
      const bw = ['#fef3c7', '#e0f2fe', '#fdf2f8'][st];
      box(c, bx0, by0, bx1, by1, 0, 18, bw);
      faceY(c, by1, bx0 + 0.15, bx1 - 0.15, 7, 14, '#334155', OL);
      faceY(c, by1, bx0 + 0.1, bx1 - 0.1, 6, 7, '#a16207', OL);
      faceX(c, bx1, by0 + 0.15, by1 - 0.15, 0, 12, st === 2 ? '#be123c' : '#7a4a21', OL);
      roofPyr(c, bx0, by0, bx1, by1, 18, 10, ['#dc2626', '#2563eb', '#be123c'][st], 0.08);
      if (st > 0) { // Streifen
        const A = P((bx0 + bx1) / 2, (by0 + by1) / 2, 28);
        for (let i = 1; i < 4; i += 2) {
          const u0 = i / 4, u1 = (i + 1) / 4;
          poly(c, [A, P(bx0 - 0.08 + (bx1 - bx0 + 0.16) * u0, by1 + 0.08, 18), P(bx0 - 0.08 + (bx1 - bx0 + 0.16) * u1, by1 + 0.08, 18)], 'rgba(255,255,255,0.85)');
        }
      }
      const sg = P(0.65, by1 + 0.01, 16);
      c.fillStyle = '#facc15'; rr(c, sg[0] - 8, sg[1] - 3, 16, 5, 1.5); c.fill(); c.strokeStyle = OL; c.lineWidth = 0.8; c.stroke();
      if (L >= 3) { // Wimpel an der Kasse
        const t = P(bx1 + 0.04, by1 + 0.04, 26);
        line(c, P(bx1 + 0.04, by1 + 0.04, 18), t, '#57534e', 1.1);
        poly(c, [t, [t[0] + 8, t[1] + 2], [t[0], t[1] + 4]], st === 2 ? '#f59e0b' : '#ef4444');
      }
      if (L >= 5) { lampPost(c, 2.85, 1.85, 24); lampPost(c, 1.85, 2.85, 24); }
      if (L >= 9) { bush(c, ...P(0.3, 0.4), 0.5); bush(c, ...P(2.75, 2.75), 0.4, '#f472b6'); }
      if (L >= 10) { // goldene Krone über der Nabe
        const t = P(1.5, 1.5, FW.zc + FW.R + 4);
        star4(c, t[0], t[1] - 2, 5, '#fbbf24');
      }
    },

    // Wasserrutsche (4×4)
    waterslide(c, L) {
      const st = stageOf(L);
      const deck = ['#e7dcc4', '#e5e7eb', '#f1f5f9'][st];
      shadow(c, 0.2, 0.2, 3.9, 3.9, 0.15);
      groundPatch(c, 0.08, 0.08, 3.92, 3.92, deck);
      c.globalAlpha = 0.3;
      for (let v = 0.48; v < 3.9; v += 0.4) { line(c, P(v, 0.08), P(v, 3.92), shade(deck, -0.35), 0.8); line(c, P(0.08, v), P(3.92, v), shade(deck, -0.35), 0.8); }
      c.globalAlpha = 1;
      // Becken
      const { x0, y0, x1, y1 } = WPOOL;
      quad(c, x0 - 0.08, y0 - 0.08, x1 + 0.08, y1 + 0.08, 0, '#f8fafc', OL, 1.3);
      poly(c, [P(x0, y0, 0), P(x1, y0, 0), P(x1, y0, -6), P(x0 + 0.1, y0, -6)], '#7dd3c0');
      poly(c, [P(x0, y0, 0), P(x0, y1, 0), P(x0, y1, -6), P(x0, y0 + 0.1, -6)], '#5fbfae');
      quad(c, x0, y0 + 0.02, x1, y1, -6, null);
      poly(c, [P(x0 + 0.1, y0, -6), P(x1, y0, -6), P(x1, y1, -6), P(x0, y1, -6), P(x0, y0 + 0.1, -6)], ['#2dd4bf', '#22d3ee', '#38bdf8'][st]);
      c.globalAlpha = 0.35;
      for (let i = 0; i < 6; i++) { const q = P(x0 + 0.3 + hash(i, 1, 51) * 1.4, y0 + 0.3 + hash(i, 2, 51) * 1.4, -6); line(c, [q[0] - 6, q[1]], [q[0] + 6, q[1]], '#ffffff', 1.1); }
      c.globalAlpha = 1;
      quad(c, x0, y0, x1, y1, 0, null, OL, 1);
      // Leiter
      for (const x of [3.3, 3.45]) { const a = P(x, y1, 4), b = P(x, y1 - 0.2, -4); line(c, a, b, '#cbd5e1', 1.4); }
      // Turm
      const wood = st === 0 ? '#a0703f' : st === 1 ? '#475569' : '#1e3a8a';
      const tx0 = 0.4, tx1 = 1.3, ty0 = 0.4, ty1 = 1.3, tz = 64;
      for (const [x, y] of [[tx0, ty0], [tx1, ty0], [tx0, ty1]]) { line(c, P(x, y, 0), P(x, y, tz), OL, 4.4); line(c, P(x, y, 0), P(x, y, tz), wood, 2.8); }
      // Treppe (Zickzack auf der rechten Seite)
      const stair = st === 0 ? '#c08850' : st === 1 ? '#f59e0b' : '#e2e8f0';
      for (let k = 0; k < 3; k++) {
        const za = k * 21, zb = za + 21;
        const ya = k % 2 ? ty1 - 0.08 : ty0 + 0.08, yb = k % 2 ? ty0 + 0.08 : ty1 - 0.08;
        line(c, P(tx1 + 0.06, ya, za), P(tx1 + 0.06, yb, zb), OL, 4); line(c, P(tx1 + 0.06, ya, za), P(tx1 + 0.06, yb, zb), stair, 2.4);
        box(c, tx0, ty0, tx1, ty1, zb - 2, 2, shade(wood, 0.35), { noTop: k < 2 });
      }
      // Kreuzstreben
      c.globalAlpha = 0.8;
      for (let k = 0; k < 3; k++) { const za = k * 21, zb = za + 21; line(c, P(tx0, ty1, za), P(tx1, ty1, zb), wood, 1.3); line(c, P(tx1, ty1, za), P(tx0, ty1, zb), wood, 1.3); }
      c.globalAlpha = 1;
      for (const [x, y] of [[tx1, ty1]]) { line(c, P(x, y, 0), P(x, y, tz), OL, 4.4); line(c, P(x, y, 0), P(x, y, tz), wood, 2.8); }
      // Geländer oben
      for (const [a, b] of [[[tx0, ty1], [tx1, ty1]], [[tx1, ty1], [tx1, ty0]]]) {
        line(c, P(a[0], a[1], tz + 7), P(b[0], b[1], tz + 7), stair, 1.6);
        for (let u = 0; u <= 1.01; u += 0.25) { const x = a[0] + (b[0] - a[0]) * u, y = a[1] + (b[1] - a[1]) * u; line(c, P(x, y, tz), P(x, y, tz + 7), stair, 1); }
      }
      // Dach
      for (const [x, y] of [[tx1, ty1], [tx0, ty1], [tx1, ty0]]) line(c, P(x, y, tz), P(x, y, tz + 12), '#475569', 1.4);
      roofPyr(c, tx0, ty0, tx1, ty1, tz + 12, 14, ['#16a34a', '#f97316', '#dc2626'][st], 0.12);
      if (st === 2) { const t = P(0.85, 0.85, tz + 26); line(c, t, [t[0], t[1] - 2], '#475569', 1); }
      // Rutschen
      if (L >= 7) tube(c, SLIDE_B, '#ef4444');
      tube(c, SLIDE_A, ['#facc15', '#f97316', '#0ea5e9'][st]);
      // Stützen der Rutsche
      for (const i of [10, 22, 34, 46]) { const q = SLIDE_A[i]; if (q[2] > 8) { line(c, P(q[0], q[1], 0), P(q[0], q[1], q[2] - 3), OL, 2.8); line(c, P(q[0], q[1], 0), P(q[0], q[1], q[2] - 3), '#94a3b8', 1.6); } }
      // Liegen vorne links
      const lounger = (x, y, col) => {
        box(c, x, y, x + 0.55, y + 0.24, 2, 2, col, { left: shade(col, -0.15) });
        poly(c, [P(x, y, 4), P(x, y + 0.24, 4), P(x + 0.12, y + 0.24, 10), P(x + 0.12, y, 10)], shade(col, 0.15), OL, 1);
        line(c, P(x + 0.5, y + 0.24, 0), P(x + 0.5, y + 0.24, 2), '#475569', 1);
      };
      const lc = ['#60a5fa', '#f472b6', '#f8fafc'][st];
      lounger(0.45, 2.3, lc); lounger(0.45, 2.75, lc);
      if (L >= 3) lounger(0.45, 3.2, lc);
      if (L >= 5) { // Sonnenschirm
        const u = P(1.2, 3.0, 26);
        line(c, P(1.2, 3.0, 0), u, '#57534e', 1.4);
        c.beginPath(); c.moveTo(u[0] - 15, u[1] + 6); c.quadraticCurveTo(u[0], u[1] - 9, u[0] + 15, u[1] + 6); c.closePath();
        c.fillStyle = st === 2 ? '#1e3a8a' : '#ef4444'; c.fill(); c.strokeStyle = OL; c.lineWidth = 1.1; c.stroke();
        c.beginPath(); c.moveTo(u[0] - 5, u[1] + 6); c.quadraticCurveTo(u[0], u[1] - 7, u[0] + 5, u[1] + 6); c.closePath();
        c.fillStyle = '#fff7ed'; c.fill();
      }
      // Schwimmring am Beckenrand
      const rg = P(3.6, 1.7, 1);
      c.beginPath(); c.ellipse(rg[0], rg[1], 5, 2.6, 0, 0, 2 * PI); c.strokeStyle = OL; c.lineWidth = 3.4; c.stroke(); c.strokeStyle = '#f97316'; c.lineWidth = 2.2; c.stroke();
      if (L >= 7) { // Bademeister-Stuhl
        for (const [x, y] of [[3.65, 2.75], [3.85, 2.75], [3.65, 2.95], [3.85, 2.95]]) line(c, P(x, y, 0), P(x, y, 16), '#f8fafc', 1.4);
        box(c, 3.62, 2.72, 3.88, 2.98, 16, 2, '#dc2626');
        poly(c, [P(3.62, 2.72, 18), P(3.62, 2.98, 18), P(3.62, 2.98, 25), P(3.62, 2.72, 25)], '#ef4444', OL, 1);
      }
      if (L >= 9) { bush(c, ...P(3.6, 0.35), 0.55, '#3f9a35'); bush(c, ...P(0.3, 3.7), 0.5); }
      if (L >= 10) { // Fahnen
        for (const [x, y, col] of [[3.8, 0.4, '#0ea5e9'], [0.35, 1.8, '#facc15']]) {
          const t = P(x, y, 30); line(c, P(x, y, 0), t, '#e5e7eb', 1.3);
          poly(c, [t, [t[0] + 9, t[1] + 2.5], [t[0], t[1] + 5]], col, OL, 0.8);
        }
      }
    },

    // Baumhaus-Lodge (3×3)
    treehouse(c, L) {
      const st = stageOf(L);
      shadow(c, 0.1, 0.1, 2.95, 2.95, 0.1);
      groundPatch(c, 0.08, 0.08, 2.92, 2.92, '#7dbb55', '#62a03f');
      c.globalAlpha = 0.5;
      for (let i = 0; i < 10; i++) circle(c, ...P(0.3 + hash(i, 1, 61) * 2.4, 0.3 + hash(i, 2, 61) * 2.4), 1.5, '#4f8f2f');
      c.globalAlpha = 1;
      const bark = '#7a5230';
      const leaf = ['#3f9a35', '#3a9a3a', '#2f8f3e'][st], leafD = ['#2f7a2a', '#2c7f30', '#246f32'][st], leafL = ['#5cb847', '#55b84a', '#4cad4f'][st];
      const T = P(1.15, 1.15);
      // Krone hinten
      const blob = (x, y, z, r, col) => { const q = P(x, y, z); circle(c, q[0], q[1], r, col, OL, 1.2); circle(c, q[0] - r * 0.3, q[1] - r * 0.35, r * 0.35, shade(col, 0.18)); };
      blob(0.35, 1.25, 70, 20, leafD);
      blob(1.25, 0.3, 74, 20, leafD);
      blob(0.3, 0.6, 84, 20, leafD);
      blob(0.75, 0.25, 92, 18, leaf);
      blob(0.2, 1.9, 60, 16, leafD);
      blob(2.1, 0.25, 62, 17, leafD);
      blob(1.0, 0.95, 88, 19, leaf);
      blob(0.1, 1.15, 86, 15, leaf);
      blob(1.7, 0.15, 86, 15, leaf);
      // Stamm mit Wurzeln
      c.beginPath();
      c.moveTo(T[0] - 22, T[1] + 4); c.quadraticCurveTo(T[0] - 9, T[1] - 2, T[0] - 9, T[1] - 18);
      c.lineTo(T[0] - 7, T[1] - 70); c.lineTo(T[0] + 7, T[1] - 70); c.lineTo(T[0] + 9, T[1] - 18);
      c.quadraticCurveTo(T[0] + 10, T[1] - 2, T[0] + 24, T[1] + 5);
      c.quadraticCurveTo(T[0] + 8, T[1] + 6, T[0] + 2, T[1] + 4); c.quadraticCurveTo(T[0] - 6, T[1] + 7, T[0] - 22, T[1] + 4);
      c.closePath();
      const bg = c.createLinearGradient(T[0] - 10, 0, T[0] + 10, 0);
      bg.addColorStop(0, shade(bark, 0.15)); bg.addColorStop(1, shade(bark, -0.3));
      c.fillStyle = bg; c.fill(); c.strokeStyle = OL; c.lineWidth = 1.3; c.stroke();
      c.globalAlpha = 0.4;
      for (let i = 0; i < 5; i++) line(c, [T[0] - 5 + i * 2.5, T[1] - 8 - i * 3], [T[0] - 4 + i * 2.5, T[1] - 30 - i * 5], shade(bark, -0.5), 0.8);
      c.globalAlpha = 1;
      // Äste
      const branch = (a, b, w) => { line(c, a, b, OL, w + 2); line(c, a, b, bark, w); };
      branch([T[0] - 4, T[1] - 60], [T[0] - 40, T[1] - 80], 4);
      branch([T[0] + 4, T[1] - 64], [T[0] + 42, T[1] - 84], 4);
      branch([T[0], T[1] - 68], [T[0] + 2, T[1] - 92], 4.5);
      // Plattform mit Stützen
      const z = TH.z;
      const px0 = 0.6, px1 = 2.3, py0 = 0.7, py1 = 2.35;
      for (const [x, y] of [[px1 - 0.08, py1 - 0.08], [px0 + 0.08, py1 - 0.08], [px1 - 0.08, py0 + 0.08]]) { line(c, P(x, y, 0), P(x, y, z), OL, 4); line(c, P(x, y, 0), P(x, y, z), '#8b5a2b', 2.4); }
      line(c, P(px1 - 0.08, py1 - 0.08, z - 14), [T[0] + 8, T[1] - 26], '#8b5a2b', 2);
      line(c, P(px0 + 0.08, py1 - 0.08, z - 14), [T[0] - 8, T[1] - 26], '#8b5a2b', 2);
      const plank = st === 2 ? '#b07a45' : '#a0703f';
      box(c, px0, py0, px1, py1, z - 4, 4, plank, { top: shade(plank, 0.2) });
      c.globalAlpha = 0.3;
      for (let x = px0 + 0.14; x < px1; x += 0.14) line(c, P(x, py0, z), P(x, py1, z), '#5b3a1e', 0.8);
      c.globalAlpha = 1;
      // Hütte
      const { x0, y0, x1, y1, h } = TH;
      const wall = ['#b07a45', '#7fa37a', '#f1e4cc'][st];
      box(c, x0, y0, x1, y1, z, h, wall);
      if (st === 0) { // Bretter
        c.globalAlpha = 0.35;
        for (let zz = z + 3; zz < z + h; zz += 3) { line(c, P(x0, y1, zz), P(x1, y1, zz), '#4a2e14', 0.7); line(c, P(x1, y1, zz), P(x1, y0, zz), '#4a2e14', 0.7); }
        c.globalAlpha = 1;
      } else { // Eckleisten
        const trim = st === 2 ? '#7c2d12' : '#f8fafc';
        line(c, P(x1, y1, z), P(x1, y1, z + h), trim, 2); line(c, P(x0, y1, z), P(x0, y1, z + h), trim, 2);
      }
      // Fenster & Tür
      const wcol = '#fde68a';
      const frame = st === 0 ? '#5b3a1e' : st === 1 ? '#f8fafc' : '#7c2d12';
      faceY(c, y1, x0 + 0.15, x0 + 0.45, z + 6, z + 13, '#334155', frame);
      faceY(c, y1, x0 + 0.6, x0 + 0.9, z, z + 14, st === 2 ? '#7c2d12' : '#6b4423', OL);
      faceX(c, x1, y0 + 0.3, y0 + 0.65, z + 6, z + 13, '#334155', frame);
      if (st > 0) { // Fensterläden / Blumenkasten
        box(c, x0 + 0.13, y1, x0 + 0.47, y1 + 0.06, z + 4, 2, '#b45309');
        for (let i = 0; i < 3; i++) circle(c, ...P(x0 + 0.19 + i * 0.11, y1 + 0.04, z + 7), 1.4, ['#f472b6', '#facc15', '#ef4444'][i]);
      }
      void wcol;
      // Dach
      const roof = ['#6b4423', '#b91c1c', '#1f3a5f'][st];
      roofX(c, x0, y0, x1, y1, z + h, 14, roof, wall, 0.14);
      if (st === 0) { c.globalAlpha = 0.35; for (let i = 1; i < 4; i++) { const u = i / 4; line(c, P(x0 - 0.14, y1 + 0.14 - u * (y1 - y0) / 2 - u * 0.14, z + h + 14 * u), P(x1 + 0.14, y1 + 0.14 - u * (y1 - y0) / 2 - u * 0.14, z + h + 14 * u), '#3b2412', 0.8); } c.globalAlpha = 1; }
      if (L >= 4) box(c, x0 + 0.2, y0 + 0.2, x0 + 0.38, y0 + 0.38, z + h + 4, 13, '#78716c');
      // Balkon rechts mit Geländer
      const rail = st === 0 ? '#8b5a2b' : st === 1 ? '#f8fafc' : '#7c2d12';
      line(c, P(px0, py1, z + 7), P(px1, py1, z + 7), rail, 1.6);
      line(c, P(px1, py1, z + 7), P(px1, py0, z + 7), rail, 1.6);
      for (let x = px0 + 0.02; x < px1; x += 0.24) line(c, P(x, py1, z), P(x, py1, z + 7), rail, 1);
      for (let y = py0 + 0.02; y < py1; y += 0.24) line(c, P(px1, y, z), P(px1, y, z + 7), rail, 1);
      // Zweite Hütte + Hängebrücke
      if (L >= 7) {
        const qx0 = 2.15, qx1 = 2.85, qy0 = 0.15, qy1 = 0.85, qz = 58;
        line(c, P(qx1 - 0.05, qy1 - 0.05, 0), P(qx1 - 0.05, qy1 - 0.05, qz), OL, 3.6); line(c, P(qx1 - 0.05, qy1 - 0.05, 0), P(qx1 - 0.05, qy1 - 0.05, qz), '#8b5a2b', 2.2);
        box(c, qx0 - 0.08, qy0 - 0.08, qx1 + 0.05, qy1 + 0.05, qz - 3, 3, plank, { top: shade(plank, 0.2) });
        box(c, qx0, qy0, qx1, qy1, qz, 13, wall);
        faceX(c, qx1, qy0 + 0.2, qy0 + 0.48, qz + 4, qz + 10, '#334155', frame);
        roofPyr(c, qx0, qy0, qx1, qy1, qz + 13, 12, roof, 0.12);
        // Brücke (Seil + Bretter)
        const a = P(px1, 1.05, z), b = P(qx0 + 0.1, qy1 + 0.05, qz - 3);
        const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 8];
        c.beginPath(); c.moveTo(a[0], a[1]); c.quadraticCurveTo(m[0], m[1], b[0], b[1]); c.strokeStyle = OL; c.lineWidth = 4; c.stroke(); c.strokeStyle = '#c08850'; c.lineWidth = 2.6; c.stroke();
        c.beginPath(); c.moveTo(a[0], a[1] - 8); c.quadraticCurveTo(m[0], m[1] - 8, b[0], b[1] - 8); c.strokeStyle = '#d6b48a'; c.lineWidth = 1; c.stroke();
        for (let i = 1; i < 6; i++) { const u = i / 6, w = 1 - u; const qx = w * w * a[0] + 2 * w * u * m[0] + u * u * b[0], qy = w * w * a[1] + 2 * w * u * m[1] + u * u * b[1]; line(c, [qx, qy], [qx, qy - 7], '#d6b48a', 0.8); }
      }
      // Krone vorne (seitlich, Hütte bleibt frei)
      blob(0.2, 2.4, 66, 13, leafL);
      blob(0.15, 2.0, 80, 12, leafL);
      blob(2.3, 0.15, 80, 12, leafL);
      if (L < 7) blob(2.55, 0.8, 64, 12, leafL);
      // Strickleiter
      const la = 1.55, lb = 1.72;
      const r1 = P(la, py1 + 0.02, z - 4), r2 = P(lb, py1 + 0.02, z - 4);
      line(c, r1, P(la, py1 + 0.12, 0), '#c8a46a', 1.2); line(c, r2, P(lb, py1 + 0.12, 0), '#c8a46a', 1.2);
      for (let k = 1; k < 7; k++) { const u = k / 7; line(c, P(la, py1 + 0.02 + u * 0.1, (z - 4) * (1 - u)), P(lb, py1 + 0.02 + u * 0.1, (z - 4) * (1 - u)), '#8b5a2b', 1.4); }
      // Laternen an den Ecken
      const lan = (x, y, zz) => { const q = P(x, y, zz); line(c, q, [q[0], q[1] + 4], '#3f3f46', 0.8); c.fillStyle = '#fde68a'; rr(c, q[0] - 2, q[1] + 4, 4, 5, 1.2); c.fill(); c.strokeStyle = '#3f3f46'; c.lineWidth = 0.9; c.stroke(); };
      lan(px0 + 0.05, py1, z - 4); lan(px1, py0 + 0.05, z - 4);
      if (L >= 3) lan(px1, py1, z - 4);
      // Lichterkette ab L7
      if (L >= 7) {
        const a = P(px0, py1, z + 9), b = P(px1, py1, z + 9), m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 5];
        c.beginPath(); c.moveTo(a[0], a[1]); c.quadraticCurveTo(m[0], m[1], b[0], b[1]); c.strokeStyle = '#3f3f46'; c.lineWidth = 0.7; c.stroke();
        for (let i = 1; i < 8; i++) { const u = i / 8, w = 1 - u; circle(c, w * w * a[0] + 2 * w * u * m[0] + u * u * b[0], w * w * a[1] + 2 * w * u * m[1] + u * u * b[1] + 1, 1.2, ['#fde047', '#f472b6', '#7dd3fc'][i % 3]); }
      }
      // Boden: Holzstapel, Bank, Schild
      if (L >= 3) benchX(c, 2.1, 2.75, 2.55, '#9a6436');
      if (L >= 5) { // Feuerholz
        for (let i = 0; i < 3; i++) { const q = P(0.45, 2.55 + i * 0.1, 3 + (i === 1 ? 3 : 0)); circle(c, q[0], q[1], 2.6, '#c08850', OL, 0.8); circle(c, q[0], q[1], 1, '#8b5a2b'); }
      }
      if (L >= 9) { bush(c, ...P(2.75, 1.6), 0.45, '#3f9a35'); lampPost(c, 1.0, 2.8, 20); }
      if (L >= 10) bush(c, ...P(2.8, 2.05), 0.4, '#f472b6');
    },

    // Schatzkiste (1×1, Hindernis)
    obs_chest(c) {
      const wood = '#9a5b2a', gold = '#f5b82e';
      ellipseG(c, 0.52, 0.52, 0.36, 0, '#6b8e3a');
      const x0 = 0.18, x1 = 0.82, y0 = 0.32, y1 = 0.7, zh = 9, rz = 7;
      box(c, x0, y0, x1, y1, -2, zh + 2, wood, { noTop: true });
      // Deckel (gewölbt um die x-Achse)
      const yc = (y0 + y1) / 2, ry = (y1 - y0) / 2;
      const cur = x => { const a = []; for (let i = 0; i <= 8; i++) { const t = i / 8 * PI; a.push(P(x, yc + Math.cos(t) * ry, zh + Math.sin(t) * rz)); } return a; };
      const back = cur(x0), front = cur(x1);
      poly(c, [...back, ...front.slice().reverse()], shade(wood, 0.12), OL, 1.1);
      poly(c, front, shade(wood, -0.25), OL, 1.1);
      // Goldbeschläge
      for (const x of [x0 + 0.1, x1 - 0.1]) {
        const cv = cur(x);
        c.beginPath(); c.moveTo(cv[0][0], cv[0][1] + zh + 2); c.lineTo(cv[0][0], cv[0][1]); for (const q of cv.slice(1, 5)) c.lineTo(q[0], q[1]);
        c.strokeStyle = OL; c.lineWidth = 3; c.stroke(); c.strokeStyle = gold; c.lineWidth = 1.8; c.stroke();
      }
      line(c, P(x1, y1, zh), P(x1, y0, zh), gold, 1.4);
      line(c, P(x0, y1, zh), P(x1, y1, zh), gold, 1.4);
      // Schloss
      const lk = P((x0 + x1) / 2, y1, zh);
      c.fillStyle = gold; rr(c, lk[0] - 2.5, lk[1] - 2, 5, 5.5, 1); c.fill(); c.strokeStyle = OL; c.lineWidth = 0.9; c.stroke();
      circle(c, lk[0], lk[1] + 1.2, 0.8, '#3f2a10');
      // Gras davor (halb eingesunken)
      for (let i = 0; i < 9; i++) {
        const q = P(0.2 + i * 0.07, y1 + 0.06 + hash(i, 3, 71) * 0.06);
        const hh = 3 + hash(i, 4, 71) * 3;
        poly(c, [[q[0] - 1.5, q[1]], [q[0] + 1.5, q[1]], [q[0] + (hash(i, 5, 71) - 0.5) * 3, q[1] - hh]], i % 2 ? '#4f9a35' : '#62b043');
      }
      bush(c, ...P(0.82, 0.3), 0.32, '#4a9a38');
      star4(c, ...P(0.72, 0.36, 18), 3, '#fff7c2');
    },

    // Alte Mühlenruine (2×2, Hindernis)
    obs_ruin(c) {
      const stone = '#a8a29e', moss = '#5f9a3a';
      shadow(c, 0.2, 0.2, 1.85, 1.85, 0.12);
      ellipseG(c, 1, 1, 0.85, 0, '#6f9e45');
      // Steinbrocken hinten
      for (let i = 0; i < 4; i++) { const q = P(0.25 + hash(i, 1, 81) * 0.4, 0.2 + hash(i, 2, 81) * 1.4); poly(c, [[q[0] - 4, q[1]], [q[0] - 3, q[1] - 4], [q[0] + 2, q[1] - 5], [q[0] + 4, q[1]]], '#9ca3af', OL, 1); }
      // Turmstumpf mit gezackter Krone
      const cx = 0.85, cy = 0.85, r = 0.55;
      const p = P(cx, cy, 0), rx = r * HW * 1.414, ry = r * HH * 1.414;
      const top = a => 20 + 14 * hash(Math.round(a * 10), 9, 81) * (Math.cos(a - 3.6) * 0.5 + 0.6) + (Math.abs(a - 3.9) < 0.5 ? 8 : 0);
      // Innenseite (hintere Wand von innen)
      c.beginPath();
      for (let i = 0; i <= 16; i++) { const a = PI + i / 16 * PI; const zz = top(a); const x = p[0] + rx * Math.cos(a), y = p[1] + ry * Math.sin(a) - zz; if (i) c.lineTo(x, y); else c.moveTo(x, y); }
      for (let i = 16; i >= 0; i--) { const a = PI + i / 16 * PI; c.lineTo(p[0] + rx * Math.cos(a) * 0.82, p[1] + ry * Math.sin(a) * 0.82 - 14); }
      c.closePath(); c.fillStyle = shade(stone, -0.22); c.fill(); c.strokeStyle = OL; c.lineWidth = 1.1; c.stroke();
      c.save(); c.clip(); c.globalAlpha = 0.35; c.strokeStyle = '#44403c'; c.lineWidth = 0.7;
      for (let zz = 16; zz < 44; zz += 5) { c.beginPath(); c.ellipse(p[0], p[1] - zz, rx * 0.9, ry * 0.9, 0, PI, 2 * PI); c.stroke(); }
      c.restore();
      // Innenboden
      c.beginPath(); c.ellipse(p[0], p[1] - 14, rx * 0.82, ry * 0.82, 0, 0, 2 * PI); c.fillStyle = '#4b5320'; c.fill();
      // Außenwand vorne
      const frontPts = [];
      for (let i = 0; i <= 16; i++) { const a = i / 16 * PI; frontPts.push([p[0] + rx * Math.cos(a), p[1] + ry * Math.sin(a), top(a)]); }
      c.beginPath();
      c.moveTo(frontPts[0][0], frontPts[0][1]);
      for (const q of frontPts) c.lineTo(q[0], q[1] - q[2]);
      c.lineTo(frontPts[16][0], frontPts[16][1]);
      c.ellipse(p[0], p[1], rx, ry, 0, PI, 0, true);
      c.closePath();
      const gr = c.createLinearGradient(p[0] - rx, 0, p[0] + rx, 0);
      gr.addColorStop(0, shade(stone, 0.15)); gr.addColorStop(0.45, stone); gr.addColorStop(1, shade(stone, -0.3));
      c.fillStyle = gr; c.fill(); c.strokeStyle = OL; c.lineWidth = 1.3; c.stroke();
      // Wandkrone (Mauerstärke) vorne
      c.beginPath();
      for (let i = 0; i <= 16; i++) { const q = frontPts[i]; if (i) c.lineTo(q[0], q[1] - q[2]); else c.moveTo(q[0], q[1] - q[2]); }
      c.strokeStyle = shade(stone, 0.3); c.lineWidth = 1; c.stroke();
      // Steinfugen
      c.globalAlpha = 0.4; c.strokeStyle = '#57534e'; c.lineWidth = 0.8;
      for (let zz = 5, rI = 0; zz < 36; zz += 5, rI++) {
        for (let k = 0; k < 6; k++) {
          const a0 = (k + (rI % 2) * 0.5) / 6 * PI, a1 = a0 + PI / 6 * 0.85;
          const ok = q => top(q) > zz + 2;
          if (!ok(a0) || !ok(a1) || a1 > PI) continue;
          c.beginPath(); c.ellipse(p[0], p[1] - zz, rx, ry, 0, a0, a1); c.stroke();
          const x = p[0] + rx * Math.cos(a0), y = p[1] + ry * Math.sin(a0) - zz;
          c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + 5); c.stroke();
        }
      }
      c.globalAlpha = 1;
      // morscher Balken der alten Kappe
      const ba = [p[0] + rx * 0.15, p[1] - 30], bb = [p[0] + rx * 0.85, p[1] - 44];
      line(c, ba, bb, OL, 5); line(c, ba, bb, '#7a5a38', 3.4);
      line(c, [bb[0] - 2, bb[1] + 1], [bb[0] + 3, bb[1] + 6], OL, 3); line(c, [bb[0] - 2, bb[1] + 1], [bb[0] + 3, bb[1] + 6], '#7a5a38', 1.8);
      // Torbogen
      const da = 1.9, dx = p[0] + rx * Math.cos(da), dy = p[1] + ry * Math.sin(da);
      c.beginPath(); c.moveTo(dx - 5, dy); c.lineTo(dx - 5, dy - 10); c.arc(dx, dy - 10, 5, PI, 0); c.lineTo(dx + 5, dy); c.closePath();
      c.fillStyle = '#292524'; c.fill(); c.strokeStyle = OL; c.lineWidth = 1; c.stroke();
      // Fensterloch
      const wa = 0.6, wx = p[0] + rx * Math.cos(wa), wy = p[1] + ry * Math.sin(wa) - 20;
      c.fillStyle = '#292524'; rr(c, wx - 2.5, wy - 6, 5, 7, 2); c.fill();
      // Moos & Efeu
      for (let i = 0; i < 16; i += 2) { const q = frontPts[i]; circle(c, q[0], q[1] - q[2] + 1, 2.4 + hash(i, 7, 81) * 1.5, i % 4 ? moss : shade(moss, 0.15)); }
      c.strokeStyle = '#3f7a2a'; c.lineWidth = 1.1;
      c.beginPath(); c.moveTo(p[0] + rx * 0.75, p[1] + ry * 0.6); c.quadraticCurveTo(p[0] + rx * 0.9, p[1] - 14, p[0] + rx * 0.6, p[1] - 28); c.stroke();
      for (let i = 0; i < 8; i++) { const u = i / 7; circle(c, p[0] + rx * (0.75 + Math.sin(u * 3) * 0.12) + (i % 2 ? 2 : -2), p[1] + ry * 0.6 - u * 32, 1.8, i % 2 ? '#4f8f2f' : '#65a83d'); }
      // Mauerrest rechts
      box(c, 1.45, 0.25, 1.75, 0.55, 0, 12, stone);
      box(c, 1.45, 0.25, 1.62, 0.4, 12, 6, stone);
      circle(c, ...P(1.55, 0.35, 18), 2.4, moss);
      // umgestürzter Flügel vorne
      const wood = '#8b6a43';
      const sa = P(0.55, 1.55, 1), sb = P(1.85, 1.35, 1);
      line(c, sa, sb, OL, 4.6); line(c, sa, sb, wood, 3);
      // zerrissenes Segeltuch
      for (const [u0, u1, k] of [[0.15, 0.32, 1], [0.49, 0.62, 0.7]]) {
        const q = u => P(0.55 + 1.3 * u, 1.55 - 0.2 * u, 1), r = u => P(0.6 + 1.3 * u, 1.87 - 0.2 * u, 1);
        poly(c, [q(u0), q(u1), r(u1 - 0.04 * k), [(r(u0)[0] + r(u1)[0]) / 2, (r(u0)[1] + r(u1)[1]) / 2 - 2], r(u0)], 'rgba(240,230,205,0.9)', OL, 0.8);
      }
      for (let i = 0; i < 5; i++) {
        const u = 0.15 + i * 0.17;
        const a = P(0.55 + 1.3 * u, 1.55 - 0.2 * u, 1), b = P(0.55 + 1.3 * u + 0.05, 1.55 - 0.2 * u + 0.32, 1);
        if (i !== 3) { line(c, a, b, OL, 2.6); line(c, a, b, shade(wood, 0.15), 1.4); }
      }
      line(c, P(0.7, 1.85, 1), P(1.95, 1.68, 1), OL, 2.6);
      line(c, P(0.7, 1.85, 1), P(1.95, 1.68, 1), shade(wood, 0.1), 1.4);
      // Steine & Gras vorne
      for (let i = 0; i < 3; i++) { const q = P(0.35 + i * 0.35, 1.85 - i * 0.05 + hash(i, 3, 81) * 0.05); poly(c, [[q[0] - 3.5, q[1]], [q[0] - 2, q[1] - 3.5], [q[0] + 2, q[1] - 4], [q[0] + 3.5, q[1]]], '#b4aea6', OL, 0.9); }
      bush(c, ...P(1.75, 0.95), 0.45, '#4a9a38');
      bush(c, ...P(0.2, 1.3), 0.35, '#3d8b2f');
    },
  };

  const ANIM_NEW = {
    observatory(ctx, b, t, dt, fx) {
      const k = fx.night;
      if (k < 0.05) return;
      const g = obsGeo();
      const a = Math.min(1, k * 1.3);
      // Spalt leuchtet
      ctx.globalAlpha = a * 0.75;
      poly(ctx, g.slit, '#fcd34d');
      // schwacher Strahl aus dem Fernrohr
      const tip = g.tip;
      ctx.globalAlpha = a * (0.16 + 0.06 * Math.sin(t * 1.3));
      ctx.beginPath(); ctx.moveTo(tip[0] - 1.5, tip[1] + 1.5); ctx.lineTo(tip[0] + 26, tip[1] - 34); ctx.lineTo(tip[0] + 36, tip[1] - 24); ctx.closePath();
      ctx.fillStyle = '#e0f2fe'; ctx.fill();
      // Funkeln
      const tw = 0.5 + 0.5 * Math.sin(t * 4 + b.id);
      ctx.globalAlpha = a * (0.4 + 0.6 * tw);
      star4(ctx, tip[0] + 22 + Math.sin(t * 0.7) * 3, tip[1] - 26, 2 + tw * 2.5, '#fef9c3');
      ctx.globalAlpha = a * (1 - tw * 0.7);
      star4(ctx, tip[0] + 10, tip[1] - 36, 1.8, '#ffffff');
      ctx.globalAlpha = 1;
    },
    ferris(ctx, b, t, dt, fx) {
      wheelSpin(ctx, b.level, t * 0.22 + b.id, fx.night);
    },
    waterslide(ctx, b, t, dt, fx) {
      const pts = SLIDE_A, n = pts.length - 1;
      const per = 7, ph = (t + b.id * 1.7) % per;
      const dur = 3.2;
      if (ph < dur) { // Rutscher
        const u = ph / dur, s = u * u * 0.35 + u * 0.65;
        const f = s * n, i = Math.min(n - 1, Math.floor(f)), r = f - i;
        const q = [0, 1, 2].map(j => pts[i][j] + (pts[i + 1][j] - pts[i][j]) * r);
        const p = P(q[0], q[1], q[2] + 3);
        const shirt = ['#ef4444', '#22c55e', '#f59e0b', '#8b5cf6'][Math.floor((t + b.id * 1.7) / per) % 4];
        circle(ctx, p[0], p[1] - 1, 2.6, shirt, OL, 0.8);
        circle(ctx, p[0], p[1] - 5, 2.1, '#f6d3b3', OL, 0.7);
      } else if (ph < dur + 1.1) { // Platscher am Ende
        const e = (ph - dur) / 1.1;
        const end = P(2.65, 2.95, -4);
        ctx.globalAlpha = 1 - e;
        ctx.beginPath();
        for (let j = 0; j < 7; j++) {
          const a = PI + (j + 0.5) / 7 * PI;
          const x = end[0] + Math.cos(a) * (4 + e * 12), y = end[1] + Math.sin(a) * (3 + e * 10) + e * e * 14 - 4;
          ctx.moveTo(x + 1.6, y); ctx.arc(x, y, 1.6, 0, 2 * PI);
        }
        ctx.fillStyle = '#ffffff'; ctx.fill();
        ctx.beginPath(); ctx.ellipse(end[0], end[1] + 2, 5 + e * 9, 2 + e * 4, 0, 0, 2 * PI); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.2; ctx.stroke();
        ctx.globalAlpha = 1;
      }
      // kleine Wellen im Becken
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1;
      for (let i = 0; i < 3; i++) {
        const w = (t * 0.5 + i / 3) % 1;
        const p = P(2.3 + hash(i, 5, 52) * 1.2, 2.4 + hash(i, 6, 52) * 1.1, -6);
        ctx.globalAlpha = Math.sin(w * PI) * 0.8;
        ctx.beginPath(); ctx.moveTo(p[0] - 5, p[1]); ctx.quadraticCurveTo(p[0], p[1] - 2, p[0] + 5, p[1]); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    },
    treehouse(ctx, b, t, dt, fx) {
      if (b.level >= 4) fx.smoke(TH.x0 + 0.29, TH.y0 + 0.29, TH.z + TH.h + 18, 0.8, false);
      if (fx.night < 0.05) return;
      const { x0, y0, x1, y1, z } = TH;
      ctx.globalAlpha = Math.min(1, fx.night * 1.2);
      faceY(ctx, y1, x0 + 0.15, x0 + 0.45, z + 6, z + 13, '#fcd34d');
      faceX(ctx, x1, y0 + 0.3, y0 + 0.65, z + 6, z + 13, '#fcd34d');
      if (b.level >= 7) faceX(ctx, 2.85, 0.35, 0.63, 62, 68, '#fcd34d');
      // Laternen
      ctx.globalAlpha = Math.min(1, fx.night * 1.2) * (0.85 + 0.15 * Math.sin(t * 5 + b.id));
      for (const [x, y] of [[0.65, 2.35], [2.3, 0.75]]) { const q = P(x, y, z - 4); circle(ctx, q[0], q[1] + 6.5, 2.6, '#fff3b0'); }
      ctx.globalAlpha = 1;
    },
    obs_chest(ctx, b, t) {
      const ph = (t * 0.5 + b.id * 0.31) % 1;
      if (ph > 0.25) return;
      const s = Math.sin(ph / 0.25 * PI);
      const q = P(0.66, 0.4, 16);
      ctx.globalAlpha = s;
      star4(ctx, q[0], q[1], 2 + s * 4, '#fde68a');
      circle(ctx, q[0], q[1], 1.2, '#ffffff');
      ctx.globalAlpha = 1;
    },
  };
  for (const k in DRAW_NEW) Render.defineArt(k, DRAW_NEW[k], ANIM_NEW[k]);
})();
