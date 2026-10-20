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
trap 'rm -f "$JETZT_COMPOSE"; nas_ende' EXIT
nas "$S cat '$NAS_PROJEKT/docker-compose.yml'" > "$JETZT_COMPOSE" 2>/dev/null || true
if grep -q "autarktrade:produktiv\|${NAS_IMAGE_TAG}" "$JETZT_COMPOSE"; then
    WECHSEL=0
    echo "   Projekt $NAS_PROJEKT läuft schon mit V2 → Update"
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
    diff -u --label "NAS: docker-compose.yml (jetzt)" --label "neu: docker-compose.produktiv.yml" "$JETZT_COMPOSE" "$NEU_COMPOSE" | sed 's/^/     /' || true
    echo "   Variablen-NAMEN in der Projekt-.env (Werte werden nicht gelesen):"
    nas "$S sh -c \"cut -d= -f1 '$NAS_PROJEKT/.env' | grep -v '^#' | grep . | tr '\\n' ' '\"" | sed 's/^/     /'; echo
    nas "$S grep -q '^CTJ_SECRET=.' '$NAS_PROJEKT/.env' || $S grep -q '^AT_SECRET=.' '$NAS_PROJEKT/.env'" \
        || abbruch "weder CTJ_SECRET noch AT_SECRET in der Projekt-.env — ohne Secret wären die Börsenschlüssel unlesbar"
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
[ "$WECHSEL" = 1 ] && nas_ein "cat > '$ZWISCHEN'" < "$NEU_COMPOSE"

echo "── 4/5  Laden + Container neu erstellen (sudo) ─────────────"
# sudo bekommt das am Anfang abgefragte Passwort (gemeinsam.sh), keine Abfrage mehr hier.
nas_tty "
    set -e
    $( [ "$NAS_HOST" = lokal ] || echo "$D load -i '$ARCHIV'" )
    $( [ "$TAG" = "$NAS_IMAGE_TAG" ] || echo "$D tag '$TAG' '$NAS_IMAGE_TAG'" )
    $( [ "$WECHSEL" = 1 ] && echo "$S cp '$ZWISCHEN' '$NAS_PROJEKT/docker-compose.yml'; rm -f '$ZWISCHEN'" )
    $S sh -c \"cd '$NAS_PROJEKT' && $NAS_DOCKER compose -p $COMPOSE_PROJEKT up -d --force-recreate\"
    # Nur namenlose Images (das vorige V2-Image nach dem Umtaggen). Getaggte bleiben —
    # auch trading-journal:vor-v2-<datum> für den Rückweg.
    # (Nicht im Probelauf auf diesem Rechner: dort gehörten die namenlosen Images nicht uns.)
    $( [ "$NAS_HOST" = lokal ] || echo "$D image prune -f" )
    rm -f '$ARCHIV'
"
merke V2_REVISION "$REVISION"

echo "── 5/5  Kontrolle ────────────────────────────────────────────"
GELIEFERT=""
for _ in $(seq 1 30); do
    GELIEFERT="$(curl -s --max-time 5 "http://$H:$NAS_PORT/" \
        | grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -1 || true)"
    [ -n "$GELIEFERT" ] && break
    sleep 3
done
if [ -z "$GELIEFERT" ]; then
    rot "Die App antwortet nach 90 s nicht. Protokoll:"
    echo "    ssh -t $ZIEL \"$D logs --tail 50 \\\$($D ps -q -f label=com.docker.compose.service=$APP_DIENST)\""
    exit 1
fi
echo "   NAS liefert:  $GELIEFERT"
echo "   erwartet:     $ERWARTETES_ASSET"
[ "$GELIEFERT" = "$ERWARTETES_ASSET" ] || abbruch "anderes Frontend als gerade gebaut — steht in $NAS_PROJEKT/docker-compose.yml ein anderes Image?"
if [ "$WECHSEL" = 1 ]; then
    C="$(app_container)"
    dk "logs $C 2>&1" | grep -E 'PostgreSQL:|Schema|S13|S15|v28|Testbetrieb|ready' | sed 's/^/   /' || true
    gruen "✅ V2 läuft auf http://$H:$NAS_PORT/ — weiter mit scripts/umzug/pruefen.sh"
else
    gruen "✅ Neuer Stand läuft auf http://$H:$NAS_PORT/"
fi
