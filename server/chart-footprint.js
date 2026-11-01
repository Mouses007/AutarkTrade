/**
 * Footprint für den Chart: `GET /api/chart/footprint?symbol=&markt=&interval=&von=&bis=&stufe=`
 *
 * Bündelt die aufgezeichneten aggTrades (`live_recordings`, Art `trades`,
 * eine gzip-Zeile je Symbol und Stunde) zu Käufen/Verkäufen je Kerze und
 * Preisstufe (`shared/footprint.js`). Nur, was der Recorder aufgezeichnet hat:
 * ein Symbol ohne Aufzeichnung bekommt `aufgezeichnet: false`, keinen
 * geschätzten Footprint.
 *
 * Eine abgeschlossene Stunde ändert sich nicht mehr — ihr Bündel wird je
 * (Symbol, Markt, Stunde, Zeiteinheit, Stufe) im Speicher gehalten. Die
 * laufende Stunde schreibt der Recorder alle ~30 s neu; sie wird jedes Mal
 * frisch gelesen (die laufende Kerze hinkt damit höchstens so viel hinterher).
 *
 * Der Zwischenspeicher ist nach ZELLEN begrenzt (Stufen je Kerze, CACHE_ZELLEN),
 * nicht nur nach Einträgen: eine Stunde mit feiner Stufe hält Hunderttausende
 * Zellen. Gemerkt wird erst, wenn die ganze Antwort unter MAX_ZEILEN bleibt —
 * eine zu feine Stufe bricht ab, sobald die Grenze überschritten ist, und
 * hinterlässt nichts im Speicher (vorher blieben bei „Ticks" 1, 2, 3 … je
 * Abruf bis zu 100 MB liegen). Die gzip-Nutzlast wird nur für Stunden
 * gelesen, die nicht schon im Speicher liegen.
 */
import zlib from 'zlib'
import { promisify } from 'util'
import { getKnex } from './database.js'
import { logWarn } from './logger.js'
import { buendele, legeZusammen, alsListe } from '../shared/footprint.js'

const gunzip = promisify(zlib.gunzip)
const STUNDE = 3_600_000
const SYMBOL_RE = /^[A-Z0-9]{2,20}$/
// Footprint ergibt nur auf kleinen Zeiteinheiten Sinn — darüber werden die Kerzen zu voll
export const FOOTPRINT_IV = { '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000, '1h': STUNDE, '2h': 2 * STUNDE, '4h': 4 * STUNDE }
export const MAX_SPANNE_MS = 48 * STUNDE
// Höchstens so viele Zeilen in der ganzen Antwort; mehr heisst: die Stufe ist zu fein
export const MAX_ZEILEN = 60_000
const CACHE_MAX = 400
// Zellen im Zwischenspeicher insgesamt (eine Zelle ≈ 100 Byte → rund 100 MB)
export const CACHE_ZELLEN = 1_000_000
const cache = new Map()   // Schlüssel → { b: Bündel, zellen }
let cacheZellen = 0
// Erster und letzter Trade je aufgezeichneter Stunde — daraus die lückenlosen Abschnitte
// (`abschnitte`), an denen der Browser angeschnittene Kerzen erkennt
const zeitenJeStunde = new Map()   // `symbol|markt|h` → [erste, letzte]
const ZEITEN_MAX = 20_000

/** Eingaben prüfen — rein. */
export function pruefeFootprintAnfrage(q, jetzt = Date.now()) {
    const symbol = String(q.symbol || '').toUpperCase()
    if (!SYMBOL_RE.test(symbol)) return { fehler: 'symbol' }
    const ivMs = FOOTPRINT_IV[String(q.interval || '')]
    if (!ivMs) return { fehler: 'zeiteinheit' }
    const stufe = Number(q.stufe)
    if (!(stufe > 0) || !Number.isFinite(stufe)) return { fehler: 'stufe' }
    let bis = Number(q.bis) || jetzt
    bis = Math.min(bis, jetzt + ivMs)
    let von = Number(q.von) || bis - 6 * STUNDE
    von = Math.max(von, bis - MAX_SPANNE_MS)
    if (!(von < bis)) return { fehler: 'zeitraum' }
    // Auf Kerzengrenzen: eine halbe Kerze am Rand wäre ein falscher Footprint
    von = Math.floor(von / ivMs) * ivMs
    return { symbol, markt: q.markt === 'spot' ? 'spot' : 'futures', interval: String(q.interval), ivMs, stufe, von, bis }
}

/** Zellen eines Bündels (Stufen über alle Kerzen) — rein. */
export function zellenVon(buendel, von = -Infinity, bis = Infinity) {
    let n = 0
    for (const [kt, kerze] of buendel) if (kt >= von && kt < bis) n += kerze.size
    return n
}

const cacheSchluessel = (a, h) => `${a.symbol}|${a.markt}|${h}|${a.ivMs}|${a.stufe}`

function ausCache(schluessel) {
    const e = cache.get(schluessel)
    if (!e) return null
    cache.delete(schluessel); cache.set(schluessel, e)   // zuletzt benutzt nach hinten
    return e.b
}

function merke(schluessel, b) {
    const zellen = zellenVon(b)
    if (zellen > CACHE_ZELLEN) return
    const alt = cache.get(schluessel)
    if (alt) { cacheZellen -= alt.zellen; cache.delete(schluessel) }
    cache.set(schluessel, { b, zellen })
    cacheZellen += zellen
    // Älteste zuerst hinaus, bis Anzahl und Zellen wieder passen
    while (cache.size > CACHE_MAX || cacheZellen > CACHE_ZELLEN) {
        const [k, e] = cache.entries().next().value
        cache.delete(k); cacheZellen -= e.zellen
    }
}

/** Für den Selbsttest: Stand des Zwischenspeichers, und leeren. */
export const cacheStand = () => ({ eintraege: cache.size, zellen: cacheZellen })
export function leereCache() { cache.clear(); cacheZellen = 0 }

/**
 * Lückenlos aufgezeichnete Abschnitte [beginT, endeT] — rein. Aufeinanderfolgende
 * Stunden gehören zusammen; ein Abschnitt beginnt mit dem ersten Trade seiner ersten
 * Stunde und endet mit dem letzten seiner letzten (Neustart, Deploy: dazwischen fehlt
 * eine Stunde). Ohne bekannte Zeiten zählt die ganze Stunde.
 */
export function abschnitteAus(stunden, zeiten) {
    const aus = []
    let vorher = null
    for (const h of stunden) {
        const [erste, letzte] = zeiten(h) || [h, h + STUNDE]
        if (vorher !== null && h === vorher + STUNDE && aus.length) aus[aus.length - 1][1] = letzte
        else aus.push([erste, letzte])
        vorher = h
    }
    return aus
}

/**
 * Footprint-Antwort aus den Stunden der Aufzeichnung. `quelle.stunden()` gibt
 * die aufgezeichneten Stundenanfänge (aufsteigend), `quelle.nutzlast(liste)`
 * die gzip-Nutzlast dieser Stunden als Map — getrennt, damit für gemerkte
 * Stunden nichts gelesen wird (und der Selbsttest ohne Datenbank auskommt).
 */
export async function baueFootprint(a, quelle, jetzt = Date.now()) {
    const stunden = await quelle.stunden()
    const jetztStunde = Math.floor(jetzt / STUNDE) * STUNDE
    const laufend = (h) => h >= jetztStunde - STUNDE
    const fertig = new Map()
    for (const h of stunden) {
        if (laufend(h)) continue
        const b = ausCache(cacheSchluessel(a, h))
        if (b) fertig.set(h, b)
    }
    const fehlend = stunden.filter((h) => !fertig.has(h))
    const nutzlast = fehlend.length ? await quelle.nutzlast(fehlend) : new Map()
    const gesamt = new Map()
    const neu = []
    let erste = null, letzte = null
    for (const h of stunden) {
        let b = fertig.get(h)
        if (!b) {
            const p = nutzlast.get(h)
            if (!p) continue
            const events = JSON.parse((await gunzip(p)).toString('utf8'))
            if (events.length) {
                if (zeitenJeStunde.size > ZEITEN_MAX) zeitenJeStunde.clear()
                zeitenJeStunde.set(`${a.symbol}|${a.markt}|${h}`, [events[0][0], events[events.length - 1][0]])
            }
            b = buendele(events, { ivMs: a.ivMs, stufe: a.stufe })
            if (!laufend(h)) neu.push([cacheSchluessel(a, h), b])
        }
        legeZusammen(gesamt, b)
        erste ??= h
        letzte = h + STUNDE
        // Früh abbrechen: mehr Zeilen als erlaubt werden es nicht wieder weniger — und nichts merken
        if (zellenVon(gesamt, a.von, a.bis) > MAX_ZEILEN) return { symbol: a.symbol, stufe: a.stufe, zuFein: true, kerzen: [], aufgezeichnet: true }
    }
    // Erst jetzt merken — die Antwort ist brauchbar
    for (const [k, b] of neu) merke(k, b)
    for (const kt of [...gesamt.keys()]) if (kt < a.von || kt >= a.bis) gesamt.delete(kt)
    return {
        symbol: a.symbol, markt: a.markt, interval: a.interval, stufe: a.stufe, von: a.von, bis: a.bis,
        aufgezeichnet: stunden.length > 0, erfasstVon: erste, erfasstBis: letzte, kerzen: alsListe(gesamt, a.stufe),
        abschnitte: abschnitteAus(stunden, (h) => zeitenJeStunde.get(`${a.symbol}|${a.markt}|${h}`)),
    }
}

export function setupChartFootprintRoutes(app) {
    app.get('/api/chart/footprint', async (req, res) => {
        const a = pruefeFootprintAnfrage(req.query)
        if (a.fehler) return res.status(400).json({ error: a.fehler })
        try {
            const knex = getKnex()
            const wo = (q) => q.where({ symbol: a.symbol, market: a.markt, kind: 'trades' })
                .andWhere('hourStart', '>=', Math.floor(a.von / STUNDE) * STUNDE)
                .andWhere('hourStart', '<', a.bis)
            const antwort = await baueFootprint(a, {
                stunden: async () => (await wo(knex('live_recordings').select('hourStart')).orderBy('hourStart')).map((z) => Number(z.hourStart)),
                nutzlast: async (liste) => {
                    const m = new Map()
                    for (let i = 0; i < liste.length; i += 50) {
                        for (const z of await wo(knex('live_recordings').select('hourStart', 'payload')).whereIn('hourStart', liste.slice(i, i + 50))) m.set(Number(z.hourStart), z.payload)
                    }
                    return m
                },
            })
            res.set('Cache-Control', 'no-store')
            res.json(antwort)
        } catch (e) {
            logWarn('chart-footprint', `${a.symbol} ${a.interval}: ${e.message}`)
            res.status(500).json({ error: 'Footprint konnte nicht gelesen werden' })
        }
    })
}
