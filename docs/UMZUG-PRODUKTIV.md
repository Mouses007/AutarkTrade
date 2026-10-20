# Umzug: alte App → AutarkTrade V2 im Produktivbetrieb (U1)

**Stand 20.10.2026 · vorbereitet, NICHT ausgeführt.** Ziel: Die alte App (Crypto Trading Journal,
Container-Manager-Projekt `tradingjournal` auf der NAS 192.168.178.100) wird abgeschaltet. An ihrer
Stelle läuft AutarkTrade V2 im selben Projekt an der Live-DB `tradejournal`, nur für den Eigentümer
und **ohne scharfen Handel** (S13, `docs/SPAETER-SCHARFER-HANDEL.md`).

Es fühlt sich an wie ein Update: gleiches Projekt, gleiche `.env`, gleicher Port 8080, gleicher Caddy
auf 8443, gleiche Datenbank. Neu sind nur das Image und die Compose-Datei.

**Nie über das öffentliche Image `mouses007/trading-journal` oder das alte öffentliche GitHub-Repo.**
Sonst wäre V2 öffentlich. Das V2-Image wird lokal gebaut und per SSH übertragen. Auf der NAS
heisst es nur lokal `autarktrade:produktiv`, und die Compose-Datei sagt `pull_policy: never`.

## Überblick

| Schritt | Was | Skript |
|---|---|---|
| 0 | offene Live-Positionen schliessen | `sichern.sh` meldet sie |
| 1 | Vollsicherung `pg_dump -Fc` + `pg_restore --list` + Prüfwerte | `sichern.sh` |
| 2 | alte App stoppen, nicht löschen | `alt-stoppen.sh` |
| 3 | Image privat auf die NAS | `nas-deploy.sh` |
| 4 | Compose tauschen, Projekt neu erstellen | `nas-deploy.sh` |
| 5 | Migrationen v27 → v29 im Log | `pruefen.sh` |
| 6 | Prüfliste | `pruefen.sh` + von Hand |
| 7 | Testcontainer 8091 und DB-Kopie `autarktrade` abbauen (optional) | von Hand |
| 8 | Rückweg | `rueckweg.sh` |

Alle Skripte liegen unter `scripts/umzug/`:
- Jedes kennt `--trocken`: Es zeigt dann jeden Befehl und ändert nichts.
- Vor jedem Eingriff fragt es; nur „ja“ zählt.
- `umzug.sh` ruft Schritte 0–6 nacheinander auf. Jeder Teilschritt fragt einzeln, und bricht einer
  ab, hält das Ganze an.
- Zwischen den Schritten merken sich die Skripte den Stand in
  `~/AutarkTrade-Sicherungen/umzug-stand.env`: Sicherung, altes Image, Name der Compose-Sicherung.

## Vorbereitung (am Rechner, einmal)

```bash
cp scripts/umzug/.env.beispiel scripts/umzug/.env
```

Die Datei `scripts/umzug/.env` enthält nur Ziele: NAS, Projektordner, Dienst- und Containernamen,
Ablage der Sicherungen. Sie enthält **keine Passwörter**. DB-Zugang und Secret bleiben in der `.env`
des NAS-Projekts; die Skripte lesen dort nur die **Namen** der Variablen und prüfen, dass
`CTJ_SECRET` gesetzt ist. Die Datei ist über `.gitignore` ausgeschlossen. Vorgaben aus dem alten
Betrieb (`Journal/scripts/.nas-deploy.env`): `NAS_USER=MARO`,
`NAS_PROJEKT=/volume1/docker/tradingjournal`.

Voraussetzungen:
- SSH auf der NAS ist an.
- Der SSH-Benutzer darf `sudo docker`.
- Auf diesem Rechner läuft Docker (für Bau und `pg_restore --list`).
- Der Arbeitsstand ist eingecheckt: gebaut wird `git archive HEAD`, also genau master.

Vor dem Umzug in der alten App notieren, um nachher zu vergleichen:
- Journal › Übersicht „Dieses Jahr“: Gesamt-P&L netto, Anzahl Trades, Gewinnquote;
- Zahl der offenen Positionen unter „Pendente Trades“;
- die letzte Tagesansicht.

Den ganzen Ablauf zuerst trocken ansehen:

```bash
scripts/umzug/umzug.sh --trocken
```

## 0) Offene Live-Positionen schliessen

V2 hat **keinen Stop-Wächter** und gibt keine Orders auf. Beim ersten Start stellt Migration S13 jede
Instanz mit `mode = 'live'` auf Papier und pausiert sie. Offene Live-Positionen werden nur als
`ausgelagert` markiert: Sie bleiben an der Börse stehen, und niemand bewacht sie mehr.

- **Von Hand:** In der alten App unter Agent › Strategien die Live-Instanzen pausieren und offene
  Live-Positionen an der Börse schliessen (Bitunix/Pionex). Oder bewusst mit eigenem Stop an der
  Börse stehen lassen.
- **Prüfung:** `scripts/umzug/sichern.sh` zeigt die Zahl der Live-Instanzen und der offenen
  Live-Positionen (`status in ('open','pending','unknown')`) samt Liste. Ist sie nicht 0, fragt es,
  ob sie erledigt sind, und bricht ohne „ja“ ab.

## 1) Vollsicherung

```bash
scripts/umzug/sichern.sh
```

| Befehl (gekürzt) | Prüfung |
|---|---|
| `ssh … sudo docker exec tradejournal-db pg_dump -Fc -Z 6 -U tradejournal -d tradejournal > ~/AutarkTrade-Sicherungen/tradejournal-vor-v2-<datum>.dump` | Datei nicht leer |
| `docker run --rm -i postgres:17 pg_restore --list < …dump > …dump.liste` | läuft ohne Fehler |
| Zahl `TABLE DATA public` in der Liste = Zahl der Tabellen in `information_schema.tables` | sonst Abbruch |
| `sha256sum` → `…dump.sha256` | wird vom Rückweg geprüft |
| `count(*)` jeder Tabelle → `…pruefwerte` | Vergleich in 5) und 8) |

Der Dump entsteht im DB-Container selbst (Postgres 17, dieselbe Version) und läuft über SSH direkt
auf diesen Rechner. Auf der NAS wird nichts geschrieben. Die Sicherung danach zusätzlich ausserhalb
des Rechners ablegen.

## 2) Alte App stoppen, nicht löschen

```bash
scripts/umzug/alt-stoppen.sh
```

- Findet den App-Container über die Compose-Labels (`tradingjournal` / `trading-journal`).
- Hält das laufende Image unter `trading-journal:vor-v2-<datum>` fest. Das ist nur ein lokaler Tag,
  es wird nichts gezogen und nichts gelöscht.
- Sichert `docker-compose.yml` und `.env` im Projektordner als `*.vor-v2-<datum>`.
- Stoppt nur den App-Container. Caddy und `tradejournal-db` laufen weiter.
- **Prüfung:** Der Container steht auf `exited`. `sudo ls -l /volume1/docker/tradingjournal/*.vor-v2-*`
  zeigt beide Sicherungen.

Der gestoppte Container bleibt stehen, bis Schritt 4 das Projekt neu erstellt. Compose ersetzt ihn
dann; Image, Compose-Datei und Sicherung bleiben für den Rückweg.

## 3) Image privat auf die NAS

`scripts/umzug/nas-deploy.sh`, erster Teil:

```bash
git archive HEAD | docker build --platform linux/amd64 -t autarktrade:produktiv -   # Architektur per `uname -m` der NAS
docker save autarktrade:produktiv | gzip -1 | ssh MARO@192.168.178.100 'cat > /tmp/.at-v2-image.tar.gz'
ssh -t MARO@192.168.178.100 'sudo /usr/local/bin/docker load -i /tmp/.at-v2-image.tar.gz'
```

- **Prüfung:** Die Architektur des Images passt zur NAS. Gemeldet werden der Frontend-Hash
  (`assets/index-….js`) und die Revision (Label `org.opencontainers.image.revision`).
- Das Tag `autarktrade:produktiv` existiert nur auf der NAS. Das Skript bricht ab, wenn `V2_TAG` auf
  `mouses007/…` oder `…/trading-journal…` zeigt.
- Es gibt **kein** `image prune`: Das alte Image bleibt liegen.

## 4) Produktiv-Compose als Tausch im Projekt `tradingjournal`

`scripts/umzug/nas-deploy.sh`, zweiter Teil. Vorlage:
[`scripts/umzug/docker-compose.produktiv.yml`](../scripts/umzug/docker-compose.produktiv.yml).

Vor der Frage zeigt das Skript:
- den Unterschied zur Compose-Datei auf der NAS (`diff -u`);
- die **Namen** der Variablen in der Projekt-`.env`.

Es bricht ab, wenn weder `CTJ_SECRET` noch `AT_SECRET` gesetzt ist. Danach:

```bash
sudo cp /tmp/.at-v2-compose.yml /volume1/docker/tradingjournal/docker-compose.yml
sudo sh -c 'cd /volume1/docker/tradingjournal && docker compose -p tradingjournal up -d --force-recreate'
```

| Punkt | Wie |
|---|---|
| DB `tradejournal` | `DB_*` aus der Projekt-`.env`, unverändert |
| gleiches Secret | V2 liest `CTJ_SECRET` über den Rückfall `AT_` → `CTJ_` (`server/umgebung.js`). Die Börsenschlüssel bleiben lesbar; im Probelauf hat V2 den von der alten App verschlüsselten Schlüssel richtig entschlüsselt. |
| **kein** Testbetrieb | `AT_TESTBETRIEB=0`, `AT_NO_ENGINE=0`, `AT_NO_RECORDER=0` ausdrücklich gesetzt. Takte, Mails/Push und Rekorder laufen; die Engine läuft nur als Simulation (Papier/Schatten). |
| Port und Caddy wie bisher | `${CTJ_PORT:-8080}:8080`, Caddy `${CTJ_TLS_PORT:-8443}:443` mit der vorhandenen Caddyfile und `certs/`. `CTJ_UPSTREAM` und `AT_UPSTREAM` zeigen beide auf `trading-journal:8080`. |
| kein `container_name` | Compose benennt selbst: `tradingjournal-trading-journal-1`, `tradingjournal-caddy-1` |
| nicht root (F2) | Die App läuft als `node` (uid 1000). Ein Docker-Socket ist nicht mehr eingehängt. |
| Volume-Rechte | Die alte App hatte an der NAS kein Datenvolume, nur den Socket; Postgres liegt im eigenen Container. Falls doch eines unter `/app/data` hängt, übergibt der Einstieg (`docker-entrypoint.sh`) es beim ersten Start einmal per `chown -R node:node` und meldet das im Log („/app/data gehört noch root …“). Scheitert das, im Compose `user: "<uid>:<gid>"` des Besitzers setzen. |
| Sicherheitsschalter | `AT_ALLOW_INSECURE=` und `AT_RESET_AUTH=` stehen leer. Ein altes `CTJ_ALLOW_INSECURE` in der `.env` wirkt damit nicht mehr (A2-30). `AT_TRUST_PROXY=1` mit `AT_TRUSTED_PROXY=caddy` (A2-03). |
| nichts ziehen | `pull_policy: never`. Im Container Manager **nicht** „Erstellen/Herunterladen“ drücken; neu aufspielen nur mit `nas-deploy.sh`. |

- **Prüfung:** Das Skript wartet auf „AutarkTrade ready!“ im Log und zeigt die Zeilen zu Schema,
  S13, S15, v28 und Testbetrieb.
- Die Werte der `.env` liest und kopiert es nie.

## 5) Erwartete Migrationen (v27 → v29)

Die alte App steht auf Schema **v27**, V2 auf **v29**. Im Start-Log stehen dann (Probelauf
20.10.2026):

```
 -> v28: Aktienbörsen-Gebühren aus <n> Tageszeilen entfernt
 -> S13: <n> Live-Instanz(en) auf Papier gestellt und pausiert          (nur wenn es welche gab)
 -> S13: <n> Live-Position(en) als ausgelagert markiert (nichts geschlossen)
 -> S15: Quellen ohne Verkaufsfreigabe an
 -> Datenbank-Schema v29 (Code kennt v29)
```

- **v28** entfernt die Felder `sec`/`taf`/`nscc`/`nasdaq`/`otherCommission` aus den Trades; Summen
  und Gebühren bleiben gleich.
- **S12/S15** übernehmen Einstellungen. Der Schalter `quellenOhneFreigabe` steht auf an, Kalender und
  Quellen bleiben wie gewohnt.
- **Prüfung** (`pruefen.sh`): `settings.schemaVersion = 29`; keine Instanz mit `mode = 'live'`; die
  Zeilen von `trades`/`diaries`/`screenshots` sind gleich wie in den Prüfwerten. Andere Tabellen
  wachsen durch die Takte, das ist nur ein Hinweis.

Die alte App darf danach **nicht** mehr gegen dieselbe DB starten. Sie würde eine v29-DB sehen und
ihre Live-Instanzen pausiert auf Papier vorfinden. Zurück geht es nur über den Rückweg (8).

## 6) Prüfliste

```bash
scripts/umzug/pruefen.sh     # nur lesend, beliebig oft
```

Automatisch geprüft:
- Image `autarktrade:produktiv`, Container läuft, App-Prozess uid 1000, kein Docker-Socket;
- Log: Schema v29, kein Testbetrieb, Engine an, Rekorder an, Zeilen mit error/Fehler;
- DB wie unter 5;
- HTTP: `GET /` → 200, `/api/auth/status` mit Gate an und ohne Neu-Einrichtung (das alte Passwort
  gilt), `/api/db/trades` ohne Anmeldung → 401, `https://…:8443` über Caddy → 200,
  `/api/esp32/display` (mit `ESP32_KEY` in `scripts/umzug/.env` voll, sonst nur 401).

Von Hand (die Liste gibt `pruefen.sh` am Ende aus):

| Punkt | Erwartung |
|---|---|
| Login | mit dem bisherigen Passwort, über `http://192.168.178.100:8080` und `https://192.168.178.100:8443` |
| Journal-Zahlen | Gesamt-P&L netto, Anzahl Trades und Gewinnquote „Dieses Jahr“ = Notiz aus der alten App; Kalender, Tagesansicht, Bilder |
| Imports | Journal › Import › Börsen-Import Bitunix/Bitget/Pionex: Vorschau lädt; der Schlüssel ist lesbar, d.h. es kommt keine Meldung „Schlüssel ungültig“ |
| Pendente Trades | zeigt die offenen Positionen bzw. keine |
| Liq-Ticker/Rekorder | Live-Trading › Liquidationen füllt sich; im Log `-> [recorder] … verbunden` |
| Takte | Log ohne „Testbetrieb: … NICHT gestartet“; nach einigen Minuten Kurse und Marktradar aktuell |
| Mails/Push | Einstellungen › Benachrichtigungen › Test senden, je Kanal |
| ESP32 | `/api/esp32/display` liefert Werte, die Anzeige aktualisiert sich (gleiche Adresse und Port 8080, gleicher Schlüssel in `settings.esp32ApiKey`) |
| Android-Widget | aktualisiert sich (gleiche Adresse) |
| Lizenz | eingetragen, siehe unten |

Hinweis: Es darf nur **ein** Prozess mit Rekorder und Engine an der Live-DB laufen. Ein lokaler
Entwicklungsserver gegen `tradejournal` braucht `AT_NO_ENGINE=1 AT_NO_RECORDER=1` (CLAUDE.md).

## 7) Testcontainer 8091 und DB-Kopie abbauen (optional)

Erst wenn 6) bestanden ist und einige Tage ruhig lief:

```bash
docker stop autarktrade-v2 && docker rm autarktrade-v2           # am Rechner mit dem Testcontainer
docker image rm autarktrade:v2-test
# auf der NAS, DB-Kopie (NICHT tradejournal!):
ssh -t MARO@192.168.178.100 "sudo /usr/local/bin/docker exec -it tradejournal-db psql -U tradejournal -d postgres -c 'DROP DATABASE autarktrade'"
```

- **Prüfung:** `\l` zeigt `tradejournal` und keine `autarktrade` mehr.
- `scripts/v2-container.sh` startet danach nicht mehr, weil die DB fehlt. Das ist gewollt.
- Optional später: die alten Images `trading-journal:vor-v2-<datum>` und die DB
  `tradejournal_v2_<datum>` eines Rückwegs löschen.

## 8) Rückweg

```bash
scripts/umzug/rueckweg.sh --trocken
scripts/umzug/rueckweg.sh            # optional --sicherung <datei>
```

Jede Stufe hat ihre eigene Ja-Abfrage, und nichts wird weggeworfen:
1. V2 stoppen.
2. Die Sicherung (Prüfsumme geprüft) in eine **neue** DB `tradejournal_rueck_<datum>` einspielen und
   jede Tabelle gegen die Prüfwerte zählen. Bei einer Abweichung bricht das Skript ab, ohne etwas zu
   tauschen.
3. Verbindungen zu `tradejournal` beenden und die Namen tauschen: `tradejournal` →
   `tradejournal_v2_<datum>` (der V2-Stand bleibt liegen), `tradejournal_rueck_<datum>` →
   `tradejournal`.
4. Die Compose-Sicherung zurücklegen, das festgehaltene Image wieder unter seinem alten Tag
   einhängen (nur lokal umhängen, nichts ziehen) und das Projekt neu erstellen.
5. Warten, bis die alte App auf 8080 antwortet.

Was nach dem Umzug in V2 eingetragen wurde, steckt danach nur in `tradejournal_v2_<datum>`. Die alte
App findet ihre Live-Instanzen so vor, wie sie in der Sicherung standen, auch eine noch aktive
Live-Instanz. Ihr Stop-Wächter läuft dann wieder.

## Eigene Lizenz

- **Werkzeug:** `scripts/lizenz-ausstellen.mjs` signiert die Nutzlast mit Ed25519. Den privaten
  Schlüssel liest es aus der PEM-Datei unter `AT_LIZENZ_PRIVAT`. Vor der Ausgabe prüft es den
  fertigen Schlüssel gegen den eingebauten öffentlichen Schlüssel `OEFFENTLICHER_SCHLUESSEL` in
  `server/lizenz.js` (Zeile 38).
- **Privater Schlüssel:** Er liegt schon unter `~/.config/autarktrade/lizenz-signatur.pem` (Rechte
  600, ausserhalb des Repos) und passt zum eingebauten öffentlichen Schlüssel. Geprüft am 20.10.2026,
  der abgeleitete öffentliche Schlüssel ist gleich. Deshalb wurde **kein** neues Paar erzeugt und
  `server/lizenz.js` nicht geändert; ein neues Paar hätte alle ausgestellten Schlüssel ungültig
  gemacht.
- **Ausgestellt** am 20.10.2026:

  ```bash
  AT_LIZENZ_PRIVAT=~/.config/autarktrade/lizenz-signatur.pem node scripts/lizenz-ausstellen.mjs \
    --kaeufer "Mouses007 (Eigenbetrieb)" --id AT-EIGEN-0001 --updates-bis 2099-12-31 \
    > ~/.config/autarktrade/lizenz-eigen.txt      # Rechte 600
  ```

  Inhalt: Edition `standard`, kein `gueltigBis` (läuft nicht ab), Updates bis 2099-12-31 (das Feld
  ist Pflicht; das ist praktisch „ohne Update-Ablauf“), kein Zugangstoken. `--pruefen` ergibt
  Modus `voll`.
- **Eintragen:** Nach dem Umzug in der App unter **Einstellungen › Lizenz**
  (`/einstellungen/lizenz`) den Inhalt von `~/.config/autarktrade/lizenz-eigen.txt` einfügen und
  „Speichern“ drücken. Danach steht dort „Lizenziert · Mouses007 (Eigenbetrieb) · AT-EIGEN-0001“.
  Der Schlüssel landet in `settings.lizenzSchluessel` und damit auch in der nächsten Sicherung.

## Probelauf (20.10.2026, ohne NAS und ohne Live-DB)

Alles lief auf diesem Rechner in Wegwerf-Containern (`NAS_HOST=lokal`). Danach ist alles wieder
entfernt: Container, Volumes, Images `u1-alt:edge`, `trading-journal:vor-v2-…` und
`autarktrade:produktiv`, Scratch-Ordner.

1. **Ausgangslage:**
   - Postgres 17 als `u1-tradejournal-db`.
   - Die alte App aus `git -C Journal archive master` (Schema v27) im nachgebauten Projekt
     (Dienst `trading-journal`, Caddy, `.env` mit `CTJ_SECRET`).
   - Über die alte API: Passwort gesetzt und Bitunix-Schlüssel gespeichert (verschlüsselt).
   - Per SQL: 6 Tageszeilen mit 18 Trades samt `sec`/`taf`-Feldern, ein Tagebuch, eine
     Live-Instanz mit einer offenen Live-Position.
   - Die Antworten der alten API festgehalten.
2. **`umzug.sh --trocken`:** alle Schritte angezeigt, nichts verändert. Dabei fiel ein Spaltenname
   in `sichern.sh` auf (`direction` statt `side`) und ist berichtigt.
3. **`umzug.sh` mit „ja“:**
   - Sicherung 69/69 Tabellen, Prüfsumme und Prüfwerte.
   - Alte App gestoppt, Image und Compose festgehalten.
   - V2 gebaut und das Projekt getauscht.
   - Im Log v28 (6 Tageszeilen), S13 (1 Instanz, 1 Position), S15, Schema v29, „ready“.
   - Die Live-Position hatte die alte App vor dem Stoppen selbst geschlossen
     (`extern_geschlossen`). Ihr Abgleich lief also noch, deshalb meldete `sichern.sh` 0 offene.
4. **`pruefen.sh`:** alles in Ordnung (Engine/Rekorder im Probelauf absichtlich aus, als Hinweis
   gemeldet).
   - Anmeldung in V2 mit dem Passwort der alten App klappt.
   - `/api/db/trades` und `/api/db/diaries` sind nach dem Sortieren gleich, ohne die von v28
     entfernten Felder; Summe `netProceeds` −31,11 alt = neu.
   - V2 entschlüsselt den von der alten App gespeicherten Bitunix-Schlüssel und das Secret richtig.
5. **`rueckweg.sh --trocken`**, dann mit „ja“:
   - Sicherung in `tradejournal_rueck_…` (Prüfwerte gleich, v27), Namen getauscht, die alte App
     läuft wieder.
   - Die Trades der alten API sind **byte-gleich** mit vor dem Umzug, der V2-Stand liegt als
     `tradejournal_v2_…` (v29).

Nicht im Probelauf: SSH/sudo der NAS (dort laufen dieselben Befehle über `ssh`), echte
Börsen-Abrufe, Mail/Push, ESP32 und Widget. Das prüft die Liste unter 6.
