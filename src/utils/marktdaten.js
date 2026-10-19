/**
 * Marktdatenquelle im Browser (Gegenstück zu `server/marktdaten/index.js`).
 *
 * Einmal je Seitenaufruf geladen und geteilt: Chart, Bookmap, Watchlist und
 * Live-Fenster fragen `kann('streams')` usw., statt Binance anzunehmen. Die
 * Browser-Streams (Bookmap, laufende Kerze, Watchlist-Kurse) verbinden direkt
 * zur Börse — darum muss auch der Browser die Wahl kennen.
 */
import { ref } from 'vue'
import axios from 'axios'

/** `{ wahl, name, faehigkeiten: [], fehlt: [], wahlen: [] }` — null bis geladen. */
export const marktdaten = ref(null)
let laden = null

export function ladeMarktdaten({ neu = false } = {}) {
    if (laden && !neu) return laden
    laden = axios.get('/api/marktdaten/quelle')
        .then((r) => { marktdaten.value = r.data; return r.data })
        .catch(() => {
            // Unbekannt ist nicht „aus": ohne Antwort bleibt alles, wie es war (Binance).
            marktdaten.value = { wahl: 'binance', name: 'Binance', faehigkeiten: null, fehlt: [] }
            return marktdaten.value
        })
    return laden
}

/** Kann die gewählte Quelle das? Unbekannt (noch nicht geladen) gilt als ja. */
export function kann(faehigkeit) {
    const m = marktdaten.value
    if (!m || !Array.isArray(m.faehigkeiten)) return true
    return m.faehigkeiten.includes(faehigkeit)
}

/** Wie `kann`, wartet aber auf die Antwort. */
export async function kannSicher(faehigkeit) {
    await ladeMarktdaten()
    return kann(faehigkeit)
}

/** Wahl speichern (Einstellungen). */
export async function setzeMarktdaten(wahl) {
    const r = await axios.put('/api/marktdaten/quelle', { wahl })
    marktdaten.value = r.data
    laden = Promise.resolve(r.data)
    return r.data
}

/** Antwortkörper im Stil von `{ aus: true, grund: 'marktdaten', … }` für eine fehlende Fähigkeit. */
export function ausFuer(faehigkeit) {
    const m = marktdaten.value || {}
    return { aus: true, grund: 'marktdaten', faehigkeit, quelle: m.wahl, quelleName: m.name }
}
