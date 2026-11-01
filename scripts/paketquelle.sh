# Paketquelle von AutarkTrade für die Installations- und Update-Skripte (S10).
# Wird mit `. scripts/paketquelle.sh` eingelesen, nicht ausgeführt.
#
# Die Quelle ist das öffentliche Repo Mouses007/AutarkTrade (AGPL-3.0) — kein Zugang
# nötig. Optional, etwa für einen eigenen privaten Fork:
#   AT_UPDATE_TOKEN    GitHub-Token (nur Lesen)
#   AT_UPDATE_BENUTZER optional, Vorgabe x-access-token
#
# Ein Token geht über GIT_CONFIG_* an git — nicht auf die Befehlszeile (Prozessliste)
# und nicht in .git/config. Dasselbe Verfahren nutzt der Update-Knopf der Software
# (server/update-api.js).
# Das alte, öffentliche Repo (Crypto-Trading-Journal, GPL, 3.x) ist KEIN Kanal mehr;
# paketquelle_einrichten stellt eine alte Installation auf das neue Repo um.

AT_REPO_URL="https://github.com/Mouses007/AutarkTrade.git"

paketquelle_zugang() {
    if [ -n "${AT_UPDATE_TOKEN:-}" ]; then
        _at_basic=$(printf '%s:%s' "${AT_UPDATE_BENUTZER:-x-access-token}" "$AT_UPDATE_TOKEN" | base64 | tr -d '\n')
        export GIT_CONFIG_COUNT=1
        export GIT_CONFIG_KEY_0="http.https://github.com/.extraheader"
        export GIT_CONFIG_VALUE_0="AUTHORIZATION: basic $_at_basic"
        unset _at_basic
    fi
}

# Im aktuellen Ordner: git anlegen bzw. origin auf die neue Quelle stellen.
paketquelle_einrichten() {
    [ -d .git ] || git init -q
    if git remote get-url origin >/dev/null 2>&1; then
        git remote set-url origin "$AT_REPO_URL"
    else
        git remote add origin "$AT_REPO_URL"
    fi
    paketquelle_zugang
}

# Was geholt wird: das neueste Release-Tag vX.Y.Z der Quelle — dasselbe, das die
# Update-Prüfung der Software meldet und aus dem Docker baut (Audit FUN-S3-002).
# master-HEAD kann nach einem Release schon unfertige Commits tragen. Vorabversionen
# (Tag mit „-") zählen nicht. Hat die Quelle kein Release-Tag (etwa ein eigener Fork),
# bleibt es master. Ist die Quelle nicht erreichbar: Fehler, kein stiller Rückfall.
paketquelle_ziel() {
    _at_refs=$(git ls-remote --tags --refs origin 'v*') || { unset _at_refs; return 1; }
    _at_tag=$(printf '%s\n' "$_at_refs" \
        | sed -n 's#^[0-9a-f]*[[:space:]]*refs/tags/v\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)$#\1#p' \
        | sort -t. -k1,1n -k2,2n -k3,3n | tail -n 1)
    if [ -n "$_at_tag" ]; then echo "refs/tags/v$_at_tag"; else echo master; fi
    unset _at_refs _at_tag
}

# Stand holen: nur der eine Commit, keine Historie, keine Tags (Audit A3-28).
paketquelle_holen() {
    _at_ziel=$(paketquelle_ziel) || return 1
    git fetch --depth 1 --no-tags origin "$_at_ziel"
    _at_rc=$?
    unset _at_ziel
    return $_at_rc
}

# Nach dem reset: alte Historie entfernen (Klone von vor F4 haben sie noch ganz).
# Gleiches Verfahren wie server/update-flach.js: nur der aktuelle Zweig bleibt,
# HEAD wird Grenze eines flachen Klons, Unerreichbares wird gelöscht.
paketquelle_flach() {
    _at_zweig=$(git symbolic-ref -q HEAD || true)
    git for-each-ref --format='%(refname)' | while read -r _at_ref; do
        [ "$_at_ref" = "$_at_zweig" ] || git update-ref --no-deref -d "$_at_ref"
    done
    git rev-parse HEAD > "$(git rev-parse --git-dir)/shallow"
    git reflog expire --expire=now --all
    git gc --prune=now --quiet
    unset _at_zweig _at_ref
}

# Zugang wieder aus der Umgebung nehmen, sobald git fertig ist (Audit SEC-OPS-008):
# alles, was danach läuft (npm, Install-Skripte der Abhängigkeiten, vite), soll das
# Token nicht sehen.
paketquelle_zugang_weg() {
    unset GIT_CONFIG_COUNT GIT_CONFIG_KEY_0 GIT_CONFIG_VALUE_0 AT_UPDATE_TOKEN AT_UPDATE_BENUTZER
}

# Abhängigkeiten installieren: `npm ci` nach package-lock.json (genau die geprüften
# Versionen statt der Semver-Bereiche), Rückfall auf `npm install`, wenn ci scheitert
# oder keine Sperrdatei da ist. Immer ohne Update-Token in der Umgebung.
paketquelle_npm() {
    paketquelle_zugang_weg
    if [ -f package-lock.json ]; then
        npm ci && return 0
        echo "  npm ci fehlgeschlagen — versuche npm install"
    fi
    npm install
}

paketquelle_hinweis() {
    echo "  Die Paketquelle ist github.com/Mouses007/AutarkTrade — Internetverbindung prüfen."
    echo "  Für einen privaten Fork: AT_UPDATE_TOKEN=<github-token> $0"
}
