/**
 * Rein: Skala und Linien für den Kurs-Chart der Bot-Seite (BotDetail.vue).
 *
 * Die Achse folgt den Kerzen und dem, was nahe liegt. Was weit weg liegt
 * (Liquidation 20 % tiefer, Band-Ende bei 1.30 bei Kursen um 0.90), drückte die
 * Kerzen sonst in einen Streifen — es wird stattdessen als Randhinweis
 * („↓ Liq 0.7219 · −19.8 %") genannt.
 */

/** Anteil der Kerzenspanne, den ein Wert ausserhalb liegen darf und trotzdem auf die Achse kommt. */
export const NAH = 0.3

/**
 * Preise der Grid-Linien (anzahl + 1 Stück, inkl. Band-Enden), aufsteigend.
 * Coin-M verteilt Pionex auf dem inversen Preis (Coin je USD): arithmetisch dort,
 * also in USD unten dichter.
 */
export function gridStufen(unten, oben, anzahl, art, coinM = false) {
    if (!(unten > 0) || !(oben > unten) || !Number.isInteger(anzahl) || anzahl < 1 || anzahl > 1000) return []
    const n = anzahl
    if (String(art).toLowerCase() === 'geometric') {
        const f = Math.pow(oben / unten, 1 / n)
        return Array.from({ length: n + 1 }, (_, i) => (i === n ? oben : unten * f ** i))
    }
    if (coinM) {
        const a = 1 / oben, b = 1 / unten
        return Array.from({ length: n + 1 }, (_, i) => 1 / (b - (b - a) * i / n)).map((v, i) => (i === n ? oben : i === 0 ? unten : v))
    }
    return Array.from({ length: n + 1 }, (_, i) => (i === n ? oben : unten + (oben - unten) * i / n))
}

/**
 * Achsenbereich und was darauf passt.
 * @param {number[]} preise   Hochs und Tiefs der Kerzen
 * @param {{wert:number, immer?:boolean}[]} linien  Linien; `immer` = gehört sicher auf die Achse (Einstieg, Kurs)
 * @param {{unten?:number, oben?:number}} band
 * @returns {{lo, hi, innen(v): boolean}} lo/hi inkl. 4 % Rand
 */
export function chartSkala(preise, linien = [], band = {}) {
    const ok = (v) => typeof v === 'number' && Number.isFinite(v)
    const basis = [...preise.filter(ok), ...linien.filter((l) => l.immer && ok(l.wert)).map((l) => l.wert)]
    if (!basis.length) return null
    let lo = Math.min(...basis), hi = Math.max(...basis)
    const spanne = hi - lo || hi * 0.05
    const nah = (v) => ok(v) && v >= lo - NAH * spanne && v <= hi + NAH * spanne
    const kandidaten = [...linien.filter((l) => !l.immer).map((l) => l.wert), band.unten, band.oben].filter(nah)
    for (const v of kandidaten) { lo = Math.min(lo, v); hi = Math.max(hi, v) }
    // eine einzige flache Kerze: ohne Ersatzspanne wäre min = max
    const rand = ((hi - lo) || hi * 0.05 || 1) * 0.04
    lo -= rand; hi += rand
    return { lo, hi, innen: (v) => ok(v) && v >= lo && v <= hi }
}

/** Abstand eines Werts zum Kurs in Prozent (−19.8 = 19.8 % tiefer). */
export function abstandProzent(wert, kurs) {
    if (!(kurs > 0) || typeof wert !== 'number' || !Number.isFinite(wert)) return null
    return (wert / kurs - 1) * 100
}
