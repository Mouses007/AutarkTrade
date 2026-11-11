/**
 * Selbsttest: Bot-Planer (planer.js, coinsAusTabelle aus planer-routen.js) — rein, ohne Netz.
 * Aufruf: node server/bots/__selftest-bot-planer.mjs
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
    planBot, trendFuer, mengeJeGrid, pruefePlanEingabe, pruefePlanVariante, planKandidaten, anzahlFuerSchritt,
    rechnePlanVariante, rechnePlan, bauePlanPrompt, planSystemText, PLAN_ID, MAX_PLAN_GRIDS, MAX_KANDIDATEN,
} from './planer.js'
import { normalisiereBot } from './pionex-bots.js'
import { pruefeKiAntwort } from './bot-ki.js'
import { baueAktion } from './steuerung.js'

let ok = 0, fehl = 0
const p = (name, bed, zusatz = '') => {
    if (bed) { ok++; console.log(`  ✓ ${name}`) }
    else { fehl++; console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`) }
}
const nah = (a, b, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(a), Math.abs(b))

const hier = path.dirname(fileURLToPath(import.meta.url))
const fix = JSON.parse(readFileSync(path.join(hier, '..', 'fixtures', 'pionex-bot-orders.json'), 'utf8'))

console.log('Trend und Form')
p('Linear: Long = long, Short = short', trendFuer('LONG', false) === 'long' && trendFuer('SHORT', false) === 'short')
p('Coin-M invers: Long der Coin = short', trendFuer('LONG', true) === 'short' && trendFuer('SHORT', true) === 'long' && trendFuer('NEUTRAL', true) === 'no_trend')
const pm = planBot({ coin: 'SOL', coinM: true, richtung: 'LONG', unten: 120, oben: 200, anzahl: 100, art: 'arithmetic', hebel: 4, einsatz: 3, startKurs: 160, kurs: 160 })
p('Plan Coin-M: Typ, Richtung, Band in USD zurück', pm.id === PLAN_ID && pm.typ === 'coinm_grid' && pm.richtung === 'LONG' && pm.coinM && pm.marginCoin === 'SOL' && nah(pm.grid.unten, 120) && nah(pm.grid.oben, 200) && pm.plan && !pm.laufend)
const pl = planBot({ coin: 'SUI', coinM: false, richtung: 'SHORT', unten: 1, oben: 2, anzahl: 50, hebel: 10, einsatz: 100, startKurs: 1.5 })
p('Plan linear: futures_grid, Einsatz in USDT', pl.typ === 'futures_grid' && pl.richtung === 'SHORT' && pl.marginCoin === 'USDT' && pl.einsatz.basis === 100 && pl.grid.mengeJeGrid > 0)

console.log('Menge je Grid gegen echte Bots (Fixture)')
for (const o of fix.data.results) {
    const b = normalisiereBot(o), d = o.buOrderData
    if (b.richtung === 'NEUTRAL') continue   // neutrale Bots streuen (Kopf von planer.js)
    const usdStart = b.coinM ? 1 / Number(d.initPrice) : Number(d.initPrice)
    const plan = planBot({ coin: b.coin, coinM: b.coinM, richtung: b.richtung, unten: b.grid.unten, oben: b.grid.oben, anzahl: b.grid.anzahl, art: b.grid.art, hebel: b.hebel, einsatz: b.coinM ? Number(d.initQuoteInvestment) : Number(d.initUsdtInvestment ?? d.initQuoteInvestment), startKurs: usdStart })
    const r = plan.grid.mengeJeGrid / Number(d.perVolume)
    p(`${b.coin} ${b.coinM ? 'Coin-M' : 'linear'} ${b.richtung}: Plan/echt ${r.toFixed(3)} innerhalb ±12 %`, r > 0.88 && r < 1.12)
}
p('Menge null ohne Einsatz', mengeJeGrid({ L: [1, 2, 3], trend: 'long', start: 2, einsatz: 0, hebel: 5 }) === null)
p('Doppelter Hebel = doppelte Menge', nah(mengeJeGrid({ L: [1, 2, 3], trend: 'long', start: 2, einsatz: 10, hebel: 10 }), 2 * mengeJeGrid({ L: [1, 2, 3], trend: 'long', start: 2, einsatz: 10, hebel: 5 })))

console.log('Eingaben')
p('Eingabe gültig', !pruefePlanEingabe({ coin: 'sol', coinM: true, richtung: 'long', einsatz: '3', hebel: '4', tage: 60 }).fehler)
p('Coin nicht bei Pionex → coinNichtHandelbar', pruefePlanEingabe({ coin: 'SOL', coinM: true, richtung: 'LONG', einsatz: 1, hebel: 2 }, new Map([['SOL', { linear: true, coinM: false }]])).fehler === 'coinNichtHandelbar')
p('Hebel 1.5 / 200, Einsatz 0x10, Zeitraum 45 abgewiesen', ['hebel', 'hebel', 'einsatz', 'tage'].every((f, i) => pruefePlanEingabe([{ coin: 'SOL', richtung: 'LONG', einsatz: 1, hebel: 1.5 }, { coin: 'SOL', richtung: 'LONG', einsatz: 1, hebel: 200 }, { coin: 'SOL', richtung: 'LONG', einsatz: '0x10', hebel: 2 }, { coin: 'SOL', richtung: 'LONG', einsatz: 1, hebel: 2, tage: 45 }][i]).fehler === f))
p('Variante: Kurs muss im Band liegen', pruefePlanVariante({ unten: 170, oben: 200, anzahl: 10 }, 160, 'LONG').fehler === 'kursAusserhalb')
p('Variante: Neutral ohne Stops, Long-SL unter dem Kurs', pruefePlanVariante({ unten: 100, oben: 200, anzahl: 10, stopLoss: 90 }, 160, 'NEUTRAL').fehler === 'neutralStop' && pruefePlanVariante({ unten: 100, oben: 200, anzahl: 10, stopLoss: 170 }, 160, 'LONG').fehler === 'stopLoss' && pruefePlanVariante({ unten: 100, oben: 200, anzahl: 10, stopLoss: 90 }, 160, 'LONG').stopLoss === 90)
p('Variante: zu viele Grids', pruefePlanVariante({ unten: 100, oben: 200, anzahl: MAX_PLAN_GRIDS + 1 }, 160, 'LONG').fehler === 'anzahl')

console.log('Kandidaten')
const zr = { treffen: [], marken: [{ id: 'Z1', tf: '1d', preis: 140 }, { id: 'Z2', tf: '1w', preis: 185 }, { id: 'Z3', tf: '4h', preis: 150 }] }
for (const richtung of ['LONG', 'SHORT', 'NEUTRAL']) {
    const k = planKandidaten({ kurs: 160, atr: 6, zr, richtung })
    const ids = new Set(k.map((c) => c.id))
    p(`${richtung}: ${k.length} Kandidaten, IDs eindeutig, Kurs immer im Band, Grids 2…${MAX_PLAN_GRIDS}`, k.length > 4 && k.length <= MAX_KANDIDATEN && ids.size === k.length && k.every((c) => c.variante.unten < 160 && c.variante.oben > 160 && c.variante.anzahl >= 2 && c.variante.anzahl <= MAX_PLAN_GRIDS))
    const sl = k.filter((c) => c.variante.stopLoss != null)
    p(`${richtung}: Stop-Loss nur gerichtet und jenseits der Gegengrenze`, richtung === 'NEUTRAL' ? sl.length === 0 : sl.length > 0 && sl.every((c) => (richtung === 'LONG' ? c.variante.stopLoss < c.variante.unten : c.variante.stopLoss > c.variante.oben)))
}
p('Band an Niveaus kommt vor', planKandidaten({ kurs: 160, atr: 6, zr, richtung: 'LONG' }).some((c) => c.titel.includes('Niveaus')))
p('Ohne ATR keine Kandidaten', planKandidaten({ kurs: 160, atr: null, richtung: 'LONG' }).length === 0)
p('Grids für 0,5 % Abstand in 100–200 ≈ 133', anzahlFuerSchritt(100, 200, 0.005) === 133)

console.log('Rechnen')
// Kerzen: 100 → fällt auf 80 → zurück auf 100 (Minutenkerzen)
const kerzen = []
let px = 100
for (let i = 0; i < 600; i++) {
    const ziel = i < 300 ? 80 : 100
    const n = px + (ziel - px) / Math.max(1, (i < 300 ? 300 : 600) - i)
    kerzen.push({ t: i * 60_000, o: px, h: Math.max(px, n) * 1.001, l: Math.min(px, n) * 0.999, c: n }); px = n
}
const e = { coin: 'TST', coinM: false, richtung: 'LONG', einsatz: 100, hebel: 3, tage: 30 }
const r = rechnePlanVariante(e, { unten: 140, oben: 220, anzahl: 40, art: 'arithmetic' }, kerzen, { kurs: 200 })
p('Rückblick relativ: Band × (erster Kurs / Kurs heute)', nah(r.rueckblick.faktor, 0.5) && r.rueckblick.zyklen > 0)
p('Start heute: Menge, Position Long, Liquidation unter dem Kurs', r.start.menge > 0 && r.start.nominalUsd > 0 && r.start.liq < 200)
const hoch = rechnePlanVariante({ ...e, hebel: 100 }, { unten: 140, oben: 220, anzahl: 40 }, kerzen, { kurs: 200 })
p('Hebel 100: Liquidation im Band und nah gewarnt, Rückblick liquidiert', hoch.warnungen.includes('liqImBand') && hoch.warnungen.includes('liqNah') && !!hoch.rueckblick.liquidation)
const klein = rechnePlanVariante(e, { unten: 140, oben: 220, anzahl: 400 }, kerzen, { kurs: 200, minMenge: 0.1 })
p('Mindestmenge: zu viele Grids werden gekürzt', klein.warnungen.includes('gridsGekuerzt') && klein.variante.anzahl < 400 && klein.start.menge >= 0.1 * 0.999)
const doppelt = rechnePlan(e, kerzen, [{ id: 'P1', titel: 'a', variante: { unten: 140, oben: 220, anzahl: 400 } }, { id: 'P2', titel: 'b', variante: { unten: 140, oben: 220, anzahl: 300 } }], { kurs: 200, minMenge: 0.1 })
p('Nach dem Kürzen gleiche Varianten nur einmal', doppelt.length === 1 && doppelt[0].id === 'P1')
p('Einsatz zu klein für 2 Grids', rechnePlanVariante(e, { unten: 140, oben: 220, anzahl: 40 }, kerzen, { kurs: 200, minMenge: 1000 }).fehler === 'einsatzZuKlein')
const cm = rechnePlanVariante({ ...e, coin: 'SOL', coinM: true, einsatz: 1 }, { unten: 140, oben: 220, anzahl: 40 }, kerzen, { kurs: 200 })
p('Coin-M Long: Nominal positiv (Long der Coin), Liquidation unter dem Kurs', cm.start.nominalUsd > 0 && cm.start.liq < 200)

console.log('KI-Prüfung')
const liste = rechnePlan(e, kerzen, planKandidaten({ kurs: 200, atr: 8, zr: null, richtung: 'LONG' }), { kurs: 200 })
const prompt = bauePlanPrompt(e, { lage: { kurs: 200 }, kandidaten: liste, tf: '1m' })
p('Prompt nennt alle Kandidaten-IDs und den Rückblick relativ', liste.every((c) => prompt.includes(`${c.id} |`)) && prompt.includes('RELATIV'))
p('Systemtext verlangt JSON mit P-IDs, kein Versprechen', planSystemText().includes('"P3"') && planSystemText().includes('garantiert'))
const g = pruefeKiAntwort({ lage: 'x', vorschlaege: [{ id: 'P1', titel: 'a', begruendung: 'b', risiko: 'c', passtNichtWenn: 'd' }, { id: 'P99' }, { id: 'P2', titel: 'optimal' }] }, { kandidaten: liste }, prompt)
p('KI: unbekannte ID und „optimal" verworfen, P1 bleibt mit Start heute', g.vorschlaege.length === 1 && g.vorschlaege[0].id === 'P1' && g.verworfen.length === 2 && g.vorschlaege[0].abJetzt?.menge > 0)

console.log('Start über die Steuerung')
const a = baueAktion(pm, 'starten', { unten: '120', oben: '200', anzahl: '100', hebel: '4', einsatz: '3', art: 'arithmetic' }, { stellen: 7 })
p('baueAktion: create mit Coin-M-Feldern des Plans', !a.fehler && /\/create$/.test(a.senden.pfad) && a.senden.body.base === 'USDT.PERP' && a.senden.body.buOrderData.cateType === 'FUTURE_GRID_COIN_MARGINED' && a.senden.body.buOrderData.trend === 'short' && a.warnungen.includes('neuerBot'))

console.log('Coins aus der Pionex-Tabelle')
const { coinsAusTabelle } = await import('./planer-routen.js')
const tab = JSON.parse(readFileSync(path.join(hier, '..', 'fixtures', 'pionex-symbols-perp.json'), 'utf8')).data.symbols
const coins = coinsAusTabelle([...tab, { symbol: 'USDT_SOL_PERP', status: 'TRADING', minSizeLimit: '1' }, { symbol: 'SOL_USDT_PERP', status: 'TRADING', minSizeLimit: '0.01' }, { symbol: 'XYZ_USDT_PERP', status: 'OFFLINE' }])
p('USDT-M und Coin-M getrennt, Mindestmenge je Art, nicht handelbare fehlen', coins.get('SOL')?.linear && coins.get('SOL')?.coinM && coins.get('SOL').minCoinM === 1 && coins.get('SOL').minLinear === 0.01 && !coins.has('XYZ') && coins.get('0G')?.linear && !coins.get('0G')?.coinM)

console.log(`\n${ok} bestanden, ${fehl} fehlgeschlagen`)
process.exit(fehl ? 1 : 0)
