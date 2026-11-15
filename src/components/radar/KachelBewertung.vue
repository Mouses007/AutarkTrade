<script setup>
/**
 * Kachel „Bitcoin-Bewertung".
 *
 * Wo steht der Kurs gemessen an seiner eigenen Geschichte? Drei
 * Vergleichspreise (Realized Price, 200-Wochen-Durchschnitt, Einstand der
 * kurzfristigen Halter), je mit dem Abstand des Kurses und einem Rang: an wie
 * viel Prozent der bisherigen Tage war das Verhältnis tiefer als heute.
 *
 * Die grosse Zahl ist der Mittelwert der Ränge mit langer Geschichte. Der
 * Kurzfrist-Einstand zählt nicht mit, solange sein Verlauf nur wenige Jahre
 * umfasst — die Rechnung dazu steht in `server/bewertung.js`.
 *
 * Wie beim Pi-Cycle: eine Einordnung, kein Signal. Die Farben sagen „tief"
 * und „hoch" bewertet, nicht „kaufen" und „verkaufen".
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import * as echarts from 'echarts'
import dayjs from '../../utils/journal/zeit.js'
import Symbol from '@/components/basis/Symbol.vue'

const props = defineProps({
    daten: { type: Object, default: null },
    gross: { type: Boolean, default: false },
})

const { t } = useI18n()
const chartEl = ref(null)
let chart = null
let ro = null

const leer = computed(() => !!props.daten?.leer)
const gesamt = computed(() => props.daten?.gesamt || null)
const modelle = computed(() => props.daten?.modelle || [])
/** Ältester Starttag der Modelle, die in den Gesamtwert eingehen. */
const seitJahr = computed(() => {
    const lang = modelle.value.filter(m => m.zaehlt)
    return lang.length ? dayjs(Math.max(...lang.map(m => m.seit))).format('YYYY') : ''
})

const preis = (v) => (Number.isFinite(v) ? Math.round(v).toLocaleString('de-CH') : '—')
const pct = (v) => (Number.isFinite(v) ? `${v > 0 ? '+' : ''}${v.toFixed(1)} %` : '—')

const FARBEN = { kurs: 'rgba(255,255,255,0.45)', realized: '#e8a33d', w200: '#26be96', sth: '#5b9bd5' }

function zeichne() {
    if (!props.gross) return
    starteChart()
    const punkte = props.daten?.verlauf
    if (!chart || !punkte?.length) return

    const reihe = (name, spalte, farbe, breite) => ({
        name, type: 'line', showSymbol: false, connectNulls: false,
        data: punkte.map(p => [p[0], p[spalte]]),
        lineStyle: { width: breite, color: farbe },
        itemStyle: { color: farbe },
    })

    chart.setOption({
        backgroundColor: 'transparent',
        animation: false,
        grid: { left: 62, right: 8, top: 30, bottom: 28 },
        legend: { top: 0, textStyle: { color: 'rgba(255,255,255,0.72)', fontSize: 12 } },
        tooltip: {
            trigger: 'axis',
            backgroundColor: 'rgba(18,18,18,0.94)',
            borderColor: 'rgba(255,255,255,0.18)',
            textStyle: { color: 'rgba(255,255,255,0.87)', fontSize: 12 },
            formatter: (p) => `${dayjs(p[0].data[0]).format('DD.MM.YYYY')}<br/>`
                + p.filter(x => x.data[1] !== null)
                    .map(x => `${x.marker}${x.seriesName}: <b>${preis(x.data[1])} $</b>`).join('<br/>'),
        },
        xAxis: {
            type: 'time',
            axisLabel: { color: 'rgba(255,255,255,0.72)', fontSize: 12 },
            axisLine: { lineStyle: { color: 'rgba(255,255,255,0.15)' } },
        },
        yAxis: {
            type: 'log', logBase: 10,
            axisLabel: {
                color: 'rgba(255,255,255,0.72)', fontSize: 12,
                formatter: (v) => (v >= 1000 ? `${v / 1000}k` : v),
            },
            splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
        },
        series: [
            reihe('BTC', 1, FARBEN.kurs, 1),
            reihe(t('marktradar.bewertung.modell.realized'), 2, FARBEN.realized, 1.6),
            reihe(t('marktradar.bewertung.modell.w200'), 3, FARBEN.w200, 1.6),
            reihe(t('marktradar.bewertung.modell.sth'), 4, FARBEN.sth, 1.6),
        ],
    }, true)
}

/** Wie in der Pi-Cycle-Kachel: das Element entsteht erst mit den Daten. */
function starteChart() {
    if (!chartEl.value || chart?.getDom() === chartEl.value) return
    if (chart) { ro?.disconnect(); chart.dispose() }
    chart = echarts.init(chartEl.value)
    ro = new ResizeObserver(() => chart?.resize())
    ro.observe(chartEl.value)
    requestAnimationFrame(() => chart?.resize())
}

onMounted(async () => {
    await nextTick()
    zeichne()
})

onBeforeUnmount(() => {
    ro?.disconnect()
    ro = null
    chart?.dispose()
    chart = null
})

watch(() => props.daten, zeichne, { flush: 'post' })
</script>

<template>
    <div v-if="daten" class="bwWrap" :class="{ gross }">
        <div v-if="leer" class="bwLeer">
            <Symbol name="uhr" />
            <p>{{ daten.hinweis || t('marktradar.bewertung.wartet') }}</p>
        </div>

        <template v-else>
            <div class="bwKopf">
                <span class="bwRang" :class="gesamt?.stufe || 'ohne'">
                    {{ gesamt?.rang === null || gesamt?.rang === undefined ? '—' : 'Q' + gesamt.rang }}
                </span>
                <span v-if="gesamt?.stufe" class="bwStufe">{{ t('marktradar.bewertung.stufe.' + gesamt.stufe) }}</span>
            </div>
            <p v-if="gesamt?.rang !== null && gesamt?.rang !== undefined" class="bwSatz">
                {{ t('marktradar.bewertung.hoeher', { pct: 100 - gesamt.rang, jahr: seitJahr }) }}
            </p>
            <p v-else class="bwSatz">{{ t('marktradar.bewertung.ohneGesamt') }}</p>

            <div class="bwModelle">
                <div v-for="m in modelle" :key="m.id" class="bwModell" :class="{ neben: !m.zaehlt }">
                    <span class="bwName">{{ t('marktradar.bewertung.modell.' + m.id) }}</span>
                    <span class="bwPreis">{{ preis(m.wert) }} $</span>
                    <span class="bwAbstand">{{ pct(m.abstandPct) }}</span>
                    <span class="bwSkala" role="img"
                        :aria-label="t('marktradar.bewertung.rangVon', { rang: m.rang })">
                        <i :style="{ left: m.rang + '%' }"></i>
                    </span>
                    <span class="bwZahl">{{ m.rang }}</span>
                </div>
            </div>

            <div class="bwFuss">
                {{ t('marktradar.bewertung.stand', { preis: preis(daten.preis), datum: dayjs(daten.tag).format('DD.MM.') }) }}
            </div>

            <template v-if="gross">
                <div ref="chartEl" class="bwChart"></div>

                <table class="bwTabelle">
                    <thead>
                        <tr>
                            <th>{{ t('marktradar.bewertung.spalte.modell') }}</th>
                            <th>{{ t('marktradar.bewertung.spalte.preis') }}</th>
                            <th>{{ t('marktradar.bewertung.spalte.abstand') }}</th>
                            <th>{{ t('marktradar.bewertung.spalte.rang') }}</th>
                            <th>{{ t('marktradar.bewertung.spalte.seit') }}</th>
                            <th>{{ t('marktradar.bewertung.spalte.stand') }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="m in modelle" :key="m.id">
                            <td>{{ t('marktradar.bewertung.modell.' + m.id) }}</td>
                            <td>{{ preis(m.wert) }} $</td>
                            <td>{{ pct(m.abstandPct) }}</td>
                            <td>{{ m.rang }}</td>
                            <td>{{ dayjs(m.seit).format('MM/YYYY') }}</td>
                            <td>{{ dayjs(m.stand).format('DD.MM.YYYY') }}</td>
                        </tr>
                    </tbody>
                </table>

                <p v-for="m in modelle.filter(x => !x.zaehlt)" :key="'n' + m.id" class="bwHinweis">
                    {{ t('marktradar.bewertung.zaehltNicht', {
                        modell: t('marktradar.bewertung.modell.' + m.id),
                        datum: dayjs(m.seit).format('MM/YYYY'),
                    }) }}
                </p>
                <p class="bwWarnung">{{ t('marktradar.bewertung.caveat') }}</p>
            </template>
        </template>
    </div>
</template>

<style scoped>
.bwWrap {
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
}

.bwLeer {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    color: var(--muted);
    font-size: 0.86rem;
    text-align: center;
}

.bwLeer p {
    margin: 0;
}

.bwKopf {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    flex-wrap: wrap;
}

.bwRang {
    font-size: 1.6rem;
    font-weight: 700;
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
    color: var(--text);
}

.bwRang.guenstig { color: #26be96; }
.bwRang.eherGuenstig { color: #8fcf6b; }
.bwRang.eherTeuer { color: #e8a33d; }
.bwRang.teuer { color: rgb(255, 95, 86); }

.bwStufe {
    font-size: 0.86rem;
    color: var(--muted);
}

.bwSatz {
    margin: 0.1rem 0 0.45rem;
    line-height: 1.25;
    font-size: 0.8rem;
    color: var(--muted);
}

.bwModelle {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
}

.bwWrap.gross .bwModelle {
    gap: 0.45rem;
}

/* Klein: eine Zeile je Modell — Name, Skala, Rang, Abstand. Der
   Vergleichspreis steht nur in der Gross-Ansicht (zweizeilig). */
.bwModell {
    display: grid;
    grid-template-columns: 9.6em minmax(36px, 1fr) 1.6em 4.4em;
    grid-template-areas: 'name skala zahl abstand';
    align-items: center;
    column-gap: 0.5rem;
    font-size: 0.84rem;
}

.bwWrap.gross .bwModell {
    grid-template-columns: minmax(0, 1fr) auto 4.6em;
    grid-template-areas:
        'name preis abstand'
        'skala skala zahl';
    align-items: baseline;
    column-gap: 0.6rem;
    row-gap: 0.15rem;
}

.bwModell.neben {
    opacity: 0.72;
}

.bwName {
    grid-area: name;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.bwPreis {
    display: none;
    grid-area: preis;
    font-variant-numeric: tabular-nums;
}

.bwWrap.gross .bwPreis {
    display: inline;
}

/* Bewusst ohne Rot und Grün: „Kurs über dem Vergleichspreis" ist keine gute
   oder schlechte Nachricht, die Einordnung trägt allein der Rang. */
.bwAbstand {
    grid-area: abstand;
    text-align: right;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
}

.bwSkala {
    grid-area: skala;
    position: relative;
    align-self: center;
    height: 4px;
    border-radius: 2px;
    background: linear-gradient(90deg, #26be96, #8fcf6b 25%, rgba(255, 255, 255, 0.35) 50%, #e8a33d 75%, rgb(255, 95, 86));
    opacity: 0.85;
}

.bwSkala i {
    position: absolute;
    top: -4px;
    width: 3px;
    height: 12px;
    margin-left: -1.5px;
    border-radius: 1px;
    background: var(--text);
}

.bwZahl {
    grid-area: zahl;
    text-align: right;
    font-size: 0.78rem;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
}

.bwFuss {
    margin-top: auto;
    padding-top: 0.5rem;
    font-size: 0.78rem;
    color: var(--muted);
}

.bwWrap.gross .bwFuss {
    margin-top: 0.6rem;
}

.bwWrap.gross .bwModelle {
    max-width: 34rem;
}

.bwChart {
    margin-top: 0.8rem;
    min-height: 44vh;
}

.bwTabelle {
    width: 100%;
    margin-top: 0.8rem;
    border-collapse: collapse;
    font-size: 0.84rem;
    font-variant-numeric: tabular-nums;
}

.bwTabelle th {
    padding: 0.3rem 0.5rem;
    text-align: right;
    font-weight: 500;
    font-size: 0.76rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
    border-bottom: 1px solid rgba(255, 255, 255, 0.12);
}

.bwTabelle td {
    padding: 0.3rem 0.5rem;
    text-align: right;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.bwTabelle th:first-child,
.bwTabelle td:first-child {
    text-align: left;
}

.bwHinweis {
    margin: 0.6rem 0 0;
    font-size: 0.82rem;
    color: var(--muted);
}

.bwWarnung {
    margin: 0.7rem 0 0;
    padding: 0.4rem 0.6rem;
    border-left: 3px solid rgba(240, 196, 25, 0.8);
    background: rgba(240, 196, 25, 0.08);
    font-size: 0.82rem;
    color: color-mix(in srgb, var(--text) 70%, var(--muted));
}
</style>
