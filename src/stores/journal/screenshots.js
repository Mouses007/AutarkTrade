/**
 * Screenshots: Daten und Bearbeitungszustand.
 */
import { ref, reactive } from 'vue'

export const screenshot = reactive({})
export const screenshots = reactive([])
export const screenshotsInfos = reactive([])
export const screenshotsPagination = ref(0)
export const screenshotsQueryLimit = ref(10)
export const selectedScreenshot = reactive({})
export const selectedScreenshotIndex = ref(undefined)
export const selectedScreenshotSource = ref(undefined)
export const dateScreenshotEdited = ref(undefined)
export const editingScreenshot = ref(false)
export const expandedId = ref(undefined)
export const expandedSource = ref(undefined)
export const expandedScreenshot = ref(undefined)
export const markerAreaOpen = ref(false)
export const resizeCompressImg = ref(undefined)
export const resizeCompressMaxHeight = ref(undefined)
export const resizeCompressMaxWidth = ref(undefined)
export const resizeCompressQuality = ref(undefined)
