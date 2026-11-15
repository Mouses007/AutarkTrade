/**
 * Lauf des Newcomer-Radars: für jeden Aktien-Titel des Stamms Kurse holen,
 * Kennzahlen rechnen, bewerten, speichern (`newcomer_titel`).
 *
 * Reihenfolge: zuerst, was an einer Krypto-Börse handelbar ist (dort wird
 * gehandelt), dann die Titel, die nur Bitpanda führt. Ein Titel, dessen Stand
 * jünger als `FRISCH_MS` ist, wird übersprungen — ein abgebrochener Lauf setzt
 * beim nächsten Start dort fort, wo er aufgehört hat.
 *
 * ETFs erkennt erst die Kursquelle; sie werden im Stamm als ETF markiert und
 * fallen aus dem Radar (der nächste Lauf fragt sie nicht mehr ab).
 *
 * Bremst die Kursquelle (HTTP 429) oder scheitern `ABBRUCH_NACH` Abrufe in
 * Folge, hört der Lauf auf, statt weiterzufragen.
 */
import { getKnex } from '../database.js'
import { beansprucheAufgabe } from '../db-claim.js'
import { quelleErlaubt } from '../quellen/freigabe.js'
import { leseStamm, suchForm } from '../aktien/stamm-speicher.js'
import { kennzahlen, rendite } from './kennzahlen.js'
import { bewerte } from './bewertung.js'
import { wechselkursSymbol, ausWechselkurs } from './waehrung.js'
import { kursSymbolKandidaten, kursSymbolFuer, passtZurRegion, nameAehnlich, boersengangDatum } from './kursquelle-kern.js'
import { holeChart, sucheSymbol, NichtGefunden, Gebremst } from './kursquelle.js'

const FRISCH_MS = 20 * 3600e3
const PARALLEL = 3
const PAUSE_MS = 150
const ABBRUCH_NACH = 8
const REFERENZ = 'SPY'
const UNTERARTEN = ['aktie', 'vorboerslich']
const WERTPAPIER_TYPEN = new Set(['EQUITY', 'ETF'])

const warte = (ms) => new Promise((r) => setTimeout(r, ms))

let stand = { laeuft: false }
let startet = null                     // Versprechen eines Laufs, der gerade anläuft
export const laufStand = () => stand

/**
 * Kurse eines Titels finden. Zuordnung, in dieser Reihenfolge:
 *   gespeichert  das Symbol des letzten Laufs — ein ungeprüftes (`ticker`) nur, solange der
 *                inzwischen bekannte Name nicht widerspricht und die Region es zulässt
 *   ticker       der Stamm kennt keinen Namen (Titel nur an Krypto-Börsen): der Ticker gilt ungeprüft
 *   name         Ticker passt und der Name widerspricht nicht (`nameAehnlich`) — auch an Krypto-Börsen
 *
 * Titel mit fremder Region (Binance `HK_EQUITY`) haben keinen Ticker-Kandidaten:
 * `BYD` wäre Boyd Gaming. Für sie bleibt die Namenssuche oder «kein Treffer».
 *   suche        über den Firmennamen gefunden, Listung mit demselben Ticker (Heimatbörse)
 *   sucheFremd   über den Namen gefunden, aber eine Zweitlistung: Kurse gelten,
 *                das Datum des ersten Handels ist nicht der Börsengang
 *
 * @param {{holeChart: Function, sucheSymbol: Function}} [quelle]  nur der Selbsttest reicht eine Attrappe herein
 */
export async function findeKurse(titel, gespeichert, jetzt, quelle = { holeChart, sucheSymbol }) {
    const { holeChart, sucheSymbol } = quelle
    if (gespeichert?.kursSymbol && kursSymbolFuer(titel, gespeichert)) {
        try {
            const chart = await holeChart(gespeichert.kursSymbol, jetzt)
            const zuordnung = gespeichert.zuordnung || 'ticker'
            if (zuordnung !== 'ticker' || !titel.name || nameAehnlich(titel.name, chart.meta.name, titel.ticker)) return { chart, zuordnung }
        } catch (e) {
            if (!(e instanceof NichtGefunden)) throw e
        }
    }
    for (const symbol of kursSymbolKandidaten(titel.ticker, titel.region)) {
        let chart
        try { chart = await holeChart(symbol, jetzt) } catch (e) {
            if (e instanceof NichtGefunden) continue
            throw e
        }
        if (!WERTPAPIER_TYPEN.has(chart.meta.typ)) continue
        if (!titel.name) return { chart, zuordnung: 'ticker' }
        if (nameAehnlich(titel.name, chart.meta.name, titel.ticker)) return { chart, zuordnung: 'name' }
    }
    if (titel.name) {
        const treffer = await sucheSymbol(titel.name, titel.ticker)
        // Auch die Namenssuche darf einem Titel aus Hongkong keine US-Listung unterschieben.
        if (treffer && passtZurRegion(treffer.symbol, titel.region)) {
            try {
                const chart = await holeChart(treffer.symbol, jetzt)
                if (WERTPAPIER_TYPEN.has(chart.meta.typ)) return { chart, zuordnung: treffer.heimat ? 'suche' : 'sucheFremd' }
            } catch (e) {
                if (!(e instanceof NichtGefunden)) throw e
            }
        }
    }
    return null
}

/** Name der Kursquelle für den Stamm — samt Suchform, sonst fände die Namenssuche ihn erst nach dem nächsten Abgleich. */
const mitSuchName = (name) => { const kurz = String(name).slice(0, 120); return { name: kurz, suchName: suchForm(kurz) } }

async function speichere(knex, instrumentId, zeile) {
    const da = await knex('newcomer_titel').where('instrumentId', instrumentId).first('id')
    if (da) await knex('newcomer_titel').where('id', da.id).update(zeile)
    else await knex('newcomer_titel').insert({ instrumentId, ...zeile })
}

/**
 * Wechselkurs der Kurswährung gegen den Dollar: `{kurs, perf3m}` oder `null`.
 * Je Währung EIN Abruf im Lauf (`merk` hält das Versprechen, auch für die
 * parallelen Arbeiter). US-Dollar braucht keinen. Kennt die Quelle das Paar
 * nicht, gilt das für den ganzen Lauf; ein Netzfehler wird beim nächsten Titel
 * neu versucht. `Gebremst` geht nach oben und beendet den Lauf.
 */
function holeWechselkurs(waehrung, merk, jetzt) {
    const symbol = wechselkursSymbol(waehrung)
    if (!symbol) return Promise.resolve(null)
    if (!merk.has(symbol)) {
        merk.set(symbol, holeChart(symbol, jetzt).then((c) => ausWechselkurs(c.kerzen), (e) => {
            if (e instanceof NichtGefunden) return null
            merk.delete(symbol)
            if (e instanceof Gebremst) throw e
            return null
        }))
    }
    return merk.get(symbol)
}

async function bearbeite(knex, titel, gespeichert, referenz, jetzt, wechselkurse = new Map()) {
    const kopf = { stand: jetzt }
    if (titel.unterart === 'vorboerslich') {
        const b = bewerte({ tage: 0, alterTage: null }, { unterart: titel.unterart, listungen: titel.listungen, jetzt })
        await speichere(knex, titel.id, { ...kopf, kursSymbol: null, zuordnung: null, kategorie: b.kategorie, note: null,
            noten: JSON.stringify(b.noten), kennzahlen: JSON.stringify({ listungVorTagen: b.listungVorTagen }), huerden: '[]', grund: 'vorboerslich' })
        return 'ohneKurse'
    }
    const treffer = await findeKurse(titel, gespeichert, jetzt)
    if (!treffer) {
        const b = bewerte({ tage: 0, alterTage: null }, { unterart: titel.unterart, listungen: titel.listungen, jetzt })
        await speichere(knex, titel.id, { ...kopf, kursSymbol: null, zuordnung: null, kategorie: b.kategorie, note: null,
            noten: JSON.stringify(b.noten), kennzahlen: JSON.stringify({ listungVorTagen: b.listungVorTagen }), huerden: '[]', grund: 'keinTreffer' })
        return 'ohneKurse'
    }
    const { chart, zuordnung } = treffer
    // Ein ETF ist keine Firma. Die Krypto-Börsen kennzeichnen ETFs nicht, die
    // Kursquelle schon: der Stamm lernt es hier, und der Radar führt den Titel nicht.
    if (chart.meta.typ === 'ETF') {
        await knex('instrumente').where('id', titel.id).update({
            unterart: 'etf', stand: jetzt, heimatboerse: chart.meta.boerse, waehrung: chart.meta.waehrung,
            ...(!titel.name && chart.meta.name ? mitSuchName(chart.meta.name) : {}),
        })
        await knex('newcomer_titel').where('instrumentId', titel.id).del()
        return 'ohneKurse'
    }
    // Bei einer Zweitlistung ist das Datum des ersten Handels nicht der Börsengang der Firma.
    const ipoDatum = boersengangDatum(zuordnung, chart.meta.ipoDatum)
    // Hürden und Stärke gegen den Index gelten in US-Dollar; die Kerzen stehen in der Währung der Börse.
    const waehrung = chart.meta.waehrung
    const fx = await holeWechselkurs(waehrung, wechselkurse, jetzt)
    const waehrungPerf3m = wechselkursSymbol(waehrung) ? fx?.perf3m ?? null : waehrung === 'USD' ? 0 : null
    const k = kennzahlen(chart.kerzen, { jetzt, ipoDatum, referenz, waehrungPerf3m })
    const b = bewerte(k, { unterart: titel.unterart, listungen: titel.listungen, jetzt, waehrung, usdKurs: fx?.kurs ?? null })
    await speichere(knex, titel.id, {
        ...kopf, kursSymbol: chart.meta.symbol, zuordnung, kategorie: b.kategorie, note: b.note,
        noten: JSON.stringify(b.noten),
        kennzahlen: JSON.stringify({ ...k, listungVorTagen: b.listungVorTagen, waehrung, boerse: chart.meta.boerse,
            kursUsd: b.kursUsd, umsatz20Usd: b.umsatz20Usd, momentumTeile: b.momentumTeile, gedeckelt: b.gedeckelt }),
        huerden: JSON.stringify(b.huerden), grund: null,
    })
    // Was die Kursquelle über die Firma weiss, gehört in den Stamm.
    const ergaenzt = { ipoDatum, heimatboerse: zuordnung === 'sucheFremd' ? null : chart.meta.boerse, waehrung: chart.meta.waehrung, stand: jetzt }
    if (!titel.name && chart.meta.name) Object.assign(ergaenzt, mitSuchName(chart.meta.name))
    await knex('instrumente').where('id', titel.id).update(ergaenzt)
    return 'bewertet'
}

/**
 * Lauf starten. Kehrt sofort zurück; den Fortschritt liefert `laufStand()`.
 * @param {{grenze?: number, alle?: boolean}} [opt]  `grenze` = höchstens so viele Titel, `alle` = auch frische neu rechnen
 * @returns {Promise<object>} der Stand beim Start (oder der des schon laufenden Laufs)
 */
export async function starteLauf(opt = {}) {
    if (stand.laeuft) return stand
    // `stand.laeuft` steht erst nach zwei Datenbank-Abfragen. Bis dahin hält dieses
    // Versprechen die Sperre: ein zweiter Aufruf (Doppelklick, zweiter Tab, Takt)
    // bekommt denselben Lauf, statt daneben einen zweiten zu starten, der die
    // Kursquelle doppelt so schnell fragt (Audit SEC-S-003).
    startet ||= beginneLauf(opt).finally(() => { startet = null })
    return startet
}

const abgleichEcht = async () => (await import('../aktien/stamm.js')).gleicheAb()
let abgleich = abgleichEcht
/** Nur für Selbsttests: den Stamm-Abgleich stellen (`null` = wieder der echte). */
export function _setzeAbgleich(fn) { abgleich = typeof fn === 'function' ? fn : abgleichEcht }

async function beginneLauf(opt) {
    const knex = getKnex()
    const jetzt = Date.now()
    const gespeichert = new Map((await knex('newcomer_titel').select('instrumentId', 'kursSymbol', 'zuordnung', 'stand')).map((z) => [z.instrumentId, z]))
    let stamm = await leseStamm(knex, { anlageklasse: 'aktien', grenze: 5000 })
    if (!stamm.length) {
        // Leerer Stamm (Aktien-Modus eben erst eingeschaltet, der Takt lief noch nicht): erst abgleichen.
        // Bleibt er leer, sagt der Lauf das, statt «0 bewertet» zu melden.
        try { await abgleich() } catch { /* bleibt leer */ }
        stamm = await leseStamm(knex, { anlageklasse: 'aktien', grenze: 5000 })
        if (!stamm.length) {
            stand = { laeuft: false, beginn: jetzt, gesamt: 0, fertig: 0, bewertet: 0, ohneKurse: 0, fehler: 0, abbruch: 'stammLeer', ende: Date.now() }
            return stand
        }
    }
    let titel = stamm
        .filter((t) => UNTERARTEN.includes(t.unterart || 'aktie'))
        .filter((t) => opt.alle || !(Number(gespeichert.get(t.id)?.stand) > jetzt - FRISCH_MS))
    const rang = (t) => (t.unterart === 'vorboerslich' ? 0 : t.listungen.some((l) => l.handelsplatz !== 'bitpanda') ? 1 : 2)
    titel.sort((a, b) => rang(a) - rang(b) || a.ticker.localeCompare(b.ticker))
    const grenze = Number(opt.grenze)
    if (grenze > 0) titel = titel.slice(0, grenze)

    stand = { laeuft: true, beginn: jetzt, gesamt: titel.length, fertig: 0, bewertet: 0, ohneKurse: 0, fehler: 0, abbruch: null, ende: null }
    const meiner = stand

    ;(async () => {
        let referenz = null
        try {
            const spy = await holeChart(REFERENZ, jetzt)
            referenz = { perf3m: rendite(spy.kerzen, 63) }
        } catch (e) {
            if (e instanceof Gebremst) meiner.abbruch = 'gebremst'
        }
        const wechselkurse = new Map()
        let naechster = 0, inFolge = 0
        const arbeiter = async () => {
            while (!meiner.abbruch) {
                const t = titel[naechster++]
                if (!t) return
                try {
                    const art = await bearbeite(knex, t, gespeichert.get(t.id), referenz, jetzt, wechselkurse)
                    meiner[art]++
                    inFolge = 0
                } catch (e) {
                    meiner.fehler++
                    inFolge++
                    if (e instanceof Gebremst) meiner.abbruch = 'gebremst'
                    else if (inFolge >= ABBRUCH_NACH) meiner.abbruch = 'fehlerInFolge'
                    meiner.letzterFehler = String(e?.message || e).slice(0, 200)
                }
                meiner.fertig++
                await warte(PAUSE_MS)
            }
        }
        await Promise.all(Array.from({ length: PARALLEL }, arbeiter))
    })().catch((e) => { meiner.abbruch = 'fehler'; meiner.letzterFehler = String(e?.message || e).slice(0, 200) })
        .finally(() => {
            meiner.laeuft = false
            meiner.ende = Date.now()
            console.log(` -> Newcomer-Radar: ${meiner.bewertet} bewertet, ${meiner.ohneKurse} ohne Kurse, ${meiner.fehler} Fehler`
                + (meiner.abbruch ? `, abgebrochen (${meiner.abbruch})` : ''))
            // «Newcomer mit hoher Note» (nur wenn eingeschaltet, je Titel einmal in 30 Tagen).
            if (meiner.bewertet > 0) {
                import('../aktien/meldungen.js').then((m) => m.meldeNewcomer(meiner.beginn)).catch(() => {})
            }
        })
    return stand
}

/* ── Lesen ── */

const json = (text, sonst) => { try { return JSON.parse(text) ?? sonst } catch { return sonst } }

/**
 * Nur Titel, die noch mindestens ein Handelsplatz führt. Der Lauf rechnet nur
 * solche neu (`leseStamm`); ein abgelisteter Titel behielte sonst seine letzte
 * Note für immer und stünde damit oben in Rangliste, Zähler und KI-Werkzeug
 * (Audit DB-D-002). Die Zeile selbst bleibt — kommt die Listung wieder, gilt
 * sie nach dem nächsten Lauf weiter.
 */
const mitAktiverListung = (knex, q, spalte) => q.whereIn(spalte, knex('instrument_listungen').where('aktiv', 1).select('instrumentId'))

/**
 * Titel mit Stand, Stammdaten und Listungen, beste Note zuerst.
 * @param {{kategorie?: string, mitHuerden?: boolean, grenze?: number}} filter
 */
export async function leseTitel(knex, filter = {}) {
    let q = mitAktiverListung(knex, knex('newcomer_titel as n').join('instrumente as i', 'i.id', 'n.instrumentId'), 'n.instrumentId')
        .select('n.*', 'i.ticker', 'i.name', 'i.unterart', 'i.region', 'i.ipoDatum', 'i.heimatboerse')
    if (filter.kategorie) q = q.where('n.kategorie', filter.kategorie)
    // Vorbörsliche Firmen haben keine Kurse und damit keine Note — sie stehen trotzdem in ihrer Liste.
    if (!filter.mitHuerden && filter.kategorie !== 'vorboerslich') q = q.whereNotNull('n.note').where('n.huerden', '[]')
    const zeilen = await q.orderByRaw('n.note is null').orderBy('n.note', 'desc').orderBy('i.ticker')
        .limit(Math.min(Math.max(Number(filter.grenze) || 100, 1), 1000))
    if (!zeilen.length) return []
    const listungen = await knex('instrument_listungen').whereIn('instrumentId', zeilen.map((z) => z.instrumentId)).where('aktiv', 1)
    const je = new Map()
    for (const l of listungen) {
        if (!je.has(l.instrumentId)) je.set(l.instrumentId, [])
        je.get(l.instrumentId).push({ handelsplatz: l.handelsplatz, symbol: l.symbol, art: l.art, maxHebel: l.maxHebel, sicher: !!l.sicher, gelistetSeit: Number(l.gelistetSeit) || null })
    }
    return zeilen.map((z) => ({
        id: z.instrumentId, ticker: z.ticker, name: z.name, unterart: z.unterart, region: z.region,
        ipoDatum: Number(z.ipoDatum) || null, heimatboerse: z.heimatboerse,
        kursSymbol: z.kursSymbol, zuordnung: z.zuordnung, kategorie: z.kategorie, note: z.note,
        noten: json(z.noten, {}), kennzahlen: json(z.kennzahlen, {}), huerden: json(z.huerden, []), grund: z.grund,
        stand: Number(z.stand) || null, listungen: je.get(z.instrumentId) || [],
    }))
}

/** Wie viele Titel je Kategorie, und wie viele davon in der Rangliste stehen. */
export async function zaehleTitel(knex) {
    const zeilen = await mitAktiverListung(knex, knex('newcomer_titel'), 'instrumentId').select('kategorie', 'note', 'huerden', 'grund')
    const je = {}
    for (const z of zeilen) {
        const k = (je[z.kategorie || 'unbekannt'] ||= { gesamt: 0, zugelassen: 0, ohneKurse: 0 })
        k.gesamt++
        if (z.note != null && z.huerden === '[]') k.zugelassen++
        if (z.grund) k.ohneKurse++
    }
    return je
}

/* ── Takt ── */

let taktId = null
/** Einmal am Tag, nur mit Aktien-Modus und freigegebener Kursquelle, nur ein Prozess je Datenbank. */
export function starteNewcomerTakt() {
    if (taktId) return
    const tick = async () => {
        try {
            const knex = getKnex()
            if (!(await knex.schema.hasTable('newcomer_titel'))) return
            const s = await knex('settings').select('modusAktienAn').where('id', 1).first()
            if (Number(s?.modusAktienAn ?? 0) !== 1) return
            if (!(await quelleErlaubt('yahoo'))) return
            if (!(await knex('instrument_listungen').first('id'))) return
            if (!(await beansprucheAufgabe('newcomer_radar', 22 * 3600e3))) return
            await starteLauf()
        } catch (e) {
            console.warn(' -> Newcomer-Takt:', e.message)
        }
    }
    setTimeout(tick, 10 * 60e3)
    taktId = setInterval(tick, 60 * 60e3)
}
