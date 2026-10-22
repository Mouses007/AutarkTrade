/**
 * Bitcoin: xpub/ypub/zpub lokal ableiten, Adressen über Esplora lesen.
 *
 * Der erweiterte öffentliche Schlüssel verlässt den Server nie. Abgefragt
 * werden nur einzelne Adressen bei mempool.space — der Dienst sieht damit
 * die Adressen, aber nicht, dass sie zusammengehören (abgesehen davon, dass
 * sie in einem Lauf nacheinander kommen).
 *
 * Gap-Limit 20 (BIP44): eine Kette (Empfang 0, Wechselgeld 1) gilt als
 * erschöpft, sobald 20 Adressen in Folge nie benutzt wurden.
 *
 * `leiteAb` ist rein und gegen die offiziellen BIP44/49/84-Testvektoren
 * selbstgetestet; `leseXpub`/`leseAdresse` machen das Netz.
 */

import { HDKey } from '@scure/bip32'
import { bech32, createBase58check } from '@scure/base'
import { sha256 } from '@noble/hashes/sha256'
import { ripemd160 } from '@noble/hashes/ripemd160'

const b58c = createBase58check(sha256)
const hash160 = (b) => ripemd160(sha256(b))

/** Versionsbytes der drei öffentlichen Formen (Mainnet). */
const VERSIONEN = {
    xpub: { private: 0x0488ade4, public: 0x0488b21e },
    ypub: { private: 0x049d7878, public: 0x049d7cb2 },
    zpub: { private: 0x04b2430c, public: 0x04b24746 },
}

function mitPraefix(praefix, nutzlast) {
    const b = new Uint8Array(1 + nutzlast.length)
    b[0] = praefix
    b.set(nutzlast, 1)
    return b
}

/** Öffentlicher Schlüssel (33 Byte, komprimiert) → Adresse der Ableitung. */
export function adresseAusSchluessel(pub, ableitung) {
    const h = hash160(pub)
    if (ableitung === 'p2wpkh') return bech32.encode('bc', [0, ...bech32.toWords(h)])
    if (ableitung === 'p2sh-p2wpkh') {
        const skript = new Uint8Array(22)
        skript[0] = 0x00; skript[1] = 0x14; skript.set(h, 2)
        return b58c.encode(mitPraefix(0x05, hash160(skript)))
    }
    return b58c.encode(mitPraefix(0x00, h))
}

/**
 * Adressen eines Kontos ableiten.
 * @param {string} xpub  xpub/ypub/zpub auf Kontoebene (m/purpose'/0'/account')
 * @param {0|1} zweig    0 = Empfang, 1 = Wechselgeld
 * @param {number} von
 * @param {number} anzahl
 */
export function leiteAb(xpub, zweig, von, anzahl) {
    const art = String(xpub).slice(0, 4)
    const v = VERSIONEN[art]
    if (!v) throw new Error('Kein xpub/ypub/zpub')
    const ableitung = art === 'zpub' ? 'p2wpkh' : art === 'ypub' ? 'p2sh-p2wpkh' : 'p2pkh'
    const konto = HDKey.fromExtendedKey(xpub, v)
    const z = konto.deriveChild(zweig)
    const aus = []
    for (let i = von; i < von + anzahl; i++) {
        aus.push(adresseAusSchluessel(z.deriveChild(i).publicKey, ableitung))
    }
    return aus
}

// ── Netz ─────────────────────────────────────────────────────────────────

/*
 * Zwei Esplora-Instanzen: gemessen 22.10.2026 hing bei mempool.space einzelne
 * Seiten einer stark benutzten Adresse über 20 s, während dieselbe Abfrage
 * davor und danach 0,2 s brauchte. Ein Hänger soll nicht den ganzen Lauf
 * kosten — der zweite Versuch geht an Blockstream.
 */
const ESPLORA = ['https://mempool.space/api', 'https://blockstream.info/api']
const LUECKE = 20
const MAX_ADRESSEN = 400          // je Zweig; darüber ist es kein Privat-Wallet mehr
const PAUSE_MS = 250
const warte = (ms) => new Promise((r) => setTimeout(r, ms))

/*
 * Ein Host, der versagt (Zeitüberschreitung, Verbindung verweigert, 429),
 * wird für SPERRE_MS übersprungen. Ohne das wartete jede der hundert
 * Anfragen eines Laufs erst 10–15 s auf mempool.space, bevor Blockstream
 * in 0,5 s antwortete (gemessen 22.10.2026, nach vielen Testläufen).
 */
const SPERRE_MS = 10 * 60e3
const gesperrtBis = new Map()

async function holeJson(pfad) {
    let letzter = null
    for (let versuch = 0; versuch < 4; versuch++) {
        const jetzt = Date.now()
        const reihe = [...ESPLORA].sort((a, b) => (gesperrtBis.get(a) > jetzt) - (gesperrtBis.get(b) > jetzt))
        const basis = reihe[versuch % reihe.length]
        try {
            const r = await fetch(basis + pfad, { signal: AbortSignal.timeout(15000) })
            if (r.status === 429) {
                gesperrtBis.set(basis, Date.now() + SPERRE_MS)
                letzter = new Error(`${new URL(basis).host}: zu viele Anfragen`)
                await warte(1000)
                continue
            }
            if (!r.ok) throw new Error(`${new URL(basis).host} ${r.status}`)
            return await r.json()
        } catch (e) {
            letzter = e
            if (!/timeout|aborted|fetch failed|ECONNRESET|ECONNREFUSED/i.test(String(e.message))) throw e
            gesperrtBis.set(basis, Date.now() + SPERRE_MS)
        }
    }
    throw letzter || new Error('Esplora nicht erreichbar')
}

async function adressStand(a) {
    const d = await holeJson(`/address/${a}`)
    const c = d.chain_stats || {}, m = d.mempool_stats || {}
    return {
        adresse: a,
        txAnzahl: (c.tx_count || 0) + (m.tx_count || 0),
        sats: (c.funded_txo_sum || 0) - (c.spent_txo_sum || 0) + (m.funded_txo_sum || 0) - (m.spent_txo_sum || 0),
    }
}

/** Alle bestätigten Transaktionen einer Adresse (Esplora blättert je 25). */
async function adressTxs(a) {
    const alle = []
    let letzte = null
    for (let seite = 0; seite < 40; seite++) {
        const pfad = letzte ? `/address/${a}/txs/chain/${letzte}` : `/address/${a}/txs`
        const d = await holeJson(pfad)
        await warte(PAUSE_MS)
        if (!Array.isArray(d) || !d.length) break
        alle.push(...d)
        // Die erste Seite enthält bis zu 50 (25 unbestätigt + 25 bestätigt), danach 25.
        const bestaetigt = d.filter((t) => t.status?.confirmed)
        if (!bestaetigt.length || bestaetigt.length < 25) break
        letzte = bestaetigt.at(-1).txid
    }
    return alle
}

/**
 * Netto-Wirkung einer Transaktion auf eine Menge eigener Adressen (rein).
 * @returns {{ txid, zeit, netto: number (sats), gebuehr: number (sats, nur wenn wir zahlten) }}
 */
export function nettoWirkung(tx, eigene) {
    let rein = 0, raus = 0
    for (const v of tx.vout || []) if (eigene.has(v.scriptpubkey_address)) rein += v.value || 0
    let vonUns = false
    for (const i of tx.vin || []) {
        const a = i.prevout?.scriptpubkey_address
        if (a && eigene.has(a)) { raus += i.prevout.value || 0; vonUns = true }
    }
    return {
        txid: tx.txid,
        zeit: tx.status?.block_time ? tx.status.block_time * 1000 : Date.now(),
        bestaetigt: !!tx.status?.confirmed,
        netto: rein - raus,
        gebuehr: vonUns ? (tx.fee || 0) : 0,
    }
}

/**
 * xpub vollständig lesen: Bestand + Bewegungen.
 * @returns {{ sats: number, adressen: number, bewegungen: Array }}
 */
/**
 * @param {string} xpub
 * @param {Object<string, number>} [vorher]  Adresse → Transaktionszahl beim letzten Lesen.
 *   Historie wird nur für Adressen geholt, deren Zahl sich geändert hat —
 *   eine viel benutzte Wallet kostet sonst bei jedem Lauf Minuten.
 */
export async function leseXpub(xpub, vorher = {}) {
    const benutzt = []
    const zaehler = {}
    let sats = 0
    for (const zweig of [0, 1]) {
        let leer = 0
        for (let i = 0; i < MAX_ADRESSEN && leer < LUECKE; i += 10) {
            const block = leiteAb(xpub, zweig, i, 10)
            for (const a of block) {
                const st = await adressStand(a)
                await warte(PAUSE_MS)
                if (st.txAnzahl > 0) { benutzt.push(a); sats += st.sats; leer = 0; zaehler[a] = st.txAnzahl } else leer++
                if (leer >= LUECKE) break
            }
        }
    }
    const geaendert = benutzt.filter((a) => vorher[a] !== zaehler[a])
    return { sats, adressen: benutzt.length, zaehler, bewegungen: await bewegungenFuer(benutzt, geaendert) }
}

/** Einzelne Adresse lesen (wer keinen xpub hat). */
export async function leseAdresse(a, vorher = {}) {
    const st = await adressStand(a)
    const zaehler = st.txAnzahl > 0 ? { [a]: st.txAnzahl } : {}
    const neu = st.txAnzahl > 0 && vorher[a] !== st.txAnzahl
    return { sats: st.sats, adressen: st.txAnzahl > 0 ? 1 : 0, zaehler, bewegungen: neu ? await bewegungenFuer([a], [a]) : [] }
}

/**
 * Netto-Wirkungen der Transaktionen der GEÄNDERTEN Adressen — gerechnet
 * gegen ALLE eigenen Adressen, sonst sähe ein Wechselgeld an eine
 * unveränderte Adresse wie ein Abgang aus.
 */
async function bewegungenFuer(alleEigenen, abzufragen) {
    const eigene = new Set(alleEigenen)
    const txs = new Map()
    for (const a of abzufragen) {
        for (const t of await adressTxs(a)) txs.set(t.txid, t)
    }
    return [...txs.values()]
        .map((t) => nettoWirkung(t, eigene))
        .filter((w) => w.bestaetigt && (w.netto !== 0 || w.gebuehr))
}
