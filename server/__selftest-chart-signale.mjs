/**
 * Selbsttest: Signalverlauf für die Chart-Indikatoren LSOB / GUSS.
 *
 *   node server/__selftest-chart-signale.mjs
 *
 * Mit einer Attrappen-Strategie, deren Verhalten bekannt ist — geprüft wird
 * die Schleife: kein Blick in die Zukunft, Ereignisse am richtigen Setup,
 * Ausgang Ziel/Stop ab der Kerze NACH der Auslösung.
 */
import { signalVerlauf, ersteBeruehrung, zonenEnde } from './chart-signale.js'
import { getStrategy } from './strategies/index.js'
import { LSOB_PARAMS, GUSS_PARAMS } from '../src/utils/chart/indikatorRegister.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}
const H = 3600e3
const T0 = 1_760_000_000_000
// 60 Kerzen um 100; ab Kerze 40 steigt der Kurs (Ziel 106 erreicht bei 46)
const kerzen = Array.from({ length: 60 }, (_, i) => {
    const m = i < 40 ? 100 : 100 + (i - 40)
    return { t: T0 + i * H, o: m, h: m + 0.5, l: m - 0.5, c: m, v: 1 }
})

/*
 * Attrappe: meldet bei Kerze 30 ein Long-Setup (Zone 99–100), löst es aus,
 * sobald eine Kerze unter 99,6 kommt ODER — für den Zukunftstest — merkt sich,
 * welche letzte Kerze sie je gesehen hat.
 */
let gesehen = []
const attrappe = {
    warmupCandles: 10,
    detect({ candles, openSetups }) {
        const letzte = candles[candles.length - 1]
        gesehen.push(letzte.t)
        const setups = [], events = []
        if (letzte.t === T0 + 30 * H) setups.push({ direction: 'long', status: 'waiting_retest', obLow: 99, obHigh: 100, obCandleTime: letzte.t, entry: 100, stopLoss: 98, takeProfit: 106 })
        for (const s of openSetups) {
            if (letzte.t === T0 + 35 * H) events.push({ id: s.id, status: 'triggered', triggeredAt: letzte.t, entry: 100, stopLoss: 98, takeProfit: 106 })
        }
        return { setups, events, diagnostics: {} }
    },
}

console.log('\nSchleife\n')
{
    gesehen = []
    const r = signalVerlauf({ strategie: attrappe, candles: kerzen, params: { scanWindowCandles: 5, retestMaxCandles: 5 }, ltfMs: H, anzeigen: 50 })
    check('detect sieht nie eine Kerze nach der aktuellen (aufsteigend, je Kerze genau eine neue)', gesehen.every((t, i) => i === 0 || t === gesehen[i - 1] + H))
    check('beginnt nach dem Vorlauf (warmup bzw. anzeigen)', gesehen[0] === T0 + 10 * H, String((gesehen[0] - T0) / H))
    check('ein Setup erkannt', r.setups.length === 1)
    const s = r.setups[0]
    check('Auslösung am Setup vermerkt', s.status === 'triggered' && s.triggeredAt === T0 + 35 * H)
    check('Ausgang: Ziel 106 bei Kerze 46 (Hoch 106,5)', s.ausgang === 'ziel' && s.exitT === T0 + 46 * H, JSON.stringify(s))
    check('Zone und Kurse übernommen', s.obLow === 99 && s.obHigh === 100 && s.takeProfit === 106)
}
{
    // Stop und Ziel in derselben Kerze → Stop (vorsichtige Lesart)
    const k = kerzen.map((x, i) => (i === 37 ? { ...x, h: 107, l: 97 } : x))
    const r = signalVerlauf({ strategie: attrappe, candles: k, params: {}, ltfMs: H, anzeigen: 50 })
    check('Stop und Ziel in einer Kerze → Stop', r.setups[0].ausgang === 'stop' && r.setups[0].exitT === T0 + 37 * H)
    // Ausgang erst ab der Kerze NACH der Auslösung — ein Docht in der Auslösekerze zählt nicht
    const k2 = kerzen.map((x, i) => (i === 35 ? { ...x, l: 97 } : x))
    const r2 = signalVerlauf({ strategie: attrappe, candles: k2, params: {}, ltfMs: H, anzeigen: 50 })
    check('Docht in der Auslösekerze löst keinen Stop aus', r2.setups[0].ausgang === 'ziel')
}

console.log('\nIndikator-Einstellungen = Strategie-Vorgaben\n')
for (const [sid, liste] of [['lsob', LSOB_PARAMS], ['ema_touch', GUSS_PARAMS]]) {
    const st = getStrategy(sid)
    const vorgabe = Object.fromEntries(st.params.map((p) => [p.key, p]))
    for (const p of liste.filter((x) => x.strategie)) {
        const s = vorgabe[p.key]
        const gleich = s && s.default === p.vorgabe && (p.typ !== 'zahl' || (s.min === p.min && s.max === p.max))
            && (p.typ !== 'wahl' || JSON.stringify(s.options.map((o) => o.value)) === JSON.stringify(p.optionen))
        check(`${sid}.${p.key}: Vorgabe/Grenzen wie in der Strategie`, gleich, JSON.stringify({ chart: [p.vorgabe, p.min, p.max], strategie: s && [s.default, s.min, s.max] }))
    }
}


// ── Zonenende: erste Kerze, die in den Order Block sticht ──
{
    const k = (i, h, l) => ({ t: T0 + i * H, o: (h + l) / 2, h, l, c: (h + l) / 2, v: 1 })
    // Long-OB 99–100 bei Kerze 0; Impuls weg (1–3), Kerze 4 berührt 100,2 → nicht, Kerze 5 sticht auf 99,7
    const reihe = [k(0, 100, 99), k(1, 100.8, 99.9), k(2, 102, 101), k(3, 103, 102), k(4, 103, 100.2), k(5, 101, 99.7), k(6, 100, 98)]
    const ob = { direction: 'long', obHigh: 100, obLow: 99, obCandleTime: T0, watchFrom: T0 + 2 * H }
    check('Zone endet an der ersten Kerze, die hineinsticht', ersteBeruehrung(ob, reihe) === T0 + 5 * H)
    check('Gegenprobe: Kerzen vor watchFrom (Impuls) zählen nicht', ersteBeruehrung(ob, reihe) !== T0 + H)
    check('ohne watchFrom: erst NACH der OB-Kerze', ersteBeruehrung({ ...ob, watchFrom: undefined }, reihe) === T0 + H)
    const short = { direction: 'short', obHigh: 101, obLow: 100, obCandleTime: T0, watchFrom: T0 + H }
    const reiheS = [k(0, 101, 100), k(1, 99.5, 98), k(2, 99.9, 97), k(3, 100.1, 98)]
    check('Short: Docht von unten in die Zone', ersteBeruehrung(short, reiheS) === T0 + 3 * H)
    check('Gegenprobe: keine Berührung → null', ersteBeruehrung(short, reiheS.slice(0, 3)) === null)
    check('Gegenprobe: Zone ohne Grenzen → null', ersteBeruehrung({ ...ob, obHigh: null }, reihe) === null)
    check('Ende = früheres von Auslösung und Berührung', zonenEnde(T0 + 9 * H, T0 + 5 * H) === T0 + 5 * H && zonenEnde(T0 + 3 * H, T0 + 5 * H) === T0 + 3 * H)
    check('Ende offen, wenn weder noch', zonenEnde(null, null) === null && zonenEnde(undefined, T0) === T0)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
