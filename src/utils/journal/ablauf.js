/**
 * Mount-Abläufe der Journal-Seiten: Spinner und Mounted-Flags setzen, den
 * Zeitraum bestimmen, die Schritte der Kette in fester Folge rufen
 * (Spezifikation journal-kern.md §4.5).
 *
 * Jeder Ablauf zieht eine Generationsnummer. Startet währenddessen ein
 * jüngerer, bricht der ältere an der nächsten Prüfstelle still ab und fasst
 * Spinner und Stores nicht mehr an.
 */
import { nextTick } from 'vue'
import dayjs from './zeit.js'
import { pageId, timeZoneTrade, journalHatDaten, tagesSeite, tagesAbfrageGrenze, listeZuEnde } from '../../stores/app/rahmen.js'
import {
    seiteLaedt, dashboardDiagrammeBereit, dashboardBereit, negativeTagGruppen, zeichenZaehler,
    diagrammeImAufbau, ladeMehr, auswertungMounted,
} from '../../stores/app/laden.js'
import { gewaehlterBereich, selectedDateRange, gewaehlterMonat, selectedPeriodRange } from '../../stores/journal/filter.js'
import { groups } from '../../stores/journal/auswertung.js'
import { verfuegbareTags } from '../../stores/journal/tagebuch.js'
import { ladeExkursionen, ladeZufriedenheit, ladeTags, ladeVerfuegbareTags, ladeNotizen, useGetAuswertungNotes } from './tagebuch.js'
import { filtereTrades, ladeNaechsteTage } from './laden.js'
import { summiereTrades } from './summen.js'
import { gruppiereTrades } from './gruppieren.js'
import { berechneGewinnAnalyse } from './gewinnanalyse.js'
import { ladeKalender } from './kalender.js'
import { ladeApis } from './app.js'
import { ladeBilder, leseBildSeite } from '../screenshots.js'
import { ladeDiagramme, geladeneDiagramme } from './diagrammLader.js'

let generation = 0
/** Startet einen Ablauf und gibt die Prüfung „bin ich noch aktuell?" zurück. */
function neuerLauf() {
    const meine = ++generation
    return () => meine === generation
}

/** Abbruch eines überholten Laufs — kein Fehler. */
class Ueberholt extends Error {}
const pruefe = (aktuell) => { if (!aktuell()) throw new Ueberholt() }

/** Bestimmt `gewaehlterBereich` je Seite. */
export async function bestimmeBereich() {
    const seite = pageId.value
    if (seite === 'dashboard' || seite === 'auswertung') {
        gewaehlterBereich.value = selectedPeriodRange.value?.value === 'all' ? { start: 0, end: 0 } : selectedDateRange.value
    } else if (seite === 'calendar') {
        gewaehlterBereich.value = {
            start: dayjs.unix(gewaehlterMonat.value.start).tz(timeZoneTrade.value).startOf('year').unix(),
            end: gewaehlterMonat.value.end,
        }
    } else {
        gewaehlterBereich.value = gewaehlterMonat.value
    }
}

export async function starteDashboard() {
    const aktuell = neuerLauf()
    try {
        seiteLaedt.value = true
        dashboardDiagrammeBereit.value = false
        dashboardBereit.value = false
        negativeTagGruppen.value = []
        await bestimmeBereich()
        await Promise.all([ladeExkursionen(), ladeZufriedenheit(), ladeTags()])
        pruefe(aktuell)
        await filtereTrades()
        pruefe(aktuell)
        await summiereTrades()
        await gruppiereTrades()
        await berechneGewinnAnalyse()
        pruefe(aktuell)
        seiteLaedt.value = false
        dashboardBereit.value = true
        // Tag-Gruppen mit Diagramm: Reihenfolge des Katalogs
        const vorhanden = Object.keys(groups)
        for (const g of verfuegbareTags) {
            if (vorhanden.includes(g.id)) negativeTagGruppen.value.push({ id: g.id, name: g.name })
        }
        if (journalHatDaten.value && aktuell()) {
            dashboardDiagrammeBereit.value = true
            useDisposeJournalCharts()
            zeichenZaehler.value += 1
            await nextTick()
            pruefe(aktuell)
            ;(await ladeDiagramme()).zeichneDiagramme('init')
        }
    } catch (fehler) {
        if (fehler instanceof Ueberholt) return
        console.error('Dashboard laden fehlgeschlagen:', fehler)
        if (aktuell()) seiteLaedt.value = false
    }
}

export async function starteTagesansicht() {
    const aktuell = neuerLauf()
    try {
        tagesSeite.value = 0
        tagesAbfrageGrenze.value = 3
        listeZuEnde.value = false
        seiteLaedt.value = true
        await bestimmeBereich()
        await Promise.all([ladeExkursionen(), ladeZufriedenheit(), ladeTags(), ladeVerfuegbareTags(), ladeNotizen(), ladeApis()])
        pruefe(aktuell)
        await filtereTrades()
        pruefe(aktuell)
        seiteLaedt.value = false
        ladeDiagramme().then(d => { d.zeichneDoppellinie(); d.zeichneTorte() })
        ladeKalender()
        ladeBilder(true)
        diagrammeImAufbau.value = false
    } catch (fehler) {
        if (fehler instanceof Ueberholt) return
        console.error('Tagesansicht laden fehlgeschlagen:', fehler)
        if (aktuell()) seiteLaedt.value = false
    }
}

export async function starteKalender(_param) {
    const aktuell = neuerLauf()
    try {
        seiteLaedt.value = true
        await bestimmeBereich()
        await Promise.all([ladeTags(), ladeVerfuegbareTags()])
        pruefe(aktuell)
        await filtereTrades()
        pruefe(aktuell)
        await ladeKalender()
    } catch (fehler) {
        if (fehler instanceof Ueberholt) return
        console.error('Kalender laden fehlgeschlagen:', fehler)
    }
    if (aktuell()) seiteLaedt.value = false
}

export async function starteBilder() {
    const aktuell = neuerLauf()
    try {
        seiteLaedt.value = true
        leseBildSeite()
        await bestimmeBereich()
        await Promise.all([ladeTags(), ladeVerfuegbareTags()])
        pruefe(aktuell)
        await ladeBilder(false)
    } catch (fehler) {
        if (!(fehler instanceof Ueberholt)) console.error('Screenshots laden fehlgeschlagen:', fehler)
    } finally {
        if (aktuell()) seiteLaedt.value = false
    }
}

export async function useMountAuswertung() {
    const aktuell = neuerLauf()
    try {
        seiteLaedt.value = true
        auswertungMounted.value = false
        await bestimmeBereich()
        await Promise.all([useGetAuswertungNotes(), ladeZufriedenheit(), ladeTags()])
        pruefe(aktuell)
        await filtereTrades()
        pruefe(aktuell)
        seiteLaedt.value = false
        auswertungMounted.value = true
    } catch (fehler) {
        if (fehler instanceof Ueberholt) return
        console.error('Auswertung laden fehlgeschlagen:', fehler)
        if (aktuell()) seiteLaedt.value = false
    }
}

export function pruefeSichtbarkeit() {
    if (window.innerHeight >= document.documentElement.scrollHeight) ladeWeitere()
}

export async function ladeWeitere() {
    ladeMehr.value = true
    if (pageId.value === 'daily') {
        ladeNaechsteTage()
        const d = await ladeDiagramme()
        await Promise.all([d.zeichneDoppellinie(), d.zeichneTorte()])
    } else if (pageId.value === 'screenshots') {
        await ladeBilder(false)
    }
    ladeMehr.value = false
}

export async function ladeTradesNeu() {
    seiteLaedt.value = true
    if (pageId.value === 'dashboard') await starteDashboard()
    else if (pageId.value === 'daily') await starteTagesansicht()
    else if (pageId.value === 'calendar') await starteKalender()
    else window.location.href = '/dashboard'
}

/** Diagramm-Instanzen freigeben, solange ihre Knoten noch im Dokument hängen. */
export function useDisposeJournalCharts() {
    const d = geladeneDiagramme()
    if (!d) return
    const knoten = [...document.querySelectorAll('.chartClass, .chartIdCardClass, #candlestickChart')]
    if (knoten.length) d.disposeCharts(knoten)
}
