/**
 * Einstellungsseite und KI-Report-Status.
 */
import { ref, reactive } from 'vue'

export const profilZaehler = ref(0)
export const apis = reactive([])
export const layoutStyle = reactive([])

// ── KI-Report ──────────────────────────────────────────────────────────────
export const aiReportGenerating = ref(false)
export const aiReportError = ref('')
export const aiReportLastSavedId = ref(null)
export const aiReportLabel = ref('')
export const aiReportCountBefore = ref(0)
