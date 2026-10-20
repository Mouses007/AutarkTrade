#!/usr/bin/env bash
# Schritte 5+6 des Umzugs: prüfen, ob V2 richtig läuft. NUR LESEND.
#
#   scripts/umzug/pruefen.sh
#
# Liest Container-Status, Log, die Datenbank (SELECT) und fragt die App per HTTP.
# Verändert nichts; --trocken ist deshalb dasselbe wie ohne.
# Am Ende die Liste der Punkte, die nur ein Mensch prüfen kann (Oberfläche,
# Handy-Widget, ESP32-Anzeige, Mail/Push).
. "$(dirname "$0")/gemeinsam.sh" "$@"
lies_stand

FEHLER=0
ok()   { gruen "  ✓ $*"; }
nein() { rot "  ✗ $*"; FEHLER=$((FEHLER + 1)); }
hinweis() { gelb "  ! $*"; }

kopf "Container"
C="$(app_container)"
[ -n "$C" ] || abbruch "kein App-Container in $COMPOSE_PROJEKT/$APP_DIENST"
BILD="$(dk "inspect -f '{{.Config.Image}}' $C")"
STATUS="$(dk "inspect -f '{{.State.Status}} seit {{.State.StartedAt}}, Neustarts {{.RestartCount}}' $C")"
echo "  $C: $BILD · $STATUS"
[ "$BILD" = "$V2_TAG" ] && ok "Image $V2_TAG" || nein "Image ist $BILD, erwartet $V2_TAG"
case "$STATUS" in running*) ok "läuft" ;; *) nein "läuft nicht" ;; esac
UID_APP="$(dk "exec $C sh -c 'cat /proc/1/status' 2>/dev/null" | awk '/^Uid:/{print $2}')"
[ "$UID_APP" = 1000 ] && ok "App-Prozess als node (uid 1000)" || nein "App-Prozess läuft als uid ${UID_APP:-?} (erwartet 1000)"
dk "inspect -f '{{range .Mounts}}{{.Source}} {{end}}' $C" | grep -q docker.sock && nein "Docker-Socket ist eingehängt (A2-10)" || ok "kein Docker-Socket"

kopf "Start-Log"
LOG="$(dk "logs $C 2>&1")"
echo "$LOG" | grep -E 'PostgreSQL:|Datenbank-Schema|S13:|S15:|v28:|Schlüssel:|Testbetrieb|deaktiviert|recorder|ready' | sed 's/^/    /' | head -30
echo "$LOG" | grep -q 'Datenbank-Schema v29 (Code kennt v29)' && ok "Schema v29" || nein "keine Zeile „Datenbank-Schema v29“"
echo "$LOG" | grep -q 'Testbetrieb' && nein "Testbetrieb ist an — falsche Compose-Datei?" || ok "kein Testbetrieb"
UMG="$(dk "inspect -f '{{range .Config.Env}}{{println .}}{{end}}' $C")"
if echo "$LOG" | grep -q 'Strategie-Engine deaktiviert'; then
    echo "$UMG" | grep -qx 'AT_NO_ENGINE=1' && hinweis "Strategie-Engine aus (AT_NO_ENGINE=1 gesetzt — nur im Probelauf richtig)" || nein "Strategie-Engine aus"
else ok "Strategie-Engine an (nur Simulation, S13)"; fi
echo "$UMG" | grep -qx 'AT_NO_RECORDER=1' && hinweis "Rekorder aus (AT_NO_RECORDER=1 — nur im Probelauf richtig)" || ok "Rekorder an"
echo "$LOG" | grep -q 'AutarkTrade ready' && ok "bereit" || nein "nicht bereit"
echo "$LOG" | grep -q 'CTJ_.*Sicherheitsschalter\|alte Sicherheitsschalter' && hinweis "alte CTJ_-Sicherheitsschalter gemeldet — .env ansehen"
ANZ_FEHLER="$(echo "$LOG" | grep -ciE '(^|[^a-z])(error|fehler|exception)' || true)"
[ "$ANZ_FEHLER" = 0 ] && ok "keine Fehlerzeilen" || { hinweis "$ANZ_FEHLER Zeilen mit error/Fehler:"; echo "$LOG" | grep -iE '(^|[^a-z])(error|fehler|exception)' | tail -8 | sed 's/^/      /'; }

kopf "Datenbank (nur SELECT)"
V="$(psql_nas "select \"schemaVersion\" from settings where id = 1")"
[ "$V" = 29 ] && ok "settings.schemaVersion = 29 (vorher v${SCHEMA_VORHER:-?})" || nein "schemaVersion = $V"
L="$(psql_nas "select count(*) from strategy_instances where mode = 'live'")"
[ "$L" = 0 ] && ok "keine Live-Instanz (S13)" || nein "$L Live-Instanz(en)"
A="$(psql_nas "select count(*) from strategy_positions where ausgelagert = 1")"
echo "  ausgelagerte Live-Positionen: $A"
if [ -n "${SICHERUNG_PRUEFWERTE:-}" ] && [ -f "$SICHERUNG_PRUEFWERTE" ]; then
    echo "  Zeilen je Tabelle gegen $(basename "$SICHERUNG_PRUEFWERTE"):"
    ABW=0
    while IFS='|' read -r art tabelle vorher; do
        [ "$art" = zeilen ] || continue
        jetzt="$(psql_nas "select count(*) from \"$tabelle\"" 2>/dev/null || echo '–')"
        if [ "$jetzt" != "$vorher" ]; then
            ABW=$((ABW + 1)); echo "    $tabelle: vorher $vorher, jetzt $jetzt"
        fi
    done < "$SICHERUNG_PRUEFWERTE"
    [ "$ABW" = 0 ] && ok "alle Tabellen mit gleicher Zeilenzahl" || hinweis "$ABW Tabelle(n) anders — seit dem Start schreiben Takte (Kurse, Snapshots); trades/diaries müssen gleich sein"
    for t in trades diaries screenshots; do
        vorher="$(grep "^zeilen|$t|" "$SICHERUNG_PRUEFWERTE" | cut -d'|' -f3)"
        jetzt="$(psql_nas "select count(*) from $t")"
        [ "$vorher" = "$jetzt" ] && ok "$t: $jetzt Zeilen wie vorher" || nein "$t: vorher $vorher, jetzt $jetzt"
    done
else
    hinweis "keine Prüfwerte (sichern.sh nicht gelaufen?) — Zeilenvergleich übersprungen"
fi

kopf "HTTP"
H="$( [ "$NAS_HOST" = lokal ] && echo 127.0.0.1 || echo "$NAS_HOST")"
CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://$H:$APP_PORT/")"
[ "$CODE" = 200 ] && ok "http://$H:$APP_PORT/ → 200" || nein "http://$H:$APP_PORT/ → $CODE"
ST="$(curl -s --max-time 10 "http://$H:$APP_PORT/api/auth/status")"
echo "  /api/auth/status: $ST"
echo "$ST" | grep -q '"authEnabled":true' && ok "Passwort-Gate an" || nein "Passwort-Gate nicht an"
echo "$ST" | grep -q '"setupRequired":false' && ok "Passwort aus der alten App gilt (kein Neu-Einrichten)" || nein "verlangt neues Passwort — falsche DB?"
CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://$H:$APP_PORT/api/db/trades")"
[ "$CODE" = 401 ] && ok "API ohne Anmeldung gesperrt (401)" || nein "/api/db/trades ohne Anmeldung → $CODE"
CODE="$(curl -sk -o /dev/null -w '%{http_code}' --max-time 10 "https://$H:$TLS_PORT/")"
[ "$CODE" = 200 ] && ok "https://$H:$TLS_PORT/ (Caddy) → 200" || hinweis "https://$H:$TLS_PORT/ → $CODE (Caddy/Zertifikat prüfen)"
if [ -n "${ESP32_KEY:-}" ]; then
    CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H "X-ESP32-Key: $ESP32_KEY" "http://$H:$APP_PORT/api/esp32/display")"
    [ "$CODE" = 200 ] && ok "/api/esp32/display mit Schlüssel → 200" || nein "/api/esp32/display → $CODE"
else
    CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://$H:$APP_PORT/api/esp32/display")"
    echo "  /api/esp32/display ohne Schlüssel → $CODE (401/403 erwartet; mit ESP32_KEY in .env voll prüfbar)"
fi

kopf "Von Hand (Handbuch docs/UMZUG-PRODUKTIV.md, Schritt 6)"
cat <<'LISTE'
  [ ] Anmelden mit dem bisherigen Passwort (Browser, http://…:8080 und https://…:8443)
  [ ] Journal: Gesamt-P&L, Anzahl Trades, Gewinnquote dieses Jahres = Werte der alten App (Notiz vor dem Umzug)
  [ ] Kalender und Tagesansicht eines bekannten Tages; Bilder öffnen
  [ ] Import: Börsen-Import Bitunix/Bitget/Pionex „Vorschau" (nichts speichern, wenn nichts Neues)
  [ ] Pendente Trades zeigen die offenen Positionen (oder keine)
  [ ] Live-Trading: Liquidations-Ticker füllt sich; Log zeigt „[recorder] … verbunden"
  [ ] Einstellungen › Benachrichtigungen: „Test senden" für Mail und Push kommt an
  [ ] ESP32-Anzeige zeigt Werte (gleiche IP:Port wie vorher)
  [ ] Android-Widget aktualisiert (gleiche Adresse wie vorher)
  [ ] Einstellungen › Lizenz (/einstellungen/lizenz): eigene Lizenz eintragen (siehe Handbuch)
LISTE

echo
[ "$FEHLER" = 0 ] && gruen "Automatische Prüfung: alles in Ordnung" || { rot "Automatische Prüfung: $FEHLER Fehler"; exit 1; }
