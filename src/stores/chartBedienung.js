/**
 * Bedienung des Charts, die am GERÄT hängt, nicht am Layout: Fadenkreuz-Zeichnen
 * per Touch. Auf dem Handy ist es Standard (an), weil ein Punkt unter dem Finger
 * nicht zu sehen ist; wer lieber direkt tippt, schaltet es in der Werkzeugleiste ab.
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

/** Hauptzeiger ist ein Finger (Handy, Tablet) — dort steht das Fadenkreuz schon beim Wählen des Werkzeugs. */
export function istTouchGeraet() {
    try { return window.matchMedia('(pointer: coarse)').matches } catch { return false }
}
