/**
 * Selbsttest der Staking-Übersicht (`staking.js`).
 *
 *   node server/portfolio/__selftest-staking.mjs
 *
 * Form der echten Bitpanda-Zeilen vom 01.11.2026: IOTA im Staking seit
 * 19.05.2025 (wöchentlich ~16,3 IOTA), ALGO erst im Passive Earn, ab
 * 17.06.2026 im Staking, CSPR ohne Kurs bei Erhalt; dazu ein beendeter
 * Ertrag aus einem Import. Geprüft wird, was still danebengeht:
 *   - ein Produktwechsel wird zwei Zeilen, nicht eine gemischte;
 *   - die Rendite zählt die erste Auszahlung im Fenster nicht mit;
 *   - ein beendetes Produkt hat keinen Bestand und keine Rendite;
 *   - zwei Produkte desselben Coins am selben Ort zählen den Bestand einmal;
 *   - ohne Kurs bei Erhalt bleibt der CHF-Wert unbekannt, nicht 0.
 */
import { stakingUebersicht } from './staking.js'

let bestanden = 0, fehlgeschlagen = 0
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}
const nah = (a, b, e = 1e-9) => Math.abs(a - b) <= e * Math.max(1, Math.abs(b))

const TAG = 86400e3
const JETZT = Date.parse('2026-11-01T12:00:00Z')
const roh = (t) => JSON.stringify({ operation_type: t })
const bew = []
// IOTA: Einsatz 9552.98, dann 75 Wochen je 16.3 IOTA (Wert bei Erhalt 0.70 CHF)
const iotaStart = Date.parse('2025-05-19T09:08:00Z')
bew.push({ quelle: 'bitpanda', zeit: iotaStart, art: 'umbuchung', asset: 'IOTA', menge: 9552.97641292, roh: roh('stake') })
bew.push({ quelle: 'bitpanda', zeit: iotaStart, art: 'umbuchung', asset: 'IOTA', menge: -9552.97641292, roh: roh('stake') })
for (let i = 1; i <= 75; i++) bew.push({ quelle: 'bitpanda', zeit: iotaStart + i * 7 * TAG, art: 'staking', asset: 'IOTA', menge: 16.3, chfWert: 0.7, roh: roh('reward') })
// ALGO: Passive Earn wöchentlich Feb.–Mitte Juni, dann Staking ab 17.06.
const algoStake = Date.parse('2026-06-17T21:21:00Z')
for (let i = 0; i < 20; i++) bew.push({ quelle: 'bitpanda', zeit: Date.parse('2026-02-03T18:00:00Z') + i * 7 * TAG, art: 'staking', asset: 'ALGO', menge: 0.26, chfWert: 0.02, roh: roh('passive_earn_reward') })
bew.push({ quelle: 'bitpanda', zeit: algoStake, art: 'umbuchung', asset: 'ALGO', menge: 1522.14748215, roh: roh('stake') })
bew.push({ quelle: 'bitpanda', zeit: algoStake, art: 'umbuchung', asset: 'ALGO', menge: -1522.14748215, roh: roh('stake') })
for (let i = 1; i <= 19; i++) bew.push({ quelle: 'bitpanda', zeit: algoStake + i * 7 * TAG, art: 'staking', asset: 'ALGO', menge: 0.86, chfWert: 0.07, roh: roh('reward') })
// CSPR: ohne Kurs bei Erhalt
for (let i = 0; i < 10; i++) bew.push({ quelle: 'bitpanda', zeit: JETZT - (10 - i) * 7 * TAG, art: 'staking', asset: 'CSPR', menge: 25, chfWert: null, roh: roh('reward') })
// Import: SwissBorg-Ertrag, 2023 beendet
for (let i = 0; i < 30; i++) bew.push({ quelle: 'i:SwissBorg', zeit: Date.parse('2022-01-01T00:00:00Z') + i * TAG, art: 'staking', asset: 'CHSB', menge: 0.5, chfWert: 0.2 })
// ignoriert und Auszahlung: zählen nicht
bew.push({ quelle: 'bitpanda', zeit: JETZT - TAG, art: 'staking', asset: 'IOTA', menge: 1000, chfWert: 50, einordnung: 'ignorieren', roh: roh('reward') })
bew.push({ quelle: 'bitpanda', zeit: JETZT - TAG, art: 'auszahlung', asset: 'IOTA', menge: -5 })

const BESTAND = { 'bitpanda|IOTA': { menge: 10970.5, chf: 350 }, 'bitpanda|ALGO': { menge: 1538.5, chf: 117 }, 'bitpanda|CSPR': { menge: 13373, chf: 22 } }
const KURS = { IOTA: 0.032, ALGO: 0.076, CSPR: 0.0017 }
const { produkte, summe } = stakingUebersicht(bew, {
    jetzt: JETZT,
    bestandVon: (q, a) => BESTAND[`${q}|${a}`] || null,
    kursChfVon: (a) => KURS[a] ?? null,
})
const finde = (q, a, p) => produkte.find((x) => x.quelle === q && x.asset === a && x.produkt === p)

console.log('\nIOTA im Staking')
{
    const p = finde('bitpanda', 'IOTA', 'staking')
    check('läuft', p?.aktiv === true)
    check('Einsatz = Plus-Zeile des stake (nicht 0, nicht doppelt)', nah(p?.eingesetzt, 9552.97641292), String(p?.eingesetzt))
    check('seit = Einsatz', p?.seit === iotaStart)
    check('75 Auszahlungen, ignorierte nicht', p?.anzahl === 75 && nah(p.ertragMenge, 75 * 16.3))
    check('wöchentlich', nah(p?.intervallTage, 7))
    check('CHF bei Erhalt = Σ chfWert', nah(p?.ertragChf, 75 * 0.7))
    check('heute wert = Menge × Kurs', nah(p?.ertragHeuteChf, 75 * 16.3 * 0.032))
    // Fenster: letzte 90 Tage ab der letzten Auszahlung → 13 Auszahlungen über 84 Tage, die erste zählt nicht
    const erwartet = (12 * 16.3 / 10970.5) * (365 / 84)
    check('Rendite p.a. ohne die erste Auszahlung im Fenster', nah(p?.renditePa, erwartet), `${p?.renditePa} statt ${erwartet}`)
    check('Rendite-Fenster 84 Tage', p?.renditeTage === 84)
    check('Bestand am Ort', p?.bestandMenge === 10970.5 && p.bestandChf === 350)
}

console.log('\nALGO: Passive Earn, dann Staking')
{
    const alt = finde('bitpanda', 'ALGO', 'passiveEarn')
    const neu = finde('bitpanda', 'ALGO', 'staking')
    check('zwei Zeilen', !!alt && !!neu)
    check('Passive Earn beendet, ohne Bestand und Rendite', alt?.aktiv === false && alt.bestandMenge == null && alt.renditePa == null)
    check('Staking läuft, Einsatz 1522.15', neu?.aktiv === true && nah(neu.eingesetzt, 1522.14748215))
    check('Staking seit dem Einsatz, nicht seit Februar', neu?.seit === algoStake)
    check('Erträge getrennt', alt?.anzahl === 20 && neu?.anzahl === 19)
}

console.log('\nCSPR ohne Kurs bei Erhalt')
{
    const p = finde('bitpanda', 'CSPR', 'staking')
    check('CHF bei Erhalt unbekannt, nicht 0', p?.ertragChf === null && p.ertragOhneChf === 10)
    check('ohne Einsatz-Zeile: Einsatz unbekannt', p?.eingesetzt === null)
    check('heute wert über den Kurs', nah(p?.ertragHeuteChf, 250 * 0.0017))
}

console.log('\nImport, beendet')
{
    const p = finde('i:SwissBorg', 'CHSB', 'ertrag')
    check('Produkt „Ertrag“, beendet', p?.produkt === 'ertrag' && p.aktiv === false)
    check('täglich', nah(p?.intervallTage, 1))
    check('ohne Kurs heute: Wert heute unbekannt', p?.ertragHeuteChf === null)
}

console.log('\nSummen und Reihenfolge')
{
    check('laufend: IOTA, ALGO, CSPR', summe.aktiv === 3)
    check('Bestand je Ort und Coin einmal', nah(summe.bestandChf, 350 + 117 + 22), String(summe.bestandChf))
    check('CHF bei Erhalt über alle', nah(summe.ertragChf, 75 * 0.7 + 20 * 0.02 + 19 * 0.07 + 30 * 0.2))
    check('Erhalt ↔ heute nur über laufende', nah(summe.laufendErtragChf, 75 * 0.7 + 19 * 0.07) && nah(summe.laufendErtragHeuteChf, 75 * 16.3 * 0.032 + 19 * 0.86 * 0.076 + 250 * 0.0017))
    const einmal = stakingUebersicht([{ quelle: 'i:SafePal VeChain', zeit: JETZT - 9 * TAG, art: 'staking', asset: 'VTHO', menge: 44857.17, chfWert: 23.21 }], { jetzt: JETZT })
    check('eine einzelne Buchung ohne Einsatz: nicht laufend', einmal.produkte[0]?.aktiv === false)
    check('laufende zuerst, nach Bestand', produkte[0].asset === 'IOTA' && produkte.slice(0, 3).every((p) => p.aktiv) && produkte.slice(3).every((p) => !p.aktiv))
    const ohneAuszahlung = stakingUebersicht([{ quelle: 'bitpanda', zeit: JETZT - TAG, art: 'umbuchung', asset: 'SOL', menge: 10, roh: roh('stake') }], { jetzt: JETZT })
    check('frisch gestakt, noch keine Auszahlung: läuft', ohneAuszahlung.produkte[0]?.aktiv === true && ohneAuszahlung.produkte[0].anzahl === 0)
    const zurueck = stakingUebersicht([
        { quelle: 'bitpanda', zeit: 1, art: 'umbuchung', asset: 'SOL', menge: 10, roh: roh('stake') },
        { quelle: 'bitpanda', zeit: 2, art: 'umbuchung', asset: 'SOL', menge: 10, roh: roh('unstake') },
    ], { jetzt: JETZT })
    check('ganz zurückgeholt: Einsatz 0, beendet', zurueck.produkte[0]?.eingesetzt === 0 && zurueck.produkte[0].aktiv === false)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
process.exit(fehlgeschlagen ? 1 : 0)
