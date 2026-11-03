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
 * Bedingungen: jede Kante durch zwei echte Wendepunkte; der Kurs PENDELT
 * zwischen den Kanten (`pendel`): Schwünge, die mindestens `PENDEL_SCHWUNG` der
 * Höhe an ihrer Stelle umkehren, abwechselnd oben und unten, und jeder davon
 * endet an seiner Kante — mindestens `MIN_PENDEL` (5) solche Berührungen, je
 * Kante ≥ 2. Seit 03.11.2026: vorher reichten ≥ 6 Wendepunkte nahe den Kanten,
 * und AVAXUSDT 15m wurde ein „steigender Keil" aus einem einzigen V — Doppelhoch
 * und Doppeltief zählten je zweimal, zwischen den Kanten pendelte nichts. Die Höhe schrumpft bis jetzt auf
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
    MIN_SUMME: 6,             // Vorauswahl der Kanten: Wendepunkte nahe beiden Kanten zusammen
    MIN_PENDEL: 5,            // abwechselnde Berührungen (3 + 2), wie im Lehrbuch
    PENDEL_SCHWUNG: 0.5,      // ein Schwung kehrt um mindestens diesen Teil der Höhe an seiner Stelle um
    PENDEL_NAH: 0.12,         // … und endet höchstens so viel der Höhe vor seiner Kante
    PENDEL_UEBER: 0.08,       // … oder so viel darüber hinaus (ein Docht weit jenseits: die Kante stimmt dort nicht)
    PENDEL_BODEN_ATR: 0.1,    // kleiner Boden in ATR für alle drei, damit eine fast fertige Spitze nicht an Nullen scheitert
    FLACH_ATR: 0.75,          // Kante über die Länge weniger geneigt: waagerecht
    MIN_HOEHE_ATR: 1.5,       // Höhe am Anfang: kleiner ist es Rauschen
    MAX_HOEHE_ATR: 14,
    MAX_RESTHOEHE: 0.75,      // jetzt höchstens so viel der Anfangshöhe übrig — sonst läuft nichts zusammen
    SPITZE_NACH: 0.15,        // Spitze darf höchstens so viel der Länge HINTER der letzten Kerze schon erreicht sein
    SPITZE_VOR: 2,            // … und höchstens so viele Längen voraus liegen
    MAX_KANTEN: 6,            // je Seite die besten so vielen Kanten kombinieren
}

/**
 * Pendel zwischen zwei Kanten ab `ab`: Zickzack, dessen Umkehrschwelle mit der
 * Höhe schrumpft (`PENDEL_SCHWUNG` × Höhe). Jeder fertige Schwung muss an
 * seiner Kante enden (`PENDEL_NAH` davor bis `PENDEL_UEBER` darüber), sonst
 * reisst die Folge ab. Der letzte, noch laufende Schwung zählt nur, wenn er die
 * Kante schon erreicht hat (oder durchbricht: das ist der Bruch, keine Berührung).
 * Rein; liefert die Berührungen in zeitlicher Folge.
 */
export function pendel(kerzen, ab, go, gu, A, { jenseits = false, luecken = false } = {}) {
    const n = kerzen.length
    // Alles an der Höhe gemessen, nur ein kleiner Boden in ATR: eine Toleranz in ATR
    // allein ist bei einer schmalen Formation so breit wie die Formation selbst
    const hoehe = (i) => Math.max(go(i) - gu(i), 0)
    const schwelle = (i) => Math.max(DREIECK.PENDEL_BODEN_ATR * A, DREIECK.PENDEL_SCHWUNG * hoehe(i))
    const nah = (i) => DREIECK.PENDEL_BODEN_ATR * A + DREIECK.PENDEL_NAH * hoehe(i)
    const ueber = (i) => DREIECK.PENDEL_BODEN_ATR * A + DREIECK.PENDEL_UEBER * hoehe(i)
    // An der Kante: knapp davor oder höchstens `ueber` darüber hinaus — ein Docht weit
    // jenseits heisst, die Kante stimmt dort nicht
    // `jenseits` (Kanäle): ein Schwung darf über die Kante hinausschiessen — ob das zu weit
    // oder zu lange war, entscheiden dort die Schlüsse draussen; ein Dreieck läuft zusammen,
    // dort heisst ein weiter Stich, dass die Kante nicht stimmt
    const anKante = (s) => s.oben
        ? kerzen[s.i].h >= go(s.i) - nah(s.i) && (jenseits || kerzen[s.i].h <= go(s.i) + ueber(s.i))
        : kerzen[s.i].l <= gu(s.i) + nah(s.i) && (jenseits || kerzen[s.i].l >= gu(s.i) - ueber(s.i))
    // Zickzack: Richtung aus der ersten Kerze, die näher an einer Kante liegt
    const schwuenge = []
    let oben = kerzen[ab].h - gu(ab) > go(ab) - kerzen[ab].l   // näher oben: erster Schwung ist ein Hoch
    let ext = ab
    for (let i = ab + 1; i < n; i++) {
        if (oben) {
            if (kerzen[i].h >= kerzen[ext].h) ext = i
            else if (kerzen[ext].h - kerzen[i].l >= schwelle(i)) { schwuenge.push({ i: ext, oben: true }); oben = false; ext = i }
        } else {
            if (kerzen[i].l <= kerzen[ext].l) ext = i
            else if (kerzen[i].h - kerzen[ext].l >= schwelle(i)) { schwuenge.push({ i: ext, oben: false }); oben = true; ext = i }
        }
    }
    const offen = { i: ext, oben, offen: true }
    // Längste Folge, in der jeder Schwung an seiner Kante endet; sie muss bis jetzt reichen
    const alle = [...schwuenge, offen]
    const imKanal = (s) => !(s.offen && (s.oben ? kerzen[s.i].c > go(s.i) + nah(s.i) : kerzen[s.i].c < gu(s.i) - nah(s.i)))
    if (luecken) {
        // Kanäle (`luecken`): ein Schwung, der in der Mitte umkehrt, unterbricht nicht — es zählen
        // die Berührungen, die abwechselnd oben und unten liegen (je Seite der äusserste)
        // Ein laufender Schwung jenseits der Kante ist der Ausbruch, keine Berührung; mehr
        // Umkehrer in der Mitte als Berührungen: dann pendelt der Kurs nicht von Kante zu Kante
        const aus = []
        let mitte = 0
        for (const s of alle) {
            const jenseitsJetzt = s.offen && (s.oben ? kerzen[s.i].h > go(s.i) + ueber(s.i) : kerzen[s.i].l < gu(s.i) - ueber(s.i))
            if (!anKante(s) || !imKanal(s) || jenseitsJetzt) { if (!s.offen) mitte++; continue }
            const v = aus[aus.length - 1]
            if (v && v.oben === s.oben) { if (s.oben ? kerzen[s.i].h > kerzen[v.i].h : kerzen[s.i].l < kerzen[v.i].l) aus[aus.length - 1] = s }
            else aus.push(s)
        }
        return mitte > aus.length ? [] : aus
    }
    let start = alle.length - 1
    if (!anKante(offen)) start = alle.length - 2
    const ende = start
    while (start >= 0 && anKante(alle[start])) start--
    return alle.slice(start + 1, ende + 1).filter((s) => !(s.offen && (s.oben ? kerzen[s.i].c > go(s.i) + nah(s.i) : kerzen[s.i].c < gu(s.i) - nah(s.i))))
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
                if (!(ok.m < uk.m)) continue                               // läuft nicht zusammen
                if (ok.ber + uk.ber < DREIECK.MIN_SUMME) continue
                // Pendelt der Kurs wirklich zwischen den Kanten? Die Formation beginnt an
                // ihrer ersten Berührung — nicht am ersten Anker, sonst hängt ein Dreieck
                // aus den letzten 20 Kerzen an einer Länge von 230.
                const pen = pendel(kerzen, Math.min(ok.i1, uk.i1), ok.g, uk.g, A)
                const bO = pen.filter((x) => x.oben).length, bU = pen.length - bO
                if (pen.length < DREIECK.MIN_PENDEL || bO < 2 || bU < 2) continue
                const iO = pen.find((x) => x.oben).i, iU = pen.find((x) => !x.oben).i
                const anfang = pen[0].i
                const laenge = n - anfang
                if (laenge < L * 0.6) continue
                const hoehe0 = ok.g(anfang) - uk.g(anfang)
                const hoeheJ = ok.g(n - 1) - uk.g(n - 1)
                if (!(hoehe0 >= DREIECK.MIN_HOEHE_ATR * Aw) || hoehe0 > DREIECK.MAX_HOEHE_ATR * Aw) continue
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
                    // Jede Kante ab ihrer eigenen ersten Berührung gezeichnet — nicht 0.3 unter jeder Kerze
                    tOA: kerzen[iO].t, obenOA: ok.g(iO), tUA: kerzen[iU].t, untenUA: uk.g(iU),
                    tE: zeit(ende), obenE: ok.g(ende), untenE: uk.g(ende),
                    pendelPunkte: pen.map((x) => ({ t: kerzen[x.i].t, p: x.oben ? kerzen[x.i].h : kerzen[x.i].l, oben: x.oben })),
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
    // Wimpel (`wimpel` in chart-kandidaten.js): symmetrisches Dreieck nach einer Fahnenstange
    bullWimpel: ['Bull-Wimpel', 'Bull pennant'],
    bearWimpel: ['Bear-Wimpel', 'Bear pennant'],
}
const BRUCH = { oben: [', nach oben gebrochen', ', broken up'], unten: [', nach unten gebrochen', ', broken down'] }

/** Kurzer Name („Fallender Keil") — für jede weitere Nennung. */
export const dreieckKurz = (k, englisch = false) => NAMEN[k.muster]?.[englisch ? 1 : 0] || NAMEN[k.form]?.[englisch ? 1 : 0] || (englisch ? 'Triangle' : 'Dreieck')
/** Beschriftung im Chart: Name plus Bruch. */
export const dreieckBeschriftung = (k, englisch = false) => dreieckKurz(k, englisch) + (k.bruch ? BRUCH[k.bruch][englisch ? 1 : 0] : '')
/** Name mit gemessenen Berührungen, vom Code vergeben. */
export function dreieckName(k, englisch = false) {
    const b = `${k.beruehrOben}/${k.beruehrUnten}`
    const br = k.bruch ? BRUCH[k.bruch][englisch ? 1 : 0] : ''
    return `${dreieckKurz(k, englisch)} (${b} ${englisch ? 'touches' : 'Berührungen'}${br})`
}
