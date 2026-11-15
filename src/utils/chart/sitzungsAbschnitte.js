/**
 * Börsensitzungen im Chart eines Aktien-Futures: Kerzenzeiten → zusammenhängende
 * Abschnitte ausserhalb der regulären US-Sitzung (`overlays/AktienEbene.js`
 * hinterlegt sie) und die Schilder der Zahlentermine.
 *
 * Der Future handelt rund um die Uhr, der Kurs der Aktie entsteht aber
 * 09:30–16:00 New Yorker Zeit; davor und danach ist das Band dünn
 * (`docs/RECHERCHE-AKTIEN.md`). Gerechnet wird mit `sitzungVon`, also mit
 * Sommerzeit und US-Feiertagen.
 *
 * Eine Kerze, die länger ist als eine halbe Stunde, kann mehrere Sitzungen
 * überdecken (die 4h-Kerze ab 12:00 UTC beginnt vorbörslich und enthält die
 * Eröffnung). Regel: berührt sie die reguläre Sitzung, bleibt sie frei —
 * hinterlegt wird nur, was GANZ ausserhalb liegt, und zwar in der Art, die den
 * grössten Teil der Kerze ausmacht (bei Gleichstand die frühere).
 *
 * Gebündelt wird nach ART, nicht nach Sitzung: je Kerze ein Rechteck wären bei
 * einem Wochenende auf 1m 2880 Stück — so ist es eines.
 *
 * Rein — kein Netz, kein DOM (Selbsttest `src/utils/__selftest-sitzungs-abschnitte.mjs`).
 */
import { sitzungenDerKerze, kalenderTageNY } from '../../../shared/aktien-sitzung.js'

/** Bis zu dieser Kerzenlänge wird hinterlegt; ab 1d sagt eine Sitzung nichts mehr. */
export const SITZUNG_BIS_MS = 4 * 3_600_000

/** Sitzung → Art der Fläche. `regulaer` hat keine. */
export const ART = { vor: 'rand', nach: 'rand', nacht: 'nacht', wochenende: 'zu', feiertag: 'zu' }
export const ARTEN = ['rand', 'nacht', 'zu']

/**
 * Art der Fläche hinter einer Kerze — `null`, wenn sie die reguläre Sitzung berührt.
 * Welche Sitzungen eine Kerze überdeckt, sagt `sitzungenDerKerze` — dieselbe
 * Zählung, mit der Backtest und Engine den Schalter «nur reguläre Sitzung»
 * entscheiden (`einstiegRegulaer`, FUN-H-005). Der Schalter ist strenger: er
 * verlangt für ein Limit in der Kerze mindestens die Hälfte in der Sitzung
 * (RAS-05). Jede Kerze, die er zulässt, ist hier frei — nicht umgekehrt.
 * @param {number} t      Öffnungszeit in ms
 * @param {number} ivMs   Kerzenlänge in ms
 * @returns {'rand'|'nacht'|'zu'|null}
 */
export function artDerKerze(t, ivMs) {
    const zahl = {}
    let beste = null
    for (const sitzung of sitzungenDerKerze(t, ivMs)) {
        const art = ART[sitzung]
        if (!art) return null
        zahl[art] = (zahl[art] || 0) + 1
        if (!beste || zahl[art] > zahl[beste]) beste = art
    }
    return beste
}

/**
 * Kerzenzeiten → Abschnitte ausserhalb der regulären Sitzung.
 *
 * @param {number[]} zeiten  Öffnungszeiten in ms, aufsteigend
 * @param {number} ivMs      Kerzenlänge in ms
 * @param {Map<number, string|null>} [merker]  Art je Öffnungszeit; der Aufrufer behält ihn, solange die
 *                                             Zeiteinheit gleich bleibt — eine neue Kerze kostet dann eine Abfrage
 * @returns {{von: number, bis: number, art: 'rand'|'nacht'|'zu'}[]}  Kerzen-Indizes, beide einschliesslich;
 *          leer über `SITZUNG_BIS_MS`
 */
export function sitzungsAbschnitte(zeiten, ivMs, merker = null) {
    if (!Array.isArray(zeiten) || !zeiten.length || !(ivMs > 0) || ivMs > SITZUNG_BIS_MS) return []
    const aus = []
    let offen = null
    for (let i = 0; i < zeiten.length; i++) {
        const t = zeiten[i]
        let art = merker?.get(t)
        if (art === undefined) {
            art = artDerKerze(t, ivMs)
            merker?.set(t, art)
        }
        if (offen && offen.art === art) { offen.bis = i; continue }
        offen = art ? { von: i, bis: i, art } : null
        if (offen) aus.push(offen)
    }
    return aus
}

/**
 * Zahlentermine für den Chart: je Termin Zeit und Art des Schilds.
 *
 * @param {{naechster?: {zeit: number, geschaetzt?: boolean}|null, vergangene?: number[]}|null} termine
 * @param {number} jetzt  ms
 * @returns {{zeit: number, kommend: boolean, geschaetzt: boolean, tage: number|null}[]}  aufsteigend;
 *          `tage` = ganze Tage bis zum Termin (0 = heute), nur beim kommenden
 */
export function zahlenMarken(termine, jetzt = Date.now()) {
    if (!termine) return []
    const aus = new Map()
    for (const t of termine.vergangene || []) {
        if (Number.isFinite(t) && t > 0) aus.set(t, { zeit: t, kommend: false, geschaetzt: false, tage: null })
    }
    const n = termine.naechster
    if (n && Number.isFinite(n.zeit) && n.zeit > 0) {
        // Ein «nächster» Termin, der schon hinter uns liegt (die Quelle hat noch nicht nachgezogen), ist einfach ein Termin.
        const kommend = n.zeit >= jetzt
        aus.set(n.zeit, {
            zeit: n.zeit, kommend, geschaetzt: kommend && n.geschaetzt === true,
            // Kalendertage nach New Yorker Datum, nicht gerundete 24-h-Blöcke (FUN-H-011).
            tage: kommend ? Math.max(0, kalenderTageNY(n.zeit, jetzt)) : null,
        })
    }
    return [...aus.values()].sort((a, b) => a.zeit - b.zeit)
}
