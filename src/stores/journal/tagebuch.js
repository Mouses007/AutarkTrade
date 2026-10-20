/**
 * Begleitdaten der Trades: Zufriedenheit, Tags, Notizen, Exkursionen und der
 * Bearbeitungszustand des Trade-Fensters der Tagesansicht.
 */
import { ref, reactive } from 'vue'

/** Tages-Zufriedenheit `{tradeId, satisfaction, dateUnix}`. */
export const zufriedenheitTage = reactive([])
/** Trade-Zufriedenheit, gleiche Form. */
export const zufriedenheitTrades = reactive([])
export const tradeIndexAktiv = ref(undefined)
export const offenerTagIndex = ref(undefined)
/** Exkursion des offenen Trades im Trade-Fenster: `{stopLoss, maePrice, mfePrice}`. */
export const exkursionEntwurf = reactive({})
/** Rohe `excursions`-Zeilen inkl. `objectId`. */
export const excursions = reactive([])
export const notes = reactive([])
export const auswertungNotes = reactive([])
/** Tag-Zuordnungen `{tradeId, tags, dateUnix}`. */
export const tags = reactive([])
/** Tag-Katalog: Gruppen `{id, name, color, tags}`. */
export const verfuegbareTags = reactive([])
/** Tags des offenen Trades `{id, name}` — nur Anzeige und Share-Karte, keine Eingabe. */
export const tagsDesTrades = reactive([])
/** Änderungsmerker und Speicherkontext der Exkursion (der Kontext wird vom MFE-Import mitgelesen). */
export const tradeExkursionGeaendert = ref(false)
export const exkursionTagUnix = ref(undefined)
export const exkursionTradeId = ref(undefined)
