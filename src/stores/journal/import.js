/**
 * Import-Vorschau (Trades hinzufügen): Ausführungen, Trades, Blotter und P&L
 * je Handelstag, plus die Liste bereits vorhandener Tage.
 */
import { ref, reactive } from 'vue'

/** `td` → P&L-Objekt. */
export const pAndL = reactive({})
/** `td` → Liste von Ausführungen. */
export const executions = reactive({})
/** `td` → Liste von Trade-Objekten. */
export const trades = reactive({})
/** `td` → Symbol → Blotter-Objekt. */
export const blotter = reactive({})
export const tradesData = reactive([])
export const tradeId = ref(undefined)
/** `td`-Zahlen bereits vorhandener Tage. */
export const existingImports = reactive([])
/** Datumszeichenketten `YYYY-MM-DD`. */
export const existingTradesArray = reactive([])
export const gotExistingTradesArray = ref(false)
/** Marktschluss in Handelszeitzone (MFE). */
export const marketCloseTime = ref('16:00:00')
