/**
 * Symbole der Börsen vergleichbar machen — für Server (Journal-Auswertung)
 * und Browser (offene Positionen im Chart) dieselbe Regel.
 *
 * Bitget `BTCUSDT_UMCBL`, Pionex `BTC_USDT_PERP`, `BTC-USDT` → `BTCUSDT`.
 * Die `1000`-Vorsilbe bleibt bewusst stehen: 1000PEPE notiert tausendmal höher
 * als PEPE, ein Trade darauf an PEPE-Kerzen stünde drei Grössenordnungen
 * neben dem Kurs.
 */
export function normSymbol(s) {
    let x = String(s || '').toUpperCase().trim()
    x = x.replace(/_(UMCBL|DMCBL|CMCBL|PERP|SWAP)$/, '')
    x = x.replace(/[-_/:]/g, '')
    x = x.replace(/PERP$/, '')
    return x
}

/**
 * Notierungen, die OHNE Trennzeichen am Symbol kleben dürfen. Bewusst nur die
 * Stablecoins der Börsen: mit `BTC`, `ETH`, `USD` oder `EUR` würde aus WBTC
 * ein W, aus STETH ein ST und aus TUSD ein T. Solche Paare werden nur mit
 * Trennzeichen getrennt (`ETH_BTC`).
 */
const QUOTES = ['FDUSD', 'USDT', 'USDC']

/**
 * Symbol in Basis und Notierung trennen — die EINE Stelle dafür.
 *
 *   BTCUSDT → BTC/USDT   NVDAX_USDT → NVDAX/USDT   BRK.B → BRK.B/—
 *
 * Mit Trennzeichen (`_`, `-`, `/`) gilt das Trennzeichen, sonst die bekannte
 * Endung. Ein Symbol, das selbst eine Notierungswährung ist (`USDT`, `ETH`),
 * bleibt ganz Basis. Ob `NVDAUSDT` eine Aktie ist, steht NICHT im Symbol:
 * das weiss nur der Instrument-Stamm (`server/aktien/einordnung.js`).
 *
 * @returns {{basis: string, quote: string}}
 */
export function zerlege(s) {
    let x = String(s || '').toUpperCase().trim()
    x = x.replace(/[-_](UMCBL|DMCBL|CMCBL|PERP|SWAP)$/, '')
    const teile = x.split(/[-_/:]/).filter(Boolean)
    if (teile.length >= 2) return { basis: teile[0], quote: teile[1] }
    for (const q of QUOTES) {
        if (x.length > q.length && x.endsWith(q)) return { basis: x.slice(0, -q.length), quote: q }
    }
    return { basis: x, quote: '' }
}

/** Kurzname für Anzeigen: `BTCUSDT` → `BTC`, `1000PEPEUSDT` → `1000PEPE`. */
export function kurzSymbol(s) {
    return zerlege(s).basis
}
