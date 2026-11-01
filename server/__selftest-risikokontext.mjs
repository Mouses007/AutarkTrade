/**
 * Selbsttest: der Risiko-Kontext gilt ZUM ZEITPUNKT der Auslösekerze.
 *
 *   node server/__selftest-risikokontext.mjs
 *
 * Hintergrund ist ein Fehler, den keine Rechenprüfung sehen konnte, weil die
 * Rechnung stimmte — bloss die Eingabe war aus der falschen Zeit. `now` ist
 * der Schluss der Auslösekerze (`risikoStichtag`, seit 31.10.2026; vorher ihr
 * Beginn — den ganzen Takt mit 15m + 4h prüft `__selftest-engine-takt.mjs`).
 * Damals lag sie beim ersten Lauf über ein Symbol bis zu 200 Kerzen in der
 * Vergangenheit, und die drei Abfragen lasen den jetzigen Stand der Datenbank.
 *
 * Sichtbar wurde es an der Sperrfrist: eingestellt waren 60 Minuten, gemeldet
 * wurden „noch 34380 min" (24 Tage), weil der letzte Ausstieg NACH der
 * Auslösekerze lag und die Wartezeit negativ wurde. 76 von 79
 * Sperrfrist-Ablehnungen am 20.08.2026 waren von dieser Sorte.
 *
 * Geprüft wird hier ohne Datenbank: Knex übersetzt die Builder mit
 * PostgreSQL-Grammatik, und im erzeugten SQL müssen die Zeitschranken stehen.
 * Gegenprobe gemacht — entfernt man eine der drei, schlägt der Test fehl.
 *
 * Dazu läuft die Abfrage der offenen Positionen einmal echt auf einer SQLite
 * im Speicher, mit den Lagen nach einer Rücksicherung (FUN-L3-001, 31.10.2026):
 * geschlossene Position ohne Trade, Trade mit fremder Positions-Nummer.
 */
import knexLib from 'knex'
import { risikoKontextAbfragen } from './strategy-engine.js'

let bestanden = 0
let fehler = 0
const pruefe = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehler++; console.log(`  \x1b[31m✗\x1b[0m ${name}${zusatz ? ' — ' + zusatz : ''}`) }
}

console.log('\nRisiko-Kontext: Stand zum Zeitpunkt der Auslösekerze')

const knex = knexLib({ client: 'pg' })
const NOW = 1_700_000_000_000
const a = risikoKontextAbfragen(knex, 42, NOW)
const sql = Object.fromEntries(Object.entries(a).map(([k, q]) => [k, q.toString()]))

// --- Sperrfrist: nur Ausstiege BIS zur Auslösekerze ------------------------
pruefe('letzte Ausstiege sind nach oben begrenzt',
    /"exitTime"\s*<=\s*1700000000000/.test(sql.letzte), sql.letzte)
pruefe('…und weiterhin je Symbol und Zeiteinheit gruppiert',
    /group by "symbol", "timeframe"/i.test(sql.letzte) && /max\("exitTime"\)/i.test(sql.letzte), sql.letzte)

// --- Tagesverlust: Tagesbeginn UND Auslösekerze ---------------------------
pruefe('Tages-PnL ist beidseitig begrenzt',
    /"exitTime" between \d+ and 1700000000000/i.test(sql.heute), sql.heute)
{
    // Der Tagesbeginn muss der Tag VON now sein, nicht der von heute.
    const tagesBeginn = Date.UTC(2023, 10, 14)   // 14.11.2023, der Tag zu NOW
    pruefe('Tagesbeginn stammt aus now, nicht aus der Systemzeit',
        sql.heute.includes(String(tagesBeginn)), `erwartet ${tagesBeginn} in ${sql.heute}`)
}

// --- Offene Positionen: offen ZUM ZEITPUNKT now ---------------------------
pruefe('nur bis zur Auslösekerze eingestiegene Positionen',
    /"entryTime"\s*<=\s*1700000000000/.test(sql.offen), sql.offen)
pruefe('eine geschlossene Position zählt nur, wenn ihr Trade erst nach now endet',
    /"status" = 'closed' and exists/i.test(sql.offen) && /"strategy_trades"\."exitTime"\s*>\s*1700000000000/.test(sql.offen), sql.offen)
pruefe('Reservierungen (pending) zählen weiterhin nicht als Position',
    !/'pending'/i.test(sql.offen), sql.offen)
/*
 * 'closing' MUSS dagegen mitzählen. So steht eine Live-Position da, die der
 * Stop-Wächter gerade schliesst: die Börsen-Order ist unterwegs, die Position
 * also noch im Markt. Fiele sie hier heraus, sähe die Engine einen freien
 * Platz unter `maxConcurrentPositions` und eröffnete daneben eine zweite.
 */
pruefe('schliessende Positionen (closing) zählen als offen',
    /"status" in \('open', 'closing'\)/i.test(sql.offen), sql.offen)
pruefe('kein Join — eine Position kann nicht doppelt gezählt werden',
    !/join/i.test(sql.offen), sql.offen)

// --- Die Lehre aus db-claim: camelCase muss gequotet sein -----------------
pruefe('Bezeichner der Unterabfrage sind gequotet (pg faltet sonst klein)',
    sql.offen.includes('"strategy_trades"."positionId" = "strategy_positions"."id"')
    && sql.offen.includes('"strategy_trades"."instanceId" = "strategy_positions"."instanceId"')
    && sql.offen.includes('"strategy_trades"."entryTime" = "strategy_positions"."entryTime"'), sql.offen)

// --- Der Fall, der den Fehler ausgelöst hat -------------------------------
// Ausstieg um 12:00, Auslösekerze um 09:00: der Ausstieg darf für diese
// Entscheidung noch nicht existieren.
{
    const neun = Date.UTC(2023, 10, 14, 9)
    const s = risikoKontextAbfragen(knex, 42, neun).letzte.toString()
    const zwoelf = Date.UTC(2023, 10, 14, 12)
    pruefe('ein späterer Ausstieg liegt ausserhalb der Schranke',
        s.includes(String(neun)) && !s.includes(String(zwoelf)) && neun < zwoelf)
}

await knex.destroy()

// --- Rücksicherung (FUN-L3-001): echte Abfrage auf SQLite ------------------
/*
 * Zwei Lagen, die eine Rücksicherung erzeugt: (a) eine Position, die nach dem
 * Backup geschlossen wurde, steht 'closed' da, ihr Trade ist mit dem Backup
 * verschwunden — sie zählte bis 31.10.2026 für immer als offen; (b) in einer
 * frischen DB beginnen die Positions-Nummern wieder bei 1, die zurückgespielten
 * Trades tragen die alten — eine neue offene Position galt sofort als zu.
 */
{
    const k = knexLib({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })
    await k.schema.createTable('strategy_positions', (t) => {
        t.increments('id'); t.integer('instanceId'); t.text('symbol'); t.text('status'); t.bigInteger('entryTime')
    })
    await k.schema.createTable('strategy_trades', (t) => {
        t.increments('id'); t.integer('instanceId'); t.integer('positionId'); t.text('symbol'); t.text('timeframe')
        t.bigInteger('entryTime'); t.bigInteger('exitTime'); t.double('netPnl')
    })
    const h = 3600e3
    const jetzt = 1_700_000_000_000
    await k('strategy_positions').insert([
        { id: 1, instanceId: 7, symbol: 'SOLUSDT', status: 'closed', entryTime: jetzt - 10 * h },   // (a) Trade fehlt
        { id: 2, instanceId: 7, symbol: 'ETHUSDT', status: 'open', entryTime: jetzt - 2 * h },      // (b) fremde Nummer
        { id: 3, instanceId: 7, symbol: 'BTCUSDT', status: 'closed', entryTime: jetzt - 5 * h },    // erst nach now zu
        { id: 4, instanceId: 7, symbol: 'XRPUSDT', status: 'closed', entryTime: jetzt - 6 * h },    // vor now zu
        { id: 5, instanceId: 7, symbol: 'ADAUSDT', status: 'closing', entryTime: jetzt - 1 * h },   // hängt
        { id: 6, instanceId: 8, symbol: 'DOTUSDT', status: 'closed', entryTime: jetzt - 6 * h },    // andere Instanz
    ])
    await k('strategy_trades').insert([
        // Trade aus dem Backup mit derselben Nummer 2, aber anderem Einstieg
        { instanceId: 7, positionId: 2, symbol: 'ETHUSDT', timeframe: '1h', entryTime: jetzt - 48 * h, exitTime: jetzt - 47 * h, netPnl: 4 },
        { instanceId: 7, positionId: 3, symbol: 'BTCUSDT', timeframe: '1h', entryTime: jetzt - 5 * h, exitTime: jetzt + 1 * h, netPnl: 1 },
        { instanceId: 7, positionId: 4, symbol: 'XRPUSDT', timeframe: '1h', entryTime: jetzt - 6 * h, exitTime: jetzt - 1 * h, netPnl: 1 },
        // Trade einer anderen Instanz mit der Nummer 1, der „nach now" endet
        { instanceId: 9, positionId: 1, symbol: 'SOLUSDT', timeframe: '1h', entryTime: jetzt - 10 * h, exitTime: jetzt + 2 * h, netPnl: 1 },
    ])
    const offen = (await risikoKontextAbfragen(k, 7, jetzt).offen).map((p) => p.id).sort()
    pruefe('Rücksicherung: geschlossene Position ohne Trade zählt nicht als offen', !offen.includes(1), offen.join(','))
    pruefe('Rücksicherung: ein Trade mit fremder Positions-Nummer schliesst eine offene Position nicht', offen.includes(2), offen.join(','))
    pruefe('eine erst nach now geschlossene Position zählt weiter als offen (Stichtag)', offen.includes(3), offen.join(','))
    pruefe('eine vor now geschlossene Position zählt nicht', !offen.includes(4), offen.join(','))
    pruefe('eine hängende Schliessung (closing) zählt als offen', offen.includes(5), offen.join(','))
    pruefe('genau diese drei, nichts von anderen Instanzen', offen.join(',') === '2,3,5', offen.join(','))
    await k.destroy()
}

console.log(`\n${fehler === 0 ? '✓' : '✗'} ${bestanden} bestanden, ${fehler} fehlgeschlagen\n`)
process.exit(fehler === 0 ? 0 : 1)
