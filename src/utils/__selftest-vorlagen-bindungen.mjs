/**
 * Selbsttest: jeder Bezeichner in einer Vue-Vorlage ist gebunden.
 *
 *   node src/utils/__selftest-vorlagen-bindungen.mjs
 *
 * Warum: Die S11-Umbenennung hat in elf Vorlagen die alten Namen stehen lassen
 * (drei alte Namen aus der Zeit vor S11 …), während
 * Import und Store schon die neuen trugen. Vue wertet einen ungebundenen Namen
 * in der Vorlage still als `undefined` — kein Build-Fehler, keine Warnung im
 * Produktionsbau, und kein anderer Selbsttest rendert eine Vorlage. Die Folge
 * waren Karten, die nie erschienen, und Filter, die nichts taten (Audit A1-01
 * bis A1-09, 19.10.2026).
 *
 * Wie: Jede `.vue`-Datei wird mit dem Vue-Compiler (`@vue/compiler-sfc`, kommt
 * mit Vite) übersetzt, die Vorlage inline. Was im `<script setup>` gebunden
 * ist, spricht der erzeugte Code direkt an; alles andere wird zu `_ctx.X` —
 * und das ist genau die Liste der Namen, die die Vorlage nirgends findet.
 * Erlaubt sind nur die Instanz-Globals (`$t`, `$route`, `$emit` …); Vorlagen-
 * Globals wie `Math` oder `Date` erzeugt der Compiler ohnehin nicht als `_ctx`.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, compileScript } from '@vue/compiler-sfc'

const wurzel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Instanz-Eigenschaften, die jede Komponente in der Vorlage kennt. */
const ERLAUBT = new Set([
    '$t', '$te', '$tc', '$tm', '$rt', '$d', '$n', '$i18n',
    '$route', '$router',
    '$slots', '$attrs', '$emit', '$props', '$el', '$refs', '$parent', '$root', '$data', '$options',
    '$forceUpdate', '$nextTick', '$watch', '$event',
])

let bestanden = 0
let fehler = 0
const pruefe = (bedingung, text) => {
    if (bedingung) { bestanden++; return }
    fehler++
    console.log('  ✗ ' + text)
}

/** Ungebundene Vorlagen-Bezeichner einer SFC (Name → Anzahl), oder Fehlertext. */
export function ungebunden(quelle, dateiname = 'x.vue') {
    const { descriptor, errors } = parse(quelle, { filename: dateiname })
    if (errors.length) return { fehler: String(errors[0].message || errors[0]) }
    if (!descriptor.template) return { treffer: new Map() }
    if (!descriptor.scriptSetup) return { treffer: new Map(), ohneSetup: true }
    // Die HTML-Hinweise des Compilers (<tr> direkt in <table> …) gehören nicht
    // hierher und würden die Ausgabe zuschütten.
    const warn = console.warn
    console.warn = () => {}
    let code
    try {
        code = compileScript(descriptor, { id: 'pruefung', inlineTemplate: true }).content
    } catch (e) {
        return { fehler: String(e.message).split('\n')[0] }
    } finally {
        console.warn = warn
    }
    const treffer = new Map()
    for (const m of code.matchAll(/_ctx\.([A-Za-z_$][\w$]*)/g)) {
        if (ERLAUBT.has(m[1])) continue
        treffer.set(m[1], (treffer.get(m[1]) || 0) + 1)
    }
    return { treffer }
}

// ── Gegenprobe: der Prüfer selbst erkennt, was er erkennen soll ──────────────
{
    const falsch = ungebunden(`<script setup>
import { ref } from 'vue'
const gewaehlt = ref('a')
</script>
<template><select v-model="selected"><option>a</option></select><p v-if="bereit">{{ $t('x') }}</p></template>`)
    pruefe(falsch.treffer?.has('selected') && falsch.treffer?.has('bereit'), 'Gegenprobe: ungebundene Namen werden gemeldet')
    pruefe(!falsch.treffer?.has('$t'), 'Gegenprobe: $t ist erlaubt')

    const richtig = ungebunden(`<script setup>
import { ref } from 'vue'
import { bereit } from './store.js'\nimport Kind from './Kind.vue'
const gewaehlt = ref('a')
const props = defineProps({ wert: Number })
</script>
<template><select v-model="gewaehlt"><option>a</option></select><p v-if="bereit">{{ wert }} {{ Math.round(1.2) }}</p>
<div v-for="z in [1,2]" :key="z">{{ z }}</div><Kind v-slot="{ x }">{{ x }}</Kind></template>`)
    pruefe(richtig.treffer && richtig.treffer.size === 0, 'Gegenprobe: gebundene Namen, Props, v-for und Math bleiben still'
        + (richtig.fehler ? ' — ' + richtig.fehler : richtig.treffer?.size ? ' — gemeldet: ' + [...richtig.treffer.keys()].join(', ') : ''))
}

// ── Alle Vorlagen des Projekts ──────────────────────────────────────────────
const dateien = []
const lauf = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) lauf(p)
        else if (p.endsWith('.vue')) dateien.push(p)
    }
}
lauf(path.join(wurzel, 'src'))
pruefe(dateien.length > 100, `mindestens 100 Vue-Dateien gefunden (${dateien.length})`)

for (const datei of dateien.sort()) {
    const rel = path.relative(wurzel, datei)
    const erg = ungebunden(fs.readFileSync(datei, 'utf8'), datei)
    if (erg.fehler) { pruefe(false, `${rel}: lässt sich nicht übersetzen — ${erg.fehler}`); continue }
    // Ohne <script setup> sieht der Compiler die Bindungen nicht; das Projekt
    // hat derzeit keine solche Datei — taucht eine auf, fällt sie hier auf.
    if (erg.ohneSetup) { pruefe(false, `${rel}: Vorlage ohne <script setup> — hier nicht prüfbar`); continue }
    const liste = [...erg.treffer].map(([k, v]) => `${k}×${v}`).join(', ')
    pruefe(erg.treffer.size === 0, `${rel}: ungebunden in der Vorlage: ${liste}`)
}

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler ? 1 : 0)
