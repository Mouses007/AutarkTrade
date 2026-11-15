<script setup>
/**
 * KI-Chat im Chart-Arbeitsplatz — derselbe KI-Agent wie auf der Seite
 * „KI-Agent", aber mit dem offenen Chart als Kontext: die Route bekommt
 * Symbol, Zeiteinheit, Markt und den rechten Rand des sichtbaren Bereichs,
 * der Agent liest den Chart über das Werkzeug `query_chart` (dieselben Daten
 * wie die KI-Analyse: Kerzen, eigene Linien, Volumenprofil, Hebelzonen,
 * letzte Analyse).
 *
 * Ein Wechsel von Symbol oder Zeiteinheit beginnt ein neues Gespräch — der
 * Verlauf bezöge sich sonst auf einen anderen Chart. Die Gespräche stehen
 * auch im Verlauf der KI-Coach-Leiste.
 */
import { ref, watch, nextTick, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { kiMarkdown } from '../../utils/kiMarkdown.js'
import { useKiGespraech } from '../../composables/useKiGespraech.js'
import { useSpracheingabe, erkennungsSprache } from '../../composables/useSpracheingabe.js'
import Symbol from '../basis/Symbol.vue'
import { Knopf, Kreisel } from '../basis'

const props = defineProps({
    panel: { type: Object, required: true },
    sichtbarBis: { type: Function, default: null },
})
const { t, locale } = useI18n()

const liste = ref(null)

// Der offene Chart reist mit jeder Frage mit; der rechte Rand nur, wenn der
// Nutzer zurückgeblättert hat (sonst gilt „bis jetzt").
function chartKontext() {
    let bis = null
    try { bis = props.sichtbarBis?.() || null } catch { bis = null }
    return {
        seitenId: 'chart',
        chart: { symbol: props.panel.symbol, interval: props.panel.interval, markt: props.panel.markt, bis: bis && bis < Date.now() - 60_000 ? bis : null },
    }
}

const { nachrichten, schritte, eingabe, laeuft, fehler, sende, neu, abbrechen } = useKiGespraech({ kontext: chartKontext, t })

const chartVon = () => `${props.panel.symbol}|${props.panel.interval}|${props.panel.markt}`
// Anderer Chart, anderes Gespräch: der Verlauf bezöge sich sonst auf den alten.
watch(chartVon, () => neu())

const werkzeuge = () => schritte.value.filter((s) => s.type === 'tool_call').map((s) => s.name)

watch([() => nachrichten.value.length, laeuft], async () => {
    await nextTick()
    if (liste.value) liste.value.scrollTop = liste.value.scrollHeight
})

// Spracheingabe wie in der KI-Coach-Leiste: das Gesprochene wird an das Feld angehängt.
let vorAufnahme = ''
const sprache = useSpracheingabe({
    sprache: () => erkennungsSprache(locale.value),
    beiText: (text) => { eingabe.value = [vorAufnahme, text].filter(Boolean).join(' ') },
})
const mikroTitel = () => (sprache.grund.value === 'keinHttps' ? t('kiCoach.mikroKeinHttps')
    : sprache.grund.value === 'keinBrowser' ? t('kiCoach.mikroKeinBrowser')
        : sprache.hoert.value ? t('kiCoach.mikroStopp') : t('kiCoach.mikroStart'))
function schalteMikro() {
    if (sprache.grund.value) return
    if (!sprache.hoert.value) vorAufnahme = eingabe.value.trim()
    sprache.schalte()
}
function sendeEingabe() {
    sprache.stopp()
    sende()
}
watch(laeuft, () => sprache.stopp())

function taste(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendeEingabe() }
}

onBeforeUnmount(() => abbrechen())

const VORSCHLAEGE = ['frageStruktur', 'frageMarken', 'frageLinien']
</script>

<template>
    <div class="kiChat">
        <div class="kopfzeile">
            <small>{{ t('chart.ki.chatHinweis', { symbol: panel.symbol, tf: panel.interval }) }}</small>
            <button v-if="nachrichten.length" type="button" class="textKnopf" @click="neu">{{ t('chart.ki.chatNeu') }}</button>
        </div>
        <div ref="liste" class="verlauf">
            <div v-if="!nachrichten.length && !laeuft" class="leer">
                <div>{{ t('chart.ki.chatLeer') }}</div>
                <Knopf v-for="v in VORSCHLAEGE" :key="v" klein class="vorschlag"
                    @click="sende(t('chart.ki.' + v))">{{ t('chart.ki.' + v) }}</Knopf>
            </div>
            <template v-for="(n, i) in nachrichten" :key="i">
                <div v-if="n.role === 'assistant'" class="blase ki" data-ki-generiert="true"
                    v-html="kiMarkdown(n.content, { kompakt: true })"></div>
                <div v-else-if="n.role === 'user'" class="blase nutzer">{{ n.content }}</div>
            </template>
            <div v-if="laeuft" class="blase ki laeuft">
                <Kreisel />
                <span v-for="(s, i) in werkzeuge()" :key="i" class="werkzeug">{{ s }}</span>
            </div>
            <div v-if="fehler" class="fehler">{{ fehler }}</div>
        </div>
        <div class="eingabe">
            <textarea v-model="eingabe" class="at-feld klein" rows="2" :placeholder="t('chart.ki.chatPlatzhalter')"
                :disabled="laeuft" @keydown="taste"></textarea>
            <button type="button" class="mikro" :class="{ hoert: sprache.hoert.value, aus: !!sprache.grund.value }"
                :aria-pressed="sprache.hoert.value" :title="mikroTitel()" :aria-label="mikroTitel()" :disabled="laeuft" @click="schalteMikro">
                <Symbol name="mikrofon" />
            </button>
            <Knopf art="haupt" klein nur-symbol symbol="nachricht" :disabled="laeuft || !eingabe.trim()" :titel="t('chart.ki.chatSenden')"
                @click="sendeEingabe" />
        </div>
    </div>
</template>

<style scoped>
.kiChat {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-height: 0;
    flex: 1 1 auto;
    font-size: 12px;
}

.kopfzeile {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 6px;
    color: var(--muted);
}

.verlauf {
    /* schrumpft als einziges — das Eingabefeld bleibt auch neben einer hohen Momentum-Box sichtbar */
    flex: 1 1 auto;
    min-height: 40px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.leer {
    display: flex;
    flex-direction: column;
    gap: 4px;
    color: var(--muted);
}

.vorschlag {
    text-align: left;
    justify-content: flex-start;
    font-size: 11px;
}

.blase {
    border-radius: 8px;
    padding: 6px 8px;
    line-height: 1.45;
    max-width: 95%;
}

.blase.nutzer {
    align-self: flex-end;
    background: var(--accent-flaeche);
}

.blase.ki {
    align-self: flex-start;
    background: var(--line);
}

.blase :deep(p),
.blase :deep(ul) {
    margin: 0 0 4px;
}

.blase :deep(ul) {
    padding-left: 16px;
}

.laeuft {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
}

.werkzeug {
    font-size: 10px;
    padding: 0 4px;
    border-radius: 4px;
    background: rgba(171, 71, 188, 0.25);
}

.fehler {
    color: var(--bad);
}

.kopfzeile,
.eingabe {
    flex-shrink: 0;
}

.eingabe {
    display: flex;
    gap: 4px;
    align-items: flex-end;
}

.eingabe textarea {
    resize: none;
    font-size: 12px;
}

.mikro {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    align-self: stretch;
    min-width: 28px;
    border: 1px solid var(--line);
    border-radius: var(--radius-knopf);
    background: var(--panel-soft);
    color: var(--muted);
    cursor: pointer;
}

.mikro.aus,
.mikro:disabled {
    opacity: 0.45;
    cursor: not-allowed;
}

.mikro.hoert {
    color: var(--text);
    background: var(--bad-flaeche);
    border-color: var(--bad);
}

/* Text-Knopf: Handlung ohne Fläche, für Zeilen in der dichten Seitenleiste. */
.textKnopf {
    background: none;
    border: none;
    padding: 0;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
}

.textKnopf:hover:not(:disabled) {
    text-decoration: underline;
}

.textKnopf:disabled {
    opacity: 0.45;
    cursor: default;
}

</style>
