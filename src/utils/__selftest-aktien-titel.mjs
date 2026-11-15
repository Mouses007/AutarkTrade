/**
 * Selbsttest: Rechenhilfen der Titel-Seite einer Aktie.
 *
 *   node src/utils/__selftest-aktien-titel.mjs
 */
import assert from 'node:assert/strict'
import { lageInSpanne, abstandPct, tageBis, einstufungsBilanz, zielBalken } from './aktienTitel.js'

let n = 0
const ok = (bed, text) => { assert.ok(bed, text); n++ }

ok(lageInSpanne(150, 100, 200) === 50 && lageInSpanne(100, 100, 200) === 0, 'Lage in der Spanne')
ok(lageInSpanne(90, 100, 200) === 0 && lageInSpanne(250, 100, 200) === 100, 'ausserhalb geklemmt')
ok(lageInSpanne(null, 100, 200) === null && lageInSpanne(5, 7, 7) === null, 'unbekannt oder leere Spanne → null')

ok(abstandPct(300, 150) === 100 && Math.round(abstandPct(170, 162.85) * 10) === 44, 'Abstand zum Kurs')
ok(abstandPct(null, 150) === null && abstandPct(0, 150) === null && abstandPct(300, 0) === null, 'ohne Ziel oder Kurs → null')

const jetzt = new Date(2026, 10, 15, 23, 30).getTime()
ok(tageBis(new Date(2026, 10, 17, 1, 0).getTime(), jetzt) === 2, 'übermorgen früh sind 2 Kalendertage')
ok(tageBis(new Date(2026, 10, 15, 0, 5).getTime(), jetzt) === 0 && tageBis(new Date(2026, 10, 14, 23, 0).getTime(), jetzt) === -1, 'heute und gestern')
ok(tageBis(null) === null, 'ohne Termin → null')

const b = einstufungsBilanz([
    { aktion: 'main', ziel: 300, zielVorher: 390 },
    { aktion: 'down', ziel: 174, zielVorher: 346 },
    { aktion: 'up', ziel: 200, zielVorher: 180 },
    { aktion: 'down', ziel: 180, zielVorher: null },
    { aktion: 'init', ziel: null, zielVorher: null },
])
ok(b.anzahl === 5 && b.herab === 2 && b.herauf === 1, 'Herab- und Heraufstufungen')
ok(b.zielGesenkt === 2 && b.zielErhoeht === 1, 'Kursziel ohne Vorwert zählt nicht')
ok(einstufungsBilanz().anzahl === 0, 'leere Liste')

const balken = zielBalken({ zielTief: 170, zielMittel: 278, zielHoch: 515 }, 162.85)
ok(balken.length === 3 && balken[2].breite === 100 && balken[0].breite < 5, 'Breite relativ zum grössten Abstand')
const unter = zielBalken({ zielTief: 80, zielMittel: null, zielHoch: 110 }, 100)
ok(unter.length === 2 && Math.round(unter[0].pct) === -20 && unter[0].breite === 100 && Math.round(unter[1].breite) === 50, 'Ziel unter dem Kurs, fehlendes Ziel fehlt')
ok(zielBalken(null, 100).length === 0 && zielBalken({ zielTief: 5 }, null).length === 0, 'ohne Daten keine Balken')

console.log(`✓ Titel-Seite Rechenhilfen: ${n} Prüfungen`)
