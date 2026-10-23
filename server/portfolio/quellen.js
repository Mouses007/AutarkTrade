/**
 * Spot-Portfolio: Abruf je Quelle (Netz). Jede Funktion liefert dieselbe Form:
 *
 *   { bestand: [{ ort, asset, menge, kontrakt?, name? }],
 *     bewegungen: [Bewegung],            // normal.js
 *     vollstaendig: boolean,             // deckt die Historie den Bestand?
 *     hinweis?: string }
 *
 * `vollstaendig` steuert den Abgleich: Bitget liefert ab Kontoeröffnung,
 * dort ist jede Abweichung ein Befund. Bitunix und Pionex finden Historie nur
 * je Handelspaar und kennen keine Ein-/Auszahlungen — dort ist eine
 * Abweichung erwartet und wird als „unvollständig" erklärt statt als Fehler.
 *
 * Gemessen gegen die echten Schlüssel am 22.10.2026 (siehe
 * docs/PLAN-SPOT-PORTFOLIO.md, Abschnitt 2.5). Bitpanda ist NICHT gemessen.
 */

import { getKnex } from '../database.js'
import { decrypt } from '../crypto.js'
import { getDecryptedBitgetConfig, bitgetRequest } from '../bitget-api.js'
import { getDecryptedConfig as bitunixConfig, bitunixRequest, BITUNIX_SPOT_URL } from '../bitunix-api.js'
import { getDecryptedPionexConfig, getBotOrders } from '../pionex-api.js'
import { pionexRequest } from '../pionex-transport.js'
import { ausBitgetSteuer, ausBitunixOrders, ausPionexFills, ausBitpandaOperationen, ausEvm, ausBtc, saldiere } from './normal.js'
import { leseXpub, leseAdresse } from './btc.js'

import { EVM_NETZE } from '../../shared/portfolio-adresse.js'
import { fxHeute } from './kurse.js'

const warte = (ms) => new Promise((r) => setTimeout(r, ms))
const TAG = 86400e3

/** Häufige Paare, die zusätzlich gefragt werden — eine leere Antwort kostet nichts. */
const STANDARD_COINS = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE', 'ADA', 'SUI', 'LINK', 'AVAX']

export class NichtEingerichtet extends Error {}

async function schluessel(name) {
    const z = await getKnex()('portfolio_schluessel').where('name', name).first().catch(() => null)
    return z?.wert ? decrypt(z.wert) : ''
}

/** Zusätzliche Coins aus den Einstellungen („SOL, GRASS"). */
async function eigenePaare() {
    const s = await getKnex()('settings').select('portfolioPaare').where('id', 1).first().catch(() => null)
    return String(s?.portfolioPaare || '').split(/[\s,;]+/).map((x) => x.trim().toUpperCase().replace(/[-_/]?USDT$/, '')).filter(Boolean)
}

/** Coins, die im Journal dieser Börse gehandelt wurden (Futures-Symbole → Basis). */
async function journalCoins(broker) {
    const k = getKnex()
    const aus = new Set()
    try {
        const zeilen = await k('trades').where('broker', broker).select('trades')
        for (const z of zeilen) {
            let t = z.trades
            if (typeof t === 'string') { try { t = JSON.parse(t) } catch { t = [] } }
            for (const x of Array.isArray(t) ? t : []) {
                const s = String(x.symbol || '').toUpperCase().replace(/_PERP$/, '').replace(/[-_]?USDT$/, '').replace(/^1000/, '')
                if (s && /^[A-Z0-9]{2,12}$/.test(s)) aus.add(s)
            }
        }
    } catch { /* Journal leer */ }
    return aus
}

// ── Bitget ───────────────────────────────────────────────────────────────

async function bitgetHole(cfg, pfad, params = {}) {
    for (let v = 0; v < 4; v++) {
        try {
            return await bitgetRequest('GET', pfad, cfg.apiKey, cfg.secretKey, cfg.passphrase, params)
        } catch (e) {
            if (/429|Too Many/i.test(e.message)) { await warte(1500 * (v + 1)); continue }
            throw e
        }
    }
    throw new Error('Bitget: zu viele Anfragen')
}

/**
 * Bestand aus `spot/account/assets`, Historie aus `tax/spot-record` — dem
 * einzigen Spot-Weg, der weiter als 90 Tage zurückreicht (30-Tage-Fenster,
 * blättern mit `idLessThan`, ~1,5 Anfragen/s lösen 429 aus).
 * @param {number|null} seit  Zeit der jüngsten gespeicherten Bewegung
 */
export async function holeBitget(seit) {
    const cfg = await getDecryptedBitgetConfig()
    if (!cfg?.apiKey || !cfg?.secretKey) throw new NichtEingerichtet('Bitget-Schlüssel fehlt')
    const assets = await bitgetHole(cfg, '/api/v2/spot/account/assets')
    const bestand = (assets.data || [])
        .map((a) => ({ ort: 'spot', asset: a.coin, menge: Number(a.available || 0) + Number(a.frozen || 0) + Number(a.locked || 0) }))
        .filter((a) => a.menge > 0)

    let start
    if (seit) start = seit - 2 * TAG
    else {
        const info = await bitgetHole(cfg, '/api/v2/spot/account/info').catch(() => null)
        start = Number(info?.data?.regisTime) || Date.now() - 3 * 365 * TAG
    }
    const zeilen = []
    const jetzt = Date.now()
    for (let a = start; a < jetzt; a += 30 * TAG) {
        const e = Math.min(a + 30 * TAG - 1, jetzt)
        let idLess = null
        for (let seite = 0; seite < 50; seite++) {
            const p = { startTime: a, endTime: e, limit: 500 }
            if (idLess) p.idLessThan = idLess
            const r = await bitgetHole(cfg, '/api/v2/tax/spot-record', p)
            await warte(700)
            const d = r.data || []
            zeilen.push(...d)
            if (d.length < 500) break
            idLess = d.map((x) => x.id).sort((x, y) => (BigInt(x) < BigInt(y) ? -1 : 1))[0]
        }
    }
    return { bestand, bewegungen: ausBitgetSteuer(zeilen), vollstaendig: true }
}

// ── Bitunix ──────────────────────────────────────────────────────────────

async function bitunixSpot(cfg, method, pfad, body) {
    for (let v = 0; v < 3; v++) {
        try {
            const r = await bitunixRequest(method, pfad, cfg.apiKey, cfg.secretKey, {}, body || '', BITUNIX_SPOT_URL)
            if (String(r?.code) !== '0') throw new Error(`Bitunix Spot: [${r?.code}] ${r?.msg || ''}`)
            return r.data
        } catch (e) {
            // Gemessen: der Spot-Host bricht gelegentlich ohne Antwort ab.
            if (v < 2 && /fetch failed|ECONNRESET|timeout|aborted/i.test(e.message)) { await warte(1500); continue }
            throw e
        }
    }
}

export async function holeBitunix() {
    const cfg = await bitunixConfig()
    if (!cfg?.apiKey || !cfg?.secretKey) throw new NichtEingerichtet('Bitunix-Schlüssel fehlt')
    const konten = await bitunixSpot(cfg, 'GET', '/api/spot/v1/user/account')
    const bestand = []
    const coins = new Set(STANDARD_COINS)
    for (const a of konten || []) {
        const menge = Number(a.balance || 0) + Number(a.balanceLocked || 0)
        if (a.coin) coins.add(String(a.coin).toUpperCase())   // auch Bestand 0: dort wurde gehandelt
        if (menge > 0) bestand.push({ ort: 'spot', asset: a.coin, menge })
    }
    for (const c of await journalCoins('bitunix')) coins.add(c)
    for (const c of await eigenePaare()) coins.add(c)
    coins.delete('USDT')

    const orders = []
    let gefragt = 0
    for (const c of coins) {
        if (gefragt++ > 80) break
        for (let seite = 1; seite <= 20; seite++) {
            let d
            try {
                d = await bitunixSpot(cfg, 'POST', '/api/spot/v1/order/history/page', { symbol: `${c}USDT`, page: seite, pageSize: 100 })
            } catch (e) {
                if (/symbol|not exist|invalid/i.test(e.message)) break   // Paar gibt es nicht
                throw e
            }
            await warte(250)
            const liste = d?.data || []
            orders.push(...liste)
            if (liste.length < 100) break
        }
    }
    return {
        bestand, bewegungen: ausBitunixOrders(orders), vollstaendig: false,
        hinweis: `Bitunix liefert Spot-Historie nur je Handelspaar (${gefragt} gefragt) und keine Ein-/Auszahlungen.`,
    }
}

// ── Pionex ───────────────────────────────────────────────────────────────

export async function holePionex() {
    const cfg = await getDecryptedPionexConfig()
    if (!cfg?.apiKey || !cfg?.secretKey) throw new NichtEingerichtet('Pionex-Schlüssel fehlt')
    const bal = await pionexRequest('GET', '/api/v1/account/balances', cfg.apiKey, cfg.secretKey)
    const bestand = []
    const coins = new Set(STANDARD_COINS)
    for (const b of bal.data?.balances || []) {
        const menge = Number(b.free || 0) + Number(b.frozen || 0)
        const c = String(b.coin || '').toUpperCase()
        if (c) coins.add(c)
        if (menge > 0) bestand.push({ ort: 'spot', asset: c, menge })
    }
    // Laufende Spot-Bots: ihr Guthaben liegt nicht im Spot-Konto. Als ein
    // Posten in USDT-Gegenwert (der Bot hält eine Mischung, Pionex meldet
    // nur den Gesamtwert).
    try {
        const r = await getBotOrders(cfg.apiKey, cfg.secretKey, { status: 'running' })
        for (const o of r.data?.results || []) {
            const d = o.buOrderData || {}
            const spot = /spot/i.test(o.buOrderType || '') || /spot|token_grid/i.test(d.cateType || '')
            if (!spot) continue
            const wert = Number(d.marginBalance) > 0 ? Number(d.marginBalance) : Number(d.initQuoteInvestment || 0) + Number(d.gridProfit || 0)
            if (wert > 0) bestand.push({ ort: 'bots', asset: 'USDT', menge: wert, name: `Bot ${d.base || ''}/${d.quote || ''}`.trim() })
            if (d.base) coins.add(String(d.base).toUpperCase())
        }
    } catch { /* Bots optional */ }
    for (const c of await journalCoins('pionex')) coins.add(c)
    for (const c of await eigenePaare()) coins.add(c)
    coins.delete('USDT')

    const fills = []
    let gefragt = 0
    for (const c of coins) {
        if (gefragt++ > 80) break
        let ende = Date.now()
        for (let seite = 0; seite < 30; seite++) {
            let r
            try {
                r = await pionexRequest('GET', '/api/v1/trade/fills', cfg.apiKey, cfg.secretKey, { symbol: `${c}_USDT`, endTime: ende })
            } catch (e) {
                if (/SYMBOL|symbol|PARAMETER/i.test(e.message)) break
                throw e
            }
            await warte(200)
            const liste = r.data?.fills || []
            fills.push(...liste)
            if (liste.length < 100) break
            ende = Math.min(...liste.map((f) => Number(f.timestamp))) - 1
        }
    }
    const eindeutig = [...new Map(fills.map((f) => [f.id, f])).values()]
    return {
        bestand, bewegungen: ausPionexFills(eindeutig), vollstaendig: false,
        hinweis: `Pionex liefert Spot-Historie nur je Handelspaar (${gefragt} gefragt) und keine Ein-/Auszahlungen; Bot-Guthaben als Gesamtwert.`,
    }
}

// ── Bitpanda (nicht gegen echte Daten geprüft) ───────────────────────────

const BITPANDA = 'https://api.public.bitpanda.com/v1'

async function bitpandaHole(key, pfad, params = {}) {
    const q = new URLSearchParams(params).toString()
    const r = await fetch(`${BITPANDA}${pfad}${q ? '?' + q : ''}`, { headers: { 'X-Api-Key': key, accept: 'application/json' }, signal: AbortSignal.timeout(20000) })
    const d = await r.json().catch(() => null)
    if (!r.ok) throw new Error(`Bitpanda ${r.status}${d?.error?.code ? ' ' + d.error.code : ''}`)
    return d
}

/** Cursor-Blättern mit Schutz gegen die bekannte Schleife (gleicher Cursor zurück). */
async function bitpandaAlle(key, pfad, params) {
    const aus = []
    let cursor = null
    const gesehen = new Set()
    for (let i = 0; i < 200; i++) {
        const d = await bitpandaHole(key, pfad, { ...params, page_size: 100, ...(cursor ? { cursor } : {}) })
        aus.push(...(d.data || []))
        if (!d.has_next_page || !d.next_cursor || gesehen.has(d.next_cursor)) break
        gesehen.add(d.next_cursor)
        cursor = d.next_cursor
        await warte(200)
    }
    return aus
}

export async function testeBitpanda(key) {
    await bitpandaHole(key, '/portfolio')
    return true
}

export async function holeBitpanda(seit, alterStand = {}) {
    const key = await schluessel('bitpanda')
    if (!key) throw new NichtEingerichtet('Bitpanda-Schlüssel fehlt')
    const portfolio = (await bitpandaHole(key, '/portfolio')).data || []
    const params = seit ? { from: new Date(seit - 2 * TAG).toISOString() } : {}
    const ops = await bitpandaAlle(key, '/operations', params)

    // Symbole zu den IDs: Krypto/Aktien über /assets, Fiat über /currencies.
    // Symbole: Fiat über /currencies (ein Abruf), Krypto/Aktien/Metalle über
    // /assets je ID. Die IDs sind stabil — gemerkt in `stand.symbole`, damit
    // ein Folgelauf nur neue nachfragt.
    const symbole = new Map(Object.entries(alterStand.symbole || {}))
    try {
        for (const c of (await bitpandaHole(key, '/currencies')).data || []) symbole.set(c.id, c.symbol || c.code)
    } catch { /* Fiat ohne Namen → bleibt sichtbar als unbekannt */ }
    const ids = new Set(portfolio.map((p) => p.asset_id).filter(Boolean))
    for (const o of ops) for (const t of o.transactions || []) if (t.asset_id) ids.add(t.asset_id)
    for (const id of ids) {
        if (symbole.has(id)) continue
        const d = await bitpandaHole(key, '/assets', { id }).catch(() => ({ data: [] }))
        for (const a of d.data || []) symbole.set(a.id, a.symbol)
        await warte(120)
    }

    // `currency_balance` ist Bitpandas eigene Bewertung der Position (in der
    // Währung `currency_id`, gemessen: EUR). Daraus ein Kurs je Einheit in USD
    // — nur als Ersatz für Coins, die keine Börse führt (CSPR, DUEL, MBTN …).
    let usdJeEur = null
    try { usdJeEur = 1 / (await fxHeute()).eur } catch { /* ohne Ersatzkurs */ }
    const bestand = portfolio
        .map((p) => {
            const menge = Number(p.balance?.value || 0)
            const wert = Number(p.currency_balance?.value)
            const waehrung = symbole.get(p.currency_balance?.currency_id)
            let kursUsd = null
            if (menge > 0 && wert > 0 && waehrung === 'EUR' && usdJeEur) kursUsd = (wert / menge) * usdJeEur
            else if (menge > 0 && wert > 0 && ['USD', 'USDT', 'USDC'].includes(waehrung)) kursUsd = wert / menge
            return { ort: 'konto', asset: symbole.get(p.asset_id || p.currency_id) || p.asset_id || p.currency_id, menge, kursUsd }
        })
        .filter((b) => b.menge > 0)
    return {
        // Die Historie reicht ab Kontoeröffnung (gemessen: 2019); Folgeläufe
        // holen ab der jüngsten Bewegung nach — der Bestand bleibt nachrechenbar.
        bestand, bewegungen: ausBitpandaOperationen(ops, symbole), vollstaendig: true,
        stand: { symbole: Object.fromEntries(symbole) },
        hinweis: seit ? null : `Bitpanda: ${ops.length} Operationen gelesen.`,
    }
}

// ── EVM (MetaMask, SafePal, Ledger) ──────────────────────────────────────

const RPC = {
    1: 'https://ethereum-rpc.publicnode.com', 42161: 'https://arbitrum-one-rpc.publicnode.com',
    8453: 'https://base-rpc.publicnode.com', 10: 'https://optimism-rpc.publicnode.com',
    56: 'https://bsc-rpc.publicnode.com', 137: 'https://polygon-bor-rpc.publicnode.com',
    43114: 'https://avalanche-c-chain-rpc.publicnode.com',
}

async function etherscan(key, chainId, params) {
    const q = new URLSearchParams({ chainid: String(chainId), ...params, apikey: key }).toString()
    for (let v = 0; v < 3; v++) {
        const r = await fetch(`https://api.etherscan.io/v2/api?${q}`, { signal: AbortSignal.timeout(20000) })
        const d = await r.json().catch(() => null)
        await warte(260)   // Gratis-Tarif: 5/s für ALLE Ketten zusammen
        if (d?.status === '1') return d.result
        const txt = String(d?.result || d?.message || r.status)
        if (/No transactions found|No records found/i.test(txt) || (d?.message === 'No transactions found')) return []
        if (/rate limit/i.test(txt)) { await warte(1200); continue }
        throw new Error(txt)
    }
    throw new Error('Etherscan: Ratenlimit')
}

async function rpcSaldo(chainId, adresse) {
    const r = await fetch(RPC[chainId], {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [adresse, 'latest'] }),
        signal: AbortSignal.timeout(15000),
    })
    const d = await r.json()
    if (!d?.result) throw new Error(d?.error?.message || 'RPC ohne Antwort')
    return Number(BigInt(d.result)) / 1e18
}

/**
 * Eine EVM-Adresse auf mehreren Netzen. Mit Etherscan-Schlüssel: Bestand
 * (nativ + Token aus der Historie) und Bewegungen; ohne Schlüssel oder für
 * ein Netz, das der Gratis-Tarif nicht abdeckt: nur der native Bestand über
 * einen öffentlichen Knoten.
 */
export async function holeEvm(adresse, netze) {
    const key = await schluessel('etherscan')
    const bestand = [], bewegungen = [], hinweise = [], nurNativ = []
    let vollstaendig = true
    for (const id of netze) {
        const netz = EVM_NETZE.find((n) => n.id === Number(id))
        if (!netz) continue
        const ort = `evm:${netz.id}`
        if (netz.nurBestand) {
            try { bestand.push(...(await holeVechain(adresse))) } catch (e) { hinweise.push(`${netz.name}: ${e.message}`) }
            vollstaendig = false
            continue
        }
        if (key) {
            try {
                const saldo = Number(await etherscan(key, netz.id, { module: 'account', action: 'balance', address: adresse, tag: 'latest' })) / 1e18
                const gemeinsam = { module: 'account', address: adresse, startblock: 0, endblock: 99999999, sort: 'asc', page: 1, offset: 10000 }
                const txlist = await etherscan(key, netz.id, { ...gemeinsam, action: 'txlist' })
                const tokentx = await etherscan(key, netz.id, { ...gemeinsam, action: 'tokentx' })
                const intern = await etherscan(key, netz.id, { ...gemeinsam, action: 'txlistinternal' })
                const b = ausEvm({ adresse, chainId: netz.id, nativ: netz.nativ, txlist, tokentx, intern })
                bewegungen.push(...b)
                if (saldo > 0) bestand.push({ ort, asset: netz.nativ, menge: saldo })
                // Token-Bestand aus der Historie (der Gratis-Tarif hat keinen Token-Saldo-Abruf).
                for (const [k, menge] of saldiere(b)) {
                    if (!k.includes('|') || menge <= 1e-12) continue
                    const [asset, kontrakt] = k.split('|')
                    bestand.push({ ort, asset, kontrakt, menge })
                }
                continue
            } catch (e) {
                hinweise.push(`${netz.name}: ${e.message}`)
            }
        }
        try {
            const saldo = await rpcSaldo(netz.id, adresse)
            if (saldo > 0) bestand.push({ ort, asset: netz.nativ, menge: saldo })
            vollstaendig = false
            if (!key) nurNativ.push(netz.name)
        } catch (e) {
            hinweise.push(`${netz.name}: ${e.message}`)
            vollstaendig = false
        }
    }
    if (nurNativ.length) hinweise.unshift(`Ohne Etherscan-Schlüssel nur die Hauptwährung (${nurNativ.join(', ')}) — keine Token, keine Historie.`)
    return { bestand, bewegungen, vollstaendig, hinweis: hinweise.join(' · ') || null }
}

// ── VeChain (nur Bestand) ────────────────────────────────────────────────

/** VET und VTHO (Energie, entsteht passiv aus gehaltenem VET) — gemessen 23.10.2026. */
async function holeVechain(adresse) {
    const r = await fetch(`https://mainnet.vechain.org/accounts/${adresse}`, { signal: AbortSignal.timeout(15000) })
    if (!r.ok) throw new Error(`VeChain ${r.status}`)
    const d = await r.json()
    const aus = []
    const vet = Number(BigInt(d.balance || '0x0')) / 1e18
    const vtho = Number(BigInt(d.energy || '0x0')) / 1e18
    if (vet > 0) aus.push({ ort: 'evm:100009', asset: 'VET', menge: vet })
    if (vtho > 0) aus.push({ ort: 'evm:100009', asset: 'VTHO', menge: vtho })
    return aus
}

// ── XRP (nur Bestand) ────────────────────────────────────────────────────

export async function holeXrp(adresse) {
    const r = await fetch('https://xrplcluster.com', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method: 'account_info', params: [{ account: adresse, ledger_index: 'validated' }] }),
        signal: AbortSignal.timeout(15000),
    })
    const d = await r.json()
    if (d.result?.error === 'actNotFound') return { bestand: [], bewegungen: [], vollstaendig: false, hinweis: 'Konto noch nicht aktiviert.' }
    if (!d.result?.account_data) throw new Error(d.result?.error_message || d.result?.error || 'XRPL ohne Antwort')
    const xrp = Number(d.result.account_data.Balance) / 1e6
    return {
        bestand: xrp > 0 ? [{ ort: 'xrp', asset: 'XRP', menge: xrp }] : [],
        bewegungen: [], vollstaendig: false,
        hinweis: 'XRP: nur der Bestand (inkl. Reserve), keine Historie.',
    }
}

// ── Bitcoin ──────────────────────────────────────────────────────────────

export async function holeBtc(wert, art, stand = {}) {
    const vorher = stand.zaehler || {}
    const d = art === 'adresse' ? await leseAdresse(wert, vorher) : await leseXpub(wert, vorher)
    return {
        bestand: d.sats > 0 ? [{ ort: 'btc', asset: 'BTC', menge: d.sats / 1e8 }] : [],
        bewegungen: ausBtc(d.bewegungen),
        vollstaendig: true,
        stand: { zaehler: d.zaehler },
        hinweis: art === 'adresse' ? null : `${d.adressen} benutzte Adressen`,
    }
}

// ── Solana (nur Bestand) ─────────────────────────────────────────────────

const SOLANA_RPC = 'https://api.mainnet-beta.solana.com'
const TOKEN_PROGRAMME = ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb']

async function solRpc(method, params) {
    for (let v = 0; v < 3; v++) {
        const r = await fetch(SOLANA_RPC, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
            signal: AbortSignal.timeout(20000),
        })
        if (r.status === 429) { await warte(2000 * (v + 1)); continue }
        const d = await r.json()
        if (d.error) throw new Error(d.error.message)
        return d.result
    }
    throw new Error('Solana-RPC: zu viele Anfragen')
}

export async function holeSol(adresse) {
    const bestand = []
    const lamports = (await solRpc('getBalance', [adresse]))?.value || 0
    if (lamports > 0) bestand.push({ ort: 'sol', asset: 'SOL', menge: lamports / 1e9 })
    for (const programmId of TOKEN_PROGRAMME) {
        const r = await solRpc('getTokenAccountsByOwner', [adresse, { programId: programmId }, { encoding: 'jsonParsed' }])
        for (const k of r?.value || []) {
            const info = k.account?.data?.parsed?.info
            const menge = Number(info?.tokenAmount?.uiAmount || 0)
            if (info?.mint && menge > 0) bestand.push({ ort: 'sol', asset: info.mint.slice(0, 6), kontrakt: info.mint, menge, ohneSymbol: true })
        }
    }
    return { bestand, bewegungen: [], vollstaendig: false, hinweis: 'Solana: nur der Bestand, noch keine Historie.' }
}
