/**
 * Flaches git beim Kunden (Audit A3-28, F4).
 *
 * Installation und Update holen den Stand mit `git fetch --depth 1` — beim Kunden
 * soll nur der ausgelieferte Stand liegen, nicht die Entstehungsgeschichte des Repos.
 * Ein flacher Fetch allein genügt aber nicht für einen Klon, der schon die ganze
 * Historie hat: liegt der Vorgänger des geholten Commits lokal vor, ist der neue
 * Commit gar nicht flach, und alte Commits bleiben über Zweige, `origin/*`, Tags und
 * das Reflog erreichbar. `macheFlach` räumt das auf:
 *
 *   1. alle Referenzen ausser dem aktuellen Zweig löschen (`refs/remotes/*`,
 *      `refs/tags/*`, andere Zweige, `refs/stash`) — die Rollback-Referenz bleibt;
 *   2. HEAD und den Rollback-Commit in `.git/shallow` eintragen, also als Commits
 *      ohne Vorgänger behandeln (so markiert git selbst die Grenze eines flachen Klons);
 *   3. Reflog leeren und `git gc --prune=now` — alles, was nicht mehr erreichbar ist,
 *      verschwindet aus `.git/objects`.
 *
 * Der Rollback-Commit (Stand vor dem Update) bleibt unter `ROLLBACK_REF` erreichbar,
 * sonst würde ihn Schritt 3 mitnehmen und `/api/update/rollback` liefe ins Leere.
 *
 * Nur git, kein Netz. Selbsttest: `server/__selftest-update-flach.mjs`.
 */
import { execFileSync } from 'child_process'
import { writeFileSync } from 'fs'
import path from 'path'

export const ROLLBACK_REF = 'refs/autarktrade/rollback'

/** Argumente für `git fetch`: genau ein Commit, keine Tags. */
export const FETCH_FLACH = ['--depth', '1', '--no-tags']

function git(cwd, args, opts = {}) {
    return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim()
}

/**
 * @param {string} cwd Projektordner mit `.git`
 * @param {{rollback?: string|null}} [opt] Commit, der für den Rollback erhalten bleibt
 * @returns {{commits: number, geloescht: string[]}} Zahl der danach erreichbaren Commits, gelöschte Referenzen
 */
export function macheFlach(cwd, { rollback = null } = {}) {
    const kopf = git(cwd, ['rev-parse', 'HEAD'])
    let zweig = null
    try { zweig = git(cwd, ['symbolic-ref', '-q', 'HEAD']) } catch { /* abgekoppelter HEAD */ }

    if (rollback) {
        try {
            git(cwd, ['cat-file', '-e', `${rollback}^{commit}`])
            git(cwd, ['update-ref', ROLLBACK_REF, rollback])
        } catch {
            rollback = null
        }
    }

    const behalten = new Set([zweig, rollback ? ROLLBACK_REF : null].filter(Boolean))
    const geloescht = []
    for (const ref of git(cwd, ['for-each-ref', '--format=%(refname)']).split('\n').filter(Boolean)) {
        if (behalten.has(ref)) continue
        git(cwd, ['update-ref', '--no-deref', '-d', ref])
        geloescht.push(ref)
    }
    if (!rollback) {
        try { git(cwd, ['update-ref', '-d', ROLLBACK_REF]) } catch { /* gab es nicht */ }
    }

    const grenze = [...new Set([kopf, rollback].filter(Boolean))]
    const gitDir = path.resolve(cwd, git(cwd, ['rev-parse', '--git-dir']))
    writeFileSync(path.join(gitDir, 'shallow'), grenze.join('\n') + '\n')

    git(cwd, ['reflog', 'expire', '--expire=now', '--all'])
    git(cwd, ['gc', '--prune=now', '--quiet'])

    const commits = Number(git(cwd, ['rev-list', '--all', '--count']))
    return { commits, geloescht }
}
