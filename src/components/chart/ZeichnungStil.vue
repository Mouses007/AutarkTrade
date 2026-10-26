<script setup>
/**
 * Schwebende Leiste über dem Panel für die AUSGEWÄHLTE Zeichnung: Farbe,
 * Strichstärke und -art, Verlängern, Füllung, Text, Sichtbarkeit je
 * Zeiteinheit, Sperren, Alarm, Löschen. Jede Änderung geht direkt an den
 * Speicher — es gibt keinen „Übernehmen"-Knopf, wie bei TradingView.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { FARBEN, stilFuer } from '../../utils/chart/zeichnungen/werkzeuge.js'
import { FORTLAUFEND_TYPEN } from '../../utils/chart/zeichnungen/geometrie.js'
import { Symbol } from '../basis'
import { RECHNER_VORGABE } from '../../../shared/tradeRechner.js'

const props = defineProps({
    zeichnung: { type: Object, required: true },
    interval: { type: String, required: true },
    alarmMoeglich: { type: Boolean, default: false },
})
const emit = defineEmits(['aendere', 'loesche', 'text', 'alarm'])
const { t } = useI18n()

const s = computed(() => stilFuer(props.zeichnung))
const typ = computed(() => props.zeichnung.typ)
const hatFarbe = computed(() => !['position', 'fib'].includes(typ.value))
const hatStrich = computed(() => !['position', 'text', 'volprofil'].includes(typ.value))
const hatVerlaengern = computed(() => ['trendlinie', 'rechteck', 'fib', 'volprofil'].includes(typ.value))
// Volumenprofil: Zeilenzahl im Kreis 12 → 24 → 48 → 96
const ZEILEN = [12, 24, 48, 96]
function naechsteZeilen() {
    const jetzt = s.value.zeilen || 24
    stil({ zeilen: ZEILEN[(ZEILEN.indexOf(jetzt) + 1) % ZEILEN.length] })
}
// „Fortlaufend": reicht immer bis zur aktuellen Kerze — schliesst „nach rechts verlängern" (bis zum Rand) aus
const hatFortlaufend = computed(() => FORTLAUFEND_TYPEN.includes(typ.value))
const hatFuellung = computed(() => ['rechteck', 'kanal'].includes(typ.value))
const hatText = computed(() => ['text', 'horizontale', 'strahlH', 'rechteck', 'trendlinie', 'kanal'].includes(typ.value))
const nurHier = computed(() => Array.isArray(props.zeichnung.sichtbarAuf) && props.zeichnung.sichtbarAuf.length > 0)

function stil(patch) {
    emit('aendere', { stil: { ...(props.zeichnung.stil || {}), ...patch } })
}

/*
 * Deckkraft (10–100 %, gespeichert als Bruch `stil.deckkraft`) — für jede Zeichnung.
 * Beim Ziehen sieht man sie sofort; gespeichert wird höchstens alle 150 ms und
 * beim Loslassen, nicht bei jedem Pixel (jede Änderung ist ein Speichern).
 */
const deckProzent = ref(Math.round((s.value.deckkraft ?? 1) * 100))
watch(() => props.zeichnung.id, () => { deckProzent.value = Math.round((stilFuer(props.zeichnung).deckkraft ?? 1) * 100) })
let deckUhr = null
function setzeDeckkraft(wert, sofort = false) {
    deckProzent.value = Math.max(10, Math.min(100, Number(wert) || 100))
    clearTimeout(deckUhr)
    const speichern = () => stil({ deckkraft: deckProzent.value >= 100 ? 1 : deckProzent.value / 100 })
    if (sofort) speichern(); else deckUhr = setTimeout(speichern, 150)
}

function naechsteBreite() {
    const b = s.value.breite || 1
    stil({ breite: b >= 4 ? 1 : b + 1 })
}

function naechsterStrich() {
    const reihe = ['voll', 'gestrichelt', 'gepunktet']
    stil({ strich: reihe[(reihe.indexOf(s.value.strich || 'voll') + 1) % reihe.length] })
}

function nurDieseZeiteinheit() {
    emit('aendere', { sichtbarAuf: nurHier.value ? null : [props.interval] })
}
</script>

<template>
    <div class="stilLeiste" @mousedown.stop @pointerdown.stop>
        <template v-if="hatFarbe">
            <button v-for="f in FARBEN" :key="f" class="farbe" :class="{ an: s.farbe === f }" :style="{ background: f }"
                @click="stil({ farbe: f })"></button>
            <span class="trenn"></span>
        </template>
        <label class="deck" :title="t('chart.stil.deckkraft')">
            <input type="range" min="10" max="100" step="5" :value="deckProzent" :aria-label="t('chart.stil.deckkraft')"
                @input="setzeDeckkraft($event.target.value)" @change="setzeDeckkraft($event.target.value, true)" />
            <span>{{ deckProzent }}%</span>
        </label>
        <span class="trenn"></span>
        <button v-if="hatStrich" class="k" :title="t('chart.stil.breite')" @click="naechsteBreite" :aria-label="t('chart.stil.breite')">
            <span class="breite" :style="{ height: (s.breite || 1) + 'px' }"></span>
        </button>
        <button v-if="hatStrich" class="k" :title="t('chart.stil.strich.' + (s.strich || 'voll'))" @click="naechsterStrich" :aria-label="t('chart.stil.strich.' + (s.strich || 'voll'))">
            {{ s.strich === 'gestrichelt' ? '╌' : s.strich === 'gepunktet' ? '┈' : '─' }}
        </button>
        <button v-if="hatVerlaengern" class="k" :class="{ an: s.rechts }" :title="t('chart.stil.rechts')"
            @click="stil({ rechts: !s.rechts, ...(s.rechts ? {} : { fortlaufend: false }) })" :aria-label="t('chart.stil.rechts')"><Symbol name="pfeilAnschlagRechts" /></button>
        <button v-if="hatFortlaufend" class="k" :class="{ an: s.fortlaufend }" :title="t(s.fortlaufend ? 'chart.stil.fortlaufendAn' : 'chart.stil.fortlaufend')"
            @click="stil({ fortlaufend: !s.fortlaufend, ...(s.fortlaufend ? {} : { rechts: false }) })" :aria-label="t('chart.stil.fortlaufend')"><Symbol name="fortlaufend" /></button>
        <button v-if="typ === 'trendlinie'" class="k" :class="{ an: s.links }" :title="t('chart.stil.links')"
            @click="stil({ links: !s.links })" :aria-label="t('chart.stil.links')"><Symbol name="pfeilAnschlagLinks" /></button>
 <button v-if="typ === 'volprofil'" class="k" :title="t('chart.stil.zeilen')" @click="naechsteZeilen" :aria-label="t('chart.stil.zeilen')">
            {{ s.zeilen || 24 }}</button>
        <button v-if="typ === 'volprofil'" class="k" :class="{ an: s.marken !== false }" :title="t('chart.stil.marken')"
            @click="stil({ marken: s.marken === false })" :aria-label="t('chart.stil.marken')">POC</button>
        <button v-if="hatFuellung" class="k" :class="{ an: s.fuellung }" :title="t('chart.stil.fuellung')"
            @click="stil({ fuellung: !s.fuellung })" :aria-label="t('chart.stil.fuellung')"><Symbol name="tropfen" /></button>
        <button v-if="typ === 'position'" class="k" :class="{ an: !!s.rechner }" :title="t('chart.rechner.titel')"
            @click="stil({ rechner: s.rechner ? null : { ...RECHNER_VORGABE } })" :aria-label="t('chart.rechner.titel')"><Symbol name="rechner" /></button>
        <button v-if="hatText" class="k" :title="t('chart.stil.text')" @click="emit('text')" :aria-label="t('chart.stil.text')"><Symbol name="text" /></button>
        <span class="trenn"></span>
        <button class="k" :class="{ an: nurHier }" :title="t('chart.stil.nurHier', { tf: interval })" @click="nurDieseZeiteinheit" :aria-label="t('chart.stil.nurHier', { tf: interval })">
            {{ interval }}
        </button>
        <button v-if="alarmMoeglich" class="k" :title="t('chart.stil.alarm')" @click="emit('alarm')" :aria-label="t('chart.stil.alarm')"><Symbol name="glocke" /></button>
        <button class="k" :class="{ an: zeichnung.gesperrt }" :title="t(zeichnung.gesperrt ? 'chart.stil.entsperren' : 'chart.stil.sperren')"
            @click="emit('aendere', { gesperrt: !zeichnung.gesperrt })" :aria-label="t(zeichnung.gesperrt ? 'chart.stil.entsperren' : 'chart.stil.sperren')">
            <Symbol :name="zeichnung.gesperrt ? 'schloss' : 'schlossOffen'" /></button>
        <button class="k" :title="t('chart.ausblenden')" @click="emit('aendere', { versteckt: true })" :aria-label="t('chart.ausblenden')"><Symbol name="augeAus" /></button>
        <button class="k loeschen" :title="t('chart.entfernen')" @click="emit('loesche')" :aria-label="t('chart.entfernen')"><Symbol name="muell" /></button>
    </div>
</template>

<style scoped>
.stilLeiste {
    /* Rechts oben, vor der Preisachse: links oben steht die Legende. */
    position: absolute;
    top: 6px;
    right: 70px;
    z-index: 6;
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 4px 6px;
    background: var(--panel);
    border: 1px solid var(--line-stark);
    border-radius: var(--radius-klein);
    box-shadow: var(--schatten);
    max-width: calc(100% - 86px);
    overflow-x: auto;
}

.farbe {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 2px solid transparent;
    padding: 0;
    flex-shrink: 0;
    cursor: pointer;
}

.farbe.an {
    border-color: var(--text);
}

.k {
    min-width: 26px;
    height: 24px;
    background: transparent;
    border: none;
    color: var(--muted);
    border-radius: var(--radius-klein);
    font-size: 13px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
}

.k:hover {
    color: var(--text);
    background: var(--line);
}

.k.an {
    color: var(--accent);
    background: var(--accent-flaeche);
}

.k.loeschen:hover {
    color: var(--bad);
}

.breite {
    display: block;
    width: 16px;
    background: currentColor;
}

.deck {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    color: var(--muted);
    font-size: 11px;
}

.deck input {
    width: 64px;
    accent-color: var(--accent);
}

.deck span {
    min-width: 30px;
    text-align: right;
}

.trenn {
    width: 1px;
    height: 18px;
    background: var(--line-stark);
    margin: 0 3px;
    flex-shrink: 0;
}
</style>
