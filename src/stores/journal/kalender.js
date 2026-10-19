/**
 * Kalender: Monatsraster mit P&L je Tag.
 */
import { reactive } from 'vue'

export const calendarData = reactive({})
// Bewusster Altfehler (Spezifikation §7.4): ein OBJEKT, keine Liste. Die
// Mini-Kalender werden deshalb nie gefüllt; es bleibt `{length: 0}`.
export const miniCalendarsData = reactive({})
export const tradeAccounts = reactive([])
