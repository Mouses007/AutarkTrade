#!/usr/bin/env bash
# Schritte 3+4 des Umzugs: V2-Image privat auf die NAS und das Projekt tauschen.
#
#   scripts/umzug/nas-deploy.sh --trocken
#   scripts/umzug/nas-deploy.sh
#
# Privat heisst: das Image wird HIER gebaut (aus dem eingecheckten Stand,
# `git archive HEAD`), per `docker save | ssh | docker load` übertragen und auf
# der NAS nur lokal getaggt ($V2_TAG). Keine Registry, kein Docker Hub, nichts
# Öffentliches. Die neue Compose-Datei hat `pull_policy: never`.
#
# Ablauf: Vorbedingungen (Sicherung da, alte App gestoppt) → Architektur →
# bauen → Unterschied der Compose-Dateien zeigen → [ja] übertragen, laden,
# Compose tauschen, Projekt neu erstellen → warten, bis die App antwortet.
# Ein `image prune` gibt es hier bewusst nicht: das alte Image bleibt für den Rückweg.
. "$(dirname "$0")/gemeinsam.sh" "$@"
lies_stand

kopf "Vorbedingungen"
[ -n "${SICHERUNG_DUMP:-}" ] && [ -s "${SICHERUNG_DUMP:-/nix}" ] || { [ "$TROCKEN" = 1 ] && gelb "  (trocken) keine Sicherung im Merkzettel" || abbruch "keine Sicherung — erst sichern.sh"; }
echo "Sicherung: ${SICHERUNG_DUMP:-–}"
ALT="$(app_container || true)"
if [ -n "$ALT" ]; then
    ALT_STATUS="$(dk "inspect -f '{{.State.Status}}' $ALT")"
    echo "App-Container: $ALT ($ALT_STATUS, $(dk "inspect -f '{{.Config.Image}}' $ALT"))"
    if [ "$ALT_STATUS" = running ] && [ "$(dk "inspect -f '{{.Config.Image}}' $ALT")" != "$V2_TAG" ]; then
        [ "$TROCKEN" = 1 ] && gelb "  (trocken) alte App läuft noch — erst alt-stoppen.sh" || abbruch "alte App läuft noch — erst alt-stoppen.sh"
    fi
fi
[ -n "$(git -C "$WURZEL" status --porcelain --untracked-files=no)" ] && gelb "  Hinweis: nicht eingecheckte Änderungen gehen NICHT ins Image (gebaut wird HEAD)"
REVISION="$(git -C "$WURZEL" rev-parse --short HEAD)"

kopf "Architektur"
NAS_ARCH="$(nas 'uname -m')"
case "$NAS_ARCH" in
    x86_64) PLATTFORM=linux/amd64 ;;
    aarch64) PLATTFORM=linux/arm64 ;;
    *) abbruch "unbekannte Architektur $NAS_ARCH" ;;
esac
echo "NAS: $NAS_ARCH → $PLATTFORM"

kopf "Image bauen ($V2_TAG aus $REVISION)"
zeige "git archive HEAD | docker build --platform $PLATTFORM -t $V2_TAG -"
if [ "$TROCKEN" != 1 ]; then
    git -C "$WURZEL" archive --format=tar HEAD \
        | docker build -q --platform "$PLATTFORM" --label "org.opencontainers.image.revision=$REVISION" -t "$V2_TAG" - >/dev/null
    [ "$(docker image inspect -f '{{.Os}}/{{.Architecture}}' "$V2_TAG")" = "$PLATTFORM" ] || abbruch "Image hat die falsche Architektur"
    ASSET="$(docker run --rm --entrypoint sh "$V2_TAG" -c "grep -o 'assets/index-[A-Za-z0-9_-]*\.js' dist/index.html | head -1")"
    echo "gebaut: $(docker image inspect -f '{{.Id}}' "$V2_TAG" | cut -c1-19) · Frontend $ASSET"
fi

kopf "Compose-Datei im Projekt"
NEU="$UMZUG_DIR/docker-compose.produktiv.yml"
ALT_COMPOSE="$(mktemp)"
trap 'rm -f "$ALT_COMPOSE"; nas_ende' EXIT
nas "$NAS_SUDO cat '$NAS_PROJEKT/docker-compose.yml'" > "$ALT_COMPOSE" 2>/dev/null || true
if [ -s "$ALT_COMPOSE" ]; then
    diff -u --label "NAS: docker-compose.yml (jetzt)" --label "neu: docker-compose.produktiv.yml" "$ALT_COMPOSE" "$NEU" | sed 's/^/  /' || true
else
    gelb "  keine docker-compose.yml im Projekt lesbar"
fi
echo "Variablen-NAMEN in der Projekt-.env (Werte werden nicht gelesen):"
nas "$NAS_SUDO sh -c \"cut -d= -f1 '$NAS_PROJEKT/.env' | grep -v '^#' | grep . | tr '\\n' ' '\"" | sed 's/^/  /'; echo
nas "$NAS_SUDO grep -q '^CTJ_SECRET=.' '$NAS_PROJEKT/.env' || $NAS_SUDO grep -q '^AT_SECRET=.' '$NAS_PROJEKT/.env'" \
    || abbruch "weder CTJ_SECRET noch AT_SECRET in der Projekt-.env — ohne Secret wären die Börsenschlüssel unlesbar"

kopf "Übertragen, laden, tauschen"
ARCHIV="$NAS_TMP/.at-v2-image.tar.gz"
ZWISCHEN="$NAS_TMP/.at-v2-compose.yml"
[ "$NAS_HOST" = lokal ] || zeige "docker save $V2_TAG | gzip -1 | ssh $ZIEL 'cat > $ARCHIV'  &&  $D load -i $ARCHIV"
zeige "$NAS_SUDO cp $ZWISCHEN $NAS_PROJEKT/docker-compose.yml"
zeige "cd $NAS_PROJEKT && $D compose -p $COMPOSE_PROJEKT up -d --force-recreate"
if ! frage "V2 jetzt auf $ZIEL bringen und das Projekt $COMPOSE_PROJEKT mit ihr neu erstellen?"; then
    [ "$TROCKEN" = 1 ] && exit 0
    abbruch "nichts übertragen"
fi
if [ "$NAS_HOST" != lokal ]; then
    docker save "$V2_TAG" | gzip -1 | nas_ein "cat > '$ARCHIV'"
    nas "ls -lh '$ARCHIV' | awk '{print \"  übertragen: \" \$5}'"
fi
nas_ein "cat > '$ZWISCHEN'" < "$NEU"
# Ein Terminal für die sudo-Abfrage; stdin ist hier frei.
nas_tty "set -e
    $( [ "$NAS_HOST" = lokal ] || echo "$D load -i '$ARCHIV' >/dev/null; rm -f '$ARCHIV'" )
    $NAS_SUDO cp '$ZWISCHEN' '$NAS_PROJEKT/docker-compose.yml'
    rm -f '$ZWISCHEN'
    $NAS_SUDO sh -c \"cd '$NAS_PROJEKT' && $NAS_DOCKER compose -p $COMPOSE_PROJEKT up -d --force-recreate\""
merke V2_REVISION "$REVISION"
merke V2_SEIT "$DATUM"

kopf "Start abwarten"
NEU_CONTAINER=""
for _ in $(seq 1 40); do
    NEU_CONTAINER="$(app_container)"
    [ -n "$NEU_CONTAINER" ] && dk "logs $NEU_CONTAINER 2>&1" | grep -q 'AutarkTrade ready' && break
    sleep 3
done
[ -n "$NEU_CONTAINER" ] || abbruch "kein App-Container nach dem Start"
echo "Container: $NEU_CONTAINER ($(dk "inspect -f '{{.Config.Image}} {{.State.Status}}' $NEU_CONTAINER"))"
dk "logs $NEU_CONTAINER 2>&1" | grep -E 'PostgreSQL|Schema|S13|S15|v28|Testbetrieb|WARN|Fehler|Error|ready' | sed 's/^/  /' || true
dk "logs $NEU_CONTAINER 2>&1" | grep -q 'AutarkTrade ready' || abbruch "App meldet sich nicht bereit — Log: $D logs $NEU_CONTAINER"
gruen "V2 läuft. Weiter mit: scripts/umzug/pruefen.sh"
