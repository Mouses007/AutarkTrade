/**
 * Sparte eines Titels (Sektor und Branche), der Teil ohne Netz: wann gilt die
 * Angabe der Kursquelle als sicher, wann ist sie zu erneuern.
 *
 * Die Zuordnung Titel → Kurssymbol ist der wunde Punkt (Audit FUN-F-002:
 * `BYDUSDT` wurde als Boyd Gaming gelesen). Eine Sparte erbt diesen Fehler —
 * deshalb wird sie nur gemerkt und nur gezeigt, wenn ALLES zutrifft:
 *
 *   1. es gibt ein Kurssymbol (`kursSymbolFuer`: kein Rückfall auf den blossen
 *      Ticker bei fremder Region oder nach «kein Treffer»)
 *   2. die Quelle führt das Symbol als Aktie (`EQUITY`) und nennt einen Sektor
 *   3. kennt der Stamm einen Namen, passt er zum Namen der Quelle
 *      (`nameAehnlich`) — auch bei einem Future, dessen Ticker sonst gegen den
 *      Namen gilt (RAS-01): dort ist offen, WELCHE Firma gemeint ist, und
 *      «unbekannt» ist besser als die Sparte der falschen
 *   4. beim Lesen: die gemerkte Sparte gehört zum Kurssymbol, das HEUTE gilt
 *      (`sparteSymbol`) — wechselt die Zuordnung, ist die Sparte wieder unbekannt
 *
 * Alles andere bleibt `null` = unbekannt.
 */
import { nameAehnlich } from '../newcomer-radar/kursquelle-kern.js'

/** Eine gemerkte Sparte gilt so lange; Firmen wechseln sie fast nie. */
export const SPARTE_FRISCH_MS = 90 * 24 * 60 * 60_000
/** Blieb sie unbekannt, wird frühestens nach dieser Zeit wieder gefragt. */
export const SPARTE_WIEDER_MS = 7 * 24 * 60 * 60_000

/**
 * Sparte aus den gelesenen Stammdaten der Kursquelle.
 *
 * @param {{name?: string|null, art?: string|null, sektor?: string|null, branche?: string|null}|null} profil
 *        `profil` aus `ausZusammenfassung` (`server/aktien/titel-kern.js`)
 * @param {string|null} stammName  Name des Titels im Stamm (kann fehlen: Titel nur an Krypto-Börsen)
 * @param {string} ticker
 * @returns {{ok: true, sektor: string, branche: string|null}|{ok: false, grund: string}}
 *          Gründe: `keinProfil`, `keineAktie`, `ohneAngabe`, `nameWiderspruch`
 */
export function sparteAus(profil, stammName, ticker) {
    if (!profil) return { ok: false, grund: 'keinProfil' }
    if (profil.art && profil.art !== 'EQUITY') return { ok: false, grund: 'keineAktie' }
    if (!profil.sektor) return { ok: false, grund: 'ohneAngabe' }
    if (stammName && profil.name && !nameAehnlich(stammName, profil.name, ticker)) return { ok: false, grund: 'nameWiderspruch' }
    return { ok: true, sektor: profil.sektor, branche: profil.branche || null }
}

/**
 * Die Sparte, die für diesen Titel HEUTE gilt, oder `null` (unbekannt).
 * @param {{sektor?: string|null, branche?: string|null, sparteSymbol?: string|null}} zeile  Zeile aus `instrumente`
 * @param {string|null} kursSymbol  das Kurssymbol, das jetzt gilt (`kursSymbolFuer`)
 */
export function sparteGilt(zeile, kursSymbol) {
    if (!zeile?.sektor || !kursSymbol || zeile.sparteSymbol !== kursSymbol) return null
    return { sektor: zeile.sektor, branche: zeile.branche || null }
}

/**
 * Soll die Kursquelle für diesen Titel (wieder) nach der Sparte gefragt werden?
 * Ohne Kurssymbol nie — dann gibt es nichts, wonach sich fragen liesse.
 */
export function brauchtSparte(zeile, kursSymbol, jetzt = Date.now()) {
    if (!kursSymbol) return false
    const stand = Number(zeile?.sparteStand) || 0
    if (!stand || zeile.sparteSymbol !== kursSymbol) return true
    return jetzt - stand > (zeile.sektor ? SPARTE_FRISCH_MS : SPARTE_WIEDER_MS)
}

/** Was nach einem Abruf in `instrumente` steht — auch ein «unbekannt» wird mit Zeit und Symbol gemerkt. */
export function sparteZeile(ergebnis, kursSymbol, jetzt = Date.now()) {
    return {
        sektor: ergebnis.ok ? ergebnis.sektor : null,
        branche: ergebnis.ok ? ergebnis.branche : null,
        sparteSymbol: kursSymbol,
        sparteStand: jetzt,
    }
}
