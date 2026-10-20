/**
 * Ein Feld der Einstellungen schreiben und `appEinstellungen` im selben Takt
 * nachziehen.
 *
 * Hiess in Einstellungen.vue `kiSpeichern` und behält den Namen, weil das Markup
 * vieler Sektionen ihn benutzt — obwohl er längst nicht nur KI-Felder schreibt
 * (Modi, Startseite, erweiterte Infos, Live-Trading am Telefon …).
 */
import { dbUpdateSettings } from '@/utils/db.js'
import { appEinstellungen } from '@/stores/settings.js'

export async function kiSpeichern(feld, wert) {
    await dbUpdateSettings({ [feld]: wert })
    if (appEinstellungen.value) appEinstellungen.value[feld] = wert
}
