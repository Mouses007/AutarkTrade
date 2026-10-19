/**
 * Screenshots: Daten und Bearbeitungszustand.
 */
import { ref, reactive } from 'vue'

export const screenshot = reactive({})
export const screenshots = reactive([])
export const bildInfos = reactive([])
export const bildSeite = ref(0)
export const bildAbfrageGrenze = ref(10)
export const gewaehltesBild = reactive({})
export const selectedScreenshotIndex = ref(undefined)
export const selectedScreenshotSource = ref(undefined)
export const tagesBildGeaendert = ref(undefined)
export const bildInBearbeitung = ref(false)
export const expandedId = ref(undefined)
export const expandedSource = ref(undefined)
export const expandedScreenshot = ref(undefined)
export const markierungOffen = ref(false)
export const resizeCompressImg = ref(undefined)
export const resizeCompressMaxHeight = ref(undefined)
export const resizeCompressMaxWidth = ref(undefined)
export const resizeCompressQuality = ref(undefined)
