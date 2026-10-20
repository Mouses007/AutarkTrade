#!/usr/bin/env bash
# Schritt 2 des Umzugs: alte App stoppen, NICHT löschen.
#
#   scripts/umzug/alt-stoppen.sh --trocken
#   scripts/umzug/alt-stoppen.sh
#
# - findet den App-Container des Projekts über die Compose-Labels
#   (Projekt $COMPOSE_PROJEKT, Dienst $APP_DIENST) — kein fester Name;
# - hält das laufende Image unter einem eigenen lokalen Tag fest
#   (trading-journal:vor-v2-<datum>), damit der Rückweg es hat, auch wenn das
#   alte Tag später umgehängt wird; nichts wird gezogen, nichts gelöscht;
# - sichert docker-compose.yml und .env des Projekts als *.vor-v2-<datum> im
#   Projektordner (bleiben auf der NAS, werden nicht übertragen);
# - stoppt nur den App-Container. Caddy und die DB laufen weiter.
#
# Der gestoppte Container bleibt stehen, bis nas-deploy.sh das Projekt mit dem
# neuen Image neu erstellt (compose ersetzt ihn dann). Zurück: rueckweg.sh.
. "$(dirname "$0")/gemeinsam.sh" "$@"

kopf "Alte App finden"
ALT_CONTAINER="$(app_container)"
[ -n "$ALT_CONTAINER" ] || abbruch "kein Container für $COMPOSE_PROJEKT/$APP_DIENST"
ALT_IMAGE="$(dk "inspect -f '{{.Config.Image}}' $ALT_CONTAINER")"
ALT_IMAGE_ID="$(dk "inspect -f '{{.Image}}' $ALT_CONTAINER")"
ALT_STATUS="$(dk "inspect -f '{{.State.Status}}' $ALT_CONTAINER")"
echo "Container: $ALT_CONTAINER ($ALT_STATUS)"
echo "Image:     $ALT_IMAGE  ($ALT_IMAGE_ID)"
case "$ALT_IMAGE" in
    autarktrade*|"$V2_TAG") abbruch "dort läuft schon V2 ($ALT_IMAGE) — Umzug schon gemacht?" ;;
esac
ALT_SICHER_TAG="trading-journal:vor-v2-$DATUM"

kopf "Compose-Datei und .env des Projekts sichern"
zeige "$NAS_SUDO sh -c 'cd \"$NAS_PROJEKT\" && cp -p docker-compose.yml docker-compose.yml.vor-v2-$DATUM && cp -p .env .env.vor-v2-$DATUM && ls -l docker-compose.yml* .env*'"

kopf "Image für den Rückweg festhalten"
zeige "$D tag $ALT_IMAGE_ID $ALT_SICHER_TAG"

kopf "Alte App stoppen"
echo "Läuft danach nicht mehr: $ALT_CONTAINER. Caddy und $DB_CONTAINER bleiben an."
if frage "Compose-Datei sichern, Image festhalten und $ALT_CONTAINER jetzt stoppen?"; then
    nas_tty "$S sh -c 'cd \"$NAS_PROJEKT\" && cp -p docker-compose.yml docker-compose.yml.vor-v2-$DATUM && cp -p .env .env.vor-v2-$DATUM'"
    dk "tag $ALT_IMAGE_ID $ALT_SICHER_TAG"
    dk "stop -t 30 $ALT_CONTAINER" >/dev/null
    [ "$(dk "inspect -f '{{.State.Status}}' $ALT_CONTAINER")" = exited ] || abbruch "Container läuft noch"
    merke ALT_CONTAINER "$ALT_CONTAINER"
    merke ALT_IMAGE "$ALT_IMAGE"
    merke ALT_IMAGE_ID "$ALT_IMAGE_ID"
    merke ALT_SICHER_TAG "$ALT_SICHER_TAG"
    merke COMPOSE_SICHERUNG "docker-compose.yml.vor-v2-$DATUM"
    merke ENV_SICHERUNG ".env.vor-v2-$DATUM"
    gruen "alte App gestoppt; Image als $ALT_SICHER_TAG festgehalten"
fi
