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
// Darunter (dünner Pool) gilt der Preis nur, wenn der Bestand höchstens ein
// Viertel der Pool-Liquidität wert ist: ein Rest von 5 USD in einem 200-USD-Pool
// ist realistisch bewertet, 60'000 Spam-Token zu einem Fantasiepreis nicht.
const MIN_LIQ_DUENN = 100
const DUENN_ANTEIL = 0.25
const FX_TTL = 60 * 60e3
const MARKT_TTL = 60e3

/** Umbenennungen und verpackte Coins → das Symbol, unter dem es einen Kurs gibt. */
const ALIAS = { BTT: 'BTTC', MIOTA: 'IOTA', WETH: 'ETH', WBTC: 'BTC', WBNB: 'BNB', WPOL: 'POL', WMATIC: 'POL', MATIC: 'POL', WAVAX: 'AVAX', WSOL: 'SOL', BTCB: 'BTC', CHSB: 'BORG' }

/** DexScreener-Namen der Ketten. */
export const DEX_KETTE = { 'evm:1': 'ethereum', 'evm:42161': 'arbitrum', 'evm:8453': 'base', 'evm:10': 'optimism', 'evm:56': 'bsc', 'evm:137': 'polygon', 'evm:43114': 'avalanche', sol: 'solana' }

/** Kettenname einer Datei/Quelle → interner Schlüssel (evm:<chainid> bzw. sol). */
const KETTEN_NAMEN = { ethereum: 'evm:1', eth: 'evm:1', bsc: 'evm:56', bnb: 'evm:56', polygon: 'evm:137', matic: 'evm:137', arbitrum: 'evm:42161', base: 'evm:8453', optimism: 'evm:10', avalanche: 'evm:43114', solana: 'sol', sol: 'sol' }
export function ketteNorm(k) {
    const t = String(k || '').trim().toLowerCase()
    if (!t) return null
    if (/^evm:\d+$/.test(t)) return t
    return KETTEN_NAMEN[t] || null
}

/**
 * Ist ein Token (Vertrag auf einer Kette) derselbe Coin wie das gleichnamige
 * Börsenpaar? Viele Wallet-Token heissen wie ein Börsen-Coin, sind es aber
 * nicht („AI", „MAGA", „SOUTH"). Belegt wird es über den HEUTIGEN Preis:
 * DexScreener für den Vertrag gegen den Börsenkurs des Symbols, ±25 %.
 * Unbekannt (einer der beiden fehlt) heisst: nicht derselbe.
 */
/*
 * Verträge, die nachweislich DER Coin des Börsenpaars sind (Ethereum-Mainnet).
 * Für sie fehlt sonst der Kurs, wenn DexScreener keinen liquiden Pool findet —
 * gehandelt wird BNT, GRT, ILV … an den Börsen, nicht auf der Kette.
 */
const KANON = {
    // Fiat24 (SafePal-Karte): auf der Kette geprüft 25.10.2026 — name „Fiat24 CHF“, 2 Dezimalen.
    'evm:42161': { '0xd41f1f0cf89fd239ca4c1f8e8ada46345c86b0a4': 'CHF24' },
    'evm:1': {
        '0xdac17f958d2ee523a2206206994597c13d831ec7': 'USDT', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'USDC',
        '0xae7ab96520de3a18e5e111b5eaab095312d7fe84': 'STETH', '0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0': 'MATIC',
        '0xc944e90c64b2c07662a292be6244bdf05cda44a7': 'GRT', '0x1f573d6fb3f13d689ff844b4ce37794d79a7ff1c': 'BNT',
        '0x767fe9edc9e0df98e07454847909b5e959d7ca0e': 'ILV', '0x4e15361fd6b4bb609fa63c81a2be19d873717870': 'FTM',
        '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 'WBTC', '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 'WETH',
        '0x514910771af9ca656af840dff83e8264ecf986ca': 'LINK', '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984': 'UNI',
        '0x64d0f55cd8c7133a9d7102b13987235f486f2224': 'BORG',
    },
}

/**
 * Coins, die keine der Börsen (Binance, Bitget) als Spot-Paar führt, aber auf
 * einer DEX handeln: Bestand ohne Kontrakt (z. B. BORG im SwissBorg-Import)
 * wird über den kanonischen Vertrag bewertet.
 */
const NUR_DEX = { BORG: { kette: 'evm:1', kontrakt: '0x64d0f55cd8c7133a9d7102b13987235f486f2224' } }

/**
 * Geld-Tokens mit festem Wert: Fiat24 bucht Franken als CHF24 auf Arbitrum. Gilt
 * nur für den kanonischen Vertrag (KANON) — „CHF24“ kann jeder Token heissen.
 */
export const GELD_TOKEN = { CHF24: 'CHF' }
export function geldTokenWaehrung(asset, kontrakt, kette) {
    const a = String(asset ?? '').toUpperCase()
    const w = GELD_TOKEN[a]
    if (!w) return null
    if (kontrakt && KANON[ketteNorm(kette)]?.[String(kontrakt).toLowerCase()] !== a) return null
    return w
}

export async function gleicherCoin(asset, kontrakt, kette) {
    const k = ketteNorm(kette)
    if (!kontrakt || !k) return false
    if (KANON[k]?.[String(kontrakt).toLowerCase()] === String(asset).toUpperCase()) return true
    const { kurse } = await kurseFuer([{ asset, kontrakt, kette: k }, { asset }])
    const dex = kurse.get(`${String(asset).toUpperCase()}|${kontrakt}`)?.usd
    const boerse = kurse.get(String(asset).toUpperCase())?.usd
    if (!(dex > 0) || !(boerse > 0)) return false
    const r = dex / boerse
    return r > 0.8 && r < 1.25
}

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
                if (!Number.isFinite(preis) || preis <= 0 || liq < MIN_LIQ_DUENN) continue
                const duenn = liq < MIN_LIQUIDITAET
                const alt = aus.get(kk)
                if (!alt || liq > alt.liq) aus.set(kk, { usd: preis, liq, duenn, symbol: p.baseToken?.symbol, quelle: duenn ? 'DexScreener (dünner Pool)' : 'DexScreener' })
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
            const geld = geldTokenWaehrung(p.asset, p.kontrakt, kette)
            if (geld) { kurse.set(key, { usd: geld === 'CHF' ? 1 / fx.chf : 1 / fx.eur, quelle: `Fiat24 · 1 ${p.asset} = 1 ${geld}` }); continue }
            let t = d.get(kette === 'sol' ? p.kontrakt : String(p.kontrakt).toLowerCase()) || d.get(p.kontrakt)
            if (t?.duenn) {
                const menge = posten.filter((x) => x.kontrakt === p.kontrakt && x.kette === kette).reduce((s, x) => s + Math.abs(Number(x.menge) || 0), 0)
                if (!(menge > 0) || menge * t.usd > t.liq * DUENN_ANTEIL) t = null
            }
            // Ein bekannter Stablecoin MIT Kontrakt bekommt trotzdem nur dann
            // 1 USD, wenn DexScreener ihn kennt — „USDT" kann jeder Token heissen.
            kurse.set(key, t ? { usd: t.usd, quelle: t.quelle, symbol: t.symbol } : { usd: null, quelle: 'kein verlässlicher Kurs' })
        }
    }
    // Ohne Börsenpaar, aber mit bekanntem DEX-Vertrag (BORG): dort nachfragen.
    const nurDex = [...kurse].filter(([key, k]) => k.usd == null && !key.includes('|') && NUR_DEX[ALIAS[key] || key])
    for (const [key] of nurDex) {
        const v = NUR_DEX[ALIAS[key] || key]
        const t = (await dexKurse(v.kette, [v.kontrakt])).get(v.kontrakt)
        if (t && !t.duenn) kurse.set(key, { usd: t.usd, quelle: 'DexScreener' })
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

// ── Bitpanda: Kurse für Coins, die weder Binance noch Bitget führen ──
// (CSPR, WSI, DUEL …). Öffentlicher Endpunkt, gemessen 25.10.2026:
// `/v3/ohlc/{coin}/CHF/year` = Tageskerzen der letzten 365 Tage,
// `/five-years` = Wochenkerzen. Von/Bis werden ignoriert. Kerzenbeginn ist
// 00:00 UTC. Der Kurs kommt direkt in CHF, ohne Umweg über USD.
const BITPANDA_OHLC = 'https://api.bitpanda.com/v3/ohlc'
const bitpandaSpeicher = new Map()   // `${coin}|${zeitraum}` → { zeit, kerzen }

/**
 * Kerze für einen Kalendertag (rein). Tageskerzen: die Kerze, die an diesem Tag
 * (UTC) beginnt, Schlusskurs. Wochenkerzen: die Woche, die den Tag enthält —
 * ihr Eröffnungskurs, also bis zu sechs Tage vor dem Stichtag (deshalb `ungefaehr`).
 * @param {{t:number, o:number, c:number}[]} kerzen  t = Beginn in ms
 */
export function waehleBitpandaKerze(kerzen, datum, art) {
    const tag = Date.parse(datum + 'T00:00:00Z')
    if (art === 'tag') {
        const k = kerzen.find((x) => x.t === tag)
        return k && k.c > 0 ? { chf: k.c, ungefaehr: false } : null
    }
    const k = kerzen.find((x) => x.t <= tag && tag < x.t + 7 * 86400e3)
    return k && k.o > 0 ? { chf: k.o, ungefaehr: true } : null
}

async function bitpandaKerzen(coin, zeitraum) {
    const key = `${coin}|${zeitraum}`
    const alt = bitpandaSpeicher.get(key)
    if (alt && Date.now() - alt.zeit < 3600e3) return alt.kerzen
    const r = await fetch(`${BITPANDA_OHLC}/${encodeURIComponent(coin)}/CHF/${zeitraum}`, { signal: AbortSignal.timeout(15000) })
    if (!r.ok) { bitpandaSpeicher.set(key, { zeit: Date.now(), kerzen: [] }); return [] }
    const d = await r.json()
    const kerzen = (d?.data || []).map((x) => ({
        t: Number(x.attributes?.time?.unix) * 1000, o: Number(x.attributes?.open), c: Number(x.attributes?.close),
    })).filter((x) => Number.isFinite(x.t))
    bitpandaSpeicher.set(key, { zeit: Date.now(), kerzen })
    return kerzen
}

/** Kurs in CHF am Tag `datum` laut Bitpanda, oder null. */
export async function bitpandaKursChf(asset, datum) {
    const coin = String(asset).toUpperCase()
    const tag = Date.parse(datum + 'T00:00:00Z')
    try {
        if (Date.now() - tag < 360 * 86400e3) {
            const k = waehleBitpandaKerze(await bitpandaKerzen(coin, 'year'), datum, 'tag')
            if (k) return { ...k, quelle: 'Bitpanda Tageskerze' }
        }
        const k = waehleBitpandaKerze(await bitpandaKerzen(coin, 'five-years'), datum, 'woche')
        if (k) return { ...k, quelle: 'Bitpanda Wochenkerze (≈)' }
    } catch { /* Bitpanda nicht erreichbar → kein Kurs */ }
    return null
}

// ── CoinGecko: Coins, die keine unserer Börsen und Bitpanda nicht führt ──
// Nur mit bekannter CoinGecko-ID — ein Kürzel allein ist dort mehrdeutig.
// Ohne eigenen Schlüssel reicht der Verlauf 365 Tage zurück (gemessen 25.10.2026).
const COINGECKO_ID = { BORG: 'swissborg', CHSB: 'swissborg' }

/** Kurs in CHF am Tag `datum` laut CoinGecko, oder null. */
// Ein vergangener Tageskurs ändert sich nicht mehr: gefundene merken. Der
// öffentliche Zugang erlaubt nur wenige Abfragen je Minute — auf der NAS fiel
// BORG am 26.10.2026 deshalb auf den Kaufpreis zurück (907 statt 378 CHF).
const cgGemerkt = new Map()   // `${id}|${datum}` → { chf, quelle }

export async function coingeckoKursChf(asset, datum) {
    const id = COINGECKO_ID[String(asset).toUpperCase()]
    if (!id) return null
    const key = `${id}|${datum}`
    if (cgGemerkt.has(key)) return cgGemerkt.get(key)
    const { cgHole } = await import('../quellen/coingecko.js')
    const [j, m, t] = datum.split('-')
    for (let versuch = 0; versuch < 2; versuch++) {
        try {
            const d = await cgHole(`/coins/${id}/history`, { date: `${t}-${m}-${j}`, localization: 'false' })
            const chf = Number(d?.market_data?.current_price?.chf)
            if (!(chf > 0)) return null
            const r = { chf, quelle: 'CoinGecko' }
            if (datum < new Date().toISOString().slice(0, 10)) cgGemerkt.set(key, r)
            return r
        } catch (e) {
            // Mengenlimit (429): einmal kurz warten; Schlüssel fehlt / älter als 365 Tage: aufgeben
            const status = e?.response?.status
            if (status !== 429 && status < 500) return null
            if (versuch === 0) await new Promise((r) => setTimeout(r, 2500))
        }
    }
    return null
}

/**
 * Tagesschlusskurs in USD (für die eingefrorene CHF-Bewertung einer Bewegung).
 * Nur Börsen-Coins; ein Token ohne Börsenpaar bleibt `null`.
 */
// „Kein Paar an dieser Börse" merken: sonst fragt jede Steuerrechnung für jeden
// Coin ohne Börsenpaar wieder Binance UND Bitget (gemessen ~0,5 s je Coin und
// Jahr — 30 tote Coins × 2 Stichtage = eine halbe Minute, 26.10.2026).
const KEIN_KURS_TTL = 6 * 3600e3
const keinKurs = new Map()   // `${asset}|${datum}` → Zeitpunkt

export async function tagesKursUsd(asset, datum) {
    const a = ALIAS[String(asset).toUpperCase()] || String(asset).toUpperCase()
    if (a in STABIL && a !== 'EUR' && a !== 'CHF') return { usd: 1, quelle: 'Stablecoin' }
    const k = getKnex()
    const z = await k('portfolio_kurse').where({ schluessel: a, datum }).first().catch(() => null)
    if (z) return { usd: z.usd, quelle: z.quelle }
    const merkKey = `${a}|${datum}`
    if (Date.now() - (keinKurs.get(merkKey) || 0) < KEIN_KURS_TTL) return { usd: null, quelle: 'kein Kurs' }
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
    keinKurs.set(merkKey, Date.now())
    return { usd: null, quelle: 'kein Kurs' }
}
