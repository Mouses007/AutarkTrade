/**
 * Selbsttest: Handelsseiten der Börsen (Hype-Radar → Börsen).
 *
 * Aufruf: node src/utils/__selftest-boersenlinks.mjs
 */
import { listungUrl, LISTUNG_URL, coingeckoSuche } from './boersenLinks.js'
import { BOERSEN } from '../../server/hype-radar/boersenwacht-bewertung.js'

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
// S12: Upbit, OKX, MEXC und Binance Alpha beobachtet der Radar nicht mehr.
p('S12: keine Links mehr zu entfernten Börsen', ['upbit', 'okx', 'mexc', 'binance-alpha'].every((b) => listungUrl(b, 'X') === null))
p('unbekannte Börse: kein Link', listungUrl('irgendwo', 'X') === null)
p('leeres Kürzel: kein Link', listungUrl('gate', '') === null)
p('Sonderzeichen werden kodiert', !/[ /]/.test(listungUrl('gate', 'A B/C').split('/trade/')[1]))
p('CoinGecko-Suche', coingeckoSuche('SOL') === 'https://www.coingecko.com/en/search?query=SOL')

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler === 0 ? 0 : 1)
