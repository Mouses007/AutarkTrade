/**
 * Formatierer für Datum, Zeit, Dauer, Geld und Zahlen.
 *
 * Zeitwerte kommen als Sekunden und werden in der Handelszeitzone
 * (`timeZoneTrade`) dargestellt. Zahlen folgen der UI-Sprache aus
 * localStorage `appLanguage` (de → de-CH, en → en-US).
 */
import dayjs, { anzeige } from './zeit.js'
import { timeZoneTrade, currentUser } from '../../stores/app/rahmen.js'

// ── Kosten in der Anzeigewährung ───────────────────────────────────────────

/** Gültiger Umrechnungsfaktor aus den Einstellungen oder null. */
function waehrungsFaktor() {
    const f = Number(currentUser.value?.waehrungFaktor)
    return Number.isFinite(f) && f > 0 ? f : null
}

export function useKostenZahl(usd, stellen = 2) {
    const betrag = Number(usd)
    if (!Number.isFinite(betrag)) return (0).toFixed(stellen)
    const f = waehrungsFaktor()
    return (f === null ? betrag : betrag * f).toFixed(stellen)
}

export function useWaehrungCode() {
    return waehrungsFaktor() === null ? 'USD' : String(currentUser.value?.waehrungCode || 'CHF')
}

export function useKostenAnzeige(usd, stellen = 2) {
    const betrag = Number(usd)
    if (!Number.isFinite(betrag) || betrag === 0) return ''
    return useKostenZahl(usd, stellen) + ' ' + useWaehrungCode()
}

export function useVorlagenKategorieLabel(kategorie) {
    if (kategorie === 'win') return 'Gewinn'
    if (kategorie === 'loss') return 'Verlust'
    return kategorie
}

export function useCapitalizeFirstLetter(text) {
    return text.charAt(0).toUpperCase() + text.slice(1)
}

// ── Datum und Zeit (Sekunden, Handelszeitzone) ─────────────────────────────

const inZone = (sekunden) => dayjs.unix(sekunden).tz(timeZoneTrade.value)
const formatiere = (muster) => (sekunden) => inZone(sekunden).format(muster)

export const useDateCalFormat = formatiere('YYYY-MM-DD')
export const useDateCalFormatMonth = formatiere('YYYY-MM')
export const useTimeFormat = formatiere('HH:mm:ss')
export const useHourMinuteFormat = formatiere('HH:mm')
export const useDateTimeFormat = formatiere('YYYY-MM-DD HH:mm:ss')
export const useChartFormat = formatiere('D.M.YYYY')
// Mit Monats-/Tagesnamen: in der Sprache der Oberfläche
const formatiereAnzeige = (muster) => (sekunden) => anzeige(inZone(sekunden)).format(muster)
export const useMonthFormat = formatiereAnzeige('MMMM YYYY')
export const useCreatedDateFormat = formatiereAnzeige('ddd DD MMMM YYYY')

export function useStartOfDay(sekunden) {
    return inZone(sekunden).startOf('day').unix()
}

/** Dauer als HH:mm:ss (Stundenanteil der Zerlegung, nicht Gesamtstunden). */
export function useTimeDuration(sekunden) {
    return dayjs.duration(sekunden * 1000).format('HH:mm:ss')
}

/** Tagesanteil der Dauer mit „day"/„days". */
export function useSwingDuration(sekunden) {
    const tage = Number(dayjs.duration(sekunden * 1000).format('D'))
    return tage + ' ' + (tage > 1 ? 'days' : 'day')
}

// ── Zahlen ─────────────────────────────────────────────────────────────────

function zahlLocale() {
    let sprache = 'de'
    try { sprache = localStorage.getItem('appLanguage') || 'de' } catch { /* ohne Speicher */ }
    return sprache === 'en' ? 'en-US' : 'de-CH'
}

const zahl = (optionen) => (x) => new Intl.NumberFormat(zahlLocale(), optionen).format(x)
const usd = (stellen) => zahl({ style: 'currency', currency: 'USD', maximumFractionDigits: stellen })

export const useThousandCurrencyFormat = usd(0)
export const useTwoDecCurrencyFormat = usd(2)
export function useXDecCurrencyFormat(x, stellen) { return usd(stellen)(x) }
export const useThousandFormat = zahl({ maximumFractionDigits: 0 })
export const useTwoDecFormat = zahl({ maximumFractionDigits: 2 })
export function useXDecFormat(x, stellen) { return zahl({ maximumFractionDigits: stellen })(x) }
export const useOneDecPercentFormat = zahl({ style: 'percent', maximumFractionDigits: 1 })

/** Addition zweier Beträge über Hundertstel, gegen Gleitkomma-Reste. */
export function useDecimalsArithmetic(a, b) {
    const sechs = (x) => Number(Number(x).toFixed(6))
    return (sechs(a) * 100 + sechs(b) * 100) / 100
}
