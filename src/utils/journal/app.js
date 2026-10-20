/**
 * App-Start und Seitenhilfen: Einstellungen laden, Zeitzone, Perioden,
 * Vorgaben aus localStorage, mobiles Menü, Export (Spezifikation
 * journal-kern.md §4.8). Reiter, Popover und Tooltips liefen über
 * Bootstrap-JS; seit S9 steuern die Ansichten ihre Reiter selbst, Löschen
 * bestätigt jede Ansicht selbst und Erklärungen hängen an `InfoTipp.vue`.
 */
import { useRoute } from 'vue-router'
import dayjs from './zeit.js'
import i18n from '../../i18n/index.js'
import { dbGetSettings } from '../db.js'
import {
    seitenId, appEinstellungen, tradeZeitzone, seitenmenueMobilOffen, bildschirmTyp, istGescrollt,
} from '../../stores/app/rahmen.js'
import { apis } from '../../stores/app/einstellungen.js'
import {
    zeitraumListe, dashReiter, gewaehlterZeitraum, gewaehlteRichtungen, gewaehlterZeitrahmen, gewaehlteKennzahl,
    gewaehltesKonto, gewaehltBruttoNetto, gewaehltPlOderZufriedenheit, gewaehlteBoerse, datumsBereich, gewaehlterMonat,
    selectedMonthPreset, gewaehlteKonten, betragArt, tagAuswahl, selectedTradeTimeframes,
} from '../../stores/journal/filter.js'
import { tags, verfuegbareTags } from '../../stores/journal/tagebuch.js'
import { ladeTags, ladeVerfuegbareTags } from './tagebuch.js'

const t = (k) => i18n.global.t(k)

function speichere(schluessel, wert) {
    try { localStorage.setItem(schluessel, wert) } catch { /* egal */ }
}
const lies = (schluessel) => { try { return localStorage.getItem(schluessel) } catch { return null } }

// ── Einstellungen und Zeitzone ─────────────────────────────────────────────

export async function starteApp() {
    try {
        const einstellungen = await dbGetSettings()
        appEinstellungen.value = einstellungen
        speichere('startseiteAn', Number(einstellungen?.startseiteAn ?? 1) === 1 ? '1' : '0')
        if (Array.isArray(einstellungen?.tradeTimeframes)) {
            selectedTradeTimeframes.length = 0
            for (const tf of einstellungen.tradeTimeframes) selectedTradeTimeframes.push(tf)
        }
    } catch (e) {
        console.warn('Einstellungen nicht lesbar:', e)
        appEinstellungen.value = {}
    }
}

export async function holeEinstellungen() {
    try { appEinstellungen.value = await dbGetSettings() } catch { appEinstellungen.value = {} }
}
export const pruefeEinstellungen = () => holeEinstellungen()

export function leseZeitzone() {
    const u = appEinstellungen.value
    tradeZeitzone.value = u && Object.prototype.hasOwnProperty.call(u, 'timeZone') ? u.timeZone : 'America/New_York'
}

export async function ladeApis() {
    const einstellungen = await dbGetSettings()
    apis.length = 0
    for (const a of einstellungen?.apis || []) apis.push(a)
}

// ── Perioden ───────────────────────────────────────────────────────────────

/** Woche Montag 00:00 – Sonntag 23:59:59: die en-Woche (So–Sa) um einen Tag verschoben. */
const wochenAnfang = (d) => d.startOf('week').add(1, 'day')
const wochenEnde = (d) => d.endOf('week').add(1, 'day')

export async function ladeZeitraeume() {
    const jetzt = dayjs().tz(tradeZeitzone.value)
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
    zeitraumListe.length = 0
    for (const [value, label, start, end] of eintraege) {
        zeitraumListe.push({ value, label: t(`options.${label}`), start: sek(start), end: sek(end) })
    }
}

// ── Vorgaben aus localStorage ──────────────────────────────────────────────

const periode = (wert) => zeitraumListe.find(p => p.value === wert)
const bereichVon = (p) => ({ start: p.start, end: p.end })

export async function setzeFilterwerte() {
    if (lies('at.journal.dashReiter') === null) speichere('at.journal.dashReiter', 'overviewTab')
    dashReiter.value = lies('at.journal.dashReiter')

    if (lies('at.journal.richtungen') === null) speichere('at.journal.richtungen', 'long,short')
    gewaehlteRichtungen.value = lies('at.journal.richtungen').split(',')

    if (lies('at.journal.zeitrahmen') === null) speichere('at.journal.zeitrahmen', 'daily')
    gewaehlterZeitrahmen.value = lies('at.journal.zeitrahmen')

    const ratio = lies('at.journal.kennzahl')
    if (ratio === null || ratio === 'apps') speichere('at.journal.kennzahl', 'appt')
    gewaehlteKennzahl.value = lies('at.journal.kennzahl')

    if (lies('at.journal.konto') === null) speichere('at.journal.konto', 'all')
    gewaehltesKonto.value = lies('at.journal.konto')

    if (lies('at.journal.bruttoNetto') === null) speichere('at.journal.bruttoNetto', 'gross')
    gewaehltBruttoNetto.value = lies('at.journal.bruttoNetto')

    if (lies('at.journal.plZufriedenheit') === null) speichere('at.journal.plZufriedenheit', 'pl')
    gewaehltPlOderZufriedenheit.value = lies('at.journal.plZufriedenheit')

    if (lies('at.journal.boerse') === null) speichere('at.journal.boerse', 'bitunix')
    gewaehlteBoerse.value = lies('at.journal.boerse')

    if (lies('at.journal.datumsBereich') === null) speichere('at.journal.datumsBereich', JSON.stringify(bereichVon(periode('thisYear'))))
    datumsBereich.value = JSON.parse(lies('at.journal.datumsBereich'))

    if (lies('at.journal.zeitraum') === null) {
        const r = datumsBereich.value
        const passend = zeitraumListe.find(p => p.start === r.start && p.end === r.end) || periode('custom')
        speichere('at.journal.zeitraum', JSON.stringify(passend))
    }
    gewaehlterZeitraum.value = JSON.parse(lies('at.journal.zeitraum'))

    const art = gewaehlterZeitraum.value?.value
    if (art === 'all' && !(datumsBereich.value.start === 0 && datumsBereich.value.end === 0)) {
        datumsBereich.value = { start: 0, end: 0 }
        speichere('at.journal.datumsBereich', JSON.stringify(datumsBereich.value))
    }
    if (art !== 'custom' && art !== 'all') {
        // Eine Periode wie „dieser Monat" wandert mit der Zeit — frisch berechnen.
        const frisch = periode(art)
        if (frisch && (frisch.start !== gewaehlterZeitraum.value.start || frisch.end !== gewaehlterZeitraum.value.end)) {
            gewaehlterZeitraum.value = { ...frisch }
            datumsBereich.value = bereichVon(frisch)
            speichere('at.journal.zeitraum', JSON.stringify(gewaehlterZeitraum.value))
            speichere('at.journal.datumsBereich', JSON.stringify(datumsBereich.value))
        }
    }

    if (lies('at.journal.monat') === null) speichere('at.journal.monat', JSON.stringify(bereichVon(periode('thisMonth'))))
    gewaehlterMonat.value = JSON.parse(lies('at.journal.monat'))

    if (lies('selectedMonthPreset') === null) speichere('selectedMonthPreset', 'current')
    selectedMonthPreset.value = lies('selectedMonthPreset')
    if (selectedMonthPreset.value === 'current') {
        const monat = periode('thisMonth')
        if (monat && (monat.start !== gewaehlterMonat.value?.start || monat.end !== gewaehlterMonat.value?.end)) {
            gewaehlterMonat.value = bereichVon(monat)
            speichere('at.journal.monat', JSON.stringify(gewaehlterMonat.value))
        }
    }

    const konten = appEinstellungen.value?.accounts || []
    if (lies('at.journal.konten') === null && konten.length > 0) {
        speichere('at.journal.konten', konten.map(k => k.value).join(','))
        gewaehlteKonten.value = lies('at.journal.konten').split(',')
    }

    const tagIds = () => verfuegbareTags.flatMap(g => (g.tags || []).map(x => x.id))
    const gespeicherteTags = lies('at.journal.tags')
    if (gespeicherteTags === null) {
        await ladeTags()
        const neu = ['t000t']
        await ladeVerfuegbareTags()
        neu.push(...tagIds())
        tags.length = 0
        tagAuswahl.value = neu
        speichere('at.journal.tags', neu.join(','))
    } else {
        await ladeVerfuegbareTags()
        const liste = gespeicherteTags.split(',')
        let ergaenzt = false
        for (const id of tagIds()) if (!liste.includes(id)) { liste.push(id); ergaenzt = true }
        if (ergaenzt) {
            tagAuswahl.value = liste
            speichere('at.journal.tags', liste.join(','))
        }
    }

    betragArt.value = lies('at.journal.bruttoNetto')
}

// ── Fenster, Seite, Menü ───────────────────────────────────────────────────

export function pruefeGescrollt() {
    window.addEventListener('scroll', () => { istGescrollt.value = window.scrollY > 100 })
}

/** Routenname der aktuellen Seite (nur in `setup` aufrufen). */
export function setzeSeitenId() {
    seitenId.value = useRoute().name
    return seitenId.value
}

export function leseBildschirmTyp() {
    const breite = window.innerWidth > 0 ? window.innerWidth : screen.width
    bildschirmTyp.value = breite >= 992 ? 'computer' : 'mobile'
}

export function leiteWeiter(ziel) {
    if (ziel) window.location.href = '/' + ziel
    if (seitenId.value === 'tagesansicht') window.location.href = '/tagesansicht'
}

export function schalteMobilMenue() {
    document.getElementById('sideMenu')?.classList.toggle('toggleSideMenu')
    seitenmenueMobilOffen.value = !seitenmenueMobilOffen.value
}

export function schliesseMobilMenue() {
    if (!seitenmenueMobilOffen.value) return
    document.getElementById('sideMenu')?.classList.remove('toggleSideMenu')
    seitenmenueMobilOffen.value = false
}

export function scrolleNachOben() {
    window.scrollTo({ top: 0, behavior: 'smooth' })
}

// ── Export ─────────────────────────────────────────────────────────────────

export async function exportiereDaten(art, name, zusatz, daten) {
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
