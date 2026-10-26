/**
 * Kennzahlen für die Tabellen in den Fenstern von ATR, ADX und MFI — rein, ohne Vue und Netz
 * (Selbsttest `src/utils/__selftest-fenster-kennzahlen.mjs`).
 *
 * Die nackte ATR-Linie sagt „228" und sonst nichts. Die Tabelle beantwortet,
 * was man damit tut:
 *
 *   ATR          in Preis UND in % vom Kurs (Prozent ist über Coins vergleichbar)
 *   Einordnung   Rang des jetzigen ATR unter den letzten `FENSTER` Werten
 *                (Perzentil) und das Vielfache des Medians — ist der Markt
 *                gerade ruhig oder aufgewacht?
 *   Richtung     ATR jetzt gegen vor `RICHTUNG_KERZEN` Kerzen (steigt/fällt)
 *   Kerze        Spanne der laufenden Kerze in ATR
 *   Stops        1 / 1,5 / 2 ATR als Abstand in Preis und %
 *   Tag          heutige Spanne (UTC-Tag) gegen den MEDIAN der Tagesspannen der
 *                letzten abgeschlossenen Tage — wie viel vom üblichen Tag schon
 *                gelaufen ist (wie der „Bewegungsvorrat" der Handelslage). Median,
 *                nicht Mittel: ein Crash-Tag hebt sonst den Massstab so, dass
 *                danach jeder normale Tag ruhig aussieht. Nur unter 1d und mit
 *                genug geladener Historie.
 */
export const FENSTER = 200
export const RICHTUNG_KERZEN = 5
export const TAGE = 10
export const MIN_TAGE = 5
const TAG_MS = 86_400_000

/**
 * Rang von `v` unter `liste` in Prozent (0–100), Gleichstände zählen halb
 * (Mittelrang) — sonst läge ein Wert in einer gleichförmigen Reihe bei 0 %
 * („sehr ruhig") statt in der Mitte.
 */
export function rangProzent(liste, v) {
    if (!liste?.length || liste.length < 2) return null
    let unter = 0, gleich = 0
    for (const x of liste) { if (x < v) unter++; else if (x === v) gleich++ }
    return Math.round(((unter + Math.max(0, gleich - 1) / 2) / (liste.length - 1)) * 100)
}

/** Einstufung eines Perzentils (0–100). */
export function stufe(perzentil) {
    if (perzentil == null) return null
    if (perzentil < 20) return 'sehrRuhig'
    if (perzentil < 40) return 'ruhig'
    if (perzentil < 60) return 'normal'
    if (perzentil < 80) return 'erhoeht'
    return 'hoch'
}

function median(liste) {
    const s = [...liste].sort((a, b) => a - b)
    if (!s.length) return null
    const m = s.length >> 1
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * @param {Array<{t,o,h,l,c}>} kerzen   aufsteigend, die letzte darf laufen
 * @param {Array<number|null>} atrReihe ATR je Kerze (gleiche Länge)
 * @param {number} ivMs                 Kerzenlänge
 * @returns {object|null}
 */
export function atrKennzahlen(kerzen, atrReihe, ivMs) {
    const n = kerzen?.length || 0
    if (!n || !atrReihe?.length) return null
    const atr = atrReihe[n - 1]
    const k = kerzen[n - 1]
    if (!(atr > 0) || !(k.c > 0)) return null

    const fenster = atrReihe.slice(Math.max(0, n - FENSTER), n).filter((v) => v > 0)
    const perzentil = fenster.length >= 20 ? rangProzent(fenster, atr) : null
    const med = fenster.length >= 20 ? median(fenster) : null

    const vorher = atrReihe[n - 1 - RICHTUNG_KERZEN]
    const richtungPct = vorher > 0 ? ((atr - vorher) / vorher) * 100 : null

    const stops = [1, 1.5, 2].map((f) => ({ faktor: f, abstand: f * atr, pct: ((f * atr) / k.c) * 100 }))

    // Tagesspannen aus den geladenen Kerzen (UTC-Tage); der erste Tag ist meist angeschnitten — weg damit.
    let tag = null
    if (ivMs > 0 && ivMs < TAG_MS) {
        const tage = new Map()
        for (const x of kerzen) {
            const d = Math.floor(x.t / TAG_MS)
            const s = tage.get(d)
            if (!s) tage.set(d, { h: x.h, l: x.l, erste: x.t })
            else { s.h = Math.max(s.h, x.h); s.l = Math.min(s.l, x.l) }
        }
        const heute = Math.floor(k.t / TAG_MS)
        const ganze = [...tage.entries()]
            .filter(([d, s]) => d < heute && s.erste === d * TAG_MS)   // vollständig geladen (beginnt um 00:00)
            .slice(-TAGE)
            .map(([, s]) => s.h - s.l)
        const jetzt = tage.get(heute)
        if (ganze.length >= MIN_TAGE && jetzt) {
            const ueblich = median(ganze)
            tag = { spanne: jetzt.h - jetzt.l, ueblich, anteilPct: ueblich > 0 ? ((jetzt.h - jetzt.l) / ueblich) * 100 : null, tage: ganze.length }
        }
    }

    return {
        atr,
        atrPct: (atr / k.c) * 100,
        perzentil,
        stufe: stufe(perzentil),
        vielfaches: med > 0 ? atr / med : null,
        richtungPct,
        kerzeAtr: (k.h - k.l) / atr,
        stops,
        tag,
    }
}

// ── ADX / DMI ──────────────────────────────────────────────────────────────
/*
 * Die drei Linien des ADX sagen erst im Zusammenhang etwas:
 *   ADX      Trendstärke OHNE Richtung (Stufen nach Wilder/üblicher Lesart:
 *            < 20 kein Trend, 20–25 entsteht, 25–40 Trend, 40–50 stark, > 50 sehr stark)
 *   +DI/−DI  wer drückt: +DI über −DI = Käufer, darunter = Verkäufer
 *   Steigung ADX steigt = der Trend gewinnt an Kraft, fällt = er lässt nach
 *            (auch in einem laufenden Trend — fallender ADX über 40 ist oft Erschöpfung)
 *   Kreuzung letzte Kreuzung +DI/−DI und wie viele Kerzen her
 */
export const ADX_STEIGUNG_KERZEN = 3

/** Stufe der Trendstärke. */
export function adxStufe(v) {
    if (!Number.isFinite(v) || v < 0) return null      // null >= 0 ist in JS wahr
    if (v < 20) return 'keinTrend'
    if (v < 25) return 'entsteht'
    if (v < 40) return 'trend'
    if (v < 50) return 'stark'
    return 'sehrStark'
}

/**
 * @param {{adx: Array, plus: Array, minus: Array}} r  Reihen wie im Register (gleiche Länge, führende null)
 * @returns {object|null}
 */
export function adxKennzahlen(r) {
    const n = r?.adx?.length || 0
    if (!n) return null
    const adx = r.adx[n - 1], plus = r.plus[n - 1], minus = r.minus[n - 1]
    if (![adx, plus, minus].every(Number.isFinite)) return null
    const vorher = r.adx[n - 1 - ADX_STEIGUNG_KERZEN]
    const steigung = Number.isFinite(vorher) ? adx - vorher : null
    let kreuzung = null
    for (let i = n - 1; i > 0; i--) {
        // null − null ist 0 — darum die Werte selbst prüfen, nicht die Differenz
        if (![r.plus[i], r.minus[i], r.plus[i - 1], r.minus[i - 1]].every(Number.isFinite)) break
        const a = r.plus[i] - r.minus[i], b = r.plus[i - 1] - r.minus[i - 1]
        if (Math.sign(a) !== Math.sign(b) && a !== 0) { kreuzung = { vorKerzen: n - 1 - i, nach: a > 0 ? 'long' : 'short' }; break }
    }
    return {
        adx, plus, minus,
        stufe: adxStufe(adx),
        seite: plus > minus ? 'long' : plus < minus ? 'short' : null,
        diAbstand: Math.abs(plus - minus),
        steigung,
        // ±0.5 Punkte über 3 Kerzen gilt als flach — sonst kippte die Aussage bei jedem Zittern
        tendenz: steigung == null ? null : steigung > 0.5 ? 'steigt' : steigung < -0.5 ? 'faellt' : 'flach',
        kreuzung,
    }
}

// ── MFI (Money Flow Index) ─────────────────────────────────────────────────
/*
 * Der MFI ist ein RSI mit Volumen: Anteil des „Zuflusses" (typischer Preis
 * steigt, mal Volumen) am gesamten Geldfluss der letzten n Kerzen.
 *   Zone       > 80 überkauft, < 20 überverkauft, dazwischen neutral;
 *              über/unter 50 heisst netto Zu- bzw. Abfluss
 *   Tendenz    MFI jetzt gegen vor `MFI_TENDENZ_KERZEN` Kerzen
 *   Divergenz  der Kurs schliesst auf dem Hoch (Tief) der letzten
 *              `DIV_KERZEN` Kerzen, der MFI bleibt mindestens `DIV_ABSTAND`
 *              Punkte unter (über) seinem Hoch (Tief) dieses Fensters: das
 *              Geld läuft dem Kurs nicht nach. Ein Hinweis, kein Signal.
 *   Zone seit  wie viele Kerzen der MFI schon in der jetzigen Zone steht —
 *              in einem Trend bleibt er lange überkauft, das ist kein Umkehrsignal
 */
export const MFI_TENDENZ_KERZEN = 3
export const DIV_KERZEN = 20
export const DIV_ABSTAND = 10

const mfiZone = (v) => (v > 80 ? 'ueberkauft' : v < 20 ? 'ueberverkauft' : 'neutral')

/**
 * @param {Array<{c}>} kerzen
 * @param {Array<number|null>} mfiReihe gleiche Länge
 */
export function mfiKennzahlen(kerzen, mfiReihe) {
    const n = mfiReihe?.length || 0
    if (!n || kerzen?.length !== n) return null
    const v = mfiReihe[n - 1]
    if (!Number.isFinite(v)) return null
    const zone = mfiZone(v)
    let seit = 0
    for (let i = n - 1; i >= 0 && Number.isFinite(mfiReihe[i]) && mfiZone(mfiReihe[i]) === zone; i--) seit++
    const vorher = mfiReihe[n - 1 - MFI_TENDENZ_KERZEN]
    const diff = Number.isFinite(vorher) ? v - vorher : null

    let divergenz = null
    const von = n - DIV_KERZEN
    if (von >= 0) {
        const preise = kerzen.slice(von).map((k) => k.c)
        const werte = mfiReihe.slice(von).filter(Number.isFinite)
        if (werte.length === DIV_KERZEN) {
            const c = kerzen[n - 1].c
            if (c >= Math.max(...preise) && Math.max(...werte) - v >= DIV_ABSTAND) divergenz = 'baerisch'
            else if (c <= Math.min(...preise) && v - Math.min(...werte) >= DIV_ABSTAND) divergenz = 'bullisch'
        }
    }
    return {
        mfi: v, zone, seitKerzen: seit,
        fluss: v > 50 ? 'zufluss' : v < 50 ? 'abfluss' : 'ausgeglichen',
        tendenz: diff == null ? null : diff > 2 ? 'steigt' : diff < -2 ? 'faellt' : 'flach',
        diff,
        divergenz,
    }
}

// ── OBV (On Balance Volume) ────────────────────────────────────────────────
/*
 * Der Stand des OBV (−16 311) ist bedeutungslos — er hängt nur davon ab, wo die
 * geladene Historie beginnt. Aussagekräftig ist die Veränderung im Fenster der
 * letzten `OBV_KERZEN` Kerzen:
 *   Netto     ΔOBV ÷ Summe des Volumens im Fenster → −100 % (jede Kerze rot)
 *             bis +100 % (jede grün); vergleichbar über Coins und Zeiteinheiten
 *   Lage      OBV über/unter seinem SMA(`OBV_KERZEN`): Kauf- oder Verkaufsdruck
 *   Abgleich  Kurs und Netto-Volumen gleich gerichtet → bestätigt; Kurs steigt
 *             bei klar negativem Netto → Verteilung (Anstieg ohne Volumen);
 *             Kurs fällt bei klar positivem Netto → Akkumulation
 */
export const OBV_KERZEN = 20
export const OBV_KLAR_PCT = 10      // |Netto| ab hier gilt als klare Richtung
export const KURS_KLAR_PCT = 0.3    // Kursbewegung im Fenster ab hier gilt als Richtung

/**
 * @param {Array<{c, v}>} kerzen
 * @param {Array<number|null>} obvReihe gleiche Länge
 */
export function obvKennzahlen(kerzen, obvReihe) {
    const n = obvReihe?.length || 0
    if (n <= OBV_KERZEN || kerzen?.length !== n) return null
    const jetzt = obvReihe[n - 1], vorher = obvReihe[n - 1 - OBV_KERZEN]
    if (!Number.isFinite(jetzt) || !Number.isFinite(vorher)) return null
    const fenster = kerzen.slice(n - OBV_KERZEN)
    const volumen = fenster.reduce((s, k) => s + (Number(k.v) || 0), 0)
    const nettoPct = volumen > 0 ? ((jetzt - vorher) / volumen) * 100 : null
    const c0 = kerzen[n - 1 - OBV_KERZEN].c, c1 = kerzen[n - 1].c
    const kursPct = c0 > 0 ? ((c1 - c0) / c0) * 100 : null
    const reihe = obvReihe.slice(n - OBV_KERZEN).filter(Number.isFinite)
    const schnitt = reihe.length === OBV_KERZEN ? reihe.reduce((s, x) => s + x, 0) / OBV_KERZEN : null

    let abgleich = 'unklar'
    if (nettoPct != null && kursPct != null) {
        const kurs = kursPct > KURS_KLAR_PCT ? 1 : kursPct < -KURS_KLAR_PCT ? -1 : 0
        const vol = nettoPct > OBV_KLAR_PCT ? 1 : nettoPct < -OBV_KLAR_PCT ? -1 : 0
        if (kurs > 0 && vol < 0) abgleich = 'verteilung'
        else if (kurs < 0 && vol > 0) abgleich = 'akkumulation'
        else if (kurs !== 0 && kurs === vol) abgleich = 'bestaetigt'
        else if (kurs === 0 && vol !== 0) abgleich = vol > 0 ? 'akkumulation' : 'verteilung'
    }
    return {
        nettoPct, kursPct, abgleich,
        lage: schnitt == null ? null : jetzt > schnitt ? 'ueber' : jetzt < schnitt ? 'unter' : 'gleich',
        kerzen: OBV_KERZEN,
    }
}

// ── Open Interest ──────────────────────────────────────────────────────────
/*
 * OI allein sagt nur „mehr oder weniger offene Kontrakte". Die übliche Lesart
 * kommt aus der Kombination mit dem Kurs im selben Fenster:
 *   Kurs ↑ OI ↑  neue Longs — der Anstieg wird mit frischen Positionen getragen
 *   Kurs ↑ OI ↓  Short-Eindeckung — Shorts schliessen, der Anstieg hat wenig neues Geld
 *   Kurs ↓ OI ↑  neue Shorts — der Abstieg wird aktiv verkauft
 *   Kurs ↓ OI ↓  Long-Ausstieg — Longs schliessen bzw. werden liquidiert
 * Gerechnet für die letzte Kerze und für die letzten `OI_KERZEN`. Unter den
 * Schwellen gilt die Richtung als „flach" — sonst spräche jedes Zittern.
 */
export const OI_KERZEN = 20
export const OI_KLAR_PCT = 0.5

function oiLage(kursPct, oiPct) {
    if (kursPct == null || oiPct == null) return null
    const k = kursPct > KURS_KLAR_PCT ? 1 : kursPct < -KURS_KLAR_PCT ? -1 : 0
    const o = oiPct > OI_KLAR_PCT ? 1 : oiPct < -OI_KLAR_PCT ? -1 : 0
    if (o === 0) return 'oiFlach'
    if (k === 0) return o > 0 ? 'aufbau' : 'abbau'
    if (k > 0) return o > 0 ? 'neueLongs' : 'shortEindeckung'
    return o > 0 ? 'neueShorts' : 'longAusstieg'
}

/**
 * @param {Array<{c}>} kerzen
 * @param {Array<number|null>} oiReihe gleiche Länge (Stand am Kerzenschluss)
 */
export function oiKennzahlen(kerzen, oiReihe) {
    const n = oiReihe?.length || 0
    if (!n || kerzen?.length !== n) return null
    let j = n - 1
    while (j >= 0 && !Number.isFinite(oiReihe[j])) j--      // die laufende Kerze hat oft noch keinen Stand
    if (j < 1) return null
    const oi = oiReihe[j]
    const pct = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && b !== 0 ? ((a - b) / b) * 100 : null)
    const fenster = (m) => {
        const i0 = j - m
        if (i0 < 0) return null
        const oiPct = pct(oi, oiReihe[i0]), kursPct = pct(kerzen[j].c, kerzen[i0].c)
        return { kerzen: m, oiPct, kursPct, lage: oiLage(kursPct, oiPct) }
    }
    return { oi, stand: j, letzte: fenster(1), fenster: fenster(OI_KERZEN) }
}

// ── Gemeinsames für Oszillatoren (RSI, Stochastik, Stoch-RSI) ───────────────
/** Letzte Kreuzung zweier Reihen: { vorKerzen, nach: 'oben'|'unten' } (a über/unter b) oder null. */
export function letzteKreuzung(a, b) {
    const n = Math.min(a?.length || 0, b?.length || 0)
    for (let i = n - 1; i > 0; i--) {
        if (![a[i], b[i], a[i - 1], b[i - 1]].every(Number.isFinite)) return null
        const jetzt = a[i] - b[i], vor = a[i - 1] - b[i - 1]
        if (jetzt !== 0 && Math.sign(jetzt) !== Math.sign(vor)) return { vorKerzen: n - 1 - i, nach: jetzt > 0 ? 'oben' : 'unten' }
    }
    return null
}

/**
 * Wert, Zone (über `oben` / unter `unten`), seit wann in der Zone, Tendenz über
 * 3 Kerzen und Divergenz zum Kurs (wie beim MFI) — für jede Reihe auf 0–100.
 */
export function oszKennzahlen(kerzen, werte, { oben, unten }) {
    const n = werte?.length || 0
    if (!n || kerzen?.length !== n) return null
    const v = werte[n - 1]
    if (!Number.isFinite(v)) return null
    const zoneVon = (x) => (x > oben ? 'ueberkauft' : x < unten ? 'ueberverkauft' : 'neutral')
    const zone = zoneVon(v)
    let seit = 0
    for (let i = n - 1; i >= 0 && Number.isFinite(werte[i]) && zoneVon(werte[i]) === zone; i--) seit++
    const vorher = werte[n - 1 - MFI_TENDENZ_KERZEN]
    const diff = Number.isFinite(vorher) ? v - vorher : null
    let divergenz = null
    const von = n - DIV_KERZEN
    if (von >= 0) {
        const preise = kerzen.slice(von).map((k) => k.c)
        const fenster = werte.slice(von).filter(Number.isFinite)
        if (fenster.length === DIV_KERZEN) {
            const c = kerzen[n - 1].c
            if (c >= Math.max(...preise) && Math.max(...fenster) - v >= DIV_ABSTAND) divergenz = 'baerisch'
            else if (c <= Math.min(...preise) && v - Math.min(...fenster) >= DIV_ABSTAND) divergenz = 'bullisch'
        }
    }
    return {
        wert: v, zone, seitKerzen: seit, diff, divergenz,
        tendenz: diff == null ? null : diff > 2 ? 'steigt' : diff < -2 ? 'faellt' : 'flach',
    }
}

/** RSI: Oszillator 70/30 plus Lage zur Mitte und zur gleitenden Linie. */
export function rsiKennzahlen(kerzen, wert, ma = null) {
    const o = oszKennzahlen(kerzen, wert, { oben: 70, unten: 30 })
    if (!o) return null
    const m = ma?.[ma.length - 1]
    return { ...o, mitte: o.wert > 50 ? 'ueber' : o.wert < 50 ? 'unter' : 'auf', ma: Number.isFinite(m) ? m : null, maKreuzung: ma ? letzteKreuzung(wert, ma) : null }
}

/** Stochastik / Stoch-RSI: Oszillator 80/20 plus %K gegen %D. */
export function stochKennzahlen(kerzen, k, d) {
    const o = oszKennzahlen(kerzen, k, { oben: 80, unten: 20 })
    if (!o) return null
    const dw = d?.[d.length - 1]
    return { ...o, d: Number.isFinite(dw) ? dw : null, kUeberD: Number.isFinite(dw) ? o.wert > dw : null, kreuzung: letzteKreuzung(k, d) }
}

// ── MACD ───────────────────────────────────────────────────────────────────
/*
 * MACD über/unter Null = die schnelle EMA über/unter der langsamen (Trend);
 * MACD über/unter Signal = kurzfristiger Schwung; das Histogramm wächst oder
 * schrumpft = Schwung nimmt zu oder ab (oft vor der Kreuzung sichtbar).
 */
export function macdKennzahlen(macdR, signalR, histR) {
    const n = histR?.length || 0
    if (!n) return null
    const m = macdR[n - 1], s = signalR[n - 1], h = histR[n - 1], h1 = histR[n - 2], h2 = histR[n - 3]
    if (![m, s, h].every(Number.isFinite)) return null
    let schwung = null
    if (Number.isFinite(h1) && Number.isFinite(h2)) {
        const a = Math.abs(h), b = Math.abs(h1), c = Math.abs(h2)
        schwung = Math.sign(h) !== Math.sign(h1) ? 'gekreuzt' : a > b && b >= c ? 'waechst' : a < b && b <= c ? 'schrumpft' : 'wechselnd'
    }
    const null0 = macdR.map(() => 0)
    return {
        macd: m, signal: s, hist: h,
        trend: m > 0 ? 'ueberNull' : m < 0 ? 'unterNull' : 'aufNull',
        linie: m > s ? 'ueberSignal' : 'unterSignal',
        schwung,
        kreuzung: letzteKreuzung(macdR, signalR),
        nullKreuzung: letzteKreuzung(macdR, null0),
    }
}

// ── Funding ────────────────────────────────────────────────────────────────
/*
 * Funding in % je Zahlung (positiv: Longs zahlen Shorts). Einordnung der
 * letzten Zahlung gegen den üblichen Grundsatz von 0,01 % je 8 h; dazu die
 * Summe der letzten 24 h und 7 Tage aus den geladenen Kerzen und die
 * Hochrechnung aufs Jahr (24 h × 365) — die Kosten, eine Position zu halten.
 */
export function fundingStufe(rate) {
    if (!Number.isFinite(rate)) return null
    if (rate < -0.01) return 'negativ'
    if (rate <= 0.0125) return 'normal'
    if (rate <= 0.05) return 'erhoeht'
    return 'hoch'
}

export function fundingKennzahlen(kerzen, hist) {
    const n = hist?.length || 0
    if (!n || kerzen?.length !== n) return null
    let j = n - 1
    while (j >= 0 && !Number.isFinite(hist[j])) j--
    if (j < 0) return null
    const ende = kerzen[n - 1].t
    const summe = (ms) => {
        let s = 0, zahl = 0
        for (let i = 0; i < n; i++) if (Number.isFinite(hist[i]) && kerzen[i].t > ende - ms) { s += hist[i]; zahl++ }
        return zahl ? s : null
    }
    const tag = summe(TAG_MS)
    // reicht die geladene Historie überhaupt eine Woche zurück?
    const woche = kerzen[0].t <= ende - 7 * TAG_MS ? summe(7 * TAG_MS) : null
    return {
        letzte: hist[j], vorKerzen: n - 1 - j, stufe: fundingStufe(hist[j]),
        tagPct: tag, wochePct: woche, jahrPct: tag == null ? null : tag * 365,
        zahlt: hist[j] > 0 ? 'longs' : hist[j] < 0 ? 'shorts' : null,
    }
}

// ── Long-Anteil der Konten ─────────────────────────────────────────────────
/*
 * Eine Stimmung, kein Volumen. Aussagekräftig ist das Extrem gegen die eigene
 * Geschichte: sehr viele Longs heisst viel Brennstoff für einen Long-Squeeze
 * (und umgekehrt) — ein Hinweis auf Gedränge, keine Richtung.
 */
export function longAnteilKennzahlen(werte) {
    const n = werte?.length || 0
    let j = n - 1
    while (j >= 0 && !Number.isFinite(werte[j])) j--
    if (j < 0) return null
    const v = werte[j]
    const fenster = werte.slice(Math.max(0, j - FENSTER + 1), j + 1).filter(Number.isFinite)
    const perzentil = fenster.length >= 20 ? rangProzent(fenster, v) : null
    const vorher = werte[j - 20]
    return {
        wert: v, perzentil,
        diff20: Number.isFinite(vorher) ? v - vorher : null,
        mehrheit: v > 50 ? 'long' : v < 50 ? 'short' : null,
        gedraenge: perzentil == null ? null : perzentil >= 90 ? 'vieleLongs' : perzentil <= 10 ? 'wenigeLongs' : null,
    }
}

// ── Volumen ────────────────────────────────────────────────────────────────
/*
 * Relatives Volumen (RVOL): letzte GESCHLOSSENE Kerze gegen ihren Durchschnitt
 * (SMA ohne sie selbst — sonst dämpft ein Ausreisser seinen eigenen Massstab),
 * dazu die laufende Kerze bisher und der Rang unter den letzten 200.
 */
export function volumenKennzahlen(kerzen, laenge = 20) {
    const n = kerzen?.length || 0
    if (n < laenge + 2) return null
    const v = kerzen.map((k) => Number(k.v) || 0)
    const zu = n - 2                                  // letzte geschlossene
    const basis = v.slice(zu - laenge, zu)
    const schnitt = basis.reduce((s, x) => s + x, 0) / laenge
    if (!(schnitt > 0)) return null
    const fenster = v.slice(Math.max(0, zu - FENSTER + 1), zu + 1)
    const perzentil = fenster.length >= 20 ? rangProzent(fenster, v[zu]) : null
    const alt = v.slice(Math.max(0, zu - 2 * laenge), zu - laenge)
    const schnittAlt = alt.length === laenge ? alt.reduce((s, x) => s + x, 0) / laenge : null
    return {
        rvol: v[zu] / schnitt, perzentil,
        laufend: v[n - 1] / schnitt,
        trendPct: schnittAlt > 0 ? ((schnitt - schnittAlt) / schnittAlt) * 100 : null,
        laenge,
    }
}
