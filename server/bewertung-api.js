/**
 * Bitcoin-Bewertung — Abruf, Einlagerung und Kachel-Endpunkt.
 *
 * Zwei freie Quellen, beide ohne Schlüssel:
 *
 * - **Coin Metrics, Community-API**: Tageskurs und MVRV seit 2010. Daraus
 *   folgen Realized Price (Kurs / MVRV) und der 200-Wochen-Durchschnitt. Der
 *   Realized Cap selbst (`CapRealUSD`) ist im freien Zugang gesperrt, das
 *   Verhältnis nicht — darum der Umweg.
 * - **BGeometrics** (bitcoin-data.com): Einstand der kurzfristigen Halter.
 *   Gratis gibt es vier Jahre Verlauf, sieben Tage verzögert, und höchstens
 *   15 Abrufe am Tag (10 je Stunde) PRO ANSCHLUSS — NAS, Entwicklerrechner
 *   und Testcontainer teilen sich dieses Kontingent.
 *
 * Wie bei den ETF-Beständen ruft die Kachel nie selbst ab: sie liest, was in
 * `market_snapshots` liegt. Geholt wird im Hintergrundtakt — Coin Metrics
 * höchstens alle sechs Stunden (nur die fehlenden Tage), BGeometrics einmal
 * am Tag (die Quelle wechselt ohnehin nur täglich). Fällt eine Quelle später
 * weg, bleibt der Bestand; fehlt BGeometrics, zeigt die Kachel zwei statt
 * drei Modelle.
 *
 * Beide Quellen stehen unter dem Schalter `quellenOhneFreigabe`: die Daten
 * von Coin Metrics sind CC BY-NC 4.0 (nicht-kommerziell, Quelle nennen), die
 * Bedingungen des Gratis-Zugangs von BGeometrics sind nicht geprüft.
 */

import { logWarn } from './logger.js'
import { beansprucheAufgabe, gibAufgabeFrei, meldeFehler } from './db-claim.js'
import { ausCache, holeJson, sendeRadar, sendRadarError, verwerfeCache } from './marktradar-api.js'
import { fordereQuelle, quelleErlaubt } from './quellen/freigabe.js'
import { leseReihe, schreibeReihe } from './snapshot-reihe.js'
import { istTestbetrieb } from './umgebung.js'
import {
    abrufAb, baueBewertung, frischeHinweis, reiheAusBGeometrics, reihenAusCoinMetrics,
} from './bewertung.js'

const CM_URL = 'https://community-api.coinmetrics.io/v4/timeseries/asset-metrics'
const BG_URL = 'https://bitcoin-data.com/v1/sth-realized-price'
const HTTP_TIMEOUT = 30000

const KIND_KURS = 'bewKurs'
const KIND_MVRV = 'bewMvrv'
const KIND_STH = 'bewSth'

const ANSPRUCH = 'snap_bewertung'
const ANSPRUCH_STH = 'snap_bewertung_sth'

/** Letzter Fehler je Quelle — die Kachel soll sagen können, was fehlt. */
let letzterFehler = { coinmetrics: null, bgeometrics: null }
let takt = null
/** Ein Lauf zur Zeit; wer dazukommt, wartet auf denselben. */
let lauf = null

// ── Abruf ───────────────────────────────────────────────────────────────

/**
 * Kurs und MVRV ab einem Tag holen (`ab` = null: ganze Geschichte).
 *
 * Eine Seite fasst 10'000 Tage, die ganze Geschichte also in einer Antwort.
 * Geblättert wird trotzdem, falls die Quelle die Seitengrösse einmal senkt —
 * aber nur zu einer Folgeadresse desselben Hosts.
 */
async function holeCoinMetrics(ab) {
    const url = new URL(CM_URL)
    url.searchParams.set('assets', 'btc')
    url.searchParams.set('metrics', 'PriceUSD,CapMVRVCur')
    url.searchParams.set('frequency', '1d')
    url.searchParams.set('page_size', '10000')
    url.searchParams.set('paging_from', 'start')
    if (ab) url.searchParams.set('start_time', ab)

    const zeilen = []
    let naechste = url.toString()
    for (let seite = 0; seite < 5 && naechste; seite++) {
        const d = await holeJson(naechste, HTTP_TIMEOUT)
        if (!Array.isArray(d?.data)) throw new Error('Antwort ohne Datenteil')
        zeilen.push(...d.data)
        const weiter = d.next_page_url
        naechste = weiter && String(weiter).startsWith(CM_URL) ? weiter : null
    }
    return reihenAusCoinMetrics(zeilen)
}

/** Einstand der kurzfristigen Halter — immer der ganze freie Verlauf, ein Abruf. */
async function holeBGeometrics() {
    try {
        return reiheAusBGeometrics(await holeJson(BG_URL, HTTP_TIMEOUT))
    } catch (e) {
        if (e.status === 429) {
            const klar = new Error('Tageskontingent des Gratis-Zugangs aufgebraucht (15 Abrufe je Anschluss)')
            klar.status = 429
            throw klar
        }
        throw e
    }
}

/**
 * Bestand nachführen.
 *
 * Misslingt Coin Metrics, wird der Anspruch zurückgegeben: der nächste Takt
 * (eine halbe Stunde später) versucht es wieder, statt sechs Stunden zu
 * warten. Bei BGeometrics ebenso — dort begrenzt das Tageskontingent die
 * Versuche ohnehin, und der äussere Anspruch lässt höchstens vier am Tag zu.
 */
export function aktualisiereBewertung() {
    if (lauf) return lauf
    lauf = laufeDurch().finally(() => { lauf = null })
    return lauf
}

async function laufeDurch() {
    if (!(await quelleErlaubt('coinmetrics'))) return { uebersprungen: 'Quelle aus' }
    if (!(await beansprucheAufgabe(ANSPRUCH, 6 * 60 * 60 * 1000))) return { uebersprungen: 'zu früh' }

    let zeilen = 0
    try {
        const vorhanden = await leseReihe(KIND_KURS)
        const { kurs, mvrv } = await holeCoinMetrics(abrufAb(vorhanden))
        zeilen += await schreibeReihe(KIND_KURS, kurs)
        zeilen += await schreibeReihe(KIND_MVRV, mvrv)
        letzterFehler.coinmetrics = null
    } catch (e) {
        letzterFehler.coinmetrics = e.message
        logWarn('bewertung', `Coin Metrics: ${e.message}`)
        await meldeFehler(ANSPRUCH, `Coin Metrics: ${e.message}`)
        await gibAufgabeFrei(ANSPRUCH)
    }

    if (await quelleErlaubt('bgeometrics') && await beansprucheAufgabe(ANSPRUCH_STH, 24 * 60 * 60 * 1000)) {
        try {
            zeilen += await schreibeReihe(KIND_STH, await holeBGeometrics())
            letzterFehler.bgeometrics = null
        } catch (e) {
            letzterFehler.bgeometrics = e.message
            logWarn('bewertung', `BGeometrics: ${e.message}`)
            await meldeFehler(ANSPRUCH_STH, `BGeometrics: ${e.message}`)
            await gibAufgabeFrei(ANSPRUCH_STH)
        }
    }

    if (zeilen) {
        verwerfeCache('bewertung')
        console.log(` -> Bitcoin-Bewertung: nachgeführt (${zeilen} Tageswerte)`)
    }
    return { zeilen, fehler: { ...letzterFehler } }
}

// ── Kachel ──────────────────────────────────────────────────────────────

/**
 * Nutzlast der Kachel. Liest nur den eigenen Bestand.
 *
 * Ist noch gar nichts da (erster Aufruf nach dem Update), wartet der Aufruf
 * auf einen Lauf — das sind ein bis zwei Abrufe, keine Minute wie bei den
 * ETF-Reihen. Danach kommt jede Antwort aus dem Bestand.
 */
export async function holeBewertung() {
    await fordereQuelle('coinmetrics')
    if (!(await leseReihe(KIND_KURS)).length && !istTestbetrieb()) {
        await aktualisiereBewertung().catch(() => { })
        verwerfeCache('bewertung')
    }
    return ausCache('bewertung', 10 * 60 * 1000, async () => {
        const [kurs, mvrv, sth] = await Promise.all([
            leseReihe(KIND_KURS), leseReihe(KIND_MVRV), leseReihe(KIND_STH),
        ])
        const nutzlast = baueBewertung({ kurs, mvrv, sth })
        if (!nutzlast) {
            return {
                leer: true,
                hinweis: letzterFehler.coinmetrics || 'Daten werden beim nächsten Takt geholt',
            }
        }
        const hinweise = [
            frischeHinweis(nutzlast.tag),
            letzterFehler.coinmetrics ? `Coin Metrics: ${letzterFehler.coinmetrics}` : null,
            letzterFehler.bgeometrics ? `BGeometrics: ${letzterFehler.bgeometrics}` : null,
        ].filter(Boolean)
        return {
            ...nutzlast,
            hinweis: hinweise.length ? hinweise.join(' · ') : undefined,
        }
    })
}

// ── Routen ──────────────────────────────────────────────────────────────

export function setupBewertungRoutes(app) {
    /**
     * Kachel-Endpunkt. `force=1` stösst einen Nachschlag an, umgeht aber die
     * Ansprüche nicht — sonst wäre das Tageskontingent von BGeometrics mit
     * fünfzehn Klicks weg.
     */
    app.get('/api/marktradar/bewertung', async (req, res) => {
        try {
            if (req.query.force === '1') aktualisiereBewertung().catch(() => { })
            sendeRadar(res, await holeBewertung())
        } catch (e) {
            sendRadarError(res, e, 'Bitcoin-Bewertung')
        }
    })

    // Beim Start einmal nachsehen, danach halbstündlich; die Ansprüche machen
    // daraus höchstens vier Abrufe am Tag bei Coin Metrics und einen bei
    // BGeometrics.
    if (!istTestbetrieb()) {
        setTimeout(() => { aktualisiereBewertung().catch(() => { }) }, 20000)
        takt = setInterval(() => { aktualisiereBewertung().catch(() => { }) }, 30 * 60 * 1000)
    }

    console.log(' -> Bitcoin-Bewertung routes initialized')
}

export function stopBewertung() {
    clearInterval(takt)
    takt = null
}
