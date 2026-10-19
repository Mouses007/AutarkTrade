/**
 * Gestaltung der Journal-Diagramme — Farben und Grundbausteine aus den
 * Design-Tokens (`src/assets/design/tokens.css`).
 *
 * Die Tokens werden zur Laufzeit aus `:root` gelesen. Wo es kein DOM gibt
 * (Node-Selbsttest) oder eine Variable fehlt, gelten die Rückfallwerte unten —
 * sie sind eine Abschrift von tokens.css und nur dafür da, dass ein Diagramm
 * nie ohne Farbe dasteht. Die Quelle der Wahrheit bleibt tokens.css.
 *
 * Grundsatz (AutarkDarts): ruhig und dunkel, Türkis ist die einzige
 * Signalfarbe, Grün/Rot nur für Gewinn/Verlust, Gitter kaum sichtbar,
 * Hintergrund transparent (die Karte darunter trägt die Fläche).
 */

const RUECKFALL = {
    '--bg': '#05080a',
    '--panel': '#0c1216',
    '--panel-soft': '#131c22',
    '--line': '#1d2b33',
    '--line-stark': '#2a3d47',
    '--text': '#e8f4f6',
    '--muted': '#8ea5af',
    '--leise': '#6b818b',
    '--accent': '#1fd6c4',
    '--good': '#3fbf8f',
    '--bad': '#e0574c',
    '--warn': '#d8a33a',
    '--schrift': 'system-ui, -apple-system, "Segoe UI", Roboto, "Liberation Sans", Arial, sans-serif',
}

function leseToken(name) {
    try {
        if (typeof document !== 'undefined' && typeof getComputedStyle === 'function' && document.documentElement) {
            const wert = getComputedStyle(document.documentElement).getPropertyValue(name)
            if (wert && wert.trim()) return wert.trim()
        }
    } catch { /* kein echtes CSS (Test, SSR) */ }
    return RUECKFALL[name]
}

/** Hex (#rgb / #rrggbb) oder rgb()/rgba() → [r, g, b]; unbekannt → null. */
export function zuRgb(farbe) {
    const f = String(farbe || '').trim()
    let m = /^#([0-9a-f]{3})$/i.exec(f)
    if (m) return m[1].split('').map(c => parseInt(c + c, 16))
    m = /^#([0-9a-f]{6})$/i.exec(f)
    if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16))
    m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(f)
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3])]
    return null
}

/** Farbe mit Deckkraft als rgba()-Zeichenkette. */
export function mitDeckkraft(farbe, alpha) {
    const rgb = zuRgb(farbe)
    if (!rgb) return farbe
    return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`
}

/** Lineare Mischung zweier Farben, Anteil t von `nach` (0…1), als rgb(). */
export function mische(von, nach, t) {
    const a = zuRgb(von) || [0, 0, 0]
    const b = zuRgb(nach) || [255, 255, 255]
    const k = (i) => Math.round(a[i] + (b[i] - a[i]) * t)
    return `rgb(${k(0)},${k(1)},${k(2)})`
}

/**
 * Aktuelle Palette. Bei jedem Zeichnen neu gelesen, damit ein späteres
 * Laden der Stylesheets (oder ein Theme-Wechsel) nicht an alten Werten hängt.
 */
export function palette() {
    const text = leseToken('--text')
    const muted = leseToken('--muted')
    const line = leseToken('--line')
    const good = leseToken('--good')
    const bad = leseToken('--bad')
    return {
        bg: leseToken('--bg'),
        panel: leseToken('--panel'),
        panelSoft: leseToken('--panel-soft'),
        line,
        lineStark: leseToken('--line-stark'),
        text,
        muted,
        leise: leseToken('--leise'),
        accent: leseToken('--accent'),
        good,
        bad,
        warn: leseToken('--warn'),
        schrift: leseToken('--schrift'),
        // Balken leicht gedämpft, beim Überfahren voll
        goodBalken: mitDeckkraft(good, 0.85),
        badBalken: mitDeckkraft(bad, 0.85),
        goodHover: mitDeckkraft(good, 1),
        badHover: mitDeckkraft(bad, 1),
        gitter: mitDeckkraft(line, 0.6),
    }
}

/* Exportierte Farbkonstanten (Schnittstelle für AgentPerformance.vue). */
const STAND = palette()
export const cssColor87 = STAND.text
export const cssColor60 = STAND.muted
export const cssColor38 = STAND.line
export const blackbg5 = STAND.panel
export const greenColor = STAND.good
export const redColor = STAND.bad

/** Grundschrift aller Diagramme. */
export function schrift(p = palette(), groesse = 11) {
    return { color: p.muted, fontFamily: p.schrift, fontSize: groesse }
}

/** Tooltip im Panel-Stil. */
export function tooltipStil(p = palette(), extra = {}) {
    return {
        backgroundColor: p.panel,
        borderColor: p.lineStark,
        borderWidth: 1,
        padding: [8, 10],
        textStyle: { color: p.text, fontFamily: p.schrift, fontSize: 12 },
        extraCssText: 'border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.45);',
        ...extra,
    }
}

/** Kategorieachse (ohne `data` — das setzt der Aufrufer). */
export function kategorieAchse(p = palette(), extra = {}) {
    return {
        type: 'category',
        axisLine: { lineStyle: { color: p.line } },
        axisTick: { show: false },
        axisLabel: { ...schrift(p) },
        splitLine: { show: false },
        ...extra,
    }
}

/** Wertachse — bekommt NIE ein `data`-Feld. */
export function wertAchse(p = palette(), extra = {}) {
    return {
        type: 'value',
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { ...schrift(p) },
        splitLine: { lineStyle: { color: p.gitter, type: 'dashed' } },
        ...extra,
    }
}

/** Gemeinsamer Rahmen jeder Option: transparenter Grund, Schrift, keine Animation-Spielerei. */
export function grundOption(p = palette()) {
    return {
        backgroundColor: 'transparent',
        textStyle: { fontFamily: p.schrift, color: p.muted },
        animationDuration: 300,
    }
}

/** Gewinn-/Verlustfarbe nach Vorzeichen. */
export function vorzeichenFarbe(gut, p = palette()) {
    return gut ? p.goodBalken : p.badBalken
}

export function vorzeichenHover(gut, p = palette()) {
    return gut ? p.goodHover : p.badHover
}
