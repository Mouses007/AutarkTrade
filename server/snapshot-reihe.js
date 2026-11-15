/**
 * Tagesreihen in `market_snapshots` lesen und schreiben.
 *
 * Geteilt von allem, was eine Fremdreihe selbst einlagert (ETF-Bestände,
 * Coinbase-Premium, Bitcoin-Bewertung): eine Zeile je `kind` und Tag, der Tag
 * als UTC-Mitternacht in ms.
 */

import { getKnex } from './database.js'

/** Eingelagerte Reihe lesen, aufsteigend. */
export async function leseReihe(kind) {
    const zeilen = await getKnex()('market_snapshots')
        .where('kind', kind).orderBy('dayUnix', 'asc').select('dayUnix', 'value')
    return zeilen.map(z => [Number(z.dayUnix), Number(z.value)])
}

/** Reihe einlagern. Der spätere Wert gewinnt — die Quellen korrigieren nach. */
export async function schreibeReihe(kind, reihe) {
    if (!reihe.length) return 0
    const knex = getKnex()
    const zeilen = reihe.map(([tag, wert]) => ({
        kind, dayUnix: tag, value: wert, createdAt: Date.now(),
    }))
    for (let i = 0; i < zeilen.length; i += 200) {
        await knex('market_snapshots').insert(zeilen.slice(i, i + 200))
            .onConflict(['kind', 'dayUnix']).merge(['value', 'createdAt'])
    }
    return zeilen.length
}
