/**
 * Selbsttest: Handelsseiten der Börsen (Hype-Radar → Börsen).
 *
 * Aufruf: node src/utils/__selftest-boersenlinks.mjs
 */
import { listungUrl, LISTUNG_URL, coingeckoSuche, bitunixUrl, boerseUrl } from './boersenLinks.js'
import { BOERSEN, ALLE_BOERSEN } from '../../server/hype-radar/boersenwacht-bewertung.js'

let fehler = 0
let bestanden = 0
const p = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}
console.log('Börsen-Links (Listungen)')

// Jede beobachtete Börse hat ein Muster — eine neue Börse ohne Link fiele sonst still durch.
for (const b of BOERSEN) {
    p(`Muster für ${b.name}`, typeof LISTUNG_URL[b.id] === 'function')
}
p('Gate mit Unterstrich', listungUrl('gate', 'TQQQX') === 'https://www.gate.com/trade/TQQQX_USDT')
p('Binance Futures als Perp', listungUrl('binance-futures', 'zcsh') === 'https://www.binance.com/en/futures/ZCSHUSDT')
// Schalter „Quellen ohne Verkaufsfreigabe" aus (S12): keine Links zu Upbit, OKX, MEXC und Binance Alpha.
const aus = { ohneFreigabe: false }
p('Schalter aus: keine Links zu Börsen ohne Freigabe', ['upbit', 'okx', 'mexc', 'binance-alpha'].every((b) => listungUrl(b, 'X', { ...aus, contract: '0xabc' }) === null))
p('Schalter aus: die übrigen Links bleiben', listungUrl('gate', 'TQQQX', aus) === 'https://www.gate.com/trade/TQQQX_USDT')
// Schalter an (S15, wie vor S12): jede beobachtete Börse ausser Alpha hat ein Muster.
for (const b of ALLE_BOERSEN) {
    if (b.id === 'binance-alpha') continue
    p(`Schalter an: Muster für ${b.name}`, typeof listungUrl(b.id, 'SOL') === 'string')
}
p('OKX in Kleinbuchstaben (live geprüft)', listungUrl('okx', 'xinfq') === 'https://www.okx.com/trade-spot/xinfq-usdt')
p('Alpha ohne Vertrag: kein Link', listungUrl('binance-alpha', 'X') === null)
p('Alpha mit Vertrag: DexScreener', listungUrl('binance-alpha', 'X', { chain: 'bsc', contract: '0xabc' }) === 'https://dexscreener.com/bsc/0xabc')
p('MEXC: Sonderzeichen werden kodiert', !/[ /]/.test(listungUrl('mexc', 'A B/C').split('/exchange/')[1]))
p('unbekannte Börse: kein Link', listungUrl('irgendwo', 'X') === null)
p('leeres Kürzel: kein Link', listungUrl('gate', '') === null)
p('Sonderzeichen werden kodiert', !/[ /]/.test(listungUrl('gate', 'A B/C').split('/trade/')[1]))
p('CoinGecko-Suche', coingeckoSuche('SOL') === 'https://www.coingecko.com/en/search?query=SOL')
p('Bitunix am Handy: u-link (nur den nimmt die App)', bitunixUrl('ETHUSDT', true) === 'https://www.bitunix.com/u-link/contract-trade/ETHUSDT')
p('Bitunix am PC: Handelsseite wie bisher', bitunixUrl('ETHUSDT', false) === 'https://www.bitunix.com/contract-trade/ETHUSDT')
p('ohne Browser (Node) gilt PC', boerseUrl('bitunix', 'BTCUSDT') === 'https://www.bitunix.com/contract-trade/BTCUSDT')

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler === 0 ? 0 : 1)
