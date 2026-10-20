#!/usr/bin/env bash
# Neue Wurzel für AutarkTrade: master wird ein einzelner Commit ohne Vorgänger,
# mit genau dem Baum des heutigen master (Audit A3-27 bis A3-30, Auftrag F4).
#
# Die Historie beginnt mit dem Ausgangsstand des Forks (HERKUNFT.md). Sie ist der
# Beleg für den Clean-Room-Neubau und bleibt deshalb erhalten, aber nur im Bündel
# (git bundle) ausserhalb des Repos, nicht im Repo, das ausgeliefert wird.
#
# NUR VOM NUTZER SELBST ZU STARTEN. Das Skript schreibt die Historie um, schiebt mit
# --force-with-lease und löscht Remote-Zweige und Tags. Jeder Schritt mit Wirkung
# nach aussen fragt vorher und läuft nur nach der Antwort „ja“.
#
#   scripts/historie-neu-wurzeln.sh --trocken     # zeigt alles, ändert nichts
#   scripts/historie-neu-wurzeln.sh               # fragt vor jedem Schritt
#
# Optionen:
#   --trocken          nur anzeigen; der neue Commit wird in einem Wegwerf-Objektspeicher
#                      gebaut, damit Hash und Baum-Vergleich trotzdem zu sehen sind
#   --repo PFAD        Hauptverzeichnis des Repos (Vorgabe: das, zu dem dieses Skript gehört)
#   --buendel DATEI    Sicherung (Vorgabe: das neueste <repo>-historie-bis-*.bundle neben dem Repo)
#   --remote NAME      Vorgabe origin
#
# Ablauf:
#   a) Bündel prüfen: vorhanden, `git bundle verify` gültig, enthält den heutigen master
#   b) Orphan-Commit mit dem Baum von master (`git commit-tree master^{tree}`)
#   c) Baum vorher/nachher vergleichen, sonst Abbruch
#   d) master lokal auf die neue Wurzel setzen                         [Frage]
#   e) push --force-with-lease, übrige Remote-Zweige und Tags löschen  [Frage]
#   f) lokal aufräumen: saubere Worktrees, alte Zweige, Reflog, gc     [Frage]
#
# Zurück: alles steht im Bündel. `git clone <bündel> alt` holt jeden alten Stand.
set -euo pipefail

TROCKEN=0
REPO=""
BUENDEL=""
REMOTE=origin
while [ $# -gt 0 ]; do
    case "$1" in
        --trocken) TROCKEN=1 ;;
        --repo) REPO="$2"; shift ;;
        --buendel) BUENDEL="$2"; shift ;;
        --remote) REMOTE="$2"; shift ;;
        -h|--hilfe|--help) sed -n '2,32p' "$0"; exit 0 ;;
        *) echo "Unbekannte Option: $1" >&2; exit 2 ;;
    esac
    shift
done

rot()  { printf '\033[91m%s\033[0m\n' "$*"; }
gruen(){ printf '\033[92m%s\033[0m\n' "$*"; }
gelb() { printf '\033[93m%s\033[0m\n' "$*"; }
kopf() { printf '\n\033[96m== %s ==\033[0m\n' "$*"; }
abbruch() { rot "ABBRUCH: $*"; exit 1; }

# Frage mit genau „ja“ als Zustimmung. Im Trockenlauf wird nie gefragt.
frage() {
    if [ "$TROCKEN" = 1 ]; then
        gelb "  (trocken) würde fragen: $1 — nichts ausgeführt"
        return 1
    fi
    local antwort=""
    printf '\033[93m%s\033[0m [ja/nein] ' "$1"
    read -r antwort || true
    [ "$antwort" = "ja" ]
}

# ── Repo bestimmen ───────────────────────────────────────────────
if [ -z "$REPO" ]; then
    gemeinsam=$(git -C "$(dirname "$0")" rev-parse --path-format=absolute --git-common-dir)
    REPO=$(dirname "$gemeinsam")
fi
REPO=$(cd "$REPO" && pwd)
g() { git -C "$REPO" "$@"; }
g rev-parse --git-dir >/dev/null 2>&1 || abbruch "$REPO ist kein git-Repo"
[ "$(g rev-parse --is-bare-repository)" = false ] || abbruch "nacktes Repo wird nicht unterstützt"
g var GIT_COMMITTER_IDENT >/dev/null 2>&1 || abbruch "keine git-Identität (user.name/user.email) in $REPO"

kopf "Ausgangslage"
echo "Repo:    $REPO"
ALT=$(g rev-parse --verify -q refs/heads/master) || abbruch "kein Zweig master"
BAUM=$(g rev-parse "$ALT^{tree}")
WURZELN_ALT=$(g rev-list --max-parents=0 "$ALT" | tr '\n' ' ')
echo "master:  $ALT  ($(g log -1 --format='%cd · %s' --date=short "$ALT"))"
echo "Baum:    $BAUM"
echo "Commits: $(g rev-list --count "$ALT") auf master, Wurzel(n): $WURZELN_ALT"
if [ "$(g symbolic-ref -q --short HEAD || true)" = master ] && [ -n "$(g status --porcelain --untracked-files=no)" ]; then
    abbruch "master ist im Hauptverzeichnis ausgecheckt und hat Änderungen — erst committen oder verwerfen"
fi
NUR_AUFRAEUMEN=0
UMGESETZT=0
if [ "$(g rev-list --count "$ALT")" = 1 ]; then
    # Zweiter Lauf, z.B. nachdem ein Worktree mit Änderungen gesichert wurde:
    # master ist schon die neue Wurzel, es bleibt nur Schritt f).
    gelb "master ist schon eine einzelne Wurzel — nur noch Schritt f) (Aufräumen)"
    NUR_AUFRAEUMEN=1
    UMGESETZT=1
fi

if [ "$NUR_AUFRAEUMEN" = 0 ]; then
# Remote muss gleich stehen, sonst ginge beim Schieben fremde Arbeit verloren.
REMOTE_ALT=""
if g remote get-url "$REMOTE" >/dev/null 2>&1; then
    g fetch -q "$REMOTE" || abbruch "fetch von $REMOTE gescheitert"
    REMOTE_ALT=$(g rev-parse --verify -q "refs/remotes/$REMOTE/master" || true)
    echo "$REMOTE/master: ${REMOTE_ALT:-(fehlt)}"
    [ -z "$REMOTE_ALT" ] || [ "$REMOTE_ALT" = "$ALT" ] || abbruch "$REMOTE/master ($REMOTE_ALT) ≠ master ($ALT) — erst angleichen"
else
    gelb "kein Remote $REMOTE — Schritt e) entfällt"
fi

# ── a) Bündel ────────────────────────────────────────────────────
kopf "a) Sicherung prüfen"
if [ -z "$BUENDEL" ]; then
    BUENDEL=$(ls -1 "$(dirname "$REPO")/$(basename "$REPO")"-historie-bis-*.bundle 2>/dev/null | sort | tail -1 || true)
fi
[ -n "$BUENDEL" ] && [ -f "$BUENDEL" ] || abbruch "kein Bündel gefunden. Anlegen mit:
  git -C \"$REPO\" bundle create \"$(dirname "$REPO")/$(basename "$REPO")-historie-bis-\$(date +%F).bundle\" --all"
echo "Bündel:  $BUENDEL"
g bundle verify -q "$BUENDEL" >/dev/null 2>&1 || abbruch "git bundle verify meldet Fehler für $BUENDEL"
echo "Grösse:  $(du -h "$BUENDEL" | cut -f1)   SHA-256: $(sha256sum "$BUENDEL" | cut -d' ' -f1)"
# `bundle verify` prüft nur Kopf und Vorbedingungen — ein abgeschnittenes Bündel
# besteht es. Deshalb ganz auspacken und mit fsck --full prüfen.
PRUEF=$(mktemp -d)
trap 'rm -rf "$PRUEF" ${WEGWERF:+"$WEGWERF"}' EXIT
git init -q --bare "$PRUEF/r.git"
git -C "$PRUEF/r.git" fetch -q "$BUENDEL" 'refs/*:refs/buendel/*' 2>/dev/null || abbruch "Bündel lässt sich nicht auspacken: $BUENDEL"
git -C "$PRUEF/r.git" fsck --full --no-progress >/dev/null 2>&1 || abbruch "fsck meldet Fehler im Inhalt des Bündels"
# Der heutige master muss im Bündel stecken.
git -C "$PRUEF/r.git" cat-file -e "$ALT^{commit}" 2>/dev/null || abbruch "das Bündel enthält den heutigen master $ALT nicht (älter als der letzte Commit). Neu anlegen:
  git -C \"$REPO\" bundle create \"$(dirname "$REPO")/$(basename "$REPO")-historie-bis-\$(date +%F).bundle\" --all"
echo "Inhalt:  $(git -C "$PRUEF/r.git" rev-list --all --count) Commits, $(git -C "$PRUEF/r.git" for-each-ref | wc -l) Referenzen, fsck sauber"
for zweig in $(g for-each-ref --format='%(refname)' refs/heads); do
    sha=$(g rev-parse "$zweig")
    git -C "$PRUEF/r.git" cat-file -e "$sha^{commit}" 2>/dev/null || gelb "  Hinweis: $zweig ($sha) ist nicht im Bündel — geht beim Aufräumen verloren"
done
gruen "Bündel gültig und vollständig für master"

# ── b) Orphan-Commit ─────────────────────────────────────────────
kopf "b) neue Wurzel bauen"
NACHRICHT="AutarkTrade – Ausgangsstand

Neue Wurzel mit genau dem Baum von master $ALT
($(g log -1 --format=%cd --date=short "$ALT")). Woher der Code stammt und der Nachweis,
dass nichts Übernommenes mehr enthalten ist: HERKUNFT.md.

Die frühere Historie ist nicht Teil dieses Repos; sie liegt als Beleg im Bündel
$(basename "$BUENDEL") (SHA-256 $(sha256sum "$BUENDEL" | cut -d' ' -f1))."
WEGWERF=""
if [ "$TROCKEN" = 1 ]; then
    # Objekt in einen Wegwerf-Speicher schreiben: das Repo bleibt unberührt.
    WEGWERF=$(mktemp -d)
    trap 'rm -rf "$PRUEF" "$WEGWERF"' EXIT
    export GIT_ALTERNATE_OBJECT_DIRECTORIES="$(g rev-parse --path-format=absolute --git-common-dir)/objects"
    export GIT_OBJECT_DIRECTORY="$WEGWERF"
fi
NEU=$(printf '%s\n' "$NACHRICHT" | g commit-tree "$BAUM")
echo "neuer Commit: $NEU"
g log -1 --format='%n%B' "$NEU" | sed 's/^/    /'

# ── c) Baum-Vergleich ────────────────────────────────────────────
kopf "c) Baum vergleichen"
BAUM_NEU=$(g rev-parse "$NEU^{tree}")
echo "vorher:  $BAUM"
echo "nachher: $BAUM_NEU"
[ "$BAUM" = "$BAUM_NEU" ] || abbruch "Baum weicht ab"
[ "$(g rev-list --parents -n1 "$NEU" | wc -w)" = 1 ] || abbruch "neuer Commit hat einen Vorgänger"
g diff --quiet "$ALT" "$NEU" || abbruch "git diff zwischen alt und neu nicht leer"
gruen "Baum identisch, kein Vorgänger, kein Unterschied"

if [ "$TROCKEN" = 1 ]; then
    unset GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES
fi

# ── d) master umsetzen ───────────────────────────────────────────
kopf "d) master lokal umsetzen"
echo "git update-ref refs/heads/master $NEU $ALT"
if frage "master lokal auf die neue Wurzel setzen?"; then
    g update-ref -m "historie-neu-wurzeln: neue Wurzel" refs/heads/master "$NEU" "$ALT"
    gruen "master = $NEU"
    if [ "$(g symbolic-ref -q --short HEAD || true)" = master ]; then
        [ -z "$(g status --porcelain --untracked-files=no)" ] || abbruch "Arbeitsstand nach dem Umsetzen nicht sauber — prüfen!"
    fi
    UMGESETZT=1
else
    echo "master bleibt $ALT."
    UMGESETZT=0
fi

# ── e) Remote ────────────────────────────────────────────────────
kopf "e) Remote $REMOTE"
if g remote get-url "$REMOTE" >/dev/null 2>&1; then
    mapfile -t R_ZWEIGE < <(g ls-remote --heads "$REMOTE" | awk '{print $2}' | grep -vx 'refs/heads/master' || true)
    mapfile -t R_TAGS < <(g ls-remote --tags --refs "$REMOTE" | awk '{print $2}' || true)
    echo "git push --force-with-lease=refs/heads/master:${REMOTE_ALT:-} $REMOTE ${NEU}:refs/heads/master"
    echo "danach löschen: ${#R_ZWEIGE[@]} Zweig(e), ${#R_TAGS[@]} Tag(s)"
    for r in "${R_ZWEIGE[@]}" "${R_TAGS[@]}"; do [ -n "$r" ] && echo "    $r"; done
    gelb "  GitHub hält alte Objekte über Pull-Request-Referenzen und Caches noch eine Weile"
    gelb "  erreichbar. Ganz sicher weg sind sie nur über den GitHub-Support oder ein neues Repo"
    gelb "  (Bericht A3, Abschnitt „Historie“)."
    if [ "${UMGESETZT:-0}" = 1 ] && frage "Jetzt mit --force-with-lease schieben und die übrigen Remote-Zweige und Tags löschen?"; then
        g push --force-with-lease="refs/heads/master:${REMOTE_ALT}" "$REMOTE" "${NEU}:refs/heads/master"
        for r in "${R_ZWEIGE[@]}" "${R_TAGS[@]}"; do
            [ -n "$r" ] && g push "$REMOTE" --delete "$r"
        done
        g fetch -q --prune --prune-tags "$REMOTE"
        gruen "Remote umgestellt"
    elif [ "${UMGESETZT:-0}" != 1 ] && [ "$TROCKEN" != 1 ]; then
        echo "master wurde nicht umgesetzt — nichts geschoben."
    fi
else
    echo "kein Remote $REMOTE"
fi

fi # NUR_AUFRAEUMEN

# ── f) lokal aufräumen ───────────────────────────────────────────
kopf "f) lokal aufräumen"
HIER=$(pwd -P)
WT_WEG=(); WT_BLEIBT=()
while read -r zeile; do
    case "$zeile" in worktree\ *) wt=${zeile#worktree } ;; *) continue ;; esac
    [ "$wt" = "$REPO" ] && continue
    if [ ! -d "$wt" ]; then WT_WEG+=("$wt"); continue; fi
    case "$HIER/" in "$wt"/*) WT_BLEIBT+=("$wt (hier läuft das Skript)"); continue ;; esac
    if [ -n "$(git -C "$wt" status --porcelain 2>/dev/null)" ]; then
        WT_BLEIBT+=("$wt (ungesicherte Änderungen)")
    else
        WT_WEG+=("$wt")
    fi
done < <(g worktree list --porcelain)
mapfile -t ZWEIGE < <(g for-each-ref --format='%(refname:short)' refs/heads | grep -vx master || true)
SONST=$(g for-each-ref --format='%(refname)' | grep -vE '^refs/(heads|remotes|tags)/' || true)
echo "Worktrees entfernen (sauber): ${#WT_WEG[@]}"
for w in "${WT_WEG[@]}"; do echo "    $w"; done
echo "Worktrees bleiben: ${#WT_BLEIBT[@]}"
for w in "${WT_BLEIBT[@]}"; do echo "    $w"; done
echo "lokale Zweige löschen (ausser master): ${#ZWEIGE[@]}"
for z in "${ZWEIGE[@]}"; do [ -n "$z" ] && echo "    $z"; done
[ -z "$SONST" ] || { echo "weitere Referenzen löschen:"; echo "$SONST" | sed 's/^/    /'; }
[ -z "$(g tag)" ] || { echo "lokale Tags löschen:"; g tag | sed 's/^/    /'; }
echo "dann: git reflog expire --expire=now --all && git gc --prune=now"
if [ "${UMGESETZT:-0}" = 1 ] && frage "Lokal aufräumen (Worktrees, Zweige, Reflog, gc)?"; then
    for w in "${WT_WEG[@]}"; do
        if [ -d "$w" ]; then g worktree remove "$w" || gelb "  nicht entfernt: $w"; fi
    done
    g worktree prune
    for z in "${ZWEIGE[@]}"; do
        [ -n "$z" ] && { g branch -D "$z" >/dev/null 2>&1 && echo "  gelöscht: $z" || gelb "  bleibt (noch ausgecheckt?): $z"; }
    done
    for r in $SONST; do g update-ref --no-deref -d "$r"; done
    for t in $(g tag); do g tag -d "$t" >/dev/null; done
    g reflog expire --expire=now --all
    g gc --prune=now --quiet
    gruen "aufgeräumt"
fi

# ── Prüfen ───────────────────────────────────────────────────────
kopf "Stand"
echo "Wurzel(n) aller Referenzen: $(g rev-list --max-parents=0 --all | tr '\n' ' ')"
echo "Commits insgesamt:          $(g rev-list --all --count)"
for w in $WURZELN_ALT; do
    [ "$w" = "$(g rev-parse refs/heads/master)" ] && { gruen "master ist die einzige Wurzel $w"; continue; }
    if g cat-file -e "$w^{commit}" 2>/dev/null; then
        halter=$(g for-each-ref --contains "$w" --format='%(refname)' | tr '\n' ' ')
        gelb "alte Wurzel $w noch im Repo${halter:+, gehalten von: $halter}"
    else
        gruen "alte Wurzel $w nicht mehr im Repo"
    fi
done
echo
echo "Danach: node scripts/herkunft-pruefen.mjs  ·  Bündel sicher ablegen: $BUENDEL"
echo "spaeter/scharfer-handel zurückholen: docs/SPAETER-SCHARFER-HANDEL.md"
[ "$TROCKEN" = 1 ] && gelb "Trockenlauf: nichts geändert."
exit 0
