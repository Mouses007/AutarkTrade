/**
 * Titel-Seite, der Teil ohne Netz: den Titel im Stamm finden, sein Symbol bei
 * der Kursquelle bestimmen, Namen von Stamm und Quelle vergleichen. Getrennt
 * von `api.js`, damit der Selbsttest ohne Schlüsseldatei und KI-Schicht läuft.
 */
import { leseStamm } from './stamm-speicher.js'
import { kursSymbolFuer, nameAehnlich } from '../newcomer-radar/kursquelle-kern.js'

/** Titel des Stamms samt Listungen und dem Symbol bei der Kursquelle. */
export async function ladeTitel(knex, ticker) {
    const zeile = await knex('instrumente').where({ anlageklasse: 'aktien', ticker }).first()
    if (!zeile) return null
    // Genau dieser Ticker, nicht die Suche: «V» steht in Hunderten von Firmennamen (Audit DB-D-001).
    const [titel] = await leseStamm(knex, { anlageklasse: 'aktien', ticker })
    const gemerkt = (await knex.schema.hasTable('newcomer_titel'))
        ? await knex('newcomer_titel').where('instrumentId', zeile.id).first('kursSymbol', 'zuordnung') : null
    // Kein Rückfall auf den blossen Ticker, wenn der Newcomer-Lauf nichts fand oder der Titel eine fremde Region trägt.
    // `zuordnung` sagt der Seite, ob der erste Handel der Kursquelle der Börsengang ist (FUN-F-014).
    return {
        titel: titel || { ticker, name: zeile.name, unterart: zeile.unterart, listungen: [] },
        kursSymbol: kursSymbolFuer(zeile, gemerkt || null), zuordnung: gemerkt?.zuordnung || null,
    }
}

/**
 * Passt der Name, den die Kursquelle liefert, zum Namen im Stamm? `null` =
 * kein Widerspruch (oder einer der Namen fehlt), sonst der Name der Quelle —
 * die Seite warnt dann, dass die Zahlen einer anderen Firma gehören könnten.
 */
export function namensWarnung(stammName, quellenName, ticker) {
    if (!stammName || !quellenName) return null
    return nameAehnlich(stammName, quellenName, ticker) ? null : String(quellenName).slice(0, 120)
}
