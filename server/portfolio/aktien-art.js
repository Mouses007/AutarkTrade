/**
 * Aktien und ETFs im Spot-Portfolio (Bitpanda) — als eigene Art, nicht als Coin.
 *
 * Warum: Das Portfolio bewertet jeden Bestand über sein Kürzel (`${asset}USDT`
 * im Spot-Ticker). Für eine Aktie ist das falsch — es gibt kein solches Paar,
 * und heisst zufällig ein Coin gleich, bekäme die Aktie dessen Kurs.
 *
 * Erkannt wird eine Aktie auf zwei Wegen (ODER), nie über das Kürzel allein:
 *   1. Bitpanda nennt die Gruppe am Asset (`group`/`type`: stock, etf).
 *   2. Die Asset-Kennung steht im Titel-Stamm als Bitpanda-Listung
 *      (`instrument_listungen.symbol` = `pid` der öffentlichen Asset-Liste).
 * Was keiner der beiden Wege kennt, bleibt wie bisher ein Coin.
 *
 * Bewertet wird eine Aktien-Zeile so:
 *   1. Bitpandas eigene Bewertung der Position (`currency_balance`) — der
 *      Kurs des Produkts, das dort wirklich liegt.
 *   2. Sonst der Aktien-Future des Titels aus dem Stamm (Kurs der
 *      Marktdatenquelle in USDT, als Näherung gekennzeichnet).
 *   3. Sonst kein Kurs. NIE `${asset}USDT`.
 *
 * Nicht Teil dieses Moduls: Dividenden, Steuerbericht, ESTV-Kursliste.
 */
import * as marktdaten from '../marktdaten/index.js'

export const KLASSEN = ['aktie', 'etf']

const GRUPPE = { stock: 'aktie', stocks: 'aktie', equity: 'aktie', share: 'aktie', etf: 'etf', etfs: 'etf' }

/** Art aus einem Asset-Eintrag von Bitpanda (`group`, `type` …); unbekannt → null. Rein. */
export function klasseAusAsset(a) {
    for (const feld of ['group', 'asset_group', 'type', 'asset_type', 'category']) {
        const k = GRUPPE[String(a?.[feld] ?? '').trim().toLowerCase()]
        if (k) return k
    }
    return null
}

/**
 * Art über den Titel-Stamm: Kennung (`id` oder `pid`) gegen die Bitpanda-Listungen. Rein.
 * @param {Map<string, {ticker: string, unterart: string}>} stamm
 */
export function klasseAusStamm(stamm, ...kennungen) {
    for (const k of kennungen) {
        const e = k != null ? stamm?.get(String(k)) : null
        if (e && KLASSEN.includes(e.unterart)) return e.unterart
    }
    return null
}

/** Bitpanda-Listungen des Stamms: Kennung → `{ticker, unterart}`. Ohne Stamm leer. */
export async function ladeBitpandaStamm(knex) {
    const aus = new Map()
    try {
        if (!(await knex.schema.hasTable('instrument_listungen'))) return aus
        const zeilen = await knex('instrument_listungen as l').join('instrumente as i', 'i.id', 'l.instrumentId')
            .where({ 'l.handelsplatz': 'bitpanda', 'i.anlageklasse': 'aktien' }).whereIn('i.unterart', KLASSEN)
            .select('l.symbol', 'i.ticker', 'i.unterart')
        for (const z of zeilen) aus.set(String(z.symbol), { ticker: z.ticker, unterart: z.unterart })
    } catch { /* Stamm nicht lesbar → nur Bitpandas eigene Angabe zählt */ }
    return aus
}

/**
 * Kurs einer Aktien-Zeile des Bestands. Rein.
 * @param {{asset: string, kursUsd?: number}} b
 * @param {Map<string, {usd: number, quelle: string}>} [stammKurse]  Ticker → Kurs des Aktien-Futures
 */
export function aktienZeilenKurs(b, stammKurse) {
    if (Number(b?.kursUsd) > 0) return { usd: Number(b.kursUsd), quelle: 'Bewertung Bitpanda' }
    const s = stammKurse?.get(String(b?.asset || '').toUpperCase())
    if (s && Number(s.usd) > 0) return { usd: Number(s.usd), quelle: s.quelle }
    return { usd: null, quelle: 'kein Kurs (Aktie)' }
}

/**
 * Kurse der Aktien-Futures zu einer Liste von Tickern, über den Stamm:
 * Ticker → Future-Symbol der Marktdatenquelle → letzter Preis in USDT.
 * Nur für Zeilen, die Bitpanda nicht selbst bewertet. Fehlt etwas, fehlt der Eintrag.
 */
export async function stammKurseUsd(knex, tickers) {
    const aus = new Map()
    const liste = [...new Set((tickers || []).map((t) => String(t).toUpperCase()))]
    if (!liste.length) return aus
    try {
        const quelle = (await marktdaten.fordere('ticker', { markt: 'futures' })).id
        const zeilen = await knex('instrument_listungen as l').join('instrumente as i', 'i.id', 'l.instrumentId')
            .where({ 'l.art': 'perp', 'l.aktiv': 1, 'l.handelsplatz': quelle, 'i.anlageklasse': 'aktien' }).whereIn('i.ticker', liste)
            .select('i.ticker', 'l.symbol')
        if (!zeilen.length) return aus
        const preise = await marktdaten.preise({ markt: 'futures' })
        for (const z of zeilen) {
            const p = preise.get(String(z.symbol).toUpperCase())
            if (Number.isFinite(p) && p > 0) aus.set(z.ticker, { usd: p, quelle: `Aktien-Future ${z.symbol} (≈)` })
        }
    } catch { /* Marktdaten aus oder Stamm fehlt → kein Ersatzkurs */ }
    return aus
}

/** Kürzel der Aktien/ETFs, die der letzte Bitpanda-Abruf gemeldet hat (`portfolio_quellen.stand.aktien`). */
export async function bitpandaAktienKuerzel(knex) {
    try {
        const z = await knex('portfolio_quellen').where('quelle', 'bitpanda').first()
        const a = JSON.parse(z?.stand || '{}').aktien
        return new Set(Object.keys(a && typeof a === 'object' ? a : {}).map((s) => s.toUpperCase()))
    } catch { return new Set() }
}
