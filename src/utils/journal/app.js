/**
 * App-Start und Seitenhilfen: Einstellungen laden, Zeitzone, Perioden,
 * Vorgaben aus localStorage, Reiter, Popover/Tooltip, mobiles Menü, Export
 * (Spezifikation journal-kern.md §4.8).
 */
import { nextTick } from 'vue'
import { useRoute } from 'vue-router'
import dayjs from './zeit.js'
import i18n from '../../i18n/index.js'
import { dbGetSettings } from '../db.js'
import {
    pageId, currentUser, timeZoneTrade, selectedItem, sideMenuMobileOut, screenType, windowIsScrolled,
    idCurrent, idPrevious, idCurrentType, idCurrentNumber, idPreviousType, idPreviousNumber,
} from '../../stores/app/rahmen.js'
import { renderData, tabGettingScreenshots } from '../../stores/app/laden.js'
import { apis } from '../../stores/app/einstellungen.js'
import {
    periodRange, selectedDashTab, selectedPeriodRange, selectedPositions, selectedTimeFrame, selectedRatio,
    selectedAccount, selectedGrossNet, selectedPlSatisfaction, selectedBroker, selectedDateRange, selectedMonth,
    selectedMonthPreset, selectedAccounts, amountCase, selectedTags, selectedTradeTimeframes,
} from '../../stores/journal/filter.js'
import { filteredTrades } from '../../stores/journal/auswertung.js'
import { tags, availableTags } from '../../stores/journal/tagebuch.js'
import { screenshots, screenshotsInfos, screenshotsPagination } from '../../stores/journal/screenshots.js'
import { useGetTags, useGetAvailableTags } from './tagebuch.js'
import { useDeleteTrade, useDeleteExcursions } from './laden.js'
import { useStartOfDay } from './format.js'
import { useGetScreenshots, useDeleteScreenshot } from '../screenshots.js'
import { ladeDiagramme } from './diagrammLader.js'

const t = (k) => i18n.global.t(k)
const bootstrap = () => globalThis.bootstrap

function speichere(schluessel, wert) {
    try { localStorage.setItem(schluessel, wert) } catch { /* egal */ }
}
const lies = (schluessel) => { try { return localStorage.getItem(schluessel) } catch { return null } }

// ── Einstellungen und Zeitzone ─────────────────────────────────────────────

export async function useInitApp() {
    try {
        const einstellungen = await dbGetSettings()
        currentUser.value = einstellungen
        speichere('startseiteAn', Number(einstellungen?.startseiteAn ?? 1) === 1 ? '1' : '0')
        if (Array.isArray(einstellungen?.tradeTimeframes)) {
            selectedTradeTimeframes.length = 0
            for (const tf of einstellungen.tradeTimeframes) selectedTradeTimeframes.push(tf)
        }
    } catch (e) {
        console.warn('Einstellungen nicht lesbar:', e)
        currentUser.value = {}
    }
}
export const useInitParse = () => useInitApp()

export async function useGetCurrentUser() {
    try { currentUser.value = await dbGetSettings() } catch { currentUser.value = {} }
}
export const useCheckCurrentUser = () => useGetCurrentUser()

export function useGetTimeZone() {
    const u = currentUser.value
    timeZoneTrade.value = u && Object.prototype.hasOwnProperty.call(u, 'timeZone') ? u.timeZone : 'America/New_York'
}

export async function useGetAPIS() {
    const einstellungen = await dbGetSettings()
    apis.length = 0
    for (const a of einstellungen?.apis || []) apis.push(a)
}

// ── Perioden ───────────────────────────────────────────────────────────────

/** Woche Montag 00:00 – Sonntag 23:59:59: die en-Woche (So–Sa) um einen Tag verschoben. */
const wochenAnfang = (d) => d.startOf('week').add(1, 'day')
const wochenEnde = (d) => d.endOf('week').add(1, 'day')

export async function useGetPeriods() {
    const jetzt = dayjs().tz(timeZoneTrade.value)
    const vorWoche = jetzt.subtract(1, 'week')
    const vorMonat = jetzt.subtract(1, 'month')
    const vorDreiMonaten = jetzt.subtract(3, 'month')
    const vorJahr = jetzt.subtract(1, 'year')
    const eintraege = [
        ['all', 'total', 0, 0],
        ['thisWeek', 'thisWeek', wochenAnfang(jetzt), wochenEnde(jetzt)],
        ['lastWeek', 'lastWeek', wochenAnfang(vorWoche), wochenEnde(vorWoche)],
        ['lastWeekTilNow', 'lastWeekTilNow', wochenAnfang(vorWoche), wochenEnde(jetzt)],
        ['thisMonth', 'thisMonth', jetzt.startOf('month'), jetzt.endOf('month')],
        ['lastMonth', 'lastMonth', vorMonat.startOf('month'), vorMonat.endOf('month')],
        ['lastMonthTilNow', 'lastMonthTilNow', vorMonat.startOf('month'), jetzt.endOf('month')],
        ['lastThreeMonths', 'lastThreeMonths', vorDreiMonaten.startOf('month'), vorMonat.endOf('month')],
        ['lastThreeMonthsTilNow', 'lastThreeMonthsTilNow', vorDreiMonaten.startOf('month'), jetzt.endOf('month')],
        ['thisYear', 'thisYear', jetzt.startOf('year'), jetzt.endOf('year')],
        ['lastYear', 'lastYear', vorJahr.startOf('year'), vorJahr.endOf('year')],
        ['custom', 'custom', -1, -1],
    ]
    const sek = (x) => (typeof x === 'number' ? x : x.unix())
    periodRange.length = 0
    for (const [value, label, start, end] of eintraege) {
        periodRange.push({ value, label: t(`options.${label}`), start: sek(start), end: sek(end) })
    }
}

// ── Vorgaben aus localStorage ──────────────────────────────────────────────

const periode = (wert) => periodRange.find(p => p.value === wert)
const bereichVon = (p) => ({ start: p.start, end: p.end })

export async function useSetValues() {
    if (lies('selectedDashTab') === null) speichere('selectedDashTab', 'overviewTab')
    selectedDashTab.value = lies('selectedDashTab')

    if (lies('selectedPositions') === null) speichere('selectedPositions', 'long,short')
    selectedPositions.value = lies('selectedPositions').split(',')

    if (lies('selectedTimeFrame') === null) speichere('selectedTimeFrame', 'daily')
    selectedTimeFrame.value = lies('selectedTimeFrame')

    const ratio = lies('selectedRatio')
    if (ratio === null || ratio === 'apps') speichere('selectedRatio', 'appt')
    selectedRatio.value = lies('selectedRatio')

    if (lies('selectedAccount') === null) speichere('selectedAccount', 'all')
    selectedAccount.value = lies('selectedAccount')

    if (lies('selectedGrossNet') === null) speichere('selectedGrossNet', 'gross')
    selectedGrossNet.value = lies('selectedGrossNet')

    if (lies('selectedPlSatisfaction') === null) speichere('selectedPlSatisfaction', 'pl')
    selectedPlSatisfaction.value = lies('selectedPlSatisfaction')

    if (lies('selectedBroker') === null) speichere('selectedBroker', 'bitunix')
    selectedBroker.value = lies('selectedBroker')

    if (lies('selectedDateRange') === null) speichere('selectedDateRange', JSON.stringify(bereichVon(periode('thisYear'))))
    selectedDateRange.value = JSON.parse(lies('selectedDateRange'))

    if (lies('selectedPeriodRange') === null) {
        const r = selectedDateRange.value
        const passend = periodRange.find(p => p.start === r.start && p.end === r.end) || periode('custom')
        speichere('selectedPeriodRange', JSON.stringify(passend))
    }
    selectedPeriodRange.value = JSON.parse(lies('selectedPeriodRange'))

    const art = selectedPeriodRange.value?.value
    if (art === 'all' && !(selectedDateRange.value.start === 0 && selectedDateRange.value.end === 0)) {
        selectedDateRange.value = { start: 0, end: 0 }
        speichere('selectedDateRange', JSON.stringify(selectedDateRange.value))
    }
    if (art !== 'custom' && art !== 'all') {
        // Eine Periode wie „dieser Monat" wandert mit der Zeit — frisch berechnen.
        const frisch = periode(art)
        if (frisch && (frisch.start !== selectedPeriodRange.value.start || frisch.end !== selectedPeriodRange.value.end)) {
            selectedPeriodRange.value = { ...frisch }
            selectedDateRange.value = bereichVon(frisch)
            speichere('selectedPeriodRange', JSON.stringify(selectedPeriodRange.value))
            speichere('selectedDateRange', JSON.stringify(selectedDateRange.value))
        }
    }

    if (lies('selectedMonth') === null) speichere('selectedMonth', JSON.stringify(bereichVon(periode('thisMonth'))))
    selectedMonth.value = JSON.parse(lies('selectedMonth'))

    if (lies('selectedMonthPreset') === null) speichere('selectedMonthPreset', 'current')
    selectedMonthPreset.value = lies('selectedMonthPreset')
    if (selectedMonthPreset.value === 'current') {
        const monat = periode('thisMonth')
        if (monat && (monat.start !== selectedMonth.value?.start || monat.end !== selectedMonth.value?.end)) {
            selectedMonth.value = bereichVon(monat)
            speichere('selectedMonth', JSON.stringify(selectedMonth.value))
        }
    }

    const konten = currentUser.value?.accounts || []
    if (lies('selectedAccounts') === null && konten.length > 0) {
        speichere('selectedAccounts', konten.map(k => k.value).join(','))
        selectedAccounts.value = lies('selectedAccounts').split(',')
    }

    const tagIds = () => availableTags.flatMap(g => (g.tags || []).map(x => x.id))
    const gespeicherteTags = lies('selectedTags')
    if (gespeicherteTags === null) {
        await useGetTags()
        const neu = ['t000t']
        await useGetAvailableTags()
        neu.push(...tagIds())
        tags.length = 0
        selectedTags.value = neu
        speichere('selectedTags', neu.join(','))
    } else {
        await useGetAvailableTags()
        const liste = gespeicherteTags.split(',')
        let ergaenzt = false
        for (const id of tagIds()) if (!liste.includes(id)) { liste.push(id); ergaenzt = true }
        if (ergaenzt) {
            selectedTags.value = liste
            speichere('selectedTags', liste.join(','))
        }
    }

    amountCase.value = lies('selectedGrossNet')
}

// ── Reiter ─────────────────────────────────────────────────────────────────

let reiterOffen = false

function reiterDaily(knopf) {
    knopf.addEventListener('click', async () => {
        const ersterKlick = idCurrent.value === undefined
        if (!ersterKlick) idPrevious.value = idCurrent.value
        idCurrent.value = knopf.id
        if (idPrevious.value === undefined) idPrevious.value = idCurrent.value

        const [artJetzt, nrJetzt] = String(idCurrent.value).split('-')
        const [artVorher, nrVorher] = String(idPrevious.value).split('-')
        idCurrentType.value = artJetzt
        idCurrentNumber.value = nrJetzt
        idPreviousType.value = artVorher
        idPreviousNumber.value = nrVorher

        if (artJetzt === 'screenshots') {
            const tagUnix = filteredTrades[nrJetzt]?.dateUnix
            const info = screenshotsInfos.find(x => x.dateUnixDay == tagUnix || x.dateUnixDay == useStartOfDay(tagUnix))
            if (info && (screenshots.length === 0 || screenshots[0].dateUnixDay !== info.dateUnixDay)) {
                tabGettingScreenshots.value = true
                await useGetScreenshots(true, info.dateUnixDay)
                tabGettingScreenshots.value = false
            }
        }

        const inhalt = document.querySelector(`#${artJetzt}Nav-${nrJetzt}`)
        if (ersterKlick) {
            reiterOffen = true
        } else if (idCurrent.value === idPrevious.value) {
            // derselbe Reiter noch einmal: Inhalt zu- bzw. aufklappen
            reiterOffen = !reiterOffen
            inhalt?.classList.toggle('show', reiterOffen)
            inhalt?.classList.toggle('active', reiterOffen)
            knopf.classList.toggle('active', reiterOffen)
        } else {
            reiterOffen = true
            const vorher = document.querySelector(`#${artVorher}Nav-${nrVorher}`)
            vorher?.classList.remove('show', 'active')
            document.getElementById(idPrevious.value)?.classList.remove('active')
        }
    })
}

function reiterDashboard(knopf) {
    knopf.addEventListener('shown.bs.tab', async (ereignis) => {
        selectedDashTab.value = ereignis.target.id
        speichere('selectedDashTab', ereignis.target.id)
        renderData.value += 1
        await nextTick()
        ;(await ladeDiagramme()).useECharts('init')
    })
}

export function useInitTab(art) {
    idCurrent.value = undefined
    idPrevious.value = undefined
    reiterOffen = false
    for (const knopf of document.querySelectorAll('#nav-tab button')) {
        if (art === 'dashboard') reiterDashboard(knopf)
        else if (art === 'daily') reiterDaily(knopf)
    }
}

// ── Popover (Löschen bestätigen) und Tooltip ───────────────────────────────

async function loeschenAusfuehren() {
    if (pageId.value === 'screenshots' || pageId.value === 'daily') {
        await useDeleteScreenshot()
    } else if (pageId.value === 'imports') {
        await useDeleteTrade()
        await useDeleteExcursions()
    }
}

let popoverKlickRegistriert = false
let geklickterKnopf = null

export function useInitPopover() {
    const bs = bootstrap()
    if (bs?.Popover) {
        for (const el of document.querySelectorAll('[data-bs-toggle="popover"]')) {
            if (!bs.Popover.getInstance(el)) new bs.Popover(el)
        }
    } else {
        console.warn('Bootstrap-Popover nicht verfügbar')
    }
    if (popoverKlickRegistriert) return
    popoverKlickRegistriert = true
    document.addEventListener('click', async (ereignis) => {
        const ziel = ereignis.target
        const pop = bootstrap()?.Popover
        const loeschKnopf = ziel?.closest?.('.popoverDelete')
        if (loeschKnopf) {
            geklickterKnopf = loeschKnopf
            if (!pop) {
                if (confirm(t('messages.confirmDelete'))) await loeschenAusfuehren()
                else selectedItem.value = null
            } else {
                for (const anderer of document.querySelectorAll('.popoverDelete')) {
                    if (anderer !== loeschKnopf) pop.getInstance(anderer)?.hide()
                }
            }
            return
        }
        const ja = ziel?.closest?.('.popoverYes')
        const nein = ziel?.closest?.('.popoverNo')
        if (!ja && !nein) return
        if (geklickterKnopf && pop) pop.getInstance(geklickterKnopf)?.hide()
        if (nein) selectedItem.value = null
        else await loeschenAusfuehren()
    })
}

export function useInitTooltip() {
    const bs = bootstrap()
    if (!bs?.Tooltip) return
    for (const el of document.querySelectorAll('[data-bs-toggle="tooltip"]')) new bs.Tooltip(el)
}

// ── Fenster, Seite, Menü ───────────────────────────────────────────────────

export function useCheckIfWindowIsScrolled() {
    window.addEventListener('scroll', () => { windowIsScrolled.value = window.scrollY > 100 })
}

/** Routenname der aktuellen Seite (nur in `setup` aufrufen). */
export function usePageId() {
    pageId.value = useRoute().name
    return pageId.value
}

export function useScreenType() {
    const breite = window.innerWidth > 0 ? window.innerWidth : screen.width
    screenType.value = breite >= 992 ? 'computer' : 'mobile'
}

export function useEditItem(id) {
    sessionStorage.setItem('editItemId', id)
    if (pageId.value === 'entries') {
        window.location.href = '/addEntry'
    } else if (pageId.value === 'screenshots') {
        sessionStorage.setItem('screenshotsPagination', screenshotsPagination.value)
        sessionStorage.setItem('screenshotIdToEdit', id)
        window.location.href = '/addScreenshot'
    }
}

export function usePageRedirect(ziel) {
    if (ziel) window.location.href = '/' + ziel
    if (pageId.value === 'daily') window.location.href = '/daily'
}

export function useToggleMobileMenu() {
    document.getElementById('sideMenu')?.classList.toggle('toggleSideMenu')
    sideMenuMobileOut.value = !sideMenuMobileOut.value
}

export function useCloseMobileMenu() {
    if (!sideMenuMobileOut.value) return
    document.getElementById('sideMenu')?.classList.remove('toggleSideMenu')
    sideMenuMobileOut.value = false
}

export function returnToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' })
}

// ── Export ─────────────────────────────────────────────────────────────────

export async function useExport(art, name, zusatz, daten) {
    const dateiname = zusatz != null ? `${name}_${zusatz}` : name
    let inhalt, typ, endung
    if (art === 'json') {
        inhalt = JSON.stringify(daten, null, 2)
        typ = 'application/json'
        endung = '.json'
    } else if (art === 'csv') {
        const spalten = Object.keys(daten[0] || {})
        const zeilen = [spalten.join(';'), ...daten.map(o => spalten.map(s => o[s]).join(';'))]
        inhalt = zeilen.join('\n')
        typ = 'text/csv'
        endung = '.csv'
    } else {
        return
    }
    const url = URL.createObjectURL(new Blob([inhalt], { type: typ }))
    const link = document.createElement('a')
    link.href = url
    link.download = dateiname + endung
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
}
