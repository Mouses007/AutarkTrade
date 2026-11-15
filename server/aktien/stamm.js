/**
 * Instrument-Stamm: welche Aktie ist wo kaufbar, als Spot oder als Future?
 * (Aktien-Integration, Phase 2, `docs/PLAN-AKTIEN.md`.)
 *
 * Der Abgleich liest die öffentlichen Symbol-Listen der Handelsplätze, ordnet
 * sie ein (`einordnung.js`) und schreibt Aktien, ETFs, vorbörsliche Firmen,
 * Rohstoffe und Devisen in `instrumente` / `instrument_listungen`.
 * Kryptowährungen bleiben draussen: ihr «wo handelbar» pflegen Coin-Radar und
 * Börsenwacht schon.
 *
 * Drei Regeln, die still Falsches verhindern:
 *
 *   1. Jede Liste darf einzeln ausfallen. Eine ausgefallene oder leere Liste
 *      ändert an den Listungen dieses Handelsplatzes NICHTS — «nicht gefragt»
 *      ist nicht «nicht mehr gelistet».
 *   2. Eine Liste, die auf weniger als die Hälfte ihres letzten Umfangs
 *      schrumpft, gilt als Störung und schaltet nichts ab.
 *   3. Der erste Abgleich eines Handelsplatzes ist die Ausgangslage: seine
 *      Listungen sind nicht «neu». Erst ab dem zweiten Lauf meldet `neu`,
 *      was hinzugekommen ist (Grundlage für den Listungs-Alarm, Phase 4).
 *
 * Binance wird nur gelesen, wenn es die gewählte Marktdaten-Quelle ist —
 * Binance-Adressen stehen ausschliesslich in `server/marktdaten/binance.js`.
 */

import { getKnex } from '../database.js'
import { beansprucheAufgabe } from '../db-claim.js'
import { holeJson } from '../hype-radar/quellen.js'
import { holeBitunixPaare } from '../bitunix-api.js'
import * as marktdaten from '../marktdaten/index.js'
import { ordneAlle } from './einordnung.js'
import { holeListen, speichereStamm } from './stamm-speicher.js'
import { meldeNeueListungen } from './meldungen.js'

export { leseStamm, stammZahlen, HANDELSPLAETZE } from './stamm-speicher.js'
const TAKT_MS = 12 * 3600e3
const BITPANDA_LISTE = 'https://api.bitpanda.com/v3/assets'

/* ── Abruf: jede Funktion liefert die Roh-Einträge in der Form, die die Einordnung liest ── */

async function rohBinance() {
    if ((await marktdaten.wahl()) !== 'binance') return null
    const karte = await marktdaten.ANBIETER.binance.symbole({ markt: 'futures' })
    return [...karte.values()].map((s) => ({
        symbol: s.symbol, baseAsset: s.basis, quoteAsset: s.quote,
        underlyingType: s.underlyingType, underlyingSubType: s.underlyingSubType, onboardDate: s.onboardDate,
    }))
}

async function rohBitget() {
    const d = await holeJson('https://api.bitget.com/api/v2/mix/market/contracts?productType=USDT-FUTURES', { timeout: 15000 })
    return (d?.data || []).filter((c) => c.symbolStatus === 'normal')
}

async function rohBitunix() {
    return (await holeBitunixPaare()).map((p) => ({ symbol: p.symbol, base: p.basis, quote: 'USDT', maxLeverage: p.maxLeverage, launchTime: p.launchTime }))
}

/** Öffentliche JSON-Liste mit Frist. Pionex und Bitpanda stehen nicht in der Host-Liste des Hype-Radars. */
async function holeOeffentlich(url, timeout = 20000) {
    const steuerung = new AbortController()
    const wecker = setTimeout(() => steuerung.abort(), timeout)
    try {
        const antwort = await fetch(url, { signal: steuerung.signal, headers: { accept: 'application/json' } })
        if (!antwort.ok) throw new Error(`HTTP ${antwort.status}`)
        return await antwort.json()
    } finally {
        clearTimeout(wecker)
    }
}

async function rohPionex() {
    const d = await holeOeffentlich('https://api.pionex.com/api/v1/common/symbols')
    return (d?.data?.symbols || []).filter((s) => s.enable !== false)
}

async function rohBitpanda() {
    const alle = []
    for (let seite = 1; seite <= 20; seite++) {
        const zeilen = (await holeOeffentlich(`${BITPANDA_LISTE}?page_size=500&page=${seite}`))?.data || []
        for (const z of zeilen) if (z?.attributes) alle.push(z.attributes)
        if (zeilen.length < 500) break
    }
    return alle
}

const ABRUFE = { binance: rohBinance, bitget: rohBitget, bitunix: rohBitunix, pionex: rohPionex, bitpanda: rohBitpanda }

/* ── Lauf ── */

let laeuft = null
let letzter = null

/** Ein Abgleich: holen, einordnen, speichern. Gleichzeitige Aufrufe teilen sich den Lauf. */
export function gleicheAb() {
    if (laeuft) return laeuft
    laeuft = (async () => {
        const beginn = Date.now()
        const { roh, stand } = await holeListen(ABRUFE)
        const gelesen = Object.keys(roh)
        if (!gelesen.length) {
            letzter = { ok: false, zeit: beginn, stand, grund: 'keineListe' }
            return letzter
        }
        const ergebnis = await speichereStamm(getKnex(), ordneAlle(roh), gelesen, beginn)
        letzter = { ok: true, zeit: beginn, dauerMs: Date.now() - beginn, stand, ...ergebnis }
        // Neue Listungen melden (gebündelt, nur wenn eingeschaltet; Regel 3 hält den
        // ersten Abgleich eines Handelsplatzes aus `neu` heraus). Hält den Abgleich nicht auf.
        if (ergebnis.neu.length) meldeNeueListungen(ergebnis.neu).catch(() => {})
        return letzter
    })().finally(() => { laeuft = null })
    return laeuft
}

export const letzterLauf = () => letzter

/* ── Takt ── */

let taktId = null
/** Alle 12 h, nur ein Prozess je Datenbank, und nur wenn der Aktien-Modus an ist. */
export function starteStammTakt() {
    if (taktId) return
    const tick = async () => {
        try {
            const knex = getKnex()
            if (!(await knex.schema.hasTable('instrument_listungen'))) return
            const s = await knex('settings').select('modusAktienAn').where('id', 1).first()
            if (Number(s?.modusAktienAn ?? 0) !== 1) return
            if (!(await beansprucheAufgabe('aktien_stamm', TAKT_MS - 60e3))) return
            const r = await gleicheAb()
            if (r.ok) console.log(` -> Aktien-Stamm: ${r.titel} Titel, ${r.listungen} Listungen, ${r.neu.length} neu, ${r.weg.length} weg`)
            else console.warn(' -> Aktien-Stamm: keine Liste abrufbar')
        } catch (e) {
            console.warn(' -> Aktien-Stamm-Takt:', e.message)
        }
    }
    setTimeout(tick, 120e3)
    taktId = setInterval(tick, 30 * 60e3)
}

export function stoppeStammTakt() {
    if (taktId) clearInterval(taktId)
    taktId = null
}
