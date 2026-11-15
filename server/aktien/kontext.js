/**
 * Ist dieses Symbol ein Aktien-Future — und was muss die Simulation dann wissen?
 *
 * Die Strategie-Schicht prüft Symbole nur der Form nach; `NVDAUSDT` läuft
 * durch Backtest und Papierbetrieb wie ein Coin. Diese Auskunft macht den
 * Unterschied sichtbar: Ticker, Börse (für die Stichtage in
 * `shared/aktien-sitzung.js`) und die Splits des Titels (für
 * `splits.js` — die Kerzen der Futures sind nicht split-bereinigt) und seine
 * Zahlentermine (`shared/aktien-zahlen.js`).
 *
 * `null` heisst Krypto, und zwar auch dann, wenn die Frage nicht zu
 * beantworten ist (keine Datenbank im Selbsttest, leerer Stamm): die
 * Simulation verhält sich dann wie vor der Aktien-Integration.
 */
import { getKnex } from '../database.js'
import * as marktdaten from '../marktdaten/index.js'
import { holeSplits } from '../newcomer-radar/kursquelle.js'
import { kursSymbolFuer } from '../newcomer-radar/kursquelle-kern.js'
import { istAus } from '../quellen/aus.js'
import { CHART_BOERSEN } from './chart-symbole.js'
import { ladeTermine } from './termine.js'

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

/** Der Titel des Stamms hinter einem Future-Symbol — nur Datenbank, kein Netz. `null` = kein Aktien-Future. */
async function stammZeile(symbol) {
    const knex = getKnex()
    let boerse = null
    try { boerse = (await marktdaten.fordere('kerzen', { markt: 'futures' })).id } catch { /* Marktdaten aus */ }
    // Dasselbe Symbol kann an zwei Börsen Verschiedenes heissen — die Marktdatenquelle gewinnt.
    const zeilen = await knex('instrument_listungen as l').join('instrumente as i', 'i.id', 'l.instrumentId')
        .where({ 'l.symbol': symbol, 'l.art': 'perp', 'l.aktiv': 1, 'i.anlageklasse': 'aktien' })
        .whereIn('l.handelsplatz', CHART_BOERSEN)
        .select('i.id', 'i.ticker', 'i.name', 'i.unterart', 'i.region', 'l.handelsplatz')
    const zeile = zeilen.find((z) => z.handelsplatz === boerse) || zeilen[0]
    return zeile ? { ...zeile, boerse: boerse || zeile.handelsplatz } : null
}

/**
 * Anlageklasse einer Symbolliste (für Strategie-Instanzen): `aktien`, wenn
 * JEDES Symbol ein Aktien-Future ist, `krypto`, wenn keines es ist. Gemischt
 * ist ein Fehler — eine Instanz hat EINE Tagesgrenze und EINEN Markt.
 * Ist die Frage nicht zu beantworten (keine Datenbank), gilt Krypto.
 *
 * @returns {Promise<{klasse: 'krypto'|'aktien', gemischt: boolean, aktien: string[]}>}
 */
export async function anlageklasseVon(symbole = []) {
    const aktien = []
    for (const s of symbole) {
        let zeile = null
        try { zeile = await stammZeile(String(s).toUpperCase()) } catch { zeile = null }
        if (zeile) aktien.push(String(s).toUpperCase())
    }
    const gemischt = aktien.length > 0 && aktien.length < symbole.length
    return { klasse: aktien.length && !gemischt ? 'aktien' : 'krypto', gemischt, aktien }
}

async function baue(symbol) {
    const knex = getKnex()
    const zeile = await stammZeile(symbol)
    if (!zeile) return null
    const gemerkt = (await knex.schema.hasTable('newcomer_titel'))
        ? await knex('newcomer_titel').where('instrumentId', zeile.id).first('kursSymbol') : null
    // `null` = kein Kurssymbol (Lauf fand nichts, fremde Region) — Splits und Termine bleiben dann unbekannt.
    const kursSymbol = kursSymbolFuer(zeile, gemerkt || null)
    const [{ splits, grund }, zahlen] = await Promise.all([ladeSplits(kursSymbol), ladeTermine(kursSymbol)])
    return {
        ticker: zeile.ticker, name: zeile.name || null, unterart: zeile.unterart,
        boerse: zeile.boerse, kursSymbol,
        // null = unbekannt (Quelle aus oder Abruf gescheitert) — NICHT «keine Splits»
        splits, splitsGrund: grund,
        // Zahlentermine (`{naechster, vergangene}`), ebenfalls null = unbekannt
        termine: zahlen.termine, termineGrund: zahlen.grund,
    }
}

/**
 * @param {string} symbol  wie die Marktdatenquelle es nennt (`NVDAUSDT`)
 * @returns {Promise<null | {ticker, name, unterart, boerse, kursSymbol, splits: object[]|null, splitsGrund: string|null,
 *           termine: {naechster, vergangene}|null, termineGrund: string|null}>}
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
