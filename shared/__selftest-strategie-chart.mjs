/**
 * Selbsttest: Datenform der Strategie-Ebene (shared/strategieChart.js).
 *
 *   node shared/__selftest-strategie-chart.mjs
 *
 * PostgreSQL liefert bigint als Zeichenkette — im Chart muss es eine Zahl
 * sein, sonst landet eine Zone bei x = NaN und ist einfach nicht da.
 */
import { setupAus, positionAus, tradeAus, ausBacktest, n } from './strategieChart.js'

let bestanden = 0
let fehler = 0
const pruefe = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehler++; console.log(`  \x1b[31m✗\x1b[0m ${name}${zusatz ? ' — ' + zusatz : ''}`) }
}

console.log('\nStrategie-Ebene: Datenform')

pruefe('n(): Zeichenkette wird Zahl, Leeres wird null', n('1730332800000') === 1730332800000 && n('') === null && n(null) === null && n('x') === null)

const s = setupAus({
    id: 7, instanceId: '15', strategyId: 'lsob', symbol: 'BTCUSDT', timeframe: '1h', direction: 'short', status: 'open',
    sweepLevel: '110', sweepPrice: '111', sweepCandleTime: '1000', obHigh: '109', obLow: '108', obCandleTime: '2000',
    entry: '108', stopLoss: '111.1', takeProfit: '102', rr: '1.9', triggeredAt: '5000',
    invalidReason: '', rejectReason: '', confirmations: '{"rsi":null}',
})
pruefe('Setup: Zahlen aus PostgreSQL-Text', s.obHoch === 109 && s.obTief === 108 && s.obT === 2000 && s.ausgeloestT === 5000 && s.instanceId === 15)
pruefe('Setup: Bestätigungen geparst', s.bestaetigung && s.bestaetigung.rsi === null)
pruefe('Setup: ohne Auslöser kein Auslösezeitpunkt', setupAus({ triggeredAt: 0 }).ausgeloestT === null)

const p = positionAus({ id: 1, instanceId: 15, direction: 'long', entryPrice: '100', entryTime: '3000', stopLoss: '95', initialStopLoss: '95', takeProfit: '110', status: 'open', mode: 'paper' })
pruefe('Position: Einstieg, Stop, Ziel', p.einstieg === 100 && p.einstiegT === 3000 && p.stop === 95 && p.ziel === 110 && p.status === 'open')

const t = tradeAus({ id: 3, setupId: 7, direction: 'long', entryTime: 3000, entryPrice: 100, exitTime: 9000, exitPrice: 104, rMultiple: 0.8, netPnl: 8, exitReason: 'tp' })
pruefe('Trade: Ein- und Ausstieg mit R', t.einstieg.t === 3000 && t.ausstieg.p === 104 && t.r === 0.8 && t.setupId === 7)
pruefe('Trade ohne Ausstieg hat keinen Ausstieg', tradeAus({ entryTime: 1, entryPrice: 1, exitTime: 0 }).ausstieg === null)
pruefe('Trade ohne id bekommt eine stabile Kennung', tradeAus({ entryTime: 1, entryPrice: 1 }, 4).id === 't4')

const b = ausBacktest({
    setups: [{ id: 1, direction: 'long', status: 'closed', obHigh: 2, obLow: 1, obCandleTime: 10, triggeredAt: 20, erkanntT: 10 }],
    trades: [{ setupId: 1, direction: 'long', entryTime: 20, entryPrice: 1.5, exitTime: 30, exitPrice: 2, rMultiple: 1 }],
})
pruefe('Backtest: Setups, Trades, keine Positionen', b.setups.length === 1 && b.trades.length === 1 && b.positionen.length === 0)
pruefe('Backtest: Erkennungskerze kommt mit', b.setups[0].erkanntT === 10)
pruefe('Backtest ohne Ergebnis kippt nicht um', ausBacktest(null).setups.length === 0)
// BUG-L5-004: ohne strategyId am Setup zeichnete die Ebene Swing Game als Zone
const sg = ausBacktest({ meta: { strategyId: 'trendlinien_breakout' }, setups: [{ id: 1, direction: 'long', sweepLevel: 99, sweepPrice: 100, sweepCandleTime: 5 }] })
pruefe('Backtest-Setup ohne strategyId erbt die des Laufs', sg.setups[0].strategyId === 'trendlinien_breakout', sg.setups[0].strategyId)
pruefe('…und behält seine Sweep-Felder', sg.setups[0].sweepLevel === 99 && sg.setups[0].sweepPrice === 100 && sg.setups[0].sweepT === 5)
const eigen = ausBacktest({ meta: { strategyId: 'a' }, setups: [{ id: 1, strategyId: 'b' }] })
pruefe('eigene strategyId am Setup gewinnt', eigen.setups[0].strategyId === 'b')

// Ende ohne Einstieg (01.11.2026): sonst zeichnete die Ebene pauschal 20 Kerzen
// und eine abgelaufene Box hörte vor ihrem letzten Antippen auf.
const ENDE = Date.UTC(2026, 10, 1, 1, 30)
pruefe('Ende: gespeichertes endeT gewinnt', setupAus({ status: 'expired', endeT: String(ENDE), updatedAt: new Date(0) }).endeT === ENDE)
pruefe('Ende: alte PostgreSQL-Zeile nimmt den letzten Statuswechsel',
    setupAus({ status: 'expired', endeT: '0', updatedAt: new Date(ENDE) }).endeT === ENDE)
pruefe('Ende: alte SQLite-Zeile (UTC ohne Zone) ebenso',
    setupAus({ status: 'invalidated', updatedAt: '2026-11-01 01:30:00' }).endeT === ENDE)
pruefe('Ende: wartende Setups haben keins', setupAus({ status: 'waiting_retest', updatedAt: new Date(ENDE) }).endeT === null)
pruefe('Ende: Backtest reicht es durch', ausBacktest({ setups: [{ id: 1, status: 'expired', endeT: ENDE }] }).setups[0].endeT === ENDE)

console.log(`\n${fehler === 0 ? '✓' : '✗'} ${bestanden} bestanden, ${fehler} fehlgeschlagen\n`)
process.exit(fehler === 0 ? 0 : 1)
