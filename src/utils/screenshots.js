/**
 * Screenshots: Laden, Einlesen, Markieren, Speichern, Löschen, Vollbild.
 *
 * Clean-Room-Neubau nach docs/spec/ansichten.md, Teil „Screenshots und
 * Bildmarkierung“ (S.4). Die Exportnamen sind Schnittstelle — Journal-Kern
 * (`ablauf.js`, `app.js`), Filterleiste, Daily, Playbook und das Vollbild
 * importieren sie.
 *
 * Bewusste Änderungen gegenüber dem Altverhalten (Abschnitt 0 der Spec):
 * - `annotatedBase64` ist nach dem Markieren das EINGEBRANNTE Gesamtbild
 *   (Original + Markierung), `markersOnly` = 0 (A-S1). Altzeilen mit
 *   `markersOnly` = 1 zeigt die Karte weiter als Original + Ebene.
 * - `name` bleibt beim Markieren unverändert (A-S2); gesetzt wird er nur,
 *   wenn ein neues Bild noch keinen hat.
 * - Alle Promises lösen auf — mit `false`, wenn nichts gespeichert wurde (A-S3).
 * - Die Markierung wird dem Listeneintrag über `objectId` zugeordnet (A-S8).
 * - Das Vollbild wird nicht mehr per Bootstrap-Datenattribut geöffnet, sondern
 *   über `screenshotVollbildOffen`; `useSelectedScreenshotFunction` öffnet es
 *   gleich mit, weil jeder ihrer Aufrufer genau das will.
 */
import { scrolleZu } from './scrolleZu.js'
import { ref, shallowRef } from 'vue'
import dayjs from './journal/zeit.js'
import i18n from '../i18n/index.js'
import { dbFind, dbCreate, dbUpdate, dbDelete } from './db.js'
import {
    pageId, timeZoneTrade, listeZuEnde, markierterEintrag, speichernNoetig,
} from '../stores/app/rahmen.js'
import { seiteLaedt, zeichenZaehler, setupsLaden } from '../stores/app/laden.js'
import { selectedBroker, tagAuswahl, gewaehlterMonat } from '../stores/journal/filter.js'
import { tags, tradeTags, tradeBildGeaendert } from '../stores/journal/tagebuch.js'
import {
    screenshot, screenshots, bildInfos, bildSeite, bildAbfrageGrenze,
    gewaehltesBild, selectedScreenshotIndex, selectedScreenshotSource, markierungOffen, bildInBearbeitung,
    tagesBildGeaendert, resizeCompressImg, resizeCompressMaxWidth, resizeCompressMaxHeight, resizeCompressQuality,
} from '../stores/journal/screenshots.js'
import { speichereVerfuegbareTags, speichereTags } from './journal/tagebuch.js'
import { leseZustand, zumSpeichern, brenneEin, ladeBild, klon } from './bildmarkierung.js'

const t = (k) => i18n.global.t(k)

/** Spalten aus der Parse-Zeit — nie geschrieben, nie gebraucht. */
const ALTSPALTEN = ['original', 'annotated']
/** Ohne Bilddaten: für die Monatsübersicht in Daily. */
const NUR_INFO = [...ALTSPALTEN, 'originalBase64', 'annotatedBase64', 'maState']
/** Kennung „ohne Tag“ im Tag-Filter. */
const OHNE_TAG = 't000t'

// Seitengrösse der Screenshots-Seite: 4 Bilder je Abruf (Bilder sind gross).
bildAbfrageGrenze.value = 4

const leere = (obj) => { for (const k of Object.keys(obj)) delete obj[k] }
const sitzungLesen = (k) => { try { return sessionStorage.getItem(k) } catch { return null } }
const sitzungLoeschen = (k) => { try { sessionStorage.removeItem(k) } catch { /* egal */ } }
const tagesanfang = (sek) => dayjs.unix(sek).tz(timeZoneTrade.value).startOf('day').unix()
const datumText = (sek) => dayjs.unix(sek).tz(timeZoneTrade.value).format('YYYY-MM-DDTHH:mm:ss')

// ── Vollbild ───────────────────────────────────────────────────────────────

/** Offen-Zustand des globalen Vollbilds (`components/rahmen/ScreenshotVollbild.vue`). */
export const screenshotVollbildOffen = ref(false)

export function useOeffneScreenshotVollbild() {
    screenshotVollbildOffen.value = true
}

/**
 * Schliesst das Vollbild. Der Rückweg ins Daily-Detailfenster braucht keinen
 * eigenen Schritt mehr: beide sind native Dialoge in der obersten Ebene, das
 * Detailfenster bleibt darunter offen und ist nach dem Schliessen wieder vorn.
 */
export function useSchliesseScreenshotVollbild() {
    screenshotVollbildOffen.value = false
}

// ── Laden ──────────────────────────────────────────────────────────────────

/**
 * Nach einem Neuladen mit gemerkter Position: die schon geladene Anzahl in
 * EINEM Abruf wiederholen, damit zur Karte gescrollt werden kann.
 */
export function leseBildSeite() {
    const gemerkt = sitzungLesen('screenshotsPagination')
    if (gemerkt != null && gemerkt !== '') {
        const n = Number(gemerkt)
        if (Number.isFinite(n) && n > 0) bildAbfrageGrenze.value = n
        sitzungLoeschen('screenshotsPagination')
    }
}

/**
 * Trade-IDs und Handelstage der gewählten Börse. Einmal je Seitenaufruf und
 * Börse statt bei jedem Nachladen (A-S10: lud jedes Mal ALLE Trades).
 */
let boersenCache = null
async function boersenZuordnung(boerse) {
    if (boersenCache?.boerse === boerse) return boersenCache
    const zeilen = await dbFind('trades', { descending: 'dateUnix', limit: 10000, exclude: ['executions', 'blotter', 'pAndL'] })
    const ids = new Set()
    const tage = new Set()
    for (const zeile of zeilen || []) {
        const liste = Array.isArray(zeile.trades) ? zeile.trades : []
        for (const tr of liste) {
            if (tr?.broker === boerse) {
                if (tr.id != null) ids.add(String(tr.id))
                tage.add(Number(zeile.dateUnix))
            }
        }
    }
    boersenCache = { boerse, ids, tage }
    return boersenCache
}

function passtZurBoerse(bild, zuordnung, boerse) {
    if (!bild.broker) return true // Bilder ohne Börse dürfen nicht verschwinden
    if (bild.broker === boerse) return true
    if (zuordnung.ids.has(String(bild.name))) return true
    return zuordnung.tage.has(Number(bild.dateUnixDay))
}

function passtZuTags(bild) {
    const gewaehlt = Array.isArray(tagAuswahl.value) ? tagAuswahl.value : []
    const zeile = tags.find(x => x.tradeId === bild.name)
    if (zeile && Array.isArray(zeile.tags) && zeile.tags.some(id => gewaehlt.includes(id))) return true
    return gewaehlt.includes(OHNE_TAG)
}

/**
 * Drei Betriebsarten:
 *  1. `nichtSeite` falsch → Screenshots-Seite, eine Seite (skip/limit), neueste zuerst;
 *  2. `nichtSeite` wahr ohne `tagUnix` → leichte Monatsliste für Daily (`bildInfos`);
 *  3. `nichtSeite` wahr mit `tagUnix` → alle Bilder dieses Tages.
 * Löst immer auf, auch bei Fehlern.
 */
export async function ladeBilder(nichtSeite, tagUnix) {
    const aufSeite = pageId.value === 'screenshots'
    const aufDaily = pageId.value === 'daily'
    const monatsliste = !!nichtSeite && (tagUnix === undefined || tagUnix === null)
    try {
        let treffer
        if (!nichtSeite) {
            // Neue Liste ab dem Anfang = neuer Seitenaufruf: Börsenzuordnung neu holen.
            if (bildSeite.value === 0) boersenCache = null
            treffer = await dbFind('screenshots', {
                descending: 'dateUnix', exclude: ALTSPALTEN,
                limit: bildAbfrageGrenze.value, skip: bildSeite.value,
            })
        } else if (monatsliste) {
            bildInfos.length = 0
            const monat = gewaehlterMonat.value || {}
            treffer = await dbFind('screenshots', {
                descending: 'dateUnix', exclude: NUR_INFO,
                greaterThanOrEqualTo: { dateUnix: monat.start }, lessThanOrEqualTo: { dateUnix: monat.end },
            })
        } else {
            treffer = await dbFind('screenshots', { descending: 'dateUnix', exclude: ALTSPALTEN, equalTo: { dateUnixDay: tagUnix } })
        }
        treffer = Array.isArray(treffer) ? treffer : []

        if (treffer.length === 0) {
            if (aufSeite) listeZuEnde.value = true
        } else {
            let liste = treffer
            const boerse = selectedBroker.value
            if (boerse && aufSeite) {
                const zuordnung = await boersenZuordnung(boerse)
                liste = liste.filter(b => passtZurBoerse(b, zuordnung, boerse))
            }
            // Daily zeigt die Bilder EINES Tages: vor dem Füllen leeren. Die
            // Monatsliste (Betriebsart 2) füllt `bildInfos` und lässt sie stehen.
            if (aufDaily && !monatsliste) screenshots.length = 0
            if (!aufDaily) liste = liste.filter(passtZuTags)
            for (const bild of liste) {
                if (monatsliste) bildInfos.push({ objectId: bild.objectId, dateUnix: bild.dateUnix, dateUnixDay: bild.dateUnixDay, name: bild.name })
                else screenshots.push(bild)
            }
        }
    } catch (fehler) {
        console.error('Screenshots laden fehlgeschlagen:', fehler)
    } finally {
        bildSeite.value += Number(bildAbfrageGrenze.value) || 0
        setupsLaden.value = false
        if (!aufDaily) seiteLaedt.value = false
    }
    if (sitzungLesen('screenshotIdToEdit') && aufSeite) scrolleZuBild()
}

/** Scrollt zur Karte mit der gemerkten `objectId` (SS `screenshotIdToEdit`). */
export function scrolleZuBild() {
    const id = sitzungLesen('screenshotIdToEdit')
    if (!id) return
    // Die Karten stehen erst nach dem nächsten Zeichnen im DOM.
    requestAnimationFrame(() => {
        scrolleZu(document.getElementById(id), 'center')
        sitzungLoeschen('screenshotIdToEdit')
    })
}

// ── Einlesen ───────────────────────────────────────────────────────────────

function alsDatenUrl(datei) {
    return new Promise((ok, fehler) => {
        const leser = new FileReader()
        leser.onload = () => ok(leser.result)
        leser.onerror = () => fehler(leser.error)
        leser.readAsDataURL(datei)
    })
}

/**
 * Liest eine Bilddatei in `screenshot` ein (Original und Anzeigebild gleich).
 * Ohne Datei: nichts.
 */
export async function useSetupImageFile(datei, dateUnix, symbol, side) {
    if (!datei) return
    tradeBildGeaendert.value = true
    if (pageId.value === 'daily') {
        speichernNoetig.value = true
        tagesBildGeaendert.value = true
        screenshot.dateUnix = dateUnix
        screenshot.symbol = symbol
        screenshot.side = side
    }
    const url = await alsDatenUrl(datei)
    screenshot.originalBase64 = url
    screenshot.annotatedBase64 = url
    screenshot.extension = String(url).substring(String(url).indexOf('/') + 1, String(url).indexOf(';base64'))
    zeichenZaehler.value += 1
    if (resizeCompressImg.value) await compressImage(url)
}

/** Erste Datei aus einem `<input type="file">`-Ereignis einlesen. */
export function useSetupImageUpload(event, dateUnix, symbol, side) {
    const datei = event?.target?.files?.[0]
    return useSetupImageFile(datei, dateUnix, symbol, side)
}

/**
 * Verkleinert ein Bild über ein Canvas, wenn Höchstmasse gesetzt sind
 * (`resizeCompress*`). Heute setzt sie niemand — dann tut die Funktion nichts
 * und liefert `null` (A-S11; die Altfassung rechnete mit Massen des vorigen
 * Aufrufs weiter und suchte ein Element, das es nicht gab).
 * Nimmt eine Daten-URL oder ein `<img>`; schreibt das Ergebnis in `screenshot`.
 */
export async function compressImage(bildOderUrl) {
    const maxB = Number(resizeCompressMaxWidth.value)
    const maxH = Number(resizeCompressMaxHeight.value)
    if (!(maxB > 0) && !(maxH > 0)) return null
    const url = typeof bildOderUrl === 'string' ? bildOderUrl : bildOderUrl?.src
    if (!url) return null
    const bild = await ladeBild(url)
    const W = bild.naturalWidth, H = bild.naturalHeight
    let faktor = 1
    if (maxB > 0 && W > maxB) faktor = Math.min(faktor, maxB / W)
    if (maxH > 0 && H > maxH) faktor = Math.min(faktor, maxH / H)
    if (faktor >= 1) return null
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(W * faktor)
    canvas.height = Math.round(H * faktor)
    canvas.getContext('2d').drawImage(bild, 0, 0, canvas.width, canvas.height)
    const qualitaet = Number(resizeCompressQuality.value)
    const neu = canvas.toDataURL('image/jpeg', qualitaet > 0 && qualitaet <= 1 ? qualitaet : 0.85)
    screenshot.originalBase64 = neu
    screenshot.annotatedBase64 = neu
    screenshot.extension = 'jpeg'
    zeichenZaehler.value += 1
    return neu
}

// ── Markieren ──────────────────────────────────────────────────────────────

/**
 * Laufender Markierungsauftrag für den Editor
 * (`components/bildmarkierung/BildMarkierung.vue`, eingehängt im Vollbild-Rahmen):
 * `{ quelle, bild, zustand, objectId, fertig }` oder null.
 */
export const markierAuftrag = shallowRef(null)

/**
 * Öffnet den Markierungseditor für ein Bild. Liefert ein Promise, das mit
 * `true` (gespeichert) oder `false` (verworfen) auflöst.
 */
export function useSetupMarkerArea(quelle, bildDaten) {
    if (quelle === 'dailyTab' || quelle === 'screenshots') {
        leere(screenshot)
        Object.assign(screenshot, klon(bildDaten || {}))
    }
    // Grundlage ist immer das unmarkierte Original — die Markierung wird beim
    // Speichern neu eingebrannt, nie auf ein schon markiertes Bild.
    const bild = screenshot.originalBase64 || screenshot.annotatedBase64
    if (!bild) return Promise.resolve(false)
    return new Promise((fertig) => {
        markierAuftrag.value = {
            quelle,
            bild,
            zustand: leseZustand(screenshot.maState),
            objectId: screenshot.objectId,
            fertig,
        }
        markierungOffen.value = true
    })
}

/**
 * Vom Editor gerufen: Markierung übernehmen. Brennt sie ins Original ein,
 * setzt `annotatedBase64`/`maState` am Bild in Bearbeitung und am Listeneintrag
 * und speichert. Wirft, wenn das Einbrennen scheitert (der Editor bleibt dann offen).
 */
export async function useMarkierungUebernehmen(zustand) {
    const auftrag = markierAuftrag.value
    if (!auftrag) return false
    const gespeichert = zumSpeichern(zustand)
    const eingebrannt = await brenneEin(auftrag.bild, gespeichert)
    const felder = { annotatedBase64: eingebrannt, maState: gespeichert, markersOnly: 0 }

    // Vor dem Speichern schliessen — offen blockiert `speichereBild`.
    markierungOffen.value = false
    markierAuftrag.value = null
    Object.assign(screenshot, klon(felder))

    let ok = true
    if (auftrag.quelle === 'dailyModal') {
        tradeBildGeaendert.value = true
        tagesBildGeaendert.value = true
        speichernNoetig.value = true
    } else {
        // Über die objectId, nicht über dateUnix (A-S8: gleiche Sekunde → falsches Bild).
        if (auftrag.objectId != null) {
            const eintrag = screenshots.find(s => s && String(s.objectId) === String(auftrag.objectId))
            if (eintrag) Object.assign(eintrag, klon(felder))
            if (String(gewaehltesBild.objectId) === String(auftrag.objectId)) Object.assign(gewaehltesBild, klon(felder))
        }
        ok = await speichereBild()
    }
    zeichenZaehler.value += 1
    auftrag.fertig(ok)
    return ok
}

/** Vom Editor gerufen: verwerfen, nichts schreiben. */
export function useMarkierungVerwerfen() {
    const auftrag = markierAuftrag.value
    markierungOffen.value = false
    markierAuftrag.value = null
    auftrag?.fertig(false)
}

// ── Speichern ──────────────────────────────────────────────────────────────

/**
 * Speichert `screenshot`. Löst mit `false` auf, wenn abgebrochen wurde
 * (Markierung offen, Pflichtangaben fehlen, DB-Fehler).
 */
export async function speichereBild() {
    if (markierungOffen.value) {
        alert(t('common.screenshotSaveAnnotation'))
        return false
    }
    if (pageId.value === 'addScreenshot') {
        // Seite gibt es nicht mehr (Route leitet um); Prüfungen bleiben harmlos.
        if (!screenshot.symbol) { alert(t('common.screenshotAddSymbol')); return false }
        if (!screenshot.originalBase64) { alert(t('common.screenshotAddImage')); return false }
        seiteLaedt.value = true
        if (screenshot.date) screenshot.dateUnix = dayjs.tz(screenshot.date, timeZoneTrade.value).unix()
    }
    if (bildInBearbeitung.value && screenshot.originalBase64) {
        const url = String(screenshot.originalBase64)
        screenshot.extension = url.substring(url.indexOf('/') + 1, url.indexOf(';base64'))
    }
    // Name nur für ein neues Bild ohne Namen bilden — ein vorhandener Name ist
    // der Verknüpfungsschlüssel zu Trade/Playbook/Incoming (A-S2).
    if (!screenshot.name && screenshot.dateUnix != null) {
        screenshot.name = screenshot.side
            ? `t${screenshot.dateUnix}_${screenshot.symbol}_${screenshot.side}`
            : `${screenshot.dateUnix}_${screenshot.symbol}`
    }
    try {
        if (!bildInBearbeitung.value && tradeTags.length === 0) return await ladeBildHoch()
        await Promise.all([speichereVerfuegbareTags(), speichereTags()])
        return await ladeBildHoch()
    } catch (fehler) {
        console.error('Screenshot speichern fehlgeschlagen:', fehler)
        seiteLaedt.value = false
        return false
    }
}

/** Schreibt `screenshot` in die eigene DB (Name historisch). Löst immer auf. */
export async function ladeBildHoch() {
    const daten = {
        name: screenshot.name || '',
        symbol: screenshot.symbol || '',
        side: screenshot.side || '',
        originalBase64: screenshot.originalBase64 || '',
        annotatedBase64: screenshot.annotatedBase64 || screenshot.originalBase64 || '',
        // Anzeigebild ist jetzt immer ein vollständiges Bild, keine Ebene (A-S1).
        markersOnly: 0,
        maState: screenshot.maState ?? {},
    }
    const mitDatum = () => {
        const sek = Number(screenshot.dateUnix)
        if (!Number.isFinite(sek)) return
        daten.date = datumText(sek)
        daten.dateUnix = sek
        daten.dateUnixDay = tagesanfang(sek)
    }
    try {
        if (screenshot.objectId) {
            if (tagesBildGeaendert.value) mitDatum()
            await dbUpdate('screenshots', screenshot.objectId, daten)
        } else {
            mitDatum()
            const neu = await dbCreate('screenshots', daten)
            if (neu?.objectId) screenshot.objectId = neu.objectId
        }
    } catch (fehler) {
        console.error('Screenshot schreiben fehlgeschlagen:', fehler)
        seiteLaedt.value = false
        return false
    }
    if (pageId.value === 'addScreenshot') {
        window.location.href = '/screenshots'
    } else if (pageId.value === 'daily') {
        const tag = tagesanfang(Number(screenshot.dateUnix))
        await ladeBilder(true, tag)
        await ladeBilder(true)
        const eingabe = document.querySelector('.screenshotFile')
        if (eingabe) eingabe.value = ''
    }
    return true
}

// ── Löschen, Neu laden ─────────────────────────────────────────────────────

/** Löscht das Bild mit der `objectId` in `markierterEintrag`. Argumente werden ignoriert. */
export async function useDeleteScreenshot() {
    const id = markierterEintrag.value
    if (id == null) return
    try {
        await dbDelete('screenshots', id)
    } catch (fehler) {
        console.error('Screenshot löschen fehlgeschlagen:', fehler)
        return
    }
    if (pageId.value === 'screenshots') {
        // Kein Neuladen: das setzte die Paginierung zurück.
        const i = screenshots.findIndex(s => String(s?.objectId) === String(id))
        if (i >= 0) screenshots.splice(i, 1)
        bildSeite.value = Math.max(0, bildSeite.value - 1)
        markierterEintrag.value = null
    } else if (pageId.value === 'daily') {
        const eintrag = screenshots.find(s => String(s?.objectId) === String(id))
        if (eintrag) leere(eintrag)
        leere(screenshot)
        markierterEintrag.value = null
    }
}

/** Liste neu aufbauen (Filter angewendet). */
export async function ladeBilderNeu() {
    seiteLaedt.value = true
    bildAbfrageGrenze.value = 4
    bildSeite.value = 0
    listeZuEnde.value = false
    boersenCache = null
    screenshots.length = 0
    await ladeBilder(false)
    markierterEintrag.value = null
}

// ── Auswahl für das Vollbild ───────────────────────────────────────────────

/**
 * Wählt das Bild für das Vollbild und öffnet es.
 * `index` ≥ 0: Eintrag aus `screenshots` (mit Blättern); −1 oder keine Zahl:
 * `daten` als Einzelbild.
 */
export function useSelectedScreenshotFunction(index, quelle, daten) {
    selectedScreenshotIndex.value = index
    selectedScreenshotSource.value = quelle
    // Zwei vor dem Ende nachladen — nur auf der Seite, und nie für Einzelbilder.
    if (Number.isInteger(index) && index >= 1 && index + 2 === screenshots.length && !listeZuEnde.value && pageId.value === 'screenshots') {
        ladeBilder(false)
    }
    // Vorher leeren, sonst bleiben Felder des vorigen Bildes stehen (A-S4).
    // Kopie zuerst: wer `gewaehltesBild` selbst übergibt, verlöre sonst alles.
    const neu = Number.isInteger(index) && index >= 0 ? screenshots[index] : daten
    const kopie = { ...(neu || {}) }
    leere(gewaehltesBild)
    Object.assign(gewaehltesBild, kopie)
    useOeffneScreenshotVollbild()
}
