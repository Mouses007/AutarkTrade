/**
 * Schalter „Quellen ohne Verkaufsfreigabe" im Browser (S15, Gegenstück zu
 * `server/quellen/freigabe.js`). Einmal je Seitenaufruf geladen und geteilt.
 * Unbekannt (noch nicht geladen, Fehler) gilt als AN — die Vorgabe.
 */
import { ref } from 'vue'
import axios from 'axios'

/** `{ an, vorgabe, quellen: [{ id, name, zeilen, was }] }` — null bis geladen. */
export const quellenFreigabe = ref(null)
let laden = null

export function ladeFreigabe({ neu = false } = {}) {
    if (laden && !neu) return laden
    laden = axios.get('/api/quellen/ohne-freigabe')
        .then((r) => { quellenFreigabe.value = r.data; return r.data })
        .catch(() => { quellenFreigabe.value = { an: true, quellen: [] }; return quellenFreigabe.value })
    return laden
}

/** Läuft die Quelle mit dieser ID (`freigabe.js`)? */
export function freigabeAn() {
    return quellenFreigabe.value ? quellenFreigabe.value.an !== false : true
}

export async function setzeFreigabe(an) {
    const r = await axios.put('/api/quellen/ohne-freigabe', { an: !!an })
    quellenFreigabe.value = r.data
    laden = Promise.resolve(r.data)
    return r.data
}
