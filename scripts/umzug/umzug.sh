#!/usr/bin/env bash
# Der ganze Umzug der alten App auf AutarkTrade V2 in einem Lauf (U1).
#
#   scripts/umzug/umzug.sh --trocken     alle Schritte nur anzeigen
#   scripts/umzug/umzug.sh               Schritt für Schritt, jeder mit eigener Ja-Abfrage
#
# Reihenfolge (Handbuch docs/UMZUG-PRODUKTIV.md):
#   sichern.sh     0) offene Live-Positionen, 1) pg_dump + Prüfung + Prüfwerte
#   alt-stoppen.sh 2) alte App stoppen (nicht löschen), Compose/.env/Image festhalten
#   nas-deploy.sh  3+4) V2-Image privat auf die NAS, Compose tauschen, Projekt neu erstellen
#   pruefen.sh     5+6) Migrationen, Log, Daten, HTTP — nur lesend
# Bricht ein Schritt ab, hält das Ganze an. Zurück: scripts/umzug/rueckweg.sh.
set -euo pipefail
HIER="$(cd "$(dirname "$0")" && pwd)"
for schritt in sichern alt-stoppen nas-deploy pruefen; do
    printf '\n\033[95m######## %s ########\033[0m\n' "$schritt"
    if ! "$HIER/$schritt.sh" "$@"; then
        printf '\033[91mUmzug angehalten bei %s.\033[0m Stand: siehe oben; zurück mit scripts/umzug/rueckweg.sh\n' "$schritt"
        exit 1
    fi
done
printf '\n\033[92mUmzug durchgelaufen.\033[0m Jetzt die Liste „Von Hand" oben abarbeiten.\n'
