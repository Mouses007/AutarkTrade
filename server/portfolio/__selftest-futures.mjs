/**
 * Selbsttest Futures im Steuerjahr (futures-rechnung.js, rein).
 */
import { flacheTrades, futuresJahr, nettoNach, stichtagSaldo, tradeVolumen, vorJournalJe } from './futures-rechnung.js'

let ok = 0, fail = 0
const pruefe = (name, bed) => { if (bed) ok++; else { fail++; console.error('✗', name) } }
const nah = (a, b) => Math.abs(a - b) < 1e-9

const s = (iso) => Date.parse(iso) / 1000
const zeilen = [
    { trades: JSON.stringify([
        { broker: 'bitunix', category: 'futures', type: 'futures', exitTime: s('2025-12-30T10:00:00Z'), entryPrice: 2, buyQuantity: 10, exitPrice: 3, sellQuantity: 10, netProceeds: 9, grossProceeds: 10, commission: 1, fundingFee: 0 },
        { broker: 'pionex', category: 'bot', type: 'futures', exitTime: s('2025-12-31T12:00:00Z'), entryPrice: 0.006, buyQuantity: 500, exitPrice: 0.007, sellQuantity: 500, netProceeds: -4, grossProceeds: -3, commission: 1, fundingFee: 0.5 },
        { broker: 'bitunix', openPosition: true, exitTime: s('2025-12-30T10:00:00Z'), netProceeds: 99 },
    ]) },
    { trades: [
        { broker: 'bitunix', category: 'futures', exitTime: s('2026-01-05T10:00:00Z'), entryPrice: 1, buyQuantity: 1, exitPrice: 1, sellQuantity: 1, netProceeds: -20, grossProceeds: -19, commission: 1 },
        { broker: 'bitget', type: 'spot', exitTime: s('2026-01-05T10:00:00Z'), netProceeds: 5 },
    ] },
    { trades: 'kaputt' },
]
const t = flacheTrades(zeilen)
pruefe('offene Position und Spot fallen weg, kaputtes JSON bricht nichts', t.length === 3)
pruefe('Volumen Futures = Preis × Menge beider Seiten', nah(tradeVolumen(t[0]), 50))
pruefe('Volumen Bot = buyQuantity (schon USDT)', nah(tradeVolumen(t[1]), 500))

const von = Date.parse('2025-01-01T00:00:00+01:00'), bis = Date.parse('2025-12-31T23:59:59+01:00')
const j = futuresJahr(t, { von, bis })
pruefe('zwei Börsen im Jahr 2025', j.length === 2 && j[0].boerse === 'bitunix' && j[1].boerse === 'pionex')
pruefe('Netto Bitunix', nah(j[0].nettoUsd, 9) && j[0].n === 1)
pruefe('Bot zählt als Bot', j[1].bots === 1 && nah(j[1].verluste, -4) && nah(j[1].fundingUsd, 0.5))
pruefe('Trade 2026 nicht im Jahr 2025', !j.some((e) => e.n > 1))
pruefe('Tage je Kalendertag (UTC) für den Tageskurs', j[0].tage.get('2025-12-30')?.netto === 9)

const nach = nettoNach(t, bis)
pruefe('Ergebnis nach Stichtag', nah(nach.get('bitunix'), -20) && !nach.has('pionex'))

const heute = new Map([['bitunix', { usd: 100 }], ['pionex', { usd: 50 }], ['bitget', { usd: null }]])
const g = stichtagSaldo(heute, nach, {})
const gb = (b) => g.find((x) => x.boerse === b)
pruefe('Rückrechnung: heute − Ergebnis seither (Verlust addiert sich zurück)', nah(gb('bitunix').usd, 120) && gb('bitunix').sicherheit === 'abgeleitet')
pruefe('ohne Trades seither = heute', nah(gb('pionex').usd, 50))
pruefe('Kontostand heute unbekannt → unbekannt, nicht 0', gb('bitget').usd === null && gb('bitget').sicherheit === 'unbekannt')

const g2 = stichtagSaldo(heute, nach, { pionex: { usd: 42, quelle: 'Auszug' } })
pruefe('Auszugswert ersetzt die Rückrechnung', g2.find((x) => x.boerse === 'pionex').usd === 42 && g2.find((x) => x.boerse === 'pionex').sicherheit === 'beleg')

const g3 = stichtagSaldo(new Map([['bitunix', { usd: 10 }]]), new Map([['bitunix', 30]]), {})
pruefe('negative Rückrechnung (Einzahlung seither) → unbekannt', g3[0].usd === null && g3[0].grund === 'negativ')

const g4 = stichtagSaldo(heute, new Map(), { bitget: { usd: 7 } }, { vorJournal: true })
pruefe('vor dem Journal: nicht der heutige Stand', g4.find((x) => x.boerse === 'bitunix').usd === null && g4.find((x) => x.boerse === 'bitunix').grund === 'vorJournal')
const g5 = stichtagSaldo(heute, new Map(), {}, { vorJournal: new Set(['bitunix']) })
pruefe('vor dem Journal je Börse: nur Bitunix unbekannt', g5.find((x) => x.boerse === 'bitunix').grund === 'vorJournal' && g5.filter((x) => x.grund === 'vorJournal').length === 1)
{
    const bis = Date.parse('2025-01-01T00:00:00+01:00') - 1
    const tr = [{ broker: 'bitunix', exitTime: Date.parse('2025-01-01T14:27:00+01:00') / 1000 }, { broker: 'pionex', exitTime: Date.parse('2025-08-29T00:00:00Z') / 1000 }]
    const vj = vorJournalJe(tr, ['bitunix', 'pionex', 'bitget'], bis)
    pruefe('Journal-Beginn kurz nach Stichtag: Rückrechnung trägt', !vj.has('bitunix'))
    pruefe('Journal-Beginn Monate später: unbekannt', vj.has('pionex'))
    pruefe('Börse ohne Trades: unbekannt', vj.has('bitget'))
}
pruefe('vor dem Journal: Auszugswert gilt trotzdem', g4.find((x) => x.boerse === 'bitget').usd === 7)

console.log(`Futures-Steuer: ${ok} ok, ${fail} Fehler`)
if (fail) process.exit(1)
