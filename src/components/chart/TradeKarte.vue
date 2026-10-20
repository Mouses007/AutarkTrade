<script setup>
/**
 * Karte zu einem Journal-Trade, geöffnet per Klick auf seinen Marker im Chart:
 * Ergebnis, R, Dauer, Stop/Ziel, Notizen, Playbook, Tags — und der Sprung in
 * die Tagesansicht des Journals, wo Screenshots und Bewertung liegen.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import dayjs from '../../utils/journal/zeit.js'
import { tradeZeitzone, scrollToDateUnix } from '../../stores/ui.js'
import { gewaehlterMonat, selectedMonthPreset } from '../../stores/filters.js'
import { dauerText } from '../../utils/chart/zeichnungen/geometrie.js'
import { Symbol, Knopf } from '../basis'

const props = defineProps({
    trade: { type: Object, required: true },
    formatPreis: { type: Function, required: true },
})
const emit = defineEmits(['schliesse'])
const { t } = useI18n()
const router = useRouter()

const tr = computed(() => props.trade)
const dauer = computed(() => (tr.value.ausstieg ? dauerText(tr.value.ausstieg.t - tr.value.einstieg.t) : null))
const zeit = (ms) => dayjs(ms).format('DD.MM.YY HH:mm')
const geld = (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)} USDT`)

/*
 * Die Tagesansicht zeigt nur den gewählten Monat (Monatsfilter) — ohne ihn
 * umzustellen, landete der Sprung auf „Keine Daten". Danach scrollt sie über
 * `scrollToDateUnix` zum Tag, wie beim Klick im Kalender.
 */
function zumJournal() {
    const tz = tradeZeitzone.value || 'UTC'
    const tag = tr.value.tag || dayjs(tr.value.ausstieg?.t || tr.value.einstieg.t).tz(tz).startOf('day').unix()
    const start = dayjs.unix(tag).tz(tz).startOf('month').unix()
    const ende = dayjs.unix(tag).tz(tz).endOf('month').unix()
    gewaehlterMonat.value = { start, end: ende }
    selectedMonthPreset.value = 'custom'
    try {
        localStorage.setItem('at.journal.monat', JSON.stringify(gewaehlterMonat.value))
        localStorage.setItem('selectedMonthPreset', 'custom')
    } catch { /* ohne Speicher geht der Sprung trotzdem */ }
    scrollToDateUnix.value = tag
    router.push('/tagesansicht')
}
</script>

<template>
    <div class="tradeKarte" @mousedown.stop @pointerdown.stop>
        <div class="kopf">
            <span class="richtung" :class="tr.richtung">{{ t(tr.richtung === 'long' ? 'chart.richtungLong' : 'chart.richtungShort') }}</span>
            <span class="broker">{{ tr.broker }}</span>
            <button type="button" class="zu" :aria-label="t('common.close')" :title="t('common.close')" @click="emit('schliesse')"><Symbol name="schliessen" /></button>
        </div>
        <div class="ergebnis" :class="(tr.netto ?? 0) >= 0 ? 'gewinnWert' : 'verlustWert'">
            {{ geld(tr.netto) }}
            <span v-if="tr.r != null" class="r">{{ tr.r >= 0 ? '+' : '' }}{{ tr.r.toFixed(2) }} R</span>
        </div>
        <table><tbody>
            <tr><td>{{ t('chart.trade.einstieg') }}</td><td>{{ formatPreis(tr.einstieg.p) }}</td><td>{{ zeit(tr.einstieg.t) }}</td></tr>
            <tr v-if="tr.ausstieg"><td>{{ t('chart.trade.ausstieg') }}</td><td>{{ formatPreis(tr.ausstieg.p) }}</td><td>{{ zeit(tr.ausstieg.t) }}</td></tr>
            <tr v-if="tr.anfangsStop"><td>{{ t('chart.trade.stop') }}</td><td>{{ formatPreis(tr.anfangsStop) }}</td><td></td></tr>
            <tr v-if="tr.tp"><td>{{ t('chart.trade.ziel') }}</td><td>{{ formatPreis(tr.tp) }}</td><td></td></tr>
            <tr v-if="dauer"><td>{{ t('chart.trade.dauer') }}</td><td colspan="2">{{ dauer }}</td></tr>
            <tr v-if="tr.gebuehren || tr.funding"><td>{{ t('chart.trade.kosten') }}</td>
                <td colspan="2">{{ (tr.gebuehren || 0).toFixed(2) }} + {{ (tr.funding || 0).toFixed(2) }} Funding</td></tr>
        </tbody></table>
        <div v-if="tr.r == null && tr.ausstieg" class="hinweis">{{ t('chart.trade.keinR') }}</div>
        <template v-if="tr.notiz">
            <div v-if="tr.notiz.playbook" class="feld"><b>{{ t('chart.playbook') }}</b> {{ tr.notiz.playbook }}</div>
            <div v-if="tr.notiz.einstieg" class="feld"><b>{{ t('chart.trade.notizEinstieg') }}</b> {{ tr.notiz.einstieg }}</div>
            <div v-if="tr.notiz.ausstieg" class="feld"><b>{{ t('chart.trade.notizAusstieg') }}</b> {{ tr.notiz.ausstieg }}</div>
            <div v-if="tr.notiz.regelTreu != null && tr.notiz.regelTreu >= 0" class="feld">
                <b>{{ t('chart.trade.regelTreu') }}</b> {{ tr.notiz.regelTreu === 1 ? t('chart.trade.ja') : t('chart.trade.nein') }}</div>
        </template>
        <div v-if="tr.tags?.length" class="tags"><span v-for="g in tr.tags" :key="g" class="tag">{{ g }}</span></div>
        <Knopf klein symbol="buch" class="zumJournal" @click="zumJournal">{{ t('chart.trade.zumJournal') }}</Knopf>
    </div>
</template>

<style scoped>
.tradeKarte {
    position: absolute;
    top: 34px;
    right: 70px;
    z-index: 7;
    width: 280px;
    max-width: calc(100% - 80px);
    max-height: calc(100% - 50px);
    overflow-y: auto;
    background: var(--panel);
    border: 1px solid var(--line-stark);
    border-radius: var(--radius-klein);
    padding: 10px;
    box-shadow: var(--schatten);
    font-size: 12px;
}

.kopf {
    display: flex;
    align-items: center;
    gap: 8px;
}

.richtung {
    font-weight: 600;
    padding: 0 6px;
    border-radius: 3px;
}

.richtung.long {
    background: var(--good-flaeche);
    color: var(--good);
}

.richtung.short {
    background: var(--bad-flaeche);
    color: var(--bad);
}

.broker {
    color: var(--muted);
    flex: 1;
}

.zu {
    background: transparent;
    border: none;
    color: var(--muted);
    display: inline-flex;
    cursor: pointer;
}

.zu:hover {
    color: var(--text);
}

.zumJournal {
    width: 100%;
    margin-top: var(--abstand-2);
}

.ergebnis {
    font-size: 16px;
    font-weight: 600;
    margin: 6px 0;
}

.ergebnis .r {
    font-size: 13px;
    margin-left: 8px;
}

table {
    width: 100%;
}

td {
    padding: 1px 4px 1px 0;
    color: var(--text);
}

td:first-child {
    color: var(--muted);
}

.hinweis {
    color: var(--muted);
    font-size: 11px;
    margin-top: 4px;
}

.feld {
    margin-top: 6px;
    white-space: pre-wrap;
}

.feld b {
    color: var(--muted);
    font-weight: 500;
    display: block;
}

.tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 6px;
}

.tag {
    background: var(--line);
    border-radius: 3px;
    padding: 0 5px;
    font-size: 11px;
}
</style>
