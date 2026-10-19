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
| 0 | S1 Verkaufs-Prüfung | Fremdquellen, Bibliotheken, KI-Bedingungen je Funktion | – (nur lesen) | läuft parallel |
| 0 | S2 Fundament V2 | Repo, Umbenennung, Testbetrieb, DB-Kopie, Container, Gestaltungssystem, Rahmen | master | **fertig** (siehe unten) |
| 1 | S3 Aufräumen | CSV-Pfad und toten Import-Code löschen, `journal-alt.js`, zweiter Golden Master (MFE/OHLCV) | – | offen, frei |
| 1 | S4 Diagramme neu | `charts.js` clean-room in `src/utils/journal/diagramme/` | – | offen, frei |
| 1 | S5 Redesign Handel | Chart, Live-Trading, Sessions, Incoming, Agent-Seiten | – | offen, frei |
| 1 | S6 Redesign Analyse | Marktradar, Nachrichten, Hype-/Coin-Radar, KI-Agent, Lernen | – | offen, frei |
| 2 | S7 Journal-Kern neu | `trades.js` & Co. clean-room, Tag-Gruppen-Fehler, Datenmodell | – | wartet auf S3 |
| 2 | S8 Ansichten neu | Daily, Dashboard, Kalender, Screenshots (markerjs2 ersetzen), AddTrades, Playbook | – | wartet auf S7 + S4 |
| 2 | S9 Gerüst & Einstellungen | Router, Menü, Layout, `Settings.vue` zerlegen, Bootstrap/FA/Unicons entfernen | – | frei für alles ausser dem Entfernen (wartet auf S5, S6, S8) |
| 2 | S10 Lizenz & Vertrieb | LICENSE, NOTICE, THIRD-PARTY-NOTICES, Zustimmungsdialog, `server/lizenz.js`, private Update-Quelle | – | frei |
| 3 | S11 Herkunftsnachweis & Freigabe | `scripts/herkunft-pruefen.mjs`, `HERKUNFT.md`, Widget/ESP32 umbenennen, CI, altes Repo privat | – | wartet auf alle |

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
- Marktradar, Ansicht „Pult": am Telefon überlappen die oberen Kacheln (gesehen im
  Prüf-Container, nicht gegen den alten Stand verglichen) — Bereich S6.
- Screenshots mit echten Daten: 8091 steht hinter dem Passwort-Gate der Kopie; geprüft
  wurde die Oberfläche im Prüf-Container mit leerer SQLite, die Daten über die API.
- Privates GitHub-Repo „AutarkTrade": erst nach Bestätigung des Nutzers.
