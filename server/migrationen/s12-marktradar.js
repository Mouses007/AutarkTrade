/**
 * S12-Migration, Bereich Marktradar / Live-Trading / Nachrichten / Kalender.
 *
 * Läuft bei JEDEM Start und muss deshalb mehrfach laufen dürfen (idempotent).
 * Die Test-DB ist eine Kopie echter Nutzerdaten: nichts löschen, was der
 * Nutzer selbst angelegt hat — abschalten und markieren.
 *
 * 1. Telegram-Quellen der Nachrichten (Verkaufs-Prüfung Z. 52): Der Abruf
 *    öffentlicher Kanäle über `t.me/s/…` ist entfernt. Vom Nutzer angelegte
 *    Telegram-Quellen bleiben in der Liste stehen (samt ihren Beiträgen, die
 *    nach der üblichen Aufbewahrungsfrist von selbst auslaufen), werden aber
 *    abgeschaltet und mit einem Hinweis versehen, warum. Wieder einschalten
 *    lässt die Route sie nicht (`ARTEN_ENTFERNT` in `marktradar-news.js`).
 *
 * 2. Kalender-Länder: Die alte Vorgabe `USD,JPY` passte zu ForexFactory.
 *    Für Japan gibt es ohne ForexFactory keine Quelle mehr, für den Euroraum
 *    jetzt Eurostat. Steht in den Einstellungen GENAU die alte Vorgabe, wird
 *    sie auf `USD,EUR` gesetzt — sonst zeigte der Kalender die neuen
 *    Eurostat-Termine nie. Eine abweichende Auswahl bleibt unberührt.
 *
 * Nicht migriert, mit Absicht:
 *   - `calendar_events` mit `quelle` = `ff-woche`/`ff-monat` (ForexFactory):
 *     Bestand der Installation, bleibt liegen und läuft aus dem Anzeigefenster.
 *   - `market_snapshots` `domBtc`/`domEth`/`domMcap` (CoinMarketCap-Import):
 *     bleibt liegen, wird aber nicht mehr gezeigt (`holeDominanz`).
 */

/** Wortgleich mit `TELEGRAM_HINWEIS` in `marktradar-news.js` (dort für die Routen). */
const TELEGRAM_HINWEIS = 'Telegram-Abruf entfernt (Lizenz: Telegram verbietet das Auslesen öffentlicher Kanäle)'

export async function migriere(knex, addColumnIfNotExists) { // eslint-disable-line no-unused-vars
    if (await knex.schema.hasTable('news_sources')) {
        const n = await knex('news_sources')
            .where('art', 'telegram')
            .andWhere((q) => q.where('enabled', 1).orWhereNot('letzterFehler', TELEGRAM_HINWEIS).orWhereNull('letzterFehler'))
            .update({ enabled: 0, letzterFehler: TELEGRAM_HINWEIS, updatedAt: Date.now() })
        if (n) console.log(` -> S12: ${n} Telegram-Nachrichtenquelle(n) abgeschaltet (Abruf entfernt)`)
    }

    if (await knex.schema.hasColumn('settings', 'radarKalenderLaender')) {
        const n = await knex('settings')
            .where('radarKalenderLaender', 'USD,JPY')
            .update({ radarKalenderLaender: 'USD,EUR' })
        if (n) console.log(' -> S12: Kalender-Länder von der alten Vorgabe USD,JPY auf USD,EUR umgestellt')
    }
}
