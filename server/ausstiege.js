/**
 * Ausstiegs-Prüfung: dieselben Einstiege, andere Ausstiege.
 *
 * Eine Strategie ohne Kante wirft die Frage auf, WO sie fehlt — beim Einstieg
 * oder beim Ausstieg. Ein Backtest beantwortet das nicht, er misst beides
 * zusammen. Hier bleiben die Einstiege eines Laufs (Zeit, Richtung, Füllkurs,
 * Stop) stehen, und jeder Trade wird auf denselben Kerzen mit einem schlichten
 * Ausstieg neu gespielt:
 *
 *   - Stop als Vielfaches des Strategie-Stops (0,5× … 2×),
 *   - Ziel in R DIESES Stops (0,5 … 5 R, oder keins),
 *   - höchstens N Kerzen halten, dann Ausstieg zum Schluss.
 *
 * Wahlweise mit Break-even oder Nachziehen (`varianteAus`): ab N R im Plus
 * (Schlusskurs) rückt der Stop auf den Einstieg bzw. folgt dem günstigsten
 * Kurs im Abstand des Stops der jeweiligen Zeile. Vorgabe ist der feste
 * Ausstieg — jede weitere Art ist ein weiterer Versuch, und mehr Versuche
 * heisst mehr Gelegenheit, Zufall zu finden.
 *
 * Gerechnet wird in R des jeweiligen Stops — bei festem Risiko je Trade ist
 * das die Grösse, die zählt. Gebühren und Funding gehen mit: ein engerer Stop
 * heisst grössere Position und damit mehr Gebühren je R, das darf ihn nicht
 * schönrechnen.
 *
 * Jede Kerze läuft durch `stepCandle` aus dem Fill-Simulator — dieselbe Regel
 * wie Backtest und Papier: Stop vor Ziel in derselben Kerze, Lücken zur
 * Eröffnung, Liquidation vor einem zu weit entfernten Stop. Eine eigene
 * Nachbildung hätte irgendwann anders gerechnet als der Lauf, den sie prüft.
 *
 * Die Gefahr ist die Auswahl selbst: aus 378 Zellen findet sich immer eine,
 * die auf diesen Trades gut aussieht. Deshalb
 *   - wird nur auf den ersten 70 % der Trades (zeitlich) ausgewählt und auf
 *     den letzten 30 % geprüft,
 *   - zählt nicht die beste Zelle, sondern die beste ZONE (Mittel der Zelle
 *     und ihrer Nachbarn) — ein Gipfel zwischen Abstürzen ist Zufall,
 *   - vergleicht ein Vorzeichentest auf dem Prüfteil Trade für Trade mit den
 *     eigenen Ausstiegen der Strategie.
 *
 * Dazu drei Fragen, die das Raster allein nicht beantwortet (02.11.2026):
 *
 *   - `einstiegsKante`: Taugt der EINSTIEG überhaupt etwas? Edge Ratio — wie
 *     weit läuft der Kurs nach dem Einstieg für den Trade, wie weit gegen ihn,
 *     in ATR beim Einstieg — gegen Zufallseinstiege mit derselben Long/Short-
 *     Mischung. Ganz ohne Ausstiege und ohne Auswahl, also ohne die Gefahr
 *     der Überanpassung.
 *   - `ueberanpassung`: Wie wahrscheinlich ist die gewählte Zone nur das Glück
 *     der Aufteilung? Probability of Backtest Overfitting nach Bailey,
 *     Borwein, López de Prado und Zhu (CSCV): die Trades in 8 Blöcke, jede
 *     Hälfte einmal Auswahl, die andere Prüfung — 70 Aufteilungen statt der
 *     einen 70/30.
 *   - `zweifel` je Zelle: Trades, deren Ausstiegskerze Stop UND Ziel berührte
 *     und die deshalb als Verlust zählen. Ihre Zahl sagt, wie viel eine
 *     feinere Auflösung (1m-Kerzen) überhaupt ändern könnte.
 *
 * Mehrere Symbole: `kerzen` darf statt einer Reihe ein Objekt Symbol → Reihe
 * sein, dann spielt jeder Trade auf den Kerzen seines `symbol` (eine Instanz
 * über zwölf Coins hat je Coin zu wenige Trades für ein Urteil, zusammen aber
 * genug). Die Aufteilung 70/30 läuft über die Zeit aller Trades,
 * Zufallseinstiege ziehen Coin und Richtung aus den Trades.
 *
 * Rein: keine DB, kein Netz. Kerzen, Trades, Kosten und Funding kommen von
 * aussen (`ausstiegsPruefung` in `robustness.js`).
 */

import { stepCandle, closePosition } from './fill-simulator.js'
import { vorzeichenTest } from './radar-guete.js'
import { atr } from '../shared/indicators.js'
import { zufall } from '../shared/statistik.js'

/** Stop als Vielfaches des Strategie-Stops. */
export const STOP_FAKTOREN = [0.5, 0.75, 1, 1.25, 1.5, 2]
/** Ziel in R des jeweiligen Stops; 0 = kein Ziel (nur Stop und Zeit). */
export const ZIELE_R = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 0]
/** Höchste Haltedauer in Kerzen. */
export const HALTEN = [4, 8, 16, 32, 64, 128, 256]

/** Unter so vielen Trades ist jede Zelle Zufall (Exit Optimizer: „unter 30 ein Hinweis"). */
export const MIN_TRADES = 30
/** Mindestens so viele Trades im Prüfteil, sonst gibt es kein Urteil. */
export const MIN_PRUEF_TRADES = 10
/** Anteil der jüngsten Trades, der nur geprüft und nie zur Auswahl benutzt wird. */
export const PRUEF_ANTEIL = 0.3
/** Ab diesem p-Wert gilt ein Vorsprung als nicht gesichert. */
export const P_GRENZE = 0.05

/** Ausstiegsarten: fest (Stop/Ziel/Zeit), Break-even, Nachziehen. */
export const AUSSTIEGSARTEN = ['fest', 'breakeven', 'trailing']

/**
 * Ausstiegsart aus einer Eingabe — Unbekanntes wird zum festen Ausstieg.
 * `abR`: ab wie viel R im Plus (Schlusskurs) Break-even bzw. Nachziehen
 * greift; Break-even 0,25–5 (Vorgabe 1), Nachziehen 0–5 (0 = sofort,
 * Vorgabe 1).
 */
export function varianteAus(eingabe) {
    const art = AUSSTIEGSARTEN.includes(eingabe?.art) ? eingabe.art : 'fest'
    if (art === 'fest') return { art }
    const roh = Number(eingabe?.abR)
    const min = art === 'breakeven' ? 0.25 : 0
    const abR = Number.isFinite(roh) && eingabe?.abR !== '' && eingabe?.abR !== null ? Math.min(5, Math.max(min, roh)) : 1
    return { art, abR: Math.round(abR * 100) / 100 }
}

/** Optionen für `stepCandle` je Ausstiegsart. Abstand beim Nachziehen: 1 R des Zeilen-Stops. */
function schrittOptionen(variante) {
    if (variante?.art === 'breakeven') return { breakEvenAtR: variante.abR }
    if (variante?.art === 'trailing') return { trailR: 1, trailAbR: variante.abR }
    return {}
}

/** Horizonte (Kerzen) der Einstiegs-Kante. */
export const KANTE_HORIZONTE = [4, 16, 64]
/** Zufallseinstiege je Trade der Strategie, höchstens `ZUFALL_MAX`. */
export const ZUFALL_JE_TRADE = 40
export const ZUFALL_MAX = 6000
/** Ziehungen für die Verteilung der Edge Ratio bei Zufall. */
export const ZUFALL_ZIEHUNGEN = 1000
/** Blöcke der Überanpassungs-Prüfung (CSCV); je Hälfte die Hälfte davon. */
export const CSCV_BLOECKE = 8
/** Mindestens so viele Trades je Block, sonst keine Überanpassungs-Prüfung. */
export const CSCV_MIN_JE_BLOCK = 5

/** Wie der Einstieg eines Trades in seiner Kerze lag (Backtest: `einstiegsArt`). */
const ARTEN = new Set(['kerze', 'eroeffnung', 'schluss'])

const BPS = 10000
const EPS = 1e-9
const ATEM_MS = 25

/** Index der Kerze mit genau dieser Startzeit, sonst -1 (binäre Suche). */
export function kerzeBei(kerzen, t) {
    let lo = 0
    let hi = kerzen.length - 1
    while (lo <= hi) {
        const mitte = (lo + hi) >> 1
        const km = kerzen[mitte].t
        if (km === t) return mitte
        if (km < t) lo = mitte + 1
        else hi = mitte - 1
    }
    return -1
}

/**
 * Funding je Stück aus dem Verlauf — dieselbe Summe wie `fundingAusVerlauf`,
 * aber über Präfixsummen. Die Prüfung fragt je Trade einige hundert Ausstiege
 * ab; den ganzen Verlauf jedes Mal zu durchlaufen wären bei zwei Jahren und
 * tausend Trades Hunderte Millionen Schritte.
 *
 * @returns {(direction:string, entryTime:number, bis:number, ersatzPreis:number) => number}
 */
export function fundingRechner(verlauf) {
    const ev = (Array.isArray(verlauf) ? verlauf : [])
        .map((e) => ({ t: Number(e?.t), rate: Number(e?.rate), preis: Number(e?.markPrice) }))
        .filter((e) => Number.isFinite(e.t) && Number.isFinite(e.rate))
        .sort((a, b) => a.t - b.t)
    const zeiten = ev.map((e) => e.t)
    // P: Σ Preis × Satz für Abrechnungen mit Mark-Preis, Q: Σ Satz für die
    // ohne — dort zahlt der Ersatzpreis des Trades.
    const P = [0]
    const Q = [0]
    for (const e of ev) {
        const mitPreis = e.preis > 0
        P.push(P[P.length - 1] + (mitPreis ? e.preis * e.rate : 0))
        Q.push(Q[Q.length - 1] + (mitPreis ? 0 : e.rate))
    }
    // Erste Position mit t > x (obere Grenze)
    const nach = (x) => {
        let lo = 0
        let hi = zeiten.length
        while (lo < hi) {
            const m = (lo + hi) >> 1
            if (zeiten[m] <= x) lo = m + 1
            else hi = m
        }
        return lo
    }
    return (direction, entryTime, bis, ersatzPreis = 0) => {
        const a = nach(Number(entryTime) || 0)
        const b = nach(Number.isFinite(Number(bis)) ? Number(bis) : Infinity)
        if (b <= a) return 0
        const summe = (P[b] - P[a]) + (Number(ersatzPreis) || 0) * (Q[b] - Q[a])
        return (direction === 'short' ? 1 : -1) * summe
    }
}

/**
 * Kennzahlen einer R-Reihe in Einstiegsreihenfolge.
 * `dd`: grösster Rückgang der aufsummierten R, als positive Zahl.
 */
export function kennzahlen(rWerte) {
    const n = rWerte.length
    if (!n) return { n: 0, mittel: null, treffer: null, summe: 0, dd: 0 }
    let summe = 0
    let gewinner = 0
    let hoch = 0
    let dd = 0
    for (const r of rWerte) {
        summe += r
        if (r > EPS) gewinner++
        if (summe > hoch) hoch = summe
        if (hoch - summe > dd) dd = hoch - summe
    }
    return { n, mittel: summe / n, treffer: (gewinner / n) * 100, summe, dd }
}

/** Ist dieser Trade überhaupt neu spielbar? */
function spielbar(t) {
    return t && t.exitReason !== 'open_at_end'
        && ARTEN.has(t.einstiegsArt)
        && Number(t.entryPrice) > 0 && Number(t.stopLoss) > 0
        && Math.abs(Number(t.entryPrice) - Number(t.stopLoss)) > 0
        && (t.direction === 'long' || t.direction === 'short')
}

/**
 * Je Haltedauer die Kerze, an deren Schluss der Zeitausstieg fällt — dieselbe
 * Bedingung wie in `stepCandle` (Kerzenende − Einstieg ≥ Haltedauer), damit
 * Lücken in der Reihe nicht anders zählen. -1: die Daten enden vorher.
 */
function zeitKerzen(kerzen, erste, entryTime, kerzeMs, halten) {
    const raus = halten.map(() => -1)
    let h = 0
    for (let j = erste; j < kerzen.length && h < halten.length; j++) {
        while (h < halten.length && kerzen[j].t + kerzeMs - entryTime >= halten[h] * kerzeMs) {
            raus[h] = j
            h++
        }
    }
    return raus
}

/**
 * Einen Trade mit Stop × Faktor und Ziel in R neu spielen — für ALLE
 * Haltedauern in einem Durchlauf. Liefert je Haltedauer `{ r, amEnde, zweifel }`;
 * `zweifel`: der Stop schloss in einer Kerze, die auch das Ziel berührte (die
 * Reihenfolge darin ist unbekannt, gezählt wird der Stop).
 */
function spieleTrade(trade, kerzen, i0, faktor, zielR, zeitIdx, o) {
    const long = trade.direction === 'long'
    const entry = Number(trade.entryPrice)
    const abstand = Math.abs(entry - Number(trade.stopLoss)) * faktor
    const stop = long ? entry - abstand : entry + abstand
    const ziel = zielR > 0 ? (long ? entry + zielR * abstand : entry - zielR * abstand) : 0
    const pos = {
        setupId: 0, symbol: trade.symbol || '', timeframe: trade.timeframe || '',
        direction: trade.direction,
        qty: 1, initialQty: 1,
        entryPrice: entry, entryTime: Number(trade.entryTime),
        stopLoss: stop, initialStopLoss: stop, takeProfit: ziel,
        leverage: Number(trade.leverage) || 1,
        notionalUsdt: entry,
        marginUsdt: entry / (Number(trade.leverage) || 1),
        // Die Eröffnungsgebühr, die der Trade wirklich zahlte (Maker/Taker je
        // nach Einstieg) — sie hängt nicht am Ausstieg.
        feeOpen: entry * (Number(trade.einstiegsGebuehrBps) || 0) / BPS,
        maePrice: entry, mfePrice: entry,
        breakEvenDone: false, status: 'open',
    }

    let natuerlich = null
    let erste = i0
    if (trade.einstiegsArt === 'kerze') {
        // Einstieg mitten in der Kerze (Limit an der Zone, Stop-Order): ein
        // Stop in derselben Kerze ist ein Verlust, das Ziel zählt erst ab der
        // nächsten — wie `entryIsValid` und Schritt 1 im Backtest.
        const k = kerzen[i0]
        if (long ? k.l <= stop : k.h >= stop) {
            natuerlich = { j: i0, exit: { price: long ? Math.min(stop, k.o) : Math.max(stop, k.o), reason: 'sl', time: k.t } }
        }
        if (natuerlich) natuerlich.zweifel = ziel > 0 && beruehrtZiel(k, ziel, stop, long)
        erste = i0 + 1
    }
    const letzteZeit = zeitIdx[zeitIdx.length - 1]
    const bis = letzteZeit >= 0 ? letzteZeit : kerzen.length - 1
    const schritt = { maintenanceMarginPct: o.wartungsmargePct, kerzeMs: o.kerzeMs, costs: o.costs, ...schrittOptionen(o.variante) }
    for (let j = erste; !natuerlich && j <= bis; j++) {
        const { exit } = stepCandle(pos, kerzen[j], schritt)
        if (exit) {
            natuerlich = { j, exit }
            natuerlich.zweifel = ziel > 0 && STOP_GRUENDE.has(exit.reason)
                && beruehrtZiel(kerzen[j], ziel, pos.stopLoss, long)
        }
    }

    const letzte = kerzen[kerzen.length - 1]
    return zeitIdx.map((J) => {
        let exit
        let amEnde = false
        let zweifel = false
        if (natuerlich && (J < 0 || natuerlich.j <= J)) { exit = natuerlich.exit; zweifel = natuerlich.zweifel === true }
        else if (J >= 0) exit = { price: kerzen[J].c, reason: 'timeout', time: kerzen[J].t + o.kerzeMs }
        else {
            // Die Daten enden vor Stop, Ziel und Haltedauer: zum letzten
            // Schluss bewertet und gezählt (`amEnde`), statt den Trade nur in
            // manchen Zellen fehlen zu lassen.
            exit = { price: letzte.c, reason: 'timeout', time: letzte.t + o.kerzeMs }
            amEnde = true
        }
        const extra = o.funding ? { funding: o.funding(pos, exit.time) } : {}
        return { r: closePosition(pos, exit, o.costs, extra).rMultiple, amEnde, zweifel }
    })
}

/** Ausstiegsgründe, die ein Stop sind (auch ein nachgezogener). */
const STOP_GRUENDE = new Set(['sl', 'be', 'trail', 'liquidation'])

/**
 * Hat die Kerze das Ziel berührt, ohne schon jenseits des Stops zu eröffnen?
 * Eine Eröffnung jenseits des Stops ist kein Zweifel: der erste Kurs der
 * Kerze lag dort, der Stop kam zuerst.
 */
function beruehrtZiel(k, ziel, stop, long) {
    if (long ? k.o <= stop : k.o >= stop) return false
    return long ? k.h >= ziel : k.l <= ziel
}

/**
 * Ein Trade, eine Zelle: R des Trades mit Stop × `faktor`, Ziel `zielR` und
 * höchstens `halten` Kerzen. `null`, wenn seine Einstiegskerze fehlt.
 */
export function spieleEinzeln(trade, kerzen, { faktor = 1, zielR = 0, halten }, o = {}) {
    if (!spielbar(trade)) return null
    const i0 = kerzeBei(kerzen, Number(trade.entryTime))
    if (i0 < 0) return null
    const kerzeMs = Number(o.kerzeMs) || 0
    const erste = trade.einstiegsArt === 'kerze' ? i0 + 1 : i0
    const zeitIdx = zeitKerzen(kerzen, erste, Number(trade.entryTime), kerzeMs, [halten])
    const opts = { costs: o.costs || {}, kerzeMs, wartungsmargePct: o.wartungsmargePct, funding: o.funding || null, variante: varianteAus(o.variante) }
    return spieleTrade(trade, kerzen, i0, faktor, zielR, zeitIdx, opts)[0]
}

/**
 * Weg in Handelsrichtung (MFE) und dagegen (MAE) über `h` Kerzen ab `erste`,
 * gemessen vom Einstiegspreis, in ATR. `null`, wenn die Daten vorher enden.
 */
function ausschlag(kerzen, erste, h, preis, long, atrWert) {
    if (erste + h > kerzen.length || !(atrWert > 0)) return null
    let hoch = -Infinity
    let tief = Infinity
    for (let j = erste; j < erste + h; j++) {
        if (kerzen[j].h > hoch) hoch = kerzen[j].h
        if (kerzen[j].l < tief) tief = kerzen[j].l
    }
    const fuer = long ? hoch - preis : preis - tief
    const gegen = long ? preis - tief : hoch - preis
    return { mfe: Math.max(0, fuer) / atrWert, mae: Math.max(0, gegen) / atrWert }
}

const mittel = (w) => (w.length ? w.reduce((a, b) => a + b, 0) / w.length : null)
const quote = (mfe, mae) => {
    const a = mittel(mfe)
    const b = mittel(mae)
    return a === null || !(b > 0) ? null : a / b
}

/**
 * Einstiegs-Kante: Edge Ratio der Strategie gegen Zufallseinstiege.
 *
 * Edge Ratio = Ø MFE / Ø MAE in ATR(14) beim Einstieg — die ATR aus den
 * Kerzen VOR der Einstiegskerze. Bei Zufall liegt sie um 1 (Trend und
 * Long/Short-Mischung verschieben sie), deshalb wird nicht gegen 1 gemessen,
 * sondern gegen Zufallseinstiege im selben Zeitraum, deren Richtung aus den
 * Richtungen der Strategie gezogen ist. `p`: Anteil der Zufallsstichproben
 * gleicher Grösse, die mindestens so gut sind.
 *
 * Gemessen ab der ersten Kerze, die auch der Simulator für den Trade
 * bewertet (beim Limit mitten in der Kerze also ab der Folgekerze); die
 * Zufallseinstiege liegen auf der Eröffnung und zählen ihre Kerze mit.
 *
 * @param {Array<{trade, i0, kerzen?}>} gespielt  `kerzen` je Trade (mehrere
 *        Symbole), sonst gilt die gemeinsame Reihe `kerzen`
 */
export function einstiegsKante(gespielt, kerzen = null, { horizonte = KANTE_HORIZONTE, aussaat = 1 } = {}) {
    // Je Kerzenreihe ihre ATR und die Spanne der Einstiege darin
    const reihen = new Map()
    const reiheVon = (g) => {
        const ks = g.kerzen || kerzen
        let x = reihen.get(ks)
        if (!x) { x = { kerzen: ks, atr: atr(ks, 14), lo: Infinity, hi: -Infinity }; reihen.set(ks, x) }
        return x
    }
    const strat = horizonte.map(() => ({ mfe: [], mae: [] }))
    for (const g of gespielt) {
        const { trade, i0 } = g
        const x = reiheVon(g)
        const a = x.atr[i0 - 1]
        const erste = trade.einstiegsArt === 'kerze' ? i0 + 1 : i0
        horizonte.forEach((h, k) => {
            const r = ausschlag(x.kerzen, erste, h, Number(trade.entryPrice), trade.direction === 'long', a)
            if (r) { strat[k].mfe.push(r.mfe); strat[k].mae.push(r.mae) }
        })
        if (i0 < x.lo) x.lo = i0
        if (i0 > x.hi) x.hi = i0
    }
    const n = gespielt.length
    const richtungen = gespielt.map((g) => g.trade.direction)
    const raus = { horizonte: [], urteil: 'zuWenig' }
    if (n < MIN_TRADES) {
        raus.horizonte = horizonte.map((h, k) => ({ h, n: strat[k].mfe.length, strategie: runde(quote(strat[k].mfe, strat[k].mae), 3) }))
        return raus
    }

    // Zufallseinstiege im Zeitraum der Trades, mit ATR davor. Die Reihe (bei
    // mehreren Symbolen der Coin) kommt von einem zufälligen Trade, die
    // Richtung von einem anderen — so bleiben Coin- und Long/Short-Mischung.
    const rnd = zufall(aussaat)
    const pool = horizonte.map(() => ({ mfe: [], mae: [] }))
    const anzahl = Math.min(ZUFALL_MAX, n * ZUFALL_JE_TRADE)
    for (let k = 0; k < anzahl; k++) {
        const x = reiheVon(gespielt[Math.floor(rnd() * n)])
        const unten = Math.max(x.lo, 15)
        if (!(x.hi >= unten)) continue
        const i = unten + Math.floor(rnd() * (x.hi - unten + 1))
        const long = richtungen[Math.floor(rnd() * richtungen.length)] === 'long'
        horizonte.forEach((h, y) => {
            const r = ausschlag(x.kerzen, i, h, x.kerzen[i].o, long, x.atr[i - 1])
            if (r) { pool[y].mfe.push(r.mfe); pool[y].mae.push(r.mae) }
        })
    }

    // Verteilung der Edge Ratio bei Zufall für Stichproben so gross wie die der Strategie
    raus.horizonte = horizonte.map((h, k) => {
        const s = strat[k]
        const z = pool[k]
        const e = quote(s.mfe, s.mae)
        const m = s.mfe.length
        let mindestens = 0
        let ziehungen = 0
        if (e !== null && m > 0 && z.mfe.length >= m) {
            for (let b = 0; b < ZUFALL_ZIEHUNGEN; b++) {
                let sf = 0
                let sg = 0
                for (let x = 0; x < m; x++) {
                    const w = Math.floor(rnd() * z.mfe.length)
                    sf += z.mfe[w]
                    sg += z.mae[w]
                }
                ziehungen++
                if (sg > 0 && sf / sg >= e) mindestens++
            }
        }
        return {
            h, n: m,
            strategie: runde(e, 3),
            zufall: runde(quote(z.mfe, z.mae), 3),
            mfe: runde(mittel(s.mfe), 3), mae: runde(mittel(s.mae), 3),
            p: ziehungen ? runde((mindestens + 1) / (ziehungen + 1), 4) : null,
        }
    })
    // Drei Horizonte, drei Versuche: Grenze nach Bonferroni.
    const grenze = P_GRENZE / horizonte.length
    const gemessen = raus.horizonte.filter((x) => x.p !== null)
    raus.urteil = !gemessen.length ? 'zuWenig'
        : gemessen.some((x) => x.p < grenze && x.strategie > x.zufall) ? 'schlaegtZufall' : 'wieZufall'
    raus.zufallseinstiege = anzahl
    return raus
}

/** Alle Teilmengen der Grösse k aus 0..n-1 (für 8 über 4: 70). */
function teilmengen(n, k) {
    const raus = []
    const wahl = []
    const weiter = (ab) => {
        if (wahl.length === k) { raus.push([...wahl]); return }
        for (let i = ab; i < n; i++) { wahl.push(i); weiter(i + 1); wahl.pop() }
    }
    weiter(0)
    return raus
}

/**
 * Überanpassung der Auswahl (CSCV, Bailey/Borwein/López de Prado/Zhu).
 *
 * Die Trades (in Einstiegsreihenfolge) kommen in `bloecke` gleich grosse
 * Blöcke. Für jede Wahl der halben Blöcke als Auswahl wird die Zone so
 * gewählt wie im Hauptlauf (`waehleZone`) und auf den übrigen Blöcken
 * eingeordnet: Rang unter allen Zellen, ω = Rang / (Zellen + 1).
 *   - `pbo`: Anteil der Aufteilungen, in denen die gewählte Zelle ausserhalb
 *     höchstens im Median landet (ω ≤ ½) — die Wahrscheinlichkeit, dass die
 *     Auswahl nur das Glück der Stichprobe gefunden hat;
 *   - `verlust`: Anteil, in denen sie ausserhalb im Minus liegt;
 *   - `innen`/`aussen`: Ø R der gewählten Zelle in der Auswahl und ausserhalb.
 *
 * @param {Float64Array[][][]} r  r[s][z][h][k] = R des Trades k
 */
export function ueberanpassung(r, n, { bloecke = CSCV_BLOECKE } = {}) {
    if (n < bloecke * CSCV_MIN_JE_BLOCK) return null
    const S = r.length
    const Z = r[0].length
    const H = r[0][0].length
    const zellen = S * Z * H
    const grenzen = Array.from({ length: bloecke + 1 }, (_, b) => Math.round((b * n) / bloecke))
    const anzahl = grenzen.slice(1).map((g, b) => g - grenzen[b])
    // summen[c * bloecke + b]
    const summen = new Float64Array(zellen * bloecke)
    let c = 0
    for (let s = 0; s < S; s++) for (let z = 0; z < Z; z++) for (let h = 0; h < H; h++, c++) {
        const reihe = r[s][z][h]
        for (let b = 0; b < bloecke; b++) {
            let summe = 0
            for (let k = grenzen[b]; k < grenzen[b + 1]; k++) summe += reihe[k]
            summen[c * bloecke + b] = summe
        }
    }
    const mittelUeber = (bl) => {
        const nb = bl.reduce((a, b) => a + anzahl[b], 0)
        const werte = new Float64Array(zellen)
        for (let x = 0; x < zellen; x++) {
            let summe = 0
            for (const b of bl) summe += summen[x * bloecke + b]
            werte[x] = summe / nb
        }
        return werte
    }
    const alsRaster = (werte) => Array.from({ length: S }, (_, s) => Array.from({ length: Z }, (__, z) =>
        Array.from({ length: H }, (___, h) => werte[(s * Z + z) * H + h])))

    let ueberangepasst = 0
    let verlust = 0
    let innen = 0
    let aussen = 0
    const kombis = teilmengen(bloecke, bloecke / 2)
    for (const auswahl of kombis) {
        const rest = [...Array(bloecke).keys()].filter((b) => !auswahl.includes(b))
        const wIn = mittelUeber(auswahl)
        const wAus = mittelUeber(rest)
        const zone = waehleZone(alsRaster(wIn))
        const x = (zone.s * Z + zone.z) * H + zone.h
        const v = wAus[x]
        // Mittelrang bei Gleichstand: viele Ziele werden von keinem Trade
        // erreicht und liefern dieselbe Reihe.
        let darunter = 0
        let gleich = 0
        for (let y = 0; y < zellen; y++) {
            if (wAus[y] < v - EPS) darunter++
            else if (Math.abs(wAus[y] - v) <= EPS) gleich++
        }
        const omega = (darunter + (gleich + 1) / 2) / (zellen + 1)
        if (omega <= 0.5) ueberangepasst++
        if (v < 0) verlust++
        innen += wIn[x]
        aussen += v
    }
    const m = kombis.length
    return {
        bloecke, aufteilungen: m,
        pbo: runde(ueberangepasst / m, 4),
        verlust: runde(verlust / m, 4),
        innen: runde(innen / m),
        aussen: runde(aussen / m),
    }
}

/** Nachbarn im Raster (je Achse ±1), samt der Zelle selbst. */
function nachbarn(s, z, h, dims) {
    const raus = []
    for (let ds = -1; ds <= 1; ds++) for (let dz = -1; dz <= 1; dz++) for (let dh = -1; dh <= 1; dh++) {
        const a = s + ds; const b = z + dz; const c = h + dh
        if (a >= 0 && a < dims[0] && b >= 0 && b < dims[1] && c >= 0 && c < dims[2]) raus.push([a, b, c])
    }
    return raus
}

/**
 * Die Zone mit dem besten Mittel auf dem Auswahlteil. `werte[s][z][h]` ist das
 * Ø R einer Zelle (oder null). Liefert `{ s, z, h, zonenwert }`.
 */
export function waehleZone(werte) {
    const dims = [werte.length, werte[0]?.length || 0, werte[0]?.[0]?.length || 0]
    let beste = null
    for (let s = 0; s < dims[0]; s++) for (let z = 0; z < dims[1]; z++) for (let h = 0; h < dims[2]; h++) {
        if (werte[s][z][h] === null) continue
        let summe = 0
        let n = 0
        for (const [a, b, c] of nachbarn(s, z, h, dims)) {
            const w = werte[a][b][c]
            if (w === null) continue
            summe += w
            n++
        }
        const zonenwert = summe / n
        if (!beste || zonenwert > beste.zonenwert + EPS) beste = { s, z, h, zonenwert }
    }
    return beste
}

/** Die einzelne beste Zelle — nur zum Vergleich, sie wird nicht gewählt. */
function besteZelle(werte) {
    let beste = null
    werte.forEach((ebene, s) => ebene.forEach((reihe, z) => reihe.forEach((w, h) => {
        if (w !== null && (!beste || w > beste.wert + EPS)) beste = { s, z, h, wert: w }
    })))
    return beste
}

const runde = (v, stellen = 4) => (v === null || v === undefined || !Number.isFinite(v) ? null : Number(v.toFixed(stellen)))
const kurz = (k) => ({ n: k.n, mittel: runde(k.mittel), treffer: runde(k.treffer, 1), summe: runde(k.summe, 2), dd: runde(k.dd, 2) })

/**
 * @param {Array} trades   Backtest-Trades (`einstiegsArt`, `einstiegsGebuehrBps`, …)
 * @param {Array|object} kerzen  dieselben Kerzen, auf denen der Backtest lief —
 *                       oder Symbol → Kerzen, wenn die Trades mehrere Symbole haben
 * @param {object} o
 * @param {object} o.costs              `kostenAus(risk)` des Laufs
 * @param {number} o.kerzeMs            Länge einer Kerze
 * @param {number|object} [o.wartungsmargePct] Wartungsmarge in PROZENT (wie im
 *                                      Lauf), bei mehreren Symbolen je Symbol
 * @param {Function} [o.funding]        (pos, bis) → Funding je Stück; ohne
 *                                      rechnet `closePosition` mit der Annahme
 * @param {Function} [o.atempause]      async, wird alle ~25 ms abgewartet
 * @param {object} [o.variante]         Ausstiegsart, siehe `varianteAus`
 */
export async function ausstiegsRaster(trades, kerzen, o = {}) {
    const raster = { stops: o.stops || STOP_FAKTOREN, ziele: o.ziele || ZIELE_R, halten: o.halten || HALTEN }
    const kerzeMs = Number(o.kerzeMs) || 0
    const variante = varianteAus(o.variante)
    const wartung = o.wartungsmargePct && typeof o.wartungsmargePct === 'object' ? o.wartungsmargePct : null
    const opts = { costs: o.costs || {}, kerzeMs, wartungsmargePct: o.wartungsmargePct, funding: o.funding || null, variante }

    const kandidaten = (Array.isArray(trades) ? trades : []).filter(spielbar)
        .sort((a, b) => Number(a.entryTime) - Number(b.entryTime))
    const gespielt = []
    let ohneKerze = 0
    for (const t of kandidaten) {
        const ks = Array.isArray(kerzen) ? kerzen : (kerzen?.[t.symbol] || [])
        const i0 = kerzeBei(ks, Number(t.entryTime))
        if (i0 < 0) { ohneKerze++; continue }
        gespielt.push({ trade: t, i0, kerzen: ks })
    }
    const ausgelassen = (Array.isArray(trades) ? trades.length : 0) - gespielt.length
    const n = gespielt.length
    const nAuswahl = Math.round(n * (1 - PRUEF_ANTEIL))
    const [S, Z, H] = [raster.stops.length, raster.ziele.length, raster.halten.length]

    // r[s][z][h] = R je Trade (Einstiegsreihenfolge)
    const r = raster.stops.map(() => raster.ziele.map(() => raster.halten.map(() => new Float64Array(n))))
    const amEnde = raster.stops.map(() => raster.ziele.map(() => raster.halten.map(() => 0)))
    const zweifel = raster.stops.map(() => raster.ziele.map(() => raster.halten.map(() => 0)))
    let pause = Date.now()
    for (let k = 0; k < n; k++) {
        if (o.atempause && Date.now() - pause > ATEM_MS) { await o.atempause(); pause = Date.now() }
        const { trade, i0, kerzen: ks } = gespielt[k]
        const optsTrade = wartung === null ? opts : { ...opts, wartungsmargePct: wartung[trade.symbol] }
        const erste = trade.einstiegsArt === 'kerze' ? i0 + 1 : i0
        const zeitIdx = zeitKerzen(ks, erste, Number(trade.entryTime), kerzeMs, raster.halten)
        for (let s = 0; s < S; s++) {
            for (let z = 0; z < Z; z++) {
                const je = spieleTrade(trade, ks, i0, raster.stops[s], raster.ziele[z], zeitIdx, optsTrade)
                for (let h = 0; h < H; h++) {
                    r[s][z][h][k] = je[h].r
                    if (je[h].amEnde) amEnde[s][z][h]++
                    if (je[h].zweifel) zweifel[s][z][h]++
                }
            }
        }
    }

    const original = gespielt.map((g) => Number(g.trade.rMultiple) || 0)
    const teile = {
        alle: [0, n],
        auswahl: [0, nAuswahl],
        pruefung: [nAuswahl, n],
    }
    const teil = (reihe, [von, bis]) => Array.from(reihe.slice(von, bis))

    const zellen = []
    const auswahlMittel = raster.stops.map(() => raster.ziele.map(() => raster.halten.map(() => null)))
    for (let s = 0; s < S; s++) for (let z = 0; z < Z; z++) for (let h = 0; h < H; h++) {
        const reihe = r[s][z][h]
        const zelle = { s, z, h, amEnde: amEnde[s][z][h], zweifel: zweifel[s][z][h] }
        for (const [name, grenzen] of Object.entries(teile)) zelle[name] = kurz(kennzahlen(teil(reihe, grenzen)))
        auswahlMittel[s][z][h] = zelle.auswahl.mittel
        zellen.push(zelle)
    }

    const ergebnis = {
        raster,
        variante,
        trades: { gespielt: n, auswahl: nAuswahl, pruefung: n - nAuswahl, ausgelassen, ohneKerze },
        pruefAb: n > nAuswahl ? Number(gespielt[nAuswahl].trade.entryTime) : null,
        original: Object.fromEntries(Object.entries(teile).map(([name, g]) => [name, kurz(kennzahlen(original.slice(g[0], g[1])))])),
        zellen,
        gewaehlt: null,
        besteZelle: null,
        einstieg: einstiegsKante(gespielt),
        ueberanpassung: ueberanpassung(r, n),
        ueberanpassungAb: CSCV_BLOECKE * CSCV_MIN_JE_BLOCK,
        urteil: 'zuWenig',
        hinweise: [],
    }
    if (!n || !nAuswahl) return ergebnis

    const zone = waehleZone(auswahlMittel)
    const einzel = besteZelle(auswahlMittel)
    const zelleVon = ({ s, z, h }) => zellen[(s * Z + z) * H + h]
    const vergleich = (pos) => {
        let besser = 0
        let schlechter = 0
        let summe = 0
        const reihe = r[pos.s][pos.z][pos.h]
        for (let k = nAuswahl; k < n; k++) {
            const d = reihe[k] - original[k]
            summe += d
            if (d > EPS) besser++
            else if (d < -EPS) schlechter++
        }
        const m = n - nAuswahl
        return { mittelDiff: m ? runde(summe / m) : null, besser, schlechter, p: runde(vorzeichenTest(besser, schlechter), 4) }
    }

    if (zone) {
        const z = zelleVon(zone)
        ergebnis.gewaehlt = {
            s: zone.s, z: zone.z, h: zone.h, zonenwert: runde(zone.zonenwert),
            auswahl: z.auswahl, pruefung: z.pruefung, alle: z.alle, vergleich: vergleich(zone),
            zweifel: z.zweifel,
        }
    }
    if (einzel) {
        const z = zelleVon(einzel)
        ergebnis.besteZelle = { s: einzel.s, z: einzel.z, h: einzel.h, auswahl: z.auswahl, pruefung: z.pruefung, vergleich: vergleich(einzel) }
    }

    const g = ergebnis.gewaehlt
    const nPruef = n - nAuswahl
    if (n < MIN_TRADES || nPruef < MIN_PRUEF_TRADES || !g) ergebnis.urteil = 'zuWenig'
    else if (g.vergleich.mittelDiff > 0 && g.vergleich.p !== null && g.vergleich.p < P_GRENZE) ergebnis.urteil = 'besser'
    else if (g.vergleich.mittelDiff > 0) ergebnis.urteil = 'nichtGesichert'
    else ergebnis.urteil = 'keinVorteil'

    // Unter der Mindestzahl sind Rand und Spitze Rauschen — dann steht nur
    // das Urteil „zu wenig" da, keine Deutung daneben.
    if (g && ergebnis.urteil !== 'zuWenig') {
        // Am Rand des Rasters: der beste Bereich könnte jenseits liegen.
        // „Kein Ziel" ist eine eigene Aussage, kein Rand.
        const zielRand = raster.ziele[g.z] === Math.max(...raster.ziele)
        if (g.s === 0 || g.s === S - 1 || g.h === 0 || g.h === H - 1 || zielRand) ergebnis.hinweise.push('amRand')
        // Selbst der beste Ausstieg bleibt im Prüfteil im Minus: dann liegt
        // es nicht an den Ausstiegen.
        if (g.pruefung.mittel !== null && g.pruefung.mittel <= 0) ergebnis.hinweise.push('ohneKante')
        // Die beste Einzelzelle hält im Prüfteil schlechter als die Zone —
        // genau der Grund, nicht sie zu nehmen.
        const e = ergebnis.besteZelle
        if (e && (e.s !== g.s || e.z !== g.z || e.h !== g.h)
            && e.pruefung.mittel !== null && g.pruefung.mittel !== null && e.pruefung.mittel < g.pruefung.mittel) {
            ergebnis.hinweise.push('spitzeHaeltNicht')
        }
    }
    if (zellen.some((c) => c.amEnde > 0)) ergebnis.hinweise.push('amEnde')
    return ergebnis
}
