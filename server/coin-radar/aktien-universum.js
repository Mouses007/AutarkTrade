/**
 * Aktien-Radar: Universum und Referenz.
 *
 * Der Aktien-Radar ist der Coin-Radar mit einem anderen Feld. Was der Coin-Radar
 * aus «auf Bitunix handelbar UND bei Binance messbar» bildet, kommt hier aus
 * dem Titel-Stamm (`server/aktien/stamm-speicher.js`): alle Aktien-Futures, die
 * die gewählte Marktdatenquelle selbst führt — denn nur für die gibt es dort
 * Ticker, Orderbuch-Spitze und Kerzen. «Handelbar bei» sind danach ALLE
 * Listungen des Titels, auch Spot-Token und Bitpanda.
 *
 * Rein bis auf `ladeAktienUniversum` (liest die Datenbank, kein Netz).
 */

import { leseStamm } from '../aktien/stamm-speicher.js'

/**
 * Index-ETFs, an denen die Kopplung gemessen wird — Gegenstück zu BTCUSDT.
 * Der erste, den die Quelle als Future führt, gewinnt.
 */
export const REFERENZ_TICKER = ['SPY', 'QQQ', 'IVV', 'VOO']

/**
 * Titel des Stamms → Universum der Quelle.
 *
 * @param {object[]} titel   Ergebnis von `leseStamm` (Anlageklasse aktien)
 * @param {string} quelle    'binance' | 'bitget'
 * @returns {Map<string, {ticker: string, name: string|null, unterart: string, listungen: object[]}>}
 *          Schlüssel ist das Future-Symbol AN DER QUELLE (z. B. `ACNSTOCKUSDT` bei Bitget).
 */
export function universumAus(titel = [], quelle) {
    const map = new Map()
    for (const t of titel) {
        const eigene = (t.listungen || []).filter((l) => l.handelsplatz === quelle && l.art === 'perp')
        for (const l of eigene) {
            // Nur USDT-Kontrakte: der marktweite Ticker und die Hürden rechnen in USDT.
            if (l.quote && l.quote !== 'USDT') continue
            map.set(l.symbol, { id: t.id ?? null, ticker: t.ticker, name: t.name || null, unterart: t.unterart, listungen: t.listungen })
        }
    }
    return map
}

/** Das Symbol des Referenz-Index im Universum, oder `null`. */
export function waehleReferenz(universum) {
    for (const ticker of REFERENZ_TICKER) {
        for (const [symbol, t] of universum) if (t.ticker === ticker) return { symbol, ticker }
    }
    return null
}

/**
 * «Handelbar bei» in der Form, die der Coin-Radar in `boersen` ablegt:
 * `liste` für die Anzeige, dazu die Stammdaten des Titels.
 */
export function boersenFelder(t) {
    if (!t) return {}
    return {
        ticker: t.ticker,
        name: t.name,
        unterart: t.unterart,
        liste: (t.listungen || []).map((l) => ({ boerse: l.handelsplatz, art: l.art, symbol: l.symbol })),
    }
}

export async function ladeAktienUniversum(knex, quelle) {
    const titel = await leseStamm(knex, { anlageklasse: 'aktien', handelsplatz: quelle, art: 'perp', grenze: 5000 })
    return universumAus(titel, quelle)
}
