/**
 * Selbsttest: Zerlegung der Herkunftsprüfung (`scripts/herkunft-tokens.mjs`).
 *
 *   node server/__selftest-herkunft-tokens.mjs
 *
 * Warum (Audit 4.3.4, FUN-F6-001): Die Token-Fenster-Prüfung beendete eine
 * Vorlagen-Zeichenkette am ersten Backtick — auch an einem in `${…}`. Die
 * verschachtelte Vorlage in server/database.js (Zeile 338 zum Zeitpunkt des
 * Audits) kehrte damit die Parität um, und rund 91 % der Datei waren für die
 * Prüfung unsichtbar: eine umbenannte, strukturgleiche Kopie dort blieb unentdeckt.
 * Dasselbe passierte mit Regex-Literalen, die einen Backtick oder ein
 * Anführungszeichen enthalten. Kein Netz, kein Vergleichsstand.
 *
 * Dazu der Abgleich in Gegenrichtung (FUN-F6-002): gesichtete Ausnahmen ohne
 * Treffer werden als veraltet erkannt, und die echte Liste
 * `scripts/herkunft-akzeptiert.json` trägt keine Läufe gelöschter Dateien.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
const { zerlege, tokens, laeufe, normal, KONTROLLE, veralteteAusnahmen } = await import('../scripts/herkunft-tokens.mjs')

let bestanden = 0
let fehler = 0
function pruefe(name, bedingung, zusatz = '') {
    if (bedingung) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}

// Zeile 338 von server/database.js (Stand f6e23fb), wörtlich.
const ZEILE_338 = '            await knex.raw(`CREATE INDEX IF NOT EXISTS ${name} ON ${isPg ? `"${table}"` : `\\`${table}\\``} (${isPg ? `"${column}"` : `\\`${column}\\``})`)'

// „Fremder" Code und eine umbenannte Kopie mit gleicher Struktur (wie im Audit-Beleg)
const FREMD = `
async function sammleTrades(liste, konto) {
    let summe = 0
    for (const eintrag of liste) {
        if (eintrag.konto !== konto) continue
        if (eintrag.menge > 0) { summe += eintrag.menge * eintrag.preis } else { summe -= eintrag.gebuehr }
        try { await speichere(eintrag) } catch (fehler) { console.log('x', fehler); return null }
    }
    return summe
}`
const KOPIE = `
async function addiereAlles(posten, depot) {
    let total = 0
    for (const p of posten) {
        if (p.depot !== depot) continue
        if (p.anzahl > 0) { total += p.anzahl * p.kurs } else { total -= p.kosten }
        try { await ablegen(p) } catch (err) { console.log("y", err); return null }
    }
    return total
}`

const FENSTER = 12
const index = new Map()
const tf = tokens(FREMD).map(normal)
for (let i = 0; i + FENSTER <= tf.length; i++) index.set(tf.slice(i, i + FENSTER).join(' '), 'fremd.js')
/** Grösster normalisierter Lauf, der die Schwellen der Prüfung erfüllt (≥ 30 Tokens, ≥ 2 Kontrollwörter). */
function treffer(text) {
    const tk = tokens(text)
    return laeufe(tk, index, FENSTER, normal)
        .map(l => tk.slice(l.von, l.bis))
        .filter(t => t.length >= 30 && t.filter(x => KONTROLLE.has(x)).length >= 2)
        .length
}

console.log('Verschachtelte Vorlage (database.js Zeile 338)')
{
    const z = zerlege(ZEILE_338)
    pruefe('Zeile 338 schliesst ihre Vorlage', !z.offen)
    pruefe('… und ist ein einziges S', JSON.stringify(z.tokens) === JSON.stringify(['await', 'knex', '.', 'raw', '(', 'S', ')']), z.tokens.join(' '))
    const datei = `function vorher() {\n${ZEILE_338}\n}\n${KOPIE}\n`
    pruefe('Code nach Zeile 338 bleibt sichtbar', tokens(datei).includes('addiereAlles'))
    pruefe('umbenannte Kopie nach Zeile 338 wird gefunden', treffer(datei) === 1)
    pruefe('Gegenprobe: Kopie allein wird gefunden', treffer(KOPIE) === 1)
    pruefe('zwei verschachtelte Vorlagen hintereinander', !zerlege(`${ZEILE_338}\n${ZEILE_338}\nconst x = 1`).offen
        && tokens(`${ZEILE_338}\n${ZEILE_338}\nconst x = 1`).slice(-4).join(' ') === 'const x = N')
    pruefe('Klammern und Zeichenketten in ${…}', tokens('const a = `x ${f({ b: "}" })} y`; let c').join(' ') === 'const a = S ; let c')
}

console.log('Regex-Literale')
{
    const mitBacktick = `pruefe(!/[#>\`*]/.test(aus), 'x')\n${KOPIE}\n`
    pruefe('Backtick im Regex öffnet keine Vorlage', !zerlege(mitBacktick).offen && treffer(mitBacktick) === 1)
    const inVorlage = 'const text = (v) => `"${v.replace(/"/g, \'""\')}"`\nconst weiter = 1'
    pruefe('Regex mit Anführungszeichen in ${…}', !zerlege(inVorlage).offen && tokens(inVorlage).slice(-4).join(' ') === 'const weiter = N', tokens(inVorlage).join(' '))
    const klasse = 'const r = /[/`]+/g; const s = 2'
    pruefe('Schrägstrich in Zeichenklasse', tokens(klasse).join(' ') === 'const r = S ; const s = N', tokens(klasse).join(' '))
    pruefe('Division bleibt Division', tokens('const q = a / b / c').join(' ') === 'const q = a / b / c')
    pruefe('Division nach Klammer', tokens('x = (a + b) / 2 / n').filter(t => t === '/').length === 2)
    pruefe('HTML-Endtag ist kein Regex', tokens('<div class="a"></div><span></span>').filter(t => t === '/').length === 2)
    pruefe('selbstschliessendes Tag ist kein Regex', tokens('<Symbol name="x" /><br/>').filter(t => t === '/').length === 2)
    pruefe('Regex nach return', tokens('return /a"b/.test(x)').join(' ') === 'return S . test ( x )')
}

console.log('Unverändert gegenüber vorher')
pruefe('einfache Vorlage = S', tokens('const a = `x ${b} y`').join(' ') === 'const a = S')
pruefe('Zeichenketten = S, Zahlen = N', tokens(`f('a', "b", 12.5)`).join(' ') === 'f ( S , S , N )')
pruefe('Kommentare fallen weg', tokens('a // b\n/* c */ d <!-- e --> f').join(' ') === 'a d f')
pruefe('URL ist kein Kommentar', tokens('x = "http://a"').join(' ') === 'x = S')

console.log('Blinde Stellen werden gemeldet')
pruefe('offene Vorlage am Dateiende', zerlege('const a = `nie zu\nconst b = 1').offen === true)
pruefe('Anteil der Zeilen in Zeichenketten', zerlege('const t = `\n1\n2\n3\n`\nx').zeichenketteAnteil > 0.5)
pruefe('normaler Code: kein Anteil', zerlege('const a = 1\nconst b = 2').zeichenketteAnteil === 0)

console.log('Veraltete Ausnahmen (FUN-F6-002)')
{
    const gesichtet = {
        textZeilen: { 'END OF TERMS': 'Lizenz' },
        namen: { account: 'Allerweltswort', geloeschterName: 'Allerweltswort' },
        laeufe: { 'a.js|111': 'Gerüst', 'weg.mjs|222': 'Gerüst' },
    }
    const gefunden = { textZeilen: new Set(['END OF TERMS']), namen: new Set(['account']), laeufe: new Set(['a.js|111', 'neu.js|333']) }
    const v = veralteteAusnahmen(gesichtet, gefunden)
    pruefe('veraltete Namen und Läufe erkannt', JSON.stringify(v) === JSON.stringify([
        { art: 'namen', schluessel: 'geloeschterName' }, { art: 'laeufe', schluessel: 'weg.mjs|222' }]), JSON.stringify(v))
    pruefe('ohne Ausnahmen nichts veraltet', veralteteAusnahmen({}, gefunden).length === 0)
    // Die echte Liste: kein Lauf einer Datei, die es nicht mehr gibt (z. B. das
    // gelöschte scripts/lizenz-ausstellen.mjs stand bis zum Audit 4.3.4 noch darin).
    const wurzel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    const liste = JSON.parse(fs.readFileSync(path.join(wurzel, 'scripts/herkunft-akzeptiert.json'), 'utf8'))
    const fehlt = Object.keys(liste.laeufe || {}).map(k => k.split('|')[0]).filter(d => !fs.existsSync(path.join(wurzel, d)))
    pruefe('herkunft-akzeptiert.json: jede Datei der Läufe existiert', fehlt.length === 0, [...new Set(fehlt)].join(', '))
    const skript = fs.readFileSync(path.join(wurzel, 'scripts/herkunft-pruefen.mjs'), 'utf8')
    pruefe('Prüfskript meldet veraltete Ausnahmen', /veralteteAusnahmen\(GESICHTET/.test(skript))
    // Ohne Schalter: veraltete Ausnahmen zählen im Exit-Code (eine Warnung überliest man).
    pruefe('veraltete Ausnahmen zählen ab Werk im Exit-Code', /process\.exitCode = offen \|\| veraltet\.length \? 1 : 0/.test(skript) && !/--veraltet-fehler/.test(skript))
}

console.log(`\n${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler ? 1 : 0)
