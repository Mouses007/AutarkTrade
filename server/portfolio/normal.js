/**
 * Spot-Portfolio: Antworten der Quellen → eine gemeinsame Bewegungsform.
 *
 * Rein — kein Netz, keine DB. Jede Quelle liefert in ihrem eigenen Dialekt;
 * hier wird daraus die Zeile, aus der Bestand, Einstand und (später) die
 * Steuer gerechnet werden. Deshalb steht hier auch die Vorzeichen-Regel, die
 * überall gelten muss:
 *
 *   menge        Veränderung von `asset`      (+ rein, − raus)
 *   gegenMenge   Veränderung von `gegenAsset` (+ rein, − raus) — bei Tausch
 *   gebuehrMenge ZUSÄTZLICH abgezogen (positiv), nur wenn sie nicht schon
 *                in `menge`/`gegenMenge` steckt
 *
 * Bestand je Asset = Σ menge + Σ gegenMenge − Σ gebuehrMenge  (`saldiere`).
 *
 * Arten (fein, weil sie sich steuerlich unterscheiden):
 *   kauf, verkauf, tausch, einzahlung, auszahlung, umbuchung, staking,
 *   airdrop, belohnung, gebuehr, sonstiges, bestand (Eröffnungsbestand aus einem Import)
 */

import { normKontrakt, istKanon, kanonKennt, ketteNorm } from './token-id.js'

export { normKontrakt }

export const ARTEN = ['kauf', 'verkauf', 'tausch', 'einzahlung', 'auszahlung', 'umbuchung', 'staking', 'airdrop', 'belohnung', 'gebuehr', 'sonstiges', 'bestand']

const zahl = (v) => {
    if (v === null || v === undefined || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
}
const gross = (s) => String(s || '').trim().toUpperCase()

function bewegung(b) {
    return {
        externeId: String(b.externeId),
        zeit: Number(b.zeit),
        art: b.art,
        asset: gross(b.asset),
        menge: b.menge ?? 0,
        gegenAsset: b.gegenAsset ? gross(b.gegenAsset) : null,
        gegenMenge: b.gegenAsset ? (b.gegenMenge ?? 0) : null,
        gebuehrAsset: b.gebuehrMenge ? gross(b.gebuehrAsset) : null,
        gebuehrMenge: b.gebuehrMenge || null,
        txHash: b.txHash || null,
        kette: b.kette || null,
        kontrakt: normKontrakt(b.kontrakt),
        roh: b.roh ?? null,
    }
}

// `normKontrakt` (Vertragsadresse vereinheitlichen) steht seit dem Audit
// FUN-PRT-001 in `token-id.js`: EVM klein, Solana (Base58) unverändert —
// RENDER war kleingeschrieben für keine Börse mehr auffindbar (25.10.2026).

// ── Bitget: /api/v2/tax/spot-record ──────────────────────────────────────

/*
 * Gemessen 22.10.2026: Σ amount je Coin ergibt den Bestand auf den Rappen.
 * `fee` war in allen Zeilen 0; ob ein Betrag ≠ 0 schon in `amount` steckt,
 * ist nicht belegt. Er wird deshalb NICHT abgezogen (sonst doppelt), sondern
 * steht im Rohfeld — der Abgleich Bestand ↔ Bewegungen zeigt, falls es nicht
 * aufgeht.
 *
 * Ein Tausch kommt als zwei Zeilen mit derselben `bizOrderId`:
 * `Consumption` (−) und `Gains` (+).
 */
const BITGET_ART = [
    [/^deposit/i, 'einzahlung'],
    [/^withdraw/i, 'auszahlung'],
    [/^transfer/i, 'umbuchung'],
    [/airdrop/i, 'airdrop'],
    [/earn|saving|staking|interest/i, 'staking'],
    [/reward|bonus|cashback|rebate|commission/i, 'belohnung'],
    [/^buy/i, 'kauf'],
    [/^sell/i, 'verkauf'],
]

export function ausBitgetSteuer(zeilen) {
    const gruppen = new Map()
    const aus = []
    for (const z of zeilen || []) {
        const typ = String(z.spotTaxType || '')
        if (/^(consumption|gains)$/i.test(typ) && z.bizOrderId) {
            const g = gruppen.get(z.bizOrderId) || []
            g.push(z)
            gruppen.set(z.bizOrderId, g)
            continue
        }
        const art = BITGET_ART.find(([re]) => re.test(typ))?.[1] || 'sonstiges'
        aus.push(bewegung({
            externeId: z.id, zeit: Number(z.ts), art, asset: z.coin, menge: zahl(z.amount) ?? 0, roh: z,
        }))
    }
    for (const [biz, g] of gruppen) {
        const minus = g.filter((z) => Number(z.amount) < 0)
        const plus = g.filter((z) => Number(z.amount) > 0)
        if (minus.length === 1 && plus.length === 1) {
            const p = plus[0], m = minus[0]
            const art = handelsArt(m.coin, p.coin)
            aus.push(bewegung({
                externeId: biz, zeit: Math.max(Number(p.ts), Number(m.ts)), art,
                asset: art === 'verkauf' ? m.coin : p.coin,
                menge: art === 'verkauf' ? zahl(m.amount) : zahl(p.amount),
                gegenAsset: art === 'verkauf' ? p.coin : m.coin,
                gegenMenge: art === 'verkauf' ? zahl(p.amount) : zahl(m.amount),
                roh: g,
            }))
        } else {
            // Unvollständiges Paar: jede Zeile für sich, damit nichts verschwindet.
            for (const z of g) aus.push(bewegung({ externeId: z.id, zeit: Number(z.ts), art: 'sonstiges', asset: z.coin, menge: zahl(z.amount) ?? 0, roh: z }))
        }
    }
    return aus.sort((a, b) => a.zeit - b.zeit)
}

/** Fiat: Ein- und Auszahlungen davon sind Bankbewegungen, keine Transfers zwischen Wallets. */
export const FIAT = ['CHF', 'EUR', 'USD', 'GBP', 'PLN', 'CZK', 'HUF', 'SEK', 'NOK', 'DKK', 'TRY', 'RON']

/** Stablecoins und Fiat: was als „Geld" gilt, damit ein Tausch Kauf oder Verkauf heisst. */
export const STABIL = { USDT: 1, USDC: 1, FDUSD: 1, DAI: 1, BUSD: 1, TUSD: 1, USDE: 1, PYUSD: 1, USD: 1, EUR: 1, CHF: 1 }

/** Geld → Coin = Kauf, Coin → Geld = Verkauf, sonst (auch Geld → Geld) Tausch. */
function handelsArt(wegAsset, herAsset) {
    const weg = gross(wegAsset) in STABIL, her = gross(herAsset) in STABIL
    if (weg && !her) return 'kauf'
    if (her && !weg) return 'verkauf'
    return 'tausch'
}

// ── Bitunix: openapi.bitunix.com /api/spot/v1/order/history/page ─────────

/*
 * Gemessen 22.10.2026 (GRASSUSDT): `side` 1 = Verkauf (Gebühr in USDT, der
 * Bestand ging auf 0), 2 = Kauf. `dealVolume` = Basismenge, `dealAmount` =
 * Quote-Betrag. Orders ohne Ausführung (`dealVolume` 0) sind keine Bewegung.
 * Die Gebühr kommt in `feeCoin`; Bitunix zieht sie vom Erlös ab, deshalb wird
 * sie hier separat geführt und nicht schon in der Menge abgezogen — die
 * Mengen der Antwort sind brutto.
 */
export function ausBitunixOrders(orders) {
    const aus = []
    for (const o of orders || []) {
        const basis = zahl(o.dealVolume) || 0
        if (basis <= 0) continue
        const quote = zahl(o.dealAmount) || 0
        const verkauf = Number(o.side) === 1
        aus.push(bewegung({
            externeId: o.orderId,
            zeit: Date.parse(o.utime || o.ctime),
            art: verkauf ? 'verkauf' : 'kauf',
            asset: o.base, menge: verkauf ? -basis : basis,
            gegenAsset: o.quote, gegenMenge: verkauf ? quote : -quote,
            gebuehrAsset: o.feeCoin, gebuehrMenge: zahl(o.fee) || null,
            roh: o,
        }))
    }
    return aus
}

// ── Pionex: /api/v1/trade/fills?symbol= ──────────────────────────────────

/*
 * Gemessen: BTC_USDT-Kauf mit `fee` in BTC. Pionex zieht die Gebühr in der
 * erhaltenen Währung ab; `size` ist brutto → Gebühr separat.
 */
export function ausPionexFills(fills) {
    const aus = []
    for (const f of fills || []) {
        const [basis, quote] = String(f.symbol || '').split('_')
        const menge = zahl(f.size) || 0
        const preis = zahl(f.price) || 0
        if (!basis || !quote || menge <= 0) continue
        const verkauf = String(f.side).toUpperCase() === 'SELL'
        aus.push(bewegung({
            externeId: f.id, zeit: Number(f.timestamp),
            art: verkauf ? 'verkauf' : 'kauf',
            asset: basis, menge: verkauf ? -menge : menge,
            gegenAsset: quote, gegenMenge: verkauf ? menge * preis : -menge * preis,
            gebuehrAsset: f.feeCoin, gebuehrMenge: zahl(f.fee) || null,
            roh: f,
        }))
    }
    return aus
}

// ── Bitpanda: GET /v1/operations ─────────────────────────────────────────

/*
 * Gemessen 23.10.2026 gegen das echte Konto (1'330 Operationen, 2019–2026):
 *   - Jede Transaktion trägt `asset_amount` (Krypto: `asset_id`, Fiat:
 *     `currency_id`) und `flow`. `fee_amount` wird IMMER ZUSÄTZLICH abgezogen
 *     — belegt über `asset_balance_after` in 2'500 Fällen (Staking-Belohnung
 *     mit 20 % Gebühr, Ein-/Auszahlung, trading_premium, Lagergebühr).
 *   - Mit dieser Regel ergibt die Summe aller Operationen für JEDEN Coin und
 *     für CHF exakt den Portfolio-Bestand.
 *   - Eine Operation kann viele Transaktionen tragen (Swap: 4, Index-Kauf
 *     und -Umschichtung: bis 50) und mehrere Teil-Wallets berühren
 *     (`shared-default`, `bci-service` = Crypto-Index, `staking-service`).
 *     Bewegungen zwischen eigenen Teil-Wallets heben sich auf; gezählt wird
 *     die Netto-Wirkung je Asset und Operation.
 *   - `operation_type` ist freier Text; die gesehenen Werte stehen in
 *     BITPANDA_ART. Unbekanntes landet als `sonstiges` in der Prüfliste.
 */
const BITPANDA_ART = {
    reward: 'staking', passive_earn_reward: 'staking',
    best_reward: 'belohnung', onetime_reward: 'belohnung', instant_trade_bonus: 'belohnung', giveaway: 'belohnung',
    airdrop: 'airdrop',
    deposit: 'einzahlung', withdrawal: 'auszahlung',
    trading_premium: 'gebuehr', metal_storage_fee: 'gebuehr',
    stake: 'umbuchung', unstake: 'umbuchung',
}

/**
 * @param {Array} ops
 * @param {Map<string,string>} symbole  asset_id bzw. currency_id → Symbol
 */
export function ausBitpandaOperationen(ops, symbole) {
    const sym = (id) => (id && symbole?.get(id)) || null
    const aus = []
    for (const op of ops || []) {
        const typ = String(op.operation_type || '').toLowerCase()
        const delta = new Map()
        let zeit = 0, unbekannt = false
        for (const t of op.transactions || []) {
            const id = t.asset_id || t.currency_id || t.asset_amount?.asset_id || t.asset_amount?.currency_id
            const s = sym(id)
            if (!s) { unbekannt = true; continue }
            const betrag = zahl(t.asset_amount?.value) || 0
            delta.set(s, (delta.get(s) || 0) + (t.flow === 'INCOMING' ? betrag : -betrag))
            const gebuehr = zahl(t.fee_amount?.value) || 0
            if (gebuehr) {
                const fs = sym(t.fee_amount.asset_id || t.fee_amount.currency_id) || s
                delta.set(fs, (delta.get(fs) || 0) - gebuehr)
            }
            zeit = Math.max(zeit, Date.parse(t.credited_at) || 0)
        }
        const teile = [...delta.entries()].filter(([, v]) => Math.abs(v) > 1e-12)
        if (!teile.length) continue
        const roh = { operation_type: op.operation_type, unbekanntesAsset: unbekannt || undefined }
        // Sparplan-Lastschrift: operation_type `savings_plan`, die Transaktion
        // selbst sagt `deposit` — die Transaktion weiss es genauer.
        const tTypen = new Set((op.transactions || []).map((t) => t.transaction_type).filter(Boolean))
        const art = BITPANDA_ART[typ] || (tTypen.size === 1 ? BITPANDA_ART[[...tTypen][0]] : undefined)
        if (teile.length === 2 && Math.sign(teile[0][1]) !== Math.sign(teile[1][1])) {
            const [plus, minus] = teile[0][1] > 0 ? teile : [teile[1], teile[0]]
            const hArt = handelsArt(minus[0], plus[0])
            const verkauf = hArt === 'verkauf'
            aus.push(bewegung({
                externeId: op.operation_id, zeit, art: hArt,
                asset: verkauf ? minus[0] : plus[0], menge: verkauf ? minus[1] : plus[1],
                gegenAsset: verkauf ? plus[0] : minus[0], gegenMenge: verkauf ? plus[1] : minus[1],
                roh,
            }))
            continue
        }
        if (teile.length === 1) {
            const [s, v] = teile[0]
            aus.push(bewegung({ externeId: op.operation_id, zeit, art: art || 'sonstiges', asset: s, menge: v, roh }))
            continue
        }
        // Viele Assets (Index-Kauf/-Umschichtung, Swap in einen Index): je Asset eine Zeile.
        for (const [s, v] of teile) {
            aus.push(bewegung({ externeId: `${op.operation_id}:${s}`, zeit, art: art || 'tausch', asset: s, menge: v, roh }))
        }
    }
    return aus.sort((x, y) => x.zeit - y.zeit)
}

// ── EVM: Etherscan V2 txlist / tokentx / txlistinternal ──────────────────

/*
 * Eine Transaktion kann mehrere Bewegungen tragen (DEX-Tausch: Token raus,
 * Token rein). Sie werden je Hash zusammengefasst: genau ein Abgang und ein
 * Zugang verschiedener Assets → Tausch, sonst je Asset eine Zeile. Die Gas-
 * Gebühr zahlt, wer die Transaktion SENDET — auch eine fehlgeschlagene.
 */
export function ausEvm({ adresse, chainId, nativ, txlist = [], tokentx = [], intern = [] }) {
    const ich = String(adresse).toLowerCase()
    const jeHash = new Map()
    const posten = (hash) => {
        let p = jeHash.get(hash)
        if (!p) { p = { zeit: 0, teile: new Map(), gebuehr: 0 }; jeHash.set(hash, p) }
        return p
    }
    const buche = (p, schluessel, asset, kontrakt, delta) => {
        const t = p.teile.get(schluessel) || { asset, kontrakt, menge: 0 }
        t.menge += delta
        p.teile.set(schluessel, t)
    }
    for (const t of txlist) {
        const p = posten(t.hash)
        p.zeit = Number(t.timeStamp) * 1000
        const von = String(t.from).toLowerCase() === ich
        const an = String(t.to).toLowerCase() === ich
        const wert = Number(t.value) / 1e18
        if (String(t.isError) !== '1' && wert) {
            if (an) buche(p, 'nativ', nativ, null, wert)
            if (von) buche(p, 'nativ', nativ, null, -wert)
        }
        if (von) p.gebuehr += (Number(t.gasUsed) * Number(t.gasPrice)) / 1e18
    }
    for (const t of intern) {
        if (String(t.isError) === '1') continue
        const p = posten(t.hash)
        p.zeit = p.zeit || Number(t.timeStamp) * 1000
        const wert = Number(t.value) / 1e18
        if (String(t.to).toLowerCase() === ich) buche(p, 'nativ', nativ, null, wert)
        if (String(t.from).toLowerCase() === ich) buche(p, 'nativ', nativ, null, -wert)
    }
    for (const t of tokentx) {
        const p = posten(t.hash)
        p.zeit = p.zeit || Number(t.timeStamp) * 1000
        const dez = Number(t.tokenDecimal) || 0
        const wert = Number(t.value) / 10 ** dez
        const k = String(t.contractAddress).toLowerCase()
        if (String(t.to).toLowerCase() === ich) buche(p, k, t.tokenSymbol, k, wert)
        if (String(t.from).toLowerCase() === ich) buche(p, k, t.tokenSymbol, k, -wert)
    }

    const aus = []
    for (const [hash, p] of jeHash) {
        const teile = [...p.teile.values()].filter((t) => Math.abs(t.menge) > 0)
        const gebuehr = p.gebuehr > 0 ? { gebuehrAsset: nativ, gebuehrMenge: p.gebuehr } : {}
        const minus = teile.filter((t) => t.menge < 0)
        const plus = teile.filter((t) => t.menge > 0)
        if (minus.length === 1 && plus.length === 1) {
            const m = minus[0], q = plus[0]
            aus.push(bewegung({
                externeId: `${chainId}:${hash}`, zeit: p.zeit, art: 'tausch',
                asset: q.asset, menge: q.menge, kontrakt: q.kontrakt,
                gegenAsset: m.asset, gegenMenge: m.menge,
                txHash: hash, kette: `evm:${chainId}`, roh: { gegenKontrakt: m.kontrakt }, ...gebuehr,
            }))
            continue
        }
        if (!teile.length && p.gebuehr > 0) {
            aus.push(bewegung({ externeId: `${chainId}:${hash}`, zeit: p.zeit, art: 'gebuehr', asset: nativ, menge: 0, txHash: hash, kette: `evm:${chainId}`, ...gebuehr }))
            continue
        }
        teile.forEach((t, i) => {
            aus.push(bewegung({
                externeId: `${chainId}:${hash}:${i}`, zeit: p.zeit,
                art: t.menge > 0 ? 'einzahlung' : 'auszahlung',
                asset: t.asset, menge: t.menge, kontrakt: t.kontrakt,
                txHash: hash, kette: `evm:${chainId}`,
                ...(i === 0 ? gebuehr : {}),
            }))
        })
    }
    return aus.sort((a, b) => a.zeit - b.zeit)
}

// ── Bitcoin: Netto-Wirkungen aus btc.js ──────────────────────────────────

export function ausBtc(wirkungen) {
    return (wirkungen || []).map((w) => {
        const netto = w.netto / 1e8
        const gebuehr = w.gebuehr / 1e8
        // `netto` enthält die Gebühr schon (Eingänge − Ausgänge). Für die
        // Anzeige trennen: der Betrag, der wirklich wegging, plus Gebühr.
        const menge = w.gebuehr ? netto + gebuehr : netto
        return bewegung({
            externeId: w.txid, zeit: w.zeit,
            art: menge > 0 ? 'einzahlung' : menge < 0 ? 'auszahlung' : 'gebuehr',
            asset: 'BTC', menge, gebuehrAsset: 'BTC', gebuehrMenge: gebuehr || null,
            txHash: w.txid, kette: 'btc',
        })
    })
}

// ── Bestand aus Bewegungen ───────────────────────────────────────────────

/** Bestand je Asset (bei Token: je Asset+Kontrakt). */
export function saldiere(bewegungen) {
    const m = new Map()
    const add = (asset, kontrakt, d) => {
        if (!asset || !d) return
        const k = kontrakt ? `${asset}|${kontrakt}` : asset
        m.set(k, (m.get(k) || 0) + d)
    }
    for (const b of bewegungen || []) {
        add(b.asset, b.kontrakt, Number(b.menge) || 0)
        if (b.gegenAsset) add(b.gegenAsset, b.roh?.gegenKontrakt || null, Number(b.gegenMenge) || 0)
        if (b.gebuehrAsset) add(b.gebuehrAsset, null, -(Number(b.gebuehrMenge) || 0))
    }
    return m
}

// ── Transfers zwischen eigenen Konten ────────────────────────────────────

/**
 * Ein Vertrag, der sicher NICHT der Coin des Kürzels ist: KANON kennt das
 * Kürzel auf dieser Kette unter einem anderen Vertrag (falscher „USDT“).
 */
function sicherFremd(z) {
    return !!z.kontrakt && kanonKennt(z.asset, z.kette) && !istKanon(z.asset, z.kontrakt, z.kette)
}

/**
 * Passen zwei Seiten eines möglichen Transfers vom Vertrag her? Gleiche Kette:
 * gleicher Vertrag. Eine Seite ohne Vertrag (Börse, Import): der Token der
 * anderen darf nicht sicher fremd sein. Verschiedene Ketten (Bridge): keiner
 * sicher fremd.
 */
function vertragPasst(o, r) {
    const ko = normKontrakt(o.kontrakt), kr = normKontrakt(r.kontrakt)
    if (ko && kr && ketteNorm(o.kette) && ketteNorm(o.kette) === ketteNorm(r.kette)) return ko === kr
    return !sicherFremd(o) && !sicherFremd(r)
}

/** Rang eines Kandidaten: ohne Vertrag oder kanonisch vor unbekanntem Vertrag. */
const vertragsRang = (z) => (!z.kontrakt || istKanon(z.asset, z.kontrakt, z.kette) ? 0 : 1)

/**
 * Paart Abgänge (`auszahlung`) mit Zugängen (`einzahlung`) an einem ANDEREN
 * Ort: gleiche txHash → sicher; sonst gleiches Asset, Eingang 0–6 h nach dem
 * Abgang (10 min Uhrenspiel), Eingang ≤ Abgang und ≥ 97 % davon (Netzgebühr).
 * Jede Zeile wird höchstens einmal gepaart; bei mehreren Kandidaten gewinnt
 * der mit belegtem Vertrag (keiner/kanonisch), dann der zeitlich nächste.
 *
 * Seit dem Audit FUN-PRT-001 zählt der Vertrag: Address-Poisoning schickt kurz
 * nach einer echten Auszahlung einen falschen „USDT“ gleicher Menge — zeitlich
 * näher als der echte Eingang. Ein sicher fremder Vertrag wird nie gepaart.
 *
 * @param {Array<{id, ort, art, asset, menge, zeit, txHash, kontrakt?, kette?}>} zeilen
 * @returns {Array<{ raus: id, rein: id, sicher: boolean }>}
 */
export function ordneTransfers(zeilen) {
    const raus = zeilen.filter((z) => z.art === 'auszahlung' && Number(z.menge) < 0)
    const rein = zeilen.filter((z) => z.art === 'einzahlung' && Number(z.menge) > 0)
    const vergeben = new Set()
    const paare = []
    // 1. gleiche txHash
    const reinNachHash = new Map()
    for (const r of rein) if (r.txHash) reinNachHash.set(`${r.txHash}|${r.asset}`, r)
    for (const o of raus) {
        const r = o.txHash && reinNachHash.get(`${o.txHash}|${o.asset}`)
        if (r && r.ort !== o.ort && !vergeben.has(r.id) && vertragPasst(o, r)) {
            paare.push({ raus: o.id, rein: r.id, sicher: true })
            vergeben.add(r.id); vergeben.add(o.id)
        }
    }
    // 2. Betrag + Zeitfenster
    const STUNDE = 3600e3
    for (const o of [...raus].sort((a, b) => a.zeit - b.zeit)) {
        if (vergeben.has(o.id)) continue
        const ab = Math.abs(Number(o.menge))
        let best = null
        for (const r of rein) {
            if (vergeben.has(r.id) || r.ort === o.ort || r.asset !== o.asset || !vertragPasst(o, r)) continue
            const dt = r.zeit - o.zeit
            if (dt < -10 * 60e3 || dt > 6 * STUNDE) continue
            const m = Number(r.menge)
            if (m > ab * 1.000001 || m < ab * 0.97) continue
            const rang = vertragsRang(r) - (best ? vertragsRang(best) : 99)
            if (!best || rang < 0 || (rang === 0 && Math.abs(dt) < Math.abs(best.zeit - o.zeit))) best = r
        }
        if (best) {
            paare.push({ raus: o.id, rein: best.id, sicher: false })
            vergeben.add(best.id); vergeben.add(o.id)
        }
    }
    return paare
}
