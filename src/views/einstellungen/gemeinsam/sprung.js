/**
 * Sprung zu einem Abschnitt der Einstellungen.
 *
 * Ein Verweis landete bisher oben auf der Seite, und der gemeinte Abschnitt
 * war zugeklappt (Übersicht → X-Suche, Liq-Kachel → Aufzeichnung). Jetzt
 * trägt ein Abschnitt eine `kennung`; `springeZu(kennung)` klappt ihn auf und
 * rollt ihn ins Bild. Von aussen geht es über die Adresse:
 * `/einstellungen/<bereich>?abschnitt=<kennung>` (im KI-Bereich dazu
 * `&ki=<unter-reiter>`), das liest `Einstellungen.vue`.
 *
 * Modul-Singleton wie `useKiBereich.js`: Der Abschnitt kann erst gemountet
 * werden, NACHDEM gesprungen wurde (Reiter, die noch nie offen waren). Er
 * liest das Ziel deshalb beim Aufbau und löscht es, sobald er es angenommen hat.
 */
import { ref } from 'vue'

export const sprungZiel = ref('')

export function springeZu(kennung) {
    // Erst leeren: derselbe Sprung zweimal hintereinander muss wieder auslösen
    sprungZiel.value = ''
    if (kennung) queueMicrotask(() => { sprungZiel.value = String(kennung) })
}
