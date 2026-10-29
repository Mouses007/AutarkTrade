/**
 * Wirtschaftskalender.
 *
 * Quellen seit S12 (Verkaufs-Prüfung Z. 40/47/48): nur amtliche Kalender, deren
 * Bedingungen die Weiterverwendung erlauben — Federal Reserve (FOMC, Beige
 * Book), U.S. Bureau of Economic Analysis (BIP, PCE, Handelsbilanz) und
 * Eurostat (Euro-Indikatoren). Fundstellen, Abrufdatum und was geprüft und
 * verworfen wurde (BLS, EZB) stehen in `kalender-quellen.js`.
 *
 * Bis S12 kam der Nahbereich aus dem Wochen-Feed von ForexFactory
 * (`nfs.faireconomy.media`). Dessen Kalenderdatenbank darf weder ganz noch
 * teilweise kopiert oder weiterverbreitet werden (Z. 47) — S12 hat den Abruf
 * entfernt. Seit S15 (19.10.2026) läuft er wieder ZUSÄTZLICH zu den amtlichen
 * Quellen, solange der Schalter `quellenOhneFreigabe` an ist
 * (`quelleErlaubt('forexfactory')`): diese Woche (und, wenn es ihn gibt, der
 * Monats-Feed) mit Prognose, Vorwert und Ist. Der Feed ist inoffiziell (er
 * versorgt das Kalender-Widget der Seite) und führt immer nur die laufende
 * Woche — gerade deshalb ist der eigene Bestand die Wahrheit.
 *
 * Doppelte Termine: derselbe Termin steht dann zweimal im Bestand (z. B.
 * „Federal Funds Rate" von ForexFactory und „FOMC Meeting" der Fed, beide
 * 14:00 New York). Beim LESEN gewinnt im Nahbereich die reichere Quelle:
 * ein amtlicher Termin entfällt, wenn ForexFactory für dasselbe Land
 * innerhalb von `DOPPELT_MS` einen Termin führt (`entdopple`). Mit Schalter
 * aus werden die ForexFactory-Zeilen gar nicht gezeigt — sie bleiben als
 * Bestand liegen, eine Anzeige wäre aber genau die Weiterverwendung, die
 * die Bedingungen ausschliessen.
 *
 * Gesammelt statt durchgereicht bleibt das Prinzip: jeder Lauf schreibt in
 * `calendar_events`, der eigene Bestand ist die Wahrheit, der Abruf nur die
 * Ergänzung. Prognosen und Vorwerte gibt es mit den amtlichen Quellen nicht
 * mehr — die Felder bleiben leer.
 */

import crypto from 'crypto'
import { getKnex } from './database.js'
import { logWarn } from './logger.js'
import { beansprucheAufgabe, meldeFehler, leseAufgabe } from './db-claim.js'
import { holeJson, holeText, sendRadarError } from './marktradar-api.js'
import { istTestbetrieb } from './umgebung.js'
import { quelleErlaubt } from './quellen/freigabe.js'
import { kalenderLaenderVorgabe } from '../shared/kalender-laender.js'
import {
    FED_URL, BEA_URL, EUROSTAT_URL, KALENDER_QUELLEN,
    fedTermine, beaTermine, eurostatTermine,
} from './kalender-quellen.js'

const TAG = 24 * 60 * 60 * 1000
const ABRUF_TTL = 6 * 60 * 60 * 1000

// ── ForexFactory (nur mit Schalter, siehe Kopf) ──────────────────────────

const FF_FEEDS = [
    'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
    // Gibt es nicht immer — wenn doch, liefert er die Vorschau gratis mit
    'https://nfs.faireconomy.media/ff_calendar_thismonth.json',
]
const FF_QUELLEN = ['ff-woche', 'ff-monat']
/** Pflicht-Quellenangabe wie bei den amtlichen Quellen (`KALENDER_QUELLEN`). */
export const FF_QUELLE = { name: 'ForexFactory', url: 'https://www.forexfactory.com/calendar', art: 'quelle' }

/**
 * Abstand, bis zu dem ein amtlicher Termin als derselbe gilt wie einer von
 * ForexFactory im selben Land. Beide nennen die Veröffentlichungszeit auf die
 * Minute (BEA 8:30 ET, Eurostat 11:00 Luxemburg, FOMC 14:00 ET) — fünf
 * Minuten fangen Rundungen, ohne zwei echte Termine zusammenzulegen.
 */
export const DOPPELT_MS = 5 * 60 * 1000

/** Feed-Stufen auf drei eigene abbilden; alles Unbekannte gilt als niedrig. */
export function impactVon(roh) {
    const s = String(roh || '').toLowerCase()
    if (s.startsWith('high')) return 'high'
    if (s.startsWith('med')) return 'medium'
    if (s.startsWith('holiday')) return 'holiday'
    return 'low'
}

/** Ein Feed-Eintrag → Zeile für `calendar_events` (ohne Zeitstempel), oder null. */
export function normalisiereFf(e, quelle) {
    const dateUnix = Date.parse(e?.date)
    if (!Number.isFinite(dateUnix)) return null
    const land = String(e.country || '').toUpperCase()
    const titel = String(e.title || '').trim()
    if (!land || !titel) return null
    return {
        titel, land,
        impact: impactVon(e.impact),
        dateUnix,
        forecast: String(e.forecast ?? ''),
        previous: String(e.previous ?? ''),
        actual: String(e.actual ?? ''),
        quelle,
    }
}

/**
 * Doppelte entfernen (rein, Selbsttest): amtliche Termine, für die
 * ForexFactory im selben Land innerhalb von `DOPPELT_MS` einen führt, fallen
 * weg. ForexFactory-Zeilen und amtliche ohne Gegenstück bleiben.
 */
export function entdopple(zeilen) {
    const ff = new Map()
    for (const z of zeilen) {
        if (!FF_QUELLEN.includes(z.quelle)) continue
        if (!ff.has(z.land)) ff.set(z.land, [])
        ff.get(z.land).push(Number(z.dateUnix))
    }
    if (!ff.size) return zeilen
    return zeilen.filter((z) => {
        if (FF_QUELLEN.includes(z.quelle)) return true
        const zeiten = ff.get(z.land)
        return !zeiten || !zeiten.some(t => Math.abs(t - Number(z.dateUnix)) <= DOPPELT_MS)
    })
}

/**
 * Wochen- und Monats-Feed holen und einpflegen. Vorhandene Zeilen werden
 * aktualisiert, nicht verdoppelt — im Wochenverlauf trägt der Feed erst die
 * Prognose und später den Ist-Wert nach.
 */
async function holeForexFactory(knex) {
    let gesehen = 0, neu = 0
    let letzterFehler = ''
    for (const url of FF_FEEDS) {
        let roh
        try {
            roh = await holeJson(url, 15000)
        } catch (e) {
            // Der Monats-Feed existiert nicht immer — das ist kein Fehlerfall
            if (url.includes('thismonth')) continue
            letzterFehler = e.message
            continue
        }
        if (!Array.isArray(roh)) continue
        const quelle = url.includes('thismonth') ? 'ff-monat' : 'ff-woche'
        const jetzt = Date.now()
        const zeilen = roh.map(e => normalisiereFf(e, quelle)).filter(Boolean)
            .map(z => ({ ...z, extId: extId(z.land, z.titel, z.dateUnix), updatedAt: jetzt, fetchedAt: jetzt }))
        gesehen += zeilen.length
        const vorher = Number((await knex('calendar_events').count('* as c').first())?.c || 0)
        for (let i = 0; i < zeilen.length; i += 50) {
            await knex('calendar_events').insert(zeilen.slice(i, i + 50))
                .onConflict('extId').merge(['impact', 'forecast', 'previous', 'actual', 'updatedAt'])
        }
        const nachher = Number((await knex('calendar_events').count('* as c').first())?.c || 0)
        neu += nachher - vorher
    }
    if (!gesehen && letzterFehler) throw new Error(letzterFehler)
    return { gesehen, neu }
}

/**
 * Länderauswahl: gespeicherter Wert, sonst die Vorgabe nach dem Schalter
 * `quellenOhneFreigabe` (ForexFactory) — dieselbe Regel wie im Browser
 * (`shared/kalender-laender.js`).
 */
export async function kalenderLaenderAus(s) {
    return s?.radarKalenderLaender ?? kalenderLaenderVorgabe(await quelleErlaubt('forexfactory'))
}

/**
 * Name des Anspruchs in `radar_fetch_state`. Er heisst noch nach der alten
 * Quelle, weil die KI-Übersicht (`ai-uebersicht.js`) ihn unter diesem Namen
 * liest; ein neuer Name hätte dort den Takt-Status verloren.
 */
const ANSPRUCH = 'kalender_ff'

/**
 * Fingerabdruck eines Termins. Titel, Land und Zeitpunkt sind stabil — so
 * ergibt jeder Lauf für denselben Termin dieselbe Zeile, statt ihn zu
 * verdoppeln.
 */
const extId = (land, titel, dateUnix) =>
    crypto.createHash('sha1').update(`${land}|${titel}|${dateUnix}`).digest('hex').slice(0, 24)

/** Zeilen einer Quelle einpflegen; liefert `{ gesehen, neu }`. */
async function schreibe(knex, zeilen) {
    if (!zeilen.length) return { gesehen: 0, neu: 0 }
    const jetzt = Date.now()
    const voll = zeilen.map(z => ({
        ...z,
        extId: extId(z.land, z.titel, z.dateUnix),
        forecast: '', previous: '', actual: '',
        updatedAt: jetzt, fetchedAt: jetzt,
    }))
    // In Blöcken: bei einigen Dutzend Terminen je Lauf wären es sonst ebenso
    // viele Hin- und Rückwege zur Datenbank — über Netz zum NAS spürbar.
    const vorher = Number((await knex('calendar_events').count('* as c').first())?.c || 0)
    for (let i = 0; i < voll.length; i += 50) {
        await knex('calendar_events').insert(voll.slice(i, i + 50))
            .onConflict('extId').merge(['impact', 'quelle', 'updatedAt'])
    }
    const nachher = Number((await knex('calendar_events').count('* as c').first())?.c || 0)
    return { gesehen: voll.length, neu: nachher - vorher }
}

/**
 * Termine aller amtlichen Quellen holen und einpflegen. Jede Quelle für sich:
 * fällt eine aus, laufen die anderen weiter, und der Fehler wird benannt.
 */
export async function holeKalender({ manuell = false } = {}) {
    // Von Hand angestossen darf öfter, aber nicht beliebig oft
    const ttl = manuell ? 5 * 60 * 1000 : ABRUF_TTL
    if (!(await beansprucheAufgabe(ANSPRUCH, ttl))) {
        return { uebersprungen: true }
    }

    const knex = getKnex()
    // Ein Fenster statt alles: BEA führt zwei Jahre zurück, Eurostat drei
    // voraus. Zurück reicht für die Ansicht „was war diese Woche".
    const fenster = { von: Date.now() - 14 * TAG, bis: Date.now() + 400 * TAG }
    const QUELLEN = [
        ['fed', async () => fedTermine(await holeJson(FED_URL, 15000), fenster)],
        ['bea', async () => beaTermine(await holeText(BEA_URL, 15000), fenster)],
        ['eurostat', async () => eurostatTermine(await holeText(EUROSTAT_URL, 20000), fenster)],
    ]
    const mitFf = await quelleErlaubt('forexfactory')

    const ergebnis = {}
    const fehler = []
    let gesehen = 0, neu = 0
    for (const [id, holen] of QUELLEN) {
        try {
            const r = await schreibe(knex, await holen())
            ergebnis[id] = r.gesehen
            gesehen += r.gesehen
            neu += r.neu
        } catch (e) {
            fehler.push(`${KALENDER_QUELLEN[id].name}: ${e.message}`)
            logWarn('kalender', `${id}: ${e.message}`)
        }
    }
    // ForexFactory zusätzlich (Schalter an); schreibt selbst, weil es Prognose,
    // Vorwert und Ist nachträgt, die `schreibe` für die amtlichen leer setzt.
    if (mitFf) {
        try {
            const r = await holeForexFactory(knex)
            ergebnis.ff = r.gesehen
            gesehen += r.gesehen
            neu += r.neu
        } catch (e) {
            fehler.push(`ForexFactory: ${e.message}`)
            logWarn('kalender', `ForexFactory: ${e.message}`)
        }
    }

    // Erfolg löscht den Fehler wieder. Sonst bliebe ein „HTTP 429" tagelang in
    // der Statusanzeige stehen, das längst vorbei ist.
    await meldeFehler(ANSPRUCH, fehler.join(' · '))
    console.log(` -> Kalender: ${gesehen} Termine gesehen, ${neu} neu`
        + ` (Fed ${ergebnis.fed ?? '–'}, BEA ${ergebnis.bea ?? '–'}, Eurostat ${ergebnis.eurostat ?? '–'}`
        + `${mitFf ? `, ForexFactory ${ergebnis.ff ?? '–'}` : ''})`)
    return { gesehen, neu, je: ergebnis, fehler: fehler.join(' · ') }
}

/** Bestand aus der eigenen Datenbank — der Feed wird hier nicht angefasst. */
export async function leseKalender({ von, bis, laender, impact }) {
    const knex = getKnex()
    const jetzt = Date.now()
    const vonMs = Number(von) || jetzt - 3 * TAG
    const bisMs = Number(bis) || jetzt + 14 * TAG

    const mitFf = await quelleErlaubt('forexfactory')
    let q = knex('calendar_events')
        .whereBetween('dateUnix', [vonMs, bisMs])
        .orderBy('dateUnix', 'asc')
    // Schalter aus: ForexFactory-Bestand nicht zeigen (siehe Kopf)
    if (!mitFf) q = q.where(b => b.whereNull('quelle').orWhereNotIn('quelle', FF_QUELLEN))

    const landListe = String(laender || '').split(/[,\s]+/).map(x => x.trim().toUpperCase()).filter(Boolean)
    if (landListe.length) q = q.whereIn('land', landListe)

    // „medium" heisst: mittel UND hoch. Eine Untergrenze ist gemeint, keine
    // Punktauswahl — sonst müsste man beide Stufen einzeln anklicken.
    const stufe = String(impact || 'all').toLowerCase()
    if (stufe === 'high') q = q.where('impact', 'high')
    else if (stufe === 'medium') q = q.whereIn('impact', ['medium', 'high'])

    const roh = await q.select(
        'extId', 'titel', 'land', 'impact', 'dateUnix', 'forecast', 'previous', 'actual', 'quelle')
    const zeilen = mitFf ? entdopple(roh) : roh

    // Wie viele Termine lägen ohne Filter im Zeitraum? Nur so lässt sich
    // „nichts los" von „alles weggefiltert" unterscheiden.
    let gq = knex('calendar_events').whereBetween('dateUnix', [vonMs, bisMs])
    if (!mitFf) gq = gq.where(b => b.whereNull('quelle').orWhereNotIn('quelle', FF_QUELLEN))
    const gesamt = Number((await gq.count('* as c').first())?.c || 0)

    const zustand = await leseAufgabe(ANSPRUCH)
    // Die Pflicht-Quellenangaben derer, die im Ergebnis vorkommen — die
    // Ansicht setzt sie unter die Liste („Quelle: ForexFactory" nur mit
    // Schalter, sonst stehen keine ForexFactory-Zeilen im Ergebnis).
    const arten = new Set(zeilen.map(z => z.quelle))
    const quellen = [...arten].filter(q => KALENDER_QUELLEN[q]).map(q => KALENDER_QUELLEN[q])
    if (FF_QUELLEN.some(q => arten.has(q))) quellen.unshift(FF_QUELLE)
    return {
        ereignisse: zeilen.map(z => ({ ...z, dateUnix: Number(z.dateUnix) })),
        quellen,
        gesamtImZeitraum: gesamt,
        letzterAbruf: Number(zustand?.fetchedAt) || null,
        letzterFehler: zustand?.lastError || '',
        // Ohne diese Angabe wüsste niemand, ob eine leere Vorschau bedeutet
        // „nichts los" oder „der Feed hat die neue Woche noch nicht"
        bestandBis: zeilen.length ? Number(zeilen[zeilen.length - 1].dateUnix) : null,
    }
}

let takt = null

export function setupKalenderRoutes(app) {
    app.get('/api/marktradar/kalender', async (req, res) => {
        try {
            const knex = getKnex()
            const s = await knex('settings').where('id', 1).first().catch(() => null)
            const daten = await leseKalender({
                von: req.query.von,
                bis: req.query.bis,
                laender: req.query.laender ?? await kalenderLaenderAus(s),
                impact: req.query.impact ?? s?.radarKalenderImpact ?? 'medium',
            })
            res.set('Cache-Control', 'no-store')
            res.json({ stand: daten.letzterAbruf || Date.now(), veraltet: false, ...daten })
        } catch (e) {
            sendRadarError(res, e, 'Wirtschaftskalender')
        }
    })

    app.post('/api/marktradar/kalender/holen', async (req, res) => {
        try {
            res.json(await holeKalender({ manuell: true }))
        } catch (e) {
            sendRadarError(res, e, 'Wirtschaftskalender')
        }
    })

    // Beim Start einmal, danach alle zwei Stunden nachfassen. Der Anspruch
    // sorgt dafür, dass daraus höchstens alle sechs Stunden ein echter Abruf
    // wird — auch wenn mehrere Instanzen laufen.
    // Im Testbetrieb nur von Hand (Knopf „holen").
    if (!istTestbetrieb()) {
        holeKalender().catch(() => { })
        takt = setInterval(() => holeKalender().catch(() => { }), 2 * 60 * 60 * 1000)
    }

    console.log(' -> Kalender routes initialized')
}

export function stopKalender() {
    clearInterval(takt)
    takt = null
}
