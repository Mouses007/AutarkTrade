/**
 * Selbsttest der Einordnung nach Anlageklasse.
 *
 *   node server/aktien/__selftest-einordnung.mjs
 *
 * Ohne Netz: liest die gekürzte Aufnahme `server/fixtures/aktien-listungen.json`
 * (Symbol-Listen vom 14.11.2026). Geprüft wird, was still falsch laufen würde:
 * ein Coin im Aktien-Radar (AVAX wegen des X, 1000PEPE), eine Aktie in den
 * Krypto-Kacheln, ein Rohstoff als Aktie.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ausBinance, ausBitget, ausBitpanda, bekannteBasen, buendle, ordneAlle } from './einordnung.js'

const hier = path.dirname(fileURLToPath(import.meta.url))
const roh = JSON.parse(fs.readFileSync(path.join(hier, '../fixtures/aktien-listungen.json'), 'utf8'))

let n = 0
function pruefe(name, fn) {
    try { fn(); n++ } catch (e) { console.error(`✗ ${name}\n  ${e.message}`); process.exitCode = 1 }
}

const alle = ordneAlle(roh)
const finde = (platz, symbol) => {
    const l = alle.find((x) => x.handelsplatz === platz && x.symbol === symbol)
    assert.ok(l, `${platz} ${symbol} fehlt in der Aufnahme`)
    return l
}
const ist = (platz, symbol, anlageklasse, unterart) => {
    const l = finde(platz, symbol)
    assert.equal(`${l.anlageklasse}/${l.unterart}`, `${anlageklasse}/${unterart}`, `${platz} ${symbol}`)
    return l
}

pruefe('Binance: underlyingType entscheidet', () => {
    ist('binance', 'BTCUSDT', 'krypto', 'coin')
    ist('binance', '1000PEPEUSDT', 'krypto', 'coin')
    ist('binance', 'NVDAUSDT', 'aktien', 'aktie')
    ist('binance', 'XAUUSDT', 'sonstige', 'rohstoff')
    ist('binance', 'CLUSDT', 'sonstige', 'rohstoff')
    ist('binance', 'USDBRLUSDT', 'sonstige', 'devise')
})

pruefe('Binance: Region aus HK_/KR_EQUITY', () => {
    assert.equal(ist('binance', 'HK0700USDT', 'aktien', 'aktie').region, 'HK')
    assert.equal(ist('binance', 'SAMSUNGUSDT', 'aktien', 'aktie').region, 'KR')
    assert.equal(finde('binance', 'NVDAUSDT').region, null)
})

pruefe('Binance: Krypto-Körbe bleiben Krypto, Pre-IPO ist Aktie, Pre-Market ein Coin', () => {
    ist('binance', 'BTCDOMUSDT', 'krypto', 'index')
    ist('binance', 'DEFIUSDT', 'krypto', 'index')
    ist('binance', 'OPENAIUSDT', 'aktien', 'vorboerslich')
    ist('binance', 'ANTHROPICUSDT', 'aktien', 'vorboerslich')
    ist('binance', 'PREDICTUSDT', 'krypto', 'coin')
})

pruefe('Bitget: isRwa, Nachsilbe STOCK, Rohstoffe und Devisen', () => {
    ist('bitget', 'AVAXUSDT', 'krypto', 'coin')
    ist('bitget', 'NVDAUSDT', 'aktien', 'aktie')
    assert.equal(ist('bitget', 'ACNSTOCKUSDT', 'aktien', 'aktie').basis, 'ACN')
    assert.equal(ist('bitget', 'CSTOCKUSDT', 'aktien', 'aktie').basis, 'C')
    ist('bitget', 'PAXGUSDT', 'sonstige', 'rohstoff')
    ist('bitget', 'NATGASUSDT', 'sonstige', 'rohstoff')
    ist('bitget', 'EURUSDUSDT', 'sonstige', 'devise')
    assert.equal(finde('bitget', 'NVDAUSDT').maxHebel > 0, true)
})

pruefe('Bitget: ein Coin namens …STOCK bleibt unangetastet', () => {
    const l = ausBitget({ symbol: 'STOCKUSDT', baseCoin: 'STOCK', quoteCoin: 'USDT', isRwa: 'NO' })
    assert.equal(l.basis, 'STOCK')
    assert.equal(l.anlageklasse, 'krypto')
})

pruefe('Bitunix: Abgleich, als unsicher markiert', () => {
    ist('bitunix', 'BTCUSDT', 'krypto', 'coin')
    ist('bitunix', 'AVAXUSDT', 'krypto', 'coin')
    const l = ist('bitunix', 'NVDAUSDT', 'aktien', 'aktie')
    assert.equal(l.sicher, false)
    assert.equal(finde('bitunix', 'BTCUSDT').sicher, true)
    ist('bitunix', 'ANTHROPICUSDT', 'aktien', 'vorboerslich')
})

pruefe('Pionex: nur <TICKER>X bekannter Aktien, nicht AVAX/DYDX/IMX/TRX', () => {
    assert.equal(ist('pionex', 'NVDAX_USDT', 'aktien', 'aktie').basis, 'NVDA')
    assert.equal(finde('pionex', 'NVDAX_USDT').art, 'token-spot')
    assert.equal(ist('pionex', 'BRKBX_USDT', 'aktien', 'aktie').basis, 'BRKB')
    for (const s of ['AVAX_USDT', 'DYDX_USDT', 'IMX_USDT', 'TRX_USDT', 'BTC_USDT']) ist('pionex', s, 'krypto', 'coin')
})

pruefe('Bitpanda: group', () => {
    const b = (sym) => alle.find((x) => x.handelsplatz === 'bitpanda' && x.basis === sym)
    assert.equal(b('NVDA').unterart, 'aktie')
    assert.equal(b('NVDA').art, 'broker-spot')
    assert.equal(b('BTC').anlageklasse, 'krypto')
    assert.equal(b('XAU').unterart, 'rohstoff')
    assert.equal(ausBitpanda({ pid: 'x', symbol: 'EUROCDIS', group: 'etf' }).anlageklasse, 'aktien')
})

pruefe('Strittige Ticker (Coin hier, Aktie dort) fehlen im Abgleich', () => {
    const k = bekannteBasen([
        ausBinance({ symbol: 'ACNUSDT', baseAsset: 'ACN', quoteAsset: 'USDT', underlyingType: 'COIN' }),
        ausBitget({ symbol: 'ACNUSDT', baseCoin: 'ACN', quoteCoin: 'USDT', isRwa: 'YES' }),
        ausBitget({ symbol: 'NVDAUSDT', baseCoin: 'NVDA', quoteCoin: 'USDT', isRwa: 'YES' }),
    ])
    assert.equal(k.has('ACN'), false)
    assert.equal(k.get('NVDA').unterart, 'aktie')
})

pruefe('Bündeln: ein Titel, viele Handelsplätze, Spot und Future', () => {
    const titel = buendle(alle)
    const nvda = titel.find((t) => t.schluessel === 'aktien|NVDA')
    assert.deepEqual([...new Set(nvda.listungen.map((l) => l.handelsplatz))].sort(), ['binance', 'bitget', 'bitpanda', 'bitunix', 'pionex'])
    assert.equal(nvda.spot && nvda.future, true)
    const btc = titel.find((t) => t.schluessel === 'krypto|BTC')
    assert.ok(btc.listungen.length >= 4)
    assert.equal(titel.some((t) => t.schluessel === 'aktien|AVAX' || t.schluessel === 'aktien|AVA'), false)
    assert.equal(titel.find((t) => t.schluessel === 'aktien|ANTHROPIC').unterart, 'vorboerslich')
})

if (!process.exitCode) console.log(`✓ Einordnung nach Anlageklasse: ${n} Prüfungen`)
