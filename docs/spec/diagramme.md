# Spezifikation: Journal-Diagramme (Ersatz für `src/utils/charts.js`)

Stand: 19.10.2026 · Clean-Room-Schritt 1 (Funktionsbeschreibung) · Grundlage für den Neubau durch eine Person, die den Altcode nicht kennt.

Diese Spezifikation beschreibt, **welche Daten** jedes Diagramm erzeugt, nicht wie es aussieht. Das Aussehen (Farben, Schrift, Abstände, Animation) wird neu gestaltet. Ausnahme: wo der Golden Master (`src/utils/__selftest-journal.mjs`) Gestaltungswerte innerhalb der Datenpunkte mitvergleicht, ist das in Abschnitt 5 ausdrücklich genannt.

Begriffe: „ECharts" = Apache ECharts 5 (bleibt Abhängigkeit). „Option" = das Konfigurationsobjekt, das einer Diagramm-Instanz per `setOption` übergeben wird. „Fall" (`betragArt`) = `'net'` oder `'gross'`; Feldnamen wie „*Fall*Proceeds" bedeuten `netProceeds` bzw. `grossProceeds`.

---

## 1. Überblick und gemeinsame Konventionen

### 1.1 Modul und öffentliche Schnittstelle

Das Modul ist eine ES-Datei, die ECharts **statisch** importiert. Alle Aufrufer ausserhalb der Ansichten mit eigenem Chunk laden es **dynamisch** (`import('./charts.js')`), damit ECharts nicht ins Start-Bundle gerät (`mountOrchestration.js`, `utils.js`, `SidebarFilters.vue`). Der Neubau muss unter demselben Pfad (`src/utils/charts.js`) dieselben benannten Exporte anbieten:

| Export | Art | Kurz |
|---|---|---|
| `zeichneDiagramme(param)` | async Funktion | Verteiler für das Journal-Dashboard |
| `zeichneDoppellinie()` | Funktion → Promise | Tagesansicht: kumulierte Tageslinien |
| `zeichneTorte()` | Funktion → Promise | Tagesansicht: Gewinnquote je Tag |
| `useDoubleLineChart(id, brutto, netto, kategorien)` | → Promise | Doppellinie |
| `useLineBarChart(id)` | → Promise | Kumulierte Linie + Balken je Zeitraum |
| `usePieChart(id, gruen, rot)` | → Promise | Ring mit zwei Anteilen |
| `useBarChart(id)` | → Promise | Kennzahl bzw. Gewinnquote je Zeitraum |
| `useBarChartNegative(id)` | → Promise | Kennzahl je Gruppe (horizontal, Altinventar) |
| `useCandlestickChart(...)` | → Promise<Instanz> | Kerzen eines Trades |
| `useGaugeChart(...)`, `useHorizontalBarChart(...)`, `useSplitBarChart(...)`, `useStressLineChart(...)`, `useRadarChart(...)` | → Promise | Auswertungsseite |
| `usePerfChart(id)` | → Promise | Equity/HWM/Drawdown + PnL je Trade |
| `usePositionChart`, `useStrategyChart`, `useWeekdayChart`, `useEntryTimeChart`, `useDurationChart`, `useSymbolChart` (je `(id)`) | → Promise | Kennzahl je Gruppe (horizontal, neues Inventar) |
| `useHeatmapChart(id)` | → Promise | Wochentag × Stunde |
| `useFeesChart(id)` | → Promise | Gebühren je Symbol |
| `useSetupChart(id, kerzen, setup)` | → Instanz oder `null` (synchron) | Strategie-Setup |
| `useAgentTimelineChart(id, kerzen, setups, trades)` | → Instanz oder `null` (synchron) | Zeitstrahl eines Symbols |
| `disposeCharts(knoten)` | Funktion | Instanzen zu DOM-Knoten entsorgen |
| `cssColor87`, `cssColor60`, `cssColor38`, `blackbg5`, `greenColor`, `redColor` | Zeichenketten | Farbkonstanten (siehe 1.7) |

Alle `→ Promise`-Funktionen erledigen ihre Arbeit **synchron** beim Aufruf und geben ein bereits erfülltes Promise zurück (Ausnahme: Fehlerfälle unten). Aufrufer verlassen sich darauf, dass nach dem Aufruf — auch ohne `await` — die Option gesetzt ist (der Golden Master ruft `zeichneDoppellinie()` und `zeichneTorte()` ohne `await` auf und liest danach sofort aus).

### 1.2 Gelesene Stores

Das Modul liest ausschliesslich globale, reaktive Stores (keine Parameter) — diese Namen sind Schnittstelle:

| Store-Modul | Name | Bedeutung für die Diagramme |
|---|---|---|
| `stores/ui.js` | `pageId` (ref) | `'dashboard'` / `'daily'` — beeinflusst nur Beschriftungen des Rings |
| | `timeZoneTrade` (ref) | Zeitzone (IANA) für alle Uhrzeit-/Datums-Beschriftungen und die Heatmap |
| | `tagesChartZoom` (ref, 1/2/3, Vorgabe 3) | Anfangsausschnitt des Kerzencharts |
| | `negativeTagGruppen` (ref auf Liste `{id, name}`) | Tag-Gruppen, für die `useBarChartNegative` eine Gruppen-ID im Element-Namen erkennt |
| `stores/filters.js` | `betragArt` (ref, `'net'`/`'gross'`) | Fall |
| | `selectedTimeFrame` (ref: `'daily'`/`'weekly'`/`'monthly'`, kann `null` sein) | Bündelung bei `useLineBarChart`/`useBarChart` |
| | `selectedRatio` (ref: `'appt'`/`'profitFactor'`, im Code zusätzlich `'apps'`; kann `null` sein) | Kennzahl der Gruppen- und Zeitraumdiagramme |
| `stores/trades.js` | `totals` (reactive) | Gesamtsummen der gefilterten Trades |
| | `summenJeTag` (reactive, Schlüssel = Tages-Unixzeit in s als Zeichenkette) | Tagessummen |
| | `groups` (reactive) | Gruppierungen, siehe 1.3 |
| | `journalTage` (reactive Liste von Tageszeilen) | Tagesansicht |
| | `gefilterteTradesFlach` (reactive Liste von Einzeltrades) | Perf/Fees/Heatmap |
| | `zufriedenheitTage`, `zufriedenheitTrades` (reactive Listen) | Zufriedenheitsring |
| | `verfuegbareTags` (reactive Liste von Tag-Gruppen `{id, name, tags:[{id,name}]}`) | erste Gruppe = „Strategie" |
| | `gewinnAnalyse` (reactive) | Feld *Fall*`R` für den RRR-Ring |

Wichtig: `selectedTimeFrame` und `selectedRatio` werden aus `localStorage` initialisiert und sind bei frischem Speicher `null`. Im Golden Master sind **beide `null`** (siehe Abschnitt 5) — das bestimmt fast alle dort eingefrorenen Werte.

### 1.3 Form der Eingabedaten

- **Einzeltrade** (Element von `gefilterteTradesFlach`, `journalTage[i].trades` und der meisten `groups`-Listen): u. a. `id`, `td` (Tages-Unixzeit s), `symbol`, `strategy` (`'long'`/`'short'`), `entryTime`/`exitTime` (Unixzeit **s**), `entryPrice`/`exitPrice`, `buyQuantity`, `grossProceeds`, `netProceeds`, `grossWins`, `grossLoss` (≤ 0), `netWins`, `netLoss` (≤ 0), `grossWinsCount`, `grossLossCount`, `netWinsCount`, `netLossCount`, `tradesCount` (1), `commission`, `tradingFee`, `fundingFee` (vorzeichenbehaftet: + erhalten, − bezahlt). Bei Tag-Gruppen zusätzlich `tagName`.
- **Tagessumme** (Werte von `summenJeTag`, Elemente von `groups.trades`, `journalTage[i].pAndL`): Summenfelder mit gleichen Namen wie oben, Zähler heisst hier `trades` (nicht `tradesCount`), dazu *Fall*`WinsCount`, *Fall*`LossCount`, `buyQuantity`.
- **`groups`**: Objekt aus Teilgruppen; jede Teilgruppe ist ein Objekt *Gruppenschlüssel → Liste von Elementen*. Benutzt werden: `timeframe` (Schlüssel „HH:mm" der Einstiegszeit, auf das Zeitraster gerundet), `duration` (Schlüssel = Minuten-Untergrenze als Zahl-Zeichenkette: 0, 1, 2, 5, 10, 20, 40, 60), `day` (0 = Sonntag … 6 = Samstag), `trades` (Elemente sind **Tagessummen**; Schlüssel = Trades-pro-Tag-Klasse), `executions`, `position` (`long`/`short`), `tags` (Schlüssel = Tag-ID), `group_<n>` (eine Teilgruppe je Tag-Gruppe), `symbols`, `entryPrice`, `shareFloat`, `mktCap`. Aufbau und Schlüsselbildung gehören zu `trades.js` (eigene Spezifikation); die Diagramme lesen nur.
- **Reihenfolge von Objektschlüsseln** ist JavaScript-Standard: ganzzahlige Schlüssel (z. B. Tages-Unixzeiten, „0"…„6", „5", „10") **aufsteigend numerisch**, alle anderen in Einfügereihenfolge. Mehrere Diagramme hängen genau davon ab.

### 1.4 DOM- und Instanz-Konventionen

- Ein Diagramm wird immer über `document.getElementById(id)` gefunden.
- Instanz holen: **vorhandene Instanz am Knoten wiederverwenden** (`echarts.getInstanceByDom`), sonst `echarts.init(knoten)`. Nie zweimal `init` auf denselben Knoten (wirft in ECharts 5). Nachfolgende `setOption`-Aufrufe **mischen** (merge) in die bestehende Option — ausser bei `useSplitBarChart` (ersetzt, `notMerge`).
- `useSetupChart` und `useAgentTimelineChart` **entsorgen** eine vorhandene Instanz zuerst und legen eine frische an.
- Fehlt das Element, wird in der Regel still nichts gezeichnet (Ausnahmen je Abschnitt).
- **Sichtbarkeit**: `zeichneDiagramme('init')` überspringt Elemente mit `clientWidth === 0` oder `clientHeight === 0` (versteckter Bootstrap-Tab). `useHeatmapChart` prüft zusätzlich selbst `clientWidth === 0`.
- **Größenänderung**: Beim ersten Aufruf von `zeichneDiagramme` oder `usePerfChart` wird einmalig ein globaler `resize`-Listener am `window` registriert; er ruft nach 150 ms Ruhe `resize()` auf jeder vorhandenen Instanz an Elementen mit Klasse `chartClass` oder `chartIdCardClass` auf.
- Die Testattrappe (`__journal-attrappen.mjs`) liefert für `getInstanceByDom` **immer `undefined`**, `init(el)` liefert ein Objekt, dessen `setOption(o)` die Option unter `el.id` ablegt (letzte gewinnt). Ein Neubau darf also nur `init`, `getInstanceByDom`, `setOption`, `clear`, `dispose`, `resize`, `on`, `off`, `getOption` und `graphic.LinearGradient` aus ECharts benutzen, sonst bricht der Golden Master (weitere ECharts-Funktionen wären in der Attrappe nachzurüsten).

### 1.5 Formatierer (aus `src/utils/formatters.js`, Schnittstelle)

| Name | Ausgabe |
|---|---|
| `useChartFormat(s)` | Datum „D.M.YYYY" in `timeZoneTrade` |
| `useHourMinuteFormat(s)` | „HH:mm" in `timeZoneTrade` |
| `useCapitalizeFirstLetter(t)` | erster Buchstabe gross |
| `useOneDecPercentFormat(x)` | Prozent, max. 1 Nachkommastelle (0,4545 → „45,5 %") |
| `useThousandCurrencyFormat(x)` | USD ohne Nachkommastellen |
| `useTwoDecCurrencyFormat(x)` | USD, max. 2 Nachkommastellen |
| `useXDecCurrencyFormat(x, n)` / `useXDecFormat(x, n)` | USD bzw. Zahl mit max. n Nachkommastellen |

Diese Formatierer erscheinen nur in Beschriftungen/Tooltips (Funktionen) und sind für den Golden Master unsichtbar; wo sie **Kategorie-Daten** erzeugen (Achsenbeschriftung als Daten), ist das genannt.

### 1.6 i18n

Übersetzungen über `i18n.global.t(key)` aus `src/i18n`. Verwendete Schlüssel (Schnittstelle, Werte aus `de.json`):

| Schlüssel | de | Verwendung |
|---|---|---|
| `charts.pnl` | PnL | Perf: Reihe/Legende |
| `charts.equity` | Equity | Perf |
| `charts.highWaterMark` | High Water Mark | Perf |
| `charts.drawdown` | Drawdown | Perf |
| `charts.equityDollar`, `charts.tradePnlDollar` | Equity ($), Trade PnL ($) | Perf: Achsennamen |
| `charts.wins`, `charts.losses` | Wins, Losses | SplitBar: Reihennamen |
| `charts.completeness` | Vollständigkeit | Radar: Datenname |
| `charts.entryPrevDay`, `charts.exitNextDay` | Entry (Vortag), Exit (Folgetag) | Kerzen: Randpfeile |
| `options.profitFactor` | Profitfaktor | Tooltip der Gruppen-Diagramme |
| `dashboard.tradingFees`, `dashboard.fundingPaid`, `dashboard.fundingReceived` | Trading Fees, Funding bezahlt, Funding erhalten | Fees: Reihen/Legende |
| `strategies.chartEntry`, `chartStop`, `chartTarget`, `chartSweep`, `chartOrderBlock`, `chartExit` | Einstieg, Stop, Ziel, Sweep-Level, Order Block, Ausstieg | Setup/Zeitstrahl |

### 1.7 Exportierte Farbkonstanten

Exportiert werden `cssColor87`, `cssColor60`, `cssColor38` (helle Schrift-/Linienstufen: hoch, mittel, schwach), `blackbg5` (sehr dunkler Hintergrund), `greenColor` (positiv), `redColor` (negativ). Einziger externer Nutzer: `src/views/AgentPerformance.vue` — dort für eigene, lokal gebaute ECharts-Optionen (Achsenlinien/-schrift, Tooltip-Hintergrund und -Schrift, Balkenfarbe grün/rot nach Vorzeichen). Die Werte werden im Neubau aus den Design-Tokens (`src/assets/design/tokens.css`: `--text`, `--muted`, `--line`, `--bg`, `--good`, `--bad`) abgeleitet; es müssen gültige CSS-Farbzeichenketten bleiben. **Achtung Golden Master:** `greenColor`/`redColor` und ihre Hover-Varianten stehen als Zeichenketten in `perfChart1` (Abschnitt 5.3).

### 1.8 Gemeinsame Kennzahl-Regeln

Mehrere Diagramme bilden je Gruppe dieselben Summen über die Elemente: Σwins = Σ *Fall*`Wins`, Σloss = Σ *Fall*`Loss` (≤ 0), Σproceeds = Σ *Fall*`Proceeds`, n = Σ `tradesCount` (Ausnahme genannt), q = Σ `buyQuantity`. Summiert wird ohne Zahlumwandlung (fehlende Felder ergäben NaN). Die Regeln für Division durch 0 **unterscheiden sich je Diagrammfamilie** und sind jeweils exakt angegeben. JSON-Hinweis: `Infinity`, `-Infinity`, `NaN` und `undefined` in Listen werden beim Golden-Master-Vergleich zu `null`.

---

## 2. Einstieg und Verteilung

### 2.1 `zeichneDiagramme(param)`

`param` ist `'init'` (zeichnen) oder `'clear'` (Inhalt leeren). Ein Präfixname (z. B. `'perfChart'`) würde laut Altverhalten nur diese Familie zeichnen; kein Aufrufer nutzt das, es muss nicht erhalten bleiben.

Ablauf (Reihenfolge ist relevant, weil spätere Aufrufe frühere am selben Element überschreiben):

1. Resize-Listener sicherstellen (1.4).
2. **Ringe `pieChart1`, `pieChart2`, `pieChart3`** (in dieser Reihenfolge, je per `getElementById`):
   - `'clear'`: vorhandene Instanz leeren (nur wenn eine existiert).
   - `'init'`: Element fehlt oder unsichtbar → überspringen. Sonst:
     - `pieChart1` (Gewinnquote): grün = *Fall*`WinsCount` / `totals.trades`, rot = *Fall*`LossCount` / `totals.trades` aus `totals`; ist `totals.trades` falsy (0/undefined), beide 0. Immer zeichnen.
     - `pieChart2` (Zufriedenheit): Liste L = `zufriedenheitTage` gefolgt von `zufriedenheitTrades`. Nur wenn L nicht leer: grün = Anzahl Einträge mit `satisfaction` lose gleich `true` oder `1` / |L|, rot = Anzahl mit `satisfaction` lose gleich `false` oder `0` / |L| (lose Gleichheit: `1`, `true`, `"1"` zählen zufrieden; `0`, `false`, `""`, `"0"` unzufrieden; `null`/`undefined` keines von beiden, zählen aber im Nenner). Sonst nicht zeichnen.
     - `pieChart3` (RRR): R = `gewinnAnalyse[`*Fall*`R]`. Nur wenn R truthy, keine NaN und R > 0: grün = R/(R+1), rot = 1/(R+1). Sonst nicht zeichnen.
     - Zeichnen über `usePieChart(id, grün, rot)` (wird jeweils abgewartet).
3. **Familien per Präfix**: für jedes Präfix in der Reihenfolge `perfChart`, `feesChart`, `symbolChart`, `weekdayChart`, `entryTimeChart`, `durationChart`, `positionChart`, `strategyChart`, `lineBarChart`, `barChart`, `barChartNegative`, `heatmapChart` werden alle Elemente mit `id` beginnend mit dem Präfix gesucht (`document.querySelectorAll('[id^="<Präfix>"]')`, genau diese Selektor-Form nutzt die Testattrappe). Je Element in Dokumentreihenfolge:
   - `'clear'`: vorhandene Instanz leeren.
   - `'init'`: unsichtbar → überspringen; sonst die Familienfunktion mit `element.id` aufrufen (nicht abgewartet; die Arbeit geschieht synchron).
   - **Präfix-Überlappung (muss erhalten bleiben):** `barChart` trifft auch alle `barChartNegative…`-Elemente. Diese bekommen zuerst `useBarChart(id)` (das für fremde IDs eine Option mit leerer Balkenreihe, aber gefüllter Kategorieachse setzt, siehe 3.4) und danach `useBarChartNegative(id)`, das nur überschreibt, wenn es mindestens einen Wert hat. `lineBarChart…` wird von `barChart` **nicht** getroffen (Präfix am Anfang).
4. Rückgabe: Promise ohne Wert.

Aufrufer:
- `mountOrchestration.js` `starteDashboard`: nach dem Laden, wenn `journalHatDaten`: `useDisposeJournalCharts()`, `zeichenZaehler` erhöhen (Vue ersetzt die Knoten per `:key`), `nextTick`, dann `zeichneDiagramme('init')`. Vorher wird `negativeTagGruppen` mit allen `verfuegbareTags`-Gruppen `{id, name}` gefüllt, deren `id` ein Schlüssel von `groups` ist.
- `utils.js` `useInitTab('dashboard')`: bei jedem Tab-Wechsel (`shown.bs.tab`) `zeichenZaehler` erhöhen, `nextTick`, `zeichneDiagramme('init')`.
- `SidebarFilters.vue` `saveFilter`: auf dem Dashboard mit gültigem Zeitraum und `journalHatDaten` → `zeichneDiagramme('clear')` (der anschliessende Mount zeichnet neu).

Dashboard-Elemente (`src/views/Dashboard.vue`): `pieChart1`–`3` (Klasse `chartIdCardClass`), `lineBarChart1`, `barChart1`, `barChart2`, `weekdayChart1`, `entryTimeChart1`, `durationChart1`, `heatmapChart1`, `perfChart1`, `positionChart1`, `strategyChart1`, `symbolChart1`, `feesChart1` (Klasse `chartClass`). `boxPlotChart1`, `scatterChart1`, `scatterChart2` existieren im Template, werden aber von keiner Funktion bedient (bleiben leer). `barChartNegative12`/`14` stehen nur in auskommentiertem Template.

### 2.2 `disposeCharts(knoten)` und `useDisposeJournalCharts`

`disposeCharts` nimmt eine iterierbare Liste von DOM-Knoten und entsorgt zu jedem die vorhandene ECharts-Instanz (falls eine existiert). Muss auch für Knoten funktionieren, die bereits aus dem Dokument entfernt wurden (Registry-Lookup über den Knoten, nicht über `getElementById`). Keine Rückgabe.

`useDisposeJournalCharts()` in `mountOrchestration.js` (nicht Teil des Moduls, ruft es nur): tut nichts, solange das Diagramm-Modul noch nie geladen wurde; sonst sammelt es **synchron** alle Knoten mit Selektor `.chartClass, .chartIdCardClass, #candlestickChart` und übergibt sie an `disposeCharts`. Aufruf vor dem Ersetzen der Knoten (Dashboard-Mount, `onBeforeUnmount` der Journal-Ansichten).

### 2.3 `zeichneDoppellinie()` (Tagesansicht)

Für jede Tageszeile `z` in `journalTage` (Reihenfolge der Liste) mit ID **`doubleLineChart<z.dateUnix>`**:
- Für jeden Trade `t` in `z.trades` (Reihenfolge der Liste, **keine** Sortierung):
  - b = `t.grossProceeds` auf 2 Nachkommastellen gerundet (kaufmännisch via Festkomma-Darstellung, dann zurück in Zahl);
  - n = `t[`*Fall*`Proceeds]` ebenso gerundet;
  - Bruttoreihe: erster Wert b, danach vorheriger Wert + b (die Summe selbst wird **nicht** erneut gerundet, Gleitkommareste wie 3,9200000000000004 bleiben);
  - Nettoreihe analog mit n;
  - Kategorie: `useHourMinuteFormat(t.exitTime)`.
- Aufruf `useDoubleLineChart(id, bruttoreihe, nettoreihe, kategorien)`.
- Mehrere Tageszeilen mit gleichem `dateUnix` (verschiedene Börsen) zielen auf dieselbe ID; die **zuletzt** verarbeitete Zeile bestimmt die Option.
- Rückgabe: erfülltes Promise. Aufrufer: `starteTagesansicht`, `ladeWeitere` (Seite `daily`).
- Hinweis: Die aktuelle `Daily.vue` rendert keine Elemente `doubleLineChart…`/`pieChart<dateUnix>` mehr; in der App wird daher still nichts gezeichnet. Der Golden Master prüft die Funktion trotzdem (Attrappe liefert für jede ID ein Element).

### 2.4 `zeichneTorte()` (Tagesansicht)

Fall a = `'net'`, wenn `betragArt` `'net'` ist, sonst `'gross'` (auch bei ungültigem Wert). Für jede Tageszeile `z` in `journalTage`, ID **`pieChart<z.dateUnix>`**:
- p = `z.pAndL` oder leeres Objekt; N = Zahl(`p.trades`) oder 0; W = Zahl(`p[a+'WinsCount']`), V = Zahl(`p[a+'LossCount']`).
- bekannt ⇔ N > 0 und W, V endliche Zahlen. grün = bekannt ? W/N : 0, rot = bekannt ? V/N : 0 (fehlende Zählung ergibt also 0/0 = leerer Ring, nicht NaN).
- `usePieChart(id, grün, rot)`. Gleiche-ID-Regel wie 2.3 (letzte gewinnt).

---

## 3. Die Diagramme im Einzelnen

Notation für die Golden-Master-Sicht: **series** = Liste `{name, type, data}`; **xAxis/yAxis** = je Achse das Feld `data` (fehlt → `null`); **legend** = je Legende das Feld `data`. Ist `xAxis`/`yAxis`/`legend` in der Option ein einzelnes Objekt, zählt es als Liste mit einem Eintrag; fehlt es, ist die Liste leer.

### 3.1 `useDoubleLineChart(id, brutto, netto, kategorien)`

- Element fehlt → nichts.
- Typ: zwei Linien (geglättet, ohne Punktsymbole).
- series: `[{type:'line', data: brutto}, {type:'line', data: netto}]` — keine Namen.
- xAxis: ein Objekt, `data` = `kategorien` (Kategorieachse, Uhrzeiten). yAxis: ein Objekt (Wertachse, Beschriftung ausgeblendet), ohne `data`.
- Keine Legende. Tooltip: Zeit, „Gross: <brutto ganzzahlig>$", „Net: <netto ganzzahlig>$".

### 3.2 `usePieChart(id, grün, rot)`

- Element fehlt → nichts. Dritter Parameter (Seite) wird ignoriert; die Seite kommt aus `pageId`.
- Typ: Ring (innerer Radius 70 %, äusserer 100 %), Hervorhebung aus.
- series: genau eine `{type:'pie', data: [{value: grün}, {value: rot}]}` — Datenpunkte sind **Objekte mit nur `value`** (Farbe kommt per Funktion, unsichtbar für den Golden Master). Werte unverändert, nicht normiert (bei Break-even-Trades ist grün + rot < 1).
- Keine Achsen, keine Legende.
- Mittelbeschriftung (nur Inhalt): `pageId` = `'dashboard'`: `pieChart1` → Prozent(grün) + „Win rate"; `pieChart2` → Prozent(grün) + „Satisfaction"; `pieChart3` → „1:" + R mit 1 Nachkommastelle + „Ø RRR", wobei R = grün/(1−grün) für 0 < grün < 1, sonst „0". `pageId` = `'daily'`: Prozent(grün).

### 3.3 `useLineBarChart(id)` — kumulierter Ertrag und Ertrag je Zeitraum

Eingaben: `summenJeTag` (tiefe Kopie), `selectedTimeFrame`, `betragArt`. Das Element wird ohne Existenzprüfung benutzt: fehlt es, scheitert `setOption` und das Promise wird abgelehnt (gilt ebenso für `useBarChart` und `useBarChartNegative`; Aufruf erfolgt praktisch nur über `zeichneDiagramme` für vorhandene Elemente).

Schlüssel K = Tages-Unixzeiten, aufsteigend (1.3). P(k) = `summenJeTag[k][`*Fall*`Proceeds]` (ohne Umwandlung).

Bündelung nach `selectedTimeFrame`:
- `'daily'`: je Schlüssel ein Eintrag; Kategorie `useChartFormat(k)`; Wert P(k).
- `'weekly'` / `'monthly'`: Merkmal m(k) = ISO-Kalenderwoche (`'weekly'`) bzw. Monat 0–11 (`'monthly'`) von k, berechnet in der **Prozesszeitzone** (nicht `timeZoneTrade`). Verglichen wird nur dieses Merkmal, **nicht das Jahr** (zwei benachbarte Datenschlüssel in KW 5/2025 und KW 5/2026 bzw. Januar 2025 und Januar 2026 ohne Daten dazwischen landen im selben Eintrag). Ablauf über die Schlüssel in Reihenfolge:
  - erster Schlüssel: aktuelles Merkmal = m(k), Summe += P(k), Kategorie `useChartFormat(k)` (der erste Eintrag ist mit dem tatsächlichen ersten Datentag beschriftet, nicht mit dem Wochen-/Monatsanfang);
  - sonst, wenn m(k) = aktuelles Merkmal: Summe += P(k);
  - sonst (Wechsel): Eintrag mit Wert = Summe abschliessen; Summe := P(k); aktuelles Merkmal := m(k); Kategorie `useChartFormat(Beginn der ISO-Woche bzw. des Monats von k, in Sekunden)` (Beginn in Prozesszeitzone, Formatierung in `timeZoneTrade`);
  - nach dem letzten Schlüssel: Eintrag mit Wert = Summe abschliessen.
- Jeder andere Wert (auch `null`): keine Einträge, beide Reihen und Kategorien leer.

Reihen je abgeschlossenem Eintrag mit Wert v:
- Linie: kumulierte Summe (erster Wert v, dann Vorgänger + v).
- Balken: ein Objekt. Wenn die Anzahl **Tagesschlüssel** (nicht Einträge!) ≤ 20: `{value: v, label: {show: true, position: v ≥ 0 ? 'top' : 'bottom', formatter: Funktion}, itemStyle: {color: v ≥ 0 ? Grün : Rot}, emphasis: {itemStyle: {color: v ≥ 0 ? Grün-Hover : Rot-Hover}}}`; sonst dasselbe ohne `label`.

Option-Daten: series `[{type:'line', data: Linie}, {type:'bar', data: Balken}]` (ohne Namen); xAxis ein Objekt mit `data` = Kategorien; yAxis ein Objekt ohne `data`; keine Legende. Tooltip: Kategorie, „Proceeds: <Balken>", „Cumulated: <Linie>" (USD ganzzahlig).

### 3.4 `useBarChart(id)` — Kennzahl (`barChart1`) bzw. Gewinnquote (`barChart2`) je Zeitraum

Eingaben wie 3.3 plus `selectedRatio`. Schlüssel und Bündelung (daily/weekly/monthly, Merkmal ohne Jahr, Kategorien) **identisch zu 3.3**. Je Schlüssel k werden aus der Tagessumme e = `summenJeTag[k]` gelesen: Proceeds = e.*Fall*`Proceeds`, Trades = e.`trades`, Menge = e.`buyQuantity`, Wins = e.*Fall*`Wins`, Loss = e.*Fall*`Loss`, WinsCount = e.*Fall*`WinsCount`.

Kennzahlen je Eintrag:
- **daily**: bei `'profitFactor'`: w = Zahl(Wins) oder 0, l = |Zahl(Loss) oder 0|, PF = l > 0 ? w/l : (w > 0 ? `null` : 0). Bei `'appt'`/`'apps'`: APPT = Trades ? Proceeds/Trades : 0, APPS = Menge ? Proceeds/Menge : 0. Immer: Quote = e.trades ? WinsCount/e.trades : 0.
- **weekly/monthly**: Summen über den Eintrag — bei `'appt'`/`'apps'` ΣProceeds, ΣTrades, ΣMenge; bei `'profitFactor'` Σw += Wins und Σl += −Loss (hier **ohne** Zahlumwandlung und ohne Betrag); immer ΣWinsCount, ΣTrades(Quote). Beim Abschliessen: PF = Σl > 0 ? Σw/Σl : (Σw > 0 ? `null` : 0); APPT = ΣTrades ? ΣProceeds/ΣTrades : 0; APPS = ΣMenge ? ΣProceeds/ΣMenge : 0; Quote = ΣTrades(Quote) ? ΣWinsCount/ΣTrades(Quote) : 0. Beim Wechsel werden nur die Summen der **gewählten** Kennzahl und die Quoten-Summen zurückgesetzt und mit k neu begonnen.
- Gewählter Wert r = APPT (`'appt'`), APPS (`'apps'`), PF (`'profitFactor'`); sonst **`undefined`** (r bleibt aus der Vorrunde unverändert, anfangs undefiniert).

Datenpunkte (nur für `barChart1` bzw. `barChart2`, je abgeschlossenem Eintrag):
- `barChart1`: „gut" = bei `'profitFactor'` (r = 0 oder r ≥ 1), sonst r ≥ 0. Objekt bei ≤ 20 Tagesschlüsseln: `{value: r, label:{show:true, position: r ≥ 0 ? 'top' : 'bottom', formatter}, itemStyle:{color: gut ? Grün : Rot}, emphasis:{itemStyle:{color: Hover}}}`; sonst ohne `label`.
- `barChart2`: Wert = Quote; „gut" = Quote = 0 oder Quote > 0,5; Label-Position immer `'top'`.
- **Jede andere ID** (z. B. `barChartNegative12`, über die Präfix-Überlappung): keine Datenpunkte, aber die Kategorien werden trotzdem gebildet und gesetzt.

Option-Daten: series `[{type:'bar', data: Datenpunkte}]`; xAxis ein Objekt mit `data` = Kategorien; yAxis ein Objekt ohne `data`; keine Legende. Beschriftungen/Tooltip: Kategorie und Wert — `barChart2` als Prozent (1 Stelle); `barChart1` bei APPT als USD mit 2, bei APPS mit 4 Stellen, bei PF als Zahl mit 2 Stellen.

### 3.5 `useBarChartNegative(id)` — Kennzahl je Gruppe (Altinventar)

**Gruppenwahl** nach ID:

| ID | Teilgruppe | Besonderheit |
|---|---|---|
| `barChartNegative1` | `groups.timeframe` | |
| `barChartNegative2` | `groups.duration` | |
| `barChartNegative3` | `groups.day` | |
| `barChartNegative4` | `groups.trades` | Elemente sind Tagessummen; n = Σ `trades` |
| `barChartNegative7` | `groups.executions` | |
| `barChartNegative12` | `groups.shareFloat` | |
| `barChartNegative13` | `groups.entryPrice` | |
| `barChartNegative14` | `groups.mktCap` | |
| `barChartNegative16` | `groups.symbols` | sortiert, ohne leere Werte |
| `barChartNegative17` | `groups.position` | sortiert, ohne leere Werte |
| `barChartNegative18` | `groups.tags`, eingeschränkt auf die Tag-IDs der **ersten** Gruppe in `verfuegbareTags` (wenn es eine gibt und `groups.tags` existiert; sonst ganz `groups.tags`) — Einfügereihenfolge von `groups.tags` bleibt | Tag-Namen, sortiert |
| beliebige ID, die die `id` eines Eintrags von `negativeTagGruppen` als Teilzeichenkette enthält (erster Treffer) | `groups[<diese id>]` — hat Vorrang vor der Tabelle | Tag-Namen, sortiert |

Ist die gewählte Teilgruppe `undefined` (unbekannte ID ohne Tag-Gruppe), scheitert das Auflisten der Schlüssel: das Promise wird **abgelehnt** (TypeError), nichts gezeichnet. Aufrufer fangen das nicht ab. (Im Dashboard tritt der Fall nicht auf, weil nur IDs aus der Tabelle existieren.)

**Je Gruppenschlüssel g** (Schlüsselreihenfolge 1.3) über alle Elemente: Σwins, Σloss, Σproceeds, n (Σ `tradesCount`, bei `barChartNegative4` Σ `trades`), q = Σ `buyQuantity`. Dann:
- APPT = (Σproceeds = 0 und n = 0) ? `null` : Σproceeds / n  (n = 0 bei Σproceeds ≠ 0 ergibt ±Infinity);
- APPS = (Σproceeds = 0 und q = 0) ? `null` : Σproceeds / q;
- PF = Σwins > 0 ? Σwins / (−Σloss) : 0  (Σloss = 0 ergibt −Infinity, weil −0);
- r = APPT / APPS / PF je `selectedRatio`, sonst **`undefined`**.
- Werte werden **vorne eingefügt**: Kategorienliste beginnt mit dem letzten Schlüssel (y = Schlüssel in umgekehrter Reihenfolge), Werteliste ebenso. Bei Tag-Diagrammen wird zusätzlich je Schlüssel der `tagName` des **letzten** Elements der Gruppe gemerkt.

**Nachbearbeitung:**
- `barChartNegative16`/`17`: Paare (Wert, Schlüssel) in der umgekehrten Reihenfolge bilden, Paare mit Wert `null` **oder** `undefined` verwerfen, nach Wert aufsteigend sortieren (Vergleich: a vor b wenn a < b; gleich wenn a lose gleich b; sonst b vor a; stabile Sortierung), dann Werte und Kategorien neu aus der sortierten Liste. Kategorien sind die rohen Schlüssel (`long`/`short` klein; das Grossschreiben macht nur die Achsenbeschriftung).
- `barChartNegative18` und Tag-Gruppen: Paare wie oben, **ohne** Verwerfen, gleich sortiert; Werte aus der sortierten Liste; Kategorie i = `tagName` zum Schlüssel des i-ten Paars (fehlt er, bleibt der alte Eintrag stehen).
- Alle anderen: keine Sortierung — Reihenfolge = umgekehrte Schlüsselreihenfolge.

**Zeichnen nur, wenn die Werteliste mindestens einen Eintrag hat** (ein Eintrag `undefined` zählt!). Sonst bleibt die bisherige Option am Element unverändert (im Dashboard: die von `useBarChart` aus 3.4).

Option-Daten: series `[{type:'bar', data: Werte}]` — Werte sind **nackte Zahlen** (bzw. `null`/`undefined`/±Infinity), keine Objekte; xAxis ein Objekt (Wertachse) ohne `data`; yAxis ein Objekt mit `data` = Kategorien; keine Legende.

Achsenbeschriftungen (nur Inhalt; Funktionen, für den Golden Master unsichtbar): `…4` „(k−5)-k" für k ≤ 5, „(k−4)-k" für 5 < k ≤ 30, „+30" darüber; `…2` Dauerklassen „00:00-00:59", „01:00-01:59", „02:00-04:59", „05:00-09:59", „10:00-19:59", „20:00-39:59", „40:00-59:59", „+60:00" nach Minuten-Untergrenze; `…3` englischer Wochentagsname (0 = Sunday); `…13` „0-4.99$" unter 5, „k-(k+4,99)$" unter 30, „+30$" ab 30; `…12` Float in Mio. mit Spannen 4,9 bzw. 9,9 und „+50M"; `…14` Marktkapitalisierungs-Klassen Nano/Micro/Small/Mid/Big-cap; `…17` erster Buchstabe gross; sonst roh. Wertachse: PF ganzzahlig, sonst USD ganzzahlig. Balkenbeschriftung: PF mit 2 Stellen, APPT USD 2 Stellen, APPS USD 4 Stellen. Tooltip: Wert in USD (2 Stellen), bei `…16` mit Symbolname davor.

### 3.6 Gruppen-Diagramme des neuen Inventars

Gemeinsam für `usePositionChart`, `useStrategyChart`, `useWeekdayChart`, `useEntryTimeChart`, `useDurationChart`, `useSymbolChart` (je Parameter = Element-ID; im Dashboard `positionChart1`, `strategyChart1`, `weekdayChart1`, `entryTimeChart1`, `durationChart1`, `symbolChart1`):

- Element fehlt → nichts. Instanz wird **vor** der Datenprüfung geholt.
- Teilgruppe fehlt oder hat keine Schlüssel → nichts zeichnen (Option bleibt unberührt).
- Je Schlüssel: Σwins, Σloss, Σproceeds, n = Σ `tradesCount`.
  - `'appt'`: r = (Σproceeds = 0 und n = 0) ? `null` : Σproceeds/n.
  - `'profitFactor'`: r = Σloss = 0 (strikt) ? (Σwins > 0 ? +Infinity : `null`) : Σwins/(−Σloss).
  - jeder andere Wert (`'apps'`, `null`): r = `null`.
  - Ist r ≠ `null`: Eintrag {Name, Wert = r auf 4 Nachkommastellen gerundet (Festkomma, zurück in Zahl; Infinity bleibt Infinity)}.
- Sortierung und Namen:

| Funktion | Teilgruppe | Name | Sortierung |
|---|---|---|---|
| `usePositionChart` | `groups.position` | Schlüssel mit grossem Anfangsbuchstaben („Long") | nach Wert aufsteigend (Differenz; Infinity−Infinity wird als gleich behandelt) |
| `useStrategyChart` | `groups.tags`, eingeschränkt auf erste Gruppe aus `verfuegbareTags` wie bei `barChartNegative18` | `tagName` des letzten Elements mit gesetztem `tagName`, sonst Schlüssel | nach Wert aufsteigend |
| `useWeekdayChart` | `groups.day` | englischer Wochentagsname (0 = Sunday … 6 = Saturday), sonst Schlüssel | Montag zuerst: Rang (Tag + 6) mod 7 |
| `useEntryTimeChart` | `groups.timeframe` | Schlüssel; **Kategorie = Schlüssel + „:00"** (aus „09:15" wird „09:15:00") | nach Zahl(Schlüssel) — bei „HH:mm"-Schlüsseln NaN, also faktisch keine Umordnung: Einfügereihenfolge der Gruppe |
| `useDurationChart` | `groups.duration` | Dauerklasse wie bei 3.5 (`…2`) | nach Zahl(Schlüssel) aufsteigend |
| `useSymbolChart` | `groups.symbols` | Symbol (Schlüssel) | nach Wert aufsteigend |

- Option-Daten: series `[{type:'bar', data: [{value: r, itemStyle: {color: r ≥ 0 ? Grün : Rot}} …]}]` (Objekte mit `value` und `itemStyle`, ohne `emphasis`/`label`); xAxis ein Objekt (Wertachse) ohne `data`; yAxis ein Objekt mit `data` = Namen; keine Legende. Kein Eintrag → Reihe und Kategorien leer, die Option **wird trotzdem gesetzt**.
- Beschriftungen: APPT als USD mit 2 Stellen, PF als Zahl mit 2 Stellen; Tooltip „<Name>" (EntryTime: „<Name>:00") + „APPT" bzw. `options.profitFactor` + Wert.

### 3.7 `useHeatmapChart(id)` — Wochentag × Stunde

- Element fehlt oder `clientWidth` = 0 → nichts. `gefilterteTradesFlach` leer → nichts.
- Je Trade: Zeitpunkt = `entryTime` in `timeZoneTrade`; Tag d = (Wochentag + 6) mod 7 (0 = Montag … 6 = Sonntag); Stunde h = 0–23. Zelle (d, h): Summe += `t[`*Fall*`Proceeds]` oder 0 bei falsy; Anzahl += 1.
- Belegte Zellen: Mittel μ = Summe/Anzahl. Skala S = max(der Wert an Position ⌊0,8·m⌋ der aufsteigend sortierten |μ| (ungerundet) aller m belegten Zellen, ersatzweise 1 wenn dieser 0 ist; 0,5). Keine belegte Zelle → nichts.
- Datenpunkte in der Reihenfolge Tag 0…6 aussen, Stunde 0…23 innen:
  - belegt: Objekt `{value: [h, d, μ₂, Anzahl], itemStyle: {color}}` mit μ₂ = μ auf 2 Stellen gerundet. Farbe aus μ₂: Intensität i = min(|μ₂|/S, 1); t = 0,25 + 0,75·i; Kanal = rund(22 + (Ziel − 22)·t) je Kanal; Ziel (72, 199, 142) für μ₂ ≥ 0, sonst (235, 87, 87); Ausgabe als Zeichenkette `rgb(R,G,B)` ohne Leerzeichen. (Rundung: halbe Werte aufwärts.)
  - leer: nacktes Array `[h, d, 0, 0]` in einer **zweiten** Reihe.
- Option-Daten: series `[{type:'heatmap', data: belegte}, {type:'heatmap', data: leere}]`; xAxis `data` = „0:00", „1:00", … „23:00" (ohne führende Null); yAxis `data` = „Mo", „Di", „Mi", „Do", „Fr", „Sa", „So"; keine Legende. (Eine unsichtbare `visualMap` existiert; nicht datenrelevant.) Tooltip: „<Tag> <h>:00", „Ø P&L: <USD>", „Trades: <n>" bzw. „Keine Trades".

### 3.8 `useFeesChart(id)` — Gebühren je Symbol

- Element fehlt → nichts; keine Trades in `gefilterteTradesFlach` → nichts.
- Je Trade, Symbol s = `symbol` oder „Unbekannt": tf = |`tradingFee` oder 0|, ff = `fundingFee` oder 0 (vorzeichenbehaftet), c = `commission` oder 0.
  - Wenn tf > 0 oder ff ≠ 0: Trading(s) += tf; bezahlt(s) += max(−ff, 0); erhalten(s) += max(ff, 0); ff ≠ 0 setzt „hat Funding"; erhalten > 0 setzt „hat Erhalt". (Aufteilung über `splitFunding` aus `src/utils/funding.js`.)
  - sonst, wenn |c| > 0: Trading(s) += |c|.
- Je Symbol (Einfügereihenfolge): trading, bezahlt, erhalten je auf 2 Stellen gerundet; total = rund₂(trading + bezahlt); netto = rund₂(trading + bezahlt − erhalten) (aus den ungerundeten Summen). Stabil aufsteigend nach netto sortieren.
- Reihen (Reihenfolge fest):
  1. immer: `{name: t('dashboard.tradingFees'), type:'bar', data: [trading …]}` (Stapel „fees");
  2. wenn „hat Funding": `{name: t('dashboard.fundingPaid'), type:'bar', data: [bezahlt …]}` (Stapel „fees");
  3. wenn „hat Erhalt": `{name: t('dashboard.fundingReceived'), type:'bar', data: [erhalten > 0 ? −erhalten : 0 …]}` (eigener Stapel).
- Datenpunkte sind **nackte Zahlen**.
- xAxis ein Objekt (Wertachse) ohne `data`; yAxis `data` = Symbole in sortierter Reihenfolge.
- Legende **nur wenn „hat Funding"**: `data` = Namen der vorhandenen Reihen (Trading, dann Funding bezahlt, ggf. Funding erhalten); sonst keine Legende (Option-Feld `undefined`).
- Beschriftung am Balkenende (nur Inhalt): ohne Funding die Trading-Summe; sonst total am Bezahlt-Balken (wenn kein Erhalt) bzw. netto am Erhalt-Balken. Tooltip: jede Reihe ≠ 0 mit Wert, zuletzt „Netto: <netto>".

### 3.9 `usePerfChart(id)` — Equity, Höchststand, Drawdown, PnL je Trade

- Resize-Listener sicherstellen. Element fehlt → nichts. Keine Trades → nichts (Instanz wird vorher geholt).
- Trades = Kopie von `gefilterteTradesFlach`, sortiert nach `td` aufsteigend, bei Gleichstand nach `entryTime` (fehlend = 0); stabil.
- Laufend je Trade i (1-basiert): pnl = `t[`*Fall*`Proceeds]`, ersatzweise `t.grossProceeds`, ersatzweise 0 (nur bei `null`/`undefined`); kum += pnl; Höchststand H (Start 0) = max(H, kum); dd = kum − H.
  - Kategorie: „#" + i, gefolgt von „ " + Kurzsymbol, wenn nicht leer. Kurzsymbol = `symbol` mit erstem Vorkommen von „/USDT" entfernt, danach erstem Vorkommen von „USDT" entfernt („1000PEPEUSDT" → „1000PEPE").
  - PnL-Balken: Objekt `{value: rund₄(sign(pnl)·log₁₀(|pnl|+1)), itemStyle:{color: pnl ≥ 0 ? Grün : Rot}, emphasis:{itemStyle:{color: pnl ≥ 0 ? Grün-Hover : Rot-Hover}}}`.
  - Equity rund₂(kum), Höchststand rund₂(H), Drawdown rund₂(dd) — nackte Zahlen.
- Reihen (Reihenfolge fest): `{name: t('charts.pnl'), type:'bar'}` (zweite y-Achse), `{name: t('charts.equity'), type:'line'}`, `{name: t('charts.highWaterMark'), type:'line'}`, `{name: t('charts.drawdown'), type:'line'}` (alle drei an der ersten y-Achse).
- xAxis ein Objekt mit `data` = Kategorien; yAxis **Liste aus zwei** Wertachsen (Namen `charts.equityDollar`, `charts.tradePnlDollar`) ohne `data`; Legende `data` = [pnl, equity, highWaterMark, drawdown] (übersetzt).
- Gestaltung (frei): Zoom innen + Schieberegler über 0–100 %; Beschriftungen schräg ab > 30 Trades, nur jede ⌊n/25⌋-te ab > 50. Tooltip zeigt beim PnL den **echten** Betrag rund₂(pnl) (nicht den Log-Wert); die zweite Achse beschriftet mit der Umkehrfunktion sign(v)·(10^|v| − 1).

### 3.10 `useCandlestickChart(zeiten, preise, volumen, trade, init, elementId = 'candlestickChart', zonen = null, mitSlider = false)`

Parameter:
- `zeiten`: Kerzen-Öffnungszeiten in **ms**, aufsteigend.
- `preise`: je Kerze ein Viererarray; wird **unverändert** als Kerzendaten übergeben. Beide Aufrufer liefern `[Schluss, Eröffnung, Tief, Hoch]` (Daily.vue aus Binance-/Polygon-Daten, `botChart.js` `kerzenAufteilen`). Der Neubau muss genau diese Reihenfolge entgegennehmen (wie er sie intern ECharts übergibt, ist frei — siehe offene Punkte).
- `volumen`: wird nicht verwendet.
- `trade`: `strategy` (`'long'` sonst short), `entryTime`, `exitTime` (s), `entryPrice`, `exitPrice`, optional `_tradingMeta` = `{sl?, tp?, breakeven?, fills?: [{time (ms), price, qty, reduceOnly}], tpslHistory?: [{time (ms), type 'SL'|'TP', action 'set'|'moved'|'triggered'|'removed', newVal}]}` (Zeichenketten oder Zahlen; `mfe`/`mae` aus `botChart.js` werden ignoriert).
- `init`: `true` → Instanz am Element `elementId` holen und **modulweit** als „aktueller Kerzenchart" merken; `false` → die zuletzt gemerkte Instanz wiederverwenden (Daily.vue setzt beim Öffnen des Trade-Modals `true`, danach `false`). Fehlt bei `true` das Element → Promise **abgelehnt** mit Fehler „Candlestick chart container not found".
- `zonen`: Liste `{von, bis, farbe?, rand?, name?}` (Preisbänder).
- `mitSlider`: zusätzlicher sichtbarer Zoom-Regler und angepasster Rand.
- Rückgabe: Promise, erfüllt mit der **Instanz** (`botChart.js` gibt sie an `AgentSetups.vue` weiter, das später `dispose()` aufruft).

Berechnung:
- „Ein Tag" ⇔ weniger als 2 Kerzen oder erste und letzte Kerze am selben Kalendertag in `timeZoneTrade`. Kategorien: „HH:mm" (ein Tag) bzw. „DD.MM HH:mm" (mehrere Tage), jeweils `timeZoneTrade`.
- Index eines Zeitpunkts T (s): letzte Kerze mit Öffnungszeit/1000 ≤ T, Suche bricht bei der ersten späteren ab; keine → −1. Schritt = (zeiten[1] − zeiten[0])/1000, bei < 2 Kerzen 60.
- Einstieg „im Bild" ⇔ Index ≥ 0. Ausstieg „im Bild" ⇔ Index ≥ 0 und exitTime ≤ letzte Öffnungszeit/1000 + Schritt.
- Marker (Markpunkte an der Kerzenreihe):
  - Einstieg im Bild: Dreieck „Entry" an (Einstiegsindex, entryPrice), Spitze nach oben bei Long (unter der Kerze), nach unten bei Short; Farbe Long grün / Short rot.
  - sonst (und Kategorien nicht leer): Pfeil `t('charts.entryPrevDay')` an (0, entryPrice).
  - Ausstieg im Bild: Dreieck „Exit" an (Ausstiegsindex, exitPrice), Richtung umgekehrt; Farbe Long rot / Short grün.
  - sonst: Pfeil `t('charts.exitNextDay')` an (letzter Index, exitPrice).
- Anfangsausschnitt (innerer Zoom, Start/Ende als **Kategorie-Text**, sonst leer):
  - Startzeit / Endzeit je `tagesChartZoom`: 1 → Minutenbeginn von entryTime / Minutenende von exitTime; 2 → Minutenbeginn von (Tagesbeginn(entry) − entryTime)/2 bzw. Minutenende von (Tagesende(exit) − exitTime)/2 (ergibt Zeitpunkte nahe 1970, Altfehler); 3 → Tagesbeginn des Einstiegstags / Tagesende des Ausstiegstags. Alles in `timeZoneTrade`.
  - Start = „HH:mm" der Startzeit, wenn Einstieg im Bild und „ein Tag"; Ende = „HH:mm" der Endzeit, wenn Ausstieg im Bild und „ein Tag"; ist der Ausstieg im Bild, der Einstieg aber nicht: Start = erste Kategorie.
- Preislinien (Marklinien): immer „Entry <entryPrice>" bei entryPrice und „Exit <exitPrice>" bei exitPrice; mit Meta zusätzlich, wenn gesetzt: „SL <sl>" bei Zahl(sl), „TP <tp>" bei Zahl(tp), „BE <breakeven auf 2 Stellen>" bei Zahl(breakeven).
- Teilausführungen (nur bei mehr als einem Fill): je Fill Index zu time/1000; < 0 → überspringen. Kein `reduceOnly` und ein früherer Fill ohne `reduceOnly` existiert → Raute „Compound (<qty>)" (grün, Versatz auf der Einstiegsseite); `reduceOnly` → Dreieck „Teil-TP (<qty>)" in Ausstiegsfarbe; erster Einstiegs-Fill → kein Marker. Position (Kategorie-**Text** des Index, fill.price).
- SL/TP-Verlauf: Grenze = (spätester Fill-Zeitpunkt + 60 000 ms), wenn es Fills gibt und dieser > 0 ist, sonst unbegrenzt; nur Einträge mit time ≤ Grenze. Je Eintrag Index (< 0 → überspringen), Kategorie-Text; `set`/`moved` → Stufe (Text, newVal); `triggered`/`removed` → Stufe (Text, `null`). Getrennt für SL und TP. Stufenreihe: über alle Kategorien in Reihenfolge; trifft eine Kategorie eine Stufe (bei mehreren Stufen auf demselben Text gilt die letzte), wird deren Wert der laufende Wert; vor der ersten Stufe `null`, danach der laufende Wert. Reihen `{name:'SL-Verlauf', type:'line', step:'end'}` bzw. `'TP-Verlauf'`, nur wenn es Stufen gibt, angehängt nach der Kerzenreihe.
- Zonen: Markbereich je Zone von min(von, bis) bis max(von, bis), über die volle Breite; Beschriftung `name`, wenn gesetzt.
- Tooltip: Kategorie und O/H/L/C (2 Stellen), Farbe nach Richtung.

### 3.11 `useSetupChart(elementId, kerzen, setup)`

- Synchron. Element fehlt oder `kerzen` leer → Rückgabe `null`. Sonst vorhandene Instanz entsorgen, neue anlegen, Option setzen, **Instanz zurückgeben**. Aufrufer `AgentSetups.vue` (`'setupChart'`) wertet `null` als Fehler und ruft später `dispose()`.
- `kerzen`: `[{t (ms), o, h, l, c}]` aufsteigend. Kategorien „DD.MM HH:mm" von ⌊t/1000⌋ in `timeZoneTrade`; Kerzendaten `[o, c, l, h]`.
- `setup`: `{direction, obHigh, obLow, obCandleTime (ms), sweepLevel, entry, stopLoss, takeProfit}`.
- Preislinien (in dieser Reihenfolge, nur wenn Wert truthy): entry `t('strategies.chartEntry')`, stopLoss `chartStop`, takeProfit `chartTarget`, sweepLevel `chartSweep`.
- Order-Block-Bereich, nur wenn obHigh > obLow: von Kategorie der Kerze mit t = obCandleTime (exakter Treffer, sonst erste Kategorie) bis zur letzten Kategorie, Preis obLow bis obHigh, Beschriftung `chartOrderBlock`; Farbe grün bei `direction` = `'long'`, sonst rot.
- Zoom innen + Schieberegler. Keine Legende.

### 3.12 `useAgentTimelineChart(elementId, kerzen, setups = [], trades = [])`

- Synchron, Rückgabe Instanz oder `null` (wie 3.11). Aufrufer `AgentEditor.vue` (`'editorChart'`), `AgentPerformance.vue` (`'agentZeitstrahl'`); beide entsorgen die alte Instanz selbst vorher.
- Kategorien/Kerzendaten wie 3.11.
- Index eines Zeitpunkts T (ms): keine endliche Zahl oder ausserhalb [erste t, letzte t] → −1; sonst letzte Kerze mit t ≤ T (binäre Suche).
- Zonen je Setup (`strategy_setups`-Zeile) mit obHigh > obLow: Start = Kategorie von obCandleTime, ersatzweise von sweepCandleTime; keiner → Setup auslassen. Status `triggered`/`open`/`closed` = gehandelt (deutlich), `waiting_retest`/`armed` = wartend (mittel), alles andere = verworfen (blass, gestrichelter Rand). Ende = Kategorie von `triggeredAt`, sonst letzte Kategorie. Bereich Preis obLow…obHigh; Beschriftung „▲" (long) bzw. „▼" plus `rr` mit 1 Stelle (leer ohne `rr`).
- Je Trade (`strategy_trades`-Zeile): Einstieg im Bereich → Punkt `{value: [Index, Zahl(entryPrice)], name: t('strategies.chartEntry') + " ▲/▼"}` (Dreieck bzw. Nadel nach Richtung); Ausstieg im Bereich → Punkt `{value: [Index, Zahl(exitPrice)], name: (exitReason oder leer) + " " + (+ bei R ≥ 0) + R mit 2 Stellen + "R"}` mit R = Zahl(rMultiple) oder 0; beide → Verbindungslinie zwischen den Punkten (Markline an der Kerzenreihe).
- Reihen: Kerzen (mit Zonen und Verbindungen), Punktreihe `name = t('strategies.chartEntry')`, Punktreihe `name = t('strategies.chartExit')`. Tooltip der Punkte: Name und Preis.

### 3.13 Auswertungsseite (`src/views/Auswertung.vue`)

Alle fünf: Element fehlt → nichts; Instanz wiederverwenden oder anlegen; Rückgabe erfülltes Promise ohne Wert.

| Funktion | Parameter | Daten |
|---|---|---|
| `useGaugeChart(id, wert, titel, farbstopps?)` | wert 0–100, titel Text, farbstopps Liste `[Anteil 0–1, Farbe]` (Vorgabe: bis 0,3 rot, bis 0,7 gelb, bis 1 grün) | Halbkreis 0–100; eine Reihe `type:'gauge'`, data `[{value: wert auf 1 Stelle gerundet, name: titel}]`; Anzeige ganzzahlig mit „%"; Skala beschriftet nur bei 0/50/100 |
| `useHorizontalBarChart(id, kategorien, werte, farben?)` | | yAxis Kategorien; eine Reihe `type:'bar'`, data `[{value, itemStyle:{color: farben[i] oder Grün}}]`; Beschriftung: nicht-ganze Zahlen mit 1 Stelle |
| `useSplitBarChart(id, kategorien, gewinne, verluste)` | gewinne ≥ 0, verluste ≤ 0 | Option **ersetzt** (kein Mischen); x symmetrisch ±(max(|alle Werte|, 0) + 1), Beschriftung als Betrag; Reihen `{name: t('charts.wins'), type:'bar', data:[{value, itemStyle}]}` und `{name: t('charts.losses'), …}`, gemeinsamer Stapel; Beschriftung „+n" bzw. „−n", 0 ohne; Tooltip Kategorie, Wins, Losses (Betrag) |
| `useStressLineChart(id, daten, werte, optionen = {})` | optionen `{max = 5, color, name = 'Stresslevel'}` | Kategorieachse daten (schräg ab > 15); y 0…max, Schritt 1 (max ≤ 5) sonst 2; eine Reihe `{name, type:'line'}` geglättet, Fläche mit Verlauf aus der Linienfarbe |
| `useRadarChart(id, indikatoren, werte)` | indikatoren `[{name, max}]` | Radar (Kreisform) mit diesen Indikatoren; eine Reihe `type:'radar'`, data `[{value: werte, name: t('charts.completeness')}]` |

Aufrufe und IDs: `gaugeChart1` (Long/Short-Quote, Stopps 0,5 rot / 1 grün), `gaugeChart2` (Zufriedenheit), `gaugeChart3` (Vollständigkeit), `hbarTagGroup<Index>` (SplitBar je Tag-Gruppe, auch über einen `watch`), `hbarChart2` (Zeitrahmen), `stressLineChart` (max 10), `hbarChart3`, `emotionLineChart` (max 10, grün, Name `auswertung.emotionProgress`), `hbarChart4`, `radarChart1`. Die Datenaufbereitung liegt in `Auswertung.vue`.

---

## 4. Aufrufer

| Datei | Benutzte Exporte | Art |
|---|---|---|
| `src/utils/mountOrchestration.js` | `zeichneDiagramme('init')`, `zeichneDoppellinie`, `zeichneTorte`, `disposeCharts` | dynamischer Import, Modul zwischengespeichert |
| `src/utils/utils.js` (`useInitTab`) | `zeichneDiagramme('init')` | dynamisch |
| `src/components/SidebarFilters.vue` (`saveFilter`) | `zeichneDiagramme('clear')` | dynamisch |
| `src/views/Daily.vue` | `useCandlestickChart` (Element `candlestickChart`, `init` erst true dann false) | statisch |
| `src/utils/botChart.js` (`useBotTradeChart`, von `AgentSetups.vue`) | `useCandlestickChart(…, true, 'setupChart', zonen, true)`; Rückgabe-Instanz wird weitergereicht | statisch |
| `src/views/AgentSetups.vue` | `useSetupChart('setupChart', …)` (Instanz oder `null`) | statisch |
| `src/views/AgentEditor.vue` | `useAgentTimelineChart('editorChart', …)` | statisch |
| `src/views/AgentPerformance.vue` | `useAgentTimelineChart('agentZeitstrahl', …)`; `cssColor87`, `cssColor60`, `cssColor38`, `blackbg5`, `greenColor`, `redColor` für eigene Diagramme | statisch |
| `src/views/Auswertung.vue` | `useGaugeChart`, `useHorizontalBarChart`, `useSplitBarChart`, `useStressLineChart`, `useRadarChart` | statisch (Pfad ohne `.js`) |
| `src/views/Dashboard.vue` | keine direkten Aufrufe; liefert die Elemente (2.1) | — |
| `src/utils/__selftest-journal.mjs` | `zeichneDiagramme('init')`, `useBarChartNegative(id)` direkt, `zeichneDoppellinie`, `zeichneTorte` | dynamischer Import mit Attrappen |

Nicht exportiert/aufgerufen von aussen werden `useDoubleLineChart`, `usePieChart`, `useLineBarChart`, `useBarChart`, die Gruppen-Diagramme, `useHeatmapChart`, `useFeesChart`, `usePerfChart` — sie sind trotzdem zu exportieren (öffentliche Namen; Verteiler und ggf. künftige Aufrufer).

---

## 5. Golden-Master-Abgleich

### 5.1 Was der Test tut

Pro Dashboard-Szenario (`alles`, `bitunixJanuar`, `bitgetMaerzUSA`, `nurBots`, `nurFutures`, `nurAgent`, `nurShortsKonto`, `tagFilter`, `ohneTagsNurUngetaggt` — Reihenfolge ist Teil des Golden Master) und je Fall (`net`, dann `gross`):
1. Ablage leeren; `zeichneDiagramme('init')`;
2. danach direkt `useBarChartNegative` für `barChartNegative1`, `2`, `3`, `4`, `7`, `13`, `16`, `17`, `18`;
3. je Element-ID wird `{series: [{name, type, data}], xAxis: [data…], yAxis: [data…], legend: [data…]}` gespeichert, nachdem es per JSON von Funktionen befreit wurde (Funktionen fallen weg; `undefined`, `NaN`, ±Infinity werden in Listen zu `null`, in Objekten fällt der Schlüssel weg).

Die Attrappe: `document.getElementById` liefert für **jede** ID ein sichtbares Element (600×300); `querySelectorAll('[id^="P"]')` liefert die Elemente aus der festen Liste `pieChart1–3, perfChart1, feesChart1, symbolChart1, weekdayChart1, entryTimeChart1, durationChart1, positionChart1, strategyChart1, lineBarChart1, barChart1, barChart2, barChartNegative12, barChartNegative14, heatmapChart1` mit passendem Präfix. `localStorage` ist leer ⇒ **`selectedTimeFrame` = `null`, `selectedRatio` = `null`**. `betragArt` wird je Lauf gesetzt, `pageId` = `'dashboard'`, `timeZoneTrade` = `Europe/Zurich` (Szenario `bitgetMaerzUSA`: `America/New_York`), Prozesszone `Europe/Zurich`.

Tagesansicht: `pageId` = `'daily'`, Februar 2026, `betragArt` = `'net'`, `zeichneDoppellinie()` und `zeichneTorte()` (ohne `await`).

Vergleich: ganze Zahlen exakt, Gleitkommazahlen auf 1e-9 relativ, Zeichenketten exakt, Schlüssel müssen in beiden Richtungen vorhanden sein.

### 5.2 Folgen von `selectedRatio = null` und `selectedTimeFrame = null`

- `lineBarChart1`, `barChart1`, `barChart2`: keine Bündelung ⇒ leere Reihen, leere Kategorien.
- `barChartNegative12`, `barChartNegative14`: `useBarChart` setzt (Präfix-Überlappung) eine Option mit leerer Balkenreihe und leerer Kategorieachse; `useBarChartNegative` findet in `groups.shareFloat`/`groups.mktCap` keine Schlüssel (leere Objekte) und zeichnet nicht ⇒ es bleibt die Form aus 3.4: `xAxis: [[]]`, `yAxis: [null]`.
- `barChartNegative1/2/3/4/7/13/18`: r ist je Gruppe **`undefined`** (keine Kennzahl gewählt) ⇒ die Werteliste besteht aus `undefined` ⇒ im Golden **`null`**, eine je Gruppenschlüssel; gezeichnet wird trotzdem, weil die Liste nicht leer ist. Die Kategorien sind die Gruppenschlüssel in **umgekehrter** Reihenfolge (bei 18 die Tag-Namen; bei undefinierten Werten ergibt der Sortiervergleich „gleich", die Reihenfolge bleibt).
- `barChartNegative16/17`: alle Werte `undefined` werden verworfen ⇒ leere Liste ⇒ nicht gezeichnet ⇒ **fehlen im Golden** (die Attrappe hat für diese IDs keine `querySelectorAll`-Elemente, also auch keine `useBarChart`-Option).
- Gruppen-Diagramme des neuen Inventars (`positionChart1`, `strategyChart1`, `weekdayChart1`, `entryTimeChart1`, `durationChart1`, `symbolChart1`): r = `null` ⇒ keine Einträge, Option trotzdem gesetzt ⇒ `series: [{type:'bar', data: []}]`, `xAxis: [null]`, `yAxis: [[]]`. Sie fehlen nur, wenn die Teilgruppe leer ist (z. B. `strategyChart1` in `nurAgent` und `ohneTagsNurUngetaggt`, weil `groups.tags` dort keinen Strategie-Tag enthält; ebenso fehlt dort `barChartNegative18`).

Ein Neubau muss diese Nullfälle **genau so** abbilden (oder der Golden Master wird bewusst neu eingefroren). Die eigentlichen Kennzahl-Rechnungen (APPT, PF, Bündelung) sind durch den Golden Master derzeit **nicht abgesichert**.

### 5.3 Je Element-ID (Szenario „alles", Fall `net`; nachgerechnet)

| ID | Inhalt im Golden |
|---|---|
| `pieChart1` | `series: [{type:'pie', data: [{value: 0.45454545…}, {value: 0.54545454…}]}]`, Achsen/Legende leer. = `totals.netWinsCount` 55 / `totals.trades` 121 und 66/121. Bei `gross`: 57/121, 64/121. |
| `pieChart2` | `[{value: 0.5}, {value: 0.5}]` aus den Zufriedenheitslisten. |
| `pieChart3` | `[{value: 0.47473645…}, {value: 0.52526354…}]` = R/(R+1), 1/(R+1) mit `gewinnAnalyse.netR` = 0.9038062…; `gross`: R = 1.0852957… → 0.5204517…/0.4795483…. Fehlt, wenn R nicht > 0 (z. B. `nurAgent`). |
| `perfChart1` | 4 Reihen à 121 Werte: `PnL`/bar (Objekte `{value, itemStyle:{color}, emphasis:{itemStyle:{color}}}` mit Farbzeichenketten `rgba(72, 199, 142, 0.85)` / `rgba(72, 199, 142, 1)` für ≥ 0 und `rgba(235, 87, 87, 0.85)` / `rgba(235, 87, 87, 1)` für < 0), `Equity`/line, `High Water Mark`/line, `Drawdown`/line (nackte Zahlen). xAxis `["#1 BTC", "#2 HBAR", "#3 XRP", …]`, yAxis `[null, null]`, legend `[["PnL","Equity","High Water Mark","Drawdown"]]`. Probe: erster Trade (manuell, netto 25) → PnL log₁₀(26) = 1.41497 → 1.415; Equity 25; HWM 25; Drawdown 0; zweiter Trade −18.58 → Equity 6.42, Drawdown −18.58. |
| `feesChart1` | 3 Reihen `Trading Fees`, `Funding bezahlt`, `Funding erhalten` (nackte Zahlen, erhalten negativ), yAxis `[["BTCUSDT","1000PEPEUSDT","HBARUSDT","ETHUSDT","XRPUSDT","SOLUSDT"]]`, xAxis `[null]`, legend `[["Trading Fees","Funding bezahlt","Funding erhalten"]]`. Probe Sortierung nach netto: BTC 31.47+1.77−1.03 = 32.21 < PEPE 36.52 < HBAR 38.90 < ETH 43.99 < XRP 45.20 < SOL 58.93. In `nurAgent` nur eine Reihe `[1]`, Legende fehlt (`legend: []`). |
| `heatmapChart1` | Reihe 1 `heatmap`: 76 Objekte `{value:[h, d, μ₂, n], itemStyle:{color:'rgb(R,G,B)'}}`; Reihe 2 `heatmap`: 92 Arrays `[h, d, 0, 0]` (76 + 92 = 168 = 7·24). xAxis `[["0:00",…,"23:00"]]`, yAxis `[["Mo",…,"So"]]`. Probe: S = 21.69; erste Zelle Mo 2 Uhr μ₂ = −3.5 → t = 0.25 + 0.75·3.5/21.69 = 0.371 → rgb(101,46,46) ✓; alle 76 Farben mit der Formel aus 3.7 nachgerechnet. |
| `lineBarChart1` | `series: [{type:'line', data: []}, {type:'bar', data: []}]`, xAxis `[[]]`, yAxis `[null]`. |
| `barChart1`, `barChart2` | `series: [{type:'bar', data: []}]`, xAxis `[[]]`, yAxis `[null]`. |
| `barChartNegative1` | 65 × `null`; yAxis = die 65 `groups.timeframe`-Schlüssel rückwärts (`"23:15", "23:00", …, "00:30"`); xAxis `[null]`. |
| `barChartNegative2` | 3 × `null`; yAxis `["60","10","0"]`. |
| `barChartNegative3` | 7 × `null`; yAxis `["6","5","4","3","2","1","0"]`. |
| `barChartNegative4` | 2 × `null`; yAxis `["10","5"]`. |
| `barChartNegative7` | 1 × `null`; yAxis `["1"]`. |
| `barChartNegative13` | 2 × `null`; yAxis `["30","0"]`. |
| `barChartNegative18` | 3 × `null`; yAxis `["GUSS","Breakout","LSOB"]` (`groups.tags`-Reihenfolge tag_1, tag_3, tag_2 nach Einschränkung auf die Gruppe „Strategie", rückwärts, als Tag-Namen). |
| `barChartNegative12`, `barChartNegative14` | wie `barChart1` (Form von `useBarChart`). |
| `positionChart1`, `strategyChart1`, `weekdayChart1`, `entryTimeChart1`, `durationChart1`, `symbolChart1` | `series: [{type:'bar', data: []}]`, xAxis `[null]`, yAxis `[[]]`. |
| fehlen | `barChartNegative16`, `barChartNegative17` (siehe 5.2). |

Unterschied `xAxis [[]] / yAxis [null]` (vertikale Diagramme: Kategorien auf x) gegenüber `xAxis [null] / yAxis [[]]` (horizontale: Kategorien auf y) muss erhalten bleiben — das Feld `data` gehört an die Kategorieachse, die Wertachse hat **kein** `data`-Feld (nicht `[]`, nicht `null` setzen).

`name` fehlt bei allen Reihen ausser Perf, Fees (und den nicht im Golden geprüften SplitBar/StressLine/Zeitstrahl/Kerzen-Verlauf). Ein zusätzlich gesetzter Reihenname wäre eine Abweichung („neu hinzugekommen").

### 5.4 Tagesansicht (Februar 2026, `net`)

IDs: `doubleLineChart<dateUnix>` und `pieChart<dateUnix>` für die 13 verschiedenen Tage in `journalTage` (18 Zeilen; Tage mit mehreren Börsenzeilen erscheinen einmal, letzte Zeile gewinnt).

- `doubleLineChart…`: `series: [{type:'line', data: Brutto kumuliert}, {type:'line', data: Netto kumuliert}]`, xAxis `[[HH:mm …]]`, yAxis `[null]`. Probe 10.02.2026 (`1770681600`): Zeilen bitunix (4 Trades), bitget (2), pionex (1); letzte = pionex mit einem Trade, Ausstieg 15:53 ⇒ `[-13]`, `[-15.05]`, `["15:53"]` ✓. Die Uhrzeiten folgen der Trade-Reihenfolge, nicht der Zeit (bitget-Zeile: „06:50", „06:23").
- `pieChart…`: `[{value: grün}, {value: rot}]` aus `pAndL` der letzten Zeile des Tages. Zeilen ohne `pAndL` ergäben `[{value:0},{value:0}]`. Probe 10.02.2026: pionex-Zeile `pAndL.trades` = 7, `netWinsCount` 2, `netLossCount` 5 ⇒ 0.2857…/0.7142… ✓; 01.02.2026: 0 / 1.

### 5.5 Konsequenz für den Neubau

Exakt zu reproduzieren für den Golden Master: Element-IDs, die Präfix-Überlappung `barChart`/`barChartNegative`, Reihenzahl/-reihenfolge/-typ/-namen, das Fehlen von `data` an Wertachsen, die Objektform der Datenpunkte (Ring: nur `value`; Perf: `value`+`itemStyle`+`emphasis`; Heatmap: `value`+`itemStyle` bzw. nacktes Array; Gruppen-Diagramme neu: `value`+`itemStyle`; Altinventar und Fees: nackte Zahlen), die Behandlung nicht gewählter Kennzahlen (`undefined` vs. `null` vs. weglassen), die Farbzeichenketten in `perfChart1` und `heatmapChart1`, und die Ziehreihenfolge in `zeichneDiagramme`. Wird eine Farbe neu gewählt, ändert sich der Golden Master — das ist bewusst neu einzufrieren und im Commit zu nennen.

---

## 6. Offene Punkte / bekannte Eigenheiten (bewusst nicht entschieden)

1. **Kerzenreihenfolge**: Aufrufer liefern `[Schluss, Eröffnung, Tief, Hoch]`, das Altmodul gibt das unverändert an ECharts, das `[Eröffnung, Schluss, Tief, Hoch]` erwartet — steigende und fallende Kerzen sind vermutlich vertauscht eingefärbt. Der Neubau soll die Aufruferform beibehalten; ob er intern korrigiert, ist eine fachliche Entscheidung (sichtbar, nicht im Golden Master).
2. `tagesChartZoom = 2` rechnet einen sinnlosen Zeitpunkt (Differenz statt Zeitpunkt); Wirkung: Anfangszoom 2 zeigt faktisch keinen sinnvollen Ausschnitt.
3. `useCandlestickChart` mit `init = false` benutzt eine modulweite Instanz; wurde sie zwischenzeitlich von `useDisposeJournalCharts` entsorgt (Selektor enthält `#candlestickChart`), zeichnet Daily.vue in eine entsorgte Instanz. Klären, ob der Neubau stattdessen immer per Element holt.
4. Wochen-/Monatsbündelung vergleicht nur Wochen- bzw. Monatsnummer ohne Jahr und rechnet in der Prozesszeitzone statt `timeZoneTrade`.
5. `useEntryTimeChart` hängt „:00" an „HH:mm"-Schlüssel (Anzeige „09:15:00") und sortiert faktisch nicht.
6. Profitfaktor-Regeln für Null-Nenner unterscheiden sich zwischen den Familien (3.4: `null`/0; 3.5: 0 bzw. −Infinity; 3.6: +Infinity/`null`). Vereinheitlichen nur mit neu eingefrorenem Golden Master — derzeit ohnehin ungeprüft (5.2).
7. `'apps'` ist im Code vorgesehen, aber nicht in der Auswahl `ratios` (nur `appt`, `profitFactor`); die neuen Gruppen-Diagramme kennen es nicht.
8. Die Tagesansicht-Diagramme (2.3/2.4) haben in der heutigen `Daily.vue` keine Elemente mehr — Funktion ist in der App tot, im Golden Master lebendig. Entscheiden, ob sie bleiben.
9. `barChartNegative12/14` (Float, Marktkapitalisierung) stammen aus dem Aktienkontext; die Elemente sind im Template auskommentiert, existieren nur in der Testattrappe.
10. Gesamtergebnis bei Tag-Gruppen-IDs (`barChartNegative…` mit `group_<n>` im Namen): von keinem aktuellen Template erzeugt; Verhalten nur nach 3.5 beschrieben, nicht im Golden Master geprüft.
