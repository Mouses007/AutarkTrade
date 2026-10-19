/**
 * Marktdaten-Abstraktion (Verkaufs-Prüfung, Massnahme 1).
 *
 * Öffentliche Marktdaten der Börsen erlaubt laut Prüfung KEINE Börse
 * ausdrücklich für ein verkauftes Drittprodukt; Binance ist das Rückgrat und
 * zugleich das grösste offene Risiko. Darum hängt keine Funktion mehr fest an
 * einer Börse: Der Kunde wählt in den Einstellungen die Marktdatenquelle und
 * verantwortet deren Nutzung selbst (Hinweis steht bei der Auswahl).
 *
 * Drei Wahlen:
 *   binance  voller Umfang (Kerzen, Ticker, Buch, Funding, OI-Historie,
 *            Taker/Long-Short, Liquidationen, Streams für Bookmap/Rekorder)
 *   bitget   Grundbedarf (Kerzen, Ticker, Buch, Funding, Kontraktregeln)
 *   aus      keine öffentlichen Börsen-Marktdaten — Journal, Konten und
 *            Orders (Kundenschlüssel) laufen weiter
 *
 * Jede Funktion fragt nach einer FÄHIGKEIT, nie nach einem Namen. Fehlt sie
 * beim gewählten Anbieter, wirft `fordere()` ein `MarktdatenAus`, und die
 * Route antwortet mit `{ aus: true, grund: 'marktdaten', … }` — die Kachel
 * sagt dann, warum sie leer ist, statt kaputt auszusehen.
 *
 * Die Wahl liegt in `settings.marktdatenQuelle` und wird 30 s im Speicher
 * gehalten (ein Takt alle 5 s soll nicht jedes Mal die DB fragen).
 */

import * as binance from './binance.js'
import * as bitget from './bitget.js'

export const ANBIETER = { binance, bitget }
export const WAHLEN = ['binance', 'bitget', 'aus']
export const VORGABE = 'binance'

/** Alle Fähigkeiten mit deutscher Bezeichnung (für Meldungen und die Einstellung). */
export const FAEHIGKEITEN = {
    kerzen: 'Kerzen (Futures)',
    spot: 'Spot-Kerzen und -Ticker',
    ticker: 'Ticker aller Märkte',
    orderbuch: 'Orderbuch-Momentaufnahme',
    funding: 'Funding-Raten',
    symbole: 'Kontraktregeln',
    oiHistorie: 'Open-Interest-Verlauf',
    takerVolumen: 'Taker-Kauf/Verkauf',
    longShort: 'Long/Short-Verhältnis',
    liquidationen: 'Liquidationsstrom',
    streams: 'Echtzeit-Streams (Bookmap, Rekorder, Replay)',
    listungen: 'Listungsdaten (Handelsstart)',
}

export class MarktdatenAus extends Error {
    constructor(faehigkeit, quelle) {
        const was = FAEHIGKEITEN[faehigkeit] || faehigkeit
        super(quelle === 'aus'
            ? `Marktdaten sind ausgeschaltet (Einstellungen › Datenquellen) — ${was} nicht verfügbar`
            : `${was} gibt es mit der Marktdatenquelle ${ANBIETER[quelle]?.name || quelle} nicht`)
        this.code = 'marktdatenAus'
        this.faehigkeit = faehigkeit
        this.quelle = quelle
        this.status = 409
    }
}

// ── Wahl lesen ───────────────────────────────────────────────────────────
let gemerkt = { wahl: null, ts: 0 }
const MERKEN_MS = 30000
let leser = async () => {
    const { getKnex } = await import('../database.js')
    const z = await getKnex()('settings').select('marktdatenQuelle').where('id', 1).first()
    return z?.marktdatenQuelle
}

export function normWahl(w) {
    const s = String(w || '').toLowerCase()
    return WAHLEN.includes(s) ? s : VORGABE
}

/** Aktuelle Wahl (`binance` | `bitget` | `aus`). Ein Lesefehler fällt auf die Vorgabe zurück. */
export async function wahl() {
    if (gemerkt.wahl && Date.now() - gemerkt.ts < MERKEN_MS) return gemerkt.wahl
    let w = VORGABE
    try { w = normWahl(await leser()) } catch { /* DB noch nicht bereit */ }
    gemerkt = { wahl: w, ts: Date.now() }
    return w
}

/** Nach dem Speichern: neue Wahl sofort gelten lassen. */
export function merkeWahl(w) {
    gemerkt = { wahl: normWahl(w), ts: Date.now() }
}

/** Nur für Selbsttests: Wahl-Leser ersetzen und Merker leeren. */
export function _setzeLeser(fn) {
    leser = fn
    gemerkt = { wahl: null, ts: 0 }
}

export function faehigkeitenVon(w) {
    return w === 'aus' ? [] : [...(ANBIETER[w]?.faehigkeiten || [])]
}

/** Beschreibung für die Oberfläche: `{ wahl, name, faehigkeiten, fehlt }`. */
export async function beschreibung() {
    const w = await wahl()
    const hat = new Set(faehigkeitenVon(w))
    return {
        wahl: w,
        name: w === 'aus' ? null : ANBIETER[w].name,
        faehigkeiten: [...hat],
        fehlt: Object.keys(FAEHIGKEITEN).filter((f) => !hat.has(f)),
        // Der Browser verbindet seine Streams (Bookmap, laufende Kerze,
        // Watchlist) selbst. Die Wurzeln kommen von hier, damit auch im
        // Browser-Code keine Binance-Adresse steht — und nur bei Wahl Binance.
        streamWurzeln: hat.has('streams') && w === 'binance' ? { ...binance.WS } : null,
        wahlen: WAHLEN.map((id) => ({
            id,
            name: id === 'aus' ? null : ANBIETER[id].name,
            faehigkeiten: faehigkeitenVon(id),
        })),
    }
}

/** Hat die gewählte Quelle diese Fähigkeit? */
export async function kann(faehigkeit) {
    return faehigkeitenVon(await wahl()).includes(faehigkeit)
}

/**
 * Anbieter holen, der die Fähigkeit hat — oder `MarktdatenAus` werfen.
 * Spot-Abrufe verlangen zusätzlich `spot`.
 */
export async function fordere(faehigkeit, { markt } = {}) {
    const w = await wahl()
    const hat = faehigkeitenVon(w)
    if (!hat.includes(faehigkeit)) throw new MarktdatenAus(faehigkeit, w)
    if (markt === 'spot' && !hat.includes('spot')) throw new MarktdatenAus('spot', w)
    return ANBIETER[w]
}

/**
 * Für die Wege, die es NUR bei Binance gibt (OI-Historie, Taker, Long/Short,
 * Liquidationen, Streams): REST-Wurzel von Binance, sofern Binance gewählt
 * ist und die Fähigkeit hat. Der Aufrufer nennt die Fähigkeit, damit die
 * Meldung sagt, was fehlt.
 */
export async function binanceRest(faehigkeit, markt = 'futures') {
    const a = await fordere(faehigkeit, { markt })
    if (a.id !== 'binance') throw new MarktdatenAus(faehigkeit, a.id)
    return binance.REST[markt === 'spot' ? 'spot' : 'futures']
}

/** Wie `binanceRest`, für WebSocket-Wurzeln (Rekorder). */
export async function binanceWs(markt = 'futures') {
    const a = await fordere('streams', { markt })
    if (a.id !== 'binance') throw new MarktdatenAus('streams', a.id)
    return binance.WS[markt === 'spot' ? 'spot' : 'futures']
}

/** GET gegen Binance mit Gewichtsbuchhaltung, nur wenn Binance gewählt ist. */
export async function binanceHole(faehigkeit, markt, pfad, params, opts) {
    await binanceRest(faehigkeit, markt)
    return binance.hole(markt, pfad, params, opts)
}

// ── Gemeinsame Abrufe ────────────────────────────────────────────────────

/** Kerzen inkl. laufender: `{t,o,h,l,c,v,closeTime}` aufsteigend. */
export async function kerzen(symbol, interval, opts = {}) {
    const a = await fordere('kerzen', opts)
    return a.kerzen(String(symbol).toUpperCase(), interval, opts)
}

/** Grösste Seite, die der Anbieter je Kerzenabruf liefert. */
export async function kerzenMax(markt = 'futures') {
    const a = await fordere('kerzen', { markt })
    return a.KERZEN_MAX[markt === 'spot' ? 'spot' : 'futures']
}

export async function preis(symbol, opts = {}) {
    const a = await fordere('ticker', opts)
    const p = await a.preis(String(symbol).toUpperCase(), opts)
    if (!Number.isFinite(p)) throw new Error(`Kein Preis für ${symbol}`)
    return p
}

export async function preise(opts = {}) {
    const a = await fordere('ticker', opts)
    return a.preise(opts)
}

/**
 * 24h-Ticker aller Symbole, gemeinsame Form:
 * `{ symbol, preis, hoch, tief, eroeffnung, aenderungPct, umsatzQuote,
 *    umsatzBasis, bid, ask, bidMenge, askMenge, funding?, offenePositionen? }`
 */
export async function ticker24h(opts = {}) {
    const a = await fordere('ticker', opts)
    return a.ticker24h(opts)
}

/** 24h-Ticker EINES Symbols (gemeinsame Form; Geld/Brief nicht zugesichert). */
export async function ticker24hEinzeln(symbol, opts = {}) {
    const a = await fordere('ticker', opts)
    return a.ticker24hEinzeln(String(symbol).toUpperCase(), opts)
}

export async function orderbuch(symbol, opts = {}) {
    const a = await fordere('orderbuch', opts)
    return a.orderbuch(String(symbol).toUpperCase(), opts)
}

export async function funding(symbol) {
    const a = await fordere('funding')
    return a.funding(String(symbol).toUpperCase())
}

export async function fundingVerlauf(symbol, von, bis) {
    const a = await fordere('funding')
    return a.fundingVerlauf(String(symbol).toUpperCase(), Number(von) || 0, Number(bis) || Date.now())
}

export async function symbole(opts = {}) {
    const a = await fordere('symbole', opts)
    return a.symbole(opts)
}

// ── Für Routen ───────────────────────────────────────────────────────────

/** Ist `e` ein „gibt es mit dieser Quelle nicht"? */
export function istAus(e) {
    return e instanceof MarktdatenAus || e?.code === 'marktdatenAus'
}

/** Antwortkörper für eine abgeschaltete Funktion (gleiche Form wie `quellen/aus.js`). */
export function ausAntwort(e) {
    return {
        aus: true, grund: 'marktdaten', faehigkeit: e.faehigkeit, quelle: e.quelle,
        quelleName: ANBIETER[e.quelle]?.name || null,
        meldung: e.message,
    }
}

/**
 * In einer Route: `if (sendeWennAus(res, e)) return`. Antwortet 200 mit
 * `{ aus: true, … }` — keine Fehlermeldung, sondern ein Zustand, den die
 * Oberfläche erklärt.
 */
export function sendeWennAus(res, e) {
    if (!istAus(e)) return false
    res.json(ausAntwort(e))
    return true
}

/** Routen: `GET /api/marktdaten/quelle`, `PUT /api/marktdaten/quelle {wahl}`. */
export function setupMarktdatenRoutes(app) {
    app.get('/api/marktdaten/quelle', async (req, res) => {
        res.json(await beschreibung())
    })
    app.put('/api/marktdaten/quelle', async (req, res) => {
        const w = String(req.body?.wahl || '').toLowerCase()
        if (!WAHLEN.includes(w)) return res.status(400).json({ error: `Unbekannte Marktdatenquelle: ${w}` })
        try {
            const { getKnex } = await import('../database.js')
            await getKnex()('settings').where('id', 1).update({ marktdatenQuelle: w })
            merkeWahl(w)
            res.json(await beschreibung())
        } catch (e) {
            res.status(500).json({ error: e.message })
        }
    })
}
