/**
 * Offene Positionen (Incoming) und die Hinweise „Trade bewerten".
 *
 * Was neu und was schon gemeldet ist, weiss der Server
 * (`server/trade-popups.js`); `evalMeldungen` hält seine letzte Antwort.
 */
import { ref, reactive } from 'vue'

export const incomingPositions = reactive([])
export const incomingPollingActive = ref(false)
export const incomingLastFetched = ref(null)
/** Liste `{broker, meldung, zugang}`. */
export const incomingBrokerFehler = ref([])
export const pendingOpeningCount = ref(0)
export const pendingClosingCount = ref(0)
/** Börse → Anzahl. */
export const pendingOpeningByBroker = ref({})
export const pendingClosingByBroker = ref({})
/** Offene Meldungen des Bewertungs-Popups: `{positionId, broker, art: 'open'|'close'}`. */
export const evalMeldungen = ref([])

/** Positions-ID der aufgeklappten Incoming-Karte (null = keine). */
export const aufgeklapptePosition = ref(null)
