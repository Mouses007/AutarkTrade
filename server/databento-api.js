/**
 * Databento-Proxy und gespeicherte Kerzen-Schlüssel (Audit SEC-WEB-006, 26.10.2026).
 *
 *   POST /api/databento   { dataset, stype_in, symbols, schema, start, end, … }  → CSV
 *
 * Bis dahin gingen die Polygon- und Databento-Schlüssel aus `settings.apis`
 * ENTSCHLÜSSELT an jede Sitzung, weil der Browser Databento selbst aufrief
 * und den Polygon-Schlüssel als Kopf an `/api/polygon/aggs` weiterreichte.
 * Damit standen sie in DevTools, für Browser-Erweiterungen und für jede
 * künftige XSS offen. Jetzt bleiben sie auf dem Server: die Sitzung bekommt
 * nur `keySet`, und beide Abrufe laufen hier mit dem gespeicherten Schlüssel.
 *
 * Nebenbei: die Exkursionen schickten den Rumpf schon an `/api/databento` —
 * eine Route, die es nicht gab. Databento lief also nur im (unbenutzten)
 * `api`-Modus, direkt aus dem Browser.
 */
import { getKnex } from './database.js'
import { decrypt, isEncrypted } from './crypto.js'

const DATABENTO_URL = 'https://hist.databento.com/v0/timeseries.get_range'
const ZEITLIMIT_MS = 60_000
const MAX_BYTES = 50 * 1024 * 1024

/**
 * Gespeicherten Schlüssel eines Kerzen-Anbieters aus `settings.apis` lesen
 * (entschlüsselt). Leer, wenn keiner da ist.
 *
 * @param {'polygon'|'databento'} anbieter
 * @returns {Promise<string>}
 */
export async function gespeicherterApiSchluessel(anbieter) {
    const row = await getKnex()('settings').where('id', 1).select('apis').first()
    let liste = []
    try { liste = typeof row?.apis === 'string' ? JSON.parse(row.apis || '[]') : (row?.apis || []) } catch { liste = [] }
    const eintrag = Array.isArray(liste) ? liste.find((a) => a?.provider === anbieter && a.key) : null
    if (!eintrag) return ''
    const k = String(eintrag.key)
    return isEncrypted(k) ? (decrypt(k) || '') : k
}

const DATASETS = ['GLBX.MDP3', 'XNAS.ITCH']
const STYPES = ['continuous', 'raw_symbol']

/**
 * Rumpf aus dem Browser prüfen und in genau die Felder übersetzen, die an
 * Databento gehen (rein). Nichts aus dem Browser geht ungeprüft weiter —
 * insbesondere kein `username` (das war der Schlüssel).
 *
 * @returns {{fehler?: string, felder?: Record<string,string>}}
 */
export function pruefeDatabentoRumpf(roh) {
    const r = roh || {}
    const dataset = String(r.dataset || '')
    if (!DATASETS.includes(dataset)) return { fehler: 'Datensatz fehlt oder unbekannt (nur Futures und Aktien)' }
    const stype = String(r.stype_in || '')
    if (!STYPES.includes(stype)) return { fehler: 'stype_in ungültig' }
    const symbols = String(r.symbols || '')
    if (!/^[A-Za-z0-9._/-]{1,40}$/.test(symbols)) return { fehler: 'symbols ungültig' }
    if (String(r.schema || '') !== 'ohlcv-1m') return { fehler: 'schema ungültig' }
    const zahl = (v) => {
        const s = typeof v === 'number' ? v.toLocaleString('fullwide', { useGrouping: false }) : String(v ?? '')
        return /^\d{1,20}$/.test(s) ? s : null
    }
    const start = zahl(r.start)
    const end = zahl(r.end)
    if (!start || !end) return { fehler: 'start/end ungültig' }
    return {
        felder: {
            dataset, stype_in: stype, symbols, schema: 'ohlcv-1m', start, end,
            encoding: 'csv', pretty_px: 'true', pretty_ts: 'true', map_symbols: 'true',
        },
    }
}

export function setupDatabentoRoutes(app) {
    app.post('/api/databento', async (req, res) => {
        try {
            const { fehler, felder } = pruefeDatabentoRumpf(req.body)
            if (fehler) return res.status(400).json({ error: fehler })
            const schluessel = await gespeicherterApiSchluessel('databento')
            if (!schluessel) return res.status(400).json({ error: 'Databento-Schlüssel fehlt (Einstellungen)' })
            const antwort = await fetch(DATABENTO_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    Authorization: 'Basic ' + Buffer.from(schluessel + ':').toString('base64'),
                },
                body: new URLSearchParams(felder).toString(),
                signal: AbortSignal.timeout(ZEITLIMIT_MS),
                redirect: 'error',
            })
            const text = await antwort.text()
            if (!antwort.ok) {
                // Databentos eigene Meldung hilft dem Nutzer; sie enthält den Schlüssel nicht.
                let meldung = ''
                try { meldung = JSON.parse(text)?.detail || '' } catch { meldung = '' }
                return res.status(antwort.status >= 500 ? 502 : antwort.status)
                    .json({ error: String(meldung || `Databento: HTTP ${antwort.status}`).slice(0, 300) })
            }
            if (text.length > MAX_BYTES) return res.status(502).json({ error: 'Databento-Antwort zu gross' })
            res.type('text/csv').send(text)
        } catch (e) {
            const zeit = e?.name === 'TimeoutError' || e?.name === 'AbortError'
            res.status(zeit ? 504 : 502).json({ error: zeit ? 'Databento antwortet nicht' : 'Databento nicht erreichbar' })
        }
    })
}
