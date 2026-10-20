# F3 – Trade-Fenster der Tagesansicht (Verhaltensbeschreibung für den Neubau)

Stand 20.10.2026. Beschreibt, was beim Öffnen, Blättern und Schliessen des
Trade-Detailfensters in `src/views/Daily.vue` geschieht, sowie die
Datums-/Zeitprüfung „selber Handelstag?". Inhalt und Aufbau des Fensters
(Kerzenchart, Fills, SL/TP-Protokoll, Bot-Aufschlüsselung, Orderbuch-Knopf,
Share-Karte) bleiben wie sie sind und sind hier nur so weit beschrieben, wie
Öffnen/Blättern/Schliessen sie anfassen. Keine Aussage über die heutige innere
Gestalt (heute läuft alles durch EINE Routine mit drei Positionsargumenten;
der Neubau trennt Öffnen, Blättern und Schliessen nach eigenem Ermessen,
solange das Verhalten gleich bleibt).

Kennzeichen: **[Eigenart, beibehalten]**, **[Altfehler, beheben]**, **[tot]**
– wie in f3-tags.md.

---

## 1. Zweck

Ein Klick auf eine Trade-Zeile einer Tageskarte öffnet ein Fenster mit allen
Details dieses Trades. Darin blättert man zum vorigen/nächsten Trade DERSELBEN
Karte. Änderungen (heute: nur der MFE-Preis) werden gespeichert, bevor ein
anderer Trade gezeigt oder das Fenster geschlossen wird – es gibt genau einen
Schliessweg.

## 2. Daten

Gelesen (alles schon geladen durch den Aufbau der Tagesansicht bzw. f3-tags/
f3-screenshots):

- Tageskarten des Journal-Kerns (`journalTage`): je Karte `dateUnix`, `trades[]`
  (je Trade u. a. `id`, `symbol`, `td`, `entryTime`, `exitTime`, `tradesCount`,
  `strategy`, `side`, …), `pAndL`, `blotter`.
- Notizen der Tagesansicht (aus Tabelle `notes`, Bereich des Monats):
  `{ tradeId, note, dateUnix, tradingMetadata, tradeType, closingTradeType }`.
- Exkursionen (Tabelle `excursions`, rohe Zeilen mit `objectId`).
- Tag-Zuordnungen und Katalog (f3-tags.md).
- Bilder: geladene Liste und Monatsübersicht (f3-screenshots.md).

Geschrieben:

- Tabelle `excursions`: Spalten `stopLoss`, `maePrice`, `mfePrice` (Zahl oder
  `null`), `dateUnix` (Tag der Karte), `tradeId`.
- (tot, siehe 4) `notes.note`, `tags`, `settings.tags`, `screenshots`.

Kein localStorage-/sessionStorage-Schlüssel.

Texte: `daily.vorheriger`, `daily.naechster`, `daily.closeAndSave`,
`daily.closeModal`, `daily.tags`, `daily.mfePrice`, `daily.mfeTooltip`,
`daily.mfePlatzhalter`, `daily.mfeAuto`, `daily.mfeUebernehmen`, `daily.note`,
`common.screenshotSaveAnnotation`, `common.enlarge`, `daily.swingFrom`,
`daily.swingOpenedOn`, `daily.swingClosedOn`, `daily.open`, `daily.closed`.

## 3. Datums-/Zeitprüfung „selber Handelstag"

Zwei Zeitpunkte (Sekunden) liegen am selben Tag, wenn ihr Kalenderdatum
(`YYYY-MM-DD`) **in der Handelszeitzone** gleich ist. Nicht der Abstand zählt,
sondern das Datum (23:59 und 00:01 sind verschiedene Tage).

Verwendet an drei Stellen, immer mit „Tag des Trades" = `td` des Trades,
ersatzweise `dateUnix` der Karte, gegen `entryTime`:

1. **Einstiegs-Hinweis** in der Trade-Zeile (Spalte Einstieg) und im Fenster
   (Spalte Einstiegspreis): `tradesCount` = 0 → kein Hinweis; selber Tag → kein
   Hinweis; sonst Info-Tipp `daily.swingFrom` mit `{date}` = Einstiegsdatum
   `YYYY-MM-DD` in der Handelszeitzone.
2. **Dauer** im Fenster (nur bei `tradesCount` ≠ 0): selber Tag → Dauer
   `exitTime − entryTime` als `HH:mm:ss` (Stundenanteil der Zerlegung, nicht
   Gesamtstunden); sonst Swing-Dauer = nur der TAGES-Anteil mit „day"/„days"
   (1 Tag 23 h → „1 day"; 0 Tage → „0 day") **[Eigenart, beibehalten]** –
   beide Formate liefert das Formatmodul des Journals (`src/utils/journal/format.js`).
3. Bei `tradesCount` = 0 (offene/geschlossene Swing-Zeile) zeigt die Zeile statt
   der Uhrzeit `daily.open` bzw. `daily.closed` mit Info-Tipp
   `daily.swingOpenedOn` (Einstiegsdatum) bzw. `daily.swingClosedOn`
   (Ausstiegsdatum) – keine Prüfung nötig, aber dieselbe Datumsform.

## 4. Was „ausstehende Änderungen" heute sind

Es gibt vier Änderungs-Markierungen; jede gehört zum ZULETZT gezeigten Trade.
Gespeichert wird immer in dieser Reihenfolge, nacheinander (jeder Schritt
wartet auf den vorigen):

| # | Markierung | Speichern | danach neu laden | heute gesetzt von |
|---|---|---|---|---|
| 1 | Notiz geändert | `notes`: `dbFirst` nach `tradeId` → `dbUpdate(… { note })`, sonst `dbCreate({ note, dateUnix, tradeId })` | Notizen des Monats | **niemand** **[tot]** |
| 2 | Exkursion geändert | siehe 6 | Bereich neu bestimmen, Exkursionen | MFE-Eingabe, „Übernehmen" |
| 3 | Tags geändert | parallel Katalog ergänzen + Zuordnung speichern (f3-tags.md 5.2) | parallel Zuordnungen + Katalog, dann flache Liste | **niemand** **[tot]** |
| 4 | Bild geändert | Bild speichern (f3-screenshots.md 6.1) | Bilder des Tages, Monatsübersicht | **niemand** erreichbar **[tot]** (nur Markieren mit Herkunft „Trade-Fenster", das es nicht gibt) |

Ein Fehler in einem Schritt bricht die Kette ab (Konsole; sichtbar wird er über
den zentralen Fehlerhinweis von `src/utils/db.js`). Danach werden **immer** alle
vier Markierungen zurückgesetzt und die (tote) Tag-Vorschlagsliste geschlossen.

Empfehlung für den Neubau: nur die lebendige Exkursion umsetzen; die Reihenfolge
gilt, falls Notiz/Tags/Bild später wieder eine Bedienung bekommen. Zufriedenheit
gehört NICHT zur Kette (das Fenster zeigt und ändert sie nicht).

**[Altfehler, beheben]** beim Notiz-Weg: die Arbeitskopie der Notiz enthält
den Text OHNE HTML (siehe 5.2 Schritt 9). Würde der Notiz-Weg wieder belebt,
überschriebe er die HTML-Notiz mit reinem Text. Wer ihn belebt, muss die
Rohfassung speichern.

## 5. Verhalten Schritt für Schritt

### 5.1 Öffnen

Auslöser: Klick auf eine Trade-Zeile ODER Enter auf der fokussierten Zeile
(`tabindex="0"`). Klicks/Tasten in der Zelle mit KI- und Share-Knopf öffnen
NICHT (Ereignis dort gestoppt). Ist das Fenster schon offen und lädt gerade
→ ignorieren.

Öffnen = Wechsel (5.2) mit „bisheriger Trade" = „neuer Trade" = diese Zeile.

### 5.2 Wechsel zu einem Trade (Öffnen und Blättern)

1. **Markierung offen?** (Bildmarkierungs-Editor läuft) → Browser-`alert`
   `common.screenshotSaveAnnotation`, sonst nichts; Ergebnis „nicht gewechselt".
2. Ladeanzeige des Fensters an (Eingabebereich zeigt Kreisel, Blätter- und
   Schliessknopf gesperrt).
3. **Ausstehendes speichern** (Abschnitt 4) – für den BISHER gezeigten Trade.
4. Karte und Trade merken (offene Karte, bisheriger und neuer Trade-Index).
   War das Fenster vorher zu: frischer Knoten für den Kerzenchart (neue
   Instanz bei jedem Öffnen, nicht beim Blättern). Fenster-Inhalt sichtbar,
   Dialog offen.
5. Gibt es Karte oder Trade nicht → fertig (weiter mit Schritt 15).
6. **Bilder des Tages**, nur einmal je Fenster-Sitzung (zwischen Öffnen und
   Schliessen): ist die geladene Bildliste leer oder gehört ihr erstes Bild
   (`dateUnixDay`) zu einem anderen Tag als `dateUnix` der Karte → alle Bilder
   dieses Tages laden (f3-screenshots.md 3.3), warten.
7. **Zurücksetzen**: Exkursion = `{ stopLoss: null, maePrice: null, mfePrice:
   null }` (alle anderen Felder weg); Tag-Arbeitsliste leeren; aufgeklappte
   Fill-Gruppen zu; Hinweis „automatisch berechnet" aus. Speicherkontext der
   Exkursion SOFORT = (ID des neuen Trades, `dateUnix` der Karte) – eine
   MFE-Änderung landet immer am gezeigten Trade.
8. **Bild zuordnen**: in der geladenen Liste zuerst das Bild mit `name` =
   Trade-ID, sonst das erste mit `dateUnixDay` = Tag der Karte (ein Tagesbild
   gilt für jeden Trade des Tages). Nichts gefunden, aber die Monatsübersicht
   kennt ein Bild dieses Tages → Bilder dieses Tages laden und nochmals suchen.
   Bild in Bearbeitung leeren; Fund → alle Felder übernehmen; ohne Fund nur
   `side` = `null`, `type` = `null`. Fehlertext des Kerzencharts löschen.
9. **Tags**: Zuordnung mit `tradeId` == Trade-ID (lose Gleichheit, Zahl/Text);
   je Tag-ID, die noch nicht in der Arbeitsliste ist, im Katalog (Gruppen der
   Reihe nach) den ersten Tag mit dieser ID suchen und `{id, name}` anhängen;
   unbekannte IDs fallen weg. Tages-Tags (Zuordnung über den Tag) NICHT.
10. **Notiz**: Notiz-Arbeitskopie, Metadaten, Eröffnungs- und Schluss-Typ
    zurücksetzen (`null`, `null`, `''`, `''`) und Anzeigetext leeren. Notiz mit
    `tradeId` == Trade-ID gefunden → Anzeigetext = Notiz ohne HTML (`<br>` und
    `</p>` werden Zeilenumbruch, alle übrigen Tags entfernt, getrimmt);
    Arbeitskopie = derselbe Text; Metadaten = `tradingMetadata` oder `null`;
    Typen = `tradeType`/`closingTradeType` oder `''`.
11. **Exkursion**: erste Zeile mit `tradeId` == Trade-ID → `stopLoss`,
    `maePrice`, `mfePrice` übernehmen, soweit nicht `null`/`undefined`.
12. **Kerzenchart** anstossen, NICHT abwarten (Eingaben sollen nicht auf die
    Börse warten). Nur wenn die Einstellung `enableBinanceChart` an ist und der
    Trade ein Symbol hat. Ein später eintreffendes Ergebnis eines inzwischen
    verlassenen Trades oder geschlossenen Fensters wird verworfen. (Fenster
    ±6 h um den Einstieg, fest 15m, Futures – unverändert lassen.)
13. **Auto-MFE**: Einstellung `enableBinanceChart` an und kein `mfePrice` →
    MFE aus den Kerzen zwischen Ein- und Ausstieg berechnen (abwarten). Ist das
    Ergebnis eine Zahl UND zeigt das Fenster noch denselben Trade UND hat er
    noch keinen `mfePrice` → `mfePrice` = Ergebnis, Hinweis „automatisch
    berechnet, noch nicht gespeichert" (`daily.mfeAuto`) mit Knopf
    `daily.mfeUebernehmen`. **Nicht** als Änderung markiert, nicht gespeichert
    (Entscheidung D.16-2).
14. Fehler in 6–13 → Konsole, das Fenster bleibt offen.
15. Zum Schluss, wenn das Fenster offen ist: Ladeanzeige aus, Text der (toten)
    Tag-Eingabe leeren, **„Speichern nötig" = nein**.

Ergebnis „gewechselt".

**[Eigenart, beibehalten]**: Schritt 15 setzt „Speichern nötig" nach JEDEM
Wechsel zurück, auch wenn die Exkursion des neuen Trades nur angezeigt wird.
Der Knopf heisst deshalb nach jedem Wechsel `daily.closeModal`.

**[Altfehler, beheben]**: Das Laden der Tagesbilder in Schritt 6/8 schaltet
heute die gemeinsame Ladeanzeige vorzeitig aus (f3-screenshots.md 3.4) –
Blätterknöpfe werden frei, bevor der Wechsel fertig ist. Richtig: Ladeanzeige
bleibt bis Schritt 15.

### 5.3 Blättern

- Knopf „vorheriger Trade" (`daily.vorheriger`, links im Fuss) nur sichtbar,
  wenn die offene Karte einen Trade mit Index − 1 hat; „nächster Trade"
  (`daily.naechster`, rechts im Fuss) nur, wenn sie einen mit Index + 1 hat.
  Beide gesperrt während der Ladeanzeige; ein Klick während der Ladeanzeige
  wird ignoriert.
- Blättern = Wechsel (5.2) mit bisherigem Index → Index ± 1, gleiche Karte.
  Über das Ende einer Karte hinaus wird NICHT auf die nächste Karte geblättert.
- **Tastatur**: keine Pfeiltasten für das Trade-Fenster (die gibt es nur im
  Bild-Vollbild). Tab erreicht die Knöpfe (nativer Dialog = Fokusfalle).

### 5.4 Schliessen (der eine Schliessweg)

Auslöser: × im Kopf, Esc (schliesst den nativen Dialog), Knopf unten
(`daily.closeAndSave` als Hauptknopf, wenn „Speichern nötig", sonst
`daily.closeModal`; gesperrt während der Ladeanzeige). Ein Klick NEBEN das
Fenster schliesst nicht.

1. Läuft der Schliessweg schon (Dialog schon als zu vermerkt) → nichts. (Der
   Dialog-Baustein meldet × und das native `close` beide; das zweite Melden
   fällt hier durch.)
2. **Markierung offen?** → `alert` `common.screenshotSaveAnnotation`; war der
   Dialog nativ schon zu (Esc), ihn sofort wieder öffnen (zu, nächster Tick,
   auf). Ende.
3. Dialog als zu vermerken.
4. Wie 5.2 Schritt 1–3: Markierungsprüfung, Ladeanzeige an, Ausstehendes
   speichern.
5. Aufräumen: Kerzenchart-Instanz freigeben und Grössenbeobachter lösen;
   laufende Kerzenanfrage ungültig machen; Ladeanzeige aus; offene Karte und
   beide Trade-Indizes leer; alle Änderungs-Markierungen aus; „Speichern
   nötig" = nein; Fenster-Inhalt unsichtbar, Dialog zu; „Bilder des Tages
   geladen" = nein (nächstes Öffnen lädt neu); Fehlertext und Ladeanzeige des
   Kerzencharts aus; Fill-Gruppen zu.
6. Ergebnis „geschlossen".

Nicht zurückgesetzt werden: die Tag-Arbeitsliste, das Bild in Bearbeitung,
die Exkursion und ihr Speicherkontext **[Eigenart]** – die Tag-Arbeitsliste
löst dabei den Altfehler f3-tags.md 5.3 aus; mit dessen Behebung (Bildspeichern
schreibt keine Tags) ist das harmlos. Der Neubau darf sie beim Schliessen
leeren. Den Speicherkontext der Exkursion NICHT anders als heute behandeln
(siehe 7, Golden Master).

### 5.5 Orderbuch-Knopf

Nur wenn eine Aufzeichnung verfügbar ist (Prüfung beim Öffnen und bei jedem
Wechsel von Trade/Karte, späte Antworten verworfen). Klick: Ist der Dialog
offen → Dialog als zu vermerken und den Schliessweg ab Schritt 4 gehen;
meldet er „nicht geschlossen" (Markierung offen) → Dialog wieder auf, Ende.
Sonst per Router zu `/liquidity` mit Replay-Parametern.

### 5.6 Seite verlassen bei offenem Fenster

Ausstehendes speichern (angestossen, nicht abgewartet), Fenster-Inhalt
unsichtbar, Karte/Indizes leer, „Speichern nötig" = nein; laufende
Kerzen- und Replay-Anfragen ungültig; Diagramm-Instanzen freigeben.

### 5.7 MFE-Eingabe im Fenster

- Zahlenfeld (`type="number"`, `step="any"`, Platzhalter `daily.mfePlatzhalter`,
  Info-Tipp `daily.mfeTooltip`). Ereignis `change` (nicht bei jedem Tastendruck):
  leer oder keine Zahl → `mfePrice` = `null`, sonst die Zahl.
- Danach und bei „Übernehmen": Speicherkontext = (ID des gezeigten Trades,
  `dateUnix` der offenen Karte), „Exkursion geändert" = ja, „Speichern nötig" =
  ja (Knopf wird `daily.closeAndSave`), Auto-Hinweis aus.

### 5.8 Weitere Bedienungen, die Zustand anfassen

- **KI-Bewertung** aus der Trade-Zeile setzt offene Karte und Trade-Index, ohne
  das Fenster zu öffnen, und wechselt zur KI-Seite **[Eigenart, beibehalten]**
  (harmlos, die Seite wird verlassen).
- **Share-Karte** aus dem Fenster: Tags = Arbeitsliste ∩ erste Katalog-Gruppe.
- **Bild-Vorschau** rechts im Fuss (nur wenn das Bild in Bearbeitung ein
  Anzeige- oder Originalbild hat; `title`/`alt` `common.enlarge`): öffnet das
  Vollbild als Einzelbild (f3-screenshots.md 9), das über dem Trade-Fenster
  liegt.
- Dialog-Titel `<Symbol> · <Kartendatum lang>`; Breite 72rem.

## 6. Exkursion speichern (Schritt 2 der Kette)

1. Ist keines der drei Felder `stopLoss`, `maePrice`, `mfePrice` gesetzt
   (alle `null`/`undefined`) → nichts.
2. Ladeanzeige an.
3. Datensatz: je Feld eine Zahl, wenn der Wert eine endliche Zahl ist (auch
   als Text), sonst `null` – nie `NaN` in die Datenbank.
4. `dbFirst('excursions', { equalTo: { tradeId: <Kontext-Trade> } })`:
   vorhanden → `dbUpdate('excursions', objectId, Datensatz)`; sonst
   `dbCreate('excursions', { ...Datensatz, dateUnix: <Kontext-Tag>, tradeId:
   <Kontext-Trade> })` und die Trade-ID des Imports (geteilter Wert des
   Import-Stores) = Kontext-Trade **[Eigenart, beibehalten]**.
5. Bereich der Seite neu bestimmen, Exkursionen neu laden (Bereich des Monats).

## 7. Bedarf der Aufrufer und Mitbenutzer (ohne Namen)

| Wer | braucht |
|---|---|
| Tageskarten derselben Ansicht | „Zeile öffnet Trade (Karte, Index)"; „ist das Fenster offen und lädt?" |
| Fuss des Fensters | vorhanden vorig/nächst, Ladeanzeige, „Speichern nötig", Schliessen, Blättern |
| Orderbuch-Knopf | Schliessweg mit Ergebnis „geschlossen / nicht geschlossen" |
| Bild-Pfad (f3-screenshots) | Bilder eines Tages laden, Monatsübersicht, Bild in Bearbeitung, „Markierung offen" (Sperre), Bild speichern, Vollbild-Einzelbild |
| Tag-Teil (f3-tags) | Zuordnungen, Katalog, Tag-Info, Arbeitsliste; beim Schliessen wissen, ob Tags geändert wurden (heute nie) |
| Journal-Kern `src/utils/journal/ablauf.js` | Bereich neu bestimmen; Diagramm-Instanzen freigeben (er sucht dabei den Kerzenchart-Knoten mit der DOM-`id` `candlestickChart` – die ID bleibt, sie ist auch Vorgabe des Kerzendiagramms) |
| Tagebuch-Modul `src/utils/journal/tagebuch.js` | Exkursionen und Notizen laden |
| MFE-Pfad `src/utils/journal/import.js` + Golden Master `src/utils/__selftest-mfe-pfade.mjs` | den **geteilten** Speicherkontext „Trade der Exkursion": das Speichern der MFE-Preise kopiert ihn in die Trade-ID des Imports, der Golden Master setzt ihn (`'exk-42'`) und prüft die Kopie. Er muss ein geteilter, von aussen setzbarer Wert bleiben (Name frei, dann Selbsttest mitziehen) und das Trade-Fenster muss ihn wie in 5.2/5.7 setzen. |
| Bündel `src/stores/journal/tagebuch.js`, `src/stores/trades/daily-detail.js`, `src/stores/app/rahmen.js` (Fenster offen, „Speichern nötig"), `src/stores/app/laden.js` (Ladeanzeige) | geteilte Werte; Werte ohne Leser ausserhalb der Ansicht (bisheriger Trade-Index, offene Karte, Trade-Index, Fenster-offen) dürfen in die Ansicht umziehen, sofern Tagebuch-Modul und Bündel nachgezogen werden |

## 8. Prüfliste zum Abnehmen

1. Zeile anklicken und Enter auf fokussierter Zeile öffnen; KI-/Share-Knopf
   öffnen nicht.
2. Dialog: Klick daneben schliesst nicht; ×, Esc und Knopf schliessen, jeweils
   genau EIN Durchlauf (Netz: höchstens ein Speichern).
3. Blättern nur innerhalb der Karte; Knöpfe fehlen am Rand; gesperrt während
   des Ladens (auch während die Tagesbilder laden).
4. MFE eintippen → Knopf „Schließen & Speichern"; Blättern → Zeile in
   `excursions` mit `tradeId` des VORIGEN Trades und `dateUnix` der Karte;
   leeres Feld → `mfePrice: null`, nie `NaN`.
5. Auto-MFE: Wert erscheint mit Hinweis, Durchblättern schreibt NICHTS;
   „Übernehmen" + Schliessen schreibt.
6. Vorhandene Exkursion: Update statt Create.
7. Bildmarkierungs-Editor offen (z. B. per Konsole erzwungen) → Blättern und
   Schliessen melden `common.screenshotSaveAnnotation`, Esc öffnet den Dialog
   wieder.
8. Trade mit eigenem Bild → Vorschau zeigt es; Trade ohne eigenes Bild, Tag mit
   Bild → Tagesbild; Monat ohne Bild an diesem Tag → keine Vorschau.
9. Tags: Chips des Trades, unbekannte fehlen, Tages-Tags fehlen.
10. Swing-Trade: `daily.swingFrom` am Einstieg, Dauer „n day(s)"; Intraday:
    `HH:mm:ss`. Grenzfall 23:59 → 00:01 in der Handelszeitzone gilt als Swing.
11. Schliessen und erneut öffnen (anderer Tag) → Bilder des neuen Tages
    geladen, Kerzenchart frisch gezeichnet.
12. Seite mit offenem Fenster verlassen → ausstehende MFE gespeichert.
13. `npm run test:self` und beide Golden Master ohne Neu-Einfrieren grün;
    `node scripts/herkunft-pruefen.mjs` ohne neue Treffer.
