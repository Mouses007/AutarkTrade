/**
 * Ein Feld der Einstellungen schreiben und `currentUser` im selben Takt
 * nachziehen.
 *
 * Hiess in Settings.vue `kiSpeichern` und behält den Namen, weil das Markup
 * vieler Sektionen ihn benutzt — obwohl er längst nicht nur KI-Felder schreibt
 * (Modi, Startseite, erweiterte Infos, Live-Trading am Telefon …).
 */
import { dbUpdateSettings } from '@/utils/db.js'
import { currentUser } from '@/stores/settings.js'

export async function kiSpeichern(feld, wert) {
    await dbUpdateSettings({ [feld]: wert })
    if (currentUser.value) currentUser.value[feld] = wert
}
