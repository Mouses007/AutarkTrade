/**
 * Kalender: Monatsraster (Wochen ab Montag) mit dem P&L der gefilterten Tage
 * (Spezifikation journal-kern.md §4.4).
 */
import calendarize from 'calendarize'
import dayjs from './zeit.js'
import { pageId, timeZoneTrade } from '../../stores/app/rahmen.js'
import { diagrammeImAufbau } from '../../stores/app/laden.js'
import { gewaehlterMonat } from '../../stores/journal/filter.js'
import { journalTage } from '../../stores/journal/auswertung.js'
import { kalenderDaten, miniKalenderDaten } from '../../stores/journal/kalender.js'
import { ersetzeObjekt } from './hilfen.js'

const zwei = (n) => String(n).padStart(2, '0')

/** Monatsanfänge, für die ein Raster entsteht (Sekunden). */
function monate(start, zone) {
    if (pageId.value !== 'calendar') return [start]
    const anfang = dayjs.unix(start).tz(zone).startOf('month')
    const liste = []
    // vom gewählten Monat rückwärts bis Januar
    for (let i = 0; i <= anfang.month(); i++) liste.push(anfang.subtract(i, 'month').startOf('month').unix())
    return liste
}

/** Der LETZTE gefilterte Tag mit diesem Kalenderdatum. */
function tagMitDatum(tag, monat, jahr) {
    let treffer
    for (const d of journalTage) {
        if (d.date == tag && d.month + 1 == monat && d.year == jahr) treffer = d
    }
    return treffer
}

/** Raster eines Monats: Wochenindex → 7 Tagesobjekte. */
function raster(monatsWert, zone) {
    // calendarize liest die Zeichenkette in der Prozesszeitzone und nimmt Jahr und Monat daraus.
    const eingabe = new Date(new Date(monatsWert * 1000).toLocaleString('en-US', { timeZone: zone }))
    const wochen = calendarize(eingabe, 1)
    const imMonat = dayjs.unix(monatsWert).tz(zone)
    const monat = imMonat.month() + 1
    const jahr = imMonat.year()
    const titel = imMonat.format('MMMM YYYY')

    const aus = {}
    wochen.forEach((woche, w) => {
        aus[w] = woche.map(tag => {
            const feld = {
                month: titel,
                day: tag,
                dateUnix: tag === 0 ? 0 : dayjs.tz(`${jahr}-${zwei(monat)}-${zwei(tag)}`, zone).unix(),
            }
            const treffer = tag === 0 ? undefined : tagMitDatum(tag, monat, jahr)
            if (treffer && Object.keys(treffer).length > 0) {
                feld.pAndL = treffer.pAndL
                feld.satisfaction = treffer.satisfaction
            } else {
                feld.pAndL = []
            }
            return feld
        })
    })
    return aus
}

export async function ladeKalender() {
    diagrammeImAufbau.value = true
    try {
        // Bewusster Altfehler §7.4: miniKalenderDaten ist ein Objekt; das hier
        // legt dort den Schlüssel `length` an, und Mini-Kalender kommen nie hinein.
        miniKalenderDaten.length = 0
        const zone = timeZoneTrade.value
        const start = gewaehlterMonat.value.start
        const gewaehlt = dayjs.unix(start).tz(zone).startOf('month').unix()
        for (const wert of monate(start, zone)) {
            if (wert !== gewaehlt) continue   // Mini-Kalender: bleiben leer (§7.4)
            ersetzeObjekt(kalenderDaten, raster(wert, zone))
        }
    } catch (fehler) {
        console.error('Fehler beim Aufbau des Kalenders:', fehler)
    }
}
