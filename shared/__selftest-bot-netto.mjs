/**
 * Selbsttest: Netto beendeter Pionex-Futures-Grid-Bots (shared/botNetto.js) gegen gespeicherte echte Antworten.
 * Aufruf: node shared/__selftest-bot-netto.mjs
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { nettoAusMarge, nettoAusGewinn, brauchtNettoKorrektur, tradeNettoKorrigiert, tagNettoKorrigiert, istSpotBot } from './botNetto.js'

let ok = 0, fehl = 0
const p = (name, bed, zusatz = '') => {
    if (bed) { ok++; console.log(`  ✓ ${name}`) }
    else { fehl++; console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`) }
}
const nahe = (a, b, tol = 1e-4) => Math.abs(a - b) <= tol

console.log('Echter XRP-Bot 15.11.2026 (beendet)')
const xrp = { marginBalance: '16.67057363816801', quoteInvestment: '11.52', extraMargin: '5', totalRealizedProfit: '0.2144000000000011', totalFee: '-0.05494197', totalFundingFee: '-0.00195519183199096' }
p('aus der Marge: +0.1506 wie Pionex «Gesamt Profit» 0.15, nicht 0.2144', nahe(nettoAusMarge(xrp), 0.15057, 1e-4))
p('Näherung Gewinn − Gebühren + Funding trifft dasselbe auf 0.01', nahe(nettoAusGewinn(xrp.totalRealizedProfit, xrp.totalFee, xrp.totalFundingFee), nettoAusMarge(xrp), 0.01))
p('ohne Marge oder Investition → null (dann die Näherung)', nettoAusMarge({ quoteInvestment: '10' }) === null && nettoAusMarge({ marginBalance: '', quoteInvestment: '10' }) === null && nettoAusMarge(null) === null)
p('Marge 0 ist gültig (Liquidation): ganzer Einsatz weg', nettoAusMarge({ marginBalance: '0', quoteInvestment: '4.09' }) === -4.09)
p('entnommener Gewinn zählt mit', nahe(nettoAusMarge({ marginBalance: '10', quoteInvestment: '10', profitWithdrawn: '0.5' }), 0.5))

console.log('Gespeicherte Antworten: Lücke = |Gebühren| − Funding')
const hier = path.dirname(fileURLToPath(import.meta.url))
const fix = JSON.parse(readFileSync(path.join(hier, '..', 'server', 'fixtures', 'pionex-bot-orders.json'), 'utf8'))
const beendet = fix.data.results.filter((o) => String(o.buOrderData?.status) !== 'running' && String(o.buOrderData?.investCoin).toUpperCase() === 'USDT')
p('mindestens ein beendeter USDT-Bot in der Fixture', beendet.length >= 1)
for (const o of beendet) {
    const d = o.buOrderData
    const m = nettoAusMarge(d), g = nettoAusGewinn(d.totalRealizedProfit, d.totalFee, d.totalFundingFee)
    const liquidiert = d.reasonBy === 'force_liquidation'
    p(`${d.reasonBy}: Marge ${m.toFixed(4)} ${liquidiert ? '≥' : '≈'} Näherung ${g.toFixed(4)}, beide unter totalRealizedProfit ${Number(d.totalRealizedProfit).toFixed(4)}`,
        m < Number(d.totalRealizedProfit) && (liquidiert ? m >= g - 1e-9 : nahe(m, g, 0.01)))
}

console.log('Bereits importierte Trades')
const alt = { id: 't1_0_abc', category: 'bot', botType: 'futures_grid', symbol: 'ZECUSDT', buyQuantity: 5, netProceeds: -13.0891, netSharePL: -13.0891, grossProceeds: -12.4256, grossSharePL: -12.4256, commission: 0.6635, tradingFee: 0.6635, fundingFee: 0, pnlUsdt: -13.0891, netWinsCount: 0, netLossCount: 1, grossWinsCount: 0, grossLossCount: 1 }
const neu = tradeNettoKorrigiert(alt)
p('USDT-M: Netto −13.0891 → −13.7526 (echt: −13.7526), altes Netto wird Brutto', nahe(neu.netProceeds, -13.7526) && nahe(neu.netSharePL, -13.7526) && nahe(neu.grossProceeds, -13.0891) && nahe(neu.pnlUsdt, -13.7526))
p('Gebühr und Funding bleiben, Marke gesetzt, Original unverändert', neu.commission === 0.6635 && neu.fundingFee === 0 && neu.nettoNachGebuehren === true && alt.netProceeds === -13.0891 && !alt.nettoNachGebuehren)
p('zweiter Lauf ändert nichts (idempotent)', tradeNettoKorrigiert(neu) === neu)
const gewinner = tradeNettoKorrigiert({ ...alt, netProceeds: 0.5, netSharePL: 0.5, tradingFee: 0.6, commission: 0.6, fundingFee: 0.02, netWinsCount: 1, netLossCount: 0 })
p('knapper Gewinn wird nach Gebühren zum Verlust (Zähler mit)', nahe(gewinner.netProceeds, -0.08) && gewinner.netWinsCount === 0 && gewinner.netLossCount === 1 && gewinner.grossWinsCount === 1)
p('erhaltenes Funding (+) erhöht das Netto', nahe(tradeNettoKorrigiert({ ...alt, netProceeds: 1, tradingFee: 0.1, commission: 0.1, fundingFee: 0.05 }).netProceeds, 0.95))

const futures = { id: 't1_1_px', category: 'futures', symbol: 'BTCUSDT', netProceeds: 5, tradingFee: 1 }
const spot = { id: 't1_2_sp', category: 'bot', botType: 'spot_grid', netProceeds: 2, tradingFee: 0.1 }
p('reguläre Futures und Spot-Grids bleiben unberührt (dieselbe Referenz)', tradeNettoKorrigiert(futures) === futures && tradeNettoKorrigiert(spot) === spot && !brauchtNettoKorrektur(futures) && !brauchtNettoKorrektur(spot) && istSpotBot('us_token_grid'))

const coinm = { id: 't1_3_cm', category: 'bot', botType: 'futures_grid', coinM: true, marginCoin: 'SOL', einheitUsdt: true, netProceeds: -2.28, netSharePL: -2.28, netCoin: 0.0252, feeCoin: 0.0563, fundingCoin: 0.0057, commission: 4.5, tradingFee: 4.5, fundingFee: 0.4 }
const cm = tradeNettoKorrigiert(coinm)
p('Coin-M: USDT-Netto bleibt (kam schon aus der Marge), netCoin +0.0252 → −0.0254', cm.netProceeds === -2.28 && nahe(cm.netCoin, -0.0254) && nahe(cm.grossCoin, 0.0252) && cm.nettoNachGebuehren === true)

console.log('Tageszeile')
const tag = tagNettoKorrigiert({ trades: [alt, futures], executions: [{ ...alt, trade: alt.id }] })
p('Zeile mit Bot: geändert, P&L neu summiert, Futures-Trade gleich', tag.geaendert && nahe(tag.pAndL.netProceeds, -13.7526 + 5) && tag.trades[1] === futures && nahe(tag.executions[0].netProceeds, -13.7526))
p('Zeile ohne offenen Bot-Trade: nichts zu tun', tagNettoKorrigiert({ trades: [futures, spot, neu] }).geaendert === false && tagNettoKorrigiert(null).geaendert === false)

console.log(`\n${ok} bestanden, ${fehl} fehlgeschlagen`)
process.exit(fehl ? 1 : 0)
