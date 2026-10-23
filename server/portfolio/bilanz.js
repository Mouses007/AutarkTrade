/**
 * Spot-Portfolio: Bilanz „Bargeld rein ↔ Wert heute" — nur zur Information,
 * nicht für die Steuer.
 *
 * Bargeld = Fiat-Ein- und Auszahlungen (CHF/EUR/USD) aller Orte, EUR und USD
 * zum EZB-Kurs des Tages. Wurde ein Kauf direkt mit Karte bezahlt (Fiat-Saldo
 * des Orts negativ, keine Einzahlungszeile), zählt der fehlende Betrag als
 * eingezahlt.
 *
 * Wert heute = Spot-Portfolio + Guthaben auf den Futures-Börsen: Geld, das als
 * Stablecoin dorthin ging, ist nicht weg, es liegt dort. Pionex-Coin-M-Bots
 * melden ihren Wert in der Margin-Währung (SOL), nicht in USDT — umgerechnet
 * zum Spot-Kurs.
 */
import { getKnex } from '../database.js'
import { fxAm, kurseFuer } from './kurse.js'
import { getDecryptedConfig as bitunixConfig, bitunixRequest } from '../bitunix-api.js'
import { getDecryptedBitgetConfig, bitgetRequest } from '../bitget-api.js'
import { getDecryptedPionexConfig, getBotOrders } from '../pionex-api.js'
import { pionexRequest } from '../pionex-transport.js'

const FIAT = ['CHF', 'EUR', 'USD']
let speicher = null

async function zuChf(waehrung, betrag, zeit) {
    if (waehrung === 'CHF') return betrag
    const datum = new Date(Number(zeit)).toISOString().slice(0, 10)
    const usdChf = await fxAm(datum, 'CHF')
    if (!usdChf) return null
    if (waehrung === 'USD') return betrag * usdChf
    const usdEur = await fxAm(datum, 'EUR')
    return usdEur ? (betrag / usdEur) * usdChf : null
}

/** Fiat-Flüsse je Ort (rein aus den Bewegungen). */
async function bargeld() {
    const k = getKnex()
    const rows = await k('portfolio_bewegungen').select('quelle', 'zeit', 'art', 'asset', 'menge', 'gegenAsset', 'gegenMenge', 'gebuehrAsset', 'gebuehrMenge', 'einordnung', 'sicherheit')
    const je = new Map()
    const jeJahr = {}
    let ein = 0, aus = 0, abgeleitet = 0
    for (const r of rows) {
        if (r.einordnung === 'ignorieren') continue
        for (const [a, m] of [[r.asset, Number(r.menge) || 0], [r.gegenAsset, Number(r.gegenMenge) || 0], [r.gebuehrAsset, -(Number(r.gebuehrMenge) || 0)]]) {
            if (!a || !FIAT.includes(a) || !m) continue
            const key = `${r.quelle}|${a}`
            const e = je.get(key) || { quelle: r.quelle, waehrung: a, saldo: 0, ein: 0, aus: 0, einChf: 0, ausChf: 0, letzt: 0 }
            e.saldo += m
            e.letzt = Math.max(e.letzt, Number(r.zeit))
            const jahr = new Date(Number(r.zeit)).getUTCFullYear()
            if (a === r.asset && r.art === 'einzahlung' && m > 0) {
                const c = (await zuChf(a, m, r.zeit)) ?? 0
                e.ein += m; e.einChf += c; ein += c
                ;(jeJahr[jahr] ??= { ein: 0, aus: 0 }).ein += c
                if (r.sicherheit === 'abgeleitet') abgeleitet += c
            }
            if (a === r.asset && r.art === 'auszahlung' && m < 0) {
                const c = (await zuChf(a, -m, r.zeit)) ?? 0
                e.aus += -m; e.ausChf += c; aus += c
                ;(jeJahr[jahr] ??= { ein: 0, aus: 0 }).aus += c
            }
            je.set(key, e)
        }
    }
    let karte = 0
    for (const e of je.values()) {
        if (e.saldo < -0.005) {
            const c = (await zuChf(e.waehrung, -e.saldo, e.letzt)) ?? 0
            e.karteChf = c
            karte += c
        }
    }
    return { ein, aus, karte, abgeleitet, jeJahr, orte: [...je.values()] }
}

/** Guthaben auf den Futures-Börsen (USD), je Börse einzeln — eine fehlende bricht nichts. */
export async function futuresKonten() {
    const aus = []
    try {
        const c = await bitunixConfig()
        if (c?.apiKey) {
            const r = await bitunixRequest('GET', '/api/v1/futures/account', c.apiKey, c.secretKey, { marginCoin: 'USDT' })
            const a = Array.isArray(r.data) ? r.data[0] : r.data
            if (a) aus.push({ boerse: 'bitunix', name: 'Bitunix Futures', usd: ['available', 'margin', 'crossUnrealizedPNL', 'isolationUnrealizedPNL'].reduce((s, f) => s + Number(a[f] || 0), 0) - Number(a.bonus || 0) })
        }
    } catch (e) { aus.push({ boerse: 'bitunix', name: 'Bitunix Futures', usd: null, fehler: e.message }) }
    try {
        const c = await getDecryptedBitgetConfig()
        if (c?.apiKey) {
            const r = await bitgetRequest('GET', '/api/v2/account/all-account-balance', c.apiKey, c.secretKey, c.passphrase)
            const usd = (r.data || []).filter((x) => ['futures', 'margin', 'bots'].includes(x.accountType)).reduce((s, x) => s + Number(x.usdtBalance || 0), 0)
            aus.push({ boerse: 'bitget', name: 'Bitget Futures', usd })
        }
    } catch (e) { aus.push({ boerse: 'bitget', name: 'Bitget Futures', usd: null, fehler: e.message }) }
    try {
        const c = await getDecryptedPionexConfig()
        if (c?.apiKey) {
            let usd = 0
            const hinweise = []
            const fb = await pionexRequest('GET', '/uapi/v1/account/balances', c.apiKey, c.secretKey).catch(() => null)
            const summe = (arr) => (arr || []).reduce((s, x) => String(x.coin).toUpperCase() === 'USDT' ? s + Number(x.free || 0) + Number(x.frozen || 0) : s, 0)
            usd += summe(fb?.data?.balances)
            for (const iso of fb?.data?.isolates || []) usd += summe(iso.balances)
            const bots = await getBotOrders(c.apiKey, c.secretKey, { status: 'running' })
            for (const o of bots.data?.results || []) {
                const d = o.buOrderData || {}
                if (/spot/i.test(o.buOrderType || '') || /spot|token_grid/i.test(d.cateType || '')) continue   // Spot-Bots zählt das Portfolio
                const wert = Number(d.marginBalance) || 0
                const muenze = String(d.investCoin || 'USDT').toUpperCase()
                if (muenze === 'USDT' || muenze === 'USDC') usd += wert
                else {
                    const { kurse } = await kurseFuer([{ asset: muenze }])
                    const p = kurse.get(muenze)?.usd
                    if (p) { usd += wert * p; hinweise.push(`Bot ${wert.toFixed(4)} ${muenze}`) }
                }
            }
            aus.push({ boerse: 'pionex', name: 'Pionex Futures & Bots', usd, hinweis: hinweise.join(', ') || null })
        }
    } catch (e) { aus.push({ boerse: 'pionex', name: 'Pionex Futures & Bots', usd: null, fehler: e.message }) }
    return aus
}

/**
 * @param {{ spotChf: number, usdChf: number }} jetzt  aus der Übersicht
 */
export async function berechneBilanz({ spotChf, usdChf }) {
    if (speicher && Date.now() - speicher.zeit < 120e3) {
        return { ...speicher.wert, spotChf, wertChf: spotChf + speicher.wert.futuresChf, differenzChf: spotChf + speicher.wert.futuresChf - speicher.wert.nettoChf }
    }
    const b = await bargeld()
    const futures = await futuresKonten()
    const futuresChf = futures.reduce((s, f) => s + (f.usd || 0), 0) * usdChf
    const nettoChf = b.ein - b.aus + b.karte
    const wert = {
        eingezahltChf: b.ein, ausgezahltChf: b.aus, karteChf: b.karte, nettoChf, abgeleitetChf: b.abgeleitet,
        jeJahr: b.jeJahr, futures: futures.map((f) => ({ ...f, chf: f.usd != null ? f.usd * usdChf : null })), futuresChf,
    }
    speicher = { zeit: Date.now(), wert }
    return { ...wert, spotChf, wertChf: spotChf + futuresChf, differenzChf: spotChf + futuresChf - nettoChf }
}
