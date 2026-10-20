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
| 3 | Image privat auf die NAS | `scripts/nas-deploy.sh` (wie bisher) |
| 4 | Compose tauschen, Projekt neu erstellen | `scripts/nas-deploy.sh` (erkennt den Wechsel) |
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

Dieselbe Einstellungsdatei wie bisher für das Update-Skript, nur ins V2-Repo kopiert:

```bash
cp /home/maro/Schreibtisch/Trading/Journal/scripts/.nas-deploy.env scripts/.nas-deploy.env
```

Darin stehen `NAS_HOST`, `NAS_USER=MARO`, `NAS_PROJEKT=/volume1/docker/tradingjournal` und
`NAS_PORT=8080`. Alle Umzugsskripte lesen diese Datei. Für alles andere gelten die Vorgaben aus
`scripts/umzug/.env.beispiel` (Dienst `trading-journal`, DB-Container `tradejournal-db`, Ablage
`~/AutarkTrade-Sicherungen`). Weicht etwas ab, kommt es in eine zusätzliche `scripts/umzug/.env`.

Beide Dateien enthalten **keine Passwörter** und sind über `.gitignore` ausgeschlossen.
DB-Zugang und Secret bleiben in der `.env` des NAS-Projekts. Die Skripte lesen dort nur die
**Namen** der Variablen und prüfen, dass `CTJ_SECRET` gesetzt ist.

Voraussetzungen:
- SSH auf der NAS ist an.
- Der SSH-Benutzer darf `sudo docker`.
- Auf diesem Rechner läuft Docker (für Bau und `pg_restore --list`).
- Gebaut wird wie bisher aus dem Arbeitsordner. Das Skript meldet, wenn nicht eingecheckte
  Änderungen mitgehen (Revision `…+lokal`). Für den Umzug also auf sauberem master stehen.

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
- **Bots der Börse (z. B. Pionex-Grid-Bot) bleiben offen.** Sie laufen auf den Servern der Börse
  mit ihren eigenen Grenzen; die App hat sie nie gesteuert, sie liest sie nur (Pendente Trades,
  Bot-Ansicht, Import). V2 liest sie genauso weiter. Sie gehören nicht zu den Live-Positionen
  oben und blockieren `sichern.sh` nicht.
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
- Sichert die Compose-Datei (auf der NAS `compose.yaml`, erkannt am Label des Containers) und, falls vorhanden, `.env` im Projektordner als `*.vor-v2-<datum>`.
- Stoppt nur den App-Container. Caddy und `tradejournal-db` laufen weiter.
- **Prüfung:** Der Container steht auf `exited`. `sudo ls -l /volume1/docker/tradingjournal/*.vor-v2-*`
  zeigt beide Sicherungen.

Der gestoppte Container bleibt stehen, bis Schritt 4 das Projekt neu erstellt. Compose ersetzt ihn
dann; Image, Compose-Datei und Sicherung bleiben für den Rückweg.

## 3) Image privat auf die NAS

Der gewohnte Aufruf, wie bisher in der alten App:

```bash
scripts/nas-deploy.sh            # ruft scripts/umzug/nas-deploy.sh; --trocken zeigt nur
```

Es läuft dieselben fünf Schritte und fragt dieselben Dinge ab: einmal das SSH-Passwort am Anfang
und einmal sudo in Schritt 4.

| Schritt | Befehl | Prüfung |
|---|---|---|
| 1/5 | `ssh … uname -m`, Compose-Datei der NAS lesen | Architektur; **Update** (dort steht schon `autarktrade:produktiv`) oder **Wechsel** (dort steht noch die alte App) |
| 2/5 | `docker build --platform linux/amd64 -t autarktrade:produktiv .` | Architektur des Images; Frontend-Hash `assets/index-….js`; Revision |
| 3/5 | `docker save … \| gzip -1 \| ssh … 'cat > /tmp/.at-deploy-image.tar.gz'` | übertragene Grösse |
| 4/5 | `ssh -t …`: `sudo docker load`, (Wechsel: Compose tauschen), `sudo sh -c 'cd /volume1/docker/tradingjournal && docker compose -p tradingjournal up -d --force-recreate'`, `docker image prune -f` | – |
| 5/5 | `curl http://192.168.178.100:8080/` | liefert genau den Frontend-Hash von 2/5 |

- Das Tag `autarktrade:produktiv` gibt es nur auf der NAS. Das Skript bricht ab, wenn `TAG` oder
  `NAS_IMAGE_TAG` auf `mouses007/…` zeigt.
- `image prune` entfernt nur namenlose Images. `trading-journal:vor-v2-<datum>` hat einen Tag und
  bleibt für den Rückweg.
- **Wechsel** (nur beim ersten Lauf):
  - verlangt die Sicherung aus 1) und die gestoppte alte App aus 2);
  - zeigt den Unterschied der Compose-Dateien und die Variablen-Namen der Projekt-`.env`;
  - fragt einmal, bevor es tauscht.

## 4) Produktiv-Compose als Tausch im Projekt `tradingjournal`

Der Wechsel-Teil von `scripts/nas-deploy.sh`. Vorlage:
[`scripts/umzug/docker-compose.produktiv.yml`](../scripts/umzug/docker-compose.produktiv.yml).

**Gemessen auf der NAS (20.10.2026):** Die Compose-Datei heisst `compose.yaml`, und es gibt
**keine `.env`**. Die alte App hat Secret, DB-Zugang und Port direkt in `compose.yaml` stehen.
Die neue Compose liest sie aus `.env`. Deshalb legt das Skript beim Wechsel die `.env` **auf der
NAS** aus dem gestoppten alten Container an: nur `CTJ_*`, `AT_*` und `DB_*`, Rechte 600. Die
Werte verlassen die NAS nie und stehen in keinem Repo. Der Rückweg schiebt diese `.env` wieder
beiseite (`.env.v2-<datum>`).

> ⚠ **Der Projektordner `/volume1/docker/tradingjournal` ist zugleich das Datenverzeichnis der
> Live-Postgres** (`PG_VERSION`, `base/`, `pg_wal/` …). Dort nur die Compose-Datei und die
> `.env` anfassen, **nie** etwas löschen oder den Ordner verschieben, umbenennen oder
> „aufräumen". Das gilt ausdrücklich auch für die spätere Aufräum-Phase.

Vor der Frage zeigt das Skript:
- den Unterschied zur Compose-Datei auf der NAS (`diff -u`);
- die **Namen** der Variablen: aus der `.env`, oder, wenn sie fehlt, aus dem alten Container.

Es bricht ab, wenn kein `CTJ_SECRET`/`AT_SECRET` zu finden ist. Danach:

```bash
# nur wenn keine .env da ist (auf der NAS, Werte bleiben dort):
sudo sh -c "umask 077; docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' tradingjournal-trading-journal-1 | grep -E '^(CTJ_|AT_|DB_)' > /volume1/docker/tradingjournal/.env"
sudo cp /tmp/.at-v2-compose.yml /volume1/docker/tradingjournal/compose.yaml
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
| nichts ziehen | `pull_policy: never`. Im Container Manager **nicht** „Erstellen/Herunterladen“ drücken; neu aufspielen nur mit `scripts/nas-deploy.sh`. |

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

## Eigener Name im LAN: `autarktrade.local`

Die App ist zusätzlich unter **`http://autarktrade.local:8080`** erreichbar, ohne die NAS
umzubenennen und ohne Router-Eintrag. Der Dienst `mdns` im Compose-Projekt
(`server/mdns-name.mjs`, Host-Netz) beantwortet mDNS-Fragen nach genau diesem Namen mit der
IPv4 der NAS; der Host-Schutz der App gibt den Namen frei (`AT_MDNS_NAME`).
- Andere Name: `AT_MDNS_NAME=…​.local` in der Projekt-`.env`; abschalten mit `AT_MDNS_NAME=aus`.
- Falsche Adresse gewählt (mehrere Netze an der NAS): `AT_MDNS_IP=192.168.178.100` in die `.env`.
- Funktioniert auf Linux, macOS, iOS und Windows 10+. Manche Android-Browser lösen `.local`
  nicht auf; dort weiter die IP nutzen. ESP32 und Widget nutzen ohnehin die IP.
- Kommt mit dem nächsten `scripts/nas-deploy.sh`: das Update tauscht die Compose-Datei mit aus,
  wenn sie sich geändert hat (die vorige bleibt als `compose.yaml.vor-update-<datum>`).

## Updates ab jetzt

Nach dem Umzug ist **`scripts/nas-deploy.sh`** der normale Weg für jedes V2-Update. Aufruf,
Einstellungsdatei, Abfragen und Kontrolle sind dieselben wie bisher bei der alten App:

```bash
git pull                 # bzw. auf dem gewünschten Stand von master stehen
scripts/nas-deploy.sh    # baut, überträgt per SSH, erstellt das Projekt neu, prüft den Frontend-Hash
```

- Ohne Rückfrage: Die Compose-Datei auf der NAS nennt schon `autarktrade:produktiv`, also läuft der
  Update-Fall.
- Neue Migrationen laufen beim Start selbst. Vor grösseren Sprüngen (neue `SCHEMA_VERSION` in
  `server/database.js`) vorher `scripts/umzug/sichern.sh` laufen lassen, danach
  `scripts/umzug/pruefen.sh`.
- Im Container Manager **nicht** „Erstellen/Herunterladen“ drücken (`pull_policy: never`, das Tag
  liegt in keiner Registry). Der Update-Knopf in der App ist im Container ohne Wirkung (A2-10).
- Probelauf am 20.10.2026: erster Lauf als Wechsel, zweiter Lauf über `scripts/nas-deploy.sh` als
  Update ohne Rückfrage. 5/5 lieferte beide Male den gebauten Frontend-Hash.

## Nachher aufräumen (1–2 Wochen nach dem Umzug) — Stand: geplant, NICHT bereit

Ziel: Vom alten bleibt nichts übrig. Die Aufräum-Phase ist **nicht** fertig vorbereitet.

> ⚠ Seit der Messung vom 20.10.2026 gilt: Der Projektordner auf der NAS enthält die Datenbank.
> Jeder Aufräum-Schritt, der den Ordner `/volume1/docker/tradingjournal` löscht, verschiebt oder
> umbenennt, würde die Live-DB zerstören. Ein Umbenennen des Projekts darf nur die Compose-Datei
> in einen NEUEN Ordner legen, der Datenordner der Postgres bleibt, wo er ist. In der
Sitzung vom 20.10.2026 hat die Rechteprüfung zwei Teile abgelehnt; sie liegen dem Nutzer zur
Entscheidung vor:
- die Code-Änderung zu Schritt 3: Rückfall `CTJ_*` bei Sicherheitsschaltern, Zweck des
  Sitzungs-Tokens, Krypto-Seed;
- das Skript, das die Live-DB und ihre Rolle umbenennt und alte Container und Ordner löscht
  (Schritte 1 und 2).

Ein Entwurf `scripts/umzug/nachher-aufraeumen.sh` liegt **uncommitted** im Worktree
`.claude/worktrees/f4-endpruefung-95d718`. Er ist ungetestet und nicht auf master.

| Schritt | Inhalt | Stand |
|---|---|---|
| 1 | alte Container/Images auf NAS und Rechner (`mouses007/trading-journal:*`, `trading-journal:*`, `crypto-trading-journal`) entfernen, vorher V2 läuft + Sicherung ≤ 24 h; `Journal/` als tar.gz (ohne `node_modules`, Rechte 600), Löschen nur angeboten | Entwurf, ungetestet |
| 2 | Projekt `tradingjournal` → `autarktrade` (neuer Ordner `/volume1/docker/autarktrade`, alter bleibt für den Rückweg), DB und Rolle `tradejournal` → `autarktrade` über eine Hilfsrolle (die Sitzungsrolle kann sich nicht selbst umbenennen; nur mit SCRAM-Passwort, md5 hängt am Namen), Container `tradejournal-db` → `autarktrade-db`, `.env` `CTJ_*` → `AT_*`, V2-Caddyfile, Einstellungen hier nachziehen, `LIVE_DB_NAME` für `v2-container.sh`; Rückweg `--rueckweg 2`. Vorher muss die DB-Kopie `autarktrade` (8091) weg sein. | Entwurf, ungetestet |
| 3 | Schalter `AT_ALTE_KENNUNGEN=aus`: kein `CTJ_*`-Rückfall (`server/umgebung.js`), kein Seed `tradenote-…` (`server/crypto.js`, `server/reencrypt-keys.mjs`), Token-Zweck `at_sitzung_v1` (`server/auth.js`), Rekorder schreibt `AT01`/liest `CTJ1` (`server/live-recorder.js`), Browser zieht `ctj.chart.indBoxOffen`, `ctj.chart.positionenAus`, `ctj.handelslage.autoMin` nach `at.*` (über `GET /api/system/modus`); Daten: neues `AT_SECRET`, Umschlüsseln im Container mit `AT_SECRET_ALT=<altes>` und `node server/reencrypt-keys.mjs --apply` | **nicht umgesetzt** — Code-Änderung abgelehnt, braucht Freigabe |
| 4 | Tabellen-/Feldnamen (`satisfactions`, `excursions`, `blotter`, `pAndL`, `objectId`, `td`, …) | **nicht umgesetzt, bewusst** — siehe unten |
| 5 | `scripts/historie-neu-wurzeln.sh` aufrufen; Befehle für das alte Repo (`gh repo edit Mouses007/Crypto-Trading-Journal --visibility private …` bzw. `gh repo delete …`) und das Docker-Hub-Image `mouses007/trading-journal` nur ausgeben | Entwurf; das Historien-Skript selbst ist fertig (F4) |

**Schritt 4, Aufwand (gezählt am 20.10.2026, ohne Selbsttests):**

| Name | Stellen | Dateien |
|---|---|---|
| `pAndL` | 128 | 23 |
| `blotter` | 75 | 14 |
| `excursions` | 65 | 18 |
| `satisfactions` | 29 | 12 |
| `objectId` | 188 | 32 |
| `td` (Feld, zusammen mit HTML-`<td>` gezählt) | bis 773 | 51 |

Dazu kommt das JSON in **jeder** gespeicherten Tageszeile (`trades.trades/blotter/pAndL`), beide
Golden Master, das Backup-Format (Ex-/Import alter Sicherungen), ESP32 und das Android-Widget.

Als Einzelschritt ist das zu riskant:
- Ein vergessenes Feld rechnet still mit `undefined` weiter. Die Golden Master würden es zeigen,
  aber nur für die Pfade, die sie abdecken.
- Ein Rückweg müsste jede Zeile zurückschreiben.
- Der Nutzen ist kosmetisch: Es sind Datenmodell-Namen, kein übernommener Ausdruck (A3-25/26).

Empfehlung, falls gewünscht: ein eigener Auftrag mit Spezifikation, Migration v30 mit doppeltem
Lesen (alter und neuer Name), Golden Master neu einfrieren und Probelauf an einer DB-Kopie.

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
