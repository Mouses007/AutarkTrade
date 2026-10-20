<script setup>
/**
 * Editor der Bildmarkierung (ersetzt markerjs2).
 *
 * Eine SVG-Ebene liegt deckungsgleich über dem Bild in einem `basis/Dialog`.
 * Die SVG rechnet in natürlichen Bildpixeln (`viewBox` = Bildgrösse) — so
 * zeichnet sie dieselben Formen (`formen()` aus `utils/bildmarkierung.js`),
 * die beim Speichern ins Canvas eingebrannt werden. Was man sieht, ist was
 * gespeichert wird.
 *
 * Geöffnet wird er über `oeffneMarkierung(bildDaten)` aus
 * `utils/bilder/bearbeiten.js`; dieser Baustein hört nur auf `markierAuftrag`.
 * Eingehängt ist er einmal global (im Rahmen, neben dem Vollbild), damit jede Ansicht
 * markieren kann, ohne ihn selbst einzubinden.
 *
 * Maus, Stift und Finger laufen über Pointer-Events mit Pointer-Capture;
 * `touch-action: none` verhindert, dass der Finger beim Zeichnen die Seite schiebt.
 */
import { ref, shallowRef, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import Dialog from '../basis/Dialog.vue'
import Knopf from '../basis/Knopf.vue'
import Hinweis from '../basis/Hinweis.vue'
import Symbol from '../basis/Symbol.vue'
import { markierAuftrag } from '../../stores/journal/bilder.js'
import { uebernimmMarkierung, verwirfMarkierung } from '../../utils/bilder/bearbeiten.js'
import {
    Verlauf, formen, grenzen, obersterTreffer, verschoben, umgestylt, zuKlein, istBearbeitbar, neueId, klon,
    FARBEN, STRICHBREITEN, VORGABE_FARBE, VORGABE_STRICH, ZEILENHOEHE,
} from '../../utils/bildmarkierung.js'

const { t } = useI18n()

const WERKZEUGLEISTE = [
    { id: 'auswahl', symbol: 'mkAuswahl' },
    { id: 'pfeil', symbol: 'mkPfeil' },
    { id: 'rechteck', symbol: 'quadrat' },
    { id: 'linie', symbol: 'mkLinie' },
    { id: 'text', symbol: 'text' },
    { id: 'freihand', symbol: 'mkFreihand' },
]
/** Trefferabstand in ANZEIGE-Pixeln (Finger brauchen mehr als die Maus). */
const TREFFER_PX = 8

const offen = computed(() => !!markierAuftrag.value)
const bildUrl = computed(() => markierAuftrag.value?.bild || '')

const svgEl = ref(null)
const textEl = ref(null)
const natB = ref(0)
const natH = ref(0)

let verlauf = new Verlauf()
const zustand = shallowRef(verlauf.jetzt)
const stand = ref(0) // zählt Verlaufsschritte, damit die Knöpfe neu rechnen
const werkzeug = ref('pfeil')
const farbe = ref(VORGABE_FARBE)
const strichPx = ref(VORGABE_STRICH)
const auswahlId = ref(null)
const entwurf = shallowRef(null)
const textEingabe = ref(null) // { x, y, text, id? } — x/y relativ
const speichert = ref(false)
const fehler = ref('')
let ziehen = null

const kannZurueck = computed(() => (stand.value, verlauf.kannZurueck))
const kannVor = computed(() => (stand.value, verlauf.kannVor))
const auswahl = computed(() => zustand.value.marker.find(m => m.id === auswahlId.value) || null)

watch(markierAuftrag, (a) => {
    if (!a) return
    verlauf = new Verlauf(a.zustand)
    zustand.value = verlauf.jetzt
    stand.value++
    auswahlId.value = null
    entwurf.value = null
    textEingabe.value = null
    werkzeug.value = 'pfeil'
    fehler.value = ''
    natB.value = 0
    natH.value = 0
})

function bildGeladen(e) {
    natB.value = e.target.naturalWidth
    natH.value = e.target.naturalHeight
}

// ── Verlauf ──

function uebernimm(neu) {
    zustand.value = verlauf.setze(neu)
    stand.value++
}
function zurueck() {
    zustand.value = verlauf.zurueck()
    stand.value++
    if (!auswahl.value) auswahlId.value = null
}
function vor() {
    zustand.value = verlauf.vor()
    stand.value++
}
function loescheAuswahl() {
    if (!auswahlId.value) return
    uebernimm({ ...zustand.value, marker: zustand.value.marker.filter(m => m.id !== auswahlId.value) })
    auswahlId.value = null
}

// ── Koordinaten ──

function anzeige() {
    const r = svgEl.value?.getBoundingClientRect()
    return r && r.width > 0 ? r : { left: 0, top: 0, width: natB.value || 1, height: natH.value || 1 }
}
function relPunkt(e) {
    const r = anzeige()
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]
}
/** Strichbreite relativ zur Bildbreite — so dick, wie sie gerade aussieht. */
const relBreite = () => strichPx.value / anzeige().width
/** Schriftgrösse wächst mit der Strichstufe; relativ zur Bildhöhe. */
const relSchrift = () => (12 + strichPx.value * 3) / anzeige().height

// ── Zeichnen mit Zeiger ──

function runter(e) {
    if (!natB.value || speichert.value) return
    if (textEingabe.value) { textFertig(); return }
    const p = relPunkt(e)
    if (werkzeug.value === 'text') {
        e.preventDefault()
        oeffneText({ x: p[0], y: p[1], text: '' })
        return
    }
    svgEl.value?.setPointerCapture?.(e.pointerId)
    if (werkzeug.value === 'auswahl') {
        const tol = TREFFER_PX * natB.value / anzeige().width
        const m = obersterTreffer(zustand.value, p[0] * natB.value, p[1] * natH.value, natB.value, natH.value, tol)
        auswahlId.value = m?.id ?? null
        ziehen = m ? { art: 'verschieben', start: p, original: klon(m), bewegt: false } : null
        return
    }
    const stil = { farbe: farbe.value, breite: relBreite() }
    const id = neueId()
    if (werkzeug.value === 'linie' || werkzeug.value === 'pfeil') {
        entwurf.value = { id, typ: werkzeug.value, x1: p[0], y1: p[1], x2: p[0], y2: p[1], ...stil, ...(werkzeug.value === 'pfeil' ? { spitze: 'ende' } : {}) }
    } else if (werkzeug.value === 'rechteck') {
        entwurf.value = { id, typ: 'rechteck', x: p[0], y: p[1], b: 0, h: 0, ...stil }
    } else if (werkzeug.value === 'freihand') {
        entwurf.value = { id, typ: 'freihand', punkte: [p], ...stil }
    }
    ziehen = { art: 'zeichnen', start: p }
}

function bewegen(e) {
    if (!ziehen) return
    const p = relPunkt(e)
    if (ziehen.art === 'verschieben') {
        const dx = p[0] - ziehen.start[0], dy = p[1] - ziehen.start[1]
        if (!dx && !dy) return
        ziehen.bewegt = true
        const neu = verschoben(ziehen.original, dx, dy)
        zustand.value = { ...zustand.value, marker: zustand.value.marker.map(m => (m.id === neu.id ? neu : m)) }
        return
    }
    const m = entwurf.value
    if (!m) return
    if (m.typ === 'linie' || m.typ === 'pfeil') {
        entwurf.value = { ...m, x2: p[0], y2: p[1] }
    } else if (m.typ === 'rechteck') {
        const [sx, sy] = ziehen.start
        entwurf.value = { ...m, x: Math.min(sx, p[0]), y: Math.min(sy, p[1]), b: Math.abs(p[0] - sx), h: Math.abs(p[1] - sy) }
    } else if (m.typ === 'freihand') {
        // Punkte erst ab einem Mindestabstand — sonst wird der Zustand bei
        // einem zitternden Finger unnötig gross.
        const letzter = m.punkte[m.punkte.length - 1]
        if (Math.hypot((p[0] - letzter[0]) * natB.value, (p[1] - letzter[1]) * natH.value) * anzeige().width / natB.value < 2) return
        entwurf.value = { ...m, punkte: [...m.punkte, p] }
    }
}

function hoch() {
    const z = ziehen
    ziehen = null
    if (!z) return
    if (z.art === 'verschieben') {
        if (z.bewegt) uebernimm(zustand.value)
        return
    }
    const m = entwurf.value
    entwurf.value = null
    if (!m || zuKlein(m, anzeige().width, anzeige().height)) return
    uebernimm({ ...zustand.value, marker: [...zustand.value.marker, m] })
}

function doppelklick(e) {
    if (werkzeug.value !== 'auswahl') return
    const p = relPunkt(e)
    const tol = TREFFER_PX * natB.value / anzeige().width
    const m = obersterTreffer(zustand.value, p[0] * natB.value, p[1] * natH.value, natB.value, natH.value, tol)
    if (m?.typ === 'text') oeffneText({ x: m.x, y: m.y, text: m.text, id: m.id, groesse: m.groesse, farbe: m.farbe })
}

// ── Text ──

async function oeffneText(eingabe) {
    textEingabe.value = { groesse: relSchrift(), farbe: farbe.value, ...eingabe }
    await nextTick()
    textEl.value?.focus()
}

function textFertig() {
    const e = textEingabe.value
    if (!e) return
    textEingabe.value = null
    const text = String(e.text || '').replace(/\s+$/, '')
    if (e.id) {
        const marker = text.trim()
            ? zustand.value.marker.map(m => (m.id === e.id ? { ...m, text } : m))
            : zustand.value.marker.filter(m => m.id !== e.id)
        uebernimm({ ...zustand.value, marker })
        return
    }
    if (!text.trim()) return
    const neu = { id: neueId(), typ: 'text', x: e.x, y: e.y, text, farbe: e.farbe, groesse: e.groesse }
    uebernimm({ ...zustand.value, marker: [...zustand.value.marker, neu] })
    auswahlId.value = neu.id
}

function textTaste(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); textFertig() }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); textEingabe.value = null }
}

const textStil = computed(() => {
    const e = textEingabe.value
    if (!e) return {}
    const px = e.groesse * anzeige().height
    return {
        left: `${e.x * 100}%`, top: `${e.y * 100}%`, color: e.farbe,
        fontSize: `${px}px`, lineHeight: String(ZEILENHOEHE),
    }
})

// ── Stil ──

function waehleWerkzeug(id) {
    if (textEingabe.value) textFertig()
    werkzeug.value = id
    // Mit einem Zeichenwerkzeug soll eine Farbwahl nicht den alten Marker umfärben.
    if (id !== 'auswahl') auswahlId.value = null
}

function waehleFarbe(f) {
    farbe.value = f
    const m = auswahl.value
    if (m && istBearbeitbar(m)) uebernimm({ ...zustand.value, marker: zustand.value.marker.map(x => (x.id === m.id ? umgestylt(x, { farbe: f }) : x)) })
}
function waehleStrich(px) {
    strichPx.value = Number(px)
    const m = auswahl.value
    if (m && istBearbeitbar(m) && m.typ !== 'text') {
        uebernimm({ ...zustand.value, marker: zustand.value.marker.map(x => (x.id === m.id ? umgestylt(x, { breite: relBreite() }) : x)) })
    }
}

// ── Anzeige ──

const anzeigeFormen = computed(() => {
    if (!natB.value) return []
    const verborgen = textEingabe.value?.id
    const liste = entwurf.value ? [...zustand.value.marker, entwurf.value] : zustand.value.marker
    return liste.filter(m => m.id !== verborgen).flatMap(m => formen(m, natB.value, natH.value).map((f, i) => ({ ...f, key: `${m.id}-${i}` })))
})

const auswahlRahmen = computed(() => {
    const m = auswahl.value
    if (!m || !natB.value) return null
    const g = grenzen(m, natB.value, natH.value)
    const rand = 6 * natB.value / anzeige().width
    return { x: g.x - rand, y: g.y - rand, b: g.b + 2 * rand, h: g.h + 2 * rand }
})

const drehung = (f) => (f.drehung ? `rotate(${f.drehung.winkel} ${f.drehung.cx} ${f.drehung.cy})` : undefined)
const punkteText = (p) => p.map(([x, y]) => `${x},${y}`).join(' ')
const muster = (f) => (f.muster ? f.muster.join(' ') : undefined)

// ── Speichern / Verwerfen ──

async function speichern() {
    if (textEingabe.value) textFertig()
    speichert.value = true
    fehler.value = ''
    try {
        await uebernimmMarkierung(zustand.value)
    } catch (e) {
        console.error('Markierung speichern fehlgeschlagen:', e)
        fehler.value = t('screenshots.markierung.fehlerSpeichern')
    } finally {
        speichert.value = false
    }
}

function verwerfenFragen() {
    if (!markierAuftrag.value || speichert.value) return
    if ((stand.value, verlauf.geaendert) && !confirm(t('screenshots.markierung.verwerfenFrage'))) return
    verwirfMarkierung()
}

/** Dialog-× und Esc: beide gehen hier durch, damit nichts ohne Rückfrage verloren geht. */
function dialogZu(wert) {
    if (!wert) verwerfenFragen()
}
function beiEsc(e) {
    e.preventDefault()
    if (textEingabe.value) { textEingabe.value = null; return }
    verwerfenFragen()
}

// ── Tastatur ──

function taste(e) {
    if (!offen.value) return
    const ziel = e.target
    if (ziel && (ziel.tagName === 'TEXTAREA' || ziel.tagName === 'INPUT' || ziel.tagName === 'SELECT')) return
    const strg = e.ctrlKey || e.metaKey
    if (strg && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); zurueck() }
    else if (strg && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); vor() }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && auswahlId.value) { e.preventDefault(); loescheAuswahl() }
}
watch(offen, (an) => {
    if (an) window.addEventListener('keydown', taste)
    else window.removeEventListener('keydown', taste)
})
onBeforeUnmount(() => window.removeEventListener('keydown', taste))
</script>

<template>
    <Dialog :model-value="offen" :titel="t('screenshots.markierung.titel')" breite="80rem" :aussen-schliesst="false"
        @update:model-value="dialogZu" @cancel="beiEsc">
        <div class="werkzeuge" role="toolbar" :aria-label="t('screenshots.markierung.werkzeuge')">
            <div class="gruppe">
                <button v-for="w in WERKZEUGLEISTE" :key="w.id" type="button" class="wk" :class="{ an: werkzeug === w.id }"
                    :aria-pressed="werkzeug === w.id" :title="t('screenshots.markierung.wz_' + w.id)" :aria-label="t('screenshots.markierung.wz_' + w.id)"
                    @click="waehleWerkzeug(w.id)">
                    <Symbol :name="w.symbol" :groesse="18" />
                </button>
            </div>
            <div class="gruppe farben" :aria-label="t('screenshots.markierung.farbe')">
                <button v-for="f in FARBEN" :key="f" type="button" class="farbe" :class="{ an: farbe === f }"
                    :style="{ '--feld': f }" :aria-pressed="farbe === f" :title="f" :aria-label="t('screenshots.markierung.farbe') + ' ' + f"
                    @click="waehleFarbe(f)"></button>
            </div>
            <label class="gruppe strich">
                <span class="at-klein at-gedaempft">{{ t('screenshots.markierung.strich') }}</span>
                <select class="at-feld klein" :value="strichPx" @change="waehleStrich($event.target.value)">
                    <option v-for="s in STRICHBREITEN" :key="s" :value="s">{{ s }} px</option>
                </select>
            </label>
            <div class="gruppe">
                <button type="button" class="wk" :disabled="!kannZurueck" :title="t('screenshots.markierung.zurueck')"
                    :aria-label="t('screenshots.markierung.zurueck')" @click="zurueck"><Symbol name="mkRueckgaengig" :groesse="18" /></button>
                <button type="button" class="wk" :disabled="!kannVor" :title="t('screenshots.markierung.vor')"
                    :aria-label="t('screenshots.markierung.vor')" @click="vor"><Symbol name="mkWiederholen" :groesse="18" /></button>
                <button type="button" class="wk" :disabled="!auswahlId" :title="t('screenshots.markierung.loeschen')"
                    :aria-label="t('screenshots.markierung.loeschen')" @click="loescheAuswahl"><Symbol name="papierkorb" :groesse="18" /></button>
            </div>
        </div>

        <p v-if="auswahl && !istBearbeitbar(auswahl) && auswahl.typ !== 'bild'" class="at-klein at-gedaempft hinweiszeile">
            {{ t('screenshots.markierung.altmarker') }}
        </p>

        <div class="buehne-huelle">
            <div class="buehne">
                <img v-if="bildUrl" :src="bildUrl" alt="" class="bild" draggable="false" @load="bildGeladen" />
                <svg v-if="natB" ref="svgEl" class="ebene" :class="'wz-' + werkzeug" :viewBox="`0 0 ${natB} ${natH}`" preserveAspectRatio="none"
                    @pointerdown="runter" @pointermove="bewegen" @pointerup="hoch" @pointercancel="hoch" @dblclick="doppelklick">
                    <g v-for="f in anzeigeFormen" :key="f.key" :transform="drehung(f)" :opacity="f.deckkraft ?? 1">
                        <line v-if="f.art === 'linie'" :x1="f.x1" :y1="f.y1" :x2="f.x2" :y2="f.y2" :stroke="f.strich"
                            :stroke-width="f.breite" :stroke-dasharray="muster(f)" stroke-linecap="round" />
                        <path v-else-if="f.art === 'kurve'" :d="`M${f.x1} ${f.y1} Q${f.kx} ${f.ky} ${f.x2} ${f.y2}`" fill="none"
                            :stroke="f.strich" :stroke-width="f.breite" :stroke-dasharray="muster(f)" stroke-linecap="round" />
                        <polyline v-else-if="f.art === 'polylinie'" :points="punkteText(f.punkte)" fill="none" :stroke="f.strich"
                            :stroke-width="f.breite" stroke-linecap="round" stroke-linejoin="round" />
                        <polygon v-else-if="f.art === 'polygon'" :points="punkteText(f.punkte)" :fill="f.fuellung || 'none'"
                            :stroke="f.strich || 'none'" :stroke-width="f.breite || 0" />
                        <rect v-else-if="f.art === 'rechteck'" :x="f.x" :y="f.y" :width="Math.max(0, f.b)" :height="Math.max(0, f.h)"
                            :rx="f.radius || 0" :fill="f.fuellung || 'none'" :stroke="f.strich || 'none'" :stroke-width="f.strich ? f.breite : 0"
                            :stroke-dasharray="muster(f)" stroke-linejoin="round" />
                        <ellipse v-else-if="f.art === 'ellipse'" :cx="f.cx" :cy="f.cy" :rx="f.rx" :ry="f.ry" :fill="f.fuellung || 'none'"
                            :stroke="f.strich || 'none'" :stroke-width="f.strich ? f.breite : 0" :stroke-dasharray="muster(f)" />
                        <text v-else-if="f.art === 'text'" :fill="f.farbe" :font-size="f.groesse" :font-family="f.schrift"
                            dominant-baseline="text-before-edge" class="svgtext">
                            <tspan v-for="(z, i) in f.zeilen" :key="i" :x="f.x" :y="f.y + i * f.groesse * ZEILENHOEHE">{{ z }}</tspan>
                        </text>
                        <image v-else-if="f.art === 'bild'" :href="f.url" :x="f.x" :y="f.y" :width="f.b" :height="f.h" preserveAspectRatio="none" />
                    </g>
                    <rect v-if="auswahlRahmen" class="auswahl" :x="auswahlRahmen.x" :y="auswahlRahmen.y" :width="auswahlRahmen.b"
                        :height="auswahlRahmen.h" fill="none" vector-effect="non-scaling-stroke" />
                </svg>
                <textarea v-if="textEingabe" ref="textEl" v-model="textEingabe.text" class="texteingabe" :style="textStil" rows="1"
                    :aria-label="t('screenshots.markierung.wz_text')" :placeholder="t('screenshots.markierung.textPlatzhalter')"
                    @keydown="textTaste" @blur="textFertig"></textarea>
            </div>
        </div>

        <Hinweis v-if="fehler" art="fehler" class="at-mo-2">{{ fehler }}</Hinweis>

        <template #fuss>
            <span class="at-klein at-gedaempft tipp">{{ t('screenshots.markierung.tipp') }}</span>
            <Knopf art="leise" :disabled="speichert" @click="verwerfenFragen">{{ t('screenshots.markierung.verwerfen') }}</Knopf>
            <Knopf art="haupt" symbol="speichern" :laedt="speichert" :disabled="!natB" @click="speichern">{{ t('screenshots.markierung.speichern') }}</Knopf>
        </template>
    </Dialog>
</template>

<style scoped>
.werkzeuge {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-2) var(--abstand-4);
    margin-bottom: var(--abstand-3);
}

.gruppe {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-1);
}

.wk {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border: 1px solid var(--line);
    border-radius: var(--radius-knopf);
    background: var(--panel-soft);
    color: var(--muted);
    cursor: pointer;
}

.wk:hover:not(:disabled) {
    color: var(--text);
    border-color: var(--line-stark);
}

.wk.an {
    color: var(--accent);
    border-color: var(--accent-rand);
    background: var(--accent-flaeche);
}

.wk:disabled {
    opacity: 0.4;
    cursor: default;
}

.farbe {
    width: 26px;
    height: 26px;
    padding: 0;
    border: 2px solid var(--line-stark);
    border-radius: var(--radius-pille);
    background: var(--feld);
    cursor: pointer;
}

.farbe.an {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-rand);
}

.strich {
    gap: var(--abstand-2);
}

.hinweiszeile {
    margin: 0 0 var(--abstand-2);
}

.buehne-huelle {
    display: flex;
    justify-content: center;
    background: var(--bg);
    border-radius: var(--radius-klein);
}

.buehne {
    position: relative;
    display: inline-block;
    max-width: 100%;
    line-height: 0;
}

.bild {
    display: block;
    max-width: 100%;
    max-height: calc(100dvh - 17rem);
    user-select: none;
    -webkit-user-drag: none;
}

.ebene {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    touch-action: none;
    cursor: crosshair;
}

.ebene.wz-auswahl {
    cursor: default;
}

.ebene.wz-text {
    cursor: text;
}

.svgtext {
    white-space: pre;
    user-select: none;
}

.auswahl {
    stroke: var(--accent);
    stroke-width: 1.5;
    stroke-dasharray: 5 4;
    pointer-events: none;
}

.texteingabe {
    position: absolute;
    min-width: 8rem;
    max-width: 60%;
    padding: 0;
    border: 1px dashed var(--accent);
    background: color-mix(in srgb, var(--bg) 55%, transparent);
    font-family: Helvetica, Arial, sans-serif;
    resize: none;
    outline: none;
    field-sizing: content;
}

.tipp {
    margin-right: auto;
    align-self: center;
}

@media (max-width: 600px) {
    .tipp {
        display: none;
    }
}
</style>
