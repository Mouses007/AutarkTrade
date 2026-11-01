<script setup>
/**
 * Schwebende Leiste über dem Panel für die AUSGEWÄHLTE Zeichnung: Farbe,
 * Strichstärke und -art, Verlängern, Füllung, Text, Sichtbarkeit je
 * Zeiteinheit, Sperren, Alarm, Löschen. Jede Änderung geht direkt an den
 * Speicher — es gibt keinen „Übernehmen"-Knopf, wie bei TradingView.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { FARBEN, SMILEYS, stilFuer } from '../../utils/chart/zeichnungen/werkzeuge.js'
import { FORTLAUFEND_TYPEN } from '../../utils/chart/zeichnungen/geometrie.js'
import { Symbol } from '../basis'
import FibStufen from './FibStufen.vue'

const props = defineProps({
    zeichnung: { type: Object, required: true },
    interval: { type: String, required: true },
    alarmMoeglich: { type: Boolean, default: false },
    // Ist der Positionsrechner dieser Zeichnung gerade offen? (Knopf hervorgehoben)
    rechnerOffen: { type: Boolean, default: false },
})
const emit = defineEmits(['aendere', 'loesche', 'text', 'alarm', 'rechner'])
const { t } = useI18n()

const s = computed(() => stilFuer(props.zeichnung))
const typ = computed(() => props.zeichnung.typ)
const hatFarbe = computed(() => !['position', 'fib', 'fibExt', 'emoji'].includes(typ.value))
// Fibonacci: statt einer Farbe je Stufe Wert, Schalter und Farbe (`FibStufen.vue`)
const hatStufen = computed(() => ['fib', 'fibExt'].includes(typ.value))
const stufenOffen = ref(false)
const hatStrich = computed(() => !['position', 'text', 'volprofil', 'emoji'].includes(typ.value))
const hatVerlaengern = computed(() => ['trendlinie', 'rechteck', 'fib', 'fibExt', 'volprofil'].includes(typ.value))
// Volumenprofil: Zeilenzahl im Kreis 12 → 24 → 48 → 96
const ZEILEN = [12, 24, 48, 96]
function naechsteZeilen() {
    const jetzt = s.value.zeilen || 24
    stil({ zeilen: ZEILEN[(ZEILEN.indexOf(jetzt) + 1) % ZEILEN.length] })
}
// „Fortlaufend": reicht immer bis zur aktuellen Kerze — schliesst „nach rechts verlängern" (bis zum Rand) aus
const hatFortlaufend = computed(() => FORTLAUFEND_TYPEN.includes(typ.value))
const hatFuellung = computed(() => ['rechteck', 'kanal', 'ellipse'].includes(typ.value))
const hatText = computed(() => ['text', 'horizontale', 'strahlH', 'rechteck', 'trendlinie', 'kanal', 'avwap', 'volprofil', 'pfeil'].includes(typ.value))
// Smiley: Auswahl aufklappen, Grösse im Kreis 20 → 28 → 40 → 56
const smileyOffen = ref(false)
const SMILEY_GROESSEN = [20, 28, 40, 56]
function naechsteSmileyGroesse() {
    const g = s.value.groesse || 28
    stil({ groesse: SMILEY_GROESSEN[(SMILEY_GROESSEN.indexOf(g) + 1) % SMILEY_GROESSEN.length] })
}
// Anchored VWAP: Bänder im Kreis aus → ±1σ → ±1σ und ±2σ
function naechsteBaender() { stil({ baender: ((Number(s.value.baender) || 0) + 1) % 3 }) }
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

/*
 * Farbe: nur EIN Punkt in der aktuellen Farbe; ein Klick klappt die Palette darunter
 * auf, die Wahl klappt sie wieder zu. Acht Punkte nebeneinander nahmen auf dem Handy
 * die halbe Leiste ein und schoben Sperren/Löschen aus dem Bild.
 */
const paletteOffen = ref(false)
watch(() => props.zeichnung.id, () => { paletteOffen.value = false; stufenOffen.value = false; smileyOffen.value = typ.value === 'emoji' })
// Ein neu gesetztes Smiley ist ausgewählt — die Auswahl steht dann gleich offen
if (typ.value === 'emoji') smileyOffen.value = true
function waehleFarbe(f) {
    stil({ farbe: f })
    paletteOffen.value = false
}

function nurDieseZeiteinheit() {
    emit('aendere', { sichtbarAuf: nurHier.value ? null : [props.interval] })
}
</script>

<template>
    <div class="stilRahmen" @mousedown.stop @pointerdown.stop>
    <div class="stilLeiste">
        <!-- Gespiegelt (31.10.2026): Löschen links, Farbe rechts — die Leiste steht rechts vor der Preisachse -->
        <button class="k loeschen" :title="t('chart.entfernen')" @click="emit('loesche')" :aria-label="t('chart.entfernen')"><Symbol name="muell" /></button>
        <button class="k" :title="t('chart.ausblenden')" @click="emit('aendere', { versteckt: true })" :aria-label="t('chart.ausblenden')"><Symbol name="augeAus" /></button>
        <button class="k" :class="{ an: zeichnung.gesperrt }" :title="t(zeichnung.gesperrt ? 'chart.stil.entsperren' : 'chart.stil.sperren')"
            @click="emit('aendere', { gesperrt: !zeichnung.gesperrt })" :aria-label="t(zeichnung.gesperrt ? 'chart.stil.entsperren' : 'chart.stil.sperren')">
            <Symbol :name="zeichnung.gesperrt ? 'schloss' : 'schlossOffen'" /></button>
        <button v-if="alarmMoeglich" class="k" :title="t('chart.stil.alarm')" @click="emit('alarm')" :aria-label="t('chart.stil.alarm')"><Symbol name="glocke" /></button>
        <button class="k" :class="{ an: nurHier }" :title="t('chart.stil.nurHier', { tf: interval })" @click="nurDieseZeiteinheit" :aria-label="t('chart.stil.nurHier', { tf: interval })">
            {{ interval }}
        </button>
        <span class="trenn"></span>
        <button v-if="hatText" class="k" :title="t('chart.stil.text')" @click="emit('text')" :aria-label="t('chart.stil.text')"><Symbol name="text" /></button>
        <!-- Öffnet/schliesst den Rechner (am Handy der einzige Weg — ein Doppeltipp kommt dort nicht an);
             ausschalten geht im Rechner selbst, damit ein Tipp die Eingaben nicht löscht -->
        <button v-if="typ === 'position'" class="k" :class="{ an: rechnerOffen }" :title="t('chart.rechner.titel')"
            @click="emit('rechner')" :aria-label="t('chart.rechner.titel')"><Symbol name="rechner" /></button>
        <button v-if="hatStufen" class="k" :class="{ an: stufenOffen }" :title="t('chart.fibStufen.titel')"
            @click="stufenOffen = !stufenOffen" :aria-label="t('chart.fibStufen.titel')" :aria-expanded="stufenOffen"><Symbol name="prozent" /></button>
        <button v-if="typ === 'emoji'" class="k smileyKnopf" :class="{ an: smileyOffen }" :title="t('chart.stil.smiley')"
            @click="smileyOffen = !smileyOffen" :aria-label="t('chart.stil.smiley')" :aria-expanded="smileyOffen">{{ s.zeichen || '🙂' }}</button>
        <button v-if="typ === 'emoji'" class="k" :title="t('chart.stil.groesse')" @click="naechsteSmileyGroesse" :aria-label="t('chart.stil.groesse')">
            {{ s.groesse || 28 }}</button>
        <button v-if="typ === 'pfad'" class="k" :class="{ an: s.spitze !== false }" :title="t('chart.stil.spitze')"
            @click="stil({ spitze: s.spitze === false })" :aria-label="t('chart.stil.spitze')"><Symbol name="pfeilRechts" /></button>
        <button v-if="hatFuellung" class="k" :class="{ an: s.fuellung }" :title="t('chart.stil.fuellung')"
            @click="stil({ fuellung: !s.fuellung })" :aria-label="t('chart.stil.fuellung')"><Symbol name="tropfen" /></button>
        <button v-if="typ === 'volprofil'" class="k" :class="{ an: s.marken !== false }" :title="t('chart.stil.marken')"
            @click="stil({ marken: s.marken === false })" :aria-label="t('chart.stil.marken')">POC</button>
        <button v-if="typ === 'volprofil'" class="k" :title="t('chart.stil.zeilen')" @click="naechsteZeilen" :aria-label="t('chart.stil.zeilen')">
            {{ s.zeilen || 24 }}</button>
        <button v-if="typ === 'avwap'" class="k" :class="{ an: s.baender > 0 }" :title="t('chart.stil.baender')" @click="naechsteBaender" :aria-label="t('chart.stil.baender')">
            {{ s.baender > 1 ? '2σ' : s.baender > 0 ? '1σ' : 'σ' }}</button>
        <button v-if="typ === 'trendlinie'" class="k" :class="{ an: s.links }" :title="t('chart.stil.links')"
            @click="stil({ links: !s.links })" :aria-label="t('chart.stil.links')"><Symbol name="pfeilAnschlagLinks" /></button>
        <button v-if="hatFortlaufend" class="k" :class="{ an: s.fortlaufend }" :title="t(s.fortlaufend ? 'chart.stil.fortlaufendAn' : 'chart.stil.fortlaufend')"
            @click="stil({ fortlaufend: !s.fortlaufend, ...(s.fortlaufend ? {} : { rechts: false }) })" :aria-label="t('chart.stil.fortlaufend')"><Symbol name="fortlaufend" /></button>
        <button v-if="hatVerlaengern" class="k" :class="{ an: s.rechts }" :title="t('chart.stil.rechts')"
            @click="stil({ rechts: !s.rechts, ...(s.rechts ? {} : { fortlaufend: false }) })" :aria-label="t('chart.stil.rechts')"><Symbol name="pfeilAnschlagRechts" /></button>
        <button v-if="hatStrich" class="k" :title="t('chart.stil.strich.' + (s.strich || 'voll'))" @click="naechsterStrich" :aria-label="t('chart.stil.strich.' + (s.strich || 'voll'))">
            {{ s.strich === 'gestrichelt' ? '╌' : s.strich === 'gepunktet' ? '┈' : '─' }}
        </button>
        <button v-if="hatStrich" class="k" :title="t('chart.stil.breite')" @click="naechsteBreite" :aria-label="t('chart.stil.breite')">
            <span class="breite" :style="{ height: (s.breite || 1) + 'px' }"></span>
        </button>
        <span class="trenn"></span>
        <label class="deck" :title="t('chart.stil.deckkraft')">
            <input type="range" min="10" max="100" step="5" :value="deckProzent" :aria-label="t('chart.stil.deckkraft')"
                @input="setzeDeckkraft($event.target.value)" @change="setzeDeckkraft($event.target.value, true)" />
            <span>{{ deckProzent }}%</span>
        </label>
        <template v-if="hatFarbe">
            <span class="trenn"></span>
            <button class="farbe aktuell" :class="{ offen: paletteOffen }" :style="{ background: s.farbe }" :title="t('chart.stil.farbe')"
                :aria-label="t('chart.stil.farbe')" :aria-expanded="paletteOffen" @click="paletteOffen = !paletteOffen"></button>
        </template>
    </div>
    <div v-if="paletteOffen && hatFarbe" class="palette" role="listbox" :aria-label="t('chart.stil.farbe')">
        <button v-for="f in FARBEN" :key="f" class="farbe" :class="{ an: s.farbe === f }" :style="{ background: f }"
            role="option" :aria-selected="s.farbe === f" :aria-label="f" @click="waehleFarbe(f)"></button>
    </div>
    <div v-if="smileyOffen && typ === 'emoji'" class="smileys" role="listbox" :aria-label="t('chart.stil.smiley')">
        <div v-for="[gruppe, zeichen] in SMILEYS" :key="gruppe" class="smileyGruppe">
            <span class="smileyTitel">{{ t('chart.smiley.' + gruppe) }}</span>
            <button v-for="z in zeichen" :key="z" class="smiley" :class="{ an: s.zeichen === z }" role="option" :aria-selected="s.zeichen === z"
                :aria-label="z" @click="stil({ zeichen: z })">{{ z }}</button>
        </div>
    </div>
    <FibStufen v-if="stufenOffen && hatStufen" :zeichnung="zeichnung" @aendere="emit('aendere', $event)" />
    </div>
</template>

<style scoped>
.stilRahmen {
    /* Rechts oben, vor der Preisachse: links oben steht die Legende. */
    position: absolute;
    top: 6px;
    right: 70px;
    z-index: 7;
    max-width: calc(100% - 86px);
}

/* Die Palette liegt ausserhalb der Leiste: die scrollt waagrecht und schnitte sie sonst ab. */
.palette {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    display: grid;
    grid-template-columns: repeat(4, 22px);
    gap: 8px;
    padding: 8px;
    background: var(--panel);
    border: 1px solid var(--line-stark);
    border-radius: var(--radius-klein);
    box-shadow: var(--schatten);
}

.palette .farbe {
    width: 22px;
    height: 22px;
}

.farbe.aktuell {
    width: 18px;
    height: 18px;
    border-color: var(--line-stark);
}

.farbe.aktuell.offen {
    border-color: var(--text);
}

.stilLeiste {
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 4px 6px;
    background: var(--panel);
    border: 1px solid var(--line-stark);
    border-radius: var(--radius-klein);
    box-shadow: var(--schatten);
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
.smileys {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 4px;
    padding: 6px 8px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius-knopf);
}

.smileyGruppe {
    display: flex;
    align-items: center;
    gap: 2px;
}

.smileyTitel {
    width: 74px;
    font-size: 11px;
    color: var(--muted);
}

.smiley,
.smileyKnopf {
    font-size: 18px;
    line-height: 1;
    font-family: "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif;
}

.smiley {
    width: 30px;
    height: 30px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: transparent;
    cursor: pointer;
}

.smiley:hover {
    background: var(--panel-soft);
}

.smiley.an {
    border-color: var(--accent);
}
</style>
