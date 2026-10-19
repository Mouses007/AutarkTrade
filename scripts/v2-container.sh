#!/usr/bin/env bash
# Testcontainer der V2 (AutarkTrade) bauen und neu starten.
#
#   ./scripts/v2-container.sh            Build + Stop/Rm + Run
#   ./scripts/v2-container.sh --ohne-build   nur neu starten (Image steht schon)
#
# Läuft IMMER im Testbetrieb (AT_TESTBETRIEB=1): die Datenbank `autarktrade`
# ist eine Kopie der Live-DB mit echten Börsenschlüsseln. Engine und Rekorder
# sind zusätzlich einzeln abgeschaltet — doppelt hält besser. (Einen
# Stop-Wächter gibt es seit S13 nicht mehr; AT_NO_GUARD ist entfallen.)
#
# Zugangsdaten stehen NICHT hier, sondern in scripts/.v2-container.env (nicht
# im Repository), z. B.:
#   DB_HOST=192.168.178.100
#   DB_PORT=5433
#   DB_NAME=autarktrade
#   DB_USER=…
#   DB_PASSWORD=…
#   AT_SECRET=…        # derselbe Wert wie CTJ_SECRET der Live-Instanz,
#                      # sonst sind die kopierten Schlüssel unlesbar
#
# Der Live-Container crypto-trading-journal (Port 8080) bleibt unberührt.
set -euo pipefail

HIER="$(cd "$(dirname "$0")" && pwd)"
WURZEL="$(cd "$HIER/.." && pwd)"
ENV_DATEI="$HIER/.v2-container.env"
NAME="${NAME:-autarktrade-v2}"
IMAGE="${IMAGE:-autarktrade:v2-test}"
PORT="${PORT:-8091}"

if [ ! -f "$ENV_DATEI" ]; then
    echo "Fehlt: $ENV_DATEI (Vorlage im Kopf dieses Skripts)" >&2
    exit 1
fi
# shellcheck disable=SC1090
set -a; . "$ENV_DATEI"; set +a

if [ "${DB_NAME:-}" = "tradejournal" ]; then
    echo "Abbruch: DB_NAME zeigt auf die LIVE-Datenbank. V2 läuft nur gegen die Kopie." >&2
    exit 1
fi

if [ "${1:-}" != "--ohne-build" ]; then
    echo "-> Baue $IMAGE"
    docker build -t "$IMAGE" "$WURZEL"
fi

echo "-> Ersetze Container $NAME"
docker stop "$NAME" >/dev/null 2>&1 || true
docker rm "$NAME" >/dev/null 2>&1 || true

docker run -d --name "$NAME" --restart unless-stopped \
    -p "$PORT:8080" \
    -e DB_TYPE=postgresql \
    -e DB_HOST="$DB_HOST" -e DB_PORT="$DB_PORT" -e DB_NAME="$DB_NAME" \
    -e DB_USER="$DB_USER" -e DB_PASSWORD="$DB_PASSWORD" \
    -e AT_SECRET="$AT_SECRET" \
    -e AT_HOST=0.0.0.0 -e AT_PORT=8080 \
    -e AT_TESTBETRIEB=1 -e AT_NO_ENGINE=1 -e AT_NO_RECORDER=1 \
    "$IMAGE" >/dev/null

echo "-> Läuft: http://localhost:$PORT  (Logs: docker logs -f $NAME)"
