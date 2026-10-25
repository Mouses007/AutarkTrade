<script setup>
/**
 * Seitenleiste „Alarme": die Alarme des aktiven Symbols (oder aller), neuer
 * Preis-Alarm zum aktuellen Kurs, Ein/Aus, Ändern, Löschen, Verlauf der
 * Auslösungen und ein Test der Push-Kanäle. Momentum-Alarme über Watchlists
 * gehören keinem Symbol und stehen deshalb immer in der Liste.
 */
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import { alarme, beschreibe, trefferText, aendereAlarm, loescheAlarm } from '../../stores/chartAlarme.js'
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

function loesche(a) {
    if (window.confirm(t('chart.alarm.loeschenFrage', { was: `${a.symbol} ${beschreibe(a)}` }))) loescheAlarm(a.id)
}
</script>

<template>
    <div class="alarmReiter">
        <Knopf klein symbol="glocke" class="neuKnopf" @click="emit('neu', kurs)">
            {{ t('chart.alarm.neuPreis', { symbol }) }}
        </Knopf>
        <Knopf klein symbol="glocke" class="neuKnopf" @click="emit('neuMomentum')">
            {{ t('chart.alarm.neuMomentum') }}
        </Knopf>
        <Knopf klein symbol="glocke" class="neuKnopf" @click="emit('neuLsob')">
            {{ t('chart.alarm.neuLsob') }}
        </Knopf>
        <div class="tipp">{{ t('chart.alarm.tipp') }}</div>
        <label class="alle"><input v-model="alle" type="checkbox" /> {{ t('chart.alarm.alleSymbole') }}</label>
        <div v-if="!liste.length" class="leer">{{ t('chart.alarm.leer') }}</div>
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

.tipp,
.leer {
    color: var(--muted);
    font-size: 11px;
}

.alle {
    display: flex;
    gap: 6px;
    align-items: center;
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

.neuKnopf {
    align-self: flex-start;
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
