#!/bin/sh
set -e

# db-config.json aus Umgebungsvariablen generieren (wenn DB_TYPE gesetzt)
if [ "$DB_TYPE" = "postgresql" ]; then
    cat > /app/db-config.json <<EOF
{
  "type": "postgresql",
  "host": "${DB_HOST:-localhost}",
  "port": ${DB_PORT:-5432},
  "user": "${DB_USER:-autarktrade}",
  "password": "${DB_PASSWORD:-}",
  "database": "${DB_NAME:-autarktrade}"
}
EOF
    echo "-> PostgreSQL: ${DB_HOST:-localhost}:${DB_PORT:-5432}/${DB_NAME:-autarktrade}"
else
    # Symlink damit SQLite in den persistenten Volume-Ordner schreibt.
    # Ein Volume aus der Zeit vor AutarkTrade hat noch tradenote.db — dann
    # bleibt es dabei (server/db-config.js nimmt die alte Datei, wenn nur sie da ist).
    if [ -f /app/data/tradenote.db ] && [ ! -f /app/data/autarktrade.db ]; then
        echo "-> SQLite: /app/data/tradenote.db (Altbestand)"
        [ -e /app/tradenote.db ] || ln -sf /app/data/tradenote.db /app/tradenote.db
    else
        echo "-> SQLite: /app/data/autarktrade.db"
        if [ ! -f /app/autarktrade.db ] && [ -d /app/data ]; then
            ln -sf /app/data/autarktrade.db /app/autarktrade.db
        fi
    fi
fi

# ── Rechte abgeben (Audit A2-10, F2) ─────────────────────────────────
# Als root gestartet: Eigentum nachziehen, dann als `node` weiter. Läuft der
# Container schon als anderer Benutzer (`user:` in Compose), bleibt es dabei.
if [ "$(id -u)" = "0" ]; then
    [ -f /app/db-config.json ] && chown node:node /app/db-config.json && chmod 600 /app/db-config.json
    if [ -d /app/data ] && [ "$(stat -c %u /app/data)" != "$(id -u node)" ]; then
        echo "-> /app/data gehört noch root — Eigentum an den Dienstbenutzer node übergeben"
        chown -R node:node /app/data
    fi
    # Selbst gesetzte Symlinks zeigen ins Volume; die Verknüpfung selbst darf root gehören.
    exec setpriv --reuid=node --regid=node --init-groups -- "$@"
fi

exec "$@"
