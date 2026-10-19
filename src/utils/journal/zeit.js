/**
 * Die eine dayjs-Instanz der App, mit allen Plugins, die irgendwo gebraucht
 * werden. Locale bleibt die Vorgabe 'en' (Wochenbeginn Sonntag, englische
 * Monatsnamen) — Kalender und Perioden rechnen darauf.
 */
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import isoWeek from 'dayjs/plugin/isoWeek.js'
import timezone from 'dayjs/plugin/timezone.js'
import duration from 'dayjs/plugin/duration.js'
import updateLocale from 'dayjs/plugin/updateLocale.js'
import localizedFormat from 'dayjs/plugin/localizedFormat.js'
import customParseFormat from 'dayjs/plugin/customParseFormat.js'

for (const plugin of [utc, isoWeek, timezone, duration, updateLocale, localizedFormat, customParseFormat]) {
    dayjs.extend(plugin)
}

export default dayjs
