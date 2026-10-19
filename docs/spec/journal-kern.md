# Spezifikation Journal-Kern (S7, Clean-Room Schritt 1)

Stand: 19.10.2026. Verfasst aus dem Verhalten des heutigen Codes und der beiden
Golden Master. Diese Datei ist die einzige Quelle für den Neubau; der Altcode
darf vom bauenden Agenten nicht gelesen werden.

Beschrieben werden die Module

- `src/utils/trades.js`, `src/utils/daily.js`, `src/utils/mountOrchestration.js`,
  `src/utils/calendar.js`, `src/utils/formatters.js`, `src/utils/dayjs-setup.js`,
  `src/utils/utils.js`, `src/utils/journal-alt.js`
- `src/stores/globals.js` und die Bündel-Dateien `src/stores/{ui,filters,trades,settings}.js`
  mit den Unterordnern `ui/`, `filters/`, `trades/`, `settings/`
- `src/components/SidebarFilters.vue`

Eigener Code, der bleibt und nur BENUTZT wird: `src/utils/totals-kern.js`
(`neueSummen`, `summiereTrade`, `leiteKennzahlenAb`, `z`), `src/utils/mfe-kern.js`
(`mfeR`), `src/utils/funding.js` (`splitFunding`, nur indirekt über totals-kern),
`src/utils/quickImport.js` (erzeugt die Trade-Objekte), `src/utils/db.js`
(`dbFind`, `dbFirst`, `dbGet`, `dbCreate`, `dbUpdate`, `dbDelete`, `dbDeleteWhere`,
`dbGetSettings`, `dbUpdateSettings`), `src/stores/accountBalance.js`
(`refreshAccountBalance`), `src/utils/charts.js` (zeichnet; liest die Stores),
`src/utils/screenshots.js`, `src/i18n`. Bibliotheken, die weiter benutzt werden
dürfen: `dayjs` (mit Plugins), `lodash`, `calendarize`, `papaparse`, `axios`, `vue`.

---

## 0. Was die Golden Master prüfen (Spielregeln für den Neubau)

Zwei Tests frieren das heutige Verhalten ein:

- `src/utils/__selftest-journal.mjs` gegen `src/utils/fixtures/journal-golden.json`
- `src/utils/__selftest-mfe-pfade.mjs` gegen `src/utils/fixtures/mfe-pfade-golden.json`

Beide ersetzen über den Lade-Haken `src/utils/__journal-attrappen.mjs` fünf
Module: `utils/db.js` (Speicher-DB in `globalThis.__journalDaten`), `axios`
(feste Antworten aus `globalThis.__journalNetz`, unbekannte URL wirft), `echarts`
(merkt sich die letzte Option je Element-ID), `stores/accountBalance.js` (tut
nichts), `i18n/index.js` (echtes vue-i18n mit `de.json`). Die Prozesszeitzone
ist auf `Europe/Zurich` festgenagelt. `localStorage` ist eine leere Map,
`window`/`document` sind dünne Attrappen.

Wichtige Eigenschaften der Speicher-DB-Attrappe, auf die sich die Ergebnisse
stützen: `ascending`/`descending` sortieren stabil mit `objectId` (numerisch,
aufsteigend) als zweitem Kriterium; ohne Sortierangabe kommen Zeilen in
Einfügereihenfolge; `limit`, `skip`, `exclude` (Felder entfernen),
`equalTo` (Zeichenkettenvergleich), `greaterThanOrEqualTo`, `greaterThan`,
`lessThanOrEqualTo`, `lessThan` (numerisch), `containedIn`. `dbCreate` vergibt
`objectId` als fortlaufende Zeichenkette.

Vergleichsregeln (beide Tests gleich):

- Ergebnisse werden per JSON-Rundreise „gesäubert“: Funktionen und Werte
  `undefined` verschwinden samt Schlüssel, `NaN` wird `null`.
- Objekte: verglichen wird die MENGE der Schlüssel (fehlend und „neu
  hinzugekommen“ sind beides Fehler), die Reihenfolge der Schlüssel NICHT.
  Ein Schlüssel mit Wert `undefined` gilt als nicht vorhanden – ein Schlüssel
  mit Wert `0` oder `null` dagegen schon.
- Arrays: positionsgenau, also Reihenfolge und Länge zählen.
- Zahlen: sind beide Werte Ganzzahlen, müssen sie exakt gleich sein. Sonst gilt
  |a − b| ≤ 1e-9 · max(1, |a|, |b|). `-0` und `0` gelten als gleich.
- Diagrammdaten (ECharts-Optionen aus `charts.js`) werden nur auf
  `series[].name/type/data`, `xAxis[].data`, `yAxis[].data`, `legend[].data`
  reduziert. `charts.js` bleibt, liest aber die hier spezifizierten Stores; die
  Reihenfolge von Objektschlüsseln in `groups.*`, `totalsByDate` usw. wirkt sich
  über die Diagramm-Arrays mittelbar doch auf den Vergleich aus (siehe 3.6).
- Im Journal-Test werden Trades „kompakt“ verglichen: Ein Objekt mit
  Zeichenketten-`id` und Feld `entryTime` wird auf `id` plus jedes Feld
  reduziert, das sich gegenüber dem importierten Trade geändert hat oder neu ist;
  fehlende Felder erscheinen als `'—entfernt—'`. Für `groups` dient der
  gefilterte Trade als Bezug.
- Die Szenarien laufen nacheinander im selben Prozess, ohne die Stores
  zurückzusetzen. Die Reihenfolge der Szenarien ist Teil des Golden Masters
  (siehe Altfehler 7.1).
- Im Journal-Test darf während des ganzen Laufs KEIN `console.error` auftreten.
  Im MFE-Test ebenso. `console.log/warn/time` sind stummgeschaltet und dürfen
  beliebig benutzt werden.

Ablauf des Journal-Tests (damit klar ist, welche Funktionen in welcher Folge
laufen):

1. Import über `useQuickApiImport` (eigener Code) legt Tageszeilen an.
2. Begleitzeilen werden direkt in die Speicher-DB geschrieben: `tags` (Trade-
   Ebene mit `dateUnix = entryTime`, Tages-Ebene mit `tradeId = ''`),
   `satisfactions` (Trade- und Tages-Ebene), `excursions`, `notes` (mit
   `tradeType`).
3. Je Dashboard-Szenario: Stores setzen (`pageId`, `timeZoneTrade`,
   `hasData=false`, `selectedRange`, `selectedPositions`, `selectedAccounts`,
   `selectedTags`, `selectedBroker`, `selectedTradeCategory`, `amountCase`,
   `timeFrame`, `barChartNegativeTagGroups=[]`), dann parallel
   `useGetExcursions`, `useGetSatisfactions`, `useGetTags`, danach
   `useGetAvailableTags`, `useGetFilteredTrades`, `useTotalTrades`,
   `useGroupTrades`, `useCalculateProfitAnalysis`; danach Diagramme über
   `charts.js`. Verglichen werden `hasData`, `filteredTrades`, `totals`,
   `totalsByDate`, `profitAnalysis`, Diagramme, `groups`.
   Szenarien in dieser Reihenfolge: `alles` {}, `bitunixJanuar` (Börse bitunix,
   Januar 2026), `bitgetMaerzUSA` (bitget, März 2026, Zone America/New_York),
   `nurBots` (Kategorie bot), `nurFutures` (Kategorie futures, Zeitrahmen 60),
   `nurAgent` (Kategorie agent), `nurShortsKonto` (nur short, Konten [bitget]),
   `tagFilter` (Tags tag_1, tag_4), `ohneTagsNurUngetaggt` (Tags [t000t]).
   Vorgaben: Seite `dashboard`, Zone `Europe/Zurich`, Zeitraum {0,0}, beide
   Richtungen, Konten [], alle Tags inkl. `t000t`, Börse '', Kategorie `all`,
   Zeitrahmen 15.
4. Tagesansicht: Seite `daily`, Februar 2026; alle vier Lader parallel, dann
   `useGetFilteredTrades`; verglichen `filteredTrades` und zwei Diagrammarten.
5. Kalender (März 2026 Zürich, Oktober 2025 Zürich, März 2026 New York): Seite
   `calendar`, `selectedMonth` = Monat, `selectedRange` = Jahresanfang bis
   Monatsende, `useGetTags` + `useGetAvailableTags`, `useGetFilteredTrades`,
   `useLoadCalendar`; verglichen `calendarData` und `miniCalendarsData`.

Ablauf des MFE-Tests: Abschnitt 4.2 und 7 beschreiben die Einzelheiten.

---

## 1. Überblick und Datenfluss

Das Journal kennt Tageszeilen (Tabelle `trades`, eine Zeile je Börse und
Handelstag) mit eingebetteten Trade-Objekten. Der Kern lädt sie, filtert sie
nach den Einstellungen der Seitenleiste und leitet daraus alle Kennzahlen ab:

1. **Begleitdaten laden** (`daily.js`): Exkursionen → `excursions`,
   Zufriedenheit → `satisfactionArray`/`satisfactionTradeArray`, Tag-Zuordnungen
   → `tags`, Tag-Katalog aus den Einstellungen → `availableTags`, Notizen.
2. **Laden und Filtern** (`useGetFilteredTrades`): Tageszeilen aus der DB,
   pro Trade Filterprüfung, Anreichern (Tags, Zufriedenheit, Exkursion,
   `tradeType`, `priceVar`), Ergebnis in `filteredTrades` (Tage, absteigend),
   `filteredTradesDaily` (Tage, DB-Reihenfolge) und `filteredTradesTrades`
   (flache Trade-Liste). Danach Blotter (je Tag und Symbol) und P&L (je Tag) neu
   berechnen und an die Tage hängen.
3. **Summen** (`useTotalTrades`): `totals` über alle gefilterten Trades,
   `totalsByDate` je Handelstag.
4. **Gruppen** (`useGroupTrades`): `groups.*` nach Wochentag, Einstiegszeit,
   Dauer, Trades pro Tag, Ausführungen, Richtung, Trade-Typ, Tags,
   Tag-Gruppen, Symbol, Float, Marktkapitalisierung, Einstiegspreis.
5. **Gewinnanalyse** (`useCalculateProfitAnalysis`): `profitAnalysis` mit
   Durchschnitten je Trade, R-Verhältnis und MFE-basierter Take-Profit-Stufe.
6. **Diagrammdaten**: `charts.js` (nicht Teil dieser Spezifikation) liest
   `totals`, `totalsByDate`, `groups`, `profitAnalysis`, `filteredTrades`,
   `filteredTradesTrades`, `satisfactionArray`, `satisfactionTradeArray`,
   `availableTags`, `barChartNegativeTagGroups`, `amountCase`,
   `selectedTimeFrame`, `selectedRatio`, `selectedGrossNet`, `timeZoneTrade`.
7. **Kalender** (`useLoadCalendar`): Monatsraster mit P&L je Tag in
   `calendarData`.

Je Ansicht setzt ein Mount-Ablauf (`mountOrchestration.js`) Spinner und
Mounted-Flags, bestimmt `selectedRange` und ruft die Schritte in fester Folge
(Abschnitt 4.5).

---

## 2. Datenmodell

### 2.1 Tageszeile (Tabelle `trades`)

Spalten: `id` (als `objectId` an den Client), `dateUnix` (Sekunden, UTC-
Mitternacht des Schliesstages, so von `quickImport.js` erzeugt), `date`
(Zeichenkette `YYYY-MM-DD`), `broker`, `executions` (JSON-Liste), `trades`
(JSON-Liste der Trade-Objekte), `blotter` (JSON), `pAndL` (JSON),
`cashJournal` (JSON, Vorgabe `{}`), `openPositions` (0/1 bzw. Boolean),
`video`, `createdAt`, `updatedAt`. Pro Börse und Tag eine Zeile – zwei Börsen am
selben Tag ergeben zwei Zeilen mit GLEICHEM `dateUnix`.

### 2.2 Trade-Objekt (Element von `trades[]` einer Tageszeile)

Erzeugt von `quickImport.js`/`buildTradeObj` bzw. `incoming.js` und
`server/journal-bridge.js`. Felder: `id` (Form `t<td>_<index>_<positionId>`),
`account`, `broker`, `td` (Handelstag, Sekunden; gleich `dateUnix` der Zeile),
`currency`, `type` ('futures'), `side` ('B'/'SS'), `strategy` ('long'/'short'),
`symbol`, `buyQuantity`, `sellQuantity`, `entryPrice`, `exitPrice`,
`entryTime`, `exitTime` (Sekunden), `grossProceeds`, `netProceeds`,
`commission`, `tradingFee`, `fundingFee`, `sec`, `taf`, `nscc`, `nasdaq`,
`grossSharePL`, `netSharePL`, `grossWins`, `grossLoss`, `netWins`, `netLoss`,
`grossWinsCount`, `grossLossCount`, `netWinsCount`, `netLossCount`,
`grossWinsQuantity`, `grossLossQuantity`, `netWinsQuantity`,
`netLossQuantity`, `grossSharePLWins`, `grossSharePLLoss`, `netSharePLWins`,
`netSharePLLoss`, `highGrossSharePLWin`, `highGrossSharePLLoss`,
`highNetSharePLWin`, `highNetSharePLLoss`, `executionsCount` (1),
`tradesCount` (1), `openPosition` (false). Optional: `category`
('futures' | 'bot' | 'agent'), `botType`, `leverage`, `investment`,
`gridProfit`, `coinM`, `marginCoin`, `pnlUsdt`, `investUsdt`, `quoteCloseP`,
`excursions` (siehe 4.2), `financials`/`cashJournal` (Altbestand, im
Krypto-Betrieb nie gesetzt).

**Aktienbörsen-Felder `sec`, `taf`, `nscc`, `nasdaq`:** *(Entfernt in S7, 19.10.2026, samt `otherCommission`; Migration v28. `fees` = `commission`.)* Sie stammen aus dem
Aktien-Ursprung und sind im Krypto-Betrieb IMMER 0. Sie entstehen in
`buildTradeObj` (`quickImport.js`), in `incoming.js` (Trade-Objekt aus offenen
Positionen) und in `server/journal-bridge.js`. Gelesen werden sie in
`totals-kern.js` (`summiereTrade`: eigene Summen, ausserdem in
`otherCommission` = Summe der vier und in `fees` = `commission` + Summe der
vier) und im Blotter/P&L (`useCreateBlotter`, `useCreatePnL`, gleiche Formeln,
siehe 4.2). Der Neubau MUSS die vier Felder in `totals`, `totalsByDate`,
`blotter` und `pAndL` weiter ausgeben (als 0), sonst fehlen Schlüssel im
Golden Master.

### 2.3 Begleittabellen

- `tags`: `dateUnix`, `tradeId` (Vorgabe ''), `tags` (JSON-Liste von Tag-IDs).
  Trade-Ebene: `tradeId` = Trade-ID. Tages-Ebene: `tradeId` = '' oder die
  Tageszahl als Zeichenkette.
- `satisfactions`: `dateUnix`, `tradeId` (Vorgabe ''), `satisfaction` (0/1).
- `excursions`: `dateUnix`, `tradeId`, `stopLoss`, `maePrice`, `mfePrice`
  (Vorgabe 0 = nicht gemessen).
- `notes`: `dateUnix`, `tradeId`, `note`, `title`, `entryNote`, `feelings`,
  `playbook`, `closingNote`, `closingFeelings`, `closingPlaybook`,
  `tradingMetadata`, `aiReview`, `aiReviewProvider`, `aiReviewModel`,
  `tradeType` ('scalp'/'day'/'swing'/''), `closingTradeType`,
  `entryStressLevel`, `emotionLevel`, `timeframe` usw.
- Einstellungen (`settings`, Einzelzeile über `dbGetSettings`): u. a. `tags`
  (Tag-Katalog: Liste von Gruppen `{id, name, color, tags: [{id, name}]}`),
  `accounts`, `apis` (`[{provider, key}]`), `timeZone`, `tradeTimeframes`,
  `startseiteAn`.

Konvention Tag-IDs: `tag_<n>`; Gruppen `group_<n>`; `group_0` heisst
„Ungrouped“ (Farbe `#6c757d`). Die Pseudo-ID `t000t` bedeutet im Filter „ohne
Tag“.

---

## 3. Store (`src/stores/globals.js` und Bündel)

### 3.1 Grundsätze

- Kein Pinia. Alles sind direkt exportierte `ref()`, `reactive()` oder
  `computed()` aus `globals.js`; Komponenten importieren und mutieren direkt.
- `globals.js` ist die einzige Quelle. `ui.js`, `filters.js`, `trades.js`,
  `settings.js` bündeln nur Re-Exporte ihrer Unterordner; die Unterordner
  re-exportieren Namen aus `globals.js` (Zuordnung in 3.4). Eine Datei
  `diary.js` gibt es NICHT (die README in `src/stores/` erwähnt sie fälschlich).
- `reactive([])`-Listen werden IN PLACE geleert und gefüllt (Länge 0 setzen,
  `push`, `splice`), `reactive({})`-Objekte durch Löschen aller Schlüssel und
  `Object.assign`. Konsumenten halten Referenzen auf diese Objekte; ein Ersatz
  durch neue Objekte würde sie abhängen.
- Werte aus `localStorage` werden beim Laden des Moduls gelesen. Ohne
  `localStorage` (Node ohne Attrappe) liefern einige Exporte statt einer Ref
  eine leere Zeichenkette (vermerkt in der Tabelle) – ein Altverhalten, das nur
  ausserhalb des Browsers sichtbar ist.
- Mehrere `computed` benutzen i18n (`i18n.global.t`).

### 3.2 Exporte von `globals.js`

Spalte „LS“: localStorage-Schlüssel (nur gelesen, wenn nicht anders
vermerkt), „SS“: sessionStorage.

**Allgemein**

| Name | Art | Anfangswert | Persistenz / Bemerkung |
|---|---|---|---|
| `pageId` | ref | undefined | Routenname der aktuellen Seite (gesetzt von `usePageId`) |
| `currentUser` | ref | undefined | Einstellungszeile (`settings`), kein Benutzerobjekt |
| `timeZones` | ref | Liste: America/New_York, Asia/Shanghai, Europe/Brussels, Asia/Tokyo, Asia/Hong_Kong, Asia/Kolkata, Europe/London, Asia/Riyadh | – |
| `timeZoneTrade` | ref | undefined | Handelszeitzone (gesetzt von `useGetTimeZone`) |
| `queryLimit` | ref | 50000 | Limit der DB-Abfragen |
| `queryLimitExistingTrades` | ref | 50 | – |
| `endOfList` | ref | false | Endlos-Scrollen |
| `noData` | ref | false | – |
| `stepper` | ref | undefined | – |
| `hasData` | ref | false | – |
| `itemToEditId` | ref | SS `editItemId` (oder null), ohne sessionStorage '' | – |
| `currentDate` | ref | undefined | – |
| `quill` | ref | undefined | – |
| `sideMenuMobileOut` | ref | false | – |
| `sideMenuEingeklappt` | ref | LS `sideMenuEingeklappt` === '1' (Fehler/fehlend → false) | – |
| `schalteSideMenu()` | Funktion | – | kehrt `sideMenuEingeklappt` um und schreibt LS `sideMenuEingeklappt` = '1'/'0' (Fehler ignoriert) |
| `screenType` | ref | undefined | 'computer'/'mobile' |
| `saveButton` | ref | false | – |
| `windowIsScrolled` | ref | undefined | – |
| `idCurrent`, `idPrevious`, `idCurrentType`, `idCurrentNumber`, `idPreviousType`, `idPreviousNumber` | ref | undefined | Reiterzustand der Tagesansicht |
| `countdownInterval` | ref | null | – |
| `countdownSeconds` | ref | 5 | – |
| `dailyChartZoom` | ref | 3 | 1 = nah, 3 = ganz weit |

**Laden und Mounten**

| Name | Art | Anfangswert |
|---|---|---|
| `spinnerLoadingPage` | ref | true |
| `spinnerLoadingPageText` | ref | undefined |
| `renderData` | ref | 0 (Zähler, als `:key` zum Neuaufbau von Diagrammknoten) |
| `spinnerLoadMore` | ref | false |
| `tabGettingScreenshots` | ref | false |
| `dashboardChartsMounted` | ref | undefined |
| `dashboardIdMounted` | ref | false |
| `auswertungMounted` | ref | false |
| `barChartNegativeTagGroups` | ref | [] (Liste `{id, name}` der Tag-Gruppen, die ein Diagramm bekommen) |
| `renderingCharts` | ref | true |
| `spinnerSetups` | ref | true |
| `spinnerSetupsText` | ref | undefined |
| `legacy` | reactive | [] |
| `modalDailyTradeOpen` | ref | false |

**Trades (Dashboard)**

| Name | Art | Anfangswert | Form |
|---|---|---|---|
| `selectedRange` | ref | undefined | `{start, end}` in Sekunden; `{0,0}` = alles |
| `filteredTrades` | reactive | [] | Tageskopien, siehe 3.5 |
| `filteredTradesDaily` | reactive | [] | dieselben Tagesobjekte, DB-Reihenfolge |
| `filteredTradesTrades` | reactive | [] | flache Liste der gefilterten Trades |
| `auswertungNotes` | reactive | [] | siehe 4.3 |
| `totals` | reactive | {} | siehe 3.5 |
| `totalsByDate` | reactive | {} | siehe 3.5 |
| `groups` | reactive | {} | siehe 3.6 |
| `profitAnalysis` | reactive | {} | siehe 3.5 |
| `timeFrame` | ref | 60 | Minuten-Raster der Einstiegszeit-Gruppe |
| `imports` | ref | [] | zuletzt geladene Tageszeilen (`useGetTrades`) |

**Trades hinzufügen**

| Name | Art | Anfangswert | Form |
|---|---|---|---|
| `pAndL` | reactive | {} | `td` → P&L-Objekt (4.2) |
| `executions` | reactive | {} | `td` → Liste von Ausführungen (Trade-Objekt plus `trade` = Trade-ID) |
| `trades` | reactive | {} | `td` → Liste von Trade-Objekten (Vorschau des Imports) |
| `blotter` | reactive | {} | `td` → Symbol → Blotter-Objekt (4.2) |
| `tradesData` | reactive | [] | – |
| `tradeId` | ref | undefined | – |
| `existingImports` | reactive | [] | `td`-Zahlen bereits vorhandener Tage |
| `existingTradesArray` | reactive | [] | Datumszeichenketten `YYYY-MM-DD` |
| `gotExistingTradesArray` | ref | false | – |
| `marketCloseTime` | ref | '16:00:00' | Marktschluss in Handelszeitzone (MFE) |
| `brokers` | reactive | `[{value:'bitunix',label:'Bitunix',assetTypes:['futures']}, {value:'bitget',label:'Bitget',assetTypes:['futures']}, {value:'pionex',label:'Pionex',assetTypes:['futures']}]` | – |

**Einstellungen**

| Name | Art | Anfangswert |
|---|---|---|
| `renderProfile` | ref | 0 |
| `apis` | reactive | [] |
| `layoutStyle` | reactive | [] |

**Auswahl und Filter**

| Name | Art | Anfangswert | Persistenz |
|---|---|---|---|
| `selectedItem` | ref | undefined | – |
| `tempSelectedPlSatisfaction` | ref | null | – |
| `periodRange` | reactive | [] | gefüllt von `useGetPeriods` |
| `positions` | ref | `[{value:'long',label:'Long'},{value:'short',label:'Short'}]` | – |
| `timeFrames` | computed | daily/weekly/monthly mit Labels `options.daily`, `options.weekly`, `options.monthly` | – |
| `ratios` | computed | `{value:'appt',label:'APPT'}`, `{value:'profitFactor',label:t('options.profitFactor')}` | – |
| `grossNet` | computed | gross/net mit `options.gross`, `options.net` | – |
| `allTradeTimeframes` | computed | 19 Einträge `{value,label,group}`: 1m, 2m, 3m, 5m, 6m, 10m, 15m, 30m, 45m (Gruppe `timeframes.minutes`), 1h, 2h, 3h, 4h (`timeframes.hours`), 1D, 1W, 1M, 3M, 6M, 12M (`timeframes.days`); Label `timeframes.<value>` | – |
| `selectedTradeTimeframes` | reactive | [] | gefüllt aus Einstellungen (`useInitApp`) |
| `plSatisfaction` | computed | `{value:'pl',label:'PnL'}`, `{value:'satisfaction',label:t('options.satisfaction')}` | – |
| `selectedTags` | ref | LS `selectedTags` an Kommas getrennt, sonst [] | LS `selectedTags` (ohne LS: '') |
| `selectedPositions` | ref | LS `selectedPositions` an Kommas getrennt, sonst [] | LS (ohne LS: '') |
| `selectedTimeFrame` | ref | LS `selectedTimeFrame` (null wenn fehlend) | ohne LS: '' |
| `selectedRatio` | ref | LS `selectedRatio` | ohne LS: '' |
| `selectedAccount` | ref | LS `selectedAccount` | ohne LS: '' |
| `selectedAccounts` | ref | LS `selectedAccounts` an Kommas getrennt, sonst [] | ohne LS: '' |
| `selectedGrossNet` | ref | LS `selectedGrossNet` | ohne LS: '' |
| `selectedPlSatisfaction` | ref | LS `selectedPlSatisfaction` | ohne LS: '' |
| `selectedBroker` | ref | LS `selectedBroker` | ohne LS: ref(undefined) |
| `APP_MODES` | Konstante | ['start','journal','live','research','agent'] | – |
| `appMode` | ref | LS `appMode`, wenn in `APP_MODES`, sonst 'journal' | geschrieben von Router/ModeSwitcher/Kopfleiste/Settings/Start |
| `selectedTradeCategory` | ref | LS `selectedTradeCategory` oder 'futures' | Normalisierung siehe unten |
| `privacyMode` | ref | LS `privacyMode` === '1' | geschrieben von Nav.vue |
| `kopiertesBild` | ref | SS `kopiertesBild` als JSON (Fehler/fehlend → null) | geschrieben von Screenshot.vue, Livetrading.vue |
| `BOT_BROKERS` | Konstante | ['pionex'] | – |
| `selectedDateRange` | ref | JSON aus LS `selectedDateRange` (null wenn fehlend) | ohne LS: '' |
| `selectedMonth` | ref | JSON aus LS `selectedMonth` | ohne LS: '' |
| `selectedMonthPreset` | ref | LS `selectedMonthPreset` oder 'current' | – |
| `selectedPeriodRange` | ref | JSON aus LS `selectedPeriodRange` | ohne LS: '' |
| `selectedDashTab` | ref | LS `selectedDashTab` | ohne LS: '' |
| `amountCase` | ref | LS `selectedGrossNet`, wenn 'gross' oder 'net', sonst 'gross' | – |
| `amountCapital` | ref | undefined | – |

Normalisierung beim Laden: Gibt es `localStorage`, steht `selectedBroker`
NICHT in `BOT_BROKERS` und ist `selectedTradeCategory` = 'bot', dann wird die
Kategorie sofort auf 'futures' gesetzt und LS `selectedTradeCategory` =
'futures' geschrieben.

**Tagesansicht / Trade-Detail**

| Name | Art | Anfangswert |
|---|---|---|
| `satisfactionArray` | reactive | [] (Tages-Zufriedenheit `{tradeId, satisfaction, dateUnix}`) |
| `satisfactionTradeArray` | reactive | [] (Trade-Zufriedenheit, gleiche Form) |
| `tradeIndex`, `tradeIndexPrevious`, `itemTradeIndex` | ref | undefined |
| `excursion` | reactive | {} |
| `excursions` | reactive | [] (rohe `excursions`-Zeilen inkl. `objectId`) |
| `notes` | reactive | [] |
| `tags` | reactive | [] (`{tradeId, tags, dateUnix}`) |
| `tradeTags`, `newTradeTags`, `availableTags`, `availableTagsArray` | reactive | [] |
| `tagInput` | ref | '' |
| `showTagsList` | ref | '' (sonst die `pageId`, auf der die Liste offen ist) |
| `tradeNote` | ref | null |
| `tradeNoteChanged` | ref | false |
| `tradeNoteDateUnix`, `tradeNoteId` | ref | undefined |
| `tradeTagsChanged` | ref | false |
| `tradeTagsDateUnix`, `tradeTagsId` | ref | undefined |
| `tradeExcursionChanged` | ref | false |
| `tradeExcursionDateUnix`, `tradeExcursionId` | ref | undefined |
| `tradeScreenshotChanged` | ref | false |
| `daysBack`, `daysMargin` | ref | undefined |

**Offene Positionen und Bewertungs-Hinweise**

| Name | Art | Anfangswert |
|---|---|---|
| `incomingPositions` | reactive | [] |
| `incomingPollingActive` | ref | false |
| `incomingLastFetched` | ref | null |
| `incomingBrokerFehler` | ref | [] (Liste `{broker, meldung, zugang}`) |
| `pendingOpeningCount`, `pendingClosingCount` | ref | 0 |
| `pendingOpeningByBroker`, `pendingClosingByBroker` | ref | {} (Börse → Zahl) |
| `evalNotificationShown`, `evalNotificationDismissed` | ref | false |
| `evalNeu` | ref | `{oeffnung:{anzahl:0,jeBroker:{}}, schluss:{anzahl:0,jeBroker:{}}}` |
| `getNotifiedPositionIds()` | Funktion | liest LS `evalNotifiedPositionIds` (JSON-Liste) als Set; Fehler oder fehlend → leeres Set |
| `addNotifiedPositionIds(ids)` | Funktion | fügt IDs hinzu, schreibt die ganze Menge als JSON-Liste zurück |
| `removeNotifiedPositionIds(ids)` | Funktion | entfernt IDs, schreibt zurück |
| `dailyPagination` | ref | 0 |
| `dailyQueryLimit` | ref | 10 |

**Screenshots**

`screenshot` (reactive {}), `screenshots` ([]), `screenshotsInfos` ([]),
`screenshotsPagination` (ref 0), `screenshotsQueryLimit` (ref 10),
`selectedScreenshot` (reactive {}), `selectedScreenshotIndex`,
`selectedScreenshotSource`, `dateScreenshotEdited` (ref undefined),
`editingScreenshot` (ref false), `expandedId`, `expandedSource` (ref
undefined), `markerAreaOpen` (ref false), `resizeCompressImg`,
`resizeCompressMaxHeight`, `resizeCompressMaxWidth`, `resizeCompressQuality`
(ref undefined).

**Kalender**

| Name | Art | Anfangswert |
|---|---|---|
| `calendarData` | reactive | {} (siehe 4.4) |
| `miniCalendarsData` | reactive | **{}** – ein OBJEKT, keine Liste (Altfehler 7.4) |
| `scrollToDateUnix` | ref | null |

**Verschiedenes**

`getMore` (ref false), `uploadMfePrices` (ref false), `tradeAccounts`
(reactive []), `selectedTagIndex` (ref undefined), `filteredSuggestions`
(reactive []), `expandedScreenshot` (ref undefined).

**KI-Report-Status**

`aiReportGenerating` (ref false), `aiReportError` (ref ''),
`aiReportLastSavedId` (ref null), `aiReportLabel` (ref ''),
`aiReportCountBefore` (ref 0).

### 3.3 Weitere Store-Dateien

`accountBalance.js`, `chartAlarme.js`, `chartPositionen.js`,
`chartZeichnungen.js`, `live.js`, `livetrading.js`, `system.js` sind eigener
Code und nicht Teil des Neubaus.

### 3.4 Bündel und Unterordner (Re-Exporte, alle aus `globals.js`)

- `ui.js` = `ui/loading.js` + `ui/navigation.js` + `ui/tabs.js` +
  `ui/screenshots-ui.js` + `ui/app.js`
  - `ui/loading.js`: `spinnerLoadingPage`, `spinnerLoadingPageText`,
    `renderData`, `spinnerLoadMore`, `tabGettingScreenshots`,
    `dashboardChartsMounted`, `dashboardIdMounted`, `auswertungMounted`,
    `barChartNegativeTagGroups`, `renderingCharts`, `spinnerSetups`,
    `spinnerSetupsText`
  - `ui/navigation.js`: `pageId`, `timeZoneTrade`, `screenType`,
    `sideMenuMobileOut`, `scrollToDateUnix`
  - `ui/tabs.js`: `idCurrent`, `idPrevious`, `idCurrentType`,
    `idCurrentNumber`, `idPreviousType`, `idPreviousNumber`
  - `ui/screenshots-ui.js`: `markerAreaOpen`, `editingScreenshot`,
    `expandedId`, `expandedSource`, `selectedScreenshotIndex`,
    `selectedScreenshotSource`, `dateScreenshotEdited`, `resizeCompressImg`,
    `resizeCompressMaxHeight`, `resizeCompressMaxWidth`,
    `resizeCompressQuality`, `expandedScreenshot`
  - `ui/app.js`: `appMode`, `APP_MODES`, `privacyMode`, `kopiertesBild`,
    `currentUser`, `timeZones`, `queryLimit`, `queryLimitExistingTrades`,
    `endOfList`, `noData`, `stepper`, `hasData`, `itemToEditId`,
    `currentDate`, `quill`, `saveButton`, `windowIsScrolled`,
    `countdownInterval`, `countdownSeconds`, `dailyChartZoom`, `legacy`,
    `modalDailyTradeOpen`, `selectedItem`, `dailyPagination`,
    `dailyQueryLimit`, `screenshotsPagination`, `screenshotsQueryLimit`
- `filters.js` = `filters/selection.js` + `filters/options.js`
  - `filters/selection.js`: `selectedTags`, `selectedPositions`,
    `selectedTimeFrame`, `selectedRatio`, `selectedAccount`,
    `selectedAccounts`, `selectedGrossNet`, `selectedPlSatisfaction`,
    `selectedBroker`, `selectedTradeCategory`, `selectedDateRange`,
    `selectedMonth`, `selectedMonthPreset`, `selectedPeriodRange`,
    `selectedDashTab`, `amountCase`, `amountCapital`,
    `selectedTradeTimeframes`, `selectedTagIndex`,
    `tempSelectedPlSatisfaction`
  - `filters/options.js`: `selectedRange`, `periodRange`, `positions`,
    `timeFrames`, `ratios`, `grossNet`, `plSatisfaction`,
    `allTradeTimeframes`, `filteredSuggestions`, `daysBack`, `daysMargin`,
    `getMore`, `uploadMfePrices`, `brokers`, `BOT_BROKERS`
- `trades.js` = `trades/dashboard.js` + `trades/add-trades.js` +
  `trades/daily-detail.js` + `trades/incoming.js` + `trades/screenshots.js` +
  `trades/calendar.js`
  - `trades/dashboard.js`: `filteredTrades`, `filteredTradesDaily`,
    `filteredTradesTrades`, `totals`, `totalsByDate`, `groups`,
    `profitAnalysis`, `timeFrame`, `imports`
  - `trades/add-trades.js`: `pAndL`, `executions`, `trades`, `blotter`,
    `tradesData`, `tradeId`, `existingImports`, `existingTradesArray`,
    `gotExistingTradesArray`, `marketCloseTime`
  - `trades/daily-detail.js`: `satisfactionArray`, `satisfactionTradeArray`,
    `tradeIndex`, `tradeIndexPrevious`, `itemTradeIndex`, `excursion`,
    `excursions`, `notes`, `tags`, `tradeTags`, `newTradeTags`,
    `availableTags`, `availableTagsArray`, `tagInput`, `showTagsList`,
    `tradeNote`, `tradeNoteChanged`, `tradeNoteDateUnix`, `tradeNoteId`,
    `tradeTagsChanged`, `tradeTagsDateUnix`, `tradeTagsId`,
    `tradeExcursionChanged`, `tradeExcursionDateUnix`, `tradeExcursionId`,
    `tradeScreenshotChanged`, `auswertungNotes`
  - `trades/incoming.js`: `incomingPositions`, `incomingPollingActive`,
    `incomingLastFetched`, `incomingBrokerFehler`, `pendingOpeningCount`,
    `pendingClosingCount`, `pendingOpeningByBroker`,
    `pendingClosingByBroker`, `evalNotificationShown`,
    `evalNotificationDismissed`, `evalNeu`, `getNotifiedPositionIds`,
    `addNotifiedPositionIds`, `removeNotifiedPositionIds`
  - `trades/screenshots.js`: `screenshot`, `screenshots`, `screenshotsInfos`,
    `selectedScreenshot`
  - `trades/calendar.js`: `calendarData`, `miniCalendarsData`,
    `tradeAccounts`
- `settings.js` = `settings/app.js` + `settings/reporting.js`
  - `settings/app.js`: `currentUser`, `renderProfile`, `apis`, `layoutStyle`
  - `settings/reporting.js`: `aiReportGenerating`, `aiReportError`,
    `aiReportLastSavedId`, `aiReportLabel`, `aiReportCountBefore`

Exporte von `globals.js`, die in keinem Bündel stehen und direkt aus
`globals.js` importiert werden: `sideMenuEingeklappt`, `schalteSideMenu`,
`incomingPositions` (auch über `trades.js`), `currentUser`,
`spinnerLoadingPage` (auch über `ui.js`), `appMode` (auch über `ui.js`).

### 3.5 Form der Ausgabedaten

**`filteredTrades[i]` / `filteredTradesDaily[i]` (Tageskopie)**

Alle Felder der geladenen Tageszeile AUSSER `trades`, `pAndL`, `blotter`
(und den beim Laden ausgeschlossenen `executions`), also u. a. `objectId`,
`dateUnix`, `broker`, `openPositions`, gegebenenfalls `cashJournal`, `video`,
`createdAt`, `updatedAt`. Dazu:

- `date`: **Tag des Monats als Zahl** (überschreibt die DB-Zeichenkette!),
  `month`: Monat 0–11, `year`: Jahr – alle drei aus `dateUnix` in
  `timeZoneTrade`.
- `satisfaction`: nur wenn `pageId` = 'daily': Zufriedenheit des Tages aus
  `satisfactionArray` (Treffer über `dateUnix`), sonst null. Auf anderen
  Seiten fehlt das Feld.
- `trades`: Liste der gefilterten, angereicherten Trades (siehe unten).
- `pAndL`, `blotter`: nur an EINER Tageskopie je `dateUnix` (Altfehler 7.2),
  Inhalte aus den Stores `pAndL[dateUnix]` bzw. `blotter[dateUnix]`.

**Gefilterter Trade (Element von `filteredTrades[i].trades` und
`filteredTradesTrades`; beides dieselben Objekte)**

Kopie des Trade-Objekts ohne `excursions`, dazu:

- `priceVar` = `exitPrice − entryPrice` bei `strategy` = 'long', sonst
  `entryPrice − exitPrice`.
- `tags`: Liste `{id, name}` der zugeordneten UND ausgewählten Tags (Regel in
  4.1). Nach `useGroupTrades` tragen genau diese Tag-Objekte zusätzlich
  `groupName` und `groupId` (Altfehler 7.3, im Golden Master sichtbar).
- `satisfaction`: Trade-Zufriedenheit aus `satisfactionTradeArray` (Treffer
  über `tradeId`), sonst null.
- `stopLoss`, `maePrice`, `mfePrice`: aus der Exkursion mit passender
  `tradeId`, jeweils nur wenn der Wert wahr ist (0/null/'' → null); ohne
  Exkursion null.
- `tradeType`: aus den Notizen (Treffer über `tradeId`), sonst ''.

**`totals`** (vollständige Schlüsselmenge)

Aus `neueSummen()`+`summiereTrade()` über alle gefilterten Trades:
`buyQuantity`, `sellQuantity`, `commission`, `fundingFees`, `fundingPaid`,
`fundingReceived`, `tradingFees`, `sec`, `taf`, `nscc`, `nasdaq`,
`otherCommission`, `fees`, `grossProceeds`, `grossWins`, `grossLoss`,
`grossSharePL`, `grossSharePLWins`, `grossSharePLLoss`,
`highGrossSharePLWin`, `highGrossSharePLLoss`, `netProceeds`, `netWins`,
`netLoss`, `netSharePL`, `netSharePLWins`, `netSharePLLoss`,
`highNetSharePLWin`, `highNetSharePLLoss`, `executions`, `trades`,
`grossWinsQuantity`, `grossLossQuantity`, `grossWinsCount`,
`grossLossCount`, `netWinsQuantity`, `netLossQuantity`, `netWinsCount`,
`netLossCount`, `financials`.
Aus `leiteKennzahlenAb()`: `probGrossWins`, `probGrossLoss`, `probNetWins`,
`probNetLoss`, `avgGrossWins`, `avgGrossLoss`, `avgNetWins`, `avgNetLoss`,
`avgGrossSharePLWins`, `avgGrossSharePLLoss`, `avgNetSharePLWins`,
`avgNetSharePLLoss`.
Zusätzlich:
- `quantity` = `buyQuantity` + `sellQuantity` (der Summen)
- `locateFees`, `softwareFees`, `bankingFees`: Summe über die TAGE in
  `filteredTrades` aus `cashJournal.locate`, `cashJournal.software`,
  `cashJournal.banking.fee` (je fehlend → 0); nur Tage, deren `cashJournal`
  existiert und mindestens einen Schlüssel hat. Im Krypto-Betrieb immer 0.
- `otherFees` = `locateFees` + `softwareFees` + `bankingFees`
- `netFeesProceeds` = `netProceeds` − `otherFees`
- `netProceedsEstimations`, `netWinsEstimations`, `netLossEstimations` = 0

**`totalsByDate`**: Schlüssel = `td` (als Zeichenkette), Wert = Summenobjekt
aus `neueSummen()`+`summiereTrade()` über die Trades dieses Tages (ohne
`leiteKennzahlenAb`, ohne die Zusatzfelder oben), wobei `financials` mit dem
Wert `financials` des ERSTEN Trades des Tages (nach Sortierung) überschrieben
wird. Hat dieser Trade kein `financials` (Krypto: immer), ist der Wert
`undefined` – der Schlüssel darf in der JSON-Form also NICHT erscheinen (eine
0 wäre ein Fehler gegen den Golden Master).

**`profitAnalysis`**: `grossAvWinPerShare`, `netAvWinPerShare`,
`grossAvLossPerShare`, `netAvLossPerShare`, `grossHighWinPerShare`,
`netHighWinPerShare`, `grossHighLossPerShare`, `netHighLossPerShare`,
`grossR`, `netR`, `grossMfeR`, `netMfeR` (Formeln in 4.1). Ist `totals` leer,
bleibt `profitAnalysis` leer.

### 3.6 Form von `groups` und Schlüsselreihenfolge

Alle Gruppen bilden Schlüssel auf Listen ab. Gruppenschlüssel entstehen wie bei
lodash `groupBy`: der Schlüssel ist die Zeichenkette des berechneten Werts
(`undefined` → „undefined“). JavaScript ordnet ganzzahlige
Zeichenkettenschlüssel (Array-Indizes bis 2³²−2, z. B. „5“, „1760918400“)
immer numerisch aufsteigend und vor allen anderen; für alle übrigen
(Zeichenketten-)Schlüssel zählt die Einfügereihenfolge. Weil `charts.js`
Schlüssel in dieser Reihenfolge in Diagrammachsen übernimmt, MUSS der Neubau
die angegebene Einfügereihenfolge einhalten.

Basisliste „alle gefilterten Trades“ (im Folgenden L) = die Trades aus
`filteredTrades` in dessen Reihenfolge (Tage absteigend nach `dateUnix`, bei
gleichem `dateUnix` die DB-Reihenfolge), innerhalb eines Tages in der
Reihenfolge der Tageszeile. Listen in einer Gruppe behalten die Reihenfolge
ihrer Quelle, sofern nicht anders gesagt. Die Einträge sind (ausser bei
`tags`/Tag-Gruppen und `trades`) die gefilterten Trade-Objekte selbst.

| Schlüssel | Quelle | Gruppenschlüssel | Besonderheit |
|---|---|---|---|
| `day` | L | Wochentag 0 (So) – 6 (Sa) von `entryTime` in der **Prozesszeitzone** (nicht `timeZoneTrade`) | – |
| `timeframe` | L | Einstiegszeit auf `timeFrame` Minuten abgerundet (auf die absolute Epoche in ms), dann in `timeZoneTrade` als „HH:mm“ | Schlüssel lexikographisch aufsteigend sortiert eingefügt |
| `duration` | L, vorher stabil nach Dauer (`exitTime − entryTime`, Sekunden) aufsteigend sortiert | Dauer in Minuten d: d<1 → 0; 1≤d<2 → 1; 2≤d<5 → 2; 5≤d<10 → 5; 10≤d<20 → 10; 20≤d<40 → 20; 40≤d<60 → 40; d≥60 → 60; NaN → „undefined“ | Listen innerhalb eines Schlüssels nach Dauer aufsteigend |
| `trades` | Werte von `totalsByDate` (Tagessummen, dieselben Objekte), in Schlüsselreihenfolge (td aufsteigend) | n = Feld `trades` des Tages: n ≤ 30 → ⌈n/5⌉·5; n > 30 → 30 | Einträge sind Tagessummen, keine Trades |
| `executions` | L | `executionsCount` | – |
| `position` | L | `strategy` | – |
| `tradeType` | L, nur Trades mit nichtleerem `tradeType` | `tradeType` | – |
| `tags` | siehe unten | Tag-ID | – |
| `group_*` (je Tag-Gruppe) | siehe unten | Gruppen-ID als Schlüssel von `groups`, darin Tag-ID | werden nie entfernt (Altfehler 7.1) |
| `symbols` | L | `symbol` | – |
| `shareFloat` | L, nur Trades mit Pfad `financials.publicFloat` | Wert v = `financials.publicFloat.finviz`; v = '-' → „undefined“; v < 20 Mio → ⌊v/5 Mio⌋·5 Mio; 20 Mio ≤ v < 50 Mio → ⌊v/10 Mio⌋·10 Mio; v ≥ 50 Mio → 50 Mio | Krypto: immer `{}` |
| `mktCap` | L, ebenfalls nur Trades mit Pfad `financials.publicFloat` | m = `financials.mktCap`; m null/undefined → „undefined“; m ≤ 50 Mio → 50 Mio; ≤ 300 Mio → 300 Mio; ≤ 2000 Mio → 2000 Mio; ≤ 10000 Mio → 10000 Mio; sonst 10001 Mio | Krypto: immer `{}` |
| `entryPrice` | L | p < 30 → ⌊p/5⌋·5; p ≥ 30 → 30; NaN → „undefined“ | – |

**Tags und Tag-Gruppen:** Aus L wird eine flache Liste gebildet: je Trade und
je Element seiner `tags`-Liste ein Eintrag (Reihenfolge: L, dann
Tag-Reihenfolge im Trade). Ein Trade ohne `tags`-Feld würde einen Eintrag mit
Tag `{id:'no_tags', name:'No Tags'}` erzeugen; gefilterte Trades haben aber
immer eine `tags`-Liste (ggf. leer → kein Eintrag). Zu jedem Eintrag wird über
`useGetTagInfo(tag.id)` die Gruppe bestimmt und am geteilten Tag-Objekt
`groupName` (= `tagGroupName`) und `groupId` (= `tagGroupId`) gesetzt.
Eintragsform in den Gruppen: ein neues Objekt mit `tagName` (= Tag-Name),
`tagGroupName` (= Gruppenname), allen eigenen Feldern des Trades und `tag`
(das Tag-Objekt). `groups.tags` = Einträge nach `tag.id` gruppiert
(Schlüssel in Reihenfolge des ersten Auftretens). Für jede Gruppen-ID
(Reihenfolge des ersten Auftretens, unbekannte Tags → „undefined“) wird
`groups[<Gruppen-ID>]` = die Einträge dieser Gruppe nach `tag.id` gruppiert
(eigene, inhaltsgleiche Eintragsobjekte). Bestehende `groups[<Gruppen-ID>]`
anderer Gruppen bleiben stehen.

---

## 4. Öffentliche Schnittstelle und Verhalten je Datei

Fehlerbehandlung allgemein: Wo nicht anders vermerkt, werfen DB-Fehler nach
aussen bzw. lassen das Promise unerfüllt (siehe Altfehler).

### 4.1 `src/utils/trades.js`

Modulzustand: die zuletzt geladenen Tageszeilen (Liste) sowie die zuletzt von
`useTotalTrades` gebildete flache Trade-Liste L und die Tagessummen – beides
wird von `useGroupTrades` weiterbenutzt. `useGroupTrades` und
`useCalculateProfitAnalysis` setzen also voraus, dass vorher
`useTotalTrades` lief.

#### `useGetTrades(param)` → Promise<void>

Lädt Tageszeilen in den Modulzustand und nach `imports.value`.
Abfrage `trades`, immer mit `exclude: ['executions','blotter','pAndL']`:

- `pageId` = 'imports' ODER `param` = 'imports': absteigend nach `dateUnix`,
  Limit 20.
- `pageId` = 'addExcursions': `dateUnix` ≥ (jetzt − `daysBack` Tage) und
  < jetzt (beides Sekunden, Prozesszeit), aufsteigend; kein Limit.
- sonst: Ist `selectedRange` = {0,0}: aufsteigend, Limit `queryLimit`.
  Andernfalls `dateUnix` ≥ `start` und < `end`, aufsteigend, Limit
  `queryLimit`.

Ergebnis nicht leer: Modulzustand = Kopie der Liste, `imports.value` = Kopie.
Leer: Modulliste geleert, `imports.value` = []. (Zusätzlich wird auf dem
Ref-Objekt `imports` eine Eigenschaft `length` = 0 gesetzt – harmlos.)
Aufrufer: `useGetFilteredTrades`, `useDeleteTrade`, `AddExcursions.vue`.

#### `useGetFilteredTrades(param)` → Promise<void>

`param` wird ignoriert. Liest: `selectedRange`, `selectedTags`,
`selectedPositions`, `selectedAccounts`, `selectedBroker`,
`selectedTradeCategory`, `timeZoneTrade`, `pageId`, `tags`,
`satisfactionArray`, `satisfactionTradeArray`, `excursions`,
`availableTags`. Schreibt: `filteredTrades`, `filteredTradesDaily`,
`filteredTradesTrades`, `hasData`, `blotter`, `pAndL`, `imports`.

Ablauf:

1. `useGetTrades()`.
2. `filteredTrades`, `filteredTradesDaily`, `filteredTradesTrades` leeren.
3. Nachschlagetabellen (bei Mehrfachtreffern gewinnt jeweils der SPÄTERE
   Eintrag in Store-Reihenfolge):
   - Trade-Tags: für jede Zeile in `tags` mit `tradeId` ≠ null/undefined:
     Zeichenkette(`tradeId`) → `tags` (wenn keine Liste: []).
   - Tages-Tags: für jede Zeile in `tags` mit `dateUnix` ≠ null/undefined:
     Zeichenkette(`dateUnix`) → `tags` (wenn keine Liste: []). Achtung: auch
     Trade-Ebenen-Zeilen landen hier unter ihrem `dateUnix`.
   - Tages-Zufriedenheit: Zeichenkette(`dateUnix`) → `satisfaction` aus
     `satisfactionArray`.
   - Trade-Zufriedenheit: Zeichenkette(`tradeId`) → `satisfaction` aus
     `satisfactionTradeArray`.
   - Exkursion: Zeichenkette(`tradeId`) → Exkursionszeile aus `excursions`.
   - Trade-Typ: eine DB-Abfrage `notes` mit
     `exclude: ['note','title','entryNote','feelings','playbook','closingNote','closingFeelings','closingPlaybook','tradingMetadata','aiReview','aiReviewProvider','aiReviewModel']`
     und – sofern die geladenen Tageszeilen ein endliches kleinstes und
     grösstes `dateUnix` haben – `dateUnix` ≥ Minimum und ≤ Maximum. Aus jeder
     Notiz mit wahrem `tradeType` und wahrer `tradeId`: Zeichenkette(`tradeId`)
     → `tradeType`.
   - Tag-Namen: aus `availableTags` (Gruppen ohne `tags` überspringen) Tag-ID
     → Tag-Name.
4. Sind Tageszeilen geladen (Anzahl > 0), wird `hasData` = true gesetzt –
   unabhängig davon, ob danach etwas den Filter passiert. Auf false setzt die
   Funktion `hasData` nie.
5. Für jede Tageszeile in Ladereihenfolge, die ein wahres `trades`-Feld hat:
   Tageskopie anlegen (3.5). Für jeden Trade der Zeile die Filterprüfung
   (unten); bei Erfolg Trade anreichern (3.5), an die Tageskopie und an
   `filteredTradesTrades` anhängen. Hat die Tageskopie danach mindestens einen
   Trade, wird sie an `filteredTrades` und `filteredTradesDaily` angehängt
   (dasselbe Objekt in beiden Listen).
6. `useCreateBlotter(true)` und `useCreatePnL()` (journal-alt.js).
7. Für jeden Schlüssel von `pAndL`: die Tageskopie mit gleichem `dateUnix`
   (Zeichenkettenvergleich) bekommt `pAndL` und `blotter` dieses Schlüssels.
   Gibt es mehrere Tageskopien mit gleichem `dateUnix`, bekommt NUR die LETZTE
   in der Reihenfolge von Schritt 5 die Werte (Altfehler 7.2).
8. `filteredTrades` stabil nach `dateUnix` absteigend sortieren.
   `filteredTradesDaily` bleibt in Ladereihenfolge.

Jeder Fehler wird gefangen und mit `console.error` gemeldet (darf in den Tests
nicht vorkommen).

**Filterprüfung je Trade** (alle Bedingungen UND-verknüpft):

- **Börse:** `selectedBroker` leer/falsy ODER `trade.broker` = `selectedBroker`.
- **Kategorie:** c = `selectedTradeCategory` oder 'all'. Agent-Trade ⇔
  `category` = 'agent'; Bot-Trade ⇔ `botType` wahr. Ist c = 'agent', passen
  nur Agent-Trades. Sonst passen Agent-Trades NIE, und zusätzlich: c = 'all'
  → alle übrigen; c = 'bot' → nur Bot-Trades; jeder andere Wert (z. B.
  'futures') → nur Nicht-Bot-Trades.
- **Zeitraum** (über `trade.td`): bei `selectedRange` = {0,0}: `td` ≥ 0;
  sonst `start` ≤ `td` < `end`.
- **Richtung:** `selectedPositions` enthält `trade.strategy`.
- **Konto:** c = 'bot' ODER `selectedAccounts` leer ODER `selectedAccounts`
  enthält `trade.account` ODER `trade.account` = `selectedBroker`.
- **Tags:** S = Menge der Werte in `selectedTags`; „ohne Tag gewählt“ ⇔ S
  enthält 't000t'. Der Trade passt, wenn mindestens eine der folgenden Regeln
  greift:
  - Bot-Trade (`botType` wahr) oder Agent-Trade – immer.
  - Trade-Tags (Nachschlagen über Zeichenkette(`id`)): Liste nicht leer und
    mindestens ein Element in S; ODER Liste leer und „ohne Tag gewählt“.
  - Tages-Tags (Nachschlagen über Zeichenkette(`td`)): Liste nicht leer und
    mindestens ein Element in S; ODER Liste leer und „ohne Tag gewählt“.
  Folge: Mit nur 't000t' gewählt passt auch ein Trade, der Trade-Tags hat,
  solange für seinen Tag keine Tages-Tags existieren (die zweite Quelle greift).

**Anreichern der `tags`:** zuerst die Trade-Tags, dann die Tages-Tags, jeweils
in ihrer Reihenfolge; aufgenommen wird eine ID nur, wenn sie in S liegt, noch
nicht aufgenommen wurde und in `availableTags` einen Namen hat; Element
`{id, name}`.

Aufrufer: `mountOrchestration.js` (alle Mounts ausser Screenshots),
Golden Master.

#### `useGetFilteredTradesForDaily()` → void (synchron)

Hängt Tage aus `filteredTradesDaily` an `filteredTrades` an: für alle Indizes
von `dailyPagination` bis `dailyPagination + dailyQueryLimit − 1`: fehlt das
Element, `endOfList` = true; sonst wird es angehängt, falls noch kein Tag mit
gleichem `dateUnix` (Zeichenkettenvergleich) in `filteredTrades` steht.
Danach `dailyPagination` += `dailyQueryLimit`. Da `useGetFilteredTrades`
bereits alle Tage in `filteredTrades` legt, wird praktisch nie etwas
angehängt. Aufrufer: `useLoadMore`.

#### `useTotalTrades()` → Promise<void>

Liest `filteredTrades`; schreibt `totals`, `totalsByDate` und den
Modulzustand (L, Tagessummen).

- L bilden (3.6) und jeden Trade in dieser Reihenfolge mit `summiereTrade` auf
  einen frischen Akkumulator addieren; `cashJournal`-Gebühren je Tag in der
  Reihenfolge von `filteredTrades` addieren.
- `totals` leeren und mit der Vereinigung aus Summen, `leiteKennzahlenAb`
  (aus den Summen) und den Zusatzfeldern (3.5) füllen.
- Tagessummen: L stabil nach `td` aufsteigend ordnen, nach `td` gruppieren;
  je Tag einen frischen Akkumulator, die Trades in dieser Reihenfolge
  summieren, dann `financials` = `financials` des ersten Trades dieser
  Gruppe. `totalsByDate` leeren und mit diesen Objekten füllen (Schlüssel
  `td`). Die Objekte sind zugleich die Quelle von `groups.trades`.

Summationsreihenfolge: Die Golden-Master-Toleranz (1e-9 relativ, mindestens
1e-9 absolut) fängt Rundungsunterschiede aus einer anderen Reihenfolge in aller
Regel auf; empfohlen ist trotzdem genau die beschriebene Reihenfolge.
Aufrufer: `useMountDashboard`, Golden Master.

#### `useGroupTrades()` → Promise<void>

Schreibt `groups.day`, `groups.timeframe`, `groups.duration`, `groups.trades`,
`groups.executions`, `groups.position`, `groups.tradeType`, `groups.tags`,
`groups[<Gruppen-ID>]`, `groups.symbols`, `groups.shareFloat`,
`groups.mktCap`, `groups.entryPrice` gemäss 3.6. Liest `timeFrame`,
`timeZoneTrade`, `availableTags` (über `useGetTagInfo`). Die Schlüssel von
`groups` werden NICHT vorher geleert; alle genannten festen Schlüssel werden
überschrieben, Gruppen-ID-Schlüssel nur für die im aktuellen Lauf
vorkommenden Gruppen (Altfehler 7.1). Mutiert die Tag-Objekte der Trades
(`groupName`, `groupId`). Aufrufer: `useMountDashboard`, Golden Master.

#### `useCalculateProfitAnalysis(param)` → Promise<void>

`param` ignoriert. Liest `totals`, `excursions`, `filteredTrades`; schreibt
`profitAnalysis` (vorher geleert). Nur wenn `totals` nicht leer ist:

- `grossAvWinPerShare` = `grossSharePLWins` / `grossWinsCount` (wenn
  `grossWinsCount` = 0 → 0); `netAvWinPerShare` analog mit den Netto-Feldern.
- `grossAvLossPerShare` = −`grossSharePLLoss` / `grossLossCount` (Zähler 0 →
  0); `netAvLossPerShare` analog.
- `grossHighWinPerShare` = `totals.highGrossSharePLWin`;
  `netHighWinPerShare` = `totals.highNetSharePLWin`.
- `grossHighLossPerShare` = −`totals.highGrossSharePLLoss`;
  `netHighLossPerShare` = −`totals.highNetSharePLLoss`.
- `grossR` = `grossAvWinPerShare` / `grossAvLossPerShare` (Nenner 0 → 0);
  `netR` analog.
- MFE-R-Listen: für jede Zeile in `excursions` (Store-Reihenfolge), sofern
  `filteredTrades` nicht leer: die ERSTE Tageskopie in `filteredTrades` mit
  `dateUnix` == Exkursion.`dateUnix` (lose Gleichheit) suchen; darin den Trade
  mit `id` == Exkursion.`tradeId`. Gefunden → r_g = `mfeR(trade,
  mfePrice, grossAvLossPerShare)`, r_n = `mfeR(trade, mfePrice,
  netAvLossPerShare)`; jeweils nur Nicht-null-Werte in die Brutto- bzw.
  Netto-Liste. (Liegt der Trade in einer ANDEREN Tageskopie mit gleichem
  `dateUnix`, wird er nicht gefunden – Altfehler 7.2.)
- Erwartungswert in R: E(w, R) = w · R − (1 − w) · 1.
  Aktueller Erwartungswert: E_g = E(`totals.probGrossWins`, `grossR`),
  E_n = E(`totals.probNetWins`, `netR`).
- Zielstufen R = 1; 1,5; 2; …; 20 (Schritt 0,5, 39 Stufen, aufsteigend). Je
  Stufe: Trefferquote w = Anzahl Listenwerte ≥ Stufe / Listenlänge (leere
  Liste → 0), Erwartungswert E(w, Stufe). Die beste Stufe ist die erste mit dem
  strikt grössten Erwartungswert (Startwert −∞, also wird mindestens Stufe 1
  gewählt).
- `grossMfeR` = beste Brutto-Stufe, wenn die Brutto-Liste mindestens 10
  Werte hat UND ihr Erwartungswert strikt grösser als E_g ist, sonst null.
  `netMfeR` analog mit Netto-Liste und E_n.

Aufrufer: `useMountDashboard`, Golden Master.

#### `useDeleteTrade()` → Promise<void>

Löscht den Handelstag `selectedItem` (ein `dateUnix`). Börse b =
`selectedBroker` oder 'bitunix'. Erste Zeile `trades` mit `dateUnix` =
`selectedItem` und `broker` = b suchen (`dbFirst`); ohne Treffer erste Zeile
nur mit `dateUnix`. Gefunden:
1. Zeile löschen (`dbDelete` über `objectId`).
2. In `notes`, `tags`, `satisfactions` alle Zeilen mit `dateUnix` =
   `selectedItem` löschen (`dbDeleteWhere`), jede Tabelle einzeln, Fehler je
   Tabelle nur protokollieren. Screenshots bleiben.
3. POST `/api/<Börse der gelöschten Zeile oder 'bitunix'>/last-import` mit
   `{timestamp: 0}`; Fehler nur protokollieren.
4. `refreshAccountBalance({broker, force: true})`; Fehler nur protokollieren.
5. `useGetTrades('imports')` (nicht abgewartet).
Nicht gefunden: `alert(t('common.deleteTradeFailed'))` und Fehler werfen.
Aufrufer: `utils.js` (Popover-Bestätigung auf der Seite `imports`).

#### `useDeleteExcursions()` → Promise<void>

Löscht alle `excursions` mit `dateUnix` = `selectedItem`. Fehler:
`alert(t('common.deleteExcursionsFailed'))` und weiterwerfen. Aufrufer:
`utils.js`.

### 4.2 `src/utils/journal-alt.js`

Modulzustand: eine Symbolliste mit Start- und Enddatum (für `useGetOHLCV`),
eine Kerzenliste `ohlcv` (Liste `{symbol, ohlcv}`) und eine MFE-Preisliste
`mfePrices`, die NIE geleert wird (Altfehler 7.5). PapaParse wird erst beim
ersten Gebrauch dynamisch geladen (Bundle-Grösse).

#### `useGetExistingTradesArray(param99, param0)` → Promise<void>

Leert `existingTradesArray`; Abfrage `trades` absteigend nach `dateUnix`,
Limit `queryLimitExistingTrades`; hängt je Zeile deren `date`
(Zeichenkette `YYYY-MM-DD`) an; `gotExistingTradesArray` = true. Bei
DB-Fehler bleibt das Promise unerfüllt (Altfehler 7.6). Aufrufer:
`AddTrades.vue`, MFE-Test.

#### `useCreateOHLCV(csv, ziel)` → Promise<ziel>

`ziel` hat die Form `{symbol, ohlcv: []}`. Das CSV (Databento, Kopfzeile mit
`ts_event, rtype, publisher_id, instrument_id, open, high, low, close,
volume, symbol`) wird mit Kopfzeilen-Erkennung geparst (PapaParse,
`header: true`, Leerzeilen NICHT übersprungen). Für jede Datenzeile mit
nichtleerem `ts_event` wird eine Kerze an `ziel.ohlcv` angehängt:
`v` = Zahl(`volume`), `o` = Zahl(`open`), `c` = Zahl(`close`),
`h` = Zahl(`high`), `l` = Zahl(`low`), `t` = Zeitpunkt von `ts_event` als UTC
gelesen, auf ganze Sekunden abgerundet, mal 1000 (ms). (Die zwischengeschaltete
Umrechnung in `timeZoneTrade` ändert den Zeitpunkt nicht.) Nach der LETZTEN
geparsten Zeile (auch wenn diese leer ist, etwa wegen eines abschliessenden
Zeilenumbruchs) wird `ziel` an die Modul-Kerzenliste angehängt und das Promise
mit genau dem übergebenen `ziel`-Objekt erfüllt. Ergibt das Parsen keine
einzige Zeile, bleibt das Promise unerfüllt (Altfehler 7.6). Vor dem Parsen
steht mindestens ein `await` (das Nachladen von PapaParse); das ist für das
Zeitverhalten von `useGetOHLCV` relevant. Aufrufer: `useGetOHLCV`,
`Daily.vue`, MFE-Test.

#### `useGetOHLCV(quelle, modus, symbole, von, bis)` → Promise

`quelle` ∈ {'databento', 'polygon'}, `modus` ∈ {'api', sonst}. `symbole`
(Liste `{symbol, secType}`), `von`, `bis` (Sekunden) überschreiben den
Modulzustand nur, wenn sie wahr sind. Die Modul-Kerzenliste wird zu Beginn
geleert. Enddatum e = Ende des Kalendertags von `bis` in der
**Prozesszeitzone** (letzte Sekunde), in Sekunden. Für jedes Symbol der Reihe
nach:

- **databento:** Anfragekörper (Schlüssel in dieser Reihenfolge):
  `dataset` (secType 'future' → 'GLBX.MDP3', 'stock' → 'XNAS.ITCH', sonst
  undefined), `stype_in` ('future' → 'continuous', sonst 'raw_symbol'),
  `symbols` ('future' → Symbol + '.c.0', sonst Symbol), `schema`
  'ohlcv-1m', `start` = von · 1 000 000 000, `end` = e · 1 000 000 000 (beide
  als gewöhnliche Number-Multiplikation, NICHT BigInt – die Werte überschreiten
  2⁵³ und müssen genau dieselbe Double-Zahl ergeben), `encoding` 'csv',
  `pretty_px` 'true', `pretty_ts` 'true', `map_symbols` 'true', `username` =
  `key` des ersten Eintrags in `currentUser.apis` mit `provider` 'databento'.
  - `modus` ≠ 'api': POST `/api/databento` mit diesem Körper, OHNE auf die
    Antwort zu warten, bevor das nächste Symbol angefragt wird. Je Antwort:
    `useCreateOHLCV(Antwortdaten, {symbol, ohlcv: []})`, danach wird das Promise
    mit der Modul-Kerzenliste erfüllt (nur die erste Erfüllung zählt). Fehler:
    Ablehnung mit dem Fehler.
  - `modus` = 'api': direkte Anfrage an
    `https://hist.databento.com/v0/timeseries.get_range` (POST, form-urlencoded,
    Basic-Auth aus Schlüssel und leerem Passwort über `Buffer`); Erfüllung OHNE
    Wert nach der ersten verarbeiteten Antwort. (Im Browser fehlt `Buffer` –
    toter Pfad.)
- **polygon:** Vor jedem Symbol wird ein zuvor registrierter
  Antwort-Interceptor (`window._polygonInterceptorId`) entfernt und ein neuer
  registriert: Fehler ohne `config.retry` → Ablehnung; Status ≠ 429 →
  `alert('Error getting OHLCV with message: ' + Fehlermeldung)` und Ablehnung;
  429 → `retry` herunterzählen und nach `retryDelay` (Vorgabe 1000 ms) erneut
  anfragen. Dann GET `/api/polygon/aggs` (abgewartet) mit Konfiguration
  `{params: {ticker: Symbol, from: von·1000, to: e·1000, interval: 1, span:
  'minute', adjusted: true, sort: 'asc', limit: 50000}, headers:
  {'x-polygon-api-key': key des ersten apis-Eintrags mit provider 'polygon'},
  retry: 5, retryDelay: 60000}`. Antwort: `{symbol, ohlcv:
  Antwort.results}` (fehlt `results`, ist `ohlcv` undefined) an die
  Modul-Kerzenliste anhängen und das Promise mit der Liste erfüllen.

Beobachtbares Zeitverhalten, das der MFE-Golden-Master prüft (Altfehler 7.7):
Polygon erfüllt nach dem ERSTEN Symbol; im Moment der Erfüllung hat die Liste
die Länge 1, die weiteren Symbole werden danach angehängt (Test: 3 nach
kurzem Warten). Databento (nicht 'api') schickt alle Anfragen sofort ab; im
Golden-Master-Lauf (Antworten ohne Netzverzögerung, PapaParse schon geladen)
hat die Liste beim Erfüllen bereits Länge 2 (beide Symbole), weil beide
Antworten in denselben Mikrotask-Runden verarbeitet werden, bevor die
Fortsetzung des Aufrufers läuft. Reihenfolge der Einträge: Reihenfolge der
Symbole. Aufrufer: `AddExcursions.vue`, MFE-Test.

#### `useGetMFEPrices(ausf, einstiegZeit, einstiegPreis, trade, kerzen)` → Promise<mfePrices>

Liest `timeZoneTrade`, `marketCloseTime`. Ist `kerzen` gegeben, ersetzt es
die Modul-Kerzenliste. Gibt IMMER die gesamte Modulliste `mfePrices` zurück.

1. Eintrag mit `symbol` == `ausf.symbol` in der Kerzenliste suchen. Gibt es
   keinen, wirft der Zugriff, und das Promise bleibt für immer unerfüllt
   (Altfehler 7.6). Ist sein `ohlcv` undefined: nichts tun, mit der Liste
   erfüllen.
2. E = einstiegZeit·1000, X = `trade.exitTime`·1000. i₀ = erster Index mit
   Kerze.t ≥ E; j₀ = erster Index mit Kerze.t ≥ X. Ist einer davon nicht
   vorhanden: mit der Liste erfüllen (kein Eintrag).
3. Start s = i₀ + 1, wenn Kerze[i₀].t genau E ist, sonst i₀. Ende f = j₀,
   wenn Kerze[j₀].t genau X ist, sonst j₀ − 1. Existiert Kerze[s] oder
   Kerze[f] nicht: erfüllen ohne Eintrag. T_s = Kerze[s].t, T_f = Kerze[f].t.
4. Marktschluss: Kalenderdatum (Jahr, Monat, Tag) von T_f in
   `timeZoneTrade`; Zeitpunkt = dieses Datum mit Uhrzeit `marketCloseTime`
   als Wandzeit in `timeZoneTrade`. k = (erster Index mit Kerze.t ≥ diesem
   Zeitpunkt) − 1; gibt es keinen, ist k = −2.
5. Ist T_f < T_s (Ein- und Ausstieg in derselben Kerze bzw. gekreuzt): Eintrag
   `{tradeId: trade.id, dateUnix: ausf.td, mfePrice: einstiegPreis}`
   anhängen; `trade.excursions` wird NICHT gesetzt.
6. Sonst: m = einstiegPreis.
   - Für Index s bis f: bei 'long', wenn high > `trade.exitPrice` und high >
     m → m = high; bei 'short', wenn low < `trade.exitPrice` und low < m →
     m = low.
   - Gewinn-Differenz d = Ausstieg − Einstieg (long) bzw. Einstieg −
     Ausstieg (short); andere Richtung → undefiniert (gilt als nicht > 0).
     Ist einstiegPreis ≠ `exitPrice` und d > 0: Laufpreis p = high (long) bzw.
     low (short) von Kerze[f]; Index i = f; solange (long: p > einstiegPreis;
     short: p < einstiegPreis) und i ≤ k gilt: p = high bzw. low von Kerze[i];
     ist (long) p > einstiegPreis und p > m → m = p (short spiegelbildlich);
     i um 1 erhöhen. (Die Bedingung prüft also den Preis des VORIGEN Schritts.)
   - Klemmen: long und m < einstiegPreis → m = einstiegPreis; short und
     m > einstiegPreis → m = einstiegPreis.
   - `trade.excursions` = `{stopLoss: null, maePrice: null, mfePrice: m}`;
     Eintrag `{tradeId: trade.id, dateUnix: ausf.td, mfePrice: m}` anhängen.
7. Mit der Liste erfüllen.

Aufrufer: `AddExcursions.vue`, `Daily.vue`, MFE-Test.

#### `useUpdateMfePrices(param99, param0, param2)` → Promise<void>

Alle Parameter ignoriert. Für jeden Eintrag der Modulliste `mfePrices` der
Reihe nach: `dbCreate('excursions', {mfePrice, dateUnix, tradeId})`; nach
jedem Erfolg `tradeId.value` = `tradeExcursionId.value`; nach dem letzten
Eintrag erfüllen. Ein Fehler lehnt (ohne Wert) ab, die Schleife läuft aber
weiter. Ist die Liste leer, bleibt das Promise unerfüllt (Altfehler 7.6).
Aufrufer: `useUploadTrades`, `AddExcursions.vue`, MFE-Test.

#### `useCreateBlotter(ausGefiltert)` → Promise<void>

Quelle: `ausGefiltert` wahr → `filteredTradesTrades`, stabil nach
`entryTime` aufsteigend geordnet und nach `td` gruppiert; sonst der Store
`trades` (Objekt `td` → Liste). Jede Trade-Liste eines Tages wird stabil nach
`entryTime` aufsteigend geordnet und nach `symbol` gruppiert. Beide Gruppierungen
laufen über eine JSON-Rundreise (Folge: `NaN`/±Infinity werden `null` und
zählen in Summen wie 0; fehlende Felder bleiben `undefined` und machen die
Summe `NaN`). `blotter` wird geleert und mit `td` → Symbol → Objekt gefüllt.
Felder je Symbol (Summen über dessen Trades in der genannten Reihenfolge, OHNE
Absicherung gegen fehlende Werte):

- `symbol` (= Schlüssel), `type` (= `type` des ersten Trades)
- `buyQuantity`, `sellQuantity`, `commission`, `sec`, `taf`, `nscc`,
  `nasdaq` = Summen der gleichnamigen Felder
- `otherCommission` = Σ(`sec` + `taf` + `nscc` + `nasdaq`)
- `fees` = Σ(`commission` + `sec` + `taf` + `nscc` + `nasdaq`)
- `grossProceeds`, `grossWins`, `grossLoss`, `grossSharePL`,
  `grossSharePLWins`, `grossSharePLLoss` = Summen
- `highGrossSharePLWin` = grösster `grossSharePL` unter den Trades mit
  `grossSharePL` ≥ 0, mindestens 0; `highGrossSharePLLoss` = kleinster
  negativer `grossSharePL`, höchstens 0
- Netto-Felder analog: `netProceeds`, `netWins`, `netLoss`, `netSharePL`,
  `netSharePLWins`, `netSharePLLoss`, `highNetSharePLWin`,
  `highNetSharePLLoss`
- `executions` = Σ `executionsCount`, `trades` = Σ `tradesCount`
- `grossWinsQuantity`, `grossLossQuantity`, `grossWinsCount`,
  `grossLossCount`, `netWinsQuantity`, `netLossQuantity`, `netWinsCount`,
  `netLossCount` = Summen

Aufrufer: `useGetFilteredTrades` (mit true), `AddTrades.vue` (ohne), MFE-Test.

#### `useCreatePnL()` → Promise<void>

Aus `blotter`: je `td` ein Objekt mit denselben Summenfeldern wie der
Blotter (ohne `symbol`, `type`), summiert über die Symbole in
Schlüsselreihenfolge des Blotter-Tages: `buyQuantity`, `sellQuantity`,
`commission`, `sec`, `taf`, `nscc`, `nasdaq`, `otherCommission`, `fees`,
`grossProceeds`, `grossWins`, `grossLoss`, `grossSharePL`,
`grossSharePLWins`, `grossSharePLLoss`, `highGrossSharePLWin` (Maximum der
Symbolwerte, Start 0), `highGrossSharePLLoss` (Minimum, Start 0), die
Netto-Entsprechungen, `executions`, `trades`, `grossWinsQuantity`,
`grossLossQuantity`, `grossWinsCount`, `grossLossCount`,
`netWinsQuantity`, `netLossQuantity`, `netWinsCount`, `netLossCount`.
`pAndL` wird geleert und gefüllt. Aufrufer: wie `useCreateBlotter`.

#### `useUploadTrades(param99, param0)` → Promise<void>

(Wird als Klick-Handler aufgerufen; `param99` ist dann das Ereignis.)
`spinnerLoadingPage` = true (wird nicht zurückgesetzt). Für jeden Schlüssel k
von `executions` in Schlüsselreihenfolge, nacheinander:
`openPositions` = es gibt in `trades[k]` einen Trade mit `openPosition` ==
true – ist `trades[k]` nicht vorhanden, ergibt sich true (Altfehler 7.8);
`dbCreate('trades', {date: k als Sekunden in der Prozesszeitzone formatiert
'YYYY-MM-DD', dateUnix: Zahl(k), openPositions, broker: selectedBroker oder
'bitunix', executions: executions[k], trades: trades[k], blotter: blotter[k],
pAndL: pAndL[k]})`. Fehlgeschlagene Tage werden gesammelt (Datum, Grund) und
am Ende per `alert` gemeldet: „<n> Handelstag(e) importiert, <m>
fehlgeschlagen:“, Zeilenumbruch, je Tag „<Datum>: <Grund>“. Gibt es
Ausführungen und ist `mfePrices` nicht leer: `useUpdateMfePrices()`
abwarten. Zum Schluss `window.location.href` = '/dashboard'.
Aufrufer: `AddTrades.vue`, MFE-Test.

### 4.3 `src/utils/daily.js`

Modulzustand: ein ungenutzter Seitenzähler für Zufriedenheiten und eine Sperre
gegen parallele Läufe von `useGetAvailableTags`.

#### Laden

- **`useGetSatisfactions()`** → Promise<void>: leert `satisfactionTradeArray`
  und `satisfactionArray`. Abfrage `satisfactions` absteigend nach
  `dateUnix`, ausser bei `selectedRange` = {0,0} mit `dateUnix` ≥ `start`,
  < `end`, Limit `queryLimit`. Je Zeile `{tradeId, satisfaction, dateUnix}`;
  `tradeId` ≠ undefined/null und ≠ '' → `satisfactionTradeArray`, sonst
  `satisfactionArray`. Aufrufer: Mounts Dashboard/Daily/Auswertung, Test.
- **`useGetExcursions()`** → Promise<void>: Abfrage `excursions` aufsteigend
  nach `dateUnix`. Seite 'addExcursions': `dateUnix` ≥ jetzt − `daysBack`
  Tage, < jetzt, ohne Limit. Sonst Zeitraum wie oben (ausser {0,0}), Limit
  `queryLimit`. `excursions` leeren und mit den rohen Zeilen füllen.
  Aufrufer: Mounts Dashboard/Daily, `AddExcursions.vue`, `Daily.vue`, Test.
- **`useGetTags()`** → Promise<void>: leert `tags`. Abfrage `tags` mit Limit
  `queryLimit`, OHNE Sortierung (Reihenfolge der DB); nur auf der Seite
  'daily' zusätzlich `dateUnix` ≥ `start`, < `end` (ohne {0,0}-Sonderfall).
  Je Zeile `{tradeId, tags, dateUnix}`. Aufrufer: alle Mounts, `useSetValues`,
  `Daily.vue`, Test.
- **`useGetAvailableTags()`** → Promise<void>: Läuft bereits ein Aufruf, wird
  dessen Promise geteilt. Liest die Einstellungen (`dbGetSettings`);
  `availableTags` wird geleert und, wenn `settings.tags` eine nicht leere Liste
  ist, mit deren Gruppenobjekten gefüllt. Aufrufer: Layout, Mounts
  Daily/Calendar/Screenshots, `useSetValues`, `Daily.vue`, `Incoming.vue`,
  `Playbook.vue`, Test.
- **`useGetNotes()`** → Promise<void>: leert `notes`; Abfrage `notes` mit
  `dateUnix` ≥ `start`, < `end` (kein {0,0}-Sonderfall), Limit `queryLimit`;
  je Zeile `{tradeId, note, dateUnix, tradingMetadata (oder null), tradeType
  (oder ''), closingTradeType (oder '')}`. Aufrufer: `useMountDaily`,
  `Daily.vue`.
- **`useGetAuswertungNotes()`** → Promise<void>: leert `auswertungNotes`;
  Abfrage `notes` Limit `queryLimit`, Zeitraum ausser bei {0,0}; je Zeile
  `{tradeId, dateUnix, note, entryStressLevel (oder 0), emotionLevel (oder
  0), feelings (oder ''), playbook (oder ''), timeframe (oder ''), entryNote
  (oder '')}`. Aufrufer: `useMountAuswertung`.

#### Tags

- **`useGetTagInfo(tagId)`** → Objekt (synchron): erste Gruppe in
  `availableTags`, deren `tags` die ID enthält → `{tagGroupId: Gruppe.id,
  tagGroupName: Gruppe.name, groupColor: Gruppe.color, tagName: Tag.name}`.
  Nicht gefunden → `{groupColor, tagName: ''}` mit `groupColor` = Farbe der
  ersten Gruppe, falls vorhanden und wahr, sonst '#6c757d' (keine Schlüssel
  `tagGroupId`/`tagGroupName`). Aufrufer: `useGroupTrades`, `Screenshot.vue`,
  `Daily.vue`, `Incoming.vue`, `Playbook.vue`.
- **`useCreateAvailableTagsArray()`**: `availableTagsArray` = alle Tags aller
  Gruppen, flach, in Reihenfolge. Aufrufer: `Daily.vue`.
- **`useFilterSuggestions(gruppenId)`** → Liste: Gruppe mit dieser ID (lose
  Gleichheit) suchen; nicht gefunden → []; sonst
  `[{id: gruppenId, tags: Tags der Gruppe, deren Name (klein) mit tagInput
  (klein) beginnt}]`. Aufrufer: `Daily.vue`.
- **`useTradeTagsChange(art, wert)`** → Promise<void>:
  - art 'add': Ist `selectedTagIndex` ≠ −1: den Vorschlag
    `filteredSuggestions[selectedTagIndex]` an `tradeTags` anhängen, falls
    seine ID noch nicht drin ist; dann `tradeTagsChanged` = true,
    `saveButton` = true, `tagInput` = ''. Sonst, wenn `wert` wahr: steht ein
    Tag gleichen Namens (ohne Gross-/Kleinschreibung) schon in `tradeTags`,
    nichts; steht er in `availableTagsArray`, diesen Tag anhängen
    (`tradeTagsChanged`, `saveButton` = true, `tagInput` bleibt); sonst neuen
    Tag `{id: 'tag_' + (max(useFindHighestIdNumber(availableTags),
    useFindHighestIdNumberTradeTags(tradeTags)) + 1), name: wert}` an
    `tradeTags` und `newTradeTags` anhängen, `tradeTagsChanged`,
    `saveButton` = true, `tagInput` = ''. Danach in jedem Fall
    `selectedTagIndex` = −1, `showTagsList` = ''.
  - art 'addFromDropdownMenu': `wert` (Tag-Objekt) anhängen, falls ID neu
    (`tradeTagsChanged`, `saveButton` = true, `tagInput` = ''); dann
    `selectedTagIndex` = −1, `showTagsList` = ''.
  - art 'remove': Element an Index `wert` aus `tradeTags` entfernen,
    `tradeTagsChanged`, `saveButton` = true.
  - Danach nur auf Seite 'daily': Tag = `filteredTrades[itemTradeIndex]`;
    fehlt er, Ende. Sonst `tradeTagsDateUnix` = dessen `dateUnix`;
    `tradeTagsId` = ID des Trades `trades[tradeIndex]` (oder null), wenn
    `tradeIndex` definiert ist, sonst null.
  Aufrufer: `Daily.vue`.
- **`useFilterTags()`**: Ist `tagInput` leer → `selectedTagIndex` = −1.
  `filteredSuggestions` = alle Tags aller Gruppen, deren Name (klein) mit
  `tagInput` (klein) beginnt (bei leerem Input alle). `showTagsList` =
  `pageId`, wenn Input nicht leer und Vorschläge vorhanden, sonst ''.
  Aufrufer: `Daily.vue`.
- **`useToggleTagsDropdown()`**: `selectedTagIndex` = −1; `showTagsList`
  umschalten ('' ↔ `pageId`); beim Öffnen `filteredSuggestions` = alle Tags.
  Aufrufer: `Daily.vue`.
- **`useResetTags()`**: `tradeTags` leeren. Aufrufer: `Daily.vue`.
- **`useFindHighestIdNumber(gruppen)`** → Zahl: leere Liste → 0; sonst
  Maximum der Zahlen hinter 'tag_' aller Tags aller Gruppen (Start −∞).
- **`useFindHighestIdNumberTradeTags(tags)`** → Zahl: dasselbe für eine flache
  Tag-Liste. Beide Aufrufer: `Daily.vue`, `useTradeTagsChange`.
- **`useUpdateTags()`** → Promise<void>: `spinnerSetups` = true; IDs aus
  `tradeTags`. Schlüssel: Seite 'addScreenshot' → `screenshot.name`; sonst
  `tradeTagsId` oder, falls leer, `tradeTagsDateUnix` als Zeichenkette. Gibt es
  eine `tags`-Zeile mit `tradeId` = Schlüssel: `spinnerSetupsText` =
  'Updating', `tags` aktualisieren. Sonst `spinnerSetupsText` = 'Saving' und
  neu anlegen mit `{tags, dateUnix, tradeId}` (addScreenshot:
  `screenshot.dateUnix`/`screenshot.name`; sonst `tradeTagsDateUnix` und
  `tradeTagsId` bzw. die Tageszahl als Zeichenkette). Aufrufer: `Daily.vue`,
  `screenshots.js`.
- **`useUpdateAvailableTags()`** → Promise<void>: Einstellungen lesen. Ist
  `settings.tags` keine nicht-leere Liste: neue Liste mit einer Gruppe
  `{id:'group_0', name:'Ungrouped', color:'#6c757d', tags: alle tradeTags}`.
  Sonst: Gruppe 'group_0' suchen und jeden Tag aus `tradeTags` (Seite
  'registerSignup') bzw. `newTradeTags` (sonst) anhängen, dessen ID dort noch
  fehlt (fehlt 'group_0', wirft der Zugriff). Dann
  `dbUpdateSettings({tags})`. Aufrufer: `Daily.vue`, `screenshots.js`.

#### Notizen und Zufriedenheit

- **`useUpdateNote()`** → Promise<void>: `spinnerSetups` = true; erste
  `notes`-Zeile mit `tradeId` = `tradeNoteId`: aktualisieren
  (`{note: tradeNote}`, `spinnerSetupsText` = 'Updating') oder anlegen
  (`{note, dateUnix: tradeNoteDateUnix, tradeId: tradeNoteId}`,
  'Saving'). Aufrufer: `Daily.vue`.
- **`useDailySatisfactionChange(dateUnix, wert, objekt)`** → Promise<void>: Ist
  `objekt` gegeben, `objekt.satisfaction` = wert; sonst Eintrag mit diesem
  `dateUnix` (lose Gleichheit) in `satisfactionArray` ändern oder
  `{dateUnix, satisfaction}` anhängen. Dann `useUpdateDailySatisfaction`.
  Aufrufer: `Daily.vue`.
- **`useUpdateDailySatisfaction(dateUnix, wert)`** → Promise<void>: Abfrage
  `satisfactions` mit `equalTo {dateUnix}` und `doesNotExist: 'tradeId'`;
  erste Zeile aktualisieren (`{satisfaction}`) oder neue anlegen
  `{dateUnix, satisfaction}`.

### 4.4 `src/utils/calendar.js`

#### `useLoadCalendar()` → Promise<void>

Liest `selectedMonth`, `timeZoneTrade`, `pageId`, `filteredTrades`; schreibt
`renderingCharts` (= true, wird hier nie zurückgesetzt), `calendarData`,
`miniCalendarsData`. Wirft nie nach aussen (Fehler → `console.error`,
trotzdem erfüllt).

1. `miniCalendarsData.length` = 0 setzen (auf dem OBJEKT – erzeugt dort den
   Schlüssel `length` mit Wert 0).
2. Monatsliste: Seite 'calendar' → für i = 0 … n (n = Monatsindex 0–11 von
   `selectedMonth.start` in `timeZoneTrade`) der Monatsanfang (in
   `timeZoneTrade`) von `selectedMonth.start` minus i Monate, also vom
   gewählten Monat rückwärts bis Januar. Andere Seiten → nur
   `selectedMonth.start` selbst (nicht normalisiert).
3. Je Monatswert P (Sekunden) ein Raster:
   - Wochenraster mit der Bibliothek `calendarize`, Wochenbeginn Montag
     (Offset 1). Eingabe: der Zeitpunkt P als Datums-/Zeit-Zeichenkette im
     Format von `toLocaleString('en-US', {timeZone: timeZoneTrade})`; die
     Bibliothek liest sie in der Prozesszeitzone und nimmt daraus Jahr und
     Monat. Ergebnis: Liste von Wochen zu je 7 Tageszahlen, 0 für Felder
     ausserhalb des Monats.
   - Monat M (1–12) und Jahr J = Monat/Jahr von P in `timeZoneTrade`.
   - Ausgabe: Objekt mit Schlüsseln „0“, „1“, … (Wochenindex), je eine Liste
     von 7 Tagesobjekten `{month, day, dateUnix, pAndL[, satisfaction]}`:
     - `month` = P in `timeZoneTrade` formatiert als 'MMMM YYYY' (dayjs,
       englische Monatsnamen, z. B. „March 2026“).
     - `day` = Tageszahl (0 = leer).
     - `dateUnix` = 0 bei leerem Feld, sonst Beginn des Tages J-M-day
       (zweistellig aufgefüllt) als Wandzeit in `timeZoneTrade`, in Sekunden.
     - Passender Tag: der LETZTE Eintrag in `filteredTrades`, dessen `date` ==
       day, `month` + 1 == M und `year` == J (Zahlvergleich). Gefunden und
       nicht leer und day ≠ 0: `pAndL` = dessen `pAndL` (kann `undefined`
       sein, dann fehlt der Schlüssel in JSON), `satisfaction` = dessen
       `satisfaction` (fehlt ausserhalb der Tagesansicht). Sonst `pAndL` = []
       und kein `satisfaction`.
   - Ist P gleich dem Monatsanfang (in `timeZoneTrade`) von
     `selectedMonth.start`: `calendarData` leeren und mit dem Raster füllen.
     Sonst soll das Raster vorne in `miniCalendarsData` eingefügt werden –
     das scheitert, weil `miniCalendarsData` ein Objekt ist (Altfehler 7.4):
     es entsteht ein abgelehnter, unbehandelter Promise, `miniCalendarsData`
     bleibt `{length: 0}`. Der Neubau muss im Ergebnis exakt `{length: 0}`
     liefern; ob dabei eine Ablehnung entsteht, prüft kein Test (empfohlen:
     keine).
   - Die Raster-Erzeugung je Monat wird nicht abgewartet, läuft aber ohne
     inneres `await` vollständig, bevor `useLoadCalendar` erfüllt.

Aufrufer: `useMountCalendar`, `useMountDaily`, Golden Master.

### 4.5 `src/utils/mountOrchestration.js`

Modulzustand: eine Generationsnummer. Jeder `useMount*`-Aufruf erhöht sie und
merkt sich seinen Wert; ist an einer Prüfstelle inzwischen eine jüngere
Generation gestartet, bricht der ältere Lauf still ab (kein Fehler, er
berührt Spinner und Stores nicht mehr). `charts.js` wird erst beim ersten
Zeichnen dynamisch geladen.

- **`useMountDashboard()`**: Spinner an; `dashboardChartsMounted` = false;
  `dashboardIdMounted` = false; `barChartNegativeTagGroups.value` = [];
  `useGetSelectedRange()`; parallel `useGetExcursions`,
  `useGetSatisfactions`, `useGetTags`; [Prüfstelle]; `useGetFilteredTrades`;
  [Prüfstelle]; `useTotalTrades`; `useGroupTrades`;
  `useCalculateProfitAnalysis`; [Prüfstelle]; Spinner aus;
  `dashboardIdMounted` = true; `useInitTab('dashboard')`; nächster Tick;
  `useInitTooltip()`; für jede Gruppe in `availableTags`, deren `id` ein
  Schlüssel von `groups` ist, `{id, name}` an `barChartNegativeTagGroups`
  anhängen (Reihenfolge von `availableTags`). Ist `hasData` wahr und der Lauf
  aktuell: `dashboardChartsMounted` = true; `useDisposeJournalCharts()`;
  `renderData` += 1; nächster Tick; [Prüfstelle]; `useECharts('init')`.
  Fehler: `console.error`, Spinner aus (wenn aktuell). Hinweis:
  `useGetAvailableTags` ruft das Layout, nicht dieser Mount.
- **`useMountDaily()`**: `dailyPagination` = 0, `dailyQueryLimit` = 3,
  `endOfList` = false, Spinner an; `useGetSelectedRange()`; parallel
  `useGetExcursions`, `useGetSatisfactions`, `useGetTags`,
  `useGetAvailableTags`, `useGetNotes`, `useGetAPIS`; [Prüfstelle];
  `useGetFilteredTrades`; [Prüfstelle]; Spinner aus; `useInitTab('daily')`;
  dann ohne Warten `useRenderDoubleLineChart()`, `useRenderPieChart()`
  (aus charts.js), `useLoadCalendar()`, `useGetScreenshots(true)`;
  `useInitPopover()`; `renderingCharts` = false.
- **`useMountCalendar(param)`**: `param` ohne Wirkung. Spinner an;
  `useGetSelectedRange()`; parallel `useGetTags`, `useGetAvailableTags`;
  [Prüfstelle]; `useGetFilteredTrades`; [Prüfstelle]; `useLoadCalendar`.
  Fehler nur protokollieren. Dann (wenn aktuell) Spinner aus.
- **`useMountScreenshots()`**: Spinner an; `useGetScreenshotsPagination()`;
  `useGetSelectedRange()`; parallel `useGetTags`, `useGetAvailableTags`;
  [Prüfstelle]; `useGetScreenshots(false)`; `useInitPopover()`. Am Ende
  (auch bei Fehler) Spinner aus, wenn aktuell.
- **`useMountAuswertung()`**: Spinner an; `auswertungMounted` = false;
  `useGetSelectedRange()`; parallel `useGetAuswertungNotes`,
  `useGetSatisfactions`, `useGetTags`; [Prüfstelle];
  `useGetFilteredTrades`; [Prüfstelle]; Spinner aus; `auswertungMounted` =
  true; nächster Tick; `useInitTooltip()`.
- **`useCheckVisibleScreen()`**: Ist `window.innerHeight` ≥
  `document.documentElement.scrollHeight`, `useLoadMore()` aufrufen.
- **`useLoadMore()`** → Promise: `spinnerLoadMore` = true; Seite 'daily':
  `useGetFilteredTradesForDaily()`, dann beide Tagesdiagramme (parallel,
  abgewartet), `useInitTab('daily')`; Seite 'screenshots':
  `useGetScreenshots(false)`; `spinnerLoadMore` = false.
- **`useRefreshTrades()`**: Spinner an; je nach `pageId` 'dashboard' /
  'daily' / 'calendar' den passenden Mount abwarten, sonst
  `window.location.href` = '/dashboard'. (Derzeit ohne Aufrufer.)
- **`useGetSelectedRange()`** → Promise: Seite 'dashboard' oder
  'auswertung': `selectedRange` = {0,0}, wenn `selectedPeriodRange.value?.value`
  = 'all', sonst `selectedRange.value` = `selectedDateRange.value` (dasselbe
  Objekt). Seite 'calendar': `selectedRange` = `{start: Jahresanfang (in
  timeZoneTrade) von selectedMonth.start, end: selectedMonth.end}`. Andere
  Seiten: `selectedRange.value` = `selectedMonth.value` (dasselbe Objekt).
- **`useDisposeJournalCharts()`** (synchron): Wurde `charts.js` noch nie
  geladen, nichts tun. Sonst alle Knoten mit Klasse `chartClass`,
  `chartIdCardClass` oder ID `candlestickChart` einsammeln und, falls welche
  da sind, an `disposeCharts` aus `charts.js` geben. Muss laufen, solange die
  Knoten noch im Dokument hängen (Aufruf in `onBeforeUnmount`).

Aufrufer: siehe Landkarte (Dashboard.vue, Daily.vue, Calendar.vue
(View und Komponente), Screenshots.vue, Auswertung.vue, SidebarFilters.vue).

### 4.6 `src/utils/formatters.js`

Reine Formatierer. Zeitformate rechnen in `timeZoneTrade` und erwarten
Sekunden. dayjs-Locale ist überall die Vorgabe 'en'.

| Export | Ergebnis |
|---|---|
| `useKostenAnzeige(usd, stellen = 2)` | '' bei nicht endlichem Betrag oder 0; sonst `useKostenZahl(...)` + ' ' + `useWaehrungCode()` |
| `useKostenZahl(usd, stellen = 2)` | nicht endlich → 0 mit `stellen` Nachkommastellen (`toFixed`); Faktor f = Zahl(`currentUser.waehrungFaktor`); f nicht endlich oder ≤ 0 → Betrag mit `toFixed(stellen)`; sonst (Betrag · f) mit `toFixed(stellen)` |
| `useWaehrungCode()` | 'USD', wenn kein gültiger Faktor (wie oben); sonst Zeichenkette(`currentUser.waehrungCode` oder 'CHF') |
| `useVorlagenKategorieLabel(k)` | 'win' → 'Gewinn', 'loss' → 'Verlust', sonst k |
| `useCapitalizeFirstLetter(s)` | erstes Zeichen gross, Rest unverändert |
| `useDateCalFormat(s)` | 'YYYY-MM-DD' |
| `useDateCalFormatMonth(s)` | 'YYYY-MM' |
| `useTimeFormat(s)` | 'HH:mm:ss' |
| `useTimeDuration(s)` | dayjs-Dauer aus s·1000 ms, Format 'HH:mm:ss' (Stundenanteil der Dauerzerlegung, nicht Gesamtstunden) |
| `useSwingDuration(s)` | Tagesanteil der dayjs-Dauerzerlegung von s·1000 ms (Format 'D', als Zahl) + ' ' + ('days' wenn > 1, sonst 'day') |
| `useHourMinuteFormat(s)` | 'HH:mm' |
| `useDateTimeFormat(s)` | 'YYYY-MM-DD HH:mm:ss' |
| `useChartFormat(s)` | 'D.M.YYYY' |
| `useMonthFormat(s)` | 'MMMM YYYY' (englische Monatsnamen) |
| `useCreatedDateFormat(s)` | 'ddd DD MMMM YYYY' |
| `useStartOfDay(s)` | Tagesbeginn in `timeZoneTrade`, Sekunden |
| `useThousandCurrencyFormat(x)` | `Intl.NumberFormat`, Währung USD, höchstens 0 Nachkommastellen |
| `useThousandFormat(x)` | höchstens 0 Nachkommastellen |
| `useTwoDecCurrencyFormat(x)` | USD, höchstens 2 |
| `useXDecCurrencyFormat(x, n)` | USD, höchstens n |
| `useTwoDecFormat(x)` | höchstens 2 |
| `useXDecFormat(x, n)` | höchstens n |
| `useOneDecPercentFormat(x)` | Prozent, höchstens 1 |
| `useDecimalsArithmetic(a, b)` | (Zahl(a auf 6 Stellen gerundet als Text) · 100 + Zahl(b ebenso) · 100) / 100 |

Locale der Zahlenformate: localStorage `appLanguage` ('de' als Vorgabe) →
'de' ↦ 'de-CH', 'en' ↦ 'en-US', sonst 'de-CH'.
Aufrufer: siehe Landkarte (sehr viele).

### 4.7 `src/utils/dayjs-setup.js`

Standardexport: die dayjs-Instanz, an der einmalig die Plugins `utc`,
`isoWeek`, `timezone`, `duration`, `updateLocale`, `localizedFormat`,
`customParseFormat` registriert sind. Keine Locale-Änderung. Wird von sehr
vielen Dateien importiert (Landkarte: „dayjs-setup“).

### 4.8 `src/utils/utils.js`

- **`useInitTab(art)`**: `idCurrent`, `idPrevious` = undefined; für jeden
  Knopf unter `#nav-tab`:
  - art 'dashboard': beim Bootstrap-Ereignis `shown.bs.tab`:
    `selectedDashTab` = ID des Knopfs, LS `selectedDashTab` schreiben,
    `renderData` += 1, nächster Tick, `useECharts('init')`.
  - art 'daily': beim Klick: war `idCurrent` gesetzt, wird es zu
    `idPrevious`; `idCurrent` = Knopf-ID. War `idPrevious` danach
    undefined: `idPrevious` = `idCurrent` und ein internes
    „Inhalt verbergen“-Flag wird umgeschaltet (erster Klick). IDs haben die
    Form '<Art>-<Index>': `idCurrentType`/`idCurrentNumber` und
    `idPreviousType`/`idPreviousNumber` daraus; Inhaltsknoten
    '#<Art>Nav-<Index>'. Ist die Art 'screenshots': `dateUnix` von
    `filteredTrades[Index]`; Eintrag in `screenshotsInfos` mit
    `dateUnixDay` == dateUnix oder `useStartOfDay(dateUnix)` == dateUnix;
    gefunden und (keine Screenshots geladen oder erster geladener hat ein
    anderes `dateUnixDay`) → `tabGettingScreenshots` = true,
    `useGetScreenshots(true, dateUnixDay)`, `tabGettingScreenshots` = false.
    Gleicher Knopf wie zuvor: Flag umschalten und Inhalt per Klassen `show`,
    `active` verbergen bzw. zeigen (am Knopf `active`). Anderer Knopf: Flag
    = false, beim vorigen Inhalt/Knopf `show`/`active` entfernen.
- **`useInitParse()`** = `useInitApp()`.
- **`useInitApp()`** → Promise: Einstellungen lesen → `currentUser`; LS
  `startseiteAn` = '1', wenn Zahl(`settings.startseiteAn` ?? 1) = 1, sonst '0'
  (Fehler ignoriert); `selectedTradeTimeframes` = `settings.tradeTimeframes`
  (wenn Liste). Fehler → `currentUser` = {}. Immer erfüllt.
- **`useCheckCurrentUser()`** → Promise: `useGetCurrentUser()`.
- **`useGetCurrentUser()`**: `currentUser` = Einstellungen (Fehler → {}).
- **`useGetTimeZone()`**: `timeZoneTrade` = `currentUser.timeZone`, wenn
  eigene Eigenschaft, sonst 'America/New_York'.
- **`useGetPeriods()`** → Promise: füllt `periodRange` (in place) mit
  `{value, label, start, end}`; alle Grenzen in `timeZoneTrade`, „jetzt“ =
  Prozesszeit, Ergebnis als Zahl (Sekunden; Monats-/Jahres-/Wochenende =
  letzte Sekunde). Wochen sind dayjs-Wochen der Locale 'en' (Sonntag bis
  Samstag) um einen Tag verschoben, also Montag 00:00:00 bis Sonntag 23:59:59.
  - 'all' (`options.total`): 0 / 0
  - 'thisWeek': Montag dieser Woche – Sonntag dieser Woche
  - 'lastWeek': Montag – Sonntag der Vorwoche
  - 'lastWeekTilNow': Montag der Vorwoche – Sonntag dieser Woche
  - 'thisMonth': Monatsanfang – Monatsende
  - 'lastMonth': Vormonat
  - 'lastMonthTilNow': Anfang Vormonat – Ende dieses Monats
  - 'lastThreeMonths': Anfang vor drei Monaten – Ende Vormonat
  - 'lastThreeMonthsTilNow': Anfang vor drei Monaten – Ende dieses Monats
  - 'thisYear': Jahresanfang – Jahresende
  - 'lastYear': Vorjahr
  - 'custom': −1 / −1
  Labels: `options.<value>` für total, thisWeek, lastWeek, lastWeekTilNow,
  thisMonth, lastMonth, lastMonthTilNow, lastThreeMonths,
  lastThreeMonthsTilNow, thisYear, lastYear, custom (für 'all' der Schlüssel
  `options.total`).
- **`useInitPopover()`**: Gibt es Bootstrap mit `Popover`, für jedes Element
  mit `data-bs-toggle="popover"` ohne bestehende Instanz eine anlegen; sonst
  Warnung. Einmal pro Tab-Lebensdauer einen Klick-Handler am `document`
  registrieren: Klick auf `.popoverDelete` merkt sich den Knopf; ohne
  Bootstrap-Popover sofort `confirm(t('messages.confirmDelete'))` → Löschen
  ausführen, sonst `selectedItem` = null; mit Popover alle anderen
  `.popoverDelete`-Popover schliessen. Klick auf `.popoverYes`/`.popoverNo`:
  Popover des gemerkten Knopfs schliessen; Nein → `selectedItem` = null; Ja →
  Löschen ausführen. „Löschen ausführen“: Seite 'screenshots' oder 'daily' →
  `useDeleteScreenshot()`; Seite 'imports' → `useDeleteTrade()`, dann
  `useDeleteExcursions()`.
- **`useInitTooltip()`**: ohne Bootstrap-`Tooltip` nichts; sonst für jedes
  Element mit `data-bs-toggle="tooltip"` eine Tooltip-Instanz anlegen (nicht
  idempotent).
- **`useCheckIfWindowIsScrolled()`**: Scroll-Handler setzt
  `windowIsScrolled` = `scrollY` > 100.
- **`usePageId()`** → Zeichenkette: `pageId` = Name der aktuellen Route
  (`useRoute`), Rückgabe derselbe Wert.
- **`useScreenType()`**: Breite (`innerWidth`, falls > 0, sonst
  `screen.width`) ≥ 992 → 'computer', sonst 'mobile'.
- **`useSetValues()`** → Promise: Vorgaben in localStorage anlegen und in die
  Refs lesen, in dieser Reihenfolge:
  1. `selectedDashTab`: fehlt LS → 'overviewTab'.
  2. `selectedPositions`: LS null → 'long,short'; Ref = an Kommas getrennt.
  3. `selectedTimeFrame`: fehlt → 'daily'.
  4. `selectedRatio`: fehlt oder 'apps' → 'appt'.
  5. `selectedAccount`: fehlt → 'all'.
  6. `selectedGrossNet`: fehlt → 'gross'.
  7. `selectedPlSatisfaction`: fehlt → 'pl'.
  8. `selectedBroker`: fehlt → 'bitunix'.
  9. `selectedDateRange`: fehlt → JSON `{start, end}` von 'thisYear' aus
     `periodRange`; Ref = JSON.
  10. `selectedPeriodRange`: fehlt → JSON des Eintrags von `periodRange` mit
      gleichem start/end wie `selectedDateRange`, sonst des 'custom'-Eintrags;
      Ref = JSON.
  11. Ist die Periode 'all' und `selectedDateRange` ≠ {0,0}: auf {0,0} setzen
      und speichern.
  12. Ist die Periode weder 'custom' noch 'all' und weicht ihr frisch
      berechneter Eintrag in `periodRange` (gleiches `value`) in start/end ab:
      `selectedPeriodRange` = Kopie des frischen Eintrags, `selectedDateRange`
      = dessen {start, end}, beides speichern.
  13. `selectedMonth`: fehlt → {start, end} von 'thisMonth'; Ref = JSON.
  14. `selectedMonthPreset`: fehlt → 'current'; ist es 'current' und weicht
      'thisMonth' ab → `selectedMonth` = {start, end} von 'thisMonth',
      speichern.
  15. `selectedAccounts`: nur wenn LS null und `currentUser.accounts` nicht
      leer: alle `value` anhängen, durch Kommas verbunden speichern, Ref neu
      aus LS lesen.
  16. `selectedTags`: LS null → `useGetTags()`, 't000t' anhängen,
      `useGetAvailableTags()`, alle Tag-IDs aller Gruppen anhängen, dann
      `tags` (Store) leeren, Kommaliste speichern. Sonst
      `useGetAvailableTags()`; jede Tag-ID, die in der LS-Liste fehlt,
      anhängen; wurde etwas angehängt, `selectedTags` = neue Liste und
      speichern.
  17. `amountCase` = LS `selectedGrossNet`.
  Werte werden als Zeichenketten gespeichert (Listen kommagetrennt, Objekte
  als JSON).
- **`useEditItem(id)`**: SS `editItemId` = id; Seite 'entries' →
  `location.href` = '/addEntry'; Seite 'screenshots' → SS
  `screenshotsPagination` = `screenshotsPagination`, SS
  `screenshotIdToEdit` = id, `location.href` = '/addScreenshot'.
- **`usePageRedirect(ziel)`**: ziel wahr → `location.href` = '/' + ziel;
  danach (unabhängig) Seite 'daily' → '/daily'.
- **`useToggleMobileMenu()`**: Klasse `toggleSideMenu` an `#sideMenu`
  umschalten, `sideMenuMobileOut` umkehren.
- **`useCloseMobileMenu()`**: nur wenn `sideMenuMobileOut` wahr: Klasse
  entfernen (falls Knoten da), `sideMenuMobileOut` = false.
- **`returnToTop()`**: weich nach oben scrollen.
- **`useGetAPIS()`** → Promise: `apis` leeren, aus `settings.apis` füllen.
- **`useExport(art, name, zusatz, daten)`** → Promise: Dateiname = name, mit
  '_' + zusatz, wenn zusatz ≠ null. 'json': `JSON.stringify(daten, null, 2)`,
  Typ application/json, Endung '.json'. 'csv': Kopfzeile = Schlüssel des
  ersten Objekts, Trenner ';', je Objekt die Werte dieser Schlüssel,
  Zeilen mit '\n', Typ text/csv, Endung '.csv'. Download über einen
  temporären Link, URL danach freigeben.

### 4.9 `src/components/SidebarFilters.vue`

Filterbereich in der Seitenleiste. Sichtbar nur auf den Seiten 'dashboard',
'daily', 'calendar', 'screenshots', 'auswertung'. Aufklappbarer Kopf
(Symbol, Text `common.filter`, Pfeil); Inhalt anfangs zugeklappt. Je Seite
diese Filterzeilen:

| Seite | Zeilen |
|---|---|
| dashboard | periodRange, grossNet, positions, timeFrame, ratio, tags |
| calendar | month, grossNet, plSatisfaction |
| daily | month, grossNet, positions, tags |
| screenshots | grossNet, positions, tags |
| auswertung | periodRange, positions, tags |

Jede Zeile hat ein Info-Symbol mit Tooltip `filters.<zeile>`
(periodRange, month, grossNet, positions, timeFrame, ratio, plSatisfaction,
tags). Steuerelemente:

- **periodRange**: Auswahl aus `periodRange` (vorgewählt
  `selectedPeriodRange.value`); Auswahl → `selectedPeriodRange` = Eintrag,
  `selectedDateRange` = {start, end} des Eintrags. Darunter, wenn die Periode
  nicht 'all' ist, zwei Datumsfelder (Werte `useDateCalFormat` von start/end):
  Start → `selectedDateRange.start` = Tagesbeginn des Datums in
  `timeZoneTrade`; Ende → `selectedDateRange.end` = Tagesende (letzte
  Sekunde) in `timeZoneTrade`; danach `selectedPeriodRange` = Eintrag mit
  gleichem start/end, sonst der 'custom'-Eintrag.
- **month**: Monatsfeld (Wert `useDateCalFormatMonth(selectedMonth.start)`);
  Eingabe → `selectedMonth` = {Monatsbeginn, Monatsende (letzte Sekunde)} in
  `timeZoneTrade`; `selectedMonthPreset` = 'current', wenn der Beginn dem
  aktuellen Monatsbeginn entspricht, sonst 'custom'.
- **grossNet**: Auswahl aus `grossNet` → `selectedGrossNet`.
- **positions**: Aufklappliste mit Kontrollkästchen je `positions`-Eintrag,
  gebunden an `selectedPositions`; Beschriftung `common.all` (alle gewählt),
  `common.none` (keine), sonst die Labels kommagetrennt.
- **timeFrame**: Auswahl aus `timeFrames` → `selectedTimeFrame`.
- **ratio**: Auswahl aus `ratios` → `selectedRatio`.
- **plSatisfaction**: Auswahl aus `plSatisfaction` (vorgewählt
  `selectedPlSatisfaction`) → `tempSelectedPlSatisfaction`.
- **tags auf dem Dashboard**: einfache Auswahl. Angebotene Tags = alle Tags
  aller Gruppen aus `availableTags` AUSSER der Gruppe mit Namen
  'Trade Abschluss'. Optionen: 'all' (`filters.allTags`), 't000t'
  (`filters.noTag`), je Tag dessen ID/Name. Auswahl 'all' →
  `selectedTags` = ['t000t', alle angebotenen Tag-IDs]; 't000t' → ['t000t'];
  Tag → [Tag-ID]. Vorgewählt: 'all', wenn alle angebotenen IDs und 't000t'
  gewählt sind (und es Tags gibt); sonst bei genau einem Eintrag dieser
  Eintrag; sonst 'all'.
- **tags auf anderen Seiten**: Aufklappliste „Tags (<Anzahl gewählt>)“ mit
  Umschalter `common.all`/`common.none`, Kontrollkästchen 't000t'
  (`filters.noTag`) und je Gruppe (Kopf in Gruppenfarbe) Kontrollkästchen je
  Tag, gebunden an `selectedTags`. Umschalter: `selectedTags` = []; war
  „alle gewählt“ markiert → Markierung aus; sonst ['t000t', alle Tag-IDs]
  und Markierung an.
- **Anwenden** (`common.apply`): Ist `selectedDateRange.end` <
  `selectedDateRange.start` → `alert(t('filters.endBeforeStart'))`, Panel
  bleibt offen, nichts wird übernommen. Sonst Panel zu, Speichern (unten),
  mobiles Menü schliessen (`useCloseMobileMenu`).

Speichern (in dieser Reihenfolge): erneute Datumsprüfung (wie oben, sonst LS
`selectedDateRange` als JSON); auf dem Dashboard bei gültigem Bereich und
`hasData` → `useECharts('clear')`; LS `selectedPeriodRange` (JSON),
`selectedAccounts`, `selectedGrossNet`; `amountCase` = `selectedGrossNet`;
`amountCapital` = `selectedGrossNet` mit grossem Anfangsbuchstaben; LS
`selectedPositions`, `selectedTimeFrame`, `selectedRatio`; auf 'daily' und
'calendar' zusätzlich LS `selectedMonth` (JSON) und `selectedMonthPreset`;
LS `selectedTags`; Markierung „alle Tags gewählt“ = (Anzahl aller Tag-IDs +
1) = Anzahl `selectedTags`; ist `tempSelectedPlSatisfaction` ≠ null →
`selectedPlSatisfaction` übernehmen, LS speichern, temp = null. Dann je Seite:
dashboard → `useMountDashboard()`; daily → `useMountDaily()` abwarten, dann
`useCheckVisibleScreen()`; screenshots → `useRefreshScreenshot()` abwarten,
dann `useCheckVisibleScreen()`; calendar → `useMountCalendar(true)`;
auswertung → `useMountAuswertung()`. Beim Mounten der Komponente nach einem
Tick `useInitTooltip()`. `charts.js` nur dynamisch laden.

---

## 5. Zeitzonenregeln (Übersicht)

- **Handelstag `td` / `dateUnix`** ist die UTC-Mitternacht des Schliesstages
  (Import, eigener Code). Der Kern rechnet ihn nicht um, filtert aber direkt
  darauf (`start` ≤ `td` < `end`, Grenzen kommen aus der Handelszeitzone).
- **`timeZoneTrade`** (Einstellung `timeZone`, Vorgabe 'America/New_York')
  gilt für: `date`/`month`/`year` der Tageskopien, Gruppe `timeframe`
  (Formatierung), Kalender (Monat/Jahr, Tages-`dateUnix`, Monatsnamen),
  Perioden (`useGetPeriods`), Filtereingaben der Seitenleiste,
  `useGetSelectedRange` (Jahresanfang im Kalender), MFE-Marktschluss, alle
  Datums-/Zeitformatierer. Da `dateUnix` UTC-Mitternacht ist, fällt der Tag in
  westlichen Zonen (New York) auf den VORTAG – so eingefroren (Kalender
  „maerzUSA“ zeigt Februar 2026, weil der Monatsbeginn von
  `selectedMonth.start` in New York im Februar liegt).
- **Prozesszeitzone** gilt für: Gruppe `day` (Wochentag von `entryTime`),
  Enddatum in `useGetOHLCV`, Datumszeichenkette beim Speichern
  (`useUploadTrades`), „jetzt“ bei `addExcursions`, das Einlesen der
  `calendarize`-Eingabe. Der Test nagelt sie auf 'Europe/Zurich'.
- Sommerzeitwechsel: Alle Umrechnungen über dayjs-`tz`; Tagesanfang/-ende als
  Wandzeit (nicht festen Versatz addieren).
- dayjs-Locale: 'en' (Wochenbeginn Sonntag, englische Monatsnamen).

---

## 6. Rundungen, Sortierungen, Sonderfälle (Zusammenfassung)

- Keine Rundung im Kern; alle Zahlen bleiben Doubles. Gerundet wird nur in
  den Formatierern.
- Division durch 0: überall ausdrücklich abgefangen (→ 0) in
  `profitAnalysis` und `leiteKennzahlenAb`; Blotter/P&L dividieren nicht.
- NaN: `totals`/`totalsByDate` sind über `z()` NaN-fest; Blotter/P&L NICHT
  (fehlendes Feld → NaN, im Ergebnis als `null` sichtbar).
- Sortierungen: `filteredTrades` stabil absteigend nach `dateUnix`;
  `filteredTradesDaily` in Ladereihenfolge; Blotter-Gruppierung nach
  `entryTime` aufsteigend (stabil); Tagessummen nach `td` aufsteigend
  (stabil); `groups.duration` nach Dauer aufsteigend (stabil);
  `groups.timeframe` Schlüssel lexikographisch.
- Doppelte IDs / Mehrfachtreffer in Nachschlagetabellen: der spätere Eintrag
  gewinnt (Tags, Zufriedenheit, Exkursionen, Trade-Typ, Kalendertag).
- Leere Mengen: keine Tageszeilen → alle Listen leer, `hasData` unverändert;
  `totals` enthält dann lauter Nullen (nicht leer!), `profitAnalysis` wird
  trotzdem berechnet (Nullen, `grossMfeR`/`netMfeR` null).

---

## 7. Bewusste Altfehler (vom Golden Master eingefroren)

Der Neubau bildet diese Verhaltensweisen zunächst nach. Wer einen behebt,
schreibt den Golden Master bewusst neu
(`JOURNAL_GOLDEN_SCHREIBEN=1 node src/utils/__selftest-journal.mjs` bzw.
`…__selftest-mfe-pfade.mjs`) und nennt die geänderten Zahlen im Commit.

1. **Tag-Gruppen werden nicht zurückgesetzt.** *(Behoben in S7, 19.10.2026: `group_*` wird vor jedem Lauf geleert.)* `groups[<Gruppen-ID>]`
   (`group_1`, `group_2`, …) bleiben aus früheren Läufen stehen, wenn eine
   Gruppe im aktuellen Lauf nicht vorkommt. Im Szenario „nurAgent“ (ein Trade
   ohne Tags) stehen in `group_1`/`group_2` noch die Trades des vorigen
   Szenarios „nurFutures“; `groups.tags` ist dagegen frisch. Auch
   `barChartNegativeTagGroups` zeigt deshalb veraltete Gruppen.
2. **Mehrere Tageszeilen mit gleichem `dateUnix`** (zwei Börsen am selben
   Tag): `pAndL`/`blotter` (die über ALLE gefilterten Trades des Tages
   berechnet sind) hängen nur an der letzten Tageskopie in Ladereihenfolge
   (bei der Speicher-DB: grösste `objectId`); die anderen Kopien haben keine
   `pAndL`/`blotter`-Felder. Der Kalender trifft ebenfalls die letzte Kopie.
   Die Gewinnanalyse sucht dagegen die ERSTE Kopie und findet Exkursionen zu
   Trades der anderen Börse nicht.
3. **Tag-Objekte werden mutiert.** `useGroupTrades` setzt `groupName` und
   `groupId` direkt an den Tag-Objekten der gefilterten Trades; diese Felder
   erscheinen daher in `filteredTrades[].trades[].tags[]` und
   `filteredTradesTrades`.
4. **`miniCalendarsData` ist ein Objekt.** Mini-Kalender werden nie
   gefüllt; das Objekt bleibt `{length: 0}`. Je nicht gewähltem Monat entsteht
   ein unbehandelter, abgelehnter Promise. Ausserhalb der Kalenderseite trifft
   das auch den gewählten Monat, wenn `selectedMonth.start` nicht exakt ein
   Monatsanfang in `timeZoneTrade` ist (dann bleibt `calendarData` unverändert).
5. **`mfePrices`-Modulspeicher wird nie geleert.** Jeder Aufruf von
   `useGetMFEPrices` hängt an und gibt die ganze Liste zurück;
   `useUpdateMfePrices` schreibt die ganze Liste; `useUploadTrades` schreibt
   sie beim nächsten Import erneut. Im MFE-Test: 62 Einträge nach New York, 124
   nach Zürich, 136 nach dem Lauf mit Marktschluss 11:00, alle 136 werden
   gespeichert. Der Test lässt die Import-Vorschau deshalb ZUERST laufen
   (dort sind 0 Exkursionen gespeichert).
6. **Hängende Promises.** Nie erfüllt werden: `useGetMFEPrices`, wenn das
   Symbol gar nicht in der Kerzenliste steht (Zugriff auf einen nicht
   vorhandenen Eintrag wirft im Promise-Ausführer); `useUpdateMfePrices` bei
   leerer Liste; `useCreateOHLCV` bei leerem CSV; `useGetExistingTradesArray`
   bei DB-Fehler. Der MFE-Test meidet den ersten Fall und prüft „Symbol da,
   Kerzen fehlen“ (dann wird erfüllt, ohne Eintrag).
7. **`useGetOHLCV` erfüllt zu früh.** Nach dem ersten Symbol (Polygon:
   Länge 1 beim Erfüllen; Databento: Länge 2 im Testlauf), die übrigen
   Symbole laufen danach weiter. Der Test hält die Länge beim Erfüllen fest
   (`beimAufloesen`) und wartet dann.
8. **`openPositions` bei fehlender Tagesliste** in `useUploadTrades` wird
   true.
9. **`hasData`** wird nur auf true gesetzt (sobald überhaupt Tageszeilen
   geladen sind), nie zurück auf false – auch wenn der Filter alles verwirft.
10. **Tag-Filter „nur ohne Tag“** lässt Trades mit (nicht gewählten)
    Trade-Tags durch, solange ihr Tag keine Tages-Tags hat (ODER über zwei
    Quellen, 4.1).
11. **`date` der Tageskopie** wird durch die Tageszahl ersetzt (die
    Datumszeichenkette der DB geht in der Kopie verloren).
12. **`financials` in `totalsByDate`** ist der Wert des ersten Trades
    (`undefined` im Krypto-Betrieb), nicht die Summe; `totals.financials`
    dagegen ist die Summe (0).
13. **Wochentag in Prozesszeitzone** (`groups.day`), nicht in
    `timeZoneTrade`.
14. **Aktienbörsen-Felder** `sec`, `taf`, `nscc`, `nasdaq` (immer 0) und
    `shareFloat`/`mktCap` (immer `{}`) werden weiter mitgeführt.
15. Ohne `localStorage` liefern mehrere Store-Exporte '' statt einer Ref
    (3.2) – praktisch nur ausserhalb des Browsers sichtbar.

---

## 8. Offene Punkte / Unsicherheiten

- Das Zeitverhalten von `useGetOHLCV` (Databento) im Golden Master hängt an
  der Mikrotask-Reihenfolge (alle Anfragen sofort, Verarbeitung mit
  mindestens einem `await` vor dem Anhängen). Ein Neubau, der anders
  verschachtelt, kann `beimAufloesen` ändern, ohne dass sich fachlich etwas
  ändert.
- Die echte DB liefert bei gleichem `dateUnix` keine garantierte
  Reihenfolge; die Speicher-DB sortiert nach `objectId`. Altfehler 7.2 hängt
  im Betrieb also von der DB ab.
- `useGetTags` lädt ohne Sortierung; welche Zeile bei Mehrfachtreffern
  „später“ ist, entscheidet die DB.
- `charts.js` ist nicht Teil dieser Spezifikation, erzeugt aber einen
  grossen Teil der Golden-Master-Daten aus den hier beschriebenen Stores.
  Abweichungen in Schlüsselreihenfolgen (3.6) zeigen sich dort.
- Die Datei `src/stores/README.md` beschreibt eine nicht existierende
  `diary.js`.

---

## 9. Aufrufer-Landkarte

Benannte Importe aus den Altmodulen und den Store-Bündeln (Stand 19.10.2026;
`stores/globals` = direkter Import aus `globals.js`). Zusätzlich importieren
die Golden Master dynamisch: `__selftest-journal.mjs` → `stores/ui.js`,
`stores/filters.js`, `stores/trades.js`, `stores/settings.js` (`currentUser`),
`utils/trades.js` (`useGetFilteredTrades`, `useTotalTrades`,
`useGroupTrades`, `useCalculateProfitAnalysis`), `utils/daily.js`
(`useGetExcursions`, `useGetSatisfactions`, `useGetTags`,
`useGetAvailableTags`), `utils/calendar.js` (`useLoadCalendar`);
`__selftest-mfe-pfade.mjs` → dieselben Stores und `utils/journal-alt.js`
(`useGetExistingTradesArray`, `useCreateBlotter`, `useCreatePnL`,
`useUploadTrades`, `useCreateOHLCV`, `useGetOHLCV`, `useGetMFEPrices`,
`useUpdateMfePrices`). Von den Store-Refs benutzen die Tests u. a. `pageId`,
`timeZoneTrade`, `hasData`, `barChartNegativeTagGroups`, `selectedRange`,
`selectedPositions`, `selectedAccounts`, `selectedTags`, `selectedBroker`,
`selectedTradeCategory`, `amountCase`, `selectedMonth`, `timeFrame`,
`availableTags`, `groups`, `filteredTrades`, `filteredTradesTrades`,
`totals`, `totalsByDate`, `profitAnalysis`, `calendarData`,
`miniCalendarsData`, `existingTradesArray`, `executions`, `existingImports`,
`trades`, `blotter`, `pAndL`, `marketCloseTime`, `tradeExcursionId`,
`tradeId`.

Default-Import `dayjs` aus `utils/dayjs-setup.js` haben: alle hier beschriebenen
Altmodule, `charts.js`,
`cockpitFoto.js`, `incoming.js`, `quickImport.js`, `screenshots.js`,
`stores/accountBalance.js`, die Komponenten `BotDashboard.vue`,
`Calendar.vue`, `chart/TradeKarte.vue`, `HebelkartenCanvas.vue`,
`LiquidityHeatmap.vue`, `livetrading/pult/Tape.vue`,
`livetrading/pult/Zeitband.vue`, `livetrading/SitzungsLeiste.vue`,
`Nav.vue`, `RadarKachel.vue`, `SidebarFilters.vue`, alle
`radar/Kachel{Dominanz,Etf,Handelszeiten,Indizes,KalenderCountdown,Kompakt,Liq24,LiqTicker,LsOi,Momentum,PiCycle,Rainbow,Wal}.vue`
und die Views `Accounts.vue`, `AddExcursions.vue`, `AddTrades.vue`,
`AgentLab.vue`, `AgentPerformance.vue`, `AgentSetups.vue`,
`AgentStrategies.vue`, `Daily.vue`, `Dashboard.vue`, `Incoming.vue`,
`KiAgent.vue`, `Liquidity.vue`, `LiveSessions.vue`, `Nachrichten.vue`,
`Playbook.vue`.

| Datei | Modul | Importierte Namen |
|---|---|---|
| `src/components/BotDashboard.vue` | `stores/filters` | amountCase, selectedBroker |
| `src/components/BotDashboard.vue` | `stores/trades` | filteredTradesTrades |
| `src/components/BotDashboard.vue` | `utils/formatters` | useTwoDecCurrencyFormat, useThousandCurrencyFormat, useThousandFormat, useXDecFormat, useTwoDecFormat |
| `src/components/Calendar.vue` | `stores/filters` | selectedMonth, selectedMonthPreset, selectedPlSatisfaction, amountCase |
| `src/components/Calendar.vue` | `stores/trades` | calendarData, miniCalendarsData |
| `src/components/Calendar.vue` | `stores/ui` | pageId, timeZoneTrade, spinnerLoadingPage, scrollToDateUnix |
| `src/components/Calendar.vue` | `utils/formatters` | useThousandCurrencyFormat |
| `src/components/Calendar.vue` | `utils/mountOrchestration` | useMountCalendar, useMountDaily |
| `src/components/chart/TradeKarte.vue` | `stores/filters` | selectedMonth, selectedMonthPreset |
| `src/components/chart/TradeKarte.vue` | `stores/ui` | timeZoneTrade, scrollToDateUnix |
| `src/components/chart/WatchlistReiter.vue` | `stores/globals` | currentUser |
| `src/components/coinradar/AbverkaufAnsicht.vue` | `stores/globals` | currentUser |
| `src/components/ki/KiUebersicht.vue` | `utils/formatters` | useKostenAnzeige |
| `src/components/LiquidityHeatmap.vue` | `stores/ui` | timeZoneTrade |
| `src/components/LiveSymbolPicker.vue` | `stores/filters` | selectedBroker |
| `src/components/LiveSymbolPicker.vue` | `stores/settings` | currentUser |
| `src/components/livetrading/SymbolWahl.vue` | `stores/globals` | currentUser |
| `src/components/ModeSwitcher.vue` | `stores/settings` | currentUser |
| `src/components/ModeSwitcher.vue` | `stores/ui` | appMode, screenType, pageId |
| `src/components/Nav.vue` | `stores/filters` | selectedDateRange, selectedPeriodRange, selectedGrossNet, selectedPositions, selectedMonth |
| `src/components/Nav.vue` | `stores/settings` | currentUser, renderProfile |
| `src/components/Nav.vue` | `stores/trades` | filteredTradesTrades |
| `src/components/Nav.vue` | `stores/ui` | pageId, screenType, appMode, privacyMode |
| `src/components/Nav.vue` | `utils/formatters` | useDateCalFormat |
| `src/components/Nav.vue` | `utils/utils` | useToggleMobileMenu, useExport, useInitTooltip |
| `src/components/radar/KachelCoinRadar.vue` | `stores/globals` | currentUser |
| `src/components/radar/KachelKompakt.vue` | `stores/globals` | currentUser |
| `src/components/radar/KachelMarkt.vue` | `stores/globals` | currentUser |
| `src/components/radar/KachelRsi.vue` | `stores/globals` | currentUser |
| `src/components/rahmen/Kopfleiste.vue` | `stores/settings` | currentUser |
| `src/components/rahmen/Kopfleiste.vue` | `stores/ui` | appMode, pageId, screenType |
| `src/components/ReturnToTopButton.vue` | `stores/ui` | windowIsScrolled |
| `src/components/ReturnToTopButton.vue` | `utils/utils` | returnToTop, useCheckIfWindowIsScrolled |
| `src/components/Screenshot.vue` | `stores/trades` | tags |
| `src/components/Screenshot.vue` | `stores/ui` | selectedItem, modalDailyTradeOpen, pageId, kopiertesBild |
| `src/components/Screenshot.vue` | `utils/daily` | useGetTagInfo |
| `src/components/Screenshot.vue` | `utils/formatters` | useHourMinuteFormat, useTimeFormat, useCreatedDateFormat |
| `src/components/Screenshot.vue` | `utils/utils` | useEditItem |
| `src/components/ShareCardModal.vue` | `utils/formatters` | useVorlagenKategorieLabel |
| `src/components/SidebarFilters.vue` | `stores/filters` | periodRange, positions, timeFrames, ratios, grossNet, plSatisfaction, selectedPositions, selectedTimeFrame, selectedRatio, selectedAccounts, selectedGrossNet, selectedPlSatisfaction, selectedDateRange, selectedMonth, selectedMonthPreset, selectedPeriodRange, tempSelectedPlSatisfaction, amountCase, amountCapital, selectedTags |
| `src/components/SidebarFilters.vue` | `stores/trades` | tags, availableTags |
| `src/components/SidebarFilters.vue` | `stores/ui` | pageId, timeZoneTrade, hasData |
| `src/components/SidebarFilters.vue` | `utils/formatters` | useMonthFormat, useDateCalFormat, useDateCalFormatMonth |
| `src/components/SidebarFilters.vue` | `utils/mountOrchestration` | useMountCalendar, useMountDashboard, useMountDaily, useMountAuswertung, useCheckVisibleScreen |
| `src/components/SidebarFilters.vue` | `utils/utils` | useInitTooltip, useCloseMobileMenu |
| `src/components/SideMenu.vue` | `stores/filters` | selectedBroker, brokers, selectedTradeCategory, BOT_BROKERS |
| `src/components/SideMenu.vue` | `stores/globals` | sideMenuEingeklappt, schalteSideMenu |
| `src/components/SideMenu.vue` | `stores/settings` | currentUser |
| `src/components/SideMenu.vue` | `stores/ui` | pageId, screenType, appMode |
| `src/components/SideMenu.vue` | `utils/utils` | useToggleMobileMenu |
| `src/components/SpinnerLoadingPage.vue` | `stores/ui` | spinnerLoadingPage, spinnerLoadingPageText |
| `src/components/TradeEvalPopup.vue` | `stores/trades` | evalNeu, evalNotificationShown, evalNotificationDismissed |
| `src/composables/useErweiterteInfos.js` | `stores/settings` | currentUser |
| `src/layouts/Dashboard.vue` | `stores/filters` | getMore |
| `src/layouts/Dashboard.vue` | `stores/globals` | sideMenuEingeklappt |
| `src/layouts/Dashboard.vue` | `stores/settings` | currentUser, aiReportGenerating, aiReportCountBefore, aiReportLabel |
| `src/layouts/Dashboard.vue` | `stores/trades` | screenshots, selectedScreenshot, screenshot |
| `src/layouts/Dashboard.vue` | `stores/ui` | screenType, sideMenuMobileOut, pageId, selectedScreenshotIndex, appMode, privacyMode |
| `src/layouts/Dashboard.vue` | `utils/daily` | useGetAvailableTags |
| `src/layouts/Dashboard.vue` | `utils/formatters` | useCreatedDateFormat, useTimeFormat, useHourMinuteFormat |
| `src/layouts/Dashboard.vue` | `utils/utils` | useInitParse, usePageId, useScreenType, useGetTimeZone, useGetPeriods, useSetValues, useCloseMobileMenu |
| `src/router/index.js` | `stores/globals` | appMode |
| `src/utils/calendar.js` | `stores/filters` | selectedMonth |
| `src/utils/calendar.js` | `stores/trades` | filteredTrades, calendarData, miniCalendarsData, filteredTradesDaily |
| `src/utils/calendar.js` | `stores/ui` | renderingCharts, pageId, timeZoneTrade |
| `src/utils/calendar.js` | `utils/formatters` | useMonthFormat |
| `src/utils/charts.js` | `stores/filters` | amountCase, selectedTimeFrame, selectedRatio, selectedGrossNet |
| `src/utils/charts.js` | `stores/trades` | totals, totalsByDate, groups, filteredTrades, filteredTradesTrades, satisfactionArray, satisfactionTradeArray, availableTags, profitAnalysis |
| `src/utils/charts.js` | `stores/ui` | pageId, timeZoneTrade, dailyChartZoom, barChartNegativeTagGroups |
| `src/utils/charts.js` | `utils/formatters` | useOneDecPercentFormat, useChartFormat, useThousandCurrencyFormat, useTwoDecCurrencyFormat, useTimeFormat, useHourMinuteFormat, useCapitalizeFirstLetter, useXDecCurrencyFormat, useXDecFormat |
| `src/utils/cockpitFoto.js` | `stores/filters` | selectedBroker |
| `src/utils/cockpitFoto.js` | `stores/ui` | timeZoneTrade |
| `src/utils/daily.js` | `stores/filters` | selectedRange, selectedTagIndex, filteredSuggestions, daysBack |
| `src/utils/daily.js` | `stores/settings` | currentUser |
| `src/utils/daily.js` | `stores/trades` | excursions, satisfactionArray, satisfactionTradeArray, tags, availableTags, tradeTags, tradeTagsDateUnix, tradeTagsId, newTradeTags, notes, tradeNote, tradeNoteDateUnix, tradeNoteId, availableTagsArray, tagInput, showTagsList, tradeTagsChanged, filteredTrades, screenshot, auswertungNotes, itemTradeIndex, tradeIndex |
| `src/utils/daily.js` | `stores/ui` | queryLimit, pageId, spinnerSetups, spinnerSetupsText, saveButton, screenshotsPagination, screenshotsQueryLimit |
| `src/utils/formatters.js` | `stores/ui` | timeZoneTrade, currentUser |
| `src/utils/incoming.js` | `stores/filters` | selectedBroker, brokers |
| `src/utils/incoming.js` | `stores/settings` | currentUser |
| `src/utils/incoming.js` | `stores/trades` | incomingPositions, incomingPollingActive, incomingLastFetched, incomingBrokerFehler, pendingOpeningCount, pendingClosingCount, pendingOpeningByBroker, pendingClosingByBroker, evalNotificationShown, evalNotificationDismissed, evalNeu, getNotifiedPositionIds, addNotifiedPositionIds, removeNotifiedPositionIds |
| `src/utils/incoming.js` | `stores/ui` | expandedId |
| `src/utils/journal-alt.js` | `stores/filters` | selectedBroker |
| `src/utils/journal-alt.js` | `stores/settings` | currentUser |
| `src/utils/journal-alt.js` | `stores/trades` | filteredTradesTrades, blotter, pAndL, tradeExcursionId, executions, tradeId, trades, gotExistingTradesArray, existingTradesArray, marketCloseTime |
| `src/utils/journal-alt.js` | `stores/ui` | spinnerLoadingPage, timeZoneTrade, queryLimitExistingTrades |
| `src/utils/journal-alt.js` | `utils/formatters` | useDateTimeFormat |
| `src/utils/mountOrchestration.js` | `stores/filters` | selectedRange, selectedDateRange, selectedMonth, selectedAccounts, selectedPeriodRange |
| `src/utils/mountOrchestration.js` | `stores/trades` | filteredTrades, availableTags, groups |
| `src/utils/mountOrchestration.js` | `stores/ui` | pageId, spinnerLoadingPage, dashboardChartsMounted, dashboardIdMounted, barChartNegativeTagGroups, timeZoneTrade, hasData, renderData, dailyPagination, dailyQueryLimit, endOfList, renderingCharts, spinnerLoadMore, auswertungMounted, screenshotsPagination |
| `src/utils/mountOrchestration.js` | `utils/calendar` | useLoadCalendar |
| `src/utils/mountOrchestration.js` | `utils/daily` | useGetAvailableTags, useGetExcursions, useGetSatisfactions, useGetTags, useGetNotes, useGetAuswertungNotes |
| `src/utils/mountOrchestration.js` | `utils/trades` | useCalculateProfitAnalysis, useGetFilteredTrades, useGetFilteredTradesForDaily, useGroupTrades, useTotalTrades |
| `src/utils/mountOrchestration.js` | `utils/utils` | useInitTab, useInitTooltip, useInitPopover, useGetAPIS |
| `src/utils/notify.js` | `stores/settings` | currentUser |
| `src/utils/quickImport.js` | `stores/filters` | selectedBroker |
| `src/utils/quickImport.js` | `stores/settings` | currentUser |
| `src/utils/screenshots.js` | `stores/filters` | selectedMonth, selectedTags, selectedBroker |
| `src/utils/screenshots.js` | `stores/trades` | screenshots, screenshot, tradeScreenshotChanged, selectedScreenshot, tags, tradeTags, screenshotsInfos |
| `src/utils/screenshots.js` | `stores/ui` | pageId, dateScreenshotEdited, renderData, markerAreaOpen, spinnerLoadingPage, spinnerSetups, editingScreenshot, timeZoneTrade, endOfList, screenshotsPagination, screenshotsQueryLimit, selectedItem, saveButton, selectedScreenshotIndex, selectedScreenshotSource, resizeCompressImg, resizeCompressMaxWidth, resizeCompressMaxHeight, resizeCompressQuality, expandedScreenshot, expandedId, expandedSource |
| `src/utils/screenshots.js` | `utils/daily` | useUpdateTags, useUpdateAvailableTags |
| `src/utils/trades.js` | `stores/filters` | selectedRange, selectedDateRange, selectedPositions, selectedAccounts, selectedTags, selectedBroker, selectedTradeCategory, daysBack |
| `src/utils/trades.js` | `stores/trades` | filteredTrades, filteredTradesTrades, pAndL, blotter, totals, totalsByDate, groups, profitAnalysis, timeFrame, satisfactionArray, satisfactionTradeArray, tags, filteredTradesDaily, excursions, availableTags, imports |
| `src/utils/trades.js` | `stores/ui` | pageId, spinnerLoadingPage, queryLimit, timeZoneTrade, hasData, dailyPagination, dailyQueryLimit, endOfList, selectedItem |
| `src/utils/trades.js` | `utils/daily` | useGetTagInfo |
| `src/utils/trades.js` | `utils/formatters` | useDateTimeFormat |
| `src/utils/trades.js` | `utils/journal-alt` | useCreateBlotter, useCreatePnL |
| `src/utils/utils.js` | `stores/filters` | periodRange, selectedDashTab, selectedPeriodRange, selectedPositions, selectedTimeFrame, selectedRatio, selectedAccount, selectedGrossNet, selectedPlSatisfaction, selectedBroker, selectedDateRange, selectedMonth, selectedMonthPreset, selectedAccounts, amountCase, selectedRange, selectedTags, selectedTradeTimeframes |
| `src/utils/utils.js` | `stores/settings` | apis, layoutStyle |
| `src/utils/utils.js` | `stores/trades` | tags, filteredTrades, screenshots, screenshotsInfos, availableTags, groups |
| `src/utils/utils.js` | `stores/ui` | pageId, timeZoneTrade, currentUser, renderData, screenshotsPagination, selectedItem, sideMenuMobileOut, spinnerLoadingPage, dashboardChartsMounted, dashboardIdMounted, hasData, renderingCharts, screenType, dailyQueryLimit, dailyPagination, endOfList, spinnerLoadMore, windowIsScrolled, legacy, idCurrent, idPrevious, idCurrentType, idCurrentNumber, idPreviousType, idPreviousNumber, tabGettingScreenshots, countdownInterval, countdownSeconds, barChartNegativeTagGroups, auswertungMounted |
| `src/utils/utils.js` | `utils/daily` | useGetAvailableTags, useGetTags |
| `src/utils/utils.js` | `utils/formatters` | useStartOfDay |
| `src/utils/utils.js` | `utils/trades` | useDeleteTrade, useDeleteExcursions |
| `src/views/Accounts.vue` | `stores/filters` | brokers |
| `src/views/Accounts.vue` | `stores/ui` | spinnerLoadingPage |
| `src/views/AddExcursions.vue` | `stores/filters` | daysMargin, daysBack |
| `src/views/AddExcursions.vue` | `stores/settings` | apis |
| `src/views/AddExcursions.vue` | `stores/trades` | imports, excursions |
| `src/views/AddExcursions.vue` | `stores/ui` | spinnerLoadingPage |
| `src/views/AddExcursions.vue` | `utils/daily` | useGetExcursions |
| `src/views/AddExcursions.vue` | `utils/formatters` | useDateCalFormat |
| `src/views/AddExcursions.vue` | `utils/journal-alt` | useGetOHLCV, useGetMFEPrices, useUpdateMfePrices |
| `src/views/AddExcursions.vue` | `utils/trades` | useGetTrades |
| `src/views/AddExcursions.vue` | `utils/utils` | useGetAPIS, usePageRedirect |
| `src/views/AddTrades.vue` | `stores/filters` | selectedBroker |
| `src/views/AddTrades.vue` | `stores/trades` | executions, existingImports, blotter, pAndL, tradesData, existingTradesArray, trades as globalTrades |
| `src/views/AddTrades.vue` | `stores/ui` | spinnerLoadingPage |
| `src/views/AddTrades.vue` | `utils/formatters` | useCreatedDateFormat, useDateCalFormat |
| `src/views/AddTrades.vue` | `utils/journal-alt` | useUploadTrades, useGetExistingTradesArray, useCreateBlotter, useCreatePnL |
| `src/views/AgentBuilder.vue` | `stores/ui` | spinnerLoadingPage |
| `src/views/AgentEditor.vue` | `stores/ui` | spinnerLoadingPage |
| `src/views/AgentLab.vue` | `stores/ui` | spinnerLoadingPage |
| `src/views/AgentLab.vue` | `utils/formatters` | useXDecCurrencyFormat |
| `src/views/AgentPerformance.vue` | `stores/ui` | spinnerLoadingPage |
| `src/views/AgentPerformance.vue` | `utils/formatters` | useXDecCurrencyFormat |
| `src/views/AgentSetups.vue` | `stores/ui` | spinnerLoadingPage |
| `src/views/AgentSetups.vue` | `utils/formatters` | useXDecCurrencyFormat |
| `src/views/AgentStrategies.vue` | `stores/ui` | spinnerLoadingPage |
| `src/views/AgentStrategies.vue` | `utils/formatters` | useXDecCurrencyFormat |
| `src/views/Auswertung.vue` | `stores/filters` | amountCase |
| `src/views/Auswertung.vue` | `stores/trades` | filteredTrades, auswertungNotes, satisfactionArray, satisfactionTradeArray, tags, availableTags |
| `src/views/Auswertung.vue` | `stores/ui` | spinnerLoadingPage, auswertungMounted |
| `src/views/Auswertung.vue` | `utils/formatters` | useChartFormat, useThousandCurrencyFormat |
| `src/views/Auswertung.vue` | `utils/mountOrchestration` | useMountAuswertung |
| `src/views/Calendar.vue` | `stores/trades` | calendarData, filteredTrades |
| `src/views/Calendar.vue` | `stores/ui` | spinnerLoadingPage |
| `src/views/Calendar.vue` | `utils/mountOrchestration` | useMountCalendar |
| `src/views/CoinRadar.vue` | `stores/globals` | currentUser |
| `src/views/CoinRadar.vue` | `utils/formatters` | useKostenAnzeige |
| `src/views/Daily.vue` | `stores/filters` | amountCase, selectedGrossNet, selectedTagIndex, filteredSuggestions |
| `src/views/Daily.vue` | `stores/settings` | currentUser, apis |
| `src/views/Daily.vue` | `stores/trades` | calendarData, filteredTrades, screenshots, screenshot, tradeScreenshotChanged, excursion, tradeExcursionChanged, tradeExcursionId, tradeExcursionDateUnix, tradeId, excursions, itemTradeIndex, tradeIndex, tradeIndexPrevious, availableTags, tradeTagsChanged, tagInput, tags, tradeTags, showTagsList, tradeTagsId, tradeTagsDateUnix, newTradeTags, notes, tradeNote, tradeNoteChanged, tradeNoteDateUnix, tradeNoteId, availableTagsArray, screenshotsInfos, satisfactionTradeArray, satisfactionArray |
| `src/views/Daily.vue` | `stores/ui` | spinnerLoadingPage, modalDailyTradeOpen, markerAreaOpen, spinnerSetups, spinnerSetupsText, hasData, saveButton, spinnerLoadMore, endOfList, timeZoneTrade, idCurrentType, idCurrentNumber, tabGettingScreenshots, scrollToDateUnix |
| `src/views/Daily.vue` | `utils/daily` | useGetExcursions, useGetTags, useGetAvailableTags, useUpdateAvailableTags, useUpdateTags, useFindHighestIdNumber, useFindHighestIdNumberTradeTags, useUpdateNote, useGetNotes, useGetTagInfo, useCreateAvailableTagsArray, useFilterSuggestions, useTradeTagsChange, useFilterTags, useToggleTagsDropdown, useResetTags, useDailySatisfactionChange |
| `src/views/Daily.vue` | `utils/formatters` | useCreatedDateFormat, useTwoDecCurrencyFormat, useTimeFormat, useTimeDuration, useDecimalsArithmetic, useDateCalFormat, useSwingDuration, useStartOfDay |
| `src/views/Daily.vue` | `utils/journal-alt` | useGetMFEPrices, useCreateOHLCV |
| `src/views/Daily.vue` | `utils/mountOrchestration` | useMountDaily, useGetSelectedRange, useLoadMore, useCheckVisibleScreen, useDisposeJournalCharts |
| `src/views/Daily.vue` | `utils/utils` | useInitTooltip, useInitTab |
| `src/views/Dashboard.vue` | `stores/filters` | selectedDashTab, amountCase, amountCapital, selectedRatio, selectedBroker, selectedTradeCategory |
| `src/views/Dashboard.vue` | `stores/globals` | incomingPositions |
| `src/views/Dashboard.vue` | `stores/settings` | currentUser |
| `src/views/Dashboard.vue` | `stores/trades` | totals, profitAnalysis, satisfactionArray, satisfactionTradeArray, availableTags, groups, filteredTradesTrades, excursions |
| `src/views/Dashboard.vue` | `stores/ui` | spinnerLoadingPage, dashboardIdMounted, renderData, dashboardChartsMounted, hasData, barChartNegativeTagGroups, timeZoneTrade |
| `src/views/Dashboard.vue` | `utils/formatters` | useThousandCurrencyFormat, useTwoDecCurrencyFormat, useXDecCurrencyFormat, useThousandFormat, useXDecFormat |
| `src/views/Dashboard.vue` | `utils/mountOrchestration` | useMountDashboard, useDisposeJournalCharts |
| `src/views/HypeRadar.vue` | `stores/globals` | currentUser |
| `src/views/HypeRadar.vue` | `utils/formatters` | useKostenAnzeige |
| `src/views/Incoming.vue` | `stores/filters` | allTradeTimeframes, selectedTradeTimeframes, selectedBroker, selectedTradeCategory, brokers |
| `src/views/Incoming.vue` | `stores/settings` | currentUser |
| `src/views/Incoming.vue` | `stores/trades` | incomingPositions, incomingPollingActive, incomingLastFetched, incomingBrokerFehler, availableTags |
| `src/views/Incoming.vue` | `stores/ui` | spinnerLoadingPage, timeZoneTrade, expandedId, kopiertesBild |
| `src/views/Incoming.vue` | `utils/daily` | useGetAvailableTags, useGetTagInfo |
| `src/views/KiAgent.vue` | `stores/filters` | selectedBroker |
| `src/views/KiAgent.vue` | `stores/settings` | aiReportGenerating, aiReportError, aiReportLastSavedId, aiReportLabel, aiReportCountBefore |
| `src/views/KiAgent.vue` | `stores/ui` | spinnerLoadingPage |
| `src/views/Lernen.vue` | `stores/ui` | spinnerLoadingPage |
| `src/views/LiveAuswertung.vue` | `stores/ui` | timeZoneTrade |
| `src/views/Livetrading.vue` | `stores/globals` | currentUser |
| `src/views/Livetrading.vue` | `stores/ui` | kopiertesBild |
| `src/views/Marktradar.vue` | `stores/globals` | currentUser |
| `src/views/Nachrichten.vue` | `stores/globals` | spinnerLoadingPage, currentUser |
| `src/views/Nachrichten.vue` | `stores/ui` | timeZoneTrade |
| `src/views/Nachrichten.vue` | `utils/formatters` | useKostenAnzeige |
| `src/views/Playbook.vue` | `stores/filters` | allTradeTimeframes, selectedTradeTimeframes, selectedBroker |
| `src/views/Playbook.vue` | `stores/trades` | availableTags |
| `src/views/Playbook.vue` | `stores/ui` | spinnerLoadingPage, timeZoneTrade, kopiertesBild |
| `src/views/Playbook.vue` | `utils/daily` | useGetAvailableTags, useGetTagInfo |
| `src/views/Playbook.vue` | `utils/formatters` | useCreatedDateFormat |
| `src/views/Screenshots.vue` | `stores/trades` | screenshots |
| `src/views/Screenshots.vue` | `stores/ui` | spinnerLoadMore, spinnerLoadingPage, expandedScreenshot, endOfList |
| `src/views/Screenshots.vue` | `utils/mountOrchestration` | useMountScreenshots, useCheckVisibleScreen, useLoadMore |
| `src/views/Settings.vue` | `stores/filters` | allTradeTimeframes, selectedTradeTimeframes, selectedBroker |
| `src/views/Settings.vue` | `stores/settings` | currentUser, renderProfile |
| `src/views/Settings.vue` | `stores/ui` | appMode |
| `src/views/Settings.vue` | `utils/formatters` | useDateCalFormat, useKostenAnzeige, useKostenZahl, useVorlagenKategorieLabel |
| `src/views/Settings.vue` | `utils/utils` | useCheckCurrentUser, useInitTooltip, useGetPeriods |
| `src/views/Start.vue` | `stores/settings` | currentUser |
| `src/views/Start.vue` | `stores/ui` | appMode |
| `src/views/Start.vue` | `utils/utils` | usePageId |
