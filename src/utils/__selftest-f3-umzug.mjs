/**
 * Selbsttest: alte Adressen und alte Speicherschlüssel nach F3 (20.10.2026).
 *
 *   node src/utils/__selftest-f3-umzug.mjs
 *
 * F3 hat die Routen und die localStorage-Schlüssel des Journals umbenannt.
 * Lesezeichen, Links in alten Nachrichten und gespeicherte Filter müssen
 * weiter funktionieren: jede alte Adresse leitet samt Abfrage weiter, und die
 * alten Schlüssel werden einmal übernommen, ohne einen neueren zu überschreiben.
 */
import { readFileSync } from 'node:fs'
import { SPEICHER_UMZUG, zieheSpeicherUm, raeumeSpeicherAuf } from './speicherUmzug.js'

let bestanden = 0
let fehlgeschlagen = 0
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

class Speicher {
    constructor(werte = {}) { this.m = new Map(Object.entries(werte)) }
    getItem(k) { return this.m.has(k) ? this.m.get(k) : null }
    setItem(k, v) { this.m.set(k, String(v)) }
    removeItem(k) { this.m.delete(k) }
}

console.log('\nSpeicherschlüssel\n')
{
    const s = new Speicher({ selectedBroker: 'bitget', selectedAccounts: 'bitunix,bitget', 'at.journal.konten': 'pionex', fremd: 'x' })
    const n = zieheSpeicherUm(s)
    check('alter Wert wandert unter den neuen Schlüssel', s.getItem('at.journal.boerse') === 'bitget')
    check('vorhandener neuer Wert gewinnt', s.getItem('at.journal.konten') === 'pionex')
    check('alte Schlüssel sind weg', s.getItem('selectedBroker') === null && s.getItem('selectedAccounts') === null)
    check('fremde Schlüssel bleiben', s.getItem('fremd') === 'x')
    check('zwei übernommen', n === 2, String(n))
    check('zweiter Lauf ändert nichts', zieheSpeicherUm(s) === 0)
    check('alle neuen Schlüssel im eigenen Namensraum', Object.values(SPEICHER_UMZUG).every(k => k.startsWith('at.journal.')))
}
{
    // Gemeldete Trades stehen seit 29.10.2026 in der DB: die alte Liste geht einmal.
    const s = new Speicher({ evalNotifiedPositionIds: '["open_1"]', fremd: 'x' })
    check('alte Popup-Liste wird entfernt', raeumeSpeicherAuf(s) === 1 && s.getItem('evalNotifiedPositionIds') === null)
    check('Aufräumen lässt Fremdes stehen, zweiter Lauf ändert nichts', s.getItem('fremd') === 'x' && raeumeSpeicherAuf(s) === 0)
}

console.log('\nAlte Adressen\n')
{
    // routen.js importiert Vue-Ansichten; hier genügt der Text der Tabelle.
    const routen = readFileSync(new URL('../router/routen.js', import.meta.url), 'utf8')
    const ALT = {
        '/dashboard': '/journal', '/calendar': '/kalender', '/daily': '/tagesansicht', '/screenshots': '/bilder',
        '/playbook': '/bewertungen', '/addTrades': '/import', '/addExcursions': '/exkursionen', '/diary': '/incoming',
        '/addDiary': '/incoming', '/addPlaybook': '/tagesansicht', '/addScreenshot': '/bilder', '/imports': '/einstellungen/journal',
    }
    for (const [alt, neu] of Object.entries(ALT)) {
        check(`${alt} → ${neu}`, routen.includes(`weiter('${alt}', '${neu}')`))
        check(`${neu.split('/')[1]} ist eine Seite`, new RegExp(`seite\\('/${neu.split('/')[1]}`).test(routen))
    }
    check('/settings/:bereich leitet mit Bereich weiter', /path: '\/settings\/:bereich\?', redirect: \(to\) => \(\{ path: '\/einstellungen'/.test(routen))
    check('Weiterleitung nimmt Abfrage und Anker mit', /function weiter\(von, nach\) \{\s*return \{ path: von, redirect: \(to\) => \(\{ path: nach, query: to\.query, hash: to\.hash \}\) \}/.test(routen))
}

console.log(`\nf3-umzug: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
process.exitCode = fehlgeschlagen ? 1 : 0
