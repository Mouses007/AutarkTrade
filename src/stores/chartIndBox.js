/**
 * Auf/Zu der Indikatoren-Box (Schnelleinstellungen) — geteilt zwischen der
 * Box selbst und ihrer Karte in der Seitenleiste: zugeklappt darf die Karte
 * ihre gezogene Höhe nicht behalten, sonst bliebe ein leerer Kasten stehen.
 * Im Browser gemerkt.
 */
import { ref, watch } from 'vue'

const SPEICHER = 'ctj.chart.indBoxOffen'

export const indBoxOffen = ref((() => { try { return localStorage.getItem(SPEICHER) !== '0' } catch { return true } })())
watch(indBoxOffen, (v) => { try { localStorage.setItem(SPEICHER, v ? '1' : '0') } catch { /* privat */ } })
