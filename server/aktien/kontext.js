/**
 * Ist dieses Symbol ein Aktien-Future — und was muss die Simulation dann wissen?
 *
 * Die Strategie-Schicht prüft Symbole nur der Form nach; `NVDAUSDT` läuft
 * durch Backtest und Papierbetrieb wie ein Coin. Diese Auskunft macht den
 * Unterschied sichtbar: Ticker, Börse (für die Stichtage in
 * `shared/aktien-sitzung.js`) und die Splits des Titels (für
 * `splits.js` — die Kerzen der Futures sind nicht split-bereinigt).
 *
 * `null` heisst Krypto, und zwar auch dann, wenn die Frage nicht zu
 * beantworten ist (keine Datenbank im Selbsttest, leerer Stamm): die
 * Simulation verhält sich dann wie vor der Aktien-Integration.
 */
import { getKnex } from '../database.js'
import * as marktdaten from '../marktdaten/index.js'
import { holeSplits } from '../newcomer-radar/kursquelle.js'
import { kursSymbolKandidaten } from '../newcomer-radar/kursquelle-kern.js'
import { istAus } from '../quellen/aus.js'
import { CHART_BOERSEN } from './chart-symbole.js'

const KONTEXT_MS = 10 * 60_000
const SPLITS_MS = 12 * 60 * 60_000
const kontextCache = new Map()   // symbol → { zeit, wert }
const splitsCache = new Map()    // kursSymbol → { zeit, splits, grund }

async function ladeSplits(kursSymbol) {
    if (!kursSymbol) return { splits: null, grund: 'keinKursSymbol' }
    const c = splitsCache.get(kursSymbol)
    if (c && Date.now() - c.zeit < (c.splits ? SPLITS_MS : 5 * 60_000)) return c
    let wert
    try {
        wert = { splits: await holeSplits(kursSymbol), grund: null }
    } catch (e) {
        wert = { splits: null, grund: istAus(e) ? 'quelleAus' : 'abrufFehlgeschlagen' }
    }
    splitsCache.set(kursSymbol, { zeit: Date.now(), ...wert })
    return wert
}

async function baue(symbol) {
    const knex = getKnex()
    let boerse = null
    try { boerse = (await marktdaten.fordere('kerzen', { markt: 'futures' })).id } catch { /* Marktdaten aus */ }
    // Dasselbe Symbol kann an zwei Börsen Verschiedenes heissen — die Marktdatenquelle gewinnt.
    const zeilen = await knex('instrument_listungen as l').join('instrumente as i', 'i.id', 'l.instrumentId')
        .where({ 'l.symbol': symbol, 'l.art': 'perp', 'l.aktiv': 1, 'i.anlageklasse': 'aktien' })
        .whereIn('l.handelsplatz', CHART_BOERSEN)
        .select('i.id', 'i.ticker', 'i.name', 'i.unterart', 'l.handelsplatz')
    const zeile = zeilen.find((z) => z.handelsplatz === boerse) || zeilen[0]
    if (!zeile) return null
    let kursSymbol = null
    if (await knex.schema.hasTable('newcomer_titel')) {
        kursSymbol = (await knex('newcomer_titel').where('instrumentId', zeile.id).first())?.kursSymbol || null
    }
    kursSymbol = kursSymbol || kursSymbolKandidaten(zeile.ticker)[0] || null
    const { splits, grund } = await ladeSplits(kursSymbol)
    return {
        ticker: zeile.ticker, name: zeile.name || null, unterart: zeile.unterart,
        boerse: boerse || zeile.handelsplatz, kursSymbol,
        // null = unbekannt (Quelle aus oder Abruf gescheitert) — NICHT «keine Splits»
        splits, splitsGrund: grund,
    }
}

/**
 * @param {string} symbol  wie die Marktdatenquelle es nennt (`NVDAUSDT`)
 * @returns {Promise<null | {ticker, name, unterart, boerse, kursSymbol, splits: object[]|null, splitsGrund: string|null}>}
 */
export async function aktienKontext(symbol) {
    const sym = String(symbol || '').toUpperCase()
    const c = kontextCache.get(sym)
    if (c && Date.now() - c.zeit < KONTEXT_MS) return c.wert
    let wert = null
    try { wert = await baue(sym) } catch { wert = null }
    kontextCache.set(sym, { zeit: Date.now(), wert })
    return wert
}

/** Nur für Selbsttests. */
export function leereKontextCache() { kontextCache.clear(); splitsCache.clear() }
