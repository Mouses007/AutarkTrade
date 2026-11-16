<script setup>
/**
 * Karte zu einem Quartalszahlen-Termin, geöffnet per Klick auf sein Schild im
 * Aktien-Chart (`AktienEbene.trefferTest`): wann gemeldet wurde, was gemeldet
 * wurde (Gewinn je Aktie gegen Schätzung, Überraschung) und wie der Kurs
 * reagiert hat — beim kommenden Termin die Schätzung.
 *
 * Alles aus dem Aktien-Kontext des Panels und den geladenen Kerzen
 * (`utils/chart/zahlenKarte.js`), kein eigener Abruf. Fehlen die Zahlen, steht
 * das in einem Satz da.
 *
 * Zu mit ×, Escape oder einem Klick daneben.
 */
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import dayjs from '../../utils/journal/zeit.js'
import { tradeZeitzone } from '../../stores/ui.js'
import { ZONE } from '../../../shared/aktien-sitzung.js'
import { zahlenKarteDaten, grosseZahl } from '../../utils/chart/zahlenKarte.js'
import { Karte, Knopf, Hinweis, Pille, Symbol } from '../basis'

const props = defineProps({
    /** Aktien-Kontext des Panels: `{ticker, name, termine}` */
    aktie: { type: Object, required: true },
    /** Marke aus `zahlenMarken`: `{zeit, kommend, geschaetzt, tage}` */
    marke: { type: Object, required: true },
    kerzen: { type: Array, default: () => [] },
    intervallMs: { type: Number, default: 0 },
    /** Adresse der Titel-Seite (`researchZiel`) — ohne sie kein Knopf. */
    ziel: { type: Object, default: null },
})
const emit = defineEmits(['schliesse'])
const { t } = useI18n()

const d = computed(() => zahlenKarteDaten(props.marke, props.aktie?.termine, { kerzen: props.kerzen, iv: props.intervallMs }))

const ortszeit = computed(() => dayjs(d.value.zeit).tz(tradeZeitzone.value || dayjs.tz.guess()).format('DD.MM.YYYY HH:mm'))
const nyZeit = computed(() => dayjs(d.value.zeit).tz(ZONE).format('HH:mm'))
const zeitKurz = (ms) => dayjs(ms).tz(tradeZeitzone.value || dayjs.tz.guess()).format('DD.MM. HH:mm')

const zahl = (v, stellen = 2) => (v == null ? '—' : v.toFixed(stellen))
const mitVorzeichen = (v, stellen = 2) => `${v >= 0 ? '+' : ''}${v.toFixed(stellen)} %`
const ton = (v) => (v > 0 ? 'gut' : v < 0 ? 'schlecht' : '')
const umsatz = computed(() => {
    const g = grosseZahl(d.value.umsatzSchaetzung)
    if (!g) return null
    return g.einheit ? t('chart.aktien.karte.' + g.einheit, { wert: g.wert.toFixed(g.wert >= 100 ? 0 : 1) }) : g.wert.toFixed(0)
})
const wann = computed(() => {
    if (!d.value.kommend) return null
    return d.value.tage === 0 ? t('chart.aktien.zahlenHeute') : d.value.tage === 1 ? t('chart.aktien.zahlenMorgen') : t('chart.aktien.zahlenInTagen', { n: d.value.tage })
})

// Fokus in die Karte: Escape und Tab wirken dann hier, und ein Screenreader liest sie vor.
const el = ref(null)
function daneben(e) {
    if (el.value && !el.value.contains(e.target)) emit('schliesse', 'daneben')
}
onMounted(() => {
    el.value?.focus({ preventScroll: true })
    document.addEventListener('pointerdown', daneben, true)
})
onBeforeUnmount(() => document.removeEventListener('pointerdown', daneben, true))
</script>

<template>
    <div ref="el" class="zahlenKarte" role="dialog" tabindex="-1" :aria-label="t('chart.aktien.karte.titel', { ticker: aktie.ticker })"
        @mousedown.stop @pointerdown.stop @dblclick.stop @keydown.esc.stop="emit('schliesse', 'taste')">
        <Karte dicht als="div" :titel="t('chart.aktien.karte.titel', { ticker: aktie.ticker })" :unter="aktie.name || ''">
            <template #aktionen>
                <button type="button" class="zu" :aria-label="t('common.close')" :title="t('common.close')" @click="emit('schliesse', 'taste')"><Symbol name="schliessen" /></button>
            </template>

            <div class="termin">
                <span class="zeit">{{ ortszeit }}</span>
                <Pille v-if="d.geschaetzt" ton="warn">{{ t('chart.aktien.voraussichtlich') }}</Pille>
                <Pille v-else-if="d.kommend" ton="neutral">{{ t('chart.aktien.karte.bestaetigt') }}</Pille>
            </div>
            <div class="neben">
                {{ t('chart.aktien.karte.nyZeit', { zeit: nyZeit }) }}<template v-if="d.lage"> · {{ t('chart.aktien.karte.lage_' + d.lage) }}</template><template v-if="wann"> · {{ wann }}</template>
            </div>

            <table v-if="d.hatEinzelheiten || d.reaktion || d.quartal"><tbody>
                <tr v-if="d.quartal"><th scope="row">{{ t('chart.aktien.karte.quartal') }}</th><td>{{ d.quartal }}</td></tr>
                <template v-if="!d.kommend && d.hatEinzelheiten">
                    <tr><th scope="row">{{ t('chart.aktien.karte.epsGemeldet') }}</th><td>{{ zahl(d.eps) }}</td></tr>
                    <tr><th scope="row">{{ t('chart.aktien.karte.epsSchaetzung') }}</th><td>{{ zahl(d.schaetzung) }}</td></tr>
                    <tr v-if="d.ueberraschungPct != null"><th scope="row">{{ t('chart.aktien.karte.ueberraschung') }}</th>
                        <td :class="ton(d.ueberraschungPct)">{{ mitVorzeichen(d.ueberraschungPct) }}</td></tr>
                </template>
                <template v-if="d.kommend">
                    <tr v-if="d.schaetzung != null"><th scope="row">{{ t('chart.aktien.karte.epsSchaetzung') }}</th><td>{{ zahl(d.schaetzung) }}</td></tr>
                    <tr v-if="umsatz"><th scope="row">{{ t('chart.aktien.karte.umsatzSchaetzung') }}</th><td>{{ umsatz }}</td></tr>
                </template>
                <tr v-if="d.reaktion" :title="t('chart.aktien.karte.reaktionInfo', { von: zeitKurz(d.reaktion.von), bis: zeitKurz(d.reaktion.bis) })">
                    <th scope="row">{{ t('chart.aktien.karte.reaktion') }}</th>
                    <td :class="ton(d.reaktion.pct)">{{ mitVorzeichen(d.reaktion.pct) }}</td></tr>
            </tbody></table>
            <p v-if="d.reaktion" class="neben">{{ t('chart.aktien.karte.reaktionUnter') }}</p>

            <Hinweis v-if="!d.hatEinzelheiten" class="leer">
                {{ t(d.kommend ? 'chart.aktien.karte.ohneSchaetzung' : 'chart.aktien.karte.ohneZahlen') }}
            </Hinweis>

            <div class="fuss">
                <Knopf v-if="ziel" klein symbol="suche" :to="ziel">{{ t('chart.aktien.karte.titelSeite') }}</Knopf>
                <span class="quelle">{{ t('chart.aktien.karte.quelle') }}</span>
            </div>
        </Karte>
    </div>
</template>

<style scoped>
.zahlenKarte {
    position: absolute;
    z-index: 7;
    width: 270px;
    max-width: calc(100% - 16px);
    max-height: calc(100% - 16px);
    overflow-y: auto;
    border-radius: var(--radius);
    box-shadow: var(--schatten);
    font-size: 12px;
}

.zahlenKarte:focus {
    outline: none;
}

.zahlenKarte:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
}

.zahlenKarte :deep(.at-karte) {
    border-color: var(--line-stark);
}

.zu {
    background: none;
    border: 0;
    padding: 2px;
    color: var(--muted);
    cursor: pointer;
}

.zu:hover {
    color: var(--text);
}

.termin {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}

.zeit {
    font-size: 14px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
}

.neben {
    margin: 2px 0 0;
    color: var(--muted);
    font-size: 11px;
}

table {
    width: 100%;
    margin-top: 8px;
    border-collapse: collapse;
}

th {
    text-align: left;
    font-weight: 400;
    color: var(--muted);
    padding: 2px 8px 2px 0;
}

td {
    text-align: right;
    font-variant-numeric: tabular-nums;
    padding: 2px 0;
}

td.gut {
    color: var(--good);
}

td.schlecht {
    color: var(--bad);
}

.leer {
    margin-top: 8px;
}

.fuss {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-top: 10px;
}

.quelle {
    margin-left: auto;
    color: var(--muted);
    font-size: 10px;
}
</style>
