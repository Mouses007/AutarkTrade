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

// F3-NEUBAU: Tag-Katalog, Tag-Info, Tag-Zuordnung eines Trades, Speichern von
// Tags, Notiz und Tageszufriedenheit — docs/spec/f3-tags.md, f3-trade-dialog.md
