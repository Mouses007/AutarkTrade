/**
 * Grenzlinie des Momentum Radars aus den Einstellungen (`settings.momentumGrenze`)
 * — für die Route der Kachel/des Charts und den Alarm-Takt, damit alle drei
 * dieselben Punkte sehen. 30 s im Speicher; leer oder Lesefehler = Vorgabe 50.
 */
import { grenzeAus } from './momentum-radar.js'

let gemerkt = { wert: null, ts: 0 }
const MERKEN_MS = 30000

export async function leseMomentumGrenze() {
    if (gemerkt.wert != null && Date.now() - gemerkt.ts < MERKEN_MS) return gemerkt.wert
    let roh = null
    try {
        const { getKnex } = await import('./database.js')
        roh = (await getKnex()('settings').select('momentumGrenze').where('id', 1).first())?.momentumGrenze
    } catch { /* Spalte fehlt noch o. ä. → Vorgabe */ }
    gemerkt = { wert: grenzeAus(roh), ts: Date.now() }
    return gemerkt.wert
}

