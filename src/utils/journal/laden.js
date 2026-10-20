/**
 * Tageszeilen laden, filtern und anreichern — der erste Schritt der
 * Journal-Kette (Spezifikation journal-kern.md §4.1).
 *
 * Ergebnis: `journalTage` (Tageskopien, absteigend), `gefilterteTageAlle`
 * (dieselben Objekte in Ladereihenfolge), `gefilterteTradesFlach` (flach),
 * dazu Blotter und P&L der gefilterten Trades.
 */
import axios from 'axios'
import dayjs from './zeit.js'
import i18n from '../../i18n/index.js'
import { dbFind, dbFirst, dbDelete, dbDeleteWhere } from '../db.js'
import { refreshAccountBalance } from '../../stores/accountBalance.js'
import { seitenId, tradeZeitzone, abfrageGrenze, journalHatDaten, tagesSeite, tagesAbfrageGrenze, listeZuEnde, markierterEintrag } from '../../stores/app/rahmen.js'
import { gewaehlterBereich, gewaehlteRichtungen, gewaehlteKonten, tagAuswahl, gewaehlteBoerse, selectedTradeCategory, tageZurueck } from '../../stores/journal/filter.js'
import { journalTage, gefilterteTageAlle, gefilterteTradesFlach, imports } from '../../stores/journal/auswertung.js'
import { pAndL, blotter } from '../../stores/journal/import.js'
import { tags, zufriedenheitTage, zufriedenheitTrades, excursions, verfuegbareTags } from '../../stores/journal/tagebuch.js'
import { baueNachschlag, erstelleFilter, reichereAn } from './filtern.js'
import { baueBlotter, bauePnL } from './tagesrechnung.js'
import { kette } from './kette.js'
import { istGanzerZeitraum } from './hilfen.js'

const t = (k) => i18n.global.t(k)
const OHNE_GROSSE_SPALTEN = ['executions', 'blotter', 'pAndL']
// Für den Trade-Typ genügen tradeId/dateUnix/tradeType — die Texte bleiben auf dem Server.
const NOTIZ_TEXTE = ['note', 'title', 'entryNote', 'feelings', 'playbook', 'closingNote', 'closingFeelings', 'closingPlaybook', 'tradingMetadata', 'aiReview', 'aiReviewProvider', 'aiReviewModel']

/** Abfrage der Tageszeilen je nach Seite. */
function tageszeilenAbfrage(param) {
    if (seitenId.value === 'imports' || param === 'imports') {
        return { exclude: OHNE_GROSSE_SPALTEN, descending: 'dateUnix', limit: 20 }
    }
    if (seitenId.value === 'exkursionen') {
        return {
            exclude: OHNE_GROSSE_SPALTEN,
            greaterThanOrEqualTo: { dateUnix: dayjs().subtract(tageZurueck.value, 'day').unix() },
            lessThan: { dateUnix: dayjs().unix() },
            ascending: 'dateUnix',
        }
    }
    const r = gewaehlterBereich.value
    if (istGanzerZeitraum(r)) return { exclude: OHNE_GROSSE_SPALTEN, ascending: 'dateUnix', limit: abfrageGrenze.value }
    return {
        exclude: OHNE_GROSSE_SPALTEN,
        greaterThanOrEqualTo: { dateUnix: r.start },
        lessThan: { dateUnix: r.end },
        ascending: 'dateUnix',
        limit: abfrageGrenze.value,
    }
}

/** Lädt Tageszeilen in den Kettenzustand und nach `imports`. */
export async function ladeTrades(param) {
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
    const tag = dayjs.unix(zeile.dateUnix).tz(tradeZeitzone.value)
    // Bewusster Altfehler §7.11: `date` wird zur Tageszahl, die DB-Zeichenkette geht verloren.
    const kopie = { ...kopf, date: tag.date(), month: tag.month(), year: tag.year(), trades: [] }
    if (seitenId.value === 'tagesansicht') {
        const k = String(zeile.dateUnix)
        kopie.satisfaction = n.tagesZufriedenheit.has(k) ? n.tagesZufriedenheit.get(k) : null
    }
    return kopie
}

export async function filtereTrades(_param) {
    try {
        await ladeTrades()
        journalTage.length = 0
        gefilterteTageAlle.length = 0
        gefilterteTradesFlach.length = 0

        const zeilen = kette.tageszeilen
        const n = baueNachschlag({
            tagZeilen: tags,
            tagesZufriedenheit: zufriedenheitTage,
            tradeZufriedenheit: zufriedenheitTrades,
            exkursionen: excursions,
            notizen: await ladeTradeTypNotizen(zeilen),
            katalog: verfuegbareTags,
        })
        // Bewusster Altfehler §7.9: nur auf true, nie zurück — auch wenn der Filter alles verwirft.
        if (zeilen.length > 0) journalHatDaten.value = true

        const gewaehlt = tagAuswahl.value
        const passt = erstelleFilter({
            boerse: gewaehlteBoerse.value,
            kategorie: selectedTradeCategory.value,
            bereich: gewaehlterBereich.value,
            richtungen: gewaehlteRichtungen.value,
            konten: gewaehlteKonten.value,
            gewaehlteTags: gewaehlt,
        })

        for (const zeile of zeilen) {
            if (!zeile.trades) continue
            const kopie = tageskopie(zeile, n)
            for (const trade of zeile.trades) {
                if (!passt(trade, n)) continue
                const gefiltert = reichereAn(trade, n, gewaehlt)
                kopie.trades.push(gefiltert)
                gefilterteTradesFlach.push(gefiltert)
            }
            if (kopie.trades.length > 0) {
                journalTage.push(kopie)
                gefilterteTageAlle.push(kopie)
            }
        }

        await baueBlotter(true)
        await bauePnL()

        // Bewusster Altfehler §7.2: bei mehreren Tageskopien mit gleichem
        // dateUnix (zwei Börsen am selben Tag) bekommt nur die LETZTE P&L und
        // Blotter, obwohl beide über alle Trades des Tages gerechnet sind.
        for (const td of Object.keys(pAndL)) {
            const ziel = gefilterteTageAlle.findLast(d => String(d.dateUnix) === td)
            if (!ziel) continue
            ziel.pAndL = pAndL[td]
            ziel.blotter = blotter[td]
        }

        journalTage.sort((a, b) => b.dateUnix - a.dateUnix)
    } catch (fehler) {
        console.error('Fehler beim Filtern der Trades:', fehler)
    }
}

/** Hängt die nächste Seite Tage aus `gefilterteTageAlle` an `journalTage` an. */
export function ladeNaechsteTage() {
    const bis = tagesSeite.value + tagesAbfrageGrenze.value
    for (let i = tagesSeite.value; i < bis; i++) {
        const tag = gefilterteTageAlle[i]
        if (!tag) { listeZuEnde.value = true; continue }
        if (!journalTage.some(d => String(d.dateUnix) === String(tag.dateUnix))) journalTage.push(tag)
    }
    tagesSeite.value += tagesAbfrageGrenze.value
}

/** Löscht den Handelstag `markierterEintrag` samt Notizen, Tags und Zufriedenheit. */
export async function loescheTrade() {
    const tag = markierterEintrag.value
    const boerse = gewaehlteBoerse.value || 'bitunix'
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
    ladeTrades('imports')
}

/** Löscht alle Exkursionen des Handelstags `markierterEintrag`. */
export async function loescheExkursionen() {
    try {
        await dbDeleteWhere('excursions', { equalTo: { dateUnix: markierterEintrag.value } })
    } catch (e) {
        alert(t('common.deleteExcursionsFailed'))
        throw e
    }
}
