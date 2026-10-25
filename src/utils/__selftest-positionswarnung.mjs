/** Selbsttest: Warnungen für offene Positionen (src/utils/positionsWarnung.js). */
import { positionsWarnungen, fuehreOhneSlSeit, WEG_MS, BESTAETIGUNG_MS } from './positionsWarnung.js'

let ok = 0, fehler = 0
const pruefe = (bed, text) => { if (bed) { ok++; console.log('  ✓ ' + text) } else { fehler++; console.log('  ✗ ' + text) } }
const J = 10_000_000
const pos = (o) => ({ id: 'p1', symbol: 'TAOUSDT', richtung: 'long', sl: 240, liq: 245, slUnbekannt: false, einstiegT: J - 600_000, ...o })
// `seit`: die Position ist seit 10 min ohne SL gesehen (bestätigt)
const lange = { p1: J - 600_000 }
const art = (o, seit = lange) => positionsWarnungen([pos(o)], { jetzt: J, seit })[0]?.art ?? null

pruefe(art({ sl: null }) === 'ohneSl', 'Long ohne SL: Warnung')
pruefe(art({ sl: 240, liq: 245 }) === 'hinterLiq', 'Long, SL unter Liq: hinter Liq')
pruefe(art({ sl: 250, liq: 245 }) === null, 'Gegenprobe: Long, SL über Liq: nichts')
pruefe(art({ richtung: 'short', sl: 270, liq: 265 }) === 'hinterLiq', 'Short, SL über Liq: hinter Liq')
pruefe(art({ richtung: 'short', sl: 260, liq: 265 }) === null, 'Gegenprobe: Short, SL unter Liq: nichts')
pruefe(art({ sl: 245, liq: 245 }) === 'hinterLiq', 'SL genau auf Liq zählt als hinter Liq')
pruefe(art({ sl: 250, liq: null }) === null, 'Liq unbekannt: nur die SL-Frage zählt')
pruefe(art({ sl: null, slUnbekannt: true }) === null, 'Börse nicht erreichbar: unbekannt ist nicht „ohne SL"')
pruefe(art({ sl: null, einstiegT: J - 20_000 }) === null, 'frisch eröffnet (20 s): noch keine Warnung')
pruefe(art({ sl: null, einstiegT: null }) === 'ohneSl', 'Einstiegszeit unbekannt: Warnung')
pruefe(positionsWarnungen([pos({ sl: null })], { jetzt: J, seit: lange })[0].schluessel === 'p1|ohneSl', 'Schlüssel je Position und Art (fürs Wegklicken)')

// 25.10.2026: SL hat ausgelöst, die Börse hat die Stop-Order gelöscht, die Position steht noch als offen
const gesetzt = { t: J - 3_600_000, art: 'SL', aktion: 'set', wert: 240 }
pruefe(art({ sl: null, tpslVerlauf: [gesetzt, { t: J - 30_000, art: 'SL', aktion: 'triggered', alt: 240 }] }) === null, 'SL ausgelöst (Verlauf): nie „ohne SL"')
pruefe(art({ sl: null, tpslVerlauf: [gesetzt] }, { p1: J - 60_000 }) === null, 'SL war gesetzt, seit 1 min weg (Verlauf noch nicht nachgezogen): noch keine Warnung')
pruefe(art({ sl: null, tpslVerlauf: [gesetzt] }, { p1: J - WEG_MS }) === 'ohneSl', 'SL seit 5 min weg und Position weiter offen: Warnung')
pruefe(art({ sl: null }, { p1: J - 10_000 }) === null, 'nie ein SL, erst seit 10 s gesehen: noch keine Warnung')
pruefe(art({ sl: null }, { p1: J - BESTAETIGUNG_MS }) === 'ohneSl', 'nie ein SL, seit 1 min gesehen: Warnung')
pruefe(art({ sl: null }, {}) === null, 'erstmals gesehen (ohne Zeitpunkt): keine Warnung')
pruefe(art({ sl: null }, { p1: J - 120_000 }) === 'ohneSl' && positionsWarnungen([pos({ sl: null })], { jetzt: J, seit: { p1: J - 120_000 }, hatteSl: new Set(['p1']) }).length === 0, 'ohne Verlauf, aber vorher mit SL gesehen: 5 min Geduld statt 1 min')
const s1 = fuehreOhneSlSeit([pos({ sl: null }), pos({ id: 'p2', sl: 250 })], { p1: J - 99 }, J)
pruefe(s1.p1 === J - 99 && !('p2' in s1), 'seit: erster Zeitpunkt bleibt, Position mit SL fällt heraus')
pruefe(fuehreOhneSlSeit([pos({ sl: null, slUnbekannt: true })], {}, J).p1 === undefined, 'seit: unbekannt zählt nicht')

console.log(`positionswarnung: ${ok} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler ? 1 : 0)
