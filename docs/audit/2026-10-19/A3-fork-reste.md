# Audit A3 – Fork-Reste

Stand 19.10.2026, geprüfter Code: `master` 429c77f. Nur geprüft, nichts geändert.
Vergleichsquelle: TradeNote `56eb096` (14.04.2025, weiterhin der neueste Stand),
`git clone --depth 1` in ein Temp-Verzeichnis, nur als Daten gelesen. Der Klon ist
gelöscht.

Ziel des Nutzers: „Alles vom Fork muss weg sein." Geprüft wurde deshalb nicht nur, ob
Zeilen wörtlich gleich sind, sondern auch umformulierte Kopien, Namen, Struktur,
Texte, Bilder, Datenmodell, Git-Historie und Abhängigkeiten.

## Zusammenfassung

**Fazit: Im Code von V2 steckt kein übernommener Ausdruck mehr, der als Kopie zählen
würde, aber fork-frei ist V2 nicht.** Drei Dinge stehen dem Ziel entgegen:

1. **Die Git-Historie enthält TradeNote vollständig.** Der Wurzel-Commit `6ab0e6d` ist
   der Ausgangsstand mit 6 463 wörtlich gleichen Zeilen (5,09 %), davon 4 744 nicht
   generisch. Alle 64 Commits, alle Branches und `origin` bauen darauf auf. Das
   Update über git (`git fetch … master` **ohne** `--depth`) lädt diese Historie auf
   jeden Kundenrechner. Das ist der schwerste Befund: Damit wird TradeNote-Code
   weitergegeben, auch wenn der aktuelle Stand sauber ist.
2. **Viele Namen sind noch von TradeNote.** 55 `use…`-Funktionsnamen, rund 60
   Zustands- und Store-Namen, 6 CSS-Klassen, 8 Ansichts- und 3 Komponenten-Dateinamen
   und 13 Routenpfade sind gleich. S11 hat 107 Namen umbenannt, diese hier blieben.
   Einzeln ist ein Name kein schützbarer Ausdruck. In der Summe zeigt das aber
   deutlich, woher der Code kommt.
3. **Der Journal-Kern ist an einigen Stellen umformuliert, aber nicht neu
   gedacht.** Die Tag-Verwaltung, der Screenshot-Pfad und `clickTradesModal`
   übernehmen TradeNotes Aufteilung, Parameter-Protokoll und Namen, nur der Code im
   Inneren ist neu. Das ist zulässig, weil die Clean-Room-Spezifikation das
   Verhalten vorgibt. Es ist aber mehr als „nichts übrig".

Was **sauber** ist: Bilder, Icons, Schriften (keine einzige gleiche Datei), README und
Doku (keine gleiche Zeile), die Zeilen des Skripts (alle 1 439 Treffer generisch; nur
`setupApiRoutes(app);` ist falsch eingeordnet, A3-02), das Docker-Image (ohne `.git` und `docs/`)
und der Lizenztext.

Ein **Nebenbefund**, der kein Fork-Rest ist, aber dringend: `spinnerLoadingPage`
steht seit der S11-Umbenennung in drei Templates, ohne dass die Variable importiert
wird. Die Lade-Anzeige erscheint deshalb nie (A3-15).

### Zahlen

| Art | Befunde | muss weg | sollte weg | generisch / akzeptabel / ok |
|---|---:|---:|---:|---:|
| wörtlich (Zeilen) | 1 | – | – | 1 |
| Methode (Prüfskript) | 1 | – | 1 | – |
| umformuliert | 3 | – | 1 | 2 |
| Bezeichner | 11 | 2 | 9 | – |
| Struktur | 3 | – | 1 | 2 |
| Text | 4 | 1 | 1 | 2 |
| Assets | 1 | – | – | 1 |
| Datenmodell | 2 | – | – | 2 |
| Historie / Auslieferung | 5 | 4 | – | 1 |
| Abhängigkeit | 3 | – | 1 | 2 |
| **Summe** | **34** | **7** | **14** | **13** |

„muss weg": wörtliche oder übersetzte Übernahme, ausgelieferter Fremdcode oder ein
Name, der das Ursprungsprojekt bzw. Parse nennt. „sollte weg": kein Ausdruck, aber
ein klar erkennbarer Rest (Name, Aufteilung), der für das Ziel stört. „generisch":
einzige oder übliche Schreibweise bzw. funktional nötig, mit Begründung in der
Tabelle.

### Was zu tun wäre (Reihenfolge nach Wirkung)

1. **Historie abschneiden** (A3-27 bis A3-30): eine neue Wurzel ohne Altstand anlegen
   und das Update auf `--depth 1` stellen. Das ist wenig Arbeit und hat die grösste
   Wirkung. Wie das geht, steht unter „Historie".
2. **`daily.volTooltip`, `useInitParse`, `spinnerLoadingPage`, `setupApiRoutes`**
   (A3-21, A3-12, A3-15, A3-02): klein, sofort machbar.
3. **Ein Umbenennungs-Auftrag wie in S11 für den Rest der Namen** (A3-05 bis A3-14,
   A3-16, A3-17): mechanisch, etwa ein Auftrag. Golden Master vorher und nachher mit
   identischen Werten; gespeicherte Schlüssel (`localStorage`, DB, i18n) bleiben.
   Dabei die Tag- und Screenshot-Funktionen neu schneiden statt nur umbenennen.
4. **`lodash` entfernen** (A3-32), Prüfskript erweitern (A3-03).
5. **Datenmodell** (A3-25, A3-26): nicht nötig; nur angehen, wenn der Nutzer es
   ausdrücklich will. Die Kosten stehen dort.

## Methode

| Prüfung | Werkzeug | Ergebnis |
|---|---|---|
| 1 Zeilen | `scripts/herkunft-pruefen.mjs --vergleich <klon> --treffer` | 130 200 Zeilen ≥ 20 Zeichen, 1 439 gleich (1,11 %; S11: 1 419 / 1,10 %), Exit 0. Jede der **91 verschiedenen** Trefferzeilen einzeln gesichtet. |
| 1b übrige Dateitypen | eigener Zeilenvergleich für alles ausser js/mjs/vue/css/html (md, json, sh, bat, yml, Dockerfile, txt) | 15 Treffer: 8 in `package.json` (Skripte, Versionsangaben), 7× „END OF TERMS AND CONDITIONS" aus Lizenztexten Dritter. |
| 2 unscharf | Token-Fenster-Vergleich (Kommentare raus, Literale → Platzhalter), zwei Läufe: **streng** (Bezeichner bleiben, Fenster 10) und **normalisiert** (Bezeichner → Platzhalter, Fenster 12), jede V2-Datei aus `src/ server/ shared/ scripts/` + `index.mjs/index.html/vite.config.js` gegen `src/`, `index.mjs`, `index.html`, `vite.config.js` von TradeNote (ohne dessen mitgelieferte Fremdbibliothek `codemirror-graphql`). Zusammenhängende Läufe wurden je Dateipaar zusammengefasst. | streng: 6 119 Läufe, davon 81 mit ≥ 14 Tokens und ≥ 6 eigenen Wörtern, alle gesichtet. normalisiert: 15 862 Läufe. Gefiltert auf JavaScript mit Kontrollfluss (≥ 30 Tokens, ≥ 2 Schlüsselwörter, keine CSS-/Listen-/Template-Läufe) bleiben 33, alle gesichtet. Dazu 249 Läufe in den Journal-Dateien, die oberen 45 gesichtet. Echte umformulierte Stellen: A3-04 bis A3-07, A3-13. Der Rest ist gleicher HTML-Rahmen (`</span></div><div class=…>`), gleiche Objekt-Literal-Form oder `try/catch`+`console.error`. Die Gegenseite in TradeNote ist an diesen Stellen inhaltlich etwas völlig anderes. |
| 3 Bezeichner | alle in TradeNote deklarierten Namen (`function/const/let/var`, ≥ 4 Zeichen; 1 063 Namen) gegen jedes Wort in V2 | 313 Namen kommen in V2 vor. Nach Abzug der Allerweltswörter (`path`, `value`, `trades`, `symbol` …) sind **55 `use…`-Namen** und rund **60 Zustands-/Store-Namen** TradeNote-eigen. |
| 3b CSS-Klassen | Klassen aus TradeNote-CSS und `class=`-Attributen gegen V2 | 26 gemeinsam, davon 6 TradeNote-eigen (Rest: Bootstrap-`active`, Quill-`ql-*`, `tag`, `logo`, `overlay`). |
| 4 Texte | `en.json` (5 358 Schlüssel), normalisiert, gegen alle Zeichenketten/Template-Texte/Zeilen von TradeNote (≥ 3 Wörter) | 6 gleich, 1 davon charakteristisch. `de.json` lässt sich maschinell nur über die Schlüssel mit `en.json` vergleichen; geprüft über dieselben Schlüssel. |
| 4b Assets | SHA-256 aller versionierten Dateien gegen alle TradeNote-Dateien, Namenssuche | 0 gleiche Dateien. `astronaut.png`, `sun_full_blue.png`, `logo.svg` und `components/icons/*` fehlen. |
| 5 Datenmodell | `server/database.js` gegen `requiredClasses.json` (Parse-Schema von TradeNote), Trade-Objektfelder gegen `addTrades.js` | siehe A3-25, A3-26 |
| 6 Historie | `git rev-list --max-parents=0`, Prüfskript gegen `git archive 6ab0e6d` und `git archive e7c6709`, Update-/Installpfade gelesen | siehe A3-27 bis A3-31 |
| 7 Abhängigkeiten | `package.json` beider Projekte, Importsuche je Paket | siehe A3-32 bis A3-34 |

Grenzen: Gegen frühere TradeNote-Stände (vor `56eb096`) wurde nicht verglichen. Der
Fork begann am 15.02.2026 und damit nach dem 14.04.2025, also auf genau diesem Stand.
Übersetzte **Code**-Kommentare und übersetzte Programmlogik findet ein Token-Vergleich
nur, wenn die Form gleich geblieben ist. Dagegen hilft nur die Clean-Room-Regel, und
die wurde eingehalten (Neubau durch Agenten ohne Zugriff auf die Altdateien, siehe
`HERKUNFT.md`).

## Befunde

Fundstellen „TN" beziehen sich auf TradeNote `56eb096`. Aufwand: klein = unter einer
Stunde, mittel = halber bis ganzer Auftrag, gross = eigener Auftrag mit
DB-Migration.

### Wörtlich und Methode

| ID | Fundstelle V2 | Fundstelle TN | Art | Befund | Bewertung | Aufwand |
|---|---|---|---|---|---|---|
| A3-01 | 295 Dateien, Schwerpunkt `src/views/Nachrichten.vue` (92), `Daily.vue` (36), `HypeRadar.vue` (31) | verteilt, v. a. `src/assets/style-dark.css`, `utils/charts.js`, `stores/globals.js` | wörtlich | 1 439 gleiche Zeilen in 91 verschiedenen Formen. Einzeln neu bewertet: **CSS-Eigenschaft** 1 024 (22 Formen, z. B. `align-items: center;` 418×; die längsten `transform: translate(-50%, -50%);`, `padding-right: 1.5rem;`); **Import** 192 (`import axios from 'axios'` 104×, dayjs-Plugins, Vite/Router, `import DashboardLayout from '../layouts/Dashboard.vue'`, `import Screenshot from '../components/Screenshot.vue'`); **Gerüst Vue/Router/Vite** 165 (`defineProps({` 96×, `onMounted(async () => {` 31× …); **JS-Standardform** 20; **ECharts/Quill-Optionen** 19; **Datenbegriff** 19 (`export const trades = reactive({})` …, `excursion.stopLoss/maePrice/mfePrice = null` in `Daily.vue:585-587`, gleiche Reihenfolge wie TN `Daily.vue:550-553`). | **generisch-akzeptabel**: Eine Eigenschaft bzw. ein Import hat genau eine Schreibweise. Die Datenbegriffe sind DB-Namen (A3-25). Die Importzeilen mit Dateinamen sind nur gleich, weil die Dateinamen gleich sind (A3-17). Ausnahme: A3-02. | – |
| A3-02 | `index.mjs:150` `setupApiRoutes(app);`, `server/api-routes.js:220` | `index.mjs:63` (Definition), `:484`, `:507` | Bezeichner | Steht in `AKZEPTIERT` als „JavaScript-Standardform". Es ist aber TradeNotes eigener Funktionsname für dasselbe (alle API-Routen an `app` hängen), kein Idiom. | **sollte weg** (umbenennen, Muster aus `AKZEPTIERT` streichen) | klein |
| A3-03 | `scripts/herkunft-pruefen.mjs` | – | Methode | Das Skript (a) prüft nur js/mjs/vue/css/html, i18n-JSON, Markdown und Shell nicht; (b) zählt TradeNotes mitgelieferte Fremdbibliothek `codemirror-graphql` als Vergleich mit (`for (const line of lines) {` stammt von dort, nicht von TradeNote); (c) vergleicht keine Namen. Dadurch sieht es A3-05 bis A3-17 und A3-21 grundsätzlich nicht. | **sollte** erweitert werden: Namensabgleich wie in diesem Audit, alle Textdateien, `codemirror-graphql` ausschliessen | klein |

### Umformuliert

| ID | Fundstelle V2 | Fundstelle TN | Art | Befund | Bewertung | Aufwand |
|---|---|---|---|---|---|---|
| A3-04 | `src/utils/journal/import.js:187-199` (MFE-Schleife) | `src/utils/addTrades.js:788-791` | umformuliert | `for (let i = s; i <= f; i++) { if (lang && reihe[i].h > trade.exitPrice && reihe[i].h > m) m = reihe[i].h …` entspricht `for (let i = startIndex; i <= endIndex; i++) { if (trde.strategy == "long" && ohlcvSymbol[i].h > trde.exitPrice && ohlcvSymbol[i].h > mfePrice) …`. Gleiche Bedingung, andere Namen. Auch der Marktschluss über `marketCloseTime`/`timeZoneTrade` ist gleich. | **generisch-akzeptabel**: Die Bedingung *ist* das Verhalten, und das legt der Golden Master fest. Dazu gehört auch die Eigenart `h > exitPrice`, die als Altfehler bewusst nachgebaut ist (`docs/spec/journal-kern.md` §7). Eine Schleife über Kerzen mit Max-Vergleich hat keine andere sinnvolle Form. Die Namen fallen unter A3-11. | – |
| A3-05 | `src/utils/journal/tagebuch.js:123-220` (`useFilterSuggestions`, `useFindHighestIdNumber`, `useFindHighestIdNumberTradeTags`, `useTradeTagsChange`, `useFilterTags`, `useToggleTagsDropdown`, `useResetTags`), `:267-280` (`useDailySatisfactionChange`, `useUpdateDailySatisfaction`), `useGetTagInfo` (20 Stellen in 9 Dateien) | `src/utils/daily.js:71-91`, `:169`, `:299-520` | umformuliert / Struktur | Der Code im Inneren ist neu (Hilfsfunktionen `haengeTagAn`, `hoechsteNummer`). Gleich geblieben sind **Funktionsnamen, Aufteilung in dieselben sieben Funktionen, Parameter-Protokoll** (`'add'` / `'addFromDropdownMenu'` / `'remove'`), die Zustandsnamen (`tagInput`, `showTagsList`, `filteredSuggestions`, `tradeTags`, `newTradeTags` → `neueTradeTags`) und die Folge „push → geändert-Flag → Speichern-Flag → Eingabe leeren → Index auf −1 → Liste zu". Der Token-Vergleich findet `tradeTags.push(neu) neueTradeTags.push(neu) tradeTagsGeaendert.value = true speichernNoetig.value = true tagInput.value = ''} } gewaehlterTagIndex.value = -1 showTagsList.value =` gegen TN `daily.js:370-384`. | **sollte weg**: Kein Ausdruck im Sinn einer Kopie, aber die erkennbarste verbliebene TradeNote-Schnittstelle. Neu schneiden (eine Tag-Eingabe-Komponente mit eigenem Zustand) statt nur umbenennen. `tag_<n>` als ID-Schema bleibt (Daten, A3-26). | mittel |
| A3-06 | `src/views/Daily.vue:380-385` | `src/views/Daily.vue:135-141` | umformuliert | `if (tradeTagsGeaendert.value) { await Promise.all([speichereVerfuegbareTags(), speichereTags()]); await Promise.all([ladeTags(), ladeVerfuegbareTags()]); baueTagListe() }` entspricht `useUpdateAvailableTags/useUpdateTags` → `useGetTags/useGetAvailableTags` → `useCreateAvailableTagsArray`. | **generisch-akzeptabel**: Speichern, dann neu laden, dann Liste bauen ist der Ablauf, den die Spezifikation verlangt. Die Namen sind hier schon eigene. | – |
| A3-07 | `src/views/Daily.vue:104` `checkDate(td, zeit)`, `:539` `clickTradesModal(karte, alt, neu)` | `src/views/Daily.vue:387` `checkDate(param1, param2)`, `:112` `clickTradesModal(param1, param2, param3)` | Bezeichner / Struktur | Gleiche Namen. Gleiche Idee: *eine* Funktion für Öffnen/Blättern/Schliessen mit drei Positionsargumenten, beginnend mit „Markierung offen → `alert` → Abbruch, sonst Setups-Spinner an, Ausstehendes speichern". | **sollte weg**: umbenennen und in `oeffneTrade`/`blaettere`/`schliesseTrade` aufteilen (die Aufrufer heissen schon so) | klein |

### Bezeichner

| ID | Fundstelle V2 | Fundstelle TN | Art | Befund | Bewertung | Aufwand |
|---|---|---|---|---|---|---|
| A3-08 | `src/utils/screenshots.js:214-478` (`useSetupImageUpload`, `compressImage`, `useSetupMarkerArea`, `useDeleteScreenshot`, `useSelectedScreenshotFunction(index, quelle, daten)`), `src/stores/journal/screenshots.js:13-23` (`selectedScreenshotSource`, `expandedSource`, `expandedId`, `expandedScreenshot`, `resizeCompressImg`, `resizeCompressMaxWidth/MaxHeight/Quality`), `rahmen/ScreenshotVollbild.vue` (`selectedScreenshotIndex`, `selectedScreenshot`, `getMore`) | `src/utils/screenshots.js:185-591`, `src/stores/globals.js:3161-3173` | Bezeichner / Struktur | Die Datei ist neu (S8), behält aber TradeNotes Funktions- und Zustandsnamen samt Aufteilung. `screenshot.dateUnix = dayjs.tz(screenshot.date, timeZoneTrade.value).unix()` (`:306`) ist bis auf Leerraum TN `:414` (17 Tokens; einzige sinnvolle Form, aber mit TN-Namen). `useSetupMarkerArea` nennt noch markerjs2, das es nicht mehr gibt. | **sollte weg** (umbenennen; alles reiner Zustand, kein gespeicherter Schlüssel). `resizeCompress*` setzt heute niemand (`screenshots.js:240`), also toter Rest: löschen | mittel |
| A3-09 | `src/utils/journal/format.js` und 32 Dateien, 164 Stellen: `useTwoDecCurrencyFormat` (56), `useThousandCurrencyFormat` (27), `useDateCalFormat` (20), `useXDecCurrencyFormat` (19), `useXDecFormat` (18), `useCreatedDateFormat` (12), `useThousandFormat`, `useTimeFormat`, `useChartFormat`, `useCapitalizeFirstLetter`, `useOneDecPercentFormat`, `useHourMinuteFormat`, `useTwoDecFormat`, `useDateCalFormatMonth`, `useTimeDuration`, `useSwingDuration`, `useDecimalsArithmetic`, `useStartOfDay`, `useMonthFormat`, `useDateTimeFormat` | `src/utils/utils.js:1253-1367` | Bezeichner | 20 Formatierer mit TradeNotes Namen. Die Umsetzung ist neu (`Intl.NumberFormat`-Fabriken), die Namensfamilie mit ihrer eigenwilligen Bildung (`TwoDec`, `XDec`, `DateCal`) ist TradeNotes Handschrift. | **sollte weg** (mechanisch umbenennen, z. B. `geld2`, `geldX`, `datumKalender`) | mittel |
| A3-10 | `src/utils/journal/diagramme/index.js:27-28`, `gestaltung.js:103-106`; `views/AgentPerformance.vue:21` | `src/utils/charts.js:20-24`, `:297`, `:392`, `:609`, `:667`, `:1083`, `:1763` | Bezeichner | `usePieChart`, `useBarChart`, `useLineBarChart`, `useDoubleLineChart`, `useBarChartNegative`, `useCandlestickChart` sowie die Farbkonstanten **`cssColor87`, `cssColor60`, `cssColor38`, `blackbg5`**. Das sind TradeNotes Variablennamen, deren Zahlen seine Farbstufen meinen (`rgba(255,255,255,0.87)`, `hsl(0,0%,5%)`); in V2 zeigen sie auf Tokens. | **sollte weg** | klein |
| A3-11 | `src/utils/journal/import.js`, `src/views/AddTrades.vue`, `components/import/ImportVorschau.vue`, `src/utils/__selftest-mfe-pfade.mjs` + `fixtures/mfe-pfade-golden.json`; `stores/journal/filter.js:88` `uploadMfePrices`, `stores/journal/import.js:23` `marketCloseTime` | `src/utils/addTrades.js:33-1988`, `globals.js:99`, `:3093` | Bezeichner | `useGetMFEPrices`, `useGetOHLCV`, `useCreateOHLCV`, `useUpdateMfePrices`, `useUploadTrades`, `useGetExistingTradesArray`, `mfePrices`, `uploadMfePrices`, `marketCloseTime`, `tradeAccounts`, `ohlcv`. CLAUDE.md und Golden Master führen die Namen. `stype_in`/`dataset` sind Parameter der Databento-API (funktional, bleiben). | **sollte weg**; Golden Master danach mit gleichen Werten neu einfrieren (nur Schlüssel) | mittel |
| A3-12 | `src/utils/journal/app.js:48` **`useInitParse`** (Aufruf `layouts/Dashboard.vue:38,110`, Kommentar `views/Settings.vue:119`), `useGetCurrentUser`, `usePageRedirect`, `useEditItem` (`sessionStorage 'editItemId'`), `useExport`; `stores/app/rahmen.js:16-57` (`timeZones`, `stepper`, `itemToEditId`, `idCurrent`, `idPrevious`, `idCurrentType/Number`, `idPreviousType/Number`), `stores/app/laden.js:19` (`spinnerSetupsText`), `Daily.vue` `spinnerSetups`, `Screenshots.vue` `spinnerLoadMore`, `pageId` (91), `screenType`, `windowIsScrolled`, `queryLimit`, **`timeZoneTrade` (71 Stellen, 28 Dateien)**, `selectedDashTab`, `daysBack`, `daysMargin`, `dashboardIdMounted`, `renderData`, `currentUser` | `src/utils/utils.js:160-1205`, `src/stores/globals.js:7-66`, `:3081-3082`, `:3380` | Bezeichner | Das Gerüst des Frontends trägt noch TradeNotes Zustandsnamen. **`useInitParse` nennt Parse**, die Datenbank von TradeNote, die es hier nie gab. Er ist ein reiner Alias auf `useInitApp`. | **`useInitParse` muss weg** (Alias löschen, Aufrufer auf `useInitApp`). Rest **sollte weg**. `currentUser` und `pageId` sind sehr allgemein und dürfen bleiben, wenn man Aufwand sparen will. | klein (Parse) / mittel (Rest) |
| A3-13 | `src/components/journal/FilterLeiste.vue:11-16`, `:129-143`; `stores/filters/options.js:3`, `stores/filters/selection.js:3`, `stores/journal/filter.js` | `src/components/Filters.vue:4`, `src/stores/globals.js:3307-3379` | Bezeichner / umformuliert | Die Importliste `positions, timeFrames, ratios, grossNet, plSatisfaction, selectedPositions, selectedTimeFrame, selectedRatio, selectedAccounts,` steht in **derselben Reihenfolge** wie in TN `Filters.vue:4` (19 Tokens, streng gleich). Dazu `selectedDateRange`, `selectedPeriodRange`, `selectedMonth`, `selectedAccount`, `selectedGrossNet`, `selectedPlSatisfaction`, `selectedTags`, `selectedBroker` (78), `periodRange`, `filteredSuggestions`. | **sollte weg**: Variablen umbenennen. Die gleichnamigen **`localStorage`-Schlüssel** bleiben oder bekommen eine einmalige Übernahme, sonst verlieren Installationen ihre Filter. | mittel |
| A3-14 | `src/stores/journal/tagebuch.js:14-38` (`tradeNoteId`, `tradeNoteDateUnix`, `tradeTagsDateUnix`, `tradeTagsId`, `tradeExcursionId`, `tradeExcursionDateUnix`, `excursion`, `tagInput`, `showTagsList`); `src/utils/journal/laden.js:166,189` (`useDeleteTrade`, `useDeleteExcursions`) | `src/stores/globals.js:3108-3147`, `src/utils/trades.js:1299,1322` | Bezeichner | Wie A3-05, Zustandsseite. `HERKUNFT.md` begründet `tradeNoteId` als „Notiz zum Trade, nicht der Projektname". Inhaltlich stimmt das, es ist aber TradeNotes Name. | **sollte weg** (zusammen mit A3-05) | klein |
| A3-15 | `src/components/SeiteLaedt.vue:6`, `src/views/AddTrades.vue:435`, `src/views/AddExcursions.vue:243` | `src/stores/globals.js:45` `spinnerLoadingPage` | Bezeichner + **Funktionsfehler** | S11 hat `spinnerLoadingPage` → `seiteLaedt` umbenannt, aber in drei Templates nicht: `v-show="spinnerLoadingPage"` bzw. `v-if=…` greift auf eine nicht importierte Variable. Vue wertet das als `undefined`, **die Lade-Anzeige erscheint nie** (Seiten-Overlay, Import, MFE-Eintrag). | **muss weg** (auf `seiteLaedt` stellen) | klein |
| A3-16 | `src/assets/design/journal.css`, `hilfen.css` + Vorlagen: `dailyCard` (86 Stellen / 11 Dateien), `redTrade` (54/19), `greenTrade` (53/19), `pointerClass` (32/10), `chartClass` (15/6), `chartIdCardClass` (7/5) | `src/assets/style-dark.css` (z. B. `.dailyCard` bei `:724`) | Bezeichner | Die Regeln sind neu (S9, Tokens), die Klassennamen sind TradeNotes und stehen auch in CLAUDE.md und README. | **sollte weg** (mechanisch umbenennen, z. B. `karte`, `gewinn`/`verlust`, `klickbar`, `diagramm`) | klein–mittel |

### Struktur

| ID | Fundstelle V2 | Fundstelle TN | Art | Befund | Bewertung | Aufwand |
|---|---|---|---|---|---|---|
| A3-17 | Dateinamen `src/views/{AddExcursions,AddTrades,Calendar,Daily,Dashboard,Playbook,Screenshots,Settings}.vue`, `src/components/{Calendar,Screenshot,NoData}.vue`, `src/layouts/Dashboard.vue`; Layout-Muster `src/App.vue:28` `<component … :is="$route.meta.layout \|\| 'div'">` + `meta: { layout: DashboardLayout }` (`router/routen.js:29`); Routen `/dashboard /calendar /daily /diary /screenshots /playbook /addTrades /addDiary /addPlaybook /addScreenshot /addExcursions /imports /settings` | `src/views/*`, `src/components/*`, `src/App.vue:4`, `src/router/index.js` | Struktur | 8 von 17 Ansichtsnamen, 3 Komponentennamen, der Layout-Mechanismus samt Fallback `'div'` und **13 von 17 Pfaden** (im camelCase-Stil `addTrades`) sind gleich. Das Gerüst wurde in S9 clean-room neu geschrieben, die Topologie blieb, damit Lesezeichen funktionieren. | **sollte weg**: Dateien und Layoutzeile umbenennen (nur intern). Routen optional mit neuem Pfad plus Weiterleitung vom alten, sonst brechen Lesezeichen. `/:unbekannt` → `/` gibt es schon. | mittel |
| A3-18 | `server/api-routes.js:155,654,689` (Abbildung `id` ↔ `objectId`, 213 Stellen in 37 Dateien); `src/utils/db.js:162-289` (`dbFind(className, {equalTo, greaterThanOrEqualTo, lessThan, descending, limit})`, Kommentar „Replaces: Parse.Object.extend(className) + new Parse.Query()") | Parse-SDK (Abfrage-API), `requiredClasses.json` | Struktur / Datenformat | Die Datenschicht ahmt die Abfrage-API des Parse-SDK nach und liefert `objectId` wie Parse. | **generisch-akzeptabel**: Das ist die öffentliche API einer Bibliothek (Parse SDK, Apache-2.0/BSD), kein Ausdruck von TradeNote. `objectId` ist das Datenformat zwischen Frontend und Backend. Wer es loswerden will: `objectId` → `id` in 37 Dateien plus Golden Master, ohne DB-Migration (die Spalte heisst schon `id`). Den Parse-Kommentar in `db.js` sollte man trotzdem streichen. | gross (objectId) / klein (Kommentar) |
| A3-19 | ca. 297 Logzeilen `console.log(' -> …')` / `` ` -> …` `` in ~40 Dateien, v. a. `server/bitunix-api.js`, `bitget-api.js`, `pionex-api.js`, `src/utils/incoming.js`, `views/einstellungen/*` | 125 Logzeilen im Stil `" -> "` / `"  --> ERROR "` | Struktur (Stil) | Die Pfeil-Einrückung in Logmeldungen ist TradeNotes Gewohnheit. Das Crypto Trading Journal hat sie in seine eigenen Dateien übernommen (Börsen-APIs, die TradeNote nie hatte). | **generisch-akzeptabel**: ein Stilmerkmal, kein Ausdruck. Lässt sich beim Umbenennen nebenbei vereinheitlichen. | klein |

### Texte und Assets

| ID | Fundstelle V2 | Fundstelle TN | Art | Befund | Bewertung | Aufwand |
|---|---|---|---|---|---|---|
| A3-20 | `docs/spec/*.md` (7 525 Zeilen; über 100 verschiedene TradeNote-Namen, z. B. `useInitParse`, `useMountAuswertung`, `clickTradesModal`), `src/utils/fixtures/*-golden.json` (Schlüssel), `CLAUDE.md`/`README.md` (Klassennamen) | Altdateien (gelöscht) | Text | Die Spezifikationen beschreiben das Verhalten der TradeNote-Altdateien. Sie enthalten keinen Code (0 Code-Blöcke, 0 gleiche Zeilen), aber deren Namen und Gliederung. Sie liegen im Repo und gehen damit über git an Kunden (A3-28); im Docker-Image fehlen sie (`.dockerignore: docs/`). | **sollte weg** aus dem ausgelieferten Stand: als Clean-Room-Beleg ausserhalb des Produkt-Repos aufbewahren (zusammen mit dem Altrepo, A3-27). | klein |
| A3-21 | `src/i18n/locales/en.json` `daily.volTooltip`, `de.json:1738` (Übersetzung), angezeigt in `src/views/Daily.vue:923` | `src/views/Daily.vue:947` (`data-bs-title`) | Text (wörtlich / übersetzt) | „Total number of securities during the trade (bought + sold or shorted + covered)". Ein eigener, formulierter Hilfesatz von TradeNote, wörtlich im Englischen und übersetzt im Deutschen („Gesamtanzahl der Securities …"). Für Krypto-Futures ist er obendrein falsch (keine Securities, kein „covered"). | **muss weg** (neu formulieren, beide Sprachen) | klein |
| A3-22 | `en.json` `common.screenshotAddImage` „Please add a screenshot.", `filters.endBeforeStart`, `dashboard.plRatio` „P/L Ratio", `dashboard.mfePlRatio` „MFE P/L Ratio", `screenshots.loeschenFrage` „Are you sure?"; Kennzahlnamen `APPT`, Profitfaktor | `utils/screenshots.js`, `components/Filters.vue`, `views/Dashboard.vue`, `views/Playbook.vue` | Text | Gleich, aber kurz und üblich. APPT/P-L-Ratio/MFE sind Fachbegriffe des Tradings. | **generisch-akzeptabel** | – |
| A3-23 | alle versionierten Dateien, `public/`, `src/assets/` | `src/assets/{astronaut.png,sun_full_blue.png,logo.svg,base.css,main.css,style-dark.css}`, `src/components/icons/*` | Assets | Keine Datei mit gleichem SHA-256, keine der TradeNote-Grafiken vorhanden, keine Webschriften. Logo und Icons sind eigen (`scripts/logo-zeichnen.mjs`, `Symbol.vue`). | **ok** | – |
| A3-24 | `.gitignore:9,13,14`, `server/db-config.js:17-19`, `docker-entrypoint.sh:19-23`, `server/crypto.js:11`, `server/reencrypt-keys.mjs:43` (`tradenote-${host}-${user}-v1`), `server/auth.js` (`tn_session_v1`); README und Doku sonst | – | Text / Bezeichner | README, Handbuch und Doku haben keine Zeile ≥ 20 Zeichen mit TradeNote gemeinsam. Der Projektname steht nur noch in den von `HERKUNFT.md` begründeten Verträglichkeitsnamen. | **generisch-akzeptabel** (kein Ausdruck, technische Kennung). Für „alles muss weg" ginge der Seed: neue Ableitung + einmalige Umverschlüsselung mit dem vorhandenen `reencrypt-keys.mjs`. `tradenote.db` fällt weg, sobald keine Installation mehr diese Datei hat. | mittel |

### Datenmodell

| ID | Fundstelle V2 | Fundstelle TN | Art | Befund | Bewertung | Aufwand |
|---|---|---|---|---|---|---|
| A3-25 | `server/database.js:306-450`: Tabellen `trades`, `diaries`, `screenshots`, `playbooks`, `satisfactions`, `tags`, `notes`, `excursions` (8 der 12 Parse-Klassen); Spalten `trades.{date,dateUnix,executions,trades,blotter,pAndL,cashJournal,openPositions,video}`, `screenshots.{name,symbol,side,originalBase64→original,annotatedBase64→annotated,markersOnly,maState,dateUnix,dateUnixDay}`, `satisfactions.{dateUnix,tradeId,satisfaction}`, `tags.{dateUnix,tradeId,tags}`, `notes.{dateUnix,tradeId,note}`, `excursions.{dateUnix,tradeId,stopLoss,maePrice,mfePrice}`, `diaries.diary`, `playbooks.playbook`, `settings.{timeZone,accounts,tags,apis,layoutStyle,avatar}` (= Parse `_User`) | `requiredClasses.json` | Datenmodell | Die Auswahl der Tabellen und die Spaltennamen der Journal-Tabellen sind Parse-Schema von TradeNote, 1 : 1 als SQL-Tabellen. Alle übrigen rund 60 Tabellen (Radar, Chart, Strategie, Live …) sind eigen. | **generisch-akzeptabel**: Einzelne Spaltennamen sind funktional und meist Fachwörter (`stopLoss`, `mfePrice`, `dateUnix`). Ein Schema-Schutz als Sammlung wäre allenfalls für die *Anordnung* denkbar, und die ist bei acht Tabellen „ein Objekt je Tag/Trade" naheliegend. Am ehesten TradeNote-typisch: `pAndL`, `satisfactions`, `excursions`, `blotter`. **Kosten eines Umbenennens:** Migration v30 für SQLite und PostgreSQL (`renameTable`/`renameColumn`; SQLite ≥ 3.25 kann das), Umbenennen in `api-routes.js`-Whitelists, `backup-api.js` (alte Backups brauchen eine Übersetzung beim Import), KI-Werkzeuge (`ai-agent-tools.js`, Abfragen per Tabellenname), ESP32-/Widget-Endpunkte, alle Frontend-Aufrufe `dbFind('trades' …)`, beide Golden Master. **Live-DB:** auf der NAS-PostgreSQL vorher Sicherung, Probelauf gegen die V2-Kopie (`scripts/v2-container.sh`), dann im Wartungsfenster. Das ist ein eigener Auftrag mit echtem Risiko für wenig rechtlichen Gewinn. | gross |
| A3-26 | Felder im Trade-JSON (`trades.trades`, `blotter`, `pAndL`), gebaut in `src/utils/quickImport.js` und `src/utils/journal/tagesrechnung.js:7-12`: `td`, `strategy`, `buyQuantity`, `sellQuantity`, `commission`, `grossProceeds`, `grossWins`, `grossLoss`, `grossSharePL`, `grossSharePLWins/Loss`, `grossWinsCount`, `grossLossCount`, `grossWinsQuantity` … dieselben mit `net…`, `highGrossSharePLWin/Loss`, `highNetSharePLWin/Loss`, `executionsCount`, `tradesCount`, `openPosition`; ID-Schemata `t<unix>_…` (Trade), `tag_<n>`, `group_0` | `src/utils/addTrades.js` (z. B. `:962-966`, `:1074`, `:1626-1640`) | Datenmodell | 41 Feldnamen der gespeicherten Trade-Objekte stammen von TradeNote, ebenso das Präfix `t` der Trade-IDs. `…SharePL` (Gewinn je *Aktie*) ergibt bei Krypto keinen Sinn mehr und zeigt am deutlichsten, woher das kommt. | **generisch-akzeptabel** (Datenformat, funktional). **Kosten eines Umbenennens:** jede Zeile in `trades` neu schreiben (JSON-Spalten `trades`, `blotter`, `pAndL` je Tag), dazu `bitunix-api.js`/`bitget-api.js`/`pionex-api.js` (bauen die Felder serverseitig), `journal-bridge.js`, `esp32-api.js`, `ai-agent-tools.js`, Diagramme, Golden Master, Backup-Import alter Dateien. Das ist der grösste denkbare Umbau, nur sinnvoll zusammen mit A3-25 und einem Exportformat mit Versionsnummer. | gross |

### Historie und Auslieferung

| ID | Fundstelle V2 | Fundstelle TN | Art | Befund | Bewertung | Aufwand |
|---|---|---|---|---|---|---|
| A3-27 | Wurzel `6ab0e6d` „Ausgangsstand aus Crypto Trading Journal (master 7fb0326)", 715 Dateien | ganzer Stand | Historie | Einzige Wurzel des Repos (`git rev-list --max-parents=0 --all`). Das Prüfskript gegen `git archive 6ab0e6d`: **6 463 gleiche Zeilen (5,09 %), davon 4 744 nicht generisch** (alter Journal-Kern `addTrades.js`, `charts.js`, `style-dark.css`, `Daily.vue` …). Die Folge-Commits S3–S11 löschen das wieder. Wer das Repo hat, hat damit auch TradeNote-Code in Gestalt der GPL-3.0-Altfassung. Alle 64 Commits sind von Mouses007; fremde Autoren gibt es nicht. | **muss weg** aus allem, was das Haus verlässt. Siehe „Saubere Lösung". | mittel |
| A3-28 | `server/update-api.js:537` `git fetch ${GIT_URL} master`, `install.sh:397`, `install-mac.command:356`, `install.bat:480`, `update.sh:40`, `update-mac.command:44`, `update.bat:51` | – | Historie / Auslieferung | Installation und Update holen per `git fetch … master` **ohne `--depth`**, also die ganze Historie samt `6ab0e6d`, `docs/spec/` und `HERKUNFT.md`. Jede Kundeninstallation ausserhalb von Docker hätte den TradeNote-Ausgangsstand im `.git`-Ordner. | **muss weg**: `git fetch --depth 1 … master` (und beim Rollback auf den gespeicherten Commit darauf achten, dass er nach einem flachen Fetch noch da ist, also vor dem Fetch sichern). Nach der neuen Wurzel bekommen bestehende Test-Installationen einen frischen Klon. | klein |
| A3-29 | Branch `spaeter/scharfer-handel` (lokal und `origin`), Spitze `e7c6709` | – | Historie | Die Spitze ist **genau** der master-Commit `e7c6709` (S11 fertig, vor S13); `git merge-base` = `e7c6709`. Der Branch enthält also (a) die ganze Historie ab `6ab0e6d` (A3-27) und (b) im Stand selbst dieselben Reste wie master zu S11: Prüfskript 1 419 / 129 464 (1,10 %), alle generisch, aber auch alle Namens- und Strukturbefunde A3-05 bis A3-21. Der Order-Code, um den es dort geht (`server/execution/*`, Stopp-Wächter, Freigabekette), ist Eigenbau ohne TradeNote-Bezug. | **muss weg** in dieser Form: nach der neuen Wurzel den Inhalt als einen Commit auf die neue Wurzel setzen (Diff `049b32a`/`a0a847b` rückwärts, nur `server/execution/` u. a.) oder als Patch-Datei neben `docs/SPAETER-SCHARFER-HANDEL.md` ablegen. Die Namensreste gehen mit, wenn er später zurückkommt; dann die Umbenennungen aus 3. nachziehen. | klein–mittel |
| A3-30 | 18 lokale `claude/*`-Branches (S3–S15, A1–A4), `origin/master`, `origin/spaeter/scharfer-handel`; Klone auf NAS/Container | – | Historie | Jeder Branch hängt an `6ab0e6d`. Tags gibt es keine. | **muss weg** (nach dem Schnitt löschen bzw. auf die neue Wurzel neu ziehen; Worktrees aufräumen) | klein |
| A3-31 | `.dockerignore` (`.git`, `docs/`, `CLAUDE.md`), Release-Workflow ghcr | – | Auslieferung | Das Docker-Image enthält weder Historie noch Spezifikationen. Der minifizierte Build enthält Namen nur, soweit sie nicht verkürzt werden (CSS-Klassen A3-16, Routen A3-17, i18n-Texte). | **ok** | – |

### Abhängigkeiten

| ID | Fundstelle V2 | Fundstelle TN | Art | Befund | Bewertung | Aufwand |
|---|---|---|---|---|---|---|
| A3-32 | `package.json` `"lodash": "^4.18.1"`; CLAUDE.md „Other key libs: … lodash" | `package.json` `"lodash": "^4.17.21"`, genutzt in `utils/trades.js` (`_.groupBy`) | Abhängigkeit | In `src/`, `server/`, `shared/`, `scripts/`, `index.mjs` gibt es **keinen einzigen Import** von lodash. Das Paket ist nur noch da, weil TradeNote es mitbrachte; die Spezifikation erlaubte es dem Neubau, der es dann nicht brauchte. | **sollte weg** (Abhängigkeit streichen, `node scripts/drittlizenzen.mjs`, CLAUDE.md/README berichtigen) | klein |
| A3-33 | `calendarize ^1.1.1` (`utils/journal/kalender.js:5`), `http-proxy ^1.18.1` (`index.mjs:277`, Vite-Weiterleitung im Dev-Modus), `sortablejs ^1.15.2` (`composables/useKachelRaster.js`), `express ^4.19.2`, `vue-router ^4.4.3`, `quill ^2.0.2`, `papaparse` (nur Databento-CSV), `axios`, `dayjs`, `echarts` | `package.json` mit **wörtlich gleichen Versionsangaben** bei `calendarize`, `http-proxy`, `sortablejs`, `express`, `vue-router`, `quill` | Abhängigkeit | Von TradeNote mitgebracht, aber alle in eigenem Code benutzt. Die gleichen Versionsangaben verraten die Herkunft (A3-34). | **generisch-akzeptabel** (Lizenzen MIT/BSD; Nutzung eigen). `calendarize` (ein Aufruf) und `papaparse` (ein CSV-Format) könnte man mit wenig Aufwand durch eigenen Code ersetzen, nötig ist es nicht. | – |
| A3-34 | `package.json:9,11,18,22,24,33,36,39` | `package.json` gleiche Zeilen | Abhängigkeit (Text) | 8 Zeilen gleich: `"start": "node index.mjs"`, `"build": "vite build"` und die sechs Versionsangaben oben. | **generisch-akzeptabel**; beim nächsten `npm update` verschwinden die Versionsgleichheiten von selbst | – |

## Historie: Bedeutung und saubere Lösung

**Was die Historie bedeutet.** Rechtlich hängt die eigene Lizenz am ausgelieferten
Stand. Ein Repo mit `6ab0e6d` enthält aber TradeNote-Code unter GPL-3.0, und wer
dieses Repo weitergibt (über das git-Update, A3-28, oder einen Zugang zum privaten
Repo), gibt diesen Code mit weiter. Dann muss er nach GPL-3.0 auch für diese Teile die
Rechte einräumen. Ein späteres Löschen in einem Commit ändert daran nichts, solange
der Commit erreichbar ist. Für „alles muss weg" reicht der saubere Stand deshalb
nicht; die Historie muss aus dem ausgelieferten Repo raus.

Gleichzeitig ist die Historie der **Beleg** für den Clean-Room-Neubau: Spezifikation
→ Neubau → Löschen der Altdateien, mit Golden Master dazwischen. Den Beleg darf man
nicht vernichten, nur nicht ausliefern.

**Saubere Lösung (nicht ausgeführt):**

1. *Beleg sichern.* `git bundle create autarktrade-bis-<datum>.bundle --all` aus dem
   Hauptverzeichnis, SHA-256 notieren, offline und ausserhalb jedes Repos ablegen
   (mit `docs/spec/`, `HERKUNFT.md` und diesem Bericht). Optional mit Zeitstempel
   eines Dritten (Notar oder RFC-3161-Dienst).
2. *Neue Wurzel.* Aus dem fertigen master (nach den Umbenennungen aus „Was zu tun
   wäre", sonst wandern die Namensreste in die neue Wurzel mit):
   `git checkout --orphan neu master` → `docs/spec/` und Altlasten entfernen →
   `git commit -m "AutarkTrade 4.0.0 – Ausgangsstand"`. Kein Bezug zu einem alten
   Commit.
3. *Neues Repo statt Umschreiben.* Ein **neues privates GitHub-Repo** anlegen und nur
   die neue Wurzel hineinschieben. Ein `push --force` ins bestehende Repo genügt
   nicht: GitHub hält alte Objekte über Pull-Request-Referenzen, Forks und den Cache
   weiter erreichbar, bis der Support sie entfernt. Das alte Repo danach archivieren
   bzw. löschen, nachdem das Bundle geprüft ist (`git bundle verify`).
4. *Paketquelle umstellen.* `server/update-api.js`, `scripts/paketquelle.sh/.bat`
   und die Installer auf die neue Adresse, und zwar mit `git fetch --depth 1`
   (A3-28). Die privaten Registry-Images sind nicht betroffen (A3-31).
5. *Branches.* `spaeter/scharfer-handel` als Commit auf die neue Wurzel neu
   aufsetzen (A3-29); die `claude/*`-Branches und Worktrees nicht übernehmen.
6. *Bestehende Installationen* (NAS, V2-Testcontainer, Rechner mit git-Installation):
   frisch klonen bzw. `.git` ersetzen; die Daten (DB, `db-config.json`) liegen
   ausserhalb von git und bleiben.
7. *Prüfen.* `git rev-list --max-parents=0 --all` = genau die neue Wurzel;
   `node scripts/herkunft-pruefen.mjs` auf ihr; `git log --all -- src/utils/addTrades.js`
   leer.

Das alte öffentliche Crypto-Trading-Journal-Repo (GPL-3.0, mit TradeNote) bleibt davon
unberührt; `HERKUNFT.md` hält schon fest, dass dessen Fassungen unter GPL bleiben.

## Anhang: verbliebene TradeNote-Namen im Überblick

`use…`-Funktionen (55): useTwoDecCurrencyFormat, useThousandCurrencyFormat,
useGetTagInfo, useDateCalFormat, useXDecCurrencyFormat, useXDecFormat,
useCreatedDateFormat, useGetMFEPrices, useSelectedScreenshotFunction, useGetOHLCV,
useThousandFormat, useTimeFormat, useCandlestickChart, useChartFormat,
useUploadTrades, useCapitalizeFirstLetter, useBarChartNegative, useCreateOHLCV,
useUpdateMfePrices, usePieChart, useBarChart, useOneDecPercentFormat,
useSetupMarkerArea, useHourMinuteFormat, useGetExistingTradesArray, useLineBarChart,
useTwoDecFormat, useInitParse, usePageRedirect, useDoubleLineChart,
useDeleteScreenshot, useDateCalFormatMonth, useExport, useTimeDuration,
useSwingDuration, useDecimalsArithmetic, useResetTags, useGetCurrentUser,
useFindHighestIdNumber, useFindHighestIdNumberTradeTags, useUpdateDailySatisfaction,
useEditItem, useDateTimeFormat, useMonthFormat, useStartOfDay, useDeleteTrade,
useDeleteExcursions, useFilterSuggestions, useTradeTagsChange, useFilterTags,
useToggleTagsDropdown, useDailySatisfactionChange, useSetupImageUpload
(+ `useSetupImageFile` ohne TN-Gegenstück, aber nach demselben Muster).

Weitere Funktionen und Zustände: setupApiRoutes, clickTradesModal, checkDate,
compressImage, saveTags, cssColor87/60/38, blackbg5, ohlcTimestamps/ohlcPrices/ohlcVolumes
(`utils/botChart.js:22-24`), candlestickChart, timeZoneTrade, timeZones, pageId,
screenType, windowIsScrolled, queryLimit, stepper, itemToEditId, idCurrent,
idPrevious, idCurrentType, idCurrentNumber, idPreviousType, idPreviousNumber,
spinnerSetups, spinnerSetupsText, spinnerLoadMore, spinnerLoadingPage, getMore,
dashboardIdMounted, renderData, selectedDashTab, daysBack, daysMargin, uploadMfePrices,
marketCloseTime, mfePrices, tradeAccounts, selectedBroker, selectedAccount(s),
selectedPositions, selectedTimeFrame, selectedRatio, selectedGrossNet,
selectedPlSatisfaction, selectedTags, selectedDateRange, selectedPeriodRange,
selectedMonth, positions, timeFrames, ratios, grossNet, plSatisfaction, periodRange,
filteredSuggestions, tagInput, showTagsList, tradeTags, tradeTagsDateUnix,
tradeTagsId, tradeNoteId, tradeNoteDateUnix, tradeExcursionId,
tradeExcursionDateUnix, excursion, selectedScreenshot, selectedScreenshotIndex,
selectedScreenshotSource, expandedScreenshot, expandedId, expandedSource,
resizeCompressImg, resizeCompressMaxWidth, resizeCompressMaxHeight,
resizeCompressQuality, screenshotsPagination, grossMfeR, netMfeR, probNetWins,
probNetLoss, financials, totalGrossProceeds/Wins/Loss, totalNetProceeds/Wins/Loss,
totalNetWinsCount, totalNetLossCount, totalFees, totalTrades.

## Stand nach F3 (20.10.2026)

Auftrag F3 hat alle Befunde „muss weg" und „sollte weg" ausser der Historie
(A3-27 bis A3-30, Auftrag F4) behoben. Die „generisch/akzeptabel"-Befunde wurden
neu gelesen; wo die Begründung nicht trug, ist ebenfalls umgebaut (A3-18
Kommentar, Diagramm-IDs als Nachtrag zu A3-10). Prüfskript am Ende: 1 426 von
131 665 Codezeilen gleich (1,08 %), alle generisch; 189 gemeinsame Namen und
170 Token-Läufe gesichtet und begründet (`scripts/herkunft-akzeptiert.json`),
Exit 0. Golden Master mit gleichen Werten, `npm run test:self` 147/147 grün.

| ID | Bewertung | Stand nach F3 |
|---|---|---|
| A3-01 | generisch | bleibt; Arten in HERKUNFT.md neu gezählt (CSS 1 023, Import 193, Gerüst 167, ECharts/Quill 19, JS-Standardform 12, Datenbegriff 12). |
| A3-02 | sollte weg | **behoben**: `setupApiRoutes` → `registriereApiRouten`, Muster aus `AKZEPTIERT` gestrichen (ebenso `if (currentUser.value) {`, `tradeTags.length = 0`). |
| A3-03 | sollte weg | **behoben**: Prüfskript prüft zusätzlich alle Textdateien, Namen und Token-Fenster (streng/normalisiert), ohne `codemirror-graphql`; gesichtete Ausnahmen mit Begründung in `scripts/herkunft-akzeptiert.json`, jede neue lässt es mit Code 1 enden. |
| A3-04 | generisch | bleibt (MFE-Schleife ist das Verhalten, Golden Master); Namen umbenannt (A3-11). |
| A3-05 | sollte weg | **behoben, clean-room**: Verhalten in `docs/spec/f3-tags.md` (Agent A, ohne Namen), Altcode entfernt, Neubau durch Agent B ohne Zugriff: `tagAngaben`/`tagsFuerTrade`; die tote Tag-Eingabe (Vorschläge, Hinzufügen, neue `tag_<n>`, Tageszufriedenheit setzen) nicht nachgebaut. Altfehler behoben: Bildspeichern schreibt keine Tags mehr. |
| A3-06 | generisch | entfällt: der Ablauf war Teil des neu gebauten Trade-Fensters; gespeichert wird dort nur noch die Exkursion. |
| A3-07 | sollte weg | **behoben, clean-room** (`docs/spec/f3-trade-dialog.md`): getrennte Wege `oeffneTrade`, `blaettere`, `zeigeTrade`, `schliesseTrade`, `beendeTradeFenster`; `checkDate` → `selberHandelstag`. Im Prüf-Container durchgespielt (öffnen, MFE eingeben, blättern = speichern, zurück, Esc). |
| A3-08 | sollte weg | **behoben, clean-room** (`docs/spec/f3-screenshots.md`): `src/utils/bilder/{laden,bearbeiten,vollbild}.js`, `stores/journal/bilder.js`, `rahmen/BildVollbild.vue`; `resizeCompress*` und weitere tote Teile gelöscht; sessionStorage-Schlüssel `at.bilder.seite`. Altfehler behoben: Bilder laden schaltet die Ladeanzeige des Trade-Fensters nicht mehr ab. |
| A3-09 | sollte weg | **behoben**: 20 Formatierer → `formGeld2`, `formGeld0`, `formGeldStellen`, `formZahl0/2/Stellen`, `formProzent1`, `formDatum`, `formMonat`, `formUhrzeit(Sek)`, `formDatumZeit`, `formDatumKurz`, `formMonatName`, `formDatumLang`, `formDauer(Tage)`, `formGrossAnfang`, `tagesBeginnUnix`, `addiereGenau`; Abfolge in `format.js` umgebaut. |
| A3-10 | sollte weg | **behoben**: `ringDiagramm`, `doppellinieDiagramm`, `linienBalkenDiagramm`, `balkenDiagramm`, `balkenNegativDiagramm`, `kerzenDiagramm`; `farbeText/Gedaempft/Linie/Flaeche`. Nachtrag: auch die Diagramm-IDs der Herkunft (`pieChart1…3`, `barChart1/2`, `barChartNegative<n>` mit den Lücken 5–6/8–11/15, `lineBarChart1`, `pieChart<tag>`, `doubleLineChart<tag>`) heissen jetzt `ringGewinnquote`, `balkenKennzahl`, `balkenGruppe…`, `verlaufErtrag`, `tagesRing…`, `tagesLinie…`. |
| A3-11 | sollte weg | **behoben**: `berechneMfePreise`, `holeImportKerzen`, `kerzenAusCsv`, `speichereMfePreise`, `speichereImport`, `ladeVorhandeneTradeTage`, `mfeListe`, `mfeSpeichern`, `marktSchluss`, `kalenderKonten`; Golden Master mfe-pfade nur wegen der neuen Zieladresse `/journal` neu eingefroren. |
| A3-12 | muss weg / sollte weg | **behoben**: `useInitParse` gelöscht (`starteApp`), `appEinstellungen`, `seitenId`, `tradeZeitzone`, `bildschirmTyp`, `istGescrollt`, `abfrageGrenze`, `setupsLadeText`, `dashReiter`, `tageZurueck`/`tageReserve`, `holeEinstellungen`, `leiteWeiter`, `exportiereDaten`; tot gelöscht: `timeZones`, `stepper`, `itemToEditId`, `idCurrent…`/`idPrevious…`, `useEditItem` (mit Wegen zu `/addEntry` u. a.), `currentDate`. |
| A3-13 | sollte weg | **behoben**: `gewaehlteBoerse`, `gewaehltesKonto`, `gewaehlteKonten`, `gewaehlteRichtungen`, `gewaehlterZeitrahmen`, `gewaehlteKennzahl`, `datumsBereich`, `gewaehlterZeitraum`; Optionslisten `richtungsOptionen` … ; Filterzeilen- und i18n-Schlüssel deutsch. localStorage unter `at.journal.*`, einmalige Übernahme `src/utils/speicherUmzug.js` (im Browser geprüft). |
| A3-14 | sollte weg | **behoben**: `notizTradeId`, `notizTagUnix`, `exkursionTradeId`, `exkursionTagUnix`, `exkursionEntwurf`; `tagInput`/`showTagsList`/`tradeTags*` mit A3-05 entfallen; `loescheTrade`, `loescheExkursionen`. |
| A3-15 | muss weg | war in F1 behoben (`seiteLaedt`). |
| A3-16 | sollte weg | **behoben**: `journalKarte`, `gewinnWert`, `verlustWert`, `klickZiel`, `diagrammFlaeche`, `diagrammKarteFlaeche`. |
| A3-17 | sollte weg | **behoben**: Ansichten `JournalUebersicht`, `Kalender`, `Tagesansicht`, `Bilder`, `Bewertungen`, `TradeImport`, `Exkursionen`, `Einstellungen`; Komponenten `KalenderMonat`, `KeineDaten`, `BildKarte`; `layouts/Rahmen.vue`, App.vue mit `meta.rahmen` statt `meta.layout \|\| 'div'`. Routen `/journal /kalender /tagesansicht /bilder /bewertungen /import /exkursionen /einstellungen/:bereich`, alle 13 alten Pfade leiten samt Abfrage und Anker weiter (Selbsttest `__selftest-f3-umzug.mjs`, im Prüf-Container bei 1500 und 375 px durchgeklickt). In der Datenbank steht kein Pfad (geprüft), es braucht keine DB-Migration. |
| A3-18 | generisch | bleibt (Abfrage-API und `objectId` sind Datenformat); Parse-Kommentare in `db.js` gestrichen, `className` → `tabelle`. |
| A3-19 | generisch | bleibt (Stil der Logmeldungen, kein Ausdruck). |
| A3-20 | sollte weg | **behoben**: `docs/spec/{ansichten,diagramme,geruest,journal-kern,stil}.md` aus dem Repo genommen, als Beleg mit SHA-256 in `Trading/AutarkTrade-Beleg/clean-room-spezifikationen-2026-10/`; die neuen `docs/spec/f3-*.md` nennen keine alten Namen. In der Historie stecken sie bis F4. |
| A3-21 | muss weg | **behoben**: `daily.volTooltip` in beiden Sprachen neu formuliert (gehandelte Menge in Coins/Kontrakten). |
| A3-22 | generisch | bleibt (kurze, übliche Fachtexte). |
| A3-23 | ok | unverändert. |
| A3-24 | generisch | bleibt: `tradenote.db`, Seed und `tn_session_v1` sind Verträglichkeitskennungen; ein Ändern machte gespeicherte Schlüssel unlesbar bzw. meldete jedes Gerät ab. Der Seed dient seit F2 nur noch zum Lesen alter Werte. |
| A3-25 | generisch | bleibt (Datenmodell, auf Anweisung nicht umbenannt). |
| A3-26 | generisch | bleibt (Datenformat); die davon abgeleiteten Summenfelder (`totalNetProceeds` …) ebenso. |
| A3-27 – A3-30 | muss weg | offen → **F4** (Historie). |
| A3-31 | ok | unverändert. |
| A3-32 | sollte weg | **behoben**: `lodash` aus `package.json` (nur noch transitiv über knex), `THIRD-PARTY-NOTICES` neu erzeugt, CLAUDE.md berichtigt. |
| A3-33 | generisch | bleibt. |
| A3-34 | generisch | bleibt (vom Prüfskript als „npm-Skript bzw. Versionsangabe" geführt). |
