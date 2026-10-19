<script setup>
/**
 * Ladekreisel: ein drehender Ring in Akzentfarbe (oder `currentColor` mit
 * `still`). Ersetzt Bootstraps `spinner-border`.
 *
 *   <Kreisel />                 1em, türkis
 *   <Kreisel :groesse="28" />   grösser, z. B. mitten in einer leeren Fläche
 *   <Kreisel still />           erbt die Schriftfarbe (im Knopf, in Text)
 */
import { computed } from 'vue'

const props = defineProps({
    groesse: { type: [Number, String], default: '1em' },
    still: { type: Boolean, default: false },
    titel: { type: String, default: '' },
})
const masse = computed(() => (typeof props.groesse === 'number' ? `${props.groesse}px` : props.groesse))
</script>

<template>
    <span :class="['at-kreisel', { still }]" :style="{ width: masse, height: masse }"
        role="status" :aria-label="titel || 'Lädt'"></span>
</template>

<style scoped>
.at-kreisel {
    display: inline-block;
    flex: 0 0 auto;
    vertical-align: -0.15em;
    border-radius: 50%;
    border: 2px solid var(--accent);
    border-right-color: transparent;
    animation: at-kreisel-dreh 0.8s linear infinite;
}

.at-kreisel.still {
    border-color: currentColor;
    border-right-color: transparent;
}

@keyframes at-kreisel-dreh {
    to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
    .at-kreisel { animation-duration: 2.4s; }
}
</style>
