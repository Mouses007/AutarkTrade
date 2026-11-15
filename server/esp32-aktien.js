/**
 * Aktien für die Anzeigen (ESP32-Displays, Android-Widget, Desklet).
 *
 * Die Geräte fragen `/api/esp32/kurs`, `/display` und `/alarme`. Bis hierher
 * kannten diese Antworten nur Coins. Drei Dinge ändern sich für Aktien — und
 * nur zusätzlich, kein bestehendes Feld wird umbenannt oder entfällt (die
 * Firmware im Feld liest mit ArduinoJson bzw. `optString` und übergeht, was
 * sie nicht kennt):
 *
 *   1. Symbol. Im Setup-Portal steht «NVDA». Angehängtes `USDT` trifft bei
 *      Binance (`NVDAUSDT`), bei Bitget heisst der Kontrakt anders. Der Stamm
 *      weiss, wie die Marktdatenquelle den Titel nennt — ohne ihn gäbe es
 *      «Symbol unbekannt» für einen Titel, den es gibt.
 *   2. Sitzung. Jede Kurs-Antwort eines Aktien-Titels trägt `anlageklasse`,
 *      `sitzung` (wie `shared/aktien-sitzung.js`) und `boerseOffen`. Der
 *      Future handelt zwar durch, aber am Wochenende steht der Chart fast
 *      still — das ist ein Zustand der Börse, kein Fehler der Daten.
 *   3. Keine Kerzen bei geschlossener Börse. Liefert die Quelle für einen
 *      Aktien-Titel ausserhalb der regulären Sitzung keine (oder nur eine)
 *      Kerze, antwortet der Server mit HTTP 200, `zustand: 'boerseZu'` und
 *      leerem `kerzen` statt mit 502. Alte Firmware zeigt dann «Keine
 *      Kursdaten» bzw. behält den letzten Chart, neue kann «Börse zu» zeigen.
 *      Während der regulären Sitzung bleibt eine leere Antwort ein Fehler.
 *
 * Der obere Teil ist rein und im Selbsttest geprüft.
 */
import { sitzungVon, handelstagVon } from '../shared/aktien-sitzung.js'
import { timeframeMs } from './market-data.js'

/* ── Rein ─────────────────────────────────────────────────────────── */

/** Sitzung der US-Börse, wie die Geräte sie bekommen. */
export function boersenZustand(ms = Date.now()) {
    const sitzung = sitzungVon(ms)
    return { sitzung, boerseOffen: sitzung === 'regulaer', handelstag: handelstagVon(ms) }
}

/** Ticker aus der Eingabe des Geräts: «nvda», «NVDAUSDT», «brk.b» → `NVDA`, `NVDA`, `BRK.B`. */
export function tickerAus(roh) {
    const s = String(roh || '').toUpperCase().replace(/[^A-Z0-9.]/g, '').slice(0, 20)
    return s.replace(/(USDT|USDC)$/, '')
}

/**
 * Die Listung zur Eingabe finden. Reihenfolge: genau dieses Symbol an der
 * Marktdatenquelle; sonst der Ticker an der Marktdatenquelle. Eine Listung an
 * einer ANDEREN Börse zählt nicht — deren Symbol kennt die Quelle nicht.
 *
 * @param {{symbol: string, ticker: string, name?: string, unterart?: string, handelsplatz: string}[]} listungen
 * @param {string} symbol   das gesäuberte Symbol (`kursSymbol`)
 * @param {string} roh      die Eingabe des Geräts
 * @param {string|null} quelle  Marktdatenquelle (`binance`, `bitget`)
 * @param {{nurGenau?: boolean}} [opt]  `nurGenau`: nur das Symbol selbst, nicht der Ticker.
 *        Die Route fragt zuerst genau — ein Coin, dessen Kürzel zufällig auch ein
 *        Aktien-Ticker ist, darf nicht auf die Aktie umgebogen werden. Der Ticker
 *        zählt erst, wenn die Quelle das Symbol selbst nicht kennt.
 */
export function waehleListung(listungen = [], symbol, roh, quelle, { nurGenau = false } = {}) {
    const eigene = listungen.filter((l) => l.handelsplatz === quelle)
    const genau = eigene.find((l) => l.symbol === symbol)
    if (genau || nurGenau) return genau || null
    const ticker = tickerAus(roh)
    if (!ticker) return null
    return eigene.find((l) => l.ticker === ticker)
        || eigene.find((l) => l.ticker.replace(/\./g, '') === ticker.replace(/\./g, ''))
        || null
}

/** Ab diesem Vielfachen der Kerzenlänge gilt die letzte Kerze als alt. */
export const ALT_AB_KERZEN = 3

/**
 * Zusatzfelder der Kurs-Antwort für einen Aktien-Titel.
 * @param {{ticker: string, name?: string}} titel
 * @param {{t?: number}[]} kerzen  Rohkerzen, älteste zuerst
 */
export function aktienFelder(titel, kerzen = [], interval = '15m', jetzt = Date.now()) {
    const letzte = Number(kerzen[kerzen.length - 1]?.t)
    const schritt = timeframeMs(interval)
    const kerzeZeit = Number.isFinite(letzte) && letzte > 0 ? letzte : null
    return {
        anlageklasse: 'aktien',
        ticker: titel.ticker,
        name: titel.name || null,
        ...boersenZustand(jetzt),
        // Zeit der letzten Kerze und ob sie alt ist — unbekannt bleibt null, nicht «frisch».
        kerzeZeit,
        veraltet: kerzeZeit === null || !schritt ? null : jetzt - (kerzeZeit + schritt) > ALT_AB_KERZEN * schritt,
    }
}

/**
 * Antwort, wenn für einen Aktien-Titel keine zeichenbaren Kerzen da sind.
 * Bei geschlossener Börse ein Zustand (HTTP 200), sonst `null` (→ 502 wie bisher).
 */
export function boerseZuAntwort(symbol, spanne, titel, jetzt = Date.now()) {
    const zustand = boersenZustand(jetzt)
    if (zustand.boerseOffen) return null
    return {
        symbol, spanne,
        // Dieselben Kopf-Felder wie eine gewöhnliche Antwort, damit kein Leser ins Leere greift.
        jetzt: null, start: null, hoch: null, tief: null, aenderung: 0,
        kerzen: [],
        zustand: 'boerseZu',
        anlageklasse: 'aktien',
        ticker: titel.ticker,
        name: titel.name || null,
        ...zustand,
        kerzeZeit: null,
        veraltet: null,
    }
}

/* ── Mit Datenbank ────────────────────────────────────────────────── */

const MERK_MS = 10 * 60_000
let merk = { zeit: 0, modus: false, listungen: [] }

/** Aktien-Futures des Stamms, zehn Minuten gemerkt. Ohne Aktien-Modus oder ohne Stamm leer. */
async function ladeListungen(knex) {
    if (Date.now() - merk.zeit < MERK_MS) return merk
    let modus = false, listungen = []
    try {
        const s = await knex('settings').select('modusAktienAn').where('id', 1).first()
        modus = Number(s?.modusAktienAn ?? 0) === 1
        if (modus && await knex.schema.hasTable('instrument_listungen')) {
            listungen = await knex('instrument_listungen as l').join('instrumente as i', 'i.id', 'l.instrumentId')
                .where({ 'l.art': 'perp', 'l.aktiv': 1, 'i.anlageklasse': 'aktien' })
                .select('l.symbol', 'l.handelsplatz', 'i.ticker', 'i.name', 'i.unterart')
        }
    } catch {
        // Ältere Datenbank ohne die Spalten: dann gibt es keine Aktien — Coins laufen wie immer.
        modus = false
        listungen = []
    }
    merk = { zeit: Date.now(), modus, listungen }
    return merk
}

/**
 * Ist die Eingabe ein Aktien-Future der Marktdatenquelle?
 * @returns {Promise<{symbol: string, ticker: string, name: string|null}|null>}  null = Coin (oder nicht zu beantworten)
 */
export async function aktienTitelFuer(knex, symbol, roh, quelle, opt = {}) {
    const { listungen } = await ladeListungen(knex)
    const l = waehleListung(listungen, symbol, roh, quelle, opt)
    return l ? { symbol: l.symbol, ticker: l.ticker, name: l.name || null } : null
}

/** Symbole der Aktien-Futures je Börse — für die Marke an offenen Positionen. */
export async function aktienSymbole(knex) {
    const { modus, listungen } = await ladeListungen(knex)
    const je = new Map()
    for (const l of listungen) {
        if (!je.has(l.handelsplatz)) je.set(l.handelsplatz, new Set())
        je.get(l.handelsplatz).add(l.symbol)
    }
    return { modus, je }
}

/** Nur für Selbsttests. */
export function leereEsp32AktienMerk() { merk = { zeit: 0, modus: false, listungen: [] } }
