/**
 * Verlauf laufender Bots: alle 15 Minuten ein Schnappschuss je laufendem Bot
 * in `bot_verlauf`. Pionex liefert nur den aktuellen Stand; ohne eigene
 * Aufzeichnung gäbe es keine Kurve des Ergebnisses.
 *
 * Nur ein Prozess schreibt je Raster (db-claim `bots_verlauf`), Zeilen sind
 * zusätzlich je Bot und Raster eindeutig. Im Testbetrieb startet der Takt
 * nicht (starteTakte in index.mjs). Zeilen älter als ein Jahr gehen.
 */
import { getKnex } from '../database.js'
import { beansprucheAufgabe } from '../db-claim.js'
import { logWarn } from '../logger.js'
import { holeLaufendeBots } from './routen.js'

export const RASTER_MS = 15 * 60_000
const AUFBEWAHRUNG_MS = 365 * 86_400_000
let takt = null

/** Zeile für einen Bot (rein). `t` = Beginn des 15-Minuten-Rasters. */
export function verlaufsZeile(bot, jetzt = Date.now()) {
    const k = bot.kennzahlen || {}
    return {
        botId: bot.id,
        t: Math.floor(jetzt / RASTER_MS) * RASTER_MS,
        kurs: bot.kurs ?? null,
        gesamt: k.gewinn?.gesamt ?? null,
        realisiert: k.gewinn?.realisiert ?? null,
        schwebend: k.gewinn?.schwebend ?? null,
        gridGewinn: bot.ergebnis?.gridGewinn ?? null,
        funding: bot.ergebnis?.funding ?? null,
        marge: bot.einsatz?.marge ?? null,
        position: bot.position?.menge ?? null,
        liqUnten: bot.liquidation?.unten ?? null,
        liqOben: bot.liquidation?.oben ?? null,
        zyklen: bot.ergebnis?.zyklen ?? null,
    }
}

export async function schreibeVerlauf() {
    if (!(await beansprucheAufgabe('bots_verlauf', RASTER_MS - 60_000))) return 0
    // Nur die laufenden Bots (Audit FUN-03): beendete ändern sich nicht
    const bots = await holeLaufendeBots().catch(() => [])
    const zeilen = bots.filter((b) => b.laufend).map((b) => verlaufsZeile(b))
    if (!zeilen.length) return 0
    const knex = getKnex()
    await knex('bot_verlauf').insert(zeilen).onConflict(['botId', 't']).ignore()
    await knex('bot_verlauf').where('t', '<', Date.now() - AUFBEWAHRUNG_MS).del()
    return zeilen.length
}

export async function leseVerlauf(botId) {
    return getKnex()('bot_verlauf').where('botId', String(botId)).orderBy('t', 'asc')
        .select('t', 'kurs', 'gesamt', 'realisiert', 'schwebend', 'gridGewinn', 'funding', 'marge', 'zyklen')
}

export function startBotVerlaufTakt() {
    if (takt) return
    const lauf = () => schreibeVerlauf().catch((e) => logWarn('bots', `Verlauf: ${e.message}`))
    setTimeout(lauf, 60_000).unref?.()
    takt = setInterval(lauf, RASTER_MS)
    takt.unref?.()
}

export function stopBotVerlaufTakt() {
    if (takt) clearInterval(takt)
    takt = null
}
