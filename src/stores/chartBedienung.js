/**
 * Bedienung des Charts, die am GERÄT hängt, nicht am Layout: Fadenkreuz-Zeichnen
 * per Touch. Auf dem Handy ist es Standard (an), weil ein Punkt unter dem Finger
 * nicht zu sehen ist; wer lieber direkt tippt, schaltet es in der Werkzeugleiste ab.
 * Dazu die Auto-Sperre neuer Zeichnungen.
 */
import { ref, watch } from 'vue'

const SCHLUESSEL = 'at.chart.fadenkreuzTouch'

function lese() {
    try { return localStorage.getItem(SCHLUESSEL) !== '0' } catch { return true }
}

export const fadenkreuzTouch = ref(lese())
watch(fadenkreuzTouch, (an) => {
    try { localStorage.setItem(SCHLUESSEL, an ? '1' : '0') } catch { /* privat */ }
})

/*
 * Auto-Sperre (Wunsch 03.11.2026): jede neu gesetzte Zeichnung wird nach
 * AUTO_SPERRE_MS gesperrt, damit ein späterer Klick ins Chart sie nicht
 * versehentlich verschiebt. Aus als Vorgabe; gemerkt am Gerät.
 */
const SPERRE_SCHLUESSEL = 'at.chart.autoSperre'
export const AUTO_SPERRE_MS = 5000
export const autoSperre = ref((() => { try { return localStorage.getItem(SPERRE_SCHLUESSEL) === '1' } catch { return false } })())
watch(autoSperre, (an) => {
    try { localStorage.setItem(SPERRE_SCHLUESSEL, an ? '1' : '0') } catch { /* privat */ }
})

/** Hauptzeiger ist ein Finger (Handy, Tablet) — dort steht das Fadenkreuz schon beim Wählen des Werkzeugs. */
export function istTouchGeraet() {
    try { return window.matchMedia('(pointer: coarse)').matches } catch { return false }
}
