#!/usr/bin/env bash
#
# AutarkTrade auf die NAS bringen — der gewohnte Aufruf.
#
#   scripts/nas-deploy.sh [--trocken]
#
# Einstellungen wie bisher aus scripts/.nas-deploy.env (nicht im Git):
#   NAS_HOST=192.168.178.100
#   NAS_USER=deinDsmBenutzer
#   NAS_PROJEKT=/volume1/docker/tradingjournal
#   NAS_PORT=8080
#
# Die Arbeit macht scripts/umzug/nas-deploy.sh: lokal bauen, per SSH
# übertragen, auf der NAS als autarktrade:produktiv laden, Projekt neu
# erstellen, Kontrolle. Beim ERSTEN Lauf (dort steht noch die alte App)
# tauscht es nach Rückfrage die Compose-Datei — siehe docs/UMZUG-PRODUKTIV.md.
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/umzug/nas-deploy.sh" "$@"
