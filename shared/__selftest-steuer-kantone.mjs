/**
 * Selbsttest Kantonsdaten (shared/steuer-kantone.js): vollständig, keine
 * erfundenen Codes, Quellen vorhanden, Sonderfälle wie recherchiert.
 */
import { KANTONE, kanton, kaufpreisErlaubt, haltedauerMonate, ERSATZKURS_TEXT, MINING_TEXT } from './steuer-kantone.js'

let ok = 0, fail = 0
const pruefe = (name, bed, d = '') => { if (bed) ok++; else { fail++; console.error('✗', name, d) } }

const ALLE = ['ZH', 'BE', 'LU', 'UR', 'SZ', 'OW', 'NW', 'GL', 'ZG', 'FR', 'SO', 'BS', 'BL', 'SH', 'AR', 'AI', 'SG', 'GR', 'AG', 'TG', 'TI', 'VD', 'VS', 'NE', 'GE', 'JU']
pruefe('26 Kantone', KANTONE.length === 26)
pruefe('jeder Kanton genau einmal', ALLE.every((kz) => KANTONE.filter((k) => k.kz === kz).length === 1))
for (const k of KANTONE) {
    pruefe(`${k.kz}: Name`, typeof k.name === 'string' && k.name.length > 1)
    pruefe(`${k.kz}: mindestens eine Quelle mit URL und Fassung`, k.quellen.length > 0 && k.quellen.every((q) => /^https:\/\//.test(q.url) && q.fassung))
    pruefe(`${k.kz}: Ersatzkurs bekannt oder null`, k.ersatzkurs === null || k.ersatzkurs in ERSATZKURS_TEXT)
    pruefe(`${k.kz}: Mining bekannt oder null`, k.mining === null || k.mining in MINING_TEXT)
    pruefe(`${k.kz}: Kaufpreis true/false/null/widerspruch`, [true, false, null, 'widerspruch'].includes(k.kaufpreis))
    pruefe(`${k.kz}: Listen`, Array.isArray(k.belege) && Array.isArray(k.hinweise) && Array.isArray(k.unsicher))
}
// Nur die recherchierten Kantone haben einen eigenen Code
const mitCode = KANTONE.filter((k) => k.code).map((k) => k.kz).sort().join(',')
pruefe('Codes nur ZG/AG KR, SO/JU 740, VD 420/410', mitCode === 'AG,JU,SO,VD,ZG', mitCode)
pruefe('ZG und AG: Code KR', kanton('ZG').code === 'KR' && kanton('AG').code === 'KR')
pruefe('TG: 12 Monate Haltedauer', haltedauerMonate('TG') === 12)
pruefe('alle anderen 6 Monate', KANTONE.filter((k) => k.kz !== 'TG').every((k) => k.haltedauerMonate === 6))
pruefe('ohne Kanton: 6 Monate (KS 36)', haltedauerMonate(null) === 6)
pruefe('Kaufpreis: ZH nein, BS ja, BL Widerspruch → nicht erlaubt', !kaufpreisErlaubt('ZH') && kaufpreisErlaubt('BS') && !kaufpreisErlaubt('BL'))
pruefe('Mining: ZH/TG selbständig, BS/BE/GR Vermögensertrag', kanton('ZH').mining === 'selbstaendig' && kanton('TG').mining === 'selbstaendig' && ['BS', 'BE', 'GR'].every((kz) => kanton(kz).mining === 'vermoegensertrag'))
pruefe('Kleinbuchstaben', kanton('zh')?.kz === 'ZH')
pruefe('unbekannt → null', kanton('XX') === null && kanton(null) === null)
pruefe('NE und AR als unsicher markiert', kanton('NE').unsicher.length > 0 && kanton('AR').unsicher.length > 0)

console.log(`Steuer-Kantone: ${ok} ok, ${fail} Fehler`)
if (fail) process.exit(1)
