/**
 * Merkliste Aktien: welche Ticker einen Stern tragen. Ein Ref für alle Seiten
 * (Aktien-Radar, Newcomer-Radar, Titel-Seite, Favoriten) — der Stern, den man
 * auf der einen setzt, steht auf der anderen schon da.
 *
 * Die Wahrheit liegt beim Server (`/api/aktien/favoriten`, Tabelle
 * `aktien_favoriten`); hier nur der gelesene Stand.
 */
import { ref } from 'vue'
import axios from 'axios'

/** Ticker mit Stern. `null` = noch nicht geladen. */
export const aktienFavoriten = ref(null)
/** Zählt jede Änderung — die Favoriten-Seite lädt daraufhin ihre Liste neu. */
export const aktienFavoritenStand = ref(0)

let anfrage = null

/** Einmal laden; `neu` erzwingt den Abruf. Ein Fehler lässt den alten Stand stehen. */
export function ladeAktienFavoriten(neu = false) {
    if (aktienFavoriten.value && !neu) return Promise.resolve(aktienFavoriten.value)
    if (!anfrage) {
        anfrage = axios.get('/api/aktien/favoriten/ticker')
            .then(({ data }) => { aktienFavoriten.value = new Set(data?.ticker || []) })
            .catch(() => { if (!aktienFavoriten.value) aktienFavoriten.value = new Set() })
            .finally(() => { anfrage = null })
    }
    return anfrage
}

export const istAktienFavorit = (ticker) => !!aktienFavoriten.value?.has(ticker)

/**
 * Stern setzen oder nehmen. Wirft bei einem Fehler (die Seite zeigt ihn);
 * der Stand wird erst nach der Antwort des Servers geändert.
 * @returns {Promise<boolean>} trägt der Ticker danach einen Stern?
 */
export async function schalteAktienFavorit(ticker) {
    await ladeAktienFavoriten()
    const an = !istAktienFavorit(ticker)
    if (an) await axios.post('/api/aktien/favoriten', { ticker })
    else await axios.delete(`/api/aktien/favoriten/${encodeURIComponent(ticker)}`)
    const neu = new Set(aktienFavoriten.value)
    if (an) neu.add(ticker)
    else neu.delete(ticker)
    aktienFavoriten.value = neu
    aktienFavoritenStand.value++
    return an
}
