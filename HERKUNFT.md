# Herkunft des Codes

Stand vom 20. Oktober 2026 (Auftrag F3; zuvor S11 am 19. Oktober)

AutarkTrade ist aus dem **Crypto Trading Journal** (Mouses007) hervorgegangen, das am
15. Februar 2026 als Fork von **TradeNote** (Eleven-Trading, GPL-3.0) begann. Dieses
Dokument hält fest, was davon übrig ist, wie das gemessen wurde und warum der Rest
kein übernommener Ausdruck ist. Es ist die einzige Stelle im Repository, die das
Ursprungsprojekt nennt.

Vergleichsquelle: <https://github.com/Eleven-Trading/TradeNote>

## Ergebnis

| | 19.10.2026 vorher (Bestandsaufnahme) | 19.10.2026 nachher (S11) | 20.10.2026 nachher (F3) |
|---|---|---|---|
| Vergleichsstand | `56eb096` (14.04.2025) | `56eb096` (14.04.2025, unverändert der neueste) | `56eb096`, **ohne** dessen Fremdbibliothek `codemirror-graphql` |
| Zeilen ≥ 20 Zeichen (js/mjs/vue/css/html) | 125 372 | 129 464 | 131 665 |
| davon wörtlich im Vergleichsstand | 6 438 (5,1 %) | **1 419 (1,10 %)** | **1 426 (1,08 %)** |
| davon **nicht** generisch | ≈ 6 000, Schwerpunkt Journal-Kern | **0** | **0** |
| Zeilen übriger Textdateien (md, json, sh, bat, yml, txt …) | – | – | 20 746, davon 15 gleich: 8 `package.json` (npm-Skript, Versionsangabe), 7× Schluss eines Apache-Lizenztexts Dritter |
| Namen: im Vergleichsstand deklariert / bei uns vorhanden | – | – (S11: 107 umbenannt) | 1 066 / 189, **alle gesichtet** (Audit A3: 313, davon 55 `use…`- und ~60 Zustandsnamen eigen) |
| Token-Läufe (umformulierte Kopien) über der Schwelle | – | – | 130 streng, 50 normalisiert, **alle gesichtet**; keiner trägt eigene Logik des Ursprungs |

Alle verbleibenden Zeilentreffer gehören zu einer der sechs Arten unten; keiner ist
eine Zeile, die eine eigene schöpferische Entscheidung des Ursprungsprojekts trägt.
Namen und Token-Läufe stehen mit Begründung in `scripts/herkunft-akzeptiert.json`
(Arten weiter unten).

## Methode

`scripts/herkunft-pruefen.mjs` klont die Vergleichsquelle (`git clone --depth 1`) in
ein Temp-Verzeichnis, lässt deren mitgelieferte Fremdbibliothek `codemirror-graphql`
weg (deren Zeilen sind nicht vom Ursprungsprojekt) und prüft viermal. Erstens Zeile
für Zeile im Code:

1. Berücksichtigt werden Dateien mit den Endungen `.js .mjs .vue .css .html`, auf
   unserer Seite nur versionierte (`git ls-files`).
2. Jede Zeile wird von Einrückung und Leerraum am Ende befreit. Kürzere Zeilen als
   20 Zeichen zählen nicht (`}`, `</div>`, `return x` sagen nichts über Herkunft).
3. Eine Zeile gilt als übernommen, wenn genau diese Zeichenfolge als Zeile irgendwo
   im Vergleichsstand steht.
4. Jeder Treffer wird einer der Arten unten zugeordnet. Was keiner Art angehört,
   gibt das Skript einzeln aus und endet mit Code 1.

Zweitens dieselbe Zeilenregel für alle übrigen Textdateien (Markdown, JSON samt
i18n, Shell, Batch, YAML, Text, Dockerfile, Lizenzdateien). Drittens die **Namen**:
jeder im Vergleichsstand deklarierte Name (`function`/`const`/`let`/`var`/`class`,
mindestens 4 Zeichen) gegen jedes Wort unseres Codes. Viertens **Token-Fenster**
gegen umformulierte Kopien: Kommentare fallen weg, Zeichenketten und Zahlen werden
Platzhalter; *streng* (Namen bleiben, Fenster 10, gemeldet ab 14 Tokens mit ≥ 6
eigenen Wörtern) und *normalisiert* (auch Namen werden Platzhalter, Fenster 12,
gemeldet ab 30 Tokens mit ≥ 2 Kontrollfluss-Schlüsselwörtern, ohne HTML-/CSS-Rahmen).
Jeder Treffer der Prüfungen 2–4, der nicht mit Begründung in
`scripts/herkunft-akzeptiert.json` steht, lässt das Skript ebenfalls mit Code 1 enden.

```bash
node scripts/herkunft-pruefen.mjs              # klont frisch, zeigt Zusammenfassung
node scripts/herkunft-pruefen.mjs --treffer    # zusätzlich jede Trefferzeile
node scripts/herkunft-pruefen.mjs --namen --laeufe   # jeder Name, jeder Lauf
node scripts/herkunft-pruefen.mjs --vorschlag  # Ungesichtetes als JSON-Gerüst
```

Die Zeilenprüfung findet wörtliche Übernahmen, die Token-Fenster finden
umformulierte, solange die Form gleich blieb. Gegen Umformulieren steht ausserdem
die Clean-Room-Regel, nach der die Aufträge S3–S9 gearbeitet haben: Ein
Agent beschrieb das Verhalten der Altdateien (`docs/spec/`), ein frischer Agent ohne
Zugriff auf die Altdateien baute nur aus dieser Beschreibung und dem Golden Master
(`src/utils/__selftest-journal.mjs`) neu; danach wurden die Altdateien gelöscht.

## Was in S11 noch geändert wurde

Der Clean-Room-Neubau hatte die **Bezeichner** der Altdateien behalten, damit die
übrigen Dateien unverändert weiterliefen. Dadurch standen nach S9 noch 367 Zeilen
wie `await useMountDashboard()` oder `export const spinnerLoadingPage = ref(true)`
gleich im Vergleichsstand — kein übernommener Code, aber übernommene Namen und, in
`utils/journal/ablauf.js`, eine Aufrufreihenfolge, die über die Namen gleich aussah.
S11 hat deshalb:

- **107 Bezeichner projektweit umbenannt** (Funktionen wie `useGetFilteredTrades` →
  `filtereTrades`, `useMountDaily` → `starteTagesansicht`, Zustände wie
  `filteredTrades` → `journalTage`, `spinnerLoadingPage` → `seiteLaedt`, die
  Komponenten `SpinnerLoadingPage.vue` → `SeiteLaedt.vue` und
  `ReturnToTopButton.vue` → `NachObenKnopf.vue`). Gespeicherte Schlüssel
  (`localStorage`, `sessionStorage`, Datenbankspalten, i18n) blieben bewusst gleich,
  sonst verlören bestehende Installationen ihre Filter. Der Golden Master lief vor
  und nach der Umbenennung mit identischen Werten; nur seine Schlüsselnamen folgen
  den neuen Bezeichnern.
- das **Startgerüst von `index.mjs`** (Startfunktion, Vite-Weiterleitung,
  Auslieferung von `dist/`, Startmeldungen), das **Speichern von Profilname und
  -bild** (`views/einstellungen/allgemein/LayoutStil.vue`) und die
  **Quill-Farbregeln** (`assets/design/quill.css`) neu geschrieben;
- die reinen Weiterleitungsdateien aus S7 (`stores/globals.js`,
  `utils/{trades,daily,mountOrchestration,utils,formatters,dayjs-setup}.js`) und zwei
  ungenutzte Zustände (`noData`, `legacy`) gelöscht.

## Was in F3 geändert wurde (20.10.2026)

Audit A3 (`docs/audit/2026-10-19/A3-fork-reste.md`) fand nach S11 keine kopierte
Zeile, aber noch rund 120 übernommene Namen, 13 Routenpfade, einen übersetzten
Hilfetext und drei Module mit der Aufteilung des Ursprungs. F3 hat:

- **~130 Bezeichner** umbenannt: die 20 Formatierer (`formGeld2`, `formDatum` …),
  die Diagrammfunktionen und Farbkonstanten, Import/MFE (`berechneMfePreise`,
  `speichereImport` …), das App-Gerüst (`starteApp`, `appEinstellungen`,
  `seitenId`, `tradeZeitzone` …), die Filterzustände (`gewaehlteBoerse` …), die
  CSS-Klassen (`journalKarte`, `gewinnWert`/`verlustWert`, `klickZiel`,
  `diagrammFlaeche`), die Diagramm-IDs (`ringGewinnquote`, `balkenGruppe…`) und
  `setupApiRoutes` → `registriereApiRouten`. Der Parse-Alias `useInitParse` und
  toter Zustand (`stepper`, `idCurrent…`, `useEditItem` samt Wegen zu Seiten, die
  es nie gab) sind gelöscht.
- die **Dateien** `views/{JournalUebersicht,Kalender,Tagesansicht,Bilder,
  Bewertungen,TradeImport,Exkursionen,Einstellungen}.vue`, `components/{KalenderMonat,
  KeineDaten,BildKarte}.vue` und `layouts/Rahmen.vue` umbenannt; `App.vue` rahmt
  Seiten mit `meta.rahmen` statt `meta.layout`.
- die **Routen** auf `/journal /kalender /tagesansicht /bilder /bewertungen /import
  /exkursionen /einstellungen/:bereich` gestellt. Die alten Pfade leiten samt
  Abfrage weiter; in der Datenbank ist kein Pfad gespeichert (geprüft), die
  Journal-Filter im `localStorage` übernimmt `src/utils/speicherUmzug.js` einmal
  unter `at.journal.*`.
- **Tag-Info, Bildpfad und Trade-Fenster der Tagesansicht** nach der
  Clean-Room-Regel neu geschnitten: Agent A beschrieb das Verhalten
  (`docs/spec/f3-*.md`, ohne alte Namen), der Altcode wurde entfernt, ein
  frischer Agent B baute ohne Zugriff darauf eine eigene Aufteilung
  (`src/utils/bilder/`, `stores/journal/bilder.js`, `rahmen/BildVollbild.vue`,
  getrennte Wege `oeffneTrade`/`blaettere`/`schliesseTrade`). Die tote
  Tag-Eingabe wurde nicht nachgebaut.
- den Hilfetext `daily.volTooltip` neu formuliert, `lodash` als Abhängigkeit
  entfernt, die Parse-Kommentare in `src/utils/db.js` gestrichen.
- die Spezifikationen aus S4–S9, die die alten Namen nennen, aus dem Repo
  genommen; sie liegen als Beleg mit Prüfsummen ausserhalb
  (`Trading/AutarkTrade-Beleg/clean-room-spezifikationen-2026-10/`).

Golden Master: Werte vorher und nachher gleich; neu eingefroren wurden nur
Schlüssel (Diagramm-IDs) und die Zieladresse nach dem Import (`/journal`).

## Akzeptierte Treffer

Stand des Laufs vom 20.10.2026, nach Art. Die Muster stehen in `AKZEPTIERT` im Skript.

| Art | Treffer | Was es ist | Warum unbedenklich |
|---|---|---|---|
| CSS-Eigenschaft | 1 023 | `align-items: center;` (412×), `flex-direction: column;` (173×), `white-space: nowrap;`, `text-transform: uppercase;`, `justify-content: center;`, `display: inline-block;`, `text-decoration: none;`, `text-overflow: ellipsis;`, die `-webkit-line-clamp`-Dreierfolge, `border-radius: 10px;`, `grid-template-columns: 1fr 1fr;`, `box-sizing: border-box;`, `@media (min-width: 768px) {` u. ä. — 22 verschiedene Zeilen | Eine einzelne CSS-Eigenschaft mit Standardwert ist die einzige Schreibweise für diese Wirkung. Die Treffer verteilen sich über alle Bereiche, auch über Radar- und Chart-Dateien, die nie mit dem Ursprung zu tun hatten. |
| Import | 193 | `import axios from 'axios'` (100×), `import { ref } from 'vue'`, `import dayjs from 'dayjs'`, die dayjs-Plugins, `import path from 'path'`, `import express from 'express'`, Vite-/Router-Importe, `import App from './App.vue'`, `import DashboardLayout from '../layouts/Dashboard.vue'`, `import Screenshot from '../components/Screenshot.vue'` | Einbinden einer Bibliothek bzw. einer Datei unter ihrem Namen; die Schreibweise legt die Bibliothek fest. |
| Gerüst von Vue, Router, Vite | 167 | `const props = defineProps({`, `onMounted(async () => {`, `onBeforeMount(async () => {`, `const route = useRoute()`, `const app = createApp(App)`, `const router = createRouter({`, `export default router`, `export default defineConfig({`, die Alias-Zeile `'@': fileURLToPath(…)`, `// https://vitejs.dev/config/` und vier Zeilen des Vite-Startgerüsts in `index.html` (`<meta charset>`, `<meta viewport>`, `<div id="app">`, `<script type="module" src="/src/main.js">`) | Wörtlich aus den Vorlagen und der Dokumentation von Vue, Vue Router und Vite (`npm create vue`); in jedem Projekt mit diesem Werkzeug gleich. |
| JavaScript-Standardform | 12 | `return new Promise((resolve, reject) => {`, die Fehlerunterscheidung von axios (`if (error.response) {` / `} else if (error.request) {`, so in der axios-Dokumentation), `dayjs.extend(timezone)` (`setupApiRoutes(app);` und `if (currentUser.value) {` sind seit F3 umbenannt, Audit A3-02) | Sprachübliche Formen bzw. ein einzelner Aufruf mit naheliegendem Namen; keine Auswahl oder Anordnung. |
| Optionen von ECharts und Quill | 19 | `splitLine/axisTick/axisLine: { show: false },`, `type: 'candlestick',`, `radius: ['70%', '100%'],`, `avoidLabelOverlap: false,`, Quill-Werkzeugleiste `[{ header: [1, 2, 3, false] }],` | Konfigurationsschlüssel der Bibliotheken mit ihrem dokumentierten Wert. |
| Datenbegriff | 12 | `export const trades = reactive({})` und dieselbe Form für `totals`, `groups`, `notes`, `excursions`, `screenshots`, `executions`, `blotter`, `pAndL`, `imports`, `apis`, `layoutStyle`; `screenshots.length = 0`, `excursions.length = 0` | Leere Behälter, benannt nach den Tabellen und Spalten der Datenbank (`trades`, `notes`, `excursions`, `layoutStyle` …). Die Namen sind Daten-Schnittstelle bestehender Installationen und werden nicht geändert. |

## Bewusst stehen gelassene Namen

Kein schützbarer Ausdruck, aber aus Verträglichkeit mit bestehenden Daten unverändert:

- Dateiname `tradenote.db` als Rückfall, wenn nur diese SQLite-Datei existiert
  (`server/db-config.js`, `docker-entrypoint.sh`, `.gitignore`).
- Schlüssel-Seed `tradenote-…` in `server/crypto.js` und `server/reencrypt-keys.mjs` —
  ein anderer machte alle gespeicherten API-Schlüssel unlesbar.
- Token-Zweck `tn_session_v1` in `server/auth.js` — ein anderer meldete jedes Gerät ab.
- Tabellen-, Spalten- und Feldnamen der Journal-Daten (`trades`, `excursions`,
  `pAndL`, `grossSharePL` …, Audit A3-25/A3-26): Datenformat bestehender
  Installationen, Backups und der ESP32-/KI-Schnittstellen; ein Umbenennen wäre ein
  eigener Auftrag mit Migration.
- Die alten `localStorage`-Schlüssel des Journal-Filters (`selected…`) nur noch in
  `src/utils/speicherUmzug.js`, das sie einmal übernimmt; die Datei kann entfallen,
  sobald kein Browser sie mehr hat.
- Die alten Routenpfade nur noch als Weiterleitung in `src/router/routen.js`.

`tradeNoteId`/`tradeNoteDateUnix` (bis S11 hier begründet) heissen seit F3
`notizTradeId`/`notizTagUnix`.

## Rechtliche Einordnung (keine Rechtsberatung)

- Die bis Version 3.x veröffentlichten Fassungen des Crypto Trading Journal bleiben
  unter GPL-3.0, für jeden, der sie hat; ihr Quellcode bleibt im alten Repository
  erhältlich. Die Software holt Updates nicht mehr von dort (`server/update-api.js`).
- Neu lizenzieren lässt sich nur Code, an dem alle Rechte beim Anbieter liegen. Am
  Code nach S11 haben ausser Mouses007 (mit Claude als Werkzeug) keine Dritten
  mitgeschrieben; die Commit-Historie enthält keine fremden Autoren.
- Vor der ersten Weitergabe unter `LICENSE` lässt der Anbieter diesen Nachweis
  zusammen mit LICENSE und NOTICE anwaltlich gegenlesen (offener Punkt in
  `docs/AUFTRAGSSTAND.md`).

## Anhang A: Bestandsaufnahme vor dem Neubau (19.10.2026)

Gemessen mit derselben Methode, bevor S3–S9 begannen. Fast alles sass im alten
Journal-Kern; Radar-, Chart-, Live-Trading-, Strategie- und KI-Teile hatten nur
generische CSS-Treffer. Alle hier genannten Dateien sind gelöscht und clean-room
ersetzt (S3 Aufräumen, S4 Diagramme, S7 Journal-Kern, S8 Ansichten, S9 Gerüst und Stil);
die Gegenprobe per `git blame` zeigte damals 6,8 % nie angefasste Zeilen.

| Datei (Stand vor S3) | wörtlich gleich | Anteil |
|---|---|---|
| `src/utils/addTrades.js` | 1127 / 1360 | 83 % |
| `src/utils/charts.js` | 698 / 1776 | 39 % |
| `src/assets/style-dark.css` | 517 / 1221 | 42 % |
| `src/views/Daily.vue` | 508 / 1339 | 38 % |
| `src/utils/trades.js` | 414 / 726 | 57 % |
| `src/utils/screenshots.js` | 268 / 360 | 74 % |
| `src/utils/utils.js` | 242 / 409 | 59 % |
| `src/utils/daily.js` | 201 / 355 | 57 % |
| `src/views/Settings.vue` | 196 / 4045 | 5 % |
| `src/stores/globals.js` | 138 / 308 | 45 % |
| `src/views/Dashboard.vue` | 119 / 697 | 17 % |
| `src/components/SidebarFilters.vue` | 87 / 310 | 28 % |
| `src/utils/mountOrchestration.js` | 85 / 207 | 41 % |
| `src/views/AddExcursions.vue` | 76 / 101 | 75 % |
| `src/utils/calendar.js` | 74 / 85 | 87 % |
| `src/components/Screenshot.vue` | 56 / 97 | 58 % |
| `src/router/index.js` | 50 / 239 | 21 % |
| `src/utils/formatters.js` | 43 / 97 | 44 % |
| `src/assets/base.css` | 42 / 43 | 98 % |
| `src/views/AddTrades.vue` | 41 / 325 | 13 % |
| `src/components/SideMenu.vue`, `Nav.vue`, `layouts/Dashboard.vue`, `Calendar.vue` (+View), `Screenshots.vue`, `utils/dayjs-setup.js`, `brokers.js` | je 12–40 | – |

Umbauplan damals: Golden Master zuerst, dann toten Code löschen (CSV-Pfad), dann
Neubau in Paketen A Journal-Kern → B Import → C Auswertungs-Charts → D Ansichten →
E Gerüst und Stil, zuletzt dieser Nachweis. So umgesetzt; Stand je Auftrag in
`docs/AUFTRAGSSTAND.md`.

## Anhang B: Lizenzmodell (Entscheidung 19.10.2026)

Offene und „source-available"-Lizenzen (PolyForm NC, FSL, BSL, AGPL) passen nicht zum
Verkauf an Privatkunden: sie erlauben Gratisnutzung oder Weitergabe. Deshalb eine
eigene proprietäre Lizenz (`LICENSE`, Entwurf aus S10):

| Baustein | Vorschlag |
|---|---|
| Lizenzvertrag | Eigene EULA nach Schweizer Recht (Gerichtsstand CH), vom Anwalt aufgesetzt. Kernpunkte: Nutzungsrecht pro Person/Installation, kein Weitergeben, Haftungsausschluss, **ausdrücklich keine Anlageberatung, keine Haftung für Handelsverluste und Fehlorders** (die App platziert über die Strategie-Schicht echte Orders – das ist der wichtigste Absatz). |
| Preismodell | Wahl zwischen **Einmalkauf + 12 Monate Updates** (danach Verlängerung, die gekaufte Version läuft weiter – bei Privatkunden am leichtesten zu verkaufen) oder **Abo** monatlich/jährlich. Optional ein Gratis-Testzeitraum (z. B. 14 Tage). |
| Quellcode | **Repo privat.** Öffentlicher Quellcode und Verkauf an Private beissen sich: wer den Code hat, braucht keine Lizenz. Ein öffentliches Repo nur noch für README, Handbuch und Releases-Notizen. |
| Auslieferung | Docker-Image in einer **privaten Registry** (Docker Hub privat oder GHCR) mit Zugang je Kunde, oder signiertes Paket zum Download nach Kauf. Das öffentliche `mouses007/trading-journal:latest` wird eingestellt. |
| Aktivierung | Lizenzschlüssel als signiertes Token (Ed25519: Käufer, Ablauf der Update-Berechtigung, Edition). Die App prüft die Signatur **offline** mit eingebautem öffentlichem Schlüssel – kein Zwang zum Online-Check, passt zur lokalen Einzelnutzer-Idee. Ohne gültigen Schlüssel: Testmodus bzw. nur lesen, Daten bleiben nie gesperrt. |
| Verkauf | Ein Händler-Dienst als „Merchant of Record" (z. B. Paddle, Lemon Squeezy): übernimmt Zahlung, Rechnung und **MWST/EU-Umsatzsteuer** für Privatkunden im Ausland, und kann Lizenzschlüssel per Webhook ausstellen lassen. Selbst verkaufen heisst EU-OSS-Registrierung ab dem ersten EU-Privatkunden. |

Technisch schützt nur die Hürde (minifizierter Build, privates Image), rechtlich die
Lizenz. Alle npm-Abhängigkeiten erlauben geschlossenen kommerziellen Vertrieb
(`THIRD-PARTY-NOTICES`); das TradingView-Logo von Lightweight Charts bleibt an.
