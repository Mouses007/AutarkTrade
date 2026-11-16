/**
 * Zahlen- und Datumsformate der Coin-Ansicht — dieselbe Schreibweise wie die
 * Aktien-Titel-Seite (`components/aktien/TitelAnsicht.vue`): nach der Sprache
 * der Oberfläche, Unbekanntes als «—».
 *
 * `null`, `undefined`, `''` und alles Unlesbare sind «—», nie «0»: eine Null
 * wäre eine Messung.
 */
import { useI18n } from 'vue-i18n'
import { preisStellen } from '../utils/coinAnsicht.js'

const fehlt = (v) => v === null || v === undefined || v === '' || !Number.isFinite(Number(v))

export function useCoinFormat() {
    const { locale } = useI18n()

    const zahl = (v, n = 2) => (fehlt(v) ? '—' : Number(v).toLocaleString(locale.value, { minimumFractionDigits: n, maximumFractionDigits: n }))
    /** Kurs mit so vielen Stellen, wie er braucht (0,0000042 bleibt lesbar). */
    const kurs = (v) => (fehlt(v) ? '—' : zahl(v, preisStellen(v)))
    const prozent = (v, n = 2) => (fehlt(v) ? '—' : `${Number(v) > 0 ? '+' : ''}${zahl(v, n)} %`)
    const anteil = (v, n = 1) => (fehlt(v) ? '—' : `${zahl(v, n)} %`)
    /** Grosse Beträge und Mengen kompakt (1,2 Mrd.). */
    const gross = (v, n = 2) => (fehlt(v) ? '—' : new Intl.NumberFormat(locale.value, { notation: 'compact', maximumFractionDigits: n }).format(Number(v)))
    const usd = (v, n = 2) => (fehlt(v) ? '—' : `${gross(v, n)} USD`)
    const datum = (ms) => (ms ? new Date(Number(ms)).toLocaleDateString(locale.value, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—')
    const tagMonat = (ms) => (ms ? new Date(Number(ms)).toLocaleDateString(locale.value, { day: '2-digit', month: '2-digit' }) : '—')
    const zeit = (ms) => (ms ? new Date(Number(ms)).toLocaleString(locale.value, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—')
    const uhr = (ms) => (ms ? new Date(Number(ms)).toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit' }) : '—')
    /** `auf` / `ab` / `''` — Grün und Rot nur für das Vorzeichen einer Veränderung. */
    const richtung = (v) => (fehlt(v) || Number(v) === 0 ? '' : Number(v) > 0 ? 'auf' : 'ab')

    return { zahl, kurs, prozent, anteil, gross, usd, datum, tagMonat, zeit, uhr, richtung, fehlt }
}
