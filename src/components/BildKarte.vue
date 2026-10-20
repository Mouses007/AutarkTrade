<script setup>
/**
 * Bildkarte eines Screenshots (Spec S.5): Kopf, Infozeile mit Tags,
 * Werkzeuge (Vergrössern, Markieren, Kopieren, Löschen) und das Bild.
 *
 * Anzeige: `annotatedBase64` ist seit dem Neubau das vollständige Bild
 * (Original + eingebrannte Markierung). Altzeilen, deren `annotatedBase64` nur
 * die transparente Markierungsebene von markerjs2 enthält (`markersOnly` = 1
 * und vom Original verschieden), zeigt die Karte weiter als Original + Ebene,
 * bis sie neu markiert und damit eingebrannt werden.
 *
 * „Bearbeiten“ gibt es nicht mehr (A-S5): es lud nur die Seite neu.
 */
import { ref, computed, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import Symbol from './basis/Symbol.vue'
import { tags } from '../stores/journal/tagebuch.js'
import { kopiertesBild, markierterEintrag } from '../stores/app/rahmen.js'
import { zeigeImVollbild } from '../utils/bilder/vollbild.js'
import { oeffneMarkierung, loescheVorgemerktesBild } from '../utils/bilder/bearbeiten.js'
import { formDatumLang, formUhrzeitSek, formUhrzeit } from '../utils/journal/format.js'
import { tagAngaben } from '../utils/journal/tagebuch.js'
import { ladeBild } from '../utils/bildmarkierung.js'

const props = defineProps({
    /** Eine Zeile aus `screenshots`. */
    bild: { type: Object, default: () => ({}) },
    /** 'seite' (Seite Bilder: Kopf, Werkzeuge) oder 'vollbild' (Infozeile, keine Werkzeuge). */
    herkunft: { type: String, default: 'seite' },
    /** Index in der UNGEFILTERTEN geladenen Liste — dort blättert das Vollbild. */
    index: { type: Number, default: undefined },
})

const { t } = useI18n()

const d = computed(() => props.bild || {})
const hatId = computed(() => d.value.objectId != null && d.value.objectId !== '')
const aufSeite = computed(() => props.herkunft === 'seite')
const bildId = computed(() => `screenshotDiv-${props.herkunft}-${hatId.value ? d.value.objectId : d.value.dateUnix}`)

/** Alte Markierungsebene über dem Original? (siehe Kopfkommentar) */
const istEbene = computed(() => {
    const x = d.value
    const alt = x.markersOnly === 1 || x.markersOnly === true || x.markersOnly === '1'
    return alt && !!x.originalBase64 && !!x.annotatedBase64 && x.annotatedBase64 !== x.originalBase64
})
const grundbild = computed(() => (istEbene.value ? d.value.originalBase64 : (d.value.annotatedBase64 || d.value.originalBase64 || '')))

const mitWerkzeug = computed(() => props.herkunft !== 'vollbild')
const kurz = computed(() => d.value.side === 'SS' || d.value.side === 'BC' || d.value.side === 'short')
const zeit = computed(() => {
    if (d.value.dateUnix == null) return ''
    return d.value.side ? formUhrzeitSek(d.value.dateUnix) : formUhrzeit(d.value.dateUnix)
})

const bildTags = computed(() => {
    const zeile = tags.find(x => x.tradeId === d.value.name)
    const ids = Array.isArray(zeile?.tags) ? zeile.tags : []
    return {
        sichtbar: ids.slice(0, 2).map(id => {
            const info = tagAngaben(id)
            return { id, name: info.name, farbe: info.farbe }
        }),
        mehr: Math.max(0, ids.length - 2),
    }
})

// ── Werkzeuge ──

function vergroessern() {
    if (!hatId.value) return
    zeigeImVollbild(props.index, d.value)
}

function markieren() {
    oeffneMarkierung(d.value)
}

// Kopieren
const kopierStatus = ref('') // '' | 'ok'
let kopierUhr = null

/** Bilder übereinander in ein PNG — die System-Zwischenablage nimmt nur PNG. */
async function alsPng(urls) {
    const bilder = []
    for (const url of urls) bilder.push(await ladeBild(url))
    const canvas = document.createElement('canvas')
    canvas.width = bilder[0].naturalWidth
    canvas.height = bilder[0].naturalHeight
    const ctx = canvas.getContext('2d')
    for (const b of bilder) ctx.drawImage(b, 0, 0, canvas.width, canvas.height)
    return new Promise((ok, fehler) => canvas.toBlob(b => (b ? ok(b) : fehler(new Error('PNG fehlgeschlagen'))), 'image/png'))
}

async function kopieren() {
    const quelle = d.value.annotatedBase64 || d.value.originalBase64
    if (!quelle) return
    // App-interne Ablage: nur die Kennung; wer einfügt, holt das Bild frisch aus der DB.
    const merk = { objectId: d.value.objectId, name: d.value.name || 'screenshot' }
    kopiertesBild.value = merk
    try { sessionStorage.setItem('kopiertesBild', JSON.stringify(merk)) } catch { /* egal */ }
    kopierStatus.value = 'ok'
    clearTimeout(kopierUhr)
    kopierUhr = setTimeout(() => { kopierStatus.value = '' }, 1500)
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof ClipboardItem !== 'undefined' && window.isSecureContext) {
        try {
            const urls = istEbene.value ? [d.value.originalBase64, d.value.annotatedBase64] : [quelle]
            const blob = await alsPng(urls)
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        } catch { /* System-Zwischenablage ist eine Zugabe — still */ }
    }
}

// Löschen mit Rückfrage an Ort und Stelle (ersetzt das Bootstrap-Popover).
const fragtLoeschen = ref(false)
const loescht = ref(false)

function loeschenFragen() {
    markierterEintrag.value = d.value.objectId
    fragtLoeschen.value = true
}
async function loeschenJa() {
    loescht.value = true
    markierterEintrag.value = d.value.objectId
    try { await loescheVorgemerktesBild() } finally {
        loescht.value = false
        fragtLoeschen.value = false
    }
}
function loeschenNein() {
    markierterEintrag.value = null
    fragtLoeschen.value = false
}

onBeforeUnmount(() => clearTimeout(kopierUhr))
</script>

<template>
    <div class="sk" :class="'q-' + herkunft">
        <div v-if="aufSeite && d.dateUnix != null" class="kopf">
            {{ formDatumLang(d.dateUnix) }}
        </div>

        <div class="zeile">
            <div class="info">
                <span class="symbol">{{ d.symbol }}</span>
                <span v-if="d.side" class="seite" :class="kurz ? 'at-schlecht' : 'at-gut'">{{ kurz ? t('nav.short') : t('nav.long') }}</span>
                <span v-if="zeit" class="at-gedaempft">{{ zeit }}</span>
                <span v-for="tag in bildTags.sichtbar" :key="tag.id" class="tag" :style="{ '--tagfarbe': tag.farbe }">{{ tag.name }}</span>
                <span v-if="bildTags.mehr" class="tag mehr">+{{ bildTags.mehr }}</span>
            </div>

            <div v-if="mitWerkzeug" class="werkzeuge">
                <template v-if="!fragtLoeschen">
                    <button v-if="hatId" type="button" class="wz" :title="t('common.enlarge')"
                        :aria-label="t('common.enlarge')" @click="vergroessern">
                        <Symbol name="vergroessern" :groesse="17" />
                    </button>
                    <button type="button" class="wz" :title="t('screenshots.markieren')" :aria-label="t('screenshots.markieren')" @click="markieren">
                        <Symbol name="stift" :groesse="17" />
                    </button>
                    <button v-if="hatId" type="button" class="wz" :class="{ ok: kopierStatus === 'ok' }"
                        :title="kopierStatus === 'ok' ? t('screenshots.kopiert') : t('screenshots.kopieren')"
                        :aria-label="kopierStatus === 'ok' ? t('screenshots.kopiert') : t('screenshots.kopieren')" @click="kopieren">
                        <Symbol :name="kopierStatus === 'ok' ? 'haken' : 'kopieren'" :groesse="17" />
                    </button>
                    <button v-if="hatId" type="button" class="wz gefahr" :title="t('screenshots.loeschen')"
                        :aria-label="t('screenshots.loeschen')" @click="loeschenFragen">
                        <Symbol name="papierkorb" :groesse="17" />
                    </button>
                </template>
                <div v-else class="frage" role="alertdialog" :aria-label="t('screenshots.loeschenFrage')">
                    <span class="at-klein">{{ t('screenshots.loeschenFrage') }}</span>
                    <button type="button" class="antwort ja" :disabled="loescht" @click="loeschenJa">{{ t('screenshots.ja') }}</button>
                    <button type="button" class="antwort" :disabled="loescht" @click="loeschenNein">{{ t('screenshots.nein') }}</button>
                </div>
            </div>
        </div>

        <div class="bild" :class="{ klickbar: aufSeite && hatId }" @click="aufSeite && vergroessern()">
            <img v-if="grundbild" :id="bildId" :src="grundbild" :alt="d.symbol || t('nav.screenshots')" loading="lazy" />
            <img v-if="istEbene" class="ebene" :src="d.annotatedBase64" alt="" aria-hidden="true" />
        </div>
    </div>
</template>

<style scoped>
.sk {
    display: flex;
    flex-direction: column;
    gap: var(--abstand-2);
    min-width: 0;
}

.kopf {
    font-weight: 600;
    color: var(--text);
}

.zeile {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--abstand-2);
}

.info {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-1) var(--abstand-2);
    min-width: 0;
    font-size: 0.9rem;
}

.symbol {
    font-weight: 600;
}

.tag {
    padding: 0.05rem 0.5rem;
    border-radius: var(--radius-pille);
    background: var(--tagfarbe, var(--panel-hoch));
    color: var(--text);
    font-size: 0.78rem;
    white-space: nowrap;
}

.tag.mehr {
    background: var(--panel-hoch);
    color: var(--muted);
}

.werkzeuge {
    display: flex;
    align-items: center;
    gap: var(--abstand-1);
    margin-left: auto;
}

.wz {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: 1px solid transparent;
    border-radius: var(--radius-knopf);
    background: transparent;
    color: var(--muted);
    cursor: pointer;
}

.wz:hover {
    color: var(--accent);
    border-color: var(--line);
    background: var(--panel-soft);
}

.wz.ok {
    color: var(--good);
}

.wz.gefahr:hover {
    color: var(--bad);
}

.frage {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-2);
}

.antwort {
    padding: 0.2rem 0.7rem;
    border: 1px solid var(--line-stark);
    border-radius: var(--radius-knopf);
    background: var(--panel-soft);
    color: var(--text);
    cursor: pointer;
}

.antwort.ja {
    border-color: var(--bad);
    color: var(--bad);
}

.antwort:disabled {
    opacity: 0.5;
    cursor: wait;
}

.bild {
    position: relative;
    line-height: 0;
    border-radius: var(--radius-klein);
    overflow: hidden;
}

.bild img {
    display: block;
    width: 100%;
    height: auto;
}

.bild .ebene {
    /* Gleiche Grössenregeln wie das Grundbild (gleiches Seitenverhältnis) → deckungsgleich. */
    position: absolute;
    top: 0;
    left: 0;
}

/* Kachel auf der Seite: Bildbereich höchstens 250 px, Überlauf abgeschnitten. */
.q-seite .bild {
    max-height: 250px;
}

.klickbar {
    cursor: zoom-in;
}

/* Vollbild: ganzes Bild, so gross wie das Fenster erlaubt. */
.q-vollbild .bild {
    display: flex;
    justify-content: center;
    background: var(--bg);
}

.q-vollbild .bild img {
    width: auto;
    max-width: 100%;
    max-height: calc(100dvh - 12rem);
}

.q-vollbild .bild .ebene {
    left: 50%;
    transform: translateX(-50%);
}
</style>
