/**
 * S15 „Analysequellen zurück" (19.10.2026).
 *
 * Läuft bei JEDEM Start (idempotent). Zwei Teile:
 *
 * 1. Spalte `settings.quellenOhneFreigabe` (Vorgabe AN, `server/quellen/freigabe.js`).
 *
 * 2. Nur wenn der Schalter an ist: zurückführen, was die S12-Migrationen an
 *    Einstellungen umgeschrieben haben, damit die Analysen wieder wie im
 *    alten Journal laufen.
 *      - Bei jedem Start: Telegram-Nachrichtenquellen, die S12 abgeschaltet
 *        und mit `TELEGRAM_HINWEIS` markiert hat → wieder an, Markierung weg.
 *        Eine Quelle ohne diese Markierung (vom Nutzer selbst abgeschaltet)
 *        bleibt, wie sie ist.
 *      Einmalig (Merker `settings.s15Migriert`):
 *      - Kalender-Länder: S12 hat die alte Vorgabe `USD,JPY` auf `USD,EUR`
 *        gesetzt → zurück auf `USD,JPY` (ForexFactory liefert Japan wieder).
 *      - Wartungsmarge: S12 hat `binance` auf `bybit` umgestellt → zurück
 *        auf `binance` (bapi-Brackets laufen wieder, Bybit bleibt Ersatz).
 *    Danach entscheidet der Nutzer; der Merker verhindert, dass eine spätere
 *    eigene Wahl überschrieben wird.
 *
 * Solange der Schalter an ist, überspringt `s12.js` die Schritte, die
 * Quellen bei jedem Start wieder abschalten würden.
 */

import { normSchalter } from '../quellen/freigabe.js'

/** Wortgleich mit `TELEGRAM_HINWEIS` in `s12-marktradar.js`. */
const TELEGRAM_HINWEIS = 'Telegram-Abruf entfernt (Lizenz: Telegram verbietet das Auslesen öffentlicher Kanäle)'

export async function schalterAn(knex) {
    try {
        if (!(await knex.schema.hasColumn('settings', 'quellenOhneFreigabe'))) return true
        const z = await knex('settings').select('quellenOhneFreigabe').where('id', 1).first()
        return normSchalter(z?.quellenOhneFreigabe)
    } catch { return true }
}

export async function migriereS15(knex, addColumnIfNotExists) {
    await addColumnIfNotExists('settings', 'quellenOhneFreigabe', (t) => t.boolean('quellenOhneFreigabe').defaultTo(true))
    await addColumnIfNotExists('settings', 's15Migriert', (t) => t.integer('s15Migriert').defaultTo(0))

    if (!(await schalterAn(knex))) return
    const meldungen = []

    // Bei jedem Start mit Schalter an: was S12 (oder ein Start mit Schalter aus)
    // an Telegram-Quellen markiert abgeschaltet hat, wieder an. Die Markierung
    // unterscheidet das von einer Quelle, die der Nutzer selbst abgeschaltet hat.
    if (await knex.schema.hasTable('news_sources')) {
        const n = await knex('news_sources')
            .where({ art: 'telegram', letzterFehler: TELEGRAM_HINWEIS })
            .update({ enabled: 1, letzterFehler: null, updatedAt: Date.now() })
        if (n) meldungen.push(`${n} Telegram-Quelle(n) wieder an`)
    }

    const s = await knex('settings').select('s15Migriert').where('id', 1).first().catch(() => null)
    if (!s || Number(s.s15Migriert)) {
        if (meldungen.length) console.log(` -> S15: ${meldungen.join(', ')}`)
        return
    }
    if (await knex.schema.hasColumn('settings', 'radarKalenderLaender')) {
        const n = await knex('settings').where({ id: 1, radarKalenderLaender: 'USD,EUR' }).update({ radarKalenderLaender: 'USD,JPY' })
        if (n) meldungen.push('Kalender-Länder USD,JPY')
    }
    if (await knex.schema.hasColumn('settings', 'levMapMmrQuelle')) {
        const n = await knex('settings').where({ id: 1, levMapMmrQuelle: 'bybit' }).update({ levMapMmrQuelle: 'binance' })
        if (n) meldungen.push('Wartungsmarge Binance (automatisch)')
    }
    await knex('settings').where('id', 1).update({ s15Migriert: 1 })
    console.log(` -> S15: Quellen mit eingeschränkten Nutzungsbedingungen an${meldungen.length ? ' — ' + meldungen.join(', ') : ''}`)
}
