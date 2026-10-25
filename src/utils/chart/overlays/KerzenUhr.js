/**
 * Kerzen-Uhr: wie lange die laufende Kerze noch läuft, als Etikett auf der
 * Preisachse direkt unter der Kursmarke (wie TradingView).
 *
 * Das Ende rechnet sich aus der Öffnungszeit der letzten Kerze plus ihrer
 * Länge — nicht aus der Uhr gerastert: Wochenkerzen beginnen montags, und ein
 * Monat ist keine feste Länge. Liegt das Ende schon hinter uns (die nächste
 * Kerze ist noch nicht angekommen — Bitunix liefert die laufende Kerze nicht),
 * zählt die Uhr die nächste Kerze herunter statt einer negativen Zeit.
 *
 * `kerzenEnde`, `laufendesEnde` und `restzeitText` sind rein (Selbsttest
 * `src/utils/__selftest-kerzen-uhr.mjs`).
 */
/** Schluss der Kerze, die um `t` (ms, UTC) öffnete. */
export function kerzenEnde(t, ivMs, interval) {
    if (interval === '1M') {
        const d = new Date(t)
        return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
    }
    return t + ivMs
}

/** Ende der Kerze, die zur Zeit `jetzt` läuft — ab der Öffnung `t` der letzten bekannten Kerze. */
export function laufendesEnde(t, ivMs, interval, jetzt) {
    let ende = kerzenEnde(t, ivMs, interval)
    for (let n = 0; ende <= jetzt && n < 1000; n++) ende = kerzenEnde(ende, ivMs, interval)
    return ende
}

/** Restzeit als Text: „00:42", „04:59", „1:04:59", „3T 04:59". */
export function restzeitText(ms) {
    const s = Math.max(0, Math.floor(ms / 1000))
    const zwei = (n) => String(n).padStart(2, '0')
    const tage = Math.floor(s / 86400)
    const std = Math.floor((s % 86400) / 3600)
    const min = Math.floor((s % 3600) / 60)
    const sek = s % 60
    if (tage > 0) return `${tage}T ${zwei(std)}:${zwei(min)}`
    if (std > 0) return `${std}:${zwei(min)}:${zwei(sek)}`
    return `${zwei(min)}:${zwei(sek)}`
}

/** Höhe des Kursetiketts der Bibliothek bei Schriftgrösse 12 (gemessen) — die Uhr sitzt darunter. */
const ETIKETT_HOEHE = 19

export class KerzenUhr {
    /**
     * @param {object} serie   Kerzenserie (Lightweight Charts)
     * @param {object} o       { farbe, textFarbe }
     */
    constructor(serie, { farbe, textFarbe }) {
        this.serie = serie
        this.farbe = farbe
        this.textFarbe = textFarbe
        this.letzte = null
        this.ivMs = 0
        this.interval = ''
        this.requestUpdate = () => {}
        this.ansicht = {
            coordinate: () => {
                const y = this.letzte ? this.serie.priceToCoordinate(this.letzte.c) : null
                return y == null ? -100 : y + ETIKETT_HOEHE
            },
            text: () => (this.letzte ? restzeitText(laufendesEnde(this.letzte.t, this.ivMs, this.interval, Date.now()) - Date.now()) : ''),
            textColor: () => this.textFarbe,
            backColor: () => this.farbe,
            visible: () => !!this.letzte && this.ivMs > 0,
            tickVisible: () => false,
        }
        serie.attachPrimitive(this)
        // Jede Sekunde neu zeichnen — nur wenn es etwas zu zählen gibt.
        this.uhr = setInterval(() => { if (this.letzte && !document.hidden) this.requestUpdate() }, 1000)
    }

    attached({ requestUpdate }) { this.requestUpdate = requestUpdate }
    detached() { this.requestUpdate = () => {} }
    updateAllViews() {}
    priceAxisViews() { return [this.ansicht] }

    /** Letzte Kerze ({t, c} in ms) und Zeiteinheit setzen; null blendet die Uhr aus. */
    setze(letzte, ivMs, interval) {
        this.letzte = letzte && Number.isFinite(letzte.t) && Number.isFinite(letzte.c) ? { t: letzte.t, c: letzte.c } : null
        this.ivMs = ivMs || 0
        this.interval = interval || ''
        this.requestUpdate()
    }

    abbauen() {
        clearInterval(this.uhr)
        try { this.serie.detachPrimitive(this) } catch { /* Chart schon weg */ }
    }
}
