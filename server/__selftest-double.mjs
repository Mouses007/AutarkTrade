/**
 * Selbsttest PostgreSQL `real` → `double precision` (Audit FUN-DB-001).
 *
 *   node server/__selftest-double.mjs
 *
 * Zwei Dinge: die Spaltenauswahl der Migration (rein, ohne Datenbank) und ein
 * Verbot von `t.float(` im Schema — Knex macht daraus in PostgreSQL `real`
 * (Float32), und genau so kam der Fehler herein. Neue Spalten nur mit `t.double(`.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { realSpalten } from './migrationen/double.js'

let bestanden = 0, fehler = 0
function pruefe(name, ok, zusatz = '') {
    if (ok) { bestanden++; console.log(`  ✓ ${name}`) }
    else { fehler++; console.log(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`) }
}

console.log('\nSpaltenauswahl')
{
    const zeilen = [
        { table_name: 'settings', column_name: 'startBalance', data_type: 'real' },
        { table_name: 'oi_minute', column_name: 'oi', data_type: 'real' },
        { table_name: 'trades', column_name: 'trades', data_type: 'text' },
        { table_name: 'portfolio_bewegungen', column_name: 'menge', data_type: 'double precision' },
        { table_name: 'knex_migrations_lock', column_name: 'x', data_type: 'real' },
        { table_name: 'excursions', column_name: 'maePrice', data_type: 'REAL' },
    ]
    const r = realSpalten(zeilen)
    pruefe('nur real-Spalten', r.length === 3, JSON.stringify(r))
    pruefe('double precision bleibt (idempotent)', !r.some((x) => x.spalte === 'menge'))
    pruefe('Text bleibt', !r.some((x) => x.tabelle === 'trades'))
    pruefe('knex-interne Tabellen bleiben', !r.some((x) => x.tabelle.startsWith('knex_')))
    pruefe('Gross/Klein des Typs egal', r.some((x) => x.tabelle === 'excursions' && x.spalte === 'maePrice'))
    pruefe('sortiert, gleiche Reihenfolge je Lauf', r.map((x) => x.tabelle).join() === 'excursions,oi_minute,settings')
    pruefe('nach der Migration nichts mehr zu tun', realSpalten(zeilen.map((z) => ({ ...z, data_type: z.data_type.toLowerCase() === 'real' ? 'double precision' : z.data_type }))).length === 0)
    pruefe('leere Eingabe', realSpalten([]).length === 0 && realSpalten(null).length === 0)
}

console.log('\nKein t.float( im Schema')
{
    const wurzel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    const treffer = []
    const durch = (ordner) => {
        for (const e of fs.readdirSync(ordner, { withFileTypes: true })) {
            if (e.name === 'node_modules' || e.name.startsWith('.')) continue
            const p = path.join(ordner, e.name)
            if (e.isDirectory()) durch(p)
            else if (/\.(js|mjs)$/.test(e.name) && !e.name.startsWith('__selftest')) {
                fs.readFileSync(p, 'utf8').split('\n').forEach((z, i) => {
                    if (/\bt\.float\s*\(/.test(z) && !/^\s*(\*|\/\/)/.test(z)) treffer.push(`${path.relative(wurzel, p)}:${i + 1}`)
                })
            }
        }
    }
    durch(path.join(wurzel, 'server'))
    pruefe('server/** ohne t.float(', treffer.length === 0, treffer.join(', '))
    const db = fs.readFileSync(path.join(wurzel, 'server', 'database.js'), 'utf8')
    pruefe('database.js ruft die Migration', /await migriereDouble\(knex\)/.test(db))
}

console.log(`\n${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler ? 1 : 0)
