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
import {
    klasseAusAsset, klasseAusStamm, aktienZeilenKurs, KLASSEN, bitpandaAktienArten, bitpandaAktienKuerzel, aktienKlasseVon, ohneAktienSeiten, aktienHinweis,
    gruppeGenannt, kennungenAusListe, klasseAusListe, bestimmeKlasse, gemerkteKlassen, trageKlassenNach,
} from './aktien-art.js'
import { holeBitpandaListe, bitpandaListeGemerkt, vergissBitpandaListe } from '../aktien/bitpanda-liste.js'
import { bestandAm, veraenderungen, einkommen, fifo, bestandesrechnung } from './steuer-rechnung.js'
import { steuerCsv } from './steuer.js'
import knexLib from 'knex'
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

console.log('\nArt über Bitpandas öffentliche Liste — ohne Aktien-Modus, ohne Stamm (FUN-P-002)')
{
    const kennungen = kennungenAusListe(liste)
    check('Liste → Kennungen nur für Aktien und ETFs', kennungen.get(aapl.pid)?.unterart === 'aktie' && !kennungen.has(gold.pid) && (!coin || !kennungen.has(coin.pid)), `${kennungen.size} Einträge`)
    if (etf) check('ETF der Liste → etf', klasseAusListe(kennungen, null, etf.pid) === 'etf')
    check('pid von Apple → aktie, auch ohne Kürzel', klasseAusListe(kennungen, null, aapl.pid) === 'aktie')
    check('kurze id zählt nur mit passendem Kürzel', klasseAusListe(kennungen, 'AAPL', aapl.id) === 'aktie' && klasseAusListe(kennungen, 'BTC', aapl.id) === null && klasseAusListe(kennungen, null, aapl.id) === null)
    check('das Kürzel allein reicht nicht', klasseAusListe(kennungen, 'AAPL', 'AAPL') === null && klasseAusListe(kennungen, 'AAPL') === null)
    check('leere oder fehlende Liste: unbekannt', kennungenAusListe(null).size === 0 && klasseAusListe(new Map(), 'AAPL', aapl.pid) === null && klasseAusListe(null, 'AAPL', aapl.pid) === null)

    // Werkszustand: Aktien-Modus aus → Stamm leer. Die private API nennt KEINE Gruppe (nachgebaute Antwort).
    const leer = new Map()
    const ohneGruppe = { id: aapl.pid, symbol: 'AAPL', name: 'Apple' }
    check('vorher: ohne Gruppe und ohne Stamm blieb die Aktie ein Coin', (klasseAusAsset(ohneGruppe) || klasseAusStamm(leer, ohneGruppe.id, ohneGruppe.pid) || '') === '')
    const e1 = bestimmeKlasse({ asset: ohneGruppe, id: aapl.pid, stamm: leer, liste: kennungen })
    check('jetzt: die öffentliche Liste macht sie zur Aktie', e1.klasse === 'aktie' && e1.belegt === true)
    check('Gruppe am Asset gilt weiter zuerst', bestimmeKlasse({ asset: { id: 'x', symbol: 'ZZZ', group: 'etf' }, id: 'x', stamm: leer, liste: leer }).klasse === 'etf')
    check('Stamm gilt weiter', bestimmeKlasse({ id: aapl.pid, stamm, liste: leer }).klasse === 'aktie')
    const c1 = bestimmeKlasse({ asset: { id: 'btc-id', symbol: 'BTC' }, id: 'btc-id', stamm: leer, liste: kennungen })
    check('Coin mit Liste: keine Aktie, und das ist belegt', c1.klasse === null && c1.belegt === true)
    const c2 = bestimmeKlasse({ asset: { id: 'btc-id', symbol: 'BTC' }, id: 'btc-id', stamm: leer, liste: leer })
    check('ohne Gruppe, Stamm und Liste: unbekannt — NICHT belegt', c2.klasse === null && c2.belegt === false)
    check('nennt Bitpanda eine Gruppe, ist «keine Aktie» belegt', gruppeGenannt({ group: 'cryptocoin' }) && !gruppeGenannt({ symbol: 'BTC' }) && !gruppeGenannt(null)
        && bestimmeKlasse({ asset: { id: 'b', group: 'cryptocoin' }, id: 'b' }).belegt === true)

    // Ein Abruf des Kontos (Netz hereingereicht): AAPL und T ohne Gruppe, BTC, eine Kennung ohne Antwort.
    const antworten = { [aapl.pid]: { data: [ohneGruppe] }, 'btc-id': { data: [{ id: 'btc-id', symbol: 'BTC' }] }, 'kaputt': null }
    let abrufe = []
    const holeAsset = async (id) => { abrufe.push(id); if (antworten[id] === null) throw new Error('HTTP 500'); return antworten[id] || { data: [] } }
    const ids = [aapl.pid, 'btc-id', 'kaputt']

    // Lauf 1: die Liste war nicht abrufbar und der Stamm ist leer
    let symbole = new Map(), klassen = new Map()
    let r = await trageKlassenNach(ids, { symbole, klassen, stamm: leer, liste: kennungenAusListe(null), holeAsset })
    check('Lauf ohne Liste: Kürzel gelernt, aber kein «keine Aktie» gemerkt', symbole.get(aapl.pid) === 'AAPL' && klassen.size === 0 && r.offen.length === 3, JSON.stringify([...klassen]))
    // Lauf 2: die Liste ist da — dieselben IDs werden neu gefragt und jetzt richtig eingeordnet
    abrufe = []
    r = await trageKlassenNach(ids, { symbole, klassen, stamm: leer, liste: kennungen, holeAsset })
    check('Lauf mit Liste: Aktie erkannt, Coin als Coin gemerkt', klassen.get(aapl.pid) === 'aktie' && klassen.get('btc-id') === '' && abrufe.length === 3, JSON.stringify([...klassen]))
    check('gescheiterter Abruf: nichts gemerkt', !klassen.has('kaputt') && r.offen.join() === 'kaputt')
    // Lauf 3: was belegt ist, wird nicht mehr gefragt
    abrufe = []
    await trageKlassenNach(ids, { symbole, klassen, stamm: leer, liste: kennungen, holeAsset })
    check('Folgelauf fragt nur das Offene', abrufe.join() === 'kaputt')
    // Kennung, zu der die private API nichts liefert: die Liste entscheidet trotzdem
    symbole = new Map(); klassen = new Map()
    await trageKlassenNach([aapl.pid], { symbole, klassen, stamm: leer, liste: kennungen, holeAsset: async () => ({ data: [] }) })
    check('leere Antwort der privaten API: Art aus der Liste', klassen.get(aapl.pid) === 'aktie')

    // Stand von vor dieser Fassung: '' wurde auch ohne Stamm gemerkt → einmal vergessen, Aktien bleiben
    const alt = gemerkteKlassen({ klassen: { a: '', b: 'aktie', c: '' } })
    check('alter Stand: gemerktes «keine Aktie» verfällt, erkannte Aktie bleibt', alt.size === 1 && alt.get('b') === 'aktie')
    const neu = gemerkteKlassen({ klassen: { a: '', b: 'etf' }, klassenBelegt: true })
    check('neuer Stand: belegtes «keine Aktie» bleibt gemerkt', neu.size === 2 && neu.get('a') === '' && gemerkteKlassen({}).size === 0 && gemerkteKlassen(null).size === 0)
    // …und damit wird die Aktie, die im ersten Lauf als '' gemerkt wurde, beim nächsten Lauf erkannt
    symbole = new Map([[aapl.pid, 'AAPL']]); klassen = gemerkteKlassen({ klassen: { [aapl.pid]: '' } })
    await trageKlassenNach([aapl.pid], { symbole, klassen, stamm: leer, liste: kennungen, holeAsset })
    check('früher als «keine Aktie» gemerkte Apple-Position wird nachträglich Aktie', klassen.get(aapl.pid) === 'aktie')
}

console.log('\nÖffentliche Liste: Abruf (Netz hereingereicht) und Speicher')
{
    const seite = (n) => ({ data: Array.from({ length: n }, (_, i) => ({ attributes: { pid: `p${i}`, id: String(i), symbol: `S${i}`, group: 'stock' } })) })
    let rufe = []
    const hole = async (url) => { rufe.push(url); return /page=1$/.test(url) ? seite(500) : seite(3) }
    const alle = await holeBitpandaListe(hole)
    check('blättert, bis eine Seite nicht voll ist', alle.length === 503 && rufe.length === 2 && rufe.every((u) => u.startsWith('https://api.bitpanda.com/v3/assets?')))
    vergissBitpandaListe()
    check('Abruf gescheitert und nichts gemerkt: null (unbekannt), nicht []', (await bitpandaListeGemerkt({ hole: async () => { throw new Error('aus') }, jetzt: 1000 })) === null)
    check('leere Antwort gilt nicht als Liste', (await bitpandaListeGemerkt({ hole: async () => ({ data: [] }), jetzt: 1000 })) === null)
    rufe = []
    const l1 = await bitpandaListeGemerkt({ hole, jetzt: 2000 })
    const l2 = await bitpandaListeGemerkt({ hole: async () => { throw new Error('darf nicht fragen') }, jetzt: 2000 + 3600e3 })
    check('zwölf Stunden aus dem Speicher', l1.length === 503 && l2 === l1 && rufe.length === 2)
    const l3 = await bitpandaListeGemerkt({ hole: async () => { throw new Error('aus') }, jetzt: 2000 + 13 * 3600e3 })
    check('Abruf scheitert nach Ablauf: die alte Liste gilt weiter', l3 === l1)
    vergissBitpandaListe()
}

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

console.log('\nSteuerbericht: Aktie SUI (Sun Communities) bei Bitpanda gehört nicht ins Krypto-Vermögen (FACH-P-001)')
{
    // Stand der Quelle wie nach einem Bitpanda-Abruf — Wegwerf-Datenbank im Speicher.
    const knex = knexLib({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })
    await knex.schema.createTable('portfolio_quellen', (t) => { t.string('quelle'); t.text('stand') })
    await knex('portfolio_quellen').insert([
        { quelle: 'bitpanda', stand: JSON.stringify({ aktien: { SUI: 'aktie', VWCE: 'etf' } }) },
        { quelle: 'bitget', stand: JSON.stringify({ aktien: { BTC: 'aktie' } }) },      // zählt nicht: nur Bitpanda meldet Aktien
    ])
    const arten = await bitpandaAktienArten(knex)
    check('Arten aus dem Bitpanda-Stand', arten.get('SUI') === 'aktie' && arten.get('VWCE') === 'etf' && arten.size === 2)
    check('Kürzel-Menge unverändert nutzbar', (await bitpandaAktienKuerzel(knex)).has('SUI'))
    await knex.destroy()
    const klasse = aktienKlasseVon(arten)
    check('Bitpanda SUI = Aktie', klasse('bitpanda', 'sui') === 'aktie')
    check('SUI einer anderen Quelle = Coin (nicht nach Kürzel allein)', klasse('bitget', 'SUI') === null && klasse('i:Bitpanda', 'SUI') === null && klasse('a7', 'SUI') === null)
    check('Coin bei Bitpanda bleibt Coin', klasse('bitpanda', 'BTC') === null)

    const T = (s) => Date.parse(s)
    const bew = [
        { id: 1, quelle: 'bitpanda', zeit: T('2025-02-01T10:00:00Z'), art: 'einzahlung', asset: 'EUR', menge: 2000 },
        { id: 2, quelle: 'bitpanda', zeit: T('2025-03-01T10:00:00Z'), art: 'kauf', asset: 'SUI', menge: 4, gegenAsset: 'EUR', gegenMenge: -480, gebuehrAsset: 'EUR', gebuehrMenge: 1, chfWert: 460 },
        { id: 3, quelle: 'bitpanda', zeit: T('2025-04-01T10:00:00Z'), art: 'kauf', asset: 'BTC', menge: 0.01, gegenAsset: 'EUR', gegenMenge: -800, chfWert: 760 },
        { id: 4, quelle: 'bitget', zeit: T('2025-05-01T10:00:00Z'), art: 'kauf', asset: 'SUI', menge: 100, gegenAsset: 'USDT', gegenMenge: -350, chfWert: 300 },
        { id: 5, quelle: 'bitpanda', zeit: T('2025-06-01T10:00:00Z'), art: 'verkauf', asset: 'SUI', menge: -1, gegenAsset: 'EUR', gegenMenge: 130, chfWert: 122 },
        { id: 6, quelle: 'bitpanda', zeit: T('2025-07-01T10:00:00Z'), art: 'belohnung', asset: 'SUI', menge: 0.01, chfWert: 1.2 },
        { id: 7, quelle: 'bitpanda', zeit: T('2025-08-01T10:00:00Z'), art: 'kauf', asset: 'VWCE', menge: 2, gegenAsset: 'EUR', gegenMenge: -250, chfWert: 240 },
        { id: 8, quelle: 'bitpanda', zeit: T('2026-02-01T10:00:00Z'), art: 'kauf', asset: 'SUI', menge: 1, gegenAsset: 'EUR', gegenMenge: -120, chfWert: 115 },
    ]
    const bis = T('2025-12-31T22:59:59Z'), von = T('2024-12-31T23:00:00Z')
    const vorher = bestandAm(bew, bis)
    check('vorher: die Aktie stünde als Coin im Bestand', nah(vorher.get('bitpanda\u0000SUI'), 3.01))
    const o = ohneAktienSeiten(bew, klasse)
    const m = bestandAm(o.bewegungen, bis)
    check('Aktie SUI bei Bitpanda steht nicht im Vermögen', !m.has('bitpanda\u0000SUI') && !m.has('bitpanda\u0000VWCE'), JSON.stringify([...m]))
    check('kein Kürzel SUI bei Bitpanda → nichts, was über den Sui-Kurs bewertet würde', ![...m.keys()].some((key) => key.startsWith('bitpanda') && key.includes('SUI')))
    check('echter Coin SUI bei Bitget bleibt enthalten', nah(m.get('bitget\u0000SUI'), 100))
    check('Coin bei Bitpanda bleibt', nah(m.get('bitpanda\u0000BTC'), 0.01))
    check('Geldseite bleibt: EUR-Guthaben stimmt weiter', nah(m.get('bitpanda\u0000EUR'), vorher.get('bitpanda\u0000EUR')) && nah(m.get('bitpanda\u0000EUR'), 2000 - 480 - 1 - 800 + 130 - 250))
    check('Eingabe unverändert (rein)', bew[1].asset === 'SUI' && bew[1].art === 'kauf')
    const v = veraenderungen(o.bewegungen, von, bis).filter((x) => !o.betroffen.has(x.id))
    check('Veränderungen ohne die Aktie', v.map((x) => x.id).join() === '1,3,4' && !v.some((x) => x.zu?.asset === 'VWCE'), JSON.stringify(v.map((x) => x.id)))
    check('Erträge: Aktien-Stücke sind kein Krypto-Einkommen', einkommen(o.bewegungen, von, bis).zeilen.length === 0 && einkommen(bew, von, bis).zeilen.length === 1)
    const f = fifo(o.bewegungen, { von, bis })
    check('Veräusserungen: kein Abgang der Aktie, Lose nur für Coins', f.abgaenge.every((a) => a.asset !== 'SUI') && [...f.lose.keys()].sort().join() === 'BTC,SUI', JSON.stringify([...f.lose.keys()]))
    check('Los SUI ist allein der Coin (100 Stück)', nah((f.lose.get('SUI') || []).reduce((s, l) => s + l.menge, 0), 100))
    const br = bestandesrechnung(o.bewegungen, von, bis, new Map(), new Map([['SUI', 100], ['BTC', 0.01]]))
    check('Bestandesrechnung SUI = nur der Coin', nah(br.find((z) => z.asset === 'SUI').zugang, 100) && !br.some((z) => z.asset === 'VWCE'))
    check('betroffen = die gekürzten Bewegungen', [...o.betroffen].sort().join() === '2,5,6,7,8')
    const liste = new Map([...o.kuerzel].filter(([, e]) => e.ersteZeit <= bis).map(([a, e]) => [a, e.klasse]))
    const h = aktienHinweis(liste)
    check('Hinweis: 2 Aktien/ETF mit Kürzeln', h?.art === 'aktien' && h.n === 2 && h.kuerzel.join() === 'SUI,VWCE' && /Wertschriftenverzeichnis/.test(h.text), JSON.stringify(h))
    check('ohne Aktien kein Hinweis', aktienHinweis(new Map()) === null && ohneAktienSeiten(bew, () => null).bewegungen.length === bew.length)
    // Tausch Coin ↔ Aktie: die Coin-Seite bleibt als Abgang des Coins.
    const t = ohneAktienSeiten([{ id: 9, quelle: 'bitpanda', zeit: 1, art: 'tausch', asset: 'SUI', menge: 1, gegenAsset: 'BTC', gegenMenge: -0.002, gebuehrAsset: 'SUI', gebuehrMenge: 0.001, chfWert: 120 }], klasse).bewegungen
    check('Tausch BTC → Aktie: BTC-Abgang bleibt, Gebühr in Aktien-Stücken nicht', t.length === 1 && t[0].asset === 'BTC' && t[0].menge === -0.002 && t[0].art === 'auszahlung' && !t[0].gegenAsset && !t[0].gebuehrAsset)
    const csv = steuerCsv({ jahr: 2025, vermoegen: [], vermoegenSumme: 0, einkommen: { zeilen: [], summe: 0 }, aktienNichtEnthalten: h.kuerzel })
    check('CSV nennt die ausgelassenen Aktien', /Nicht enthalten: 2 Aktien\/ETF bei Bitpanda \(SUI, VWCE\)/.test(csv))
}

console.log(`\naktien-art: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
process.exit(fehlgeschlagen ? 1 : 0)
