/**
 * Aktien im Chart (Aktien-Integration, Phase 5): welche Titel sich laden
 * lassen und unter welchem Symbol an welcher Börse.
 *
 * Die Liste kommt einmal je Seitenaufruf von `/api/aktien/chart-symbole`
 * (`server/aktien/chart-symbole.js`): je Titel das Future-Symbol bei Binance,
 * Bitunix und Bitget. Suche, Watchlist-Vorgabe und Start-Layout teilen sich
 * denselben Abruf.
 */
import axios from 'axios'

/** Was eine leere Aktien-Watchlist zum Start bekommt, soweit ladbar. */
export const STANDARD_TICKER = ['NVDA', 'TSLA', 'AAPL', 'MSFT', 'AMZN', 'GOOGL', 'META', 'SPY', 'QQQ']

let laden = null

/** [{ticker, name, unterart, symbole: {binance?, bitunix?, bitget?}, spot: []}] — leer bei Fehler oder leerem Stamm. */
export function ladeAktienSymbole() {
    if (!laden) {
        laden = axios.get('/api/aktien/chart-symbole')
            .then(({ data }) => (Array.isArray(data?.titel) ? data.titel : []))
            .catch(() => { laden = null; return [] })
    }
    return laden
}

/**
 * Symbol und Börse, unter denen der Chart den Titel lädt: die erste der
 * wählbaren Börsen (Vorgabe zuerst), die ihn führt — oder null.
 *
 * @param {object} titel       Eintrag der Liste
 * @param {string[]} boersen   wählbare Börsen in Vorzugsreihenfolge
 */
export function symbolBei(titel, boersen) {
    for (const b of boersen || []) {
        if (titel?.symbole?.[b]) return { symbol: titel.symbole[b], boerse: b }
    }
    return null
}

/** Börsen in Vorzugsreihenfolge: die Vorgabe zuerst, dann der Rest. */
export function vorzug(vorgabe, waehlbar = []) {
    return [vorgabe, ...waehlbar.filter((b) => b !== vorgabe)].filter(Boolean)
}

/**
 * Sucheinträge in der Form, die `SymbolSuche.vue` für Coins benutzt, dazu
 * Name, Börse und die Handelsplätze. Titel, die keine wählbare Börse führt,
 * fehlen.
 */
export function sucheintraege(liste, boersen) {
    const aus = []
    for (const t of liste || []) {
        const ziel = symbolBei(t, boersen)
        if (!ziel) continue
        aus.push({
            symbol: ziel.symbol, boerse: ziel.boerse, markt: 'futures', base: t.ticker, quote: 'USDT',
            name: t.name || '', unterart: t.unterart,
            plaetze: [...Object.keys(t.symbole || {}), ...(t.spot || [])],
        })
    }
    return aus
}

/**
 * Treffer einer Suche: Ticker genau, dann Ticker-Anfang, dann Name.
 * @param {string} frage  roh aus dem Suchfeld
 */
export function sucheAktien(eintraege, frage, grenze = 60) {
    const q = String(frage || '').trim().toUpperCase()
    if (!q) return eintraege.slice(0, grenze)
    const rang = (s) => (s.base === q ? 0 : s.base.startsWith(q) ? 1 : s.name.toUpperCase().includes(q) ? 2 : s.symbol.includes(q) ? 3 : -1)
    return eintraege.map((s) => ({ ...s, rang: rang(s) })).filter((s) => s.rang >= 0)
        .sort((a, b) => a.rang - b.rang || a.base.localeCompare(b.base)).slice(0, grenze)
}

/**
 * Start für einen leeren Aktien-Chart: Panel und Watchlist aus den bekannten
 * Standard-Titeln, soweit die Börsen sie führen. Ohne Stamm (noch nie
 * abgeglichen) bleibt NVDAUSDT an der Vorgabe-Börse — der Chart sagt dann
 * selbst, dass er das Symbol nicht kennt.
 */
export function standardAktien(liste, boersen) {
    const je = new Map((liste || []).map((t) => [t.ticker, t]))
    const ziele = STANDARD_TICKER.map((ticker) => symbolBei(je.get(ticker), boersen)).filter(Boolean)
    const erstes = ziele[0] || { symbol: 'NVDAUSDT', boerse: boersen?.[0] }
    return {
        panel: { symbol: erstes.symbol, markt: 'futures', ...(erstes.boerse ? { boerse: erstes.boerse } : {}) },
        watchlist: (ziele.length ? ziele : [erstes]).map((z) => ({ symbol: z.symbol, markt: 'futures' })),
    }
}
