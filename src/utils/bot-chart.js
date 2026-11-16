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
 * @param {{wert:number, immer?:boolean}[]} linien  Linien; `immer` = gehört sicher auf die Achse (nur der Kurs —
 *        ein Ø Einstieg weit weg drückte die Kerzen genauso zusammen wie eine ferne Liquidation, Audit UI-14)
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

/** Höchstens so viele Grid-Linien im Chart; darüber nur jede n-te. */
export const MAX_GRID_LINIEN = 80

/**
 * Dünnt eine Liste auf höchstens `max` Einträge aus (jeder n-te, n ganzzahlig, damit die
 * Abstände gleich bleiben). Vorher zeichnete der Chart über 80 Linien gar keine.
 * @returns {{werte:number[], jede:number}} jede = 1 heisst unverändert
 */
export function duenneAus(werte, max = MAX_GRID_LINIEN) {
    if (!Array.isArray(werte) || !(max >= 1) || werte.length <= max) return { werte: Array.isArray(werte) ? werte : [], jede: 1 }
    const jede = Math.ceil(werte.length / max)
    return { werte: werte.filter((_, i) => i % jede === 0), jede }
}

/** Mögliche Plätze einer Linien-Beschriftung (ECharts markLine): rechts/links, über/unter der Linie. */
export const PLAETZE = ['insideEndTop', 'insideEndBottom', 'insideStartTop', 'insideStartBottom']

/**
 * Wählt je beschrifteter Linie einen Platz, an dem der Text frei steht: nicht auf dem Text
 * einer anderen Linie und nicht so, dass eine andere Linie durch ihn läuft (dann wirkt er
 * durchgestrichen). «Ø Einstieg» und «Kurs» liegen oft wenige Pixel auseinander.
 *
 * Gerechnet wird in Pixeln der Zeichenfläche (0 = oben). Reihenfolge = Rang: wer vorn steht,
 * bekommt zuerst seinen Wunschplatz.
 * @param {{wert:number, text:string, wunsch?:string}[]} linien
 * @param {{lo:number, hi:number, hoehe:number, breite:number, hindernisse?:number[], zeile?:number, zeichen?:number}} o
 *        hindernisse = Werte unbeschrifteter Linien (Band-Enden); zeile = Texthöhe in px, zeichen = Breite je Zeichen
 * @returns {string[]} Platz je Linie
 */
export function legeBeschriftungen(linien, { lo, hi, hoehe, breite, hindernisse = [], zeile = 14, zeichen = 6.4 } = {}) {
    if (!(hi > lo) || !(hoehe > 0) || !(breite > 0)) return linien.map((l) => l.wunsch || PLAETZE[0])
    const y = (wert) => (hi - wert) / (hi - lo) * hoehe
    const alleY = [...linien.map((l) => y(l.wert)), ...hindernisse.map(y)]
    const kasten = (l, i, platz) => {
        const w = Math.min(breite - 8, String(l.text).length * zeichen)
        const yl = alleY[i]
        const oben = /Top$/.test(platz)
        return { x0: /End/.test(platz) ? breite - 4 - w : 4, x1: /End/.test(platz) ? breite - 4 : 4 + w, y0: oben ? yl - zeile - 2 : yl + 2, y1: oben ? yl - 2 : yl + zeile + 2 }
    }
    const belegt = []
    return linien.map((l, i) => {
        const wahl = [...new Set([l.wunsch, ...PLAETZE].filter(Boolean))]
        let best = wahl[0], bestMalus = Infinity, bestK = null
        wahl.forEach((platz, rang) => {
            const k = kasten(l, i, platz)
            let malus = rang
            for (const b of belegt) if (k.x0 < b.x1 && b.x0 < k.x1 && k.y0 < b.y1 && b.y0 < k.y1) malus += 100
            // eine fremde Linie quer durch den Text (Linien laufen über die ganze Breite)
            alleY.forEach((ly, j) => { if (j !== i && ly > k.y0 && ly < k.y1) malus += 10 })
            if (k.y0 < 0 || k.y1 > hoehe) malus += 50
            if (malus < bestMalus) { best = platz; bestMalus = malus; bestK = k }
        })
        belegt.push(bestK)
        return best
    })
}
