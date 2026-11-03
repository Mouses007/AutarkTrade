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
 *   M…  Dreiecke und Keile (chart-dreiecke.js): zusammenlaufende Kanten mit Spitze
 *   D…  Niveaus der höheren Zeiteinheit (Abstand in DEREN ATR gemessen —
 *       mit der ATR der Chart-Zeiteinheit blieb auf ETH 1h nur eins übrig)
 *   U…  eigene Zeichnungen des Nutzers im sichtbaren Bereich (und auf dieser
 *       Zeiteinheit sichtbar, höchstens `NUTZER_MAX`, Auswahl `waehleNutzer`), an
 *       den Kerzen gemessen (`messeNutzerZeichnungen`): Berührungen, Durchquerungen,
 *       Zustand, nächster Kandidat — Grundlage von „Meine Zeichnungen analysieren"
 *
 * Gleiche Kerzen → gleiche IDs (deterministisch, im Selbsttest geprüft).
 */
import { atr, pivotHighs, pivotLows, ankerVwap } from '../shared/indicators.js'
import { volumenprofil } from '../shared/volumenprofil.js'
import { alleTrendlinien, istGegenlinie, verlaengerung, TOL_ATR, MIN_ABSTAND } from './chart-trendlinien.js'
import { trendZustand, durchquerungen } from './strategies/set_and_forget.js'
import { kandidatenDreiecke, dreieckName, pendel } from './chart-dreiecke.js'

export const KAND = {
    PIVOT_K: 3,
    CLUSTER_ATR: 0.5,          // Abstand zum Nachbarn in der Kette
    CLUSTER_MAX_ATR: 1,        // Gesamtbreite einer Gruppe
    BAND_MIN_ATR: 0.15,        // halbe Mindestbreite des Bands um den Preis
    REAKTION_KERZEN: 10,
    MAX_NIVEAUS: 6,
    NIVEAU_MAX_DURCH_ANTEIL: 0.5, // mehr Durchquerungen als die Hälfte der Berührungen: keine Marke, höchstens Drehpunkt
    NIVEAU_MAX_DURCH_FEST: 2,
    NAH_JE_SEITE: 2,
    TREND_JE_SEITE: 2,
    TREND_MIN_DELTA_ATR: 0.75, // flacher ist es eine waagerechte Marke
    TREND_MAX_ABSTAND_ATR: 5,  // weiter weg ist eine Trendlinie für den Kurs jetzt ohne Belang
    TREND_MAX_ABSTAND_ZWEI_ATR: 3, // mit nur zwei Berührungen enger
    SPANNE_KERZEN: 30,
    HTF_MAX: 4,
    HTF_ABSTAND_ATR_HTF: 3,
    DECKT_ATR: 0.4,            // V/D so nah an einem N → nicht doppelt aufführen (0,2 liess VAL und Marke 0,4 ATR auseinander beide stehen)
    ROH_KERZEN: 12,
    PROFIL_SCHWELLE_ATR: 5,    // Wendepunkt für einen Profil-Abschnitt: Gegenbewegung ab so vielen ATR
    PROFIL_MIN_KERZEN: 15,     // kürzere Abschnitte gehen im Nachbarn auf
    PROFIL_MAX: 3,             // die jüngsten so vielen Abschnitte
    KONS_BREITE_ATR: 3,        // Konsolidierung: alle Kerzenkörper in einem Band so breit
    KONS_MIN_KERZEN: 15,
    KONS_MAX: 3,
    PHASE_ZICKZACK_ATR: 3,     // Seitwärtsphase: Wendepunkte ab so vielen ATR Gegenbewegung
    PHASE_SPIELRAUM_ATR: 1,    // neuer Wendepunkt bis so weit ausserhalb des Kastens gehört noch dazu
    PHASE_MIN_WENDE: 4,        // mindestens zwei Hochs und zwei Tiefs
    PHASE_MIN_KERZEN: 30,
    PERIODE_MIN_KERZEN: 5,     // Tages-/Wochenprofil erst ab so vielen Kerzen der Periode
    // Fenster für Kanäle/Flaggen; lange (ab KANAL_LANG_AB) mit stärkeren Wendepunkten und
    // wachsendem Massstab (√(L / KANAL_BASIS_KERZEN) × ATR), seit 26.10.2026 — vorher nur bis 80
    KANAL_FENSTER: [320, 240, 160, 120, 80, 60, 45, 30, 20],
    // dazu eine Leiter vom ganzen Fenster abwärts, je Stufe 15 % kürzer (29.10.2026): wer herauszoomt,
    // will den übergeordneten Kanal. Feste Anteile (100/75/50/33 %) liessen Lücken — HBAR 4h auf
    // 800 Kerzen prüfte nichts zwischen 160 und 240, der Kanal über 177 Kerzen fiel durch.
    KANAL_LEITER: 0.85,
    KANAL_LANG_ANTEIL: 0.33,   // ein Kanal ab diesem Anteil des Fensters ist „übergeordnet" und bekommt einen eigenen Platz
    // Massstab des Fensters (29.10.2026): bis 150 Kerzen wie bisher, darüber wachsen
    // Wendepunkt-Stärke, Toleranzen und Abstandsgrenzen der Trendlinien und die
    // Wendepunkt-Stärke der Niveaus mit √(n / 150). Vorher fand der Code auf 150 und
    // 1000 Kerzen dieselben Linien — ein grösserer Ausschnitt änderte nichts.
    MASSSTAB_BASIS: 150,
    MASSSTAB_MAX: 3,
    KANAL_BASIS_KERZEN: 80,
    KANAL_LANG_AB: 120,
    KANAL_MIN_BREITE_ATR: 1,
    KANAL_MAX_BREITE_ATR: 6,   // breiter deckt er den halben Chart ab und sagt nichts mehr
    KANAL_MIN_STEIG_ATR: 1.5,  // Steigung über das Fenster: flacher ist es eine Spanne, kein Kanal
    KANAL_BERUEHR_ATR: 0.35,   // Abstand zur Kante, der als Berührung zählt
    FLAGGE_STANGE_ATR: 4,      // Fahnenstange vor der Flagge: mindestens so viele ATR …
    FLAGGE_STANGE_BREITE: 2,   // … und mindestens das Doppelte der Kanalbreite
    FLAGGE_STANGE_MAX_KERZEN: 15, // … in höchstens so vielen Kerzen (ein Impuls, kein Trend)
    FLAGGE_STANGE_SPIEL: 3,    // die Stange endet höchstens so viele Kerzen vor/nach dem Flaggenbeginn
    FLAGGE_MAX_KERZEN: 40,     // eine Flagge ist kurz; länger ist es ein Kanal
    FLAGGE_LAENGE_FAKTOR: 4,   // … und höchstens so viel mal so lang wie die Stange
    FLAGGE_MAX_RUECKLAUF: 0.5, // die Flagge holt höchstens die Hälfte der Stange zurück
    RANGE_STEIG_ATR: 1,        // Flagge, die über ihre Länge weniger steigt/fällt: waagerechte Range
    KANAL_UEBERSCHUSS_ATR: 0.6, // Wendepunkt bis so weit über die Kante hinaus zählt noch als Berührung
    KANAL_DOCHT_ATR: 1,        // ein Schluss weiter draussen bricht den Kanal (ein Docht nicht)
    KANAL_MAX_FOLGE: 2,        // Schlüsse ausserhalb hintereinander, danach gilt der Kanal als gebrochen
    KANAL_MAX_AUSSEN: 0.1,     // Anteil der Schlüsse ausserhalb im ganzen Kanal
    KANAL_MIN_SUMME: 6,        // Wendepunkte nahe beiden Kanten zusammen (Vorauswahl, je Kante ≥ 2)
    // Pendel (03.11.2026, wie bei den Dreiecken): der Kurs läuft abwechselnd von Kante zu Kante,
    // jeder Schwung über mindestens die halbe Breite — sonst sind es zwei Parallelen, kein Kanal
    KANAL_MIN_PENDEL: 6,       // Kanal: 3 + 3 abwechselnde Berührungen
    FLAGGE_MIN_PENDEL: 4,      // Flagge und Range nach einem Impuls sind kurz: 2 + 2
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

/**
 * Seitwärtsphasen wie von Hand gesehen (26.10.2026 — vorher `konsolidierungen`
 * mit allen Kerzenkörpern in 3 ATR: das fand nur die letzten paar Stunden, drei
 * verschachtelte Mini-Profile an derselben Stelle):
 *
 *   Zickzack  Wendepunkte ab `zickzack` × ATR Gegenbewegung (ATR = Median über
 *             das Fenster, ein einzelner Ausschlag verschiebt den Massstab nicht).
 *   Kasten    Hoch/Tief der Wendepunkte einer Phase. Solange der nächste
 *             Wendepunkt innerhalb des Kastens ± `spielraum` × ATR liegt, läuft
 *             die Phase weiter; liegt er draussen (Ausbruch), endet sie mit dem
 *             letzten Wendepunkt davor, und die nächste beginnt am Ausbruchspunkt.
 *             Ein Ausbruch zählt nur, wenn der nächste Wendepunkt NICHT in den Kasten
 *             zurückkommt — ein kurzer Stich bleibt in der Phase.
 *   Phase     erst ab `minWende` Wendepunkten (zwei Hochs, zwei Tiefs: ein Trend
 *             erzeugt keine, weil jedes neue Extrem den Kasten sprengt) und
 *             `minKerzen` Kerzen. Die jüngste Phase reicht bis zur letzten Kerze,
 *             wenn der Kurs noch im Kasten ist.
 *
 * Phasen überschneiden sich nie. Liefert die jüngsten `max`, älteste zuerst.
 */
export function seitwaertsPhasen(kerzen, { zickzack = KAND.PHASE_ZICKZACK_ATR, spielraum = KAND.PHASE_SPIELRAUM_ATR, minWende = KAND.PHASE_MIN_WENDE, minKerzen = KAND.PHASE_MIN_KERZEN, max = KAND.KONS_MAX } = {}) {
    const n = kerzen?.length || 0
    if (n < minKerzen) return []
    const a = atr(kerzen, 14).filter((v) => v > 0).sort((x, y) => x - y)
    const A = a[Math.floor(a.length / 2)]
    if (!(A > 0)) return []
    // Zickzack: abwechselnd Hoch und Tief, Wendepunkt ab S Gegenbewegung
    const S = zickzack * A
    const wende = []
    let richtung = 0, hI = 0, lI = 0
    for (let i = 1; i < n; i++) {
        const x = kerzen[i]
        if (x.h >= kerzen[hI].h) hI = i
        if (x.l <= kerzen[lI].l) lI = i
        if (richtung >= 0 && kerzen[hI].h - x.l >= S && hI < i) { wende.push({ i: hI, p: kerzen[hI].h, hoch: true }); richtung = -1; lI = i; hI = i }
        else if (richtung <= 0 && x.h - kerzen[lI].l >= S && lI < i) { wende.push({ i: lI, p: kerzen[lI].l, hoch: false }); richtung = 1; hI = i; lI = i }
    }
    // Der erste Punkt des Fensters ist kein Wendepunkt, nur der Anfang der Daten
    while (wende.length && wende[0].i === 0) wende.shift()
    const R = spielraum * A
    const phasen = []
    let von = 0, hoch = -Infinity, tief = Infinity
    const schliesse = (bis) => {
        const w = wende.slice(von, bis + 1)
        if (w.length >= minWende && w[w.length - 1].i - w[0].i + 1 >= minKerzen) phasen.push({ von: w[0].i, bis: w[w.length - 1].i, hoch, tief })
    }
    for (let k = 0; k < wende.length; k++) {
        const w = wende[k]
        // Eine noch unbekannte Seite des Kastens (±Infinity) begrenzt nicht
        const imKasten = (p) => (hoch === -Infinity || p <= hoch + R) && (tief === Infinity || p >= tief - R)
        const drin = k === von || imKasten(w.p)
        // Stich: draussen, aber der NÄCHSTE Wendepunkt ist wieder im Kasten — kein Ausbruch, der
        // Kasten wird davon auch nicht breiter (22.10.2026 16:45 BTC 15m: ein Docht unter die Spanne)
        // Nur an einer BELEGTEN Seite (zwei Wendepunkte): vorher erweitert ein neues Extrem den
        // Kasten — direkt nach einem Ausbruch kennt er seine Unterkante noch nicht.
        const belegt = wende.slice(von, k).filter((x) => x.hoch === w.hoch).length >= 2
        // … es sei denn, es liegt mehr als einen Zickzack-Schritt draussen: dann läuft der Trend
        // weiter, und der Kasten beginnt dort neu (sonst begänne die Phase vor dem Absturz).
        if (!drin && !belegt) {
            const weit = w.hoch ? w.p - hoch > S : tief - w.p > S
            if (weit) { von = k; hoch = w.hoch ? w.p : -Infinity; tief = w.hoch ? Infinity : w.p; continue }
            if (w.hoch) hoch = Math.max(hoch, w.p); else tief = Math.min(tief, w.p)
            continue
        }
        if (!drin && k + 1 < wende.length && imKasten(wende[k + 1].p)) continue
        if (!drin) {
            // Ausbruch: die Phase endet beim letzten Wendepunkt im Kasten; die nächste beginnt
            // HIER (am Ausbruchspunkt) — begänne sie davor, läge die ganze Ausbruchsbewegung in ihr.
            schliesse(k - 1)
            von = k
            hoch = -Infinity; tief = Infinity
        }
        if (w.hoch) hoch = Math.max(hoch, w.p); else tief = Math.min(tief, w.p)
    }
    // jüngste Phase: läuft bis jetzt, solange die letzten Kerzen im Kasten sind
    const w = wende.slice(von)
    if (w.length >= minWende) {
        const letzte = kerzen[n - 1]
        const imKasten = letzte.c <= hoch + R && letzte.c >= tief - R
        const bis = imKasten ? n - 1 : w[w.length - 1].i
        if (bis - w[0].i + 1 >= minKerzen) phasen.push({ von: w[0].i, bis, hoch, tief, laufend: imKasten })
    }
    return phasen.slice(-max).map(({ von, bis, laufend }) => ({ von, bis, ...(laufend ? { laufend: true } : {}) }))
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
 *   Flagge      davor eine Fahnenstange in die Gegenrichtung (`fahnenstange`):
 *               Stange auf + Kanal ab/flach = Bull-Flagge, Stange ab + Kanal
 *               auf/flach = Bear-Flagge. Bis 27.10.2026 galt als „Stange" die
 *               Bewegung über gleich viele Kerzen VOR dem Kanal, wie er lang war —
 *               damit wurde ein Monat Abwärtstrend über 160 Kerzen und 11 ATR
 *               Breite zur „Bull-Flagge" (HBARUSDT 4h, 500 Kerzen).
 *   Range       steigt bzw. fällt eine Flagge über ihre ganze Länge weniger als
 *               `RANGE_STEIG_ATR`, ist sie eine Seitwärts-Range und wird WAAGERECHT
 *               eingezeichnet: Kanten am Median der Hochs bzw. Tiefs, die die
 *               schräge Suche als Berührung zählte, dann neu geprüft (`form:
 *               'range'`). Bis 27.10.2026 stand HBARUSDT 4h — 22 Kerzen seitwärts
 *               nach dem Abverkauf — als schräg steigender Kanal im Chart.
 *   Pendel      (03.11.2026) der Kurs läuft abwechselnd von Kante zu Kante, jeder
 *               Schwung über mindestens die halbe Breite und an seiner Kante endend
 *               (`pendel` aus chart-dreiecke.js): Kanal ≥ 6 (je Kante 3), Flagge/Range
 *               ≥ 4 (je Kante 2) Berührungen; Umkehrer in der Mitte höchstens so viele
 *               wie Berührungen. Vorher reichten Wendepunkte nahe zwei
 *               Parallelen — auch ein durchlaufender Trend mit Zitterern.
 *   Bruch       schliesst die jüngste Kerze schon jenseits einer Kante, sagt
 *               es der Name (`bruch` oben/unten).
 *
 * Gewählt wird der Kanal mit den meisten Berührungen (Flagge +4, wenig
 * Überschiessen, länger bei Gleichstand); höchstens einer.
 */
export function kandidatenKanaele(kerzen, A) {
    const n = kerzen?.length || 0
    if (n < 30 || !(A > 0)) return []
    // Wendepunkte je Stärke einmal: kurze Fenster mit 2, lange mit 4 Kerzen zu beiden Seiten
    // (sonst zählt in 300 Kerzen jedes Zittern als Berührung)
    const wp = {}
    const wendepunkte = (k) => (wp[k] ||= { H: pivotHighs(kerzen, k, k).map((p) => p.index), T: pivotLows(kerzen, k, k).map((p) => p.index) })
    const funde = []
    const kurs = kerzen[n - 1].c

    const leiter = []
    for (let L = n - 10; L >= 20; L = Math.round(L * KAND.KANAL_LEITER)) leiter.push(L)
    const fenster = [...new Set([...leiter, ...KAND.KANAL_FENSTER])]
        .filter((L) => L >= 20 && L <= n - 10).sort((a, b) => b - a)
    for (const L of fenster) {
        // Massstab wächst mit der Länge (√): ein Kanal über 300 Kerzen ist natürlich breiter als
        // einer über 30 — mit dem ATR der letzten 14 Kerzen wäre jeder lange Kanal „zu breit".
        const Aw = A * Math.max(1, Math.sqrt(L / KAND.KANAL_BASIS_KERZEN))
        const tol = KAND.KANAL_BERUEHR_ATR * Aw
        const ueber = KAND.KANAL_UEBERSCHUSS_ATR * Aw
        const docht = KAND.KANAL_DOCHT_ATR * Aw
        const { H: hochs, T: tiefs } = wendepunkte(L >= KAND.KANAL_LANG_AB ? Math.max(4, Math.round(4 * Math.sqrt(L / 320))) : 2)
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
                    if (W < KAND.KANAL_MIN_BREITE_ATR * Aw || W > KAND.KANAL_MAX_BREITE_ATR * Aw) continue
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
                    const st = fahnenstange(kerzen, anfang, A, W, steig, Aw)
                    const muster = st?.muster || null
                    if (!muster && Math.abs(steig) < KAND.KANAL_MIN_STEIG_ATR * Aw) continue
                    // Kaum Steigung: waagerecht neu anlegen statt eine Schräge zu zeichnen, die nicht da ist
                    let form = 'kanal', untenF = lo, obenF = hi, Wf = W, bO = bOben, bU = bUnten, aus = aussen
                    if (muster && Math.abs(steig) < KAND.RANGE_STEIG_ATR * Aw) {
                        const r = waagerecht(kerzen, anfang, H, T, lo, hi, tol, ueber, docht)
                        if (!r || r.W < KAND.KANAL_MIN_BREITE_ATR * Aw || r.W > KAND.KANAL_MAX_BREITE_ATR * Aw) continue
                        form = 'range'; untenF = () => r.unten; obenF = () => r.oben; Wf = r.W; bO = r.bOben; bU = r.bUnten; aus = r.aussen
                    }
                    // Pendelt der Kurs zwischen den Kanten? Abwechselnd oben/unten, jeder Schwung an seiner Kante.
                    const pen = pendel(kerzen, anfang, obenF, untenF, A, { jenseits: true, luecken: true })
                    const pO = pen.filter((x) => x.oben).length, pU = pen.length - pO
                    if (pen.length < (muster ? KAND.FLAGGE_MIN_PENDEL : KAND.KANAL_MIN_PENDEL) || Math.min(pO, pU) < (muster ? 2 : 3)) continue
                    bO = pO; bU = pU
                    const c = kerzen[n - 1].c
                    const bruch = c < untenF(n - 1) - tol ? 'unten' : c > obenF(n - 1) + tol ? 'oben' : null
                    const ext = Math.max(3, Math.round(spanne * 0.25))
                    const iv = (kerzen[n - 1].t - kerzen[anfang].t) / Math.max(1, spanne - 1)
                    const mitte = (untenF(n - 1) + obenF(n - 1)) / 2
                    funde.push({
                        quelle: 'kanal', richtung: form === 'range' ? 'seitwaerts' : steig >= 0 ? 'auf' : 'ab', form, muster, laenge: spanne,
                        t1: kerzen[anfang].t, p1: untenF(anfang), t2: kerzen[n - 1].t, p2: untenF(n - 1),
                        tEnde: kerzen[n - 1].t + ext * iv, pEnde: untenF(n - 1 + ext),
                        breite: Wf, breiteAtr: Wf / A, beruehrOben: bO, beruehrUnten: bU, ausserhalb: aus,
                        untenJetzt: untenF(n - 1), obenJetzt: obenF(n - 1),
                        preis: mitte, abstandAtr: (mitte - kurs) / A,
                        stangeAtr: st ? st.groesse / A : null, stangeKerzen: st?.kerzen ?? null,
                        ruecklaufPct: st ? st.ruecklauf * 100 : null, bruch,
                        pendelPunkte: pen.map((x) => ({ t: kerzen[x.i].t, p: x.oben ? kerzen[x.i].h : kerzen[x.i].l, oben: x.oben })),
                        wert: bO + bU + (muster ? 4 : 0) - aus * 0.5 + spanne / 200,
                    })
                }
            }
        }
    }
    funde.sort((a, b) => b.wert - a.wert)
    // Zwei Plätze (29.10.2026): der beste kurze am Kurs (K1) und der beste übergeordnete über
    // einen grossen Teil des Fensters (K2) — sonst verdrängt der eine immer den anderen.
    const grenze = KAND.KANAL_LANG_ANTEIL * n
    const lang = funde.find((k) => k.laenge >= grenze)
    const kurz = funde.find((k) => k.laenge < grenze && (!lang || k.laenge * 2 <= lang.laenge))
    return [kurz, lang].filter(Boolean).map(({ wert, ...k }) => k)
}

const median = (a) => { const b = [...a].sort((x, y) => x - y); const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2 }

/**
 * Waagerechte Kanten für einen Kanal ohne nennenswerte Steigung: Median der
 * Hochs bzw. Tiefs, die an der schrägen Kante als Berührung zählten; danach
 * dieselben Prüfungen wie für den schrägen Kanal (Berührungen je Kante ≥ 2,
 * zusammen ≥ `KANAL_MIN_SUMME`, Schlüsse draussen). `null`, wenn es waagerecht
 * nicht hält.
 */
function waagerecht(kerzen, anfang, H, T, lo, hi, tol, ueber, docht) {
    const n = kerzen.length
    const hochs = H.filter((i) => i >= anfang && kerzen[i].h >= hi(i) - tol && kerzen[i].h <= hi(i) + ueber).map((i) => kerzen[i].h)
    const tiefs = T.filter((i) => i >= anfang && kerzen[i].l <= lo(i) + tol && kerzen[i].l >= lo(i) - ueber).map((i) => kerzen[i].l)
    if (hochs.length < 2 || tiefs.length < 2) return null
    const oben = median(hochs), unten = median(tiefs)
    if (!(oben > unten)) return null
    const bOben = H.filter((i) => i >= anfang && Math.abs(kerzen[i].h - oben) <= Math.max(tol, ueber)).length
    const bUnten = T.filter((i) => i >= anfang && Math.abs(kerzen[i].l - unten) <= Math.max(tol, ueber)).length
    if (bOben < 2 || bUnten < 2 || bOben + bUnten < KAND.KANAL_MIN_SUMME) return null
    let aussen = 0, folge = 0, maxFolge = 0
    for (let i = anfang; i < n; i++) {
        const c = kerzen[i].c
        if (c > oben + docht || c < unten - docht) {
            if (i < n - 1) return null                        // weit draussen und zurück = keine Range
        }
        const raus = c > oben + tol || c < unten - tol
        if (raus) { aussen++; folge++; maxFolge = Math.max(maxFolge, folge) } else folge = 0
    }
    if (maxFolge > KAND.KANAL_MAX_FOLGE || aussen > KAND.KANAL_MAX_AUSSEN * (n - anfang)) return null
    return { oben, unten, W: oben - unten, bOben, bUnten, aussen }
}

/**
 * Fahnenstange vor einem Kanal, der bei Kerze `anfang` beginnt: ein Impuls in
 * höchstens `FLAGGE_STANGE_MAX_KERZEN` Kerzen, dessen Extrem höchstens
 * `FLAGGE_STANGE_SPIEL` Kerzen vom Flaggenbeginn entfernt liegt, mindestens
 * `FLAGGE_STANGE_ATR` × ATR und `FLAGGE_STANGE_BREITE` Kanalbreiten gross. Die
 * Flagge danach ist höchstens `FLAGGE_MAX_KERZEN` und `FLAGGE_LAENGE_FAKTOR` ×
 * Stange lang und holt höchstens `FLAGGE_MAX_RUECKLAUF` der Stange zurück.
 * Bull: Stange auf, Kanal ab oder flach; Bear gespiegelt. Sonst `null`.
 */
export function fahnenstange(kerzen, anfang, A, W, steig, Aw = A) {
    const n = kerzen.length
    const laenge = n - anfang
    if (laenge > KAND.FLAGGE_MAX_KERZEN || anfang < 2) return null
    const mindest = Math.max(KAND.FLAGGE_STANGE_ATR * A, KAND.FLAGGE_STANGE_BREITE * W)
    let beste = null
    for (const auf of [true, false]) {
        if (auf ? steig > 0.5 * Aw : steig < -0.5 * Aw) continue
        // Ende der Stange: Extrem in Stangenrichtung rund um den Flaggenbeginn …
        let e = Math.max(0, anfang - KAND.FLAGGE_STANGE_SPIEL)
        for (let i = e; i <= Math.min(n - 1, anfang + KAND.FLAGGE_STANGE_SPIEL); i++) if (auf ? kerzen[i].h > kerzen[e].h : kerzen[i].l < kerzen[e].l) e = i
        // … Start: das Gegen-Extrem in den Kerzen davor
        const von = Math.max(0, e - KAND.FLAGGE_STANGE_MAX_KERZEN)
        let j = e
        for (let i = von; i < e; i++) if (auf ? kerzen[i].l < kerzen[j].l : kerzen[i].h > kerzen[j].h) j = i
        if (j >= e) continue
        const groesse = auf ? kerzen[e].h - kerzen[j].l : kerzen[j].h - kerzen[e].l
        if (groesse < mindest) continue
        if (n - e > KAND.FLAGGE_LAENGE_FAKTOR * Math.max(e - j, 2)) continue
        let gegen = auf ? Infinity : -Infinity
        for (let i = e; i < n; i++) gegen = auf ? Math.min(gegen, kerzen[i].l) : Math.max(gegen, kerzen[i].h)
        const ruecklauf = (auf ? kerzen[e].h - gegen : gegen - kerzen[e].l) / groesse
        if (ruecklauf > KAND.FLAGGE_MAX_RUECKLAUF) continue
        if (!beste || groesse > beste.groesse) beste = { muster: auf ? 'bullFlagge' : 'bearFlagge', groesse, kerzen: e - j, ruecklauf }
    }
    return beste
}

const BRUCH_TEXT = {
    flagge: { unten: [', nach unten gebrochen', ', broken down'], oben: [', nach oben gebrochen', ', broken up'] },
    kanal: { unten: [', nach unten verlassen', ', left downwards'], oben: [', nach oben verlassen', ', left upwards'] },
}

/** Kurzer Name ohne Zahlen („Bear-Flagge", „aufsteigender Kanal") — für jede weitere Nennung im Text. */
export function kanalKurz(k, englisch = false) {
    if (k.form === 'range') return englisch ? 'sideways range' : 'Seitwärts-Range'
    if (k.muster === 'bullFlagge') return englisch ? 'bull flag' : 'Bull-Flagge'
    if (k.muster === 'bearFlagge') return englisch ? 'bear flag' : 'Bear-Flagge'
    const auf = k.richtung === 'auf'
    return englisch ? `${auf ? 'ascending' : 'descending'} channel` : `${auf ? 'aufsteigender' : 'absteigender'} Kanal`
}

/** Beschriftung im Chart: kurzer Name plus Bruch, ohne Berührungszahlen (die stehen im Reiter). */
export function kanalBeschriftung(k, englisch = false) {
    const br = k.bruch ? BRUCH_TEXT[k.muster && k.form !== 'range' ? 'flagge' : 'kanal'][k.bruch][englisch ? 1 : 0] : ''
    const kurz = kanalKurz(k, englisch)
    return kurz.charAt(0).toUpperCase() + kurz.slice(1) + br
}

/** Name eines Kanals, vom Code vergeben (nicht vom Modell). */
export function kanalName(k, englisch = false) {
    const b = `${k.beruehrOben}/${k.beruehrUnten}`
    const br = k.bruch ? BRUCH_TEXT[k.muster && k.form !== 'range' ? 'flagge' : 'kanal'][k.bruch][englisch ? 1 : 0] : ''
    if (k.form === 'range') {
        const nach = k.muster === 'bullFlagge' ? (englisch ? ' after an up impulse' : ' nach Aufwärts-Impuls') : k.muster === 'bearFlagge' ? (englisch ? ' after a down impulse' : ' nach Abwärts-Impuls') : ''
        return englisch ? `Sideways range${nach} (${b} touches${br})` : `Seitwärts-Range${nach} (${b} Berührungen${br})`
    }
    if (k.muster === 'bullFlagge') return englisch ? `Bull flag (${b} touches${br})` : `Bull-Flagge (${b} Berührungen${br})`
    if (k.muster === 'bearFlagge') return englisch ? `Bear flag (${b} touches${br})` : `Bear-Flagge (${b} Berührungen${br})`
    const auf = k.richtung === 'auf'
    return englisch ? `${auf ? 'Ascending' : 'Descending'} channel (${b} touches${br})` : `${auf ? 'Aufsteigender' : 'Absteigender'} Kanal (${b} Berührungen${br})`
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

/** Massstab des Fensters: 1 bis `MASSSTAB_BASIS` Kerzen, darüber √(n / Basis), höchstens `MASSSTAB_MAX`. */
export function massstab(n) {
    return Math.min(KAND.MASSSTAB_MAX, Math.max(1, Math.sqrt((n || 0) / KAND.MASSSTAB_BASIS)))
}

/**
 * Wendepunkte zu Niveaus gruppieren. Absolutes Hoch und Tief zählen mit, auch
 * wenn sie am Rand liegen (ein Pivot braucht K Kerzen danach).
 */
export function kandidatenNiveaus(kerzen, { atrWert = letzteAtr(kerzen), k = KAND.PIVOT_K, M = 1 } = {}) {
    const n = kerzen.length
    const A = atrWert
    // Breite der Zonen im Massstab des Fensters (29.10.2026): auf 1000 Kerzen HBAR 4h zerfielen
    // die Zonen bei 1 ATR (der letzten 14 Kerzen) in Einzelpunkte — übrig blieben Hoch, Tief und
    // eine Marke, während der Kurs an einer Zone mit 9 Berührungen stand. Reaktion und Abstand
    // bleiben im ATR der Chart-Zeiteinheit.
    const B = A * M
    const reaktKerzen = Math.round(KAND.REAKTION_KERZEN * M)
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
        for (let j = p.i + 1; j <= Math.min(n - 1, p.i + reaktKerzen); j++) {
            const w = p.art === 'hoch' ? kerzen[j].l : kerzen[j].h
            ext = ext == null ? w : (p.art === 'hoch' ? Math.min(ext, w) : Math.max(ext, w))
        }
        p.reakt = ext == null ? 0 : Math.max(0, (p.art === 'hoch' ? p.preis - ext : ext - p.preis) / A)
    }
    pts.sort((x, y) => x.preis - y.preis || x.i - y.i)
    const gruppen = []
    let g = []
    for (const p of pts) {
        if (g.length && p.preis - g[g.length - 1].preis <= KAND.CLUSTER_ATR * B && p.preis - g[0].preis <= KAND.CLUSTER_MAX_ATR * B) g.push(p)
        else { if (g.length) gruppen.push(g); g = [p] }
    }
    if (g.length) gruppen.push(g)
    const kurs = kerzen[n - 1].c
    return gruppen.map((gr) => {
        const preise = gr.map((p) => p.preis).sort((a, b) => a - b)
        const preis = preise[Math.floor(preise.length / 2)]
        const re = gr.map((p) => p.reakt).sort((a, b) => a - b)
        const ersterI = Math.min(...gr.map((p) => p.i)), letzterI = Math.max(...gr.map((p) => p.i))
        const tief = Math.min(preise[0], preis - KAND.BAND_MIN_ATR * B)
        const hoch = Math.max(preise[preise.length - 1], preis + KAND.BAND_MIN_ATR * B)
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
    // Saubere Marken (26.10.2026, nach „9 Berührungen, 7 Durchquerungen" als Widerstand und
    // einer „Zwischenunterstützung" mit EINER Berührung): mindestens zwei Berührungen und
    // höchstens halb so viele Durchquerungen — oder das Hoch/Tief des Bereichs. Eine oft
    // durchquerte Marke bleibt nur als EIN Drehpunkt (die mit den meisten Berührungen).
    const sauber = (x) => x.beruehrungen >= 2 && x.durchquerungen <= Math.max(KAND.NIVEAU_MAX_DURCH_FEST, x.beruehrungen * KAND.NIVEAU_MAX_DURCH_ANTEIL)
    // … und auch der nur, wenn er nicht öfter durchquert als berührt wird (sonst ist er bloss die Mitte)
    const drehpunkt = niveaus.filter((x) => x.rolle === 'wechsel' && x.beruehrungen >= 3 && !sauber(x) && x.durchquerungen <= x.beruehrungen)
        .sort((a, b) => b.beruehrungen - a.beruehrungen)[0]
    const zugelassen = niveaus.filter((x) => x.extrem || sauber(x) || x === drehpunkt)
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
    const M = massstab(n), Am = atrWert * M
    const opt = { tol: TOL_ATR * Am, atr: Am, k: Math.round(KAND.PIVOT_K * M), minAbstand: Math.round(MIN_ABSTAND * M), minSpanneZwei: Math.round(20 * M) }
    const aus = []
    for (const seite of ['hoch', 'tief']) {
        const liste = []
        for (const c of alleTrendlinien(kerzen, seite, opt)) {
            if (Math.abs(c.p2 - c.p1) < KAND.TREND_MIN_DELTA_ATR * Am) continue
            const steigung = (c.p2 - c.p1) / (c.i2 - c.i1)
            const wertJetzt = c.p1 + steigung * (n - 1 - c.i1)
            const abstandAtr = (wertJetzt - kurs) / atrWert
            // Gegenlinien entfernen sich vom Kurs, sobald er abdreht — für sie gilt die enge Grenze.
            const gegen = istGegenlinie(seite, c.p1, c.p2)
            const grenze = c.beruehrungen < 3 || gegen ? KAND.TREND_MAX_ABSTAND_ZWEI_ATR : KAND.TREND_MAX_ABSTAND_ATR
            if (Math.abs(abstandAtr) > grenze * M) continue
            const ext = verlaengerung(n, c.i1)
            liste.push({
                seite, richtung: steigung < 0 ? 'ab' : 'auf',
                rolle: seite === 'hoch' ? 'widerstand' : 'unterstuetzung',
                gegen,
                t1: kerzen[c.i1].t, p1: c.p1, t2: kerzen[c.i2].t, p2: c.p2,
                beruehrungen: c.beruehrungen, beruehrT: c.beruehrIdx.map((i) => kerzen[i].t),
                letzteBeruehrungT: kerzen[c.beruehrIdx[c.beruehrIdx.length - 1]].t,
                wertJetzt, abstandAtr, steigungAtr: steigung / atrWert,
                tEnde: kerzen[n - 1].t + ext * iv, pEnde: wertJetzt + steigung * ext,
            })
        }
        liste.sort((x, y) => y.beruehrungen - x.beruehrungen || Number(x.gegen) - Number(y.gegen) || Math.abs(x.abstandAtr) - Math.abs(y.abstandAtr))
        const gewaehlt = []
        for (const c of liste) {
            if (gewaehlt.some((d) => Math.abs(d.wertJetzt - c.wertJetzt) < 0.5 * Am)) continue
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
// ── Eigene Zeichnungen ───────────────────────────────────────────────────
export const NUTZER_TYPEN = ['horizontale', 'strahlH', 'trendlinie', 'strahl', 'kanal', 'rechteck', 'volprofil', 'fib', 'avwap']
export const NUTZER_MAX = 20
const WAAGERECHT = ['horizontale', 'strahlH']
const SCHRAEG = ['trendlinie', 'strahl']
const NUTZER_NAME = {
    horizontale: 'Horizontale', strahlH: 'Horizontaler Strahl', trendlinie: 'Trendlinie', strahl: 'Strahl', kanal: 'Kanal',
    rechteck: 'Zone', volprofil: 'Volumenprofil', fib: 'Fibonacci', avwap: 'Anchored VWAP',
    // nicht gemessen, nur für den Hinweis „nicht in der Liste"
    fibExt: 'Fib-Extension', pfeil: 'Pfeil', ellipse: 'Ellipse', pinsel: 'Pinsel', position: 'Long/Short-Position', text: 'Text', vertikale: 'Vertikale',
}
const FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]
// Korrektur nur, wenn der Kandidat höchstens so weit daneben liegt (Chart-ATR)
export const KORREKTUR_ATR = 1.5

/**
 * Gilt die Zeichnung auf dieser Zeiteinheit? Dieselbe Regel wie im Chart
 * (`ChartPanel.vue`, `sichtbareZeichnungen`): `sichtbarAuf` leer oder null = auf
 * allen. Aus der DB kommt das Feld als JSON-Text, vom Browser als Liste.
 * Ohne `interval` (alte Aufrufe) gilt jede.
 */
export function sichtbarAufTf(z, interval) {
    if (!interval) return true
    let auf = z?.sichtbarAuf
    if (typeof auf === 'string') { try { auf = JSON.parse(auf) } catch { auf = null } }
    return !Array.isArray(auf) || !auf.length || auf.includes(interval)
}

/** Liegt die Zeichnung zeitlich im Bild (waagerechte immer, sofern schon begonnen)? */
function imBild(z, vonT, bisT) {
    const ts = (z.punkte || []).map((q) => Number(q.t)).filter(Number.isFinite)
    if (!ts.length || Math.min(...ts) > bisT) return false
    if (z.typ === 'horizontale' || z.typ === 'strahlH' || z.typ === 'strahl' || z.typ === 'avwap') return true
    if (z.stil?.rechts || z.stil?.fortlaufend) return true
    return Math.max(...ts) >= vonT
}

/** Grober Preisabstand einer Zeichnung zum Kurs, nur zum Ordnen (Schräge: Wert am rechten Rand). */
function nutzerAbstand(z, kurs, bisT) {
    const pk = (z.punkte || []).map((q) => ({ t: Number(q.t), p: Number(q.p) })).filter((q) => Number.isFinite(q.p) && Number.isFinite(q.t))
    if (!pk.length || !Number.isFinite(kurs)) return Infinity
    let preise = pk.map((q) => q.p)
    if ((SCHRAEG.includes(z.typ) || z.typ === 'kanal') && pk.length >= 2 && pk[0].t !== pk[1].t) {
        const g = gerade(pk[0], pk[1])
        preise = [g(bisT)]
        if (z.typ === 'kanal' && pk[2]) preise.push(g(bisT) + pk[2].p - g(pk[2].t))
    }
    const lo = Math.min(...preise), hi = Math.max(...preise)
    return kurs < lo ? lo - kurs : kurs > hi ? kurs - hi : 0
}

/**
 * Welche eigenen Zeichnungen in die Analyse kommen — rein.
 *
 * Gezählt wird nur, was der Nutzer im Chart SIEHT: nicht versteckt, auf dieser
 * Zeiteinheit sichtbar (`sichtbarAuf`, bis 01.11.2026 nicht beachtet — eine
 * Horizontale „nur 4h" stand in der 1h-Analyse und wurde dort „korrigiert"),
 * zeitlich im Bild. Sind es mehr als `NUTZER_MAX`, entscheidet die Reihenfolge
 * (bis 01.11.2026 die der Datenbank: 20 alte Horizontalen verdrängten Trendlinie,
 * Zone und Kanal, die gerade gezeichnet waren): Punkte im Analysefenster zuerst,
 * dann Nähe zum Kurs, dann zuletzt geändert.
 *
 * Typen, die der Code nicht misst (Fib-Extension, Pfeil, Ellipse, Pinsel …),
 * fallen weg, werden aber je Typ gezählt (`uebergangen`) — sonst hiesse es
 * „keine eigene Zeichnung", obwohl welche im Bild stehen.
 *
 * @returns {{ liste: object[], weggelassen: number, uebergangen: {typ: string, anzahl: number}[] }}
 */
export function waehleNutzer(zeichnungen, vonT, bisT, { interval = null, kurs = null } = {}) {
    const sichtbar = (zeichnungen || []).filter((z) => z && !z.versteckt && sichtbarAufTf(z, interval) && imBild(z, vonT, bisT))
    const uebergangen = new Map()
    for (const z of sichtbar) if (!NUTZER_TYPEN.includes(z.typ)) uebergangen.set(z.typ, (uebergangen.get(z.typ) || 0) + 1)
    const messbar = sichtbar.filter((z) => NUTZER_TYPEN.includes(z.typ))
    const imFenster = (z) => (z.punkte || []).some((q) => Number(q.t) >= vonT && Number(q.t) <= bisT)
    const geordnet = messbar.map((z, i) => ({ z, i, fenster: imFenster(z) ? 0 : 1, abstand: nutzerAbstand(z, kurs, bisT), geaendert: Number(z.geaendertAm) || 0 }))
        .sort((a, b) => a.fenster - b.fenster || a.abstand - b.abstand || b.geaendert - a.geaendert || a.i - b.i)
        .map((x) => x.z)
    return {
        liste: geordnet.slice(0, NUTZER_MAX),
        weggelassen: Math.max(0, geordnet.length - NUTZER_MAX),
        uebergangen: [...uebergangen].map(([typ, anzahl]) => ({ typ, anzahl })),
    }
}

/** Eigene Zeichnungen, die in die Analyse kommen (nur die Liste, siehe `waehleNutzer`). */
export function sichtbareNutzer(zeichnungen, vonT, bisT, optionen = {}) {
    return waehleNutzer(zeichnungen, vonT, bisT, optionen).liste
}

/** Gerade durch zwei Punkte, als Preis zur Zeit t. */
const gerade = (a, b) => (t) => (b.t === a.t ? a.p : a.p + (b.p - a.p) * (t - a.t) / (b.t - a.t))

/**
 * Berührungen (eigene Wellen: mindestens 3 Kerzen ohne Berührung dazwischen),
 * Durchquerungen (Schluss wechselt die Seite) und Reaktion nach einer Berührung
 * (grösste Entfernung in den 10 Kerzen danach, in ATR) — für eine Linie, deren
 * Preis `wert(i)` je Kerze liefert (null = dort gilt sie nicht).
 */
export function zaehleAnLinie(kerzen, wert, A, tol = 0.25 * A) {
    let beruehrungen = 0, durchquerungen = 0, letzteT = null, letzteI = -99, seite = 0, reaktion = 0, kreuzI = null, erstes = null
    const beruehrI = []
    for (let i = 0; i < kerzen.length; i++) {
        const w = wert(i)
        if (w == null || !Number.isFinite(w)) continue
        if (erstes == null) erstes = i
        const k = kerzen[i]
        if (k.l <= w + tol && k.h >= w - tol) {
            if (i - letzteI > 3) {
                beruehrungen++
                beruehrI.push(i)
                let weit = 0
                for (let j = i + 1; j < Math.min(kerzen.length, i + 11); j++) {
                    const wj = wert(j)
                    if (wj == null) break
                    weit = Math.max(weit, Math.abs(kerzen[j].c - wj))
                }
                reaktion = Math.max(reaktion, weit / A)
            }
            letzteI = i
            letzteT = k.t
        }
        const sg = Math.sign(k.c - w)
        if (sg && seite && sg !== seite) { durchquerungen++; kreuzI = i }
        if (sg) seite = sg
    }
    const n = kerzen.length
    const jetzt = wert(n - 1)
    /*
     * Gebrochen bleibt gebrochen, solange der Kurs auf der anderen Seite steht —
     * bis 01.11.2026 galt eine Linie schon 6 Kerzen nach dem Bruch wieder als
     * „hält" (BTC 1h: untere Kanallinie am 29.10. gebrochen, am 31.10. „hält").
     * Dreimal und öfter durchquert ist sie ein Drehpunkt, keine Grenze.
     */
    // Drehpunkt nur, solange der Kurs an der Linie klebt (≤ 1 ATR) — steht er klar auf der
    // anderen Seite, ist die Linie gebrochen, auch wenn sie vorher ein paarmal durchstochen wurde.
    const klebt = jetzt != null && Math.abs(kerzen[n - 1].c - jetzt) <= A
    const zustand = jetzt == null ? 'endet'
        : kreuzI == null ? (beruehrungen ? 'haelt' : 'unberuehrt')
            : durchquerungen >= 3 && klebt ? 'drehpunkt' : 'gebrochen'
    const bruch = kreuzI == null ? null : {
        t: kerzen[kreuzI].t, vorKerzen: n - 1 - kreuzI,
        // Berührungen vor dem Bruch (hat die Linie vorher gegolten?) und Tests danach (Rücktest von der anderen Seite)
        vorher: beruehrI.filter((i) => i < kreuzI).length, tests: beruehrI.filter((i) => i > kreuzI).length,
        nach: kerzen[kreuzI].c > (wert(kreuzI) ?? kerzen[kreuzI].c) ? 'oben' : 'unten',
    }
    return { beruehrungen, durchquerungen, letzteT, reaktionMaxAtr: reaktion, zustand, jetzt, bruch, kerzenSeitAnfang: erstes == null ? 0 : n - erstes }
}

/** Kerze, in der die Zeit t liegt (Index), oder -1. */
function kerzeBei(kerzen, t) {
    for (let i = kerzen.length - 1; i >= 0; i--) if (kerzen[i].t <= t) return t - kerzen[i].t < 2 * ((kerzen[1]?.t ?? kerzen[0].t + 1) - kerzen[0].t) ? i : -1
    return -1
}

/**
 * Wie gut sitzt ein Ankerpunkt? Abstand zum nächsten Hoch/Tief der Kerzen
 * rundum (±2), in ATR. Ein Anker mitten im Nichts ist kein Wendepunkt — eine
 * Linie, die an keinem echten Hoch oder Tief hängt, misst nichts.
 */
export function ankerSitz(kerzen, pt, A) {
    const i = kerzeBei(kerzen, pt.t)
    if (i < 0) return null
    let best = Infinity
    for (let j = Math.max(0, i - 2); j <= Math.min(kerzen.length - 1, i + 2); j++) best = Math.min(best, Math.abs(kerzen[j].h - pt.p), Math.abs(kerzen[j].l - pt.p))
    return best / A
}

/**
 * Schneidet die Strecke zwischen den Ankern durch Kerzenkörper? Zählt Kerzen,
 * deren Körper (Eröffnung–Schluss) die Linie um mehr als 0,15 ATR auf beiden
 * Seiten umschliesst — eine Trendlinie gehört an Hochs oder Tiefs, nicht quer
 * durch die Kerzen.
 */
export function koerperSchnitte(kerzen, von, bis, wert, A) {
    let n = 0, gesamt = 0
    for (let i = Math.max(0, von); i <= Math.min(kerzen.length - 1, bis); i++) {
        const w = wert(i)
        if (w == null) continue
        gesamt++
        const k = kerzen[i]
        if (Math.min(k.o, k.c) < w - 0.15 * A && Math.max(k.o, k.c) > w + 0.15 * A) n++
    }
    return { schnitte: n, kerzen: gesamt }
}

/**
 * Zone ab ihrem linken Rand: lag dort ein Wendepunkt (Tief/Hoch der Umgebung in
 * der Zone), wie weit lief der Kurs danach weg, bevor er zurückkam, und wann war
 * er zuletzt drin — das, was eine gezeichnete Zone BEGRÜNDET, nicht nur, ob sie berührt wurde.
 */
export function zonenUrsprung(kerzen, vonI, tief, hoch, A) {
    if (vonI < 0 || vonI >= kerzen.length) return null
    const rund = kerzen.slice(Math.max(0, vonI - 10), Math.min(kerzen.length, vonI + 11))
    const tiefRund = Math.min(...rund.map((k) => k.l)), hochRund = Math.max(...rund.map((k) => k.h))
    const wende = tiefRund >= tief - 0.25 * A && tiefRund <= hoch + 0.25 * A ? 'tief'
        : hochRund >= tief - 0.25 * A && hochRund <= hoch + 0.25 * A ? 'hoch' : null
    // Bewegung weg von der Zone bis zur ersten Rückkehr
    let extrem = null, extremI = -1, weg = false, zurueckI = -1
    for (let i = vonI; i < kerzen.length; i++) {
        const k = kerzen[i]
        const drin = k.l <= hoch && k.h >= tief
        if (!drin) weg = true
        else if (weg) { zurueckI = i; break }
        const d = wende === 'hoch' ? tief - k.l : k.h - hoch
        if (d > 0 && (extrem == null || d > extrem)) { extrem = d; extremI = i }
    }
    const basis = wende === 'hoch' ? tief : hoch
    // Seit dem letzten Besuch: wie weit lief der Kurs von der Zone weg (die Bewegung, die sie „verteidigt" hat)
    let letzteI = -1
    for (let i = kerzen.length - 1; i >= vonI; i--) if (kerzen[i].l <= hoch && kerzen[i].h >= tief) { letzteI = i; break }
    let seit = null
    if (letzteI >= 0 && letzteI < kerzen.length - 1) {
        let best = 0, bestI = -1
        for (let i = letzteI + 1; i < kerzen.length; i++) {
            const k = kerzen[i]
            const d = Math.max(k.h - hoch, tief - k.l)
            if (d > best) { best = d; bestI = i }
        }
        if (bestI >= 0) seit = { atr: best / A, pct: (best / (kerzen[bestI].h - hoch > tief - kerzen[bestI].l ? hoch : tief)) * 100, t: kerzen[bestI].t, richtung: kerzen[bestI].h - hoch > tief - kerzen[bestI].l ? 'aufwaerts' : 'abwaerts' }
    }
    return {
        wende, bewegungAtr: extrem != null ? extrem / A : null, bewegungPct: extrem != null && basis > 0 ? (extrem / basis) * 100 : null,
        extremT: extremI >= 0 ? kerzen[extremI].t : null, zurueckT: zurueckI >= 0 ? kerzen[zurueckI].t : null,
        letzterBesuchT: letzteI >= 0 ? kerzen[letzteI].t : null, seitBesuch: seit,
    }
}

/** Beschriftung, die nicht zur Lage passt: „Support" über dem Kurs, „Widerstand" darunter. */
export function beschriftungPasst(text, kursUeber) {
    const t = String(text || '').toLowerCase()
    if (!t || kursUeber == null) return true
    if (/support|unterst|demand|nachfrage|boden/.test(t) && kursUeber === false) return false
    if (/resist|widerst|supply|angebot|deckel/.test(t) && kursUeber === true) return false
    return true
}

/** Zone (Rechteck): Eintritte, Austritte nach oben/unten, wo der Kurs jetzt steht. */
function zaehleInZone(kerzen, vonI, tief, hoch) {
    let eintritte = 0, drin = false, letzteT = null
    for (let i = vonI; i < kerzen.length; i++) {
        const k = kerzen[i]
        const beruehrt = k.l <= hoch && k.h >= tief
        if (beruehrt && !drin) { eintritte++; letzteT = k.t }
        drin = beruehrt
    }
    return { beruehrungen: eintritte, letzteT }
}

/**
 * Jede eigene Zeichnung an den Kerzen messen — rein. Liefert die U-Einträge des
 * Pakets: `name` (Typ und Preis), `preis`/`jetzt` (Wert am letzten Schluss),
 * Zählungen, `zustand` (haelt | gebrochen | unberuehrt | endet), `seite`
 * (Kurs darüber/darunter/drin), `abstandAtr` und `naechster` — der Kandidat des
 * Codes, der dieselbe Marke misst (Grundlage einer Korrektur).
 */
export function messeNutzerZeichnungen(kerzen, zeichnungen, A, kandidaten = []) {
    const n = kerzen.length
    const kurs = kerzen[n - 1].c
    const ivMs = n > 1 ? kerzen[n - 1].t - kerzen[n - 2].t : 1
    const ab = (t) => { const i = kerzen.findIndex((k) => k.t >= t); return i < 0 ? n : i }
    return zeichnungen.map((z, i) => {
        const pk = (z.punkte || []).map((q) => ({ t: Number(q.t), p: Number(q.p) }))
        const s = z.stil || {}
        const u = { id: `U${i + 1}`, zid: z.id ?? null, typ: z.typ, punkte: pk, text: s.text || '', name: NUTZER_NAME[z.typ] || z.typ, auffaellig: [] }
        try {
            if (WAAGERECHT.includes(z.typ)) {
                const p = pk[0].p
                const von = z.typ === 'strahlH' ? ab(pk[0].t) : 0
                Object.assign(u, zaehleAnLinie(kerzen, (j) => (j >= von ? p : null), A), { preis: p })
                u.name += ` ${zahl(p)}`
            } else if (SCHRAEG.includes(z.typ) && pk.length >= 2) {
                const [a, b] = pk[0].t <= pk[1].t ? [pk[0], pk[1]] : [pk[1], pk[0]]
                const g = gerade(a, b)
                const rechts = z.typ === 'strahl' || s.rechts || s.fortlaufend
                const von = s.links ? 0 : ab(a.t)
                const bis = rechts ? n - 1 : ab(b.t + 1) - 1
                Object.assign(u, zaehleAnLinie(kerzen, (j) => (j >= von && j <= bis ? g(kerzen[j].t) : null), A))
                u.steigungAtr = ((b.p - a.p) / Math.max(1, (b.t - a.t) / ivMs)) / A
                u.name += ` ${zahl(a.p)} → ${zahl(b.p)}`
                // Sitzen die Anker an Hochs/Tiefs, und läuft die Strecke durch Kerzenkörper?
                // Anker frei gesetzt ist nur dann ein Fehler, wenn die Linie auch sonst kaum an Kerzen liegt
                const sitz = [ankerSitz(kerzen, a, A), ankerSitz(kerzen, b, A)]
                if (u.beruehrungen < 2 && sitz.some((x) => x != null && x > 0.5)) u.auffaellig.push(`liegt an ${u.beruehrungen} Hochs/Tiefs an, Anker ${sitz.map((x) => (x == null ? '—' : x.toFixed(1))).join(' / ')} ATR neben dem nächsten Hoch/Tief`)
                const ks = koerperSchnitte(kerzen, ab(a.t), ab(b.t + 1) - 1, (j) => g(kerzen[j].t), A)
                if (ks.kerzen && ks.schnitte / ks.kerzen > 0.1) u.auffaellig.push(`schneidet zwischen den Ankern ${ks.schnitte} von ${ks.kerzen} Kerzenkörpern`)
            } else if (z.typ === 'kanal' && pk.length >= 3) {
                const g = gerade(pk[0], pk[1])
                const d = pk[2].p - g(pk[2].t)
                const [lo, hi] = d >= 0 ? [0, d] : [d, 0]
                const von = ab(Math.min(pk[0].t, pk[1].t))
                const bis = s.rechts || s.fortlaufend ? n - 1 : ab(Math.max(pk[0].t, pk[1].t) + 1) - 1
                const kante = (off) => (j) => (j >= von && j <= bis ? g(kerzen[j].t) + off : null)
                const unten = zaehleAnLinie(kerzen, kante(lo), A), oben = zaehleAnLinie(kerzen, kante(hi), A)
                u.untenJetzt = unten.jetzt
                u.obenJetzt = oben.jetzt
                u.beruehrungen = unten.beruehrungen + oben.beruehrungen
                u.beruehrungenUnten = unten.beruehrungen
                u.beruehrungenOben = oben.beruehrungen
                u.durchquerungen = unten.durchquerungen + oben.durchquerungen
                u.zustand = unten.jetzt == null ? 'endet' : kurs > oben.jetzt ? 'darueber' : kurs < unten.jetzt ? 'darunter' : 'drin'
                u.steigungAtr = ((pk[1].p - pk[0].p) / Math.max(1, Math.abs(pk[1].t - pk[0].t) / ivMs)) / A * Math.sign(pk[1].t - pk[0].t || 1)
                u.name += ` ${zahl(g(pk[0].t) + lo)}–${zahl(g(pk[0].t) + hi)}`
            } else if (z.typ === 'rechteck' && pk.length >= 2) {
                const tief = Math.min(pk[0].p, pk[1].p), hoch = Math.max(pk[0].p, pk[1].p)
                const start = Math.min(pk[0].t, pk[1].t)
                if (start < kerzen[0].t) u.auffaellig.push('beginnt vor den geladenen Kerzen — Ursprung nicht messbar')
                Object.assign(u, zaehleInZone(kerzen, ab(start), tief, hoch), { tief, hoch, breiteAtr: (hoch - tief) / A })
                u.ursprung = start >= kerzen[0].t ? zonenUrsprung(kerzen, ab(start), tief, hoch, A) : null
                u.zustand = kurs > hoch ? 'darueber' : kurs < tief ? 'darunter' : 'drin'
                u.name += ` ${zahl(tief)}–${zahl(hoch)}`
                if (u.breiteAtr > 4) u.auffaellig.push(`sehr breit (${u.breiteAtr.toFixed(1)} ATR)`)
                if (u.ursprung && !u.ursprung.wende) u.auffaellig.push('am linken Rand liegt kein Hoch oder Tief in der Zone')
                if (!beschriftungPasst(s.text, kurs > hoch ? true : kurs < tief ? false : null)) u.auffaellig.push(`Beschriftung „${s.text}" passt nicht zur Lage (Kurs ${kurs > hoch ? 'darüber' : 'darunter'})`)
            } else if (z.typ === 'volprofil' && pk.length >= 2) {
                // Beginnt das Profil vor den geladenen Kerzen, wäre es aus fremden Kerzen gerechnet
                // (01.11.2026: ein Profil vom August bekam POC/VAH/VAL von Ende September) — dann ehrlich „ausserhalb".
                const von = ab(Math.min(pk[0].t, pk[1].t)), bis = ab(Math.max(pk[0].t, pk[1].t) + 1) - 1
                const vorher = Math.min(pk[0].t, pk[1].t) < kerzen[0].t - ivMs
                const vp = !vorher && bis > von ? volumenprofil(kerzen.slice(von, bis + 1), { zeilen: s.zeilen || 24 }) : null
                if (vp) {
                    Object.assign(u, { poc: vp.poc, vah: vp.vah, val: vp.val, preis: vp.poc, zustand: kurs > vp.vah ? 'darueber' : kurs < vp.val ? 'darunter' : 'drin' })
                    u.name += ` ${zahl(vp.val)}–${zahl(vp.vah)}`
                } else u.zustand = 'ausserhalb'
            } else if (z.typ === 'fib' && pk.length >= 2) {
                const stufen = FIB.map((f) => ({ f, preis: pk[1].p + (pk[0].p - pk[1].p) * f }))
                const nah = stufen.reduce((m, x) => (Math.abs(x.preis - kurs) < Math.abs(m.preis - kurs) ? x : m))
                Object.assign(u, { fibNah: nah.f, preis: nah.preis })
                u.name += ` ${zahl(pk[0].p)} → ${zahl(pk[1].p)}`
                const sitz = [ankerSitz(kerzen, pk[0], A), ankerSitz(kerzen, pk[1], A)]
                if (sitz.some((x) => x != null && x > 0.5)) u.auffaellig.push(`Anker ${sitz.map((x) => (x == null ? '—' : x.toFixed(1))).join(' / ')} ATR neben dem nächsten Hoch/Tief — Fibonacci gehört an Hoch und Tief des Impulses`)
            } else if (z.typ === 'avwap' && pk.length) {
                let anker = -1
                for (let j = n - 1; j >= 0; j--) if (kerzen[j].t <= pk[0].t) { anker = j; break }
                if (anker < 0) u.zustand = 'ausserhalb'
                else {
                    const reihe = ankerVwap(kerzen, anker).vwap
                    Object.assign(u, zaehleAnLinie(kerzen, (j) => reihe[j], A))
                    u.name += ` ab ${zahl(kerzen[anker].c)}`
                }
            }
        } catch { u.zustand = 'unlesbar' }
        const bezug = u.jetzt ?? u.preis ?? null
        if (Number.isFinite(bezug)) {
            u.abstandAtr = (kurs - bezug) / A
            // Auch eine gebrochene Linie hat eine Rolle: die Seite, auf der der Kurs jetzt steht
            if (u.zustand !== 'endet' && u.zustand !== 'drehpunkt' && u.typ !== 'volprofil') u.rolle = kurs >= bezug ? 'unterstuetzung' : 'widerstand'
            if ((WAAGERECHT.includes(u.typ) || SCHRAEG.includes(u.typ)) && !beschriftungPasst(u.text, kurs >= bezug)) {
                u.auffaellig.push(`Beschriftung „${u.text}" passt nicht zur Lage (Kurs ${kurs >= bezug ? 'darüber' : 'darunter'})`)
            }
        }
        u.naechster = naechsterKandidat(u, kandidaten, A)
        return u
    })
}

/**
 * Die eigenen Marken als Leiter um den Kurs und wo zwei eigene Zeichnungen
 * dieselbe Höhe markieren (≤ 0,5 ATR) — damit das Modell die Zeichnungen
 * ZUSAMMEN liest statt jede für sich.
 */
export function nutzerBeziehungen(nutzer, kurs, A) {
    const marken = []
    const dazu = (u, art, preis) => { if (Number.isFinite(preis)) marken.push({ u: u.id, art, preis, abstandAtr: (preis - kurs) / A }) }
    for (const u of nutzer) {
        if (u.typ === 'rechteck') { dazu(u, 'Oberkante', u.hoch); dazu(u, 'Unterkante', u.tief) }
        else if (u.typ === 'volprofil') { dazu(u, 'VAH', u.vah); dazu(u, 'POC', u.poc); dazu(u, 'VAL', u.val) }
        else if (u.typ === 'kanal') { dazu(u, 'Kante oben', u.obenJetzt); dazu(u, 'Kante unten', u.untenJetzt) }
        else if (u.typ === 'fib') dazu(u, `Fib ${u.fibNah}`, u.preis)
        else dazu(u, 'Linie', u.jetzt ?? u.preis)
    }
    marken.sort((a, b) => b.preis - a.preis)
    const decken = []
    for (let i = 0; i < marken.length; i++) {
        for (let j = i + 1; j < marken.length; j++) {
            const a = marken[i], b = marken[j]
            if (a.u !== b.u && Math.abs(a.preis - b.preis) <= 0.5 * A) decken.push({ a, b, abstandAtr: Math.abs(a.preis - b.preis) / A })
        }
    }
    return { marken, decken: decken.slice(0, 8) }
}

/** Der Kandidat des Codes, der zur eigenen Zeichnung passt (gleiche Art, ≤ KORREKTUR_ATR daneben). */
export function naechsterKandidat(u, kandidaten, A) {
    let best = null
    for (const k of kandidaten) {
        const d = korrekturAbstand(u, k, A)
        if (d != null && (!best || d < best.abstandAtr)) best = { id: k.id, abstandAtr: d }
    }
    return best
}

/**
 * Abstand einer eigenen Zeichnung zu einem Kandidaten in ATR — oder null, wenn er
 * keine Korrektur für sie sein kann (andere Art, andere Neigung, zu weit weg).
 */
export function korrekturAbstand(u, k, A) {
    if (WAAGERECHT.includes(u.typ) && ['niveau', 'htf', 'volumenprofil'].includes(k.quelle) && Number.isFinite(u.preis)) {
        const d = Math.abs(k.preis - u.preis) / A
        return d <= KORREKTUR_ATR ? d : null
    }
    if (SCHRAEG.includes(u.typ) && k.quelle === 'trend' && Number.isFinite(u.jetzt) && Number.isFinite(u.steigungAtr)) {
        const kSteig = k.steigungAtr ?? null
        if (kSteig != null && Math.abs(kSteig - u.steigungAtr) > 0.15) return null
        const d = Math.abs(k.wertJetzt - u.jetzt) / A
        return d <= KORREKTUR_ATR ? d : null
    }
    if (u.typ === 'kanal' && k.quelle === 'kanal' && Number.isFinite(u.untenJetzt)) {
        const d = Math.max(Math.abs(k.untenJetzt - u.untenJetzt), Math.abs(k.obenJetzt - u.obenJetzt)) / A
        return d <= KORREKTUR_ATR ? d : null
    }
    return null
}

/*
 * Profile ALLER Arten auf einmal (31.10.2026, KI-Analyse ohne Kästchen): der Code
 * rechnet sie, das Modell nimmt das aussagekräftigste. Je Art nur die jüngsten —
 * sonst stünden 15 Profile mit 45 Marken in der Eingabe.
 */
export const PROFIL_ARTEN_ALLE = [['konsolidierung', 2], ['tag', 2], ['woche', 1]]
const ABSCHNITT_NAME = { konsolidierung: 'Phase', abschnitt: 'Phase', tag: 'Tag', woche: 'Woche' }

/**
 * Überblick über das GANZE Fenster (01.11.2026): Anfang → Ende in %, Hoch und Tief
 * mit Zeit und die grossen Wellen. Ohne ihn sah das Modell nur Spanne, Struktur und
 * Kerzen der letzten Stunden — und zeichnete auf RENDERUSDT 1h nach einem Absturz
 * von 2.00 auf 1.45 nur drei kleine Marken am rechten Rand.
 *
 * Wellen: Zickzack über den Median-ATR des Fensters; der Schritt wächst, bis
 * höchstens `maxWellen` Wendepunkte übrig sind — sonst listet ein ruhiges
 * Fenster dutzende Zacken, ein wildes zu wenige.
 */
export function fensterUeberblick(kerzen, { maxWellen = 8 } = {}) {
    const n = kerzen?.length || 0
    if (n < 2) return null
    const a = atr(kerzen, 14).filter((v) => v > 0).sort((x, y) => x - y)
    const A = a[Math.floor(a.length / 2)]
    let hI = 0, lI = 0
    for (let i = 1; i < n; i++) { if (kerzen[i].h > kerzen[hI].h) hI = i; if (kerzen[i].l < kerzen[lI].l) lI = i }
    const zickzack = (S) => {
        const wende = []
        let richtung = 0, h = 0, l = 0
        for (let i = 1; i < n; i++) {
            const x = kerzen[i]
            if (x.h >= kerzen[h].h) h = i
            if (x.l <= kerzen[l].l) l = i
            if (richtung >= 0 && kerzen[h].h - x.l >= S && h < i) { wende.push({ i: h, p: kerzen[h].h, hoch: true }); richtung = -1; l = i; h = i }
            else if (richtung <= 0 && x.h - kerzen[l].l >= S && l < i) { wende.push({ i: l, p: kerzen[l].l, hoch: false }); richtung = 1; h = i; l = i }
        }
        return wende
    }
    let wellen = []
    if (A > 0) for (let f = 6; f <= 200; f *= 1.4) { wellen = zickzack(f * A); if (wellen.length <= maxWellen) break }
    const start = kerzen[0].o, ende = kerzen[n - 1].c
    return {
        vonT: kerzen[0].t, bisT: kerzen[n - 1].t, kerzen: n, start, ende,
        aenderungPct: start > 0 ? (ende / start - 1) * 100 : null,
        hoch: { p: kerzen[hI].h, t: kerzen[hI].t }, tief: { p: kerzen[lI].l, t: kerzen[lI].t },
        wellen: wellen.map((w) => ({ t: kerzen[w.i].t, p: w.p, hoch: w.hoch })),
    }
}

export function baueKandidaten({ kerzen, kerzenHtf = null, interval = null, intervalHtf = null, zeichnungen = [], zeitzone = 'UTC', profilArt = 'konsolidierung', profilArten = null, nutzerKerzen = null, nutzerVonT = null }) {
    const n = kerzen.length
    if (n < 30) return null
    const A = letzteAtr(kerzen)
    if (!(A > 0)) return null
    const kurs = kerzen[n - 1].c
    const vonT = kerzen[0].t, bisT = kerzen[n - 1].t
    const kandidaten = []
    const nahAnN = (preis, niveaus) => niveaus.find((x) => Math.abs(x.preis - preis) < KAND.DECKT_ATR * A)

    const niveaus = waehleNiveaus(kandidatenNiveaus(kerzen, { atrWert: A, k: Math.round(KAND.PIVOT_K * massstab(n)), M: massstab(n) }), kurs)
    niveaus.forEach((x, i) => kandidaten.push({ id: `N${i + 1}`, quelle: 'niveau', ...x, t1: x.ersteT }))
    const nListe = kandidaten.slice()

    // Je Bereich ein Profil (jüngster = A1); V-IDs laufen über alle Bereiche. Bereiche:
    // Seitwärtsphasen (Vorgabe, `seitwaertsPhasen`), Tage oder Wochen. Ohne Phase die
    // Abschnitte zwischen den grossen Wendepunkten, ohne die ein Profil über alles.
    let v = 1
    const arten = Array.isArray(profilArten) ? profilArten : [[profilArt, KAND.PROFIL_MAX]]
    for (const [art, max] of arten) {
        let bereich = art === 'tag' || art === 'woche' ? art : 'konsolidierung'
        // Ein Band enger als der Zickzack (3 ATR) hat keine Wendepunkte: dann die enge Konsolidierung
        let gefunden = bereich === 'konsolidierung' ? seitwaertsPhasen(kerzen) : periodenAbschnitte(kerzen, bereich)
        if (!gefunden.length && bereich === 'konsolidierung') gefunden = konsolidierungen(kerzen, A)
        if (!gefunden.length && bereich === 'konsolidierung') { gefunden = profilAbschnitte(kerzen, A); bereich = 'abschnitt' }
        // Bei Tag/Woche ohne Treffer kein Ersatzprofil über alles — das liefert die Phase schon
        if (!gefunden.length && arten.length > 1 && bereich !== 'konsolidierung' && bereich !== 'abschnitt') continue
        const abschnitte = (gefunden.length ? gefunden : [{ von: 0, bis: n - 1 }]).reverse().slice(0, max)
        abschnitte.forEach((ab, j) => {
            const vp = volumenprofil(kerzen.slice(ab.von, ab.bis + 1), { zeilen: 48 })
            if (!vp) return
            // Eine Art allein (KI-Chat, alte Aufrufe): A1, A2 … wie bisher; mehrere: „Phase 1", „Tag 1" …
            const abschnitt = arten.length > 1 ? `${ABSCHNITT_NAME[bereich]} ${j + 1}` : `A${j + 1}`
            for (const [name, preis] of [['POC', vp.poc], ['VAH', vp.vah], ['VAL', vp.val]]) {
                const deckt = nahAnN(preis, nListe)
                kandidaten.push({
                    id: `V${v++}`, quelle: 'volumenprofil', name, abschnitt, bereich, preis, tief: preis - KAND.BAND_MIN_ATR * A, hoch: preis + KAND.BAND_MIN_ATR * A,
                    t1: kerzen[ab.von].t, t2: kerzen[ab.bis].t, abstandAtr: (preis - kurs) / A, deckt: deckt?.id || null,
                })
            }
        })
    }

    kandidatenTrendlinien(kerzen, A).forEach((x, i) => kandidaten.push({ id: `T${i + 1}`, quelle: 'trend', ...x }))
    kandidatenKanaele(kerzen, A).forEach((x, i) => kandidaten.push({ id: `K${i + 1}`, ...x }))
    kandidatenDreiecke(kerzen, A).forEach((x, i) => kandidaten.push({ id: `M${i + 1}`, ...x }))

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

    // Eigene Zeichnungen: gemessen an den Kerzen ab der ältesten Zeichnung (`nutzerKerzen`,
    // bis 01.11.2026 nur das Analysefenster — eine Zone vom September hatte dann „keinen Eintritt"),
    // sichtbar ist, was im Bild des Nutzers liegt (`nutzerVonT`), nicht nur in den letzten 1000 Kerzen.
    // Nur, was auf DIESER Zeiteinheit sichtbar ist, und bei mehr als NUTZER_MAX die wichtigsten (`waehleNutzer`).
    const nk = Array.isArray(nutzerKerzen) && nutzerKerzen.length > n ? nutzerKerzen : kerzen
    const wahl = waehleNutzer(zeichnungen, Math.min(vonT, nutzerVonT ?? vonT), bisT, { interval, kurs })
    const nutzer = messeNutzerZeichnungen(nk, wahl.liste, A, kandidaten)
    const beziehungen = nutzerBeziehungen(nutzer, kurs, A)

    return {
        kurs, atr: A, vonT, bisT, interval, intervalHtf, zeitzone, ivMs: n > 1 ? kerzen[n - 1].t - kerzen[n - 2].t : null,
        spanne: spanneLetzte(kerzen, KAND.SPANNE_KERZEN, A),
        ueberblick: fensterUeberblick(kerzen),
        struktur: marktstruktur(kerzen),
        kandidaten, nutzer, beziehungen,
        // Was von den eigenen Zeichnungen nicht drin ist: über NUTZER_MAX hinaus und ungemessene Typen
        nutzerWeggelassen: wahl.weggelassen, nutzerUebergangen: wahl.uebergangen,
        roh: kerzen.slice(-KAND.ROH_KERZEN),
        volMedian: (() => { const v = kerzen.slice(-50).map((x) => x.v).sort((a, b) => a - b); return v[Math.floor(v.length / 2)] || null })(),
    }
}

const ZUSTAND_NUTZER = {
    haelt: 'nie durchschlossen', gebrochen: 'gebrochen', drehpunkt: 'vielfach durchquert (Drehpunkt, keine Grenze)', unberuehrt: 'nicht berührt',
    endet: 'endet vor der letzten Kerze', darueber: 'Kurs darüber', darunter: 'Kurs darunter', drin: 'Kurs innerhalb', ausserhalb: 'liegt ausserhalb der geladenen Kerzen', unlesbar: 'nicht messbar',
}
/** Eine Zeile je eigener Zeichnung für das Modell. */
export function nutzerZeile(u, zeit = (ms) => zeitText(ms)) {
    const m = []
    if (u.typ === 'kanal') m.push(`Kanten jetzt ${zahl(u.untenJetzt)} / ${zahl(u.obenJetzt)}, Berührungen unten ${u.beruehrungenUnten ?? 0} / oben ${u.beruehrungenOben ?? 0}`)
    else if (u.typ === 'volprofil') m.push(Number.isFinite(u.poc) ? `POC ${zahl(u.poc)}, VAH ${zahl(u.vah)}, VAL ${zahl(u.val)}` : 'ohne Kerzen')
    else if (u.typ === 'fib') m.push(`Kurs am nächsten bei ${u.fibNah} (${zahl(u.preis)})`)
    else if (u.typ === 'rechteck') {
        m.push(`Eintritte ${u.beruehrungen ?? 0}${u.letzteT ? `, letzter Eintritt ${zeit(u.letzteT)}` : ''}, Breite ${Number.isFinite(u.breiteAtr) ? u.breiteAtr.toFixed(1) : '—'} ATR`)
        const o = u.ursprung
        if (o) {
            const wende = o.wende === 'tief' ? 'am linken Rand ein Tief in der Zone' : o.wende === 'hoch' ? 'am linken Rand ein Hoch in der Zone' : 'am linken Rand kein Wendepunkt'
            const weg = Number.isFinite(o.bewegungAtr) ? `, danach ${o.wende === 'hoch' ? 'abwärts' : 'aufwärts'} ${o.bewegungAtr.toFixed(1)} ATR (${o.bewegungPct.toFixed(1)} %) bis ${zeit(o.extremT)}` : ''
            m.push(`${wende}${weg}${o.zurueckT ? `, erste Rückkehr ${zeit(o.zurueckT)}` : ', seither nicht zurück'}`)
            if (o.seitBesuch) m.push(`seit dem letzten Besuch (${zeit(o.letzterBesuchT)}) ${o.seitBesuch.richtung === 'aufwaerts' ? 'aufwärts' : 'abwärts'} bis ${o.seitBesuch.atr.toFixed(1)} ATR (${o.seitBesuch.pct.toFixed(1)} %) entfernt, am weitesten ${zeit(o.seitBesuch.t)}`)
        }
    }
    else if (Number.isFinite(u.beruehrungen)) {
        m.push(`Berührungen ${u.beruehrungen}, Durchquerungen ${u.durchquerungen}${u.letzteT ? `, zuletzt ${zeit(u.letzteT)}` : ''}${u.beruehrungen ? `, max. Reaktion ${u.reaktionMaxAtr.toFixed(1)} ATR` : ''}`)
        if (Number.isFinite(u.jetzt) && u.typ !== 'horizontale' && u.typ !== 'strahlH') m.push(`Wert jetzt ${zahl(u.jetzt)}`)
        if (u.bruch) m.push(`${u.zustand === 'drehpunkt' ? 'zuletzt durchschlossen' : 'gebrochen'} ${zeit(u.bruch.t)} nach ${u.bruch.nach} (vor ${u.bruch.vorKerzen} Kerzen; davor ${u.bruch.vorher} Berührungen, seither ${u.bruch.tests} Tests von der anderen Seite)`)
    }
    if (Number.isFinite(u.abstandAtr)) m.push(`Kurs ${Math.abs(u.abstandAtr).toFixed(1)} ATR ${u.abstandAtr >= 0 ? 'darüber' : 'darunter'}`)
    const text = u.text ? ` „${u.text}"` : ''
    const naechster = u.naechster ? `${u.naechster.id} (${u.naechster.abstandAtr.toFixed(1)} ATR daneben)` : '—'
    const auff = u.auffaellig?.length ? ` | AUFFÄLLIG: ${u.auffaellig.join('; ')}` : ''
    return `${u.id} | ${u.name}${text} | ${m.join('; ') || '—'} | ${ZUSTAND_NUTZER[u.zustand] || '—'}${u.rolle ? `, liegt jetzt als ${u.rolle === 'widerstand' ? 'Widerstand über' : 'Unterstützung unter'} dem Kurs` : ''} | ${naechster}${auff}`
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

/**
 * `eigene` („Meine Zeichnungen analysieren"): die eigenen Zeichnungen stehen VOR
 * allem anderen, die Kandidaten des Codes nur mit `mitKandidaten` (Ergänzen) und
 * ausdrücklich als Prüfmassstab für Korrekturen und Fehlendes.
 */
export function kandidatenText(paket, { eigene = false, mitKandidaten = true } = {}) {
    const z = []
    const { kurs, atr: A, spanne, struktur } = paket
    const tz = paket.zeitzone || 'UTC'
    const zeit = (ms) => zeitText(ms, tz)
    z.push(`ZEITEN in Ortszeit (${tz}).`)
    z.push(`KURS ${zahl(kurs)} (letzter Schluss ${zeit(paket.bisT)}), ATR(14) ${zahl(A)} = ${(A / kurs * 100).toFixed(2)} %`)
    const ub = paket.ueberblick
    if (ub) {
        const pct = Number.isFinite(ub.aenderungPct) ? `${ub.aenderungPct >= 0 ? '+' : ''}${ub.aenderungPct.toFixed(1)} %` : '?'
        z.push(`GANZES FENSTER (so viel sieht der Nutzer im Chart): ${zeit(ub.vonT)} → ${zeit(ub.bisT)} (${ub.kerzen} Kerzen); Anfang ${zahl(ub.start)} → jetzt ${zahl(ub.ende)} = ${pct}; Hoch ${zahl(ub.hoch.p)} (${zeit(ub.hoch.t)}), Tief ${zahl(ub.tief.p)} (${zeit(ub.tief.t)})`)
        if (ub.wellen.length) z.push(`GROSSE WELLEN: ${ub.wellen.map((w) => `${w.hoch ? 'Hoch' : 'Tief'} ${zahl(w.p)} (${zeit(w.t)})`).join(' → ')} → jetzt ${zahl(ub.ende)}`)
    }
    if (spanne) z.push(`SPANNE der letzten ${spanne.kerzen} Kerzen ${zahl(spanne.tief)}–${zahl(spanne.hoch)} = ${spanne.breiteAtr.toFixed(1)} ATR; Kurs bei ${spanne.positionPct.toFixed(0)} % der Spanne`)
    const uBlock = []
    if (eigene) { nutzerBlock(uBlock, paket, zeit); z.push(...uBlock) }
    const kandAb = z.length
    const n = paket.kandidaten.filter((k) => k.quelle === 'niveau')
    if (n.length) {
        z.push('', 'NIVEAUS (id | Preis | Band | Berührungen gesamt (an Hochs/an Tiefs) | letzte Berührung | max. Reaktion in ATR | Durchquerungen seit der ersten Berührung | Abstand zum Kurs in ATR):')
        for (const x of n) z.push(`${x.id} | ${zahl(x.preis)} | ${zahl(x.tief)}–${zahl(x.hoch)} | ${x.beruehrungen} (${x.hochs}/${x.tiefs}) | ${zeit(x.letzteT)} | ${x.reaktionMaxAtr.toFixed(1)} | ${x.durchquerungen} | ${atrText(x.abstandAtr)}${x.extrem ? ` | ${x.extrem === 'hoch' ? 'Hoch' : 'Tief'} des Bereichs` : ''}${x.rolle === 'wechsel' ? ' | Drehpunkt (mal Unterstützung, mal Widerstand)' : ''}`)
    }
    const v = paket.kandidaten.filter((k) => k.quelle === 'volumenprofil')
    const UEBER = { konsolidierung: 'je Konsolidierung (Seitwärtsphase)', tag: 'je Tag (UTC)', woche: 'je Woche (UTC, ab Montag)', abschnitt: 'je Abschnitt zwischen den grossen Wendepunkten' }
    for (const bereich of [...new Set(v.map((x) => x.bereich))]) {
        const vb = v.filter((x) => x.bereich === bereich)
        z.push('', `VOLUMENPROFILE ${UEBER[bereich] || 'je Abschnitt'} (1 bzw. A1 = der jüngste):`)
        for (const ab of [...new Set(vb.map((x) => x.abschnitt))]) {
            const xs = vb.filter((x) => x.abschnitt === ab)
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
        for (const x of kk) z.push(`${x.id} | ${kanalName(x)}${x.stangeAtr ? `, Fahnenstange ${x.stangeAtr.toFixed(1)} ATR in ${x.stangeKerzen} Kerzen` : ''} | ${zeit(x.t1)} → ${zeit(x.t2)} | ${x.breiteAtr.toFixed(1)} | ${zahl(x.untenJetzt)} / ${zahl(x.obenJetzt)} | ${atrText(x.abstandAtr)}`)
    }
    const mm = paket.kandidaten.filter((k) => k.quelle === 'dreieck')
    if (mm.length) {
        z.push('', 'DREIECKE UND KEILE — vom Code gemessen, zusammenlaufende Kanten (id | Name | Beginn → Spitze | Höhe am Anfang in ATR | noch übrig | Kante oben jetzt / unten jetzt | Abstand der Mitte in ATR):')
        for (const x of mm) z.push(`${x.id} | ${dreieckName(x)} | ${zeit(x.tA)} → ${zeit(x.spitzeT)} | ${x.hoeheAtr.toFixed(1)} | ${Math.round(x.restPct)} % | ${zahl(x.obenJetzt)} / ${zahl(x.untenJetzt)} | ${atrText(x.abstandAtr)}`)
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
    if (eigene) {
        // Struktur bleibt (sie beschreibt den Chart, keine Marke), die Kandidaten nur mit Ergänzen
        const kand = z.splice(kandAb)
        const struktur = kand.filter((x) => x.startsWith('STRUKTUR'))
        if (mitKandidaten) z.push('', '=== KANDIDATEN DES CODES — nur Prüfmassstab für "korrekturen" und "fehlend". Im Text und in den Bedingungen nicht verwenden. ===', ...kand)
        else z.push('', ...struktur)
    } else nutzerBlock(z, paket, zeit)
    z.push('', `LETZTE ${paket.roh.length} KERZEN (Zeit,Eröffnung,Hoch,Tief,Schluss,Volumen relativ zum Median der letzten 50):`)
    for (const x of paket.roh) z.push([zeit(x.t), zahl(x.o), zahl(x.h), zahl(x.l), zahl(x.c), paket.volMedian ? (x.v / paket.volMedian).toFixed(1) : '—'].join(','))
    return z.join('\n')
}

function nutzerBlock(z, paket, zeit) {
    const kurs = paket.kurs
    if (paket.nutzer.length) {
        z.push('', 'EIGENE ZEICHNUNGEN DES NUTZERS — vom Code an den Kerzen gemessen (id | Zeichnung | Messung | Zustand | nächster Kandidat des Codes | Auffälligkeiten):')
        for (const u of paket.nutzer) z.push(nutzerZeile(u, zeit))
        const bz = paket.beziehungen
        if (bz?.marken.length) {
            z.push('', 'LEITER DER EIGENEN MARKEN (von oben nach unten, Abstand zum Kurs in ATR):')
            let kursDa = false
            for (const x of bz.marken) {
                if (!kursDa && x.preis < kurs) { z.push(`— KURS ${zahl(kurs)} —`); kursDa = true }
                z.push(`${x.u} ${x.art} ${zahl(x.preis)} (${atrText(x.abstandAtr)})`)
            }
            if (!kursDa) z.push(`— KURS ${zahl(kurs)} —`)
        }
        if (bz?.decken.length) {
            z.push('', 'EIGENE ZEICHNUNGEN AUF GLEICHER HÖHE (≤ 0,5 ATR):')
            for (const d of bz.decken) z.push(`${d.a.u} ${d.a.art} ${zahl(d.a.preis)} ≈ ${d.b.u} ${d.b.art} ${zahl(d.b.preis)}`)
        }
    }
    // Was fehlt, sagen — sonst hält das Modell die Liste für vollständig
    const weg = paket.nutzerWeggelassen || 0
    const ueb = paket.nutzerUebergangen || []
    if (weg || ueb.length) {
        const teile = []
        if (weg) teile.push(`${weg} weitere (weiter weg vom Kurs oder ausserhalb des Fensters, nicht gemessen)`)
        if (ueb.length) teile.push(`nicht messbar: ${ueb.map((x) => `${x.anzahl}× ${NUTZER_NAME[x.typ] || x.typ}`).join(', ')}`)
        z.push('', `NICHT IN DER LISTE: ${teile.join('; ')}. Diese Zeichnungen nicht bewerten und nicht so tun, als gäbe es sie nicht.`)
    }
}
