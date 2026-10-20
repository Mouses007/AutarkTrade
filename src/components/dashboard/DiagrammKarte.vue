<script setup>
/**
 * Karte mit genau einem ECharts-Diagramm. Die Element-ID ist Schnittstelle:
 * `zeichneDiagramme` sucht die Knoten per ID-Präfix (Spezifikation B.13), und
 * `useDisposeJournalCharts` sammelt sie über die Klasse `diagrammFlaeche`. Der
 * Schlüssel `zeichenZaehler` erzwingt bei jeder Erhöhung einen frischen Knoten.
 */
import { zeichenZaehler } from '../../stores/ui.js'
import TitelKarte from './TitelKarte.vue'

defineProps({
    titel: { type: String, required: true },
    info: { type: String, default: '' },
    diagrammId: { type: String, required: true },
    /** Höhe in px ab Desktopbreite; darunter etwas niedriger (CSS). */
    hoehe: { type: Number, default: 300 },
})
</script>

<template>
    <TitelKarte :titel="titel" :info="info">
        <div :id="diagrammId" :key="zeichenZaehler" class="diagrammFlaeche dk-diagramm"
            :style="{ '--hoehe': hoehe + 'px' }"></div>
    </TitelKarte>
</template>

<style scoped>
.dk-diagramm {
    width: 100%;
    height: var(--hoehe);
}

/* Auf dem Telefon kürzer, damit eine Karte nicht den ganzen Schirm füllt —
   aber nie unter 200 px, sonst werden Achsen unlesbar. */
@media (max-width: 767.98px) {
    .dk-diagramm {
        height: max(200px, calc(var(--hoehe) * 0.8));
    }
}
</style>
