# Auftragsstand AutarkTrade (V2)

Umbau des Crypto Trading Journal zum Produkt **AutarkTrade**. Der vollständige Plan liegt
beim Leitstand (`~/.claude/plans/ok-plane-alles-erstelle-swirling-sparkle.md`); hier steht,
was davon wo erledigt ist. Jede Sitzung trägt ihren Stand selbst nach.

**Regeln für alle Sitzungen** (Kurzfassung, verbindlich ist der Plan):
- Arbeitsort `Trading/V2`, jede schreibende Sitzung in ihrem eigenen Worktree. Am Ende
  `npm run test:self` und Golden Master grün, Rebase auf master, `git merge --ff-only`.
- TradeNote-Dateien (`LIZENZ-PLAN.md`, Abschnitt 1) nach der Clean-Room-Regel ersetzen:
  Beschreibung nach `docs/spec/<bereich>.md`, Neubau durch einen frischen Agenten nur aus
  Beschreibung und Golden Master, danach Altdatei löschen.
- Neue Abhängigkeiten nur MIT/ISC/BSD/Apache-2.0, kein CDN, keine Anzeigepflicht
  (Ausnahme: TradingView-Logo von Lightweight Charts).
- `de.json`/`en.json` nur im eigenen Namensraum. `menu.js`, `router/index.js` und
  `src/assets/design/tokens.css` ändert nur die Sitzung, der sie gehören — Bedarf beim
  Leitstand melden.
- Testcontainer nur im Testbetrieb, nie gegen die Live-DB schreiben.

## Übersicht

| Welle | Sitzung | Inhalt | Branch | Stand |
|---|---|---|---|---|
| 0 | S1 Verkaufs-Prüfung | Fremdquellen, Bibliotheken, KI-Bedingungen je Funktion | – (nur lesen) | **fertig** → `docs/VERKAUFS-PRUEFUNG.md` (41 grün, 45 gelb, 18 rot) |
| 0 | S2 Fundament V2 | Repo, Umbenennung, Testbetrieb, DB-Kopie, Container, Gestaltungssystem, Rahmen | master | **fertig** (siehe unten) |
| 1 | S3 Aufräumen | CSV-Pfad und toten Import-Code löschen, `journal-alt.js`, zweiter Golden Master (MFE/OHLCV) | `claude/s3-aufraeumen-919210` | **fertig** |
| 1 | S4 Diagramme neu | `charts.js` clean-room in `src/utils/journal/diagramme/` | `claude/s4-diagramme-3c7cc1` | **fertig** |
| 1 | S5 Redesign Handel | Chart, Live-Trading, Sessions, Incoming, Agent-Seiten | `claude/s5-redesign-handel-51c2a6` | **fertig** |
| 1 | S6 Redesign Analyse | Marktradar, Nachrichten, Hype-/Coin-Radar, KI-Agent, Lernen | `claude/s6-redesign-analyse-3fe1f2` | **fertig** |
| 2 | S7 Journal-Kern neu | `trades.js` & Co. clean-room, Tag-Gruppen-Fehler, Datenmodell | `claude/s7-journal-kern-a3e03e` | **fertig** |
| 2 | S8 Ansichten neu | Daily, Dashboard, Kalender, Screenshots (markerjs2 ersetzen), AddTrades, Playbook | `claude/s8-ansichten-a5395a` | **fertig** |
| 2 | S9 Gerüst & Einstellungen | Router, Menü, Layout, `Settings.vue` zerlegen, Bootstrap/FA/Unicons entfernen | `claude/s9-geruest-23d7aa` | **fertig** |
| 2 | S10 Lizenz & Vertrieb | LICENSE, NOTICE, THIRD-PARTY-NOTICES, Zustimmungsdialog, `server/lizenz.js`, private Update-Quelle; NOTICE-Text von Lightweight Charts („TradingView Lightweight Charts™ Copyright (c) 2025 TradingView, Inc. https://www.tradingview.com/") auf eine Über-/Lizenzen-Seite (S1, VERKAUFS-PRUEFUNG.md Abschn. 3) | `claude/s10-lizenz-vertrieb-74c6fd` | **fertig** |
| 2 | S12 Quellen & Pflichthinweise | Massnahmen 1–6 und 9 aus der Verkaufs-Prüfung: Marktdaten-Abstraktion, rote Quellen raus, CoinGecko mit Kundenschlüssel, Attributionen, KI-Kennzeichnung | `claude/s12-quellen-9112f7` | **fertig** |
| 3 | S11 Herkunftsnachweis & Freigabe | `scripts/herkunft-pruefen.mjs`, `HERKUNFT.md`, Widget/ESP32 umbenennen, CI, altes Repo privat | – | wartet auf alle |

## S12 Quellen & Pflichthinweise — Ergebnis (19.10.2026)

Umgesetzt: Massnahmen 1–6 und 9 der Verkaufs-Prüfung und die Quellen-Teile von 10. Je Zeile der Prüfung steht der neue
Stand im Anhang von `docs/VERKAUFS-PRUEFUNG.md`.

- **Marktdatenquelle** (`server/marktdaten/`): Binance | Bitget | aus, Einstellung unter Einstellungen › Datenquellen
  (`src/views/einstellungen/EinstellungenDatenquellen.vue`) mit dem Hinweis, dass der Kunde die Nutzung selbst verantwortet.
  Funktionen fragen nach Fähigkeiten; was die Quelle nicht kann (Bookmap, Rekorder, Liquidationen, OI-Historie,
  Long/Short, Abverkauf-Wache, Hebelkarte bei Bitget), zeigt `QuelleAus` statt Fehler. Keine Binance-URL mehr
  ausserhalb von `server/marktdaten/binance.js` (Selbsttest). Bitget live geprüft (Kerzen rückwärts über
  `history-candles`, Aktien-Kontrakte `isRwa` ausgefiltert). `bapi`-Brackets und OKX-Fremdbuch entfernt.
- **Rote Quellen raus**: Yahoo (Makro ohne Indizes, Indizes-Kachel aus), ForexFactory (Kalender jetzt Fed + BEA +
  Eurostat, BLS/EZB nicht maschinenlesbar zugänglich), CoinMarketCap-Import, blockchain.info (Rainbow/Pi-Cycle aus
  Tageskerzen ab 2017, neu kalibriert), pump.fun, Telegram (News, Frühphase, Wal-Kachel), Reddit, CoinPaprika,
  Upbit, MEXC, OKX, Binance Alpha. Gelbe Börsen im Börsenwächter und RugCheck ab Werk aus.
- **Kundenschlüssel**: CoinGecko (inkl. GeckoTerminal über `/onchain`) nur mit eigenem Schlüssel (`server/quellen/coingecko.js`,
  Demo/Pro), Solana-RPC ohne öffentliche Vorgabe. Keine Token-Logos (Ticker-Initialen).
- **Attributionen** über `Quellenhinweis` an Kacheln (auch klein und im Pult), Hype-/Coin-Radar, Kalender.
- **KI**: Label „KI-generiert – keine Anlageberatung – Fakten prüfen“ (`KiHinweis.vue`) an jeder KI-Ausgabe,
  `data-ki-generiert`, `kiGeneriert` in der API, Mail-Kopf `X-AI-Generated`, PNG-/PDF-Metadaten; `kiEmpfehlungenAn`
  entfernt; Gemini-, Ollama-, FLUX-Hinweise; DeepSeek nur als „OpenAI-kompatibler Endpunkt 2“, DeepSeek-Suche und
  DeepSeek-Preset entfernt, MiniMax abgekündigt.
- **News**: keine vorbelegten Quellen mehr (Seed, Onboarding).
- **Migrationen** (`server/migrationen/s12*.js`, idempotent): gegen die DB-Kopie gelaufen (Testcontainer
  `autarktrade-v2-s12`, Port 8096, Testbetrieb): 5 Telegram-Quellen abgeschaltet (nicht gelöscht), Kalender-Länder
  `USD,JPY` → `USD,EUR`, Hype-Wahl (RugCheck, Coinbase/Kraken/KuCoin/Gate) übernommen, Endpunkt 2 (früher DeepSeek)
  übernommen, Wartungsmarge `binance` → `bybit`; zweiter Start ohne Änderung.
- **Geprüft**: `npm run test:self` 142/142 grün, `npm run build` fehlerfrei. Oberfläche im Prüf-Server (Wegwerf-SQLite,
  Testbetrieb) mit Wahl Bitget: Einstellungen › Datenquellen (auch 375 px), Marktradar Raster und Pult (QuelleAus,
  Attributionen), Chart auf Bitget mit Umstell-Hinweis, Live-Trading (Bookmap „nicht verfügbar“), Hype-Scan ohne
  CoinGecko-Schlüssel, Kalender aus Fed/BEA/Eurostat. Die DB-Kopie selbst steht hinter dem Passwort des Nutzers —
  dort nur Start und Migrationen über die Logs geprüft. KI-Texte nicht live erzeugt (keine Schlüssel in der Wegwerf-DB).

### Offene Punkte aus S12

- **S9-Struktur**: S12 kam nach S9 Teil 1 auf master. Der Bereich „Datenquellen“ hängt in der neuen Einstellungs-Hülle
  (`BEREICHE` in `Settings.vue`, Symbol `datenbank`); dafür steht `datenquellen` jetzt in `EINSTELLUNGS_BEREICHE`
  (`src/router/routen.js`, S9-Datei — sonst leitete der Wächter auf „Allgemein“ um). Schalter `kiEmpfehlungenAn`,
  DeepSeek-Suche und DeepSeek-Kostenzeile sind aus `ki/KiZugang.vue`, `ki/KiNewsBericht.vue`, `ki/KiAgent.vue` und
  `gemeinsam/useRadarEinstellungen.js` entfernt, Endpunkt-2-URL und Anbieterhinweise in `gemeinsam/useKiAnbieter.js`
  bzw. `ki/KiZugang.vue` ergänzt.
- Seiten mit `/api/binance/klines` (Daily, AgentSetups/Lab/Editor/Performance) bekommen bei fehlender Fähigkeit
  `{aus}` statt Kerzen und fangen das ab, nennen aber keinen Grund (S8/S9).
- Im Pult zeigen Stimmungs- und Zyklusband bei fehlender Quelle nur „—“ (Grund steht in der Kachel/Rasteransicht).
- Hype-Noten ohne Sozialsignal liegen durch die neue Normierung etwas höher (Sozial fällt aus dem Nenner) —
  nach den ersten Läufen beobachten.
- Nicht live geprüft: CoinGecko-`/onchain`-Pfade mit echtem Schlüssel, pump.fun-Kurve aus dem DexScreener-Paar.
- `KachelIndizes.vue`/`KachelWal.vue` sind nur noch Anzeigepfade für „entfernt“ und können weg.
- Settings: Antwort von „Anweisung prüfen“ (Lagebericht) trägt noch kein KI-Label.
- Anbieteranfragen (Binance, CoinGecko-Demo, GoPlus, CryptoQuant, Bybit/Bitget …) und Anwaltsfragen bleiben offen.
## S8 Ansichten neu — Ergebnis (19.10.2026)

- **Clean-Room**: drei Beschreibungs-Agenten schrieben `docs/spec/ansichten.md` (~3 700 Z.,
  Prosa/Tabellen; Abschnitt 0 = Entscheidungen des Leitstands zu allen offenen Punkten und
  Altfehlern). Altdateien danach gelöscht; fünf frische Agenten bauten parallel nur aus Spec
  und Golden Master neu (Daily · Screenshots+Markierung · Playbook · Dashboard/Auswertung/
  Kalender/TradeEvalPopup · AddTrades/AddExcursions). Gleiche Pfade und Export-Namen, Router
  und Layout unverändert.
- **Neu**: `views/{Daily,Dashboard,Auswertung,Calendar,Screenshots,Playbook,AddTrades,
  AddExcursions}.vue`, `components/{Calendar,Screenshot,TradeEvalPopup}.vue`,
  `utils/screenshots.js`; Unterkomponenten unter `components/{dashboard,auswertung,playbook,
  import,bildmarkierung}/`; `utils/scrolleZu.js` (scrollt nur den Inhaltsbereich). Neu
  gestaltet (eigener Code): `BotDashboard`, `ShareCardModal`, `NoData`,
  `rahmen/ScreenshotVollbild` (jetzt `basis/Dialog`, geöffnet über
  `useSelectedScreenshotFunction`/`useOeffneScreenshotVollbild` statt `#fullScreenModal`).
  Alles ohne Bootstrap-Klassen/-JS, Font Awesome und Unicons; Symbole je Gruppe in
  `basis/symbole/journal-*.js`.
- **markerjs2 ersetzt** (Paket entfernt, THIRD-PARTY-NOTICES neu): eigene Bildmarkierung
  `utils/bildmarkierung.js` (rein, Selbsttest `__selftest-bildmarkierung.mjs`, 107 Prüfungen)
  + `components/bildmarkierung/BildMarkierung.vue` (SVG; Pfeil, Rechteck, Linie, Text,
  Freihand, Auswahl/Verschieben/Löschen, Farbe, Strichbreite, Rückgängig/Wiederholen, Maus
  und Touch). `maState` v2 `{v:2, marker, fremd}` mit Koordinaten relativ zur Bildgrösse;
  alle 13 markerjs2-Typen werden gelesen, beim Speichern migriert, unbekannte bleiben in
  `fremd`. **Bewusste Änderung**: `annotatedBase64` ist jetzt das eingebrannte Gesamtbild
  (`markersOnly` 0) — vorher nur die transparente Ebene, die Playbook, Kopieren und KI als
  „Bild ohne Chart" bekamen; Altzeilen mit `markersOnly` 1 zeigt die Karte weiter als
  Original + Ebene. Markieren benennt das Bild nicht mehr um (Playbook-Verknüpfung blieb
  sonst auf der Strecke).
- **Quill** bleibt (BSD-3, npm, nur Playbook und Incoming; die CDN-Kopie war schon weg); im
  Playbook ohne Bild-Einfügen.
- **Behobene Altfehler** (Spec Abschnitt 0): ein Schliessweg im Trade-Detail, der speichert;
  MFE-Eingabe unter der ID des offenen Trades, Auto-MFE nur Anzeige + „Übernehmen";
  Kerzen/MFE vom Futures-Markt (Symbole ohne Spot zeigten nichts); Databento/Polygon in
  Daily gestrichen (Route fehlte); Reiter je Tageskarte unabhängig; Playbook lädt/speichert
  `trendScreenshotId`, löscht nur über ID/exakten Namen, Abbrechen setzt zurück, Bilder ohne
  Base64 vorladen; AddExcursions hängt nicht mehr (Fristen, Meldung) und schreibt keine
  doppelten Exkursionen; TradeEvalPopup meldet wieder bei jeder neuen Bewertung;
  Screenshot-Zuordnung über `objectId`, `maState {}` wirft nicht mehr. Rechenregeln
  (Brutto/Netto, Break-even, Duplikatprüfung des Imports) unverändert.
- **Gemeinsame Bausteine nachgebessert**: `InfoTipp` hängt seine Box in ein offenes `<dialog>`
  (lag sonst darunter); `.at-tabelle-huelle` ist `position: relative` (ein `.at-unsichtbar`
  im Spaltenkopf schob die Tagesansicht am Telefon auf 574 px).
- **Geprüft**: `npm run test:self` 140/140, Golden Master unverändert grün, `npm run build`
  fehlerfrei. Prüf-Instanz `s8-pruef` (Port 8099, `AT_ALLOW_INSECURE=1 AT_TESTBETRIEB=1
  AT_BEDINGUNGEN=aus`, Wegwerf-SQLite mit 48 Trades über `journal-bridge` und einem Bild mit
  altem markerjs2-Zustand): Dashboard (alle Reiter), Tagesansicht mit Detail, Kerzenchart,
  Blättern, Vollbild; Screenshots mit Markierung (Altmarker migriert, gezeichnet,
  rückgängig, eingebrannt gespeichert — `name` blieb); Kalender, Auswertung, Playbook
  (Deep-Link, Bewertung gespeichert), manueller Trade gespeichert, Exkursionen — Desktop 1440
  und Telefon 375 ohne Querscrollen, ohne JS-Fehler. 23 Screenshots im Notizordner
  (`s8-screenshots/`). Nicht im Browser geprüft: API-Import (keine Schlüssel), Share-Karte
  mit FLUX, KI-Bewertung.

### Offene Punkte aus S8

- **Für S9**: In den S8-Dateien gibt es kein Bootstrap mehr; `#fullScreenModal` ist weg. Die
  Weiterleitungen `stores/globals.js` usw. und `useInitTab`/`useInitPopover`/
  Tagesdiagramm-Aufrufe in `utils/journal/ablauf.js` sind für die neuen Ansichten wirkungslos
  (Spec D.13.1) — beim Aufräumen entfernen. `Dialog.vue` hat fest deutsche aria-Texte.
- Zahlen- und Datumsformat der Ansichten wie bisher (`$-4.19`, englische Monatsnamen aus dayjs);
  Vereinheitlichung wäre eine eigene Aufgabe.
- Die Tags-Bearbeitung in der Tagesansicht war schon vorher tot (nichts öffnete das Fenster)
  und wurde nicht nachgebaut; Tags werden im Playbook gepflegt.
- Nach Rebase auf S12: die Tagesansicht zeigt bei abgeschalteter Marktdatenquelle die
  `{aus, meldung}`-Antwort von `/api/binance/klines` als Grund statt „Chart nicht verfügbar";
  ShareCardModal trägt den KI-Hinweis von S12 im neuen Dialog.
- `NOTICE.md` geändert (markerjs2-Absatz raus) → neue Prüfsumme, der Rechtliches-Dialog fragt
  einmal neu.

## S9 Gerüst & Einstellungen — Teil 2 (19.10.2026)

- **Bootstrap (CSS, JS, Popper), Font Awesome und Unicons sind weg**: aus `index.html` (keine
  CDN-Ressource mehr), `package.json`/`package-lock.json`, `main.js` (`window.bootstrap`) und allen
  Dateien. `THIRD-PARTY-NOTICES` neu erzeugt. `useInitTooltip`/`useInitPopover`/`useInitTab`
  gelöscht, Filter-Tooltips über `InfoTipp`. Umgestellt auf Bausteine/`hilfen.css`: Setup,
  Update-Assistent, Onboarding (auch in den Einstellungen benutzt), LoginGate, ModelManager,
  KiUebersicht, KiAgent, Lernen, Accounts, FilterLeiste, BetaHinweis, ReturnToTop, Liquidity u. a.
  `ModeSwitcher.vue` (unbenutzt) und `basis/symbole/unicons.js` gelöscht; `menu.js` ohne `icon`.
- **Übergangsschicht aufgelöst**: `uebergang.css` → `kacheln.css` (Kachelraster, Kachel,
  Overlay, `ctl-pill`, `card-config-*`, Live-Kopfzeile), `journal.css` (`dailyCard`,
  `greenTrade`/`redTrade`, Diagrammflächen, `.tag`, Chat), `quill.css`, `basis.css` (eigene
  Grundordnung statt Bootstrap-Reboot, native Felder in `:where()`), `hilfen.css` (Zensur,
  `pointerClass`) und scoped. Alte Variablen (`--blue-color`, `--white-*`, `--black-bg-*`,
  `--border-radius` …) in ~90 Dateien durch Tokens ersetzt. Desktop: berechnete Stile auf 52
  Routen vor/nach dem Auflösen gleich; Telefon: Kartenradius 10 → 14 px wie die übrigen Karten.
- **Selbsttest** `src/utils/__selftest-ohne-bootstrap.mjs`: kein Bootstrap/Popper/Icon-Font in
  `package.json`, keine CDN-Links in `index.html`, kein `window.bootstrap`/`data-bs-*`, keine
  `uil`/`fa`-Klassen, keine Übergangsdatei und keine alten Variablen in `src/`.
- **Behoben nebenbei**: `AgentPerformance` rief `apiFehlerText` ohne Import auf; Fusszeile der
  Liquidationskarte quetschte am Telefon den Messhinweis in eine Wortspalte.
- **Geprüft**: `npm run test:self` grün, `npm run build` fehlerfrei. Durchgeklickt im Prüf-Server
  `s9-pruef` (gleicher Build, Wegwerf-SQLite, Testbetrieb): 46 Routen je Desktop (1440) und
  Telefon (390) als Screenshots im Notizordner der Sitzungsgruppe (`s9-screenshots/`, Übersichten
  `s9-blatt/`), dazu Marktradar/Liquidationskarte/Einstellungen im eingebauten Browser. Der
  Prüf-Container 8091 (echte Datenkopie) steht hinter dem Passwort der Kopie — dort nur
  Neubau und Anmeldeseite geprüft.

### Offene Punkte aus S9

- Reine Weiterleitungen aus S7 stehen noch: `stores/globals.js`,
  `utils/{trades,daily,mountOrchestration,utils}.js` (niemand importiert sie) sowie
  `utils/formatters.js` und `utils/dayjs-setup.js` (noch von `utils/journal/diagramme/*` benutzt —
  dort auf `../format.js` bzw. `../zeit.js` umhängen, dann löschen). Das Löschen war in dieser
  Sitzung nicht freigegeben → S11.
- `tokens.css` Z. 10–13 nennt im Kommentar noch `style-dark.css` (Datei gehört nicht S9).
- Live-Trading-Kopf: Symbolwahl überdeckt unter ~1600 px den Umschalter Raster/Pult (aus S5, unverändert).
- `Dialog.vue` hat fest deutsche aria-Texte (aus S8); KiUebersicht-ECharts mit festen Achsenfarben.
- Headless-Screenshots von Marktradar bleiben schwarz (Dauerabfragen halten die virtuelle Zeit an);
  im Browser geprüft, in Ordnung.

## S9 Gerüst & Einstellungen — Teil 1 (19.10.2026)

- **Clean-Room**: `docs/spec/geruest.md` und `docs/spec/stil.md` (Unteragent A), Neubau durch
  frische Agenten ohne Blick in die Altdateien. Altdateien gelöscht: `router/index.js` (neu:
  `router/index.js` + `routen.js`), `SideMenu.vue`, `Nav.vue`, `layouts/Dashboard.vue`,
  `assets/style-dark.css`, `assets/base.css` (war tot).
- **Gerüst** unter `components/rahmen/`: `Seitenmenue`, `MenueJournalKopf`, `MenueFuss`
  (Update nur mit Lizenzberechtigung, Einstieg „Rechtliches" — S10 übernommen),
  `Titelzeile` (Export-Menü ohne Bootstrap), `ScreenshotVollbild` (`#fullScreenModal`,
  noch Bootstrap-Modal — `S9-Teil2:`). Menü aus der Registry; `menu.js` trägt je Seite und
  Modus `symbol` (Symbol.vue-Name), `icon` bleibt bis Teil 2. Behoben: Catch-all-Route,
  `pageId` folgt jeder Navigation, `screenType` reagiert auf Fenstergrösse, KI-Bericht-Polling
  wird abgeräumt (`composables/useKiBerichtWache.js`), `APP_MODES` kennt `lernen`.
- **Einstellungen**: Route `/settings/:bereich?` (allgemein, journal, live, ki,
  benachrichtigungen, lizenz, rechtliches; unbekannt → allgemein). `Settings.vue` ist eine
  Hülle, Bereiche und Sektionen unter `views/einstellungen/` (Bausteine `gemeinsam/Abschnitt`,
  `Feld`, `Schalter`), komplett ohne Bootstrap-Markup und Icon-Fonts. Lizenz-Reiter =
  `LizenzEinstellung` (S10), Rechtliches-Reiter öffnet den S10-Dialog je Reiter. Behoben:
  ESP32-Kopierknopf warf (`navigator` im Template), `kiEmpfehlungenAn` wurde nie geladen.
  Verweise (`Nachrichten`, `KiAgent`, Kacheln, `AddExcursions`, `apiDescription`) zeigen auf
  `/settings/<bereich>`.
- **Stil**: `src/assets/design/uebergang.css` (~960 Z.) statt `style-dark.css`: alte
  Variablen als Token-Aliase, Bootstrap-Dunkelanpassungen, nur benutzte Altklassen
  (u. a. `ctl-pill`, `dailyCard`, `card-config-*`, Kachel/Overlay, `greenTrade`). Nicht
  nachgebaut: globaler h2–h4-Abstand, `.tags`-Hintergrund, grössere Grundschrift.
- **Prüf-Server**: `.claude/launch.json` → `s9-pruef` (Port 8097, Testbetrieb, Wegwerf-SQLite,
  dient `dist/`).

## S7 Journal-Kern neu — Ergebnis (19.10.2026)

- **Clean-Room**: Unteragent A beschrieb `trades.js`, `daily.js`, `mountOrchestration.js`,
  `calendar.js`, `formatters.js`, `dayjs-setup.js`, `utils.js`, `journal-alt.js`, den Store
  `globals.js` und `SidebarFilters.vue` in `docs/spec/journal-kern.md` (1932 Z., Prosa/Tabellen,
  15 eingefrorene Altfehler in §7, Aufrufer-Landkarte §9). Ein frischer Unteragent B baute
  nur daraus und aus den Golden Mastern neu (eine grep-Ausgabe zeigte ihm einmal drei
  Import-/Kommentarzeilen aus `trades.js`; nichts davon verwendet).
- **Neu**: `src/utils/journal/` — `laden`, `filtern`, `summen`, `gruppieren`, `gewinnanalyse`,
  `tagesrechnung` (Blotter/P&L), `kalender`, `tagebuch` (Zufriedenheit, Tags, Notizen,
  Exkursionen), `import` (Vorschau/Speichern des API-Imports, OHLCV, MFE), `ablauf` (Mounts),
  `app` (App-Start, Perioden, Reiter), `format`, `zeit` (dayjs), `kette`, `hilfen`,
  `diagrammLader` (lädt `journal/diagramme/` von S4). Stores neu geschnitten:
  `src/stores/app/{rahmen,laden,einstellungen,ablage}.js`, `src/stores/journal/{filter,
  auswertung,import,tagebuch,kalender,screenshots,offenePositionen}.js`; die Bündel
  `stores/{ui,filters,trades,settings}.js` re-exportieren sie. Filterleiste:
  `src/components/journal/FilterLeiste.vue` (eingebunden in `rahmen/MenueJournalKopf.vue`).
- **Gelöscht**: `calendar.js`, `journal-alt.js`, `SidebarFilters.vue`. **Reine Weiterleitungen**
  (nur `export … from`, für parallele Sitzungen, in S9/S11 löschen): `stores/globals.js`,
  `utils/{trades,daily,mountOrchestration,formatters,dayjs-setup,utils}.js`. In `src/` importiert
  sie niemand mehr.
- **Bewusste Korrektur 1 — Tag-Gruppen**: `groups.group_*` wird vor jedem Lauf geleert; vorher
  zeigten die Tag-Diagramme nach einem Filterwechsel den alten Filter. Golden Master neu: nur
  „nurAgent" und „ohneTagsNurUngetaggt" verlieren die fremden group_1/group_2 (36/49 Trades).
- **Bewusste Korrektur 2 — Datenmodell**: `sec`/`taf`/`nscc`/`nasdaq` (immer 0) und ihre Summe
  `otherCommission` aus Trade-, Blotter- und P&L-Objekten entfernt (`buildTradeObj`,
  `incoming.js`, `journal-bridge.js`, `totals-kern.js`), Dashboard-Zeile „regulatoryFees" raus.
  **SCHEMA_VERSION 28**: Migration streicht die Schlüssel aus gespeicherten Tageszeilen
  (gegen Wegwerf-SQLite geprüft). Golden Master neu, Gegenprobe: alter Stand minus die
  Schlüssel == neuer Stand, keine Zahl ändert sich.
- **Geprüft**: `npm run test:self` 139/139 grün, `npm run build` fehlerfrei; Prüf-Instanz
  (Port 8098, `AT_ALLOW_INSECURE=1 AT_TESTBETRIEB=1 AT_BEDINGUNGEN=aus`, Wegwerf-SQLite mit
  40 Test-Trades über `journal-bridge.alsJournalTrade`): Dashboard (Übersicht, Performance,
  Setups), Tagesansicht mit Blotter, Kalender, Filterleiste im S9-Seitenmenü — ohne JS-Fehler.
- **Für S8**: Die §7-Altfehler 7.2–7.15 sind im neuen Code nachgebildet und markiert (u. a.
  `pAndL`/`blotter` nur an der letzten Tageskopie bei zwei Börsen am selben Tag,
  `miniCalendarsData` als Objekt → nie Mini-Kalender, `mfePrices`-Modulspeicher,
  `useGetOHLCV` löst nach dem ersten Symbol auf). Die Ansichten (Daily, Dashboard, Kalender,
  AddTrades, AddExcursions) lesen weiter dieselben Store-Namen. i18n-Schlüssel
  `dashboard.regulatoryFees` ist jetzt unbenutzt.

## S5 Redesign Handel — Ergebnis (19.10.2026)

- **Bereich frei von Bootstrap-Klassen/-JS, Font Awesome und Unicons**: Chart-Arbeitsplatz
  (`Chart.vue`, alle `components/chart/*`), Live-Trading (`Livetrading.vue`,
  `components/livetrading/**`, `LiveSymbolPicker.vue`, Bookmap-Statusleiste in
  `LiquidityHeatmap.vue`), `LiveSessions.vue`, `LiveAuswertung.vue`, `Incoming.vue`, alle
  Agent-Seiten (`AgentStrategies/Setups/Performance/Editor/Builder/Lab`, `CoinRangliste`,
  `StrategyParamForm`, `ZahlOderParam`). Ersetzt durch `Knopf`, `Pille`, `Hinweis`, `Reiter`,
  `Kreisel`, `Symbol` und scoped CSS mit Token; die Pill-Tabs mit `data-bs-toggle` in den
  Strategie-Instanzen laufen jetzt über `Reiter` + `v-show`. Alte Farbwerte und
  `--white-*`/`--blue-color` in diesen Dateien auf Token umgestellt.
- **Gemeinsame Bausteine (von S6 übernommen)**: `basis/Kreisel.vue`; Block „S5 Handel" in
  `Symbol.vue` (≈ 90 Symbole, Prop `gefuellt`); in `basis.css` die Klassen `at-feld`
  (+ `klein`), `at-label`, `at-check`, `at-tabelle` (+ `dicht`, `at-tabelle-huelle`),
  `at-gut`/`at-schlecht`/`at-warn`. `config/livetrading.js` und `config/pult.js` tragen
  Symbol-Namen. Die mit dem Marktradar geteilten Live-Kacheln, `RadarKachel`,
  `RadarOverlay` und `PultRahmen` stehen im Stand von S6.
- **Verhalten unverändert**, TradingView-Logo im Chart bleibt an (`attributionLogo: true`).
  Bewusst geblieben: App-eigene Alt-Klassen aus `style-dark.css` (`ctl-pill`, `dailyCard`,
  `stress-dot`, `card-config-*` …, gehen mit S9), Farbwerte im Chart-/ECharts-JS, die
  eigene Dialoghülle von Alarm- und Indikatordialog (Esc wird in der Capture-Phase
  abgefangen, damit die Chart-Tastatur es nicht sieht — ein natives `<dialog>` würde das
  ändern).
- **Geprüft**: `npm run test:self` 137/137 grün, `vite build` ok. Prüf-Server mit
  Wegwerf-SQLite (Testbetrieb, Port 8095), alle Seiten im eingebauten Browser Desktop
  (1440/1800) und Telefon (375), ohne horizontalen Überlauf; Pendente Trades mit zwei
  Testpositionen, Labor mit echtem Backtest. Screenshots im Notizordner der Sitzungsgruppe
  (`s5-screenshots/`).

### Offene Punkte aus S5

- `utils/chart/overlays/liste.js` und `utils/chart/zeichnungen/werkzeuge.js` tragen noch
  `icon: 'uil …'`-Felder, die nicht mehr gelesen werden (Zuordnung zu Symbol-Namen steht
  in `ChartKopfleiste.vue`/`Zeichenleiste.vue`) — beim Aufräumen entfernen (S9).
- **Fehler (alt)**: `AgentPerformance.vue` ruft `apiFehlerText` auf, ohne es zu importieren —
  beim Fehlschlag von „Spiegeln"/„Entfernen" gibt es einen ReferenceError statt einer Meldung.
- Live-Trading-Kopf: Die mittig absolut gesetzte Symbolwahl überdeckt unter ~1600 px Breite
  (mit Seitenmenü) den Umschalter Raster/Pult — so schon vorher, im Cockpit-Fenster ohne
  Menü passt es.
- Prüfumgebung: Das Session-Cookie `at_session` gilt pro Host, nicht pro Port. Wer im selben
  Browser `localhost:8091` (Testcontainer) und einen lokalen Prüf-Server auf `localhost`
  öffnet, bekommt 401 — den Prüf-Server über `127.0.0.1` aufrufen.
- Seitenmenü und `ReturnToTopButton` tragen noch Unicons (Bereich S9).

## S6 Redesign Analyse — Ergebnis (19.10.2026)

- **Bereich frei von Bootstrap, Font Awesome und Unicons**: Marktradar (Raster und Pult,
  alle Kacheln unter `components/radar/` inkl. derer, die das Live-Fenster einbindet),
  Nachrichten, Hype-Radar (Übersicht, Frühphase, Börsen, Berichte, Projektprüfung,
  Tiefensuche), Coin-Radar (Analyse, Verlauf, Abverkauf), KI-Coach (`KiAgent.vue`),
  Lernen; dazu `RadarKachel`, `RadarOverlay`, `PageInfo`, `InfoTipp`, `AnbieterWahl`,
  `SpinnerLoadingPage`. Knöpfe → `Knopf`, Ladekreisel → `Kreisel`, Marken → `Pille`,
  Meldungen → `Hinweis`, Reiter → `Reiter`, Formfelder → `.at-feld`/`.at-check`
  (aus S5), Rasterzeilen → `.at-formzeile` bzw. eigene CSS-Grids. Kein Verhalten
  geändert; Selbsttests 137/137, Build grün.
- **Neue Bausteine**:
  - `src/assets/design/hilfen.css` (in `main.js` nach `basis.css`): eigene Hilfsklassen
    statt Bootstrap-Utilities — `at-flex/at-mitte/at-verteilt/at-luecke-N`, Abstände
    `at-mo/mu/ml/mr-N`, `at-py/px/p-N`, `at-klein/at-fett/at-rechtsbuendig/at-mittig`,
    `at-formzeile` + `at-feldbreite-*`, Kippschalter `<label|div class="at-check schalter">`,
    `at-regler`, `at-unsichtbar`. Gleiche Abstandstreppe wie Bootstrap, also ohne
    Verschiebung. Für S8/S9 mitbenutzbar.
  - `src/components/basis/Quellenhinweis.vue` — **für S12**: `:quellen="[{ name, url?,
    art: 'daten'|'quelle'|'powered'|'ki' }]"` ergibt „Daten: …", „Quelle: …",
    „Powered by …", „KI-generiert · …" (Links ohne Referrer, nie ausgeblendet).
    Hängt schon in `RadarOverlay` (Fusszeile der Gross-Ansicht); dessen Prop `quelle`
    nimmt jetzt Text ODER eine Quellenliste — S12 kann `quelle` in
    `config/marktradar.js` direkt auf Objekte umstellen.
  - Symbole: `src/components/basis/symbole/analyse.js` (37 neue, keine Markenzeichen:
    YouTube → `video`, X → `nachricht`, Telegram → `senden`, GitHub → `code`, Bitcoin →
    `muenzen`), per `Object.assign` in `Symbol.vue` — weitere Bereiche legen eine eigene
    Datei in `symbole/` an statt in die gemeinsame Liste zu schreiben.
  - `src/components/basis/symbole/unicons.js`: Übergangstabelle Unicons-Name →
    Symbolname plus `symbolName()`; `RadarKachel` und `PultRahmen` nehmen damit beides
    (die Live-Registry von S5 lief unverändert weiter). Fällt in S9 weg.
- **Pult am Telefon** (offener Punkt S2): `Stimmungsband` und `Zyklusband` hatten feste
  Spalten (2 × 170 px bzw. 210 px) — die Skalen bekamen null Breite und ihr Text lief
  übereinander; `PultRahmen` hatte feste Höhe mit `overflow: hidden` und zwei Spalten.
  Jetzt unter 768 px gestapelt (Bühne mit eigener Höhe, die Seite scrollt), Bänder
  zwei- bzw. einspaltig.
- **Nebenbei behoben**: `.at-tabelle th/td` (basis.css) wirkte als Nachfahren-Selektor
  auch auf Detailtabellen in aufgeklappten Zeilen (Coin-Radar: Spalten liefen
  ineinander) — Rücksetzung in `hilfen.css`. Marktradar-Kopf: die absolut zentrierte
  Symbolwahl überdeckte im Raster bei 1440 px den Knopf „Raster" — fliesst jetzt unter
  1600 px, Börsenlinks inline.
- **Tokens**: kein Bedarf.
- **Geprüft**: Prüfserver mit Wegwerf-SQLite (`AT_DB_FILE`, Testbetrieb, eigener
  Vite-Port), Marktradar Raster/Pult/Gross-Ansicht, Nachrichten, Hype-Radar inkl.
  Einstellungen, Coin-Radar mit echtem Messlauf und aufgeklappter Zeile, KI-Coach,
  Lernen — je Desktop 1440 und Telefon 375. Nicht geprüft mit echten Daten: Hype-Scan
  und KI-Texte (keine Schlüssel in der Wegwerf-DB), Börsen-Ansicht befüllt.

### Offene Punkte aus S6

- **Für S9**: Der Bereich benutzt noch eigene Altklassen aus `style-dark.css`
  (`ctl-pill` ~70×, `dailyCard`, `liveHeader/liveDot/liveActions`, `radarCard*`,
  `radarOverlay*`, `card-config-*`, `greenTrade/redTrade`, `pointerClass`, `chat-*`).
  Das ist kein Bootstrap und trägt die Token-Farben, muss aber vor dem Löschen von
  `style-dark.css` nach `hilfen.css`/Bausteine wandern (gemeinsam mit dem Live-Fenster).
- `KiAgent.vue` und `Lernen.vue` haben noch harte Farbwerte in ihren `<style>`-Blöcken
  (`#a78bfa`, `#34d399`, `var(--blue-color)`) — Feinschliff, kein Bootstrap.
- `CoinRadar.vue`: `<tr>` direkt in `<table>` (Vue-Warnung beim Kompilieren) — alt.
- Für S12: `Quellenhinweis` an jede Kachel/Seite hängen; die KI-Texte (Gesamtlage,
  Lagebericht, Hype-Bericht, Einordnung, KI-Coach) mit `art: 'ki'` kennzeichnen.
## S10 Lizenz & Vertrieb — Ergebnis (19.10.2026)

- **`LICENSE`**: Entwurf „AutarkTrade Lizenzbedingungen" Fassung 0.1 nach dem Muster
  AutarkDarts 1.3 — Schweizer Recht, Beta-Hinweis nach Art. 4 Abs. 3 CRA, keine
  Anlageberatung (Ziff. 6), keine Haftung für Orders/Verluste/Fehlausführungen/Daten
  Dritter (Ziff. 7, 8, 15), Kundenschlüssel und eigene Verträge mit Börsen und
  KI-Anbietern, Länderhinweise Bitget/Bitunix/Pionex (Ziff. 9), LGPL/GPL-Ausnahme inkl.
  Reverse Engineering nach LGPLv3 §4 für Betriebssystem-Teile im Image (Ziff. 13).
  **Anbieter, Gerichtsstand und Beta-Ende sind Platzhalter**; „ENTWURF, nicht anwaltlich
  geprüft" steht oben. `package.json`: `"license": "SEE LICENSE IN LICENSE"`, `private`.
- **`NOTICE.md`** (Herkunft, fremde Software, sharp-Entscheidung, Quellenangebot für das
  Container-Image, Begleitprogramme, Marken) und **`THIRD-PARTY-NOTICES`** (227 Pakete,
  316 KB) aus `scripts/drittlizenzen.mjs` — Produktionspakete aus `package-lock.json`,
  Lizenz-/NOTICE-Dateien, ECharts-NOTICE und d3-Lizenz, Lightweight-Charts-NOTICE
  nachgetragen. Läuft auch im Docker-Build; `server/__selftest-rechtliches.mjs` schlägt an,
  wenn die Datei nicht mehr zum Lockfile passt. **Nach jeder Abhängigkeitsänderung
  `node scripts/drittlizenzen.mjs`.**
- **Dialog „Rechtliches"** (`src/components/rechtliches/Rechtliches.vue`, Server
  `server/rechtliches.js`): erscheint beim ersten Start und bei neuer Fassung (Zeile 2 von
  LICENSE) über jeder Seite, ohne Schliessen/Esc, bis zugestimmt ist; Reiter Lizenz /
  NOTICE / Fremde Software (darin der Lightweight-Charts-NOTICE-Text — erfüllt die
  „Über-/Lizenzen-Seite"). Zustimmung mit Prüfsummen und Verlauf in
  `settings.rechtlichesZustimmung`. Eingehängt in **`App.vue`**, nicht im Layout: der
  Setup-Assistent beim ersten Start hat keins. Zum Nachlesen: Link „Rechtliches" unten im
  Seitenmenü und Einstellungen › Allgemein › Lizenz. `AT_BEDINGUNGEN=aus` schaltet die
  Pflicht ab. Bewusst keine API-Sperre (träfe den Stop-Wächter).
- **Lizenzschlüssel** `server/lizenz.js`: `AT1.<Inhalt>.<Ed25519-Signatur>`, offline gegen
  den eingebauten öffentlichen Schlüssel geprüft; Käufer, Edition (standard/test),
  `updatesBis`, bei Test `gueltigBis`, optional `zugang` (Zugangsdaten zur Paketquelle).
  Ohne gültigen Schlüssel Testmodus: alles nutzbar, Hinweis sichtbar, nur keine Updates
  über den Knopf. Selbsttest `server/__selftest-lizenz.mjs` (36 Prüfungen, inkl. „kein
  privater Schlüssel im Repo"). Ausstellen: `scripts/lizenz-ausstellen.mjs`, privater
  Schlüssel über `AT_LIZENZ_PRIVAT`. **Das Schlüsselpaar wurde am 19.10.2026 erzeugt; der
  private Schlüssel liegt auf dem Entwicklungsrechner unter
  `~/.config/autarktrade/lizenz-signatur.pem` (0600) — sichern, nie ins Repo.** Eingabe:
  `LizenzEinstellung.vue` (Settings.vue: nur Import + eine Zeile).
- **Update-Kanal**: `update-api.js` fragt die Releases des privaten Repos (Token aus
  `AT_UPDATE_TOKEN` oder Lizenz-`zugang`), zieht per `git fetch <url> master` bzw.
  `docker pull ghcr.io/mouses007/autarktrade` mit `X-Registry-Auth`, Token nie auf der
  Befehlszeile oder in `.git/config`. Installiert wird nur ein Release, das an oder vor
  `updatesBis` erschienen ist; sonst zeigt das Seitenmenü „Lizenz nötig". `install*`,
  `update*`, `setup-remote.sh` über `scripts/paketquelle.sh`/`.bat` aufs neue Repo
  umgestellt (stellen alte Installationen um), Namen auf AutarkTrade. Spenden-Rest
  `nav.donate` und README-Erwähnung entfernt.
- **sharp ersetzt**: Share-Card wird im Browser zusammengesetzt
  (`src/utils/shareCardBild.js`); 9 Pakete mit LGPL-Anteil und die Schriftpakete im Image
  sind weg. Begründung in NOTICE.md.
- Geprüft: `npm run test:self` grün, Build fehlerfrei, Docker-Image gebaut und im
  Prüf-Container (Wegwerf-SQLite, Testbetrieb, `AT_ALLOW_INSECURE=1`) angesehen: Dialog beim
  ersten Start über dem Setup, Esc wirkungslos, Zustimmung gespeichert, neue Fassung
  (0.1 → 0.2) fragt erneut, Lesemodus aus dem Seitenmenü, Lizenzkarte im Test- und
  Vollmodus, falscher Schlüssel überschreibt den gültigen nicht, Telefonbreite ohne
  Querscrollen.

### Offene Punkte aus S10

- Anwalt: LICENSE/NOTICE gegenlesen (F-6, F-7, F-10, F-13 aus der Verkaufs-Prüfung),
  Anbieter und Gerichtsstand eintragen, Beta-Ende setzen.
- **Weitergabe erst nach S11**: Solange TradeNote-Anteile im Code stehen, ist der Stand als
  Ganzes GPL (NOTICE.md, oben).
- Update-Pfad mit echtem Release noch nicht durchgespielt (es gibt noch kein Release im
  privaten Repo); geprüft sind Token-Weitergabe an git (gegen das private Repo) und der
  Lizenz-Gate im Selbsttest. Der Docker-Workflow veröffentlicht nur `edge` — für den
  Update-Knopf im Container braucht es Release-Tags + passendes Image-Tag (S11, CI).
- Der Kunden-Zugang ist ein Übergang: `zugang` im Schlüssel bzw. ein GitHub-Token je Kunde.
  Für ghcr.io braucht es einen klassischen Token mit `read:packages`; fein granulierte Tokens
  können keine Pakete lesen. Ein Shop/Händler-Dienst mit eigener Download-Quelle (LIZENZ-PLAN
  Abschn. 3) ersetzt das später.
- markerjs2 (Linkware) ist noch drin, der sichtbare Link fehlt (S8 ersetzt die Annotation).
- Android-Widget, ESP32-Firmware, Desklet: Lizenzdateien/Offenlegung (S11).
- Prüf-Container im Browser über `127.0.0.1` öffnen, nicht `localhost`: das Cookie
  `at_session` gilt pro Host, nicht pro Port, und andere Sitzungen auf `localhost:8091`
  überschreiben es (Folge: 401 und Neuladen bei jedem Schreibzugriff).

## S4 Diagramme neu — Ergebnis (19.10.2026)

- **Clean-Room**: Unteragent A beschrieb `charts.js` und alle Aufrufer in
  `docs/spec/diagramme.md` (Prosa/Tabellen, kein Code); ein frischer Unteragent B baute
  nur aus Spec und Golden Master `src/utils/journal/diagramme/` neu (`index.js` als
  Schnittstelle, `verteiler.js`, `grundlagen.js`, `gestaltung.js`, je Diagrammfamilie
  ein Modul — ring, tagesansicht, zeitraum, gruppenAlt, gruppen, heatmap, gebuehren,
  performance, kerzen, strategie, auswertung). `src/utils/charts.js` gelöscht, alle
  Aufrufer umgehängt (die drei dynamischen Importe bleiben dynamisch, ECharts nicht im
  Start-Bundle).
- **Gestaltung**: Farben/Schrift zur Laufzeit aus den Tokens (`getComputedStyle`, Rückfall
  auf die Werte aus `tokens.css`), Türkis als Akzent, `--good`/`--bad` nur für Gewinn/Verlust.
- **Golden Master**: Daten (Reihen, Kategorien, Legende) unverändert grün, `journal-golden.json`
  nicht neu geschrieben. `diagrammDaten()` entfernt Darstellungsfelder (`itemStyle`,
  `emphasis`, `lineStyle`, `areaStyle`, `label`) auf beiden Seiten, weil die Farben bewusst
  neu sind.
- **Gesehen** im Prüf-Server (Wegwerf-SQLite mit den Golden-Master-Testdaten): Dashboard
  (alle fünf Reiter) und Auswertung. Kerzenchart und Agent-Diagramme nicht im Browser
  geprüft (brauchen Binance-Kerzen bzw. Strategie-Daten).

### Offene Punkte aus S4 (für S7/S8)

- Der Golden Master sichert die Kennzahl-Pfade der Gruppen-Diagramme nicht ab:
  `selectedRatio`/`selectedTimeFrame` sind im Test `null` (leeres localStorage), APPT,
  Profitfaktor und Wochen-/Monatsbündelung laufen dort nie.
- Bewusste Abweichungen vom Altverhalten (nicht vom Golden Master erfasst): Kerzen
  `[C,O,L,H]` der Aufrufer werden intern auf ECharts' `[O,C,L,H]` umgestellt (vorher
  vertauschte Farben); Zoomstufe 2 des Kerzencharts zeigt die Mitte statt eines Zeitpunkts
  nahe 1970; eine entsorgte Kerzen-Instanz wird neu geholt.
- Altlasten laut Spec Abschnitt 6: Wochen-/Monatsbündelung vergleicht nur die Nummer
  (ohne Jahr) und rechnet in der Prozess-Zeitzone; Profitfaktor bei Nenner 0 je Familie
  anders; `doubleLineChart…`/`pieChart<dateUnix>` der Tagesansicht und
  `barChartNegative12/14` haben kein Element mehr in einem Template — S8 entscheidet.
- `Auswertung.vue` übergibt eigene rgba-Farben an Tacho/Stresslinie (S8).

## S3 Aufräumen — Ergebnis (19.10.2026)

- **Gelöscht**: `brokers.js`, `brokers-kern.js`, `__selftest-brokers.mjs`, `addTrades.js`
  (2135 Z.). Darin tot: CSV-Import (`useImportTrades`, `createBitunixTrades`,
  `filterExisting`), der alte Ausführungs-Import (`createTempExecutions`,
  `createExecutions`, `createTrades`, `getOpenPositionsParse` — nie aufgerufen) und die
  davon abhängigen Zweige in `useUploadTrades`. i18n `addTrades.noCsvData`/`noValidBitgetTrades` raus.
- **`src/utils/journal-alt.js`** (~1000 Z., TradeNote-abgeleitet, unverändert übernommen):
  `useCreateBlotter`/`useCreatePnL` (für `trades.js`), `useGetExistingTradesArray`/
  `useUploadTrades` — **nicht tot**: der Bitunix/Bitget-Knopf „Von API importieren" in
  `AddTrades.vue` speichert darüber (Vorschau → „Absenden") —, dazu `useCreateOHLCV`,
  `useGetOHLCV`, `useGetMFEPrices`, `useUpdateMfePrices`. Ablösung in S7 (Kern) / S8 (AddTrades,
  AddExcursions, Daily).
- **Zweiter Golden Master** `src/utils/__selftest-mfe-pfade.mjs` + `fixtures/mfe-pfade-golden.json`,
  eingefroren gegen das alte `addTrades.js` VOR dem Umzug (eigener Commit), danach unverändert grün.
  Deckt ab: Databento-CSV → Kerzen, Kerzen über Polygon/Databento (Anfrageparameter mit),
  MFE je Trade in New York und Zürich, Marktschluss 11:00, Exkursionszeilen, API-Import-Vorschau
  und Speichern. Gegenprobe: drei eingebaute Fehler (MFE-Fenster, OHLCV-Volumen, Broker beim
  Speichern) schlugen je an. Die axios-Attrappe reicht jetzt Konfiguration/Rumpf an Antwortfunktionen durch.
- **Für S7/S8 mit eingefroren** (Fehler im heutigen Code): `mfePrices` ist ein nie geleerter
  Modulspeicher — zweimal Exkursionen nachtragen in einer Sitzung legt die ersten doppelt an, und
  der nächste API-Import (`useUploadTrades`) schreibt sie nochmals. `useGetOHLCV` löst nach dem
  ERSTEN Symbol auf (`AddExcursions.vue` rechnet dann evtl. mit unvollständigen Kerzen). Ein Trade,
  dessen Symbol gar nicht in den Kerzen steht, wirft in `useGetMFEPrices` und das Promise bleibt
  offen; `useUpdateMfePrices`/`useCreateOHLCV` lösen bei leerer Eingabe nie auf.
- **Offen, fremde Bereiche**: `setup.featureImport`/`setup.nextStepImport` (Setup.vue nennt noch
  „CSV-Upload") und `settings.benachrichtigungen.hinweis_importFertig` („CSV- oder API-Import")
  — S8/S9. `docs/VERKAUFS-PRUEFUNG.md` Z. 5 verweist noch auf `addTrades.js` (jetzt `journal-alt.js`).
- `npm run test:self` 137/137 Dateien grün, `npm run build` fehlerfrei.

## S2 Fundament V2 — Ergebnis (19.10.2026)

- **Repo**: `Trading/V2` aus `git archive` des Journal-master `7fb0326`, frische Historie
  auf `master`. Ohne Datenbanken, Backups, `_audit*`, `certs`, `REFACTORING-ANALYSE.md`,
  GPL-`LICENSE`.
- **Umbenennung**: `autarktrade` 4.0.0-alpha.0, Cookie `at_session`, SQLite
  `autarktrade.db` (alte `tradenote.db` wird weiterbenutzt, wenn nur sie da ist),
  Umgebung `AT_*` mit `CTJ_*`-Rückfall (`server/umgebung.js`). Unverändert und
  kommentiert: Schlüssel-Seed `tradenote-…` in `server/crypto.js`, Token-Zweck
  `tn_session_v1` in `server/auth.js` — sonst wären gespeicherte Schlüssel bzw. alle
  Sitzungen ungültig. Bewusst unverändert, weil gespeichert: `ctj-`-Präfix der
  `clientOrderId` (Abgleich offener Orders), `CTJ1`-Magic der Aufzeichnungen,
  `ctj-strategie`-Paketformat, `ctj.*`-Schlüssel im localStorage.
- **Aktualisierung**: `update-api.js` zeigt auf `Mouses007/AutarkTrade` (privat, Prüfung
  läuft bis S10 ins Leere — gegen das alte Repo hätte sie 3.x als „neuer" gemeldet).
  Docker-Workflow nur von Hand und nur nach `ghcr.io/mouses007/autarktrade`, kein
  öffentlicher Docker Hub.
- **Testbetrieb** `AT_TESTBETRIEB=1` (`server/testbetrieb.js`, Selbsttest
  `server/__selftest-testbetrieb.mjs`): keine Takte, Engine, Stop-Wächter, Rekorder,
  Kalender-/Schnappschuss-/ETF-Timer; keine Mail, kein Push; Banner; Handelslage-Automatik
  im Browser aus. Knöpfe bleiben.
- **DB-Kopie**: NAS-DB `autarktrade` (pg_dump von `tradejournal`, 19.10.2026). In der Kopie
  Benachrichtigungskanäle geleert, Strategie-Instanzen auf `paper` und pausiert.
- **Testcontainer**: `autarktrade-v2` auf Port 8091 über `scripts/v2-container.sh`
  (Zugangsdaten in `scripts/.v2-container.env`, nicht im Repo), `.claude/launch.json`.
- **Gestaltungssystem**: `src/assets/design/` (Token, Basis, Rahmen), Bausteine in
  `src/components/basis/`, eigenes Symbolset `Symbol.vue`, Logo aus
  `scripts/logo-zeichnen.mjs`, Favicons. Bootstrap/Popper lokal gebündelt, Quill nur in
  Playbook/Incoming.
- **Rahmen**: Kopfleiste mit Modi, Testbetrieb-Banner, Startseite `/start` mit Logo,
  Seitenmenü und Titelzeile im neuen Stil. Spenden-Link und -QR-Codes entfernt.

### Offene Punkte aus S2

- Font Awesome und Unicons kommen noch vom CDN (Unicons: „IconScout Simple License",
  gebündelt wäre es eine Weitergabe). Ablösung durch `Symbol.vue` in S5/S6/S8, Entfernen in S9.
- Android-Widget, ESP32 und Desklet tragen noch den alten Namen (S11).
- Installations-/Update-Skripte (`install*.sh/.bat`, `update*`, `setup-remote.sh`) zeigen
  noch auf das alte Repo (S10).
- `LIZENZ-PLAN.md` liegt als Bestandsaufnahme im Repo; `HERKUNFT.md` ist ein Platzhalter bis S11.
- **Fehler (auch im Live-Journal)**: Die Migration „Mail-Versand des Lageberichts übernehmen"
  in `server/database.js` (~Z. 2167) läuft bei JEDEM Start, solange `radarNewsMailAktiv = 0`
  und `benachrichtigungen.lageberichtFertig.email = true` — wer den Versand ausschaltet,
  hat ihn nach dem nächsten Neustart wieder an. In der Kopie behoben durch Entfernen der
  alten Mail-Wahl; der Code braucht einen Merker „übernommen".
- ~~Marktradar, Ansicht „Pult": am Telefon überlappen die oberen Kacheln~~ — behoben in S6.
- Screenshots mit echten Daten: 8091 steht hinter dem Passwort-Gate der Kopie; geprüft
  wurde die Oberfläche im Prüf-Container mit leerer SQLite, die Daten über die API.
- Privates GitHub-Repo: https://github.com/Mouses007/AutarkTrade (angelegt 19.10.2026, privat).
