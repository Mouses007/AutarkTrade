/**
 * VRVP — Volumenprofil über den SICHTBAREN Bereich (Visible Range Volume
 * Profile, wie bei TradingView). Rein: Kerzen + sichtbarer logischer Bereich
 * → Balken je Preiszeile. Gerechnet mit `shared/volumenprofil.js`, also aus
 * Kerzen geschätzt (Volumen gleichmässig über Tief–Hoch, Kauf/Verkauf nach
 * Kerzenfarbe) wie das Zeichenwerkzeug „Volumenprofil Fixed-Range".
 *
 * Vorgaben wie die TradingView-Vorlage des Nutzers (27.10.2026):
 * Zeilenanzahl 150, Volumen „Gesamt", Value Area 100 %.
 */
import { volumenprofil } from '../../../shared/volumenprofil.js'

/** Sichtbarer logischer Bereich → Indexbereich der Kerzen (rechts über die Daten hinaus = letzte Kerze). */
export function sichtbareKerzen(anzahl, von, bis) {
    if (!anzahl || von == null || bis == null) return null
    const a = Math.max(0, Math.ceil(von - 0.5))
    const b = Math.min(anzahl - 1, Math.floor(bis + 0.5))
    return b >= a ? { a, b } : null
}

/**
 * @param {Array<{o,h,l,c,v}>} kerzen  alle Kerzen des Charts
 * @param {{a:number,b:number}} bereich  Indexbereich (sichtbareKerzen)
 * @param {object} p  Parameter des Indikators
 * @param {number} tick  kleinste Preisstufe (für „Ticks pro Zeile")
 * @returns {null | { vp, balken: Array<{von,bis,teile:Array<{art,anteil}>,inVa}> }}
 */
export function vrvpProfil(kerzen, bereich, p = {}, tick = 0) {
    if (!bereich) return null
    const teil = kerzen.slice(bereich.a, bereich.b + 1)
    const zeilen = Math.max(1, Math.round(Number(p.zeilen) || 150))
    const opt = p.zeilenLayout === 'ticks' && tick > 0 ? { schritt: zeilen * tick } : { zeilen }
    const va = Math.max(0, Math.min(100, Number(p.va ?? 100))) / 100
    const vp = volumenprofil(teil, { ...opt, va })
    if (!vp) return null
    const art = p.volumen || 'gesamt'
    const wert = (r) => (art === 'delta' ? Math.abs(r.auf - r.ab) : r.summe)
    let max = 0
    for (const r of vp.zeilen) max = Math.max(max, wert(r))
    if (!(max > 0)) return null
    const balken = vp.zeilen.map((r, i) => {
        const teile = art === 'aufAb'
            ? [{ art: 'auf', anteil: r.auf / max }, { art: 'ab', anteil: r.ab / max }]
            : art === 'delta'
                ? [{ art: r.auf >= r.ab ? 'auf' : 'ab', anteil: Math.abs(r.auf - r.ab) / max }]
                : [{ art: 'gesamt', anteil: r.summe / max }]
        return { von: r.von, bis: r.bis, teile: teile.filter((x) => x.anteil > 0), inVa: i >= vp.vaVon && i <= vp.vaBis }
    })
    return { vp, balken }
}
