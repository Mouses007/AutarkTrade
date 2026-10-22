import { ref } from 'vue'
import axios from 'axios'

/**
 * Spenden-Dialog (`components/rahmen/SpendenDialog.vue`, hängt einmal in `App.vue`).
 * `frage` = null (aus Menü oder Kaffee-Knopf geöffnet) oder `{ art, wert }` —
 * eine fällige Nachfrage, siehe `server/spenden.js`.
 */
export const spendenOffen = ref(false)
export const spendenFrage = ref(null)

export function oeffneSpenden(frage = null) {
    spendenFrage.value = frage
    spendenOffen.value = true
}

/** Fragt den Server, ob eine Nachfrage fällig ist, und öffnet sie. */
export async function pruefeSpendenFrage() {
    try {
        const { data } = await axios.get('/api/spenden/stand')
        if (data?.faellig) oeffneSpenden(data.faellig)
        return !!data?.faellig
    } catch { return false /* ohne Antwort: nicht nachfragen */ }
}

/** Dialog zu — mit der Antwort (`spaeter` | `gespendet` | `nein` | `zu`). */
export async function spendenAntwort(antwort = 'zu') {
    const frage = spendenFrage.value
    spendenOffen.value = false
    spendenFrage.value = null
    // Aus dem Menü: nur „schon gespendet" / „definitiv nicht" zählen
    if (!frage && antwort !== 'gespendet' && antwort !== 'nein') return
    try {
        await axios.post('/api/spenden/antwort', { art: frage?.art || 'menue', wert: frage?.wert, antwort })
    } catch { /* nächster Start fragt erneut */ }
}
