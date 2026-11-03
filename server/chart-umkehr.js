/**
 * Umkehrmuster — Doppeltop/-boden, Dreifach-Top/-Boden und Kopf-Schulter (normal und invers), vom
 * Code gemessen wie Kanäle und Dreiecke, damit die KI sie nur noch auswählt.
 * Rein (03.11.2026).
 *
 * Grundlage ist ein Zickzack (`zickzack`) mit einer Umkehrschwelle in ATR; gesucht
 * wird auf mehreren Stufen (`UMKEHR.STUFEN_ATR`), damit kleine und grosse Muster
 * gefunden werden. Ein Muster besteht nur aus BESTÄTIGTEN Wendepunkten — der noch
 * laufende Schwung am Ende zählt nicht, sonst wäre jedes neue Hoch ein „zweites Top".
 *
 *   Doppeltop     Hoch H1, Tief N (Nackenlinie, waagerecht), Hoch H2: die Hochs höchstens
 *                 `DOPPEL_GLEICH` × Tiefe auseinander, Tiefe ≥ `MIN_TIEFE_ATR`, dazwischen
 *                 ≥ `MIN_ABSTAND` Kerzen, davor ein Anstieg von mindestens der Tiefe
 *                 (`VORLAUF`), beide Hälften ähnlich lang (`ZEIT_VERHAELTNIS`). Doppelboden
 *                 gespiegelt.
 *   Dreifach-Top  wie das Doppeltop mit drei gleich hohen Tops (Spanne ≤ `DOPPEL_GLEICH` ×
 *                 Tiefe), die beiden Tiefs ähnlich (`DREIFACH_TIEFS`), Nackenlinie am
 *                 tieferen; Dreifach-Boden gespiegelt.
 *   Kopf-Schulter Schulter S1, Tief N1, Kopf K, Tief N2, Schulter S2: der Kopf steht
 *                 über beiden Schultern (≥ `KOPF_UEBER` der Kopfhöhe), die Schultern sind
 *                 ähnlich hoch (≤ `SCHULTER_GLEICH`), liegen deutlich über der Nackenlinie
 *                 durch N1–N2 (≥ `SCHULTER_HOEHE`), die Nackenlinie ist nicht steil
 *                 (`NACKEN_SCHRAEG`), die rechte Seite ist zeitlich nicht völlig anders als die
 *                 linke (`ZEIT_VERHAELTNIS`), davor ein Anstieg. Inverse gespiegelt.
 *   Zustand       nach dem letzten Punkt: ein Schluss jenseits der Nackenlinie = `bruch`
 *                 (bestätigt); ein Schluss über dem Top bzw. dem Kopf (vor oder nach dem
 *                 Bruch) = verworfen. Zu alt: letzter Punkt mehr als `MAX_ALTER` × Muster-
 *                 länge zurück, oder Bruch mehr als `BRUCH_MAX_ALTER` × Musterlänge.
 *
 * Kein Kursziel: die Höhe steht als Messung da (`hoeheAtr`), ein „Ziel = Nacken −
 * Höhe" gibt es bewusst nicht (keine Kursziele, S12).
 */
import { volumenImMuster } from './chart-volumen.js'

export const UMKEHR = {
    STUFEN_ATR: [1.5, 2.5, 4, 6],
    DOPPEL_GLEICH: 0.2,
    MIN_TIEFE_ATR: 2,
    MIN_ABSTAND: 6,
    VORLAUF: 1,
    KOPF_UEBER: 0.15,
    SCHULTER_GLEICH: 0.3,
    SCHULTER_HOEHE: 0.3,
    NACKEN_SCHRAEG: 0.4,
    ZEIT_VERHAELTNIS: 3,
    DREIFACH_TIEFS: 0.35,     // die beiden Tiefs zwischen den drei Tops höchstens so viel der Tiefe auseinander
    MIN_KOPF_ATR: 2.5,
    MAX_ALTER: 0.6,
    BRUCH_MAX_ALTER: 0.4,
    BRUCH_ATR: 0.1,
}

/**
 * Zickzack: abwechselnd Hochs und Tiefs, eine Umkehr ab `S` Preis Gegenbewegung.
 * Liefert nur die bestätigten Wendepunkte [{ i, p, hoch }] — der laufende fehlt.
 */
export function zickzack(kerzen, S) {
    const n = kerzen.length
    const aus = []
    if (n < 3) return aus
    // Richtung: 0 offen, 1 aufwärts (sucht das nächste Hoch), -1 abwärts. hoch/tief: Index des
    // Extrems seit dem letzten Wendepunkt.
    let richtung = 0, hoch = 0, tief = 0
    kerzen.forEach(({ h, l }, i) => {
        if (!i) return
        if (h >= kerzen[hoch].h) hoch = i
        if (l <= kerzen[tief].l) tief = i
        const letzt = aus[aus.length - 1]
        if (richtung >= 0 && hoch < i && kerzen[hoch].h - l >= S) {
            if (!letzt || !letzt.hoch) aus.push({ i: hoch, p: kerzen[hoch].h, hoch: true })
            richtung = -1; tief = i
        } else if (richtung <= 0 && tief < i && h - kerzen[tief].l >= S) {
            if (!letzt || letzt.hoch) aus.push({ i: tief, p: kerzen[tief].l, hoch: false })
            richtung = 1; hoch = i
        }
    })
    // Erste Wendepunkte können doppelt dieselbe Seite tragen, wenn die Richtung am Anfang kippt
    return aus.filter((w, j) => !j || w.hoch !== aus[j - 1].hoch)
}

// Spiegeln: ein Boden ist ein Top der negierten Kerzen
const gespiegelt = (kerzen) => kerzen.map((k) => ({ ...k, o: -k.o, h: -k.l, l: -k.h, c: -k.c }))

/** Zustand nach dem letzten Punkt `ab`: Bruch der Nackenlinie `nacken(i)`, verworfen über `oben`. */
function zustand(kerzen, ab, nacken, oben, tol) {
    let bruch = null
    for (let i = ab + 1; i < kerzen.length; i++) {
        const c = kerzen[i].c
        if (c > oben + tol) return null                                     // über Top bzw. Kopf: verworfen
        if (bruch == null && c < nacken(i) - tol) bruch = i
    }
    return { bruch }
}

function suche(kerzen, A, art) {
    const n = kerzen.length
    const tol = UMKEHR.BRUCH_ATR * A
    const funde = []
    for (const stufe of UMKEHR.STUFEN_ATR) {
        const w = zickzack(kerzen, stufe * A)
        for (let j = 0; j < w.length; j++) {
            // Doppeltop: L0 (tief) → H1 → N → H2
            if (art === 'doppel' && j >= 3 && w[j].hoch) {
                const [l0, h1, nk, h2] = w.slice(j - 3, j + 1)
                if (l0.hoch || !h1.hoch || nk.hoch) continue
                const tiefe = Math.min(h1.p, h2.p) - nk.p
                if (tiefe < UMKEHR.MIN_TIEFE_ATR * A) continue
                if (Math.abs(h1.p - h2.p) > UMKEHR.DOPPEL_GLEICH * tiefe) continue
                if (h2.i - h1.i < UMKEHR.MIN_ABSTAND) continue
                if (h1.p - l0.p < UMKEHR.VORLAUF * tiefe) continue
                // Beide Hälften ähnlich lang — sonst ist das zweite „Top" ein langsames Abdriften
                if (nk.i - h1.i > UMKEHR.ZEIT_VERHAELTNIS * (h2.i - nk.i) || h2.i - nk.i > UMKEHR.ZEIT_VERHAELTNIS * (nk.i - h1.i)) continue
                const z = zustand(kerzen, h2.i, () => nk.p, Math.max(h1.p, h2.p), tol)
                if (!z) continue
                const laenge = h2.i - h1.i
                if (n - 1 - h2.i > Math.max(10, UMKEHR.MAX_ALTER * laenge) && z.bruch == null) continue
                if (z.bruch != null && n - 1 - z.bruch > Math.max(6, UMKEHR.BRUCH_MAX_ALTER * laenge)) continue
                funde.push({ punkte: [l0, h1, nk, h2], nacken: [{ i: h1.i, p: nk.p }, { i: h2.i, p: nk.p }], steig: 0, hoehe: tiefe, bruch: z.bruch, laenge, stufe })
            }
            // Dreifach-Top: L0 → H1 → N1 → H2 → N2 → H3, drei gleich hohe Tops, Nackenlinie am tieferen Tief
            if (art === 'dreifach' && j >= 5 && w[j].hoch) {
                const [l0, h1, n1, h2, n2, h3] = w.slice(j - 5, j + 1)
                if (l0.hoch || !h1.hoch || n1.hoch || !h2.hoch || n2.hoch) continue
                const tops = [h1.p, h2.p, h3.p]
                const nackenP = Math.min(n1.p, n2.p)
                const tiefe = Math.min(...tops) - Math.max(n1.p, n2.p)
                if (tiefe < UMKEHR.MIN_TIEFE_ATR * A) continue
                if (Math.max(...tops) - Math.min(...tops) > UMKEHR.DOPPEL_GLEICH * tiefe) continue
                if (Math.abs(n1.p - n2.p) > UMKEHR.DREIFACH_TIEFS * tiefe) continue
                if (h2.i - h1.i < UMKEHR.MIN_ABSTAND || h3.i - h2.i < UMKEHR.MIN_ABSTAND) continue
                if (h2.i - h1.i > UMKEHR.ZEIT_VERHAELTNIS * (h3.i - h2.i) || h3.i - h2.i > UMKEHR.ZEIT_VERHAELTNIS * (h2.i - h1.i)) continue
                if (h1.p - l0.p < UMKEHR.VORLAUF * tiefe) continue
                const z = zustand(kerzen, h3.i, () => nackenP, Math.max(...tops), tol)
                if (!z) continue
                const laenge = h3.i - h1.i
                if (n - 1 - h3.i > Math.max(10, UMKEHR.MAX_ALTER * laenge) && z.bruch == null) continue
                if (z.bruch != null && n - 1 - z.bruch > Math.max(6, UMKEHR.BRUCH_MAX_ALTER * laenge)) continue
                funde.push({ punkte: [l0, h1, n1, h2, n2, h3], nacken: [{ i: h1.i, p: nackenP }, { i: h3.i, p: nackenP }], steig: 0, hoehe: tiefe, bruch: z.bruch, laenge, stufe })
            }
            // Kopf-Schulter: L0 → S1 → N1 → K → N2 → S2
            if (art === 'ks' && j >= 5 && w[j].hoch) {
                const [l0, s1, n1, kopf, n2, s2] = w.slice(j - 5, j + 1)
                if (l0.hoch || !s1.hoch || n1.hoch || !kopf.hoch || n2.hoch) continue
                const m = (n2.p - n1.p) / (n2.i - n1.i)
                const nacken = (i) => n1.p + m * (i - n1.i)
                const h = kopf.p - nacken(kopf.i)
                if (h < UMKEHR.MIN_KOPF_ATR * A) continue
                if (kopf.p - Math.max(s1.p, s2.p) < UMKEHR.KOPF_UEBER * h) continue
                if (Math.abs(s1.p - s2.p) > UMKEHR.SCHULTER_GLEICH * h) continue
                if (s1.p - nacken(s1.i) < UMKEHR.SCHULTER_HOEHE * h || s2.p - nacken(s2.i) < UMKEHR.SCHULTER_HOEHE * h) continue
                if (Math.abs(n2.p - n1.p) > UMKEHR.NACKEN_SCHRAEG * h) continue
                const links = kopf.i - s1.i, rechts = s2.i - kopf.i
                if (rechts > UMKEHR.ZEIT_VERHAELTNIS * links || links > UMKEHR.ZEIT_VERHAELTNIS * rechts) continue
                if (s1.p - l0.p < 0.5 * h) continue
                const z = zustand(kerzen, s2.i, nacken, kopf.p, tol)
                if (!z) continue
                const laenge = s2.i - s1.i
                if (n - 1 - s2.i > Math.max(10, UMKEHR.MAX_ALTER * laenge) && z.bruch == null) continue
                if (z.bruch != null && n - 1 - z.bruch > Math.max(6, UMKEHR.BRUCH_MAX_ALTER * laenge)) continue
                funde.push({ punkte: [l0, s1, n1, kopf, n2, s2], nacken: [{ i: n1.i, p: n1.p }, { i: n2.i, p: n2.p }], steig: m, hoehe: h, bruch: z.bruch, laenge, stufe })
            }
        }
    }
    return funde
}

/**
 * @param {Array<{t,o,h,l,c}>} kerzen
 * @param {number} A  ATR(14) der letzten Kerze
 * @returns {Array} höchstens zwei Muster (das jüngste Top-Muster und das jüngste Boden-Muster)
 */
export function kandidatenUmkehr(kerzen, A) {
    const n = kerzen?.length || 0
    if (n < 30 || !(A > 0)) return []
    const kurs = kerzen[n - 1].c
    const spiegel = gespiegelt(kerzen)
    const alle = []
    for (const [art, oben] of [['doppel', true], ['doppel', false], ['dreifach', true], ['dreifach', false], ['ks', true], ['ks', false]]) {
        for (const f of suche(oben ? kerzen : spiegel, A, art)) alle.push({ ...f, art, oben })
    }
    const aus = alle.map((f) => {
        const s = f.oben ? 1 : -1
        const p = (x) => s * x
        const form = f.art === 'doppel' ? (f.oben ? 'doppeltop' : 'doppelboden') : f.art === 'dreifach' ? (f.oben ? 'dreifachtop' : 'dreifachboden') : (f.oben ? 'kopfSchulter' : 'inverseKopfSchulter')
        const letzter = f.punkte[f.punkte.length - 1].i
        const nackenBei = (i) => p(f.nacken[0].p + f.steig * (i - f.nacken[0].i))
        // Nackenlinie bis zum Bruch bzw. bis jetzt, ein Stück darüber hinaus
        const bis = Math.min(n - 1 + Math.max(3, Math.round(f.laenge * 0.2)), (f.bruch ?? n - 1) + Math.max(3, Math.round(f.laenge * 0.2)))
        const iv = (kerzen[n - 1].t - kerzen[0].t) / Math.max(1, n - 1)
        const zeit = (i) => (i < n ? kerzen[i].t : kerzen[n - 1].t + (i - n + 1) * iv)
        const jetzt = nackenBei(n - 1)
        return {
            quelle: 'umkehr', form,
            punkte: f.punkte.map((w) => ({ t: kerzen[w.i].t, p: p(w.p) })),
            nacken: { t1: kerzen[f.nacken[0].i].t, p1: nackenBei(f.nacken[0].i), t2: zeit(bis), p2: nackenBei(bis) },
            nackenJetzt: jetzt, hoeheAtr: f.hoehe / A, laenge: f.laenge,
            volumen: volumenImMuster(kerzen, f.punkte[1].i, f.bruch),
            bruch: f.bruch != null, bruchT: f.bruch != null ? kerzen[f.bruch].t : null,
            tA: kerzen[f.punkte[0].i].t, tE: kerzen[letzter].t,
            preis: jetzt, abstandAtr: (jetzt - kurs) / A,
            // jünger, grösser; bei Gleichstand Dreifach vor Kopf-Schulter vor Doppel (das Dreifach-Top
            // enthält ein Doppeltop aus seinen letzten zwei Tops)
            wert: letzter / n * 10 + Math.min(f.hoehe / A, 10) * 0.3 + (f.art === 'dreifach' ? 0.7 : f.art === 'ks' ? 0.5 : 0),
        }
    })
    // Je Richtung (Top/Boden) das beste; dieselben Punkte aus mehreren Stufen nur einmal
    aus.sort((a, b) => b.wert - a.wert)
    const oben = aus.find((x) => x.form === 'doppeltop' || x.form === 'dreifachtop' || x.form === 'kopfSchulter')
    const unten = aus.find((x) => x.form === 'doppelboden' || x.form === 'dreifachboden' || x.form === 'inverseKopfSchulter')
    return [oben, unten].filter(Boolean).sort((a, b) => b.wert - a.wert).map(({ wert, ...x }) => x)
}

const NAMEN = {
    doppeltop: ['Doppeltop', 'Double top'],
    doppelboden: ['Doppelboden', 'Double bottom'],
    dreifachtop: ['Dreifach-Top', 'Triple top'],
    dreifachboden: ['Dreifach-Boden', 'Triple bottom'],
    kopfSchulter: ['Kopf-Schulter', 'Head and shoulders'],
    inverseKopfSchulter: ['Inverse Kopf-Schulter', 'Inverse head and shoulders'],
}

/** Kurzer Name („Doppelboden") — für jede weitere Nennung. */
export const umkehrKurz = (k, englisch = false) => NAMEN[k.form]?.[englisch ? 1 : 0] || (englisch ? 'Reversal pattern' : 'Umkehrmuster')
/** Beschriftung im Chart: Name plus Zustand der Nackenlinie. */
export const umkehrBeschriftung = (k, englisch = false) => umkehrKurz(k, englisch) + (k.bruch
    ? (englisch ? ', neckline broken' : ', Nackenlinie gebrochen')
    : (englisch ? ', neckline not broken' : ', Nackenlinie nicht gebrochen'))
/** Name mit Messung, vom Code vergeben. */
export function umkehrName(k, englisch = false) {
    return `${umkehrBeschriftung(k, englisch)} (${englisch ? 'height' : 'Höhe'} ${k.hoeheAtr.toFixed(1)} ATR)`
}
