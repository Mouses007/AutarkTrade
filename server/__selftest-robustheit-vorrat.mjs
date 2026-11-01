/**
 * Selbsttest: HTF-Vorlauf des Robustheits-Vorrats (Audit 4.3.4, FUN-L4-002).
 *
 *   node server/__selftest-robustheit-vorrat.mjs
 *
 * Parameterstabilität, Matrix und Walk-forward laden die Daten eines Symbols
 * EINMAL (`ladeVorrat`) und schneiden jede Stufe daraus. Der HTF-Vorlauf kam
 * bis 31.10.2026 allein aus den Grundparametern: eine Stufe
 * `zonenFensterHtf: 1000` (Bedarf 1010 Tageskerzen) rechnete mit 290 Tagen
 * Vorlauf und lieferte andere Trades als der Einzel-Backtest derselben Werte.
 *
 * Geprüft wird hier der ganze Weg — `parameterStabilitaet` ohne vorgegebenen
 * Vorrat, also mit dem echten `ladeVorrat` — gegen `runBacktest` je Stufe mit
 * dem Vorlauf, den Labor und Papier hätten. `market-data.js` ist durch den
 * Lade-Haken `__engine-attrappen.mjs` ersetzt: Kerzen kommen aus einer
 * erfundenen, festen Reihe, kein Netz.
 *
 * Gegenprobe gemacht: mit dem Stand vor dem Fix weicht Stufe 1000 ab.
 */

import { register } from 'node:module'
register('./__engine-attrappen.mjs', import.meta.url)

let bestanden = 0
let fehler = 0
const pruefe = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehler++; console.log(`  \x1b[31m✗\x1b[0m ${name}${zusatz ? ' — ' + zusatz : ''}`) }
}

const H = 3600000
const TAG = 24 * H

// Fester Zufall (wie im Audit, Seed 2): 4h-Kerzen über mehrere Jahre, daraus
// Tageskerzen. Der Seed ist der, bei dem der Fehler ein scheinbares Plateau
// erzeugte (+1,06/+3,18 R gegen −1,14/−0,45 R im Einzellauf).
function zufall(s) {
    let a = s >>> 0
    return () => {
        a = (a + 0x9E3779B9) | 0
        let t = a ^ (a >>> 16); t = Math.imul(t, 0x21f0aaad); t ^= t >>> 15; t = Math.imul(t, 0x735a2d97); t ^= t >>> 15
        return (t >>> 0) / 4294967296
    }
}
function kerzen4h(von, bis, seed) {
    const r = zufall(seed)
    const out = []
    let p = 30000
    let drift = 0
    for (let t = von, i = 0; t < bis; t += 4 * H, i++) {
        if (i % 250 === 0) drift = (r() - 0.5) * 0.006
        const o = p
        p = p * Math.exp(drift + (r() - 0.5) * 0.03)
        out.push({ t, o, h: Math.max(o, p) * (1 + r() * 0.01), l: Math.min(o, p) * (1 - r() * 0.01), c: p, v: 100 + r() * 900 })
    }
    return out
}
function tage(k4) {
    const m = new Map()
    for (const k of k4) {
        const s = Math.floor(k.t / TAG) * TAG
        const b = m.get(s)
        if (!b) m.set(s, { ...k, t: s, n: 1 })
        else { b.h = Math.max(b.h, k.h); b.l = Math.min(b.l, k.l); b.c = k.c; b.v += k.v; b.n++ }
    }
    return [...m.values()].filter((b) => b.n === 6).map(({ n, ...b }) => b)
}

const von = Date.UTC(2024, 0, 1)
const bis = Date.UTC(2025, 6, 1)
const k4 = kerzen4h(Date.UTC(2019, 0, 1), bis, 2)
const k1d = tage(k4)
const reihe = { '4h': k4, '1d': k1d }
const abrufe = []
globalThis.__engineMarkt = {
    historie: async (symbol, tf, a, b) => {
        abrufe.push({ tf, ab: a })
        return (reihe[tf] || []).filter((k) => k.t >= a && k.t < b)
    },
    funding: async () => [],
    meta: {},
}

const { parameterStabilitaet } = await import('./robustness.js')
const { runBacktest } = await import('./strategy-backtest.js')
const { getStrategy, validateParams, htfBedarf } = await import('./strategies/index.js')

console.log('\nRobustheit — HTF-Vorlauf je Stufe\n')

const strat = getStrategy('set_and_forget')
const werte = [250, 600, 1000]
const basis = {
    strategyId: 'set_and_forget', symbol: 'TESTUSDT', timeframe: '4h', market: 'futures',
    fromTs: von, toTs: bis, params: {}, risk: { maintenanceMarginPct: 0.5 }, startEquity: 1000,
}
const st = await parameterStabilitaet(basis, 'zonenFensterHtf', werte)

const groessterBedarf = Math.max(...werte.map((w) => htfBedarf(strat, validateParams('set_and_forget', { zonenFensterHtf: w }).values)))
const htfAbruf = abrufe.find((a) => a.tf === '1d')
const ltfVorlauf = (strat.warmupCandles || 200) * 4 * H
pruefe('der Vorrat holt den HTF-Vorlauf der Stufe mit dem grössten Bedarf',
    htfAbruf && htfAbruf.ab <= von - ltfVorlauf - groessterBedarf * TAG,
    htfAbruf ? `ab ${new Date(htfAbruf.ab).toISOString().slice(0, 10)}, Bedarf ${groessterBedarf} Tage` : 'kein HTF-Abruf')

for (let i = 0; i < werte.length; i++) {
    const w = werte[i]
    const pS = validateParams('set_and_forget', { zonenFensterHtf: w }).values
    const ab = von - ltfVorlauf
    const htfAb = ab - htfBedarf(strat, pS) * TAG
    const einzel = await runBacktest({
        ...basis, params: { zonenFensterHtf: w }, fromTs: ab, toTs: bis,
        candles: k4.filter((k) => k.t >= ab && k.t < bis), marketMeta: {}, fundingVerlauf: [],
        htfCandles: k1d.filter((k) => k.t >= htfAb && k.t < bis),
    })
    const pt = st.punkte[i]
    pruefe(`Stufe ${w} (Bedarf ${htfBedarf(strat, pS)} Tage) rechnet wie der Einzel-Backtest`,
        pt && pt.trades === (einzel.stats.trades || 0)
        && Math.abs((pt.expectancyR || 0) - (einzel.stats.expectancyR || 0)) < 1e-9,
        `Robustheit ${pt?.trades} Tr / ${pt?.expectancyR?.toFixed(3)} R, Einzel ${einzel.stats.trades} Tr / ${(einzel.stats.expectancyR || 0).toFixed(3)} R`)
}

console.log(`\n${bestanden} bestanden, ${fehler} fehlgeschlagen\n`)
process.exit(fehler ? 1 : 0)
