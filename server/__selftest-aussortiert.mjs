/**
 * Selbsttest: aussortierte Signale (`server/strategie-aussortiert.js`).
 *
 *   node server/__selftest-aussortiert.mjs
 *
 * Prüft die Umwandlung `diagnostics.rejections` → Zeilen und am echten
 * Detector (Momentum Swing auf synthetischen Kerzen), dass Signale gegen den
 * Tagestrend dort landen — genau die Fälle, die #24/#25/#30 am 03.11.2026
 * unsichtbar machten.
 */
import { aussortierteZeilen } from './strategie-aussortiert.js'
import momentumSwing from './strategies/momentum_swing.js'

let bestanden = 0
let fehler = 0
const pruefe = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehler++; console.log(`  \x1b[31m✗\x1b[0m ${name}${zusatz ? ' — ' + zusatz : ''}`) }
}

const H4 = 4 * 3600e3
const basis = { instanceId: 7, symbol: 'BTCUSDT', timeframe: '4h', paramsVersion: 3 }

console.log('\nUmwandlung')
{
    const z = aussortierteZeilen([
        { reason: 'trend_against', key: 'long|1000' },
        { reason: 'weekday_blocked', key: 'short|2000' },
    ], basis)
    pruefe('zwei Zeilen mit allen Feldern', z.length === 2
        && z[0].instanceId === 7 && z[0].symbol === 'BTCUSDT' && z[0].timeframe === '4h' && z[0].paramsVersion === 3
        && z[0].direction === 'long' && z[0].candleTime === 1000 && z[0].grund === 'trend_against'
        && z[1].direction === 'short' && z[1].grund === 'weekday_blocked', JSON.stringify(z))

    const doppelt = aussortierteZeilen([
        { reason: 'trend_against', key: 'long|1000' },
        { reason: 'trend_unknown', key: 'long|1000' },
    ], basis)
    pruefe('derselbe Schlüssel einmal, mit dem ersten Grund (wie im Backtest)', doppelt.length === 1 && doppelt[0].grund === 'trend_against')

    const kaputt = aussortierteZeilen([
        { reason: 'x', key: 'seitwaerts|1000' },
        { reason: 'x', key: 'long|abc' },
        { reason: 'x', key: 'long|0' },
        { reason: 'x', key: 'long|1000|extra' },
        { reason: '', key: 'long|3000' },
        { reason: 'x' },
        null,
    ], basis)
    pruefe('unlesbare Schlüssel und leere Gründe fallen weg', kaputt.length === 0, JSON.stringify(kaputt))

    const mitSetup = aussortierteZeilen([
        { reason: 'below_min_rr', key: 'long|1000' },
        { reason: 'trend_against', key: 'short|1000' },
    ], { ...basis, setupSchluessel: ['long|1000'] })
    pruefe('ein Schlüssel mit Setup fällt weg (der Grund steht am Setup)', mitSetup.length === 1 && mitSetup[0].direction === 'short')

    const t0 = Date.UTC(2026, 10, 2, 16)
    const start = aussortierteZeilen([
        { reason: 'a', key: `long|${t0 - H4 - 1}` },   // schloss vor dem Start
        { reason: 'b', key: `long|${t0 - H4}` },       // schloss genau beim Start
        { reason: 'c', key: `long|${t0}` },
    ], { ...basis, abT: t0, tfMs: H4 })
    pruefe('vor dem Start geschlossene Signalkerzen fallen weg', start.map((z) => z.grund).join() === 'b,c', start.map((z) => z.grund).join())
    pruefe('ohne Startzeit zählt alles', aussortierteZeilen([{ reason: 'a', key: 'long|5' }], basis).length === 1)
    pruefe('langer Grund wird gekürzt', aussortierteZeilen([{ reason: 'x'.repeat(200), key: 'long|5' }], basis)[0].grund.length === 80)
}

console.log('\nAm Detector: Momentum Swing gegen den Tagestrend')
{
    // 4h-Kerzen: lange Abwärtsbewegung, dann ein kräftiger Rücksetzer nach
    // oben und wieder hinab — WaveTrend kreuzt dabei in beiden Zonen. Der
    // Tagestrend liegt durchgehend unter seiner EMA50: Longs scheitern.
    const t0 = Date.UTC(2026, 6, 6)   // Montag
    const kerzen = []
    let p = 100
    for (let i = 0; i < 420; i++) {
        const welle = Math.sin(i / 9) * 4
        p = Math.max(5, p - 0.05)
        const c = p + welle
        const o = c - Math.sin((i + 1) / 9) * 0.6
        kerzen.push({ t: t0 + i * H4, o, h: Math.max(o, c) + 0.8, l: Math.min(o, c) - 0.8, c, v: 1000 })
    }
    const tage = []
    for (let i = 0; i < 160; i++) {
        const c = 200 - i
        tage.push({ t: t0 - 90 * 86400e3 + i * 86400e3, o: c + 0.5, h: c + 1, l: c - 1, c, v: 1 })
    }
    const p0 = Object.fromEntries(momentumSwing.params.map((x) => [x.key, x.default]))
    const { setups, diagnostics } = momentumSwing.detect({
        candles: kerzen, params: { ...p0, scanWindowCandles: 200, sperreWochenende: false }, openSetups: [], knownSetupKeys: [], htfCandles: tage,
    })
    const zeilen = aussortierteZeilen(diagnostics.rejections, {
        ...basis, setupSchluessel: setups.map((s) => `${s.direction}|${s.obCandleTime}`),
    })
    const longs = zeilen.filter((z) => z.direction === 'long')
    pruefe('der Detector meldet Long-Punkte gegen den Trend', longs.length > 0 && longs.every((z) => z.grund === 'trend_against'),
        JSON.stringify(diagnostics.rejected))
    pruefe('keine Long-Setups entstanden', setups.every((s) => s.direction === 'short'), `Setups ${setups.map((s) => s.direction).join()}`)
    pruefe('jede Ablehnung wird genau eine Zeile', zeilen.length === new Set(diagnostics.rejections.map((r) => r.key)).size,
        `${zeilen.length} Zeilen, ${diagnostics.rejections.length} Ablehnungen`)
}

console.log(`\n${fehler === 0 ? '✓' : '✗'} ${bestanden} bestanden, ${fehler} fehlgeschlagen\n`)
process.exit(fehler === 0 ? 0 : 1)
