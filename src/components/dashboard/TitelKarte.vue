<script setup>
/**
 * Karte der Journal-Auswertungen: Titel mit Info-Symbol links, Platz für
 * Bedienelemente rechts. Kompakt gesetzt (Dashboard B.3: kleinere
 * Innenabstände als auf anderen Seiten) — die Seiten zeigen viele Karten
 * nebeneinander, und jeder Pixel Rand geht dem Diagramm ab.
 */
import Karte from '@/components/basis/Karte.vue'
import InfoTipp from '@/components/InfoTipp.vue'

defineProps({
    titel: { type: String, default: '' },
    /** i18n-Schlüssel der Erklärung. */
    info: { type: String, default: '' },
    /** Literaltext der Erklärung (berechnet); schlägt `info`. */
    infoText: { type: String, default: '' },
    /** Farbpunkt vor dem Titel (Tag-Gruppen). */
    punkt: { type: String, default: '' },
})
</script>

<template>
    <Karte dicht class="tk">
        <header v-if="titel || $slots.rechts" class="tk-kopf">
            <h3 class="tk-titel">
                <span v-if="punkt" class="tk-punkt" :style="{ background: punkt }"></span>
                <span>{{ titel }}</span>
                <InfoTipp v-if="info || infoText" :schluessel="info" :text="infoText" />
            </h3>
            <div v-if="$slots.rechts" class="tk-rechts"><slot name="rechts" /></div>
        </header>
        <slot />
    </Karte>
</template>

<style scoped>
.tk {
    height: 100%;
    display: flex;
    flex-direction: column;
}

.tk-kopf {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.55rem;
}

.tk-titel {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin: 0;
    font-size: 0.74rem;
    font-weight: 700;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--muted);
    min-width: 0;
}

.tk-punkt {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
    flex: 0 0 auto;
}

.tk-rechts {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex: 0 0 auto;
}
</style>
