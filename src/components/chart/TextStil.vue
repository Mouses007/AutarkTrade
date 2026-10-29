<script setup>
/**
 * Beschriftung der AUSGEWÄHLTEN Zeichnung: Text, Grösse und Lage — unter der
 * Stil-Leiste (oben rechts), geöffnet mit dem Text-Knopf der Leiste oder per
 * Doppelklick auf die Zeichnung.
 *
 *   Rechteck      Lage in 5 × 3: über der Box / oben / Mitte / unten / unter der
 *                 Box × links / Mitte / rechts (`stil.textV`, `stil.textH`)
 *   Horizontale,  links / Mitte / rechts × über / unter der Linie
 *   hor. Strahl
 *   Trendlinie,   nur Text und Grösse (die Lage ergibt sich aus der Linie)
 *   Kanal, Text
 *
 * Der Text wird beim Tippen gezeichnet und spätestens nach 300 ms gespeichert,
 * sofort mit Enter oder beim Schliessen.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { stilFuer } from '../../utils/chart/zeichnungen/werkzeuge.js'
import { TEXT_GROESSEN, TEXT_H, TEXT_V_BOX, TEXT_V_LINIE } from '../../utils/chart/zeichnungen/geometrie.js'

const props = defineProps({
    zeichnung: { type: Object, required: true },
})
const emit = defineEmits(['aendere', 'schliesse'])
const { t } = useI18n()

const s = computed(() => stilFuer(props.zeichnung))
const typ = computed(() => props.zeichnung.typ)
const reihen = computed(() => (typ.value === 'rechteck' ? TEXT_V_BOX : ['horizontale', 'strahlH'].includes(typ.value) ? TEXT_V_LINIE : null))
const groesse = computed(() => Number(s.value.groesse) || (typ.value === 'text' ? 13 : 11))
const lageH = computed(() => s.value.textH || 'links')
const lageV = computed(() => s.value.textV || 'oben')

const entwurf = ref(s.value.text || '')
// Eine andere Zeichnung: Entwurf neu (das Panel schliesst ChartPanel bei einem Wechsel ohnehin)
watch(() => props.zeichnung.id, () => { entwurf.value = stilFuer(props.zeichnung).text || '' })

// Eigener Stand des Stils: zwei Änderungen kurz hintereinander (Text, dann Grösse) bauten
// sonst beide auf dem alten `props.zeichnung.stil` auf, und die zweite löschte die erste.
// Nur die Felder DIESES Panels werden lokal geführt; alles andere (Farbe, Deckkraft … aus der
// Stil-Leiste) kommt immer frisch aus der Zeichnung und wird nie mit einem alten Stand überschrieben.
const EIGENE = ['text', 'groesse', 'textH', 'textV', 'textPos']
const eigeneAus = (st) => Object.fromEntries(EIGENE.filter((k) => st && k in st).map((k) => [k, st[k]]))
let eigene = eigeneAus(props.zeichnung.stil)
watch(() => props.zeichnung.id, () => { eigene = eigeneAus(props.zeichnung.stil) })
const stand = { get text() { return eigene.text } }
function stil(patch) {
    eigene = { ...eigene, ...patch }
    emit('aendere', { stil: { ...(props.zeichnung.stil || {}), ...eigene } })
}
let uhr = null
function tippen() {
    clearTimeout(uhr)
    uhr = setTimeout(speichere, 300)
}
function speichere() {
    clearTimeout(uhr)
    const text = entwurf.value.slice(0, 200)
    if (text !== (stand.text || '')) stil({ text })
}
function zu() { speichere(); emit('schliesse') }
function esc(e) { if (e.key === 'Escape') { e.stopPropagation(); zu() } }
onMounted(() => window.addEventListener('keydown', esc, true))
onBeforeUnmount(() => { window.removeEventListener('keydown', esc, true); speichere() })
</script>

<template>
    <div class="textStil" @mousedown.stop @pointerdown.stop @keydown.stop @dblclick.stop>
        <div class="kopf">
            <b>{{ t('chart.stil.textTitel') }}</b>
            <button type="button" class="zu" :title="t('common.close')" :aria-label="t('common.close')" @click="zu">×</button>
        </div>
        <input v-model="entwurf" class="at-feld klein" maxlength="200" :placeholder="t('chart.stil.textPlatzhalter')" autofocus
            @input="tippen" @keyup.enter="speichere" @blur="speichere" />
        <label class="zeile">
            <span>{{ t('chart.stil.textGroesse') }}</span>
            <select class="at-feld klein" :value="groesse" @change="stil({ groesse: Number($event.target.value) })">
                <option v-for="g in TEXT_GROESSEN" :key="g" :value="g">{{ g }} px</option>
            </select>
        </label>
        <div v-if="reihen" class="zeile oben">
            <span>{{ t('chart.stil.textLage') }}</span>
            <div class="raster" role="group" :aria-label="t('chart.stil.textLage')">
                <template v-for="v in reihen" :key="v">
                    <button v-for="h in TEXT_H" :key="v + h" type="button" class="feld" :class="{ an: lageV === v && lageH === h, aussen: v === 'ueber' || v === 'unter' }"
                        :title="t('chart.stil.textV.' + v) + ' · ' + t('chart.stil.textH.' + h)" :aria-label="t('chart.stil.textV.' + v) + ' · ' + t('chart.stil.textH.' + h)"
                        @click="stil({ textV: v, textH: h, textPos: null })"></button>
                </template>
            </div>
        </div>
    </div>
</template>

<style scoped>
.textStil {
    /* Unter der Stil-Leiste der Zeichnung, gleiche Machart wie der Positionsrechner */
    position: absolute;
    top: 42px;
    right: 70px;
    z-index: 6;
    width: 240px;
    /* rechts stehen 70 px Preisachse frei, links 8 px Rand — sonst ragte es auf dem Handy links hinaus */
    max-width: calc(100% - 78px);
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px 8px;
    background: var(--panel);
    border: 1px solid var(--line-stark);
    border-radius: var(--radius-klein);
    box-shadow: var(--schatten);
    font-size: 12px;
}

.kopf {
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.zu {
    background: transparent;
    border: none;
    color: var(--muted);
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
}

.zeile {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    color: var(--muted);
}

.zeile.oben {
    align-items: flex-start;
}

.raster {
    display: grid;
    grid-template-columns: repeat(3, 22px);
    gap: 3px;
}

.feld {
    width: 22px;
    height: 14px;
    padding: 0;
    border: 1px solid var(--line-stark);
    border-radius: 3px;
    background: var(--panel-soft);
    cursor: pointer;
}

/* Ausserhalb der Box (über/unter): gestrichelt */
.feld.aussen {
    border-style: dashed;
    background: transparent;
}

.feld.an {
    background: var(--accent);
    border-color: var(--accent);
}
</style>
