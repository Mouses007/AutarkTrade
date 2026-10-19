/*
 * Modul-Singleton, weil nicht nur die Reiterreihe den Unter-Reiter wechselt:
 * KI → Allgemein verlinkt auf „Bilder", die Übersicht auf jeden Reiter.
 */
import { ref } from 'vue'

/**
 * Zweite Reiter-Ebene im KI-Bereich.
 *
 * Die KI-Einstellungen lagen über drei obere Reiter verstreut: Zugang und
 * Berichte unter „KI", die Strategie-Agenten unter „Agent", der ganze
 * Lagebericht unter „Live" beim Marktradar. Wer einen Schlüssel eintrug und
 * dann den Bericht einstellen wollte, suchte zwei Bildschirme weiter.
 *
 * Jetzt: ein Ort, darin je Funktion ein Reiter. Der frühere obere Reiter
 * „Agent" ist deshalb entfallen.
 */
// `symbol` = Name in components/basis/Symbol.vue.
export const KI_BEREICHE = [
    // Ganz vorn: die Frage „was läuft hier eigentlich und was kostet es" kommt
    // vor jeder einzelnen Einstellung.
    { id: 'uebersicht', symbol: 'auge' },
    { id: 'allgemein', symbol: 'schluessel' },
    { id: 'berichte', symbol: 'dokument' },
    { id: 'nachrichten', symbol: 'zeitung' },
    { id: 'agent', symbol: 'agent' },
    { id: 'strategie', symbol: 'chart' },
    { id: 'bilder', symbol: 'bild' },
]
export const kiBereich = ref(localStorage.getItem('settingsKiBereich') || 'allgemein')
export function kiBereichWechseln(id) {
    kiBereich.value = id
    localStorage.setItem('settingsKiBereich', id)
}
