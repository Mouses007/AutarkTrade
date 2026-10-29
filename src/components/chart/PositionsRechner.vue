<script setup>
/**
 * Positionsrechner der AUSGEWÄHLTEN Long/Short-Position: eine Grössenangabe
 * (max. Verlust, Positionsgrösse oder Marge), Hebel, optional Kontostand und
 * Gebühr. Gerechnet wird in `shared/tradeRechner.js`; die Zeichnung zeigt das
 * Ergebnis im Chart, hier stehen die Eingaben und eine Kurzfassung.
 *
 * Steht unter der Stil-Leiste der Zeichnung: offen nach dem Anlegen und per Doppelklick auf
 * die Zeichnung (`ChartPanel.vue` `oeffneRechner`), zu mit × oder Esc.
 *
 * Gespeichert in `stil.rechner` der Zeichnung — geändert wird beim Verlassen
 * eines Feldes bzw. mit Enter, nicht bei jedem Tastendruck (jede Änderung ist
 * ein Speichern).
 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { rechnePosition, rechnerEingabe, MODI } from '../../../shared/tradeRechner.js'
import { stilFuer } from '../../utils/chart/zeichnungen/werkzeuge.js'
import { zahlAus } from '../../utils/zahlEingabe.js'
import { boersenKonto, ladeBoersenKonto } from '../../stores/boersenKonto.js'

const props = defineProps({
    zeichnung: { type: Object, required: true },
    mmr: { type: Number, default: 0.004 },
    formatPreis: { type: Function, default: (p) => String(p) },
})
const emit = defineEmits(['aendere', 'schliesse'])
const { t } = useI18n()

const ein = computed(() => rechnerEingabe(stilFuer(props.zeichnung).rechner || {}))
const pk = computed(() => props.zeichnung.punkte || [])

/*
 * Textfelder statt `type="number"`: ein Zahlenfeld nimmt je nach Browser-Sprache
 * kein Komma an („0,05" wurde leer und sprang auf die Vorgabe zurück), und
 * Pfeiltasten/Mausrad verstellen es nebenbei. Hier zählt Komma wie Punkt,
 * Tausender-Apostroph und Leerzeichen fallen weg. Gerechnet wird schon beim
 * Tippen (Entwurf), gespeichert beim Verlassen des Feldes oder mit Enter.
 */
const FELDER = ['betrag', 'hebel', 'konto', 'gebuehrPct']
const zuText = (v) => (v == null || v === 0 ? '' : String(v))
const entwurf = ref({})
function entwurfNeu() { entwurf.value = Object.fromEntries(FELDER.map((f) => [f, f === 'konto' ? zuText(ein.value[f]) : String(ein.value[f])])) }
entwurfNeu()
// Neue Werte von aussen (andere Position, gespeichert) — nur Felder ohne Fokus überschreiben
watch(() => [props.zeichnung.id, JSON.stringify(ein.value)], () => {
    const fokus = document.activeElement?.dataset?.feld
    const neu = Object.fromEntries(FELDER.map((f) => [f, f === 'konto' ? zuText(ein.value[f]) : String(ein.value[f])]))
    if (fokus) neu[fokus] = entwurf.value[fokus]
    entwurf.value = neu
})
const eingabeJetzt = computed(() => {
    const e = { ...ein.value }
    for (const f of FELDER) {
        const n = zahlAus(entwurf.value[f])
        if (f === 'konto' && n == null) e.konto = 0
        else if (Number.isFinite(n)) e[f] = n
    }
    return rechnerEingabe(e)
})
// Leeres Kontostand-Feld: gerechnet wird mit dem Stand der Börse, gespeichert bleibt 0
ladeBoersenKonto()
const kontoVonBoerse = computed(() => (eingabeJetzt.value.konto > 0 ? null : boersenKonto.value))
const r = computed(() => {
    if (pk.value.length < 3) return null
    const eingabe = kontoVonBoerse.value ? { ...eingabeJetzt.value, konto: kontoVonBoerse.value.wert } : eingabeJetzt.value
    return rechnePosition({ einstieg: pk.value[0].p, ziel: pk.value[1].p, stop: pk.value[2].p, eingabe, mmr: props.mmr })
})
const kontoPlatzhalter = computed(() => (boersenKonto.value ? zahl(boersenKonto.value.wert, 0) : t('chart.rechner.optional')))
const kontoTitel = computed(() => (boersenKonto.value
    ? t('chart.rechner.kontoBoerse', { boerse: boersenKonto.value.boerse.charAt(0).toUpperCase() + boersenKonto.value.boerse.slice(1) })
    : t('chart.rechner.kontoTipp')))

function speichere() {
    const neu = eingabeJetzt.value
    if (JSON.stringify(neu) === JSON.stringify(ein.value)) return
    emit('aendere', { stil: { ...(props.zeichnung.stil || {}), rechner: neu } })
}
function setzeModus(m) {
    entwurf.value = { ...entwurf.value }
    emit('aendere', { stil: { ...(props.zeichnung.stil || {}), rechner: rechnerEingabe({ ...eingabeJetzt.value, modus: m }) } })
}
/** Feld verlassen: speichern und den Text auf den gültigen Wert setzen (Unsinn → letzter Wert). */
function fertig(f) {
    speichere()
    const v = eingabeJetzt.value[f]
    entwurf.value = { ...entwurf.value, [f]: f === 'konto' ? zuText(v) : String(v) }
}
// Esc schliesst — im Erfassungsmodus, vor der Chart-Tastatur (dort hiesse Esc „Auswahl weg")
function esc(e) { if (e.key === 'Escape') { e.stopPropagation(); speichere(); emit('schliesse') } }
onMounted(() => window.addEventListener('keydown', esc, true))
onBeforeUnmount(() => window.removeEventListener('keydown', esc, true))
const zahl = (v, st = 2) => (v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('de-CH', { maximumFractionDigits: st, minimumFractionDigits: st }))
</script>

<template>
    <div class="rechner" @mousedown.stop @pointerdown.stop @keydown.stop @dblclick.stop>
        <div class="kopf">
            <b>{{ t('chart.rechner.titel') }}</b>
            <button type="button" class="zu" :title="t('common.close')" :aria-label="t('common.close')" @click="speichere(); emit('schliesse')">×</button>
        </div>
        <label class="feld">
            <select class="at-feld klein" :value="ein.modus" @change="setzeModus($event.target.value)">
                <option v-for="m in MODI" :key="m" :value="m">{{ t('chart.rechner.modus.' + m) }}</option>
            </select>
            <input v-model="entwurf.betrag" data-feld="betrag" class="at-feld klein zahl" type="text" inputmode="decimal" autocomplete="off"
                @focus="$event.target.select()" @blur="fertig('betrag')" @keyup.enter="$event.target.blur()" />
            <small>USDT</small>
        </label>
        <label class="feld">
            <span>{{ t('chart.rechner.hebel') }}</span>
            <input v-model="entwurf.hebel" data-feld="hebel" class="at-feld klein kurz" type="text" inputmode="decimal" autocomplete="off"
                @focus="$event.target.select()" @blur="fertig('hebel')" @keyup.enter="$event.target.blur()" />
            <small>×</small>
        </label>
        <label class="feld" :title="kontoTitel">
            <span>{{ t('chart.rechner.konto') }}</span>
            <input v-model="entwurf.konto" data-feld="konto" class="at-feld klein zahl" type="text" inputmode="decimal" autocomplete="off" :placeholder="kontoPlatzhalter"
                @focus="$event.target.select()" @blur="fertig('konto')" @keyup.enter="$event.target.blur()" />
        </label>
        <label class="feld" :title="t('chart.rechner.gebuehrTipp')">
            <span>{{ t('chart.rechner.gebuehr') }}</span>
            <input v-model="entwurf.gebuehrPct" data-feld="gebuehrPct" class="at-feld klein kurz" type="text" inputmode="decimal" autocomplete="off"
                @focus="$event.target.select()" @blur="fertig('gebuehrPct')" @keyup.enter="$event.target.blur()" />
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
    /* Unter der Stil-Leiste der Zeichnung (oben rechts vor der Preisachse), gleiche Machart */
    position: absolute;
    top: 42px;
    right: 70px;
    z-index: 6;
    width: 330px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    padding: 6px 8px;
    /* rechts stehen 70 px Preisachse frei, links 8 px Rand — sonst ragte es auf dem Handy links hinaus */
    max-width: calc(100% - 78px);
    background: var(--panel);
    border: 1px solid var(--line-stark);
    border-radius: var(--radius-klein);
    box-shadow: var(--schatten);
    font-size: 12px;
}

.kopf {
    flex-basis: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    color: var(--text);
}

.zu {
    background: transparent;
    border: none;
    color: var(--muted);
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
}

.zu:hover {
    color: var(--text);
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
