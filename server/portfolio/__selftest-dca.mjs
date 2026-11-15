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
import { istDcaKauf, dcaUebersicht, laufendeKaeufe, umstellungenAus, heutigerCoin, dcaVerlauf, monate, dcaKursWege, dcaAktienBestand, dcaSchluessel } from './dca.js'
import { aktienKlasseVon } from './aktien-art.js'

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

console.log('\nNoch da')
{
    const e = coin('ETH'), b = coin('BTC'), a = coin('AGIX')
    check('Bestand über der DCA-Menge: alles da, nichts weg', nah(e.nochDa.menge, 0.18) && e.nochDa.wegMenge === 0 && nah(e.nochDa.anteil, 1))
    check('kein Bestand: nichts da, alles weg', b.nochDa.menge === 0 && nah(b.nochDa.wegMenge, 0.0095) && b.nochDa.anteil === 0 && b.nochDa.wertChf === 0)
    check('Summe nur über das Vorhandene', nah(summe.nochDaChf, 0.18 * 3000))
    check('Anteil an dem Wert ohne Auszahlungen', nah(summe.nochDaAnteil, summe.nochDaChf / summe.wertHeuteChf))

    const reihe = (asset, m, roh = sp) => [kauf('bitpanda', '2026-10-01T00:00:00Z', asset, m, 50, 'CHF', 50, roh)]
    const rechne = (kaeufe, bestand, kurs = () => 100) => dcaUebersicht(kaeufe, {
        jetzt: JETZT, umstellungen: umst, kursChfVon: kurs,
        bestandVon: (x) => (bestand[x] != null ? { menge: bestand[x], chf: null, orte: [] } : null),
    })

    const teil = rechne(reihe('BTC', 1), { BTC: 0.25 }).coins[0]
    check('Bestand unter der DCA-Menge: Rest gilt als weg', nah(teil.nochDa.menge, 0.25) && nah(teil.nochDa.wegMenge, 0.75) && nah(teil.nochDa.anteil, 0.25))
    check('Wert von „noch da“ zum heutigen Kurs', nah(teil.nochDa.wertChf, 25))
    check('Wert ohne Auszahlungen bleibt die ganze Menge', nah(teil.wertHeuteChf, 100))

    const rausch = rechne(reihe('BTC', 0.1 + 0.2), { BTC: 0.3 }).coins[0]
    check('Rechenrauschen ist keine Auszahlung', rausch.nochDa.wegMenge === 0)

    const ohneKurs = rechne(reihe('BTC', 1), { BTC: 0.5 }, () => null)
    check('ohne Kurs: Menge ja, Wert unbekannt, Summe 0', nah(ohneKurs.coins[0].nochDa.menge, 0.5) && ohneKurs.coins[0].nochDa.wertChf === null && ohneKurs.summe.nochDaChf === 0 && ohneKurs.summe.nochDaAnteil === null)

    const f = umst.AGIX.faktor
    const um = rechne(reihe('AGIX', 100), { FET: 10 }).coins[0]
    check('umgestellter Coin: in heutigen Stücken', nah(um.nochDa.menge, 10) && nah(um.nochDa.wegMenge, 100 * f - 10) && nah(um.nochDa.anteil, 10 / (100 * f)))

    const zwei = rechne([...reihe('AGIX', 100), ...reihe('FET', 40)], { FET: 50 })
    check('zwei Pläne, ein heutiger Coin: Bestand zählt einmal', nah(zwei.coins.reduce((s, c) => s + c.nochDa.menge, 0), 50) && nah(zwei.summe.nochDaChf, 5000))
    check('AGIX bleibt wie vorher', nah(a.nochDa.menge, 0) && nah(a.nochDa.wegMenge, 180 * f))
}

console.log('\nNur laufende')
{
    const opt = { jetzt: JETZT, umstellungen: umst, kursChfVon: (a) => KURS[a] ?? null, bestandVon: (a) => (a === 'ETH' ? { menge: 0.5, chf: 1500, orte: [] } : null) }
    const alle = dcaUebersicht(zeilen, opt), lf = dcaUebersicht(zeilen, { ...opt, nurLaufende: true })
    check('ohne Filter: alles da, nichts ausgeblendet', alle.coins.length === 3 && alle.ausgeblendet.coins.length === 0 && alle.ausgeblendet.investiertChf === 0)
    check('beendeter Coin fällt weg', lf.coins.map((c) => c.asset).join() === 'ETH,BTC' || lf.coins.map((c) => c.asset).join() === 'BTC,ETH')
    check('ausgeblendet nennt Coin und Einsatz', lf.ausgeblendet.coins.join() === 'AGIX' && nah(lf.ausgeblendet.investiertChf, 48))
    check('Summen nur über das Gezeigte', lf.summe.kaeufe === 20 && nah(lf.summe.investiertChf, alle.summe.investiertChf - 48))
    check('Wert und „noch da“ ohne den beendeten Coin', nah(lf.summe.wertHeuteChf, alle.summe.wertHeuteChf - coin('AGIX').wertHeuteChf) && nah(lf.summe.nochDaChf, alle.summe.nochDaChf))
    check('beendeter Plan eines laufenden Coins bleibt', lf.coins.find((c) => c.asset === 'BTC').plaene.some((p) => !p.aktiv) && lf.coins.find((c) => c.asset === 'BTC').anzahl === 12)
    check('laufende Pläne unverändert', lf.summe.aktivePlaene === alle.summe.aktivePlaene)

    const nurAlt = dcaUebersicht(zeilen.filter((z) => z.asset === 'AGIX'), { ...opt, nurLaufende: true })
    check('alles beendet: leere Liste, Summen 0, kein Beginn', nurAlt.coins.length === 0 && nurAlt.summe.kaeufe === 0 && nurAlt.summe.von === null && nurAlt.summe.gewinnPct === null && nurAlt.ausgeblendet.coins.join() === 'AGIX')

    const frisch = kauf('bitpanda', '2026-10-20T00:00:00Z', 'FET', 40, 50, 'CHF', 50)
    const geteilt = dcaUebersicht([...zeilen.filter((z) => z.asset === 'AGIX'), frisch], { jetzt: JETZT, umstellungen: umst, kursChfVon: () => 1, bestandVon: () => ({ menge: 50, chf: 50, orte: [] }), nurLaufende: true })
    check('geteilter Bestand: der laufende Plan bekommt zuerst', geteilt.coins.length === 1 && nah(geteilt.coins[0].nochDa.menge, 40))

    const lk = laufendeKaeufe(zeilen.filter(istDcaKauf), { jetzt: JETZT })
    check('Verlauf: nur Käufe laufender Coins', lk.length === 20 && !lk.some((z) => z.asset === 'AGIX'))
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

console.log('\nSparplan auf eine Aktie (SUI = Sun Communities bei Bitpanda) nimmt keinen Coin-Kurs (FUN-P-003)')
{
    const klasse = aktienKlasseVon(new Map([['SUI', 'aktie']]))
    const klasseVon = (z) => klasse(z.quelle, z.asset)
    const aktie = [kauf('bitpanda', '2026-08-01T00:00:00Z', 'SUI', 0.5, 60, 'EUR', 56), kauf('bitpanda', '2026-09-01T00:00:00Z', 'SUI', 0.5, 60, 'EUR', 56), kauf('bitpanda', '2026-10-01T00:00:00Z', 'SUI', 0.5, 60, 'EUR', 56)]
    const coin = [kauf('i:Crypto.com', '2026-08-15T00:00:00Z', 'SUI', 20, 50, 'CHF', 50, JSON.stringify({ dca: 'Crypto.com Karte' })), kauf('i:Crypto.com', '2026-09-15T00:00:00Z', 'SUI', 20, 50, 'CHF', 50, JSON.stringify({ dca: 'Crypto.com Karte' }))]
    const SUI_COIN = 3   // CHF je Sui — der Kurs, den die Aktie NICHT bekommen darf

    const nurAktie = dcaKursWege(aktie, {}, klasseVon)
    check('Kursweg: Aktie geht nicht in die Coin-Kursabfrage', !nurAktie.coins.has('SUI') && nurAktie.aktien.has('SUI'))
    const beide = dcaKursWege([...aktie, ...coin, ...zeilen.filter((z) => z.asset === 'AGIX')], umst, klasseVon)
    check('Kursweg: der Coin SUI einer anderen Quelle schon', beide.coins.has('SUI') && beide.aktien.has('SUI'))
    check('Kursweg: Umstellungs-Ziel bleibt dabei (AGIX → FET)', beide.coins.has('AGIX') && beide.coins.has('FET'))
    check('Schlüssel trennt Aktie und Coin', dcaSchluessel(aktie[0], klasseVon) !== dcaSchluessel(coin[0], klasseVon) && dcaSchluessel(coin[0], klasseVon) === 'SUI')

    // Nicht mehr gehalten: kein Kurs — auch wenn es für das Kürzel einen Coin-Kurs gäbe.
    const gefragt = []
    const opt = { jetzt: JETZT, klasseVon, kursChfVon: (a, k) => { gefragt.push([a, k]); return k ? null : SUI_COIN }, bestandVon: () => null }
    const u = dcaUebersicht(aktie, opt)
    check('Aktie nicht gehalten: kein Kurs, kein Wert, kein Gewinn', u.coins.length === 1 && u.coins[0].klasse === 'aktie' && u.coins[0].kursChf === null && u.coins[0].wertHeuteChf === null && u.coins[0].gewinnChf === null, JSON.stringify(u.coins[0]))
    check('als «ohne Kurs» genannt statt mit Coin-Kurs gerechnet', u.summe.ohneKurs.join() === 'SUI' && u.summe.wertHeuteChf === 0)
    check('Kurs wird als Aktie angefragt', gefragt.length === 1 && gefragt[0][1] === 'aktie')

    // Gehalten: Bitpandas eigener Wert der Position (über die Übersicht), nicht der Coin.
    const ab = dcaAktienBestand([{ quelle: 'bitget', posten: [{ schluessel: 'SUI', menge: 40, chf: 120, klasse: null }] },
        { quelle: 'bitpanda', posten: [{ schluessel: 'SUI', menge: 1.5, chf: 165, klasse: 'aktie' }, { schluessel: 'BTC', menge: 1, chf: 60000, klasse: null }, { schluessel: 'T', menge: 2, chf: null, klasse: 'aktie' }] }])
    check('Aktien-Bestand nur aus Bitpandas Aktien-Zeilen', ab.size === 2 && nah(ab.get('SUI').kursChf, 110) && ab.get('T').kursChf === null && ab.get('T').chf === null)
    // FUN-P-004: die Übersicht führt die Aktie als eigene Zeile `SUI|aktie` neben dem Coin `SUI` desselben Orts.
    const ab2 = dcaAktienBestand([{ quelle: 'bitpanda', posten: [{ schluessel: 'SUI|aktie', menge: 1.5, chf: 165, klasse: 'aktie' }, { schluessel: 'SUI', menge: 40, chf: 120, klasse: null }] }])
    check('Aktien-Zeile mit Schlüssel SUI|aktie: Kürzel SUI, der Coin daneben zählt nicht mit', ab2.size === 1 && nah(ab2.get('SUI').menge, 1.5) && nah(ab2.get('SUI').kursChf, 110))
    const beideU = dcaUebersicht([...aktie, ...coin], {
        jetzt: JETZT, klasseVon,
        kursChfVon: (a, k) => (k ? ab.get(a)?.kursChf ?? null : SUI_COIN),
        bestandVon: (a, k) => (k ? { menge: ab.get(a).menge, chf: ab.get(a).chf } : { menge: 40, chf: 120 }),
    })
    const za = beideU.coins.find((c) => c.klasse === 'aktie'), zc = beideU.coins.find((c) => !c.klasse)
    check('Aktie und Coin SUI sind zwei Zeilen', beideU.coins.length === 2 && za.schluessel !== zc.schluessel && za.asset === 'SUI' && zc.asset === 'SUI')
    check('Aktie: Wert über Bitpandas Bewertung (1.5 × 110), nicht 1.5 × Sui', nah(za.wertHeuteChf, 165) && !nah(za.wertHeuteChf, 1.5 * SUI_COIN))
    check('Coin: weiter über den Coin-Kurs', nah(zc.wertHeuteChf, 40 * SUI_COIN) && zc.anzahl === 2)
    check('«Noch da» je Art aus dem eigenen Bestand', nah(za.nochDa.menge, 1.5) && nah(zc.nochDa.menge, 40))
    check('ohne klasseVon wie bisher eine Zeile', dcaUebersicht([...aktie, ...coin], { jetzt: JETZT }).coins.length === 1)

    // Verlauf: Monatskerzen des Coins SUI gelten nur für den Coin.
    const mk = new Map([['SUI', new Map([['2026-08', SUI_COIN], ['2026-09', SUI_COIN], ['2026-10', SUI_COIN]])]])
    const v = dcaVerlauf(aktie, mk, { bisMonat: '2026-10', klasseVon })
    check('Verlauf Aktie: letzter Kaufpreis (geschätzt), nicht Stücke × Sui-Kurs', nah(v.at(-1).wertChf, 1.5 * (56 / 0.5)) && v.at(-1).geschaetzt.join() === 'SUI', JSON.stringify(v.at(-1)))
    const falsch = dcaVerlauf(aktie, mk, { bisMonat: '2026-10' })
    check('Gegenprobe: ohne die Art wäre es der Coin-Kurs', nah(falsch.at(-1).wertChf, 1.5 * SUI_COIN))
    const vb = dcaVerlauf([...aktie, ...coin], mk, { bisMonat: '2026-10', klasseVon })
    check('Verlauf gemischt: Coin über Kerzen, Aktie geschätzt', nah(vb.at(-1).wertChf, 40 * SUI_COIN + 1.5 * 112) && vb.at(-1).geschaetzt.join() === 'SUI')
    const lk = laufendeKaeufe([...aktie, ...coin], { jetzt: JETZT, klasseVon })
    check('laufende Käufe je Art', lk.length === 5)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
process.exit(fehlgeschlagen ? 1 : 0)
