/**
 * Volumen-Kerzen: die Körperbreite einer Kerze folgt ihrem Volumen. Schalter je
 * Panel (`panel.volumenBreite`), in der Kopfleiste (Kerzenansicht) und im
 * Kerzenfarben-Fenster (Doppelklick auf eine Kerze).
 *
 * Breite in KERZENABSTÄNDEN, gemessen an TradingView (BTCUSDT 1h, 01.11.2026): eine
 * ruhige Kerze ½ Abstand, eine normale gut ¾, die grösste im sichtbaren Bereich 2 —
 * sie ragt über die Nachbarn hinaus, wie dort. Linear dazwischen:
 * 0.5 + 1.5 · Volumen / grösstes Volumen. Die Fassungen davor waren unbrauchbar:
 * am gleitenden Median sahen alle Kerzen gleich aus, linear bis 8 % herunter wurden
 * fast alle zu 1-px-Strichen. Gefüllt in beiden Richtungen — eine hohle schmale
 * Kerze sieht man nicht.
 *
 * Gezeichnet wird von `VolumenKerzenZeichnung` über der (dann durchsichtigen)
 * Kerzenserie — die Serie bleibt, damit Preisachse, Fadenkreuz, Legende und alle
 * anderen Ebenen unverändert an ihr hängen.
 */
import { logischZuX } from './zeichnungen/geometrie.js'
import { mitDeckkraft } from './kerzenFarben.js'

export const BREITE_MIN = 0.5
export const BREITE_MAX = 2
/** Ohne brauchbares Volumen: etwa die Breite einer normalen Kerze. */
export const BREITE_OHNE = 0.8

/** Grösstes Volumen der Kerzen [von, bis] (Indizes, inklusive); 0, wenn keines brauchbar ist. */
export function groesstesVolumen(kerzen, von, bis) {
    let max = 0
    for (let i = Math.max(0, von); i <= Math.min(bis, (kerzen?.length || 0) - 1); i++) {
        const v = Number(kerzen[i]?.v)
        if (Number.isFinite(v) && v > max) max = v
    }
    return max
}

/** Körperbreite in Kerzenabständen (BREITE_MIN … BREITE_MAX). */
export function volumenBreite(v, max) {
    const x = Number(v)
    if (!(max > 0) || !Number.isFinite(x) || x < 0) return BREITE_OHNE
    return BREITE_MIN + (BREITE_MAX - BREITE_MIN) * Math.min(1, x / max)
}

/** Series-Primitive: zeichnet die Kerzen mit volumenabhängiger Körperbreite. */
export class VolumenKerzenZeichnung {
    /**
     * @param {object} o
     * @param o.chart, o.serie   Lightweight-Charts-Objekte
     * @param o.kerzen           () => Kerzenliste {t,o,h,l,c,v}
     * @param o.stil             () => {steigend, fallend} (kerzenFarben.js)
     * @param o.farbeJe          (i) => Einzelfarbe einer Kerze (Vektorkerzen) oder null
     */
    constructor({ chart, serie, kerzen, stil, farbeJe }) {
        this.chart = chart
        this.serie = serie
        this.kerzen = kerzen
        this.stil = stil
        this.farbeJe = farbeJe
        this.an = false
        this.requestUpdate = () => {}
        this._ansicht = {
            zOrder: () => 'normal',
            renderer: () => ({ draw: (ziel) => ziel.useMediaCoordinateSpace(({ context, mediaSize }) => this.zeichne(context, mediaSize)) }),
        }
        serie.attachPrimitive(this)
    }

    attached({ requestUpdate }) { this.requestUpdate = requestUpdate }
    detached() { this.requestUpdate = () => {} }
    paneViews() { return [this._ansicht] }
    updateAllViews() {}
    abbauen() { try { this.serie.detachPrimitive(this) } catch { /* weg */ } }

    setzeAn(an) { this.an = !!an; this.requestUpdate() }

    zeichne(ctx, { width }) {
        const liste = this.kerzen() || []
        if (!this.an || !liste.length) return
        const ts = this.chart.timeScale()
        const r = ts.getVisibleLogicalRange()
        if (!r) return
        // Kerzenabstand aus zwei Nachbarn — `options().barSpacing` bleibt beim Zoomen auf dem Startwert
        const x0 = ts.logicalToCoordinate(0), x1 = ts.logicalToCoordinate(1)
        const abstand = x0 != null && x1 != null && x1 > x0 ? x1 - x0 : 6
        const f = this.stil()
        const von = Math.max(0, Math.floor(r.from) - 1), bis = Math.min(liste.length - 1, Math.ceil(r.to) + 1)
        if (bis < von) return
        // Massstab nur über die wirklich sichtbaren Kerzen
        const max = groesstesVolumen(liste, Math.ceil(r.from), Math.floor(r.to))
        // Kleine zuerst: eine breite Kerze ragt über die Nachbarn und liegt dann obenauf
        const reihe = []
        for (let i = von; i <= bis; i++) reihe.push(i)
        reihe.sort((a, b) => (Number(liste[a].v) || 0) - (Number(liste[b].v) || 0))
        ctx.save()
        ctx.lineWidth = 1
        for (const i of reihe) {
            const k = liste[i]
            const x = logischZuX(ts, i)
            if (x == null || x < -abstand || x > width + abstand) continue
            const yO = this.serie.priceToCoordinate(k.o), yC = this.serie.priceToCoordinate(k.c)
            const yH = this.serie.priceToCoordinate(k.h), yL = this.serie.priceToCoordinate(k.l)
            if ([yO, yC, yH, yL].some((y) => y == null)) continue
            const steigt = k.c >= k.o
            const eigen = this.farbeJe(i)
            const rand = eigen || (steigt ? f.steigend : f.fallend)
            const fuellung = eigen || mitDeckkraft(steigt ? f.steigend : f.fallend, 0.9)
            const xm = Math.round(x) + 0.5
            const b = Math.max(1, Math.round(abstand * volumenBreite(k.v, max)))
            const links = Math.round(x - b / 2)
            const oben = Math.round(Math.min(yO, yC)), h = Math.max(1, Math.round(Math.abs(yC - yO)))
            // Docht oben und unten
            ctx.strokeStyle = rand
            ctx.beginPath()
            ctx.moveTo(xm, Math.min(yH, yL))
            ctx.lineTo(xm, oben)
            ctx.moveTo(xm, oben + h)
            ctx.lineTo(xm, Math.max(yH, yL))
            ctx.stroke()
            // Körper
            ctx.fillStyle = fuellung
            ctx.fillRect(links, oben, b, h)
            if (b >= 3 && h >= 3) {
                ctx.strokeStyle = rand
                ctx.strokeRect(links + 0.5, oben + 0.5, b - 1, h - 1)
            }
        }
        ctx.restore()
    }
}
