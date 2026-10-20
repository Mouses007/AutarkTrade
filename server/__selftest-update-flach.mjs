/**
 * Selbsttest für das flache git beim Kunden (Audit A3-28, F4).
 *
 *   node server/__selftest-update-flach.mjs
 *
 * Warum: Installation und Update holten mit `git fetch … master` die ganze
 * Historie, samt dem Ausgangsstand des Forks, auf jeden Kundenrechner. Geprüft wird
 * an Wegwerf-Repos im Temp-Ordner (kein Netz, `file://`):
 *   - ein flacher Fetch allein lässt die alte Historie eines vollen Klons stehen
 *     (darum gibt es `macheFlach`);
 *   - nach `macheFlach` sind nur noch HEAD und der Rollback-Commit da, die alten
 *     Objekte sind weg, der Rollback funktioniert;
 *   - dasselbe nach einer neuen Wurzel (Orphan-Commit, scripts/historie-neu-wurzeln.sh);
 *   - die Shell-Fassung `paketquelle_flach` macht dasselbe;
 *   - kein `git fetch`/`git clone` in den Liefer-Skripten ohne `--depth 1`.
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'

const wurzel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let bestanden = 0
let fehler = 0
function pruefe(name, bedingung, zusatz = '') {
    if (bedingung) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}

try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
} catch {
    console.log('git fehlt — Test übersprungen')
    process.exit(0)
}

const { macheFlach, ROLLBACK_REF, FETCH_FLACH } = await import('./update-flach.js')

const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 't@t',
}
// macheFlach ruft git ohne eigene Umgebung — für den Test dieselbe setzen
Object.assign(process.env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' })

const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const gibtEs = (cwd, obj) => { try { git(cwd, 'cat-file', '-e', obj); return true } catch { return false } }
const zahl = (cwd) => Number(git(cwd, 'rev-list', '--all', '--count'))

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'at-flach-'))
try {
    // Quelle mit drei Commits; der erste trägt einen Inhalt, der später verschwinden muss
    const quelle = path.join(tmp, 'quelle')
    fs.mkdirSync(quelle)
    git(quelle, 'init', '-q', '-b', 'master')
    fs.writeFileSync(path.join(quelle, 'alt.txt'), 'Altstand, darf beim Kunden nicht liegen\n')
    git(quelle, 'add', '.'); git(quelle, 'commit', '-q', '-m', 'Wurzel alt')
    const altBlob = git(quelle, 'rev-parse', 'HEAD:alt.txt')
    const altWurzel = git(quelle, 'rev-parse', 'HEAD')
    git(quelle, 'rm', '-q', 'alt.txt')
    fs.writeFileSync(path.join(quelle, 'a.txt'), '1\n')
    git(quelle, 'add', '.'); git(quelle, 'commit', '-q', '-m', 'zwei')
    fs.writeFileSync(path.join(quelle, 'a.txt'), '2\n')
    git(quelle, 'add', '.'); git(quelle, 'commit', '-q', '-m', 'drei')
    git(quelle, 'tag', 'v1')
    const url = 'file://' + quelle

    console.log('Neuinstallation: flacher Fetch')
    const neu = path.join(tmp, 'neu')
    fs.mkdirSync(neu)
    git(neu, 'init', '-q'); git(neu, 'remote', 'add', 'origin', url)
    git(neu, 'fetch', ...FETCH_FLACH, 'origin', 'master')
    pruefe('nur ein Commit geholt', zahl(neu) === 1, String(zahl(neu)))
    pruefe('Altstand nicht geholt', !gibtEs(neu, altBlob))
    pruefe('keine Tags', git(neu, 'tag') === '')

    console.log('Alter voller Klon: Update')
    const kunde = path.join(tmp, 'kunde')
    git(tmp, 'clone', '-q', url, kunde)
    pruefe('Ausgangslage: voller Klon hat den Altstand', gibtEs(kunde, altBlob) && zahl(kunde) === 3)
    fs.writeFileSync(path.join(quelle, 'a.txt'), '3\n')
    git(quelle, 'add', '.'); git(quelle, 'commit', '-q', '-m', 'vier')
    const vorher = git(kunde, 'rev-parse', 'HEAD')
    git(kunde, 'fetch', ...FETCH_FLACH, url, 'master')
    git(kunde, 'reset', '-q', '--hard', 'FETCH_HEAD')
    pruefe('flacher Fetch allein lässt den Altstand stehen', gibtEs(kunde, altBlob))
    const f1 = macheFlach(kunde, { rollback: vorher })
    pruefe('danach nur HEAD + Rollback-Commit', f1.commits === 2, String(f1.commits))
    pruefe('Altstand entfernt', !gibtEs(kunde, altBlob))
    pruefe('alte Wurzel entfernt', !gibtEs(kunde, altWurzel))
    pruefe('origin/* und Tags entfernt', f1.geloescht.includes('refs/remotes/origin/master') && f1.geloescht.includes('refs/tags/v1'))
    pruefe('Repo ist flach', git(kunde, 'rev-parse', '--is-shallow-repository') === 'true')
    pruefe('Rollback-Referenz zeigt auf den Stand davor', git(kunde, 'rev-parse', ROLLBACK_REF) === vorher)
    git(kunde, 'checkout', vorher, '--', '.')
    pruefe('Rollback stellt den alten Stand her', fs.readFileSync(path.join(kunde, 'a.txt'), 'utf8') === '2\n')
    git(kunde, 'reset', '-q', '--hard', 'HEAD')
    pruefe('Arbeitsstand unverändert', fs.readFileSync(path.join(kunde, 'a.txt'), 'utf8') === '3\n')
    { let f = ''; try { git(kunde, 'fsck', '--no-progress') } catch (e) { f = String(e.stderr || e.message) } pruefe('git fsck sauber', !f, f) }

    console.log('Neue Wurzel in der Quelle (Orphan mit gleichem Baum)')
    const baum = git(quelle, 'rev-parse', 'master^{tree}')
    const wurzelNeu = git(quelle, 'commit-tree', baum, '-m', 'neue Wurzel')
    git(quelle, 'update-ref', 'refs/heads/master', wurzelNeu)
    git(quelle, 'tag', '-d', 'v1')
    const vorher2 = git(kunde, 'rev-parse', 'HEAD')
    git(kunde, 'fetch', ...FETCH_FLACH, url, 'master')
    git(kunde, 'reset', '-q', '--hard', 'FETCH_HEAD')
    const f2 = macheFlach(kunde, { rollback: vorher2 })
    pruefe('HEAD ist die neue Wurzel', git(kunde, 'rev-parse', 'HEAD') === wurzelNeu)
    pruefe('neue Wurzel + Rollback', f2.commits === 2, String(f2.commits))
    const f3 = macheFlach(kunde, { rollback: null })
    pruefe('ohne Rollback: genau ein Commit', f3.commits === 1, String(f3.commits))
    pruefe('Rollback-Referenz weg', !(() => { try { git(kunde, 'rev-parse', '-q', '--verify', ROLLBACK_REF); return true } catch { return false } })())
    pruefe('Baum unverändert', git(kunde, 'rev-parse', 'HEAD^{tree}') === baum)

    console.log('Shell: paketquelle_flach')
    const sh = path.join(tmp, 'sh')
    git(tmp, 'clone', '-q', 'file://' + kunde, sh) // irgendein Klon mit Remote-Zweigen
    git(sh, 'branch', 'nebenbei')
    execFileSync('bash', ['-c', `. "${path.join(wurzel, 'scripts/paketquelle.sh')}" && paketquelle_flach`], { cwd: sh, env, stdio: ['ignore', 'pipe', 'pipe'] })
    pruefe('Shell: ein Commit, eine Referenz', zahl(sh) === 1 && git(sh, 'for-each-ref', '--format=%(refname)') === 'refs/heads/master',
        git(sh, 'for-each-ref', '--format=%(refname)'))
} finally {
    fs.rmSync(tmp, { recursive: true, force: true })
}

console.log('Liefer-Skripte holen nur flach')
const dateien = ['server/update-api.js', 'install.sh', 'install-mac.command', 'install.bat', 'update.sh',
    'update-mac.command', 'update.bat', 'setup-remote.sh', 'scripts/paketquelle.sh', 'README.md']
for (const datei of dateien) {
    const zeilen = fs.readFileSync(path.join(wurzel, datei), 'utf8').split(/\r?\n/)
    zeilen.forEach((z, i) => {
        if (/^\s*(#|::|REM|\*|\/\/)/.test(z) || /echo|step:/.test(z)) return
        if (!/\bgit (fetch|clone|pull)\b/.test(z)) return
        pruefe(`${datei}:${i + 1} flach`, /--depth 1|FETCH_FLACH/.test(z), z.trim())
    })
}
const api = fs.readFileSync(path.join(wurzel, 'server/update-api.js'), 'utf8')
pruefe('update-api ruft macheFlach mit dem Rollback-Punkt', /macheFlach\(PROJECT_ROOT, \{ rollback: preUpdateCommit \}\)/.test(api))
for (const datei of ['update.sh', 'update-mac.command']) {
    pruefe(`${datei} macht flach`, /^\s*paketquelle_flach\b/m.test(fs.readFileSync(path.join(wurzel, datei), 'utf8')))
}
pruefe('update.bat macht flach', /call scripts\\paketquelle-flach\.bat/.test(fs.readFileSync(path.join(wurzel, 'update.bat'), 'utf8')))

console.log(`\n${bestanden} bestanden, ${fehler} fehlgeschlagen`)
if (fehler) process.exit(1)
