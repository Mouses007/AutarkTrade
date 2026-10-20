/**
 * Die eine dayjs-Instanz der App, mit allen Plugins, die irgendwo gebraucht
 * werden. Locale bleibt die Vorgabe 'en' (Wochenbeginn Sonntag) — Kalender
 * und Perioden rechnen darauf, der Golden Master hält es fest.
 *
 * Nur zum ANZEIGEN von Monats- und Tagesnamen gibt es `anzeige(d)`: dieselbe
 * Zeit in der Sprache der Oberfläche („Oktober 2026" statt „October 2026",
 * Audit A4-13). Die Sprache setzt `src/i18n/index.js`; solange niemand sie
 * setzt (Selbsttests), bleibt es Englisch.
 */
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import isoWeek from 'dayjs/plugin/isoWeek.js'
import timezone from 'dayjs/plugin/timezone.js'
import duration from 'dayjs/plugin/duration.js'
import updateLocale from 'dayjs/plugin/updateLocale.js'
import localizedFormat from 'dayjs/plugin/localizedFormat.js'
import customParseFormat from 'dayjs/plugin/customParseFormat.js'
import 'dayjs/locale/de.js'

for (const plugin of [utc, isoWeek, timezone, duration, updateLocale, localizedFormat, customParseFormat]) {
    dayjs.extend(plugin)
}

let anzeigeSprache = 'en'

/** Sprache der Oberfläche für Monats- und Tagesnamen ('de' | 'en'). */
export function setzeAnzeigeSprache(sprache) {
    anzeigeSprache = sprache === 'de' ? 'de' : 'en'
}

/** Kopie von `d` in der Sprache der Oberfläche — nur zum Formatieren. */
export const anzeige = (d) => d.locale(anzeigeSprache)

export default dayjs
