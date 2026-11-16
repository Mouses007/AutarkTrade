/**
 * Sparte der Titel (Sektor und Branche): lesen, merken, nachfüllen.
 *
 * Quelle ist die Kursquelle, die die Titel-Seite ohnehin fragt (Yahoo
 * `quoteSummary`, Modul `assetProfile`, hinter `fordereQuelle('yahoo')`) —
 * keine neue Datenquelle. Gemerkt wird in den Spalten `sektor` / `branche`
 * des Titel-Stamms, die es seit Phase 1 gibt, dazu `sparteSymbol` (zu welchem
 * Kurssymbol die Angabe gehört) und `sparteStand`.
 *
 * Zwei Wege füllen sie:
 *   - die Titel-Seite merkt, was sie ohnehin geholt hat (`merkeSparte`)
 *   - nach einem Aktien-Radar-Lauf und beim Anheften eines Favoriten füllt
 *     `fuelleSparten` nach, was fehlt oder veraltet ist: ein schlanker Abruf je
 *     Titel (nur `assetProfile,price`), mit Pause, höchstens `max` je Aufruf.
 *     Bremst die Quelle oder ist sie aus, hört er auf.
 *
 * Wann eine Angabe als sicher gilt, steht in `sparte-kern.js`.
 */
import { holeZusammenfassung, NichtGefunden, Gebremst } from '../newcomer-radar/kursquelle.js'
import { kursSymbolFuer } from '../newcomer-radar/kursquelle-kern.js'
import { ausZusammenfassung } from './titel-kern.js'
import { sparteAus, sparteGilt, brauchtSparte, sparteZeile } from './sparte-kern.js'
import { istAus } from '../quellen/aus.js'
import { logWarn } from '../logger.js'

const MODULE_SPARTE = 'assetProfile,price'
const PAUSE_MS = 500
const warte = (ms) => new Promise((r) => setTimeout(r, ms))
const stuecke = (liste, n) => {
    const out = []
    for (let i = 0; i < liste.length; i += n) out.push(liste.slice(i, i + n))
    return out
}

/**
 * Titel des Stamms mit dem Kurssymbol, das heute für sie gilt.
 * @param {string[]} tickers
 * @returns {Promise<{zeile: object, kursSymbol: string|null, tagesstand: object|null}[]>}
 *          `tagesstand`: Zeile des Newcomer-Radars (Kennzahlen als JSON-Text), falls es eine gibt
 */
export async function ladeMitKursSymbol(knex, tickers) {
    const eindeutig = [...new Set((tickers || []).map((t) => String(t || '').toUpperCase()).filter(Boolean))]
    const aus = []
    for (const teil of stuecke(eindeutig, 400)) {
        const zeilen = await knex('instrumente').where('anlageklasse', 'aktien').whereIn('ticker', teil)
        if (!zeilen.length) continue
        const ids = zeilen.map((z) => z.id)
        const [gemerkt, listungen] = await Promise.all([
            knex('newcomer_titel').whereIn('instrumentId', ids).select('instrumentId', 'kursSymbol', 'kennzahlen', 'stand'),
            knex('instrument_listungen').whereIn('instrumentId', ids).where('aktiv', 1).select('instrumentId', 'handelsplatz', 'art'),
        ])
        const jeGemerkt = new Map(gemerkt.map((g) => [g.instrumentId, g]))
        const jeListung = new Map()
        for (const l of listungen) {
            if (!jeListung.has(l.instrumentId)) jeListung.set(l.instrumentId, [])
            jeListung.get(l.instrumentId).push(l)
        }
        for (const z of zeilen) {
            const g = jeGemerkt.get(z.id) || null
            aus.push({
                zeile: z, tagesstand: g,
                kursSymbol: kursSymbolFuer({ ticker: z.ticker, region: z.region, listungen: jeListung.get(z.id) || [] }, g),
            })
        }
    }
    return aus
}

/**
 * Sparte je Ticker: `{sektor, branche}` oder `null` (unbekannt). Ein Ticker,
 * den der Stamm nicht kennt, fehlt in der Karte.
 * @returns {Promise<Map<string, {sektor: string, branche: string|null}|null>>}
 */
export async function leseSparten(knex, tickers) {
    const karte = new Map()
    for (const t of await ladeMitKursSymbol(knex, tickers)) karte.set(t.zeile.ticker, sparteGilt(t.zeile, t.kursSymbol))
    return karte
}

/**
 * Die Titel-Seite hat das Profil ohnehin geholt — merken, was daraus folgt.
 * Schreibt nur, wenn sich etwas ändert oder der Stand veraltet ist.
 * @param {{ticker: string, name?: string|null}} titel
 * @param {object|null} profil  `profil` aus `ausZusammenfassung`
 */
export async function merkeSparte(knex, titel, kursSymbol, profil, jetzt = Date.now()) {
    if (!kursSymbol || !profil) return
    const zeile = await knex('instrumente').where({ anlageklasse: 'aktien', ticker: titel.ticker }).first()
    if (!zeile) return
    const neu = sparteZeile(sparteAus(profil, zeile.name, zeile.ticker), kursSymbol, jetzt)
    const gleich = zeile.sektor === neu.sektor && zeile.branche === neu.branche && zeile.sparteSymbol === neu.sparteSymbol
    if (gleich && !brauchtSparte(zeile, kursSymbol, jetzt)) return
    await knex('instrumente').where('id', zeile.id).update(neu)
}

let laeuft = null

/** Läuft gerade ein Nachfüllen? Die Seite fragt dann in Abständen neu, statt «unbekannt» stehen zu lassen. */
export const spartenLaeuft = () => laeuft !== null

/**
 * Fehlende oder veraltete Sparten nachfüllen. Läuft nie doppelt: ein zweiter
 * Aufruf bekommt das Versprechen des laufenden.
 *
 * @param {{tickers: string[], max?: number, jetzt?: number, pauseMs?: number, abruf?: Function}} o
 *        `abruf`: nur der Selbsttest reicht eine Attrappe für `holeZusammenfassung` herein
 * @returns {Promise<{gefragt: number, gemerkt: number, unbekannt: number, grund: string|null}>}
 */
export function fuelleSparten(knex, o = {}) {
    if (laeuft) return laeuft
    laeuft = fuelle(knex, o).finally(() => { laeuft = null })
    return laeuft
}

async function fuelle(knex, { tickers = [], max = 400, jetzt = Date.now(), pauseMs = PAUSE_MS, abruf = holeZusammenfassung } = {}) {
    const aus = { gefragt: 0, gemerkt: 0, unbekannt: 0, grund: null }
    const offen = (await ladeMitKursSymbol(knex, tickers)).filter((t) => brauchtSparte(t.zeile, t.kursSymbol, jetzt)).slice(0, max)
    for (const t of offen) {
        let ergebnis
        try {
            aus.gefragt++
            ergebnis = sparteAus(ausZusammenfassung(await abruf(t.kursSymbol, MODULE_SPARTE)).profil, t.zeile.name, t.zeile.ticker)
        } catch (e) {
            // Bremst die Quelle oder ist sie aus, wird nicht weitergefragt — und nichts als «unbekannt» gemerkt.
            if (e instanceof Gebremst) { aus.grund = 'gebremst'; break }
            if (istAus(e)) { aus.grund = 'quelleAus'; break }
            if (!(e instanceof NichtGefunden)) {
                // Netzfehler: beim nächsten Mal wieder versuchen, nichts merken.
                logWarn('aktien', `Sparte ${t.kursSymbol}: ${e.message}`)
                await warte(pauseMs)
                continue
            }
            ergebnis = { ok: false, grund: 'nichtGefunden' }
        }
        await knex('instrumente').where('id', t.zeile.id).update(sparteZeile(ergebnis, t.kursSymbol, jetzt))
        if (ergebnis.ok) aus.gemerkt++
        else aus.unbekannt++
        await warte(pauseMs)
    }
    return aus
}

/** Im Hintergrund nachfüllen; ein Fehler bleibt eine Zeile im Protokoll. */
export function fuelleSpartenImHintergrund(knex, tickers) {
    if (!tickers?.length) return
    fuelleSparten(knex, { tickers }).catch((e) => logWarn('aktien', `Sparten nachfüllen: ${e.message}`))
}

/*
 * Nachfüllen, wenn eine Seite Titel OHNE Sparte zeigt — so füllt sich der
 * Bestand auch ohne neuen Radar-Lauf (erstes Öffnen nach dem Update). Höchstens
 * alle zehn Minuten: ist die Quelle aus oder bremst sie, soll nicht jeder
 * Seitenaufruf wieder anklopfen. Was frisch gefragt ist, fragt `fuelleSparten`
 * ohnehin nicht noch einmal.
 */
const ANSTOSS_MS = 10 * 60_000
let letzterAnstoss = 0

export function stosseSpartenAn(knex, tickers, jetzt = Date.now()) {
    if (laeuft || !tickers?.length || jetzt - letzterAnstoss < ANSTOSS_MS) return
    letzterAnstoss = jetzt
    fuelleSpartenImHintergrund(knex, tickers)
}
