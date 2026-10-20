/**
 * Kalender: Monatsraster mit P&L je Tag.
 */
import { reactive } from 'vue'

export const kalenderDaten = reactive({})
// Bewusster Altfehler (Spezifikation §7.4): ein OBJEKT, keine Liste. Die
// Mini-Kalender werden deshalb nie gefüllt; es bleibt `{length: 0}`.
export const miniKalenderDaten = reactive({})
export const kalenderKonten = reactive([])
