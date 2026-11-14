/**
 * Selbsttest des Aktien-Radar-Universums.
 *
 *   node server/coin-radar/__selftest-aktien-universum.mjs
 *
 * Ohne Netz. Geprüft wird, was still falsch liefe: ein Titel, den die Quelle
 * gar nicht führt, im Lauf; das falsche Symbol an der Börse (Bitget hängt
 * `STOCK` an); eine Referenz, die es an der Quelle nicht gibt; und dass die
 * Coin-Hürden unangetastet bleiben.
 */
import assert from 'node:assert/strict'
import { universumAus, waehleReferenz, boersenFelder, REFERENZ_TICKER } from './aktien-universum.js'
import { pruefeHuerden, STANDARD_HUERDEN, STANDARD_HUERDEN_AKTIEN } from './bewertung.js'

let n = 0
function pruefe(name, fn) {
    try { fn(); n++ } catch (e) { console.error(`✗ ${name}\n  ${e.message}`); process.exitCode = 1 }
}

const L = (handelsplatz, symbol, art = 'perp', quote = 'USDT') => ({ handelsplatz, symbol, art, quote })
const titel = [
    { ticker: 'NVDA', name: 'NVIDIA', unterart: 'aktie', listungen: [L('binance', 'NVDAUSDT'), L('bitget', 'NVDAUSDT'), L('bitunix', 'NVDAUSDT'), L('pionex', 'NVDAX_USDT', 'token-spot'), L('bitpanda', '123', 'broker-spot', 'EUR')] },
    { ticker: 'ACN', name: 'Accenture', unterart: 'aktie', listungen: [L('bitget', 'ACNSTOCKUSDT'), L('bitpanda', '77', 'broker-spot', 'EUR')] },
    { ticker: 'QQQ', name: null, unterart: 'etf', listungen: [L('bitget', 'QQQUSDT'), L('binance', 'QQQUSDT')] },
    { ticker: 'SAP', name: 'SAP', unterart: 'aktie', listungen: [L('bitpanda', '9', 'broker-spot', 'EUR')] },
    { ticker: 'TSLA', name: 'Tesla', unterart: 'aktie', listungen: [L('binance', 'TSLAUSDC', 'perp', 'USDC'), L('binance', 'TSLAUSDT')] },
]

pruefe('Universum: nur Futures der Quelle, Schlüssel ist ihr Symbol', () => {
    const b = universumAus(titel, 'binance')
    assert.deepEqual([...b.keys()].sort(), ['NVDAUSDT', 'QQQUSDT', 'TSLAUSDT'])
    const g = universumAus(titel, 'bitget')
    assert.deepEqual([...g.keys()].sort(), ['ACNSTOCKUSDT', 'NVDAUSDT', 'QQQUSDT'])
    assert.equal(g.get('ACNSTOCKUSDT').ticker, 'ACN')
})

pruefe('Universum: nur Spot oder nur andere Börse → nicht dabei', () => {
    assert.equal(universumAus(titel, 'bitunix').size, 1)
    assert.equal(universumAus(titel, 'pionex').size, 0)
    assert.equal(universumAus(titel, 'bitpanda').size, 0)
    assert.equal(universumAus([], 'binance').size, 0)
})

pruefe('Universum: USDC-Kontrakt zählt nicht (Hürden rechnen in USDT)', () => {
    assert.equal(universumAus(titel, 'binance').has('TSLAUSDC'), false)
})

pruefe('Referenz: erster Index-ETF der Quelle, sonst keine', () => {
    assert.deepEqual(waehleReferenz(universumAus(titel, 'binance')), { symbol: 'QQQUSDT', ticker: 'QQQ' })
    const mitSpy = [...titel, { ticker: 'SPY', unterart: 'etf', listungen: [L('binance', 'SPYUSDT')] }]
    assert.equal(waehleReferenz(universumAus(mitSpy, 'binance')).ticker, 'SPY')
    assert.equal(waehleReferenz(universumAus(titel, 'bitunix')), null)
    assert.equal(REFERENZ_TICKER[0], 'SPY')
})

pruefe('Handelbar bei: alle Listungen des Titels, nicht nur die der Quelle', () => {
    const f = boersenFelder(universumAus(titel, 'binance').get('NVDAUSDT'))
    assert.equal(f.ticker, 'NVDA')
    assert.equal(f.name, 'NVIDIA')
    assert.deepEqual(f.liste.map((l) => `${l.boerse}/${l.art}`).sort(),
        ['binance/perp', 'bitget/perp', 'bitpanda/broker-spot', 'bitunix/perp', 'pionex/token-spot'])
    assert.deepEqual(boersenFelder(undefined), {})
})

pruefe('Hürden: Aktien eigene Werte, Coins unverändert', () => {
    assert.equal(STANDARD_HUERDEN.minUmsatz24hUsd, 10_000_000)
    assert.equal(STANDARD_HUERDEN.maxSpreadBp, 5)
    const roh = { umsatz24h: 3_000_000, spreadBp: 8 }
    assert.equal(pruefeHuerden(roh, STANDARD_HUERDEN).ok, false)
    assert.equal(pruefeHuerden(roh, STANDARD_HUERDEN_AKTIEN).ok, true)
    // Unbekannter Spread bleibt auch bei Aktien ein Ausschluss.
    assert.equal(pruefeHuerden({ umsatz24h: 3_000_000 }, STANDARD_HUERDEN_AKTIEN).grund, 'spread_unbekannt')
})

if (!process.exitCode) console.log(`✓ Aktien-Radar-Universum: ${n} Prüfungen`)
