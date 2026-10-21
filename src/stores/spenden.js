import { ref } from 'vue'
import axios from 'axios'

/**
 * Spenden-Dialog (`components/rahmen/SpendenDialog.vue`, hängt einmal in `App.vue`).
 * `frage` = null (aus dem Menü geöffnet) oder 1/2 (Nachfrage nach 50 bzw. 200
 * bewerteten Trades, siehe `server/spenden.js`).
 */
export const spendenOffen = ref(false)
export const spendenFrage = ref(null)

export function oeffneSpenden(frage = null) {
    spendenFrage.value = frage
    spendenOffen.value = true
}

/** Beim Start einmal fragen, ob eine Nachfrage fällig ist. */
export async function pruefeSpendenFrage() {
    try {
        const { data } = await axios.get('/api/spenden/stand')
        if (data?.faellig) oeffneSpenden(data.faellig)
    } catch { /* ohne Antwort: nicht nachfragen */ }
}

/** Nachfrage erledigt (egal wie) — der Server schaltet die Stufe weiter. */
export async function spendenFrageErledigt() {
    const frage = spendenFrage.value
    spendenOffen.value = false
    spendenFrage.value = null
    if (!frage) return
    try { await axios.post('/api/spenden/beantwortet', { frage }) } catch { /* nächster Start fragt erneut */ }
}
