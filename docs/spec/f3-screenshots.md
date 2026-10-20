# F3 – Screenshot-Pfad (Verhaltensbeschreibung für den Neubau)

Stand 20.10.2026. Beschreibt das Verhalten des gemeinsamen Screenshot-Pfads
des Journals: Laden (Seite Screenshots, Tagesansicht), Bildkarte, Vollbild mit
Blättern, Anbindung der eigenen Bildmarkierung, Speichern, Löschen, Kopieren.
Keine Aussage über die heutige innere Gestalt; der Neubau wählt eigene Namen
und Aufteilung.

Nicht Teil dieses Pfads (eigener Code, bleibt): Bild-Upload und -Einfügen in
Incoming (`src/views/Incoming.vue`), Playbook (`src/components/playbook/`),
Cockpit-Foto (`src/utils/cockpitFoto.js`), die eigene Überlagerung in
`src/views/Playbook.vue`. Sie teilen mit diesem Pfad nur die Tabelle und die
App-interne Bild-Ablage (7.2).

Kennzeichen: **[Eigenart, beibehalten]**, **[Altfehler, beheben]**, **[tot]**
(ohne Aufrufer; Grundsatz: nicht nachbauen) – wie in f3-tags.md.

---

## 1. Zweck

- Seite `/screenshots`: alle Bilder, neueste zuerst, in Häppchen nachgeladen,
  gefiltert nach Tags und Börse (Filterleiste) und nach Bildtyp (Reiter).
- Jede Bildkarte: Vergrössern (Vollbild), Markieren, Kopieren, Löschen.
- Vollbild: ein Bild gross, mit Blättern durch die geladene Liste.
- Tagesansicht: Bild-Symbol in der Trade-Zeile, Vorschau im Trade-Fenster,
  Vollbild als Einzelbild.

## 2. Daten

### 2.1 Tabelle `screenshots`

| Spalte | Inhalt |
|---|---|
| `id` (→ `objectId`) | Schlüssel |
| `name` | Verknüpfungsschlüssel zu Trade/Playbook/Incoming. Formen: `t<dateUnix>_<symbol>_<side>` (mit Seite), `<dateUnix>_<symbol>` (ohne), Playbook `<tradeId>_entry|_trend|_closing`, Incoming `incoming_entry|trend|closing_<positionId>`. **Wird nie umbenannt**, sobald gesetzt (A-S2). |
| `symbol`, `side` | `side`: `B`/`SS`/`BC` (Journal), `long`/`short` (Playbook), leer |
| `broker` | Börse; leer bei alten Bildern |
| `originalBase64` | Daten-URL des Originals |
| `annotatedBase64` | Daten-URL des **vollständigen** Anzeigebilds (Original + eingebrannte Markierung). Altzeilen mit `markersOnly` = 1 enthalten hier nur die transparente Ebene. |
| `markersOnly` | 0 = Anzeigebild vollständig (alles, was dieser Pfad schreibt); 1 = Altform „Original + Ebene" (Incoming schreibt noch 1 mit leerem `annotatedBase64`) |
| `maState` | JSON, Markierungszustand im eigenen Format v2 (relative Koordinaten 0–1) aus `src/utils/bildmarkierung.js`; Altzustände von markerjs2 werden beim Lesen migriert |
| `date` | Text `YYYY-MM-DDTHH:mm:ss` in der **Handelszeitzone** |
| `dateUnix` | Sekunden, Zeitpunkt des Bildes |
| `dateUnixDay` | Sekunden, Tagesbeginn von `dateUnix` in der Handelszeitzone |
| `original`, `annotated` | Altspalten aus der Parse-Zeit, nie geschrieben, nie gebraucht – bei JEDEM Abruf ausschliessen |
| `aiReview*` | KI-Bewertung, von diesem Pfad nicht berührt |

Server: Ohne `limit` liefert `dbFind('screenshots', …)` höchstens 500 Zeilen
(eigener Vorgabewert für diese Tabelle).

Handelszeitzone = die im Journal eingestellte Zeitzone der Trades (geteilter
App-Wert, gesetzt beim App-Start).

### 2.2 Sitzungs- und Browser-Speicher

| Schlüssel | Ort | Bedeutung |
|---|---|---|
| `screenshotsPagination` | sessionStorage | gemerkte Anzahl schon geladener Bilder; beim nächsten Aufbau der Seite Screenshots wird genau so viel in EINEM Abruf geholt, dann der Schlüssel gelöscht |
| `screenshotIdToEdit` | sessionStorage | `objectId` einer Karte, zu der nach dem Laden gescrollt wird; danach gelöscht |
| `kopiertesBild` | sessionStorage | `{"objectId": …, "name": …}` des zuletzt kopierten Bildes (App-interne Ablage, siehe 7.2) |

Geschrieben werden die ersten beiden heute nur vom alten „Bearbeiten"-Weg der
Seite Screenshots, den es nicht mehr gibt (A-S5) → **[tot]** als Schreiber.
Das LESEN beim Seitenaufbau bleibt (kostet nichts, alte Sitzungen).

### 2.3 Geteilter Zustand, den Aufrufer brauchen

- die **geladene Bildliste** (volle Zeilen ohne Altspalten),
- die **Monatsübersicht** der Tagesansicht: je Bild nur `{objectId, dateUnix,
  dateUnixDay, name}`,
- das **Bild in Bearbeitung** (ein Objekt mit den Spaltenfeldern; die
  Tagesansicht füllt es beim Öffnen eines Trades),
- die **Vollbild-Auswahl** (Kopie eines Bildes) und ihr **Index** in der
  geladenen Liste (−1 / keine Zahl = Einzelbild ohne Blättern),
- **Vollbild offen** (ja/nein), **Markierung offen** (ja/nein),
- **Blätterstand** der Seite: Versatz (`skip`) und Häppchengrösse (`limit`),
  „Liste zu Ende" (geteilt mit dem Journal-Kern),
- der zum Löschen **vorgemerkte Eintrag** (`objectId`; geteilt mit dem
  Journal-Kern, der darüber auch Handelstage löscht),
- die App-interne **Bild-Ablage** (7.2).

## 3. Laden

Drei Betriebsarten. Jede **löst immer auf**, auch bei Netzfehler (Fehler nur
in der Konsole) (A-S3).

### 3.1 Seite Screenshots: ein Häppchen

- `dbFind('screenshots', { descending: 'dateUnix', exclude: ['original',
  'annotated'], limit: <Häppchen>, skip: <Versatz> })`.
- Häppchen = 4 Bilder (Bilder sind gross). Beim Seitenaufbau gilt einmalig der
  Wert aus `screenshotsPagination` (2.2), wenn er eine positive Zahl ist;
  danach bleibt dieser Wert als Häppchengrösse, bis die Liste neu aufgebaut
  wird **[Eigenart, beibehalten]**.
- Leere Antwort → „Liste zu Ende" = ja.
- Sonst:
  1. **Börsenfilter** (nur wenn in der Filterleiste eine Börse gewählt ist): Ein
     Bild bleibt, wenn es keine `broker` hat (alte Bilder dürfen nicht
     verschwinden) ODER `broker` = gewählte Börse ODER sein `name` eine
     Trade-ID dieser Börse ist ODER sein `dateUnixDay` ein Handelstag dieser
     Börse ist. Trade-IDs und Handelstage der Börse werden EINMAL je
     Seitenaufbau und Börse geholt: `dbFind('trades', { descending: 'dateUnix',
     limit: 10000, exclude: ['executions', 'blotter', 'pAndL'] })`, je Zeile
     die Einträge von `trades[]` mit `broker` = Börse (ID als Text in die
     ID-Menge, `dateUnix` der Zeile in die Tagesmenge). Neu geholt wird, wenn
     der Versatz 0 ist (erstes Häppchen), die Börse wechselt oder die Liste neu
     aufgebaut wird (A-S10).
  2. **Tag-Filter**: Ein Bild bleibt, wenn die Tag-Zuordnung mit `tradeId` =
     Bildname einen in der Filterleiste gewählten Tag trägt – ODER wenn „ohne
     Tag" (`t000t`) gewählt ist. **[Eigenart, beibehalten]**: mit „ohne Tag"
     gewählt bleibt JEDES Bild, auch getaggte mit nicht gewählten Tags.
  3. Übrige Bilder an die geladene Liste ANHÄNGEN.
- Immer danach (auch bei Fehler und leerer Antwort): Versatz += Häppchen.
  Ladeanzeige der Seite aus.
- Danach: steht `screenshotIdToEdit` in der Sitzung → nach dem nächsten
  Zeichnen zum Element mit dieser ID (die Karte trägt die `objectId` als
  DOM-`id`) mittig scrollen, Schlüssel löschen.

**[Eigenart, beibehalten]**: Der Versatz zählt ABGEFRAGTE Zeilen, nicht
angezeigte; gefilterte Bilder belegen also Plätze. Das ist richtig so, sonst
käme dieselbe Zeile zweimal.

### 3.2 Tagesansicht: Monatsübersicht

- Monatsübersicht leeren.
- `dbFind('screenshots', { descending: 'dateUnix', exclude: ['original',
  'annotated', 'originalBase64', 'annotatedBase64', 'maState'],
  greaterThanOrEqualTo: { dateUnix: <Monatsanfang> }, lessThanOrEqualTo:
  { dateUnix: <Monatsende> } })` – der in der Filterleiste gewählte Monat,
  beide Grenzen einschliesslich, ohne `limit` (Server: 500).
- Kein Börsen-, kein Tag-Filter (auf der Tagesansicht).
- Je Zeile `{objectId, dateUnix, dateUnixDay, name}` in die Monatsübersicht.
- Wird beim Aufbau der Tagesansicht angestossen (ohne Warten) und nach jedem
  Bildspeichern auf der Tagesansicht.
- Zweck: Bild-Symbol (`daily.bild`) in der Trade-Zeile, wenn ein Bild mit
  `name` = Trade-ID existiert; Ausweichsuche im Trade-Fenster
  (f3-trade-dialog.md).

### 3.3 Tagesansicht: alle Bilder eines Tages

- `dbFind('screenshots', { descending: 'dateUnix', exclude: ['original',
  'annotated'], equalTo: { dateUnixDay: <Tag> } })`.
- Auf der Tagesansicht: geladene Liste LEEREN, dann füllen (ersetzt). Kein
  Börsen-, kein Tag-Filter.

### 3.4 Gemeinsame Nachwirkungen **[Altfehler, beheben]**

Heute setzt JEDE Betriebsart am Ende die geteilte Ladeanzeige „Setups lädt"
auf aus – auch mitten im Öffnen des Trade-Fensters der Tagesansicht, das sie
gerade eingeschaltet hat (Kreisel verschwindet zu früh, Blätterknöpfe werden
zu früh frei). Richtig: das Laden fasst nur die eigene Ladeanzeige an; die
Ladeanzeige der Seite (Seite Screenshots) und das Ende des Trade-Öffnens
steuern ihre Anzeige selbst. Ebenso zählt der Versatz heute auch in 3.2/3.3
hoch (wirkungslos) – nur 3.1 braucht ihn.

### 3.5 Liste neu aufbauen (Filter angewendet)

Wenn die Filterleiste auf der Seite Screenshots „Anwenden" bekommt:
Ladeanzeige der Seite an, Häppchen = 4, Versatz = 0, „Liste zu Ende" = nein,
Börsenzuordnung verwerfen, geladene Liste leeren, ein Häppchen laden (3.1),
vorgemerkten Eintrag löschen. Danach prüft die Filterleiste, ob die Seite den
Bildschirm füllt, sonst wird nachgeladen.

## 4. Seite Screenshots (`src/views/Screenshots.vue`)

- **Einhängen**: „Liste zu Ende" = nein, Liste leer, Versatz 0, Häppchen 4;
  dann der Seitenaufbau des Journal-Kerns (`ablauf.js`): Ladeanzeige an,
  `screenshotsPagination` lesen (2.2), Bereich bestimmen, Tag-Zuordnungen und
  Katalog laden (f3-tags.md 3.1/3.2), ein Häppchen (3.1), Ladeanzeige aus.
  Dann Scroll-Lauscher an und einmal prüfen: ist das Dokument nicht höher als
  das Fenster → nachladen.
- **Endlos-Scroll**: beim Scrollen nachladen, sobald weniger als 200 px bis
  zum Seitenende fehlen – nicht, solange schon nachgeladen wird, die Seite
  lädt, oder „Liste zu Ende". Nachladen zeigt unten einen Kreisel.
- **Aushängen**: Scroll-Lauscher weg.
- **Typ-Reiter** (`common.all`, `screenshots.opening`, `screenshots.closing`),
  nicht gespeichert, wirkt nur auf die geladene Liste:
  - Abschluss: `side` = `BC` oder `name` enthält `_closing`.
  - Eröffnung: kein Abschluss UND (`side` ∈ `B`, `SS`, `long`, `short` ODER
    `name` endet auf `_entry`/`_trend`) (A-S6).
  - Einträge ohne `objectId` werden nie gezeigt.
- **Leerzustand** `common.noData` (Symbol Bild), wenn nach dem Typ-Filter nichts
  bleibt.
- **Raster**: 1 Spalte, ab 768 px 2, ab 1200 px 3. Jede Karte ist ein
  `article` mit DOM-`id` = `objectId`.
- **Playbook-Link** unter der Karte (`nav.playbook`) nur, wenn der Bildname
  nach Abschneiden von `_entry`/`_trend`/`_closing` die Form
  `t<Ziffern>_<Ziffern>_<Rest>` hat → `/playbook?tradeId=<url-kodiert>` (A-S7).
- Der Index, den jede Karte ans Vollbild gibt, ist der Index in der
  **ungefilterten** geladenen Liste – das Vollbild blättert über alle
  geladenen Bilder, auch über die vom Typ-Reiter ausgeblendeten
  **[Eigenart, beibehalten]**.

## 5. Bildkarte (`src/components/Screenshot.vue`)

Eingaben: Bilddaten, Herkunft (`screenshots` = Seite, `fullScreen` = im
Vollbild; historisch auch `addScreenshot`, `dailyModal`, `dailyTab`), Index in
der geladenen Liste. (Eine dritte Eingabe „Titel zeigen" ist Altbestand, wird
ignoriert.)

- **Kopf** (nur Herkunft `screenshots` und mit `dateUnix`): Erstellungsdatum
  im Datumsformat des Journals.
- **Infozeile** (ausser bei `addScreenshot`/`dailyModal`): Symbol fett;
  Seite als `nav.short` (rot) bei `side` ∈ `SS`, `BC`, `short`, sonst
  `nav.long` (grün), nur wenn `side` gesetzt; Zeit: mit `side` → Uhrzeit mit
  Sekunden, ohne → Stunde:Minute (Formate des Journals); Tags (f3-tags.md 4.2).
- **Werkzeuge** (ausser im Vollbild): Vergrössern (`common.enlarge`, nur mit
  `objectId` und nicht `addScreenshot`), Markieren (`screenshots.markieren`,
  immer), Kopieren (`screenshots.kopieren`, nur mit `objectId`), Löschen
  (`screenshots.loeschen`, nur mit `objectId` und nicht `addScreenshot`).
  „Bearbeiten" gibt es nicht (A-S5).
- **Bild**: Altform (`markersOnly` ∈ 1/`true`/`'1'` UND beide Daten-URLs
  vorhanden UND verschieden) → Original, darüber deckungsgleich die Ebene
  (`annotatedBase64`, `aria-hidden`). Sonst `annotatedBase64`, ersatzweise
  `originalBase64`. `img` mit `loading="lazy"`, `alt` = Symbol oder
  `nav.screenshots`, DOM-`id` `screenshotDiv-<Herkunft>-<objectId oder dateUnix>`.
  Auf der Seite ist der Bildbereich höchstens 250 px hoch (abgeschnitten) und
  per Klick vergrösserbar (Zoom-Zeiger), im Vollbild so gross wie das Fenster
  erlaubt (höchstens Fensterhöhe − 12rem), zentriert.
- **Löschen**: Klick auf den Papierkorb merkt die `objectId` vor und ersetzt die
  Werkzeuge durch die Rückfrage `screenshots.loeschenFrage` mit
  `screenshots.ja` / `screenshots.nein` (`role="alertdialog"`). „Ja": beide
  Knöpfe gesperrt, löschen (7.1), dann Rückfrage weg (auch bei Fehler).
  „Nein": Vormerkung weg, Rückfrage weg.

## 6. Speichern

### 6.1 Ein Bild speichern (lebendig nur nach dem Markieren, siehe 8)

1. Ist die Markierung offen → Browser-`alert` `common.screenshotSaveAnnotation`,
   Ergebnis „nicht gespeichert".
2. (Seite `addScreenshot`: gibt es nicht mehr, Route leitet auf `/screenshots`
   um → **[tot]**. Dort fehlten Symbol → `common.screenshotAddSymbol`, Bild →
   `common.screenshotAddImage`.)
3. Hat das Bild noch keinen `name` und einen `dateUnix`: Name bilden, mit
   `side` → `t<dateUnix>_<symbol>_<side>`, ohne → `<dateUnix>_<symbol>`.
   Ein vorhandener Name wird NIE geändert (A-S2).
4. Tags: heute werden hier Tags und Katalog mitgespeichert, wenn die
   Tag-Arbeitsliste nicht leer ist → **[Altfehler, beheben]**, siehe
   f3-tags.md 5.3. Neu: keine Tags.
5. Schreiben:
   - Felder `name`, `symbol`, `side`, `originalBase64` (je fehlend → `''`),
     `annotatedBase64` (fehlend → Original → `''`), `markersOnly: 0`,
     `maState` (fehlend → `{}`).
   - Datumsfelder, wenn `dateUnix` eine endliche Zahl ist: `date` (Text in der
     Handelszeitzone), `dateUnix`, `dateUnixDay` (Tagesbeginn in der
     Handelszeitzone).
   - Hat das Bild eine `objectId` → `dbUpdate('screenshots', objectId, Felder)`;
     die Datumsfelder dabei NUR, wenn auf der Tagesansicht ein neues Bild
     eingelesen bzw. dort markiert wurde (beides heute unerreichbar) – sonst
     bleiben Datum und Tag der Zeile unangetastet.
   - Sonst `dbCreate('screenshots', Felder mit Datum)` und die neue `objectId`
     ins Bild übernehmen.
   - Fehler → Ergebnis „nicht gespeichert", Ladeanzeige aus.
6. Danach auf der Tagesansicht: Bilder des Tages (`dateUnixDay` aus
   `dateUnix`) neu laden (3.3), dann die Monatsübersicht (3.2), und ein
   Datei-Eingabefeld mit der CSS-Klasse `screenshotFile` leeren (gibt es heute
   nicht → wirkungslos). Auf der Seite Screenshots: nichts neu laden.
7. Ergebnis „gespeichert". Alle Wege lösen auf (ja/nein), nie hängend (A-S3).

### 6.2 Bild einlesen und verkleinern **[tot]**

Es gibt heute im gemeinsamen Pfad keinen Ort, an dem der Nutzer ein Bild
hochlädt oder einfügt (Upload/Einfügen leben in Incoming, Playbook,
Cockpit-Foto mit eigenem Code und OHNE Verkleinerung). Entscheidung D.16-7:
toter Upload-Weg im Trade-Fenster entfällt. Nur falls der Leitstand anders
entscheidet, das bisherige Verhalten:

- Erste Datei eines `<input type="file">` (`change`), ohne Datei nichts.
- Als Daten-URL lesen; Original und Anzeigebild = diese URL; Endung = Text
  zwischen erstem `/` und `;base64` der URL (z. B. `png`).
- Auf der Tagesansicht zusätzlich: Zeitpunkt/Symbol/Seite des offenen Trades
  ins Bild, „Speichern nötig", „Bild geändert", „Tagesbild geändert".
- **Verkleinern** nur, wenn Höchstbreite und/oder Höchsthöhe gesetzt sind
  (heute setzt sie niemand → nie): Faktor = min(1, Höchstbreite/Breite,
  Höchsthöhe/Höhe) über die gesetzten Masse; Faktor ≥ 1 → nichts. Sonst Canvas
  mit `round(Breite·Faktor)` × `round(Höhe·Faktor)`, Bild hineinzeichnen,
  `toDataURL('image/jpeg', q)` mit q = gesetzte Qualität, wenn 0 < q ≤ 1,
  sonst **0,85**; Original UND Anzeigebild = Ergebnis, Endung `jpeg`.
  Entscheidung A-S11: als harmloses No-op bzw. funktionierende Verkleinerung
  erlaubt – Empfehlung: weglassen, solange kein Aufrufer Masse setzt.

## 7. Löschen, Kopieren

### 7.1 Löschen

- Ohne vorgemerkten Eintrag: nichts.
- `dbDelete('screenshots', objectId)`; Fehler → Konsole, sonst nichts geändert.
- Seite Screenshots: Eintrag (Vergleich der `objectId` als Text) aus der
  geladenen Liste nehmen, **Versatz − 1** (nicht unter 0) – damit das nächste
  Häppchen kein Bild überspringt –, Vormerkung löschen. KEIN Neuladen (das
  setzte das Blättern zurück).
- Tagesansicht: Listeneintrag leeren (alle Felder weg, der Platz bleibt) und
  das Bild in Bearbeitung leeren, Vormerkung löschen. (Heute ohne Bedienweg,
  weil die Tagesansicht keine Bildkarte mit Werkzeugen zeigt.)

### 7.2 Kopieren (App-interne Ablage)

- Ohne Bilddaten nichts.
- Ablage = `{ objectId, name: name || 'screenshot' }` (keine Bilddaten!), auch
  in sessionStorage `kopiertesBild`. Knopf zeigt 1,5 s `screenshots.kopiert`
  mit Haken.
- Zusätzlich, nur in sicherem Kontext mit Clipboard-API: Bild als PNG in die
  System-Zwischenablage (Altform: Original und Ebene übereinander gezeichnet).
  Scheitern still.
- Leser der Ablage: Playbook („Kopiertes Bild einfügen" holt die Zeile frisch
  per `objectId` und legt eine KOPIE an), Incoming (gleich). Livetrading
  schreibt die Ablage ebenfalls. Form und Schlüssel bleiben.

## 8. Markieren (Anbindung an `src/utils/bildmarkierung.js` und `BildMarkierung.vue`)

Beide Dateien sind eigen und bleiben; der Editor ist EINMAL global im Layout
eingehängt (neben dem Vollbild), damit jede Ansicht markieren kann.

- **Öffnen** (Karte, Werkzeug „Markieren"): Bei Herkunft `screenshots` (und
  den toten `dailyTab`) wird das Bild in Bearbeitung durch eine tiefe Kopie der
  Kartendaten ersetzt. Grundlage ist immer das **unmarkierte Original**
  (`originalBase64`, ersatzweise `annotatedBase64`) – die Markierung wird nie
  auf ein schon markiertes Bild gebrannt. Ohne Bild: sofort „nicht
  gespeichert". Sonst entsteht ein Auftrag für den Editor: Bild-URL,
  Startzustand = gelesener `maState` (Bildmarkierung liest und migriert
  Altformate), `objectId`, Herkunft; „Markierung offen" = ja. Das Öffnen
  liefert ein Ergebnis (ja = gespeichert, nein = verworfen), das auflöst,
  wenn der Editor endet.
- **Übernehmen** (Editor „Speichern"): Zustand in Speicherform bringen,
  auf das Original brennen (Bildmarkierung: Format des Originals, JPEG/WebP
  mit Qualität 0,92, sonst PNG). Scheitert das Brennen → Fehler an den Editor,
  der bleibt offen und zeigt `screenshots.markierung.fehlerSpeichern`.
  Sonst: Markierung zu (VOR dem Speichern, sonst blockiert 6.1 Schritt 1),
  Bild in Bearbeitung bekommt `annotatedBase64` = gebranntes Bild, `maState`,
  `markersOnly: 0`.
  - Herkunft `dailyModal`: nur „Bild geändert", „Tagesbild geändert",
    „Speichern nötig" setzen; gespeichert wird beim Blättern/Schliessen des
    Trade-Fensters. **[tot]** – das Vollbild zeigt keine Werkzeuge, die
    Tagesansicht keine Bildkarte.
  - sonst: dieselben drei Felder (Kopie) am Listeneintrag mit derselben
    `objectId` und an der Vollbild-Auswahl, wenn es dasselbe Bild ist (A-S8:
    Zuordnung über `objectId`, nie über `dateUnix`), dann speichern (6.1).
  - Ergebnis des Öffnens = Ergebnis des Speicherns.
- **Verwerfen** (Editor ×, Esc ohne offene Texteingabe; mit Rückfrage
  `screenshots.markierung.verwerfenFrage`, wenn geändert): Markierung zu,
  Auftrag weg, Ergebnis „nicht gespeichert", nichts geschrieben.
- Der Editor braucht vom Pfad also: einen beobachtbaren laufenden Auftrag
  (Bild-URL, Startzustand) und zwei Ausgänge (übernehmen mit Zustand, der
  werfen darf; verwerfen).

## 9. Vollbild (`src/components/rahmen/ScreenshotVollbild.vue`)

- Einmal global im Layout (`src/layouts/Dashboard.vue`), nativer Dialog
  (`components/basis/Dialog.vue`), Breite 100rem. Liegt als oberste Ebene über
  dem Trade-Fenster der Tagesansicht, das darunter offen bleibt; Schliessen
  bringt es zurück nach vorn.
- **Auswählen und öffnen** (ein Schritt, jeder Aufrufer will beides):
  Index merken (und Herkunft); ist der Index eine ganze Zahl ≥ 0, gilt der
  Listeneintrag, sonst die mitgegebenen Daten (Einzelbild). Erst eine Kopie
  davon machen, dann die Auswahl LEEREN und mit der Kopie füllen (sonst
  bleiben Felder des vorigen Bildes stehen; wer die Auswahl selbst übergibt,
  verlöre sonst alles) (A-S4). Vollbild offen = ja.
- **Vorladen**: Ist der Index ≥ 1 und Index + 2 = Länge der Liste, die Liste
  nicht zu Ende und die Seite Screenshots aktiv → nächstes Häppchen laden
  (ohne Warten).
- **Titel**: Erstellungsdatum der Auswahl, ohne `dateUnix` `nav.screenshots`.
- **Inhalt**: Bildkarte mit Herkunft `fullScreen` (Infozeile ja, Werkzeuge
  nein), nur wenn eine Auswahl da ist.
- **Blättern**: „zurück" (`nav.vorheriges`) wenn Index − 1 ≥ 0; „weiter"
  (`nav.naechstes`) wenn ein Listeneintrag bei Index + 1 existiert. Blättern
  = Auswählen mit Index ± 1 ohne Daten. Fussleiste nur, wenn einer der beiden
  möglich ist. Einzelbild (−1): kein Blättern.
- **Tastatur**: solange das Vollbild den Fokus hat, ← und → blättern (mit
  denselben Bedingungen). Esc schliesst (nativ).
- **Schliessen**: ×, Esc, Klick neben den Dialog → Vollbild offen = nein. Die
  Auswahl bleibt stehen.
- Heute gibt es eine geteilte Angabe „holt gerade weitere" (sperrt „weiter",
  Kreisel im Knopf), die niemand setzt → **[tot]**; der Neubau darf sie mit
  dem echten Nachladezustand verbinden oder weglassen.

## 10. Randfälle

- Zwei Bilder mit gleichem `dateUnix`: Zuordnung immer über `objectId`.
- `maState` `{}`, `null`, Text: gilt als leer (A-S9).
- Altbild `markersOnly` = 1: Karte zeigt Original + Ebene; Markieren brennt auf
  das Original, danach `markersOnly` = 0 und vollständiges Anzeigebild.
- Incoming-Bilder: `annotatedBase64` leer, `markersOnly` 1 → Karte zeigt das
  Original (Ebene fehlt, also keine Altform).
- Eintrag ohne `objectId` (auf der Tagesansicht geleert): nicht anzeigen, kein
  Vergrössern/Kopieren/Löschen.
- Börse gewählt, Bild ohne `broker`: bleibt sichtbar.
- Leere Antwort beim ersten Häppchen: Leerzustand, „Liste zu Ende".
- Netzfehler: nichts hängt; Versatz zählt trotzdem weiter
  **[Eigenart, beibehalten]**.

## 11. Bedarf der Aufrufer (ohne Namen)

| Wer | braucht |
|---|---|
| Journal-Kern `src/utils/journal/ablauf.js` | Häppchen laden (3.1), Monatsübersicht anstossen (3.2), gemerkte Seitengrösse lesen (2.2); für das Nachladen beim Scrollen dasselbe Häppchen |
| `src/utils/journal/app.js` | (toter Bearbeiten-Weg) schreibt `screenshotsPagination`/`screenshotIdToEdit` mit dem Versatz – wenn der Neubau den Versatz anders ablegt, hier mitziehen oder den toten Weg entfernen |
| Filterleiste `src/components/journal/FilterLeiste.vue` | Liste neu aufbauen (3.5) |
| Seite `src/views/Screenshots.vue` | geladene Liste, Blätterstand zurücksetzen, „Liste zu Ende", Nachladezustand |
| Bildkarte `src/components/Screenshot.vue` | Vollbild auswählen+öffnen, Markieren öffnen, Löschen (mit Vormerkung), Ablage, Tag-Zuordnungen + Tag-Info |
| Vollbild `src/components/rahmen/ScreenshotVollbild.vue` | Auswahl, Index, offen, Blättern, Schliessen, geladene Liste |
| Editor `src/components/bildmarkierung/BildMarkierung.vue` | laufender Auftrag, Übernehmen, Verwerfen (8) |
| Layout `src/layouts/Dashboard.vue` | hängt das Vollbild (und damit den Editor) einmal ein |
| Tagesansicht `src/views/Daily.vue` | Bilder eines Tages laden, Monatsübersicht, geladene Liste, Bild in Bearbeitung, „Markierung offen", Bild speichern, Vollbild als Einzelbild öffnen; beim Schliessen des Trade-Fensters wissen, ob das Bild geändert wurde |
| Tag-Teil (f3-tags.md) | heute: Bildname als Schlüssel beim toten `addScreenshot`-Weg – entfällt |
| Bündel `src/stores/journal/screenshots.js`, `src/stores/trades/screenshots.js`, `src/stores/ui/screenshots-ui.js`, `src/stores/ui/app.js`, `src/stores/trades.js`, `src/stores/ui.js` | reichen den geteilten Zustand weiter – neue Namen dort mitziehen; Werte ohne Leser (Bearbeiten-Flag, Verkleinerungsmasse, das nie gesetzte „aufgeklappte Bild" der Seite (Scroll-Sperre ohne Schreiber), die übrigen nie gelesenen Aufklapp-Werte, Herkunft der Vollbild-Auswahl) dürfen entfallen. Achtung: der Wert „aufgeklappte Position" in `stores/ui/screenshots-ui.js` wird von Incoming (`src/views/Incoming.vue`, `src/utils/incoming.js`) benutzt und gehört NICHT zum Bildpfad – er muss bleiben (darf umziehen). |

## 12. Prüfliste zum Abnehmen

1. Seite Screenshots: erster Abruf `limit=4&skip=0`, nächster `skip=4`; Netz:
   nie `original`/`annotated` in der Antwort.
2. Endlos-Scroll lädt bei < 200 px Rest; nicht während Laden, nicht nach Ende.
3. Börse gewählt: Bilder ohne `broker` bleiben; Bilder fremder Börsen fehlen;
   die Trades-Abfrage läuft einmal je Seitenaufbau.
4. Tag-Filter: „ohne Tag" gewählt → alle Bilder; sonst nur passende.
5. Typ-Reiter: Playbook-Bilder `long`/`short` unter „Eröffnung", `BC`/`_closing`
   unter „Abschluss".
6. Löschen auf der Seite: Rückfrage, Karte weg, nächstes Häppchen überspringt
   kein Bild.
7. Kopieren: sessionStorage `kopiertesBild` = `{objectId, name}`; Playbook und
   Incoming fügen ein.
8. Markieren → Speichern: `annotatedBase64` ist Original+Markierung (gleiches
   Format), `markersOnly` 0, `maState` v2, `name` und `date*` unverändert;
   Karte und offenes Vollbild zeigen sofort das neue Bild.
9. Markieren eines Altbilds (`markersOnly` 1): danach vollständiges Bild.
10. Brennen scheitert → Editor bleibt offen mit Meldung.
11. Vollbild: ←/→ blättern, Vorladen zwei vor Ende, Einzelbild aus der
    Tagesansicht ohne Blätterleiste; Schliessen bringt das Trade-Fenster zurück.
12. Tagesansicht: Bild-Symbol in Trade-Zeilen mit eigenem Bild; Monatsabfrage
    ohne Bilddaten.
13. `sessionStorage.screenshotsPagination = 12` vor dem Aufruf → erster Abruf
    `limit=12`, Schlüssel danach weg.
14. Bild speichern schreibt nie in `tags`/`settings`.
15. `npm run test:self` und beide Golden Master grün;
    `node scripts/herkunft-pruefen.mjs` ohne neue Treffer.
