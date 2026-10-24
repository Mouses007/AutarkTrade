/**
 * Warnungen für offene Positionen (rein, ohne Vue und Netz):
 *
 *   ohneSl     kein Stop-Loss gesetzt
 *   hinterLiq  Stop-Loss liegt hinter dem Liquidationspreis — Long: SL ≤ Liq,
 *              Short: SL ≥ Liq. Die Börse liquidiert dann, bevor der Stop greift.
 *
 * Unbekannt ist nicht „ohne": konnte die Börse nicht gefragt werden
 * (`slUnbekannt`), schweigt die Prüfung. Frisch eröffnete Positionen bekommen
 * `gnadeMs`, weil der Stop oft erst Sekunden nach dem Einstieg gesetzt wird.
 */
export const GNADE_MS = 60_000

/**
 * @param {Array<{id, symbol, richtung, sl, liq, slUnbekannt, einstiegT}>} positionen  aus `ladeAlleOffenen()`
 * @returns {Array<{schluessel, id, symbol, richtung, art, sl, liq}>}
 */
export function positionsWarnungen(positionen, { jetzt = Date.now(), gnadeMs = GNADE_MS } = {}) {
    const aus = []
    for (const p of positionen || []) {
        if (!p || p.slUnbekannt) continue
        if (p.einstiegT && jetzt - p.einstiegT < gnadeMs) continue
        let art = null
        if (!(p.sl > 0)) art = 'ohneSl'
        else if (p.liq > 0 && (p.richtung === 'short' ? p.sl >= p.liq : p.sl <= p.liq)) art = 'hinterLiq'
        if (art) aus.push({ schluessel: `${p.id}|${art}`, id: p.id, symbol: p.symbol, richtung: p.richtung, art, sl: p.sl ?? null, liq: p.liq ?? null })
    }
    return aus
}
