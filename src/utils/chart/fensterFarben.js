/**
 * Farben je Punkt und Divergenz-Linien für die Indikator-Fenster — rein
 * (Selbsttest `src/utils/__selftest-fenster-farben.mjs`). Ziel: auf einen Blick
 * sehen, was die Tabelle (`fensterKennzahlen.js`) in Worten sagt.
 *
 * Jede Funktion liefert eine Reihe Farben gleicher Länge wie die Kerzen
 * (`null` = Grundfarbe der Serie). Das Register legt sie als `_farbe_<key>`
 * ab, `IndikatorZeichner.punkt` setzt sie je Punkt.
 *
 * Gerechnet wird je Kerze nur mit dem, was bis zu ihr bekannt war — eine
 * Farbe von gestern ändert sich nicht durch eine Kerze von heute.
 */
import { stufe as atrStufe, fundingStufe, rangProzent } from './fensterKennzahlen.js'

export const FARBE = {
    gruen: '#26a69a',
    rot: '#ef5350',
    grau: '#787b86',
    orange: '#ffb74d',
    blau: '#42a5f5',
    violett: '#ab47bc',
}
const alpha = (hex, a) => {
    const n = parseInt(hex.slice(1), 16)
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

/** ADX: grau ohne Trend (< 20), sonst grün bei Käufer-, rot bei Verkäufer-Druck. */
export function adxFarben(adx, plus, minus) {
    return adx.map((v, i) => {
        if (!Number.isFinite(v) || !Number.isFinite(plus[i]) || !Number.isFinite(minus[i])) return null
        if (v < 20) return FARBE.grau
        return plus[i] >= minus[i] ? FARBE.gruen : FARBE.rot
    })
}

/**
 * ATR: Farbe nach Rang unter den letzten `fenster` Werten bis zu dieser Kerze —
 * ruhig blau, normal grau, erhöht orange, hoch rot.
 */
export function atrFarben(atrReihe, fenster = 200) {
    const FARBEN = { sehrRuhig: FARBE.blau, ruhig: FARBE.blau, normal: FARBE.grau, erhoeht: FARBE.orange, hoch: FARBE.rot }
    return atrReihe.map((v, i) => {
        if (!(v > 0)) return null
        const f = []
        for (let j = Math.max(0, i - fenster + 1); j <= i; j++) if (atrReihe[j] > 0) f.push(atrReihe[j])
        if (f.length < 20) return null
        return FARBEN[atrStufe(rangProzent(f, v))]
    })
}

/**
 * OBV: grün, wenn er über `n` Kerzen steigt, rot, wenn er fällt — und orange,
 * wo Kurs und OBV gegeneinander laufen (Verteilung/Akkumulation).
 */
export function obvFarben(kerzen, obvReihe, n = 20) {
    return obvReihe.map((v, i) => {
        if (i < n || !Number.isFinite(v) || !Number.isFinite(obvReihe[i - n])) return null
        const dObv = v - obvReihe[i - n]
        const dKurs = kerzen[i].c - kerzen[i - n].c
        const kursPct = kerzen[i - n].c > 0 ? (dKurs / kerzen[i - n].c) * 100 : 0
        if (Math.abs(kursPct) > 0.3 && Math.sign(dKurs) !== Math.sign(dObv) && dObv !== 0) return FARBE.orange
        return dObv >= 0 ? FARBE.gruen : FARBE.rot
    })
}

/** Volumen: Balken nach Kerzenrichtung, kräftig ab `stark` × Schnitt (Schnitt ohne die Kerze selbst). */
export function volumenFarben(kerzen, laenge = 20, stark = 2) {
    return kerzen.map((k, i) => {
        const hoch = k.c >= k.o
        if (i < laenge) return alpha(hoch ? FARBE.gruen : FARBE.rot, 0.35)
        let s = 0
        for (let j = i - laenge; j < i; j++) s += Number(kerzen[j].v) || 0
        const schnitt = s / laenge
        const kraeftig = schnitt > 0 && k.v >= stark * schnitt
        return alpha(hoch ? FARBE.gruen : FARBE.rot, kraeftig ? 0.95 : 0.35)
    })
}

/** Funding: normal gedämpft, erhöht orange, hoch rot, negativ violett. */
export function fundingFarben(hist) {
    const F = { normal: alpha(FARBE.gruen, 0.45), erhoeht: FARBE.orange, hoch: FARBE.rot, negativ: FARBE.violett }
    return hist.map((v) => (Number.isFinite(v) ? F[fundingStufe(v)] : null))
}

/** Long-Anteil: grün über 50, rot darunter, orange in Extremen (Rang ≥ 90 / ≤ 10 bis hierher). */
export function longAnteilFarben(werte, fenster = 200) {
    return werte.map((v, i) => {
        if (!Number.isFinite(v)) return null
        const f = []
        for (let j = Math.max(0, i - fenster + 1); j <= i; j++) if (Number.isFinite(werte[j])) f.push(werte[j])
        if (f.length >= 20) {
            const p = rangProzent(f, v)
            if (p >= 90 || p <= 10) return FARBE.orange
        }
        return v >= 50 ? FARBE.gruen : FARBE.rot
    })
}

/**
 * Divergenzen zwischen Kurs und Oszillator (wie die RSI-Divergenz von
 * TradingView): Pivot-Hochs/-Tiefs im OSZILLATOR mit `L` Kerzen zu beiden
 * Seiten; zwei aufeinanderfolgende Pivots im Abstand `minAbstand`–`maxAbstand`
 * Kerzen. Drei Arten (`arten`, seit 31.10.2026 einzeln wählbar), je Seite:
 *   regulaer      Wende: Kurs höheres Hoch / Oszillator tieferes (bärisch),
 *                 Kurs tieferes Tief / Oszillator höheres (bullisch)
 *   versteckt     Fortsetzung: Kurs tieferes Hoch / Oszillator höheres (bärisch),
 *                 Kurs höheres Tief / Oszillator tieferes (bullisch)
 *   uebertrieben  Doppelhoch/-tief: Kurs gleich hoch (± `gleichTol`), Oszillator
 *                 schwächer — tieferes Hoch (bärisch), höheres Tief (bullisch)
 * „Gleich" heisst höchstens `gleichTol` auseinander (Vorgabe 15 % der mittleren
 * Kerzenspanne); dieselbe Grenze trennt die Arten, sodass ein Paar nie zwei hat.
 * `minDiffRel` (statt `minDiff`) misst den Oszillator-Unterschied relativ zum
 * Median seines Betrags — für den MACD, dessen Werte mit dem Kurs skalieren.
 * Ein Pivot ist erst `L` Kerzen später bestätigt; die Linie erscheint also
 * mit dieser Verzögerung, nie vorher (kein Blick in die Zukunft).
 * @returns {Array<{art: 'baerisch'|'bullisch', typ: 'regulaer'|'versteckt'|'uebertrieben', i1, i2, v1, v2}>}
 */
export const DIV_ARTEN = ['regulaer', 'versteckt', 'uebertrieben']
const medianVon = (a) => { const b = a.filter(Number.isFinite).sort((x, y) => x - y); return b.length ? b[b.length >> 1] : 0 }

export function divergenzen(kerzen, werte, { L = 5, minAbstand = 5, maxAbstand = 60, minDiff = 1, minDiffRel = null, arten = ['regulaer'], gleichTol = null } = {}) {
    const n = Math.min(kerzen?.length || 0, werte?.length || 0)
    const an = new Set(arten)
    if (!an.size || n < 2 * L + 2) return []
    const tol = gleichTol ?? 0.15 * medianVon(kerzen.slice(0, n).map((k) => k.h - k.l))
    const dMin = minDiffRel != null ? minDiffRel * medianVon(werte.slice(0, n).map(Math.abs)) : minDiff
    const pivots = (hoch) => {
        const aus = []
        for (let i = L; i < n - L; i++) {
            const v = werte[i]
            if (!Number.isFinite(v)) continue
            let ok = true
            for (let j = i - L; j <= i + L && ok; j++) {
                if (j === i || !Number.isFinite(werte[j])) continue
                // Gleichstand: der erste von zwei gleichen Werten ist der Pivot. Streng nach
                // beiden Seiten fiel ein Doppel-Tief ganz weg (RENDERUSDT 1h, 30.10.2026: RSI
                // zweimal 24.1915), und die Divergenz wurde über das echte Tief hinweg gezogen.
                ok = j < i ? (hoch ? werte[j] < v : werte[j] > v) : (hoch ? werte[j] <= v : werte[j] >= v)
            }
            if (ok) aus.push(i)
        }
        return aus
    }
    const aus = []
    const nimm = (typ, art, a, b) => { if (an.has(typ)) aus.push({ art, typ, i1: a, i2: b, v1: werte[a], v2: werte[b] }) }
    for (const hoch of [true, false]) {
        const p = pivots(hoch)
        for (let k = 1; k < p.length; k++) {
            const a = p[k - 1], b = p[k]
            if (b - a < minAbstand || b - a > maxAbstand) continue
            const kursA = hoch ? kerzen[a].h : kerzen[a].l, kursB = hoch ? kerzen[b].h : kerzen[b].l
            const wa = werte[a], wb = werte[b]
            const kursHoeher = kursB > kursA + tol, kursTiefer = kursB < kursA - tol, kursGleich = !kursHoeher && !kursTiefer
            const oszHoeher = wb > wa + dMin, oszTiefer = wb < wa - dMin
            if (hoch) {
                if (kursHoeher && oszTiefer) nimm('regulaer', 'baerisch', a, b)
                else if (kursTiefer && oszHoeher) nimm('versteckt', 'baerisch', a, b)
                else if (kursGleich && oszTiefer) nimm('uebertrieben', 'baerisch', a, b)
            } else {
                if (kursTiefer && oszHoeher) nimm('regulaer', 'bullisch', a, b)
                else if (kursHoeher && oszTiefer) nimm('versteckt', 'bullisch', a, b)
                else if (kursGleich && oszHoeher) nimm('uebertrieben', 'bullisch', a, b)
            }
        }
    }
    return aus.sort((x, y) => x.i2 - y.i2)
}

/** Die gewählten Arten aus den Indikator-Parametern (`divRegulaer`/`divVersteckt`/`divUebertrieben`). */
export function divArtenAus(p) {
    return [p.divRegulaer !== false && 'regulaer', p.divVersteckt && 'versteckt', p.divUebertrieben && 'uebertrieben'].filter(Boolean)
}
