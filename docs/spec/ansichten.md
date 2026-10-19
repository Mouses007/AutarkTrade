# Spezifikation Journal-Ansichten (S8, Clean-Room)

Stand: 19.10.2026. Drei Beschreibungs-Agenten (Schritt 1) haben das Verhalten der
aus dem Ursprungsprojekt stammenden Ansichten (HERKUNFT.md) aus dem Code beschrieben; diese Datei ist die
EINZIGE Quelle für den Neubau (Schritt 2). Die Altdateien sind gelöscht und dürfen
nicht gelesen werden (auch nicht über `git show`/`git log -p`).

Ersetzt werden: `src/views/Daily.vue`, `Dashboard.vue`, `AddExcursions.vue`,
`Calendar.vue`, `Screenshots.vue`, `AddTrades.vue`, `Playbook.vue`, `Auswertung.vue`,
`src/components/Calendar.vue`, `Screenshot.vue`, `TradeEvalPopup.vue`,
`src/utils/screenshots.js` (gleiche Pfade, gleiche Export-Namen — Router, Layout und
Journal-Kern importieren sie). Eigener Code, der nur neu gestaltet wird (darf gelesen
werden): `components/BotDashboard.vue`, `ShareCardModal.vue`, `NoData.vue`,
`rahmen/ScreenshotVollbild.vue`.

## 0. Entscheidungen des Leitstands (gehen den Empfehlungen in den Teilen vor)

Grundsatz: **Funktionen und Daten bleiben gleich.** Altfehler, die Daten falsch
schreiben, zerstören oder die Ansicht hängen lassen, werden behoben; reine
Rechenregeln (Brutto/Netto, Break-even-Zählung, Duplikatprüfung des Imports) bleiben
wie beschrieben, weil der Golden Master und gespeicherte Daten daran hängen. Tote
Teile werden nicht nachgebaut.

Gestaltung: nur Gestaltungssystem — Token aus `src/assets/design/tokens.css`,
Bausteine aus `src/components/basis/` (`Knopf`, `Karte`, `Pille`, `Reiter`, `Tabelle`,
`Eingabe`, `Dialog`, `Seitenkopf`, `Hinweis`, `Leerzustand`, `Kreisel`, `Symbol`),
Hilfsklassen aus `src/assets/design/hilfen.css` und `basis.css` (`at-feld`, `at-label`,
`at-check`, `at-tabelle`, `at-flex` …), `components/InfoTipp.vue` statt Tooltips.
KEIN Bootstrap (keine Klassen wie `row`/`col-*`/`btn`/`modal`/`nav-tabs`/`form-control`,
kein `data-bs-*`, kein `window.bootstrap`), kein Font Awesome (`fa`), keine Unicons
(`uil`). Bootstrap-Modal → `Dialog`, Bootstrap-Tab → `Reiter` bzw. eigener Zustand,
Tooltip → `InfoTipp`/`title`. Telefonbreite 375 px ohne Querscrollen (Tabellen in
einer scrollenden Hülle).

Getroffene Entscheidungen zu offenen Punkten:

| Punkt | Entscheidung |
|---|---|
| D.16-1 Reiter der Tageskarten | je Karte unabhängig; Startreiter wie beschrieben, aber für jede Karte |
| D.16-2 Auto-MFE | nur anzeigen; gespeichert wird erst über „Speichern“ |
| D.16-3 Kerzenintervall | fest 15m (wie heute wirksam) |
| D.16-4 Kerzenfenster | ±6 h bleibt; Anfrage mit `market=futures` (Futures-Symbole ohne Spot-Markt) |
| D.16-5 Databento/Polygon in Daily | streichen |
| D.16-6 Tagesdiagramme je Karte | nicht zurückbringen (Aufrufe in `ablauf.js` bleiben unangetastet) |
| D.16-7 Screenshot im Detailfenster | Vorschau und Vollbild bleiben, toter Upload/Markierungsweg entfällt |
| D.16-8 Orderbuch-Sprung | per Router |
| Schliessen des Detailfensters | ein einziger Schliessweg (×, Esc, Knopf), der ungespeicherte Änderungen speichert; Kerzenchart bei jedem Öffnen frisch |
| MFE-Eingabe | speichert unter der ID des offenen Trades |
| Tag-Fenster in Daily (tot) | nicht nachbauen |
| A-S1 annotatedBase64 | eingebranntes Gesamtbild (Original + Markierung), `markersOnly` = 0; Altzeilen mit `markersOnly` = 1 zeigt die Karte weiter als Original + Ebene |
| A-S2 Umbenennen beim Markieren | `name` bleibt unverändert |
| A-S3, A-S8, A-S9 | beheben (immer auflösen, Zuordnung über `objectId`, `{}`/`null` = leer) |
| A-S5 „Bearbeiten“ | Symbol weglassen |
| A-S6 Typ-Filter | Empfehlung übernehmen |
| A-S10, A-S11 | Paginierung wie heute; Kompressions-Exporte bleiben als harmlose No-ops bzw. funktionierende Verkleinerung über Canvas |
| maState-Format | neues eigenes Format mit Versionsfeld und relativen Koordinaten (0–1); alle 13 markerjs2-Typen werden gelesen und angezeigt; beim Speichern migriert; unbekannte Typen bleiben erhalten |
| Bildmarkierung | eigener Baustein (SVG-Ebene), Werkzeuge Pfeil, Rechteck, Linie, Text, Freihand (Punktliste), Auswahl/Verschieben/Löschen, Farbe, Strichbreite, mehrstufiges Rückgängig; Paket `markerjs2` entfernen |
| A-P1 trendScreenshotId | laden und speichern |
| A-P2 | Hinweis „Trade nicht gefunden“ |
| A-P3 Bild in Quill | Bild-Einfügen in Quill abschalten (Bilder gehören in die Bildfelder) |
| A-P5/A-P6 Bildsuche Playbook | Anzeigen darf die Suchkette benutzen; LÖSCHEN nur über die gespeicherte ID oder exakten Namen |
| A-P7 Abbrechen | Werte im Speicher zurücksetzen; Bild-Upload/-Entfernen dürfen sofort wirken, das sagt ein Hinweistext |
| A-P8 | Bilder ohne Base64 laden, Bild beim Aufklappen holen |
| A-P9 Zufriedenheit 2 | beibehalten wie heute |
| Mini-Kalender | nicht rendern |
| barChartNegative12/14 | nicht rendern |
| TradeEvalPopup nur einmal je Seitenleben | beheben: nach Schliessen darf eine NEUE Bewertung wieder melden |
| AddExcursions hängt | Ansicht muss bei fehlenden Kerzen/Symbolen auflösen und eine Meldung zeigen; `daysBack`/`daysMargin` mit sinnvollen Vorgaben belegen; Module in `utils/journal/` nicht ändern |
| Quill | bleibt (BSD-3, npm, nur in Playbook und Incoming); nur über `import 'quill'` |
| Fest einprogrammierte deutsche Texte | nach i18n (de + en), Namensräume der jeweiligen Ansicht |

---

## Tagesansicht (`src/views/Daily.vue`)

Stand: 19.10.2026. Clean-Room Schritt 1 (Beschreibung) für S8. Verfasst aus dem
Verhalten der heutigen Datei (2255 Zeilen). Diese Beschreibung ist die einzige
Quelle für den Neubau; der bauende Agent liest `Daily.vue` nicht.

Begriffe und Datenformen, die hier nicht wiederholt werden:

- Tageszeile, Trade-Objekt, `pAndL`, `blotter`: `docs/spec/journal-kern.md`
  §2.1, §2.2, §3.5 (Felder wie `dateUnix`, `td`, `trades[]`, `entryTime`,
  `exitTime` in Sekunden, `side` `'B'`/`'SS'`, `strategy` `'long'`/`'short'`,
  `tradesCount`, `openPosition`, `grossSharePL`, `netProceeds` …).
- Diagrammfunktionen: `docs/spec/diagramme.md` (insbesondere §2.3, §2.4, §3.10
  `useCandlestickChart`).
- Interna von `src/utils/screenshots.js`: beschreibt ein anderer Agent; hier
  nur, welche Funktion mit welchen Argumenten und welcher Bedeutung gerufen
  wird.

Kennzeichnung: **[Altfehler]** = heutiges Verhalten, das falsch ist, jeweils mit
Empfehlung „behalten" oder „beheben". **[tot]** = Code ohne Wirkung (nie
erreichbar, nie gerendert, nie gelesen). Für Totes gilt die Grundempfehlung:
nicht nachbauen, sofern nicht anders gesagt.

---

### D.1 Zweck, Route, Einbettung

- Route `/daily`, Routenname/`pageId` `'daily'` (gesetzt vom Router-Helfer
  `seite()` in `src/router/routen.js`, lazy geladen), Layout `Dashboard`
  (Seitenmenü, Kopfleiste, Filterleiste). Menüeintrag in `src/config/menu.js`
  (`id: 'daily'`, Modus `journal`, Gruppe `analyze`, Titel `nav.dailyView`).
- Inhalt: eine Liste von **Tageskarten** (je Tageszeile des gewählten Monats),
  pro Karte Kopf mit Datum, Kennzahlenleiste und zwei Reitern (Trades,
  Blotter). Klick auf eine Trade-Zeile öffnet das **Trade-Detail-Fenster**
  (Kerzenchart, Detailtabelle, Fills/SL/TP-Protokoll, Bot-Aufschlüsselung,
  Tags, MFE, Notiz, Share-Karte, Navigation innerhalb des Tages,
  Screenshot-Vorschau).
- Die Filterleiste (`src/components/journal/FilterLeiste.vue`, nicht Teil
  dieser Ansicht) ruft beim Anwenden auf dieser Seite erneut `starteTagesansicht()`
  und danach `pruefeSichtbarkeit()` (beide `src/utils/journal/ablauf.js`).
  Die Ansicht muss also damit leben, dass sich `journalTage` jederzeit
  komplett neu füllt.
- Von aussen wird die Ansicht über den Store-Wert `scrollToDateUnix`
  angesprungen: `src/components/Calendar.vue` (Klick auf einen Kalendertag mit
  Trades setzt ihn und navigiert bei `pageId === 'calendar'` per Router nach
  `/daily`) und `src/components/chart/TradeKarte.vue` (setzt `gewaehlterMonat`
  auf den Monat des Trades, `selectedMonthPreset` auf `'custom'`, schreibt
  beide nach localStorage, setzt `scrollToDateUnix` auf den Tag und navigiert
  nach `/daily`).
- Der Screenshot-Vollbild-Dialog (`#fullScreenModal`) gehört NICHT zur Ansicht;
  er wird global vom Layout gerendert (`src/components/rahmen/ScreenshotVollbild.vue`).
  Die Ansicht öffnet ihn nur (D.9.10).

---

### D.2 Benutzte Module (Importe, die tatsächlich wirken)

| Modul | Benutzte Exporte | Zweck |
|---|---|---|
| `src/utils/journal/ablauf.js` | `starteTagesansicht`, `bestimmeBereich`, `useDisposeJournalCharts` | Laden der Seite; Zeitraum neu bestimmen nach Exkursion-Speichern; Diagramm-Instanzen beim Verlassen freigeben |
| `src/utils/journal/app.js` | `useInitTooltip`, `useInitTab` | Bootstrap-Tooltips anlegen; Reiter-Klicklogik der Tageskarten (D.5.3) |
| `src/utils/journal/tagebuch.js` | `ladeExkursionen`, `ladeTags`, `ladeVerfuegbareTags`, `speichereVerfuegbareTags`, `speichereTags`, `speichereNotiz`, `ladeNotizen`, `useGetTagInfo`, `baueTagListe`, `useResetTags` | Begleitdaten laden/speichern, Tag-Farben |
| `src/utils/journal/format.js` | `useCreatedDateFormat`, `useTwoDecCurrencyFormat`, `useTimeFormat`, `useTimeDuration`, `useDecimalsArithmetic`, `useDateCalFormat`, `useSwingDuration` | Anzeigeformate (alle in `timeZoneTrade`, Zahlen in de-CH bzw. en-US je `appLanguage`) |
| `src/utils/journal/zeit.js` | Standardexport `dayjs` (mit `tz`) | Zeitzonen-Rechnung |
| `src/utils/journal/diagramme/index.js` | `useCandlestickChart` | Kerzenchart im Detailfenster (statisch importiert) |
| `src/utils/screenshots.js` | `ladeBilder`, `speichereBild`, `useSelectedScreenshotFunction` | Screenshots des Tages laden, geänderten Screenshot speichern, Vollbild auswählen |
| `src/utils/db.js` | `dbFirst`, `dbCreate`, `dbUpdate` | Exkursionen direkt schreiben (und tote Zufriedenheit, D.13) |
| `axios` | `get`, `post` | Kerzen, MFE, Orderbuch-Verfügbarkeit |
| `vue-router` | `useRouter().push` | KI-Bewertung |
| `vue-i18n` | `t` | Texte |
| Komponenten | `SeiteLaedt`, `NoData`, `ShareCardModal` | Ladeanzeige, Leerzustand, Share-Karte |

Importiert, aber **[tot]** (nirgends benutzt): Komponente `Screenshot`; Store-Werte
`spinnerSetupsText`, `listeZuEnde`, `idCurrentType`, `idCurrentNumber`,
`bilderWerdenGeholt`, `gewaehltBruttoNetto`, `kalenderDaten`,
`verfuegbareTagListe`, `zufriedenheitTrades`, `neueTradeTags` (nur über
Hilfsfunktionen indirekt); Funktionen `ladeWeitere`, `pruefeSichtbarkeit`,
`useSetupImageUpload`, `useFindHighestIdNumber`,
`useFindHighestIdNumberTradeTags`, `useFilterTags`, `useToggleTagsDropdown`,
`useDailySatisfactionChange`, `useFilterSuggestions` (nur im toten Tag-Fenster),
`useTradeTagsChange` (nur im toten Tag-Fenster), `useGetMFEPrices`,
`useStartOfDay` (nur in toter Funktion), `useCreateOHLCV` (nur im toten
Databento-Zweig). Leerer `onBeforeMount`-Haken.

---

### D.3 Store-Werte

Alle Werte sind modulweite `ref`/`reactive`-Exporte (kein Pinia). Spalte
„Quelle" nennt die eigentliche Datei unter `src/stores/` (die Ansicht
importiert heute über die Bündel `ui.js`, `filters.js`, `trades.js`,
`settings.js`; der Neubau soll direkt aus `app/*`/`journal/*` importieren).
L = gelesen, S = geschrieben.

| Wert | Quelle | L/S | Verwendung |
|---|---|---|---|
| `seiteLaedt` | `app/laden.js` | L | Hauptinhalt erst bei `false`; Scroll-Watcher wartet darauf |
| `journalHatDaten` | `app/rahmen.js` | L | `false` → Leerzustand |
| `ladeMehr` | `app/laden.js` | L | kleiner Ladekreisel unter der Liste |
| `timeZoneTrade` | `app/rahmen.js` | L | alle Zeitanzeigen, `checkDate`, Fill-Gruppierung, Kerzenfenster |
| `tradeDetailOffen` | `app/rahmen.js` | L/S | Detailfenster-Inhalt sichtbar; blendet Karten-Tabellen aus; Watcher Orderbuch; auch von `Screenshot.vue` gelesen |
| `markierungOffen` | `journal/screenshots.js` | L | Sperre: Annotation offen → Navigation verweigert |
| `setupsLaden` | `app/laden.js` | L/S | Ladeanzeige im Detailfenster, sperrt Vor/Zurück; Startwert im Store `true` |
| `speichernNoetig` | `app/rahmen.js` | L/S | Beschriftung „Schließen & Speichern" vs. „Schließen" |
| `scrollToDateUnix` | `app/rahmen.js` | L/S | Sprungziel (D.6) |
| `currentUser` | `app/rahmen.js` | L | `aiEnabled` (KI-/Share-Knöpfe), `enableBinanceChart` (Kerzenchart) |
| `apis` | `app/einstellungen.js` | L | Liste `{provider, key}`; Databento/Polygon-Schlüssel (D.10) |
| `betragArt` | `journal/filter.js` | L | `'gross'`/`'net'`, nur für Blotter-Farbe |
| `gewaehlterTagIndex` | `journal/filter.js` | S | totes Tag-Fenster |
| `filteredSuggestions` | `journal/filter.js` | S | totes Tag-Fenster |
| `journalTage` | `journal/auswertung.js` | L (S indirekt) | Liste der Tageskarten; das Trade-Objekt bekommt `_tradingMeta` angehängt (D.10.5) |
| `screenshots` | `journal/screenshots.js` | L | volle Screenshots des Tages |
| `bildInfos` | `journal/screenshots.js` | L | Screenshot-Metadaten des Monats (Bild-Symbol in Trade-Zeile) |
| `screenshot` | `journal/screenshots.js` | S | aktueller Screenshot im Detailfenster (in place geleert/gefüllt) |
| `tradeBildGeaendert` | `journal/tagebuch.js` | L/S | Speichern beim Wechseln/Schliessen |
| `excursion` | `journal/tagebuch.js` | L/S | `{stopLoss, maePrice, mfePrice}` des offenen Trades |
| `excursions` | `journal/tagebuch.js` | L | DB-Zeilen der Exkursionen |
| `tradeExkursionGeaendert`, `tradeExcursionId`, `tradeExcursionDateUnix` | `journal/tagebuch.js` | L/S | Speicher-Kontext Exkursion |
| `tradeId` | `journal/import.js` | S | nach Neuanlage einer Exkursion auf deren Trade-ID gesetzt (sonst ungelesen in dieser Ansicht) |
| `offenerTagIndex`, `tradeIndexAktiv`, `tradeIndexVorher` | `journal/tagebuch.js` | L/S | Position des offenen Trades: Index der Tageskarte in `journalTage`, Index in `trades[]`; `tradeIndexVorher` wird nur geschrieben |
| `tags` | `journal/tagebuch.js` | L | Zuordnungen `{tradeId, tags[], dateUnix}` |
| `verfuegbareTags` | `journal/tagebuch.js` | L | Katalog `[{id, name, color, tags:[{id,name}]}]` |
| `tradeTags` | `journal/tagebuch.js` | L/S | Tags des offenen Trades `[{id, name}]` |
| `tradeTagsGeaendert`, `tradeTagsId`, `tradeTagsDateUnix` | `journal/tagebuch.js` | L/S | Speicher-Kontext Tags |
| `tagInput`, `showTagsList` | `journal/tagebuch.js` | S | Eingabe/Liste (im Detailfenster nur zurückgesetzt) |
| `notes` | `journal/tagebuch.js` | L | `{tradeId, note, dateUnix, tradingMetadata, tradeType, closingTradeType}` |
| `tradeNotiz`, `tradeNotizGeaendert`, `tradeNoteId`, `tradeNoteDateUnix` | `journal/tagebuch.js` | L/S | Notiz des offenen Trades (nur Anzeige, D.9.8) |
| `zufriedenheitTage` | `journal/tagebuch.js` | L | nur in einem Konsolen-Log |

Lokaler Zustand der Ansicht (kein Store): Share-Karte offen + Trade-Objekt
(D.12); Bootstrap-Instanzen der beiden Modals und Flag „Tag-Fenster offen";
`tradingMeta` (Metadaten des offenen Trades oder `null`); `tradeTypeRef`,
`closingTradeTypeRef` (Zeichenketten); Menge der aufgeklappten Fill-Gruppen;
Liste zugeklappter Protokolle; Kerzen-Cache (D.10.4); Liste `ohlcv` **[tot]**
(nur befüllt, nie gelesen); `replayVerfuegbar`, `replayGeprueft` (D.11);
`candlestickChartFailureMessage` (Text oder `null`); `boersenIndex` (Start −1),
`apiKey`, `apiSource` (`'binance'`/`'databento'`/`'polygon'`); zwei
Modul-Flags „Screenshots dieses Fensters schon geladen" (Start falsch) und
„Kerzenchart beim nächsten Zeichnen neu anlegen" (Start wahr).

localStorage: Die Ansicht selbst liest/schreibt keinen Schlüssel. Indirekt:
`appLanguage` (Zahlenformat in `format.js`); `gewaehlterMonat`/`selectedMonthPreset`
werden von Filterleiste/TradeKarte geschrieben und über `bestimmeBereich`
gelesen.

---

### D.4 Lebenszyklus und Laden

#### D.4.1 Beim Einhängen (onMounted), streng in dieser Reihenfolge

1. `await starteTagesansicht()` — setzt `tagesSeite` 0, `tagesAbfrageGrenze` 3,
   `listeZuEnde` falsch, Spinner an; `bestimmeBereich()` (auf dieser Seite:
   `gewaehlterBereich = gewaehlterMonat`); parallel `ladeExkursionen`,
   `ladeZufriedenheit`, `ladeTags` (auf `daily` auf den Zeitraum
   begrenzt), `ladeVerfuegbareTags`, `ladeNotizen` (Zeitraum), `ladeApis`
   (füllt `apis` aus den Einstellungen); dann `filtereTrades()` (füllt
   `journalTage` mit ALLEN gefilterten Tagen des Zeitraums, absteigend nach
   `dateUnix`, hängt `pAndL`/`blotter` an); Spinner aus; `useInitTab('daily')`;
   im Hintergrund (nicht abgewartet) Diagramm-Modul laden und
   `zeichneDoppellinie()` + `zeichneTorte()`; `ladeKalender()`;
   `ladeBilder(true)` (ohne Datum: lädt `bildInfos` des Monats,
   nur Metadaten); `useInitPopover()`. Ein jüngerer Mount-Lauf bricht einen
   älteren still ab.
2. `await useInitTooltip()` — legt für jedes Element mit Tooltip-Kennzeichnung
   eine Bootstrap-Tooltip-Instanz an.
3. `baueTagListe()` — flache Tag-Liste.
4. Wenn `scrollToDateUnix` gesetzt: einen Render-Takt warten, dann Sprung (D.6).
5. Einen Render-Takt warten.
6. Bootstrap prüfen: ist das globale `bootstrap` oder dessen `Modal` nicht
   vorhanden → Konsolen-Warnung und Abbruch (Modals bleiben funktionslos).
7. Elemente `tradesModal` und `tagsModal` suchen; fehlt eines → Warnung,
   Abbruch. (Beide stehen heute ausserhalb jeder Bedingung im Template und
   existieren immer; der Kommentar dazu ist veraltet.)
8. Bootstrap-Modal-Instanz für das Detailfenster anlegen; Ereignis
   „fertig eingeblendet" (`shown.bs.modal`): aus dem auslösenden Element
   (`relatedTarget`, die angeklickte Trade-Zeile) die Datenattribute
   „Karten-Index" und „Trade-Index" lesen (Zeichenketten) und
   `clickTradesModal(karte, trade, trade)` rufen (D.9.1).
9. Bootstrap-Modal-Instanz für das Tag-Fenster anlegen, mit Ereignissen
   eingeblendet/ausgeblendet (D.13.2, **[tot]**).

#### D.4.2 Beim Aushängen

`onBeforeUnmount` → `useDisposeJournalCharts()`: gibt ECharts-Instanzen an
allen Knoten mit `.chartClass`, `.chartIdCardClass` und `#candlestickChart`
frei, solange sie noch im Dokument hängen (nichts, wenn das Diagramm-Modul nie
geladen wurde). Der Neubau muss den Kerzenchart beim Verlassen freigeben.

#### D.4.3 Watcher

| Quelle | Bedingung | Wirkung |
|---|---|---|
| `scrollToDateUnix` | neuer Wert truthy UND `seiteLaedt` falsch (sonst übernimmt onMounted) | Render-Takt warten, Sprung (D.6) |
| `[tradeDetailOffen, tradeIndexAktiv]` | Fenster offen | Orderbuch-Verfügbarkeit prüfen (D.11) |

Berechnete Werte: `modalTradeObj` und `modalTrade` (beide: der Trade
`journalTage[offenerTagIndex].trades[tradeIndexAktiv]` oder `null`; doppelt
vorhanden, einer genügt), `botBreakdown` (D.9.6), `replayFenster` (D.11).

---

### D.5 Tageskarten

#### D.5.1 Seitenzustände

- Ladekreisel der Seite (`SeiteLaedt`) immer eingebunden.
- Hauptinhalt nur, wenn `seiteLaedt` falsch.
- `journalHatDaten` falsch → Leerzustand `NoData`; wahr → Kartenliste. (Weil `journalHatDaten`
  nach journal-kern §7.9 nie zurück auf falsch geht, zeigt ein Filter ohne
  Treffer nach vorherigem Erfolg eine leere Liste statt des Leerzustands —
  **[Altfehler]** des Kerns; Empfehlung: in der Ansicht zusätzlich
  „`journalTage` leer → Leerzustand" zeigen.)
- Unter der Liste: kleiner Ladekreisel, solange `ladeMehr` wahr.

#### D.5.2 Eine Karte je Element von `journalTage`

Reihenfolge = Reihenfolge der Liste (absteigend nach Tag). Jede Karte trägt die
DOM-ID `daily-card-<dateUnix>` (Sprungziel). Zwei Tageszeilen desselben Tages
(zwei Börsen) ergeben zwei Karten mit gleicher ID — der Sprung trifft die erste.

1. **Kopf**: Datum über `useCreatedDateFormat(dateUnix)` (Wochentag-Kurzform,
   Tag zweistellig, Monatsname, Jahr; in `timeZoneTrade`). Keine Tags, keine
   Zufriedenheit (beide wurden entfernt).
2. **Kennzahlenleiste** aus `pAndL` der Karte:
   Trades (`trades`), Wins (`grossWinsCount`, grün), Losses (`grossLossCount`,
   rot), Fees (`fees`, Währung 2 Stellen), PnL(g) (`grossProceeds`, Währung,
   grün bei ≥ 0, sonst rot). Beschriftungen fest englisch
   („Trades", „Wins", „Losses", „Fees", „PnL(g)").
   Fehlt `pAndL` (journal-kern §7.2: bei zwei Zeilen am selben Tag bekommt nur
   die letzte Kopie `pAndL`): statt der Leiste ein gedämpfter Hinweis mit
   Warnsymbol, sinngemäss „Kennzahlen nicht berechnet — vermutlich zwei
   Datenbankzeilen für diesen Tag" (heute fest deutsch, nicht i18n). Bewusst
   KEINE Null anzeigen. Empfehlung: Text nach i18n verschieben, Verhalten
   behalten.
3. **Reiterbereich** (nur solange `tradeDetailOffen` falsch — während das
   Detailfenster offen ist, werden die Tabellen ALLER Karten aus dem DOM
   entfernt; Grund laut Altkommentar: Indizes in `journalTage` sollen sich
   bei offenem Fenster nicht verschieben). Zwei Reiter „Trades" und „Blotter"
   (fest englisch). Der frühere Reiter „Screenshots" ist entfernt.

#### D.5.3 Reiter-Verhalten (Bootstrap Tab + `useInitTab('daily')`)

- Knöpfe tragen die IDs `trades-<kartenIndex>` und `blotter-<kartenIndex>`,
  Inhaltsflächen `tradesNav-<kartenIndex>` und `blotterNav-<kartenIndex>`;
  jede Karte hat einen Reitercontainer mit derselben ID `nav-tab` (doppelte
  IDs; `useInitTab` sucht alle Knöpfe unter `#nav-tab`).
- Startzustand: Nur in der **ersten** Karte (Index 0) ist „Trades" aktiv und
  sichtbar. In allen anderen Karten ist zunächst KEIN Reiter aktiv und keine
  Tabelle sichtbar — man sieht nur Kopf und Kennzahlenleiste.
- Umschalten macht Bootstrap Tab (Datenattribute). Zusätzlich hängt
  `useInitTab('daily')` an jeden Knopf einen Klick-Handler, der seitenweit den
  zuletzt geklickten Reiter merkt (`idCurrent`/`idPrevious`, als Typ/Nummer
  auch in `idCurrentType`/`idCurrentNumber` usw.):
  - erster Klick überhaupt: nur merken („offen");
  - erneuter Klick auf denselben Knopf: Inhaltsfläche und Knopf auf-/zuklappen
    (Umschalter);
  - Klick auf einen anderen Knopf (auch in einer anderen Karte): die vorher
    geklickte Inhaltsfläche und ihr Knopf werden deaktiviert.
  Folge: nach dem ersten Klick ist seitenweit höchstens EIN per Klick
  geöffneter Reiter sichtbar (Akkordeon über alle Karten), plus ggf. der
  Start-Reiter von Karte 0, solange der erste Klick in einer anderen Karte war.
  Für Reiter-Typ `screenshots` würde zusätzlich `ladeBilder(true, tag)`
  geladen — dieser Reiter existiert nicht mehr **[tot]**.
- `useInitTab('daily')` wird gerufen in `starteTagesansicht`, in `ladeWeitere` und
  beim Schliessen des Detailfensters über „Schließen". Weil die Knöpfe beim
  Schliessen neu entstehen (D.5.2 Punkt 3), ist das nötig.
  **[Altfehler]** Schliessen über das ×-Symbol ruft `useInitTab` NICHT → danach
  fehlt der Umschalter (Bootstrap-Tab funktioniert weiter). `ladeWeitere` hängt
  an bestehende Knöpfe einen zweiten Handler → Umschalter toggelt doppelt.
  Empfehlung: beheben — Reiterzustand je Karte deklarativ in der Komponente
  halten (z. B. `offenerReiter[kartenIndex]`), keine DOM-Handler. Ob das
  seitenweite Akkordeon gewollt ist, ist offen (D.16); Vorschlag: jede Karte
  unabhängig, Karte 0 startet mit „Trades", andere Karten zugeklappt (wie heute
  sichtbar), erneuter Klick klappt zu.

#### D.5.4 Reiter „Trades“ (Tabelle je Trade von `trades[]`)

Spalten (Kopf): „Symbol", leer, „Vol" mit Info-Tooltip `daily.volTooltip`,
„Position", `daily.entry`, „PnL/Stk" mit Info-Tooltip
`daily.pnlPerUnitTooltip`, „PnL(n)", leer, leer.

Zeilen (je Trade, Klick auf die ganze Zeile öffnet das Detailfenster über
Bootstrap-Modal-Datenattribute; Zeile trägt Karten-Index und Trade-Index als
Datenattribute):

1. Symbol.
2. Nur wenn `currentUser.aiEnabled` weder `false` noch `0` ist: Zelle mit zwei
   Knöpfen; Klicks in dieser Zelle öffnen das Detailfenster NICHT
   (Ereignis-Weitergabe gestoppt):
   - „KI-Bewertung" (`daily.aiReview`, Hirn-Symbol): setzt
     `offenerTagIndex` = Karten-Index, `tradeIndexAktiv` = Trade-Index, dann D.12.1.
   - Share-Symbol-Knopf: D.12.2 mit (Karten-Index, Trade-Index).
   Ist die KI aus, fehlt die Zelle ganz (Kopf behält trotzdem 9 Spalten —
   **[Altfehler]** kosmetisch, beheben).
3. Vol: `buyQuantity + sellQuantity` (einfache Addition).
4. Position: `strategy` mit grossem Anfangsbuchstaben („Long"/„Short").
5. Einstieg:
   - `tradesCount == 0`: bei `openPosition` „Offen" (`daily.open`) mit Tooltip
     `daily.swingOpenedOn` {date = `useDateCalFormat(entryTime)`}, sonst
     „Geschlossen" (`daily.closed`) mit Tooltip `daily.swingClosedOn`
     {date = `useDateCalFormat(exitTime)`}.
   - sonst `useTimeFormat(entryTime)` (HH:mm:ss); liegt der Einstieg an einem
     anderen Kalendertag als `td` (D.8 `checkDate`), zusätzlich Info-Symbol mit
     Tooltip `daily.swingFrom` {date = Einstiegsdatum}.
   Tooltips sind HTML-fähig gekennzeichnet.
6. PnL/Stk: leer bei `tradesCount == 0`; „-" bei `type == 'forex'`; sonst
   `grossSharePL` als Währung, grün bei ≥ 0.
7. PnL(n): leer bei `tradesCount == 0`; sonst `netProceeds` als Währung, grün
   bei ≥ 0. (Immer netto, unabhängig von `betragArt`.)
8. Bild-Symbol, wenn in `bildInfos` ein Eintrag mit `name == trade.id`
   existiert (Screenshots, die nur über den Tag zugeordnet sind, zeigen hier
   kein Symbol).

#### D.5.5 Reiter „Blotter“ (Tabelle je Symbol aus `blotter` der Karte)

Tabelle hat die ID `table<kartenIndex>`. Spalten (fest englisch): Symbol, Vol,
PnL(g), Total Fees, PnL(n), Wins, Losses, Trades, Executions. Iteriert über die
Werte des Objekts `blotter` (Schlüsselreihenfolge = Einfügereihenfolge).

- Vol: `useDecimalsArithmetic(buyQuantity, sellQuantity)`.
- PnL(g): `grossProceeds`, Währung, grün bei ≥ 0.
- Total Fees: `fees`, Währung.
- PnL(n): angezeigt wird `netProceeds`, die **Farbe** aber nach
  `<betragArt>Proceeds` > 0 (strikt). **[Altfehler]**: Bei `betragArt` gross
  kann eine positive Netto-Zahl rot sein, und 0 ist rot. Empfehlung: beheben
  (Farbe nach dem angezeigten Wert, ≥ 0 grün).
- Wins `grossWinsCount`, Losses `grossLossCount`, Trades `trades`,
  Executions `executions`.
- Fehlt `blotter` (gleicher Fall wie fehlendes `pAndL`) → leere Tabelle.

---

### D.6 Sprung zu einem Tag (`scrollToDateUnix`)

Funktion „zur Karte scrollen" (Tag in Sekunden):

- Element `daily-card-<tag>` suchen; gefunden → sanft scrollen, Oberkante
  bündig, dann `scrollToDateUnix` = `null`.
- nicht gefunden → bis zu 5 weitere Versuche im Abstand von 100 ms; danach
  aufgeben und `scrollToDateUnix` = `null`.

Ausgelöst einmal nach dem Laden (D.4.1 Punkt 4) und durch den Watcher (D.4.3).
Weil alle Tage des Monats sofort gerendert werden (D.7), reicht das.

---

### D.7 „Mehr laden“ / Endlos-Scroll

Ist-Zustand:

- Die Ansicht hat KEINEN Scroll-Listener. `filtereTrades` füllt
  `journalTage` bereits mit allen Tagen des Zeitraums.
- `pruefeSichtbarkeit()` (von der Filterleiste nach dem Mount gerufen) ruft
  `ladeWeitere()`, wenn die Seite nicht höher als das Fenster ist. Auf `daily`
  hängt `ladeWeitere` per `ladeNaechsteTage()` die nächsten
  `tagesAbfrageGrenze` (3) Tage aus `gefilterteTageAlle` an `journalTage` an,
  sofern deren `dateUnix` noch fehlt — sie sind aber schon alle drin; ab
  Listenende wird `listeZuEnde` wahr. Danach Tagesdiagramme neu, `useInitTab`.
  `ladeMehr` ist währenddessen wahr.
- Ergebnis: Paginierung ist faktisch **[tot]**; sichtbar ist nur ein kurzer
  Ladekreisel.

Empfehlung: Paginierung nicht nachbauen; alle Tage des gewählten Monats auf
einmal rendern (wie heute sichtbar). `ladeWeitere`/`pruefeSichtbarkeit`
gehören zu `ablauf.js` und bleiben dort für die Screenshot-Seite. Falls bei
grossen Monaten Leistung fehlt: echtes Nachladen per IntersectionObserver auf
einem Sentinel unter der Liste (eigene Entscheidung im Neubau).

---

### D.8 Hilfsfunktionen der Ansicht (Verhalten)

- **`checkDate(td, zeit)`**: wahr, wenn `td` und `zeit` (beide Sekunden) in
  `timeZoneTrade` am selben Kalendertag liegen. „Falsch" bedeutet Swing-Trade.
- **Notiz-Text**: HTML-Tags entfernen (alles zwischen spitzen Klammern),
  trimmen; leer/fehlend → ''.
- **Trade-Typ-Label**: Werte `scalp` → `incoming.scalptrade`, `day` →
  `incoming.daytrade`, `swing` → `incoming.swingtrade`; unbekannter Wert wird
  roh angezeigt.
- **Bot-Münze**: kein Trade → `USDT`. Ist `coinM` gesetzt oder `marginCoin`
  vorhanden und nicht `USDT`: `marginCoin`, sonst Symbol ohne „USDT"
  (Gross/Klein egal), sonst `USDT`. Sonst: beginnt das Symbol (gross) mit
  `USDT` und ist länger als 4 Zeichen → Rest nach `USDT` (invertiertes Symbol,
  z. B. USDTSOL → SOL); sonst `USDT`.
- **Bot-Betrag**: Zahl = `parseFloat(wert || 0)`. Münze `USDT` →
  `useTwoDecCurrencyFormat` (Dollarformat). Sonst Vorzeichen „+" bei ≥ 0,
  Zahl mit 4 Nachkommastellen, Leerzeichen, Münze.
- **Laufzeit**: Sekunden ganzzahlig; ≤ 0 → „–"; Tage > 0 → „<d>d <h>h";
  Stunden > 0 → „<h>h <m>m"; sonst „<m>m".
- **Hat Metadaten** (für den Metadaten-Block): Metadaten vorhanden UND
  (mindestens ein Fill ODER `sl` nicht null/undefined ODER `tp` nicht
  null/undefined ODER `positionSize` truthy ODER mindestens ein
  `tpslHistory`-Eintrag ODER `rrr` truthy).
- **Gefiltertes SL/TP-Protokoll**: keine Historie → leer; keine Fills → ganze
  Historie; sonst letzter Fill-Zeitpunkt = Maximum der `time` (ms, als Ganzzahl)
  aller Fills; ist der 0 → ganze Historie; sonst nur Einträge mit
  `time` ≤ letzter Fill + 60 000 ms (Artefakte des Pollings nach Positionsende
  fallen weg). Dieselbe Regel nutzt `useCandlestickChart` intern.
- **Einstiegs-Fills**: alle Fills ohne `reduceOnly` (der Parameter „Seite" wird
  ignoriert). Keine Liste → leer.
- **Ø Einstiegspreis**: mengengewichtet über die Einstiegs-Fills
  (Σ qty·price / Σ qty), 0 wenn keine oder Σ qty = 0.
- **Fill-Zeit**: ms → `DD.MM. HH:mm` in `timeZoneTrade`.
- **Fill-Typ** (für Abzeichen; Argumente: Fill, Index in der Gesamtliste,
  Gesamtliste):
  - `reduceOnly`: „close", wenn Σ qty aller `reduceOnly`-Fills ≥ Σ qty aller
    Einstiegs-Fills, sonst „partialClose". **[Altfehler]**: Die Entscheidung
    hängt nicht vom einzelnen Fill ab — ist die Position am Ende ganz
    geschlossen, heissen auch frühere Teilschliessungen „Schließung".
    Empfehlung: beheben (laufende Summe bis einschliesslich dieses Fills),
    oder bewusst behalten, wenn keine Vergleichsdaten das erfordern (keine
    Golden-Master-Bindung).
  - sonst „initial", wenn Index 0 oder alle vorherigen Fills `reduceOnly` sind;
    sonst „compound".
- **Fills nach Minute gruppieren**: in Listenreihenfolge; Schlüssel =
  Minute (`YYYY-MM-DD HH:mm` in `timeZoneTrade`) + Richtung (`reduceOnly` ja/nein).
  Nur **aufeinanderfolgende** Fills mit gleichem Schlüssel bilden eine Gruppe
  (gleicher Schlüssel später erneut → neue Gruppe mit gleichem Schlüssel).
  Je Gruppe: Fills, Zeit des ersten Fills, Richtung, Σ qty, Ø Preis
  (Σ qty·price / Σ qty, sonst 0), Σ Wert (qty·price), Σ Gebühr (`fee`, fehlend
  = 0), „ist Gruppe" (mehr als ein Fill), Index des ersten Fills in der
  Gesamtliste. Zahlen über `parseFloat`, fehlend = 0.

---

### D.9 Trade-Detailfenster

#### D.9.1 Öffnen, Blättern, Schliessen: `clickTradesModal(karte, alt, neu)`

Drei Argumente: Karten-Index in `journalTage`; bisheriger Trade-Index;
neuer Trade-Index. Beim Öffnen sind 2. und 3. gleich, beim Blättern ist der
3. um ±1 verschoben, beim Schliessen fehlen alle drei.

Öffnen geschieht heute so: Die Trade-Zeile öffnet per Bootstrap-Datenattribut
das Bootstrap-Modal `tradesModal` (statischer Hintergrund: Klick daneben
schliesst nicht; Tastatur aus: Escape schliesst nicht; Grösse „xl"). Erst nach
dem Einblend-Ereignis wird `clickTradesModal` mit den Zeilen-Indizes gerufen.
Der Inhalt des Fensters steht hinter `tradeDetailOffen` und erscheint erst,
wenn dieser Wert wahr wird.

Ablauf:

1. Ist `markierungOffen` wahr → Browser-`alert` mit `common.screenshotSaveAnnotation`,
   sonst nichts.
2. `setupsLaden` = wahr.
3. **Ausstehendes speichern** (immer zuerst, für den bisher offenen Trade):
   - `tradeNotizGeaendert` → `await speichereNotiz()`, dann `await ladeNotizen()`.
   - `tradeExkursionGeaendert` → Exkursion speichern (D.9.9).
   - `tradeTagsGeaendert` → parallel `speichereVerfuegbareTags()` und
     `speichereTags()`, dann parallel `ladeTags()` und
     `ladeVerfuegbareTags()`, dann `baueTagListe()`.
   - `tradeBildGeaendert` → `await speichereBild()`.
   Danach alle vier Flags auf falsch, `showTagsList` = ''.
4. **Schliessen** (keine Argumente): `setupsLaden` falsch; `offenerTagIndex`,
   `tradeIndexVorher`, `tradeIndexAktiv` = `undefined`; Flags nochmals falsch;
   `showTagsList` ''; Bootstrap-Modal ausblenden; `tradeDetailOffen` falsch;
   `useInitTab('daily')`; Flag „Screenshots geladen" falsch; Flag „Kerzenchart
   neu anlegen" wahr. Ende.
5. **Öffnen/Blättern**: `offenerTagIndex` = Zahl(karte), `tradeIndexVorher`
   = Zahl(alt), `tradeIndexAktiv` = Zahl(neu).
6. Kerzenquelle bestimmen (D.10.1).
7. `tradeDetailOffen` = wahr.
8. Screenshots des Tages (nur einmal je Fenster-Sitzung, Flag): Tag =
   `dateUnix` der Karte. Ist `screenshots` leer oder gehört sein erstes
   Element (`dateUnixDay`) zu einem anderen Tag → `await ladeBilder(true, tag)`
   (lädt die vollen Screenshots genau dieses Tages nach `screenshots`, ersetzt
   den Inhalt). Flag setzen.
9. Trade-ID = `id` des neuen Trades. Parallel: Exkursion zurücksetzen
   (alle Schlüssel von `excursion` löschen, dann `stopLoss`, `maePrice`,
   `mfePrice` = `null`) und `useResetTags()` (leert `tradeTags`).
10. **Screenshot zuordnen**: zuerst in `screenshots` der mit `name == Trade-ID`,
    sonst der erste mit `dateUnixDay == Tag` (d. h. ein Tages-Screenshot gilt
    für jeden Trade des Tages). Nichts gefunden, aber `bildInfos` hat
    einen Eintrag mit diesem `dateUnixDay` → `await ladeBilder(true,
    dessen dateUnixDay)` und Suche wiederholen. Dann `screenshot` leeren (alle
    Schlüssel löschen) und mit allen Feldern des Fundes füllen; ohne Fund nur
    `side` = `null`, `type` = `null`. Fehlermeldung des Kerzencharts auf `null`.
11. **Kerzenchart** (D.10).
12. **Tags des Trades**: Eintrag in `tags` mit `tradeId == Trade-ID`
    (lose Gleichheit); für jede Tag-ID darin, die noch nicht in `tradeTags`
    ist, im Katalog `verfuegbareTags` (Gruppen der Reihe nach) den ersten Tag mit
    gleicher `id` suchen und `{id, name}` anhängen. Unbekannte IDs fallen weg.
    (Nur Trade-Tags; Tages-Tags mit `tradeId` = Tageszahl werden hier nicht
    gezeigt.)
13. **Notiz und Metadaten**: `tradeNotiz`, `tradingMeta`, `tradeTypeRef`,
    `closingTradeTypeRef` zurücksetzen (`null`, `null`, '', ''). Eintrag in
    `notes` mit `tradeId == Trade-ID`: `tradeNotiz` = Notiz ohne HTML,
    `tradingMeta` = `tradingMetadata` oder `null`, Typen = `tradeType` bzw.
    `closingTradeType` oder ''.
14. **Exkursion**: erster Eintrag in `excursions` mit `tradeId == Trade-ID`:
    je Feld `stopLoss`, `maePrice`, `mfePrice` übernehmen, wenn nicht
    null/undefined. (Heute doppelt ausgeführt plus ein Konsolen-Log von
    `zufriedenheitTage` — beides wirkungslos, nicht nachbauen.)
15. **Auto-MFE**: wenn Quelle `binance` UND `currentUser.enableBinanceChart`
    UND `excursion.mfePrice` falsy → MFE berechnen (D.10.6). Ergebnis nicht
    `null`: `excursion.mfePrice` setzen, `tradeExcursionDateUnix` = Tag,
    `tradeExcursionId` = Trade-ID, `tradeExkursionGeaendert` = wahr,
    `speichernNoetig` = wahr.
16. `setupsLaden` falsch, `tagInput` = '', **`speichernNoetig` = falsch**,
    `useInitTooltip()`.

**[Altfehler] Auto-MFE und Speicherknopf**: Schritt 16 setzt `speichernNoetig` nach
Schritt 15 wieder auf falsch. Der Knopf heisst dann „Schließen", gespeichert
wird beim Schliessen/Blättern trotzdem (Flag bleibt wahr). Damit schreibt
blosses Durchblättern für jeden Trade ohne MFE eine Exkursion in die DB.
Empfehlung: beheben — entweder Auto-MFE sichtbar als Änderung markieren
(Knopf „Schließen & Speichern") oder Auto-MFE nur anzeigen und erst beim
Speichern schreiben. Die Entscheidung, ob still gespeichert werden soll, ist
offen (D.16).

**[Altfehler] Schliessen über ×**: Das ×-Symbol oben rechts blendet nur das
Modal aus und setzt `tradeDetailOffen` falsch. Es speichert nichts (die
Flags bleiben gesetzt und werden beim nächsten Öffnen eines Trades für den
alten Kontext gespeichert), setzt die Indizes nicht zurück, ruft
`useInitTab` nicht und setzt die Flags „Screenshots geladen" (bleibt wahr →
beim nächsten Öffnen eines anderen Tages werden nicht dessen volle Screenshots
geladen, nur der Umweg über `bildInfos` in Schritt 10 greift) und
„Kerzenchart neu anlegen" (bleibt falsch) nicht zurück. Weil der
Chart-Container beim Ausblenden aus dem DOM fällt, zeichnet der nächste
Aufruf vermutlich in eine abgehängte Instanz (leerer Chart; nicht im Browser
verifiziert). Empfehlung: beheben — EIN Schliessweg (×, Knopf, ggf. Escape),
der immer speichert und zurücksetzt; den Kerzenchart bei jedem Öffnen frisch
anlegen und beim Schliessen freigeben.

#### D.9.2 Aufbau des Fensters (von oben nach unten)

1. ×-Knopf oben rechts (D.9.1 Altfehler).
2. Kerzenchart-Fläche, Element-ID **`candlestickChart`** (diese ID ist
   Vorgabe von `useCandlestickChart` und steht im Selektor von
   `useDisposeJournalCharts`; behalten). Sichtbar, wenn keine Fehlermeldung
   UND (`currentUser.enableBinanceChart` ODER `boersenIndex` ≠ −1). Darunter,
   wenn gesetzt, die Fehlermeldung als zentrierter Text.
3. Orderbuch-Zeile (D.11).
4. Detailtabelle (D.9.3).
5. Trade-Typ (D.9.4).
6. Metadaten-Block (D.9.5).
7. Bot-Aufschlüsselung (D.9.6).
8. Eingabe-/Infobereich (D.9.7–D.9.10), ausgeblendet während `setupsLaden`;
   stattdessen ein kleiner Ladekreisel.
9. Trennlinie.

#### D.9.3 Detailtabelle (eine Zeile, der offene Trade)

Spalten (Köpfe heute gemischt fest/übersetzt): „Symbol", „Vol", „Position",
`daily.entry`, „Price", „Ausstieg", „Price", „Dauer", „PnL/Vol", „PnL(n)".
Empfehlung: alle Köpfe über i18n.

- Symbol.
- Vol: `buyQuantity + sellQuantity` (einfache Addition).
- Position: `side == 'B'` → „Long", sonst „Short" (hier aus `side`, in der
  Kartenzeile aus `strategy`).
- Einstieg: wie D.5.4 Punkt 5.
- Einstiegspreis: leer bei `tradesCount == 0`; Forex → Zahl mit 5
  Nachkommastellen; sonst `useTwoDecCurrencyFormat(entryPrice)` plus
  Swing-Info-Symbol (Tooltip `daily.swingFrom`) wenn `checkDate` falsch.
- Ausstieg: leer bei `tradesCount == 0`, sonst `useTimeFormat(exitTime)`.
- Ausstiegspreis: wie Einstiegspreis, ohne Swing-Symbol.
- Dauer: leer bei `tradesCount == 0`; Swing (`checkDate` falsch) →
  `useSwingDuration(exitTime − entryTime)` („<n> day"/„<n> days",
  englisch); sonst `useTimeDuration(exitTime − entryTime)` (HH:mm:ss).
- PnL/Vol: leer bei `tradesCount == 0` oder Forex; sonst `grossSharePL` als
  Währung, grün nur bei > 0 (strikt; in der Kartenzeile ≥ 0 — **[Altfehler]**
  uneinheitlich, beheben auf ≥ 0).
- PnL(n): leer bei `tradesCount == 0`; sonst `netProceeds`, grün bei ≥ 0.

**[Altfehler] Preise mit 2 Nachkommastellen**: Krypto-Preise kleiner Coins
(z. B. 0,00001234) erscheinen als „$0.00". Empfehlung: beheben (Preisformat
mit genügend signifikanten Stellen); nicht Golden-Master-gebunden.

#### D.9.4 Trade-Typ

Nur wenn `tradeTypeRef` oder `closingTradeTypeRef` gesetzt. Sind beide gesetzt
und verschieden: Abzeichen Eröffnungs-Typ → Pfeil → Abzeichen Schliess-Typ
(zwei unterschiedliche Hervorhebungen). Sonst ein neutrales Abzeichen mit
`closingTradeTypeRef || tradeTypeRef`. Labels nach D.8.

#### D.9.5 Metadaten-Block (`tradingMeta`, aus `notes.tradingMetadata`)

Nur wenn `tradingMeta` gesetzt und „hat Metadaten" (D.8).

Form der Metadaten (alles optional, Zahlen oft als Zeichenketten):
`fills: [{time (ms), price, qty, fee, reduceOnly}]`, `sl`, `slQty`,
`slAboveBreakeven` (bool), `tp`, `tpQty`, `breakeven`, `rrr`, `margin`,
`leverage`, `positionSize`, `tpslHistory: [{time (ms), type 'SL'|'TP',
action 'set'|'moved'|'triggered'|'removed', oldVal, newVal, qty, rrr}]`.

1. **Kopfzeile**: Titel `incoming.fills`. Bei mehr als einem Einstiegs-Fill
   „(<Anzahl> `incoming.fillEntries`)". Bei mindestens einem Einstiegs-Fill
   rechts „`incoming.fillAvgPrice`: <Ø Einstiegspreis, 5 Nachkommastellen>".
2. **Fill-Tabelle** (nur bei Fills): je Gruppe (D.8) eine Zeile, rot getönt
   bei `reduceOnly`:
   Zeit (mit ▶/▼ als Aufklapp-Anzeiger, wenn Gruppe) · Σ Menge · „×" · Preis
   (Gruppe: Ø Preis 5 Stellen; einzeln: Preis als Zahl) · „=" · Σ Wert
   (2 Stellen) · Abzeichen nach Fill-Typ des ersten Fills der Gruppe
   (`incoming.fillClose` / `incoming.fillPartialClose` / `incoming.fillInitial`
   / `incoming.fillCompound`) plus „(<n>)" bei Gruppen · „`incoming.fillFee`:
   <Σ Gebühr 4 Stellen>".
   Klick auf eine Gruppenzeile klappt sie auf/zu (Menge der Gruppenschlüssel
   im lokalen Zustand). Aufgeklappt folgen gedämpfte Einzelzeilen: Menge ×
   Preis = Wert (2 Stellen), Gebühr 4 Stellen.
   Hinweis: Der Gruppenschlüssel ist nur innerhalb eines Trades eindeutig;
   der Aufklappzustand bleibt beim Blättern bestehen (harmlos; Empfehlung:
   beim Trade-Wechsel leeren).
3. **Summenzeile** (bei mehr als einem Fill): „`incoming.fillTotal`: <Σ Menge
   der Einstiegs-Fills>" und „`incoming.fillFee`: <Σ Gebühr aller Fills,
   4 Stellen>".
4. **Positionsgrösse** (wenn `positionSize`; heute nur innerhalb des
   Fill-Bereichs, also nur sichtbar, wenn Fills existieren — **[Altfehler]**,
   Empfehlung: unabhängig von Fills zeigen): „`incoming.positionSize`:
   <margin 2 Stellen> × <leverage>x = <positionSize 2 Stellen> USDT".
5. **SL/BE/TP-Zeile** (wenn `sl`, `tp` oder `breakeven` truthy):
   „SL: <sl>" (rot; bei `slAboveBreakeven` hellgrün) mit „(<slQty>)";
   „BE: <breakeven, 2 Stellen>" (gedämpft); „TP: <tp>" (orange) mit
   „(<tpQty>)"; rechtsbündig „RRR 1:<rrr>" (violett), wenn `rrr`.
6. **SL/TP-Protokoll** (wenn das gefilterte Protokoll nicht leer ist):
   Überschrift „SL/TP Protokoll" mit Verlauf-Symbol und Auf-/Zu-Pfeil; Klick
   klappt um (lokale Liste zugeklappter Kennungen, feste Kennung `daily`;
   Start: aufgeklappt; bleibt über Trade-Wechsel hinweg erhalten). Je Eintrag:
   Zeit (`DD.MM. HH:mm`, `timeZoneTrade`) · Typ (SL rot bzw. hellgrün bei
   `slAboveBreakeven`; TP orange, ausgelöst grün fett) · je Aktion:
   `set` → „→ <newVal>" (+ „(<qty>)") + Abzeichen „Gesetzt";
   `moved` → <oldVal> durchgestrichen „→ <newVal>" (+ Menge) + Abzeichen
   „Verschoben"; `triggered` → <oldVal> durchgestrichen „→ Ausgelöst ✓" (grün);
   `removed` → <oldVal> durchgestrichen „→ entfernt" · rechtsbündig
   „1:<rrr>" (violett), wenn gesetzt.
   Texte „SL/TP Protokoll", „Gesetzt", „Verschoben", „Ausgelöst", „entfernt"
   sind heute fest deutsch. Empfehlung: neue i18n-Schlüssel (D.14).

#### D.9.6 Bot-Aufschlüsselung (Pionex-Bots)

Nur wenn der offene Trade `botType` hat. Berechnung:

| Grösse | Regel |
|---|---|
| net | `netProceeds`, sonst `netSharePL`, sonst 0 (als Zahl) |
| grid | `gridProfit` oder 0 |
| funding | `fundingFee` oder 0 |
| tradingFee | `tradingFee` oder 0 |
| trend | net − grid − funding (Pionex-Definition, Trading-Gebühr steckt im Trend) |
| hasGrid | `gridProfit` ist nicht `undefined` (alte Trades ohne Nachimport: Grid/Trend ausblenden) |
| coin | Bot-Münze (D.8) |
| pnlUsdt | `pnlUsdt` oder 0 |
| showUsdt | coin ≠ USDT und `pnlUsdt` nicht null/undefined |
| leverage, investment | Zahl oder 0 |
| runtimeSec | `exitTime − entryTime` (ganzzahlig) |

Anzeige: Titel `daily.botPnLBreakdown`; grosse Gesamtzahl net (Bot-Betrag,
grün/rot nach ≥ 0), daneben bei `showUsdt` „(≈ <pnlUsdt als Währung>)", dann
Label `daily.gesamtProfit`. Kacheln: bei `hasGrid` `daily.trendPnl` (trend)
und `daily.gridProfit` (grid), jeweils grün/rot; immer `daily.funding`
(grün/rot) und `daily.tradingFeeLabel` (neutral); `daily.leverage`
(„<n>x", nur wenn truthy); `daily.investment` (Bot-Betrag, nur wenn truthy —
erhält bei Nicht-USDT ein „+"-Vorzeichen, kosmetisch); `daily.runtime`
(Laufzeit, nur wenn > 0). Ohne `hasGrid` gedämpfter Hinweis
`daily.botBreakdownReimport`.

#### D.9.7 Tags (nur Anzeige)

Label „Tags" (fest). Chips je Eintrag in `tradeTags`, Hintergrund =
`useGetTagInfo(tag.id).groupColor` (Farbe der Katalog-Gruppe; unbekannt →
Farbe der ersten Gruppe oder Grau), Text = Name. Keine Tags → „–".
Bearbeiten ist im Detailfenster entfernt; Tags werden in Incoming/Playbook
gepflegt.

#### D.9.8 MFE-Eingabe und Notiz

- **MFE**: Label `daily.mfePrice` mit Info-Symbol, Tooltip `daily.mfeTooltip`
  (heute über `title` + Tooltip-Kennzeichnung). Zahlenfeld, Platzhalter
  „MFE", Wert = `excursion.mfePrice`.
  - Klick ins Feld: `tradeExkursionGeaendert` = wahr, `speichernNoetig` = wahr
    (schon ohne Änderung).
  - Änderung (change-Ereignis): `excursion.mfePrice` = `parseFloat(eingabe)`;
    `tradeExcursionDateUnix` = Tag der Karte; `tradeExcursionId` = ID des
    offenen Trades. (Die Funktion kennt auch `stopLoss` — leer → `null`,
    sonst Zahl — und `maePrice`; beide haben keine Eingabe mehr.)
  - **[Altfehler]**: Nur Klick ohne Änderung setzt das Flag, aber nicht
    `tradeExcursionId` → beim Speichern wird mit einer veralteten ID (vom
    zuletzt geänderten Trade) oder `undefined` gesucht/angelegt; die Werte des
    aktuellen Trades landen dann am falschen Trade bzw. in einer Zeile ohne
    `tradeId`. Empfehlung: beheben — Kontext (`tradeExcursionId`,
    `tradeExcursionDateUnix`) beim Öffnen jedes Trades setzen, Flag nur bei
    echter Änderung.
  - Geleertes Feld ergibt `NaN` (wird als Wert gespeichert). Empfehlung:
    leer → `null`.
- **Notiz** (nur wenn `tradeNotiz` nicht leer): Label `daily.note`, darunter der
  Text ohne HTML, Zeilenumbrüche erhalten, nur lesen.

#### D.9.9 Exkursion speichern

Nur wenn mindestens einer der drei Werte von `excursion` nicht null/undefined
ist: `setupsLaden` wahr; `dbFirst('excursions', {equalTo: {tradeId:
tradeExcursionId}})`. Datensatz: je Feld `stopLoss`, `maePrice`, `mfePrice`
— `null`, wenn null/undefined oder lose gleich '' (Achtung: lose Gleichheit
macht auch 0 zu `null`), sonst der Wert.
- vorhanden → `dbUpdate('excursions', objectId, datensatz)`;
- sonst → `dateUnix` = `tradeExcursionDateUnix`, `tradeId` =
  `tradeExcursionId` ergänzen, `dbCreate('excursions', …)`, danach
  Store `tradeId` = `tradeExcursionId`.
In beiden Fällen danach `await bestimmeBereich()` und
`await ladeExkursionen()` (Store `excursions` neu laden). `setupsLaden`
setzt der Aufrufer zurück.

#### D.9.10 Share-Knopf, Navigation, Screenshot-Vorschau

- **Share-Karte**: Knopf `daily.shareCard` (Share-Symbol), nur wenn
  `aiEnabled` weder `false` noch `0`; öffnet D.12.3.
- **Zurück**: sichtbar, wenn im Tag ein Trade mit Index `tradeIndexAktiv − 1`
  existiert; gesperrt während `setupsLaden`; Klick →
  `clickTradesModal(offenerTagIndex, tradeIndexAktiv, tradeIndexAktiv − 1)`.
  Blättern geht NICHT über Tagesgrenzen.
- **Mitte**: bei `speichernNoetig` „`daily.closeAndSave`", sonst
  „`daily.closeModal`"; beide → `clickTradesModal()` (speichern + schliessen).
- **Vorschau**: wenn `screenshot.annotatedBase64` oder
  `screenshot.originalBase64` vorhanden: Vorschaubild (annotiert bevorzugt),
  Titel `common.enlarge`. Klick → `useSelectedScreenshotFunction(-1,
  'dailyModal', screenshot)` (Index −1 = einzelnes Bild ohne Blättern;
  Quelle `dailyModal`; Daten = aktueller Screenshot; die Funktion setzt
  `selectedScreenshotIndex`/`selectedScreenshotSource` und kopiert die Daten in
  `gewaehltesBild`, **ohne es vorher zu leeren** — alte Felder können
  stehen bleiben, Sache von `screenshots.js`) und öffnet per
  Bootstrap-Datenattribut das globale Modal `#fullScreenModal` (über dem
  statischen Detailfenster).
- **Weiter**: wie Zurück mit `tradeIndexAktiv + 1`.

Kein Screenshot-Upload, kein Einfügen, keine Annotation mehr im
Detailfenster: Es wird keine `Screenshot`-Komponente mit Quelle `dailyModal`
gerendert, `useSetupImageUpload` wird nicht gerufen. Der Speicherweg
`tradeBildGeaendert` → `speichereBild()` ist damit von dieser Ansicht
aus praktisch **[tot]** (er wird nur wirksam, wenn ein anderer Teil das Flag
setzt). Empfehlung: Speicheraufruf im Neubau behalten (billig, schützt, falls
Upload zurückkommt) oder bewusst streichen — offen (D.16). Die Sperre über
`markierungOffen` (D.9.1 Schritt 1) behalten, weil eine Annotation im
Vollbild-Dialog offen sein kann.

---

### D.10 Kerzenchart, Kerzenquellen, MFE

#### D.10.1 Quelle wählen (bei jedem Öffnen/Blättern)

`boersenIndex` = −1. Index des Eintrags in `apis` mit `provider == 'databento'`
und mit `'polygon'`. Hat der Databento-Eintrag einen nicht-leeren `key` →
`boersenIndex` = dessen Index, `apiSource` = `databento`; sonst gleiches für
Polygon. Danach (D.9.1 Schritt 11):

- Kerzen-Intervall = `timeframe` aus dem `notes`-Eintrag des Trades, sonst
  `15m`. (`ladeNotizen` übernimmt `timeframe` heute NICHT in den Store —
  **[Altfehler]**, Folge: immer `15m`. Empfehlung: entscheiden — `timeframe`
  in `ladeNotizen` aufnehmen oder fest 15m; D.16.)
- `currentUser.enableBinanceChart` wahr → `apiSource` = `binance`, laden.
- sonst `boersenIndex` ≠ −1 → `apiKey` = Schlüssel; nicht leer → laden.
- sonst kein Chart, Fehlermeldung `null`.

#### D.10.2 Binance (der einzig funktionierende Weg)

Intervall-Abbildung (Journal-Zeitrahmen → Binance): 1m→1m, 2m→3m, 3m→3m,
5m→5m, 6m→5m, 10m→15m, 15m→15m, 30m→30m, 45m→1h, 1h→1h, 2h→2h, 3h→4h,
4h→4h, 1D→1d, 1W→1w, 1M→1M; unbekannt → 15m.

Fenster: Mittelpunkt = `entryTime`·1000; fehlt `entryTime`: 12:00 des Tages
`td` in `timeZoneTrade`. Start = Mittelpunkt − 6 h, Ende = Mittelpunkt + 6 h
(ms).

Anfrage: `GET /api/binance/klines` mit Query `symbol` (Grossbuchstaben),
`interval`, `startTime`, `endTime` (ms), `limit` 1500. **Kein `market`** →
der Server nimmt `spot` (Vorgabe für Journal-Charts) und kappt `limit` auf 1000.
Antwort: Liste `[openTime, open, high, low, close, volume, …]` (Zahlen als
Zeichenketten). Umbau: Zeiten = openTime (ms); Preise je Kerze
`[close, open, low, high]` als Zahlen (genau diese Reihenfolge erwartet
`useCandlestickChart`, diagramme.md §3.10); Volumen = volume.
Cache-Eintrag `{date: td, symbol, interval, ohlcTimestamps, ohlcPrices,
ohlcVolumes}` anhängen.

**[Altfehler] Spot statt Futures**: Futures-Symbole ohne Spot-Markt (z. B.
`1000PEPEUSDT`) liefern 400 → Meldung „Chart nicht verfügbar". Empfehlung:
`market=futures` mitschicken (das Journal handelt Futures); dabei limit 1500
erlaubt. Bewusste Änderung, im Commit nennen.

**[Altfehler] Fenster ±6 h**: Trades länger als 6 h haben den Ausstieg
ausserhalb (der Chart zeigt einen Randpfeil). Empfehlung: Fenster an
Einstieg/Ausstieg ausrichten (z. B. Einstieg − Puffer bis Ausstieg + Puffer,
Intervall passend wählen); offen (D.16).

#### D.10.3 Databento und Polygon — **[tot]/[Altfehler]**

- Databento: `POST /api/databento` mit einem Rumpf (dataset `GLBX.MDP3` bei
  Typ future mit Symbol+„.c.0" und `stype_in` continuous, `XNAS.ITCH` bei
  stock, sonst kein dataset; schema `ohlcv-1m`; start/end in Nanosekunden
  (Tagesbeginn/Tagesende); csv; Schlüssel als `username`), Antwort über
  `useCreateOHLCV(csv, {symbol, ohlcv: []})` (journal `import.js`) zu Kerzen.
  **Diese Server-Route existiert nicht** (kein `/api/databento` im Server);
  für andere Typen wird zudem eine nicht definierte Variable gelesen
  (Laufzeitfehler).
- Polygon: `GET /api/polygon/aggs` (existiert, `server/polygon-api.js`) mit
  Query `ticker` (Präfix `O:` für put/call/option, `I:` future, `C:` forex,
  `X:` crypto, sonst roh), `from` = `to` = `useDateCalFormat(td)`,
  `interval` 1, `span` minute, `adjusted` true, `sort` asc, `limit` 50000,
  Kopfzeile `x-polygon-api-key` = Schlüssel. Antwort `results[]` mit
  `t, o, h, l, c, v`. Das Versprechen wird aber VOR der Antwort erfüllt.
- Beide Wege legen Cache-Einträge OHNE `interval` an; die Suche verlangt das
  Intervall → nie ein Treffer → „Problem beim Laden" (nur Konsole), kein
  Chart. Faktisch zeichnet nur Binance.

Empfehlung: Databento und Polygon im Neubau **weglassen** (Krypto-Journal,
Binance ist die Quelle; Einstellungsseite `views/einstellungen/journal/OhlcChart.vue`
schaltet `enableBinanceChart`). Die Bedingung „Chartfläche sichtbar, wenn
`boersenIndex` ≠ −1" entfällt dann. Falls Polygon bleiben soll, sauber neu bauen.
`ohlcv`-Liste und `useCreateOHLCV`/`useGetMFEPrices`-Importe entfallen.

#### D.10.4 Kerzen-Cache

Modulweite Liste (lebt über die Lebensdauer der Ansicht hinaus, solange das
Modul geladen ist). Schlüssel: `date` (= Trade-`td`), `symbol`, `interval`
(lose Gleichheit). Treffer → keine Anfrage. Kein Treffer → laden, erneut
suchen; wieder kein Treffer → nur Konsolenmeldung, kein Chart, keine
Fehlermeldung. Kein Ablauf, keine Grössengrenze. (Achtung: Schlüssel ist der
Handelstag, das Fenster aber ±6 h um den Einstieg — zwei Trades desselben
Symbols am selben Tag teilen sich das Fenster des ersten. **[Altfehler]**,
Empfehlung: Schlüssel um das Fenster erweitern.)

#### D.10.5 Zeichnen

Gibt es Zeiten: Hat der `notes`-Eintrag `tradingMetadata`, wird sie als
`_tradingMeta` **an das Trade-Objekt in `journalTage` angehängt** (Mutation
des Store-Objekts; Empfehlung: Kopie übergeben). Dann
`await useCandlestickChart(zeiten, preise, volumen, trade, neuAnlegen)` mit
Element-ID Vorgabe `candlestickChart`, ohne Zonen, ohne Schieberegler.
`neuAnlegen` = Modul-Flag (wahr beim ersten Zeichnen nach dem Öffnen über
„Schließen", danach falsch → Instanz wird wiederverwendet). Anfangsausschnitt
steuert `tagesChartZoom` (Store, Vorgabe 3) in `kerzen.js`.

Fehlerbehandlung (Anfrage oder Zeichnen wirft):
- HTTP 429 → „Zu viele Anfragen, versuche es später erneut";
- HTTP 400 → „Chart nicht verfügbar für dieses Symbol";
- andere HTTP-Antwort → deren `statusText`;
- sonst Fehlermeldungstext.
Texte fest deutsch (Empfehlung: i18n, D.14). Fehler auch in die Konsole.
Mit Meldung wird die Chartfläche ausgeblendet und der Text gezeigt.

#### D.10.6 MFE aus 1-Minuten-Kerzen

Nur bei `entryTime`, `exitTime` und `symbol`. `GET /api/binance/klines`,
Query `symbol` (gross), `interval` 1m, `startTime` = entryTime·1000,
`endTime` = exitTime·1000, `limit` 1500 (ebenfalls ohne `market` → Spot,
gekappt auf 1000). Long (`strategy === 'long'`) → höchstes High; sonst
tiefstes Low; leere Antwort oder kein Wert → `null`; Fehler → `null` (nur
Konsole). **[Altfehler]**: Trades über 1000 Minuten (~16,7 h) werden nur am
Anfang ausgewertet; Spot statt Futures; `startTime == endTime` (Trade unter
einer Sekunde) → Server 400 → `null`. Empfehlung: Futures, bei langen Trades
gröberes Intervall oder Seitenweise laden.

---

### D.11 Orderbuch zum Trade (Replay-Verweis)

- **Fenster** (berechnet aus dem offenen Trade; `null`, wenn `symbol` oder
  `entryTime` fehlt): Einstieg = entryTime·1000; Ausstieg = exitTime·1000,
  ohne exitTime Einstieg + 15 min; Puffer 15 min; von = Einstieg − Puffer;
  bis = min(Ausstieg + Puffer, von + 48 h) (der Server nimmt höchstens 48 h);
  Symbol in Grossbuchstaben.
- **Prüfen** (Watcher D.4.3): `replayGeprueft` und `replayVerfuegbar` falsch;
  ohne Fenster → geprüft = wahr, fertig. Sonst `GET /api/live/recorder/available`
  mit Query `symbol`, `market` = futures, `from` = von, `to` = bis (ms).
  Verfügbar ⇔ Antwortfeld `stunden` ist eine nicht-leere Liste; Fehler →
  nicht verfügbar; immer danach geprüft = wahr. (Keine Abbruchlogik bei
  schnellem Blättern — eine späte Antwort kann die eines neueren Trades
  überschreiben; Empfehlung: Antwort verwerfen, wenn sich der Trade
  inzwischen geändert hat.)
- **Anzeige** (nur mit Fenster): verfügbar → Knopf „Orderbuch zum Trade"
  (Diagramm-Symbol); sonst, wenn geprüft → gedämpfter Text „Orderbuch nicht
  aufgezeichnet" mit Tooltip-Titel „Aufzeichnung aktivierst du unter
  Einstellungen → Live-Aufzeichnung". Texte fest deutsch (Empfehlung: i18n).
- **Klick**: nur mit Fenster und verfügbar. Vollständige Seitennavigation
  (`window.location.href`, kein Router) nach `/liquidity` mit Query:
  `replay=1`, `symbol`, `market=futures`, `from`, `to`, `entry`, `exit` (alle
  ms, gerundet), `label` = „Trade " + `useTimeFormat(entryTime)`.
  `views/Liquidity.vue` wertet `replay=1` aus. Empfehlung: Router-Navigation
  ist erlaubt, wenn Liquidity die Query auch bei Router-Wechsel liest — sonst
  bei harter Navigation bleiben (offen, D.16). Ungespeicherte Änderungen im
  Detailfenster gehen dabei heute verloren — Empfehlung: vorher speichern.

---

### D.12 KI-Bewertung und Share-Karte

#### D.12.1 KI-Bewertung (aus der Trade-Zeile)

Mit `offenerTagIndex`/`tradeIndexAktiv` (gerade gesetzt): Trade, `dateUnix` und
`date` der Karte (`date` ist nach journal-kern §7.11 die Tageszahl, nicht das
Datum — **[Altfehler]** des Kerns; Empfehlung: im Prompt das Datum aus
`dateUnix` formatieren). Richtung „Short" bei `strategy === 'short'`, sonst
„Long". PnL = `grossProceeds` oder `grossSharePL` oder 0, auf 2 Stellen.

Router-Navigation nach `/ki-coach` mit Query `agentPrompt` = mehrzeiliger
deutscher Text mit: Symbol, Richtung, Überschrift „Trade-Analyse"; Datum,
dateUnix, Einstieg (`entryPrice`), Ausstieg (`exitPrice` oder `closePrice`),
PnL mit Dollarzeichen; Anweisung, die Werkzeuge `query_trades`,
`query_notes`, `query_tags`, `query_satisfactions`, `query_screenshots` zu
nutzen und einen vorhandenen Screenshot mit `analyze_screenshot` zu
analysieren; Bewertungsraster 1) Einstieg/Ausstieg, 2) Risikomanagement
(SL/TP), 3) Strategie-Treue, 4) Fehler & Verbesserungen, 5) Gesamtnote 1–10.
Der KI-Coach liest `agentPrompt` aus der Query (gleiches Muster wie
`AgentLab.vue`). Empfehlung: Text in i18n oder eine eigene Hilfsfunktion,
inhaltlich gleich.

#### D.12.2 Share-Karte aus der Trade-Zeile (Karten-Index, Trade-Index)

Trade fehlt → nichts. Tag-Namen nur aus der **ersten Katalog-Gruppe**
(`verfuegbareTags[0]`, gilt als „Strategie"-Gruppe): Zuordnung in `tags` mit
`tradeId == trade.id`; je Tag-ID, die in der ersten Gruppe vorkommt, Name über
`useGetTagInfo`; leere Namen fallen weg. Metadaten aus dem `notes`-Eintrag des
Trades (`tradingMetadata`). Hebel = Metadaten-`leverage` oder Trade-`leverage`
oder 0; RRR = Metadaten-`rrr` oder ''.

#### D.12.3 Share-Karte aus dem Detailfenster

Wie D.12.2, aber Trade = offener Trade, Hebel/RRR aus `tradingMeta`, Tag-Namen
aus `tradeTags`, gefiltert auf IDs der ersten Katalog-Gruppe.

#### D.12.4 Übergabeobjekt und Einbindung

Objekt (alle Felder immer vorhanden): `symbol` (oder ''), `strategy`
(`strategy`, sonst aus `side`: `SS`/`BC` → short, sonst long), `entryPrice`,
`exitPrice`, `netProceeds`, `grossProceeds`, `leverage`, `commission`,
`fundingFee` (je fehlend 0), `dateUnix` (Karte, sonst 0), `entryTime`
(Trade, sonst `dateUnix` der Karte, sonst 0), `exitTime` (oder 0),
`tagNames` (Liste), `rrr`.

`ShareCardModal` (`src/components/ShareCardModal.vue`) wird an `body`
teleportiert (wegen der Fokusfalle des Bootstrap-Modals) und bekommt die Props
`trade` (Objekt oben) und `visible` (bool); Ereignis `close` → sichtbar =
falsch. Öffnen: Objekt setzen, dann sichtbar = wahr. Fällt Bootstrap weg und
wird das Detailfenster ein nativer `<dialog>` (Top-Layer), muss die
Share-Karte ÜBER dem Detailfenster erscheinen (ebenfalls Top-Layer oder
Detailfenster vorher schliessen).

---

### D.13 Tote Teile (nicht nachbauen, sofern nicht anders gesagt)

1. **Tagesdiagramme** `doubleLineChart<dateUnix>` und `pieChart<dateUnix>`:
   `starteTagesansicht` und `ladeWeitere` rufen `zeichneDoppellinie()` und
   `zeichneTorte()`, aber die Ansicht rendert keine Elemente mit diesen
   IDs; die Funktionen finden kein Element und zeichnen still nichts.
   Empfehlung: Aufrufe in `ablauf.js` für `daily` entfernen (Sache des
   Besitzers von `ablauf.js`); die beiden Funktionen bleiben, weil der Golden
   Master sie prüft (diagramme.md §2.3). Ob die Karten wieder eine
   kumulierte Tageslinie und einen Gewinnquoten-Ring bekommen sollen, ist eine
   Produktentscheidung (D.16) — wenn ja: Element-IDs genau
   `doubleLineChart<dateUnix>` / `pieChart<dateUnix>`, Aufruf nach dem Rendern
   der Karten, Dispose über die Klasse `chartClass`.
2. **Tag-Fenster** (`tagsModal`, Tages-Tags bearbeiten): vollständig gebaut
   (Chips mit Entfernen, Eingabe mit Vorschlägen, Enter/Tab fügt hinzu,
   gruppierte Vorschlagsliste, Schliessen/Speichern über `speichereVerfuegbareTags`
   + `speichereTags` mit `tradeTagsId` = `null` und `tradeTagsDateUnix` = Tag),
   aber **kein Element öffnet es** (kein Auslöser mit Ziel `#tagsModal`). Das
   Einblend-Ereignis würde ein auslösendes Element mit Karten-Index erwarten.
   Nicht nachbauen.
3. **Zufriedenheit je Trade** (Funktionen „Zufriedenheit ändern"/„speichern"
   über `dbFirst`/`dbUpdate`/`dbCreate` auf `satisfactions`): ohne Bedienelement.
4. Funktion „Screenshots der Karte filtern" und die Reiter-Konstante mit
   „Trades/Blotter/Screenshots": ungenutzt.
5. Zweiter Rechenparameter der MFE-Funktion (Zeiten/Preise): ungenutzt.
6. Auskommentiertes Löschen eines Setups im Detailfenster.
7. `ohlcv`-Liste, Databento-Zweig (D.10.3).
8. Paginierung (D.7).
9. `tradeIndexVorher` wird geschrieben, nirgends gelesen.

---

### D.14 i18n-Schlüssel

Verwendet (alle vorhanden in `src/i18n/locales/de.json`; deutscher Wert zur
Orientierung):

| Schlüssel | de |
|---|---|
| `common.close` | Schliessen (nur totes Tag-Fenster) |
| `common.enlarge` | Vergrössern |
| `common.save` | Speichern (nur totes Tag-Fenster) |
| `common.screenshotSaveAnnotation` | Bitte zuerst die Screenshot-Markierung speichern. |
| `daily.addTag` | Tag hinzufügen (nur totes Tag-Fenster) |
| `daily.aiReview` | KI-Bewertung |
| `daily.botBreakdownReimport` | Grid/Trend erst nach einem erneuten Import verfügbar. |
| `daily.botPnLBreakdown` | PnL-Aufschlüsselung (Bot) |
| `daily.closeAndSave` | Schließen & Speichern |
| `daily.closeModal` | Schließen |
| `daily.closed` | Geschlossen |
| `daily.entry` | Einstieg |
| `daily.funding` | Funding |
| `daily.gesamtProfit` | Gesamt-Profit |
| `daily.gridProfit` | Grid-Gewinn |
| `daily.investment` | Investment |
| `daily.leverage` | Hebel |
| `daily.mfePrice` | MFE Preis |
| `daily.mfeTooltip` | Maximum Favorable Excursion … (Erklärung, Long/Short, aus Binance 1m) |
| `daily.note` | Notiz |
| `daily.open` | Offen |
| `daily.pnlPerUnitTooltip` | PnL pro Einheit … |
| `daily.runtime` | Laufzeit |
| `daily.shareCard` | Share-Karte |
| `daily.swingClosedOn` | Swing Trade geschlossen am {date} |
| `daily.swingFrom` | Swing Trade ab {date} |
| `daily.swingOpenedOn` | Swing Trade eröffnet am {date} |
| `daily.tradingFeeLabel` | Trading-Gebühr |
| `daily.trendPnl` | Trend-PnL |
| `daily.volTooltip` | Gesamtanzahl der Securities … |
| `incoming.daytrade` | Daytrade |
| `incoming.fillAvgPrice` | Ø Preis |
| `incoming.fillClose` | Schließung |
| `incoming.fillCompound` | Nachkauf |
| `incoming.fillEntries` | Einträge |
| `incoming.fillFee` | Fee |
| `incoming.fillInitial` | Initial |
| `incoming.fillPartialClose` | Teilschließung |
| `incoming.fillTotal` | Gesamt |
| `incoming.fills` | Positionen |
| `incoming.positionSize` | Positionsgröße |
| `incoming.scalptrade` | Scalptrade |
| `incoming.swingtrade` | Swingtrade |

Die drei `incoming.*trade`-Schlüssel werden dynamisch (über eine Tabelle)
übersetzt; der Selbsttest `src/utils/__selftest-i18n.mjs` sieht nur statische
`t('a.b')`-Aufrufe — im Neubau statisch ausschreiben oder bewusst prüfen.

Heute fest im Code (Empfehlung: neue Schlüssel unter `daily.*` anlegen, in
de/en, und `__selftest-i18n` grün halten): Spaltenköpfe „Symbol", „Vol",
„Position", „PnL/Stk", „PnL(n)", „PnL(g)", „Total Fees", „Wins", „Losses",
„Trades", „Executions", „Price", „Ausstieg", „Dauer", „PnL/Vol"; Reiter
„Trades", „Blotter"; Leistenbeschriftungen „Trades/Wins/Losses/Fees/PnL(g)";
„Tags"; Platzhalter „MFE"; Hinweis „Kennzahlen nicht berechnet …"; „SL/TP
Protokoll", „Gesetzt", „Verschoben", „Ausgelöst ✓", „→ entfernt"; „SL:",
„BE:", „TP:", „RRR 1:"; „Orderbuch zum Trade", „Orderbuch nicht
aufgezeichnet" + Tooltip; die vier Chart-Fehlermeldungen (D.10.5);
„day"/„days" aus `useSwingDuration` (in `format.js`, nicht Sache der Ansicht).

---

### D.15 Bootstrap-Abhängigkeiten (zu ersetzen)

| Bootstrap-JS | Wo | Zweck | Ersatz-Hinweis |
|---|---|---|---|
| Modal (Instanz + Datenattribute) | `tradesModal` | Detailfenster öffnen (Zeilenklick über Datenattribut), Einblend-Ereignis liefert die Zeile, `hide()` beim Schliessen; statischer Hintergrund, Escape aus | `basis/Dialog.vue` (nativ `<dialog>`); Zeilenklick ruft direkt „öffnen(karte, trade)"; Escape und ein einziger Schliessweg mit Speichern (D.9.1) |
| Modal | `tagsModal` | totes Tag-Fenster | entfällt |
| Modal (Datenattribut) | Vorschaubild → `#fullScreenModal` | Vollbild öffnen | Funktion des neuen Vollbild-Dialogs aufrufen (siehe Kommentar in `ScreenshotVollbild.vue`); muss über dem Detailfenster liegen; `Screenshot.vue` springt beim Schliessen per Datenattribut zurück zu `#tradesModal`, wenn `tradeDetailOffen` — mit umstellen |
| Tab (Datenattribute) | Reiter je Karte | Umschalten Trades/Blotter | `basis/Reiter.vue`, Zustand je Karte (D.5.3) |
| Tooltip (`useInitTooltip`) | Info-Symbole (Vol, PnL/Stk, Swing-Hinweise mit HTML, MFE) | Erklärtexte | `InfoTipp.vue` für Bedeutung von Zahlen, `title=` nur für Bedienelemente. `useInitTooltip` ist nicht idempotent (jeder Aufruf legt neue Instanzen an; wird bei jedem Trade-Wechsel gerufen) — im Neubau entfällt das |
| Popover (`useInitPopover`, über `starteTagesansicht`) | keine Popover-Elemente in der Ansicht | — | nichts |
| Collapse, Dropdown | nicht benutzt | — | — |

Symbole: heute Unicons/Font Awesome (Info, Hirn, Bild-Share, Bild, Warndreieck,
Ebenen, Verlauf, Pfeile, Chevron links/rechts, Tag). Ersatz über
`basis/Symbol.vue`; fehlende Symbole dort ergänzen (Sache der Gestaltung).

---

### D.16 Offene Entscheidungen für den Neubau

1. Reiter je Karte unabhängig oder seitenweites Akkordeon (D.5.3).
2. Auto-MFE still speichern oder nur anzeigen (D.9.1).
3. `timeframe` je Notiz für das Kerzenintervall wieder einlesen oder fest 15m
   (D.10.1).
4. Kerzenfenster ±6 h oder an Ein-/Ausstieg ausgerichtet; `market=futures`
   (D.10.2, D.10.6).
5. Databento/Polygon streichen (Empfehlung) oder neu bauen (D.10.3).
6. Tagesdiagramme (Doppellinie/Ring) je Karte zurückbringen oder Aufrufe
   entfernen (D.13.1).
7. Speicherweg Screenshot im Detailfenster behalten (D.9.10).
8. Orderbuch-Sprung per Router oder harter Navigation (D.11).

### D.17 Prüfpunkte (manuell, Ansicht ist nicht vom Golden Master abgedeckt)

- Monat mit mehreren Tagen: alle Karten sichtbar, neueste oben; Karte 0 zeigt
  Trades-Tabelle, andere nur Kopf + Leiste.
- Tag mit zwei Börsen: eine Karte mit Leiste, eine mit Hinweis statt Null.
- Kalender-Klick auf einen Tag → Seite scrollt zur Karte.
- Trade öffnen, blättern bis Tagesende (Weiter verschwindet), MFE ändern →
  Knopf „Schließen & Speichern" → Exkursion in DB am richtigen Trade.
- Trade ohne MFE mit Binance-Chart: MFE erscheint automatisch (heute: wird
  still gespeichert).
- Futures-Symbol ohne Spot-Markt: verständliche Meldung statt Chart.
- Bot-Trade (Pionex, Coin-M): Aufschlüsselung in der Münze plus ≈ USDT.
- Trade mit Fills/SL/TP-Historie: Gruppen aufklappbar, Protokoll ohne
  Einträge nach Positionsende.
- Screenshot-Vorschau → Vollbild → zurück zum Detailfenster.
- KI aus (`aiEnabled` 0/false): keine KI-/Share-Knöpfe in Zeile und Fenster.
- Seite verlassen bei offenem Chart: keine ECharts-Warnung über verwaiste
  Instanzen.

---


Stand: 19.10.2026. Verfasst aus dem Verhalten des heutigen Codes. Diese Datei
ist für den Neubau die einzige Quelle; der bauende Agent liest die Altdateien
nicht. Beschrieben wird das Verhalten, nicht der Wortlaut des Altcodes.

Beschriebene Dateien:

- `src/utils/screenshots.js` (alle Exporte; Schnittstelle bleibt gleich)
- `src/components/Screenshot.vue` (eine Bildkarte)
- `src/views/Screenshots.vue` (Seite `/screenshots`)
- `src/components/rahmen/ScreenshotVollbild.vue` – eigener Code, bleibt; hier
  nur, was er von den obigen Dateien erwartet
- die Bildmarkierung mit der Bibliothek `markerjs2` (Version 2.32.7 im
  Lockfile) und das Format der gespeicherten Markierungen `maState`
- `src/views/Playbook.vue` (Seite `/playbook`)

Eigener Code, der bleibt und nur BENUTZT wird: `src/utils/db.js` (`dbFind`,
`dbFirst`, `dbGet`, `dbCreate`, `dbUpdate`, `dbDelete`), `src/utils/sanitize.js`
(`sanitizeHtml`), `src/composables/useVerlassenSchutz.js`,
`src/utils/journal/*` (Journal-Kern aus S7, siehe `docs/spec/journal-kern.md`:
`useGetTagInfo`, `ladeVerfuegbareTags`, `speichereTags`,
`speichereVerfuegbareTags`, `useCreatedDateFormat`, `useTimeFormat`,
`useHourMinuteFormat`, `useEditItem`, `useInitPopover`, `ladeWeitere`,
`starteBilder`, `pruefeSichtbarkeit`, das dayjs-Modul `journal/zeit.js`),
die Bausteine unter `src/components/basis/` (`Symbol`, `Knopf`, `Dialog`, …),
`src/i18n`. Bibliotheken, die bleiben dürfen: `vue`, `vue-router`, `vue-i18n`,
`dayjs`, `dompurify` (über `sanitize.js`), `quill` 2.0.x (BSD-3) – siehe P.6.
`markerjs2` fällt weg (Lizenz: Linkware/kommerziell) und wird durch eine eigene
Bildmarkierung ersetzt (S.9). Bootstrap-JS, Font Awesome und Unicons fallen
weg; was sie heute tun, steht jeweils dabei.

Schreibweise: „SS“ = `sessionStorage`, „LS“ = `localStorage`. Zeiten:
`dateUnix`/`dateUnixDay` sind Sekunden, Füllzeiten in `tradingMetadata` sind
Millisekunden.

---

## Screenshots und Bildmarkierung

### S.1 Datenmodell: Tabelle `screenshots`

Angelegt in `server/database.js`; über die generische REST-Schicht
(`/api/db/screenshots`, `api-routes.js`) erreichbar. `id` wird in Antworten als
`objectId` (ZEICHENKETTE) geliefert. Spalten-Whitelist der REST-Schicht:

| Feld | Typ / Vorgabe | Bedeutung |
|---|---|---|
| `id` → `objectId` | Ganzzahl, auto | Schlüssel; im Frontend immer als Zeichenkette |
| `name` | Text, '' | Zuordnungsschlüssel (siehe S.2) |
| `symbol` | Text, '' | z. B. `BTCUSDT` |
| `side` | Text, '' | `B` (Long), `SS` (Short), `BC` (Short-Abschluss, Altbestand), `long`/`short` (vom Playbook geschrieben), '' |
| `broker` | Text, '' | `bitunix`, `bitget`, `pionex`, … oder '' (unbekannt / keiner Börse zugeordnet) |
| `originalBase64` | Text, '' | Originalbild als Daten-URL (`data:image/<typ>;base64,…`) |
| `annotatedBase64` | Text, '' | Anzeigebild als Daten-URL. Beim Hochladen = Kopie des Originals; nach einer Markierung NUR die Markierungsebene (transparentes PNG, siehe S.8 und Altfehler A-S1) |
| `original`, `annotated` | Text, '' | Altbestand aus der Parse-Zeit (Datei-Verweise). Werden nie geschrieben und bei jedem Laden per `exclude` weggelassen |
| `markersOnly` | Ganzzahl, 1 | Wird immer als `true` geschrieben, kommt als Zahl `1` zurück. Bedeutung: `annotatedBase64` ist eine Ebene ÜBER dem Original. Niemand liest das Feld |
| `maState` | Text (JSON), '{}' | Zustand der Markierung, siehe S.9. Kann sein: fehlend, `{}`, `null`, oder ein vollständiger Zustand |
| `date` | Text | Lokale Zeit in der Handelszeitzone, Form `YYYY-MM-DDTHH:mm:ss` |
| `dateUnix` | Ganzzahl (Sekunden) | Zeitpunkt; Sortierschlüssel |
| `dateUnixDay` | Ganzzahl (Sekunden) | Tagesanfang; Zuordnung zum Handelstag |
| `aiReview`, `aiReviewProvider`, `aiReviewModel` | Text, '' | KI-Bewertung des Bildes – Spalten existieren, werden aber von NIEMANDEM geschrieben; nur das KI-Agent-Werkzeug `query_screenshots` liest `aiReview` (als „hat Bewertung“ und 100-Zeichen-Vorschau) |
| `aiReviewPromptTokens`, `aiReviewCompletionTokens`, `aiReviewTotalTokens` | Ganzzahl, 0 | wie oben, ungenutzt |
| `createdAt`, `updatedAt` | Zeitstempel | Server |

`maState` ist in der REST-Schicht als JSON-Spalte geführt: Objekte werden beim
Schreiben zu Text, beim Lesen zurück zu Objekten (eine nicht lesbare Zeichenkette
bleibt Zeichenkette). Ein geschriebenes `null` kommt als `null` zurück.

KI-Bildbewertung im engeren Sinn gibt es in diesen Dateien NICHT. Bilder
erreichen die KI an drei Stellen, alle serverseitig und unverändert zu
übernehmen: Trade-Bewertung (`ollama-api.js`, sucht das Bild über `name` =
Trade-ID, dann Tag, dann `"<dateUnix>_<symbol>"`, dann `dateUnixDay`, und
schickt `annotatedBase64` oder ersatzweise `originalBase64`), KI-Berichte (bis 4
Bilder des Zeitraums, Schalter `settings.aiScreenshots`), KI-Agent
(`query_screenshots`, `analyze_screenshot` mit `useAnnotated` = Vorgabe wahr).
Die KI-Bewertung des TRADES liegt in `notes.aiReview*`, nicht in `screenshots`.

### S.2 Namenskonventionen von `name` (wer schreibt was)

`name` ist der einzige Verknüpfungsschlüssel zwischen Bild und Trade für alle
Leser, die keine ID gespeichert haben. Bekannte Formen:

| Form | Erzeuger |
|---|---|
| `t<dateUnix>_<symbol>_<side>` | `speichereBild`, wenn `side` gesetzt ist (Altbestand „Screenshot hinzufügen“ und – Altfehler A-S2 – nach JEDER Markierung auf der Screenshots-Seite) |
| `<dateUnix>_<symbol>` | dieselbe Funktion ohne `side`; auch `quickImport.js` beim Verknüpfen eines Incoming-Bildes (`<Tagesanfang>_<symbol>`); Cockpit-Foto (`cockpitFoto.js`: `<dateUnix>_<symbol oder COCKPIT>`) |
| `<tradeId>_entry`, `<tradeId>_trend`, `<tradeId>_closing` | Playbook (P.8). Trade-ID hat die Form `t<td>_<index>_<positionId>` |
| `incoming_entry_<positionId>`, `incoming_trend_<positionId>`, `incoming_closing_<positionId>`, `incoming_chart_<positionId>` | `Incoming.vue` (nicht Teil dieser Spezifikation) |
| genau eine Trade-ID | Altbestand; wird von Daily, `Screenshot.vue` (Tags) und Trade-KI-Bewertung als Treffer erwartet |

Der Neubau darf keine neue Form einführen, ohne alle Leser (Daily, Playbook,
Screenshots-Filter, `ollama-api.js`) mitzuziehen.

### S.3 Stores, die diese Dateien benutzen

Alle aus dem Journal-Kern (`docs/spec/journal-kern.md`, Abschnitt 3), hier nur
die Bedeutung im Bildzusammenhang. Die Werte leben in
`stores/journal/screenshots.js`, Re-Exporte über `stores/trades.js`
(`screenshot`, `screenshots`, `bildInfos`, `gewaehltesBild`) und
`stores/ui.js` (Rest).

| Name | Art | Bedeutung |
|---|---|---|
| `screenshot` | reactive {} | „Das Bild in Bearbeitung“: Arbeitskopie für Markierung und Speichern; Daily befüllt es je Trade im Modal |
| `screenshots` | reactive [] | Liste der geladenen Bilder (Screenshots-Seite: wachsend; Daily: Bilder EINES Tages) |
| `bildInfos` | reactive [] | Daily: leichte Liste `{objectId, dateUnix, dateUnixDay, name}` des Monats |
| `bildSeite` | ref 0 | Offset (`skip`) des nächsten Nachladens |
| `bildAbfrageGrenze` | ref | Seitengrösse. Store-Vorgabe 10, aber `screenshots.js` setzt beim LADEN DES MODULS 4 |
| `gewaehltesBild` | reactive {} | Bild der Vollbildansicht |
| `selectedScreenshotIndex` | ref | Index in `screenshots` für das Blättern; −1 bzw. keine Zahl = ohne Blättern |
| `selectedScreenshotSource` | ref | Herkunft (`screenshots`, `fullScreen`, `dailyModal`, `dailyTab`) |
| `markierungOffen` | ref false | Markierungseditor offen; blockiert Speichern |
| `bildInBearbeitung` | ref false | Altbestand (Bearbeiten-Seite); wird nirgends mehr wahr |
| `tagesBildGeaendert` | ref | Datum geändert → beim Update `date`/`dateUnix`/`dateUnixDay` mitschreiben |
| `tradeBildGeaendert` | ref false | Daily: Bild geändert → beim Speichern des Modals `speichereBild` |
| `resizeCompressImg`, `resizeCompressMaxWidth`, `resizeCompressMaxHeight`, `resizeCompressQuality` | ref undefined | Bildverkleinerung. Werden NIRGENDS gesetzt → Kompression ist tot (S.6) |
| `expandedScreenshot`, `expandedId`, `expandedSource` | ref | Altbestand; nur `expandedScreenshot == null` wird im Endlos-Scroll abgefragt |
| `listeZuEnde` | ref | Screenshots-Seite: keine weiteren Zeilen in der DB |
| `seiteLaedt`, `ladeMehr`, `setupsLaden` | ref | Ladeanzeigen |
| `speichernNoetig`, `zeichenZaehler`, `markierterEintrag`, `tradeDetailOffen`, `pageId`, `timeZoneTrade` | ref | wie im Journal-Kern; `markierterEintrag` = `objectId` des zu löschenden Bildes |
| `kopiertesBild` | ref | App-interne Zwischenablage `{objectId, name}` oder null; beim Start aus SS `kopiertesBild` (JSON) gelesen |
| `gewaehlterMonat` (Filter) | ref `{start,end}` | Monat für `bildInfos` |
| `tagAuswahl` (Filter) | ref (Liste von Tag-IDs) | Tag-Filter der Screenshots-Seite; `t000t` = „ohne Tag“ |
| `selectedBroker` (Filter) | ref | Börsenfilter; leer = alle |
| `tags`, `tradeTags` | reactive [] | Tag-Zeilen `{tradeId, tags:[ids], …}` des Zeitraums bzw. Tags des Bildes in Bearbeitung |

SS-Schlüssel dieses Teils: `bildSeite` (Zahl), `screenshotIdToEdit`
(objectId), `editItemId` (objectId, von `useEditItem` geschrieben, hier nicht
gelesen), `kopiertesBild` (JSON `{objectId, name}`).

### S.4 `src/utils/screenshots.js` – Exporte

Beim Laden des Moduls: `bildAbfrageGrenze` = 4.

**`leseBildSeite()`** – synchron, keine Rückgabe. Steht in SS
`bildSeite` ein Wert, wird `bildAbfrageGrenze` auf diese Zahl
gesetzt und der SS-Eintrag gelöscht. Zweck: Nach „Bearbeiten“ (S.5) die schon
geladene Anzahl in EINEM Abruf wiederholen, damit zum Bild gescrollt werden
kann. Aufrufer: `starteBilder` (ablauf.js).

**`ladeBilder(nichtSeite, tagUnix)`** → Promise<void>, löst immer auf
(auch bei leerem Ergebnis). Drei Betriebsarten:

1. `nichtSeite` falsch/fehlend → Screenshots-Seite: `dbFind('screenshots')`
   absteigend nach `dateUnix`, ohne `original`/`annotated`, `limit` =
   `bildAbfrageGrenze`, `skip` = `bildSeite`. KEIN Datumsfilter
   (alle Zeiten).
2. `nichtSeite` wahr, `tagUnix` fehlt → Monatsübersicht für Daily: Zeilen mit
   `gewaehlterMonat.start ≤ dateUnix ≤ gewaehlterMonat.end`, ohne
   `original`/`annotated`/`originalBase64`/`annotatedBase64`/`maState`; vorher
   `bildInfos` leeren.
3. `nichtSeite` wahr, `tagUnix` gesetzt → alle Bilder mit `dateUnixDay` =
   `tagUnix` (volle Daten ausser `original`/`annotated`).

Danach:

- **Börsenfilter** nur wenn `selectedBroker` gesetzt UND `pageId` =
  `screenshots`: einmal ALLE Trade-Tageszeilen laden (`dbFind('trades')`,
  absteigend, Limit 10000, ohne `executions`/`blotter`/`pAndL`), daraus die
  Menge der Trade-IDs und der `dateUnix` der Tage mit Trades dieser Börse.
  Ein Bild bleibt, wenn eines gilt: `name` ist eine dieser Trade-IDs;
  `dateUnixDay` ist einer dieser Tage; `broker` = gewählte Börse; `broker` ist
  leer (Bilder ohne Börse dürfen durch den Filter nicht verschwinden).
- Ist `pageId` = `daily` und es gibt Treffer: `screenshots` leeren.
- **Tag-Filter** je Bild (gilt NICHT auf Daily): gesucht wird die Tag-Zeile in
  `tags` mit `tradeId` = Bild-`name`. Gefunden und einer der Tags steht in
  `tagAuswahl` → aufnehmen. Gefunden ohne Schnittmenge, oder nicht gefunden →
  nur aufnehmen, wenn `t000t` gewählt ist. Folge: Ist `tagAuswahl` leer,
  erscheint auf der Screenshots-Seite KEIN Bild (Filterleiste wählt beim
  Initialisieren alle Tags plus `t000t`).
- Aufnehmen heisst: Betriebsart 1 und 3 → ganzes Objekt an `screenshots`
  ANHÄNGEN; Betriebsart 2 → `{objectId, dateUnix, dateUnixDay, name}` an
  `bildInfos`.
- Kein DB-Treffer und `pageId` = `screenshots` → `listeZuEnde` = wahr.
- Immer: `bildSeite += bildAbfrageGrenze` (auch in den
  Daily-Betriebsarten, bedeutungslos dort); `setupsLaden` = falsch; ausser auf
  Daily `seiteLaedt` = falsch.
- Steht SS `screenshotIdToEdit` und `pageId` = `screenshots` →
  `scrolleZuBild()`.

Grenzfälle: `skip`/`limit` wirken VOR Börsen- und Tag-Filter → eine „Seite“ kann
weniger oder null sichtbare Bilder liefern; das Nachladen geht trotzdem weiter,
bis die DB leer ist. Der Börsenfilter lädt bei jedem Nachladen erneut alle
Trades (teuer; Empfehlung: einmal je Seitenaufruf).

Aufrufer: `ablauf.js` (`starteTagesansicht` Betriebsart 2, `starteBilder`
Betriebsart 1, `ladeWeitere` Betriebsart 1), `app.js` (Daily-Reiter
„Screenshots“: Betriebsart 3 mit dem `dateUnixDay` aus `bildInfos`),
`Daily.vue` (Modal öffnen: Betriebsart 3 mit dem Tag des Trades bzw. aus
`bildInfos`), `ladeBildHoch` (nach Speichern auf Daily:
erst 3, dann 2), `useSelectedScreenshotFunction` (Nachladen beim Blättern,
Betriebsart 1).

**`scrolleZuBild()`** – sucht das DOM-Element mit der ID = SS
`screenshotIdToEdit` (die Karte trägt die `objectId` als Element-ID), scrollt es
in Sicht, löscht den SS-Eintrag.

**`useSetupImageFile(datei, dateUnix, symbol, side)`** → Promise. Kern des
Bild-Einlesens (Datei-Auswahl, Ziehen, Einfügen). Ohne Datei: nichts.
Setzt `tradeBildGeaendert` = wahr; auf Daily zusätzlich `speichernNoetig` und
`tagesBildGeaendert` = wahr und `screenshot.dateUnix/symbol/side` = Argumente.
Liest die Datei als Daten-URL: `screenshot.originalBase64` UND
`screenshot.annotatedBase64` = diese URL, `screenshot.extension` = Teil zwischen
`/` und `;base64` (z. B. `png`, `jpeg`), `zeichenZaehler` +1. Danach, falls
`resizeCompressImg` wahr: `compressImage` auf das Element mit ID
`screenshotDiv` (existiert nicht mehr – siehe S.6). Aufrufer: nur
`useSetupImageUpload`.

**`useSetupImageUpload(event, dateUnix, symbol, side)`** – nimmt die erste
Datei aus `event.target.files` und ruft `useSetupImageFile`. Aufrufer: wird von
`Daily.vue` importiert, aber nirgends aufgerufen. Export muss bleiben.

**`compressImage(imgElement)`** – siehe S.6. Kein Aufrufer ausser obigem toten Pfad.

**`useSetupMarkerArea(quelle, bildDaten)`** – öffnet den Markierungseditor,
siehe S.8. Aufrufer: `Screenshot.vue` (Werkzeug „Markieren“).

**`speichereBild()`** → Promise<void>. Ablauf:

1. Ist `markierungOffen` wahr → Hinweis `common.screenshotSaveAnnotation`
   (Browser-`alert`) und ABBRUCH – das Promise löst dann NIE auf
   (Altfehler A-S3).
2. Nur `pageId` = `addScreenshot` (Seite existiert nicht mehr, Route leitet auf
   `/screenshots` um – Zweig ist tot): ohne Symbol → Hinweis
   `common.screenshotAddSymbol`; ohne Bild → `common.screenshotAddImage`;
   Spinner an; `dateUnix` aus `screenshot.date` in der Handelszeitzone.
3. Ist `bildInBearbeitung` wahr (nie): `extension` aus `originalBase64` neu.
4. `screenshot.name` NEU setzen: mit `side` → `t<dateUnix>_<symbol>_<side>`,
   ohne → `<dateUnix>_<symbol>` (Altfehler A-S2).
5. Wenn `bildInBearbeitung` falsch und `tradeTags` leer → direkt
   `ladeBildHoch()`. Sonst zuerst parallel
   `speichereVerfuegbareTags()` und `speichereTags()` (Journal-Kern; auf Seite
   `addScreenshot` mit Schlüssel `screenshot.name`, sonst mit dem Daily-Schlüssel),
   dann `ladeBildHoch()`.

Aufrufer: `Daily.vue` (Modal speichern, wenn `tradeBildGeaendert`),
`useSetupMarkerArea` (nach jeder Markierung auf Seite/Daily-Reiter).

**`ladeBildHoch()`** → Promise. Name historisch, schreibt in die
eigene DB.

- `screenshot.objectId` vorhanden → `dbUpdate('screenshots', id, …)` mit
  `name`, `symbol`, `side`, `originalBase64`, `annotatedBase64`,
  `markersOnly: true`, `maState`; falls `tagesBildGeaendert` zusätzlich
  `date` (Handelszeitzone, Form wie S.1), `dateUnix` (Zahl), `dateUnixDay`
  (Tagesanfang in Handelszeitzone).
- sonst → `dbCreate` mit allen obigen Feldern inkl. Datum (Datum immer).
- Danach in beiden Fällen: `pageId` = `addScreenshot` → harte Navigation nach
  `/screenshots`; `pageId` = `daily` → `ladeBilder(true, Tagesanfang)`,
  dann `ladeBilder(true)`, dann den Wert des ersten Elements mit Klasse
  `screenshotFile` (Datei-Eingabe) leeren.
- Fehler: Konsole, `seiteLaedt` = falsch, Promise löst NICHT auf
  (Altfehler A-S3; sichtbar wird der Fehler über den zentralen db.js-Hinweis).

Aufrufer: nur `speichereBild`.

**`useDeleteScreenshot()`** → Promise. Argumente werden ignoriert. Löscht
`dbDelete('screenshots', markierterEintrag)`. Auf Seite `screenshots`: das Bild aus
`screenshots` entfernen (KEIN Neuladen – ein Neuladen setzte früher die
Paginierung zurück und verlor die Lösch-Bestätigungen der neuen Karten),
`bildSeite` um 1 verringern (nicht unter 0), `markierterEintrag` = null.
Auf `daily`: im Eintrag von `screenshots` mit dieser `objectId` alle Schlüssel
löschen (das leere Objekt bleibt in der Liste), `screenshot` leeren,
`markierterEintrag` = null. Aufrufer: `app.js` (Lösch-Bestätigung, S.5).

**`ladeBilderNeu()`** → Promise. Spinner an, `bildAbfrageGrenze` = 4,
`bildSeite` = 0, `screenshots` leeren, `ladeBilder(false)`,
`markierterEintrag` = null. Aufrufer: `FilterLeiste.vue` (Filter anwenden auf Seite
`screenshots`, danach `pruefeSichtbarkeit`).

**`useSelectedScreenshotFunction(index, quelle, daten)`** – Auswahl für die
Vollbildansicht.

- `selectedScreenshotIndex` = `index`, `selectedScreenshotSource` = `quelle`.
- Ist `index` wahrheitswertig (also ≠ 0 und definiert; −1 zählt als wahr) UND
  `index + 2` = Länge von `screenshots` UND nicht `listeZuEnde` → Nachladen
  `ladeBilder(false)` anstossen (nicht abgewartet). Grenzfälle: beim
  Index 0 wird nie nachgeladen; mit −1 (Daily) wird nachgeladen, wenn
  `screenshots` genau 1 Element hat – im Neubau nur für `index ≥ 1` und nur auf
  der Seite `screenshots` nachladen.
- `index ≥ 0` → `gewaehltesBild` leeren und mit `screenshots[index]`
  füllen. Sonst (−1 oder keine Zahl) → `daten` in `gewaehltesBild`
  hineinkopieren OHNE vorher zu leeren (Altfehler A-S4: Schlüssel eines vorher
  gezeigten Bildes bleiben stehen, z. B. `side`).

Aufrufer: `Screenshot.vue` (Vergrössern, `index` = Index in der UNGEFILTERTEN
Liste, `quelle` = eigene Quelle), `Daily.vue` (Vorschaubild im Trade-Modal:
`index` −1, `quelle` `dailyModal`, `daten` = `screenshot`),
`ScreenshotVollbild.vue` (Blättern: `index ± 1`, `quelle` `fullScreen`).

### S.5 `src/components/Screenshot.vue` (Bildkarte)

Props: `screenshotData` (Objekt, Felder wie S.1), `showTitle` (Boolean,
ungenutzt), `source` (`screenshots` | `fullScreen` | im Altbestand auch
`addScreenshot`, `dailyModal`, `dailyTab`), `index` (Zahl). Verwendet in
`Screenshots.vue` (`source` = `screenshots`) und `ScreenshotVollbild.vue`
(`source` = `fullScreen`).

Aufbau von oben nach unten:

1. **Kopfzeile** nur bei `fullScreen` und `screenshots`: Datum
   (`useCreatedDateFormat(dateUnix)`, Form „Wochentag TT Monat JJJJ“). Bei
   `fullScreen` rechts ein Schliessen-Knopf: ist `tradeDetailOffen` wahr,
   schliesst er das Vollbild UND öffnet das Daily-Trade-Modal (`#tradesModal`)
   wieder; sonst schliesst er nur das Vollbild.
2. **Infozeile links** (nicht bei `addScreenshot`/`dailyModal`): Symbol; mit
   `side`: „Short“ wenn `side` `SS` oder `BC`, sonst „Long“, dazu Uhrzeit
   `HH:mm:ss`; ohne `side`: Uhrzeit `HH:mm`. Danach die Tags: Tag-Zeile aus
   `tags` mit `tradeId` = `name`; höchstens die ersten 2 als farbige Plaketten
   (Farbe = Gruppenfarbe, Text = Tag-Name über `useGetTagInfo`), bei mehr „+N“
   (N = Anzahl − 2).
3. **Werkzeuge rechts** (nicht bei `fullScreen`):
   - Vergrössern (nur mit `objectId` und nicht `addScreenshot`):
     `useSelectedScreenshotFunction(index, source, screenshotData)`, dann
     Vollbild öffnen (heute Bootstrap-Modal `#fullScreenModal` per
     data-Attribut).
   - Markieren: `useSetupMarkerArea(source, screenshotData)`.
   - Kopieren (nur mit `objectId`): siehe unten.
   - Bearbeiten (nur `source` = `screenshots`): `useEditItem(objectId)` – setzt
     SS `editItemId`, `bildSeite` (aktueller Offset),
     `screenshotIdToEdit` und navigiert hart nach `/addScreenshot`, das der
     Router auf `/screenshots` umleitet. Effekt heute: Seite lädt neu, lädt die
     bisher geladene Menge auf einmal und scrollt zur Karte. Eine
     Bearbeiten-Maske gibt es nicht (Altfehler A-S5).
   - Löschen (nur mit `objectId`, nicht `addScreenshot`): setzt
     `markierterEintrag` = `objectId` und zeigt eine Bestätigung (heute Bootstrap
     Popover links mit „Are you sure? / Yes / No“, hart englisch;
     `useInitPopover` in `app.js` reagiert auf Klicks auf Elemente mit den
     Klassen `popoverDelete`, `popoverYes`, `popoverNo`; ohne Bootstrap
     `confirm(messages.confirmDelete)`). Ja → `useDeleteScreenshot()`;
     Nein → `markierterEintrag` = null.
4. **Bild**: zwei übereinanderliegende Bilder gleicher Grösse – unten
   `originalBase64` mit Element-ID `screenshotDiv-<source>-<objectId>` (ohne
   `objectId`: `…-<dateUnix>`; der Markierungseditor sucht genau diese ID),
   darüber deckungsgleich `annotatedBase64` (transparente Markierungsebene). Auf
   der Seite `addScreenshot` eine andere Containerklasse (tot).

**Kopieren** (`kopiertesBild`): Bildquelle = `annotatedBase64` oder ersatzweise
`originalBase64` (siehe Altfehler A-S1). Ohne Quelle: nichts. Sonst:

1. App-interne Ablage: `kopiertesBild` = `{objectId, name}` (`name` ersatzweise
   `screenshot`), dasselbe als JSON in SS `kopiertesBild` (Fehler ignoriert).
   Das Bild selbst wird NICHT gemerkt; der Einfügende holt es frisch aus der DB.
2. Status „ok“ (Symbol wechselt zu einem Haken, Titel „Kopiert!“, sonst Titel
   „In Zwischenablage kopieren“ – beide hart deutsch) für 1,5 s.
3. Zusätzlich, nur wenn `navigator.clipboard`, `ClipboardItem` und sicherer
   Kontext: das Bild über ein Canvas in PNG umwandeln (Zwischenablage nimmt nur
   PNG) und in die System-Zwischenablage schreiben; Fehler still. Ein Status
   „fehler“ ist vorgesehen, wird aber nie gesetzt.

Weitere Schreiber von `kopiertesBild`: `Livetrading.vue` (Cockpit-Foto). Leser:
`Playbook.vue` (P.8), `Incoming.vue`. Der Wert wird nach dem Einfügen nicht
gelöscht.

### S.6 Bildkompression

Vorgesehen, aber tot: `resizeCompressImg`, `resizeCompressMaxWidth`,
`resizeCompressMaxHeight`, `resizeCompressQuality` werden nirgends gesetzt
(keine Einstellung, kein Laden aus `settings`), also gibt es keine Werte.
Verhalten von `compressImage(img)`, falls es je liefe: Querformat und Breite >
Max-Breite → Breite = Max, Höhe proportional; Hochformat (oder quadratisch) und
Höhe > Max-Höhe → entsprechend. Canvas = neue Grösse × `devicePixelRatio`,
skaliert gezeichnet, als PNG (Qualitätsangabe wirkt bei PNG nicht) zu Blob,
der wieder durch das Einlesen läuft (Original und Anzeigebild überschrieben).
Fehler: Ist keine Verkleinerung nötig, bleiben die Zielmasse vom VORIGEN Aufruf
oder undefiniert stehen (Modulvariablen); und der Aufrufer sucht ein Element
`#screenshotDiv`, das es nicht gibt. **Empfehlung:** Im Neubau nicht nachbauen
oder als echte Einstellung (z. B. Max 1920 px, WebP/JPEG 0,85) – dann bewusst und
in der Einstellungen-Spezifikation. Die Exporte `compressImage`,
`useSetupImageFile`, `useSetupImageUpload` müssen als Funktionen weiter
existieren (werden importiert).

### S.7 `src/views/Screenshots.vue` (Seite `/screenshots`)

Route `/screenshots`, Name `screenshots`, Titel-Schlüssel `nav.screenshots`,
Menü-Eintrag im Modus `journal`, Gruppe `reflect`. `/addScreenshot` leitet
hierher um.

- **Laden:** beim Einhängen `starteBilder()` (ablauf.js: Spinner,
  `leseBildSeite`, Zeitraum, Tags und Tag-Katalog laden,
  `ladeBilder(false)`, `useInitPopover`), danach Scroll-Beobachter am
  Fenster anmelden und `pruefeSichtbarkeit()` (lädt nach, solange die Seite
  nicht scrollbar ist). Beim Aushängen den Beobachter wieder abmelden (benannte
  Funktion – früher stapelte jeder Besuch einen weiteren).
- **Endlos-Scroll:** Ist der Abstand bis zum Seitenende ≤ 200 px (Fensterhöhe +
  200 ≥ Restdokument) und weder `ladeMehr` noch `seiteLaedt`
  noch `listeZuEnde` und `expandedScreenshot` == null → `ladeWeitere()`
  (ablauf.js → `ladeBilder(false)` mit `ladeMehr`).
- **Typ-Filter** (nur clientseitig über die geladene Liste, nicht gespeichert):
  „Alle“ (`common.all`), „Eröffnung“ (`screenshots.opening`): `side` `B` oder
  `SS` und `name` enthält nicht `_closing`; „Abschluss“
  (`screenshots.closing`): `side` `BC` oder `name` enthält `_closing`.
  Altfehler A-S6: Playbook-Bilder tragen `side` `long`/`short` und erscheinen
  daher NIE unter „Eröffnung“; Cockpit-Fotos (`side` '') auch nicht.
- **Leer:** Ist die gefilterte Liste leer → Komponente `NoData`.
- **Raster:** je Bild eine Karte (1 Spalte schmal, 2 mittel, 3 breit); Element-ID
  der Karte = `objectId` (Ziel von `scrolleZuBild`). Inhalt:
  `Screenshot` mit `source` `screenshots` und `index` = Position in der
  UNGEFILTERTEN Liste `screenshots`. Bildbereich in der Kachel höchstens 250 px
  hoch, Überlauf abgeschnitten.
- **Playbook-Link** unter jeder Karte mit `name`: Link
  `/playbook?tradeId=<name URL-kodiert>`, Text `nav.playbook`. Altfehler A-S7:
  Funktioniert nur, wenn `name` exakt eine Trade-ID ist; für
  `<tradeId>_entry` usw. findet das Playbook nichts. Empfehlung: Trade-ID aus
  dem Namen ableiten (Endung `_entry`/`_trend`/`_closing` abschneiden) und den
  Link nur zeigen, wenn eine Trade-ID erkennbar ist.
- **Nachlade-Kreisel** unten, solange `ladeMehr`.
- Globale Seitenspinner-Komponente `SeiteLaedt` oben; das Raster ist
  verborgen, solange `seiteLaedt`.

Monatsfilter: Die Screenshots-Seite filtert NICHT nach Monat/Zeitraum; nur Tags
und Börse (S.4). Die Filterleiste löst über `ladeBilderNeu` neu aus.

i18n: `common.all`, `screenshots.opening`, `screenshots.closing`,
`nav.playbook`, `nav.screenshots`; in `screenshots.js`:
`common.screenshotSaveAnnotation`, `common.screenshotAddSymbol`,
`common.screenshotAddImage`; Löschbestätigung ohne Bootstrap:
`messages.confirmDelete`. Hart kodiert (im Neubau als Schlüssel anlegen):
„Kopiert!“, „In Zwischenablage kopieren“, „Are you sure?“, „Yes“, „No“.

### S.8 Bildmarkierung heute (markerjs2) – Verhalten

`useSetupMarkerArea(quelle, bildDaten)`:

1. Bei `quelle` `dailyTab` oder `screenshots`: `screenshot` leeren und mit einer
   tiefen Kopie von `bildDaten` füllen (sonst wird der vorhandene Inhalt von
   `screenshot` benutzt – Daily-Modal).
2. Ziel-Element: Bild mit ID `screenshotDiv-<quelle>-<objectId>` (ohne
   `objectId`: `…-<dateUnix>`) – das ORIGINALBILD (untere Ebene).
3. Editor-Einstellungen: Ausgabe in natürlicher Bildgrösse, Bildqualität 1,
   **nur Markierungen ausgeben** (transparentes PNG ohne das Foto),
   Anzeigeart „popup“ (Editor als Überlagerung über der Seite), **alle 13
   Markertypen** freigeschaltet (Liste in S.9), Vorgaben: Füllfarbe
   `#ffffffde` (fast weiss, leicht transparent – Hintergrund von Sprechblasen),
   Strichfarbe `black` (Schriftfarbe von Sprechblase und Bildunterschrift),
   Farbe `white` (Linien, Pfeile, Rahmen, Freihand, Text), Strichbreite 2, „Vorgabefarben
   folgen der zuletzt gewählten Farbe“ an. Alles andere Bibliotheks-Vorgaben
   (Farbpalette rot, grün, blau, gelb, violett, rosa, schwarz, weiss;
   Strichbreiten 1/2/3/5/10; Strichmuster durchgezogen, „3“, „12 3“,
   „9 6 3 6“; Deckkraftstufen 0,1/0,25/0,5/0,75/1; Hervorhebung gelb mit 0,5;
   Schrift Helvetica/Arial; Vorgabetext „Your text here“).
4. Ereignisse:
   - nur auf Daily, Quelle `dailyModal`: beim Erzeugen oder Auswählen eines
     Markers das Trade-Modal ausblenden.
   - **render** (Benutzer bestätigt): bei `dailyModal` Modal wieder zeigen und
     `tradeBildGeaendert`, `tagesBildGeaendert`, `speichernNoetig` = wahr;
     `markierungOffen` = falsch; `screenshot.annotatedBase64` = gerenderte
     Daten-URL (nur Markierungen), `screenshot.maState` = Zustand (S.9). Bei
     `dailyTab`/`screenshots`: in `screenshots` den Eintrag mit GLEICHEM
     `dateUnix` suchen (nicht `objectId` – Altfehler A-S8), dort dieselben zwei
     Felder setzen und sofort `speichereBild()` (speichert und benennt um,
     A-S2). `zeichenZaehler` +1.
   - **close** (verworfen): bei `dailyModal` Modal wieder zeigen;
     `markierungOffen` = falsch.
5. Editor anzeigen; ist er offen → `markierungOffen` = wahr.
6. Ist `screenshot.maState` wahr (also auch `{}`), wird er wiederhergestellt.
   Bei `{}` wirft die Bibliothek (kein `markers`-Feld) – Altfehler A-S9: Bilder
   aus Playbook/Incoming (`maState: {}`) lassen sich nur mit Konsolenfehler
   markieren; der Editor ist dann aber offen und leer.

Erreichbarkeit heute: Markieren gibt es nur auf der Screenshots-Seite (Quelle
`screenshots`). Die Quellen `dailyModal`/`dailyTab` existieren im Code, aber
keine Ansicht rendert `Screenshot.vue` mit ihnen; Daily zeigt nur ein
Vorschaubild, das das Vollbild öffnet, und dort sind die Werkzeuge
ausgeblendet. Der Neubau muss die Daily-Zweige nicht nachbauen, die
Funktions-Signatur aber behalten.

### S.9 Gespeichertes Format `maState` (Bibliotheksformat markerjs2 2.x)

Wurzel (`MarkerAreaState`):

| Feld | Typ | Bedeutung |
|---|---|---|
| `width` | Zahl | Breite der Editier-Fläche in Pixeln beim Speichern = ANZEIGEbreite des Bildes im Editor, NICHT die natürliche Bildbreite |
| `height` | Zahl | Höhe entsprechend |
| `markers` | Liste | ein Objekt je Marker, Zeichenreihenfolge = Listenreihenfolge (später = oben) |

Alle Koordinaten der Marker liegen im Raum `width × height` (Ursprung oben
links, y nach unten). Beim Wiederherstellen skaliert die Bibliothek mit
(aktuelle Breite / `width`, aktuelle Höhe / `height`), falls die Fläche anders
gross ist. Für das Zeichnen auf das Originalbild gilt also Faktor
`naturalWidth / width` bzw. `naturalHeight / height`.

Gemeinsame Felder jedes Markers (`MarkerBaseState`): `typeName` (Klassenname,
siehe Tabelle), `state` (Editierzustand beim Speichern: `new`, `creating`,
`select`, `move`, `resize`, `rotate`, `edit` – für die Darstellung bedeutungslos),
`notes` (optional, freier Text, die App setzt ihn nie).

**Rechteck-Familie** (`RectangularBoxMarkerBaseState`) zusätzlich:
`left`, `top` (linke obere Ecke des UNGEDREHTEN Rechtecks), `width`, `height`,
`rotationAngle` (Grad, im Uhrzeigersinn, Drehpunkt = Mittelpunkt des Rechtecks),
`visualTransformMatrix` und `containerTransformMatrix` (je `{a,b,c,d,e,f}`,
SVG-Matrix; die erste enthält die Verschiebung auf `left/top`, die zweite die
Drehung um den Mittelpunkt – beim Lesen kann man beide ignorieren und aus
`left/top/width/height/rotationAngle` rechnen).

**Linien-Familie** (`LinearMarkerBaseState`) zusätzlich: `x1`, `y1`, `x2`, `y2`
(Endpunkte in Flächenkoordinaten; keine Drehung).

Je Typ (die 13 Typen in der Reihenfolge der Werkzeugleiste; markerjs2 kennt
genau diese, die App schaltet ALLE frei):

| `typeName` | Familie | zusätzliche Felder | Darstellung |
|---|---|---|---|
| `FrameMarker` | Rechteck | `fillColor` (`transparent`), `strokeColor`, `strokeWidth`, `strokeDasharray` (SVG-Muster, '' = durchgezogen), `opacity` | Rechteck-Rahmen |
| `FreehandMarker` | Rechteck | `drawingImgUrl` | Freihand: KEINE Punkte, sondern ein PNG (Daten-URL) der Zeichnung, das auf das Rechteck `left/top/width/height` gespannt wird (Pixelfaktor 1) |
| `ArrowMarker` | Linie | `strokeColor`, `strokeWidth`, `strokeDasharray`, `arrowType` (`both`, `start`, `end`, `none`; Vorgabe `end` = Spitze bei `x2/y2`) | Pfeil |
| `TextMarker` | Rechteck | `color`, `fontFamily`, `padding` (Zahl, px), `text` (Zeilen durch Zeilenumbruch getrennt), `wrapText` (optional, Vorgabe falsch) | Text; die Schriftgrösse ist NICHT gespeichert, sie ergibt sich: der Text wird so skaliert, dass er die Box (abzüglich `padding`) füllt |
| `EllipseFrameMarker` | Rechteck | wie `FrameMarker` | Ellipsen-Rahmen in der Box |
| `EllipseMarker` | Rechteck | `fillColor`, `strokeColor`, `strokeWidth`, `strokeDasharray`, `opacity` | gefüllte Ellipse |
| `HighlightMarker` | Rechteck | wie Rechteck (`fillColor` = Hervorhebungsfarbe, `opacity` Vorgabe 0,5, Strich 0) | halbtransparentes Feld |
| `CalloutMarker` | Rechteck | wie `TextMarker` plus `bgColor` (Hintergrund) und `tipPosition` `{x,y}` (Spitze der Sprechblase RELATIV zu `left/top`) | Sprechblase |
| `MeasurementMarker` | Linie | wie Linie | Linie mit Querstrichen an den Enden und Längenangabe in Pixeln |
| `CoverMarker` | Rechteck | wie Rechteck (`fillColor` deckend) | deckendes Feld (Schwärzen) |
| `LineMarker` | Linie | `strokeColor`, `strokeWidth`, `strokeDasharray` | Linie |
| `CurveMarker` | Linie | `strokeColor`, `strokeWidth`, `strokeDasharray`, `curveX`, `curveY` (Kontrollpunkt einer quadratischen Kurve von `x1/y1` nach `x2/y2`) | Kurve |
| `CaptionFrameMarker` | Rechteck | `fillColor`, `strokeColor`, `strokeWidth`, `strokeDasharray`, `opacity` (immer 1), `textColor`, `fontFamily`, `fontSize` (CSS-Wert, Vorgabe `1rem`), `captionText` (Vorgabe „Text“) | Rahmen mit Titelleiste |

Mit den Einstellungen der App entstehen typischerweise: Rahmen, Linien, Pfeile,
Freihand und Text in Weiss mit Strichbreite 2; Sprechblasen mit schwarzer
Schrift auf `#ffffffde`. Weil „Farben folgen der zuletzt gewählten“ an ist,
kann jede Palettenfarbe vorkommen; Farben sind CSS-Farbwerte (Hex mit oder ohne
Alpha, Namen wie `white`/`black`, `transparent`).

Mögliche gespeicherte Werte insgesamt: Feld fehlt; `{}` (Playbook, Incoming);
`null` (Cockpit-Foto); Text, der kein JSON ist (theoretisch, bleibt Text);
vollständiger Zustand wie oben. Echte Beispiel-Datenbanken lagen im Projekt
nicht vor (keine `*.db` im Worktree oder Hauptordner; die NAS-DB wurde nicht
angefasst); Form und Felder stammen aus den Typdefinitionen und dem
`getState`-Verhalten der Bibliothek.

### S.10 Neubau der Bildmarkierung (Anforderungen)

Ersetzt markerjs2 durch eigenen Code (z. B. SVG- oder Canvas-Ebene in einem
`basis/Dialog`). Pflicht-Werkzeuge: Pfeil, Rechteck(-Rahmen), Linie, Text,
Freihand, Rückgängig (mindestens mehrstufig), dazu Auswahl/Verschieben/Löschen
eines Markers, Farbe und Strichbreite. Speichern und Verwerfen als ausdrückliche
Knöpfe; Esc = Verwerfen mit Rückfrage, wenn etwas geändert wurde.

Schnittstelle bleibt: `useSetupMarkerArea(quelle, bildDaten)` öffnet den
Editor für das Bild; `markierungOffen` ist wahr, solange er offen ist; nach
Speichern stehen `annotatedBase64` und `maState` am Bild (in `screenshot` und
in `screenshots`) und es wird gespeichert; nach Verwerfen `markierungOffen` =
falsch, nichts geschrieben.

Lesen alter Zustände (Pflicht): Alle 13 `typeName` aus S.9 müssen mindestens
ANGEZEIGT werden können; die fünf Werkzeugtypen müssen weiter bearbeitbar sein.
Empfohlene Abbildung: `FrameMarker` → Rechteck; `ArrowMarker` → Pfeil (mit
`arrowType`); `LineMarker`, `MeasurementMarker` (ohne Längenangabe) → Linie;
`TextMarker` → Text (Schriftgrösse aus Boxhöhe ÷ Zeilenzahl ableiten);
`FreehandMarker` → als Bild-Marker übernehmen (Punkte gibt es nicht); übrige
Typen (Ellipse, Hervorhebung, Abdeckung, Sprechblase, Kurve, Bildunterschrift)
als schreibgeschützte Altmarker zeichnen oder einmalig in Rechteck/Text
umwandeln. Unbekannte Typen werden übersprungen, nicht verworfen (beim
Speichern unverändert behalten). `{}`, `null`, fehlend → leere Markierung
(behebt A-S9). Koordinaten mit `width/height` des Zustands auf die eigene Fläche
skalieren. Empfehlung: eigenes neues Format mit Versionsfeld (z. B. `v: 2`) und
Koordinaten RELATIV zur natürlichen Bildgrösse (0–1), damit Anzeigegrösse keine
Rolle mehr spielt; alte Zustände beim ersten Speichern migrieren.

Ausgabe (Empfehlung, behebt A-S1): `annotatedBase64` = Original MIT
eingebrannten Markierungen (ein Bild), weil Playbook, Daily, Kopieren und die
KI `annotatedBase64` als vollständiges Bild benutzen. Die Kartenanzeige zeigt
dann nur noch `annotatedBase64` (oder `originalBase64`, wenn leer). Alte Zeilen
mit reiner Markierungsebene: erkennbar an vorhandenem `maState` mit Markern;
die Karte kann für sie weiter Original + Ebene übereinander zeigen, bis sie neu
gespeichert werden. Diese Änderung ist bewusst und in der Commit-Nachricht zu
nennen.

### S.11 `ScreenshotVollbild.vue` – was sie erwartet (eigener Code, bleibt)

Eingehängt einmal in `layouts/Dashboard.vue`. Liest `selectedScreenshotIndex`,
`gewaehltesBild`, `screenshots`, `holtWeitere` (Filter-Store; wird von niemandem
mehr gesetzt, ist also immer falsch) und ruft
`useSelectedScreenshotFunction(index ± 1, 'fullScreen')`. Zeigt
`Screenshot.vue` mit `source` `fullScreen`, `index` und `screenshot-data` =
`gewaehltesBild`, sobald `gewaehltesBild` Schlüssel hat. Zurück-Knopf,
wenn der Index eine ganze Zahl ≥ 1 ist; Weiter-Knopf, wenn der Index eine ganze
Zahl ≥ 0 ist und `screenshots[index+1]` existiert. Geöffnet wird sie heute als
Bootstrap-Modal mit der festen ID `fullScreenModal` durch data-Attribute an den
Öffnern (`Screenshot.vue` Vergrössern, Daily-Vorschaubild); geschlossen durch
den Knopf in der Kopfzeile von `Screenshot.vue`. Für S9: Öffnen/Schliessen wird
eine Funktion (z. B. Store-Flag), die beide Öffner und der Schliessen-Knopf
aufrufen; der Rückweg ins Daily-Trade-Modal (wenn `tradeDetailOffen`) muss
erhalten bleiben.

### S.12 Bootstrap-JS, das in diesem Teil benutzt wird

- **Modal**: Vollbild `#fullScreenModal` (öffnen per data-Attribut am
  Vergrössern-Symbol bzw. Daily-Vorschaubild; schliessen per
  Schliessen-Knopf), Wechsel zurück zu `#tradesModal` (Daily).
- **Popover**: Lösch-Bestätigung an jedem Lösch-Symbol (HTML-Inhalt mit
  Ja/Nein, Platzierung links), initialisiert durch `useInitPopover()` nach dem
  Laden; Ersatz: kleine eigene Bestätigung (z. B. Zwei-Klick-Löschen wie im
  Nachrichten-Archiv oder `basis/Dialog`).
- Sonst nur CSS-Klassen (Raster, Abstände, Spinner, Schliessen-Kreuz) und
  Unicons-Symbole (vergrössern, bearbeiten, kopieren/Haken/Kreuz, Stift,
  Papierkorb, Pfeile) → `basis/Symbol`.

### S.13 Altfehler Screenshots (markiert, mit Empfehlung)

- **A-S1** Nach einer Markierung enthält `annotatedBase64` NUR die
  Markierungsebene (transparent). Alle Leser, die „`annotatedBase64` oder
  `originalBase64`“ nehmen – Kopieren, Playbook-Vorschau und -Vollbild,
  Daily-Vorschaubild, Trade-KI-Bewertung, KI-Berichte, `analyze_screenshot` –
  bekommen dann ein Bild ohne Chart. Empfehlung: eingebranntes Gesamtbild
  speichern (S.10).
- **A-S2** `speichereBild` überschreibt `name` bei jeder Markierung mit
  `t<dateUnix>_<symbol>_<side>` bzw. `<dateUnix>_<symbol>`. Bilder aus dem
  Playbook (`<tradeId>_entry`) und Incoming verlieren so ihre Namensverknüpfung;
  das Playbook findet sie nur noch, wenn die ID in der Notiz steht.
  Empfehlung: `name` beim Markieren unverändert lassen.
- **A-S3** `speichereBild`/`ladeBildHoch` lösen bei Abbruch
  oder DB-Fehler nie auf. Empfehlung: immer auflösen (oder ablehnen).
- **A-S4** Vollbild ohne Index leert `gewaehltesBild` nicht vorher.
- **A-S5** „Bearbeiten“ führt nur zu Neuladen und Scrollen. Empfehlung:
  Symbol weglassen oder echte Bearbeitung (Symbol, Seite, Datum) in einem Dialog.
- **A-S6** Typ-Filter kennt `long`/`short` nicht (Playbook-Bilder fehlen unter
  „Eröffnung“). Empfehlung: `long`/`B`/`SS`/`short` als Eröffnung, plus
  Namensendungen `_entry`/`_trend` als Eröffnung und `_closing` als Abschluss.
- **A-S7** Playbook-Link nur bei exakter Trade-ID (S.7).
- **A-S8** Die Markierung wird dem Listeneintrag über `dateUnix` zugeordnet;
  zwei Bilder mit gleicher Sekunde → falsches Bild; kein Treffer → Laufzeitfehler.
  Empfehlung: über `objectId`.
- **A-S9** `maState` `{}` lässt die Bibliothek werfen (S.8).
- **A-S10** Paginierung vor dem Filtern; Börsenfilter lädt bei jedem Nachladen
  alle Trades (S.4).
- **A-S11** Kompression tot und fehlerhaft (S.6).

---

## Playbook (`src/views/Playbook.vue`)

### P.1 Zweck, Route, Einstieg

Seite `/playbook`, Routenname `playbook`, Titel-Schlüssel `nav.playbook`,
Menü-Eintrag im Modus `journal`, Gruppe `reflect`, Symbol „Kompass“.
`/addPlaybook` leitet auf `/daily` um. Die Seite ist trotz des Namens KEINE
Verwaltung von Playbook-Strategien, sondern die Liste der
**Trade-Bewertungen** (Überschrift `playbook.tradeEvaluations`): je Trade mit
einer Notiz eine aufklappbare Karte mit Eröffnungsbewertung, Füllungen/SL/TP
und Abschlussbewertung, bearbeitbar.

Query-Parameter: `tradeId` (optional). Einstiege von aussen:
`Screenshots.vue` (`/playbook?tradeId=<Bildname>`),
`einstellungen/allgemein/Importe.vue` (`/playbook?tradeId=<Trade-ID>`, Knopf
„Bewerten“). Beide sind harte Links (Seitenneuladen).

### P.2 Datenmodell

Die Seite liest und schreibt vier Tabellen; die Tabelle `playbooks`
(`dateUnix`, `date`, `playbook`) benutzt sie NICHT (die liest nur das
KI-Werkzeug `query_playbooks` und die Sicherung).

**`notes`** (eine Zeile je Trade, Schlüssel `tradeId`):

| Feld | Vorgabe | Bedeutung im Playbook |
|---|---|---|
| `objectId` | – | → `noteObjectId` |
| `dateUnix` | – | Tag des Trades (Tagesanfang; beim Anlegen = `dateUnix` der Tageszeile) |
| `tradeId` | '' | Trade-ID; Zeilen ohne `tradeId` werden übergangen |
| `note` | '' | HTML; Altformat (P.4) und Spiegel der Eröffnungsnotiz: beim Speichern = `playbook`-HTML, leer → `<p>-</p>` |
| `tradeType`, `closingTradeType` | '' | `scalp` / `day` / `swing` / '' |
| `entryStressLevel`, `emotionLevel` | 0 | 0–10 (0 = nicht gesetzt) |
| `entryNote` | '' | Altfeld „Einstiegsgrund“; wird erhalten, nicht bearbeitet, nicht angezeigt |
| `feelings` | '' | Freitext „Emotionen“ (Eröffnung) |
| `playbook` | '' | HTML aus dem Quill-Editor (Eröffnungsnotiz) |
| `timeframe` | '' | Zeitrahmen-Wert, z. B. `15m`, `4h`, `1D` |
| `screenshotId` | '' | `objectId` des Eröffnungsbildes |
| `trendScreenshotId` | '' | `objectId` des zweiten Eröffnungsbildes – wird von der Seite NICHT geladen und nicht gespeichert, nur beim Entfernen auf '' gesetzt (Altfehler A-P1) |
| `closingNote` | '' | Altfeld „Abschlussnotiz (alt)“; nur angezeigt, wenn `closingPlaybook` leer ist |
| `closingStressLevel`, `closingEmotionLevel` | 0 | werden geladen und unverändert zurückgeschrieben (keine Eingabe) |
| `closingFeelings`, `closingTimeframe` | '' | ebenso |
| `closingPlaybook` | '' | HTML aus dem zweiten Quill-Editor (Abschlussnotiz) |
| `closingScreenshotId` | '' | `objectId` des Abschlussbildes |
| `tradingMetadata` | '' (JSON-Spalte) | nur gelesen, siehe P.7 |
| `exitStressLevel`, `title`, `strategyFollowed`, `aiReview*` | | nicht benutzt, nicht überschrieben |

**`satisfactions`**: `dateUnix`, `tradeId`, `satisfaction`. Werte im Playbook:
`1` = zufrieden (Daumen hoch), `2` = neutral (Faust), `0` = unzufrieden (Daumen
runter), keine Zeile/`null` = nicht bewertet. (Die Journal-Kern-Spezifikation
nennt nur 0/1; `2` schreibt jedenfalls diese Seite.)

**`tags`**: `dateUnix`, `tradeId`, `tags` (Liste von Tag-IDs, Eröffnung),
`closingTags` (Liste, Abschluss). Beide JSON-Spalten. Dieselbe Zeile benutzt
Daily für die Trade-Tags.

**`screenshots`**: siehe S.1. Das Playbook legt Bilder an und löscht sie (P.8).

Gelesen ausserdem: Trade-Tageszeilen (`trades`, Feld `trades[]` mit `id`,
`symbol`, `strategy` (`long`/`short`), `netProceeds`, `grossProceeds`,
`broker`), Tag-Katalog (`verfuegbareTags`: Gruppen `{id, name, color, tags:[{id,
name}]}`), Zeitrahmen (`allTradeTimeframes`, `selectedTradeTimeframes`),
`selectedBroker`, `timeZoneTrade`, `kopiertesBild`.

### P.3 Laden (`loadPlaybookEntries`) und Seitenstart

Beim Start (vor dem Einhängen): `seiteLaedt` an,
`ladeVerfuegbareTags()` (Katalog), Einträge laden, Spinner aus. Danach
Deep-Link (P.5).

Einträge laden – parallel:

- `notes`: absteigend nach `dateUnix`, Limit 200
- `satisfactions`: Limit 500 (ohne Sortierung)
- `tags`: Limit 500
- `trades`: absteigend nach `dateUnix`, Limit 200 (Tageszeilen)
- `screenshots`: absteigend nach `dateUnix`, Limit 500, ohne `original`,
  `annotated`, `maState` (Base64 wird also geladen – teuer)

Börse: Ist `selectedBroker` gesetzt, bleiben nur Bilder mit leerem `broker` oder
genau dieser Börse; nur Tageszeilen, in denen mindestens ein Trade dieser Börse
steht. Nachschlagetabellen: Trade-ID → (Tageszeile, Trade) über ALLE Trades der
(gefilterten) Tageszeilen; `tradeId` → Zufriedenheitszeile; `tradeId` →
Tag-Zeile (bei mehreren gewinnt die zuletzt gelesene).

Für jede Notiz mit `tradeId` (Reihenfolge = Notizreihenfolge, also neueste
zuerst): Ist eine Börse gewählt und der Trade nicht gefunden → überspringen.
Sonst ein Eintrag mit:

| Feld | Quelle |
|---|---|
| `noteObjectId`, `tagRecordObjectId`, `satisfactionObjectId` | `objectId` der Zeilen bzw. null |
| `dateUnix`, `tradeId` | Notiz |
| `tradeType`, `timeframe`, `feelings`, `playbook`, `entryNote`, `entryStressLevel`, `emotionLevel`, `screenshotId` | Notiz; leer/0 → Wert aus dem Altformat-Parser (nur für `entryStressLevel`, `entryNote`, `feelings`, `playbook`, `timeframe`), sonst '' bzw. 0 |
| alle `closing…`-Felder aus P.2 | Notiz, '' bzw. 0 |
| `note` | Notiz oder '' |
| `satisfaction` | Wert aus der Zufriedenheitszeile oder `null` |
| `tags`, `closingTags` | Tag-IDs aufgelöst zu `{id, name, color}`: Name = Tag-Name oder ersatzweise die ID, Farbe = Gruppenfarbe oder ersatzweise `#6c757d` (`useGetTagInfo` liefert immer ein Objekt; unbekannte Tags werden also mit ihrer ID als Name gezeigt) |
| `symbol` | Trade-Symbol, sonst Symbol des ersten Trades der Tageszeile, sonst '' |
| `side` | `strategy` des Trades (`long`/`short`) oder '' |
| `pnl` | `netProceeds`, sonst `grossProceeds`, sonst 0 |
| `tradingMetadata` | Notiz oder null |

Kein `trendScreenshotId` im Eintrag (A-P1). Grenzfall: Ohne Börse werden Notizen
auch gezeigt, wenn ihr Trade nicht unter den 200 neuesten Tageszeilen ist –
dann ohne Symbol und ohne PnL; mit Börse fallen sie weg.

### P.4 Altformat-Parser für `note`

Wird nur angewandt, wenn `feelings`, `playbook` und `entryStressLevel` leer sind
und `note` nicht leer und nicht `<p>-</p>` ist. Hintergrund: Ältere Stände
(Incoming → Trade-Verknüpfung in `quickImport.js`) schrieben alles als HTML in
`note`. Erkannt und aus dem Rest herausgeschnitten werden – jeweils der erste
Treffer, als ganzer Absatz:

1. fett „Einstiegs-Stresslevel: N/M“ → `entryStressLevel` = N
2. sonst fett „Stresslevel: N/M“ → `entryStressLevel` = N (nur wenn 1 nichts fand)
3. fett „Ausstiegs-Stresslevel: N/M“ → nur entfernen
4. fett „Timeframe: X“ (X = Wortzeichen) → `timeframe` = X
5. kursiv „Einstiegs-Grund: TEXT“ → `entryNote` = TEXT
6. der nächste kursive Absatz → `feelings` = sein Inhalt
7. der getrimmte Rest → `playbook`, ausser er ist leer, `<p>-</p>`,
   `<p><br></p>` oder `<p></p>`.

Ein Absatz meint genau die Folge Absatz-Anfang, (fett|kursiv)-Anfang, Text,
Ende, Absatz-Ende ohne weitere Formatierung. Die Skala M wird ignoriert (alte
Stände nutzten /5, der Wert wird trotzdem 1:1 als /10 gezeigt – bewusst so
lassen, nur dokumentiert). Nichts davon wird zurückgeschrieben, bis der Nutzer
speichert.

### P.5 Deep-Link `?tradeId=`

Nach dem Laden, wenn `tradeId` in der Query steht:

1. Eintrag mit dieser `tradeId` suchen.
2. Nicht gefunden: die 500 neuesten Tageszeilen laden (ohne Börsenfilter) und
   den Trade mit dieser ID suchen. Gefunden → eine Notiz anlegen mit
   `dateUnix` der Tageszeile, `tradeId`, `note` `<p>-</p>`, Stress/Emotion 0,
   leeren Text-/Zeitrahmen-/Playbook-Feldern für Eröffnung und Abschluss
   (Felder: `entryStressLevel`, `emotionLevel`, `entryNote`, `feelings`,
   `playbook`, `timeframe`, `closingNote`, `closingStressLevel`,
   `closingEmotionLevel`, `closingFeelings`, `closingTimeframe`,
   `closingPlaybook`); Einträge neu laden; erneut suchen. Nicht gefunden →
   nichts (kein Hinweis; Altfehler A-P2: z. B. Bildnamen aus S.7).
3. Gefunden: aufklappen; hat der Eintrag noch keine Daten (P.9 `journalHatDaten`) →
   direkt in den Bearbeitungsmodus; nach 100 ms die Karte (Element-ID
   `playbook-<tradeId>`) sanft an den oberen Rand scrollen.

Grenzfall: Ist eine Börse gewählt, zu der der Trade nicht gehört, wird zwar die
Notiz angelegt, der Eintrag aber vom Börsenfilter verworfen → nichts geht auf,
und beim nächsten Aufruf existiert die Notiz schon.

### P.6 Quill-Editor

Bibliothek `quill` 2.0.x (Lizenz BSD-3-Clause, darf bleiben), Thema „snow“
(Stylesheet der Bibliothek). Zwei Instanzen je Eintrag im Bearbeitungsmodus:
Eröffnung (Element-ID `quillPlaybook-<tradeId>-opening`) und Abschluss
(`quillPlaybook-<tradeId>-closing`), gemerkt unter `<tradeId>_opening` /
`<tradeId>_closing`. Erzeugt beim Betreten des Bearbeitungsmodus nach dem
nächsten Render, nur wenn das Element existiert und für den Schlüssel noch keine
Instanz gemerkt ist.

- Werkzeugleiste (genau diese, in dieser Reihenfolge): Überschrift (Auswahl:
  Überschrift 1, Überschrift 2, normal); fett, kursiv, unterstrichen;
  nummerierte Liste, Aufzählung; Formatierung entfernen. KEIN Bild-, Link-,
  Farb- oder Code-Knopf.
- Platzhalter: `incoming.note` + „...“.
- Anfangsinhalt: `sanitizeHtml(playbook)` bzw. `sanitizeHtml(closingPlaybook)`,
  direkt als HTML in den Editorinhalt gesetzt.
- Auslesen beim Speichern: das HTML des Editorinhalts unverändert (nicht noch
  einmal gesäubert; gesäubert wird bei jeder Anzeige).
- Abbrechen und erfolgreiches Speichern vergessen die beiden gemerkten
  Instanzen (sie werden nicht ausdrücklich zerstört; das DOM verschwindet mit
  dem Bearbeitungsmodus).
- Bild-Einfügen: Es gibt keinen Bildknopf. Wird ein Bild in den Editor
  EINGEFÜGT, fügt Quill 2 es selbst als `<img src="data:…">` ein UND der
  seitenweite Einfüge-Handler (P.8) legt es zusätzlich als Screenshot ab
  (Altfehler A-P3). Bei der Anzeige entfernt `sanitizeHtml` das `src` (nur
  `http(s)`, `/`, `#`, `mailto:` erlaubt) → ein leeres Bild bleibt im HTML.
  Empfehlung: im Editor Bild-Einfügen unterbinden (Bilder gehören in die
  Bildfelder).

`sanitizeHtml` (`src/utils/sanitize.js`, DOMPurify): erlaubt Überschriften
h1–h6, Absatz, Umbruch, Linie, fett/kursiv/unterstrichen/durchgestrichen,
Listen, Links, Bilder, Tabellen, Zitat, Code, `span`/`div`, hoch/tief,
`mark`, `small`; Attribute `href`, `target`, `rel`, `src`, `alt`, `title`,
`class`, `style`, `id`, `colspan`, `rowspan`; `style` nur mit einer
Positivliste von Eigenschaften (Farbe, Hintergrundfarbe, Schriftgrösse/-stärke/
-stil, Textauszeichnung, Ausrichtung, Ränder, Innenabstände, Zeilenhöhe,
Listenstil); `href`/`src` nur mit den genannten Schemata. Alle HTML-Ausgaben der
Seite (`playbook`, `closingPlaybook`, `closingNote`) laufen vor `v-html` durch
diese Funktion; ebenso die Hilfsfunktion „HTML → reiner Text“ (für
Leer-Prüfungen), die das gesäuberte HTML in ein losgelöstes Element setzt und
dessen Text liest.

### P.7 Kartenaufbau (Ansicht)

Kopf (Klick klappt auf/zu, siehe P.9):

- links: Symbol (gross), Seiten-Plakette, wenn `side` gesetzt: Text „LONG“
  (`long` oder `B`) bzw. „SHORT“ (`short`, `SS`, `S`), sonst der Rohwert; grün
  bei Long, sonst rot. Ist die Karte offen und nicht im Bearbeitungsmodus: ein
  Stift-Symbol (Titel `common.edit`) startet den Bearbeitungsmodus (Klick geht
  nicht an den Kopf weiter). Dann das Datum `useCreatedDateFormat(dateUnix)`.
- rechts: Zufriedenheit als Emoji (1 👍, 2 ✊, 0 👎; null nichts), PnL wenn ≠ 0
  mit Vorzeichen „+“ bei ≥ 0, zwei Nachkommastellen, grün/rot (Klassen
  `greenTrade`/`redTrade`), Pfeil auf/ab.
- **Zusammenfassung im zugeklappten Zustand** (nur wenn `journalHatDaten`): Trade-Typ
  (bei abweichendem `closingTradeType`: Eröffnungstyp orange → Pfeil →
  Abschlusstyp grün; sonst eine Pille mit `closingTradeType` oder `tradeType`),
  „`incoming.stress` N/10“ wenn Stress > 0, Zeitrahmen, Eröffnungs-Tags (Pille in
  Tag-Farbe, weisse Schrift), Abschluss-Tags (dasselbe, 70 % Deckkraft; Farbe
  ersatzweise über `useGetTagInfo`).

Typ-Beschriftung: `scalp` → `incoming.scalptrade`, `day` →
`incoming.daytrade`, `swing` → `incoming.swingtrade`, andere → Rohwert.

**Offen, Ansichtsmodus** – drei Blöcke, jeder nur wenn er Inhalt hat:

1. **Eröffnungsbewertung** (`incoming.openingEvaluation`, grüner Akzent).
   Sichtbar, wenn eines gesetzt: Typ, Stress > 0, Tags, Zeitrahmen, Emotion > 0,
   `feelings`, Eröffnungsnotiz mit Text, Trend- oder Eröffnungsbild. Felder
   (Raster, je Feld Beschriftung + Wert, nur wenn gesetzt):
   Trade-Typ (`incoming.tradeType`, wie Zusammenfassung); Zeitrahmen
   (`incoming.timeframe`); Stresslevel (`incoming.stressLevel`): Balken mit
   Breite N×10 %, Farbklasse niedrig (≤ 3) / mittel (≤ 6) / hoch, daneben „N/10“;
   Emotionslevel (`incoming.emotionLevel`): gleicher Balken mit UMGEKEHRTER
   Farbe (niedrig = rot, hoch = grün); Emotionen (`incoming.emotions`, Text);
   Notiz (`incoming.note`, breites Feld, gesäubertes HTML); Tags
   (`incoming.tags`); Screenshot (`incoming.screenshot`, breites Feld):
   Eröffnungsbild und Trendbild nebeneinander, höchstens 200 px hoch, Klick →
   Vollbild (P.8).
2. **Füllungen** (`incoming.fills`, grauer Akzent), nur wenn `tradingMetadata`
   etwas enthält: mindestens eine Füllung, oder `sl` bzw. `tp` nicht null, oder
   `positionSize`, oder Einträge in `tpslHistory`, oder `rrr`. Inhalt:
   - Kopf: bei mehr als einer Eröffnungsfüllung „(N `incoming.fillEntries`)“;
     bei mindestens einer rechts „`incoming.fillAvgPrice`: P“ mit P =
     mengengewichteter Durchschnittspreis der Eröffnungsfüllungen (Füllungen
     ohne `reduceOnly`), 5 Nachkommastellen, 0 wenn Menge 0.
   - Tabelle der Füllungen, gruppiert: AUFEINANDERFOLGENDE Füllungen mit
     gleicher Minute (in der Handelszeitzone) und gleichem `reduceOnly` bilden
     eine Gruppe. Je Gruppe eine Zeile: Zeit `DD.MM. HH:mm` (Handelszeitzone; bei
     Gruppen davor ▶/▼), Gesamtmenge, „×“, Preis (Gruppe: Durchschnitt mit 5
     Stellen; Einzel: Rohpreis als Zahl), „=“, Wert (Menge×Preis, 2 Stellen),
     Plakette, bei Gruppen „(Anzahl)“, rechts „`incoming.fillFee`: Summe“ (4
     Stellen). Schliessende Gruppen in Rot. Gruppen sind per Klick
     aufklappbar; aufgeklappt folgen die Einzelfüllungen (gedimmt, kleiner)
     mit Menge, Preis, Wert, Gebühr. Aufklapp-Zustand: eine Menge von
     Gruppenschlüsseln (Minute + Kennzeichen), seitenweit, nicht gespeichert
     (Schlüssel sind nicht je Trade eindeutig – zwei Trades mit Füllungen in
     derselben Minute klappen gemeinsam; dokumentiert, darf behoben werden).
   - Plakette je Gruppe nach ihrer ersten Füllung: `reduceOnly` → wenn die
     Summe ALLER schliessenden Mengen ≥ Summe aller öffnenden Mengen
     „`incoming.fillClose`“ (rot), sonst „`incoming.fillPartialClose`“
     (gelb) – Altfehler A-P4: bei einer vollständig geschlossenen Position
     heissen auch die Teilschliessungen „Schliessung“; nicht `reduceOnly` →
     erste Füllung überhaupt oder alle davor schliessend →
     „`incoming.fillInitial`“ (grau), sonst „`incoming.fillCompound`“ (blau).
   - Summenzeile bei mehr als einer Füllung: „`incoming.fillTotal`: Summe der
     Eröffnungsmengen“ und „`incoming.fillFee`: Summe aller Gebühren“ (4 Stellen).
   - Positionsgrösse, wenn `positionSize`: „`incoming.positionSize`: Margin
     (2 Stellen) × Hebel`x` = Grösse (2 Stellen) USDT“.
   - SL/BE/TP-Zeile, wenn `sl`, `tp` oder `breakeven`: „SL: Wert“ (rot; hellgrün,
     wenn `slAboveBreakeven`) mit „(slQty)“; „BE: Wert“ (2 Stellen); „TP: Wert“
     (orange) mit „(tpQty)“; rechts „RRR 1:rrr“ (violett).
   - **SL/TP-Protokoll** (Titel hart „SL/TP Protokoll“), wenn die gefilterte
     `tpslHistory` Einträge hat. Filter: ohne Füllungen alles; sonst nur Einträge
     mit `time` ≤ spätester Füllzeit + 60 000 ms (eine Spätestzeit 0 → alles).
     Standardmässig AUFGEKLAPPT; Klick klappt je Trade zu/auf (Liste der
     zugeklappten Trade-IDs, nicht gespeichert). Je Eintrag: Zeit `DD.MM. HH:mm`
     (Handelszeitzone), Typ (`SL` rot bzw. hellgrün bei `slAboveBreakeven`;
     `TP` orange, grün fett wenn ausgelöst), dann je `action`: `set` → „→ neu
     (qty)“ + Plakette „Gesetzt“; `moved` → alt durchgestrichen „→ neu (qty)“ +
     Plakette „Verschoben“; `triggered` → alt durchgestrichen „→ Ausgelöst ✓“
     (grün); `removed` → alt durchgestrichen „→ entfernt“; rechts „1:rrr“ wenn
     vorhanden. Diese deutschen Wörter sind hart kodiert (im Neubau
     i18n-Schlüssel anlegen).
   Form von `tradingMetadata` (geschrieben von Incoming/Import, hier nur
   gelesen): `fills` [{`time` (ms, Zahl oder Zeichenkette), `qty`, `price`,
   `fee` (Zeichenketten oder Zahlen), `reduceOnly` (bool)}], `sl`, `tp`,
   `slQty`, `tpQty`, `breakeven`, `slAboveBreakeven` (bool), `rrr`,
   `positionSize`, `margin`, `leverage`, `tpslHistory` [{`time` (ms), `type`
   (`SL`/`TP`), `action` (`set`/`moved`/`triggered`/`removed`), `oldVal`,
   `newVal`, `qty`, `rrr`}].
3. **Abschlussbewertung** (`incoming.closingEvaluation`, blauer Akzent).
   Sichtbar, wenn eines gesetzt: Abschluss-Tags, Abschlussnotiz mit Text,
   `closingNote`, Zufriedenheit nicht null, Abschlussbild. Felder: Notiz
   (`incoming.note`, gesäubertes `closingPlaybook`); sonst, wenn nur das Altfeld
   gefüllt ist, „`incoming.closingNote`“ mit gesäubertem `closingNote`; Tags;
   Zufriedenheit (`incoming.satisfaction`; 1 👍, 2 ✊, jeder andere Wert 👎);
   Screenshot (Abschlussbild, Titel `incoming.screenshot`, Klick → Vollbild).

Hat der Eintrag gar keine Daten: Text `playbook.noEvaluation` und Knopf
`playbook.evaluateNow` → Bearbeitungsmodus.

Keine Einträge: Komponente `NoData`.

### P.8 Bilder im Playbook

Drei Bildfelder je Eintrag: **Eröffnung** (`entry`), **Trend** (`trend`, zweites
Eröffnungsbild), **Abschluss** (`closing`).

**Finden des Bildes** (aus der geladenen Bildliste; Reihenfolge = Priorität):

- Eröffnung: (1) Bild mit `objectId` = `screenshotId` (Vergleich als
  Zeichenkette, exakt); (2) Name enthält die Trade-ID UND `_entry`; (3) Name =
  Trade-ID und nicht Abschlussbild; (4) Name enthält die Trade-ID und nicht
  Abschlussbild; (5) gleiches Symbol und (`dateUnixDay` = Eintrag-`dateUnix` oder
  `dateUnix` = Eintrag-`dateUnix`) und nicht Abschlussbild; (6) die Ziffern am
  Anfang der Trade-ID (nach optionalem `t`, bis zum ersten `_`) als Präfix: Name
  beginnt mit „Ziffern_“, oder `dateUnixDay` als Text = Ziffern, jeweils nicht
  Abschlussbild. „Abschlussbild“ = `objectId` = `closingScreenshotId` oder Name
  enthält `_closing`. Achtung: (4) trifft auch `<tradeId>_trend`, (5)/(6) können
  Bilder ANDERER Trades desselben Tages treffen (Altfehler A-P5; die Regeln
  sind so zu übernehmen, weil Altbestand nur so gefunden wird – Empfehlung:
  beim ersten Speichern die gefundene ID in `screenshotId` festschreiben, was
  heute schon passiert, wenn der Nutzer speichert, und `_trend` in (4)
  ausschliessen).
- Trend: (1) `objectId` = `trendScreenshotId` (der Eintrag hat das Feld nur
  nach einem Hochladen in dieser Sitzung, A-P1); (2) Name enthält Trade-ID und
  `_trend`.
- Abschluss: (1) `objectId` = `closingScreenshotId`; (2) Name enthält Trade-ID
  und `_closing`.

Anzeige-Bildquelle überall: `annotatedBase64`, ersatzweise `originalBase64`
(A-S1). Im Bearbeitungsmodus hat eine frisch hochgeladene Vorschau
(Daten-URL je Trade-ID und Feld, nur im Speicher) Vorrang; existiert eine ID,
aber kein Bild in der Liste, steht eine Plakette `incoming.screenshotLinked`.

**Vollbild** im Playbook ist eine EIGENE Überlagerung (nicht
`ScreenshotVollbild`): Bild zentriert, Klick auf den Hintergrund oder den
Schliessen-Knopf (Titel `common.close`) schliesst; Klick aufs Bild nicht. Kein
Blättern, keine Esc-Taste (Empfehlung: Esc ergänzen, `basis/Dialog`).

**Hochladen** (Datei-Auswahl, Ziehen-und-Ablegen, Einfügen, „Kopiertes Bild
einfügen“ – alles läuft auf denselben Kern je Feld): Datei als Daten-URL lesen,
SOFORT (nicht erst beim Speichern) eine Zeile anlegen:

| Feld | Wert |
|---|---|
| `name` | `<tradeId>_entry` / `<tradeId>_trend` / `<tradeId>_closing` |
| `symbol`, `side` | aus dem Eintrag (`side` = `long`/`short` oder '') |
| `broker` | `selectedBroker` oder `bitunix` |
| `originalBase64`, `annotatedBase64` | dieselbe Daten-URL |
| `markersOnly` | wahr |
| `maState` | `{}` |
| `dateUnix`, `dateUnixDay` | beide = `dateUnix` des Eintrags |

(KEIN `date`.) Danach im Eintrag `screenshotId` / `trendScreenshotId` /
`closingScreenshotId` = neue `objectId`, Vorschau merken, neue Zeile an die
Bildliste hängen. In die Notiz geschrieben wird die ID erst mit „Speichern“
(beim Trendbild nie, A-P1). Abbrechen lässt die Zeile bestehen (sie wird dann
über den Namen wiedergefunden). Keine Grössenprüfung, keine Kompression.
Bildtyp: Datei-Auswahl nimmt `image/*`; beim Ablegen zählt die erste Datei mit
MIME-Typ `image/…`.

**Feldwahl:**

- Eröffnungsbereich: eine Ablagezone, solange Eröffnungs- ODER Trendbild fehlt;
  Ziel ist das Eröffnungsfeld, wenn es leer ist, sonst das Trendfeld. Text hart
  „Bild wählen, hierher ziehen oder einfügen (Strg/Cmd+V)“. Die Zone ist ein
  Label um eine versteckte Datei-Eingabe (Klick öffnet die Dateiauswahl);
  beim Darüberziehen hervorgehoben (Merker „`<tradeId>:open`“, beim Verlassen
  oder Ablegen geleert).
- Abschlussbereich: Zone nur, wenn kein Abschlussbild da ist (Merker
  „`<tradeId>:closing`“).
- „Feld ist belegt“ heisst jeweils: ID gesetzt ODER Bild über die Suchregeln
  gefunden.
- **Einfügen (Strg/Cmd+V)**: seitenweiter Handler am Fenster (beim Einhängen an,
  beim Aushängen ab). Nur wenn ein Eintrag im Bearbeitungsmodus ist und die
  Zwischenablage ein Bild (`image/…`) enthält: Standardaktion verhindern und
  das Bild in das ERSTE freie Feld legen – Eröffnung, dann Trend, dann
  Abschluss; alle belegt → nichts.
- **„Kopiertes Bild einfügen“** (hart deutsch; Knopf nur, wenn `kopiertesBild`
  gesetzt und im jeweiligen Bereich ein Feld frei ist; Ziel wie die Zone): Bild
  mit `kopiertesBild.objectId` frisch per `dbGet('screenshots', id)` holen,
  `annotatedBase64` oder `originalBase64`; nicht gefunden/leer → nichts. Die
  Daten-URL wird in eine Datei umgewandelt (MIME-Typ aus der URL, Vorgabe
  `image/png`; Dateiname `<name>.png`) und wie ein Hochladen behandelt – es
  entsteht also eine KOPIE als neue Zeile.

**Entfernen** (Kreuz am Eröffnungs- und Trendbild, Knopf `common.remove` am
Abschlussbild; sofort, ohne Rückfrage, auch wenn danach „Abbrechen“ gedrückt
wird): ID im Eintrag leeren, Vorschau vergessen; hat der Eintrag eine Notiz →
in der Notiz das jeweilige ID-Feld auf '' setzen (`screenshotId` /
`trendScreenshotId` / `closingScreenshotId`); dann die Bildzeile LÖSCHEN – die
mit der ID, sonst die über die Suchregeln gefundene (Altfehler A-P6: über die
Regeln (5)/(6) kann so ein fremdes Bild desselben Tages gelöscht werden;
Empfehlung: ohne ID nur Bilder löschen, deren Name die Trade-ID enthält);
aus der Bildliste entfernen. Fehler beim Löschen nur Konsole.

### P.9 Aufklappen, Bearbeiten, Speichern

- **Aufklappen**: Klick auf den Kopf. Ist die Karte schon offen → zuklappen (ein
  laufender Bearbeitungsmodus dieser Karte wird abgebrochen). Ist eine ANDERE
  Karte im Bearbeitungsmodus offen → dort abbrechen, dann diese öffnen. Es ist
  immer höchstens eine Karte offen und höchstens eine im Bearbeitungsmodus.
- **`journalHatDaten(eintrag)`** ist wahr bei: Typ, Stress > 0, Emotion > 0,
  Zeitrahmen, `feelings`, Eröffnungsnotiz mit Text, Eröffnungs-Tags,
  Zufriedenheit nicht null, `entryNote`, Abschluss-Stress > 0,
  Abschluss-Emotion > 0, `closingTimeframe`, `closingFeelings`,
  Abschlussnotiz mit Text, `closingNote`. (Bilder und Abschluss-Tags zählen
  NICHT.)
- **Bearbeitungsmodus starten**: Bearbeitungs-ID setzen, nach dem Render die
  zwei Quill-Editoren erzeugen (P.6).
- **Abbrechen** (`common.cancel`): Editoren vergessen, Bearbeitungs-ID leeren.
  Die im Speicher geänderten Werte des Eintrags werden NICHT zurückgesetzt
  (Altfehler A-P7: sie bleiben bis zum Neuladen sichtbar, obwohl nichts
  gespeichert ist). Empfehlung: beim Start eine Kopie halten und beim Abbrechen
  zurücklegen.
- **Verlassen-Schutz**: `useVerlassenSchutz` mit Bedingung „ein Eintrag ist im
  Bearbeitungsmodus“ und Text `common.unsavedLeave` – fragt bei Navigation in
  der App (Router) per `confirm`, bei Neuladen/Tab schliessen über
  `beforeunload`. Nach Speichern/Abbrechen ist die Bedingung von selbst falsch.

**Eingaben im Bearbeitungsmodus – Eröffnungsbereich** (grüner Akzent, Titel
`incoming.openingEvaluation`):

- Trade-Typ (`incoming.tradeType`): drei Umschaltknöpfe Scalp/Day/Swing; Klick
  auf den aktiven wählt ab ('').
- Zeitrahmen (`incoming.timeframe`): Knöpfe aus den in den Einstellungen
  gewählten Zeitrahmen (`selectedTradeTimeframes`, gefüllt beim Laden der
  Einstellungen) in der Reihenfolge von `allTradeTimeframes`; ist keiner
  gewählt, alle. `allTradeTimeframes` = Minuten 1m 2m 3m 5m 6m 10m 15m 30m 45m,
  Stunden 1h 2h 3h 4h, Tage 1D 1W 1M 3M 6M 12M; Beschriftung über
  `timeframes.<wert>`. Klick auf den aktiven wählt ab.
- Stresslevel (`incoming.stressLevel`) und Emotionslevel
  (`incoming.emotionLevel`): je zehn Punkte 1–10 mit Zahl darüber, zwischen
  ihnen kleinere Zwischenpunkte; Punkte ≤ Wert aktiv. Klick auf N setzt N, Klick
  auf den aktuellen Wert setzt 0.
- Emotionen (`incoming.emotions`): zweizeiliges Textfeld, Platzhalter
  `incoming.emotionsPlaceholder`, direkt an `feelings` gebunden.
- Notiz (`incoming.note`): Quill (Eröffnung).
- Tags (`incoming.tags`): zugewiesene Tags als Plaketten in Tag-Farbe mit „×“;
  Klick entfernt. Darunter eine Auswahl mit Platzhalter `incoming.addTag` und
  je Katalog-Gruppe einem Abschnitt (Gruppenname) mit den Tags; bereits
  zugewiesene sind deaktiviert. Auswahl fügt `{id, name}` hinzu (ohne Farbe –
  die Zusammenfassung zeigt sie dann ohne Hintergrund bis zum Neuladen; die
  Detailansicht holt die Farbe nach) und setzt die Auswahl zurück auf den
  Platzhalter. Doppelte IDs werden nicht hinzugefügt.
- Screenshot (`incoming.screenshot`): Eröffnungsbild (höchstens 150 px hoch,
  Klick → Vollbild, Kreuz entfernt), Trendbild ebenso, Ablagezone,
  „Kopiertes Bild einfügen“ (P.8).

**Abschlussbereich** (blauer Akzent, `incoming.closingEvaluation`):
Trade-Typ (`closingTradeType`, gleiche Knöpfe), Notiz (Quill Abschluss), Tags
(`closingTags`, gleiche Bedienung), Screenshot (Abschlussbild bis 200 px,
Knopf Entfernen; sonst Ablagezone und „Kopiertes Bild einfügen“),
Zufriedenheit (`incoming.satisfaction`): drei Emojis 👍 (1), ✊ (2), 👎 (0),
nicht gewählte grau und blass; Klick auf den gewählten → null.
Abschluss-Stress, -Emotion, -Gefühle, -Zeitrahmen haben KEINE Eingabe (die
Funktionen dafür existieren, sind aber nicht verdrahtet) – sie werden nur
mitgeschrieben.

**Speichern** (`common.save`, Knopf während des Speicherns gesperrt mit
Kreisel):

1. Quill-Inhalte auslesen → `playbook`, `closingPlaybook` (nur wenn die
   Instanz existiert).
2. `note` = `playbook`, wenn nach Trimmen nicht leer, sonst `<p>-</p>`.
3. `dbUpdate('notes', noteObjectId, …)` mit: `note`, `tradeType`,
   `entryStressLevel`, `emotionLevel`, `entryNote`, `feelings`, `playbook`,
   `timeframe`, `screenshotId`, `closingTradeType`, `closingNote`,
   `closingStressLevel`, `closingEmotionLevel`, `closingFeelings`,
   `closingTimeframe`, `closingPlaybook`, `closingScreenshotId` (leere Werte als
   '' bzw. 0). NICHT `trendScreenshotId` (A-P1). Hinweis: `note` ist auch das
   Notizfeld der Tagesansicht – das Playbook überschreibt es mit der
   Eröffnungsnotiz (bewusst so lassen, dokumentiert).
4. Zufriedenheit: Zeile vorhanden → `satisfaction` schreiben (auch `null`).
   Keine Zeile und Wert nicht null → anlegen `{dateUnix, tradeId,
   satisfaction}` und `objectId` merken.
5. Tags: Zeile vorhanden → `tags` und `closingTags` (ID-Listen, auch leer)
   schreiben. Keine Zeile und mindestens eine Liste nicht leer → anlegen
   `{dateUnix, tradeId, tags, closingTags}`.
6. Erfolg: Editoren vergessen, Bearbeitungs-ID und Speicher-ID leeren (zurück in
   den Ansichtsmodus).
7. Fehler (irgendein Schritt): nur Speicher-ID leeren, Bearbeitungsmodus und
   Editoren BLEIBEN (ein gescheitertes Speichern darf nicht wie ein gelungenes
   aussehen); sichtbar wird der Fehler über den zentralen db.js-Hinweis. Teile,
   die vor dem Fehler geschrieben wurden, bleiben geschrieben.

Kein Neuladen nach dem Speichern; die Anzeige beruht auf dem Eintrag im
Speicher.

### P.10 i18n-Schlüssel (vollständig)

`playbook.tradeEvaluations`, `playbook.noEvaluation`, `playbook.evaluateNow`,
`common.edit`, `common.cancel`, `common.save`, `common.remove`, `common.close`,
`common.unsavedLeave`, `incoming.openingEvaluation`,
`incoming.closingEvaluation`, `incoming.tradeType`, `incoming.scalptrade`,
`incoming.daytrade`, `incoming.swingtrade`, `incoming.timeframe`,
`incoming.stress`, `incoming.stressLevel`, `incoming.emotionLevel`,
`incoming.emotions`, `incoming.emotionsPlaceholder`, `incoming.note`,
`incoming.closingNote`, `incoming.tags`, `incoming.addTag`,
`incoming.satisfaction`, `incoming.screenshot`, `incoming.screenshotLinked`,
`incoming.fills`, `incoming.fillEntries`, `incoming.fillAvgPrice`,
`incoming.fillFee`, `incoming.fillTotal`, `incoming.fillClose`,
`incoming.fillPartialClose`, `incoming.fillInitial`, `incoming.fillCompound`,
`incoming.positionSize`, `timeframes.<wert>` (über `allTradeTimeframes`),
`nav.playbook` (Titel). Alle vorhanden in `de.json`.

Hart kodiert, im Neubau als Schlüssel unter `playbook.` anlegen: „Bild wählen,
hierher ziehen oder einfügen (Strg/Cmd+V)“, „Kopiertes Bild einfügen“,
„SL/TP Protokoll“, „Gesetzt“, „Verschoben“, „Ausgelöst ✓“, „entfernt“, sowie
„LONG“/„SHORT“, „SL“, „BE“, „TP“, „RRR“, „USDT“ (Fachkürzel, dürfen fest
bleiben).

### P.11 Was Bootstrap im Playbook tut

Kein Bootstrap-JS. Nur Klassen: Knöpfe (primär/umrandet/grün/rot), Plaketten,
Auswahlfeld, kleine Tabelle, Spinner, Raster/Flex-Hilfen. Symbole aus Unicons
(Stift, Pfeil auf/ab, Schloss offen/zu, Ebenen, Verlauf, Bild-plus,
Zwischenablage, Kreuz, Haken) → `basis/Symbol`. Die Klassen `stress-dot`,
`pb-card`, `pb-pill`, `pb-header`, `pb-body`, `quill-incoming` liegen heute in
`src/assets/design/uebergang.css` (auch von Incoming benutzt) – der Neubau bringt
eigene Stile mit und lässt `uebergang.css` für Incoming unangetastet.

### P.12 Altfehler Playbook (markiert, mit Empfehlung)

- **A-P1** `trendScreenshotId` wird weder geladen noch gespeichert; das
  Trendbild hängt allein am Namen `<tradeId>_trend`. Empfehlung: laden und
  speichern (Spalte existiert).
- **A-P2** Deep-Link mit unbekannter ID tut stumm nichts. Empfehlung: Hinweis
  (`Hinweis`-Baustein) „Trade nicht gefunden“.
- **A-P3** Bild in Quill eingefügt landet doppelt (Editor + Bildfeld) und wird im
  Editor beim Anzeigen leer gesäubert.
- **A-P4** Füll-Plakette „Schliessung“ auch für Teilschliessungen einer
  vollständig geschlossenen Position. Empfehlung: kumuliert bis zur jeweiligen
  Füllung rechnen.
- **A-P5** Bildsuche über Tag/Symbol/Präfix kann fremde Bilder zeigen.
- **A-P6** Entfernen kann über diese Suche ein fremdes Bild LÖSCHEN.
- **A-P7** Abbrechen setzt die Werte im Speicher nicht zurück; hochgeladene und
  entfernte Bilder sind trotz Abbrechen geschrieben bzw. gelöscht.
- **A-P8** Limits: 200 Notizen, 200 Tageszeilen, 500 Zufriedenheiten/Tags/Bilder;
  ältere Bewertungen fehlen ohne Hinweis, und alle 500 Bilder werden samt Base64
  geladen. Empfehlung: Bilder ohne Base64 laden (`exclude` der Bilddaten) und
  das Bild erst beim Aufklappen holen; Notizen paginieren.
- **A-P9** Zufriedenheitswert 2 ist in der Journal-Kern-Spezifikation nicht
  vorgesehen (dort 0/1). Offener Punkt: prüfen, wie Daily/Dashboard eine 2
  behandeln, bevor der Wert im Neubau beibehalten oder umgedeutet wird.

### P.13 Aufrufer-Landkarte dieses Teils

| Export / Ding | Aufrufer | erwartet |
|---|---|---|
| `leseBildSeite` | `ablauf.js` `starteBilder` | synchron, setzt Limit aus SS |
| `ladeBilder` | `ablauf.js` (3×), `app.js` (Daily-Reiter), `Daily.vue` (2×), intern | Promise, füllt Stores wie S.4 |
| `useDeleteScreenshot` | `app.js` (Lösch-Bestätigung) | löscht `markierterEintrag`, Store-Pflege |
| `ladeBilderNeu` | `FilterLeiste.vue` | Promise; Liste neu ab Offset 0 |
| `useSelectedScreenshotFunction` | `Screenshot.vue`, `Daily.vue`, `ScreenshotVollbild.vue` | synchron; setzt Auswahl |
| `useSetupMarkerArea` | `Screenshot.vue` | öffnet Editor |
| `speichereBild` | `Daily.vue`, intern | Promise |
| `useSetupImageUpload` | `Daily.vue` (nur Import) | Export muss existieren |
| `useSetupImageFile`, `compressImage`, `scrolleZuBild`, `ladeBildHoch` | intern | – |
| `Screenshot.vue` | `Screenshots.vue`, `ScreenshotVollbild.vue` | Props wie S.5 |
| `ScreenshotVollbild.vue` | `layouts/Dashboard.vue` | ohne Props |
| `kopiertesBild` (Store) | geschrieben: `Screenshot.vue`, `Livetrading.vue`; gelesen: `Playbook.vue`, `Incoming.vue` | `{objectId, name}` oder null, gespiegelt in SS |
| `/playbook?tradeId=` | `Screenshots.vue`, `Importe.vue` | öffnet/legt Bewertung an (P.5) |

---


Stand: 19.10.2026. Verfasst aus dem Verhalten des heutigen Codes. Diese Datei
ist die einzige Quelle für den Neubau der unten genannten Ansichten; der
Altcode darf vom bauenden Agenten nicht gelesen werden.

Beschrieben werden

- `src/views/Dashboard.vue` (Journal-Dashboard)
- `src/views/Auswertung.vue`
- `src/views/Calendar.vue` und `src/components/Calendar.vue`
- `src/views/AddTrades.vue`
- `src/views/AddExcursions.vue`
- `src/components/TradeEvalPopup.vue` (eingebunden in `src/layouts/Dashboard.vue`)
- kurz: `src/components/NoData.vue`

Eigener Code, der bleibt und nur BENUTZT wird (Schnittstellen in
`docs/spec/journal-kern.md` und `docs/spec/diagramme.md`):

- Abläufe aus `src/utils/journal/ablauf.js`: `starteDashboard`,
  `useMountAuswertung`, `starteKalender`, `starteTagesansicht`,
  `useDisposeJournalCharts`.
- Diagramme aus `src/utils/journal/diagramme/` (über `index.js` bzw. den
  Lader `src/utils/journal/diagrammLader.js`): `zeichneDiagramme`,
  `useGaugeChart`, `useHorizontalBarChart`, `useSplitBarChart`,
  `useStressLineChart`, `useRadarChart`.
- Formatierer aus `src/utils/journal/format.js`: `useThousandCurrencyFormat`,
  `useTwoDecCurrencyFormat`, `useXDecCurrencyFormat` (importiert, nicht
  benutzt), `useThousandFormat`, `useXDecFormat`, `useChartFormat`,
  `useCreatedDateFormat`, `useDateCalFormat`.
- `src/utils/journal/zeit.js` (dayjs mit Zeitzonen-Plugins),
  `shared/gewinn.js` (`istGewinn`: Wert ≥ 0 zählt als Gewinn, der Kanon des
  Projekts für Break-even).
- `src/utils/journal/app.js`: `useInitTab`, `useInitTooltip`, `ladeApis`,
  `usePageRedirect`.
- `src/utils/journal/import.js`: `useGetExistingTradesArray`,
  `useUploadTrades`, `useGetOHLCV`, `useGetMFEPrices`, `useUpdateMfePrices`.
- `src/utils/journal/tagesrechnung.js`: `baueBlotter`, `bauePnL`.
- `src/utils/journal/laden.js`: `ladeTrades`.
- `src/utils/journal/tagebuch.js`: `ladeExkursionen`.
- `src/utils/quickImport.js`: `buildTradeObj`, `saveManualTrade`,
  `useQuickApiImport`, `createBitunixTradeObj`, `createBitgetTradeObj`.
- `src/stores/accountBalance.js`: `allTimeNetPnL`, `allTimeVolume`,
  `last30dVolume`, `displayBonus`, `refreshAccountBalance`,
  `syncStartBalanceFromBroker`.
- `src/utils/incoming.js`: `useFetchOpenPositions`.
- `src/composables/useVerlassenSchutz.js`, `src/utils/notify.js`
  (`sendNotification`).
- `src/components/BotDashboard.vue`, `src/components/SeiteLaedt.vue`
  (nicht Teil dieser Spezifikation, werden nur eingebunden).

Stores (alle als `ref`/`reactive`-Exporte, kein Pinia), Bündel-Pfade wie heute:
`src/stores/ui.js`, `src/stores/filters.js`, `src/stores/trades.js`,
`src/stores/settings.js`, `src/stores/journal/offenePositionen.js`.

**Bootstrap fällt weg.** Heute benutzte Bootstrap-JS-Funktionen und ihr Zweck:

| Funktion | Wo | Zweck | Ersatz im Neubau |
|---|---|---|---|
| Tab-Plugin (Reiterknöpfe mit Tab-Umschaltung, Ereignis „Reiter gezeigt“) | Dashboard | Reiterwechsel; `useInitTab('dashboard')` hängt an das Ereignis das Merken des Reiters und das Neuzeichnen | eigener Reiter (`Reiter` aus `src/components/basis/`), Wechsel ruft dieselbe Folge direkt (B.3) |
| Tooltip-Plugin mit HTML-Inhalt | Dashboard, Auswertung | Info-Symbole an Kartentiteln und Kennzahlen; initialisiert durch `useInitTooltip()` | `InfoTipp.vue` (siehe CLAUDE.md, „Key Components“) |
| Modal-Plugin (Instanz anlegen, zeigen, verbergen, Ereignis „verborgen“) | TradeEvalPopup | Hinweisfenster | `Dialog` aus `src/components/basis/` |

Font-Awesome-/Unicons-Symbole werden durch `Symbol.vue` ersetzt; die genannten
Symbole sind nur funktional beschrieben.

Markierungen: **[Altfehler]** = heutiges Verhalten, das vermutlich falsch ist;
der Neubau bildet es nach, solange nichts anderes empfohlen ist, und die
Empfehlung steht dabei. **[Offen]** = nicht sicher geklärt.

---

## Dashboard

Route `/dashboard`, Routenname `dashboard` (Seitenkennung `pageId` =
`'dashboard'`), Modus `journal`, Layout `DashboardLayout`.

### B.1 Gelesene und geschriebene Zustände

Gelesen:

- `ui.js`: `seiteLaedt`, `dashboardBereit`, `zeichenZaehler`,
  `journalHatDaten`, `negativeTagGruppen`, `timeZoneTrade`
  (`dashboardDiagrammeBereit` wird importiert, aber nicht benutzt).
- `filters.js`: `selectedDashTab`, `betragArt` (`'gross'`/`'net'`),
  `betragGross`, `selectedBroker`, `selectedTradeCategory`
  (`selectedRatio` importiert, aber NICHT benutzt — siehe B.6).
- `trades.js`: `totals`, `gewinnAnalyse`, `zufriedenheitTage`,
  `zufriedenheitTrades`, `verfuegbareTags`, `groups`,
  `gefilterteTradesFlach`, `excursions`.
- `settings.js`: `currentUser` (Felder `balances`, `startBalance`).
- `accountBalance.js`: `allTimeNetPnL`, `allTimeVolume`, `last30dVolume`,
  `displayBonus`.
- `journal/offenePositionen.js`: `incomingPositions`.
- `localStorage`: `selectedRatio` (direkt gelesen), `dashboard_hidden_cards`.

Geschrieben:

- `betragGross` wird beim Anlegen der Seite einmal gesetzt: `betragArt` mit
  grossem Anfangsbuchstaben (`'Gross'`/`'Net'`), bei leerem `betragArt` die
  leere Zeichenkette. Wird in dieser Datei sonst nicht gelesen.
- `localStorage['dashboard_hidden_cards']` (B.4).
- `selectedDashTab` und `localStorage['selectedDashTab']` über den
  Reiterwechsel (B.3).

### B.2 Lebenszyklus

1. Beim Anlegen (vor dem Einhängen, asynchron, in dieser Reihenfolge):
   1. `negativeTagGruppen` „leeren“ — heute auf dem Ref-Objekt statt
      auf seinem Wert, also wirkungslos. **[Altfehler, harmlos]**
      `starteDashboard` leert den Wert ohnehin selbst. Neubau: weglassen.
   2. `await refreshAccountBalance({ force: true })`.
   3. `useFetchOpenPositions()` anstossen, NICHT abwarten; Fehler still
      schlucken (das globale Polling versucht es erneut). Zweck: das
      unrealisierte P&L offener Positionen fliesst sofort in den Kontostand.
   4. `await starteDashboard()` (lädt Bereich, Exkursionen, Zufriedenheit,
      Tags, gefilterte Trades, Summen, Gruppen, Gewinnanalyse; schaltet
      Spinner ab, setzt `dashboardBereit`, ruft `useInitTab('dashboard')`
      und `useInitTooltip()`, füllt `negativeTagGruppen`, erhöht
      `zeichenZaehler` und ruft `zeichneDiagramme('init')`).
2. Nach dem Einhängen: Klick-Lauscher am Dokument für „Klick ausserhalb
   schliesst das Karten-Menü“ (B.4). Beim Aushängen entfernen.
3. Vor dem Aushängen: `useDisposeJournalCharts()` — solange die
   Diagrammknoten noch im Dokument hängen.

Ein Filterwechsel in der Filterleiste ruft `starteDashboard()` erneut auf
(nicht diese Seite); die Seite reagiert über die Stores.

### B.3 Aufbau und Zustände

Oben steht immer `SeiteLaedt`. Darunter, nur sichtbar solange
`seiteLaedt` falsch ist (sichtbar/unsichtbar, nicht entfernt), genau
EINER dieser drei Zweige (Priorität in dieser Reihenfolge):

1. `journalHatDaten` falsch → `NoData`.
2. `selectedTradeCategory` = `'bot'` → `BotDashboard` (ohne Props), sonst
   nichts — keine Reiter, kein Karten-Menü. Der Ladeablauf aus B.2 läuft
   trotzdem vollständig. Auch im Bot-Fall hat „keine Daten“ Vorrang.
3. sonst die Futures-Ansicht: Reiterleiste mit Karten-Menü-Knopf rechts
   daneben, darunter die fünf Reiterinhalte.

Die gesamte Seite ist „kompakt“ gesetzt (kleinere Innenabstände, Titel,
Kennzahlen, Diagrammhöhen als auf anderen Seiten — Diagramme ab
Desktopbreite 300 px hoch, die drei Ringe 110 px).

**Reiter** (Reihenfolge der Knöpfe; Kennung = Wert in `selectedDashTab`):

| Kennung | Beschriftung | Inhalt |
|---|---|---|
| `overviewTab` | `dashboard.overview` | B.5–B.8 |
| `tradesTab` | `dashboard.performance` | B.10 |
| `timeTab` | `dashboard.timeAndDate` | B.9 |
| `setupsTab` | `dashboard.setups` | B.11 |
| `financialsTab` | `dashboard.finances` | B.12 |

- Aktiv ist der Reiter, dessen Kennung in `selectedDashTab` steht
  (Startwert durch `setzeFilterwerte` aus `localStorage['selectedDashTab']`,
  Vorgabe `overviewTab`). Steht dort ein unbekannter Wert, ist kein Reiter
  aktiv und kein Inhalt sichtbar. **[Altfehler]** Empfehlung: auf
  `overviewTab` zurückfallen.
- Wechsel: `selectedDashTab` = Kennung, `localStorage['selectedDashTab']` =
  Kennung, `zeichenZaehler` += 1, nächsten Render-Takt abwarten, dann
  `zeichneDiagramme('init')` (über `ladeDiagramme()`). `zeichneDiagramme` zeichnet nur
  sichtbare Knoten — deshalb muss nach jedem Wechsel neu gezeichnet werden.
  Heute steckt diese Folge im Tab-Ereignis-Lauscher, den `useInitTab` bei
  JEDEM `starteDashboard` erneut an die Knöpfe hängt (bei einem
  Filterwechsel auf derselben Seite also mehrfach). **[Altfehler]** Neubau:
  die Folge direkt im Klick-Handler des Reiters, genau einmal.
- Nicht aktive Reiterinhalte bleiben im DOM, sind aber verborgen
  (Diagramme darin werden nicht gezeichnet).
- `zeichenZaehler` dient allen Diagrammknoten als Schlüssel: jede Erhöhung
  erzeugt frische Knoten für ECharts.

### B.4 Karten-Menü (Sichtbarkeit einzelner Karten)

- Knopf mit Zahnrad-Symbol rechts neben den Reitern; Klick schaltet ein
  Aufklapp-Menü. Klick irgendwo ausserhalb des Menübereichs schliesst es.
- Menütitel `auswertung.visibleCards`. Je Karte eine Zeile mit Häkchen
  (sichtbar) oder leerem Kästchen (verborgen); Klick schaltet um.
- Gespeichert als JSON-Liste der verborgenen Schlüssel in
  `localStorage['dashboard_hidden_cards']`, sofort bei jedem Umschalten;
  gelesen einmal beim Anlegen (fehlend = nichts verborgen).
- Karten (Schlüssel → Menübeschriftung), in dieser Reihenfolge:

| Schlüssel | Beschriftung |
|---|---|
| `accountBalance` | `dashboard.accountBalance` |
| `metrics` | `dashboard.metrics` |
| `fees` | `dashboard.fees` |
| `cumulativePnl` | `dashboard.cumulativePnlChart` |
| `appt` | fester Text „APPT“ |
| `winRate` | `dashboard.winRate` |
| `tradingPerformance` | `dashboard.tradingPerformance` |
| `byWeekday` | `dashboard.byWeekday` mit leerem `metric`, Klammern entfernt, getrimmt |
| `byEntryTime` | `dashboard.byEntryTime` (ebenso) |
| `byDuration` | `dashboard.byDuration` (ebenso) |
| `heatmap` | `dashboard.heatmapTitle` |
| `byPosition` | `dashboard.byPosition` (ebenso) |
| `byStrategy` | `dashboard.byStrategy` (ebenso) |
| `tradeTypeStats` | `dashboard.tradeTypeStats` |
| `strategyTagStats` | `dashboard.strategyTagStats` |
| `bySymbol` | `dashboard.bySymbol` (ebenso) |
| `feesBySymbol` | `dashboard.feesBySymbol` |
| `mfeAnalysis` | `dashboard.mfeAnalysis` |

- Eine verborgene Karte wird NICHT gerendert (Element fehlt). Wird eine
  Diagrammkarte wieder eingeblendet, bleibt sie leer bis zum nächsten
  Zeichnen (Reiterwechsel, Filterwechsel). **[Altfehler]** Empfehlung: nach
  dem Einblenden `zeichenZaehler` erhöhen und `zeichneDiagramme('init')` aufrufen.

**Brutto/Netto-Kennzeichen:** An die Titel folgender Karten wird „ (“ +
`options.gross` + „)“ bzw. „ (“ + `options.net` + „)“ gehängt, je nach
`betragArt` (anderer Wert: nichts): metrics, cumulativePnl, appt, winRate,
byWeekday, byEntryTime, byDuration, heatmap, tradingPerformance,
mfeAnalysis, byPosition, byStrategy, tradeTypeStats, strategyTagStats,
bySymbol. NICHT an accountBalance, fees, feesBySymbol.

**Info-Symbole** (heute Bootstrap-Tooltip mit HTML; Neubau `InfoTipp`):
Schlüssel stehen je Karte unten. Achtung: Bootstrap liest den Text beim
Initialisieren; spätere Änderungen (z. B. der Ratio-Text) erscheinen heute
erst nach dem nächsten `useInitTooltip`. Neubau: Text reaktiv.

### B.5 Reiter „Übersicht“, obere Reihe

Die obere Reihe erscheint erst, wenn `dashboardBereit` wahr ist. Drei
Karten nebeneinander (Desktop je ein Drittel, Tablet halbe Breite, Handy
volle Breite), jede einzeln verbergbar.

#### B.5.1 Karte „Kontostand“ (`accountBalance`)

Titel `dashboard.accountBalance`, rechts ein Sync-Knopf (Symbol „Synchron“,
Hinweistext heute fest „Mit Broker-Wallet synchronisieren“).

**Kontostand-Rechnung** (Broker = `selectedBroker` oder `'bitunix'`):

- Start = `currentUser.balances[Broker].start` falls der Eintrag
  `balances[Broker]` existiert (fehlendes `start` → 0), sonst
  `currentUser.startBalance` (fehlend → 0).
- Start = 0 → kein Kontostand: Platzhalter mit Brieftaschen-Symbol und Text
  `dashboard.configureBalance`.
- Unrealisiert U = Summe von `unrealizedPNL` (als Zahl, nur endliche Werte)
  über alle `incomingPositions` mit `status` = `'open'` und (`broker` leer
  oder = Broker).
- Bonus B = `displayBonus` (fehlend 0).
- Aktuell = Start + `allTimeNetPnL` + U + B.
- P&L = Aktuell − Start − B.
- Performance % = ((Aktuell − B) / Start − 1) × 100 (Start > 0, sonst 0).
- Der Bonus geht NUR in die Anzeige des Kontostands ein, damit sie mit dem
  Wallet übereinstimmt; Performance bleibt bonusfrei.

Anzeige bei vorhandenem Kontostand (zentriert, untereinander):
1. Aktuell, gross, Zweidezimal-Währung; grün bei P&L ≥ 0, sonst rot.
2. Unterzeile `dashboard.currentBalance`.
3. Performance mit Vorzeichen „+“ bei ≥ 0, eine Nachkommastelle, „%“; grün
   bei ≥ 0, sonst rot.
4. Nur bei B > 0: klein „inkl. ‹B Zweidezimal-Währung› Bonus“ (heute fester
   deutscher Text **[Altfehler: nicht übersetzt]**), Hinweistext
   `dashboard.bonusHint`.

Darunter, nur wenn `allTimeVolume` > 0, eine Zweizeilen-Tabelle:
`dashboard.volume30d` → `last30dVolume`; `dashboard.volumeTotal` →
`allTimeVolume` (beide Tausender-Währung, fett).

Dann Trennlinie und die **drei Ringe** nebeneinander, Element-IDs
`pieChart1` (Gewinnquote, immer), `pieChart2` (Zufriedenheit, nur wenn
`zufriedenheitTage` oder `zufriedenheitTrades` nicht leer), `pieChart3`
(RRR, nur wenn `gewinnAnalyse[betragArt + 'R']` vorhanden, keine NaN und
> 0). Breite: alle drei → je ein Drittel; zwei → je halb; nur `pieChart1` →
volle Breite. Gezeichnet von `zeichneDiagramme` (Formeln: `diagramme.md` §2.1, §3.2).
Die Sichtbarkeitsbedingungen von `pieChart2`/`pieChart3` müssen exakt die
Bedingungen aus `diagramme.md` §2.1 sein, sonst steht ein leerer Ring da.

**Heute-Zähler** (nur wenn mindestens ein Trade heute):
- Heute = Tagesanfang bis Tagesende von „jetzt“ in `timeZoneTrade` (fehlend:
  `'Europe/Brussels'`), Unix-Sekunden.
- Zählt jeden Trade aus `gefilterteTradesFlach`, dessen `td` in diesem Fenster
  liegt (also nur, was der aktuelle Filter enthält). Je Trade: Wert =
  `netProceeds`, sonst `grossProceeds`, sonst 0; P&L-Summe += Wert;
  `istGewinn(Wert)` → Gewinner, sonst Verlierer (Break-even zählt als
  Gewinner).
- Anzeige: Titel `common.today`; „‹Anzahl› `common.trades`“, Gewinner grün mit
  Pfeil hoch, Verlierer rot mit Pfeil runter; darunter P&L mit „+“ bei ≥ 0,
  Zweidezimal-Währung, grün/rot.
- **[Offen]** `td` ist der Tagesstempel des Imports; liegt die Handelszeitzone
  westlich von UTC und ist `td` UTC-Mitternacht, fällt ein heutiger Trade
  heraus. Nachbilden.

**Sync-Knopf:** Während eines Laufs gesperrt und Symbol drehend; zweiter
Klick während des Laufs wird ignoriert. Ablauf: Rückmeldung löschen,
`await syncStartBalanceFromBroker()`.
- Ergebnis `ok` → grüne Rückmeldung „✓ Synchronisiert (Start ‹start mit 2
  Stellen›“ + falls `bonus` wahr „, Bonus ‹bonus mit 2 Stellen› ignoriert“ +
  „)“.
- sonst rote Rückmeldung „✗ “ + `error` (fehlend: „Fehler“).
- Die Rückmeldung verschwindet nach ca. 6,5 s, sofern sie mindestens 6 s alt
  ist (eine neuere bleibt stehen).
- **[Altfehler: Texte fest deutsch]** Empfehlung: i18n-Schlüssel anlegen.
- Der Kontostand aktualisiert sich über den `accountBalance`-Store, nicht
  über diese Seite.

#### B.5.2 Karte „Kennzahlen“ (`metrics`)

Titel `dashboard.metrics` + Brutto/Netto-Kennzeichen. Zweispaltige Tabelle
(Bezeichnung links, Wert rechts, Werte fett wo genannt). F = `betragArt`.

| Zeile | Wert | Bedingung / Format | Info |
|---|---|---|---|
| `dashboard.cumulativePnl` | `totals[F+'Proceeds']` | Tausender-Währung, grün ≥ 0 sonst rot | `dashboard.cumulativePnlTooltip` |
| Ratio-Kurzname (B.6) | Ratio-Wert (B.6) | — | Ratio-Info (B.6) |
| `dashboard.plRatio` | `gewinnAnalyse[F+'R']` | 2 Nachkommastellen; „-“ wenn NaN/undefined | `dashboard.plRatioTooltip` |
| `dashboard.mfePlRatio` | `gewinnAnalyse[F+'MfeR']` | Zeile nur wenn Wert weder null noch undefined; 2 Nachkommastellen | `dashboard.mfePlRatioTooltip` |
| Trennlinie | | | |
| `dashboard.avgWinPerTrade` (grün beschriftet) | `gewinnAnalyse[F+'AvWinPerShare']` | Zweidezimal-Währung; „-“ wenn NaN | |
| `dashboard.avgLossPerTrade` (rot) | `gewinnAnalyse[F+'AvLossPerShare']` | ebenso (Wert ist positiv) | |
| `dashboard.maxWin` (grün) | `gewinnAnalyse[F+'HighWinPerShare']` | nur > 0, sonst „-“ | |
| `dashboard.maxLoss` (rot) | `gewinnAnalyse[F+'HighLossPerShare']` | nur > 0, sonst „-“ (Wert ist positiv) | |
| Trennlinie | | | |
| `common.trades` | `totals.trades` | Tausenderformat, fett | |
| `dashboard.winTrades` (grün) | `totals[F+'WinsCount']` | roh | |
| `dashboard.lossTrades` (rot) | `totals[F+'LossCount']` | roh | |

Grenzfall: ist `gewinnAnalyse[F+'R']` `null`, gilt es heute nicht als NaN,
und die Zweistellen-Formatierung wirft. **[Altfehler]** Empfehlung: null wie
NaN behandeln („-“).

#### B.5.3 Karte „Gebühren“ (`fees`)

Titel `dashboard.fees` (kein Brutto/Netto-Kennzeichen).

Rechnung (alle fehlenden Werte = 0):
- Gesamtgebühren G = `totals.fees`; je Trade = G / `totals.trades`
  (0 Trades → 0).
- Anteil am Bruttogewinn = G / `totals.grossWins` × 100, nur wenn
  `grossWins` > 0, sonst 0.
- (Heute zusätzlich berechnet und nirgends angezeigt: G / |`grossProceeds`| ×
  100. Neubau: weglassen.)
- Netto-Funding N = `totals.fundingPaid` − `totals.fundingReceived`
  (positiv = netto bezahlt = Kosten, negativ = netto erhalten).

Anzeige:
1. G gross in Warnfarbe, Zweidezimal-Währung; Unterzeile `dashboard.totalFees`.
2. Nur wenn Anteil > 0: Zeile `dashboard.feeShareOfGross` mit Anteil (1
   Nachkommastelle, „%“) und darunter ein waagrechter Füllbalken, Füllung =
   Anteil, gedeckelt bei 100 %.
3. Trennlinie, Detailtabelle:
   - `dashboard.avgPerTrade` → je Trade (Zweidezimal-Währung, fett).
   - `dashboard.tradingFees` (Info `dashboard.tradingFeesTooltip`) →
     `totals.tradingFees`, falls 0/fehlend `totals.commission`, sonst 0.
   - nur wenn `fundingPaid` > 0: `dashboard.fundingPaid` (Info
     `dashboard.fundingFeesTooltip`) → `fundingPaid`.
   - nur wenn `fundingReceived` > 0: `dashboard.fundingReceived` (Info
     `dashboard.fundingFeesTooltip`) → „-“ + `fundingReceived`, grün.
   - nur wenn `otherFees` > 0: `dashboard.otherFees` → `otherFees`.
4. Trennlinie, **Brutto→Netto-Brücke**:
   - `dashboard.grossPnl` → `totals.grossProceeds`, fett, grün ≥ 0 / rot.
   - „− “ + `dashboard.tradingFees` (gedämpft) → Handelsgebühren wie oben,
     Warnfarbe.
   - nur wenn N ≠ 0: Vorzeichen „−“ bei N ≥ 0, sonst „+“, dann
     `dashboard.fundingNet` → |N|; Warnfarbe bei N ≥ 0, grün sonst.
   - `dashboard.netPnl` → `totals.netProceeds`, fett, grün ≥ 0 / rot.
   - **[Offen]** `otherFees` erscheint nicht in der Brücke; ob die Brücke
     dann noch aufgeht, hängt davon ab, ob `totals-kern` sie in `netProceeds`
     einrechnet. Nachbilden wie beschrieben.

### B.6 Ratio-Auswahl (APPT / Profitfaktor)

Quelle ist heute `localStorage['selectedRatio']` direkt (nicht der Store
`selectedRatio`; `setzeFilterwerte` hat dort `'appt'` vorgegeben und alte
`'apps'` auf `'appt'` umgeschrieben). Die Berechnung läuft neu, sobald sich
`totals` ändert. **[Altfehler]** Empfehlung: den Store `selectedRatio` lesen
(gleicher Wert, aber reaktiv).

- `'appt'`: Kurzname „APPT“, Name `dashboard.avgProfitPerTrade`, Wert =
  `totals[F+'Proceeds']` / `totals.trades` (0 Trades → 0) als
  Zweidezimal-Währung. Info (HTML, je Zeile ein Block):
  `dashboard.avgProfitPerTrade`; `dashboard.apptFormula`;
  `dashboard.proceeds` + „: “ + Erlös (Tausender-Währung); „Trades: “ +
  Anzahl (Tausenderformat).
- `'profitFactor'`: Kurzname und Name `options.profitFactor`. Gewinne W =
  `totals[F+'Wins']` als Zahl (fehlend 0), Verluste L = |`totals[F+'Loss']`|.
  L > 0 → W / L; sonst W > 0 → unendlich (Anzeige „∞“); sonst 0. Anzeige mit 2
  Nachkommastellen über `useXDecFormat`. WICHTIG: mit den ungerundeten Zahlen
  rechnen — Runden vor dem Teilen machte winzige Verluste zu 0 und den Faktor
  zu ∞. Info: `dashboard.profitFactorFormula`; `dashboard.gains` + „: “ +
  Gewinne (Tausender-Währung); `dashboard.losses` + „: “ + Verluste.
- jeder andere Wert: Kurzname, Name, Wert, Info leer (undefiniert).

Der Kurzname geht als Parameter `metric` in die Titel der Gruppen-Karten
(`dashboard.byWeekday`, `byEntryTime`, `byDuration`, `byPosition`,
`byStrategy`, `bySymbol`). Die Diagramme selbst lesen `selectedRatio` aus dem
Store (siehe `diagramme.md`).

### B.7 Reiter „Übersicht“, Diagrammreihe

| Karte | Element-ID | Breite | Titel | Info |
|---|---|---|---|---|
| `cumulativePnl` | `lineBarChart1` | voll | `dashboard.cumulativePnlChart` + Kennzeichen | `dashboard.cumulativePnlChartTooltip` |
| `appt` | `barChart1` | halb (Desktop) | Ratio-Name; bei Kurzname „APPT“ zusätzlich „ (APPT)“; + Kennzeichen | — |
| `winRate` | `barChart2` | halb | `dashboard.winRate` + Kennzeichen | `dashboard.winRateTooltip` |

Diese Reihe hängt NICHT an `dashboardBereit`. Auskommentiert (nicht
nachbauen): Risk&Reward-Karte `boxPlotChart1`.

### B.8 Klärung `barChartNegative12` / `barChartNegative14`

Beide IDs (Gruppierung nach Aktien-Float bzw. Marktkapitalisierung) stehen im
heutigen Dashboard nur in auskommentiertem Template; es gibt KEIN Element.
`zeichneDiagramme` sucht Knoten per ID-Präfix und findet sie daher in der App nie.
Nur die Golden-Master-Attrappe liefert diese Knoten (siehe `diagramme.md`
§5.1, §6.9). Folge für den Neubau: das Dashboard rendert sie NICHT; die
Diagrammfunktionen bleiben unverändert (der Golden Master prüft sie
unabhängig von der Ansicht). Ebenso wenig nachbauen: `scatterChart1`/`2`.
`negativeTagGruppen` wird von `starteDashboard` gefüllt, aber das
Dashboard rendert dafür keine Elemente.

### B.9 Reiter „Zeit & Datum“ (`timeTab`)

| Karte | Element-ID | Breite | Titel | Info |
|---|---|---|---|---|
| `byWeekday` | `weekdayChart1` | Drittel | `dashboard.byWeekday` {metric} + Kennzeichen | `dashboard.byWeekdayTooltip` |
| `byEntryTime` | `entryTimeChart1` | Drittel | `dashboard.byEntryTime` {metric} + Kennzeichen | `dashboard.byEntryTimeTooltip` |
| `byDuration` | `durationChart1` | Drittel | `dashboard.byDuration` {metric} + Kennzeichen | `dashboard.byDurationTooltip` |
| `heatmap` | `heatmapChart1` | voll, 280 px hoch | `dashboard.heatmapTitle` + Kennzeichen | `dashboard.heatmapTooltip` |

### B.10 Reiter „Performance“ (`tradesTab`)

1. `tradingPerformance`: `perfChart1`, volle Breite, 550 px hoch; Titel
   `dashboard.tradingPerformance` + Kennzeichen; Info
   `dashboard.tradingPerformanceTooltip`.
2. `mfeAnalysis` — nur wenn sichtbar UND mindestens ein Verlust-Trade mit
   Zwischengewinn existiert. Titel `dashboard.mfeAnalysis` + Kennzeichen,
   Info `dashboard.mfeAnalysisTooltip`.

**MFE-Rechnung** (F = `betragArt`):
- Leeres Ergebnis, wenn `gefilterteTradesFlach` oder `excursions` leer.
- Nachschlag: `excursions` nach `tradeId` (Einträge ohne `tradeId`
  übergehen; bei Doppelten gewinnt der letzte).
- Je Trade: Erlös = `trade[F+'Proceeds']` (fehlend 0); Erlös ≥ 0 → kein
  Verlust-Trade, übergehen. Sonst Verlust-Trades += 1.
- Exkursion zum Trade (`trade.id`) fehlt oder ohne `mfePrice` → übergehen
  (zählt nur im Nenner).
- Long = `strategy` = `'long'`, alles andere Short. Zwischengewinn: Long
  `mfePrice` > `entryPrice`, Short `mfePrice` < `entryPrice`. Sonst übergehen.
- Menge = Maximum aus `buyQuantity` und `sellQuantity` (je als Zahl, fehlend 0).
- Verschenkter Gewinn = (`mfePrice` − `entryPrice`) × Menge (Long) bzw.
  (`entryPrice` − `mfePrice`) × Menge (Short). Realisierter Verlust = |Erlös|.
- Zeile: Symbol (fehlend leer), Datum = `td`, sonst `entryTime`, Seite,
  verschenkter Gewinn, Verlust, `mfePrice`, `entryPrice`, `exitPrice`.
- Quote = Treffer / Verlust-Trades × 100 (0 bei 0). Zeilen absteigend nach
  verschenktem Gewinn.

Anzeige:
- Zusammenfassung in einer Zeile: `dashboard.lossTradesInProfit` + „:“ →
  „Treffer / Verlust-Trades (Quote ohne Nachkommastelle %)“ rot;
  `dashboard.givenBackProfit` → Summe verschenkt, grün, Zweidezimal-Währung;
  `dashboard.realizedLoss` → „-“ + Summe Verlust, rot.
- Tabelle, Spalten: `dashboard.symbol`, `dashboard.date`, `dashboard.side`
  (zentriert), „Entry“, „MFE“, „Exit“ (feste Texte), `dashboard.maxReachedProfit`,
  `dashboard.realizedLoss`. Datum = Unix-Sekunden in `timeZoneTrade` als
  „TT.MM.JJ HH:mm“; Seite als Plakette „Long“ (grün) / „Short“ (rot), feste
  Texte; Preise mit 4 Nachkommastellen (`useXDecFormat`), MFE grün, Exit rot;
  verschenkt grün fett, Verlust „-“ + Betrag rot fett.
- **[Altfehler]** Weil `td` der Tagesanfang ist, zeigt die Uhrzeit fast
  immer den Tagesbeginn, nicht den Einstieg. Nachbilden; Empfehlung später:
  `entryTime` bevorzugen.

### B.11 Reiter „Setups“ (`setupsTab`)

| Karte | Element-ID | Breite | Titel | Info |
|---|---|---|---|---|
| `byPosition` | `positionChart1` | halb, 160 px hoch | `dashboard.byPosition` {metric} + Kennzeichen | `dashboard.byPositionTooltip` |
| `byStrategy` | `strategyChart1` | halb, 160 px hoch | `dashboard.byStrategy` {metric} + Kennzeichen | `dashboard.byStrategyTooltip` |

**Trade-Typ-Statistik** (`tradeTypeStats`, nur wenn mindestens eine Zeile):
- Quelle `groups.tradeType` (Schlüssel = Typ). Leere Gruppen übergehen.
- Je Gruppe: Wert je Trade = `netProceeds` (fehlend 0) — IMMER netto, auch
  bei `betragArt` = `'gross'`, obwohl das Kennzeichen „(Brutto)“ zeigt.
  **[Altfehler]** Empfehlung: `betragArt` verwenden (oder das Kennzeichen
  weglassen). `istGewinn` → Gewinner (Summe Gewinne += Wert), sonst Verlierer
  (Summe Verluste += |Wert|). Anzahl, Gewinnquote % = Gewinner/Anzahl × 100,
  Ø = Summe/Anzahl, Profitfaktor = Gewinne/Verluste; Verluste 0 und Gewinne >
  0 → ∞; beide 0 → 0.
- Beschriftung: `scalp` → „Scalptrade“, `day` → „Daytrade“, `swing` →
  „Swingtrade“ (feste Texte), sonst der Schlüssel. Farbe der Plakette:
  scalp bernstein, day blau, swing violett, sonst grau.
- Sortierung absteigend nach Summe.
- Tabelle: `dashboard.tradeType` (Plakette in Typfarbe); „Trades“ (fest) →
  Anzahl gedämpft + klein „(‹G›W / ‹V›L)“; `dashboard.winRate` → kleiner
  Füllbalken (Breite = Quote) + Quote ohne Nachkommastelle „%“, grün ≥ 50
  sonst rot; „∅ P&L“ (fest) → Ø Zweidezimal-Währung grün ≥ 0/rot;
  `dashboard.netPnl` → Summe, fett, grün/rot; `options.profitFactor` → „∞“
  oder 2 Nachkommastellen, grün ≥ 1 sonst rot.
- Info: `dashboard.tradeTypeStatsTooltip`.

**Strategie-Tag-Statistik** (`strategyTagStats`, nur wenn mindestens eine Zeile):
- Strategie-Gruppe = ERSTE Gruppe in `verfuegbareTags` (Konvention: die erste
  Tag-Gruppe ist „Strategie“). Fehlt sie oder `groups.tags` → leer.
- Je Schlüssel in `groups.tags`, der eine Tag-ID dieser Gruppe ist und Trades
  hat: Name = `tagName` des letzten Trades, der einen trägt, sonst die ID;
  Farbe = Farbe der Tag-Definition, sonst Gruppenfarbe. Rechnung wie bei der
  Trade-Typ-Statistik (ebenfalls immer `netProceeds` — gleicher Altfehler).
  Kommentar im Altcode: Break-even zählt als Gewinn (vorher fiel er aus beiden
  Zählern und drückte die Quote).
- Sortierung absteigend nach Summe. Tabelle wie oben, erste Spalte
  `dashboard.strategy` mit Plakette in Tagfarbe. Info
  `dashboard.strategyTagStatsTooltip`.

### B.12 Reiter „Finanzen“ (`financialsTab`)

| Karte | Element-ID | Breite | Titel | Info |
|---|---|---|---|---|
| `bySymbol` | `symbolChart1` | halb | `dashboard.bySymbol` {metric} + Kennzeichen | `dashboard.bySymbolTooltip` |
| `feesBySymbol` | `feesChart1` | halb | `dashboard.feesBySymbol` | `dashboard.feesBySymbolTooltip` |

### B.13 Element-IDs und Klassen

Alle Diagrammelemente tragen als Schlüssel `zeichenZaehler`. `useDisposeJournalCharts`
sammelt die Knoten über die Klassen `chartClass` und `chartIdCardClass` — der
Neubau muss diese beiden Klassen (oder eine angepasste Sammellogik) an den
Diagrammelementen beibehalten: `chartIdCardClass` an `pieChart1`–`3`,
`chartClass` an allen übrigen. Vollständige ID-Liste: `pieChart1`, `pieChart2`,
`pieChart3`, `lineBarChart1`, `barChart1`, `barChart2`, `weekdayChart1`,
`entryTimeChart1`, `durationChart1`, `heatmapChart1`, `perfChart1`,
`positionChart1`, `strategyChart1`, `symbolChart1`, `feesChart1`. Keine anderen
IDs dürfen mit `pieChart`, `perfChart`, `feesChart`, `symbolChart`,
`weekdayChart`, `entryTimeChart`, `durationChart`, `positionChart`,
`strategyChart`, `lineBarChart`, `barChart`, `heatmapChart` beginnen (der
Verteiler sucht per Präfix).

### B.14 i18n-Schlüssel (vollständig)

`auswertung.visibleCards`, `common.today`, `common.trades`,
`dashboard.accountBalance`, `dashboard.apptFormula`,
`dashboard.avgLossPerTrade`, `dashboard.avgPerTrade`,
`dashboard.avgProfitPerTrade`, `dashboard.avgWinPerTrade`,
`dashboard.bonusHint`, `dashboard.byDuration`, `dashboard.byDurationTooltip`,
`dashboard.byEntryTime`, `dashboard.byEntryTimeTooltip`,
`dashboard.byPosition`, `dashboard.byPositionTooltip`, `dashboard.byStrategy`,
`dashboard.byStrategyTooltip`, `dashboard.bySymbol`,
`dashboard.bySymbolTooltip`, `dashboard.byWeekday`,
`dashboard.byWeekdayTooltip`, `dashboard.configureBalance`,
`dashboard.cumulativePnl`, `dashboard.cumulativePnlChart`,
`dashboard.cumulativePnlChartTooltip`, `dashboard.cumulativePnlTooltip`,
`dashboard.currentBalance`, `dashboard.date`, `dashboard.fees`,
`dashboard.feesBySymbol`, `dashboard.feesBySymbolTooltip`,
`dashboard.feeShareOfGross`, `dashboard.finances`,
`dashboard.fundingFeesTooltip`, `dashboard.fundingNet`,
`dashboard.fundingPaid`, `dashboard.fundingReceived`, `dashboard.gains`,
`dashboard.givenBackProfit`, `dashboard.grossPnl`, `dashboard.heatmapTitle`,
`dashboard.heatmapTooltip`, `dashboard.losses`, `dashboard.lossTrades`,
`dashboard.lossTradesInProfit`, `dashboard.maxLoss`,
`dashboard.maxReachedProfit`, `dashboard.maxWin`, `dashboard.metrics`,
`dashboard.mfeAnalysis`, `dashboard.mfeAnalysisTooltip`,
`dashboard.mfePlRatio`, `dashboard.mfePlRatioTooltip`, `dashboard.netPnl`,
`dashboard.otherFees`, `dashboard.overview`, `dashboard.performance`,
`dashboard.plRatio`, `dashboard.plRatioTooltip`, `dashboard.proceeds`,
`dashboard.profitFactorFormula`, `dashboard.realizedLoss`,
`dashboard.setups`, `dashboard.side`, `dashboard.strategy`,
`dashboard.strategyTagStats`, `dashboard.strategyTagStatsTooltip`,
`dashboard.symbol`, `dashboard.timeAndDate`, `dashboard.totalFees`,
`dashboard.tradeType`, `dashboard.tradeTypeStats`,
`dashboard.tradeTypeStatsTooltip`, `dashboard.tradingFees`,
`dashboard.tradingFeesTooltip`, `dashboard.tradingPerformance`,
`dashboard.tradingPerformanceTooltip`, `dashboard.volume30d`,
`dashboard.volumeTotal`, `dashboard.winRate`, `dashboard.winRateTooltip`,
`dashboard.winTrades`, `options.gross`, `options.net`,
`options.profitFactor`.

Feste, nicht übersetzte Texte heute: „APPT“, „Trades“ (Tabellenkopf und
Info), „∅ P&L“, „Entry“/„MFE“/„Exit“, „Long“/„Short“, „W“/„L“,
„Scalptrade“/„Daytrade“/„Swingtrade“, „inkl. … Bonus“, Sync-Rückmeldungen,
Sync-Hinweistext. Neubau darf sie übernehmen; i18n wäre besser.

---

## Auswertung

Route `/auswertung`, Routenname `auswertung`, Modus `journal`.

### W.1 Zustände und Ablauf

Gelesen: `ui.js` `seiteLaedt`, `auswertungMounted`; `filters.js`
`betragArt`; `trades.js` `journalTage`, `auswertungNotes`,
`zufriedenheitTage`, `zufriedenheitTrades`, `tags`, `verfuegbareTags`;
`localStorage['auswertung_hidden_cards']`.

- Vor dem Einhängen: `await useMountAuswertung()` (lädt Bereich,
  Auswertungs-Notizen, Zufriedenheit, Tags, gefilterte Trades; setzt
  `auswertungMounted` erst falsch, dann wahr; ruft `useInitTooltip()`).
  `useMountAuswertung` lädt den Tag-Katalog `verfuegbareTags` NICHT; er kommt
  vom Layout (Journal-Start). Kommt er später, greift der Beobachter in W.6.
- Ein Filterwechsel in der Filterleiste ruft `useMountAuswertung()` erneut.
- Klick-ausserhalb-Lauscher für das Karten-Menü wie beim Dashboard.
- Kein Aufräumen der Diagramme beim Aushängen (heute).

Anzeige: `SeiteLaedt`; darunter (nur sichtbar ohne Spinner):
- `auswertungMounted` wahr und keine Trades → `NoData`;
- `auswertungMounted` wahr und Trades → Seite;
- sonst nichts.

### W.2 Basisdaten

- **Alle Trades**: die `trades`-Listen aller Tage in `journalTage`,
  flach, in Tagesreihenfolge.
- **Notiz je Trade**: aus `auswertungNotes` nach `tradeId` (letzte gewinnt,
  ohne `tradeId` übergehen). Felder einer Notiz (durch `useGetAuswertungNotes`
  schon normalisiert): `tradeId`, `dateUnix`, `note`, `entryStressLevel`
  (fehlend 0), `emotionLevel` (fehlend 0), `feelings`, `playbook`,
  `timeframe`, `entryNote` (fehlend leer).
- **Brokergefilterte Notizen**: `auswertungNotes` mit `tradeId`, deren Trade
  unter „Alle Trades“ vorkommt (Reihenfolge wie geladen).
- **Tags je Trade**: aus `tags` nach `tradeId`; `tags` als Liste von
  Tag-IDs, ist es eine Zeichenkette, wird sie als JSON gelesen (Fehler →
  leere Liste); keine Liste → leer.
- **Tag-Katalog ohne Dubletten**: `verfuegbareTags`, eine Gruppe nur einmal je
  `id` (fehlend: `name`), erste gewinnt.
- „Gewinner“ heisst in dieser Datei überall: `trade[betragArt+'Wins']` > 0.
  Break-even zählt damit als Verlierer — anders als auf dem Dashboard
  (`istGewinn`). **[Altfehler]** Empfehlung: auf `istGewinn` umstellen,
  bewusst und benannt.

### W.3 Karten-Menü

Wie Dashboard B.4, aber: Knopf trägt Zahnrad und Text `auswertung.cards`,
steht rechtsbündig über den Karten; Speicher
`localStorage['auswertung_hidden_cards']`. Feste Karten:

| Schlüssel | Beschriftung |
|---|---|
| `longShort` | `auswertung.longShortRatio` |
| `satisfaction` | `auswertung.satisfactionRate` |
| `completeness` | `auswertung.journalCompleteness` |
| `timeframe` | `auswertung.timeframeUsage` |
| `stressTime` | `auswertung.stressProgress` |
| `stressPerf` | `auswertung.stressVsWinRate` |
| `emotionTime` | `auswertung.emotionProgress` |
| `emotionPerf` | `auswertung.emotionVsWinRate` |
| `radar` | `auswertung.completenessRadar` |

Danach, durch einen Trenner abgesetzt (nur wenn es welche gibt), je
Tag-Gruppe aus W.5 ein Eintrag mit Schlüssel „tag_“ + Gruppenname und dem
Gruppennamen als Beschriftung. Wieder eingeblendete Diagrammkarten bleiben
leer bis zum nächsten Zeichnen (**[Altfehler]** wie B.4).

### W.4 Tachos (obere Reihe, drei Drittel)

Jede Karte: Titel mit Info-Symbol, Tacho-Element, darunter Zusatzzeile.

1. **Long/Short** (`longShort`), Element `gaugeChart1`, Titel/Tacho-Titel
   `auswertung.longShortRatio`, Info `auswertung.tooltipLongShort`.
   - Wert = gerundeter Anteil der Trades mit `strategy` = `'long'` in % (keine
     Trades → 50).
   - Farbstopps: bis 0,5 rot, bis 1 grün (also: mehr Short = rot, mehr Long =
     grün; es ist eine Richtungsanzeige, keine Bewertung).
   - Zusatz zweispaltig: „Long (‹Quote›% Win)“ / Anzahl Long in Grün; „Short
     (‹Quote›% Win)“ / Anzahl Short in Rot. Quote = gerundeter Anteil der
     Gewinner (W.2) unter Long bzw. Short (`strategy` = `'short'`), 0 bei
     keinem. Texte „Long“, „Short“, „Win“ fest.
2. **Zufriedenheit** (`satisfaction`), `gaugeChart2`,
   `auswertung.satisfactionRate`, Info `auswertung.tooltipSatisfaction`.
   - Liste = `zufriedenheitTage` gefolgt von `zufriedenheitTrades`; Wert =
     gerundeter Anteil der Einträge, deren `satisfaction` lose gleich `true`
     oder `1` ist (leer → 0). Die Zufriedenheiten sind NICHT nach Broker
     gefiltert (alles im Zeitraum).
   - Farbstopps: bis 0,3 rot, bis 0,7 gelb, bis 1 grün (schlecht – mittel –
     gut).
   - Zusatz: „‹Listenlänge› `auswertung.ratings`“.
3. **Journal-Vollständigkeit** (`completeness`), `gaugeChart3`,
   `auswertung.journalCompleteness`, Info `auswertung.tooltipCompleteness`.
   - Ein Trade gilt als erfasst, wenn seine Notiz eines hat: `playbook`,
     `timeframe`, Stress > 0, Emotion > 0, `feelings`, `entryNote` — ODER er
     mindestens einen Tag hat. Wert = gerundeter Anteil (keine Trades → 0).
   - Farbstopps wie Zufriedenheit.
   - Zusatz: „‹Anzahl Trades› `common.trades`“.

Farbbedeutung der übergebenen Farben (S4): rot = schlecht/kritisch, gelb =
mittel, grün = gut; heute halbtransparente Varianten von Rot, Gelb, Grün.
Neubau: Token `--bad`, `--warn`, `--good` (bzw. deren Transparenzstufen),
keine eigenen Farbwerte.

### W.5 Tag-Gruppen-Karten

Je Gruppe des Katalogs (W.2) mit mindestens einem Tag:
- je Tag: alle Trades, deren Tag-Liste die Tag-ID enthält; nur Tags mit
  mindestens einem Trade. Gewinner (W.2), Verlierer = Anzahl − Gewinner,
  Quote = gerundet Gewinner/Anzahl × 100, P&L = Summe
  `trade[betragArt+'Proceeds']` (fehlend 0).
- Tags absteigend nach Anzahl. Gruppen ohne Tag-Treffer entfallen.
- Gruppenfarbe = `color`, fehlend grau.

Diagrammdaten je Gruppe (Index i in der Ergebnisliste): Element
`hbarTagGroup` + i, Kategorien = Tagnamen, Gewinne = Gewinnerzahlen,
Verluste = NEGATIVE Verliererzahlen (Balken nach links).

Karte (Schlüssel „tag_“ + Gruppenname): volle Breite, wenn es genau eine
Gruppe gibt, sonst halb. Titel: Punkt in Gruppenfarbe + Gruppenname + Info
`auswertung.tooltipTagGroup` mit `{name}`. Darunter das Diagramm, darunter
Tabelle: `auswertung.tag`, `common.trades` (zentriert),
`auswertung.winPercent` (zentriert, „‹Quote›%“, grün ≥ 50 sonst rot), „PnL“
(fest; „+“ bei ≥ 0, 2 Nachkommastellen, grün/rot).

Achtung: Gruppen werden nach Name verschlüsselt; zwei Gruppen gleichen Namens
teilen sich einen Sichtbarkeitsschlüssel.

### W.6 Weitere Karten (halbe Breite, Reihenfolge)

1. **Zeitrahmen** (`timeframe`), Element `hbarChart2`, Titel
   `auswertung.timeframeUsage`, Info `auswertung.tooltipTimeframe`.
   Je brokergefilterter Notiz mit `timeframe`: Zähler je Zeitrahmen; Gewinner
   (W.2) des zugehörigen Trades zählen extra. Sortiert absteigend nach
   Anzahl. Werte = Anzahl; Farbe je Balken grün bei Gewinnquote ≥ 0,5, sonst
   GELB (nicht rot — „mehr Verlierer“ ist hier nur ein Hinweis). Ohne Daten:
   Text `auswertung.noTimeframeData` statt Diagramm.
2. **Stress-Verlauf** (`stressTime`), `stressLineChart`, Titel
   `auswertung.stressProgress`, Info `auswertung.tooltipStressProgress`.
   Brokergefilterte Notizen mit Stress > 0, aufsteigend nach `dateUnix`;
   Kategorien = `useChartFormat(dateUnix)`, Werte = Stress. Aufruf mit
   Maximum 10, ohne Farbe/Namen (Vorgaben der Funktion). Darunter
   `auswertung.avgStress` und der Mittelwert der Stresswerte > 0 mit einer
   Nachkommastelle, in Orange. Ohne Daten: `auswertung.noStressData`.
3. **Stress vs. Gewinnquote** (`stressPerf`), `hbarChart3`, Titel
   `auswertung.stressVsWinRate`, Info `auswertung.tooltipStressVsWin`.
   Brokergefilterte Notizen mit Stress 0 bis 5 (einschliesslich 0 =
   „nicht erfasst“, weil fehlender Stress zu 0 normalisiert ist) nach Stufe;
   je Stufe 0…5 mit Trades: Kategorie „Stress ‹Stufe›“ (fest), Wert =
   gerundete Gewinnquote %, Farbe grün ≥ 50 sonst rot. Stress 6–10 (die
   Eingabe erlaubt bis 10, siehe Maximum oben) fällt heraus. **[Altfehler]**
   Empfehlung: Stufe 0 auslassen und bis 10 gehen. Ohne Daten:
   `auswertung.noStressData`.
4. **Emotions-Verlauf** (`emotionTime`), `emotionLineChart`, Titel
   `auswertung.emotionProgress`, Info `auswertung.tooltipEmotionProgress`.
   Wie Stress-Verlauf mit `emotionLevel` > 0; Aufruf mit Maximum 10, Farbe
   grün, Reihenname `auswertung.emotionProgress`. Darunter
   `auswertung.avgEmotion` + Mittelwert (1 Stelle) in Grün. Ohne Daten:
   `auswertung.noEmotionData`.
5. **Emotion vs. Gewinnquote** (`emotionPerf`), `hbarChart4`, Titel
   `auswertung.emotionVsWinRate`, Info `auswertung.tooltipEmotionVsWin`.
   Stufen 1–10, Kategorie „Level ‹Stufe›“ (fest), sonst wie Stress vs.
   Gewinnquote. Die Karte erscheint NUR mit Daten (kein Leertext).
6. **Vollständigkeits-Radar** (`radar`), `radarChart1`, Titel
   `auswertung.completenessRadar`, Info `auswertung.tooltipCompletenessRadar`.
   Indikatoren (feste Namen, je Maximum 100): „Playbook“, „Timeframe“,
   „Stress“, „Emotionen“, „Notizen“, „Tags“. Werte = gerundeter Anteil der
   Trades mit Notiz-`playbook`; mit `timeframe`; Stress > 0; Emotion > 0;
   `entryNote` oder `note`; mindestens einem Tag. Keine Trades → alle 0.

Farbbedeutung der Liniendiagramme (S4): Stress in der Vorgabefarbe der
Funktion, Emotion grün; die Mittelwertzahlen orange (Stress) und grün
(Emotion). Neubau: Token, keine eigenen Werte.

### W.7 Zeichnen

- Beobachter auf `auswertungMounted`: wird es wahr und gibt es Trades → zwei
  Render-Takte abwarten → Zeichnen.
- Zeichnen (nach einem weiteren Render-Takt), in dieser Reihenfolge:
  `useGaugeChart('gaugeChart1', Long-Anteil, longShortRatio-Text, Stopps)`,
  dann `gaugeChart2`, `gaugeChart3`; je Tag-Gruppe mit Kategorien
  `useSplitBarChart(Element, Kategorien, Gewinne, Verluste)`; Zeitrahmen
  (nur mit Kategorien) `useHorizontalBarChart('hbarChart2', Kategorien,
  Werte, Farben)`; Stress-Verlauf (nur mit Daten) `useStressLineChart`;
  `hbarChart3`; Emotions-Verlauf; `hbarChart4`; immer `useRadarChart`.
- Die Diagrammfunktionen kehren still zurück, wenn das Element fehlt
  (verborgene Karte).
- Zweiter Beobachter, tief, auf die Tag-Gruppen-Diagrammdaten: nur wenn
  `auswertungMounted` wahr → einen Render-Takt abwarten → je Gruppe mit
  Kategorien `useSplitBarChart` erneut.
- Ein Wechsel von `betragArt` ohne Neuladen zeichnet die Diagramme NICHT neu
  (die Tabellen schon). Nachbilden; ein Filterwechsel lädt ohnehin neu.

### W.8 i18n-Schlüssel (vollständig)

`auswertung.avgEmotion`, `auswertung.avgStress`, `auswertung.cards`,
`auswertung.completenessRadar`, `auswertung.emotionProgress`,
`auswertung.emotionVsWinRate`, `auswertung.journalCompleteness`,
`auswertung.longShortRatio`, `auswertung.noEmotionData`,
`auswertung.noStressData`, `auswertung.noTimeframeData`,
`auswertung.ratings`, `auswertung.satisfactionRate`,
`auswertung.stressProgress`, `auswertung.stressVsWinRate`, `auswertung.tag`,
`auswertung.timeframeUsage`, `auswertung.tooltipCompleteness`,
`auswertung.tooltipCompletenessRadar`, `auswertung.tooltipEmotionProgress`,
`auswertung.tooltipEmotionVsWin`, `auswertung.tooltipLongShort`,
`auswertung.tooltipSatisfaction`, `auswertung.tooltipStressProgress`,
`auswertung.tooltipStressVsWin`, `auswertung.tooltipTagGroup`,
`auswertung.tooltipTimeframe`, `auswertung.visibleCards`,
`auswertung.winPercent`, `common.trades`.

Element-IDs: `gaugeChart1`–`3`, `hbarTagGroup<i>`, `hbarChart2`,
`stressLineChart`, `hbarChart3`, `emotionLineChart`, `hbarChart4`,
`radarChart1`. Tachos tragen eine eigene Höhenklasse, alle anderen
`chartClass`.

---

## Kalender

Route `/calendar`, Routenname `calendar`. Seite `src/views/Calendar.vue`,
Baustein `src/components/Calendar.vue` (ohne Props/Events; wird heute nur von
der Kalenderseite eingebunden).

### K.1 Seite

- Vor dem Einhängen: `await starteKalender()`. Der Ablauf setzt den
  Bereich auf „1. Januar des Jahres des gewählten Monats bis Ende des
  gewählten Monats“ (in `timeZoneTrade`), lädt Tags und Tag-Katalog, die
  gefilterten Trades und baut `kalenderDaten` (`ladeKalender`).
- Anzeige: `SeiteLaedt`; darunter (nur ohne Spinner):
  `journalTage` leer → `NoData`; sonst eine Karte mit dem
  Kalender-Baustein.
- **[Altfehler]** Ist `journalTage` leer (kein Trade vom Jahresanfang bis
  zum gewählten Monat), verschwindet auch die Monatsnavigation; zurück geht es
  nur über die Filterleiste. Empfehlung: Navigation auch bei leerem Monat
  zeigen.
- Die Bedingung „Kalenderdaten vorhanden“ ist heute immer wahr (Objekt).

### K.2 Datenform

`kalenderDaten` (aus `trades.js`) ist ein Objekt mit Schlüsseln „0“, „1“, … je
Woche (Montag zuerst); Wert = Liste von 7 Tagesfeldern
`{month, day, dateUnix, pAndL, satisfaction?}` (siehe `journal-kern.md`
§4.4): `month` = Monatstitel („March 2026“-Form), `day` = Tageszahl (0 =
Füllfeld ausserhalb des Monats), `pAndL` = P&L-Objekt des Tages oder eine
leere Liste, `satisfaction` = Tageszufriedenheit (nur bei Treffer).

### K.3 Monatsraster

- Kopfzeile: links Pfeil „vorheriger Monat“, Mitte Monatstitel = `month` des
  ersten Feldes der ersten Woche (nur wenn vorhanden), rechts Pfeil
  „nächster Monat“. Auf der Kalenderseite schmaler und zentriert.
- Sieben Spalten mit den Tagesnamen `calendar.mon` … `calendar.sun`,
  darunter je Woche ein Feld.
- Jedes Feld wird gerendert, auch Füllfelder (die Bedingung „Feld ≠ 0“ ist
  für Objekte immer wahr): Füllfelder sind leere, ungefärbte Kästchen.
- Tageszahl nur, wenn `day` ≠ 0.
- Nur auf der Kalenderseite und nur ab Tablet-Breite: „‹`pAndL.trades`›
  `common.trades`“ (nur wenn `trades` wahr) und darunter der Erlös
  `pAndL[betragArt+'Proceeds']`, auf eine Ganzzahl abgeschnitten (parseInt)
  und als Tausender-Währung formatiert (nur wenn der Erlös wahr, also ≠ 0).
  **[Altfehler]** parseInt auf Zahlen in Exponentialschreibweise liefert
  Unsinn (ein Erlös von 1e-7 wird zu 1); Empfehlung: abrunden mit
  `Math.trunc`.
- Färbung (`gewaehltPlOderZufriedenheit`):
  - `'pl'`: grün wenn Erlös ≥ 0, rot wenn < 0 — nur Tage mit P&L-Objekt
    (bei leerer Liste ist der Erlös undefiniert → keine Farbe).
  - sonst (Zufriedenheit): grün wenn `satisfaction` lose gleich `true`, rot
    wenn lose gleich `false`; null/fehlend → keine Farbe.
- Klickbar (Zeiger) nur Felder mit `pAndL.trades` wahr. Klick: wenn
  `dateUnix`, `pAndL` und `pAndL.trades` wahr → `scrollToDateUnix`
  (`ui.js`) = `dateUnix`; auf der Kalenderseite dann `router.push('/daily')`.
  Die Tagesansicht scrollt nach ihrem Laden zur Karte dieses Tages
  (`Daily.vue`, nicht Teil dieser Spezifikation).

### K.4 Monatswechsel

Pfeil links = −1, rechts = +1:
1. `seiteLaedt` = wahr.
2. `gewaehlterMonat.start` = Monatsanfang (in `timeZoneTrade`) von
   (`start` + Schritt Monate); `gewaehlterMonat.end` = Monatsende (in
   `timeZoneTrade`) dieses neuen Anfangs. Beides Unix-Sekunden; das Objekt
   wird an Ort und Stelle geändert.
3. `localStorage['selectedMonth']` = JSON von `gewaehlterMonat`.
4. `selectedMonthPreset` = `'current'`, wenn der neue Anfang dem
   Monatsanfang von „jetzt“ in `timeZoneTrade` entspricht, sonst `'custom'`;
   in `localStorage['selectedMonthPreset']`.
5. Seite `calendar` → `starteKalender()` (nicht abgewartet); Seite `daily`
   → `starteTagesansicht()` (toter Zweig, der Baustein steckt heute nicht in der
   Tagesansicht).

### K.5 Mini-Kalender (Klärung S7)

Gedacht war: auf der Kalenderseite unter dem Hauptraster je Monat vom
gewählten bis Januar ein kleines Raster (Monatstitel, Tagesnamen, gefärbte
Felder mit Tageszahl, ohne Trades/Erlös, nicht klickbar), drei bis vier je
Zeile. Quelle `miniKalenderDaten`. Weil `miniKalenderDaten` ein Objekt ist,
setzt `ladeKalender` darin nur den Schlüssel `length` = 0 und legt nie
Monate hinein (`journal-kern.md` §7.4, vom Golden Master eingefroren). Der
Baustein iteriert die Werte des Objekts, trifft nur die 0 und rendert dafür
nichts. **Die Mini-Kalender erscheinen also nie.** Neubau: keine
Mini-Kalender rendern (Parität); wer sie will, behebt zuerst §7.4 bewusst.

### K.6 Tote Zweige

Der Baustein kennt Klassen und Klickbarkeit für die Seite `daily`
(Tagesansicht-Kleinformat). Er wird dort nicht mehr eingebunden. Neubau:
nur die Kalenderseite bedienen.

### K.7 i18n-Schlüssel

`calendar.mon`, `calendar.tue`, `calendar.wed`, `calendar.thu`,
`calendar.fri`, `calendar.sat`, `calendar.sun`, `common.trades`; Seite
zusätzlich `common.noData` über `NoData`.

---

## Trades hinzufügen

Route `/addTrades`, Routenname `addTrades`, Menütitel `nav.manualImport`.

### T.1 Grundzustand

- Beim Anlegen: `seiteLaedt` = falsch.
- Broker = `selectedBroker` oder `'bitunix'`; Anzeigename Bitunix / Bitget /
  Pionex (unbekannt → „Bitunix“).
- Nach dem Einhängen: `await useGetExistingTradesArray()` (füllt
  `vorhandeneTradeTage` mit den `date`-Zeichenketten der neuesten 50
  Tageszeilen der Tabelle `trades`, ALLER Broker; Limit
  `abfrageGrenzeVorhanden` = 50; bei DB-Fehler bleibt das Versprechen
  offen — harmlos, nichts wartet darauf).
- Zwei Reiter (reine Umschaltung, kein Bootstrap-JS): `addTrades.manualTab`
  (Vorgabe) und `addTrades.apiImport`.

### T.2 Manuelle Eingabe — Felder

| Feld | Bezeichnung | Art | Vorgabe |
|---|---|---|---|
| symbol | „Symbol“ (fest), Platzhalter „BTCUSDT“ | Text | leer |
| side | `addTrades.manualSide` | Auswahl `B` = `addTrades.manualLong`, `SS` = `addTrades.manualShort` | `B` |
| date | `addTrades.manualDateExit` | Datum | heute (lokales Datum, JJJJ-MM-TT) |
| entryDate | `addTrades.manualDateEntry` + `addTrades.manualOptional` | Datum | leer |
| entryPrice | `addTrades.manualFieldEntry` + `addTrades.manualOptionalShort` | Text, Dezimaltastatur | leer |
| exitPrice | `addTrades.manualFieldExit` + `manualOptionalShort` | ebenso | leer |
| qty | `addTrades.manualFieldQty` + `manualOptionalShort` | ebenso | leer |
| netPL | `addTrades.manualFieldNetPL` + „ (USDT) *“, Platzhalter `addTrades.manualPnlPlaceholder` | ebenso | leer |
| fee | `dashboard.fees` + „(opt.)“ | ebenso | leer |
| leverage | `addTrades.manualFieldLeverage` + `manualOptionalShort` | ebenso | leer |

Über den Feldern: `addTrades.manualIntro` + Brokername (fett) + „.“ +
`addTrades.manualIntroRequired`.

Zahlenfelder sind bewusst Textfelder mit Dezimaltastatur: ein Zahlenfeld
liefert bei „12,50“ je nach Browser eine leere Zeichenkette, die Gebühr wäre
still „leer“.

Knopf: `addTrades.manualSave`, während des Speicherns gesperrt mit
`addTrades.manualSavingStatus`. Darunter die Meldung (grün bei Erfolg, rot
sonst).

### T.3 Manuelle Eingabe — Prüfung

Zahl lesen: getrimmt; leer → „nicht angegeben“; sonst das ERSTE Komma durch
einen Punkt ersetzen und als Zahl lesen; nicht endlich → Fehler
`addTrades.manualNotANumber` mit `{feld}` = Feldbezeichnung, Wert „nicht
angegeben“. Ein leeres Feld ist nie eine Null.

Ablauf beim Klick:
1. Meldung löschen. Symbol = getrimmt, Grossbuchstaben. Leer → Meldung
   `addTrades.manualSymbolMissing`, Ende (keine weiteren Prüfungen).
2. Fehlerliste sammeln, in dieser Reihenfolge:
   - netPL lesen (Feldname `manualFieldNetPL`); nicht angegeben UND noch kein
     Fehler → `addTrades.manualNetPLMissing`.
   - fee, qty, entryPrice, exitPrice, leverage lesen (Feldnamen
     `manualFieldFee`, `manualFieldQty`, `manualFieldEntry`,
     `manualFieldExit`, `manualFieldLeverage`).
   - qty angegeben und ≤ 0 → `addTrades.manualQtyPositive`.
   - entryPrice angegeben und < 0 → `addTrades.manualPricePositive`; ebenso
     exitPrice (Meldung kann doppelt erscheinen).
   - leverage angegeben und ≤ 0 → `addTrades.manualLeveragePositive`.
   - Ausstiegsdatum als UTC-Datum: ungültig → `addTrades.manualDateInvalid`;
     sonst Tagesbeginn nach dem heutigen UTC-Tagesbeginn →
     `addTrades.manualDateFuture`.
   - Einstiegsdatum, falls angegeben: ungültig →
     `addTrades.manualEntryDateInvalid`; sonst (nur bei gültigem Ausstieg)
     Tag nach Ausstiegstag → `addTrades.manualEntryAfterExit`.
3. Fehler vorhanden → Meldung = Fehler mit „ · “ verbunden, rot, Ende.
4. Plausibilitätswarnung (sperrt nicht): beide Preise angegeben und > 0,
   netPL ≠ 0: Long = side `B`; Preisgewinn = Ausstieg > Einstieg (Long) bzw.
   Ausstieg < Einstieg (Short); widerspricht er „netPL > 0“, wird an die
   Erfolgsmeldung „ — “ + `addTrades.manualPnlMismatch` gehängt.

### T.4 Manuelle Eingabe — Speichern

Während des Speicherns ist der Knopf gesperrt.

- fee = |fee| oder 0; netPL wie gelesen; grossPL = netPL + fee; Menge = qty
  oder 1.
- dateUnix = Beginn des Ausstiegstags in UTC (Sekunden); exitTime = 12:00
  UTC des Ausstiegstags; entryTime = 12:00 UTC des Einstiegstags, ohne
  Einstiegsdatum = exitTime.
- Trade-Objekt über `buildTradeObj` mit: `id` = „t“ + dateUnix + „_0_manual“
  + aktuelle Millisekunden; `broker` = Broker; `td` = dateUnix; `side`;
  `quantity` = Menge; `entryTime`; `exitTime`; `entryPrice`/`exitPrice`
  (nicht angegeben → 0); `symbol`; `grossPL`; `netPL`; `fee`;
  `tradingFee` = fee; `fundingFee` = 0; `isGrossWin` = `istGewinn(grossPL)`;
  `isNetWin` = `istGewinn(netPL)`. Hebel angegeben → zusätzlich Feld
  `leverage` am Objekt.
- `await saveManualTrade(Trade-Objekt)` (hängt an die Tageszeile Broker +
  dateUnix an oder legt sie an, rechnet Blotter und P&L des Tages neu).
- `await refreshAccountBalance({ broker, force: true })`, Fehler ignorieren.
- Erfolgsmeldung `addTrades.manualSaved` mit `{symbol}`, `{seite}` (Long-/
  Short-Bezeichnung), `{pnl}` („+“ bei ≥ 0, dann netPL als rohe Zahl),
  `{datum}` (Eingabe des Ausstiegsdatums) + ggf. Warnung.
- Felder netPL, fee, entryPrice, exitPrice, qty leeren; Symbol, Seite, Daten
  bleiben stehen (schnelle Mehrfacheingabe). **[Altfehler]** Der Hebel bleibt
  ebenfalls stehen — damit gilt das Formular nach dem Speichern weiter als
  „ungespeichert“ (T.6). Empfehlung: Hebel mitleeren.
- Fehler beim Speichern → `addTrades.manualSaveFailed` + „ “ + Fehlertext.

### T.5 API-Import

Oben `addTrades.apiDescription` mit `{broker}` (enthält HTML mit Link zu den
Einstellungen, wird als HTML eingesetzt).

**Pionex** (Broker `pionex`): Hinweis `addTrades.apiPionexHint`, Knopf
`addTrades.apiPionexButton` (während des Laufs gesperrt,
`addTrades.importingStatus`). Keine Datumsfelder (der Server nutzt den
letzten Import bzw. das Startdatum aus den Einstellungen). Klick:
`await useQuickApiImport('pionex')` (importiert und speichert direkt, inkl.
Nachtrag der P&L-Aufschlüsselung bestehender Bots); danach
`sendNotification('importFertig', 'Pionex Import', Ergebnis.message oder
messages.importCount mit {count})`. Fehler → Fehlertext = Server-`error`,
sonst Fehlermeldung, sonst `addTrades.importFailed`; Benachrichtigung
`messages.importFailed` + Fehlermeldung. Keine Vorschau.

**Bitunix / Bitget**: zwei Datumsfelder `addTrades.startDate` (Vorgabe heute
− 7 Tage) und `addTrades.endDate` (Vorgabe heute), Knopf
`addTrades.importFromApi` (gesperrt/`importingStatus` während des Laufs).
Keine Prüfung Start ≤ Ende.

Ablauf (Lade-Merker an, Fehlertext leeren):
1. Zeitfenster: Start = UTC-Tagesbeginn des Startdatums, Ende = UTC-Tagesende
   des Enddatums, beide in MILLIsekunden.
2. Positionen holen:
   - Bitget: ein Aufruf GET `/api/bitget/positions` mit `startTime`,
     `endTime`; Antwort-`code` ≠ 0 → Fehler mit `msg` (fehlend „API error“);
     Liste = `data.positionList` (fehlend leer).
   - Bitunix: seitenweise GET `/api/bitunix/positions` mit `startTime`,
     `endTime`, `skip`, `limit` = 100, `skip` ab 0 in Schritten von 100, bis
     eine Seite weniger als 100 liefert; Fehlerprüfung wie Bitget.
3. Keine Positionen → Fehlertext `addTrades.noPositionsFound`,
   Benachrichtigung „‹Broker› Import“ / `addTrades.noPositionsFound`, Ende.
4. `seiteLaedt` = wahr. Import-Stores leeren: `executions` (alle
   Schlüssel löschen), `vorhandeneImporte`, `tradeZeilen`.
5. Je Position (mit Index i): Trade-Objekt =
   `createBitgetTradeObj(Position, i)` bzw. `createBitunixTradeObj(Position,
   i)` — die EINZIGE Rechenvorschrift für Trade-Objekte (gleich wie der
   Schnellimport; hier standen früher eigene, falsche Kopien). Gruppiert nach
   `td` in eine lokale Tagesliste und in `executions[td]` (Kopie des Objekts
   mit zusätzlichem Feld `trade` = `id`).
6. Bereits importierte Tage aussortieren: je Tag td das UTC-Datum
   „JJJJ-MM-TT“; steht es in `vorhandeneTradeTage` → td (als Zahl) an
   `vorhandeneImporte` anhängen, Tag aus lokaler Liste und `executions`
   entfernen.
   - **[Altfehler]** Der Abgleich ist TAGESWEISE und über ALLE Broker: ein
     Tag, an dem schon irgendein Broker eine Zeile hat, wird komplett
     übersprungen, auch mit neuen Positionen. Und nur die neuesten 50
     Tageszeilen sind bekannt; ältere Tage gelten als neu und werden doppelt
     angelegt. Der Schnellimport (`useQuickApiImport`) gleicht dagegen je
     `positionId` und Broker ab. Empfehlung: diesen Weg auf den
     positionsgenauen Abgleich umstellen (bewusst, eigener Auftrag).
   - **[Offen]** `vorhandeneTradeTage` enthält das `date` der DB-Zeile, das
     `useUploadTrades` mit der Browser-Zeitzone aus dateUnix bildet; hier wird
     mit UTC verglichen. Westlich von UTC weichen die Tage um eins ab.
7. Nichts übrig → Fehlertext `addTrades.allAlreadyImported`,
   Benachrichtigung `messages.noNewTrades`, Spinner aus, Ende.
8. Den Import-Store `trades` (aus `trades.js`, derselbe den
   `useUploadTrades` liest) vollständig durch die lokale Tagesliste ersetzen.
   `await baueBlotter()` (ohne Argument: aus dem Import-Store),
   `await bauePnL()`.
9. Spinner aus; Benachrichtigung `messages.positionsImported` mit `{count}`
   = Anzahl ALLER geholten Positionen, `{days}` = Anzahl neuer Tage.
10. Jeder Fehler: Fehlertext = Fehlermeldung oder `addTrades.importFailed`;
    Benachrichtigung `messages.importFailed` + (Meldung oder `common.error`);
    Spinner aus.
11. Lade-Merker aus.

Alle Benachrichtigungen: `sendNotification('importFertig', '‹Brokername›
Import', Text)` (zeigt nur bei erteilter Erlaubnis, Tab ohne Fokus,
Hauptschalter und Ereignis an).

Fehlertext erscheint als roter Hinweis unter den Feldern.

**Vorschau** (nur im API-Reiter):
- `vorhandeneImporte` nicht leer → `addTrades.alreadyImported` + Liste der
  Daten (`useDateCalFormat`), durch „, “ getrennt.
- Wenn `blotter` und `pAndL` nicht leer: je Schlüssel in `executions` mit
  Eintrag in `blotter`: Überschrift `useCreatedDateFormat(Schlüssel)`,
  Tabelle mit festen Spaltentiteln „Symbol“, „Gross PnL“, „Fees“, „Net PnL“,
  „Wins“, „Losses“, „Trades“; je Symbol aus `blotter[Tag]` eine Zeile:
  Symbol, `grossProceeds` (2 Stellen, grün ≥ 0/rot), `fees` (2 Stellen),
  `netProceeds` (2 Stellen, grün/rot), `grossWinsCount`, `grossLossCount`,
  `trades`; Summenzeile `common.total` aus `pAndL[Tag]` mit denselben
  Feldern. Gewinne/Verluste sind immer die Brutto-Zähler.
- Knopf `common.submit` (gross, grün), sichtbar wenn `executions` nicht leer
  und kein Spinner → `useUploadTrades()` (legt je Tag eine Zeile in `trades`
  an mit `date`, `dateUnix`, `openPositions`, `broker`, `executions`,
  `trades`, `blotter`, `pAndL`; meldet Fehlschläge per `alert`; schreibt ggf.
  MFE-Liste; navigiert HART nach `/dashboard`). Heute wird der Knopf direkt
  als Ereignis-Handler gebunden, das Klickereignis landet als erstes Argument
  (wird ignoriert); Neubau: ohne Argumente aufrufen.
- Knopf `common.cancel` (klein) → `router.push('/dashboard')` (keine harte
  Navigation; der Altcode hatte dort einen Formular-Typ, den es nicht gibt).

### T.6 Verlassen-Schutz

`useVerlassenSchutz(Bedingung, () => t('common.unsavedLeave'))`. Bedingung:
eines der Felder entryPrice, exitPrice, qty, netPL, fee, leverage ist
getrimmt nicht leer. Symbol und Daten zählen bewusst nicht. Der Schutz greift
bei Router-Navigation (Rückfrage mit dem Text) und beim Entladen (Browser-
Standardtext). Achtung: die harte Navigation nach dem Absenden des
API-Imports löst bei ausgefüllten manuellen Feldern die Entladen-Rückfrage
aus. Nachbilden.

### T.7 i18n-Schlüssel (vollständig)

`addTrades.allAlreadyImported`, `addTrades.alreadyImported`,
`addTrades.apiDescription`, `addTrades.apiImport`,
`addTrades.apiPionexButton`, `addTrades.apiPionexHint`, `addTrades.endDate`,
`addTrades.importFailed`, `addTrades.importFromApi`,
`addTrades.importingStatus`, `addTrades.manualDateEntry`,
`addTrades.manualDateExit`, `addTrades.manualDateFuture`,
`addTrades.manualDateInvalid`, `addTrades.manualEntryAfterExit`,
`addTrades.manualEntryDateInvalid`, `addTrades.manualFieldEntry`,
`addTrades.manualFieldExit`, `addTrades.manualFieldFee`,
`addTrades.manualFieldLeverage`, `addTrades.manualFieldNetPL`,
`addTrades.manualFieldQty`, `addTrades.manualIntro`,
`addTrades.manualIntroRequired`, `addTrades.manualLeveragePositive`,
`addTrades.manualLong`, `addTrades.manualNetPLMissing`,
`addTrades.manualNotANumber`, `addTrades.manualOptional`,
`addTrades.manualOptionalShort`, `addTrades.manualPnlMismatch`,
`addTrades.manualPnlPlaceholder`, `addTrades.manualPricePositive`,
`addTrades.manualQtyPositive`, `addTrades.manualSave`,
`addTrades.manualSaved`, `addTrades.manualSaveFailed`,
`addTrades.manualSavingStatus`, `addTrades.manualShort`,
`addTrades.manualSide`, `addTrades.manualSymbolMissing`,
`addTrades.manualTab`, `addTrades.noPositionsFound`, `addTrades.startDate`,
`common.cancel`, `common.error`, `common.submit`, `common.total`,
`common.unsavedLeave`, `dashboard.fees`, `messages.importCount`,
`messages.importFailed`, `messages.noNewTrades`,
`messages.positionsImported`.

---

## Exkursionen

Route `/addExcursions`, Routenname `addExcursions` (Seitenkennung
`addExcursions` steuert die Abfragen in `ladeTrades` und
`ladeExkursionen`), Menüeintrag ohne Gruppe (`nav.addExcursions`).

Zweck: für vergangene Handelstage ohne Exkursionsdaten aus Minutenkerzen
(Databento oder Polygon) den MFE-Preis je Trade bestimmen und in
`excursions` schreiben.

### E.1 Zustände

Gelesen/geschrieben: `ui.js` `seiteLaedt`; `filters.js` `daysBack`,
`daysMargin` (beide Vorgabe undefiniert, werden nirgends initialisiert);
`trades.js` `imports`, `excursions`; `settings.js` `apis` (Liste
`{provider, key, …}`). Seiteneigener Zustand: API-Index (−1 = keiner),
API-Quelle (`'databento'`/`'polygon'`/keine), Liste fehlender Tage (Anzeige),
Trade-Liste, Symbol-Liste `{symbol, secType}`, frühester und spätester Tag.

### E.2 Ablauf beim Anlegen

1. `seiteLaedt` = falsch.
2. Vor dem Einhängen: `await ladeApis()`; API wählen: Eintrag mit
   `provider` = `'databento'` und nicht leerem `key` hat Vorrang, sonst
   `'polygon'` mit Schlüssel, sonst keiner.
3. Prüfung fehlender Tage (E.3), nicht abgewartet.

### E.3 Fehlende Tage prüfen

Läuft beim Anlegen und bei JEDER Eingabe in die beiden Zahlenfelder.
1. Parallel `ladeTrades()` (lädt Tageszeilen der letzten `daysBack` Tage bis
   jetzt, ohne grosse Spalten, aufsteigend, nach `imports`) und
   `ladeExkursionen()` (Exkursionen desselben Fensters).
2. Anzeige-Liste und Trade-Liste leeren. **[Altfehler]** Symbol-Liste und
   frühester/spätester Tag werden NICHT zurückgesetzt und wachsen über alle
   Prüfungen. Empfehlung: mit zurücksetzen.
3. Je Tageszeile aus `imports`: Gibt es irgendeine Exkursion mit gleichem
   `dateUnix` → Tag gilt als erledigt. Sonst: liegt der Tag vor „jetzt minus
   `daysMargin` Tage“ → Tag in die Anzeige-Liste, alle seine Trades in die
   Trade-Liste, frühesten/spätesten Tag anpassen, je neuem Symbol
   `{symbol, secType: type}` in die Symbol-Liste. Sonst (innerhalb des
   Puffers) übergehen. Nur Konsolenausgaben.
4. Keine Tageszeilen → nur Konsolenausgabe.

Grenzfall: Solange `daysBack` undefiniert ist (erster Aufruf ohne Eingabe),
ist die untere Zeitgrenze ungültig (NaN); was der Server daraus macht, ist
**[Offen]**. Ist `daysMargin` undefiniert, ist der Puffer-Vergleich nie wahr
→ keine fehlenden Tage. Die Felder liefern Zeichenketten; dayjs verarbeitet
sie als Zahlen.

### E.4 Anzeige

- Kein API-Schlüssel → Text `excursions.configureApiKey` mit `{link}` = Link
  auf `/settings/journal` mit Text `nav.settings` (als HTML eingesetzt).
- Sonst ein Satz: `excursions.forLastDays` + Zahlenfeld (`daysBack`) +
  `excursions.daysWithBuffer` + Zahlenfeld (`daysMargin`) +
  `excursions.dayBuffer` + „e“ nur bei `daysMargin` > 1 (deutsche Mehrzahl
  „Tage“, fest angehängt) + `excursions.buffer`; dann bei fehlenden Tagen
  `excursions.missingMfeDates` + Daten (`useDateCalFormat`, „, “-getrennt),
  sonst `excursions.allUpToDate`.
- Knopf `excursions.add` (gross, grün), sichtbar bei fehlenden Tagen und ohne
  Spinner. Knopf `common.cancel` → `router.push('/dashboard')`.
- Alles nur sichtbar ohne Spinner.

### E.5 MFE-Preise hinzufügen

1. Spinner an; seiteneigene MFE-Liste leeren.
2. `ohlc` = `await useGetOHLCV(API-Quelle, 'manual', Symbol-Liste,
   frühester Tag, spätester Tag)`.
3. Für jeden Trade der Trade-Liste mit `openPosition` == falsch (lose):
   MFE-Liste = `await useGetMFEPrices(Trade, Trade.entryTime,
   Trade.entryPrice, Trade, ohlc)`.
4. MFE-Liste nicht leer → `await useUpdateMfePrices(null, null, Liste)`
   (schreibt Zeilen `{mfePrice, dateUnix, tradeId}` in `excursions`).
5. Spinner aus; `usePageRedirect('daily')` (harte Navigation nach `/daily`).
6. Das umschliessende Versprechen wird nie erfüllt (niemand wartet darauf).

### E.6 Fehlerfälle (Altfehler aus S3, `journal-kern.md` §7.5–§7.7)

- **MFE-Modulspeicher**: `useGetMFEPrices` hängt an eine Modulliste in
  `import.js` an, die NIE geleert wird, und gibt sie ganz zurück;
  `useUpdateMfePrices` schreibt die ganze Liste. Ein zweiter Lauf in derselben
  Seitenlebenszeit (ohne Neuladen) schreibt die Einträge des ersten erneut →
  doppelte Exkursionen. Das Leeren der seiteneigenen Liste in Schritt 1 hilft
  nicht. Durch die harte Navigation am Ende ist der Fall selten, aber
  möglich (z. B. mit einem vorangegangenen API-Import, dessen
  `useUploadTrades` dieselbe Liste kennt).
- **`useGetOHLCV` erfüllt nach dem ERSTEN Symbol**; die übrigen laden danach
  weiter. `useGetMFEPrices` für ein noch nicht geladenes Symbol liefert ein
  Versprechen, das NIE erfüllt wird → die Schleife bleibt hängen, Spinner
  dreht für immer. Bei Databento mit leerer CSV ebenfalls nie erfüllt.
- `useUpdateMfePrices` mit leerer Liste wird nie erfüllt (hier durch die
  Längenprüfung vermieden); ein DB-Fehler lehnt ab, die Ablehnung ist hier
  unbehandelt.
- Polygon: bei HTTP-Fehler ausser 429 ein `alert` mit der Meldung; 429 →
  bis 5 Wiederholungen mit 60 s Abstand.
- **Fachlich**: Databento kennt nur `secType` `'future'`/`'stock'`;
  Krypto-Futures haben `type` `'futures'` → Datensatz undefiniert. Polygon
  kennt die Krypto-Perp-Symbole nicht in dieser Form. Die Seite ist ein
  Überbleibsel aus dem Aktienkontext und für die heutigen Broker praktisch
  wirkungslos. Empfehlung: Parität für den Neubau herstellen, die Seite aber
  im Auftragsstand als Kandidat für Entfernen oder Umstellen auf
  Binance-Kerzen notieren.

### E.7 i18n-Schlüssel

`common.cancel`, `excursions.add`, `excursions.allUpToDate`,
`excursions.buffer`, `excursions.configureApiKey`, `excursions.dayBuffer`,
`excursions.daysWithBuffer`, `excursions.forLastDays`,
`excursions.missingMfeDates`, `nav.settings`.

---

## Trade-Bewertung (Popup)

`src/components/TradeEvalPopup.vue`, ohne Props und Events. Eingebunden in
`src/layouts/Dashboard.vue` am Ende des Layouts, nur solange die Route im
Journal-Modus ist (Modus fehlt, `journal` oder `any`); verlässt man den
Journal-Modus, wird es entfernt, beim Zurückkehren neu angelegt.

### X.1 Zustände

Aus `trades.js` (Werte leben in `stores/journal/offenePositionen.js`):

- `evalNeu`: `{ oeffnung: {anzahl, jeBroker}, schluss: {anzahl, jeBroker} }`;
  `jeBroker` = Objekt Broker → Anzahl.
- `evalNotificationShown` (Vorgabe falsch), `evalNotificationDismissed`
  (Vorgabe falsch).

Gesetzt werden sie von `src/utils/incoming.js` (Zähleraktualisierung): gibt es
offene bzw. zu schliessende Positionen, die noch nie gemeldet wurden
(gemerkt in `localStorage` über `getNotifiedPositionIds`/
`addNotifiedPositionIds`), wird `evalNeu` mit NUR diesen neuen Positionen
gefüllt, `evalNotificationShown` = wahr, `evalNotificationDismissed` =
falsch.

### X.2 Inhalt

Dialog, zentriert, schmal:
- Kopf: Glocken-Symbol + `incoming.newTradeEvals`; Schliessknopf
  (Bedienhilfe-Text `common.close`).
- Rumpf:
  - nur bei `oeffnung.anzahl` > 0: Punkt in Akzentfarbe, „‹Anzahl›“ +
    `incoming.openingEvaluations` (Anzahl > 1) bzw.
    `incoming.openingEvaluation`; darunter je Broker eine Pille
    „‹Brokername› ‹Anzahl fett›“.
  - nur bei `schluss.anzahl` > 0: dasselbe mit Punkt in Warnfarbe und
    `incoming.closingEvaluations` / `incoming.closingEvaluation`.
  - Brokername: `bitunix` → Bitunix, `bitget` → Bitget, `pionex` → Pionex,
    sonst erster Buchstabe gross, leer → „—“.
- Fuss: Knopf volle Breite mit Pfeil-Symbol und `incoming.goToPendingTrades`.

### X.3 Verhalten

- Beim Einhängen: Dialog-Instanz anlegen; Lauscher „Dialog wurde verborgen“
  (auch durch Klick auf den Hintergrund oder Esc) → `evalNotificationDismissed`
  = wahr. Steht beim Einhängen schon `evalNotificationShown` wahr,
  `evalNotificationDismissed` falsch und mindestens eine Anzahl > 0 → nach dem
  nächsten Render-Takt zeigen.
- Beobachter auf `evalNotificationShown`: wechselt es auf wahr und ist nicht
  verworfen → nach dem nächsten Render-Takt zeigen.
- Schliessknopf: verworfen = wahr, verbergen.
- Fussknopf: verworfen = wahr, verbergen, `router.push('/incoming')`.
- **[Altfehler]** `evalNotificationShown` wird nirgends wieder falsch. Nach
  dem ersten Popup einer Seitenlebenszeit ändert eine spätere Meldung den
  Wert nicht mehr → der Beobachter feuert nicht, das Popup erscheint erst
  wieder, wenn die Komponente neu angelegt wird (Moduswechsel) oder die Seite
  neu lädt — obwohl `evalNotificationDismissed` schon auf falsch steht.
  Empfehlung: im Neubau auf „verworfen falsch UND Anzahl > 0“ bzw. auf
  `evalNeu` beobachten; oder `incoming.js` setzt `evalNotificationShown` beim
  Verwerfen zurück.
- Heute greift die Komponente auf das globale Bootstrap-Objekt zu; fehlt es
  (CDN offline), wirft das Einhängen. Neubau: `Dialog` aus
  `src/components/basis/` (nativer `<dialog>`; „verborgen“ = dessen
  Schliess-Ereignis).

### X.4 i18n-Schlüssel

`common.close`, `incoming.closingEvaluation`, `incoming.closingEvaluations`,
`incoming.goToPendingTrades`, `incoming.newTradeEvals`,
`incoming.openingEvaluation`, `incoming.openingEvaluations`.

---

## Anhang: NoData

`src/components/NoData.vue`: ohne Props; eine zentrierte Karte volle Breite
mit dem Text `common.noData`. Benutzt von Dashboard, Auswertung, Kalender.
