/**
 * EDGAR (SEC): Netz-Teil. Lesen und Ordnen steht in `edgar-kern.js`.
 *
 * Die SEC verlangt von Programmen einen User-Agent mit Kontaktangabe
 * (https://www.sec.gov/os/accessing-edgar-data) und erlaubt höchstens zehn
 * Abrufe je Sekunde; wer das missachtet, wird für zehn Minuten gesperrt.
 *
 *   Ausweis   Der User-Agent kommt AUSSCHLIESSLICH aus `settings.edgarKontakt`,
 *             das der Nutzer selbst einträgt (Einstellungen › Datenquellen).
 *             Kein Eintrag → `QuelleAus('kontaktFehlt')`, kein Abruf. Es gibt
 *             keinen Rückfall auf einen erfundenen oder neutralen Absender.
 *   Bremse    Alle Abrufe laufen durch EINE Kette mit mindestens 260 ms
 *             Abstand (unter vier je Sekunde). Nach 403/429 ruht EDGAR zehn
 *             Minuten — weiterfragen verlängert die Sperre der SEC.
 *   Speicher  Ticker-Liste 24 h, Einreichungen 6 h, Fund im Prospekt 30 Tage
 *             (ein Prospekt ändert sich nicht). Nur im Arbeitsspeicher.
 *
 * Abgerufen wird nur von `www.sec.gov` und `data.sec.gov` — auch eine
 * Weiterleitung führt nirgends sonst hin (`pruefeWeiterleitung`). In der Anfrage
 * stehen der Ticker bzw. die CIK und die Kontaktangabe, sonst nichts.
 */
import axios from 'axios'
import { getKnex } from '../database.js'
import { QuelleAus } from '../quellen/aus.js'
import { logWarn } from '../logger.js'
import { usTicker, tickerVerzeichnis, zusatzDateien, werteAus, textAusHtml, leseHaltefrist, userAgentAus, pruefeKontakt, PROSPEKT_HOECHSTENS } from './edgar-kern.js'

const NAME = 'SEC EDGAR'
const TAG = 86_400_000
const ABSTAND_MS = 260
const PAUSE_NACH_ABLEHNUNG_MS = 10 * 60_000
const VERZEICHNIS_MS = 24 * 60 * 60_000
const EINREICHUNGEN_MS = 6 * 60 * 60_000
const PROSPEKT_MS = 30 * TAG
/** Nur für Firmen, deren Börsengang höchstens so lange zurückliegt, wird der Prospekt gelesen. */
const PROSPEKT_LESEN_BIS_TAGE = 800
const CACHE_GRENZE = 300

export class EdgarAbgelehnt extends Error {}
export class EdgarGebremst extends Error {}
class NichtDa extends Error {}

let kette = Promise.resolve()
let letzterAbruf = 0
let ruhtBis = 0
let verzeichnis = null                 // { zeit, karte }
let verzeichnisLaeuft = null
const einreichungen = new Map()        // cik → { zeit, wert }
const laufend = new Map()              // cik → Promise
const prospektFunde = new Map()        // zugang → { zeit, fund }  (fund kann null sein: gelesen, nichts Eindeutiges)

const warte = (ms) => new Promise((r) => setTimeout(r, ms))

/** Kontaktangabe aus den Einstellungen (leer = EDGAR aus). */
export async function leseKontakt() {
    const z = await getKnex()('settings').select('edgarKontakt').where('id', 1).first()
    return String(z?.edgarKontakt || '').trim()
}

/** Für die Einstellungsseite. Die Angabe ist die eigene des Nutzers — sie wird offen gezeigt, damit er sieht, was hinausgeht. */
export async function kontaktStand() {
    const kontakt = await leseKontakt()
    return { hinterlegt: Boolean(userAgentAus(kontakt)), kontakt, userAgent: userAgentAus(kontakt) }
}

/** Speichert die Kontaktangabe; leer löscht sie. Wirft bei ungültiger Angabe einen Fehler mit `grund`. */
export async function setzeKontakt(text) {
    let wert = ''
    if (String(text ?? '').trim()) {
        const p = pruefeKontakt(text)
        if (!p.ok || !userAgentAus(p.wert)) throw Object.assign(new Error('Kontaktangabe ungültig'), { grund: p.ok ? 'zeichen' : p.grund })
        wert = p.wert
    }
    await getKnex()('settings').where('id', 1).update({ edgarKontakt: wert })
    // Ein neuer Absender ist ein neuer Anlauf.
    ruhtBis = 0
    return kontaktStand()
}

async function userAgent() {
    const ua = userAgentAus(await leseKontakt())
    if (!ua) throw new QuelleAus(NAME, 'kontaktFehlt')
    return ua
}

/** Ein Abruf nach dem anderen, mit Mindestabstand. */
function gebremst(fn) {
    const dran = kette.then(async () => {
        const rest = letzterAbruf + ABSTAND_MS - Date.now()
        if (rest > 0) await warte(rest)
        letzterAbruf = Date.now()
    })
    kette = dran.catch(() => { })
    return dran.then(fn)
}

/**
 * Weiterleitungen nur innerhalb von sec.gov. Die erste Adresse zu prüfen reicht
 * nicht: der Abruf folgt bis zu zwei Weiterleitungen, und der User-Agent mit der
 * Kontaktangabe des Nutzers ginge sonst an den fremden Host (Audit SEC-S-007).
 * Wirft — der Abruf bricht dann ab, BEVOR die nächste Anfrage hinausgeht.
 * @param {{protocol?: string, hostname?: string}} ziel  Ziel der Weiterleitung (axios `beforeRedirect`)
 */
export function pruefeWeiterleitung(ziel) {
    if (ziel?.protocol !== 'https:' || !/^(www|data)\.sec\.gov$/.test(String(ziel?.hostname || ''))) {
        throw new Error('EDGAR: Weiterleitung auf eine fremde Adresse')
    }
}

async function hole(url, ua, { text = false, timeout = 20000 } = {}) {
    if (!/^https:\/\/(www|data)\.sec\.gov\//.test(url)) throw new Error('EDGAR: fremde Adresse')
    if (Date.now() < ruhtBis) throw new EdgarGebremst('EDGAR ruht nach einer Ablehnung der SEC')
    const r = await gebremst(() => axios.get(url, {
        headers: { 'User-Agent': ua, 'Accept-Encoding': 'gzip, deflate', Accept: text ? 'text/html' : 'application/json' },
        timeout, responseType: text ? 'text' : 'json', transformResponse: text ? [(d) => d] : undefined,
        maxContentLength: text ? PROSPEKT_HOECHSTENS : 20 * 1024 * 1024, maxRedirects: 2, beforeRedirect: pruefeWeiterleitung,
        validateStatus: () => true,
    }))
    if (r.status === 404) throw new NichtDa(url)
    if (r.status === 403 || r.status === 429) {
        ruhtBis = Date.now() + PAUSE_NACH_ABLEHNUNG_MS
        if (r.status === 429) throw new EdgarGebremst('SEC: zu viele Abrufe (429)')
        throw new EdgarAbgelehnt('Die SEC hat den Abruf abgelehnt (403) — Kontaktangabe unter Einstellungen › Datenquellen prüfen')
    }
    if (r.status !== 200) throw new Error(`SEC: HTTP ${r.status}`)
    // Statt JSON kommt bei einer Ablehnung manchmal eine HTML-Seite mit Status 200.
    if (!text && (r.data == null || typeof r.data !== 'object')) throw new Error('SEC: Antwort ist kein JSON')
    return r.data
}

async function ladeVerzeichnis(ua) {
    if (verzeichnis && Date.now() - verzeichnis.zeit < VERZEICHNIS_MS) return verzeichnis.karte
    verzeichnisLaeuft ||= (async () => {
        try {
            const karte = tickerVerzeichnis(await hole('https://www.sec.gov/files/company_tickers.json', ua, { timeout: 30000 }))
            verzeichnis = { zeit: Date.now(), karte }
            return karte
        } catch (e) {
            // Eine alte Liste ist besser als keine — CIK ändern sich nicht.
            if (verzeichnis) { logWarn('aktien', `EDGAR Ticker-Liste: ${e.message} — alte Liste bleibt`); return verzeichnis.karte }
            throw e
        } finally { verzeichnisLaeuft = null }
    })()
    return verzeichnisLaeuft
}

function merke(karte, schluessel, wert) {
    if (karte.size >= CACHE_GRENZE) karte.delete(karte.keys().next().value)
    karte.set(schluessel, wert)
}

/** Haltefrist aus dem Börsenprospekt; `{gelesen:false}` wenn der Abruf scheitert — das ist kein Fehler der Karte. */
async function leseProspekt(prospekt, ua) {
    const c = prospektFunde.get(prospekt.zugang)
    if (c && Date.now() - c.zeit < PROSPEKT_MS) return { gelesen: true, fund: c.fund }
    try {
        const fund = leseHaltefrist(textAusHtml(await hole(prospekt.link, ua, { text: true, timeout: 45000 })))
        merke(prospektFunde, prospekt.zugang, { zeit: Date.now(), fund })
        return { gelesen: true, fund }
    } catch (e) {
        logWarn('aktien', `EDGAR Prospekt ${prospekt.zugang}: ${e.message}`)
        return { gelesen: false, fund: null }
    }
}

async function baue(eintrag, ua) {
    const jetzt = Date.now()
    let roh
    try {
        roh = await hole(`https://data.sec.gov/submissions/CIK${eintrag.cik}.json`, ua)
    } catch (e) {
        if (e instanceof NichtDa) return { ok: true, gefuehrt: false, grund: 'ohneEinreichungen' }
        throw e
    }
    // Ältere Seiten nur, wenn sie ins Fenster reichen (junge Firma mit vielen Insider-Meldungen).
    const zusatz = []
    for (const name of zusatzDateien(roh, jetzt)) {
        try { zusatz.push(await hole(`https://data.sec.gov/submissions/${name}`, ua)) } catch (e) {
            if (e instanceof EdgarAbgelehnt || e instanceof EdgarGebremst) throw e
            logWarn('aktien', `EDGAR ${name}: ${e.message}`)
            break   // Reihenfolge zählt: ohne diese Seite hilft die nächstältere nicht.
        }
    }
    const wert = werteAus(roh, zusatz, jetzt)
    let haltefrist = null
    if (wert.prospekt?.link && jetzt - wert.prospekt.zeit < PROSPEKT_LESEN_BIS_TAGE * TAG) {
        const { gelesen, fund } = await leseProspekt(wert.prospekt, ua)
        haltefrist = {
            gelesen,
            fund: fund && fund.tage != null ? { tage: fund.tage, stelle: fund.stelle, ausnahmen: fund.ausnahmen, treffer: fund.treffer } : null,
            mehrdeutig: fund?.mehrdeutig ? { werte: fund.werte, stelle: fund.stelle } : null,
        }
    }
    const { zugang, ...prospekt } = wert.prospekt || {}
    return { ok: true, gefuehrt: true, ...wert, prospekt: wert.prospekt ? prospekt : null, haltefrist, stand: jetzt }
}

/**
 * Einreichungen zu einem Kurssymbol bzw. Ticker.
 * @returns {Promise<object>} `{ok, gefuehrt:false, grund}` für Titel, die die SEC nicht führt
 *          (`keinUsTicker` | `nichtInListe` | `ohneEinreichungen`), sonst das Ergebnis von `werteAus`
 *          samt `haltefrist` und `stand`.
 * @throws QuelleAus (Kontaktangabe fehlt), EdgarAbgelehnt, EdgarGebremst
 */
export async function holeEinreichungen(symbol, { neu = false } = {}) {
    const ua = await userAgent()
    const t = usTicker(symbol)
    if (!t) return { ok: true, gefuehrt: false, grund: 'keinUsTicker' }
    const eintrag = (await ladeVerzeichnis(ua)).get(t)
    if (!eintrag) return { ok: true, gefuehrt: false, grund: 'nichtInListe' }
    const c = einreichungen.get(eintrag.cik)
    if (c && !neu && Date.now() - c.zeit < EINREICHUNGEN_MS) return c.wert
    // Gleichzeitige Aufrufe teilen sich einen Abruf.
    let lauf = laufend.get(eintrag.cik)
    if (!lauf) {
        lauf = baue(eintrag, ua).finally(() => laufend.delete(eintrag.cik))
        laufend.set(eintrag.cik, lauf)
    }
    const wert = await lauf
    if (wert.gefuehrt) merke(einreichungen, eintrag.cik, { zeit: Date.now(), wert })
    return wert
}

/** Prüft die hinterlegte (oder eine übergebene) Kontaktangabe mit einem kleinen Abruf. */
export async function pruefeZugang(kontakt) {
    const ua = kontakt === undefined ? await userAgent() : userAgentAus(kontakt)
    if (!ua) return { ok: false, grund: 'ungueltig' }
    try {
        // Die Ticker-Liste: liegt auf www.sec.gov, wo die SEC am strengsten prüft, und wird ohnehin gebraucht.
        const karte = tickerVerzeichnis(await hole('https://www.sec.gov/files/company_tickers.json', ua, { timeout: 30000 }))
        verzeichnis = { zeit: Date.now(), karte }
        return { ok: true, titel: karte.size }
    } catch (e) {
        return { ok: false, grund: e instanceof EdgarAbgelehnt ? 'abgelehnt' : e instanceof EdgarGebremst ? 'gebremst' : 'fehler', fehler: e.message }
    }
}
