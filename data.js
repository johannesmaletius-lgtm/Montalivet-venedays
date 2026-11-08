'use strict';
/* ==========================================================================
 * data.js – Inhalte & Balancing
 * Alle Zahlen, die das Spielgefühl bestimmen, stehen hier zentral.
 * Zeiten in Sekunden, Produktionsraten pro Stunde.
 * ========================================================================== */

const CONFIG = {
  saveKey: 'campingplatz-save-v1',
  saveVersion: 3,                 // v2: größere Karte (44) + Bedürfnisse, v3: Grundstücke
  autosaveSec: 10,

  map: {
    size: 44,                                          // Gesamtraster (Kacheln)
    areaByReception: [20, 22, 24, 26, 28, 30, 32, 34, 36, 38], // nur noch für alte Spielstände (v2)
  },

  // Grundstücke: die Karte ist in Parzellen geteilt; man kauft sie einzeln dazu, wo man möchte.
  land: {
    bounds: [0, 6, 12, 17, 22, 27, 32, 38, 44],        // Parzellengrenzen (gleich für x und y)
    start: [12, 32],                                   // Startfläche (x und y von–bis)
    permits: [1, 3, 6, 9, 12, 16, 21, 27, 34, 48],     // so viele Parzellen dürfen je Rezeptionslevel insgesamt dazugekauft sein
    euro: 800, wood: 150, growth: 1.2,                 // Preis der k-ten gekauften Parzelle: Basis × growth^k
    // Was auf einer neuen Parzelle wartet (Gewichte); die erste gekaufte enthält immer eine Schatzkiste
    features: [['chest', 30], ['forest', 20], ['ruin', 12], ['pond', 10], ['meadow', 28]],
    obstacleDensity: 0.1,
  },

  // Dinge zum Antippen auf dem Platz
  pickups: {
    litterSec: [25, 55],          // so oft lässt jemand Müll liegen (nur während du spielst)
    litterMax: 6,
    litterSat: 2,                 // Zufriedenheit −2 je Müllstück (max. −10)
    litterEuro: 25,               // Belohnung fürs Aufheben (skaliert mit Rezeptionslevel)
    tipChance: 0.18,              // Chance, dass ein gut gelaunter Gast nach einer Aktivität Trinkgeld liegen lässt
    tipMinMood: 65,
    tipEuro: 60,
    tipSec: 45,                   // so lange bleibt Trinkgeld liegen
  },

  start: { euro: 800, wood: 150, gems: 25, stars: 0, builders: 2 },
  maxBuilders: 5,
  builderGemCost: [0, 0, 60, 150, 300],                // Preis für den n-ten Bauarbeiter (Index = aktuelle Anzahl)

  // Lagerkapazität je Rezeptionslevel
  storage: {
    euro: [3000, 10000, 30000, 70000, 160000, 350000, 700000, 1400000, 2800000, 5000000],
    wood: [1000, 3000, 8000, 20000, 50000, 100000, 200000, 400000, 800000, 1500000],
  },
  levelCapOffset: 1,              // Gebäude dürfen max. Rezeptionslevel + 1 erreichen
  buildingStorageHours: 8,        // so viele Stunden Produktion fasst ein Gebäude
  collectMinMinutes: 0.5,         // Münze erscheint ab x Minuten Produktion
  offline: { maxHours: 8, efficiency: 1, minSecondsForSummary: 90, maxEuroShare: 0.25 }, // offline höchstens 25 % des Euro-Lagers verdienen

  // Zufriedenheit = base + Summe(Bedürfnis-Gewicht × Erfüllung) + Deko + Rezeption + Ereignisse
  // (Gewichte und Bedarf pro Gast stehen weiter unten in NEEDS)
  satisfaction: {
    base: 30,
    decoMax: 10,                  // max. Bonus durch Deko
    receptionBonus: 1,            // + pro Rezeptionslevel über 1
    demandGrowth: 0.12,           // Gäste werden je Rezeptionslevel anspruchsvoller (+12 % Bedarf)
    incomeMin: 0.6,               // Einnahmefaktor bei 0 %
    incomeMax: 1.4,               // Einnahmefaktor bei 100 %
  },

  // Sterne-Klassifizierung (wie Trophäen-Ligen)
  ratingTiers: [
    { stars: 0, name: 'Neuer Platz', bonus: 0 },
    { stars: 50, name: '1-Sterne-Platz', bonus: 0.05 },
    { stars: 200, name: '2-Sterne-Platz', bonus: 0.10 },
    { stars: 600, name: '3-Sterne-Platz', bonus: 0.15 },
    { stars: 1500, name: '4-Sterne-Platz', bonus: 0.22 },
    { stars: 4000, name: '5-Sterne-Resort', bonus: 0.30 },
  ],

  // Gems zum Beschleunigen: Stützpunkte [Sekunden, Gems], dazwischen linear
  speedup: { freeSeconds: 5, points: [[0, 0], [60, 1], [3600, 20], [86400, 260], [604800, 1000]] },

  rewardScale: 1.6,               // Belohnungen/Ereigniskosten wachsen pro Rezeptionslevel um diesen Faktor

  dayNight: { cycleSec: 720 },    // ein Spieltag dauert 12 Minuten

  events: { firstAfterSec: 150, everySec: [240, 480] },

  obstacleDensityOnUnlock: 0.14,
};

/* --------------------------------------------------------------------------
 * Bedürfnisse der Camper
 * perGuest: benötigte Punkte pro Gästeplatz, weight: max. Zufriedenheitspunkte,
 * penalty: zusätzlicher Abzug, wenn das Bedürfnis gar nicht erfüllt ist
 * -------------------------------------------------------------------------- */
const NEEDS = {
  hygiene: { name: 'Hygiene', color: '#0ea5e9', perGuest: 1.0, weight: 16, penalty: 15, desc: 'Duschen, WCs und frische Wäsche – sauber muss es sein.' },
  sport: { name: 'Sport', color: '#16a34a', perGuest: 0.8, weight: 11, desc: 'Bewegung, Spiel und ein bisschen Wettkampf.' },
  kultur: { name: 'Kultur', color: '#7c3aed', perGuest: 0.6, weight: 9, desc: 'Theater, Kino, Bücher und Geschichten.' },
  kunst: { name: 'Kunst', color: '#db2777', perGuest: 0.5, weight: 8, desc: 'Selbst kreativ werden und Schönes entdecken.' },
  party: { name: 'Party', color: '#ea580c', perGuest: 0.8, weight: 11, desc: 'Musik, Feiern und gute Laune bis spät.' },
};
const NEED_ORDER = ['hygiene', 'sport', 'kultur', 'kunst', 'party'];

/* --------------------------------------------------------------------------
 * Gebäude
 * cost/time gelten für Level 1, danach * costGrowth^(L-1) bzw. * timeGrowth^(L-1)
 * rate: Produktion/Std. auf Level 1
 * needs: Bedürfnispunkte auf Level 1, danach * needGrowth^(L-1)
 * cat: Kategorie im Baumenü (pitch, hygiene, sport, kultur, kunst, party, service, deco)
 * max: maximale Anzahl je Rezeptionslevel (Index 0 = Level 1)
 * -------------------------------------------------------------------------- */
const BUILDINGS = {
  reception: {
    name: 'Rezeption', cat: 'service', w: 4, d: 4, height: 96, unlock: 1, buildable: false,
    desc: 'Das Herz deines Platzes. Höhere Level schalten neue Gebäude, mehr Fläche und größere Lager frei.',
    levels: [
      { cost: {}, time: 0 },
      { cost: { euro: 1000, wood: 80 }, time: 45 },
      { cost: { euro: 6000, wood: 600 }, time: 240 },
      { cost: { euro: 20000, wood: 1500 }, time: 900 },
      { cost: { euro: 50000, wood: 4000 }, time: 2700 },
      { cost: { euro: 120000, wood: 10000 }, time: 5400 },
      { cost: { euro: 250000, wood: 25000 }, time: 10800 },
      { cost: { euro: 500000, wood: 50000 }, time: 21600 },
      { cost: { euro: 1000000, wood: 100000 }, time: 36000 },
      { cost: { euro: 2000000, wood: 200000 }, time: 57600 },
    ],
    max: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    lights: [[1.2, 4, 26], [2.8, 4, 26], [4, 1.5, 26], [4, 2.8, 26]],
  },

  // ---- Stellplätze (Einnahmen) ----
  tent: {
    name: 'Zeltplatz', cat: 'pitch', w: 2, d: 2, height: 38, unlock: 1,
    desc: 'Ein einfacher Stellplatz für Zelte. Günstig und schnell gebaut.',
    cost: { euro: 100 }, costGrowth: 1.75, time: 8, timeGrowth: 2.2,
    produces: 'euro', rate: 1200, rateGrowth: 1.38, guests: 2,
    max: [3, 4, 5, 6, 6, 7, 7, 8, 8, 9],
  },
  rv: {
    name: 'Wohnmobil-Stellplatz', cat: 'pitch', w: 3, d: 3, height: 50, unlock: 2,
    desc: 'Großzügiger Platz mit Stromanschluss für Wohnmobile.',
    cost: { euro: 400 }, costGrowth: 1.7, time: 20, timeGrowth: 2.05,
    produces: 'euro', rate: 2000, rateGrowth: 1.38, guests: 3,
    max: [0, 2, 3, 3, 4, 4, 5, 5, 6, 6],
  },
  mobilehome: {
    name: 'Mobilheim', cat: 'pitch', w: 3, d: 3, height: 62, unlock: 3,
    desc: 'Ein gemütliches Ferienhäuschen zum Mieten.',
    cost: { euro: 1500, wood: 300 }, costGrowth: 1.7, time: 90, timeGrowth: 1.85,
    produces: 'euro', rate: 3600, rateGrowth: 1.38, guests: 4,
    max: [0, 0, 1, 2, 2, 3, 3, 4, 4, 5],
    lights: [[1.5, 3, 16]],
  },
  treehouse: {
    name: 'Baumhaus-Lodge', cat: 'pitch', w: 3, d: 3, height: 96, unlock: 7,
    desc: 'Übernachten in der Krone einer riesigen Eiche. Der Traum jedes Gastes.',
    cost: { euro: 70000, wood: 25000 }, costGrowth: 1.32, time: 1500, timeGrowth: 1.45,
    produces: 'euro', rate: 30000, rateGrowth: 1.3, guests: 3,
    max: [0, 0, 0, 0, 0, 0, 1, 2, 2, 3],
    lights: [[1.4, 2.0, 26, 'warm', 50], [0.65, 2.35, 14, 'lamp', 34], [2.3, 0.75, 14, 'lamp', 34]],
  },
  glamping: {
    name: 'Glamping-Zelt', cat: 'pitch', w: 3, d: 3, height: 64, unlock: 5,
    desc: 'Luxus-Zelt mit Holzdeck und Lichterkette. Bringt richtig Geld.',
    cost: { euro: 6000, wood: 1500 }, costGrowth: 1.65, time: 480, timeGrowth: 1.6,
    produces: 'euro', rate: 7200, rateGrowth: 1.38, guests: 2,
    max: [0, 0, 0, 0, 1, 2, 2, 3, 3, 4],
    lights: [[1.5, 1.5, 30]],
  },

  // ---- Service ----
  lumberjack: {
    name: 'Holzfäller-Hütte', cat: 'service', w: 2, d: 2, height: 50, unlock: 1,
    desc: 'Der Holzfäller liefert stetig Holz für Bauprojekte.',
    cost: { euro: 150 }, costGrowth: 1.75, time: 12, timeGrowth: 2.1,
    produces: 'wood', rate: 700, rateGrowth: 1.38,
    max: [1, 1, 2, 2, 2, 3, 3, 3, 4, 4],
  },

  // ---- Hygiene ----
  sanitary: {
    name: 'Sanitärhaus', cat: 'hygiene', w: 3, d: 3, height: 54, unlock: 1,
    desc: 'Duschen und WCs – die Grundlage für zufriedene Gäste.',
    cost: { euro: 300 }, costGrowth: 1.8, time: 15, timeGrowth: 2.1,
    needs: { hygiene: 12 }, needGrowth: 1.25,
    max: [1, 1, 2, 2, 2, 3, 3, 3, 4, 4],
    lights: [[1.5, 3, 20]],
  },
  laundry: {
    name: 'Waschhaus', cat: 'hygiene', w: 2, d: 2, height: 48, unlock: 2,
    desc: 'Waschmaschinen, Trockner und Spülbecken für frische Wäsche.',
    cost: { euro: 700, wood: 100 }, costGrowth: 1.75, time: 45, timeGrowth: 2.0,
    needs: { hygiene: 8 }, needGrowth: 1.25,
    max: [0, 1, 1, 2, 2, 2, 3, 3, 3, 3],
    lights: [[1.08, 1.25, 22, 'warm', 12], [1.76, 0.85, 14, 'warm', 10]],
  },
  spa: {
    name: 'Wellness-Spa', cat: 'hygiene', w: 4, d: 3, height: 58, unlock: 6,
    desc: 'Sauna, Dampfbad und Whirlpool – Luxus für Körper und Seele.',
    cost: { euro: 18000, wood: 3000 }, costGrowth: 1.6, time: 3000, timeGrowth: 1.6,
    needs: { hygiene: 26 }, needGrowth: 1.22,
    max: [0, 0, 0, 0, 0, 1, 1, 1, 1, 2],
    lights: [[1.4, 1.4, 34, 'warm', 16], [3.22, 2.12, 26, 'pool', 14], [3.78, 0.62, 14, 'warm', 12], [2.5, 2.9, 16, 'lamp', 20]],
  },

  // ---- Sport ----
  tabletennis: {
    name: 'Tischtennis\u00ADplatte', cat: 'sport', w: 2, d: 2, height: 26, unlock: 1,
    desc: 'Ping, Pong, Ping – für schnelle Matches zwischendurch.',
    cost: { euro: 250 }, costGrowth: 1.75, time: 15, timeGrowth: 2.1,
    needs: { sport: 4 }, needGrowth: 1.22,
    max: [1, 2, 2, 2, 3, 3, 3, 4, 4, 4],
  },
  playground: {
    name: 'Spielplatz', cat: 'sport', w: 3, d: 3, height: 46, unlock: 3,
    desc: 'Rutsche und Schaukel – Familien lieben ihn.',
    cost: { euro: 1200, wood: 400 }, costGrowth: 1.7, time: 90, timeGrowth: 1.9,
    needs: { sport: 5 }, needGrowth: 1.22,
    max: [0, 0, 1, 1, 1, 2, 2, 2, 2, 2],
  },
  soccer: {
    name: 'Bolzplatz', cat: 'sport', w: 4, d: 3, height: 34, unlock: 3,
    desc: 'Zwei Tore, ein Ball – das Spiel dauert bis zum Abendessen.',
    cost: { euro: 2500, wood: 300 }, costGrowth: 1.7, time: 180, timeGrowth: 1.8,
    needs: { sport: 9 }, needGrowth: 1.22,
    max: [0, 0, 1, 1, 1, 1, 2, 2, 2, 2],
    lights: [[0.12, 2.88, 26, 'lamp', 35], [3.88, 0.12, 26, 'lamp', 35], [1.3, 1.9, 52, 'lamp', 0], [2.7, 1.1, 52, 'lamp', 0]],
  },
  volleyball: {
    name: 'Beach\u00ADvolleyball\u00ADfeld', cat: 'sport', w: 4, d: 3, height: 40, unlock: 4,   // \u00AD = weiche Trennstellen für schmale Karten
    desc: 'Sand, Netz und Sonne. Sportliche Gäste sind begeistert.',
    cost: { euro: 4000, wood: 600 }, costGrowth: 1.7, time: 300, timeGrowth: 1.75,
    needs: { sport: 8 }, needGrowth: 1.22,
    max: [0, 0, 0, 1, 1, 1, 1, 1, 2, 2],
  },
  lake: {
    name: 'See mit Steg', cat: 'sport', w: 4, d: 4, height: 30, unlock: 4,
    desc: 'Ein kleiner Badesee mit Holzsteg. Schwimmen, planschen – Enten inklusive.',
    cost: { euro: 5000, wood: 1500 }, costGrowth: 1.7, time: 480, timeGrowth: 1.7,
    needs: { sport: 6, hygiene: 3 }, needGrowth: 1.22,
    max: [0, 0, 0, 1, 1, 1, 1, 2, 2, 2],
  },
  pool: {
    name: 'Pool', cat: 'sport', w: 4, d: 4, height: 40, unlock: 5,
    desc: 'Türkisblaues Wasser und Liegestühle. Das Highlight für jeden Gast.',
    cost: { euro: 15000, wood: 2000 }, costGrowth: 1.6, time: 1200, timeGrowth: 1.6,
    needs: { sport: 8, party: 5 }, needGrowth: 1.22,
    max: [0, 0, 0, 0, 1, 1, 1, 1, 1, 2],
    lights: [[2, 2, 50, 'pool']],
  },
  climbing: {
    name: 'Kletterturm', cat: 'sport', w: 2, d: 2, height: 84, unlock: 6,
    desc: 'Ein bunter Turm mit Griffen, Seilen und Aussicht über den ganzen Platz.',
    cost: { euro: 18000, wood: 3000 }, costGrowth: 1.6, time: 2400, timeGrowth: 1.6,
    needs: { sport: 14 }, needGrowth: 1.22,
    max: [0, 0, 0, 0, 0, 1, 1, 1, 2, 2],
    lights: [[1.65, 1.65, 32, 'warm', 68]],
  },

  // ---- Kultur ----
  library: {
    name: 'Lesehütte', cat: 'kultur', w: 2, d: 2, height: 46, unlock: 1,
    desc: 'Eine gemütliche Bücherhütte mit Leseecke und Wanderkarten.',
    cost: { wood: 120 }, costGrowth: 1.8, time: 20, timeGrowth: 2.1,
    needs: { kultur: 4 }, needGrowth: 1.22,
    max: [1, 1, 2, 2, 2, 2, 2, 3, 3, 3],
    lights: [[0.68, 1.45, 22, 'warm', 13], [1.46, 1.36, 12, 'lamp', 18]],
  },
  stage: {
    name: 'Freilicht\u00ADbühne', cat: 'kultur', w: 4, d: 4, height: 62, unlock: 4,
    desc: 'Theater, Lesungen und Konzerte unter freiem Himmel.',
    cost: { euro: 8000, wood: 1500 }, costGrowth: 1.6, time: 600, timeGrowth: 1.7,
    needs: { kultur: 10, party: 4 }, needGrowth: 1.22,
    max: [0, 0, 0, 1, 1, 1, 1, 1, 2, 2],
    lights: [[1.25, 1.25, 50, 'warm', 18], [0.95, 0.95, 32, 'warm', 40]],
  },
  cinema: {
    name: 'Open-Air-Kino', cat: 'kultur', w: 4, d: 3, height: 72, unlock: 6,
    desc: 'Große Leinwand, Liegestühle und Popcorn unter den Sternen.',
    cost: { euro: 20000, wood: 2500 }, costGrowth: 1.6, time: 2400, timeGrowth: 1.6,
    needs: { kultur: 14, party: 3 }, needGrowth: 1.22,
    max: [0, 0, 0, 0, 0, 1, 1, 1, 1, 2],
    lights: [[1.3, 0.5, 34, 'pool', 40], [2.7, 0.5, 34, 'pool', 40], [0.43, 2.53, 14, 'warm', 22], [3.86, 2.44, 12, 'warm', 15]],
  },

  // ---- Kunst ----
  atelier: {
    name: 'Malatelier', cat: 'kunst', w: 2, d: 2, height: 52, unlock: 2,
    desc: 'Staffeleien, Farben und Pinsel – hier entstehen Urlaubsbilder.',
    cost: { euro: 600, wood: 150 }, costGrowth: 1.75, time: 40, timeGrowth: 2.0,
    needs: { kunst: 4 }, needGrowth: 1.22,
    max: [0, 1, 2, 2, 2, 2, 2, 3, 3, 3],
    lights: [[0.73, 1.4, 26, 'warm', 13], [0.76, 0.64, 16, 'warm', 38]],
  },
  sculpture: {
    name: 'Skulpturen\u00ADgarten', cat: 'kunst', w: 3, d: 3, height: 52, unlock: 4,
    desc: 'Ein kleiner Park voller Statuen und Kunstwerke zum Staunen.',
    cost: { euro: 5000, wood: 800 }, costGrowth: 1.6, time: 420, timeGrowth: 1.7,
    needs: { kunst: 9 }, needGrowth: 1.22,
    max: [0, 0, 0, 1, 1, 1, 2, 2, 2, 2],
    lights: [[1.84, 2.86, 26, 'lamp', 25], [2.86, 1.84, 26, 'lamp', 25]],
  },
  observatory: {
    name: 'Sternwarte', cat: 'kultur', w: 3, d: 3, height: 80, unlock: 7,
    desc: 'Ein Teleskop unter der Kuppel – nachts staunen alle über Sterne und Planeten.',
    cost: { euro: 90000, wood: 20000 }, costGrowth: 1.32, time: 1800, timeGrowth: 1.4,
    needs: { kultur: 16, kunst: 6 }, needGrowth: 1.2,
    max: [0, 0, 0, 0, 0, 0, 1, 1, 1, 2],
    lights: [[1.6, 1.6, 34, 'warm', 56], [1.25, 2.25, 16, 'warm', 10]],
  },
  pottery: {
    name: 'Töpferei', cat: 'kunst', w: 3, d: 3, height: 66, unlock: 6,
    desc: 'Drehscheibe und Brennofen – jeder Gast nimmt eine Tasse mit nach Hause.',
    cost: { euro: 16000, wood: 3500 }, costGrowth: 1.6, time: 2400, timeGrowth: 1.6,
    needs: { kunst: 14 }, needGrowth: 1.22,
    max: [0, 0, 0, 0, 0, 1, 1, 1, 2, 2],
    lights: [[0.73, 1.55, 22, 'warm', 16], [2.48, 0.82, 22, 'fire', 5], [2.22, 2.16, 18, 'lamp', 29]],
  },

  // ---- Party ----
  campfire: {
    name: 'Lager\u00ADfeuer\u00ADplatz', cat: 'party', w: 2, d: 2, height: 24, unlock: 1,
    desc: 'Stockbrot und Gitarrenmusik – ein Klassiker.',
    cost: { wood: 60 }, costGrowth: 1.8, time: 10, timeGrowth: 2.1,
    needs: { party: 3, kultur: 1 }, needGrowth: 1.22,
    max: [1, 1, 1, 2, 2, 2, 2, 3, 3, 3],
    lights: [[1, 1, 70, 'fire']],
  },
  kiosk: {
    name: 'Kiosk', cat: 'party', w: 2, d: 2, height: 48, unlock: 2,
    desc: 'Eis, Brötchen und kalte Getränke. Macht Gäste froh und bringt etwas Geld.',
    cost: { euro: 500, wood: 100 }, costGrowth: 1.75, time: 30, timeGrowth: 2.0,
    needs: { party: 2 }, needGrowth: 1.22, produces: 'euro', rate: 600, rateGrowth: 1.35,
    max: [0, 1, 1, 1, 2, 2, 2, 2, 3, 3],
    lights: [[1, 2, 22]],
  },
  bbq: {
    name: 'Grillplatz', cat: 'party', w: 2, d: 2, height: 30, unlock: 2,
    desc: 'Würstchen, Maiskolben und lange Abende mit Nachbarn.',
    cost: { euro: 400, wood: 80 }, costGrowth: 1.75, time: 30, timeGrowth: 2.0,
    needs: { party: 4 }, needGrowth: 1.22,
    max: [0, 1, 1, 2, 2, 2, 2, 3, 3, 3],
    lights: [[1.38, 0.46, 30, 'fire', 16], [0.72, 1.32, 22, 'warm', 14]],
  },
  beachbar: {
    name: 'Strandbar', cat: 'party', w: 3, d: 3, height: 60, unlock: 3,
    desc: 'Cocktails, Sand unter den Füßen und Musik – bringt auch etwas Geld.',
    cost: { euro: 3000, wood: 600 }, costGrowth: 1.7, time: 240, timeGrowth: 1.8,
    needs: { party: 8 }, needGrowth: 1.22, produces: 'euro', rate: 900, rateGrowth: 1.35,
    max: [0, 0, 1, 1, 1, 2, 2, 2, 2, 2],
    lights: [[1.45, 1.62, 42, 'warm', 22], [1, 2.82, 22, 'fire', 32]],
  },
  festtent: {
    name: 'Festzelt', cat: 'party', w: 4, d: 4, height: 72, unlock: 5,
    desc: 'Bierbänke, Tanzfläche und Livemusik – hier wird gefeiert.',
    cost: { euro: 12000, wood: 2000 }, costGrowth: 1.6, time: 1500, timeGrowth: 1.65,
    needs: { party: 14 }, needGrowth: 1.22,
    max: [0, 0, 0, 0, 1, 1, 1, 1, 2, 2],
    lights: [[1.4, 3, 50, 'warm', 20], [2.1, 3.3, 34, 'lamp', 40], [3.55, 1.9, 34, 'warm', 16]],
  },

  ferris: {
    name: 'Riesenrad', cat: 'party', w: 3, d: 3, height: 100, unlock: 8,
    desc: 'Von ganz oben sieht man den ganzen Platz – und den Sonnenuntergang.',
    cost: { euro: 160000, wood: 30000 }, costGrowth: 1.29, time: 2400, timeGrowth: 1.4,
    needs: { party: 18, kultur: 4 }, needGrowth: 1.2,
    max: [0, 0, 0, 0, 0, 0, 0, 1, 1, 2],
    lights: [[1.5, 1.5, 48, 'lamp', 60], [0.65, 2.4, 18, 'warm', 12]],
  },
  waterslide: {
    name: 'Wasserrutsche', cat: 'sport', w: 4, d: 4, height: 92, unlock: 9,
    desc: 'Ein Turm mit kurviger Röhre und Platsch-Becken. Kreischen garantiert.',
    cost: { euro: 260000, wood: 50000 }, costGrowth: 1.28, time: 3000, timeGrowth: 1.4,
    needs: { sport: 20, party: 6 }, needGrowth: 1.2,
    max: [0, 0, 0, 0, 0, 0, 0, 0, 1, 2],
    lights: [[2.75, 2.85, 52, 'pool', 0], [0.85, 0.85, 20, 'lamp', 70]],
  },

  // ---- Deko (sofort gebaut, keine Level) ----
  path: {
    name: 'Weg', cat: 'deco', w: 1, d: 1, height: 2, unlock: 1, maxLevel: 1, walkable: true, flat: true,
    desc: 'Gäste laufen lieber auf Wegen.', cost: { euro: 5 }, decor: 0.05,
    max: [40, 55, 70, 85, 100, 115, 130, 145, 160, 180],
  },
  tree: {
    name: 'Baum', cat: 'deco', w: 1, d: 1, height: 70, unlock: 1, maxLevel: 1,
    desc: 'Spendet Schatten und macht den Platz grüner.', cost: { euro: 30 }, decor: 0.6, green: true,
    max: [10, 15, 20, 25, 30, 35, 40, 45, 50, 60],
  },
  flowers: {
    name: 'Blumenbeet', cat: 'deco', w: 1, d: 1, height: 14, unlock: 1, maxLevel: 1,
    desc: 'Bunte Blüten für gute Laune.', cost: { euro: 20 }, decor: 0.8, green: true,
    max: [10, 15, 20, 25, 30, 35, 40, 45, 50, 60],
  },
  fence: {
    name: 'Zaun', cat: 'deco', w: 1, d: 1, height: 20, unlock: 1, maxLevel: 1,
    desc: 'Ein Holzzaun, der sich mit Nachbarn verbindet.', cost: { wood: 5 }, decor: 0.15,
    max: [20, 30, 40, 50, 60, 70, 80, 90, 100, 120],
  },
  bench: {
    name: 'Sitzbank', cat: 'deco', w: 1, d: 1, height: 18, unlock: 2, maxLevel: 1,
    desc: 'Zum Ausruhen und Leute beobachten.', cost: { wood: 40 }, decor: 0.5,
    max: [0, 3, 4, 5, 6, 7, 8, 9, 10, 12],
  },
  lantern: {
    name: 'Laterne', cat: 'deco', w: 1, d: 1, height: 44, unlock: 2, maxLevel: 1,
    desc: 'Leuchtet nachts den Weg.', cost: { euro: 80, wood: 10 }, decor: 0.5,
    max: [0, 4, 6, 8, 10, 12, 14, 16, 18, 20],
    lights: [[0.5, 0.5, 34, 'lamp', 40]],
  },

  // ---- Hindernisse (nicht baubar, können geräumt werden) ----
  obs_tree: { name: 'Alte Kiefer', cat: 'obstacle', w: 1, d: 1, height: 76, buildable: false, maxLevel: 1, remove: { euro: 40 }, gives: { wood: 30 } },
  obs_bush: { name: 'Gestrüpp', cat: 'obstacle', w: 1, d: 1, height: 22, buildable: false, maxLevel: 1, remove: { euro: 20 }, gives: { wood: 8 } },
  obs_rock: { name: 'Felsbrocken', cat: 'obstacle', w: 1, d: 1, height: 24, buildable: false, maxLevel: 1, remove: { euro: 60 }, gives: {} },
  obs_chest: { name: 'Schatzkiste', cat: 'obstacle', w: 1, d: 1, height: 22, buildable: false, maxLevel: 1, remove: {}, gives: { euro: 400, wood: 100 } },
  obs_ruin: { name: 'Alte Mühlenruine', cat: 'obstacle', w: 2, d: 2, height: 46, buildable: false, maxLevel: 1, remove: { wood: 300 }, gives: { stars: 10 } },
  obs_stump: { name: 'Baumstumpf', cat: 'obstacle', w: 1, d: 1, height: 14, buildable: false, maxLevel: 1, remove: { euro: 15 }, gives: { wood: 12 } },
};

const CATEGORIES = [
  { id: 'pitch', name: 'Stellplätze', icon: 'build' },
  { id: 'hygiene', name: 'Hygiene', icon: 'hygiene' },
  { id: 'sport', name: 'Sport', icon: 'sport' },
  { id: 'kultur', name: 'Kultur', icon: 'kultur' },
  { id: 'kunst', name: 'Kunst', icon: 'kunst' },
  { id: 'party', name: 'Party', icon: 'party' },
  { id: 'service', name: 'Service', icon: 'hammer' },
  { id: 'deco', name: 'Deko', icon: 'tree' },
];

/* --------------------------------------------------------------------------
 * Gäste
 * -------------------------------------------------------------------------- */
const GUESTS = {
  firstArrivalSec: 4,
  arrivalSec: [22, 45],            // Abstand zwischen Ankünften
  staySec: [180, 400],             // Aufenthaltsdauer
  activitySec: [10, 26],           // wie oft sie eine Attraktion besuchen
  speed: 1.25,                     // Kacheln pro Sekunde
  wishChance: 0.8,
  wishBonusStars: 2,
  wishTipEuro: 60,                 // skaliert mit Rezeptionslevel
  moodMix: 0.5,                    // Stimmung = Mischung aus Gesamtzufriedenheit und eigenen Bedürfnissen
  review: [                        // Sterne beim Abreisen je nach Stimmung des Gastes
    { minMood: 75, stars: 2 },
    { minMood: 55, stars: 1 },
    { minMood: 35, stars: 0 },
    { minMood: 0, stars: -1 },
  ],
  types: {
    family: {
      name: 'Familie', weight: 3, members: ['adult', 'adult2', 'kid'], speed: 0.9,
      pitches: ['mobilehome', 'rv', 'glamping', 'tent'],
      names: ['Müller', 'Schmidt', 'Schneider', 'Fischer', 'Weber', 'Meyer', 'Wagner', 'Becker', 'Hoffmann', 'Koch'],
      label: n => 'Familie ' + n,
      needs: { hygiene: 3, sport: 3, kultur: 2, kunst: 1, party: 1 },
      wishes: [{ b: 'playground' }, { b: 'pool' }, { b: 'tabletennis' }, { b: 'cinema' }, { b: 'laundry' }, { b: 'sanitary', lvl: 2 }, { need: 'sport', min: 80 }, { need: 'hygiene', min: 90 }],
      colors: { shirt: '#3b82f6', shirt2: '#ef4444', kid: '#facc15' },
    },
    camper: {
      name: 'Camper', weight: 3, members: ['camper'], speed: 1,
      pitches: ['tent', 'rv'],
      names: ['Jonas', 'Lena', 'Tobias', 'Sophie', 'Lukas', 'Marie', 'Finn', 'Hannah', 'Paul', 'Emma'],
      label: n => 'Camper ' + n,
      needs: { sport: 3, party: 2, hygiene: 2, kultur: 1, kunst: 1 },
      wishes: [{ b: 'campfire' }, { b: 'soccer' }, { b: 'bbq' }, { b: 'lake' }, { b: 'climbing' }, { need: 'party', min: 70 }, { deco: 6 }],
      colors: { shirt: '#16a34a' },
    },
    senior: {
      name: 'Rentnerpaar', weight: 2, members: ['senior', 'senior2'], speed: 0.7,
      pitches: ['rv', 'mobilehome', 'glamping'],
      names: ['Gerda & Heinz', 'Ilse & Werner', 'Helga & Dieter', 'Ursula & Klaus', 'Renate & Horst'],
      label: n => 'Rentnerpaar ' + n,
      needs: { kultur: 3, kunst: 3, hygiene: 3, sport: 1, party: 0 },
      wishes: [{ b: 'library' }, { b: 'sculpture' }, { b: 'stage' }, { b: 'spa' }, { b: 'lake' }, { need: 'kultur', min: 80 }, { deco: 10 }, { sat: 75 }],
      colors: { shirt: '#a855f7', shirt2: '#d6b38a' },
    },
    backpacker: {
      name: 'Backpacker', weight: 2, members: ['backpacker'], speed: 1.15,
      pitches: ['tent', 'glamping'],
      names: ['Mia', 'Noah', 'Lea', 'Ben', 'Ella', 'Max', 'Nele', 'Tim'],
      label: n => 'Backpacker ' + n,
      needs: { party: 4, kunst: 2, sport: 2, kultur: 1, hygiene: 1 },
      wishes: [{ b: 'beachbar' }, { b: 'festtent' }, { b: 'atelier' }, { b: 'bbq' }, { b: 'volleyball' }, { need: 'party', min: 85 }, { need: 'kunst', min: 60 }],
      colors: { shirt: '#f97316' },
    },
    // ab hier: Gäste, die erst später kommen (minRL)
    school: {
      name: 'Schulklasse', weight: 2, minRL: 4, members: ['adult', 'kid', 'kid'], speed: 1,
      pitches: ['tent', 'mobilehome', 'treehouse'],
      names: ['4a', '5b', '6c', '3a', '7b'],
      label: n => 'Klasse ' + n,
      needs: { sport: 3, kultur: 3, kunst: 2, hygiene: 2, party: 1 },
      wishes: [{ b: 'playground' }, { b: 'library' }, { b: 'climbing' }, { b: 'observatory' }, { b: 'soccer' }, { need: 'kultur', min: 75 }],
      colors: { shirt: '#0ea5e9', shirt2: '#facc15', kid: '#ec4899' },
    },
    influencer: {
      name: 'Influencerin', weight: 1, minRL: 6, members: ['camper'], speed: 1.05, reviewMult: 3,
      pitches: ['glamping', 'treehouse', 'mobilehome'],
      names: ['Jana', 'Lisa', 'Chiara', 'Sarah', 'Romy'],
      label: n => '@' + n.toLowerCase() + '_campt',
      needs: { kunst: 3, party: 3, hygiene: 3, kultur: 1, sport: 1 },
      wishes: [{ b: 'spa' }, { b: 'beachbar' }, { b: 'ferris' }, { b: 'pottery' }, { sat: 85 }, { deco: 15 }],
      colors: { shirt: '#ec4899' },
    },
    vip: {
      name: 'VIP-Gäste', weight: 1, minRL: 8, members: ['adult', 'adult2'], speed: 0.85, reviewMult: 4, tipMult: 5,
      pitches: ['treehouse', 'glamping'],
      names: ['von Hohenstein', 'Graf & Gräfin Berg', 'Dr. Albrecht', 'Familie Rosé'],
      label: n => 'VIP ' + n,
      needs: { hygiene: 4, kultur: 3, kunst: 2, party: 2, sport: 1 },
      wishes: [{ b: 'observatory' }, { b: 'ferris' }, { b: 'waterslide' }, { b: 'spa', lvl: 3 }, { sat: 90 }],
      colors: { shirt: '#1f2937', shirt2: '#b91c1c' },
    },
  },
};

/* --------------------------------------------------------------------------
 * Ereignisse mit Entscheidungen
 * mods: sat (+/- Zufriedenheit), income (Faktor), guestRate (Faktor),
 *       needs ({ sport: -0.3 } = Erfüllung eines Bedürfnisses +/- 30 Prozentpunkte) für die Dauer
 * cost/reward werden mit dem Rezeptionslevel skaliert
 * -------------------------------------------------------------------------- */
const EVENTS = [
  {
    id: 'rain', title: 'Regenschauer', icon: 'rain', weather: 'rain', duration: 150,
    text: 'Dunkle Wolken ziehen über den Platz. Gleich wird es nass!',
    choices: [
      { label: 'Planen & Schirme verteilen', cost: { euro: 150 }, mods: { needs: { sport: -0.2 } }, reward: { stars: 2 }, result: 'Alle bleiben trocken – die Gäste sind dankbar.' },
      { label: 'Vorlesestunde in der Lesehütte', requires: 'library', mods: { needs: { sport: -0.3, kultur: 0.3 } }, result: 'Gemütlich eingekuschelt lauschen alle einer Geschichte.' },
      { label: 'Spieleabend in der Rezeption', cost: { wood: 40 }, mods: { sat: -3, needs: { sport: -0.3 } }, result: 'Bei Brettspielen vergeht der Regen wie im Flug.' },
      { label: 'Abwarten', mods: { sat: -8, needs: { sport: -0.5 } }, result: 'Einige Zelte sind nass geworden, Sport fällt ins Wasser.' },
    ],
  },
  {
    id: 'festival', title: 'Festival-Wochenende', icon: 'festival', weather: 'festival', duration: 240,
    text: 'In der Nähe steigt ein Musikfestival. Viele Besucher suchen einen Schlafplatz!',
    choices: [
      { label: 'Aftershow-Party im Festzelt', requires: 'festtent', mods: { guestRate: 2.5, income: 1.5, needs: { party: 0.4 } }, result: 'Die Party im Festzelt ist legendär!' },
      { label: 'Werbung & Shuttlebus', cost: { euro: 400 }, mods: { guestRate: 3, income: 1.5, sat: -3 }, result: 'Der Platz ist voll – die Kasse klingelt!' },
      { label: 'Ein paar Gäste aufnehmen', mods: { guestRate: 1.8, income: 1.2 }, result: 'Einige Festivalbesucher schauen vorbei.' },
      { label: 'Ruhe bewahren', mods: { sat: 5 }, result: 'Deine Stammgäste genießen die Ruhe.' },
    ],
  },
  {
    id: 'mosquito', title: 'Mückenplage', icon: 'mosquito', weather: 'mosquito', duration: 180,
    text: 'Ein Schwarm Mücken summt über den Platz. Die ersten Gäste kratzen sich schon …',
    choices: [
      { label: 'Mückenspray verteilen', cost: { euro: 200 }, mods: { sat: -2 }, result: 'Das Spray wirkt – fast alle Mücken sind weg.' },
      { label: 'Lagerfeuer räuchern', requires: 'campfire', cost: { wood: 50 }, mods: { sat: 3 }, result: 'Der Rauch vertreibt die Mücken, und am Feuer ist es gemütlich.' },
      { label: 'Ignorieren', mods: { sat: -10, needs: { party: -0.4 } }, result: 'Autsch! Viele Gäste sind zerstochen – abends bleiben alle im Zelt.' },
    ],
  },
  {
    id: 'heat', title: 'Hitzewelle', icon: 'sun', weather: 'heat', duration: 200,
    text: 'Es ist brütend heiß! Die Gäste suchen dringend Abkühlung.',
    choices: [
      { label: 'Gratis-Eis am Kiosk', requires: 'kiosk', cost: { euro: 150 }, mods: { sat: 8, income: 1.1 }, result: 'Eis für alle! Die Stimmung ist bestens.' },
      { label: 'Pool bis Mitternacht öffnen', requires: 'pool', mods: { sat: 12 }, result: 'Planschen bis in die Nacht – herrlich!' },
      { label: 'Kühle Spa-Tage', requires: 'spa', mods: { sat: 8, needs: { hygiene: 0.3 } }, result: 'Kalte Duschen und Eisbecken – alle sind erfrischt.' },
      { label: 'Wasserspender aufstellen', cost: { euro: 100 }, mods: { needs: { hygiene: -0.1 } }, result: 'Niemand verdurstet. Gut gemacht.' },
      { label: 'Nichts tun', mods: { sat: -6, needs: { hygiene: -0.35, sport: -0.3 } }, result: 'Die Gäste schwitzen, die Duschen sind überlaufen.' },
    ],
  },
  {
    id: 'inspector', title: 'Besuch vom Campingverband', icon: 'clipboard', duration: 0,
    text: 'Eine Prüferin des Campingverbands möchte deinen Platz bewerten. Die Zufriedenheit deiner Gäste zählt!',
    choices: [
      { label: 'Rundgang machen', special: 'inspect', result: '' },
      { label: 'Erst schnell aufräumen', cost: { wood: 80 }, special: 'inspectBonus', result: '' },
      { label: 'Termin verschieben', result: 'Die Prüferin kommt ein anderes Mal wieder.' },
    ],
  },
  {
    id: 'bus', title: 'Reisebus', icon: 'bus', duration: 60,
    text: 'Ein Reisebus voller Rentner hält unerwartet an und möchte eine Kaffeepause einlegen.',
    choices: [
      { label: 'Kaffee & Kuchen anbieten', cost: { wood: 30 }, mods: { sat: -4 }, reward: { euro: 300, stars: 4 }, result: 'Der Kuchen war ein Erfolg – großzügiges Trinkgeld!' },
      { label: 'Freundlich weiterschicken', result: 'Der Bus fährt weiter zum nächsten Rastplatz.' },
    ],
  },
  {
    id: 'dog', title: 'Entlaufener Hund', icon: 'dog', duration: 90,
    text: 'Ein Gast vermisst seinen Hund „Bello“. Er muss irgendwo auf dem Platz herumstreunen!',
    choices: [
      { label: 'Suchen helfen', special: 'dog', result: 'Finde Bello auf dem Platz und tippe ihn an!' },
      { label: 'Keine Zeit', mods: { sat: -4 }, result: 'Der Besitzer ist enttäuscht.' },
    ],
  },
  {
    id: 'storm', title: 'Gewitterwarnung', icon: 'storm', weather: 'storm', duration: 150,
    text: 'Der Wetterdienst warnt vor einem kräftigen Gewitter mit Sturmböen.',
    choices: [
      { label: 'Zelte sichern', cost: { wood: 80 }, mods: { sat: -2 }, result: 'Alles hält dem Sturm stand.' },
      { label: 'Gäste in die Rezeption bitten', mods: { sat: -6, income: 0.85, needs: { sport: -0.3 } }, result: 'Es wird eng, aber alle sind sicher.' },
      { label: 'Hoffen, dass es vorbeizieht', special: 'gamble', result: '' },
    ],
  },
  {
    id: 'health', title: 'Kontrolle vom Gesundheitsamt', icon: 'hygiene', duration: 120,
    text: 'Das Gesundheitsamt kündigt eine Hygienekontrolle an. Sind Duschen, WCs und Waschräume in Schuss?',
    choices: [
      { label: 'Kontrolle durchführen lassen', special: 'hygieneCheck', result: '' },
      { label: 'Vorher Putzkolonne rufen', cost: { euro: 250 }, special: 'hygieneCheckBonus', result: '' },
      { label: 'Um Aufschub bitten', mods: { sat: -3 }, result: 'Die Kontrolle wird verschoben – die Gäste tuscheln.' },
    ],
  },
  {
    id: 'artfair', title: 'Kunstmarkt', icon: 'kunst', duration: 180,
    text: 'Eine Gruppe Künstlerinnen und Künstler zieht durch die Gegend und möchte ihre Werke zeigen.',
    choices: [
      { label: 'Ausstellung im Skulpturengarten', requires: 'sculpture', mods: { sat: 4, needs: { kunst: 0.4 } }, reward: { stars: 6 }, result: 'Die Ausstellung lockt Besucher von weit her!' },
      { label: 'Malkurs im Atelier', requires: 'atelier', cost: { wood: 60 }, mods: { needs: { kunst: 0.3 } }, result: 'Überall stehen frisch gemalte Bilder zum Trocknen.' },
      { label: 'Stände auf der Wiese', cost: { euro: 200 }, mods: { sat: 2, needs: { kunst: 0.15 } }, result: 'Ein bunter Markt mit Schmuck und Bildern.' },
      { label: 'Kein Platz frei', result: 'Die Künstler ziehen weiter.' },
    ],
  },
  {
    id: 'concert', title: 'Konzertanfrage', icon: 'party', weather: 'festival', duration: 200,
    text: 'Eine bekannte Band ist auf Tour und fragt, ob sie bei dir spielen darf.',
    choices: [
      { label: 'Auftritt auf der Freilichtbühne', requires: 'stage', mods: { income: 1.25, guestRate: 1.5, sat: 4, needs: { party: 0.3, kultur: 0.3 } }, reward: { stars: 5 }, result: 'Was für ein Abend – Zugabe!' },
      { label: 'Akustik-Session am Lagerfeuer', requires: 'campfire', mods: { needs: { party: 0.2 } }, result: 'Gänsehaut am Lagerfeuer.' },
      { label: 'Lieber nicht', weather: null, result: 'Die Band spielt im Nachbarort.' },
    ],
  },
  {
    id: 'sportsday', title: 'Sportfest', icon: 'sport', duration: 180,
    text: 'Ein paar Gäste schlagen ein großes Sportfest vor. Wo soll es steigen?',
    choices: [
      { label: 'Turnier auf dem Bolzplatz', requires: 'soccer', mods: { sat: 4, needs: { sport: 0.4 } }, reward: { stars: 5 }, result: 'Spannende Spiele, lautes Anfeuern – und eine Siegerehrung.' },
      { label: 'Tischtennis-Rundlauf', requires: 'tabletennis', mods: { needs: { sport: 0.25 } }, result: 'Rundlauf mit zwanzig Leuten – herrlich chaotisch.' },
      { label: 'Wettlauf über den Platz', cost: { euro: 100 }, mods: { needs: { sport: 0.1 } }, result: 'Alle sind außer Puste, aber glücklich.' },
      { label: 'Keine Zeit', result: 'Vielleicht nächstes Mal.' },
    ],
  },
];

/* --------------------------------------------------------------------------
 * Aufträge (3 gleichzeitig aktiv, skaliert mit dem Rezeptionslevel)
 * -------------------------------------------------------------------------- */
const QUESTS = [
  { id: 'land', text: 'Kaufe {n} neue Grundstücke', one: 'Kaufe 1 neues Grundstück', stat: 'land', base: 1, perLevel: 0.2, reward: { euro: 300, stars: 2 } },
  { id: 'litter', text: 'Hebe {n}× Müll auf', stat: 'litter', base: 3, perLevel: 1, reward: { wood: 100, stars: 1 } },
  { id: 'build_pitch', text: 'Baue {n} neue Stellplätze', one: 'Baue 1 neuen Stellplatz', stat: 'builtPitch', base: 1, perLevel: 0.4, reward: { euro: 250 } },
  { id: 'collect_euro', text: 'Sammle {n} € ein', stat: 'euroCollected', base: 800, growth: 1.9, reward: { wood: 120 } },
  { id: 'collect_wood', text: 'Sammle {n} Holz ein', stat: 'woodCollected', base: 150, growth: 1.9, reward: { euro: 300 }, needs: 'lumberjack' },
  { id: 'guests', text: 'Begrüße {n} Gäste', one: 'Begrüße 1 Gast', stat: 'guests', base: 3, perLevel: 1, reward: { euro: 300, stars: 3 } },
  { id: 'wishes', text: 'Erfülle {n} Gästewünsche', one: 'Erfülle 1 Gästewunsch', stat: 'wishes', base: 2, perLevel: 0.5, reward: { euro: 350, stars: 5 } },
  { id: 'upgrades', text: 'Schließe {n} Verbesserungen ab', one: 'Schließe 1 Verbesserung ab', stat: 'upgrades', base: 2, perLevel: 0.5, reward: { wood: 150 } },
  { id: 'deco', text: 'Platziere {n} Deko-Objekte', one: 'Platziere 1 Deko-Objekt', stat: 'decoPlaced', base: 4, perLevel: 2, reward: { euro: 200 } },
  { id: 'obstacles', text: 'Räume {n} Hindernisse weg', one: 'Räume 1 Hindernis weg', stat: 'obstacles', base: 2, perLevel: 1, reward: { euro: 150, wood: 60 }, needs: 'obstacles' },
  { id: 'sat', text: 'Erreiche {n} % Zufriedenheit', state: 'sat', values: [60, 65, 70, 74, 78, 82, 85, 88, 90, 92], reward: { euro: 400, stars: 4 } },
  { id: 'need', text: 'Bringe {need} auf {n} %', state: 'need', values: [70, 72, 75, 78, 80, 83, 86, 88, 90, 92], reward: { euro: 350, stars: 3 } },
  { id: 'build_need', text: 'Baue {n} Gebäude für Bedürfnisse', one: 'Baue 1 Gebäude für ein Bedürfnis', stat: 'builtNeed', base: 1, perLevel: 0.4, reward: { wood: 200 } },
  { id: 'events', text: 'Meistere {n} Ereignisse', one: 'Meistere 1 Ereignis', stat: 'events', base: 1, perLevel: 0.3, reward: { euro: 300, wood: 100 } },
  { id: 'stars', text: 'Verdiene {n} Sterne', one: 'Verdiene 1 Stern', stat: 'starsEarned', base: 10, growth: 1.5, reward: { euro: 400 } },
];

const FIRST_QUESTS = ['build_pitch', 'build_need', 'collect_euro'];   // Einstieg für neue Spiele

/* --------------------------------------------------------------------------
 * Erfolge – die einzige Gem-Quelle neben der Tagesbelohnung
 * -------------------------------------------------------------------------- */
const ACHIEVEMENTS = [
  { id: 'builder', name: 'Bauherr', desc: 'Errichte {n} Gebäude', stat: 'built', tiers: [5, 25, 75], gems: [5, 15, 40] },
  { id: 'earner', name: 'Goldgrube', desc: 'Nimm insgesamt {n} € ein', stat: 'euroCollected', tiers: [2000, 50000, 1000000], gems: [5, 20, 50] },
  { id: 'host', name: 'Gastgeber', desc: 'Begrüße {n} Gäste', stat: 'guests', tiers: [10, 100, 500], gems: [5, 20, 50] },
  { id: 'wish', name: 'Wunscherfüller', desc: 'Erfülle {n} Gästewünsche', stat: 'wishes', tiers: [5, 30, 150], gems: [5, 20, 50] },
  { id: 'stars', name: 'Sternesammler', desc: 'Erreiche {n} Sterne', stat: 'stars', tiers: [50, 600, 4000], gems: [10, 30, 80] },
  { id: 'reception', name: 'Chef vom Platz', desc: 'Bringe die Rezeption auf Level {n}', stat: 'receptionLevel', tiers: [3, 6, 10], gems: [10, 30, 100] },
  { id: 'events', name: 'Krisenmanager', desc: 'Meistere {n} Ereignisse', stat: 'events', tiers: [3, 15, 50], gems: [5, 15, 40] },
  { id: 'deco', name: 'Gartenkünstler', desc: 'Platziere {n} Deko-Objekte', stat: 'decoPlaced', tiers: [10, 50, 150], gems: [5, 15, 30] },
  { id: 'lumber', name: 'Holzwurm', desc: 'Sammle {n} Holz', stat: 'woodCollected', tiers: [500, 10000, 150000], gems: [5, 15, 40] },
  { id: 'clean', name: 'Aufräumer', desc: 'Räume {n} Hindernisse weg', stat: 'obstacles', tiers: [5, 15, 40], gems: [5, 10, 25] },
  { id: 'happy', name: 'Glückliche Camper', desc: 'Erreiche {n} % Zufriedenheit', stat: 'maxSat', tiers: [70, 85, 95], gems: [5, 15, 30] },
  { id: 'allround', name: 'Allrounder', desc: 'Erfülle alle fünf Bedürfnisse zu {n} %', stat: 'minNeed', tiers: [50, 80, 100], gems: [10, 25, 50] },
  { id: 'explorer', name: 'Landentdecker', desc: 'Kaufe {n} Grundstücke', stat: 'land', tiers: [3, 15, 40], gems: [10, 25, 60] },
  { id: 'treasure', name: 'Schatzsucher', desc: 'Öffne {n} Schatzkisten', stat: 'chests', tiers: [2, 8, 20], gems: [5, 15, 30] },
  { id: 'tidy', name: 'Saubermann', desc: 'Hebe {n}× Müll auf', stat: 'litter', tiers: [10, 75, 300], gems: [5, 15, 30] },
  { id: 'culture', name: 'Kulturförderer', desc: 'Errichte {n} Gebäude für Kultur oder Kunst', stat: 'builtCulture', tiers: [2, 6, 12], gems: [5, 15, 30] },
];

/* Tägliche Login-Belohnung (7-Tage-Zyklus, Euro/Holz skaliert mit Rezeptionslevel) */
const DAILY = [
  { euro: 300 },
  { wood: 150 },
  { gems: 5 },
  { euro: 800 },
  { wood: 400 },
  { gems: 10 },
  { gems: 25, euro: 1500 },
];

/* Shop: Tauschgeschäfte & Boosts (Gems gibt es hier nicht zu kaufen) */
const SHOP = [
  { id: 'builder', name: 'Bauarbeiter anheuern', desc: 'Ein weiterer Bauarbeiter für parallele Bauprojekte.', kind: 'builder', icon: 'hammer' },
  { id: 'wood_euro', name: 'Holzlieferung', desc: '+250 Holz vom Sägewerk.', price: { euro: 400 }, give: { wood: 250 }, icon: 'wood' },
  { id: 'euro_wood', name: 'Brennholz verkaufen', desc: 'Verkaufe 200 Holz für 300 €.', price: { wood: 200 }, give: { euro: 300 }, icon: 'euro' },
  { id: 'euro_gems', name: 'Geldkassette', desc: '+1.000 € sofort.', price: { gems: 8 }, give: { euro: 1000 }, icon: 'euro' },
  { id: 'wood_gems', name: 'Holzstapel', desc: '+500 Holz sofort.', price: { gems: 8 }, give: { wood: 500 }, icon: 'wood' },
  { id: 'boost_income', name: 'Werbekampagne', desc: '+50 % Einnahmen für 30 Minuten.', price: { gems: 15 }, boost: { key: 'income', value: 1.5, minutes: 30 }, icon: 'megaphone' },
  { id: 'boost_guests', name: 'Online-Inserat', desc: 'Doppelt so viele Gäste für 20 Minuten.', price: { euro: 500 }, boost: { key: 'guestRate', value: 2, minutes: 20 }, icon: 'guests' },
  { id: 'boost_needs', name: 'Animationsteam', desc: 'Alle Bedürfnisse +20 Prozentpunkte für 20 Minuten.', price: { gems: 12 }, boost: { key: 'needs', value: 0.2, minutes: 20 }, icon: 'party' },
];
