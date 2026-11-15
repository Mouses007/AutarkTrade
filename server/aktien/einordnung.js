/**
 * Einordnung der Börsen-Listungen nach Anlageklasse (Aktien-Integration, Phase 1).
 *
 * Jede Börse führt Aktien, ETFs, Rohstoffe und Kryptowährungen in derselben
 * Liste und kennzeichnet sie anders — oder gar nicht (Stand 14.11.2026,
 * `docs/PLAN-AKTIEN.md`):
 *
 *   Binance   `underlyingType` (COIN, EQUITY, HK_/KR_/CN_EQUITY, COMMODITY,
 *             INDEX, FX, PREMARKET) + `underlyingSubType`       → verlässlich
 *   Bitget    `isRwa: "YES"` ohne Unterart; gleichnamige Ticker tragen die
 *             Nachsilbe `STOCK` (ACNSTOCK, CSTOCK)               → verlässlich,
 *             Unterart nur aus Listen unten
 *   Bitunix   kein Kennzeichen                                   → Abgleich
 *   Pionex    kein Kennzeichen, xStocks heissen `<TICKER>X`      → Abgleich
 *   Bitpanda  `group` (stock, etf, etc, metal, index, coin, …)   → verlässlich
 *
 * «Abgleich» heisst: ein Ticker gilt nur dann als Aktie, wenn eine Börse mit
 * Kennzeichen ihn als solche führt UND keine ihn als Coin führt. Solche
 * Zeilen tragen `sicher: false`.
 *
 * Reine Funktionen, kein Netz, keine Datenbank. Jede liefert eine Listung:
 *   { handelsplatz, symbol, basis, quote, art, anlageklasse, unterart,
 *     region, maxHebel, name, gelistetSeit, sicher }
 *
 * `gelistetSeit` ist das Datum, das die Börse selbst für den Handelsstart nennt
 * (Binance `onboardDate`, Bitget `openTime`, Bitunix `launchTime`); Pionex und
 * Bitpanda nennen keines.
 *
 *   art           perp | token-spot | broker-spot
 *   anlageklasse  krypto | aktien | sonstige
 *   unterart      coin | aktie | etf | vorboerslich | rohstoff | index | devise
 *
 * `aktien` umfasst aktie, etf und vorboerslich (Pre-IPO). Rohstoffe, Devisen
 * und Nicht-Krypto-Indizes sind `sonstige`: sie gehören nicht in die
 * Krypto-Auswertungen, aber auch nicht in den Aktien-Radar.
 */

export const ANLAGEKLASSEN = ['krypto', 'aktien', 'sonstige']

/** Börsen, die selbst sagen, was Aktie und was Coin ist — aus ihnen entsteht `bekannteBasen`. */
export const KENNZEICHEN_PLAETZE = ['binance', 'bitget']
/**
 * Börsen ohne Kennzeichen: ihre Einordnung hängt an den Listen der Börsen
 * oben. Fehlt eine davon, ist «kein Aktien-Ticker» hier keine Aussage über
 * die Börse selbst (Audit FUN-F-005, Regel 4 in `stamm.js`).
 */
export const ABGLEICH_PLAETZE = ['bitunix', 'pionex']

/** Unterart → Anlageklasse. */
const KLASSE = {
    coin: 'krypto', aktie: 'aktien', etf: 'aktien', vorboerslich: 'aktien',
    rohstoff: 'sonstige', devise: 'sonstige', index: 'sonstige',
}

/** Rohstoffe und Edelmetalle, die Bitget als `isRwa` ohne Unterart führt. */
const ROHSTOFFE = new Set([
    'XAU', 'XAG', 'XPT', 'XPD', 'PAXG', 'XAUT', 'COPPER', 'CL', 'BZ', 'NATGAS',
])
const WAEHRUNGEN = 'USD|EUR|GBP|JPY|CHF|AUD|CAD|NZD|CNH|CNY|BRL|MXN|TRY|KRW|HKD|SGD'
const DEVISE = new RegExp(`^(${WAEHRUNGEN})(${WAEHRUNGEN})$`)

const gross = (s) => String(s || '').toUpperCase().trim()

/** Zeitstempel der Börse (ms, als Zahl oder Text) → ms; leer, -1 oder Unsinn → null. */
function zeit(wert) {
    const n = Number(wert)
    return Number.isFinite(n) && n > 1e12 && n < 4e12 ? n : null
}

function listung(handelsplatz, symbol, basis, quote, art, unterart, mehr = {}) {
    return {
        handelsplatz, symbol, basis, quote, art,
        anlageklasse: mehr.anlageklasse || KLASSE[unterart],
        unterart,
        region: mehr.region ?? null,
        maxHebel: mehr.maxHebel ?? null,
        name: mehr.name || null,
        gelistetSeit: zeit(mehr.gelistetSeit),
        sicher: mehr.sicher !== false,
    }
}

/** Binance-Futures: ein Eintrag aus `exchangeInfo.symbols`. */
export function ausBinance(s) {
    const typ = gross(s.underlyingType)
    const neben = (s.underlyingSubType || []).map(gross)
    let unterart = 'coin', region = null, anlageklasse
    if (typ === 'EQUITY') unterart = 'aktie'
    else if (/^[A-Z]{2}_EQUITY$/.test(typ)) { unterart = 'aktie'; region = typ.slice(0, 2) }
    else if (typ === 'COMMODITY') unterart = 'rohstoff'
    else if (typ === 'FX') unterart = 'devise'
    else if (typ === 'INDEX') {
        unterart = 'index'
        // BTCDOM, DEFI, ALL sind Krypto-Körbe und bleiben in der Krypto-Welt.
        if (!neben.includes('TRADFI')) anlageklasse = 'krypto'
    } else if (typ === 'PREMARKET') {
        // «Pre-IPO» = Firma vor dem Börsengang; «Pre-Market» allein = Coin vor dem Start.
        unterart = neben.includes('PRE-IPO') || neben.includes('TRADFI') ? 'vorboerslich' : 'coin'
    }
    return listung('binance', s.symbol, gross(s.baseAsset), gross(s.quoteAsset), 'perp', unterart, { region, anlageklasse, gelistetSeit: s.onboardDate })
}

/** Bitget-Futures: ein Eintrag aus `mix/market/contracts`. */
export function ausBitget(c) {
    const roh = gross(c.baseCoin)
    let basis = roh, unterart = 'coin'
    if (c.isRwa === 'YES') {
        basis = roh.length > 5 ? roh.replace(/STOCK$/, '') : roh
        if (ROHSTOFFE.has(basis)) unterart = 'rohstoff'
        else if (DEVISE.test(basis)) unterart = 'devise'
        // ETFs (QQQ, SOXS) kennzeichnet Bitget nicht; der Stamm trennt sie
        // später über Bitpanda-`group` oder den Referenz-Anbieter.
        else unterart = 'aktie'
    }
    const hebel = Number(c.maxLever)
    return listung('bitget', c.symbol, basis, gross(c.quoteCoin), 'perp', unterart, {
        maxHebel: Number.isFinite(hebel) && hebel > 0 ? hebel : null,
        gelistetSeit: c.openTime,
    })
}

/**
 * Welche Ticker sind an Börsen MIT Kennzeichen eindeutig kein Coin?
 * Ein Ticker, den eine Börse als Coin und eine andere als Aktie führt, ist
 * strittig und fehlt in der Karte.
 *
 * @param {object[]} listungen  Ergebnisse von `ausBinance` / `ausBitget`
 * @returns {Map<string, {unterart: string, anlageklasse: string, region: string|null}>}
 */
export function bekannteBasen(listungen) {
    const coins = new Set(), andere = new Map()
    for (const l of listungen) {
        if (l.anlageklasse === 'krypto') coins.add(l.basis)
        else {
            // Die genauere Angabe gewinnt: Binance kennt Region und Pre-IPO,
            // Bitget meldet beides nur als «isRwa».
            const alt = andere.get(l.basis)
            if (!alt) andere.set(l.basis, { unterart: l.unterart, anlageklasse: l.anlageklasse, region: l.region })
            else {
                if (l.unterart === 'vorboerslich' && alt.unterart === 'aktie') alt.unterart = 'vorboerslich'
                if (!alt.region && l.region) alt.region = l.region
            }
        }
    }
    for (const b of coins) andere.delete(b)
    return andere
}

/** Bitunix-Futures: ein Eintrag aus `trading_pairs`, Abgleich über `bekannt`. */
export function ausBitunix(z, bekannt) {
    const basis = gross(z.base)
    const t = bekannt?.get(basis)
    const hebel = Number(z.maxLeverage)
    const mehr = { maxHebel: Number.isFinite(hebel) && hebel > 0 ? hebel : null, gelistetSeit: z.launchTime }
    if (!t) return listung('bitunix', z.symbol, basis, gross(z.quote), 'perp', 'coin', mehr)
    return listung('bitunix', z.symbol, basis, gross(z.quote), 'perp', t.unterart, {
        ...mehr, anlageklasse: t.anlageklasse, region: t.region, sicher: false,
    })
}

/**
 * Pionex-Spot: ein Eintrag aus `common/symbols`. xStocks heissen `NVDAX`;
 * AVAX, DYDX oder IMX enden auch auf X, deshalb zählt nur, was ohne das X
 * ein bekannter Aktien-Ticker ist.
 */
export function ausPionex(s, bekannt) {
    const roh = gross(s.baseCurrency)
    const quote = gross(s.quoteCurrency)
    const ohneX = roh.endsWith('X') ? roh.slice(0, -1) : null
    const t = ohneX && !bekannt?.has(roh) ? bekannt?.get(ohneX) : null
    if (!t || t.anlageklasse !== 'aktien') return listung('pionex', s.symbol, roh, quote, 'token-spot', 'coin')
    return listung('pionex', s.symbol, ohneX, quote, 'token-spot', t.unterart, { region: t.region, sicher: false })
}

/** Bitpanda: `attributes` eines Eintrags aus `/v3/assets`. */
export function ausBitpanda(a) {
    const gruppe = String(a.group || '').toLowerCase()
    const unterart = {
        stock: 'aktie', etf: 'etf', etc: 'rohstoff', metal: 'rohstoff', index: 'index',
    }[gruppe] || 'coin'
    // Bitpanda-Indizes sind Krypto-Körbe (BCI5 …).
    const anlageklasse = gruppe === 'index' ? 'krypto' : undefined
    return listung('bitpanda', String(a.pid || a.id), gross(a.symbol), 'EUR', 'broker-spot', unterart, {
        anlageklasse, name: String(a.name || '').trim().slice(0, 120) || null,
    })
}

/**
 * Listungen zu Instrumenten bündeln: ein Titel, viele Handelsplätze.
 * Schlüssel ist `anlageklasse|basis`. ETF schlägt Aktie (nur Bitpanda weiss
 * es), eine Region gewinnt gegen keine.
 *
 * @returns {{schluessel: string, anlageklasse: string, basis: string, unterart: string,
 *            region: string|null, listungen: object[], spot: boolean, future: boolean}[]}
 */
export function buendle(listungen) {
    const karte = new Map()
    for (const l of listungen) {
        const schluessel = `${l.anlageklasse}|${l.basis}`
        let i = karte.get(schluessel)
        if (!i) {
            i = { schluessel, anlageklasse: l.anlageklasse, basis: l.basis, unterart: l.unterart, region: l.region, name: null, listungen: [], spot: false, future: false }
            karte.set(schluessel, i)
        }
        if (l.unterart === 'etf' || (l.unterart === 'vorboerslich' && i.unterart === 'aktie')) i.unterart = l.unterart
        if (!i.region && l.region) i.region = l.region
        if (!i.name && l.name) i.name = l.name
        i.listungen.push(l)
        if (l.art === 'perp') i.future = true
        else i.spot = true
    }
    return [...karte.values()]
}

/** Alle fünf Roh-Listen in einem Zug einordnen. Fehlende Listen sind leer. */
export function ordneAlle({ binance = [], bitget = [], bitunix = [], pionex = [], bitpanda = [] } = {}) {
    const mitKennzeichen = [...binance.map(ausBinance), ...bitget.map(ausBitget)]
    const bekannt = bekannteBasen(mitKennzeichen)
    return [
        ...mitKennzeichen,
        ...bitunix.map((z) => ausBitunix(z, bekannt)),
        ...pionex.map((s) => ausPionex(s, bekannt)),
        ...bitpanda.map(ausBitpanda),
    ]
}
