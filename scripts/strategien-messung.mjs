#!/usr/bin/env node
/**
 * Messlauf über die Strategien — dieselben Kerzen vor und nach einer Änderung.
 *
 * Wozu: Eine Korrektur am Simulator oder an einem Detektor ändert Zahlen, die
 * später Entscheidungen tragen. Ohne festen Vergleich bleibt nur „sieht anders
 * aus". Dieser Lauf rechnet jede eingebaute Strategie und drei Vorlagen auf
 * BTC/ETH/SOL über zwei Jahre mit den Vorgabeparametern und schreibt eine
 * Tabelle, die man neben die vorige legen kann.
 *
 * Die Kerzen werden beim ersten Lauf geholt und in `--kerzen <ordner>`
 * abgelegt; jeder weitere Lauf liest sie dort. Nur so misst „nachher" auf
 * denselben Daten wie „vorher" — die Börse liefert die jüngsten Kerzen sonst
 * jedes Mal ein Stück anders.
 *
 *   node scripts/strategien-messung.mjs --kerzen /tmp/kerzen --aus messung.json
 *   node scripts/strategien-messung.mjs --kerzen /tmp/kerzen --aus nachher.json --vergleich messung.json
 *
 * Braucht Netz nur beim ersten Lauf (Marktdatenquelle aus den Einstellungen,
 * Vorgabe Binance). Schreibt nichts in die Datenbank.
 *
 * Kerzen der höheren Zeiteinheit (Trendfilter) werden MIT Vorlauf geholt —
 * ab `VON − htfBedarf · Zeiteinheit`, so wie Backtest und Engine sie sehen —
 * und unter eigenem Namen abgelegt (`…_<tf>_vorlauf<n>.json`). Bis 31.10.2026
 * begannen sie erst bei `VON`: Set and Forget rechnete dann 70 Tage ohne
 * HTF-Lage und bis etwa Tag 280 mit verkürztem Fenster, und die Tabelle in
 * docs/strategien/2026-11-korrekturen.md stammt aus genau dieser Datenlage
 * (Audit 4.3.4, BUG-L4-003). Ältere Ablagen ohne Vorlauf werden deshalb nicht
 * mehr gelesen; der erste Lauf danach braucht wieder Netz.
 */
import fs from 'node:fs'
import path from 'node:path'
import { initDb } from '../server/database.js'
import { getStrategy, ladeRegelStrategien, defaultsFromSchema, htfBedarf } from '../server/strategies/index.js'
import { VORLAGEN } from '../server/strategies/rule-templates.js'
import { getHistoricalCandles, getFundingHistory, getSymbolMeta, timeframeMs } from '../server/market-data.js'
import { runBacktest } from '../server/strategy-backtest.js'

const arg = (name, vorgabe = null) => {
    const i = process.argv.indexOf(`--${name}`)
    return i > 0 ? process.argv[i + 1] : vorgabe
}

const KERZEN = arg('kerzen')
const AUS = arg('aus')
const VERGLEICH = arg('vergleich')
if (!KERZEN || !AUS) {
    console.error('Aufruf: --kerzen <ordner> --aus <datei.json> [--vergleich <datei.json>]')
    process.exit(2)
}

// Fester Zeitraum: zwei Jahre bis zum 31.10.2026, damit Läufe an anderen
// Tagen dieselben Kerzen meinen.
const BIS = Date.UTC(2026, 9, 31)
const VON = BIS - 730 * 86400000
const SYMBOLE = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']

// Je Strategie die Zeiteinheit, auf der sie gedacht ist und zwei Jahre unter
// die Kerzengrenze des Backtests passen.
const LAEUFE = [
    { id: 'lsob', tf: '1h' },
    { id: 'set_and_forget', tf: '4h' },
    { id: 'trendlinien_breakout', tf: '4h' },
    { id: 'ema_touch', tf: '1h' },
    { id: 'momentum_swing', tf: '4h' },
    { id: 'liq_kerze', tf: '1h' },
    { id: 'stochastik_dreiklang', tf: '1h', vorlage: true },
    { id: 'vwap_band', tf: '1h', vorlage: true },
    { id: 'ema_pullback', tf: '1h', vorlage: true },
]

fs.mkdirSync(KERZEN, { recursive: true })

/**
 * Kerzen ab `VON − vorlaufKerzen` Kerzen dieser Zeiteinheit. Der Vorlauf
 * steckt im Dateinamen, damit eine Ablage ohne Vorlauf nie für einen Lauf
 * mit Vorlauf herhält.
 */
async function kerzen(symbol, tf, vorlaufKerzen = 0) {
    const name = vorlaufKerzen > 0 ? `${symbol}_${tf}_vorlauf${vorlaufKerzen}.json` : `${symbol}_${tf}.json`
    const datei = path.join(KERZEN, name)
    if (fs.existsSync(datei)) return JSON.parse(fs.readFileSync(datei, 'utf8'))
    const ab = VON - vorlaufKerzen * timeframeMs(tf)
    const k = await getHistoricalCandles(symbol, tf, ab, BIS, { market: 'futures', maxCandles: 20000 })
    fs.writeFileSync(datei, JSON.stringify(k))
    console.log(`  geholt ${symbol} ${tf}${vorlaufKerzen ? ` (Vorlauf ${vorlaufKerzen})` : ''}: ${k.length} Kerzen`)
    return k
}

// Funding-Verlauf und Börsenregeln ebenso abgelegt: der Backtest holt beides
// selbst, wenn es nicht übergeben wird — und dann misst „nachher" auf anderen
// Daten als „vorher".
async function abgelegt(name, holen) {
    const datei = path.join(KERZEN, name)
    if (fs.existsSync(datei)) return JSON.parse(fs.readFileSync(datei, 'utf8'))
    const wert = await holen()
    fs.writeFileSync(datei, JSON.stringify(wert ?? null))
    return wert ?? null
}

const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null)

async function main() {
    await initDb()
    const vorlagen = VORLAGEN.filter((v) => LAEUFE.some((l) => l.vorlage && l.id === v.key))
    const geladen = ladeRegelStrategien(vorlagen.map((v) => ({
        strategyId: v.key, name: v.titel, description: v.beschreibung || '', rules: v.rules,
    })))
    if (geladen.fehlerhaft.length) console.warn('Vorlagen fehlerhaft:', geladen.fehlerhaft)

    const ergebnisse = []
    for (const lauf of LAEUFE) {
        const strategie = getStrategy(lauf.id)
        if (!strategie) { console.warn(`übersprungen: ${lauf.id} unbekannt`); continue }
        const params = defaultsFromSchema(strategie.params)
        for (const symbol of SYMBOLE) {
            const c = await kerzen(symbol, lauf.tf)
            const htfTf = params.htfTrendFilter && params.htfTimeframe && params.htfTimeframe !== lauf.tf
                ? params.htfTimeframe : null
            // Mit dem Vorlauf, den die Strategie im Betrieb sieht (`htfKerzen`).
            const htf = htfTf ? await kerzen(symbol, htfTf, htfBedarf(strategie, params)) : undefined
            const fundingVerlauf = await abgelegt(`FUNDING_${symbol}.json`, () => getFundingHistory(symbol, VON, BIS))
            const marketMeta = await abgelegt(`META_${symbol}.json`, () => getSymbolMeta(symbol, { market: 'futures' }))
            const t0 = Date.now()
            const e = await runBacktest({
                strategyId: lauf.id, params, risk: {}, symbol, timeframe: lauf.tf,
                market: 'futures', fromTs: VON, toTs: BIS, startEquity: 1000,
                candles: c, htfCandles: htf, maxLeverage: 10, fundingVerlauf, marketMeta,
            })
            const s = e.stats || {}
            // Reicht die Quelle trotzdem nicht so weit zurück, steht es neben
            // der Zeile — eine still verkürzte Datenlage ist genau der Fehler,
            // den der Vorlauf beheben soll.
            if (s.htfFilter?.vorlaufFehlt) {
                console.warn(`  Achtung: ${lauf.id} ${symbol} — HTF-Kerzen erst ab ${new Date(s.htfFilter.vorlaufAb).toISOString().slice(0, 10)}, Vorlauf unvollständig`)
            }
            const zeile = {
                strategie: lauf.id, symbol, tf: lauf.tf,
                trades: s.trades || 0,
                treffer: r2(s.winRate),
                avgR: r2(s.expectancyR),
                pf: r2(s.profitFactor),
                maxDd: r2(s.maxDrawdownPct),
                htfVorlaufFehlt: Boolean(s.htfFilter?.vorlaufFehlt),
                rendite: r2(s.returnPct),
                trichter: e.funnel ? {
                    erkannt: e.funnel.setupsDetected ?? null,
                    ausgeloest: e.funnel.triggered ?? null,
                    risiko: e.funnel.riskRejected || {},
                    uebersprungen: e.funnel.entrySkipped || {},
                } : null,
                sekunden: Math.round((Date.now() - t0) / 100) / 10,
            }
            ergebnisse.push(zeile)
            console.log(`${lauf.id.padEnd(22)} ${symbol.padEnd(8)} ${lauf.tf.padEnd(3)} n ${String(zeile.trades).padStart(4)}  Treffer ${String(zeile.treffer).padStart(6)} %  Ø R ${String(zeile.avgR).padStart(6)}  (${zeile.sekunden}s)`)
        }
    }

    fs.writeFileSync(AUS, JSON.stringify({ von: VON, bis: BIS, ergebnisse }, null, 2))

    if (VERGLEICH && fs.existsSync(VERGLEICH)) {
        const alt = JSON.parse(fs.readFileSync(VERGLEICH, 'utf8')).ergebnisse
        console.log('\n| Strategie | Symbol | TF | n vorher → nachher | Treffer % | Ø R |')
        console.log('|---|---|---|---|---|---|')
        for (const z of ergebnisse) {
            const a = alt.find((x) => x.strategie === z.strategie && x.symbol === z.symbol && x.tf === z.tf) || {}
            console.log(`| ${z.strategie} | ${z.symbol} | ${z.tf} | ${a.trades ?? '—'} → ${z.trades} | ${a.treffer ?? '—'} → ${z.treffer ?? '—'} | ${a.avgR ?? '—'} → ${z.avgR ?? '—'} |`)
        }
    }
    process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
