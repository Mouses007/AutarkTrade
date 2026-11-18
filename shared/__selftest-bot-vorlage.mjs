/**
 * Selbsttest der Bot-Vorlagen (shared/botVorlage.js): prüfen, aus einem Plan bauen, an einen Preis setzen.
 *   node shared/__selftest-bot-vorlage.mjs
 */
import { pruefeVorlage, vorlageAusPlan, vorlageAnwenden, vorlagePasst, coinAusSymbol } from './botVorlage.js'

let ok = 0, fehl = 0
const p = (name, bed, zusatz = '') => { if (bed) { ok++; console.log(`  ✓ ${name}`) } else { fehl++; console.log(`  ✗ ${name} ${zusatz}`) } }
const nah = (a, b, rel = 1e-6) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(a), Math.abs(b))

console.log('Prüfen')
const gut = { name: '  BTC   Long breit ', coin: 'btc', art: 'linear', richtung: 'long', hebel: '3', einsatz: '500', unter: 0.4, ueber: 0.5, anzahl: 90, gridArt: 'geometric', stopLoss: 0.45 }
const v = pruefeVorlage(gut)
p('gültige Vorlage: Name bereinigt, Coin und Richtung gross, Zahlen als Zahlen', !v.fehler && v.name === 'BTC Long breit' && v.coin === 'BTC' && v.richtung === 'LONG' && v.hebel === 3 && v.einsatz === 500 && v.anzahl === 90 && v.gridArt === 'geometric' && v.stopLoss === 0.45 && v.takeProfit === null, JSON.stringify(v))
p('ohne Namen abgewiesen', pruefeVorlage({ ...gut, name: ' ' }).fehler === 'name')
p('Hebel 1,5 und «1e1» abgewiesen', pruefeVorlage({ ...gut, hebel: '1.5' }).fehler === 'hebel' && pruefeVorlage({ ...gut, hebel: '1e1' }).fehler === 'hebel')
p('Band: Untergrenze ≥ 95 % unter dem Preis abgewiesen', pruefeVorlage({ ...gut, unter: 0.95 }).fehler === 'band' && pruefeVorlage({ ...gut, ueber: 0 }).fehler === 'band')
p('Grids 1 und 501 abgewiesen, Spot höchstens 200', pruefeVorlage({ ...gut, anzahl: 1 }).fehler === 'anzahl' && pruefeVorlage({ ...gut, anzahl: 501 }).fehler === 'anzahl' && pruefeVorlage({ ...gut, art: 'spot', stopLoss: null, anzahl: 201 }).fehler === 'anzahl')
p('Neutral und Spot ohne Stops', pruefeVorlage({ ...gut, richtung: 'NEUTRAL' }).fehler === 'stops' && pruefeVorlage({ ...gut, art: 'spot' }).fehler === 'stops')
const spot = pruefeVorlage({ ...gut, art: 'spot', richtung: 'SHORT', hebel: '10', stopLoss: null })
p('Spot: immer Long, Hebel 1', !spot.fehler && spot.richtung === 'LONG' && spot.hebel === 1)
p('Coin-M braucht eine Coin, USDT-M nicht', pruefeVorlage({ ...gut, art: 'coinM', coin: '' }).fehler === 'coin' && !pruefeVorlage({ ...gut, coin: '' }).fehler)
p('Long: Stop-Loss ≥ 99 % unter dem Preis abgewiesen', pruefeVorlage({ ...gut, stopLoss: 0.99 }).fehler === 'stopLoss')

console.log('Aus einem Plan und zurück an einen Preis')
const plan = { name: 'SOL Long', coin: 'SOL', art: 'linear', richtung: 'LONG', hebel: 3, einsatz: 1000, unten: '120', oben: '260', anzahl: '80', gridArt: 'geometric', stopLoss: '110', takeProfit: '' }
const ausPlan = vorlageAusPlan(plan, 200)
p('Plan → Vorlage: 40 % unter, 30 % über, Stop 45 % darunter', !ausPlan.fehler && nah(ausPlan.unter, 0.4) && nah(ausPlan.ueber, 0.3) && nah(ausPlan.stopLoss, 0.45) && ausPlan.takeProfit === null, JSON.stringify(ausPlan))
const zurueck = vorlageAnwenden(ausPlan, 200)
p('am selben Preis: dieselben Grenzen und derselbe Stop', nah(zurueck.unten, 120) && nah(zurueck.oben, 260) && nah(zurueck.stopLoss, 110) && zurueck.takeProfit === null && zurueck.anzahl === 80 && zurueck.art === 'geometric', JSON.stringify(zurueck))
const tiefer = vorlageAnwenden(ausPlan, 100)
p('am halben Preis: alles halbiert (gleiche Prozente)', nah(tiefer.unten, 60) && nah(tiefer.oben, 130) && nah(tiefer.stopLoss, 55))
const short = vorlageAusPlan({ ...plan, richtung: 'SHORT', stopLoss: '280', takeProfit: '150' }, 200)
const shortAn = vorlageAnwenden(short, 50000)
p('Short: Stop über, Ziel unter dem Preis', !short.fehler && nah(shortAn.stopLoss, 70000) && nah(shortAn.takeProfit, 37500), JSON.stringify(shortAn))
p('Kurs ausserhalb des Bands → band; ohne Kurs → kurs', vorlageAusPlan(plan, 300).fehler === 'band' && vorlageAusPlan(plan, 0).fehler === 'kurs')
p('ohne Preis keine Anwendung', vorlageAnwenden(ausPlan, 0) === null && vorlageAnwenden(null, 100) === null)

console.log('Coin')
p('Vorlage ohne Coin passt zu jeder, mit Coin nur zu ihr', vorlagePasst({ coin: '' }, 'BTC') && vorlagePasst({ coin: 'BTC' }, 'btc') && !vorlagePasst({ coin: 'SOL' }, 'BTC'))
p('Coin aus dem Symbol', coinAusSymbol('BTCUSDT') === 'BTC' && coinAusSymbol('1000PEPEUSDT') === '1000PEPE' && coinAusSymbol('solusdc') === 'SOL' && coinAusSymbol('AAPL') === '')

console.log(`\n${ok} bestanden, ${fehl} fehlgeschlagen`)
process.exit(fehl ? 1 : 0)
