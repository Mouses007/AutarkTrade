/** Selbsttest: Symbol-Zerlegung (shared/symbol.js). */
import { normSymbol, zerlege, kurzSymbol } from './symbol.js'

let ok = 0, fehler = 0
const gleich = (ist, soll, text) => {
    if (JSON.stringify(ist) === JSON.stringify(soll)) ok++
    else { fehler++; console.log(`  ✗ ${text}: ${JSON.stringify(ist)} statt ${JSON.stringify(soll)}`) }
}
const z = (s, basis, quote) => gleich(zerlege(s), { basis, quote }, `zerlege(${s})`)

z('BTCUSDT', 'BTC', 'USDT')
z('1000PEPEUSDT', '1000PEPE', 'USDT')
z('BTCUSDT_UMCBL', 'BTC', 'USDT')
z('BTC_USDT_PERP', 'BTC', 'USDT')
z('BTC-USDT', 'BTC', 'USDT')
z('btc/usdt', 'BTC', 'USDT')
z('ETHUSDC', 'ETH', 'USDC')
z('BTCFDUSD', 'BTC', 'FDUSD')
z('ETH_BTC', 'ETH', 'BTC')
// Ohne Trennzeichen nur Stablecoin-Endungen: sonst würde WBTC zu W
z('ETHBTC', 'ETHBTC', '')
z('WBTC', 'WBTC', '')
z('STETH', 'STETH', '')
z('TUSD', 'TUSD', '')
z('AAPL-EUR', 'AAPL', 'EUR')
// Aktien an den Krypto-Börsen
z('NVDAUSDT', 'NVDA', 'USDT')
z('NVDAX_USDT', 'NVDAX', 'USDT')
z('BRKBUSDT', 'BRKB', 'USDT')
z('ACNSTOCKUSDT', 'ACNSTOCK', 'USDT')
z('HK0700USDT', 'HK0700', 'USDT')
z('EURUSDUSDT', 'EURUSD', 'USDT')
// Ohne Notierung: Börsenticker
z('BRK.B', 'BRK.B', '')
z('NVDA', 'NVDA', '')
// Eine Notierungswährung allein bleibt Basis
z('USDT', 'USDT', '')
z('ETH', 'ETH', '')
z('', '', '')
z(null, '', '')

gleich(kurzSymbol('SOLUSDT'), 'SOL', 'kurzSymbol')
// Dasselbe Ergebnis wie die bisher verstreute Kürzung `.replace(/USDT$/, '')`
for (const s of ['BTCUSDT', '1000PEPEUSDT', 'NVDAUSDT', 'TRXUSDT', 'USDCUSDT']) {
    gleich(kurzSymbol(s), s.replace(/USDT$/, ''), `kurzSymbol(${s}) wie bisher`)
}
// normSymbol bleibt unverändert
gleich(normSymbol('BTC_USDT_PERP'), 'BTCUSDT', 'normSymbol Pionex')
gleich(normSymbol('1000pepeusdt_umcbl'), '1000PEPEUSDT', 'normSymbol Bitget')

console.log(fehler ? `✗ Symbol: ${fehler} Fehler` : `✓ Symbol-Zerlegung: ${ok} Prüfungen`)
if (fehler) process.exit(1)
