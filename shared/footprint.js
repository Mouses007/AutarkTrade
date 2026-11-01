/**
 * Footprint — Käufe und Verkäufe je Preisstufe in jeder Kerze. Rein, ohne
 * Netz, im Server (Bündeln der aufgezeichneten aggTrades) und im Browser
 * (Auswertung, Imbalance) benutzt.
 *
 * Grundlage sind die aggTrades der eigenen Aufzeichnung (`live-recorder.js`,
 * Art `trades`): `[t, preis, menge, seite]`, seite 1 = der Käufer war
 * aggressiv (hat ins Ask gekauft), 0 = der Verkäufer. Geschätzt wird nichts —
 * wo nicht aufgezeichnet wurde, gibt es keinen Footprint.
 *
 * Imbalance wie bei den üblichen Footprint-Charts DIAGONAL: Käufe auf einer
 * Stufe gegen Verkäufe eine Stufe TIEFER (der Käufer nimmt das Ask, der
 * Verkäufer trifft das Bid eine Stufe darunter). Ab `faktor` (Vorgabe 3:1)
 * ist die Stufe markiert; drei markierte Stufen direkt übereinander sind
 * ein „Stapel" — dort hat eine Seite den Preis durchgedrückt. Verglichen
 * wird über den Stufen-Index, nicht über die nächste Zeile: Stufen ohne
 * Handel fehlen in den Zeilen und zählen als 0.
 */

/** Stufen-Index eines Preises (Untergrenze der Stufe = index · stufe). */
export const stufeVon = (preis, stufe) => Math.floor(preis / stufe + 1e-9)

/**
 * aggTrades in Kerzen und Stufen bündeln.
 * @param {Array<[number, number, number, number]>} events  [t, preis, menge, seite]
 * @param {{ivMs: number, stufe: number, von?: number, bis?: number, ziel?: Map}} o
 * @returns {Map<number, Map<number, [number, number]>>}  Kerzenbeginn → Stufe → [kauf, verkauf]
 */
export function buendele(events, { ivMs, stufe, von = -Infinity, bis = Infinity, ziel = new Map() }) {
    if (!(ivMs > 0) || !(stufe > 0)) return ziel
    for (const e of events || []) {
        const t = e[0]
        if (!(t >= von && t < bis)) continue
        const kt = Math.floor(t / ivMs) * ivMs
        let kerze = ziel.get(kt)
        if (!kerze) ziel.set(kt, kerze = new Map())
        const s = stufeVon(e[1], stufe)
        let z = kerze.get(s)
        if (!z) kerze.set(s, z = [0, 0])
        if (e[3]) z[0] += e[2]; else z[1] += e[2]
    }
    return ziel
}

/** Zwei Bündelungen zusammenlegen (Stunden einzeln zwischengespeichert, für die Antwort vereint). */
export function legeZusammen(ziel, quelle) {
    for (const [kt, kerze] of quelle) {
        let k = ziel.get(kt)
        if (!k) ziel.set(kt, k = new Map())
        for (const [s, [kauf, verkauf]] of kerze) {
            const z = k.get(s)
            if (z) { z[0] += kauf; z[1] += verkauf } else k.set(s, [kauf, verkauf])
        }
    }
    return ziel
}

/** Für die Antwort: Kerzen aufsteigend, Zeilen nach Preis absteigend, als [preis, kauf, verkauf]. */
export function alsListe(buendel, stufe) {
    const runde = (x) => Math.round(x * 1e8) / 1e8
    return [...buendel.entries()].sort((a, b) => a[0] - b[0]).map(([t, kerze]) => ({
        t,
        zeilen: [...kerze.entries()].sort((a, b) => b[0] - a[0]).map(([s, [kauf, verkauf]]) => [runde(s * stufe), runde(kauf), runde(verkauf)]),
    }))
}

/**
 * Eine Kerze auswerten: Summen, Delta, POC, Imbalance je Zeile, Stapel.
 *
 * Nachbarn sind Nachbar-STUFEN, nicht Nachbar-Zeilen: Stufen ohne Handel
 * fehlen in `zeilen`. Liegt zwischen zwei Zeilen eine Lücke, ist die
 * Gegenseite der Nachbarstufe 0 (nicht die nächste Zeile mit Handel), und
 * ein Stapel endet an der Lücke. `stufe` kommt aus der Antwort; fehlt sie,
 * gilt der kleinste Abstand zweier Zeilen.
 * @param {Array<[number, number, number]>} zeilen  [preis, kauf, verkauf], Preis absteigend
 * @param {{faktor?: number, minVol?: number, stufe?: number}} o  `minVol`: kleinere Seite unter dieser Menge zählt als 0 nicht mit
 */
export function werteKerze(zeilen, { faktor = 3, minVol = 0, stufe = 0 } = {}) {
    let kauf = 0, verkauf = 0, poc = null, pocVol = -1
    for (const [preis, k, v] of zeilen) {
        kauf += k; verkauf += v
        if (k + v > pocVol) { pocVol = k + v; poc = preis }
    }
    if (!(stufe > 0)) {
        stufe = Infinity
        for (let i = 1; i < zeilen.length; i++) { const d = zeilen[i - 1][0] - zeilen[i][0]; if (d > 0) stufe = Math.min(stufe, d) }
        if (!Number.isFinite(stufe)) stufe = 1
    }
    // Stufen-Index je Zeile (gerundet: die Preise kommen als runde(s · stufe))
    const idx = zeilen.map((z) => Math.round(z[0] / stufe))
    const nachIdx = new Map(idx.map((x, i) => [x, zeilen[i]]))
    const imb = zeilen.map(() => ({ kauf: false, verkauf: false }))
    // Gegenseite 0: nur markiert, wenn die eigene Seite über `minVol` liegt (sonst
    // wäre jede einzelne Kleinstorder am Rand der Kerze eine „Imbalance").
    const ueber = (eigen, gegen) => eigen > minVol && (gegen > 0 ? eigen / gegen >= faktor : eigen > 0)
    // Am Rand der Kerze fehlt die Nachbarstufe ganz — dort gibt es nichts zu vergleichen.
    // Innerhalb der Kerze zählt eine Stufe ohne Handel als 0.
    const unten = idx.length ? idx[idx.length - 1] : 0, oben = idx.length ? idx[0] : 0
    for (let i = 0; i < zeilen.length; i++) {
        imb[i].kauf = idx[i] > unten && ueber(zeilen[i][1], nachIdx.get(idx[i] - 1)?.[2] ?? 0)
        imb[i].verkauf = idx[i] < oben && ueber(zeilen[i][2], nachIdx.get(idx[i] + 1)?.[1] ?? 0)
    }
    // Stapel: mindestens drei markierte Stufen DIREKT übereinander (über eine Lücke hinweg nicht)
    const stapel = []
    for (const seite of ['kauf', 'verkauf']) {
        let lauf = 0
        for (let i = 0; i <= imb.length; i++) {
            if (i < imb.length && imb[i][seite] && (lauf === 0 || idx[i] === idx[i - 1] - 1)) { lauf++; continue }
            if (lauf >= 3) stapel.push({ seite, von: zeilen[i - 1][0], bis: zeilen[i - lauf][0], anzahl: lauf })
            lauf = i < imb.length && imb[i][seite] ? 1 : 0
        }
    }
    return { kauf, verkauf, delta: kauf - verkauf, poc, imbalance: imb, stapel }
}

const SCHRITTE = [1, 2, 2.5, 5]
/**
 * Preisstufe automatisch: typische Kerzenspanne der letzten Kerzen durch
 * `zeilen` (Vorgabe 14 Zeilen je Kerze), aufgerundet auf eine runde Zahl
 * (1/2/2,5/5 · 10^n) und mindestens ein Tick.
 */
export function autoStufe(kerzen, { tick = 0, zeilen = 14 } = {}) {
    const r = (kerzen || []).slice(-60).map((k) => k.h - k.l).filter((x) => x > 0).sort((a, b) => a - b)
    if (!r.length) return tick > 0 ? tick : null
    const roh = r[r.length >> 1] / Math.max(1, zeilen)
    const zehn = 10 ** Math.floor(Math.log10(roh))
    const rund = SCHRITTE.map((s) => s * zehn).find((s) => s >= roh * 0.999) ?? 10 * zehn
    if (!(tick > 0)) return rund
    return Math.max(tick, Math.round(rund / tick) * tick)
}

/**
 * Stufen zusammenfassen (je `m` Stufen eine), wenn eine Zeile im Bild zu niedrig
 * wird — sonst stehen 40 Zeilen à 3 px übereinander und nichts ist lesbar.
 * Gruppiert über den Stufen-Index; Preis der Gruppe = ihre Untergrenze.
 * @returns {Array<[number, number, number]>} [preis, kauf, verkauf], Preis absteigend
 */
export function fasseZusammen(zeilen, stufe, m) {
    if (!(m > 1) || !(stufe > 0)) return zeilen
    const runde = (x) => Math.round(x * 1e8) / 1e8
    const g = new Map()
    for (const [preis, kauf, verkauf] of zeilen) {
        const idx = Math.floor(Math.round(preis / stufe) / m)
        const z = g.get(idx) || [0, 0]
        z[0] += kauf; z[1] += verkauf
        g.set(idx, z)
    }
    return [...g.entries()].sort((a, b) => b[0] - a[0]).map(([idx, [k, v]]) => [runde(idx * m * stufe), runde(k), runde(v)])
}

/**
 * Value Area einer Kerze: vom POC aus nach der Seite mit mehr Volumen erweitern,
 * bis `anteil` (Vorgabe 70 %) des Volumens drin ist — wie beim Volumenprofil.
 * Stufen ohne Handel zählen als 0 (sie fehlen in `zeilen`).
 * @returns {{oben: number, unten: number}|null}  Preise der obersten/untersten Stufe darin
 */
export function valueArea(zeilen, stufe, anteil = 0.7) {
    if (!zeilen?.length || !(stufe > 0)) return null
    const vol = new Map()
    let gesamt = 0, poc = null, pocVol = -1
    for (const [preis, k, v] of zeilen) {
        const i = Math.round(preis / stufe)
        vol.set(i, (vol.get(i) || 0) + k + v)
        gesamt += k + v
        if (k + v > pocVol) { pocVol = k + v; poc = i }
    }
    if (!(gesamt > 0)) return null
    const min = Math.min(...vol.keys()), max = Math.max(...vol.keys())
    let o = poc, u = poc, drin = pocVol
    while (drin < gesamt * anteil && (o < max || u > min)) {
        const rauf = o < max ? (vol.get(o + 1) || 0) : -1
        const runter = u > min ? (vol.get(u - 1) || 0) : -1
        if (rauf >= runter) { o++; drin += Math.max(0, rauf) } else { u--; drin += Math.max(0, runter) }
    }
    const runde = (x) => Math.round(x * 1e8) / 1e8
    return { oben: runde(o * stufe), unten: runde(u * stufe) }
}

/**
 * Stapel-Imbalancen als Zonen nach rechts: eine Zone beginnt an ihrer Kerze und
 * endet an der ersten SPÄTEREN Kerze, deren Spanne sie berührt — danach ist sie
 * abgearbeitet. Ohne Berührung läuft sie bis jetzt (`bisT` null).
 * @param stapel  [{t, seite, von, bis}] — `von`/`bis` = Untergrenzen der untersten/obersten Stufe
 * @param kerzen  Chart-Kerzen {t, h, l}, aufsteigend
 */
export function stapelZonen(stapel, kerzen, stufe) {
    return stapel.map((s) => {
        const unten = s.von, oben = s.bis + stufe
        const ab = kerzen.findIndex((k) => k.t > s.t)
        let bisT = null
        if (ab >= 0) for (let i = ab; i < kerzen.length; i++) if (kerzen[i].l <= oben && kerzen[i].h >= unten) { bisT = kerzen[i].t; break }
        return { ...s, unten, oben, bisT }
    })
}

/**
 * Wie vollständig ist eine Kerze aufgezeichnet? `abschnitte` = [[beginT, endeT]]
 * lückenlos aufgezeichneter Zeit (Server). `voll` | `teil` (Aufzeichnung beginnt
 * oder endet in der Kerze) | `keine`.
 */
export function abdeckung(t, ivMs, abschnitte) {
    const ende = t + ivMs
    // Spielraum: der erste Trade einer Stunde kommt bei ruhigen Märkten Sekunden nach ihrem Beginn
    const tol = Math.max(1000, ivMs * 0.05)
    let teil = false
    for (const [a, b] of abschnitte || []) {
        if (a <= t + tol && b >= ende - tol) return 'voll'
        if (a < ende && b > t) teil = true
    }
    return teil ? 'teil' : 'keine'
}
