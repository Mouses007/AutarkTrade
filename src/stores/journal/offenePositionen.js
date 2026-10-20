/**
 * Offene Positionen (Incoming) und die Hinweise „Trade bewerten".
 *
 * Welche Positionen schon gemeldet wurden, steht in localStorage
 * `evalNotifiedPositionIds` als JSON-Liste.
 */
import { ref, reactive } from 'vue'
import { lokal, lokalSchreiben } from '../app/ablage.js'

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
export const evalNotificationShown = ref(false)
export const evalNotificationDismissed = ref(false)
export const evalNeu = ref({ oeffnung: { anzahl: 0, jeBroker: {} }, schluss: { anzahl: 0, jeBroker: {} } })

const SCHLUESSEL_GEMELDET = 'evalNotifiedPositionIds'

export function getNotifiedPositionIds() {
    try {
        const liste = JSON.parse(lokal(SCHLUESSEL_GEMELDET))
        return new Set(Array.isArray(liste) ? liste : [])
    } catch {
        return new Set()
    }
}

function merkeGemeldet(menge) {
    lokalSchreiben(SCHLUESSEL_GEMELDET, JSON.stringify([...menge]))
}

export function addNotifiedPositionIds(ids) {
    const menge = getNotifiedPositionIds()
    for (const id of ids) menge.add(id)
    merkeGemeldet(menge)
}

export function removeNotifiedPositionIds(ids) {
    const menge = getNotifiedPositionIds()
    for (const id of ids) menge.delete(id)
    merkeGemeldet(menge)
}

/** Positions-ID der aufgeklappten Incoming-Karte (null = keine). */
export const aufgeklapptePosition = ref(null)
