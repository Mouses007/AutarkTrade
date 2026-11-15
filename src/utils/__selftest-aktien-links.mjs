/** Selbsttest: Handelsseiten der Aktien-Listungen (boersenLinks.js, Kaufzettel). */
import { aktienHandelsUrl, bitunixUrl } from './boersenLinks.js'

let ok = 0, fehler = 0
const gleich = (ist, soll, text) => {
    if (ist === soll) ok++
    else { fehler++; console.log(`  ✗ ${text}: ${ist} statt ${soll}`) }
}
const l = (handelsplatz, art, symbol) => aktienHandelsUrl({ handelsplatz, art, symbol })

gleich(l('bitunix', 'perp', 'NVDAUSDT'), bitunixUrl('NVDAUSDT'), 'Bitunix-Future')
gleich(l('bitget', 'perp', 'ACNSTOCKUSDT'), 'https://www.bitget.com/futures/usdt/ACNSTOCKUSDT', 'Bitget-Future mit STOCK')
gleich(l('binance', 'perp', 'nvdausdt'), 'https://www.binance.com/en/futures/NVDAUSDT', 'Binance-Future, Grossschreibung')
gleich(l('pionex', 'token-spot', 'NVDAX_USDT'), 'https://www.pionex.com/en/trade/NVDAX_USDT/Manual', 'Pionex-Token')
gleich(l('bitpanda', 'broker-spot', 'b86d1670-efe3-11eb-b56f-0691764446a7'), 'https://www.bitpanda.com/en/prices/stocks', 'Bitpanda: Übersicht, keine erfundene Adresse')
// Was der Stamm nicht kennt, bekommt keinen Link
gleich(l('pionex', 'perp', 'NVDAUSDT'), null, 'Pionex-Future: kein Muster')
gleich(l('kraken', 'perp', 'NVDAUSDT'), null, 'fremder Platz')
gleich(l('bitget', 'perp', 'NVDA/../x'), null, 'Symbol mit Pfadzeichen')
gleich(aktienHandelsUrl(null), null, 'ohne Listung')

console.log(`aktien-links: ${ok} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler ? 1 : 0)
