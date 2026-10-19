<script setup>
/**
 * Kopf einer Seite: Titel (H1), Unterzeile, rechts Aktionen. Nach dem Vorbild
 * von AutarkDarts (`Seitenkopf.svelte`): grosser, enger Titel, ruhige Unterzeile.
 *
 *   <Seitenkopf titel="Marktradar" unter="Wo stehen wir gerade?">
 *     <template #aktionen><Knopf symbol="plus">Kachel</Knopf></template>
 *   </Seitenkopf>
 */
defineProps({
    titel: { type: String, required: true },
    unter: { type: String, default: '' },
    linie: { type: Boolean, default: false },
})
</script>

<template>
    <header :class="['at-seitenkopf', { linie }]">
        <div class="text">
            <h1>{{ titel }}</h1>
            <p v-if="unter" class="unter">{{ unter }}</p>
        </div>
        <div v-if="$slots.aktionen" class="aktionen"><slot name="aktionen" /></div>
        <div v-if="$slots.default" class="zeile"><slot /></div>
    </header>
</template>

<style scoped>
.at-seitenkopf {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: end;
    gap: 0.6rem 1rem;
    margin-bottom: 1.4rem;
}

.at-seitenkopf.linie {
    padding-bottom: 0.8rem;
    border-bottom: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
}

h1 {
    margin: 0;
    font-size: clamp(1.6rem, 3.4vw, 2.3rem);
    font-weight: 700;
    letter-spacing: -0.03em;
    line-height: 1.1;
}

.unter {
    margin: 0.35rem 0 0;
    color: var(--muted);
}

.aktionen {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    justify-content: flex-end;
}

.zeile {
    grid-column: 1 / -1;
}

@media (max-width: 40rem) {
    .at-seitenkopf {
        grid-template-columns: minmax(0, 1fr);
    }

    .aktionen {
        justify-content: flex-start;
    }
}
</style>
