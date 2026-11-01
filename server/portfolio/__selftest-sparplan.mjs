/**
 * Selbsttest der Portfolio-Migration „Bitpanda-Gebühr in VSN“ und der
 * Sparplan-Paarung auf den umgeschriebenen Zeilen.
 *
 *   node server/portfolio/__selftest-sparplan.mjs
 *
 * Die Migration LÖSCHT Zeilen der Bewegungstabelle (DIE Wahrheit des
 * Portfolios). Deshalb läuft sie hier gegen eine echte In-Memory-SQLite:
 *   - die drei Tausch-Zeilen eines Sparplan-Kaufs mit VSN-Gebühr werden EINE
 *     Kaufzeile mit Gebühr und der externeId, die der Abruf heute vergibt;
 *   - eine Index-Umschichtung mit drei Coins bleibt unangetastet, ebenso eine
 *     Operation, die der Nutzer eingeordnet hat;
 *   - ein zweiter Lauf ändert nichts;
 *   - danach paart `ordneSparplaene` auch diese Käufe mit ihrer Lastschrift.
 * Die Zahlen sind die echten Zeilen 2121–2124 vom 24.05.2026.
 */
import knexLib from 'knex'
import { migrierePortfolio } from '../migrationen/portfolio.js'
import { ordneSparplaene, saldiere } from './normal.js'

let bestanden = 0, fehlgeschlagen = 0
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const knex = knexLib({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })
async function addColumnIfNotExists(table, column, buildCol) {
    if (!(await knex.schema.hasTable(table))) return
    if (!(await knex.schema.hasColumn(table, column))) await knex.schema.alterTable(table, (t) => buildCol(t))
}
await knex.schema.createTable('settings', (t) => { t.increments('id').primary() })
await knex('settings').insert({ id: 1 })
const alteWarnung = console.warn
const warnungen = []
console.warn = (...a) => warnungen.push(a.join(' '))
await migrierePortfolio(knex, addColumnIfNotExists)

const sp = JSON.stringify({ operation_type: 'savings_plan' })
const zeit = Date.parse('2026-05-24T01:03:00Z')
const zeile = (externeId, art, asset, menge, extra = {}) => ({ quelle: 'bitpanda', externeId, zeit, art, asset, menge, roh: sp, chfWert: 1, chfQuelle: 'alt', ...extra })
await knex('portfolio_bewegungen').insert([
    zeile('1f1570bf', 'einzahlung', 'CHF', 50, { chfWert: 50, chfQuelle: 'Betrag in CHF' }),
    zeile('409e5782:CHF', 'tausch', 'CHF', -50),
    zeile('409e5782:BTC', 'tausch', 'BTC', 0.00081739),
    zeile('409e5782:VSN', 'tausch', 'VSN', -11.50014174),
    // Index-Umschichtung: drei Coins, kein Gebühren-Token
    zeile('idx1:LINK', 'tausch', 'LINK', -1, { roh: JSON.stringify({ operation_type: 'index_rebalancing' }) }),
    zeile('idx1:LTC', 'tausch', 'LTC', -0.1, { roh: JSON.stringify({ operation_type: 'index_rebalancing' }) }),
    zeile('idx1:UNI', 'tausch', 'UNI', 3, { roh: JSON.stringify({ operation_type: 'index_rebalancing' }) }),
    // dieselbe Form, aber eine Zeile vom Nutzer eingeordnet: bleibt
    zeile('hand:CHF', 'tausch', 'CHF', -50),
    zeile('hand:BTC', 'tausch', 'BTC', 0.001, { einordnung: 'ignorieren' }),
    zeile('hand:VSN', 'tausch', 'VSN', -10),
    // anderer Ort mit „:“ in der externeId: geht die Migration nichts an
    zeile('x:1', 'tausch', 'VSN', -1, { quelle: 'i:Andere' }),
    zeile('x:2', 'tausch', 'CHF', -1, { quelle: 'i:Andere' }),
    zeile('x:3', 'tausch', 'BTC', 1, { quelle: 'i:Andere' }),
])
const vorher = saldiere(await knex('portfolio_bewegungen').where('quelle', 'bitpanda'))

console.log('\nMigration: Bitpanda-Kauf mit VSN-Gebühr')
await migrierePortfolio(knex, addColumnIfNotExists)
{
    const op = await knex('portfolio_bewegungen').where('externeId', 'like', '409e5782%')
    check('aus drei Zeilen wird eine', op.length === 1, JSON.stringify(op))
    const k = op[0] || {}
    check('externeId = Operation (wie der Abruf heute)', k.externeId === '409e5782')
    check('Kauf BTC gegen 50 CHF', k.art === 'kauf' && k.asset === 'BTC' && k.menge === 0.00081739 && k.gegenAsset === 'CHF' && k.gegenMenge === -50)
    check('Gebühr 11.50014174 VSN', k.gebuehrAsset === 'VSN' && k.gebuehrMenge === 11.50014174)
    check('CHF-Wert zur Neubewertung frei', k.chfWert == null && k.chfQuelle == null)
    const nachher = saldiere(await knex('portfolio_bewegungen').where('quelle', 'bitpanda'))
    check('Bestand je Asset unverändert', ['BTC', 'CHF', 'VSN', 'LINK', 'LTC', 'UNI'].every((a) => Math.abs((nachher.get(a) || 0) - (vorher.get(a) || 0)) < 1e-12),
        JSON.stringify([...nachher]))
    check('Index-Umschichtung unangetastet', (await knex('portfolio_bewegungen').where('externeId', 'like', 'idx1:%')).length === 3)
    check('eingeordnete Operation unangetastet', (await knex('portfolio_bewegungen').where('externeId', 'like', 'hand:%')).length === 3)
    check('anderer Ort unangetastet', (await knex('portfolio_bewegungen').where('quelle', 'i:Andere')).length === 3)
}

console.log('\nZweiter Lauf')
{
    const anzahl = async () => Number((await knex('portfolio_bewegungen').count({ n: '*' }).first()).n)
    const n = await anzahl()
    await migrierePortfolio(knex, addColumnIfNotExists)
    check('ändert nichts', (await anzahl()) === n)
}

console.log('\nNeuabruf vor der Migration (Zeile schon da)')
{
    await knex('portfolio_bewegungen').insert([
        zeile('opneu:CHF', 'tausch', 'CHF', -50), zeile('opneu:BTC', 'tausch', 'BTC', 0.001), zeile('opneu:VSN', 'tausch', 'VSN', -9),
        zeile('opneu', 'kauf', 'BTC', 0.001, { gegenAsset: 'CHF', gegenMenge: -50, gebuehrAsset: 'VSN', gebuehrMenge: 9 }),
    ])
    await migrierePortfolio(knex, addColumnIfNotExists)
    const op = await knex('portfolio_bewegungen').where('externeId', 'like', 'opneu%')
    check('nur die neue Zeile bleibt', op.length === 1 && op[0].externeId === 'opneu' && op[0].gebuehrMenge === 9, JSON.stringify(op))
}

console.log('\nSparplan-Paarung danach')
{
    const zeilen = await knex('portfolio_bewegungen').where('quelle', 'bitpanda').whereNull('sparplanMit')
        .select('id', 'quelle as ort', 'art', 'asset', 'menge', 'gegenAsset', 'gegenMenge', 'zeit', 'roh')
    const p = ordneSparplaene(zeilen)
    const lastschrift = await knex('portfolio_bewegungen').where('externeId', '1f1570bf').first('id')
    const kauf = await knex('portfolio_bewegungen').where('externeId', '409e5782').first('id')
    check('Lastschrift ↔ umgeschriebener Kauf', p.some((x) => x.einzahlung === lastschrift.id && x.kauf === kauf.id), JSON.stringify(p))
    check('Spalte sparplanMit vorhanden', await knex.schema.hasColumn('portfolio_bewegungen', 'sparplanMit'))
}

console.warn = alteWarnung
check('keine Warnung der Migration', !warnungen.some((w) => w.includes('Portfolio')), warnungen.join(' | '))
await knex.destroy()
console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
process.exit(fehlgeschlagen ? 1 : 0)
