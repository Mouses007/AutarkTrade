# Auftragsstand AutarkTrade (V2)

Umbau des Crypto Trading Journal zum Produkt **AutarkTrade**. Der vollständige Plan liegt
beim Leitstand (`~/.claude/plans/ok-plane-alles-erstelle-swirling-sparkle.md`); hier steht,
was davon wo erledigt ist. Jede Sitzung trägt ihren Stand selbst nach.

**Regeln für alle Sitzungen** (Kurzfassung, verbindlich ist der Plan):
- Arbeitsort `Trading/V2`, jede schreibende Sitzung in ihrem eigenen Worktree. Am Ende
  `npm run test:self` und Golden Master grün, Rebase auf master, `git merge --ff-only`.
- TradeNote-Dateien (`LIZENZ-PLAN.md`, Abschnitt 1) nach der Clean-Room-Regel ersetzen:
  Beschreibung nach `docs/spec/<bereich>.md`, Neubau durch einen frischen Agenten nur aus
  Beschreibung und Golden Master, danach Altdatei löschen.
- Neue Abhängigkeiten nur MIT/ISC/BSD/Apache-2.0, kein CDN, keine Anzeigepflicht
  (Ausnahme: TradingView-Logo von Lightweight Charts).
- `de.json`/`en.json` nur im eigenen Namensraum. `menu.js`, `router/index.js` und
  `src/assets/design/tokens.css` ändert nur die Sitzung, der sie gehören — Bedarf beim
  Leitstand melden.
- Testcontainer nur im Testbetrieb, nie gegen die Live-DB schreiben.

## Übersicht

| Welle | Sitzung | Inhalt | Branch | Stand |
|---|---|---|---|---|
| 0 | S1 Verkaufs-Prüfung | Fremdquellen, Bibliotheken, KI-Bedingungen je Funktion | – (nur lesen) | **fertig** → `docs/VERKAUFS-PRUEFUNG.md` (41 grün, 45 gelb, 18 rot) |
| 0 | S2 Fundament V2 | Repo, Umbenennung, Testbetrieb, DB-Kopie, Container, Gestaltungssystem, Rahmen | master | **fertig** (siehe unten) |
| 1 | S3 Aufräumen | CSV-Pfad und toten Import-Code löschen, `journal-alt.js`, zweiter Golden Master (MFE/OHLCV) | `claude/s3-aufraeumen-919210` | **fertig** |
| 1 | S4 Diagramme neu | `charts.js` clean-room in `src/utils/journal/diagramme/` | – | offen, frei |
| 1 | S5 Redesign Handel | Chart, Live-Trading, Sessions, Incoming, Agent-Seiten | `claude/s5-redesign-handel-51c2a6` | **fertig** |
| 1 | S6 Redesign Analyse | Marktradar, Nachrichten, Hype-/Coin-Radar, KI-Agent, Lernen | `claude/s6-redesign-analyse-3fe1f2` | **fertig** |
| 2 | S7 Journal-Kern neu | `trades.js` & Co. clean-room, Tag-Gruppen-Fehler, Datenmodell | – | wartet auf S3 |
| 2 | S8 Ansichten neu | Daily, Dashboard, Kalender, Screenshots (markerjs2 ersetzen), AddTrades, Playbook | – | wartet auf S7 + S4 |
| 2 | S9 Gerüst & Einstellungen | Router, Menü, Layout, `Settings.vue` zerlegen, Bootstrap/FA/Unicons entfernen | – | frei für alles ausser dem Entfernen (wartet auf S5, S6, S8) |
| 2 | S10 Lizenz & Vertrieb | LICENSE, NOTICE, THIRD-PARTY-NOTICES, Zustimmungsdialog, `server/lizenz.js`, private Update-Quelle; NOTICE-Text von Lightweight Charts („TradingView Lightweight Charts™ Copyright (c) 2025 TradingView, Inc. https://www.tradingview.com/") auf eine Über-/Lizenzen-Seite (S1, VERKAUFS-PRUEFUNG.md Abschn. 3) | – | frei |
| 2 | S12 Quellen & Pflichthinweise | Massnahmen 1–6 und 9 aus der Verkaufs-Prüfung: Marktdaten-Abstraktion, rote Quellen raus, CoinGecko mit Kundenschlüssel, Attributionen, KI-Kennzeichnung | – | wartet auf S5 + S6 |
| 3 | S11 Herkunftsnachweis & Freigabe | `scripts/herkunft-pruefen.mjs`, `HERKUNFT.md`, Widget/ESP32 umbenennen, CI, altes Repo privat | – | wartet auf alle |

## S5 Redesign Handel — Ergebnis (19.10.2026)

- **Bereich frei von Bootstrap-Klassen/-JS, Font Awesome und Unicons**: Chart-Arbeitsplatz
  (`Chart.vue`, alle `components/chart/*`), Live-Trading (`Livetrading.vue`,
  `components/livetrading/**`, `LiveSymbolPicker.vue`, Bookmap-Statusleiste in
  `LiquidityHeatmap.vue`), `LiveSessions.vue`, `LiveAuswertung.vue`, `Incoming.vue`, alle
  Agent-Seiten (`AgentStrategies/Setups/Performance/Editor/Builder/Lab`, `CoinRangliste`,
  `StrategyParamForm`, `ZahlOderParam`). Ersetzt durch `Knopf`, `Pille`, `Hinweis`, `Reiter`,
  `Kreisel`, `Symbol` und scoped CSS mit Token; die Pill-Tabs mit `data-bs-toggle` in den
  Strategie-Instanzen laufen jetzt über `Reiter` + `v-show`. Alte Farbwerte und
  `--white-*`/`--blue-color` in diesen Dateien auf Token umgestellt.
- **Gemeinsame Bausteine (von S6 übernommen)**: `basis/Kreisel.vue`; Block „S5 Handel" in
  `Symbol.vue` (≈ 90 Symbole, Prop `gefuellt`); in `basis.css` die Klassen `at-feld`
  (+ `klein`), `at-label`, `at-check`, `at-tabelle` (+ `dicht`, `at-tabelle-huelle`),
  `at-gut`/`at-schlecht`/`at-warn`. `config/livetrading.js` und `config/pult.js` tragen
  Symbol-Namen. Die mit dem Marktradar geteilten Live-Kacheln, `RadarKachel`,
  `RadarOverlay` und `PultRahmen` stehen im Stand von S6.
- **Verhalten unverändert**, TradingView-Logo im Chart bleibt an (`attributionLogo: true`).
  Bewusst geblieben: App-eigene Alt-Klassen aus `style-dark.css` (`ctl-pill`, `dailyCard`,
  `stress-dot`, `card-config-*` …, gehen mit S9), Farbwerte im Chart-/ECharts-JS, die
  eigene Dialoghülle von Alarm- und Indikatordialog (Esc wird in der Capture-Phase
  abgefangen, damit die Chart-Tastatur es nicht sieht — ein natives `<dialog>` würde das
  ändern).
- **Geprüft**: `npm run test:self` 137/137 grün, `vite build` ok. Prüf-Server mit
  Wegwerf-SQLite (Testbetrieb, Port 8095), alle Seiten im eingebauten Browser Desktop
  (1440/1800) und Telefon (375), ohne horizontalen Überlauf; Pendente Trades mit zwei
  Testpositionen, Labor mit echtem Backtest. Screenshots im Notizordner der Sitzungsgruppe
  (`s5-screenshots/`).

### Offene Punkte aus S5

- `utils/chart/overlays/liste.js` und `utils/chart/zeichnungen/werkzeuge.js` tragen noch
  `icon: 'uil …'`-Felder, die nicht mehr gelesen werden (Zuordnung zu Symbol-Namen steht
  in `ChartKopfleiste.vue`/`Zeichenleiste.vue`) — beim Aufräumen entfernen (S9).
- **Fehler (alt)**: `AgentPerformance.vue` ruft `apiFehlerText` auf, ohne es zu importieren —
  beim Fehlschlag von „Spiegeln"/„Entfernen" gibt es einen ReferenceError statt einer Meldung.
- Live-Trading-Kopf: Die mittig absolut gesetzte Symbolwahl überdeckt unter ~1600 px Breite
  (mit Seitenmenü) den Umschalter Raster/Pult — so schon vorher, im Cockpit-Fenster ohne
  Menü passt es.
- Prüfumgebung: Das Session-Cookie `at_session` gilt pro Host, nicht pro Port. Wer im selben
  Browser `localhost:8091` (Testcontainer) und einen lokalen Prüf-Server auf `localhost`
  öffnet, bekommt 401 — den Prüf-Server über `127.0.0.1` aufrufen.
- Seitenmenü und `ReturnToTopButton` tragen noch Unicons (Bereich S9).

## S6 Redesign Analyse — Ergebnis (19.10.2026)

- **Bereich frei von Bootstrap, Font Awesome und Unicons**: Marktradar (Raster und Pult,
  alle Kacheln unter `components/radar/` inkl. derer, die das Live-Fenster einbindet),
  Nachrichten, Hype-Radar (Übersicht, Frühphase, Börsen, Berichte, Projektprüfung,
  Tiefensuche), Coin-Radar (Analyse, Verlauf, Abverkauf), KI-Coach (`KiAgent.vue`),
  Lernen; dazu `RadarKachel`, `RadarOverlay`, `PageInfo`, `InfoTipp`, `AnbieterWahl`,
  `SpinnerLoadingPage`. Knöpfe → `Knopf`, Ladekreisel → `Kreisel`, Marken → `Pille`,
  Meldungen → `Hinweis`, Reiter → `Reiter`, Formfelder → `.at-feld`/`.at-check`
  (aus S5), Rasterzeilen → `.at-formzeile` bzw. eigene CSS-Grids. Kein Verhalten
  geändert; Selbsttests 137/137, Build grün.
- **Neue Bausteine**:
  - `src/assets/design/hilfen.css` (in `main.js` nach `basis.css`): eigene Hilfsklassen
    statt Bootstrap-Utilities — `at-flex/at-mitte/at-verteilt/at-luecke-N`, Abstände
    `at-mo/mu/ml/mr-N`, `at-py/px/p-N`, `at-klein/at-fett/at-rechtsbuendig/at-mittig`,
    `at-formzeile` + `at-feldbreite-*`, Kippschalter `<label|div class="at-check schalter">`,
    `at-regler`, `at-unsichtbar`. Gleiche Abstandstreppe wie Bootstrap, also ohne
    Verschiebung. Für S8/S9 mitbenutzbar.
  - `src/components/basis/Quellenhinweis.vue` — **für S12**: `:quellen="[{ name, url?,
    art: 'daten'|'quelle'|'powered'|'ki' }]"` ergibt „Daten: …", „Quelle: …",
    „Powered by …", „KI-generiert · …" (Links ohne Referrer, nie ausgeblendet).
    Hängt schon in `RadarOverlay` (Fusszeile der Gross-Ansicht); dessen Prop `quelle`
    nimmt jetzt Text ODER eine Quellenliste — S12 kann `quelle` in
    `config/marktradar.js` direkt auf Objekte umstellen.
  - Symbole: `src/components/basis/symbole/analyse.js` (37 neue, keine Markenzeichen:
    YouTube → `video`, X → `nachricht`, Telegram → `senden`, GitHub → `code`, Bitcoin →
    `muenzen`), per `Object.assign` in `Symbol.vue` — weitere Bereiche legen eine eigene
    Datei in `symbole/` an statt in die gemeinsame Liste zu schreiben.
  - `src/components/basis/symbole/unicons.js`: Übergangstabelle Unicons-Name →
    Symbolname plus `symbolName()`; `RadarKachel` und `PultRahmen` nehmen damit beides
    (die Live-Registry von S5 lief unverändert weiter). Fällt in S9 weg.
- **Pult am Telefon** (offener Punkt S2): `Stimmungsband` und `Zyklusband` hatten feste
  Spalten (2 × 170 px bzw. 210 px) — die Skalen bekamen null Breite und ihr Text lief
  übereinander; `PultRahmen` hatte feste Höhe mit `overflow: hidden` und zwei Spalten.
  Jetzt unter 768 px gestapelt (Bühne mit eigener Höhe, die Seite scrollt), Bänder
  zwei- bzw. einspaltig.
- **Nebenbei behoben**: `.at-tabelle th/td` (basis.css) wirkte als Nachfahren-Selektor
  auch auf Detailtabellen in aufgeklappten Zeilen (Coin-Radar: Spalten liefen
  ineinander) — Rücksetzung in `hilfen.css`. Marktradar-Kopf: die absolut zentrierte
  Symbolwahl überdeckte im Raster bei 1440 px den Knopf „Raster" — fliesst jetzt unter
  1600 px, Börsenlinks inline.
- **Tokens**: kein Bedarf.
- **Geprüft**: Prüfserver mit Wegwerf-SQLite (`AT_DB_FILE`, Testbetrieb, eigener
  Vite-Port), Marktradar Raster/Pult/Gross-Ansicht, Nachrichten, Hype-Radar inkl.
  Einstellungen, Coin-Radar mit echtem Messlauf und aufgeklappter Zeile, KI-Coach,
  Lernen — je Desktop 1440 und Telefon 375. Nicht geprüft mit echten Daten: Hype-Scan
  und KI-Texte (keine Schlüssel in der Wegwerf-DB), Börsen-Ansicht befüllt.

### Offene Punkte aus S6

- **Für S9**: Der Bereich benutzt noch eigene Altklassen aus `style-dark.css`
  (`ctl-pill` ~70×, `dailyCard`, `liveHeader/liveDot/liveActions`, `radarCard*`,
  `radarOverlay*`, `card-config-*`, `greenTrade/redTrade`, `pointerClass`, `chat-*`).
  Das ist kein Bootstrap und trägt die Token-Farben, muss aber vor dem Löschen von
  `style-dark.css` nach `hilfen.css`/Bausteine wandern (gemeinsam mit dem Live-Fenster).
- `KiAgent.vue` und `Lernen.vue` haben noch harte Farbwerte in ihren `<style>`-Blöcken
  (`#a78bfa`, `#34d399`, `var(--blue-color)`) — Feinschliff, kein Bootstrap.
- `CoinRadar.vue`: `<tr>` direkt in `<table>` (Vue-Warnung beim Kompilieren) — alt.
- Für S12: `Quellenhinweis` an jede Kachel/Seite hängen; die KI-Texte (Gesamtlage,
  Lagebericht, Hype-Bericht, Einordnung, KI-Coach) mit `art: 'ki'` kennzeichnen.

## S3 Aufräumen — Ergebnis (19.10.2026)

- **Gelöscht**: `brokers.js`, `brokers-kern.js`, `__selftest-brokers.mjs`, `addTrades.js`
  (2135 Z.). Darin tot: CSV-Import (`useImportTrades`, `createBitunixTrades`,
  `filterExisting`), der alte Ausführungs-Import (`createTempExecutions`,
  `createExecutions`, `createTrades`, `getOpenPositionsParse` — nie aufgerufen) und die
  davon abhängigen Zweige in `useUploadTrades`. i18n `addTrades.noCsvData`/`noValidBitgetTrades` raus.
- **`src/utils/journal-alt.js`** (~1000 Z., TradeNote-abgeleitet, unverändert übernommen):
  `useCreateBlotter`/`useCreatePnL` (für `trades.js`), `useGetExistingTradesArray`/
  `useUploadTrades` — **nicht tot**: der Bitunix/Bitget-Knopf „Von API importieren" in
  `AddTrades.vue` speichert darüber (Vorschau → „Absenden") —, dazu `useCreateOHLCV`,
  `useGetOHLCV`, `useGetMFEPrices`, `useUpdateMfePrices`. Ablösung in S7 (Kern) / S8 (AddTrades,
  AddExcursions, Daily).
- **Zweiter Golden Master** `src/utils/__selftest-mfe-pfade.mjs` + `fixtures/mfe-pfade-golden.json`,
  eingefroren gegen das alte `addTrades.js` VOR dem Umzug (eigener Commit), danach unverändert grün.
  Deckt ab: Databento-CSV → Kerzen, Kerzen über Polygon/Databento (Anfrageparameter mit),
  MFE je Trade in New York und Zürich, Marktschluss 11:00, Exkursionszeilen, API-Import-Vorschau
  und Speichern. Gegenprobe: drei eingebaute Fehler (MFE-Fenster, OHLCV-Volumen, Broker beim
  Speichern) schlugen je an. Die axios-Attrappe reicht jetzt Konfiguration/Rumpf an Antwortfunktionen durch.
- **Für S7/S8 mit eingefroren** (Fehler im heutigen Code): `mfePrices` ist ein nie geleerter
  Modulspeicher — zweimal Exkursionen nachtragen in einer Sitzung legt die ersten doppelt an, und
  der nächste API-Import (`useUploadTrades`) schreibt sie nochmals. `useGetOHLCV` löst nach dem
  ERSTEN Symbol auf (`AddExcursions.vue` rechnet dann evtl. mit unvollständigen Kerzen). Ein Trade,
  dessen Symbol gar nicht in den Kerzen steht, wirft in `useGetMFEPrices` und das Promise bleibt
  offen; `useUpdateMfePrices`/`useCreateOHLCV` lösen bei leerer Eingabe nie auf.
- **Offen, fremde Bereiche**: `setup.featureImport`/`setup.nextStepImport` (Setup.vue nennt noch
  „CSV-Upload") und `settings.benachrichtigungen.hinweis_importFertig` („CSV- oder API-Import")
  — S8/S9. `docs/VERKAUFS-PRUEFUNG.md` Z. 5 verweist noch auf `addTrades.js` (jetzt `journal-alt.js`).
- `npm run test:self` 137/137 Dateien grün, `npm run build` fehlerfrei.

## S2 Fundament V2 — Ergebnis (19.10.2026)

- **Repo**: `Trading/V2` aus `git archive` des Journal-master `7fb0326`, frische Historie
  auf `master`. Ohne Datenbanken, Backups, `_audit*`, `certs`, `REFACTORING-ANALYSE.md`,
  GPL-`LICENSE`.
- **Umbenennung**: `autarktrade` 4.0.0-alpha.0, Cookie `at_session`, SQLite
  `autarktrade.db` (alte `tradenote.db` wird weiterbenutzt, wenn nur sie da ist),
  Umgebung `AT_*` mit `CTJ_*`-Rückfall (`server/umgebung.js`). Unverändert und
  kommentiert: Schlüssel-Seed `tradenote-…` in `server/crypto.js`, Token-Zweck
  `tn_session_v1` in `server/auth.js` — sonst wären gespeicherte Schlüssel bzw. alle
  Sitzungen ungültig. Bewusst unverändert, weil gespeichert: `ctj-`-Präfix der
  `clientOrderId` (Abgleich offener Orders), `CTJ1`-Magic der Aufzeichnungen,
  `ctj-strategie`-Paketformat, `ctj.*`-Schlüssel im localStorage.
- **Aktualisierung**: `update-api.js` zeigt auf `Mouses007/AutarkTrade` (privat, Prüfung
  läuft bis S10 ins Leere — gegen das alte Repo hätte sie 3.x als „neuer" gemeldet).
  Docker-Workflow nur von Hand und nur nach `ghcr.io/mouses007/autarktrade`, kein
  öffentlicher Docker Hub.
- **Testbetrieb** `AT_TESTBETRIEB=1` (`server/testbetrieb.js`, Selbsttest
  `server/__selftest-testbetrieb.mjs`): keine Takte, Engine, Stop-Wächter, Rekorder,
  Kalender-/Schnappschuss-/ETF-Timer; keine Mail, kein Push; Banner; Handelslage-Automatik
  im Browser aus. Knöpfe bleiben.
- **DB-Kopie**: NAS-DB `autarktrade` (pg_dump von `tradejournal`, 19.10.2026). In der Kopie
  Benachrichtigungskanäle geleert, Strategie-Instanzen auf `paper` und pausiert.
- **Testcontainer**: `autarktrade-v2` auf Port 8091 über `scripts/v2-container.sh`
  (Zugangsdaten in `scripts/.v2-container.env`, nicht im Repo), `.claude/launch.json`.
- **Gestaltungssystem**: `src/assets/design/` (Token, Basis, Rahmen), Bausteine in
  `src/components/basis/`, eigenes Symbolset `Symbol.vue`, Logo aus
  `scripts/logo-zeichnen.mjs`, Favicons. Bootstrap/Popper lokal gebündelt, Quill nur in
  Playbook/Incoming.
- **Rahmen**: Kopfleiste mit Modi, Testbetrieb-Banner, Startseite `/start` mit Logo,
  Seitenmenü und Titelzeile im neuen Stil. Spenden-Link und -QR-Codes entfernt.

### Offene Punkte aus S2

- Font Awesome und Unicons kommen noch vom CDN (Unicons: „IconScout Simple License",
  gebündelt wäre es eine Weitergabe). Ablösung durch `Symbol.vue` in S5/S6/S8, Entfernen in S9.
- Android-Widget, ESP32 und Desklet tragen noch den alten Namen (S11).
- Installations-/Update-Skripte (`install*.sh/.bat`, `update*`, `setup-remote.sh`) zeigen
  noch auf das alte Repo (S10).
- `LIZENZ-PLAN.md` liegt als Bestandsaufnahme im Repo; `HERKUNFT.md` ist ein Platzhalter bis S11.
- **Fehler (auch im Live-Journal)**: Die Migration „Mail-Versand des Lageberichts übernehmen"
  in `server/database.js` (~Z. 2167) läuft bei JEDEM Start, solange `radarNewsMailAktiv = 0`
  und `benachrichtigungen.lageberichtFertig.email = true` — wer den Versand ausschaltet,
  hat ihn nach dem nächsten Neustart wieder an. In der Kopie behoben durch Entfernen der
  alten Mail-Wahl; der Code braucht einen Merker „übernommen".
- ~~Marktradar, Ansicht „Pult": am Telefon überlappen die oberen Kacheln~~ — behoben in S6.
- Screenshots mit echten Daten: 8091 steht hinter dem Passwort-Gate der Kopie; geprüft
  wurde die Oberfläche im Prüf-Container mit leerer SQLite, die Daten über die API.
- Privates GitHub-Repo: https://github.com/Mouses007/AutarkTrade (angelegt 19.10.2026, privat).
