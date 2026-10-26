#!/usr/bin/env node
/**
 * Konsistente Sicherung einer SQLite-Datenbank, auch während der Server läuft.
 *
 *   node scripts/sqlite-sicherung.mjs <quelle.db> <ziel>
 *
 * Für update.bat (Audit SEC-OPS-015): ein `copy` der Datei allein verliert im
 * WAL-Modus alles, was noch in `-wal` steht, und kann eine halb geschriebene
 * Seite erwischen. `VACUUM INTO` liest über SQLite selbst einen festen Stand
 * (inklusive WAL) und schreibt ihn als eine geschlossene Datei. Ein vorhandenes
 * Ziel wird ersetzt. Exit 1 bei einem Fehler — dann bricht das Update ab.
 */
import fs from 'node:fs'
import Database from 'better-sqlite3'

const [quelle, ziel] = process.argv.slice(2)
if (!quelle || !ziel) {
    console.error('Aufruf: node scripts/sqlite-sicherung.mjs <quelle.db> <ziel>')
    process.exit(2)
}
try {
    const neu = ziel + '.neu'
    fs.rmSync(neu, { force: true })
    const db = new Database(quelle, { readonly: true, fileMustExist: true })
    try {
        db.prepare('VACUUM INTO ?').run(neu)
    } finally {
        db.close()
    }
    fs.renameSync(neu, ziel)
} catch (e) {
    console.error('Sicherung fehlgeschlagen: ' + e.message)
    process.exit(1)
}
