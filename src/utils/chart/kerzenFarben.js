/**
 * Kerzenfarben des Charts — einstellbar per Doppelklick auf eine Kerze oder unter
 * Einstellungen › Chart & Analyse › Chart, gilt für
 * alle Panels und das Trade-Bild. Vorgabe: steigend in der Hausfarbe (hohl mit
 * farbigem Rand, wie bisher), fallend grau und gefüllt. Gespeichert als zwei
 * Hex-Werte in `settings.chartKerzeSteigend`/`chartKerzeFallend`; leer oder
 * ungültig = Vorgabe, damit eine spätere Änderung der Vorgabe auch ankommt.
 */
export const KERZEN_STANDARD = Object.freeze({ steigend: '#1fd6c4', fallend: '#787b86' })

const HEX = /^#[0-9a-f]{6}$/i

export function kerzenFarben(einstellungen) {
    const s = einstellungen?.chartKerzeSteigend, f = einstellungen?.chartKerzeFallend
    return {
        steigend: HEX.test(s || '') ? s.toLowerCase() : KERZEN_STANDARD.steigend,
        fallend: HEX.test(f || '') ? f.toLowerCase() : KERZEN_STANDARD.fallend,
    }
}

export function mitDeckkraft(hex, a) {
    const n = parseInt(hex.slice(1), 16)
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

/** Optionen der Kerzenserie: steigende Kerzen hohl, fallende gefüllt — lesbar auch ohne Farbsinn. */
export function kerzenOptionen(f) {
    return {
        upColor: mitDeckkraft(f.steigend, 0.12), downColor: f.fallend,
        borderUpColor: f.steigend, borderDownColor: f.fallend,
        wickUpColor: f.steigend, wickDownColor: f.fallend,
    }
}

export function volumenFarbe(f, steigt) {
    return mitDeckkraft(steigt ? f.steigend : f.fallend, 0.28)
}

/**
 * Liegt der Zeiger auf einer Kerze? Alles in Pixeln des Panels: `mitteX` der Kerze,
 * `hochY`/`tiefY` von Hoch und Tief, `breite` = Abstand zweier Kerzen. Ein paar
 * Pixel Rand, damit auch ein Docht oder eine flache Kerze zu treffen ist — daneben
 * bleibt der Doppelklick beim Vollbild.
 */
export function trifftKerze(x, y, { mitteX, hochY, tiefY, breite }) {
    if (![x, y, mitteX, hochY, tiefY].every(Number.isFinite)) return false
    const halb = Math.max(3, (Number(breite) || 0) * 0.45)
    const oben = Math.min(hochY, tiefY) - 4, unten = Math.max(hochY, tiefY) + 4
    return Math.abs(x - mitteX) <= halb && y >= oben && y <= unten
}
