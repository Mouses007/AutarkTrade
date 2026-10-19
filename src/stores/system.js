/**
 * Betriebsart des Servers (`GET /api/system/modus`).
 *
 * `testbetrieb` ist true, wenn der Server mit AT_TESTBETRIEB=1 läuft — gegen
 * eine Kopie der Live-DB, ohne Hintergrund-Takte, Mails und Push. Die
 * Oberfläche zeigt dann ein Banner und schaltet eigene Automatiken ab, die
 * bezahlte KI-Aufrufe auslösen (z. B. die Handelslage im Takt).
 */
import { ref } from 'vue'
import axios from 'axios'

export const testbetrieb = ref(false)
let geladen = null

export function ladeSystemModus() {
    if (!geladen) {
        geladen = axios.get('/api/system/modus')
            .then((r) => { testbetrieb.value = !!r.data?.testbetrieb })
            .catch(() => { geladen = null })
    }
    return geladen
}
