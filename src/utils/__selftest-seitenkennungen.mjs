/**
 * Selbsttest: Jede Seitenkennung, die der Code vergleicht oder als Tabellenschlüssel
 * nutzt, muss eine echte Seite aus src/config/menu.js sein.
 *
 * Anlass (20.10.2026): F3 hat die Seitenkennungen umbenannt (dashboard →
 * journalUebersicht, daily → tagesansicht, calendar → kalender, screenshots → bilder).
 * Die Filtertabelle in FilterLeiste.vue behielt die alten Schlüssel, fand für keine
 * Seite mehr Zeilen und blendete den Journal-Filter still ganz aus. Kein Build-
 * Fehler, kein anderer Test schlug an — ein String ist für Vue nur ein String.
 *
 * Geprüft werden:
 *   - `seitenId.value === '<x>'` / `!==` / `==` in allen .vue/.js unter src/;
 *   - Elemente von `[...].includes(seitenId.value)`;
 *   - die Schlüssel der Tabelle ZEILEN in FilterLeiste.vue.
 * Gegenprobe: ein alter Name in einer nachgebauten Zeile muss gefunden werden.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = fileURLToPath(new URL('..', import.meta.url))
let ok = 0, fehler = 0
const pruefe = (bed, text) => { if (bed) ok++; else { fehler++; console.log('  ✗ ' + text) } }

const menu = readFileSync(join(SRC, 'config/menu.js'), 'utf8')
const IDS = new Set([...menu.matchAll(/\bid:\s*'([^']+)'/g)].map(m => m[1]))
pruefe(IDS.has('journalUebersicht') && IDS.has('tagesansicht') && IDS.size > 20, `Seitenliste aus menu.js gelesen (${IDS.size} Kennungen)`)

function dateien(dir) {
    return readdirSync(dir).flatMap(n => {
        const p = join(dir, n)
        if (statSync(p).isDirectory()) return n === 'node_modules' ? [] : dateien(p)
        return /\.(vue|js)$/.test(n) && !n.startsWith('__selftest') ? [p] : []
    })
}

function fundstellen(text) {
    const out = []
    for (const m of text.matchAll(/seitenId(?:\.value)?\s*(?:===|!==|==|!=)\s*'([^']+)'/g)) out.push(m[1])
    for (const m of text.matchAll(/'([^']+)'\s*(?:===|!==|==|!=)\s*seitenId(?:\.value)?/g)) out.push(m[1])
    for (const m of text.matchAll(/\[([^\]]*)\]\s*\.includes\(\s*seitenId(?:\.value)?\s*\)/g))
        for (const k of m[1].matchAll(/'([^']+)'/g)) out.push(k[1])
    return out
}

// Gegenprobe: alte Kennung muss auffallen
const probe = fundstellen("if (seitenId.value === 'daily') x(); ['dashboard','kalender'].includes(seitenId.value)")
pruefe(probe.includes('daily') && probe.includes('dashboard') && !IDS.has('daily') && !IDS.has('dashboard'), 'Gegenprobe: alte Kennungen werden erkannt')

let geprueft = 0
for (const datei of dateien(SRC)) {
    const text = readFileSync(datei, 'utf8')
    for (const id of fundstellen(text)) {
        geprueft++
        pruefe(IDS.has(id), `${relative(SRC, datei)}: Seitenkennung '${id}' gibt es in menu.js nicht`)
    }
}
pruefe(geprueft > 10, `Vergleiche mit seitenId gefunden (${geprueft})`)

const filter = readFileSync(join(SRC, 'components/journal/FilterLeiste.vue'), 'utf8')
const block = filter.match(/const ZEILEN = \{([\s\S]*?)\n\}/)
pruefe(!!block, 'Tabelle ZEILEN in FilterLeiste.vue gefunden')
if (block) {
    const schluessel = [...block[1].matchAll(/^\s*([A-Za-z]+)\s*:/gm)].map(m => m[1])
    pruefe(schluessel.length >= 4, `ZEILEN hat ${schluessel.length} Seiten`)
    for (const k of schluessel) pruefe(IDS.has(k), `FilterLeiste.vue ZEILEN: Schlüssel '${k}' ist keine Seite aus menu.js`)
}

console.log(`seitenkennungen: ${ok} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler ? 1 : 0)
