/**
 * Bilder laden (docs/spec/f3-screenshots.md §3): Häppchen der Seite Bilder,
 * Monatsübersicht und Tagesbilder der Tagesansicht, Neuaufbau nach „Anwenden"
 * in der Filterleiste.
 *
 * Jede Ladefunktion löst auf, auch bei Netzfehler (Fehler nur in der Konsole).
 * Angefasst wird nur die eigene Ladeanzeige `bilderWerdenGeholt` — die
 * Ladeanzeige des Trade-Fensters und die der Seite steuern ihre Besitzer
 * selbst (§3.4, behoben).
 */
import { nextTick } from 'vue'
import { dbFind } from '../db.js'
import { scrolleZu } from '../scrolleZu.js'
import { sitzung } from '../../stores/app/ablage.js'
import { listeZuEnde, markierterEintrag } from '../../stores/app/rahmen.js'
import { seiteLaedt, bilderWerdenGeholt } from '../../stores/app/laden.js'
import { gewaehlteBoerse, gewaehlterMonat, tagAuswahl } from '../../stores/journal/filter.js'
import { tags } from '../../stores/journal/tagebuch.js'
import { bilder, bilderDesMonats, bildVersatz, bildHaeppchen } from '../../stores/journal/bilder.js'

/** Parse-Altspalten: nie geschrieben, nie gebraucht — bei jedem Abruf weglassen. */
const ALTSPALTEN = ['original', 'annotated']
/** Bilder sind gross: vier je Abruf. */
export const HAEPPCHEN_VORGABE = 4
/** sessionStorage: gemerkte Anzahl geladener Bilder (einmal beim Seitenaufbau gelesen, dann gelöscht). */
const SEITEN_SCHLUESSEL = 'at.bilder.seite'
/** sessionStorage: `objectId` einer Karte, zu der nach dem Laden gescrollt wird. */
const ZIEL_SCHLUESSEL = 'screenshotIdToEdit'
/** „ohne Tag" in der Tag-Auswahl der Filterleiste. */
const OHNE_TAG = 't000t'

function sitzungLoeschen(schluessel) {
    try { sessionStorage.removeItem(schluessel) } catch { /* ohne Speicher: nichts zu löschen */ }
}

/**
 * Gemerkte Seitengrösse übernehmen: eine positive Zahl wird zur Häppchengrösse
 * und bleibt es bis zum nächsten Neuaufbau (Eigenart §3.1).
 */
export function leseGemerkteSeitengroesse() {
    const roh = sitzung(SEITEN_SCHLUESSEL)
    if (roh === null) return
    sitzungLoeschen(SEITEN_SCHLUESSEL)
    const n = Number(roh)
    if (Number.isFinite(n) && n > 0) bildHaeppchen.value = n
}

// ── Börsenzuordnung ────────────────────────────────────────────────────────

/** `{boerse, tradeIds: Set<string>, tage: Set<number>}` des laufenden Seitenaufbaus oder null. */
let boersenStand = null

/** Trade-IDs und Handelstage einer Börse — einmal je Seitenaufbau und Börse geholt (A-S10). */
async function boersenZuordnung(boerse) {
    if (boersenStand && boersenStand.boerse === boerse && bildVersatz.value > 0) return boersenStand
    const stand = { boerse, tradeIds: new Set(), tage: new Set() }
    const zeilen = await dbFind('trades', { descending: 'dateUnix', limit: 10000, exclude: ['executions', 'blotter', 'pAndL'] })
    for (const zeile of zeilen) {
        for (const tr of Array.isArray(zeile.trades) ? zeile.trades : []) {
            if (tr?.broker !== boerse) continue
            stand.tradeIds.add(String(tr.id))
            stand.tage.add(zeile.dateUnix)
        }
    }
    boersenStand = stand
    return stand
}

/** Bilder ohne `broker` sind alt und bleiben immer sichtbar. */
const passtZurBoerse = (bild, stand) => !bild.broker || bild.broker === stand.boerse
    || stand.tradeIds.has(String(bild.name)) || stand.tage.has(bild.dateUnixDay)

/** Mit „ohne Tag" gewählt bleibt JEDES Bild (Eigenart §3.1), sonst nur Bilder mit einem gewählten Tag. */
function passtZuDenTags(bild, auswahl) {
    if (auswahl.includes(OHNE_TAG)) return true
    const zuordnung = tags.find(z => z.tradeId === bild.name)
    return (Array.isArray(zuordnung?.tags) ? zuordnung.tags : []).some(id => auswahl.includes(id))
}

async function scrolleZuGemerktemBild() {
    const ziel = sitzung(ZIEL_SCHLUESSEL)
    if (!ziel) return
    await nextTick()
    scrolleZu(document.getElementById(ziel), 'center')
    sitzungLoeschen(ZIEL_SCHLUESSEL)
}

// ── Seite Bilder ───────────────────────────────────────────────────────────

/**
 * Nächstes Häppchen der Seite Bilder an die Liste anhängen (§3.1). Der
 * Versatz zählt ABGEFRAGTE Zeilen, auch gefilterte und auch nach einem
 * Fehler — sonst käme dieselbe Zeile zweimal.
 */
export async function ladeBilderHaeppchen() {
    bilderWerdenGeholt.value = true
    try {
        const zeilen = await dbFind('screenshots', {
            descending: 'dateUnix', exclude: ALTSPALTEN, limit: bildHaeppchen.value, skip: bildVersatz.value,
        })
        if (!zeilen.length) {
            listeZuEnde.value = true
        } else {
            let behalten = zeilen
            const boerse = gewaehlteBoerse.value
            if (boerse) {
                const stand = await boersenZuordnung(boerse)
                behalten = behalten.filter(b => passtZurBoerse(b, stand))
            }
            const auswahl = Array.isArray(tagAuswahl.value) ? tagAuswahl.value : []
            behalten = behalten.filter(b => passtZuDenTags(b, auswahl))
            bilder.push(...behalten)
        }
    } catch (fehler) {
        console.error('Bilder: Häppchen laden fehlgeschlagen', fehler)
    } finally {
        bildVersatz.value += bildHaeppchen.value
        bilderWerdenGeholt.value = false
    }
    await scrolleZuGemerktemBild()
}

/** „Anwenden" in der Filterleiste auf der Seite Bilder: Liste von vorn (§3.5). */
export async function baueBilderNeu() {
    seiteLaedt.value = true
    bildHaeppchen.value = HAEPPCHEN_VORGABE
    bildVersatz.value = 0
    listeZuEnde.value = false
    boersenStand = null
    bilder.length = 0
    await ladeBilderHaeppchen()
    markierterEintrag.value = undefined
    seiteLaedt.value = false
}

// ── Tagesansicht ───────────────────────────────────────────────────────────

/**
 * Monatsübersicht ohne Bilddaten (§3.2): welche Bilder gibt es im gewählten
 * Monat (beide Grenzen einschliesslich)? Für das Bild-Symbol der Trade-Zeile
 * und die Ausweichsuche im Trade-Fenster.
 */
export async function ladeBilderDesMonats() {
    bilderDesMonats.length = 0
    const monat = gewaehlterMonat.value
    try {
        const zeilen = await dbFind('screenshots', {
            descending: 'dateUnix',
            exclude: [...ALTSPALTEN, 'originalBase64', 'annotatedBase64', 'maState'],
            greaterThanOrEqualTo: { dateUnix: monat?.start },
            lessThanOrEqualTo: { dateUnix: monat?.end },
        })
        for (const z of zeilen) bilderDesMonats.push({ objectId: z.objectId, dateUnix: z.dateUnix, dateUnixDay: z.dateUnixDay, name: z.name })
    } catch (fehler) {
        console.error('Bilder: Monatsübersicht laden fehlgeschlagen', fehler)
    }
}

/** Alle Bilder eines Handelstags; ersetzt die geladene Liste (§3.3). */
export async function ladeBilderDesTages(tagUnix) {
    bilder.length = 0
    try {
        const zeilen = await dbFind('screenshots', {
            descending: 'dateUnix', exclude: ALTSPALTEN, equalTo: { dateUnixDay: tagUnix },
        })
        bilder.push(...zeilen)
    } catch (fehler) {
        console.error('Bilder: Tagesbilder laden fehlgeschlagen', fehler)
    }
}
