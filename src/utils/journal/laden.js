/**
 * Tageszeilen laden, filtern und anreichern — der erste Schritt der
 * Journal-Kette (Spezifikation journal-kern.md §4.1).
 *
 * Ergebnis: `filteredTrades` (Tageskopien, absteigend), `filteredTradesDaily`
 * (dieselben Objekte in Ladereihenfolge), `filteredTradesTrades` (flach),
 * dazu Blotter und P&L der gefilterten Trades.
 */
import axios from 'axios'
import dayjs from './zeit.js'
import i18n from '../../i18n/index.js'
import { dbFind, dbFirst, dbDelete, dbDeleteWhere } from '../db.js'
import { refreshAccountBalance } from '../../stores/accountBalance.js'
import { pageId, timeZoneTrade, queryLimit, hasData, dailyPagination, dailyQueryLimit, endOfList, selectedItem } from '../../stores/app/rahmen.js'
import { selectedRange, selectedPositions, selectedAccounts, selectedTags, selectedBroker, selectedTradeCategory, daysBack } from '../../stores/journal/filter.js'
import { filteredTrades, filteredTradesDaily, filteredTradesTrades, imports } from '../../stores/journal/auswertung.js'
import { pAndL, blotter } from '../../stores/journal/import.js'
import { tags, satisfactionArray, satisfactionTradeArray, excursions, availableTags } from '../../stores/journal/tagebuch.js'
import { baueNachschlag, erstelleFilter, reichereAn } from './filtern.js'
import { useCreateBlotter, useCreatePnL } from './tagesrechnung.js'
import { kette } from './kette.js'
import { istGanzerZeitraum } from './hilfen.js'

const t = (k) => i18n.global.t(k)
const OHNE_GROSSE_SPALTEN = ['executions', 'blotter', 'pAndL']
// Für den Trade-Typ genügen tradeId/dateUnix/tradeType — die Texte bleiben auf dem Server.
const NOTIZ_TEXTE = ['note', 'title', 'entryNote', 'feelings', 'playbook', 'closingNote', 'closingFeelings', 'closingPlaybook', 'tradingMetadata', 'aiReview', 'aiReviewProvider', 'aiReviewModel']

/** Abfrage der Tageszeilen je nach Seite. */
function tageszeilenAbfrage(param) {
    if (pageId.value === 'imports' || param === 'imports') {
        return { exclude: OHNE_GROSSE_SPALTEN, descending: 'dateUnix', limit: 20 }
    }
    if (pageId.value === 'addExcursions') {
        return {
            exclude: OHNE_GROSSE_SPALTEN,
            greaterThanOrEqualTo: { dateUnix: dayjs().subtract(daysBack.value, 'day').unix() },
            lessThan: { dateUnix: dayjs().unix() },
            ascending: 'dateUnix',
        }
    }
    const r = selectedRange.value
    if (istGanzerZeitraum(r)) return { exclude: OHNE_GROSSE_SPALTEN, ascending: 'dateUnix', limit: queryLimit.value }
    return {
        exclude: OHNE_GROSSE_SPALTEN,
        greaterThanOrEqualTo: { dateUnix: r.start },
        lessThan: { dateUnix: r.end },
        ascending: 'dateUnix',
        limit: queryLimit.value,
    }
}

/** Lädt Tageszeilen in den Kettenzustand und nach `imports`. */
export async function useGetTrades(param) {
    const zeilen = await dbFind('trades', tageszeilenAbfrage(param))
    if (zeilen.length > 0) {
        kette.tageszeilen = [...zeilen]
        imports.value = [...zeilen]
    } else {
        kette.tageszeilen = []
        imports.value = []
    }
}

/** Trade-Typen aus den Notizen im Zeitfenster der geladenen Tage. */
async function ladeTradeTypNotizen(zeilen) {
    const tage = zeilen.map(z => Number(z.dateUnix))
    const von = Math.min(...tage)
    const bis = Math.max(...tage)
    const abfrage = { exclude: NOTIZ_TEXTE }
    if (Number.isFinite(von) && Number.isFinite(bis)) {
        abfrage.greaterThanOrEqualTo = { dateUnix: von }
        abfrage.lessThanOrEqualTo = { dateUnix: bis }
    }
    return dbFind('notes', abfrage)
}

/** Tageskopie ohne Trades/P&L/Blotter, mit Tag/Monat/Jahr in der Handelszeitzone. */
function tageskopie(zeile, n) {
    const { trades: _t, pAndL: _p, blotter: _b, ...kopf } = zeile
    const tag = dayjs.unix(zeile.dateUnix).tz(timeZoneTrade.value)
    // Bewusster Altfehler §7.11: `date` wird zur Tageszahl, die DB-Zeichenkette geht verloren.
    const kopie = { ...kopf, date: tag.date(), month: tag.month(), year: tag.year(), trades: [] }
    if (pageId.value === 'daily') {
        const k = String(zeile.dateUnix)
        kopie.satisfaction = n.tagesZufriedenheit.has(k) ? n.tagesZufriedenheit.get(k) : null
    }
    return kopie
}

export async function useGetFilteredTrades(_param) {
    try {
        await useGetTrades()
        filteredTrades.length = 0
        filteredTradesDaily.length = 0
        filteredTradesTrades.length = 0

        const zeilen = kette.tageszeilen
        const n = baueNachschlag({
            tagZeilen: tags,
            tagesZufriedenheit: satisfactionArray,
            tradeZufriedenheit: satisfactionTradeArray,
            exkursionen: excursions,
            notizen: await ladeTradeTypNotizen(zeilen),
            katalog: availableTags,
        })
        // Bewusster Altfehler §7.9: nur auf true, nie zurück — auch wenn der Filter alles verwirft.
        if (zeilen.length > 0) hasData.value = true

        const gewaehlt = selectedTags.value
        const passt = erstelleFilter({
            boerse: selectedBroker.value,
            kategorie: selectedTradeCategory.value,
            bereich: selectedRange.value,
            richtungen: selectedPositions.value,
            konten: selectedAccounts.value,
            gewaehlteTags: gewaehlt,
        })

        for (const zeile of zeilen) {
            if (!zeile.trades) continue
            const kopie = tageskopie(zeile, n)
            for (const trade of zeile.trades) {
                if (!passt(trade, n)) continue
                const gefiltert = reichereAn(trade, n, gewaehlt)
                kopie.trades.push(gefiltert)
                filteredTradesTrades.push(gefiltert)
            }
            if (kopie.trades.length > 0) {
                filteredTrades.push(kopie)
                filteredTradesDaily.push(kopie)
            }
        }

        await useCreateBlotter(true)
        await useCreatePnL()

        // Bewusster Altfehler §7.2: bei mehreren Tageskopien mit gleichem
        // dateUnix (zwei Börsen am selben Tag) bekommt nur die LETZTE P&L und
        // Blotter, obwohl beide über alle Trades des Tages gerechnet sind.
        for (const td of Object.keys(pAndL)) {
            const ziel = filteredTradesDaily.findLast(d => String(d.dateUnix) === td)
            if (!ziel) continue
            ziel.pAndL = pAndL[td]
            ziel.blotter = blotter[td]
        }

        filteredTrades.sort((a, b) => b.dateUnix - a.dateUnix)
    } catch (fehler) {
        console.error('Fehler beim Filtern der Trades:', fehler)
    }
}

/** Hängt die nächste Seite Tage aus `filteredTradesDaily` an `filteredTrades` an. */
export function useGetFilteredTradesForDaily() {
    const bis = dailyPagination.value + dailyQueryLimit.value
    for (let i = dailyPagination.value; i < bis; i++) {
        const tag = filteredTradesDaily[i]
        if (!tag) { endOfList.value = true; continue }
        if (!filteredTrades.some(d => String(d.dateUnix) === String(tag.dateUnix))) filteredTrades.push(tag)
    }
    dailyPagination.value += dailyQueryLimit.value
}

/** Löscht den Handelstag `selectedItem` samt Notizen, Tags und Zufriedenheit. */
export async function useDeleteTrade() {
    const tag = selectedItem.value
    const boerse = selectedBroker.value || 'bitunix'
    const zeile = await dbFirst('trades', { equalTo: { dateUnix: tag, broker: boerse } })
        || await dbFirst('trades', { equalTo: { dateUnix: tag } })
    if (!zeile) {
        alert(t('common.deleteTradeFailed'))
        throw new Error('Handelstag ' + tag + ' nicht gefunden')
    }
    await dbDelete('trades', zeile.objectId)
    for (const tabelle of ['notes', 'tags', 'satisfactions']) {
        try { await dbDeleteWhere(tabelle, { equalTo: { dateUnix: tag } }) }
        catch (e) { console.warn(`Löschen in ${tabelle} fehlgeschlagen:`, e) }
    }
    const zeilenBoerse = zeile.broker || 'bitunix'
    try { await axios.post(`/api/${zeilenBoerse}/last-import`, { timestamp: 0 }) }
    catch (e) { console.warn('Importstand zurücksetzen fehlgeschlagen:', e) }
    try { await refreshAccountBalance({ broker: zeilenBoerse, force: true }) }
    catch (e) { console.warn('Kontostand aktualisieren fehlgeschlagen:', e) }
    useGetTrades('imports')
}

/** Löscht alle Exkursionen des Handelstags `selectedItem`. */
export async function useDeleteExcursions() {
    try {
        await dbDeleteWhere('excursions', { equalTo: { dateUnix: selectedItem.value } })
    } catch (e) {
        alert(t('common.deleteExcursionsFailed'))
        throw e
    }
}
