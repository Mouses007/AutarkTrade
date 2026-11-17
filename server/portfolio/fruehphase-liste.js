/**
 * Spot-Portfolio: die Seite „Frühphase“ — Hochrisiko-Coins, die man von Hand
 * auf eine Liste setzt und deren Kurs man verfolgt (Token mit Vertrag auf
 * einer Kette, z. B. von einem Launchpad). Nicht zu verwechseln mit der
 * Frühphase des Hype-Radars (`server/hype-radar/fruehphase.js`): die sucht
 * Kandidaten, diese Liste führt, was man selbst gekauft hat.
 *
 * Kurs, Marktkapitalisierung und Liquidität kommen von DexScreener (Paar mit
 * der grössten Liquidität). Anders als in der Übersicht gibt es hier KEINE
 * Liquiditätsschwelle: die Liste ist für dünne Pools gemacht, die Seite zeigt
 * die Liquidität und warnt darunter. In die Übersicht und den Steuerbericht
 * fliesst nichts von hier.
 *
 * Menge: von Hand, sonst der Bestand derselben Vertragsadresse in den eigenen
 * Wallets. Einsatz (USD) von Hand — Solana liefert keine Historie, der Kauf
 * steht also in keiner Bewegung.
 *
 * Verlauf: ein Messpunkt je Token höchstens alle 5 Minuten (beim Öffnen der
 * Seite und im Portfolio-Takt), 90 Tage lang.
 *
 * Rein (ohne DB, ohne Netz): `leseAdresse`, `waehlePaar`, `rechneZeile`,
 * `verdichte`. Selbsttest `__selftest-fruehphase-liste.mjs`.
 */

import { getKnex } from '../database.js'
import { DEX_KETTE, fxHeute } from './kurse.js'
import { bestaendeOhneDoppelte } from './uebersicht.js'

export const MAX_TOKEN = 50
export const DUENN_USD = 10000
const MESS_ABSTAND_MS = 5 * 60e3
const VERLAUF_TAGE = 90
const VERLAUF_PUNKTE = 96

const SOL_ADRESSE = /[1-9A-HJ-NP-Za-km-z]{32,44}/g
const EVM_ADRESSE = /0x[0-9a-fA-F]{40}/

/**
 * Vertragsadresse aus einer Eingabe: die Adresse selbst oder ein Link, der sie
 * enthält (Launchpad, DexScreener). EVM vor Solana — eine 0x-Adresse besteht
 * auch aus Base58-Zeichen. Bei mehreren Solana-Treffern zählt der letzte (in
 * einem Link steht der Vertrag hinten).
 * @returns {{art: 'evm'|'sol', adresse: string}|null}
 */
export function leseAdresse(text) {
    const s = String(text || '').trim()
    if (!s || s.length > 400) return null
    const evm = s.match(EVM_ADRESSE)
    if (evm) return { art: 'evm', adresse: evm[0].toLowerCase() }
    const sol = s.match(SOL_ADRESSE)
    if (sol) return { art: 'sol', adresse: sol[sol.length - 1] }
    return null
}

const gleicherVertrag = (kette, a, b) => (kette === 'sol' ? String(a) === String(b) : String(a).toLowerCase() === String(b).toLowerCase())

/**
 * Das Paar eines Tokens mit der grössten Liquidität und gültigem Preis. Paare
 * ohne Liquiditätsangabe (Bonding Curve eines Launchpads) zählen mit 0 — sie
 * gewinnen nur, wenn es kein anderes gibt.
 */
export function waehlePaar(paare, kette, kontrakt) {
    let best = null
    for (const p of Array.isArray(paare) ? paare : []) {
        if (!gleicherVertrag(kette, p?.baseToken?.address, kontrakt)) continue
        const usd = Number(p.priceUsd)
        if (!Number.isFinite(usd) || usd <= 0) continue
        const liq = Number(p.liquidity?.usd) || 0
        if (!best || liq > best.liq) {
            const zahl = (v) => (Number.isFinite(Number(v)) && v != null ? Number(v) : null)
            best = {
                usd, liq, liqBekannt: p.liquidity?.usd != null,
                mc: zahl(p.marketCap) ?? zahl(p.fdv),
                symbol: p.baseToken?.symbol ? String(p.baseToken.symbol).slice(0, 24) : null,
                name: p.baseToken?.name ? String(p.baseToken.name).slice(0, 60) : null,
                dex: p.dexId ? String(p.dexId).slice(0, 24) : null,
                aenderung: { m5: zahl(p.priceChange?.m5), h1: zahl(p.priceChange?.h1), h6: zahl(p.priceChange?.h6), h24: zahl(p.priceChange?.h24) },
                volumen24: zahl(p.volume?.h24),
                paarSeit: zahl(p.pairCreatedAt),
            }
        }
    }
    return best
}

/**
 * Eine Zeile der Seite aus Listeneintrag, Paar, Wallet-Bestand und Wechselkurs.
 * Fehlt das Paar, bleiben Kurs und Wert `null` — nie 0.
 */
export function rechneZeile(token, paar, walletMenge, chfJeUsd) {
    const vonHand = token.menge != null && Number(token.menge) > 0
    const menge = vonHand ? Number(token.menge) : (walletMenge > 0 ? walletMenge : null)
    const usd = paar?.usd ?? null
    const wertUsd = usd != null && menge != null ? usd * menge : null
    const einsatzUsd = token.einsatzUsd != null && Number(token.einsatzUsd) > 0 ? Number(token.einsatzUsd) : null
    const einstiegUsd = einsatzUsd != null && menge ? einsatzUsd / menge : null
    const start = Number(token.kursBeiAufnahme) > 0 ? Number(token.kursBeiAufnahme) : null
    return {
        id: token.id, kette: token.kette, kontrakt: token.kontrakt,
        symbol: paar?.symbol || token.symbol || String(token.kontrakt).slice(0, 6),
        name: paar?.name || token.name || null,
        notiz: token.notiz || '', seit: Number(token.createdAt) || null,
        usd, mc: paar?.mc ?? null, liq: paar ? paar.liq : null, liqBekannt: !!paar?.liqBekannt,
        duenn: !!paar && paar.liq < DUENN_USD,
        dex: paar?.dex || null, aenderung: paar?.aenderung || null, volumen24: paar?.volumen24 ?? null, paarSeit: paar?.paarSeit ?? null,
        menge, mengeVonHand: vonHand, walletMenge: walletMenge > 0 ? walletMenge : null,
        wertUsd, wertChf: wertUsd != null && chfJeUsd > 0 ? wertUsd * chfJeUsd : null,
        einsatzUsd, einstiegUsd,
        gewinnUsd: wertUsd != null && einsatzUsd != null ? wertUsd - einsatzUsd : null,
        gewinnAnteil: wertUsd != null && einsatzUsd != null ? wertUsd / einsatzUsd - 1 : null,
        kursBeiAufnahme: start, mcBeiAufnahme: Number(token.mcBeiAufnahme) > 0 ? Number(token.mcBeiAufnahme) : null,
        seitAufnahme: usd != null && start ? usd / start - 1 : null,
        ohneKurs: !paar,
    }
}

/** Verlauf auf höchstens `max` Punkte: gleichmässig ausgedünnt, erster und letzter bleiben. */
export function verdichte(punkte, max = VERLAUF_PUNKTE) {
    if (punkte.length <= max) return punkte
    const aus = []
    const schritt = (punkte.length - 1) / (max - 1)
    for (let i = 0; i < max; i++) aus.push(punkte[Math.round(i * schritt)])
    return aus
}

// ── Netz ─────────────────────────────────────────────────────────────────

async function holePaare(kette, kontrakte) {
    const name = DEX_KETTE[kette]
    const aus = []
    if (!name) return aus
    for (let i = 0; i < kontrakte.length; i += 30) {
        const r = await fetch(`https://api.dexscreener.com/tokens/v1/${name}/${kontrakte.slice(i, i + 30).join(',')}`, { signal: AbortSignal.timeout(15000) })
        if (!r.ok) throw new Error(`DexScreener antwortet mit ${r.status}`)
        const d = await r.json()
        if (Array.isArray(d)) aus.push(...d)
    }
    return aus
}

/** Auf welcher Kette handelt dieser Vertrag? EVM: alle bekannten Ketten, die mit der grössten Liquidität. */
async function findeToken({ art, adresse }) {
    const ketten = art === 'sol' ? ['sol'] : Object.keys(DEX_KETTE).filter((k) => k.startsWith('evm:'))
    const treffer = await Promise.all(ketten.map(async (kette) => {
        try { return { kette, paar: waehlePaar(await holePaare(kette, [adresse]), kette, adresse) } } catch { return { kette, paar: null, fehler: true } }
    }))
    const mit = treffer.filter((t) => t.paar).sort((a, b) => b.paar.liq - a.paar.liq)
    if (mit.length) return mit[0]
    if (treffer.every((t) => t.fehler)) throw new Error('DexScreener ist gerade nicht erreichbar.')
    return null
}

// ── Datenbank ────────────────────────────────────────────────────────────

const zahlOderNull = (v) => (v === '' || v == null || !(Number(v) > 0) || !Number.isFinite(Number(v)) ? null : Number(v))
const notizVon = (v) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200)

export async function nimmAuf({ adresse, einsatzUsd, menge, notiz }) {
    const k = getKnex()
    const a = leseAdresse(adresse)
    if (!a) throw Object.assign(new Error('Das ist keine Vertragsadresse (Solana oder 0x…).'), { status: 400 })
    if (Number((await k('portfolio_fruehphase').count({ n: '*' }).first())?.n || 0) >= MAX_TOKEN) throw Object.assign(new Error(`Die Liste fasst höchstens ${MAX_TOKEN} Coins.`), { status: 400 })
    const t = await findeToken(a)
    if (!t) throw Object.assign(new Error('DexScreener kennt für diese Adresse kein Handelspaar. Ein ganz neuer Token erscheint dort oft erst nach einigen Minuten.'), { status: 404 })
    if (await k('portfolio_fruehphase').where({ kette: t.kette, kontrakt: a.adresse }).first()) throw Object.assign(new Error('Dieser Coin steht schon auf der Liste.'), { status: 409 })
    const jetzt = Date.now()
    const zeile = {
        kette: t.kette, kontrakt: a.adresse, symbol: t.paar.symbol, name: t.paar.name,
        einsatzUsd: zahlOderNull(einsatzUsd), menge: zahlOderNull(menge), notiz: notizVon(notiz),
        kursBeiAufnahme: t.paar.usd, mcBeiAufnahme: t.paar.mc, createdAt: jetzt,
    }
    await k('portfolio_fruehphase').insert(zeile)
    const neu = await k('portfolio_fruehphase').where({ kette: t.kette, kontrakt: a.adresse }).first()
    await k('portfolio_fruehphase_kurse').insert({ coinId: neu.id, zeit: jetzt, usd: t.paar.usd, mc: t.paar.mc, liq: t.paar.liq })
    return neu.id
}

export async function aendere(id, { einsatzUsd, menge, notiz }) {
    const n = await getKnex()('portfolio_fruehphase').where('id', Number(id)).update({ einsatzUsd: zahlOderNull(einsatzUsd), menge: zahlOderNull(menge), notiz: notizVon(notiz) })
    if (!n) throw Object.assign(new Error('Eintrag nicht gefunden.'), { status: 404 })
}

export async function entferne(id) {
    const k = getKnex()
    await k('portfolio_fruehphase_kurse').where('coinId', Number(id)).del()
    await k('portfolio_fruehphase').where('id', Number(id)).del()
}

/** Paare aller Listeneinträge, je Kette ein Abruf. Eine Kette mit Fehler bleibt ohne Kurs. */
async function paareFuer(tokens) {
    const jeKette = new Map()
    for (const t of tokens) jeKette.set(t.kette, [...(jeKette.get(t.kette) || []), t.kontrakt])
    const paare = new Map()
    let fehler = false
    await Promise.all([...jeKette].map(async ([kette, kontrakte]) => {
        try {
            const roh = await holePaare(kette, kontrakte)
            for (const t of tokens.filter((x) => x.kette === kette)) paare.set(t.id, waehlePaar(roh, kette, t.kontrakt))
        } catch { fehler = true }
    }))
    return { paare, fehler }
}

async function merke(tokens, paare) {
    const k = getKnex()
    const jetzt = Date.now()
    const letzte = new Map((await k('portfolio_fruehphase_kurse').select('coinId').max({ zeit: 'zeit' }).groupBy('coinId')).map((z) => [Number(z.coinId), Number(z.zeit)]))
    const neu = tokens.filter((t) => paare.get(t.id) && jetzt - (letzte.get(t.id) || 0) >= MESS_ABSTAND_MS)
        .map((t) => { const p = paare.get(t.id); return { coinId: t.id, zeit: jetzt, usd: p.usd, mc: p.mc, liq: p.liq } })
    if (neu.length) await k('portfolio_fruehphase_kurse').insert(neu)
    await k('portfolio_fruehphase_kurse').where('zeit', '<', jetzt - VERLAUF_TAGE * 864e5).del()
}

/** Für den Portfolio-Takt: Messpunkte schreiben, auch wenn die Seite zu ist. */
export async function merkeFruehphaseKurse() {
    const k = getKnex()
    if (!(await k.schema.hasTable('portfolio_fruehphase'))) return 0
    const tokens = await k('portfolio_fruehphase').select('*')
    if (!tokens.length) return 0
    const { paare } = await paareFuer(tokens)
    await merke(tokens, paare)
    return tokens.length
}

export async function fruehphaseAnsicht() {
    const k = getKnex()
    const tokens = await k('portfolio_fruehphase').select('*').orderBy('createdAt', 'desc')
    const [{ paare, fehler }, fx, bestaende] = await Promise.all([
        tokens.length ? paareFuer(tokens) : { paare: new Map(), fehler: false },
        fxHeute(),
        bestaendeOhneDoppelte(),
    ])
    if (tokens.length) await merke(tokens, paare).catch(() => {})
    const mitVertrag = bestaende.filter((b) => b.kontrakt && Number(b.menge) > 0)
    const walletMenge = (t) => mitVertrag.filter((b) => gleicherVertrag(t.kette, b.kontrakt, t.kontrakt)).reduce((s, b) => s + Number(b.menge), 0)

    const verlauf = new Map()
    if (tokens.length) {
        for (const z of await k('portfolio_fruehphase_kurse').whereIn('coinId', tokens.map((t) => t.id)).select('coinId', 'zeit', 'usd').orderBy('zeit')) {
            const id = Number(z.coinId)
            if (!verlauf.has(id)) verlauf.set(id, [])
            verlauf.get(id).push([Number(z.zeit), Number(z.usd)])
        }
    }
    const zeilen = tokens.map((t) => ({ ...rechneZeile(t, paare.get(t.id), walletMenge(t), fx.chf), verlauf: verdichte(verlauf.get(t.id) || []) }))

    // Vorschläge: Solana-Token der eigenen Wallets, die noch nicht auf der Liste stehen.
    const schon = new Set(tokens.filter((t) => t.kette === 'sol').map((t) => t.kontrakt))
    const offen = [...new Map(mitVertrag.filter((b) => b.ort === 'sol' && !schon.has(b.kontrakt)).map((b) => [b.kontrakt, b])).values()].slice(0, 30)
    let vorschlaege = []
    if (offen.length) {
        try {
            const roh = await holePaare('sol', offen.map((b) => b.kontrakt))
            vorschlaege = offen.map((b) => ({ b, p: waehlePaar(roh, 'sol', b.kontrakt) })).filter((x) => x.p)
                .map(({ b, p }) => ({ kontrakt: b.kontrakt, symbol: p.symbol || b.asset, name: p.name, menge: Number(b.menge), wertUsd: p.usd * Number(b.menge), liq: p.liq }))
                .sort((a, b) => b.wertUsd - a.wertUsd).slice(0, 8)
        } catch { /* ohne Vorschläge */ }
    }

    const mitWert = zeilen.filter((z) => z.wertUsd != null)
    const mitEinsatz = mitWert.filter((z) => z.einsatzUsd != null)
    const einsatz = mitEinsatz.reduce((s, z) => s + z.einsatzUsd, 0)
    const wertMitEinsatz = mitEinsatz.reduce((s, z) => s + z.wertUsd, 0)
    return {
        zeilen, vorschlaege, max: MAX_TOKEN, duennUsd: DUENN_USD,
        kursFehler: fehler, chfJeUsd: fx.chf, stand: Date.now(),
        summe: {
            anzahl: zeilen.length,
            wertUsd: mitWert.reduce((s, z) => s + z.wertUsd, 0),
            wertChf: mitWert.reduce((s, z) => s + (z.wertChf || 0), 0),
            einsatzUsd: mitEinsatz.length ? einsatz : null,
            gewinnUsd: mitEinsatz.length ? wertMitEinsatz - einsatz : null,
            gewinnAnteil: einsatz > 0 ? wertMitEinsatz / einsatz - 1 : null,
        },
    }
}
