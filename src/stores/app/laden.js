/**
 * Lade- und Mount-Zustand: Spinner, „ist gemountet"-Flags, Neuaufbau-Zähler.
 */
import { ref } from 'vue'

export const spinnerLoadingPage = ref(true)
export const spinnerLoadingPageText = ref(undefined)
/** Zähler als `:key`, um Diagrammknoten neu aufzubauen. */
export const renderData = ref(0)
export const spinnerLoadMore = ref(false)
export const tabGettingScreenshots = ref(false)
export const dashboardChartsMounted = ref(undefined)
export const dashboardIdMounted = ref(false)
export const auswertungMounted = ref(false)
/** Liste `{id, name}` der Tag-Gruppen, die ein Diagramm bekommen. */
export const barChartNegativeTagGroups = ref([])
export const renderingCharts = ref(true)
export const spinnerSetups = ref(true)
export const spinnerSetupsText = ref(undefined)
