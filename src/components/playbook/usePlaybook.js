/**
 * Zustand und Abläufe der Playbook-Seite (Trade-Bewertungen). Eine Instanz je
 * Seitenleben — die Seite erzeugt sie und reicht sie per provide/inject an die
 * Karten weiter, damit Karte, Ansicht und Bearbeitung dieselben Einträge, Bilder
 * und Merker sehen, ohne jede Funktion als Prop durchzureichen.
 *
 * Bewusst KEIN Modul-Zustand: Wer die Seite verlässt und wiederkommt, soll
 * frisch laden und keine halbe Bearbeitung von vorhin vorfinden.
 */
import { scrolleZu } from '../../utils/scrolleZu.js'
import { reactive, ref, inject, nextTick } from 'vue'
import { dbFind, dbGet, dbCreate, dbUpdate, dbDelete } from '@/utils/db.js'
import { ladeVerfuegbareTags, useGetTagInfo } from '@/utils/journal/tagebuch.js'
import { selectedBroker } from '@/stores/journal/filter.js'
import { kopiertesBild } from '@/stores/app/rahmen.js'
import { seiteLaedt } from '@/stores/app/laden.js'
import {
    FELDER, ID_FELD, LEERE_NOTIZ, baueEintrag, hatDaten, findeBild,
    darfLoeschen, darfFestschreiben, loeseTags,
} from './playbookDaten.js'

const SCHLUESSEL = Symbol('playbook')

/** Bilddaten bleiben draussen (A-P8): 500 Bilder samt Base64 waren der teuerste Teil der Seite. */
const OHNE_BILDDATEN = ['original', 'annotated', 'originalBase64', 'annotatedBase64', 'maState']

/** Felder, die „Abbrechen“ zurücklegt. Bild-IDs gehören NICHT dazu: Hochladen und Entfernen wirken sofort. */
const BEARBEITBAR = ['tradeType', 'closingTradeType', 'timeframe', 'entryStressLevel', 'emotionLevel',
    'feelings', 'playbook', 'closingPlaybook', 'satisfaction', 'tags', 'closingTags']

const kopie = (x) => JSON.parse(JSON.stringify(x))

export function erzeugePlaybook() {
    const eintraege = reactive([])
    /** Bildzeilen OHNE Base64; Inhalte holt `holeBild` erst, wenn eine Karte sie zeigt. */
    const bilder = reactive([])
    /** objectId → { original, annotated, markersOnly } | 'laedt' | 'fehlt' */
    const bildDaten = reactive({})
    /** `<tradeId>:<feld>` → frisch hochgeladene Daten-URL (nur im Speicher). */
    const vorschau = reactive({})
    /**
     * Bilder, die über die unsichere Suche (Tag/Symbol/Präfix) gefunden und
     * entfernt wurden: Löschen wäre hier gefährlich (fremder Trade), also nur
     * für dieses Seitenleben ausblenden. `<tradeId>:<feld>` → objectId.
     */
    const ausgeblendet = reactive({})

    const offenId = ref(null)
    const bearbeitenId = ref(null)
    const speichertId = ref(null)
    const ziehMerker = ref('')
    const vollbild = ref(null)
    const nichtGefunden = ref('')
    const aufgeklappteGruppen = reactive(new Set())
    const zugeklappteProtokolle = reactive(new Set())

    let schnappschuss = null

    // ── Laden (P.3) ───────────────────────────────────────────────────────

    async function ladeEintraege() {
        const [notizen, zufriedenheiten, tagZeilen, tageszeilenRoh, bildZeilen] = await Promise.all([
            dbFind('notes', { descending: 'dateUnix', limit: 200 }),
            dbFind('satisfactions', { limit: 500 }),
            dbFind('tags', { limit: 500 }),
            dbFind('trades', { descending: 'dateUnix', limit: 200 }),
            dbFind('screenshots', { descending: 'dateUnix', limit: 500, exclude: OHNE_BILDDATEN }),
        ])
        const boerse = selectedBroker.value
        const tageszeilen = boerse
            ? tageszeilenRoh.filter(z => (z.trades || []).some(t => t.broker === boerse))
            : tageszeilenRoh

        const tradeNachId = new Map()
        for (const z of tageszeilen) for (const t of z.trades || []) tradeNachId.set(t.id, { tageszeile: z, trade: t })
        const zufriedenheitNachId = new Map(zufriedenheiten.map(z => [z.tradeId, z]))
        const tagsNachId = new Map()
        for (const z of tagZeilen) tagsNachId.set(z.tradeId, z) // die zuletzt gelesene gewinnt

        const neu = []
        for (const n of notizen) {
            if (!n.tradeId) continue
            const fund = tradeNachId.get(n.tradeId)
            if (boerse && !fund) continue
            neu.push(baueEintrag({
                notiz: n,
                trade: fund?.trade,
                tageszeile: fund?.tageszeile,
                zufriedenheit: zufriedenheitNachId.get(n.tradeId),
                tagZeile: tagsNachId.get(n.tradeId),
                tagInfo: useGetTagInfo,
            }))
        }
        eintraege.splice(0, eintraege.length, ...neu)

        const sichtbar = boerse ? bildZeilen.filter(b => !b.broker || b.broker === boerse) : bildZeilen
        bilder.splice(0, bilder.length, ...sichtbar.map(b => ({ ...b, objectId: String(b.objectId) })))
    }

    async function start(tradeIdAusQuery) {
        seiteLaedt.value = true
        try {
            await ladeVerfuegbareTags()
            await ladeEintraege()
        } finally {
            seiteLaedt.value = false
        }
        if (tradeIdAusQuery) await deepLink(String(tradeIdAusQuery))
    }

    // ── Deep-Link ?tradeId= (P.5) ─────────────────────────────────────────

    async function deepLink(tradeId) {
        let e = eintraege.find(x => x.tradeId === tradeId)
        if (!e) {
            const zeilen = await dbFind('trades', { descending: 'dateUnix', limit: 500 })
            const zeile = zeilen.find(z => (z.trades || []).some(t => t.id === tradeId))
            if (zeile) {
                await dbCreate('notes', {
                    dateUnix: zeile.dateUnix, tradeId, note: LEERE_NOTIZ,
                    entryStressLevel: 0, emotionLevel: 0, entryNote: '', feelings: '', playbook: '', timeframe: '',
                    closingNote: '', closingStressLevel: 0, closingEmotionLevel: 0, closingFeelings: '',
                    closingTimeframe: '', closingPlaybook: '',
                })
                await ladeEintraege()
                e = eintraege.find(x => x.tradeId === tradeId)
            }
        }
        // A-P2 behoben: früher tat ein unbekannter Link stumm nichts (z. B. ein
        // Bildname aus der Screenshots-Seite, oder ein Trade einer anderen Börse).
        if (!e) {
            nichtGefunden.value = tradeId
            return
        }
        oeffne(e)
        if (!hatDaten(e)) await bearbeiten(e)
        setTimeout(() => {
            scrolleZu(document.getElementById(`playbook-${tradeId}`))
        }, 100)
    }

    // ── Aufklappen und Bearbeiten (P.9) ───────────────────────────────────

    function oeffne(e) {
        offenId.value = e.tradeId
    }

    function umschalten(e) {
        if (offenId.value === e.tradeId) {
            if (bearbeitenId.value === e.tradeId) abbrechen()
            offenId.value = null
            return
        }
        if (bearbeitenId.value) abbrechen()
        oeffne(e)
    }

    async function bearbeiten(e) {
        if (bearbeitenId.value && bearbeitenId.value !== e.tradeId) abbrechen()
        offenId.value = e.tradeId
        // A-P7 behoben: Kopie halten, damit „Abbrechen“ wirklich nichts zurücklässt.
        schnappschuss = { tradeId: e.tradeId, werte: kopie(Object.fromEntries(BEARBEITBAR.map(f => [f, e[f]]))) }
        bearbeitenId.value = e.tradeId
        await nextTick()
    }

    function abbrechen() {
        const id = bearbeitenId.value
        if (schnappschuss && schnappschuss.tradeId === id) {
            const e = eintraege.find(x => x.tradeId === id)
            if (e) Object.assign(e, schnappschuss.werte)
        }
        schnappschuss = null
        bearbeitenId.value = null
    }

    /**
     * Speichern. `html` trägt die Editor-Inhalte (`playbook`/`closingPlaybook`,
     * je `undefined`, wenn der Editor fehlt). Scheitert ein Schritt, bleibt der
     * Bearbeitungsmodus stehen — ein gescheitertes Speichern darf nicht wie ein
     * gelungenes aussehen; den Fehler zeigt der zentrale db.js-Hinweis.
     */
    async function speichern(e, html = {}) {
        speichertId.value = e.tradeId
        try {
            if (html.playbook !== undefined) e.playbook = html.playbook
            if (html.closingPlaybook !== undefined) e.closingPlaybook = html.closingPlaybook
            const note = (e.playbook || '').trim() ? e.playbook : LEERE_NOTIZ

            // Gefundene Bilder festschreiben — aber nur, wenn die Trade-ID im
            // Namen steht; ein über Tag/Symbol geratenes Bild bleibt ungebunden (A-P5).
            for (const feld of FELDER) {
                const idFeld = ID_FELD[feld]
                if (e[idFeld]) continue
                const treffer = bildTreffer(e, feld)
                if (darfFestschreiben(treffer)) e[idFeld] = treffer.bild.objectId
            }

            await dbUpdate('notes', e.noteObjectId, {
                note,
                tradeType: e.tradeType || '',
                entryStressLevel: e.entryStressLevel || 0,
                emotionLevel: e.emotionLevel || 0,
                entryNote: e.entryNote || '',
                feelings: e.feelings || '',
                playbook: e.playbook || '',
                timeframe: e.timeframe || '',
                screenshotId: e.screenshotId || '',
                trendScreenshotId: e.trendScreenshotId || '', // A-P1 behoben
                closingTradeType: e.closingTradeType || '',
                closingNote: e.closingNote || '',
                closingStressLevel: e.closingStressLevel || 0,
                closingEmotionLevel: e.closingEmotionLevel || 0,
                closingFeelings: e.closingFeelings || '',
                closingTimeframe: e.closingTimeframe || '',
                closingPlaybook: e.closingPlaybook || '',
                closingScreenshotId: e.closingScreenshotId || '',
            })
            e.note = note

            if (e.satisfactionObjectId) {
                await dbUpdate('satisfactions', e.satisfactionObjectId, { satisfaction: e.satisfaction })
            } else if (e.satisfaction !== null) {
                const z = await dbCreate('satisfactions', { dateUnix: e.dateUnix, tradeId: e.tradeId, satisfaction: e.satisfaction })
                e.satisfactionObjectId = z?.objectId ?? null
            }

            const tags = e.tags.map(t => t.id)
            const closingTags = e.closingTags.map(t => t.id)
            if (e.tagRecordObjectId) {
                await dbUpdate('tags', e.tagRecordObjectId, { tags, closingTags })
            } else if (tags.length || closingTags.length) {
                const z = await dbCreate('tags', { dateUnix: e.dateUnix, tradeId: e.tradeId, tags, closingTags })
                e.tagRecordObjectId = z?.objectId ?? null
            }
            // Neu hinzugefügte Tags kennen ihre Farbe noch nicht.
            e.tags = loeseTags(tags, useGetTagInfo)
            e.closingTags = loeseTags(closingTags, useGetTagInfo)

            schnappschuss = null
            bearbeitenId.value = null
            return true
        } catch (fehler) {
            console.error('Playbook: Speichern fehlgeschlagen', fehler)
            return false
        } finally {
            speichertId.value = null
        }
    }

    // ── Bilder (P.8) ──────────────────────────────────────────────────────

    function bildTreffer(e, feld) {
        const treffer = findeBild(e, feld, bilder)
        if (treffer && ausgeblendet[`${e.tradeId}:${feld}`] === treffer.bild.objectId) return null
        return treffer
    }

    /** Ein Feld ist belegt, wenn eine ID gesetzt ist ODER die Suche ein Bild findet. */
    const feldBelegt = (e, feld) => !!e[ID_FELD[feld]] || !!bildTreffer(e, feld)

    /** Ziel der Eröffnungs-Ablage: das Eröffnungsfeld, wenn leer, sonst das Trendfeld. */
    function eroeffnungsZiel(e) {
        if (!feldBelegt(e, 'entry')) return 'entry'
        if (!feldBelegt(e, 'trend')) return 'trend'
        return null
    }

    function holeBild(objectId) {
        const id = String(objectId)
        if (bildDaten[id]) return
        bildDaten[id] = 'laedt'
        dbGet('screenshots', id)
            .then(z => {
                bildDaten[id] = z && (z.annotatedBase64 || z.originalBase64)
                    ? { original: z.originalBase64 || '', annotated: z.annotatedBase64 || '', markersOnly: z.markersOnly }
                    : 'fehlt'
            })
            .catch(() => { bildDaten[id] = 'fehlt' })
    }

    /**
     * Bildquelle eines Feldes. Anzeige = `annotatedBase64`, ersatzweise das
     * Original (A-S1); Altzeilen, deren `annotatedBase64` nur die Markierungsebene
     * ist (`markersOnly` = 1 und vom Original verschieden), zeigen Original +
     * Ebene darüber.
     */
    function bildQuelle(e, feld) {
        const frisch = vorschau[`${e.tradeId}:${feld}`]
        if (frisch && bearbeitenId.value === e.tradeId) return { basis: frisch, ebene: '', laedt: false }
        const treffer = bildTreffer(e, feld)
        if (!treffer) return null
        // Geholt wird in `PlaybookBild` (watchEffect), nicht hier: diese Funktion
        // läuft beim Zeichnen, und Zustand ändern beim Zeichnen stösst neues Zeichnen an.
        const daten = bildDaten[treffer.bild.objectId]
        if (!daten || daten === 'laedt') return { basis: '', ebene: '', laedt: true }
        if (daten === 'fehlt') return null
        const nurEbene = Number(daten.markersOnly) === 1 && daten.original && daten.annotated && daten.annotated !== daten.original
        return nurEbene
            ? { basis: daten.original, ebene: daten.annotated, laedt: false }
            : { basis: daten.annotated || daten.original, ebene: '', laedt: false }
    }

    /**
     * Kern jedes Hochladens: SOFORT eine Bildzeile anlegen (nicht erst beim
     * Speichern). In die Notiz kommt die ID mit „Speichern“.
     */
    async function ladeHoch(e, feld, datenUrl) {
        if (!feld || !datenUrl) return
        const zeile = {
            name: `${e.tradeId}_${feld}`,
            symbol: e.symbol || '',
            side: e.side === 'long' || e.side === 'short' ? e.side : '',
            broker: selectedBroker.value || 'bitunix',
            originalBase64: datenUrl,
            annotatedBase64: datenUrl,
            // Anzeigebild = vollständiges Bild (Entscheidung A-S1), keine Ebene.
            markersOnly: false,
            maState: {},
            dateUnix: e.dateUnix,
            dateUnixDay: e.dateUnix,
        }
        const neu = await dbCreate('screenshots', zeile)
        const id = String(neu?.objectId ?? '')
        if (!id) return
        e[ID_FELD[feld]] = id
        vorschau[`${e.tradeId}:${feld}`] = datenUrl
        delete ausgeblendet[`${e.tradeId}:${feld}`]
        const { originalBase64, annotatedBase64, maState, ...ohneDaten } = zeile
        bilder.push({ ...ohneDaten, objectId: id, markersOnly: 0 })
        bildDaten[id] = { original: datenUrl, annotated: datenUrl, markersOnly: 0 }
    }

    function leseDatei(datei) {
        return new Promise((ok, fehl) => {
            const r = new FileReader()
            r.onload = () => ok(r.result)
            r.onerror = () => fehl(r.error)
            r.readAsDataURL(datei)
        })
    }

    async function ladeDateiHoch(e, feld, datei) {
        if (!datei || !String(datei.type).startsWith('image/')) return
        try {
            await ladeHoch(e, feld, await leseDatei(datei))
        } catch (fehler) {
            console.error('Playbook: Bild hochladen fehlgeschlagen', fehler)
        }
    }

    /**
     * „Kopiertes Bild einfügen“: das gemerkte Bild frisch holen und als KOPIE
     * anlegen — eine neue Zeile, damit Entfernen hier das Original nicht trifft.
     */
    async function kopiertesEinfuegen(e, feld) {
        const merk = kopiertesBild.value
        if (!merk?.objectId || !feld) return
        try {
            const z = await dbGet('screenshots', merk.objectId)
            const url = z?.annotatedBase64 || z?.originalBase64
            if (!url) return
            await ladeHoch(e, feld, url)
        } catch (fehler) {
            console.error('Playbook: kopiertes Bild nicht gefunden', fehler)
        }
    }

    /**
     * Entfernen wirkt sofort, ohne Rückfrage, auch wenn danach „Abbrechen“
     * kommt (das sagt der Hinweistext in der Bearbeitung).
     */
    async function entferne(e, feld) {
        const idFeld = ID_FELD[feld]
        const treffer = bildTreffer(e, feld)
        const bild = e[idFeld] ? bilder.find(b => b.objectId === String(e[idFeld])) : treffer?.bild
        const loeschbar = darfLoeschen(e, feld, bild)

        e[idFeld] = ''
        delete vorschau[`${e.tradeId}:${feld}`]
        try {
            if (e.noteObjectId) await dbUpdate('notes', e.noteObjectId, { [idFeld]: '' })
        } catch (fehler) {
            console.error('Playbook: Bild-ID in der Notiz nicht geleert', fehler)
        }

        if (loeschbar) {
            try {
                await dbDelete('screenshots', bild.objectId)
                const i = bilder.findIndex(b => b.objectId === bild.objectId)
                if (i >= 0) bilder.splice(i, 1)
                delete bildDaten[bild.objectId]
            } catch (fehler) {
                console.error('Playbook: Bild löschen fehlgeschlagen', fehler)
            }
        }
        // Was danach noch über die unsichere Suche gefunden würde, nicht wieder zeigen.
        const rest = bildTreffer(e, feld)
        if (rest && !darfLoeschen(e, feld, rest.bild)) ausgeblendet[`${e.tradeId}:${feld}`] = rest.bild.objectId
    }

    /** Seitenweites Strg/Cmd+V: Bild in das ERSTE freie Feld (Eröffnung, Trend, Abschluss). */
    function beiEinfuegen(ereignis) {
        if (!bearbeitenId.value) return
        const e = eintraege.find(x => x.tradeId === bearbeitenId.value)
        if (!e) return
        const posten = [...(ereignis.clipboardData?.items || [])].find(p => p.kind === 'file' && String(p.type).startsWith('image/'))
        if (!posten) return
        ereignis.preventDefault()
        const feld = FELDER.find(f => !feldBelegt(e, f))
        if (!feld) return
        ladeDateiHoch(e, feld, posten.getAsFile())
    }

    return {
        eintraege, bilder, bildDaten, vorschau, offenId, bearbeitenId, speichertId, ziehMerker, vollbild,
        nichtGefunden, aufgeklappteGruppen, zugeklappteProtokolle, kopiertesBild,
        start, umschalten, bearbeiten, abbrechen, speichern,
        bildTreffer, feldBelegt, eroeffnungsZiel, bildQuelle, holeBild, ladeDateiHoch, kopiertesEinfuegen, entferne, beiEinfuegen,
        zeigeVollbild: (quelle) => { vollbild.value = quelle },
    }
}

export const PLAYBOOK_SCHLUESSEL = SCHLUESSEL
export const usePlaybook = () => inject(SCHLUESSEL)
