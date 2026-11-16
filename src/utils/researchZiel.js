/**
 * Absprung aus dem Chart in den Research-Bereich: «Was ist das für ein Titel?»
 *
 *   Aktien-Future  → Titel-Seite (`/aktien?titel=NVDA`, wie im Aktien-Radar).
 *                    Der Ticker kommt aus dem Aktien-Kontext des Panels — nie
 *                    durch Abschneiden von «USDT» (`ACNSTOCKUSDT`, `1000…`).
 *   Coin           → Coin-Radar mit der Einzelprüfung dieses Symbols
 *                    (`/coin-radar?symbol=BTCUSDT`; die Seite misst dann, wie
 *                    wenn man das Symbol dort eintippt — öffentliche
 *                    Marktdaten, keine KI, kein Lauf).
 *
 * `null` = kein Ziel: Research ausgeschaltet, die Zielseite gilt im aktiven
 * Markt nicht (im Aktien-Markt gibt es keinen Coin-Radar), oder es ist noch
 * nicht bekannt, was das Symbol ist. Der Aufrufer zeigt dann keinen Knopf.
 *
 * Rein — die Einstellungszeile wird hereingereicht (wie in `config/markt.js`).
 */
import { marktAus, erreichbar } from '../config/markt.js'

export const TITEL_PFAD = '/aktien'
export const COIN_PFAD = '/coin-radar'

/**
 * @param {{symbol?: string, markt?: string, aktie?: {ticker?: string}|null}} was
 *        `aktie` = Aktien-Kontext des Panels (`aktieVon`), `null` bei einem Coin
 * @param {object|null} einstellungen  `appEinstellungen.value`
 * @returns {{path: string, query: object, art: 'aktie'|'coin'}|null}
 */
export function researchZiel({ symbol, aktie } = {}, einstellungen) {
    const markt = marktAus(einstellungen)
    const ticker = String(aktie?.ticker || '').toUpperCase()
    if (aktie) {
        if (!/^[A-Z0-9.\-]{1,15}$/.test(ticker) || !erreichbar(TITEL_PFAD, markt, einstellungen)) return null
        return { path: TITEL_PFAD, query: { titel: ticker }, art: 'aktie' }
    }
    const sym = String(symbol || '').toUpperCase()
    if (!/^[A-Z0-9]{2,30}$/.test(sym) || !erreichbar(COIN_PFAD, markt, einstellungen)) return null
    return { path: COIN_PFAD, query: { symbol: sym }, art: 'coin' }
}

/** Das Ziel als Adresse für den Router (ohne das Feld `art`). */
export function researchAdresse(ziel) {
    return ziel ? { path: ziel.path, query: ziel.query } : null
}
