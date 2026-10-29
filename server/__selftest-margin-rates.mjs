/**
 * Selbsttest: Wartungsmargen-Parser (`margin-rates.js`).
 *
 * Läuft ohne Netz — geprüft wird, ob aus den beiden Antwortformaten die
 * richtige STUFE gezogen wird, und welche Börse je Stand des Schalters
 * „Quellen mit eingeschränkten Nutzungsbedingungen" überhaupt gefragt wird (S15; axios ist
 * dafür attrappiert). Genau das ist die Stelle, an der ein Fehler
 * nicht auffällt: eine Rate aus Stufe 3 sieht aus wie eine gültige Zahl, und
 * die Karte zeichnet damit anstandslos Zonen an der falschen Stelle.
 *
 * Die Beispieldaten sind gekürzte Antworten vom 17.08.2026.
 *
 * Aufruf: node server/__selftest-margin-rates.mjs
 */
import { readFileSync } from 'node:fs'
import axios from 'axios'
import { parseBinanceKlammern, parseBybitRisikolimit, holeMarginRate, MMR_VORGABE } from './margin-rates.js'
import { _setzeLeser } from './quellen/freigabe.js'
import { BAPI_KLAMMERN_URL } from './marktdaten/binance.js'

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

// ── Binance ────────────────────────────────────────────────────────────
const binanceRoh = {
    data: {
        brackets: [
            {
                symbol: 'BTCUSDT',
                riskBrackets: [
                    { bracketSeq: 1, bracketNotionalFloor: 0, bracketNotionalCap: 300000, bracketMaintenanceMarginRate: 0.004, maxOpenPosLeverage: 150 },
                    { bracketSeq: 2, bracketNotionalFloor: 300000, bracketNotionalCap: 4000000, bracketMaintenanceMarginRate: 0.005, maxOpenPosLeverage: 100 },
                ],
            },
            {
                // Umgekehrte Reihenfolge: die Nummer ist Anzeige, die
                // Untergrenze ist die Aussage.
                symbol: 'WIFUSDT',
                riskBrackets: [
                    { bracketSeq: 2, bracketNotionalFloor: 5000, bracketNotionalCap: 25000, bracketMaintenanceMarginRate: 0.025, maxOpenPosLeverage: 50 },
                    { bracketSeq: 1, bracketNotionalFloor: 0, bracketNotionalCap: 5000, bracketMaintenanceMarginRate: 0.01, maxOpenPosLeverage: 75 },
                ],
            },
            // Unbrauchbar: keine Stufe mit Untergrenze 0
            { symbol: 'KAPUTTUSDT', riskBrackets: [{ bracketSeq: 2, bracketNotionalFloor: 1000, bracketNotionalCap: 5000, bracketMaintenanceMarginRate: 0.02 }] },
            // Unbrauchbar: Rate 0
            { symbol: 'NULLUSDT', riskBrackets: [{ bracketSeq: 1, bracketNotionalFloor: 0, bracketNotionalCap: 5000, bracketMaintenanceMarginRate: 0 }] },
        ],
    },
}

const tabelle = parseBinanceKlammern(binanceRoh)
pruefe('BTC nimmt Stufe 1', tabelle.get('BTCUSDT')?.mmr === 0.004, `bekam ${tabelle.get('BTCUSDT')?.mmr}`)
pruefe('BTC-Obergrenze', tabelle.get('BTCUSDT')?.obergrenze === 300000)
pruefe('BTC-Stufenzahl', tabelle.get('BTCUSDT')?.stufen === 2)
pruefe('WIF trotz verdrehter Reihenfolge', tabelle.get('WIFUSDT')?.mmr === 0.01, `bekam ${tabelle.get('WIFUSDT')?.mmr}`)
pruefe('Symbol ohne Stufe 1 fällt raus', !tabelle.has('KAPUTTUSDT'))
pruefe('Rate 0 fällt raus', !tabelle.has('NULLUSDT'))
pruefe('Leere Antwort ergibt leere Tabelle', parseBinanceKlammern({}).size === 0)
pruefe('null ergibt leere Tabelle', parseBinanceKlammern(null).size === 0)

// ── Volle Klammerliste (seit 31.08.2026 nicht mehr verworfen) ──────────
{
    const btc = tabelle.get('BTCUSDT')
    pruefe('Klammerliste ist vollständig', btc?.klammern?.length === 2,
        `bekam ${btc?.klammern?.length}`)
    pruefe('Klammern sind nach Untergrenze sortiert',
        btc?.klammern[0].floor === 0 && btc?.klammern[1].floor === 300000)
    pruefe('Klammer trägt mmr und maxHebel je Stufe',
        btc?.klammern[1].mmr === 0.005 && btc?.klammern[1].maxHebel === 100)
    const wif = tabelle.get('WIFUSDT')
    pruefe('verdrehte Reihenfolge wird in den Klammern geradegezogen',
        wif?.klammern[0].floor === 0 && wif?.klammern[0].mmr === 0.01)
    pruefe('fehlendes cum wird 0, nicht NaN',
        btc?.klammern.every(k => Number.isFinite(k.cum)))
}

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

// ── Die beiden Börsen sind NICHT austauschbar ──────────────────────────
// Steht hier als Merkposten: wer hier später mitteln will, bricht diesen Test.
pruefe('Binance und Bybit weichen bei BTC ab', tabelle.get('BTCUSDT').mmr !== 0.005)
pruefe('Vorgabe bleibt 0,004', MMR_VORGABE === 0.004)

// ── Keine Binance-Adresse in margin-rates.js (S12-Regel bleibt) ─────────
// Die bapi-Adresse steht in `server/marktdaten/binance.js`.
const quelle = readFileSync(new URL('./margin-rates.js', import.meta.url), 'utf8')
pruefe('keine Binance-Adresse in margin-rates.js', !/https?:\/\/[^'"`]*binance\.com/.test(quelle))

// ── Schalter „Quellen mit eingeschränkten Nutzungsbedingungen" (S15) ──────────────────────
// axios attrappieren: jede Anfrage wird mitgeschrieben, bapi und Bybit
// antworten mit den Beispielen oben. Die DB fehlt — der Persist ist weich.
const abrufe = []
axios.get = async (url) => {
    abrufe.push(url)
    if (url === BAPI_KLAMMERN_URL) return { data: binanceRoh }
    if (url.includes('bybit.com')) return { data: bybitRoh }
    throw new Error('unerwartete Adresse ' + url)
}

// AUS: Binance wird NIE gefragt, auch nicht auf Wunsch (Stand S12).
_setzeLeser(async () => false)
{
    abrufe.length = 0
    const r = await holeMarginRate('BTCUSDT')
    pruefe('aus: ohne Wunsch kommt Bybit', r?.quelle === 'bybit' && r?.ersatz === false, JSON.stringify(r))
    const w = await holeMarginRate('ETHUSDT', 'binance')
    pruefe('aus: Wunsch binance wird von Bybit bedient und als Ersatz markiert', w?.quelle === 'bybit' && w?.ersatz === true && w?.gewuenscht === 'binance')
    pruefe('aus: kein bapi-Abruf', !abrufe.includes(BAPI_KLAMMERN_URL), abrufe.join(', '))
}

// AN: wie vor S12 — Binance zuerst, Bybit nur als Ersatz.
_setzeLeser(async () => true)
{
    abrufe.length = 0
    const r = await holeMarginRate('BTCUSDT')
    pruefe('an: ohne Wunsch kommt Binance (wie vor S12)', r?.quelle === 'binance' && r?.mmr === 0.004 && r?.ersatz === false, JSON.stringify(r))
    pruefe('an: genau ein bapi-Abruf', abrufe.filter(u => u === BAPI_KLAMMERN_URL).length === 1, abrufe.join(', '))
    pruefe('an: Klammern mit cum/maxHebel', r?.klammern?.length === 2)
    const b = await holeMarginRate('BTCUSDT', 'bybit')
    pruefe('an: Wunsch bybit bleibt Bybit', b?.quelle === 'bybit' && b?.ersatz === false)
    // Symbol, das Binance nicht kennt → Bybit als Ersatz
    const e = await holeMarginRate('SOLUSDT', 'binance')
    pruefe('an: unbekannt bei Binance → Bybit als Ersatz', e?.quelle === 'bybit' && e?.ersatz === true)
    pruefe('an: Tabelle gecacht (kein zweiter bapi-Abruf)', abrufe.filter(u => u === BAPI_KLAMMERN_URL).length === 1)
}

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
if (fehler) process.exit(1)
