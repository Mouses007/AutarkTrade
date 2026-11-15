/**
 * Selbsttest: Aktien und ETFs im Spot-Portfolio (Bitpanda) als eigene Art.
 *
 *   node server/portfolio/__selftest-aktien-art.mjs
 *
 * Gegen die öffentliche Bitpanda-Asset-Liste (Aufnahme `server/fixtures/aktien-listungen.json`).
 * Die Antwort der privaten API für ein Konto MIT Aktien ist nicht aufgezeichnet —
 * geprüft wird hier die Regel, nicht die Feldnamen jener Antwort.
 */
import { readFileSync } from 'node:fs'
import { klasseAusAsset, klasseAusStamm, aktienZeilenKurs, KLASSEN } from './aktien-art.js'
import { ausBitpandaPortfolio } from './normal.js'
import { ausBitpanda } from '../aktien/einordnung.js'
import { bewertbareSeiten } from './abruf.js'

let bestanden = 0, fehlgeschlagen = 0
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}
const nah = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b))

const liste = JSON.parse(readFileSync(new URL('../fixtures/aktien-listungen.json', import.meta.url), 'utf8')).bitpanda
// So, wie der Stamm die Liste ablegt: Listungs-Symbol = pid, Unterart aus der Gruppe.
const stamm = new Map()
for (const a of liste) {
    const l = ausBitpanda(a)
    if (KLASSEN.includes(l.unterart)) stamm.set(l.symbol, { ticker: l.basis ?? l.ticker ?? a.symbol, unterart: l.unterart })
}
const von = (symbol) => liste.find((a) => a.symbol === symbol)
const aapl = von('AAPL'), gold = von('XAU')
const etf = liste.find((a) => a.group === 'etf')
const coin = liste.find((a) => !['stock', 'etf', 'etc', 'metal', 'index'].includes(a.group))

console.log('\nArt aus Bitpandas Angabe am Asset')
check('group stock → aktie', klasseAusAsset({ group: 'stock' }) === 'aktie')
check('type etf → etf', klasseAusAsset({ type: 'ETF' }) === 'etf')
check('Metall, Coin, leer → keine eigene Art', klasseAusAsset({ group: 'metal' }) === null && klasseAusAsset({ group: 'cryptocoin' }) === null && klasseAusAsset({}) === null && klasseAusAsset(null) === null)
check('öffentliche Liste: Apple ist eine Aktie', !!aapl && klasseAusAsset(aapl) === 'aktie', JSON.stringify(aapl))
check('öffentliche Liste: Gold ist keine', !!gold && klasseAusAsset(gold) === null)

console.log('\nArt über den Titel-Stamm (Kennung, nie das Kürzel)')
check('Stamm kennt Aktien und ETFs der Liste', stamm.size > 2, `${stamm.size} Einträge`)
check('pid von Apple → aktie', klasseAusStamm(stamm, aapl.pid) === 'aktie')
check('zweite Kennung zählt auch (id unbekannt, pid bekannt)', klasseAusStamm(stamm, 'gibt-es-nicht', aapl.pid) === 'aktie')
if (etf) check('pid eines ETF → etf', klasseAusStamm(stamm, etf.pid) === 'etf')
check('Gold steht nicht als Aktie im Stamm', klasseAusStamm(stamm, gold.pid) === null)
if (coin) check('Coin steht nicht im Stamm', klasseAusStamm(stamm, coin.pid) === null)
check('das Kürzel allein reicht nicht', klasseAusStamm(stamm, 'AAPL') === null)
check('ohne Stamm: unbekannt', klasseAusStamm(new Map(), aapl.pid) === null && klasseAusStamm(null, aapl.pid) === null)

console.log('\nBestand aus /portfolio')
{
    const symbole = new Map([[aapl.pid, 'AAPL'], ['btc-id', 'BTC'], ['t-id', 'T'], ['eur', 'EUR'], ['leer-id', 'ETH']])
    const klassen = new Map([['t-id', 'aktie']])
    const klasseVon = (id) => klassen.get(id) || klasseAusStamm(stamm, id) || null
    const zeile = (asset_id, menge, wert) => ({ asset_id, balance: { value: String(menge) }, currency_balance: wert == null ? undefined : { value: String(wert), currency_id: 'eur' } })
    const b = ausBitpandaPortfolio([zeile(aapl.pid, 2, 400), zeile('btc-id', 0.1, 6000), zeile('t-id', 10, 250), zeile('leer-id', 0, 0), zeile('btc-id', 0.5)], symbole, { usdJeEur: 1.1, klasseVon })
    const a = b.find((x) => x.asset === 'AAPL')
    check('Aktie trägt ihre Art', a?.klasse === 'aktie')
    check('Aktie: Kurs aus Bitpandas Bewertung (EUR → USD)', nah(a.kursUsd, 400 / 2 * 1.1), String(a?.kursUsd))
    check('Coin bleibt ohne Art', !('klasse' in b.find((x) => x.asset === 'BTC')))
    check('Aktie mit Coin-gleichem Kürzel (T) ist über die Kennung Aktie', b.find((x) => x.asset === 'T')?.klasse === 'aktie')
    check('leere Position fällt weg', !b.some((x) => x.asset === 'ETH') && b.length === 4)
    check('ohne Bewertung bleibt der Kurs null', b.filter((x) => x.asset === 'BTC')[1].kursUsd === null)
    const alt = ausBitpandaPortfolio([zeile('btc-id', 0.1, 6000)], symbole, { usdJeEur: 1.1 })
    check('ohne klasseVon wie bisher', alt.length === 1 && !('klasse' in alt[0]) && nah(alt[0].kursUsd, 66000))
}

console.log('\nKurs einer Aktien-Zeile')
{
    const future = new Map([['AAPL', { usd: 356, quelle: 'Aktien-Future AAPLUSDT (≈)' }]])
    check('Bitpandas Bewertung zuerst', aktienZeilenKurs({ asset: 'AAPL', kursUsd: 220 }, future).usd === 220 && aktienZeilenKurs({ asset: 'AAPL', kursUsd: 220 }, future).quelle === 'Bewertung Bitpanda')
    check('sonst der Aktien-Future aus dem Stamm', aktienZeilenKurs({ asset: 'aapl', kursUsd: null }, future).usd === 356)
    check('sonst kein Kurs — nie geraten', aktienZeilenKurs({ asset: 'T', kursUsd: 0 }, future).usd === null && aktienZeilenKurs({ asset: 'T' }).quelle === 'kein Kurs (Aktie)')
}

console.log('\nBewegungen: ein Aktienkauf wird über den bezahlten Betrag bewertet')
{
    const kauf = { quelle: 'bitpanda', art: 'kauf', asset: 'AAPL', menge: 2, gegenAsset: 'EUR', gegenMenge: 400 }
    const s = bewertbareSeiten(kauf)
    check('Geldseite EUR, kein Kurs über das Kürzel', s.geld?.[0] === 'EUR' && s.kurs === null, JSON.stringify(s))
}

console.log(`\naktien-art: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
process.exit(fehlgeschlagen ? 1 : 0)
