#!/usr/bin/env bash
# Schritt 0+1 des Umzugs: Vorbedingungen prüfen und die Live-DB vollständig sichern.
#
#   scripts/umzug/sichern.sh --trocken     zeigt, was gesichert würde
#   scripts/umzug/sichern.sh               sichert nach „ja"
#
# - pg_dump im custom-Format (-Fc) im DB-Container selbst (gleiche Version wie
#   der Server, postgres:17), über SSH direkt auf DIESEN Rechner gestreamt.
# - Prüfung: pg_restore --list mit einem postgres:17-Wegwerf-Container, Zahl der
#   Tabellen in der Liste == Zahl der Tabellen in der DB, SHA-256 der Datei.
# - Prüfwerte: Zeilen je Tabelle + Journal-Summen VOR dem Umzug, für pruefen.sh.
# - Schritt 0: offene Live-Positionen der alten Strategie-Engine melden (V2 hat
#   keinen Stop-Wächter; S13 stellt Live-Instanzen auf Papier). Die Positionen an
#   der Börse selbst sieht nur die Börse — die schliesst der Nutzer vorher von Hand.
#
# Liest die DB nur. Schreibt nur lokal unter $SICHERUNG_LOKAL.
. "$(dirname "$0")/gemeinsam.sh" "$@"

kopf "Datenbank erreichbar?"
dk "inspect -f '{{.State.Status}} {{.Config.Image}}' $DB_CONTAINER" || abbruch "DB-Container $DB_CONTAINER nicht gefunden"
VERSION_SERVER="$(psql_nas "show server_version")"
echo "Postgres: $VERSION_SERVER"
GROESSE="$(psql_nas "select pg_size_pretty(pg_database_size('$DB_NAME'))")"
echo "DB $DB_NAME: $GROESSE"
SCHEMA="$(psql_nas "select \"schemaVersion\" from settings where id = 1" 2>/dev/null || echo '?')"
echo "Schema-Stand: v${SCHEMA:-?} (alte App: v27, V2: v29)"

kopf "Schritt 0: offene Live-Positionen"
LIVE_INST="$(psql_nas "select count(*) from strategy_instances where mode = 'live'" 2>/dev/null || echo 0)"
LIVE_OFFEN="$(psql_nas "select count(*) from strategy_positions where mode = 'live' and status in ('open','pending','unknown')" 2>/dev/null || echo 0)"
echo "Live-Instanzen: $LIVE_INST · offene Live-Positionen in der DB: $LIVE_OFFEN"
if [ "${LIVE_OFFEN:-0}" != 0 ]; then
    psql_nas "select id, symbol, direction, qty, status from strategy_positions where mode = 'live' and status in ('open','pending','unknown') order by id" | sed 's/^/    /' || true
    gelb "  V2 hat KEINEN Stop-Wächter mehr. Diese Positionen an der Börse schliessen (oder bewusst"
    gelb "  ohne Wächter stehen lassen), BEVOR die alte App stoppt. Nach dem Umzug sind sie „ausgelagert“."
    frage "Sind die offenen Live-Positionen an der Börse erledigt?" || [ "$TROCKEN" = 1 ] || abbruch "erst die Live-Positionen klären"
else
    gruen "keine offenen Live-Positionen in der DB"
fi

kopf "Schritt 1: Vollsicherung"
mkdir -p "$SICHERUNG_LOKAL"
DUMP="$SICHERUNG_LOKAL/$DB_NAME-vor-v2-$DATUM.dump"
PRUEF="$SICHERUNG_LOKAL/$DB_NAME-vor-v2-$DATUM.pruefwerte"
echo "Ziel: $DUMP"
echo "  \$ $D exec $DB_CONTAINER pg_dump -Fc -U $DB_USER -d $DB_NAME  >  $DUMP"
if ! frage "Jetzt sichern (liest nur die DB)?"; then
    [ "$TROCKEN" = 1 ] && exit 0
    abbruch "nicht gesichert"
fi
umask 077
nas "$D exec $DB_CONTAINER pg_dump -Fc -Z 6 -U $DB_USER -d $DB_NAME" > "$DUMP.teil"
mv "$DUMP.teil" "$DUMP"
[ -s "$DUMP" ] || abbruch "Sicherung ist leer"

kopf "Sicherung prüfen"
LISTE="$DUMP.liste"
docker run --rm -i "$PG_IMAGE" pg_restore --list < "$DUMP" > "$LISTE" || abbruch "pg_restore --list scheitert — Sicherung unbrauchbar"
IN_LISTE="$(grep -c ' TABLE DATA public ' "$LISTE" || true)"
IN_DB="$(psql_nas "select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'")"
echo "Tabellen: in der DB $IN_DB, mit Daten in der Sicherung $IN_LISTE"
[ "$IN_LISTE" = "$IN_DB" ] || abbruch "Zahl der Tabellen weicht ab"
SHA="$(sha256sum "$DUMP" | cut -d' ' -f1)"
echo "Grösse: $(du -h "$DUMP" | cut -f1) · SHA-256: $SHA"
echo "$SHA  $(basename "$DUMP")" > "$DUMP.sha256"

kopf "Prüfwerte für nachher"
# Zeilen je Tabelle (genau, nicht geschätzt) und die Journal-Summen, die die Oberfläche zeigt.
TABELLEN="$(psql_nas "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1")"
SQL=""
for t in $TABELLEN; do SQL="${SQL}select '$t', count(*) from \"$t\"; "; done
{
    echo "# Prüfwerte $DB_NAME vor dem Umzug, $DATUM"
    psql_nas "$SQL" | sed 's/^/zeilen|/'
    psql_nas "select 'trades|tage', count(*), coalesce(min(\"dateUnix\"),0), coalesce(max(\"dateUnix\"),0) from trades"
    psql_nas "select 'diaries|tage', count(*) from diaries"
    psql_nas "select 'screenshots|anzahl', count(*) from screenshots"
} > "$PRUEF"
wc -l < "$PRUEF" | sed 's/^/Zeilen: /'
merke SICHERUNG_DUMP "$DUMP"
merke SICHERUNG_SHA "$SHA"
merke SICHERUNG_PRUEFWERTE "$PRUEF"
merke SCHEMA_VORHER "$SCHEMA"
gruen "Sicherung fertig: $DUMP"
echo "Bitte zusätzlich ausserhalb dieses Rechners ablegen (USB/zweite Platte)."
