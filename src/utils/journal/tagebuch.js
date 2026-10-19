/**
 * Begleitdaten der Trades: Zufriedenheit, Exkursionen, Tags, Tag-Katalog und
 * Notizen — laden und in der Tagesansicht bearbeiten (Spezifikation §4.3).
 */
import dayjs from './zeit.js'
import { dbFind, dbFirst, dbCreate, dbUpdate, dbGetSettings, dbUpdateSettings } from '../db.js'
import { pageId, queryLimit, saveButton } from '../../stores/app/rahmen.js'
import { spinnerSetups, spinnerSetupsText } from '../../stores/app/laden.js'
import { selectedRange, selectedTagIndex, filteredSuggestions, daysBack } from '../../stores/journal/filter.js'
import { filteredTrades } from '../../stores/journal/auswertung.js'
import { screenshot } from '../../stores/journal/screenshots.js'
import {
    excursions, satisfactionArray, satisfactionTradeArray, tags, availableTags, availableTagsArray,
    tradeTags, newTradeTags, tradeTagsChanged, tradeTagsDateUnix, tradeTagsId, tagInput, showTagsList,
    notes, auswertungNotes, tradeNote, tradeNoteDateUnix, tradeNoteId, itemTradeIndex, tradeIndex,
} from '../../stores/journal/tagebuch.js'
import { istGanzerZeitraum } from './hilfen.js'

const UNGRUPPIERT_FARBE = '#6c757d'

/** Zeitfenster `selectedRange` als Abfrage-Bedingung (ohne {0,0}-Sonderfall). */
function imBereich() {
    const r = selectedRange.value
    return { greaterThanOrEqualTo: { dateUnix: r.start }, lessThan: { dateUnix: r.end } }
}
/** Dasselbe, aber `{0,0}` heisst „ohne Zeitfilter". */
const imBereichAusserAlles = () => (istGanzerZeitraum(selectedRange.value) ? {} : imBereich())

// ── Laden ──────────────────────────────────────────────────────────────────

export async function useGetSatisfactions() {
    satisfactionTradeArray.length = 0
    satisfactionArray.length = 0
    const zeilen = await dbFind('satisfactions', { descending: 'dateUnix', ...imBereichAusserAlles(), limit: queryLimit.value })
    for (const z of zeilen) {
        const eintrag = { tradeId: z.tradeId, satisfaction: z.satisfaction, dateUnix: z.dateUnix }
        if (z.tradeId !== undefined && z.tradeId !== null && z.tradeId !== '') satisfactionTradeArray.push(eintrag)
        else satisfactionArray.push(eintrag)
    }
}

export async function useGetExcursions() {
    const abfrage = pageId.value === 'addExcursions'
        ? { ascending: 'dateUnix', greaterThanOrEqualTo: { dateUnix: dayjs().subtract(daysBack.value, 'day').unix() }, lessThan: { dateUnix: dayjs().unix() } }
        : { ascending: 'dateUnix', ...imBereichAusserAlles(), limit: queryLimit.value }
    const zeilen = await dbFind('excursions', abfrage)
    excursions.length = 0
    for (const z of zeilen) excursions.push(z)
}

export async function useGetTags() {
    tags.length = 0
    const abfrage = { limit: queryLimit.value, ...(pageId.value === 'daily' ? imBereich() : {}) }
    const zeilen = await dbFind('tags', abfrage)
    for (const z of zeilen) tags.push({ tradeId: z.tradeId, tags: z.tags, dateUnix: z.dateUnix })
}

let katalogLaeuft = null
/** Tag-Katalog aus den Einstellungen; parallele Aufrufe teilen sich einen Lauf. */
export function useGetAvailableTags() {
    if (katalogLaeuft) return katalogLaeuft
    katalogLaeuft = (async () => {
        try {
            const einstellungen = await dbGetSettings()
            availableTags.length = 0
            const gruppen = einstellungen?.tags
            if (Array.isArray(gruppen) && gruppen.length > 0) for (const g of gruppen) availableTags.push(g)
        } finally {
            katalogLaeuft = null
        }
    })()
    return katalogLaeuft
}

export async function useGetNotes() {
    notes.length = 0
    const zeilen = await dbFind('notes', { ...imBereich(), limit: queryLimit.value })
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
    const zeilen = await dbFind('notes', { ...imBereichAusserAlles(), limit: queryLimit.value })
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

const alleTags = () => availableTags.flatMap(g => g.tags || [])
const beginntMit = (tag, eingabe) => String(tag.name).toLowerCase().startsWith(String(eingabe).toLowerCase())

/** Gruppe und Name eines Tags; unbekannt → nur Farbe und leerer Name. */
export function useGetTagInfo(tagId) {
    for (const gruppe of availableTags) {
        const tag = (gruppe.tags || []).find(x => x.id === tagId)
        if (tag) return { tagGroupId: gruppe.id, tagGroupName: gruppe.name, groupColor: gruppe.color, tagName: tag.name }
    }
    return { groupColor: availableTags[0]?.color || UNGRUPPIERT_FARBE, tagName: '' }
}

export function useCreateAvailableTagsArray() {
    availableTagsArray.length = 0
    for (const tag of alleTags()) availableTagsArray.push(tag)
}

export function useFilterSuggestions(gruppenId) {
    const gruppe = availableTags.find(g => g.id == gruppenId)
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
    tradeTagsChanged.value = true
    saveButton.value = true
    if (eingabeLeeren) tagInput.value = ''
}

export async function useTradeTagsChange(art, wert) {
    if (art === 'add') {
        if (selectedTagIndex.value !== -1) {
            const vorschlag = filteredSuggestions[selectedTagIndex.value]
            if (vorschlag) haengeTagAn(vorschlag, true)
        } else if (wert) {
            const name = String(wert).toLowerCase()
            const schonDa = tradeTags.some(x => String(x.name).toLowerCase() === name)
            const bekannt = availableTagsArray.find(x => String(x.name).toLowerCase() === name)
            if (schonDa) {
                // nichts zu tun
            } else if (bekannt) {
                haengeTagAn(bekannt, false)
            } else {
                const nummer = Math.max(useFindHighestIdNumber(availableTags), useFindHighestIdNumberTradeTags(tradeTags)) + 1
                const neu = { id: 'tag_' + nummer, name: wert }
                tradeTags.push(neu)
                newTradeTags.push(neu)
                tradeTagsChanged.value = true
                saveButton.value = true
                tagInput.value = ''
            }
        }
        selectedTagIndex.value = -1
        showTagsList.value = ''
    } else if (art === 'addFromDropdownMenu') {
        if (!tradeTags.some(x => x.id === wert.id)) haengeTagAn(wert, true)
        selectedTagIndex.value = -1
        showTagsList.value = ''
    } else if (art === 'remove') {
        tradeTags.splice(wert, 1)
        tradeTagsChanged.value = true
        saveButton.value = true
    }

    if (pageId.value !== 'daily') return
    const tag = filteredTrades[itemTradeIndex.value]
    if (!tag) return
    tradeTagsDateUnix.value = tag.dateUnix
    tradeTagsId.value = tradeIndex.value !== undefined ? (tag.trades[tradeIndex.value]?.id ?? null) : null
}

export function useFilterTags() {
    if (tagInput.value === '') selectedTagIndex.value = -1
    const vorschlaege = alleTags().filter(tag => beginntMit(tag, tagInput.value))
    filteredSuggestions.length = 0
    for (const v of vorschlaege) filteredSuggestions.push(v)
    showTagsList.value = tagInput.value !== '' && vorschlaege.length > 0 ? pageId.value : ''
}

export function useToggleTagsDropdown() {
    selectedTagIndex.value = -1
    if (showTagsList.value === '') {
        showTagsList.value = pageId.value
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
export async function useUpdateTags() {
    spinnerSetups.value = true
    const ids = tradeTags.map(x => x.id)
    const beimScreenshot = pageId.value === 'addScreenshot'
    const schluessel = beimScreenshot ? screenshot.name : (tradeTagsId.value || String(tradeTagsDateUnix.value))
    const vorhanden = await dbFirst('tags', { equalTo: { tradeId: schluessel } })
    if (vorhanden) {
        spinnerSetupsText.value = 'Updating'
        await dbUpdate('tags', vorhanden.objectId, { tags: ids })
    } else {
        spinnerSetupsText.value = 'Saving'
        await dbCreate('tags', beimScreenshot
            ? { tags: ids, dateUnix: screenshot.dateUnix, tradeId: screenshot.name }
            : { tags: ids, dateUnix: tradeTagsDateUnix.value, tradeId: tradeTagsId.value || String(tradeTagsDateUnix.value) })
    }
}

/** Neue Tags in die Gruppe „Ungrouped" (group_0) des Katalogs übernehmen. */
export async function useUpdateAvailableTags() {
    const einstellungen = await dbGetSettings()
    let katalog = einstellungen?.tags
    const tagKopie = (x) => ({ ...x })
    if (!(Array.isArray(katalog) && katalog.length > 0)) {
        katalog = [{ id: 'group_0', name: 'Ungrouped', color: UNGRUPPIERT_FARBE, tags: tradeTags.map(tagKopie) }]
    } else {
        const ungruppiert = katalog.find(g => g.id === 'group_0')
        const quelle = pageId.value === 'registerSignup' ? tradeTags : newTradeTags
        for (const tag of quelle) {
            // fehlt group_0, wirft der Zugriff — wie bisher
            if (!ungruppiert.tags.some(x => x.id === tag.id)) ungruppiert.tags.push(tagKopie(tag))
        }
    }
    await dbUpdateSettings({ tags: katalog })
}

// ── Notizen und Zufriedenheit ──────────────────────────────────────────────

export async function useUpdateNote() {
    spinnerSetups.value = true
    const vorhanden = await dbFirst('notes', { equalTo: { tradeId: tradeNoteId.value } })
    if (vorhanden) {
        spinnerSetupsText.value = 'Updating'
        await dbUpdate('notes', vorhanden.objectId, { note: tradeNote.value })
    } else {
        spinnerSetupsText.value = 'Saving'
        await dbCreate('notes', { note: tradeNote.value, dateUnix: tradeNoteDateUnix.value, tradeId: tradeNoteId.value })
    }
}

export async function useDailySatisfactionChange(dateUnix, wert, objekt) {
    if (objekt) {
        objekt.satisfaction = wert
    } else {
        const eintrag = satisfactionArray.find(x => x.dateUnix == dateUnix)
        if (eintrag) eintrag.satisfaction = wert
        else satisfactionArray.push({ dateUnix, satisfaction: wert })
    }
    await useUpdateDailySatisfaction(dateUnix, wert)
}

export async function useUpdateDailySatisfaction(dateUnix, wert) {
    const zeilen = await dbFind('satisfactions', { equalTo: { dateUnix }, doesNotExist: 'tradeId' })
    if (zeilen.length > 0) await dbUpdate('satisfactions', zeilen[0].objectId, { satisfaction: wert })
    else await dbCreate('satisfactions', { dateUnix, satisfaction: wert })
}
