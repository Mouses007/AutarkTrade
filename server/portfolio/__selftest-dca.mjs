/**
 * Selbsttest des DCA-Portfolios (`dca.js`).
 *
 *   node server/portfolio/__selftest-dca.mjs
 *
 * Form der echten Zeilen vom 01.11.2026: Bitpanda-Sparplan BTC 50 CHF alle
 * zwei Wochen und ETH erst in EUR, dann 40 CHF monatlich; Crypto.com-
 * Kartenkäufe mit Marke `roh.dca`; AGIX, das 2024 zu FET wurde. Geprüft wird,
 * was still danebengeht:
 *   - ein gewöhnlicher Kauf (`buy`) zählt NICHT, ein markierter schon;
 *   - Ø-Kaufpreis und Gewinn nur über Käufe mit bekanntem CHF-Wert (ein Kauf
 *     ohne Wert wäre sonst geschenkt);
 *   - ein umgestellter Coin wird über den neuen bewertet, nicht als 0;
 *   - der Rhythmus folgt den letzten Käufen, nicht dem Plan von 2019;
 *   - im Verlauf knickt ein Coin ohne Monatskurs nicht auf null.
 */
import { istDcaKauf, dcaUebersicht, umstellungenAus, heutigerCoin, dcaVerlauf, monate } from './dca.js'

let bestanden = 0, fehlgeschlagen = 0
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}
const nah = (a, b, e = 1e-9) => Math.abs(a - b) <= e * Math.max(1, Math.abs(b))
const TAG = 86400e3
const JETZT = Date.parse('2026-11-01T12:00:00Z')
const sp = JSON.stringify({ operation_type: 'savings_plan' })
const kauf = (quelle, iso, asset, menge, betrag, w, chf, roh = sp) => ({ quelle, zeit: Date.parse(iso), art: 'kauf', asset, menge, gegenAsset: w, gegenMenge: -betrag, chfWert: chf, roh })

const zeilen = []
// BTC: Bitpanda 50 CHF alle 14 Tage, 10 Käufe bis 25.10.2026
for (let i = 0; i < 10; i++) zeilen.push(kauf('bitpanda', new Date(Date.parse('2026-06-21T01:03:00Z') + i * 14 * TAG).toISOString(), 'BTC', 0.0007, 50, 'CHF', 50))
// BTC: Crypto.com-Kartenkäufe (Marke), 2 Stück 2022
zeilen.push(kauf('i:Crypto.com', '2022-04-17T10:00:00Z', 'BTC', 0.0012, 50, 'CHF', 50, JSON.stringify({ dca: 'Crypto.com Karte' })))
zeilen.push(kauf('i:Crypto.com', '2022-04-24T10:00:00Z', 'BTC', 0.0013, 50, 'CHF', 50, { dca: 'Crypto.com Karte' }))
// gewöhnlicher Kauf: zählt nicht
zeilen.push(kauf('bitpanda', '2025-02-03T09:50:00Z', 'BTC', 0.01, 900, 'CHF', 900, JSON.stringify({ operation_type: 'buy' })))
// ETH: EUR-Plan 2023 (einer ohne CHF-Wert), dann CHF-Plan monatlich bis 01.11.2026
zeilen.push(kauf('bitpanda', '2023-01-01T00:00:00Z', 'ETH', 0.03, 40, 'EUR', 38))
zeilen.push(kauf('bitpanda', '2023-02-01T00:00:00Z', 'ETH', 0.03, 40, 'EUR', null))
for (let i = 0; i < 6; i++) zeilen.push(kauf('bitpanda', `2026-${String(6 + i).padStart(2, '0')}-01T01:34:00Z`, 'ETH', 0.02, 40, 'CHF', 40))
// AGIX: Plan 2023, 2024 zu FET umgestellt
zeilen.push(kauf('bitpanda', '2023-05-28T00:00:00Z', 'AGIX', 100, 25, 'EUR', 24))
zeilen.push(kauf('bitpanda', '2023-06-28T00:00:00Z', 'AGIX', 80, 25, 'EUR', 24))
// Verkauf und Einzahlung zählen nie
zeilen.push({ quelle: 'bitpanda', zeit: Date.parse('2026-07-01T00:00:00Z'), art: 'verkauf', asset: 'BTC', menge: -0.001, roh: sp })
zeilen.push({ quelle: 'bitpanda', zeit: Date.parse('2026-07-01T00:00:00Z'), art: 'einzahlung', asset: 'CHF', menge: 50, roh: sp })

const fusion = [{ zeit: Date.parse('2024-07-05T00:00:00Z'), art: 'tausch', asset: 'FET', menge: 614.17575228, gegenAsset: 'AGIX', gegenMenge: -1417.27414857, roh: JSON.stringify({ operation_type: 'merger_crypto' }) },
    { zeit: Date.parse('2025-07-16T00:00:00Z'), art: 'tausch', asset: 'VSN', menge: 6395.35434618, gegenAsset: 'BEST', gegenMenge: -1302.51616012, roh: { operation_type: 'merger_crypto' } },
    { zeit: 1, art: 'tausch', asset: 'FET', menge: 10, gegenAsset: 'ADA', gegenMenge: -30, roh: JSON.stringify({ operation_type: 'swap' }) }]
const umst = umstellungenAus(fusion)

console.log('\nWelche Käufe zählen')
{
    check('Sparplan-Kauf', istDcaKauf(zeilen[0]))
    check('markierter Kartenkauf (roh als Text und als Objekt)', istDcaKauf(zeilen[10]) && istDcaKauf(zeilen[11]))
    check('gewöhnlicher Kauf nicht', !istDcaKauf(zeilen[12]))
    check('Verkauf und Lastschrift nicht', !istDcaKauf(zeilen.at(-1)) && !istDcaKauf(zeilen.at(-2)))
}

console.log('\nUmstellungen aus den Fusionen')
{
    check('AGIX → FET × 0.43335', umst.AGIX?.nach === 'FET' && nah(umst.AGIX.faktor, 614.17575228 / 1417.27414857))
    check('BEST → VSN × 4.91', umst.BEST?.nach === 'VSN' && nah(umst.BEST.faktor, 6395.35434618 / 1302.51616012))
    check('ein Swap ist keine Umstellung', !umst.ADA)
    const h = heutigerCoin('AGIX', umst)
    check('heutiger Coin von AGIX = FET', h.asset === 'FET' && nah(h.faktor, umst.AGIX.faktor))
    check('BTC bleibt BTC', heutigerCoin('BTC', umst).asset === 'BTC')
}

const KURS = { BTC: 60000, ETH: 3000, FET: 0.4 }
const { coins, summe } = dcaUebersicht(zeilen, {
    jetzt: JETZT, umstellungen: umst, kursChfVon: (a) => KURS[a] ?? null,
    bestandVon: (a) => (a === 'ETH' ? { menge: 0.5, chf: 1500, orte: [{ quelle: 'i:Ledger ETH LEN 0x6c2e', menge: 0.4 }] } : null),
    quelleName: (q) => (q === 'bitpanda' ? 'Bitpanda' : q.replace(/^i:/, '')),
})
const coin = (a) => coins.find((c) => c.asset === a)

console.log('\nBTC: zwei Quellen')
{
    const b = coin('BTC')
    check('12 Käufe (10 Bitpanda + 2 Crypto.com), der gewöhnliche nicht', b?.anzahl === 12)
    check('Menge', nah(b.menge, 10 * 0.0007 + 0.0025))
    check('eingesetzt 600 CHF', nah(b.investiertChf, 600))
    check('Ø-Kaufpreis = Einsatz / Menge', nah(b.schnittChf, 600 / (0.007 + 0.0025)))
    check('Wert und Gewinn', nah(b.wertHeuteChf, 0.0095 * 60000) && nah(b.gewinnChf, 0.0095 * 60000 - 600))
    const bp = b.plaene.find((p) => p.quelle === 'bitpanda'), cc = b.plaene.find((p) => p.quelle === 'i:Crypto.com')
    check('Bitpanda-Plan läuft, alle 14 Tage, 50 CHF', bp?.aktiv && nah(bp.intervallTage, 14) && bp.betrag === 50 && bp.art === 'sparplan')
    check('Crypto.com-Plan beendet, Marke als Art', cc && !cc.aktiv && cc.art === 'Crypto.com Karte' && cc.quelleName === 'Crypto.com')
    check('laufender Plan zuerst', b.plaene[0] === bp)
}

console.log('\nETH: Kauf ohne CHF-Wert')
{
    const e = coin('ETH')
    check('8 Käufe, einer ohne CHF', e?.anzahl === 8 && e.ohneChf === 1)
    check('Ø-Kaufpreis ohne den Kauf ohne Wert', nah(e.schnittChf, (38 + 240) / (0.03 + 0.12)))
    check('Gewinn nur über die Käufe mit Wert', nah(e.gewinnChf, (0.03 + 0.12) * 3000 - 278))
    check('Wert heute über ALLE Käufe', nah(e.wertHeuteChf, 0.18 * 3000))
    check('CHF-Plan monatlich und läuft, EUR-Plan beendet',
        e.plaene.find((p) => p.waehrung === 'CHF')?.aktiv && !e.plaene.find((p) => p.waehrung === 'EUR')?.aktiv
        && Math.round(e.plaene.find((p) => p.waehrung === 'CHF').intervallTage) >= 30)
    check('heute im Portfolio aus der Übersicht', e.heuteImPortfolio?.menge === 0.5)
}

console.log('\nAGIX: über FET bewertet')
{
    const a = coin('AGIX')
    check('umgestellt auf FET', a?.umgestellt && a.heuteAsset === 'FET')
    check('Wert = Menge × Faktor × FET-Kurs', nah(a.wertHeuteChf, 180 * umst.AGIX.faktor * 0.4))
    check('beendet', !a.aktiv)
}

console.log('\nSummen')
{
    check('Käufe gesamt 22', summe.kaeufe === 22)
    check('laufende Pläne: BTC Bitpanda, ETH CHF', summe.aktivePlaene === 2)
    check('laufende Coins zuerst', coins[0].aktiv && coins[1].aktiv && !coins[2].aktiv)
    check('Gewinn-% über dieselben Käufe wie der Einsatz', nah(summe.gewinnPct, summe.gewinnChf / summe.investiertMitKursChf))
    const ohne = dcaUebersicht(zeilen, { jetzt: JETZT, kursChfVon: (a) => (a === 'BTC' ? 60000 : null) })
    check('ohne Kurs: Coin fällt aus Wert und Gewinn, wird genannt', ohne.summe.ohneKurs.includes('ETH') && nah(ohne.summe.investiertMitKursChf, 600))
}

console.log('\nVerlauf')
{
    check('Monate über den Jahreswechsel', monate('2025-11', '2026-02').join() === '2025-11,2025-12,2026-01,2026-02')
    const mk = new Map([['BTC', new Map([['2026-06', 55000], ['2026-07', 58000]])], ['FET', new Map([['2024-07', 1.2]])]])
    const v = dcaVerlauf(zeilen.filter((z) => z.asset !== 'ETH'), mk, { umstellungen: umst, bisMonat: '2026-07' })
    const p = (m) => v.find((x) => x.monat === m)
    check('beginnt mit dem ersten Kauf', v[0].monat === '2022-04')
    check('Einsatz kumuliert', nah(p('2023-06').eingesetztChf, 100 + 48))
    check('ohne Monatskurs: letzter Kaufpreis, als geschätzt markiert', nah(p('2022-05').wertChf, 0.0025 * (50 / 0.0013)) && p('2022-05').geschaetzt.includes('BTC'))
    check('nach der Umstellung über FET × Faktor', nah(p('2024-07').wertChf, 0.0025 * (50 / 0.0013) + 180 * umst.AGIX.faktor * 1.2) && !p('2024-07').geschaetzt.includes('AGIX'))
    check('mit Monatskurs nicht geschätzt', !p('2026-07').geschaetzt.includes('BTC') && nah(p('2026-07').wertChf - (180 * 24 / 80), (0.0025 + 0.0007 * 3) * 58000, 1e-6))
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
process.exit(fehlgeschlagen ? 1 : 0)
