/**
 * Der Strategien-Modus im Aktien-Markt (Aktien-Integration, Phase 6).
 *
 * Labor, Instanzen und Regel-Editor gaben `BTCUSDT` vor und kannten nur freie
 * Textfelder. Im Aktien-Markt beginnt dieselbe Oberfläche mit einem
 * Aktien-Future und bietet die Aktien-Suche an; die Instanz-Listen zeigen nur
 * die Instanzen des aktiven Markts.
 *
 * Eine Abfrage je Seitenaufruf, alle Komponenten teilen sie sich.
 */
import { ref } from 'vue'
import { ermittleMarkt } from '../../stores/markt.js'
import { ladeMarktdaten } from '../marktdaten.js'
import { ladeAktienSymbole, standardAktien, vorzug } from '../chart/aktienSymbole.js'
import { vorgabeBoerse, waehlbareBoersen } from '../chart/kerzenQuelle.js'

/** Vorgaben des Krypto-Markts — so stand es bisher fest im Code. */
export const KRYPTO = { symbol: 'BTCUSDT', symbole: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'] }

/** Vorgaben für einen Markt aus der Liste der ladbaren Aktien (rein). */
export function vorgabenFuer(markt, aktienListe = [], boersen = []) {
    if (markt !== 'aktien') return { markt: 'krypto', ...KRYPTO }
    const start = standardAktien(aktienListe, boersen)
    return { markt: 'aktien', symbol: start.panel.symbol, symbole: start.watchlist.slice(0, 3).map((s) => s.symbol) }
}

/** `krypto` | `aktien` — bis die Antwort da ist `krypto`, also das bisherige Verhalten. */
export const strategieMarkt = ref('krypto')
let laden = null

/** @returns {Promise<{markt: string, symbol: string, symbole: string[]}>} */
export function ladeStrategieMarkt() {
    if (!laden) {
        laden = (async () => {
            const markt = await ermittleMarkt()
            if (markt !== 'aktien') return vorgabenFuer('krypto')
            await ladeMarktdaten()
            const v = vorgabenFuer('aktien', await ladeAktienSymbole(), vorzug(vorgabeBoerse(), waehlbareBoersen()))
            strategieMarkt.value = 'aktien'
            return v
        })().catch(() => vorgabenFuer('krypto'))
    }
    return laden
}
