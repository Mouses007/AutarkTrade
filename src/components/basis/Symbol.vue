<script setup>
/**
 * Eigenes Symbolset von AutarkTrade.
 *
 * Ersetzt nach und nach Font Awesome und Unicons (beide heute noch vom CDN,
 * Unicons unter einer Lizenz, die eine Weitergabe nicht deckt). Jedes Symbol
 * ist auf einem 24er-Raster mit 1,8er Strich gezeichnet, ohne Füllung — so
 * passen alle zueinander und nehmen `currentColor` an.
 *
 * Neue Symbole: einen Eintrag in PFADE ergänzen (nur `d`-Pfade; Kreise als
 * zwei Bögen). Selbst gezeichnet; wer eins aus Lucide (ISC) übernimmt, trägt
 * es in THIRD-PARTY-NOTICES ein.
 *
 *   <Symbol name="journal" />            1em gross, erbt die Farbe
 *   <Symbol name="warnung" :groesse="20" titel="Achtung" />
 */
import { computed } from 'vue'

const props = defineProps({
    name: { type: String, required: true },
    groesse: { type: [Number, String], default: '1em' },
    /** Mit Titel ist das Symbol für Screenreader sichtbar, sonst dekorativ. */
    titel: { type: String, default: '' },
    strich: { type: Number, default: 1.8 },
})

const kreis = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`

const PFADE = {
    // Modi
    journal: ['M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5', 'M5 4.5v15A1.5 1.5 0 0 0 6.5 21H19v-3', 'M9 7.5h6M9 11h4'],
    chart: ['M4 3v17h17', 'M8 14v3M8 9v2', 'M7 11h2v3H7z', 'M13 7v2M13 15v2', 'M12 9h2v6h-2z', 'M18 5v2M18 11v2', 'M17 7h2v4h-2z'],
    live: ['M3 12h4l2.5-6 4 12L16 9l1.5 3H21'],
    entdecken: [kreis(10.5, 10.5, 6.5), 'M15.5 15.5 21 21', 'M8 10.5a2.5 2.5 0 0 1 2.5-2.5'],
    agent: ['M7 7h10v10H7z', 'M10 10h4v4h-4z', 'M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4'],
    lernen: ['M2.5 9 12 4.5 21.5 9 12 13.5z', 'M6 11v4.5c0 1.5 2.7 3 6 3s6-1.5 6-3V11', 'M21.5 9v5'],
    start: ['M3 11.5 12 4l9 7.5', 'M5.5 9.5V20h13V9.5', 'M10 20v-5h4v5'],
    // Rahmen
    menue: ['M4 6.5h16M4 12h16M4 17.5h16'],
    schliessen: ['M6 6l12 12M18 6 6 18'],
    einstellungen: ['M4 7h9M17 7h3M4 17h3M11 17h9', kreis(15, 7, 2), kreis(9, 17, 2)],
    auge: ['M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z', kreis(12, 12, 3)],
    augeAus: ['M4 4l16 16', 'M9.9 5.8A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.6 3.4', 'M6.6 7.1C4 8.9 2.5 12 2.5 12S6 18.5 12 18.5c1.8 0 3.3-.5 4.6-1.3', 'M9.9 10a3 3 0 0 0 4.1 4.1'],
    ki: ['M12 3v3', 'M6 7h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z', 'M9 12v1.5M15 12v1.5', 'M2 12v3M22 12v3'],
    einklappen: ['M15 6l-6 6 6 6'],
    ausklappen: ['M9 6l6 6-6 6'],
    runter: ['M6 9l6 6 6-6'],
    hoch: ['M6 15l6-6 6 6'],
    plus: ['M12 5v14M5 12h14'],
    haken: ['M5 12.5l4.5 4.5L19 7.5'],
    info: [kreis(12, 12, 9), 'M12 11v5.5M12 7.6v.1'],
    warnung: ['M12 3.5 21.5 20h-19z', 'M12 10v4.5M12 17.2v.1'],
    fehler: [kreis(12, 12, 9), 'M9 9l6 6M15 9l-6 6'],
    extern: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
    suche: [kreis(11, 11, 6.5), 'M16 16l4.5 4.5'],
    kalender: ['M4 6h16v14H4z', 'M4 10h16', 'M8 3.5v4M16 3.5v4'],
    abmelden: ['M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4', 'M10 16l-4-4 4-4', 'M6 12h10'],
    leer: ['M4 14l2.5-8h11l2.5 8v5H4z', 'M4 14h5l1 2h4l1-2h5'],
    test: ['M9 3h6M10 3v6l-5 9.5A1.7 1.7 0 0 0 6.5 21h11a1.7 1.7 0 0 0 1.5-2.5L14 9V3', 'M7.5 15h9'],
}

const pfade = computed(() => PFADE[props.name] || PFADE.info)
const masse = computed(() => (typeof props.groesse === 'number' ? `${props.groesse}px` : props.groesse))
</script>

<template>
    <svg class="at-symbol" :width="masse" :height="masse" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        :stroke-width="strich" stroke-linecap="round" stroke-linejoin="round"
        :role="titel ? 'img' : undefined" :aria-hidden="titel ? undefined : 'true'" :aria-label="titel || undefined">
        <title v-if="titel">{{ titel }}</title>
        <path v-for="(d, i) in pfade" :key="i" :d="d" />
    </svg>
</template>

<style scoped>
.at-symbol {
    display: inline-block;
    flex: 0 0 auto;
    vertical-align: -0.15em;
}
</style>
