# A4 Laufprüfung – AutarkTrade 4.0.0-alpha.0

Stand: 19.10.2026, Code-Stand `429c77f` (master). Nur geprüft, nichts am Produktcode geändert.

## Zusammenfassung

| Schwere | Anzahl |
|---|---|
| Hoch | 2 |
| Mittel | 7 |
| Niedrig | 13 |
| Hinweis | 3 |

**Top 10**

1. **A4-01 (Hoch)** Einstellungen › KI: Nach dem ersten Wechsel bleiben die Unterreiter auf dem alten Inhalt hängen. Die Konsole meldet `TypeError: t.ctx.deactivate is not a function`. Die Reiter Nachrichten, Agent, Strategie und Bilder sind damit ohne Neuladen nicht erreichbar. Das ist neu in V2; die alte Version hatte hier kein KeepAlive.
2. **A4-02 (Hoch)** Marktradar im Pult: Die Marktübersicht (Bühne in der Mitte) bleibt beim Kaltstart leer. Das Pult ist nach dem Update-Assistenten die Startansicht.
3. **A4-03 (Mittel)** Marktradar im Pult: Die Steuerleiste der Marktübersicht ist auf 4 px zusammengedrückt, und die Grafik ist unten abgeschnitten.
4. **A4-07 (Mittel)** Mehrere Texte sprechen noch von „Orders über deine Börsen-Schlüssel". Seit S13 gibt das Produkt keine Orders auf, und die Lizenz (Ziffer 7a) sagt das Gegenteil.
5. **A4-04 (Mittel)** Bei 375 px scrollt die ganze Seite waagrecht: Marktradar, Nachrichten und Bookmap.
6. **A4-08 (Mittel)** Chart-Watchlist (Startseite): Die Börsen-Kürzel BG/PX überdecken den Preis.
7. **A4-06 (Mittel)** Frische Installation ohne Börsenschlüssel: Bei jedem Seitenaufruf und alle 60 s kommen 400er von `/api/bitunix/open-positions` und `/balance`.
8. **A4-05 (Mittel)** Einstellungen › Datenquellen bei 375 px: Eine 543 px breite Pille erzeugt waagrechten Scroll.
9. **A4-21 (Mittel)** Barrierearmut: Mehrere Knöpfe nur mit Symbol haben keinen Namen (Schliessen-Knöpfe der Chart-Dialoge, Watchlist-Werkzeuge, Senden im Strategie-Builder). Die Chart-Dialoge haben kein `role="dialog"`.
10. **A4-09/A4-10 (Niedrig)** Live-Trading beim Erststart: Bei 1500 px bleibt das rechte Drittel leer. Der Status „Fehler" steht ohne Erklärung da.

Grundlagen:
- `npm run test:self` ist grün.
- `npm run build` läuft ohne Fehler durch, mit einer Warnung zur Chunk-Grösse.
- Beim Serverstart gibt es keine Fehler, die Migrationen laufen sauber.

Die Konsole ist auf fast allen Seiten sauber. Die Ausnahmen sind A4-01, A4-06 und Zeitüberschreitungen von Binance. Rohe i18n-Schlüssel, tote interne Links und Reste alter Bootstrap-/Icon-Klassen habe ich auf keiner Seite gefunden.

## Aufbau und Einschränkung

- **Image:** `docker build` aus dem Worktree, Name `autarktrade:a4-pruef`. Der Container `autarktrade-a4-pruef` lief mit `AT_TESTBETRIEB=1 AT_NO_ENGINE=1 AT_NO_RECORDER=1`. Am Ende habe ich Container und Image entfernt. Ports 8080, 8091 und die Live-DB `tradejournal` habe ich nicht angefasst.
- **Gegen die DB-Kopie `autarktrade` war keine Prüfung möglich.**
  - In der Kopie ist das Passwort-Gate eingeschaltet (`settings.authEnabled = 1` mit Passwort-Hash). `AT_ALLOW_INSECURE=1` schaltet dieses Gate nicht ab; es erlaubt nur den offenen Betrieb ohne Gate (`server/auth.js:157`, `:473`). Der erste Start gegen die Kopie (Bindung 127.0.0.1:8098) zeigte deshalb die Anmeldemaske.
  - Ein Passwort einzugeben war verboten. Einen Schalter zur Umgehung, ein abgeleitetes Sitzungs-Cookie oder eine Kopie mit abgeschaltetem Gate habe ich nicht verwendet bzw. sie wurden abgelehnt.
  - Der Dump, den ich dafür lesend gezogen hatte, ist gelöscht.
- **Stattdessen geprüft:** eine **frische Installation** (leere SQLite im Container, nur Loopback-Bindung, also regulär ohne Gate). Dazu `AT_BEDINGUNGEN=aus`, damit ich die Lizenzbedingungen nicht im Namen des Nutzers akzeptieren muss. Den Rechtliches-Dialog selbst habe ich vorher geprüft und dann über die Einstellungen erneut.
- **Folge:** Alles, was Daten aus dem eigenen Bestand braucht, ist **nicht prüfbar**. Das betrifft:
  - Journal mit Trades: Dashboard-Diagramme, Daily, Kalender mit Tagen, Auswertung, Screenshots, Playbook-Einträge
  - Pendente Trades mit Positionen
  - Sessions-Archiv und Replay
  - Coin-Radar-Läufe und Hype-Funde
  - Strategie-Instanzen und Backtests
- **Nicht ausgelöst** habe ich KI-Läufe, Imports, Mails, Push und die Scans von Coin-/Hype-Radar.
- **Prüfweg:**
  - Bei 1500×900 und 375×812 (Mobil-Emulation) wurde jede Route angesteuert, Neuladen nach jedem Breitenwechsel.
  - Je Seite ein Prüfskript für: Konsolenfehler und -warnungen, fehlgeschlagene Requests (fetch/XHR ≥ 400 oder Status 0), sichtbare Texte und Attribute im Muster `a.b(.c)`, waagrechter Scroll, Elemente über den rechten Rand, Knöpfe und Felder ohne Namen, alte Klassen (`btn`, `col-*`, `uil-*`, `fa-*`, `d-flex` …).
  - Dazu Screenshots und gezielte Klicks.

## Grundlagen (Schritt 1)

**`npm run test:self`** – Auszug wörtlich:
```
142/142 Dateien grün, 5917/5917 Prüfungen bestanden
```
Exit 0.

**`npm run build`** – Exit 0. Einzige Warnung (wörtlich):
```
(!) Some chunks are larger than 500 kB after minification. Consider:
- Use build.rolldownOptions.output.codeSplitting to improve chunking: https://rolldown.rs/reference/OutputOptions.codeSplitting
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
```

**Server-Log beim Start:**

- Gegen die PostgreSQL-Kopie:
  - Keine Warnung, kein Fehler.
  - `-> Testbetrieb: 11 Takte NICHT gestartet (News, Hype, Wachhund, Frühphase, Börsenwacht, Coin-Radar, Ergebnis, Abverkauf, OI-Archiv, Chart-Alarm, Benachrichtigungen)`, `-> Strategie-Engine deaktiviert (Testbetrieb)`, `-> Testbetrieb: 1 Takte NICHT gestartet (Rangliste)`.
- Frische SQLite:
  - Alle Tabellen werden angelegt, `S15: Quellen ohne Verkaufsfreigabe an — Kalender-Länder USD,JPY`.
  - 14 Share-Card-Vorlagen und 164 Lernkarten werden eingespielt.
  - `Default tag group "Strategie" created with example tags` (siehe A4-19).
- Auffällig (Hinweis A4-24):
  - `-> API routes initialized` steht zweimal im Log.
  - Eine Schema-Version wird nicht ausgegeben.
  - Trotz Testbetrieb laufen beim Start Abrufe: `Marktradar: Dominanz-Rückblick eingelagert (2190 Tage)`, `Binance Hebelkarte BTCUSDT 15m …`, `Binance Symbolliste (futures): 568 Symbole gecacht`, `Binance Hebelklammern: 1065 Symbole gecacht`.
  - Während der Prüfung kamen externe Zeitüberschreitungen:
    - `[marktradar] vol24|binance: Abruf fehlgeschlagen, liefere Altstand — timeout of 15000ms exceeded`
    - `-> Marktdaten-Fehler (Hebelkarte): timeout of 10000ms exceeded`

## Befunde

| ID | Schwere | Seite | Breite | Befund | Beleg | Vorschlag |
|---|---|---|---|---|---|---|
| A4-01 | Hoch | `/settings/ki` | 1500, 375 | Unterreiter-Ebene „Übersicht · Zugang · Trade-Berichte · Nachrichten · Agent · Strategie · Bilder": Der erste Wechsel klappt. Ab dem zweiten bleibt der Inhalt des vorigen Reiters stehen, obwohl der neue Reiter als aktiv markiert ist. Gemessen: Zugang → Trade-Berichte zeigt weiter „KI-Einstellungen". Mit echtem Klick: Trade-Berichte → Nachrichten zeigt weiter „Share-Karten". Nur Neuladen hilft. Die alte Version hatte kein KeepAlive (`grep KeepAlive` im alten `src/` ohne Treffer), es ist also eine Regression. | Konsole wörtlich: `TypeError: t.ctx.deactivate is not a function at fe (…/assets/vue.runtime.esm-bundler-CdnIHwiT.js:3:31086) … at r.activate (…:3:5285)`, einmal je Wechsel. Verschachteltes KeepAlive: `src/views/Settings.vue:142-144` (äusseres, `:key="bereich"`) um `src/views/einstellungen/EinstellungenKi.vue:61-63` (inneres, `<component :is="kiKomponente">`). Bild: `bilder/A4-einstellungen-ki-reiter-haengt-1500.jpg` (Reiter „Nachrichten" aktiv, Inhalt „Share-Karten"). | Inneres KeepAlive entfernen oder auf `v-show` je Unterkomponente umstellen (wie früher), oder mit `:key` arbeiten. Danach jeden Reiter zweimal hin und her klicken. |
| A4-02 | Hoch | `/marktradar`, Ansicht Pult | 1500 | Die Bühne „Marktübersicht" ist nach dem Laden leer (schwarze Fläche, keine Blasen/Kacheln). Sie wird erst gezeichnet, wenn man auf einen anderen Bühnenreiter und zurück wechselt. Das Pult ist die Startansicht: Im Update-Assistenten ist „Marktradar in der Pult-Ansicht starten" vorangehakt. Im Raster tritt das nicht auf. | Gemessen nach Kaltstart: `.mChart` hat 0 Kinder (kein ECharts-Element) bei 709×504 px. Nach Reiterwechsel: 1 canvas. Ursache im Code: `src/components/radar/KachelMarkt.vue:305` `v-if="daten"` um das Chart-Element. `onMounted` (Z. 274-277) bricht bei fehlendem `chartEl` ab, und `zeichne()` (Z. 260-262) prüft nur `if (!chart …) return`; später wird nie initialisiert. Gleicher Code in der alten Version (`Journal/src/components/radar/KachelMarkt.vue:274/300/304`), also schon vorher so. Bild: `bilder/A4-marktradar-pult-marktuebersicht-leer-1500.jpg`. | ECharts beim ersten Eintreffen von `daten` initialisieren (im Watcher `init` nachholen) oder `v-if` nur um die Leiste legen. |
| A4-03 | Mittel | `/marktradar`, Pult, Bühne Marktübersicht | 1500 | Die Steuerleiste (1h/24h/7d, Blasen/Kacheln, Bewegung/Marktkap./Gleich, Top 10/50/100) ist im Pult unsichtbar. Die Treemap ist unten abgeschnitten (untere Reihe „ETH", „BTC" halb). | Gemessen: `DIV.mLeiste h=4 sh=14` (overflow auto), `DIV.mChart h=504 minh=504px`, Bühne `.pBuehneKoerper` nur 453 px hoch, `overflow: hidden`. CSS: `KachelMarkt.vue:353-361` (`.mLeiste` ohne `flex-shrink:0`), `:393-395` (`.mWrap.gross .mChart { min-height: 56vh }`). Bild: `bilder/A4-marktradar-pult-leiste-weg-1500.jpg`. | `.mLeiste { flex-shrink: 0 }`; im Pult die Mindesthöhe 56vh nicht anwenden (die Bühne gibt die Höhe vor). |
| A4-04 | Mittel | `/marktradar`, `/nachrichten`, `/liquidity` | 375 | Die ganze Seite scrollt waagrecht. Knopfreihe und Kopf ragen rechts hinaus („Alle aktualisie…", bei Bookmap „Klassisch" und folgende abgeschnitten). | Gemessen `scrollWidth>clientWidth`: Marktradar `493>375` (`div.liveTitle r=493`, `div.ltSymbolMitte r=493`, `div.liveActions r=493`), Nachrichten `455>375`, Bookmap `522>375`. CSS `src/assets/design/kacheln.css:26` (`.liveTitle` flex ohne `min-width:0`), `:36`, `:57-60` (Mobil: `.liveActions { flex-wrap: nowrap; overflow-x: auto }`; der Elternteil begrenzt die Breite nicht, deshalb greift das eigene Scrollen nicht). Bilder: `bilder/A4-marktradar-375.jpg`, `bilder/A4-bookmap-375.jpg`. | `.liveTitle`/`.liveActions` `min-width: 0; max-width: 100%` geben, damit das vorgesehene waagrechte Scrollen der Knopfreihe greift. |
| A4-05 | Mittel | `/settings/datenquellen` | 375 | Seite scrollt waagrecht. Die Pille der CoinGecko-Karte ist abgeschnitten. | `span.at-pille r=585`, Seite `585>375`. Text: „Kein Schlüssel — öffentlicher Endpunkt (Quellen ohne Verkaufsfreigabe)", Breite 543 px, `white-space: nowrap`. `src/views/einstellungen/EinstellungenDatenquellen.vue:167-172`. Bild: `bilder/A4-datenquellen-375.jpg`. | Pille umbrechen lassen oder Text kürzen (Erklärung in den Satz darunter). |
| A4-06 | Mittel | alle Seiten mit Positions-Polling: `/dashboard`, `/incoming`, `/ki-coach`, `/openinterest`, `/live-sessions`, `/agent/editor`, `/settings/datenquellen` u. a. | 1500, 375 | Ohne eingetragenen Börsenschlüssel (frische Installation) fragt die App trotzdem Bitunix ab: beim Seitenaufruf und alle 60 s. In der Konsole stehen dauerhaft Fehler. | Netzwerk: `GET /api/bitunix/balance → 400`, `GET /api/bitunix/open-positions → 400`, Antwort wörtlich `{"error":"API-Schlüssel nicht konfiguriert."}`. Konsole wörtlich: `[error] Failed to load resource: the server responded with a status of 400 (Bad Request)`, `[warn]  -> Abrufen von bitunix fehlgeschlagen: Request failed with status code 400`, `[log]  -> Globales Polling fehlgeschlagen: Request failed with status code 400`. Ursache: `src/utils/incoming.js:83` (`return result.length ? result : [selectedBroker.value \|\| 'bitunix']` – Rückfall auf Bitunix, obwohl keine Börse konfiguriert ist), Kontostand `src/stores/accountBalance.js:115`, `:159`. Mit eingerichtetem Schlüssel (Bestandsnutzer) nicht prüfbar. | Ohne konfigurierte Börse nicht pollen (leere Liste zurückgeben), Kontostand nur für konfigurierte Börsen abrufen. |
| A4-07 | Mittel | Rechtliches-Dialog, `/settings/lizenz`, `/settings/datenquellen` | 1500, 375 | Texte widersprechen dem Stand nach S13 („AutarkTrade gibt keine Orders auf"; Lizenz Ziffer 7a: „Die Software gibt keine Orders bei deiner Börse auf…"). | Wörtlich: Beta-Hinweis „Keine Anlageberatung; Orders über deine Börsen-Schlüssel führst du auf eigenes Risiko aus." (`src/i18n/locales/de.json:6018`). Zustimmung „…und ich für jede Order selbst verantwortlich bin." (`:6024`). Datenquellen „Aus": „Journal, Kontoimporte und Orders über deine eigenen API-Schlüssel laufen weiter." (`:6112`) und „Kontodaten (Trades, Positionen, Orders) laufen unabhängig davon…" (`:6113`). Bild: `bilder/A4-rechtliches-beta-orders-1500.jpg`. | Texte an S13 anpassen („…liest über deine Schlüssel Trades und Positionen; Orders gibst du selbst bei der Börse auf"). Die Zustimmungsformel juristisch mitprüfen lassen. |
| A4-08 | Mittel | `/chart`, rechte Leiste › Watchlist | 1500 | Die Börsen-Kürzel BX/BG/PX hinter dem Symbol laufen in die Preisspalte: „BG"/„PX" liegen über dem Preis. Betrifft jede Zeile auf der Startseite der App. | Gemessen (BTCUSDT): BG 1322–1341 px, PX 1345–1364 px, Preis 1330–1381 px. `src/components/chart/WatchlistReiter.vue:282-285` (`grid-template-columns: 1fr auto 64px`), `.sym` `:302-308` (`white-space: nowrap`, kein `overflow: hidden`). Gleiches Grid in der alten Version (`Journal/…/WatchlistReiter.vue:239`). Bild: `bilder/A4-chart-1500.jpg` (rechts oben). | `.sym { overflow: hidden }` plus Kürzel verkleinern oder in eine zweite Zeile; oder Preis-Spalte `auto` statt `1fr`-Druck. |
| A4-09 | Niedrig | `/livetrading`, Raster | 1500 | Beim Erststart sind 12 von 16 Kacheln ausgeblendet. Die 4 sichtbaren (Bookmap, Liquidationskarte, Momentum Radar, Kompakt) sind je 2 Spalten breit in einem 3-Spalten-Raster. Das rechte Drittel bleibt auf der ganzen Seite leer. | `localStorage.livetrading_hidden_cards = ["lage","handelszeiten","kalender","mechanik","liqticker","lsoi","funding","indizes","makro","coinradar","handelslage","positionen"]`, `.radarGrid` `grid-template-columns: 393px 393px 393px`, Kacheln je 796 px. Registry `src/config/livetrading.js:104,124,306,327` (`spalten: 2`). Bild: `bilder/A4-livetrading-raster-1500.jpg`. | Vorgabe-Sichtbarkeit oder Spaltenzahl so wählen, dass die Breite gefüllt wird (z. B. Momentum + Kompakt nebeneinander mit `spalten: 1`). |
| A4-10 | Niedrig | `/livetrading` | 1500 | Der Kopf zeigt roten Punkt + „Fehler", ohne Hinweis, welche Kachel. Auslöser war hier die Hebelkarte. Nach einigen Sekunden wechselt er auf „Aktuell". | Konsole wörtlich: `[error] [DB] Server-Fehler (504): Die Marktdatenquelle antwortet nicht (Hebelkarte). Bitte später erneut versuchen.` `src/views/Livetrading.vue:366-367` (nur `t('marktradar.status_' + gesamtZustand)`, kein `title`). | Betroffene Kachel(n) im `title` oder als Klickziel nennen. |
| A4-11 | Niedrig | `/marktradar`, Kachel Wal-Bewegungen | 1500 | Text verweist auf „Einstellungen → Nachrichten". Einen solchen Bereich gibt es nicht. Der Link „Zu den Einstellungen" führt nach `/settings/ki` und dort auf den Unterreiter „Zugang", nicht „Nachrichten". | `de.json:3151` „…lassen sich unter Einstellungen → Nachrichten eintragen."; Link-Ziel per DOM: `link "Zu den Einstellungen" href="/settings/ki"`. Die Nachrichtenquellen selbst liegen auf `/nachrichten` (Zahnrad) bzw. KI › Nachrichten. | Text „Einstellungen › KI › Nachrichten" bzw. auf die Nachrichten-Seite verlinken; Unterreiter per Query vorwählen. |
| A4-12 | Niedrig | `/settings/datenquellen`, Karte CoinGecko | 1500, 375 | Der Untertitel „Nur mit deinem eigenen API-Schlüssel." widerspricht der Pille direkt darunter „Kein Schlüssel — öffentlicher Endpunkt (Quellen ohne Verkaufsfreigabe)" (Schalter an). | `de.json:6117` (`datenquellen.cg.unter`); `EinstellungenDatenquellen.vue:166-172`. | Untertitel abhängig vom Schalter. |
| A4-13 | Niedrig | `/calendar`, Titelzeile aller Journal-Seiten, KI-Coach, Einstellungen › Importe | 1500, 375 | Englische Monatsnamen in deutscher Oberfläche: „October 2026", Titelzeile „Oct 2026 · Brutto". | `find`: `generic "October 2026"`, `generic "Oct 2026 · Brutto"`. Kein `dayjs/locale` im ganzen `src/` (auch nicht in der alten Version). Formate: `src/utils/journal/kalender.js:43`, `src/utils/journal/format.js:57-58`, `src/components/rahmen/Titelzeile.vue:50`, `src/views/KiAgent.vue:258`, `src/views/einstellungen/allgemein/Importe.vue:64`. | `dayjs/locale/de` laden und nach Sprache setzen. |
| A4-14 | Niedrig | Seitenmenü Journal, `/daily` | 1500, 375 | Schreibweise „Tages Ansicht" (getrennt) in Menü und Seitentitel. Routentabelle und Rest sagen „Tagesansicht". | `de.json:80` `"dailyView": "Tages Ansicht"`; `src/router/routen.js` `title: 'Tagesansicht'`. Auch alt so. | „Tagesansicht". |
| A4-15 | Niedrig | `/setup` Schritt 1 | 1500 | Merkmal-Liste: Titel und Beschreibung sind identisch („Trading-Tagebuch / Trading-Tagebuch"). Als Import wird nur „Bitunix-Import" genannt, obwohl Bitget und Pionex auch gehen (Schritt 3 nennt alle drei). | `de.json:986` `featureDiary` = `:988` `featureJournal` = „Trading-Tagebuch"; `src/views/Setup.vue:182-183`; `:990` „Bitunix-Import". Bild: `bilder/A4-setup-schritt1-1500.jpg`. | Beschreibung z. B. „Notizen, Stimmung, Tags je Tag"; „Börsen-Import (Bitunix, Bitget, Pionex)". |
| A4-16 | Niedrig | `/update-assistent?kontext=setup` Schritt 2 „KI-Zugang" | 1500 | Bei frischer Installation (Anbieter Ollama, nicht erreichbar) steht „Zugang bereits eingerichtet." Gleichzeitig meldet der KI-Coach „KI-Anbieter ist nicht erreichbar." | `de.json:1027` `alreadySet`. Seitentext des KI-Coachs: „KI-Anbieter ist nicht erreichbar." | Bei Ollama Erreichbarkeit prüfen statt „eingerichtet" zu melden. |
| A4-17 | Niedrig | Rechtliches-Dialog, Reiter „Hinweise (NOTICE)" | 1500 | `NOTICE.md` wird als roher Markdown-Text gezeigt (`# NOTICE`, `> -`, Backticks), anders als Lizenz und Drittlizenzen (reiner Text). | Sichtprüfung im Dialog (aus Einstellungen › Rechtliches und Menüfuss). | Markdown rendern oder NOTICE als Text-Fassung ausliefern. |
| A4-18 | Niedrig | `/settings/datenquellen` | 1500, 375 | Interne Arbeitsvermerke sind für Nutzer sichtbar: „(docs/VERKAUFS-PRUEFUNG.md)", „(Prüfung Zeile 28, 39, 32, 42)" je Quelle, „RugCheck läuft ab Werk mit (nach S12 nur auf Wunsch)", „Diese Quellen laufen wie im alten Journal". Für den Eigengebrauch harmlos, für eine Verkaufsfassung nicht. | Seitentext von Abschnitt „Quellen ohne Verkaufsfreigabe" (z. B. „Yahoo Finance — Makro … (Prüfung Zeile 28, 39, 32, 42)"). `EinstellungenDatenquellen.vue:160-161` (`datenquellen.of.zeilen`). | Prüfzeilen nur im Entwicklermodus oder als Tooltip; Sitzungsnamen (S12) aus Nutzertexten nehmen. |
| A4-19 | Niedrig | Journal-Filter (Seitenmenü › Filter) | 1500 | Frische Installation legt die Tag-Gruppe „Strategie" mit den Tags „LSOB", „Guss", „Breakout" an. Das sind persönliche Strategienamen des Eigentümers als Vorgabe für jeden Käufer. | Server-Log `-> Default tag group "Strategie" created with example tags`; Filtertext „Alle Tags · Kein Tag · LSOB · Guss · Breakout"; `server/database.js:968-975`. | Neutrale Beispiel-Tags oder leer anlegen. |
| A4-20 | Niedrig | `/chart` | 1500 | Die Chart-Seite (Modus „Chart") zeigt das komplette Journal-Seitenmenü (Börse, Kontoübersicht, Analysieren …). Der Kommentar in `menu.js` sagt „kein Seitenmenü-Eintrag, der Chart braucht die Breite". Ausserdem bricht die Werkzeugleiste bei 1500 px in eine zweite, fast leere Zeile um (Raster, Sync, „Standard", Kamera, Leiste). | `src/config/menu.js:36-41`; Knopf-Positionen: Leistenknöpfe `y=76` und `y=105–108`. Bild: `bilder/A4-chart-1500.jpg`. | Entscheiden, ob der Chart ein eigenes (oder kein) Seitenmenü zeigt; Werkzeugleiste in eine Zeile bringen. |
| A4-21 | Mittel | Chart-Dialoge, Watchlist, `/agent/builder` | 1500, 375 | Barrierearmut: Knöpfe nur mit Symbol haben keinen zugänglichen Namen. Die Chart-Dialoge sind `div.dialog` ohne `role="dialog"`/`aria-modal` (Esc schliesst aber). | Ohne `aria-label`/`title`: Schliessen-Knopf `.zu` in `src/components/chart/IndikatorDialog.vue:117`, `:146`, `AlarmDialog.vue:72`, `TradeKarte.vue:55`; Watchlist-Zeilenwerkzeuge (hoch/runter/entfernen) `WatchlistReiter.vue:193-195`; Senden-Knopf `src/views/AgentBuilder.vue:294` (`<Knopf … nurSymbol …>` ohne `titel` → `aria-label` undefined, `src/components/basis/Knopf.vue:33`). Dialog-Attribute gemessen: nur `class=dialog`. | `aria-label` ergänzen; `Knopf` mit `nurSymbol` ohne `titel` im Entwicklungsmodus warnen lassen; Basis-`Dialog.vue` (nativ) verwenden. |
| A4-22 | Niedrig | Einstellungen, Agent, Lernen, Bookmap | 1500, 375 | Barrierearmut: Viele Formularfelder haben kein zugeordnetes Label. | Gezählt (sichtbar, ohne `aria-label`/`title`/`label for`/umschliessendes `label`): Einstellungen Allgemein 3, Live 14, Benachrichtigungen 4, KI 4; Agent Labor 14, Auswertung 8, Rangliste 5, Setups 2; Lernen › Karten 164 Checkboxen (`src/views/Lernen.vue:564`, `:595`); Bookmap-Regler `src/components/LiveSymbolPicker.vue:429`, `:443`. `src/views/einstellungen/gemeinsam/Feld.vue:19` setzt `for` nur, wenn `fuer` übergeben wird. | `Feld` erzeugt selbst eine id und verknüpft; Checkboxen mit `aria-label` des Kartenbegriffs. |
| A4-23 | Hinweis | `/chart` Watchlist | 1500 | Kontrast der Tokens ist ausreichend: `--muted` auf `--bg` 7,8:1, `--leise` auf `--bg` 4,9:1, `--text` 17,9:1. Sehr kleine Schrift: Börsen-Kürzel 8,5 px (`WatchlistReiter.vue:311`). Ihre Farben sind hart codiert (`#5fd38d`, `#36c2d6`, `#f0a04b`, `:331-333`), entgegen „tokens.css ist die einzige Stelle mit Farbwerten". | Werte per `getComputedStyle` gemessen. | Kürzel ≥ 10 px; Farben als Tokens. |
| A4-24 | Hinweis | Server/Build | – | Build-Warnung zur Chunk-Grösse; `-> API routes initialized` zweimal im Start-Log; keine Ausgabe der Schema-Version; im Testbetrieb beim Start trotzdem Abrufe (Dominanz-Import, Binance Hebelkarte/Symbolliste/Hebelklammern). | Siehe Abschnitt Grundlagen. | Schema-Version beim Start loggen; Startabrufe im Testbetrieb bewusst entscheiden. |
| A4-25 | Hinweis | `/marktradar` Raster | 1500 | Alle 16 Kacheln liefern Inhalte; Grossansicht jeder Kachel öffnet und schliesst sauber, kein waagrechter Überlauf (`radarOverlay 1485x900 hs=false` je Kachel). Kacheln mit fehlendem Schlüssel (ETF-Fluss, Gesamtlage KI) und abgeschalteter Aufzeichnung (Liquidationen 24 h) erklären sich und verlinken auf `/settings/live`. | Prüfskript-Ausgabe je Kachel. | – |

## Geprüfte Seiten

„ok" heisst: keine Konsolenfehler ausser den genannten Befunden, keine fehlgeschlagenen Requests ausser A4-06, keine Rohschlüssel, kein waagrechter Scroll, keine alten Klassen. Datenabhängige Darstellung: siehe Einschränkung.

| Seite / Ansicht | 1500 px | 375 px |
|---|---|---|
| `/setup` (3 Schritte) | Befund A4-15 | nicht geprüft (nur einmal durchlaufbar) |
| `/update-assistent` (4 Schritte) | Befund A4-16 | nicht geprüft |
| Rechtliches-Dialog (Erststart, Menüfuss, Einstellungen; 3 Reiter) | Befund A4-07, A4-17 | nicht geprüft |
| `/start` | ok | ok |
| `/chart` inkl. Leistenreiter Watchlist/Offene Trades/Zeichnungen/Strategien/Alarme/KI, eingeklappte Leiste, Indikator-Dialog (RSI hinzugefügt, Esc), Vorlagen-Menü | Befund A4-08, A4-20, A4-21 | ok |
| `/dashboard` (Export-Menü, Filter, Kontoübersicht) | Befund A4-06; Diagramme nicht prüfbar (keine Daten) | ok / nicht prüfbar |
| `/daily` | Befund A4-14; Inhalt nicht prüfbar | ok |
| `/calendar` | Befund A4-13 | ok |
| `/playbook` | ok (leer) | ok |
| `/auswertung` | ok (leer) | ok |
| `/ki-coach` (Berichte/Agent) | Befund A4-06; KI-Lauf nicht ausgelöst | ok |
| `/screenshots` | ok (leer) | ok |
| `/incoming` | Befund A4-06; Positionen nicht prüfbar | Befund A4-06 |
| `/addTrades` (Manuell, API-Import) | ok (nichts gespeichert) | ok |
| `/accounts` | ok | ok |
| `/addExcursions` | ok | ok |
| `/marktradar` Raster, 16 Kacheln, Grossansicht je Kachel | ok (A4-11 Text) | Befund A4-04 |
| `/marktradar` Pult inkl. Bühnenreiter Marktübersicht/RSI-Heatmap/BTC-Dominanz/Regenbogen | Befund A4-02, A4-03 | nicht geprüft (Pult am Telefon) |
| `/nachrichten` | ok (keine Quellen, kein Lagebericht ausgelöst) | Befund A4-04 |
| `/openinterest` | Befund A4-06 | ok |
| `/liquidity` (Bookmap) | ok | Befund A4-04, A4-22 |
| `/liquidations` | ok | ok |
| `/livetrading` Raster, Pult (Bookmap/Liquidationskarte/Indizes) | Befund A4-09, A4-10 | leitet am Telefon wie vorgesehen auf `/marktradar` um |
| `/live-sessions` | Befund A4-06; Archiv/Replay nicht prüfbar | ok |
| `/live-auswertung` | ok (leer) | ok |
| `/hype-radar` Übersicht | ok (kein Scan) | ok |
| `/hype-radar/fruehphase` | ok | ok |
| `/hype-radar/boersen` | ok | ok |
| `/hype-radar/berichte` | ok | ok |
| `/coin-radar` Analyse | ok (kein Lauf) | ok |
| `/coin-radar/verlauf` | ok | ok |
| `/coin-radar/abverkauf` | ok | ok |
| `/agent/strategies` | ok (Beta-Hinweis S13-konform) | ok |
| `/agent/setups` | ok | A4-22 |
| `/agent/editor` | Befund A4-06 | ok |
| `/agent/builder` | Befund A4-21 | Befund A4-21 |
| `/agent/performance` | ok | A4-22 |
| `/agent/lab` | ok | A4-22 |
| `/agent/rangliste` | ok | A4-22 |
| `/lernen` | ok | ok |
| `/lernen/karten` | A4-22 | A4-22 |
| `/lernen/statistik` | ok | ok |
| `/settings/allgemein` (alle Abschnitte aufgeklappt) | A4-22 | ok |
| `/settings/journal` (alle Abschnitte aufgeklappt) | ok | ok |
| `/settings/live` (alle Abschnitte aufgeklappt) | A4-22 | ok |
| `/settings/ki` mit 7 Unterreitern | **Befund A4-01** | Befund A4-01 |
| `/settings/benachrichtigungen` | A4-22 | ok |
| `/settings/datenquellen` | Befund A4-07, A4-12, A4-18 | Befund A4-05 |
| `/settings/lizenz` | Befund A4-07 (Beta-Hinweis) | ok |
| `/settings/rechtliches` | ok | ok |
| `/settings/gibtsnicht` → `/settings/allgemein` | ok | – |
| unbekannte Adresse `/gibtsnicht` → `/` → `/chart` | ok | – |
| Tote interne Links (alle `a[href^="/"]` auf 13 Seiten gegen den Router aufgelöst) | keine | – |

## Gegenprobe mit der alten Version (`/home/maro/Schreibtisch/Trading/Journal`, nur gelesen)

| Befund | alte Version |
|---|---|
| A4-01 KI-Unterreiter | **neu in V2**: kein `KeepAlive` im alten `src/`, kein `views/einstellungen/` |
| A4-02/03 Pult-Marktübersicht | alt identisch (`components/radar/KachelMarkt.vue`, `components/pult/PultRahmen.vue`), also schon vorher so |
| A4-08 Watchlist-Grid | alt identisch (`WatchlistReiter.vue:239`) |
| A4-13 englische Monatsnamen | alt identisch (kein dayjs-Locale) |
| A4-14 „Tages Ansicht" | alt identisch (`de.json:59`) |
| A4-09 Live-Trading-Vorgabe | Erst-Ausblendung bestand alt in `views/Livetrading.vue:177-182`, jetzt in `composables/useHiddenCards.js` |
