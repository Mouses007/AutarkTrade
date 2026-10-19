/**
 * Selbsttest für Umgebungsvariablen und Testbetrieb.
 *
 *   node server/__selftest-testbetrieb.mjs
 *
 * Warum: die V2-Testinstanz läuft gegen eine Kopie der Live-DB mit echten
 * Börsenschlüsseln und Benachrichtigungskanälen. Startet dort ein einziger
 * Takt, handelt eine Strategie, geht ein Push an das Handy oder bezahlt ein
 * Lagebericht — ohne dass jemand gedrückt hat. Geprüft wird deshalb nicht nur
 * die Schaltfunktion, sondern auch, dass in index.mjs KEIN Takt am Schalter
 * vorbei gestartet wird (ein neuer `startXTakt()` landet sonst still daneben).
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const wurzel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let bestanden = 0
let fehler = 0
function pruefe(name, bedingung, zusatz = '') {
    if (bedingung) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}

for (const k of Object.keys(process.env)) if (/^(AT|CTJ)_/.test(k)) delete process.env[k]

const { umgebung, umgebungAn, istTestbetrieb } = await import('./umgebung.js')
const { starteTakte, versandGesperrt } = await import('./testbetrieb.js')

console.log('Umgebungsvariablen AT_* mit Rückfall CTJ_*')
pruefe('nichts gesetzt → Vorgabe', umgebung('PORT', 8080) === 8080)
process.env.CTJ_PORT = '9000'
pruefe('nur CTJ_ gesetzt → wird gelesen (Altinstallation)', umgebung('PORT') === '9000')
process.env.AT_PORT = '8091'
pruefe('AT_ schlägt CTJ_', umgebung('PORT') === '8091')
process.env.AT_PORT = ''
pruefe('leeres AT_ gilt als nicht gesetzt', umgebung('PORT') === '9000')
delete process.env.AT_PORT; delete process.env.CTJ_PORT
process.env.CTJ_NO_ENGINE = '1'
pruefe('Schalter über CTJ_ wirkt', umgebungAn('NO_ENGINE') === true)
process.env.AT_NO_ENGINE = '0'
pruefe('AT_=0 schaltet einen CTJ_=1 aus', umgebungAn('NO_ENGINE') === false)
delete process.env.AT_NO_ENGINE; delete process.env.CTJ_NO_ENGINE
pruefe('Schalter nur bei genau "1"', (process.env.AT_X = 'ja', umgebungAn('X')) === false)
delete process.env.AT_X

console.log('Testbetrieb')
pruefe('ohne Variable kein Testbetrieb', istTestbetrieb() === false && versandGesperrt() === false)
process.env.AT_TESTBETRIEB = '1'
pruefe('AT_TESTBETRIEB=1 schaltet ein', istTestbetrieb() === true && versandGesperrt() === true)

let aufrufe = []
const takte = [['A', () => aufrufe.push('A')], ['B', () => aufrufe.push('B')]]
let protokoll = ''
let r = starteTakte(takte, { log: (t) => { protokoll += t } })
pruefe('Testbetrieb: kein Takt gestartet', aufrufe.length === 0 && r.gestartet.length === 0)
pruefe('Testbetrieb: alle als „aus" gemeldet', r.aus.join() === 'A,B')
pruefe('Testbetrieb: Protokoll nennt die Takte', protokoll.includes('A, B'), protokoll)
r = starteTakte(takte, { testbetrieb: false, log: () => { } })
pruefe('Normalbetrieb: alle Takte gestartet, in Reihenfolge', aufrufe.join() === 'A,B' && r.aus.length === 0)

console.log('Kein Push im Testbetrieb')
const { stelleZu } = await import('./hype-radar/zustellung.js')
const echterFetch = globalThis.fetch
let abrufe = 0
globalThis.fetch = async () => { abrufe++; return { ok: true, status: 200 } }
const einst = {
    alarmKanaele: {
        ntfy: { an: true, url: 'https://ntfy.example', topic: 't', minSchwere: 'info' },
        telegram: { an: true, chatId: '1', minSchwere: 'info' },
        webhook: { an: true, minSchwere: 'info' },
    },
    schluessel: { telegramToken: 'x', webhookUrl: 'https://hook.example' },
}
const erg = await stelleZu({ regel: 't', schwere: 'kritisch', meldung: 'm' }, { symbol: 'X' }, einst, { alleSchweren: true })
pruefe('Testbetrieb: kein einziger Netzabruf', abrufe === 0, `${abrufe} Abrufe`)
pruefe('Testbetrieb: jeder Kanal meldet die Sperre',
    Object.values(erg).every((v) => /Testbetrieb/.test(v)), JSON.stringify(erg))
delete process.env.AT_TESTBETRIEB
await stelleZu({ regel: 't', schwere: 'kritisch', meldung: 'm' }, { symbol: 'X' }, einst, { alleSchweren: true })
pruefe('Gegenprobe Normalbetrieb: die Kanäle senden', abrufe === 3, `${abrufe} Abrufe`)
globalThis.fetch = echterFetch

console.log('index.mjs startet keinen Takt am Schalter vorbei')
const index = fs.readFileSync(path.join(wurzel, 'index.mjs'), 'utf8')
const nackt = [...index.matchAll(/^\s*(start\w*Takt)\s*\(\s*\)\s*;?\s*$/gm)].map((m) => m[1])
pruefe('kein direkter start…Takt()-Aufruf', nackt.length === 0, nackt.join(', '))
for (const name of ['startNewsTakt', 'startHypeTakt', 'startWachhundTakt', 'startFruehTakt', 'startBoersenTakt',
    'startCoinRadarTakt', 'startErgebnisTakt', 'startAbverkaufTakt', 'startOiArchivTakt', 'startChartAlarmTakt',
    'startBenachrichtigungsTakt', 'startRanglisteTakt']) {
    pruefe(`${name} steht in einer starteTakte-Liste`, new RegExp(`\\[\\s*'[^']+'\\s*,\\s*${name}\\s*\\]`).test(index))
}
pruefe('Strategie-Engine fragt den Testbetrieb', /NO_ENGINE'\)\s*\|\|\s*istTestbetrieb\(\)/.test(index))
const waechter = fs.readFileSync(path.join(wurzel, 'server/execution/stop-waechter.js'), 'utf8')
pruefe('Stop-Wächter fragt den Testbetrieb', /NO_GUARD'\)\s*\|\|\s*istTestbetrieb\(\)/.test(waechter))
const rekorder = fs.readFileSync(path.join(wurzel, 'server/live-recorder.js'), 'utf8')
pruefe('Rekorder fragt den Testbetrieb', /RECORDER_AUS = umgebungAn\('NO_RECORDER'\) \|\| istTestbetrieb\(\)/.test(rekorder))

console.log(`\n${bestanden} bestanden, ${fehler} fehlgeschlagen`)
if (fehler) process.exit(1)
