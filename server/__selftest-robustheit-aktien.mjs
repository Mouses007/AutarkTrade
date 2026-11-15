/**
 * Selbsttest: Robustheits-Läufe reichen den Aktien-Kontext durch.
 *
 *   node server/__selftest-robustheit-aktien.mjs
 *
 * Parameterstabilität, Matrix, Walk-forward und Ausstiegs-Prüfung rechnen
 * viele Teilläufe. Bis 15.11.2026 fragte jeder davon selbst, ob das Symbol ein
 * Aktien-Future ist (Zehn-Minuten-Cache): ein langer Lauf konnte mittendrin
 * einen anderen Stand bekommen, und ein mitgegebener Kontext (`basis.aktie`)
 * ging im Vorrat verloren. Jetzt fragt `ladeVorrat` EINMAL und jeder Teillauf
 * bekommt denselben Kontext.
 *
 * Kein Netz, keine Datenbank: `market-data.js` ist durch `__engine-attrappen.mjs`
 * ersetzt, der Aktien-Kontext wird gestellt. Ohne Datenbank antwortet
 * `aktienKontext` mit `null` (Coin) — das ist hier die Gegenprobe.
 */

import { register } from 'node:module'
register('./__engine-attrappen.mjs', import.meta.url)

let bestanden = 0
let fehler = 0
const pruefe = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehler++; console.log(`  \x1b[31m✗\x1b[0m ${name}${zusatz ? ' — ' + zusatz : ''}`) }
}

const H = 3_600_000
const T0 = Date.UTC(2026, 7, 3)   // Montag, 3.8.2026

let keim = 11
const rnd = () => { keim = (keim * 16807) % 2147483647; return keim / 2147483647 }
function reihe(anzahl, sprungBei = -1, faktor = 1) {
    const aus = []
    let preis = 400
    for (let i = 0; i < anzahl; i++) {
        if (i === sprungBei) preis /= faktor
        const o = preis
        const c = o * (1 + (rnd() - 0.5) * 0.01)
        aus.push({ t: T0 + i * H, o, h: Math.max(o, c) * 1.002, l: Math.min(o, c) * 0.998, c, v: 10 })
        preis = c
    }
    return aus
}
const N = 1600
const SPRUNG = 900
const glatt = reihe(N)
keim = 11
const mitSprung = reihe(N, SPRUNG, 10)
const reihen = { TESTUSDT: glatt, ANDERUSDT: glatt, SPLITUSDT: mitSprung }
globalThis.__engineMarkt = {
    historie: async (symbol, tf, a, b) => (reihen[symbol] || []).filter((k) => k.t >= a && k.t < b),
    funding: async () => [],
    meta: {},
}

const { registerStrategy } = await import('./strategies/index.js')
const { runBacktest } = await import('./strategy-backtest.js')
const { ladeVorrat, parameterStabilitaet, stabilitaetsMatrix, walkForward, ausstiegsPruefung } = await import('./robustness.js')
const { sitzungVon } = await import('../shared/aktien-sitzung.js')
const { ausstiegsRaster } = await import('./ausstiege.js')
const { kostenAus } = await import('./fill-simulator.js')

// Alle `abstand` Stunden ein Setup, Einstieg zur Eröffnung der Folgekerze.
registerStrategy({
    id: 'aktien_robust', name: 'Aktien-Robustheit', supportedTimeframes: ['1h'], warmupCandles: 20,
    params: [{ key: 'abstand', type: 'integer', default: 7, min: 3, max: 30, step: 1 }],
    regeln: { maxHoldCandles: 4, breakEvenAtR: 0 },
    detect({ candles: sicht, openSetups, params }) {
        const jetzt = sicht[sicht.length - 1]
        const idx = Math.round((jetzt.t - T0) / H)
        const events = openSetups.filter((s) => idx === s._ausloeser).map((s) => ({
            id: s.id, status: 'triggered', candleTime: jetzt.t, triggeredAt: jetzt.t, entryAtOpen: true,
            entry: jetzt.o, stopLoss: jetzt.o * 0.99, takeProfit: jetzt.o * 1.02,
        }))
        const setups = idx >= 25 && idx % params.abstand === 0
            ? [{ direction: 'long', entry: jetzt.c, stopLoss: jetzt.c * 0.99, takeProfit: jetzt.c * 1.02, obCandleTime: jetzt.t, _ausloeser: idx + 1, entryTrigger: 'market' }]
            : []
        return { setups, events, diagnostics: {} }
    },
})

const AKTIE = { ticker: 'TEST', boerse: 'bitunix', splits: [], splitsGrund: null, termine: null, termineGrund: null }
const von = T0 + 100 * H
const bis = T0 + N * H
const basis = {
    strategyId: 'aktien_robust', symbol: 'TESTUSDT', timeframe: '1h', market: 'futures', fromTs: von, toTs: bis, params: {}, startEquity: 10000,
    risk: { riskPerTradePct: 1, maxNotionalUsdt: 1e6, leverage: 5, minRR: 1, maintenanceMarginPct: 0.5, cooldownMinutes: 0, maxDailyLossPct: 25, nurRegulaereSitzung: true },
}
const werte = [5, 7, 11]

console.log('\nRobustheit — Aktien-Kontext in jedem Teillauf\n')

// Der Vorrat trägt den Kontext
const vAktie = await ladeVorrat({ ...basis, aktie: AKTIE })
const vCoin = await ladeVorrat(basis)
pruefe('Vorrat übernimmt den mitgegebenen Kontext', vAktie.aktie === AKTIE)
pruefe('ohne Angabe fragt der Vorrat selbst — hier ohne Datenbank: Coin (null), nicht «unbekannt»', vCoin.aktie === null)
pruefe('ein mitgegebenes `null` (Coin) bleibt null', (await ladeVorrat({ ...basis, aktie: null })).aktie === null)

// Einzel-Backtests als Massstab: mit Vorlauf wie der Vorrat
const einzel = async (wert, aktie, a = von, b = bis, symbol = 'TESTUSDT') => {
    const ab = a - 20 * H
    return runBacktest({ ...basis, symbol, params: { abstand: wert }, fromTs: ab, toTs: b,
        candles: reihen[symbol].filter((k) => k.t >= ab && k.t < b), marketMeta: {}, fundingVerlauf: [], aktie })
}

// Parameterstabilität
const stAktie = await parameterStabilitaet({ ...basis, aktie: AKTIE }, 'abstand', werte)
const stCoin = await parameterStabilitaet(basis, 'abstand', werte)
for (let i = 0; i < werte.length; i++) {
    const a = await einzel(werte[i], AKTIE)
    const c = await einzel(werte[i], null)
    pruefe(`Stufe ${werte[i]}: mit Kontext wie der Einzel-Backtest der Aktie (${a.stats.trades} Trades, nur reguläre Sitzung), ohne wie der Coin (${c.stats.trades})`,
        stAktie.punkte[i].trades === a.stats.trades && Math.abs(stAktie.punkte[i].expectancyR - (a.stats.expectancyR || 0)) < 1e-9
        && stCoin.punkte[i].trades === c.stats.trades && a.stats.trades > 5 && c.stats.trades > a.stats.trades * 2
        && a.trades.every((t) => sitzungVon(t.entryTime) === 'regulaer'),
        `Robustheit ${stAktie.punkte[i].trades}/${stCoin.punkte[i].trades}, Einzel ${a.stats.trades}/${c.stats.trades}`)
}

// Walk-forward: echter Lauf (ohne eingespeisten Backtest), jeder Prüfabschnitt mit Kontext
const wfAktie = await walkForward({ ...basis, aktie: AKTIE }, 'abstand', werte, { fenster: 3, minTrades: 3 })
const wfCoin = await walkForward(basis, 'abstand', werte, { fenster: 3, minTrades: 3 })
pruefe('Walk-forward mit Kontext: die Prüfabschnitte handeln nur einen Bruchteil (reguläre Sitzung), ohne Kontext alles',
    wfAktie.gesamt.trades > 10 && wfCoin.gesamt.trades > wfAktie.gesamt.trades * 2 && wfAktie.abschnitte.length === 2,
    `${wfAktie.gesamt.trades} gegen ${wfCoin.gesamt.trades} Trades`)
for (const [i, ab] of wfAktie.abschnitte.entries()) {
    const nach = ab.gewaehlt === null ? null : await einzel(ab.gewaehlt, AKTIE, ab.pruefVon, ab.pruefBis)
    pruefe(`Prüfabschnitt ${i + 1} rechnet wie der Einzel-Backtest der Aktie im selben Fenster — Trades nur in der regulären Sitzung`,
        nach && ab.pruefTrades === nach.stats.trades && Math.abs(ab.pruefExpectancyR - (nach.stats.expectancyR || 0)) < 1e-9
        && nach.trades.every((t) => t.sitzung === 'regulaer'),
        `${ab.pruefTrades} gegen ${nach?.stats.trades}`)
}
// Matrix: der Kontext gehört zum Symbol der Basis, nicht zu den anderen
const matrix = await stabilitaetsMatrix({ ...basis, aktie: AKTIE }, 'abstand', werte, { symbole: ['TESTUSDT', 'ANDERUSDT'] })
const zelle = (symbol) => matrix.zellen.find((z) => z.symbol === symbol && z.fenster === 'opt')
const tradesVon = (z) => z.punkte.reduce((s, p) => s + p.trades, 0)
pruefe('Matrix: das Symbol der Basis rechnet als Aktie, das zweite fragt selbst (hier: Coin)',
    tradesVon(zelle('TESTUSDT')) > 5 && tradesVon(zelle('ANDERUSDT')) > tradesVon(zelle('TESTUSDT')) * 2,
    `${tradesVon(zelle('TESTUSDT'))} gegen ${tradesVon(zelle('ANDERUSDT'))}`)

// Ausstiegs-Prüfung über einen Split: das Raster spielt auf denselben (bereinigten) Kerzen wie der Lauf
{
    const split = { t: T0 + (SPRUNG + 2) * H, faktor: 10, text: '10:1' }
    const b = { ...basis, symbol: 'SPLITUSDT', risk: { ...basis.risk, nurRegulaereSitzung: false }, params: { abstand: 7 } }
    const mit = await ausstiegsPruefung({ ...b, aktie: { ...AKTIE, splits: [split] } })
    pruefe('Ausstiegs-Prüfung über einen Split läuft und spielt alle Trades', mit.lauf.trades > 100 && mit.ausstiege?.trades.gespielt >= mit.lauf.trades - 2 && mit.ausstiege.trades.ohneKerze === 0,
        `${mit.lauf.trades} Trades, ${JSON.stringify(mit.ausstiege?.trades)}`)
    // Zelle «Stop 1× · Ziel 2 R · 4 Kerzen» sind die eigenen Ausstiege der Strategie.
    const { stops, ziele, halten } = mit.ausstiege.raster
    const eigen = (aus) => aus.zellen[(stops.indexOf(1) * ziele.length + ziele.indexOf(2)) * halten.length + halten.indexOf(4)].alle.mittel
    pruefe('…die Zelle mit den eigenen Ausstiegen trifft das Ergebnis des Laufs (Raster und Lauf im selben Massstab)',
        Math.abs(eigen(mit.ausstiege) - mit.ausstiege.original.alle.mittel) < 0.02 && Math.abs(mit.ausstiege.original.alle.mittel - mit.lauf.expectancyR) < 0.01,
        `Zelle ${eigen(mit.ausstiege)}, Lauf ${mit.lauf.expectancyR}`)
    // Gegenprobe: dieselben Trades auf den ROHEN Kerzen nachgespielt — so rechnete die Prüfung vorher.
    const roh = reihen.SPLITUSDT.filter((k) => k.t >= b.fromTs && k.t < b.toTs)
    const lauf = await runBacktest({ ...b, candles: roh, marketMeta: {}, fundingVerlauf: [], aktie: { ...AKTIE, splits: [split] } })
    const falsch = await ausstiegsRaster(lauf.trades, roh, { costs: kostenAus(lauf.meta.risk), kerzeMs: H, wartungsmargePct: lauf.stats.wartungsmargePct })
    pruefe('Gegenprobe: auf rohen Kerzen nachgespielt weicht dieselbe Zelle weit ab',
        Math.abs(eigen(falsch) - lauf.stats.expectancyR) > 0.3, `Zelle ${eigen(falsch)}, Lauf ${lauf.stats.expectancyR}`)
}

console.log(`\n${fehler === 0 ? '✓' : '✗'} ${bestanden} bestanden, ${fehler} fehlgeschlagen\n`)
process.exit(fehler === 0 ? 0 : 1)
