/**
 * Aktien für den Chart-Arbeitsplatz (Aktien-Integration, Phase 5).
 *
 * Der Chart lädt Kerzen von Binance, Bitunix oder Bitget (`/api/chart/kerzen`).
 * Ladbar ist ein Titel also genau dann, wenn eine dieser drei Börsen ihn als
 * USDT-Future führt — und zwar unter dem Symbol, das DIESE Börse verwendet
 * (Bitget schreibt gleichnamige Ticker als `ACNSTOCKUSDT`). Spot-Token und
 * Bitpanda haben im Chart keine Kerzenquelle; sie stehen nur als Hinweis
 * «auch handelbar bei» dabei.
 *
 * Rein: Titel des Stamms (`leseStamm`) → schlanke Liste für Suche und Watchlist.
 */

/** Börsen, deren Kerzen der Chart laden kann. */
export const CHART_BOERSEN = ['binance', 'bitunix', 'bitget']

/**
 * @param {object[]} titel  Ergebnis von `leseStamm` (Anlageklasse aktien)
 * @returns {{ticker: string, name: string|null, unterart: string,
 *            symbole: Record<string, string>, spot: string[]}[]}
 *          `symbole` = Future-Symbol je Chart-Börse, `spot` = Handelsplätze mit Spot.
 */
export function chartSymboleAus(titel = []) {
    const aus = []
    for (const t of titel) {
        const symbole = {}
        const spot = new Set()
        for (const l of t.listungen || []) {
            if (l.art !== 'perp') { spot.add(l.handelsplatz); continue }
            if (!CHART_BOERSEN.includes(l.handelsplatz)) continue
            if (l.quote && l.quote !== 'USDT') continue
            // Führt eine Börse denselben Titel doppelt, gewinnt das kürzere Symbol (der Hauptkontrakt).
            if (!symbole[l.handelsplatz] || l.symbol.length < symbole[l.handelsplatz].length) symbole[l.handelsplatz] = l.symbol
        }
        if (!Object.keys(symbole).length) continue
        aus.push({ ticker: t.ticker, name: t.name || null, unterart: t.unterart, symbole, spot: [...spot].sort() })
    }
    return aus.sort((a, b) => a.ticker.localeCompare(b.ticker))
}
