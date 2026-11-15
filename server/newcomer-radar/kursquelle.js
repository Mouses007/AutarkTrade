/**
 * Kursquelle des Newcomer-Radars: Tageskerzen und Stammdaten von Yahoo Finance.
 *
 * Läuft nur mit dem Schalter «Quellen mit eingeschränkten Nutzungsbedingungen»
 * (`fordereQuelle('yahoo')`, `server/quellen/freigabe.js`). Das Lesen der
 * Antworten steht netzfrei in `kursquelle-kern.js`.
 */
import { fordereQuelle } from '../quellen/freigabe.js'
import { ausChart, ausSuche } from './kursquelle-kern.js'
import { ausSplits } from '../aktien/splits.js'

const CHART = 'https://query1.finance.yahoo.com/v8/finance/chart/'
const SUCHE = 'https://query2.finance.yahoo.com/v1/finance/search'

/** Die Quelle kennt das Symbol nicht — eine Aussage, kein Ausfall. */
export class NichtGefunden extends Error {}
/** Die Quelle bremst (HTTP 429) — der Lauf soll aufhören, nicht weiterhämmern. */
export class Gebremst extends Error {}

async function hole(url) {
    await fordereQuelle('yahoo')
    const steuerung = new AbortController()
    const wecker = setTimeout(() => steuerung.abort(), 15000)
    try {
        const antwort = await fetch(url, { signal: steuerung.signal, headers: { 'user-agent': 'Mozilla/5.0', accept: 'application/json' } })
        if (antwort.status === 429) throw new Gebremst('HTTP 429')
        if (antwort.status === 404) throw new NichtGefunden('unbekanntes Symbol')
        if (!antwort.ok) throw new Error(`HTTP ${antwort.status}`)
        return await antwort.json()
    } finally {
        clearTimeout(wecker)
    }
}

/** Zwei Jahre Tageskerzen samt Stammdaten. Wirft `NichtGefunden`, `Gebremst` oder einen Netzfehler. */
export async function holeChart(symbol, jetzt = Date.now()) {
    const json = await hole(`${CHART}${encodeURIComponent(symbol)}?range=2y&interval=1d`)
    try {
        return ausChart(json, jetzt)
    } catch (e) {
        throw new NichtGefunden(e.message)
    }
}

/** Listung zu einem Firmennamen suchen: `{symbol, heimat}` oder `null` (siehe `ausSuche`). */
export async function sucheSymbol(name, ticker) {
    const json = await hole(`${SUCHE}?q=${encodeURIComponent(name)}&quotesCount=10&newsCount=0`)
    return ausSuche(json, name, ticker)
}

/*
 * Kennzahlen, Analysten und Ertragsverlauf eines Titels (`quoteSummary`, Titel-Seite).
 *
 * Anders als Kerzen und Suche verlangt dieser Endpunkt eine Sitzung: ein Cookie
 * von fc.yahoo.com und dazu einen «crumb». Gemessen am 15.11.2026: der crumb
 * kommt nur mit dem schlichten User-Agent `Mozilla/5.0` — ein ausführlicher
 * Browser-Agent bekam HTTP 429. Die Sitzung gilt eine halbe Stunde im Speicher;
 * weist Yahoo sie ab (401), wird sie einmal erneuert.
 */
const ZUSAMMENFASSUNG = 'https://query1.finance.yahoo.com/v10/finance/quoteSummary/'
const CRUMB = 'https://query1.finance.yahoo.com/v1/test/getcrumb'
const MODULE = 'assetProfile,price,summaryDetail,defaultKeyStatistics,financialData,recommendationTrend,upgradeDowngradeHistory,earnings,calendarEvents,insiderTransactions'
const SITZUNG_MS = 30 * 60_000
const KOPF = { 'user-agent': 'Mozilla/5.0' }
let sitzung = null

async function mitFrist(url, optionen = {}) {
    const steuerung = new AbortController()
    const wecker = setTimeout(() => steuerung.abort(), 15000)
    try {
        return await fetch(url, { ...optionen, signal: steuerung.signal })
    } finally {
        clearTimeout(wecker)
    }
}

async function yahooSitzung(neu = false) {
    if (!neu && sitzung && Date.now() - sitzung.zeit < SITZUNG_MS) return sitzung
    const erste = await mitFrist('https://fc.yahoo.com', { headers: KOPF, redirect: 'manual' })
    const cookie = (erste.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).filter((c) => /^A[13]=/.test(c)).join('; ')
    if (!cookie) throw new Error('Yahoo: kein Sitzungs-Cookie erhalten')
    const antwort = await mitFrist(CRUMB, { headers: { ...KOPF, cookie } })
    if (antwort.status === 429) throw new Gebremst('HTTP 429')
    const crumb = (await antwort.text()).trim()
    if (!antwort.ok || !crumb || crumb.length > 40 || /\s/.test(crumb)) throw new Error(`Yahoo: kein Sitzungsschlüssel (HTTP ${antwort.status})`)
    sitzung = { cookie, crumb, zeit: Date.now() }
    return sitzung
}

/** Rohe `quoteSummary`-Antwort; gelesen wird sie in `server/aktien/titel-kern.js`. */
export async function holeZusammenfassung(symbol) {
    await fordereQuelle('yahoo')
    for (const neu of [false, true]) {
        const s = await yahooSitzung(neu)
        const url = `${ZUSAMMENFASSUNG}${encodeURIComponent(symbol)}?modules=${MODULE}&crumb=${encodeURIComponent(s.crumb)}`
        const antwort = await mitFrist(url, { headers: { ...KOPF, accept: 'application/json', cookie: s.cookie } })
        if (antwort.status === 401 && !neu) continue
        if (antwort.status === 429) throw new Gebremst('HTTP 429')
        if (antwort.status === 404) throw new NichtGefunden('unbekanntes Symbol')
        if (!antwort.ok) throw new Error(`HTTP ${antwort.status}`)
        return await antwort.json()
    }
    throw new Error('Yahoo: Sitzung abgewiesen')
}

/**
 * Splits eines Titels der letzten zehn Jahre: `[{t, faktor, text}]` (leer = keine).
 * Für die Split-Wache der Simulation (`server/aktien/splits.js`).
 */
export async function holeSplits(symbol) {
    const json = await hole(`${CHART}${encodeURIComponent(symbol)}?range=10y&interval=1mo&events=split`)
    if (json?.chart?.error) throw new NichtGefunden(json.chart.error.description || 'Fehlerantwort')
    return ausSplits(json)
}
