#!/usr/bin/env bash
# AutarkTrade-Desklet (Positionen) – Installations-Skript
# Kopiert den Desklet in das Cinnamon-Desklet-Verzeichnis und aktiviert ihn.

set -euo pipefail

DESKLET_UUID="positionen@autarktrade"
DESKLET_SRC="$(cd "$(dirname "$0")" && pwd)/${DESKLET_UUID}"
DESKLET_DIR="${HOME}/.local/share/cinnamon/desklets"
DEST="${DESKLET_DIR}/${DESKLET_UUID}"

# --stimme: Piper (MIT) und die Stimmen „Thorsten“ (CC0, deutsch) und „Jenny (Dioco)“ (englisch) für die Alarm-Ansage
# nach ~/.local/share/piper holen (~225 MB). Ohne sie liest das Desklet mit spd-say vor.
if [ "${1:-}" = "--stimme" ]; then
    PIPER_ORDNER="${HOME}/.local/share/piper"
    STIMME_URL="https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/de/de_DE/thorsten/high/de_DE-thorsten-high.onnx"
    mkdir -p "${PIPER_ORDNER}/stimmen"
    echo "==> Piper und Stimme laden nach ${PIPER_ORDNER}"
    curl -fL https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz \
        | tar xz -C "${PIPER_ORDNER}"
    curl -fL -o "${PIPER_ORDNER}/stimmen/de_DE-thorsten-high.onnx" "${STIMME_URL}"
    curl -fL -o "${PIPER_ORDNER}/stimmen/de_DE-thorsten-high.onnx.json" "${STIMME_URL}.json"
    # Englisch, weiblich: „Jenny (Dioco)“ — Namensnennung ist Lizenzbedingung (Desklet-Einstellungen)
    JENNY_URL="https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_GB/jenny_dioco/medium/en_GB-jenny_dioco-medium.onnx"
    curl -fL -o "${PIPER_ORDNER}/stimmen/en_GB-jenny_dioco-medium.onnx" "${JENNY_URL}"
    curl -fL -o "${PIPER_ORDNER}/stimmen/en_GB-jenny_dioco-medium.onnx.json" "${JENNY_URL}.json"
    echo ""
fi

echo "==> AutarkTrade-Desklet (Positionen) installieren"
echo "    Quelle: ${DESKLET_SRC}"
echo "    Ziel:   ${DEST}"

# Zielverzeichnis erstellen
mkdir -p "${DESKLET_DIR}"

# Alten Desklet ggf. ersetzen
if [ -d "${DEST}" ]; then
    echo "    Vorhandene Version wird ersetzt..."
    rm -rf "${DEST}"
fi

cp -r "${DESKLET_SRC}" "${DEST}"
echo "    Dateien kopiert."

# Übersetzungen: Cinnamon baut die .mo nur bei Installation aus dem Spices-Store.
if command -v msgfmt >/dev/null 2>&1; then
    for PO in "${DEST}"/po/*.po; do
        [ -f "${PO}" ] || continue
        SPRACHE="$(basename "${PO}" .po)"
        MO_DIR="${HOME}/.local/share/locale/${SPRACHE}/LC_MESSAGES"
        mkdir -p "${MO_DIR}"
        msgfmt -o "${MO_DIR}/${DESKLET_UUID}.mo" "${PO}"
        echo "    Übersetzung installiert: ${SPRACHE}"
    done
else
    echo "    msgfmt fehlt (Paket gettext) — Desklet bleibt englisch."
fi

# Die Einstellungen enthalten den Geräteschlüssel im Klartext. Cinnamon legt sie
# gruppenlesbar an (0664) — nur der eigene Benutzer soll sie lesen (Audit SEC-DSK-001).
# Der Desklet zieht die Rechte bei jedem Start selbst nach; hier für bestehende Dateien.
for CFG_DIR in "${HOME}/.config/cinnamon/spices/${DESKLET_UUID}" "${HOME}/.cinnamon/configs/${DESKLET_UUID}"; do
    if [ -d "${CFG_DIR}" ]; then
        chmod 700 "${CFG_DIR}"
        find "${CFG_DIR}" -maxdepth 1 -type f \( -name '*.json' -o -name '*.pem' \) -exec chmod 600 {} +
        echo "    Einstellungen nur für dich lesbar: ${CFG_DIR} (700, *.json/*.pem 600)"
    fi
done

# Cinnamon-Einstellungen: Desklet zur enabled-Liste hinzufügen (falls noch nicht vorhanden)
SETTINGS_FILE="${HOME}/.cinnamon/configs/org.cinnamon/org.cinnamon.json"

if [ -f "${SETTINGS_FILE}" ]; then
    # Prüfen ob desklet bereits aktiviert ist
    if python3 -c "
import json, sys
with open('${SETTINGS_FILE}') as f:
    cfg = json.load(f)
desklets = cfg.get('enabled-desklets', {}).get('value', [])
# Suche nach UUID in der Liste
found = any('${DESKLET_UUID}' in str(d) for d in desklets)
sys.exit(0 if found else 1)
" 2>/dev/null; then
        echo "    Desklet ist bereits in der aktivierten Liste."
    else
        echo ""
        echo "    HINWEIS: Desklet wurde installiert, aber noch nicht aktiviert."
        echo "    Bitte manuell aktivieren:"
        echo ""
        echo "    Rechtsklick auf Desktop → Desklets → '${DESKLET_UUID}' suchen → Hinzufügen"
        echo ""
        echo "    Oder über die Kommandozeile:"
        echo "    gsettings set org.cinnamon enabled-desklets \"\$(gsettings get org.cinnamon enabled-desklets | sed \"s/]$/, '${DESKLET_UUID}:0:100:100']/\")\""
    fi
else
    echo ""
    echo "    Cinnamon-Konfigurationsdatei nicht gefunden."
    echo "    Bitte Desklet manuell aktivieren:"
    echo "    Rechtsklick auf Desktop → Desklets → '${DESKLET_UUID}' → Hinzufügen"
fi

echo ""
echo "==> Installation abgeschlossen!"
echo ""
echo "    Nach der Aktivierung:"
echo "    - Rechtsklick auf Desklet → Einstellungen → Host, Port (Standard: 8080) und API-Key eintragen"
echo "    - HTTPS (Port 8443) ist voreingestellt: einmal koppeln mit „1. Server-Zertifikat holen“,"
echo "      Fingerabdruck mit Einstellungen › Allgemein › HTTPS in der Web-App vergleichen,"
echo "      dann „2. Fingerabdruck stimmt — koppeln“"
echo "    - Desklet aktualisiert sich automatisch alle 30 Sekunden"
echo ""
