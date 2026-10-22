import { ref } from 'vue'

/**
 * Der Dialog „Rechtliches" (`components/rechtliches/Rechtliches.vue`) hängt einmal in
 * `App.vue`. Von sich aus öffnet er sich nur, wenn eine Zustimmung fällig ist; zum Nachlesen
 * öffnen ihn Seitenmenü und Einstellungen über diesen Schalter.
 */
export const rechtlichesOffen = ref(false)
export const rechtlichesReiter = ref('haftung')

export function oeffneRechtliches(reiter = 'haftung') {
    rechtlichesReiter.value = reiter
    rechtlichesOffen.value = true
}
