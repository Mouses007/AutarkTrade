/**
 * Selbsttest: Wartungsmargen-Parser (`margin-rates.js`).
 *
 * Läuft ohne Netz — geprüft wird nur, ob aus dem Bybit-Antwortformat die
 * richtige STUFE gezogen wird. Genau das ist die Stelle, an der ein Fehler
 * nicht auffällt: eine Rate aus Stufe 3 sieht aus wie eine gültige Zahl, und
 * die Karte zeichnet damit anstandslos Zonen an der falschen Stelle.
 *
 * Die Beispieldaten sind gekürzte Antworten vom 17.08.2026.
 *
 * Aufruf: node server/__selftest-margin-rates.mjs
 */
import { readFileSync } from 'node:fs'
import { parseBybitRisikolimit, MMR_VORGABE } from './margin-rates.js'

let fehler = 0
// Auch die bestandenen zählen: `scripts/run-selftests.mjs` liest das Zahlenpaar
// aus der Schlussmeldung. Ohne es zählte die ganze Datei als EINE Prüfung.
let bestanden = 0
const pruefe = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}

console.log('Wartungsmargen-Parser')

// ── Bybit ──────────────────────────────────────────────────────────────
const bybitRoh = {
    result: {
        list: [
            { symbol: 'SOLUSDT', riskLimitValue: '100000', maintenanceMargin: '0.0056', maxLeverage: '90.00', isLowestRisk: 0 },
            { symbol: 'SOLUSDT', riskLimitValue: '50000', maintenanceMargin: '0.005', maxLeverage: '100.00', isLowestRisk: 1 },
        ],
    },
}
const sol = parseBybitRisikolimit(bybitRoh)
pruefe('Bybit nimmt die markierte Stufe 1', sol?.mmr === 0.005, `bekam ${sol?.mmr}`)
pruefe('Bybit-Obergrenze', sol?.obergrenze === 50000)
pruefe('Bybit-Stufenzahl', sol?.stufen === 2)
pruefe('Bybit-Maxhebel', sol?.maxHebel === 100)

// Ohne Markierung gilt die kleinste Obergrenze — nicht die erste Zeile.
const ohneMarkierung = parseBybitRisikolimit({
    result: {
        list: [
            { riskLimitValue: '200000', maintenanceMargin: '0.02' },
            { riskLimitValue: '20000', maintenanceMargin: '0.01' },
        ],
    },
})
pruefe('Ohne isLowestRisk zählt die kleinste Grenze', ohneMarkierung?.mmr === 0.01, `bekam ${ohneMarkierung?.mmr}`)

pruefe('Leere Liste ergibt null', parseBybitRisikolimit({ result: { list: [] } }) === null)
pruefe('Fehlende Antwort ergibt null', parseBybitRisikolimit(null) === null)
pruefe('Rate 0 ergibt null', parseBybitRisikolimit({ result: { list: [{ riskLimitValue: '1', maintenanceMargin: '0', isLowestRisk: 1 }] } }) === null)

// ── Binance-Klammern sind entfernt (S12, Verkaufs-Prüfung Zeile 34) ─────
// Der undokumentierte `bapi`-Endpunkt ist rot; er darf nicht zurückkehren.
const quelle = readFileSync(new URL('./margin-rates.js', import.meta.url), 'utf8')
pruefe('kein Binance-bapi-Abruf mehr', !/https?:\/\/[^'"`]*binance\.com/.test(quelle))
pruefe('Vorgabe bleibt 0,004', MMR_VORGABE === 0.004)

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
if (fehler) process.exit(1)
