/** Selbsttest: Drei-Wege-Zusammenführung des Chart-Layouts (src/utils/chart/layoutZusammenfuehren.js). */
import { fuehreZusammen } from './chart/layoutZusammenfuehren.js'

let ok = 0, fehler = 0
const pruefe = (bed, text) => { if (bed) { ok++; console.log('  ✓ ' + text) } else { fehler++; console.log('  ✗ ' + text) } }
const kopie = (x) => JSON.parse(JSON.stringify(x))
const vv = (p) => ({ id: 'i1', typ: 'vwapVector', params: { showDaily: false, showWeekly: false, ...p } })
const layout = (ind, extra = {}) => ({ raster: '1', panels: [{ id: 'p1', symbol: 'BTCUSDT', indikatoren: ind }], ...extra })

const basis = layout([vv({})])
// Der gemeldete Fall: PC schaltet „Woche", Handy danach „Tag" mit altem Stand
const r = fuehreZusammen(basis, layout([vv({ showDaily: true })]), layout([vv({ showWeekly: true })]))
const p = r.panels[0].indikatoren[0].params
pruefe(p.showDaily === true && p.showWeekly === true, 'zwei Schalter in zwei Fenstern: beide bleiben')
pruefe(fuehreZusammen(basis, kopie(basis), layout([vv({ showWeekly: true })])).panels[0].indikatoren[0].params.showWeekly === true,
    'hier unverändert: fremder Stand gilt')
pruefe(fuehreZusammen(basis, layout([vv({ showDaily: true })]), kopie(basis)).panels[0].indikatoren[0].params.showDaily === true,
    'dort unverändert: eigener Stand gilt')
// Widerspruch: der jüngste Klick (eigene Seite) gewinnt
pruefe(fuehreZusammen(basis, layout([vv({ showDaily: false })], { raster: '2' }), layout([vv({})], { raster: '4' })).raster === '2',
    'Widerspruch am selben Wert: eigene Seite')
// Listen mit id
const zwei = layout([vv({}), { id: 'i2', typ: 'ema', params: { laenge: 20 } }])
const ohneEma = layout([vv({})])
const mitRsi = layout([vv({}), { id: 'i2', typ: 'ema', params: { laenge: 20 } }, { id: 'i3', typ: 'rsi', params: {} }])
const m = fuehreZusammen(zwei, ohneEma, mitRsi).panels[0].indikatoren.map((x) => x.id)
pruefe(m.join() === 'i1,i3', 'hier gelöscht + dort neu: gelöscht bleibt weg, neu kommt dazu')
const m2 = fuehreZusammen(zwei, layout([{ id: 'i2', typ: 'ema', params: { laenge: 50 } }, vv({})]), layout([vv({ showDaily: true }), { id: 'i2', typ: 'ema', params: { laenge: 20 } }])).panels[0].indikatoren
pruefe(m2.map((x) => x.id).join() === 'i2,i1' && m2[0].params.laenge === 50 && m2[1].params.showDaily === true,
    'umsortiert + je Indikator geändert: eigene Reihenfolge, beide Werte')
pruefe(fuehreZusammen(zwei, layout([vv({}), { id: 'i2', typ: 'ema', params: { laenge: 99 } }]), ohneEma).panels[0].indikatoren.length === 2,
    'dort gelöscht, hier geändert: bleibt (Gegenprobe gegen stilles Verlieren)')
// Schlüssel
pruefe(!('x' in fuehreZusammen({ a: 1, x: 1 }, { a: 1, x: 1 }, { a: 1 })), 'Schlüssel dort gelöscht, hier unverändert: weg')
pruefe(fuehreZusammen({ a: 1 }, { a: 1 }, { a: 1, neu: 3 }).neu === 3, 'Schlüssel dort neu: dazu')
// Listen ohne id
pruefe(fuehreZusammen([1, 2, 3], [9, 2, 3], [1, 2, 8]).join() === '9,2,8', 'gleich lange Liste ohne id: je Stelle')
pruefe(fuehreZusammen([1, 2], [1, 2, 3], [1]).join() === '1,2,3', 'ungleiche Länge: eigene Seite')

console.log(`layout-zusammenfuehren: ${ok} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler ? 1 : 0)
