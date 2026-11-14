/**
 * Kursquelle des Newcomer-Radars: Tageskerzen und Stammdaten von Yahoo Finance.
 *
 * Läuft nur mit dem Schalter «Quellen mit eingeschränkten Nutzungsbedingungen»
 * (`fordereQuelle('yahoo')`, `server/quellen/freigabe.js`). Das Lesen der
 * Antworten steht netzfrei in `kursquelle-kern.js`.
 */
import { fordereQuelle } from '../quellen/freigabe.js'
import { ausChart, ausSuche } from './kursquelle-kern.js'

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
