/**
 * Geometrie der Zeichenwerkzeuge — rein, ohne Chart-Bibliothek, im Selbsttest
 * geprüft (`src/utils/__selftest-chart-zeichnungen.mjs`).
 *
 * Zeichnungen stehen in ZEIT (ms) und PREIS, nie in Pixeln oder Kerzenindex:
 * nur so bleibt eine Linie beim Wechsel von 1h auf 15m an ihrem Ort. Auf den
 * Bildschirm kommt sie über den „logischen Index" der Bibliothek — Kerze i hat
 * den Index i, dazwischen wird linear geteilt, und JENSEITS der Daten wird mit
 * der Kerzenlänge weitergezählt. Letzteres ist der Grund für diese Datei:
 * `timeToCoordinate` der Bibliothek kennt nur Zeiten, zu denen es eine Kerze
 * gibt, und eine Trendlinie, die in die Zukunft zeigt, verschwände sonst.
 */
import { fibLevel } from '../../../../shared/indicators.js'

/**
 * Zeit (ms) → logischer Index. `zeiten` aufsteigend, `iv` = Kerzenlänge in ms.
 * @returns {number|null}
 */
export function zeitZuLogisch(t, zeiten, iv) {
    const n = zeiten.length
    if (!n || !Number.isFinite(t)) return null
    if (t <= zeiten[0]) return (t - zeiten[0]) / iv
    if (t >= zeiten[n - 1]) return n - 1 + (t - zeiten[n - 1]) / iv
    let lo = 0, hi = n - 1
    while (hi - lo > 1) {
        const m = (lo + hi) >> 1
        if (zeiten[m] <= t) lo = m; else hi = m
    }
    const spanne = zeiten[hi] - zeiten[lo]
    return lo + (spanne > 0 ? (t - zeiten[lo]) / spanne : 0)
}

/**
 * Zeit eines EREIGNISSES (Einstieg, Ausstieg, Teil-Fill) → logischer Index
 * INNERHALB seiner Kerze.
 *
 * Zeichnungen teilen linear von Öffnungszeit zu Öffnungszeit — für eine Linie
 * richtig, für ein Ereignis nicht: die Kerze i liegt auf dem Bildschirm um i
 * zentriert, belegt also i − 0,5 … i + 0,5. Ein Trade am 11.10. um 14:00 auf
 * dem Tageschart (Anteil 0,58) landete bei 1,58 und damit über der Kerze vom
 * 12.10. Hier: i − 0,45 + 0,9 · Anteil — innerhalb der eigenen Kerze, die
 * Reihenfolge innerhalb einer Kerze bleibt erhalten, und ein Ereignis genau
 * zur Eröffnung sitzt nicht auf der Grenze zur Vorkerze.
 */
export function ereignisZuLogisch(t, zeiten, iv) {
    const L = zeitZuLogisch(t, zeiten, iv)
    if (L == null) return null
    const i = Math.floor(L + 1e-9)
    const anteil = Math.min(1, Math.max(0, L - i))
    return i - 0.45 + 0.9 * anteil
}

/**
 * Logischer Index → x-Pixel. `logicalToCoordinate` der Bibliothek nimmt nur
 * GANZE Indizes ernst und liefert für 899.5 schlicht 0 (gemessen 18.10.2026,
 * v5.2.1) — ein Ausstieg zur halben Kerze und jede Linie aus einer anderen
 * Zeiteinheit (07:00 auf dem 4h-Chart) klebten dadurch am linken Rand. Also
 * zwischen den beiden Nachbarn selbst teilen.
 */
export function logischZuX(zeitachse, L) {
    if (L == null || !Number.isFinite(L)) return null
    const a = Math.floor(L)
    const xa = zeitachse.logicalToCoordinate(a)
    const f = L - a
    if (xa == null || f === 0) return xa
    const xb = zeitachse.logicalToCoordinate(a + 1)
    return xb == null ? xa : xa + f * (xb - xa)
}

/** Logischer Index → Zeit (ms). Umkehrung von `zeitZuLogisch`. */
export function logischZuZeit(L, zeiten, iv) {
    const n = zeiten.length
    if (!n || !Number.isFinite(L)) return null
    if (L <= 0) return zeiten[0] + L * iv
    if (L >= n - 1) return zeiten[n - 1] + (L - (n - 1)) * iv
    const i = Math.floor(L)
    return zeiten[i] + (L - i) * (zeiten[i + 1] - zeiten[i])
}

/**
 * Abstand eines Punkts zu einer Strecke a→b (Pixel). `links`/`rechts`
 * verlängern die Strecke über a bzw. b hinaus (Strahl, verlängerte Linie).
 */
export function abstandZuStrecke(px, py, ax, ay, bx, by, { links = false, rechts = false } = {}) {
    const dx = bx - ax
    const dy = by - ay
    const l2 = dx * dx + dy * dy
    if (l2 === 0) return Math.hypot(px - ax, py - ay)
    let u = ((px - ax) * dx + (py - ay) * dy) / l2
    if (!links) u = Math.max(u, 0)
    if (!rechts) u = Math.min(u, 1)
    return Math.hypot(px - (ax + u * dx), py - (ay + u * dy))
}

/**
 * Strecke a→b bis an den Rand der Fläche verlängern (für Strahl und
 * verlängerte Trendlinie). Gibt die neuen Endpunkte zurück.
 */
export function verlaengere(ax, ay, bx, by, breite, { links = false, rechts = false } = {}) {
    const dx = bx - ax
    const dy = by - ay
    if (dx === 0 && dy === 0) return { ax, ay, bx, by }
    // Weit genug, dass der Endpunkt sicher ausserhalb liegt — der Canvas
    // schneidet ab. Bei senkrechten Linien zählt die Höhe, deshalb grosszügig.
    const faktor = (breite * 4 + Math.abs(dy) * 4 + 10000) / Math.max(Math.hypot(dx, dy), 1e-9)
    return {
        ax: links ? ax - dx * faktor : ax,
        ay: links ? ay - dy * faktor : ay,
        bx: rechts ? bx + dx * faktor : bx,
        by: rechts ? by + dy * faktor : by,
    }
}

/**
 * Preis einer Geraden durch a und b an der Stelle L (logischer Index). Linear
 * im logischen Raum — so sieht der Nutzer die Linie, also so wird sie auch
 * beim Alarm gerechnet (bei lückenlosen Krypto-Kerzen identisch mit linear in
 * der Zeit).
 */
export function preisAufGerade(L, La, pa, Lb, pb) {
    if (Lb === La) return pa
    return pa + ((pb - pa) * (L - La)) / (Lb - La)
}

/** Zeichnungen, die „fortlaufend" sein können: sie reichen immer bis zur aktuellen Kerze. */
export const FORTLAUFEND_TYPEN = ['trendlinie', 'kanal', 'rechteck']

/**
 * „Fortlaufend": der spätere Endpunkt rückt bis zur aktuellen Kerze `letzteT`
 * vor — bei Linie und Kanal entlang der Geraden (auf der Log-Skala im
 * Logarithmus, so wie die Linie im Bild liegt), beim Rechteck nur die rechte
 * Kante. Endet die Zeichnung schon rechts davon, bleibt sie, wie sie ist.
 * Gespeichert wird das nie — nur gezeichnet und getroffen; die Anker bleiben.
 * @param {function} zuL  Zeit → logischer Index (Kerzen zählen, nicht Millisekunden)
 */
export function fortlaufendePunkte(typ, pk, letzteT, zuL, log = false) {
    if (!FORTLAUFEND_TYPEN.includes(typ) || !pk || pk.length < 2 || !Number.isFinite(letzteT)) return pk
    const iEnde = pk[1].t >= pk[0].t ? 1 : 0
    const ende = pk[iEnde], start = pk[1 - iEnde]
    if (!(letzteT > ende.t)) return pk
    const neu = pk.map((q) => ({ ...q }))
    if (typ === 'rechteck') {
        neu[iEnde] = { t: letzteT, p: ende.p }
        return neu
    }
    const La = zuL(start.t), Lb = zuL(ende.t), L = zuL(letzteT)
    if (La == null || Lb == null || L == null) return pk
    const p = log && start.p > 0 && ende.p > 0
        ? Math.exp(preisAufGerade(L, La, Math.log(start.p), Lb, Math.log(ende.p)))
        : preisAufGerade(L, La, start.p, Lb, ende.p)
    neu[iEnde] = { t: letzteT, p }
    return neu
}

/** Fibonacci-Retracement: Stufe 0 am Endpunkt, 1 am Startpunkt (wie TradingView). */
export const FIB_STUFEN = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618]

export function fibPreise(start, ende, stufen = FIB_STUFEN) {
    return stufen.map((s) => ({ stufe: s, preis: fibLevel(start, ende, s) }))
}

/**
 * Long/Short-Position aus drei Preisen. Richtung folgt dem Ziel: liegt es über
 * dem Einstieg, ist es ein Long. Ein Stop auf der falschen Seite ist kein
 * Fehler, den man still korrigieren sollte — `stimmig: false` sagt es.
 */
export function positionWerte(einstieg, ziel, stop) {
    const long = ziel >= einstieg
    const chance = Math.abs(ziel - einstieg)
    const risiko = Math.abs(einstieg - stop)
    const stimmig = long ? stop < einstieg : stop > einstieg
    return {
        long,
        stimmig,
        rr: risiko > 0 ? chance / risiko : null,
        zielPct: einstieg ? ((ziel - einstieg) / einstieg) * 100 : 0,
        stopPct: einstieg ? ((stop - einstieg) / einstieg) * 100 : 0,
    }
}

/**
 * Magnet: rastet den Preis auf O/H/L/C der Kerze ein, wenn einer davon
 * innerhalb der Toleranz liegt (Toleranz in Preis-Einheiten, vom Aufrufer aus
 * Pixeln umgerechnet).
 */
export function magnet(preis, kerze, toleranz) {
    if (!kerze) return preis
    let best = preis
    let abstand = toleranz
    for (const w of [kerze.o, kerze.h, kerze.l, kerze.c]) {
        const d = Math.abs(w - preis)
        if (d <= abstand) { abstand = d; best = w }
    }
    return best
}

/** Liegt (x, y) im Rechteck aus zwei Ecken? */
export function imRechteck(x, y, x1, y1, x2, y2, rand = 0) {
    return x >= Math.min(x1, x2) - rand && x <= Math.max(x1, x2) + rand && y >= Math.min(y1, y2) - rand && y <= Math.max(y1, y2) + rand
}

/** Kurzer Text für eine Messung: Δ Preis, %, Kerzen, Dauer. */
export function messung(a, b, iv) {
    const dp = b.p - a.p
    const pct = a.p ? (dp / a.p) * 100 : 0
    const dt = b.t - a.t
    return { dp, pct, kerzen: Math.round(dt / iv), dauerMs: dt }
}

/** Dauer in Tagen/Stunden/Minuten, für Messung und Position. */
export function dauerText(ms) {
    const a = Math.abs(ms)
    const t = Math.floor(a / 86_400_000)
    const h = Math.floor((a % 86_400_000) / 3_600_000)
    const m = Math.round((a % 3_600_000) / 60_000)
    if (t) return `${t}d ${h}h`
    if (h) return `${h}h ${m}m`
    return `${m}m`
}

// ── Beschriftung: Grösse und Lage ─────────────────────────────────────────
/** Wählbare Textgrössen (px) und Lagen der Beschriftung einer Zeichnung. */
export const TEXT_GROESSEN = [9, 10, 11, 12, 14, 16, 18, 20, 24, 28]
export const TEXT_H = ['links', 'mitte', 'rechts']
export const TEXT_V_BOX = ['ueber', 'oben', 'mitte', 'unten', 'unter']
export const TEXT_V_LINIE = ['oben', 'unten']

/**
 * Wo der Text in/an einem Rechteck steht: `textH` links/mitte/rechts,
 * `textV` ueber (ausserhalb, über der Oberkante) / oben / mitte / unten (innen) /
 * unter (ausserhalb). Liefert die Grundlinie (x, y) für `fillText`.
 * @param {number} w  gemessene Textbreite, @param {number} g  Schriftgrösse
 */
export function textInBox({ links, oben, rechts, unten }, { textH = 'links', textV = 'oben' } = {}, w, g) {
    const x = textH === 'rechts' ? rechts - 6 - w : textH === 'mitte' ? (links + rechts) / 2 - w / 2 : links + 6
    const y = textV === 'ueber' ? oben - 5
        : textV === 'unter' ? unten + g + 3
            : textV === 'mitte' ? (oben + unten) / 2 + g * 0.35
                : textV === 'unten' ? unten - 5
                    : oben + g + 3
    return { x, y }
}

/** Text an einer waagrechten Linie von x0 bis x1: links/mitte/rechts, über oder unter der Linie. */
export function textAnLinie(x0, x1, y, { textH = 'links', textV = 'oben' } = {}, w, g) {
    const x = textH === 'rechts' ? x1 - 6 - w : textH === 'mitte' ? (x0 + x1) / 2 - w / 2 : x0 + 6
    return { x, y: textV === 'unten' ? y + g + 3 : y - 4 }
}

/**
 * Rechteck an einem seiner acht Griffe ziehen. Die Ecken sind die beiden
 * gespeicherten Punkte (0, 1) und die beiden anderen (2 = Zeit von 0 + Preis von 1,
 * 3 = Zeit von 1 + Preis von 0); die Kantenmitten bewegen nur eine Kante:
 * 4/5 die senkrechte Kante bei Zeit 0/1, 6/7 die waagrechte bei Preis 0/1.
 */
export function rechteckGezogen(orig, anker, pt) {
    const [a, b] = orig.map((q) => ({ ...q }))
    switch (anker) {
        case 0: return [{ ...pt }, b]
        case 1: return [a, { ...pt }]
        case 2: return [{ t: pt.t, p: a.p }, { t: b.t, p: pt.p }]
        case 3: return [{ t: a.t, p: pt.p }, { t: pt.t, p: b.p }]
        case 4: return [{ t: pt.t, p: a.p }, b]
        case 5: return [a, { t: pt.t, p: b.p }]
        case 6: return [{ t: a.t, p: pt.p }, b]
        case 7: return [a, { t: b.t, p: pt.p }]
        default: return [a, b]
    }
}
