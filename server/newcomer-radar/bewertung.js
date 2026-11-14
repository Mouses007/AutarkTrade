/**
 * Bewertung des Newcomer-Radars (rein, ohne Netz).
 *
 * Drei Teil-Noten 0–100, jede darf fehlen:
 *   neuheit      wie jung ist die Firma an der Börse (bzw. die Listung an unseren Börsen)
 *   momentum     Nähe zum 52-Wochen-Hoch, 3-Monats-Rendite, Stärke gegen den Index, über dem 50-Tage-Schnitt
 *   beteiligung  relatives Volumen der letzten 5 Tage
 *
 * Regeln wie im Coin- und Hype-Radar:
 *   - Unbekannt wird nie als gut gewertet: eine fehlende Teil-Note fällt aus
 *     dem Nenner, sie zählt nicht als 50.
 *   - Eine Gesamtnote gibt es nur, wenn das Momentum gemessen ist und
 *     mindestens eine weitere Teil-Note (`belastbar`). Eine Note aus der
 *     Neuheit allein wäre für jeden frischen Börsengang 100.
 *   - Liquidität ist eine Hürde, keine Teil-Note. Wer sie reisst, behält
 *     seine Kennzahlen, steht aber nicht in der Rangliste (`zugelassen`).
 *
 * Bewusst keine Wachstums- und keine Qualitäts-Note: dafür fehlen in der
 * kostenlosen Fassung die Fundamentaldaten (`docs/PLAN-AKTIEN.md`).
 */

const TAG_MS = 86400e3

export const GEWICHTE = { neuheit: 35, momentum: 45, beteiligung: 20 }
export const BOERSENGANG_TAGE = 730        // «junger Börsengang» = höchstens zwei Jahre
export const NEU_GELISTET_TAGE = 45        // frisch an einer unserer Börsen
export const HUERDEN = { minKurs: 1, minUmsatz20: 1_000_000 }

const klemme = (x) => Math.max(0, Math.min(100, x))
/** Gerade durch zwei Punkte, auf 0–100 begrenzt. */
const linie = (x, x0, y0, x1, y1) => klemme(y0 + ((x - x0) / (x1 - x0)) * (y1 - y0))
const schnitt = (werte) => {
    const da = werte.filter((w) => w != null)
    return da.length ? da.reduce((s, w) => s + w, 0) / da.length : null
}

/** Früheste Listung an einer Börse, die ein Datum nennt (ms) — oder null. */
export function fruehesteListung(listungen = []) {
    const zeiten = listungen.map((l) => Number(l.gelistetSeit)).filter((t) => Number.isFinite(t) && t > 0)
    return zeiten.length ? Math.min(...zeiten) : null
}

/** Jüngste Listung an einer Börse, die ein Datum nennt (ms) — oder null. */
export function juengsteListung(listungen = []) {
    const zeiten = listungen.map((l) => Number(l.gelistetSeit)).filter((t) => Number.isFinite(t) && t > 0)
    return zeiten.length ? Math.max(...zeiten) : null
}

export function noteNeuheit(alterTage, listungVorTagen, unterart) {
    if (unterart === 'vorboerslich') return 100
    let note = null
    if (alterTage != null) {
        if (alterTage <= 90) note = 100
        else if (alterTage <= BOERSENGANG_TAGE) note = linie(alterTage, 90, 100, BOERSENGANG_TAGE, 40)
        else note = linie(alterTage, BOERSENGANG_TAGE, 40, 5 * 365, 0)
    }
    // Frisch bei uns handelbar zählt, auch wenn die Firma alt ist — aber weniger als ein Börsengang.
    if (listungVorTagen != null && listungVorTagen <= NEU_GELISTET_TAGE) note = Math.max(note ?? 0, 70)
    return note
}

export function noteMomentum(k) {
    return schnitt([
        k.abstandHochPct != null ? linie(k.abstandHochPct, -30, 0, 0, 100) : null,
        k.perf3m != null ? linie(k.perf3m, -20, 0, 40, 100) : null,
        k.relStaerke3m != null ? linie(k.relStaerke3m, -15, 0, 25, 100) : null,
        k.ueberSma50 != null ? (k.ueberSma50 ? 100 : 0) : null,
    ])
}

export function noteBeteiligung(rvol) {
    if (rvol == null) return null
    if (rvol <= 1) return linie(rvol, 0.5, 0, 1, 40)
    if (rvol <= 2) return linie(rvol, 1, 40, 2, 80)
    return linie(rvol, 2, 80, 3, 100)
}

export function kategorie(k, listungVorTagen, unterart) {
    if (unterart === 'vorboerslich') return 'vorboerslich'
    if (k.alterTage != null && k.alterTage <= BOERSENGANG_TAGE) return 'boersengang'
    if (listungVorTagen != null && listungVorTagen <= NEU_GELISTET_TAGE) return 'neuGelistet'
    return k.alterTage != null ? 'etabliert' : 'unbekannt'
}

/** Gerissene Hürden; unbekannte Liquidität ist auch eine. */
export function huerden(k) {
    const liste = []
    if (k.kurs != null && k.kurs < HUERDEN.minKurs) liste.push('kursUnter1')
    if (k.umsatz20 == null) liste.push('umsatzUnbekannt')
    else if (k.umsatz20 < HUERDEN.minUmsatz20) liste.push('umsatzZuKlein')
    return liste
}

/**
 * @param {object} k            Ergebnis von `kennzahlen`
 * @param {{listungen?: object[], unterart?: string, jetzt?: number}} [opt]
 */
export function bewerte(k, opt = {}) {
    const jetzt = opt.jetzt ?? Date.now()
    const juengste = juengsteListung(opt.listungen)
    const listungVorTagen = juengste != null ? Math.max(0, Math.floor((jetzt - juengste) / TAG_MS)) : null
    const noten = {
        neuheit: noteNeuheit(k.alterTage ?? null, listungVorTagen, opt.unterart),
        momentum: noteMomentum(k),
        beteiligung: noteBeteiligung(k.rvol ?? null),
    }
    const gemessen = Object.keys(noten).filter((n) => noten[n] != null)
    const belastbar = noten.momentum != null && gemessen.length >= 2
    let note = null
    if (belastbar) {
        const gewicht = gemessen.reduce((s, n) => s + GEWICHTE[n], 0)
        note = gemessen.reduce((s, n) => s + noten[n] * GEWICHTE[n], 0) / gewicht
    }
    const gerissen = k.tage ? huerden(k) : []
    for (const n of Object.keys(noten)) if (noten[n] != null) noten[n] = Math.round(noten[n])
    return {
        kategorie: kategorie(k, listungVorTagen, opt.unterart),
        note: note != null ? Math.round(note * 10) / 10 : null,
        noten,
        belastbar,
        huerden: gerissen,
        zugelassen: belastbar && !gerissen.length,
        listungVorTagen,
    }
}
