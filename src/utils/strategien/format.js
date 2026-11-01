/**
 * Kleine Formatierer für den Strategien-Modus — eine Stelle statt einer Kopie
 * je Seite (bis 01.11.2026 hatte jede Agent-Seite ihre eigenen).
 */
import { formGeldStellen } from '../journal/format.js'
import dayjs from '../journal/zeit.js'

export const geld = (v) => formGeldStellen(Number(v) || 0, 2)

export const zahl = (v, n = 2) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? '–' : Number(v).toFixed(n))

/** „+0,42R" — mit Vorzeichen, damit ein Verlust nicht wie ein Gewinn aussieht. */
export const rText = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? '–' : `${Number(v) >= 0 ? '+' : ''}${Number(v).toFixed(2)}R`)

export const prozent = (v, n = 0) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? '–' : `${Number(v).toFixed(n)} %`)

export const zeit = (ms, format = 'DD.MM. HH:mm') => (Number(ms) > 0 ? dayjs(Number(ms)).format(format) : '–')

/** Klasse für Gewinn/Verlust; 0 und unbekannt bleiben neutral. */
export const tonVon = (v) => (Number(v) > 0 ? 'gewinnWert' : Number(v) < 0 ? 'verlustWert' : '')

/**
 * Ablehnungs- und Abbruchgründe übersetzen. Die Codes stehen als
 * `strategies.reason_<code>` in den Sprachdateien; unbekannte bleiben lesbar.
 */
export function grundText(t, te, code) {
    if (!code) return ''
    const schluessel = 'strategies.reason_' + code
    return te(schluessel) ? t(schluessel) : String(code).replace(/_/g, ' ')
}

/** Status eines Setups in Worten — eine Liste für Signale und Chart. */
export function statusText(t, status) {
    const s = ['waiting_retest', 'armed'].includes(status) ? 'wartend'
        : status === 'open' ? 'offen'
        : status === 'closed' ? 'geschlossen'
        : status === 'triggered' ? 'ausgeloest'
        : 'verworfen'
    return t('strategien.status.' + s)
}

/** Millisekunden einer Zeiteinheit — für „im Chart hinspringen". */
export const TF_MS = { '1m': 60000, '3m': 180000, '5m': 300000, '15m': 900000, '30m': 1800000, '1h': 3600000, '2h': 7200000, '4h': 14400000, '6h': 21600000, '8h': 28800000, '12h': 43200000, '1d': 86400000, '3d': 259200000, '1w': 604800000 }

/**
 * Zeitraum eines Labor-Formulars (Modus „tage" oder „datum") → { fromTs, toTs }
 * oder null, wenn er leer ist. „bis" endet am Tagesende, nie in der Zukunft.
 */
export function zeitraumVon(f) {
    if (f.zeitmodus === 'tage') {
        const toTs = Date.now()
        return { fromTs: toTs - Number(f.tage) * 86400000, toTs }
    }
    const fromTs = dayjs(f.von).valueOf()
    const toTs = Math.min(dayjs(f.bis).endOf('day').valueOf(), Date.now())
    return fromTs < toTs ? { fromTs, toTs } : null
}
