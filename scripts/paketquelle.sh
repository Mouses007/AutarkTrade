# Paketquelle von AutarkTrade für die Installations- und Update-Skripte (S10).
# Wird mit `. scripts/paketquelle.sh` eingelesen, nicht ausgeführt.
#
# Die Quelle ist das PRIVATE Repo Mouses007/AutarkTrade. Zugang:
#   AT_UPDATE_TOKEN    Zugangsschlüssel aus der Lizenz-Mail (GitHub-Token, nur Lesen)
#   AT_UPDATE_BENUTZER optional, Vorgabe x-access-token
# Ohne AT_UPDATE_TOKEN fragt git selbst nach Benutzername und Passwort (Token).
#
# Der Token geht über GIT_CONFIG_* an git — nicht auf die Befehlszeile (Prozessliste)
# und nicht in .git/config. Dasselbe Verfahren nutzt der Update-Knopf der Software
# (server/update-api.js), der dazu die Update-Berechtigung aus dem Lizenzschlüssel prüft.
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

# Stand holen: nur der eine Commit, keine Historie, keine Tags (Audit A3-28).
paketquelle_holen() {
    git fetch --depth 1 --no-tags origin master
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

paketquelle_hinweis() {
    echo "  Die Paketquelle ist privat. Zugang mit dem Zugangsschlüssel aus deiner Lizenz-Mail:"
    echo "    AT_UPDATE_TOKEN=<schluessel> $0"
    echo "  oder git fragt nach Benutzername und Passwort (dort den Schlüssel eingeben)."
}
