<script setup>
/**
 * Positionsrechner der AUSGEWÄHLTEN Long/Short-Position: eine Grössenangabe
 * (max. Verlust, Positionsgrösse oder Marge), Hebel, optional Kontostand und
 * Gebühr. Gerechnet wird in `shared/tradeRechner.js`; die Zeichnung zeigt das
 * Ergebnis im Chart, hier stehen die Eingaben und eine Kurzfassung.
 *
 * Gespeichert in `stil.rechner` der Zeichnung — geändert wird beim Verlassen
 * eines Feldes bzw. mit Enter, nicht bei jedem Tastendruck (jede Änderung ist
 * ein Speichern).
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { rechnePosition, rechnerEingabe, MODI } from '../../../shared/tradeRechner.js'
import { stilFuer } from '../../utils/chart/zeichnungen/werkzeuge.js'

const props = defineProps({
    zeichnung: { type: Object, required: true },
    mmr: { type: Number, default: 0.004 },
    formatPreis: { type: Function, default: (p) => String(p) },
})
const emit = defineEmits(['aendere'])
const { t } = useI18n()

const ein = computed(() => rechnerEingabe(stilFuer(props.zeichnung).rechner || {}))
const pk = computed(() => props.zeichnung.punkte || [])
const r = computed(() => (pk.value.length >= 3
    ? rechnePosition({ einstieg: pk.value[0].p, ziel: pk.value[1].p, stop: pk.value[2].p, eingabe: ein.value, mmr: props.mmr })
    : null))

function setze(feld, wert) {
    const neu = rechnerEingabe({ ...ein.value, [feld]: wert })
    if (neu[feld] === ein.value[feld]) return
    emit('aendere', { stil: { ...(props.zeichnung.stil || {}), rechner: neu } })
}
const aus = (e) => e.target.value
const zahl = (v, st = 2) => (v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('de-CH', { maximumFractionDigits: st, minimumFractionDigits: st }))
</script>

<template>
    <div class="rechner" @mousedown.stop @pointerdown.stop @keydown.stop>
        <label class="feld">
            <select class="at-feld klein" :value="ein.modus" @change="setze('modus', aus($event))">
                <option v-for="m in MODI" :key="m" :value="m">{{ t('chart.rechner.modus.' + m) }}</option>
            </select>
            <input class="at-feld klein zahl" type="number" min="0" step="any" :value="ein.betrag"
                @change="setze('betrag', aus($event))" @keyup.enter="$event.target.blur()" />
            <small>USDT</small>
        </label>
        <label class="feld">
            <span>{{ t('chart.rechner.hebel') }}</span>
            <input class="at-feld klein kurz" type="number" min="1" max="200" step="1" :value="ein.hebel"
                @change="setze('hebel', aus($event))" @keyup.enter="$event.target.blur()" />
            <small>×</small>
        </label>
        <label class="feld" :title="t('chart.rechner.kontoTipp')">
            <span>{{ t('chart.rechner.konto') }}</span>
            <input class="at-feld klein zahl" type="number" min="0" step="any" :value="ein.konto || ''" :placeholder="t('chart.rechner.optional')"
                @change="setze('konto', aus($event) || 0)" @keyup.enter="$event.target.blur()" />
        </label>
        <label class="feld" :title="t('chart.rechner.gebuehrTipp')">
            <span>{{ t('chart.rechner.gebuehr') }}</span>
            <input class="at-feld klein kurz" type="number" min="0" max="1" step="0.01" :value="ein.gebuehrPct"
                @change="setze('gebuehrPct', aus($event))" @keyup.enter="$event.target.blur()" />
            <small>%</small>
        </label>
        <div v-if="r" class="ergebnis">
            <span>{{ t('chart.rechner.liq') }} <b :class="{ warn: r.liqVorStop }">{{ r.haltbar ? formatPreis(r.liq) : '—' }}</b>
                <small v-if="r.haltbar">({{ r.liqPct >= 0 ? '+' : '' }}{{ zahl(r.liqPct) }} %)</small></span>
            <span>{{ t('chart.rechner.menge') }} <b>{{ zahl(r.menge, r.menge >= 100 ? 0 : r.menge >= 1 ? 3 : 6) }}</b></span>
            <span>{{ t('chart.rechner.nominal') }} <b>{{ zahl(r.nominal) }}</b></span>
            <span>{{ t('chart.rechner.marge') }} <b>{{ zahl(r.marge) }}</b></span>
            <span>{{ t('chart.rechner.stop') }} <b class="rot">{{ zahl(r.verlustStop) }}</b>
                <small v-if="r.kontoRisikoPct != null">({{ zahl(r.kontoRisikoPct) }} %)</small></span>
            <span>{{ t('chart.rechner.ziel') }} <b class="gruen">{{ zahl(r.gewinnZiel) }}</b></span>
            <span v-if="r.liqVorStop" class="warn">⚠ {{ t(r.haltbar ? 'chart.rechner.liqVorStop' : 'chart.rechner.nichtHaltbar') }}</span>
            <small class="leise">{{ t('chart.rechner.mmr', { pct: zahl(mmr * 100, 2) }) }}</small>
        </div>
    </div>
</template>

<style scoped>
.rechner {
    /* Unten links über der Zeitachse — oben stehen Legende und Stil-Leiste */
    position: absolute;
    bottom: 34px;
    left: 8px;
    z-index: 6;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    padding: 6px 8px;
    max-width: min(560px, calc(100% - 86px));
    background: var(--panel);
    border: 1px solid var(--line-stark);
    border-radius: var(--radius-klein);
    box-shadow: var(--schatten);
    font-size: 12px;
}

.feld {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--muted);
}

.zahl {
    width: 84px;
}

.kurz {
    width: 64px;
}

.ergebnis {
    flex-basis: 100%;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    color: var(--muted);
}

.ergebnis b {
    color: var(--text);
    font-weight: 600;
}

.ergebnis .rot {
    color: var(--bad);
}

.ergebnis .gruen {
    color: var(--good);
}

.warn,
.ergebnis b.warn {
    color: var(--warn);
}

.leise {
    color: var(--muted);
    opacity: 0.8;
}
</style>
