/**
 * Selbsttest: was beim Abmelden aus dem localStorage geht (Audit SEC-WEB-005).
 *
 *   node src/utils/__selftest-finanz-speicher.mjs
 *
 * Positions- und Kontodaten gehen, Einstellungen (Layout, Filter, Sprache)
 * bleiben.
 */

import { loescheFinanzdaten, istFinanzSchluessel } from './finanzSpeicher.js'

let bestanden = 0
let fehlgeschlagen = 0

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

/** Minimaler Storage-Ersatz mit `length`/`key`/`removeItem` wie im Browser. */
class Speicher {
    constructor(o) { this.m = new Map(Object.entries(o)) }
    get length() { return this.m.size }
    key(i) { return [...this.m.keys()][i] ?? null }
    getItem(k) { return this.m.has(k) ? this.m.get(k) : null }
    removeItem(k) { this.m.delete(k) }
    setItem(k, v) { this.m.set(k, String(v)) }
}

const s = new Speicher({
    tpsl_history_123: '[{"type":"SL"}]',
    tpsl_history_456: '[]',
    chartKiMarken: '{}',
    positionsWarnungWeg: '["1|ohneSl"]',
    'at.journal.konten': 'bitunix,bitget',
    dashboard_hidden_cards: '[]',
    appLanguage: 'de',
    privacyMode: '1',
    'ctj.chart.positionenAus': '["9"]',
    chartTeilenAn: 'kollege@example.org',
    'at.chart.zeichenStil': JSON.stringify({
        position: { farbe: '#0f0', rechner: { modus: 'risiko', betrag: 1.5, einheit: 'prozent', hebel: 20, konto: 48250, gebuehrPct: 0.06 } },
        trendlinie: { farbe: '#ff0', breite: 3 },
    }),
})
const weg = loescheFinanzdaten(s)
check('fünf Schlüssel gelöscht, einer bereinigt', weg.length === 6, weg.join(','))
check('tpsl_history_* weg', s.getItem('tpsl_history_123') === null && s.getItem('tpsl_history_456') === null)
check('chartKiMarken weg', s.getItem('chartKiMarken') === null)
check('positionsWarnungWeg weg', s.getItem('positionsWarnungWeg') === null)
check('Filter bleibt', s.getItem('at.journal.konten') === 'bitunix,bitget')
check('Layout bleibt', s.getItem('dashboard_hidden_cards') === '[]')
check('Sprache und Sichtschutz bleiben', s.getItem('appLanguage') === 'de' && s.getItem('privacyMode') === '1')
check('ausgeblendete Positions-IDs bleiben', s.getItem('ctj.chart.positionenAus') === '["9"]')
check('Mail-Empfänger des Teilen-Dialogs weg (SEC-S6-001)', s.getItem('chartTeilenAn') === null)
{
    const stil = JSON.parse(s.getItem('at.chart.zeichenStil') || '{}')
    check('Kontostand des Positionsrechners weg (SEC-S6-001)', stil.position?.rechner && !('konto' in stil.position.rechner), JSON.stringify(stil.position))
    check('Rechner-Vorgabe und Stil bleiben', stil.position.rechner.hebel === 20 && stil.position.rechner.modus === 'risiko'
        && stil.position.farbe === '#0f0' && stil.trendlinie.breite === 3)
    const ohne = new Speicher({ 'at.chart.zeichenStil': '{"trendlinie":{"farbe":"#ff0"}}' })
    check('Stil ohne Kontostand wird nicht angefasst', loescheFinanzdaten(ohne).length === 0)
}
check('nur Präfix, nicht Teilstring', !istFinanzSchluessel('alt_tpsl_history_1'))
check('ohne Speicher kein Absturz', Array.isArray(loescheFinanzdaten(undefined)))

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) process.exit(1)
