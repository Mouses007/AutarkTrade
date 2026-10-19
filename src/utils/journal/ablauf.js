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
import { pageId, timeZoneTrade, hasData, dailyPagination, dailyQueryLimit, endOfList } from '../../stores/app/rahmen.js'
import {
    spinnerLoadingPage, dashboardChartsMounted, dashboardIdMounted, barChartNegativeTagGroups, renderData,
    renderingCharts, spinnerLoadMore, auswertungMounted,
} from '../../stores/app/laden.js'
import { selectedRange, selectedDateRange, selectedMonth, selectedPeriodRange } from '../../stores/journal/filter.js'
import { groups } from '../../stores/journal/auswertung.js'
import { availableTags } from '../../stores/journal/tagebuch.js'
import { useGetExcursions, useGetSatisfactions, useGetTags, useGetAvailableTags, useGetNotes, useGetAuswertungNotes } from './tagebuch.js'
import { useGetFilteredTrades, useGetFilteredTradesForDaily } from './laden.js'
import { useTotalTrades } from './summen.js'
import { useGroupTrades } from './gruppieren.js'
import { useCalculateProfitAnalysis } from './gewinnanalyse.js'
import { useLoadCalendar } from './kalender.js'
import { useGetAPIS } from './app.js'
import { useGetScreenshots, useGetScreenshotsPagination } from '../screenshots.js'
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

/** Bestimmt `selectedRange` je Seite. */
export async function useGetSelectedRange() {
    const seite = pageId.value
    if (seite === 'dashboard' || seite === 'auswertung') {
        selectedRange.value = selectedPeriodRange.value?.value === 'all' ? { start: 0, end: 0 } : selectedDateRange.value
    } else if (seite === 'calendar') {
        selectedRange.value = {
            start: dayjs.unix(selectedMonth.value.start).tz(timeZoneTrade.value).startOf('year').unix(),
            end: selectedMonth.value.end,
        }
    } else {
        selectedRange.value = selectedMonth.value
    }
}

export async function useMountDashboard() {
    const aktuell = neuerLauf()
    try {
        spinnerLoadingPage.value = true
        dashboardChartsMounted.value = false
        dashboardIdMounted.value = false
        barChartNegativeTagGroups.value = []
        await useGetSelectedRange()
        await Promise.all([useGetExcursions(), useGetSatisfactions(), useGetTags()])
        pruefe(aktuell)
        await useGetFilteredTrades()
        pruefe(aktuell)
        await useTotalTrades()
        await useGroupTrades()
        await useCalculateProfitAnalysis()
        pruefe(aktuell)
        spinnerLoadingPage.value = false
        dashboardIdMounted.value = true
        // Tag-Gruppen mit Diagramm: Reihenfolge des Katalogs
        const vorhanden = Object.keys(groups)
        for (const g of availableTags) {
            if (vorhanden.includes(g.id)) barChartNegativeTagGroups.value.push({ id: g.id, name: g.name })
        }
        if (hasData.value && aktuell()) {
            dashboardChartsMounted.value = true
            useDisposeJournalCharts()
            renderData.value += 1
            await nextTick()
            pruefe(aktuell)
            ;(await ladeDiagramme()).useECharts('init')
        }
    } catch (fehler) {
        if (fehler instanceof Ueberholt) return
        console.error('Dashboard laden fehlgeschlagen:', fehler)
        if (aktuell()) spinnerLoadingPage.value = false
    }
}

export async function useMountDaily() {
    const aktuell = neuerLauf()
    try {
        dailyPagination.value = 0
        dailyQueryLimit.value = 3
        endOfList.value = false
        spinnerLoadingPage.value = true
        await useGetSelectedRange()
        await Promise.all([useGetExcursions(), useGetSatisfactions(), useGetTags(), useGetAvailableTags(), useGetNotes(), useGetAPIS()])
        pruefe(aktuell)
        await useGetFilteredTrades()
        pruefe(aktuell)
        spinnerLoadingPage.value = false
        ladeDiagramme().then(d => { d.useRenderDoubleLineChart(); d.useRenderPieChart() })
        useLoadCalendar()
        useGetScreenshots(true)
        renderingCharts.value = false
    } catch (fehler) {
        if (fehler instanceof Ueberholt) return
        console.error('Tagesansicht laden fehlgeschlagen:', fehler)
        if (aktuell()) spinnerLoadingPage.value = false
    }
}

export async function useMountCalendar(_param) {
    const aktuell = neuerLauf()
    try {
        spinnerLoadingPage.value = true
        await useGetSelectedRange()
        await Promise.all([useGetTags(), useGetAvailableTags()])
        pruefe(aktuell)
        await useGetFilteredTrades()
        pruefe(aktuell)
        await useLoadCalendar()
    } catch (fehler) {
        if (fehler instanceof Ueberholt) return
        console.error('Kalender laden fehlgeschlagen:', fehler)
    }
    if (aktuell()) spinnerLoadingPage.value = false
}

export async function useMountScreenshots() {
    const aktuell = neuerLauf()
    try {
        spinnerLoadingPage.value = true
        useGetScreenshotsPagination()
        await useGetSelectedRange()
        await Promise.all([useGetTags(), useGetAvailableTags()])
        pruefe(aktuell)
        await useGetScreenshots(false)
    } catch (fehler) {
        if (!(fehler instanceof Ueberholt)) console.error('Screenshots laden fehlgeschlagen:', fehler)
    } finally {
        if (aktuell()) spinnerLoadingPage.value = false
    }
}

export async function useMountAuswertung() {
    const aktuell = neuerLauf()
    try {
        spinnerLoadingPage.value = true
        auswertungMounted.value = false
        await useGetSelectedRange()
        await Promise.all([useGetAuswertungNotes(), useGetSatisfactions(), useGetTags()])
        pruefe(aktuell)
        await useGetFilteredTrades()
        pruefe(aktuell)
        spinnerLoadingPage.value = false
        auswertungMounted.value = true
    } catch (fehler) {
        if (fehler instanceof Ueberholt) return
        console.error('Auswertung laden fehlgeschlagen:', fehler)
        if (aktuell()) spinnerLoadingPage.value = false
    }
}

export function useCheckVisibleScreen() {
    if (window.innerHeight >= document.documentElement.scrollHeight) useLoadMore()
}

export async function useLoadMore() {
    spinnerLoadMore.value = true
    if (pageId.value === 'daily') {
        useGetFilteredTradesForDaily()
        const d = await ladeDiagramme()
        await Promise.all([d.useRenderDoubleLineChart(), d.useRenderPieChart()])
    } else if (pageId.value === 'screenshots') {
        await useGetScreenshots(false)
    }
    spinnerLoadMore.value = false
}

export async function useRefreshTrades() {
    spinnerLoadingPage.value = true
    if (pageId.value === 'dashboard') await useMountDashboard()
    else if (pageId.value === 'daily') await useMountDaily()
    else if (pageId.value === 'calendar') await useMountCalendar()
    else window.location.href = '/dashboard'
}

/** Diagramm-Instanzen freigeben, solange ihre Knoten noch im Dokument hängen. */
export function useDisposeJournalCharts() {
    const d = geladeneDiagramme()
    if (!d) return
    const knoten = [...document.querySelectorAll('.chartClass, .chartIdCardClass, #candlestickChart')]
    if (knoten.length) d.disposeCharts(knoten)
}
