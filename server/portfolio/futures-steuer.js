/**
 * Spot-Portfolio: Futures im Steuerjahr (I/O um `futures-rechnung.js`).
 *
 * Steuerlich (Privatvermögen): Gewinne aus Futures sind Kapitalgewinne und
 * steuerfrei, Verluste nicht abziehbar. Das Guthaben auf der Futures-Börse am
 * 31.12. ist Vermögen. Futures-Handel ist zugleich ein Indiz für
 * gewerbsmässigen Handel (KS 36, Derivate), und sein Volumen zählt beim
 * Kriterium Transaktionsvolumen mit.
 *
 * USDT wird als USD genommen und mit dem EZB-Kurs des Tages (Ergebnis,
 * Volumen) bzw. des Stichtags (Guthaben) in CHF umgerechnet.
 */
import { getKnex } from '../database.js'
import { fxAm } from './kurse.js'
import { futuresKonten } from './bilanz.js'
import { flacheTrades, futuresJahr, nettoNach, stichtagSaldo } from './futures-rechnung.js'

const NAME = { bitunix: 'Bitunix', bitget: 'Bitget', pionex: 'Pionex' }
let kontenSpeicher = null

async function kontenHeute() {
    if (kontenSpeicher && Date.now() - kontenSpeicher.zeit < 120e3) return kontenSpeicher.wert
    const m = new Map()
    for (const f of await futuresKonten()) m.set(f.boerse, { usd: f.usd, fehler: f.fehler })
    kontenSpeicher = { zeit: Date.now(), wert: m }
    return m
}

async function manuelleWerte(jahr) {
    try {
        const s = await getKnex()('settings').first('portfolioFuturesStichtag')
        const alle = JSON.parse(s?.portfolioFuturesStichtag || '{}')
        return alle[String(jahr)] || {}
    } catch { return {} }
}

export async function setzeFuturesStichtag(jahr, boerse, usd, quelle) {
    const k = getKnex()
    const s = await k('settings').first('id', 'portfolioFuturesStichtag')
    let alle = {}
    try { alle = JSON.parse(s?.portfolioFuturesStichtag || '{}') } catch { alle = {} }
    const j = (alle[String(jahr)] ??= {})
    if (usd == null || usd === '') delete j[boerse]
    else j[boerse] = { usd: Number(usd), quelle: quelle || 'Auszug' }
    if (!Object.keys(j).length) delete alle[String(jahr)]
    await k('settings').where({ id: s.id }).update({ portfolioFuturesStichtag: JSON.stringify(alle) })
}

/**
 * @returns {{ boersen, summe, guthaben, guthabenChf, volumenChf, n, hatTrades }}
 */
export async function futuresSteuerjahr(jahr, { von, bis, laufend }) {
    const zeilen = await getKnex()('trades').select('trades')
    const trades = flacheTrades(zeilen)
    const jahrDaten = futuresJahr(trades, { von, bis })
    const fx = new Map()
    const usdChf = async (d) => {
        if (!fx.has(d)) fx.set(d, await fxAm(d, 'CHF'))
        return fx.get(d)
    }
    const boersen = []
    for (const e of jahrDaten) {
        let nettoChf = 0, volumenChf = 0, ohneKurs = 0
        for (const [d, t] of e.tage) {
            const k = await usdChf(d)
            if (!k) { ohneKurs++; continue }
            nettoChf += t.netto * k
            volumenChf += t.volumen * k
        }
        const { tage, ...rest } = e
        boersen.push({ ...rest, name: NAME[e.boerse] || e.boerse, nettoChf, volumenChf, ohneKurs })
    }
    // Guthaben am Stichtag — im laufenden Jahr ist „Stichtag" heute.
    const heute = await kontenHeute()
    const nach = laufend ? new Map() : nettoNach(trades, bis)
    const stichtagKurs = await usdChf(laufend ? new Date(Date.now() - 86400e3).toISOString().slice(0, 10) : `${jahr}-12-31`)
    const ersterTrade = trades.length ? Math.min(...trades.map((x) => Number(x.exitTime) * 1000)) : null
    const vorJournal = !laufend && (ersterTrade == null || bis < ersterTrade)
    const guthaben = stichtagSaldo(heute, nach, await manuelleWerte(jahr), { vorJournal })
        .filter((g) => heute.has(g.boerse) || g.sicherheit === 'beleg' || jahrDaten.some((e) => e.boerse === g.boerse))
        .map((g) => ({ ...g, name: NAME[g.boerse] || g.boerse, chf: g.usd != null && stichtagKurs ? g.usd * stichtagKurs : null, fehler: heute.get(g.boerse)?.fehler }))
    const summe = boersen.reduce((s, b) => ({
        n: s.n + b.n, nettoChf: s.nettoChf + b.nettoChf, volumenChf: s.volumenChf + b.volumenChf,
        gebuehrUsd: s.gebuehrUsd + b.gebuehrUsd, fundingUsd: s.fundingUsd + b.fundingUsd,
    }), { n: 0, nettoChf: 0, volumenChf: 0, gebuehrUsd: 0, fundingUsd: 0 })
    return {
        boersen, summe, guthaben,
        guthabenChf: guthaben.reduce((s, g) => s + (g.chf || 0), 0),
        stichtagKurs,
        ersterTrade, vorJournal,
    }
}
