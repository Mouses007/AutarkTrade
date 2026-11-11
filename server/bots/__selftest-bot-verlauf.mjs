/**
 * Selbsttest: Verlauf der Bot-Seite (bot_verlauf) gegen eine Wegwerf-SQLite.
 *
 * Aufruf: node server/bots/__selftest-bot-verlauf.mjs
 */
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

const datei = path.join(os.tmpdir(), `at-bot-verlauf-${process.pid}.db`)
process.env.AT_DB_FILE = datei
process.env.DB_FILE = datei

const { initDb, getKnex } = await import('../database.js')
const { verlaufsZeile, leseVerlauf, RASTER_MS } = await import('./verlauf.js')

let ok = 0, fehl = 0
const p = (name, bed, zusatz = '') => {
    if (bed) { ok++; console.log(`  ✓ ${name}`) }
    else { fehl++; console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`) }
}

try {
    await initDb()
    const knex = getKnex()
    p('Tabelle bot_verlauf angelegt', await knex.schema.hasTable('bot_verlauf'))

    const bot = {
        id: 'b1', kurs: 83.1,
        kennzahlen: { gewinn: { gesamt: -2.4, realisiert: -0.75, schwebend: -1.65 } },
        ergebnis: { gridGewinn: 0.08, funding: -0.05, zyklen: 2356 },
        einsatz: { marge: 2.3 }, position: { menge: -957 }, liquidation: { unten: 70.9, oben: null },
    }
    const jetzt = 1794375879428
    const z = verlaufsZeile(bot, jetzt)
    p('Raster = Beginn der Viertelstunde', z.t === Math.floor(jetzt / RASTER_MS) * RASTER_MS && z.t <= jetzt && jetzt - z.t < RASTER_MS)
    p('Werte übernommen, Unbekanntes null', z.gesamt === -2.4 && z.zyklen === 2356 && z.liqOben === null)
    p('ohne Kennzahlen → null statt 0', verlaufsZeile({ id: 'x' }, jetzt).gesamt === null)

    await knex('bot_verlauf').insert(z).onConflict(['botId', 't']).ignore()
    await knex('bot_verlauf').insert({ ...z, gesamt: 99 }).onConflict(['botId', 't']).ignore()
    await knex('bot_verlauf').insert(verlaufsZeile({ ...bot, kennzahlen: { gewinn: { gesamt: -2.0 } } }, jetzt + RASTER_MS)).onConflict(['botId', 't']).ignore()
    const punkte = await leseVerlauf('b1')
    p('eine Zeile je Raster, die erste gewinnt', punkte.length === 2 && punkte[0].gesamt === -2.4)
    p('aufsteigend nach Zeit', punkte[0].t < punkte[1].t)
    p('fremder Bot liefert nichts', (await leseVerlauf('anders')).length === 0)
    await knex.destroy()
} catch (e) {
    fehl++
    console.error('  ✗ Ausnahme:', e)
} finally {
    for (const f of [datei, `${datei}-wal`, `${datei}-shm`]) { try { fs.unlinkSync(f) } catch { } }
}

console.log(`\n${ok} bestanden, ${fehl} fehlgeschlagen`)
process.exit(fehl ? 1 : 0)
