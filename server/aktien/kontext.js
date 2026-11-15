/**
 * Ist dieses Symbol ein Aktien-Future — und was muss die Simulation dann wissen?
 *
 * Die Strategie-Schicht prüft Symbole nur der Form nach; `NVDAUSDT` läuft
 * durch Backtest und Papierbetrieb wie ein Coin. Diese Auskunft macht den
 * Unterschied sichtbar: Ticker, Börse (für die Stichtage in
 * `shared/aktien-sitzung.js`) und die Splits des Titels (für
 * `splits.js` — die Kerzen der Futures sind nicht split-bereinigt) und seine
 * Zahlentermine (`shared/aktien-zahlen.js`).
 *
 * `null` heisst Krypto, und zwar auch dann, wenn die Frage nicht zu
 * beantworten ist (keine Datenbank im Selbsttest, leerer Stamm): die
 * Simulation verhält sich dann wie vor der Aktien-Integration.
 */
import { getKnex } from '../database.js'
import * as marktdaten from '../marktdaten/index.js'
import { holeSplits } from '../newcomer-radar/kursquelle.js'
import { kursSymbolFuer } from '../newcomer-radar/kursquelle-kern.js'
import { istAus } from '../quellen/aus.js'
import { CHART_BOERSEN } from './chart-symbole.js'
import { ladeTermine } from './termine.js'

const KONTEXT_MS = 10 * 60_000
/**
 * «Kein Aktien-Future» gilt nur kurz: die Antwort kostet eine Datenbankabfrage,
 * und ein eben erst abgeglichener Stamm (erster Lauf, neue Listung) soll nicht
 * zehn Minuten lang als Coin gerechnet werden.
 */
const KEIN_TITEL_MS = 30_000
const SPLITS_MS = 12 * 60 * 60_000
/** So oft höchstens darf ein Aufrufer die Splits eines Symbols am Speicher vorbei holen (`splitsFrisch`). */
const FRISCH_MS = 10 * 60_000
const kontextCache = new Map()   // börse|symbol → { zeit, wert } (börse leer = Marktdatenquelle, `jede` = irgendeine)
const frischGeholt = new Map()   // symbol → Zeit des letzten Abrufs am Speicher vorbei
const splitsCache = new Map()    // kursSymbol → { zeit, splits, grund }

async function ladeSplits(kursSymbol) {
    if (!kursSymbol) return { splits: null, grund: 'keinKursSymbol' }
    const c = splitsCache.get(kursSymbol)
    if (c && Date.now() - c.zeit < (c.splits ? SPLITS_MS : 5 * 60_000)) return c
    let wert
    try {
        wert = { splits: await holeSplits(kursSymbol), grund: null }
    } catch (e) {
        wert = { splits: null, grund: istAus(e) ? 'quelleAus' : 'abrufFehlgeschlagen' }
    }
    splitsCache.set(kursSymbol, { zeit: Date.now(), ...wert })
    return wert
}

/*
 * Aktien-Modus (FUN-K-002): solange `settings.modusAktienAn` aus ist, gibt es
 * serverseitig keine Aktien-Futures — jedes Symbol ist ein Coin, und für Splits
 * und Termine geht kein Abruf hinaus. Vorher blieb die Aktien-Behandlung an,
 * sobald der Stamm einmal gefüllt war. 30 s im Speicher wie die
 * Marktdatenquelle und der Schalter «Quellen ohne Freigabe»; nach dem
 * Speichern des Schalters `vergissModus()`.
 */
const MODUS_MS = 30_000
let modusGemerkt = { an: undefined, ts: 0 }
const modusAusDb = async () => (await getKnex()('settings').select('modusAktienAn').where('id', 1).first())?.modusAktienAn
let modusLeser = modusAusDb
const modusAusWert = (w) => w === true || Number(w) === 1

/**
 * Ist der Aktien-Modus eingeschaltet?
 *
 * Ein LESEFEHLER (Datenbank kurz nicht erreichbar, gesperrte SQLite) ist kein
 * «aus»: der letzte bekannte Wert gilt weiter, und gemerkt wird nichts — die
 * nächste Frage liest wieder. Vorher stand der Fehler 30 s als «aus» im
 * Speicher, und ein Engine-Takt in dieser Zeit rechnete Aktien-Kerzen ohne
 * Split-Bereinigung und Sitzungsregeln (Review 15.11.2026, RAS-08). Nur ohne
 * bekannten Wert (keine Datenbank im Selbsttest, Spalte fehlt) gilt «aus».
 */
export async function aktienModusAn() {
    if (modusGemerkt.an !== undefined && Date.now() - modusGemerkt.ts < MODUS_MS) return modusGemerkt.an
    let an
    try { an = modusAusWert(await modusLeser()) } catch { return modusGemerkt.an ?? false }
    modusGemerkt = { an, ts: Date.now() }
    return an
}

/** Nach dem Speichern von `modusAktienAn`: Schalter und gemerkte Auskünfte gelten sofort neu. */
export function vergissModus() {
    modusGemerkt = { an: undefined, ts: 0 }
    kontextCache.clear()
}

/** Nur für Selbsttests: Schalter ohne Datenbank stellen (`null` = wieder aus der Datenbank lesen). */
export function _setzeModusLeser(fn) {
    modusLeser = typeof fn === 'function' ? fn : modusAusDb
    modusGemerkt = { an: undefined, ts: 0 }
}

const istSpot = (market) => String(market || '').toLowerCase() === 'spot'

/** `boerse`-Angabe eines Aufrufers: eine Chart-Börse, `jede` oder leer (= Marktdatenquelle). */
const JEDE = 'jede'
const woVon = (boerse) => (boerse === JEDE || CHART_BOERSEN.includes(boerse) ? boerse : '')

/**
 * Der Titel des Stamms hinter einem Future-Symbol — nur Datenbank, kein Netz. `null` = kein Aktien-Future.
 *
 * BUG-K-001: Dasselbe Symbol kann an zwei Börsen Verschiedenes heissen (`ACNUSDT`: bei Bitget ein
 * Spot-Coin, bei Bitunix der Accenture-Future). Es zählt deshalb die Listung der Börse, von der die
 * Kerzen kommen: ohne Angabe die Marktdatenquelle (Backtest, Papierbetrieb, Radar), mit `boerse`
 * genau diese (Chart-Panel mit eigener Quelle). Den früheren Rückfall auf irgendeine Börse gibt es
 * nur noch, wo keine Börse widersprechen kann: Marktdaten ausgeschaltet, oder der Aufrufer kennt
 * die Börse des Symbols nicht und sagt das mit `boerse: 'jede'` (Chart-Alarm, Flash-News).
 * Spot ist nie ein Aktien-Future.
 */
async function stammZeile(symbol, { market, boerse: wo = '' } = {}) {
    if (istSpot(market)) return null
    const knex = getKnex()
    let quelle = null
    if (!wo || wo === JEDE) {
        try { quelle = (await marktdaten.fordere('kerzen', { markt: 'futures' })).id } catch { /* Marktdaten aus */ }
    }
    const boerse = wo && wo !== JEDE ? wo : quelle
    const zeilen = await knex('instrument_listungen as l').join('instrumente as i', 'i.id', 'l.instrumentId')
        .where({ 'l.symbol': symbol, 'l.art': 'perp', 'l.aktiv': 1, 'i.anlageklasse': 'aktien' })
        .whereIn('l.handelsplatz', CHART_BOERSEN)
        .select('i.id', 'i.ticker', 'i.name', 'i.unterart', 'i.region', 'l.handelsplatz')
    const irgendeine = wo === JEDE || !boerse
    const zeile = zeilen.find((z) => z.handelsplatz === boerse) || (irgendeine ? zeilen[0] : null)
    return zeile ? { ...zeile, boerse: boerse || zeile.handelsplatz } : null
}

/**
 * Anlageklasse einer Symbolliste (für Strategie-Instanzen): `aktien`, wenn
 * JEDES Symbol ein Aktien-Future ist, `krypto`, wenn keines es ist. Gemischt
 * ist ein Fehler — eine Instanz hat EINE Tagesgrenze und EINEN Markt.
 * Ist die Frage nicht zu beantworten (keine Datenbank), gilt Krypto — ebenso
 * bei ausgeschaltetem Aktien-Modus (FUN-K-002) und im Spot-Markt (BUG-K-001).
 *
 * @param {string[]} symbole
 * @param {{market?: 'spot'|'futures', boerse?: string}} [opt]  Markt der Symbole, wo der Aufrufer
 *        ihn kennt; `boerse` wie bei `aktienKontext`
 * @returns {Promise<{klasse: 'krypto'|'aktien', gemischt: boolean, aktien: string[]}>}
 */
export async function anlageklasseVon(symbole = [], { market, boerse } = {}) {
    const aktien = []
    const moeglich = !istSpot(market) && await aktienModusAn()
    for (const s of moeglich ? symbole : []) {
        let zeile = null
        try { zeile = await stammZeile(String(s).toUpperCase(), { market, boerse: woVon(boerse) }) } catch { zeile = null }
        if (zeile) aktien.push(String(s).toUpperCase())
    }
    const gemischt = aktien.length > 0 && aktien.length < symbole.length
    return { klasse: aktien.length && !gemischt ? 'aktien' : 'krypto', gemischt, aktien }
}

async function baue(symbol, wo) {
    const knex = getKnex()
    const zeile = await stammZeile(symbol, wo)
    if (!zeile) return null
    const gemerkt = (await knex.schema.hasTable('newcomer_titel'))
        ? await knex('newcomer_titel').where('instrumentId', zeile.id).first('kursSymbol') : null
    // `null` = kein Kurssymbol (Lauf fand nichts, fremde Region) — Splits und Termine bleiben dann unbekannt.
    // `stammZeile` findet nur Futures der Krypto-Börsen: deren Ticker ist massgebend (RAS-01).
    const kursSymbol = kursSymbolFuer(zeile, gemerkt || null, { perp: true })
    const [{ splits, grund }, zahlen] = await Promise.all([ladeSplits(kursSymbol), ladeTermine(kursSymbol)])
    return {
        ticker: zeile.ticker, name: zeile.name || null, unterart: zeile.unterart,
        boerse: zeile.boerse, kursSymbol,
        // null = unbekannt (Quelle aus oder Abruf gescheitert) — NICHT «keine Splits»
        splits, splitsGrund: grund,
        // Zahlentermine (`{naechster, vergangene}`), ebenfalls null = unbekannt
        termine: zahlen.termine, termineGrund: zahlen.grund,
    }
}

/**
 * @param {string} symbol  wie die Marktdatenquelle es nennt (`NVDAUSDT`)
 * @param {{splitsFrisch?: boolean, market?: 'spot'|'futures', boerse?: string, trotzModusAus?: boolean}} [opt]
 *        `market`: `spot` ist nie ein Aktien-Future (BUG-K-001). `boerse`: die Börse, von der die
 *        Kerzen kommen, wenn es NICHT die Marktdatenquelle ist (Chart mit eigener Quelle), oder
 *        `jede`, wenn der Aufrufer die Börse des Symbols nicht kennt.
 *        `splitsFrisch`: die Splits NICHT aus dem Speicher nehmen.
 *        Dort gilt auch eine leere Liste zwölf Stunden als bekannt — ein Split von heute fehlt
 *        dann so lange (Audit 15.11.2026, FUN-F-006). Für den Papierbetrieb, wenn in den Kerzen
 *        ein Sprung steht, den die bekannten Splits nicht erklären; höchstens alle zehn Minuten
 *        je Symbol, dazwischen gilt der Speicher.
 *        `trotzModusAus`: den Schalter «Aktien-Modus» übergehen. NUR für die Strategie-Engine und
 *        nur für Instanzen, die als Aktien-Instanz angelegt wurden (`anlageklasse = 'aktien'`):
 *        ihre OFFENEN Positionen müssen auch bei ausgeschaltetem Modus als Aktien-Future gepflegt
 *        werden — sonst bucht der Papierbetrieb einen Split als Kurssturz (Review 15.11.2026,
 *        RAS-03). Neue Einstiege eröffnet die Engine in dieser Zeit nicht. Dafür gehen die Abrufe
 *        für Splits und Termine dieses einen Titels weiter hinaus. Alle anderen Aufrufer
 *        (Backtest, Radar, Chart) lassen die Option weg: dort heisst «Modus aus» Krypto.
 * @returns {Promise<null | {ticker, name, unterart, boerse, kursSymbol, splits: object[]|null, splitsGrund: string|null,
 *           termine: {naechster, vergangene}|null, termineGrund: string|null}>}
 */
export async function aktienKontext(symbol, { splitsFrisch = false, market, boerse, trotzModusAus = false } = {}) {
    const sym = String(symbol || '').toUpperCase()
    if (istSpot(market)) return null
    // Der Speicher darunter ist für beide Wege derselbe: er hält nur, was der Stamm sagt, und
    // `vergissModus()` leert ihn beim Umschalten.
    if (trotzModusAus !== true && !(await aktienModusAn())) return null
    // Der Schlüssel trägt die Börse: «kein Titel» an der einen darf die Antwort für die andere nicht stellen.
    // Der Markt braucht keinen Platz darin — Spot kommt gar nicht bis zum Speicher.
    const wo = woVon(boerse)
    const schluessel = `${wo}|${sym}`
    const c = kontextCache.get(schluessel)
    const frisch = splitsFrisch && !(Date.now() - (frischGeholt.get(sym) || 0) < FRISCH_MS)
    if (c && !frisch && Date.now() - c.zeit < (c.wert ? KONTEXT_MS : KEIN_TITEL_MS)) return c.wert
    if (frisch) {
        frischGeholt.set(sym, Date.now())
        if (c?.wert?.kursSymbol) splitsCache.delete(c.wert.kursSymbol)
    }
    let wert
    // Ein gescheiterter Aufbau (Datenbank gerade nicht da) wird nicht gemerkt — nächste Frage, neuer Versuch.
    try { wert = await baue(sym, { market, boerse: wo }) } catch { return null }
    kontextCache.set(schluessel, { zeit: Date.now(), wert })
    return wert
}

/** Nur für Selbsttests. */
export function leereKontextCache() { kontextCache.clear(); splitsCache.clear(); frischGeholt.clear(); modusGemerkt = { an: undefined, ts: 0 } }
