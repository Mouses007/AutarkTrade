/**
 * Selbsttest Kurse am Stichtag: Bitpanda-Kerzenwahl (rein) und die
 * Schreibweise von Vertragsadressen (Solana bleibt, EVM klein).
 */
import { waehleBitpandaKerze } from './kurse.js'
import { normKontrakt } from './normal.js'

let ok = 0, fail = 0
const pruefe = (name, bed) => { if (bed) ok++; else { fail++; console.error('✗', name) } }
const t = (d) => Date.parse(d + 'T00:00:00Z')

// Tageskerzen: Beginn 00:00 UTC (Bitpanda zeigt 01:00+01:00), Schlusskurs des Tages
const tage = [{ t: t('2025-12-30'), o: 1, c: 2 }, { t: t('2025-12-31'), o: 2, c: 3.35 }, { t: t('2026-01-01'), o: 3.35, c: 3.6 }]
pruefe('Tageskerze 31.12. → Schlusskurs', waehleBitpandaKerze(tage, '2025-12-31', 'tag')?.chf === 3.35)
pruefe('Tageskerze ist genau', waehleBitpandaKerze(tage, '2025-12-31', 'tag')?.ungefaehr === false)
pruefe('fehlender Tag → null, nicht der Nachbar', waehleBitpandaKerze(tage, '2025-12-29', 'tag') === null)
pruefe('Kurs 0 ist kein Kurs', waehleBitpandaKerze([{ t: t('2025-12-31'), o: 0, c: 0 }], '2025-12-31', 'tag') === null)

// Wochenkerzen: die Woche, die den Tag enthält, Eröffnungskurs, als ungefähr markiert
const wochen = [{ t: t('2024-12-23'), o: 10, c: 11 }, { t: t('2024-12-30'), o: 11, c: 12 }, { t: t('2025-01-06'), o: 12, c: 13 }]
pruefe('Woche mit dem 31.12. → deren Eröffnung', waehleBitpandaKerze(wochen, '2024-12-31', 'woche')?.chf === 11)
pruefe('Wochenkurs ist ungefähr', waehleBitpandaKerze(wochen, '2024-12-31', 'woche')?.ungefaehr === true)
pruefe('Wochenbeginn selbst', waehleBitpandaKerze(wochen, '2024-12-30', 'woche')?.chf === 11)
pruefe('Tag vor allen Wochen → null', waehleBitpandaKerze(wochen, '2024-12-01', 'woche') === null)

// Vertragsadressen
pruefe('EVM klein', normKontrakt('0xD5DA8318cE7ca005E8F5285Db0e750CA9256586e') === '0xd5da8318ce7ca005e8f5285db0e750ca9256586e')
pruefe('Solana bleibt, wie es ist', normKontrakt('rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof') === 'rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof')
pruefe('Leerzeichen weg', normKontrakt('  0xABC  ') === '0xabc')
pruefe('leer → null', normKontrakt('') === null && normKontrakt(null) === null && normKontrakt('   ') === null)

console.log(`Kurse am Stichtag: ${ok} ok, ${fail} Fehler`)
if (fail) process.exit(1)
