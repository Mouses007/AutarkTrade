# Gemeinsame Teile der Umzugs-Skripte (U1). Wird eingelesen, nicht ausgeführt.
#
# Alle Skripte unter scripts/umzug/ halten sich an drei Regeln:
#   1. Zugangsdaten und Ziele NUR aus scripts/umzug/.env (Vorlage .env.beispiel,
#      nicht im Git). Kein Wert ist hier fest verdrahtet.
#   2. --trocken zeigt jeden Befehl, führt aber nichts aus, was etwas verändert.
#      Lesende Befehle (Status, Logs) laufen auch im Trockenlauf.
#   3. Vor jedem Eingriff eine Ja-Abfrage; nur die Antwort „ja" zählt.
#
# NAS_HOST=lokal führt alles auf DIESEM Rechner aus (Probelauf mit Wegwerf-
# Containern); sonst über EINE SSH-Verbindung zur NAS, Docker per sudo.

set -euo pipefail

UMZUG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WURZEL="$(cd "$UMZUG_DIR/../.." && pwd)"
TROCKEN="${TROCKEN:-0}"
JA_ALLE="${JA_ALLE:-0}"   # nur für umzug.sh: die Teilskripte nicht doppelt fragen lassen

for _arg in "$@"; do
    case "$_arg" in
        --trocken) TROCKEN=1 ;;
    esac
done
export TROCKEN

ENV_DATEI="${UMZUG_ENV:-$UMZUG_DIR/.env}"
if [ ! -f "$ENV_DATEI" ]; then
    echo "Fehlt: $ENV_DATEI — Vorlage: cp $UMZUG_DIR/.env.beispiel $UMZUG_DIR/.env" >&2
    exit 1
fi
# shellcheck disable=SC1090
set -a; . "$ENV_DATEI"; set +a

: "${NAS_HOST:?NAS_HOST fehlt in .env}"
: "${NAS_PROJEKT:?NAS_PROJEKT fehlt in .env}"
NAS_USER="${NAS_USER:-}"
NAS_DOCKER="${NAS_DOCKER:-docker}"
NAS_SUDO="${NAS_SUDO-sudo}"
NAS_TMP="${NAS_TMP:-/tmp}"
COMPOSE_PROJEKT="${COMPOSE_PROJEKT:-$(basename "$NAS_PROJEKT")}"
APP_DIENST="${APP_DIENST:-trading-journal}"
APP_PORT="${APP_PORT:-8080}"
TLS_PORT="${TLS_PORT:-8443}"
DB_CONTAINER="${DB_CONTAINER:-tradejournal-db}"
DB_NAME="${DB_NAME:-tradejournal}"
DB_USER="${DB_USER:-tradejournal}"
V2_TAG="${V2_TAG:-autarktrade:produktiv}"
SICHERUNG_LOKAL="${SICHERUNG_LOKAL:-$HOME/AutarkTrade-Sicherungen}"
PG_IMAGE="${PG_IMAGE:-postgres:17}"
STAND_DATEI="${STAND_DATEI:-$SICHERUNG_LOKAL/umzug-stand.env}"

# Schutz: das öffentliche Image der alten App ist NIE ein Ziel für V2.
case "$V2_TAG" in
    mouses007/*|docker.io/*|*/trading-journal*) echo "Abbruch: V2_TAG=$V2_TAG zeigt auf ein öffentliches bzw. das alte Image." >&2; exit 1 ;;
esac

rot()   { printf '\033[91m%s\033[0m\n' "$*"; }
gruen() { printf '\033[92m%s\033[0m\n' "$*"; }
gelb()  { printf '\033[93m%s\033[0m\n' "$*"; }
kopf()  { printf '\n\033[96m== %s ==\033[0m\n' "$*"; }
abbruch() { rot "ABBRUCH: $*"; exit 1; }

# Ja-Abfrage. Im Trockenlauf: nie ausführen.
frage() {
    if [ "$TROCKEN" = 1 ]; then
        gelb "  (trocken) würde fragen: $1 — nicht ausgeführt"
        return 1
    fi
    if [ "$JA_ALLE" = 1 ]; then return 0; fi
    local antwort=""
    printf '\033[93m%s\033[0m [ja/nein] ' "$1"
    if [ -t 0 ] || ! { : </dev/tty; } 2>/dev/null; then read -r antwort || true
    else read -r antwort </dev/tty || true; fi
    [ "$antwort" = "ja" ]
}

# ── Befehle „auf der NAS" ────────────────────────────────────────
if [ "$NAS_HOST" = lokal ]; then
    ZIEL="(lokal)"
    nas() { sh -c "$1" </dev/null; }
    nas_ein() { sh -c "$1"; }
    nas_tty() { sh -c "$1"; }
    nas_ende() { :; }
else
    : "${NAS_USER:?NAS_USER fehlt in .env}"
    ZIEL="$NAS_USER@$NAS_HOST"
    STEUERUNG="/tmp/.at-umzug-$(id -u)-%C"
    SSH_OPT=(-o ControlMaster=auto -o "ControlPath=$STEUERUNG" -o ControlPersist=1800 -o ConnectTimeout=10)
    # stdin nur, wo gewollt (nas_ein) — sonst frässe ssh die Ja-Antworten einer Pipe.
    nas() { command ssh -n "${SSH_OPT[@]}" "$ZIEL" "$1"; }
    nas_ein() { command ssh "${SSH_OPT[@]}" "$ZIEL" "$1"; }
    nas_tty() { command ssh -t "${SSH_OPT[@]}" "$ZIEL" "$1"; }
    nas_ende() { command ssh "${SSH_OPT[@]}" -O exit "$ZIEL" 2>/dev/null || true; }
    trap nas_ende EXIT
    # Eine Master-Verbindung: nur EINE Passwortabfrage für SSH.
    command ssh "${SSH_OPT[@]}" -O check "$ZIEL" 2>/dev/null || command ssh "${SSH_OPT[@]}" -fN "$ZIEL"
fi

# Docker auf der NAS, mit sudo (DSM legt docker nicht in den PATH einer SSH-Sitzung).
D="${NAS_SUDO:+$NAS_SUDO }$NAS_DOCKER"
dk() { nas "$D $1"; }

# Befehl nur anzeigen (vor einer Frage).
zeige() { echo "  \$ $1"; }

# Verändernder Befehl: anzeigen und — ausser im Trockenlauf — ausführen.
# Nur NACH einer bejahten Frage verwenden.
tue() {
    echo "  \$ $1"
    [ "$TROCKEN" = 1 ] && return 0
    nas_tty "$1"
}

# psql in der DB auf der NAS. SQL über stdin, damit Anführungszeichen ("schemaVersion")
# nicht durch zwei Shells müssen. Ausgabe ohne Kopf, Felder mit |.
psql_nas() {
    printf '%s\n' "$1" | nas_ein "$D exec -i $DB_CONTAINER psql -X -q -A -t -v ON_ERROR_STOP=1 -U $DB_USER -d ${2:-$DB_NAME} -f -"
}

# Container des App-Dienstes im Compose-Projekt (läuft oder gestoppt).
app_container() {
    dk "ps -a --filter label=com.docker.compose.project=$COMPOSE_PROJEKT --filter label=com.docker.compose.service=$APP_DIENST --format '{{.Names}}'" | head -1
}

# Merkzettel zwischen den Schritten (lokal, neben den Sicherungen).
merke() {
    [ "$TROCKEN" = 1 ] && { echo "  (trocken) würde merken: $1=$2"; return 0; }
    mkdir -p "$SICHERUNG_LOKAL"
    touch "$STAND_DATEI"
    grep -v "^$1=" "$STAND_DATEI" > "$STAND_DATEI.neu" || true
    printf '%s=%q\n' "$1" "$2" >> "$STAND_DATEI.neu"
    mv "$STAND_DATEI.neu" "$STAND_DATEI"
}
lies_stand() {
    # shellcheck disable=SC1090
    [ -f "$STAND_DATEI" ] && . "$STAND_DATEI" || true
}

DATUM="$(date +%Y%m%d-%H%M)"
echo "Ziel: $ZIEL · Projekt $NAS_PROJEKT ($COMPOSE_PROJEKT/$APP_DIENST) · DB $DB_CONTAINER/$DB_NAME$( [ "$TROCKEN" = 1 ] && echo ' · TROCKENLAUF')"
