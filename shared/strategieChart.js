/**
 * Datenform der Strategie-Ebene im Chart (`src/utils/chart/overlays/InstanzEbene.js`).
 *
 * Eine Form für zwei Quellen: Zeilen aus `strategy_setups`/`strategy_positions`/
 * `strategy_trades` (Instanz-Ansicht, Server) und das Ergebnis eines Backtests
 * (Labor, Bibliothek, Browser). Beide tragen dieselben Feldnamen; PostgreSQL
 * liefert bigint als Zeichenkette, deshalb geht jede Zahl durch `n()`.
 *
 * Rein — kein Netz, keine Datenbank (Selbsttest `__selftest-strategie-chart.mjs`).
 */

/** Zahl oder null — '' und Unsinn werden nicht zu 0. */
export const n = (v) => {
    if (v == null || v === '') return null
    const x = Number(v)
    return Number.isFinite(x) ? x : null
}

/**
 * Zeitpunkt in ms aus einer DB-Zeitspalte: PostgreSQL liefert ein Date,
 * SQLite `CURRENT_TIMESTAMP` als 'YYYY-MM-DD HH:MM:SS' in UTC ohne Zone.
 */
function zeitpunkt(v) {
    if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null
    if (typeof v === 'string' && /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d/.test(v)) {
        const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : `${v.replace(' ', 'T')}Z`)
        return Number.isFinite(t) ? t : null
    }
    return n(v)
}

function parse(text, ersatz) {
    if (text == null || text === '') return ersatz
    if (typeof text === 'object') return text
    try { return JSON.parse(text) } catch { return ersatz }
}

export function setupAus(r) {
    return {
        id: r.id, instanceId: n(r.instanceId), strategyId: r.strategyId || '', symbol: r.symbol || '', timeframe: r.timeframe || '',
        richtung: r.direction, status: r.status,
        sweepLevel: n(r.sweepLevel), sweepPrice: n(r.sweepPrice), sweepT: n(r.sweepCandleTime),
        obHoch: n(r.obHigh), obTief: n(r.obLow), obT: n(r.obCandleTime),
        einstieg: n(r.entry), stop: n(r.stopLoss), ziel: n(r.takeProfit), rr: n(r.rr),
        ausgeloestT: n(r.triggeredAt) || null,
        grund: r.invalidReason || r.rejectReason || null,
        bestaetigung: parse(r.confirmations, {}),
        erkanntT: n(r.erkanntT) ?? null,
        // Ende ohne Einstieg (ungültig, abgelaufen). Zeilen von vor dem
        // 01.11.2026 tragen es nicht — dann der letzte Statuswechsel, nicht
        // mehr pauschal 20 Kerzen ab der Box.
        endeT: n(r.endeT) || (WARTEND.includes(r.status) ? null : zeitpunkt(r.updatedAt)),
    }
}

const WARTEND = ['armed', 'waiting_retest']

export function positionAus(r) {
    return {
        id: r.id, instanceId: n(r.instanceId), symbol: r.symbol || '', timeframe: r.timeframe || '',
        modus: r.mode, richtung: r.direction,
        einstieg: n(r.entryPrice), einstiegT: n(r.entryTime), stop: n(r.stopLoss), anfangsStop: n(r.initialStopLoss),
        ziel: n(r.takeProfit), liq: n(r.liqPrice), status: r.status,
    }
}

export function tradeAus(r, index = 0) {
    return {
        id: r.id ?? `t${index}`, setupId: n(r.setupId), instanceId: n(r.instanceId), symbol: r.symbol || '', timeframe: r.timeframe || '',
        modus: r.mode, richtung: r.direction,
        einstieg: { t: n(r.entryTime), p: n(r.entryPrice) },
        ausstieg: n(r.exitTime) ? { t: n(r.exitTime), p: n(r.exitPrice) } : null,
        stop: n(r.stopLoss), ziel: n(r.takeProfit), r: n(r.rMultiple), netto: n(r.netPnl),
        grund: r.exitReason || null,
    }
}

/**
 * Ein Backtest-Ergebnis als Ebenen-Daten. Positionen gibt es dort nicht —
 * am Ende offene stehen als Trade mit `open_at_end` in der Liste.
 */
export function ausBacktest(ergebnis) {
    // Ältere Ergebnisse tragen am Setup keine `strategyId` — dann die des
    // Laufs, sonst zeichnet die Ebene Swing Game als Zone (BUG-L5-004).
    const strategyId = ergebnis?.meta?.strategyId || ''
    const setups = (ergebnis?.setups || [])
        .map((s) => (s.strategyId || !strategyId ? s : { ...s, strategyId }))
        .map(setupAus)
    const trades = (ergebnis?.trades || []).map((t, i) => tradeAus(t, i))
    return { setups, positionen: [], trades }
}
