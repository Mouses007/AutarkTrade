/**
 * Footprint im Kerzen-Pane: je Kerze die Preisstufen mit Verkäufen und Käufen.
 * Darstellung nach dem Vorbild von ATAS, TradingView und LuxAlgo (01.11.2026 —
 * die erste Fassung mit gleich grossen Zahlenzellen je Stufe war unruhig):
 *
 *   profil  (Vorgabe) Verkäufe als Balken nach links, Käufe nach rechts von einer
 *           Mittelachse, Länge = Menge (je Kerze am grössten Wert gemessen)
 *   zellen  zwei Zellenspalten je Stufe, Stärke der Farbe = Menge
 *   delta   ein Balken je Stufe von der Mitte aus: Kaufüberhang rechts, Verkauf links
 *
 * Immer dazu (abschaltbar): Value Area je Kerze hinterlegt (70 % um den POC), der
 * POC umrahmt, Imbalance als senkrechte Linie (Kauf rechts der Stufe, Verkauf links),
 * Stapel-Imbalancen als Zone nach rechts bis zur ersten Berührung, Kennzahlen-Zeilen
 * (Volumen, Delta, Delta %) unten im Pane, beim Darüberfahren die Zeile im Detail.
 *
 * Zoom: unter AB_FLAECHEN px je Kerze bleiben normale Kerzen stehen, nur der POC je
 * Kerze als gelber Strich. Darüber blendet ChartPanel die Kerzenserie aus
 * (`zellen`-Rückruf), und der Footprint zeichnet jede Kerze als schmalen Balken links
 * ihrer Spalte. Wird eine Zeile niedriger als lesbar, werden Stufen zusammengefasst
 * (`fasseZusammen`). Zahlen erst ab AB_ZAHLEN px und nur, wenn sie mindestens 5 %
 * des grössten Werts der Kerze ausmachen; der grösste je Seite fett.
 *
 * Datenlücken: der Server liefert die lückenlos aufgezeichneten Abschnitte; eine
 * Kerze, in der die Aufzeichnung beginnt oder endet, ist gestrichelt umrahmt und
 * trägt „unvollst." statt eines Deltas, eine ganz ohne Aufzeichnung „keine Daten".
 *
 * Daten: `/api/chart/footprint` (eigene aggTrade-Aufzeichnung), über
 * `setzeExtern('footprint', …)`.
 */
import { werteKerze, fasseZusammen, valueArea, stapelZonen, abdeckung } from '../../../shared/footprint.js'
import { logischZuX } from './zeichnungen/geometrie.js'
import { mitDeckkraft } from './kerzenFarben.js'

const GRUEN = [38, 166, 154]
const ROT = [239, 83, 80]
const GELB = '#f5c542'
const farbe = ([r, g, b], a) => `rgba(${r},${g},${b},${a})`
// Breiten in px je Kerze, ab denen Zahlen bzw. Stufen gezeichnet werden
export const AB_ZAHLEN = 64
// Unter 28 px je Kerze waren die Zellen nur farbiges Rauschen über den Kerzen (01.11.2026,
// BTCUSDT 15m) — darunter bleibt die normale Kerze, nur der POC als gelber Strich.
export const AB_FLAECHEN = 28
// Mindesthöhe einer Zeile in px: mit Zahlen 12, sonst 5 — darunter werden Stufen zusammengefasst
const ZEILE_ZAHLEN = 12
const ZEILE_MIN = 5
// Kennzahlen-Zeilen unten im Pane: Höhe je Zeile, ab dieser Spaltenbreite
const KZ_ZEILE = 14
const KZ_AB = 34
// Zahlen unter diesem Anteil am grössten Wert der Kerze bleiben weg (0.004 neben 134 ist Rauschen)
const ZAHL_AB_ANTEIL = 0.05
const SCHRIFT = '-apple-system, "Segoe UI", Roboto, sans-serif'

/** Menge kurz: 1234 → 1.2k, 0.0123 → 0.012. */
export function kurzMenge(x) {
    const a = Math.abs(x)
    if (a >= 1e6) return `${(x / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`
    if (a >= 1e3) return `${(x / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k`
    if (a >= 100) return x.toFixed(0)
    if (a >= 1) return x.toFixed(1).replace(/\.0$/, '')
    if (a === 0) return '0'
    return Number(x.toPrecision(2)).toString()
}

/** Faktor m, um den Stufen zusammengefasst werden, damit eine Zeile `ziel` px hoch ist. */
export function zusammenfassFaktor(zeilePx, ziel) {
    if (!(zeilePx > 0)) return 1
    return zeilePx >= ziel ? 1 : Math.ceil(ziel / zeilePx)
}

export class FootprintZeichnung {
    /**
     * @param o.stil    () => Kerzenfarben {steigend, fallend} — in der Stufenansicht zeichnet
     *                  der Footprint die Kerze selbst (schmaler Balken links in der Spalte)
     * @param o.zellen  (an) => die Kerzenserie aus-/einblenden, sobald Stufen stehen
     */
    constructor({ chart, serie, stil = null, zellen = null }) {
        this.chart = chart
        this.serie = serie
        this.stil = stil
        this.zellenMelden = zellen
        this.zellenAn = false
        this.daten = null
        this.kerzen = []
        this.p = {}
        this.merk = new Map()
        this.zeiger = null
        this.treffer = []            // [{x1, x2, y1, y2, info}] der letzten Zeichnung, für den Tooltip
        this.requestUpdate = () => {}
        this._ansicht = {
            zOrder: () => 'top',
            renderer: () => ({ draw: (ziel) => ziel.useMediaCoordinateSpace(({ context, mediaSize }) => this.zeichne(context, mediaSize)) }),
        }
        serie.attachPrimitive(this)
    }

    attached({ requestUpdate }) { this.requestUpdate = requestUpdate }
    detached() { this.requestUpdate = () => {} }
    paneViews() { return [this._ansicht] }
    updateAllViews() {}
    abbauen() { this.meldeZellen(false); try { this.serie.detachPrimitive(this) } catch { /* weg */ } }

    setze(daten, kerzen, p = {}) {
        if (daten !== this.daten || JSON.stringify(p) !== JSON.stringify(this.p)) this.merk = new Map()
        this.daten = daten || null
        this.kerzen = kerzen || []
        this.p = p || {}
        this.requestUpdate()
    }

    /** Zeiger im Pane (px) oder null — für den Tooltip einer Zeile. */
    setzeZeiger(punkt) {
        const neu = punkt && Number.isFinite(punkt.x) ? { x: punkt.x, y: punkt.y } : null
        if (!neu && !this.zeiger) return
        this.zeiger = neu
        this.requestUpdate()
    }

    /** Zellenansicht an/aus nach aussen melden — nur beim Wechsel, ausserhalb des Zeichnens. */
    meldeZellen(an) {
        if (an === this.zellenAn) return
        this.zellenAn = an
        if (this.zellenMelden) queueMicrotask(() => this.zellenMelden(an))
    }

    /** Zusammengefasste Zeilen und Auswertung je Kerze, zwischengespeichert. */
    auswertung(k, m, minVol) {
        const schluessel = `${k.t}|${m}|${minVol}`
        let w = this.merk.get(schluessel)
        if (!w) {
            const stufe = (this.daten?.stufe || 0) * m
            const zeilen = fasseZusammen(k.zeilen, this.daten?.stufe, m)
            w = { ...werteKerze(zeilen, { faktor: Number(this.p.faktor) || 3, minVol, stufe }), zeilen, stufe, va: valueArea(zeilen, stufe) }
            let max = 0
            for (const [, kauf, verkauf] of zeilen) max = Math.max(max, kauf, verkauf)
            w.max = max
            this.merk.set(schluessel, w)
        }
        return w
    }

    /** Kerze als Balken (Docht + Körper) von `links` mit Breite `b`. */
    kerzeZeichnen(ctx, k, links, b) {
        const f = this.stil?.() || { steigend: '#1fd6c4', fallend: '#787b86' }
        const y = (p) => this.serie.priceToCoordinate(p)
        const yO = y(k.o), yC = y(k.c), yH = y(k.h), yL = y(k.l)
        if ([yO, yC, yH, yL].some((v) => v == null)) return
        const steigt = k.c >= k.o
        const rand = steigt ? f.steigend : f.fallend
        const xm = Math.round(links + b / 2) + 0.5
        const oben = Math.round(Math.min(yO, yC)), h = Math.max(1, Math.round(Math.abs(yC - yO)))
        ctx.strokeStyle = rand
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(xm, Math.min(yH, yL)); ctx.lineTo(xm, oben)
        ctx.moveTo(xm, oben + h); ctx.lineTo(xm, Math.max(yH, yL))
        ctx.stroke()
        ctx.fillStyle = steigt && b >= 3 ? mitDeckkraft(f.steigend, 0.12) : rand
        ctx.fillRect(Math.round(links), oben, Math.max(1, Math.round(b)), h)
        if (steigt && b >= 3) { ctx.strokeStyle = rand; ctx.strokeRect(Math.round(links) + 0.5, oben + 0.5, Math.round(b) - 1, h - 1) }
    }

    hinweisZeichnen(ctx, text, width, hoehe) {
        ctx.save()
        ctx.font = `12px ${SCHRIFT}`
        // Mitte des Charts — oben links liegt die Legende darüber
        const b = ctx.measureText(text).width
        const x = Math.max(6, (width - b) / 2 - 8), y = Math.round(hoehe * 0.42)
        ctx.fillStyle = 'rgba(10,14,22,0.88)'
        ctx.fillRect(x, y - 13, b + 16, 26)
        ctx.strokeStyle = 'rgba(245,197,66,0.6)'
        ctx.strokeRect(x + 0.5, y - 12.5, b + 15, 25)
        ctx.fillStyle = GELB
        ctx.textBaseline = 'middle'
        ctx.fillText(text, x + 8, y)
        ctx.restore()
    }

    zeichne(ctx, { width, height: hoehe }) {
        const d = this.daten
        this.treffer = []
        // Grund, warum es keinen Footprint gibt (Zeiteinheit, keine Aufzeichnung …) — sichtbar im Chart
        if (d?.hinweis) { this.meldeZellen(false); this.hinweisZeichnen(ctx, d.hinweis, width, hoehe); return }
        if (!d?.kerzen?.length || !this.kerzen.length) { this.meldeZellen(false); return }
        const ts = this.chart.timeScale()
        const r = ts.getVisibleLogicalRange()
        if (!r) return
        // Kerzenabstand aus zwei Nachbarn — `options().barSpacing` bleibt beim Zoomen auf dem Startwert
        const x0 = ts.logicalToCoordinate(0), x1 = ts.logicalToCoordinate(1)
        const abstand = x0 != null && x1 != null && x1 > x0 ? x1 - x0 : 6
        const spalte = abstand * 0.94
        const p = this.p
        const ivMs = this.kerzen.length > 1 ? this.kerzen[this.kerzen.length - 1].t - this.kerzen[this.kerzen.length - 2].t : 60_000
        const index = new Map(this.kerzen.map((k, i) => [k.t, i]))
        const daten = new Map(d.kerzen.map((k) => [k.t, k]))
        const von = Math.max(0, Math.floor(r.from) - 1), bis = Math.min(this.kerzen.length - 1, Math.ceil(r.to) + 1)
        const sichtbar = d.kerzen.filter((k) => { const i = index.get(k.t); return i != null && i >= von && i <= bis })
        if (!sichtbar.length) { this.meldeZellen(false); return }
        // Zeilenhöhe in px: eine Stufe auf der Preisachse
        const p0 = sichtbar[0].zeilen[0]?.[0] ?? 0
        const yA = this.serie.priceToCoordinate(p0), yB = this.serie.priceToCoordinate(p0 + d.stufe)
        const zeilePx = yA != null && yB != null ? Math.abs(yA - yB) : 0
        const stufen = spalte >= AB_FLAECHEN && zeilePx > 0
        this.meldeZellen(stufen)
        ctx.save()
        if (!stufen) {
            this.kompakt(ctx, sichtbar, index, ts, abstand, width, hoehe)
            ctx.restore()
            return
        }
        const mitZahlenMoeglich = p.zahlen !== false && spalte >= AB_ZAHLEN
        const m = zusammenfassFaktor(zeilePx, mitZahlenMoeglich ? ZEILE_ZAHLEN : ZEILE_MIN)
        const zeile = zeilePx * m
        const mitZahlen = mitZahlenMoeglich && zeile >= ZEILE_ZAHLEN - 0.5
        // Imbalance-Schwelle: kleinere Seite unter 5 % des Median-Volumens einer Zeile zählt nicht
        const mengen = []
        for (const k of sichtbar) for (const [, kauf, verkauf] of k.zeilen) mengen.push(kauf + verkauf)
        mengen.sort((a, b) => a - b)
        const minVol = (mengen[mengen.length >> 1] || 0) * 0.05 * m
        const balken = Math.max(3, Math.round(spalte * 0.12))
        const abschnitte = d.abschnitte || null
        // Die laufende Kerze endet mit dem letzten Trade — sie ist nicht „angeschnitten"
        const letzteT = this.kerzen[this.kerzen.length - 1].t
        this.deckung = (t) => (!abschnitte ? 'voll' : t === letzteT && abdeckung(t, ivMs, abschnitte) !== 'keine' ? 'voll' : abdeckung(t, ivMs, abschnitte))

        // 1. Stapel-Zonen (unter allem)
        if (p.zonen !== false && p.imbalance !== false) this.zonen(ctx, sichtbar, index, ts, spalte, m, minVol, width)

        // 2. Kerzen: ohne Daten normal, mit Daten als schmaler Balken links der Stufen
        for (let i = von; i <= bis; i++) {
            const k = this.kerzen[i]
            const x = logischZuX(ts, i)
            if (x == null) continue
            if (daten.has(k.t)) this.kerzeZeichnen(ctx, k, x - spalte / 2, balken)
            else {
                this.kerzeZeichnen(ctx, k, x - abstand * 0.4, abstand * 0.8)
                // Innerhalb der aufgezeichneten Zeit ohne Handel? Nur „keine Daten", wenn die Aufzeichnung fehlt
                if (abschnitte && this.deckung(k.t) !== 'voll' && k.t >= (d.von ?? -Infinity)) this.marke(ctx, x, k.l, 'keine Daten')
            }
        }

        // 3. Stufen je Kerze
        const schrift = Math.max(9, Math.min(12, zeile - 3))
        ctx.font = `${schrift}px ${SCHRIFT}`
        ctx.textBaseline = 'middle'
        const art = p.darstellung || 'profil'
        for (const k of sichtbar) {
            const i = index.get(k.t)
            const x = logischZuX(ts, i)
            if (x == null || x < -spalte || x > width + spalte) continue
            const links = x - spalte / 2
            const zLinks = links + balken + 2, zBreite = spalte - balken - 2, halb = zBreite / 2, mitte = zLinks + halb
            const w = this.auswertung(k, m, minVol)
            const yVon = (preis) => this.serie.priceToCoordinate(preis + w.stufe), yBis = (preis) => this.serie.priceToCoordinate(preis)
            const teil = this.deckung(k.t) === 'teil'
            // Value Area hinterlegt
            if (p.valueArea !== false && w.va) {
                const yo = yVon(w.va.oben), yu = yBis(w.va.unten)
                if (yo != null && yu != null) { ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(zLinks, Math.min(yo, yu), zBreite, Math.abs(yu - yo)) }
            }
            let maxK = 0, maxV = 0
            for (const [, kauf, verkauf] of w.zeilen) { maxK = Math.max(maxK, kauf); maxV = Math.max(maxV, verkauf) }
            w.zeilen.forEach(([preis, kauf, verkauf], j) => {
                const y1 = yVon(preis), y2 = yBis(preis)
                if (y1 == null || y2 == null) return
                const oben = Math.min(y1, y2), h = Math.max(1, Math.abs(y2 - y1) - (zeile > 4 ? 1 : 0))
                const imb = p.imbalance !== false ? w.imbalance[j] : { kauf: false, verkauf: false }
                if (art === 'zellen') {
                    ctx.fillStyle = farbe(ROT, 0.12 + 0.55 * (w.max ? verkauf / w.max : 0))
                    ctx.fillRect(zLinks, oben, halb - 0.5, h)
                    ctx.fillStyle = farbe(GRUEN, 0.12 + 0.55 * (w.max ? kauf / w.max : 0))
                    ctx.fillRect(mitte + 0.5, oben, halb - 0.5, h)
                } else if (art === 'delta') {
                    const dlt = kauf - verkauf, maxD = Math.max(...w.zeilen.map((z) => Math.abs(z[1] - z[2]))) || 1
                    const b = halb * Math.abs(dlt) / maxD
                    ctx.fillStyle = farbe(dlt >= 0 ? GRUEN : ROT, 0.75)
                    ctx.fillRect(dlt >= 0 ? mitte : mitte - b, oben, Math.max(1, b), h)
                } else {
                    const bv = w.max ? (halb - 1) * verkauf / w.max : 0, bk = w.max ? (halb - 1) * kauf / w.max : 0
                    ctx.fillStyle = farbe(ROT, 0.7)
                    if (bv > 0) ctx.fillRect(mitte - bv, oben, bv, h)
                    ctx.fillStyle = farbe(GRUEN, 0.7)
                    if (bk > 0) ctx.fillRect(mitte, oben, bk, h)
                }
                // Imbalance: senkrechte Linie — Kauf rechts der Stufe, Verkauf links
                if (imb.kauf) { ctx.fillStyle = farbe(GRUEN, 1); ctx.fillRect(zLinks + zBreite - 2, oben, 2, h) }
                if (imb.verkauf) { ctx.fillStyle = farbe(ROT, 1); ctx.fillRect(zLinks, oben, 2, h) }
                if (mitZahlen) {
                    const f = p.usd ? preis : 1
                    const zeige = (wert) => wert >= w.max * ZAHL_AB_ANTEIL && wert > 0
                    if (art === 'delta') {
                        const dlt = kauf - verkauf
                        if (Math.abs(dlt) >= w.max * ZAHL_AB_ANTEIL) {
                            ctx.textAlign = 'center'; ctx.fillStyle = '#e6ebf2'
                            ctx.fillText(`${dlt > 0 ? '+' : ''}${kurzMenge(dlt * f)}`, mitte, oben + h / 2)
                        }
                    } else {
                        if (zeige(verkauf)) {
                            ctx.font = `${verkauf === maxV ? 'bold ' : ''}${schrift}px ${SCHRIFT}`
                            ctx.textAlign = 'right'; ctx.fillStyle = imb.verkauf ? '#fff' : 'rgba(255,255,255,0.85)'
                            ctx.fillText(kurzMenge(verkauf * f), mitte - 3, oben + h / 2)
                        }
                        if (zeige(kauf)) {
                            ctx.font = `${kauf === maxK ? 'bold ' : ''}${schrift}px ${SCHRIFT}`
                            ctx.textAlign = 'left'; ctx.fillStyle = imb.kauf ? '#fff' : 'rgba(255,255,255,0.85)'
                            ctx.fillText(kurzMenge(kauf * f), mitte + 3, oben + h / 2)
                        }
                        ctx.font = `${schrift}px ${SCHRIFT}`
                    }
                }
                if (p.poc !== false && preis === w.poc) {
                    ctx.strokeStyle = GELB
                    ctx.lineWidth = 1.5
                    ctx.strokeRect(zLinks + 0.5, oben + 0.5, zBreite - 1, h - 1)
                }
                this.treffer.push({ x1: zLinks, x2: zLinks + zBreite, y1: oben, y2: oben + h, preis, stufe: w.stufe, kauf, verkauf, t: k.t, w })
            })
            // Angeschnitten: gestrichelt umrahmt, „unvollst." statt Delta
            if (teil) {
                const yo = yVon(w.zeilen[0][0]), yu = yBis(w.zeilen[w.zeilen.length - 1][0])
                if (yo != null && yu != null) {
                    ctx.save(); ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(200,205,215,0.6)'; ctx.lineWidth = 1
                    ctx.strokeRect(zLinks - 1.5, Math.min(yo, yu) - 1.5, zBreite + 3, Math.abs(yu - yo) + 3); ctx.restore()
                }
                const tief = w.zeilen[w.zeilen.length - 1][0]
                this.marke(ctx, mitte, tief, 'unvollst.')
            } else if (p.delta !== false && p.kennzahlen === false && spalte >= 26) {
                const tief = w.zeilen[w.zeilen.length - 1]?.[0]
                const y = tief != null ? this.serie.priceToCoordinate(tief) : null
                if (y != null) {
                    ctx.textAlign = 'center'
                    ctx.fillStyle = w.delta >= 0 ? farbe(GRUEN, 1) : farbe(ROT, 1)
                    ctx.fillText(`${w.delta >= 0 ? '+' : ''}${kurzMenge(w.delta * (p.usd ? (w.poc || 1) : 1))}`, mitte, y + schrift)
                }
            }
        }

        // 4. Kennzahlen-Zeilen unten im Pane
        if (p.kennzahlen !== false && spalte >= KZ_AB) this.kennzahlen(ctx, sichtbar, index, ts, spalte, balken, m, minVol, width, hoehe, abschnitte, ivMs)

        // 5. Tooltip der Zeile unter dem Zeiger
        if (this.zeiger) this.tooltip(ctx, width, hoehe)
        ctx.restore()
    }

    /** Kompakt (schmale Kerzen): normale Kerzen, POC je Kerze als gelber Strich, Hinweis unten. */
    kompakt(ctx, sichtbar, index, ts, abstand, width, hoehe) {
        const p = this.p
        if (p.poc !== false) {
            ctx.strokeStyle = GELB
            ctx.lineWidth = 2
            for (const k of sichtbar) {
                const x = logischZuX(ts, index.get(k.t))
                const w = this.auswertung(k, 1, 0)
                const yp = w.poc != null ? this.serie.priceToCoordinate(w.poc + w.stufe / 2) : null
                if (x == null || yp == null) continue
                const halb = Math.max(2, abstand * 0.4)
                ctx.beginPath(); ctx.moveTo(x - halb, Math.round(yp) + 0.5); ctx.lineTo(x + halb, Math.round(yp) + 0.5); ctx.stroke()
            }
        }
        ctx.font = `11px ${SCHRIFT}`
        ctx.fillStyle = 'rgba(255,255,255,0.5)'
        ctx.textAlign = 'center'
        ctx.fillText('Footprint: hineinzoomen, um die Stufen zu sehen (gelb = POC je Kerze)', width / 2, hoehe - 10)
    }

    /** Kleine graue Marke unter einer Kerze (Datenlücke). */
    marke(ctx, x, preis, text) {
        const y = this.serie.priceToCoordinate(preis)
        if (y == null) return
        ctx.save()
        ctx.font = `10px ${SCHRIFT}`
        ctx.fillStyle = 'rgba(200,205,215,0.7)'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.fillText(text, x, y + 4)
        ctx.restore()
    }

    /** Stapel-Imbalancen als Zonen nach rechts bis zur ersten späteren Berührung. */
    zonen(ctx, sichtbar, index, ts, spalte, m, minVol, width) {
        // Auch Stapel links ausserhalb des Bilds zählen — ihre Zone kann hineinreichen
        const alle = []
        for (const k of this.daten.kerzen) {
            if (!index.has(k.t)) continue
            for (const s of this.auswertung(k, m, minVol).stapel) alle.push({ t: k.t, ...s })
        }
        const stufe = this.daten.stufe * m
        for (const z of stapelZonen(alle, this.kerzen, stufe)) {
            const xa = logischZuX(ts, index.get(z.t))
            const xe = z.bisT != null ? logischZuX(ts, index.get(z.bisT)) : width
            if (xa == null || xe == null || xe < 0) continue
            const yo = this.serie.priceToCoordinate(z.oben), yu = this.serie.priceToCoordinate(z.unten)
            if (yo == null || yu == null) continue
            const c = z.seite === 'kauf' ? GRUEN : ROT
            const x = xa + spalte / 2
            ctx.fillStyle = farbe(c, 0.10)
            ctx.fillRect(x, Math.min(yo, yu), Math.max(0, xe - x), Math.abs(yu - yo))
            ctx.strokeStyle = farbe(c, 0.45)
            ctx.lineWidth = 1
            ctx.beginPath(); ctx.moveTo(x, Math.round(Math.min(yo, yu)) + 0.5); ctx.lineTo(xe, Math.round(Math.min(yo, yu)) + 0.5)
            ctx.moveTo(x, Math.round(Math.max(yo, yu)) - 0.5); ctx.lineTo(xe, Math.round(Math.max(yo, yu)) - 0.5); ctx.stroke()
        }
    }

    /** Volumen, Delta und Delta % je Kerze als Zeilen unten im Pane. */
    kennzahlen(ctx, sichtbar, index, ts, spalte, balken, m, minVol, width, hoehe, abschnitte, ivMs) {
        const p = this.p
        const h = 3 * KZ_ZEILE + 6
        const y0 = hoehe - h
        ctx.fillStyle = 'rgba(10,14,22,0.88)'
        ctx.fillRect(0, y0, width, h)
        ctx.strokeStyle = 'rgba(255,255,255,0.08)'
        ctx.beginPath(); ctx.moveTo(0, y0 + 0.5); ctx.lineTo(width, y0 + 0.5); ctx.stroke()
        ctx.font = `10px ${SCHRIFT}`
        ctx.textBaseline = 'middle'
        ctx.textAlign = 'left'
        ctx.fillStyle = 'rgba(200,205,215,0.6)'
        ;['Vol', 'Δ', 'Δ %'].forEach((s, i) => ctx.fillText(s, 4, y0 + 3 + KZ_ZEILE * (i + 0.5)))
        ctx.textAlign = 'center'
        for (const k of sichtbar) {
            const x = logischZuX(ts, index.get(k.t))
            if (x == null || x < 24 || x > width) continue
            const w = this.auswertung(k, m, minVol)
            const mitte = x - spalte / 2 + balken + 2 + (spalte - balken - 2) / 2
            const vol = w.kauf + w.verkauf
            const f = p.usd ? (w.poc || 1) : 1
            if (this.deckung(k.t) === 'teil') {
                ctx.fillStyle = 'rgba(200,205,215,0.6)'
                ctx.fillText('unvollst.', mitte, y0 + 3 + KZ_ZEILE * 1.5)
                continue
            }
            ctx.fillStyle = 'rgba(230,235,242,0.9)'
            ctx.fillText(kurzMenge(vol * f), mitte, y0 + 3 + KZ_ZEILE * 0.5)
            ctx.fillStyle = w.delta >= 0 ? farbe(GRUEN, 1) : farbe(ROT, 1)
            ctx.fillText(`${w.delta > 0 ? '+' : ''}${kurzMenge(w.delta * f)}`, mitte, y0 + 3 + KZ_ZEILE * 1.5)
            ctx.fillText(vol > 0 ? `${w.delta > 0 ? '+' : ''}${Math.round(w.delta / vol * 100)} %` : '–', mitte, y0 + 3 + KZ_ZEILE * 2.5)
        }
    }

    /** Detail der Zeile unter dem Zeiger: Preisbereich, Verkauf × Kauf, Delta. */
    tooltip(ctx, width, hoehe) {
        const { x, y } = this.zeiger
        const z = this.treffer.find((t) => x >= t.x1 && x <= t.x2 && y >= t.y1 && y <= t.y2)
        if (!z) return
        const fmt = (p) => this.serie.priceFormatter?.().format(p) ?? String(p)
        const f = this.p.usd ? z.preis : 1
        const zeilen = [
            `${fmt(z.preis)} – ${fmt(z.preis + z.stufe)}`,
            `Verkauf ${kurzMenge(z.verkauf * f)}  ×  Kauf ${kurzMenge(z.kauf * f)}`,
            `Delta ${z.kauf - z.verkauf >= 0 ? '+' : ''}${kurzMenge((z.kauf - z.verkauf) * f)}${z.preis === z.w.poc ? '  · POC' : ''}`,
        ]
        ctx.save()
        ctx.font = `11px ${SCHRIFT}`
        const b = Math.max(...zeilen.map((s) => ctx.measureText(s).width)) + 14
        const h = zeilen.length * 15 + 8
        let tx = x + 14, ty = y + 14
        if (tx + b > width - 4) tx = x - b - 14
        if (ty + h > hoehe - 4) ty = y - h - 14
        ctx.fillStyle = 'rgba(14,19,29,0.95)'
        ctx.fillRect(tx, ty, b, h)
        ctx.strokeStyle = 'rgba(255,255,255,0.15)'
        ctx.strokeRect(tx + 0.5, ty + 0.5, b - 1, h - 1)
        ctx.fillStyle = '#e6ebf2'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        zeilen.forEach((s, i) => ctx.fillText(s, tx + 7, ty + 4 + 15 * (i + 0.5)))
        ctx.restore()
    }
}
