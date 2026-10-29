/**
 * Selbsttest Token-Identität (Audit FUN-PRT-001, 26.10.2026).
 *
 *   node server/portfolio/__selftest-token-id.mjs
 *
 * Ein echter USDT (Herausgeber-Vertrag) und ein gefälschter „USDT“ aus
 * Address-Poisoning an DERSELBEN Adresse. Bis zum Audit galt das Kürzel als
 * Identität: der Bestand war die Summe (251 000 USDT), jede Einzahlung namens
 * USDT galt 1 USD und als eigene Herkunft, „USDT: Spam“ von Hand nahm den echten
 * mit, und die Transferpaarung nahm den zeitlich näheren — den falschen.
 *
 * Geprüft wird in beide Richtungen: der falsche wird getrennt, und alles ohne
 * Vertrag (Börsen, Importe, native Coins) rechnet wie vorher.
 */
import { tokenIdentitaet, istKanon, kanonKennt, spamHandUmschreiben, gegenKontraktVon } from './token-id.js'
import { bestandAm, fifo, einstandJeAsset, einstandZusammen } from './steuer-rechnung.js'
import { tokenOrteVon, kursAn, TOKEN } from './steuer.js'
import { assetsMitHerkunft, spamEntscheid } from './spam.js'
import { ordneTransfers } from './normal.js'
import { bewertbareSeiten } from './abruf.js'
import { poolKursGilt } from './kurse.js'

let bestanden = 0, fehlgeschlagen = 0
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}
const nah = (a, b, e = 1e-9) => Math.abs(a - b) <= e * Math.max(1, Math.abs(b))
const T = (s) => Date.parse(s)

const ECHT = '0xdac17f958d2ee523a2206206994597c13d831ec7'     // Tether, Ethereum
const FALSCH = '0x' + 'f'.repeat(40)
const PEPE = '0x6982508145454ce325ddbe47a25d4ec3d2311933'

/*
 * Ablauf: bei Bitpanda USDT gekauft (ohne Vertrag), 1000 auf die Wallet a1
 * ausgezahlt; der echte Eingang kommt 20 min später, der falsche (gleiche Menge,
 * Address-Poisoning) schon nach 1 min. Dazu 250 000 falsche USDT als Airdrop,
 * deren CHF-Wert der alte Code über den NAMEN eingefroren hatte.
 */
const t0 = T('2025-03-01T10:00:00Z')
const bew = [
    { id: 1, quelle: 'bitpanda', art: 'kauf', asset: 'USDT', menge: 1000, gegenAsset: 'CHF', gegenMenge: -900, chfWert: 900, zeit: t0 - 86400e3 },
    { id: 2, quelle: 'bitpanda', art: 'auszahlung', asset: 'USDT', menge: -1000, zeit: t0, transferMit: 3 },
    { id: 3, quelle: 'a1', art: 'einzahlung', asset: 'USDT', menge: 1000, kontrakt: ECHT, kette: 'evm:1', zeit: t0 + 20 * 60e3, transferMit: 2 },
    { id: 4, quelle: 'a1', art: 'einzahlung', asset: 'USDT', menge: 1000, kontrakt: FALSCH, kette: 'evm:1', zeit: t0 + 60e3, chfWert: 900 },
    { id: 5, quelle: 'a1', art: 'einzahlung', asset: 'USDT', menge: 250000, kontrakt: FALSCH, kette: 'evm:1', zeit: t0 + 3600e3, chfWert: 225000 },
]
const ident = tokenIdentitaet(bew)

console.log('\nIdentität')
check('KANON: Tether auf Ethereum ist USDT', istKanon('USDT', ECHT, 'evm:1') && istKanon('usdt', ECHT.toUpperCase().replace('0X', '0x')))
check('KANON: falscher Vertrag ist es nicht', !istKanon('USDT', FALSCH, 'evm:1') && kanonKennt('USDT', 'ethereum'))
check('ohne Vertrag: Kürzel', ident.id('USDT') === 'USDT' && ident.fremd('BTC', null) === null)
check('kanonischer Vertrag: Kürzel', ident.id('USDT', ECHT, 'evm:1') === 'USDT')
check('fremder Vertrag: Kürzel|Vertrag', ident.id('USDT', FALSCH, 'evm:1') === `USDT|${FALSCH}`)
const mitBeleg = tokenIdentitaet([
    { id: 10, quelle: 'bitget', art: 'auszahlung', asset: 'PEPE', menge: -5e6, transferMit: 11 },
    { id: 11, quelle: 'a1', art: 'einzahlung', asset: 'PEPE', menge: 5e6, kontrakt: PEPE, kette: 'evm:1', transferMit: 10 },
])
check('Transfer von der Börse belegt den Vertrag → Kürzel', mitBeleg.id('PEPE', PEPE) === 'PEPE')
check('ohne Beleg bleibt ein unbekannter Vertrag eigen', ident.id('PEPE', PEPE) === `PEPE|${PEPE}`)
const vonHand = tokenIdentitaet([{ id: 20, quelle: 'i:Ledger', art: 'einzahlung', asset: 'PEPE', menge: 1, kontrakt: PEPE, einordnung: 'transfer' }])
check('als eigener Transfer eingeordnet (Import/Hand) belegt den Vertrag', vonHand.id('PEPE', PEPE) === 'PEPE')
check('Import ohne Kette: keine Token-Prüfung (Kurs übers Kürzel wie bisher)', tokenOrteVon([{ quelle: 'i:X', asset: 'PEPE', kontrakt: PEPE, menge: 1 }]).size === 0)
{
    // MetaMask-Import 2024: Kauf mit Vertrag, Tausch nach SOUTH ohne Gegenvertrag.
    const M = '0x857de36f92330e1b9a21e8745c692f2ce13866cb', S = '0xcd24ba0e3364233ee9301c1d608a14753c8739c5'
    const imp = [
        { id: 30, quelle: 'i:MM', art: 'einzahlung', asset: 'MEMAGX', menge: 100, kontrakt: M, kette: 'ethereum', einordnung: 'kauf', zeit: 1 },
        { id: 31, quelle: 'i:MM', art: 'tausch', asset: 'SOUTH', menge: 2, kontrakt: S, kette: 'ethereum', gegenAsset: 'MEMAGX', gegenMenge: -100, zeit: 2 },
    ]
    const ii = tokenIdentitaet(imp)
    check('Import-Tausch ohne Gegenvertrag: Vertrag aus derselben Quelle', ii.seiten(imp[1])[1].id === `MEMAGX|${M}`, ii.seiten(imp[1])[1].id)
    const m = bestandAm(imp, Infinity, ii)
    check('… kein Phantom-Bestand nach dem Tausch', [...m.entries()].filter(([k]) => k.includes('MEMAGX')).every(([, v]) => nah(v, 0)), JSON.stringify([...m]))
    const zwei = tokenIdentitaet([...imp, { id: 32, quelle: 'i:MM', art: 'einzahlung', asset: 'MEMAGX', menge: 1, zeit: 3 }])
    check('… nicht, wenn die Quelle das Kürzel auch ohne Vertrag führt', zwei.seiten(imp[1])[1].id === 'MEMAGX')
    const andere = tokenIdentitaet([imp[0], { ...imp[1], quelle: 'i:Andere' }])
    check('… nicht über Quellen hinweg', andere.seiten({ ...imp[1], quelle: 'i:Andere' })[1].id === 'MEMAGX')
}
check('Gegenkontrakt aus dem Rohfeld (Text)', gegenKontraktVon({ roh: JSON.stringify({ gegenKontrakt: ECHT.toUpperCase().replace('0X', '0x') }) }) === ECHT)

console.log('\nBestand am Stichtag')
{
    const m = bestandAm(bew, T('2025-12-31T23:59:59Z'), ident)
    check('echter USDT an a1 = 1000 (nicht 251 000)', nah(m.get('a1\u0000USDT'), 1000), String(m.get('a1\u0000USDT')))
    check('falscher USDT eigener Posten = 251 000', nah(m.get(`a1\u0000USDT\u0000${FALSCH}`), 251000))
    check('Bitpanda: 0 nach Auszahlung', nah(m.get('bitpanda\u0000USDT') || 0, 0))
    const ohneIdent = bestandAm(bew, Infinity)
    check('ohne übergebene Identität dasselbe (aus den Bewegungen)', nah(ohneIdent.get('a1\u0000USDT'), 1000))
}

console.log('\nFIFO-Lose')
{
    const { lose, abgaenge } = fifo(bew, { fiat: ['CHF', 'EUR', 'USD'] })
    const e = einstandJeAsset(lose)
    check('Los des echten USDT: Kauf bei Bitpanda, 900 CHF', nah(e.get('USDT')?.kosten, 900) && nah(e.get('USDT')?.menge, 1000), JSON.stringify(e.get('USDT')))
    check('falscher USDT: eigene Lose, nicht im echten', nah(e.get(`USDT|${FALSCH}`)?.menge, 251000))
    check('keine Abgänge', abgaenge.length === 0)
    // Verkauf des echten USDT auf der Wallet: nimmt das Bitpanda-Los, nicht das falsche.
    const verkauf = [...bew, { id: 6, quelle: 'a1', art: 'tausch', asset: 'ETH', menge: 0.3, gegenAsset: 'USDT', gegenMenge: -1000, gegenKontrakt: ECHT, kette: 'evm:1', chfWert: 950, zeit: t0 + 2 * 86400e3 }]
    const a = fifo(verkauf, { fiat: ['CHF', 'EUR', 'USD'] }).abgaenge.find((x) => x.id === 6)
    check('Tausch echter USDT → ETH: Einstand 900, gedeckt', a && nah(a.kosten, 900) && a.ungedeckt === 0 && !a.kontrakt, JSON.stringify(a))
    const zus = einstandZusammen(e, ['USDT', `USDT|${FALSCH}`])
    check('Einstand zusammen: Mengen addiert, Kosten nur bekannte', nah(zus.menge, 252000) && zus.kosten != null)
}

console.log('\nSpam')
{
    const herkunft = assetsMitHerkunft(bew, ident)
    check('Herkunft: echter USDT (Kauf + Transfer)', herkunft.has('USDT'))
    check('Herkunft: falscher USDT NICHT (Wert kam aus dem Namen)', !herkunft.has(`USDT|${FALSCH}`), [...herkunft].join(','))
    const ist = spamEntscheid({}, herkunft, ident)
    check('Regel 2: falscher USDT ohne Kurs = ungefragt', ist('USDT', FALSCH, { ohneKurs: true }) === 'ungefragt')
    check('Regel 2: echter USDT ohne Kurs bleibt', ist('USDT', ECHT, { ohneKurs: true }) === null)
    const alt = spamEntscheid({ USDT: true }, herkunft, ident)
    check('alter Eintrag „USDT: Spam“ trifft den falschen', alt('USDT', FALSCH) === 'hand')
    check('… aber nicht den echten (Herausgeber-Vertrag)', alt('USDT', ECHT) === null)
    check('… und nicht die Börse', alt('USDT', null) === null)
    const neu = spamEntscheid({ [`USDT|${FALSCH}`]: true }, herkunft, ident)
    check('je Vertrag: nur der falsche', neu('USDT', FALSCH) === 'hand' && neu('USDT', ECHT) === null)
    check('je Vertrag: EVM-Schreibweise egal', neu('usdt', FALSCH.toUpperCase().replace('0X', '0x')) === 'hand')
    const nein = spamEntscheid({ USDT: true, [`USDT|${FALSCH}`]: false }, herkunft, ident)
    check('genauer Eintrag schlägt den Kürzel-Eintrag', nein('USDT', FALSCH) === null)
    const um = spamHandUmschreiben({ AI: true, USDT: true, BTC: false }, new Map([['AI', new Set(['0xa'])], ['USDT', new Set([ECHT, FALSCH])]]))
    check('Umschreiben: eindeutig → AI|0xa', um.hand['AI|0xa'] === true && !('AI' in um.hand))
    check('Umschreiben: mehrdeutig bleibt', um.hand.USDT === true && um.geaendert === 1)
    check('Umschreiben: ohne Vertrag bleibt', um.hand.BTC === false)
    check('Umschreiben: einziger Vertrag kanonisch → bleibt', spamHandUmschreiben({ USDT: true }, new Map([['USDT', new Set([ECHT])]])).geaendert === 0)
}

console.log('\nTransferpaarung')
{
    const zeilen = [
        { id: 2, ort: 'bitpanda', art: 'auszahlung', asset: 'USDT', menge: -1000, zeit: t0 },
        { id: 4, ort: 'a1', art: 'einzahlung', asset: 'USDT', menge: 1000, kontrakt: FALSCH, kette: 'evm:1', zeit: t0 + 60e3 },
        { id: 3, ort: 'a1', art: 'einzahlung', asset: 'USDT', menge: 999, kontrakt: ECHT, kette: 'evm:1', zeit: t0 + 20 * 60e3 },
    ]
    const p = ordneTransfers(zeilen)
    check('Auszahlung paart den echten, nicht den zeitlich näheren falschen', p.length === 1 && p[0].rein === 3, JSON.stringify(p))
    check('ohne echten Eingang: kein Paar mit dem falschen', ordneTransfers(zeilen.filter((z) => z.id !== 3)).length === 0)
    // Gegenproben: unbekannter Token (KANON kennt PEPE nicht) und native Coins wie bisher.
    const pepe = ordneTransfers([
        { id: 1, ort: 'bitget', art: 'auszahlung', asset: 'PEPE', menge: -5e6, zeit: t0 },
        { id: 2, ort: 'a1', art: 'einzahlung', asset: 'PEPE', menge: 4.99e6, kontrakt: PEPE, kette: 'evm:1', zeit: t0 + 600e3 },
    ])
    check('Gegenprobe: unbekannter Token wird gepaart wie bisher', pepe.length === 1 && pepe[0].rein === 2)
    const eth = ordneTransfers([
        { id: 1, ort: 'bitget', art: 'auszahlung', asset: 'ETH', menge: -1, zeit: t0 },
        { id: 2, ort: 'a1', art: 'einzahlung', asset: 'ETH', menge: 0.999, kette: 'evm:1', zeit: t0 + 600e3 },
    ])
    check('Gegenprobe: nativer Coin wie bisher', eth.length === 1)
    const zweiVertraege = ordneTransfers([
        { id: 1, ort: 'a1', art: 'auszahlung', asset: 'PEPE', menge: -10, kontrakt: PEPE, kette: 'evm:1', zeit: t0 },
        { id: 2, ort: 'a2', art: 'einzahlung', asset: 'PEPE', menge: 10, kontrakt: FALSCH, kette: 'evm:1', zeit: t0 + 60e3 },
    ])
    check('gleiche Kette, anderer Vertrag: kein Transfer', zweiVertraege.length === 0)
}

console.log('\nKurs')
{
    const orte = tokenOrteVon(bew, ident)
    check('Token-Orte: nur der falsche Vertrag', orte.size === 1 && orte.get(`a1\u0000USDT\u0000${FALSCH}`)?.kontrakt === FALSCH)
    const kurse = new Map([['USDT', { chf: 0.79 }], ['USDT' + TOKEN + FALSCH, { chf: null, token: true }]])
    check('echter USDT: Kurs des Kürzels', kursAn(kurse, orte, 'a1\u0000USDT').chf === 0.79)
    check('falscher USDT: kein Kurs', kursAn(kurse, orte, `a1\u0000USDT\u0000${FALSCH}`).chf === null)
    // Bewertung je Bewegung: nur über Seiten ohne oder mit kanonischem Vertrag.
    check('falsche Einzahlung: keine Bewertung über den Namen', (() => { const s = bewertbareSeiten(bew[3]); return !s.geld && !s.kurs })())
    check('echte Einzahlung: Geld-Seite (1 USD)', bewertbareSeiten(bew[2]).geld?.[0] === 'USDT')
    check('Börsenkauf: CHF-Betrag wie bisher', bewertbareSeiten(bew[0]).geld?.[0] === 'CHF')
    check('Börsen-BTC-Einzahlung: Tageskurs BTC wie bisher', bewertbareSeiten({ asset: 'BTC', menge: 0.1 }).kurs?.[0] === 'BTC')
    check('falscher „ETH“ gegen echten USDC: über den USDC-Betrag', bewertbareSeiten({ asset: 'ETH', menge: 5, kontrakt: FALSCH, kette: 'evm:1', gegenAsset: 'USDC', gegenMenge: -100, roh: JSON.stringify({ gegenKontrakt: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' }) }).geld?.[1] === -100)
    check('fremder Token gegen nativen ETH: über ETH', bewertbareSeiten({ asset: 'PEPE', menge: 5e6, kontrakt: PEPE, kette: 'evm:1', gegenAsset: 'ETH', gegenMenge: -0.1 }).kurs?.[0] === 'ETH')
    // Pool-Deckel ab der Liquiditätsschwelle.
    check('Pool-Deckel: 250 000 Stück zu 1 USD in 30 000-USD-Pool → kein Kurs', !poolKursGilt({ usd: 1, liq: 30000, duenn: false }, 250000))
    check('Pool-Deckel: 1000 Stück im selben Pool → Kurs', poolKursGilt({ usd: 1, liq: 30000, duenn: false }, 1000))
    check('Pool-Deckel: Menge unbekannt, liquider Pool → wie bisher', poolKursGilt({ usd: 1, liq: 30000, duenn: false }, 0))
    check('dünner Pool: unverändert (Viertel, Menge nötig)', !poolKursGilt({ usd: 1, liq: 400, duenn: true }, 0) && poolKursGilt({ usd: 1, liq: 400, duenn: true }, 100) && !poolKursGilt({ usd: 1, liq: 400, duenn: true }, 101))
}

console.log('\nGegenprobe: Daten ohne Verträge rechnen wie vorher')
{
    const b = [
        { id: 1, quelle: 'bitget', art: 'kauf', asset: 'BTC', menge: 1, gegenAsset: 'USDT', gegenMenge: -30000, chfWert: 27000, zeit: T('2024-01-01') },
        { id: 2, quelle: 'bitget', art: 'auszahlung', asset: 'BTC', menge: -1, einordnung: 'transfer', gebuehrAsset: 'BTC', gebuehrMenge: 0.0002, zeit: T('2024-02-01') },
        { id: 3, quelle: 'a8', art: 'einzahlung', asset: 'BTC', menge: 0.9998, einordnung: 'transfer', kette: 'btc', zeit: T('2024-02-01T01:00:00Z') },
        { id: 4, quelle: 'a8', art: 'verkauf', asset: 'BTC', menge: -0.5, gegenAsset: 'CHF', gegenMenge: 40000, chfWert: 40000, zeit: T('2025-03-01') },
    ]
    const m = bestandAm(b, T('2025-12-31'))
    check('Schlüssel ohne Vertrag unverändert', [...m.keys()].every((k) => k.split('\u0000').length === 2))
    const { abgaenge, lose } = fifo(b)
    check('Lose beim Kürzel', [...lose.keys()].every((k) => !k.includes('|')))
    const v = abgaenge.find((a) => a.id === 4)
    check('Verkauf nach Transfer: Einstand aus dem Börsenkauf, langfristig', v && nah(v.kosten, 13500) && v.kurzfristigAnteil === 0, JSON.stringify(v))
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
process.exit(fehlgeschlagen ? 1 : 0)
