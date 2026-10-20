/**
 * Modus-Schalter (Live, Research, Strategie, Lernen) — Modul-Singleton.
 *
 * Geteilt, weil drei Sektionen sie lesen: Allgemein → Layout & Stil (die
 * Schalter selbst), KI → Strategie (Link nur bei aktivem Modus) und Live →
 * Live-Trading-Fenster. Einstellungen.vue lädt den Stand beim Öffnen der Seite
 * (`ladeModi`), bevor eine Bereichskomponente gemountet wird.
 */
import { ref } from 'vue'
import { MODES } from '@/config/menu.js'
import { appMode } from '@/stores/ui.js'
import { appEinstellungen } from '@/stores/settings.js'
import { kiSpeichern } from './speichern.js'

// Modi einzeln abschaltbar. Journal fehlt hier absichtlich: es ist der Kern
// der App und trägt in menu.js kein Flag.
export let modusLiveAn = ref(true)
export let modusResearchAn = ref(true)
export let modusStrategieAn = ref(true)
export let modusLernenAn = ref(true)

/** Stand aus den gerade geladenen Einstellungen übernehmen. */
export function ladeModi() {
    const settings = appEinstellungen.value || {}
        modusLiveAn.value = Number(settings.modusLiveAn ?? 1) === 1
        modusResearchAn.value = Number(settings.modusResearchAn ?? 1) === 1
        modusStrategieAn.value = Number(settings.modusStrategieAn ?? 1) === 1
        modusLernenAn.value = Number(settings.modusLernenAn ?? 1) === 1
}

/**
 * Modus-Schalter speichern.
 *
 * `kiSpeichern` schreibt die Datenbank und patcht `appEinstellungen` gleich mit —
 * der Tab verschwindet dadurch im selben Takt aus dem Umschalter, ohne Reload.
 *
 * Der zweite Teil räumt das Gedächtnis auf: Wer den Modus abschaltet, in dem
 * er gerade steht, hinterliesse sonst `appMode` im localStorage. Die
 * Einstellungen sind modusneutral (`meta.mode: 'any'`), also korrigiert der
 * Router das nicht — und der nächste Kaltstart zeigte einen Bildaufbau lang
 * das Menü eines Modus, den es nicht mehr gibt.
 *
 * KEIN localStorage-Spiegel für die Werte selbst: den braucht nur
 * `startseiteAn`, weil die Wurzel-Umleitung synchron entscheiden muss. Ein
 * Spiegel ohne synchronen Leser wäre eine zweite Wahrheit, die irgendwann
 * auseinanderläuft.
 */
export async function modusSpeichern(feld, an) {
    await kiSpeichern(feld, an ? 1 : 0)
    if (an) return
    const modus = MODES.find(m => m.flag === feld)?.id
    if (modus && appMode.value === modus) {
        appMode.value = 'journal'
        try { localStorage.setItem('appMode', 'journal') } catch (_) { /* egal */ }
    }
}
