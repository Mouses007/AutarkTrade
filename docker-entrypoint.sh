#!/bin/sh
set -e

# Läuft als root (Vorgabe) oder schon als anderer Benutzer (`user:` in Compose).
# Als root schreibt der Einstieg NIE in Pfade, die `node` kontrolliert (Audit
# SEC-OPS-004): was in /app/data entsteht, schreibt `node` selbst (als_node).
als_node() {
    if [ "$(id -u)" = "0" ]; then
        setpriv --reuid=node --regid=node --init-groups -- "$@"
    else
        "$@"
    fi
}

# ── Datenvolume übernehmen (Audit A2-10, F2) ─────────────────────────
# Ältere Installationen haben /app/data als root angelegt — ohne das wäre die
# SQLite-Datei nach dem Update nicht mehr schreibbar. `chown -R` folgt keinen
# Symlinks (-P ist Vorgabe).
if [ "$(id -u)" = "0" ] && [ -d /app/data ] && [ "$(stat -c %u /app/data)" != "$(id -u node)" ]; then
    echo "-> /app/data gehört noch root — Eigentum an den Dienstbenutzer node übergeben"
    chown -R node:node /app/data || echo "-> WARNUNG: Eigentum von /app/data nicht übertragbar — in Compose user: \"<uid>:<gid>\" des Volume-Besitzers setzen"
fi

# db-config.json aus Umgebungsvariablen erzeugen (wenn DB_TYPE gesetzt).
# Per JSON.stringify (Audit SEC-OPS-012): ein " oder \ im Passwort zerbrach
# früher das handgeschriebene JSON. Ziel ist /app/data/db-config.json, auf das
# der root-eigene Verweis /app/db-config.json zeigt; geschrieben über eine
# frische Datei (0600) und rename, als `node`.
if [ "$DB_TYPE" = "postgresql" ]; then
    als_node node -e '
const fs = require("fs")
const e = process.env
const port = Number(e.DB_PORT || 5432)
const konfig = {
    type: "postgresql",
    host: e.DB_HOST || "localhost",
    port: Number.isInteger(port) && port > 0 ? port : 5432,
    user: e.DB_USER || "autarktrade",
    password: e.DB_PASSWORD || "",
    database: e.DB_NAME || "autarktrade",
}
const ziel = "/app/data/db-config.json"
const neu = ziel + ".neu"
fs.rmSync(neu, { force: true })
fs.writeFileSync(neu, JSON.stringify(konfig, null, 2) + "\n", { mode: 0o600, flag: "wx" })
fs.renameSync(neu, ziel)
'
    echo "-> PostgreSQL: ${DB_HOST:-localhost}:${DB_PORT:-5432}/${DB_NAME:-autarktrade}"
else
    # Die Verweise /app/autarktrade.db und /app/tradenote.db legt schon das Image
    # an (Dockerfile); SQLite löst sie auf, -wal/-shm liegen daneben im Volume.
    # Ein Volume aus der Zeit vor AutarkTrade hat noch tradenote.db — dann bleibt
    # es dabei (server/db-config.js nimmt die alte Datei, wenn nur sie da ist).
    if [ -f /app/data/tradenote.db ] && [ ! -f /app/data/autarktrade.db ]; then
        echo "-> SQLite: /app/data/tradenote.db (Altbestand)"
    else
        echo "-> SQLite: /app/data/autarktrade.db"
    fi
fi

# ── Rechte abgeben (Audit A2-10, F2) ─────────────────────────────────
# Als root gestartet: als `node` weiter. Läuft der Container schon als anderer
# Benutzer (`user:` in Compose), bleibt es dabei.
if [ "$(id -u)" = "0" ]; then
    exec setpriv --reuid=node --regid=node --init-groups -- "$@"
fi

exec "$@"
