<script setup>
/**
 * Eine Zeile „Beschriftung — Bedienelement" in den Einstellungen.
 * Auf breiten Schirmen zweispaltig, am Telefon untereinander.
 *
 *   <Feld label="Sprache" hilfe="Gilt für die ganze App"><select …/></Feld>
 */
defineProps({
    label: { type: String, default: '' },
    hilfe: { type: String, default: '' },
    /** Bezeichner des Bedienelements, damit ein Klick aufs Label es fokussiert. */
    fuer: { type: String, default: '' },
})
</script>

<template>
    <div class="ein-feld">
        <div class="links">
            <label v-if="label" :for="fuer || undefined">{{ label }}</label>
            <slot name="label" />
            <p v-if="hilfe" class="hilfe">{{ hilfe }}</p>
        </div>
        <div class="rechts"><slot /></div>
    </div>
</template>

<style scoped>
.ein-feld {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
    gap: var(--abstand-2) var(--abstand-4);
    align-items: center;
    padding: var(--abstand-2) 0;
}
.links label { color: var(--text); }
.hilfe {
    margin: 0.15rem 0 0;
    color: var(--muted);
    font-size: 0.82rem;
}
.rechts { min-width: 0; }
@media (max-width: 767.98px) {
    .ein-feld { grid-template-columns: 1fr; }
}
</style>
