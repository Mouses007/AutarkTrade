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
DB_HOST=192.168.178.100
DB_PORT=5433
DB_USER=tradejournal
DB_PASSWORD=dein_passwort
DB_NAME=tradejournal
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
- **Proxy:** `AT_TRUST_PROXY=1` wertet `X-Forwarded-For` nur noch für Verbindungen von `AT_TRUSTED_PROXY` aus (Vorgabe `caddy,autarktrade-caddy`). Heisst der Caddy-Dienst anders (Synology-Projekt), dessen Namen eintragen — sonst zählt die Login-Sperre hinter Caddy wieder alle Klienten in einem Eimer (sperrt, aber nicht aus). Port 8080 bleibt im LAN erreichbar (ESP32-Display).
- **Erstes Passwort:** Ein neuer Container ohne Passwort verlangt beim „Passwort festlegen" den Einrichtungscode aus `docker compose logs journal`.
- **Bestehende Installationen** mit gesetztem Passwort und `AT_SECRET` merken nichts: Anmeldung, Börsenschlüssel und Sitzungen bleiben gültig.

## Hinweise

- Der Container bindet auf `0.0.0.0`, ist also im Netzwerk erreichbar
- Über `AT_PORT` in der `.env` kann der Port geändert werden
- Die `.env`-Datei ist in `.gitignore` und wird nicht committed
- Wenn `DB_TYPE` nicht gesetzt oder leer ist, verwendet der Container SQLite (lokal im Container — nur für Tests geeignet)

## HTTPS für den LAN-Zugriff (Caddy + mkcert)

`http://<nas-ip>:8080` reicht zum Ansehen, aber Browser verweigern darüber
zwei Dinge: das Anfragen der Notification-Berechtigung (Chrome erlaubt
`Notification.requestPermission()` nur in einem „secure context" — HTTPS
oder `localhost`) und markieren die Adresse als „Nicht sicher". Docker-Compose
bringt dafür optional einen [Caddy](https://caddyserver.com/)-Container mit,
der TLS mit einem selbst erzeugten [mkcert](https://github.com/FiloSottile/mkcert)-Zertifikat
terminiert und intern an `journal:8080` weiterreicht. Rein additiv: Port 8080
bleibt unverändert per HTTP erreichbar (u.a. fürs ESP32-Display, das kein TLS
spricht).

### 1. Zertifikat erzeugen (auf dem Rechner, der das Dashboard im Browser öffnet)

```bash
# mkcert installieren (Ubuntu/Debian/Mint; für macOS: brew install mkcert)
sudo apt-get install -y mkcert libnss3-tools

# Lokale CA anlegen und im System- sowie Firefox/Chrome-Truststore vertrauen
mkcert -install

# Zertifikat für die NAS-Adresse erzeugen (im Projektordner)
mkcert -cert-file certs/nas.pem -key-file certs/nas-key.pem 192.168.178.100 localhost
```

`certs/` ist in `.gitignore` — Zertifikat und Schlüssel bleiben lokal.

Für JEDES weitere Gerät, das das grüne Schloss zeigen soll (Handy, anderer
Laptop): die Root-CA (`rootCA.pem`, Pfad über `mkcert -CAROOT`) dorthin
kopieren und dort ebenfalls installieren/vertrauen — mkcert kennt nur das
Gerät, auf dem `-install` lief. Ohne diesen Schritt bleibt es dort bei einer
einmaligen Klick-durch-Warnung, das ist bei einer selbst verwalteten CA nicht
zu vermeiden (eine öffentlich vertrauenswürdige CA wie Let's Encrypt scheidet
ohne öffentlichen Domainnamen aus).

### 2. Auf die NAS bringen

`Caddyfile` sowie `certs/nas.pem` + `certs/nas-key.pem` neben die
`docker-compose.yml` im NAS-Projektordner kopieren, dann:

```bash
docker compose up -d
```

Das startet nur den neu hinzugekommenen `caddy`-Container — der laufende
`journal`-Container wird nicht neu gestartet.

### 3. Port

Caddy hört standardmässig auf `8443` (`AT_TLS_PORT` in der `.env`), NICHT auf
443 — die Synology-DSM belegt 443 (und 80) bereits selbst mit ihrem eigenen
nginx. Das Journal ist danach unter `https://<nas-ip>:8443` erreichbar.
