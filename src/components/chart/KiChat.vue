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
 * auch im Archiv der KI-Agent-Seite.
 */
import { ref, watch, nextTick, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { sanitizeHtml } from '../../utils/sanitize'
import { Knopf, Kreisel } from '../basis'
import KiHinweis from '../quellen/KiHinweis.vue'

const props = defineProps({
    panel: { type: Object, required: true },
    sichtbarBis: { type: Function, default: null },
})
const { t } = useI18n()

const nachrichten = ref([])      // [{ rolle: 'nutzer'|'ki', text }]
const schritte = ref([])         // Werkzeugaufrufe des laufenden Laufs
const eingabe = ref('')
const laeuft = ref(false)
const fehler = ref('')
const liste = ref(null)
let sitzung = null
let abbruch = null

const chartVon = () => `${props.panel.symbol}|${props.panel.interval}|${props.panel.markt}`
let fuerChart = chartVon()

watch(chartVon, (neu) => {
    if (neu === fuerChart) return
    fuerChart = neu
    abbruch?.abort()
    sitzung = null
    nachrichten.value = []
    schritte.value = []
    fehler.value = ''
})

function markdown(md) {
    if (!md) return ''
    let html = md
        .replace(/^### (.+)$/gm, '<b>$1</b>')
        .replace(/^## (.+)$/gm, '<b>$1</b>')
        .replace(/^# (.+)$/gm, '<b>$1</b>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/^- (.+)$/gm, '<li>$1</li>')
        .replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>')
        .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)
    html = html.split('\n\n').map((p) => {
        const s = p.trim()
        if (!s) return ''
        return s.startsWith('<ul') || s.startsWith('<b>') ? s : `<p>${s}</p>`
    }).filter(Boolean).join('\n')
    return sanitizeHtml(html)
}

async function nachUnten() {
    await nextTick()
    if (liste.value) liste.value.scrollTop = liste.value.scrollHeight
}

async function sende() {
    const text = eingabe.value.trim()
    if (!text || laeuft.value) return
    eingabe.value = ''
    fehler.value = ''
    schritte.value = []
    nachrichten.value.push({ rolle: 'nutzer', text })
    nachUnten()
    laeuft.value = true
    const meinChart = chartVon()
    abbruch = new AbortController()
    try {
        let bis = null
        try { bis = props.sichtbarBis?.() || null } catch { bis = null }
        const antwort = await fetch('/api/ai/agent/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: abbruch.signal,
            body: JSON.stringify({
                sessionId: sitzung, message: text, pageId: 'chart',
                chart: { symbol: props.panel.symbol, interval: props.panel.interval, markt: props.panel.markt, bis: bis && bis < Date.now() - 60_000 ? bis : null },
            }),
        })
        // 429: ein anderer Agent-Lauf (KI-Agent-Seite, zweites Fenster) ist noch nicht fertig.
        if (!antwort.ok) {
            const j = await antwort.json().catch(() => ({}))
            fehler.value = antwort.status === 429 ? t('chart.ki.chatBelegt') : (j.error || `HTTP ${antwort.status}`)
            return
        }
        const leser = antwort.body.getReader()
        const dekoder = new TextDecoder()
        let puffer = ''
        for (;;) {
            const { done, value } = await leser.read()
            if (done) break
            puffer += dekoder.decode(value, { stream: true })
            const zeilen = puffer.split('\n')
            puffer = zeilen.pop()
            for (const z of zeilen) {
                if (!z.startsWith('data: ')) continue
                let e
                try { e = JSON.parse(z.slice(6)) } catch { continue }
                if (meinChart !== chartVon()) return
                if (e.type === 'session') sitzung = e.sessionId
                else if (e.type === 'tool_call') schritte.value.push(e.name)
                else if (e.type === 'answer') { nachrichten.value.push({ rolle: 'ki', text: e.content }); nachUnten() }
                else if (e.type === 'error') fehler.value = e.content
            }
        }
    } catch (e) {
        if (e.name !== 'AbortError') fehler.value = e.message
    } finally {
        laeuft.value = false
        abbruch = null
        schritte.value = []
    }
}

function neu() {
    abbruch?.abort()
    sitzung = null
    nachrichten.value = []
    fehler.value = ''
}

function taste(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sende() }
}

onBeforeUnmount(() => abbruch?.abort())

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
                    @click="eingabe = t('chart.ki.' + v); sende()">{{ t('chart.ki.' + v) }}</Knopf>
            </div>
            <div v-for="(n, i) in nachrichten" :key="i" class="blase" :class="n.rolle"
                :data-ki-generiert="n.rolle === 'ki' ? 'true' : null">
                <div v-if="n.rolle === 'ki'" v-html="markdown(n.text)"></div>
                <div v-else>{{ n.text }}</div>
                <!-- S12: jede KI-Antwort trägt das Pflichtlabel. -->
                <KiHinweis v-if="n.rolle === 'ki'" klein />
            </div>
            <div v-if="laeuft" class="blase ki laeuft">
                <Kreisel />
                <span v-for="(s, i) in schritte" :key="i" class="werkzeug">{{ s }}</span>
            </div>
            <div v-if="fehler" class="fehler">{{ fehler }}</div>
        </div>
        <div class="eingabe">
            <textarea v-model="eingabe" class="at-feld klein" rows="2" :placeholder="t('chart.ki.chatPlatzhalter')"
                :disabled="laeuft" @keydown="taste"></textarea>
            <Knopf art="haupt" klein nur-symbol symbol="nachricht" :disabled="laeuft || !eingabe.trim()" :titel="t('chart.ki.chatSenden')"
                @click="sende" />
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
