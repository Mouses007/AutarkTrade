#!/bin/bash
# AutarkTrade - Manuelles Update
# Normalerweise genuegt der Update-Knopf in der Software;
# dieses Skript ist der Weg fuer den Notfall. Bei Update-Problemen im Installationsordner:
#   chmod +x update.sh && ./update.sh

set -e
cd "$(dirname "$0")"

GREEN='\033[92m'
RED='\033[91m'
CYAN='\033[96m'
BOLD='\033[1m'
RESET='\033[0m'

echo ""
echo -e "  ${CYAN}${BOLD}══════════════════════════════════════════${RESET}"
echo -e "  ${CYAN}${BOLD}   AutarkTrade - Update        ${RESET}"
echo -e "  ${CYAN}${BOLD}══════════════════════════════════════════${RESET}"
echo ""

# Pruefen ob wir im richtigen Ordner sind
if [ ! -f "package.json" ]; then
    echo -e "  ${RED}FEHLER: package.json nicht gefunden!${RESET}"
    echo -e "  Bitte lege diese Datei in den Installationsordner."
    echo ""
    exit 1
fi

OLD_VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('package.json','utf8')).version)" 2>/dev/null || echo "unbekannt")
echo -e "  Aktuelle Version: ${BOLD}v${OLD_VERSION}${RESET}"
echo ""

# Paketquelle einrichten (stellt auch eine alte Installation vom öffentlichen Repo um)
. ./scripts/paketquelle.sh
paketquelle_einrichten

# Update holen
echo -e "  ${CYAN}[1/4] Lade neueste Version...${RESET}"
if ! paketquelle_holen; then
    echo -e "  ${RED}FEHLER: Paketquelle nicht erreichbar oder Zugang abgelehnt.${RESET}"
    paketquelle_hinweis
    exit 1
fi

echo -e "  ${CYAN}[2/4] Installiere neueste Version...${RESET}"
# FETCH_HEAD statt origin/master: nach der neuen Wurzel ist das kein Vorspulen, und ein
# abgewiesenes Nachführen von origin/master liesse das Update still beim alten Stand.
git reset --hard FETCH_HEAD
# Alte Historie entfernen (nur der ausgelieferte Stand bleibt)
paketquelle_flach || echo "  Hinweis: alte Historie nicht entfernt (Update trotzdem aktuell)"

echo -e "  ${CYAN}[3/4] Installiere Abhaengigkeiten...${RESET}"
npm install

echo -e "  ${CYAN}[4/4] Baue Frontend...${RESET}"
npm run build

NEW_VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('package.json','utf8')).version)" 2>/dev/null || echo "unbekannt")

echo ""
echo -e "  ${GREEN}══════════════════════════════════════════${RESET}"
echo -e "  ${GREEN}${BOLD}  Update erfolgreich!${RESET}"
echo -e "  ${GREEN}  v${OLD_VERSION} → v${NEW_VERSION}${RESET}"
echo -e "  ${GREEN}══════════════════════════════════════════${RESET}"
echo ""
echo -e "  Server neu starten mit: ${BOLD}./start-linux.sh${RESET}"
echo ""
