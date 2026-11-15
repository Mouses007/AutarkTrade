/**
 * Kennzahlen des Newcomer-Radars aus Tageskerzen (rein, ohne Netz).
 *
 * Eingabe: abgeschlossene Tageskerzen `[{t, o, h, l, c, v}]`, aufsteigend.
 * Unbekannt bleibt unbekannt: reicht die Historie für eine Kennzahl nicht,
 * ist sie `null` — nie 0. Eine Firma, die seit drei Wochen an der Börse ist,
 * hat keine 3-Monats-Rendite, auch keine von null Prozent.
 */

const TAG_MS = 86400e3
export const TAGE_JAHR = 252
const TAGE_MONAT = 21

const mittel = (liste) => (liste.length ? liste.reduce((s, x) => s + x, 0) / liste.length : null)
const runde = (x, stellen = 2) => (x == null || !Number.isFinite(x) ? null : Number(x.toFixed(stellen)))

/** Rendite in % über die letzten `n` Handelstage; `null`, wenn es die Kerze davor nicht gibt. */
export function rendite(kerzen, n) {
    if (kerzen.length <= n) return null
    const alt = kerzen[kerzen.length - 1 - n].c
    const neu = kerzen[kerzen.length - 1].c
    return alt > 0 ? (neu / alt - 1) * 100 : null
}

/**
 * @param {{t:number,o:number,h:number,l:number,c:number,v:number}[]} kerzen
 * @param {{jetzt?: number, ipoDatum?: number|null, referenz?: {perf3m: number|null}|null}} [opt]
 */
export function kennzahlen(kerzen, opt = {}) {
    const jetzt = opt.jetzt ?? Date.now()
    const n = kerzen.length
    const alterTage = opt.ipoDatum ? Math.max(0, Math.floor((jetzt - opt.ipoDatum) / TAG_MS)) : null
    if (!n) return { tage: 0, alterTage }

    const letzte = kerzen[n - 1]
    const kurs = letzte.c

    // 52-Wochen-Hoch (oder das Hoch der ganzen Historie, wenn sie kürzer ist).
    const fenster = kerzen.slice(-TAGE_JAHR)
    let hoch = -Infinity, hochIndex = 0
    fenster.forEach((k, i) => { if (k.h >= hoch) { hoch = k.h; hochIndex = i } })
    const abstandHochPct = hoch > 0 ? (kurs / hoch - 1) * 100 : null

    const perf3m = rendite(kerzen, 3 * TAGE_MONAT)
    const refPerf = opt.referenz?.perf3m
    const sma50 = n >= 50 ? mittel(kerzen.slice(-50).map((k) => k.c)) : null

    // Relatives Volumen: die letzten 5 Tage gegen die 50 davor. Die 5 Tage
    // stehen NICHT in der Vergleichsbasis, sonst dämpft ein Ausreisser sich selbst.
    const vol5 = n >= 5 ? mittel(kerzen.slice(-5).map((k) => k.v || 0)) : null
    const basis = kerzen.slice(Math.max(0, n - 55), n - 5).map((k) => k.v || 0)
    const vol50 = basis.length >= 20 ? mittel(basis) : null
    const rvol = vol5 != null && vol50 > 0 ? vol5 / vol50 : null

    const letzte20 = kerzen.slice(-20)
    const umsatz20 = letzte20.length >= 5 ? mittel(letzte20.map((k) => k.c * (k.v || 0))) : null

    return {
        tage: n,
        alterTage,
        kurs: runde(kurs, 4),
        hoch52w: runde(hoch, 4),
        abstandHochPct: runde(abstandHochPct),
        hochVorTagen: fenster.length - 1 - hochIndex,
        perf1m: runde(rendite(kerzen, TAGE_MONAT)),
        perf3m: runde(perf3m),
        perf6m: runde(rendite(kerzen, 6 * TAGE_MONAT)),
        // Braucht gut ein Jahr Historie — für den Aktien-Radar (Stärke über 12 Monate).
        perf12m: runde(rendite(kerzen, TAGE_JAHR)),
        // Seit der ersten Kerze — nur aussagekräftig, solange die Historie kürzer als ein Jahr ist.
        seitStartPct: n >= 2 && n < TAGE_JAHR && kerzen[0].o > 0 ? runde((kurs / kerzen[0].o - 1) * 100) : null,
        relStaerke3m: perf3m != null && refPerf != null ? runde(perf3m - refPerf) : null,
        ueberSma50: sma50 != null ? kurs > sma50 : null,
        rvol: runde(rvol),
        umsatz20: umsatz20 != null ? Math.round(umsatz20) : null,
        letzteKerze: letzte.t,
    }
}
