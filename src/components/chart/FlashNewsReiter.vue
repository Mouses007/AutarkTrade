<script setup>
/**
 * Seitenleiste „Flash-News" (bewusst ohne Beschreibung und ohne sichtbares
 * KI-Label — auf Wunsch des Eigentümers, 30.10.2026: nimmt im schmalen Reiter
 * nur Platz weg; `data-ki-generiert` bleibt am Inhalt, Anbieter/Modell in der
 * Kopfzeile). Bewegt sich der Chart ungewöhnlich, holt ein
 * Klick, was X und das Web zum Coin in der letzten Stunde (6 h, 24 h)
 * melden — kurz aufgelistet, jeder Punkt mit Link zur Meldung.
 *
 * Kostet bei jedem Klick (zwei Suchen und ein Modellaufruf, Server
 * `flash-news.js`); beim Öffnen und beim Symbolwechsel wird nur der letzte
 * Stand gelesen, falls es einen gibt (GET, kostenlos). Links kommen aus der
 * Quellenliste des Servers, nie aus dem Modelltext.
 */
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import { Symbol, Knopf } from '../basis'

const props = defineProps({
    panel: { type: Object, required: true },
})
const { t } = useI18n()

const ZEITRAEUME = [1, 6, 24]
const ZEIT_SCHLUESSEL = 'chartFlashStunden'
const stunden = ref((() => { try { const n = Number(localStorage.getItem(ZEIT_SCHLUESSEL)); return ZEITRAEUME.includes(n) ? n : 1 } catch { return 1 } })())
function setzeStunden(n) { stunden.value = n; try { localStorage.setItem(ZEIT_SCHLUESSEL, String(n)) } catch { /* kein Speicher */ } }

const ergebnis = ref(null)
const laeuft = ref(false)
const fehler = ref('')
const alleQuellen = ref(false)

// Eine Antwort gehört zu Symbol und Zeitraum, für die sie bestellt wurde.
const stand = () => `${props.panel.symbol}|${stunden.value}`
let nr = 0

async function ladeLetzte() {
    const meine = ++nr
    const fuer = stand()
    fehler.value = ''
    try {
        const { data } = await axios.get('/api/chart/flash-news', { params: { symbol: props.panel.symbol, stunden: stunden.value } })
        if (meine !== nr || fuer !== stand()) return
        ergebnis.value = data.leer ? null : data
    } catch { if (meine === nr) ergebnis.value = null }
}

async function abrufen() {
    if (laeuft.value) return
    const meine = ++nr
    const fuer = stand()
    laeuft.value = true
    fehler.value = ''
    try {
        const { data } = await axios.post('/api/chart/flash-news', { symbol: props.panel.symbol, stunden: stunden.value }, { timeout: 180000 })
        if (meine !== nr || fuer !== stand()) return
        ergebnis.value = data
        alleQuellen.value = false
    } catch (e) {
        if (meine === nr) fehler.value = e.response?.data?.error || e.message
    } finally { if (meine === nr) laeuft.value = false }
}

watch(() => [props.panel.symbol, stunden.value], () => { laeuft.value = false; ladeLetzte() }, { immediate: true })

const quelleNach = computed(() => new Map((ergebnis.value?.quellen || []).map((q) => [q.nr, q])))
function chip(q) { return q.art === 'x' ? (q.titel || 'X') : q.titel }
function uhr(ms) {
    if (!ms) return ''
    try { return new Date(ms).toLocaleString(undefined, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) } catch { return '' }
}
</script>

<template>
    <div class="flashReiter">
        <div class="zeitraum" role="group" :aria-label="t('chart.news.zeitraum')">
            <span>{{ t('chart.news.zeitraum') }}</span>
            <button v-for="n in ZEITRAEUME" :key="n" type="button" :class="{ an: stunden === n }" :aria-pressed="stunden === n"
                @click="setzeStunden(n)">{{ n }} h</button>
        </div>
        <Knopf klein symbol="blitz" :laedt="laeuft" class="abrufen" @click="abrufen">
            <template v-if="!laeuft">{{ t('chart.news.abrufen', { n: stunden }) }}</template>
        </Knopf>
        <div v-if="fehler" class="fehler">{{ fehler }}</div>

        <template v-if="ergebnis">
            <div class="kopf">
                <small>{{ uhr(ergebnis.erstelltAm) }} · {{ ergebnis.coin }} · {{ ergebnis.stunden }} h<template v-if="ergebnis.provider">
                        · {{ ergebnis.provider }}/{{ ergebnis.model }}</template><template v-if="ergebnis.costUsd != null">
                        · {{ ergebnis.costUsd.toFixed(4) }} $</template></small>
            </div>
            <div v-for="h in ergebnis.hinweise" :key="h" class="hinweis">{{ t('chart.news.status.' + h) }}</div>

            <div data-ki-generiert="true" class="inhalt">
                <p v-if="ergebnis.kurz" class="kurz">{{ ergebnis.kurz }}</p>
                <div v-if="ergebnis.lage === 'nichts'" class="nichts">
                    <Symbol name="haken" /> {{ t(ergebnis.quellen?.length ? 'chart.news.nichtsRelevant' : 'chart.news.nichtsGefunden', { n: ergebnis.stunden }) }}
                </div>
                <div v-for="(p, i) in ergebnis.punkte" :key="i" class="punkt">
                    <span v-if="p.zeit" class="zeit">{{ p.zeit }}</span>
                    <span class="text">{{ p.text }}</span>
                    <span class="belege">
                        <template v-for="n in p.quellen" :key="n">
                            <a v-if="quelleNach.get(n)" class="beleg" :class="quelleNach.get(n).art" :href="quelleNach.get(n).url"
                                target="_blank" rel="noopener noreferrer" :title="quelleNach.get(n).url">{{ chip(quelleNach.get(n)) }}</a>
                        </template>
                    </span>
                </div>
            </div>

            <button v-if="ergebnis.quellen?.length" type="button" class="textKnopf" @click="alleQuellen = !alleQuellen">
                {{ t(alleQuellen ? 'chart.news.quellenZu' : 'chart.news.quellenAuf', { n: ergebnis.quellen.length }) }}
            </button>
            <ol v-if="alleQuellen" class="quellen">
                <li v-for="q in ergebnis.quellen" :key="q.nr" :value="q.nr">
                    <a :href="q.url" target="_blank" rel="noopener noreferrer">{{ q.art === 'x' ? 'X ' : '' }}{{ q.titel }}</a>
                    <small v-if="q.zeit"> · {{ uhr(q.zeit) }}</small>
                    <div v-if="q.text" class="quellText">{{ q.text }}</div>
                </li>
            </ol>
        </template>
        <div v-else-if="!laeuft && !fehler" class="leer">{{ t('chart.news.leer') }}</div>
    </div>
</template>

<style scoped>
.flashReiter {
    display: flex;
    flex-direction: column;
    gap: 6px;
    overflow-y: auto;
    min-height: 0;
    height: 100%;
    font-size: 12px;
}

.zeitraum {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    color: var(--muted);
}

.zeitraum button {
    padding: 1px 10px;
    border: 1px solid var(--line);
    border-radius: var(--radius-pille);
    background: transparent;
    color: var(--muted);
    font-size: 11px;
    cursor: pointer;
}

.zeitraum button.an {
    border-color: var(--accent);
    background: var(--accent-schwach);
    color: var(--text);
}

.abrufen {
    align-self: flex-start;
}

.hinweis,
.leer,
.kopf {
    color: var(--muted);
    font-size: 11px;
}

.fehler {
    color: var(--bad);
}

.kurz {
    margin: 0;
    font-weight: 600;
}

.nichts {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--muted);
}

.inhalt {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.punkt {
    padding: 6px 8px;
    border-left: 2px solid var(--accent);
    background: var(--panel-soft);
    border-radius: 4px;
    line-height: 1.4;
}

.zeit {
    color: var(--accent);
    font-variant-numeric: tabular-nums;
    margin-right: 6px;
}

.belege {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 3px;
    margin-left: 4px;
}

.beleg {
    font-size: 10px;
    padding: 0 6px;
    border-radius: var(--radius-pille);
    background: var(--line);
    color: var(--text);
    text-decoration: none;
    white-space: nowrap;
}

.beleg:hover {
    background: var(--accent-schwach);
    color: var(--accent);
}

.textKnopf {
    align-self: flex-start;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--accent);
    font-size: 11px;
    cursor: pointer;
}

.quellen {
    margin: 0;
    padding-left: 20px;
    color: var(--muted);
}

.quellen a {
    color: var(--text);
}

.quellText {
    font-size: 11px;
    color: var(--muted);
}
</style>
