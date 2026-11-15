/**
 * Aktien-Radar: Tageskennzahlen der echten Aktie und des Index holen.
 *
 * Stärke über 3, 6 und 12 Monate und der Abstand zum 52-Wochen-Hoch brauchen
 * ein Jahr Tageskurse — die Futures gibt es erst seit Monaten. Deshalb kommen
 * sie von der Kursquelle (Yahoo, hinter dem Quellen-Schalter):
 *
 *   1. gemerkt   der Newcomer-Radar rechnet dieselben Kennzahlen täglich für
 *                jeden Titel (`newcomer_titel.kennzahlen`) — ist sein Stand
 *                frisch, kostet der Lauf keinen Abruf;
 *   2. Abruf     sonst zwei Jahre Tageskerzen je Titel, nur für die Titel,
 *                die die Hürden genommen haben. Die übrigen Titel des
 *                Universums zählen mit ihrem gemerkten Stand zum Feld des
 *                Stärke-Rangs (`nurGemerkt`), kosten aber nie einen Abruf.
 *
 * Fällt die Quelle aus, läuft der Radar weiter: die Stärke bleibt dann
 * unbekannt und fällt aus der Note (`bewerteAktie`), der Grund steht im Lauf.
 */
import { holeChart, NichtGefunden, Gebremst } from '../newcomer-radar/kursquelle.js'
import { kursSymbolFuer } from '../newcomer-radar/kursquelle-kern.js'
import { kennzahlen } from '../newcomer-radar/kennzahlen.js'
import { istAus } from '../quellen/aus.js'
import { logWarn } from '../logger.js'

/** Index, gegen den die Stärke gemessen wird, und der Technologie-Index als zweite Angabe. */
export const INDEX = { haupt: 'SPY', zweit: 'QQQ' }
const FRISCH_MS = 48 * 60 * 60_000
const PAUSE_MS = 120
const warte = (ms) => new Promise((r) => setTimeout(r, ms))

const auszug = (k, quelle) => ({
    perf3m: k.perf3m ?? null, perf6m: k.perf6m ?? null, perf12m: k.perf12m ?? null,
    abstandHochPct: k.abstandHochPct ?? null, hoch52w: k.hoch52w ?? null, letzteKerze: k.letzteKerze ?? null,
    quelle,
})

/**
 * Stand des Newcomer-Radars je Instrument-ID: seine Zeile (für das Kurssymbol)
 * und seine Kennzahlen (nur frische, mit 12-Monats-Feld).
 */
async function gemerkte(knex, ids, jetzt) {
    const je = new Map(), zeilen = new Map()
    if (!ids.length || !(await knex.schema.hasTable('newcomer_titel'))) return { je, zeilen }
    for (const z of await knex('newcomer_titel').whereIn('instrumentId', ids).select('instrumentId', 'kursSymbol', 'kennzahlen', 'stand')) {
        zeilen.set(z.instrumentId, z)
        let k = null
        try { k = JSON.parse(z.kennzahlen || 'null') } catch { k = null }
        // Stände von vor der Einführung von `perf12m` zählen als veraltet.
        if (k && 'perf12m' in k && k.perf3m !== undefined && jetzt - Number(z.stand) < FRISCH_MS) je.set(z.instrumentId, k)
    }
    return { je, zeilen }
}

/**
 * @param {object} knex
 * @param {{symbol: string, id: number|null, ticker: string, region?: string|null, nurGemerkt?: boolean}[]} titel
 *        `nurGemerkt`: nur den Stand des Newcomer-Radars nutzen, nie abrufen
 * @param {(f: {fertig: number, gesamt: number}) => void} [melde]
 * @param {number} [jetzt]
 * @param {Function} [abruf]  nur der Selbsttest reicht eine Attrappe für `holeChart` herein
 * @returns {Promise<{je: Map<string, object>, index: object|null, grund: string|null, gemerkt: number, abgerufen: number,
 *           kursSymbole: Map<string, string|null>}>}  `kursSymbole`: je Future-Symbol das Symbol der Kursquelle,
 *           `null` = keines (Newcomer-Lauf fand nichts, fremde Region) — der Titel bleibt dann ohne Stärke
 */
export async function ladeTagesdaten(knex, titel, melde = () => { }, jetzt = Date.now(), abruf = holeChart) {
    const holeChart = abruf
    const aus = { je: new Map(), index: null, grund: null, gemerkt: 0, abgerufen: 0, kursSymbole: new Map() }
    if (!titel.length) return aus
    // Vor jedem Abruf: steht das Kurssymbol fest, kann es der Lauf auch dann nutzen, wenn der Index ausfällt.
    const { je: gemerkt, zeilen } = await gemerkte(knex, titel.map((t) => t.id).filter(Boolean), jetzt)
    for (const t of titel) aus.kursSymbole.set(t.symbol, kursSymbolFuer(t, (t.id && zeilen.get(t.id)) || null))
    try {
        const [haupt, zweit] = await Promise.all([holeChart(INDEX.haupt, jetzt), holeChart(INDEX.zweit, jetzt).catch(() => null)])
        aus.index = {
            [INDEX.haupt]: auszug(kennzahlen(haupt.kerzen, { jetzt }), 'abruf'),
            ...(zweit ? { [INDEX.zweit]: auszug(kennzahlen(zweit.kerzen, { jetzt }), 'abruf') } : {}),
        }
    } catch (e) {
        aus.grund = istAus(e) ? 'quelleAus' : e instanceof Gebremst ? 'gebremst' : 'indexFehlt'
        if (!istAus(e)) logWarn('coin-radar', `Index ${INDEX.haupt}: ${e.message}`)
        return aus
    }

    let fertig = 0
    // Bremst die Quelle oder ist sie aus, wird nicht mehr gefragt — gemerkte Stände zählen weiter (Feld des Stärke-Rangs).
    let ohneAbruf = false
    for (const t of titel) {
        fertig++
        const kursSymbol = aus.kursSymbole.get(t.symbol)
        // Gemerkte Kennzahlen gelten nur, wenn auch ihr Kurssymbol noch gilt (sonst sind es die einer fremden Firma).
        const k = t.id && kursSymbol && kursSymbol === zeilen.get(t.id)?.kursSymbol ? gemerkt.get(t.id) : null
        if (k) { aus.je.set(t.symbol, auszug(k, 'gemerkt')); aus.gemerkt++; continue }
        // Titel unter den Hürden weiten nur das Feld für den Stärke-Rang (FACH-H-013): für sie kein Abruf.
        if (!kursSymbol || t.nurGemerkt || ohneAbruf) continue
        try {
            const chart = await holeChart(kursSymbol, jetzt)
            aus.je.set(t.symbol, auszug(kennzahlen(chart.kerzen, { jetzt, ipoDatum: chart.meta.ipoDatum }), 'abruf'))
            aus.abgerufen++
        } catch (e) {
            // Bremst die Quelle, hört der Lauf auf zu fragen — was schon da ist, bleibt.
            if (e instanceof Gebremst) { aus.grund = 'gebremst'; ohneAbruf = true; continue }
            if (istAus(e)) { aus.grund = 'quelleAus'; ohneAbruf = true; continue }
            if (!(e instanceof NichtGefunden)) logWarn('coin-radar', `Tagesdaten ${kursSymbol}: ${e.message}`)
        }
        if (fertig % 10 === 0) melde({ fertig, gesamt: titel.length })
        await warte(PAUSE_MS)
    }
    melde({ fertig: titel.length, gesamt: titel.length })
    return aus
}
