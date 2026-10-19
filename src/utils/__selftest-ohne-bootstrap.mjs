/**
 * Selbsttest: die App kommt ohne Bootstrap, Font Awesome und Unicons aus (S9).
 *
 *   node src/utils/__selftest-ohne-bootstrap.mjs
 *
 * Hält fest, was S9 Teil 2 entfernt hat, damit es nicht über eine kopierte
 * Vorlage oder einen alten Zweig zurückkommt:
 *   - package.json: keine Abhängigkeit auf bootstrap, @popperjs/core,
 *     font-awesome oder Unicons,
 *   - index.html: keine Stylesheets oder Skripte von einem CDN (die App muss
 *     offline vollständig aussehen; Unicons dürfte gar nicht weitergegeben
 *     werden),
 *   - src/: kein `window.bootstrap`, kein Import aus 'bootstrap', keine
 *     `data-bs-…`-Attribute (ohne Bootstrap-JS tun sie stillschweigend nichts),
 *   - src/: keine Klassen der Symbolschriften (`uil …`, `fa …`) — ohne die
 *     Schrift wäre dort eine leere Stelle statt eines Symbols,
 *   - keine Übergangsschicht mehr (S9 Teil 3): weder
 *     src/assets/design/uebergang.css noch src/assets/style-dark.css, und in
 *     src/ (auch .css) keine alten Variablennamen (--blue-color, --white-*,
 *     --black-bg-*, --grey-*, --border-radius …). Sie waren nur noch Aliase
 *     auf die Token; ohne die Schicht wären sie leer und die Regel fiele
 *     stillschweigend auf den Browser-Standard zurück.
 *
 * Gezeichnet wird über `components/basis/Symbol.vue`; Grundstil und Reset
 * stehen in `assets/design/basis.css`.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const hier = path.dirname(fileURLToPath(import.meta.url))
const wurzel = path.resolve(hier, '../..')
const quelle = path.join(wurzel, 'src')
const selbst = fileURLToPath(import.meta.url)

let bestanden = 0
let fehler = 0
function pruefe(name, funde) {
    if (funde.length === 0) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name} — ${funde.length} Stelle(n):`)
    for (const f of funde.slice(0, 15)) console.error(`      ${f}`)
    if (funde.length > 15) console.error(`      … und ${funde.length - 15} weitere`)
}

// ── package.json ─────────────────────────────────────────────────────────
const paket = JSON.parse(fs.readFileSync(path.join(wurzel, 'package.json'), 'utf8'))
const verbotenePakete = /^(bootstrap|@popperjs\/core|popper\.js|font-awesome|@fortawesome\/.*|@iconscout\/unicons|unicons)$/
const abhaengig = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
    .flatMap((feld) => Object.keys(paket[feld] || {}).map((name) => `${feld}: ${name}`))
pruefe('package.json ohne Bootstrap/Popper/Font Awesome/Unicons',
    abhaengig.filter((z) => verbotenePakete.test(z.split(': ')[1])))

// ── index.html ───────────────────────────────────────────────────────────
const html = fs.readFileSync(path.join(wurzel, 'index.html'), 'utf8')
const cdn = /(cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|use\.fontawesome\.com|maxcdn|stackpath)/i
const htmlFunde = []
for (const m of html.matchAll(/<(link|script)\b[^>]*>/gi)) {
    if (cdn.test(m[0])) htmlFunde.push(m[0].replace(/\s+/g, ' ').slice(0, 120))
}
pruefe('index.html lädt nichts vom CDN', htmlFunde)

// ── src/ ─────────────────────────────────────────────────────────────────
function dateien(ordner, raus = []) {
    for (const e of fs.readdirSync(ordner, { withFileTypes: true })) {
        const voll = path.join(ordner, e.name)
        if (e.isDirectory()) { if (e.name !== 'node_modules') dateien(voll, raus); continue }
        if (/\.(vue|js|mjs|ts|html|css)$/.test(e.name) && voll !== selbst) raus.push(voll)
    }
    return raus
}

const zeileVon = (text, index) => text.slice(0, index).split('\n').length
const ort = (datei, text, index) => `${path.relative(wurzel, datei)}:${zeileVon(text, index)}`

/** Zeilen, die nur Kommentar sind, zählen nicht — Erklärungen dürfen die alten Namen nennen. */
function ohneKommentare(text) {
    return text
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/(^|[^:'"`])\/\/[^\n]*/g, (m, vor) => vor + ' '.repeat(m.length - vor.length))
}

/** Ist ein Klassenname einer der Symbolschriften? */
const schriftKlasse = (k) => k === 'uil' || k.startsWith('uil-') || k === 'fa' || k.startsWith('fa-')

/** Variablennamen der früheren style-dark.css bzw. uebergang.css. */
const alteVariable = /--(blue-color|blue-active-color|green|green-color|red-color|red-hover-color|grey-[\w-]+|black-bg[\w-]*|white-\d+|bg-card|border-color|border-radius|border-subtle|shadow-sm)(?![\w-])/g

const bootstrapFunde = []
const variablenFunde = []
const datenBsFunde = []
const klassenFunde = []

for (const datei of dateien(quelle)) {
    const roh = fs.readFileSync(datei, 'utf8')
    const text = ohneKommentare(roh)

    for (const m of text.matchAll(/window\.bootstrap|globalThis\.bootstrap|from\s+['"]bootstrap(\/[^'"]*)?['"]|import\s+['"]bootstrap(\/[^'"]*)?['"]|\bnew\s+bootstrap\./g)) {
        bootstrapFunde.push(`${ort(datei, text, m.index)}  ${m[0]}`)
    }
    for (const m of text.matchAll(alteVariable)) {
        variablenFunde.push(`${ort(datei, text, m.index)}  ${m[0]}`)
    }
    for (const m of text.matchAll(/data-bs-[a-z-]+/g)) {
        datenBsFunde.push(`${ort(datei, text, m.index)}  ${m[0]}`)
    }
    // class="…" und :class="…" (darin jede Zeichenkette in Anführungszeichen)
    for (const m of text.matchAll(/(:?class)\s*=\s*"([^"]*)"/g)) {
        const teile = m[1] === 'class'
            ? [m[2]]
            : [...m[2].matchAll(/'([^']*)'|`([^`]*)`/g)].map((x) => x[1] ?? x[2])
        const treffer = teile.flatMap((t) => t.split(/\s+/)).filter(schriftKlasse)
        if (treffer.length) klassenFunde.push(`${ort(datei, text, m.index)}  ${treffer.join(' ')}`)
    }
    // Klassen als Daten (Registries, die eine Klasse weiterreichen)
    for (const m of text.matchAll(/['"`]\s*(uil uil-[\w-]+|fa fa-[\w-]+)/g)) {
        klassenFunde.push(`${ort(datei, text, m.index)}  ${m[1]}`)
    }
}

pruefe("src/ ohne window.bootstrap / Import aus 'bootstrap'", bootstrapFunde)
pruefe('src/ ohne data-bs-Attribute', datenBsFunde)
pruefe('src/ ohne Klassen der Symbolschriften (uil …, fa …)', [...new Set(klassenFunde)])
pruefe('src/ ohne alte Variablennamen (--blue-color, --white-*, --border-radius …)', variablenFunde)

// ── Übergangsschicht ─────────────────────────────────────────────────────
pruefe('keine Übergangsschicht (uebergang.css, style-dark.css)',
    ['src/assets/design/uebergang.css', 'src/assets/style-dark.css']
        .filter((d) => fs.existsSync(path.join(wurzel, d))))

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
if (fehler) process.exit(1)
