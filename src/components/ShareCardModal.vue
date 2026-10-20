<script setup>
/**
 * Share-Karte eines Trades: KI-Hintergrund (FLUX.2) oder gespeicherte Vorlage
 * plus Overlay, zum Herunterladen oder Teilen.
 *
 * Ein nativer <dialog> (`basis/Dialog`): geöffnet aus dem Trade-Detailfenster
 * der Tagesansicht, das selbst ein <dialog> ist — der später geöffnete liegt
 * im Top-Layer oben, ein Teleport an `body` ist nicht mehr nötig.
 * Props (`trade`, `visible`) und Ereignis (`close`) sind unverändert.
 */
import { zeichneShareCard } from '../utils/shareCardBild.js'
import { ref, computed, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import { useVorlagenKategorieLabel } from '../utils/journal/format.js'
import Dialog from './basis/Dialog.vue'
import Knopf from './basis/Knopf.vue'
import Pille from './basis/Pille.vue'
import Symbol from './basis/Symbol.vue'
import Hinweis from './basis/Hinweis.vue'
import Kreisel from './basis/Kreisel.vue'
import KiHinweis from './quellen/KiHinweis.vue'
import { appEinstellungen } from '../stores/app/rahmen.js'

const { t } = useI18n()

const props = defineProps({
    trade: Object,
    visible: Boolean
})

const emit = defineEmits(['close'])

const generating = ref(false)
const generatedImage = ref(null)
const error = ref('')
const promptText = ref('')
const promptCollapsed = ref(true)
const hidePnlAmount = ref(false)
const showTags = ref(true)
const showRrr = ref(true)
const commentText = ref('')

// ====== Template state ======
const templates = ref([])
const selectedTemplateId = ref(null) // null = "Neu generieren"
// Eigenes Dropdown statt <select>: native <option>s können kein farbiges
// Long/Short-Badge tragen, nur Klartext (Browser-Grenze, kein HTML in <option>).
const hgOffen = ref(false)
const hgKnopfEl = ref(null)
const hgWahlEl = ref(null)
const selectedTemplate = computed(() =>
    templates.value.find((t) => String(t.id) === String(selectedTemplateId.value)) || null)

function hgWaehlen(id) {
    selectedTemplateId.value = id
    hgOffen.value = false
    hgKnopfEl.value?.focus()
}

// Sobald das Panel öffnet, Fokus auf die aktive (oder erste) Zeile setzen —
// sonst bliebe der Fokus auf dem Knopf stehen und Pfeiltasten liefen ins Leere.
watch(hgOffen, async (offen) => {
    if (!offen) return
    await nextTick()
    const aktiv = hgWahlEl.value?.querySelector('.hgZeile.hgAktiv') || hgWahlEl.value?.querySelector('.hgZeile')
    aktiv?.focus()
})

/** Pfeiltasten wandern zwischen den Zeilen, Escape schliesst und gibt den Fokus zurück. */
function hgWahlKeydown(event) {
    if (event.key === 'Escape') {
        // Nur die Liste schliessen, nicht den ganzen <dialog> (Esc schliesst ihn sonst nativ)
        event.preventDefault()
        event.stopPropagation()
        hgOffen.value = false
        hgKnopfEl.value?.focus()
        return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const zeilen = [...(hgWahlEl.value?.querySelectorAll('.hgZeile') || [])]
    const idx = zeilen.indexOf(document.activeElement)
    const naechste = event.key === 'ArrowDown'
        ? zeilen[(idx + 1) % zeilen.length]
        : zeilen[(idx - 1 + zeilen.length) % zeilen.length]
    naechste?.focus()
}
const lastBackgroundBase64 = ref('') // raw BG from last generation (for saving)
const savingTemplate = ref(false)
const templateName = ref('')
const showSaveForm = ref(false)
const deletingTemplateId = ref(null)

function smartDecimals(price) {
    const p = Number(price || 0)
    if (p === 0) return '0'
    if (p >= 100) return p.toFixed(2)
    if (p >= 1) return p.toFixed(4)
    if (p >= 0.01) return p.toFixed(5)
    return p.toFixed(6)
}

// Load templates from DB
async function loadTemplates() {
    try {
        const res = await axios.get('/api/db/share_card_templates', {
            params: { sort: '-createdAt' }
        })
        // API returns rows with objectId mapping
        templates.value = (res.data.results || res.data || []).map(r => ({
            id: r.objectId || r.id,
            name: r.name,
            category: r.category || '',
            imageBase64: r.imageBase64 || '',
            createdAt: r.createdAt
        }))
    } catch (e) {
        console.warn('Could not load templates:', e.message)
        templates.value = []
    }
}

// Auto-generate prompt when trade changes
watch(() => props.trade, (trade) => {
    if (!trade) return
    generatedImage.value = null
    error.value = ''
    selectedTemplateId.value = null
    showSaveForm.value = false
    hgOffen.value = false
    lastBackgroundBase64.value = ''
    promptText.value = buildClientPrompt(trade)
}, { immediate: true })

// Load templates when modal becomes visible
watch(() => props.visible, (vis) => {
    if (vis) loadTemplates()
})

// When selecting a template, show preview instantly
watch(selectedTemplateId, async (id) => {
    if (!id) {
        // "Neu generieren" selected — clear preview, restore default prompt
        generatedImage.value = null
        lastBackgroundBase64.value = ''
        showSaveForm.value = false
        if (props.trade) promptText.value = buildClientPrompt(props.trade)
        return
    }

    // Use template — generate with saved background (no API call)
    const tpl = templates.value.find(t => String(t.id) === String(id))
    if (!tpl) return

    generating.value = true
    error.value = ''
    generatedImage.value = null
    showSaveForm.value = false

    try {
        const res = await axios.post('/api/flux/generate-from-template', {
            templateId: tpl.id,
            trade: props.trade,
            hidePnlAmount: hidePnlAmount.value,
            showTags: showTags.value,
            showRrr: showRrr.value,
            comment: commentText.value
        })
        generatedImage.value = await zeichneShareCard(res.data)
        lastBackgroundBase64.value = '' // template BG already saved
    } catch (e) {
        error.value = e.response?.data?.error || e.message
    }
    generating.value = false
})

function buildClientPrompt(trade) {
    if (!trade) return ''
    const isWin = (trade.netProceeds || 0) > 0
    const animal = isWin ? 'wallstreet bull' : 'bear'
    let mood, scene
    if (isWin) {
        mood = 'triumphant, golden rim lighting, epic atmosphere, glory'
        scene = 'bipedal bull, exactly four limbs total, beautiful city landscape with dramatic sunset, golden hour light'
    } else {
        mood = 'dramatic, moody blue lighting, rain, defeated atmosphere, failure'
        scene = 'on all four legs collapsed face-first onto the ground on a rainy city rooftop at night, four-legged animal lying defeated, neon reflections on wet ground'
    }
    return `Epic digital art of a powerful ${animal} in a dramatic pose, ${scene}, ${mood}, cinematic composition, crypto trading theme, professional illustration, ultra detailed, 4k quality. Clean image without any text or watermarks.`
}

// Trade summary computed
const tradeSummary = computed(() => {
    const t = props.trade
    if (!t) return {}
    const isWin = (t.netProceeds || 0) > 0
    const dir = t.strategy === 'long' ? 'Long' : 'Short'
    const lev = t.leverage || 1
    let pnlPercent = 0
    if (t.entryPrice && t.exitPrice && t.entryPrice !== 0) {
        const priceDiff = t.strategy === 'long'
            ? (t.exitPrice - t.entryPrice) / t.entryPrice
            : (t.entryPrice - t.exitPrice) / t.entryPrice
        pnlPercent = priceDiff * lev * 100
    }
    return {
        symbol: (t.symbol || '').replace(/USDT$/, 'USDT'),
        direction: dir,
        leverage: lev > 1 ? `${lev}X` : '',
        pnlPercent: `${isWin ? '+' : ''}${pnlPercent.toFixed(2)}%`,
        pnlAmount: hidePnlAmount.value ? '••••• USDT' : `${isWin ? '+' : ''}${(t.netProceeds || 0).toFixed(2)} USDT`,
        entryPrice: smartDecimals(t.entryPrice),
        exitPrice: smartDecimals(t.exitPrice),
        tagNames: t.tagNames || [],
        rrr: t.rrr || '',
        isWin,
        isLong: t.strategy === 'long'
    }
})

/**
 * Gefilterte Vorlagen nach Ausgang, nicht nach Richtung.
 *
 * Das Motiv (Bulle triumphierend vs. Bulle am Boden im Regen, siehe
 * `buildClientPrompt`) folgt Gewinn/Verlust — ein Long-Trade kann verlieren
 * und ein Short-Trade gewinnen, die Stimmung des Bilds hat mit der Richtung
 * nichts zu tun. Vorher stand hier `long`/`short`: „Friedhof der Bullen"
 * (ein Verlust-Bild) war als `long` einsortiert und tauchte bei jedem
 * gewonnenen Long-Trade zwischen den triumphierenden Bildern auf.
 */
const filteredTemplates = computed(() => {
    const cat = tradeSummary.value.isWin ? 'win' : 'loss'
    // Show matching category + uncategorized templates
    return templates.value.filter(t => !t.category || t.category === cat)
})

async function generateShareCard() {
    generating.value = true
    error.value = ''
    generatedImage.value = null
    showSaveForm.value = false

    try {
        const tradeWithLeverage = { ...props.trade }
        const res = await axios.post('/api/flux/generate', {
            trade: tradeWithLeverage,
            prompt: promptText.value,
            hidePnlAmount: hidePnlAmount.value,
            showTags: showTags.value,
            showRrr: showRrr.value,
            comment: commentText.value
        })
        generatedImage.value = await zeichneShareCard(res.data)
        // Store raw background for template saving
        lastBackgroundBase64.value = res.data.backgroundImage || ''
    } catch (e) {
        const msg = e.response?.data?.error || e.message
        error.value = msg
    }
    generating.value = false
}

// Save current background as template
async function saveAsTemplate() {
    if (!templateName.value.trim()) return
    if (!lastBackgroundBase64.value) {
        error.value = t('daily.shareCardKeinHintergrund')
        return
    }

    savingTemplate.value = true
    error.value = ''

    try {
        const isWin = (props.trade?.netProceeds || 0) > 0
        await axios.post('/api/db/share_card_templates', {
            name: templateName.value.trim(),
            imageBase64: lastBackgroundBase64.value,
            category: isWin ? 'win' : 'loss'
        })
        templateName.value = ''
        showSaveForm.value = false
        await loadTemplates()
    } catch (e) {
        error.value = e.response?.data?.error || e.message
    }
    savingTemplate.value = false
}

// Delete a template
async function deleteTemplate(id) {
    if (!confirm(t('daily.shareCardVorlageLoeschenFrage'))) return
    deletingTemplateId.value = id
    try {
        await axios.delete(`/api/db/share_card_templates/${id}`)
        if (String(selectedTemplateId.value) === String(id)) {
            selectedTemplateId.value = null
        }
        await loadTemplates()
    } catch (e) {
        error.value = e.response?.data?.error || e.message
    }
    deletingTemplateId.value = null
}

function downloadImage() {
    if (!generatedImage.value) return
    const symbol = (props.trade?.symbol || 'trade').replace(/[^a-zA-Z0-9]/g, '')
    const a = document.createElement('a')
    a.href = generatedImage.value
    a.download = `sharecard-${symbol}-${Date.now()}.png`
    a.click()
}

async function shareImage() {
    if (!generatedImage.value) return
    const symbol = (props.trade?.symbol || 'Trade').replace(/USDT$/, '/USDT')
    const dir = props.trade?.strategy === 'long' ? 'Long' : 'Short'
    const filename = `sharecard-${symbol.replace(/[^a-zA-Z0-9]/g, '')}-${Date.now()}.png`

    try {
        const res = await fetch(generatedImage.value)
        const blob = await res.blob()
        const file = new File([blob], filename, { type: 'image/png' })

        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({
                title: t('daily.shareCardTeilenTitel', { symbol, dir }),
                text: t('daily.shareCardTeilenText', { symbol, dir }),
                files: [file]
            })
        } else {
            downloadImage()
            await new Promise(r => setTimeout(r, 500))
            const subject = encodeURIComponent(t('daily.shareCardTeilenTitel', { symbol, dir }))
            const body = encodeURIComponent(t('daily.shareCardMailText', { symbol, dir }))
            window.open(`mailto:?subject=${subject}&body=${body}`, '_self')
        }
    } catch (e) {
        if (e.name !== 'AbortError') console.error('Share failed:', e)
    }
}

function closeModal() {
    // Der <dialog> meldet sein Schliessen ein zweites Mal, nachdem der Aufrufer `visible` schon auf falsch gesetzt hat
    if (!props.visible) return
    generatedImage.value = null
    error.value = ''
    showSaveForm.value = false
    emit('close')
}
</script>

<template>
    <Dialog :model-value="visible" :titel="t('daily.shareCard')" breite="48rem" @zu="closeModal">
        <div class="share">
            <!-- Trade-Zusammenfassung -->
            <div class="zusammenfassung">
                <div class="kopfzeile">
                    <span class="symbol">{{ tradeSummary.symbol }}</span>
                    <Pille :ton="tradeSummary.isLong ? 'gut' : 'schlecht'">{{ tradeSummary.direction }}</Pille>
                    <Pille v-if="tradeSummary.leverage" ton="neutral">{{ tradeSummary.leverage }}</Pille>
                    <Pille v-if="tradeSummary.rrr && showRrr" ton="akzent">RRR 1:{{ tradeSummary.rrr }}</Pille>
                </div>
                <div v-if="tradeSummary.tagNames?.length && showTags" class="tags">
                    <Pille v-for="(tag, i) in tradeSummary.tagNames" :key="i" ton="neutral">{{ tag }}</Pille>
                </div>
                <div class="werte">
                    <div>
                        <span class="name">PnL</span>
                        <span :class="['at-fett', tradeSummary.isWin ? 'at-gut' : 'at-schlecht']">{{ tradeSummary.pnlPercent }}</span>
                        <span :class="['klein', tradeSummary.isWin ? 'at-gut' : 'at-schlecht']">{{ tradeSummary.pnlAmount }}</span>
                    </div>
                    <div>
                        <span class="name">{{ t('daily.entry') }}</span>
                        <span>{{ tradeSummary.entryPrice }}</span>
                    </div>
                    <div>
                        <span class="name">{{ t('daily.colExit') }}</span>
                        <span>{{ tradeSummary.exitPrice }}</span>
                    </div>
                    <div v-if="tradeSummary.leverage" class="hebel">
                        <span class="name">{{ t('daily.leverage') }}</span>
                        <span class="at-fett">{{ tradeSummary.leverage }}</span>
                    </div>
                </div>
            </div>

            <!-- Hintergrund-Auswahl -->
            <div v-if="templates.length > 0" class="feld">
                <span class="at-label"><Symbol name="ebenen" /> {{ t('daily.shareCardHintergrund') }}</span>
                <div class="hgReihe">
                    <!-- Eigenes Dropdown statt <select>: native <option>s können kein
                         farbiges Gewinn/Verlust-Abzeichen tragen. Die Tastatursteuerung,
                         die ein <select> kostenlos mitbringt, ist deshalb von Hand
                         nachgebaut (Pfeiltasten, Enter/Leertaste, Escape). -->
                    <button ref="hgKnopfEl" type="button" class="at-feld hgKnopf" :disabled="generating"
                        aria-haspopup="listbox" :aria-expanded="hgOffen" @click="hgOffen = !hgOffen">
                        <template v-if="selectedTemplate">
                            <span class="at-kuerzen">{{ selectedTemplate.name }}</span>
                            <Pille v-if="selectedTemplate.category" :ton="selectedTemplate.category === 'win' ? 'gut' : 'schlecht'">
                                {{ useVorlagenKategorieLabel(selectedTemplate.category) }}
                            </Pille>
                        </template>
                        <span v-else>{{ t('daily.shareCardNeu') }}</span>
                        <Symbol name="runter" class="pfeil" />
                    </button>
                    <template v-if="hgOffen">
                        <div class="hgHinter" @click="hgOffen = false"></div>
                        <div ref="hgWahlEl" class="hgWahl" role="listbox" @keydown="hgWahlKeydown">
                            <div class="hgZeile" role="option" tabindex="0" :aria-selected="!selectedTemplateId"
                                :class="{ hgAktiv: !selectedTemplateId }"
                                @click="hgWaehlen(null)" @keydown.enter.prevent="hgWaehlen(null)" @keydown.space.prevent="hgWaehlen(null)">
                                {{ t('daily.shareCardNeu') }}
                            </div>
                            <div v-for="tpl in filteredTemplates" :key="tpl.id" class="hgZeile" role="option" tabindex="0"
                                :aria-selected="String(selectedTemplateId) === String(tpl.id)"
                                :class="{ hgAktiv: String(selectedTemplateId) === String(tpl.id) }"
                                @click="hgWaehlen(tpl.id)" @keydown.enter.prevent="hgWaehlen(tpl.id)" @keydown.space.prevent="hgWaehlen(tpl.id)">
                                <span class="at-kuerzen">{{ tpl.name }}</span>
                                <Pille v-if="tpl.category" :ton="tpl.category === 'win' ? 'gut' : 'schlecht'">{{ useVorlagenKategorieLabel(tpl.category) }}</Pille>
                            </div>
                        </div>
                    </template>
                    <Knopf v-if="selectedTemplateId" art="gefahr" klein nur-symbol symbol="papierkorb"
                        :titel="t('daily.shareCardVorlageLoeschen')" :disabled="deletingTemplateId === selectedTemplateId"
                        @click="deleteTemplate(selectedTemplateId)" />
                </div>
            </div>

            <!-- Optionen -->
            <div class="optionen">
                <label class="at-check schalter">
                    <input v-model="hidePnlAmount" type="checkbox" :disabled="generating" /> {{ t('daily.shareCardHidePrices') }}
                </label>
                <label v-if="tradeSummary.tagNames?.length" class="at-check schalter">
                    <input v-model="showTags" type="checkbox" :disabled="generating" /> {{ t('daily.shareCardShowTags') }}
                </label>
                <label v-if="tradeSummary.rrr" class="at-check schalter">
                    <input v-model="showRrr" type="checkbox" :disabled="generating" /> RRR
                </label>
            </div>

            <!-- Prompt (nur bei „Neu generieren") -->
            <div v-if="!selectedTemplateId" class="feld">
                <label class="at-label" for="share-prompt"><Symbol name="stift" /> {{ t('daily.shareCardPrompt') }}</label>
                <textarea id="share-prompt" v-model="promptText" class="at-feld prompt" rows="5" :disabled="generating"></textarea>
            </div>

            <!-- Kommentar -->
            <div class="feld">
                <label class="at-label" for="share-kommentar"><Symbol name="nachricht" /> {{ t('daily.shareCardComment') }}</label>
                <input id="share-kommentar" v-model="commentText" type="text" class="at-feld" :disabled="generating"
                    maxlength="130" :placeholder="t('daily.shareCardCommentHint')" />
            </div>

            <Hinweis v-if="error" art="fehler">{{ error }}</Hinweis>

            <div v-if="generating" class="erzeugt">
                <Kreisel :groesse="40" />
                <p class="at-gedaempft">{{ t('daily.shareCardGenerating') }}</p>
                <small class="at-gedaempft">~10–30 s</small>
            </div>

            <div v-if="generatedImage && !generating" class="vorschau" data-ki-generiert="true">
                <img :src="generatedImage" :alt="t('kiHinweis.bild')" />
                <!-- S12: das Label steht auch IM Bild und in den PNG-Metadaten (shareCardBild.js). -->
                <KiHinweis />
            </div>

            <!-- Als Vorlage speichern (nur nach neu erzeugtem Bild) -->
            <div v-if="generatedImage && !generating && lastBackgroundBase64 && !selectedTemplateId">
                <Knopf v-if="!showSaveForm" klein symbol="speichern" @click="showSaveForm = true">{{ t('daily.shareCardAlsVorlage') }}</Knopf>
                <div v-else class="vorlageForm">
                    <input v-model="templateName" type="text" class="at-feld" :placeholder="t('daily.shareCardVorlageName')"
                        @keyup.enter="saveAsTemplate" />
                    <Knopf art="haupt" klein symbol="speichern" :laedt="savingTemplate" :disabled="!templateName.trim()"
                        @click="saveAsTemplate">{{ t('common.save') }}</Knopf>
                    <Knopf art="leise" klein nur-symbol symbol="schliessen" :titel="t('common.close')" @click="showSaveForm = false" />
                </div>
            </div>
            <!-- S12: Pflichthinweis zum Bild-Anbieter (Texte aus kiHinweis.anbieter, wie in den Einstellungen). -->
            <p v-if="!selectedTemplateId" class="at-klein anbieterHinweis">
                {{ t(appEinstellungen?.shareCardProvider === 'gemini' ? 'kiHinweis.anbieter.gemini' : 'kiHinweis.anbieter.flux') }}
            </p>
        </div>

        <template #fuss>
            <div class="fuss">
                <Knopf @click="closeModal">{{ t('common.close') }}</Knopf>
                <div class="fussRechts">
                    <Knopf v-if="!selectedTemplateId" art="haupt" symbol="bild" :laedt="generating" @click="generateShareCard">
                        {{ generating ? t('daily.shareCardGenerating') : t('daily.shareCardGenerate') }}
                    </Knopf>
                    <Knopf v-if="generatedImage && !generating" nur-symbol symbol="teilen" :titel="t('daily.shareCardEmail')" @click="shareImage" />
                    <Knopf v-if="generatedImage && !generating" symbol="herunterladen" @click="downloadImage">{{ t('daily.shareCardDownload') }}</Knopf>
                </div>
            </div>
        </template>
    </Dialog>
</template>

<style scoped>
.share {
    display: flex;
    flex-direction: column;
    gap: var(--abstand-4);
    min-width: 0;
}

.zusammenfassung {
    display: flex;
    flex-direction: column;
    gap: var(--abstand-2);
    padding: var(--abstand-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-knopf);
    background: var(--panel-soft);
}

.kopfzeile,
.tags {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-2);
}

.symbol {
    font-size: 1.15rem;
    font-weight: 700;
}

.werte {
    display: flex;
    flex-wrap: wrap;
    gap: var(--abstand-3) var(--abstand-5);
}

.werte > div {
    display: flex;
    flex-direction: column;
    font-variant-numeric: tabular-nums;
}

.werte .hebel {
    margin-left: auto;
    text-align: center;
}

.name {
    font-size: 0.75rem;
    color: var(--muted);
}

.klein {
    font-size: 0.82rem;
}

.feld {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
}

.at-label {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
}

.hgReihe {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--abstand-2);
}

.hgKnopf {
    display: flex;
    align-items: center;
    gap: var(--abstand-2);
    max-width: 22rem;
    text-align: left;
    cursor: pointer;
}

.hgKnopf .pfeil {
    margin-left: auto;
    color: var(--muted);
}

/* Fangfläche für den Klick daneben; innerhalb des <dialog> genügt ein lokaler Stapel */
.hgHinter {
    position: fixed;
    inset: 0;
    z-index: 1;
}

.hgWahl {
    position: absolute;
    z-index: 2;
    top: calc(100% + 0.25rem);
    left: 0;
    width: 100%;
    max-width: 22rem;
    max-height: 16rem;
    overflow-y: auto;
    padding: 0.25rem;
    border: 1px solid var(--line-stark);
    border-radius: var(--radius-knopf);
    background: var(--panel);
    box-shadow: var(--schatten);
}

.hgZeile {
    display: flex;
    align-items: center;
    gap: var(--abstand-2);
    padding: 0.4rem 0.6rem;
    border-radius: var(--radius-klein);
    cursor: pointer;
}

.hgZeile:hover,
.hgZeile:focus-visible {
    outline: none;
    background: var(--panel-soft);
}

.hgZeile.hgAktiv {
    background: var(--accent-flaeche);
    color: var(--accent);
}

.optionen {
    display: flex;
    flex-wrap: wrap;
    gap: var(--abstand-2) var(--abstand-4);
}

.prompt {
    min-height: 100px;
    resize: vertical;
}

.erzeugt {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--abstand-2);
    padding: var(--abstand-6) 0;
}

.erzeugt p {
    margin: 0;
}

.vorschau {
    text-align: center;
}

.vorschau img {
    max-width: 100%;
    max-height: 500px;
    border-radius: var(--radius-knopf);
}

.vorlageForm {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-2);
}

.vorlageForm .at-feld {
    flex: 1 1 12rem;
    max-width: 20rem;
}

.fuss {
    display: flex;
    flex: 1;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: var(--abstand-2);
}

.fussRechts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--abstand-2);
}
.anbieterHinweis { color: var(--muted); margin: 0; }
</style>
