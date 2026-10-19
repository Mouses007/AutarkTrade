/**
 * Bildmarkierung — reine Logik (kein Vue, kein DOM ausser in `brenneEin`).
 *
 * Ersetzt markerjs2. Das gespeicherte Format (`screenshots.maState`) ist
 * eigenes Format Version 2:
 *
 *   { v: 2, marker: [ … ], fremd: [ … ] }
 *
 * Alle Koordinaten sind RELATIV zur natürlichen Bildgrösse (0–1, x zur Breite,
 * y zur Höhe). markerjs2 speicherte Pixel der ANZEIGEfläche im Editor — wer
 * dasselbe Bild in einem anderen Fenster markierte, bekam verschobene Marker,
 * und zum Einbrennen musste man die damalige Anzeigegrösse kennen. Relative
 * Werte machen die Anzeigegrösse bedeutungslos.
 *
 * Strichbreiten und Strichmuster sind relativ zur Bildbreite, Schriftgrössen
 * relativ zur Bildhöhe — so sieht das eingebrannte Bild aus wie der Editor.
 *
 * Alte markerjs2-Zustände (alle 13 Typen) werden beim Lesen umgerechnet; die
 * fünf Werkzeugtypen (Pfeil, Rechteck, Linie, Text, Freihand) bleiben
 * bearbeitbar, die übrigen werden als Altmarker gezeichnet (verschieben und
 * löschen ja, umfärben nein). Typen, die niemand kennt, landen unverändert in
 * `fremd` und werden beim Speichern wieder mitgeschrieben — verwerfen wäre
 * Datenverlust, den niemand bemerkt.
 */

export const FORMAT_VERSION = 2

/** Die Werkzeuge des Editors (zugleich die voll bearbeitbaren Typen). */
export const WERKZEUGE = ['pfeil', 'rechteck', 'linie', 'text', 'freihand']
const BEARBEITBAR = new Set(WERKZEUGE)

/**
 * Markierungsfarben. Das sind DATEN (sie landen eingebrannt im Bild), keine
 * Oberflächenfarben — deshalb stehen sie hier und nicht in tokens.css.
 * Gleiche Palette wie zuvor: rot, grün, blau, gelb, violett, rosa, schwarz, weiss.
 */
export const FARBEN = ['#ef4444', '#22c55e', '#3b82f6', '#facc15', '#a855f7', '#ec4899', '#000000', '#ffffff']
/** Strichbreiten in Anzeige-Pixeln (der Editor rechnet auf die Bildbreite um). */
export const STRICHBREITEN = [1, 2, 3, 5, 10]
export const VORGABE_FARBE = '#ffffff'
export const VORGABE_STRICH = 2
export const SCHRIFT = 'Helvetica, Arial, sans-serif'
/** Zeilenabstand als Vielfaches der Schriftgrösse. */
export const ZEILENHOEHE = 1.2

const zahl = (v, ersatz = 0) => (Number.isFinite(Number(v)) ? Number(v) : ersatz)
export const klon = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)))

let zaehler = 0
/** Kurze, im Zustand eindeutige ID. */
export function neueId() {
    zaehler += 1
    return 'm' + Date.now().toString(36) + zaehler.toString(36)
}

export function leererZustand() {
    return { v: FORMAT_VERSION, marker: [], fremd: [] }
}

export const istBearbeitbar = (m) => BEARBEITBAR.has(m?.typ)

// ── Lesen ──────────────────────────────────────────────────────────────────

/**
 * Liest jeden denkbaren `maState` und gibt IMMER ein Objekt im eigenen
 * Format zurück. Fehlend, `null`, `{}`, kaputter Text → leer (behebt A-S9:
 * markerjs2 warf bei `{}`).
 */
export function leseZustand(roh) {
    let wert = roh
    if (typeof wert === 'string') {
        try { wert = JSON.parse(wert) } catch { return leererZustand() }
    }
    if (!wert || typeof wert !== 'object' || Array.isArray(wert)) return leererZustand()
    if (wert.v === FORMAT_VERSION) return normalisiere(wert)
    if (Array.isArray(wert.markers)) return migriereMarkerjs(wert)
    return leererZustand()
}

/** Herkunft eines gespeicherten Werts — für Anzeige und Tests. */
export function herkunft(roh) {
    let wert = roh
    if (typeof wert === 'string') {
        try { wert = JSON.parse(wert) } catch { return 'leer' }
    }
    if (!wert || typeof wert !== 'object') return 'leer'
    if (wert.v === FORMAT_VERSION) return 'eigen'
    if (Array.isArray(wert.markers)) return 'markerjs'
    return 'leer'
}

function normalisiere(z) {
    const marker = (Array.isArray(z.marker) ? z.marker : [])
        .filter(m => m && typeof m === 'object' && typeof m.typ === 'string')
        .map(m => ({ ...klon(m), id: m.id || neueId() }))
    const fremd = Array.isArray(z.fremd) ? klon(z.fremd) : []
    return { v: FORMAT_VERSION, marker, fremd }
}

/** Hat der Zustand etwas, das man sieht oder behalten muss? */
export function hatMarker(roh) {
    const z = leseZustand(roh)
    return z.marker.length > 0
}

// ── markerjs2 → eigenes Format ─────────────────────────────────────────────

const PFEILSPITZE = { both: 'beide', start: 'anfang', end: 'ende', none: 'keine' }

function muster(text, W) {
    if (text == null || text === '') return undefined
    const teile = String(text).split(/[\s,]+/).map(Number).filter(n => Number.isFinite(n) && n > 0)
    return teile.length ? teile.map(n => n / W) : undefined
}

/** CSS-Schriftgrösse ('1rem', '14px', '1.2em', 16) → Pixel. */
export function schriftPixel(wert, ersatz = 16) {
    if (typeof wert === 'number') return wert > 0 ? wert : ersatz
    const m = /^\s*([\d.]+)\s*(px|rem|em|pt)?\s*$/i.exec(String(wert ?? ''))
    if (!m) return ersatz
    const n = Number(m[1])
    const einheit = (m[2] || 'px').toLowerCase()
    if (einheit === 'px') return n
    if (einheit === 'pt') return n * 4 / 3
    return n * 16
}

const sichtbar = (farbe) => (farbe && farbe !== 'transparent' ? farbe : undefined)

/**
 * Rechnet einen markerjs2-Zustand (Pixel der damaligen Anzeigefläche
 * `width × height`) in relative Koordinaten um.
 */
export function migriereMarkerjs(alt) {
    const W = zahl(alt?.width)
    const H = zahl(alt?.height)
    const z = leererZustand()
    const liste = Array.isArray(alt?.markers) ? alt.markers : []
    // Ohne Flächengrösse lässt sich nichts platzieren — alles aufbewahren, nichts raten.
    if (!(W > 0 && H > 0)) {
        z.fremd = liste.map(o => ({ ...klon(o), _raum: { width: W, height: H } }))
        return z
    }
    for (const o of liste) {
        const m = markerAusMarkerjs(o, W, H)
        if (m) z.marker.push(m)
        else z.fremd.push({ ...klon(o), _raum: { width: W, height: H } })
    }
    return z
}

function box(o, W, H) {
    return {
        x: zahl(o.left) / W,
        y: zahl(o.top) / H,
        b: zahl(o.width) / W,
        h: zahl(o.height) / H,
        drehung: zahl(o.rotationAngle),
    }
}

function strecke(o, W, H) {
    return { x1: zahl(o.x1) / W, y1: zahl(o.y1) / H, x2: zahl(o.x2) / W, y2: zahl(o.y2) / H }
}

function strich(o, W, ersatzBreite = VORGABE_STRICH) {
    return {
        farbe: o.strokeColor || VORGABE_FARBE,
        breite: zahl(o.strokeWidth, ersatzBreite) / W,
        muster: muster(o.strokeDasharray, W),
    }
}

const deck = (o, ersatz = 1) => {
    const d = zahl(o.opacity, ersatz)
    return d >= 0 && d <= 1 ? d : ersatz
}

/** Textblock einer Box: Schriftgrösse so, dass der Text die Box füllt (markerjs2 skalierte ihn so). */
function textInBox(o, W, H, text) {
    const pad = Math.max(0, zahl(o.padding, 5))
    const zeilen = String(text ?? '').split('\n')
    const innenB = Math.max(1, zahl(o.width) - 2 * pad)
    const innenH = Math.max(1, zahl(o.height) - 2 * pad)
    const laengste = Math.max(1, ...zeilen.map(z => z.length))
    // Höhe ÷ Zeilen, gedeckelt durch die Breite (≈ 0,6 em je Zeichen).
    const px = Math.min(innenH / (zeilen.length * ZEILENHOEHE), innenB / (laengste * 0.6))
    return {
        x: (zahl(o.left) + pad) / W,
        y: (zahl(o.top) + pad) / H,
        groesse: Math.max(1, px) / H,
        text: zeilen.join('\n'),
    }
}

function markerAusMarkerjs(o, W, H) {
    if (!o || typeof o !== 'object') return null
    const id = neueId()
    const quelle = o.typeName
    switch (quelle) {
        case 'FrameMarker':
            return { id, typ: 'rechteck', ...box(o, W, H), ...strich(o, W), fuellung: sichtbar(o.fillColor), deckkraft: deck(o) }
        case 'FreehandMarker':
            if (!o.drawingImgUrl) return { id, typ: 'bild', ...box(o, W, H), url: '', quelle }
            return { id, typ: 'bild', ...box(o, W, H), url: o.drawingImgUrl, quelle }
        case 'ArrowMarker':
            return { id, typ: 'pfeil', ...strecke(o, W, H), ...strich(o, W), spitze: PFEILSPITZE[o.arrowType] || 'ende' }
        case 'TextMarker':
            return { id, typ: 'text', ...textInBox(o, W, H, o.text), farbe: o.color || VORGABE_FARBE, schrift: o.fontFamily || undefined, drehung: zahl(o.rotationAngle) }
        case 'EllipseFrameMarker':
            return { id, typ: 'ellipse', alt: true, quelle, ...box(o, W, H), ...strich(o, W), fuellung: undefined, deckkraft: deck(o) }
        case 'EllipseMarker':
            return { id, typ: 'ellipse', alt: true, quelle, ...box(o, W, H), ...strich(o, W, 0), fuellung: sichtbar(o.fillColor), deckkraft: deck(o) }
        case 'HighlightMarker':
            return { id, typ: 'hervorhebung', alt: true, quelle, ...box(o, W, H), fuellung: o.fillColor || '#ffff00', deckkraft: deck(o, 0.5) }
        case 'CoverMarker':
            return { id, typ: 'abdeckung', alt: true, quelle, ...box(o, W, H), fuellung: o.fillColor || '#000000', deckkraft: 1 }
        case 'CalloutMarker': {
            const t = textInBox(o, W, H, o.text)
            const tip = o.tipPosition || {}
            return {
                id, typ: 'sprechblase', alt: true, quelle, ...box(o, W, H),
                hintergrund: o.bgColor || '#ffffffde', farbe: o.color || '#000000', schrift: o.fontFamily || undefined,
                text: t.text, groesse: t.groesse, abstand: Math.max(0, zahl(o.padding, 5)) / W,
                spitze: { x: (zahl(o.left) + zahl(tip.x)) / W, y: (zahl(o.top) + zahl(tip.y)) / H },
            }
        }
        case 'MeasurementMarker':
        case 'LineMarker':
            return { id, typ: 'linie', ...strecke(o, W, H), ...strich(o, W), ...(quelle === 'MeasurementMarker' ? { quelle } : {}) }
        case 'CurveMarker':
            return {
                id, typ: 'kurve', alt: true, quelle, ...strecke(o, W, H), ...strich(o, W),
                kx: zahl(o.curveX, (zahl(o.x1) + zahl(o.x2)) / 2) / W, ky: zahl(o.curveY, (zahl(o.y1) + zahl(o.y2)) / 2) / H,
            }
        case 'CaptionFrameMarker':
            return {
                id, typ: 'beschriftung', alt: true, quelle, ...box(o, W, H), ...strich(o, W),
                fuellung: sichtbar(o.fillColor), textfarbe: o.textColor || '#ffffff', schrift: o.fontFamily || undefined,
                text: o.captionText ?? 'Text', groesse: schriftPixel(o.fontSize) / H,
            }
        default:
            return null
    }
}

// ── Zum Speichern ──────────────────────────────────────────────────────────

/** Saubere Kopie für `maState` (eigenes Format, auch wenn alles leer ist). */
export function zumSpeichern(z) {
    const n = normalisiere(z || leererZustand())
    return { v: FORMAT_VERSION, marker: n.marker, fremd: n.fremd }
}

// ── Geometrie in Pixeln ────────────────────────────────────────────────────

/** Spitze eines Pfeils, der bei (x2,y2) endet: drei Punkte. */
export function pfeilspitze(x1, y1, x2, y2, strichPx, W) {
    const laenge = Math.max(strichPx * 4, W * 0.012, 6)
    const winkel = Math.atan2(y2 - y1, x2 - x1)
    const halb = laenge * 0.55
    const bx = x2 - laenge * Math.cos(winkel)
    const by = y2 - laenge * Math.sin(winkel)
    return [
        [x2, y2],
        [bx + halb * Math.sin(winkel), by - halb * Math.cos(winkel)],
        [bx - halb * Math.sin(winkel), by + halb * Math.cos(winkel)],
    ]
}

const zeilenVon = (text) => String(text ?? '').split('\n')

/** Geschätzte Textbreite (0,6 em je Zeichen) — Tests und Trefferprüfung ohne Canvas. */
export function textMass(m, W, H) {
    const px = zahl(m.groesse) * H
    const zeilen = zeilenVon(m.text)
    const laengste = Math.max(1, ...zeilen.map(z => z.length))
    return { b: laengste * px * 0.6, h: zeilen.length * px * ZEILENHOEHE, px }
}

function drehungUm(m, W, H) {
    const w = zahl(m.drehung)
    if (!w) return undefined
    if (m.typ === 'text') {
        const t = textMass(m, W, H)
        return { winkel: w, cx: m.x * W + t.b / 2, cy: m.y * H + t.h / 2 }
    }
    return { winkel: w, cx: (m.x + m.b / 2) * W, cy: (m.y + m.h / 2) * H }
}

/**
 * Zerlegt einen Marker in Zeichenformen (Pixel bei Bildgrösse W×H). Dieselbe
 * Liste zeichnen die SVG-Ebene des Editors und das Canvas beim Einbrennen —
 * so kann das eingebrannte Bild nicht anders aussehen als der Editor.
 */
export function formen(m, W, H) {
    if (!m) return []
    const sw = Math.max(0.5, zahl(m.breite) * W)
    const dash = Array.isArray(m.muster) ? m.muster.map(v => v * W) : undefined
    const deckkraft = m.deckkraft == null ? 1 : zahl(m.deckkraft, 1)
    const drehung = drehungUm(m, W, H)
    const mit = (f) => (drehung ? { ...f, drehung } : f)
    switch (m.typ) {
        case 'linie':
            return [{ art: 'linie', x1: m.x1 * W, y1: m.y1 * H, x2: m.x2 * W, y2: m.y2 * H, strich: m.farbe, breite: sw, muster: dash, deckkraft }]
        case 'pfeil': {
            const x1 = m.x1 * W, y1 = m.y1 * H, x2 = m.x2 * W, y2 = m.y2 * H
            const aus = [{ art: 'linie', x1, y1, x2, y2, strich: m.farbe, breite: sw, muster: dash, deckkraft }]
            const spitze = m.spitze || 'ende'
            if (spitze === 'ende' || spitze === 'beide') aus.push({ art: 'polygon', punkte: pfeilspitze(x1, y1, x2, y2, sw, W), fuellung: m.farbe, deckkraft })
            if (spitze === 'anfang' || spitze === 'beide') aus.push({ art: 'polygon', punkte: pfeilspitze(x2, y2, x1, y1, sw, W), fuellung: m.farbe, deckkraft })
            return aus
        }
        case 'kurve':
            return [{ art: 'kurve', x1: m.x1 * W, y1: m.y1 * H, kx: m.kx * W, ky: m.ky * H, x2: m.x2 * W, y2: m.y2 * H, strich: m.farbe, breite: sw, muster: dash, deckkraft }]
        case 'rechteck':
            return [mit({ art: 'rechteck', x: m.x * W, y: m.y * H, b: m.b * W, h: m.h * H, strich: m.farbe, breite: sw, muster: dash, fuellung: m.fuellung, deckkraft })]
        case 'ellipse':
            return [mit({
                art: 'ellipse', cx: (m.x + m.b / 2) * W, cy: (m.y + m.h / 2) * H, rx: Math.abs(m.b * W) / 2, ry: Math.abs(m.h * H) / 2,
                strich: zahl(m.breite) > 0 ? m.farbe : undefined, breite: sw, muster: dash, fuellung: m.fuellung, deckkraft,
            })]
        case 'hervorhebung':
        case 'abdeckung':
            return [mit({ art: 'rechteck', x: m.x * W, y: m.y * H, b: m.b * W, h: m.h * H, fuellung: m.fuellung, deckkraft })]
        case 'text': {
            const t = textMass(m, W, H)
            return [mit({ art: 'text', x: m.x * W, y: m.y * H, zeilen: zeilenVon(m.text), groesse: t.px, farbe: m.farbe, schrift: m.schrift || SCHRIFT })]
        }
        case 'freihand': {
            const punkte = (m.punkte || []).map(([x, y]) => [x * W, y * H])
            return [{ art: 'polylinie', punkte, strich: m.farbe, breite: sw, deckkraft }]
        }
        case 'bild':
            return m.url ? [mit({ art: 'bild', x: m.x * W, y: m.y * H, b: m.b * W, h: m.h * H, url: m.url })] : []
        case 'sprechblase': {
            const x = m.x * W, y = m.y * H, b = m.b * W, h = m.h * H
            const sx = m.spitze?.x * W, sy = m.spitze?.y * H
            // Spitze als Dreieck vom Boxmittelpunkt aus — gezeichnet VOR der Box, die Box deckt den Ansatz.
            const mx = x + b / 2, my = y + h / 2
            const fuss = Math.max(6, Math.min(b, h) * 0.2)
            const w = Math.atan2(sy - my, sx - mx)
            const aus = []
            if (Number.isFinite(sx) && Number.isFinite(sy)) {
                aus.push(mit({ art: 'polygon', punkte: [[sx, sy], [mx + fuss * Math.sin(w), my - fuss * Math.cos(w)], [mx - fuss * Math.sin(w), my + fuss * Math.cos(w)]], fuellung: m.hintergrund }))
            }
            aus.push(mit({ art: 'rechteck', x, y, b, h, fuellung: m.hintergrund, radius: Math.min(b, h) * 0.1 }))
            const pad = zahl(m.abstand) * W
            aus.push(mit({ art: 'text', x: x + pad, y: y + pad, zeilen: zeilenVon(m.text), groesse: zahl(m.groesse) * H, farbe: m.farbe, schrift: m.schrift || SCHRIFT }))
            return aus
        }
        case 'beschriftung': {
            const x = m.x * W, y = m.y * H, b = m.b * W, h = m.h * H
            const px = zahl(m.groesse) * H
            const leiste = Math.min(h, px * 1.6)
            return [
                mit({ art: 'rechteck', x, y, b, h, strich: m.farbe, breite: sw, muster: dash, fuellung: m.fuellung, deckkraft }),
                mit({ art: 'rechteck', x, y, b, h: leiste, fuellung: m.farbe, deckkraft }),
                mit({ art: 'text', x: x + px * 0.4, y: y + (leiste - px) / 2, zeilen: zeilenVon(m.text), groesse: px, farbe: m.textfarbe, schrift: m.schrift || SCHRIFT }),
            ]
        }
        default:
            return []
    }
}

/** Achsenparallele Hülle eines Markers in Pixeln (Drehung eingerechnet). */
export function grenzen(m, W, H) {
    let punkte = []
    switch (m?.typ) {
        case 'linie': case 'pfeil':
            punkte = [[m.x1 * W, m.y1 * H], [m.x2 * W, m.y2 * H]]; break
        case 'kurve':
            punkte = [[m.x1 * W, m.y1 * H], [m.x2 * W, m.y2 * H], [m.kx * W, m.ky * H]]; break
        case 'freihand':
            punkte = (m.punkte || []).map(([x, y]) => [x * W, y * H]); break
        case 'text': {
            const t = textMass(m, W, H)
            punkte = ecken(m.x * W, m.y * H, t.b, t.h, drehungUm(m, W, H)); break
        }
        case 'sprechblase':
            punkte = [...ecken(m.x * W, m.y * H, m.b * W, m.h * H, drehungUm(m, W, H)), [m.spitze?.x * W, m.spitze?.y * H]]; break
        default:
            if (m && Number.isFinite(m.x)) punkte = ecken(m.x * W, m.y * H, m.b * W, m.h * H, drehungUm(m, W, H))
    }
    punkte = punkte.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
    if (!punkte.length) return { x: 0, y: 0, b: 0, h: 0 }
    const xs = punkte.map(p => p[0]), ys = punkte.map(p => p[1])
    const x = Math.min(...xs), y = Math.min(...ys)
    return { x, y, b: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

function dreheUm(px, py, d, rueck = false) {
    if (!d) return [px, py]
    const w = (rueck ? -d.winkel : d.winkel) * Math.PI / 180
    const dx = px - d.cx, dy = py - d.cy
    return [d.cx + dx * Math.cos(w) - dy * Math.sin(w), d.cy + dx * Math.sin(w) + dy * Math.cos(w)]
}

function ecken(x, y, b, h, d) {
    return [[x, y], [x + b, y], [x + b, y + h], [x, y + h]].map(([a, c]) => dreheUm(a, c, d))
}

/** Abstand Punkt–Strecke. */
export function abstandStrecke(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1
    const l2 = dx * dx + dy * dy
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2))
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

/** Trifft der Punkt (Pixel) den Marker? `toleranz` in Pixeln. */
export function trifft(m, px, py, W, H, toleranz = 6) {
    const tol = toleranz + Math.max(0.5, zahl(m.breite) * W) / 2
    switch (m.typ) {
        case 'linie': case 'pfeil':
            return abstandStrecke(px, py, m.x1 * W, m.y1 * H, m.x2 * W, m.y2 * H) <= tol
        case 'kurve': {
            let vorher = [m.x1 * W, m.y1 * H]
            for (let i = 1; i <= 24; i++) {
                const t = i / 24, u = 1 - t
                const p = [u * u * m.x1 * W + 2 * u * t * m.kx * W + t * t * m.x2 * W, u * u * m.y1 * H + 2 * u * t * m.ky * H + t * t * m.y2 * H]
                if (abstandStrecke(px, py, vorher[0], vorher[1], p[0], p[1]) <= tol) return true
                vorher = p
            }
            return false
        }
        case 'freihand': {
            const p = (m.punkte || []).map(([x, y]) => [x * W, y * H])
            if (p.length === 1) return Math.hypot(px - p[0][0], py - p[0][1]) <= tol
            for (let i = 1; i < p.length; i++) {
                if (abstandStrecke(px, py, p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]) <= tol) return true
            }
            return false
        }
        case 'rechteck': {
            const [qx, qy] = dreheUm(px, py, drehungUm(m, W, H), true)
            const x = Math.min(m.x, m.x + m.b) * W, y = Math.min(m.y, m.y + m.h) * H
            const b = Math.abs(m.b) * W, h = Math.abs(m.h) * H
            const innen = qx >= x - tol && qx <= x + b + tol && qy >= y - tol && qy <= y + h + tol
            if (!innen) return false
            // Ein leerer Rahmen wird nur an der Kante getroffen — sonst liesse sich nichts darin auswählen.
            if (m.fuellung) return true
            return qx <= x + tol || qx >= x + b - tol || qy <= y + tol || qy >= y + h - tol
        }
        default: {
            if (m.typ === 'text') {
                const t = textMass(m, W, H)
                const [qx, qy] = dreheUm(px, py, drehungUm(m, W, H), true)
                return qx >= m.x * W - toleranz && qx <= m.x * W + t.b + toleranz && qy >= m.y * H - toleranz && qy <= m.y * H + t.h + toleranz
            }
            const [qx, qy] = dreheUm(px, py, drehungUm(m, W, H), true)
            const x = Math.min(m.x, m.x + m.b) * W, y = Math.min(m.y, m.y + m.h) * H
            return qx >= x - toleranz && qx <= x + Math.abs(m.b) * W + toleranz && qy >= y - toleranz && qy <= y + Math.abs(m.h) * H + toleranz
        }
    }
}

/** Oberster getroffener Marker (später gezeichnet = oben) oder null. */
export function obersterTreffer(z, px, py, W, H, toleranz) {
    for (let i = z.marker.length - 1; i >= 0; i--) {
        if (trifft(z.marker[i], px, py, W, H, toleranz)) return z.marker[i]
    }
    return null
}

/** Verschiebt einen Marker um (dx, dy) relativ — gibt eine Kopie zurück. */
export function verschoben(m, dx, dy) {
    const n = klon(m)
    for (const k of ['x', 'x1', 'x2', 'kx']) if (Number.isFinite(n[k])) n[k] += dx
    for (const k of ['y', 'y1', 'y2', 'ky']) if (Number.isFinite(n[k])) n[k] += dy
    if (Array.isArray(n.punkte)) n.punkte = n.punkte.map(([x, y]) => [x + dx, y + dy])
    if (n.spitze && typeof n.spitze === 'object') n.spitze = { x: n.spitze.x + dx, y: n.spitze.y + dy }
    return n
}

/** Farbe/Strichbreite eines bearbeitbaren Markers ändern; Altmarker bleiben unverändert. */
export function umgestylt(m, { farbe, breite } = {}) {
    if (!istBearbeitbar(m)) return m
    const n = klon(m)
    if (farbe) n.farbe = farbe
    if (breite != null && m.typ !== 'text') n.breite = breite
    return n
}

/** Ist der Marker zu klein, um ihn zu behalten (Klick ohne Ziehen)? */
export function zuKlein(m, W, H, min = 3) {
    if (m.typ === 'text') return !String(m.text ?? '').trim()
    if (m.typ === 'freihand') return (m.punkte || []).length < 2
    const g = grenzen(m, W, H)
    return g.b < min && g.h < min
}

// ── Rückgängig ─────────────────────────────────────────────────────────────

/**
 * Mehrstufiges Rückgängig/Wiederholen. Jeder Schritt ist eine vollständige
 * Kopie des Zustands — Markierungen sind klein, und ein Schnappschuss kann
 * nicht wie ein Differenzschritt falsch zurückgespielt werden.
 */
export class Verlauf {
    constructor(start, max = 100) {
        this.max = max
        this.stapel = [klon(start || leererZustand())]
        this.pos = 0
    }
    get jetzt() { return klon(this.stapel[this.pos]) }
    get kannZurueck() { return this.pos > 0 }
    get kannVor() { return this.pos < this.stapel.length - 1 }
    /** Weicht der aktuelle Stand vom Anfang ab? */
    get geaendert() { return JSON.stringify(this.stapel[this.pos]) !== JSON.stringify(this.stapel[0]) }
    setze(z) {
        this.stapel = this.stapel.slice(0, this.pos + 1)
        this.stapel.push(klon(z))
        // Der Anfang bleibt erhalten (für `geaendert`); gekürzt wird dahinter.
        if (this.stapel.length > this.max) this.stapel.splice(1, 1)
        this.pos = this.stapel.length - 1
        return this.jetzt
    }
    zurueck() {
        if (this.kannZurueck) this.pos -= 1
        return this.jetzt
    }
    vor() {
        if (this.kannVor) this.pos += 1
        return this.jetzt
    }
}

// ── Canvas ─────────────────────────────────────────────────────────────────

/**
 * Zeichnet Formen (aus `formen`) in einen 2D-Kontext. `bilder` bildet
 * Daten-URL → geladenes Bild ab (Freihand-Altmarker sind Bilder).
 */
export function zeichneFormen(ctx, liste, bilder = {}) {
    for (const f of liste) {
        ctx.save()
        if (f.drehung) {
            ctx.translate(f.drehung.cx, f.drehung.cy)
            ctx.rotate(f.drehung.winkel * Math.PI / 180)
            ctx.translate(-f.drehung.cx, -f.drehung.cy)
        }
        ctx.globalAlpha = f.deckkraft == null ? 1 : f.deckkraft
        ctx.setLineDash(f.muster || [])
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        if (f.breite) ctx.lineWidth = f.breite
        if (f.strich) ctx.strokeStyle = f.strich
        if (f.fuellung) ctx.fillStyle = f.fuellung
        switch (f.art) {
            case 'linie':
                ctx.beginPath(); ctx.moveTo(f.x1, f.y1); ctx.lineTo(f.x2, f.y2); ctx.stroke(); break
            case 'kurve':
                ctx.beginPath(); ctx.moveTo(f.x1, f.y1); ctx.quadraticCurveTo(f.kx, f.ky, f.x2, f.y2); ctx.stroke(); break
            case 'polylinie':
                if (f.punkte.length) {
                    ctx.beginPath(); ctx.moveTo(f.punkte[0][0], f.punkte[0][1])
                    for (const [x, y] of f.punkte.slice(1)) ctx.lineTo(x, y)
                    ctx.stroke()
                }
                break
            case 'polygon':
                ctx.beginPath(); ctx.moveTo(f.punkte[0][0], f.punkte[0][1])
                for (const [x, y] of f.punkte.slice(1)) ctx.lineTo(x, y)
                ctx.closePath()
                if (f.fuellung) ctx.fill()
                if (f.strich) ctx.stroke()
                break
            case 'rechteck':
                ctx.beginPath()
                if (f.radius && ctx.roundRect) ctx.roundRect(f.x, f.y, f.b, f.h, f.radius)
                else ctx.rect(f.x, f.y, f.b, f.h)
                if (f.fuellung) ctx.fill()
                if (f.strich) ctx.stroke()
                break
            case 'ellipse':
                ctx.beginPath(); ctx.ellipse(f.cx, f.cy, f.rx, f.ry, 0, 0, Math.PI * 2)
                if (f.fuellung) ctx.fill()
                if (f.strich) ctx.stroke()
                break
            case 'text':
                ctx.fillStyle = f.farbe
                ctx.font = `${f.groesse}px ${f.schrift}`
                ctx.textBaseline = 'top'
                f.zeilen.forEach((z, i) => ctx.fillText(z, f.x, f.y + i * f.groesse * ZEILENHOEHE))
                break
            case 'bild':
                if (bilder[f.url]) ctx.drawImage(bilder[f.url], f.x, f.y, f.b, f.h)
                break
        }
        ctx.restore()
    }
}

/** Alle Marker eines Zustands zeichnen. */
export function zeichneZustand(ctx, z, W, H, bilder = {}) {
    for (const m of z.marker) zeichneFormen(ctx, formen(m, W, H), bilder)
}

export function bildUrlsIn(z) {
    return [...new Set(z.marker.filter(m => m.typ === 'bild' && m.url).map(m => m.url))]
}

// ── Browser: Einbrennen ────────────────────────────────────────────────────

export function ladeBild(url) {
    return new Promise((ok, fehler) => {
        const img = new Image()
        img.onload = () => ok(img)
        img.onerror = () => fehler(new Error('Bild nicht lesbar'))
        img.src = url
    })
}

/** MIME-Typ einer Daten-URL ('image/png' als Ersatz). */
export function mimeVon(url) {
    const m = /^data:([^;,]+)[;,]/.exec(String(url || ''))
    return m ? m[1] : 'image/png'
}

/**
 * Original + Markierungen als EIN Bild (Daten-URL). Behebt A-S1: bisher stand
 * in `annotatedBase64` nur die transparente Markierungsebene, und Kopieren,
 * Playbook, Daily und die KI bekamen ein Bild ohne Chart.
 * Format bleibt das des Originals (JPEG bleibt JPEG, sonst PNG).
 */
export async function brenneEin(originalUrl, z, ebeneUrl = '') {
    const bild = await ladeBild(originalUrl)
    const W = bild.naturalWidth, H = bild.naturalHeight
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')
    ctx.drawImage(bild, 0, 0, W, H)
    if (ebeneUrl) ctx.drawImage(await ladeBild(ebeneUrl), 0, 0, W, H)
    const bilder = {}
    for (const url of bildUrlsIn(z)) {
        try { bilder[url] = await ladeBild(url) } catch { /* fehlt eben */ }
    }
    zeichneZustand(ctx, z, W, H, bilder)
    const mime = mimeVon(originalUrl)
    if (mime === 'image/jpeg' || mime === 'image/webp') return canvas.toDataURL(mime, 0.92)
    return canvas.toDataURL('image/png')
}
