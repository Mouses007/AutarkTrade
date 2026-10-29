/**
 * Zeichnung des VRVP im Kerzen-Pane: Balken je Preiszeile vom rechten (oder
 * linken) Rand nach innen, Value Area kräftiger, POC als Linie. Das Profil
 * hängt am sichtbaren Bereich — es wird bei jedem Neuzeichnen (Scrollen,
 * Zoomen, neue Kerze) aus den gerade sichtbaren Kerzen gerechnet, mit einem
 * Zwischenspeicher, solange sich Bereich und letzte Kerze nicht ändern.
 */
import { sichtbareKerzen, vrvpProfil } from './vrvp.js'

function rgba(hex, a) {
    const m = /^#([0-9a-f]{6})$/i.exec(hex || '')
    if (!m) return hex
    const n = parseInt(m[1], 16)
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

export class VrvpZeichnung {
    constructor({ chart, serie }) {
        this.chart = chart
        this.serie = serie
        this.kerzen = []
        this.p = {}
        this.merk = { schluessel: null, profil: null }
        this.requestUpdate = () => {}
        this._ansicht = {
            zOrder: () => 'bottom',
            renderer: () => ({ draw: (ziel) => ziel.useMediaCoordinateSpace(({ context, mediaSize }) => this.zeichne(context, mediaSize)) }),
        }
        serie.attachPrimitive(this)
    }

    attached({ requestUpdate }) { this.requestUpdate = requestUpdate }
    detached() { this.requestUpdate = () => {} }
    paneViews() { return [this._ansicht] }
    updateAllViews() {}
    abbauen() { try { this.serie.detachPrimitive(this) } catch { /* weg */ } }

    setze(kerzen, p = {}) {
        this.kerzen = kerzen || []
        this.p = p || {}
        this.requestUpdate()
    }

    tick() {
        try { return Number(this.serie.options().priceFormat?.minMove) || 0 } catch { return 0 }
    }

    profil() {
        const r = this.chart.timeScale().getVisibleLogicalRange()
        const bereich = r ? sichtbareKerzen(this.kerzen.length, r.from, r.to) : null
        if (!bereich) return null
        const letzte = this.kerzen[bereich.b]
        const schluessel = `${bereich.a}|${bereich.b}|${this.kerzen.length}|${letzte?.t}|${letzte?.c}|${letzte?.v}|${JSON.stringify(this.p)}`
        if (this.merk.schluessel !== schluessel) this.merk = { schluessel, profil: vrvpProfil(this.kerzen, bereich, this.p, this.tick()) }
        return this.merk.profil
    }

    zeichne(ctx, { width }) {
        const pr = this.profil()
        if (!pr) return
        const p = this.p
        const breite = width * Math.max(0.05, Math.min(1, (Number(p.breite) || 30) / 100))
        const rechts = p.platz !== 'links'
        const vaA = Math.max(0, Math.min(100, Number(p.vaDeck ?? 70))) / 100
        const ausA = Math.max(0, Math.min(100, Number(p.aussenDeck ?? 30))) / 100
        const farbe = { auf: p.cAuf || '#5b9cf6', ab: p.cAb || '#fbc02d', gesamt: p.cAuf || '#5b9cf6' }
        ctx.save()
        for (const b of pr.balken) {
            const y1 = this.serie.priceToCoordinate(b.bis)
            const y2 = this.serie.priceToCoordinate(b.von)
            if (y1 == null || y2 == null) continue
            const h = Math.max(1, y2 - y1 - (y2 - y1 > 3 ? 1 : 0))
            let x = 0
            for (const teil of b.teile) {
                const l = teil.anteil * breite
                ctx.fillStyle = rgba(farbe[teil.art], b.inVa ? vaA : ausA)
                ctx.fillRect(rechts ? width - x - l : x, y1, l, h)
                x += l
            }
        }
        const linie = (preis, f, strich) => {
            const y = this.serie.priceToCoordinate(preis)
            if (y == null) return
            ctx.strokeStyle = f
            ctx.lineWidth = 1
            ctx.setLineDash(strich ? [4, 3] : [])
            ctx.beginPath()
            ctx.moveTo(rechts ? width - breite : 0, Math.round(y) + 0.5)
            ctx.lineTo(rechts ? width : breite, Math.round(y) + 0.5)
            ctx.stroke()
        }
        if (p.zeigeVa) { linie(pr.vp.vah, p.cVa || '#9598a1', true); linie(pr.vp.val, p.cVa || '#9598a1', true) }
        if (p.zeigePoc !== false) linie(pr.vp.poc, p.cPoc || '#ff5252', false)
        ctx.restore()
    }
}
