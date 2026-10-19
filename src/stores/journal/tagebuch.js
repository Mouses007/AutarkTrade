/**
 * Begleitdaten der Trades: Zufriedenheit, Tags, Notizen, Exkursionen und der
 * Bearbeitungszustand der Tagesansicht.
 */
import { ref, reactive } from 'vue'

/** Tages-Zufriedenheit `{tradeId, satisfaction, dateUnix}`. */
export const satisfactionArray = reactive([])
/** Trade-Zufriedenheit, gleiche Form. */
export const satisfactionTradeArray = reactive([])
export const tradeIndex = ref(undefined)
export const tradeIndexPrevious = ref(undefined)
export const itemTradeIndex = ref(undefined)
export const excursion = reactive({})
/** Rohe `excursions`-Zeilen inkl. `objectId`. */
export const excursions = reactive([])
export const notes = reactive([])
export const auswertungNotes = reactive([])
/** Tag-Zuordnungen `{tradeId, tags, dateUnix}`. */
export const tags = reactive([])
export const tradeTags = reactive([])
export const newTradeTags = reactive([])
/** Tag-Katalog: Gruppen `{id, name, color, tags}`. */
export const availableTags = reactive([])
export const availableTagsArray = reactive([])
export const tagInput = ref('')
/** '' oder die `pageId`, auf der die Liste offen ist. */
export const showTagsList = ref('')
export const tradeNote = ref(null)
export const tradeNoteChanged = ref(false)
export const tradeNoteDateUnix = ref(undefined)
export const tradeNoteId = ref(undefined)
export const tradeTagsChanged = ref(false)
export const tradeTagsDateUnix = ref(undefined)
export const tradeTagsId = ref(undefined)
export const tradeExcursionChanged = ref(false)
export const tradeExcursionDateUnix = ref(undefined)
export const tradeExcursionId = ref(undefined)
export const tradeScreenshotChanged = ref(false)
