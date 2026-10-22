/**
 * Herkunftsprüfung: was steht noch im Ursprungsprojekt?
 *
 *   node scripts/herkunft-pruefen.mjs                 # klont den Vergleichsstand frisch
 *   node scripts/herkunft-pruefen.mjs --vergleich DIR # nimmt einen vorhandenen Klon
 *   node scripts/herkunft-pruefen.mjs --treffer       # listet jede Trefferzeile
 *   node scripts/herkunft-pruefen.mjs --namen         # listet jeden gemeinsamen Namen
 *   node scripts/herkunft-pruefen.mjs --laeufe        # listet jeden Token-Lauf
 *   node scripts/herkunft-pruefen.mjs --vorschlag     # druckt Ungesichtetes als JSON-Gerüst
 *   node scripts/herkunft-pruefen.mjs --json DATEI    # schreibt das Ergebnis als JSON
 *
 * Vier Prüfungen (seit F3, 20.10.2026; davor nur die erste):
 *
 *  1. Zeilen im Code (js/mjs/vue/css/html). Eine Zeile zählt, wenn sie ohne
 *     Einrückung und Leerraum am Ende mindestens 20 Zeichen lang ist; sie gilt
 *     als übernommen, wenn genau diese Zeichenfolge als Zeile irgendwo im
 *     Vergleichsstand steht. Unsere Seite: nur versionierte Dateien.
 *  2. Zeilen der übrigen Textdateien (md, json, sh, bat, yml, txt, Dockerfile …)
 *     nach derselben Regel — README, Handbücher, i18n, Skripte.
 *  3. Namen. Jeder im Vergleichsstand deklarierte Name (function/const/let/var/
 *     class, ≥ 4 Zeichen) gegen jedes Wort unseres Codes. Ein Name ist kein
 *     schützbarer Ausdruck; in der Summe zeigen Namen aber, woher Code kommt.
 *  4. Token-Fenster: findet umformulierte Kopien, die Zeile für Zeile anders
 *     aussehen. Kommentare fallen weg, Zeichenketten und Zahlen werden zu
 *     Platzhaltern. Zwei Läufe: **streng** (Namen bleiben, Fenster 10; ein Lauf
 *     zählt ab 14 Tokens mit ≥ 6 eigenen Wörtern) und **normalisiert** (auch
 *     Namen werden Platzhalter, Fenster 12; ein Lauf zählt ab 30 Tokens mit
 *     ≥ 2 Kontrollfluss-Schlüsselwörtern und ohne HTML-/CSS-Rahmen).
 *
 * Verglichen wird gegen den Vergleichsstand OHNE dessen mitgelieferte
 * Fremdbibliothek `codemirror-graphql` — deren Zeilen sind nicht vom
 * Ursprungsprojekt (Audit A3-03).
 *
 * Was übrig bleibt, muss ein Mensch sichten. Prüfung 1 ordnet Treffer den in
 * HERKUNFT.md begründeten Arten in AKZEPTIERT zu; die Prüfungen 2–4 lesen ihre
 * gesichteten Treffer samt Begründung aus `scripts/herkunft-akzeptiert.json`.
 * Jeder ungesichtete Treffer wird ausgegeben und lässt das Skript mit Code 1
 * enden — so fällt eine neu hereinkopierte Zeile, ein übernommener Name oder
 * eine umformulierte Stelle beim nächsten Lauf auf.
 *
 * Die Adresse des Vergleichsstands steht nur in HERKUNFT.md (Zeile
 * „Vergleichsquelle:") und wird von dort gelesen.
 *
 * Braucht Netz (git clone) nur ohne --vergleich; deshalb kein Selbsttest.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CODE = new Set(['.js', '.mjs', '.vue', '.css', '.html'])
const TEXT = new Set(['.md', '.json', '.sh', '.bat', '.yml', '.yaml', '.txt', '.command', '.vbs', '.example'])
const TEXT_NAMEN = new Set(['Dockerfile', 'LICENSE', 'NOTICE', 'THIRD-PARTY-NOTICES', '.dockerignore', '.gitignore'])
const SKRIPT = new Set(['.js', '.mjs', '.vue'])
const MIN_LAENGE = 20
const FREMD_IM_VERGLEICH = ['codemirror-graphql']

const wurzel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const QUELLE = readFileSync(path.join(wurzel, 'HERKUNFT.md'), 'utf8').match(/^Vergleichsquelle: <?(https:\/\/\S+?)>?$/m)?.[1]
if (!QUELLE) { console.error('HERKUNFT.md: Zeile „Vergleichsquelle: <url>" fehlt'); process.exit(2) }
const GESICHTET = JSON.parse(readFileSync(path.join(wurzel, 'scripts', 'herkunft-akzeptiert.json'), 'utf8'))

/** Prüfung 1: Arten generischer Zeilen, gesichtet und begründet in HERKUNFT.md. */
const AKZEPTIERT = [
    ['CSS-Eigenschaft', /^-?[a-z-]+: [^;{}]+;$|^@media \(min-width: \d+px\) \{$/],
    ['Import', /^import .+ from .+$/],
    ['Gerüst von Vue, Router, Vite', /^(const props = defineProps\(\{|onMounted\(async \(\) => \{|onBeforeMount\(async \(\) => \{|const route = useRoute\(\)|const app = createApp\(App\)|const router = createRouter\(\{|export default router|export default defineConfig\(\{|\/\/ https:\/\/vitejs\.dev\/config\/|'@': fileURLToPath\(new URL\('\.\/src', import\.meta\.url\)\)|<meta charset="utf-8">|<meta name="viewport" content="width=device-width, initial-scale=1">|<div id="app"><\/div>|<script type="module" src="\/src\/main\.js"><\/script>)$/],
    ['JavaScript-Standardform', /^(return new Promise\(\(resolve, reject\) => \{|for \(const line of lines\) \{|if \(error\.response\) \{|\} else if \(error\.request\) \{|dayjs\.extend\(timezone\)|expandedId\.value = null)$/],
    ['Optionen von ECharts und Quill', /^(splitLine|axisTick|axisLine): \{ show: false \},$|^type: 'candlestick',$|^radius: \['70%', '100%'\],$|^avoidLabelOverlap: false,$|^\[\{ header: \[1, 2, 3, false\] \}\],$/],
    ['Datenbegriff', /^export const (trades|totals|screenshots|pAndL|notes|layoutStyle|imports|groups|executions|excursions|blotter|apis) = (ref|reactive)\((\[\]|\{\})\)$|^(screenshots|excursions)\.length = 0$|^excursion\.(stopLoss|maePrice|mfePrice) = null$/],
]
/** Prüfung 2: Arten generischer Zeilen in Textdateien. */
const AKZEPTIERT_TEXT = [
    ['npm-Skript bzw. Versionsangabe', /^"(start|build|dev|preview)": "[^"]+",?$|^"(@[\w.-]+\/)?[\w.-]+": "[\^~]?\d[\w.-]*",?$|^"(dev)?[dD]ependencies": \{$/],
    ['Lizenztext Dritter', /^(END OF TERMS AND CONDITIONS|TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION|Apache License|Version 2\.0, January 2004|http:\/\/www\.apache\.org\/licenses\/?|limitations under the License\.|Licensed under the Apache License, Version 2\.0 \(the "License"\);|you may not use this file except in compliance with the License\.|You may obtain a copy of the License at|Unless required by applicable law or agreed to in writing, software|distributed under the License is distributed on an "AS IS" BASIS,|WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied\.|See the License for the specific language governing permissions and)$/],
]

const artVon = (liste, z) => liste.find(([, re]) => re.test(z))?.[0] || null
const args = process.argv.slice(2)
const wert = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
const zeigt = (name) => args.includes(name)

function zeilen(text) {
    const aus = []
    for (const roh of text.split(/\r?\n/)) {
        const z = roh.trim()
        if (z.length >= MIN_LAENGE) aus.push(z)
    }
    return aus
}

const istText = (f) => TEXT.has(path.extname(f)) || TEXT_NAMEN.has(path.basename(f))

function dateienIn(verz) {
    const aus = []
    const gehe = (d, rel) => {
        for (const name of readdirSync(d)) {
            if (name === '.git' || name === 'node_modules') continue
            if (!rel && FREMD_IM_VERGLEICH.includes(name)) continue
            const p = path.join(d, name)
            const r = rel ? rel + '/' + name : name
            if (statSync(p).isDirectory()) gehe(p, r)
            else aus.push(r)
        }
    }
    gehe(verz, '')
    return aus
}

// ── Vergleichsstand holen ──────────────────────────────────────────────────
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

const fremdDateien = dateienIn(vergleich)
const lies = (basis, f) => { try { return readFileSync(path.join(basis, f), 'utf8') } catch { return null } }
const fremdCode = fremdDateien.filter(f => CODE.has(path.extname(f)))
const fremdText = fremdDateien.filter(istText)

const eigeneAlle = execFileSync('git', ['-C', wurzel, 'ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean)
// Diese Datei, ihre Liste und die Prüfberichte nennen fremde Namen absichtlich.
const SELBST = new Set(['scripts/herkunft-pruefen.mjs', 'scripts/herkunft-akzeptiert.json', 'HERKUNFT.md', 'package-lock.json'])
// `LICENSE` ist seit 22.10.2026 der unveränderte AGPL-3.0-Text der Free Software Foundation.
// Er teilt Hunderte Sätze mit dem GPL-Text im Vergleichsstand — beide stammen von der FSF,
// keiner ist Ausdruck von TradeNote. Prüfen hiesse, die Lizenz gegen sich selbst zu vergleichen.
SELBST.add('LICENSE')
const eigeneCode = eigeneAlle.filter(f => CODE.has(path.extname(f)) && !SELBST.has(f) && !f.startsWith('docs/audit/'))
const eigeneText = eigeneAlle.filter(f => istText(f) && !SELBST.has(f) && !f.startsWith('docs/audit/'))

// ── 1 und 2: Zeilen ────────────────────────────────────────────────────────
function zeilenVergleich(fremdListe, eigeneListe, arten, gesichtet) {
    const fremd = new Set()
    for (const d of fremdListe) for (const z of zeilen(lies(vergleich, d) || '')) fremd.add(z)
    let gesamt = 0, gleich = 0
    const jeDatei = [], treffer = []
    for (const f of eigeneListe) {
        const text = lies(wurzel, f)
        if (text == null) continue
        let n = 0, k = 0
        text.split(/\r?\n/).forEach((roh, i) => {
            const z = roh.trim()
            if (z.length < MIN_LAENGE) return
            n++
            if (fremd.has(z)) {
                k++
                treffer.push({ datei: f, zeile: i + 1, text: z, art: artVon(arten, z) || (gesichtet?.[z] ? 'gesichtet: ' + gesichtet[z] : null) })
            }
        })
        gesamt += n
        gleich += k
        if (k) jeDatei.push({ datei: f, treffer: k, zeilen: n })
    }
    jeDatei.sort((a, b) => b.treffer - a.treffer)
    return { gesamt, gleich, anteil: gesamt ? 100 * gleich / gesamt : 0, jeDatei, treffer }
}

const code = zeilenVergleich(fremdCode, eigeneCode, AKZEPTIERT, null)
const text = zeilenVergleich(fremdText, eigeneText, AKZEPTIERT_TEXT, GESICHTET.textZeilen)

// ── Tokens ─────────────────────────────────────────────────────────────────
const SCHLUESSELWORT = new Set(('await break case catch class const continue debugger default delete do else export extends false finally for from function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while with yield async').split(' '))
const KONTROLLE = new Set(['if', 'for', 'while', 'switch', 'case', 'return', 'else', 'try', 'catch', 'break', 'continue', 'throw'])

/** Zerlegt Quelltext in Tokens; Kommentare fallen weg, Literale werden S bzw. N. */
function tokens(quelle) {
    const aus = []
    const s = quelle
    let i = 0
    while (i < s.length) {
        const c = s[i]
        if (/\s/.test(c)) { i++; continue }
        if (s.startsWith('<!--', i)) { const e = s.indexOf('-->', i + 4); i = e < 0 ? s.length : e + 3; continue }
        if (s.startsWith('/*', i)) { const e = s.indexOf('*/', i + 2); i = e < 0 ? s.length : e + 2; continue }
        if (s.startsWith('//', i) && s[i - 1] !== ':') { const e = s.indexOf('\n', i); i = e < 0 ? s.length : e; continue }
        if (c === '"' || c === "'" || c === '`') {
            let j = i + 1
            while (j < s.length && s[j] !== c) { if (s[j] === '\\') j++; if (c !== '`' && s[j] === '\n') break; j++ }
            aus.push('S'); i = j + 1; continue
        }
        const m = /^[A-Za-z_$][\w$-]*/.exec(s.slice(i, i + 80))
        if (m) {
            // Bindestrich nur in Vorlagen-/CSS-Namen; in JS wäre es ein Minus.
            let w = m[0]
            if (w.includes('-') && !/^[a-z][\w-]*[a-z\d]$/.test(w)) w = w.split('-')[0]
            aus.push(w); i += w.length; continue
        }
        const z = /^\d[\d._a-zA-Z]*/.exec(s.slice(i, i + 40))
        if (z) { aus.push('N'); i += z[0].length; continue }
        const op = /^(===|!==|=>|\.\.\.|&&|\|\||\?\?|\?\.|==|!=|<=|>=|\+\+|--|\+=|-=)/.exec(s.slice(i, i + 3))
        if (op) { aus.push(op[0]); i += op[0].length; continue }
        aus.push(c); i++
    }
    return aus
}
const istName = (t) => /^[A-Za-z_$]/.test(t) && t !== 'S' && t !== 'N'
const normal = (t) => (istName(t) && !SCHLUESSELWORT.has(t) ? 'I' : t)

/** Gemeinsame Läufe von ≥ fenster Tokens zwischen unserer Datei und dem Vergleichsstand. */
function laeufe(eigen, fremdIndex, fenster, abbilden) {
    const reihe = eigen.map(abbilden)
    const gedeckt = new Uint8Array(reihe.length)
    const quelle = new Array(reihe.length)
    for (let i = 0; i + fenster <= reihe.length; i++) {
        const k = reihe.slice(i, i + fenster).join(' ')
        const wo = fremdIndex.get(k)
        if (wo) { for (let j = i; j < i + fenster; j++) gedeckt[j] = 1; quelle[i] = wo }
    }
    const aus = []
    let a = -1
    for (let i = 0; i <= reihe.length; i++) {
        if (i < reihe.length && gedeckt[i]) { if (a < 0) a = i; continue }
        if (a >= 0) { aus.push({ von: a, bis: i, wo: quelle[a] }); a = -1 }
    }
    return aus
}

function fremdIndexAus(abbilden, fenster) {
    const index = new Map()
    for (const f of fremdCode) {
        const tk = tokens(lies(vergleich, f) || '').map(abbilden)
        for (let i = 0; i + fenster <= tk.length; i++) {
            const k = tk.slice(i, i + fenster).join(' ')
            if (!index.has(k)) index.set(k, f)
        }
    }
    return index
}

const signatur = (teil) => createHash('sha1').update(teil.join(' ')).digest('hex').slice(0, 12)

const STRENG = { fenster: 10, minTokens: 14, minWoerter: 6 }
const NORMAL = { fenster: 12, minTokens: 30, minKontrolle: 2 }
const idxStreng = fremdIndexAus((t) => t, STRENG.fenster)
const idxNormal = fremdIndexAus(normal, NORMAL.fenster)

const laufTreffer = []
for (const f of eigeneCode.filter(f => SKRIPT.has(path.extname(f)))) {
    const tk = tokens(lies(wurzel, f) || '')
    for (const l of laeufe(tk, idxStreng, STRENG.fenster, (t) => t)) {
        const teil = tk.slice(l.von, l.bis)
        const woerter = new Set(teil.filter(t => istName(t) && !SCHLUESSELWORT.has(t)))
        if (teil.length < STRENG.minTokens || woerter.size < STRENG.minWoerter) continue
        laufTreffer.push({ art: 'streng', datei: f, tokens: teil.length, gegen: l.wo, sig: signatur(teil), text: teil.join(' ') })
    }
    for (const l of laeufe(tk, idxNormal, NORMAL.fenster, normal)) {
        const teil = tk.slice(l.von, l.bis)
        const kontrolle = teil.filter(t => KONTROLLE.has(t)).length
        const rahmen = teil.filter(t => t === '<' || t === '/' || t === ';').length / teil.length
        if (teil.length < NORMAL.minTokens || kontrolle < NORMAL.minKontrolle || rahmen > 0.15) continue
        laufTreffer.push({ art: 'normalisiert', datei: f, tokens: teil.length, gegen: l.wo, sig: signatur(teil.map(normal)), text: teil.join(' ') })
    }
}
for (const t of laufTreffer) t.grund = GESICHTET.laeufe?.[`${t.datei}|${t.sig}`] || null

// ── 3: Namen ───────────────────────────────────────────────────────────────
const fremdeNamen = new Map()
for (const f of fremdCode.filter(f => SKRIPT.has(path.extname(f)))) {
    const q = lies(vergleich, f) || ''
    for (const m of q.matchAll(/\b(?:function\s*\*?|const|let|var|class)\s+([A-Za-z_$][\w$]{3,})/g)) {
        if (!fremdeNamen.has(m[1])) fremdeNamen.set(m[1], f)
    }
    for (const m of q.matchAll(/\b(?:const|let|var)\s*\{([^}]+)\}/g)) {
        for (const n of m[1].split(',').map(x => x.split(':').pop().trim()).filter(x => /^[A-Za-z_$][\w$]{3,}$/.test(x))) {
            if (!fremdeNamen.has(n)) fremdeNamen.set(n, f)
        }
    }
}
const eigeneWoerter = new Map()
for (const f of eigeneCode) {
    for (const w of new Set((lies(wurzel, f) || '').match(/[A-Za-z_$][\w$]{3,}/g) || [])) {
        if (!eigeneWoerter.has(w)) eigeneWoerter.set(w, [])
        eigeneWoerter.get(w).push(f)
    }
}
const namenTreffer = [...fremdeNamen.keys()].filter(n => eigeneWoerter.has(n)).sort()
    .map(n => ({ name: n, gegen: fremdeNamen.get(n), dateien: eigeneWoerter.get(n), grund: GESICHTET.namen?.[n] || null }))

// ── Ausgabe ────────────────────────────────────────────────────────────────
const prozent = (x) => x.toFixed(2)
console.log(`Vergleichsstand: ${QUELLE} @ ${stand} (ohne ${FREMD_IM_VERGLEICH.join(', ')})`)
console.log(`\n1 Zeilen im Code (≥ ${MIN_LAENGE} Zeichen, ohne Einrückung): ${code.gesamt}`)
console.log(`  davon wörtlich im Vergleichsstand: ${code.gleich} (${prozent(code.anteil)} %), in ${code.jeDatei.length} Dateien`)
for (const d of code.jeDatei) console.log(`  ${String(d.treffer).padStart(4)} / ${String(d.zeilen).padStart(5)}  ${d.datei}`)
const jeArt = {}
for (const t of code.treffer) jeArt[t.art || 'NICHT GESICHTET'] = (jeArt[t.art || 'NICHT GESICHTET'] || 0) + 1
console.log('  nach Art:')
for (const [art, n] of Object.entries(jeArt).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${art}`)

console.log(`\n2 Zeilen übriger Textdateien: ${text.gesamt}, davon gleich: ${text.gleich} (${prozent(text.anteil)} %)`)
for (const t of text.treffer) console.log(`  ${t.datei}:${t.zeile}\t${t.art || 'NICHT GESICHTET'}\t${t.text.slice(0, 100)}`)

const namenOffen = namenTreffer.filter(n => !n.grund)
console.log(`\n3 Namen: ${fremdeNamen.size} im Vergleichsstand deklariert, ${namenTreffer.length} kommen bei uns vor, ${namenOffen.length} ungesichtet`)
for (const n of (zeigt('--namen') ? namenTreffer : namenOffen)) {
    console.log(`  ${n.name.padEnd(32)} ${n.grund ? '(' + n.grund + ')' : 'NICHT GESICHTET'}  ${n.dateien.length} Dateien, z. B. ${n.dateien[0]}`)
}

const laeufeOffen = laufTreffer.filter(l => !l.grund)
const zaehle = (art) => laufTreffer.filter(l => l.art === art).length
console.log(`\n4 Token-Fenster: ${zaehle('streng')} strenge, ${zaehle('normalisiert')} normalisierte Läufe über der Schwelle, ${laeufeOffen.length} ungesichtet`)
for (const l of (zeigt('--laeufe') ? laufTreffer : laeufeOffen)) {
    console.log(`  [${l.art}] ${l.datei} ${l.tokens} Tokens, sig ${l.sig}, gegen ${l.gegen}${l.grund ? ' (' + l.grund + ')' : ''}`)
    console.log(`      ${l.text.slice(0, 220)}`)
}

const codeOffen = code.treffer.filter(t => !t.art)
const textOffen = text.treffer.filter(t => !t.art)
if (zeigt('--treffer') || codeOffen.length) {
    console.log(zeigt('--treffer') ? '\nTrefferzeilen (Code):' : '\nNicht gesichtete Trefferzeilen (Code):')
    for (const t of (zeigt('--treffer') ? code.treffer : codeOffen)) console.log(`${t.datei}:${t.zeile}\t${t.art || '—'}\t${t.text}`)
}
if (zeigt('--vorschlag')) {
    console.log('\nVorschlag für scripts/herkunft-akzeptiert.json (Gründe von Hand eintragen):')
    console.log(JSON.stringify({
        textZeilen: Object.fromEntries(textOffen.map(t => [t.text, '?'])),
        namen: Object.fromEntries(namenOffen.map(n => [n.name, '?'])),
        laeufe: Object.fromEntries(laeufeOffen.map(l => [`${l.datei}|${l.sig}`, '?'])),
    }, null, 2))
}
const json = wert('--json')
if (json) writeFileSync(json, JSON.stringify({ quelle: QUELLE, stand, code, text, namen: namenTreffer, laeufe: laufTreffer }, null, 2))
if (aufraeumen) rmSync(aufraeumen, { recursive: true, force: true })
const offen = codeOffen.length + textOffen.length + namenOffen.length + laeufeOffen.length
console.log(`\nUngesichtet: ${offen} (Zeilen ${codeOffen.length}, Text ${textOffen.length}, Namen ${namenOffen.length}, Läufe ${laeufeOffen.length})`)
process.exitCode = offen ? 1 : 0
