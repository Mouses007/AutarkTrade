/**
 * Selbsttest der LSOB-Alarme (`chart-alarm-lsob.js`).
 *
 *   node server/__selftest-chart-alarm-lsob.mjs
 *
 * Auf echten Kerzen (ETHUSDT 1h, dieselbe Fixture wie der Indikator-Test):
 * jeder Retest und jede neue Box, die der Indikator über die ganze Reihe
 * zeigt, muss der Alarm melden, wenn die Kerze die jüngste geschlossene ist —
 * und neben jeder Auslösung ein Fall, der NICHT auslösen darf (laufende
 * Kerze, dieselbe Kerze zweimal, falsche Richtung, zu spät, vor der Anlage).
 */
import fs from 'node:fs'
import { lsobCv } from '../shared/lsobCv.js'
import {
    pruefeLsob, lsobEreignisse, lsobParams, passtEreignis, lsobText, LSOB_KERZEN, LSOB_MIN_KERZEN,
} from './chart-alarm-lsob.js'
import { TF_MS, VERZUG_MS, MAX_VERSPAETUNG_MS } from './chart-alarm-momentum.js'

let bestanden = 0
let fehlgeschlagen = 0
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const kerzen = JSON.parse(fs.readFileSync(new URL('../shared/fixtures/ethusdt-1h-2026-09-01_10-18.json', import.meta.url)))
    .kerzen.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
const MS = TF_MS['1h']
const voll = lsobCv(kerzen)
check('Fixture: Retests und Boxen vorhanden', voll.signale.length >= 3 && voll.boxen.length >= 5, `${voll.signale.length} Signale, ${voll.boxen.length} Boxen`)

/** Die Börse kennt die Zukunft nicht: Kerzen bis i, Uhr kurz nach ihrem Schluss. */
const bis = (i) => kerzen.slice(Math.max(0, i + 1 - LSOB_KERZEN), i + 1)
const nach = (i, plus = VERZUG_MS) => kerzen[i].t + MS + plus
const idx = (t) => kerzen.findIndex((k) => k.t === t)

// ── Jeder Retest des Indikators wird auf seiner Kerze gemeldet ─────────────
// (ab Kerze LSOB_MIN_KERZEN — davor ist die Reihe zu kurz zum Melden)
const pruefbar = voll.signale.filter((s) => idx(s.t) >= LSOB_MIN_KERZEN - 1)
let retestOk = 0
for (const s of pruefbar) {
    const i = idx(s.t)
    const erg = pruefeLsob({ bedingung: { ereignis: 'retest' }, tf: '1h', kerzen: { '1h': bis(i) }, jetzt: nach(i) })
    if (erg.ausloesen && erg.ereignisse.some((e) => e.typ === 'retest' && e.seite === s.seite && e.boxT === s.boxT)) retestOk++
}
check('jeder Retest des Indikators löst aus', pruefbar.length >= 20 && retestOk === pruefbar.length, `${retestOk}/${pruefbar.length}`)

// Auf der Kerze davor (die Box steht schon) noch kein Retest
const s0 = voll.signale[voll.signale.length - 1]
const i0 = idx(s0.t)
const vorher = pruefeLsob({ bedingung: { ereignis: 'retest' }, tf: '1h', kerzen: { '1h': bis(i0 - 1) }, jetzt: nach(i0 - 1) })
check('Kerze vor dem Retest: keine Meldung dieser Box', !(vorher.ereignisse || []).some((e) => e.boxT === s0.boxT))

// ── Neue Boxen: genau auf der Bestätigungskerze ─────────────────────────────
const b0 = voll.boxen.find((b) => b.i > 300)
const bi = b0.i + 5        // pivotLaenge 5: mit Kerze i+5 hat das Pivot seine rechten Nachbarn
const boxErg = pruefeLsob({ bedingung: { ereignis: 'box' }, tf: '1h', kerzen: { '1h': bis(bi) }, jetzt: nach(bi) })
check('neue Box auf ihrer Bestätigungskerze gemeldet', boxErg.ausloesen && boxErg.ereignisse.some((e) => e.typ === 'box' && e.boxT === b0.t))
const boxFrueh = lsobEreignisse(bis(bi - 1))
check('eine Kerze früher: Box noch nicht da', !boxFrueh.some((e) => e.boxT === b0.t))
const boxSpaet = lsobEreignisse(bis(bi + 1))
check('eine Kerze später: nicht noch einmal „neu"', !boxSpaet.some((e) => e.typ === 'box' && e.boxT === b0.t))
check('„nur Retest" meldet die neue Box nicht', !passtEreignis({ ereignis: 'retest' }, { typ: 'box', seite: b0.seite }))
check('„beide" meldet Box und Retest', passtEreignis({ ereignis: 'beide' }, { typ: 'box', seite: 'long' }) && passtEreignis({ ereignis: 'beide' }, { typ: 'retest', seite: 'short' }))

// ── Richtung ────────────────────────────────────────────────────────────────
const gegen = s0.seite === 'long' ? 'short' : 'long'
const falsch = pruefeLsob({ bedingung: { ereignis: 'retest', richtung: gegen }, tf: '1h', kerzen: { '1h': bis(i0) }, jetzt: nach(i0) })
check('Gegenrichtung meldet den Retest nicht', !(falsch.ereignisse || []).some((e) => e.boxT === s0.boxT))
const richtig = pruefeLsob({ bedingung: { ereignis: 'retest', richtung: s0.seite }, tf: '1h', kerzen: { '1h': bis(i0) }, jetzt: nach(i0) })
check('eigene Richtung meldet ihn', richtig.ausloesen)

// ── Zeitregeln ──────────────────────────────────────────────────────────────
const lauf = pruefeLsob({ bedingung: { ereignis: 'retest' }, tf: '1h', kerzen: { '1h': bis(i0) }, jetzt: kerzen[i0].t + MS - 1000 })
check('laufende Kerze meldet nicht', !lauf.ausloesen)
const doppelt = pruefeLsob({ bedingung: { ereignis: 'retest' }, tf: '1h', kerzen: { '1h': bis(i0) }, jetzt: nach(i0), gemeldetBis: kerzen[i0].t })
check('dieselbe Kerze meldet nicht zweimal', !doppelt.ausloesen && doppelt.grund === 'schonGemeldet')
const spaet = pruefeLsob({ bedingung: { ereignis: 'retest' }, tf: '1h', kerzen: { '1h': bis(i0) }, jetzt: nach(i0, MAX_VERSPAETUNG_MS + 1000) })
check('zu spät wird nicht nachgemeldet', !spaet.ausloesen && spaet.grund === 'zuSpaet')
const vorAnlage = pruefeLsob({ bedingung: { ereignis: 'retest' }, tf: '1h', kerzen: { '1h': bis(i0) }, jetzt: nach(i0), abMs: nach(i0) })
check('Kerze vor der Anlage zählt nicht', !vorAnlage.ausloesen && vorAnlage.grund === 'vorAnlage')
const veraltet = pruefeLsob({ bedingung: { ereignis: 'retest' }, tf: '1h', kerzen: { '1h': bis(i0) }, jetzt: nach(i0 + 1) })
check('Reihe ohne die jüngste Kerze ist veraltet', !veraltet.ausloesen && veraltet.grund === 'veraltet')
check('unbekannte Zeiteinheit', pruefeLsob({ bedingung: {}, tf: '3m', kerzen: {}, jetzt: 0 }).grund === 'zeiteinheit')

// ── Einstellungen ───────────────────────────────────────────────────────────
const pp = lsobParams({ pivotLaenge: 3.4, retestPct: 500, invalidierungPct: 20, foo: 1, strengDocht: true })
check('Einstellungen: gerundet, begrenzt, Vorgaben und Fremdes weg', pp.pivotLaenge === 3 && pp.retestPct === 100 && !('invalidierungPct' in pp) && !('foo' in pp) && pp.strengDocht === true, JSON.stringify(pp))
check('Einstellungen: Unsinn ergibt nichts', Object.keys(lsobParams('x')).length === 0 && Object.keys(lsobParams({ pivotLaenge: 'a' })).length === 0)
const mitP = lsobEreignisse(bis(kerzen.length - 1), { pivotLaenge: 3 })
const ohneP = lsobCv(bis(kerzen.length - 1), { pivotLaenge: 3 })
check('Einstellungen kommen in der Rechnung an', mitP.every((e) => e.typ !== 'retest' || ohneP.signale.some((s) => s.boxT === e.boxT)))

// ── Text ────────────────────────────────────────────────────────────────────
const { titel, text } = lsobText({ notiz: 'Plan A' }, [{ symbol: 'ETHUSDT', markt: 'futures', tf: '1h', preis: 2500, ereignisse: [{ typ: 'retest', seite: 'short', tief: 2490, hoch: 2510 }] }])
check('Titel nennt Symbol, Zeiteinheit, Ereignis', titel === 'LSOB ETHUSDT 1h: Retest Short-Box', titel)
check('Text nennt Box, Kurs und Notiz', text === 'ETHUSDT 1h: Retest Short-Box 2490–2510 — Kurs 2500\nPlan A', text)
const zwei = lsobText({}, [
    { symbol: 'A', markt: 'futures', tf: '1h', preis: 1, ereignisse: [{ typ: 'box', seite: 'long', tief: 1, hoch: 2 }] },
    { symbol: 'B', markt: 'spot', tf: '4h', preis: 2, ereignisse: [{ typ: 'retest', seite: 'long', tief: 1, hoch: 2 }] },
])
check('mehrere Treffer gebündelt', zwei.titel === 'LSOB: 2 Signale' && zwei.text.split('\n').length === 2 && zwei.text.includes('B Spot 4h'))

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
process.exit(fehlgeschlagen ? 1 : 0)
