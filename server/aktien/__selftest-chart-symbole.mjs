/**
 * Selbsttest: Aktien-Liste für den Chart.
 *
 *   node server/aktien/__selftest-chart-symbole.mjs
 */
import assert from 'node:assert/strict'
import { chartSymboleAus, CHART_BOERSEN } from './chart-symbole.js'

let n = 0
const ok = (bed, text) => { assert.ok(bed, text); n++ }
const l = (handelsplatz, symbol, art = 'perp', quote = 'USDT') => ({ handelsplatz, symbol, art, quote })

const liste = chartSymboleAus([
    { ticker: 'NVDA', name: 'NVIDIA', unterart: 'aktie', listungen: [l('binance', 'NVDAUSDT'), l('bitget', 'NVDAUSDT'), l('bitunix', 'NVDAUSDT'), l('pionex', 'NVDAX_USDT', 'token-spot'), l('bitpanda', '123', 'broker-spot', 'EUR')] },
    { ticker: 'ACN', name: null, unterart: 'aktie', listungen: [l('bitget', 'ACNSTOCKUSDT')] },
    { ticker: 'ASML', name: 'ASML', unterart: 'aktie', listungen: [l('bitpanda', '77', 'broker-spot', 'EUR')] },
    { ticker: 'AAPL', name: 'Apple', unterart: 'aktie', listungen: [l('binance', 'AAPLUSDC', 'perp', 'USDC'), l('binance', 'AAPLUSDT')] },
    { ticker: 'XYZ', name: null, unterart: 'aktie', listungen: [l('pionex', 'XYZUSDT')] },
])
const je = Object.fromEntries(liste.map((t) => [t.ticker, t]))

ok(liste.map((t) => t.ticker).join() === 'AAPL,ACN,NVDA', 'nur Titel mit Future an einer Chart-Börse, nach Ticker sortiert')
ok(je.NVDA.symbole.binance === 'NVDAUSDT' && je.NVDA.symbole.bitunix === 'NVDAUSDT', 'Symbol je Börse')
ok(je.NVDA.spot.join() === 'bitpanda,pionex', 'Spot-Plätze als Hinweis')
ok(je.ACN.symbole.bitget === 'ACNSTOCKUSDT' && !je.ACN.symbole.binance, 'Bitget-Schreibweise bleibt erhalten')
ok(je.AAPL.symbole.binance === 'AAPLUSDT', 'USDC-Kontrakt zählt nicht')
ok(!je.ASML && !je.XYZ, 'nur Spot oder Future an fremder Börse: nicht ladbar')
ok(chartSymboleAus().length === 0 && CHART_BOERSEN.length === 3, 'leer bleibt leer')

console.log(`✓ Chart-Symbole Aktien: ${n} Prüfungen`)
