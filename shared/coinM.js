/**
 * Coin-M-Bots in USDT (Audit FIN-01, 24.10.2026).
 *
 * Pionex rechnet Coin-margined Bots in der Coin (z. B. SOL): `netProceeds`,
 * Gebühr und Funding stehen in SOL. Das Journal summiert aber USDT — bis zum
 * 24.10.2026 wurden 62 Coin-M-Trades als „−2,72" (SOL, mit USDT vermischt)
 * gezählt, ihr USD-Wert war +1'937,69. Kontostand, kumulierter PnL und APPT
 * lagen um diesen Betrag daneben; die Bot-Seite rechnete schon richtig.
 *
 * Hier wird ein Coin-M-Trade EINMAL in USDT umgeschrieben, danach ist er für
 * jede Summe ein gewöhnlicher USDT-Trade:
 *   netto   = `pnlUsdt` (invers gerechnet, gegen Pionex verifiziert) — fehlt er,
 *             netto in der Coin × Schlusskurs `quoteCloseP`
 *   Gebühr  = Gebühr in der Coin × Schlusskurs, Funding ebenso
 *   brutto  = netto + Gebühr − Funding (dieselbe Identität wie überall)
 * Die Coin-Werte bleiben als `netCoin`/`grossCoin`/`feeCoin`/`fundingCoin`
 * erhalten (Bot-Seite, Sektion „Coin-M"). `einheitUsdt: true` macht es
 * idempotent. Ohne USD-Wert UND ohne Schlusskurs ist keine Umrechnung möglich:
 * Der Trade zählt dann mit 0 und trägt `ohneUsdt: true` — ein SOL-Betrag in
 * einer USDT-Summe wäre falscher als eine Lücke.
 *
 * Rein, ohne Netz und Datenbank. Selbsttest: `shared/__selftest-coinm.mjs`.
 */
import { istGewinn } from './gewinn.js'

const zahl = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null }

/** Ist das ein Coin-M-Trade, der noch in der Coin rechnet? */
export function brauchtUmrechnung(t) {
    if (!t || t.einheitUsdt) return false
    if (t.coinM) return true
    return !!(t.marginCoin && t.marginCoin !== 'USDT')
}

/**
 * Einen Trade in USDT umschreiben (neues Objekt; andere Trades unverändert zurück).
 * @returns {object}
 */
export function tradeInUsdt(t) {
    if (!brauchtUmrechnung(t)) return t
    const kurs = zahl(t.quoteCloseP)
    const netCoin = zahl(t.netProceeds ?? t.netSharePL) ?? 0
    const grossCoin = zahl(t.grossProceeds ?? t.grossSharePL) ?? 0
    const feeCoin = Math.abs(zahl(t.tradingFee ?? t.commission) ?? 0)
    const fundingCoin = zahl(t.fundingFee) ?? 0
    const pnl = zahl(t.pnlUsdt)
    // pnlUsdt = 0 bei einem Coin-Ergebnis ≠ 0 heisst: nicht gemessen (alter Import)
    const pnlGilt = pnl !== null && (pnl !== 0 || netCoin === 0)
    const netto = pnlGilt ? pnl : (kurs > 0 ? netCoin * kurs : null)
    const coin = { netCoin, grossCoin, feeCoin, fundingCoin }
    if (netto === null) {
        return { ...t, ...nullWerte(t), ...coin, einheitUsdt: true, ohneUsdt: true }
    }
    const gebuehr = kurs > 0 ? feeCoin * kurs : 0
    const funding = kurs > 0 ? fundingCoin * kurs : 0
    const brutto = netto + gebuehr - funding
    return { ...t, ...geldFelder(t, brutto, netto, gebuehr, funding), ...coin, einheitUsdt: true }
}

function geldFelder(t, brutto, netto, gebuehr, funding) {
    const gw = istGewinn(brutto), nw = istGewinn(netto)
    const menge = Number(t.buyQuantity) || 0
    return {
        grossProceeds: brutto, netProceeds: netto, grossSharePL: brutto, netSharePL: netto,
        commission: gebuehr, tradingFee: gebuehr, fundingFee: funding,
        grossWins: gw ? brutto : 0, grossLoss: gw ? 0 : brutto,
        netWins: nw ? netto : 0, netLoss: nw ? 0 : netto,
        grossWinsCount: gw ? 1 : 0, grossLossCount: gw ? 0 : 1,
        netWinsCount: nw ? 1 : 0, netLossCount: nw ? 0 : 1,
        grossWinsQuantity: gw ? menge : 0, grossLossQuantity: gw ? 0 : menge,
        netWinsQuantity: nw ? menge : 0, netLossQuantity: nw ? 0 : menge,
        grossSharePLWins: gw ? brutto : 0, grossSharePLLoss: gw ? 0 : brutto,
        netSharePLWins: nw ? netto : 0, netSharePLLoss: nw ? 0 : netto,
        highGrossSharePLWin: gw ? brutto : 0, highGrossSharePLLoss: gw ? 0 : brutto,
        highNetSharePLWin: nw ? netto : 0, highNetSharePLLoss: nw ? 0 : netto,
    }
}

function nullWerte(t) { return geldFelder(t, 0, 0, 0, 0) }

/**
 * Blotter (je Symbol) und P&L (je Tag) in der Form des API-Imports
 * (`src/utils/quickImport.js`) — dieselben Felder, dieselbe Rechnung.
 */
export function tagesSummen(trades) {
    const jeSymbol = {}
    const p = { grossProceeds: 0, netProceeds: 0, fees: 0, grossWinsCount: 0, grossLossCount: 0, netWinsCount: 0, netLossCount: 0, trades: 0 }
    for (const t of trades) {
        const b = jeSymbol[t.symbol] ||= { symbol: t.symbol, grossProceeds: 0, netProceeds: 0, fees: 0, grossWinsCount: 0, grossLossCount: 0, trades: 0 }
        b.grossProceeds += t.grossProceeds
        b.netProceeds += t.netProceeds
        b.fees += t.commission
        b.grossWinsCount += t.grossWinsCount
        b.grossLossCount += t.grossLossCount
        b.trades += 1
        p.grossProceeds += t.grossProceeds
        p.netProceeds += t.netProceeds
        p.fees += t.commission
        p.grossWinsCount += t.grossWinsCount
        p.grossLossCount += t.grossLossCount
        p.netWinsCount += t.netWinsCount
        p.netLossCount += t.netLossCount
        p.trades += 1
    }
    return { blotter: Object.values(jeSymbol), pAndL: p }
}

/**
 * Eine gespeicherte Tageszeile umrechnen: Trades und Executions in USDT,
 * Blotter und P&L neu. `geaendert: false` = nichts zu tun.
 * @param {{trades: Array, executions?: Array}} zeile  JSON-Felder bereits geparst
 */
export function tagInUsdt(zeile) {
    const trades = Array.isArray(zeile?.trades) ? zeile.trades : []
    if (!trades.some(brauchtUmrechnung)) return { geaendert: false }
    const neueTrades = trades.map(tradeInUsdt)
    const executions = Array.isArray(zeile.executions) ? zeile.executions.map(tradeInUsdt) : zeile.executions
    return { geaendert: true, trades: neueTrades, executions, ...tagesSummen(neueTrades) }
}
