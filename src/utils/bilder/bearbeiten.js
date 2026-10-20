/**
 * Bilder speichern, löschen und markieren (docs/spec/f3-screenshots.md §6–§8).
 *
 * Speichern schreibt nur die Tabelle `screenshots` — nie Tags und nie den
 * Tag-Katalog (f3-tags.md §5.3, behoben). Ein gesetzter Bildname wird nie
 * geändert (A-S2).
 *
 * Die Markierung läuft über einen beobachtbaren Auftrag (`markierAuftrag`),
 * auf den der global eingehängte Editor `BildMarkierung.vue` hört; er kennt
 * zwei Ausgänge, `uebernimmMarkierung` und `verwirfMarkierung`.
 */
import i18n from '../../i18n/index.js'
import dayjs from '../journal/zeit.js'
import { tagesBeginnUnix } from '../journal/format.js'
import { dbCreate, dbUpdate, dbDelete } from '../db.js'
import { leseZustand, zumSpeichern, brenneEin, klon } from '../bildmarkierung.js'
import { seitenId, tradeZeitzone, markierterEintrag } from '../../stores/app/rahmen.js'
import { bilder, bildInBearbeitung, vollbildBild, markierungOffen, markierAuftrag, bildVersatz } from '../../stores/journal/bilder.js'
import { ladeBilderDesTages, ladeBilderDesMonats } from './laden.js'

const t = (k) => i18n.global.t(k)

/** Endliche Zahl? `null` und '' zählen nicht (Number(null) wäre 0). */
const endlich = (x) => x !== null && x !== undefined && x !== '' && Number.isFinite(Number(x))
const gleicheId = (a, b) => a != null && b != null && String(a) === String(b)

/** Leert ein reaktives Objekt in place (Konsumenten halten die Referenz). */
function leere(obj) {
    for (const k of Object.keys(obj)) delete obj[k]
}

// ── Speichern ──────────────────────────────────────────────────────────────

/**
 * Ein Bild in `screenshots` schreiben (§6.1). Bestehende Zeilen behalten
 * Datum und Tag; eine neue Zeile bekommt die Datumsfelder in der
 * Handelszeitzone und ihre `objectId` zurück ins Bild.
 *
 * @returns {Promise<boolean>} gespeichert ja/nein — löst immer auf (A-S3)
 */
export async function speichereBild(bild) {
    if (markierungOffen.value) {
        alert(t('common.screenshotSaveAnnotation'))
        return false
    }
    if (!bild.name && bild.dateUnix != null) {
        bild.name = bild.side ? `t${bild.dateUnix}_${bild.symbol}_${bild.side}` : `${bild.dateUnix}_${bild.symbol}`
    }
    const felder = {
        name: bild.name || '',
        symbol: bild.symbol || '',
        side: bild.side || '',
        originalBase64: bild.originalBase64 || '',
        annotatedBase64: bild.annotatedBase64 || bild.originalBase64 || '',
        markersOnly: 0,
        maState: bild.maState ?? {},
    }
    const zeit = endlich(bild.dateUnix) ? Number(bild.dateUnix) : null
    try {
        if (bild.objectId != null && bild.objectId !== '') {
            await dbUpdate('screenshots', bild.objectId, felder)
        } else {
            const datum = zeit === null ? {} : {
                date: dayjs.unix(zeit).tz(tradeZeitzone.value).format('YYYY-MM-DDTHH:mm:ss'),
                dateUnix: zeit,
                dateUnixDay: tagesBeginnUnix(zeit),
            }
            const neu = await dbCreate('screenshots', { ...felder, ...datum })
            bild.objectId = neu?.objectId
        }
    } catch (fehler) {
        console.error('Bild speichern fehlgeschlagen', fehler)
        return false
    }
    if (seitenId.value === 'tagesansicht' && zeit !== null) {
        await ladeBilderDesTages(tagesBeginnUnix(zeit))
        await ladeBilderDesMonats()
    }
    return true
}

// ── Löschen ────────────────────────────────────────────────────────────────

/**
 * Den vorgemerkten Eintrag (`markierterEintrag`) löschen (§7.1). Auf der
 * Seite Bilder fällt die Karte aus der Liste und der Versatz geht um eins
 * zurück, damit das nächste Häppchen kein Bild überspringt — kein Neuladen.
 */
export async function loescheVorgemerktesBild() {
    const id = markierterEintrag.value
    if (id == null || id === '') return
    try {
        await dbDelete('screenshots', id)
    } catch (fehler) {
        console.error('Bild löschen fehlgeschlagen', fehler)
        return
    }
    if (seitenId.value === 'tagesansicht') {
        const eintrag = bilder.find(b => gleicheId(b?.objectId, id))
        if (eintrag) leere(eintrag)
        leere(bildInBearbeitung)
    } else {
        const stelle = bilder.findIndex(b => gleicheId(b?.objectId, id))
        if (stelle >= 0) bilder.splice(stelle, 1)
        bildVersatz.value = Math.max(0, bildVersatz.value - 1)
    }
    markierterEintrag.value = undefined
}

// ── Markieren ──────────────────────────────────────────────────────────────

/** Wartet auf das Ende des laufenden Auftrags (true = gespeichert). */
let auftragEnde = null

function beendeAuftrag(gespeichert) {
    markierungOffen.value = false
    markierAuftrag.value = null
    const ende = auftragEnde
    auftragEnde = null
    ende?.(gespeichert)
}

/**
 * Markierungs-Editor für ein Bild öffnen (§8). Die Kartendaten werden als
 * tiefe Kopie zum Bild in Bearbeitung; markiert wird immer auf dem
 * UNMARKIERTEN Original, nie auf einem schon eingebrannten Bild.
 *
 * @returns {Promise<boolean>} löst mit dem Ende des Editors auf
 */
export function oeffneMarkierung(daten) {
    leere(bildInBearbeitung)
    Object.assign(bildInBearbeitung, klon(daten || {}))
    const grundlage = bildInBearbeitung.originalBase64 || bildInBearbeitung.annotatedBase64
    if (!grundlage) return Promise.resolve(false)
    auftragEnde?.(false)  // ein liegengebliebener Auftrag gilt als verworfen
    return new Promise((ende) => {
        auftragEnde = ende
        markierAuftrag.value = {
            bild: grundlage,
            zustand: leseZustand(bildInBearbeitung.maState),
            objectId: bildInBearbeitung.objectId,
        }
        markierungOffen.value = true
    })
}

/**
 * Editor „Speichern": Markierung einbrennen und das Bild speichern. Scheitert
 * das Einbrennen, wirft diese Funktion — der Editor bleibt offen und meldet
 * es. Liste und Vollbild zeigen das neue Bild sofort (Zuordnung über
 * `objectId`, A-S8).
 */
export async function uebernimmMarkierung(zustand) {
    const auftrag = markierAuftrag.value
    if (!auftrag) return false
    const gespeichert = zumSpeichern(zustand)
    const eingebrannt = await brenneEin(auftrag.bild, gespeichert)
    // Erst zu, dann speichern — sonst sperrt die offene Markierung das Speichern
    markierungOffen.value = false
    const neu = { annotatedBase64: eingebrannt, maState: gespeichert, markersOnly: 0 }
    Object.assign(bildInBearbeitung, neu)
    const id = bildInBearbeitung.objectId
    const eintrag = bilder.find(b => gleicheId(b?.objectId, id))
    if (eintrag) Object.assign(eintrag, klon(neu))
    if (gleicheId(vollbildBild.objectId, id)) Object.assign(vollbildBild, klon(neu))
    const ok = await speichereBild(bildInBearbeitung)
    beendeAuftrag(ok)
    return ok
}

/** Editor × oder Esc: nichts schreiben. */
export function verwirfMarkierung() {
    beendeAuftrag(false)
}
