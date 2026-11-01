/**
 * Orderflow aus den Kerzen — rein. Grundlage ist `vb`, das Kaufvolumen der
 * Aggressoren, das Binance in jeder Kerze mitliefert (taker buy base volume).
 * Damit gibt es CVD und Delta-Volumen über die ganze Historie und jede
 * Zeiteinheit, ohne eigene Aufzeichnung. Bitunix und Bitget liefern es nicht —
 * dort bleiben die Fenster leer (null), statt aus der Kerzenfarbe zu raten.
 *
 * Dazu die Abschnitte für das Session-Volumenprofil (ein Profil je Tag oder
 * Woche, in UTC oder der Ortszeit).
 */
import { atr, emaSerie, smaSerie } from '../../../shared/indicators.js'

/** Zeitzone eines Parameters: „lokal" = die des Browsers (wie die Zeitachse des Charts), sonst UTC. */
export const zoneAus = (z) => (z === 'lokal' ? (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC') : 'UTC')

/** Delta je Kerze: Kauf − Verkauf = 2·vb − v; ohne `vb` null. */
export function deltaJeKerze(kerzen) {
    return (kerzen || []).map((k) => (Number.isFinite(k.vb) && Number.isFinite(k.v) ? 2 * k.vb - k.v : null))
}

/** Hat die Reihe überhaupt Kaufvolumen? (sonst ist das Fenster leer und sagt es) */
export const hatKaufvolumen = (kerzen) => (kerzen || []).some((k) => Number.isFinite(k.vb))

const TAG = 86_400_000
/** Schlüssel der Periode einer Zeit: Tag oder Woche (ab Montag), in UTC oder einer Zeitzone. */
export function periodeVon(t, art = 'tag', zone = 'UTC') {
    let tag
    if (zone === 'UTC') tag = Math.floor(t / TAG)
    else {
        const teile = Object.fromEntries(formatFuer(zone).formatToParts(new Date(t)).map((x) => [x.type, x.value]))
        tag = Math.floor(Date.UTC(+teile.year, +teile.month - 1, +teile.day) / TAG)
    }
    // 1.1.1970 war ein Donnerstag: +3 legt den Wochenbeginn auf Montag
    return art === 'woche' ? Math.floor((tag + 3) / 7) : tag
}
const formate = new Map()
function formatFuer(zone) {
    let f = formate.get(zone)
    if (!f) {
        try { f = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }) } catch { f = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }) }
        formate.set(zone, f)
    }
    return f
}

/**
 * CVD: Delta aufsummiert. `anker` 'keiner' (über alle geladenen Kerzen),
 * 'tag' oder 'woche' (beginnt je Periode bei 0). Kerzen ohne `vb` → null,
 * und die Summe läuft danach neu an (eine Lücke ist keine 0).
 */
export function cvdSerie(kerzen, { anker = 'keiner', zone = 'UTC' } = {}) {
    const d = deltaJeKerze(kerzen)
    const aus = new Array(d.length).fill(null)
    let summe = null, periode = null
    for (let i = 0; i < d.length; i++) {
        if (d[i] == null) { summe = null; continue }
        if (anker !== 'keiner') {
            const p = periodeVon(kerzen[i].t, anker, zone)
            if (p !== periode) { periode = p; summe = null }
        }
        summe = (summe ?? 0) + d[i]
        aus[i] = summe
    }
    return aus
}

/** Kauf (positiv) und Verkauf (negativ) je Kerze für das Delta-Volumen-Fenster. */
export function kaufVerkauf(kerzen) {
    const kauf = [], verkauf = []
    for (const k of kerzen || []) {
        const ok = Number.isFinite(k.vb) && Number.isFinite(k.v)
        kauf.push(ok ? k.vb : null)
        verkauf.push(ok ? -(k.v - k.vb) : null)
    }
    return { kauf, verkauf }
}

/**
 * Abschnitte je Session (Tag oder Woche) für das Session-Volumenprofil: die
 * jüngsten `anzahl`, als Indexbereiche {a, b} (älteste zuerst). Die laufende
 * Session ist dabei (`laufend: true`).
 */
export function sessionBereiche(kerzen, { art = 'tag', zone = 'UTC', anzahl = 5 } = {}) {
    const n = kerzen?.length || 0
    const teile = []
    for (let i = 0; i < n; i++) {
        const p = periodeVon(kerzen[i].t, art, zone)
        const l = teile[teile.length - 1]
        if (l && l.p === p) l.b = i
        else teile.push({ p, a: i, b: i })
    }
    const aus = teile.slice(-Math.max(1, anzahl)).map(({ a, b }) => ({ a, b }))
    if (aus.length) aus[aus.length - 1].laufend = true
    return aus
}

// ── CVD ausgebaut (31.10.2026, nach dem TradingView-Skript „Mo's CVD") ──────

const hlc3 = (k) => (k.h + k.l + k.c) / 3

/**
 * Ende des Fensters der Kerze `i`: Kerzenbeginn plus Länge, auf 1M der nächste
 * Monatsbeginn (UTC, wie die Monatskerzen der Börsen), und nie über den Beginn
 * der nächsten Chart-Kerze hinaus.
 */
export function fensterEnde(kerzen, i, ivMs, interval = '') {
    const t = kerzen[i].t
    let ende = t + ivMs
    if (interval === '1M') {
        const d = new Date(t)
        ende = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
    }
    const naechste = kerzen[i + 1]?.t
    return Number.isFinite(naechste) && naechste > t ? Math.min(ende, naechste) : ende
}

/**
 * Quellkerzen (Binance) je Chart-Kerze: bei gleicher Zeiteinheit die Kerze
 * mit derselben Startzeit; ist die Quelle feiner (`quelleMs` < Länge der
 * Chart-Kerze), alle Quellkerzen im Fenster der Chart-Kerze — nur, wenn sie
 * am Kerzenbeginn anfangen und lückenlos bis zum Fensterende reichen (die
 * laufende letzte Kerze: bis zur jüngsten Quellkerze). Sonst null: eine
 * halbe Summe wäre ein falsches Delta.
 * @returns {Array<Array|null>}  je Chart-Kerze die Liste der Quellkerzen oder null
 */
export function quelleJeKerze(kerzen, quelle, { quelleMs = 0, ivMs = 0, interval = '' } = {}) {
    const n = kerzen?.length || 0
    const q = (quelle || []).slice().sort((a, b) => a.t - b.t)
    if (!(quelleMs > 0) || !(ivMs > quelleMs)) {
        const nachZeit = new Map(q.map((k) => [k.t, k]))
        return Array.from({ length: n }, (_, i) => (nachZeit.has(kerzen[i].t) ? [nachZeit.get(kerzen[i].t)] : null))
    }
    const aus = new Array(n).fill(null)
    let j = 0
    for (let i = 0; i < n; i++) {
        const von = kerzen[i].t, bis = fensterEnde(kerzen, i, ivMs, interval)
        while (j < q.length && q[j].t < von) j++
        if (q[j]?.t !== von) continue
        const teile = []
        let x = j
        while (x < q.length && q[x].t < bis) {
            if (teile.length && q[x].t !== teile[teile.length - 1].t + quelleMs) break
            teile.push(q[x]); x++
        }
        const letzte = teile[teile.length - 1]
        const voll = letzte.t + quelleMs >= bis
        // Laufende Chart-Kerze: die jüngste Quellkerze läuft mit, das Fenster ist noch nicht voll
        const laufend = i === n - 1 && x === q.length
        if (voll || laufend) aus[i] = teile
    }
    return aus
}

/**
 * CVD als Kerzen: Eröffnung = Stand am Kerzenbeginn, Schluss = nach dem Delta
 * dieser Kerze, Hoch/Tief = höchster/tiefster Zwischenstand INNERHALB der
 * Kerze aus den Intrabar-Kerzen (`intra`, z. B. 1m mit `vb`). Ein langer oberer
 * Docht heisst: erst stark gekauft, dann wieder abverkauft.
 *
 * Anders als das Vorbild ist jedes Delta ECHT (Kaufvolumen der Aggressoren,
 * nicht ±Volumen nach Kerzenfarbe), und es mischt keine Quellen: der Schluss
 * kommt immer aus dem Delta der Chart-Kerze (eigene Kerzen mit `vb` oder die
 * Binance-Kerzen in `quelle`), Intrabar liefert nur die Dochte; ohne Intrabar
 * gibt es keine Dochte statt einer anderen Rechnung.
 *
 * Das Fenster einer Kerze reicht bis zum Beginn der nächsten: auf 1M bis zum
 * nächsten Monatsbeginn (UTC), nicht 30,44 Tage — sonst trug der Februar die
 * Deltas vom 1./2. März als Docht, und 31-Tage-Monaten fehlten 13 Stunden.
 * Ist die Quelle feiner als der Chart (`quelleMs`, z. B. Binance-1d für einen
 * 3d-Chart von Bitunix/Bitget, deren 3d-Kerzen an anderen Tagen beginnen als
 * die von Binance), zählt die Summe der Quellkerzen in diesem Fenster — nur,
 * wenn sie es lückenlos abdecken (siehe `quelleJeKerze`).
 *
 * @param {Array} kerzen  Chart-Kerzen
 * @param {{anker?, zone?, usd?, quelle?: Array, quelleMs?: number, intra?: Array, ivMs?: number, interval?: string}} o
 * @returns {{o, h, l, c, seg, start}}  je Kerze; `seg` = Abschnitt (Reset oder Lücke → neuer),
 *          `start[i]` = an dieser Kerze beginnt ein Abschnitt durch Reset
 */
export function cvdKerzen(kerzen, { anker = 'keiner', zone = 'UTC', usd = false, quelle = null, quelleMs = 0, intra = null, ivMs = 0, interval = '' } = {}) {
    const n = kerzen?.length || 0
    const leer = () => new Array(n).fill(null)
    const aus = { o: leer(), h: leer(), l: leer(), c: leer(), seg: new Array(n).fill(-1), start: new Array(n).fill(false) }
    const zuQuelle = quelle ? quelleJeKerze(kerzen, quelle, { quelleMs, ivMs, interval }) : null
    const delta = (k) => (Number.isFinite(k?.vb) && Number.isFinite(k?.v) ? (2 * k.vb - k.v) * (usd ? hlc3(k) : 1) : null)
    // Mehrere Quellkerzen (feinere Quelle): Summe ihrer Deltas, jedes mit eigenem hlc3
    const deltaAus = (teile) => {
        if (!teile?.length) return null
        let s = 0
        for (const q of teile) { const d = delta(q); if (d == null) return null; s += d }
        return s
    }
    // Intrabar nach Startzeit sortiert, Zeiger läuft mit (Kerzen aufsteigend)
    const ib = (intra || []).filter((k) => Number.isFinite(k.vb)).sort((a, b) => a.t - b.t)
    let j = 0
    let summe = null, periode = null, seg = -1
    for (let i = 0; i < n; i++) {
        const k = kerzen[i]
        const d = zuQuelle ? deltaAus(zuQuelle[i]) : delta(k)
        if (d == null) { summe = null; continue }
        let reset = false
        if (anker !== 'keiner') {
            const p = periodeVon(k.t, anker, zone)
            if (p !== periode) { reset = periode !== null; periode = p; summe = null }
        }
        if (summe == null) seg++
        const o = summe ?? 0
        const c = o + d
        let h = Math.max(o, c), l = Math.min(o, c)
        if (ivMs > 0 && ib.length) {
            const ende = fensterEnde(kerzen, i, ivMs, interval)
            while (j < ib.length && ib[j].t < k.t) j++
            let lauf = o, j2 = j
            while (j2 < ib.length && ib[j2].t < ende) {
                lauf += delta(ib[j2]) ?? 0
                h = Math.max(h, lauf); l = Math.min(l, lauf)
                j2++
            }
        }
        aus.o[i] = o; aus.h[i] = h; aus.l[i] = l; aus.c[i] = c
        aus.seg[i] = seg
        aus.start[i] = reset
        summe = c
    }
    return aus
}

/**
 * Gleitender Durchschnitt, der an jeder Abschnittsgrenze neu beginnt (kein Zug
 * über den Reset). Bis `laenge` Werte da sind, steht das laufende Mittel seit
 * dem Abschnittsbeginn — sonst bliebe nach jedem Reset eine Lücke, die der
 * Chart als schräge Linie überbrückt.
 */
export function maJeAbschnitt(werte, seg, laenge, typ = 'ema') {
    const aus = new Array(werte.length).fill(null)
    let a = 0
    for (let i = 1; i <= werte.length; i++) {
        if (i < werte.length && seg[i] === seg[a]) continue
        if (seg[a] >= 0) {
            const teil = werte.slice(a, i)
            const ma = typ === 'sma' ? smaSerie(teil, laenge) : emaSerie(teil, laenge)
            let summe = 0
            for (let x = 0; x < ma.length; x++) {
                summe += teil[x] ?? 0
                aus[a + x] = ma[x] ?? summe / (x + 1)
            }
        }
        a = i
    }
    return aus
}

/**
 * Divergenzen an PREIS-Pivots (wie das Vorbild): Preis-Tief/-Hoch mit `links`
 * Kerzen links und `rechts` rechts, verglichen mit dem CVD an denselben
 * Kerzen — am Tief das CVD-TIEF, am Hoch das CVD-HOCH (das Vorbild nahm den
 * Schluss und mass damit neben dem, was es zeichnet).
 *   regulaer     bullisch: Preis tieferes Tief, CVD höheres Tief (Verkäufe aufgesogen)
 *                bärisch:  Preis höheres Hoch, CVD tieferes Hoch (Käufer erschöpft)
 *   versteckt    bullisch: Preis höheres Tief, CVD tieferes Tief; bärisch umgekehrt
 *   uebertrieben Preis gleich (± 0,15 ATR), CVD schwächer
 * Filter: Preisabstand ≥ `minAtr`·ATR(14) (nicht bei „übertrieben"), CVD-Abstand
 * ≥ `minProzent` % der CVD-Spanne der letzten 100 Kerzen DESSELBEN Abschnitts,
 * Pivots höchstens `maxAbstand` Kerzen auseinander und im selben Abschnitt
 * (nie über einen Reset). Ein Abschnitt braucht vor dem Pivot mindestens
 * `links` Kerzen, sonst ist die Spanne noch zu klein (beim Vorbild liess der
 * %-Filter direkt nach dem Reset alles durch). Bestätigt nur von GESCHLOSSENEN
 * Kerzen: die laufende zählt nicht als Bestätigung (sonst erschiene und
 * verschwände ein Signal innerhalb der Kerze).
 */
export function preisDivergenzen(kerzen, cvd, { links = 10, rechts = 3, minAtr = 0.5, minProzent = 5, maxAbstand = 60, arten = ['regulaer'], mitLaufender = false } = {}) {
    const n = kerzen?.length || 0
    const an = new Set(arten)
    if (!an.size || n < links + rechts + 2) return []
    const A = atr(kerzen, 14)
    const letzte = mitLaufender ? n - 1 : n - 2
    const istPivot = (i, hoch) => {
        const v = hoch ? kerzen[i].h : kerzen[i].l
        for (let x = i - links; x <= i + rechts; x++) {
            if (x === i) continue
            const w = hoch ? kerzen[x].h : kerzen[x].l
            // links streng, rechts darf gleich sein (wie ta.pivothigh/-low)
            if (hoch ? (x < i ? w >= v : w > v) : (x < i ? w <= v : w < v)) return false
        }
        return true
    }
    const spanne = (i) => {
        let hi = -Infinity, lo = Infinity
        for (let x = Math.max(0, i - 99); x <= i; x++) {
            if (cvd.seg[x] !== cvd.seg[i] || cvd.c[x] == null) continue
            hi = Math.max(hi, cvd.c[x]); lo = Math.min(lo, cvd.c[x])
        }
        return hi > lo ? hi - lo : 0
    }
    const segAnfang = (i) => { let x = i; while (x > 0 && cvd.seg[x - 1] === cvd.seg[i]) x--; return x }
    const aus = []
    for (const hoch of [true, false]) {
        let vorher = null
        for (let i = links; i + rechts <= letzte; i++) {
            if (cvd.c[i] == null || !istPivot(i, hoch)) continue
            if (i - segAnfang(i) < links) { vorher = null; continue }
            const preis = hoch ? kerzen[i].h : kerzen[i].l
            const wert = hoch ? cvd.h[i] : cvd.l[i]
            const jetzt = { i, preis, wert, seg: cvd.seg[i] }
            if (vorher && vorher.seg === jetzt.seg && i - vorher.i <= maxAbstand) {
                const a = A[i] || 0
                const dp = preis - vorher.preis, dc = wert - vorher.wert
                const gross = Math.abs(dp) >= minAtr * a
                const cvdOk = Math.abs(dc) >= (minProzent / 100) * spanne(i)
                const gleich = Math.abs(dp) <= 0.15 * a
                const nimm = (typ, art) => { if (an.has(typ)) aus.push({ art, typ, i1: vorher.i, i2: i, v1: vorher.wert, v2: wert }) }
                if (cvdOk) {
                    if (hoch) {
                        if (dp > 0 && gross && dc < 0) nimm('regulaer', 'baerisch')
                        else if (dp < 0 && gross && dc > 0) nimm('versteckt', 'baerisch')
                        else if (gleich && dc < 0) nimm('uebertrieben', 'baerisch')
                    } else {
                        if (dp < 0 && gross && dc > 0) nimm('regulaer', 'bullisch')
                        else if (dp > 0 && gross && dc < 0) nimm('versteckt', 'bullisch')
                        else if (gleich && dc > 0) nimm('uebertrieben', 'bullisch')
                    }
                }
            }
            vorher = jetzt
        }
    }
    return aus.sort((x, y) => x.i2 - y.i2)
}
