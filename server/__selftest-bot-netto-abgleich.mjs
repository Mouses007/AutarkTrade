/**
 * Selbsttest: Bot-Trades im Journal exakt aus Pionex nachrechnen (server/bot-netto-abgleich.js).
 * Wegwerf-Datenbank im Speicher, Pionex durch eine Liste ersetzt.
 * Aufruf: node server/__selftest-bot-netto-abgleich.mjs
 */
import knexLib from 'knex'
import { gleicheBotNettoAb, nettoNachBot } from './bot-netto-abgleich.js'
import { migriereBotNetto } from './migrationen/bot-netto.js'

let ok = 0, fehl = 0
const p = (name, bed, zusatz = '') => {
    if (bed) { ok++; console.log(`  ✓ ${name}`) }
    else { fehl++; console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`) }
}
const nahe = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol

const knex = knexLib({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })
await knex.schema.createTable('trades', (t) => { t.increments('id'); t.string('broker'); t.text('trades'); t.text('executions'); t.text('blotter'); t.text('pAndL') })

// Stand vor dem 16.11.2026: Netto = totalRealizedProfit (vor Gebühren)
const basis = { category: 'bot', botType: 'futures_grid', buyQuantity: 1, grossWinsCount: 0, grossLossCount: 1, netWinsCount: 0, netLossCount: 1 }
const liq = { ...basis, id: 't1_0_bot-liq', symbol: 'MYXUSDT', netProceeds: -93.64, grossProceeds: -9.38, commission: 84.74, tradingFee: 84.74, fundingFee: 0.48 }
const alt = { ...basis, id: 't1_1_bot-alt', symbol: 'ZECUSDT', netProceeds: -13.0891, grossProceeds: -12.4256, commission: 0.6635, tradingFee: 0.6635, fundingFee: 0 }
const weg = { ...basis, id: 't1_2_bot-weg', symbol: 'SOLUSDT', netProceeds: -5, grossProceeds: -4, commission: 1, tradingFee: 1, fundingFee: 0 }
const fut = { id: 't1_3_px-42', category: 'futures', symbol: 'BTCUSDT', netProceeds: 5, grossProceeds: 6, commission: 1, grossWinsCount: 1, grossLossCount: 0, netWinsCount: 1, netLossCount: 0 }
await knex('trades').insert([
    { broker: 'pionex', trades: JSON.stringify([liq, alt, weg, fut]), executions: JSON.stringify([{ ...liq, trade: liq.id }]), blotter: '[]', pAndL: '{}' },
    { broker: 'bitunix', trades: JSON.stringify([{ ...alt }]), executions: '[]', blotter: '[]', pAndL: '{}' },
])
const orders = [
    { buOrderId: 'bot-liq', buOrderType: 'futures_grid', buOrderData: { marginBalance: '0.43', quoteInvestment: '144', extraMargin: '0' } },
    { buOrderId: 'bot-alt', buOrderType: 'futures_grid', buOrderData: { marginBalance: '53.1074', quoteInvestment: '66.86', extraMargin: '0' } },
    { buOrderId: 'spot-1', buOrderType: 'spot_grid', buOrderData: { marginBalance: '0', quoteInvestment: '10' } },
    { buOrderId: 'ohne-marge', buOrderType: 'futures_grid', buOrderData: { quoteInvestment: '10' } },
]

console.log('Liste → Netto je Bot')
const m = nettoNachBot(orders)
p('nur Futures-Grids mit Marge', m.size === 2 && nahe(m.get('bot-liq'), -143.57) && !m.has('spot-1') && !m.has('ohne-marge'))

console.log('Erst die Näherung der Start-Migration, dann der exakte Abgleich')
await migriereBotNetto(knex)
const nachMigration = JSON.parse((await knex('trades').where('id', 1).first()).trades)
p('Migration: liquidierter Bot genähert −177.90 (zu streng)', nahe(nachMigration[0].netProceeds, -93.64 - 84.74 + 0.48))
let abrufe = 0
const r = await gleicheBotNettoAb(knex, async () => { abrufe++; return orders })
const z = await knex('trades').where('id', 1).first()
const t = JSON.parse(z.trades), pl = JSON.parse(z.pAndL)
p('liquidierter Bot exakt −143.57', nahe(t[0].netProceeds, -143.57) && t[0].nettoAusPionex === true)
p('normaler Bot: −13.7526 bleibt (Näherung war richtig)', nahe(t[1].netProceeds, -13.7526, 1e-4) && t[1].nettoAusPionex === true)
p('Bot, den Pionex nicht mehr kennt: Näherung bleibt, Marke «unbekannt»', nahe(t[2].netProceeds, -6) && t[2].nettoAusPionex === 'unbekannt')
p('reguläre Futures unberührt, Tages-Netto neu summiert', t[3].netProceeds === 5 && !t[3].nettoAusPionex && nahe(pl.netProceeds, -143.57 - 13.7526 - 6 + 5, 1e-4))
p('Execution mitgezogen', nahe(JSON.parse(z.executions)[0].netProceeds, -143.57))
p('Zähler: 1 Tag, 2 exakt, 1 unbekannt', r.tage === 1 && r.exakt === 2 && r.unbekannt === 1, JSON.stringify(r))
p('Bitunix-Zeile unberührt', JSON.parse((await knex('trades').where('id', 2).first()).trades)[0].netProceeds === -13.0891)

console.log('Wiederholung')
const vorher = z.trades
const r2 = await gleicheBotNettoAb(knex, async () => { abrufe++; return [] })
p('zweiter Lauf: nichts zu tun, kein Abruf bei Pionex', r2.tage === 0 && abrufe === 1 && (await knex('trades').where('id', 1).first()).trades === vorher)
await knex('trades').insert({ broker: 'pionex', trades: JSON.stringify([{ ...alt, id: 't2_0_bot-neu' }]), executions: '[]', blotter: '[]', pAndL: '{}' })
let geworfen = false
try { await gleicheBotNettoAb(knex, async () => { throw new Error('Pionex API: 502') }) } catch { geworfen = true }
p('Abruf scheitert: Fehler nach oben, Zeile unverändert (nächster Start versucht es wieder)', geworfen && !JSON.parse((await knex('trades').where('id', 3).first()).trades)[0].nettoAusPionex)

console.log('Coin-M-Bot, der in der Coin statt in USDT im Journal steht (echter Fall SOL 16.11.2026)')
{
    // so stand er nach dem ersten Abgleich: Netto −3.5318 (SOL!) ohne coinM, als wären es USDT
    const sol = { ...basis, id: 't3_0_bot-sol', symbol: 'SOLUSDT', netProceeds: -3.531808143777482, grossProceeds: -3.4391285, commission: 0.03442498156, tradingFee: 0.03442498156, fundingFee: -0.05825466221748219, nettoNachGebuehren: true, nettoAusPionex: true, investment: 2.246 }
    const usdt = { ...basis, id: 't3_1_bot-alt', symbol: 'ZECUSDT', netProceeds: -13.7526, grossProceeds: -13.0891, commission: 0.6635, tradingFee: 0.6635, fundingFee: 0, nettoNachGebuehren: true, nettoAusPionex: true }
    const [zid] = await knex('trades').insert({ broker: 'pionex', trades: JSON.stringify([sol, usdt]), executions: JSON.stringify([{ ...sol, trade: sol.id }]), blotter: '[]', pAndL: '{}' }).returning('id')
    const id = typeof zid === 'object' ? zid.id : zid
    const solOrder = { buOrderId: 'bot-sol', buOrderType: 'futures_grid', base: 'USDT.PERP', quote: 'SOL', createTime: 1, closeTime: 2, buOrderData: { cateType: 'FUTURE_GRID_COIN_MARGINED', investCoin: 'SOL', marginBalance: '0.9611918562225178', quoteInvestment: '3.068', extraMargin: '1.425', totalRealizedProfit: '-3.4391285', totalFee: '-0.03442498156', totalFundingFee: '-0.05825466221748219', initQuotePrice: '107.70296610169491', closedQuotePrice: '75.99', trend: 'short', leverage: '4', status: 'canceled' } }
    const altOrder = { buOrderId: 'bot-alt', buOrderType: 'futures_grid', base: 'ZEC.PERP', quote: 'USDT', buOrderData: { investCoin: 'USDT', marginBalance: '53.1074', quoteInvestment: '66.86', extraMargin: '0', status: 'canceled' } }
    const r3 = await gleicheBotNettoAb(knex, async () => [...orders, solOrder, altOrder])
    const z3 = await knex('trades').where('id', id).first()
    const t3 = JSON.parse(z3.trades)
    const erwartet = 0.9611918562225178 * 75.99 - (3.068 + 1.425) * 107.70296610169491
    p('SOL-Bot: USDT-Netto aus der Marge (rund −411), nicht −3.53', t3[0].coinM === true && t3[0].einheitUsdt === true && nahe(t3[0].netProceeds, erwartet, 1e-6) && t3[0].netProceeds < -400, String(t3[0].netProceeds))
    p('Coin-Werte bleiben für die Bot-Seite: netCoin −3.53 SOL, Gebühr in USDT umgerechnet', nahe(t3[0].netCoin, -3.531808143777482) && nahe(t3[0].commission, 0.03442498156 * 75.99, 1e-6) && t3[0].marginCoin === 'SOL')
    p('USDT-Bot daneben unverändert, nur als geprüft markiert', nahe(t3[1].netProceeds, -13.7526, 1e-9) && t3[1].coinMGeprueft === true && !t3[1].coinM)
    p('Tages-Netto neu summiert, Execution mitgezogen, Zähler meldet 1 Coin-M', nahe(JSON.parse(z3.pAndL).netProceeds, erwartet - 13.7526, 1e-6) && JSON.parse(z3.executions)[0].coinM === true && r3.coinM === 1, JSON.stringify(r3))
    const vorher3 = z3.trades
    let abrufe3 = 0
    await gleicheBotNettoAb(knex, async () => { abrufe3++; return [] }).catch(() => {})
    p('danach nichts mehr zu tun für diese Zeile', (await knex('trades').where('id', id).first()).trades === vorher3)
}

await knex.destroy()
console.log(`\n${ok} bestanden, ${fehl} fehlgeschlagen`)
process.exit(fehl ? 1 : 0)
