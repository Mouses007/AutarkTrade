/**
 * Quellen mit eingeschränkten Nutzungsbedingungen (S15, 19.10.2026).
 *
 * Einige Analysequellen (Makro, Kalender, Dominanz, Rainbow, Hype-Radar …)
 * sind inoffizielle Schnittstellen oder nach ihren Bedingungen nur für den
 * privaten Gebrauch freigegeben. Sie laufen hinter EINEM Schalter
 * `settings.quellenOhneFreigabe` (Einstellungen › Datenquellen), Vorgabe AN:
 *
 *   an   alle Quellen dieser Liste laufen im vollen Umfang
 *   aus  diese Quellen und die Funktionen, die nur sie haben, sind aus
 *        und sagen warum (Stand nach S12)
 *
 * Diese Liste ist die EINE Stelle, die sagt, welche Quelle unter den Schalter
 * fällt; `zeilen` sind interne Prüfvermerke (Zeilen der Quellenprüfung, nur für
 * den Selbsttest, nirgends angezeigt). Code fragt immer nach einer ID dieser Liste
 * (`quelleErlaubt('yahoo')`), nie direkt nach dem Schalter — eine unbekannte
 * ID wirft, damit ein Tippfehler nicht still „erlaubt" heisst.
 *
 * Die Bedingungen der Anbieter ändern sich durch den Schalter nicht: Wer ihn
 * anlässt, prüft sie selbst und nutzt diese Quellen auf eigene Verantwortung
 * (Hinweis in der Einstellung).
 */

import { QuelleAus } from './aus.js'

export const SCHALTER = 'quellenOhneFreigabe'
export const VORGABE = true

/**
 * id → { name, zeilen, was }. `was` ist die kurze Beschreibung für die
 * Einstellungsseite (deutsch).
 */
export const QUELLEN_OHNE_FREIGABE = {
    yahoo: { name: 'Yahoo Finance', zeilen: ['28', '39', '32', '42'], was: 'Makro (ES/NQ/RTY/DXY), Indizes-Kachel, Live-Trading-Indizes, Gesamt-/Handelslage' },
    forexfactory: { name: 'ForexFactory', zeilen: ['40', '47'], was: 'Wirtschaftskalender (Woche/Monat) und Kalender-Countdown' },
    coinmarketcap: { name: 'CoinMarketCap', zeilen: ['20'], was: 'Dominanz-Historie (Import über den Webendpunkt)' },
    blockchaininfo: { name: 'blockchain.info', zeilen: ['25'], was: 'BTC-Historie ab 2009 für Rainbow und Pi Cycle' },
    coingeckoOeffentlich: { name: 'CoinGecko (ohne Schlüssel)', zeilen: ['21', '29', '55', '87'], was: 'CoinGecko über den öffentlichen Endpunkt, wenn kein eigener Schlüssel hinterlegt ist' },
    geckoterminal: { name: 'GeckoTerminal (ohne Schlüssel)', zeilen: ['59'], was: 'On-Chain-Pools, Käufer/Verkäufer, OHLCV über api.geckoterminal.com' },
    tokenbilder: { name: 'Token-Bilder', zeilen: ['58'], was: 'Logos von DexScreener/CoinGecko im Hype- und Coin-Radar' },
    telegram: { name: 'Telegram (t.me/s)', zeilen: ['31', '52', '63'], was: 'Telegram-Kanäle als News-Quelle, in der Frühphase und in der Wal-Kachel' },
    pumpfun: { name: 'pump.fun', zeilen: ['60'], was: 'Neueste Coins, Kurve, King of the Hill, Kommentare, Ersteller-Bilanz' },
    reddit: { name: 'Reddit RSS', zeilen: ['61'], was: 'Reddit-Erwähnungen im Hype-Radar' },
    coinpaprika: { name: 'CoinPaprika', zeilen: ['56'], was: 'Quelle CoinPaprika im Hype-Radar' },
    rugcheck: { name: 'RugCheck (Vorgabe an)', zeilen: ['66'], was: 'RugCheck läuft ab Werk mit (sonst nur auf Wunsch)' },
    solanaRpcOeffentlich: { name: 'Solana-RPC (öffentlich)', zeilen: ['67'], was: 'Smart Money über api.mainnet-beta.solana.com, wenn keine eigene RPC-Adresse hinterlegt ist' },
    binanceAlpha: { name: 'Binance Alpha', zeilen: ['76'], was: 'Börsenwächter: Alpha-Liste (bapi)' },
    upbit: { name: 'Upbit', zeilen: ['78'], was: 'Börsenwächter: Upbit' },
    mexc: { name: 'MEXC', zeilen: ['82'], was: 'Börsenwächter: MEXC' },
    okx: { name: 'OKX', zeilen: ['38', '83', '13'], was: 'Börsenwächter, Fremdbuch-Vergleich, Börsen-Links' },
    gelbeBoersen: { name: 'Coinbase, Kraken, KuCoin, Gate (Vorgabe an)', zeilen: ['77', '79', '80', '81'], was: 'Börsenwächter: diese Börsen ab Werk an (sonst nur auf Wunsch)' },
    binanceBrackets: { name: 'Binance bapi-Brackets', zeilen: ['34'], was: 'Wartungsmarge je Symbol „Binance (automatisch)"' },
    newsVorschlaege: { name: 'Vorbelegte News-Quellen', zeilen: ['46', '53'], was: 'Verlags-RSS und Truth Social als Vorschläge (Seed, Onboarding)' },
    deepseekSuche: { name: 'DeepSeek-Suche', zeilen: ['89d'], was: 'Recherche-Weg „DeepSeek-Suche" im Lagebericht' },
}

export const IDS = Object.keys(QUELLEN_OHNE_FREIGABE)

// ── Schalter lesen (30 s im Speicher, wie die Marktdatenquelle) ──────────
let gemerkt = { an: undefined, ts: 0 }
const MERKEN_MS = 30000
let leser = async () => {
    const { getKnex } = await import('../database.js')
    const z = await getKnex()('settings').select(SCHALTER).where('id', 1).first()
    return z?.[SCHALTER]
}

/** Nur für Selbsttests. */
export function _setzeLeser(fn) {
    leser = fn
    gemerkt = { an: undefined, ts: 0 }
}

/** Nach dem Speichern des Schalters. */
export function vergiss() {
    gemerkt = { an: undefined, ts: 0 }
}

/** DB-Wert → boolean. Unbekannt (Spalte fehlt, null, Lesefehler) ist die Vorgabe AN. */
export function normSchalter(w) {
    if (w === undefined || w === null || w === '') return VORGABE
    if (w === false || w === 0 || w === '0' || String(w).toLowerCase() === 'false') return false
    return true
}

export async function freigabeAn() {
    if (gemerkt.an !== undefined && Date.now() - gemerkt.ts < MERKEN_MS) return gemerkt.an
    let an = VORGABE
    try { an = normSchalter(await leser()) } catch { an = VORGABE }
    gemerkt = { an, ts: Date.now() }
    return an
}

/** Letzter bekannter Stand für synchrone Wege (Vorgabe, solange nie gelesen). */
export function freigabeAnSofort() {
    return gemerkt.an === undefined ? VORGABE : gemerkt.an
}

function pruefeId(id) {
    if (!QUELLEN_OHNE_FREIGABE[id]) throw new Error(`Unbekannte Quelle ohne Freigabe: ${id}`)
}

/** Darf diese Quelle laufen? */
export async function quelleErlaubt(id) {
    pruefeId(id)
    return freigabeAn()
}

/** Synchron, mit dem letzten bekannten Stand. */
export function quelleErlaubtSofort(id) {
    pruefeId(id)
    return freigabeAnSofort()
}

/** Wirft `QuelleAus(name, 'ohneFreigabe')`, wenn der Schalter aus ist. */
export async function fordereQuelle(id) {
    if (!(await quelleErlaubt(id))) throw new QuelleAus(QUELLEN_OHNE_FREIGABE[id].name, 'ohneFreigabe')
}

/** Für die Einstellungsseite und `GET /api/quellen`. */
export async function freigabeStand() {
    let gefragt = true
    try {
        const { getKnex } = await import('../database.js')
        const z = await getKnex()('settings').select('quellenOhneFreigabeGefragt').where('id', 1).first()
        gefragt = Number(z?.quellenOhneFreigabeGefragt ?? 1) === 1
    } catch { /* ohne Spalte oder DB (Selbsttest): nicht fragen */ }
    return {
        an: await freigabeAn(),
        gefragt,
        vorgabe: VORGABE,
        quellen: IDS.map((id) => ({ id, ...QUELLEN_OHNE_FREIGABE[id] })),
    }
}
