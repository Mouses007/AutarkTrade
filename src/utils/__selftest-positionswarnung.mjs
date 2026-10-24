/** Selbsttest: Warnungen für offene Positionen (src/utils/positionsWarnung.js). */
import { positionsWarnungen } from './positionsWarnung.js'

let ok = 0, fehler = 0
const pruefe = (bed, text) => { if (bed) { ok++; console.log('  ✓ ' + text) } else { fehler++; console.log('  ✗ ' + text) } }
const J = 10_000_000
const pos = (o) => ({ id: 'p1', symbol: 'TAOUSDT', richtung: 'long', sl: 240, liq: 245, slUnbekannt: false, einstiegT: J - 600_000, ...o })
const art = (o) => positionsWarnungen([pos(o)], { jetzt: J })[0]?.art ?? null

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
pruefe(positionsWarnungen([pos({ sl: null })], { jetzt: J })[0].schluessel === 'p1|ohneSl', 'Schlüssel je Position und Art (fürs Wegklicken)')

console.log(`positionswarnung: ${ok} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler ? 1 : 0)
