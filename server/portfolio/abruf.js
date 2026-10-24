/**
 * Spot-Portfolio: Abruf aller Quellen, Speichern, Transfers paaren,
 * CHF-Werte einfrieren, Tageswert festhalten.
 *
 * Eine Quelle, die scheitert, behält ihren letzten guten Stand (Bestand und
 * Bewegungen bleiben stehen) und bekommt `status: 'fehler'` mit Meldung —
 * die Übersicht zeigt dann den alten Wert MIT Hinweis, nie stillschweigend 0.
 *
 * Bewegungen werden nur EINGEFÜGT, nie überschrieben (`onConflict.ignore`):
 * eine Einordnung des Nutzers („eigener Transfer", „Einkommen") überlebt
 * jeden weiteren Abruf.
 */

import { getKnex } from '../database.js'
import { decrypt } from '../crypto.js'
import { beansprucheAufgabe } from '../db-claim.js'
import { holeBitget, holeBitunix, holePionex, holeBitpanda, holeEvm, holeBtc, holeSol, holeXrp, NichtEingerichtet } from './quellen.js'
import { ordneTransfers } from './normal.js'
import { fxAm, tagesKursUsd } from './kurse.js'
import { berechneUebersicht } from './uebersicht.js'

export const BOERSEN = ['bitunix', 'bitget', 'pionex', 'bitpanda']
const TAKT_MS = 15 * 60e3
const DOLLAR = new Set(['USDT', 'USDC', 'FDUSD', 'DAI', 'BUSD', 'TUSD', 'USDE', 'PYUSD', 'USD'])

let laeuft = null          // { seit, quelle, schritt }
let letzterLauf = null

export function laufStand() {
    return { laeuft: !!laeuft, ...(laeuft || {}), letzterLauf }
}

/**
 * Spot/Futures je Börse aus den Einstellungen. Fehlt ein Eintrag: Futures an,
 * Spot aus — wer nichts einstellt, sieht nichts Neues. Bitpanda schaltet Spot
 * beim Speichern des Schlüssels selbst ein.
 */
export async function boersenWahl() {
    const s = await getKnex()('settings').select('portfolioBoersen').where('id', 1).first().catch(() => null)
    let w = {}
    try { w = JSON.parse(s?.portfolioBoersen || '{}') || {} } catch { w = {} }
    const aus = {}
    for (const b of BOERSEN) {
        aus[b] = {
            futures: b === 'bitpanda' ? 0 : Number(w[b]?.futures ?? 1) ? 1 : 0,
            spot: Number(w[b]?.spot ?? 0) ? 1 : 0,
        }
    }
    return aus
}

/** Alle Quellen, die abgerufen werden sollen: Börsen mit Spot an + jede Wallet-Adresse. */
export async function aktiveQuellen() {
    const k = getKnex()
    const wahl = await boersenWahl()
    const liste = BOERSEN.filter((b) => wahl[b].spot).map((b) => ({ quelle: b, art: 'boerse' }))
    const adr = await k('portfolio_adressen').select('*').orderBy('id')
    for (const a of adr) liste.push({ quelle: `a${a.id}`, art: 'wallet', adresse: a })
    return liste
}

async function holeQuelle(q, seit, altStand = {}) {
    if (q.art === 'boerse') {
        if (q.quelle === 'bitget') return holeBitget(seit)
        if (q.quelle === 'bitunix') return holeBitunix()
        if (q.quelle === 'pionex') return holePionex()
        if (q.quelle === 'bitpanda') return holeBitpanda(seit, altStand)
    }
    const a = q.adresse
    const wert = decrypt(a.adresse)
    if (a.kette === 'btc') return holeBtc(wert, a.art, altStand)
    if (a.kette === 'evm') {
        let netze = []
        try { netze = JSON.parse(a.netze || '[]') } catch { netze = [] }
        return holeEvm(wert, netze)
    }
    if (a.kette === 'sol') return holeSol(wert)
    if (a.kette === 'xrp') return holeXrp(wert)
    throw new Error(`Unbekannte Kette ${a.kette}`)
}

async function speichere(quelle, erg) {
    const k = getKnex()
    const jetzt = Date.now()
    await k.transaction(async (trx) => {
        await trx('portfolio_bestaende').where('quelle', quelle).del()
        if (erg.bestand.length) {
            await trx('portfolio_bestaende').insert(erg.bestand.map((b) => ({
                quelle, ort: b.ort || null, asset: String(b.asset).toUpperCase(), kontrakt: b.kontrakt || null,
                menge: b.menge, name: b.name || (b.ohneSymbol ? 'ohneSymbol' : null), kursUsd: b.kursUsd ?? null, zeit: jetzt,
            })))
        }
        for (let i = 0; i < erg.bewegungen.length; i += 200) {
            const teil = erg.bewegungen.slice(i, i + 200).map((b) => ({
                quelle, externeId: b.externeId, zeit: b.zeit, art: b.art, asset: b.asset, menge: b.menge,
                gegenAsset: b.gegenAsset, gegenMenge: b.gegenMenge, gebuehrAsset: b.gebuehrAsset, gebuehrMenge: b.gebuehrMenge,
                txHash: b.txHash, kette: b.kette, kontrakt: b.kontrakt,
                roh: b.roh ? JSON.stringify(b.roh).slice(0, 20000) : null, createdAt: jetzt,
            }))
            await trx('portfolio_bewegungen').insert(teil).onConflict(['quelle', 'externeId']).ignore()
        }
    })
    const juengste = erg.bewegungen.reduce((m, b) => Math.max(m, b.zeit || 0), 0)
    const alt = await k('portfolio_quellen').where('quelle', quelle).first()
    const zeile = {
        quelle, letzterAbruf: jetzt,
        letzteBewegung: Math.max(juengste, Number(alt?.letzteBewegung) || 0) || null,
        status: 'ok',
        meldung: erg.hinweis || null,
        stand: JSON.stringify({ ...(erg.stand || {}), vollstaendig: !!erg.vollstaendig }),
    }
    await k('portfolio_quellen').insert(zeile).onConflict('quelle').merge()
}

async function merkeFehler(quelle, e) {
    const k = getKnex()
    const nicht = e instanceof NichtEingerichtet
    await k('portfolio_quellen').insert({
        quelle, letzterAbruf: Date.now(), status: nicht ? 'nichtEingerichtet' : 'fehler', meldung: String(e.message || e).slice(0, 500),
    }).onConflict('quelle').merge(['letzterAbruf', 'status', 'meldung'])
}

/** Transfers zwischen eigenen Orten paaren (nur noch ungepaarte Zeilen). */
async function paareTransfers() {
    const k = getKnex()
    const zeilen = await k('portfolio_bewegungen')
        .whereIn('art', ['auszahlung', 'einzahlung']).whereNull('transferMit').whereNull('einordnung')
        .select('id', 'quelle as ort', 'art', 'asset', 'menge', 'zeit', 'txHash')
    const paare = ordneTransfers(zeilen)
    for (const p of paare) {
        await k('portfolio_bewegungen').where('id', p.raus).update({ transferMit: p.rein, transferSicher: p.sicher ? 1 : 0 })
        await k('portfolio_bewegungen').where('id', p.rein).update({ transferMit: p.raus, transferSicher: p.sicher ? 1 : 0 })
    }
    return paare.length
}

/**
 * CHF-Wert je Bewegung einfrieren (Kurs des Tages × USD/CHF des Tages).
 * Gedeckelt je Lauf, weil jede neue Kombination aus Asset und Tag einen
 * Kerzenabruf kostet; der nächste Lauf macht weiter.
 */
async function bewerteBewegungen(max = 400) {
    const k = getKnex()
    const offen = await k('portfolio_bewegungen').whereNull('chfQuelle').orderBy('zeit', 'desc').limit(max)
    let n = 0
    for (const b of offen) {
        const datum = new Date(Number(b.zeit)).toISOString().slice(0, 10)
        const usdChf = await fxAm(datum, 'CHF')
        // Bewertet wird zuerst über den GEZAHLTEN Betrag, wenn eine Seite Geld
        // ist — genauer als jeder Tageskurs: CHF direkt, EUR zum EZB-Kurs des
        // Tages, ein Dollar-Stablecoin zu 1 USD. Sonst Menge × Tageskurs.
        let wert = null, quelle = null
        const seiten = [[b.asset, b.menge], [b.gegenAsset, b.gegenMenge]]
        const geld = seiten.find(([a, m]) => a === 'CHF' && Number(m)) || seiten.find(([a, m]) => a === 'EUR' && Number(m)) || seiten.find(([a, m]) => DOLLAR.has(a) && Number(m))
        if (geld) {
            const betrag = Math.abs(Number(geld[1]))
            if (geld[0] === 'CHF') { wert = betrag; quelle = 'Betrag in CHF' }
            else if (geld[0] === 'EUR') {
                const usdEur = await fxAm(datum, 'EUR')
                if (usdEur && usdChf) { wert = betrag / usdEur * usdChf; quelle = 'Betrag in EUR · EZB' }
            } else if (usdChf) { wert = betrag * usdChf; quelle = 'Handelsbetrag · EZB' }
        } else if (Number(b.menge)) {
            const t = await tagesKursUsd(b.asset, datum)
            if (t.usd != null && usdChf) { wert = Math.abs(Number(b.menge)) * t.usd * usdChf; quelle = `${t.quelle} · EZB` }
        }
        await k('portfolio_bewegungen').where('id', b.id).update({ chfWert: wert, chfQuelle: wert == null ? 'kein Kurs' : quelle })
        n++
    }
    return n
}

/**
 * Alles Unbewertete bewerten (nach einem Datei-Import: tausende Zeilen auf
 * einmal). Läuft im Hintergrund, höchstens einmal gleichzeitig.
 */
let bewertetGerade = false
export async function bewerteAlles() {
    if (bewertetGerade) return
    bewertetGerade = true
    try {
        for (let i = 0; i < 100; i++) {
            if ((await bewerteBewegungen(400)) < 400) break
        }
    } finally { bewertetGerade = false }
}

/** Tageswert festhalten (eine Zeile je Tag, der letzte Lauf des Tages gilt). */
async function merkeTageswert() {
    const u = await berechneUebersicht({ ohneVerlauf: true })
    const datum = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Zurich' })
    const daten = {}
    for (const q of u.quellen) daten[q.quelle] = Math.round((q.chf || 0) * 100) / 100
    await getKnex()('portfolio_verlauf').insert({ datum, wertChf: u.gesamt.chf, wertUsd: u.gesamt.usd, daten: JSON.stringify(daten), zeit: Date.now() })
        .onConflict('datum').merge()
}

/**
 * Ein Lauf über alle (oder eine) Quelle. Läuft schon einer, wird kein
 * zweiter gestartet.
 */
export async function rufeAb({ nur = null } = {}) {
    if (laeuft) return { schonAktiv: true }
    laeuft = { seit: Date.now(), quelle: null, schritt: 'quellen' }
    const ergebnis = { ok: [], fehler: [] }
    try {
        const k = getKnex()
        const quellen = (await aktiveQuellen()).filter((q) => !nur || q.quelle === nur)
        for (const q of quellen) {
            laeuft.quelle = q.quelle
            const stand = await k('portfolio_quellen').where('quelle', q.quelle).first()
            try {
                let altStand = {}
                try { altStand = JSON.parse(stand?.stand || '{}') || {} } catch { altStand = {} }
                // Nach einem Fehler nicht auf dem alten Zähler aufsetzen:
                // die Bewegungen des abgebrochenen Laufs fehlen sonst für immer.
                if (stand?.status === 'fehler') altStand = {}
                const erg = await holeQuelle(q, Number(stand?.letzteBewegung) || null, altStand)
                // Übergabe: die Historie bis `liveAb` kommt aus dem Import — live
                // nur, was danach geschah, sonst wäre jede alte Bewegung doppelt.
                const liveAb = Number(q.adresse?.liveAb) || 0
                if (liveAb) erg.bewegungen = erg.bewegungen.filter((b) => Number(b.zeit) > liveAb)
                await speichere(q.quelle, erg)
                ergebnis.ok.push(q.quelle)
            } catch (e) {
                console.warn(` -> Portfolio ${q.quelle}: ${e.message}`)
                await merkeFehler(q.quelle, e)
                ergebnis.fehler.push({ quelle: q.quelle, meldung: e.message })
            }
        }
        laeuft.quelle = null
        laeuft.schritt = 'transfers'
        ergebnis.transfers = await paareTransfers()
        laeuft.schritt = 'bewertung'
        ergebnis.bewertet = await bewerteBewegungen()
        laeuft.schritt = 'tageswert'
        await merkeTageswert()
    } finally {
        letzterLauf = { ende: Date.now(), ...ergebnis }
        laeuft = null
    }
    return ergebnis
}

let taktId = null
export function startePortfolioTakt() {
    if (taktId) return
    const tick = async () => {
        try {
            const k = getKnex()
            if (!(await k.schema.hasTable('portfolio_quellen'))) return
            const s = await k('settings').select('modusPortfolioAn').where('id', 1).first()
            if (Number(s?.modusPortfolioAn ?? 1) !== 1) return
            if (!(await aktiveQuellen()).length) return
            if (!(await beansprucheAufgabe('portfolio_abruf', TAKT_MS - 60e3))) return
            await rufeAb()
        } catch (e) {
            console.warn(' -> Portfolio-Takt:', e.message)
        }
    }
    setTimeout(tick, 90e3)
    taktId = setInterval(tick, TAKT_MS)
}

export function stoppePortfolioTakt() {
    if (taktId) clearInterval(taktId)
    taktId = null
}
