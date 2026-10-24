/**
 * Den Chart vermessen, bevor ein Sprachmodell ihn sieht — rein, ohne Netz.
 *
 * Bis 18.10.2026 bekam das Modell 150 Kerzen als CSV und sollte daraus Linien
 * ablesen. Das kann es nicht: aus „Widerstand 82.900" wurde eine Schräge von
 * 82 639 nach 82 900, die Abwärtslinie lag am absoluten Hoch, und die Kerzen
 * wuchsen durch sie hindurch. Ein Modell liest Zahlenreihen, keine Geometrie.
 *
 * Deshalb rechnet hier der Code jede Marke, prüft sie an den Kerzen und gibt
 * ihr eine ID; das Modell wählt nur noch aus, gewichtet und erklärt. Einen
 * Preis, der nicht in der Liste steht, kann es nicht mehr erfinden.
 *
 *   N…  waagerechte Niveaus: geclusterte Wendepunkte (Kette mit 0,5 ATR
 *       Nachbarabstand, höchstens 1 ATR breit), mit Berührungen, Reaktion in
 *       ATR, Durchquerungen ab der ersten Berührung und einer Güte
 *   V…  Volumenprofile je Abschnitt (POC, VAH, VAL) — Abschnitte zwischen den
 *       grossen Wendepunkten, wie man ein Fixed-Range-Profil von Hand setzt
 *   T…  ungebrochene Trendlinien beider Seiten (chart-trendlinien.js)
 *   D…  Niveaus der höheren Zeiteinheit (Abstand in DEREN ATR gemessen —
 *       mit der ATR der Chart-Zeiteinheit blieb auf ETH 1h nur eins übrig)
 *   U…  eigene Linien des Nutzers, nur als Bezug
 *
 * Gleiche Kerzen → gleiche IDs (deterministisch, im Selbsttest geprüft).
 */
import { atr, pivotHighs, pivotLows } from '../shared/indicators.js'
import { volumenprofil } from '../shared/volumenprofil.js'
import { alleTrendlinien, istGegenlinie, verlaengerung, TOL_ATR, MIN_ABSTAND } from './chart-trendlinien.js'
import { trendZustand, durchquerungen } from './strategies/set_and_forget.js'

export const KAND = {
    PIVOT_K: 3,
    CLUSTER_ATR: 0.5,          // Abstand zum Nachbarn in der Kette
    CLUSTER_MAX_ATR: 1,        // Gesamtbreite einer Gruppe
    BAND_MIN_ATR: 0.15,        // halbe Mindestbreite des Bands um den Preis
    REAKTION_KERZEN: 10,
    MAX_NIVEAUS: 8,
    NAH_JE_SEITE: 2,
    TREND_JE_SEITE: 2,
    TREND_MIN_DELTA_ATR: 0.75, // flacher ist es eine waagerechte Marke
    TREND_MAX_ABSTAND_ATR: 5,  // weiter weg ist eine Trendlinie für den Kurs jetzt ohne Belang
    TREND_MAX_ABSTAND_ZWEI_ATR: 3, // mit nur zwei Berührungen enger
    SPANNE_KERZEN: 30,
    HTF_MAX: 4,
    HTF_ABSTAND_ATR_HTF: 3,
    DECKT_ATR: 0.2,            // V/D so nah an einem N → nicht doppelt aufführen
    ROH_KERZEN: 12,
    PROFIL_SCHWELLE_ATR: 5,    // Wendepunkt für einen Profil-Abschnitt: Gegenbewegung ab so vielen ATR
    PROFIL_MIN_KERZEN: 15,     // kürzere Abschnitte gehen im Nachbarn auf
    PROFIL_MAX: 3,             // die jüngsten so vielen Abschnitte
    KONS_BREITE_ATR: 3,        // Konsolidierung: alle Kerzenkörper in einem Band so breit
    KONS_MIN_KERZEN: 15,
    KONS_MAX: 3,
    PERIODE_MIN_KERZEN: 5,     // Tages-/Wochenprofil erst ab so vielen Kerzen der Periode
    KANAL_FENSTER: [80, 60, 45, 30, 20],
    KANAL_MIN_BREITE_ATR: 1,
    KANAL_MAX_BREITE_ATR: 6,   // breiter deckt er den halben Chart ab und sagt nichts mehr
    KANAL_MIN_STEIG_ATR: 1.5,  // Steigung über das Fenster: flacher ist es eine Spanne, kein Kanal
    KANAL_BERUEHR_ATR: 0.35,   // Abstand zur Kante, der als Berührung zählt
    FLAGGE_STANGE_ATR: 4,      // Fahnenstange vor der Flagge: mindestens so viele ATR …
    FLAGGE_STANGE_BREITE: 2,   // … und mindestens das Doppelte der Kanalbreite
    KANAL_UEBERSCHUSS_ATR: 0.6, // Wendepunkt bis so weit über die Kante hinaus zählt noch als Berührung
    KANAL_DOCHT_ATR: 1,        // ein Schluss weiter draussen bricht den Kanal (ein Docht nicht)
    KANAL_MAX_FOLGE: 2,        // Schlüsse ausserhalb hintereinander, danach gilt der Kanal als gebrochen
    KANAL_MAX_AUSSEN: 0.1,     // Anteil der Schlüsse ausserhalb im ganzen Kanal
    KANAL_MIN_SUMME: 6,        // Berührungen beider Kanten zusammen (je Kante ≥ 2)
}

/**
 * Konsolidierungen: Strecken, in denen alle Kerzenkörper in einem Band von
 * höchstens `breite` × ATR liegen (Dochte zählen nicht — ein Stich bricht
 * keine Seitwärtsphase). Von hinten gesucht, je Ende die längste Strecke,
 * die jüngsten `max`, ältester zuerst: [{ von, bis }] als Indizes.
 */
export function konsolidierungen(kerzen, A, { breite = KAND.KONS_BREITE_ATR, minKerzen = KAND.KONS_MIN_KERZEN, max = KAND.KONS_MAX } = {}) {
    const n = kerzen?.length || 0
    if (n < minKerzen || !(A > 0)) return []
    const teile = []
    let e = n - 1
    while (e >= minKerzen - 1 && teile.length < max) {
        let hoch = -Infinity, tief = Infinity, s = e
        for (let i = e; i >= 0; i--) {
            const o = Math.max(kerzen[i].o, kerzen[i].c), u = Math.min(kerzen[i].o, kerzen[i].c)
            const h2 = Math.max(hoch, o), t2 = Math.min(tief, u)
            if (h2 - t2 > breite * A) break
            hoch = h2; tief = t2; s = i
        }
        if (e - s + 1 >= minKerzen) { teile.push({ von: s, bis: e }); e = s - 1 } else e--
    }
    return teile.reverse()
}

/** Tage bzw. Wochen (UTC, Woche ab Montag): die jüngsten `max` mit genug Kerzen, ältester zuerst. */
export function periodenAbschnitte(kerzen, art, { max = KAND.PROFIL_MAX, minKerzen = KAND.PERIODE_MIN_KERZEN } = {}) {
    const n = kerzen?.length || 0
    const nummer = (t) => { const tag = Math.floor(t / 86_400_000); return art === 'woche' ? Math.floor((tag + 3) / 7) : tag }
    const teile = []
    for (let i = 0; i < n; i++) {
        const p = nummer(kerzen[i].t)
        const letzt = teile[teile.length - 1]
        if (letzt && letzt.p === p) letzt.bis = i
        else teile.push({ p, von: i, bis: i })
    }
    return teile.filter((x) => x.bis - x.von + 1 >= minKerzen).slice(-max).map(({ von, bis }) => ({ von, bis }))
}

/**
 * Kanäle — gesucht wie von Hand gezeichnet (24.10.2026; vorher Regression der
 * Schlüsse mit Kanten durch die Extremwerte, so dass ein einziger Docht den
 * Kanal unbrauchbar breit machte und praktisch nie einer entstand):
 *
 *   Grundlinie  durch ZWEI echte Wendepunkte derselben Seite (Tiefs oder Hochs,
 *               je zwei Kerzen links und rechts), mindestens ein Viertel des
 *               Fensters auseinander, im Fenster der letzten 20–80 Kerzen.
 *   Gegenkante  parallel dazu dort, wo die MEISTEN Wendepunkte der anderen
 *               Seite liegen (Band von ±0,35 ATR) — nicht am Extrem.
 *   Berührung   Wendepunkt höchstens 0,35 ATR innen vor der Kante oder bis
 *               `KANAL_UEBERSCHUSS_ATR` darüber hinaus (kurzes Überschiessen
 *               und zurück zählt als Kontakt). Je Kante ≥ 2, zusammen ≥ 6.
 *   Spielraum   Schlüsse jenseits einer Kante (mehr als 0,35 ATR) sind erlaubt,
 *               wenn höchstens `KANAL_MAX_FOLGE` hintereinander und höchstens
 *               `KANAL_MAX_AUSSEN` (Anteil) des Fensters — danach muss der Kurs
 *               zurück sein. Ein Docht darf beliebig weit hinausstechen, wenn
 *               er zurückkommt; ein SCHLUSS mehr als 1 ATR draussen oder zu
 *               lange draussen = gebrochen. Der jüngste Schluss liegt im
 *               Kanal (oder gerade erst kurz draussen).
 *   Form        Breite 1–6 ATR; Steigung über das Fenster ≥ 1,5 ATR, sonst eine
 *               Spanne (eine Flagge darf flacher sein).
 *   Flagge      davor eine Fahnenstange (≥ 4 ATR und ≥ 2 Kanalbreiten) in die
 *               Gegenrichtung: Stange auf + Kanal ab/flach = Bull-Flagge,
 *               Stange ab + Kanal auf/flach = Bear-Flagge.
 *
 * Gewählt wird der Kanal mit den meisten Berührungen (Flagge +4, wenig
 * Überschiessen, länger bei Gleichstand); höchstens einer.
 */
export function kandidatenKanaele(kerzen, A) {
    const n = kerzen?.length || 0
    if (n < 30 || !(A > 0)) return []
    const hochs = pivotHighs(kerzen, 2, 2).map((p) => p.index)
    const tiefs = pivotLows(kerzen, 2, 2).map((p) => p.index)
    const tol = KAND.KANAL_BERUEHR_ATR * A
    const ueber = KAND.KANAL_UEBERSCHUSS_ATR * A
    const docht = KAND.KANAL_DOCHT_ATR * A
    const funde = []
    const kurs = kerzen[n - 1].c

    for (const L of KAND.KANAL_FENSTER) {
        if (L > n - 10) continue
        const s = n - L
        const H = hochs.filter((i) => i >= s), T = tiefs.filter((i) => i >= s)
        for (const unten of [true, false]) {
            const basis = unten ? T : H, gegen = unten ? H : T
            const wert = (i) => (unten ? kerzen[i].l : kerzen[i].h)
            const gwert = (i) => (unten ? kerzen[i].h : kerzen[i].l)
            for (let x = 0; x < basis.length; x++) {
                for (let y = x + 1; y < basis.length; y++) {
                    const i1 = basis[x], i2 = basis[y]
                    if (i2 - i1 < L / 4) continue
                    const m = (wert(i2) - wert(i1)) / (i2 - i1)
                    const g = (i) => wert(i1) + m * (i - i1)
                    // Gegenkante: Versatz mit den meisten Wendepunkten der anderen Seite im ±tol-Band
                    const d = gegen.map((i) => gwert(i) - g(i)).filter((v) => (unten ? v > 0 : v < 0))
                    if (d.length < 2) continue
                    let bestW = null, bestZ = 0
                    for (const w of d) {
                        const z = d.filter((v) => Math.abs(v - w) <= tol).length
                        if (z > bestZ || (z === bestZ && Math.abs(w) > Math.abs(bestW))) { bestZ = z; bestW = w }
                    }
                    const W = Math.abs(bestW)
                    if (W < KAND.KANAL_MIN_BREITE_ATR * A || W > KAND.KANAL_MAX_BREITE_ATR * A) continue
                    const lo = (i) => (unten ? g(i) : g(i) + bestW)       // untere Kante
                    const hi = (i) => (unten ? g(i) + bestW : g(i))       // obere Kante
                    // Berührungen ab dem ersten Kontakt, mit kurzem Überschiessen
                    const anfang = Math.min(i1, ...gegen.filter((i) => Math.abs(gwert(i) - (unten ? hi(i) : lo(i))) <= tol))
                    const zaehle = (liste, kante, oben) => liste.filter((i) => i >= anfang && (oben
                        ? kerzen[i].h >= kante(i) - tol && kerzen[i].h <= kante(i) + ueber
                        : kerzen[i].l <= kante(i) + tol && kerzen[i].l >= kante(i) - ueber)).length
                    const bOben = zaehle(H, hi, true), bUnten = zaehle(T, lo, false)
                    if (bOben < 2 || bUnten < 2 || bOben + bUnten < KAND.KANAL_MIN_SUMME) continue
                    // Spielraum: kurze Ausflüge erlaubt, lange oder weite nicht
                    let aussen = 0, folge = 0, maxFolge = 0, weit = false
                    for (let i = anfang; i < n; i++) {
                        const k = kerzen[i]
                        const raus = k.c > hi(i) + tol || k.c < lo(i) - tol
                        if (raus) { aussen++; folge++; maxFolge = Math.max(maxFolge, folge) } else folge = 0
                        if (k.c > hi(i) + docht || k.c < lo(i) - docht) weit = true   // Schluss weit draussen = Bruch
                    }
                    const spanne = n - anfang
                    if (weit || maxFolge > KAND.KANAL_MAX_FOLGE || aussen > KAND.KANAL_MAX_AUSSEN * spanne) continue
                    if (folge > KAND.KANAL_MAX_FOLGE) continue          // jetzt schon zu lange draussen = gebrochen
                    const steig = m * (n - 1 - anfang)
                    const P = Math.min(spanne, anfang)
                    const bewegung = P > 0 ? kerzen[anfang].c - kerzen[anfang - P].c : 0
                    const stange = Math.abs(bewegung) >= Math.max(KAND.FLAGGE_STANGE_ATR * A, KAND.FLAGGE_STANGE_BREITE * W)
                    let muster = null
                    if (stange && bewegung > 0 && steig <= 0.5 * A) muster = 'bullFlagge'
                    else if (stange && bewegung < 0 && steig >= -0.5 * A) muster = 'bearFlagge'
                    if (!muster && Math.abs(steig) < KAND.KANAL_MIN_STEIG_ATR * A) continue
                    const ext = Math.max(3, Math.round(spanne * 0.25))
                    const iv = (kerzen[n - 1].t - kerzen[anfang].t) / Math.max(1, spanne - 1)
                    const mitte = (lo(n - 1) + hi(n - 1)) / 2
                    funde.push({
                        quelle: 'kanal', richtung: steig >= 0 ? 'auf' : 'ab', muster, laenge: spanne,
                        t1: kerzen[anfang].t, p1: lo(anfang), t2: kerzen[n - 1].t, p2: lo(n - 1),
                        tEnde: kerzen[n - 1].t + ext * iv, pEnde: lo(n - 1 + ext),
                        breite: W, breiteAtr: W / A, beruehrOben: bOben, beruehrUnten: bUnten, ausserhalb: aussen,
                        untenJetzt: lo(n - 1), obenJetzt: hi(n - 1),
                        preis: mitte, abstandAtr: (mitte - kurs) / A,
                        stangeAtr: muster ? Math.abs(bewegung) / A : null,
                        wert: bOben + bUnten + (muster ? 4 : 0) - aussen * 0.5 + spanne / 200,
                    })
                }
            }
        }
    }
    funde.sort((a, b) => b.wert - a.wert)
    return funde.slice(0, 1).map(({ wert, ...k }) => k)
}

/** Name eines Kanals, vom Code vergeben (nicht vom Modell). */
export function kanalName(k, englisch = false) {
    const b = `${k.beruehrOben}/${k.beruehrUnten}`
    if (k.muster === 'bullFlagge') return englisch ? `Bull flag (${b} touches)` : `Bull-Flagge (${b} Berührungen)`
    if (k.muster === 'bearFlagge') return englisch ? `Bear flag (${b} touches)` : `Bear-Flagge (${b} Berührungen)`
    const auf = k.richtung === 'auf'
    return englisch ? `${auf ? 'Ascending' : 'Descending'} channel (${b} touches)` : `${auf ? 'Aufsteigender' : 'Absteigender'} Kanal (${b} Berührungen)`
}

/**
 * Abschnitte für Volumenprofile: ZigZag über Hochs/Tiefs mit `schwelle` × ATR,
 * die Strecken zwischen den Wendepunkten; zu kurze gehen im älteren Nachbarn
 * auf, der jüngste reicht bis zur letzten Kerze. Liefert die jüngsten `max`,
 * ältester zuerst: [{ von, bis }] als Kerzen-Indizes.
 */
export function profilAbschnitte(kerzen, A, { schwelle = KAND.PROFIL_SCHWELLE_ATR, minKerzen = KAND.PROFIL_MIN_KERZEN, max = KAND.PROFIL_MAX } = {}) {
    const n = kerzen?.length || 0
    if (n < minKerzen || !(A > 0)) return []
    const wende = [0]
    const S = schwelle * A
    let richtung = 0, hI = 0, lI = 0
    for (let i = 1; i < n; i++) {
        const x = kerzen[i]
        if (richtung >= 0 && x.h >= kerzen[hI].h) hI = i
        if (richtung <= 0 && x.l <= kerzen[lI].l) lI = i
        if (richtung >= 0 && hI < i && kerzen[hI].h - x.l >= S) { wende.push(hI); richtung = -1; lI = i }
        else if (richtung <= 0 && lI < i && x.h - kerzen[lI].l >= S) { wende.push(lI); richtung = 1; hI = i }
    }
    const punkte = [...new Set([...wende, n - 1])].sort((a, b) => a - b)
    let teile = []
    for (let j = 1; j < punkte.length; j++) teile.push({ von: punkte[j - 1], bis: punkte[j] })
    // zu kurze Abschnitte mit dem älteren Nachbarn verschmelzen (der erste mit dem nächsten)
    for (let j = teile.length - 1; j >= 0 && teile.length > 1; j--) {
        if (teile[j].bis - teile[j].von + 1 >= minKerzen) continue
        if (j > 0) { teile[j - 1].bis = teile[j].bis; teile.splice(j, 1) } else { teile[1].von = teile[0].von; teile.splice(0, 1) }
    }
    teile = teile.filter((x) => x.bis - x.von + 1 >= minKerzen)
    return teile.slice(-max)
}

/** Zeiteinheit → höhere Zeiteinheit als Kontext; null = keine. */
export const HTF_VON = {
    '1m': '15m', '3m': '1h', '5m': '1h', '15m': '4h', '30m': '4h', '1h': '4h', '2h': '1d', '4h': '1d',
    '6h': '1d', '8h': '1d', '12h': '1d', '1d': '1w', '3d': '1w', '1w': null, '1M': null,
}

const letzteAtr = (kerzen) => { const a = atr(kerzen, 14); return a[a.length - 1] }

/**
 * Wendepunkte zu Niveaus gruppieren. Absolutes Hoch und Tief zählen mit, auch
 * wenn sie am Rand liegen (ein Pivot braucht K Kerzen danach).
 */
export function kandidatenNiveaus(kerzen, { atrWert = letzteAtr(kerzen), k = KAND.PIVOT_K } = {}) {
    const n = kerzen.length
    const A = atrWert
    if (n < 2 * k + 2 || !(A > 0)) return []
    const pts = [
        ...pivotHighs(kerzen, k, k).map((p) => ({ i: p.index, preis: p.price, art: 'hoch' })),
        ...pivotLows(kerzen, k, k).map((p) => ({ i: p.index, preis: p.price, art: 'tief' })),
    ]
    let iH = 0, iL = 0
    for (let i = 1; i < n; i++) { if (kerzen[i].h > kerzen[iH].h) iH = i; if (kerzen[i].l < kerzen[iL].l) iL = i }
    if (!pts.some((p) => p.i === iH && p.art === 'hoch')) pts.push({ i: iH, preis: kerzen[iH].h, art: 'hoch' })
    if (!pts.some((p) => p.i === iL && p.art === 'tief')) pts.push({ i: iL, preis: kerzen[iL].l, art: 'tief' })
    // Reaktion: wie weit lief der Kurs in den REAKTION_KERZEN danach weg (in ATR)?
    for (const p of pts) {
        let ext = null
        for (let j = p.i + 1; j <= Math.min(n - 1, p.i + KAND.REAKTION_KERZEN); j++) {
            const w = p.art === 'hoch' ? kerzen[j].l : kerzen[j].h
            ext = ext == null ? w : (p.art === 'hoch' ? Math.min(ext, w) : Math.max(ext, w))
        }
        p.reakt = ext == null ? 0 : Math.max(0, (p.art === 'hoch' ? p.preis - ext : ext - p.preis) / A)
    }
    pts.sort((x, y) => x.preis - y.preis || x.i - y.i)
    const gruppen = []
    let g = []
    for (const p of pts) {
        if (g.length && p.preis - g[g.length - 1].preis <= KAND.CLUSTER_ATR * A && p.preis - g[0].preis <= KAND.CLUSTER_MAX_ATR * A) g.push(p)
        else { if (g.length) gruppen.push(g); g = [p] }
    }
    if (g.length) gruppen.push(g)
    const kurs = kerzen[n - 1].c
    return gruppen.map((gr) => {
        const preise = gr.map((p) => p.preis).sort((a, b) => a - b)
        const preis = preise[Math.floor(preise.length / 2)]
        const re = gr.map((p) => p.reakt).sort((a, b) => a - b)
        const ersterI = Math.min(...gr.map((p) => p.i)), letzterI = Math.max(...gr.map((p) => p.i))
        const tief = Math.min(preise[0], preis - KAND.BAND_MIN_ATR * A)
        const hoch = Math.max(preise[preise.length - 1], preis + KAND.BAND_MIN_ATR * A)
        // Durchquerungen erst AB der ersten Berührung — davor war die Marke noch keine.
        const durch = durchquerungen(kerzen.slice(ersterI), { tief, hoch })
        const hochs = gr.filter((p) => p.art === 'hoch').length
        const tiefs = gr.length - hochs
        const reaktMax = re[re.length - 1], reaktMed = re[Math.floor(re.length / 2)]
        const frische = n > 1 ? letzterI / (n - 1) : 1
        return {
            preis, tief, hoch,
            beruehrungen: gr.length, hochs, tiefs,
            ersteT: kerzen[ersterI].t, letzteT: kerzen[letzterI].t,
            reaktionMaxAtr: reaktMax, reaktionMedAtr: reaktMed,
            durchquerungen: durch,
            guete: ((reaktMax + reaktMed) / 2) * Math.sqrt(gr.length) * (0.3 + 0.7 * frische) / (1 + 0.5 * durch),
            abstandAtr: (preis - kurs) / A,
            extrem: gr.some((p) => p.i === iH && p.art === 'hoch') ? 'hoch' : gr.some((p) => p.i === iL && p.art === 'tief') ? 'tief' : null,
            rolle: hochs >= 2 && tiefs >= 2 && durch >= 3 ? 'wechsel' : preis >= kurs ? 'widerstand' : 'unterstuetzung',
        }
    })
}

/**
 * Auswahl: je Seite die nächsten zuerst (ein Trader braucht die Marken am Kurs),
 * dann nach Güte auffüllen. Zulassung: ≥ 2 Berührungen, Extrem des Bereichs oder
 * eine deutliche Einzelreaktion ohne viele Durchquerungen.
 */
export function waehleNiveaus(niveaus, kurs, { max = KAND.MAX_NIVEAUS, nah = KAND.NAH_JE_SEITE } = {}) {
    const zugelassen = niveaus.filter((x) => x.beruehrungen >= 2 || x.extrem || (x.reaktionMaxAtr >= 3 && x.durchquerungen <= 2))
    const wahl = new Set()
    const oben = zugelassen.filter((x) => x.preis > kurs).sort((a, b) => a.preis - b.preis).slice(0, nah)
    const unten = zugelassen.filter((x) => x.preis <= kurs).sort((a, b) => b.preis - a.preis).slice(0, nah)
    for (const x of [...oben, ...unten]) wahl.add(x)
    for (const x of [...zugelassen].sort((a, b) => b.guete - a.guete)) { if (wahl.size >= max) break; wahl.add(x) }
    return [...wahl].sort((a, b) => b.preis - a.preis)
}

/**
 * Trendlinien-Kandidaten beider Seiten (Regeln in chart-trendlinien.js). Raus
 * ausserdem: fast flache (das ist eine waagerechte Marke), weit weg vom Kurs
 * (`TREND_MAX_ABSTAND_ATR`, mit nur zwei Berührungen oder als Gegenlinie
 * `TREND_MAX_ABSTAND_ZWEI_ATR`
 * — bis 20.10.2026 galt für drei Berührungen gar keine Grenze, auf BTC 4h stand
 * eine Linie 21 ATR über dem Kurs) und Doppelte (jetzt < 0,5 ATR auseinander).
 * Reihenfolge: meiste Berührungen, dann klassische Linie (fallend an Hochs,
 * steigend an Tiefs) vor der Gegenlinie, dann näher am Kurs.
 */
export function kandidatenTrendlinien(kerzen, atrWert, { jeSeite = KAND.TREND_JE_SEITE } = {}) {
    const n = kerzen.length
    if (n < 2 * KAND.PIVOT_K + MIN_ABSTAND || !(atrWert > 0)) return []
    const kurs = kerzen[n - 1].c
    const iv = n > 1 ? kerzen[n - 1].t - kerzen[n - 2].t : 0
    const aus = []
    for (const seite of ['hoch', 'tief']) {
        const liste = []
        for (const c of alleTrendlinien(kerzen, seite, { tol: TOL_ATR * atrWert, atr: atrWert })) {
            if (Math.abs(c.p2 - c.p1) < KAND.TREND_MIN_DELTA_ATR * atrWert) continue
            const steigung = (c.p2 - c.p1) / (c.i2 - c.i1)
            const wertJetzt = c.p1 + steigung * (n - 1 - c.i1)
            const abstandAtr = (wertJetzt - kurs) / atrWert
            // Gegenlinien entfernen sich vom Kurs, sobald er abdreht — für sie gilt die enge Grenze.
            const gegen = istGegenlinie(seite, c.p1, c.p2)
            const grenze = c.beruehrungen < 3 || gegen ? KAND.TREND_MAX_ABSTAND_ZWEI_ATR : KAND.TREND_MAX_ABSTAND_ATR
            if (Math.abs(abstandAtr) > grenze) continue
            const ext = verlaengerung(n, c.i1)
            liste.push({
                seite, richtung: steigung < 0 ? 'ab' : 'auf',
                rolle: seite === 'hoch' ? 'widerstand' : 'unterstuetzung',
                gegen,
                t1: kerzen[c.i1].t, p1: c.p1, t2: kerzen[c.i2].t, p2: c.p2,
                beruehrungen: c.beruehrungen, beruehrT: c.beruehrIdx.map((i) => kerzen[i].t),
                letzteBeruehrungT: kerzen[c.beruehrIdx[c.beruehrIdx.length - 1]].t,
                wertJetzt, abstandAtr,
                tEnde: kerzen[n - 1].t + ext * iv, pEnde: wertJetzt + steigung * ext,
            })
        }
        liste.sort((x, y) => y.beruehrungen - x.beruehrungen || Number(x.gegen) - Number(y.gegen) || Math.abs(x.abstandAtr) - Math.abs(y.abstandAtr))
        const gewaehlt = []
        for (const c of liste) {
            if (gewaehlt.some((d) => Math.abs(d.wertJetzt - c.wertJetzt) < 0.5 * atrWert)) continue
            gewaehlt.push(c)
            if (gewaehlt.length >= jeSeite) break
        }
        aus.push(...gewaehlt)
    }
    return aus
}

/**
 * Marktstruktur: die letzten Hochs/Tiefs mit HH/LH bzw. HL/LL, der Zustand
 * (wie in Set and Forget: gilt bis zum Bruch) und der letzte Strukturbruch —
 * ein Schluss jenseits des zuletzt BESTÄTIGTEN Wendepunkts.
 */
export function marktstruktur(kerzen, k = KAND.PIVOT_K) {
    const hochs = pivotHighs(kerzen, k, k)
    const tiefs = pivotLows(kerzen, k, k)
    const benenne = (liste, oben) => liste.slice(-4).map((p, i, a) => ({
        t: p.t, p: p.price,
        art: i === 0 ? null : oben ? (p.price > a[i - 1].price ? 'HH' : 'LH') : (p.price > a[i - 1].price ? 'HL' : 'LL'),
    })).slice(-3)
    let bruch = null
    let hi = 0, ti = 0, letztesH = null, letztesT = null
    for (let i = 0; i < kerzen.length; i++) {
        while (hi < hochs.length && hochs[hi].index + k <= i) letztesH = hochs[hi++]
        while (ti < tiefs.length && tiefs[ti].index + k <= i) letztesT = tiefs[ti++]
        const c = kerzen[i].c
        if (letztesH && c > letztesH.price) { bruch = { richtung: 'auf', marke: letztesH.price, t: kerzen[i].t }; letztesH = null }
        if (letztesT && c < letztesT.price) { bruch = { richtung: 'ab', marke: letztesT.price, t: kerzen[i].t }; letztesT = null }
    }
    return { hochs: benenne(hochs, true), tiefs: benenne(tiefs, false), zustand: trendZustand(kerzen, k, k), bruch }
}

export function spanneLetzte(kerzen, n, atrWert) {
    const r = kerzen.slice(-n)
    if (!r.length) return null
    const hoch = Math.max(...r.map((x) => x.h)), tief = Math.min(...r.map((x) => x.l))
    const kurs = kerzen[kerzen.length - 1].c
    return { tief, hoch, breiteAtr: atrWert > 0 ? (hoch - tief) / atrWert : null, positionPct: hoch > tief ? ((kurs - tief) / (hoch - tief)) * 100 : 50, kerzen: r.length }
}

/** Alles zusammen, mit stabilen IDs. */
export function baueKandidaten({ kerzen, kerzenHtf = null, interval = null, intervalHtf = null, zeichnungen = [], zeitzone = 'UTC', profilArt = 'konsolidierung' }) {
    const n = kerzen.length
    if (n < 30) return null
    const A = letzteAtr(kerzen)
    if (!(A > 0)) return null
    const kurs = kerzen[n - 1].c
    const vonT = kerzen[0].t, bisT = kerzen[n - 1].t
    const kandidaten = []
    const nahAnN = (preis, niveaus) => niveaus.find((x) => Math.abs(x.preis - preis) < KAND.DECKT_ATR * A)

    const niveaus = waehleNiveaus(kandidatenNiveaus(kerzen, { atrWert: A }), kurs)
    niveaus.forEach((x, i) => kandidaten.push({ id: `N${i + 1}`, quelle: 'niveau', ...x, t1: x.ersteT }))
    const nListe = kandidaten.slice()

    // Je Bereich ein Profil (jüngster = A1); V-IDs laufen über alle Bereiche. Bereiche:
    // Konsolidierungen (Vorgabe), Tage oder Wochen. Ohne Konsolidierung die Abschnitte
    // zwischen den grossen Wendepunkten, ohne die ein Profil über alles.
    let v = 1
    let bereich = profilArt === 'tag' || profilArt === 'woche' ? profilArt : 'konsolidierung'
    let gefunden = bereich === 'konsolidierung' ? konsolidierungen(kerzen, A) : periodenAbschnitte(kerzen, bereich)
    if (!gefunden.length && bereich === 'konsolidierung') { gefunden = profilAbschnitte(kerzen, A); bereich = 'abschnitt' }
    const abschnitte = (gefunden.length ? gefunden : [{ von: 0, bis: n - 1 }]).reverse()
    abschnitte.forEach((ab, j) => {
        const vp = volumenprofil(kerzen.slice(ab.von, ab.bis + 1), { zeilen: 48 })
        if (!vp) return
        for (const [name, preis] of [['POC', vp.poc], ['VAH', vp.vah], ['VAL', vp.val]]) {
            const deckt = nahAnN(preis, nListe)
            kandidaten.push({
                id: `V${v++}`, quelle: 'volumenprofil', name, abschnitt: `A${j + 1}`, bereich, preis, tief: preis - KAND.BAND_MIN_ATR * A, hoch: preis + KAND.BAND_MIN_ATR * A,
                t1: kerzen[ab.von].t, t2: kerzen[ab.bis].t, abstandAtr: (preis - kurs) / A, deckt: deckt?.id || null,
            })
        }
    })

    kandidatenTrendlinien(kerzen, A).forEach((x, i) => kandidaten.push({ id: `T${i + 1}`, quelle: 'trend', ...x }))
    kandidatenKanaele(kerzen, A).forEach((x, i) => kandidaten.push({ id: `K${i + 1}`, ...x }))

    if (Array.isArray(kerzenHtf) && kerzenHtf.length >= 30) {
        const Ah = letzteAtr(kerzenHtf)
        const htf = waehleNiveaus(kandidatenNiveaus(kerzenHtf, { atrWert: Ah }), kurs, { max: 6 })
            .filter((x) => Math.abs(x.preis - kurs) <= KAND.HTF_ABSTAND_ATR_HTF * Ah)
            .slice(0, KAND.HTF_MAX)
        htf.forEach((x, i) => kandidaten.push({
            id: `D${i + 1}`, quelle: 'htf', ...x, t1: Math.max(x.ersteT, vonT),
            abstandAtr: (x.preis - kurs) / A, deckt: nahAnN(x.preis, nListe)?.id || null,
        }))
    }

    const nutzer = (zeichnungen || []).filter((z) => ['horizontale', 'strahlH', 'trendlinie', 'strahl', 'rechteck', 'volprofil'].includes(z.typ))
        .slice(0, 12).map((z, i) => ({ id: `U${i + 1}`, typ: z.typ, punkte: z.punkte || [], text: z.stil?.text || '' }))

    return {
        kurs, atr: A, vonT, bisT, interval, intervalHtf, zeitzone,
        spanne: spanneLetzte(kerzen, KAND.SPANNE_KERZEN, A),
        struktur: marktstruktur(kerzen),
        kandidaten, nutzer,
        roh: kerzen.slice(-KAND.ROH_KERZEN),
        volMedian: (() => { const v = kerzen.slice(-50).map((x) => x.v).sort((a, b) => a - b); return v[Math.floor(v.length / 2)] || null })(),
    }
}

// ── Text für das Modell ─────────────────────────────────────────────────
export function zahl(x) {
    if (!Number.isFinite(x)) return '—'
    const a = Math.abs(x)
    if (a >= 1000) return x.toFixed(0)
    if (a >= 1) return x.toFixed(a >= 100 ? 2 : 4).replace(/0+$/, '').replace(/\.$/, '')
    return Number(x.toPrecision(5)).toString()
}
/*
 * Zeiten in Ortszeit (settings.timeZone), nie in UTC: bis 20.10.2026 standen
 * hier ISO-Zeiten mit „Z", und das Modell schrieb sie in die Beschriftung —
 * „Fallende Hochlinie seit 14:45Z" über einem Chart, der 16:45 zeigt.
 */
const formate = new Map()
export function zeitText(ms, zeitzone = 'UTC') {
    if (!Number.isFinite(ms)) return '—'
    let f = formate.get(zeitzone)
    if (!f) {
        try { f = new Intl.DateTimeFormat('de-CH', { timeZone: zeitzone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) } catch { f = null }
        if (!f) return zeitText(ms, 'UTC')
        formate.set(zeitzone, f)
    }
    const t = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]))
    return `${t.day}.${t.month}. ${t.hour}:${t.minute}`
}
const atrText = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}`
const ZUSTAND = { 1: 'aufwärts', '-1': 'abwärts', 0: 'unbestimmt' }

/** Preis eines Kandidaten (bei Trendlinien der Wert jetzt). */
export const preisVon = (k) => (k.quelle === 'trend' ? k.wertJetzt : k.preis)

export function kandidatenText(paket) {
    const z = []
    const { kurs, atr: A, spanne, struktur } = paket
    const tz = paket.zeitzone || 'UTC'
    const zeit = (ms) => zeitText(ms, tz)
    z.push(`ZEITEN in Ortszeit (${tz}).`)
    z.push(`KURS ${zahl(kurs)} (letzter Schluss ${zeit(paket.bisT)}), ATR(14) ${zahl(A)} = ${(A / kurs * 100).toFixed(2)} %`)
    if (spanne) z.push(`SPANNE der letzten ${spanne.kerzen} Kerzen ${zahl(spanne.tief)}–${zahl(spanne.hoch)} = ${spanne.breiteAtr.toFixed(1)} ATR; Kurs bei ${spanne.positionPct.toFixed(0)} % der Spanne`)
    const n = paket.kandidaten.filter((k) => k.quelle === 'niveau')
    if (n.length) {
        z.push('', 'NIVEAUS (id | Preis | Band | Berührungen gesamt (an Hochs/an Tiefs) | letzte Berührung | max. Reaktion in ATR | Durchquerungen seit der ersten Berührung | Abstand zum Kurs in ATR):')
        for (const x of n) z.push(`${x.id} | ${zahl(x.preis)} | ${zahl(x.tief)}–${zahl(x.hoch)} | ${x.beruehrungen} (${x.hochs}/${x.tiefs}) | ${zeit(x.letzteT)} | ${x.reaktionMaxAtr.toFixed(1)} | ${x.durchquerungen} | ${atrText(x.abstandAtr)}${x.extrem ? ` | ${x.extrem === 'hoch' ? 'Hoch' : 'Tief'} des Bereichs` : ''}${x.rolle === 'wechsel' ? ' | Drehpunkt (mal Unterstützung, mal Widerstand)' : ''}`)
    }
    const v = paket.kandidaten.filter((k) => k.quelle === 'volumenprofil')
    if (v.length) {
        const ueber = { konsolidierung: 'je Konsolidierung (Seitwärtsphase)', tag: 'je Tag (UTC)', woche: 'je Woche (UTC, ab Montag)', abschnitt: 'je Abschnitt zwischen den grossen Wendepunkten' }[v[0].bereich] || 'je Abschnitt'
        z.push('', `VOLUMENPROFILE ${ueber} (A1 = der jüngste):`)
        for (const ab of [...new Set(v.map((x) => x.abschnitt))]) {
            const xs = v.filter((x) => x.abschnitt === ab)
            z.push(`${ab} ${zeit(xs[0].t1)} → ${zeit(xs[0].t2)}: ` + xs.map((x) => `${x.id} ${x.name} ${zahl(x.preis)} (${atrText(x.abstandAtr)} ATR${x.deckt ? `, deckt sich mit ${x.deckt}` : ''})`).join(' | '))
        }
    }
    const t = paket.kandidaten.filter((k) => k.quelle === 'trend')
    if (t.length) {
        z.push('', 'TRENDLINIEN — an den Kerzen geprüft: ungebrochen, auch links vom ersten Anker nicht durchschnitten; eine Berührung = eine eigene Welle (id | Rolle | Anker 1 → Anker 2 | Berührungen (Zeiten) | Wert jetzt | Abstand in ATR):')
        for (const x of t) {
            const rolle = `${x.rolle === 'widerstand' ? 'Widerstand an Hochs' : 'Unterstützung an Tiefs'}, ${x.richtung === 'ab' ? 'fallend' : 'steigend'}`
            const ber = `${x.beruehrungen}${x.beruehrT?.length ? ` (${x.beruehrT.map(zeit).join(', ')})` : ''}`
            z.push(`${x.id} | ${rolle} | ${zeit(x.t1)} ${zahl(x.p1)} → ${zeit(x.t2)} ${zahl(x.p2)} | ${ber} | ${zahl(x.wertJetzt)} | ${atrText(x.abstandAtr)}${x.gegen ? ' | Gegenlinie (Kanal-/Keilkante, entfernt sich vom Kurs, sobald er abdreht)' : ''}`)
        }
    } else z.push('', 'TRENDLINIEN: keine ungebrochene Linie mit genug Berührungen.')
    const kk = paket.kandidaten.filter((k) => k.quelle === 'kanal')
    if (kk.length) {
        z.push('', 'KANÄLE — vom Code gemessen und eingezeichnet (id | Name | von → bis | Breite in ATR | Kante unten jetzt / oben jetzt | Abstand der Mitte in ATR):')
        for (const x of kk) z.push(`${x.id} | ${kanalName(x)}${x.stangeAtr ? `, Fahnenstange ${x.stangeAtr.toFixed(1)} ATR` : ''} | ${zeit(x.t1)} → ${zeit(x.t2)} | ${x.breiteAtr.toFixed(1)} | ${zahl(x.untenJetzt)} / ${zahl(x.obenJetzt)} | ${atrText(x.abstandAtr)}`)
    }
    if (struktur) {
        const folge = (l) => l.map((p) => `${zahl(p.p)}${p.art ? ` ${p.art}` : ''} (${zeit(p.t)})`).join(' → ')
        z.push('', `STRUKTUR: Hochs ${folge(struktur.hochs) || '—'}; Tiefs ${folge(struktur.tiefs) || '—'}; Zustand ${ZUSTAND[struktur.zustand]}${struktur.bruch ? `; letzter Bruch ${struktur.bruch.richtung === 'auf' ? 'aufwärts über' : 'abwärts unter'} ${zahl(struktur.bruch.marke)} am ${zeit(struktur.bruch.t)}` : ''}`)
    }
    const d = paket.kandidaten.filter((k) => k.quelle === 'htf')
    if (d.length) {
        z.push('', `HÖHERE ZEITEINHEIT ${paket.intervalHtf} (id | Preis | Band | Berührungen | Abstand in ATR der Chart-Zeiteinheit):`)
        for (const x of d) z.push(`${x.id} | ${zahl(x.preis)} | ${zahl(x.tief)}–${zahl(x.hoch)} | ${x.beruehrungen} | ${atrText(x.abstandAtr)}${x.deckt ? ` | deckt sich mit ${x.deckt}` : ''}${kurs >= x.tief && kurs <= x.hoch ? ' | Kurs liegt im Band' : ''}`)
    }
    if (paket.nutzer.length) {
        z.push('', 'EIGENE LINIEN DES NUTZERS (nur als Bezug — nicht als Linie auswählbar):')
        for (const u of paket.nutzer) {
            const p = u.punkte
            const text = u.text ? ` „${u.text}"` : ''
            if (u.typ === 'rechteck') z.push(`${u.id} | Zone ${zahl(Math.min(p[0]?.p, p[1]?.p))}–${zahl(Math.max(p[0]?.p, p[1]?.p))}${text}`)
            else if (u.typ === 'volprofil') z.push(`${u.id} | Volumenprofil ${zeit(Math.min(p[0]?.t, p[1]?.t))} → ${zeit(Math.max(p[0]?.t, p[1]?.t))}`)
            else if (p.length > 1) z.push(`${u.id} | ${u.typ} ${zeit(p[0].t)} ${zahl(p[0].p)} → ${zeit(p[1].t)} ${zahl(p[1].p)}${text}`)
            else if (p.length) z.push(`${u.id} | ${u.typ} bei ${zahl(p[0].p)}${text}`)
        }
    }
    z.push('', `LETZTE ${paket.roh.length} KERZEN (Zeit,Eröffnung,Hoch,Tief,Schluss,Volumen relativ zum Median der letzten 50):`)
    for (const x of paket.roh) z.push([zeit(x.t), zahl(x.o), zahl(x.h), zahl(x.l), zahl(x.c), paket.volMedian ? (x.v / paket.volMedian).toFixed(1) : '—'].join(','))
    return z.join('\n')
}
