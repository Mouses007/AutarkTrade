<script setup>
/**
 * Stufenwahl 1–10 (Stress, Emotion): zehn Punkte mit Zahl darüber, kleinere
 * Zwischenpunkte dazwischen. Klick auf N setzt N, Klick auf den aktuellen Wert
 * setzt 0 (= nicht gesetzt).
 */
defineProps({
    modelValue: { type: Number, default: 0 },
    titel: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue'])
const STUFEN = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
</script>

<template>
    <div class="stufen" role="radiogroup" :aria-label="titel">
        <template v-for="n in STUFEN" :key="n">
            <span v-if="n > 1" :class="['zwischen', { aktiv: n <= modelValue }]" aria-hidden="true"></span>
            <button type="button" :class="['stufe', { aktiv: n <= modelValue }]" role="radio" :aria-checked="n === modelValue"
                @click="emit('update:modelValue', n === modelValue ? 0 : n)">
                <span class="zahl">{{ n }}</span>
                <span class="punkt"></span>
            </button>
        </template>
    </div>
</template>

<style scoped>
.stufen {
    display: flex;
    align-items: flex-end;
    max-width: 22rem;
}

.stufe {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15rem;
    padding: 0.1rem;
    border: none;
    background: none;
    color: var(--muted);
    font: inherit;
    cursor: pointer;
}

.zahl {
    font-size: 0.68rem;
    font-variant-numeric: tabular-nums;
}

.punkt {
    width: 0.8rem;
    height: 0.8rem;
    border: 1px solid var(--line-stark);
    border-radius: 50%;
    background: var(--bg);
}

.stufe.aktiv .punkt {
    border-color: var(--accent);
    background: var(--accent);
}

.stufe.aktiv .zahl {
    color: var(--text);
}

.stufe:hover .punkt {
    border-color: var(--accent);
}

.zwischen {
    display: flex;
    flex: 1 1 0;
    justify-content: center;
    min-width: 0.3rem;
    margin-bottom: 0.4rem;
}

.zwischen::before {
    content: '';
    width: 0.3rem;
    height: 0.3rem;
    border-radius: 50%;
    background: var(--line-stark);
}

.zwischen.aktiv::before {
    background: var(--accent-schwach);
}
</style>
