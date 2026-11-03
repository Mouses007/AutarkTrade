/**
 * Übergeordneter Trend für die KI-Analyse im Chart (Häkchen „Übergeordneten
 * Trend einschliessen", 03.11.2026): höchstens EINE Trendlinie aus einer
 * höheren Zeiteinheit — bevorzugt der Tageschart, der 4h- oder Wochenchart,
 * wenn er die Richtung besser belegt.
 *
 * Pur: Kerzen rein, Linie raus. Die Linie ist dieselbe Vermessung wie die
 * T-Kandidaten (`kandidatenTrendlinien`), nur auf den Kerzen der höheren
 * Zeiteinheit, und muss zur Struktur passen: Aufwärtstrend (HH/HL bis zum
 * Bruch, `trendZustand`) → steigende Unterstützung, Abwärtstrend → fallender
 * Widerstand. Ohne bestätigte Richtung oder ohne passende Linie gibt es keine
 * Zeichnung — eine geratene Trendlinie wäre schlimmer als keine.
 */
import { kandidatenTrendlinien, marktstruktur, zahl } from './chart-kandidaten.js'
import { letzteAtr } from './chart-trendlinien.js'

export const HTF_TREND_KERZEN = 200

/** Welche höheren Zeiteinheiten für den Chart in Frage kommen, in der Reihenfolge der Vorliebe. */
export function htfTrendKandidaten(interval) {
    if (['1m', '3m', '5m', '15m', '30m', '1h', '2h'].includes(interval)) return ['1d', '4h', '1w']
    if (['4h', '6h', '8h', '12h'].includes(interval)) return ['1d', '1w']
    if (['1d', '3d'].includes(interval)) return ['1w']
    return []
}

/** Eine Zeiteinheit vermessen: Strukturrichtung und die dazu passende Trendlinie (oder null). */
export function trendAuf(kerzen) {
    if (!Array.isArray(kerzen) || kerzen.length < 30) return null
    const A = letzteAtr(kerzen)
    if (!(A > 0)) return null
    const zustand = marktstruktur(kerzen).zustand
    const seite = zustand === 1 ? 'tief' : zustand === -1 ? 'hoch' : null
    const richtung = zustand === 1 ? 'auf' : 'ab'
    const linie = seite
        ? kandidatenTrendlinien(kerzen, A).filter((l) => l.seite === seite && l.richtung === richtung && !l.gegen)
            .sort((a, b) => b.beruehrungen - a.beruehrungen || Math.abs(a.abstandAtr) - Math.abs(b.abstandAtr))[0] || null
        : null
    return { zustand, linie, atr: A }
}

/**
 * Den übergeordneten Trend wählen. `serien` = { tf: kerzen }. Bevorzugt die
 * erste Zeiteinheit der Liste, sobald ihre Linie mindestens drei Berührungen
 * hat; sonst die Linie mit den meisten Berührungen (bei Gleichstand die
 * bevorzugte). `bisT`/`ivMs` des Charts verlängern die Linie bis knapp hinter
 * die letzte Chartkerze statt um Tage oder Wochen der höheren Zeiteinheit.
 *
 * @returns {{tf, zustand, linie}|null} null = keine höhere Zeiteinheit vorgesehen
 */
export function uebergeordneterTrend(serien, interval, { bisT = null, ivMs = null } = {}) {
    const liste = htfTrendKandidaten(interval)
    if (!liste.length) return null
    const gemessen = liste.map((tf) => ({ tf, ...(trendAuf(serien?.[tf]) || { zustand: 0, linie: null }) }))
    const mitLinie = gemessen.filter((g) => g.linie)
    let wahl = gemessen.find((g) => g.linie && g.linie.beruehrungen >= 3 && g.tf === liste[0])
    if (!wahl && mitLinie.length) wahl = [...mitLinie].sort((a, b) => b.linie.beruehrungen - a.linie.beruehrungen || liste.indexOf(a.tf) - liste.indexOf(b.tf))[0]
    if (!wahl) {
        // Keine Linie: die Richtung der bevorzugten Zeiteinheit trotzdem nennen
        const g = gemessen.find((x) => x.zustand !== 0) || gemessen[0]
        return { tf: g.tf, zustand: g.zustand, linie: null }
    }
    const l = { ...wahl.linie }
    if (Number.isFinite(bisT) && ivMs > 0 && l.t2 > l.t1) {
        const proMs = (l.p2 - l.p1) / (l.t2 - l.t1)
        l.tEnde = Math.max(l.t2, bisT + 10 * ivMs)
        l.pEnde = l.p1 + proMs * (l.tEnde - l.t1)
    }
    return { tf: wahl.tf, zustand: wahl.zustand, linie: l }
}

const TF_NAME = { '4h': '4H', '1d': '1D', '1w': '1W' }

/** Beschriftung der Linie im Chart. */
export function htfTrendLabel(h, englisch = false) {
    const tf = TF_NAME[h.tf] || h.tf
    const l = h.linie
    if (englisch) return `Higher trend ${tf}: ${l.richtung === 'auf' ? 'rising support' : 'falling resistance'} (${l.beruehrungen} touches)`
    return `Übergeordneter Trend ${tf}: ${l.richtung === 'auf' ? 'steigende Unterstützung' : 'fallender Widerstand'} (${l.beruehrungen} Berührungen)`
}

/** Eine Zeile für das Modell: was der Code gemessen hat (das Modell wählt hier nichts). */
export function htfTrendZeile(h, kurs, englisch = false) {
    if (!h) return ''
    const tf = TF_NAME[h.tf] || h.tf
    const richtung = h.zustand === 1 ? (englisch ? 'uptrend' : 'Aufwärtstrend') : h.zustand === -1 ? (englisch ? 'downtrend' : 'Abwärtstrend') : (englisch ? 'no confirmed direction' : 'keine bestätigte Richtung')
    if (!h.linie) return englisch ? `HIGHER TREND (${tf}): ${richtung}, no trendline that fits it.` : `ÜBERGEORDNETER TREND (${tf}): ${richtung}, keine dazu passende Trendlinie.`
    const l = h.linie
    const lage = kurs > l.wertJetzt ? (englisch ? 'above' : 'über') : (englisch ? 'below' : 'unter')
    return englisch
        ? `HIGHER TREND (${tf}): ${richtung}; ${htfTrendLabel(h, true)}, now at ${zahl(l.wertJetzt)}; price ${lage} the line (${Math.abs(l.abstandAtr).toFixed(1)} ${tf} ATR). The code draws this line itself; mention it in the text where it matters.`
        : `ÜBERGEORDNETER TREND (${tf}): ${richtung}; ${htfTrendLabel(h)}, jetzt bei ${zahl(l.wertJetzt)}; Kurs ${lage} der Linie (${Math.abs(l.abstandAtr).toFixed(1)} ATR des ${tf}). Der Code zeichnet diese Linie selbst; erwähne sie im Text, wo sie für die Lage zählt.`
}
