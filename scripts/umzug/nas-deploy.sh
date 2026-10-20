#!/usr/bin/env bash
#
# AutarkTrade auf die NAS bringen — lokal bauen, per SSH übertragen, ohne Registry.
#
#   scripts/nas-deploy.sh                (der gewohnte Aufruf, ruft dieses Skript)
#   scripts/umzug/nas-deploy.sh [--trocken]
#
# Bedient sich wie das Update-Skript der alten App: gleiche Einstellungsdatei
# scripts/.nas-deploy.env (NAS_HOST, NAS_USER, NAS_PROJEKT, NAS_PORT), gleiches
# NAS-Projekt, am Anfang je eine Abfrage für das SSH- und das sudo-Passwort,
# dieselben fünf Schritte:
#
#   docker build → docker save → ssh → docker load → compose up → Kontrolle
#
# Neu ist nur, WAS ankommt: das V2-Image, auf der NAS lokal getaggt als
# autarktrade:produktiv (V2_TAG) — nie mouses007/…, nie aus einer Registry.
#
# Zwei Fälle, das Skript erkennt sie selbst an der Compose-Datei auf der NAS:
#   * Update (normal, ab dem Umzug): die Compose-Datei nennt schon V2_TAG →
#     bauen, übertragen, neu erstellen. Keine Rückfrage, wie bisher.
#   * Wechsel (einmal, beim Umzug): dort steht noch die alte App → verlangt eine
#     Sicherung (sichern.sh) und die gestoppte alte App (alt-stoppen.sh), zeigt den
#     Unterschied zur neuen Compose-Datei und fragt, bevor es sie tauscht.
#
# --trocken: baut nichts, überträgt nichts, zeigt nur.
#
# Achtung wie bisher: NICHT den Knopf „Erstellen" im Container Manager benutzen —
# die Compose-Datei hat `pull_policy: never`, und das Tag liegt in keiner Registry.
. "$(dirname "$0")/gemeinsam.sh" "$@"
lies_stand

TAG="${TAG:-$V2_TAG}"
NAS_IMAGE_TAG="${NAS_IMAGE_TAG:-$V2_TAG}"
case "$TAG $NAS_IMAGE_TAG" in *mouses007*|*docker.io*) abbruch "TAG/NAS_IMAGE_TAG zeigen auf ein öffentliches Image" ;; esac
NAS_PORT="${NAS_PORT:-$APP_PORT}"
H="$( [ "$NAS_HOST" = lokal ] && echo 127.0.0.1 || echo "$NAS_HOST")"
ARCHIV="$NAS_TMP/.at-deploy-image.tar.gz"
ZWISCHEN="$NAS_TMP/.at-deploy-compose.yml"
NEU_COMPOSE="$UMZUG_DIR/docker-compose.produktiv.yml"

echo "── 1/5  Erreichbarkeit + Architektur ─────────────────────────"
NAS_ARCH="$(nas 'uname -m')"
case "$NAS_ARCH" in
    x86_64)  ERWARTET=amd64 ;;
    aarch64) ERWARTET=arm64 ;;
    *)       abbruch "Unbekannte NAS-Architektur: $NAS_ARCH" ;;
esac
echo "   NAS: $NAS_ARCH  →  Image muss linux/$ERWARTET sein"

# Update oder Wechsel? Die Compose-Datei auf der NAS sagt es.
JETZT_COMPOSE="$(mktemp)"
# Verbindung nur schliessen, wenn nicht unter umzug.sh (das hält sie für alle Schritte).
trap 'rm -f "$JETZT_COMPOSE"; [ "${UMZUG_GEMEINSAM:-0}" = 1 ] || nas_ende' EXIT
CD="$(compose_datei)"
echo "   Compose-Datei im Projekt: $CD"
nas "$S cat '$NAS_PROJEKT/$CD'" > "$JETZT_COMPOSE" 2>/dev/null || true
[ -s "$JETZT_COMPOSE" ] || abbruch "$NAS_PROJEKT/$CD ist leer oder fehlt — COMPOSE_DATEI in scripts/umzug/.env setzen"
COMPOSE_ANDERS=0
if grep -q "autarktrade:produktiv\|${NAS_IMAGE_TAG}" "$JETZT_COMPOSE"; then
    WECHSEL=0
    echo "   Projekt $NAS_PROJEKT läuft schon mit V2 → Update"
    # Die Compose-Datei gehört seit dem Wechsel zu V2 und reist mit jedem Update mit
    # (z. B. neuer Dienst `mdns`). Die vorige bleibt als $CD.vor-update-<datum> liegen.
    if ! cmp -s "$JETZT_COMPOSE" "$NEU_COMPOSE"; then
        COMPOSE_ANDERS=1
        echo "   Compose-Datei hat sich geändert → wird mit ausgetauscht (vorige bleibt als $CD.vor-update-$DATUM)"
        sed -E 's/((SECRET|PASSWORD|PASSWORT|TOKEN|KEY)[A-Za-z0-9_]*[[:space:]]*[:=][[:space:]]*).*/\1***/I' "$JETZT_COMPOSE" \
            | diff -u --label "NAS: $CD" --label "neu" - "$NEU_COMPOSE" | sed 's/^/     /' | head -60 || true
    fi
else
    WECHSEL=1
    echo "   Projekt $NAS_PROJEKT nennt noch die alte App → WECHSEL auf V2 (einmalig)"
fi

if [ "$WECHSEL" = 1 ]; then
    kopf "Vorbedingungen für den Wechsel"
    if [ -z "${SICHERUNG_DUMP:-}" ] || [ ! -s "${SICHERUNG_DUMP:-/nix}" ]; then
        [ "$TROCKEN" = 1 ] && gelb "  (trocken) keine Sicherung im Merkzettel — erst sichern.sh" || abbruch "keine Sicherung — erst scripts/umzug/sichern.sh"
    else
        echo "   Sicherung: $SICHERUNG_DUMP"
    fi
    ALT="$(app_container || true)"
    if [ -n "$ALT" ] && [ "$(dk "inspect -f '{{.State.Status}}' $ALT")" = running ]; then
        [ "$TROCKEN" = 1 ] && gelb "  (trocken) alte App läuft noch — erst alt-stoppen.sh" || abbruch "alte App läuft noch — erst scripts/umzug/alt-stoppen.sh"
    fi
    echo "   Compose-Datei, die ersetzt wird:"
    # Werte von Geheimnissen NIE ausgeben: Die alte Compose trägt Secret und DB-Passwort im Klartext.
    sed -E 's/((SECRET|PASSWORD|PASSWORT|TOKEN|KEY)[A-Za-z0-9_]*[[:space:]]*[:=][[:space:]]*).*/\1***/I' "$JETZT_COMPOSE" > "$JETZT_COMPOSE.zeige"
    diff -u --label "NAS: $CD (jetzt, Geheimnisse geschwärzt)" --label "neu: docker-compose.produktiv.yml" "$JETZT_COMPOSE.zeige" "$NEU_COMPOSE" | sed 's/^/     /' || true
    rm -f "$JETZT_COMPOSE.zeige"
    # Die alte App hat ihre Werte (Secret, DB-Zugang, Port) direkt in der Compose-Datei,
    # eine .env gibt es auf der NAS nicht. Die neue Compose liest sie aus .env — die wird
    # beim Wechsel AUF DER NAS aus dem gestoppten alten Container angelegt (nur CTJ_*,
    # AT_*, DB_*; Rechte 600). Die Werte verlassen die NAS nie.
    if nas "$S test -f '$NAS_PROJEKT/.env'"; then
        ENV_ANLEGEN=0
        echo "   Variablen-NAMEN in der Projekt-.env (Werte werden nicht gelesen):"
        nas "$S sh -c \"cut -d= -f1 '$NAS_PROJEKT/.env' | grep -v '^#' | grep . | tr '\\n' ' '\"" | sed 's/^/     /'; echo
        nas "$S grep -q '^CTJ_SECRET=.' '$NAS_PROJEKT/.env' || $S grep -q '^AT_SECRET=.' '$NAS_PROJEKT/.env'" \
            || abbruch "weder CTJ_SECRET noch AT_SECRET in der Projekt-.env — ohne Secret wären die Börsenschlüssel unlesbar"
    else
        ENV_ANLEGEN=1
        [ -n "$ALT" ] || abbruch "keine .env und kein alter Container, aus dem sie entstehen könnte"
        echo "   Keine .env im Projekt → wird aus $ALT angelegt. Variablen-NAMEN (Werte bleiben auf der NAS):"
        nas "$D inspect -f '{{range .Config.Env}}{{println .}}{{end}}' $ALT | grep -E '^(CTJ_|AT_|DB_)' | cut -d= -f1 | tr '\\n' ' '" | sed 's/^/     /'; echo
        nas "$D inspect -f '{{range .Config.Env}}{{println .}}{{end}}' $ALT | grep -Eq '^(CTJ|AT)_SECRET=.'" \
            || abbruch "der alte Container hat kein CTJ_SECRET/AT_SECRET — ohne Secret wären die Börsenschlüssel unlesbar"
    fi
fi

echo "── 2/5  Image bauen ──────────────────────────────────────────"
REVISION="$(git -C "$WURZEL" rev-parse --short HEAD)"
[ -n "$(git -C "$WURZEL" status --porcelain --untracked-files=no)" ] && REVISION="$REVISION+lokal" && gelb "   Hinweis: nicht eingecheckte Änderungen gehen mit ins Image"
zeige "docker build --platform linux/$ERWARTET -t $TAG $WURZEL"
if [ "$TROCKEN" = 1 ]; then
    zeige "docker save $TAG | gzip -1 | ssh $ZIEL 'cat > $ARCHIV'"
    zeige "ssh -t $ZIEL: $D load$( [ "$TAG" = "$NAS_IMAGE_TAG" ] || echo " · $D tag $TAG $NAS_IMAGE_TAG" )$( [ "$WECHSEL" = 1 ] && echo " · cp Compose" ) · compose up -d --force-recreate$( [ "$NAS_HOST" = lokal ] || echo " · image prune -f" )"
    gelb "Trockenlauf: nichts gebaut, nichts übertragen."
    exit 0
fi
docker build -q --platform "linux/$ERWARTET" --label "org.opencontainers.image.revision=$REVISION" -t "$TAG" "$WURZEL" >/dev/null
GEBAUT="$(docker image inspect --format '{{.Architecture}}' "$TAG")"
[ "$GEBAUT" = "$ERWARTET" ] || abbruch "Image ist $GEBAUT, die NAS braucht $ERWARTET (Fremdarchitektur: docker buildx + qemu)"
# Erwarteten Frontend-Hash aus dem Image lesen — die Kontrolle am Ende misst dagegen.
ERWARTETES_ASSET="$(docker run --rm --entrypoint sh "$TAG" -c \
    "grep -o 'assets/index-[A-Za-z0-9_-]*\.js' dist/index.html | head -1")"
echo "   Frontend im Image: $ERWARTETES_ASSET · Revision $REVISION"

if [ "$WECHSEL" = 1 ]; then
    frage "Wechsel: Compose-Datei im Projekt $NAS_PROJEKT tauschen und V2 starten?" || abbruch "nichts übertragen"
fi

echo "── 3/5  Übertragen (ohne sudo, daher ohne Passwortkonflikt) ──"
if [ "$NAS_HOST" != lokal ]; then
    docker save "$TAG" | gzip -1 | nas_ein "cat > '$ARCHIV'"
    nas "ls -lh '$ARCHIV' | awk '{print \"   übertragen: \" \$5}'"
else
    echo "   (lokal: Image ist schon da)"
fi
{ [ "$WECHSEL" = 1 ] || [ "$COMPOSE_ANDERS" = 1 ]; } && nas_ein "cat > '$ZWISCHEN'" < "$NEU_COMPOSE"

echo "── 4/5  Laden + Container neu erstellen (sudo) ─────────────"
# sudo bekommt das am Anfang abgefragte Passwort (gemeinsam.sh), keine Abfrage mehr hier.
nas_tty "
    set -e
    $( [ "$NAS_HOST" = lokal ] || echo "$D load -i '$ARCHIV'" )
    $( [ "$TAG" = "$NAS_IMAGE_TAG" ] || echo "$D tag '$TAG' '$NAS_IMAGE_TAG'" )
    $( [ "$WECHSEL" = 1 ] && [ "${ENV_ANLEGEN:-0}" = 1 ] && echo "$S sh -c \"umask 077; $NAS_DOCKER inspect -f '{{range .Config.Env}}{{println .}}{{end}}' '$ALT' | grep -E '^(CTJ_|AT_|DB_)' > '$NAS_PROJEKT/.env'\"; $S grep -Eq '^(CTJ|AT)_SECRET=.' '$NAS_PROJEKT/.env'" )
    $( [ "$WECHSEL" = 1 ] && echo "$S cp '$ZWISCHEN' '$NAS_PROJEKT/$CD'; rm -f '$ZWISCHEN'" )
    $( [ "$COMPOSE_ANDERS" = 1 ] && echo "$S cp -p '$NAS_PROJEKT/$CD' '$NAS_PROJEKT/$CD.vor-update-$DATUM'; $S cp '$ZWISCHEN' '$NAS_PROJEKT/$CD'; rm -f '$ZWISCHEN'" )
    $S sh -c \"cd '$NAS_PROJEKT' && $NAS_DOCKER compose -p $COMPOSE_PROJEKT up -d --force-recreate\"
    # Nur namenlose Images (das vorige V2-Image nach dem Umtaggen). Getaggte bleiben —
    # auch trading-journal:vor-v2-<datum> für den Rückweg.
    # (Nicht im Probelauf auf diesem Rechner: dort gehörten die namenlosen Images nicht uns.)
    $( [ "$NAS_HOST" = lokal ] || echo "$D image prune -f" )
    rm -f '$ARCHIV'
"
merke V2_REVISION "$REVISION"
[ "$WECHSEL" = 1 ] && [ "${ENV_ANLEGEN:-0}" = 1 ] && merke ENV_ANGELEGT 1

echo "── 5/5  Kontrolle ────────────────────────────────────────────"
GELIEFERT=""
# Der erste Start nach dem Wechsel rechnet die Migrationen v27 → v29 über die ganze
# Live-DB (20.10.2026: deutlich über 90 s bei 4,3 GB). Darum beim Wechsel bis zu
# 10 Minuten warten, bei einem normalen Update 3 Minuten.
WARTEN_S=$( [ "$WECHSEL" = 1 ] && echo 600 || echo 180 )
BEGINN=$(date +%s)
while :; do
    GELIEFERT="$(curl -s --max-time 5 "http://$H:$NAS_PORT/" \
        | grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -1 || true)"
    [ -n "$GELIEFERT" ] && break
    VERGANGEN=$(( $(date +%s) - BEGINN ))
    [ "$VERGANGEN" -ge "$WARTEN_S" ] && break
    printf '\r   warte auf den Start … %d s' "$VERGANGEN"
    sleep 5
done
printf '\r%60s\r' ''
if [ -z "$GELIEFERT" ]; then
    rot "Die App antwortet nach $WARTEN_S s nicht. Protokoll ansehen mit:"
    echo "    ssh -t $ZIEL \"sudo $NAS_DOCKER logs --tail 50 \\\$(sudo $NAS_DOCKER ps -q -f label=com.docker.compose.service=$APP_DIENST)\""
    exit 1
fi
echo "   NAS liefert:  $GELIEFERT"
echo "   erwartet:     $ERWARTETES_ASSET"
[ "$GELIEFERT" = "$ERWARTETES_ASSET" ] || abbruch "anderes Frontend als gerade gebaut — steht in $NAS_PROJEKT/$CD ein anderes Image?"
if [ "$WECHSEL" = 1 ]; then
    C="$(app_container)"
    dk "logs $C 2>&1" | grep -E 'PostgreSQL:|Schema|S13|S15|v28|Testbetrieb|ready' | sed 's/^/   /' || true
    gruen "✅ V2 läuft auf http://$H:$NAS_PORT/ — weiter mit scripts/umzug/pruefen.sh"
else
    gruen "✅ Neuer Stand läuft auf http://$H:$NAS_PORT/"
fi
