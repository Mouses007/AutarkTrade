/**
 * Zahlentermine eines Titels von der Kursquelle holen, 12 Stunden gemerkt.
 *
 * Geteilt von der Simulation (`kontext.js` → Backtest und Engine) und dem
 * Aktien-Radar. `null` heisst UNBEKANNT (Quelle aus, Abruf gescheitert, Titel
 * unbekannt) — nicht «keine Termine»; der Grund steht dabei.
 */
import { holeZusammenfassung, NichtGefunden, Gebremst } from '../newcomer-radar/kursquelle.js'
import { istAus } from '../quellen/aus.js'
import { termineAus } from './titel-kern.js'

const GUT_MS = 12 * 60 * 60_000
const SCHLECHT_MS = 5 * 60_000
const cache = new Map()   // kursSymbol → { zeit, termine, grund }

/**
 * @param {string|null} kursSymbol
 * @returns {Promise<{termine: {naechster, vergangene}|null, grund: string|null}>}
 */
export async function ladeTermine(kursSymbol) {
    if (!kursSymbol) return { termine: null, grund: 'keinKursSymbol' }
    const c = cache.get(kursSymbol)
    if (c && Date.now() - c.zeit < (c.termine ? GUT_MS : SCHLECHT_MS)) return { termine: c.termine, grund: c.grund }
    let wert
    try {
        wert = { termine: termineAus(await holeZusammenfassung(kursSymbol)), grund: null }
    } catch (e) {
        wert = { termine: null, grund: istAus(e) ? 'quelleAus' : e instanceof Gebremst ? 'gebremst' : e instanceof NichtGefunden ? 'nichtGefunden' : 'abrufFehlgeschlagen' }
    }
    // Eine Bremse nicht merken — der nächste Titel soll es gar nicht erst versuchen, der nächste Lauf schon.
    if (wert.grund !== 'gebremst') cache.set(kursSymbol, { zeit: Date.now(), ...wert })
    return wert
}

/** Nur für Selbsttests. */
export function leereTermineCache() { cache.clear() }
