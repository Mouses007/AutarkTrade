# Docker-Installation — AutarkTrade

## Voraussetzungen

- Docker und Docker Compose installiert
- Das Repository (öffentlich, AGPL-3.0): https://github.com/Mouses007/AutarkTrade
- Image: `ghcr.io/mouses007/autarktrade:latest` (öffentlich, amd64 und arm64)

## Schnellstart (mit externer PostgreSQL)

Wenn du bereits eine PostgreSQL-Datenbank hast (z.B. auf dem NAS), verbindet sich der Container direkt dorthin. Deine bestehende Datenbank wird unverändert übernommen.

```bash
# 1. Repository klonen
git clone https://github.com/Mouses007/AutarkTrade.git autarktrade
cd autarktrade

# 2. Konfiguration anlegen
cp .env.example .env
```

Passe die `.env` an deine PostgreSQL-Zugangsdaten an:

```env
AT_PORT=8080
DB_TYPE=postgresql
DB_HOST=<adresse-der-datenbank>
DB_PORT=5432
DB_USER=autarktrade
DB_PASSWORD=dein_passwort
DB_NAME=autarktrade
```

```bash
# 3. Image holen und Container starten
docker compose pull
docker compose up -d

# 4. Öffne im Browser
# http://localhost:8080
```

Fertig. Der Container liest deine bestehende PostgreSQL-Datenbank mit allen Trades, Einstellungen und Daten.

## Befehle

```bash
# Starten
docker compose up -d

# Stoppen
docker compose down

# Logs anzeigen
docker compose logs -f journal

# Neu bauen nach Update
git pull
docker compose up -d --build

# Container-Status prüfen
docker compose ps
```

## Update

```bash
docker compose pull
docker compose up -d
```

Das holt das neueste Image und startet den Container neu. Wer selbst baut: `git pull && docker compose up -d --build`. Die Datenbank (extern auf PostgreSQL) bleibt unberührt.

## Sicherheit (seit F2, 20.10.2026)

- **Benutzer:** Die App läuft im Container als `node` (uid 1000), nicht als root. Der Einstieg übernimmt beim ersten Start ein bestehendes, root-eigenes `/app/data` automatisch (`chown`), danach gibt er die Rechte ab. Lässt ein eingebundenes Verzeichnis das nicht zu (z. B. NFS mit root_squash), steht eine Warnung im Log; dann in Compose `user: "<uid>:<gid>"` des Verzeichnis-Besitzers setzen — der Einstieg läuft dann gleich unter diesem Benutzer.
- **Docker-Socket:** steht nicht mehr in der `docker-compose.yml`. Er war root-gleich auf dem Host, und das Klick-Update war im Container nie auslösbar (es verlangt localhost). Update: `docker compose pull && docker compose up -d` bzw. wie oben neu bauen. Eine alte Compose-Datei mit dem Mount funktioniert weiter; der Mount bringt nur nichts.
- **Proxy:** Seit 26.10.2026 macht die App HTTPS selbst (Abschnitt unten), die Vorgabe ist `AT_TRUST_PROXY=0`: die Login-Sperre zählt nach Peer-IP. Wer trotzdem einen eigenen Reverse-Proxy vorschaltet, setzt `AT_TRUST_PROXY=1` und in `AT_TRUSTED_PROXY` dessen Dienstnamen oder IP — `X-Forwarded-For` zählt nur von dort (sonst landen alle Klienten hinter dem Proxy in einem Eimer). Port 8080 bleibt im LAN erreichbar (ESP32-Display).
- **Erstes Passwort:** Ein neuer Container ohne Passwort verlangt beim „Passwort festlegen" den Einrichtungscode aus `docker compose logs journal`.
- **Bestehende Installationen** mit gesetztem Passwort und `AT_SECRET` merken nichts: Anmeldung, Börsenschlüssel und Sitzungen bleiben gültig.

## Sicherheit (seit Audit D, 26.10.2026)

- **Laufzeit:** Node 22 LTS (`node:22-slim`); Node 20 bekommt seit 30.04.2026 keine Sicherheitsupdates mehr.
- **Dateirechte im Image:** `/app` und alles darin gehört root, die App liest es nur. Schreiben darf `node` nur in `/app/data` (SQLite, `db-config.json`) und in `server/strategies` (Strategie-Baukasten). `/app/db-config.json`, `/app/autarktrade.db` und `/app/tradenote.db` sind root-eigene Verweise in den Datenordner. Der Einstieg schreibt `db-config.json` selbst als `node` (per `JSON.stringify`, Sonderzeichen im Passwort sind kein Problem mehr).
- **Compose-Härtung:** `no-new-privileges` und `cap_drop: [ALL]`. `journal` behält nur, was der Einstieg als root braucht (`CHOWN`, `DAC_OVERRIDE`, `FOWNER`, `SETUID`, `SETGID`); HTTPS auf 8443 braucht keine zusätzliche Fähigkeit. Wer eine eigene Compose-Datei pflegt, kann die Zeilen übernehmen.

## Hinweise

- Der Container bindet auf `0.0.0.0`, ist also im Netzwerk erreichbar
- Über `AT_PORT` in der `.env` kann der Port geändert werden
- Die `.env`-Datei ist in `.gitignore` und wird nicht committed
- **Datenbank:** Die `docker-compose.yml` setzt `DB_TYPE=postgresql`, wenn die `.env` nichts anderes sagt (auch bei leerem Wert). Für SQLite `DB_TYPE=sqlite` in die `.env` schreiben; die Datei liegt dann im Volume `autarktrade_data` (`/app/data`) und übersteht `docker compose up -d --force-recreate` und Updates. Nur ein `docker compose down -v` löscht sie. Wer den Container ohne diese Compose-Datei startet und weder `DB_TYPE` noch ein Volume setzt, bekommt SQLite im Container — das geht beim Neuerstellen verloren.

## HTTPS für den LAN-Zugriff (eingebaut, eigene CA)

`http://<nas-ip>:8080` reicht zum Ansehen, aber Browser verweigern darüber
einiges: Benachrichtigungen (Chrome erlaubt `Notification.requestPermission()`
nur in einem „secure context" — HTTPS oder `localhost`), und Passwort und
Sitzung gehen unverschlüsselt durchs Netz. Seit 26.10.2026 macht die App HTTPS
selbst — ohne Caddy, ohne mkcert, ohne Zertifikatsdateien:

- Beim ersten Start legt sie eine eigene **Stamm-CA** an („AutarkTrade Lokale
  CA (<ID>)", ECDSA P-256, 10 Jahre) und stellt sich damit ein
  **Server-Zertifikat** aus (397 Tage). Beides liegt in der Datenbank (Tabelle
  `tls_zertifikat`), die privaten Schlüssel verschlüsselt mit `AT_SECRET`. Ein
  Volume ist dafür nicht nötig. Teilen sich zwei Prozesse eine PostgreSQL,
  entsteht trotzdem nur eine CA.
- Ein **HTTPS-Server** lauscht neben HTTP auf `AT_TLS_PORT` (Vorgabe `8443`,
  `aus` schaltet ab) — dieselbe App, derselbe Passwortschutz. Port 8080 bleibt
  für ESP32-Displays und alte Klienten; die Oberfläche weist auf HTTPS hin.
- Das Server-Zertifikat wird **automatisch erneuert** (täglich geprüft: weniger
  als 30 Tage Rest oder ein fehlender Name) und ohne Neustart aktiv.
- Das Backup (JSON-Export) enthält die CA **nicht** — ihr Schlüssel verlässt
  die Datenbank nie. Nach einer Rücksicherung in eine leere Datenbank entsteht
  eine neue CA, die Geräte vertrauen ihr einmal neu.

### 1. Namen und IPs im Zertifikat

Immer drin: `localhost`, `127.0.0.1`, `::1` und der mDNS-Name (`AT_MDNS_NAME`,
Vorgabe `autarktrade.local`). Im Container kennt die App die Adresse des Hosts
nicht — deshalb:

- `AT_TLS_NAMEN` in der `.env` (Komma-Liste), z. B. `AT_TLS_NAMEN=192.168.178.100`;
- oder unter **Einstellungen › Allgemein › HTTPS** eintragen. Dort stehen auch
  **Vorschläge**: die Adressen, unter denen die App tatsächlich aufgerufen wurde
  (nur was der Host-Schutz zulässt). Aufgenommen wird ein Vorschlag erst nach
  Bestätigung.

### 2. Der CA einmal je Gerät vertrauen

Unter **Einstellungen › Allgemein › HTTPS** „CA herunterladen" (die Datei
`AutarkTrade-CA-<ID>.crt`), installieren und den dort angezeigten
**Fingerabdruck** (SHA-256) vergleichen. Kurze Anleitungen für Android,
Windows, Linux/Firefox und macOS/iOS stehen gleich daneben. Danach
`https://<nas-ip>:8443` öffnen.

Ohne Sitzung abrufbar (ein CA-Zertifikat ist öffentlich, Geräte brauchen es
vor der Anmeldung):

| Pfad | Antwort |
|---|---|
| `GET /api/tls/ca.crt` | DER, `application/x-x509-ca-cert`, Dateiname `AutarkTrade-CA-<ID>.crt` |
| `GET /api/tls/ca` | JSON `{ "pem": "-----BEGIN CERTIFICATE-----…", "sha256": "AB:CD:…" }` |
| `GET /api/esp32/ca` | dasselbe JSON (Pfad der Geräte) |

`sha256` ist SHA-256 über das DER des CA-Zertifikats, hex in Grossbuchstaben
mit Doppelpunkten — derselbe Wert wie `openssl x509 -noout -fingerprint -sha256`.

### 3. Port

Die App lauscht im Container auf `8443`; den Host-Port bestimmt `AT_TLS_PORT`
in der `.env` (Mapping `${AT_TLS_PORT:-8443}:8443`). NICHT 443 — die
Synology-DSM belegt 443 (und 80) selbst mit ihrem nginx.

### 4. Neue CA

Nur wenn der CA-Schlüssel unlesbar ist (`AT_SECRET` geändert) oder in fremde
Hände geraten sein könnte: Einstellungen › Allgemein › HTTPS › „Neue CA
erzeugen". Danach muss JEDES Gerät der neuen CA neu vertrauen.

### Umstieg von Caddy + mkcert

Den `caddy`-Dienst und sein Volume aus der Compose-Datei entfernen, an der App
`"${AT_TLS_PORT:-8443}:8443"` veröffentlichen, `AT_TLS_NAMEN=<nas-ip>` setzen
und `AT_TRUST_PROXY` abschalten (kein Proxy mehr davor). `Caddyfile` und
`certs/` werden nicht mehr gebraucht. Die alte mkcert-CA kann auf den Geräten
entfernt werden, sobald sie der neuen vertrauen. Wer lieber weiter einen
eigenen Reverse-Proxy betreibt, kann das — mit `AT_TLS_PORT=aus`,
`AT_TRUST_PROXY=1` und `AT_TRUSTED_PROXY=<Proxy-Name>`.
