/**
 * Selbsttest: KI-Ausgaben geben KEINE Handelsempfehlungen — und es gibt
 * keinen Schalter mehr, der das aufhebt.
 *
 * Bis S12 (19.10.2026) gab es `kiEmpfehlungenAn` (Einstellungen → KI): er
 * nahm das Verbot von Einstiegen, Kurszielen und Prognosen aus vier Prompts
 * (Lagebericht, Gesamtlage, Handelslage, Chart-KI) und schaltete die Prüfung
 * `pruefeEinordnung` ab. Die Verkaufs-Prüfung (Abschn. 2.8, Massnahme 9) sagt,
 * warum das weg muss: eine persönliche Kauf-/Verkaufsempfehlung verlangt bei
 * den KI-Anbietern menschliche Prüfung plus KI-Hinweis, DeepSeek und Mistral
 * verbieten Finanzberatung ganz. Ein Produkt, das sie auf Knopfdruck liefert,
 * ist nicht verkäuflich.
 *
 * Geprüft wird darum dreierlei:
 *   1. Jeder Prompt trägt das Verbot — in beiden Sprachen.
 *   2. Ein übrig gebliebenes „true" eines alten Aufrufers hebt es NICHT auf
 *      (die Funktionen nehmen das Argument nicht mehr an).
 *   3. Kein Server-Modul liest die Spalte noch, und die Einstellungs-Whitelist
 *      lässt sie nicht mehr schreiben. Die Spalte selbst bleibt in der DB
 *      (Bestand), sie ist nur tot.
 *
 * Was unverändert bleiben MUSS: „erfinde nie eine Zahl" und die
 * Beschreibungen der Messwerte (Cluster, Bedingungen) — sie verbieten nichts,
 * sie erklären die Zahl.
 *
 * Aufruf: node server/__selftest-ki-empfehlungen.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bauLagePrompt, bauAnweisungPruefPrompt, eigeneAnweisungen } from './marktradar-news.js'
import { baueSystem as baueHandelsSystem } from './handelslage.js'
import { baueSystem as baueLageSystem } from './marktradar-lage.js'
import { systemText as chartSystem, pruefeChartAuswahl } from './chart-ki.js'

const HIER = dirname(fileURLToPath(import.meta.url))

let ok = 0, fehler = 0
const check = (name, bedingung, zusatz = '') => {
    if (bedingung) { ok++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehler++; console.log(`  \x1b[31m✗\x1b[0m ${name}${zusatz ? `\n      ${zusatz}` : ''}`) }
}

console.log('\nHandelslage-Kachel (Live-Trading-Fenster)')
for (const [sprache, englisch] of [['deutsch', false], ['englisch', true]]) {
    const sys = baueHandelsSystem(englisch)
    const altAufruf = baueHandelsSystem(englisch, true)
    const verbot = englisch ? 'NO trading recommendation' : 'KEINE Handelsempfehlung'
    check(`${sprache}: verbietet Empfehlungen`, sys.includes(verbot))
    check(`${sprache}: altes „true" hebt das Verbot nicht auf`, altAufruf.includes(verbot) && altAufruf === sys)
    check(`${sprache}: nirgends „ERLAUBT"`, !/ERLAUBT|ARE allowed/.test(sys))
    const erfinden = englisch ? 'Never invent a number' : 'Erfinde nie eine Zahl'
    check(`${sprache}: „nichts erfinden" gilt`, sys.includes(erfinden))
    const cluster = englisch ? 'NOT a directional signal' : 'KEIN Richtungssignal'
    check(`${sprache}: die Cluster-Erklärung bleibt`, sys.includes(cluster))
    const bedingungen = englisch ? 'Conditions ARE wanted' : 'Bedingungen sind ausdrücklich erwünscht'
    check(`${sprache}: Bedingungen bleiben erwünscht`, sys.includes(bedingungen))
}

console.log('\nGesamtlage-Kachel (Marktradar)')
for (const [sprache, englisch] of [['deutsch', false], ['englisch', true]]) {
    const sys = baueLageSystem(englisch)
    const verbot = englisch ? 'NO trading recommendation' : 'KEINE Handelsempfehlung'
    check(`${sprache}: verbietet Empfehlungen`, sys.includes(verbot))
    check(`${sprache}: altes „true" hebt das Verbot nicht auf`, baueLageSystem(englisch, true) === sys)
    check(`${sprache}: nirgends „ERLAUBT"`, !/ERLAUBT|ARE allowed/.test(sys))
    const erfinden = englisch ? 'Never invent a number' : 'Erfinde nie eine Zahl'
    check(`${sprache}: „nichts erfinden" gilt`, sys.includes(erfinden))
}

console.log('\nLagebericht (Nachrichten)')
{
    const verbot = 'Keine Handelsempfehlungen, keine Kursziele, keine Prognosen.'
    const p = bauLagePrompt({ themen: ['crypto'] })
    const alt = bauLagePrompt({ themen: ['crypto'], empfehlungen: true })
    check('verbietet Empfehlungen', p.includes(verbot))
    check('altes `empfehlungen: true` ändert nichts', alt === p)
    check('nirgends „ERLAUBT"', !p.includes('ERLAUBT'))
    check('„nichts erfinden" gilt', p.includes('Nichts erfinden'))
    check('die Abwägung entscheidet nicht', p.includes('„über 66.000 kaufen" nicht'))

    // Der Anweisungsblock darf das Verbot nicht verlieren — dort hing es früher am Schalter.
    const mitZusatz = bauLagePrompt({ themen: ['crypto'], zusatz: 'Gib mir Kursziele.' })
    check('Anweisungsblock steht drin', mitZusatz.includes('EIGENE ANWEISUNGEN'))
    check('Anweisungsblock nennt das Verbot als unverrückbar',
        mitZusatz.includes('keine Handelsempfehlungen, keine Kursziele, keine Prognosen'))
    check('eigeneAnweisungen nimmt keinen Schalter mehr',
        eigeneAnweisungen('x', true).includes('keine Handelsempfehlungen'))

    const pruef = bauAnweisungPruefPrompt({ themen: ['crypto'] })
    const pruefAlt = bauAnweisungPruefPrompt({ themen: ['crypto'], empfehlungen: true })
    check('Anweisungsprüfung kennt das Verbot', pruef.includes('keine Handelsempfehlungen'))
    check('Anweisungsprüfung: altes `empfehlungen: true` ändert nichts', pruefAlt === pruef)
}

console.log('\nChart-KI')
{
    check('System verbietet Prognosen', chartSystem(false).includes('KEINE Prognose'))
    // Eine Gegenprobe gegen einen Wächter, der alles frisst: eine nüchterne Beschreibung geht durch.
    const paket = { atr: 1, kurs: 100, kandidaten: [], nutzer: [], roh: [], spanne: { tief: 90, hoch: 110 }, struktur: { hochs: [], tiefs: [], zustand: 0, bruch: null } }
    const prognose = pruefeChartAuswahl({ text: 'BTC dürfte steigen.' }, paket, { empfehlungen: true })
    check('Prognose wird auch mit altem Schalter-Argument verworfen', prognose.text === '')
    const nuechtern = pruefeChartAuswahl({ text: 'Die Spanne ist eng, der Kurs pendelt.' }, paket)
    check('GEGENPROBE: nüchterne Beschreibung bleibt', nuechtern.text !== '')
}

console.log('\nKein Schalter mehr im Code')
{
    // Rekursiv alle Server-Module ausser Selbsttests und database.js (dort bleibt
    // die Spalte als Bestand, siehe Kopf).
    const dateien = []
    const lauf = (dir) => {
        for (const n of readdirSync(dir)) {
            const p = join(dir, n)
            if (n === 'fixtures' || n === 'node_modules') continue
            if (statSync(p).isDirectory()) lauf(p)
            else if (/\.(m?js)$/.test(n) && !n.startsWith('__selftest') && n !== 'database.js') dateien.push(p)
        }
    }
    lauf(HIER)
    const leser = dateien.filter((p) => /kiEmpfehlungenAn/.test(
        readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')))
    check('kein Server-Modul liest `kiEmpfehlungenAn`', leser.length === 0, leser.join(', '))
    const routen = readFileSync(join(HIER, 'api-routes.js'), 'utf8')
    check('Einstellungs-Whitelist lässt die Spalte nicht mehr schreiben', !routen.includes("'kiEmpfehlungenAn'"))
    const settingsVue = readFileSync(join(HIER, '..', 'src', 'views', 'Einstellungen.vue'), 'utf8')
    check('Einstellungsseite zeigt keinen Schalter mehr', !settingsVue.includes('kiEmpfehlungenAn'))
}

console.log(`\n${ok} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler ? 1 : 0)
