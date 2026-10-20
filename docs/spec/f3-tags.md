# F3 – Tags und Zufriedenheit (Verhaltensbeschreibung für den Neubau)

Stand 20.10.2026. Beschreibt, was die Tag-Verwaltung und die Zufriedenheit des
Journals heute TUN – aus Sicht des Nutzers, der Datenbank und der Ansichten,
die darauf zugreifen. Über die heutige innere Gestalt (Funktionen, Variablen,
Aufteilung) sagt dieses Papier absichtlich nichts. Der Neubau wählt eigene
Namen und eine eigene Aufteilung.

Kennzeichen im Text:

- **[Eigenart, beibehalten]** – sieht schief aus, hängt aber an gespeicherten
  Daten oder am Golden Master; genau so nachbauen.
- **[Altfehler, beheben]** – heute falsch und von niemandem gewollt; nicht
  nachbauen, das Richtige steht dabei.
- **[tot]** – heute ohne jeden Aufrufer in der Oberfläche. Grundsatz des
  Projekts (docs/spec/ansichten.md, Abschnitt 0): tote Teile werden nicht
  nachgebaut. Beschrieben ist das Verhalten nur, damit nichts verloren geht,
  falls der Leitstand anders entscheidet.

---

## 1. Zweck

Ein Trade (oder ein ganzer Handelstag, oder ein Bild) kann mit Tags aus einem
Katalog versehen werden. Der Katalog besteht aus farbigen Gruppen. Tags dienen

- dem Tag-Filter der Filterleiste (welche Trades zählen mit),
- den Tag-Diagrammen und Tag-Gruppen-Auswertungen im Dashboard und in der
  Auswertung,
- der Anzeige als farbige Chips (Tagesansicht-Detailfenster, Bildkarten,
  Playbook, Incoming),
- der Share-Karte (Tags der ersten Gruppe gelten als „Strategie").

Die Zufriedenheit ist ein Ja/Nein-Urteil je Trade oder je Tag; sie speist das
Zufriedenheits-Diagramm, die Kontostand-Karte und die Tachos der Auswertung.

## 2. Daten

### 2.1 Katalog: `settings.tags` (JSON-Spalte der Einstellungszeile)

Form:

```json
[
  { "id": "group_0", "name": "Ungrouped", "color": "#6c757d",
    "tags": [ { "id": "tag_1", "name": "Breakout" }, { "id": "tag_7", "name": "FOMO" } ] },
  { "id": "group_3", "name": "…", "color": "#…", "tags": [ … ] }
]
```

- Gruppen-ID `group_<n>`, Tag-ID `tag_<n>` (n ganzzahlig, im ganzen Katalog
  eindeutig, nicht zwingend lückenlos oder sortiert).
- Die Reihenfolge der Gruppen zählt: die **erste Gruppe** ist die
  „Strategie"-Gruppe (in den Einstellungen nicht löschbar; ihre Tags landen als
  Strategie auf der Share-Karte; ihre Farbe ist die Ersatzfarbe für unbekannte
  Tags, siehe 4.1).
- Eine Gruppe mit dem Namen „Trade Abschluss" bietet die Filterleiste auf dem
  Dashboard nicht zur Auswahl an (bleibt aber im Katalog). Das ist Filterleisten-
  Code, nicht Teil dieses Neubaus.
- `group_0` mit Namen „Ungrouped" und Farbe `#6c757d` ist die Auffanggruppe
  für Tags, die beim Eintippen neu entstehen (nur im toten Pfad 5.2).
- Gelesen über `dbGetSettings()`, geschrieben über `dbUpdateSettings({ tags })`.
  Gepflegt wird der Katalog in Einstellungen › Journal › Bewertung (eigener
  Code in `src/views/einstellungen/journal/Bewertung.vue`, NICHT Teil dieses
  Neubaus; dort entstehen neue IDs als höchste vorhandene Nummer + 1).

### 2.2 Zuordnungen: Tabelle `tags`

Spalten: `id` (→ `objectId`), `dateUnix`, `tradeId`, `tags` (JSON-Liste von
Tag-IDs), `closingTags` (JSON-Liste), `createdAt`, `updatedAt`.

`tradeId` ist der Verknüpfungsschlüssel und kann dreierlei sein:

| Inhalt von `tradeId` | bedeutet | geschrieben von |
|---|---|---|
| Trade-ID (z. B. `t1767225600_0_…`) | Tags eines Trades | Incoming (`src/utils/incoming.js`), Playbook |
| Tageszahl als Text (`String(dateUnix)`) | Tags eines ganzen Tages | heute niemand mehr (Altdaten werden gelesen) |
| Bildname (`screenshots.name`) | Tags eines Bildes | heute niemand mehr (Altdaten werden gelesen) |

`closingTags` schreiben nur Playbook und Incoming. Das Journal (Filter,
Gruppen, Diagramme) liest **nur `tags`** **[Eigenart, beibehalten]** –
Incoming legt beim Übernehmen Eröffnungs- und Abschluss-Tags ohnehin
zusammengeführt in `tags` ab.

### 2.3 Zufriedenheit: Tabelle `satisfactions`

Spalten: `id`, `dateUnix`, `tradeId`, `satisfaction`, `createdAt`, `updatedAt`.

- `tradeId` gesetzt (nicht `null`/fehlend/`''`) → Zufriedenheit eines Trades,
  sonst Zufriedenheit des Tages `dateUnix`.
- `satisfaction`: `1` (oder `true`) = zufrieden, `0` (oder `false`) =
  unzufrieden. Das Playbook kennt zusätzlich einen dritten Wert (2), der
  bleibt erhalten (Entscheidung A-P9) und zählt in den Diagrammen weder als
  zufrieden noch als unzufrieden.
- Geschrieben heute nur von Incoming (`dbCreate` je Übernahme, nur wenn ein
  Wert ≥ 0 gesetzt ist) und vom Playbook (eigener Code, Update über die
  gemerkte `objectId`, sonst Create).

## 3. Laden (lebendig, vom Journal-Kern und Golden Master benutzt)

Diese Ladeschritte füllen die geteilten Sammlungen, aus denen Filter,
Gruppen und Diagramme rechnen. Ihr Ergebnis ist im Golden Master
(`src/utils/__selftest-journal.mjs`) eingefroren; der Selbsttest ruft sie
direkt aus dem Tagebuch-Modul (`src/utils/journal/tagebuch.js`) auf. Wer sie
umbenennt, passt den Selbsttest mit an – das Ergebnis darf sich nicht ändern.

### 3.1 Tag-Zuordnungen laden

- `dbFind('tags', { limit: <Abfragegrenze, 50000> , …Zeitfenster })`.
- Zeitfenster **nur auf der Tagesansicht** (Routenname `daily`):
  `greaterThanOrEqualTo: { dateUnix: start }, lessThan: { dateUnix: end }` mit
  dem gewählten Bereich. Auf allen anderen Seiten ohne Zeitfenster (alle Zeilen).
- Ohne Sortierung.
- Die geteilte Liste wird **vor** dem Abruf geleert und dann mit
  `{ tradeId, tags, dateUnix }` je Zeile gefüllt (keine `objectId`, kein
  `closingTags`).

### 3.2 Katalog laden

- `dbGetSettings()`, dann die geteilte Katalogliste leeren und, wenn
  `settings.tags` eine nicht leere Liste ist, mit deren Gruppen füllen
  (dieselben Objekte, keine Kopie). Geleert wird erst NACH der Antwort.
- Gleichzeitige Aufrufe teilen sich EINEN laufenden Abruf (der zweite Aufruf
  bekommt dasselbe Promise); nach dem Ende darf ein neuer Abruf starten.
  Grund: Layout, App-Start und Seiten-Mounts rufen ihn fast gleichzeitig.

### 3.3 Zufriedenheit laden

- Beide geteilten Listen (Tag, Trade) zuerst leeren.
- `dbFind('satisfactions', { descending: 'dateUnix', limit: <Abfragegrenze>,
  …Zeitfenster })`. Zeitfenster `[start, end)` wie oben, ausser der gewählte
  Bereich ist `{start: 0, end: 0}` („ganzer Zeitraum") – dann ohne Fenster.
  Gilt auf jeder Seite.
- Jede Zeile wird zu `{ tradeId, satisfaction, dateUnix }` und landet je nach
  `tradeId` (2.3) in der Trade- oder in der Tagesliste.

### 3.4 Flache Tag-Liste

Eine zweite geteilte Liste enthält alle Tags aller Gruppen in Katalog-
reihenfolge (`{id, name}`), neu aufgebaut auf Anfrage (die Tagesansicht tut es
nach dem Einhängen und nach dem Speichern von Tags). Gelesen wird sie nur vom
toten Eingabepfad 5.2 → **[tot]**, darf entfallen.

## 4. Anzeigen

### 4.1 Tag-Info zu einer Tag-ID (von ~9 Dateien benutzt)

Gegeben eine Tag-ID, durchsucht die Abfrage die Katalog-Gruppen **in
Reihenfolge** und liefert beim ersten Treffer:

- ID der Gruppe, Name der Gruppe, Farbe der Gruppe, Name des Tags.

Ohne Treffer (Tag gelöscht, Pseudo-Tag `no_tags`, leerer Katalog):

- Farbe = Farbe der **ersten** Gruppe, oder `#6c757d`, wenn der Katalog leer ist;
- Tag-Name = leerer Text;
- Gruppen-ID und Gruppen-Name **fehlen** (undefiniert, nicht leer).

**[Eigenart, beibehalten]**: unbekannte Tags bekommen die Farbe der ersten
Gruppe, nicht grau, und die fehlenden Gruppenfelder sind undefiniert. Der
Journal-Kern (Tag-Gruppierung) schreibt diese Felder in die Trade-Objekte, der
Golden Master hält das fest.

Die Abfrage ist rein lesend und synchron (kein Netz), sie arbeitet auf dem
zuletzt geladenen Katalog.

### 4.2 Wo Tags angezeigt werden

- **Tagesansicht-Detailfenster** (`src/views/Daily.vue`): Abschnitt
  „Tags" (`daily.tags`) zeigt die Tags des offenen Trades als Chips in
  Gruppenfarbe; keine Tags → „–". Nur Anzeige, keine Eingabe. Welche Tags:
  siehe f3-trade-dialog.md (Zuordnungszeile mit `tradeId` = Trade-ID, über den
  Katalog aufgelöst; unbekannte IDs fallen weg; Tages-Tags werden hier NICHT
  gezeigt).
- **Bildkarte** (`src/components/Screenshot.vue`): Zuordnungszeile mit
  `tradeId` = Bildname; die ersten zwei Tags als Chip (Name, Gruppenfarbe),
  dahinter „+n" für den Rest.
- **Playbook** (`PlaybookAnsicht.vue`, `PlaybookKarte.vue`, `PlaybookTags.vue`,
  `usePlaybook.js`): Chip-Farbe = mitgebrachte Farbe, sonst Gruppenfarbe aus
  4.1; beim Laden und nach dem Speichern werden IDs über 4.1 zu
  `{id, name, color}` aufgelöst (unbekannt → ID als Name, `#6c757d`).
- **Incoming** (`src/views/Incoming.vue`): Chip-Farbe über 4.1; Katalog wird
  beim Einhängen geladen; Hinzufügen/Entfernen hat Incoming als eigenen Code
  (Auswahlliste je Gruppe) – nicht Teil dieses Neubaus.
- **Share-Karte**: aus dem Detailfenster die Tags der Arbeitsliste, die zur
  ersten Katalog-Gruppe gehören (Namen); aus der Trade-Zeile die Zuordnung des
  Trades, gefiltert auf die erste Gruppe, Namen über 4.1, leere Namen
  entfernt.
- **Journal-Kern**: Tag-Gruppierung (`src/utils/journal/gruppieren.js`) holt je
  Tag eines Trades die Tag-Info (4.1); Filter (`laden.js`/`filtern.js`) liest
  Zuordnungen, Katalog, Tages- und Trade-Zufriedenheit direkt aus den
  geteilten Sammlungen (3.1–3.3).

## 5. Bearbeiten

### 5.1 Heute in der Oberfläche erreichbar

Im gemeinsamen Tag-/Zufriedenheitsteil: **nichts**. Tags und Zufriedenheit
werden heute ausschliesslich mit eigenem Code in Incoming, Playbook und den
Einstellungen geschrieben. Die Tagesansicht zeigt Tags nur an (Entscheidung
„Tag-Fenster in Daily (tot) – nicht nachbauen").

Was es trotzdem an gemeinsamem Schreibcode gibt, ist nur über zwei Wege
anstossbar:

1. Das Detailfenster der Tagesansicht speichert beim Blättern/Schliessen Tags,
   **wenn** eine Markierung „Tags geändert" gesetzt ist. Diese Markierung setzt
   heute keine Bedienung → nie wirksam.
2. Das Speichern eines Bildes (siehe f3-screenshots.md, 6.1) speichert
   vorher Tags, wenn die Tag-Arbeitsliste nicht leer ist. Das ist erreichbar
   und fehlerhaft, siehe 5.3.

### 5.2 Toter Eingabepfad **[tot]**

Nur zur Vollständigkeit. Es gibt eine Arbeitsliste „Tags des offenen
Elements" (`{id, name}`), ein Eingabefeld-Text, eine Vorschlagsliste, einen
Index des hervorgehobenen Vorschlags (−1 = keiner) und eine Angabe, auf
welcher Seite die Vorschlagsliste offen ist ('' = zu).

- **Tippen**: Ist das Feld leer → Hervorhebung −1. Vorschläge = alle Tags aller
  Gruppen, deren Name (ohne Gross/Klein) mit dem Eingabetext **beginnt**.
  Liste offen (für die aktuelle Seite), wenn Text nicht leer und mindestens ein
  Vorschlag.
- **Pfeil/Knopf „Liste auf/zu"**: Hervorhebung −1; war zu → auf, Vorschläge =
  alle Tags; war auf → zu.
- **Enter / Hinzufügen** mit hervorgehobenem Vorschlag: diesen anhängen
  (ohne Duplikat nach ID), Feld leeren. Ohne Hervorhebung, mit Text:
  - Name (ohne Gross/Klein) schon in der Arbeitsliste → nichts;
  - Name im Katalog → diesen Tag anhängen, Feld NICHT leeren;
  - sonst neuer Tag `{ id: 'tag_' + (max(höchste Nummer im Katalog, höchste in
    der Arbeitsliste) + 1), name: <Text wie getippt> }` – zusätzlich in eine
    Liste „neu entstandene Tags", Feld leeren. Höchste Nummer = grösste Zahl
    hinter `tag_`; leere Liste → 0.
  Danach Hervorhebung −1, Liste zu.
- **Klick auf Vorschlag**: anhängen (ohne Duplikat), Feld leeren, Hervorhebung
  −1, Liste zu.
- **Entfernen** (Klick auf Chip): Eintrag an dieser Position raus.
- Jede Änderung setzt „Tags geändert" und „Speichern nötig" (Knopf heisst
  dann „Schließen & Speichern"). Auf der Tagesansicht merkt sich jede Änderung
  zusätzlich den Speicherkontext: Tag = `dateUnix` der offenen Karte,
  Trade = ID des offenen Trades oder leer.
- **Speichern der Zuordnung**: Schlüssel = Bildname, wenn die Seite
  `addScreenshot` ist (gibt es nicht mehr), sonst Trade-ID des Kontexts, sonst
  `String(Tag des Kontexts)`. `dbFirst('tags', { equalTo: { tradeId: Schlüssel } })`;
  vorhanden → `dbUpdate('tags', objectId, { tags: [IDs der Arbeitsliste] })`,
  sonst `dbCreate('tags', { tags, dateUnix: <Tag>, tradeId: <Schlüssel> })`.
  `closingTags` bleibt unberührt.
- **Katalog ergänzen**: `dbGetSettings()`. Katalog leer → neuer Katalog mit nur
  `group_0`/„Ungrouped"/`#6c757d` und Kopien ALLER Tags der Arbeitsliste.
  Sonst die neu entstandenen Tags (ohne Duplikat nach ID) als Kopie an
  `group_0` anhängen; fehlt `group_0`, wirft der Schritt (Altfehler).
  Dann `dbUpdateSettings({ tags: Katalog })`.
- **Tageszufriedenheit setzen**: Eintrag der Tagesliste für den Tag ändern
  oder neu anhängen, dann `dbFind('satisfactions', { equalTo: { dateUnix },
  doesNotExist: 'tradeId' })` → erste Zeile updaten, sonst
  `dbCreate('satisfactions', { dateUnix, satisfaction })`.

Empfehlung: nicht nachbauen. Wird später wieder eine Tag-Eingabe gebraucht,
neu entwerfen; die einzige feste Regel ist das ID-Schema `tag_<n>` mit n =
höchste vorhandene Nummer + 1 und die Auffanggruppe `group_0`.

### 5.3 Fehlerhafter Nebenweg über das Bildspeichern **[Altfehler, beheben]**

Die Tag-Arbeitsliste wird beim Öffnen eines Trades in der Tagesansicht mit
dessen Tags gefüllt und beim Schliessen NICHT geleert. Speichert der Nutzer
danach irgendwo ein Bild (z. B. Markierung auf der Seite Screenshots), sieht
das Bildspeichern eine nicht leere Arbeitsliste und

- schreibt den Katalog zurück (bei leerem Katalog entsteht `group_0` mit den
  Tags des zuletzt geöffneten Trades),
- legt eine Zuordnungszeile mit `tradeId` = Text `"undefined"` (kein Kontext
  gesetzt) und den Tag-IDs des zuletzt geöffneten Trades an bzw. überschreibt
  sie.

Richtig: Bildspeichern schreibt **keine** Tags und keinen Katalog (es gibt
keine Oberfläche, die Bild-Tags bearbeitet). Bestehende Zeilen mit
`tradeId = 'undefined'` sind Datenmüll ohne Leser; Aufräumen ist nicht Teil
dieses Auftrags.

## 6. Randfälle

- Leerer Katalog: Tag-Info liefert `#6c757d` und leeren Namen; Filterleiste
  bietet nur „ohne Tag" (`t000t`); Anzeigen zeigen Chips ohne Namen bzw. fallen
  weg (Tagesansicht lässt unbekannte IDs weg, Playbook zeigt die ID).
- Tag im Katalog gelöscht, Zuordnung besteht noch: wie unbekannt (4.1).
- Dieselbe Tag-ID in zwei Gruppen: erste Gruppe gewinnt.
- Doppelte Tag-IDs in einer Zuordnung: die Tagesansicht zeigt jede ID nur
  einmal.
- `satisfaction` als `true`/`false` (Altdaten) zählt wie 1/0.
- Gleichzeitige Katalog-Ladevorgänge: ein Abruf (3.2).

## 7. Bedarf der Aufrufer (ohne Namen)

| Wer | braucht |
|---|---|
| Journal-Kern (`utils/journal/laden.js`, `gruppieren.js`, `ablauf.js`, `app.js`) | die Ladeschritte 3.1–3.3 (aufrufbar, Promise), die vier geteilten Sammlungen (Zuordnungen, Katalog, Tages-, Trade-Zufriedenheit) mit genau den Formen aus Abschnitt 3, die Tag-Info 4.1 |
| Golden Master `utils/__selftest-journal.mjs` | dieselben Ladeschritte über einen Modul-Import; Ergebnis unverändert |
| Diagramme (`utils/journal/diagramme/verteiler.js`, `gruppen.js`, `gruppenAlt.js`), `components/dashboard/KarteKontostand.vue`, `views/Auswertung.vue`, `views/Dashboard.vue` (teils über das Bündel `stores/trades.js`) | lesend: Zufriedenheitslisten, Zuordnungen, Katalog |
| Filterleiste `components/journal/FilterLeiste.vue` | lesend: Katalog |
| Layout `layouts/Dashboard.vue` | Katalog laden beim Start (für das Bewertungs-Popup) |
| Tagesansicht `views/Daily.vue` | Laden 3.1–3.3 über den Mount, Katalog, Zuordnungen, Tag-Info, eine Arbeitsliste „Tags des offenen Trades" (für Anzeige und Share-Karte); beim Schliessen des Fensters wissen, ob Tags geändert wurden (heute nie) |
| Bildkarte `components/Screenshot.vue` | Zuordnungen, Tag-Info |
| Playbook (`components/playbook/usePlaybook.js`, `PlaybookAnsicht.vue`, `PlaybookKarte.vue`, `PlaybookTags.vue`) | Katalog laden, Katalog lesen, Tag-Info |
| Incoming `views/Incoming.vue` | Katalog laden, Katalog lesen, Tag-Info |
| Bildspeichern `utils/screenshots.js` | heute: Tags+Katalog speichern (5.3) – nach dem Neubau: nichts mehr |

Die Bündel-Re-Exporte `src/stores/trades/daily-detail.js` und
`src/stores/trades.js` reichen die geteilten Werte weiter; neue Namen müssen
dort mitgezogen werden.

## 8. Prüfliste zum Abnehmen

1. `npm run test:self` grün, Golden Master `src/utils/__selftest-journal.mjs`
   ohne Neu-Einfrieren grün (Tag-Filter-Szenarien `tagFilter`,
   `ohneTagsNurUngetaggt`, Tagesansicht, Kalender).
2. Tagesansicht: Zuordnungen nur im gewählten Monat geladen; Dashboard,
   Kalender, Screenshots, Auswertung: alle Zeilen (Netz-Panel: kein
   Zeitfenster in der `tags`-Abfrage).
3. Zufriedenheit „ganzer Zeitraum" → Abfrage ohne Zeitfenster; sonst `[start,end)`.
4. Drei fast gleichzeitige Katalog-Ladeaufrufe → ein einziger Settings-Abruf.
5. Unbekannte Tag-ID: Farbe der ersten Gruppe, Name leer, Gruppenfelder
   undefiniert; leerer Katalog → `#6c757d`.
6. Detailfenster: Chips in Gruppenfarbe, unbekannte IDs fehlen, Tages-Tags
   fehlen, keine Tags → „–".
7. Bildkarte: höchstens zwei Chips plus „+n".
8. Share-Karte aus Zeile und aus Fenster: nur Tags der ersten Gruppe.
9. Trade in der Tagesansicht mit Tags öffnen, schliessen, auf Screenshots ein
   Bild markieren und speichern → KEIN Schreiben in `tags` und `settings`
   (5.3 behoben).
10. Kein Code mehr mit den Namen des Fremdprojekts im Tag-/Zufriedenheitsteil;
    `node scripts/herkunft-pruefen.mjs` ohne neue Treffer.
