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
    bewegungsKlassen, ladeBewegungsKlassen, identMitAktien, AKTIEN_ANHANG, namenAusListe, bitpandaAktienNamen, ersatzkursErlaubt, stammKurseUsd,
} from './aktien-art.js'
import { tokenIdentitaet } from './token-id.js'
import { einstandJeAsset } from './steuer-rechnung.js'
import { postenSchluessel, einstandSchluessel, einstandFuer } from './uebersicht.js'
import { ausBitpandaOperationen } from './normal.js'
import { _setzeLeser } from '../marktdaten/index.js'
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

console.log('\nBUG-P-005: die Art steht an der Bewegung, nicht am Kürzel der Quelle')
{
    // Bitpanda führt LDO zweimal: Leonardo (Aktie) und Lido (Coin). Zwei Kennungen, ein Kürzel.
    const sym = new Map([['ldo-aktie', 'LDO'], ['ldo-coin', 'LDO'], ['btc', 'BTC'], ['neu', 'NEU'], ['eur', 'EUR']])
    const art = new Map([['ldo-aktie', 'aktie'], ['ldo-coin', ''], ['btc', '']])
    const artVon = (id) => (art.has(id) ? art.get(id) : undefined)
    const tx = (asset, flow, value, extra = {}) => ({ asset_id: asset === 'eur' ? undefined : asset, currency_id: asset === 'eur' ? 'eur' : undefined, flow, asset_amount: { value: String(value) }, credited_at: '2026-03-01T10:00:00Z', ...extra })
    const ops = [
        { operation_id: 'k1', operation_type: 'buy', transactions: [tx('eur', 'OUTGOING', '500'), tx('ldo-aktie', 'INCOMING', '10')] },
        { operation_id: 'r1', operation_type: 'reward', transactions: [tx('ldo-coin', 'INCOMING', '5', { fee_amount: { value: '1', asset_id: 'ldo-coin' } })] },
        { operation_id: 'n1', operation_type: 'reward', transactions: [tx('neu', 'INCOMING', '2')] },
        { operation_id: 'm1', operation_type: 'swap', transactions: [tx('ldo-coin', 'OUTGOING', '1'), tx('ldo-aktie', 'INCOMING', '3'), tx('btc', 'OUTGOING', '0.001')] },
    ]
    const b = ausBitpandaOperationen(ops, sym, artVon)
    const von = (id) => b.find((x) => x.externeId === id)
    check('Aktienkauf hält «aktie» fest, die Geldseite nichts', JSON.stringify(von('k1').roh.klassen) === '{"LDO":"aktie"}', JSON.stringify(von('k1').roh))
    check('Staking-Ertrag des Coins hält «keine Aktie» fest', JSON.stringify(von('r1').roh.klassen) === '{"LDO":""}' && von('r1').art === 'staking' && nah(von('r1').menge, 4))
    check('unbekannte Kennung: nichts festgehalten', !('klassen' in von('n1').roh))
    const misch = b.filter((x) => String(x.externeId).startsWith('m1'))
    check('Aktie und Coin gleichen Kürzels in EINER Operation: offen gelassen', misch.length > 0 && misch.every((x) => !x.roh.klassen || !('LDO' in x.roh.klassen)), JSON.stringify(misch.map((x) => x.roh)))
    const alt = ausBitpandaOperationen(ops, sym)
    check('ohne artVon wie bisher (Mengen, Arten, kein Feld)', alt.every((x) => !('klassen' in x.roh)) && JSON.stringify(alt.map((x) => [x.externeId, x.art, x.asset, x.menge])) === JSON.stringify(b.map((x) => [x.externeId, x.art, x.asset, x.menge])))

    // Lesen: so, wie die Zeilen aus der DB kommen (roh als Text).
    const klasse = aktienKlasseVon(new Map([['LDO', 'aktie']]))
    const zeile = (x, mehr = {}) => ({ quelle: 'bitpanda', zeit: x.zeit, art: x.art, asset: x.asset, menge: x.menge, gegenAsset: x.gegenAsset, gegenMenge: x.gegenMenge, roh: JSON.stringify(x.roh), ...mehr })
    const ertrag = zeile(von('r1'), { id: 2, chfWert: 6 }), kauf = zeile(von('k1'), { id: 1, chfWert: 480 })
    check('Staking-Ertrag LDO ist keine Aktie, obwohl das Konto die Aktie LDO kennt', klasse('bitpanda', 'LDO', ertrag) === null)
    check('… also über das Kürzel bewertbar (Tageskurs), kein «Aktie ohne Handelsbetrag»', bewertbareSeiten(ertrag).kurs?.[0] === 'LDO' && !klasse('bitpanda', bewertbareSeiten(ertrag).kurs[0], ertrag))
    check('Aktienkauf bleibt Aktie', klasse('bitpanda', 'LDO', kauf) === 'aktie' && klasse('bitpanda', 'EUR', kauf) === null)
    const alteZeile = { id: 3, quelle: 'bitpanda', zeit: Date.parse('2025-05-01T10:00:00Z'), art: 'belohnung', asset: 'LDO', menge: 0.5, chfWert: 40, roh: JSON.stringify({ operation_type: 'onetime_reward' }) }
    check('alte Zeile ohne Art: wie bisher der Stand der Quelle', klasse('bitpanda', 'LDO', alteZeile) === 'aktie' && klasse('bitpanda', 'LDO') === 'aktie' && bewegungsKlassen(alteZeile) === null)
    check('andere Quelle bleibt Coin, was immer im Rohfeld steht', klasse('bitget', 'LDO', { roh: { klassen: { LDO: 'aktie' } } }) === null)
    check('Rohfeld als Objekt und nachgetragenes `klassen` werden gelesen', bewegungsKlassen({ roh: { klassen: { LDO: '' } } })?.LDO === '' && bewegungsKlassen({ klassen: { LDO: 'etf' } })?.LDO === 'etf')

    // Steuerbericht: der Ertrag des Coins zählt als Einkommen, der Aktienkauf fällt weg.
    const jahrVon = Date.parse('2025-12-31T23:00:00Z'), jahrBis = Date.parse('2026-12-31T22:59:59Z')
    const o = ohneAktienSeiten([kauf, ertrag, alteZeile], klasse)
    check('ohneAktienSeiten lässt den Staking-Ertrag stehen', o.bewegungen.some((x) => x.id === 2 && x.asset === 'LDO' && nah(x.menge, 4)) && !o.betroffen.has(2) && o.betroffen.has(1))
    const e = einkommen(o.bewegungen, jahrVon, jahrBis)
    check('… und er zählt als Einkommen (6 CHF)', e.zeilen.length === 1 && nah(e.summe, 6), JSON.stringify(e))

    // Nachtragen an Bewegungen, die ohne Rohfeld geladen wurden.
    const knex = knexLib({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })
    await knex.schema.createTable('portfolio_bewegungen', (t) => { t.increments('id'); t.string('quelle'); t.text('roh') })
    await knex('portfolio_bewegungen').insert([
        { id: 1, quelle: 'bitpanda', roh: kauf.roh }, { id: 2, quelle: 'bitpanda', roh: ertrag.roh }, { id: 3, quelle: 'bitpanda', roh: alteZeile.roh },
        { id: 4, quelle: 'bitget', roh: JSON.stringify({ klassen: { LDO: 'aktie' } }) },
    ])
    const geladen = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]
    await ladeBewegungsKlassen(knex, geladen, new Map([['LDO', 'aktie']]))
    check('ladeBewegungsKlassen trägt nur Bitpanda-Zeilen mit Art nach', geladen[0].klassen?.LDO === 'aktie' && geladen[1].klassen?.LDO === '' && !('klassen' in geladen[2]) && !('klassen' in geladen[3]))
    const ohne = [{ id: 1 }, { id: 2 }]
    await ladeBewegungsKlassen(knex, ohne, new Map())
    check('ohne Aktien am Konto wird nichts gelesen', ohne.every((x) => !('klassen' in x)))
    await knex.destroy()
}

console.log('\nFUN-P-004: Aktie und gleichnamiger Coin sind zwei Positionen mit eigenem Einstand')
{
    const T = (s) => Date.parse(s)
    const kl = (k) => ({ klassen: { LDO: k } })
    const bew = [
        { id: 1, quelle: 'bitpanda', zeit: T('2025-01-10T10:00:00Z'), art: 'kauf', asset: 'LDO', menge: 10, gegenAsset: 'EUR', gegenMenge: -1050, chfWert: 1000, ...kl('aktie') },
        { id: 2, quelle: 'bitget', zeit: T('2025-02-10T10:00:00Z'), art: 'kauf', asset: 'LDO', menge: 100, gegenAsset: 'USDT', gegenMenge: -230, chfWert: 200 },
        { id: 3, quelle: 'bitpanda', zeit: T('2025-03-10T10:00:00Z'), art: 'staking', asset: 'LDO', menge: 5, chfWert: 15, ...kl('') },
        { id: 4, quelle: 'bitpanda', zeit: T('2025-04-10T10:00:00Z'), art: 'verkauf', asset: 'LDO', menge: -4, gegenAsset: 'EUR', gegenMenge: 480, chfWert: 450, ...kl('aktie') },
        { id: 5, quelle: 'bitpanda', zeit: T('2025-05-10T10:00:00Z'), art: 'kauf', asset: 'BTC', menge: 0.01, gegenAsset: 'EUR', gegenMenge: -800, chfWert: 760 },
    ]
    const klasse = aktienKlasseVon(new Map([['LDO', 'aktie']]))
    const ident = tokenIdentitaet(bew)
    const lose = fifo(bew, { ident: identMitAktien(ident, klasse) }).lose
    const e = einstandJeAsset(lose)
    const aktie = e.get('LDO' + AKTIEN_ANHANG), coinE = e.get('LDO')
    check('zwei Töpfe: LDO|aktie und LDO', !!aktie && !!coinE && [...e.keys()].sort().join() === 'BTC,LDO,LDO|aktie', [...e.keys()].join())
    check('Aktie: 6 Stück zu 100 CHF (Verkauf nimmt nur Aktien-Lose)', nah(aktie.menge, 6) && nah(aktie.schnitt, 100))
    check('Coin: 105 Stück, Einstand 215 CHF — der Aktienverkauf rührt ihn nicht an', nah(coinE.menge, 105) && nah(coinE.kosten, 215))
    const zusammen = einstandJeAsset(fifo(bew, { ident }).lose).get('LDO')
    check('vorher: EIN Topf mit 111 Stück (der Befund)', nah(zusammen.menge, 111) && !nah(zusammen.schnitt, 100))

    // Positionen der Übersicht.
    const zAktie = { quelle: 'bitpanda', asset: 'LDO', kontrakt: null, klasse: 'aktie', menge: 6 }
    const zCoin = { quelle: 'bitpanda', asset: 'LDO', kontrakt: null, klasse: null, menge: 5 }
    check('Schlüssel: Aktie LDO|aktie, Coin LDO, Token mit Vertrag unverändert', postenSchluessel(zAktie) === 'LDO|aktie' && postenSchluessel(zCoin) === 'LDO' && postenSchluessel({ asset: 'USDT', kontrakt: '0xabc' }) === 'USDT|0xabc')
    const pA = { schluessel: postenSchluessel(zAktie), klasse: 'aktie', kontrakt: null, kette: null, menge: 6, chf: 720, ohneKurs: false }
    const pC = { schluessel: 'LDO', klasse: null, kontrakt: null, kette: null, menge: 105, chf: 210, ohneKurs: false }
    const fA = einstandFuer(e.get(einstandSchluessel(pA, ident)), pA), fC = einstandFuer(e.get(einstandSchluessel(pC, ident)), pC)
    check('Aktien-Zeile: Ø 100, unrealisiert +120', nah(fA.kaufkurs, 100) && nah(fA.unrealisiertChf, 120) && !fA.einstandTeilweise, JSON.stringify(fA))
    check('Coin-Zeile: Ø 215/105, unrealisiert −5', nah(fC.kaufkurs, 215 / 105) && nah(fC.unrealisiertChf, -5) && !fC.einstandTeilweise, JSON.stringify(fC))

    // Reines Krypto-Portfolio: dieselben Lose wie ohne die Hülle.
    const krypto = bew.filter((b) => b.id === 2 || b.id === 5).concat([{ id: 6, quelle: 'a1', zeit: T('2025-06-01T10:00:00Z'), art: 'einzahlung', asset: 'USDT', menge: 50, kontrakt: '0xfalsch', kette: 'evm:1', chfWert: null }])
    const idK = tokenIdentitaet(krypto)
    const mit = fifo(krypto, { ident: identMitAktien(idK, aktienKlasseVon(new Map())) }), ohne = fifo(krypto, { ident: idK })
    check('ohne Aktien: Lose und Abgänge unverändert', JSON.stringify([...mit.lose]) === JSON.stringify([...ohne.lose]) && JSON.stringify(mit.abgaenge) === JSON.stringify(ohne.abgaenge))
    check('… auch mit Aktien am Konto bleiben die Coins anderer Kürzel gleich', JSON.stringify(lose.get('BTC')) === JSON.stringify(fifo(bew, { ident }).lose.get('BTC')))
}

console.log('\nFACH-P-006: Aktien-Future als Ersatzkurs nur, wenn Stamm und Name passen')
{
    const roh = [
        { pid: 'p-ai', id: '1', symbol: 'AI', name: 'Air Liquide', group: 'stock' },
        { pid: 'p-aapl', id: '2', symbol: 'AAPL', name: 'Apple', group: 'stock' },
        { pid: 'p-x1', id: '3', symbol: 'DUP', name: 'Erste Firma', group: 'stock' },
        { pid: 'p-x2', id: '4', symbol: 'DUP', name: 'Zweite Firma', group: 'etf' },
        { pid: 'p-ldo', id: '5', symbol: 'LDO', name: 'Lido DAO', group: 'coin' },
    ]
    const namen = namenAusListe(roh)
    check('Name je Aktien-Kürzel; doppelt vergebenes Kürzel und Coins fehlen', namen.get('AI') === 'Air Liquide' && namen.get('AAPL') === 'Apple' && !namen.has('DUP') && !namen.has('LDO') && namenAusListe(null).size === 0)
    const stand = [{ quelle: 'bitget', stand: '{"aktienNamen":{"X":"Y"}}' }, { quelle: 'bitpanda', stand: JSON.stringify({ aktienNamen: { ai: 'Air Liquide', AAPL: 'Apple' } }) }]
    check('Namen aus dem Stand des Bitpanda-Abrufs', bitpandaAktienNamen(stand).get('AI') === 'Air Liquide' && bitpandaAktienNamen(stand).size === 2 && bitpandaAktienNamen([{ quelle: 'bitpanda', stand: 'kaputt' }]).size === 0)

    const apple = { ticker: 'AAPL', name: 'Apple Inc.', region: null }
    check('Apple: Bitpanda-Listung, Name passt, Kurssymbol AAPL → erlaubt', ersatzkursErlaubt({ titel: apple, bitpandaListung: true, kursSymbol: 'AAPL', bitpandaName: 'Apple' }) === true)
    check('AI: Stamm kennt C3.ai, Bitpanda hält Air Liquide → kein Ersatzkurs', ersatzkursErlaubt({ titel: { ticker: 'AI', name: 'C3.ai, Inc.' }, bitpandaListung: true, kursSymbol: 'AI', bitpandaName: 'Air Liquide' }) === false)
    check('AI: Stamm-Name von Bitpanda (Air Liquide), Kursquelle fand AI.PA → kein Ersatzkurs', ersatzkursErlaubt({ titel: { ticker: 'AI', name: 'Air Liquide' }, bitpandaListung: true, kursSymbol: 'AI.PA', bitpandaName: 'Air Liquide' }) === false)
    check('ohne Bitpanda-Listung im Stamm kein Ersatzkurs', ersatzkursErlaubt({ titel: apple, bitpandaListung: false, kursSymbol: 'AAPL', bitpandaName: 'Apple' }) === false)
    check('ohne Namen oder ohne Newcomer-Lauf kein Ersatzkurs', !ersatzkursErlaubt({ titel: apple, bitpandaListung: true, kursSymbol: 'AAPL', bitpandaName: null }) && !ersatzkursErlaubt({ titel: apple, bitpandaListung: true, kursSymbol: null, bitpandaName: 'Apple' }) && !ersatzkursErlaubt({ titel: { ticker: 'AAPL', name: null }, bitpandaListung: true, kursSymbol: 'AAPL', bitpandaName: 'Apple' }))

    // Gegen einen Stamm im Speicher; die Preise kommen herein, kein Netz.
    const knex = knexLib({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })
    await knex.schema.createTable('instrumente', (t) => { t.increments('id'); t.string('anlageklasse'); t.string('ticker'); t.string('name'); t.string('region') })
    await knex.schema.createTable('instrument_listungen', (t) => { t.increments('id'); t.integer('instrumentId'); t.string('handelsplatz'); t.string('symbol'); t.string('art'); t.integer('aktiv') })
    await knex.schema.createTable('newcomer_titel', (t) => { t.increments('id'); t.integer('instrumentId'); t.string('kursSymbol') })
    await knex('instrumente').insert([
        { id: 1, anlageklasse: 'aktien', ticker: 'AAPL', name: 'Apple Inc.' },
        { id: 2, anlageklasse: 'aktien', ticker: 'AI', name: 'Air Liquide' },          // Name von Bitpanda, Future = C3.ai
        { id: 3, anlageklasse: 'aktien', ticker: 'AA', name: 'Alcoa Corporation' },    // Name der Kursquelle, Bitpanda = Anglo American
        { id: 4, anlageklasse: 'aktien', ticker: 'NVDA', name: 'NVIDIA Corporation' }, // ohne Bitpanda-Listung
        { id: 5, anlageklasse: 'krypto', ticker: 'AAPL', name: 'Apple Inc.' },
    ])
    const l = (instrumentId, handelsplatz, symbol, art, aktiv = 1) => ({ instrumentId, handelsplatz, symbol, art, aktiv })
    await knex('instrument_listungen').insert([
        l(1, 'bitget', 'AAPLUSDT', 'perp'), l(1, 'bitpanda', 'p-aapl', 'broker-spot'),
        l(2, 'bitget', 'AIUSDT', 'perp'), l(2, 'bitpanda', 'p-ai', 'broker-spot'),
        l(3, 'bitget', 'AAUSDT', 'perp'), l(3, 'bitpanda', 'p-aa', 'broker-spot'),
        l(4, 'bitget', 'NVDAUSDT', 'perp'),
    ])
    await knex('newcomer_titel').insert([{ instrumentId: 1, kursSymbol: 'AAPL' }, { instrumentId: 2, kursSymbol: 'AI.PA' }, { instrumentId: 3, kursSymbol: 'AA' }, { instrumentId: 4, kursSymbol: 'NVDA' }])
    _setzeLeser(async () => 'bitget')
    let geholt = 0
    const holePreise = async () => { geholt++; return new Map([['AAPLUSDT', 356], ['AIUSDT', 30], ['AAUSDT', 40], ['NVDAUSDT', 190]]) }
    const bpNamen = new Map([['AAPL', 'Apple'], ['AI', 'Air Liquide'], ['AA', 'Anglo American'], ['NVDA', 'Nvidia']])
    const k = await stammKurseUsd(knex, ['aapl', 'AI', 'AA', 'NVDA', 'MC'], bpNamen, { holePreise })
    check('nur Apple bekommt den Future-Kurs', k.size === 1 && k.get('AAPL')?.usd === 356 && k.get('AAPL').quelle === 'Aktien-Future AAPLUSDT (≈)', JSON.stringify([...k]))
    check('Air Liquide (AI), Anglo American (AA): kein Kurs einer anderen Firma', !k.has('AI') && !k.has('AA') && aktienZeilenKurs({ asset: 'AI', kursUsd: null }, k).quelle === 'kein Kurs (Aktie)')
    geholt = 0
    const ohneNamen = await stammKurseUsd(knex, ['AAPL'], new Map(), { holePreise })
    check('ohne Bitpanda-Namen kein Ersatzkurs und kein Preisabruf', ohneNamen.size === 0 && geholt === 0)
    const nurFremde = await stammKurseUsd(knex, ['AI', 'AA'], bpNamen, { holePreise })
    check('passt kein Titel, werden keine Preise geholt', nurFremde.size === 0 && geholt === 0)
    await knex('newcomer_titel').where('instrumentId', 1).del()
    check('ohne Newcomer-Lauf (Name ungeprüft) kein Ersatzkurs', (await stammKurseUsd(knex, ['AAPL'], bpNamen, { holePreise })).size === 0)
    await knex.destroy()
}

console.log(`\naktien-art: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
process.exit(fehlgeschlagen ? 1 : 0)
