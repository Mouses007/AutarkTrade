/**
 * Selbsttest: Tagesdaten des Aktien-Radars — welches Symbol der Kursquelle
 * gefragt wird (Audit vom 15.11.2026, FUN-F-002). In-memory SQLite, ohne Netz.
 *
 *   node server/coin-radar/__selftest-aktien-tagesdaten.mjs
 *
 * Geprüft wird, was still Falsches rechnen würde: Stärke und Hoch-Nähe einer
 * fremden Firma unter demselben Ticker (BYD Company → Boyd Gaming, Sanofi →
 * Banco Santander). Ohne Kurssymbol bleibt der Titel ohne Tagesdaten — die
 * Note fällt dann wie bei fehlenden Daten ohne Stärke aus.
 */
import assert from 'node:assert/strict'
import knexLib from 'knex'
import { ladeTagesdaten, INDEX } from './aktien-tagesdaten.js'
import { universumAus } from './aktien-universum.js'
import { bewerteAktie } from './aktien-kennzahlen.js'

const knex = knexLib({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })
await knex.schema.createTable('newcomer_titel', (t) => {
    t.increments('id').primary()
    t.integer('instrumentId')
    t.string('kursSymbol')
    t.string('zuordnung')
    t.text('kennzahlen')
    t.string('grund')
    t.bigInteger('stand')
})

let n = 0
const gleich = (a, b, text) => { assert.deepEqual(a, b, text); n++ }
const ok = (bed, text) => { assert.ok(bed, text); n++ }

const TAG = 86400e3
const jetzt = Date.UTC(2026, 10, 13, 22)
const kerzen = Array.from({ length: 300 }, (_, i) => ({ t: jetzt - (300 - i) * TAG, o: 100 + i, h: 100 + i, l: 100 + i, c: 100 + i, v: 1e6 }))
const gefragt = []
const abruf = async (symbol) => { gefragt.push(symbol); return { meta: { symbol, ipoDatum: null }, kerzen } }
const frisch = JSON.stringify({ perf3m: 5, perf6m: 9, perf12m: 20, abstandHochPct: -3, hoch52w: 110, letzteKerze: jetzt - TAG })

await knex('newcomer_titel').insert([
    // Stand von vor der Korrektur: «BYD» = Boyd Gaming, ungeprüft über den Ticker, Kennzahlen frisch.
    { instrumentId: 1, kursSymbol: 'BYD', zuordnung: 'ticker', kennzahlen: frisch, stand: jetzt - 3600e3 },
    // Der Newcomer-Lauf hat gesucht und nichts gefunden.
    { instrumentId: 2, kursSymbol: null, zuordnung: null, kennzahlen: '{}', grund: 'keinTreffer', stand: jetzt - 3600e3 },
    // Gefunden und frisch: kostet keinen Abruf.
    { instrumentId: 3, kursSymbol: 'ASML.AS', zuordnung: 'suche', kennzahlen: frisch, stand: jetzt - 3600e3 },
])
const titel = [
    { symbol: 'BYDUSDT', id: 1, ticker: 'BYD', region: 'HK' },
    { symbol: 'SANUSDT', id: 2, ticker: 'SAN', region: null },
    { symbol: 'ASMLUSDT', id: 3, ticker: 'ASML' },
    { symbol: 'NVDAUSDT', id: 4, ticker: 'NVDA' },
    { symbol: 'SAMSUNGUSDT', id: null, ticker: 'SAMSUNG', region: 'KR' },
]
const r = await ladeTagesdaten(knex, titel, () => { }, jetzt, abruf)

gleich(Object.fromEntries(r.kursSymbole), { BYDUSDT: null, SANUSDT: null, ASMLUSDT: 'ASML.AS', NVDAUSDT: 'NVDA', SAMSUNGUSDT: null }, 'Kurssymbole: Unbekanntes bleibt null')
gleich(gefragt.filter((s) => !Object.values(INDEX).includes(s)), ['NVDA'], 'abgerufen wird nur NVDA — weder BYD (Boyd Gaming) noch SAN (Banco Santander)')
ok(!r.je.has('BYDUSDT'), 'BYD (HK): auch die gemerkten Kennzahlen des Falschtreffers zählen nicht')
ok(!r.je.has('SANUSDT') && !r.je.has('SAMSUNGUSDT'), 'SAN mit keinTreffer und Titel mit Region KR: keine Tagesdaten')
gleich([r.je.get('ASMLUSDT')?.quelle, r.je.get('NVDAUSDT')?.quelle, r.gemerkt, r.abgerufen], ['gemerkt', 'abruf', 1, 1], 'gültiger Stand wird genutzt, der Rest abgerufen')

// FACH-H-013: Titel unter den Hürden weiten das Feld des Stärke-Rangs — mit gemerktem Stand, nie mit einem Abruf.
{
    gefragt.length = 0
    const feld = [
        { symbol: 'NVDAUSDT', id: 4, ticker: 'NVDA' },
        { symbol: 'ASMLUSDT', id: 3, ticker: 'ASML', nurGemerkt: true },
        { symbol: 'AMDUSDT', id: 5, ticker: 'AMD', nurGemerkt: true },
    ]
    const f = await ladeTagesdaten(knex, feld, () => { }, jetzt, abruf)
    gleich(gefragt.filter((s) => !Object.values(INDEX).includes(s)), ['NVDA'], '`nurGemerkt`: für AMD (kein Stand) geht kein Abruf hinaus')
    ok(f.je.get('ASMLUSDT')?.quelle === 'gemerkt' && !f.je.has('AMDUSDT') && f.je.get('NVDAUSDT')?.quelle === 'abruf', '`nurGemerkt`: der gemerkte Stand zählt, ohne Stand bleibt der Titel aus dem Feld')
    // Bremst die Quelle beim ersten Titel, wird nicht weiter gefragt — der gemerkte Stand dahinter zählt trotzdem.
    const { Gebremst } = await import('../newcomer-radar/kursquelle.js')
    let fragen = 0
    const bremse = async (symbol) => { if (Object.values(INDEX).includes(symbol)) return abruf(symbol); fragen++; throw new Gebremst('HTTP 429') }
    const g = await ladeTagesdaten(knex, [{ symbol: 'NVDAUSDT', id: 4, ticker: 'NVDA' }, { symbol: 'AMDUSDT', id: 5, ticker: 'AMD' }, ...feld.slice(1)], () => { }, jetzt, bremse)
    ok(g.grund === 'gebremst' && fragen === 1 && g.je.get('ASMLUSDT')?.quelle === 'gemerkt' && !g.je.has('NVDAUSDT'), 'gebremst: ein Versuch, danach kein Abruf mehr, Gemerktes bleibt im Feld')
}

// Das Universum reicht die Region des Stamms durch.
const u = universumAus([{ id: 1, ticker: 'BYD', region: 'HK', name: null, unterart: 'aktie', listungen: [{ handelsplatz: 'binance', symbol: 'BYDUSDT', art: 'perp', quote: 'USDT' }] }], 'binance')
gleich(u.get('BYDUSDT').region, 'HK', 'Region kommt im Universum an')

// Ohne Tagesdaten: Note ohne Stärke und Hoch-Nähe wie bei fehlenden Daten, kein Absturz.
const t = r.je.get('BYDUSDT') || null
const b = bewerteAktie({ kerzen: { atrPct: 3, adx: 40 }, rvol: 4, staerkeRang: null, abstandHochPct: t?.abstandHochPct ?? null })
ok(b.hinweise.includes('Stärke unbekannt') && b.hinweise.includes('52-Wochen-Hoch unbekannt') && Number.isFinite(b.note), 'BYD: Note ohne Stärke und Hoch-Nähe')

await knex.destroy()
console.log(`✓ Aktien-Tagesdaten: ${n} Prüfungen`)
