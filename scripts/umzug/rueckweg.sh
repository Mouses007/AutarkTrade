#!/usr/bin/env bash
# Schritt 8: zurück zur alten App mit dem Datenstand der Sicherung.
#
#   scripts/umzug/rueckweg.sh --trocken
#   scripts/umzug/rueckweg.sh [--sicherung DATEI]
#
# Nichts wird weggeworfen:
#   1. V2 stoppen (Container bleibt).
#   2. Sicherung in eine NEUE Datenbank <db>_rueck_<datum> einspielen und prüfen
#      (Zeilen je Tabelle gegen die Prüfwerte von sichern.sh).
#   3. Namen tauschen: <db> → <db>_v2_<datum> (der V2-Stand bleibt liegen),
#      <db>_rueck_<datum> → <db>. Verbindungen zu <db> werden dafür beendet.
#   4. Compose-Datei der alten App zurück, ihr Image wieder unter dem alten Tag
#      (nur lokal umhängen, NICHTS ziehen), Projekt neu erstellen.
#   5. Warten, bis die alte App antwortet.
# Jede Stufe mit eigener Ja-Abfrage. Was nach dem Umzug in V2 eingetragen wurde,
# steckt danach nur in <db>_v2_<datum>.
. "$(dirname "$0")/gemeinsam.sh" "$@"
lies_stand

while [ $# -gt 0 ]; do
    case "$1" in --sicherung) SICHERUNG_DUMP="$2"; shift ;; esac
    shift
done

kopf "Was zurückkommt"
: "${SICHERUNG_DUMP:?keine Sicherung bekannt — --sicherung DATEI angeben}"
[ -s "$SICHERUNG_DUMP" ] || abbruch "Sicherung fehlt: $SICHERUNG_DUMP"
if [ -f "$SICHERUNG_DUMP.sha256" ]; then
    (cd "$(dirname "$SICHERUNG_DUMP")" && sha256sum -c --quiet "$(basename "$SICHERUNG_DUMP").sha256") || abbruch "Prüfsumme der Sicherung stimmt nicht"
    ok_sha=1
fi
echo "Sicherung: $SICHERUNG_DUMP ${ok_sha:+(Prüfsumme ok)}"
echo "Alte App:  ${ALT_IMAGE:-?} (festgehalten als ${ALT_SICHER_TAG:-?}), Compose ${COMPOSE_SICHERUNG:-?}"
[ -n "${ALT_SICHER_TAG:-}" ] && [ -n "${COMPOSE_SICHERUNG:-}" ] || abbruch "Merkzettel unvollständig (alt-stoppen.sh nicht gelaufen?) — $STAND_DATEI"
RECHTE="$(psql_nas "select rolsuper or rolcreatedb from pg_roles where rolname = current_user" postgres)"
[ "$RECHTE" = t ] || abbruch "$DB_USER darf keine Datenbanken anlegen/umbenennen"
RUECK="${DB_NAME}_rueck_$DATUM"
V2DB="${DB_NAME}_v2_$DATUM"

kopf "1. V2 stoppen"
C="$(app_container || true)"
zeige "$D stop $C"
if frage "V2 ($C) stoppen?"; then
    [ -n "$C" ] && dk "stop -t 30 $C" >/dev/null
    gruen "gestoppt"
elif [ "$TROCKEN" != 1 ]; then abbruch "Rückweg abgebrochen"; fi

kopf "2. Sicherung in $RUECK einspielen"
zeige "createdb $RUECK; pg_restore --exit-on-error -d $RUECK < $(basename "$SICHERUNG_DUMP")"
if frage "Sicherung in die neue Datenbank $RUECK einspielen?"; then
    psql_nas "create database \"$RUECK\"" postgres >/dev/null
    nas_ein_sudo "$DIN exec -i $DB_CONTAINER pg_restore --exit-on-error -U $DB_USER -d $RUECK" < "$SICHERUNG_DUMP"
    ABW=0
    if [ -n "${SICHERUNG_PRUEFWERTE:-}" ] && [ -f "$SICHERUNG_PRUEFWERTE" ]; then
        while IFS='|' read -r art tabelle vorher; do
            [ "$art" = zeilen ] || continue
            jetzt="$(psql_nas "select count(*) from \"$tabelle\"" "$RUECK")"
            [ "$jetzt" = "$vorher" ] || { ABW=$((ABW + 1)); echo "    $tabelle: Sicherung $vorher, eingespielt $jetzt"; }
        done < "$SICHERUNG_PRUEFWERTE"
        [ "$ABW" = 0 ] && gruen "alle Tabellen wie in den Prüfwerten" || abbruch "$ABW Tabellen weichen ab — $RUECK bleibt zur Ansicht, nichts getauscht"
    fi
    echo "Schema in $RUECK: v$(psql_nas "select \"schemaVersion\" from settings where id = 1" "$RUECK")"
elif [ "$TROCKEN" != 1 ]; then abbruch "Rückweg abgebrochen (V2 ist gestoppt — wieder starten: $D start $C)"; fi

kopf "3. Datenbanken tauschen"
zeige "$DB_NAME → $V2DB ; $RUECK → $DB_NAME"
if frage "Verbindungen zu $DB_NAME beenden und die Namen tauschen?"; then
    psql_nas "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$DB_NAME' and pid <> pg_backend_pid()" postgres >/dev/null
    psql_nas "alter database \"$DB_NAME\" rename to \"$V2DB\"" postgres
    psql_nas "alter database \"$RUECK\" rename to \"$DB_NAME\"" postgres
    gruen "$DB_NAME ist wieder der Stand der Sicherung; V2-Stand liegt in $V2DB"
    merke V2_DB_ABGELEGT "$V2DB"
elif [ "$TROCKEN" != 1 ]; then abbruch "nicht getauscht — $RUECK bleibt liegen"; fi

kopf "4. Alte App zurück"
CDZ="${COMPOSE_DATEI:-compose.yaml}"
zeige "$NAS_SUDO cp $NAS_PROJEKT/$COMPOSE_SICHERUNG $NAS_PROJEKT/$CDZ"
[ "${ENV_ANGELEGT:-0}" = 1 ] && zeige "$NAS_SUDO mv $NAS_PROJEKT/.env $NAS_PROJEKT/.env.v2-$DATUM   (die alte App hatte keine .env)"
zeige "$D tag $ALT_SICHER_TAG ${ALT_IMAGE:-}"
zeige "cd $NAS_PROJEKT && $D compose -p $COMPOSE_PROJEKT up -d --force-recreate   (zieht nichts: das Image ist lokal da)"
if frage "Compose-Datei der alten App zurücklegen und sie starten?"; then
    nas_tty "set -e
        $S cp '$NAS_PROJEKT/$COMPOSE_SICHERUNG' '$NAS_PROJEKT/$CDZ'
        $( [ "${ENV_ANGELEGT:-0}" = 1 ] && echo "$S mv '$NAS_PROJEKT/.env' '$NAS_PROJEKT/.env.v2-$DATUM'" )
        $D tag '$ALT_SICHER_TAG' '$ALT_IMAGE'
        $S sh -c \"cd '$NAS_PROJEKT' && $NAS_DOCKER compose -p $COMPOSE_PROJEKT up -d --force-recreate\""

    kopf "5. Antwortet die alte App?"
    H="$( [ "$NAS_HOST" = lokal ] && echo 127.0.0.1 || echo "$NAS_HOST")"
    for _ in $(seq 1 40); do
        [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://$H:$APP_PORT/")" = 200 ] && break
        sleep 3
    done
    C="$(app_container)"
    echo "  $C: $(dk "inspect -f '{{.Config.Image}} {{.State.Status}}' $C")"
    [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://$H:$APP_PORT/")" = 200 ] && gruen "alte App antwortet auf :$APP_PORT" || abbruch "alte App antwortet nicht — Log: $D logs $C"
fi
