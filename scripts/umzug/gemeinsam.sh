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

# Einstellungen: dieselbe Datei wie das gewohnte Update-Skript (scripts/.nas-deploy.env:
# NAS_HOST, NAS_USER, NAS_PROJEKT, NAS_PORT), dazu optional scripts/umzug/.env für
# alles, was nur der Umzug braucht. UMZUG_ENV ersetzt beide (Probelauf).
if [ -n "${UMZUG_ENV:-}" ]; then
    ENV_DATEIEN=("$UMZUG_ENV")
else
    ENV_DATEIEN=("$WURZEL/scripts/.nas-deploy.env" "$UMZUG_DIR/.env")
fi
_gelesen=0
for _d in "${ENV_DATEIEN[@]}"; do
    # shellcheck disable=SC1090
    [ -f "$_d" ] && { set -a; . "$_d"; set +a; _gelesen=1; }
done
if [ "$_gelesen" = 0 ]; then
    echo "Fehlt: scripts/.nas-deploy.env (wie im alten Repo) bzw. scripts/umzug/.env — Vorlage: scripts/umzug/.env.beispiel" >&2
    exit 1
fi
APP_PORT="${APP_PORT:-${NAS_PORT:-8080}}"

: "${NAS_HOST:?NAS_HOST fehlt in .env}"
: "${NAS_PROJEKT:?NAS_PROJEKT fehlt in .env}"
NAS_USER="${NAS_USER:-}"
NAS_DOCKER="${NAS_DOCKER:-/usr/local/bin/docker}"
NAS_SUDO="${NAS_SUDO-sudo}"
NAS_TMP="${NAS_TMP:-/tmp}"
COMPOSE_PROJEKT="${COMPOSE_PROJEKT:-$(basename "$NAS_PROJEKT")}"
APP_DIENST="${APP_DIENST:-trading-journal}"
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
    # ja, Ja, JA (auch mit Leerzeichen) — alles andere ist nein.
    antwort="$(printf '%s' "$antwort" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')"
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
    # sudo auf der NAS: Über SSH ohne Terminal kann sudo nicht nachfragen („a terminal is
    # required"), mit -t fragte es bei jedem Aufruf neu. Deshalb wird das sudo-Passwort
    # EINMAL hier abgefragt und jedem Befehl als erste Zeile von stdin mitgegeben. Die
    # Gegenseite liest es in die Shell-Variable SPW (nie in die Befehlszeile, nie auf die
    # Platte) und reicht es per `sudo -S` weiter. stdin ist dadurch immer belegt — ssh
    # frisst also keine Ja-Antworten einer Pipe.
    SUDO_PW=""
    VOR='IFS= read -r SPW; '
    mit_pw() { printf '%s\n' "$SUDO_PW"; }
    nas() { mit_pw | command ssh "${SSH_OPT[@]}" "$ZIEL" "$VOR$1"; }
    # Daten über stdin, OHNE sudo (z. B. cat > Datei)
    nas_ein() { command ssh "${SSH_OPT[@]}" "$ZIEL" "$1"; }
    # Daten über stdin MIT sudo: erste Zeile für SPW, zweite für sudo -S, danach die Daten
    nas_ein_sudo() { { mit_pw; mit_pw; cat; } | command ssh "${SSH_OPT[@]}" "$ZIEL" "$VOR$1"; }
    # Längere, verändernde Befehle: Ausgabe sichtbar, sudo ohne eigene Abfrage
    nas_tty() { nas "$1"; }
    nas_ende() { command ssh "${SSH_OPT[@]}" -O exit "$ZIEL" 2>/dev/null || true; }
    # Unter umzug.sh hält das Sammelskript die Verbindung für alle Schritte offen.
    [ "${UMZUG_GEMEINSAM:-0}" = 1 ] || trap nas_ende EXIT
    # Eine Master-Verbindung: nur EINE Passwortabfrage für SSH.
    command ssh "${SSH_OPT[@]}" -O check "$ZIEL" 2>/dev/null || command ssh "${SSH_OPT[@]}" -fN "$ZIEL"
    if [ -n "$NAS_SUDO" ] && [ -n "${UMZUG_SUDO_PW:-}" ]; then
        SUDO_PW="$UMZUG_SUDO_PW"     # von umzug.sh einmal abgefragt
    elif [ -n "$NAS_SUDO" ]; then
        printf 'sudo-Passwort auf der NAS (%s): ' "$ZIEL" >/dev/tty
        IFS= read -rs SUDO_PW </dev/tty || true
        printf '\n' >/dev/tty
        mit_pw | command ssh "${SSH_OPT[@]}" "$ZIEL" "$NAS_SUDO -S -p '' -v" 2>/dev/null \
            || { printf '\033[91m%s\033[0m\n' "ABBRUCH: sudo auf der NAS lehnt das Passwort ab" >&2; exit 1; }
    fi
fi

# Docker auf der NAS, mit sudo (DSM legt docker nicht in den PATH einer SSH-Sitzung).
#   S   = sudo-Vorsatz für Befehle in nas/nas_tty (Passwort aus SPW)
#   D   = docker mit sudo, für nas/nas_tty
#   DIN = docker mit sudo, wenn stdin Daten trägt (nur mit nas_ein_sudo)
if [ "$NAS_HOST" != lokal ] && [ -n "$NAS_SUDO" ]; then
    S="printf '%s\\n' \"\$SPW\" | $NAS_SUDO -S -p ''"
    D="$S $NAS_DOCKER"
    DIN="$NAS_SUDO -S -p '' $NAS_DOCKER"
else
    S="$NAS_SUDO"
    D="${NAS_SUDO:+$NAS_SUDO }$NAS_DOCKER"
    DIN="$D"
    nas_ein_sudo() { nas_ein "$1"; }
fi
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
    printf '%s\n' "$1" | nas_ein_sudo "$DIN exec -i $DB_CONTAINER psql -X -q -A -t -v ON_ERROR_STOP=1 -U $DB_USER -d ${2:-$DB_NAME} -f -"
}

# Container des App-Dienstes im Compose-Projekt (läuft oder gestoppt).
app_container() {
    dk "ps -a --filter label=com.docker.compose.project=$COMPOSE_PROJEKT --filter label=com.docker.compose.service=$APP_DIENST --format '{{.Names}}'" | head -1
}

# Name der Compose-Datei im Projekt. Die NAS nutzt `compose.yaml` (Container Manager),
# andere Installationen `docker-compose.yml`. Bevorzugt aus dem Label des App-Containers,
# sonst die erste vorhandene. Überschreibbar mit COMPOSE_DATEI in der .env.
compose_datei() {
    if [ -n "${COMPOSE_DATEI:-}" ]; then echo "$COMPOSE_DATEI"; return 0; fi
    local c f=""
    c="$(app_container || true)"
    [ -n "$c" ] && f="$(dk "inspect -f '{{index .Config.Labels \"com.docker.compose.project.config_files\"}}' $c" 2>/dev/null || true)"
    f="${f%%,*}"; f="${f##*/}"
    if [ -z "$f" ]; then
        for k in compose.yaml compose.yml docker-compose.yml docker-compose.yaml; do
            nas "$S test -f '$NAS_PROJEKT/$k'" && { f="$k"; break; }
        done
    fi
    echo "${f:-compose.yaml}"
}

# ⚠ Auf der NAS ist der Projektordner zugleich das Datenverzeichnis der Live-Postgres
# (PG_VERSION, base/, pg_wal/ …). Die Skripte legen dort nur Dateien ab bzw. tauschen
# die Compose-Datei — sie löschen dort NIE etwas.

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
