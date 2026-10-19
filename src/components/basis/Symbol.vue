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
import { SYMBOLE_ANALYSE } from './symbole/analyse.js'

const props = defineProps({
    name: { type: String, required: true },
    groesse: { type: [Number, String], default: '1em' },
    /** Mit Titel ist das Symbol für Screenreader sichtbar, sonst dekorativ. */
    titel: { type: String, default: '' },
    strich: { type: Number, default: 1.8 },
    /** Fläche in Strichfarbe füllen (z. B. aktiver Stern). */
    gefuellt: { type: Boolean, default: false },
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
    // — S5 Handel (Chart, Live, Agent) —
    doppelLinks: ['M11 6l-6 6 6 6', 'M18 6l-6 6 6 6'],
    doppelRechts: ['M13 6l6 6-6 6', 'M6 6l6 6-6 6'],
    pfeilLinks: ['M19 12H5', 'M11 6l-6 6 6 6'],
    pfeilRechts: ['M5 12h14', 'M13 6l6 6-6 6'],
    pfeilAnschlagLinks: ['M21 12H8', 'M13 7l-5 5 5 5', 'M4 5v14'],
    pfeilAnschlagRechts: ['M3 12h13', 'M11 7l5 5-5 5', 'M20 5v14'],
    raster: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h6v6h-6z'],
    quadrat: ['M4 4h16v16H4z'],
    spalten: ['M4 4h16v16H4z', 'M12 4v16'],
    zeilen: ['M4 4h16v16H4z', 'M4 12h16'],
    seitenleiste: ['M4 4h16v16H4z', 'M15 4v16'],
    fenster: ['M3.5 4.5h17v15h-17z', 'M3.5 8.5h17'],
    archiv: ['M3 4h18v4H3z', 'M5 8v12h14V8', 'M10 12h4'],
    waage: ['M12 4v16', 'M7 20h10', 'M5 7h14', 'M5 7l-3 7a3 3 0 0 0 6 0z', 'M19 7l-3 7a3 3 0 0 0 6 0z'],
    glocke: ['M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z', 'M10 20.5a2 2 0 0 0 4 0'],
    glockeAus: ['M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z', 'M10 20.5a2 2 0 0 0 4 0', 'M4 4l16 16'],
    blitz: ['M13 3 5 13.5h6L10 21l8-10.5h-6z'],
    buch: ['M12 6.5C10 5 7 4.5 3 5v13.5c4-.5 7 0 9 1.5 2-1.5 5-2 9-1.5V5c-4-.5-7 0-9 1.5z', 'M12 6.5V20'],
    lesezeichen: ['M6 3.5h12V21l-6-4.5L6 21z'],
    gehirn: ['M12 5a3 3 0 0 0-5.5 1.5A3 3 0 0 0 4 10a3 3 0 0 0 1 5 3 3 0 0 0 3.5 4 3 3 0 0 0 3.5-1z', 'M12 5a3 3 0 0 1 5.5 1.5A3 3 0 0 1 20 10a3 3 0 0 1-1 5 3 3 0 0 1-3.5 4 3 3 0 0 1-3.5-1'],
    kamera: ['M4 8h3.5L9 5.5h6L16.5 8H20v11H4z', kreis(12, 13.5, 3.5)],
    linie: ['M4 3v17h17', 'M7 15l4-5 3 3 5-6'],
    wachstum: ['M4 3v17h17', 'M7 16l4-4 3 3 6-7', 'M16 8h4v4'],
    rangliste: ['M4 20v-7h5v7', 'M9.5 20V8h5v12', 'M15 20v-9h5v9'],
    hakenKreis: [kreis(12, 12, 9), 'M8 12.5l2.8 2.8L16 9.8'],
    hakenKasten: ['M4 4h16v16H4z', 'M8 12.5l2.8 2.8L16 9.8'],
    zwischenablage: ['M8 4.5H6v16h12v-16h-2', 'M9 3h6v3H9z', 'M9 11h6M9 15h4'],
    uhr: [kreis(12, 12, 9), 'M12 7v5l3.5 2'],
    muenzen: ['M3 7c0-1.4 2.7-2.5 6-2.5s6 1.1 6 2.5-2.7 2.5-6 2.5S3 8.4 3 7z', 'M3 7v8c0 1.4 2.7 2.5 6 2.5', 'M3 11c0 1.4 2.7 2.5 6 2.5', 'M15 7v3', 'M9 14c0-1.4 2.7-2.5 6-2.5s6 1.1 6 2.5-2.7 2.5-6 2.5S9 15.4 9 14z', 'M9 14v4c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-4'],
    nachricht: ['M4 5h16v11H9l-5 4z', 'M8 9h8M8 12.5h5'],
    kompass: [kreis(12, 12, 9), 'M15.5 8.5l-2 5-5 2 2-5z'],
    vergroessern: ['M4 9V4h5', 'M20 9V4h-5', 'M4 15v5h5', 'M20 15v5h-5'],
    verkleinern: ['M4 9h5V4', 'M20 9h-5V4', 'M4 15h5v5', 'M20 15h-5v5'],
    kopieren: ['M9 9h11v11H9z', 'M15 9V4H4v11h5'],
    fadenkreuz: [kreis(12, 12, 7), 'M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5'],
    datenbank: ['M5 6c0-1.4 3.1-2.5 7-2.5s7 1.1 7 2.5-3.1 2.5-7 2.5S5 7.4 5 6z', 'M5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6', 'M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5'],
    wuerfel: ['M4 4h16v16H4z', 'M8.5 8v.1M8.5 12v.1M8.5 16v.1M15.5 8v.1M15.5 12v.1M15.5 16v.1'],
    herunterladen: ['M12 4v11', 'M7 10.5l5 5 5-5', 'M4 19.5h16'],
    hochladen: ['M12 16V5', 'M7 9.5l5-5 5 5', 'M4 19.5h16'],
    ziehgriff: ['M9 6v.1M15 6v.1M9 12v.1M15 12v.1M9 18v.1M15 18v.1'],
    stift: ['M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5z', 'M13.5 7l3 3'],
    stopp: ['M8.3 3h7.4L21 8.3v7.4L15.7 21H8.3L3 15.7V8.3z', 'M12 8v5M12 16.2v.1'],
    filterAus: ['M4 5h16l-6 7.5V19l-4 1.5v-8z', 'M3 3l18 18'],
    feuer: ['M12 21c-3.9 0-6.5-2.6-6.5-6 0-3.2 2.4-5.2 3.5-8 .9 1.6 1.4 2.6 2.4 3.2C11.8 7.4 13 5 12.5 3c3.4 2 6 5.8 6 11 0 3.6-2.6 7-6.5 7z'],
    globus: [kreis(12, 12, 9), 'M3 12h18', 'M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z'],
    verlauf: ['M3.5 12a8.5 8.5 0 1 0 2.5-6', 'M3 4v4h4', 'M12 8v4.5l3 2'],
    bild: ['M4 5h16v14H4z', 'M4 16l5-5 4 4 2.5-2.5L20 17', kreis(15.5, 9, 1.5)],
    bildPlus: ['M13 5H4v14h16v-7', 'M4 16l5-5 4 4 2.5-2.5L20 17', 'M18 3v6M15 6h6'],
    frage: [kreis(12, 12, 9), 'M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6', 'M12 17v.1'],
    ebenen: ['M12 4 3 8.5l9 4.5 9-4.5z', 'M3 12.5l9 4.5 9-4.5', 'M3 16.5l9 4.5 9-4.5'],
    idee: ['M9 18h6M10 21h4', 'M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2v.1h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z'],
    verknuepfung: ['M10 7H7a5 5 0 0 0 0 10h3', 'M14 7h3a5 5 0 0 1 0 10h-3', 'M8 12h8'],
    liste: ['M9 6h11M9 12h11M9 18h11', 'M4.5 6v.1M4.5 12v.1M4.5 18v.1'],
    schloss: ['M5 11h14v10H5z', 'M8 11V7.5a4 4 0 0 1 8 0V11'],
    schlossOffen: ['M5 11h14v10H5z', 'M8 11V7.5a4 4 0 0 1 7.7-1.5'],
    magnet: ['M5 4h4v8a3 3 0 0 0 6 0V4h4v8a7 7 0 0 1-14 0z', 'M5 8h4M15 8h4'],
    minus: ['M5 12h14'],
    maus: ['M7 9a5 5 0 0 1 10 0v6a5 5 0 0 1-10 0z', 'M12 7v3'],
    notiz: ['M5 3.5h10l4 4v13H5z', 'M15 3.5v4h4', 'M8.5 12h7M8.5 16h5'],
    palette: ['M12 3a9 9 0 0 0 0 18c1.2 0 1.8-.8 1.8-1.8 0-1.3-1.1-1.7-1.1-2.8 0-.9.7-1.4 1.6-1.4H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z', 'M7.5 11v.1M10 7.5v.1M14.5 7.5v.1'],
    anhang: ['M20 11.5l-8 8a5 5 0 0 1-7-7l8.5-8.5a3.5 3.5 0 0 1 5 5L10 17.5a2 2 0 0 1-3-3l7.5-7.5'],
    pause: ['M8 5v14M16 5v14'],
    play: ['M7 4.5v15L19.5 12z'],
    prozent: ['M5 19 19 5', kreis(7, 7, 2.2), kreis(17, 17, 2.2)],
    plusKreis: [kreis(12, 12, 9), 'M12 8v8M8 12h8'],
    ein: ['M12 3v8', 'M7 6a8 8 0 1 0 10 0'],
    speichern: ['M5 4h11l3 3v13H5z', 'M8 4v5h7V4', 'M8 20v-6h8v6'],
    schildHaken: ['M12 3l7.5 3v5.5c0 4.5-3.2 8-7.5 9.5-4.3-1.5-7.5-5-7.5-9.5V6z', 'M8.8 12l2.2 2.2 4.2-4.4'],
    schildWarnung: ['M12 3l7.5 3v5.5c0 4.5-3.2 8-7.5 9.5-4.3-1.5-7.5-5-7.5-9.5V6z', 'M12 8v4.5M12 15.5v.1'],
    regler: ['M7 4v4M7 12v8M17 4v8M17 16v4', kreis(7, 10, 2), kreis(17, 14, 2)],
    stern: ['M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z'],
    aktualisieren: ['M20 11a8 8 0 0 0-14.3-4.5L4 8.5', 'M4 4v4.5h4.5', 'M4 13a8 8 0 0 0 14.3 4.5l1.7-2', 'M20 20v-4.5h-4.5'],
    tropfen: ['M12 3.5s6 6.4 6 11a6 6 0 0 1-12 0c0-4.6 6-11 6-11z'],
    text: ['M5 6V4.5h14V6', 'M12 4.5v15', 'M9 19.5h6'],
    muell: ['M4 6.5h16', 'M9 6.5V4h6v2.5', 'M6 6.5l1 13.5h10l1-13.5', 'M10 10.5v6M14 10.5v6'],
    geldbeutel: ['M4 6.5h14a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H4z', 'M4 6.5V6a2 2 0 0 1 2-2h10v2.5', 'M16 13.5h.1'],
}

// Weitere Sätze je Bereich in `./symbole/` (eigene Datei, damit parallele
// Sitzungen nicht in derselben Liste schreiben).
Object.assign(PFADE, SYMBOLE_ANALYSE)

const pfade = computed(() => PFADE[props.name] || PFADE.info)
const masse = computed(() => (typeof props.groesse === 'number' ? `${props.groesse}px` : props.groesse))
</script>

<template>
    <svg class="at-symbol" :width="masse" :height="masse" viewBox="0 0 24 24" :fill="gefuellt ? 'currentColor' : 'none'" stroke="currentColor"
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
