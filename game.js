'use strict';
/* ==========================================================================
 * game.js – Spiellogik (unabhängig von Darstellung und Eingabe)
 * Zustand S wird gespeichert, Laufzeitdaten G (Gäste, Hund …) nicht.
 * ========================================================================== */

const Game = (() => {
  const N = CONFIG.map.size;
  let S = null;                 // persistenter Spielstand
  const G = {                   // Laufzeit
    guests: [], nextArrival: 0, pitchOwner: new Map(), guestSeq: 0,
    pendingEvent: null, dog: null, gridVersion: 0,
    sat: null, satT: 0, checkT: 0, saveT: 0, offlineSummary: null,
    doorCache: new Map(), landVersion: 0, litterT: 20,
  };
  let occ = new Int32Array(N * N);
  let byId = new Map();
  const listeners = {};

  /* ---------------- Hilfsfunktionen ---------------- */
  const now = () => Date.now();
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  function pickWeighted(items, wfn) {
    let total = 0;
    for (const it of items) total += wfn(it);
    let r = Math.random() * total;
    for (const it of items) { r -= wfn(it); if (r <= 0) return it; }
    return items[items.length - 1];
  }
  function niceRound(v) {
    if (v < 100) return Math.round(v);
    const p = Math.pow(10, Math.floor(Math.log10(v)) - 1);
    return Math.round(v / p) * p;
  }
  function niceTime(s) {
    if (s <= 60) return Math.round(s);
    if (s <= 3600) return Math.round(s / 5) * 5;
    return Math.round(s / 60) * 60;
  }
  function dayKey(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); }
  function emit(ev, data) { (listeners[ev] || []).forEach(fn => fn(data)); }

  /* ---------------- Definitionen & Werte ---------------- */
  const def = type => BUILDINGS[type];
  const RL = () => (S ? S.rl : 1);
  const maxLevelOf = type => def(type).maxLevel || 10;
  function levelCap(type) {
    if (type === 'reception') return 10;
    return Math.min(maxLevelOf(type), RL() + CONFIG.levelCapOffset);
  }
  function maxCount(type, rl) {
    const m = def(type).max;
    if (!m) return 0;
    rl = rl || RL();
    return m[Math.min(m.length - 1, rl - 1)];
  }
  const countOf = type => S.buildings.reduce((n, b) => n + (b.type === type ? 1 : 0), 0);
  const isUnlocked = type => RL() >= (def(type).unlock || 1);

  function costFor(type, L) {
    const d = def(type);
    if (d.levels) return Object.assign({}, d.levels[L - 1].cost);
    const f = Math.pow(d.costGrowth || 1, L - 1);
    const c = {};
    for (const k in d.cost) c[k] = niceRound(d.cost[k] * f);
    return c;
  }
  function timeFor(type, L) {
    const d = def(type);
    if (d.levels) return d.levels[L - 1].time;
    if (!d.time) return 0;
    return niceTime(d.time * Math.pow(d.timeGrowth || 1, L - 1));
  }
  const growth = (base, g, L) => base * Math.pow(g || 1, Math.max(0, L - 1));
  function baseRate(type, L) { const d = def(type); return d.rate ? growth(d.rate, d.rateGrowth, L) : 0; }
  // Bedürfnispunkte eines Gebäudes auf Level L, z. B. { sport: 9.8 }
  function needsOf(type, L) {
    const d = def(type), out = {};
    if (d.needs) for (const n in d.needs) out[n] = growth(d.needs[n], d.needGrowth, L);
    return out;
  }
  function storageOfBuilding(b) { return baseRate(b.type, b.level) * CONFIG.buildingStorageHours * 1.5; }
  function storageCap(res) {
    const arr = CONFIG.storage[res];
    return arr ? arr[Math.min(arr.length - 1, RL() - 1)] : Infinity;
  }
  const rewardScale = () => Math.pow(CONFIG.rewardScale, RL() - 1);
  function scaled(obj) {
    const out = {};
    const f = rewardScale();
    for (const k in obj) out[k] = (k === 'euro' || k === 'wood') ? niceRound(obj[k] * f) : obj[k];
    return out;
  }

  function tierIndex(stars) {
    stars = stars == null ? S.res.stars : stars;
    let i = 0;
    CONFIG.ratingTiers.forEach((t, k) => { if (stars >= t.stars) i = k; });
    return i;
  }

  function activeMod(key) {
    const t = now();
    let v = key === 'sat' ? 0 : 1;
    if (S.event && S.event.until > t && S.event.mods && S.event.mods[key] != null) {
      v = key === 'sat' ? v + S.event.mods[key] : v * S.event.mods[key];
    }
    const bo = S.boosts[key];
    if (bo && bo.until > t) v = key === 'sat' ? v + bo.value : v * bo.value;
    return v;
  }

  function incomeMultiplier() {
    const sc = CONFIG.satisfaction;
    const sat = satisfaction().total / 100;
    const satF = sc.incomeMin + (sc.incomeMax - sc.incomeMin) * sat;
    return satF * (1 + CONFIG.ratingTiers[tierIndex()].bonus) * activeMod('income');
  }
  function rateOf(b, mult) {
    const d = def(b.type);
    if (!d.produces || b.level <= 0) return 0;
    const r = baseRate(b.type, b.level);
    return d.produces === 'euro' ? r * (mult == null ? incomeMultiplier() : mult) : r;
  }

  /* ---------------- Zufriedenheit & Bedürfnisse ---------------- */
  // Zuschlag/Abzug auf die Erfüllung eines Bedürfnisses durch Ereignisse und Boosts (in Anteilen, 0.2 = +20 %)
  function needMod(n) {
    const t = now();
    let v = 0;
    const m = S.event && S.event.until > t && S.event.mods && S.event.mods.needs;
    if (m && m[n]) v += m[n];
    const bo = S.boosts.needs;
    if (bo && bo.until > t) v += bo.value;
    return v;
  }
  function computeSatisfaction() {
    const sc = CONFIG.satisfaction;
    let cap = 0, decor = 0, green = 0;
    const supply = {};
    for (const n of NEED_ORDER) supply[n] = 0;
    for (const b of S.buildings) {
      if (b.level <= 0) continue;
      const d = def(b.type);
      if (d.guests) cap += d.guests;
      if (d.needs) for (const n in d.needs) supply[n] += growth(d.needs[n], d.needGrowth, b.level);
      if (d.decor) decor += d.decor;
      if (d.green) green++;
    }
    // Erfüllung je Bedürfnis = Angebot / Bedarf (Bedarf wächst mit der Zahl der Gästeplätze)
    const needs = {};
    let needPts = 0, minF = 1;
    for (const n of NEED_ORDER) {
      const cfg = NEEDS[n];
      const demand = cap * cfg.perGuest * (1 + sc.demandGrowth * (RL() - 1));
      const base = demand > 0 ? Math.min(1, supply[n] / demand) : (supply[n] > 0 ? 1 : 0);
      const mod = needMod(n);
      const f = clamp(base + mod, 0, 1);
      const pts = cfg.weight * f - (cfg.penalty || 0) * (1 - f);
      needs[n] = { supply: supply[n], demand, base, mod, f, pts };
      needPts += pts;
      minF = Math.min(minF, f);
    }
    const r = {
      base: sc.base,
      needPts,
      decoPts: Math.min(sc.decoMax, decor),
      recPts: sc.receptionBonus * (RL() - 1),
      eventPts: activeMod('sat'),
      litterPts: -Math.min(10, CONFIG.pickups.litterSat * S.pickups.filter(k => k.k === 'litter').length),
      cap, needs, decor, green,
    };
    r.total = Math.round(clamp(r.base + r.needPts + r.decoPts + r.recPts + r.eventPts + r.litterPts, 0, 100));
    if (r.total > S.stats.maxSat) S.stats.maxSat = r.total;
    const mn = Math.round(minF * 100);
    if (cap > 0 && mn > (S.stats.minNeed || 0)) S.stats.minNeed = mn;
    return r;
  }
  // Stimmung eines einzelnen Gastes: Gesamtzufriedenheit gemischt mit seinen eigenen Vorlieben
  function guestMood(g) {
    const s = satisfaction();
    const prefs = GUESTS.types[g.type].needs || {};
    let sum = 0, wsum = 0;
    for (const n of NEED_ORDER) { const w = prefs[n] || 0; sum += w * s.needs[n].f; wsum += w; }
    const own = wsum ? sum / wsum * 100 : s.total;
    const mix = GUESTS.moodMix;
    return Math.round(clamp(s.total * (1 - mix) + own * mix, 0, 100));
  }
  function satisfaction() {
    if (!G.sat) G.sat = computeSatisfaction();
    return G.sat;
  }
  const dirtySat = () => { G.sat = null; };

  /* ---------------- Grundstücke ---------------- */
  const LB = CONFIG.land.bounds, LN = LB.length - 1;
  const lcell = new Int16Array(N);
  for (let i = 0; i < LN; i++) for (let v = LB[i]; v < LB[i + 1]; v++) lcell[v] = i;
  const landOwned = new Uint8Array(LN * LN);
  const parcelAt = (x, y) => (x < 0 || y < 0 || x >= N || y >= N ? -1 : lcell[y] * LN + lcell[x]);
  const parcelRect = p => { const i = p % LN, j = (p / LN) | 0; return { x0: LB[i], x1: LB[i + 1], y0: LB[j], y1: LB[j + 1], i, j }; };
  const START_PARCELS = [];
  for (let p = 0; p < LN * LN; p++) {
    const r = parcelRect(p), st = CONFIG.land.start;
    if (r.x0 >= st[0] && r.x1 <= st[1] && r.y0 >= st[0] && r.y1 <= st[1]) START_PARCELS.push(p);
  }
  function syncLand() {
    landOwned.fill(0);
    for (const p of S.land) landOwned[p] = 1;
    G.landVersion++;
  }
  const ownedTile = (x, y) => { const p = parcelAt(x, y); return p >= 0 && landOwned[p] === 1; };
  const landBought = () => Math.max(0, S.land.length - START_PARCELS.length);
  const landPermits = rl => { const a = CONFIG.land.permits; return a[Math.min(a.length - 1, (rl || RL()) - 1)]; };
  function parcelCost(k) {
    if (k == null) k = landBought();
    const f = Math.pow(CONFIG.land.growth, k);
    return { euro: niceRound(CONFIG.land.euro * f), wood: niceRound(CONFIG.land.wood * f) };
  }
  function parcelAdjacent(p) {
    const r = parcelRect(p);
    return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
      const i = r.i + dx, j = r.j + dy;
      return i >= 0 && j >= 0 && i < LN && j < LN && landOwned[j * LN + i];
    });
  }
  function parcelInfo(p) {
    const owned = !!landOwned[p];
    const adjacent = !owned && parcelAdjacent(p);
    const permitted = landBought() < landPermits();
    let nextRl = null;
    if (!permitted) for (let l = RL() + 1; l <= 10; l++) if (landPermits(l) > landBought()) { nextRl = l; break; }
    return { p, rect: parcelRect(p), owned, adjacent, permitted, buyable: adjacent && permitted, nextRl, cost: parcelCost() };
  }
  // alle Parzellen, die man gerade kaufen könnte (für Anzeige und Aufträge)
  function buyableParcels() {
    const out = [];
    for (let p = 0; p < LN * LN; p++) if (!landOwned[p] && parcelAdjacent(p)) out.push(p);
    return out;
  }
  function buyParcel(p) {
    const info = parcelInfo(p);
    if (info.owned) return { ok: false, reason: 'Gehört dir schon.' };
    if (!info.adjacent) return { ok: false, reason: 'Nur Grundstücke direkt neben deinem Platz.' };
    if (!info.permitted) return { ok: false, reason: info.nextRl ? `Mehr Grundstücke ab Rezeption Level ${info.nextRl}.` : 'Keine weiteren Grundstücke.' };
    if (!canAfford(info.cost)) return { ok: false, reason: 'Nicht genug Ressourcen.', missing: missing(info.cost) };
    pay(info.cost);
    const first = landBought() === 0;
    S.land.push(p);
    syncLand();
    rebuildGrid();
    const feature = populateParcel(p, first);
    rebuildGrid();
    S.stats.land = (S.stats.land || 0) + 1;
    emit('parcel', { p, feature });
    return { ok: true, feature };
  }
  /* Was auf einem neuen Grundstück wartet */
  function populateParcel(p, first) {
    const r = parcelRect(p);
    const feature = first ? 'chest' : pickWeighted(CONFIG.land.features, e => e[1])[0];
    const free = (x, y, w, d) => {
      for (let yy = y; yy < y + d; yy++) for (let xx = x; xx < x + w; xx++) {
        if (xx >= r.x1 || yy >= r.y1 || occ[yy * N + xx] || isRoad(xx, yy)) return false;
        const g = gateTile();
        if (xx === g.x && yy === g.y) return false;
      }
      return true;
    };
    const mark = (x, y, w, d) => { for (let yy = y; yy < y + d; yy++) for (let xx = x; xx < x + w; xx++) occ[yy * N + xx] = -1; };
    const put = (type, w, d, level) => {
      for (let k = 0; k < 30; k++) {
        const x = randInt(r.x0, r.x1 - w), y = randInt(r.y0, r.y1 - d);
        if (free(x, y, w, d)) { const b = addBuilding(type, x, y, level == null ? 1 : level); mark(x, y, w, d); return b; }
      }
      return null;
    };
    const k = 1 + 0.4 * (RL() - 1);
    if (feature === 'chest') {
      const b = put('obs_chest', 1, 1);
      if (b) b.loot = { euro: niceRound(400 * rewardScale()), wood: niceRound(100 * rewardScale()) };
    } else if (feature === 'ruin') {
      const b = put('obs_ruin', 2, 2);
      if (b) { b.removeCost = { wood: niceRound(300 * rewardScale()) }; b.loot = { stars: Math.round(10 * k) }; }
    } else if (feature === 'pond') {
      put('lake', 4, 4, 1);
    }
    const density = feature === 'forest' ? 0.4 : feature === 'meadow' ? 0.04 : CONFIG.land.obstacleDensity;
    const types = feature === 'forest' ? [['obs_tree', 8], ['obs_bush', 2], ['obs_stump', 1]] : [['obs_tree', 5], ['obs_bush', 4], ['obs_stump', 2], ['obs_rock', 2]];
    for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) {
      if (!free(x, y, 1, 1) || Math.random() >= density) continue;
      addBuilding(pickWeighted(types, e => e[1])[0], x, y, 1);
      mark(x, y, 1, 1);
    }
    if (feature === 'meadow') for (let i = 0; i < 3; i++) put('flowers', 1, 1);
    return feature;
  }

  /* ---------------- Raster ---------------- */
  // Umriss der eigenen Fläche (für Kamera & Co.)
  function area() {
    let x0 = N, y0 = N, x1 = 0, y1 = 0;
    for (const p of S.land) { const r = parcelRect(p); x0 = Math.min(x0, r.x0); y0 = Math.min(y0, r.y0); x1 = Math.max(x1, r.x1); y1 = Math.max(y1, r.y1); }
    return { x0, y0, x1, y1, n: Math.max(x1 - x0, y1 - y0) };
  }
  const areaSize = () => S.land.length;
  const roadX = () => N / 2;
  const ROAD_Y0 = CONFIG.land.start[1];
  const inArea = (x, y) => ownedTile(x, y);
  const isRoad = (x, y) => x === roadX() && y >= ROAD_Y0 && y < N;
  const gateTile = () => ({ x: roadX(), y: ROAD_Y0 - 1 });
  const spawnTile = () => ({ x: roadX(), y: N - 1 });
  const occAt = (x, y) => (x < 0 || y < 0 || x >= N || y >= N ? -1 : occ[y * N + x]);

  function rebuildGrid() {
    occ.fill(0);
    byId = new Map();
    for (const b of S.buildings) {
      byId.set(b.id, b);
      const d = def(b.type);
      for (let y = b.gy; y < b.gy + d.d; y++)
        for (let x = b.gx; x < b.gx + d.w; x++)
          if (x >= 0 && y >= 0 && x < N && y < N) occ[y * N + x] = b.id;
    }
    G.gridVersion++;
    G.doorCache.clear();
    dirtySat();
  }

  function canPlace(type, gx, gy, ignoreId) {
    const d = def(type);
    const gate = gateTile();
    for (let y = gy; y < gy + d.d; y++) {
      for (let x = gx; x < gx + d.w; x++) {
        if (!inArea(x, y) || isRoad(x, y)) return false;
        const o = occ[y * N + x];
        if (o && o !== ignoreId) return false;
        if (x === gate.x && y === gate.y && type !== 'path') return false;
      }
    }
    return true;
  }

  function walkable(x, y) {
    if (x < 0 || y < 0 || x >= N || y >= N) return false;
    if (!inArea(x, y) && !isRoad(x, y)) return false;
    const o = occ[y * N + x];
    if (!o) return true;
    const b = byId.get(o);
    return !!(b && def(b.type).walkable);
  }
  function tileCost(x, y) {
    if (isRoad(x, y)) return 1;
    const o = occ[y * N + x];
    if (o) { const b = byId.get(o); if (b && b.type === 'path') return 1; }
    return 1.8;
  }

  /* A*-Wegfindung, 8 Richtungen ohne Ecken-Schneiden */
  const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
  function findPath(sx, sy, tx, ty) {
    sx = clamp(sx | 0, 0, N - 1); sy = clamp(sy | 0, 0, N - 1);
    if (sx === tx && sy === ty) return [];
    const total = N * N;
    const gS = new Float32Array(total).fill(1e9);
    const from = new Int32Array(total).fill(-1);
    const closed = new Uint8Array(total);
    const hf = [], hi = [];
    const push = (f, i) => {
      hf.push(f); hi.push(i);
      let c = hf.length - 1;
      while (c > 0) {
        const p = (c - 1) >> 1;
        if (hf[p] <= hf[c]) break;
        [hf[p], hf[c]] = [hf[c], hf[p]]; [hi[p], hi[c]] = [hi[c], hi[p]];
        c = p;
      }
    };
    const pop = () => {
      const top = hi[0];
      const lf = hf.pop(), li = hi.pop();
      if (hf.length) {
        hf[0] = lf; hi[0] = li;
        let c = 0;
        for (;;) {
          const l = 2 * c + 1, r = l + 1;
          let m = c;
          if (l < hf.length && hf[l] < hf[m]) m = l;
          if (r < hf.length && hf[r] < hf[m]) m = r;
          if (m === c) break;
          [hf[m], hf[c]] = [hf[c], hf[m]]; [hi[m], hi[c]] = [hi[c], hi[m]];
          c = m;
        }
      }
      return top;
    };
    const h = (x, y) => { const dx = Math.abs(x - tx), dy = Math.abs(y - ty); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); };
    const start = sy * N + sx, goal = ty * N + tx;
    gS[start] = 0;
    push(h(sx, sy), start);
    const okTile = (x, y) => walkable(x, y) || (y * N + x) === goal || (y * N + x) === start;
    let found = false;
    while (hf.length) {
      const cur = pop();
      if (cur === goal) { found = true; break; }
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cx = cur % N, cy = (cur / N) | 0;
      for (const [dx, dy, dc] of DIRS) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const ni = ny * N + nx;
        if (closed[ni] || !okTile(nx, ny)) continue;
        if (dx && dy && (!okTile(cx + dx, cy) || !okTile(cx, cy + dy))) continue;
        const ng = gS[cur] + dc * tileCost(nx, ny);
        if (ng < gS[ni]) { gS[ni] = ng; from[ni] = cur; push(ng + h(nx, ny), ni); }
      }
    }
    if (!found) return null;
    const path = [];
    for (let c = goal; c !== start && c !== -1; c = from[c]) path.push([c % N, (c / N) | 0]);
    return path.reverse();
  }

  /* Eingangsfeld eines Gebäudes (bevorzugt Vorderseite) */
  function doorOf(b) {
    const key = b.id + ':' + G.gridVersion;
    if (G.doorCache.has(key)) return G.doorCache.get(key);
    const d = def(b.type);
    const px = b.gx + d.w / 2, py = b.gy + d.d + 0.5;
    let best = null, bestScore = 1e9;
    for (let y = b.gy - 1; y <= b.gy + d.d; y++) {
      for (let x = b.gx - 1; x <= b.gx + d.w; x++) {
        const edge = x === b.gx - 1 || x === b.gx + d.w || y === b.gy - 1 || y === b.gy + d.d;
        if (!edge || !walkable(x, y)) continue;
        const corner = (x === b.gx - 1 || x === b.gx + d.w) && (y === b.gy - 1 || y === b.gy + d.d);
        const score = Math.hypot(x + 0.5 - px, y + 0.5 - py) + (corner ? 2 : 0);
        if (score < bestScore) { bestScore = score; best = { x, y }; }
      }
    }
    if (!best) best = { x: clamp(Math.floor(px), 0, N - 1), y: clamp(b.gy + d.d, 0, N - 1) };
    G.doorCache.set(key, best);
    return best;
  }

  /* ---------------- Spielstand ---------------- */
  function newState() {
    const t = now();
    const s = {
      v: CONFIG.saveVersion, created: t, lastTick: t, lastSave: t, dayStart: t,
      res: { euro: CONFIG.start.euro, wood: CONFIG.start.wood, stars: CONFIG.start.stars, gems: CONFIG.start.gems },
      rl: 1, builders: CONFIG.start.builders, nextId: 1, buildings: [],
      stats: { built: 0, builtPitch: 0, builtNeed: 0, builtCulture: 0, land: 0, chests: 0, litter: 0, upgrades: 0, euroCollected: 0, woodCollected: 0, guests: 0, wishes: 0, events: 0, decoPlaced: 0, obstacles: 0, starsEarned: 0, maxSat: 0, minNeed: 0 },
      quests: [], questSeq: 0, achievements: {},
      daily: { last: null, streak: 0 },
      event: null, lastEventId: null, nextEventAt: t + CONFIG.events.firstAfterSec * 1000,
      boosts: {},
      settings: { sound: true, ambient: true, haptics: true, hq: false, realTime: false },
      cam: null, welcomed: false,
      land: START_PARCELS.slice(), pickups: [], pickupSeq: 0,
    };
    return s;
  }

  function addBuilding(type, gx, gy, level) {
    const b = { id: S.nextId++, type, gx, gy, level: level == null ? 1 : level, stored: 0, build: null };
    S.buildings.push(b);
    return b;
  }

  function newGame() {
    S = newState();
    syncLand();
    const c = N / 2;
    addBuilding('reception', c - 2, c - 2, 1);
    addBuilding('sanitary', c - 6, c - 1, 1);
    addBuilding('tent', c + 3, c, 1);
    addBuilding('tent', c + 3, c + 3, 1);
    for (let y = c + 2; y < ROAD_Y0; y++) addBuilding('path', c, y, 1);
    addBuilding('flowers', c - 1, c + 3, 1);
    addBuilding('flowers', c + 1, c + 3, 1);
    addBuilding('tree', c - 3, c + 4, 1);
    addBuilding('tree', c + 2, c + 6, 1);
    rebuildGrid();
    const clear = (x, y) => Math.abs(x + 0.5 - c) < 5 && Math.abs(y + 0.5 - c) < 5;
    spawnObstacles(area(), 0.07, clear);
    rebuildGrid();
    S.buildings.forEach(b => { if (b.type === 'tent') b.stored = baseRate('tent', 1) * 0.08; });
    FIRST_QUESTS.forEach(id => { const q = makeQuest(id); if (q) S.quests.push(q); });
    fillQuests();
    G.guests = []; G.pitchOwner.clear();
    G.nextArrival = now() + GUESTS.firstArrivalSec * 1000;
    emit('reset');
  }

  /* Hindernisse auf neu freigeschalteter Fläche verteilen */
  function spawnObstacles(a, density, skip) {
    const gate = gateTile();
    const types = [['obs_tree', 5], ['obs_bush', 4], ['obs_stump', 2], ['obs_rock', 2]];
    for (let y = a.y0; y < a.y1; y++) {
      for (let x = a.x0; x < a.x1; x++) {
        if (!inArea(x, y)) continue;
        if (x === gate.x || occ[y * N + x]) continue;
        if (skip && skip(x, y)) continue;
        if (Math.random() < density) {
          const t = pickWeighted(types, e => e[1])[0];
          addBuilding(t, x, y, 1);
          occ[y * N + x] = -1;
        }
      }
    }
  }

  function load() {
    let raw = null;
    try { raw = localStorage.getItem(CONFIG.saveKey); } catch (e) { /* privater Modus */ }
    if (!raw) return false;
    try {
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.buildings)) return false;
      const base = newState();
      S = Object.assign(base, data);
      S.res = Object.assign(newState().res, data.res);
      S.stats = Object.assign(newState().stats, data.stats);
      S.settings = Object.assign(newState().settings, data.settings);
      S.daily = Object.assign(newState().daily, data.daily);
      S.boosts = data.boosts || {};
      S.achievements = data.achievements || {};
      S.buildings = S.buildings.filter(b => BUILDINGS[b.type]);
      if (!Array.isArray(S.pickups)) S.pickups = [];
      if ((data.v || 1) < 2) migrateV1();
      if ((data.v || 1) < 3) migrateV2(data.rl || 1);
      syncLand();
      S.v = CONFIG.saveVersion;
      rebuildGrid();
      if (!Array.isArray(S.quests)) S.quests = [];
      S.quests = S.quests.filter(q => QUESTS.some(t => t.id === q.id) && (q.id !== 'need' || NEEDS[q.need]));
      fillQuests();
      return true;
    } catch (e) {
      console.warn('Spielstand defekt', e);
      return false;
    }
  }

  /* v1 → v2: Karte wuchs von 40 auf 44 Kacheln, alles um 2 Felder in die neue Mitte rücken */
  function migrateV1() {
    const shift = (N - 40) / 2;
    for (const b of S.buildings) { b.gx += shift; b.gy += shift; }
    S.cam = null;
    // Die neue Fläche ist eine Reihe größer: Weg bis unter das Tor verlängern
    const g = gateTile();
    if (!S.buildings.some(b => b.gx === g.x && b.gy === g.y)) addBuilding('path', g.x, g.y, 1);
  }

  /* v2 → v3: statt eines wachsenden Quadrats gibt es Grundstücke */
  function migrateV2(rl) {
    const n = CONFIG.map.areaByReception[Math.min(9, rl - 1)], a0 = (N - n) / 2, a1 = a0 + n;
    const own = new Set(START_PARCELS);
    for (let p = 0; p < LN * LN; p++) {
      const r = parcelRect(p);
      const ov = Math.max(0, Math.min(r.x1, a1) - Math.max(r.x0, a0)) * Math.max(0, Math.min(r.y1, a1) - Math.max(r.y0, a0));
      if (ov * 2 >= (r.x1 - r.x0) * (r.y1 - r.y0)) own.add(p);
    }
    // Gebäude (keine Hindernisse) behalten ihr Grundstück
    for (const b of S.buildings) {
      const d = def(b.type);
      if (d.cat === 'obstacle') continue;
      for (let y = b.gy; y < b.gy + d.d; y++) for (let x = b.gx; x < b.gx + d.w; x++) { const p = parcelAt(x, y); if (p >= 0) own.add(p); }
    }
    S.land = [...own];
    syncLand();
    const g = gateTile();
    S.buildings = S.buildings.filter(b => {
      const d = def(b.type);
      if (d.cat === 'obstacle') return ownedTile(b.gx, b.gy);
      if (b.type === 'path' && b.gx === g.x && b.gy >= ROAD_Y0) return false;   // jetzt Straße
      return true;
    });
    if (!S.buildings.some(b => b.gx === g.x && b.gy === g.y)) addBuilding('path', g.x, g.y, 1);
    S.stats.land = landBought();
    S.cam = null;
  }

  let saveLocked = false;
  function save() {
    if (!S || saveLocked) return;
    S.lastSave = now();
    try { localStorage.setItem(CONFIG.saveKey, JSON.stringify(S, (k, v) => (k[0] === '_' ? undefined : v))); } catch (e) { console.warn('Speichern fehlgeschlagen', e); }
    G.saveT = 0;
  }

  function init() {
    const loaded = load();
    if (!loaded) newGame();
    G.guests = []; G.pitchOwner.clear();
    G.nextArrival = now() + GUESTS.firstArrivalSec * 1000;
    if (S.nextEventAt < now() + 30000) S.nextEventAt = now() + CONFIG.events.firstAfterSec * 1000;
    resume();
    return loaded;
  }

  /* Alle gespeicherten Zeitpunkte verschieben (z. B. wenn die Geräteuhr zurückgestellt wurde) */
  function shiftTimes(delta) {
    for (const b of S.buildings) if (b.build) { b.build.start += delta; b.build.end += delta; }
    if (S.event) S.event.until += delta;
    for (const k in S.boosts) S.boosts[k].until += delta;
    S.nextEventAt += delta;
    S.dayStart = (S.dayStart || 0) + delta;
    S.lastTick += delta;
    G.nextArrival += delta;
    for (const g of G.guests) if (g.leaveAt) g.leaveAt += delta;
    if (G.dog) G.dog.until += delta;
  }

  /* Nach Pause/Neustart: verpasste Zeit nachholen (mit Offline-Limit) */
  function resume() {
    const t = now();
    if (t - S.lastTick < -60000) shiftTimes(t - S.lastTick);   // Uhr wurde zurückgestellt: Restzeiten behalten
    const gap = t - S.lastTick;
    if (gap > 5000) {
      const sum = advance(S.lastTick, t, true);
      S.lastTick = t;
      const secs = gap / 1000;
      if (secs >= CONFIG.offline.minSecondsForSummary && (sum.euro >= 1 || sum.wood >= 1)) {
        G.offlineSummary = { seconds: secs, capped: secs > CONFIG.offline.maxHours * 3600, euroCapped: !!sum.euroCapped, euro: Math.floor(sum.euro), wood: Math.floor(sum.wood), finished: sum.finished };
        emit('offline', G.offlineSummary);
      }
      if (S.nextEventAt < t + 20000) S.nextEventAt = t + rand(30, 90) * 1000;
    }
    S.lastTick = t;
  }

  /* ---------------- Produktion & Bau ---------------- */
  function advance(fromMs, toMs, offline) {
    const sum = { euro: 0, wood: 0, finished: 0 };
    let mult = null;
    if (toMs <= fromMs) return sum;
    const list = S.buildings;
    const adds = [];
    for (let i = 0, n = list.length; i < n; i++) {
      const b = list[i];
      const d = def(b.type);
      let start = fromMs;
      if (b.build) {
        if (b.build.end <= toMs) {
          start = Math.max(fromMs, b.build.end);
          finishBuild(b, offline);
          sum.finished++;
        } else continue;
      }
      if (!d.produces || b.level <= 0) continue;
      let secs = (toMs - start) / 1000;
      if (offline) secs = Math.min(secs, CONFIG.offline.maxHours * 3600) * CONFIG.offline.efficiency;
      const cap = storageOfBuilding(b);
      if (mult == null) mult = incomeMultiplier();
      const add = Math.max(0, Math.min(cap, b.stored + rateOf(b, mult) * secs / 3600) - b.stored);
      if (add > 0) { adds.push([b, add, d.produces]); sum[d.produces] += add; }
    }
    // Obergrenze für Euro, die man offline verdienen kann
    let k = 1;
    if (offline && CONFIG.offline.maxEuroShare) {
      const maxEuro = storageCap('euro') * CONFIG.offline.maxEuroShare;
      if (sum.euro > maxEuro) { k = maxEuro / sum.euro; sum.euro = maxEuro; sum.euroCapped = true; }
    }
    for (const [b, add, res] of adds) b.stored += res === 'euro' ? add * k : add;
    return sum;
  }

  function finishBuild(b, quiet) {
    const to = b.build.to;
    b.level = to;
    b.build = null;
    const d = def(b.type);
    if (to === 1) {
      S.stats.built++;
      if (d.cat === 'pitch') S.stats.builtPitch++;
      if (d.needs) S.stats.builtNeed++;
      if (d.cat === 'kultur' || d.cat === 'kunst') S.stats.builtCulture++;
    } else S.stats.upgrades++;
    dirtySat();
    if (b.type === 'reception') onReceptionLevel(to);
    emit('built', { b, upgrade: to > 1, quiet });
  }

  function onReceptionLevel(level) {
    const before = landPermits(S.rl);
    S.rl = level;
    dirtySat();
    const unlocked = Object.keys(BUILDINGS).filter(k => BUILDINGS[k].unlock === level && BUILDINGS[k].buildable !== false);
    const guests = Object.keys(GUESTS.types).filter(k => GUESTS.types[k].minRL === level);
    emit('reception', { level, unlocked, guests, permits: landPermits(level) - before });
  }

  const busyBuilders = () => S.buildings.reduce((n, b) => n + (b.build ? 1 : 0), 0);
  const freeBuilders = () => S.builders - busyBuilders();

  function canAfford(cost) {
    for (const k in cost) if ((S.res[k] || 0) < cost[k]) return false;
    return true;
  }
  function missing(cost) {
    const m = {};
    for (const k in cost) if ((S.res[k] || 0) < cost[k]) m[k] = cost[k] - (S.res[k] || 0);
    return m;
  }
  function pay(cost) { for (const k in cost) S.res[k] -= cost[k]; emit('res'); }

  /* Ressourcen gutschreiben – Euro/Holz durch Lager begrenzt. Gibt Tatsächliches zurück. */
  function grant(obj) {
    const got = {};
    for (const k in obj) {
      let v = obj[k];
      if (!v) continue;
      if (k === 'euro' || k === 'wood') {
        const space = Math.max(0, storageCap(k) - S.res[k]);
        v = Math.min(v, space);
        S.res[k] += v;
        if (k === 'euro') S.stats.euroCollected += v; else S.stats.woodCollected += v;
      } else if (k === 'stars') {
        const before = S.res.stars;
        S.res.stars = Math.max(0, S.res.stars + v);
        v = S.res.stars - before;
        if (v > 0) S.stats.starsEarned += v;
        dirtySat();
      } else if (k === 'gems') {
        S.res.gems += v;
      }
      got[k] = v;
    }
    emit('res');
    return got;
  }

  function placeCheck(type, gx, gy) {
    const d = def(type);
    if (!d || d.buildable === false) return { ok: false, reason: 'Nicht baubar.' };
    if (!isUnlocked(type)) return { ok: false, reason: `Benötigt Rezeption Level ${d.unlock}.` };
    if (countOf(type) >= maxCount(type)) return { ok: false, reason: 'Maximale Anzahl erreicht.' };
    const cost = costFor(type, 1);
    if (!canAfford(cost)) return { ok: false, reason: 'Nicht genug Ressourcen.', missing: missing(cost) };
    if (timeFor(type, 1) > 0 && freeBuilders() <= 0) return { ok: false, reason: 'Alle Bauarbeiter sind beschäftigt.', builders: true };
    if (gx != null && !canPlace(type, gx, gy)) return { ok: false, reason: 'Hier ist kein Platz.' };
    return { ok: true, cost };
  }

  function placeNew(type, gx, gy) {
    const chk = placeCheck(type, gx, gy);
    if (!chk.ok) return chk;
    pay(chk.cost);
    const time = timeFor(type, 1);
    const b = addBuilding(type, gx, gy, time > 0 ? 0 : 1);
    if (time > 0) b.build = { start: now(), end: now() + time * 1000, to: 1 };
    else if (def(type).cat === 'deco') S.stats.decoPlaced++;
    rebuildGrid();
    emit('placed', { b });
    return { ok: true, b };
  }

  function moveBuilding(id, gx, gy) {
    const b = byId.get(id);
    if (!b || def(b.type).cat === 'obstacle') return false;
    if (b.gx === gx && b.gy === gy) return true;
    if (!canPlace(b.type, gx, gy, id)) return false;
    b.gx = gx; b.gy = gy;
    rebuildGrid();
    emit('moved', { b });
    return true;
  }

  function upgradeCheck(id) {
    const b = byId.get(id);
    if (!b) return { ok: false, reason: '?' };
    const d = def(b.type);
    if (d.cat === 'deco' || d.cat === 'obstacle') return { ok: false, reason: 'Kann nicht verbessert werden.' };
    if (b.build) return { ok: false, reason: 'Wird gerade gebaut.' };
    if (b.level >= maxLevelOf(b.type)) return { ok: false, reason: 'Maximales Level erreicht.', max: true };
    if (b.level >= levelCap(b.type)) return { ok: false, reason: `Benötigt Rezeption Level ${b.level + 1 - CONFIG.levelCapOffset}.`, locked: true };
    const cost = costFor(b.type, b.level + 1);
    const time = timeFor(b.type, b.level + 1);
    if (!canAfford(cost)) return { ok: false, reason: 'Nicht genug Ressourcen.', cost, time, missing: missing(cost) };
    if (freeBuilders() <= 0) return { ok: false, reason: 'Alle Bauarbeiter sind beschäftigt.', cost, time, builders: true };
    return { ok: true, cost, time };
  }

  function upgrade(id) {
    const chk = upgradeCheck(id);
    if (!chk.ok) return chk;
    const b = byId.get(id);
    pay(chk.cost);
    b.build = { start: now(), end: now() + chk.time * 1000, to: b.level + 1 };
    if (chk.time <= 0) finishBuild(b);
    emit('upgradeStart', { b });
    return { ok: true, b };
  }

  function gemCost(sec) {
    if (sec <= CONFIG.speedup.freeSeconds) return 0;
    const pts = CONFIG.speedup.points;
    for (let i = 1; i < pts.length; i++) {
      if (sec <= pts[i][0]) {
        const [s0, g0] = pts[i - 1], [s1, g1] = pts[i];
        return Math.max(1, Math.ceil(g0 + (g1 - g0) * (sec - s0) / (s1 - s0)));
      }
    }
    const last = pts[pts.length - 1];
    return Math.ceil(last[1] * sec / last[0]);
  }
  const remaining = b => (b.build ? Math.max(0, (b.build.end - now()) / 1000) : 0);
  function speedUpCost(id) { const b = byId.get(id); return b && b.build ? gemCost(remaining(b)) : 0; }
  function speedUp(id) {
    const b = byId.get(id);
    if (!b || !b.build) return { ok: false };
    const cost = gemCost(remaining(b));
    if (S.res.gems < cost) return { ok: false, reason: 'Nicht genug Gems.' };
    S.res.gems -= cost;
    finishBuild(b);
    emit('res');
    return { ok: true, cost };
  }

  function collectThreshold(b) { return Math.max(1, baseRate(b.type, Math.max(1, b.level)) * CONFIG.collectMinMinutes / 60); }
  function canCollect(b) { return !!(def(b.type).produces && b.stored >= collectThreshold(b)); }
  function collect(id) {
    const b = byId.get(id);
    if (!b || !def(b.type).produces) return null;
    const res = def(b.type).produces;
    const amount = Math.floor(b.stored);
    if (amount < 1) return null;
    const space = Math.floor(storageCap(res) - S.res[res]);
    if (space <= 0) { emit('storageFull', { res }); return { res, amount: 0, full: true }; }
    const take = Math.min(amount, space);
    b.stored -= take;
    grant({ [res]: take });
    emit('collect', { b, res, amount: take });
    if (take < amount) emit('storageFull', { res });
    return { res, amount: take };
  }

  const obstacleCost = b => b.removeCost || def(b.type).remove || {};
  const obstacleLoot = b => b.loot || def(b.type).gives || {};
  function removeObstacle(id) {
    const b = byId.get(id);
    if (!b || def(b.type).cat !== 'obstacle') return { ok: false };
    const d = def(b.type);
    const cost = obstacleCost(b);
    if (!canAfford(cost)) return { ok: false, reason: 'Nicht genug Ressourcen.', missing: missing(cost) };
    pay(cost);
    S.buildings.splice(S.buildings.indexOf(b), 1);
    S.stats.obstacles++;
    if (b.type === 'obs_chest') S.stats.chests = (S.stats.chests || 0) + 1;
    rebuildGrid();
    const got = grant(obstacleLoot(b));
    emit('obstacleRemoved', { b, got });
    return { ok: true, got };
  }

  function demolish(id) {
    const b = byId.get(id);
    if (!b || def(b.type).cat !== 'deco') return { ok: false };
    const refund = {};
    const cost = costFor(b.type, 1);
    for (const k in cost) refund[k] = Math.floor(cost[k] * 0.5);
    S.buildings.splice(S.buildings.indexOf(b), 1);
    rebuildGrid();
    grant(refund);
    emit('demolished', { b, refund });
    return { ok: true, refund };
  }

  /* ---------------- Gäste ---------------- */
  function isWishMet(w) {
    if (!w) return false;
    if (w.b) return S.buildings.some(b => b.type === w.b && b.level >= (w.lvl || 1));
    if (w.deco) return satisfaction().green >= w.deco;
    if (w.sat) return satisfaction().total >= w.sat;
    if (w.need) return satisfaction().needs[w.need].f * 100 >= w.min - 0.001;
    return false;
  }
  function wishText(w) {
    if (!w) return 'Keine besonderen Wünsche';
    if (w.b) return def(w.b).name + (w.lvl > 1 ? ` (ab Level ${w.lvl})` : '');
    if (w.deco) return `Viel Grün (${w.deco}+ Bäume & Blumen)`;
    if (w.sat) return `Gute Stimmung (≥ ${w.sat} % Zufriedenheit)`;
    if (w.need) return `${NEEDS[w.need].name} zu ≥ ${w.min} % erfüllt`;
    return '';
  }
  // Ist ein Bedürfnis mit Gebäuden bis Rezeptionslevel rl überhaupt bedienbar?
  const needAvailable = (n, rl) => Object.values(BUILDINGS).some(d => d.needs && d.needs[n] && (d.unlock || 1) <= rl);

  function freePitches() {
    return S.buildings.filter(b => def(b.type).cat === 'pitch' && b.level >= 1 && !G.pitchOwner.has(b.id));
  }

  function spawnGuest() {
    const free = freePitches();
    if (!free.length || G.guests.length > 40) return false;
    const types = Object.keys(GUESTS.types).filter(t => (GUESTS.types[t].minRL || 1) <= RL() && free.some(p => GUESTS.types[t].pitches.includes(p.type)));
    if (!types.length) return false;
    const tk = pickWeighted(types, t => GUESTS.types[t].weight);
    const T = GUESTS.types[tk];
    const options = free.filter(p => T.pitches.includes(p.type));
    const pitch = pickWeighted(options, p => T.pitches.length - T.pitches.indexOf(p.type));
    let wish = null;
    if (Math.random() < GUESTS.wishChance) {
      const possible = T.wishes.filter(w => (!w.b || def(w.b).unlock <= RL() + 1) && (!w.need || needAvailable(w.need, RL() + 1)));
      const open = possible.filter(w => !isWishMet(w));
      const pool = open.length && Math.random() < 0.7 ? open : possible;
      if (pool.length) wish = pick(pool);
    }
    const sp = spawnTile();
    const g = {
      id: ++G.guestSeq, type: tk, name: T.label(pick(T.names)), members: T.members,
      wish, wishDone: wish ? isWishMet(wish) : false,
      pitchId: pitch.id, state: 'arrive', x: sp.x + 0.5, y: sp.y + 0.5,
      ox: rand(-0.18, 0.18), oy: rand(-0.18, 0.18),
      path: null, pi: 0, timer: 0, leaveAt: 0, dir: 1, moving: false, walkT: Math.random() * 10,
      speed: GUESTS.speed * T.speed, arrivedAt: now(), wishPopT: 0,
    };
    G.pitchOwner.set(pitch.id, g.id);
    const rec = S.buildings.find(b => b.type === 'reception');
    goTo(g, rec ? doorOf(rec) : gateTile());
    G.guests.push(g);
    return true;
  }

  function goTo(e, tile) {
    const p = findPath(Math.floor(e.x), Math.floor(e.y), tile.x, tile.y);
    e.path = p || [[tile.x, tile.y]];
    e.pi = 0;
    e.target = tile;
  }

  function moveAlong(e, dt) {
    if (!e.path || e.pi >= e.path.length) { e.moving = false; return true; }
    let rem = e.speed * dt;
    while (rem > 0 && e.pi < e.path.length) {
      const [tx, ty] = e.path[e.pi];
      const px = tx + 0.5 + (e.ox || 0), py = ty + 0.5 + (e.oy || 0);
      const dx = px - e.x, dy = py - e.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.001) e.dir = (dx - dy) >= 0 ? 1 : -1;
      if (dist <= rem) { e.x = px; e.y = py; e.pi++; rem -= dist; }
      else { e.x += dx / dist * rem; e.y += dy / dist * rem; rem = 0; }
    }
    e.moving = e.pi < e.path.length;
    e.walkT += dt * e.speed * 6;
    return !e.moving;
  }

  function pitchOf(g) { return byId.get(g.pitchId); }

  // Gäste besuchen bevorzugt Gebäude, die ihre Lieblingsbedürfnisse erfüllen
  function chooseActivity(g) {
    const prefs = GUESTS.types[g.type].needs || {};
    const amen = S.buildings.filter(b => b.level >= 1 && (def(b.type).needs || b.type === 'bench' || b.type === 'reception'));
    let target = null;
    if (g.wish && g.wish.b && Math.random() < 0.5) target = amen.find(b => b.type === g.wish.b) || null;
    if (!target && amen.length && Math.random() < 0.8) {
      target = pickWeighted(amen, b => {
        const d = def(b.type);
        if (!d.needs) return 0.6;
        let w = 0.3;
        for (const n in d.needs) w += (prefs[n] != null ? prefs[n] : 1) * d.needs[n] * 0.25;
        if (g.wish && g.wish.need && d.needs[g.wish.need]) w *= 2;
        return w;
      });
    }
    if (target) return doorOf(target);
    // kleiner Spaziergang
    const p = pitchOf(g);
    const base = p ? doorOf(p) : { x: Math.floor(g.x), y: Math.floor(g.y) };
    for (let i = 0; i < 12; i++) {
      const x = base.x + randInt(-4, 4), y = base.y + randInt(-4, 4);
      if (walkable(x, y)) return { x, y };
    }
    return base;
  }

  function depart(g) {
    const mood = guestMood(g);
    const rule = GUESTS.review.find(r => mood >= r.minMood);
    const T = GUESTS.types[g.type];
    let stars = (rule ? rule.stars : 0) * (T.reviewMult || 1);
    let tip = 0;
    if (g.wish && !g.wishDone && isWishMet(g.wish)) g.wishDone = true;
    if (g.wish && g.wishDone) {
      stars += GUESTS.wishBonusStars * (T.reviewMult || 1);
      tip = niceRound(GUESTS.wishTipEuro * rewardScale() * (T.tipMult || 1));
      S.stats.wishes++;
    }
    const got = grant({ stars, euro: tip });
    G.pitchOwner.delete(g.pitchId);
    g.state = 'leave';
    goTo(g, spawnTile());
    emit('review', { g, stars, tip: got.euro || 0, mood });
  }

  function updateGuests(dt, t, doCheck) {
    // Ankünfte
    if (t >= G.nextArrival) {
      const ok = spawnGuest();
      const mult = activeMod('guestRate') * (1 + tierIndex() * 0.08);
      G.nextArrival = t + (ok ? rand(GUESTS.arrivalSec[0], GUESTS.arrivalSec[1]) / mult : 6) * 1000;
    }
    for (let i = G.guests.length - 1; i >= 0; i--) {
      const g = G.guests[i];
      const pitch = pitchOf(g);
      if (!pitch && g.state !== 'leave') { G.pitchOwner.delete(g.pitchId); g.state = 'leave'; goTo(g, spawnTile()); }
      switch (g.state) {
        case 'arrive':
          if (moveAlong(g, dt)) { g.state = 'checkin'; g.timer = 1.4; }
          break;
        case 'checkin':
          g.timer -= dt;
          if (g.timer <= 0) {
            S.stats.guests++;
            emit('guestArrive', { g });
            g.state = 'toPitch';
            goTo(g, doorOf(pitch));
          }
          break;
        case 'toPitch':
          if (moveAlong(g, dt)) {
            if (!g.leaveAt) g.leaveAt = t + rand(GUESTS.staySec[0], GUESTS.staySec[1]) * 1000;
            g.state = 'stay'; g.timer = rand(GUESTS.activitySec[0], GUESTS.activitySec[1]);
          }
          break;
        case 'stay':
          g.timer -= dt;
          if (t >= g.leaveAt) depart(g);
          else if (g.timer <= 0) { g.state = 'toAct'; goTo(g, chooseActivity(g)); }
          break;
        case 'toAct':
          if (moveAlong(g, dt)) { g.state = 'act'; g.timer = rand(4, 9); }
          break;
        case 'act':
          g.timer -= dt;
          if (g.timer <= 0) {
            const pc = CONFIG.pickups;
            if (Math.random() < pc.tipChance * (GUESTS.types[g.type].tipMult ? 2 : 1) && guestMood(g) >= pc.tipMinMood) addPickup('tip', g.x, g.y, (GUESTS.types[g.type].tipMult || 1));
            g.state = 'toPitch'; goTo(g, doorOf(pitch));
          }
          break;
        case 'leave':
          if (moveAlong(g, dt)) G.guests.splice(i, 1);
          break;
      }
      // Wunsch unterwegs erfüllt?
      if (g.wish && !g.wishDone && g.state !== 'leave' && doCheck && isWishMet(g.wish)) {
        g.wishDone = true;
        g.wishPopT = 2;
        emit('wishMet', { g });
      }
      if (g.wishPopT > 0) g.wishPopT -= dt;
    }
    // Hund
    const dog = G.dog;
    if (dog) {
      if (t > dog.until) { G.dog = null; emit('toast', { text: 'Bello ist von allein zu seinem Besitzer zurückgelaufen.' }); }
      else if (moveAlong(dog, dt)) {
        const a = area();
        for (let k = 0; k < 10; k++) {
          const x = randInt(a.x0, a.x1 - 1), y = randInt(a.y0, a.y1 - 1);
          if (walkable(x, y)) { goTo(dog, { x, y }); break; }
        }
      }
    }
  }

  /* ---------------- Ereignisse ---------------- */
  function maybeStartEvent(t) {
    if (G.pendingEvent || t < S.nextEventAt) return;
    if (S.event && S.event.until > t) return;
    const options = EVENTS.filter(e => e.id !== S.lastEventId && (e.id !== 'dog' || G.guests.length > 0));
    const ev = pick(options);
    G.pendingEvent = ev;
    emit('event', { ev });
  }

  function eventChoiceInfo(ev, c) {
    const cost = c.cost ? scaled(c.cost) : {};
    const needs = c.requires && !S.buildings.some(b => b.type === c.requires && b.level >= 1);
    return { cost, needs: needs ? def(c.requires).name : null, affordable: canAfford(cost) };
  }

  function chooseEvent(idx) {
    const ev = G.pendingEvent;
    if (!ev) return { ok: false };
    const c = ev.choices[idx];
    const info = eventChoiceInfo(ev, c);
    if (info.needs) return { ok: false, reason: `Benötigt: ${info.needs}` };
    if (!info.affordable) return { ok: false, reason: 'Nicht genug Ressourcen.' };
    pay(info.cost);
    const t = now();
    let result = c.result;
    let mods = c.mods ? JSON.parse(JSON.stringify(c.mods)) : null;
    let reward = c.reward ? scaled(c.reward) : null;
    let dur = (ev.duration || 0) * 1000;
    if (c.special === 'inspect' || c.special === 'inspectBonus') {
      const sat = satisfaction().total + (c.special === 'inspectBonus' ? 10 : 0);
      const f = 1 + 0.4 * (RL() - 1);
      if (sat >= 75) { reward = { stars: Math.round(20 * f), euro: niceRound(300 * rewardScale()) }; result = 'Hervorragend! Die Prüferin vergibt ein Gütesiegel.'; }
      else if (sat >= 55) { reward = { stars: Math.round(8 * f) }; result = 'Ein ordentlicher Platz – solide Bewertung.'; }
      else { reward = { stars: -Math.round(10 * f) }; result = 'Die Prüferin ist unzufrieden. Das gibt Abzüge.'; }
    } else if (c.special === 'hygieneCheck' || c.special === 'hygieneCheckBonus') {
      const f = Math.min(1, satisfaction().needs.hygiene.f + (c.special === 'hygieneCheckBonus' ? 0.25 : 0));
      const k = 1 + 0.4 * (RL() - 1);
      if (f >= 0.95) { reward = { stars: Math.round(12 * k) }; result = 'Blitzsauber! Das Amt vergibt eine Hygiene-Plakette.'; }
      else if (f >= 0.7) { reward = { stars: Math.round(4 * k) }; result = 'Alles in Ordnung – nur ein paar kleine Hinweise.'; }
      else {
        reward = { stars: -Math.round(8 * k) };
        mods = { sat: -8 };
        dur = 180000;
        result = 'Mängel festgestellt! Die Gäste sind verunsichert. Baue mehr Sanitärhäuser oder ein Waschhaus.';
      }
    } else if (c.special === 'gamble') {
      if (Math.random() < 0.5) { result = 'Glück gehabt! Das Gewitter zieht knapp vorbei.'; mods = {}; }
      else { result = 'Der Sturm hat einige Zelte umgeweht. Die Stimmung ist im Keller.'; mods = { sat: -18, income: 0.7 }; }
    } else if (c.special === 'dog') {
      const rec = S.buildings.find(b => b.type === 'reception');
      const start = rec ? doorOf(rec) : gateTile();
      G.dog = { x: start.x + 0.5, y: start.y + 0.5, ox: 0, oy: 0, path: null, pi: 0, speed: 1.6, dir: 1, walkT: 0, until: t + ev.duration * 1000 };
    }
    let got = null;
    if (reward) got = grant(reward);
    const weather = c.weather !== undefined ? c.weather : ev.weather;
    const lasting = dur > 0 && !!(weather || (mods && Object.keys(mods).length));
    S.event = lasting ? { id: ev.id, weather: weather || null, title: ev.title, until: t + dur, mods: mods || {} } : null;
    S.lastEventId = ev.id;
    S.stats.events++;
    S.nextEventAt = t + rand(CONFIG.events.everySec[0], CONFIG.events.everySec[1]) * 1000 + (lasting ? dur : 0);
    G.pendingEvent = null;
    dirtySat();
    emit('eventResolved', { ev, choice: c, result, got });
    return { ok: true, result, got };
  }

  function catchDog() {
    if (!G.dog) return null;
    G.dog = null;
    const got = grant({ stars: 5, euro: niceRound(200 * rewardScale()) });
    emit('dogFound', { got });
    return got;
  }

  /* ---------------- Aufträge ---------------- */
  function questValue(stat) {
    if (stat === 'stars') return S.res.stars;
    if (stat === 'receptionLevel') return RL();
    if (stat === 'sat') return satisfaction().total;
    if (stat.startsWith('need:')) return Math.round(satisfaction().needs[stat.slice(5)].f * 100);
    return S.stats[stat] || 0;
  }
  function makeQuest(forceId) {
    const rl = RL();
    const active = S.quests.map(q => q.id);
    const cands = QUESTS.filter(tpl => {
      if (forceId) return tpl.id === forceId;
      if (active.includes(tpl.id)) return false;
      if (tpl.needs === 'lumberjack' && !S.buildings.some(b => b.type === 'lumberjack')) return false;
      if (tpl.needs === 'obstacles' && S.buildings.filter(b => def(b.type).cat === 'obstacle').length < 3) return false;
      if (tpl.state === 'sat' && satisfaction().total >= tpl.values[Math.min(tpl.values.length - 1, rl - 1)]) return false;
      if (tpl.state === 'need' && !openNeeds(tpl.values[Math.min(tpl.values.length - 1, rl - 1)]).length) return false;
      if (tpl.stat === 'land') {
        const n = Math.max(1, Math.round(tpl.base + (tpl.perLevel || 0) * (rl - 1)));
        if (landPermits() - landBought() < n || !buyableParcels().length) return false;
      }
      if (tpl.stat === 'litter' && G.guests.length < 2) return false;
      if (tpl.stat === 'builtNeed' || tpl.stat === 'builtPitch') {
        // nur, wenn noch genug Gebäude dieser Art gebaut werden dürfen
        const want = tpl.stat === 'builtNeed' ? d => !!d.needs : d => d.cat === 'pitch';
        const free = Object.keys(BUILDINGS).filter(k => want(def(k)) && def(k).buildable !== false && isUnlocked(k))
          .reduce((s, k) => s + Math.max(0, maxCount(k) - countOf(k)), 0);
        if (free < Math.max(1, Math.round(tpl.base + (tpl.perLevel || 0) * (rl - 1)))) return false;
      }
      return true;
    });
    if (!cands.length) return null;
    const tpl = pick(cands);
    let need = null;
    if (tpl.state === 'need') need = pick(openNeeds(tpl.values[Math.min(tpl.values.length - 1, rl - 1)]));
    let n;
    if (tpl.values) n = tpl.values[Math.min(tpl.values.length - 1, rl - 1)];
    else if (tpl.growth) n = niceRound(tpl.base * Math.pow(tpl.growth, rl - 1));
    else n = Math.max(1, Math.round(tpl.base + (tpl.perLevel || 0) * (rl - 1)));
    const reward = scaled(tpl.reward);
    if (reward.stars) reward.stars = Math.round(reward.stars * (1 + 0.5 * (rl - 1)));
    return { uid: ++S.questSeq, id: tpl.id, n, base: tpl.stat ? questValue(tpl.stat) : 0, reward, need };
  }
  // Bedürfnisse, die unter dem Ziel liegen und schon bedient werden können
  function openNeeds(target) {
    return NEED_ORDER.filter(n => needAvailable(n, RL()) && satisfaction().needs[n].f * 100 < target);
  }
  function fillQuests() {
    while (S.quests.length < 3) {
      const q = makeQuest();
      if (!q) break;
      S.quests.push(q);
    }
  }
  function questInfo(q) {
    const tpl = QUESTS.find(t => t.id === q.id);
    const key = tpl.state === 'need' ? 'need:' + q.need : tpl.state;
    const cur = tpl.state ? questValue(key) : questValue(tpl.stat) - q.base;
    let text = q.n === 1 && tpl.one ? tpl.one : tpl.text.replace('{n}', fmtNum(q.n));
    if (q.need) text = text.replace('{need}', NEEDS[q.need].name);
    return { tpl, text, need: q.need || null, cur: Math.min(cur, q.n), n: q.n, done: cur >= q.n, reward: q.reward };
  }
  function claimQuest(uid) {
    const i = S.quests.findIndex(q => q.uid === uid);
    if (i < 0) return null;
    const info = questInfo(S.quests[i]);
    if (!info.done) return null;
    S.quests.splice(i, 1);
    const got = grant(info.reward);
    fillQuests();
    emit('questClaimed', { got });
    return got;
  }

  /* ---------------- Erfolge ---------------- */
  function achievementInfo(a) {
    const tier = S.achievements[a.id] || 0;
    const val = questValue(a.stat);
    const next = a.tiers[Math.min(tier, a.tiers.length - 1)];
    return {
      a, tier, val, next, complete: tier >= a.tiers.length,
      claimable: tier < a.tiers.length && val >= a.tiers[tier],
      gems: a.gems[Math.min(tier, a.gems.length - 1)],
      text: a.desc.replace('{n}', fmtNum(next)),
    };
  }
  function claimAchievement(id) {
    const a = ACHIEVEMENTS.find(x => x.id === id);
    const info = achievementInfo(a);
    if (!info.claimable) return null;
    S.achievements[id] = info.tier + 1;
    const got = grant({ gems: info.gems });
    emit('achievementClaimed', { a, got });
    return got;
  }
  function badgeCount() {
    let n = 0;
    for (const q of S.quests) if (questInfo(q).done) n++;
    for (const a of ACHIEVEMENTS) if (achievementInfo(a).claimable) n++;
    return n;
  }

  /* ---------------- Tagesbelohnung ---------------- */
  function dailyStatus() {
    const today = dayKey();
    if (S.daily.last === today) return { claimable: false, streak: S.daily.streak, idx: (S.daily.streak - 1) % DAILY.length };
    const y = new Date(); y.setDate(y.getDate() - 1);
    const streak = S.daily.last === dayKey(y) ? S.daily.streak + 1 : 1;
    const idx = (streak - 1) % DAILY.length;
    return { claimable: true, streak, idx, reward: scaled(DAILY[idx]) };
  }
  function claimDaily() {
    const st = dailyStatus();
    if (!st.claimable) return null;
    S.daily = { last: dayKey(), streak: st.streak };
    const got = grant(st.reward);
    emit('dailyClaimed', { got, st });
    save();
    return got;
  }

  /* ---------------- Shop ---------------- */
  function shopPrice(item) {
    if (item.kind === 'builder') return S.builders >= CONFIG.maxBuilders ? null : { gems: CONFIG.builderGemCost[S.builders] };
    const p = {};
    for (const k in item.price) p[k] = k === 'gems' ? item.price[k] : niceRound(item.price[k] * rewardScale());
    return p;
  }
  function shopGive(item) { return item.give ? scaled(item.give) : null; }
  function buy(id) {
    const item = SHOP.find(s => s.id === id);
    const price = shopPrice(item);
    if (!price) return { ok: false, reason: 'Ausverkauft.' };
    if (!canAfford(price)) return { ok: false, reason: 'Nicht genug Ressourcen.', missing: missing(price) };
    const give = shopGive(item);
    if (give) {
      for (const k in give) {
        if ((k === 'euro' || k === 'wood') && S.res[k] + give[k] > storageCap(k) + 0.5 && S.res[k] >= storageCap(k)) return { ok: false, reason: 'Dein Lager ist voll.' };
      }
    }
    pay(price);
    let got = null;
    if (item.kind === 'builder') S.builders++;
    if (give) got = grant(give);
    if (item.boost) {
      const t = now();
      const cur = S.boosts[item.boost.key];
      const startT = cur && cur.until > t ? cur.until : t;
      S.boosts[item.boost.key] = { value: item.boost.value, until: startT + item.boost.minutes * 60000 };
    }
    emit('bought', { item, got });
    return { ok: true, got };
  }

  /* ---------------- Haupt-Update ---------------- */
  /* ---------------- Zum Antippen: Müll & Trinkgeld ---------------- */
  function addPickup(k, x, y, mult) {
    const p = { id: ++S.pickupSeq, k, x: Math.floor(x) + 0.5, y: Math.floor(y) + 0.5, t: now(), m: mult || 1 };
    S.pickups.push(p);
    if (k === 'litter') dirtySat();
    return p;
  }
  function spawnLitter() {
    const pc = CONFIG.pickups;
    if (!G.guests.length || S.pickups.filter(p => p.k === 'litter').length >= pc.litterMax) return;
    const g = pick(G.guests.filter(x => x.state !== 'arrive' && x.state !== 'leave' && x.state !== 'checkin'));
    if (!g) return;
    for (let i = 0; i < 10; i++) {
      const x = Math.floor(g.x) + randInt(-1, 1), y = Math.floor(g.y) + randInt(-1, 1);
      if (walkable(x, y) && inArea(x, y) && !S.pickups.some(p => Math.floor(p.x) === x && Math.floor(p.y) === y)) { addPickup('litter', x, y); return; }
    }
  }
  function collectPickup(id) {
    const i = S.pickups.findIndex(p => p.id === id);
    if (i < 0) return null;
    const p = S.pickups[i];
    S.pickups.splice(i, 1);
    const pc = CONFIG.pickups;
    let got;
    if (p.k === 'litter') {
      S.stats.litter = (S.stats.litter || 0) + 1;
      got = grant({ euro: niceRound(pc.litterEuro * rewardScale()) });
      dirtySat();
    } else got = grant({ euro: niceRound(pc.tipEuro * rewardScale() * p.m), stars: p.m > 1 ? 2 : 1 });
    emit('pickup', { p, got });
    return { p, got };
  }

  function update(dt) {
    const t = now();
    if (t - S.lastTick > 5000) resume();
    else { advance(S.lastTick, t, false); S.lastTick = t; }
    G.satT -= dt;
    if (G.satT <= 0) { dirtySat(); G.satT = 0.5; }
    G.checkT -= dt;
    const doCheck = G.checkT <= 0;
    if (doCheck) G.checkT = 1;
    updateGuests(Math.min(dt, 0.1), t, doCheck);
    G.litterT -= dt;
    if (G.litterT <= 0) { G.litterT = rand(CONFIG.pickups.litterSec[0], CONFIG.pickups.litterSec[1]); spawnLitter(); }
    if (doCheck) {
      const keep = S.pickups.filter(p => p.k !== 'tip' || t - p.t < CONFIG.pickups.tipSec * 1000);
      if (keep.length !== S.pickups.length) S.pickups = keep;
      if (S.event && S.event.until <= t) { const ev = S.event; S.event = null; dirtySat(); emit('eventEnded', { ev }); }
      for (const k in S.boosts) if (S.boosts[k].until <= t) delete S.boosts[k];
      maybeStartEvent(t);
      emit('tick');
    }
    G.saveT += dt;
    if (G.saveT >= CONFIG.autosaveSec) save();
  }

  function fmtNum(n) {
    n = Math.floor(n);
    if (Math.abs(n) >= 1e6) return (n / 1e6).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' Mio.';
    return n.toLocaleString('de-DE');
  }

  function resetAll() {
    try { localStorage.removeItem(CONFIG.saveKey); } catch (e) { /* egal */ }
    newGame();
    save();
  }

  return {
    get S() { return S; }, G, N,
    on, emit, init, save, resume, update, resetAll, newGame,
    def, costFor, timeFor, baseRate, needsOf, guestMood, rateOf, storageOfBuilding, storageCap,
    maxCount, countOf, isUnlocked, levelCap, maxLevelOf, tierIndex, incomeMultiplier, activeMod,
    satisfaction, area, areaSize, inArea, isRoad, gateTile, roadX, occAt, canPlace, walkable, doorOf,
    parcelAt, parcelRect, parcelInfo, buyParcel, buyableParcels, landBought, landPermits, ownedTile, LN,
    collectPickup, obstacleCost, obstacleLoot,
    getBuilding: id => byId.get(id),
    placeCheck, placeNew, moveBuilding, upgradeCheck, upgrade, speedUp, speedUpCost, gemCost, remaining,
    collect, canCollect, collectThreshold, removeObstacle, demolish, canAfford, missing, grant,
    freeBuilders, busyBuilders, wishText, isWishMet, needAvailable,
    lockSave: () => { saveLocked = true; },
    eventChoiceInfo, chooseEvent, catchDog,
    questInfo, claimQuest, achievementInfo, claimAchievement, badgeCount,
    dailyStatus, claimDaily, shopPrice, shopGive, buy, scaled, fmtNum, rewardScale,
  };
})();
