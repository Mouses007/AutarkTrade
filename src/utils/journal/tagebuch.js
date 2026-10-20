/**
 * Begleitdaten der Trades: Zufriedenheit, Exkursionen, Tags, Tag-Katalog und
 * Notizen — laden und in der Tagesansicht bearbeiten (Spezifikation §4.3).
 */
import dayjs from './zeit.js'
import { dbFind, dbFirst, dbCreate, dbUpdate, dbGetSettings, dbUpdateSettings } from '../db.js'
import { seitenId, abfrageGrenze, speichernNoetig } from '../../stores/app/rahmen.js'
import { setupsLaden, setupsLadeText } from '../../stores/app/laden.js'
import { gewaehlterBereich, gewaehlterTagIndex, filteredSuggestions, tageZurueck } from '../../stores/journal/filter.js'
import { journalTage } from '../../stores/journal/auswertung.js'
import { screenshot } from '../../stores/journal/screenshots.js'
import {
    excursions, zufriedenheitTage, zufriedenheitTrades, tags, verfuegbareTags, verfuegbareTagListe,
    tradeTags, neueTradeTags, tradeTagsGeaendert, tradeTagsDateUnix, tradeTagsId, tagInput, showTagsList,
    notes, auswertungNotes, tradeNotiz, notizTagUnix, notizTradeId, offenerTagIndex, tradeIndexAktiv,
} from '../../stores/journal/tagebuch.js'
import { istGanzerZeitraum } from './hilfen.js'

const UNGRUPPIERT_FARBE = '#6c757d'

/** Zeitfenster `gewaehlterBereich` als Abfrage-Bedingung (ohne {0,0}-Sonderfall). */
function imBereich() {
    const r = gewaehlterBereich.value
    return { greaterThanOrEqualTo: { dateUnix: r.start }, lessThan: { dateUnix: r.end } }
}
/** Dasselbe, aber `{0,0}` heisst „ohne Zeitfilter". */
const imBereichAusserAlles = () => (istGanzerZeitraum(gewaehlterBereich.value) ? {} : imBereich())

// ── Laden ──────────────────────────────────────────────────────────────────

export async function ladeZufriedenheit() {
    zufriedenheitTrades.length = 0
    zufriedenheitTage.length = 0
    const zeilen = await dbFind('satisfactions', { descending: 'dateUnix', ...imBereichAusserAlles(), limit: abfrageGrenze.value })
    for (const z of zeilen) {
        const eintrag = { tradeId: z.tradeId, satisfaction: z.satisfaction, dateUnix: z.dateUnix }
        if (z.tradeId !== undefined && z.tradeId !== null && z.tradeId !== '') zufriedenheitTrades.push(eintrag)
        else zufriedenheitTage.push(eintrag)
    }
}

export async function ladeExkursionen() {
    const abfrage = seitenId.value === 'exkursionen'
        ? { ascending: 'dateUnix', greaterThanOrEqualTo: { dateUnix: dayjs().subtract(tageZurueck.value, 'day').unix() }, lessThan: { dateUnix: dayjs().unix() } }
        : { ascending: 'dateUnix', ...imBereichAusserAlles(), limit: abfrageGrenze.value }
    const zeilen = await dbFind('excursions', abfrage)
    excursions.length = 0
    for (const z of zeilen) excursions.push(z)
}

export async function ladeTags() {
    tags.length = 0
    const abfrage = { limit: abfrageGrenze.value, ...(seitenId.value === 'tagesansicht' ? imBereich() : {}) }
    const zeilen = await dbFind('tags', abfrage)
    for (const z of zeilen) tags.push({ tradeId: z.tradeId, tags: z.tags, dateUnix: z.dateUnix })
}

let katalogLaeuft = null
/** Tag-Katalog aus den Einstellungen; parallele Aufrufe teilen sich einen Lauf. */
export function ladeVerfuegbareTags() {
    if (katalogLaeuft) return katalogLaeuft
    katalogLaeuft = (async () => {
        try {
            const einstellungen = await dbGetSettings()
            verfuegbareTags.length = 0
            const gruppen = einstellungen?.tags
            if (Array.isArray(gruppen) && gruppen.length > 0) for (const g of gruppen) verfuegbareTags.push(g)
        } finally {
            katalogLaeuft = null
        }
    })()
    return katalogLaeuft
}

export async function ladeNotizen() {
    notes.length = 0
    const zeilen = await dbFind('notes', { ...imBereich(), limit: abfrageGrenze.value })
    for (const z of zeilen) {
        notes.push({
            tradeId: z.tradeId, note: z.note, dateUnix: z.dateUnix,
            tradingMetadata: z.tradingMetadata || null,
            tradeType: z.tradeType || '',
            closingTradeType: z.closingTradeType || '',
        })
    }
}

export async function useGetAuswertungNotes() {
    auswertungNotes.length = 0
    const zeilen = await dbFind('notes', { ...imBereichAusserAlles(), limit: abfrageGrenze.value })
    for (const z of zeilen) {
        auswertungNotes.push({
            tradeId: z.tradeId, dateUnix: z.dateUnix, note: z.note,
            entryStressLevel: z.entryStressLevel || 0,
            emotionLevel: z.emotionLevel || 0,
            feelings: z.feelings || '',
            playbook: z.playbook || '',
            timeframe: z.timeframe || '',
            entryNote: z.entryNote || '',
        })
    }
}

// ── Tag-Katalog ────────────────────────────────────────────────────────────

const alleTags = () => verfuegbareTags.flatMap(g => g.tags || [])
const beginntMit = (tag, eingabe) => String(tag.name).toLowerCase().startsWith(String(eingabe).toLowerCase())

/** Gruppe und Name eines Tags; unbekannt → nur Farbe und leerer Name. */
export function useGetTagInfo(tagId) {
    for (const gruppe of verfuegbareTags) {
        const tag = (gruppe.tags || []).find(x => x.id === tagId)
        if (tag) return { tagGroupId: gruppe.id, tagGroupName: gruppe.name, groupColor: gruppe.color, tagName: tag.name }
    }
    return { groupColor: verfuegbareTags[0]?.color || UNGRUPPIERT_FARBE, tagName: '' }
}

export function baueTagListe() {
    verfuegbareTagListe.length = 0
    for (const tag of alleTags()) verfuegbareTagListe.push(tag)
}

export function useFilterSuggestions(gruppenId) {
    const gruppe = verfuegbareTags.find(g => g.id == gruppenId)
    if (!gruppe) return []
    return [{ id: gruppenId, tags: (gruppe.tags || []).filter(tag => beginntMit(tag, tagInput.value)) }]
}

/** Höchste Nummer hinter „tag_" im Katalog (leer → 0). */
export function useFindHighestIdNumber(gruppen) {
    if (!gruppen || gruppen.length === 0) return 0
    return hoechsteNummer(gruppen.flatMap(g => g.tags || []))
}

/** Dasselbe für eine flache Tag-Liste. */
export function useFindHighestIdNumberTradeTags(liste) {
    if (!liste || liste.length === 0) return 0
    return hoechsteNummer(liste)
}

function hoechsteNummer(liste) {
    let max = -Infinity
    for (const tag of liste) {
        const n = Number(String(tag.id).replace(/^tag_/, ''))
        if (n > max) max = n
    }
    return max
}

function haengeTagAn(tag, eingabeLeeren) {
    if (!tradeTags.some(x => x.id === tag.id)) tradeTags.push(tag)
    tradeTagsGeaendert.value = true
    speichernNoetig.value = true
    if (eingabeLeeren) tagInput.value = ''
}

export async function useTradeTagsChange(art, wert) {
    if (art === 'add') {
        if (gewaehlterTagIndex.value !== -1) {
            const vorschlag = filteredSuggestions[gewaehlterTagIndex.value]
            if (vorschlag) haengeTagAn(vorschlag, true)
        } else if (wert) {
            const name = String(wert).toLowerCase()
            const schonDa = tradeTags.some(x => String(x.name).toLowerCase() === name)
            const bekannt = verfuegbareTagListe.find(x => String(x.name).toLowerCase() === name)
            if (schonDa) {
                // nichts zu tun
            } else if (bekannt) {
                haengeTagAn(bekannt, false)
            } else {
                const nummer = Math.max(useFindHighestIdNumber(verfuegbareTags), useFindHighestIdNumberTradeTags(tradeTags)) + 1
                const neu = { id: 'tag_' + nummer, name: wert }
                tradeTags.push(neu)
                neueTradeTags.push(neu)
                tradeTagsGeaendert.value = true
                speichernNoetig.value = true
                tagInput.value = ''
            }
        }
        gewaehlterTagIndex.value = -1
        showTagsList.value = ''
    } else if (art === 'addFromDropdownMenu') {
        if (!tradeTags.some(x => x.id === wert.id)) haengeTagAn(wert, true)
        gewaehlterTagIndex.value = -1
        showTagsList.value = ''
    } else if (art === 'remove') {
        tradeTags.splice(wert, 1)
        tradeTagsGeaendert.value = true
        speichernNoetig.value = true
    }

    if (seitenId.value !== 'tagesansicht') return
    const tag = journalTage[offenerTagIndex.value]
    if (!tag) return
    tradeTagsDateUnix.value = tag.dateUnix
    tradeTagsId.value = tradeIndexAktiv.value !== undefined ? (tag.trades[tradeIndexAktiv.value]?.id ?? null) : null
}

export function useFilterTags() {
    if (tagInput.value === '') gewaehlterTagIndex.value = -1
    const vorschlaege = alleTags().filter(tag => beginntMit(tag, tagInput.value))
    filteredSuggestions.length = 0
    for (const v of vorschlaege) filteredSuggestions.push(v)
    showTagsList.value = tagInput.value !== '' && vorschlaege.length > 0 ? seitenId.value : ''
}

export function useToggleTagsDropdown() {
    gewaehlterTagIndex.value = -1
    if (showTagsList.value === '') {
        showTagsList.value = seitenId.value
        filteredSuggestions.length = 0
        for (const v of alleTags()) filteredSuggestions.push(v)
    } else {
        showTagsList.value = ''
    }
}

export function useResetTags() {
    tradeTags.length = 0
}

/** Speichert die Tags des Trades (oder Tages, oder Screenshots). */
export async function speichereTags() {
    setupsLaden.value = true
    const ids = tradeTags.map(x => x.id)
    const beimScreenshot = seitenId.value === 'addScreenshot'
    const schluessel = beimScreenshot ? screenshot.name : (tradeTagsId.value || String(tradeTagsDateUnix.value))
    const vorhanden = await dbFirst('tags', { equalTo: { tradeId: schluessel } })
    if (vorhanden) {
        setupsLadeText.value = 'Updating'
        await dbUpdate('tags', vorhanden.objectId, { tags: ids })
    } else {
        setupsLadeText.value = 'Saving'
        await dbCreate('tags', beimScreenshot
            ? { tags: ids, dateUnix: screenshot.dateUnix, tradeId: screenshot.name }
            : { tags: ids, dateUnix: tradeTagsDateUnix.value, tradeId: tradeTagsId.value || String(tradeTagsDateUnix.value) })
    }
}

/** Neue Tags in die Gruppe „Ungrouped" (group_0) des Katalogs übernehmen. */
export async function speichereVerfuegbareTags() {
    const einstellungen = await dbGetSettings()
    let katalog = einstellungen?.tags
    const tagKopie = (x) => ({ ...x })
    if (!(Array.isArray(katalog) && katalog.length > 0)) {
        katalog = [{ id: 'group_0', name: 'Ungrouped', color: UNGRUPPIERT_FARBE, tags: tradeTags.map(tagKopie) }]
    } else {
        const ungruppiert = katalog.find(g => g.id === 'group_0')
        const quelle = seitenId.value === 'registerSignup' ? tradeTags : neueTradeTags
        for (const tag of quelle) {
            // fehlt group_0, wirft der Zugriff — wie bisher
            if (!ungruppiert.tags.some(x => x.id === tag.id)) ungruppiert.tags.push(tagKopie(tag))
        }
    }
    await dbUpdateSettings({ tags: katalog })
}

// ── Notizen und Zufriedenheit ──────────────────────────────────────────────

export async function speichereNotiz() {
    setupsLaden.value = true
    const vorhanden = await dbFirst('notes', { equalTo: { tradeId: notizTradeId.value } })
    if (vorhanden) {
        setupsLadeText.value = 'Updating'
        await dbUpdate('notes', vorhanden.objectId, { note: tradeNotiz.value })
    } else {
        setupsLadeText.value = 'Saving'
        await dbCreate('notes', { note: tradeNotiz.value, dateUnix: notizTagUnix.value, tradeId: notizTradeId.value })
    }
}

export async function useDailySatisfactionChange(dateUnix, wert, objekt) {
    if (objekt) {
        objekt.satisfaction = wert
    } else {
        const eintrag = zufriedenheitTage.find(x => x.dateUnix == dateUnix)
        if (eintrag) eintrag.satisfaction = wert
        else zufriedenheitTage.push({ dateUnix, satisfaction: wert })
    }
    await useUpdateDailySatisfaction(dateUnix, wert)
}

export async function useUpdateDailySatisfaction(dateUnix, wert) {
    const zeilen = await dbFind('satisfactions', { equalTo: { dateUnix }, doesNotExist: 'tradeId' })
    if (zeilen.length > 0) await dbUpdate('satisfactions', zeilen[0].objectId, { satisfaction: wert })
    else await dbCreate('satisfactions', { dateUnix, satisfaction: wert })
}
