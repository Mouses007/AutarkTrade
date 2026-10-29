/**
 * Anzeigewährung für Kosten: der wirksame Kurs USD → gewählte Währung, wie ihn
 * `GET /api/waehrung` liefert (`server/waehrung.js`). Null, solange nicht
 * geladen — dann rechnen die Formatierer mit dem gespeicherten Faktor.
 */
import { ref } from 'vue'
import axios from 'axios'

/** `{ code, faktor, quelle, datum }` oder null. */
export const anzeigeKurs = ref(null)

let nachTimer = null

/**
 * Neu holen, z. B. nach dem Start oder einem Währungswechsel. Wirft nie.
 * Antwortete der Server mit dem gemerkten Kurs, weil der Abruf zu lange
 * dauerte (`nachliefern`), wird einmal nachgefragt.
 */
export async function ladeAnzeigeKurs({ nachgefragt = false } = {}) {
    try {
        anzeigeKurs.value = (await axios.get('/api/waehrung')).data || null
    } catch {
        anzeigeKurs.value = null
    }
    clearTimeout(nachTimer)
    if (anzeigeKurs.value?.nachliefern && !nachgefragt) {
        nachTimer = setTimeout(() => ladeAnzeigeKurs({ nachgefragt: true }), 20000)
    }
    return anzeigeKurs.value
}
