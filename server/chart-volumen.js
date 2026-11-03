/**
 * Volumen eines Chart-Musters (03.11.2026) — die harte Grösse neben der Geometrie:
 * im Keil, Dreieck oder Rechteck nimmt das Volumen typischerweise ab, beim Ausbruch
 * steigt es deutlich. Ein Ausbruch ohne Volumen ist im Krypto-Chart oft ein
 * Fehlausbruch. Rein; ohne Volumen in den Kerzen (0/fehlend) `null`, nie 0.
 */

/** Erste Kerze der Schlüsse jenseits einer Kante am Ende, sonst `null`. */
export function ausbruchAb(kerzen, oben, unten, tol) {
    const n = kerzen.length
    let i = n
    while (i > 0) {
        const c = kerzen[i - 1].c
        if (c > oben(i - 1) + tol || c < unten(i - 1) - tol) i--
        else break
    }
    return i < n ? i : null
}

const mittel = (kerzen, von, bis) => {
    let s = 0, z = 0
    for (let i = Math.max(0, von); i <= bis; i++) { const v = Number(kerzen[i]?.v); if (v > 0) { s += v; z++ } }
    return z ? s / z : null
}

/**
 * @param {number} von      erste Kerze des Musters
 * @param {number|null} ausbruch  Ausbruchskerze (oder null)
 * @returns {{ verlaufPct: number|null, ausbruchFaktor: number|null } | null}
 *   verlaufPct: zweite Hälfte des Musters gegen die erste, in %;
 *   ausbruchFaktor: Volumen der Ausbruchskerze gegen den Schnitt im Muster.
 */
export function volumenImMuster(kerzen, von, ausbruch = null) {
    const n = kerzen?.length || 0
    const ende = (ausbruch ?? n) - 1
    if (n < 2 || !(ende - von >= 5)) return null
    const mitte = Math.floor((von + ende) / 2)
    const a = mittel(kerzen, von, mitte), b = mittel(kerzen, mitte + 1, ende)
    const ganz = mittel(kerzen, von, ende)
    const va = ausbruch != null ? Number(kerzen[ausbruch]?.v) : null
    const verlaufPct = a && b ? (b / a - 1) * 100 : null
    const ausbruchFaktor = va > 0 && ganz ? va / ganz : null
    return verlaufPct == null && ausbruchFaktor == null ? null : { verlaufPct, ausbruchFaktor }
}

/** Kurztext für den Kandidatentext: „Volumen im Muster −35 %, Ausbruchskerze 2.4× Schnitt". */
export function volumenText(v, englisch = false) {
    if (!v) return englisch ? 'volume unknown' : 'Volumen unbekannt'
    const teile = []
    if (v.verlaufPct != null) teile.push(`${englisch ? 'volume in pattern' : 'Volumen im Muster'} ${v.verlaufPct >= 0 ? '+' : '−'}${Math.abs(Math.round(v.verlaufPct))} %`)
    if (v.ausbruchFaktor != null) teile.push(`${englisch ? 'breakout candle' : 'Ausbruchskerze'} ${v.ausbruchFaktor.toFixed(1)}× ${englisch ? 'average' : 'Schnitt'}`)
    return teile.join(', ')
}
