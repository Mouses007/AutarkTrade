/**
 * Positionsrechner für das Long/Short-Werkzeug im Chart — rein, ohne Netz
 * (Selbsttest `shared/__selftest-trade-rechner.mjs`).
 *
 * Aus Einstieg, Stop, Ziel und EINER Grössenangabe folgt der Rest:
 *
 *   risiko   max. Verlust in USDT, wenn der Stop greift (Gebühren eingerechnet)
 *            → Menge = Verlust / (|Einstieg − Stop| + Gebühr auf beide Seiten)
 *   groesse  Positionsgrösse (Nominal) in USDT
 *   marge    eingesetzte Marge in USDT → Nominal = Marge × Hebel
 *
 * Liquidation über `liquidation.js` (Börsenformel, isoliert, Stufe 1) mit der
 * Wartungsmarge des Symbols. Ein Liq-Preis, der VOR dem Stop liegt, heisst:
 * die Börse schliesst die Position, bevor der Stop greift — der Verlust ist
 * dann die ganze Marge, nicht der geplante. Das ist die wichtigste Warnung.
 *
 * Gebühr in Prozent je Seite (Taker, Vorgabe 0,06 %). Cross Margin bildet der
 * Rechner nicht ab: dort verschiebt freies Guthaben den Liq-Preis beliebig.
 */
import { liqPreis, hebelHaltbar } from './liquidation.js'

export const MODI = ['risiko', 'groesse', 'marge']
export const RECHNER_VORGABE = { modus: 'risiko', betrag: 50, hebel: 10, konto: 0, gebuehrPct: 0.06 }
export const MAX_HEBEL = 200

/** Eingaben säubern: bekannte Felder in ihren Grenzen, Unsinn → Vorgabe. */
export function rechnerEingabe(roh = {}) {
    const zahl = (v, min, max, ersatz) => {
        const n = Number(v)
        return Number.isFinite(n) && n >= min ? Math.min(max, n) : ersatz
    }
    return {
        modus: MODI.includes(roh.modus) ? roh.modus : RECHNER_VORGABE.modus,
        betrag: zahl(roh.betrag, 0, 1e12, RECHNER_VORGABE.betrag),
        hebel: zahl(roh.hebel, 1, MAX_HEBEL, RECHNER_VORGABE.hebel),
        konto: zahl(roh.konto, 0, 1e12, 0),
        gebuehrPct: zahl(roh.gebuehrPct, 0, 1, RECHNER_VORGABE.gebuehrPct),
    }
}

/**
 * @param {object} o
 * @param {number} o.einstieg
 * @param {number} o.stop
 * @param {number} o.ziel
 * @param {object} o.eingabe   { modus, betrag, hebel, konto, gebuehrPct }
 * @param {number} [o.mmr]     Wartungsmarge als BRUCH (0.004 = 0,4 %)
 * @returns {object|null}  null, wenn Einstieg oder Stop fehlen
 */
export function rechnePosition({ einstieg, stop, ziel, eingabe, mmr = 0.004 }) {
    const e = Number(einstieg), s = Number(stop), z = Number(ziel)
    if (!(e > 0) || !(s > 0)) return null
    const ein = rechnerEingabe(eingabe)
    // Richtung aus dem Ziel (wie das Werkzeug); ohne Ziel aus dem Stop
    const long = z > 0 ? z >= e : s < e
    const richtung = long ? 'long' : 'short'
    const stimmig = long ? s < e : s > e
    const g = ein.gebuehrPct / 100
    const stopAbstand = Math.abs(e - s)

    let menge = 0
    if (ein.modus === 'risiko') {
        const jeEinheit = stopAbstand + g * (e + s)
        menge = jeEinheit > 0 ? ein.betrag / jeEinheit : 0
    } else if (ein.modus === 'groesse') {
        menge = ein.betrag / e
    } else {
        menge = (ein.betrag * ein.hebel) / e
    }
    if (!Number.isFinite(menge) || menge < 0) menge = 0

    const nominal = menge * e
    const marge = nominal / ein.hebel
    const m = Math.max(0, Number(mmr) || 0)
    const haltbar = hebelHaltbar(ein.hebel, m)
    const liq = liqPreis(e, ein.hebel, m, richtung)
    const vz = long ? 1 : -1
    const ergebnis = (p) => vz * (p - e) * menge - g * menge * (e + p)
    const verlustStop = stimmig ? ergebnis(s) : null
    const gewinnZiel = z > 0 ? ergebnis(z) : null
    // Liq zwischen Einstieg und Stop (oder gleich auf): die Börse ist schneller als der Stop
    const liqVorStop = !haltbar || (stimmig && (long ? liq >= s : liq <= s))
    const pct = (p) => ((p - e) / e) * 100

    return {
        richtung, stimmig, menge, nominal, marge, hebel: ein.hebel, haltbar,
        liq, liqPct: pct(liq), liqVorStop,
        stopPct: pct(s), zielPct: z > 0 ? pct(z) : null,
        verlustStop, gewinnZiel,
        rr: verlustStop != null && gewinnZiel != null && verlustStop < 0 ? gewinnZiel / -verlustStop : null,
        // Verlust bei Liquidation: die Marge (plus Eröffnungsgebühr)
        verlustLiq: -(marge + g * nominal),
        gebuehren: g * menge * (e + (z > 0 ? z : e)),
        kontoRisikoPct: ein.konto > 0 && verlustStop != null ? (-verlustStop / ein.konto) * 100 : null,
        margeKontoPct: ein.konto > 0 ? (marge / ein.konto) * 100 : null,
        mmr: m,
    }
}
