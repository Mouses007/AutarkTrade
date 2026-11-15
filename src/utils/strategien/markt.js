/**
 * Der Strategien-Modus im Aktien-Markt (Aktien-Integration, Phase 6).
 *
 * Labor, Instanzen und Regel-Editor gaben `BTCUSDT` vor und kannten nur freie
 * Textfelder. Im Aktien-Markt beginnt dieselbe Oberfläche mit einem
 * Aktien-Future und bietet die Aktien-Suche an; die Instanz-Listen zeigen nur
 * die Instanzen des aktiven Markts.
 *
 * Eine Abfrage je Seitenaufruf, alle Komponenten teilen sie sich.
 *
 * `filter` im Ergebnis ist der Markt als Listen-Filter (`?markt=`): `krypto` |
 * `aktien`, oder `''`, solange der Aktien-Teil aus ist — dann wird nichts
 * getrennt und keine Liste versteckt etwas hinter einem Schalter, den es nicht
 * gibt. Instanz-, Signal- und Läufe-Listen fragen damit; die Bibliothek und der
 * Regel-Editor lesen alle Instanzen und teilen selbst (`zaehleInstanzen`), weil
 * eine Strategie beiden Märkten gehört und eine Regeländerung beide trifft.
 */
import { ref } from 'vue'
import { ermittleMarkt, ermittleMarktFilter } from '../../stores/markt.js'
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

/** Abfrage-Parameter `{ markt }` für eine Liste — leer ohne Filter. */
export function marktParams(filter) {
    return filter === 'krypto' || filter === 'aktien' ? { markt: filter } : {}
}

/** Gehört die Instanz zum ANDEREN Markt? Ohne Filter nie; ohne Angabe ist sie Krypto. */
export function istAndererMarkt(instanz, filter) {
    if (filter !== 'krypto' && filter !== 'aktien') return false
    return (instanz?.anlageklasse === 'aktien' ? 'aktien' : 'krypto') !== filter
}

/**
 * Laufende (nicht archivierte) Instanzen einer Strategie, geteilt nach Markt.
 * @returns {{eigene: object[], andere: object[]}}  ohne Filter stehen alle in `eigene`
 */
export function zaehleInstanzen(instanzen, strategyId, filter) {
    const alle = (instanzen || []).filter((i) => i.strategyId === strategyId && !Number(i.archiviert))
    return { eigene: alle.filter((i) => !istAndererMarkt(i, filter)), andere: alle.filter((i) => istAndererMarkt(i, filter)) }
}

/** @returns {Promise<{markt: string, filter: string, symbol: string, symbole: string[]}>} */
export function ladeStrategieMarkt() {
    if (!laden) {
        laden = (async () => {
            const [markt, filter] = await Promise.all([ermittleMarkt(), ermittleMarktFilter()])
            if (markt !== 'aktien') return { ...vorgabenFuer('krypto'), filter }
            await ladeMarktdaten()
            const v = vorgabenFuer('aktien', await ladeAktienSymbole(), vorzug(vorgabeBoerse(), waehlbareBoersen()))
            strategieMarkt.value = 'aktien'
            return { ...v, filter }
        })().catch(() => ({ ...vorgabenFuer('krypto'), filter: '' }))
    }
    return laden
}
