/**
 * Spot-Portfolio: Welcher Token ist das? (rein, selbstgetestet)
 *
 * Bis 26.10.2026 (Audit FUN-PRT-001) galt das KÜRZEL als Identität. Gefälschte
 * „USDT“ aus Address-Poisoning tragen aber dasselbe Kürzel wie die echten:
 * Bestand, FIFO-Lose, Spam von Hand und Transferpaarung warfen beide in einen
 * Topf, und jede Einzahlung namens USDT galt 1 USD und als eigene Herkunft.
 *
 * Jetzt ist die Identität `ASSET|kontrakt` — mit zwei Ausnahmen, die zum
 * Kürzel zusammenfallen, weil sie belegt DER Coin der Börsen sind:
 *   1. Zeilen ohne Vertrag (Börsen, Importe, native Coins einer Kette)
 *   2. Verträge aus `KANON` (nachweislich der Coin des Börsenpaars) und
 *      Verträge, die ein eigener Transfer mit einer Börsenzeile ohne Vertrag
 *      verbindet (Auszahlung bei Bitpanda → Einzahlung auf dem Ledger: der
 *      Token, der dort ankam, IST der Coin der Börse — sonst begänne jedes
 *      ausgezahlte Los auf der Wallet ohne Einstand) — oder die der Nutzer
 *      selbst als „eigener Transfer“ eingeordnet hat (Datei-Import, Hand).
 * Alles andere ist ein eigener Token neben dem Börsen-Coin.
 *
 * Keine Abhängigkeit: `normal.js` (Transferpaarung) und `kurse.js` lesen hier.
 */

/** Kettenname einer Datei/Quelle → interner Schlüssel (evm:<chainid> bzw. sol). */
const KETTEN_NAMEN = { ethereum: 'evm:1', eth: 'evm:1', bsc: 'evm:56', bnb: 'evm:56', polygon: 'evm:137', matic: 'evm:137', arbitrum: 'evm:42161', base: 'evm:8453', optimism: 'evm:10', avalanche: 'evm:43114', solana: 'sol', sol: 'sol' }
export function ketteNorm(k) {
    const t = String(k || '').trim().toLowerCase()
    if (!t) return null
    if (/^evm:\d+$/.test(t)) return t
    return KETTEN_NAMEN[t] || null
}

/**
 * Vertragsadresse vereinheitlichen: EVM-Adressen (0x…) klein — dort ist die
 * Schreibweise nur eine Prüfsumme. Alles andere bleibt, wie es ist: eine
 * Solana-Adresse ist Base58, Gross/Klein gehört zur Adresse.
 */
export function normKontrakt(k) {
    const s = String(k ?? '').trim()
    if (!s) return null
    return /^0x[0-9a-f]+$/i.test(s) ? s.toLowerCase() : s
}

/*
 * Verträge, die nachweislich DER Coin des Börsenpaars sind. Für sie fehlt sonst
 * der Kurs, wenn DexScreener keinen liquiden Pool findet — gehandelt wird BNT,
 * GRT, ILV … an den Börsen, nicht auf der Kette. Dazu die Stablecoins der
 * Netze, die der Abruf kennt (Herausgeber-Verträge von Tether bzw. Circle):
 * nur sie gelten fest 1 USD — „USDT“ kann jeder Token heissen.
 */
export const KANON = {
    'evm:1': {
        '0xdac17f958d2ee523a2206206994597c13d831ec7': 'USDT', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'USDC',
        '0x6b175474e89094c44da98b954eedeac495271d0f': 'DAI',
        '0xae7ab96520de3a18e5e111b5eaab095312d7fe84': 'STETH', '0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0': 'MATIC',
        '0xc944e90c64b2c07662a292be6244bdf05cda44a7': 'GRT', '0x1f573d6fb3f13d689ff844b4ce37794d79a7ff1c': 'BNT',
        '0x767fe9edc9e0df98e07454847909b5e959d7ca0e': 'ILV', '0x4e15361fd6b4bb609fa63c81a2be19d873717870': 'FTM',
        '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 'WBTC', '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 'WETH',
        '0x514910771af9ca656af840dff83e8264ecf986ca': 'LINK', '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984': 'UNI',
        '0x64d0f55cd8c7133a9d7102b13987235f486f2224': 'BORG',
    },
    'evm:42161': {
        // Fiat24 (SafePal-Karte): auf der Kette geprüft 25.10.2026 — name „Fiat24 CHF“, 2 Dezimalen.
        '0xd41f1f0cf89fd239ca4c1f8e8ada46345c86b0a4': 'CHF24',
        '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': 'USDT', '0xaf88d065e77c8cc2239327c5edb3a432268e5831': 'USDC',
    },
    'evm:56': { '0x55d398326f99059ff775485246999027b3197955': 'USDT', '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d': 'USDC' },
    'evm:137': { '0xc2132d05d31c914a87c6611c10748aeb04b58e8f': 'USDT', '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359': 'USDC' },
    'evm:8453': { '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 'USDC' },
    'evm:10': { '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58': 'USDT', '0x0b2c639c533813f4aa9d7837caf62653d097ff85': 'USDC' },
    'evm:43114': { '0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7': 'USDT', '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e': 'USDC' },
    sol: { Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 'USDT', EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC' },
}

const gross = (a) => String(a ?? '').trim().toUpperCase()

/**
 * Ist dieser Vertrag der kanonische des Kürzels? Ohne (bekannte) Kette wird
 * über alle Ketten gesucht — eine Vertragsadresse ist praktisch eindeutig.
 */
export function istKanon(asset, kontrakt, kette = null) {
    const k = normKontrakt(kontrakt)
    if (!k) return false
    const a = gross(asset)
    const kn = ketteNorm(kette)
    if (kn && KANON[kn]) return KANON[kn][k] === a
    return Object.values(KANON).some((m) => m[k] === a)
}

/** Kennt KANON das Kürzel auf dieser Kette? Dann ist jeder andere Vertrag sicher fremd. */
export function kanonKennt(asset, kette) {
    const m = KANON[ketteNorm(kette)]
    const a = gross(asset)
    return !!m && Object.values(m).includes(a)
}

/** Vertrag der Gegenseite: Spalte `gegenKontrakt` (geladen) oder `roh.gegenKontrakt` (EVM-Tausch). */
export function gegenKontraktVon(b) {
    if (b.gegenKontrakt) return normKontrakt(b.gegenKontrakt)
    let roh = b.roh
    if (typeof roh === 'string') { try { roh = JSON.parse(roh) } catch { roh = null } }
    return normKontrakt(roh?.gegenKontrakt)
}

/**
 * Identität aus den Bewegungen (die Transfer-Belege stehen nur dort).
 * @param {Array} bewegungen  mit id, asset, kontrakt, kette, transferMit
 * @returns {{ id(asset, kontrakt?, kette?): string, fremd(asset, kontrakt?, kette?): string|null,
 *             seiten(b): Array<{asset, menge, kontrakt, fremd, id}>, belegt: Set<string> }}
 *   `fremd` = der Vertrag, wenn er eine eigene Identität ist, sonst null.
 */
export function tokenIdentitaet(bewegungen = []) {
    const belegt = new Set()
    const nachId = new Map()
    for (const b of bewegungen) if (b.id != null) nachId.set(b.id, b)
    for (const b of bewegungen) {
        const k = normKontrakt(b.kontrakt)
        if (!k) continue
        // Von Hand (oder im Import) als eigener Transfer eingeordnet: der Nutzer sagt, es ist seiner.
        if (b.einordnung === 'transfer') { belegt.add(`${gross(b.asset)}|${k}`); continue }
        if (b.transferMit == null) continue
        const p = nachId.get(b.transferMit)
        if (p && !normKontrakt(p.kontrakt) && gross(p.asset) === gross(b.asset)) belegt.add(`${gross(b.asset)}|${k}`)
    }
    // Datei-Importe kennen nur einen Vertrag je Zeile: beim Tausch fehlt er auf der
    // Gegenseite. Führt dieselbe Quelle das Kürzel sonst nur mit genau einem Vertrag
    // (und nie ohne), gehört die Seite ohne Vertrag zu ihm.
    const vertraege = new Map()
    const merke = (quelle, asset, k) => {
        const key = `${quelle}\u0000${gross(asset)}`
        const v = vertraege.get(key) || { k: new Set(), ohne: false }
        if (k) v.k.add(k); else v.ohne = true
        vertraege.set(key, v)
    }
    for (const b of bewegungen) {
        if (b.asset) merke(b.quelle, b.asset, normKontrakt(b.kontrakt))
        const gk = b.gegenAsset ? gegenKontraktVon(b) : null
        if (gk) merke(b.quelle, b.gegenAsset, gk)
    }
    const ergaenze = (quelle, asset, k) => {
        if (k) return k
        const v = vertraege.get(`${quelle}\u0000${gross(asset)}`)
        return v && !v.ohne && v.k.size === 1 ? [...v.k][0] : null
    }
    const fremd = (asset, kontrakt, kette = null) => {
        const k = normKontrakt(kontrakt)
        if (!k || istKanon(asset, k, kette) || belegt.has(`${gross(asset)}|${k}`)) return null
        return k
    }
    const id = (asset, kontrakt, kette) => {
        const f = fremd(asset, kontrakt, kette)
        return f ? `${gross(asset)}|${f}` : gross(asset)
    }
    const seiten = (b) => {
        // Stelle 0 ist immer die Seite `asset`, Stelle 1 (falls vorhanden) die Gegenseite.
        const f0 = b.asset ? fremd(b.asset, b.kontrakt, b.kette) : null
        const aus = [{ asset: b.asset || null, menge: Number(b.menge) || 0, kontrakt: normKontrakt(b.kontrakt), fremd: f0, id: !b.asset ? null : f0 ? `${gross(b.asset)}|${f0}` : gross(b.asset) }]
        if (b.gegenAsset) {
            const gk = ergaenze(b.quelle, b.gegenAsset, gegenKontraktVon(b))
            const f = fremd(b.gegenAsset, gk, b.kette)
            aus.push({ asset: b.gegenAsset, menge: Number(b.gegenMenge) || 0, kontrakt: gk, fremd: f, id: f ? `${gross(b.gegenAsset)}|${f}` : gross(b.gegenAsset) })
        }
        return aus
    }
    return { id, fremd, seiten, belegt }
}

/**
 * Spam von Hand: alte Einträge mit reinem Kürzel auf `ASSET|kontrakt`
 * umschreiben — nur wenn eindeutig (genau ein Vertrag mit diesem Kürzel im
 * Bestand oder in den Bewegungen). Mehrdeutige bleiben, wie sie sind, und
 * gelten weiter als Rückfall (`spamEntscheid`).
 * @param {Record<string, boolean>} hand
 * @param {Map<string, Set<string>>} vertraege  ASSET → Verträge
 * @returns {{ hand: Record<string, boolean>, geaendert: number }}
 */
export function spamHandUmschreiben(hand, vertraege) {
    const neu = { ...hand }
    let geaendert = 0
    for (const [key, wert] of Object.entries(hand || {})) {
        if (key.includes('|')) continue
        const v = vertraege.get(gross(key))
        if (!v || v.size !== 1) continue
        const k = [...v][0]
        if (istKanon(key, k)) continue          // der echte Coin: nicht stillschweigend als Spam festschreiben
        const ziel = `${gross(key)}|${k}`
        if (!(ziel in neu)) neu[ziel] = wert
        delete neu[key]
        geaendert++
    }
    return { hand: neu, geaendert }
}

/**
 * Gegenkontrakte nachladen (stehen nur im Rohfeld der EVM-Tausch-Zeilen).
 * Liest nur Zeilen mit Kette und Gegen-Asset.
 */
export async function ladeGegenKontrakte(knex, bewegungen) {
    try {
        const zeilen = await knex('portfolio_bewegungen').whereNotNull('kette').whereNotNull('gegenAsset').select('id', 'roh')
        const roh = new Map(zeilen.map((z) => [z.id, z.roh]))
        for (const b of bewegungen) if (roh.has(b.id)) b.gegenKontrakt = gegenKontraktVon({ roh: roh.get(b.id) })
    } catch { /* ohne Gegenkontrakt: Gegenseite zählt beim Kürzel */ }
    return bewegungen
}
