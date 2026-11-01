/**
 * Selbsttest: ein Schalter, dessen @change-Handler das Umlegen ablehnt, stellt
 * den Wert nicht im selben Takt zurück.
 *
 *   node src/utils/__selftest-schalter-rueckstellung.mjs
 *
 * `<Schalter v-model="x" @change="f">` setzt beim Klick zuerst `x` auf den
 * neuen Wert und ruft gleich danach `f`. Setzt `f` den Wert noch im selben
 * Takt zurück (`x.value = false` vor dem ersten `await`), sieht Vue beim
 * Zeichnen keine Änderung (false bleibt false) und lässt die Checkbox in Ruhe
 * — sie bleibt sichtbar eingeschaltet, obwohl der Zustand aus ist. So beim
 * Schalter „Anmelden nur mit dem YubiKey" ohne Passwort (Nachbesserung zu
 * Audit 4.3.4 SEC-S1-002). Richtig: erst `await nextTick()`, dann zurück.
 *
 * Geprüft wird im Quelltext jeder .vue-Datei: für jedes `<Schalter v-model="x"
 * … @change="f">` darf der Rumpf der Funktion `f` vor dem ersten `await`
 * nicht `x.value =` zuweisen. Die Gegenprobe stellt sicher, dass die Suche
 * Schalter mit Handler überhaupt findet, und dass die Regel den Fehler an
 * einem Beispiel erkennt.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let bestanden = 0
let fehlgeschlagen = 0
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

function dateien(ordner) {
    const aus = []
    for (const e of fs.readdirSync(ordner, { withFileTypes: true })) {
        const p = path.join(ordner, e.name)
        if (e.isDirectory()) aus.push(...dateien(p))
        else if (e.name.endsWith('.vue')) aus.push(p)
    }
    return aus
}

/** Rumpf von `function name(` bzw. `async function name(` (Klammern gezählt), sonst null. */
function rumpf(text, name) {
    const m = new RegExp(`function\\s+${name}\\s*\\(`).exec(text)
    if (!m) return null
    const start = text.indexOf('{', m.index)
    let tiefe = 0
    for (let i = start; i < text.length; i++) {
        if (text[i] === '{') tiefe++
        else if (text[i] === '}' && --tiefe === 0) return text.slice(start + 1, i)
    }
    return null
}

/** Alle Verstösse einer Datei: [{ variable, handler }]. */
function verstoesse(text) {
    const aus = []
    let gefunden = 0
    for (const m of text.matchAll(/<Schalter\b[^>]*>/gs)) {
        const tag = m[0]
        const v = /\bv-model="(\w+)"/.exec(tag)
        const h = /@change="(\w+)"/.exec(tag)
        if (!v || !h) continue
        const koerper = rumpf(text, h[1])
        if (koerper == null) continue
        gefunden++
        const awaitPos = koerper.search(/\bawait\b/)
        const vorher = awaitPos < 0 ? koerper : koerper.slice(0, awaitPos)
        if (new RegExp(`\\b${v[1]}\\.value\\s*=(?!=)`).test(vorher)) aus.push({ variable: v[1], handler: h[1] })
    }
    return { aus, gefunden }
}

// Gegenprobe: die Regel erkennt den Fehler und lässt die richtige Form durch.
const falsch = `<Schalter v-model="an" @change="um" />
<script>async function um(x) { if (x && !pw.value) { an.value = false; return } await speichern() }</script>`
const richtig = `<Schalter v-model="an" @change="um" />
<script>async function um(x) { if (x && !pw.value) { await nextTick(); an.value = false; return } }</script>`
check('Gegenprobe: Rückstellung im selben Takt wird erkannt', verstoesse(falsch).aus.length === 1)
check('Gegenprobe: Rückstellung nach await nextTick() gilt als richtig', verstoesse(richtig).aus.length === 0)

let gesamt = 0
const funde = []
for (const datei of dateien(SRC)) {
    const { aus, gefunden } = verstoesse(fs.readFileSync(datei, 'utf8'))
    gesamt += gefunden
    for (const f of aus) funde.push(`${path.relative(SRC, datei)}: ${f.handler}() setzt ${f.variable}.value vor dem ersten await`)
}
check(`Suche findet Schalter mit v-model und @change-Handler (${gesamt})`, gesamt >= 1)
check('ZweiterFaktor.vue: Schalter „Anmelden nur mit dem YubiKey" wird geprüft',
    verstoesse(fs.readFileSync(path.join(SRC, 'views/einstellungen/system/ZweiterFaktor.vue'), 'utf8')).gefunden >= 1)
check('Kein Schalter stellt seinen Wert im selben Takt zurück', funde.length === 0, funde.join('; '))

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
process.exit(fehlgeschlagen ? 1 : 0)
