/**
 * Kaufzettel für Aktien (Phase 7): aus Handelsplatz, Richtung, Einstieg, Stop,
 * Ziel und maximalem Verlust werden Stückzahl, Nominalwert, Marge und das
 * Verhältnis Chance zu Risiko — rein, ohne Netz (Selbsttest
 * `shared/__selftest-kaufzettel.mjs`). Gerechnet wird mit dem Positionsrechner
 * des Charts (`tradeRechner.js`, Grösse aus dem Verlust am Stop inklusive
 * Gebühren).
 *
 * Der Zettel ist ein Rechenblatt: er sendet nichts und speichert nichts.
 *
 * Was der Zettel anders macht als das Chart-Werkzeug:
 *   - die Richtung ist eine EINGABE; ein Stop oder Ziel auf der falschen Seite
 *     ist ein Fehler, keine stille Umdeutung,
 *   - Spot (`token-spot`, `broker-spot`) hat keinen Hebel und kein Short —
 *     Marge = Nominalwert, keine Liquidation,
 *   - die Wartungsmarge eines Aktien-Futures hängt am Handelsplatz: höchstens
 *     2,5 % (Binance, `MMR_VORGABE_AKTIEN` in `server/margin-rates.js`), und nie
 *     mehr als der halbe Kehrwert des erlaubten Hebels (`wartungsmargeAusHebel`).
 *     Das ist eine Schätzung — der Zettel zeigt sie als änderbares Feld.
 */
import { rechnePosition, MAX_HEBEL } from './tradeRechner.js'
import { sitzungVon, kalenderTageNY } from './aktien-sitzung.js'

export const ARTEN = ['perp', 'token-spot', 'broker-spot']
export const MMR_AKTIEN_FUTURE = 0.025

/**
 * Geschätzte Wartungsmarge (Bruch) eines Aktien-Futures aus dem höchsten Hebel,
 * den der Platz zulässt. Eine Börse mit 50× verlangt 2 % Anfangsmarge — ihre
 * Wartungsmarge muss darunter liegen; üblich ist die Hälfte (0,5 / Hebel).
 * Bis 15.11.2026 galten 2,5 % für jeden Platz: bei Bitunix (50×) und Bitget
 * (100×) meldete der Zettel ab 40× «Liquidation = Einstieg» (Audit FUN-H-002).
 *
 * @param {number} [maxHebel]  ohne Angabe bleibt es bei 2,5 %
 */
export function wartungsmargeAusHebel(maxHebel) {
    const h = Number(maxHebel)
    return h >= 1 ? Math.min(MMR_AKTIEN_FUTURE, 0.5 / h) : MMR_AKTIEN_FUTURE
}
/** Taker-Gebühr je Seite in Prozent, als Vorbelegung. Spot ist eine Annahme — das Feld bleibt änderbar. */
export const GEBUEHR_VORGABE = { perp: 0.06, 'token-spot': 0.1, 'broker-spot': 0.1 }
export const ZAHLEN_VORLAUF_TAGE = 2

export const istSpot = (art) => art !== 'perp'

const zahl = (v) => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * @param {object} o
 * @param {'perp'|'token-spot'|'broker-spot'} o.art
 * @param {'long'|'short'} o.richtung
 * @param {number} o.einstieg
 * @param {number} o.stop
 * @param {number} [o.ziel]          0/leer = kein Ziel
 * @param {number} o.betrag          maximaler Verlust am Stop
 * @param {'usdt'|'prozent'} [o.einheit]  USD oder % vom Konto
 * @param {number} [o.konto]
 * @param {number} [o.hebel]         nur Futures
 * @param {number} [o.maxHebel]      Grenze der Listung, falls bekannt
 * @param {number} [o.gebuehrPct]    je Seite, in Prozent
 * @param {number} [o.mmrPct]        Wartungsmarge in Prozent; leer = Schätzung aus `maxHebel`
 * @returns {{ok: boolean, fehler: string[], warnungen: string[], spot: boolean, richtung: string, hebel: number,
 *            menge?: number, nominal?: number, marge?: number, verlustStop?: number, gewinnZiel?: number|null,
 *            rr?: number|null, liq?: number|null, liqVorStop?: boolean, stopPct?: number, zielPct?: number|null,
 *            kontoRisikoPct?: number|null, margeKontoPct?: number|null, betragUsdt?: number}}
 */
export function rechneKaufzettel(o = {}) {
    const art = ARTEN.includes(o.art) ? o.art : 'perp'
    const spot = istSpot(art)
    const fehler = []
    const warnungen = []
    let richtung = o.richtung === 'short' ? 'short' : 'long'
    if (spot && richtung === 'short') { fehler.push('shortBeiSpot'); richtung = 'long' }
    const long = richtung === 'long'

    const e = zahl(o.einstieg), s = zahl(o.stop), z = zahl(o.ziel)
    if (!e) fehler.push('einstiegFehlt')
    if (!s) fehler.push('stopFehlt')
    if (e && s && (long ? s >= e : s <= e)) fehler.push('stopFalscheSeite')
    if (e && z && (long ? z <= e : z >= e)) fehler.push('zielFalscheSeite')
    if (!zahl(o.betrag)) fehler.push('betragFehlt')
    const einheit = o.einheit === 'prozent' ? 'prozent' : 'usdt'
    if (einheit === 'prozent' && !zahl(o.konto)) fehler.push('kontoFehlt')

    let hebel = spot ? 1 : Math.min(MAX_HEBEL, Math.max(1, zahl(o.hebel) || 1))
    const maxHebel = zahl(o.maxHebel)
    if (!spot && maxHebel && hebel > maxHebel) warnungen.push('hebelUeberGrenze')

    const kopf = { spot, art, richtung, hebel }
    if (fehler.length) return { ok: false, fehler, warnungen, ...kopf }

    const gebuehrPct = o.gebuehrPct === '' || o.gebuehrPct == null || !Number.isFinite(Number(o.gebuehrPct)) || Number(o.gebuehrPct) < 0
        ? GEBUEHR_VORGABE[art] : Number(o.gebuehrPct)
    const mmrEigen = o.mmrPct === '' || o.mmrPct == null ? NaN : Number(o.mmrPct)
    const mmr = mmrEigen > 0 && mmrEigen < 100 ? mmrEigen / 100 : wartungsmargeAusHebel(maxHebel)
    const r = rechnePosition({
        einstieg: e, stop: s, ziel: z,
        eingabe: { modus: 'risiko', betrag: zahl(o.betrag), einheit, hebel, konto: zahl(o.konto), gebuehrPct },
        mmr: spot ? 0 : mmr,
    })
    // Spot: wer ohne Kredit kauft, wird nicht liquidiert.
    const liqVorStop = !spot && r.liqVorStop
    if (liqVorStop) warnungen.push('liqVorStop')
    // Ohne Hebel muss der ganze Nominalwert da sein.
    if (zahl(o.konto) && r.marge > zahl(o.konto)) warnungen.push('margeUeberKonto')

    return {
        ok: true, fehler, warnungen, ...kopf,
        menge: r.menge, nominal: r.nominal, marge: r.marge, betragUsdt: r.betragUsdt,
        verlustStop: r.verlustStop, gewinnZiel: r.gewinnZiel, rr: r.rr,
        liq: spot ? null : r.liq, liqVorStop,
        stopPct: r.stopPct, zielPct: r.zielPct,
        kontoRisikoPct: r.kontoRisikoPct, margeKontoPct: r.margeKontoPct,
        gebuehrPct, mmrPct: spot ? null : mmr * 100,
    }
}

/**
 * Hinweise aus der Recherche (`docs/RECHERCHE-AKTIEN.md`), soweit sie für
 * diesen Platz und diesen Zeitpunkt gelten.
 *
 * @param {object} o
 * @param {string} o.art
 * @param {number} [o.jetzt]
 * @param {{zeit: number, geschaetzt?: boolean}|null} [o.termin]  nächster Zahlentermin, falls bekannt
 * @returns {{sitzung: string, duenn: boolean, zahlen: null|{zeit: number, tage: number, geschaetzt: boolean}}}
 */
export function zettelHinweise({ art, jetzt = Date.now(), termin = null } = {}) {
    const sitzung = sitzungVon(jetzt)
    // Ganze Kalendertage nach New Yorker Datum, wie Titel-Seite, Radar und Chart zählen
    // (`kalenderTageNY`, FUN-H-011 — bis 15.11.2026 Ortszeit des Rechners):
    // 0 = heute (auch wenn die Meldung schon heute früh war), höchstens zwei Tage voraus.
    const tage = termin?.zeit ? kalenderTageNY(Number(termin.zeit), jetzt) : null
    const zahlen = tage != null && tage >= 0 && tage <= ZAHLEN_VORLAUF_TAGE
        ? { zeit: Number(termin.zeit), tage, geschaetzt: termin.geschaetzt === true }
        : null
    return { sitzung, duenn: sitzung !== 'regulaer', zahlen, art }
}

/**
 * Der Zettel als Text für die Zwischenablage. `zeilen` sind fertige
 * `[Beschriftung, Wert]`-Paare; leere Werte fallen weg.
 */
export function zettelText(kopf, zeilen = [], fuss = '') {
    const breite = Math.max(0, ...zeilen.filter(([, w]) => w != null && w !== '').map(([b]) => String(b).length))
    const koerper = zeilen.filter(([, w]) => w != null && w !== '').map(([b, w]) => `${String(b).padEnd(breite)}  ${w}`)
    return [kopf, ...koerper, fuss].filter(Boolean).join('\n')
}
