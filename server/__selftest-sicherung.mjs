/**
 * Selbsttest tägliche Sicherung (Audit FUN-BAK-001, 26.10.2026).
 *
 *   node server/__selftest-sicherung.mjs
 *
 * Geprüft wird der reine Teil — Aufbewahrung, Zielordner, Dateinamen — und
 * dass der Export die Portfolio-Geheimnisse redigiert. Keine Datenbank.
 *
 * Was hier still danebengehen würde:
 *   - eine Aufbewahrung, die fremde Dateien im Ordner mitlöscht;
 *   - eine um einen Tag verschobene Grenze (13 oder 15 statt 14 Sicherungen);
 *   - eine Sicherung im Container-Dateisystem, die beim nächsten Image-Update
 *     verschwindet (Vorgabe dort: aus);
 *   - Wallet-Adressen/xpubs und Zugangsschlüssel im Klartext-Export.
 */
import path from 'node:path'
import { zuLoeschen, sicherungsOrdner, dateiName, AUFBEWAHRUNG_TAGE } from './sicherung.js'
import { redigierePortfolio } from './backup-api.js'

let bestanden = 0, fehlgeschlagen = 0
function pruefe(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  ✓ ${name}`) }
    else { fehlgeschlagen++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

console.log('\nAufbewahrung')
{
    const tage = (bis) => Array.from({ length: bis }, (_, i) => new Date(Date.parse('2026-10-26T00:00:00Z') - i * 86400e3).toISOString().slice(0, 10))
    const namen = tage(20).map((d, i) => dateiName(d, i % 2 ? 'sqlite' : 'json'))
    const weg = zuLoeschen([...namen, 'notizen.txt', 'autarktrade-sicherung-kaputt.json.gz', 'autarktrade.db'], '2026-10-26')
    pruefe('Vorgabe 14 Tage', AUFBEWAHRUNG_TAGE === 14)
    pruefe('genau 14 bleiben (heute + 13 Tage zurück)', namen.length - weg.length === 14, `${namen.length - weg.length}`)
    pruefe('die sechs ältesten fallen weg', weg.length === 6 && weg.every((n) => n < dateiName('2026-10-13', 'json')), weg.join(','))
    pruefe('heute bleibt', !weg.some((n) => n.includes('2026-10-26')))
    pruefe('Tag 13 zurück bleibt, Tag 14 zurück geht', !weg.some((n) => n.includes('2026-10-13')) && weg.some((n) => n.includes('2026-10-12')))
    pruefe('fremde Dateien nie', !weg.includes('notizen.txt') && !weg.includes('autarktrade.db') && !weg.includes('autarktrade-sicherung-kaputt.json.gz'))
    pruefe('.tmp eines abgebrochenen Laufs nicht (wird beim nächsten Lauf ersetzt)', zuLoeschen([dateiName('2020-01-01', 'json') + '.tmp'], '2026-10-26').length === 0)
    pruefe('leerer Ordner', zuLoeschen([], '2026-10-26').length === 0)
}

console.log('\nZielordner')
{
    const w = '/opt/autarktrade'
    pruefe('nativ ohne Variable: data/sicherungen im Projekt', sicherungsOrdner({ wert: undefined, container: false, wurzel: w }) === path.join(w, 'data', 'sicherungen'))
    pruefe('Container ohne Variable: aus (kein Volume)', sicherungsOrdner({ wert: undefined, container: true, wurzel: w }) === null)
    pruefe('Container mit Variable: dort', sicherungsOrdner({ wert: '/sicherung', container: true, wurzel: w }) === '/sicherung')
    pruefe('relativ zum Projekt', sicherungsOrdner({ wert: 'backup/x', container: false, wurzel: w }) === path.join(w, 'backup', 'x'))
    pruefe('„aus“ schaltet ab', sicherungsOrdner({ wert: 'aus', container: false, wurzel: w }) === null && sicherungsOrdner({ wert: 'off', container: false, wurzel: w }) === null)
    pruefe('leer = Vorgabe', sicherungsOrdner({ wert: '  ', container: false, wurzel: w }) === path.join(w, 'data', 'sicherungen'))
    pruefe('Dateinamen je Datenbank', dateiName('2026-10-26', 'sqlite') === 'autarktrade-sicherung-2026-10-26.db' && dateiName('2026-10-26', 'json') === 'autarktrade-sicherung-2026-10-26.json.gz')
}

console.log('\nExport redigiert Portfolio-Geheimnisse')
{
    const t = redigierePortfolio({
        portfolio_adressen: [{ id: 1, adresse: 'enc:abc', anzeige: 'zpub6r…ZYs', fingerabdruck: 'f' }, { id: 2, adresse: '' }],
        portfolio_schluessel: [{ name: 'etherscan', wert: 'enc:xyz' }],
        portfolio_bewegungen: [{ id: 1, asset: 'BTC', menge: 1 }],
    })
    pruefe('Adresse/xpub redigiert', t.portfolio_adressen[0].adresse === '[REDACTED]' && t.portfolio_adressen[0].anzeige === 'zpub6r…ZYs')
    pruefe('leere Adresse bleibt leer', t.portfolio_adressen[1].adresse === '')
    pruefe('Zugangsschlüssel redigiert', t.portfolio_schluessel[0].wert === '[REDACTED]')
    pruefe('Bewegungen unverändert', t.portfolio_bewegungen[0].menge === 1)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
process.exit(fehlgeschlagen ? 1 : 0)
