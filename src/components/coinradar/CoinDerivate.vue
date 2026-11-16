<script setup>
/**
 * Coin-Ansicht, Karte «Derivate»: Funding, Open Interest, Long/Short.
 *
 * Nichts davon ist neu geholt — es sind die Abrufe, die Chart und Marktradar
 * schon machen, mit deren Zwischenspeicher:
 *   /api/chart/funding     abgerechnete Sätze, 180 Tage (10 min Vorrat)
 *   /api/marktradar/ls-oi  Kontenquote und Open Interest stündlich (5 min Vorrat)
 * Der aktuelle Satz, sein Takt und die nächste Zahlung stehen schon in der
 * Messung (`bericht`).
 *
 * Verlauf, Open Interest und Kontenquote gibt es nur für Paare, die die
 * Marktdatenquelle führt (und Kontenquote/OI nur mit Binance). Für ein Paar,
 * das nur Bitunix führt, steht der aktuelle Satz da und ein Satz, was fehlt.
 * Gerechnet wird in `utils/coinAnsicht.js`.
 *
 * Farben: Türkis und Grau. Grün und Rot bleiben Gewinn und Verlust — ein
 * positiver Funding-Satz ist keins von beidem.
 */
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import Karte from '../basis/Karte.vue'
import Kreisel from '../basis/Kreisel.vue'
import Diagramm from '../strategien/Diagramm.vue'
import QuelleAus from '../quellen/QuelleAus.vue'
import { useCoinFormat } from '../../composables/useCoinFormat.js'
import { fundingKennzahlen, oiKennzahlen, ratenProzentAusJahr } from '../../utils/coinAnsicht.js'
import { palette, tooltipStil, schrift } from '../../utils/journal/diagramme/gestaltung.js'

const props = defineProps({ bericht: { type: Object, required: true } })
const { t } = useI18n()
const { zahl, prozent, anteil, usd, gross, datum, zeit, uhr, richtung } = useCoinFormat()

const funding = ref(null)       // Antwort von /api/chart/funding
const fundingAus = ref(null)
const lsoi = ref(null)          // Antwort von /api/marktradar/ls-oi
const lsoiAus = ref(null)
const laedt = ref(false)
let lauf = 0

const symbol = computed(() => props.bericht.symbol)
/** Nur Paare der Marktdatenquelle haben Verlauf und Open Interest. */
const mitVerlauf = computed(() => Boolean(props.bericht.beiBinance))

async function lade() {
    const eigener = ++lauf
    funding.value = null
    fundingAus.value = null
    lsoi.value = null
    lsoiAus.value = null
    if (!mitVerlauf.value) { laedt.value = false; return }
    laedt.value = true
    const hole = async (url, params, ziel, aus) => {
        try {
            const { data } = await axios.get(url, { params, timeout: 30000 })
            if (eigener !== lauf) return
            if (data?.aus) aus.value = data
            else ziel.value = data
        } catch { /* ein fehlender Verlauf ist kein Fehler der Ansicht — die Karte sagt «nicht verfügbar» */ }
    }
    await Promise.all([
        hole('/api/chart/funding', { symbol: symbol.value }, funding, fundingAus),
        hole('/api/marktradar/ls-oi', { symbol: symbol.value, stunden: 200 }, lsoi, lsoiAus),
    ])
    if (eigener === lauf) laedt.value = false
}
watch(symbol, lade, { immediate: true })

const f = computed(() => fundingKennzahlen(funding.value?.punkte))
const o = computed(() => oiKennzahlen(lsoi.value, props.bericht.preis))
const takt = computed(() => props.bericht.fundingIntervallH || f.value?.taktH || null)
/** Satz je Zahlung in Prozent — aus der Jahresrate, damit die Einheit auf beiden Messpfaden stimmt. */
const satz = computed(() => ratenProzentAusJahr(props.bericht.fundingJahresRate, takt.value) ?? f.value?.letztePct ?? null)
const werZahlt = computed(() => (satz.value == null || satz.value === 0 ? '' : t(satz.value > 0 ? 'coinAnsicht.longsZahlen' : 'coinAnsicht.shortsZahlen')))

const fundingDiagramm = computed(() => {
    const s = f.value?.serie
    if (!s || s.length < 3) return null
    const p = palette()
    return {
        animation: false,
        grid: { left: 44, right: 8, top: 10, bottom: 22 },
        tooltip: {
            trigger: 'axis', axisPointer: { type: 'shadow' }, ...tooltipStil(p),
            formatter: (x) => `${zeit(x[0].value[0])}<br><b>${prozent(x[0].value[1], 1)}</b> ${t('coinAnsicht.proJahr')}`,
        },
        xAxis: { type: 'time', axisLine: { lineStyle: { color: p.line } }, axisTick: { show: false }, axisLabel: schrift(p), splitLine: { show: false } },
        yAxis: {
            type: 'value', axisLine: { show: false }, axisTick: { show: false }, splitNumber: 2,
            axisLabel: { ...schrift(p), formatter: (v) => `${zahl(v, 0)} %` }, splitLine: { lineStyle: { color: p.gitter, type: 'dashed' } },
        },
        series: [{
            type: 'bar', barCategoryGap: '25%',
            data: s.map((x) => ({ value: x, itemStyle: { color: x[1] >= 0 ? p.accent : p.leise } })),
        }],
    }
})

const oiDiagramm = computed(() => {
    const s = o.value?.oiSerie
    if (!s || s.length < 12) return null
    const p = palette()
    return {
        animation: false,
        grid: { left: 44, right: 8, top: 10, bottom: 22 },
        tooltip: { trigger: 'axis', ...tooltipStil(p), formatter: (x) => `${zeit(x[0].value[0])}<br><b>${gross(x[0].value[1])}</b>` },
        xAxis: { type: 'time', axisLine: { lineStyle: { color: p.line } }, axisTick: { show: false }, axisLabel: schrift(p), splitLine: { show: false } },
        yAxis: {
            type: 'value', scale: true, axisLine: { show: false }, axisTick: { show: false }, splitNumber: 3,
            axisLabel: { ...schrift(p), formatter: (v) => gross(v, 1) }, splitLine: { lineStyle: { color: p.gitter, type: 'dashed' } },
        },
        series: [{ type: 'line', data: s, showSymbol: false, lineStyle: { color: p.accent, width: 1.4 } }],
    }
})
</script>

<template>
    <Karte :titel="t('coinAnsicht.derivate')" :unter="t('coinAnsicht.derivateUnter')">
        <div class="ca-fakten">
            <div class="ca-fakt">
                <span class="name">{{ t('coinAnsicht.funding') }}<template v-if="takt"> · {{ t('coinAnsicht.jeStunden', { n: takt }) }}</template></span>
                <span class="wert">{{ satz == null ? '—' : prozent(satz, 4) }}</span>
                <span class="ca-klein">
                    <template v-if="bericht.fundingJahresRate != null">{{ prozent(bericht.fundingJahresRate, 1) }} {{ t('coinAnsicht.proJahr') }}</template>
                    <template v-if="werZahlt"> · {{ werZahlt }}</template>
                </span>
            </div>
            <div class="ca-fakt">
                <span class="name">{{ t('coinAnsicht.openInterest') }}</span>
                <span class="wert">{{ o?.oiUsd == null ? '—' : usd(o.oiUsd) }}</span>
                <span v-if="o" class="ca-klein">
                    {{ t('coinAnsicht.in24h') }} <span :class="'ca-' + richtung(o.oiDelta24hPct)">{{ prozent(o.oiDelta24hPct, 1) }}</span>
                    <template v-if="o.oiDelta7dPct != null"> · {{ t('coinAnsicht.in7t') }} <span :class="'ca-' + richtung(o.oiDelta7dPct)">{{ prozent(o.oiDelta7dPct, 1) }}</span></template>
                </span>
            </div>
            <div class="ca-fakt">
                <span class="name">{{ t('coinAnsicht.longShort') }}</span>
                <span class="wert">{{ o?.longPct == null ? '—' : t('coinAnsicht.longAnteil', { n: zahl(o.longPct, 1) }) }}</span>
                <span v-if="o?.ratio != null" class="ca-klein">{{ t('coinAnsicht.verhaeltnis', { n: zahl(o.ratio, 2) }) }}</span>
            </div>
        </div>

        <p v-if="bericht.naechsteZahlung" class="ca-klein ca-fuss">{{ t('coinAnsicht.naechsteZahlung', { zeit: uhr(bericht.naechsteZahlung), datum: datum(bericht.naechsteZahlung) }) }}</p>

        <!-- Paar nur auf Bitunix: der Satz oben ist alles, was es gibt. -->
        <p v-if="!mitVerlauf" class="ca-klein ca-fuss">{{ t('coinAnsicht.derivateNurSatz') }}</p>

        <div v-else-if="laedt" class="ca-laedt hoch"><Kreisel :groesse="22" :titel="t('coinAnsicht.laedt')" /></div>

        <template v-else>
            <QuelleAus v-if="fundingAus" :aus="fundingAus" klein class="ca-abstand" />
            <template v-else-if="f">
                <h4 class="ca-h4">{{ t('coinAnsicht.fundingVerlauf') }}</h4>
                <Diagramm v-if="fundingDiagramm" :option="fundingDiagramm" :hoehe="120" />
                <p class="ca-klein">{{ t('coinAnsicht.fundingSchnitt', { d7: prozent(f.jahr7dPct, 1), d30: prozent(f.jahr30dPct, 1) }) + (f.positivAnteilPct != null ? ' · ' + t('coinAnsicht.fundingPositiv', { n: zahl(f.positivAnteilPct, 0), zahlungen: f.zahlungen }) : '') }}</p>
            </template>
            <p v-else class="ca-klein ca-fuss">{{ t('coinAnsicht.fundingOhneVerlauf') }}</p>

            <QuelleAus v-if="lsoiAus" :aus="lsoiAus" klein class="ca-abstand" />
            <template v-else-if="o">
                <template v-if="oiDiagramm">
                    <h4 class="ca-h4">{{ t('coinAnsicht.oiVerlauf', { n: Math.round(o.stunden / 24) }) }}</h4>
                    <Diagramm :option="oiDiagramm" :hoehe="110" />
                </template>
                <p v-if="o.deutung !== 'neutral'" class="ca-klein">{{ t('oi.read_' + o.deutung) }}.</p>

                <template v-if="o.longPct != null">
                    <h4 class="ca-h4">{{ t('coinAnsicht.kontenquote') }}</h4>
                    <div class="lsBalken" role="img" :aria-label="t('coinAnsicht.kontenquoteAria', { lang: zahl(o.longPct, 1), kurz: zahl(o.shortPct, 1) })">
                        <i :style="{ width: o.longPct + '%' }"></i>
                    </div>
                    <div class="ca-lageFuss">
                        <span>{{ t('coinAnsicht.long') }} {{ anteil(o.longPct) }}</span>
                        <span>{{ t('coinAnsicht.short') }} {{ anteil(o.shortPct) }}</span>
                    </div>
                    <p class="ca-klein ca-fuss">{{ (o.longSchnittPct != null ? t('coinAnsicht.longSchnitt', { n: zahl(o.longSchnittPct, 1), tage: Math.round(o.stunden / 24) }) + ' ' : '') + t('coinAnsicht.kontenquoteHinweis') }}</p>
                </template>
            </template>
            <p v-else class="ca-klein ca-fuss">{{ t('coinAnsicht.oiNichtVerfuegbar') }}</p>
        </template>
    </Karte>
</template>

<style scoped>
.lsBalken {
    height: 10px;
    border-radius: 2px;
    background: var(--line-stark);
    overflow: hidden;
}

.lsBalken i {
    display: block;
    height: 100%;
    background: var(--accent);
}
</style>
