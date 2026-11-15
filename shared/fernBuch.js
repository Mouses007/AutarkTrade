/**
 * Fernfeld des Orderbuchs — die ruhenden Orders weit weg vom Kurs (BTC/ETH).
 *
 * Woher die Mengen kommen: Binance veröffentlicht das Orderbuch je Preisstufe
 * (anonym, Summe aller Orders). Ein REST-Abruf liefert bei BTC nur die Stufen
 * nahe am Kurs (Futures 1000 je Seite ≈ ±0,2 %, Spot 5000). Der Diff-Strom
 * `@depth` meldet dagegen JEDE Änderung an JEDER Stufe — wer ihn dauernd offen
 * hält, kennt nach einiger Zeit auch die Orders bei −15 %. Genau das tut
 * `server/fern-buch.js`; dieses Modul ist der reine Rechenteil:
 *
 *   - `fernSchritt(mid)`     Zonenbreite (≈ 0,08 % des Kurses, glatte Zahl: BTC 50, ETH 2)
 *   - `fernFrame(buch, …)`   ein Abbild je Minute: Mengen je Zone, Bids und Asks getrennt
 *   - `spaltenAus(frames…)`  Frames je Kerze gemittelt und auf eine Anzeigestufe gebündelt
 *   - `profilAus(frames…)`   das aktuelle Buch je Zone samt „steht seit"
 *
 * Grenze, die die Anzeige nennen muss: eine Order, die schon vor dem Start der
 * Verbindung weit weg lag und sich seither nie geändert hat, kennt der Strom
 * nicht. Jeder Frame trägt deshalb `seit` (seit wann das Buch ohne Neuaufbau
 * gesammelt wird) und `lo`/`hi` (was der letzte REST-Abruf vollständig abdeckte).
 */

export const FERN_SYMBOLE = ['BTCUSDT', 'ETHUSDT']
export const FERN_MAERKTE = ['futures', 'spot']
/** Wie weit um den Kurs das Buch behalten und gespeichert wird (Anteil). */
export const FERN_PCT = 0.2
export const FERN_FRAME_MS = 60_000

/** Glatte Zonenbreite von ~0,08 % des Kurses: 1, 2, 2.5, 5 × 10^k. */
export function fernSchritt(mid, anteil = 0.0008) {
    if (!(mid > 0)) return 0
    const roh = mid * anteil
    const e = Math.floor(Math.log10(roh))
    const basis = 10 ** e
    for (const m of [1, 2, 2.5, 5, 10]) if (roh <= m * basis * 1.25) return +(m * basis).toPrecision(6)
    return 10 * basis
}

/** Menge auf 4 signifikante Stellen — für eine Heatmap genug, spart Platz. */
export function runde(q) {
    return q > 0 ? +q.toPrecision(4) : 0
}

/**
 * Ein Minuten-Abbild aus dem Buch. `bids`/`asks` sind Maps oder Listen
 * `[preis, menge]`. Zone `i` = round(preis / schritt); nur ±pct um `mid`.
 * @returns {{ b: [i, q][], a: [i, q][] }} je Seite nach i aufsteigend
 */
export function fernFrame({ bids, asks }, { mid, schritt, pct = FERN_PCT }) {
    const lo = mid * (1 - pct)
    const hi = mid * (1 + pct)
    const fasse = (stufen) => {
        const m = new Map()
        for (const [p, q] of stufen) {
            if (!(p >= lo && p <= hi) || !(q > 0)) continue
            const i = Math.round(p / schritt)
            m.set(i, (m.get(i) || 0) + q)
        }
        return [...m].sort((x, y) => x[0] - y[0]).map(([i, q]) => [i, runde(q)])
    }
    return { b: fasse(bids), a: fasse(asks) }
}

/** Frames zweier Märkte zur selben Minute zusammenlegen (Spot + Perp). Zonen über den Preis, falls die Schritte abweichen. */
export function summiereFrames(listen) {
    const jeMinute = new Map()
    for (const frames of listen) {
        for (const f of frames || []) {
            const k = Math.floor(f.t / FERN_FRAME_MS)
            const da = jeMinute.get(k)
            if (!da) { jeMinute.set(k, { ...f, b: [...f.b], a: [...f.a] }); continue }
            const umrechnen = (liste) => liste.map(([i, q]) => [Math.round((i * f.s) / da.s), q])
            const leg = (ziel, neu) => {
                const m = new Map(ziel)
                for (const [i, q] of neu) m.set(i, (m.get(i) || 0) + q)
                return [...m].sort((x, y) => x[0] - y[0])
            }
            da.b = leg(da.b, f.s === da.s ? f.b : umrechnen(f.b))
            da.a = leg(da.a, f.s === da.s ? f.a : umrechnen(f.a))
            // Gesammelt „seit" zählt das jüngere: das Bild ist nur so vollständig wie das schwächste Buch
            da.seit = Math.max(da.seit || 0, f.seit || 0)
            da.w = Math.max(da.w || 1, f.w || 1)
        }
    }
    return [...jeMinute.values()].sort((x, y) => x.t - y.t)
}

/** Glatte Anzeigestufe, damit über `spanne` (Preis) etwa `zeilen` Zeilen entstehen — nie feiner als der Aufnahmeschritt. */
export function anzeigeStufe(spanne, schritt, zeilen = 160) {
    if (!(spanne > 0) || !(schritt > 0)) return schritt || 0
    let s = schritt
    for (const m of [1, 2, 4, 5, 10, 20, 40, 50, 100, 200, 400, 500, 1000]) {
        s = schritt * m
        if (spanne / s <= zeilen) break
    }
    return s
}

/**
 * Heatmap-Spalten: Frames (Gewicht `w`, Vorgabe 1 — eine Viertelstunde aus
 * `viertelAus` zählt 15) je Kerze (Länge `ivMs`, Beginn = floor(t/iv)·iv)
 * MITTELN — eine Wand, die nur eine von 60 Minuten stand, soll blass sein,
 * eine, die die ganze Stunde stand, kräftig — und auf `stufe` bündeln. Bids
 * und Asks zusammen: die Seite ergibt sich aus der Lage zum Kurs.
 * Nur Zonen in [lo, hi] (der Preisbereich, den der Chart braucht).
 * `ab` (RUK-01): Spalten, die vor diesem Zeitpunkt beginnen, entfallen. Die
 * Route liest eine Viertelstunde Vorlauf mit; daraus entstünde sonst die Spalte
 * DAVOR aus nur ihrem letzten Viertel.
 * @returns [{ t, z: [[zeile, menge]] }] mit zeile = round(preis / stufe)
 */
export function spaltenAus(frames, { ivMs, stufe, lo = 0, hi = Infinity, maxSpalten = 1500, ab = -Infinity }) {
    const gruppen = new Map()
    for (const f of frames) {
        const t = Math.floor(f.t / ivMs) * ivMs
        if (t < ab) continue
        let g = gruppen.get(t)
        if (!g) gruppen.set(t, g = { n: 0, m: new Map() })
        const w = f.w || 1
        g.n += w
        for (const seite of [f.b, f.a]) {
            for (const [i, q] of seite) {
                const p = i * f.s
                if (p < lo || p > hi) continue
                const z = Math.round(p / stufe)
                g.m.set(z, (g.m.get(z) || 0) + q * w)
            }
        }
    }
    const aus = [...gruppen].sort((x, y) => x[0] - y[0]).slice(-maxSpalten)
    return aus.map(([t, g]) => ({ t, z: [...g.m].map(([z, q]) => [z, runde(q / g.n)]) }))
}

/**
 * Nachgeladene Spalten an die vorhandenen hängen (Browser, RUK-01). `von` ist
 * der Beginn der letzten vorhandenen Spalte: nur sie und Jüngeres wird ersetzt.
 * Eine ältere Spalte in der Antwort stammt aus dem Vorlauf der Route und trägt
 * nur einen Teil der Kerze — sie darf die fertige Spalte nicht überschreiben.
 */
export function haengeSpaltenAn(alt, neu, von, max = 1500) {
    const frisch = (neu || []).filter((sp) => von == null || sp.t >= von)
    const ab = frisch[0]?.t ?? Infinity
    return [...(alt || []).filter((sp) => sp.t < ab), ...frisch].slice(-max)
}

/**
 * Das aktuelle Buch (letzter Frame) je Zone mit „steht seit": rückwärts durch
 * die Frames, solange die Zone mindestens `anteil` ihrer heutigen Menge trug.
 * Lücken in der Aufnahme (> `luecke` ohne Frame) brechen die Kette — was
 * dazwischen war, weiss niemand. Die Frames dürfen gemischt Minuten und
 * Viertelstunden sein (ältere Stunden kommen als `viertelAus`).
 * @returns { t, mid, s, seit, lo, hi, b: [[preis, menge, seitMs]], a: [...] } | null
 */
export function profilAus(frames, { anteil = 0.5, luecke = 20 * 60_000 } = {}) {
    if (!frames?.length) return null
    const letzt = frames[frames.length - 1]
    const seiteProfil = (key) => {
        const karten = frames.map((f) => ({ t: f.t, s: f.s, m: new Map(f[key]) }))
        return letzt[key].map(([i, q]) => {
            let seit = letzt.t
            for (let k = karten.length - 2; k >= 0; k--) {
                const f = karten[k]
                if (karten[k + 1].t - f.t > luecke) break
                const j = f.s === letzt.s ? i : Math.round((i * letzt.s) / f.s)
                if ((f.m.get(j) || 0) < q * anteil) break
                seit = f.t
            }
            return [+(i * letzt.s).toPrecision(10), q, seit]
        })
    }
    return { t: letzt.t, mid: letzt.mid, s: letzt.s, seit: letzt.seit, lo: letzt.lo, hi: letzt.hi, b: seiteProfil('b'), a: seiteProfil('a') }
}

/** Stunden-Zeile ↔ JSON (gzip macht der Server). */
export function kodiereStunde(frames) {
    return JSON.stringify({ v: 1, frames })
}
export function dekodiereStunde(text) {
    const d = JSON.parse(text)
    return Array.isArray(d?.frames) ? d.frames : []
}

/** Neue Frames mit einem Altbestand derselben Stunde mischen (Neustart mitten in der Stunde): je Minute gewinnt der neue. */
export function mischeFrames(alt, neu) {
    const m = new Map()
    for (const f of alt || []) m.set(Math.floor(f.t / FERN_FRAME_MS), f)
    for (const f of neu || []) m.set(Math.floor(f.t / FERN_FRAME_MS), f)
    return [...m.values()].sort((x, y) => x.t - y.t)
}

/**
 * Eine Stunde Minuten-Frames → höchstens vier Viertelstunden-Mittel (Gewicht
 * `w` = Anzahl gemittelter Minuten). Ein Viertel ohne Frame fehlt. Hält den
 * Speicher des Servers für ältere Stunden klein (15× weniger), für Kerzen ab
 * 15 Minuten reicht es genau.
 */
export function viertelAus(frames) {
    const gruppen = new Map()
    for (const f of frames) {
        const t = Math.floor(f.t / 900_000) * 900_000
        let g = gruppen.get(t)
        if (!g) gruppen.set(t, g = { t, n: 0, s: f.s, b: new Map(), a: new Map(), letzt: f })
        g.n++
        g.letzt = f
        for (const key of ['b', 'a']) {
            for (const [i, q] of f[key]) {
                const j = f.s === g.s ? i : Math.round((i * f.s) / g.s)
                g[key].set(j, (g[key].get(j) || 0) + q)
            }
        }
    }
    return [...gruppen.values()].sort((x, y) => x.t - y.t).map((g) => ({
        t: g.t, w: g.n, s: g.s, mid: g.letzt.mid, seit: g.letzt.seit, lo: g.letzt.lo, hi: g.letzt.hi,
        b: [...g.b].sort((x, y) => x[0] - y[0]).map(([i, q]) => [i, runde(q / g.n)]),
        a: [...g.a].sort((x, y) => x[0] - y[0]).map(([i, q]) => [i, runde(q / g.n)]),
    }))
}
