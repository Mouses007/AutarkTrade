/**
 * Selbsttest der Ausstiegs-Prüfung (`server/ausstiege.js`).
 *
 *   node server/__selftest-ausstiege.mjs
 *
 * Die wichtigste Prüfung zuerst: Die Zelle, die genau den Ausstiegen der
 * Strategie entspricht (Stop 1×, ihr Ziel, ihr Zeitausstieg), muss jeden
 * Trade auf dasselbe R bringen wie der Backtest. Weicht sie ab, misst die
 * Prüfung einen anderen Markt als der Lauf, den sie beurteilen soll — und
 * jede „bessere" Zelle wäre ein Rechenfehler statt eines Befunds.
 */

import { runBacktest } from './strategy-backtest.js'
import { fundingAusVerlauf } from './execution/zwischenstand.js'
import { kostenAus } from './fill-simulator.js'
import {
    ausstiegsRaster, spieleEinzeln, fundingRechner, waehleZone, kennzahlen, kerzeBei,
    STOP_FAKTOREN, ZIELE_R, HALTEN,
} from './ausstiege.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}
const nah = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b))

const H = 3600000
const T0 = Date.UTC(2026, 0, 1)

console.log('\nAusstiegs-Prüfung — Selbsttest\n')

// ── Hand-Fälle: eine Zelle, ein Trade ────────────────────────────────────
console.log('Einzelfälle')
{
    // Long bei 100, Stop 99 (1 R = 1), ohne Kosten.
    const kerze = (i, o, h, l, c) => ({ t: T0 + i * H, o, h, l, c, v: 1 })
    const flach = (i) => kerze(i, 100, 100.2, 99.8, 100)
    const trade = (art, extra = {}) => ({
        direction: 'long', entryPrice: 100, stopLoss: 99, entryTime: T0, leverage: 1,
        einstiegsArt: art, einstiegsGebuehrBps: 0, exitReason: 'tp', rMultiple: 0, ...extra,
    })
    const o = { kerzeMs: H, costs: { feeMakerBps: 0, feeTakerBps: 0, slippageBps: 0 }, wartungsmargePct: 0.5 }
    const R = (art, kerzen, zelle, extra) => spieleEinzeln(trade(art, extra), kerzen, zelle, o)?.r

    const ziel = [kerze(0, 100.5, 101, 99.5, 100.5), kerze(1, 100.5, 102.5, 99.8, 102)]
    check('Ziel 2 R in der Folgekerze → +2 R', nah(R('kerze', ziel, { zielR: 2, halten: 8 }), 2))

    const beides = [kerze(0, 100.5, 101, 99.5, 100.5), kerze(1, 100.5, 102.5, 98.5, 101)]
    check('Stop und Ziel in derselben Kerze → der Stop zählt (−1 R)', nah(R('kerze', beides, { zielR: 2, halten: 8 }), -1))

    const luecke = [kerze(0, 100.5, 101, 99.5, 100.5), kerze(1, 98, 98.5, 97.5, 98)]
    check('Eröffnung unter dem Stop → Ausstieg zur Eröffnung (−2 R)', nah(R('kerze', luecke, { zielR: 2, halten: 8 }), -2))

    const sofort = [kerze(0, 100.5, 101, 98.9, 100.5), flach(1), flach(2)]
    check('Limit-Einstieg: Stop in der Einstiegskerze ist ein Verlust', nah(R('kerze', sofort, { zielR: 2, halten: 8 }), -1))

    const frueh = [kerze(0, 100, 103, 99.8, 100), flach(1), flach(2), flach(3)]
    check('Limit-Einstieg: Ziel in der Einstiegskerze zählt nicht (Reihenfolge unbekannt)',
        nah(R('kerze', frueh, { zielR: 2, halten: 2 }), 0))
    check('Einstieg zur Eröffnung: dieselbe Kerze zählt ganz (+2 R)',
        nah(R('eroeffnung', frueh, { zielR: 2, halten: 2 }), 2))

    check('Stop 2×: derselbe Docht stoppt nicht mehr aus',
        nah(R('kerze', [...beides, flach(2), flach(3)], { faktor: 2, zielR: 2, halten: 3 }), 0))
    // Mit Stop 2× ist 1 R = 2: der Docht auf 98,5 bleibt drin, Zeitausstieg
    // nach 3 Kerzen zum Schluss 100 → 0 R.

    const zeit = [kerze(0, 100, 100.5, 99.5, 100), kerze(1, 100, 100.6, 99.6, 100.4), kerze(2, 100.4, 100.9, 100.2, 100.8)]
    check('Zeitausstieg zum Schluss der Kerze, mit der die Haltedauer erreicht ist',
        nah(R('kerze', zeit, { zielR: 0, halten: 2 }), 0.4), String(R('kerze', zeit, { zielR: 0, halten: 2 })))
    // Schluss-Einstieg: entryTime ist der Beginn der Folgekerze, ab da zählt sie ganz.
    const schluss = [kerze(0, 100, 100.5, 99.5, 100), kerze(1, 100, 100.2, 98.8, 99.5), flach(2)]
    check('Schluss-Einstieg: die Folgekerze zählt ganz (Stop dort → −1 R)',
        nah(spieleEinzeln(trade('schluss', { entryTime: T0 + H }), schluss, { zielR: 2, halten: 4 }, o).r, -1))

    const gebuehr = { ...o, costs: { feeMakerBps: 2, feeTakerBps: 5, slippageBps: 0 } }
    const mitGebuehr = spieleEinzeln(trade('kerze', { einstiegsGebuehrBps: 2 }), beides, { zielR: 2, halten: 8 }, gebuehr).r
    check('Gebühren gehen in R ein (Einstieg 2 bps, Stop als Taker 5 bps)',
        nah(mitGebuehr, -1 - (100 * 2 / 10000 + 99 * 5 / 10000) / 1), String(mitGebuehr))

    const fehlt = spieleEinzeln(trade('kerze', { entryTime: T0 + 99 * H }), ziel, { zielR: 2, halten: 8 }, o)
    check('fehlt die Einstiegskerze, gibt es kein Ergebnis statt einer Zahl', fehlt === null)
    check('unbekannte Einstiegsart wird nicht gespielt',
        spieleEinzeln(trade(undefined), ziel, { zielR: 2, halten: 8 }, o) === null)
    check('kerzeBei findet die Kerze per Startzeit', kerzeBei(zeit, T0 + 2 * H) === 2 && kerzeBei(zeit, T0 + 5) === -1)
}

// ── Funding über Präfixsummen ───────────────────────────────────────────
console.log('\nFunding')
{
    let saat = 11
    const rnd = () => (saat = (saat * 16807) % 2147483647) / 2147483647
    const verlauf = Array.from({ length: 300 }, (_, i) => ({
        t: T0 + i * 8 * H,
        rate: (rnd() - 0.4) * 0.0004,
        markPrice: rnd() < 0.2 ? 0 : 90 + rnd() * 20,
    }))
    const rechner = fundingRechner(verlauf)
    let gleich = true
    let detail = ''
    for (let k = 0; k < 400; k++) {
        const von = T0 + Math.floor(rnd() * 2400) * H
        const bis = von + Math.floor(rnd() * 400) * H
        const dir = rnd() < 0.5 ? 'long' : 'short'
        const ersatz = 95 + rnd() * 10
        const a = fundingAusVerlauf(verlauf, { qty: 1, direction: dir, entryTime: von, bis, ersatzPreis: ersatz })
        const b = rechner(dir, von, bis, ersatz)
        if (!nah(a, b, 1e-9)) { gleich = false; detail = `${a} gegen ${b}`; break }
    }
    check('Präfixsumme = fundingAusVerlauf (400 Zufallsfenster, mit und ohne Mark-Preis)', gleich, detail)
    check('Abrechnung genau zum Einstieg zählt nicht, genau zum Ausstieg schon',
        nah(rechner('long', T0, T0 + 8 * H, 100), fundingAusVerlauf(verlauf, { qty: 1, direction: 'long', entryTime: T0, bis: T0 + 8 * H, ersatzPreis: 100 })))
    check('leerer Verlauf → 0', fundingRechner([])('long', T0, T0 + 1e9, 100) === 0)
}

// ── Zone statt Spitze ────────────────────────────────────────────────────
console.log('\nAuswahl')
{
    // 5 × 5 × 1: eine Spitze in der Ecke zwischen Abstürzen, ein Plateau unten rechts.
    const w = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => [-0.5]))
    w[0][0][0] = 3; w[0][1][0] = -2; w[1][0][0] = -2; w[1][1][0] = -2
    for (let s = 2; s < 5; s++) for (let z = 2; z < 5; z++) w[s][z][0] = 0.6
    w[3][3][0] = 0.8
    const zone = waehleZone(w)
    check('die Zone schlägt die einzelne Spitze', zone.s >= 2 && zone.z >= 2, JSON.stringify(zone))
    // Am Rand hat eine Zelle weniger Nachbarn — gemittelt wird über die, die es gibt.
    const nb = []
    for (let a = zone.s - 1; a <= zone.s + 1; a++) for (let b = zone.z - 1; b <= zone.z + 1; b++) {
        if (a >= 0 && a < 5 && b >= 0 && b < 5) nb.push(w[a][b][0])
    }
    check('Zonenwert ist das Mittel der vorhandenen Nachbarschaft',
        nah(zone.zonenwert, nb.reduce((x, y) => x + y, 0) / nb.length), `${zone.zonenwert} gegen ${nb}`)

    const k = kennzahlen([1, -1, -1, 2, -1])
    check('Kennzahlen: Mittel, Treffer, Summe, Rückgang', nah(k.mittel, 0) && nah(k.treffer, 40) && nah(k.summe, 0) && nah(k.dd, 2),
        JSON.stringify(k))
    check('leere Reihe ergibt kein Mittel statt 0', kennzahlen([]).mittel === null)
}

// ── Gegen den echten Backtest ────────────────────────────────────────────
console.log('\nDieselben Zahlen wie der Backtest')
{
    // Zufallsweg, 3000 Stunden. Alle 20 Kerzen ein Setup, abwechselnd als
    // Limit mitten in der Kerze, zur Eröffnung (Markt) und zum Schluss.
    let saat = 5
    const rnd = () => (saat = (saat * 16807) % 2147483647) / 2147483647
    const kerzen = []
    let preis = 100
    for (let i = 0; i < 3000; i++) {
        const o = preis
        const c = o * (1 + (rnd() - 0.5) * 0.012)
        const h = Math.max(o, c) * (1 + rnd() * 0.004)
        const l = Math.min(o, c) * (1 - rnd() * 0.004)
        kerzen.push({ t: T0 + i * H, o, h, l, c, v: 1 })
        preis = c
    }
    const verlauf = Array.from({ length: 1100 }, (_, i) => ({ t: T0 + i * 8 * H, rate: (rnd() - 0.3) * 0.0003, markPrice: 0 }))
    const ARTEN = ['kerze', 'eroeffnung', 'schluss']
    const manifest = {
        id: 'ausstieg_test', name: 'Ausstieg-Test', params: [], supportedTimeframes: ['1h'], warmupCandles: 20,
        regeln: { maxHoldCandles: 16, breakEvenAtR: 0 },
        detect({ candles: sicht, openSetups }) {
            const jetzt = sicht[sicht.length - 1]
            const idx = Math.round((jetzt.t - T0) / H)
            const events = []
            for (const s of openSetups) {
                if (idx !== s._ausloeser) continue
                const long = s.direction === 'long'
                const ev = { id: s.id, status: 'triggered', candleTime: jetzt.t, triggeredAt: jetzt.t }
                let entry
                if (s._art === 'kerze') entry = s.entry
                else if (s._art === 'eroeffnung') { entry = jetzt.o; ev.entryAtOpen = true }
                else { entry = jetzt.c; ev.entryAtClose = true }
                const risiko = entry * 0.01
                ev.entry = entry
                ev.stopLoss = long ? entry - risiko : entry + risiko
                ev.takeProfit = long ? entry + 2 * risiko : entry - 2 * risiko
                events.push(ev)
            }
            const setups = []
            if (idx >= 40 && (idx - 40) % 20 === 0) {
                const n = (idx - 40) / 20
                const art = ARTEN[n % 3]
                const long = n % 2 === 0
                // Limit leicht gegen die Richtung — wird nicht immer berührt.
                const entry = long ? jetzt.c * 0.999 : jetzt.c * 1.001
                setups.push({
                    direction: long ? 'long' : 'short', entry,
                    stopLoss: long ? entry * 0.99 : entry * 1.01, takeProfit: long ? entry * 1.02 : entry * 0.98,
                    obCandleTime: jetzt.t, _ausloeser: idx + 1, _art: art,
                    ...(art === 'eroeffnung' ? { entryTrigger: 'market' } : {}),
                })
            }
            return { setups, events, diagnostics: {} }
        },
    }
    const lauf = async (slippageBps) => runBacktest({
        strategyId: 'ausstieg_test', strategie: manifest, symbol: 'TESTUSDT', timeframe: '1h', market: 'futures',
        risk: {
            riskPerTradePct: 1, maxNotionalUsdt: 100000, leverage: 5, minRR: 1, maintenanceMarginPct: 0.5,
            cooldownMinutes: 0, feeMakerBps: 2, feeTakerBps: 5, slippageBps,
        },
        startEquity: 10000, candles: kerzen, marketMeta: {}, fundingVerlauf: verlauf, fromTs: T0, toTs: T0 + 3000 * H,
    })

    const ohneSchlupf = await lauf(0)
    const rechner = fundingRechner(verlauf)
    const opts = {
        kerzeMs: H, costs: kostenAus(ohneSchlupf.meta.risk), wartungsmargePct: ohneSchlupf.stats.wartungsmargePct,
        funding: (pos, bis) => rechner(pos.direction, pos.entryTime, bis, pos.entryPrice),
    }
    const fertig = ohneSchlupf.trades.filter((t) => t.exitReason !== 'open_at_end')
    const jeArt = Object.fromEntries(ARTEN.map((a) => [a, fertig.filter((t) => t.einstiegsArt === a).length]))
    check('der Lauf hat Trades aller drei Einstiegsarten', ARTEN.every((a) => jeArt[a] >= 5), JSON.stringify(jeArt))
    check('Trades tragen den bezahlten Einstiegssatz (Limit 2 bps, Markt 5 bps)',
        fertig.every((t) => nah(t.einstiegsGebuehrBps, t.einstiegsArt === 'eroeffnung' ? 5 : 2, 1e-9)),
        JSON.stringify(fertig.slice(0, 3).map((t) => [t.einstiegsArt, t.einstiegsGebuehrBps])))
    const gruende = new Set(fertig.map((t) => t.exitReason))
    check('Stop, Ziel und Zeitausstieg kommen vor', ['sl', 'tp', 'timeout'].every((g) => gruende.has(g)), [...gruende].join(','))

    let abweichung = null
    for (const t of fertig) {
        const r = spieleEinzeln(t, kerzen, { faktor: 1, zielR: 2, halten: 16 }, opts)?.r
        if (r === undefined || !nah(r, t.rMultiple, 1e-7)) { abweichung = `${t.einstiegsArt} ${t.exitReason}: ${r} gegen ${t.rMultiple}`; break }
    }
    check(`Stop 1× · Ziel 2 R · 16 Kerzen = Backtest, Trade für Trade (${fertig.length} Trades, mit Gebühren und Funding)`,
        abweichung === null, abweichung)

    const mitSchlupf = await lauf(3)
    const limits = mitSchlupf.trades.filter((t) => t.exitReason !== 'open_at_end' && t.einstiegsArt !== 'eroeffnung')
    const optsS = { ...opts, costs: kostenAus(mitSchlupf.meta.risk) }
    let abwS = null
    for (const t of limits) {
        const r = spieleEinzeln(t, kerzen, { faktor: 1, zielR: 2, halten: 16 }, optsS)?.r
        if (r === undefined || !nah(r, t.rMultiple, 1e-7)) { abwS = `${t.einstiegsArt} ${t.exitReason}: ${r} gegen ${t.rMultiple}`; break }
    }
    check(`mit Slippage: Limit- und Schluss-Einstiege weiter gleich (${limits.length} Trades)`, abwS === null, abwS)

    // Das ganze Raster
    const e = await ausstiegsRaster(ohneSchlupf.trades, kerzen, opts)
    check('Raster hat Stops × Ziele × Haltedauern Zellen',
        e.zellen.length === STOP_FAKTOREN.length * ZIELE_R.length * HALTEN.length, String(e.zellen.length))
    check('gespielt werden alle abgeschlossenen Trades', e.trades.gespielt === fertig.length, `${e.trades.gespielt} von ${fertig.length}`)
    check('Auswahl 70 %, Prüfung 30 %', e.trades.auswahl === Math.round(fertig.length * 0.7)
        && e.trades.auswahl + e.trades.pruefung === e.trades.gespielt)
    const s1 = STOP_FAKTOREN.indexOf(1); const z2 = ZIELE_R.indexOf(2); const h16 = HALTEN.indexOf(16)
    const eigene = e.zellen.find((c) => c.s === s1 && c.z === z2 && c.h === h16)
    check('die Zelle der Strategie trifft die eigenen Ausstiege auch in der Summe',
        nah(eigene.alle.summe, e.original.alle.summe, 1e-3) && eigene.alle.treffer === e.original.alle.treffer,
        `${eigene.alle.summe} gegen ${e.original.alle.summe}`)
    check('eine Zone ist gewählt, mit Vergleich auf dem Prüfteil',
        e.gewaehlt && Number.isFinite(e.gewaehlt.zonenwert) && e.gewaehlt.vergleich.besser + e.gewaehlt.vergleich.schlechter <= e.trades.pruefung)
    check('Urteil ist einer der bekannten Werte', ['zuWenig', 'besser', 'nichtGesichert', 'keinVorteil'].includes(e.urteil), e.urteil)
    // Ein Zufallsweg hat keine Kante — kein Ausstieg darf ihm eine gesichert andichten.
    check('auf einem Zufallsweg kein gesicherter Vorteil', e.urteil !== 'besser', `${e.urteil} p=${e.gewaehlt?.vergleich.p}`)

    const wenige = await ausstiegsRaster(ohneSchlupf.trades.slice(0, 20), kerzen, opts)
    check('unter 30 Trades: Urteil „zu wenig"', wenige.urteil === 'zuWenig', wenige.urteil)
    const leer = await ausstiegsRaster([], kerzen, opts)
    check('ohne Trades kippt nichts um', leer.trades.gespielt === 0 && leer.gewaehlt === null && leer.urteil === 'zuWenig')

}

console.log(`\nausstiege: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) {
    console.log('Fehlgeschlagen:', fehler.join(' | '))
    process.exit(1)
}
