# Campingplatz-Simulator

Ein Aufbauspiel im Clash-of-Clans-Stil als Progressive Web App fürs iPhone im **Querformat**:
Du baust deinen Campingplatz auf einem isometrischen Raster aus, erfüllst die Bedürfnisse
deiner Camper (Hygiene, Sport, Kultur, Kunst, Party), sammelst Bewertungen und meisterst Ereignisse.

Reines HTML, CSS und Vanilla JavaScript mit Canvas – kein Framework, keine Build-Tools,
keine externen Assets. Alle Grafiken werden per Code gezeichnet, alle Sounds per WebAudio erzeugt.

## Architektur

```
index.html      Gerüst: Canvas, HUD, Menü-Container, iOS-/PWA-Meta-Tags
style.css       Cartoon-Oberfläche, Safe Areas, Touch-Regeln, Hochformat-Hinweis
data.js         CONFIG + Inhalte: Bedürfnisse, Gebäude, Gäste, Ereignisse, Aufträge, Erfolge, Tagesbonus, Shop
game.js         Game   – Spiellogik ohne Darstellung
render.js       Render – isometrische Canvas-Grafik
art-late.js     Grafiken der späten Gebäude und der Grundstücks-Funde (meldet sich per Render.defineArt an)
ui.js           Sound + UI – Eingabe, Menüs, Dialoge, Spielschleife, Service-Worker-Start
sw.js           Service Worker (Offline-Cache)
manifest.json   Web-App-Manifest
icons/          App-Icon als SVG + daraus erzeugte PNGs
tools/          icon-generator.html: rendert icons/icon.svg per Canvas in die PNG-Größen
```

Datenfluss:

```
 Berührung ──► ui.js (Pointer Events) ──► Game.placeNew / upgrade / collect / …
                                              │
                    Game.emit('built' | 'review' | 'event' | …)
                                              ▼
            ui.js: Toasts, Dialoge, Sounds ◄──┴──► Render: Konfetti, Münzflug, Texte
 requestAnimationFrame: Game.update(dt) → Render.frame(dt, Ansicht) → HUD aktualisieren
```

- **Zustand:** `Game.S` ist der komplette Spielstand (Ressourcen, Gebäude, Aufträge, Erfolge,
  Einstellungen …) und wird als JSON in `localStorage` gespeichert – automatisch alle 10 Sekunden,
  bei `visibilitychange` und `pagehide`. `Game.G` enthält Laufzeitdaten (Gäste, Hund), die nicht
  gespeichert werden.
- **Zeit:** Bau-Timer und Ereignisse nutzen absolute Zeitstempel. Beim Öffnen rechnet
  `Game.resume()` die verpasste Zeit nach (Produktion mit Offline-Limit, fertige Bauten).
  Wird die Geräteuhr zurückgestellt, verschieben sich die Zeitstempel mit, damit Restzeiten erhalten bleiben.
- **Grafik:** Gebäude werden prozedural gezeichnet (`DRAW` in render.js) und pro Zoomstufe als Sprite
  gecacht; Animationen (`ANIM`: Feuer, Rauch, Dampf, Fahnen, Kinoleinwand …) kommen jeden Frame dazu.
  Über `Render.art` (Zeichen-Bausteine) und `Render.defineArt(typ, zeichnen, animieren)` lassen sich
  Gebäudegrafiken auch von außen ergänzen; Gebäude ohne eigene Zeichnung bekommen automatisch einen Platzhalter.
  Tiefensortierung über die Iso-Tiefe, Tag/Nacht als Multiply-Overlay mit additiven Lichtern.
- **Wegfindung:** Gäste laufen per A* über freie Felder und bevorzugen Wege.

## Spielinhalt

- **Ressourcen:** Euro, Holz, Sterne (Bewertung, mit 6 Klassifizierungsstufen und Einnahmebonus),
  Gems (nur über Erfolge und die tägliche Belohnung).
- **Bedürfnisse:** Hygiene, Sport, Kultur, Kunst und Party. Der Bedarf wächst mit jedem Gästeplatz
  und mit jedem Rezeptionslevel (anspruchsvollere Gäste); Gebäude der jeweiligen Kategorie liefern das
  Angebot. Die fünf Ringe neben der Zufriedenheit zeigen die Erfüllung, ein Tipp darauf zeigt die Details.
  Hygiene zählt doppelt – fehlt sie, gibt es zusätzlich Abzüge.
- **Gebäude (Level 1–10), nach Kategorie im Baumenü:**
  - Stellplätze: Zeltplatz, Wohnmobil-Stellplatz, Mobilheim, Glamping-Zelt
  - Hygiene: Sanitärhaus, Waschhaus, Wellness-Spa
  - Sport: Tischtennisplatte, Spielplatz, Bolzplatz, Beachvolleyballfeld, See mit Steg, Pool, Kletterturm
  - Kultur: Lesehütte, Freilichtbühne, Open-Air-Kino
  - Kunst: Malatelier, Skulpturengarten, Töpferei
  - Party: Lagerfeuerplatz, Kiosk, Grillplatz, Strandbar, Festzelt
  - Service: Rezeption, Holzfäller-Hütte – plus Deko (Weg, Baum, Blumenbeet, Zaun, Sitzbank, Laterne)
- **Rezeption** schaltet Gebäude, neue Gästetypen, Genehmigungen für Grundstücke, größere Lager und höhere
  Gebäudelevel frei. Im Baumenü sieht man nur, was als Nächstes kommt – alles Spätere bleibt „Geheim“.
- **Grundstücke:** Die Karte ist in Parzellen geteilt. Schilder am Rand zeigen, welche man kaufen kann; der
  Platz wächst dort, wo man es möchte, ohne dass man umbauen muss. Auf jedem neuen Grundstück wartet etwas:
  eine Schatzkiste, ein kleiner Wald (viel Holz), eine alte Mühlenruine (Sterne), ein Teich oder eine Blumenwiese.
- **Spät im Spiel:** Baumhaus-Lodge und Sternwarte (Rezeption 7), Riesenrad (8), Wasserrutsche (9) sowie neue
  Gäste: Schulklassen (ab 4), Influencerinnen (ab 6, Bewertung zählt dreifach) und VIPs (ab 8).
- **Zum Antippen:** Gäste lassen Müll liegen (senkt die Zufriedenheit) oder Trinkgeld – beides antippen.
- **Bauarbeiter:** 2 zu Beginn, bis zu 5 gegen Gems. Bauten lassen sich mit Gems beschleunigen.
- **Zufriedenheit:** Freizeitangebote im Verhältnis zur Gästezahl, genug Sanitärkapazität, Deko,
  Ereignisse. Sie beeinflusst Einnahmen und die Sterne, die abreisende Gäste vergeben.
- **Gäste:** Familien (Hygiene, Sport), Camper (Sport, Party), Rentnerpaare (Kultur, Kunst, Hygiene)
  und Backpacker (Party, Kunst) haben eigene Vorlieben. Ihre Stimmung mischt die Gesamtzufriedenheit mit
  ihren Lieblingsbedürfnissen und bestimmt die Bewertung beim Abreisen. Wünsche (Sprechblasen) zielen auf
  bestimmte Gebäude oder Bedürfnisse; erfüllte Wünsche bringen Bonus-Sterne und Trinkgeld. Gäste besuchen
  bevorzugt Gebäude, die zu ihren Vorlieben passen.
- **Ereignisse mit Entscheidungen:** Regenschauer, Festival-Wochenende, Mückenplage, Hitzewelle,
  Besuch vom Campingverband, Reisebus, entlaufener Hund, Gewitter, Kontrolle vom Gesundheitsamt,
  Kunstmarkt, Konzertanfrage, Sportfest. Viele wirken zeitweise auf einzelne Bedürfnisse (Regen: Sport ↓),
  und passende Gebäude schalten bessere Antworten frei (z. B. Konzert auf der Freilichtbühne).
- **Aufträge, Erfolge, 7-Tage-Login-Belohnung, Offline-Einnahmen (max. 8 Std.).**

## Steuerung

| Geste | Wirkung |
|---|---|
| Ein Finger ziehen | Karte verschieben (mit Schwung) |
| Zwei Finger | Zoomen |
| Antippen | Gebäude auswählen, Münzen einsammeln, Gäste ansehen |
| Gedrückt halten | Gebäude anheben und verschieben (am Bildschirmrand scrollt die Karte mit) |
| Ringe neben der Zufriedenheit | Details zu den fünf Bedürfnissen |
| Ausgewähltes Gebäude ziehen | direkt verschieben |

## Balancing anpassen

Alle Zahlen stehen in `data.js`:

- `CONFIG` – Startwerte, Lagergrößen je Rezeptionslevel, Offline-Limit, Zufriedenheitsformel
  (inkl. `demandGrowth`: wie viel anspruchsvoller Gäste je Rezeptionslevel werden), Sterne-Klassen,
  Gem-Preise fürs Beschleunigen, Länge des Spieltags, Ereignis-Abstände.
- `NEEDS` – je Bedürfnis: Bedarf pro Gästeplatz (`perGuest`), Gewicht in der Zufriedenheit (`weight`),
  Zusatzabzug bei Mangel (`penalty`, nur Hygiene), Farbe.
- `CONFIG.land` – Parzellengrenzen, Genehmigungen je Rezeptionslevel, Grundstückspreise, Fund-Wahrscheinlichkeiten.
- `CONFIG.pickups` – Müll und Trinkgeld.
- `BUILDINGS` – je Gebäude: Kategorie (`cat`), Kosten/Bauzeit für Level 1 und Wachstumsfaktoren
  (`costGrowth`, `timeGrowth`), Produktion pro Stunde (`rate`, `rateGrowth`), Bedürfnispunkte
  (`needs`, `needGrowth`), Freischalt-Level (`unlock`), Maximalanzahl je Rezeptionslevel (`max`)
  und Lichter für die Nacht (`lights`).
  Die Rezeption hat eine explizite Tabelle (`levels`).
- `GUESTS`, `EVENTS`, `QUESTS`, `ACHIEVEMENTS`, `DAILY`, `SHOP` – Inhalte und Belohnungen.

Faustregel: Jede Kostenstufe muss ins Lager des Rezeptionslevels passen, ab dem sie baubar ist.

## Lokal testen

Der Service Worker braucht `https://` oder `localhost`, deshalb einen kleinen Webserver starten:

```bash
cd campingplatz
python3 -m http.server 8000
# dann im Browser: http://localhost:8000
```

Im Desktop-Browser die Geräte-Emulation (z. B. Chrome DevTools → iPhone) einschalten, damit
Touch-Gesten simuliert werden. Mausrad zoomt, Ziehen mit der Maus verschiebt.

Auf dem iPhone im selben WLAN funktioniert `http://<IP-deines-Rechners>:8000` zum Ausprobieren –
offline und als App klappt es aber erst über HTTPS (siehe unten).

## Auf dem iPhone installieren

1. Den Ordner `campingplatz/` per HTTPS veröffentlichen, z. B.:
   - **GitHub Pages:** Im Repository unter *Settings → Pages* als Quelle den Branch wählen
     (Ordner `/root`). Das Spiel liegt dann unter
     `https://<benutzer>.github.io/<repository>/campingplatz/`.
     Für private Repositories setzt GitHub Pages ein kostenpflichtiges Konto voraus.
   - **Netlify Drop:** <https://app.netlify.com/drop> öffnen und den Ordner `campingplatz`
     ins Browserfenster ziehen – nach wenigen Sekunden gibt es eine HTTPS-Adresse.
2. Die Adresse auf dem iPhone in **Safari** öffnen.
3. Auf **Teilen** tippen → **Zum Home-Bildschirm** → **Hinzufügen**.
4. Den Campingplatz über das neue Icon starten: Vollbild, im Querformat, offline spielbar.
   (Hält man das iPhone hochkant, erscheint ein Hinweis zum Drehen.)

Hinweise:
- Die Home-Bildschirm-App hat einen eigenen Speicher, getrennt von Safari. Unter
  *Optionen → Spielstand sichern/laden* lässt sich ein Spielstand per Code übertragen.
- Vibration unterstützt Safari auf dem iPhone nicht; der Schalter ist dann ausgegraut.
- Töne starten erst nach der ersten Berührung und sind bei aktiviertem Stummschalter still.
- Nach Änderungen an den Dateien in `sw.js` die `VERSION` erhöhen, damit installierte Apps
  die neue Version laden (sie wird beim übernächsten Start aktiv).

## App-Icon neu erzeugen

`icons/icon.svg` bearbeiten, `tools/icon-generator.html` über den lokalen Server öffnen
(`http://localhost:8000/tools/icon-generator.html`) und die vier PNGs herunterladen nach `icons/`.
