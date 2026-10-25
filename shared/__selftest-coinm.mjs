/** Selbsttest: Coin-M-Bots in USDT (shared/coinM.js, Audit FIN-01). */
import { tradeInUsdt, tagInUsdt, brauchtUmrechnung, tagesSummen } from './coinM.js'

let ok = 0, fehler = 0
const pruefe = (bed, text) => { if (bed) { ok++; console.log('  ✓ ' + text) } else { fehler++; console.log('  ✗ ' + text) } }
const nah = (a, b) => Math.abs(a - b) < 1e-9

// Echter Fall aus der Datenbank (24.10.2026): SOL-PnL negativ, USD-PnL positiv (SOL stieg)
const sol = {
    symbol: 'USDTSOL', coinM: true, marginCoin: 'SOL', buyQuantity: 500,
    grossProceeds: -0.504, netProceeds: -0.7206495, grossSharePL: -0.504, netSharePL: -0.7206495,
    commission: 0.2165878, tradingFee: 0.2165878, fundingFee: 0,
    pnlUsdt: 26.173084, quoteCloseP: 141.66,
}
const u = tradeInUsdt(sol)
pruefe(nah(u.netProceeds, 26.173084) && nah(u.netSharePL, 26.173084), 'netto = pnlUsdt (der invers gerechnete USD-Wert)')
pruefe(nah(u.commission, 0.2165878 * 141.66) && nah(u.tradingFee, u.commission), 'Gebühr in der Coin × Schlusskurs')
pruefe(nah(u.grossProceeds, u.netProceeds + u.commission - u.fundingFee), 'brutto = netto + Gebühr − Funding')
pruefe(u.netWinsCount === 1 && u.netLossCount === 0 && nah(u.netWins, u.netProceeds), 'Gewinn/Verlust nach dem USD-Ergebnis (in SOL war es ein Verlust)')
pruefe(nah(u.netCoin, -0.7206495) && nah(u.feeCoin, 0.2165878), 'Coin-Werte bleiben für die Bot-Seite erhalten')
pruefe(u.einheitUsdt === true && tradeInUsdt(u) === u, 'idempotent: ein umgerechneter Trade bleibt, wie er ist')

// Ohne pnlUsdt: netto in der Coin × Kurs
const ohnePnl = tradeInUsdt({ ...sol, pnlUsdt: 0 })
pruefe(nah(ohnePnl.netProceeds, -0.7206495 * 141.66), 'pnlUsdt fehlt (0 bei Coin-Ergebnis ≠ 0): netto × Schlusskurs')

// Weder USD-Wert noch Kurs: zählt mit 0, markiert
const nichts = tradeInUsdt({ ...sol, pnlUsdt: null, quoteCloseP: 0 })
pruefe(nichts.ohneUsdt === true && nichts.netProceeds === 0 && nichts.commission === 0, 'ohne USD-Wert und Kurs: 0 und ohneUsdt statt SOL in der USDT-Summe')

// Gegenproben
const usdt = { symbol: 'BTCUSDT', netProceeds: 12, coinM: false, marginCoin: 'USDT' }
pruefe(tradeInUsdt(usdt) === usdt && !brauchtUmrechnung(usdt), 'Gegenprobe: USDT-Trade bleibt unverändert')
pruefe(!brauchtUmrechnung({ ...sol, einheitUsdt: true }), 'Gegenprobe: schon umgerechnet → nichts zu tun')

// Tageszeile: Summen neu
const tag = { trades: [sol, { ...usdt, grossProceeds: 14, commission: 2, grossWinsCount: 1, grossLossCount: 0, netWinsCount: 1, netLossCount: 0 }], executions: [sol] }
const t = tagInUsdt(tag)
pruefe(t.geaendert && nah(t.pAndL.netProceeds, 26.173084 + 12), 'Tages-P&L summiert USDT (26,17 + 12)')
pruefe(t.blotter.length === 2 && t.executions[0].einheitUsdt, 'Blotter je Symbol, Executions ebenfalls umgerechnet')
pruefe(tagInUsdt({ trades: [usdt] }).geaendert === false, 'Tag ohne Coin-M: nichts zu tun')
pruefe(tagesSummen([]).pAndL.trades === 0, 'leerer Tag ergibt leere Summen')

console.log(`coinm: ${ok} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler ? 1 : 0)
