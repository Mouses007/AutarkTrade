/**
 * Strategie-Ebene im Chart: was eine Instanz (oder ein Testlauf) gesehen,
 * eröffnet und gehandelt hat.
 *
 *   Setups     Zone obTief–obHoch ab der Signalkerze bis zur Auslösung (oder bis
 *              heute, solange es wartet); Deckkraft nach Status. Swing Game hat
 *              keine Zone — dort trägt `obHoch/obTief` die beiden EMAs —, es
 *              bekommt seine Linie SCHRÄG: Anker (sweepT, sweepLevel) →
 *              (obT, sweepPrice), verlängert bis zur Auslösung.
 *   Positionen offene Papier-/Schattenpositionen: Einstieg, Stop, Ziel, Liq
 *   Trades     Raute am Einstieg, Quadrat am Ausstieg, Ergebnis in R
 *
 * Bewusst andere Formen als die Journal-Trades (Dreieck/Kreis): im selben Bild
 * soll man auf einen Blick sehen, was man selbst getan hat und was die
 * Strategie getan hat.
 *
 * Bis 31.10.2026 lag diese Ebene als `StrategieEbene` im Chart-Arbeitsplatz;
 * jetzt zeichnet sie im Strategien-Modus (Instanz-Ansicht, Labor, Bibliothek).
 * Daten in der Form von `server/strategie-chart.js` (`setupAus`/`positionAus`/
 * `tradeAus`) bzw. `src/utils/strategien/chartDaten.js` für Testläufe.
 */
import { zeitZuLogisch, ereignisZuLogisch, logischZuX, verlaengere, abstandZuStrecke, imRechteck } from '../zeichnungen/geometrie.js'

const LONG = '38,166,154'
const SHORT = '255,105,96'
const LILA = '#7e57c2'
const ORANGE = '#ff9800'
const SCHRIFT = '10px -apple-system, "Segoe UI", Roboto, sans-serif'
const AKTIV = ['armed', 'waiting_retest']
const VERWORFEN = ['invalidated', 'expired', 'rejected']

export class InstanzEbene {
    constructor({ chart, serie, formatPreis }) {
        this.chart = chart
        this.serie = serie
        this.formatPreis = formatPreis
        this.zeiten = []
        this.iv = 3_600_000
        this.daten = { setups: [], positionen: [], trades: [] }
        this.hervor = null              // 'setup:<id>' | 'trade:<id>'
        this.requestUpdate = () => {}
        this._ansichten = [{
            zOrder: () => 'bottom',
            renderer: () => ({
                draw: (ziel) => ziel.useMediaCoordinateSpace(({ context, mediaSize }) => this.zeichne(context, mediaSize)),
            }),
        }]
        serie.attachPrimitive(this)
    }

    attached({ requestUpdate }) { this.requestUpdate = requestUpdate }
    detached() { this.requestUpdate = () => {} }
    paneViews() { return this._ansichten }
    updateAllViews() {}
    abbauen() { try { this.serie.detachPrimitive(this) } catch { /* weg */ } }

    /** Offene Position: Stop und Ziel gehören ins Bild, auch wenn „Auto" nur die Kerzen einpassen würde. */
    autoscaleInfo() {
        const preise = this.daten.positionen.filter((p) => p.status !== 'closed')
            .flatMap((p) => [p.einstieg, p.stop, p.ziel]).filter((p) => p > 0)
        if (!preise.length) return null
        return { priceRange: { minValue: Math.min(...preise), maxValue: Math.max(...preise) } }
    }

    hitTest(x, y) {
        const t = this.trefferTest(x, y)
        return t ? { cursorStyle: 'pointer', externalId: t.art + ':' + t.id, zOrder: 'normal' } : null
    }

    setzeKerzen(kerzen, iv) { this.zeiten = kerzen.map((k) => k.t); this.iv = iv; this.requestUpdate() }
    setzeDaten(daten) {
        this.daten = {
            setups: daten?.setups || [], positionen: daten?.positionen || [], trades: daten?.trades || [],
        }
        this.requestUpdate()
    }
    hebeHervor(schluessel) { this.hervor = schluessel || null; this.requestUpdate() }

    zuX(t) { return logischZuX(this.chart.timeScale(), zeitZuLogisch(t, this.zeiten, this.iv)) }
    // Ereignisse sitzen IN ihrer Kerze, nicht auf der Teilung zwischen zwei Öffnungen.
    ereignisX(t) { return logischZuX(this.chart.timeScale(), ereignisZuLogisch(t, this.zeiten, this.iv)) }
    zuY(p) { return p == null ? null : this.serie.priceToCoordinate(p) }

    /** Trade oder Setup unter (x, y) — `{ art: 'trade'|'setup', id }`. */
    trefferTest(x, y) {
        const trades = this.daten.trades
        for (let i = trades.length - 1; i >= 0; i--) {
            const tr = trades[i]
            const ex = this.ereignisX(tr.einstieg.t), ey = this.zuY(tr.einstieg.p)
            if (ex == null || ey == null) continue
            if (Math.hypot(x - ex, y - ey) <= 9) return { art: 'trade', id: tr.id }
            if (tr.ausstieg) {
                const ax = this.ereignisX(tr.ausstieg.t), ay = this.zuY(tr.ausstieg.p)
                if (ax == null || ay == null) continue
                if (Math.hypot(x - ax, y - ay) <= 9 || abstandZuStrecke(x, y, ex, ey, ax, ay) <= 4) return { art: 'trade', id: tr.id }
            }
        }
        const breite = this.chart.timeScale().width()
        const setups = this.daten.setups
        for (let i = setups.length - 1; i >= 0; i--) {
            const s = setups[i]
            if (!(s.obHoch && s.obTief) || s.strategyId === 'trendlinien_breakout') continue
            const xa = this.zuX(s.obT), xe = this.endeVon(s, breite)
            const y1 = this.zuY(s.obHoch), y2 = this.zuY(s.obTief)
            if ([xa, xe, y1, y2].some((v) => v == null)) continue
            if (imRechteck(x, y, xa, y1, xe, y2, 2)) return { art: 'setup', id: s.id }
        }
        return null
    }

    zeichne(ctx, groesse) {
        if (!this.zeiten.length) return
        const breite = groesse.width
        ctx.save()
        ctx.font = SCHRIFT
        for (const s of this.daten.setups) this.zeichneSetup(ctx, s, breite)
        for (const p of this.daten.positionen) if (p.status !== 'closed') this.zeichnePosition(ctx, p, breite)
        for (const t of this.daten.trades) this.zeichneTrade(ctx, t, this.hervor === 'trade:' + t.id ? '#ffffff' : LILA, 5)
        ctx.restore()
    }

    text(ctx, text, x, y, farbe) {
        const b = ctx.measureText(text).width
        ctx.fillStyle = 'rgba(19,23,34,0.75)'
        ctx.fillRect(x - 2, y - 9, b + 4, 12)
        ctx.fillStyle = farbe
        ctx.fillText(text, x, y)
    }

    segment(ctx, x1, x2, preis, farbe, strich = []) {
        const y = this.zuY(preis)
        if (y == null) return
        ctx.strokeStyle = farbe
        ctx.lineWidth = 1
        ctx.setLineDash(strich)
        ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke()
        ctx.setLineDash([])
    }

    endeVon(s, breite) {
        if (s.ausgeloestT) return this.zuX(s.ausgeloestT)
        if (AKTIV.includes(s.status)) return breite
        if (s.endeT) return this.zuX(s.endeT)
        return this.zuX((s.obT || 0) + 20 * this.iv)
    }

    zeichneSetup(ctx, s, breite) {
        const xa = this.zuX(s.obT)
        const xe = this.endeVon(s, breite)
        if (xa == null || xe == null || xe < 0 || xa > breite) return
        const rgb = s.richtung === 'short' ? SHORT : LONG
        const verworfen = VERWORFEN.includes(s.status)
        const hervor = this.hervor === 'setup:' + s.id
        const alpha = hervor ? 0.32 : AKTIV.includes(s.status) ? 0.2 : verworfen ? 0.05 : 0.12
        const strich = verworfen ? [4, 3] : []

        if (s.strategyId === 'trendlinien_breakout') {
            const ax = this.zuX(s.sweepT), ay = this.zuY(s.sweepLevel)
            const bx = xa, by = this.zuY(s.sweepPrice)
            if ([ax, ay, by].every((v) => v != null)) {
                // Die Linie läuft bis zur Auslösung bzw. bis heute weiter.
                const v = verlaengere(ax, ay, bx, by, breite, { rechts: true })
                const faktor = bx !== ax ? (xe - ax) / (bx - ax) : 1
                const ex = Math.min(v.bx, xe), ey = ay + (by - ay) * faktor
                ctx.strokeStyle = `rgba(${rgb},${verworfen ? 0.4 : 0.9})`
                ctx.lineWidth = hervor ? 2.5 : 1.5
                ctx.setLineDash(strich)
                ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ex, ey); ctx.stroke()
                ctx.setLineDash([])
            }
        } else if (s.obHoch && s.obTief) {
            const y1 = this.zuY(s.obHoch), y2 = this.zuY(s.obTief)
            if (y1 != null && y2 != null) {
                ctx.fillStyle = `rgba(${rgb},${alpha})`
                ctx.fillRect(xa, y1, xe - xa, y2 - y1)
                ctx.strokeStyle = `rgba(${rgb},${verworfen ? 0.25 : hervor ? 1 : 0.6})`
                ctx.setLineDash(strich)
                ctx.strokeRect(xa, y1, xe - xa, y2 - y1)
                ctx.setLineDash([])
            }
        }
        // Sweep-Marke (das Extrem, das die Strategie „abgeholt" hat).
        if (s.strategyId !== 'trendlinien_breakout' && s.sweepPrice && s.sweepT) {
            const sx = this.zuX(s.sweepT), sy = this.zuY(s.sweepPrice)
            if (sx != null && sy != null) {
                ctx.fillStyle = `rgba(${rgb},0.9)`
                ctx.beginPath(); ctx.arc(sx, sy, 2.5, 0, Math.PI * 2); ctx.fill()
            }
        }
        if (s.einstieg > 0) {
            const x0 = s.ausgeloestT ? this.zuX(s.ausgeloestT) : xa
            const x1 = Math.max(xe, (x0 ?? xa) + 40)
            this.segment(ctx, x0 ?? xa, x1, s.einstieg, '#e0e0e0', strich)
            if (s.stop > 0) this.segment(ctx, x0 ?? xa, x1, s.stop, `rgb(${SHORT})`, [3, 3])
            if (s.ziel > 0) this.segment(ctx, x0 ?? xa, x1, s.ziel, `rgb(${LONG})`, [3, 3])
        }
        if (hervor || AKTIV.includes(s.status)) {
            const y = this.zuY(s.richtung === 'short' ? s.obHoch || s.sweepPrice : s.obTief || s.sweepPrice)
            if (y != null && xa >= -60) {
                this.text(ctx, `${s.richtung === 'short' ? 'Short' : 'Long'} · ${s.statusText || s.status}`,
                    Math.max(2, xa + 2), y + (s.richtung === 'short' ? -4 : 12), `rgb(${rgb})`)
            }
        }
    }

    zeichnePosition(ctx, p, breite) {
        const x = this.ereignisX(p.einstiegT)
        if (x == null) return
        const x0 = Math.max(0, x)
        this.segment(ctx, x0, breite, p.einstieg, LILA)
        if (p.stop) this.segment(ctx, x0, breite, p.stop, `rgb(${SHORT})`, [3, 3])
        if (p.ziel) this.segment(ctx, x0, breite, p.ziel, `rgb(${LONG})`, [3, 3])
        if (p.liq) this.segment(ctx, x0, breite, p.liq, ORANGE, [1, 3])
        const y = this.zuY(p.einstieg)
        if (y != null) this.text(ctx, `${p.richtung === 'short' ? 'Short' : 'Long'} offen`, x0 + 4, y - 4, LILA)
    }

    zeichneTrade(ctx, t, farbe, g) {
        const ex = this.ereignisX(t.einstieg.t), ey = this.zuY(t.einstieg.p)
        if (ex == null || ey == null) return
        const ax = t.ausstieg ? this.ereignisX(t.ausstieg.t) : null
        const ay = t.ausstieg ? this.zuY(t.ausstieg.p) : null
        if (ax != null && ay != null) {
            ctx.strokeStyle = farbe
            ctx.lineWidth = 1
            ctx.setLineDash([2, 2])
            ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ax, ay); ctx.stroke()
            ctx.setLineDash([])
        }
        ctx.fillStyle = farbe
        ctx.beginPath()
        ctx.moveTo(ex, ey - g); ctx.lineTo(ex + g, ey); ctx.lineTo(ex, ey + g); ctx.lineTo(ex - g, ey)
        ctx.closePath(); ctx.fill()
        if (ax != null && ay != null) {
            const gut = (t.r ?? 0) >= 0
            ctx.fillStyle = gut ? `rgb(${LONG})` : `rgb(${SHORT})`
            ctx.fillRect(ax - g + 1, ay - g + 1, 2 * g - 2, 2 * g - 2)
            if (t.r != null) this.text(ctx, `${t.r >= 0 ? '+' : ''}${t.r.toFixed(2)}R`, ax + g + 2, ay + 3, farbe)
        }
    }
}
