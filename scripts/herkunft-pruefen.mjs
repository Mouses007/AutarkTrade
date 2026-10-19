/**
 * Herkunftsprüfung: wie viel Code steht noch wörtlich im Ursprungsprojekt?
 *
 *   node scripts/herkunft-pruefen.mjs                 # klont den Vergleichsstand frisch
 *   node scripts/herkunft-pruefen.mjs --vergleich DIR # nimmt einen vorhandenen Klon
 *   node scripts/herkunft-pruefen.mjs --treffer       # listet jede Trefferzeile
 *   node scripts/herkunft-pruefen.mjs --json DATEI    # schreibt das Ergebnis als JSON
 *
 * Methode (seit der Bestandsaufnahme vom 19.10.2026 unverändert, damit die Zahlen
 * vergleichbar bleiben): Eine Zeile zählt, wenn sie ohne Einrückung und ohne
 * Leerraum am Ende mindestens 20 Zeichen lang ist. Sie gilt als übernommen, wenn
 * genau diese Zeichenfolge als Zeile irgendwo im Vergleichsstand vorkommt.
 * Verglichen werden Dateien mit den Endungen in ENDUNGEN, auf unserer Seite nur
 * versionierte (`git ls-files`).
 *
 * Das Mass ist bewusst grob: es findet wörtliche Übernahmen, keine
 * umformulierten. Gegen Umformulieren schützt die Clean-Room-Regel
 * (docs/spec/), nicht dieses Skript. Was es übrig lässt, muss ein Mensch sichten
 * — generische Einzeiler (CSS-Eigenschaft, Import einer Bibliothek, Standard-
 * Idiom) sind kein schützbarer Ausdruck, alles andere wird neu geschrieben.
 * Das Ergebnis der Sichtung steht in HERKUNFT.md; die dort begründeten Arten
 * generischer Zeilen stehen unten in AKZEPTIERT. Jeder Treffer, der in keine
 * Art passt, wird einzeln ausgegeben und lässt das Skript mit Code 1 enden —
 * so fällt eine neu hereinkopierte Zeile beim nächsten Lauf auf.
 *
 * Die Adresse des Vergleichsstands steht nur in HERKUNFT.md (Zeile
 * „Vergleichsquelle:") und wird von dort gelesen.
 *
 * Braucht Netz (git clone) nur ohne --vergleich; deshalb kein Selbsttest.
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ENDUNGEN = new Set(['.js', '.mjs', '.vue', '.css', '.html'])
const MIN_LAENGE = 20

const wurzel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const QUELLE = readFileSync(path.join(wurzel, 'HERKUNFT.md'), 'utf8').match(/^Vergleichsquelle: <?(https:\/\/\S+?)>?$/m)?.[1]
if (!QUELLE) { console.error('HERKUNFT.md: Zeile „Vergleichsquelle: <url>" fehlt'); process.exit(2) }

/** Arten generischer Zeilen, gesichtet und begründet in HERKUNFT.md. */
const AKZEPTIERT = [
    ['CSS-Eigenschaft', /^-?[a-z-]+: [^;{}]+;$|^@media \(min-width: \d+px\) \{$/],
    ['Import', /^import .+ from .+$/],
    ['Gerüst von Vue, Router, Vite', /^(const props = defineProps\(\{|onMounted\(async \(\) => \{|onBeforeMount\(async \(\) => \{|const route = useRoute\(\)|const app = createApp\(App\)|const router = createRouter\(\{|export default router|export default defineConfig\(\{|\/\/ https:\/\/vitejs\.dev\/config\/|'@': fileURLToPath\(new URL\('\.\/src', import\.meta\.url\)\)|<meta charset="utf-8">|<meta name="viewport" content="width=device-width, initial-scale=1">|<div id="app"><\/div>|<script type="module" src="\/src\/main\.js"><\/script>)$/],
    ['JavaScript-Standardform', /^(return new Promise\(\(resolve, reject\) => \{|for \(const line of lines\) \{|if \(error\.response\) \{|\} else if \(error\.request\) \{|dayjs\.extend\(timezone\)|setupApiRoutes\(app\);|if \(currentUser\.value\) \{|expandedId\.value = null)$/],
    ['Optionen von ECharts und Quill', /^(splitLine|axisTick|axisLine): \{ show: false \},$|^type: 'candlestick',$|^radius: \['70%', '100%'\],$|^avoidLabelOverlap: false,$|^\[\{ header: \[1, 2, 3, false\] \}\],$/],
    ['Datenbegriff', /^export const (trades|totals|screenshots|pAndL|notes|layoutStyle|imports|groups|executions|excursions|blotter|apis) = (ref|reactive)\((\[\]|\{\})\)$|^(screenshots|excursions|tradeTags)\.length = 0$|^excursion\.(stopLoss|maePrice|mfePrice) = null$/],
]
const artVon = (z) => AKZEPTIERT.find(([, re]) => re.test(z))?.[0] || null
const args = process.argv.slice(2)
const wert = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }

function zeilen(text) {
    const aus = []
    for (const roh of text.split(/\r?\n/)) {
        const z = roh.trim()
        if (z.length >= MIN_LAENGE) aus.push(z)
    }
    return aus
}

function dateienIn(verz) {
    const aus = []
    const gehe = (d) => {
        for (const name of readdirSync(d)) {
            if (name === '.git' || name === 'node_modules') continue
            const p = path.join(d, name)
            const s = statSync(p)
            if (s.isDirectory()) gehe(p)
            else if (ENDUNGEN.has(path.extname(name))) aus.push(p)
        }
    }
    gehe(verz)
    return aus
}

let vergleich = wert('--vergleich')
let aufraeumen = null
let stand = null
if (!vergleich) {
    aufraeumen = mkdtempSync(path.join(tmpdir(), 'herkunft-'))
    vergleich = path.join(aufraeumen, 'vergleich')
    execFileSync('git', ['clone', '--quiet', '--depth', '1', QUELLE, vergleich], { stdio: 'inherit' })
}
try {
    stand = execFileSync('git', ['-C', vergleich, 'log', '-1', '--format=%h %cs'], { encoding: 'utf8' }).trim()
} catch { stand = 'unbekannt' }

const fremd = new Set()
for (const d of dateienIn(vergleich)) for (const z of zeilen(readFileSync(d, 'utf8'))) fremd.add(z)

const eigene = execFileSync('git', ['-C', wurzel, 'ls-files'], { encoding: 'utf8' })
    .split('\n').filter(f => f && ENDUNGEN.has(path.extname(f)))

let gesamt = 0
let gleich = 0
const jeDatei = []
const treffer = []
for (const f of eigene) {
    let text
    try { text = readFileSync(path.join(wurzel, f), 'utf8') } catch { continue }
    let n = 0, k = 0
    text.split(/\r?\n/).forEach((roh, i) => {
        const z = roh.trim()
        if (z.length < MIN_LAENGE) return
        n++
        if (fremd.has(z)) { k++; treffer.push({ datei: f, zeile: i + 1, text: z, art: artVon(z) }) }
    })
    gesamt += n
    gleich += k
    if (k) jeDatei.push({ datei: f, treffer: k, zeilen: n })
}
jeDatei.sort((a, b) => b.treffer - a.treffer)

const anteil = gesamt ? (100 * gleich / gesamt) : 0
console.log(`Vergleichsstand: ${QUELLE} @ ${stand}`)
console.log(`Zeilen (≥ ${MIN_LAENGE} Zeichen, ohne Einrückung): ${gesamt}`)
console.log(`davon wörtlich im Vergleichsstand: ${gleich} (${anteil.toFixed(2)} %), in ${jeDatei.length} Dateien`)
for (const d of jeDatei) console.log(`  ${String(d.treffer).padStart(4)} / ${String(d.zeilen).padStart(5)}  ${d.datei}`)
const jeArt = {}
for (const t of treffer) jeArt[t.art || 'NICHT GESICHTET'] = (jeArt[t.art || 'NICHT GESICHTET'] || 0) + 1
console.log('\nnach Art:')
for (const [art, n] of Object.entries(jeArt).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${art}`)
const offen = treffer.filter(t => !t.art)
if (args.includes('--treffer') || offen.length) {
    console.log(args.includes('--treffer') ? '\nTrefferzeilen:' : '\nNicht gesichtete Trefferzeilen:')
    for (const t of (args.includes('--treffer') ? treffer : offen)) console.log(`${t.datei}:${t.zeile}\t${t.art || '—'}\t${t.text}`)
}
const json = wert('--json')
if (json) writeFileSync(json, JSON.stringify({ quelle: QUELLE, stand, gesamt, gleich, anteil, jeArt, jeDatei, treffer }, null, 2))
if (aufraeumen) rmSync(aufraeumen, { recursive: true, force: true })
process.exitCode = offen.length ? 1 : 0
