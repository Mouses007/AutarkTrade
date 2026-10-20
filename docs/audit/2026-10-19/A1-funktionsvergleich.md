# Audit A1 – Funktionsvergleich alt ↔ V2 (19.10.2026)

Nur geprüft und berichtet, kein Produktcode geändert. **Alt** = Crypto Trading Journal
(`/home/maro/Schreibtisch/Trading/Journal`, `master` = `f910385`, nur gelesen, Stand per `git archive master`).
**Neu** = AutarkTrade V2 (`master` = `429c77f`). V2 ist von Journal `7fb0326` abgezweigt
(`6ab0e6d „Ausgangsstand aus Crypto Trading Journal (master 7fb0326)"`).

## Zusammenfassung

| Schwere | Anzahl |
|---|---|
| kritisch | 0 |
| hoch | 4 |
| mittel | 6 |
| niedrig | 5 |

**Ursache Nr. 1:** Die S11-Umbenennung (`256fd44`, „107 Bezeichner umbenannt") hat in **11 Vue-Vorlagen**
die alten Namen stehen lassen, während Import/Store schon umbenannt waren. Vue wertet einen nicht gebundenen
Vorlagen-Namen still als `undefined` – kein Build-Fehler, kein Selbsttest schlägt an (die Selbsttests decken
das Gerendert-Werden nicht ab). Maschinell belegt mit dem Vue-Compiler: alt 1 harmloser Treffer (`navigator`),
neu 11 Dateien (`A1-vorlagen-bindungen.txt`). A3-15 hat davon die Lade-Anzeige gesehen; das Ausmass ist grösser.

**Die wichtigsten 10:**
1. **A1-01 (hoch)** Dashboard › Übersicht zeigt die Karten Kontostand, Kennzahlen und Gebühren **nie** (`dashboardIdMounted`).
2. **A1-02 (hoch)** Filter **Brutto/Netto** wirkungslos: Auswahl leer, „Netto" + „Anwenden" ändert nichts.
3. **A1-03 (hoch)** Filter **Tags** (Häkchen) und **P&L/Zufriedenheit** an nicht vorhandene Variablen gebunden.
4. **A1-04 (hoch)** **Screenshot-Vollbild leer** – Dialog öffnet ohne Bild.
5. **A1-10 (mittel)** Journal `f910385` fehlt: Bot-Positionen (Pionex-Grid) werden im Chart als Trade gezeichnet.
6. **A1-11 (mittel)** Journal `3212a6f` fehlt: gemerkter Zeichenstil und KI-Volumenprofile je Abschnitt.
7. **A1-12 (mittel)** Long/Short-Kachel: OI-Ausfall wird still 5 min als „kein OI" gecacht (alt: Fehler → letzter guter Stand).
8. **A1-07 (mittel)** KI-Coach: Monatsauswahl wirkungslos (Bericht immer für den laufenden Monat).
9. **A1-06 (mittel)** Tagesansicht/Trade-Bewertung: Ladeanzeige fehlt, Speichern/Blättern während des Ladens nicht gesperrt.
10. **A1-05 (mittel)** Lade-Anzeigen (Seiten-Overlay, Import, Exkursionen, Nachladen, Vollbild-Weiter) erscheinen nie.

**Was gleich ist (belegt):** Golden Master in V2 grün (142/142 Selbsttests, 5917 Prüfungen); gegenüber dem alten
Golden Master **nur die drei gewollten Änderungen** (S11 Schlüsselnamen, S7 Tag-Gruppen-Rücksetzung, S7/v28
sec/taf/nscc/nasdaq). Mit derselben Datenbank (alt befüllt, für V2 kopiert – der echte Umstiegsweg) liefern
`/api/db/*` für trades, tags, notes, satisfactions, excursions, diaries, screenshots, incoming_positions,
live_sessions, share_card_templates, quiz_karten **identische Inhalte**; Tagesansicht März 2026 (14 Tage) und
die Setups-Tabelle zeigen **dieselben Zahlen**. 71 GET-Endpunkte antworten bytegleich, 10 strukturgleich.
Kacheln (49), KI-Werkzeuge (19), Menüeinträge (83), DB-Tabellen (70) deckungsgleich.

## Befunde

| ID | Schwere | Bereich | Befund | Beleg | alt | neu | Vorschlag |
|---|---|---|---|---|---|---|---|
| A1-01 | hoch | Journal › Dashboard | Die obere Reihe von „Übersicht" (Kontostand, Kennzahlen, Gebühren) wird nie gerendert. Vorlage fragt `dashboardIdMounted`, importiert ist seit S11 `dashboardBereit`. | `src/views/Dashboard.vue:195` (`<template v-if="dashboardIdMounted">`) gegen `:13` (Import `dashboardBereit`); eingeführt in `256fd44`. Seitentext alt (8095, „Dieses Jahr · Brutto"): „Kumulierter PnL $-158 · APPT $-3.23 · Trades 49 · Gesamte Gebühren $ 120.26 · Netto PnL $-277.09"; neu (8096, gleicher Filter, 1440×900): nur „KUMULIERTER PNL / APPT / WIN RATE" (Diagramme), keine Karte. | Karten sichtbar | Karten fehlen | Vorlage auf `dashboardBereit` stellen. |
| A1-02 | hoch | Journal › Filterleiste | Brutto/Netto-Auswahl ist an `selectedGrossNet` gebunden, das es im Script nicht gibt (`gewaehltBruttoNetto`). Anzeige leer, Wechsel wirkt nicht. | `src/components/journal/FilterLeiste.vue:211`. Browser 8096: `select.selectedIndex = -1`, Wert `""`; nach Wahl „Netto" + „Anwenden": Titel bleibt „Dieses Jahr · Brutto", `localStorage.selectedGrossNet = "gross"`. | wirkt | wirkt nicht | Bindung auf `gewaehltBruttoNetto`. |
| A1-03 | hoch | Journal › Filterleiste | Tag-Häkchen binden `v-model="selectedTags"` (4×), die P&L/Zufriedenheit-Auswahl `:value="selectedPlSatisfaction"` – beide nicht im Script (`tagAuswahl`, `gewaehltPlOderZufriedenheit`). Gleicher Mechanismus wie A1-02. | `FilterLeiste.vue:255`, `:279`, `:285`; Compiler-Prüfung `A1-vorlagen-bindungen.txt`. Häkchen selbst im Browser **nicht** geklickt (Mechanismus an A1-02 belegt). | wirkt | Bindung ins Leere | Bindungen auf die Store-Namen. |
| A1-04 | hoch | Journal › Screenshots | Vollbild zeigt kein Bild: `:screenshot-data="selectedScreenshot"`, im Script heisst es `gewaehltesBild`. | `src/components/rahmen/ScreenshotVollbild.vue:61`. Browser: Dialog alt enthält 2 `<img>` (`screenshotImg`, `overlayImg`), neu 0 – nur der Titel „Tue 03 March 2026". | Bild im Vollbild | leerer Dialog | Bindung auf `gewaehltesBild`. |
| A1-05 | mittel | Lade-Anzeigen | Lade-Anzeigen erscheinen nie: `spinnerLoadingPage` (→ `seiteLaedt`), `spinnerLoadMore` (→ `ladeMehr`), `getMore` (→ `holtWeitere`). | `src/components/SeiteLaedt.vue:6`, `src/views/AddTrades.vue:435`, `src/views/AddExcursions.vue:243`, `src/views/Daily.vue:1012`, `src/views/Screenshots.vue:119`, `ScreenshotVollbild.vue:70,72`. Siehe auch A3-15. | sichtbar | nie sichtbar | Namen nachziehen. |
| A1-06 | mittel | Journal › Tagesansicht | Trade-Bewertung: `spinnerSetups` (→ `setupsLaden`) fehlt. Eingaben stehen während des Ladens offen; „Zurück/Speichern/Weiter" sind nie gesperrt. | `src/views/Daily.vue:1245`, `:1280`, `:1283`, `:1291`; Script setzt `setupsLaden` (`:376`, `:544`). Doppelklick-Folgen **nicht** im Browser geprüft. | gesperrt beim Laden | nie gesperrt | Bindung auf `setupsLaden`. |
| A1-07 | mittel | KI-Coach | Zeitraum „Monat": `<input type="month" v-model="selectedMonth">`, das Script rechnet mit `gewaehlterMonat` (Vorgabe aktueller Monat). Ein anderer Monat ist nicht wählbar. | `src/views/KiAgent.vue:752` gegen `:35`, `:253`. KI nicht ausgelöst (kostet). | wählbar | wirkungslos | Bindung auf `gewaehlterMonat`. |
| A1-08 | niedrig | Rahmen | „Nach oben"-Knopf ruft `returnToTop` auf, das nicht existiert (`scrolleNachOben` ist importiert). | `src/components/NachObenKnopf.vue:12`. Browser `/settings/ki`: `scrollY` 585 vor und nach Klick. | scrollt | ohne Wirkung | auf `scrolleNachOben`. |
| A1-09 | niedrig | Dashboard-Diagramme | `:key="renderData"` zeigt ins Leere (heute `zeichenZaehler`). Keine sichtbare Folge: nach Filterwechsel „Gesamt" neue ECharts-Instanzen (`ec_…526-528` → `ec_…529-531`), Achse ab 20.10.2025. | `src/components/dashboard/DiagrammKarte.vue:22` | – | toter Rest | aufräumen. |
| A1-10 | mittel | Chart (Fork-Nachzug) | Journal-Commit `f910385` (19.10. 13:20, nach dem Abzweig) fehlt: Bot-Positionen werden nicht herausgefiltert, ein Pionex-Grid erscheint im Chart/„Offene Trades" als Trade mit Durchschnittseinstieg. | `diff alt/src/utils/chart/overlays/positionen.js neu/…`: alt `:45-55` (`istBot`, Filter), neu `:50` ohne Filter. | gefiltert | ungefiltert | Verhalten nach Spec neu umsetzen (Clean-Room-Regel: nicht kopieren). |
| A1-11 | mittel | Chart (Fork-Nachzug) | Journal-Commit `3212a6f` (19.10. 12:00) fehlt: Zeichenwerkzeuge merken ihren Stil nicht (`src/stores/zeichenStil.js` gibt es nicht), KI-Analyse kennt nur EIN Volumenprofil statt je Abschnitt (`profilAbschnitte`). | `ls src/stores/zeichenStil.js` → fehlt; `grep -r profilAbschnitte server src` → 0 Treffer; alt `server/chart-kandidaten.js:46-79`. Der dritte Nach-Abzweig-Commit `eb85d9b` ist als `4a0bb86` nachgezogen (Funktion `uebernehmeLageberichtMail` identisch). | vorhanden | fehlt | nach Spec neu umsetzen. |
| A1-12 | mittel | Marktradar › Long/Short + OI | V2 fängt den OI-Abruf mit `.catch(() => [])`; ein Aussetzer wird für 5 min als Kachel ohne OI gecacht (`oi: null`, `oiDelta24hPct: null`, kein `veraltet`). Alt liess den Abruf scheitern → letzter guter Stand. | neu `server/marktradar-api.js:1055-1056`, alt `:861`. Gemessen: `/api/marktradar/ls-oi` BTCUSDT 48 Punkte, mit OI alt 48 / neu 0; ETHUSDT beide 48. Direkter Aufruf `binanceHole('oiHistorie', …)` im V2-Container lieferte Daten (Aussetzer, nicht dauerhaft). | Stale-Fallback | still leer | Fehler durchreichen oder `veraltet`/Hinweis setzen. |
| A1-13 | niedrig | Marktradar › Makro (alt **und** neu) | Fällt eine der zwei CoinGecko-Stablecoin-Reihen aus, rechnet die Kachel mit der anderen weiter (`filter(Boolean)`): Menge und Dominanz springen ohne Hinweis. Kein Unterschied alt↔neu, Altfehler. | neu `server/marktradar-api.js:1747`, alt `:1511`. Zwei Abrufe kurz nacheinander: `jetztUsd` 255,67 Mrd / Dominanz 9,49 % gegen 183,52 Mrd / 6,80 %. | gleich | gleich | Teilausfall als unvollständig behandeln. |
| A1-14 | niedrig | Texte nach S13 | Zwei Texte sprechen noch von Orders, obwohl V2 keine sendet: Beta-Hinweis im Zustimmungsdialog („Orders über deine Börsen-Schlüssel führst du auf eigenes Risiko aus") und „Marktdaten aus" („… und Orders über deine eigenen API-Schlüssel laufen weiter"). | `src/i18n/locales/de.json:6018`, `:6112`; Dialog im Browser 8096 gesehen. | – | widersprüchlich | Text anpassen. |
| A1-15 | niedrig | Dashboard › Setups | Titel „Trade-Typ Rentabilität" trägt alt „(Brutto)", neu „(Netto)"; Zahlen identisch (Scalptrade 3 · 67 % · $-7.40 · $-22.21 · 0.52 …), die Tabelle zeigt Netto-P&L. Neu ist korrekt – nur als Unterschied vermerkt. | `src/views/Dashboard.vue:255` (`nettoKennzeichen`); Seitentext beider Container. | „(Brutto)" | „(Netto)" | keiner (gewollt prüfen). |

## 1. Inventar (maschinell, `A1-inventar.mjs` → `A1-inventar.txt`)

| Bereich | alt | neu | in beiden | nur alt | nur neu | „nur alt" geklärt |
|---|---|---|---|---|---|---|
| API-Endpunkte (`app.get/post/put/delete/patch` in `index.mjs`, `server/**`) | 329 | 339 | 325 | 4 | 14 | alle 4 = S13: `GET /api/strategies/instances/:id/readiness`, `GET /api/strategies/waechter`, `POST /api/strategies/probeorder`, `POST /api/strategies/instances/:id/approve-live` → Branch `spaeter/scharfer-handel` (dort `server/live-gates.js`, `server/execution/stop-waechter.js` u. a. vorhanden). Neu: Lizenz, Rechtliches, Quellen/Freigabe, Marktdatenquelle, `/api/system/modus`. |
| Routen (Router) | 40 | 43 | 39 | 1 | 4 | `/settings` → `/settings/:bereich?` (S9). Neu `/start`, Catch-all. |
| Menü (`menu.js`, to/path/id/key) | 83 | 83 | 83 | 0 | 0 | – |
| Hintergrund-Takte | 13 Starts in `index.mjs` | 12 über `starteTakte` | 12 | Stop-Wächter | – | S13. `setInterval`-Stellen in `server/`: einzig `execution/stop-waechter.js` fehlt. |
| Kacheln (`marktradar.js`, `livetrading.js`, `pult.js`, `marktradar-pult.js`) | 49 | 49 | 49 | 0 | 0 | – |
| KI-Werkzeuge (`ai-agent-tools.js`) | 19 | 19 | 19 | 0 | 0 | – |
| DB-Spalten (`database.js`, statisch) | 1314 | 1318 | 1314 | 0 | 4 | – ; lebend (beide SQLite nach Start): 70 = 70 Tabellen, neu nur `settings.{lizenzSchluessel, rechtlichesZustimmung, marktdatenQuelle, coingeckoTarif, aiDeepseekUrl, quellenOhneFreigabe, s15Migriert}`, `strategy_positions.ausgelagert`. |
| Einstellungsfelder mit UI (settings-Spalte in `src/` erwähnt) | – | – | – | 3 | – | `strategyLiveEnabled`, `strategyMinPaperTrades` (S13), `kiEmpfehlungenAn` (S12, Auftragsstand Z. 254/272). |
| i18n-Schlüssel im Code benutzt (`t('a.b')` statisch) | 3012 | 3324 | 2877 | 135 | 447 | siehe unten |
| Vue-Dateien (views/components) | 130 | 207 | 124 | 6 | 83 | `Nav`, `SideMenu`, `SidebarFilters`, `ModeSwitcher`, `ReturnToTopButton`, `SpinnerLoadingPage` → S9-Rahmen (`rahmen/*`, `NachObenKnopf`, `SeiteLaedt`). |

**135 nur alt benutzte i18n-Schlüssel, einzeln zugeordnet:** 25 `strategies.*` Live/Wächter/Freigabe (S13);
9 `settings.ki.empfehlungen*`/`ki.strat.liveOn|allowLive*|minPaper*` (S12/S13); `nav.donate` (Spendenlinks,
Auftragsstand Z. 610/737); `addTrades.noCsvData`/`noValidBitgetTrades` (CSV, S3); `dashboard.regulatoryFees`
(S7/v28); `hype.keyOptional/keyNoetig/keyPlatzhalter/keyHolen` (CoinGecko-Schlüssel nach Einstellungen ›
Datenquellen, S12); `hype.alarmeMehr`/`unterSchwelleN` (S14); `strategies.betaDismiss` (Hinweis schliesst über
`Hinweis schliessbar`). Die übrigen (die `dashboard.*`-Tooltips und -Gruppentitel, 9 `auswertung.tooltip*`, 4 `daily.*`,
`addTrades.manualFieldFee`, 8 `filters.*`, 12 `nav.*`, 7 `calendar.*`, 19 `timeframes.*`, `chart.quelle.*`,
`chart.schliessen`, `messages.confirmDelete`, `modes.comingSoon`) stehen in V2 weiter im Code, nur nicht als
statisches `t('…')` (Attribut `info="…"`, `t('chart.quelle.' + b)`, Tabellen) – per `grep` geprüft, **nichts verloren**.

**Dateien nur alt** (Dateiliste beider Bäume): `server/execution/{abgleich,bitunix,margen-netz,pionex,stop-regeln,stop-waechter}.js`,
`server/live-gates.js` (S13, auf `spaeter/scharfer-handel`); `src/utils/{brokers,brokers-kern,addTrades}.js` (S3);
`src/utils/{trades,daily,calendar,charts,formatters,dayjs-setup,mountOrchestration,utils}.js`, `src/stores/globals.js`
(S7/S9/S11 ersetzt); `LIZENZ-PLAN.md` (→ `HERKUNFT.md`); Desklet/Android-Widget/`.desktop` umbenannt (S11);
**`src/stores/zeichenStil.js` – verloren (A1-11)**.

**Absichtlich anders, kein Befund:** MiniMax nicht mehr wählbar (`/api/ai/models` → `ausgeblendet`, S12);
Playbook-Link unter Screenshots nur bei erkennbarer Trade-ID (Spec A-S7, `src/views/Screenshots.vue:63-73`);
`/api/chart/tiefe` liefert Zahlen statt Binance-Zeichenketten und ohne `E` (einziger Verbraucher
`ChartPanel.vue:354` liest kein `E`); Börsenwacht/Hype-Einstellungen mit Freigabe-Feldern (S15).

## 2. Verhaltensvergleich mit identischen Daten

**Aufbau.** Images aus `git archive` beider `master` gebaut (`ctj:a1-alt`, `autarktrade:a1-pruef`), Container
`a1-alt` auf `127.0.0.1:8095` (`CTJ_ALLOW_INSECURE=1 CTJ_NO_ENGINE=1 CTJ_NO_RECORDER=1 CTJ_NO_GUARD=1`) und
`a1-neu` auf `127.0.0.1:8096` (`AT_ALLOW_INSECURE=1 AT_TESTBETRIEB=1 AT_NO_ENGINE=1 AT_NO_RECORDER=1`), gleicher
Secret, je Wegwerf-SQLite im Scratch-Verzeichnis. Testdaten = Datensatz des **alten** Golden Master (Abschnitte 1–2
von `src/utils/__selftest-journal.mjs`: 101 Tageszeilen/122 Trades Bitunix/Bitget/Pionex inkl. Agent-Tag,
62 Tags, 18 Notizen, 64 Zufriedenheiten, 24 Exkursionen, Tag-Gruppen in `settings`) per REST in alt eingespielt,
dazu 1 Tagebuch, 1 Screenshot (markerjs2-`maState`), 1 offene Position. Danach alt gestoppt, **die alte DB-Datei
für V2 kopiert** (= Umstieg auf die Live-DB): V2-Log „v28: Aktienbörsen-Gebühren aus 101 Tageszeilen entfernt",
„S15: Quellen ohne Verkaufsfreigabe an", Datei `tradenote.db` als Altbestand erkannt. Container am Ende gestoppt,
entfernt, Images gelöscht. Live-DB, NAS und `crypto-trading-journal` (8080) nicht berührt.

**Golden Master.** `npm run test:self` in V2: 142/142 Dateien, 5917/5917 Prüfungen, `__selftest-journal.mjs` 22,
`__selftest-mfe-pfade.mjs` 20 grün. Eingefrorener Stand alt ↔ neu Feld für Feld (`A1-golden-master-diff.txt`):
roh 155 Pfade nur alt / 43 nur neu / 0 Wertabweichungen; nach Rückbenennung der S11-Schlüssel
(`hasData→journalHatDaten`, `filteredTrades→journalTage`, `totalsByDate→summenJeTag`, `profitAnalysis→gewinnAnalyse`,
`calendarData→kalenderDaten`, `miniCalendarsData→miniKalenderDaten`) und ohne `sec/taf/nscc/nasdaq/otherCommission`
bleiben **4 Abweichungen, alle gewollt (S7 `8865a21`)**: `groups.group_1/group_2` in den Szenarien `nurAgent` und
`ohneTagsNurUngetaggt` (Tag-Gruppen des Vorlaufs werden nicht mehr mitgeschleppt).

**REST-Lesepfade** (`A1-endpunkte-vergleich.txt`): `/api/db/<tabelle>?limit=100000` für 11 Tabellen inhaltsgleich
(ohne `createdAt/updatedAt` und die v28-Felder). 143 parameterlose GET-Endpunkte: 71 bytegleich, 40 beide 400
(fehlende Parameter/Schlüssel), 10 strukturgleich, 15 strukturverschieden – alle erklärt: neue Felder (Freigabe,
Quelle, Lizenz, `regel`, `basis`), MiniMax, S13-Felder (`liveEnabled`, `minPaperTrades`, Broker-Fähigkeiten,
`netzModus`), Ratelimit-Aussetzer beim parallelen Abruf (`makro`, `funding`, `rsi`, `ls-oi` – seriell wiederholt
beide 200), dazu **A1-12**.

**Oberfläche** (eingebauter Browser, beide 1440×900, gleiche Filter „Dieses Jahr · Bitunix · Brutto"):
Tagesansicht März 2026 – 14 Tage, je Trades/Gewinne/Verluste/Gebühren/PnL identisch (z. B. 31.3. 1 · 0 · 1 ·
$0.76 · $-8.96; 25.3. $52.48; 11.3. 2 Trades $-48.65). Dashboard › Setups – Trade-Typ-Tabelle identisch (A1-15
nur Titel). Dashboard › Übersicht – A1-01. Filter – A1-02. Screenshots – A1-04. Nach oben – A1-08.

## 3. Netzfunktionen

Auf beiden Containern von Hand (Liste und Ergebnisse in `A1-endpunkte-vergleich.txt`, Abschnitt „Mit Parametern"):
Chart-Kerzen Binance/Bitunix/Bitget, Funding, Tiefe, Hebelzonen, Journal, Handelbar; Coin-Radar Einzel/Coin-Info/
Rangliste/Verlauf; Live-Trading Indizes/Countdown/Momentum/Liq-Ticker; Marktradar News/Lagebericht/Lage/
Handelslage/Wal; Hype-Radar Frühphase/Funde/Alarme/Börsen; Strategie-Instanzen; KI-Modelle/-Werkzeuge/-Einstellungen.
Alle 200 auf beiden mit gleicher Struktur, Unterschiede nur die oben erklärten Zusatzfelder. Wal-Kachel, Yahoo
(Makro, Indizes), ForexFactory im Kalender, CMC-Dominanz in V2 vorhanden (S15-Schalter an). KI-Aufrufe **nicht**
ausgelöst; Routen und Einstellungen (`/api/ai/settings`, `/api/ai/models`, `/api/ai/agent/tools`) auf beiden vorhanden,
neu nur `aiDeepseekUrl`.

## Nicht geprüft

- **Kennzahlen-Karten-Zahlen in V2** – wegen A1-01 nicht sichtbar; die Summen dahinter deckt der Golden Master.
- **Kalender-Seite für März 2026** im Browser (der Monat wird beim Aufruf auf den laufenden zurückgesetzt, beide
  zeigen Oktober 2026 leer); Kalenderrechnung über Golden Master identisch.
- **Tag-Häkchen, P&L/Zufriedenheit-Auswahl, Trade-Bewertung, KI-Coach-Monat** nicht im Browser bedient (A1-03, -06, -07):
  Wirkung aus Compiler-Bindung + gleichem Mechanismus wie A1-02 abgeleitet.
- **Takte im Betrieb**: V2 lief im Testbetrieb (keine Takte); verglichen ist nur das Inventar.
- **Börsen-Routen mit echten Schlüsseln** (beide 400 ohne Schlüssel), Hype-/Coin-Radar-Läufe (POST), Lagebericht-Erzeugung, KI.
- **Freie Variablen im JS ausserhalb von Vorlagen** – kein Linter im Projekt; nur Vorlagen maschinell geprüft, Build fehlerfrei.
- PostgreSQL-Pfad, Android-Widget, Desklet, ESP32-Firmware (nur Dateiliste).

## Werkzeuge in diesem Ordner

`A1-inventar.mjs <alt> <neu> <aus.json>` (Inventar), `A1-vorlagen-bindungen.mjs <wurzel>` (Vue-Compiler, `_ctx.X`
ohne Bindung – nach einer Umbenennung lohnt es sich, das vor dem Merge laufen zu lassen),
`A1-golden-master-diff.mjs <alt.json> <neu.json>`.

## Stand nach F1 (20.10.2026)

Korrektur F1 „Funktion & Oberfläche“, Branch `claude/f1-funktion-e8fce2`. Neu als Selbsttest:
`src/utils/__selftest-vorlagen-bindungen.mjs` (Vue-Compiler, jeder ungebundene Vorlagen-Bezeichner; Gegenprobe vor
dem Fix: genau die 11 Dateien aus `A1-vorlagen-bindungen.txt`). Geprüft im Prüf-Container (Port 8099, Wegwerf-SQLite mit
den Journal-Tabellen der DB-Kopie `autarktrade`, nur lesend kopiert; das Passwort-Gate der Kopie blieb trotz
`AT_ALLOW_INSECURE=1` aktiv) im eingebauten Browser bei 1500 und 375 px.

| ID | Stand nach F1 |
|---|---|
| A1-01 | **behoben** (`d3f50ac`) – Vorlage auf `dashboardBereit`. Browser 1500/375: Kontostand, Kennzahlen, Gebühren sichtbar. |
| A1-02 | **behoben** (`d3f50ac`) – `v-model="gewaehltBruttoNetto"`. Browser: Auswahl zeigt „Brutto“, Netto + Anwenden → „Dieses Jahr · Netto“, „KENNZAHLEN (NETTO)“, `localStorage.selectedGrossNet = net`. |
| A1-03 | **behoben** (`d3f50ac`) – `tagAuswahl`, `gewaehltPlOderZufriedenheit`. Browser (Tagesansicht): Häkchen spiegeln die Auswahl (24/24), ein Klick ändert „Tags (22)“ → „(21)“. P&L/Zufriedenheit nur per Compiler-Selbsttest belegt. |
| A1-04 | **behoben** (`d3f50ac`) – `:screenshot-data="gewaehltesBild"`. Browser: Vollbild enthält das Bild. |
| A1-05 | **behoben** (`d3f50ac`) – `seiteLaedt`, `ladeMehr`, `holtWeitere`. Browser (Screenshots): Nachlade-Anzeige erscheint beim Scrollen, 4 Bilder nachgeladen. |
| A1-06 | **behoben** (`d3f50ac`) – `setupsLaden`. Browser: beim Öffnen der Trade-Bewertung Ladeanzeige und ein gesperrter Knopf mehr, danach frei. |
| A1-07 | **behoben** (`d3f50ac`) – `v-model="gewaehlterMonat"`. Im Browser nicht bedienbar (Formular erscheint nur mit erreichbarem KI-Anbieter); per Compiler-Selbsttest belegt. Monatsname jetzt in der Oberflächensprache (A4-13). |
| A1-08 | **behoben** (`d3f50ac`) – `scrolleNachOben`. Browser `/settings/ki`: `scrollY` 585 → 0. |
| A1-09 | **behoben** (`d3f50ac`) – `:key="zeichenZaehler"`. |
| A1-10 | **behoben** (`1261935`) – Journal `f910385` nachgezogen; die Bot-Erkennung liegt jetzt einmal in `src/utils/positionTpsl.js` (`istBotPosition`) für Pendente Trades und Chart. Browser: das offene Pionex-Grid (SOLUSDT) der Kopie erscheint nicht unter „Offene Trades“. |
| A1-11 | **behoben** (`1261935`) – Journal `3212a6f` nachgezogen (`src/stores/zeichenStil.js`, localStorage `at.chart.zeichenStil`; `profilAbschnitte` in `server/chart-kandidaten.js`; Selbsttests chart-kandidaten/chart-ki/ki-zeichnungen, app-hilfe, CLAUDE.md). KI-Analyse nicht ausgelöst (kostet). |
| A1-12 | **behoben** (`ec3a3ec`) – OI-Fehler wirft (400 = kein Perp bleibt leer), `ausCache` liefert den letzten guten Stand mit `veraltet`. |
| A1-13 | **behoben** (`ec3a3ec`) – Stablecoin-Menge/-Dominanz nur aus allen Reihen; Teilausfall ohne Yahoo → letzter guter Stand, mit Yahoo „—“ mit Erklärung (`unvollstaendig`). |
| A1-14 | **behoben** (`af74053`) – Beta-Hinweis, Zustimmungsformel und Datenquellen-Sätze nach S13 (siehe A4-07). |
| A1-15 | **kein Handlungsbedarf** – „(Netto)“ ist korrekt (die Tabelle zeigt Netto-P&L). |
