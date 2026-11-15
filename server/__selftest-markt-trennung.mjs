/**
 * Selbsttest: Trennung der Märkte Krypto ↔ Aktien auf dem Server.
 *
 *   node server/__selftest-markt-trennung.mjs
 *
 * Teil 1 rein: Markt eines Chart-Alarms (`chart-alarm-markt.js`) und eines
 * Backtest-Laufs (`strategie-markt.js`).
 *
 * Teil 2 als ECHTER HTTP-Server gegen eine Wegwerf-SQLite (`AT_DB_FILE=:memory:`
 * vor dem ersten DB-Import, wie `__selftest-crud.mjs`): die Routen der
 * Chart-Alarme und der Strategie-Listen mit dem echten Schema. Kein Netz —
 * angelegt werden über die Schnittstelle nur Watchlist-Alarme (ein Symbol-Alarm
 * fragte die Marktdatenquelle nach dem Kurs); der Weg «Symbol → Markt» läuft
 * über das Ändern eines Alarms, das nur den Titel-Stamm liest.
 */
process.env.AT_DB_FILE = ':memory:'

const { alarmKlasse, artImMarkt, listenFilter, zeileImMarkt, NUR_KRYPTO } = await import('./chart-alarm-markt.js')
const { marktFilter, laufKlasse, laeufeImMarkt } = await import('./strategie-markt.js')

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}
const gleich = (name, ist, soll) => check(name, JSON.stringify(ist) === JSON.stringify(soll), `ist ${JSON.stringify(ist)}, soll ${JSON.stringify(soll)}`)

console.log('\nMarkt eines Chart-Alarms (rein)\n')
gleich('Symbol laut Stamm Aktie', alarmKlasse({ markt: 'futures', symbolKlasse: 'aktien' }), { klasse: 'aktien' })
gleich('Symbol laut Stamm Krypto', alarmKlasse({ markt: 'futures', symbolKlasse: 'krypto' }), { klasse: 'krypto' })
gleich('Stamm unbekannt ist Krypto', alarmKlasse({ markt: 'futures', symbolKlasse: null }), { klasse: 'krypto' })
gleich('ohne Angaben ist Krypto', alarmKlasse(), { klasse: 'krypto' })
gleich('Spot ist immer Krypto', alarmKlasse({ markt: 'spot', symbolKlasse: 'aktien' }), { klasse: 'krypto' })
gleich('Watchlist entscheidet vor dem Symbol', alarmKlasse({ symbolKlasse: 'krypto', watchlistKlassen: ['aktien'] }), { klasse: 'aktien' })
gleich('zwei Aktien-Listen', alarmKlasse({ watchlistKlassen: ['aktien', 'aktien'] }), { klasse: 'aktien' })
gleich('Liste ohne Angabe ist Krypto', alarmKlasse({ watchlistKlassen: [null, 'krypto'] }), { klasse: 'krypto' })
check('Listen aus beiden Märkten sind ein Fehler', !!alarmKlasse({ watchlistKlassen: ['krypto', 'aktien'] }).fehler)
check('Liste ohne Angabe + Aktien-Liste ist gemischt', !!alarmKlasse({ watchlistKlassen: [null, 'aktien'] }).fehler)
gleich('Filter: nur krypto und aktien', [listenFilter('aktien'), listenFilter('krypto'), listenFilter(''), listenFilter(undefined), listenFilter('forex')], ['aktien', 'krypto', null, null, null])
gleich('Zeile im Markt', [zeileImMarkt({ anlageklasse: 'aktien' }, 'aktien'), zeileImMarkt({ anlageklasse: null }, 'aktien'), zeileImMarkt({ anlageklasse: null }, 'krypto'), zeileImMarkt({ anlageklasse: 'aktien' }, null)], [true, false, true, true])
// Preis, Linie, Zone, Momentum, LSOB lesen nur Kurs und Kerzen — sie gelten in beiden Märkten
gleich('keine Alarm-Art ist nur Krypto', NUR_KRYPTO, [])
check('jede Art darf für Aktien angelegt werden', ['preis', 'linie', 'zone', 'momentum', 'lsob'].every((a) => artImMarkt(a, 'aktien') && artImMarkt(a, 'krypto')))

console.log('\nMarkt eines Backtest-Laufs (rein)\n')
gleich('Lauf mit stats.aktien ist Aktie', laufKlasse({ trades: 3, aktien: { sitzungen: {} } }), 'aktien')
gleich('Lauf als Text', laufKlasse(JSON.stringify({ aktien: { splits: [] } })), 'aktien')
gleich('Lauf ohne stats.aktien ist Krypto', laufKlasse({ trades: 3 }), 'krypto')
gleich('stats.aktien null ist Krypto', laufKlasse({ aktien: null }), 'krypto')
gleich('kaputte Kennzahlen sind Krypto', [laufKlasse('{'), laufKlasse(''), laufKlasse(null)], ['krypto', 'krypto', 'krypto'])
gleich('Markt-Filter', [marktFilter('aktien'), marktFilter('krypto'), marktFilter(undefined), marktFilter('alle')], ['aktien', 'krypto', null, null])
const LAEUFE = [{ id: 3, stats: '{"aktien":{}}' }, { id: 2, stats: '{}' }, { id: 1, stats: { aktien: { x: 1 } } }]
gleich('Läufe je Markt, Reihenfolge bleibt', [laeufeImMarkt(LAEUFE, 'aktien').map((l) => l.id), laeufeImMarkt(LAEUFE, 'krypto').map((l) => l.id), laeufeImMarkt(LAEUFE, null).length], [[3, 1], [2], 3])

// ── Teil 2: Routen gegen die Wegwerf-Datenbank ───────────────────────────────
const { initDb, getKnex } = await import('./database.js')
const { setupChartAlarmRoutes, stopChartAlarmTakt } = await import('./chart-alarme.js')
const { setupStrategyRoutes } = await import('./strategy-api.js')
const express = (await import('express')).default

await initDb()
const knex = getKnex()
const app = express()
app.use(express.json({ limit: '2mb' }))
setupChartAlarmRoutes(app)
setupStrategyRoutes(app)
const server = await new Promise((fertig) => { const s = app.listen(0, '127.0.0.1', () => fertig(s)) })
const basis = `http://127.0.0.1:${server.address().port}`
const api = async (methode, pfad, body) => {
    const r = await fetch(basis + pfad, { method: methode, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    let daten = null
    try { daten = await r.json() } catch { /* leer */ }
    return { status: r.status, daten }
}

try {
    console.log('\nChart-Alarme je Markt (Routen)\n')
    // Titel-Stamm: NVIDIA als Future bei Binance und Bitget (andere Schreibweise)
    const [instrumentId] = await knex('instrumente').insert({ anlageklasse: 'aktien', ticker: 'NVDA', unterart: 'aktie', name: 'NVIDIA' })
    await knex('instrument_listungen').insert([
        { instrumentId, handelsplatz: 'binance', symbol: 'NVDAUSDT', art: 'perp', quote: 'USDT', aktiv: 1 },
        { instrumentId, handelsplatz: 'bitget', symbol: 'NVDASTOCKUSDT', art: 'perp', quote: 'USDT', aktiv: 1 },
    ])
    const [wlKrypto] = await knex('chart_watchlists').insert({ name: 'Coins', symbole: JSON.stringify([{ symbol: 'BTCUSDT', markt: 'futures' }]), anlageklasse: 'krypto' })
    const [wlAktien] = await knex('chart_watchlists').insert({ name: 'Titel', symbole: JSON.stringify([{ symbol: 'NVDAUSDT', markt: 'futures' }]), anlageklasse: 'aktien' })
    // Eine Liste von vor der Aktien-Integration: Spalte leer
    const [wlAlt] = await knex('chart_watchlists').insert({ name: 'Alt', symbole: JSON.stringify([{ symbol: 'ETHUSDT', markt: 'futures' }]) })
    await knex('chart_watchlists').where('id', wlAlt).update({ anlageklasse: null })

    const momentum = (watchlistIds) => ({ art: 'momentum', watchlistIds, zeiteinheiten: ['15m'], punktgroesse: 'gross', bedingung: {} })
    const aAktien = await api('POST', '/api/chart/alarme', momentum([wlAktien]))
    gleich('Watchlist-Alarm auf die Aktien-Liste ist ein Aktien-Alarm', [aAktien.status, aAktien.daten?.anlageklasse], [200, 'aktien'])
    const aKrypto = await api('POST', '/api/chart/alarme', momentum([wlKrypto, wlAlt]))
    gleich('Watchlist-Alarm auf Krypto-Listen (eine ohne Angabe) ist Krypto', [aKrypto.status, aKrypto.daten?.anlageklasse], [200, 'krypto'])
    const aGemischt = await api('POST', '/api/chart/alarme', momentum([wlKrypto, wlAktien]))
    check('Listen aus beiden Märkten: 400 mit Begründung', aGemischt.status === 400 && /Märkten/.test(aGemischt.daten?.error || ''), JSON.stringify(aGemischt))
    const aLsob = await api('POST', '/api/chart/alarme', { art: 'lsob', watchlistIds: [wlAktien], zeiteinheiten: ['1h'], bedingung: { ereignis: 'retest' } })
    gleich('LSOB-Alarm gibt es auch für Aktien', [aLsob.status, aLsob.daten?.anlageklasse], [200, 'aktien'])

    // Bestand von vor der Trennung: Preis-Alarm ohne Angabe
    const [altId] = await knex('chart_alarme').insert({ symbol: 'BTCUSDT', markt: 'futures', art: 'preis', bedingung: JSON.stringify({ richtung: 'kreuzt', preis: 65000 }), aktiv: 1, einmalig: 1, erstelltAm: Date.now() })
    await knex('chart_alarme').where('id', altId).update({ anlageklasse: null })

    const idsVon = (r) => (r.daten || []).map((a) => a.id).sort((x, y) => x - y)
    const alle = await api('GET', '/api/chart/alarme')
    gleich('ohne Filter kommen alle Alarme (wie vor der Trennung)', idsVon(alle), [aAktien.daten.id, aKrypto.daten.id, aLsob.daten.id, altId].sort((x, y) => x - y))
    const nurAktien = await api('GET', '/api/chart/alarme?anlageklasse=aktien')
    gleich('Liste Aktien', idsVon(nurAktien), [aAktien.daten.id, aLsob.daten.id].sort((x, y) => x - y))
    const nurKrypto = await api('GET', '/api/chart/alarme?anlageklasse=krypto')
    gleich('Liste Krypto, samt Alarm ohne Angabe', idsVon(nurKrypto), [aKrypto.daten.id, altId].sort((x, y) => x - y))
    gleich('Alarm ohne Angabe wird als Krypto ausgeliefert', nurKrypto.daten.find((a) => a.id === altId)?.anlageklasse, 'krypto')
    gleich('unbekannter Filterwert filtert nicht', idsVon(await api('GET', '/api/chart/alarme?anlageklasse=forex')).length, 4)
    gleich('Symbol-Filter und Markt-Filter zusammen', idsVon(await api('GET', '/api/chart/alarme?symbol=BTCUSDT&anlageklasse=aktien')), [])

    // Symbol wechseln: der Alarm wechselt mit dem Titel-Stamm den Markt
    const zuAktie = await api('PUT', `/api/chart/alarme/${altId}`, { symbol: 'NVDAUSDT' })
    gleich('Symbol auf ein Aktien-Future geändert → Aktien-Alarm', [zuAktie.status, zuAktie.daten?.anlageklasse], [200, 'aktien'])
    const zuBitget = await api('PUT', `/api/chart/alarme/${altId}`, { symbol: 'NVDASTOCKUSDT' })
    gleich('Bitget-Schreibweise desselben Titels → Aktien-Alarm', [zuBitget.status, zuBitget.daten?.anlageklasse], [200, 'aktien'])
    const zuCoin = await api('PUT', `/api/chart/alarme/${altId}`, { symbol: 'SOLUSDT' })
    gleich('Symbol auf einen Coin geändert → Krypto-Alarm', [zuCoin.status, zuCoin.daten?.anlageklasse], [200, 'krypto'])
    const spot = await api('PUT', `/api/chart/alarme/${altId}`, { symbol: 'NVDAUSDT', markt: 'spot' })
    gleich('Spot ist Krypto, auch bei gleichem Symbol', [spot.status, spot.daten?.anlageklasse], [200, 'krypto'])
    const nurNotiz = await api('PUT', `/api/chart/alarme/${aAktien.daten.id}`, { notiz: 'bleibt' })
    gleich('Notiz ändern lässt den Markt in Ruhe', [nurNotiz.status, nurNotiz.daten?.anlageklasse, nurNotiz.daten?.notiz], [200, 'aktien', 'bleibt'])
    const listenWechsel = await api('PUT', `/api/chart/alarme/${aAktien.daten.id}`, { watchlistIds: [wlKrypto] })
    gleich('Watchlist gewechselt → Markt der neuen Liste', [listenWechsel.status, listenWechsel.daten?.anlageklasse], [200, 'krypto'])
    const listenGemischt = await api('PUT', `/api/chart/alarme/${aAktien.daten.id}`, { watchlistIds: [wlKrypto, wlAktien] })
    check('Watchlists beider Märkte beim Ändern: 400', listenGemischt.status === 400, JSON.stringify(listenGemischt))

    console.log('\nStrategie-Listen je Markt (Routen)\n')
    const instanz = async (name, anlageklasse) => {
        const [id] = await knex('strategy_instances').insert({ strategyId: 'lsob', name, symbols: '["X"]' })
        await knex('strategy_instances').where('id', id).update({ anlageklasse })
        return id
    }
    const iKrypto = await instanz('Coins', 'krypto')
    const iAktien = await instanz('Titel', 'aktien')
    const iAlt = await instanz('Alt', null)
    for (const [instanceId, symbol] of [[iKrypto, 'BTCUSDT'], [iAktien, 'NVDAUSDT'], [iAlt, 'ETHUSDT']]) {
        await knex('strategy_setups').insert({ instanceId, symbol })
    }
    const instanzIds = (r) => (r.daten || []).map((x) => Number(x.instanceId ?? x.id)).sort((x, y) => x - y)
    gleich('Instanzen ohne Filter', instanzIds(await api('GET', '/api/strategies/instances')), [iKrypto, iAktien, iAlt].sort((x, y) => x - y))
    gleich('Instanzen Aktien', instanzIds(await api('GET', '/api/strategies/instances?markt=aktien')), [iAktien])
    gleich('Instanzen Krypto (samt ohne Angabe)', instanzIds(await api('GET', '/api/strategies/instances?markt=krypto')), [iKrypto, iAlt].sort((x, y) => x - y))
    gleich('Signale ohne Filter', instanzIds(await api('GET', '/api/strategies/setups')), [iKrypto, iAktien, iAlt].sort((x, y) => x - y))
    gleich('Signale Aktien', instanzIds(await api('GET', '/api/strategies/setups?markt=aktien')), [iAktien])
    gleich('Signale Krypto (samt Instanz ohne Angabe)', instanzIds(await api('GET', '/api/strategies/setups?markt=krypto')), [iKrypto, iAlt].sort((x, y) => x - y))
    gleich('Signale einer Instanz bleiben, wie sie waren', instanzIds(await api('GET', `/api/strategies/setups?instanceId=${iAktien}`)), [iAktien])
    gleich('Aussortierte: Filter läuft (leere Tabelle)', (await api('GET', '/api/strategies/aussortiert?markt=aktien')).status, 200)
    gleich('Trades: Filter läuft (leere Tabelle)', (await api('GET', '/api/strategies/trades?markt=krypto')).status, 200)

    // Läufe: der Markt steht im Ergebnis
    const lauf = async (symbol, stats) => (await knex('strategy_backtests').insert({ strategyId: 'lsob', symbol, timeframe: '15m', stats: JSON.stringify(stats) }))[0]
    const lKrypto = await lauf('BTCUSDT', { trades: 4 })
    const lAktien = await lauf('NVDAUSDT', { trades: 2, aktien: { sitzungen: {} } })
    const lAktien2 = await lauf('TSLAUSDT', { trades: 1, aktien: { sitzungen: {} } })
    const laufIds = (r) => (r.daten || []).map((x) => x.id)
    gleich('Läufe ohne Filter, neueste zuerst', laufIds(await api('GET', '/api/strategies/backtests')), [lAktien2, lAktien, lKrypto])
    gleich('Läufe Aktien', laufIds(await api('GET', '/api/strategies/backtests?markt=aktien')), [lAktien2, lAktien])
    gleich('Läufe Krypto', laufIds(await api('GET', '/api/strategies/backtests?markt=krypto')), [lKrypto])
    gleich('Grenze gilt NACH dem Teilen', laufIds(await api('GET', '/api/strategies/backtests?markt=aktien&limit=1')), [lAktien2])
    check('«alle löschen» ohne Bestätigung: 400', (await api('DELETE', '/api/strategies/backtests?markt=aktien')).status === 400)
    const weg = await api('DELETE', '/api/strategies/backtests?confirm=true&markt=aktien')
    gleich('«alle löschen» im Aktien-Markt löscht nur dessen Läufe', [weg.daten?.geloescht, laufIds(await api('GET', '/api/strategies/backtests'))], [2, [lKrypto]])
    const lNeu = await lauf('NVDAUSDT', { aktien: { sitzungen: {} } })
    const wegKrypto = await api('DELETE', '/api/strategies/backtests?confirm=true&markt=krypto')
    gleich('…und im Krypto-Markt nur die Krypto-Läufe', [wegKrypto.daten?.geloescht, laufIds(await api('GET', '/api/strategies/backtests'))], [1, [lNeu]])
    const wegAlle = await api('DELETE', '/api/strategies/backtests?confirm=true')
    gleich('ohne Markt wie bisher: alle', [wegAlle.daten?.geloescht, laufIds(await api('GET', '/api/strategies/backtests'))], [1, []])
} catch (e) {
    check('Routen-Teil lief ohne Ausnahme durch', false, e.stack || e.message)
} finally {
    stopChartAlarmTakt?.()
    server.close()
    await knex.destroy().catch(() => { })
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehlgeschlagen: ' + fehler.join('; ')); process.exit(1) }
process.exit(0)
