<script setup>
/**
 * Strategie im Gespräch bauen.
 *
 * Man legt eine Regelbeschreibung, Chartbilder oder ein PDF hinein und bekommt
 * eine fertige Strategie zurück — nicht mehr nur eine Beschreibung, aus der
 * jemand Code bauen müsste, sondern eine, die sofort backtestbar ist.
 *
 * Was dabei NICHT passiert: es wird kein Code erzeugt und keiner ausgeführt.
 * Das Modell füllt eine Beschreibung aus einem festen Vokabular aus, die der
 * Interpreter ausführt. Alles läuft durch dieselbe Prüfung wie eine von Hand
 * gebaute Strategie — der Grund steht in `server/rule-builder.js`.
 */
import { ref, computed, onBeforeMount, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'
import { useI18n } from 'vue-i18n'
import { spinnerLoadingPage } from '../stores/ui.js'
import SpinnerLoadingPage from '../components/SpinnerLoadingPage.vue'
import { logError } from '../utils/logger.js'
import { apiFehlerText } from '../utils/apiError.js'
import { Knopf, Pille, Symbol, Hinweis, Kreisel } from '../components/basis'
import KiHinweis from '../components/quellen/KiHinweis.vue'

const { t } = useI18n()
const router = useRouter()

const faehigkeiten = ref({ provider: '', model: '', pdf: false, image: false })
const entwuerfe = ref([])
const aktuellerEntwurf = ref(null)
const verlauf = ref([])
const eingabe = ref('')
const anhaenge = ref([])
const laeuft = ref(false)
const fehler = ref('')
const regeln = ref(null)
const offeneFragen = ref([])
const nichtUmsetzbar = ref([])
const pruefFehler = ref([])
const versuche = ref(0)
const kosten = ref(0)
const gespeichert = ref(null)

const MAX_BYTES = 8 * 1024 * 1024

const erlaubteTypen = computed(() => {
    const x = ['.txt', '.md', '.json', '.csv']
    if (faehigkeiten.value.image) x.push('image/png', 'image/jpeg', 'image/webp')
    if (faehigkeiten.value.pdf) x.push('.pdf')
    return x.join(',')
})

/** Kurzbeschreibung eines Bausteins fürs Auge — die Rohform ist unlesbar. */
function alsText(o) {
    if (!o) return '–'
    if (typeof o !== 'object') return String(o)
    if (o.param !== undefined) return `⟨${o.param}⟩`
    if (o.value !== undefined) return String(o.value)
    return JSON.stringify(o)
}

const bedingungText = (b) => {
    const op = t('strategies.op_' + b.op)
    if (['isBullish', 'isBearish', 'higherThanPrevSignal', 'lowerThanPrevSignal'].includes(b.op)) return op
    const wert = b.value !== undefined ? ` ${alsText(b.value)}` : ''
    return `${alsText(b.left)} ${op} ${alsText(b.right)}${wert}`
}

async function laden() {
    try {
        const [f, d] = await Promise.all([
            axios.get('/api/strategies/builder/capabilities'),
            axios.get('/api/strategies/builder/drafts'),
        ])
        faehigkeiten.value = f.data
        entwuerfe.value = d.data
    } catch (e) {
        logError('AgentBuilder', 'Laden fehlgeschlagen', e)
        fehler.value = apiFehlerText(e, t('strategies.loadFailed'), t)
    }
}

onBeforeMount(async () => {
    spinnerLoadingPage.value = true
    await laden()
    spinnerLoadingPage.value = false
})

/** Datei → base64 (ohne den `data:`-Präfix, den die Anbieter nicht wollen). */
function alsBase64(datei) {
    return new Promise((resolve, reject) => {
        const leser = new FileReader()
        leser.onload = () => resolve(String(leser.result).split(',')[1] || '')
        leser.onerror = reject
        leser.readAsDataURL(datei)
    })
}

async function dateienGewaehlt(ereignis) {
    fehler.value = ''
    for (const datei of [...ereignis.target.files].slice(0, 10)) {
        if (datei.size > MAX_BYTES) {
            fehler.value = t('strategies.fileTooBig', { name: datei.name })
            continue
        }
        const typ = datei.type || ''
        if (typ === 'application/pdf' && !faehigkeiten.value.pdf) {
            fehler.value = t('strategies.pdfUnsupported', { provider: faehigkeiten.value.provider })
            continue
        }
        if (typ.startsWith('image/') && !faehigkeiten.value.image) {
            fehler.value = t('strategies.imageUnsupported', { provider: faehigkeiten.value.provider })
            continue
        }
        anhaenge.value.push({
            name: datei.name,
            mediaType: typ || 'text/plain',
            groesse: datei.size,
            base64: await alsBase64(datei),
        })
    }
    ereignis.target.value = ''
}

const anhangWeg = (i) => anhaenge.value.splice(i, 1)
const kb = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' kB')

async function senden() {
    if (laeuft.value) return
    if (!eingabe.value.trim() && !anhaenge.value.length) return
    laeuft.value = true
    fehler.value = ''
    gespeichert.value = null

    const eigene = eingabe.value.trim() || `[${anhaenge.value.map((a) => a.name).join(', ')}]`
    verlauf.value.push({ role: 'user', content: eigene })
    await nextTick()

    try {
        const r = await axios.post('/api/strategies/builder/rules/chat', {
            draftId: aktuellerEntwurf.value?.id || 0,
            message: eingabe.value.trim(),
            attachments: anhaenge.value.map((a) => ({
                name: a.name, mediaType: a.mediaType, base64: a.base64,
            })),
        })
        eingabe.value = ''
        anhaenge.value = []
        verlauf.value.push({ role: 'assistant', content: r.data.antwort })
        offeneFragen.value = r.data.offeneFragen || []
        nichtUmsetzbar.value = r.data.nichtUmsetzbar || []
        pruefFehler.value = r.data.fehler || []
        versuche.value = r.data.versuche || 0
        if (r.data.regeln) regeln.value = r.data.regeln
        kosten.value += r.data.costUsd || 0
        await laden()
        aktuellerEntwurf.value = entwuerfe.value.find((d) => d.id === r.data.draftId) || null
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.builderFailed'), t)
        verlauf.value.pop()
        eingabe.value = eigene
    } finally {
        laeuft.value = false
    }
}

function entwurfOeffnen(d) {
    aktuellerEntwurf.value = d
    verlauf.value = d.messages || []
    regeln.value = d.spec || null
    offeneFragen.value = []
    nichtUmsetzbar.value = []
    pruefFehler.value = []
    gespeichert.value = null
}

function neuerEntwurf() {
    aktuellerEntwurf.value = null
    verlauf.value = []
    regeln.value = null
    offeneFragen.value = []
    nichtUmsetzbar.value = []
    pruefFehler.value = []
    gespeichert.value = null
    anhaenge.value = []
}

async function uebernehmen() {
    try {
        const r = await axios.post(`/api/strategies/builder/rules/${aktuellerEntwurf.value.id}/save`)
        gespeichert.value = r.data
        await laden()
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.saveFailed'), t)
    }
}

const loeschFrage = ref(null)
async function entwurfLoeschen(d) {
    try {
        await axios.delete(`/api/strategies/builder/drafts/${d.id}`)
        loeschFrage.value = null
        if (aktuellerEntwurf.value?.id === d.id) neuerEntwurf()
        await laden()
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.deleteFailed'), t)
    }
}
</script>

<template>
    <SpinnerLoadingPage />
    <div v-show="!spinnerLoadingPage" class="builder-seite">
        <div class="builder-inhalt">

            <div class="kopfzeile">
                <h5 class="seitentitel">{{ t('strategies.builderTitle') }}</h5>
                <Pille ton="neutral">{{ faehigkeiten.provider }} · {{ faehigkeiten.model }}</Pille>
                <Pille v-if="kosten > 0" ton="neutral">${{ kosten.toFixed(4) }}</Pille>
                <button type="button" class="ctl-pill accent" @click="neuerEntwurf">
                    <Symbol name="plus" class="vor" />{{ t('strategies.newDraft') }}
                </button>
            </div>

            <div class="sicherheit">
                <Symbol name="schildHaken" class="vor" />{{ t('strategies.builderSafety') }}
            </div>
            <Hinweis v-if="fehler" art="fehler" class="abstand-unten">{{ fehler }}</Hinweis>

            <div class="raster">
                <!-- ══ Gespräch ══ -->
                <div class="spalte-gespraech">
                    <div class="dailyCard karte">
                        <div class="section-title">{{ t('strategies.conversation') }}</div>

                        <div v-if="!verlauf.length" class="at-gedaempft klein-text abstand-unten">
                            {{ t('strategies.builderIntro') }}
                        </div>

                        <div class="chat-messages" style="max-height: 42vh; overflow-y: auto;">
                            <div v-for="(m, i) in verlauf" :key="i"
                                :class="['chat-bubble', m.role === 'user' ? 'chat-bubble-user' : 'chat-bubble-ai']"
                                :data-ki-generiert="m.role === 'user' ? null : 'true'">
                                {{ m.content }}
                                <!-- S12: Pflichtlabel an jeder KI-Antwort. -->
                                <KiHinweis v-if="m.role !== 'user'" klein />
                            </div>
                            <div v-if="laeuft" class="chat-bubble chat-bubble-ai">
                                <Kreisel class="vor" />{{ t('strategies.reading') }}
                            </div>
                        </div>

                        <div v-if="offeneFragen.length" class="fragen">
                            <div class="klein-text fett fragen-kopf">
                                <Symbol name="frage" class="vor" />{{ t('strategies.openQuestions') }}
                            </div>
                            <ul class="liste klein-text">
                                <li v-for="(f, i) in offeneFragen" :key="i">{{ f }}</li>
                            </ul>
                        </div>

                        <!-- Was das Vokabular nicht abbildet — bewusst prominent -->
                        <Hinweis v-if="nichtUmsetzbar.length" art="warn" class="abstand-oben klein-text">
                            <strong>{{ t('strategies.notExpressible') }}</strong>
                            <ul class="liste">
                                <li v-for="(f, i) in nichtUmsetzbar" :key="i">{{ f }}</li>
                            </ul>
                        </Hinweis>

                        <Hinweis v-if="pruefFehler.length" art="fehler" class="abstand-oben klein-text">
                            <strong>{{ t('strategies.rejectedAfterRetries') }}</strong>
                            <ul class="liste">
                                <li v-for="(f, i) in pruefFehler" :key="i">{{ f }}</li>
                            </ul>
                        </Hinweis>

                        <div v-if="anhaenge.length" class="anhaenge">
                            <Pille v-for="(a, i) in anhaenge" :key="i" ton="neutral" symbol="anhang"
                                class="pointerClass" @click="anhangWeg(i)">
                                {{ a.name }} ({{ kb(a.groesse) }})
                                <Symbol name="schliessen" />
                            </Pille>
                        </div>

                        <div class="eingabe-zeile">
                            <label class="datei-knopf" :title="t('strategies.attach')">
                                <Symbol name="anhang" />
                                <input type="file" multiple :accept="erlaubteTypen" class="versteckt"
                                    @change="dateienGewaehlt" />
                            </label>
                            <textarea v-model="eingabe" class="at-feld chat-input" rows="2"
                                :placeholder="t('strategies.rulesPlaceholder')"
                                @keydown.enter.exact.prevent="senden"></textarea>
                            <Knopf art="haupt" klein nurSymbol symbol="nachricht" :disabled="laeuft" @click="senden" />
                        </div>
                        <small class="at-gedaempft">
                            {{ t('strategies.acceptedFiles') }}:
                            {{ t('strategies.text') }}<template v-if="faehigkeiten.image">, {{ t('strategies.images') }}</template>
                            <template v-if="faehigkeiten.pdf">, PDF</template>
                            <template v-else> — {{ t('strategies.noPdfHere', { provider: faehigkeiten.provider }) }}</template>
                        </small>
                    </div>
                </div>

                <!-- ══ Erkannte Strategie ══ -->
                <div class="spalte-regeln">
                    <div class="dailyCard karte">
                        <div class="section-title">{{ t('strategies.recognisedStrategy') }}</div>

                        <div v-if="!regeln" class="at-gedaempft klein-text">{{ t('strategies.noRulesYet') }}</div>

                        <template v-else>
                            <!-- S12: die Strategie hat ein KI-Modell aus der Beschreibung gelesen. -->
                            <KiHinweis klein :anbieter="faehigkeiten.provider" :modell="faehigkeiten.model" />
                            <p class="regel-name"><strong>{{ regeln.name }}</strong>
                                <span class="at-gedaempft klein-text regel-id">{{ regeln.id }}</span></p>
                            <div class="pillen abstand-unten">
                                <Pille :ton="regeln.direction === 'long' ? 'gut' : 'schlecht'">
                                    {{ regeln.direction === 'long' ? 'LONG' : 'SHORT' }}
                                </Pille>
                                <Pille v-for="tf in regeln.timeframes" :key="tf" ton="neutral">{{ tf }}</Pille>
                                <Pille v-if="versuche > 1" ton="neutral"
                                    :title="t('strategies.retriesHint')">{{ versuche }}×</Pille>
                            </div>

                            <div style="max-height: 34vh; overflow-y: auto;">
                                <div class="mini-title">{{ t('strategies.blockIndicators') }}</div>
                                <div v-for="ind in regeln.indicators" :key="ind.id" class="mini-zeile">
                                    <span class="mono">{{ ind.id }}</span> = {{ ind.type.toUpperCase() }}
                                    <template v-if="ind.anchor"> ({{ t('strategies.vwapAnchor' + (ind.anchor === 'session' ? 'Session' : 'Rolling')) }})</template>
                                    <template v-else> {{ alsText(ind.period) }}</template>
                                </div>

                                <div class="mini-title">{{ t('strategies.blockSignal') }}</div>
                                <div class="mini-zeile">{{ t('strategies.signal_' + regeln.signal.type) }}</div>

                                <template v-if="regeln.signalFilters.length">
                                    <div class="mini-title">{{ t('strategies.blockFilters') }}</div>
                                    <div v-for="(b, i) in regeln.signalFilters" :key="i" class="mini-zeile">
                                        {{ bedingungText(b) }}
                                    </div>
                                </template>

                                <div class="mini-title">{{ t('strategies.blockEntry') }}</div>
                                <div class="mini-zeile">
                                    {{ t('strategies.entry_' + regeln.entry.type) }}
                                    <template v-if="regeln.entry.anchor"> — {{ regeln.entry.anchor }}</template>
                                </div>

                                <div class="mini-title">{{ t('strategies.blockInvalidations') }}</div>
                                <div v-for="(v, i) in regeln.invalidations" :key="i" class="mini-zeile">
                                    <span class="mono">{{ v.code }}</span>:
                                    <template v-if="v.type === 'timeout'">
                                        {{ t('strategies.afterCandles', { n: alsText(v.candles) }) }}
                                    </template>
                                    <template v-else>{{ bedingungText(v.when) }}</template>
                                </div>

                                <div class="mini-title">{{ t('strategies.blockExit') }}</div>
                                <div class="mini-zeile">
                                    {{ t('strategies.stop') }}: {{ regeln.stopLoss.anchor }}
                                    ± {{ alsText(regeln.stopLoss.offsetPct) }} %
                                </div>
                                <div class="mini-zeile">
                                    {{ t('strategies.target') }}: {{ t('strategies.tp_' + regeln.takeProfit.mode) }}
                                    <template v-if="regeln.takeProfit.rr"> {{ alsText(regeln.takeProfit.rr) }} R</template>
                                    <template v-if="regeln.takeProfit.anchor"> {{ regeln.takeProfit.anchor }}</template>
                                </div>

                                <div class="mini-title">
                                    {{ t('strategies.paramsFound', { n: regeln.params.length }) }}
                                </div>
                                <table class="at-tabelle dicht param-tabelle">
                                    <tbody>
                                        <tr v-for="p in regeln.params" :key="p.key">
                                            <td>{{ p.label || p.key }}</td>
                                            <td class="zahl at-gedaempft">{{ p.default }}</td>
                                            <td class="zahl at-gedaempft" style="width: 5rem;">
                                                <template v-if="p.min !== undefined">{{ p.min }}–{{ p.max }}</template>
                                                <template v-else>{{ p.type }}</template>
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>

                            <Knopf art="haupt" klein symbol="haken" class="uebernehmen"
                                :disabled="!aktuellerEntwurf || !!gespeichert" @click="uebernehmen">
                                {{ t('strategies.takeOver') }}
                            </Knopf>

                            <Hinweis v-if="gespeichert" art="gut" class="abstand-oben klein-text">
                                {{ t('strategies.savedAndLoaded', { id: gespeichert.strategyId }) }}
                                <div class="knopfzeile">
                                    <Knopf klein @click="router.push('/agent/editor')">
                                        {{ t('strategies.openInEditor') }}
                                    </Knopf>
                                    <Knopf klein @click="router.push('/agent/lab')">
                                        {{ t('strategies.backtestNow') }}
                                    </Knopf>
                                </div>
                            </Hinweis>
                        </template>
                    </div>
                </div>
            </div>

            <!-- Entwürfe -->
            <div v-if="entwuerfe.length" class="dailyCard karte abstand-oben-gross">
                <div class="section-title">{{ t('strategies.drafts') }}</div>
                <div class="at-tabelle-huelle">
                    <table class="at-tabelle dicht">
                        <tbody>
                            <tr v-for="d in entwuerfe" :key="d.id"
                                :class="aktuellerEntwurf?.id === d.id ? 'gewaehlt' : ''">
                                <td class="pointerClass" @click="entwurfOeffnen(d)">{{ d.title }}</td>
                                <td class="at-gedaempft">{{ d.sourceName }}</td>
                                <td>
                                    <Pille :ton="d.status === 'generated' ? 'gut' : 'neutral'">
                                        {{ t('strategies.draftStatus_' + d.status) }}
                                    </Pille>
                                </td>
                                <td class="zahl" style="white-space: nowrap;">
                                    <template v-if="loeschFrage === d.id">
                                        <Knopf art="gefahr" klein class="vor"
                                            @click="entwurfLoeschen(d)">{{ t('common.yes') }}</Knopf>
                                        <Knopf art="leise" klein
                                            @click="loeschFrage = null">{{ t('common.no') }}</Knopf>
                                    </template>
                                    <Knopf v-else art="gefahr" klein nurSymbol symbol="muell"
                                        @click="loeschFrage = d.id" />
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.builder-seite {
    padding: var(--abstand-4) var(--abstand-4) 0;
}

.builder-inhalt {
    max-width: 1500px;
}

/* `.dailyCard` setzt global height:100% — bei gestapelten Karten falsch. */
.dailyCard {
    height: auto;
}

.karte {
    padding: var(--abstand-4);
}

.kopfzeile {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-2);
    margin-bottom: var(--abstand-4);
}

.seitentitel {
    margin: 0 auto 0 0;
}

.vor {
    margin-right: var(--abstand-1);
}

.sicherheit {
    display: flex;
    align-items: center;
    font-size: 0.85rem;
    color: var(--muted);
    background: var(--panel-soft);
    border: 1px solid var(--line);
    border-radius: var(--radius-knopf);
    padding: var(--abstand-2) var(--abstand-3);
    margin-bottom: var(--abstand-3);
}

.raster {
    display: grid;
    grid-template-columns: 7fr 5fr;
    gap: var(--abstand-4);
    align-items: start;
}

.spalte-gespraech,
.spalte-regeln {
    min-width: 0;
}

.section-title {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    margin-bottom: var(--abstand-2);
}

.klein-text {
    font-size: 0.85rem;
}

.fett {
    font-weight: 700;
}

.abstand-unten {
    margin-bottom: var(--abstand-3);
}

.abstand-oben {
    margin-top: var(--abstand-2);
}

.abstand-oben-gross {
    margin-top: var(--abstand-4);
}

.fragen {
    margin-top: var(--abstand-2);
    padding: var(--abstand-2);
    border: 1px solid var(--line);
    border-radius: var(--radius-knopf);
}

.fragen-kopf {
    display: flex;
    align-items: center;
    margin-bottom: var(--abstand-1);
}

.liste {
    margin: 0;
    padding-left: var(--abstand-4);
}

.anhaenge,
.pillen {
    display: flex;
    flex-wrap: wrap;
    gap: var(--abstand-1);
}

.anhaenge {
    margin-top: var(--abstand-2);
}

.eingabe-zeile {
    display: flex;
    align-items: flex-start;
    gap: var(--abstand-2);
    margin-top: var(--abstand-2);
}

.eingabe-zeile .chat-input {
    flex: 1 1 auto;
    min-width: 0;
}

.datei-knopf {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-knopf);
    background: var(--panel-soft);
    color: var(--text);
    cursor: pointer;
    margin: 0;
}

.datei-knopf:hover {
    border-color: var(--line-stark);
}

.versteckt {
    display: none;
}

.regel-name {
    margin: 0 0 var(--abstand-1);
}

.regel-id {
    margin-left: var(--abstand-1);
}

.param-tabelle {
    font-size: 0.85rem;
    margin: 0;
}

tr.gewaehlt td {
    background: var(--accent-flaeche);
}

.uebernehmen {
    margin-top: var(--abstand-3);
}

.knopfzeile {
    display: flex;
    flex-wrap: wrap;
    gap: var(--abstand-2);
    margin-top: var(--abstand-2);
}

.mini-title {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
    margin-top: 0.7rem;
    margin-bottom: 0.15rem;
}

.mini-zeile {
    font-size: 0.8rem;
    padding: 0.1rem 0;
}

.mono {
    font-family: var(--schrift-mono);
    font-size: 0.76rem;
}

@media (max-width: 991.98px) {
    .raster {
        grid-template-columns: 1fr;
    }
}

@media (max-width: 767.98px) {
    .builder-seite {
        padding: var(--abstand-3) var(--abstand-3) 0;
    }

    .karte {
        padding: var(--abstand-3);
    }
}
</style>
