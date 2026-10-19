/**
 * Wache für einen laufenden KI-Bericht.
 *
 * Ein Bericht wird auf dem KI-Coach gestartet und braucht Minuten. Wer
 * währenddessen die Seite wechselt, soll trotzdem erfahren, dass er fertig ist:
 * solange `aiReportGenerating` steht, fragt die Wache alle 5 s die Berichtsliste
 * ab, und sobald sie länger ist als beim Start (`aiReportCountBefore`), geht
 * eine Benachrichtigung raus. Ob sie wirklich erscheint (Berechtigung, Tab im
 * Hintergrund, Kanal je Ereignis), entscheidet `sendNotification` selbst.
 *
 * Auf dem KI-Coach selbst schweigt die Wache — dort sieht man den Bericht
 * ohnehin entstehen. Beobachtet werden Bericht UND Seite, damit das Abfragen
 * auch dann anläuft, wenn man erst nach dem Start vom KI-Coach weggeht.
 *
 * Anders als früher wird das Intervall beim Abbau des Layouts mit abgeräumt.
 */
import { watch, onBeforeUnmount } from 'vue'
import axios from 'axios'
import { aiReportGenerating, aiReportCountBefore, aiReportLabel, currentUser } from '../stores/settings.js'
import { pageId } from '../stores/ui.js'
import { selectedBroker } from '../stores/filters.js'
import { sendNotification } from '../utils/notify.js'
import { logWarn } from '../utils/logger.js'

const TAKT_MS = 5000
const WARN_ABSTAND_MS = 15000

/**
 * @param {import('vue').Ref<boolean>} istJournal  nur im Journal wachen
 * @param {Function} t  Übersetzungsfunktion der aufrufenden Komponente
 */
export function useKiBerichtWache(istJournal, t) {
    let takt = null
    let letzteWarnung = 0

    function stoppe() {
        if (takt) { clearInterval(takt); takt = null }
    }

    async function frage() {
        try {
            // Gleicher Filter wie beim Zählen auf dem KI-Coach (nach Börse) —
            // sonst wäre die ungefilterte Liste sofort „länger" als vorher.
            const params = selectedBroker.value ? { broker: selectedBroker.value } : {}
            const { data } = await axios.get('/api/ai/reports', { params })
            const anzahl = Array.isArray(data) ? data.length : (data?.reports?.length ?? 0)
            if (anzahl > (aiReportCountBefore.value ?? 0)) {
                sendNotification('kiBerichtFertig', t('notifications.reportReady'),
                    t('notifications.reportCreated', { label: aiReportLabel.value || t('nav.zeitraumRueckfall') }))
                aiReportGenerating.value = false
                stoppe()
            }
        } catch (e) {
            // Kurze Ausfälle nicht in die Konsole spülen: höchstens alle 15 s.
            const jetzt = Date.now()
            if (jetzt - letzteWarnung > WARN_ABSTAND_MS) {
                letzteWarnung = jetzt
                logWarn('ki-bericht', 'Berichtsliste nicht erreichbar', e?.message || e)
            }
        }
    }

    const kiAn = () => currentUser.value?.aiEnabled !== false && currentUser.value?.aiEnabled !== 0

    watch([aiReportGenerating, pageId, istJournal], () => {
        const sollLaufen = aiReportGenerating.value && istJournal.value && pageId.value !== 'kiAgent' && kiAn()
        if (sollLaufen && !takt) takt = setInterval(frage, TAKT_MS)
        else if (!aiReportGenerating.value) stoppe()
    })

    onBeforeUnmount(stoppe)
}
