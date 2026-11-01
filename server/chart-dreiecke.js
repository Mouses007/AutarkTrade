/**
 * Dreiecke und Keile — zusammenlaufende Formationen, vom Code gemessen wie die
 * Kanäle (`kandidatenKanaele`), damit die KI sie nur noch auswählt. Rein.
 *
 * Bis 31.10.2026 fand der Code die beiden Kanten nur als zwei einzelne
 * Trendlinien; ein Dreieck „erkannte" die KI höchstens zufällig im Text.
 *
 * Form nach der Steigung der Kanten über die Länge der Formation (in ATR):
 *   symmetrisch     Hochs fallend, Tiefs steigend
 *   aufsteigend     Hochs waagerecht, Tiefs steigend
 *   absteigend      Hochs fallend, Tiefs waagerecht
 *   steigenderKeil  beide steigend, die untere steiler (läuft zusammen)
 *   fallenderKeil   beide fallend, die obere steiler (läuft zusammen)
 * „Waagerecht" heisst: weniger als `DREIECK.FLACH_ATR` über die Länge.
 *
 * Bedingungen: jede Kante durch zwei echte Wendepunkte, je Kante ≥ 2 und
 * zusammen ≥ `MIN_SUMME` (6) Berührungen; die Höhe schrumpft bis jetzt auf
 * höchstens `MAX_RESTHOEHE` der Anfangshöhe, die Spitze liegt noch vor oder
 * höchstens kurz hinter der letzten Kerze; Schlüsse draussen wie beim Kanal
 * (kurze Ausflüge ja, weit draussen nein) — ausser am Ende: dort ist es ein
 * Bruch (`bruch` oben/unten).
 */
import { pivotHighs, pivotLows } from '../shared/indicators.js'

export const DREIECK = {
    FENSTER: [240, 180, 140, 110, 90, 70, 55, 40, 30],
    BASIS_KERZEN: 80,
    BERUEHR_ATR: 0.35,
    UEBERSCHUSS_ATR: 0.6,
    DOCHT_ATR: 1,
    MAX_FOLGE: 2,
    MAX_AUSSEN: 0.1,
    MIN_SUMME: 6,             // wie beim Kanal; mit 5 fand sich auf fast jedem Chart ein „Dreieck" mit 2/3 Berührungen
    FLACH_ATR: 0.75,          // Kante über die Länge weniger geneigt: waagerecht
    MIN_HOEHE_ATR: 1.5,       // Höhe am Anfang: kleiner ist es Rauschen
    MAX_HOEHE_ATR: 14,
    MAX_RESTHOEHE: 0.75,      // jetzt höchstens so viel der Anfangshöhe übrig — sonst läuft nichts zusammen
    SPITZE_NACH: 0.15,        // Spitze darf höchstens so viel der Länge HINTER der letzten Kerze schon erreicht sein
    SPITZE_VOR: 2,            // … und höchstens so viele Längen voraus liegen
    MAX_KANTEN: 6,            // je Seite die besten so vielen Kanten kombinieren
}

/** Form aus den Steigungen (Preis über die ganze Länge, in ATR). */
export function dreieckForm(steigOben, steigUnten, flach = DREIECK.FLACH_ATR) {
    const o = Math.abs(steigOben) < flach ? 0 : Math.sign(steigOben)
    const u = Math.abs(steigUnten) < flach ? 0 : Math.sign(steigUnten)
    if (o < 0 && u > 0) return 'symmetrisch'
    if (o === 0 && u > 0) return 'aufsteigend'
    if (o < 0 && u === 0) return 'absteigend'
    if (o > 0 && u > 0 && steigUnten > steigOben) return 'steigenderKeil'
    if (o < 0 && u < 0 && steigOben < steigUnten) return 'fallenderKeil'
    return null
}

/**
 * @param {Array<{t,o,h,l,c}>} kerzen
 * @param {number} A  ATR(14) der letzten Kerze
 * @returns {Array} höchstens zwei Formationen (die beste kurze und die beste lange)
 */
export function kandidatenDreiecke(kerzen, A) {
    const n = kerzen?.length || 0
    if (n < 30 || !(A > 0)) return []
    const kurs = kerzen[n - 1].c
    const wp = {}
    const wendepunkte = (k) => (wp[k] ||= { H: pivotHighs(kerzen, k, k).map((p) => p.index), T: pivotLows(kerzen, k, k).map((p) => p.index) })
    const fenster = [...new Set(DREIECK.FENSTER)].filter((L) => L >= 25 && L <= n - 5).sort((a, b) => b - a)
    const funde = []
    for (const L of fenster) {
        const Aw = A * Math.max(1, Math.sqrt(L / DREIECK.BASIS_KERZEN))
        const tol = DREIECK.BERUEHR_ATR * Aw, ueber = DREIECK.UEBERSCHUSS_ATR * Aw, docht = DREIECK.DOCHT_ATR * Aw
        const { H: hochs, T: tiefs } = wendepunkte(L >= 120 ? 4 : L >= 60 ? 3 : 2)
        const s = n - L
        const H = hochs.filter((i) => i >= s), T = tiefs.filter((i) => i >= s)
        if (H.length < 2 || T.length < 2) continue

        // Kandidaten je Kante: Gerade durch zwei Wendepunkte, keine Kerze schliesst ab dem
        // ersten Anker weit darüber (oben) bzw. darunter (unten), ausser ganz am Ende (Bruch)
        const kanten = (oben) => {
            const P = oben ? H : T
            const wert = (i) => (oben ? kerzen[i].h : kerzen[i].l)
            const aus = []
            for (let x = 0; x < P.length; x++) {
                for (let y = x + 1; y < P.length; y++) {
                    const i1 = P[x], i2 = P[y]
                    if (i2 - i1 < L / 5) continue
                    const m = (wert(i2) - wert(i1)) / (i2 - i1)
                    const g = (i) => wert(i1) + m * (i - i1)
                    let weit = false
                    for (let i = i1; i < n - DREIECK.MAX_FOLGE; i++) {
                        const c = kerzen[i].c
                        if (oben ? c > g(i) + docht : c < g(i) - docht) { weit = true; break }
                    }
                    if (weit) continue
                    const ber = P.filter((i) => i >= i1 - 1 && (oben
                        ? kerzen[i].h >= g(i) - tol && kerzen[i].h <= g(i) + ueber
                        : kerzen[i].l <= g(i) + tol && kerzen[i].l >= g(i) - ueber)).length
                    if (ber < 2) continue
                    aus.push({ i1, m, g, ber })
                }
            }
            return aus.sort((a, b) => b.ber - a.ber || a.i1 - b.i1).slice(0, DREIECK.MAX_KANTEN)
        }
        const obenK = kanten(true), untenK = kanten(false)
        for (const ok of obenK) {
            for (const uk of untenK) {
                const anfang = Math.min(ok.i1, uk.i1)
                const laenge = n - anfang
                if (laenge < L * 0.6) continue
                const hoehe0 = ok.g(anfang) - uk.g(anfang)
                const hoeheJ = ok.g(n - 1) - uk.g(n - 1)
                if (!(hoehe0 >= DREIECK.MIN_HOEHE_ATR * Aw) || hoehe0 > DREIECK.MAX_HOEHE_ATR * Aw) continue
                if (!(ok.m < uk.m)) continue                               // läuft nicht zusammen
                const spitze = anfang + hoehe0 / (uk.m - ok.m)             // dort treffen sich die Kanten
                if (spitze < n - 1 - DREIECK.SPITZE_NACH * laenge || spitze > n - 1 + DREIECK.SPITZE_VOR * laenge) continue
                if (hoeheJ > DREIECK.MAX_RESTHOEHE * hoehe0) continue
                // Steigung der Kanten über die Länge, im Massstab des Fensters
                const f = dreieckForm((ok.m * laenge) / Aw, (uk.m * laenge) / Aw)
                if (!f) continue
                // Schlüsse draussen: kurze Ausflüge erlaubt; am Ende draussen = Bruch
                let aussen = 0, folge = 0, maxFolge = 0
                for (let i = anfang; i < n; i++) {
                    const c = kerzen[i].c
                    const hi = ok.g(i), lo = uk.g(i)
                    const raus = c > hi + tol || c < lo - tol
                    if (raus) { aussen++; folge++ } else { maxFolge = Math.max(maxFolge, folge); folge = 0 }
                }
                if (maxFolge > DREIECK.MAX_FOLGE || aussen > DREIECK.MAX_AUSSEN * laenge + folge) continue
                const bO = ok.ber, bU = uk.ber
                if (bO + bU < DREIECK.MIN_SUMME) continue
                const c = kerzen[n - 1].c
                const bruch = c > ok.g(n - 1) + tol ? 'oben' : c < uk.g(n - 1) - tol ? 'unten' : null
                if (folge > DREIECK.MAX_FOLGE && !bruch) continue
                const iv = (kerzen[n - 1].t - kerzen[anfang].t) / Math.max(1, laenge - 1)
                // Gezeichnet bis zur Spitze, höchstens ein Viertel der Länge über die letzte Kerze hinaus
                const ende = Math.min(spitze, n - 1 + Math.max(3, Math.round(laenge * 0.25)))
                const zeit = (x) => kerzen[anfang].t + (x - anfang) * iv
                const mitte = (ok.g(n - 1) + uk.g(n - 1)) / 2
                funde.push({
                    quelle: 'dreieck', form: f, laenge,
                    tA: kerzen[anfang].t, obenA: ok.g(anfang), untenA: uk.g(anfang),
                    tE: zeit(ende), obenE: ok.g(ende), untenE: uk.g(ende),
                    obenJetzt: ok.g(n - 1), untenJetzt: uk.g(n - 1),
                    spitzeT: zeit(spitze), spitzeP: ok.g(spitze),
                    hoeheAtr: hoehe0 / A, restPct: (hoeheJ / hoehe0) * 100,
                    fortschrittPct: Math.min(150, ((n - 1 - anfang) / Math.max(1, spitze - anfang)) * 100),
                    beruehrOben: bO, beruehrUnten: bU, ausserhalb: aussen, bruch,
                    preis: mitte, abstandAtr: (mitte - kurs) / A,
                    wert: bO + bU - aussen * 0.5 + laenge / 200,
                })
            }
        }
    }
    funde.sort((a, b) => b.wert - a.wert)
    // Wie bei den Kanälen: die beste kurze und die beste lange (über ⅓ des Fensters)
    const grenze = 0.33 * n
    const lang = funde.find((k) => k.laenge >= grenze)
    const kurz = funde.find((k) => k.laenge < grenze && (!lang || k.laenge * 2 <= lang.laenge))
    return [lang, kurz].filter(Boolean).map(({ wert, ...k }) => k)
}

const NAMEN = {
    symmetrisch: ['Symmetrisches Dreieck', 'Symmetrical triangle'],
    aufsteigend: ['Aufsteigendes Dreieck', 'Ascending triangle'],
    absteigend: ['Absteigendes Dreieck', 'Descending triangle'],
    steigenderKeil: ['Steigender Keil', 'Rising wedge'],
    fallenderKeil: ['Fallender Keil', 'Falling wedge'],
}
const BRUCH = { oben: [', nach oben gebrochen', ', broken up'], unten: [', nach unten gebrochen', ', broken down'] }

/** Kurzer Name („Fallender Keil") — für jede weitere Nennung. */
export const dreieckKurz = (k, englisch = false) => NAMEN[k.form]?.[englisch ? 1 : 0] || (englisch ? 'Triangle' : 'Dreieck')
/** Beschriftung im Chart: Name plus Bruch. */
export const dreieckBeschriftung = (k, englisch = false) => dreieckKurz(k, englisch) + (k.bruch ? BRUCH[k.bruch][englisch ? 1 : 0] : '')
/** Name mit gemessenen Berührungen, vom Code vergeben. */
export function dreieckName(k, englisch = false) {
    const b = `${k.beruehrOben}/${k.beruehrUnten}`
    const br = k.bruch ? BRUCH[k.bruch][englisch ? 1 : 0] : ''
    return `${dreieckKurz(k, englisch)} (${b} ${englisch ? 'touches' : 'Berührungen'}${br})`
}
