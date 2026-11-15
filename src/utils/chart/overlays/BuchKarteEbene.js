/**
 * Orderbuch-Heatmap (BTC/ETH) im Kursbild — Daten aus `/api/chart/buchkarte`.
 *
 *   hinter den Kerzen  je Kerze und Preiszeile die MITTLERE ruhende Menge
 *                      (Bids + Asks, Coins): dunkel → violett → orange → gelb.
 *                      Eine Wand, die die ganze Kerze stand, ist kräftig; eine,
 *                      die nur kurz stand, blass. Massstab = sichtbarer Bereich
 *                      (95-%-Wert), sonst machte eine Riesenwand alles andere unsichtbar.
 *   rechter Rand       das aktuelle Buch als Balken (Käufe türkis, Verkäufe rot),
 *                      die grössten je Seite beschriftet: „1 079 BTC · 69 Mio · seit 6 h".
 *
 * Keine Messung der Zukunft: Orders können jederzeit gelöscht werden — das
 * steht im Info-Text des Schalters, nicht hier.
 */
import { zeitZuLogisch, logischZuX } from '../zeichnungen/geometrie.js'
import { usdKurz } from './MarktEbene.js'

const SCHRIFT = '10px -apple-system, "Segoe UI", Roboto, sans-serif'
const KAUF = '38,166,154'
const VERKAUF = '255,105,96'
// Farbverlauf der Heatmap (Anteil 0…1)
const STUFEN = [
    [0, [40, 26, 96]],
    [0.35, [128, 40, 160]],
    [0.65, [232, 96, 60]],
    [0.85, [255, 170, 40]],
    [1, [255, 236, 120]],
]

export function heatFarbe(t) {
    const x = Math.max(0, Math.min(1, t))
    for (let i = 1; i < STUFEN.length; i++) {
        const [b, f1] = STUFEN[i]
        const [a, f0] = STUFEN[i - 1]
        if (x <= b) {
            const u = (x - a) / (b - a)
            return f0.map((c, k) => Math.round(c + (f1[k] - c) * u))
        }
    }
    return STUFEN[STUFEN.length - 1][1]
}

function quantil(werte, p) {
    if (!werte.length) return 0
    const s = [...werte].sort((a, b) => a - b)
    return s[Math.min(s.length - 1, Math.floor(p * s.length))]
}

/** Lesbare Dauer: „12 min", „6 h", „2 T". */
export function dauerKurz(ms) {
    const m = Math.max(0, ms) / 60_000
    if (m < 60) return `${Math.max(1, Math.round(m))} min`
    if (m < 48 * 60) return `${Math.round(m / 60)} h`
    return `${Math.round(m / 1440)} T`
}

function mengeKurz(q) {
    if (q >= 10_000) return `${(q / 1000).toFixed(0)}k`
    if (q >= 1000) return `${(q / 1000).toFixed(1)}k`
    if (q >= 100) return q.toFixed(0)
    return q.toFixed(1)
}

export class BuchKarteEbene {
    constructor({ chart, serie, texte = {} }) {
        this.chart = chart
        this.serie = serie
        this.texte = { seit: 'seit', ...texte }
        this.zeiten = []
        this.iv = 3_600_000
        this.daten = null      // { spalten, stufe, profil, basis }
        this.requestUpdate = () => {}
        const ansicht = (z, fn) => ({
            zOrder: () => z,
            renderer: () => ({ draw: (ziel) => ziel.useMediaCoordinateSpace(({ context, mediaSize }) => fn(context, mediaSize)) }),
        })
        // Heatmap und Profilbalken HINTER den Kerzen (die jüngsten Kerzen stehen am rechten Rand, wo das Profil liegt),
        // nur die Beschriftung der grössten Wände davor
        this._ansichten = [
            ansicht('bottom', (c, g) => { this.heatmap(c, g); this.profil(c, g, 'balken') }),
            ansicht('top', (c, g) => this.profil(c, g, 'schilder')),
        ]
        serie.attachPrimitive(this)
    }

    attached({ requestUpdate }) { this.requestUpdate = requestUpdate }
    detached() { this.requestUpdate = () => {} }
    paneViews() { return this._ansichten }
    updateAllViews() {}
    abbauen() { try { this.serie.detachPrimitive(this) } catch { /* weg */ } }

    setzeKerzen(kerzen, iv) { this.zeiten = kerzen.map((k) => k.t); this.iv = iv; this.requestUpdate() }
    setzeDaten(d) { this.daten = d; this.requestUpdate() }

    zuX(t) { return logischZuX(this.chart.timeScale(), zeitZuLogisch(t, this.zeiten, this.iv)) }

    heatmap(ctx, groesse) {
        const d = this.daten
        if (!d?.spalten?.length || !this.zeiten.length) return
        const { width: breite, height: hoehe } = groesse
        const stufe = d.stufe
        const sichtbar = []
        for (const sp of d.spalten) {
            const x0 = this.zuX(sp.t)
            const x1 = this.zuX(sp.t + this.iv)
            if (x0 == null || x1 == null || x1 < 0 || x0 > breite) continue
            sichtbar.push({ x0, w: Math.max(1, x1 - x0), z: sp.z })
        }
        if (!sichtbar.length) return
        // y je Zeile einmal rechnen — alle Spalten teilen dieselben Zeilen
        const yVon = new Map()
        const y = (z) => {
            let v = yVon.get(z)
            if (v === undefined) {
                const a = this.serie.priceToCoordinate((z + 0.5) * stufe)
                const b = this.serie.priceToCoordinate((z - 0.5) * stufe)
                v = a == null || b == null ? null : [Math.min(a, b), Math.max(1, Math.abs(b - a))]
                yVon.set(z, v)
            }
            return v
        }
        const werte = []
        for (const sp of sichtbar) for (const [z, q] of sp.z) { const r = y(z); if (r && r[0] + r[1] >= 0 && r[0] <= hoehe) werte.push(q) }
        const ref = quantil(werte, 0.95) || 1
        const norm = Math.log1p(3)
        ctx.save()
        for (const sp of sichtbar) {
            for (const [z, q] of sp.z) {
                const r = y(z)
                if (!r || r[0] + r[1] < 0 || r[0] > hoehe) continue
                const t = Math.log1p((q / ref) * 3) / norm
                if (t < 0.06) continue
                const [cr, cg, cb] = heatFarbe(t)
                ctx.fillStyle = `rgba(${cr},${cg},${cb},${(0.18 + 0.62 * Math.min(1, t)).toFixed(3)})`
                ctx.fillRect(sp.x0, r[0], sp.w + 0.5, r[1] + 0.5)
            }
        }
        ctx.restore()
    }

    profil(ctx, groesse, teil) {
        const p = this.daten?.profil
        if (!p) return
        const { width: breite, height: hoehe } = groesse
        const zeile = (preis) => {
            const a = this.serie.priceToCoordinate(preis + p.s / 2)
            const b = this.serie.priceToCoordinate(preis - p.s / 2)
            return a == null || b == null ? null : { y: Math.min(a, b), h: Math.max(1, Math.abs(b - a)), mitte: (a + b) / 2 }
        }
        const alle = [
            ...p.b.map(([preis, q, seit]) => ({ preis, q, seit, rgb: KAUF })),
            ...p.a.map(([preis, q, seit]) => ({ preis, q, seit, rgb: VERKAUF })),
        ].map((e) => ({ ...e, r: zeile(e.preis) })).filter((e) => e.r && e.r.y + e.r.h >= 0 && e.r.y <= hoehe)
        if (!alle.length) return
        const max = Math.max(...alle.map((e) => e.q))
        const lang = Math.min(110, breite * 0.16)
        ctx.save()
        ctx.font = SCHRIFT
        if (teil === 'balken') {
            for (const e of alle) {
                const l = Math.max(1, (e.q / max) * lang)
                ctx.fillStyle = `rgba(${e.rgb},0.4)`
                ctx.fillRect(breite - l, e.r.y, l, Math.max(1, e.r.h - 0.5))
            }
            ctx.restore()
            return
        }
        // Beschriftung: die drei grössten je Seite, ohne Überlappung
        const belegt = []
        for (const rgb of [KAUF, VERKAUF]) {
            const top = alle.filter((e) => e.rgb === rgb).sort((a, b) => b.q - a.q).slice(0, 3)
            for (const e of top) {
                const yM = e.r.mitte
                if (belegt.some((v) => Math.abs(v - yM) < 13)) continue
                belegt.push(yM)
                const text = `${mengeKurz(e.q)} ${this.daten.basis} · ${usdKurz(e.q * e.preis)} · ${this.texte.seit} ${dauerKurz(p.t - e.seit)}`
                const l = Math.max(1, (e.q / max) * lang)
                const w = ctx.measureText(text).width
                const x = breite - l - w - 8
                ctx.fillStyle = 'rgba(10,14,22,0.78)'
                ctx.fillRect(x - 3, yM - 7, w + 6, 13)
                ctx.fillStyle = `rgba(${rgb},1)`
                ctx.fillText(text, x, yM + 3.5)
            }
        }
        ctx.restore()
    }
}
