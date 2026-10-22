/**
 * Übersetzt das Logo-Zeichen in Vector-Drawables für die Android-App.
 *
 *   node scripts/logo-android.mjs
 *
 * Quelle ist `src/assets/design/logo-zeichen.svg` (erzeugt von
 * `scripts/logo-zeichnen.mjs`) — das Widget soll dasselbe Zeichen tragen wie
 * die Kopfleiste, nicht eine nachgemalte Kopie. Vector statt PNG: es bleibt
 * auf jeder Dichte scharf und kostet ein paar Kilobyte.
 *
 * Android-Vektoren kennen nur Pfade und Gruppen; Kreise, Linien und
 * abgerundete Rechtecke werden deshalb in Pfade umgeschrieben. Der radiale
 * Verlauf der Blütenblätter geht als `aapt:attr` mit (ab API 24, minSdk ist 31).
 *
 * Erzeugt:
 *   android-widget/app/src/main/res/drawable/ic_logo.xml          Zeichen in Farbe
 *   android-widget/app/src/main/res/drawable/ic_stat_alarm.xml    einfarbige Blüte (Statusleiste)
 *
 * Das Statusleisten-Symbol MUSS einfarbig sein — Android färbt es selbst ein,
 * und aus einem farbigen Zeichen würde ein weisser Fleck. Darum dort nur die
 * Blüte mit Kern, ohne den feinen Kerzenring, der bei 24 dp ohnehin verschwimmt.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const wurzel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const svg = fs.readFileSync(path.join(wurzel, 'src/assets/design/logo-zeichen.svg'), 'utf8')
const ziel = path.join(wurzel, 'android-widget/app/src/main/res/drawable')

const attr = (tag, name) => {
    const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`))
    return m ? m[1] : null
}
const n = (tag, name) => Number(attr(tag, name) || 0)
const r2 = (x) => Math.round(x * 100) / 100

const kreisPfad = (r) => `M${r2(r)},0 A${r2(r)},${r2(r)} 0 1,1 ${r2(-r)},0 A${r2(r)},${r2(r)} 0 1,1 ${r2(r)},0 Z`
function rechteckPfad(x, y, b, h, rx) {
    const r = Math.min(rx, b / 2, h / 2)
    return `M${r2(x + r)},${r2(y)} L${r2(x + b - r)},${r2(y)} A${r2(r)},${r2(r)} 0 0,1 ${r2(x + b)},${r2(y + r)} `
        + `L${r2(x + b)},${r2(y + h - r)} A${r2(r)},${r2(r)} 0 0,1 ${r2(x + b - r)},${r2(y + h)} `
        + `L${r2(x + r)},${r2(y + h)} A${r2(r)},${r2(r)} 0 0,1 ${r2(x)},${r2(y + h - r)} `
        + `L${r2(x)},${r2(y + r)} A${r2(r)},${r2(r)} 0 0,1 ${r2(x + r)},${r2(y)} Z`
}

/** Füllung/Strich eines SVG-Elements als Android-Attribute. */
function malen(tag) {
    const fill = attr(tag, 'fill')
    const stroke = attr(tag, 'stroke')
    const aus = []
    if (fill && fill !== 'none' && !fill.startsWith('url(')) aus.push(`android:fillColor="${fill}"`)
    if (stroke && stroke !== 'none') aus.push(`android:strokeColor="${stroke}"`, `android:strokeWidth="${attr(tag, 'stroke-width') || 1}"`)
    return aus.join(' ')
}

function element(tag) {
    if (tag.startsWith('<circle')) return { d: kreisPfad(n(tag, 'r')), mal: malen(tag), tag }
    if (tag.startsWith('<line')) return { d: `M${n(tag, 'x1')},${n(tag, 'y1')} L${n(tag, 'x2')},${n(tag, 'y2')}`, mal: malen(tag), tag }
    if (tag.startsWith('<rect')) return { d: rechteckPfad(n(tag, 'x'), n(tag, 'y'), n(tag, 'width'), n(tag, 'height'), n(tag, 'rx')), mal: malen(tag), tag }
    if (tag.startsWith('<path')) return { d: attr(tag, 'd'), mal: malen(tag), tag }
    return null
}

// Verlauf der Blätter (einziger <radialGradient>)
const verlauf = svg.match(/<radialGradient[^>]*>([\s\S]*?)<\/radialGradient>/)
const stopps = [...verlauf[1].matchAll(/<stop offset="([^"]+)" stop-color="([^"]+)"\/>/g)].map((m) => ({ offset: m[1], farbe: m[2] }))
const verlaufR = Number(svg.match(/<radialGradient[^>]*\sr="([^"]+)"/)[1])
const verlaufXml = (einzug) => [
    `${einzug}<aapt:attr name="android:fillColor">`,
    `${einzug}    <gradient android:type="radial" android:centerX="0" android:centerY="0" android:gradientRadius="${verlaufR}">`,
    ...stopps.map((s) => `${einzug}        <item android:offset="${s.offset}" android:color="${s.farbe}"/>`),
    `${einzug}    </gradient>`,
    `${einzug}</aapt:attr>`,
].join('\n')

// Körper ohne <svg>/<defs> in Elemente und Gruppen zerlegen
const koerper = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '').replace(/<defs>[\s\S]*?<\/defs>/, '')
const zeilen = []
const einr = '        '
for (const m of koerper.matchAll(/<g transform="rotate\(([^)]+)\)">([\s\S]*?)<\/g>|<(circle|line|rect|path)[^>]*\/>/g)) {
    if (m[1] != null) {
        zeilen.push(`${einr}<group android:rotation="${m[1]}">`)
        for (const t of m[2].match(/<(circle|line|rect|path)[^>]*\/>/g)) {
            const e = element(t)
            zeilen.push(`${einr}    <path android:pathData="${e.d}" ${e.mal}/>`)
        }
        zeilen.push(`${einr}</group>`)
        continue
    }
    const e = element(m[0])
    const rot = (m[0].match(/transform="rotate\(([^)]+)\)"/) || [])[1]
    const verlaufFuell = (attr(m[0], 'fill') || '').startsWith('url(')
    const pfad = verlaufFuell
        ? `${einr}    <path android:pathData="${e.d}" ${e.mal}>\n${verlaufXml(einr + '        ')}\n${einr}    </path>`
        : `${einr}    <path android:pathData="${e.d}" ${e.mal}/>`
    if (rot && Number(rot) !== 0) zeilen.push(`${einr}<group android:rotation="${rot}">`, pfad, `${einr}</group>`)
    else zeilen.push(pfad.replace(/^ {4}/gm, ''))
}

const kopf = (titel) => `<?xml version="1.0" encoding="utf-8"?>
<!-- ${titel}
     ERZEUGT von scripts/logo-android.mjs aus src/assets/design/logo-zeichen.svg — nicht von Hand ändern. -->`

const farbig = `${kopf('AutarkTrade-Zeichen: Blüte im Kursring.')}
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:aapt="http://schemas.android.com/aapt"
    android:width="96dp" android:height="96dp"
    android:viewportWidth="200" android:viewportHeight="200">
    <group android:translateX="100" android:translateY="100">
${zeilen.join('\n')}
    </group>
</vector>
`

// Einfarbige Blüte: dieselben fünf Blätter, Kern ausgespart (evenOdd).
const blatt = attr(koerper.match(/<path[^>]*\/>/)[0], 'd')
const status = `${kopf('Statusleisten-Symbol: einfarbige Blüte (Android färbt es selbst).')}
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp" android:height="24dp"
    android:viewportWidth="100" android:viewportHeight="100">
    <group android:translateX="50" android:translateY="50">
${[0, 72, 144, 216, 288].map((w) => `        <group android:rotation="${w}"><path android:fillColor="#FFFFFFFF" android:pathData="${blatt}"/></group>`).join('\n')}
    </group>
</vector>
`

fs.writeFileSync(path.join(ziel, 'ic_logo.xml'), farbig)
fs.writeFileSync(path.join(ziel, 'ic_stat_alarm.xml'), status)
console.log(`ic_logo.xml (${zeilen.length} Zeilen), ic_stat_alarm.xml geschrieben`)
