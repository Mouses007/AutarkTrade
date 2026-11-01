/**
 * Session-Volumenprofil im Kerzen-Pane: je Tag (oder Woche) ein Profil über
 * genau den Kerzen dieser Session, von ihrem linken Rand nach rechts, mit POC
 * und Value Area. Die Marken der laufenden Session reichen auf Wunsch bis
 * zum rechten Rand. Gerechnet mit `vrvpProfil` (aus den Kerzen geschätzt,
 * wie VRVP und das Fixed-Range-Werkzeug); die Abschnitte kommen aus
 * `sessionBereiche` (orderflow.js).
 */
import { vrvpProfil } from './vrvp.js'
import { sessionBereiche, zoneAus } from './orderflow.js'
import { logischZuX } from './zeichnungen/geometrie.js'

function rgba(hex, a) {
    const m = /^#([0-9a-f]{6})$/i.exec(hex || '')
    if (!m) return hex
    const n = parseInt(m[1], 16)
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

export class SessionVpZeichnung {
    constructor({ chart, serie }) {
        this.chart = chart
        this.serie = serie
        this.kerzen = []
        this.p = {}
        this.merk = { schluessel: null, profile: [] }
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

    profile() {
        const k = this.kerzen
        const letzte = k[k.length - 1]
        const schluessel = `${k.length}|${k[0]?.t}|${letzte?.t}|${letzte?.c}|${letzte?.v}|${JSON.stringify(this.p)}`
        if (this.merk.schluessel !== schluessel) {
            const bereiche = sessionBereiche(k, { art: this.p.art || 'tag', zone: zoneAus(this.p.zone), anzahl: Number(this.p.anzahl) || 5 })
            const opt = { zeilen: this.p.zeilen || 48, va: this.p.va ?? 70, volumen: 'gesamt' }
            this.merk = { schluessel, profile: bereiche.map((b) => ({ ...b, pr: vrvpProfil(k, b, opt) })).filter((x) => x.pr) }
        }
        return this.merk.profile
    }

    zeichne(ctx, { width }) {
        if (!this.kerzen.length) return
        const ts = this.chart.timeScale()
        // Kerzenabstand aus zwei Nachbarn — `options().barSpacing` bleibt beim Zoomen auf dem Startwert
        const x0 = ts.logicalToCoordinate(0), x1 = ts.logicalToCoordinate(1)
        const abstand = x0 != null && x1 != null && x1 > x0 ? x1 - x0 : 6
        const p = this.p
        const anteil = Math.max(0.05, Math.min(1, (Number(p.breite) || 60) / 100))
        const vaA = Math.max(0, Math.min(100, Number(p.vaDeck ?? 55))) / 100
        const ausA = Math.max(0, Math.min(100, Number(p.aussenDeck ?? 20))) / 100
        const farbe = p.cAuf || '#5b9cf6'
        ctx.save()
        for (const s of this.profile()) {
            const xa = logischZuX(ts, s.a), xb = logischZuX(ts, s.b)
            if (xa == null || xb == null) continue
            const x1 = xa - abstand / 2, x2 = xb + abstand / 2
            if (x2 < 0 || x1 > width) continue
            const breite = (x2 - x1) * anteil
            for (const b of s.pr.balken) {
                const y1 = this.serie.priceToCoordinate(b.bis), y2 = this.serie.priceToCoordinate(b.von)
                if (y1 == null || y2 == null) continue
                const h = Math.max(1, y2 - y1 - (y2 - y1 > 3 ? 1 : 0))
                ctx.fillStyle = rgba(farbe, b.inVa ? vaA : ausA)
                ctx.fillRect(x1, y1, (b.teile[0]?.anteil || 0) * breite, h)
            }
            const ende = s.laufend && p.verlaengern !== false ? width : x2
            const linie = (preis, f, strich) => {
                const y = this.serie.priceToCoordinate(preis)
                if (y == null) return
                ctx.strokeStyle = f
                ctx.lineWidth = 1
                ctx.setLineDash(strich ? [4, 3] : [])
                ctx.beginPath()
                ctx.moveTo(x1, Math.round(y) + 0.5)
                ctx.lineTo(ende, Math.round(y) + 0.5)
                ctx.stroke()
            }
            if (p.zeigeVa !== false) { linie(s.pr.vp.vah, p.cVa || '#9598a1', true); linie(s.pr.vp.val, p.cVa || '#9598a1', true) }
            if (p.zeigePoc !== false) linie(s.pr.vp.poc, p.cPoc || '#ff5252', false)
        }
        ctx.setLineDash([])
        ctx.restore()
    }
}
