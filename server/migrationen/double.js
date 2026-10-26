/**
 * PostgreSQL: `real` → `double precision` (Audit FUN-DB-001, 26.10.2026).
 *
 * Knex macht aus `t.float()` in PostgreSQL `real` — 4 Byte, rund 7 gültige
 * Stellen (`pg-columncompiler.js`: `floating = 'real'`). SQLite speichert
 * dieselbe Spalte als 8-Byte-Double. Die NAS läuft auf PostgreSQL: Mengen über
 * 16,7 Mio. Einheiten, Salden ab 1 Mio. und Preise mit mehr als 7 Stellen wurden
 * dort gerundet (123456789 → 123456792), SQLite- und PG-Installationen
 * rechneten verschieden. Das Schema schreibt seitdem `t.double()`; diese
 * Migration hebt bestehende Spalten an.
 *
 * Verlustfrei (jedes `real` ist als `double precision` exakt darstellbar; die
 * schon verlorenen Stellen kommen nicht zurück). Idempotent: gelesen wird
 * `information_schema.columns`, umgestellt nur, was noch `real` ist. Nur
 * PostgreSQL — SQLite kennt den Unterschied nicht. Ohne SCHEMA_VERSION: ein
 * älterer Codestand liest `double precision` genauso wie `real`.
 *
 * Achtung Laufzeit: `ALTER COLUMN … TYPE` schreibt die Tabelle neu und sperrt
 * sie so lange (einmalig, beim ersten Start mit diesem Stand; `oi_minute` ist
 * die grösste). Ein Fehler bei einer Spalte bricht den Start nicht ab.
 */

/**
 * Welche Spalten sind umzustellen? (rein)
 * @param {Array<{table_name, column_name, data_type}>} zeilen  aus information_schema.columns
 * @returns {Array<{tabelle, spalte}>}
 */
export function realSpalten(zeilen) {
    return (zeilen || [])
        .filter((z) => String(z.data_type).toLowerCase() === 'real')
        // Interne Tabellen von knex (Migrations-Sperre) gehören nicht dazu.
        .filter((z) => !String(z.table_name).startsWith('knex_'))
        .map((z) => ({ tabelle: String(z.table_name), spalte: String(z.column_name) }))
        .sort((a, b) => a.tabelle.localeCompare(b.tabelle) || a.spalte.localeCompare(b.spalte))
}

export async function migriereDouble(knex) {
    if (knex.client.config.client !== 'pg') return
    let zeilen
    try {
        zeilen = (await knex('information_schema.columns')
            .whereRaw('table_schema = current_schema()')
            .andWhere('data_type', 'real')
            .select('table_name', 'column_name', 'data_type'))
    } catch (e) {
        console.warn(' -> FUN-DB-001: Spaltentypen nicht lesbar:', e.message)
        return
    }
    const liste = realSpalten(zeilen)
    if (!liste.length) return
    console.log(` -> PostgreSQL: ${liste.length} Spalten real → double precision (einmalig, verlustfrei)`)
    for (const { tabelle, spalte } of liste) {
        try {
            await knex.raw('ALTER TABLE ?? ALTER COLUMN ?? TYPE double precision', [tabelle, spalte])
        } catch (e) {
            console.warn(` -> ${tabelle}.${spalte} nicht umgestellt:`, e.message)
        }
    }
}
