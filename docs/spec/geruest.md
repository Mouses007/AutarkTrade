# Spezifikation: App-Gerüst (Router, Seitenmenü, Titelzeile, Layout)

Clean-Room-Beschreibung für den Neubau von

- `src/router/index.js`
- `src/components/SideMenu.vue`
- `src/components/Nav.vue`
- `src/layouts/Dashboard.vue`

Beschrieben wird **Verhalten**, nicht Code. Namen von Stores, Funktionen,
Props, Routen und CSS-Klassen sind Schnittstellen — sie werden von anderen
Dateien benutzt und müssen erhalten bleiben, sofern unten nicht ausdrücklich
etwas anderes steht. Wo der Altbestand einen Grund kennt, steht er dabei:
der Grund ist die eigentliche Anforderung.

Stand der Erhebung: 19.10.2026, Branch `claude/s9-geruest-23d7aa`.

---

## 0. Umgebung, in der die vier Dateien leben

### 0.1 Einstieg

- `src/main.js` erzeugt die App, hängt i18n und den Router ein und mountet
  erst, wenn die gespeicherte Sprache geladen ist (`starteSprache()` aus
  `src/i18n`). Stylesheet-Reihenfolge: Bootstrap (gebündelt, zusätzlich als
  globales `window.bootstrap`, weil Altcode `new bootstrap.Modal` und
  `data-bs-toggle` benutzt) → `design/tokens.css` → `style-dark.css` →
  `design/basis.css` → `design/rahmen.css`. `src/assets/base.css` wird
  **nirgends** geladen.
- `src/App.vue` prüft beim Mount `GET /api/auth/status`. Braucht es ein Login
  (`setupRequired` oder `authEnabled && !loggedIn`), erscheint `LoginGate`
  statt der App. Sonst rendert App.vue die Komponente aus
  `$route.meta.layout` (oder ein schlichtes `div`, wenn die Route kein Layout
  hat) und darin den `RouterView`. **Das Layout ist also ein Route-Meta-Feld,
  das die Layout-Komponente selbst (nicht ihren Namen) enthält.**
- Weil alle Layout-Routen dieselbe Komponente tragen, wird das Layout bei
  einer SPA-Navigation (router.push / router-link) **nicht** neu gemountet.
  Fast alle Menü-Links sind aber gewöhnliche `<a href>` und lösen einen
  vollen Seitenaufruf aus — darauf verlässt sich die Initialisierung (siehe
  `pageId`, Abschnitt 4.3).

### 0.2 Stores und Hilfsfunktionen, die das Gerüst benutzt

Alle Stores sind schlichte `ref()`-Exporte (kein Pinia). `src/stores/ui.js`
ist nur ein Sammel-Re-Export aus `src/stores/globals.js`.

| Name | Herkunft | Bedeutung |
|---|---|---|
| `pageId` | `stores/ui.js` | Name der aktuellen Route; wird von `usePageId()` gesetzt. Von vielen Journal-Dateien gelesen (SidebarFilters, Calendar, screenshots.js, mountOrchestration.js …). |
| `screenType` | `stores/ui.js` | `'computer'` ab 992 px Fensterbreite, sonst `'mobile'`; gesetzt von `useScreenType()` (einmalig beim Layout-Mount, kein Resize-Listener). |
| `sideMenuMobileOut` | `stores/ui.js` | true, solange das Handy-Menü ausgefahren ist. |
| `sideMenuEingeklappt`, `schalteSideMenu()` | `stores/globals.js` | Desktop-Menü eingeklappt (nur Symbole). Liegt im localStorage-Schlüssel `sideMenuEingeklappt` (`'1'`/`'0'`) — Vorliebe des Bildschirms, muss vor dem Laden der Einstellungen feststehen, sonst springt das Layout beim Öffnen auf und zu. |
| `appMode` | `stores/ui.js` | Aktueller Modus (`journal`, `start`, `live`, `research`, `agent`, `lernen`). Gedächtnis im localStorage-Schlüssel `appMode`. Die Route ist die Wahrheit, dieser Ref nur das Gedächtnis. Hinweis: die Liste `APP_MODES` in globals.js kennt `lernen` nicht — ein gespeichertes `lernen` fällt beim Neuladen auf `journal`, bis der Router-Hook den Modus aus der Route setzt. |
| `privacyMode` | `stores/ui.js` | Zensur-Modus, localStorage-Schlüssel `privacyMode` (`'1'`/`'0'`). |
| `currentUser` | `stores/settings.js` | Die Einstellungszeile (kein Benutzerobjekt). `null`/`undefined` solange nicht geladen. |
| `renderProfile` | `stores/settings.js` | importiert von Nav, aber unbenutzt. |
| `selectedBroker`, `brokers`, `selectedTradeCategory`, `BOT_BROKERS` | `stores/filters.js` | Börse (localStorage `selectedBroker`), Börsenliste (bitunix, bitget, pionex), Kategorie `futures`/`bot` (localStorage `selectedTradeCategory`), Börsen mit Bot-API (nur `pionex`). |
| `selectedDateRange`, `selectedPeriodRange`, `selectedGrossNet`, `selectedPositions`, `selectedMonth` | `stores/filters.js` | Journal-Filter (für Titel-Zusammenfassung und Export). |
| `filteredTradesTrades` | `stores/trades.js` | gefilterte Trades (Export). |
| `screenshots`, `selectedScreenshot`, `screenshot` | `stores/trades.js` | Vollbild-Screenshot-Popup. |
| `selectedScreenshotIndex` | `stores/ui.js` | Index im Screenshot-Karussell. |
| `getMore` | `stores/filters.js` | lädt gerade weitere Screenshots. |
| `aiReportGenerating`, `aiReportCountBefore`, `aiReportLabel` | `stores/settings.js` | KI-Bericht läuft / Anzahl Berichte vor dem Start / Bezeichnung des Zeitraums. |
| `testbetrieb`, `ladeSystemModus()` | `stores/system.js` | Testbetrieb-Flag aus `GET /api/system/modus`, einmal geladen. |
| `hydrateLiveSettings()` | `stores/live.js` | übernimmt Live-Analyse-Einstellungen aus den Settings. |

Hilfsfunktionen (`src/utils/utils.js`, sofern nicht anders genannt):
`usePageId()`, `useScreenType()`, `useInitParse()` (= `useInitApp()`: lädt
Einstellungen nach `currentUser`, spiegelt `startseiteAn` nach localStorage,
füllt die Trade-Zeitrahmen), `useGetTimeZone()`, `useGetPeriods()`,
`useSetValues()`, `useToggleMobileMenu()`, `useCloseMobileMenu()`,
`useInitTooltip()`, `useExport(format, start, ende, trades)`;
`useDateCalFormat` (`utils/formatters.js`); `useSelectedScreenshotFunction`
(`utils/screenshots`); `useUpdatePendingCounts`, `useStartGlobalPolling`,
`useStopGlobalPolling` (`utils/incoming.js`); `useGetAvailableTags`
(`utils/daily.js`); `requestNotificationPermission`, `sendNotification`
(`utils/notify`); `logWarn` (`utils/logger.js`); `ebeneAuf`, `ebeneZu`
(`composables/useZurueckGeste.js`); `useImVollbild`, `useIstTelefon`
(`utils/geraet.js`); `starteZensur` (`utils/privacy.js`); `setLocale` und
die i18n-Instanz (`src/i18n`).

**Wichtige DOM-Kopplung:** `useToggleMobileMenu()` und `useCloseMobileMenu()`
suchen das Element mit der **ID `sideMenu`** und schalten daran die Klasse
**`toggleSideMenu`** (diese Klasse schiebt das Handy-Menü ins Bild), und sie
setzen zusätzlich `sideMenuMobileOut`. Der Neubau muss entweder die ID und die
Klasse beibehalten oder die beiden Funktionen (sie liegen ausserhalb dieser
vier Dateien) auf rein reaktiven Zustand umstellen. Empfehlung: das Layout
leitet den Offen-Zustand aus `sideMenuMobileOut` ab und behält die ID
`sideMenu` trotzdem, damit die alten Funktionen nicht ins Leere greifen.
`useToggleMobileMenu()` wirft heute, wenn kein `#sideMenu` existiert.

### 0.3 Seiten- und Modus-Registry `src/config/menu.js`

Reines Datenmodul ohne Vue. (Wird laut Projektregel nur von der Sitzung
geändert, der es gehört.)

**PAGES** — je Seite: `id` (= Routenname = pageId), `mode`, `path`, `icon`
(heute Unicons-Klasse), `titleKey`, `group` (Gruppe im Seitenmenü; `null` =
kein Menüeintrag), optional `flag` (Einstellungsspalte, die die Seite
abschaltet), `nurDesktop`, `mobilFlag` (Einstellung, die eine Nur-Desktop-
Seite fürs Telefon freischaltet), `menuKey`/`menuIcon` (Beschriftung/Symbol
nur im Menü, abweichend vom Seitenkopf).

| id | mode | path | Gruppe | Besonderes |
|---|---|---|---|---|
| chart | start | /chart | – | Landeseite, kein Menüeintrag (Chart braucht die Breite) |
| dashboard | journal | /dashboard | analyze | |
| daily | journal | /daily | analyze | |
| calendar | journal | /calendar | analyze | |
| playbook | journal | /playbook | reflect | |
| auswertung | journal | /auswertung | reflect | |
| kiAgent | journal | /ki-coach | reflect | |
| screenshots | journal | /screenshots | reflect | |
| incoming | journal | /incoming | add | |
| addTrades | journal | /addTrades | add | |
| accounts | journal | /accounts | – | eigene Pille im Menü |
| addExcursions | journal | /addExcursions | – | |
| setup | journal | /setup | – | |
| marktradar | live | /marktradar | liveAnalyze | Startseite des Modus |
| nachrichten | live | /nachrichten | liveAnalyze | |
| openinterest | live | /openinterest | liveAnalyze | |
| liquidity | live | /liquidity | liveAnalyze | |
| liquidations | live | /liquidations | liveAnalyze | |
| livetrading | live | /livetrading | liveTrade | flag `livetradingAn`, nurDesktop, mobilFlag `livetradingMobil` |
| liveSessions | live | /live-sessions | liveTrade | flag `livetradingAn` |
| liveAuswertung | live | /live-auswertung | liveTrade | flag `livetradingAn` |
| hypeRadar | research | /hype-radar | hypeGruppe | menuKey `hype.tab_dashboard`, menuIcon dashboard |
| hypeFrueh | research | /hype-radar/fruehphase | hypeGruppe | titleKey `hype.tab_fruehphase` |
| hypeBoersen | research | /hype-radar/boersen | hypeGruppe | titleKey `hype.tab_boersen` |
| hypeBerichte | research | /hype-radar/berichte | hypeGruppe | titleKey `hype.tab_berichte` |
| coinRadar | research | /coin-radar | coinGruppe | menuKey `coinradar.tab_rangliste`, menuIcon list-ol-alt |
| coinVerlauf | research | /coin-radar/verlauf | coinGruppe | titleKey `coinradar.tab_verlauf` |
| coinAbverkauf | research | /coin-radar/abverkauf | coinGruppe | titleKey `coinradar.tab_abverkauf` |
| agentStrategies | agent | /agent/strategies | agentRun | |
| agentSetups | agent | /agent/setups | agentRun | |
| agentEditor | agent | /agent/editor | agentBuild | |
| agentBuilder | agent | /agent/builder | agentBuild | |
| agentPerformance | agent | /agent/performance | agentReview | |
| agentLab | agent | /agent/lab | agentReview | |
| coinRangliste | agent | /agent/rangliste | agentReview | |
| lernen | lernen | /lernen | lernenGruppe | |
| lernenKarten | lernen | /lernen/karten | lernenGruppe | titleKey `lernen.tabKarten` |
| lernenStatistik | lernen | /lernen/statistik | lernenGruppe | titleKey `lernen.tabStatistik` |
| settings | (null) | /settings | – | modusübergreifend |

Die `id`s `hypeFrueh`, `hypeBoersen`, `hypeBerichte`, `coinVerlauf`,
`coinAbverkauf`, `lernenKarten`, `lernenStatistik` sind **keine**
Routennamen — es sind Menüeinträge auf einer gemeinsamen Route mit
Parameter. Deshalb hebt das Menü nach Pfad hervor (siehe 2.4).

**MODES** (Reihenfolge = Reihenfolge in der Kopfleiste): `journal`
(home /dashboard, kein Flag — nie abschaltbar), `start` (home /chart, Flag
`startseiteAn`), `live` (home /marktradar, Flag `modusLiveAn`, Kurzlabel),
`research` (home /hype-radar, Flag `modusResearchAn`), `agent`
(home /agent/strategies, Flag `modusStrategieAn`, `beta: true`, Kurzlabel),
`lernen` (home /lernen, Flag `modusLernenAn`). Jeder Modus hat `titleKey`
(`modes.<id>`), optional `shortKey`, `icon`, `enabled`.

Exporte: `PAGES`, `MODES`, `pageById(id)`, `pagesForMode(mode)` (nur Seiten
mit Gruppe), `modeHome(mode)` (Fallback `/dashboard`),
`istModusAn(modeId, einstellungen)` (fehlender Wert gilt als **an** —
„Unwissen ist kein Nein": sonst bräuchte jeder Deep-Link eine Wartezeit, und
ein langsamer Einstellungsabruf läse sich als „abgeschaltet"),
`ersterAktiverModus(einstellungen)` (erster eingeschalteter Modus in
Leisten-Reihenfolge, sonst `journal`).

### 0.4 Rahmen-Komponenten, die bleiben

- `components/rahmen/Kopfleiste.vue` — klebt oben (Höhe `--kopf-hoehe`),
  Logo links (Link auf `/start`), die eingeschalteten Modi als Links auf
  `modeHome(id)` mit Akzent-Unterstrich am aktiven Modus (auf `/start` ist
  keiner aktiv), Beta-Marke am Agent-Modus, rechts im Testbetrieb eine
  Warn-Pille und der Einstellungs-Knopf (Link `/settings`, hervorgehoben bei
  `pageId === 'settings'`). Ein Klick auf den bereits aktiven Modus tut nichts;
  sonst wird `appMode` + localStorage gesetzt und der Link lädt die Seite
  **voll** neu — damit offene WebSockets und Timer der Live-Ansichten sicher
  enden. Am Telefon: Logo und Einstellungen oben, die Modi als wischbare Zeile
  darunter, Kurzlabels.
- `components/rahmen/TestbetriebBanner.vue` — nicht wegklickbarer Streifen
  bei `testbetrieb`.
- `components/ModeSwitcher.vue` existiert noch, wird aber **nirgends mehr
  eingebunden** (abgelöst durch die Kopfleiste).

---

## 1. Router (`src/router/index.js`)

### 1.1 Grundlagen

- HTML5-History mit `import.meta.env.BASE_URL` als Basis.
- Alle Views werden lazy geladen (dynamischer Import je Route).
- Die Layout-Komponente `layouts/Dashboard.vue` wird **statisch** importiert
  und als `meta.layout` an die Routen gehängt.
- Kein `scrollBehavior`, kein `afterEach`, **keine Catch-all-Route** (eine
  unbekannte Adresse rendert heute eine leere Seite ohne Layout — siehe
  Empfehlung 1.5).

### 1.2 Meta-Felder

| Feld | Bedeutung |
|---|---|
| `title` | deutscher/englischer Rohtitel, Rückfall für den Dokumenttitel |
| `titleKey` | i18n-Schlüssel des Seitentitels (gewinnt vor `title`) |
| `layout` | Layout-Komponente (fehlt bei `/setup` und `/update-assistent` → kein Layout) |
| `mode` | Modus der Route. Fehlt das Feld, gehört die Route zum Journal. Sonderwerte: `any` (modusneutral, ändert den Modus nicht), `uebersicht` (Startseite, gehört keinem Modus, lässt ihn stehen) |
| `ohneSeitenmenue` | Layout zeigt weder Seitenmenü noch Titelzeile (die Seite bringt beides selbst mit) |
| `skipSetupCheck` | Route wird nicht zum Setup umgeleitet |
| `skipUpdateCheck` | Route wird nicht zum Update-Assistenten umgeleitet |

### 1.3 Routentabelle

| Pfad | Name | View (lazy) | meta.mode | weitere meta | Bemerkung |
|---|---|---|---|---|---|
| `/` | – | – | – | – | **Redirect-Funktion:** liest synchron localStorage `startseiteAn`; ist es `'0'` → `/dashboard`, sonst → `/chart`. Der Wert wird beim App-Start aus den Einstellungen gespiegelt, damit hier ohne Warten entschieden werden kann. |
| `/chart` | `chart` | `views/Chart.vue` | `start` | titleKey `nav.chart`, layout | Chart-Arbeitsplatz; Layout lädt hier **keine** Journal-Daten |
| `/start` | `start` | `views/Start.vue` | `uebersicht` | titleKey `app.startTitel`, title „AutarkTrade", `ohneSeitenmenue`, layout | Logo + Modus-Kacheln; Ziel des Logos in der Kopfleiste |
| `/startseite` | – | – | – | – | Redirect → `/chart` (alte Lesezeichen) |
| `/setup` | `setup` | `views/Setup.vue` | – | titleKey `nav.setup`, `skipSetupCheck`, **kein layout** | |
| `/update-assistent` | `updateAssistent` | `views/UpdateAssistent.vue` | – | titleKey `onboarding.title`, `skipSetupCheck`, `skipUpdateCheck`, **kein layout** | liest Query `kontext`, `rueckkehr` |
| `/dashboard` | `dashboard` | `views/Dashboard.vue` | (journal) | titleKey `nav.dashboard` | |
| `/accounts` | `accounts` | `views/Accounts.vue` | (journal) | titleKey `nav.accounts` | |
| `/calendar` | `calendar` | `views/Calendar.vue` | (journal) | titleKey `nav.calendar` | |
| `/daily` | `daily` | `views/Daily.vue` | (journal) | titleKey `nav.dailyView` | |
| `/incoming` | `incoming` | `views/Incoming.vue` | (journal) | titleKey `nav.pendingTrades` | |
| `/diary` | – | – | – | – | Redirect → `/incoming` |
| `/screenshots` | `screenshots` | `views/Screenshots.vue` | (journal) | titleKey `nav.screenshots` | |
| `/lernen/:reiter?` | `lernen` | `views/Lernen.vue` | `lernen` | titleKey `nav.lernen` | ein Routeneintrag für Sitzung/Karten/Statistik, damit eine laufende Lernsitzung den Wechsel überlebt |
| `/playbook` | `playbook` | `views/Playbook.vue` | (journal) | titleKey `nav.playbook` | |
| `/auswertung` | `auswertung` | `views/Auswertung.vue` | (journal) | titleKey `nav.evaluation` | |
| `/live-sessions` | `liveSessions` | `views/LiveSessions.vue` | `live` | titleKey `nav.liveSessions` | |
| `/live-auswertung` | `liveAuswertung` | `views/LiveAuswertung.vue` | `live` | titleKey `nav.liveAuswertung` | |
| `/ki-coach` | `kiAgent` | `views/KiAgent.vue` | (journal) | titleKey `nav.kiAgent` | liest Query `tab`, `sourcePage`, `agentPrompt` |
| `/addTrades` | `addTrades` | `views/AddTrades.vue` | (journal) | titleKey `nav.manualImport` | |
| `/addDiary` | – | – | – | – | Redirect → `/incoming` |
| `/addPlaybook` | – | – | – | – | Redirect → `/daily` |
| `/addScreenshot` | – | – | – | – | Redirect → `/screenshots` |
| `/addExcursions` | `addExcursions` | `views/AddExcursions.vue` | (journal) | titleKey `nav.addExcursions` | |
| `/settings` | `settings` | `views/Settings.vue` | `any` | titleKey `nav.settings` | aus jedem Modus erreichbar, wechselt ihn nicht — **wird erweitert, siehe Abschnitt 6** |
| `/liquidity` | `liquidity` | `views/Liquidity.vue` | `live` | titleKey `nav.liquidity` | Bookmap |
| `/liquidations` | `liquidations` | `views/Liquidations.vue` | `live` | titleKey `nav.liquidations` | |
| `/openinterest` | `openinterest` | `views/OpenInterest.vue` | `live` | titleKey `nav.openInterest` | |
| `/hype-radar/:reiter?` | `hypeRadar` | `views/HypeRadar.vue` | `research` | titleKey `nav.hypeRadar` | Parameter statt zweiter Route: die Seite wird beim Wechsel nicht neu aufgebaut, ein laufender Scan (SSE) und Filter/aufgeklappte Zeilen überleben. Werte: leer, `fruehphase`, `boersen`, `berichte` |
| `/coin-radar/:reiter?` | `coinRadar` | `views/CoinRadar.vue` | `research` | titleKey `nav.coinRadar` | dasselbe Muster; Werte: leer, `verlauf`, `abverkauf` |
| `/marktradar` | `marktradar` | `views/Marktradar.vue` | `live` | titleKey `nav.marktradar` | |
| `/livetrading` | `livetrading` | `views/Livetrading.vue` | `live` | titleKey `nav.livetrading` | Abschalt-Prüfung (`livetradingAn`) sitzt bewusst in der Seite, nicht im Router (Einstellungen beim kalten Deep-Link evtl. noch nicht geladen). Query `cockpit=1` siehe Layout |
| `/nachrichten` | `nachrichten` | `views/Nachrichten.vue` | `live` | titleKey `nav.nachrichten` | |
| `/agent/strategies` | `agentStrategies` | `views/AgentStrategies.vue` | `agent` | titleKey `nav.agentStrategies` | |
| `/agent/setups` | `agentSetups` | `views/AgentSetups.vue` | `agent` | titleKey `nav.agentSetups` | |
| `/agent/performance` | `agentPerformance` | `views/AgentPerformance.vue` | `agent` | titleKey `nav.agentPerformance` | |
| `/agent/editor` | `agentEditor` | `views/AgentEditor.vue` | `agent` | titleKey `nav.agentEditor` | |
| `/agent/builder` | `agentBuilder` | `views/AgentBuilder.vue` | `agent` | titleKey `nav.agentBuilder` | |
| `/agent/lab` | `agentLab` | `views/AgentLab.vue` | `agent` | titleKey `nav.agentLab` | |
| `/agent/rangliste` | `coinRangliste` | `views/CoinRangliste.vue` | `agent` | titleKey `nav.coinRangliste` | |
| `/imports` | – | – | – | – | Redirect → `/settings` |

Alle Routen mit „layout" in obiger Tabelle (alle ausser `/setup`,
`/update-assistent` und den Redirects) tragen `meta.layout = DashboardLayout`.
Die Rohtitel (`title`) sind zusätzlich zum `titleKey` vorhanden und dienen nur
als Rückfall.

### 1.4 `beforeEach`-Hook (in dieser Reihenfolge)

1. **Dokumenttitel:** Seitentitel = Übersetzung von `meta.titleKey` (über die
   globale i18n-Instanz), sonst `meta.title`. Dokumenttitel = „<Titel> ·
   AutarkTrade", ohne Titel nur „AutarkTrade". Wird **vor** allen Prüfungen
   gesetzt, also auch für Routen, die gleich umgeleitet werden.
2. **Setup-Prüfung überspringen**, wenn `meta.skipSetupCheck` → sofort
   weiter.
3. **Setup-/Update-Status** einmal pro Seitenlebensdauer (Modul-Cache) über
   `GET /api/setup/status` holen: Felder `setupComplete` und
   `updateAssistantPending`. Beide im selben Aufruf, damit beim Start kein
   zweiter Roundtrip entsteht. Schlägt der Aufruf fehl (z. B. alter Server
   ohne Endpunkt), gilt das Setup als abgeschlossen und kein Update-Assistent
   als ausstehend.
4. Setup nicht abgeschlossen → Umleitung auf `/setup`.
5. Update-Assistent ausstehend und Ziel ohne `skipUpdateCheck` → Umleitung auf
   `/update-assistent`. Der Assistent beendet sich mit einem **harten
   Reload**, wodurch der Cache neu geholt wird — deshalb braucht es keinen
   Schutz gegen eine Umleitungsschleife.
6. **Modus aus der Route ableiten** („die Route bestimmt den Modus, nicht
   umgekehrt" — ein Deep-Link auf `/liquidity` schaltet still auf `live`,
   damit das Seitenmenü schon beim ersten Zeichnen stimmt):
   gewünschter Modus = bisheriger `appMode`, wenn `meta.mode` `any` oder
   `uebersicht` ist; sonst `meta.mode`, und ohne `meta.mode` `journal`.
   Weicht er ab, `appMode` setzen und in localStorage `appMode` schreiben.
7. Weiter.

Der Router kennt **keine** Wache für abgeschaltete Modi — die sitzt bewusst im
Layout (Abschnitt 4.4).

### 1.5 Empfehlungen für den Neubau (keine Pflicht, aber angezeigt)

- Eine Catch-all-Route ergänzen (z. B. Umleitung auf `/`), damit eine
  unbekannte Adresse nicht weiss bleibt.
- `pageId` bei jeder Navigation aus `route.name` nachführen (z. B. im Layout
  per Watch auf die Route). Heute wird es nur beim Layout-Mount und auf
  `/start` gesetzt; nach einer SPA-Navigation (KI-Schnellknopf, router-link
  der Radar-Kacheln, `router.push('/settings')` aus Nachrichten) bleibt es
  stehen. Nav.vue umgeht das an einer Stelle bewusst mit `route.name`.

---

## 2. Seitenmenü (`src/components/SideMenu.vue`)

Keine Props, keine Events. Wird vom Layout nur gerendert, wenn weder Cockpit
noch Vollbild noch `meta.ohneSeitenmenue` gilt.

### 2.1 Aufbau von oben nach unten

1. **Nutzername** (Klasse `at-nutzer`): Avatar (`currentUser.avatar`, rund)
   und `currentUser.username` — nur wenn ein Nutzername existiert und das Menü
   nicht eingeklappt am Desktop steht. Das Logo steht in der Kopfleiste, nicht
   hier.
2. **Ein-/Ausklapp-Knopf** (Klasse `menuKlappe`, darin der Text mit Klasse
   `menuText`) — nur bei `screenType === 'computer'`. Ruft
   `schalteSideMenu()`. Symbol: Doppelpfeil nach rechts, wenn eingeklappt,
   sonst nach links. Tooltip `nav.menuAusklappen` bzw. `nav.menuEinklappen`;
   sichtbarer Text immer `nav.menuEinklappen`. Am Telefon gibt es ihn nicht
   (das Menü fährt dort ohnehin ganz weg).
3. **Menüblock** (Container mit ID `step2`, zusätzlich Klasse `menuSchmal`,
   wenn eingeklappt am Desktop). Inhalt je nach `appMode`, siehe 2.2.
4. **Verwaltung** (immer, in jedem Modus): Gruppenüberschrift `nav.manage`,
   Eintrag „Einstellungen" (`/settings`, hervorgehoben bei
   `pageId === 'settings'`, Unicons `uil-setting`), und — nur wenn das
   Passwort-Gate aktiv ist (`authEnabled` aus `GET /api/auth/status`) — ein
   Eintrag „Abmelden" (fest deutsch, kein i18n), der `POST /api/logout`
   aufruft und danach die Seite neu lädt (Fehler werden ignoriert).
5. **Fusszeile** (Klasse `sidebar-footer`, unten angeschlagen): Version
   „AutarkTrade <Version>" (`__APP_VERSION__` aus vite.config/package.json),
   Update- und Rollback-Bedienung (2.6).

### 2.2 Inhalt je Modus

Gruppen bestehen aus einem Block (Klasse `sideMenuDiv`, innen
`sideMenuDivContent`), einer Überschrift als `<label>` und Links (Klassen
`nav-link`, aktiv zusätzlich `activeNavCss`). Jeder Link trägt ein `title`
mit dem Seitennamen — im eingeklappten Zustand ist das die einzige
Beschriftung. Alle Einträge sind **gewöhnliche Links (voller Seitenaufruf)**.

**Journal-Menü** — wenn `appMode` `journal` **oder** `start` ist (von der
Landeseite will man direkt ins Journal springen können, ohne Modus-Wechsel).
Handgeschrieben, nicht aus der Registry; Reihenfolge:

1. *Börsen-Auswahl* (nur wenn mehr als eine Börse konfiguriert ist):
   Überschrift `nav.exchange`, je Börse eine Pille (Klasse `cat-pill`, aktiv
   `active`; Container `category-pills broker-pills`). Klick auf eine andere
   Börse: `selectedBroker` + localStorage setzen, Seite neu laden.
   „Konfiguriert" = `GET /api/<börse>/config` liefert `apiKey` oder
   `hasSecret`. Ist keine konfiguriert, erscheinen alle (frische Installation —
   sonst säße man fest). Die drei Abfragen laufen nur, wenn `appMode`
   `journal` oder `start` ist (im Live-Modus gespart).
2. *Kategorie und Filter* (Block ohne Überschrift; Container
   `category-pills`):
   - Pille „Kontoübersicht" (`nav.accountsOverview`, Symbol Geldbörse) als
     Link auf `/accounts` (Klassen `cat-pill acc-pill`), aktiv bei
     `pageId === 'accounts'`.
   - Pille „Futures" (fest, nicht übersetzt), aktiv wenn nicht auf Konten und
     Kategorie ≠ `bot`.
   - Pille „Bot" (fest), nur wenn die gewählte Börse in `BOT_BROKERS` steht;
     aktiv wenn nicht auf Konten und Kategorie = `bot`.
   - Klick auf Futures/Bot: gleiche Kategorie und nicht auf Konten → nichts.
     Sonst Kategorie + localStorage setzen; auf der Konten-Seite **voller
     Seitenaufruf auf `/dashboard`** (dort ist keine Trading-Kategorie aktiv,
     ein Klick muss zurück in die Trading-Ansicht führen, auch wenn die
     Kategorie gleich bleibt), sonst Seite neu laden.
   - Darunter die Komponente `SidebarFilters` (globales Filterpanel, keine
     Props).
3. *Analysieren* (`nav.analyze`): Dashboard (`/dashboard`, ID `step3`),
   Tagesansicht (`/daily`, ID `step4`), Kalender (`/calendar`, ID `step5`).
4. *Reflektieren* (`nav.reflect`): Playbook, Auswertung, KI-Coach
   (`/ki-coach`, nur wenn `currentUser.aiEnabled` weder `false` noch `0` ist),
   Screenshots (`/screenshots`, ID `step7`, Beschriftung fest „Screenshots").
5. *Hinzufügen* (`nav.add`): Pendente Trades (`/incoming`), Manueller Import
   (`/addTrades`).

Hervorhebung im Journal-Menü nach `pageId` (`pageId === <id>`).
Die IDs `step2…step7` stammen aus einer entfernten Tour; nichts im Code
greift mehr darauf zu (frei wählbar).

**Live-, Agent-, Entdecken- und Lernen-Menü** — datengetrieben aus der
Registry (`pagesForMode(mode)`), je `group` ein Block; Überschrift =
Übersetzung von `nav.<group>`; Eintrag = Link auf `page.path`, Beschriftung
und Tooltip `menuKey` sonst `titleKey`, Symbol `menuIcon` sonst `icon`.

- `appMode === 'live'`: Gruppen `liveAnalyze`, `liveTrade`. Zusätzlich darunter
  ein Block mit `LiveSymbolPicker` (Prop `variant`), wenn die Seite einen
  Symbolwähler braucht: `pageId` `liquidity` → `'bookmap'`, `liquidations` →
  `'levmap'`, `openinterest` → `'oi'`, sonst kein Block. Alle drei teilen sich
  denselben Symbolblock, damit ein Symbolwechsel überall gilt. (Der Block
  enthält die Klasse `livePicker` — eingeklappt wird er ausgeblendet.)
- `appMode === 'agent'`: Gruppen `agentRun`, `agentBuild`, `agentReview`.
- `appMode === 'research'`: Gruppen `hypeGruppe`, `coinGruppe`. (Früher ohne
  Menü; mit zwei Seiten liesse sich sonst nur über die Adresszeile wechseln.)
- `appMode === 'lernen'`: Gruppe `lernenGruppe`.

Filterregeln beim Aufbau der Gruppen:

- Ist der **ganze Modus** abgeschaltet (`istModusAn` false), gibt es gar keine
  Gruppen — sonst rendert das Menü Einträge eines Modus, den die Kopfleiste
  nicht mehr anbietet.
- Seiten mit `flag`: ausgeblendet nur, wenn der Wert in `currentUser`
  ausdrücklich `0` ist. Fehlender Wert (Einstellungen noch nicht geladen,
  frische DB) = an, sonst verschwände der Eintrag kurz und käme wieder.
- Seiten mit `nurDesktop`: ausgeblendet, wenn `useIstTelefon()` true ist
  (gemessene Breite < 992 px **und** grober Zeiger) — es sei denn, `mobilFlag`
  ist in den Einstellungen ausdrücklich `1`. Bewusst **nicht** an
  `screenType`: das misst nur die Breite, und ein Desktop-Browser im schmalen
  Fenster soll seine Einträge behalten.
- Für `appMode === 'start'` wird das Journal-Menü gezeigt (s. o.); andere,
  unbekannte Modi zeigen nur Verwaltung und Fusszeile.

### 2.3 Zähler / Badges

Das Seitenmenü zeigt **keine** Zähler (auch keine Pending-Counts). Die
Pending-Bewertungen laufen über das Layout (Polling) und `TradeEvalPopup`.

### 2.4 Hervorhebung (datengetriebene Menüs)

Ein Eintrag ist aktiv, wenn der aktuelle Routen-**Pfad** genau `page.path`
ist. Ist der Pfad einer der Registry-Pfade, ist sonst keiner aktiv. Nur wenn
der Pfad im Menü unbekannt ist (Unterseite ohne eigenen Eintrag), fällt die
Entscheidung auf `pageId === page.id` zurück — sonst stünde man in einem Menü
ganz ohne Markierung. Grund für den Pfad: zwei Einträge teilen sich einen
Routennamen (`/hype-radar` und `/hype-radar/berichte`); über `pageId` wären
beide aktiv.

### 2.5 Eingeklappter Zustand (nur Desktop)

Steuerung über `sideMenuEingeklappt`. Wirkung (heute über CSS in
style-dark.css, Klassen `sideMenuSchmal` am Menü-Container und `menuSchmal`
am Menüblock):

- Menüspalte schrumpft auf eine schmale feste Breite (64 px), Inhalt rechts
  daneben nimmt den ganzen Rest (`inhaltNebenSchmal`).
- Ausgeblendet: Gruppenüberschriften, alle Pillen-Blöcke (Börse, Kategorie +
  Filter), der Live-Symbolwähler, die Fusszeile, der Text des
  Klapp-Knopfes, der Nutzername.
- Links zeigen nur noch ihr Symbol, zentriert und etwas grösser; der Name
  steht im Tooltip (`title`).

### 2.6 Update und Rollback (Fusszeile)

- Beim Mount: `GET /api/update/check` (Felder `isDocker`, `ok`,
  `updateAvailable`, `localVersion`, `remoteVersion`, `releaseNotes`,
  `releaseUrl`), `GET /api/update/rollback-status` (Feld `available`),
  `GET /api/auth/status` (Feld `authEnabled`). Fehler still schlucken.
- Update verfügbar **und Docker**: Link „Update v<remote>" auf
  `releaseUrl` (Rückfall: Releases-Seite `github.com/Mouses007/AutarkTrade`,
  neues Fenster, `noopener`), Tooltip erklärt, dass Watchtower automatisch
  installiert.
- Update verfügbar, **kein Docker**, nicht gerade installierend:
  Klick-Eintrag „Update v<remote>" mit pulsierender Hervorhebung. Klick:
  Bestätigungsdialog (Browser-`confirm`) mit Versionssprung
  „v<lokal> → v<remote>", optional `nav.changes` + Release-Notes,
  `nav.updateBackupWarning`, `nav.updateBackupPath`, `nav.updateConfirm`.
  Bei Ja: frisches Einmal-Token holen (`GET /api/update/check?force=1`, Feld
  `confirmToken` — destruktive Aktionen verlangen Token + localhost), dann
  `POST /api/update/install` mit dem Token. Bei `ok`: nach 4 s (Docker-Modus:
  8 s) beginnt ein Warten, das `/api/update/check` (ohne Cache) alle 1,5 s
  anfragt, bis der Server antwortet, dann Neuladen; nach 90 s wird trotzdem
  neu geladen.
- Während der Installation: Spinner + `nav.installing`.
- Rollback verfügbar und nicht laufend: Eintrag „Rollback" (fest). Klick:
  `confirm(nav.rollbackConfirm)`, Token holen, `POST /api/update/rollback`;
  bei `ok` nach 5 s neu laden. Während: Spinner + `nav.rollback`.
- Fehlertext (Server-`error` oder Ausnahmetext) in einer kleinen roten Zeile;
  der jeweilige Laufzustand wird zurückgesetzt.

### 2.7 Weitere Seiteneffekte beim Mount

- **Migration der Kategorie:** Steht in `selectedTradeCategory` `all`,
  `agent` oder nichts, wird `futures` gesetzt und gespeichert („Alle" und die
  Agent-Pille gibt es nicht mehr; man säße sonst unsichtbar fest).

### 2.8 Altlasten (nicht nachbauen)

- Eine Funktion für `<select>`-Börsenwechsel und eine „Logo-Klick"-Funktion
  (Ziel `/chart` bzw. `/dashboard`, am Telefon Menü schliessen) sind
  definiert, aber im Template nicht mehr verwendet.

---

## 3. Titelzeile (`src/components/Nav.vue`)

Keine Props, keine Events. Wird vom Layout nur gerendert, wenn weder Cockpit
noch Vollbild noch `meta.ohneSeitenmenue` gilt. Die Modi stehen nicht hier,
sondern in der Kopfleiste.

### 3.1 Linke Seite: Seitentitel

- **Titel der aktuellen Seite**: bestimmt über `pageId`. Quelle der Reihe nach:
  Registry-Eintrag (`pageById(pageId)` → Übersetzung von `titleKey`), sonst
  `route.meta.titleKey`, sonst `route.meta.title`, sonst leer. Darf nie
  werfen — jede Seite, die nirgends eingetragen ist, muss trotzdem rendern.
  (Der Altcode hält zusätzlich eine lokale Liste mit Journal-Seiten und Icons;
  sie liefert dieselben Titel wie die Registry, plus einen toten Eintrag
  `imports` → `settings.imports`. Das Symbol wird **nicht** angezeigt.)
- **Filter-Zusammenfassung** (Klasse `nav-filter-info`) neben dem Titel, nur
  auf `dashboard`, `daily`, `calendar`, `screenshots`, `auswertung`. Teile,
  mit „ · " verbunden, leere ausgelassen:
  1. Zeitraum: auf `dashboard`/`auswertung` die Beschriftung des gewählten
     Zeitraums (`selectedPeriodRange.label`); auf `daily`/`calendar` der
     gewählte Monat (`selectedMonth.start` als Unix-Sekunden) als „Monat
     (kurz) Jahr" über das projekteigene dayjs.
  2. Brutto/Netto: `options.gross` bzw. `options.net` je nach
     `selectedGrossNet`.
  3. Position: nur wenn genau eine Seite gewählt ist → „Long" bzw. „Short"
     (fest).
- **Desktop** (`screenType` ≠ `mobile`): Titel als Überschrift erster Ordnung
  (Klasse `seitentitel`), Zusammenfassung daneben.
- **Telefon**: Titel und Zusammenfassung sitzen in einem antippbaren Element
  (Klasse `mobile-menu-toggle`) mit Menü-Symbol (`Symbol name="menue"`)
  davor; Antippen ruft `useToggleMobileMenu()`. Die Zusammenfassung bricht auf
  eine eigene Zeile um.

### 3.2 Rechte Seite: Knöpfe (rechtsbündig, kleiner Abstand)

1. **Zensur-Modus** — nur bei `appMode === 'journal'`. Umschalter für
   `privacyMode` (auch in localStorage `privacyMode` speichern). Symbol
   `auge` (aus) bzw. `augeAus` (an), Tooltip `nav.hideNumbers` /
   `nav.showNumbers`. Aktiv in Akzentfarbe gefüllt. Zweck: Kontostände und
   Zahlen für Screenshots/Screenshares unkenntlich machen.
2. **KI-Schnellzugriff** — nur wenn KI aktiv ist (`currentUser.aiEnabled`
   weder `false` noch `0`) **und** `route.name` nicht `kiAgent` ist. Hier
   bewusst `route.name` statt `pageId`, weil `pageId` bei SPA-Navigation
   hinterherhinkt. Symbol `ki`, Tooltip `nav.kiAgent`. Klick: SPA-Navigation
   nach `/ki-coach` mit Query `tab=agent` und `sourcePage=<pageId>` (der
   KI-Coach öffnet den Chat-Reiter und gibt die Herkunftsseite als Kontext an
   den Server). Zweck: eine Frage an den Agenten ohne Umweg über das Menü.
3. **Export** — nur auf `pageId === 'dashboard'`. Ausklappmenü
   „Export" mit den Einträgen „JSON" und „CSV" (fest). Auswahl ruft
   `useExport(<format>, useDateCalFormat(selectedDateRange.start),
   useDateCalFormat(selectedDateRange.end), filteredTradesTrades)`.
   Heute ein Bootstrap-Dropdown (`data-bs-toggle="dropdown"`).

Beide Symbolknöpfe (1, 2) teilen sich eine Optik (Klasse `privacy-toggle`):
kleiner quadratischer Knopf, Rand in Linienfarbe, Fläche `--panel-soft`,
Schrift `--muted`; Hover Text `--text` und Rand `--accent-rand`; aktiv
Fläche/Rand `--accent`, Schrift `--on-accent`.

### 3.3 Seiteneffekt beim Mount

- `useInitTooltip()` — initialisiert **alle** Bootstrap-Tooltips
  (`data-bs-toggle="tooltip"`) im Dokument. Davon hängen u. a. die
  Info-Symbole auf dem Journal-Dashboard ab. Die Funktion ist nicht
  idempotent (jeder Aufruf stapelt Instanzen). Wenn der Neubau ohne Bootstrap
  auskommt, muss diese Initialisierung an anderer Stelle (oder der Ersatz der
  Tooltips) sichergestellt sein.

### 3.4 Gestaltung

Transparente Zeile ohne Unterlinie über dem Inhalt, Innenabstand oben grösser
als unten, seitlich mitwachsend; Seitentitel gross, fett, leicht enger
Buchstabenabstand, Farbe `--text` (am Telefon kleiner). Heute trägt das
Element die Bootstrap-Klasse `navbar` und die eigene `at-titelzeile`; die
`navbar`-Regeln aus style-dark.css (feste Höhe, Abstand nach oben) werden
dabei überstimmt — der Neubau sollte `navbar` nicht verwenden.

---

## 4. Layout (`src/layouts/Dashboard.vue`)

Wird als `meta.layout` gesetzt und umhüllt jede Seite (Slot). Keine Props.

### 4.1 Abgeleitete Zustände

- **isJournal**: `route.meta.mode` fehlt, ist `journal` oder `any`. Nur dann
  läuft der Journal-Ballast (Perioden, Tags, Pending-Counts, Popups,
  KI-Bericht-Polling). Der Chart (`start`), `/start` (`uebersicht`), Live,
  Entdecken, Agent und Lernen brauchen keine Trade-Daten. Achtung: die
  Einstellungen (`any`) zählen als Journal.
- **isAgent**: `route.meta.mode === 'agent'`.
- **istCockpit**: Query `cockpit` ist `'1'`. Das Live-Trading-Fenster in
  einem eigenen Browserfenster: Seitenmenü und Titelzeile fallen weg (sie
  wären dort nur Wege zurück ins Journal — genau die Ablenkung, gegen die eine
  Handelssitzung mit festem Plan gedacht ist), der Inhalt bekommt die volle
  Breite. Bewusst an der URL und nicht an einer Einstellung, damit das
  Fenster neu laden kann und Cockpit bleibt.
- **imVollbild**: aus `useImVollbild()` (Fullscreen-API **und** F11-Vollbild
  über Fenster-/Bildschirmhöhe, nicht auf Touch/Standalone).
- **chromeAus** = Cockpit oder Vollbild. Vollbild räumt dieselbe Umgebung weg
  wie das Cockpit: wer Vollbild drückt, will die Fläche — ein Seitenmenü, das
  als Einziges stehen bliebe, ist genau der Rand, den man loswerden wollte.
  Der Weg zurück bleibt offen (Esc; das Live-Fenster hat einen eigenen Knopf).
- **ohneSeitenmenue** = `route.meta.ohneSeitenmenue`.

### 4.2 Aufbau (von oben)

1. `ReturnToTopButton` (immer; erscheint selbst erst nach Scrollen).
2. `Kopfleiste` — nur wenn nicht `chromeAus`.
3. `TestbetriebBanner` (immer eingebunden; zeigt sich nur im Testbetrieb —
   also auch im Cockpit/Vollbild).
4. Rahmen-Container (Klasse `at-rahmen`, mit `v-cloak`), randlos, als Zeile
   mit zwei Spalten:
   - **Menüspalte** (ID `sideMenu`), nur wenn weder `chromeAus` noch
     `ohneSeitenmenue`. Mindestens Bildschirmhöhe. Desktop
     (`screenType === 'computer'`): Klasse `sideMenu`, dazu entweder
     `sideMenuSchmal` (eingeklappt) oder eine Breite von 2/12. Telefon: Klasse
     `sideMenuMobile` (festes, von links einfahrendes Panel über dem Inhalt,
     über der Kopfleiste, unter Bootstrap-Modals; ausgefahren über die Klasse
     `toggleSideMenu`, siehe 0.2). Inhalt: `SideMenu`.
   - **Inhaltsspalte** (relativ positioniert): volle Breite, wenn
     `chromeAus` oder `ohneSeitenmenue`; neben eingeklapptem Desktop-Menü der
     ganze Rest (Klasse `inhaltNebenSchmal`); sonst volle Breite am Telefon und
     10/12 ab „large". Darin:
     - **Abdunkelung** (Klasse `sideMenuMobileOut`), sichtbar solange
       `sideMenuMobileOut` true; Antippen ruft `useCloseMobileMenu()`
       (Tippen neben das ausgefahrene Menü schliesst es).
     - `Nav` — nur wenn weder `chromeAus` noch `ohneSeitenmenue`.
     - `<main>` (Referenz für die Zensur): bei `isAgent` zuerst ein Block mit
       rechtsbündigem `PageInfo` (Prop `section="info.agent"`) und darunter
       `BetaHinweis`, in derselben Breite wie der Seiteninhalt der
       Agent-Seiten (11/12 ab „xl"). Begründung: der Agent-Modus handelt
       selbstständig, die Warnung gehört auf **jede** seiner Seiten, auch bei
       Direktlink ins Labor; die Anleitung hängt am Layout, damit sie
       erreichbar bleibt, auch wenn der Beta-Hinweis für die Sitzung
       weggeklickt wurde (BetaHinweis merkt sich das in sessionStorage).
       Danach der Slot (die Seite).
5. **Vollbild-Screenshot-Popup** — Bootstrap-Modal mit der festen ID
   **`fullScreenModal`** (Vollbild-Dialog). Wird von aussen geöffnet:
   `components/Screenshot.vue` und `views/Daily.vue` verweisen per
   `data-bs-target="#fullScreenModal"` darauf und setzen vorher über
   `useSelectedScreenshotFunction(index, quelle, daten)` die Auswahl.
   Inhalt: `Screenshot` (Props `index = selectedScreenshotIndex`,
   `source = "fullScreen"`, `screenshot-data = selectedScreenshot`), nur
   wenn `selectedScreenshot` nicht leer ist. Fuss: links „zurück" (nur wenn
   Index − 1 ≥ 0) ruft `useSelectedScreenshotFunction(index − 1,
   'fullScreen')`; rechts „weiter" (nur wenn Index + 1 > 0 und
   `screenshots[index + 1]` existiert) ruft dasselbe mit index + 1, ist
   während `getMore` gesperrt und zeigt dann einen Spinner. Pfeile heute als
   Font-Awesome-Chevrons.
   **Konflikt für S9:** wird Bootstrap entfernt, müssen Screenshot.vue und
   Daily.vue mitgezogen werden (oder das Modal bleibt bis dahin
   Bootstrap-kompatibel unter dieser ID).
6. `TradeEvalPopup` — nur bei `isJournal` (keine Props; zeigt sich selbst,
   wenn Pending-Counts > 0 und die Einstellung es erlaubt).

### 4.3 Initialisierung vor dem Mount (in dieser Reihenfolge)

1. `usePageId()` — `pageId` = aktueller Routenname.
2. `ladeSystemModus()` — Testbetrieb-Flag, ohne zu warten.
3. `useInitParse()` abwarten — Einstellungen laden (`currentUser`).
4. Sprache aus den Einstellungen übernehmen: `setLocale(currentUser.language
   || 'de')` abwarten (nur Deutsch liegt im Start-Bundle, andere Sprachen
   werden nachgeladen).
5. `useGetTimeZone()`, `useScreenType()`.
6. `hydrateLiveSettings()` — auch im Journal, weil die Einstellungsseite die
   Live-Werte zeigt.
7. **Ab hier nur bei isJournal:**
   - `useGetPeriods()` und `useSetValues()` abwarten.
   - `useGetAvailableTags()` abwarten (für das Bewertungs-Popup).
   - Ist `currentUser.browserNotifications` nicht `0`:
     `requestNotificationPermission()`.
   - Ist `currentUser.showTradePopups` nicht `0`: `useUpdatePendingCounts()`
     abwarten, danach `useStartGlobalPolling()`. Muss nach dem Laden der
     Einstellungen laufen, damit die Popup-Einstellung greift;
     `TradeEvalPopup` reagiert auf die Zähler.

### 4.4 Wache für abgeschaltete Modi

Beobachtet `currentUser` **und** `route.fullPath`, sofort beim Start:

- Solange `currentUser` leer ist: nichts tun (beim kalten Deep-Link sind die
  Einstellungen noch nicht da; ein Router-Guard müsste raten und würde falsch
  raten — jeder Aufruf von /marktradar landete bei langsamem Abruf im
  Journal).
- Route ohne Modus, `any` oder `journal`: immer erreichbar.
- Ist der Modus der Route eingeschaltet (`istModusAn`): nichts.
- Sonst: `router.replace(modeHome(ersterAktiverModus(currentUser)))`.

Begründung des Ortes: das Layout hängt an jeder Route; fünf Kopien in fünf
Views liefen auseinander. Beide Quellen werden gebraucht — die Einstellungen
treffen verspätet ein (Deep-Link), und eine Navigation innerhalb der App
(Zurück, altes Lesezeichen) passiert, wenn die Einstellungen längst da sind.
Das Seiten-Flag `livetradingAn` prüft weiterhin `Livetrading.vue` selbst.
Hinweis: `meta.mode === 'uebersicht'` (`/start`) wird hier als Modus geprüft;
`istModusAn` kennt ihn nicht und gibt true zurück.

### 4.5 Zensur-/Datenschutz-Modus

- An, wenn `privacyMode` true **und** `appMode === 'journal'` **und** das
  `<main>`-Element existiert. Nur im Journal — im Live-Modus wären
  verwischte Kurse sinnlos.
- Beim Einschalten `starteZensur(<main>)` aufrufen und die zurückgegebene
  Stopp-Funktion merken; beim Ausschalten diese aufrufen. Neu bewertet bei
  Änderung von `privacyMode` oder `appMode`, beim Mount, und beim Unmount
  wird gestoppt. (`starteZensur` markiert Zahlen-Blätter mit der Klasse
  `tj-censor`, setzt am `body` die Klasse `privacy-on` und beobachtet
  Re-Renders; die Optik liegt heute in style-dark.css.)

### 4.6 Zeiträume bei Rückkehr auffrischen

Bei `visibilitychange` (nur wenn sichtbar) und bei Fenster-`focus`: nur bei
isJournal `useGetPeriods()` + `useSetValues()` neu ausführen, damit ein
Monatswechsel, während der Tab verborgen war, erkannt wird. Fehler nur als
Warnung loggen. Listener beim Unmount entfernen.

### 4.7 Zurück-Geste und Handy-Menü

Wird `sideMenuMobileOut` true → `ebeneAuf(useCloseMobileMenu)`; wird es
false → `ebeneZu(useCloseMobileMenu)`. Damit schliesst die Zurück-Geste
(Android-Knopf, Wischen vom Rand) das ausgefahrene Menü, statt die Seite zu
verlassen. Am Desktop fährt das Menü nie aus, die Logik läuft dort nie an.
Wichtig: **dieselbe** Funktionsreferenz an beide Aufrufe übergeben (der
Ebenen-Stapel vergleicht Referenzen).

### 4.8 KI-Bericht-Benachrichtigung

Beobachtet `aiReportGenerating` **und** `pageId` (damit das Polling auch
startet, wenn man erst nach dem Start des Berichts die Seite wechselt):

- Läuft ein Bericht, ist isJournal, ist man **nicht** auf `kiAgent` und ist KI
  aktiv (`aiEnabled` weder `false` noch `0`): falls noch kein Polling läuft,
  alle 5 s `GET /api/ai/reports`. Ist die Anzahl grösser als
  `aiReportCountBefore`: `sendNotification('kiBerichtFertig',
  notifications.reportReady, notifications.reportCreated mit {label:
  aiReportLabel oder „Zeitraum"})`, `aiReportGenerating` auf false, Polling
  beenden. Fehler höchstens alle 15 s als Warnung loggen (kein
  Konsolen-Spam bei kurzen Ausfällen).
- Läuft kein Bericht mehr und ein Polling ist aktiv: beenden.
- (Die Benachrichtigung selbst entscheidet: Berechtigung, Tab nicht im Fokus,
  Hauptschalter, Kanal je Ereignis.)

### 4.9 Unmount

`useStopGlobalPolling()`, Zensur stoppen, Fokus-/Sichtbarkeits-Listener
entfernen. (Das KI-Polling-Intervall wird beim Unmount heute nicht
abgeräumt — der Neubau sollte es mit aufräumen.)

### 4.10 Was das Layout heute **nicht** tut

- Kein Resize-Listener für `screenType` (einmal beim Mount gemessen).
- `pageId` wird nicht bei SPA-Navigation nachgeführt (siehe 1.5).
- Kein eigenes Polling ausser KI-Bericht; das Pending-Polling startet es nur.

---

## 5. Klassen und IDs, auf die andere Dateien oder CSS zugreifen

| Name | Art | Wer greift zu |
|---|---|---|
| `sideMenu` | ID **und** Klasse | ID: `utils.js` (Toggle/Close Handy-Menü). Klasse: style-dark.css, rahmen.css (Menüspalte Desktop: Panel-Fläche, rechte Linie, klebt unter der Kopfleiste, scrollt in sich) |
| `toggleSideMenu` | Klasse | gesetzt von `utils.js`, Optik in style-dark.css (Handy-Menü eingefahren) |
| `sideMenuMobile` | Klasse | style-dark.css, rahmen.css (fixes Panel links, über allem ausser Modals, Breite ~260 px, Schatten, volle dynamische Höhe, eingefahren durch negativen Rand mit Übergang) |
| `sideMenuMobileOut` | Klasse (gleichnamig wie der Store) | style-dark.css (volle Fläche, halbtransparent schwarz, unter dem Menü) |
| `sideMenuSchmal`, `menuSchmal`, `inhaltNebenSchmal`, `menuText` | Klassen | style-dark.css (eingeklappter Zustand, 2.5) |
| `sideMenuDiv`, `sideMenuDivContent` | Klassen | style-dark.css, rahmen.css (Gruppenblock mit Unterlinie; Überschrift klein, fett, gesperrt, Grossbuchstaben, Farbe `--leise`; Links `--muted`, Hover `--panel-soft`/`--text`, Radius `--radius-knopf`) |
| `activeNavCss` | Klasse | rahmen.css (aktiver Eintrag: Fläche `--accent-flaeche`, Text `--text`, Symbol `--accent`, Akzentstrich links) |
| `nav-link` | Bootstrap-Klasse | rahmen.css, style-dark.css |
| `menuKlappe` | Klasse | style-dark.css, rahmen.css |
| `cat-pill`, `acc-pill`, `category-pills`, `broker-pills` | Klassen | rahmen.css (Pillen rund, Rand `--line-stark`, aktiv `--accent-flaeche`/`--accent-rand`/`--accent`), style-dark.css (blendet `category-pills` eingeklappt aus); `cat-pill` wird **auch** in `LiveSymbolPicker.vue` benutzt |
| `livePicker` | Klasse (in LiveSymbolPicker) | style-dark.css blendet den Block eingeklappt aus |
| `sidebar-footer` | Klasse | style-dark.css (eingeklappt ausblenden) |
| `at-rahmen` | Klasse | rahmen.css (Innenabstand von `<main>`) |
| `fullScreenModal` | ID | `Screenshot.vue`, `Daily.vue` |
| `mobile-menu-toggle`, `nav-filter-info` | Klassen | style-dark.css (Handy-Umbruch, kleine gedämpfte Schrift) |
| `tj-censor`, `privacy-on` | Klassen | gesetzt von `privacy.js`, Optik in style-dark.css |
| `step2`–`step7` | IDs | niemand mehr (Tour entfernt) |

Der Neubau darf die Optik aus style-dark.css/rahmen.css in die eigenen
Komponenten holen (beide Dateien sollen in S9 wegfallen), muss dann aber die
Kopplungen an `utils.js`, `privacy.js`, `LiveSymbolPicker.vue`,
`Screenshot.vue` und `Daily.vue` erhalten oder mitziehen.

---

## 6. Ergänzung: Einstellungen mit Unterseiten

### 6.1 Neue Anforderung

- Route **`/settings/:bereich?`**, Name **`settings`**, `meta.mode = 'any'`,
  titleKey `nav.settings`, Layout wie bisher.
- Bereiche: `allgemein`, `journal`, `ki`, `live`, `benachrichtigungen`,
  `lizenz` (neu, Einhängepunkt für S10), `rechtliches` (neu, Einhängepunkt
  für S10).
- Ohne Parameter → `allgemein`. Ein unbekannter Parameter sollte ebenfalls
  auf `allgemein` fallen (Empfehlung: `router.replace` auf
  `/settings/allgemein` oder still als `allgemein` behandeln).
- Hervorhebung „Einstellungen" in Kopfleiste und Seitenmenü bleibt an
  `pageId === 'settings'` bzw. am Routennamen — funktioniert mit Parameter
  unverändert.
- Neue i18n-Schlüssel nötig: `settings.area_lizenz`,
  `settings.area_rechtliches` (vorhanden sind `settings.area_allgemein`,
  `…_journal`, `…_ki`, `…_live`, `…_benachrichtigungen`).

### 6.2 Wie Settings.vue den Bereich heute wählt

- **Weder Query noch Hash noch Routenparameter.** `Settings.vue` hält den
  Bereich in einem lokalen Ref, Startwert aus localStorage
  **`settingsBereich`** (Rückfall `allgemein`). Die Reiterleiste (Bootstrap
  `nav nav-tabs`, Klasse `settings-nav`) ruft beim Klick eine
  Wechselfunktion: Ref setzen, localStorage schreiben, sanft nach oben
  scrollen. Bereiche heute: `allgemein` (Symbol `uil-setting`), `journal`
  (`uil-book-alt`), `live` (`uil-chart-line`), `ki` (`uil-brain`),
  `benachrichtigungen` (`uil-bell`). Die Inhalte sind per `v-show` je
  Bereich ein- und ausgeblendet (mehrere Blöcke pro Bereich, über die Datei
  verstreut).
- Im Bereich `ki` gibt es eine **zweite Reiterebene**, ebenfalls nur
  localStorage: **`settingsKiBereich`** (Rückfall `allgemein`), Werte
  `uebersicht`, `allgemein`, `berichte`, `nachrichten`, `agent`,
  `strategie`, `bilder`. Die Komponente `KiUebersicht` wechselt per Event
  `gehe-zu` in einen KI-Reiter.
- Settings.vue benutzt `useRouter`, aber **nicht** `useRoute` — es liest heute
  nichts aus der Adresse. Beim Umbau muss Settings.vue (gehört nicht zu den
  vier Gerüst-Dateien) den Bereich aus `route.params.bereich` lesen und beim
  Reiterwechsel `router.replace('/settings/<id>')` aufrufen. Ob
  `settingsBereich` weiter als Gedächtnis dient, ist eine Entscheidung: die
  neue Vorgabe „ohne Parameter → allgemein" ersetzt das Gedächtnis für den
  Einstieg über `/settings`.

### 6.3 Alle Stellen, die heute auf die Einstellungen zeigen

| Stelle | Art | heute | passendes neues Ziel |
|---|---|---|---|
| `components/SideMenu.vue` (Verwaltung) | `<a href>` | `/settings` | `/settings` (→ allgemein) |
| `components/rahmen/Kopfleiste.vue` (Zahnrad) | `<a href>` | `/settings` | `/settings` |
| `router/index.js` `/imports` | Redirect | `/settings` | `/settings` oder `/settings/journal` (Börsen-API-Schlüssel stehen im Journal-Bereich) |
| `views/Nachrichten.vue` „Zu den Einstellungen" | setzt localStorage `settingsBereich=ki` und `settingsKiBereich=nachrichten`, dann `router.push('/settings')` | – | `/settings/ki`; KI-Reiter `nachrichten` weiter über `settingsKiBereich` (oder neuer Query-Parameter) — **muss angepasst werden**, sonst landet der Klick auf „Allgemein" |
| `components/radar/KachelEtf.vue` (fehlender CryptoQuant-Schlüssel) | `router-link` | `/settings` | `/settings/live` (Schlüsselfeld liegt im Live-Bereich) |
| `components/radar/KachelLiq24.vue` (Aufzeichnung aus) | `<a href>` | `/settings` | `/settings/live` (Recorder-Schalter liegt im Live-Bereich) |
| `components/radar/KachelWal.vue` (keine aktive Quelle; Text verweist auf „Einstellungen → Nachrichten") | `router-link` | `/settings` | `/settings/ki` + KI-Reiter `nachrichten` |
| `views/KiAgent.vue` (Text `kiAgent.checkApiKey` mit Link) | HTML-Link im übersetzten Text | `/settings` | `/settings/ki` |
| `views/AddExcursions.vue` (Text `excursions.configureApiKey`) | HTML-Link | `/settings` | `/settings/journal` |
| `i18n/locales/de.json` + `en.json`, Schlüssel `…apiDescription` (Zeile ~972, AddTrades-API-Reiter) | HTML-Link im Text | `/settings` | `/settings/journal` |
| `views/Settings.vue` → Update-Assistent | `router.push` mit Query `rueckkehr=/settings` | `/settings` | `/settings/allgemein` (der Knopf steht im Allgemein-Bereich) |
| `components/basis/Leerzustand.vue` | nur Beispiel im Kommentar | – | – |

Alle bestehenden Links auf `/settings` funktionieren mit der neuen Route
weiter (Parameter optional) — sie landen dann nur auf „Allgemein" statt auf
dem zuletzt offenen Bereich. Serverseitig (Mails, Push) gibt es keine Links
auf `/settings`.

---

## 7. Gestaltung im Neubau

### 7.1 Gestaltungssystem

- **Token** ausschliesslich aus `src/assets/design/tokens.css`: Flächen
  `--bg`, `--panel`, `--panel-soft`, `--panel-hoch`; Linien `--line`,
  `--line-stark`; Schrift `--text`, `--muted`, `--leise`; Signal `--accent`,
  `--accent-hover`, `--accent-schwach`, `--accent-flaeche`, `--accent-rand`,
  `--on-accent`; Bedeutung `--good`, `--bad`, `--warn` und je
  `…-flaeche`; Form `--radius`, `--radius-knopf`, `--radius-klein`,
  `--radius-pille`, `--schatten`; Schrift `--schrift`, `--schrift-mono`;
  Abstände `--abstand-1` … `--abstand-6`; `--kopf-hoehe`. Keine Farbwerte
  ausserhalb von tokens.css. Türkis = „hier kannst du etwas tun / die Zahl,
  auf die es ankommt"; Grün/Rot nur Gewinn/Verlust.
- `basis.css` (Elemente ohne Klasse: Grund, Schrift, Überschriften, Links,
  Auswahl, sichtbarer Tastaturfokus, Rollbalken, Linien; Hilfsklassen
  `zahl`/`tabular-nums`, `at-gedaempft`, `at-akzent`) und `rahmen.css`
  (heutige Rahmen-Overrides + Bootstrap-Variablen auf Token; fällt laut
  Kommentar mit dem neuen Seitenmenü weg).
- **Bausteine** in `src/components/basis/` (auch über `basis/index.js`):
  `Symbol` (name, groesse, titel, strich), `Logo` (groesse, schrift,
  anordnung neben|unter), `Knopf` (art haupt|normal|leise|gefahr, klein,
  symbol, nurSymbol, laedt, disabled, type, href, to, titel), `Karte`
  (titel, unter, akzent, dicht, als; Slot `aktionen`), `Pille` (ton
  akzent|neutral|gut|schlecht|warn, symbol, gross), `Reiter` (v-model,
  reiter = Liste mit id/titel/symbol/zahl/aus), `Tabelle`, `Eingabe`,
  `Dialog` (natives `<dialog>`, v-model, titel, breite, aussenSchliesst; Slot
  `fuss`; Event `zu`), `Seitenkopf` (titel, unter, linie; Slot `aktionen`),
  `Hinweis` (art info|warn|fehler|gut, titel, schliessbar), `Leerzustand`.
  Naheliegend: `Reiter` für die Einstellungs-Bereiche, `Dialog` als Ersatz
  für das Vollbild-Screenshot-Modal, `Seitenkopf` für die Titelzeile.

### 7.2 Symbole in `Symbol.vue`

Vorhanden: `journal`, `chart`, `live`, `entdecken`, `agent`, `lernen`,
`start`, `menue`, `schliessen`, `einstellungen`, `auge`, `augeAus`, `ki`,
`einklappen`, `ausklappen`, `runter`, `hoch`, `plus`, `haken`, `info`,
`warnung`, `fehler`, `extern`, `suche`, `kalender`, `abmelden`, `leer`,
`test`. Unbekannte Namen fallen still auf `info` zurück.

### 7.3 Heute benutzte Unicons-/Font-Awesome-Klassen und Zuordnung

In den vier Dateien selbst:

| Datei | heute | passendes Symbol | Status |
|---|---|---|---|
| SideMenu | `uil-angle-double-left` / `-right` (Klappen) | `einklappen` / `ausklappen` (einfacher Winkel) | vorhanden (Doppelwinkel fehlt) |
| SideMenu | `uil-wallet` (Kontoübersicht) | – | **fehlt** (Geldbörse) |
| SideMenu | `uil-apps` (Dashboard) | – | **fehlt** (Kacheln/Raster) |
| SideMenu | `uil-signal-alt-3` (Tagesansicht) | – | **fehlt** (Balken) |
| SideMenu | `uil-calendar-alt` (Kalender) | `kalender` | vorhanden |
| SideMenu | `uil-compass` (Playbook) | – | **fehlt** (Kompass) |
| SideMenu | `uil-chart-pie` (Auswertung) | – | **fehlt** (Torte) |
| SideMenu | `uil-robot` (KI-Coach) | `ki` | vorhanden |
| SideMenu | `uil-image-v` (Screenshots) | – | **fehlt** (Bild) |
| SideMenu | `uil-arrow-circle-down` (Pendente Trades) | `runter` (ohne Kreis) | ersatzweise |
| SideMenu | `uil-plus-circle` (Manueller Import) | `plus` | ersatzweise |
| SideMenu | `uil-setting` (Einstellungen) | `einstellungen` | vorhanden |
| SideMenu | `uil-signout` (Abmelden) | `abmelden` | vorhanden |
| SideMenu | `uil-docker` (Update Docker) | `extern` | ersatzweise (Link nach aussen) |
| SideMenu | `uil-download-alt` (Update) | – | **fehlt** (Download) |
| SideMenu | `uil-redo` (Rollback) | – | **fehlt** (Zurückdrehen) |
| Nav | – (nutzt bereits `menue`, `auge`, `augeAus`, `ki`) | – | – |
| Dashboard-Layout | `fa fa-chevron-left` / `-right` (Font Awesome, Screenshot-Karussell) | `einklappen` / `ausklappen` | vorhanden |

Registry-Symbole (`menu.js`, gerendert im datengetriebenen Menü):

| heute | Seite(n) | passendes Symbol | Status |
|---|---|---|---|
| `uil-chart` | chart, Modus start | `chart` | vorhanden |
| `uil-book-alt` | Modus journal | `journal` | vorhanden |
| `uil-chart-line` | liquidity, coinRadar, Modus live | `live` | vorhanden |
| `uil-telescope` | hypeRadar, Modus research | `entdecken` | vorhanden |
| `uil-robot` | kiAgent, Modus agent | `ki` / `agent` | vorhanden |
| `uil-graduation-hat` | lernen, Modus lernen | `lernen` | vorhanden |
| `uil-sliders-v-alt` | settings | `einstellungen` | vorhanden |
| `uil-dashboard` | marktradar, Menü hypeRadar | – | **fehlt** (Tacho) |
| `uil-newspaper` | nachrichten | – | **fehlt** (Zeitung) |
| `uil-layer-group` | openinterest | – | **fehlt** (Ebenen) |
| `uil-fire` | liquidations | – | **fehlt** (Flamme) |
| `uil-crosshairs` | livetrading, agentSetups | – | **fehlt** (Fadenkreuz) |
| `uil-history` | liveSessions, coinVerlauf | – | **fehlt** (Uhr mit Pfeil) |
| `uil-chart-pie` | auswertung, liveAuswertung, agentPerformance, lernenStatistik | – | **fehlt** |
| `uil-bolt-alt` | hypeFrueh | – | **fehlt** (Blitz) |
| `uil-building` | hypeBoersen | – | **fehlt** (Gebäude) |
| `uil-file-alt` | hypeBerichte, agentBuilder | – | **fehlt** (Dokument) |
| `uil-list-ol-alt` | Menü coinRadar, coinRangliste | – | **fehlt** (nummerierte Liste) |
| `uil-arrow-down-right` | coinAbverkauf | – | **fehlt** (Pfeil schräg ab) |
| `uil-processor` | agentStrategies | `agent` | vorhanden (gleiches Motiv) |
| `uil-cube` | agentEditor | – | **fehlt** (Würfel) |
| `uil-flask` | agentLab | `test` | vorhanden (Kolben) |
| `uil-list-ul` | lernenKarten | – | **fehlt** (Liste) |
| `uil-wallet`, `uil-apps`, `uil-signal-alt-3`, `uil-calendar-alt`, `uil-compass`, `uil-image-v`, `uil-arrow-circle-down`, `uil-plus-circle` | Journal-Seiten | siehe obere Tabelle | |
| `uil-refresh` | addExcursions | – | **fehlt** |
| `uil-rocket` | setup | – | **fehlt** |

Einstellungs-Bereiche (für die neuen Unterseiten): `uil-setting` →
`einstellungen`, `uil-book-alt` → `journal`, `uil-chart-line` → `live`,
`uil-brain` → `ki`, `uil-bell` → **fehlt** (Glocke); für `lizenz` und
`rechtliches` gibt es noch keine Symbole (z. B. Schlüssel, Paragraf/Waage).

Weil das Registry-Feld `icon` heute eine Unicons-Klasse enthält und
`menu.js` nur von seiner Besitzer-Sitzung geändert wird: entweder bekommt die
Registry ein zusätzliches Feld mit dem Symbolnamen, oder das Menü bildet die
Unicons-Namen über eine Zuordnungstabelle auf Symbol-Namen ab (Rückfall
`info`). Fehlende Symbole sind in `Symbol.vue` zu ergänzen (selbst gezeichnet,
24er-Raster, 1,8er Strich, ohne Füllung; Übernahmen aus Lucide/ISC in
THIRD-PARTY-NOTICES).

---

## 8. i18n-Schlüssel der vier Dateien

**Router (Seitentitel, `meta.titleKey`):** `nav.chart`, `app.startTitel`,
`nav.setup`, `onboarding.title`, `nav.dashboard`, `nav.accounts`,
`nav.calendar`, `nav.dailyView`, `nav.pendingTrades`, `nav.screenshots`,
`nav.lernen`, `nav.playbook`, `nav.evaluation`, `nav.liveSessions`,
`nav.liveAuswertung`, `nav.kiAgent`, `nav.manualImport`, `nav.addExcursions`,
`nav.settings`, `nav.liquidity`, `nav.liquidations`, `nav.openInterest`,
`nav.hypeRadar`, `nav.coinRadar`, `nav.marktradar`, `nav.livetrading`,
`nav.nachrichten`, `nav.agentStrategies`, `nav.agentSetups`,
`nav.agentPerformance`, `nav.agentEditor`, `nav.agentBuilder`,
`nav.agentLab`, `nav.coinRangliste`.

**SideMenu, fest:** `nav.menuAusklappen`, `nav.menuEinklappen`,
`nav.exchange`, `nav.accountsOverview`, `nav.analyze`, `nav.reflect`,
`nav.add`, `nav.manage`, `nav.dashboard`, `nav.dailyView`, `nav.calendar`,
`nav.playbook`, `nav.evaluation`, `nav.kiAgent`, `nav.pendingTrades`,
`nav.manualImport`, `nav.settings`, `nav.installing`, `nav.rollback`,
`nav.rollbackConfirm`, `nav.changes`, `nav.updateBackupWarning`,
`nav.updateBackupPath`, `nav.updateConfirm`.
**SideMenu, dynamisch:** Gruppen `nav.liveAnalyze`, `nav.liveTrade`,
`nav.agentRun`, `nav.agentBuild`, `nav.agentReview`, `nav.hypeGruppe`,
`nav.coinGruppe`, `nav.lernenGruppe`; Einträge aus `menuKey`/`titleKey` der
Registry, zusätzlich zu den `nav.*` oben: `hype.tab_dashboard`,
`hype.tab_fruehphase`, `hype.tab_boersen`, `hype.tab_berichte`,
`coinradar.tab_rangliste`, `coinradar.tab_verlauf`,
`coinradar.tab_abverkauf`, `lernen.tabKarten`, `lernen.tabStatistik`.
**SideMenu, nicht übersetzt (fest im Altcode):** „Futures", „Bot",
„Screenshots" (Beschriftung und Tooltip), „Abmelden", „Rollback",
„Update v…", Tooltip zum Watchtower-Update, „AutarkTrade <Version>".
Empfehlung: im Neubau über i18n führen (`nav.screenshots` existiert).

**Nav:** `options.gross`, `options.net`, `nav.showNumbers`,
`nav.hideNumbers`, `nav.kiAgent`; Seitentitel über die Registry-/Meta-
`titleKey`s (siehe Router); im Altcode zusätzlich (tot) `settings.imports`.
Fest: „Export", „JSON", „CSV", „Long", „Short".

**Layout:** `notifications.reportReady`, `notifications.reportCreated`
(Parameter `label`; fester Rückfall „Zeitraum"); über `PageInfo` der
Abschnitt `info.agent` (`info.agent.title`, `.intro`, `.sections`).

**Neu für 6.1:** `settings.area_lizenz`, `settings.area_rechtliches`.

(Zum Vergleich, gehört nicht zu den vier Dateien: Kopfleiste benutzt
`app.name`, `app.modi`, `modes.<id>`, `modes.liveShort`, `modes.agentShort`,
`modes.betaHint`, `app.testbetrieb`, `app.testbetriebText`, `nav.settings`.)

---

## 9. Auffälligkeiten für den Neubau (Kurzliste)

1. Keine Catch-all-Route; unbekannte Pfade bleiben weiss.
2. `pageId` folgt SPA-Navigationen nicht.
3. `screenType` reagiert nicht auf Grössenänderung.
4. `APP_MODES` in globals.js kennt `lernen` nicht.
5. KI-Bericht-Polling wird beim Unmount nicht abgeräumt.
6. Nav hält eine doppelte Seitenliste (Registry genügt) mit totem Eintrag
   `imports`; das berechnete Seitensymbol wird nie angezeigt.
7. SideMenu enthält zwei ungenutzte Funktionen; `renderProfile` in Nav
   ungenutzt; `ModeSwitcher.vue` nirgends eingebunden.
8. Handy-Menü hängt per DOM-ID/Klasse an `utils.js`.
9. Vollbild-Screenshot-Modal, Export-Dropdown und Tooltips hängen an
   Bootstrap-JS — beim Entfernen von Bootstrap (S9) mitziehen.
10. Mehrere feste deutsche/englische Texte ohne i18n (Abschnitt 8).
