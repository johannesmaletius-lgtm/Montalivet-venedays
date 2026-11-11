/* ============================================================================
 * Action-Ereignisse – kurze Reaktionsspiele auf dem Platz
 *   Sturm · Feuerwehr-Alarm · Waschbär · Kritiker-Besuch · Hund verloren (Suchspiel)
 *   Nachts: Sternschnuppen · Glühwürmchen · Nachtwanderung · Feuerwerk-Finale
 *
 * Laufzeit-only (wird nicht gespeichert). Belohnungen laufen über Game.grant,
 * dauerhafte Wirkungen (Abzüge / Boni) über Game.S.event wie bei normalen Ereignissen.
 * Eingabe:  Actions.tap(x, y)   → true, wenn der Tipp verbraucht wurde (ui.js)
 * Zeichnen: Render.hooks.overlay → Actions.draw(ctx)
 * Schleife: Actions.update(dt)  (ui.js, jedes Bild)
 * ========================================================================== */
const Actions = (() => {
  const T = { first: 75, gap: [110, 220] };      // Sekunden Spielzeit
  let api = null;                                 // { toast, modal, play, haptic, gainHtml, busy }
  let cur = null;                                 // laufende Aktion
  let nextIn = T.first;
  let skyStar = null, skyT = 25;                  // Sternschnuppe
  const sparks = [];                              // Funken (Bildschirmkoordinaten)
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const nice = v => Math.max(5, Math.round(v / 5) * 5);
  const rs = () => Game.rewardScale();
  const fScale = () => 1 + 0.4 * (Game.S.rl - 1);
  const gs = (x, y, z) => Render.gridToScreen(x, y, z || 0);
  const isNight = () => Render.dayInfo().dark > 0.6;
  const clock = () => performance.now() / 1000;

  /* ---------------- Helfer ---------------- */
  // Sicherer Tippbereich: nicht unter HUD (oben), Navigationsleiste (unten rechts) oder Seitenknöpfen (links)
  function onScreen(p) {
    const { W, H } = Render.size;
    if (p.x < 70 || p.x > W - 70 || p.y < 130 || p.y > H - 60) return false;
    if (p.x > W - 330 && p.y > H - 90) return false;
    return true;
  }
  // Zufällige begehbare Kachel – zuerst im sichtbaren Bereich, sonst irgendwo auf dem Platz
  function randTile(minDist, from) {
    const a = Game.area();
    for (let i = 0; i < 240; i++) {
      const x = Math.floor(rand(a.x0, a.x1)), y = Math.floor(rand(a.y0, a.y1));
      if (!Game.walkable(x, y) || !Game.inArea(x, y)) continue;
      if (from && Math.hypot(x + 0.5 - from.x, y + 0.5 - from.y) < minDist) continue;
      if (i < 200 && !onScreen(gs(x + 0.5, y + 0.5, 14))) continue;
      return { x: x + 0.5, y: y + 0.5 };
    }
    return null;
  }
  // sichtbare Gebäude zuerst, sonst zufällig
  const byVisible = list => list.map(b => ({ b, v: onScreen(centerPx(b)) ? 0 : 1, r: Math.random() })).sort((p, q) => p.v - q.v || p.r - q.r).map(o => o.b);
  const liveBuildings = pred => Game.S.buildings.filter(b => b.level >= 1 && !b.build && !Game.def(b.type).flat && (!pred || pred(b)));
  const pitches = () => liveBuildings(b => Game.def(b.type).cat === 'pitch');
  const center = b => { const d = Game.def(b.type); return { x: b.gx + d.w / 2, y: b.gy + d.d / 2, z: Math.min(d.height || 30, 60) * 0.55 }; };
  const centerPx = b => { const c = center(b); return gs(c.x, c.y, c.z); };
  const hitR = (min, k) => Math.max(min, k * Render.cam.zoom);

  function setEvent(title, sec, mods, weather, icon) {
    const S = Game.S, t = Date.now();
    S.event = { id: 'action', icon: icon || (weather === 'storm' ? 'storm' : 'info'), weather: weather || null, title, until: t + sec * 1000, mods: mods || {} };
    S.nextEventAt = Math.max(S.nextEventAt, t + sec * 1000 + 45000);
    Game.G.sat = null;
  }
  const eventFree = () => !(Game.S.event && Game.S.event.until > Date.now());
  const ownEvent = () => !!(Game.S.event && Game.S.event.id === 'action' && Game.S.event.until > Date.now());
  // Nachwirkung setzen – ein laufendes eigenes Ereignis (z. B. Sturm-Wetter) wird ersetzt, ein normales nie überschrieben
  function addEffect(title, sec, mods, icon) { if (eventFree() || ownEvent()) setEvent(title, sec, mods, null, icon); else Game.S.nextEventAt = Math.max(Game.S.nextEventAt, Date.now() + 30000); }
  function clearOwnEvent() { if (ownEvent()) { Game.S.event = null; Game.G.sat = null; } }
  function reward(r) { const got = Game.grant(r); Game.G.sat = null; return got; }
  function spark(x, y, n, cols, speed) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, v = rand(0.3, 1) * (speed || 150);
      sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 20, life: 0, max: rand(0.7, 1.3), c: pick(cols), r: rand(1.5, 3) });
    }
  }
  function finishWithModal(title, icon, text, got) {
    Game.S.stats.events++;
    api.modal({ title, icon, html: `<p class="center">${text}</p>${got && Object.keys(got).length ? `<p class="center">${api.gainHtml(got)}</p>` : ''}`, buttons: [{ label: 'OK', cls: 'green' }] });
    if (got && got.stars > 0) api.play('star');
  }
  function begin(a) {
    cur = Object.assign({ t: 0, done: false, endT: 0 }, a);
    const S = Game.S;
    S.nextEventAt = Math.max(S.nextEventAt, Date.now() + ((a.dur || 30) + 40) * 1000);
    api.play('event'); api.haptic([30, 60, 30]);
  }
  function end() { cur = null; nextIn = rand(T.gap[0], T.gap[1]); }

  /* ================= Sturm: Zelte sichern ================= */
  const storm = {
    id: 'storm', title: 'Sturm zieht auf!', hint: 'Tippe die Zelte an, bevor der Wind sie umweht!',
    can: () => pitches().length >= 2,
    weight: () => (isNight() ? 1 : 2.2),
    start() {
      const list = byVisible(pitches()).slice(0, 6);
      const items = list.map((b, i) => ({ b, at: 1.8 + i * 2.4, life: 6.5, st: 'wait' }));
      const dur = items[items.length - 1].at + 6.5 + 1.5;
      if (eventFree()) setEvent('Sturm', dur + 2, {}, 'storm');
      begin({ ...storm, items, dur });
    },
    update(dt) {
      let open = 0;
      for (const it of cur.items) {
        if (it.st === 'wait') { open++; if (cur.t >= it.at) it.st = 'warn'; }
        else if (it.st === 'warn') {
          open++;
          if (cur.t >= it.at + it.life) {
            it.st = 'lost'; const p = centerPx(it.b);
            spark(p.x, p.y, 14, ['#9ca3af', '#6b7280', '#d1d5db'], 90); api.play('bad');
            Render.puff(center(it.b).x - 1, center(it.b).y - 1, 2, 2);
          }
        }
      }
      if (!open) { cur.endT += dt; if (cur.endT > 0.8) storm.finish(); }
    },
    tap(x, y) {
      let best = null, bd = hitR(40, 34);
      for (const it of cur.items) {
        if (it.st !== 'warn') continue;
        const p = centerPx(it.b), d = Math.hypot(p.x - x, p.y - y);
        if (d < bd) { bd = d; best = it; }
      }
      if (!best) return false;
      best.st = 'safe'; api.play('pop'); api.haptic(15);
      const c = center(best.b);
      Render.floatText(c.x, c.y, 50, 'Gesichert!', '#bbf7d0');
      return true;
    },
    draw(c) {
      for (const it of cur.items) {
        if (it.st === 'wait') continue;
        const p = centerPx(it.b), z = Render.cam.zoom;
        if (it.st === 'warn') {
          const left = Math.max(0, 1 - (cur.t - it.at) / it.life), pulse = 1 + Math.sin(clock() * 12) * 0.08;
          const r = 22 * Math.max(0.8, z) * pulse;
          ring(c, p.x, p.y - 18 * z, r, left, left > 0.35 ? '#facc15' : '#ef4444');
          badge(c, p.x, p.y - 18 * z, '!', left > 0.35 ? '#facc15' : '#ef4444', r * 0.7);
          // Windstriche
          c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 2; c.lineCap = 'round';
          for (let i = 0; i < 3; i++) { const o = (clock() * 90 + i * 30) % 90; c.beginPath(); c.moveTo(p.x - 50 + o, p.y - 30 + i * 12); c.lineTo(p.x - 20 + o, p.y - 30 + i * 12); c.stroke(); }
        } else if (it.st === 'safe') { badge(c, p.x, p.y - 20 * z, '✓', '#22c55e', 12); }
        else { badge(c, p.x, p.y - 20 * z, '✕', '#6b7280', 12); }
      }
    },
    progress: () => 1 - Math.min(1, cur.t / cur.dur),
    status: () => { const s = cur.items.filter(i => i.st === 'safe').length; return `Gesichert ${s}/${cur.items.length}`; },
    finish() {
      const safe = cur.items.filter(i => i.st === 'safe').length, lost = cur.items.length - safe, f = fScale();
      let got = null, text;
      clearOwnEvent();
      if (!lost) { got = reward({ stars: Math.round(6 * f), euro: nice(250 * rs()) }); text = 'Alle Zelte stehen noch – Glück gehabt und flink reagiert!'; }
      else {
        got = safe ? reward({ euro: nice(40 * safe * rs()) }) : null;
        addEffect('Sturmschäden', 120, { sat: -Math.min(15, 3 * lost) }, 'storm');
        text = `${lost} Zelt${lost > 1 ? 'e wurden' : ' wurde'} umgeweht. Die Gäste sind verärgert.`;
      }
      finishWithModal('Sturm vorbei', 'storm', text, got);
      end();
    },
  };

  /* ================= Feuerwehr-Alarm ================= */
  const fire = {
    id: 'fire', title: 'Feuer-Alarm!', hint: 'Tippe schnell auf die Flammen, um sie zu löschen!',
    can: () => Game.S.rl >= 2 && liveBuildings().length >= 3,
    weight: () => 2,
    start() {
      const n = Game.S.rl >= 4 ? 2 : 1;
      const spots = byVisible(liveBuildings()).slice(0, n).map(b => ({ b, hp: 7, st: 'burn' }));
      begin({ ...fire, spots, dur: 16 });
    },
    update(dt) {
      if (cur.spots.every(s => s.st !== 'burn')) { cur.endT += dt; if (cur.endT > 0.8) fire.finish(); return; }
      if (cur.t >= cur.dur) { for (const s of cur.spots) if (s.st === 'burn') { s.st = 'burned'; } api.play('bad'); fire.finish(); }
    },
    tap(x, y) {
      let best = null, bd = hitR(46, 40);
      for (const s of cur.spots) {
        if (s.st !== 'burn') continue;
        const p = centerPx(s.b), d = Math.hypot(p.x - x, p.y - y);
        if (d < bd) { bd = d; best = s; }
      }
      if (!best) return false;
      best.hp--; api.play('drop'); api.haptic(10);
      const p = centerPx(best.b);
      spark(x, y, 8, ['#38bdf8', '#7dd3fc', '#e0f2fe'], 120);
      if (best.hp <= 0) { best.st = 'out'; api.play('star'); spark(p.x, p.y, 18, ['#e5e7eb', '#9ca3af'], 70); Render.floatText(center(best.b).x, center(best.b).y, 50, 'Gelöscht!', '#bae6fd'); }
      return true;
    },
    draw(c) {
      const z = Render.cam.zoom, tm = clock();
      for (const s of cur.spots) {
        const p = centerPx(s.b);
        if (s.st === 'burn') {
          const k = (0.55 + 0.45 * s.hp / 7) * (1 + cur.t / cur.dur * 0.5) * Math.max(0.8, z);
          // Rauch
          for (let i = 0; i < 4; i++) { const u = ((tm * 0.6 + i * 0.25) % 1); c.globalAlpha = 0.5 * (1 - u); c.fillStyle = '#4b5563'; c.beginPath(); c.arc(p.x + Math.sin(tm * 2 + i) * 8 * k, p.y - 20 * k - u * 60 * k, (8 + u * 14) * k, 0, 7); c.fill(); }
          c.globalAlpha = 1;
          for (let i = -1; i <= 1; i++) {
            const h = (26 + Math.sin(tm * 11 + i * 2) * 6) * k * (i === 0 ? 1.25 : 0.9);
            flame(c, p.x + i * 12 * k, p.y, h, '#ef4444'); flame(c, p.x + i * 12 * k, p.y, h * 0.7, '#fb923c'); flame(c, p.x + i * 12 * k, p.y, h * 0.4, '#fde047');
          }
          // Lebensbalken
          bar(c, p.x, p.y + 12 * z + 6, 44, s.hp / 7, '#38bdf8');
        } else if (s.st === 'out') badge(c, p.x, p.y - 20 * z, '✓', '#22c55e', 12);
        else { c.fillStyle = 'rgba(30,30,30,0.35)'; c.beginPath(); c.arc(p.x, p.y - 10, 22 * z, 0, 7); c.fill(); badge(c, p.x, p.y - 20 * z, '✕', '#6b7280', 12); }
      }
    },
    progress: () => 1 - Math.min(1, cur.t / cur.dur),
    status: () => `Gelöscht ${cur.spots.filter(s => s.st === 'out').length}/${cur.spots.length}`,
    finish() {
      const out = cur.spots.filter(s => s.st === 'out').length, burned = cur.spots.length - out, f = fScale();
      let got, text;
      if (!burned) { got = reward({ stars: Math.round(5 * f), euro: nice(300 * rs()) }); text = 'Feuer aus! Die Gäste jubeln dem Platzwart zu.'; }
      else {
        got = out ? reward({ euro: nice(100 * rs()) }) : null;
        addEffect('Brandschaden', 150, { sat: -6 * burned }, 'fire');
        text = `${burned} Brandherd${burned > 1 ? 'e sind' : ' ist'} außer Kontrolle geraten. Die Gäste sind erschüttert.`;
      }
      finishWithModal('Feuer-Alarm vorbei', 'fire', text, got);
      end();
    },
  };

  /* ================= Waschbär ================= */
  const raccoon = {
    id: 'raccoon', title: 'Waschbär-Alarm!', hint: 'Ein Waschbär schleicht zu deinen Vorräten – fang ihn ab!',
    can: () => liveBuildings().length >= 2,
    weight: () => (isNight() ? 3 : 1.5),
    start() {
      const target = pick(liveBuildings(b => Game.def(b.type).produces === 'euro' || b.type === 'reception')) || pick(liveBuildings());
      const tc = Game.doorOf(target), ang = Math.random() * 6.283, N = Game.N;
      const tx = tc.x + 0.5, ty = tc.y + 0.5;
      const sx = Math.max(0.5, Math.min(N - 0.5, tx + Math.cos(ang) * 10)), sy = Math.max(0.5, Math.min(N - 0.5, ty + Math.sin(ang) * 10));
      begin({ ...raccoon, target, tx, ty, sx, sy, x: sx, y: sy, ph: 'sneak', stolen: 0, dir: 1, dur: 40, fleeT: 0 });
    },
    update(dt) {
      const r = cur;
      if (r.ph === 'sneak') {
        const dx = r.tx - r.x, dy = r.ty - r.y, d = Math.hypot(dx, dy), v = 1.5 + Math.sin(r.t * 5) * 0.4;
        r.x += dx / d * v * dt; r.y += dy / d * v * dt; r.dir = dx >= 0 ? 1 : -1;
        if (d < 0.7) {
          const S = Game.S;
          r.stolen = Math.min(Math.floor(S.res.euro), nice(180 * rs()));
          S.res.euro -= r.stolen; Game.emit('res');
          r.ph = 'flee'; api.play('bad'); Render.floatText(r.x, r.y, 36, `−${Game.fmtNum(r.stolen)} €`, '#fca5a5');
        }
      } else if (r.ph === 'flee') {
        const dx = r.sx - r.x, dy = r.sy - r.y, d = Math.hypot(dx, dy) || 1;
        r.x += dx / d * 3.4 * dt; r.y += dy / d * 3.4 * dt; r.dir = dx >= 0 ? 1 : -1; r.fleeT += dt;
        if (d < 0.5 || r.fleeT > 6) {
          addEffect('Vorräte geplündert', 60, { sat: -3 });
          finishWithModal('Der Waschbär ist entwischt', 'info', `Er hat ${Game.fmtNum(r.stolen)} € mitgenommen und ist im Wald verschwunden.`, null);
          end();
        }
      } else { r.endT += dt; if (r.endT > 0.5) end(); }
    },
    tap(x, y) {
      const r = cur;
      if (r.ph === 'caught') return false;
      const p = gs(r.x, r.y, 0);
      if (Math.hypot(p.x - x, (p.y - 10 * Render.cam.zoom - y) * 0.8) > hitR(36, 26)) return false;
      const wasStolen = r.stolen;
      r.ph = 'caught'; r.endT = 0;
      api.play('bark'); api.haptic([20, 40, 20]);
      Render.hearts(r.x, r.y);
      const got = reward({ euro: nice(120 * rs()) + wasStolen, stars: wasStolen ? 2 : 3 });
      finishWithModal('Waschbär gefangen!', 'info', wasStolen ? 'Du hast ihn erwischt – und die Beute gleich zurückgeholt!' : 'Rechtzeitig abgefangen! Die Vorräte sind sicher.', got);
      return true;
    },
    draw(c) {
      const r = cur; if (r.ph === 'caught') return;
      const p = gs(r.x, r.y, 0), z = Math.max(0.8, Render.cam.zoom), tm = clock();
      c.save(); c.translate(p.x, p.y);
      c.globalAlpha = 0.25; c.fillStyle = '#000'; c.beginPath(); c.ellipse(0, 0, 11 * z, 3.5 * z, 0, 0, 7); c.fill(); c.globalAlpha = 1;
      c.scale(z * r.dir, z);
      const hop = Math.abs(Math.sin(tm * 14)) * 3;
      c.translate(0, -hop);
      // Schwanz mit Ringen
      c.strokeStyle = '#6b7280'; c.lineWidth = 5; c.lineCap = 'round'; c.beginPath(); c.moveTo(-9, -9); c.quadraticCurveTo(-18, -12, -16, -20); c.stroke();
      c.strokeStyle = '#1f2937'; c.lineWidth = 5; for (const o of [0.3, 0.65]) { c.beginPath(); const q = quad(-9, -9, -18, -12, -16, -20, o); c.moveTo(q[0] - 1, q[1]); c.lineTo(q[0] + 1, q[1]); c.stroke(); }
      c.fillStyle = '#9ca3af'; c.strokeStyle = '#374151'; c.lineWidth = 1.2; c.beginPath(); c.ellipse(0, -9, 10, 6, 0, 0, 7); c.fill(); c.stroke();
      c.beginPath(); c.arc(9, -13, 5.5, 0, 7); c.fill(); c.stroke();
      c.fillStyle = '#1f2937'; c.beginPath(); c.ellipse(10, -14, 4.5, 2.4, 0, 0, 7); c.fill();       // Maske
      c.fillStyle = '#fff'; c.beginPath(); c.arc(11, -14, 0.9, 0, 7); c.fill();
      c.fillStyle = '#9ca3af'; c.beginPath(); c.arc(6, -18, 2, 0, 7); c.arc(11, -18, 2, 0, 7); c.fill();
      if (r.ph === 'flee') { c.fillStyle = '#ca8a04'; c.strokeStyle = '#713f12'; c.beginPath(); c.arc(-3, -16, 5, 0, 7); c.fill(); c.stroke(); }
      c.restore();
      // Zeiger über dem Tier
      badge(c, p.x, p.y - 38 * z + Math.sin(tm * 6) * 3, r.ph === 'flee' ? '!' : '?', r.ph === 'flee' ? '#ef4444' : '#facc15', 9);
      // Ziel markieren
      if (r.ph === 'sneak') { const t = centerPx(r.target); c.strokeStyle = 'rgba(250,204,21,0.9)'; c.lineWidth = 2; c.setLineDash([6, 5]); c.beginPath(); c.arc(t.x, t.y, 24 * z, 0, 7); c.stroke(); c.setLineDash([]); }
    },
    progress: () => (cur.ph === 'flee' ? 1 - cur.fleeT / 6 : 1),
    status: () => (cur.ph === 'flee' ? 'Er flüchtet mit der Beute!' : 'Er schleicht zu den Vorräten …'),
  };

  /* ================= Kritiker-Besuch ================= */
  // Immer sehr schwer, aber machbar: Der Kritiker ist streng (alle Bedürfnisse −15 %), so dass auch ein gut
  // ausgebauter Platz nicht von allein auf 90 % kommt. Per Tipp auf den Kritiker gibt es je Bedürfnis eine
  // Charme-Offensive (+30 %, kostet Geld). Gestartet wird nur, wenn jedes Bedürfnis ohne Mods bei >= 75 % liegt –
  // dann reicht 0.75 − 0.15 + 0.30 = 0.90 gerade so.
  const CRITIC = { strict: 0.15, charm: 0.3, minBase: 0.75, top: 0.895, ok: 0.7 };
  const criticCost = () => nice(120 * rs());
  const criticNeeds = () => { const s = Game.satisfaction(); return NEED_ORDER.filter(n => Game.needAvailable(n, Game.S.rl) && s.needs[n].demand > 0); };
  // läuft unser „Strenger Kritiker“-Ereignis noch? (könnte theoretisch ersetzt worden sein)
  const criticEvent = () => (cur && cur.ev && Game.S.event === cur.ev ? cur.ev : null);
  const critic = {
    id: 'critic', title: 'Kritiker-Besuch!', hint: 'Ein strenger Tester vom Campingführer ist da – tippe ihn für eine Charme-Offensive an (kostet Geld)!',
    can() {
      if (Game.S.rl < 2 || Game.G.guests.length < 3 || !eventFree()) return false;
      const s = Game.satisfaction(), list = criticNeeds();
      return list.length > 0 && list.every(n => s.needs[n].base >= CRITIC.minBase);
    },
    weight: () => (isNight() ? 0.5 : 1.4),
    start() {
      if (!eventFree()) return;
      const g = pickGuest(); if (!g) return;
      const dur = 90, needs = {};
      for (const n of NEED_ORDER) if (Game.needAvailable(n, Game.S.rl)) needs[n] = -CRITIC.strict;   // nur bekannte Bedürfnisse (Statusleiste)
      setEvent('Strenger Kritiker', dur + 3, { needs }, null, 'clipboard');
      begin({ ...critic, gid: g.id, dur, charmed: {}, ev: Game.S.event });
      api.toast('Ein Kritiker ist angereist – er sieht aus wie ein normaler Gast …');
    },
    update() {
      if (!Game.G.guests.some(g => g.id === cur.gid)) { const g = pickGuest(); if (g) cur.gid = g.id; }
      // Dialoge pausieren das Spiel, die Ereigniszeit läuft aber in Echtzeit weiter → Strenge mitziehen
      const ev = criticEvent();
      if (ev) { const until = Date.now() + (Math.max(0, cur.dur - cur.t) + 3) * 1000; if (ev.until < until) ev.until = until; }
      cur.weak = weakest();
      if (cur.t >= cur.dur) critic.finish();
    },
    tap(x, y) {
      const g = Game.G.guests.find(q => q.id === cur.gid); if (!g) return false;
      const p = gs(g.x, g.y, 0), top = p.y - 26 * Render.cam.zoom;
      if (Math.hypot(x - p.x, ((p.y + top) / 2 - y) * 0.7) > hitR(30, 20)) return false;
      const w = weakest(), name = NEEDS[w.n].name, ev = criticEvent();
      if (w.f >= CRITIC.top) { api.play('pop'); api.toast('Der Kritiker nickt zufrieden … mehr Charme braucht es gerade nicht.'); return true; }
      if (cur.charmed[w.n] || !ev) {
        api.play('pop');
        api.toast(`Der Kritiker notiert: „${name} nur ${Math.round(w.f * 100)} %“ – jetzt hilft nur noch Bauen oder Ausbauen.`);
        return true;
      }
      const c = criticCost();
      if (!Game.canAfford({ euro: c })) { api.play('bad'); api.toast(`Dir fehlen ${Game.fmtNum(Math.ceil(c - Game.S.res.euro))} € für die Charme-Offensive.`); return true; }
      Game.S.res.euro -= c; Game.emit('res');
      ev.mods.needs[w.n] = (ev.mods.needs[w.n] || 0) + CRITIC.charm;
      cur.charmed[w.n] = true; Game.G.sat = null;
      cur.weak = weakest();
      api.play('coin'); api.haptic(15);
      spark(p.x, top - 10, 16, ['#fde68a', '#fbbf24', '#f9a8d4'], 120);
      Render.floatText(g.x, g.y, 46, `Charme: ${name} +${Math.round(CRITIC.charm * 100)} %`, '#fde68a');
      Render.floatText(g.x, g.y, 30, `−${Game.fmtNum(c)} €`, '#fca5a5');
      return true;
    },
    draw(c) {
      const g = Game.G.guests.find(q => q.id === cur.gid); if (!g) return;
      const p = gs(g.x, g.y, 0), z = Math.max(0.8, Render.cam.zoom), y = p.y - 26 * Render.cam.zoom - 22 + Math.sin(clock() * 5) * 3;
      c.fillStyle = '#fbbf24'; c.strokeStyle = 'rgba(60,40,20,0.9)'; c.lineWidth = 2;
      starPath(c, p.x, y, 12 * z, 5.5 * z); c.fill(); c.stroke();
      c.font = '900 10px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      const w = c.measureText('KRITIKER').width + 12;
      c.fillStyle = 'rgba(30,20,10,0.85)'; c.beginPath(); c.roundRect(p.x - w / 2, y - 29 * z, w, 15, 7); c.fill();
      c.fillStyle = '#fde68a'; c.fillText('KRITIKER', p.x, y - 21.5 * z);
    },
    progress: () => 1 - Math.min(1, cur.t / cur.dur),
    status() {
      const w = cur.weak; if (!w) return '';
      const head = `Schwächstes: ${NEEDS[w.n].name} ${Math.round(w.f * 100)} %`;
      if (w.f >= CRITIC.top) return `${head} – sehr gut, halte das Niveau!`;
      if (cur.charmed[w.n]) return `${head} – Charme verbraucht, nur Bauen/Ausbauen hilft`;
      return `${head} · Tippe den Kritiker: Charme (${Game.fmtNum(criticCost())} €)`;
    },
    statusOk: () => !!cur.weak && cur.weak.f >= CRITIC.top,
    finish() {
      const w = weakest(), f = fScale();
      clearOwnEvent();                                 // Strenge (und Charme) wirken nicht nach
      let got, text;
      if (w.f >= CRITIC.top) { got = reward({ stars: Math.round(20 * f), euro: nice(300 * rs()) }); text = 'Fünf Sterne! Selbst der strenge Kritiker schwärmt in seiner Zeitung von deinem Platz.'; }
      else if (w.f >= CRITIC.ok) { got = reward({ stars: Math.round(8 * f) }); text = `Ordentlich – aber der strenge Kritiker fand bei „${NEEDS[w.n].name}“ (${Math.round(w.f * 100)} %) noch Luft nach oben.`; }
      else { got = reward({ stars: -Math.round(6 * f) }); text = `Verrissen! „${NEEDS[w.n].name}“ lag nur bei ${Math.round(w.f * 100)} % – das gibt Abzüge.`; }
      finishWithModal('Kritiker-Urteil', 'clipboard', text, got);
      end();
    },
  };
  function pickGuest() {
    const l = Game.G.guests.filter(g => g.state !== 'arrive' && g.state !== 'leave' && g.state !== 'checkin');
    return l.length ? pick(l) : null;
  }
  function weakest() {
    const s = Game.satisfaction(); let best = { n: 'hygiene', f: 1 };
    for (const n of NEED_ORDER) if (Game.needAvailable(n, Game.S.rl) && s.needs[n].demand > 0 && s.needs[n].f < best.f) best = { n, f: s.needs[n].f };
    return best;
  }

  /* ================= Hund verloren – Suchspiel ================= */
  const dogHide = {
    id: 'dogHide', title: 'Bello ist weg!', hint: 'Tippe auf den Platz – „heiß“ bedeutet: Du bist nah dran!',
    can: () => !Game.G.dog && Game.G.guests.length >= 1,
    weight: () => 2,
    start() {
      const rec = Game.S.buildings.find(b => b.type === 'reception');
      const home = rec ? Game.doorOf(rec) : Game.gateTile();
      const spot = randTile(7, home); if (!spot) return;
      begin({ ...dogHide, spot, dur: 75, found: false, taps: 0, off: { x: rand(-1.5, 1.5), y: rand(-1.5, 1.5) } });
    },
    update() { if (cur.t >= cur.dur) { api.toast('Bello ist von allein zu seinem Besitzer zurückgelaufen.'); end(); } },
    tap(x, y) {
      if (cur.found) return false;
      // echte Gebäude, Blasen, Fundstücke und Gäste bleiben bedienbar – Wege, Büsche, Bäume und Steine werden durchsucht
      const solid = b => { const d = Game.def(b.type); return d.cat !== 'obstacle' && !d.flat && !d.walkable; };
      if (Render.hitBuilding(x, y, solid) || Render.hitBubble(x, y) || Render.hitPickup(x, y) || Render.hitGuest(x, y)) return false;
      const g = Render.screenToGrid(x, y), d = Math.hypot(g.x - cur.spot.x, g.y - cur.spot.y);
      if (d < 1.6) {
        cur.found = true; api.play('bark'); api.haptic([20, 40, 20]);
        Render.hearts(cur.spot.x, cur.spot.y); Render.confetti(cur.spot.x - 1, cur.spot.y - 1, 2, 2, 30);
        const got = reward({ stars: 5, euro: nice(200 * rs()) });
        finishWithModal('Bello gefunden!', 'dog', 'Er hat sich im Gebüsch versteckt. Der Besitzer ist überglücklich und bedankt sich herzlich.', got);
        end(); return true;
      }
      const [txt, col] = d > 11 ? ['Eiskalt', '#93c5fd'] : d > 7 ? ['Kalt', '#bae6fd'] : d > 4 ? ['Warm', '#fde68a'] : ['Heiß!', '#fb7185'];
      cur.taps++; api.play('tick');
      Render.floatText(g.x, g.y, 14, txt, col);
      return true;
    },
    draw(c) {
      if (cur.t > cur.dur * 0.45 && !cur.found) {   // Hinweis: ungefähre Gegend
        const mid = { x: cur.spot.x + cur.off.x, y: cur.spot.y + cur.off.y }, r = 4.5;
        const pts = [[r, 0], [0, r], [-r, 0], [0, -r]].map(o => gs(mid.x + o[0], mid.y + o[1], 0));
        c.globalAlpha = 0.18 + 0.1 * Math.sin(clock() * 4); c.fillStyle = '#fde047';
        c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.closePath(); c.fill();
        c.globalAlpha = 1; c.strokeStyle = 'rgba(253,224,71,0.8)'; c.setLineDash([8, 6]); c.lineWidth = 2; c.stroke(); c.setLineDash([]);
      }
    },
    progress: () => 1 - Math.min(1, cur.t / cur.dur),
    status: () => (cur.t > cur.dur * 0.45 ? 'Hinweis: Er versteckt sich in der markierten Gegend' : 'Tippe auf den Platz, um zu suchen'),
  };

  /* ================= Nacht: Glühwürmchen ================= */
  const fireflies = {
    id: 'fireflies', title: 'Glühwürmchen-Schwarm!', hint: 'Fange die leuchtenden Glühwürmchen mit einem Tipp!',
    can: () => isNight(),
    weight: () => 3,
    start() {
      const list = [];
      for (let i = 0; i < 9; i++) { const p = randTile(0); if (p) list.push({ x: p.x, y: p.y, vx: rand(-1, 1), vy: rand(-1, 1), ph: Math.random() * 6, caught: false }); }
      if (list.length < 4) return;
      begin({ ...fireflies, list, dur: 28, caught: 0 });
    },
    update(dt) {
      const a = Game.area();
      for (const f of cur.list) {
        if (f.caught) continue;
        f.vx += rand(-1, 1) * dt * 3; f.vy += rand(-1, 1) * dt * 3;
        const sp = Math.hypot(f.vx, f.vy) || 1, m = 1.1; f.vx = f.vx / sp * m; f.vy = f.vy / sp * m;
        f.x += f.vx * dt; f.y += f.vy * dt;
        if (f.x < a.x0 || f.x > a.x1) f.vx *= -1; if (f.y < a.y0 || f.y > a.y1) f.vy *= -1;
        f.x = Math.max(a.x0, Math.min(a.x1, f.x)); f.y = Math.max(a.y0, Math.min(a.y1, f.y));
        // im sichtbaren Bereich halten: sonst Richtung Bildmitte lenken
        if (!onScreen(gs(f.x, f.y, 18))) { const m = Render.screenToGrid(Render.size.W / 2, Render.size.H * 0.6), dx = m.x - f.x, dy = m.y - f.y, d = Math.hypot(dx, dy) || 1; f.vx = dx / d * 1.1; f.vy = dy / d * 1.1; }
      }
      if (cur.t >= cur.dur || cur.caught >= cur.list.length) fireflies.finish();
    },
    tap(x, y) {
      let best = null, bd = hitR(32, 22);
      for (const f of cur.list) {
        if (f.caught) continue;
        const p = gs(f.x, f.y, 18 + Math.sin(f.ph + clock() * 2) * 4), d = Math.hypot(p.x - x, p.y - y);
        if (d < bd) { bd = d; best = f; }
      }
      if (!best) return false;
      best.caught = true; cur.caught++; api.play('coin'); api.haptic(10);
      const p = gs(best.x, best.y, 18);
      spark(p.x, p.y, 10, ['#fef08a', '#fde047', '#fff'], 90);
      const g = Game.grant({ euro: nice(25 * rs()) });
      if (g.euro) { Render.flyRes(best.x, best.y, 18, 'euro', 2); Render.floatText(best.x, best.y, 30, `+${Game.fmtNum(g.euro)} €`, '#bbf7d0'); }
      return true;
    },
    draw(c) {
      c.globalCompositeOperation = 'lighter';
      for (const f of cur.list) {
        if (f.caught) continue;
        const p = gs(f.x, f.y, 18 + Math.sin(f.ph + clock() * 2) * 4), pulse = 0.65 + 0.35 * Math.sin(clock() * 5 + f.ph * 3);
        c.globalAlpha = pulse; c.drawImage(glowTex('#fde047'), p.x - 20, p.y - 20, 40, 40);
        c.globalAlpha = 1; c.drawImage(glowTex('#ffffff'), p.x - 5, p.y - 5, 10, 10);
      }
      c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    },
    progress: () => 1 - Math.min(1, cur.t / cur.dur),
    status: () => `Gefangen ${cur.caught}/${cur.list.length}`,
    finish() {
      const n = cur.caught, f = fScale();
      const got = n >= 7 ? reward({ stars: Math.round(3 * f), gems: 1 }) : n >= 4 ? reward({ stars: Math.round(1 * f) }) : null;
      finishWithModal('Glühwürmchen-Jagd', 'sun', n >= 7 ? 'Fast der ganze Schwarm! Die Kinder staunen.' : n >= 4 ? 'Ein hübsches Glas voll Licht.' : 'Die meisten sind entwischt – vielleicht klappt es beim nächsten Mal.', got);
      end();
    },
  };

  /* ================= Nacht: Nachtwanderung ================= */
  const walk = {
    id: 'walk', title: 'Nachtwanderung!', hint: 'Tippe die Laternen der Reihe nach an und führe die Gruppe sicher durch die Nacht!',
    can: () => isNight() && Game.G.guests.length >= 2,
    weight: () => 2.2,
    start() {
      const pts = []; let prev = null;
      for (let i = 0; i < 5; i++) { const p = randTile(3.5, prev); if (!p) break; pts.push(p); prev = p; }
      if (pts.length < 4) return;
      begin({ ...walk, pts, next: 0, dur: 32 });
    },
    update() { if (cur.t >= cur.dur || cur.next >= cur.pts.length) walk.finish(); },
    tap(x, y) {
      const bd = hitR(34, 24);
      for (let i = 0; i < cur.pts.length; i++) {
        if (i < cur.next) continue;
        const p = gs(cur.pts[i].x, cur.pts[i].y, 14);
        if (Math.hypot(p.x - x, p.y - y) < bd) {
          if (i !== cur.next) { api.play('error'); Render.floatText(cur.pts[i].x, cur.pts[i].y, 40, `Erst Nr. ${cur.next + 1}!`, '#fca5a5'); return true; }
          cur.next++; api.play('pop'); api.haptic(10);
          spark(p.x, p.y, 10, ['#fde68a', '#fbbf24', '#fff'], 90);
          const g = Game.grant({ euro: nice(30 * rs()) });
          if (g.euro) Render.floatText(cur.pts[i].x, cur.pts[i].y, 40, `+${Game.fmtNum(g.euro)} €`, '#bbf7d0');
          return true;
        }
      }
      return false;
    },
    draw(c) {
      const pts = cur.pts.map(p => gs(p.x, p.y, 14)), tm = clock();
      c.strokeStyle = 'rgba(253,230,138,0.45)'; c.lineWidth = 2; c.setLineDash([5, 6]); c.beginPath();
      pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.stroke(); c.setLineDash([]);
      c.globalCompositeOperation = 'lighter';
      pts.forEach((p, i) => {
        if (i < cur.next) return;
        const isNext = i === cur.next, k = isNext ? 1.3 + Math.sin(tm * 6) * 0.15 : 0.8;
        c.globalAlpha = isNext ? 0.95 : 0.5; c.drawImage(glowTex('#fbbf24'), p.x - 34 * k, p.y - 34 * k, 68 * k, 68 * k);
      });
      c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
      pts.forEach((p, i) => {
        if (i < cur.next) return;
        const isNext = i === cur.next;
        c.fillStyle = '#fef3c7'; c.strokeStyle = '#78350f'; c.lineWidth = 2;
        c.beginPath(); c.roundRect(p.x - 7, p.y - 10, 14, 18, 4); c.fill(); c.stroke();
        c.beginPath(); c.arc(p.x, p.y - 12, 5, Math.PI, 0); c.stroke();
        c.font = '900 12px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillStyle = isNext ? '#b45309' : '#a8a29e'; c.fillText(String(i + 1), p.x, p.y);
      });
    },
    progress: () => 1 - Math.min(1, cur.t / cur.dur),
    status: () => `Laterne ${Math.min(cur.next + 1, cur.pts.length)}/${cur.pts.length}`,
    finish() {
      const n = cur.next, f = fScale(); let got, text;
      if (n >= cur.pts.length) {
        got = reward({ stars: Math.round(4 * f), euro: nice(200 * rs()) });
        addEffect('Nachtwanderung', 150, { sat: 5, needs: { kultur: 0.15 } }, 'moon');
        text = 'Alle Laternen erreicht! Die Gruppe schwärmt von Sternenhimmel und Gruselgeschichten.';
      } else { got = n ? reward({ stars: Math.round(1 * f) }) : null; text = `Du hast ${n} von ${cur.pts.length} Laternen geschafft. Die Gruppe kehrt müde zurück.`; }
      finishWithModal('Nachtwanderung', 'moon', text, got);
      end();
    },
  };

  /* ================= Nacht: Feuerwerk-Finale ================= */
  const fireworks = {
    id: 'fireworks', title: 'Feuerwerk-Finale!', hint: 'Tippe, wenn sich der Ring schließt – im Takt!',
    can: () => Game.S.rl >= 2 && isNight(),
    weight: () => 2,
    start() {
      const { W, H } = Render.size, rockets = []; let prev = null;
      for (let i = 0; i < 10; i++) {
        let x, y, tries = 0;
        do { x = rand(W * 0.36, W * 0.82); y = rand(H * 0.33, H * 0.68); tries++; } while (prev && Math.hypot(x - prev.x, y - prev.y) < 110 && tries < 20);
        prev = { x, y };
        rockets.push({ x, y, at: 2.2 + i * 1.05, st: 'wait', col: pick([['#f43f5e', '#fda4af'], ['#facc15', '#fef08a'], ['#22d3ee', '#a5f3fc'], ['#a855f7', '#e9d5ff'], ['#4ade80', '#bbf7d0']]) });
      }
      begin({ ...fireworks, rockets, dur: rockets[9].at + 2, score: 0, perfect: 0, good: 0 });
    },
    update(dt) {
      for (const r of cur.rockets) if (r.st === 'wait' && cur.t > r.at + 0.65) { r.st = 'miss'; spark(r.x, r.y, 6, ['#6b7280', '#9ca3af'], 40); }
      if (cur.t >= cur.dur) { cur.endT += dt; if (cur.endT > 0.5) fireworks.finish(); }
    },
    tap(x, y) {
      let best = null, bt = 1;
      for (const r of cur.rockets) {
        if (r.st !== 'wait') continue;
        const dt = Math.abs(cur.t - r.at);
        if (cur.t < r.at - 1.5 || Math.hypot(r.x - x, r.y - y) > hitR(54, 40) || dt > 0.7) continue;
        if (dt < bt) { bt = dt; best = r; }
      }
      if (!best) return false;
      const perfect = bt < 0.22;
      best.st = perfect ? 'perfect' : 'good';
      if (perfect) { cur.perfect++; cur.score += 2; } else { cur.good++; cur.score += 1; }
      api.play(perfect ? 'star' : 'pop'); api.haptic(perfect ? [10, 20, 10] : 10);
      spark(best.x, best.y, perfect ? 60 : 32, best.col.concat(['#fff']), perfect ? 230 : 170);
      const gp = Render.screenToGrid(best.x, best.y);
      Render.floatText(gp.x, gp.y, 30, perfect ? 'Perfekt!' : 'Gut!', perfect ? '#fde047' : '#e5e7eb');
      return true;
    },
    draw(c) {
      for (const r of cur.rockets) {
        if (r.st !== 'wait') continue;
        const u = (cur.t - (r.at - 1.5)) / 1.5;
        if (u < 0) continue;
        const rad = 60 - 38 * Math.min(1.1, u), near = Math.abs(cur.t - r.at) < 0.22;
        c.lineWidth = near ? 5 : 3; c.strokeStyle = near ? '#fde047' : 'rgba(255,255,255,0.85)';
        c.beginPath(); c.arc(r.x, r.y, Math.max(8, rad), 0, 7); c.stroke();
        c.strokeStyle = 'rgba(253,224,71,0.55)'; c.lineWidth = 2; c.beginPath(); c.arc(r.x, r.y, 22, 0, 7); c.stroke();
        c.globalAlpha = 0.9; c.fillStyle = r.col[0]; c.beginPath(); c.arc(r.x, r.y, 6 + (near ? 3 : 0), 0, 7); c.fill(); c.globalAlpha = 1;
      }
    },
    progress: () => 1 - Math.min(1, cur.t / cur.dur),
    status: () => `Punkte ${cur.score}/20`,
    finish() {
      const s = cur.score, f = fScale(); let got, text;
      if (s >= 16) {
        got = reward({ stars: Math.round(10 * f), euro: nice(300 * rs()) });
        addEffect('Feuerwerk-Begeisterung', 150, { guestRate: 2.2, income: 1.3 }, 'festival');
        const a = Game.area(); Render.confetti(a.x0, a.y0, a.x1 - a.x0, a.y1 - a.y0, 80);
        text = 'Ein spektakuläres Finale! Das Spektakel lockt neue Gäste an.';
      } else if (s >= 8) {
        got = reward({ stars: Math.round(4 * f), euro: nice(100 * rs()) });
        addEffect('Feuerwerk', 120, { guestRate: 1.5 }, 'festival');
        text = 'Ein schönes Feuerwerk – die Gäste klatschen Beifall.';
      } else { got = reward({ euro: nice(40 * rs()) }); text = 'Da war mehr drin – aber ein paar Raketen haben gezündet.'; }
      finishWithModal('Feuerwerk-Finale', 'festival', text, got);
      end();
    },
  };

  /* ================= Sternschnuppe (nebenbei, nachts) ================= */
  function updateSky(dt) {
    if (skyStar) {
      skyStar.t += dt;
      if (skyStar.t > skyStar.dur) skyStar = null;
      return;
    }
    if (!isNight() || (cur && cur.id === 'fireworks')) { skyT = Math.max(skyT, 8); return; }
    skyT -= dt;
    if (skyT > 0) return;
    const { W, H } = Render.size;
    skyT = rand(30, 70);
    const dir = Math.random() < 0.5 ? 1 : -1;
    skyStar = { x0: dir > 0 ? rand(W * 0.05, W * 0.45) : rand(W * 0.55, W * 0.95), y0: rand(H * 0.33, H * 0.42), dx: dir * rand(W * 0.3, W * 0.42), dy: rand(H * 0.12, H * 0.22), t: 0, dur: 3.2 };
    api.play('tick');
  }
  function skyPos(s) { const u = s.t / s.dur; return { x: s.x0 + s.dx * u, y: s.y0 + s.dy * u * u * 0.4 + s.dy * u * 0.6, u }; }
  function tapSky(x, y) {
    if (!skyStar) return false;
    const p = skyPos(skyStar);
    if (Math.hypot(p.x - x, p.y - y) > 46) return false;
    skyStar = null; api.play('gem'); api.haptic([15, 30, 15]);
    spark(p.x, p.y, 28, ['#fde047', '#fff', '#fbbf24'], 160);
    const got = Game.grant(Math.random() < 0.2 ? { stars: 1, gems: 1 } : { stars: 1, euro: nice(50 * rs()) });
    Game.S.stats.shootingStars = (Game.S.stats.shootingStars || 0) + 1;
    const g = Render.screenToGrid(p.x, p.y);
    Render.floatText(g.x, g.y, 30, 'Wunsch erfüllt! ' + Object.keys(got).map(k => '+' + got[k] + (k === 'stars' ? ' ★' : k === 'gems' ? ' 💎' : ' €')).join(' '), '#fde047');
    return true;
  }

  /* ---------------- Zeichenhelfer ---------------- */
  const glowCv = {};
  function glowTex(col) {
    if (glowCv[col]) return glowCv[col];
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const x = cv.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, col); g.addColorStop(0.3, col + '88'); g.addColorStop(1, col + '00');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    return (glowCv[col] = cv);
  }
  function quad(x0, y0, x1, y1, x2, y2, t) { const a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t; return [a * x0 + b * x1 + c * x2, a * y0 + b * y1 + c * y2]; }
  function ring(c, x, y, r, frac, col) {
    c.lineWidth = 5; c.strokeStyle = 'rgba(0,0,0,0.35)'; c.beginPath(); c.arc(x, y, r + 4, 0, 7); c.stroke();
    c.strokeStyle = col; c.beginPath(); c.arc(x, y, r + 4, -Math.PI / 2, -Math.PI / 2 + 6.283 * frac); c.stroke();
  }
  function badge(c, x, y, txt, col, r) {
    c.fillStyle = col; c.strokeStyle = 'rgba(60,40,20,0.9)'; c.lineWidth = 2; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); c.stroke();
    c.fillStyle = '#fff'; c.font = `900 ${Math.round(r * 1.25)}px system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(txt, x, y + 1);
  }
  function bar(c, x, y, w, f, col) {
    c.fillStyle = 'rgba(0,0,0,0.5)'; c.beginPath(); c.roundRect(x - w / 2 - 2, y - 5, w + 4, 10, 5); c.fill();
    c.fillStyle = col; c.beginPath(); c.roundRect(x - w / 2, y - 3, Math.max(4, w * f), 6, 3); c.fill();
  }
  function flame(c, x, y, h, col) {
    c.fillStyle = col; c.beginPath(); c.moveTo(x - h * 0.28, y); c.quadraticCurveTo(x - h * 0.34, y - h * 0.5, x, y - h); c.quadraticCurveTo(x + h * 0.34, y - h * 0.5, x + h * 0.28, y); c.closePath(); c.fill();
  }
  function starPath(c, x, y, R, r) { c.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, q = i % 2 ? r : R; c.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q); } c.closePath(); }

  const LIST = [storm, fire, raccoon, critic, dogHide, fireflies, walk, fireworks];

  /* ---------------- Öffentliche Schnittstelle ---------------- */
  function update(dt) {
    if (!api || !Game.S) return;
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i]; s.life += dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 220 * dt; s.vx *= 0.985;
      if (s.life > s.max) sparks.splice(i, 1);
    }
    if (api.busy()) return;                           // Dialog offen: alles pausiert
    updateSky(dt);
    if (cur) { cur.t += dt; cur.update(dt); return; }
    nextIn -= dt;
    // nicht während/kurz vor einem normalen Ereignis (begin() schiebt das nächste normale Ereignis ohnehin nach hinten)
    if (nextIn > 0 || Game.G.pendingEvent || !eventFree() || Game.S.nextEventAt - Date.now() < 15000) return;
    const opts = LIST.filter(a => a.can());
    if (!opts.length) { nextIn = 20; return; }
    let r = Math.random() * opts.reduce((s, a) => s + a.weight(), 0), chosen = opts[0];
    for (const a of opts) { r -= a.weight(); if (r <= 0) { chosen = a; break; } }
    chosen.start();
    if (!cur) nextIn = 20;
  }

  function tap(x, y) {
    if (!api || !Game.S) return false;
    if (api.busy()) return false;
    if (tapSky(x, y)) return true;
    return !!(cur && cur.tap && cur.tap(x, y));
  }

  function draw(c) {
    if (!api || !Game.S) return;
    c.save(); c.lineJoin = 'round';
    if (cur && cur.draw) cur.draw(c);
    if (skyStar) {
      const p = skyPos(skyStar), tail = 90, k = Math.sqrt(skyStar.dx * skyStar.dx + skyStar.dy * skyStar.dy);
      const ux = skyStar.dx / k, uy = skyStar.dy / k;
      const g = c.createLinearGradient(p.x, p.y, p.x - ux * tail, p.y - uy * tail);
      g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.strokeStyle = g; c.lineWidth = 3; c.lineCap = 'round'; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x - ux * tail, p.y - uy * tail); c.stroke();
      c.globalCompositeOperation = 'lighter'; c.drawImage(glowTex('#fde047'), p.x - 22, p.y - 22, 44, 44); c.globalCompositeOperation = 'source-over';
      const pulse = 1 + Math.sin(clock() * 14) * 0.15;
      c.strokeStyle = 'rgba(253,224,71,0.75)'; c.lineWidth = 1.5; c.beginPath(); c.arc(p.x, p.y, 22 * pulse, 0, 7); c.stroke();
    }
    for (const s of sparks) {
      c.globalAlpha = Math.max(0, 1 - s.life / s.max); c.fillStyle = s.c;
      c.beginPath(); c.arc(s.x, s.y, s.r, 0, 7); c.fill();
    }
    c.globalAlpha = 1;
    if (cur) banner(c);
    c.restore();
  }

  function wrap(c, text, maxW) {
    if (!text || c.measureText(text).width <= maxW) return [text || ''];
    const words = text.split(' '), out = []; let ln = '';
    for (const wd of words) { const t = ln ? ln + ' ' + wd : wd; if (ln && c.measureText(t).width > maxW) { out.push(ln); ln = wd; } else ln = t; }
    if (ln) out.push(ln);
    return out;
  }
  function banner(c) {
    const { W } = Render.size, intro = cur.t < 3.2;
    const title = cur.title, line = intro ? cur.hint : (cur.status ? cur.status() : '');
    const ok = cur.statusOk ? cur.statusOk() : null;
    // zwischen linker HUD-Spalte (Bedürfnisleiste) und rechter Ressourcenspalte
    const w = Math.max(240, Math.min(380, W - 524)), x = W / 2 - w / 2, y = 62;
    // Zeile bei Bedarf auf zwei Zeilen umbrechen
    c.font = '600 12px system-ui, sans-serif';
    const lines = wrap(c, line, w - 24).slice(0, 2), h = 32 + lines.length * 15;
    c.globalAlpha = 0.92; c.fillStyle = 'rgba(40,25,10,0.88)'; c.strokeStyle = '#fbbf24'; c.lineWidth = 2;
    c.beginPath(); c.roundRect(x, y, w, h, 14); c.fill(); c.stroke(); c.globalAlpha = 1;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = '900 14px ui-rounded, system-ui, sans-serif'; c.fillStyle = '#fde68a'; c.fillText(title, W / 2, y + 14, w - 20);
    c.font = '600 12px system-ui, sans-serif'; c.fillStyle = ok === null ? '#fff' : ok ? '#bbf7d0' : '#fecaca';
    lines.forEach((l, i) => c.fillText(l, W / 2, y + 30 + i * 15, w - 20));
    const p = cur.progress ? Math.max(0, Math.min(1, cur.progress())) : 1;
    c.fillStyle = 'rgba(255,255,255,0.18)'; c.beginPath(); c.roundRect(x + 12, y + h - 6, w - 24, 3, 2); c.fill();
    c.fillStyle = p > 0.3 ? '#fbbf24' : '#ef4444'; c.beginPath(); c.roundRect(x + 12, y + h - 6, Math.max(3, (w - 24) * p), 3, 2); c.fill();
  }

  return {
    init(a) { api = a; },
    update, tap, draw,
    start(id) { if (cur) return false; const a = LIST.find(q => q.id === id); if (!a) return false; a.start(); return !!cur; },
    skyStar() { if (!skyStar) { skyT = 0; } },
    get current() { return cur ? cur.id : null; },
    ids: LIST.map(a => a.id),
    // Test-/Debug-Helfer: aktuell antippbare Ziele (Bildschirmkoordinaten) und Zeitsprung
    _targets() {
      const out = [];
      if (skyStar) out.push(skyPos(skyStar));
      if (!cur) return out;
      const z = Render.cam.zoom;
      if (cur.id === 'storm') cur.items.forEach(i => i.st === 'warn' && out.push(centerPx(i.b)));
      else if (cur.id === 'fire') cur.spots.forEach(s => s.st === 'burn' && out.push(centerPx(s.b)));
      else if (cur.id === 'raccoon' && cur.ph !== 'caught') { const p = gs(cur.x, cur.y, 0); out.push({ x: p.x, y: p.y - 10 * z }); }
      else if (cur.id === 'critic') { const g = Game.G.guests.find(q => q.id === cur.gid); if (g) { const p = gs(g.x, g.y, 0); out.push({ x: p.x, y: p.y - 13 * z }); } }
      else if (cur.id === 'dogHide') out.push(gs(cur.spot.x, cur.spot.y, 0));
      else if (cur.id === 'fireflies') cur.list.forEach(f => !f.caught && out.push(gs(f.x, f.y, 18 + Math.sin(f.ph + clock() * 2) * 4)));
      else if (cur.id === 'walk' && cur.next < cur.pts.length) out.push(gs(cur.pts[cur.next].x, cur.pts[cur.next].y, 14));
      else if (cur.id === 'fireworks') cur.rockets.forEach(r => r.st === 'wait' && Math.abs(cur.t - r.at) < 0.12 && out.push({ x: r.x, y: r.y }));
      return out;
    },
    _ff(sec) { if (cur) cur.t += sec; },
    _can(id) { const a = LIST.find(q => q.id === id); return !!(a && a.can()); },
  };
})();
