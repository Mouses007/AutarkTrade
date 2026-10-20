/**
 * Router von AutarkTrade.
 *
 * Die Tabelle steht in `./routen.js`. Hier nur, was bei jedem Seitenwechsel
 * geschieht (in dieser Reihenfolge):
 *
 *   1. Dokumenttitel setzen — auch für Ziele, die gleich umgeleitet werden.
 *   2. Setup nicht abgeschlossen → /setup; Update-Assistent ausstehend →
 *      /update-assistent. Der Status kommt einmal pro Seitenleben vom Server.
 *   3. Den Modus aus der Route ableiten. Die Route ist die Wahrheit, `appMode`
 *      nur das Gedächtnis: ein Deep-Link auf /liquidity schaltet still auf
 *      „live", damit das Seitenmenü schon beim ersten Zeichnen stimmt.
 *
 * Bewusst NICHT hier: die Wache für abgeschaltete Modi. Beim kalten Deep-Link
 * sind die Einstellungen noch nicht geladen, ein Router-Hook müsste raten.
 * Sie sitzt im Layout (`layouts/Rahmen.vue`), das warten kann.
 */
import { createRouter, createWebHistory } from 'vue-router'
import axios from 'axios'
import i18n from '../i18n'
import { appMode } from '../stores/ui.js'
import { routen } from './routen.js'

const APP_NAME = 'AutarkTrade'

const router = createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    routes: routen,
})

function setzeDokumentTitel(to) {
    const key = to.meta?.titleKey
    let titel = ''
    if (key && i18n.global.te(key)) titel = i18n.global.t(key)
    else titel = to.meta?.title || ''
    document.title = titel ? `${titel} · ${APP_NAME}` : APP_NAME
}

/*
 * Setup- und Update-Status: ein Aufruf liefert beides, damit der Start keinen
 * zweiten Roundtrip kostet. Gemerkt für die ganze Lebensdauer der Seite — der
 * Update-Assistent endet mit einem harten Neuladen, also wird danach frisch
 * gefragt und es braucht keinen Schutz gegen eine Umleitungsschleife.
 * Ein alter Server ohne den Endpunkt gilt als fertig eingerichtet.
 */
let statusAnfrage = null
function holeEinrichtungsStatus() {
    if (!statusAnfrage) {
        statusAnfrage = axios.get('/api/setup/status')
            .then(({ data }) => ({
                setupFertig: data?.setupComplete !== false,
                updateOffen: !!data?.updateAssistantPending,
            }))
            .catch(() => ({ setupFertig: true, updateOffen: false }))
    }
    return statusAnfrage
}

/** Welcher Modus gehört zu dieser Route? `any`/`uebersicht` lassen den gemerkten stehen. */
function modusDerRoute(to) {
    const m = to.meta?.mode
    if (m === 'any' || m === 'uebersicht') return appMode.value
    return m || 'journal'
}

router.beforeEach(async (to) => {
    setzeDokumentTitel(to)

    if (to.meta?.skipSetupCheck) return true

    const { setupFertig, updateOffen } = await holeEinrichtungsStatus()
    if (!setupFertig) return '/setup'
    if (updateOffen && !to.meta?.skipUpdateCheck) return '/update-assistent'

    const modus = modusDerRoute(to)
    if (modus && modus !== appMode.value) {
        appMode.value = modus
        try { localStorage.setItem('appMode', modus) } catch { /* privater Modus */ }
    }
    return true
})

export default router
