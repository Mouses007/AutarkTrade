<script setup>
/**
 * Pille: kurze Marke (Status, Kategorie, Filter). Rund, auf getöntem Grund.
 *
 *   <Pille>Beta</Pille>
 *   <Pille ton="gut">+3,2 %</Pille>
 *   <Pille ton="warn" symbol="test">Testbetrieb</Pille>
 */
import Symbol from './Symbol.vue'

defineProps({
    ton: { type: String, default: 'akzent' }, // akzent | neutral | gut | schlecht | warn
    symbol: { type: String, default: '' },
    gross: { type: Boolean, default: false },
})
</script>

<template>
    <span :class="['at-pille', ton, { gross }]">
        <Symbol v-if="symbol" :name="symbol" />
        <slot />
    </span>
</template>

<style scoped>
.at-pille {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.18rem 0.6rem;
    border-radius: var(--radius-pille);
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    line-height: 1.4;
    white-space: nowrap;
    background: var(--accent-flaeche);
    color: var(--accent);
    border: 1px solid var(--accent-rand);
}

.at-pille.gross {
    font-size: 0.82rem;
    padding: 0.3rem 0.8rem;
}

.at-pille.neutral {
    background: var(--panel-soft);
    color: var(--muted);
    border-color: var(--line);
}

.at-pille.gut {
    background: var(--good-flaeche);
    color: var(--good);
    border-color: color-mix(in srgb, var(--good) 35%, transparent);
}

.at-pille.schlecht {
    background: var(--bad-flaeche);
    color: var(--bad);
    border-color: color-mix(in srgb, var(--bad) 35%, transparent);
}

.at-pille.warn {
    background: var(--warn-flaeche);
    color: var(--warn);
    border-color: color-mix(in srgb, var(--warn) 35%, transparent);
}
</style>
