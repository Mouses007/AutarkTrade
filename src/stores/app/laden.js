/**
 * Lade- und Mount-Zustand: Spinner, „ist gemountet"-Flags, Neuaufbau-Zähler.
 */
import { ref } from 'vue'

export const seiteLaedt = ref(true)
export const seiteLaedtText = ref(undefined)
/** Zähler als `:key`, um Diagrammknoten neu aufzubauen. */
export const zeichenZaehler = ref(0)
export const ladeMehr = ref(false)
export const bilderWerdenGeholt = ref(false)
export const dashboardDiagrammeBereit = ref(undefined)
export const dashboardBereit = ref(false)
export const auswertungMounted = ref(false)
/** Liste `{id, name}` der Tag-Gruppen, die ein Diagramm bekommen. */
export const negativeTagGruppen = ref([])
export const diagrammeImAufbau = ref(true)
export const setupsLaden = ref(true)
export const setupsLadeText = ref(undefined)
