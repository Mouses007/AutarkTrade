/**
 * Titel der Einstiegslinie einer offenen Position (Schild an der Preisachse,
 * `ChartPanel.ladePositionen`): Richtung, Menge und Live-P&L in USDT.
 *
 * `foto` (Bild für die Chart-KI, `ChartPanel.bildschirmfoto({ ohneKontowerte })`,
 * Audit 4.3.4 SEC-L6-001): nur die Richtung — Menge und Ergebnis der echten
 * Position gehören nicht in das Bild, das an den KI-Anbieter geht.
 */
export function positionsTitel(pos, kurs, { foto = false } = {}) {
    const r = pos.richtung === 'long' ? 'Long' : 'Short'
    if (foto) return r
    if (!kurs || !pos.einstieg || !pos.menge) return `${r} ${pos.menge ?? ''}`
    const pnl = (pos.richtung === 'long' ? kurs - pos.einstieg : pos.einstieg - kurs) * pos.menge
    return `${r} ${pos.menge} · ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}`
}
