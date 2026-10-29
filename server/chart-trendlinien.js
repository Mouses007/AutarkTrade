/**
 * Trendlinien an den Kerzen vermessen — rein, ohne Netz.
 *
 * Eine Trendlinie, wie ein Trader sie zieht, verbindet echte Wendepunkte
 * derselben Seite (Widerstand an Hochs, Unterstützung an Tiefs), wird von den
 * Kerzen respektiert und ist für den Kurs JETZT von Belang. Bis 20.10.2026
 * prüfte der Code nur „ab dem ersten Anker kein Schluss jenseits der Linie".
 * Das liess genau die Linien durch, die der Nutzer auf BTC 15m sah
 * (Fall `btc-15m-nutzerfall` im Selbsttest):
 *   - „Steigende Hochlinie (3 Berührungen)" von einem kleinen Zwischenhoch
 *     82 198 durch die Spitze 83 420: links vom ersten Anker lagen die Hochs
 *     bis 6 ATR ÜBER ihr, und zwei der drei „Berührungen" waren zwei Hochs
 *     derselben Welle, vier Kerzen auseinander.
 *   - Eine Linie, die sich vom Kurs ENTFERNT (steigend an Hochs im Abschwung,
 *     fallend an Tiefs im Aufschwung), bricht nie — sie bestand die alte
 *     Prüfung immer. Auf BTC 4h stand so eine 21 ATR über dem Kurs.
 *
 * Regeln (Konstanten in `TREND`):
 *   Wendepunkt  Hoch/Tief über bzw. unter den `PIVOT_K` Nachbarn auf jeder Seite.
 *   Berührung   Wendepunkt höchstens `TOL_ATR` × ATR von der Linie. Zwei
 *               Wendepunkte, zwischen denen der Kurs nicht mindestens
 *               `ABLOESE_ATR` × ATR von der Linie weg schloss, sind EINE
 *               Berührung (dieselbe Welle, z. B. ein Doppelhoch). Ein Ausreisser-Docht (Docht > `DOCHT_ATR` × ATR und
 *               > 2 × Körper) zählt nicht — eine Linie durch eine einzelne
 *               Nadel ist nicht bestätigt.
 *   Bruch       ab dem ersten Anker kein Schluss jenseits (¼ Toleranz) und kein
 *               Docht weiter als die Toleranz.
 *   Links       vor dem ersten Anker, über `LINKS_ANTEIL` der Spanne zurück,
 *               kein Schluss jenseits der verlängerten Linie: sonst schneidet
 *               sie durch den Verlauf, an dem sie angeblich anliegt.
 *   Steigung    höchstens `MAX_STEIL_ATR` × ATR je Kerze; steiler ist es ein
 *               Ausschlag, keine Trendlinie. Fast flach (< 0,75 ATR über die
 *               Spanne) ist eine waagerechte Marke (chart-kandidaten.js).
 *   Spanne      zwei Anker mindestens `MIN_ABSTAND` Kerzen auseinander; eine
 *               Linie mit nur zwei Berührungen mindestens `MIN_SPANNE_ZWEI`.
 *   Gegenlinie  steigend an Hochs / fallend an Tiefs (Kanal- oder Keilkante)
 *               braucht `GEGEN_MIN_BER` Berührungen — mit zwei ist sie jede
 *               beliebige Verbindung zweier Hochs.
 *   Länge       gezeichnet bis zur letzten Kerze plus `VERL_ANTEIL` der Spanne
 *               (mindestens `VERL_MIN`, höchstens `VERL_MAX` Kerzen) — nicht
 *               ins Unendliche.
 */
import { atr as atrReihe } from '../shared/indicators.js'

export const TREND = {
    PIVOT_K: 3,
    TOL_ATR: 0.3,
    MIN_ABSTAND: 10,
    ABLOESE_ATR: 1,
    DOCHT_ATR: 1.5,
    LINKS_ANTEIL: 0.5,
    MAX_STEIL_ATR: 0.3,
    MIN_SPANNE_ZWEI: 20,
    GEGEN_MIN_BER: 3,
    VERL_ANTEIL: 0.25,
    VERL_MIN: 5,
    VERL_MAX: 20,
}
export const PIVOT_K = TREND.PIVOT_K
export const TOL_ATR = TREND.TOL_ATR
export const MIN_ABSTAND = TREND.MIN_ABSTAND

/** Wendepunkte: Index i, dessen Hoch (Tief) über (unter) den K Nachbarn auf jeder Seite liegt. */
export function wendepunkte(kerzen, seite, k = PIVOT_K) {
    const aus = []
    const wert = (i) => (seite === 'hoch' ? kerzen[i].h : kerzen[i].l)
    for (let i = k; i < kerzen.length - k; i++) {
        let ok = true
        for (let j = i - k; j <= i + k && ok; j++) {
            if (j === i) continue
            ok = seite === 'hoch' ? wert(j) <= wert(i) : wert(j) >= wert(i)
        }
        if (ok) aus.push(i)
    }
    return aus
}

/** Docht auf der Seite der Linie ist eine einzelne Nadel (zählt nicht als Berührung). */
export function istAusreisser(kerze, seite, atrWert) {
    if (!(atrWert > 0)) return false
    const koerper = Math.abs(kerze.c - kerze.o)
    const docht = seite === 'hoch' ? kerze.h - Math.max(kerze.o, kerze.c) : Math.min(kerze.o, kerze.c) - kerze.l
    return docht > TREND.DOCHT_ATR * atrWert && docht > 2 * koerper
}

const linie = (i1, p1, i2, p2) => (i) => p1 + (p2 - p1) * (i - i1) / (i2 - i1)

/**
 * Hält die Gerade durch (i1,p1)–(i2,p2) als `seite`-Linie? Rechts bis zur letzten
 * Kerze ohne Bruch, links über `LINKS_ANTEIL` der Spanne ohne Schluss jenseits.
 * @returns {{ ok: boolean, grund?: 'bruch'|'links', beruehrungen: number, beruehrIdx: number[] }}
 */
export function pruefeTrend(kerzen, i1, p1, i2, p2, seite, tol, pivots, { atr: atrWert = tol / TOL_ATR } = {}) {
    const L = linie(i1, p1, i2, p2)
    const jenseits = (wert, grenze) => (seite === 'hoch' ? wert > grenze : wert < grenze)
    const um = (y, d) => (seite === 'hoch' ? y + d : y - d)
    for (let i = i1; i < kerzen.length; i++) {
        const k = kerzen[i], y = L(i)
        if (jenseits(k.c, um(y, tol * 0.25)) || jenseits(seite === 'hoch' ? k.h : k.l, um(y, tol))) return { ok: false, grund: 'bruch', beruehrungen: 0, beruehrIdx: [] }
    }
    const links = Math.max(0, i1 - Math.ceil(TREND.LINKS_ANTEIL * (i2 - i1)))
    // Eine klassische Linie (fallend an Hochs, steigend an Tiefs) beginnt nach dem Top bzw. Boden
    // links von ihr: die Prüfung nach links endet an der ersten Kerze, die über den ersten Anker
    // hinausreicht (29.10.2026, HBAR 4h: Linie vom ersten tieferen Hoch nach dem Pump auf 0.131 —
    // die Schlüsse des Pumps lagen über der nach links verlängerten Linie, und die Linie, die jeder
    // Trader so zieht, fiel durch). Gegenlinien prüfen weiter die ganze Hälfte.
    const klassisch = seite === 'hoch' ? p2 < p1 : p2 > p1
    for (let i = i1 - 1; i >= links; i--) {
        if (klassisch && jenseits(seite === 'hoch' ? kerzen[i].h : kerzen[i].l, um(p1, tol))) break
        if (jenseits(kerzen[i].c, um(L(i), tol))) return { ok: false, grund: 'links', beruehrungen: 0, beruehrIdx: [] }
    }
    const wert = (i) => (seite === 'hoch' ? kerzen[i].h : kerzen[i].l)
    const nah = pivots.filter((i) => i >= i1 && Math.abs(wert(i) - L(i)) <= tol && !istAusreisser(kerzen[i], seite, atrWert))
    // Wendepunkte derselben Welle zu einer Berührung zusammenlegen: dazwischen muss der Kurs
    // mindestens `ABLOESE_ATR` × ATR von der Linie weggeschlossen haben. Es zählt der nächste an der Linie.
    const weg = (von, bis) => {
        let m = 0
        for (let j = von + 1; j < bis; j++) m = Math.max(m, seite === 'hoch' ? L(j) - kerzen[j].c : kerzen[j].c - L(j))
        return m
    }
    const beruehrIdx = []
    let gruppe = []
    const schliesse = () => { if (gruppe.length) beruehrIdx.push(gruppe.reduce((a, b) => (Math.abs(wert(b) - L(b)) < Math.abs(wert(a) - L(a)) ? b : a))) }
    for (const i of nah) {
        if (gruppe.length && weg(gruppe[gruppe.length - 1], i) >= TREND.ABLOESE_ATR * atrWert) { schliesse(); gruppe = [] }
        gruppe.push(i)
    }
    schliesse()
    return { ok: true, beruehrungen: beruehrIdx.length, beruehrIdx }
}

/** Gegenlinie: steigend an Hochs oder fallend an Tiefs (Kanal-/Keilkante, entfernt sich vom Kurs). */
export const istGegenlinie = (seite, p1, p2) => (seite === 'hoch' ? p2 > p1 : p2 < p1)

/**
 * Alle haltenden Linien einer Seite — sortiert: meiste Berührungen, dann jüngerer
 * zweiter Anker, dann früherer erster Anker (längere Spanne).
 * @param {{ tol: number, atr?: number, richtung?: 'auf'|'ab'|null, minAbstand?: number }} opt
 */
export function alleTrendlinien(kerzen, seite, { tol, atr: atrWert = tol / TOL_ATR, richtung = null, minAbstand = MIN_ABSTAND, k = PIVOT_K, minSpanneZwei = TREND.MIN_SPANNE_ZWEI } = {}) {
    const pv = wendepunkte(kerzen, seite, k)
    const wert = (i) => (seite === 'hoch' ? kerzen[i].h : kerzen[i].l)
    const aus = []
    for (let a = 0; a < pv.length; a++) {
        for (let b = a + 1; b < pv.length; b++) {
            const i1 = pv[a], i2 = pv[b]
            if (i2 - i1 < minAbstand) continue
            const p1 = wert(i1), p2 = wert(i2)
            if (richtung === 'ab' && !(p2 < p1)) continue
            if (richtung === 'auf' && !(p2 > p1)) continue
            if (Math.abs(p2 - p1) / (i2 - i1) > TREND.MAX_STEIL_ATR * atrWert) continue
            const r = pruefeTrend(kerzen, i1, p1, i2, p2, seite, tol, pv, { atr: atrWert })
            if (!r.ok || r.beruehrungen < 2) continue
            if (r.beruehrungen === 2 && i2 - i1 < minSpanneZwei) continue
            if (istGegenlinie(seite, p1, p2) && r.beruehrungen < TREND.GEGEN_MIN_BER) continue
            aus.push({ i1, p1, i2, p2, beruehrungen: r.beruehrungen, beruehrIdx: r.beruehrIdx })
        }
    }
    return aus.sort((x, y) => y.beruehrungen - x.beruehrungen || y.i2 - x.i2 || x.i1 - y.i1)
}

/** Beste haltende Linie einer Seite, oder null. Anker sind immer echte Hochs/Tiefs. */
export function besteTrendlinie(kerzen, seite, opt = {}) {
    return alleTrendlinien(kerzen, seite, opt)[0] || null
}

/** Wie viele Kerzen über die letzte hinaus gezeichnet wird. */
export function verlaengerung(n, i1) {
    return Math.max(TREND.VERL_MIN, Math.min(TREND.VERL_MAX, Math.round(TREND.VERL_ANTEIL * (n - 1 - i1))))
}

/** ATR der letzten Kerze (Hilfe für Aufrufer ohne eigenen Wert). */
export const letzteAtr = (kerzen) => { const a = atrReihe(kerzen, 14); return a[a.length - 1] }
