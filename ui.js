'use strict';
/* ==========================================================================
 * ui.js – Eingabe, Menüs, Dialoge, Sound, Haptik, Spielschleife, PWA-Start
 * ========================================================================== */

/* ---------------- Sound (WebAudio, erst nach erster Berührung) ---------------- */
const Sound = (() => {
  let ac = null, master = null, noiseBuf = null, ambT = 2;
  const enabled = () => Game.S && Game.S.settings.sound;
  // Wird bei jeder Berührung aufgerufen; iOS gibt Audio erst bei touchend/click frei
  function unlock() {
    try {
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ac = new AC();
        master = ac.createGain();
        master.gain.value = 0.45;
        master.connect(ac.destination);
        noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      if (ac.state !== 'running') {
        ac.resume();
        const src = ac.createBufferSource();   // stummer Puffer schaltet Audio auf iOS frei
        src.buffer = ac.createBuffer(1, 1, 22050);
        src.connect(ac.destination);
        src.start(0);
      }
    } catch (e) { /* kein Audio verfügbar */ }
  }
  function tone(freq, dur, type, vol, when, slide) {
    const t = ac.currentTime + (when || 0);
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(dur, vol, freq, when, q) {
    const t = ac.currentTime + (when || 0);
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuf;
    f.type = 'bandpass'; f.frequency.value = freq || 800; f.Q.value = q || 1;
    g.gain.setValueAtTime(vol || 0.2, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }
  const SFX = {
    tap: () => tone(700, 0.05, 'triangle', 0.12),
    coin: () => { tone(988, 0.07, 'square', 0.07); tone(1319, 0.2, 'square', 0.07, 0.06); },
    wood: () => { noise(0.07, 0.35, 900, 0, 2); tone(260, 0.12, 'triangle', 0.18, 0, 0.6); noise(0.06, 0.25, 700, 0.09, 2); },
    gem: () => { [1568, 2093, 2637].forEach((f, i) => tone(f, 0.18, 'sine', 0.1, i * 0.05)); },
    build: () => { noise(0.1, 0.4, 350, 0, 1.5); tone(150, 0.16, 'sine', 0.3, 0, 0.6); noise(0.08, 0.3, 500, 0.14, 1.5); },
    done: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, 'triangle', 0.16, i * 0.08)); },
    levelup: () => { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(f, i === 6 ? 0.5 : 0.15, 'square', 0.07, i * 0.09)); },
    error: () => { tone(220, 0.1, 'sawtooth', 0.08); tone(165, 0.18, 'sawtooth', 0.08, 0.09); },
    event: () => { tone(784, 0.14, 'sine', 0.2); tone(1047, 0.14, 'sine', 0.2, 0.14); tone(784, 0.3, 'sine', 0.2, 0.28); },
    pop: () => tone(480, 0.1, 'sine', 0.2, 0, 2),
    open: () => tone(520, 0.08, 'triangle', 0.1, 0, 1.5),
    close: () => tone(620, 0.08, 'triangle', 0.1, 0, 0.6),
    pick: () => tone(330, 0.08, 'triangle', 0.15, 0, 1.5),
    drop: () => { tone(300, 0.1, 'sine', 0.25, 0, 0.5); noise(0.06, 0.2, 400); },
    star: () => { tone(1175, 0.1, 'triangle', 0.12); tone(1568, 0.25, 'triangle', 0.12, 0.08); },
    bad: () => { tone(330, 0.2, 'triangle', 0.15, 0, 0.7); },
    guest: () => { tone(1319, 0.25, 'sine', 0.08); tone(1047, 0.35, 'sine', 0.08, 0.12); },
    bark: () => { noise(0.08, 0.4, 600, 0, 3); noise(0.08, 0.4, 600, 0.15, 3); },
    thunder: () => { noise(1.6, 0.55, 90, 0, 0.6); noise(0.4, 0.3, 300, 0.05, 1); },
    tick: () => tone(1200, 0.02, 'square', 0.04),
  };
  function play(name) {
    if (!ac || !enabled() || !SFX[name]) return;
    if (ac.state === 'suspended') ac.resume();
    try { SFX[name](); } catch (e) { /* ignorieren */ }
  }
  function ambient(dt, night, weather) {
    if (!ac || !Game.S.settings.ambient || !enabled() || document.hidden) return;
    ambT -= dt;
    if (ambT > 0) return;
    if (weather === 'rain' || weather === 'storm') { noise(2.5, 0.05, 2500, 0, 0.4); ambT = 2.2; return; }
    if (night) {
      for (let i = 0; i < 3; i++) tone(4300 + Math.random() * 300, 0.035, 'sine', 0.025, i * 0.07);
      ambT = 0.9 + Math.random() * 1.6;
    } else {
      const base = 2200 + Math.random() * 1400;
      const n = 2 + (Math.random() * 3 | 0);
      for (let i = 0; i < n; i++) tone(base * (1 + Math.random() * 0.2), 0.07, 'sine', 0.03, i * 0.11, 1.3);
      ambT = 3 + Math.random() * 6;
    }
  }
  return { unlock, play, ambient };
})();

/* ---------------- Benutzeroberfläche ---------------- */
const UI = (() => {
  const $ = s => document.querySelector(s);
  const S = () => Game.S;
  const st = { selectedId: null, placing: null, drag: null, sheet: null, modal: null, queue: [], sheetTab: {} };
  let canvas;
  const hud = {};

  /* ---------- Icons (selbst gezeichnete SVGs) ---------- */
  function gearPath() {
    let d = '';
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2, r = i % 2 ? 7.4 : 10;
      const a2 = (i + 1) / 16 * Math.PI * 2;
      d += (i ? 'L' : 'M') + (12 + Math.cos(a) * r).toFixed(2) + ' ' + (12 + Math.sin(a) * r).toFixed(2);
      d += 'L' + (12 + Math.cos(a2 - 0.08) * r).toFixed(2) + ' ' + (12 + Math.sin(a2 - 0.08) * r).toFixed(2);
    }
    return d + 'Z';
  }
  const IC = {
    euro: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#fbbf24" stroke="#a16207" stroke-width="2"/><circle cx="12" cy="12" r="7" fill="#fcd34d"/><text x="12" y="16.6" text-anchor="middle" font-size="12.5" font-weight="900" fill="#a16207" font-family="system-ui,sans-serif">€</text></svg>',
    wood: '<svg viewBox="0 0 24 24"><g transform="rotate(-25 12 12)"><rect x="1.5" y="7.5" width="19" height="9" rx="4.5" fill="#9a6436" stroke="#5b3a1e" stroke-width="1.6"/><ellipse cx="19.5" cy="12" rx="3" ry="4.5" fill="#e7c08b" stroke="#5b3a1e" stroke-width="1.6"/><path d="M5 11h8M7 14h6" stroke="#5b3a1e" stroke-width="1.2" stroke-linecap="round"/></g></svg>',
    stars: '<svg viewBox="0 0 24 24"><path d="M12 2l2.9 6.3 6.9.7-5.2 4.6 1.5 6.8L12 17l-6.1 3.4 1.5-6.8L2.2 9l6.9-.7z" fill="#facc15" stroke="#a16207" stroke-width="1.6" stroke-linejoin="round"/></svg>',
    gems: '<svg viewBox="0 0 24 24"><path d="M12 2l8.5 7L12 22 3.5 9z" fill="#22c55e" stroke="#14532d" stroke-width="1.6" stroke-linejoin="round"/><path d="M7.5 9l4.5-4.5 2.2 4.5z" fill="#bbf7d0"/><path d="M3.5 9h17" stroke="#14532d" stroke-width="1"/></svg>',
    smile: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#facc15" stroke="#a16207" stroke-width="1.6"/><circle cx="8.5" cy="10" r="1.5" fill="#78350f"/><circle cx="15.5" cy="10" r="1.5" fill="#78350f"/><path d="M7.5 14c1.2 2 2.7 3 4.5 3s3.3-1 4.5-3" fill="none" stroke="#78350f" stroke-width="1.8" stroke-linecap="round"/></svg>',
    meh: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#fcd34d" stroke="#a16207" stroke-width="1.6"/><circle cx="8.5" cy="10" r="1.5" fill="#78350f"/><circle cx="15.5" cy="10" r="1.5" fill="#78350f"/><path d="M8 15.5h8" stroke="#78350f" stroke-width="1.8" stroke-linecap="round"/></svg>',
    sad: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#fdba74" stroke="#9a3412" stroke-width="1.6"/><circle cx="8.5" cy="10" r="1.5" fill="#7c2d12"/><circle cx="15.5" cy="10" r="1.5" fill="#7c2d12"/><path d="M7.5 17c1.2-2 2.7-3 4.5-3s3.3 1 4.5 3" fill="none" stroke="#7c2d12" stroke-width="1.8" stroke-linecap="round"/></svg>',
    hammer: '<svg viewBox="0 0 24 24"><path d="M13.2 9.8l-9 9a1.9 1.9 0 002.7 2.7l9-9" fill="#c08850" stroke="#5b3a1e" stroke-width="1.5"/><path d="M10.5 5.5L15 2l7 7-3.2 3.2-3-2-1.8 1.8-3.5-3.5 2-1.8z" fill="#9ca3af" stroke="#374151" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    build: '<svg viewBox="0 0 24 24"><path d="M12 2.5L22 20H2z" fill="#f08a24" stroke="#7c2d12" stroke-width="1.7" stroke-linejoin="round"/><path d="M12 2.5L17 20h5z" fill="#c2410c"/><path d="M12 11l-3 9h6z" fill="#5b2a0c"/><path d="M1 21h22" stroke="#3f6212" stroke-width="2" stroke-linecap="round"/></svg>',
    shop: '<svg viewBox="0 0 24 24"><rect x="3.5" y="10" width="17" height="11" rx="1.5" fill="#fde68a" stroke="#78350f" stroke-width="1.6"/><path d="M2 10l2-6h16l2 6z" fill="#ef4444" stroke="#7f1d1d" stroke-width="1.6" stroke-linejoin="round"/><path d="M7 4l-1 6M12 4v6M17 4l1 6" stroke="#fff" stroke-width="2"/><rect x="9" y="14" width="6" height="7" fill="#92400e"/></svg>',
    quests: '<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="19" rx="2" fill="#fef3c7" stroke="#78350f" stroke-width="1.6"/><rect x="8" y="1.5" width="8" height="4" rx="1.2" fill="#a16207"/><path d="M7.5 10l1.5 1.5 3-3M7.5 16l1.5 1.5 3-3" fill="none" stroke="#16a34a" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M13.5 10.5h3.5M13.5 16.5h3.5" stroke="#78350f" stroke-width="1.6" stroke-linecap="round"/></svg>',
    settings: '<svg viewBox="0 0 24 24"><path d="' + gearPath() + '" fill="#cbd5e1" stroke="#334155" stroke-width="1.4" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.3" fill="#64748b" stroke="#334155" stroke-width="1.3"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#3b82f6" stroke="#1e3a8a" stroke-width="1.6"/><circle cx="12" cy="7.3" r="1.6" fill="#fff"/><path d="M12 11v6.5" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/></svg>',
    up: '<svg viewBox="0 0 24 24"><path d="M12 2.5l8.5 9H15V21H9v-9.5H3.5z" fill="#4ade80" stroke="#14532d" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    move: '<svg viewBox="0 0 24 24"><path d="M12 2l3 3.5h-2V11h5.5V9L22 12l-3.5 3v-2H13v5.5h2L12 22l-3-3.5h2V13H5.5v2L2 12l3.5-3v2H11V5.5H9z" fill="#e0f2fe" stroke="#0c4a6e" stroke-width="1.4" stroke-linejoin="round"/></svg>',
    bolt: '<svg viewBox="0 0 24 24"><path d="M13.5 1.5L4 13.5h6.5L9.5 22.5 20 9.5h-6.6z" fill="#facc15" stroke="#854d0e" stroke-width="1.6" stroke-linejoin="round"/></svg>',
    collect: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="17" rx="8" ry="3.5" fill="#f59e0b" stroke="#92400e" stroke-width="1.5"/><ellipse cx="12" cy="13.5" rx="8" ry="3.5" fill="#fbbf24" stroke="#92400e" stroke-width="1.5"/><ellipse cx="12" cy="10" rx="8" ry="3.5" fill="#fcd34d" stroke="#92400e" stroke-width="1.5"/></svg>',
    axe: '<svg viewBox="0 0 24 24"><path d="M6 21L17 6" stroke="#8b5a2b" stroke-width="3" stroke-linecap="round"/><path d="M13 4c3-2 7-1 8 2-2 0-4 1-5 3z" fill="#cbd5e1" stroke="#334155" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M5 7h14l-1.2 14H6.2z" fill="#fca5a5" stroke="#7f1d1d" stroke-width="1.6" stroke-linejoin="round"/><path d="M3.5 7h17M9 7V4h6v3" fill="none" stroke="#7f1d1d" stroke-width="1.6" stroke-linecap="round"/><path d="M10 10v8M14 10v8" stroke="#7f1d1d" stroke-width="1.4"/></svg>',
    map: '<svg viewBox="0 0 24 24"><path d="M3 6l6-2.5 6 2.5 6-2.5v14.5l-6 2.5-6-2.5-6 2.5z" fill="#bbf7d0" stroke="#166534" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 3.5v14.5M15 6v14.5" stroke="#166534" stroke-width="1.3"/><path d="M5 10c2 1 3-1 5 0s2 3 4 2 3-2 5-1" stroke="#16a34a" stroke-width="1.4" fill="none"/><circle cx="17.5" cy="8.5" r="1.8" fill="#ef4444" stroke="#7f1d1d" stroke-width="1"/></svg>',
    gift: '<svg viewBox="0 0 24 24"><rect x="3" y="10" width="18" height="11" rx="1.5" fill="#ef4444" stroke="#7f1d1d" stroke-width="1.6"/><rect x="2" y="7" width="20" height="4.5" rx="1.2" fill="#f87171" stroke="#7f1d1d" stroke-width="1.6"/><path d="M12 7v14" stroke="#facc15" stroke-width="3"/><path d="M12 7c-2-4-7-4-6-1 .5 1.5 3 1 6 1zm0 0c2-4 7-4 6-1-.5 1.5-3 1-6 1z" fill="#facc15" stroke="#a16207" stroke-width="1.2"/></svg>',
    sun: '<svg viewBox="0 0 24 24"><g stroke="#f59e0b" stroke-width="2" stroke-linecap="round"><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1"/></g><circle cx="12" cy="12" r="5.5" fill="#fde047" stroke="#d97706" stroke-width="1.5"/></svg>',
    moon: '<svg viewBox="0 0 24 24"><path d="M15.5 3A9 9 0 1021 15.5 7 7 0 0115.5 3z" fill="#fef3c7" stroke="#a16207" stroke-width="1.5" stroke-linejoin="round"/><circle cx="10" cy="12" r="1.2" fill="#e5d5a8"/><circle cx="13" cy="17" r="1.6" fill="#e5d5a8"/></svg>',
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#fff" stroke="#334155" stroke-width="1.8"/><path d="M12 6.5V12l3.5 2.5" fill="none" stroke="#334155" stroke-width="2" stroke-linecap="round"/></svg>',
    guests: '<svg viewBox="0 0 24 24"><circle cx="8" cy="7" r="3.2" fill="#f6d3b3" stroke="#78350f" stroke-width="1.3"/><path d="M2.5 20c0-4 2.5-7 5.5-7s5.5 3 5.5 7z" fill="#3b82f6" stroke="#1e3a8a" stroke-width="1.3"/><circle cx="16.5" cy="9" r="2.7" fill="#e8b48a" stroke="#78350f" stroke-width="1.3"/><path d="M12 20.5c.3-3.5 2.2-6 4.5-6s4.5 2.5 4.8 6z" fill="#ef4444" stroke="#7f1d1d" stroke-width="1.3"/></svg>',
    megaphone: '<svg viewBox="0 0 24 24"><path d="M3 10v4l3 .5L17 20V4L6 9.5z" fill="#f97316" stroke="#7c2d12" stroke-width="1.6" stroke-linejoin="round"/><path d="M6 14.5L7.5 21h3L9.5 15" fill="#fdba74" stroke="#7c2d12" stroke-width="1.5" stroke-linejoin="round"/><path d="M20 9.5c1 .8 1 4.2 0 5" stroke="#7c2d12" stroke-width="1.6" stroke-linecap="round"/></svg>',
    rain: '<svg viewBox="0 0 24 24"><path d="M6.5 15a4.5 4.5 0 01-.3-9 6 6 0 0111.4 1.5A3.8 3.8 0 0117.5 15z" fill="#cbd5e1" stroke="#475569" stroke-width="1.5"/><path d="M8 17.5l-1 3M12 17.5l-1 3M16 17.5l-1 3" stroke="#3b82f6" stroke-width="2" stroke-linecap="round"/></svg>',
    storm: '<svg viewBox="0 0 24 24"><path d="M6.5 14a4.5 4.5 0 01-.3-9 6 6 0 0111.4 1.5A3.8 3.8 0 0117.5 14z" fill="#64748b" stroke="#1e293b" stroke-width="1.5"/><path d="M12.5 12l-3 5.5h3l-1.5 5 4.5-7h-3l1.5-3.5z" fill="#facc15" stroke="#854d0e" stroke-width="1.2" stroke-linejoin="round"/></svg>',
    fire: '<svg viewBox="0 0 24 24"><path d="M12 2.5c1 3.5 5.5 6 5.5 11a5.5 5.5 0 01-11 0c0-2.6 1.3-4.2 2.6-5.6.2 1.8 1 2.9 2 3.4-.4-3.4.4-6.2.9-8.8z" fill="#f97316" stroke="#7c2d12" stroke-width="1.5" stroke-linejoin="round"/><path d="M12 12.5c.9 1.4 2.4 2.4 2.4 4.3a2.4 2.4 0 01-4.8 0c0-1.5.9-2.6 2.4-4.3z" fill="#fde047"/></svg>',
    festival: '<svg viewBox="0 0 24 24"><path d="M9 18V5l11-2.5v13" fill="none" stroke="#7c3aed" stroke-width="2.2" stroke-linejoin="round"/><ellipse cx="6.5" cy="18" rx="3.2" ry="2.5" fill="#a855f7" stroke="#581c87" stroke-width="1.4"/><ellipse cx="17.5" cy="15.5" rx="3.2" ry="2.5" fill="#a855f7" stroke="#581c87" stroke-width="1.4"/><circle cx="3" cy="5" r="1.2" fill="#f43f5e"/><circle cx="21" cy="21" r="1.2" fill="#22c55e"/><rect x="13" y="20" width="2.2" height="2.2" fill="#facc15"/></svg>',
    mosquito: '<svg viewBox="0 0 24 24"><ellipse cx="9" cy="7" rx="5" ry="2.6" transform="rotate(-25 9 7)" fill="#e0f2fe" stroke="#475569" stroke-width="1.2"/><ellipse cx="15" cy="7" rx="5" ry="2.6" transform="rotate(25 15 7)" fill="#e0f2fe" stroke="#475569" stroke-width="1.2"/><ellipse cx="12" cy="13" rx="2.6" ry="5" fill="#57534e" stroke="#1c1917" stroke-width="1.2"/><circle cx="12" cy="7.5" r="2.2" fill="#292524"/><path d="M12 5.5V1.5M10 15l-5 4M14 15l5 4M10 12l-6 0M14 12h6" stroke="#1c1917" stroke-width="1.1" stroke-linecap="round"/></svg>',
    clipboard: '<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="19" rx="2" fill="#bfdbfe" stroke="#1e3a8a" stroke-width="1.6"/><rect x="8" y="1.5" width="8" height="4" rx="1.2" fill="#1e3a8a"/><path d="M8 11h8M8 15h8M8 19h5" stroke="#1e3a8a" stroke-width="1.6" stroke-linecap="round"/><path d="M15 17.5l1.5 1.5 3-3.5" fill="none" stroke="#16a34a" stroke-width="2" stroke-linecap="round"/></svg>',
    bus: '<svg viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="14" rx="3" fill="#facc15" stroke="#854d0e" stroke-width="1.6"/><rect x="4" y="6.5" width="5" height="5" rx="1" fill="#bae6fd" stroke="#854d0e" stroke-width="1"/><rect x="10.5" y="6.5" width="5" height="5" rx="1" fill="#bae6fd" stroke="#854d0e" stroke-width="1"/><rect x="17" y="6.5" width="3.5" height="5" rx="1" fill="#bae6fd" stroke="#854d0e" stroke-width="1"/><circle cx="7" cy="18.5" r="2.3" fill="#1f2937"/><circle cx="17" cy="18.5" r="2.3" fill="#1f2937"/></svg>',
    dog: '<svg viewBox="0 0 24 24"><ellipse cx="11" cy="15" rx="7" ry="4.5" fill="#c58a4f" stroke="#5b3a1e" stroke-width="1.5"/><circle cx="17.5" cy="9.5" r="4" fill="#d29a5e" stroke="#5b3a1e" stroke-width="1.5"/><ellipse cx="15.5" cy="8.5" rx="1.6" ry="3.2" fill="#7a4a21"/><circle cx="19" cy="9" r="0.9" fill="#1f1f1f"/><path d="M4.5 13.5L2 10" stroke="#5b3a1e" stroke-width="2" stroke-linecap="round"/><path d="M7 19v2.5M14.5 19v2.5" stroke="#5b3a1e" stroke-width="2" stroke-linecap="round"/></svg>',
    sound: '<svg viewBox="0 0 24 24"><path d="M3 9h4l5-4.5v15L7 15H3z" fill="#e2e8f0" stroke="#334155" stroke-width="1.6" stroke-linejoin="round"/><path d="M15.5 8.5c1.6 1.8 1.6 5.2 0 7M18.5 6c3 3.3 3 8.7 0 12" fill="none" stroke="#334155" stroke-width="1.8" stroke-linecap="round"/></svg>',
    lock: '<svg viewBox="0 0 24 24"><rect x="4.5" y="10.5" width="15" height="11" rx="2" fill="#fbbf24" stroke="#78350f" stroke-width="1.6"/><path d="M8 10.5V7.5a4 4 0 018 0v3" fill="none" stroke="#78350f" stroke-width="2"/><circle cx="12" cy="15.5" r="1.6" fill="#78350f"/></svg>',
    hygiene: '<svg viewBox="0 0 24 24"><path d="M12 2.5c3.5 4.6 6.5 8.2 6.5 11.7a6.5 6.5 0 01-13 0C5.5 10.7 8.5 7.1 12 2.5z" fill="#38bdf8" stroke="#075985" stroke-width="1.6" stroke-linejoin="round"/><ellipse cx="9.6" cy="14.6" rx="1.6" ry="2.4" fill="#e0f2fe"/><circle cx="18.5" cy="5" r="1.8" fill="#e0f2fe" stroke="#075985" stroke-width="1"/></svg>',
    sport: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.5" fill="#fff" stroke="#14532d" stroke-width="1.6"/><path d="M12 7.2l4 2.9-1.5 4.7h-5L8 10.1z" fill="#16a34a"/><path d="M12 2.5v4.7M16 10.1l4.6-1.6M14.5 14.8l2.8 4M9.5 14.8l-2.8 4M8 10.1l-4.6-1.6" stroke="#14532d" stroke-width="1.3"/></svg>',
    kultur: '<svg viewBox="0 0 24 24"><path d="M3 4.5c3-1.2 6.5-1.2 9.5 0v5.5c0 3.6-2.1 6.2-4.75 6.2S3 13.6 3 10z" fill="#ddd6fe" stroke="#4c1d95" stroke-width="1.5" stroke-linejoin="round"/><path d="M11.5 8.5c3-1.2 6.5-1.2 9.5 0V14c0 3.6-2.1 6.2-4.75 6.2S11.5 17.6 11.5 14z" fill="#a78bfa" stroke="#4c1d95" stroke-width="1.5" stroke-linejoin="round"/><path d="M5.2 8h1.8M8.6 8h1.8M5.8 12.2c1.2 1 2.6 1 3.8 0M13.7 12h1.8M17.1 12h1.8M14.3 17.2c1.2-1 2.6-1 3.8 0" stroke="#4c1d95" stroke-width="1.4" stroke-linecap="round"/></svg>',
    kunst: '<svg viewBox="0 0 24 24"><path d="M12 3C6.5 3 2.5 6.8 2.5 11.5c0 4.6 3.7 8.5 8.4 8.5 1.6 0 2.1-1.1 1.6-2.3-.6-1.4.2-2.8 1.8-2.8h2.3c2.9 0 5-2.1 5-4.8C21.6 6.3 17.3 3 12 3z" fill="#f5d0a9" stroke="#7c2d12" stroke-width="1.5" stroke-linejoin="round"/><circle cx="7.5" cy="10.5" r="1.7" fill="#ef4444"/><circle cx="10.5" cy="6.8" r="1.7" fill="#facc15"/><circle cx="15" cy="7" r="1.7" fill="#3b82f6"/><circle cx="17.8" cy="10.6" r="1.7" fill="#22c55e"/></svg>',
    party: '<svg viewBox="0 0 24 24"><path d="M9 15.5c1 2.5 0 4.5 1.5 6.5M15.5 13.5c-.5 3-2.5 5-3 8.5" fill="none" stroke="#7c2d12" stroke-width="1.2" stroke-linecap="round"/><ellipse cx="15.5" cy="8" rx="4.5" ry="5.5" fill="#f472b6" stroke="#831843" stroke-width="1.5"/><ellipse cx="8.5" cy="9.5" rx="4.8" ry="5.8" fill="#fb923c" stroke="#7c2d12" stroke-width="1.5"/><ellipse cx="7" cy="7.4" rx="1.2" ry="1.8" fill="#fff" opacity=".8"/></svg>',
    tree: '<svg viewBox="0 0 24 24"><rect x="10.5" y="13" width="3" height="9" rx="1" fill="#7a4a21" stroke="#4a2d14" stroke-width="1.2"/><circle cx="12" cy="9" r="6.5" fill="#4caf3f" stroke="#1f5f1a" stroke-width="1.5"/><circle cx="10" cy="7" r="2" fill="#6cc95a"/><circle cx="15" cy="10" r="1.2" fill="#ef4444"/></svg>',
    share: '<svg viewBox="0 0 24 24"><path d="M12 15V3M8 7l4-4 4 4" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 10H6a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2v-8a2 2 0 00-2-2h-2" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round"/></svg>',
  };
  const icon = (name, cls) => `<i class="ic ${cls || ''}">${IC[name] || ''}</i>`;
  const resIcon = k => icon(k === 'euro' ? 'euro' : k === 'wood' ? 'wood' : k === 'gems' ? 'gems' : 'stars');

  /* ---------- Formatierung ---------- */
  const fmt = n => Game.fmtNum(n);
  function fmtTime(sec) {
    sec = Math.max(0, Math.ceil(sec));
    if (sec < 60) return sec + ' Sek.';
    const m = Math.floor(sec / 60), s = sec % 60;
    if (sec < 3600) return m + ' Min.' + (s ? ' ' + s + ' Sek.' : '');
    const h = Math.floor(sec / 3600), mm = Math.floor(sec / 60) % 60;
    if (sec < 86400) return h + ' Std.' + (mm ? ' ' + mm + ' Min.' : '');
    const d = Math.floor(sec / 86400), hh = h % 24;
    return d + ' T.' + (hh ? ' ' + hh + ' Std.' : '');
  }
  function costHtml(cost, opts) {
    opts = opts || {};
    const keys = Object.keys(cost || {}).filter(k => cost[k]);
    if (!keys.length) return '<span class="cost free">Gratis</span>';
    return keys.map(k => {
      const lack = !opts.noCheck && (S().res[k] || 0) < cost[k];
      return `<span class="cost${lack ? ' lack' : ''}">${resIcon(k)}${fmt(cost[k])}</span>`;
    }).join('');
  }
  function gainHtml(obj) {
    return Object.keys(obj || {}).filter(k => obj[k]).map(k => `<span class="cost gain">${resIcon(k)}${obj[k] > 0 ? '+' : ''}${fmt(obj[k])}</span>`).join('') || '–';
  }
  const resName = { euro: 'Euro', wood: 'Holz', gems: 'Gems', stars: 'Sterne' };
  // "+4 Sport"-Etiketten mit Symbol, z. B. für Baukarten und die Kontextleiste
  function needTags(needs, withName) {
    return Object.keys(needs || {}).map(n => `<span class="needtag" style="--nc:${NEEDS[n].color}">${icon(n)}+${Math.round(needs[n])}${withName ? ' ' + NEEDS[n].name : ''}</span>`).join('');
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------- Haptik ---------- */
  const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  function haptic(p) {
    if (!canVibrate || !S().settings.haptics) return;
    try { navigator.vibrate(p); } catch (e) { /* ignorieren */ }
  }

  /* ---------- Toasts ---------- */
  function toast(text, kind) {
    const box = $('#toasts');
    const t = document.createElement('div');
    t.className = 'toast ' + (kind || '');
    t.innerHTML = text;
    box.appendChild(t);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => t.classList.add('out'), 2300);
    setTimeout(() => t.remove(), 2700);
  }
  function lackToast(missing) {
    const parts = Object.keys(missing || {}).map(k => `${fmt(Math.ceil(missing[k]))} ${resName[k]}`);
    toast('Dir fehlen ' + (parts.join(' und ') || 'Ressourcen'), 'bad');
    Sound.play('error'); haptic(40);
  }

  /* ---------- Modale Dialoge ---------- */
  function modal(opt) {
    if (st.modal) { st.queue.push(opt); return; }
    const m = $('#modal');
    st.modal = opt;
    opt._t = performance.now();
    m.innerHTML = `<div class="dlg ${opt.cls || ''}" role="dialog" aria-modal="true">
      <div class="dlg-head">${opt.icon ? icon(opt.icon, 'big') : ''}<h2>${opt.title}</h2>
      ${opt.noClose ? '' : `<button class="x" data-close aria-label="Schließen">${IC.close}</button>`}</div>
      <div class="dlg-body scroll">${opt.html || ''}</div>
      <div class="dlg-btns">${(opt.buttons || []).map((b, i) => `<button class="btn ${b.cls || ''}" data-i="${i}" ${b.disabled ? 'disabled' : ''}>${b.label}</button>`).join('')}</div>
    </div>`;
    m.hidden = false;
    requestAnimationFrame(() => m.classList.add('show'));
    m.onclick = e => {
      const btn = e.target.closest('button');
      // der Klick, den der Browser nach dem öffnenden Antippen nachschiebt, darf den Dialog nicht gleich schließen
      if (e.target === m && !opt.noClose) { if (performance.now() - opt._t > 450) closeModal(); return; }
      if (!btn) { if (opt.onClickBody) opt.onClickBody(e); return; }
      Sound.play('tap');
      if (btn.hasAttribute('data-close')) { closeModal(); return; }
      if (btn.dataset.i != null) {
        const b = opt.buttons[+btn.dataset.i];
        const keep = b.onClick ? b.onClick() : false;
        if (keep !== true) closeModal();
      } else if (opt.onClickBody) opt.onClickBody(e);
    };
    if (opt.onOpen) opt.onOpen(m);
    Sound.play('open');
  }
  function closeModal() {
    const m = $('#modal');
    const opt = st.modal;
    m.classList.remove('show');
    m.hidden = true;
    m.innerHTML = '';
    st.modal = null;
    if (opt && opt.onClose) opt.onClose();
    if (st.queue.length) setTimeout(() => { if (!st.modal && st.queue.length) modal(st.queue.shift()); }, 180);
  }

  /* ---------- Bottom Sheets ---------- */
  function openSheet(name) {
    if (st.placing) cancelPlacing();
    deselect();
    st.sheet = name;
    const sh = $('#sheet');
    sh.hidden = false;
    $('#sheetBg').hidden = false;
    renderSheet();
    requestAnimationFrame(() => { sh.classList.add('show'); $('#sheetBg').classList.add('show'); });
    document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.nav === name));
    Sound.play('open');
  }
  function closeSheet() {
    const sh = $('#sheet');
    sh.classList.remove('show');
    $('#sheetBg').classList.remove('show');
    st.sheet = null;
    document.querySelectorAll('#nav button').forEach(b => b.classList.remove('on'));
    setTimeout(() => { if (!st.sheet) { sh.hidden = true; sh.innerHTML = ''; $('#sheetBg').hidden = true; } }, 250);
  }
  function sheetFrame(title, iconName, tabs, active, body, bodyCls) {
    return `<div class="sheet-head">${icon(iconName, 'big')}<h2>${title}</h2><button class="x" data-close aria-label="Schließen">${IC.close}</button></div>
      ${tabs ? `<div class="tabs scroll">${tabs.map(t => `<button class="tab ${t.id === active ? 'on' : ''}" data-tab="${t.id}">${t.icon ? icon(t.icon) : ''}${t.name}${t.badge ? `<span class="badge">${t.badge}</span>` : ''}</button>`).join('')}</div>` : ''}
      <div class="sheet-body scroll ${bodyCls || ''}">${body}</div>`;
  }
  function renderSheet(newTab) {
    const sh = $('#sheet');
    const same = sh.dataset.name === st.sheet;
    const scrollEl = sh.querySelector('.sheet-body'), tabsEl = sh.querySelector('.tabs');
    const keepScroll = scrollEl && same && !newTab ? scrollEl.scrollTop : 0;
    const keepTabs = tabsEl && same ? tabsEl.scrollLeft : 0;
    sh.dataset.name = st.sheet;
    const html = st.sheet === 'build' ? buildSheet() : st.sheet === 'shop' ? shopSheet() : st.sheet === 'quests' ? questSheet() : settingsSheet();
    sh.innerHTML = html;
    sh._html = html;
    if (st.sheet === 'build') attachThumbs(sh);
    const body = sh.querySelector('.sheet-body');
    if (body) body.scrollTop = keepScroll;
    // Reiterleiste: Position halten und den aktiven Reiter sichtbar machen
    const tabs = sh.querySelector('.tabs'), on = tabs && tabs.querySelector('.tab.on');
    if (tabs) tabs.scrollLeft = keepTabs;
    if (on) {
      const r = on.getBoundingClientRect(), bx = tabs.getBoundingClientRect();
      if (r.right > bx.right - 12) tabs.scrollLeft += r.right - bx.right + 12;
      else if (r.left < bx.left + 12) tabs.scrollLeft -= bx.left + 12 - r.left;
    }
  }

  // Bauen
  const thumbs = new Map();
  function thumbFor(type) {
    if (!thumbs.has(type)) thumbs.set(type, Render.thumb(type, 1, 78));
    return thumbs.get(type);
  }
  function attachThumbs(root) {
    root.querySelectorAll('[data-thumb]').forEach(el => {
      const cv = thumbFor(el.dataset.thumb);
      el.appendChild(cv);
    });
  }
  function buildSheet() {
    const cat = st.sheetTab.build || 'pitch';
    const types = Object.keys(BUILDINGS).filter(k => BUILDINGS[k].cat === cat && BUILDINGS[k].buildable !== false);
    const cards = types.map(type => {
      const d = BUILDINGS[type];
      const unlocked = Game.isUnlocked(type);
      const count = Game.countOf(type), max = Game.maxCount(type);
      const cost = Game.costFor(type, 1);
      const time = Game.timeFor(type, 1);
      const full = unlocked && count >= max;
      let foot = '';
      if (!unlocked && d.unlock > S().rl + 1) {
        return `<button class="card locked secret" data-build="${type}">
          <div class="thumb secret-q">?</div>
          <div class="card-name">Geheim</div>
          <div class="card-info">Noch unbekannt</div>
          <div class="lockline">${icon('lock')}Rezeption Lv. ${d.unlock}</div></button>`;
      }
      if (!unlocked) foot = `<div class="lockline">${icon('lock')}Rezeption Lv. ${d.unlock}</div>`;
      else if (full) foot = `<div class="lockline">Maximum erreicht</div>`;
      else foot = `<div class="card-cost">${costHtml(cost)}</div>`;
      return `<button class="card ${!unlocked || full ? 'locked' : ''}" data-build="${type}">
        <div class="thumb" data-thumb="${type}"></div>
        <div class="card-name">${d.name}</div>
        ${d.needs || d.produces ? `<div class="needtags">${needTags(d.needs)}${d.produces ? `<span class="needtag">${resIcon(d.produces)}${fmt(Game.baseRate(type, 1))}/h</span>` : ''}</div>` : ''}
        <div class="card-info">${[unlocked ? `${count}/${max}` : '', time ? fmtTime(time) : 'sofort'].filter(Boolean).join(' · ')}</div>
        ${foot}</button>`;
    }).join('');
    return sheetFrame('Bauen', 'build', CATEGORIES.map(c => ({ id: c.id, name: c.name, icon: c.icon })), cat, `<div class="grid">${cards}</div>`);
  }

  // Shop
  function shopSheet() {
    const now = Date.now();
    const boosts = Object.keys(S().boosts).filter(k => S().boosts[k].until > now).map(k => {
      const item = SHOP.find(i => i.boost && i.boost.key === k);
      return `<div class="boost">${icon(item ? item.icon : 'bolt')}<b>${item ? item.name : k}</b><span data-boost="${k}">${fmtTime((S().boosts[k].until - now) / 1000)}</span></div>`;
    }).join('');
    const items = SHOP.map(item => {
      const price = Game.shopPrice(item);
      const give = Game.shopGive(item);
      let desc = item.desc;
      if (give) desc = Object.keys(give).map(k => `+${fmt(give[k])} ${resName[k]}`).join(', ') + ' sofort.';
      if (item.id === 'wood_euro' || item.id === 'euro_wood') desc = `Tausche ${costHtml(price, { noCheck: true })} gegen ${gainHtml(give)}`;
      if (item.kind === 'builder') desc = `${item.desc} Du hast ${S().builders} von ${CONFIG.maxBuilders}.`;
      return `<div class="row">
        <div class="row-ic">${icon(item.icon, 'big')}</div>
        <div class="row-main"><b>${item.name}</b><small>${desc}</small></div>
        ${price ? `<button class="btn green small" data-buy="${item.id}">${costHtml(price)}</button>` : '<span class="done-tag">Max.</span>'}
      </div>`;
    }).join('');
    const note = '<p class="hint">Gems gibt es nur für Erfolge und die tägliche Belohnung – echtes Geld brauchst du hier nie.</p>';
    return sheetFrame('Shop', 'shop', null, null, (boosts ? `<div class="boosts">${boosts}</div>` : '') + items + note, 'cols');
  }

  // Aufträge, Erfolge, Tagesbonus
  function questSheet() {
    const tab = st.sheetTab.quests || 'quests';
    const qDone = S().quests.filter(q => Game.questInfo(q).done).length;
    const aDone = ACHIEVEMENTS.filter(a => Game.achievementInfo(a).claimable).length;
    const daily = Game.dailyStatus();
    const tabs = [
      { id: 'quests', name: 'Aufträge', badge: qDone },
      { id: 'ach', name: 'Erfolge', badge: aDone },
      { id: 'daily', name: 'Bonus', badge: daily.claimable ? 1 : 0 },
    ];
    let body = '';
    if (tab === 'quests') {
      body = S().quests.map(q => {
        const qi = Game.questInfo(q);
        const pct = Math.min(100, qi.cur / qi.n * 100);
        return `<div class="row quest ${qi.done ? 'ready' : ''}">
          <div class="row-main"><b>${esc(qi.text)}</b>
            <div class="progress"><i style="width:${pct}%"></i><span>${fmt(qi.cur)} / ${fmt(qi.n)}</span></div>
            <small>Belohnung: ${gainHtml(qi.reward)}</small></div>
          ${qi.done ? `<button class="btn green small" data-claimq="${q.uid}">Abholen</button>` : ''}
        </div>`;
      }).join('') || '<p class="hint">Gerade keine Aufträge – schau später wieder vorbei.</p>';
      body += '<p class="hint">Neue Aufträge erscheinen, sobald du einen abholst. Sie wachsen mit deinem Rezeptionslevel.</p>';
    } else if (tab === 'ach') {
      body = ACHIEVEMENTS.map(a => {
        const ai = Game.achievementInfo(a);
        const stars = a.tiers.map((_, i) => `<i class="tier ${i < ai.tier ? 'on' : ''}">${IC.stars}</i>`).join('');
        const pct = ai.complete ? 100 : Math.min(100, ai.val / ai.next * 100);
        return `<div class="row ach ${ai.claimable ? 'ready' : ''}">
          <div class="row-main"><b>${a.name} <span class="tiers">${stars}</span></b>
          <small>${ai.complete ? 'Alle Stufen geschafft!' : esc(ai.text)}</small>
          ${ai.complete ? '' : `<div class="progress"><i style="width:${pct}%"></i><span>${fmt(Math.min(ai.val, ai.next))} / ${fmt(ai.next)}</span></div>`}</div>
          ${ai.claimable ? `<button class="btn green small" data-claima="${a.id}">${icon('gems')}${ai.gems}</button>` : ai.complete ? '' : `<span class="cost">${icon('gems')}${ai.gems}</span>`}
        </div>`;
      }).join('');
    } else {
      const cur = daily.claimable ? daily.idx : -1;
      const doneUpTo = daily.claimable ? daily.idx - 1 : daily.idx;
      body = `<p class="hint">Komm jeden Tag vorbei! Wer einen Tag auslässt, beginnt wieder bei Tag 1.</p><div class="daily">` + DAILY.map((r, i) => {
        const rew = Game.scaled(r);
        const cls = i === cur ? 'today' : i <= doneUpTo ? 'got' : '';
        return `<div class="day ${cls}"><small>Tag ${i + 1}</small>${Object.keys(rew).map(k => `<div>${resIcon(k)}${fmt(rew[k])}</div>`).join('')}${i <= doneUpTo ? `<em>${IC.check}</em>` : ''}</div>`;
      }).join('') + '</div>' + (daily.claimable
        ? `<button class="btn green wide" data-daily>Belohnung abholen</button>`
        : `<p class="hint center">Heute schon abgeholt – Serie: ${daily.streak} ${daily.streak === 1 ? 'Tag' : 'Tage'}. Bis morgen!</p>`);
    }
    return sheetFrame('Aufträge', 'quests', tabs, tab, body, tab === 'daily' ? '' : 'cols');
  }

  // Einstellungen
  function settingsSheet() {
    const s = S().settings;
    const tog = (key, label, sub, disabled) => `<label class="row toggle ${disabled ? 'dis' : ''}"><div class="row-main"><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</div>
      <input type="checkbox" data-set="${key}" ${s[key] ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span class="sw"></span></label>`;
    const standalone = window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
    return sheetFrame('Einstellungen', 'settings', null, null, `
      ${tog('sound', 'Soundeffekte', 'Klänge beim Bauen, Einsammeln und mehr')}
      ${tog('ambient', 'Naturgeräusche', 'Vogelgezwitscher am Tag, Grillen in der Nacht')}
      ${tog('haptics', 'Vibration', canVibrate ? 'Kurzes Feedback bei Aktionen' : 'Wird von diesem Gerät nicht unterstützt', !canVibrate)}
      ${tog('hq', 'Hohe Bildqualität', 'Volle Retina-Auflösung (mehr Akkuverbrauch)')}
      ${tog('realTime', 'Echte Tageszeit', 'Tag & Nacht folgen deiner Uhr statt einem 12-Minuten-Zyklus')}
      ${standalone ? '' : `<div class="row info"><div class="row-ic">${icon('share', 'big')}</div><div class="row-main"><b>Als App installieren</b><small>Tippe in Safari auf „Teilen“ und dann auf „Zum Home-Bildschirm“. Danach startet der Campingplatz im Vollbild und funktioniert offline.</small></div></div>`}
      <div class="row"><div class="row-main"><b>Spielstand sichern</b><small>Kopiert einen Code, mit dem du deinen Platz wiederherstellen kannst.</small></div><button class="btn small" data-export>Kopieren</button></div>
      <div class="row"><div class="row-main"><b>Spielstand laden</b><small>Füge einen gesicherten Code ein.</small></div><button class="btn small" data-import>Einfügen</button></div>
      <div class="row"><div class="row-main"><b>Neu beginnen</b><small>Löscht deinen Campingplatz unwiderruflich.</small></div><button class="btn red small" data-reset>Zurücksetzen</button></div>
      <button class="btn wide" data-help>Spielanleitung</button>
      <p class="hint center">Campingplatz-Simulator · Version 1.2<br>Gespeichert wird automatisch auf diesem Gerät.</p>`, 'cols');
  }

  function onSheetClick(e) {
    const t = e.target;
    if (t.closest('[data-close]')) { Sound.play('close'); closeSheet(); return; }
    const tab = t.closest('[data-tab]');
    if (tab) { st.sheetTab[st.sheet] = tab.dataset.tab; Sound.play('tap'); renderSheet(true); return; }
    const card = t.closest('[data-build]');
    if (card) { tryStartPlacing(card.dataset.build); return; }
    const buy = t.closest('[data-buy]');
    if (buy) {
      const r = Game.buy(buy.dataset.buy);
      if (r.ok) {
        Sound.play('coin'); haptic(20);
        const item = SHOP.find(i => i.id === buy.dataset.buy);
        toast(item.kind === 'builder' ? 'Neuer Bauarbeiter eingestellt!' : item.boost ? `${item.name} aktiv!` : `Gekauft: ${gainHtml(r.got)}`, 'good');
        renderSheet();
      } else if (r.missing) lackToast(r.missing);
      else { toast(r.reason, 'bad'); Sound.play('error'); }
      return;
    }
    const cq = t.closest('[data-claimq]');
    if (cq) {
      const got = Game.claimQuest(+cq.dataset.claimq);
      if (got) { Sound.play('done'); haptic(25); toast(`Auftrag erledigt! ${gainHtml(got)}`, 'good'); renderSheet(); }
      return;
    }
    const ca = t.closest('[data-claima]');
    if (ca) {
      const got = Game.claimAchievement(ca.dataset.claima);
      if (got) { Sound.play('gem'); haptic(25); toast(`Erfolg! ${gainHtml(got)}`, 'good'); renderSheet(); }
      return;
    }
    if (t.closest('[data-daily]')) { claimDaily(); renderSheet(); return; }
    if (t.closest('[data-reset]')) { confirmReset(); return; }
    if (t.closest('[data-help]')) { showHelp(); return; }
    if (t.closest('[data-export]')) { exportSave(); return; }
    if (t.closest('[data-import]')) { importSave(); return; }
  }
  function onSheetChange(e) {
    const key = e.target.dataset.set;
    if (!key) return;
    S().settings[key] = e.target.checked;
    if (key === 'hq') Render.resize(true);
    if (key === 'sound' && e.target.checked) Sound.play('pop');
    if (key === 'haptics' && e.target.checked) haptic(30);
    Game.save();
  }

  function exportSave() {
    Game.save();
    let code = '';
    try { code = btoa(unescape(encodeURIComponent(localStorage.getItem(CONFIG.saveKey) || ''))); } catch (e) { code = ''; }
    const done = () => toast('Code in die Zwischenablage kopiert.', 'good');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(done, () => window.prompt('Diesen Code sicher aufbewahren:', code));
    else window.prompt('Diesen Code sicher aufbewahren:', code);
  }
  function importSave() {
    const code = window.prompt('Gesicherten Code einfügen:');
    if (!code) return;
    try {
      const json = decodeURIComponent(escape(atob(code.trim())));
      const data = JSON.parse(json);
      if (!data || !Array.isArray(data.buildings)) throw new Error('ungültig');
      Game.lockSave(); // sonst überschreibt das Autospeichern beim Neuladen den importierten Stand
      localStorage.setItem(CONFIG.saveKey, json);
      location.reload();
    } catch (e) { toast('Dieser Code ist leider ungültig.', 'bad'); Sound.play('error'); }
  }
  function confirmReset() {
    modal({
      title: 'Wirklich neu beginnen?', icon: 'trash',
      html: '<p>Dein gesamter Campingplatz, alle Ressourcen und Erfolge werden gelöscht.</p>',
      buttons: [{ label: 'Abbrechen' }, { label: 'Alles löschen', cls: 'red', onClick: () => { Game.resetAll(); closeSheet(); afterReset(); } }],
    });
  }
  function afterReset() {
    deselect();
    centerOnReception(0.85);
    toast('Ein neuer Campingplatz wartet auf dich!', 'good');
  }

  /* ---------- Auswahl & Kontextleiste ---------- */
  function select(b) {
    if (!b) { deselect(); return; }
    st.selectedId = b.id;
    renderCtx();
    Sound.play('tap');
  }
  function deselect() {
    st.selectedId = null;
    const c = $('#ctx');
    c.hidden = true;
    c.innerHTML = '';
  }
  function ctxButton(act, ic, label, extra, cls) {
    return { act, ic, label, extra: extra || '', cls: cls || '' };
  }
  function renderCtx() {
    const b = st.selectedId && Game.getBuilding(st.selectedId);
    const c = $('#ctx');
    if (!b || st.placing || st.drag) { c.hidden = true; return; }
    const d = Game.def(b.type);
    let sub = '';
    const btns = [];
    if (d.cat === 'obstacle') {
      const loot = Game.obstacleLoot(b), cost = Game.obstacleCost(b);
      sub = b.type === 'obs_chest' ? `Öffnen bringt ${gainHtml(loot)}` : b.type === 'obs_ruin' ? `Restaurieren bringt ${gainHtml(loot)}` : `Räumen bringt ${gainHtml(loot) || 'Platz'}`;
      btns.push(ctxButton('clear', b.type === 'obs_chest' ? 'gift' : b.type === 'obs_ruin' ? 'build' : 'axe', b.type === 'obs_chest' ? 'Öffnen' : b.type === 'obs_ruin' ? 'Restaurieren' : 'Räumen', Object.keys(cost).length ? costHtml(cost) : 'gratis', 'green'));
    } else {
      if (b.build) {
        const rem = Game.remaining(b);
        const g = Game.speedUpCost(b.id);
        sub = (b.level === 0 ? 'Wird gebaut' : `Verbesserung auf Lv. ${b.build.to}`) + ` · noch ${fmtTime(rem)}`;
        btns.push(ctxButton('info', 'info', 'Info'));
        btns.push(ctxButton('speed', 'bolt', 'Fertig', g ? `${icon('gems')}${g}` : 'Gratis', 'gold'));
      } else {
        const parts = [];
        if (d.produces) parts.push(`${fmt(Game.rateOf(b))} ${d.produces === 'euro' ? '€' : 'Holz'}/Std.`);
        if (d.guests) parts.push(`${d.guests} Gäste`);
        if (d.needs) parts.push(needTags(Game.needsOf(b.type, b.level), true));
        sub = parts.join(' · ');
        if (d.cat === 'deco') sub = d.desc;
        btns.push(ctxButton('info', 'info', 'Info'));
        if (d.cat !== 'deco') {
          const chk = Game.upgradeCheck(b.id);
          if (chk.max) btns.push(ctxButton('upgrade', 'up', 'Max. Level', '', 'off'));
          else if (chk.locked) btns.push(ctxButton('upgrade', 'lock', 'Verbessern', `Rez. Lv. ${b.level + 1 - CONFIG.levelCapOffset}`, 'off'));
          else btns.push(ctxButton('upgrade', 'up', 'Verbessern', costHtml(Game.costFor(b.type, b.level + 1)), 'green'));
        }
        if (Game.canCollect(b)) btns.push(ctxButton('collect', d.produces === 'wood' ? 'wood' : 'collect', 'Einsammeln', fmt(b.stored)));
      }
      btns.push(ctxButton('move', 'move', 'Verschieben'));
      if (d.cat === 'deco') btns.push(ctxButton('demolish', 'trash', 'Entfernen', '', 'red'));
    }
    const lvl = d.cat === 'deco' || d.cat === 'obstacle' ? '' : `<span class="lvl">Level ${Math.max(1, b.level)}</span>`;
    // Nur neu aufbauen, wenn sich die Knöpfe ändern – sonst gehen Taps während eines Updates verloren
    const key = b.id + d.name + lvl + btns.map(x => x.act + x.ic + x.label + x.cls).join();
    if (c.hidden || c._key !== key) {
      c.innerHTML = `<div class="ctx-head"><b>${d.name}</b>${lvl}</div><div class="ctx-sub">${sub}</div><div class="ctx-btns">${btns.map(x =>
        `<button class="cbtn ${x.cls}" data-act="${x.act}">${icon(x.ic, 'big')}<span>${x.label}</span><em>${x.extra}</em></button>`).join('')}</div>`;
      c._key = key;
      c._sub = sub;
      c._extra = btns.map(x => x.extra);
    } else {
      if (c._sub !== sub) { c.querySelector('.ctx-sub').innerHTML = sub; c._sub = sub; }
      const ems = c.querySelectorAll('.cbtn em');
      btns.forEach((x, i) => { if (c._extra[i] !== x.extra && ems[i]) { ems[i].innerHTML = x.extra; c._extra[i] = x.extra; } });
    }
    c.hidden = false;
  }
  function onCtxClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const b = Game.getBuilding(st.selectedId);
    if (!b) return;
    Sound.play('tap');
    switch (btn.dataset.act) {
      case 'info': showInfo(b); break;
      case 'upgrade': showUpgrade(b); break;
      case 'speed': speedUp(b); break;
      case 'collect': collect(b); break;
      case 'move': startMove(b); break;
      case 'clear': {
        const r = Game.removeObstacle(b.id);
        if (r.ok) {
          const d = Game.def(b.type);
          Render.puff(b.gx, b.gy, d.w, d.d);
          Sound.play('wood'); haptic(30);
          if (r.got && r.got.wood) { Render.flyRes(b.gx + 0.5, b.gy + 0.5, 20, 'wood', 4); Render.floatText(b.gx + 0.5, b.gy + 0.5, 30, `+${r.got.wood} Holz`, '#fde68a'); }
          if (r.got && r.got.euro) { Render.flyRes(b.gx + 0.5, b.gy + 0.5, 20, 'euro', 5); setTimeout(() => Render.floatText(b.gx + 0.5, b.gy + 0.5, 30, `+${fmt(r.got.euro)} €`, '#bbf7d0'), 300); }
          if (r.got && r.got.stars) { Render.floatText(b.gx + 1, b.gy + 1, 50, `+${r.got.stars} ★`, '#fde047'); Sound.play('star'); }
          if (b.type === 'obs_chest' || b.type === 'obs_ruin') { Render.confetti(b.gx, b.gy, d.w, d.d, 20); Sound.play('done'); }
          deselect();
        } else if (r.missing) lackToast(r.missing);
        break;
      }
      case 'demolish': {
        const r = Game.demolish(b.id);
        if (r.ok) { Render.puff(b.gx, b.gy, 1, 1); Sound.play('pop'); deselect(); }
        break;
      }
    }
  }

  function statLines(type, L) {
    const d = Game.def(type);
    const out = [];
    if (d.produces) out.push([d.produces === 'euro' ? 'Einnahmen (Basis)' : 'Holzproduktion', `${fmt(Game.baseRate(type, L))} / Std.`]);
    if (d.produces) out.push(['Speicher', `${fmt(Game.baseRate(type, L) * CONFIG.buildingStorageHours * 1.5)}`]);
    if (d.guests) out.push(['Gäste-Kapazität', d.guests]);
    const nv = Game.needsOf(type, L);
    for (const n of NEED_ORDER) if (nv[n]) out.push([`${icon(n)} ${NEEDS[n].name}`, `+${Math.round(nv[n])}`]);
    if (type === 'reception') {
      out.push(['Grundstücke kaufbar (gesamt)', CONFIG.land.permits[L - 1]]);
      out.push(['Lager Euro', fmt(CONFIG.storage.euro[L - 1])]);
      out.push(['Lager Holz', fmt(CONFIG.storage.wood[L - 1])]);
      out.push(['Max. Gebäudelevel', Math.min(10, L + CONFIG.levelCapOffset)]);
    }
    if (d.decor) out.push(['Deko-Punkte', d.decor]);
    return out;
  }
  function showInfo(b) {
    const d = Game.def(b.type);
    const L = Math.max(1, b.level);
    const rows = statLines(b.type, L).map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('');
    let extra = '';
    if (d.cat === 'pitch') {
      const owner = Game.G.pitchOwner.get(b.id);
      const g = owner && Game.G.guests.find(x => x.id === owner);
      extra = `<p class="hint">${g ? `Belegt von <b>${esc(g.name)}</b>.` : 'Gerade frei – neue Gäste kommen bald.'}</p>`;
    }
    if (d.produces === 'euro') extra += `<p class="hint">Aktuell ${fmt(Game.rateOf(b))} €/Std. inkl. Zufriedenheit, Sterne-Bonus und Ereignissen.</p>`;
    modal({ title: d.name + (d.cat === 'deco' ? '' : ` · Level ${L}`), icon: 'info', cls: 'wide', html: `<div class="two thumbcol"><div class="info-thumb" data-thumbinfo></div><div><p>${d.desc || ''}</p><table class="stats">${rows}</table>${extra}</div></div>`,
      onOpen: m => { const el = m.querySelector('[data-thumbinfo]'); if (el) el.appendChild(Render.thumb(b.type, L, 120)); } });
  }
  function showUpgrade(b) {
    const d = Game.def(b.type);
    const chk = Game.upgradeCheck(b.id);
    if (chk.max) { toast('Maximales Level erreicht.'); return; }
    if (chk.locked) { toast(chk.reason, 'bad'); Sound.play('error'); return; }
    const L = b.level, N = L + 1;
    const cur = statLines(b.type, L), nxt = statLines(b.type, N);
    const rows = nxt.map((r, i) => `<tr><td>${r[0]}</td><td>${cur[i] ? cur[i][1] : ''}</td><td class="up">→ ${r[1]}</td></tr>`).join('');
    let unlocks = '';
    if (b.type === 'reception') {
      const list = Object.keys(BUILDINGS).filter(k => BUILDINGS[k].unlock === N && BUILDINGS[k].buildable !== false).map(k => BUILDINGS[k].name);
      if (list.length) unlocks = `<p><b>Schaltet frei:</b> ${list.join(', ')}</p>`;
    }
    const cost = Game.costFor(b.type, N), time = Game.timeFor(b.type, N);
    modal({
      title: `${d.name} → Level ${N}`, icon: 'up',
      html: `<table class="stats three">${rows}</table>${unlocks}<p class="center">Bauzeit: <b>${fmtTime(time)}</b></p>${Game.freeBuilders() <= 0 ? '<p class="warn">Alle Bauarbeiter sind beschäftigt.</p>' : ''}`,
      buttons: [{ label: 'Abbrechen' }, {
        label: `Verbessern ${costHtml(cost)}`, cls: 'green', onClick: () => {
          const r = Game.upgrade(b.id);
          if (r.ok) { Sound.play('build'); haptic(30); Render.puff(b.gx, b.gy, d.w, d.d); renderCtx(); }
          else if (r.missing) lackToast(r.missing);
          else { toast(r.reason, 'bad'); Sound.play('error'); if (r.builders) offerBuilder(); }
        },
      }],
    });
  }
  function speedUp(b) {
    const g = Game.speedUpCost(b.id);
    const run = () => {
      const r = Game.speedUp(b.id);
      if (r.ok) { Sound.play('gem'); haptic(30); renderCtx(); }
      else { toast('Nicht genug Gems. Hol dir welche über Erfolge und die Tagesbelohnung!', 'bad'); Sound.play('error'); }
    };
    if (g === 0) { run(); return; }
    modal({ title: 'Sofort fertigstellen?', icon: 'bolt', html: `<p class="center">Für <b>${g}</b> Gems ist der Bau sofort fertig.<br><small>Du hast ${fmt(S().res.gems)} Gems.</small></p>`,
      buttons: [{ label: 'Abbrechen' }, { label: `Fertig ${icon('gems')}${g}`, cls: 'gold', disabled: S().res.gems < g, onClick: run }] });
  }
  function offerBuilder() {
    const item = SHOP.find(i => i.kind === 'builder');
    const price = Game.shopPrice(item);
    const busy = S().buildings.filter(x => x.build);
    const fastest = busy.sort((p, q) => p.build.end - q.build.end)[0];
    modal({
      title: 'Alle Bauarbeiter beschäftigt', icon: 'hammer',
      html: `<p>Warte, bis ein Bau fertig ist${fastest ? ` (nächster in ${fmtTime(Game.remaining(fastest))})` : ''}, beschleunige ihn – oder stelle einen weiteren Bauarbeiter ein.</p>`,
      buttons: [
        { label: 'OK' },
        ...(fastest ? [{ label: 'Nächsten beschleunigen', cls: 'gold', onClick: () => { st.selectedId = fastest.id; speedUp(fastest); } }] : []),
        ...(price ? [{ label: `Bauarbeiter ${costHtml(price)}`, cls: 'green', onClick: () => openSheet('shop') }] : []),
      ],
    });
  }

  function collect(b) {
    const d = Game.def(b.type);
    const r = Game.collect(b.id);
    if (!r) return false;
    if (r.full) {
      toast(`${resName[r.res]}-Lager voll! Verbessere die Rezeption für mehr Platz.`, 'bad');
      Sound.play('error'); haptic(40);
      return true;
    }
    Render.flyRes(b.gx + d.w / 2, b.gy + d.d / 2, d.height * 0.8, r.res, Math.ceil(Math.log2(r.amount + 1)), () => bump(r.res));
    Render.floatText(b.gx + d.w / 2, b.gy + d.d / 2, d.height + 10, `+${fmt(r.amount)}${r.res === 'euro' ? ' €' : ''}`, r.res === 'euro' ? '#fde047' : '#fed7aa');
    Sound.play(r.res === 'euro' ? 'coin' : 'wood');
    haptic(12);
    return true;
  }
  function bump(res) {
    const el = hud[res + 'Box'];
    if (!el) return;
    el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
  }

  /* ---------- Platzieren & Verschieben ---------- */
  function findSpot(type, cx, cy, ignoreId) {
    const d = Game.def(type);
    const sx = Math.round(cx - d.w / 2), sy = Math.round(cy - d.d / 2);
    for (let r = 0; r < 26; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (Game.canPlace(type, sx + dx, sy + dy, ignoreId)) return { x: sx + dx, y: sy + dy };
      }
    }
    return { x: sx, y: sy };
  }
  function tryStartPlacing(type) {
    const chk = Game.placeCheck(type);
    if (!chk.ok) {
      if (chk.missing) lackToast(chk.missing);
      else if (chk.builders) { closeSheet(); offerBuilder(); }
      else { toast(chk.reason, 'bad'); Sound.play('error'); }
      return;
    }
    closeSheet();
    const { W, H } = Render.size;
    const g = Render.screenToGrid(W / 2, H * 0.55);
    const spot = findSpot(type, g.x, g.y);
    st.placing = { type, gx: spot.x, gy: spot.y, moveId: null };
    deselect();
    renderPlaceBar();
    Sound.play('pick');
  }
  function startMove(b) {
    st.placing = { type: b.type, gx: b.gx, gy: b.gy, moveId: b.id, level: b.level };
    $('#ctx').hidden = true;
    renderPlaceBar();
    Sound.play('pick'); haptic(15);
  }
  function placingValid() {
    const p = st.placing;
    return p && Game.canPlace(p.type, p.gx, p.gy, p.moveId);
  }
  function renderPlaceBar() {
    const p = st.placing;
    const bar = $('#place');
    if (!p) { bar.hidden = true; return; }
    const d = Game.def(p.type);
    const info = p.moveId ? 'Verschieben' : costHtml(Game.costFor(p.type, 1));
    bar.innerHTML = `<button class="round red" data-pl="cancel" aria-label="Abbrechen">${IC.close}</button>
      <div class="pl-mid"><b>${d.name}</b><small>${info}</small><small class="pl-hint">Ziehe das Gebäude an seinen Platz</small></div>
      <button class="round green" data-pl="ok" aria-label="Bestätigen">${IC.check}</button>`;
    bar.hidden = false;
  }
  function cancelPlacing() {
    const moveId = st.placing && st.placing.moveId;
    st.placing = null;
    $('#place').hidden = true;
    if (moveId) select(Game.getBuilding(moveId));
  }
  function confirmPlacing() {
    const p = st.placing;
    if (!p) return;
    if (!placingValid()) { toast('Hier ist kein Platz.', 'bad'); Sound.play('error'); haptic(40); return; }
    const d = Game.def(p.type);
    if (p.moveId) {
      Game.moveBuilding(p.moveId, p.gx, p.gy);
      Render.puff(p.gx, p.gy, d.w, d.d);
      Sound.play('drop'); haptic(20);
      const id = p.moveId;
      st.placing = null; $('#place').hidden = true;
      select(Game.getBuilding(id));
      return;
    }
    const r = Game.placeNew(p.type, p.gx, p.gy);
    if (!r.ok) {
      if (r.missing) lackToast(r.missing); else { toast(r.reason, 'bad'); Sound.play('error'); }
      if (r.builders) { st.placing = null; $('#place').hidden = true; offerBuilder(); }
      return;
    }
    Render.puff(p.gx, p.gy, d.w, d.d);
    Sound.play(d.cat === 'deco' ? 'drop' : 'build'); haptic(25);
    // Deko: direkt weiter platzieren (z. B. Wege & Zäune ziehen)
    if (d.cat === 'deco' && Game.placeCheck(p.type).ok) {
      const dirs = p.last ? [[p.gx - p.last.x, p.gy - p.last.y]] : [];
      dirs.push([1, 0], [0, 1], [-1, 0], [0, -1]);
      const prev = { x: p.gx, y: p.gy };
      for (const [dx, dy] of dirs) {
        if (Math.abs(dx) + Math.abs(dy) !== 1) continue;
        if (Game.canPlace(p.type, p.gx + dx, p.gy + dy)) { p.gx += dx; p.gy += dy; break; }
      }
      p.last = prev;
      if (p.gx === prev.x && p.gy === prev.y) { const s = findSpot(p.type, p.gx, p.gy); p.gx = s.x; p.gy = s.y; }
      renderPlaceBar();
      return;
    }
    st.placing = null;
    $('#place').hidden = true;
    select(r.b);
  }

  /* ---------- Eingabe: Ziehen, Zoomen, Tippen, Gedrückthalten ---------- */
  const inp = { pointers: new Map(), mode: 'none', sx: 0, sy: 0, lx: 0, ly: 0, t0: 0, timer: 0, cand: null, vx: 0, vy: 0, pd: 0, px: 0, py: 0, grab: null, lastTile: null };
  const SLOP = 9, LONG = 430;
  function localXY(e) { return { x: e.clientX, y: e.clientY }; }
  function ghostHit(x, y) {
    const p = st.placing;
    if (!p) return false;
    const d = Game.def(p.type);
    const g = Render.screenToGrid(x, y + 8);
    return g.x >= p.gx - 0.4 && g.x <= p.gx + d.w + 0.4 && g.y >= p.gy - 0.4 && g.y <= p.gy + d.d + 0.4;
  }
  function onDown(e) {
    Sound.unlock();
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    const { x, y } = localXY(e);
    inp.pointers.set(e.pointerId, { x, y });
    inp.vx = inp.vy = 0;
    if (inp.pointers.size === 1) {
      inp.sx = inp.lx = x; inp.sy = inp.ly = y; inp.t0 = performance.now();
      inp.mode = 'press';
      inp.cand = null;
      if (st.placing && ghostHit(x, y)) {
        const g = Render.screenToGrid(x, y);
        inp.mode = 'ghost';
        inp.grab = { x: g.x - st.placing.gx, y: g.y - st.placing.gy };
        inp.lastTile = null;
        return;
      }
      if (!st.placing) {
        const hit = Render.hitBuilding(x, y);
        if (hit && Game.def(hit.type).cat !== 'obstacle') {
          inp.cand = hit;
          clearTimeout(inp.timer);
          inp.timer = setTimeout(() => { if (inp.mode === 'press' && inp.cand) startDrag(inp.cand, inp.lx, inp.ly); }, LONG);
        }
      }
    } else if (inp.pointers.size === 2) {
      clearTimeout(inp.timer);
      if (inp.mode === 'drag') cancelDrag();
      const [a, b] = [...inp.pointers.values()];
      inp.mode = 'pinch';
      inp.pd = Math.hypot(a.x - b.x, a.y - b.y);
      inp.px = (a.x + b.x) / 2; inp.py = (a.y + b.y) / 2;
    }
  }
  function onMove(e) {
    if (!inp.pointers.has(e.pointerId)) return;
    const { x, y } = localXY(e);
    inp.pointers.set(e.pointerId, { x, y });
    const now = performance.now();
    switch (inp.mode) {
      case 'press':
        if (Math.hypot(x - inp.sx, y - inp.sy) > SLOP) {
          clearTimeout(inp.timer);
          if (inp.cand && inp.cand.id === st.selectedId && !st.placing) startDrag(inp.cand, x, y);
          else { inp.mode = 'pan'; inp.lx = x; inp.ly = y; inp.lt = now; }
        }
        inp.lx = x; inp.ly = y;
        break;
      case 'pan': {
        const dx = x - inp.lx, dy = y - inp.ly;
        Render.pan(dx, dy);
        const dtm = Math.max(1, now - (inp.lt || now));
        inp.vx = inp.vx * 0.6 + (dx / dtm * 16.7) * 0.4;
        inp.vy = inp.vy * 0.6 + (dy / dtm * 16.7) * 0.4;
        inp.lx = x; inp.ly = y; inp.lt = now;
        break;
      }
      case 'pinch': {
        if (inp.pointers.size < 2) break;
        const [a, b] = [...inp.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        if (inp.pd > 0) Render.zoomAt(mx, my, d / inp.pd);
        Render.pan(mx - inp.px, my - inp.py);
        inp.pd = d; inp.px = mx; inp.py = my;
        break;
      }
      case 'ghost':
      case 'drag':
        inp.lx = x; inp.ly = y;
        moveDragTo(x, y);
        break;
    }
  }
  function moveDragTo(x, y) {
    const g = Render.screenToGrid(x, y);
    const target = inp.mode === 'ghost' ? st.placing : st.drag;
    if (!target) return;
    const nx = Math.round(g.x - inp.grab.x), ny = Math.round(g.y - inp.grab.y);
    if (nx !== target.gx || ny !== target.gy) {
      target.gx = nx; target.gy = ny;
      if (inp.mode === 'drag') target.valid = Game.canPlace(target.type, nx, ny, target.id);
      Sound.play('tick'); haptic(5);
    }
  }
  function onUp(e) {
    if (!inp.pointers.has(e.pointerId)) return;
    inp.pointers.delete(e.pointerId);
    clearTimeout(inp.timer);
    const { x, y } = localXY(e);
    switch (inp.mode) {
      case 'press':
        if (inp.pointers.size === 0) tap(x, y);
        inp.mode = 'none';
        break;
      case 'pan':
        inp.mode = 'none';
        if (performance.now() - (inp.lt || 0) > 80) inp.vx = inp.vy = 0;
        break;
      case 'pinch':
        if (inp.pointers.size === 1) {
          const p = [...inp.pointers.values()][0];
          inp.mode = 'pan'; inp.lx = p.x; inp.ly = p.y; inp.lt = performance.now();
          inp.vx = inp.vy = 0;
        } else inp.mode = 'none';
        break;
      case 'drag':
        endDrag();
        inp.mode = 'none';
        break;
      case 'ghost':
        inp.mode = 'none';
        break;
      default: inp.mode = 'none';
    }
  }
  function onCancel(e) {
    inp.pointers.delete(e.pointerId);
    clearTimeout(inp.timer);
    if (inp.mode === 'drag') cancelDrag();
    if (inp.pointers.size === 0) inp.mode = 'none';
  }
  function startDrag(b, x, y) {
    const g = Render.screenToGrid(x, y);
    st.drag = { id: b.id, type: b.type, gx: b.gx, gy: b.gy, ox: b.gx, oy: b.gy, valid: true, level: b.level };
    inp.grab = { x: g.x - b.gx, y: g.y - b.gy };
    inp.mode = 'drag';
    st.selectedId = b.id;
    $('#ctx').hidden = true;
    Sound.play('pick'); haptic(20);
  }
  function endDrag() {
    const dr = st.drag;
    if (!dr) return;
    st.drag = null;
    if (dr.gx === dr.ox && dr.gy === dr.oy) { renderCtx(); return; }
    if (Game.moveBuilding(dr.id, dr.gx, dr.gy)) {
      const d = Game.def(dr.type);
      Render.puff(dr.gx, dr.gy, d.w, d.d);
      Sound.play('drop'); haptic(20);
    } else {
      toast('Hier ist kein Platz.', 'bad'); Sound.play('error'); haptic(40);
    }
    renderCtx();
  }
  function cancelDrag() { st.drag = null; inp.mode = 'none'; renderCtx(); }

  function tap(x, y) {
    if (st.placing) {
      if (ghostHit(x, y)) return;
      const g = Render.screenToGrid(x, y);
      const d = Game.def(st.placing.type);
      st.placing.gx = Math.round(g.x - d.w / 2);
      st.placing.gy = Math.round(g.y - d.d / 2);
      Sound.play('tick');
      return;
    }
    if (Actions.tap(x, y)) return;
    const pk = Render.hitPickup(x, y);
    if (pk) {
      const r = Game.collectPickup(pk.id);
      if (r) {
        Sound.play(r.p.k === 'tip' ? 'coin' : 'pop'); haptic(15);
        if (r.got.euro) { Render.flyRes(r.p.x, r.p.y, 10, 'euro', r.p.k === 'tip' ? 4 : 2); Render.floatText(r.p.x, r.p.y, 20, `+${fmt(r.got.euro)} €`, '#bbf7d0'); }
        if (r.got.stars) setTimeout(() => Render.floatText(r.p.x, r.p.y, 34, `+${r.got.stars} ★`, '#fde047'), 250);
      }
      return;
    }
    const bub = Render.hitBubble(x, y);
    if (bub) { collect(bub); if (st.selectedId === bub.id) renderCtx(); return; }
    const guest = Render.hitGuest(x, y);
    if (guest === 'dog') {
      const got = Game.catchDog();
      if (got) { Sound.play('bark'); haptic([20, 40, 20]); modal({ title: 'Bello gefunden!', icon: 'dog', html: `<p class="center">Der Besitzer ist überglücklich und bedankt sich herzlich.</p><p class="center">${gainHtml(got)}</p>`, buttons: [{ label: 'Super!', cls: 'green' }] }); }
      return;
    }
    if (guest) { showGuest(guest); return; }
    const b = Render.hitBuilding(x, y);
    if (b) {
      if (st.selectedId === b.id && !Game.canCollect(b)) { deselect(); return; }
      if (Game.canCollect(b) && !b.build) collect(b);
      select(b);
      return;
    }
    const pi = Render.hitParcel(x, y);
    if (pi >= 0 && !st.selectedId) { showParcel(pi); return; }
    deselect();
  }

  /* ---------- Grundstücke ---------- */
  function showParcel(pi) {
    const info = Game.parcelInfo(pi);
    const r = info.rect, size = `${r.x1 - r.x0} × ${r.y1 - r.y0}`;
    const left = Game.landPermits() - Game.landBought();
    let html, buttons;
    if (!info.adjacent) {
      html = `<p class="center">Dieses Stück Wildnis (${size} Felder) liegt noch zu weit weg. Kaufe zuerst ein Grundstück direkt an deinem Platz.</p>`;
      buttons = [{ label: 'Okay' }];
    } else if (!info.permitted) {
      html = `<p class="center">Ein Stück Wildnis mit ${size} Feldern.</p><p class="center">Für weitere Grundstücke brauchst du eine Genehmigung: <b>${info.nextRl ? `Rezeption Level ${info.nextRl}` : 'alles gekauft'}</b>.</p>`;
      buttons = [{ label: 'Okay' }];
    } else {
      html = `<p class="center">Ein Stück Wildnis mit <b>${size} Feldern</b>. Wer weiß, was dort im Dickicht wartet – ein Schatz, ein Teich, eine alte Ruine …?</p>
        <p class="center">Preis: ${costHtml(info.cost)}</p>
        <p class="hint center">Mit deiner Genehmigung darfst du noch <b>${left}</b> Grundstück${left === 1 ? '' : 'e'} kaufen. Jedes weitere wird etwas teurer.</p>`;
      buttons = [{ label: 'Abbrechen' }, { label: 'Kaufen', cls: 'green', onClick: () => {
        const res = Game.buyParcel(pi);
        if (!res.ok) { if (res.missing) lackToast(res.missing); else toast(res.reason, 'bad'); Sound.play('error'); }
      } }];
    }
    modal({ title: 'Grundstück', icon: 'map', html, buttons });
  }
  const FEATURE_TEXT = {
    chest: ['Eine Schatzkiste!', 'Zwischen den Büschen liegt eine alte Kiste. Tippe sie an und öffne sie!'],
    forest: ['Ein kleiner Wald', 'Viele Bäume – räume sie für jede Menge Holz.'],
    ruin: ['Eine alte Mühlenruine', 'Restauriere sie mit Holz – das bringt Sterne.'],
    pond: ['Ein Teich!', 'Hier gibt es schon einen kleinen See – gratis für deine Gäste.'],
    meadow: ['Eine Blumenwiese', 'Viel freier Platz zum Bauen.'],
  };

  function showGuest(g) {
    const T = GUESTS.types[g.type];
    const pitch = Game.getBuilding(g.pitchId);
    const left = g.leaveAt ? Math.max(0, (g.leaveAt - Date.now()) / 1000) : null;
    const wish = g.wish ? `${Game.wishText(g.wish)} ${g.wishDone ? `<span class="ok">${icon('check')} erfüllt</span>` : '<span class="open">offen</span>'}` : 'Keine besonderen Wünsche';
    const stateTxt = { arrive: 'Kommt gerade an', checkin: 'Checkt ein', toPitch: 'Geht zum Stellplatz', stay: 'Entspannt am Stellplatz', toAct: 'Unterwegs auf dem Platz', act: 'Genießt den Platz', leave: 'Reist ab' }[g.state] || '';
    modal({
      title: esc(g.name), icon: 'guests', cls: 'wide',
      html: `<div class="two"><table class="stats">
        <tr><td>Typ</td><td>${T.name}</td></tr>
        <tr><td>Stellplatz</td><td>${pitch ? Game.def(pitch.type).name : '–'}</td></tr>
        <tr><td>Status</td><td>${stateTxt}</td></tr>
        ${left != null && g.state !== 'leave' ? `<tr><td>Abreise in</td><td>${fmtTime(left)}</td></tr>` : ''}
        <tr><td>Stimmung</td><td>${Game.guestMood(g)} %</td></tr>
        <tr><td>Wunsch</td><td>${wish}</td></tr></table>
        <div><p><b>Das ist ${T.name === 'Familie' ? 'der Familie' : T.name === 'Rentnerpaar' ? 'dem Paar' : 'diesem Gast'} wichtig:</b></p>
        ${needRows(NEED_ORDER.filter(n => (T.needs || {})[n] > 0).sort((a, b) => T.needs[b] - T.needs[a]), true)}</div></div>
        <p class="hint">Die Stimmung mischt die allgemeine Zufriedenheit mit den Lieblingsbedürfnissen dieses Gastes – davon hängt die Bewertung beim Abreisen ab. Erfüllte Wünsche bringen +${GUESTS.wishBonusStars} Sterne und Trinkgeld.</p>`,
    });
  }

  /* ---------- HUD ---------- */
  const last = {};
  function setText(key, el, text) { if (last[key] !== text) { last[key] = text; el.textContent = text; } }
  function setHtml(key, el, html) { if (last[key] !== html) { last[key] = html; el.innerHTML = html; } }
  function updateHUD() {
    const s = S();
    setText('euro', hud.euro, fmt(s.res.euro));
    setText('wood', hud.wood, fmt(s.res.wood));
    setText('gems', hud.gems, fmt(s.res.gems));
    setText('stars', hud.stars, fmt(s.res.stars));
    const ti = Game.tierIndex();
    setText('tier', hud.tier, CONFIG.ratingTiers[ti].name);
    const eb = Math.min(100, s.res.euro / Game.storageCap('euro') * 100), wb = Math.min(100, s.res.wood / Game.storageCap('wood') * 100);
    if (last.eb !== eb) { last.eb = eb; hud.euroBar.style.width = eb + '%'; hud.euroBox.classList.toggle('full', eb >= 99.9); }
    if (last.wb !== wb) { last.wb = wb; hud.woodBar.style.width = wb + '%'; hud.woodBox.classList.toggle('full', wb >= 99.9); }
    const sat = Game.satisfaction().total;
    setText('sat', hud.sat, sat + ' %');
    setHtml('satIc', hud.satIc, sat >= 65 ? IC.smile : sat >= 40 ? IC.meh : IC.sad);
    const needs = Game.satisfaction().needs;
    for (const n of NEED_ORDER) {
      const f = Math.round(needs[n].f * 40) / 40;
      const low = f < 0.5 && Game.needAvailable(n, s.rl), key = f + (low ? 'L' : '');
      if (last['nd' + n] !== key) { last['nd' + n] = key; hud.nd[n].style.setProperty('--f', f); hud.nd[n].classList.toggle('low', low); }
    }
    setText('builders', hud.builders, `${Game.freeBuilders()}/${s.builders}`);
    const di = Render.dayInfo();
    const hh = Math.floor(di.hour), mm = Math.floor((di.hour % 1) * 60 / 10) * 10;
    setText('clock', hud.clock, `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`);
    setHtml('clockIc', hud.clockIc, di.night || di.hour < 6 || di.hour >= 20 ? IC.moon : IC.sun);
  }
  function updateStatus() {
    const s = S();
    const now = Date.now();
    let html = '';
    if (s.event && s.event.until > now) {
      const ev = EVENTS.find(e => e.id === s.event.id);
      const nm = (s.event.mods && s.event.mods.needs) || {};
      const tags = Object.keys(nm).map(n => `<em class="${nm[n] < 0 ? 'neg' : 'pos'}">${icon(n)}${nm[n] > 0 ? '+' : '−'}${Math.abs(Math.round(nm[n] * 100))}</em>`).join('');
      html += `<div class="chip">${icon(ev ? ev.icon : (s.event.icon || 'info'))}<span>${s.event.title}</span>${tags}<b>${fmtTime((s.event.until - now) / 1000)}</b></div>`;
    }
    for (const k in s.boosts) {
      if (s.boosts[k].until <= now) continue;
      const item = SHOP.find(i => i.boost && i.boost.key === k);
      html += `<div class="chip boost">${icon(item ? item.icon : 'bolt')}<span>${item ? item.name : k}</span><b>${fmtTime((s.boosts[k].until - now) / 1000)}</b></div>`;
    }
    if (Game.G.dog) html += `<div class="chip dog">${icon('dog')}<span>Finde Bello!</span><b>${fmtTime((Game.G.dog.until - now) / 1000)}</b></div>`;
    setHtml('status', hud.status, html);
    const daily = Game.dailyStatus();
    hud.gift.hidden = !daily.claimable;
    const badge = Game.badgeCount() + (daily.claimable ? 1 : 0);
    setText('badge', hud.badge, badge ? String(badge) : '');
    hud.badge.hidden = !badge;
  }
  function measureHud() {
    for (const k of ['euro', 'wood', 'gems', 'stars']) {
      const el = hud[k + 'Ic'];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      Render.setHudTarget(k, r.left + r.width / 2, r.top + r.height / 2);
    }
  }

  // Balken je Bedürfnis: Erfüllung, Angebot/Bedarf, Ereignis-Einfluss
  function needRows(list, compact) {
    const r = Game.satisfaction();
    return list.map(n => {
      const x = r.needs[n];
      const pct = Math.round(x.f * 100), mod = Math.round(x.mod * 100);
      const info = compact ? '' : `<small>Angebot ${Math.round(x.supply)} · Bedarf ${Math.round(x.demand)}${mod ? ` · Ereignis/Boost ${mod > 0 ? '+' : ''}${mod} %` : ''} · ${x.pts >= 0 ? '+' : ''}${Math.round(x.pts)} Punkte</small>`;
      return `<div class="needrow">${icon(n)}<b>${NEEDS[n].name}</b><span class="nbar" style="--c:${NEEDS[n].color}"><i style="width:${pct}%"></i></span><span class="num">${pct} %</span>${info}</div>`;
    }).join('');
  }
  function showSatisfaction() {
    const r = Game.satisfaction();
    const row = (label, v, note) => `<tr><td>${label}${note ? `<br><small>${note}</small>` : ''}</td><td class="${v > 0.5 ? 'up' : v < -0.5 ? 'down' : ''}">${v > 0 ? '+' : ''}${Math.round(v)}</td></tr>`;
    const mult = Game.incomeMultiplier();
    const weakest = NEED_ORDER.filter(n => Game.needAvailable(n, S().rl)).sort((a, b) => r.needs[a].f - r.needs[b].f)[0];
    modal({
      title: `Zufriedenheit ${r.total} %`, icon: r.total >= 65 ? 'smile' : r.total >= 40 ? 'meh' : 'sad', cls: 'wide',
      html: `<div class="two"><div>${needRows(NEED_ORDER)}</div><div>
        <table class="stats">
        ${row('Grundstimmung', r.base)}
        ${row('Bedürfnisse', r.needPts, 'Hygiene zählt doppelt – ohne Duschen wird es schnell ungemütlich')}
        ${row('Deko & Natur', r.decoPts, `max. +${CONFIG.satisfaction.decoMax}`)}
        ${row('Rezeption', r.recPts)}
        ${r.eventPts ? row('Ereignisse', r.eventPts) : ''}
        </table></div></div>
        <p class="hint">Deine Camper haben fünf Bedürfnisse. Der Bedarf wächst mit jedem Gästeplatz – und mit jedem Rezeptionslevel werden die Gäste anspruchsvoller. Das Angebot liefern Gebäude der passenden Kategorie im Baumenü. Zufriedenheit erhöht deine Einnahmen (aktuell ×${mult.toLocaleString('de-DE', { maximumFractionDigits: 2 })}) und die Bewertungen deiner Gäste.${r.needs[weakest].f < 0.9 ? ` Am meisten fehlt gerade: <b>${NEEDS[weakest].name}</b>.` : ''}</p>`,
    });
  }
  function showTiers() {
    const ti = Game.tierIndex();
    const rows = CONFIG.ratingTiers.map((t, i) => `<tr class="${i === ti ? 'cur' : ''}"><td>${'★'.repeat(i) || '–'} ${t.name}</td><td>${fmt(t.stars)} ${icon('stars')}</td><td>+${Math.round(t.bonus * 100)} %</td></tr>`).join('');
    modal({
      title: `${fmt(S().res.stars)} Sterne`, icon: 'stars',
      html: `<table class="stats three">${rows}</table><p class="hint">Sterne gibt es für gute Bewertungen abreisender Gäste, erfüllte Wünsche, Ereignisse und Aufträge. Schlechte Laune kostet Sterne! Jede Klasse erhöht deine Einnahmen und lockt mehr Gäste an.</p>`,
    });
  }
  function showBuilders() {
    const busy = S().buildings.filter(b => b.build).sort((p, q) => p.build.end - q.build.end);
    const list = busy.map(b => `<tr><td>${Game.def(b.type).name} ${b.build.to > 1 ? `→ Lv. ${b.build.to}` : ''}</td><td>${fmtTime(Game.remaining(b))}</td></tr>`).join('');
    const item = SHOP.find(i => i.kind === 'builder');
    const price = Game.shopPrice(item);
    modal({
      title: `Bauarbeiter ${Game.freeBuilders()}/${S().builders} frei`, icon: 'hammer',
      html: busy.length ? `<table class="stats">${list}</table>` : '<p class="center">Alle Bauarbeiter warten auf neue Aufträge!</p>',
      buttons: price ? [{ label: 'Schließen' }, { label: `Weiterer Bauarbeiter ${costHtml(price)}`, cls: 'green', onClick: () => openSheet('shop') }] : [{ label: 'Schließen' }],
    });
  }

  /* ---------- Spielereignisse anzeigen ---------- */
  function showEvent(ev) {
    Sound.play('event'); haptic([30, 60, 30]);
    const choices = ev.choices.map((c, i) => {
      const info = Game.eventChoiceInfo(ev, c);
      const cost = Object.keys(info.cost).length ? costHtml(info.cost) : '';
      return { c, i, info, label: `${c.label}${cost ? `<span class="btn-cost">${cost}</span>` : ''}${info.needs ? `<span class="btn-cost">Benötigt ${info.needs}</span>` : ''}`, disabled: !!info.needs || !info.affordable };
    });
    modal({
      title: ev.title, icon: ev.icon, cls: 'event', noClose: true,
      html: `<p>${ev.text}</p>`,
      buttons: choices.map(ch => ({
        label: ch.label, cls: 'choice', disabled: ch.disabled,
        onClick: () => {
          const r = Game.chooseEvent(ch.i);
          if (!r.ok) { toast(r.reason, 'bad'); return true; }
          setTimeout(() => modal({ title: ev.title, icon: ev.icon, html: `<p class="center">${r.result}</p>${r.got && Object.keys(r.got).length ? `<p class="center">${gainHtml(r.got)}</p>` : ''}`, buttons: [{ label: 'OK', cls: 'green' }] }), 50);
          if (r.got && r.got.stars > 0) Sound.play('star');
          return false;
        },
      })),
    });
  }

  function claimDaily() {
    const st2 = Game.dailyStatus();
    const got = Game.claimDaily();
    if (!got) return;
    Sound.play('gem'); haptic([20, 30, 20]);
    toast(`Tag ${st2.streak}: ${gainHtml(got)}`, 'good');
  }
  function showDaily() {
    const d = Game.dailyStatus();
    if (!d.claimable) return;
    const days = DAILY.map((r, i) => {
      const rew = Game.scaled(r);
      return `<div class="day ${i === d.idx ? 'today' : i < d.idx ? 'got' : ''}"><small>Tag ${i + 1}</small>${Object.keys(rew).map(k => `<div>${resIcon(k)}${fmt(rew[k])}</div>`).join('')}${i < d.idx ? `<em>${IC.check}</em>` : ''}</div>`;
    }).join('');
    modal({ title: 'Tägliche Belohnung', icon: 'gift', html: `<p class="center">Serie: <b>Tag ${d.streak}</b></p><div class="daily">${days}</div>`, buttons: [{ label: 'Abholen!', cls: 'green', onClick: claimDaily }] });
  }

  function showOffline(sum) {
    modal({
      title: 'Willkommen zurück!', icon: 'sun',
      html: `<p class="center">Du warst <b>${fmtTime(sum.seconds)}</b> weg.${sum.capped ? `<br><small>Offline-Einnahmen zählen maximal ${CONFIG.offline.maxHours} Stunden.</small>` : ''}${sum.euroCapped ? `<br><small>Offline verdienst du höchstens ${fmt(Game.storageCap('euro') * CONFIG.offline.maxEuroShare)} € (ein Viertel deines Lagers) – für mehr musst du selbst spielen.</small>` : ''}</p>
        <p class="center">Deine Gebäude haben produziert:</p><p class="center big">${gainHtml({ euro: sum.euro, wood: sum.wood })}</p>
        ${sum.finished ? `<p class="center">${sum.finished} Bauprojekt${sum.finished > 1 ? 'e' : ''} fertiggestellt.</p>` : ''}
        <p class="hint center">Tippe auf die schwebenden Münzen, um alles einzusammeln.</p>`,
      buttons: [{ label: 'Los geht\'s', cls: 'green' }],
    });
  }

  function showHelp() {
    modal({
      title: 'So spielst du', icon: 'info',
      html: `<ul class="help">
        <li><b>Karte bewegen:</b> Mit einem Finger ziehen. <b>Zoomen:</b> mit zwei Fingern.</li>
        <li><b>Antippen</b> wählt ein Gebäude aus. <b>Gedrückt halten</b> hebt es an – dann an einen neuen Platz ziehen.</li>
        <li><b>Münzen &amp; Holz:</b> Tippe auf die schwebenden Blasen, um Einnahmen einzusammeln.</li>
        <li><b>Bauen:</b> Stellplätze bringen Geld. Gebäude für <b>Hygiene, Sport, Kultur, Kunst und Party</b> erfüllen die Bedürfnisse deiner Camper.</li>
        <li><b>Grundstücke:</b> Dein Platz wächst, wo du willst: Tippe auf ein Schild am Rand und kaufe das Stück Wildnis dahinter. Oft wartet dort eine Überraschung. Wie viele du kaufen darfst, hängt von der Rezeption ab.</li>
        <li><b>Müll &amp; Trinkgeld:</b> Gäste lassen manchmal Müll liegen (senkt die Zufriedenheit) oder Trinkgeld (Münze mit Herz). Einfach antippen!</li>
        <li><b>Bedürfnisse:</b> Die fünf Ringe neben der Zufriedenheit zeigen, wie gut jedes Bedürfnis erfüllt ist. Mehr Gästeplätze brauchen mehr Angebot.</li>
        <li><b>Zufriedenheit</b> erhöht Einnahmen und Bewertungen. Jeder Gasttyp hat eigene Vorlieben – Familien wollen Sport und Hygiene, Rentner Kultur und Kunst, Backpacker Party.</li>
        <li><b>Wünsche:</b> Gäste zeigen Sprechblasen mit Wünschen. Erfülle sie für Bonus-Sterne und Trinkgeld.</li>
        <li><b>Rezeption verbessern</b> schaltet neue Gebäude, mehr Fläche und größere Lager frei.</li>
        <li><b>Gems</b> gibt es für Erfolge und die tägliche Belohnung. Damit beschleunigst du Bauten.</li>
        <li>Auch wenn die App zu ist, wird bis zu ${CONFIG.offline.maxHours} Stunden lang weiterverdient – höchstens ein Viertel deines Euro-Lagers.</li></ul>`,
      buttons: [{ label: 'Alles klar!', cls: 'green' }],
    });
  }
  function showWelcome() {
    modal({
      title: 'Willkommen auf deinem Campingplatz!', icon: 'build', noClose: true, cls: 'wide',
      html: `<p>Du hast einen kleinen Platz mit Rezeption, Sanitärhaus und zwei Zeltplätzen übernommen. Mach daraus das beliebteste Ferienziel der Gegend!</p>
        <ul class="help"><li>Deine Camper brauchen <b>Hygiene, Sport, Kultur, Kunst und Party</b> – die Ringe oben links zeigen, was fehlt.</li><li>Ziehe mit einem Finger, zoome mit zwei. Halte ein Gebäude gedrückt, um es zu verschieben.</li><li>Tippe auf schwebende Münzen zum Einsammeln.</li><li>Unten rechts: Bauen, Shop, Aufträge und Optionen.</li></ul>`,
      buttons: [{ label: 'Los geht\'s!', cls: 'green', onClick: () => { S().welcomed = true; Game.save(); } }],
    });
  }

  /* ---------- Spiel-Ereignisse abonnieren ---------- */
  function wireGame() {
    Game.on('built', ({ b, upgrade, quiet }) => {
      if (quiet) return;
      const d = Game.def(b.type);
      Render.confetti(b.gx, b.gy, d.w, d.d, d.height);
      Sound.play('done'); haptic([15, 30, 15]);
      toast(`${d.name} ${upgrade ? `ist jetzt Level ${b.level}` : 'ist fertig'}!`, 'good');
      if (st.selectedId === b.id) renderCtx();
    });
    Game.on('reception', ({ level, unlocked, guests, permits }) => {
      Sound.play('levelup');
      const names = unlocked.map(k => BUILDINGS[k].name);
      const gnames = (guests || []).map(k => GUESTS.types[k].name);
      modal({
        title: `Rezeption Level ${level}!`, icon: 'stars',
        html: `<p class="center">Die Lager fassen mehr und Gebäude können bis Level ${Math.min(10, level + CONFIG.levelCapOffset)} verbessert werden.</p>
          ${names.length ? `<p class="center"><b>Neu zum Bauen:</b><br>${names.join(', ')}</p>` : ''}
          ${gnames.length ? `<p class="center"><b>Neue Gäste reisen an:</b><br>${gnames.join(', ')}</p>` : ''}
          ${permits > 0 ? `<p class="center"><b>Genehmigung für ${permits} weitere${permits === 1 ? 's' : ''} Grundstück${permits === 1 ? '' : 'e'}</b> – tippe auf ein Schild am Rand deines Platzes.</p>` : ''}`,
        buttons: [{ label: 'Weiter so!', cls: 'green' }],
      });
    });
    Game.on('parcel', ({ p, feature }) => {
      Sound.play('done'); haptic([15, 30, 15]);
      const r = Game.parcelRect(p);
      Render.confetti(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0, 10);
      const t = FEATURE_TEXT[feature] || FEATURE_TEXT.meadow;
      toast(`${t[0]} ${t[1]}`, 'good');
    });
    Game.on('event', ({ ev }) => showEvent(ev));
    Game.on('eventEnded', ({ ev }) => toast(`${ev.title} ist vorbei.`));
    Game.on('review', ({ g, stars, tip }) => {
      const p = g;
      if (stars > 0) { Render.floatText(p.x, p.y, 34, `+${stars} ★`, '#fde047'); Sound.play('star'); }
      else if (stars < 0) { Render.floatText(p.x, p.y, 34, `${stars} ★`, '#fca5a5'); Sound.play('bad'); }
      if (tip > 0) setTimeout(() => Render.floatText(p.x, p.y, 34, `+${fmt(tip)} € Trinkgeld`, '#bbf7d0'), 500);
    });
    Game.on('wishMet', ({ g }) => { Render.hearts(g.x, g.y); Sound.play('pop'); });
    Game.on('guestArrive', () => Sound.play('guest'));
    Game.on('storageFull', () => {});
    Game.on('toast', ({ text }) => toast(text));
    Game.on('offline', sum => { if (!st.booting) showOffline(sum); else st.pendingOffline = sum; });
    Game.on('reset', () => { st.selectedId = null; });
    Render.hooks.lightning = () => Sound.play('thunder');
  }

  /* ---------- Spielschleife ---------- */
  let lastT = 0, slowT = 0, camT = 0;
  function loop(t) {
    const dt = Math.min(0.05, Math.max(0, (t - lastT) / 1000));
    lastT = t;
    Game.update(dt);
    Actions.update(dt);
    // Schwung nach dem Ziehen
    if (inp.mode === 'none' && (Math.abs(inp.vx) > 0.05 || Math.abs(inp.vy) > 0.05)) {
      Render.pan(inp.vx * dt * 60, inp.vy * dt * 60);
      const k = Math.pow(0.9, dt * 60);
      inp.vx *= k; inp.vy *= k;
    }
    // Randscrollen beim Verschieben: erst nach kurzer Verweildauer, schneller je näher am Rand
    if (inp.mode === 'drag' || inp.mode === 'ghost') {
      const { W, H } = Render.size;
      const top = Math.max(60, H * 0.2), bottom = Math.max(60, H * 0.18), side = 46;
      const ex = inp.lx < side ? (side - inp.lx) / side : inp.lx > W - side ? -(inp.lx - (W - side)) / side : 0;
      const ey = inp.ly < top ? (top - inp.ly) / top : inp.ly > H - bottom ? -(inp.ly - (H - bottom)) / bottom : 0;
      inp.edgeT = ex || ey ? (inp.edgeT || 0) + dt : 0;
      if (inp.edgeT > 0.25) {
        const v = 160 + 360 * Math.min(1, Math.max(Math.abs(ex), Math.abs(ey)));
        Render.pan(Math.sign(ex) * v * dt, Math.sign(ey) * v * dt);
        moveDragTo(inp.lx, inp.ly);
      }
    } else inp.edgeT = 0;
    const view = { selectedId: st.selectedId, ghost: null, hideId: null };
    if (st.drag) { view.ghost = { type: st.drag.type, gx: st.drag.gx, gy: st.drag.gy, valid: st.drag.valid, level: st.drag.level }; view.hideId = st.drag.id; }
    else if (st.placing) { view.ghost = { type: st.placing.type, gx: st.placing.gx, gy: st.placing.gy, valid: placingValid(), level: st.placing.level }; view.hideId = st.placing.moveId; }
    Render.frame(dt, view);
    updateHUD();
    const panel = !hud.ctx.hidden || !hud.place.hidden;
    if (panel !== st.panel) { st.panel = panel; document.body.classList.toggle('panel', panel); }
    slowT -= dt;
    if (slowT <= 0) {
      slowT = 0.25;
      updateStatus();
      if (st.selectedId && !st.drag && !st.placing && !st.uiDown) renderCtx();
      if (st.sheet === 'shop' || st.sheet === 'quests') refreshSheetLive();
      if (st.placing) { const ok = placingValid(); $('#place').classList.toggle('invalid', !ok); }
    }
    camT -= dt;
    if (camT <= 0) { camT = 1; S().cam = { x: Render.cam.x, y: Render.cam.y, zoom: Render.cam.zoom }; }
    const ev = S().event;
    Sound.ambient(dt, Render.dayInfo().night, ev && ev.until > Date.now() ? ev.weather : null);
    requestAnimationFrame(loop);
  }
  let liveT = 0;
  function refreshSheetLive() {
    liveT++;
    if (liveT % 4) return;            // ~1x pro Sekunde
    if (st.uiDown) return;
    const sh = $('#sheet');
    const html = st.sheet === 'shop' ? shopSheet() : questSheet();
    if (html !== sh._html) renderSheet();
  }

  function centerOnReception(zoom) {
    const rec = S().buildings.find(b => b.type === 'reception');
    if (zoom) Render.cam.zoom = zoom;
    if (rec) Render.centerOn(rec.gx + 2, rec.gy + 3); else Render.centerOn(Game.N / 2, Game.N / 2);
  }

  /* ---------- Start ---------- */
  function preventBrowserGestures() {
    const scrollable = el => el && el.closest && el.closest('.scroll');
    document.addEventListener('touchmove', e => { if (!scrollable(e.target) || e.touches.length > 1) e.preventDefault(); }, { passive: false });
    document.addEventListener('gesturestart', e => e.preventDefault());
    document.addEventListener('gesturechange', e => e.preventDefault());
    document.addEventListener('dblclick', e => e.preventDefault());
    document.addEventListener('contextmenu', e => e.preventDefault());
    let lastTouchEnd = 0;
    document.addEventListener('touchend', e => {
      const now = Date.now();
      if (now - lastTouchEnd < 300 && !e.target.closest('button, input, label')) e.preventDefault();
      lastTouchEnd = now;
    }, { passive: false });
  }

  function registerSW() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    const go = () => {
      navigator.serviceWorker.register('sw.js').then(reg => {
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) toast('Update geladen – beim nächsten Start aktiv.');
          });
        });
      }).catch(() => {});
    };
    if (document.readyState === 'complete') go(); else window.addEventListener('load', go);
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  }

  function start() {
    st.booting = true;
    canvas = $('#game');
    hud.euro = $('#vEuro'); hud.wood = $('#vWood'); hud.gems = $('#vGems'); hud.stars = $('#vStars'); hud.tier = $('#vTier');
    hud.euroBar = $('#bEuro'); hud.woodBar = $('#bWood'); hud.euroBox = $('#rEuro'); hud.woodBox = $('#rWood'); hud.gemsBox = $('#rGems'); hud.starsBox = $('#pStars');
    hud.euroIc = $('#rEuro .ic'); hud.woodIc = $('#rWood .ic'); hud.gemsIc = $('#rGems .ic'); hud.starsIc = $('#pStars .ic');
    hud.sat = $('#vSat'); hud.satIc = $('#pSat .ic'); hud.builders = $('#vBuilders'); hud.clock = $('#vClock'); hud.clockIc = $('#pClock .ic');
    hud.status = $('#status'); hud.gift = $('#gift'); hud.badge = $('#questBadge');
    hud.ctx = $('#ctx'); hud.place = $('#place');
    hud.needs = $('#needs');
    hud.needs.innerHTML = NEED_ORDER.map(n => `<i class="nd" data-n="${n}" style="--c:${NEEDS[n].color}" title="${NEEDS[n].name}">${IC[n]}</i>`).join('');
    hud.nd = {};
    hud.needs.querySelectorAll('.nd').forEach(el => { hud.nd[el.dataset.n] = el; });
    // Icons einsetzen
    document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = IC[el.dataset.icon] || ''; });

    wireGame();
    Game.init();
    Render.init(canvas);
    Actions.init({ toast, modal, play: n => Sound.play(n), haptic, gainHtml, busy: () => !!st.modal || !!st.placing || !!st.sheet });
    Render.hooks.overlay = c => Actions.draw(c);
    if (S().cam && isFinite(S().cam.x)) { Render.cam.x = S().cam.x; Render.cam.y = S().cam.y; Render.cam.zoom = S().cam.zoom || 1; Render.clampCam(); }
    else centerOnReception(0.85);

    preventBrowserGestures();
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onCancel);
    canvas.addEventListener('lostpointercapture', e => { if (inp.pointers.has(e.pointerId)) onCancel(e); });
    canvas.addEventListener('wheel', e => { e.preventDefault(); Render.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
    document.addEventListener('pointerdown', e => { Sound.unlock(); st.uiDown = e.target !== canvas; }, { capture: true });
    const up = () => { Sound.unlock(); setTimeout(() => { st.uiDown = false; }, 60); };
    document.addEventListener('touchend', () => Sound.unlock(), { capture: true, passive: true });
    document.addEventListener('pointerup', up, { capture: true });
    document.addEventListener('pointercancel', up, { capture: true });

    $('#nav').addEventListener('click', e => {
      const b = e.target.closest('[data-nav]');
      if (!b) return;
      Sound.unlock();
      if (st.sheet === b.dataset.nav) { Sound.play('close'); closeSheet(); }
      else openSheet(b.dataset.nav);
    });
    $('#sheet').addEventListener('click', onSheetClick);
    $('#sheetBg').addEventListener('click', () => { Sound.play('close'); closeSheet(); });
    $('#sheet').addEventListener('change', onSheetChange);
    $('#ctx').addEventListener('click', onCtxClick);
    $('#place').addEventListener('click', e => {
      const b = e.target.closest('[data-pl]');
      if (!b) return;
      if (b.dataset.pl === 'ok') confirmPlacing(); else { Sound.play('close'); cancelPlacing(); }
    });
    $('#pSat').addEventListener('click', showSatisfaction);
    $('#pStars').addEventListener('click', showTiers);
    $('#pBuilders').addEventListener('click', showBuilders);
    $('#pClock').addEventListener('click', () => { const di = Render.dayInfo(); toast(di.night ? 'Gute Nacht! Die Laternen leuchten.' : 'Ein schöner Tag zum Campen!'); });
    $('#rGems').addEventListener('click', () => openSheet('shop'));
    $('#rEuro').addEventListener('click', () => toast(`Euro-Lager: ${fmt(S().res.euro)} / ${fmt(Game.storageCap('euro'))}`));
    $('#rWood').addEventListener('click', () => toast(`Holzlager: ${fmt(S().res.wood)} / ${fmt(Game.storageCap('wood'))}`));
    $('#gift').addEventListener('click', showDaily);

    const onResize = () => { Render.resize(); measureHud(); };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', () => setTimeout(onResize, 250));
    if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
    setTimeout(measureHud, 50);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { S().cam = { x: Render.cam.x, y: Render.cam.y, zoom: Render.cam.zoom }; Game.save(); }
      else { Game.resume(); lastT = performance.now(); }
    });
    window.addEventListener('pagehide', () => Game.save());

    registerSW();

    // Start-Dialoge in sinnvoller Reihenfolge
    st.booting = false;
    if (!S().welcomed) showWelcome();
    const off = st.pendingOffline || Game.G.offlineSummary;
    if (off && S().welcomed) showOffline(off);
    st.pendingOffline = null;
    if (Game.dailyStatus().claimable) showDaily();

    lastT = performance.now();
    requestAnimationFrame(loop);
    document.body.classList.add('ready');
  }

  return { start, toast, get state() { return st; }, get input() { return inp; } };   // state/input: für Tests & Debugging
})();

window.addEventListener('DOMContentLoaded', UI.start);
