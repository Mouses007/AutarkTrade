/**
 * Was ein Aktien-Future im Chart von einem Coin unterscheidet — zwei Ebenen,
 * jede mit eigenem Schalter (`liste.js`: `sitzungen`, `zahlen`):
 *
 *   Börsensitzungen  Die Zeiten ausserhalb der regulären US-Sitzung sind
 *                    hinterlegt: vor- und nachbörslich, Nacht, geschlossen
 *                    (Wochenende, US-Feiertag). Nur bis 4h; auch rechts der
 *                    letzten Kerze, damit man sieht, was kommt.
 *   Quartalszahlen   Senkrechte Linie am Meldezeitpunkt jedes bekannten
 *                    Termins, das Zahlen-Fenster (ein Tag davor bis ein Tag
 *                    danach, wie in der Simulation) als schwache Fläche, unten
 *                    ein Schild. Der nächste Termin ist gestrichelt, solange er
 *                    geschätzt ist; liegt er rechts ausserhalb des Bilds, steht
 *                    sein Schild am rechten Rand. Ein Klick auf ein Schild
 *                    (oder den Fuss der Linie) öffnet im Panel die Karte zum
 *                    Termin — die Ebene liefert dafür nur den Treffer
 *                    (`trefferTest`), die Karte zeichnet `ZahlenKarte.vue`.
 *
 * Die Ebene wird nur für Aktien-Futures angelegt — ein Coin-Chart hat sie nicht.
 * Unbekannte Termine (`null`) zeichnen nichts.
 *
 * Zeiten in ms; die Abschnitte rechnet `sitzungsAbschnitte.js` (rein).
 */
import { zeitZuLogisch, ereignisZuLogisch, logischZuX } from '../zeichnungen/geometrie.js'
import { sitzungsAbschnitte, zahlenMarken, SITZUNG_BIS_MS } from '../sitzungsAbschnitte.js'
import { FENSTER_VOR_MS, FENSTER_NACH_MS } from '../../../../shared/aktien-zahlen.js'

const SCHRIFT = '10px -apple-system, "Segoe UI", Roboto, sans-serif'
// Deckkraft der Flächen — die Farben selbst kommen aus den Design-Token (ChartPanel).
const DECKKRAFT = { rand: 0.07, nacht: 0.09, zu: 0.15 }
const DECKKRAFT_FENSTER = 0.07
// So weit rechts der letzten Kerze wird höchstens vorausgerechnet.
const ZUKUNFT_MAX = 3000

export class AktienEbene {
    /**
     * @param {object} o
     * @param {object} o.chart, o.serie   Lightweight Charts
     * @param {{rand: string, nacht: string, zu: string, zahlen: string, grund: string}} o.farben  CSS-Farben
     * @param {{zahlen: string, heute: string, morgen: string, inTagen: (n: number) => string, voraussichtlich: string}} o.texte
     */
    constructor({ chart, serie, farben, texte }) {
        this.chart = chart
        this.serie = serie
        this.farben = farben
        this.texte = texte
        this.zeiten = []
        this.iv = 3_600_000
        this.sitzungenAn = false
        this.termine = null
        this.merker = new Map()      // Öffnungszeit → Art, gilt für `merkerIv`
        this.merkerIv = 0
        this.abschnitte = []
        this.zukunft = 0             // so viele gedachte Kerzen rechts sind in `abschnitte` enthalten
        this.flaechen = []           // zuletzt gezeichnete Schilder [{m, text, x, y, b}] — für `trefferTest`
        this.linien = []             // zuletzt gezeichnete Linien (Marken mit `xLinie` im Bild)
        this.hoehe = 0
        this.requestUpdate = () => {}
        const ansicht = (z, fn) => ({
            zOrder: () => z,
            renderer: () => ({ draw: (ziel) => ziel.useMediaCoordinateSpace(({ context, mediaSize }) => fn(context, mediaSize)) }),
        })
        // Flächen und Linien hinter den Kerzen, die Schilder davor.
        this._ansichten = [ansicht('bottom', (c, g) => this.unten(c, g)), ansicht('top', (c, g) => this.oben(c, g))]
        serie.attachPrimitive(this)
    }

    attached({ requestUpdate }) { this.requestUpdate = requestUpdate }
    detached() { this.requestUpdate = () => {} }
    paneViews() { return this._ansichten }
    updateAllViews() {}
    abbauen() { try { this.serie.detachPrimitive(this) } catch { /* weg */ } }

    setzeKerzen(kerzen, iv) {
        this.zeiten = kerzen.map((k) => k.t)
        this.iv = iv
        this.rechne()
        this.requestUpdate()
    }
    setzeSitzungen(an) {
        if (this.sitzungenAn === !!an) return
        this.sitzungenAn = !!an
        this.rechne()
        this.requestUpdate()
    }
    /** `{naechster, vergangene}` — null = unbekannt oder ausgeschaltet. */
    setzeTermine(termine) {
        this.termine = termine || null
        if (!this.termine) { this.flaechen = []; this.linien = [] }
        this.requestUpdate()
    }

    /** Abschnitte neu bilden, samt `zukunft` gedachten Kerzen rechts der letzten. */
    rechne(zukunft = this.zukunft) {
        this.abschnitte = []
        this.zukunft = 0
        const n = this.zeiten.length
        if (!this.sitzungenAn || !n || !(this.iv > 0) || this.iv > SITZUNG_BIS_MS) return
        if (this.merkerIv !== this.iv || this.merker.size > 50_000) { this.merker.clear(); this.merkerIv = this.iv }
        const letzte = this.zeiten[n - 1]
        const alle = this.zeiten.slice()
        for (let k = 1; k <= zukunft; k++) alle.push(letzte + k * this.iv)
        this.abschnitte = sitzungsAbschnitte(alle, this.iv, this.merker)
        this.zukunft = zukunft
    }

    x(L) { return logischZuX(this.chart.timeScale(), L) }

    unten(ctx, groesse) {
        const sicht = this.chart.timeScale().getVisibleLogicalRange()
        if (!sicht || !this.zeiten.length) return
        ctx.save()
        if (this.sitzungenAn && this.iv <= SITZUNG_BIS_MS) this.zeichneSitzungen(ctx, groesse, sicht)
        if (this.termine) this.zeichneZahlen(ctx, groesse)
        ctx.restore()
    }

    zeichneSitzungen(ctx, groesse, sicht) {
        // Reicht das Bild rechts über die Kerzen hinaus, die Sitzungen dort vorausrechnen (in Schüben, nicht je Bild).
        const noetig = Math.min(ZUKUNFT_MAX, Math.max(0, Math.ceil(sicht.to) - (this.zeiten.length - 1)))
        if (noetig > this.zukunft) this.rechne(Math.min(ZUKUNFT_MAX, noetig + 200))
        for (const a of this.abschnitte) {
            if (a.bis + 0.5 < sicht.from || a.von - 0.5 > sicht.to) continue
            const x1 = Math.max(0, this.x(Math.max(a.von - 0.5, sicht.from - 1)) ?? 0)
            const x2 = Math.min(groesse.width, this.x(Math.min(a.bis + 0.5, sicht.to + 1)) ?? groesse.width)
            if (!(x2 > x1)) continue
            ctx.globalAlpha = DECKKRAFT[a.art]
            ctx.fillStyle = this.farben[a.art]
            ctx.fillRect(x1, 0, x2 - x1, groesse.height)
        }
        ctx.globalAlpha = 1
    }

    /** Marken mit x-Lage; `xLinie` null = ausserhalb der Rechenweite. */
    marken() {
        return zahlenMarken(this.termine).map((m) => ({
            ...m,
            xLinie: this.x(ereignisZuLogisch(m.zeit, this.zeiten, this.iv)),
            xVon: this.x(zeitZuLogisch(m.zeit - FENSTER_VOR_MS, this.zeiten, this.iv)),
            xBis: this.x(zeitZuLogisch(m.zeit + FENSTER_NACH_MS, this.zeiten, this.iv)),
        }))
    }

    zeichneZahlen(ctx, groesse) {
        for (const m of this.marken()) {
            if (m.xLinie == null) continue
            if (m.xVon != null && m.xBis != null && m.xBis > 0 && m.xVon < groesse.width) {
                const x1 = Math.max(0, m.xVon), x2 = Math.min(groesse.width, m.xBis)
                ctx.globalAlpha = DECKKRAFT_FENSTER
                ctx.fillStyle = this.farben.zahlen
                ctx.fillRect(x1, 0, x2 - x1, groesse.height)
            }
            if (m.xLinie < -1 || m.xLinie > groesse.width + 1) continue
            ctx.globalAlpha = 0.75
            ctx.strokeStyle = this.farben.zahlen
            ctx.lineWidth = 1
            ctx.setLineDash(m.geschaetzt ? [4, 4] : [])
            const x = Math.round(m.xLinie) + 0.5
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, groesse.height); ctx.stroke()
        }
        ctx.setLineDash([])
        ctx.globalAlpha = 1
    }

    schildText(m) {
        if (!m.kommend) return this.texte.zahlen
        const wann = m.tage === 0 ? this.texte.heute : m.tage === 1 ? this.texte.morgen : this.texte.inTagen(m.tage)
        return m.geschaetzt ? `${wann} (${this.texte.voraussichtlich})` : wann
    }

    oben(ctx, groesse) {
        this.flaechen = []
        this.linien = []
        this.hoehe = groesse.height
        if (!this.termine || !this.zeiten.length) return
        ctx.save()
        ctx.font = SCHRIFT
        ctx.textBaseline = 'middle'
        const marken = this.marken()
        const schilder = schildFlaechen(marken, groesse, (m) => this.schildText(m), (text) => ctx.measureText(text).width)
        for (const { m, text, x, y, b } of schilder) {
            ctx.globalAlpha = 0.9
            ctx.fillStyle = this.farben.grund
            ctx.fillRect(x, y - 8, b, 16)
            ctx.globalAlpha = 1
            ctx.strokeStyle = this.farben.zahlen
            ctx.lineWidth = 1
            ctx.setLineDash(m.geschaetzt ? [3, 3] : [])
            ctx.strokeRect(x + 0.5, y - 7.5, b - 1, 15)
            ctx.setLineDash([])
            ctx.fillStyle = this.farben.zahlen
            ctx.fillText(text, x + 5, y + 0.5)
        }
        ctx.restore()
        // Für die Trefferabfrage: was eben gezeichnet wurde — Schilder und die Linien im Bild.
        this.flaechen = schilder
        this.linien = marken.filter((m) => m.xLinie != null && m.xLinie >= -1 && m.xLinie <= groesse.width + 1)
    }

    /**
     * Welcher Termin liegt unter dem Punkt (Pixel im Kursfenster)? Erst die
     * Schilder, dann der Fuss einer Linie. Gilt für das zuletzt gezeichnete Bild.
     * @param {number} [spiel]  Zugabe um das Schild in Pixeln (Finger brauchen mehr)
     * @returns {{zeit: number, kommend: boolean, geschaetzt: boolean, tage: number|null}|null}
     */
    trefferTest(x, y, spiel = 3) {
        if (!this.termine) return null
        const m = schildTreffer(this.flaechen, this.linien, x, y, this.hoehe, spiel)
        return m ? { zeit: m.zeit, kommend: m.kommend, geschaetzt: m.geschaetzt, tage: m.tage } : null
    }

    /** Lightweight Charts fragt hier nach dem Mauszeiger: über einem Schild die Hand. */
    hitTest(x, y) {
        const m = this.trefferTest(x, y)
        return m ? { cursorStyle: 'pointer', externalId: 'zahlen:' + m.zeit, zOrder: 'normal' } : null
    }
}

/** Höhe des Streifens am unteren Rand, in dem auch die Linie selbst als Treffer zählt. */
export const LINIEN_FUSS = 26

/**
 * Wo die Schilder stehen. Rein — `messe(text)` liefert die Textbreite in Pixeln.
 * Wird es eng, gewinnt der kommende Termin, danach der jeweils jüngere; ein
 * verdrängtes Schild fehlt in der Liste (seine Linie bleibt anklickbar).
 *
 * @param {{zeit: number, kommend: boolean, geschaetzt: boolean, xLinie: number|null}[]} marken
 * @param {{width: number, height: number}} groesse
 * @returns {{m: object, text: string, x: number, y: number, b: number}[]}  `y` = Mitte, Höhe 16
 */
export function schildFlaechen(marken, groesse, textVon, messe) {
    const y = groesse.height - 12
    const schilder = []
    for (const m of marken) {
        if (m.xLinie == null || m.xLinie < -1) continue
        const draussen = m.xLinie > groesse.width - 4
        // Rechts ausserhalb zeigt nur der kommende Termin ein Schild — mit Pfeil, am Rand.
        if (draussen && !m.kommend) continue
        const text = textVon(m) + (draussen ? ' →' : '')
        const b = messe(text) + 10
        let x = draussen ? groesse.width - b - 4 : Math.round(m.xLinie) + 4
        // Passt das Schild rechts der Linie nicht mehr ins Bild, steht es links davon.
        if (!draussen && x + b > groesse.width - 2) x = Math.round(m.xLinie) - b - 4
        schilder.push({ m, text, x, y, b })
    }
    schilder.sort((p, q) => (q.m.kommend - p.m.kommend) || (q.m.zeit - p.m.zeit))
    const aus = []
    for (const s of schilder) {
        if (aus.some((o) => s.x < o.x + o.b + 4 && s.x + s.b > o.x - 4)) continue
        aus.push(s)
    }
    return aus
}

/**
 * Treffer auf ein Schild (mit `spiel` Pixeln Zugabe) oder auf den Fuss einer
 * Linie (unterste `LINIEN_FUSS` Pixel, ±(spiel + 2) um die Linie). Rein.
 * Schilder gehen vor; unter mehreren Linien gewinnt die nächste.
 * @returns {object|null}  die Marke
 */
export function schildTreffer(flaechen, linien, x, y, hoehe, spiel = 3) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    for (const f of flaechen || []) {
        if (x >= f.x - spiel && x <= f.x + f.b + spiel && y >= f.y - 8 - spiel && y <= f.y + 8 + spiel) return f.m
    }
    if (!(hoehe > 0) || y < hoehe - LINIEN_FUSS || y > hoehe) return null
    let best = null
    for (const m of linien || []) {
        const d = Math.abs(x - m.xLinie)
        if (d <= spiel + 2 && (!best || d < best.d)) best = { m, d }
    }
    return best ? best.m : null
}
