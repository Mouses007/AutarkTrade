/**
 * Welche Symbole der Journal-Börsen sind Aktien? (Phase 7, Aktien im Journal)
 *
 *   GET /api/aktien/journal-symbole  →  { ok, symbole: { bitunix: [...], bitget: [...], pionex: [...] } | null }
 *
 * Der Import (`src/utils/quickImport.js`) fragt das einmal je Lauf und
 * vermerkt an jedem neuen Trade die Anlageklasse; der Journal-Filter ordnet
 * damit auch alte Trades ein (`shared/anlageklasse.js`). Nur Datenbank, kein
 * Netz. Auch gestrichene Listungen (`aktiv = 0`) zählen: ein Trade von
 * damals bleibt eine Aktie.
 *
 * `symbole: null` heisst «Stamm leer, nichts bekannt» — der Import schreibt
 * dann KEINE Anlageklasse, statt alles als Krypto festzuhalten.
 */
import { getKnex } from '../database.js'

/** Börsen, deren Trades im Journal landen. */
export const JOURNAL_BOERSEN = ['bitunix', 'bitget', 'pionex']

/** Zeilen `{handelsplatz, symbol}` → `{bitunix: [...], …}`; ohne Zeilen `null`. Rein. */
export function ordneNachBoerse(zeilen) {
    if (!Array.isArray(zeilen) || !zeilen.length) return null
    const aus = Object.fromEntries(JOURNAL_BOERSEN.map((b) => [b, []]))
    for (const z of zeilen) {
        if (!aus[z.handelsplatz] || !z.symbol) continue
        const s = String(z.symbol).toUpperCase()
        if (!aus[z.handelsplatz].includes(s)) aus[z.handelsplatz].push(s)
    }
    for (const b of JOURNAL_BOERSEN) aus[b].sort()
    return aus
}

export async function journalAktienSymbole(knex) {
    if (!(await knex.schema.hasTable('instrument_listungen'))) return null
    const zeilen = await knex('instrument_listungen as l').join('instrumente as i', 'i.id', 'l.instrumentId')
        .where('i.anlageklasse', 'aktien').whereIn('l.handelsplatz', JOURNAL_BOERSEN)
        .select('l.handelsplatz', 'l.symbol')
    return ordneNachBoerse(zeilen)
}

export function setupAktienJournalRoutes(app) {
    app.get('/api/aktien/journal-symbole', async (req, res) => {
        try {
            res.json({ ok: true, symbole: await journalAktienSymbole(getKnex()) })
        } catch (e) {
            res.status(500).json({ ok: false, error: String(e?.message || e) })
        }
    })
}
