<script setup>
/**
 * Chart teilen: Vorschau des Chart-Bildes (oder eines eigenen Bildes) und die
 * Wege hinaus — Teilen-Menü des Systems (Handy: WhatsApp, Signal, Mail …),
 * Mail mit Anhang über den eingestellten SMTP-Zugang, Zwischenablage, Datei.
 *
 * Eigenes Bild: Strg+V im offenen Dialog (z. B. nach der Druck-Taste),
 * hineinziehen oder „Bild wählen …". Eine Webseite sieht die Druck-Taste nicht,
 * deshalb geht es nur über den Dialog.
 *
 * `mailto:` kennt keine Anhänge, und ein Mailprogramm lässt sich aus dem
 * Browser nicht starten — deshalb verschickt der Server (`chart-teilen.js`).
 */
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import { Dialog, Symbol, Knopf } from '../basis'
import { appEinstellungen } from '../../stores/settings.js'
import { blobZuBase64, eigenesBild } from '../../utils/chart/chartBild.js'

const props = defineProps({
    modelValue: { type: Boolean, default: false },
    /** () => Promise<Blob|null> — baut das Chart-Bild beim Öffnen */
    erzeuge: { type: Function, required: true },
    dateiname: { type: String, default: 'chart' },
    betreff: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue'])
const { t, te } = useI18n()

const offen = computed({ get: () => props.modelValue, set: (v) => emit('update:modelValue', v) })
const bild = ref(null)          // { blob, url, eigen }
const laedt = ref(false)
const meldung = ref(null)       // { art: 'gut'|'fehler', text }
const ziehen = ref(false)
const dateiFeld = ref(null)

const ADR_SCHLUESSEL = 'chartTeilenAn'
const an = ref('')
const betreffText = ref('')
const nachricht = ref('')
const sendet = ref(false)

const mailBereit = computed(() => {
    const s = appEinstellungen.value
    // Unbekannt (Einstellungen noch nicht geladen) ist kein Nein — der Server sagt es dann genau
    return !s || Number(s.mailAktiv) === 1
})
const kannTeilen = computed(() => {
    if (!bild.value || typeof navigator === 'undefined' || !navigator.canShare) return false
    try { return navigator.canShare({ files: [datei()] }) } catch { return false }
})
const kannKopieren = typeof window !== 'undefined' && 'ClipboardItem' in window && !!navigator.clipboard?.write

function datei() {
    const b = bild.value.blob
    const endung = b.type === 'image/jpeg' ? 'jpg' : 'png'
    return new File([b], `${props.dateiname}.${endung}`, { type: b.type || 'image/png' })
}

function setzeBild(blob, eigen) {
    if (bild.value?.url) URL.revokeObjectURL(bild.value.url)
    bild.value = blob ? { blob, url: URL.createObjectURL(blob), eigen } : null
}

async function chartBild() {
    laedt.value = true
    meldung.value = null
    try { setzeBild(await props.erzeuge(), false) } catch (e) { meldung.value = { art: 'fehler', text: e.message } } finally { laedt.value = false }
}

async function nimmEigenes(f) {
    try {
        const b = await eigenesBild(f)
        if (!b) { meldung.value = { art: 'fehler', text: t('chart.teilen.keinBild') }; return }
        setzeBild(b, true)
        meldung.value = null
    } catch (e) { meldung.value = { art: 'fehler', text: e.message } }
}

function einfuegen(e) {
    if (!offen.value) return
    const eintrag = [...(e.clipboardData?.items || [])].find((i) => i.kind === 'file' && i.type.startsWith('image/'))
    if (!eintrag) return
    // In ein Textfeld eingefügter Text bleibt Text; nur ein Bild wird abgefangen
    e.preventDefault()
    nimmEigenes(eintrag.getAsFile())
}
function fallen(e) {
    ziehen.value = false
    const f = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith('image/'))
    if (f) nimmEigenes(f)
}

watch(offen, (v) => {
    if (v) {
        try { an.value = localStorage.getItem(ADR_SCHLUESSEL) || appEinstellungen.value?.mailAn || '' } catch { an.value = '' }
        betreffText.value = props.betreff
        nachricht.value = ''
        chartBild()
        window.addEventListener('paste', einfuegen)
    } else {
        window.removeEventListener('paste', einfuegen)
        setzeBild(null)
        meldung.value = null
    }
}, { immediate: true })
onBeforeUnmount(() => { window.removeEventListener('paste', einfuegen); setzeBild(null) })

async function teilen() {
    try {
        await navigator.share({ files: [datei()], title: betreffText.value || props.betreff })
    } catch (e) {
        if (e?.name !== 'AbortError') meldung.value = { art: 'fehler', text: e.message }
    }
}
async function kopieren() {
    try {
        // Die Zwischenablage nimmt verlässlich nur PNG
        const b = bild.value.blob
        const png = b.type === 'image/png' ? b : await new Promise((ok) => {
            createImageBitmap(b).then((bm) => {
                const c = document.createElement('canvas')
                c.width = bm.width; c.height = bm.height
                c.getContext('2d').drawImage(bm, 0, 0)
                c.toBlob(ok, 'image/png')
            })
        })
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
        meldung.value = { art: 'gut', text: t('chart.teilen.kopiert') }
    } catch (e) { meldung.value = { art: 'fehler', text: t('chart.teilen.kopierenFehler') + ' ' + (e.message || '') } }
}
function herunterladen() {
    const a = document.createElement('a')
    a.href = bild.value.url
    a.download = datei().name
    a.click()
}
async function senden() {
    sendet.value = true
    meldung.value = null
    try {
        const b = bild.value.blob
        const { data } = await axios.post('/api/chart/teilen/mail', {
            an: an.value, betreff: betreffText.value, text: nachricht.value, dateiname: props.dateiname,
            bild: { mediaType: b.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', base64: await blobZuBase64(b) },
        }, { timeout: 60_000 })
        try { localStorage.setItem(ADR_SCHLUESSEL, an.value) } catch { /* kein Speicher */ }
        meldung.value = { art: 'gut', text: t('chart.teilen.gesendet', { an: data.an.join(', ') }) }
    } catch (e) {
        const f = e.response?.data
        const code = f?.error
        const text = code === 'versand' ? t('chart.teilen.fehler.versand', { meldung: f.meldung || '' })
            : code && te('chart.teilen.fehler.' + code) ? t('chart.teilen.fehler.' + code, { liste: (f.verworfen || []).join(', ') })
            : e.message
        meldung.value = { art: 'fehler', text }
    } finally { sendet.value = false }
}
</script>

<template>
    <Dialog v-model="offen" :titel="t('chart.teilen.titel')" breite="44rem">
        <div class="teilen" @dragover.prevent="ziehen = true" @dragleave="ziehen = false" @drop.prevent="fallen">
            <div class="vorschau" :class="{ ziehen }">
                <div v-if="laedt" class="leise">{{ t('chart.teilen.erzeugt') }}</div>
                <img v-else-if="bild" :src="bild.url" :alt="t('chart.teilen.vorschau')" />
                <div v-else class="leise">{{ t('chart.teilen.keinBild') }}</div>
            </div>
            <div class="quelle">
                <span class="leise">{{ bild?.eigen ? t('chart.teilen.eigenes') : t('chart.teilen.einfuegen') }}</span>
                <button v-if="bild?.eigen" type="button" class="textKnopf" @click="chartBild">{{ t('chart.teilen.zurueckChart') }}</button>
                <button type="button" class="textKnopf" @click="dateiFeld?.click()">{{ t('chart.teilen.waehlen') }}</button>
                <input ref="dateiFeld" type="file" accept="image/*" hidden @change="nimmEigenes($event.target.files?.[0]); $event.target.value = ''" />
            </div>
            <p v-if="bild?.eigen" class="hinweis">{{ t('chart.teilen.datenschutz') }}</p>

            <div class="wege">
                <Knopf v-if="kannTeilen" art="haupt" symbol="teilen" :disabled="!bild" @click="teilen">{{ t('chart.teilen.system') }}</Knopf>
                <Knopf v-if="kannKopieren" symbol="kopieren" :disabled="!bild" @click="kopieren">{{ t('chart.teilen.kopieren') }}</Knopf>
                <Knopf symbol="herunterladen" :disabled="!bild" @click="herunterladen">{{ t('chart.teilen.herunterladen') }}</Knopf>
            </div>

            <fieldset class="mail">
                <legend><Symbol name="nachricht" /> {{ t('chart.teilen.mailTitel') }}</legend>
                <template v-if="mailBereit">
                    <label><span>{{ t('chart.teilen.an') }}</span>
                        <input v-model="an" class="at-feld" type="text" inputmode="email" autocomplete="email" :placeholder="t('chart.teilen.anPlatzhalter')" /></label>
                    <label><span>{{ t('chart.teilen.betreff') }}</span><input v-model="betreffText" class="at-feld" type="text" maxlength="150" /></label>
                    <label><span>{{ t('chart.teilen.text') }}</span><textarea v-model="nachricht" class="at-feld" rows="2" maxlength="2000"></textarea></label>
                    <div class="senden">
                        <Knopf art="haupt" symbol="nachricht" :laedt="sendet" :disabled="!bild || !an.trim() || sendet" @click="senden">{{ t('chart.teilen.senden') }}</Knopf>
                    </div>
                </template>
                <p v-else class="leise">{{ t('chart.teilen.mailFehlt') }}
                    <RouterLink to="/einstellungen/benachrichtigungen" @click="offen = false">{{ t('chart.teilen.mailEinrichten') }}</RouterLink></p>
            </fieldset>

            <p v-if="meldung" class="meldung" :class="meldung.art" role="status">{{ meldung.text }}</p>
        </div>
    </Dialog>
</template>

<style scoped>
.teilen {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.vorschau {
    min-height: 140px;
    max-height: 46vh;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px dashed var(--line);
    border-radius: var(--radius-klein);
    overflow: hidden;
    background: var(--bg);
}

.vorschau.ziehen {
    border-color: var(--accent);
}

.vorschau img {
    max-width: 100%;
    max-height: 46vh;
    object-fit: contain;
}

.quelle {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    font-size: 12px;
}

.textKnopf {
    background: none;
    border: none;
    padding: 0;
    color: var(--accent);
    cursor: pointer;
    font-size: 12px;
}

.leise {
    color: var(--muted);
    font-size: 12px;
}

.hinweis {
    margin: 0;
    color: var(--warn);
    font-size: 12px;
}

.wege {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.mail {
    border: 1px solid var(--line);
    border-radius: var(--radius-klein);
    padding: 8px 10px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
}

.mail legend {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 4px;
    font-size: 13px;
}

.mail label {
    display: grid;
    grid-template-columns: 70px 1fr;
    align-items: center;
    gap: 8px;
    font-size: 12px;
}

.mail label span {
    color: var(--muted);
}

.senden {
    display: flex;
    justify-content: flex-end;
}

.meldung {
    margin: 0;
    font-size: 12px;
}

.meldung.gut {
    color: var(--good);
}

.meldung.fehler {
    color: var(--bad);
}
</style>
