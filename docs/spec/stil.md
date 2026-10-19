# Spezifikation: Alt-Stile `style-dark.css` und `base.css`

Clean-Room-Beschreibung von `src/assets/style-dark.css` (~3300 Zeilen) und
`src/assets/base.css`. Beschrieben wird, **welche Klassen und Variablen
gebraucht werden, wo, und was sie optisch bewirken sollen** — keine
Regelblöcke, keine Werte. Farben werden im Neubau nur noch als Token aus
`src/assets/design/tokens.css` angegeben.

Erhoben am 19.10.2026 per Volltextsuche über `src/` (ohne Sprachdateien) und
`index.html`. „Dateien" = Anzahl Dateien ausser style-dark.css selbst.
Grenzen der Erhebung: dynamisch zusammengesetzte Klassen (z. B. `'dot-' +
status`) sind von Hand nachgesehen; Klassen, die **Fremdbibliotheken zur
Laufzeit** erzeugen (Bootstrap-Tooltip/Popover, Quill, markerjs2), tauchen im
Quelltext nicht auf und sind als „Laufzeit" markiert.

---

## 1. `src/assets/base.css` — vollständig tot

- Wird **nirgends** geladen (weder in `src/main.js` noch in einer Komponente
  oder `index.html`). Überbleibsel der Vue-Projektvorlage.
- Inhalt (nur zur Einordnung): die Vue-Theme-Palette (`--vt-c-*`),
  semantische Variablen (`--color-background*`, `--color-border*`,
  `--color-heading`, `--color-text`, `--section-gap`) mit Hell-/Dunkel-
  Umschaltung nach Systemvorgabe, ein globales Zurücksetzen (Box-Modell,
  Randlosigkeit, relative Positionierung jedes Elements, normale
  Schriftstärke) und eine Body-Grundschrift.
- Keine dieser Variablen wird irgendwo benutzt.
- **Empfehlung: Datei löschen.** Nichts davon nachbauen — insbesondere das
  globale „jedes Element relativ positionieren" wäre schädlich.

---

## 2. `style-dark.css` — Rolle heute

- Wird in `src/main.js` nach Bootstrap und `tokens.css`, aber **vor**
  `basis.css` und `rahmen.css` geladen. basis.css und rahmen.css gewinnen
  deshalb bei gleicher Spezifität.
- Kopfkommentar: Farbwerte stehen in tokens.css; die alten Variablennamen
  zeigen nur noch auf die Token, damit die App ohne Umbau jeder Datei die
  neuen Farben trägt. Die Datei soll mit S9 wegfallen.
- Sie mischt vier Dinge, die der Neubau trennen sollte:
  1. **Alte Variablen** als Brücke auf die Token (Abschnitt 3).
  2. **Globale Grundlagen** und **Bootstrap-Anpassungen** ans dunkle Thema
     (Abschnitt 4).
  3. **Geteiltes Chrom** mehrerer Seiten, das bewusst global liegt, weil
     `scoped`-Stile nicht über Komponenten-/Teleport-Grenzen greifen
     (Live-Kopfzeile, Pillen, Kachelraster, Overlay, Kachel-Auswahl) —
     Abschnitt 5.
  4. **Seitenspezifische Reste** einzelner Journal-Seiten (Abschnitt 6) und
     **toten Code** (Abschnitt 7).

---

## 3. Alte Variablennamen → Token

Spalte „Zuordnung" = worauf style-dark.css die Variable heute legt.
„Dateien" = wie viele Dateien ausser style-dark.css sie benutzen.

| Alte Variable | Zuordnung heute | Dateien | Beispiele / Bemerkung |
|---|---|---|---|
| `--blue-color` | `--accent` | 49 | SideMenu, TradeEvalPopup, InfoTipp … (meistverbreitete Akzentfarbe) |
| `--blue-active-color` | `--accent-hover` | 1 | SidebarFilters; intern: Quill-Werkzeugleiste, aktive Reiter, aktive Dropdown-Einträge, Checkboxen |
| `--grey-color` | `--leise` | 16 | LoginGate, AbverkaufAnsicht, ProjektPruefung; intern: Status-Punkte „pausiert/leer/wartet" |
| `--grey-text` | `--muted` | 24 | AlarmReiter, IndikatorSchalter, StrategieReiter (Textvariante des Grau, wegen Kontrast eingeführt) |
| `--dark-grey` | `--leise` | 0 | nur intern in toten Regeln → **tot** |
| `--ghost-grey` | feste helle Graufarbe (kein Token) | 0 | **tot** |
| `--red-color` | `--bad` | 19 | AlarmDialog, ZeichnungStil, KiReiter |
| `--red-hover-color` | fester dunklerer Rotton (kein Token) | 0 | nur intern für `.btn-red`-Hover; Vorschlag: `--bad` mit Abdunklung oder `--bad-flaeche` |
| `--green` | `--good` | 6 | SymbolSuche, TiefensucheErgebnis, heatmapRenderer.js |
| `--black` | `--panel-hoch` | 0 | nur intern in toter Regel → **tot** |
| `--black-bg-0` | `--bg` | 0 | intern: Navbar (überstimmt), Playbook-Bearbeitungsmodus, markerjs2-Fläche |
| `--black-bg-2` | `--bg` | 15 | PageInfo, KiUebersicht, AbverkaufAnsicht |
| `--black-bg-3` | `--bg` | 6 | KachelFunding, Incoming, Liquidity; intern: Kachel- und Overlay-Flächen |
| `--black-bg-5` | `--panel` | 15 | SymbolSuche, VorlagenMenue, ChartKopfleiste |
| `--black-bg-7` | `--panel` | 8 | SidebarFilters, LiveSymbolPicker, Lernen; intern: Karten, Modals, Formularfelder |
| `--black-bg-12` | `--panel-soft` | 12 | SideMenu, InfoTipp, ModeSwitcher (Hover-Flächen) |
| `--white-87` | `--text` | 65 | BetaHinweis, PageInfo, SidebarFilters (Haupttext) |
| `--white-80` | Weiss, stark deckend (kein Token) | 3 | Daily, Playbook, Incoming → Vorschlag `--text` |
| `--white-75` | Weiss, deckend (kein Token) | 2 | Nachrichten, Settings → Vorschlag `--text` |
| `--white-70` | Mischung aus `--text` (überwiegend) und `--muted` | 16 | InfoTipp, PageInfo, KachelAltseason (Pillen-Text) |
| `--white-65` | `--muted` | 0 | intern: Platzhaltertext, Quill-Überschrift |
| `--white-60` | `--muted` | 54 | PageInfo, BotDashboard, SideMenu (mittlere Betonung) |
| `--white-50` | Weiss, halb deckend (kein Token) | 14 | BotDashboard, PageInfo, LiveSymbolPicker → Vorschlag `--muted` |
| `--white-38` | `--muted` | 25 | SideMenu, Pult-Bänder (schwache Betonung; Name historisch, steht für den Slot „Text mit geringer Betonung") |
| `--white-20` | Weiss, schwach (kein Token) | 3 | Daily, Incoming, Playbook → Vorschlag `--line-stark` |
| `--white-18` | `--line-stark` | 28 | InfoTipp, PageInfo, SideMenu (Rahmen, Trennlinien) |
| `--white-10` | `--line` | 35 | OffeneReiter, ProjektPruefung, SymbolSuche (feine Linien) |
| `--font-size-main` | kleine Grundschrift (feste Pixelgrösse) | 0 | intern nur `.incoming-info` |
| `--font-size-secondary` | sehr kleine Schrift | 0 | **tot** |
| `--bg-card` | → `--black-bg-7` → `--panel` | 1 | Settings |
| `--border-color` | → `--white-10` → `--line` | 2 | KiAgent, Settings |
| `--border-radius` | `--radius`; unter 992 px Breite kleiner | 39 | InfoTipp, PageInfo, HebelkartenCanvas |
| `--border-subtle` | 1-px-Linie in `--white-18` (→ `--line-stark`) | 1 | Settings; intern: Karten, Modals, Popover, Dropdowns |
| `--shadow-sm` | `--schatten` | 9 | SymbolSuche, ChartKopfleiste, VorlagenMenue |
| `--transition-fast` | kurzer Übergang auf alles | 0 | nur intern |

**Benutzt, aber nirgends definiert** (wirken nur dort, wo ein Rückfallwert
angegeben ist — sonst fällt die Deklaration still weg):
`--white-12` (8 Dateien, z. B. PageInfo, ModelManager, StrategyParamForm;
intern auch Einstellungs-Reiter, Kachelkopf, Overlay), `--white-45`
(4 Dateien, Radar-Kacheln; intern Regler-Beschriftung), `--white-25` (intern),
`--white-30` (Setup, Nachrichten), `--white-40` (Nachrichten),
`--green-color` (5 Dateien, z. B. CoinRadar, Playbook, Liquidity; intern
Gewinnquoten-Balken), `--black-bg-1` (LoginGate, Settings).
Vorschlag beim Ablösen: `--white-12`/`--white-25` → `--line`/`--line-stark`,
`--white-30`/`--white-40`/`--white-45` → `--muted` bzw. `--leise`,
`--green-color` → `--good`, `--black-bg-1` → `--bg`.

**Weitere globale Definitionen in style-dark.css:** keine ausser den oben
genannten. Unter 992 px wird nur `--border-radius` verkleinert.

---

## 4. Globale Grundlagen und Bootstrap-Anpassungen

### 4.1 Elemente und Grundverhalten (alle benutzt)

| Gegenstand | Absicht | Token / Bemerkung |
|---|---|---|
| `[v-cloak]` | Elemente mit `v-cloak` bis zum Mount verbergen (Layout-Rahmen nutzt es) | – |
| Rollbalken aller Elemente | dünne, dunkle, halbtransparente Rollbalken statt heller Systembalken (Firefox und Chromium) — helle Balken rissen Löcher ins dunkle Thema | basis.css macht dasselbe bereits mit Token; doppelt |
| Schrift aller Elemente | Systemschrift aus `--schrift` (setzt die Schrift über den Allselektor, schlägt Vererbung) | basis.css wiederholt das absichtlich |
| `body` | Grund `--bg`, Text `--text`, Grundschrift etwas grösser als Browser-Standard | basis.css setzt Grund/Text/Schrift ebenfalls; **die Vergrösserung der Grundschrift gibt es nur hier** — beim Ablösen bewusst entscheiden, sonst ändert sich das ganze Schriftbild |
| `main` | Innenabstand rundum, am Handy kleiner (mit Vorrang) | wird vom Rahmen (`.at-rahmen main` in rahmen.css) überstimmt |
| `hr` | Trennlinie in Linienfarbe, voll deckend | `--line-stark`; basis.css regelt `hr` ebenfalls |
| Platzhaltertext in Eingaben/Textfeldern | gedämpft | `--muted` |
| Datums-/Monats-/Datetime-Felder | heller Text, Rand gedämpft; Kalender-Symbol des Browsers invertiert, damit es auf Dunkel sichtbar ist | `--text`, `--muted` |
| Listen-Einträge mit Quill-Aufzählungsmarke | ausserhalb des Editors als Aufzählungspunkt, innerhalb des Editors ohne (Quill zeichnet selbst) | betrifft gespeicherte Quill-Notizen |
| Überschriften h2, h3, h4 | **erhalten global einen kleinen Abstand nach oben** — Nebenwirkung eines Selektorfehlers (gemeint war nur Quill-Inhalt). Wirkt heute app-weit | beim Ablösen bewusst entscheiden |
| `table` (Element) | Tabellentext immer hell (mit Vorrang) | `--text` |

### 4.2 Angepasste Bootstrap-Bausteine (in Worten)

| Bootstrap-Klasse(n) | Dateien | Anpassung |
|---|---|---|
| `visually-hidden` | 1 (KiAgent) | Nur-für-Screenreader-Klasse **selbst nachgebaut**, damit sie auch ohne Bootstrap wirkt (Begründung im Altcode: Bootstrap kam vom CDN). |
| `text-muted` | 35 | gedämpfter Text, mit Vorrang → `--muted` |
| `form-control` | 32 | dunkles Feld (Panel-Fläche), heller Text, Rand in Linienfarbe, abgerundet, kurzer Übergang; deaktiviert/schreibgeschützt etwas andere Fläche, volle Deckkraft; Fokus: Rand hell, **kein** Fokus-Schein. Text mit Vorrang hell (Altlast aus Stripe-Zeiten). Am Handy Mindesthöhe für Finger. *rahmen.css überstimmt: Fläche `--bg`, Rand `--line-stark`, Radius `--radius-knopf`, Fokus mit Rand `--accent` und Schein `--accent-flaeche`.* |
| `form-select` | 28 | wie Formularfeld; deaktiviert/schreibgeschützt nicht hellgrau (sonst würde helle Schrift auf hellem Grund unlesbar — betraf die Modellwahl in den KI-Einstellungen); in `.tradeSetup` kleinere Schrift (Daily); am Handy Mindesthöhe. rahmen.css überstimmt wie oben. |
| `form-check-input` | 17 | angehakt in Akzent (`--accent-hover`; rahmen.css: `--accent`) |
| `form-floating` | 0 | Beschriftung schwebender Felder gedämpft, ohne Hintergrund → **tot** |
| `nav-tabs`, `nav-link` | 4 / 8 | Reiterleiste mit Unterlinie in Linienfarbe; inaktive Reiter heller Text; aktiver Reiter in Akzent mit Panel-Fläche und oben gerundeten Ecken; jeder `nav-link` hell, Hover in Akzent (mit Vorrang), gedrückt `--accent-hover`; am Handy kompakter. Benutzt in AddTrades, Settings, Daily, Dashboard (Reiter) und im Seitenmenü. |
| `dropdown-menu`, `dropdown-item` | 3 / 2 | dunkles Aufklappmenü mit feiner Linie, Radius, Schatten, abgeschnittenem Überlauf; Einträge hell, Hover/aktiv mit Panel-Fläche; „aktiv"-Eintrag in Akzent (mit Vorrang). rahmen.css setzt die Bootstrap-Dropdown-Variablen zusätzlich auf Token. Nav, SidebarFilters, Daily. |
| `dropdown` + Knopf darin | 3 | Knöpfe innerhalb `.dropdown` sehen aus wie ein Auswahlfeld: volle Breite, linksbündig, Pfeil-Symbol rechts als Hintergrundbild, Panel-Fläche; der Bootstrap-Pfeil an `dropdown-toggle` wird ausgeblendet. SidebarFilters, Daily. |
| `btn-secondary` | 2 | kein Fokus-/Aktiv-Schein (Nav-Export, Lernen) |
| `btn-outline-primary` | 19 | Umrandung und Text in Akzent, Radius, Übergang; Hover/gedrückt gefüllt. *rahmen.css überstimmt per Bootstrap-Variablen: Rand `--accent-rand`, Hover-Fläche `--accent-flaeche`.* |
| `btn`, `btn-sm` | 43 / 42 | nur am Handy: Mindesthöhen für Fingerbedienung, etwas kompakter |
| `mb-3` | 25 | am Handy kleinerer unterer Abstand |
| `modal-content` | 5 | dunkle Panel-Fläche, heller Text, Radius, feine Linie, kräftiger Schatten. rahmen.css: `--panel`, `--line-stark`, `--radius`. |
| `modal` in `.row` | – | kein Innenabstand für Modals, die in einer Bootstrap-Zeile stehen |
| `#evalPopupModal` (ID) | 1 (TradeEvalPopup) | schmaler Dialog, Inhalt scrollt bei Überlänge, knappere Kopf-/Fuss-Abstände; am Handy fast volle Breite |
| `#tradesModal` (ID) | 3 (Screenshot.vue, screenshots.js, Daily) | breiter Dialog (Großteil der Breite), wenig Abstand oben; am Handy randlos über die ganze dynamische Höhe |
| `table` / `.table` | 36 | Zellen mit Panel-Fläche (mit Vorrang), heller Text, Linienfarbe; Tabelle abgerundet mit abgeschnittenem Überlauf |
| `table-responsive`, `tab-content` | 15 / 3 | unter 992 px waagerecht scrollbar (mit Trägheitsscrollen); Tabellen darin (ausser `stats-table`) bekommen eine Mindestbreite — **nur** dort, wo gescrollt werden kann (sonst lief die Seite seitlich weg) |
| `tooltip-inner` (Laufzeit) | – | nur mit eigener Klasse `tooltipLargeLeft`: breiterer, linksbündiger Tooltip (Dashboard, per `data-bs-custom-class`) |
| `popover`, `popover-body` (Laufzeit) | – | dunkles Popover mit Panel-Fläche, Radius, feiner Linie, Schatten; Text gedämpft. Gebraucht für die Lösch-Rückfrage (`popoverDelete`, Screenshot.vue, utils.js) |
| `navbar` | 1 (Nav) | feste Höhe, Abstand nach oben, Unterlinie, Grund `--bg` — wird in Nav.vue vollständig überstimmt; am Handy kompakter. Für den Neubau ohne Belang. |
| `spinner-border` | – | nicht angepasst |

### 4.3 Bibliotheken

| Gegenstand | Herkunft | Absicht |
|---|---|---|
| `ql-*` (Laufzeit) | Quill (Playbook.vue, Incoming.vue) | Werkzeugleiste: Hover/aktiv/ausgewählt in Akzent (Text, Füllung, Kontur der SVG-Symbole); Links in Akzent; Hintergrund-/Textfarbe „blau" der Notiz in Akzent. Eigene Editoren mit Klasse `quill-incoming`: Werkzeugleiste und Editorfläche mit Linienfarbe, Panel-Fläche, oben/unten passend gerundet, kompakte Mindesthöhe, Platzhalter gedämpft. Werkzeugleisten-Regel greift in `pb-edit-section` (benutzt) und `incoming-eval-section` (tot). |
| `__markerjs2_` (Laufzeit, vermutet) | markerjs2 (Screenshot-Annotation, `utils/screenshots.js`) | Annotationsfläche über allem (hoher Stapelrang), Bild ohne oberen Rand, Werkzeugleisten-Fläche `--bg`. Ob markerjs2 genau diesen Klassennamen erzeugt, ist nicht geprüft — im Neubau mit echter Annotation testen. |
| Shepherd (`shepherd-*`), `exitButton` | Tour-Bibliothek, entfernt | **tot** |
| `bs-stepper-circle` | Stepper, entfernt | **tot** |
| `InputElement`, `is-invalid` | Stripe, entfernt | **tot** |

---

## 5. Geteiltes Chrom (bewusst global, alle benutzt)

Diese Gruppen stehen global, weil mehrere Seiten, Rahmen-Komponenten und
per Teleport in den Body gehängte Overlays sie teilen — `scoped`-Stile
griffen dort nicht. Im Neubau gehören sie in die jeweilige gemeinsame
Komponente oder in eine eigene globale Datei mit Token.

### 5.1 Live-Kopfzeile (Bookmap, Liquidationskarte, Open Interest, Live-Seiten)

| Klasse | Dateien | Absicht |
|---|---|---|
| `liveHeader` | 8 (OpenInterest, Liquidations, LiveAuswertung, LiveSessions …) | Kopfzeile: Titelgruppe links, Bedienung rechts, umbrechend; am Handy untereinander |
| `liveTitle` | 8 | Titel, Symbol, Markt und Status nebeneinander |
| `liveSymbol` | bis 23 | Symbolname, etwas grösser, halbfett, `--text` |
| `liveMarket` | bis 8 | Markt-Plakette (Futures/Spot): klein, gedämpft, Pillenrand in Linienfarbe |
| `liveDot` + `dot-<status>` (dynamisch) | 7 (RadarKachel, PultRahmen, Liquidity, Marktradar, Livetrading …) | kleiner runder Statuspunkt. Farben je Status: `live`/`ready` grünlich-türkis (→ `--good`), `syncing`/`connecting`/`reconnecting`/`loading`/`veraltet` gelb (→ `--warn`), `error` → `--bad`, `paused`/`idle`/`empty` → `--leise`, `replay` → `--accent`. Weitere Statuswerte fallen auf den Grundton (`--leise`). |
| `liveState` | 6 | Statustext klein, gedämpft |
| `liveActions` | 8 | Bedienreihe; Kinder schrumpfen **nie** (sonst ragen Beschriftungen aus zusammengedrückten Pillen über die Nachbarn); am Handy eine einzige seitlich wischbare Zeile ohne sichtbaren Balken |

### 5.2 Steuer-Pillen

| Klasse | Dateien | Absicht |
|---|---|---|
| `ctl-pill` | 34 (RadarKachel, PageInfo, SitzungsLeiste, AbverkaufAnsicht, Coin-/Hype-Radar, Nachrichten …) | kleine Knopf-Pille: Rand in Linienfarbe, transparent, Text leicht gedämpft; Hover Rand Akzent; am Handy Mindesthöhe für Finger |
| `ctl-pill.active` | (s. o.) | gewählt: gefüllt in Akzent, fett |
| `ctl-pill.accent` | 5 | die eine auslösende Pille einer Leiste: gefüllt in Akzent, Hover heller |
| `ctl-pill.warn` | ≥ 1 (z. B. AgentStrategies, Not-Aus) | warnend (Abbruch, Not-Aus, Löschen): Rand und Text rot, Hover rote Fläche — ein Knopf, der Positionen schliesst, darf nicht wie „Ansicht wechseln" aussehen → `--bad`, `--bad-flaeche` |
| `ctl-pill.active-warn` | 1 (Liquidity) | aktiv im Warnzustand: gelb gefüllt, dunkle Schrift → `--warn` |
| `ctl-pill` deaktiviert | – | halbe Deckkraft, Verbotszeiger |
| `ctl-sep` | 9 | senkrechter Trennstrich zwischen Pillengruppen, Linienfarbe |
| `ctl-select` | 1 (Liquidity) | Auswahlfeld im Pillenstil (Fläche `--bg`, Linie, Hover-Rand Akzent) |
| `floatDropdown`, `floatDropdownZeile` | 2 (ShareCardModal, Settings) | Kasten eigener Aufklapp-Auswahlen (begrenzte Höhe, scrollt, Radius, Linie, Schatten) und deren Zeilen (Hover/Tastaturfokus mit leichter Fläche); Position bleibt bei der jeweiligen Stelle |

### 5.3 Kachel-Auswahl („Kacheln"-Knopf)

`card-config-dropdown` (4: Auswertung, Livetrading, Marktradar, Dashboard),
`card-config-title` (4), `card-config-item` (4), `card-config-divider`
(1: Auswertung). Absicht: rechtsbündig unter dem Knopf aufklappendes Raster
mit so vielen Spalten wie hineinpassen (Marktradar bietet über zwanzig
Kacheln), begrenzte Höhe mit Scrollen, Fläche `--bg`, Linie, Radius,
Schatten; Titel über alle Spalten klein/gesperrt/gedämpft; Einträge mit
Hover-Fläche, einzeilig mit Auslassungspunkten; Trennlinie über alle Spalten.
Unter ~600 px einspaltig und schmaler. War vorher dreifach `scoped`
definiert und griff auf drei von fünf Seiten nicht.

### 5.4 Kachelraster und Kachel (Marktradar, Live-Trading)

| Klasse | Dateien | Absicht |
|---|---|---|
| `radarGrid` | 2 (Marktradar, Livetrading) | Raster mit automatischer Spaltenzahl ab einer Mindestkachelbreite (CSS-Variable `--kachelMin`, die `useKachelRaster` ausliest), kleiner Abstand, freie Fangfläche unten (sonst gingen knapp zu tief losgelassene Kacheln verloren); am Handy genau eine Spalte mit Nullminimum und Spannweiten-Klemme (sonst seitliches Überlaufen) |
| `radarGrid.imGriff` | useKachelRaster.js | während des Ziehens keine Textauswahl |
| `radarCard` | 3 | Kachel: Spalte, volle Höhe, Mindesthöhe, Fläche `--bg`, Linie, Radius `--radius`, Überlauf abgeschnitten |
| `radarCard--fehler` | 1 | Rand rötlich → `--bad` |
| `radarCard.wirdGezogen` | useKachelRaster.js | Umriss in Akzent |
| `radarGhost` | useKachelRaster.js | Platzhalter beim Ziehen: blass, gestrichelt |
| `radarCardHead` | 2 | Kopfzeile = Ziehgriff (Greifzeiger, keine Touch-Gesten, keine Auswahl), Unterlinie |
| `radarCardTitle` | 1 | Titel klein, halbfett, einzeilig |
| `radarCardIcon` | 1 | Symbol in Akzent |
| `radarCardStand` | 1 | Zeitstempel rechts, klein, gedämpft |
| `radarCardSteuerung` | 1 | Regler-Slot hinter dem Titel; normal bedienbar; nicht umbrechend, sondern unsichtbar scrollend (ein Umbruch würde die Kachelhöhe ändern) |
| `radarCardCtl` (+ `.active`, `.warn`) | 2 (Liqkarte-/Bookmap-Kopf) | Mini-Pille für die Kopfzeile; aktiv Akzent gefüllt; „eingefroren" gelb gefüllt — eine Warnung, kein „aktiv" → `--warn` |
| `radarCardSel` | 2 | Mini-Auswahlfeld im selben Stil |
| `radarCardCtlLabel` | 1 | winzige gesperrte Beschriftung vor einer Reglergruppe |
| `radarCardBtn` | 4 | schlichte Symbolknöpfe im Kopf, Hover Akzent; bleiben im Ziehgriff klickbar |
| `radarGriff` | 1 | Ziehgriff-Symbol |
| `radarCardBody` | 1 | Inhalt füllt den Rest, klickbar |
| `radarLeer` | 4 | Leer-/Fehlerzustand zentriert, gedämpft |
| `radarGroesse` | 1 | Eckanfasser unten rechts (diagonale Striche, dezent, Hover deutlicher, am Handy grösser) |

### 5.5 Gross-Ansicht (Overlay)

`radarOverlay`, `radarOverlayBox`, `radarOverlayHead`, `radarOverlayClose`,
`radarOverlayBody`, `radarOverlayFuss` — je 2 Dateien (RadarOverlay,
KartenEinstellungen). Absicht: fixe, abdunkelnde Fläche über allem mit
zentriertem Kasten (begrenzte Breite und dynamische Höhe, Fläche `--bg`,
Linie, Radius, Schatten), Kopf mit Titel und Schliessen-Knopf, scrollender
Inhalt, kleiner gedämpfter Fuss. Der Schliessen-Knopf ist ein volles
Fingerziel (mindestens 44 × 44), weil bei hohen Kacheln kein Hintergrund zum
Danebentippen bleibt. Am Handy weniger Rand, fast volle Höhe.

---

## 6. Seitenspezifische Klassen (benutzt)

### 6.1 Gewinn/Verlust und Karten (journalweit)

| Klasse | Dateien | Absicht | Token |
|---|---|---|---|
| `greenTrade` | ~38 (zusammen mit redTrade; BotDashboard, SitzungsLeiste, ChartPanel, TradeKarte …) | Gewinnzahl grün (mit Vorrang) | `--good` |
| `redTrade` | ~38 | Verlustzahl rot (mit Vorrang) | `--bad` |
| `greenTradeDiv` / `redTradeDiv` | 1 (Calendar) | Kalendertag gefüllt grün/rot mit sehr dunkler Schrift in passendem Ton | `--good`/`--bad` (Schrift: dunkel; Vorschlag `--on-accent`-artiges Dunkel oder `--bg`) |
| `dailyCard` | 18 (NoData, BotDashboard, Screenshots, AgentStrategies …) | die Standardkarte: Panel-Fläche, feine Linie, Radius, Innenabstand, volle Höhe/Breite, Schatten; Bilder darin volle Breite; am Handy kompakter, h6 kleiner | `--panel`, `--line-stark`, `--radius`, `--schatten` → Baustein `Karte` |
| `cardFirstLine` | 3 (Screenshot, Screenshots, Daily) | Kopfzeile einer Karte mit Unterlinie | `--line-stark` |
| `pointerClass` | ~32 | Handzeiger | – |
| `text-blue` | 5 | Akzentfarbe für Text | `--accent` |
| `txt-small` | 4 | kleine Schrift | – |
| `blueBtn` | 1 (ReturnToTopButton) | Knopf in Akzent, heller Text, Radius; Hover `--accent-hover` | → Baustein `Knopf art="haupt"` |
| `btn-red` | 1 (Screenshot) | Gefahrenknopf rot gefüllt, Hover dunkler | `--bad` → `Knopf art="gefahr"` |
| `#btn-return-to-top` | 1 (ReturnToTopButton) | fix unten rechts, über dem Inhalt; am Handy näher am Rand | – |
| `overlay` | 1 (SpinnerLoadingPage) | Lade-Spinner fix über allem, vertikal etwa mittig | – |
| `nav-filter-info`, `mobile-menu-toggle` | 1 (Nav) | siehe geruest.md, Abschnitt 3 | `--muted`, `--panel-soft` |
| `activeNavCss`, `sideMenu*`, `menuKlappe`, `menuSchmal`, `menuText`, `inhaltNebenSchmal`, `sidebar-footer`, `toggleSideMenu` | Gerüst | siehe geruest.md, Abschnitt 5 | |
| `tj-censor` (von privacy.js gesetzt) | 1 | Zensur: einzelner Zahlenwert verwischt, nicht markier-/anklickbar, sanfter Übergang | – |
| `privacy-on` am `body` (von privacy.js) | 1 | im Zensurmodus alle ECharts-Diagramme verwischen — **ausser** den kleinen Quoten-Donuts (`chartIdCardClass`), die nur Prozente zeigen | – |
| `popoverDelete` | 2 | Lösch-Symbol rot mit Abstand | `--bad` |
| `settings-nav` | 1 (Settings) | Einstellungs-Reiter: nur Unterlinie, Text gedämpft, Hover heller mit schwacher Unterlinie, aktiv Akzent mit Akzent-Unterlinie | `--muted`, `--text`, `--accent`, `--line` → Baustein `Reiter` |
| `switch`, `slider`, `round` | 1 (Settings, drei Schalter im KI-Nachrichten-Bereich) | eigener Ein/Aus-Schalter: verstecktes Kontrollkästchen, Schiene grau, Knopf weiss; an = Schiene Akzent; gerundet; am Handy kleiner | `--accent`, `--line-stark` |

### 6.2 Diagramme, Kalender, Dashboard

| Klasse | Dateien | Absicht |
|---|---|---|
| `chartClass` | 5 (charts.js, mountOrchestration.js, Auswertung, AgentPerformance, Dashboard) | Diagrammfläche mit fester Höhe, volle Breite; unter 992 px und am Handy niedriger; einzelne Dashboard-Diagramme (`#perfChart1`, `#heatmapChart1`, `#positionChart1`, `#strategyChart1`) haben am Handy eigene Höhen (überstimmen Inline-Höhen) |
| `chartIdCardClass` | 3 | kleine Quoten-Donuts, niedrige feste Höhe; vom Zensur-Verwischen ausgenommen |
| `candlestickClass` | 1 (Daily) | Kerzenchart, hoch; kleiner auf Tablet/Handy |
| `chartGaugeClass` | 1 (Auswertung) | Tachodiagramm mittlerer Höhe |
| `daily-stats-bar`, `stats-label`, `stats-divider` | 1 (Daily) | Kennzahlenzeile in einer Reihe; Beschriftung und Trenner gedämpft; am Handy umbrechend, Trenner aus |
| `stats-table`, `stats-separator` | 1 (Dashboard) | Kennzahlentabelle randbündig zur Karte, gestrichelte Zeilentrenner, linke Spalte füllt, rechte nicht umbrechend; Trennzeilen ohne Linie mit kleinem hr |
| `fee-bar-bg`, `fee-bar-fill` | 1 (Dashboard) | Gebühren-Fortschrittsbalken (Schiene schwach hell, Füllung gelb-orange Verlauf) → `--line`, `--warn` |
| `trade-type-table`, `trade-type-badge` | 1 (Dashboard) | Statistik nach Trade-Typ: Kopf klein gesperrt gedämpft, feine Zeilenlinien; Typ-Plakette farbig mit heller Schrift |
| `winrate-bar`, `winrate-fill` | 1 (Dashboard) | Mini-Balken der Trefferquote (Schiene schwach, Füllung grün) → `--line`, `--good` |
| `dashInfoTitle` | 1 (Dashboard) | winzige fette gedämpfte Beschriftung |
| `tooltipLargeLeft` | 1 (Dashboard) | breiter linksbündiger Tooltip |
| `calDivDash`, `calDivDay`, `calDivMini`, `dayNumber`, `miniCalBox` | 1 (Calendar) | Kalenderzellen (Monatsübersicht, Tageszelle, Mini-Kalender) mit feiner Linie und festen Grössen; Tageszahl klein; am Handy niedriger/kleiner |

### 6.3 Pendente Trades, Playbook, Bewertung

| Klasse | Dateien | Absicht |
|---|---|---|
| `incoming-info` | 1 (Incoming) | Metainfos klein, gedämpft |
| `incoming-pnl` | 1 | P&L gross und fett |
| `incoming-card` | 1 | Karte mit automatischer Höhe (überstimmt `dailyCard`-Vollhöhe) |
| `incoming-meta-section` | 1 | abgesetzter Kasten mit Panel-Fläche, Radius |
| `stress-dot` (+ `.active`, `.inactive`, `stress-spacer`), `stress-number` | 2 (Playbook, Incoming) | Stress-/Emotions-Skala aus kleinen Punkten mit Zahl darunter; aktiv gelb (→ `--warn`), inaktiv gedämpft; Abstandshalter schmaler |
| `pb-card`, `pb-header`, `pb-body`, `pb-chevron` | 1 (Playbook) | aufklappbare Playbook-Karte: Panel-Fläche, Linie, Radius; Hover Rand und Chevron heller; Körper mit oberer Linie |
| `pb-pill` | 1 | kleine gerahmte Pille |
| `pb-edit-btn` | 1 | quadratischer Symbolknopf, Hover Fläche + Akzent |
| `pb-grid`, `pb-field`, `pb-field-wide`, `pb-label`, `pb-value`, `pb-text`, `pb-note-content` | 1 | Lesemodus als Feldliste: Beschriftung links (klein, Grossbuchstaben, gedämpft, Mindestbreite), Wert rechts; breite Felder untereinander; Trennlinien zwischen Feldern; Notiztext mit Zeilenabstand |
| `pb-stress-bar`, `pb-stress-fill` (+ `stress-low`/`-mid`/`-high`) | 1 | Stressbalken: Schiene, Füllung grün/gelb/rot je Stufe → `--good`/`--warn`/`--bad` |
| `pb-edit-mode`, `pb-edit-section`, `pb-edit-label` | 2 (Playbook, Incoming) | Bearbeitungsmodus mit dunklerem Grund und Akzent-Oberlinie; Abschnitte mit Trennlinien; Abschnittsbeschriftung wie `pb-label` |
| `pb-fullscreen-overlay`, `pb-fullscreen-img` | 1 | Bild-Vollansicht: fix, fast schwarz, zentriert, klick schliesst; Bild begrenzt auf Bildschirm |
| `playbook-link-btn` | 1 (Screenshots) | kleiner gerahmter Link-Knopf, Hover Akzent |
| `quill-incoming` | 2 | siehe 4.3 |

### 6.4 Screenshots, Tags, Chat, Share-Card, Sonstiges

| Klasse | Dateien | Absicht |
|---|---|---|
| `imgContainer` | 2 (Screenshot, Screenshots) | Bildbehälter zentriert, fast volle Höhe |
| `imgContainerAddScreenshot` | 1 (Screenshot) | grosser Bildbehälter (Grossteil der Bildschirmhöhe, am Handy die Hälfte) |
| `overlayImg`, `screenshotImg` | 1 | Annotation absolut über dem Bild; Bild höchstens Behälterhöhe |
| `tag` | ≥ 3 (Screenshot, Daily, TradeKarte) | Tag-Plakette: kleiner Innenabstand, Radius, Farbe kommt inline |
| `tags` | 1 (TradeKarte) | **Achtung:** global hellblau-grauer Hintergrund mit Innenabstand (Altlast aus der Vorlage). TradeKarte benutzt die Klasse und bringt eigene `scoped`-Regeln für `tags`/`tag` mit (höhere Spezifität); was davon nicht überschrieben wird, erbt sie global — die globale Regel selbst ist vermutlich ungewollt |
| `tag-badge` (+ `.active`) | 1 (Settings) | wählbare Tag-Pille: rund, Rand schwach, gedämpft; Hover heller; aktiv grün gefüllt → `--good`/`--good-flaeche` |
| `tag-input`, `remove-tag`, `clickable-area`, `dropdown-menu-tags` | 1 (Daily) | Tag-Eingabe: randloses Eingabefeld, Entfernen-Kreuz mit Zeiger, unsichtbare Klickfläche rechts, Vorschlagsliste absolut unter dem Feld (dunkle Fläche, Linie, Radius, Einträge mit Zeiger) |
| `chat-section`, `chat-messages`, `chat-bubble`, `chat-bubble-user`, `chat-bubble-ai`, `chat-input` | 1–2 (KiAgent, AgentBuilder) | Chat: begrenzte Höhe, scrollende Nachrichtenliste; Blasen gerundet; Nutzer rechts eingerückt in Akzent mit heller Schrift und Zeilenumbrüchen; KI links eingerückt auf Panel-Fläche; Eingabe nur senkrecht vergrösserbar; am Handy schmalere Einrückung, niedrigere Liste |
| `share-card-modal`, `share-card-summary`, `share-card-prompt`, `share-card-generating`, `share-card-preview` | 1 (ShareCardModal) | Share-Card-Dialog: Panel-Fläche, Zusammenfassungskasten, Prompt-Feld dunkel mit Akzent-Fokus, zentrierter Ladezustand, Vorschau mit Radius und Schatten |
| `share-card-btn` | 1 (Daily) | Auslöser-Knopf mit violettem Verlauf (einzige Farbe ausserhalb der Palette — im Neubau auf Token bringen, z. B. `Knopf art="haupt"`) |
| `inputText` | 1 (AddExcursions) | schmales Zahlenfeld ohne vertikalen Innenabstand |
| `livePicker` | 1 (LiveSymbolPicker) | nur als Marke für das eingeklappte Seitenmenü (dort ausgeblendet) |

---

## 7. Tote Klassen, IDs und Variablen (nirgends benutzt)

Diese Regeln wirken auf nichts und müssen **nicht** nachgebaut werden.

- **Altes Seitenmenü-Logo:** `logoDiv` (auch `.schmal`), `logo-area`,
  `logo-text`, `logo-title`, `logo-username`, `logoProfileImg`,
  `profileImg`, `img.logo` (Start.vue setzt `logo` an eine `Logo`-Komponente,
  die kein `img` rendert), `img.navbar-brand`, `#navbarDropdown`,
  `fa-bars` (unter `mobile-menu-toggle`), `bg-white`, `blue-link`.
- **Formulare/Schalter:** `form-check-sm`, `check-sm`, `form-floating`
  (samt `form-control-plaintext`), `sliderText`, `v-align-start`,
  `v-align-end`, `dropdownCheck`, `btn-check` (nur im Selektor),
  `InputElement`/`is-invalid` (Stripe), `groupInput`, `#colorPicker`,
  `spinnerHeigth`, `buttonProgress`, `buttonProgressBar`,
  `progress-bar-text`.
- **Icons/Layout-Reste:** `parentIcon`, `childIcon`, `noDataTab`,
  `bottom-right`, `fab`, `vl`, `twoLines`, `theme-bg-dark`,
  `scrolling-wrapper`, `forecastTable`, `titleWithDesc`, `numXSmall`,
  `miniCalCol`, `chartCard`, `chartIdDailyClass`, `txt-x-small`,
  `txt-xx-large`, `txt-x-large`, `neutralTrade`, `blackTradeDiv`.
- **Tagebuch/Timeline:** `diaryRow`, `ul.timeline`, `noteDateDiv`.
- **Video/Bildvorschau:** `videoCard`, `divImgContainer`,
  `videoCardContainer`, `#videoTd`, `#videoBig`, `#imagePreview`,
  `imagePreviewDiv`, `#comment`.
- **Quill-IDs:** `#quillEditor`, `#quillEditor0`, `#quillEditor1`,
  `#quillEditor2`, `#quillEditorPlaybook`, `#quillEditorDiary` (Editoren
  tragen heute dynamische IDs `quillPlaybook-…`). `quill` als Klasse
  (`.quill h1/h2/h3`, `.quill br`) — keine Datei setzt die Klasse; aber
  siehe 4.1 zur Nebenwirkung auf h2–h4.
- **Tags alt:** `tag-input-container`, `tags-input`, `container-tags`,
  `tag-dropdown-menu`, `tag-group-label`, `availableTags`,
  `availableTagsCard`, `availableTagsCardInputs` (`availableTags` ist nur
  noch ein Store-Name).
- **Playbook/Incoming:** `pb-thumbnail`, `pb-thumbnail-wrap`,
  `pb-fullscreen-close`, `eval-position-info`, `incoming-eval-section`,
  `trade-chat-section`.
- **Bibliotheken entfernt:** `shepherd-modal-overlay-container`,
  `shepherd-modal-is-visible`, `shepherd-button`, `exitButton`,
  `bs-stepper-circle`.
- **Variablen:** `--ghost-grey`, `--dark-grey`, `--black`,
  `--font-size-secondary`; `--font-size-main` und `--transition-fast` nur
  intern.

Ausserdem: **`src/assets/base.css` komplett** (Abschnitt 1).

Umfang grob: von ~297 in style-dark.css vorkommenden Klassennamen sind rund
100 tot oder nur in toten Kombinationen benutzt.

---

## 8. Hinweise für die Ablösung

1. Reihenfolge: Erst die Gruppen aus Abschnitt 5 (geteiltes Chrom) in eine
   eigene, tokenbasierte globale Datei oder in die gemeinsamen Komponenten
   (`RadarKachel`, `RadarOverlay`, `useKachelRaster`-Seiten, Live-Kopfzeile)
   ziehen — die werden am breitesten benutzt.
2. Die alten Variablen (Abschnitt 3) können als dünne Brücke bestehen bleiben,
   bis die ~65 Dateien mit `--white-87`, ~54 mit `--white-60`, ~49 mit
   `--blue-color` usw. umgestellt sind. Die Brücke gehört dann in eine eigene
   kleine Datei, nicht mehr in style-dark.css.
3. Bootstrap-Anpassungen (Abschnitt 4.2) entfallen erst mit Bootstrap
   selbst; bis dahin genügt der tokenbasierte Teil aus rahmen.css plus die
   Punkte, die nur style-dark.css regelt: deaktivierte Auswahlfelder nicht
   hell, Tabellenzellen dunkel, `table-responsive`-Scrollen,
   Handy-Mindesthöhen, `dropdown`-Knopf-als-Auswahlfeld, Popover/Tooltip.
4. Bewusst zu entscheiden statt still zu verlieren: vergrösserte
   Grundschrift am `body`; globaler Oberabstand an h2–h4; hellblauer
   Hintergrund an `.tags`.
5. Klassen, die fremder Code zur Laufzeit setzt (`tj-censor`, `privacy-on`,
   `toggleSideMenu`, `ql-*`, `popover`, `tooltip-inner` mit
   `tooltipLargeLeft`, `dot-<status>`, `imGriff`, `wirdGezogen`,
   `radarGhost`) müssen weiter eine Regel haben, auch wenn sie im Template
   nicht stehen.
