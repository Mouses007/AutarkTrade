/**
 * Begleitdaten der Trades: Zufriedenheit, Tags, Notizen, Exkursionen und der
 * Bearbeitungszustand der Tagesansicht.
 */
import { ref, reactive } from 'vue'

/** Tages-Zufriedenheit `{tradeId, satisfaction, dateUnix}`. */
export const zufriedenheitTage = reactive([])
/** Trade-Zufriedenheit, gleiche Form. */
export const zufriedenheitTrades = reactive([])
export const tradeIndexAktiv = ref(undefined)
export const tradeIndexVorher = ref(undefined)
export const offenerTagIndex = ref(undefined)
export const excursion = reactive({})
/** Rohe `excursions`-Zeilen inkl. `objectId`. */
export const excursions = reactive([])
export const notes = reactive([])
export const auswertungNotes = reactive([])
/** Tag-Zuordnungen `{tradeId, tags, dateUnix}`. */
export const tags = reactive([])
/** Tag-Katalog: Gruppen `{id, name, color, tags}`. */
export const verfuegbareTags = reactive([])
export const verfuegbareTagListe = reactive([])
// F3-NEUBAU: Zustand der Tag-Zuordnung eines Trades — docs/spec/f3-tags.md
export const tradeNotiz = ref(null)
export const tradeNotizGeaendert = ref(false)
export const notizTagUnix = ref(undefined)
export const notizTradeId = ref(undefined)
export const tradeExkursionGeaendert = ref(false)
export const exkursionTagUnix = ref(undefined)
export const exkursionTradeId = ref(undefined)
export const tradeBildGeaendert = ref(false)
