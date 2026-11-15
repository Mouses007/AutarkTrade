/**
 * Selbsttest: Übersicht mit einer Aktie und einem Coin gleichen Kürzels (FUN-P-004, BUG-P-005).
 *
 *   node server/portfolio/__selftest-aktien-uebersicht.mjs
 *
 * Läuft gegen eine Wegwerf-Datenbank im Speicher. Das Netz ist abgeklemmt
 * (`fetch` UND axios werfen — `kurse.js` fragt Bitget-Spot direkt über axios —,
 * Marktdaten «aus»): bewertet wird nur, was der Bestand selbst an Kurs trägt,
 * genau der Weg der Bitpanda-Zeilen.
 */
import axios from 'axios'

process.env.AT_DB_FILE = ':memory:'
let netz = 0
const keinNetz = async () => { netz++; throw new Error('kein Netz im Selbsttest') }
globalThis.fetch = keinNetz
axios.defaults.adapter = keinNetz

const { initDb } = await import('../database.js')
const stumm = console.log
console.log = () => {}
const knex = await initDb()
console.log = stumm
const { _setzeLeser } = await import('../marktdaten/index.js')
_setzeLeser(async () => 'aus')
const { berechneUebersicht } = await import('./uebersicht.js')
const { totalverlustUebersicht } = await import('./totalverlust-seite.js')
const { dcaAktienBestand } = await import('./dca.js')

let bestanden = 0, fehlgeschlagen = 0
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}
const nah = (a, b, e = 1e-9) => a != null && Math.abs(a - b) <= e * Math.max(1, Math.abs(b))
const T = (s) => Date.parse(s)
const jetzt = Date.now()

// Bitpanda an, Spot eingeschaltet.
await knex('settings').where('id', 1).update({ portfolioBoersen: JSON.stringify({ bitpanda: { futures: 0, spot: 1 }, bitget: { futures: 0, spot: 1 } }) })
const bewegung = (b) => ({ gegenAsset: null, gegenMenge: null, chfQuelle: 'Test', ...b, roh: b.roh ? JSON.stringify(b.roh) : null })

async function fuelle({ mitAktie }) {
    for (const t of ['portfolio_bestaende', 'portfolio_bewegungen', 'portfolio_quellen']) await knex(t).del()
    const bestand = [
        { quelle: 'bitpanda', ort: 'konto', asset: 'LDO', menge: 5, kursUsd: 2, klasse: null, zeit: jetzt },
        { quelle: 'bitpanda', ort: 'konto', asset: 'BTC', menge: 0.01, kursUsd: 100000, klasse: null, zeit: jetzt },
        { quelle: 'bitget', ort: 'spot', asset: 'LDO', menge: 100, kursUsd: null, klasse: null, zeit: jetzt },
    ]
    const bew = [
        bewegung({ quelle: 'bitget', externeId: 'g1', zeit: T('2025-02-10T10:00:00Z'), art: 'kauf', asset: 'LDO', menge: 100, gegenAsset: 'USDT', gegenMenge: -230, chfWert: 200 }),
        bewegung({ quelle: 'bitpanda', externeId: 'r1', zeit: T('2025-03-10T10:00:00Z'), art: 'staking', asset: 'LDO', menge: 5, chfWert: 15, roh: { operation_type: 'reward', klassen: { LDO: '' } } }),
        bewegung({ quelle: 'bitpanda', externeId: 'b1', zeit: T('2025-05-10T10:00:00Z'), art: 'kauf', asset: 'BTC', menge: 0.01, gegenAsset: 'EUR', gegenMenge: -800, chfWert: 760, roh: { operation_type: 'buy', klassen: { BTC: '' } } }),
    ]
    if (mitAktie) {
        bestand.push({ quelle: 'bitpanda', ort: 'konto', asset: 'LDO', menge: 6, kursUsd: 150, klasse: 'aktie', zeit: jetzt })
        bew.push(
            bewegung({ quelle: 'bitpanda', externeId: 'k1', zeit: T('2025-01-10T10:00:00Z'), art: 'kauf', asset: 'LDO', menge: 10, gegenAsset: 'EUR', gegenMenge: -1050, chfWert: 1000, roh: { operation_type: 'buy', klassen: { LDO: 'aktie' } } }),
            bewegung({ quelle: 'bitpanda', externeId: 'v1', zeit: T('2025-04-10T10:00:00Z'), art: 'verkauf', asset: 'LDO', menge: -4, gegenAsset: 'EUR', gegenMenge: 480, chfWert: 450, roh: { operation_type: 'sell', klassen: { LDO: 'aktie' } } }),
        )
    }
    await knex('portfolio_bestaende').insert(bestand)
    await knex('portfolio_bewegungen').insert(bew)
    await knex('portfolio_quellen').insert([
        { quelle: 'bitpanda', status: 'ok', stand: JSON.stringify({ vollstaendig: true, aktien: mitAktie ? { LDO: 'aktie' } : {} }) },
        { quelle: 'bitget', status: 'ok', stand: '{}' },
    ])
}
const kern = (p) => ({ schluessel: p.schluessel, menge: p.menge, usd: p.usd, kaufkurs: p.kaufkurs, einstandChf: p.einstandChf, unrealisiertChf: p.unrealisiertChf, ohneKurs: p.ohneKurs, orte: p.orte.length })

console.log('\nReines Krypto-Konto (Vergleichsstand)')
await fuelle({ mitAktie: false })
const ohne = await berechneUebersicht({ ohneVerlauf: true })
const fx = ohne.fx.chf
const coinOhne = ohne.posten.find((p) => p.schluessel === 'LDO')
check('reines Krypto-Konto: kein Hinweis auf mehrdeutige Kürzel', Array.isArray(ohne.aktienMehrdeutig) && ohne.aktienMehrdeutig.length === 0)
check('eine Zeile LDO: 105 Stück an zwei Orten, Einstand 215 CHF', ohne.posten.length === 2 && nah(coinOhne.menge, 105) && coinOhne.orte.length === 2 && nah(coinOhne.einstandChf, 215) && !coinOhne.klasse, JSON.stringify(ohne.posten.map(kern)))
check('bewertet über Bitpandas Kurs des Coins (2 USD), für beide Orte', nah(coinOhne.usd, 210) && nah(coinOhne.unrealisiertChf, 210 * fx - 215), JSON.stringify([kern(coinOhne), ohne.fx, netz]))

console.log('\nDazu die Aktie LDO (Leonardo) bei Bitpanda')
await fuelle({ mitAktie: true })
const u = await berechneUebersicht({ ohneVerlauf: true })
const aktie = u.posten.find((p) => p.schluessel === 'LDO|aktie'), coin = u.posten.find((p) => p.schluessel === 'LDO')
check('zwei Positionen: LDO|aktie und LDO', u.posten.length === 3 && !!aktie && !!coin, JSON.stringify(u.posten.map(kern)))
check('Aktie: 6 Stück, Marke «aktie», Kurs 150 USD aus Bitpandas Bewertung, ein Ort', nah(aktie?.menge, 6) && aktie.klasse === 'aktie' && aktie.asset === 'LDO' && nah(aktie.usd, 900) && aktie.kursQuelle === 'Bewertung Bitpanda' && aktie.orte.length === 1)
check('Aktie: Ø-Kaufkurs 100 CHF, Einstand 600, unrealisiert = Wert − 600', nah(aktie?.kaufkurs, 100) && nah(aktie.einstandChf, 600) && nah(aktie.unrealisiertChf, 900 * fx - 600) && !aktie.einstandTeilweise, JSON.stringify(kern(aktie || {})))
check('Coin: Werte wie ohne die Aktie (Menge, Wert, Einstand, unrealisiert)', JSON.stringify(kern(coin)) === JSON.stringify(kern(coinOhne)) && !coin.klasse, JSON.stringify([kern(coin), kern(coinOhne)]))
check('BTC unverändert', JSON.stringify(kern(u.posten.find((p) => p.schluessel === 'BTC'))) === JSON.stringify(kern(ohne.posten.find((p) => p.schluessel === 'BTC'))))
check('Gesamtwert = vorher + Aktie', nah(u.gesamt.usd, ohne.gesamt.usd + 900))
const bp = u.quellen.find((q) => q.quelle === 'bitpanda')
check('Sicht nach Ort: Bitpanda führt Aktie und Coin getrennt', bp.posten.some((p) => p.schluessel === 'LDO|aktie' && p.klasse === 'aktie' && nah(p.menge, 6)) && bp.posten.some((p) => p.schluessel === 'LDO' && !p.klasse && nah(p.menge, 5)))
check('Abgleich Bitpanda: LDO geht auf — Bestand (Aktie + Coin) gegen die Bewegungen des Kürzels', !bp.abgleich.abweichungen.some((a) => a.asset === 'LDO'), JSON.stringify(bp.abgleich))
check('DCA liest den Aktien-Bestand über das Kürzel', nah(dcaAktienBestand(u.quellen).get('LDO')?.menge, 6))

console.log('\nTotalverlust auf das Kürzel meint den Coin')
await knex('settings').where('id', 1).update({ portfolioTotalverlust: JSON.stringify({ LDO: { am: T('2026-01-05T10:00:00Z'), abJahr: 2025 } }) })
const t = await berechneUebersicht({ ohneVerlauf: true })
check('Coin LDO verschwindet aus der Übersicht, die Aktie bleibt', !t.posten.some((p) => p.schluessel === 'LDO') && t.posten.some((p) => p.schluessel === 'LDO|aktie'), JSON.stringify(t.posten.map((p) => p.schluessel)))
const tv = await totalverlustUebersicht()
const z = tv.zeilen.find((x) => x.asset === 'LDO')
check('Totalverlust-Seite: 105 Coins mit Einstand 215 CHF — ohne die Aktien-Stücke', nah(z?.menge, 105) && nah(z.einstandChf, 215), JSON.stringify(z))
check('… und die Aktie zählt zur Kostenbasis des übrigen Portfolios (600 + 760)', nah(tv.statistik.anteilAmEinstand, 215 / (215 + 600 + 760)), JSON.stringify(tv.statistik))

console.log('\nBewertung der Bewegungen: die Art steht an der Zeile (BUG-P-005)')
{
    const { bewerteAlles } = await import('./abruf.js')
    await knex('portfolio_bewegungen').insert([
        { ...bewegung({ quelle: 'bitpanda', externeId: 'r2', zeit: T('2025-06-10T10:00:00Z'), art: 'staking', asset: 'LDO', menge: 1, roh: { operation_type: 'reward', klassen: { LDO: '' } } }), chfQuelle: null },
        { ...bewegung({ quelle: 'bitpanda', externeId: 'd2', zeit: T('2025-06-11T10:00:00Z'), art: 'belohnung', asset: 'LDO', menge: 1, roh: { operation_type: 'onetime_reward', klassen: { LDO: 'aktie' } } }), chfQuelle: null },
        { ...bewegung({ quelle: 'bitpanda', externeId: 'a2', zeit: T('2025-06-12T10:00:00Z'), art: 'belohnung', asset: 'LDO', menge: 1, roh: { operation_type: 'onetime_reward' } }), chfQuelle: null },
    ])
    await bewerteAlles()
    const q = new Map((await knex('portfolio_bewegungen').whereIn('externeId', ['r2', 'd2', 'a2']).select('externeId', 'chfQuelle')).map((x) => [x.externeId, x.chfQuelle]))
    // Ohne Netz gibt es keinen Tageskurs — geprüft wird, WELCHEN Weg die Zeile nimmt.
    check('Staking-Ertrag des Coins LDO geht den Weg über den Tageskurs, nicht «Aktie ohne Handelsbetrag»', q.get('r2') === 'kein Kurs', q.get('r2'))
    check('Stücke der Aktie LDO ohne Geldseite: nie über das Kürzel', q.get('d2') === 'kein Kurs (Aktie ohne Handelsbetrag)', q.get('d2'))
    check('alte Zeile ohne Art, Kürzel ist Aktie UND Coin: Weg des Coins (RAS-02)', q.get('a2') === 'kein Kurs', q.get('a2'))
}

console.log('\nRAS-02: alte Bewegungen ohne Art — Konto mit Aktie LDO und Coin LDO, dazu die reine Aktie AAPL')
{
    const { berechneSteuerjahr } = await import('./steuer.js')
    const { bewerteAlles } = await import('./abruf.js')
    await knex('settings').where('id', 1).update({ portfolioTotalverlust: null })
    for (const t of ['portfolio_bestaende', 'portfolio_bewegungen', 'portfolio_quellen']) await knex(t).del()
    // Wie beim Prüfer: Coin-Kauf und Staking-Ertrag von vor dem 15.11. (Rohfeld ohne `klassen`), ein neuer Ertrag mit Art.
    const alt = (b) => bewegung({ quelle: 'bitpanda', ...b })
    await knex('portfolio_bewegungen').insert([
        alt({ externeId: 'e0', zeit: T('2025-01-05T10:00:00Z'), art: 'einzahlung', asset: 'EUR', menge: 2000, chfWert: 1900, roh: { operation_type: 'deposit' } }),
        alt({ externeId: 'c1', zeit: T('2025-02-01T10:00:00Z'), art: 'kauf', asset: 'LDO', menge: 100, gegenAsset: 'EUR', gegenMenge: -200, chfWert: 190, roh: { operation_type: 'buy' } }),
        alt({ externeId: 'c2', zeit: T('2025-06-01T10:00:00Z'), art: 'staking', asset: 'LDO', menge: 1, chfWert: 2, roh: { operation_type: 'reward' } }),
        alt({ externeId: 'c3', zeit: T('2025-11-20T10:00:00Z'), art: 'staking', asset: 'LDO', menge: 1, chfWert: 2, roh: { operation_type: 'reward', klassen: { LDO: '' } } }),
        alt({ externeId: 'p1', zeit: T('2025-03-01T10:00:00Z'), art: 'kauf', asset: 'AAPL', menge: 2, gegenAsset: 'EUR', gegenMenge: -400, chfWert: 380, roh: { operation_type: 'buy' } }),
        { ...alt({ externeId: 'c4', zeit: T('2025-07-01T10:00:00Z'), art: 'staking', asset: 'LDO', menge: 1, roh: { operation_type: 'reward' } }), chfQuelle: null },
        { ...alt({ externeId: 'p2', zeit: T('2025-07-02T10:00:00Z'), art: 'belohnung', asset: 'AAPL', menge: 0.01, roh: { operation_type: 'onetime_reward' } }), chfQuelle: null },
    ])
    await knex('portfolio_bestaende').insert([
        { quelle: 'bitpanda', ort: 'konto', asset: 'LDO', menge: 103, kursUsd: 2, klasse: null, zeit: jetzt },
        { quelle: 'bitpanda', ort: 'konto', asset: 'AAPL', menge: 2.01, kursUsd: 200, klasse: 'aktie', zeit: jetzt },
        { quelle: 'bitpanda', ort: 'konto', asset: 'EUR', menge: 1400, kursUsd: null, klasse: null, zeit: jetzt },
    ])
    // Die Aktie LDO (Leonardo) ist verkauft; der Stand kennt ihre Kennung noch neben der des Coins.
    await knex('portfolio_quellen').insert([{ quelle: 'bitpanda', status: 'ok', stand: JSON.stringify({
        vollstaendig: true, aktien: { LDO: 'aktie', AAPL: 'aktie' },
        symbole: { 'id-leonardo': 'LDO', 'id-lido': 'LDO', 'id-apple': 'AAPL' }, klassen: { 'id-leonardo': 'aktie', 'id-lido': '', 'id-apple': 'aktie' }, klassenBelegt: true,
    }) }])

    const u = await berechneUebersicht({ ohneVerlauf: true })
    const ldo = u.posten.find((p) => p.schluessel === 'LDO'), apfel = u.posten.find((p) => p.schluessel === 'AAPL|aktie')
    check('Übersicht: Coin LDO hat seinen Einstand (103 Stück, Ø 194 CHF / 102 bewertete Stück)', nah(ldo?.menge, 103) && nah(ldo.kaufkurs, 194 / 102) && !ldo.klasse, JSON.stringify(u.posten.map(kern)))
    check('Übersicht: Aktie AAPL im eigenen Topf (Ø 190 CHF je Stück)', nah(apfel?.menge, 2.01) && nah(apfel.kaufkurs, 190) && apfel.klasse === 'aktie', JSON.stringify(kern(apfel || {})))
    check('Übersicht nennt LDO als nicht eindeutig zugeordnet, AAPL nicht', JSON.stringify(u.aktienMehrdeutig) === '["LDO"]', JSON.stringify(u.aktienMehrdeutig))

    await bewerteAlles()
    const q = new Map((await knex('portfolio_bewegungen').whereIn('externeId', ['c4', 'p2']).select('externeId', 'chfQuelle')).map((x) => [x.externeId, x.chfQuelle]))
    check('Bewertung: alter Staking-Ertrag LDO geht den Weg des Coins', q.get('c4') === 'kein Kurs', q.get('c4'))
    check('Bewertung: geschenkte AAPL-Stücke bleiben «Aktie ohne Handelsbetrag»', q.get('p2') === 'kein Kurs (Aktie ohne Handelsbetrag)', q.get('p2'))

    const st = await berechneSteuerjahr(2025)
    const v = st.vermoegen.find((p) => p.asset === 'LDO')
    check('Steuerbericht 2025: Coin LDO steht im Vermögen (103 Stück)', nah(v?.menge, 103), JSON.stringify(st.vermoegen.map((p) => [p.asset, p.menge])))
    check('… die Aktie AAPL nicht', !st.vermoegen.some((p) => p.asset === 'AAPL'))
    check('Staking-Erträge des Coins sind Einkommen (3 Zeilen, 4 CHF bewertet)', st.einkommen.zeilen.filter((z) => z.asset === 'LDO').length === 3 && nah(st.einkommen.summe, 4), JSON.stringify(st.einkommen.zeilen))
    const kauf = st.veraenderungen.find((x) => x.zu?.asset === 'LDO' && x.ab?.asset === 'EUR')
    check('der Coin-Kauf steht als Kauf in den Veränderungen, nicht als «Auszahlung EUR»', !!kauf && nah(kauf.zu.menge, 100), JSON.stringify(st.veraenderungen))
    check('Hinweis «zugleich Aktie und Coin» mit LDO', st.hinweise.some((h) => h.art === 'aktienMehrdeutig' && h.kuerzel.join() === 'LDO') && st.aktienMehrdeutig.join() === 'LDO', JSON.stringify(st.hinweise.map((h) => h.art)))
    check('Hinweis «Aktien nicht enthalten» nennt nur AAPL', st.aktienNichtEnthalten.join() === 'AAPL', JSON.stringify(st.aktienNichtEnthalten))

    // Gegenprobe: dasselbe Konto ohne den Coin-Beleg — LDO ist dann nur die Aktie.
    await knex('portfolio_bewegungen').whereIn('externeId', ['c2', 'c3', 'c4']).del()
    await knex('portfolio_bestaende').where('asset', 'LDO').update({ klasse: 'aktie', menge: 100 })
    await knex('portfolio_quellen').where('quelle', 'bitpanda').update({ stand: JSON.stringify({ vollstaendig: true, aktien: { LDO: 'aktie', AAPL: 'aktie' }, symbole: { 'id-leonardo': 'LDO', 'id-apple': 'AAPL' }, klassen: { 'id-leonardo': 'aktie', 'id-apple': 'aktie' }, klassenBelegt: true }) })
    const st2 = await berechneSteuerjahr(2025)
    check('Gegenprobe reines Aktien-Kürzel: LDO nicht im Krypto-Vermögen, kein Mehrdeutig-Hinweis', !st2.vermoegen.some((p) => p.asset === 'LDO') && !st2.hinweise.some((h) => h.art === 'aktienMehrdeutig') && st2.aktienNichtEnthalten.join() === 'AAPL,LDO', JSON.stringify([st2.vermoegen.map((p) => p.asset), st2.aktienNichtEnthalten]))
    const u2 = await berechneUebersicht({ ohneVerlauf: true })
    check('… und in der Übersicht eine Aktien-Position mit Einstand 190 CHF, kein Hinweis', nah(u2.posten.find((p) => p.schluessel === 'LDO|aktie')?.einstandChf, 190) && u2.aktienMehrdeutig.length === 0, JSON.stringify(u2.posten.map(kern)))
}

check('jeder Versuch nach aussen lief in die Sperre (Wechselkurs, Bitget-Spot)', netz > 0, String(netz))
await knex.destroy()
console.log(`\naktien-uebersicht: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
process.exit(fehlgeschlagen ? 1 : 0)
