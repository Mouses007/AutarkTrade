import { ref } from 'vue'

/**
 * Der Dialog „Rechtliches" (`components/rechtliches/Rechtliches.vue`) hängt einmal im
 * Layout. Von sich aus öffnet er sich nur, wenn eine Zustimmung fällig ist; zum Nachlesen
 * öffnen ihn Seitenmenü und Einstellungen über diesen Schalter.
 */
export const rechtlichesOffen = ref(false)
export const rechtlichesReiter = ref('lizenz')

export function oeffneRechtliches(reiter = 'lizenz') {
    rechtlichesReiter.value = reiter
    rechtlichesOffen.value = true
}
