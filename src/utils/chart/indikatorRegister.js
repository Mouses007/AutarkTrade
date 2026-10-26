/**
 * Indikatoren für den Chart — Definitionen und Rechnung.
 *
 * Gerechnet wird ausschliesslich mit `shared/indicators.js`, derselben Datei,
 * die die Strategie-Detektoren benutzen. Ein RSI im Chart, der vom RSI der
 * Strategie abweicht, wäre schlimmer als keiner: man sähe ein Signal, das die
 * Strategie nie gesehen hat.
 *
 * Diese Datei kennt Lightweight Charts NICHT — sie liefert Zahlenreihen.
 * Gezeichnet wird in `indikatorZeichner.js`. So bleibt die Rechnung im
 * Selbsttest prüfbar (`src/utils/__selftest-chart-indikatoren.mjs`).
 *
 * Aufbau einer Definition:
 *   ort       'preis' (im Kerzen-Pane) | 'eigen' (eigenes Pane darunter)
 *   params    [{ key, typ: 'zahl'|'wahl'|'schalter'|'farbe', vorgabe, min, max, schritt, optionen, gruppe, roh }]
 *             `gruppe` ordnet im Dialog unter eine Überschrift, `roh` zeigt die
 *             Optionen einer Wahl unübersetzt (Zeiteinheiten).
 *   ausgabenFuer(p)  (optional) Ausgaben je nach Einstellung — nur was an ist,
 *             bekommt eine Serie (VWAP Vector: 13 schaltbare Linien)
 *   ausgaben  [{ key, art: 'linie'|'histogramm', farbe, breite }]
 *   linien    feste Marken im Pane (z. B. 70/30 beim RSI)
 *   band      (optional) { oben, unten, linie } — getöntes Band zwischen den
 *             Marken und gefüllte Ausschläge der `linie` darüber/darunter, wie
 *             TradingView RSI und Stochastik zeichnet
 *   ausgaben[].vierFarben  Histogramm in vier Stufen (über/unter null ×
 *             steigend/fallend) — das MACD-Histogramm von TradingView
 *   rechne(kerzen, p, ext) → { [ausgabeKey]: Array<number|null> } gleich lang wie kerzen
 *   extern    (optional) Name einer Datenquelle, die das Panel nachlädt — Open
 *             Interest, Funding, Momentum. `ext` sind dann deren Punkte; sie
 *             werden hier auf die Kerzenzeiten gelegt.
 */
import {
    sma, ema, bollinger, vwap, vwapBand, rsi, macd, stochastic, stochRsi, atr, adx, obv, mfi, volumeSma, smaSerie,
} from '../../../shared/indicators.js'
import { rechneVwapVector, emaHoehereTf, TF_MS } from './vwapVector.js'
import { lsobCv } from '../../../shared/lsobCv.js'
import { gussCv } from '../../../shared/gussCv.js'
import {
    atrKennzahlen, adxKennzahlen, mfiKennzahlen, obvKennzahlen, oiKennzahlen, rsiKennzahlen, stochKennzahlen,
    macdKennzahlen, fundingKennzahlen, longAnteilKennzahlen, volumenKennzahlen,
} from './fensterKennzahlen.js'
import { adxFarben, atrFarben, obvFarben, volumenFarben, fundingFarben, longAnteilFarben, divergenzen } from './fensterFarben.js'

/*
 * Tabelle im Fenster (alle Oszillatoren und Datenfenster ausser dem Momentum
 * Radar, der seine eigene Box hat): die nackte Linie sagt wenig —
 * die Tabelle ordnet ein (Kennzahlen in `fensterKennzahlen.js`, Texte in
 * `fensterTabelle.js`). Abschaltbar je Indikator; `_tab` trägt die Kennzahlen.
 */
const P_TABELLE = { key: 'tabelle', typ: 'schalter', vorgabe: true }
// Divergenz-Linien zwischen Kurs und Oszillator (`divergenzen` in fensterFarben.js)
const P_DIVERGENZ = { key: 'divergenzen', typ: 'schalter', vorgabe: true }
const ivAus = (k) => (k.length > 1 ? k[k.length - 1].t - k[k.length - 2].t : 0)

/** Preisquelle — wie bei TradingView wählbar. */
export const QUELLEN = {
    c: (k) => k.c,
    o: (k) => k.o,
    h: (k) => k.h,
    l: (k) => k.l,
    hl2: (k) => (k.h + k.l) / 2,
    hlc3: (k) => (k.h + k.l + k.c) / 3,
    ohlc4: (k) => (k.o + k.h + k.l + k.c) / 4,
}

/**
 * Die Detektoren rechnen auf `k.c`. Für eine andere Quelle bekommt die
 * Funktion Kerzen, deren Schluss durch die Quelle ersetzt ist — so bleibt
 * `shared/indicators.js` unverändert die einzige Rechnung.
 */
function mitQuelle(kerzen, quelle) {
    if (!quelle || quelle === 'c') return kerzen
    const f = QUELLEN[quelle] || QUELLEN.c
    return kerzen.map((k) => ({ ...k, c: f(k) }))
}

/**
 * Punkte einer fremden Reihe auf die Kerzen legen: jede Kerze bekommt den
 * letzten Wert, der zu ihrer Eröffnung bekannt war. Vor dem ersten Punkt null
 * — nicht 0, sonst sähe der Anfang wie ein Einbruch aus.
 */
export function aufKerzen(kerzen, punkte, feld, { amSchluss = false } = {}) {
    const aus = new Array(kerzen.length).fill(null)
    if (!Array.isArray(punkte) || !punkte.length) return aus
    const p = [...punkte].sort((a, b) => a.t - b.t)
    // Kerzenlänge aus den Nachbarn (der Register kennt die Zeiteinheit nicht).
    const laenge = (i) => (kerzen[i + 1] ? kerzen[i + 1].t - kerzen[i].t : i > 0 ? kerzen[i].t - kerzen[i - 1].t : 0)
    let j = -1
    for (let i = 0; i < kerzen.length; i++) {
        // `amSchluss`: ein Messpunkt ist ein STAND zur Zeit t (OI, Long/Short) und gehört
        // zur Kerze, die um t SCHLIESST — das OI von 14:00 ist der Stand am Ende der
        // 13-Uhr-Kerze (gemessen 18.10.2026: der 5m-Eintrag „13:15" erscheint um 13:17,
        // vor dem Ende von 13:15–13:20, ist also kein Periodenbeginn). Vorher stand er
        // auf der 14-Uhr-Kerze, eine Kerze zu spät, und der Balken „Positionen kamen
        // dazu" sass neben der Kerze, in der es geschah.
        const grenze = amSchluss ? kerzen[i].t + laenge(i) : kerzen[i].t
        while (j + 1 < p.length && p[j + 1].t <= grenze) j++
        if (j >= 0) {
            const v = Number(p[j][feld])
            aus[i] = Number.isFinite(v) ? v : null
        }
    }
    return aus
}

/**
 * Veränderung zur Vorkerze. Ein fortgeschriebener Wert (stündliches OI auf
 * 15m-Kerzen) ist keine Veränderung von 0, sondern keine Messung → null;
 * sonst stünden drei von vier Balken als flache Null da.
 */
export function veraenderung(werte) {
    return werte.map((w, i) => {
        const v = werte[i - 1]
        if (i === 0 || w == null || v == null || w === v) return null
        return w - v
    })
}

/**
 * Ereignisse (Funding-Zahlungen) der Kerze zuordnen, in die sie fallen, und
 * je Kerze summieren. Kerzen ohne Zahlung bleiben leer: auf 15m zahlt nur
 * jede 16. bzw. 32. Kerze.
 */
export function jeKerzeSumme(kerzen, punkte, feld, faktor = 1) {
    const aus = new Array(kerzen.length).fill(null)
    if (!Array.isArray(punkte) || !punkte.length || !kerzen.length) return aus
    let i = 0
    for (const pkt of [...punkte].sort((a, b) => a.t - b.t)) {
        if (pkt.t < kerzen[0].t) continue
        while (i + 1 < kerzen.length && kerzen[i + 1].t <= pkt.t) i++
        const v = Number(pkt[feld]) * faktor
        if (!Number.isFinite(v)) continue
        aus[i] = (aus[i] ?? 0) + v
    }
    return aus
}

/** Werte, die genau zu Kerzenzeiten gehören (Momentum: gleiche Zeiteinheit). */
function nachZeit(kerzen, zeiten, werte) {
    const aus = new Array(kerzen.length).fill(null)
    if (!Array.isArray(zeiten) || !Array.isArray(werte)) return aus
    const karte = new Map(zeiten.map((t, i) => [t, werte[i]]))
    for (let i = 0; i < kerzen.length; i++) {
        const v = karte.get(kerzen[i].t)
        if (Number.isFinite(v)) aus[i] = v
    }
    return aus
}

const P_LAENGE = (vorgabe, max = 500) => ({ key: 'laenge', typ: 'zahl', vorgabe, min: 1, max, schritt: 1 })
const P_QUELLE = { key: 'quelle', typ: 'wahl', vorgabe: 'c', optionen: Object.keys(QUELLEN) }
// ── EMA (3 + 3 MTF) ─────────
const EMA_TFS = ['5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d', '3d', '1w', '1M']
const EMA_PARAMS = [
    { key: 'an1', typ: 'schalter', vorgabe: true, gruppe: 'emaChart' },
    { key: 'laenge', typ: 'zahl', vorgabe: 21, min: 1, max: 500, schritt: 1, gruppe: 'emaChart', mit: true },
    { key: 'farbe1', typ: 'farbe', vorgabe: '#29b6f6', gruppe: 'emaChart', mit: true },
    { key: 'an2', typ: 'schalter', vorgabe: false, gruppe: 'emaChart' },
    { key: 'laenge2', typ: 'zahl', vorgabe: 50, min: 1, max: 500, schritt: 1, gruppe: 'emaChart', mit: true },
    { key: 'farbe2', typ: 'farbe', vorgabe: '#f5c542', gruppe: 'emaChart', mit: true },
    { key: 'an3', typ: 'schalter', vorgabe: false, gruppe: 'emaChart' },
    { key: 'laenge3', typ: 'zahl', vorgabe: 200, min: 1, max: 500, schritt: 1, gruppe: 'emaChart', mit: true },
    { key: 'farbe3', typ: 'farbe', vorgabe: '#ab47bc', gruppe: 'emaChart', mit: true },
    { ...P_QUELLE, gruppe: 'emaChart' },
    ...[[1, '4h', 50, '#26a69a'], [2, '1d', 50, '#ff9800'], [3, '1d', 200, '#e91e63']].flatMap(([x, tf, laenge, farbe]) => [
        { key: `mtfAn${x}`, typ: 'schalter', vorgabe: false, gruppe: 'emaMtf' },
        { key: `mtfLaenge${x}`, typ: 'zahl', vorgabe: laenge, min: 1, max: 500, schritt: 1, gruppe: 'emaMtf', mit: true },
        { key: `mtfTf${x}`, typ: 'wahl', vorgabe: tf, optionen: EMA_TFS, gruppe: 'emaMtf', roh: true, mit: true },
        { key: `mtfFarbe${x}`, typ: 'farbe', vorgabe: farbe, gruppe: 'emaMtf', mit: true },
    ]),
]

/** Höhere Zeiteinheiten, die die EMA-Instanzen brauchen (nur solche, die wirklich höher sind). */
export function emaMtfQuellen(p, ivMs) {
    const aus = new Set()
    for (const x of [1, 2, 3]) if (p[`mtfAn${x}`] && TF_MS[p[`mtfTf${x}`]] > ivMs) aus.add(p[`mtfTf${x}`])
    return [...aus]
}

// ── VWAP Vector (Rechnung in vwapVector.js) ─────────
const TFS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M']
const S = (key, vorgabe, gruppe) => ({ key, typ: 'schalter', vorgabe, gruppe })
const F = (key, vorgabe, gruppe) => ({ key, typ: 'farbe', vorgabe, gruppe })
const Z = (key, vorgabe, min, max, schritt, gruppe) => ({ key, typ: 'zahl', vorgabe, min, max, schritt, gruppe })
const W = (key, vorgabe, optionen, gruppe, roh = false) => ({ key, typ: 'wahl', vorgabe, optionen, gruppe, roh })

/** Linien des VWAP Vector: Ausgabe-Key → [Schalter, Farb-Param, Beschriftung]. */
export const VV_LINIEN = [
    ['vwapD', 'showDaily', 'cDaily', 'VWAP-D', 'vwap'],
    ['vwapW', 'showWeekly', 'cWeekly', 'VWAP-W', 'vwap'],
    ['vwapM', 'showMonthly', 'cMonthly', 'VWAP-M', 'vwap'],
    ['vwapATH', 'showATH', 'cATH', 'VWAP-ATH', 'vwap'],
    ['vwapATL', 'showATL', 'cATL', 'VWAP-ATL', 'vwap'],
    ['ema21', 'showEma21', 'cEma21', 'EMA 21', 'ema'],
    ['ema50', 'showEma50', 'cEma50', 'EMA 50', 'ema'],
    ['ema200', 'showEma200', 'cEma200', 'EMA 200', 'ema'],
    ['emaC1', 'showEmaC1', 'cEmaC1', (p) => `EMA ${p.lenEmaC1}`, 'ema'],
    ['emaC2', 'showEmaC2', 'cEmaC2', (p) => `EMA ${p.lenEmaC2}`, 'ema'],
    ['mtf1', 'showMtfE1', 'cMtfE1', (p) => `EMA ${p.lenMtfE1} ${p.tfMtfE1}`, 'ema'],
    ['mtf2', 'showMtfE2', 'cMtfE2', (p) => `EMA ${p.lenMtfE2} ${p.tfMtfE2}`, 'ema'],
    ['mtf3', 'showMtfE3', 'cMtfE3', (p) => `EMA ${p.lenMtfE3} ${p.tfMtfE3}`, 'ema'],
]

/*
 * Dialog-Aufbau: `haupt` = Hauptschalter der Gruppe (steht in der Überschrift),
 * `mit` = gehört in die Zeile des Parameters davor (Schalter · Länge · Farbe
 * in EINER Zeile statt drei). Die Werte selbst sind die der Vorlage.
 */
const H = (p) => ({ ...p, haupt: true })
const M = (p) => ({ ...p, mit: true })
const VV_PARAMS = [
    // 1 PVSRA
    H(S('showVector', true, 'pvsra')), Z('climaxMult', 2, 0.5, 10, 0.1, 'pvsra'), Z('risingMult', 1.5, 0.5, 10, 0.1, 'pvsra'),
    Z('pvsraLen', 10, 1, 200, 1, 'pvsra'),
    F('cClimaxBull', '#00e600', 'pvsra'), M(F('cClimaxBear', '#ff0000', 'pvsra')),
    F('cRisingBull', '#0000ff', 'pvsra'), M(F('cRisingBear', '#da00ff', 'pvsra')),
    F('cNeutBull', '#999999', 'pvsra'), M(F('cNeutBear', '#4d4d4d', 'pvsra')),
    Z('vecDeckkraft', 80, 0, 100, 5, 'pvsra'),
    // 2 VWAP
    S('showDaily', false, 'vwap'), M(F('cDaily', '#70ccbd', 'vwap')),
    S('showWeekly', false, 'vwap'), M(F('cWeekly', '#ffffff', 'vwap')),
    S('showMonthly', false, 'vwap'), M(F('cMonthly', '#f06292', 'vwap')),
    S('showATH', false, 'vwap'), M(F('cATH', '#00bcd4', 'vwap')),
    S('showATL', false, 'vwap'), M(F('cATL', '#3355ff', 'vwap')),
    S('showSwingHi', true, 'vwap'), M(F('cSwingHi', '#5cb85c', 'vwap')),
    S('showSwingLo', true, 'vwap'), M(F('cSwingLo', '#880e4f', 'vwap')),
    Z('swingWidth', 2, 1, 5, 1, 'vwap'), M(W('swingStyle', 'gestrichelt', ['gestrichelt', 'durchgezogen', 'gepunktet'], 'vwap')),
    Z('swingPivLen', 20, 2, 200, 1, 'vwap'), Z('swingCnt', 1, 1, 3, 1, 'vwap'), Z('swingMinSep', 1, 0, 20, 0.1, 'vwap'),
    S('labelVWAPS', true, 'vwap'), M(Z('lblOffVwap', 12, 0, 100, 1, 'vwap')),
    // 3 EMA
    S('showEma21', true, 'ema'), M(F('cEma21', '#f5d300', 'ema')),
    S('showEma50', true, 'ema'), M(F('cEma50', '#ff9800', 'ema')),
    S('showEma200', true, 'ema'), M(F('cEma200', '#e0e0e0', 'ema')),
    S('showEmaC1', false, 'ema'), M(Z('lenEmaC1', 200, 1, 2000, 1, 'ema')), M(F('cEmaC1', '#7b2fbe', 'ema')),
    S('showEmaC2', false, 'ema'), M(Z('lenEmaC2', 800, 1, 2000, 1, 'ema')), M(F('cEmaC2', '#a52020', 'ema')),
    S('showMtfE1', true, 'ema'), M(Z('lenMtfE1', 13, 1, 1000, 1, 'ema')), M(W('tfMtfE1', '1d', TFS, 'ema', true)), M(F('cMtfE1', '#00bcd4', 'ema')),
    S('showMtfE2', true, 'ema'), M(Z('lenMtfE2', 50, 1, 1000, 1, 'ema')), M(W('tfMtfE2', '1d', TFS, 'ema', true)), M(F('cMtfE2', '#e65100', 'ema')),
    S('showMtfE3', false, 'ema'), M(Z('lenMtfE3', 200, 1, 1000, 1, 'ema')), M(W('tfMtfE3', '1d', TFS, 'ema', true)), M(F('cMtfE3', '#b388ff', 'ema')),
    S('labelEMAS', true, 'ema'), M(Z('lblOffEma', 3, 0, 100, 1, 'ema')),
    // 4 Fibonacci
    H(S('showFib', false, 'fib')), W('fibTf', '4h', TFS, 'fib', true), Z('fibAtrMult', 3, 0.5, 20, 0.5, 'fib'),
    S('fL0', true, 'fib'), M(F('cL0', '#787b86', 'fib')), S('fL236', false, 'fib'), M(F('cL236', '#f23645', 'fib')),
    S('fL382', false, 'fib'), M(F('cL382', '#ff9800', 'fib')), S('fL5', false, 'fib'), M(F('cL5', '#4caf50', 'fib')),
    S('fL618', true, 'fib'), M(F('cL618', '#089981', 'fib')), S('fL786', true, 'fib'), M(F('cL786', '#64b5f6', 'fib')),
    S('fL1', true, 'fib'), M(F('cL1', '#787b86', 'fib')),
    // 5 Engulfing
    H(S('showEng', true, 'eng')), Z('engMinBody', 1, 0, 10, 0.1, 'eng'), S('engVolConf', false, 'eng'),
    F('cEngBull', '#00e676', 'eng'), M(F('cEngBear', '#ff1744', 'eng')),
    // 6 Perioden-POC
    H(S('showPocPer', true, 'pocPer')), W('pocPerTf', '1d', ['4h', '12h', '1d', '1w', '1M'], 'pocPer', true),
    Z('pocPerBins', 50, 10, 200, 1, 'pocPer'), Z('pocPerMax', 20, 1, 100, 1, 'pocPer'),
    S('pocPerExt', true, 'pocPer'), S('pocPerLbl', true, 'pocPer'), M(Z('lblOffPocPer', 22, 0, 100, 1, 'pocPer')),
    F('cPocPer', '#ab47bc', 'pocPer'), M(Z('pocPerWid', 2, 1, 4, 1, 'pocPer')), Z('pocPerDist', 4, 0, 50, 0.5, 'pocPer'),
    // 7 Candle-POC
    H(S('showPocC', true, 'pocC')), Z('pocCPiv', 5, 1, 20, 1, 'pocC'), W('pocCTf', 'auto', ['auto', '1m', '3m', '5m', '15m', '30m', '1h'], 'pocC', true),
    Z('pocCBins', 25, 5, 100, 1, 'pocC'), Z('pocCMax', 60, 5, 300, 1, 'pocC'),
    S('pocCLabel', false, 'pocC'), M(Z('lblOffPocC', 22, 0, 100, 1, 'pocC')),
    F('cPocC', '#26c6da', 'pocC'), M(Z('pocCWidth', 2, 1, 4, 1, 'pocC')),
    S('pocCAll', true, 'pocC'), M(F('cPocCAll', '#26c6da', 'pocC')), M(Z('pocCAllW', 1, 1, 4, 1, 'pocC')),
    // 8 Vektorkerzen-Zonen
    H(S('showVliq', true, 'vliq')), S('vliqClimax', true, 'vliq'), S('vliqBody', true, 'vliq'),
    Z('vliqTransp', 85, 0, 100, 5, 'vliq'), S('vliqBorder', false, 'vliq'),
    F('cVliqBull', '#26a69a', 'vliq'), M(F('cVliqBear', '#ef5350', 'vliq')), Z('vliqMax', 30, 2, 300, 1, 'vliq'),
    // 9 Daily Open
    H(S('showDOpen', true, 'dopen')), F('cDOpen', '#ffffff', 'dopen'), S('dOpenLbl', true, 'dopen'), M(Z('lblOffDO', 12, 0, 100, 1, 'dopen')),
]

/** Höchstzahl Intrabar-Kerzen je Abruf-Folge (4 Seiten à 1500, Binance Futures). */
export const INTRA_BUDGET = 6000
/** So viele Chartkerzen soll der Candle-POC bei „auto" abdecken. */
const INTRA_ZIEL_KERZEN = 300
const INTRA_STUFEN = ['1m', '3m', '5m', '15m', '30m', '1h']

/**
 * Intrabar-Zeiteinheit für den Candle-POC. „auto" nimmt die feinste, mit der
 * das Budget noch `INTRA_ZIEL_KERZEN` Chartkerzen abdeckt (bzw. alle geladenen,
 * wenn es weniger sind). Fest 1m auf 4h hiess: 240 je Kerze, Budget nach
 * 18 Kerzen erschöpft — nur die letzten Kerzen hatten einen POC.
 */
export function intrabarTf(wahl, ivMs, tfMs, anzahlKerzen = INTRA_ZIEL_KERZEN) {
    if (wahl !== 'auto') return tfMs[wahl] < ivMs ? wahl : null
    const ziel = Math.max(1, Math.min(INTRA_ZIEL_KERZEN, anzahlKerzen || INTRA_ZIEL_KERZEN))
    const kleiner = INTRA_STUFEN.filter((tf) => tfMs[tf] && tfMs[tf] < ivMs)
    if (!kleiner.length) return null
    return kleiner.find((tf) => (ivMs / tfMs[tf]) * ziel <= INTRA_BUDGET) || kleiner[kleiner.length - 1]
}

/** Welche Zeiteinheiten der VWAP Vector nachladen muss (höhere + Intrabar). */
export function vwapVectorQuellen(p, ivMs, tfMs, anzahlKerzen) {
    const htf = new Set()
    for (const x of [1, 2, 3]) if (p[`showMtfE${x}`]) htf.add(p[`tfMtfE${x}`])
    if (p.showFib) htf.add(p.fibTf)
    // Eine „höhere" Zeiteinheit, die gar nicht höher ist, rechnet der Chart selbst.
    const hoeher = [...htf].filter((tf) => tfMs[tf] > ivMs)
    const intra = p.showPocC ? intrabarTf(p.pocCTf, ivMs, tfMs, anzahlKerzen) : null
    return { htf: hoeher, intra }
}


// ── Strategie-Indikatoren LSOB / GUSS ────────────────────────────────────
// Parameter der STRATEGIE (`strategie: true` → gehen an den Server, der sie mit
// validateParams prüft), Beschriftung aus deren i18n (`label`). Vorgaben müssen
// denen in server/strategies/*.js gleichen — der Selbsttest
// server/__selftest-chart-signale.mjs vergleicht sie.
const SP = (sid, key, typ, vorgabe, gruppe, extra = {}) => ({ key, typ, vorgabe, gruppe, strategie: true, label: `strategies.${sid}.${key}`, ...extra })
const SZ = (sid, key, vorgabe, min, max, schritt, gruppe) => SP(sid, key, 'zahl', vorgabe, gruppe, { min, max, schritt })
const SW = (sid, key, vorgabe, optionen, gruppe) => SP(sid, key, 'wahl', vorgabe, gruppe, { optionen: optionen.map((o) => o[0]), optionLabel: Object.fromEntries(optionen.map(([v, l]) => [v, `strategies.${sid}.${l}`])) })
const SIGNAL_DARSTELLUNG = [
    { key: 'sigLong', typ: 'schalter', vorgabe: true, gruppe: 'sigBild' },
    { key: 'sigShort', typ: 'schalter', vorgabe: true, gruppe: 'sigBild' },
    { key: 'sigVerworfen', typ: 'schalter', vorgabe: true, gruppe: 'sigBild' },
    { key: 'sigFarbeLong', typ: 'farbe', vorgabe: '#26a69a', gruppe: 'sigBild' },
    { key: 'sigFarbeShort', typ: 'farbe', vorgabe: '#ef5350', gruppe: 'sigBild' },
]
export const LSOB_PARAMS = [
    SZ('lsob', 'swingLookback', 5, 2, 50, 1, 'lsobStruktur'),
    SZ('lsob', 'swingConfirmBars', 2, 1, 20, 1, 'lsobStruktur'),
    SZ('lsob', 'equalHighTolerancePct', 0.05, 0, 2, 0.01, 'lsobSweep'),
    SZ('lsob', 'sweepMinWickPct', 15, 0, 100, 1, 'lsobSweep'),
    SZ('lsob', 'oppositeCandles', 2, 1, 5, 1, 'lsobOb'),
    SW('lsob', 'obCandle', 'extreme', [['lastOpposite', 'obLastOpposite'], ['extreme', 'obExtreme']], 'lsobOb'),
    SZ('lsob', 'obSearchBack', 3, 0, 10, 1, 'lsobOb'),
    SW('lsob', 'obSource', 'wick', [['body', 'obSourceBody'], ['wick', 'obSourceWick']], 'lsobOb'),
    SZ('lsob', 'impulseMinAtr', 1, 0, 10, 0.1, 'lsobOb'),
    SZ('lsob', 'impulseMaxCandles', 10, 1, 50, 1, 'lsobOb'),
    SZ('lsob', 'maxRetestDepthPct', 25, 5, 60, 1, 'lsobEinstieg'),
    SZ('lsob', 'retestMaxCandles', 40, 3, 500, 1, 'lsobEinstieg'),
    SW('lsob', 'entryMode', 'zone_touch', [['zone_touch', 'entryZoneTouch'], ['rejection_confirmed', 'entryRejection'], ['direction_confirmed', 'entryDirection']], 'lsobEinstieg'),
    SW('lsob', 'slMode', 'sweep_extreme', [['sweep_extreme', 'slSweep'], ['retest_wick', 'slRetestWick']], 'lsobAusstieg'),
    SW('lsob', 'tpMode', 'lastSwing', [['lastSwing', 'tpLastSwing'], ['rr', 'tpRr'], ['none', 'tpNone']], 'lsobAusstieg'),
    SZ('lsob', 'tpRR', 2, 0.5, 20, 0.1, 'lsobAusstieg'),
    ...SIGNAL_DARSTELLUNG,
]
export const GUSS_PARAMS = [
    SZ('ema_touch', 'emaFast', 21, 5, 50, 1, 'gussTrend'),
    SZ('ema_touch', 'emaEntry', 50, 20, 100, 1, 'gussTrend'),
    SP('ema_touch', 'useEma200Filter', 'schalter', false, 'gussTrend'),
    SZ('ema_touch', 'emaSlow', 200, 100, 300, 10, 'gussTrend'),
    SZ('ema_touch', 'minOverextensionPct', 2.5, 0.1, 15, 0.1, 'gussImpuls'),
    SZ('ema_touch', 'swingLookback', 10, 2, 50, 1, 'gussImpuls'),
    SZ('ema_touch', 'swingConfirmBars', 2, 1, 20, 1, 'gussImpuls'),
    SZ('ema_touch', 'maxCorrectionCandles', 10, 2, 50, 1, 'gussKorrektur'),
    SZ('ema_touch', 'maxGegenkerzen', 0, 0, 5, 1, 'gussKorrektur'),
    SZ('ema_touch', 'maxGegenkerzenAtr', 0.1, 0, 5, 0.05, 'gussKorrektur'),
    { key: 'gussEmas', typ: 'schalter', vorgabe: true, gruppe: 'sigBild' },
    ...SIGNAL_DARSTELLUNG,
]
// ── LSOB (Boxen) / GUSS-Rücklauf ──
/** Letzte Kerze weglassen, wenn sie noch läuft (ihr Schluss liegt in der Zukunft). */
function laufendRaus(k) {
    if (k.length < 2) return k
    const iv = k[k.length - 1].t - k[k.length - 2].t
    return k[k.length - 1].t + iv > Date.now() ? k.slice(0, -1) : k
}
// Rechnung in shared/lsobCv.js / shared/gussCv.js, Selbsttest mit Referenzfällen.
const CZ = (key, vorgabe, min, max, schritt, gruppe) => ({ key, typ: 'zahl', vorgabe, min, max, schritt, gruppe })
const CS = (key, vorgabe, gruppe) => ({ key, typ: 'schalter', vorgabe, gruppe })
const CF = (key, vorgabe, gruppe) => ({ key, typ: 'farbe', vorgabe, gruppe })
export const LSOB_CV_PARAMS = [
    CZ('pivotLaenge', 5, 1, 50, 1, 'cvKern'),
    CZ('invalidierungPct', 20, 0, 100, 1, 'cvKern'),
    CZ('retestPct', 10, 0, 100, 1, 'cvKern'),
    CS('strengDocht', false, 'cvKern'),
    CZ('maxDochtPct', 50, 0, 100, 1, 'cvKern'),
    CS('cvShort', true, 'cvBild'), CF('cvFarbeShort', '#ef5350', 'cvBild'),
    CS('cvLong', true, 'cvBild'), CF('cvFarbeLong', '#4caf50', 'cvBild'),
    CS('cvLabels', true, 'cvBild'), CS('cvSignale', true, 'cvBild'),
    CS('cvVorwarn', false, 'cvVorwarn'), CZ('vorwarnAtr', 0.5, 0, 10, 0.1, 'cvVorwarn'), CF('cvVorwarnFarbe', '#2962ff', 'cvVorwarn'),
    CZ('vorwarnVerzoegerung', 0, 0, 100, 1, 'cvVorwarn'), CZ('vorwarnAblauf', 150, 1, 2000, 1, 'cvVorwarn'),
]
export const GUSS_CV_PARAMS = [
    CZ('lookback', 20, 2, 200, 1, 'gcvAllg'), CZ('bestaetigung', 0, 0, 20, 1, 'gcvAllg'), CZ('timeout', 20, 1, 200, 1, 'gcvAllg'),
    CS('trendFilter', true, 'gcvAllg'), CS('ohne200', false, 'gcvAllg'),
    CZ('ema0', 21, 2, 500, 1, 'gcvEma'), CZ('ema1', 50, 2, 500, 1, 'gcvEma'), CZ('ema2', 200, 2, 1000, 1, 'gcvEma'), CS('zeigeEmas', true, 'gcvEma'),
    CS('vorwarn0', false, 'gcvEma'), CZ('vw0', 14, 2, 500, 1, 'gcvEma'),
    CS('vorwarn1', false, 'gcvEma'), CZ('vw1', 35, 2, 500, 1, 'gcvEma'),
    CS('vorwarn2', false, 'gcvEma'), CZ('vw2', 170, 2, 1000, 1, 'gcvEma'),
    CS('abstandFilter', true, 'gcvAtr'), CZ('atrLaenge', 14, 2, 100, 1, 'gcvAtr'),
    CZ('minAbstand2150', 0.5, 0, 10, 0.1, 'gcvAtr'), CZ('minAbstand50200', 0.5, 0, 10, 0.1, 'gcvAtr'),
    CS('preisFilter', true, 'gcvAtr'), CZ('minAbstandPreis', 0.5, 0, 10, 0.1, 'gcvAtr'),
    CS('zeigeLong', true, 'gcvZiel'), CS('zeigeShort', true, 'gcvZiel'),
    CS('ziel21', false, 'gcvZiel'), CS('ziel50', true, 'gcvZiel'), CS('ziel200', true, 'gcvZiel'),
    CZ('maxGegenkerzen', 1, 0, 10, 1, 'gcvGegen'), CZ('maxGegenkerzenAtr', 0.1, 0, 5, 0.05, 'gcvGegen'),
]

/** Nur die Strategie-Parameter einer LSOB/GUSS-Instanz (für /api/chart/signale). */
export function strategieParams(typ, roh) {
    const p = saubereParams(typ, roh)
    return Object.fromEntries((INDIKATOREN[typ]?.params || []).filter((x) => x.strategie).map((x) => [x.key, p[x.key]]))
}

export const INDIKATOREN = {
    sma: {
        ort: 'preis',
        params: [P_LAENGE(20), P_QUELLE],
        ausgaben: [{ key: 'wert', art: 'linie', farbe: '#f5c542', breite: 1 }],
        rechne: (k, p) => ({ wert: sma(mitQuelle(k, p.quelle), p.laenge) }),
    },
    // Drei EMAs der Chart-Zeiteinheit plus drei aus höheren Zeiteinheiten (wie TradingView
    // „Multi EMA" mit MTF). Linie 1 behält die alten Schlüssel `laenge`/`quelle` — ein
    // gespeichertes einfaches EMA zeigt weiter genau seine eine Linie: Linien 2 und 3 sind
    // für bestehende Instanzen aus und nur für NEUE an (`neu`).
    ema: {
        ort: 'preis',
        extern: 'emaMtf',
        // Höhere Kerzen nur laden, wenn eine MTF-Linie an ist
        externWenn: (p) => [1, 2, 3].some((x) => p[`mtfAn${x}`]),
        params: EMA_PARAMS,
        neu: { an2: true, an3: true },
        // Linie 1 heisst weiter `wert` — sonst ginge eine im Layout gemerkte Farbe verloren
        ausgaben: [{ key: 'wert', art: 'linie', farbe: '#29b6f6', breite: 1 }],
        ausgabenFuer: (p) => [
            ...(p.an1 !== false ? [{ key: 'wert', art: 'linie', farbe: p.farbe1, breite: 1 }] : []),
            ...(p.an2 ? [{ key: 'e2', art: 'linie', farbe: p.farbe2, breite: 1 }] : []),
            ...(p.an3 ? [{ key: 'e3', art: 'linie', farbe: p.farbe3, breite: 2 }] : []),
            ...[1, 2, 3].filter((x) => p[`mtfAn${x}`]).map((x) => ({ key: `m${x}`, art: 'linie', farbe: p[`mtfFarbe${x}`], breite: 2, strich: 'gestrichelt' })),
        ],
        kurz: (p, name) => {
            const chart = [p.an1 !== false && p.laenge, p.an2 && p.laenge2, p.an3 && p.laenge3].filter(Boolean)
            const mtf = [1, 2, 3].filter((x) => p[`mtfAn${x}`]).map((x) => `${p[`mtfLaenge${x}`]} ${p[`mtfTf${x}`]}`)
            const q = p.quelle && p.quelle !== 'c' ? ` ${p.quelle}` : ''
            return `${name} ${[...chart, ...mtf].join(' · ')}${q}`.trim()
        },
        rechne: (k, p, ext) => {
            const kk = mitQuelle(k, p.quelle)
            const aus = {}
            if (p.an1 !== false) aus.wert = ema(kk, p.laenge)
            if (p.an2) aus.e2 = ema(kk, p.laenge2)
            if (p.an3) aus.e3 = ema(kk, p.laenge3)
            const ivMs = ivAus(k)
            for (const x of [1, 2, 3]) {
                if (!p[`mtfAn${x}`]) continue
                const tf = p[`mtfTf${x}`], laenge = p[`mtfLaenge${x}`]
                // Eine „höhere" Zeiteinheit, die gar nicht höher ist, rechnet der Chart selbst.
                aus[`m${x}`] = TF_MS[tf] > ivMs
                    ? emaHoehereTf(k, ext?.htf?.[tf], laenge, TF_MS[tf], ivMs)
                    : ema(k, laenge)
            }
            return aus
        },
    },
    bb: {
        ort: 'preis',
        params: [P_LAENGE(20), { key: 'mult', typ: 'zahl', vorgabe: 2, min: 0.1, max: 10, schritt: 0.1 },
            { key: 'basis', typ: 'wahl', vorgabe: 'sma', optionen: ['sma', 'ema'] }],
        ausgaben: [
            { key: 'oben', art: 'linie', farbe: '#7e57c2', breite: 1 },
            { key: 'mitte', art: 'linie', farbe: '#ff9800', breite: 1 },
            { key: 'unten', art: 'linie', farbe: '#7e57c2', breite: 1 },
        ],
        rechne: (k, p) => {
            const b = bollinger(k, { period: p.laenge, mult: p.mult, basis: p.basis })
            return { oben: b.upper, mitte: b.middle, unten: b.lower }
        },
    },
    vwap: {
        ort: 'preis',
        params: [
            { key: 'anker', typ: 'wahl', vorgabe: 'session', optionen: ['session', 'week', 'month', 'swingHigh', 'swingLow', 'ath', 'atl'] },
            { key: 'band', typ: 'zahl', vorgabe: 0, min: 0, max: 5, schritt: 0.5 },
        ],
        ausgaben: [
            { key: 'wert', art: 'linie', farbe: '#e91e63', breite: 2 },
            { key: 'oben', art: 'linie', farbe: 'rgba(233,30,99,0.45)', breite: 1, optional: true },
            { key: 'unten', art: 'linie', farbe: 'rgba(233,30,99,0.45)', breite: 1, optional: true },
        ],
        rechne: (k, p) => {
            const aus = { wert: vwap(k, { anchor: p.anker }) }
            // Bänder nur, wenn verlangt — sonst bleiben zwei leere Reihen stehen.
            if (p.band > 0) {
                aus.oben = vwapBand(k, { anchor: p.anker, mult: p.band })
                aus.unten = vwapBand(k, { anchor: p.anker, mult: -p.band })
            }
            return aus
        },
    },
    rsi: {
        ort: 'eigen',
        params: [P_LAENGE(14), P_QUELLE,
            { key: 'maAn', typ: 'schalter', vorgabe: true },
            // Nicht im Legendennamen: „RSI 14 14" liest sich wie ein Tippfehler.
            { key: 'maLaenge', typ: 'zahl', vorgabe: 14, min: 1, max: 200, schritt: 1, nichtImNamen: true }, P_TABELLE, P_DIVERGENZ],
        tabelle: true,
        ausgaben: [
            { key: 'wert', art: 'linie', farbe: '#7e57c2', breite: 1 },
            { key: 'ma', art: 'linie', farbe: '#f7df1e', breite: 1 },
        ],
        // Die gleitende Linie nur, wenn sie an ist — sonst stünde eine leere Serie in der Legende.
        ausgabenFuer: (p) => [
            { key: 'wert', art: 'linie', farbe: '#7e57c2', breite: 1 },
            ...(p.maAn ? [{ key: 'ma', art: 'linie', farbe: '#f7df1e', breite: 1 }] : []),
        ],
        linien: [70, 50, 30],
        band: { oben: 70, unten: 30, linie: 'wert' },
        bereich: [0, 100],
        rechne: (k, p) => {
            const wert = rsi(mitQuelle(k, p.quelle), p.laenge)
            const ma = p.maAn ? smaSerie(wert, p.maLaenge) : null
            return { wert, ...(ma ? { ma } : {}), _tab: p.tabelle ? rsiKennzahlen(k, wert, ma) : null, _div: p.divergenzen ? divergenzen(k, wert) : null }
        },
    },
    macd: {
        ort: 'eigen',
        params: [
            { key: 'schnell', typ: 'zahl', vorgabe: 12, min: 1, max: 200, schritt: 1 },
            { key: 'langsam', typ: 'zahl', vorgabe: 26, min: 1, max: 400, schritt: 1 },
            { key: 'signal', typ: 'zahl', vorgabe: 9, min: 1, max: 100, schritt: 1 },
            P_QUELLE, P_TABELLE,
        ],
        tabelle: true,
        ausgaben: [
            { key: 'hist', art: 'histogramm', farbe: '#26a69a', vierFarben: true },
            { key: 'macd', art: 'linie', farbe: '#2962ff', breite: 1 },
            { key: 'signal', art: 'linie', farbe: '#ff6d00', breite: 1 },
        ],
        linien: [0],
        rechne: (k, p) => {
            const kk = mitQuelle(k, p.quelle)
            const o = { fast: p.schnell, slow: p.langsam, signal: p.signal }
            const aus = {
                macd: macd(kk, { ...o, line: 'macd' }),
                signal: macd(kk, { ...o, line: 'signal' }),
                hist: macd(kk, { ...o, line: 'hist' }),
            }
            return { ...aus, _tab: p.tabelle ? macdKennzahlen(aus.macd, aus.signal, aus.hist) : null }
        },
    },
    stoch: {
        ort: 'eigen',
        // Vorgabe wie TradingView: %K 14, %K-Glättung 1, %D 3 (vorher 3 — eine „Slow"-Stochastik
        // unter dem Namen der normalen, und die Werte wichen vom TradingView-Chart ab).
        params: [P_LAENGE(14), { key: 'glaettK', typ: 'zahl', vorgabe: 1, min: 1, max: 20, schritt: 1 },
            { key: 'glaettD', typ: 'zahl', vorgabe: 3, min: 1, max: 20, schritt: 1 }, P_TABELLE, P_DIVERGENZ],
        ausgaben: [
            { key: 'k', art: 'linie', farbe: '#2962ff', breite: 1 },
            { key: 'd', art: 'linie', farbe: '#ff6d00', breite: 1 },
        ],
        linien: [80, 20],
        band: { oben: 80, unten: 20, linie: 'k' },
        bereich: [0, 100],
        tabelle: true,
        rechne: (k, p) => {
            const r = stochastic(k, { period: p.laenge, smoothK: p.glaettK, smoothD: p.glaettD })
            return { ...r, _tab: p.tabelle ? stochKennzahlen(k, r.k, r.d) : null, _div: p.divergenzen ? divergenzen(k, r.k) : null }
        },
    },
    stochRsi: {
        ort: 'eigen',
        params: [
            { key: 'rsiLaenge', typ: 'zahl', vorgabe: 14, min: 1, max: 100, schritt: 1 },
            P_LAENGE(14, 100),
            { key: 'glaettK', typ: 'zahl', vorgabe: 3, min: 1, max: 20, schritt: 1 },
            { key: 'glaettD', typ: 'zahl', vorgabe: 3, min: 1, max: 20, schritt: 1 }, P_TABELLE, P_DIVERGENZ],
        ausgaben: [
            { key: 'k', art: 'linie', farbe: '#2962ff', breite: 1 },
            { key: 'd', art: 'linie', farbe: '#ff6d00', breite: 1 },
        ],
        linien: [80, 20],
        band: { oben: 80, unten: 20, linie: 'k' },
        bereich: [0, 100],
        tabelle: true,
        rechne: (k, p) => {
            const r = stochRsi(k, { rsiPeriod: p.rsiLaenge, stochPeriod: p.laenge, smoothK: p.glaettK, smoothD: p.glaettD })
            return { ...r, _tab: p.tabelle ? stochKennzahlen(k, r.k, r.d) : null, _div: p.divergenzen ? divergenzen(k, r.k) : null }
        },
    },
    atr: {
        ort: 'eigen',
        params: [P_LAENGE(14), P_TABELLE],
        ausgaben: [{ key: 'wert', art: 'linie', farbe: '#ef5350', breite: 1 }],
        tabelle: true,
        rechne: (k, p) => {
            const wert = atr(k, p.laenge)
            return { wert, _farbe_wert: atrFarben(wert), _tab: p.tabelle ? atrKennzahlen(k, wert, ivAus(k)) : null }
        },
    },
    adx: {
        ort: 'eigen',
        params: [P_LAENGE(14, 100), P_TABELLE],
        tabelle: true,
        ausgaben: [
            { key: 'adx', art: 'linie', farbe: '#ff9800', breite: 2 },
            { key: 'plus', art: 'linie', farbe: '#26a69a', breite: 1 },
            { key: 'minus', art: 'linie', farbe: '#ef5350', breite: 1 },
        ],
        linien: [25],
        // Hintergrund nach Trendstärke: unter 20 kein Trend (grau), ab 25 Trend (grün getönt)
        zonen: [{ von: 0, bis: 20, farbe: 'rgba(120,123,134,0.10)' }, { von: 25, bis: 200, farbe: 'rgba(38,166,154,0.07)' }],
        rechne: (k, p) => {
            const a = adx(k, p.laenge)
            const aus = { adx: a.adx, plus: a.plusDI, minus: a.minusDI }
            return { ...aus, _farbe_adx: adxFarben(aus.adx, aus.plus, aus.minus), _tab: p.tabelle ? adxKennzahlen(aus) : null }
        },
    },
    mfi: {
        ort: 'eigen',
        params: [P_LAENGE(14), P_TABELLE, P_DIVERGENZ],
        ausgaben: [{ key: 'wert', art: 'linie', farbe: '#00bcd4', breite: 1 }],
        linien: [80, 20],
        band: { oben: 80, unten: 20, linie: 'wert' },
        bereich: [0, 100],
        tabelle: true,
        rechne: (k, p) => {
            const wert = mfi(k, p.laenge)
            return { wert, _tab: p.tabelle ? mfiKennzahlen(k, wert) : null, _div: p.divergenzen ? divergenzen(k, wert) : null }
        },
    },
    obv: {
        ort: 'eigen',
        params: [P_TABELLE],
        ausgaben: [{ key: 'wert', art: 'linie', farbe: '#8d6e63', breite: 1 }],
        tabelle: true,
        rechne: (k, p) => {
            const wert = obv(k)
            return { wert, _farbe_wert: obvFarben(k, wert), _tab: p.tabelle ? obvKennzahlen(k, wert) : null }
        },
    },
    // ── Daten-Fenster aus eigenen Quellen ────────────────────────────────
    oi: {
        ort: 'eigen',
        extern: 'oi',
        params: [P_TABELLE],
        tabelle: true,
        // Fläche mit Verlauf für den Bestand, darunter die Veränderung je Kerze
        // als Balken (grün = Positionen kommen dazu, rot = sie werden
        // geschlossen) — die Veränderung ist die eigentliche Aussage.
        ausgaben: [
            { key: 'wert', art: 'flaeche', farbe: '#ffb74d', breite: 2 },
            { key: 'delta', art: 'histogramm', farbe: '#26a69a', vorzeichen: true, unten: true },
        ],
        kompakt: true,
        rechne: (k, _p, ext) => {
            const wert = aufKerzen(k, ext, 'oi', { amSchluss: true })
            return { wert, delta: veraenderung(wert), _tab: _p.tabelle ? oiKennzahlen(k, wert) : null }
        },
    },
    // Aufgezeichnete Liquidationen je Kerze (USD): Shorts nach oben in der
    // Hausfarbe, Longs nach unten rot. Kein Eintrag in „Indikator hinzufügen" —
    // das Fenster erscheint über den Schalter „Liquidationen" (Overlay) und
    // ersetzt dort seit 23.10.2026 die Blasen im Kursbild.
    liquidationen: {
        ort: 'eigen',
        extern: 'liquidationen',
        intern: true,
        params: [],
        ausgaben: [
            { key: 'short', art: 'histogramm', farbe: '#1fd6c4' },
            { key: 'long', art: 'histogramm', farbe: '#e0574c' },
        ],
        kompakt: true,
        linien: [0],
        rechne: (k, _p, ext) => {
            const ev = Array.isArray(ext) ? ext : []
            const usd = (e) => ({ t: e.t, v: e.price * e.qty })
            const short = jeKerzeSumme(k, ev.filter((e) => e.isBuy).map(usd), 'v')
            const long = jeKerzeSumme(k, ev.filter((e) => !e.isBuy).map(usd), 'v').map((v) => (v == null ? null : -v))
            return { short, long }
        },
    },
    longShort: {
        ort: 'eigen',
        extern: 'oi',
        params: [P_TABELLE],
        ausgaben: [{ key: 'wert', art: 'linie', farbe: '#26a69a', breite: 2 }],
        linien: [50],
        // Fläche über 50 grün, darunter rot (wie das Band der Oszillatoren, nur mit einer Grenze)
        band: { oben: 50, unten: 50, linie: 'wert' },
        tabelle: true,
        rechne: (k, _p, ext) => {
            const wert = aufKerzen(k, ext, 'longPct', { amSchluss: true })
            return { wert, _farbe_wert: longAnteilFarben(wert), _tab: _p.tabelle ? longAnteilKennzahlen(wert) : null }
        },
    },
    funding: {
        ort: 'eigen',
        extern: 'funding',
        params: [P_TABELLE],
        ausgaben: [{ key: 'hist', art: 'histogramm', farbe: '#26a69a' }],
        linien: [0],
        // In Prozent je Zahlung; mehrere Zahlungen in einer Kerze summiert.
        tabelle: true,
        rechne: (k, _p, ext) => {
            const hist = jeKerzeSumme(k, ext, 'rate', 100)
            return { hist, _farbe_hist: fundingFarben(hist), _tab: _p.tabelle ? fundingKennzahlen(k, hist) : null }
        },
    },
    momentum: {
        ort: 'eigen',
        extern: 'momentum',
        params: [],
        // Eigene Zeichnung wie in der Vorlage (`momentumZeichnung.js`): Flächen bis zur
        // Nulllinie, Geldfluss je Kerze mit violetter Futures-Phase, Spot-Linie,
        // Punkte, Rauten, Schienen, Divergenzen, 4h-Farbleiste. Als Serien
        // bleiben nur Welle und Signallinie; der Geldfluss steht als Wert in der
        // Legende.
        zeichner: 'momentum',
        ausgaben: [
            { key: 'w1', art: 'linie', farbe: '#6fa8ff', breite: 2 },
            { key: 'w2', art: 'linie', farbe: 'rgba(61,99,214,0.55)', breite: 1 },
            { key: 'mf', art: 'wert', farbe: '#4caf50' },
        ],
        bereich: [-140, 128],
        rechne: (k, _p, ext) => ({
            w1: nachZeit(k, ext?.t, ext?.w1),
            w2: nachZeit(k, ext?.t, ext?.w2),
            mf: nachZeit(k, ext?.t, ext?.mf),
        }),
    },
    vwapVector: {
        ort: 'preis',
        extern: 'vwapVector',
        zeichner: 'vwapVector',
        kurzOhneParams: true,
        params: VV_PARAMS,
        ausgaben: [],
        ausgabenFuer: (p) => VV_LINIEN.filter(([, an]) => p[an]).map(([key, , farbe]) => ({ key, art: 'linie', farbe: p[farbe], breite: 1 })),
        rechne: (k, p, ext) => {
            const r = rechneVwapVector(k, p, ext || {}, ext?.ivMs || (k.length > 1 ? k[k.length - 1].t - k[k.length - 2].t : 3_600_000))
            return { ...r.linien, _vv: r }
        },
    },
    // ── Strategie-Signale (server/chart-signale.js) ─────────────────────
    // Jedes Setup, das die Strategie über die geladene Historie gefunden hätte —
    // gerechnet wie im Backtest, ohne Blick in die Zukunft, mit Standardparametern.
    lsob: {
        ort: 'preis',
        extern: 'signale_lsob',
        // Nicht mehr in „Indikator hinzufügen" (26.10.2026): „LSOB" (`lsobCv`) ist der
        // gegen die Referenz geprüfte LSOB-Indikator; bestehende Layouts behalten diesen.
        intern: true,
        zeichner: 'signale',
        kurzOhneParams: true,
        params: LSOB_PARAMS,
        ausgaben: [],
        rechne: () => ({}),
    },
    guss: {
        ort: 'preis',
        extern: 'signale_ema_touch',
        zeichner: 'signale',
        kurzOhneParams: true,
        // Die drei EMAs der Strategie — mit deren Längen aus den Einstellungen
        params: GUSS_PARAMS,
        ausgaben: [],
        ausgabenFuer: (p) => (p.gussEmas ? [
            { key: 'ema21', art: 'linie', farbe: '#29b6f6', breite: 1 },
            { key: 'ema50', art: 'linie', farbe: '#f5c542', breite: 2 },
            { key: 'ema200', art: 'linie', farbe: '#ab47bc', breite: 1 },
        ] : []),
        rechne: (k, p) => (p.gussEmas ? { ema21: ema(k, p.emaFast), ema50: ema(k, p.emaEntry), ema200: ema(k, p.emaSlow) } : {}),
    },
    lsobCv: {
        ort: 'preis',
        zeichner: 'cv',
        kurzOhneParams: true,
        params: LSOB_CV_PARAMS,
        ausgaben: [],
        // Ohne die laufende Kerze: sonst gilt ein frisches Pivot zu früh als bestätigt (5 Kerzen
        // rechts, davon eine unfertig) und eine Box erscheint, die die Referenz noch nicht zeigt.
        rechne: (k, p) => ({ _cv: { art: 'lsob', ...lsobCv(laufendRaus(k), p) } }),
    },
    gussCv: {
        ort: 'preis',
        zeichner: 'cv',
        kurzOhneParams: true,
        params: GUSS_CV_PARAMS,
        ausgaben: [],
        ausgabenFuer: (p) => [
            ...(p.zeigeEmas ? [
                { key: 'e0', art: 'linie', farbe: '#f5e663', breite: 1 },
                { key: 'e1', art: 'linie', farbe: '#ff9800', breite: 2 },
                { key: 'e2', art: 'linie', farbe: '#d1d4dc', breite: 2 },
            ] : []),
            ...(p.vorwarn0 ? [{ key: 'w0', art: 'linie', farbe: 'rgba(245,230,99,0.5)', breite: 1, strich: 'gestrichelt' }] : []),
            ...(p.vorwarn1 ? [{ key: 'w1', art: 'linie', farbe: 'rgba(255,152,0,0.5)', breite: 1, strich: 'gestrichelt' }] : []),
            ...(p.vorwarn2 ? [{ key: 'w2', art: 'linie', farbe: 'rgba(209,212,220,0.5)', breite: 1, strich: 'gestrichelt' }] : []),
        ],
        rechne: (k, p) => {
            const r = gussCv(k, p)
            return {
                e0: r.emas.e0, e1: r.emas.e1, e2: r.emas.e2,
                w0: p.vorwarn0 ? ema(k, p.vw0) : null, w1: p.vorwarn1 ? ema(k, p.vw1) : null, w2: p.vorwarn2 ? ema(k, p.vw2) : null,
                _cv: { art: 'guss', ereignisse: r.ereignisse },
            }
        },
    },
    volSma: {
        ort: 'eigen',
        params: [P_LAENGE(20), P_TABELLE],
        ausgaben: [
            { key: 'vol', art: 'histogramm', farbe: 'rgba(120,123,134,0.5)' },
            { key: 'wert', art: 'linie', farbe: '#ffb74d', breite: 1 },
        ],
        tabelle: true,
        rechne: (k, p) => ({ vol: k.map((x) => x.v), _farbe_vol: volumenFarben(k, p.laenge), wert: volumeSma(k, p.laenge), _tab: p.tabelle ? volumenKennzahlen(k, p.laenge) : null }),
    },
}

/** Vorgaben einer Definition als Parameter-Objekt. */
export function vorgaben(typ) {
    const def = INDIKATOREN[typ]
    const p = {}
    for (const x of def?.params || []) p[x.key] = x.vorgabe
    return p
}

/**
 * Gespeicherte Parameter säubern: Unbekanntes fällt weg, Zahlen werden auf
 * ihren Bereich begrenzt, eine unbekannte Wahl fällt auf die Vorgabe zurück.
 * Ein Layout kann von einem älteren Stand stammen oder von Hand geändert sein.
 */
export function saubereParams(typ, roh) {
    const def = INDIKATOREN[typ]
    const p = {}
    for (const x of def?.params || []) {
        const v = roh?.[x.key]
        if (x.typ === 'zahl') {
            // Leeres Feld (v-model.number liefert '') ist die Vorgabe, nicht 0 → Minimum (EMA 1).
            const n = v === '' || v == null ? NaN : Number(v)
            if (!Number.isFinite(n)) { p[x.key] = x.vorgabe; continue }
            // Ganzzahlige Längen runden: 14.5 liess ema/sma/rsi auf candles[i − 14.5] greifen und werfen.
            // Faktoren mit Schritt 0.1 (Bollinger 2.25) bleiben, wie eingegeben.
            const gerundet = (x.schritt ?? 1) >= 1 ? Math.round(n) : n
            p[x.key] = Math.min(x.max, Math.max(x.min, gerundet))
        } else if (x.typ === 'schalter') {
            p[x.key] = typeof v === 'boolean' ? v : x.vorgabe
        } else if (x.typ === 'farbe') {
            p[x.key] = /^#[0-9a-f]{6}$/i.test(v || '') ? v : x.vorgabe
        } else {
            p[x.key] = x.optionen.includes(v) ? v : x.vorgabe
        }
    }
    return p
}

/** Rechnet eine Instanz; unbekannter Typ → leeres Ergebnis statt Absturz. */
export function rechneIndikator(typ, kerzen, params, extern = {}) {
    const def = INDIKATOREN[typ]
    if (!def || !kerzen.length) return {}
    return def.rechne(kerzen, saubereParams(typ, params), def.extern ? extern?.[def.extern] : undefined)
}

/** Ausgaben einer Instanz — je nach Einstellung, wenn die Definition das vorsieht. */
export function ausgabenVon(typ, params) {
    const def = INDIKATOREN[typ]
    if (!def) return []
    return def.ausgabenFuer ? def.ausgabenFuer(saubereParams(typ, params)) : def.ausgaben
}

/** Welche fremden Datenquellen braucht eine Indikatorliste? */
export function benoetigteQuellen(instanzen) {
    return [...new Set((instanzen || []).filter((i) => i.sichtbar !== false)
        .filter((i) => !INDIKATOREN[i.typ]?.externWenn || INDIKATOREN[i.typ].externWenn(saubereParams(i.typ, i.params)))
        .map((i) => INDIKATOREN[i.typ]?.extern).filter(Boolean))]
}

/** Kurzbeschriftung für die Legende, z. B. „EMA 21" oder „BB 20 2". */
export function kurzname(typ, params, name) {
    if (INDIKATOREN[typ]?.kurzOhneParams) return name
    const p = saubereParams(typ, params)
    if (INDIKATOREN[typ]?.kurz) return INDIKATOREN[typ].kurz(p, name)
    const zahlen = (INDIKATOREN[typ]?.params || []).filter((x) => x.typ === 'zahl' && !x.nichtImNamen).map((x) => p[x.key])
    const quelle = p.quelle && p.quelle !== 'c' ? ` ${p.quelle}` : ''
    const anker = p.anker ? ` ${p.anker}` : ''
    return `${name}${zahlen.length ? ' ' + zahlen.join(' ') : ''}${anker}${quelle}`
}

let laufNr = 0
/** Neue Instanz für ein Layout. `id` nur innerhalb des Panels eindeutig. */
export function neueInstanz(typ) {
    // `neu`: Vorgaben nur für neu angelegte Instanzen (gespeicherte behalten ihr Bild)
    return { id: `${typ}-${Date.now().toString(36)}-${(laufNr++).toString(36)}`, typ, params: { ...vorgaben(typ), ...(INDIKATOREN[typ]?.neu || {}) }, farben: {}, sichtbar: true }
}
