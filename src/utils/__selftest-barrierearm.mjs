/**
 * Selbsttest: Knöpfe nur mit Symbol haben einen zugänglichen Namen.
 *
 *   node src/utils/__selftest-barrierearm.mjs
 *
 * Ein Knopf, der nur ein Symbol zeigt, ist für einen Screenreader „Schalter"
 * ohne Bedeutung. Die Laufprüfung vom 19.10.2026 (Audit A4-21) fand solche
 * Knöpfe in den Chart-Dialogen, der Watchlist und im Strategie-Builder — und
 * `Knopf nurSymbol` ohne `titel`, dessen `aria-label` dann leer blieb.
 *
 * Geprüft wird jede Vorlage mit dem Vue-Compiler (AST, kein Rendern):
 *  - `<button>`, dessen Inhalt nur aus `<Symbol>`/`<Kreisel>` besteht, braucht
 *    `aria-label` oder `title` (statisch oder gebunden);
 *  - `<Knopf nurSymbol>` braucht `titel`.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@vue/compiler-sfc'

const wurzel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

let bestanden = 0
let fehler = 0
const pruefe = (bedingung, text) => {
    if (bedingung) { bestanden++; return }
    fehler++
    console.log('  ✗ ' + text)
}

const ELEMENT = 1
const TEXT = 2
const INTERPOLATION = 5
const NUR_SYMBOL = new Set(['Symbol', 'Kreisel'])

/** Attribut oder Bindung vorhanden? (`title`, `:title`, `aria-label`, `v-bind:aria-label`) */
function hat(knoten, name) {
    return knoten.props.some((p) => (p.type === 6 && p.name === name)
        || (p.type === 7 && p.name === 'bind' && p.arg?.content === name))
}

/** Besteht der sichtbare Inhalt nur aus Symbolen (kein Text, keine Interpolation)? */
function nurSymbole(knoten) {
    let symbol = false
    const lauf = (k) => {
        for (const c of k.children || []) {
            if (c.type === TEXT && c.content.trim()) return false
            if (c.type === INTERPOLATION) return false
            if (c.type === ELEMENT) {
                if (NUR_SYMBOL.has(c.tag)) { symbol = true; continue }
                if (c.tag === 'template' || c.tag === 'span') { if (lauf(c) === false) return false; continue }
                return false
            }
        }
        return true
    }
    return lauf(knoten) !== false && symbol
}

/** Alle Mängel einer Vorlage als Liste „Zeile: Beschreibung". */
export function maengel(quelle, dateiname = 'x.vue') {
    const { descriptor } = parse(quelle, { filename: dateiname })
    if (!descriptor.template?.ast) return []
    const aus = []
    const lauf = (k) => {
        if (k.type === ELEMENT) {
            const zeile = k.loc.start.line
            if (k.tag === 'button' && nurSymbole(k) && !hat(k, 'aria-label') && !hat(k, 'title')) {
                aus.push(`${zeile}: <button> nur mit Symbol, ohne aria-label/title`)
            }
            if (k.tag === 'Knopf' && (hat(k, 'nurSymbol') || hat(k, 'nur-symbol')) && !hat(k, 'titel')) {
                aus.push(`${zeile}: <Knopf nurSymbol> ohne titel`)
            }
        }
        for (const c of k.children || []) lauf(c)
        for (const z of k.branches || []) lauf(z)
    }
    lauf(descriptor.template.ast)
    return aus
}

// ── Gegenprobe ──────────────────────────────────────────────────────────────
{
    const schlecht = maengel(`<template><button class="zu" @click="x"><Symbol name="schliessen" /></button>
<Knopf nurSymbol symbol="nachricht" @click="y" /></template>`)
    pruefe(schlecht.length === 2, 'Gegenprobe: Symbol-Knopf und Knopf nurSymbol ohne Namen werden gemeldet — ' + JSON.stringify(schlecht))
    const gut = maengel(`<template><button :aria-label="t('a')"><Symbol name="x" /></button>
<button title="Zu"><Symbol name="x" /></button><button><Symbol name="x" /> Speichern</button>
<button>{{ n }}</button><Knopf nur-symbol :titel="t('b')" symbol="x" /></template>`)
    pruefe(gut.length === 0, 'Gegenprobe: benannte Knöpfe und Knöpfe mit Text bleiben still — ' + JSON.stringify(gut))
}

// ── Alle Vorlagen ───────────────────────────────────────────────────────────
const dateien = []
const lauf = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) lauf(p)
        else if (p.endsWith('.vue')) dateien.push(p)
    }
}
lauf(path.join(wurzel, 'src'))
for (const datei of dateien.sort()) {
    const rel = path.relative(wurzel, datei)
    const m = maengel(fs.readFileSync(datei, 'utf8'), datei)
    pruefe(m.length === 0, `${rel}:\n      ` + m.join('\n      '))
}

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler ? 1 : 0)
