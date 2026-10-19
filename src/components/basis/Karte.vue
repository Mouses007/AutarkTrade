<script setup>
/**
 * Karte: ruhige dunkle Fläche mit feinem Rand. Kopf optional (Titel, Unterzeile,
 * Aktionen rechts über den Slot `aktionen`).
 *
 *   <Karte titel="Kennzahlen" unter="letzte 30 Tage">…</Karte>
 *   <Karte akzent>…</Karte>        hervorgehoben (türkiser Rand)
 */
defineProps({
    titel: { type: String, default: '' },
    unter: { type: String, default: '' },
    akzent: { type: Boolean, default: false },
    dicht: { type: Boolean, default: false },
    als: { type: String, default: 'section' },
})
</script>

<template>
    <component :is="als" :class="['at-karte', { akzent, dicht }]">
        <header v-if="titel || $slots.aktionen" class="kopf">
            <div>
                <h3 v-if="titel" class="titel">{{ titel }}</h3>
                <p v-if="unter" class="unter">{{ unter }}</p>
            </div>
            <div v-if="$slots.aktionen" class="aktionen"><slot name="aktionen" /></div>
        </header>
        <slot />
    </component>
</template>

<style scoped>
.at-karte {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 1.1rem 1.2rem;
    color: var(--text);
    min-width: 0;
}

.at-karte.dicht {
    padding: 0.7rem 0.8rem;
}

.at-karte.akzent {
    border-color: var(--accent-rand);
    background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 6%, var(--panel)), var(--panel));
}

.kopf {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.8rem;
    margin-bottom: 0.8rem;
}

.titel {
    margin: 0;
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
}

.unter {
    margin: 0.2rem 0 0;
    font-size: 0.85rem;
    color: var(--muted);
}

.aktionen {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
}
</style>
