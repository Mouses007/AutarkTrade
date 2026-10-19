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
 * teilweise kopiert oder weiterverbreitet werden (Z. 47) — der Abruf ist
 * entfernt. Was davon schon in `calendar_events` liegt (`quelle` =
 * `ff-woche`/`ff-monat`), bleibt als Bestand der Installation liegen; es
 * kommt nichts mehr dazu. Weil die Ansichten nur ein Fenster um „jetzt"
 * zeigen (Vorgabe drei Tage zurück, zwei Wochen voraus), fallen die alten
 * Zeilen spätestens zwei Wochen nach dem Umstieg von selbst aus jeder Anzeige.
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
import {
    FED_URL, BEA_URL, EUROSTAT_URL, KALENDER_QUELLEN,
    fedTermine, beaTermine, eurostatTermine,
} from './kalender-quellen.js'

const TAG = 24 * 60 * 60 * 1000
const ABRUF_TTL = 6 * 60 * 60 * 1000

/**
 * Vorgabe der Länderauswahl, wenn der Nutzer nichts eingestellt hat. Bis S12
 * war es `USD,JPY` — für Japan gibt es ohne ForexFactory keine Quelle mehr,
 * für den Euroraum jetzt Eurostat.
 */
export const KALENDER_LAENDER_VORGABE = 'USD,EUR'

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

    // Erfolg löscht den Fehler wieder. Sonst bliebe ein „HTTP 429" tagelang in
    // der Statusanzeige stehen, das längst vorbei ist.
    await meldeFehler(ANSPRUCH, fehler.join(' · '))
    console.log(` -> Kalender: ${gesehen} Termine gesehen, ${neu} neu`
        + ` (Fed ${ergebnis.fed ?? '–'}, BEA ${ergebnis.bea ?? '–'}, Eurostat ${ergebnis.eurostat ?? '–'})`)
    return { gesehen, neu, je: ergebnis, fehler: fehler.join(' · ') }
}

/** Bestand aus der eigenen Datenbank — der Feed wird hier nicht angefasst. */
export async function leseKalender({ von, bis, laender, impact }) {
    const knex = getKnex()
    const jetzt = Date.now()
    const vonMs = Number(von) || jetzt - 3 * TAG
    const bisMs = Number(bis) || jetzt + 14 * TAG

    let q = knex('calendar_events')
        .whereBetween('dateUnix', [vonMs, bisMs])
        .orderBy('dateUnix', 'asc')

    const landListe = String(laender || '').split(/[,\s]+/).map(x => x.trim().toUpperCase()).filter(Boolean)
    if (landListe.length) q = q.whereIn('land', landListe)

    // „medium" heisst: mittel UND hoch. Eine Untergrenze ist gemeint, keine
    // Punktauswahl — sonst müsste man beide Stufen einzeln anklicken.
    const stufe = String(impact || 'all').toLowerCase()
    if (stufe === 'high') q = q.where('impact', 'high')
    else if (stufe === 'medium') q = q.whereIn('impact', ['medium', 'high'])

    const zeilen = await q.select(
        'extId', 'titel', 'land', 'impact', 'dateUnix', 'forecast', 'previous', 'actual', 'quelle')

    // Wie viele Termine lägen ohne Filter im Zeitraum? Nur so lässt sich
    // „nichts los" von „alles weggefiltert" unterscheiden.
    const gesamt = Number((await knex('calendar_events')
        .whereBetween('dateUnix', [vonMs, bisMs]).count('* as c').first())?.c || 0)

    const zustand = await leseAufgabe(ANSPRUCH)
    // Die Pflicht-Quellenangaben derer, die im Ergebnis vorkommen — die
    // Ansicht setzt sie unter die Liste. Altbestand von ForexFactory trägt
    // keine (es kommt nichts mehr dazu, und er läuft aus dem Fenster).
    const quellen = [...new Set(zeilen.map(z => z.quelle))]
        .filter(q => KALENDER_QUELLEN[q]).map(q => KALENDER_QUELLEN[q])
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
                laender: req.query.laender ?? s?.radarKalenderLaender ?? KALENDER_LAENDER_VORGABE,
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
