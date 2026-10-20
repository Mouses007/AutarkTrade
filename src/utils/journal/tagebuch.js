/**
 * Begleitdaten der Trades: Zufriedenheit, Exkursionen, Tags, Tag-Katalog und
 * Notizen laden (Spezifikation §4.3, docs/spec/f3-tags.md §3) und Tag-Angaben
 * aus dem Katalog nachschlagen (f3-tags.md §4.1). Geschrieben werden Tags und
 * Zufriedenheit hier nicht — das tun Incoming, Playbook und die Einstellungen
 * mit eigenem Code.
 */
import dayjs from './zeit.js'
import { dbFind, dbGetSettings } from '../db.js'
import { seitenId, abfrageGrenze } from '../../stores/app/rahmen.js'
import { gewaehlterBereich, tageZurueck } from '../../stores/journal/filter.js'
import {
    excursions, zufriedenheitTage, zufriedenheitTrades, tags, verfuegbareTags, notes, auswertungNotes,
} from '../../stores/journal/tagebuch.js'
import { istGanzerZeitraum } from './hilfen.js'

/** Farbe, wenn der Katalog leer ist (zugleich die Farbe der Auffanggruppe `group_0`). */
const ERSATZ_FARBE = '#6c757d'

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

// ── Tag-Angaben ────────────────────────────────────────────────────────────

/**
 * Was der Katalog über eine Tag-ID weiss (docs/spec/f3-tags.md §4.1): die
 * Gruppen werden der Reihe nach durchsucht, der erste Treffer gilt.
 *
 * Ohne Treffer: Farbe der ERSTEN Gruppe (leerer Katalog → `#6c757d`), Name
 * leer, `gruppeId`/`gruppeName` undefiniert — so landet es auch in den
 * Trade-Objekten der Tag-Gruppierung (Golden Master). Synchron, ohne Netz.
 *
 * @returns {{ gruppeId: string|undefined, gruppeName: string|undefined, farbe: string, name: string }}
 */
export function tagAngaben(tagId) {
    for (const gruppe of verfuegbareTags) {
        const treffer = (Array.isArray(gruppe.tags) ? gruppe.tags : []).find(x => x.id === tagId)
        if (treffer) return { gruppeId: gruppe.id, gruppeName: gruppe.name, farbe: gruppe.color, name: treffer.name }
    }
    return { gruppeId: undefined, gruppeName: undefined, farbe: verfuegbareTags[0]?.color ?? ERSATZ_FARBE, name: '' }
}

/**
 * Tags eines Trades als `{id, name}` (f3-trade-dialog.md §5.2 Schritt 9):
 * Zuordnung mit `tradeId` == Trade-ID (lose: Zahl und Text), jede ID einmal,
 * unbekannte IDs fallen weg. Tages-Tags (Zuordnung über den Tag) zählen nicht.
 */
export function tagsFuerTrade(tradeId) {
    const zuordnung = tags.find(z => z.tradeId == tradeId)
    const aus = []
    for (const id of Array.isArray(zuordnung?.tags) ? zuordnung.tags : []) {
        if (aus.some(x => x.id === id)) continue
        for (const gruppe of verfuegbareTags) {
            const treffer = (Array.isArray(gruppe.tags) ? gruppe.tags : []).find(x => x.id === id)
            if (treffer) { aus.push({ id: treffer.id, name: treffer.name }); break }
        }
    }
    return aus
}
