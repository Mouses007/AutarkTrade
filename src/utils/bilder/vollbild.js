/**
 * Bild-Vollbild (docs/spec/f3-screenshots.md §9): auswählen und öffnen in
 * einem Schritt, blättern über die geladene Liste, schliessen.
 */
import { klon } from '../bildmarkierung.js'
import { seitenId, listeZuEnde } from '../../stores/app/rahmen.js'
import { ladeMehr, bilderWerdenGeholt } from '../../stores/app/laden.js'
import { bilder, vollbildBild, vollbildIndex, vollbildOffen } from '../../stores/journal/bilder.js'
import { ladeBilderHaeppchen } from './laden.js'

const istListenIndex = (i) => Number.isInteger(i) && i >= 0

/**
 * Zeigt ein Bild im Vollbild. Mit Listenindex gilt der Listeneintrag (und
 * Blättern ist möglich), sonst die mitgegebenen Daten als Einzelbild.
 * Erst kopieren, dann die Auswahl leeren und füllen (A-S4) — so bleiben
 * keine Felder des vorigen Bildes stehen, und wer die Auswahl selbst
 * übergibt, verliert nichts.
 */
export function zeigeImVollbild(index, daten) {
    const mitListe = istListenIndex(index)
    const kopie = klon((mitListe ? bilder[index] : daten) || {}) || {}
    vollbildIndex.value = mitListe ? index : -1
    for (const k of Object.keys(vollbildBild)) delete vollbildBild[k]
    Object.assign(vollbildBild, kopie)
    vollbildOffen.value = true
    // Zwei vor dem Ende der Seite Bilder schon das nächste Häppchen holen
    if (mitListe && index >= 1 && index + 2 === bilder.length && !listeZuEnde.value
        && seitenId.value === 'bilder' && !bilderWerdenGeholt.value && !ladeMehr.value) {
        ladeBilderHaeppchen()
    }
}

export const kannVollbildZurueck = () => istListenIndex(vollbildIndex.value) && vollbildIndex.value - 1 >= 0
export const kannVollbildWeiter = () => istListenIndex(vollbildIndex.value) && !!bilder[vollbildIndex.value + 1]

/** Ein Bild vor (+1) oder zurück (−1); am Rand und beim Einzelbild nichts. */
export function blaettereVollbild(schritt) {
    if (schritt < 0 ? !kannVollbildZurueck() : !kannVollbildWeiter()) return
    zeigeImVollbild(vollbildIndex.value + schritt)
}

/** Schliessen lässt die Auswahl stehen. */
export function schliesseVollbild() {
    vollbildOffen.value = false
}
