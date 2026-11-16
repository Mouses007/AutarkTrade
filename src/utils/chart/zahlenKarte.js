/**
 * Die Karte hinter einem Zahlen-Schild im Aktien-Chart: was zu einem
 * Quartalszahlen-Termin bekannt ist — und was nicht.
 *
 * Rein (kein Netz, kein DOM). Die Angaben stammen aus dem Aktien-Kontext des
 * Panels (`/api/aktien/kontext`: `termine.einzelheiten`, `termine.naechster`),
 * die Kursreaktion aus den Kerzen, die der Chart ohnehin geladen hat.
 */
import { FENSTER_NACH_MS } from '../../../shared/aktien-zahlen.js'
import { sitzungVon } from '../../../shared/aktien-sitzung.js'

const TAG_MS = 86_400_000
/** So weit darf der Schluss vor dem Termin (bzw. vor dem Fensterende) zurückliegen: ein langes Wochenende. */
const LUECKE_MAX_MS = 4 * TAG_MS

/**
 * Lage des Termins zur regulären US-Sitzung — nur was sich sicher sagen lässt:
 * `vor` (vorbörslich), `nach` (nachbörslich), `regulaer`. Sonst null (Nacht,
 * Wochenende: dann ist die Uhrzeit der Quelle eher ein Platzhalter als eine Angabe).
 */
export function boersenLage(zeit) {
    if (!Number.isFinite(zeit)) return null
    const s = sitzungVon(zeit)
    return s === 'vor' || s === 'nach' || s === 'regulaer' ? s : null
}

/**
 * Kursreaktion auf die Meldung aus den geladenen Kerzen: letzter Schluss VOR
 * dem Termin → Schluss der Kerze, in der das Zahlen-Fenster endet (ein Tag
 * nach der Meldung, wie in der Simulation).
 *
 * `null`, wenn die Kerzen den Zeitraum nicht abdecken (zu wenig Geschichte
 * geladen, Fenster noch nicht zu Ende, Lücke in den Daten) oder die
 * Zeiteinheit gröber als ein Tag ist — dann lieber nichts als eine Zahl, die
 * etwas anderes misst.
 *
 * @param {{t: number, c: number}[]} kerzen  aufsteigend, `t` = Öffnungszeit in ms
 * @param {number} zeit   Meldezeitpunkt in ms
 * @param {number} iv     Kerzenlänge in ms
 * @param {number} [jetzt]
 * @returns {{vorher: number, nachher: number, pct: number, von: number, bis: number}|null}
 *          `von`/`bis` = Schlusszeit der beiden Kerzen
 */
export function kursReaktion(kerzen, zeit, iv, jetzt = Date.now()) {
    if (!Array.isArray(kerzen) || !kerzen.length || !Number.isFinite(zeit) || !(iv > 0) || iv > TAG_MS) return null
    const ende = zeit + FENSTER_NACH_MS
    if (jetzt < ende) return null
    // letzte Kerze, die vor dem Termin geschlossen hat
    let lo = 0, hi = kerzen.length - 1, vor = -1
    while (lo <= hi) {
        const m = (lo + hi) >> 1
        if (kerzen[m].t + iv <= zeit) { vor = m; lo = m + 1 } else hi = m - 1
    }
    if (vor < 0) return null
    // letzte Kerze, die bis zum Fensterende geöffnet hat
    lo = vor; hi = kerzen.length - 1
    let nach = -1
    while (lo <= hi) {
        const m = (lo + hi) >> 1
        if (kerzen[m].t <= ende) { nach = m; lo = m + 1 } else hi = m - 1
    }
    if (nach <= vor) return null
    const a = kerzen[vor], b = kerzen[nach]
    // Die Kerzen müssen an beide Zeitpunkte heranreichen — sonst liegt eine Lücke dazwischen.
    if (zeit - (a.t + iv) > LUECKE_MAX_MS) return null
    const schliesstVorEnde = b.t + iv < ende
    // Die letzte geladene Kerze endet vor dem Fensterende: offen, was danach noch fehlt.
    if (schliesstVorEnde && nach === kerzen.length - 1) return null
    if (schliesstVorEnde && ende - (b.t + iv) > LUECKE_MAX_MS) return null
    if (!(a.c > 0) || !Number.isFinite(b.c)) return null
    return { vorher: a.c, nachher: b.c, pct: (b.c / a.c - 1) * 100, von: a.t + iv, bis: b.t + iv }
}

/**
 * Alles, was die Karte zu einer Marke zeigt.
 *
 * @param {{zeit: number, kommend: boolean, geschaetzt: boolean, tage: number|null}} marke  aus `zahlenMarken`
 * @param {{naechster?: object|null, einzelheiten?: object[]}|null} termine  aus dem Aktien-Kontext
 * @param {{kerzen?: object[], iv?: number, jetzt?: number}} [o]
 * @returns {{zeit, kommend, geschaetzt, tage, lage, quartal, eps, schaetzung, ueberraschungPct, umsatzSchaetzung, reaktion, hatEinzelheiten}}
 */
export function zahlenKarteDaten(marke, termine, { kerzen = [], iv = 0, jetzt = Date.now() } = {}) {
    const basis = {
        zeit: marke.zeit, kommend: !!marke.kommend, geschaetzt: !!marke.geschaetzt, tage: marke.tage ?? null,
        lage: boersenLage(marke.zeit),
        quartal: null, eps: null, schaetzung: null, ueberraschungPct: null, umsatzSchaetzung: null,
        reaktion: null, hatEinzelheiten: false,
    }
    const naechster = termine?.naechster?.zeit === marke.zeit ? termine.naechster : null
    if (marke.kommend) {
        // Ein Stand ohne diese Felder (älterer Server) zeigt den Termin, aber keine Schätzung.
        const eps = Number.isFinite(naechster?.epsSchaetzung) ? naechster.epsSchaetzung : null
        const umsatz = Number.isFinite(naechster?.umsatzSchaetzung) ? naechster.umsatzSchaetzung : null
        return { ...basis, schaetzung: eps, umsatzSchaetzung: umsatz, hatEinzelheiten: eps != null || umsatz != null }
    }
    const e = (Array.isArray(termine?.einzelheiten) ? termine.einzelheiten : []).find((x) => x?.zeit === marke.zeit) || null
    const endlich = (v) => (Number.isFinite(v) ? v : null)
    return {
        ...basis,
        quartal: e?.quartal || null, eps: endlich(e?.eps), schaetzung: endlich(e?.schaetzung), ueberraschungPct: endlich(e?.ueberraschungPct),
        reaktion: kursReaktion(kerzen, marke.zeit, iv, jetzt),
        hatEinzelheiten: !!e && (endlich(e.eps) != null || endlich(e.schaetzung) != null),
    }
}

/** Umsatz kurz: 108.7 Mrd. / 950 Mio. — Einheit als Schlüssel (`mrd` | `mio` | ''), damit die Karte sie übersetzt. */
export function grosseZahl(v) {
    if (!Number.isFinite(v)) return null
    const a = Math.abs(v)
    if (a >= 1e9) return { wert: v / 1e9, einheit: 'mrd' }
    if (a >= 1e6) return { wert: v / 1e6, einheit: 'mio' }
    return { wert: v, einheit: '' }
}
