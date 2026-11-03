/**
 * Zuletzt gewählte Favoritenliste des Chart-Arbeitsplatzes. Ein Ref für alle
 * Watchlist-Ansichten (Seitenleiste, Schublade im Vollbild), gemerkt im
 * Browser: vorher hielt jede Ansicht die Wahl für sich und sprang bei jedem
 * Öffnen auf die erste Liste zurück.
 */
import { ref, watch } from 'vue'

const SCHLUESSEL = 'chartWatchlistAktiv'

function lese() {
    try {
        const n = Number(localStorage.getItem(SCHLUESSEL))
        return Number.isFinite(n) && n > 0 ? n : null
    } catch { return null }
}

export const watchlistWahl = ref(lese())

watch(watchlistWahl, (id) => {
    try {
        if (id == null) localStorage.removeItem(SCHLUESSEL)
        else localStorage.setItem(SCHLUESSEL, String(id))
    } catch { /* kein Speicher */ }
})
