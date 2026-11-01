<script setup>
/**
 * Seitenleiste „Alarme": zuerst die eingestellten Alarme des aktiven Symbols
 * (oder aller) — Ein/Aus, Ändern, Löschen, Verlauf der Auslösungen —, darüber
 * EIN Knopf „Alarm hinzufügen" mit der Auswahl der Arten (31.10.2026; vorher
 * drei Knöpfe und ein Hinweistext über der Liste). Momentum- und LSOB-Alarme
 * über Watchlists gehören keinem Symbol und stehen deshalb immer in der Liste.
 * Unten ein Test der Push-Kanäle.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import { alarme, beschreibe, trefferText, aendereAlarm, loescheAlarm } from '../../stores/chartAlarme.js'
import { wischbar } from '../../utils/chart/alarmHinweise.js'
import { Symbol, Knopf } from '../basis'

const props = defineProps({
    symbol: { type: String, required: true },
    markt: { type: String, default: 'futures' },
    kurs: { type: Number, default: null },
    watchlists: { type: Array, default: () => [] },
})
const emit = defineEmits(['neu', 'neuMomentum', 'neuLsob', 'bearbeite'])
const { t } = useI18n()

const alle = ref(false)
// Auswahl „Alarm hinzufügen": klappt unter dem Knopf auf, Klick daneben oder Esc schliesst
const auswahl = ref(false)
const auswahlEl = ref(null)
function waehle(art) {
    auswahl.value = false
    if (art === 'preis') emit('neu', props.kurs)
    else if (art === 'momentum') emit('neuMomentum')
    else if (art === 'lsob') emit('neuLsob')
}
const zu = (e) => { if (auswahl.value && !auswahlEl.value?.contains(e.target)) auswahl.value = false }
const taste = (e) => { if (e.key === 'Escape') auswahl.value = false }
onMounted(() => { document.addEventListener('pointerdown', zu, true); document.addEventListener('keydown', taste) })
onBeforeUnmount(() => { document.removeEventListener('pointerdown', zu, true); document.removeEventListener('keydown', taste) })
const offen = ref(null)
const testStand = ref('')

const MEHRFACH = ['momentum', 'lsob']
const aufListen = (a) => MEHRFACH.includes(a.art) && a.watchlistIds?.length > 0
const liste = computed(() => (alle.value ? alarme.value : alarme.value.filter((a) => a.symbol === props.symbol || aufListen(a))))
/** Wen der Alarm überwacht: das Symbol oder die Namen seiner Watchlists. */
function ziel(a) {
    if (!aufListen(a)) return a.symbol
    return a.watchlistIds.map((id) => props.watchlists.find((w) => w.id === id)?.name || `#${id}`).join(', ')
}
const zeit = (ms) => (ms ? new Date(ms).toLocaleString() : '—')

async function test() {
    testStand.value = '…'
    try {
        const { data } = await axios.post('/api/chart/alarme/test')
        // Je Kanal sagen, was passiert ist — „verschickt" ohne einen einzigen Kanal war eine Lüge.
        const teile = Object.entries(data?.ergebnis || {}).filter(([, v]) => v !== 'aus')
            .map(([k, v]) => `${k}: ${v === 'ok' ? '✓' : v}`)
        testStand.value = data?.ok ? `${t('chart.alarm.testOk')} (${teile.join(', ')})`
            : teile.length ? `${t('chart.alarm.testFehler')} — ${teile.join(', ')}` : t('chart.alarm.testKeinKanal')
    } catch (e) {
        testStand.value = e.response?.data?.error || e.message
    }
}

/*
 * „Ausgelöste entfernen": Alarme, die gefeuert und sich DESHALB selbst abgeschaltet
 * haben (einmalige, LSOB-Box nach dem Bruch) — der Server vermerkt das in `selbstAus`.
 * Wiederholende bleiben, auch von Hand pausierte, die früher schon ausgelöst haben
 * (Audit FUN-F2B-003), ebenso Alarme, die sich aus einem anderen Grund abgeschaltet
 * haben (Linie zu Ende, Watchlist leer …). Die Rückfrage nennt jeden beim Namen.
 */
const ausgeloest = computed(() => liste.value.filter(wischbar))
const raeumt = ref(false)
const NAMEN_MAX = 10
async function wische() {
    const weg = ausgeloest.value
    const namen = weg.slice(0, NAMEN_MAX).map((a) => `• ${ziel(a)} ${beschreibe(a)}`)
    if (weg.length > NAMEN_MAX) namen.push('…')
    if (!weg.length || !window.confirm(t('chart.alarm.wischenFrage', { n: weg.length, namen: namen.join('\n') }, weg.length))) return
    raeumt.value = true
    try { for (const a of weg) await loescheAlarm(a.id) } finally { raeumt.value = false }
}

function loesche(a) {
    if (window.confirm(t('chart.alarm.loeschenFrage', { was: `${a.symbol} ${beschreibe(a)}` }))) loescheAlarm(a.id)
}
</script>

<template>
    <div class="alarmReiter">
        <div ref="auswahlEl" class="kopf">
            <Knopf klein symbol="plus" :aria-expanded="auswahl" @click="auswahl = !auswahl">{{ t('chart.alarm.hinzufuegen') }}</Knopf>
            <button v-if="ausgeloest.length" type="button" class="wischen" :disabled="raeumt" :title="t('chart.alarm.wischenTitel')" @click="wische">
                <Symbol name="muell" /> {{ t('chart.alarm.wischen', { n: ausgeloest.length }) }}</button>
            <label class="alle" :title="t('chart.alarm.alleSymbole')"><input v-model="alle" type="checkbox" /> {{ t('chart.alarm.alleKurz') }}</label>
            <div v-if="auswahl" class="auswahl" role="menu">
                <button type="button" role="menuitem" @click="waehle('preis')">
                    <span class="titel"><Symbol name="glocke" /> {{ t('chart.alarm.neuPreis', { symbol }) }}</span>
                    <small>{{ t('chart.alarm.wahl.preis') }}</small></button>
                <button type="button" role="menuitem" @click="waehle('momentum')">
                    <span class="titel"><Symbol name="tacho" /> {{ t('chart.alarm.wahl.momentumTitel') }}</span>
                    <small>{{ t('chart.alarm.wahl.momentum') }}</small></button>
                <button type="button" role="menuitem" @click="waehle('lsob')">
                    <span class="titel"><Symbol name="quadrat" /> {{ t('chart.alarm.wahl.lsobTitel') }}</span>
                    <small>{{ t('chart.alarm.wahl.lsob') }}</small></button>
                <div class="hinweis">
                    <span class="titel"><Symbol name="linie" /> {{ t('chart.alarm.wahl.linieTitel') }}</span>
                    <small>{{ t('chart.alarm.wahl.linie') }}</small></div>
            </div>
        </div>
        <div v-if="!liste.length" class="leer">{{ t(alle ? 'chart.alarm.leerAlle' : 'chart.alarm.leerSymbol', { symbol }) }}</div>
        <div v-for="a in liste" :key="a.id" class="alarm" :class="{ aus: !a.aktiv }">
            <div class="zeile" @click="offen = offen === a.id ? null : a.id">
                <span class="sym" :class="{ listen: aufListen(a) }">{{ ziel(a) }}<small v-if="a.markt === 'spot' && !aufListen(a)"> Spot</small></span>
                <span class="was">{{ beschreibe(a) }}</span>
                <span class="werkzeug" @click.stop>
                    <button type="button" :title="t(a.aktiv ? 'chart.alarm.ausschalten' : 'chart.alarm.einschalten')"
                        @click="aendereAlarm(a.id, { aktiv: !a.aktiv })" :aria-label="t(a.aktiv ? 'chart.alarm.ausschalten' : 'chart.alarm.einschalten')">
                        <Symbol :name="a.aktiv ? 'glocke' : 'glockeAus'" /></button>
                    <button type="button" :title="t('chart.einstellungen')" @click="emit('bearbeite', a)" :aria-label="t('chart.einstellungen')"><Symbol name="stift" /></button>
                    <button type="button" :title="t('chart.entfernen')" @click="loesche(a)" :aria-label="t('chart.entfernen')"><Symbol name="muell" /></button>
                </span>
            </div>
            <div v-if="offen === a.id" class="details">
                <div>{{ a.einmalig ? t('chart.alarm.einmalig') : MEHRFACH.includes(a.art) ? t('chart.alarm.momentum.jeKerze') : t('chart.alarm.wiederholend', { min: a.bedingung.sperreMin ?? 15 }) }}</div>
                <div v-if="a.notiz">{{ a.notiz }}</div>
                <div>{{ t('chart.alarm.zuletzt') }}: {{ zeit(a.ausgeloestAm) }} ({{ a.anzahlAusgeloest }}×)</div>
                <div v-for="(v, i) in [...a.verlauf].reverse().slice(0, 5)" :key="i" class="verlauf">{{ zeit(v.t) }}<template v-if="v.treffer?.length"> · {{ v.treffer.map(trefferText).join(', ') }}</template><template v-else-if="v.p != null"> · {{ v.p }}</template><template v-if="v.hinweis === 'geometrieEndet'"> · {{ t('chart.alarm.geometrieEndet') }}</template><template v-else-if="v.hinweis === 'profilGeaendert'"> · {{ t('chart.alarm.profilGeaendert') }}</template><template v-else-if="v.hinweis === 'watchlistLeer'"> · {{ t('chart.alarm.momentum.watchlistLeer') }}</template><template v-else-if="v.hinweis === 'boxUngueltig'"> · {{ t('chart.alarm.lsob.boxUngueltig') }}</template><template v-else-if="v.zugestellt === false"> · <span class="at-warn">{{ t('chart.alarm.nichtZugestellt') }}</span></template></div>
            </div>
        </div>
        <div class="testZeile">
            <button type="button" class="textKnopf" @click="test">{{ t('chart.alarm.test') }}</button>
            <small>{{ testStand }}</small>
        </div>
    </div>
</template>

<style scoped>
.alarmReiter {
    display: flex;
    flex-direction: column;
    gap: 6px;
    overflow-y: auto;
    min-height: 0;
    font-size: 12px;
}

.kopf {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 6px 8px;
    flex-shrink: 0;
}

.kopf > :first-child {
    white-space: nowrap;
}

.wischen {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 6px;
    border: 1px solid var(--line);
    border-radius: var(--radius-klein);
    background: transparent;
    color: var(--muted);
    font-size: 11px;
    white-space: nowrap;
    cursor: pointer;
}

.wischen:hover {
    color: var(--text);
    border-color: var(--line-stark);
}

/* Klappt IM Reiter auf (der Reiter scrollt; schwebend würde sie abgeschnitten) */
.auswahl {
    flex-basis: 100%;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 4px;
    background: var(--panel);
    border: 1px solid var(--line-stark);
    border-radius: var(--radius-klein);
    box-shadow: var(--schatten);
}

.auswahl button,
.auswahl .hinweis {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 8px;
    border: none;
    border-radius: var(--radius-klein);
    background: transparent;
    color: var(--text);
    text-align: left;
    font: inherit;
}

.auswahl button {
    cursor: pointer;
}

.auswahl button:hover,
.auswahl button:focus-visible {
    background: var(--panel-soft);
}

.auswahl .hinweis {
    border-top: 1px solid var(--line);
    margin-top: 2px;
    color: var(--muted);
}

.auswahl .titel {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-weight: 500;
}

.auswahl small {
    color: var(--muted);
    font-size: 11px;
    line-height: 1.35;
    padding-left: 20px;
}

.leer {
    color: var(--muted);
    font-size: 11px;
}

.alle {
    display: flex;
    gap: 4px;
    align-items: center;
    color: var(--muted);
    font-size: 11px;
    white-space: nowrap;
}

.alarm {
    border-radius: 4px;
}

.alarm.aus {
    opacity: 0.5;
}

.zeile {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    border-radius: 4px;
    cursor: pointer;
}

.zeile:hover {
    background: var(--line);
}

.sym {
    font-weight: 500;
}

.sym.listen {
    max-width: 45%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.was {
    flex: 1;
    color: var(--muted);
}

.werkzeug button {
    background: transparent;
    border: none;
    color: var(--muted);
    padding: 0 3px;
    display: inline-flex;
    cursor: pointer;
}

.werkzeug button:hover {
    color: var(--text);
}

.details {
    padding: 2px 8px 6px 14px;
    color: var(--muted);
    font-size: 11px;
}

.textKnopf {
    background: none;
    border: none;
    padding: 0;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
}

.textKnopf:hover {
    text-decoration: underline;
}

.testZeile {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-top: 6px;
}
</style>
