/**
 * Bot-Planer: einen NEUEN Futures-Grid-Bot von Grund auf planen — rein, ohne Netz.
 *
 * Ein Plan hat dieselbe Form wie ein echter Bot (`planBot` baut ein rohes
 * Pionex-Objekt und schickt es durch `normalisiereBot`). So rechnen Simulation,
 * KI-Prüfung und der Start über die Steuerung ohne Sonderwege.
 *
 * Ablauf (routen in planer-routen.js):
 *  1. Der Code misst die Lage (Kurs, Tages-ATR, Niveaus auf 1w/1d/4h) und baut
 *     Kandidaten: Bänder eng/mittel/breit um den Kurs und Bänder knapp jenseits
 *     gemessener Niveaus, gerichtet auch mit Stop-Loss. Eine Grid-Dichte je Band
 *     (¼ Tages-ATR, mindestens 0,6 %), Long und Neutral geometrisch, Short
 *     arithmetisch — nachgemessen am 17.11.2026 (siehe planKandidaten).
 *  2. Jeder Kandidat läuft durch die geeichte Grid-Simulation — RELATIV zum
 *     Kurs: dasselbe Band in Prozent um den Kurs, gestartet vor N Tagen. Ein
 *     Band in absoluten Preisen von heute sagt über die letzten Wochen nichts.
 *  3. Dazu „Start heute": Menge je Grid, Startposition und geschätzte
 *     Liquidation beim heutigen Kurs.
 *
 * Menge je Grid aus Einsatz × Hebel (Pionex rechnet sie selbst und nennt die
 * Formel nicht). Gemessen an 168 echten Futures-Grid-Bots des Entwicklers
 * (11.11.2026): Menge × Σ(Füllpreis je Zelle) / (Start-Einsatz × Hebel) lag im
 * Median bei 0,93 und bei den meisten zwischen 0,90 und 0,95 — Füllpreis =
 * Startkurs für die beim Start schon gefüllten Zellen, sonst die Linie, an der
 * die Zelle eröffnet. Den Rest behält Pionex offenbar für Gebühren und Puffer.
 * Neutrale Bots streuten stärker (0,46–0,95). Es bleibt eine Schätzung; die
 * Prüfung bei Pionex (checkParams) vor dem Start nennt die echte Liquidation.
 */
import { normalisiereBot, liqRisiko } from './pionex-bots.js'
import { gridLinien, simuliereBot } from '../../shared/grid-simulation.js'
import { GEBUEHREN } from './pionex-wissen.js'
import { niveausAusZeitrahmen } from './bot-ki.js'
import { DURCHSTICH, MMR_VORGABE } from './simulation.js'
import { konsolidierungen } from '../chart-kandidaten.js'
import { volumenprofil } from '../../shared/volumenprofil.js'
import { atr as atrReihe } from '../../shared/indicators.js'

export const PLAN_ID = 'plan'
export const PLAN_RESERVE = 0.93
/** Spot-Grid: Pionex setzt die ganze Investition ein (USDT für die Linien unter dem Kurs, Coin darüber). Schätzung; checkParams nennt die echte Menge. */
export const SPOT_RESERVE = 1
/** Spot-Grid: `create` nimmt 2–200 Grids an (checkParams bis 1000) — es gilt das Kleinere. */
export const SPOT_MAX_GRIDS = 200
export const RICHTUNGEN = ['LONG', 'SHORT', 'NEUTRAL']
/** „Alle Richtungen": der Planer rechnet Long, Short und Neutral und vergleicht sie. */
export const ALLE = 'ALLE'
export const PLAN_TAGE = [30, 60, 90]
export const MAX_PLAN_GRIDS = 500
export const MAX_HEBEL = 125
export const MAX_KANDIDATEN = 24
export const MAX_EIGENE = 3
/**
 * Langfrist-Bänder: Unterstützung/Widerstand mindestens 8 % entfernt, oben +40 % (bis +60 % an einem Widerstand),
 * Notbremse 8 % vor der GESCHÄTZTEN Liquidation. Bis 16.11.2026 waren es 2 % — das lag innerhalb des
 * Schätzfehlers (Reserve 0,90–0,95 gemessen, Wartungsmarge nicht aus Pionex' Tabelle: die echte Liquidation
 * lag in Nachrechnungen bis 2,5 % näher am Kurs), der Stop hätte dann nie ausgelöst (Audit PLN-01).
 */
export const LANG = { abstand_min_unten: 0.92, abstand_min_oben: 1.08, oben: 1.4, oben_max: 1.6, notbremse: 0.08 }

/** Die Notbremse bleibt knapp ausserhalb des Bands: so weit (Anteil) jenseits der Bandkante. */
const NOTBREMSE_BANDABSTAND = 0.005

/**
 * Preis der Notbremse: `LANG.notbremse` vor der geschätzten Liquidation — liegt das schon im Band, dann
 * knapp ausserhalb der Bandkante (so weit weg von der Liquidation wie möglich, ohne im Band zu stoppen).
 * Passt auch das nicht zwischen Liquidation und Band, der halbe Weg. Rein.
 */
export function notbremsePreis(richtung, liq, variante) {
    if (richtung === 'LONG') {
        const sl = Math.min(liq * (1 + LANG.notbremse), variante.unten * (1 - NOTBREMSE_BANDABSTAND))
        return sl > liq ? sl : (liq + variante.unten) / 2
    }
    const sl = Math.max(liq * (1 - LANG.notbremse), variante.oben * (1 + NOTBREMSE_BANDABSTAND))
    return sl < liq ? sl : (liq + variante.oben) / 2
}

/** Ab so vielen Grids ist es ein Grid; darunter warnt der Planer oben (Einsatz zu klein). */
export const SINNVOLLE_GRIDS = 20
export const WENIG_GRIDS = 10
/** Unter diesem Abstand je Grid (Anteil) warnt der Planer: Gebühren und Durchstich fressen den Zyklus (Messung 17.11.2026). */
export const ABSTAND_ENG = 0.005

const istZahl = (v) => typeof v === 'number' && Number.isFinite(v)
const leer = (v) => v === undefined || v === null || v === ''
const runde = (v, stellen = 6) => (istZahl(v) ? Number(v.toPrecision(stellen)) : v)
const zahlAus = (v) => {
    if (leer(v)) return null
    if (typeof v === 'number') return Number.isFinite(v) ? v : NaN
    const s = String(v).trim()
    return /^\d+([.,]\d+)?$/.test(s) ? Number(s.replace(',', '.')) : NaN
}

/** Trend-Feld von Pionex: Coin-M ist invers, ein Long der Coin ist dort „short". */
export function trendFuer(richtung, coinM) {
    if (richtung === 'NEUTRAL') return 'no_trend'
    const long = richtung === 'LONG'
    return coinM ? (long ? 'short' : 'long') : (long ? 'long' : 'short')
}

/**
 * Menge je Grid (im Instrument) für Einsatz × Hebel, siehe Kopf. Rein.
 * `L` Linien im Instrument, `start` Startkurs im Instrument, `trend` Pionex-Trend.
 */
export function mengeJeGrid({ L, trend, start, einsatz, hebel, reserve = PLAN_RESERVE }) {
    if (!L?.length || L.length < 2 || !(start > 0) || !(einsatz > 0) || !(hebel > 0)) return null
    let nominal = 0
    for (let i = 0; i < L.length - 1; i++) {
        const lo = L[i], hi = L[i + 1]
        let p
        if (trend === 'long') p = hi > start ? start : lo            // über dem Kurs beim Start gekauft
        else if (trend === 'short') p = lo < start ? start : hi      // unter dem Kurs beim Start verkauft
        else p = hi <= start ? lo : lo >= start ? hi : start
        nominal += p
    }
    return nominal > 0 ? reserve * einsatz * hebel / nominal : null
}

/**
 * Ein Plan als Bot (Form von normalisiereBot). Preise in USD je Coin.
 * @param e { coin, coinM, richtung, unten, oben, anzahl, art, hebel, einsatz, startKurs, start, kurs }
 */
export function planBot(e) {
    if (e.spot) return planSpotBot(e)
    const coinM = !!e.coinM
    const art = e.art === 'geometric' ? 'geometric' : 'arithmetic'
    const iu = coinM ? 1 / e.oben : e.unten, io = coinM ? 1 / e.unten : e.oben
    const trend = trendFuer(e.richtung, coinM)
    const startInst = coinM ? 1 / e.startKurs : e.startKurs
    const q = mengeJeGrid({ L: gridLinien(iu, io, e.anzahl, art), trend, start: startInst, einsatz: e.einsatz, hebel: e.hebel })
    const d = {
        top: String(io), bottom: String(iu), row: e.anzahl, gridType: art, trend,
        leverage: String(e.hebel), quoteInvestment: String(e.einsatz), initQuoteInvestment: String(e.einsatz),
        perVolume: q != null ? String(q) : '', status: 'plan', initPrice: String(startInst),
        ...(coinM
            ? { cateType: 'FUTURE_GRID_COIN_MARGINED', investCoin: e.coin, uiExtraData: '{"mode":"coin_margin","custom_type":"normal"}' }
            : { investCoin: 'USDT', usdtInvestment: String(e.einsatz), initUsdtInvestment: String(e.einsatz) }),
    }
    const o = {
        buOrderId: PLAN_ID, buOrderType: 'futures_grid', createTime: e.start ?? Date.now(),
        base: coinM ? 'USDT.PERP' : `${e.coin}.PERP`, quote: coinM ? e.coin : 'USDT', buOrderData: d,
    }
    const b = normalisiereBot(o)
    b.plan = true
    b.laufend = false
    b.kurs = e.kurs ?? null
    b.name = null
    return b
}

/** Ein Spot-Grid-Plan als Bot (Form von normalisiereBot): kein Hebel, keine Liquidation, Einsatz in USDT. */
function planSpotBot(e) {
    const art = e.art === 'geometric' ? 'geometric' : 'arithmetic'
    const q = mengeJeGrid({ L: gridLinien(e.unten, e.oben, e.anzahl, art), trend: 'long', start: e.startKurs, einsatz: e.einsatz, hebel: 1, reserve: SPOT_RESERVE })
    const d = {
        top: String(e.oben), bottom: String(e.unten), row: e.anzahl, gridType: art, trend: 'long',
        quoteTotalInvestment: String(e.einsatz), quoteInvestment: String(e.einsatz), initQuoteInvestment: String(e.einsatz),
        perVolume: q != null ? String(q) : '', status: 'plan', initPrice: String(e.startKurs),
    }
    const b = normalisiereBot({ buOrderId: PLAN_ID, buOrderType: 'spot_grid', createTime: e.start ?? Date.now(), base: e.coin, quote: 'USDT', buOrderData: d })
    b.plan = true
    b.laufend = false
    b.kurs = e.kurs ?? null
    b.name = null
    b.hebel = 1
    return b
}

/**
 * Eingabe des Planers prüfen. `coins` = Map coin → {linear, coinM} (aus der Symboltabelle).
 * `alle`: „ALLE" als Richtung zulassen (nur zum Rechnen; ein Start hat immer eine Richtung).
 */
export function pruefePlanEingabe(e, coins = null, { alle = false } = {}) {
    const coin = String(e?.coin || '').trim().toUpperCase()
    if (!/^[A-Z0-9]{1,15}$/.test(coin)) return { fehler: 'coin' }
    // Spot-Grid: ohne Hebel und nur „Long" (kauft beim Start die Coin für die Linien über dem Kurs)
    const spot = e?.spot === true || e?.spot === 'true'
    const coinM = !spot && e?.coinM === true
    if (coins) {
        const c = coins.get(coin)
        if (!c || !(spot ? c.spot : coinM ? c.coinM : c.linear)) return { fehler: 'coinNichtHandelbar' }
    }
    let richtung = String(e?.richtung || '').toUpperCase()
    if (!RICHTUNGEN.includes(richtung) && !(alle && richtung === ALLE)) return { fehler: 'richtung' }
    if (spot) richtung = 'LONG'
    const einsatz = zahlAus(e?.einsatz)
    if (!istZahl(einsatz) || einsatz <= 0) return { fehler: 'einsatz' }
    const hebel = spot ? 1 : zahlAus(e?.hebel)
    if (!Number.isInteger(hebel) || hebel < 1 || hebel > MAX_HEBEL) return { fehler: 'hebel' }
    const tage = Number(e?.tage ?? 30)
    if (!PLAN_TAGE.includes(tage)) return { fehler: 'tage' }
    return { coin, coinM, spot, richtung, einsatz, hebel, tage }
}

/** Eine Band-Variante prüfen (eigene Eingabe oder Übernahme). Preise USD. */
export function pruefePlanVariante(v, kurs, richtung, { spot = false } = {}) {
    const unten = zahlAus(v?.unten), oben = zahlAus(v?.oben), anzahl = zahlAus(v?.anzahl)
    if (!istZahl(unten) || !istZahl(oben) || unten <= 0 || oben <= unten) return { fehler: 'band' }
    if (istZahl(kurs) && kurs > 0) {
        if (oben < kurs / 5 || unten > kurs * 5) return { fehler: 'weitWeg' }
        if (!(unten < kurs && kurs < oben)) return { fehler: 'kursAusserhalb' }
    }
    if (!Number.isInteger(anzahl) || anzahl < 2 || anzahl > (spot ? SPOT_MAX_GRIDS : MAX_PLAN_GRIDS)) return { fehler: 'anzahl' }
    const aus = { unten, oben, anzahl, art: v?.art === 'geometric' ? 'geometric' : 'arithmetic' }
    const sl = zahlAus(v?.stopLoss), tp = zahlAus(v?.takeProfit)
    if (Number.isNaN(sl) || Number.isNaN(tp)) return { fehler: Number.isNaN(sl) ? 'stopLoss' : 'takeProfit' }
    if (sl != null || tp != null) {
        if (spot) return { fehler: 'spotStop' }
        if (richtung === 'NEUTRAL') return { fehler: 'neutralStop' }
        const long = richtung === 'LONG'
        if (sl != null && (sl <= 0 || (istZahl(kurs) && (long ? sl >= kurs : sl <= kurs)))) return { fehler: 'stopLoss' }
        if (tp != null && (tp <= 0 || (istZahl(kurs) && (long ? tp <= kurs : tp >= kurs)))) return { fehler: 'takeProfit' }
        if (sl != null) aus.stopLoss = sl
        if (tp != null) aus.takeProfit = tp
    }
    return aus
}

/** Anzahl Grids für einen Abstand `schritt` (Anteil) im Band. */
export function anzahlFuerSchritt(unten, oben, schritt, art = 'arithmetic') {
    if (!(unten > 0) || !(oben > unten) || !(schritt > 0)) return null
    const n = art === 'geometric' ? Math.log(oben / unten) / Math.log(1 + schritt) : (oben - unten) / (schritt * (oben + unten) / 2)
    return Math.max(2, Math.min(MAX_PLAN_GRIDS, Math.round(n)))
}

/**
 * Volumenprofile der Seitwärtsphasen auf dem Wochenchart (rein), so wie man sie
 * von Hand als Fixed-Range-Profil setzt. Die Phasensuche der Chart-KI ist auf
 * kurze Zeiteinheiten eingestellt und fand auf 1w nichts (dann ein Profil über
 * fünf Jahre). Mit 5 Wochen-ATR Bandbreite und mindestens 12 Wochen traf sie am
 * 14.11.2026 auf BTC genau die Phase 19.02.–04.11.2024 (POC 63 585, VAL 58 458).
 * @returns Liste im Format von baueKandidaten: {id, quelle:'volumenprofil', name, preis, t1, t2}
 */
export const WOCHEN_PHASE = { breite: 5, minKerzen: 12, max: 5 }
export function wochenProfile(woche) {
    if (!Array.isArray(woche) || woche.length < 30) return []
    const a = atrReihe(woche, 14), A = a[a.length - 1]
    if (!istZahl(A) || A <= 0) return []
    const aus = []
    const phasen = konsolidierungen(woche, A, WOCHEN_PHASE).sort((x, y) => y.bis - x.bis)
    for (const ph of phasen) {
        const vp = volumenprofil(woche.slice(ph.von, ph.bis + 1), { zeilen: 48 })
        if (!vp) continue
        for (const [name, preis] of [['VAL', vp.val], ['POC', vp.poc], ['VAH', vp.vah]]) {
            aus.push({ id: `V${aus.length + 1}`, quelle: 'volumenprofil', name, preis, t1: woche[ph.von].t, t2: woche[ph.bis].t })
        }
    }
    return aus
}

/**
 * Waagerechte Niveaus aus dem Chart (rein): Volumenprofile der Seitwärtsphasen
 * (POC/VAH/VAL, `paket.kandidaten` quelle volumenprofil) und die eigenen
 * Zeichnungen (`paket.nutzer`: Linien, Zonen-Kanten, eigene Volumenprofile).
 * Je Seite des Kurses die nächsten `max`; eigene Zeichnungen zuerst.
 * @param paket baueKandidaten(...) auf Wochenkerzen
 */
export function chartNiveaus(paket, kurs, { max = 4 } = {}) {
    if (!paket || !istZahl(kurs)) return []
    const liste = []
    const dazu = (id, quelle, name, preis, zusatz = {}) => { if (istZahl(preis) && preis > 0) liste.push({ id, quelle, name, preis: runde(preis, 6), ...zusatz }) }
    for (const u of paket.nutzer || []) {
        // Beschriftung der Zeichnung geht in Titel und KI-Prompt: auf eine Zeile, ohne Spaltentrenner und
        // Steuerzeichen, ohne Ziffern (sonst gälte eine Zahl aus dem Text als «vom Code gemessen»; übernommene
        // KI-Zeichnungen tragen Beschriftungen, die nicht vom Nutzer stammen — Audit PLN-12)
        const roh = String(u.text || '').replace(/[\u0000-\u001f\u007f|]+/g, ' ').replace(/\d+([.,']\d+)*/g, '').replace(/\s+/g, ' ').trim().slice(0, 40)
        const text = roh ? ` „${roh}"` : ''
        if (u.typ === 'volprofil' && istZahl(u.poc)) {
            dazu(`${u.id}-VAL`, 'zeichnung', `VAL deines Volumenprofils${text}`, u.val)
            dazu(`${u.id}-POC`, 'zeichnung', `POC deines Volumenprofils${text}`, u.poc)
            dazu(`${u.id}-VAH`, 'zeichnung', `VAH deines Volumenprofils${text}`, u.vah)
        } else if (u.typ === 'rechteck' && istZahl(u.tief)) {
            dazu(`${u.id}-u`, 'zeichnung', `Unterkante deiner Zone${text}`, u.tief)
            dazu(`${u.id}-o`, 'zeichnung', `Oberkante deiner Zone${text}`, u.hoch)
        } else if (['horizontale', 'strahlH'].includes(u.typ) && istZahl(u.preis)) {
            dazu(u.id, 'zeichnung', `deine Linie${text}`, u.preis)
        }
    }
    for (const k of paket.kandidaten || []) {
        if (k.quelle !== 'volumenprofil') continue
        const tag = (t) => { if (!istZahl(t)) return '?'; const [j, m, d] = new Date(t).toISOString().slice(0, 10).split('-'); return `${d}.${m}.${j.slice(2)}` }
        dazu(k.id, 'profil', `${k.name} 1w-Profil ${tag(k.t1)}–${tag(k.t2)}`, k.preis)
    }
    // Doppelte (fast gleicher Preis) nur einmal, die eigene Zeichnung gewinnt
    const eindeutig = []
    for (const n of liste) if (!eindeutig.some((m) => Math.abs(m.preis - n.preis) / kurs < 0.003)) eindeutig.push(n)
    const seite = (unter) => eindeutig.filter((n) => (unter ? n.preis < kurs : n.preis > kurs))
        .sort((a, b) => (a.quelle === b.quelle ? Math.abs(a.preis - kurs) - Math.abs(b.preis - kurs) : a.quelle === 'zeichnung' ? -1 : 1))
        .slice(0, max)
    return [...seite(true), ...seite(false)].sort((a, b) => a.preis - b.preis)
}

/**
 * Kandidaten aus der Lage (rein). Preise USD je Coin.
 * Bänder um den Kurs in Tages-ATR und an gemessenen Niveaus; je zwei Dichten.
 */
export function planKandidaten({ kurs, atr, zr = null, richtung, chart = [], ohneStop = false }) {
    if (!istZahl(kurs) || kurs <= 0 || !istZahl(atr) || atr <= 0) return []
    const a = atr
    const long = richtung === 'LONG', neutral = richtung === 'NEUTRAL'
    const baender = []
    // `stufe` (eng | mittel | breit | lang | chart | niveaus) sagt der Oberfläche, was für ein Band es ist
    const band = (titel, u, o, lang = false, stufe = lang ? 'lang' : 'niveaus') => {
        if (!(u > 0) || !(o > u) || !(u < kurs && kurs < o)) return
        // Fast gleiche Bänder nur einmal
        if (baender.some((b) => Math.abs(b.unten - u) < 0.5 * a && Math.abs(b.oben - o) < 0.5 * a)) return
        baender.push({ titel, unten: runde(u, 5), oben: runde(o, 5), lang, stufe })
    }
    // Abstände in Tages-ATR unter/über dem Kurs; gerichtet mehr Raum in Gewinnrichtung.
    // Im Testcontainer 11.11.2026 gegen SOL/BTC/ETH: 4/6 und 14 ATR ergaben bei 5 % ATR
    // „eng" ±25 % und „breit" −70 % — zu weit für das, was die Namen sagen.
    // Short bekommt GEGEN die Richtung mehr Platz als Long (nachgemessen 17.11.2026: BTC/ETH/SOL, 393
    // Starts über 90 Tage, 3x): gespiegelt (4/3, 8/6, 12/10) wurden 24 / 22 / 16 % der Short-Bots
    // liquidiert, mit 4/6, 6/12, 10/20 noch 18 / 10 / 3 %, bei besserem Mittel. Kurse steigen
    // seltener stark als sie fallen, dann aber weiter.
    const um = neutral
        ? [['eng', 4, 4], ['mittel', 7, 7], ['breit', 11, 11]]
        : long ? [['eng', 3, 4], ['mittel', 6, 8], ['breit', 10, 12]] : [['eng', 4, 6], ['mittel', 6, 12], ['breit', 10, 20]]
    for (const [name, unter, ueber] of um) band(`Band ${name} um den Kurs`, kurs - unter * a, kurs + ueber * a, false, name)
    // Langfrist (14.11.2026, Wunsch des Entwicklers): ein Bot soll Schwankungen abernten und
    // nicht beim ersten Rücksetzer unter ein enges Band ausgestoppt werden. Breites Band von
    // einer tiefen Unterstützung (≥ 8 % unter dem Kurs: Chart-Niveaus, Wochen-Niveaus) bis
    // +40 % bzw. zum nächsten grossen Widerstand; geometrisch, weil die Prozentabstände über
    // so eine Spanne sonst unten doppelt so gross wären wie oben. Gerichtet ohne Stop und mit
    // einer Notbremse knapp vor der Liquidation (rechnePlan, `stopNahLiq`).
    // Titel nennen, was das Band wirklich ist: «−35 % bis +25 %» stand auch über 50–125 (Audit PLN-11)
    const vomKurs = (x) => `${x >= kurs ? '+' : '−'}${Math.round(Math.abs(x / kurs - 1) * 100)} %`
    const tiefe = [...(chart || []), ...((zr?.marken || []).filter((m) => m.tf === '1w').map((m) => ({ name: `${m.id} (1w)`, preis: m.preis })))]
    const unterstuetzung = tiefe.filter((n) => n.preis < kurs * LANG.abstand_min_unten).sort((x, y) => y.preis - x.preis)
    const widerstand = tiefe.filter((n) => n.preis > kurs * LANG.abstand_min_oben).sort((x, y) => x.preis - y.preis)
    const grossOben = (max) => widerstand.filter((n) => n.preis <= kurs * max).at(-1)
    if (long) {
        const ziele = unterstuetzung.slice(0, 2)
        const o = Math.max(kurs * LANG.oben, (grossOben(LANG.oben_max)?.preis ?? 0) + 0.5 * a)
        for (const nu of ziele) band(`Langfrist ab ${nu.name}`, nu.preis - 0.5 * a, o, true)
        if (!ziele.length) band(`Langfrist ${vomKurs(kurs * 0.75)} bis ${vomKurs(o)}`, kurs * 0.75, o, true)
    } else if (neutral) {
        const u = unterstuetzung[0] ? unterstuetzung[0].preis - 0.5 * a : kurs * 0.75
        const o = widerstand[0] ? widerstand[0].preis + 0.5 * a : kurs * 1.3
        band(`Langfrist ${unterstuetzung[0]?.name || vomKurs(u)} bis ${widerstand[0]?.name || vomKurs(Math.max(o, kurs * 1.15))}`, u, Math.max(o, kurs * 1.15), true)
    } else {
        const ziele = widerstand.slice(0, 2)
        const tiefst = unterstuetzung.filter((n) => n.preis >= kurs * 0.5).at(-1)
        const u = Math.min(kurs * 0.65, tiefst ? tiefst.preis - 0.5 * a : Infinity)
        for (const no of ziele) band(`Langfrist bis ${no.name}`, u, no.preis + 0.5 * a, true)
        if (!ziele.length) band(`Langfrist ${vomKurs(u)} bis ${vomKurs(kurs * 1.25)}`, u, kurs * 1.25, true)
    }
    // An Chart-Niveaus (Volumenprofile 1w, eigene Zeichnungen): Long mit der Untergrenze knapp
    // unter einer Unterstützung (der Stop-Loss liegt dann 1 Tages-ATR unter der Grenze, also
    // deutlich unter dem Niveau), Short spiegelbildlich, Neutral zwischen zwei Niveaus.
    const cu = (chart || []).filter((n) => n.preis < kurs).sort((x, y) => y.preis - x.preis).slice(0, 3)
    const co = (chart || []).filter((n) => n.preis > kurs).sort((x, y) => x.preis - y.preis).slice(0, 3)
    if (neutral) {
        for (const nu of cu.slice(0, 2)) for (const no of co.slice(0, 2)) if (no.preis - nu.preis >= 3 * a) band(`Band Chart ${nu.name} bis ${no.name}`, nu.preis - 0.5 * a, no.preis + 0.5 * a, false, 'chart')
    } else if (long) {
        for (const nu of cu) band(`Band ab Chart ${nu.name}`, nu.preis - 0.5 * a, Math.max(kurs + 6 * a, (co[0]?.preis ?? 0) + 0.5 * a), false, 'chart')
    } else {
        for (const no of co) band(`Band bis Chart ${no.name}`, Math.min(kurs - 6 * a, (cu[0]?.preis ?? Infinity) - 0.5 * a), no.preis + 0.5 * a, false, 'chart')
    }
    // An Niveaus der hohen Zeitrahmen: Grenzen ½ Tages-ATR jenseits, mindestens 3 ATR breit
    const nv = niveausAusZeitrahmen(zr, kurs)
    for (const nu of nv.unten) for (const no of nv.oben) {
        const u = nu.preis - 0.5 * a, o = no.preis + 0.5 * a
        if (o - u >= 3 * a) band(`Band an Niveaus ${nu.name} bis ${no.name}`, u, o)
    }

    const liste = []
    const neu = (b, titel, variante, zusatz = {}) => { if (liste.length < MAX_KANDIDATEN) liste.push({ id: `P${liste.length + 1}`, titel, stufe: b.stufe, variante, ...zusatz }) }
    const atrAnteil = a / kurs
    // EINE Dichte je Band: ¼ Tages-ATR, mindestens 0,6 %. Nachgemessen 17.11.2026 (Long-Band 6/8 ATR, 3x,
    // Median über 90 Tage): Abstand 0,15 % −0,7 %, 0,3 % +7,0 %, 0,5 % +8,9 %, 1 % +10,2 %, 3 % +10,8 % des
    // Einsatzes — unter etwa 0,5 % fressen Gebühren und Durchstich den Zyklus, darüber ist die Anzahl fast
    // egal. Die frühere zweite Variante «dichte Grids» (0,1 ATR, min 0,25 %) kostete 1–3 Prozentpunkte.
    const schritt = Math.max(0.006, 0.25 * atrAnteil)
    // Long und Neutral geometrisch, Short arithmetisch (gleiche Messung): geometrisch senkte bei Long die
    // Liquidationen (6/8: 11,5 → 9,2 %, 15/30: 15,3 → 4,1 %) bei gleichem Mittel, bei Short hob es sie
    // (8/6: 21,9 → 23,4 %, 30/15: 13,7 → 22,6 %).
    const art = richtung === 'SHORT' ? 'arithmetic' : 'geometric'
    for (const b of baender) {
        const anzahl = anzahlFuerSchritt(b.unten, b.oben, schritt, art)
        if (anzahl == null) continue
        if (b.lang) {
            // Langfrist: gerichtet zusätzlich mit Notbremse vor der Liquidation
            neu(b, `${b.titel}, weite Grids, ohne Stop`, { unten: b.unten, oben: b.oben, anzahl, art })
            if (!neutral && !ohneStop) neu(b, `${b.titel}, weite Grids, Notbremse vor der Liquidation`, { unten: b.unten, oben: b.oben, anzahl, art }, { stopNahLiq: true })
            continue
        }
        neu(b, b.titel, { unten: b.unten, oben: b.oben, anzahl, art })
        // Gerichtet: dieselbe Variante mit Stop-Loss 1 Tages-ATR jenseits der Gegengrenze
        if (!neutral && !ohneStop) {
            const sl = long ? b.unten - a : b.oben + a
            if (sl > 0) neu(b, `${b.titel}, Stop-Loss ${runde(sl, 4)}`, { unten: b.unten, oben: b.oben, anzahl, art, stopLoss: runde(sl, 5) })
        }
    }
    return liste
}

// ── Langfristiger Trend ──────────────────────────────────────────────────
const schnitt = (werte, n) => (werte.length >= n ? werte.slice(-n).reduce((s, v) => s + v, 0) / n : null)

/**
 * Langfristiger Trend aus Wochen- und Tageskerzen (rein). Vier Zeichen, jedes
 * mit Gewicht; fehlt eines (junger Coin), zählt es nicht:
 *   - Struktur 1w (höhere Hochs/Tiefs bzw. tiefere)          ±2
 *   - Struktur 1d                                           ±1
 *   - Kurs über/unter dem 200-Tage-Schnitt                  ±1
 *   - 50-Tage- über/unter dem 200-Tage-Schnitt              ±1
 * Summe ≥ 2 → aufwärts, ≤ −2 → abwärts, sonst seitwärts. Daraus die Richtung,
 * die zum Trend passt: aufwärts Long, abwärts Short, seitwärts Neutral.
 * @param zr        hoheZeitrahmen(...) (zeilen mit tf/zustand)
 * @param tagKerzen geschlossene 1d-Kerzen, aufsteigend ({c})
 */
export function langfristTrend({ zr = null, tagKerzen = [], kurs = null } = {}) {
    const zeichen = []
    const zeile = (tf) => zr?.zeilen?.find((z) => z.tf === tf && !z.unbekannt)
    const w = zeile('1w'), d = zeile('1d')
    if (w && istZahl(w.zustand)) zeichen.push({ id: 'struktur1w', wert: Math.sign(w.zustand), gewicht: 2 })
    if (d && istZahl(d.zustand)) zeichen.push({ id: 'struktur1d', wert: Math.sign(d.zustand), gewicht: 1 })
    const schluss = (tagKerzen || []).map((k) => k?.c).filter(istZahl)
    const p = istZahl(kurs) ? kurs : schluss.at(-1)
    const s200 = schnitt(schluss, 200), s50 = schnitt(schluss, 50)
    if (istZahl(s200) && istZahl(p)) zeichen.push({ id: 'kursSma200', wert: p > s200 ? 1 : p < s200 ? -1 : 0, gewicht: 1, sma200: runde(s200, 6), abstand: p / s200 - 1 })
    if (istZahl(s200) && istZahl(s50)) zeichen.push({ id: 'sma50Sma200', wert: s50 > s200 ? 1 : s50 < s200 ? -1 : 0, gewicht: 1, sma50: runde(s50, 6) })
    if (!zeichen.length) return null
    const punkte = zeichen.reduce((s, z) => s + z.wert * z.gewicht, 0)
    const max = zeichen.reduce((s, z) => s + z.gewicht, 0)
    const richtung = punkte >= 2 ? 'auf' : punkte <= -2 ? 'ab' : 'seitwaerts'
    return { richtung, punkte, max, passend: richtung === 'auf' ? 'LONG' : richtung === 'ab' ? 'SHORT' : 'NEUTRAL', zeichen }
}

/** Läuft die Richtung gegen den langfristigen Trend? Neutral nie. */
export function gegenTrend(trend, richtung) {
    if (!trend) return false
    return (richtung === 'LONG' && trend.richtung === 'ab') || (richtung === 'SHORT' && trend.richtung === 'auf')
}

/**
 * Kandidaten für alle drei Richtungen (rein). Die zum Trend passende Richtung
 * zuerst; IDs mit Buchstaben der Richtung (L1, S1, N1), jeder trägt seine Richtung.
 */
export function planKandidatenAlle({ kurs, atr, zr = null, trend = null, chart = [] }) {
    const reihe = trend ? [trend.passend, ...RICHTUNGEN.filter((r) => r !== trend.passend)] : RICHTUNGEN
    const liste = []
    for (const richtung of reihe) {
        for (const [i, c] of planKandidaten({ kurs, atr, zr, richtung, chart }).entries()) {
            liste.push({ ...c, id: `${richtung[0]}${i + 1}`, richtung })
        }
    }
    return liste
}

/** Gebühren für einen neuen Bot: Grid-Orders Maker, Start/Schluss Taker (Spot oder Futures). */
export function planGebuehren(spot = false) {
    const g = spot ? GEBUEHREN.spot : GEBUEHREN.futures
    return { gebuehr: g.maker, gebuehrMarkt: g.taker }
}

function kurz(r) {
    if (!r) return null
    return {
        gesamt: r.gesamt, gridGewinn: r.gridGewinn, realisiert: r.realisiert, schwebend: r.schwebend,
        gebuehren: r.gebuehren, funding: r.funding, zyklen: r.zyklen, position: r.position, maxVerlust: r.maxVerlust,
        zeitImBand: r.zeitImBand, liquidation: r.liquidation, ausstieg: r.ausstieg, menge: r.menge,
        startPreis: r.startPreis, endPreis: r.endPreis,
        kurve: (r.kurve || []).filter((_, i, a) => i % Math.max(1, Math.ceil(a.length / 200)) === 0 || i === a.length - 1),
    }
}

/** Einsatz, mit dem SINNVOLLE_GRIDS Grids im Band der Variante gerade die Mindestmenge erreichen (rein). */
export function einsatzFuerGrids(e, v, kurs, minMenge) {
    if (!istZahl(minMenge) || minMenge <= 0 || !istZahl(kurs) || kurs <= 0) return null
    const q = planBot({ ...e, ...v, anzahl: SINNVOLLE_GRIDS, startKurs: kurs, kurs }).grid.mengeJeGrid
    return istZahl(q) && q > 0 ? Number((e.einsatz * minMenge / q * 1.001).toPrecision(4)) : null
}

/**
 * Einen Kandidaten rechnen: Start heute (Menge, Position, Liquidation) und der
 * relative Rückblick über `kerzen` (USD, aufsteigend). Rein.
 * @param e  geprüfte Eingabe (pruefePlanEingabe)
 * @param v  Variante {unten, oben, anzahl, art, stopLoss?, takeProfit?}
 * @param opt { kurs, funding, mmr, minMenge }
 */
export function rechnePlanVariante(e, v, kerzen, { kurs, funding = null, mmr = MMR_VORGABE, minMenge = null } = {}) {
    const geb = planGebuehren(!!e.spot)
    const warnungen = []
    let anzahl = v.anzahl
    if (e.spot && anzahl > SPOT_MAX_GRIDS) { anzahl = SPOT_MAX_GRIDS; warnungen.push('spotMax') }
    // Pionex verlangt eine Mindestmenge je Order: zu viele Grids für den Einsatz → weniger Grids
    if (istZahl(minMenge) && minMenge > 0) {
        // Nach dem Kürzen verschieben sich die Linien und damit die Menge je Grid — ein Schritt reichte in
        // 30 von 495 Fällen nicht (bis 3,3 % unter der Mindestmenge, Audit PLN-06). Darum nachmessen.
        let gekuerzt = false
        for (let i = 0; i < 12; i++) {
            const q = planBot({ ...e, ...v, anzahl, startKurs: kurs, kurs }).grid.mengeJeGrid
            if (!istZahl(q) || q >= minMenge) break
            const neu = Math.min(anzahl - 1, Math.floor(anzahl * q / minMenge))
            if (neu < 2) return { fehler: 'einsatzZuKlein' }
            anzahl = neu
            gekuerzt = true
        }
        if (gekuerzt) {
            const q = planBot({ ...e, ...v, anzahl, startKurs: kurs, kurs }).grid.mengeJeGrid
            if (istZahl(q) && q < minMenge) return { fehler: 'einsatzZuKlein' }
            warnungen.push('gridsGekuerzt')
        }
    }
    const variante = { ...v, anzahl }
    const heute = planBot({ ...e, ...variante, startKurs: kurs, kurs })
    const jetzt = [{ t: Date.now(), o: kurs, h: kurs, l: kurs, c: kurs }]
    const probe = simuliereBot(heute, jetzt, { ...geb, mmr, startPreis: kurs })
    // Spot: kein Hebel, keine Liquidation
    const liq = probe && !e.spot ? liqRisiko(e.richtung, probe.liqSchaetzung, kurs) : null
    const liqAbstand = istZahl(liq) ? Math.abs(kurs - liq) / kurs : null
    const imBand = (l) => istZahl(l) && (e.richtung === 'LONG' ? l > variante.unten : e.richtung === 'SHORT' ? l < variante.oben : (l > variante.unten && l < variante.oben))
    // Liquidation im Band: der höchste Hebel, mit dem sie ausserhalb bleibt (17.11.2026: BTC Long «breit» mit
    // 10x zeigte die Liquidation 17 % unter dem Kurs bei einer Untergrenze 41 % darunter — das Band passt
    // nicht zum Hebel, und die Karte sagte nicht, welcher passen würde). Der Abstand zur Liquidation wächst
    // mit sinkendem Hebel, darum Halbieren. Die Zahl der Grids bleibt dabei die dieser Variante.
    let hebelPassend = null
    if (imBand(liq)) {
        warnungen.push('liqImBand')
        const liqBei = (hebel) => {
            const b = planBot({ ...e, ...variante, hebel, startKurs: kurs, kurs })
            const p = simuliereBot(b, jetzt, { ...geb, mmr, startPreis: kurs })
            return p ? liqRisiko(e.richtung, p.liqSchaetzung, kurs) : null
        }
        let lo = 1, hi = e.hebel - 1
        if (hi >= 1 && !imBand(liqBei(1))) {
            while (lo < hi) { const m = Math.ceil((lo + hi) / 2); if (imBand(liqBei(m))) hi = m - 1; else lo = m }
            hebelPassend = lo
        }
    }
    if (istZahl(liqAbstand) && liqAbstand < 0.1) warnungen.push('liqNah')
    if (istZahl(variante.stopLoss) && istZahl(liq) && (e.richtung === 'LONG' ? variante.stopLoss <= liq : variante.stopLoss >= liq)) warnungen.push('stopHinterLiq')
    if (istZahl(heute.grid.nettoJeZyklus) && heute.grid.nettoJeZyklus <= 0) warnungen.push('gebuehrFrisst')
    // Enger als ABSTAND_ENG: gemessen kostet das gegenüber 1 % Abstand mehrere Prozentpunkte im Quartal
    else if (istZahl(heute.grid.abstand?.mitte) && heute.grid.abstand.mitte < ABSTAND_ENG) warnungen.push('abstandEng')
    // Was es kostet, wenn der Kurs ohne Umweg zur Gefahren-Kante läuft: Long nach unten (bis
    // zur Unterkante, mit Stop bis zum Stop), Short nach oben, Neutral das Schlechtere beider.
    // Ein Weg von heute aus, mit Gebühren, ohne Funding — Grössenordnung, keine Vorhersage.
    const stops = {}
    if (istZahl(variante.stopLoss)) stops.stopLoss = variante.stopLoss
    const wegNach = (ziel) => {
        const k = [{ t: Date.now(), o: kurs, h: Math.max(kurs, ziel), l: Math.min(kurs, ziel), c: ziel }]
        const r = simuliereBot(heute, k, { ...geb, mmr, startPreis: kurs, aenderung: stops })
        return r ? { preis: runde(ziel, 6), betrag: r.gesamt, liquidiert: !!r.liquidation, ausstieg: r.ausstieg?.art || null } : null
    }
    const sl = variante.stopLoss
    const runter = wegNach(istZahl(sl) && e.richtung === 'LONG' ? sl * 0.995 : variante.unten)
    const rauf = wegNach(istZahl(sl) && e.richtung === 'SHORT' ? sl * 1.005 : variante.oben)
    const verlustRand = e.richtung === 'LONG' ? runter : e.richtung === 'SHORT' ? rauf
        : [runter, rauf].filter(Boolean).sort((x, y) => x.betrag - y.betrag)[0] || null
    const start = {
        menge: heute.grid.mengeJeGrid, position: probe?.position ?? null, liq, liqAbstand, hebelPassend,
        // Startposition in USD, Vorzeichen = Richtung der Coin (Coin-M: Instrument „USDT in Coin" invers)
        nominalUsd: istZahl(probe?.position) ? (e.coinM ? -probe.position : probe.position * kurs) : null,
        abstand: heute.grid.abstand, nettoJeZyklus: heute.grid.nettoJeZyklus,
        startGebuehr: probe?.gebuehren ?? null,
        verlustRand,
        // Einsatz, ab dem SINNVOLLE_GRIDS Grids die Mindestmenge von Pionex erreichen (Menge je Grid ist linear im Einsatz)
        einsatzFuerGrids: einsatzFuerGrids(e, variante, kurs, minMenge),
    }

    // Rückblick relativ zum Kurs: Band, Stops in Prozent um den Kurs, gestartet beim ersten Kerzenkurs
    let rueckblick = null
    if (kerzen?.length) {
        const k0 = kerzen[0].o
        const f = k0 / kurs
        const alt = planBot({ ...e, ...variante, unten: variante.unten * f, oben: variante.oben * f, startKurs: k0, start: kerzen[0].t })
        const aenderung = {}
        if (istZahl(variante.stopLoss)) aenderung.stopLoss = variante.stopLoss * f
        if (istZahl(variante.takeProfit)) aenderung.takeProfit = variante.takeProfit * f
        rueckblick = kurz(simuliereBot(alt, kerzen, { ...geb, mmr, funding, durchstich: DURCHSTICH, startPreis: k0, aenderung }))
        if (rueckblick) rueckblick.faktor = f
    }
    return { variante, start, rueckblick, warnungen }
}

/**
 * Alle Kandidaten (und eigene Varianten) rechnen. Ein Kandidat mit eigener
 * `richtung` (Modus ALLE) rechnet in dieser, sonst in der der Eingabe.
 * `opt.trend` (langfristTrend) markiert Varianten gegen den Trend.
 */
export function rechnePlan(e, kerzen, liste, opt = {}) {
    const aus = []
    const gesehen = new Set()
    for (let c of liste) {
        const richtung = RICHTUNGEN.includes(c.richtung) ? c.richtung : e.richtung
        let r = rechnePlanVariante({ ...e, richtung }, c.variante, kerzen, opt)
        // Notbremse: Stop-Loss knapp VOR der Liquidation dieser Variante (nicht am Band) — greift nur,
        // wenn der Bot sonst ohnehin den ganzen Einsatz verlöre. Ohne Liquidation (Spot, 1x) keine.
        if (c.stopNahLiq) {
            const liq = r.start?.liq
            if (!istZahl(liq) || !(richtung === 'LONG' ? liq < c.variante.unten : liq > c.variante.oben)) continue
            const sl = runde(notbremsePreis(richtung, liq, c.variante), 5)
            r = rechnePlanVariante({ ...e, richtung }, { ...c.variante, stopLoss: sl }, kerzen, opt)
            c = { ...c, titel: `${c.titel} (Stop-Loss ${runde(sl, 4)})` }
        }
        if (r.fehler) { aus.push({ ...c, richtung, fehler: r.fehler }); continue }
        if (gegenTrend(opt.trend, richtung)) r.warnungen.push('gegenTrend')
        // Nach dem Kürzen auf die Mindestmenge können Varianten gleich werden — nur einmal zeigen
        const v = r.variante
        const schluessel = [richtung, v.unten, v.oben, v.anzahl, v.art, v.stopLoss ?? '', v.takeProfit ?? ''].join('|')
        if (gesehen.has(schluessel)) continue
        gesehen.add(schluessel)
        // `abJetzt` trägt „Start heute" für die gemeinsame KI-Prüfung (pruefeKiAntwort)
        aus.push({ ...c, richtung, variante: r.variante, start: r.start, abJetzt: r.start, rueckblick: r.rueckblick, warnungen: r.warnungen })
    }
    return aus
}

// ── KI ───────────────────────────────────────────────────────────────────
const pz = (v, s = 1) => (istZahl(v) ? `${(v * 100).toFixed(s)} %` : '—')
const zl = (v, s = 4) => (istZahl(v) ? Number(v).toFixed(s) : '—')
/**
 * Betrag in der Margin-Münze für den Prompt. USDT: feste Stellen. Coin-M: vier GÜLTIGE Stellen —
 * 0,000897 BTC stand sonst als «−0.0009», ein Rand von −0,000407 als «−0.00» (Audit PLN-03).
 * `auf: true` rundet auf (Mindesteinsatz: abgerundet läge der abgetippte Betrag darunter).
 */
export function betragImPrompt(v, coinM, { stellen = 4, auf = false } = {}) {
    if (!istZahl(v)) return '—'
    if (!coinM) return auf ? (Math.ceil(v * 10 ** stellen - 1e-9) / 10 ** stellen).toFixed(stellen) : Number(v).toFixed(stellen)
    if (v === 0) return '0'
    const n = Math.min(12, Math.max(stellen, 3 - Math.floor(Math.log10(Math.abs(v)))))
    const f = 10 ** n
    return (auf ? Math.ceil(v * f - 1e-9) / f : Math.round(v * f) / f).toFixed(n)
}

/** Prompt für die Auswahl unter den Plan-Kandidaten. `wissen` = wissenAlsText(typ), `zrText` = Zeitrahmen-Block. */
/** Langfrist-Trend als Promptzeile (rein). */
export function trendText(trend) {
    if (!trend) return 'LANGFRIST-TREND: nicht messbar (zu wenig Kerzen)'
    const namen = { struktur1w: 'Struktur 1w', struktur1d: 'Struktur 1d', kursSma200: 'Kurs vs. 200-Tage-Schnitt', sma50Sma200: '50- vs. 200-Tage-Schnitt' }
    const z = trend.zeichen.map((x) => `${namen[x.id] || x.id} ${x.wert > 0 ? 'auf' : x.wert < 0 ? 'ab' : 'offen'} (×${x.gewicht})${istZahl(x.sma200) ? ` SMA200 ${zl(x.sma200, 2)}` : ''}`).join(', ')
    return `LANGFRIST-TREND (vom Code gemessen): ${trend.richtung === 'auf' ? 'AUFWÄRTS' : trend.richtung === 'ab' ? 'ABWÄRTS' : 'SEITWÄRTS'}, Punkte ${trend.punkte} von ±${trend.max}; dazu passt ${trend.passend}. Zeichen: ${z}`
}

export function bauePlanPrompt(e, { wissen = '', lage = null, zrText = '', kandidaten = [], tf = null, englisch = false, trend = null, chart = [], mindest = {}, von = null, bis = null } = {}) {
    const einheit = e.coinM ? e.coin : 'USDT'
    // Tatsächliche Länge des Rückblicks: bei jungen Coins oder kurzer Pionex-Tiefe kürzer als gewünscht (Audit PLN-09)
    const echt = istZahl(von) && istZahl(bis) && bis > von ? (bis - von) / 86_400_000 : null
    const rueckblickKurz = echt !== null && echt < e.tage * 0.9
    const rueckblickTage = rueckblickKurz ? runde(echt, 1) : e.tage
    const kopf = [
        wissen, '',
        e.spot
            ? `NEUER BOT (Plan, noch nicht gestartet): ${e.coin}/USDT Spot-Grid — kein Hebel, keine Liquidation, kein Funding; kauft beim Start die Coin für die Linien über dem Kurs (wirkt wie Long), gestartet ohne Stop-Loss. Einsatz ${zl(e.einsatz)} USDT`
            : `NEUER BOT (Plan, noch nicht gestartet): ${e.coin} ${e.coinM ? 'Coin-M' : 'USDT-M'} Futures-Grid, Richtung ${e.richtung === ALLE ? 'OFFEN — Long, Short und Neutral werden verglichen' : e.richtung}, Hebel ${e.hebel}x, Einsatz ${betragImPrompt(e.einsatz, !!e.coinM)} ${einheit}`,
        `Kurs ${zl(lage?.kurs)} USD`,
        trendText(trend),
    ]
    const markt = lage ? [`MARKT: 7 Tage ${pz(lage.aenderung7)}, 30 Tage ${pz(lage.aenderung30)}, 30-Tage-Hoch ${zl(lage.hoch30, 2)}, -Tief ${zl(lage.tief30, 2)}, Tagesspanne Median ${pz(lage.spanneMedian)} / max ${pz(lage.spanneMax)}, grösster 7-Tage-Fall ${pz(lage.maxFall7)}, Tages-ATR ${zl(lage.atr, 2)}`] : []
    const bz = (x, st = 4) => betragImPrompt(x, !!e.coinM, { stellen: st })
    const zeilen = kandidaten.filter((c) => !c.fehler).map((c) => {
        const r = c.rueckblick, s = c.start, v = c.variante
        const m = mindest[c.id]
        const pionexMin = !m ? 'nicht geprüft' : m.reichtAus === true ? `reicht (${bz(e.einsatz, 2)} ${einheit})` : istZahl(m.min) ? `ab ${betragImPrompt(m.min, e.coinM, { stellen: e.coinM ? 4 : 2, auf: true })} ${einheit}` : m.reichtAus === false ? 'Einsatz zu klein, Minimum unbekannt' : 'unbekannt'
        const ende = r?.liquidation ? 'LIQUIDIERT' : r?.ausstieg ? r.ausstieg.art : 'läuft'
        return [c.id, c.richtung || e.richtung, c.titel, `${zl(v.unten, 2)}–${zl(v.oben, 2)}`, v.anzahl, pz(s?.nettoJeZyklus, 2), bz(r?.gesamt), pz(istZahl(r?.gesamt) ? r.gesamt / e.einsatz : null), bz(r?.maxVerlust), ende, pz(r?.zeitImBand, 0), r?.zyklen ?? '—', zl(s?.liq, 2), pz(s?.liqAbstand), s?.verlustRand ? `${bz(s.verlustRand.betrag, 2)} bei ${zl(s.verlustRand.preis, 2)}${s.verlustRand.liquidiert ? ' LIQUIDIERT' : s.verlustRand.ausstieg ? ' (Stop)' : ''}` : '—', pionexMin, (c.warnungen || []).join(',') || '—'].join(' | ')
    })
    return [
        ...kopf, ...markt, ...(zrText ? ['', zrText] : []),
        ...(chart.length ? ['', 'CHART-NIVEAUS (vom Code gemessen: Volumenprofile der Seitwärtsphasen auf 1w und die eigenen Zeichnungen des Nutzers; Varianten „Band ab/bis Chart …" sind daran gebaut):', ...chart.map((n) => `${n.id} | ${n.name} | ${zl(n.preis, 2)} | ${n.preis < (lage?.kurs ?? 0) ? 'unter' : 'über'} dem Kurs`)] : []),
        '',
        `KANDIDATEN (vom Code gerechnet). Rückblick = dasselbe Band RELATIV zum Kurs (gleiche Prozente), gestartet vor ${rueckblickTage} Tagen${rueckblickKurz ? ` (gewünscht waren ${e.tage}; so weit reichen die Kerzen nicht zurück — Prozente und Zyklen sind mit einem ${e.tage}-Tage-Rückblick NICHT vergleichbar)` : ''}, simuliert auf ${tf || '?'}-Kerzen mit Gebühren${kandidaten.some((c) => c.rueckblick?.funding) ? ' und Funding' : ''}. Start heute = beim heutigen Kurs gestartet.`,
        `id | Richtung | Beschreibung | Band USD | Grids | netto je Zyklus | Rückblick Ergebnis ${einheit} | in % des Einsatzes | Rückblick grösster Verlust | Rückblick Ende | Zeit im Band | Zyklen | Start heute: Liquidation | Abstand | Weg zur Gefahren-Kante (Ergebnis bei Preis) | Pionex-Mindesteinsatz (von Pionex geprüft) | Warnungen`,
        ...zeilen,
        '',
        englisch ? 'Answer in English.' : 'Antworte auf Deutsch (Schweizer Schreibweise, ss statt ß).',
    ].join('\n')
}

export function planSystemText({ alle = false } = {}) {
    return [
        'Du bist der Bot-Assistent von AutarkTrade. Der Nutzer plant einen NEUEN Pionex-Futures-Grid-Bot und hat dafür ausdrücklich konkrete Vorschläge freigegeben.',
        'Du bekommst Zahlen, die der Code gerechnet hat. Du rechnest NICHT selbst und nennst KEINE Zahl, die nicht in der Eingabe steht.',
        alle
            ? 'Die Richtung ist OFFEN: Die KANDIDATEN enthalten Long (L…), Short (S…) und Neutral (N…). Wähle JE RICHTUNG HÖCHSTENS EINEN — den besten Long, den besten Short, den besten Neutral —, damit der Nutzer die Richtungen nebeneinander sieht und selbst entscheidet. Lass eine Richtung nur weg, wenn dort kein Kandidat vertretbar ist (z. B. alle liquidiert), und sag das im Hinweis. Sag bei jedem, ob er zum LANGFRIST-TREND passt. Bevorzuge Varianten, deren Grenzen und Stop-Loss an gemessenen Niveaus oder CHART-NIVEAUS liegen.'
            : 'Wähle aus den KANDIDATEN höchstens drei und begründe sie mit den Zahlen. Wenn keiner sinnvoll ist (z. B. alle liquidiert oder die Lage passt nicht zur gewählten Richtung), wähle keinen und sag warum.',
        alle
            ? 'Der LANGFRIST-TREND (1w/1d-Struktur, 200-Tage-Schnitt) ist die wichtigste Einordnung: Beim Vorschlag gegen ihn (Warnung gegenTrend) nenne ausdrücklich, dass er gegen den Trend läuft, auf welches Niveau er setzt (z. B. ein CHART-NIVEAU als Unterstützung) und was passiert, wenn es bricht.'
            : 'Der LANGFRIST-TREND (1w/1d-Struktur, 200-Tage-Schnitt) hat Vorrang vor kurzen Bewegungen: Ein Vorschlag gegen ihn (Warnung gegenTrend) braucht eine ausdrückliche Begründung aus den Zahlen und ein klar benanntes Risiko; ein Grid gegen den Trend kann lange gegen sich laufen.',
        'Der Rückblick zeigt nur, wie sich dieselbe Einstellung in den letzten Wochen geschlagen hätte; er sagt nichts über die Zukunft. Gewichte den Liquidationsabstand beim Start heute und den grössten Verlust mindestens so stark wie das Ergebnis.',
        'Beziehe die HOHEN ZEITRAHMEN ein: Struktur und Bruch auf 1w/1d/4h, wo der Kurs in seiner Spanne steht, ob die Bandgrenzen und der Stop-Loss an, über oder unter gemessenen Niveaus (Z…, Zusammentreffen C…, CHART-NIVEAUS V…/U…) liegen und ob die gewählte Richtung zur Struktur passt. Nenne Niveaus nur mit ID und Preis aus der Eingabe.',
        'Varianten „Langfrist …" sind für lange Laufzeit gebaut: breites Band von einer tiefen Unterstützung bis weit nach oben, ohne Stop oder mit einer Notbremse knapp vor der Liquidation statt eines Stops knapp unter dem Band, der schon bei einem normalen Rücksetzer auslöst. „Weg zur Gefahren-Kante" sagt, was es kostet, wenn der Kurs von heute ohne Umweg zur Unterkante (Long), Oberkante (Short) bzw. zum Stop läuft — nenne diese Zahl beim Risiko. Ein Stop knapp unter dem Band beendet einen Grid-Bot oft bei einer normalen Schwankung; sag das, wenn du so eine Variante vorschlägst.',
        'Die Spalte „Pionex-Mindesteinsatz" hat Pionex selbst geprüft. Nenne bei jedem Vorschlag den Mindesteinsatz, wenn er dort steht, und sag klar, wenn der gewählte Einsatz NICHT reicht („ab X") — mit dem gewählten Einsatz lässt sich so ein Vorschlag gar nicht starten. Steht dort „nicht geprüft" oder „unbekannt", sag das statt eine Zahl zu nennen.',
        'Nenne bei jedem Vorschlag das wichtigste Risiko und wann er nicht passt. Kein Gewinnversprechen, keine Kursprognose als Tatsache, nicht „garantiert", nicht „risikolos", nicht „optimal".',
        `Antworte NUR mit JSON: {"lage": "2–4 Sätze zur Lage für diesen Bot", "vorschlaege": [{"id": "${alle ? 'L3' : 'P3'}", "titel": "kurz", "begruendung": "2–3 Sätze", "risiko": "1 Satz", "passtNichtWenn": "1 Satz"}], "hinweis": "optional, 1 Satz"}`,
    ].join('\n')
}

/**
 * Freies Guthaben einer Münze aus Pionex' Kontostand (`balances[] = {coin, free, frozen}`), ABGERUNDET auf
 * die Stellen, die ein Einsatz haben darf (USDT 2, eine Coin 6) — aufgerundet wäre es mehr, als da ist.
 * Nur `free`: was in offenen Orders oder Bots steckt, lässt sich nicht einsetzen. Rein.
 */
export function freiesGuthaben(balances, coin) {
    const c = String(coin || '').toUpperCase()
    if (!c || !Array.isArray(balances)) return null
    const z = balances.find((b) => String(b?.coin || '').toUpperCase() === c)
    const frei = Number(z?.free)
    if (!z || !Number.isFinite(frei) || frei < 0) return z ? null : 0
    const stellen = c === 'USDT' ? 2 : 6
    const f = 10 ** stellen
    return Math.floor(frei * f + 1e-9) / f
}
