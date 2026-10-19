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
export const tradeTags = reactive([])
export const neueTradeTags = reactive([])
/** Tag-Katalog: Gruppen `{id, name, color, tags}`. */
export const verfuegbareTags = reactive([])
export const verfuegbareTagListe = reactive([])
export const tagInput = ref('')
/** '' oder die `pageId`, auf der die Liste offen ist. */
export const showTagsList = ref('')
export const tradeNotiz = ref(null)
export const tradeNotizGeaendert = ref(false)
export const tradeNoteDateUnix = ref(undefined)
export const tradeNoteId = ref(undefined)
export const tradeTagsGeaendert = ref(false)
export const tradeTagsDateUnix = ref(undefined)
export const tradeTagsId = ref(undefined)
export const tradeExkursionGeaendert = ref(false)
export const tradeExcursionDateUnix = ref(undefined)
export const tradeExcursionId = ref(undefined)
export const tradeBildGeaendert = ref(false)
