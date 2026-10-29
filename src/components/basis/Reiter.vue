<script setup>
/**
 * Reiter (Tabs) mit Unterstrich in Akzentfarbe, wie die Kopfnavigation.
 * `v-model` ist die id des aktiven Reiters.
 *
 *   <Reiter v-model="ansicht" :reiter="[{ id: 'liste', titel: 'Liste' }, { id: 'karte', titel: 'Karte', symbol: 'chart' }]" />
 *
 * Passt die Leiste nicht in die Breite (Telefon), rollt sie waagrecht: der
 * aktive Reiter wird ins Bild gerollt, und ein weicher Rand zeigt, dass links
 * oder rechts noch Reiter liegen.
 */
import { ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import Symbol from './Symbol.vue'

const props = defineProps({
    modelValue: { type: [String, Number], default: '' },
    reiter: { type: Array, required: true }, // [{ id, titel, symbol?, zahl?, aus? }]
})
const emit = defineEmits(['update:modelValue'])

function waehle(r) {
    if (r.aus) return
    emit('update:modelValue', r.id)
}

const leiste = ref(null)
const mehrLinks = ref(false)
const mehrRechts = ref(false)

function pruefeRand() {
    const el = leiste.value
    if (!el) return
    mehrLinks.value = el.scrollLeft > 2
    mehrRechts.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 2
}

/* Nur waagrecht rollen — `scrollIntoView` zöge auch die Seite mit. */
function aktivInSicht(weich = true) {
    const el = leiste.value
    const aktiv = el?.querySelector('button.aktiv')
    if (!el || !aktiv || el.scrollWidth <= el.clientWidth) return pruefeRand()
    const a = aktiv.getBoundingClientRect()
    const l = el.getBoundingClientRect()
    const ziel = el.scrollLeft + (a.left - l.left) - (l.width - a.width) / 2
    el.scrollTo({ left: Math.max(0, ziel), behavior: weich ? 'smooth' : 'auto' })
}

let beobachter = null
onMounted(() => {
    nextTick(() => aktivInSicht(false))
    if (typeof ResizeObserver !== 'undefined' && leiste.value) {
        beobachter = new ResizeObserver(() => pruefeRand())
        beobachter.observe(leiste.value)
    }
})
onBeforeUnmount(() => beobachter?.disconnect())
watch(() => props.modelValue, () => nextTick(() => aktivInSicht()))

/** Pfeiltasten wandern zwischen den Reitern (WAI-ARIA tabs). */
function taste(e, i) {
    const n = props.reiter.length
    let j = null
    if (e.key === 'ArrowRight') j = (i + 1) % n
    else if (e.key === 'ArrowLeft') j = (i - 1 + n) % n
    if (j === null) return
    e.preventDefault()
    waehle(props.reiter[j])
    e.currentTarget.parentElement?.children[j]?.focus()
}
</script>

<template>
    <div ref="leiste" :class="['at-reiter', { 'mehr-links': mehrLinks, 'mehr-rechts': mehrRechts }]" role="tablist"
        @scroll.passive="pruefeRand">
        <button v-for="(r, i) in reiter" :key="r.id" type="button" role="tab"
            :aria-selected="modelValue === r.id" :tabindex="modelValue === r.id ? 0 : -1"
            :disabled="r.aus" :class="{ aktiv: modelValue === r.id }"
            @click="waehle(r)" @keydown="taste($event, i)">
            <Symbol v-if="r.symbol" :name="r.symbol" />
            <span>{{ r.titel }}</span>
            <span v-if="r.zahl != null" class="zahl">{{ r.zahl }}</span>
        </button>
    </div>
</template>

<style scoped>
.at-reiter {
    display: flex;
    gap: 1.2rem;
    border-bottom: 1px solid var(--line);
    overflow-x: auto;
    scrollbar-width: none;
}

/* Weicher Rand, wo noch Reiter ausserhalb des Bildes liegen */
.at-reiter.mehr-rechts {
    -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 2.5rem), transparent);
    mask-image: linear-gradient(to right, #000 calc(100% - 2.5rem), transparent);
}
.at-reiter.mehr-links {
    -webkit-mask-image: linear-gradient(to left, #000 calc(100% - 2.5rem), transparent);
    mask-image: linear-gradient(to left, #000 calc(100% - 2.5rem), transparent);
}
.at-reiter.mehr-links.mehr-rechts {
    -webkit-mask-image: linear-gradient(to right, transparent, #000 2.5rem, #000 calc(100% - 2.5rem), transparent);
    mask-image: linear-gradient(to right, transparent, #000 2.5rem, #000 calc(100% - 2.5rem), transparent);
}

button {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.55rem 0.1rem;
    margin-bottom: -1px;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--muted);
    font: inherit;
    font-size: 0.92rem;
    white-space: nowrap;
    cursor: pointer;
}

button:hover {
    color: var(--text);
}

button.aktiv {
    color: var(--text);
    border-bottom-color: var(--accent);
}

button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}

.zahl {
    font-size: 0.72rem;
    padding: 0 0.4rem;
    border-radius: var(--radius-pille);
    background: var(--accent-flaeche);
    color: var(--accent);
}
</style>
