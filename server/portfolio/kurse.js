/**
 * Spot-Portfolio: Kurse in USD und der Wechselkurs nach CHF.
 *
 * Quellen, in dieser Reihenfolge:
 *   1. Stablecoins = 1 USD, Fiat über den Wechselkurs
 *   2. Coins der Börsen: Spot-Ticker der gewählten Marktdatenquelle
 *      (`server/marktdaten/`, `COINUSDT`) — dieselbe Wahl wie im Rest der App
 *   3. Token auf einer Kette (mit Kontrakt): DexScreener, Paar mit der
 *      grössten Liquidität — und nur ab MIN_LIQUIDITAET. Darunter ist der
 *      „Kurs" eines Pools, den jemand mit 200 USD aufgesetzt hat; genau so
 *      sehen die Spam-Token aus, die ungefragt in jedes Wallet geschickt
 *      werden. Ohne verlässlichen Kurs bleibt der Wert `null`, nie 0.
 * Wechselkurs: Frankfurter (EZB-Referenzkurse, ohne Schlüssel), sonst der
 * manuelle Faktor aus den Einstellungen.
 *
 * Jede Zahl trägt ihre Quelle mit, damit die Oberfläche sagen kann, woher sie
 * stammt — und eine fehlende als fehlend zeigt.
 */

import { getKnex } from '../database.js'
import { preise as marktPreise, kerzen as marktKerzen } from '../marktdaten/index.js'
import * as bitgetMarkt from '../marktdaten/bitget.js'
import { STABIL } from './normal.js'

const MIN_LIQUIDITAET = 10000
const FX_TTL = 60 * 60e3
const MARKT_TTL = 60e3

/** Umbenennungen und verpackte Coins → das Symbol, unter dem es einen Kurs gibt. */
const ALIAS = { BTT: 'BTTC', WETH: 'ETH', WBTC: 'BTC', WBNB: 'BNB', WPOL: 'POL', WMATIC: 'POL', MATIC: 'POL', WAVAX: 'AVAX', WSOL: 'SOL', BTCB: 'BTC', CHSB: 'BORG' }

/** DexScreener-Namen der Ketten. */
export const DEX_KETTE = { 'evm:1': 'ethereum', 'evm:42161': 'arbitrum', 'evm:8453': 'base', 'evm:10': 'optimism', 'evm:56': 'bsc', 'evm:137': 'polygon', 'evm:43114': 'avalanche', sol: 'solana' }

const heute = () => new Date().toISOString().slice(0, 10)

// ── Wechselkurs ──────────────────────────────────────────────────────────

let fxSpeicher = null   // { zeit, chf, eur, quelle }

async function frankfurter(params) {
    const r = await fetch(`https://api.frankfurter.dev/v2/rates?base=USD&quotes=CHF,EUR&${params}`, { signal: AbortSignal.timeout(15000) })
    if (!r.ok) throw new Error(`Frankfurter ${r.status}`)
    return r.json()
}

/** USD → CHF und USD → EUR, heute. */
export async function fxHeute() {
    if (fxSpeicher && Date.now() - fxSpeicher.zeit < FX_TTL) return fxSpeicher
    try {
        const d = await frankfurter('')
        const chf = d.find((x) => x.quote === 'CHF')?.rate
        const eur = d.find((x) => x.quote === 'EUR')?.rate
        if (chf > 0 && eur > 0) {
            fxSpeicher = { zeit: Date.now(), chf, eur, quelle: 'EZB', datum: d[0]?.date }
            await merkeKurs('usdchf', heute(), chf, 'EZB')
            await merkeKurs('usdeur', heute(), eur, 'EZB')
            return fxSpeicher
        }
    } catch { /* weiter zum Ersatz */ }
    // Ersatz 1: letzter gespeicherter Kurs
    const k = getKnex()
    const alt = await k('portfolio_kurse').where('schluessel', 'usdchf').orderBy('datum', 'desc').first().catch(() => null)
    const altEur = await k('portfolio_kurse').where('schluessel', 'usdeur').orderBy('datum', 'desc').first().catch(() => null)
    if (alt?.usd > 0) {
        fxSpeicher = { zeit: Date.now(), chf: alt.usd, eur: altEur?.usd || alt.usd, quelle: `EZB vom ${alt.datum}`, datum: alt.datum }
        return fxSpeicher
    }
    // Ersatz 2: manueller Faktor der Einstellungen
    const s = await k('settings').select('waehrungFaktor').where('id', 1).first().catch(() => null)
    const f = Number(s?.waehrungFaktor) > 0 ? Number(s.waehrungFaktor) : 0.8
    fxSpeicher = { zeit: Date.now(), chf: f, eur: f, quelle: 'Einstellung', datum: null }
    return fxSpeicher
}

/** USD → CHF an einem Tag (für die eingefrorene Bewertung einer Bewegung). */
export async function fxAm(datum, waehrung = 'CHF') {
    const schluessel = waehrung === 'EUR' ? 'usdeur' : 'usdchf'
    const k = getKnex()
    const z = await k('portfolio_kurse').where({ schluessel, datum }).first().catch(() => null)
    if (z?.usd > 0) return z.usd
    // Eine Woche um den Tag laden: Wochenenden/Feiertage haben keinen EZB-Kurs.
    const t = Date.parse(datum + 'T00:00:00Z')
    const von = new Date(t - 6 * 86400e3).toISOString().slice(0, 10)
    try {
        const d = await frankfurter(`from=${von}&to=${datum}`)
        let letzter = null
        for (const x of d) {
            if (x.quote !== 'CHF' && x.quote !== 'EUR') continue
            await merkeKurs(x.quote === 'EUR' ? 'usdeur' : 'usdchf', x.date, x.rate, 'EZB')
            if (x.quote === waehrung && x.date <= datum) letzter = x.rate
        }
        if (letzter) return letzter
    } catch { /* unten */ }
    return null
}

async function merkeKurs(schluessel, datum, usd, quelle) {
    const k = getKnex()
    try {
        await k('portfolio_kurse').insert({ schluessel, datum, usd, quelle }).onConflict(['schluessel', 'datum']).merge()
    } catch { /* Cache — ein Fehler hier ist kein Fehler des Abrufs */ }
}

// ── Kurse jetzt ──────────────────────────────────────────────────────────

let marktSpeicher = null

/*
 * Erste Wahl ist die Marktdatenquelle der Einstellungen. Bitget-Spot ergänzt,
 * was dort fehlt: Coins, die man bei Bitget hält, führt Binance oft gar
 * nicht (gemessen 22.10.2026: CRO, CSPR) — und den Kurs eines Coins dort zu
 * lesen, wo er liegt, ist dieselbe Abfrage, die die Kontoübersicht schon macht.
 */
async function marktKarte() {
    if (marktSpeicher && Date.now() - marktSpeicher.zeit < MARKT_TTL) return marktSpeicher
    let karte = new Map(), fehler = null
    try { karte = await marktPreise({ markt: 'spot' }) } catch (e) { fehler = e.message }
    let ersatz = new Map()
    try { ersatz = await bitgetMarkt.preise({ markt: 'spot' }) } catch { /* nur Ergänzung */ }
    marktSpeicher = { zeit: Date.now(), karte, ersatz, fehler }
    return marktSpeicher
}

async function dexKurse(kette, kontrakte) {
    const name = DEX_KETTE[kette]
    const aus = new Map()
    if (!name || !kontrakte.length) return aus
    for (let i = 0; i < kontrakte.length; i += 30) {
        const teil = kontrakte.slice(i, i + 30)
        try {
            const r = await fetch(`https://api.dexscreener.com/tokens/v1/${name}/${teil.join(',')}`, { signal: AbortSignal.timeout(15000) })
            if (!r.ok) continue
            const paare = await r.json()
            for (const p of Array.isArray(paare) ? paare : []) {
                const k = String(p.baseToken?.address || '')
                const kk = kette === 'sol' ? k : k.toLowerCase()
                const liq = Number(p.liquidity?.usd) || 0
                const preis = Number(p.priceUsd)
                if (!Number.isFinite(preis) || liq < MIN_LIQUIDITAET) continue
                const alt = aus.get(kk)
                if (!alt || liq > alt.liq) aus.set(kk, { usd: preis, liq, symbol: p.baseToken?.symbol, quelle: 'DexScreener' })
            }
        } catch { /* Kette bleibt ohne Kurs */ }
    }
    return aus
}

/**
 * Kurse für eine Liste von Posten.
 * @param {Array<{asset, kontrakt?, kette?}>} posten
 * @returns {Promise<{ kurse: Map<string, {usd, quelle}>, fx, marktFehler }>}
 *   Schlüssel = `asset` bzw. `asset|kontrakt`
 */
export async function kurseFuer(posten) {
    const fx = await fxHeute()
    const markt = await marktKarte()
    const kurse = new Map()
    const jeKette = new Map()
    for (const p of posten) {
        const asset = String(p.asset || '').toUpperCase()
        const key = p.kontrakt ? `${asset}|${p.kontrakt}` : asset
        if (kurse.has(key)) continue
        if (p.kontrakt && p.kette) {
            const l = jeKette.get(p.kette) || []
            l.push(p.kontrakt)
            jeKette.set(p.kette, l)
            continue
        }
        kurse.set(key, kursEinfach(asset, fx, markt))
    }
    for (const [kette, liste] of jeKette) {
        const d = await dexKurse(kette, [...new Set(liste)])
        for (const p of posten) {
            if (p.kette !== kette || !p.kontrakt) continue
            const key = `${String(p.asset).toUpperCase()}|${p.kontrakt}`
            const t = d.get(p.kontrakt)
            // Ein bekannter Stablecoin MIT Kontrakt bekommt trotzdem nur dann
            // 1 USD, wenn DexScreener ihn kennt — „USDT" kann jeder Token heissen.
            kurse.set(key, t ? { usd: t.usd, quelle: t.quelle, symbol: t.symbol } : { usd: null, quelle: 'kein verlässlicher Kurs' })
        }
    }
    return { kurse, fx, marktFehler: markt.fehler }
}

function kursEinfach(asset, fx, { karte, ersatz }) {
    if (asset === 'USD' || (asset in STABIL && asset !== 'EUR' && asset !== 'CHF')) return { usd: 1, quelle: 'Stablecoin' }
    if (asset === 'EUR') return { usd: 1 / fx.eur, quelle: `Wechselkurs (${fx.quelle})` }
    if (asset === 'CHF') return { usd: 1 / fx.chf, quelle: `Wechselkurs (${fx.quelle})` }
    const a = ALIAS[asset] || asset
    // Ein Kurs von 0 ist kein Kurs (eingestellte Paare stehen bei Binance mit 0 im Ticker).
    const p = karte.get(`${a}USDT`) ?? karte.get(`${a}USDC`)
    if (Number.isFinite(p) && p > 0) return { usd: p, quelle: 'Marktdaten (Spot)' }
    const e = ersatz?.get(`${a}USDT`)
    return Number.isFinite(e) && e > 0 ? { usd: e, quelle: 'Bitget Spot' } : { usd: null, quelle: 'kein Kurs' }
}

/**
 * Tagesschlusskurs in USD (für die eingefrorene CHF-Bewertung einer Bewegung).
 * Nur Börsen-Coins; ein Token ohne Börsenpaar bleibt `null`.
 */
export async function tagesKursUsd(asset, datum) {
    const a = ALIAS[String(asset).toUpperCase()] || String(asset).toUpperCase()
    if (a in STABIL && a !== 'EUR' && a !== 'CHF') return { usd: 1, quelle: 'Stablecoin' }
    const k = getKnex()
    const z = await k('portfolio_kurse').where({ schluessel: a, datum }).first().catch(() => null)
    if (z) return { usd: z.usd, quelle: z.quelle }
    try {
        const t = Date.parse(datum + 'T00:00:00Z')
        const kz = await marktKerzen(`${a}USDT`, '1d', { markt: 'spot', start: t, ende: t + 86400e3 - 1, limit: 1 })
        const c = kz?.[0]?.c
        if (Number.isFinite(c)) {
            await merkeKurs(a, datum, c, 'Tageskerze')
            return { usd: c, quelle: 'Tageskerze' }
        }
    } catch { /* kein Paar oder Quelle aus → Bitget */ }
    try {
        const t = Date.parse(datum + 'T00:00:00Z')
        const kz = await bitgetMarkt.kerzen(`${a}USDT`, '1d', { markt: 'spot', start: t, ende: t + 86400e3 - 1, limit: 1 })
        const c = kz?.find((x) => x.t >= t && x.t < t + 86400e3)?.c ?? kz?.[0]?.c
        if (Number.isFinite(c)) {
            await merkeKurs(a, datum, c, 'Tageskerze Bitget')
            return { usd: c, quelle: 'Tageskerze Bitget' }
        }
    } catch { /* auch dort nicht */ }
    return { usd: null, quelle: 'kein Kurs' }
}
