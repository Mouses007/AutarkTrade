/**
 * Selbsttest Datei-Import und Steuer-Rechnung (Spot-Portfolio).
 *
 *   node server/portfolio/__selftest-steuer.mjs
 *
 * Was hier still danebengehen würde:
 *   - Import: eine Zeile mit falschem Vorzeichen bucht den Bestand doppelt
 *     statt leer — der Leser muss sie ABLEHNEN, mit Zeilennummer.
 *   - Stichtag: Bewegungen nach dem 31.12. dürfen nicht mitzählen.
 *   - Einkommen: ein eigener Transfer ist kein Einkommen, auch wenn er wie
 *     ein Zufluss aussieht; ein als „Einkommen" eingeordneter Zufluss schon.
 *   - FIFO: ein Transfer Börse → Ledger darf das Los NICHT neu starten,
 *     sonst wird aus einer Haltedauer von zwei Jahren eine von zwei Tagen.
 */
import { leseImportCsv } from './import.js'
import { bestandAm, einkommen, fifo, veraeusserungen, gewerbsKriterien } from './steuer-rechnung.js'
import { uebergaben, ohneUebernommene } from './uebergabe.js'

let bestanden = 0, fehlgeschlagen = 0
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}
const nah = (a, b, e = 1e-9) => Math.abs(a - b) <= e * Math.max(1, Math.abs(b))
const T = (s) => Date.parse(s)

console.log('\nImport-Leser')
{
    const kopf = 'externe_id;datum_utc;ort;art;asset;menge;gegen_asset;gegen_menge;gebuehr_asset;gebuehr_menge;chf_wert;txhash;kette;kontrakt;einordnung;sicherheit;notiz'
    const gut = [kopf,
        'c1;2022-01-03T10:00:00Z;Crypto.com;kauf;BTC;0.001;CHF;-50;CHF;1.5;50;;;;;beleg;Wochenkauf',
        'c2;2022-05-14T10:00:00Z;Crypto.com;auszahlung;XRP;-777.51;;;XRP;0.25;;0xabc;xrp;;transfer;beleg;"Ledger XRP; via Hot-Wallet"',
        "c3;2023-12-31T23:59:59Z;Firefly (IOTA);staking;MIOTA;1'436.38;;;;;250;;;;;abgeleitet;",
        'c4;2019-01-01T00:00:00Z;Unbekannt;bestand;BTC;0.5;;;;;;;;;;offen;',
    ].join('\n')
    const r = leseImportCsv(gut)
    check('vier gültige Zeilen, keine Fehler', r.zeilen.length === 4 && r.fehler.length === 0, JSON.stringify(r.fehler))
    check('Notiz mit Semikolon in Anführungszeichen', r.zeilen[1].notiz === 'Ledger XRP; via Hot-Wallet')
    check("Tausendertrennzeichen ' gelesen", r.zeilen[2].menge === 1436.38)
    check('Orte gezählt', r.orte['Crypto.com'].n === 2 && Object.keys(r.orte).length === 3)
    check('Quelle = i:Ort', r.zeilen[0].quelle === 'i:Crypto.com')
    const schlecht = leseImportCsv([kopf,
        'x1;2022-01-03T10:00:00Z;Crypto.com;kauf;BTC;-0.001;CHF;50;;;;;;;;;',
        'x2;2022-01-03T10:00:00Z;Crypto.com;auszahlung;BTC;0.1;;;;;;;;;;;',
        'x3;gestern;Crypto.com;einzahlung;BTC;0.1;;;;;;;;;;;',
        'x4;2022-01-03T10:00:00Z;Crypto.com;einzahlung;BTC;0,1;;;;;;;;;;;',
        'x5;2022-01-03T10:00:00Z;Crypto.com;schenkung;BTC;0.1;;;;;;;;;;;',
        'x6;2022-01-03T10:00:00Z;Crypto.com;einzahlung;BTC;0.1;;;;;;;;;;;',
        'x6;2022-01-04T10:00:00Z;Crypto.com;einzahlung;BTC;0.1;;;;;;;;;;;',
    ].join('\n'))
    const zeilen = schlecht.fehler.map((f) => f.zeile)
    check('Kauf mit negativer Menge abgelehnt (Zeile 2)', zeilen.includes(2))
    check('Auszahlung mit positiver Menge abgelehnt (Zeile 3)', zeilen.includes(3))
    check('unlesbares Datum abgelehnt (Zeile 4)', zeilen.includes(4))
    check('Komma als Dezimaltrenner abgelehnt (Zeile 5)', zeilen.includes(5))
    check('unbekannte Art abgelehnt (Zeile 6)', zeilen.includes(6))
    check('doppelte externe_id abgelehnt (Zeile 8)', zeilen.includes(8) && !zeilen.includes(7))
    check('Kopf ohne Pflichtspalten abgelehnt', leseImportCsv('a;b;c\n1;2;3').fehler[0].zeile === 1)
}

console.log('\nStichtag')
{
    const b = [
        { quelle: 'i:A', asset: 'BTC', menge: 1, zeit: T('2023-06-01T00:00:00Z') },
        { quelle: 'i:A', asset: 'BTC', menge: -0.4, zeit: T('2023-12-31T22:59:59Z'), gebuehrAsset: 'BTC', gebuehrMenge: 0.001 },
        { quelle: 'i:A', asset: 'BTC', menge: -0.5, zeit: T('2024-01-01T00:00:01Z') },
        { quelle: 'i:B', asset: 'ETH', menge: 2, gegenAsset: 'CHF', gegenMenge: -3000, zeit: T('2023-03-01T00:00:00Z') },
        { quelle: 'i:B', asset: 'ETH', menge: 5, zeit: T('2023-04-01T00:00:00Z'), einordnung: 'ignorieren' },
    ]
    const m = bestandAm(b, T('2023-12-31T22:59:59Z'))
    check('BTC am 31.12. = 1 − 0.4 − Gebühr', nah(m.get('i:A\u0000BTC'), 0.599))
    check('Bewegung nach dem Stichtag zählt nicht', !nah(m.get('i:A\u0000BTC'), 0.099))
    check('Kaufseite und Gegenseite je Ort', m.get('i:B\u0000ETH') === 2 && m.get('i:B\u0000CHF') === -3000)
    check('ignorierte Zeile zählt nicht', m.get('i:B\u0000ETH') === 2)
}

console.log('\nEinkommen')
{
    const j = [T('2023-01-01T00:00:00Z'), T('2023-12-31T23:59:59Z')]
    const b = [
        { asset: 'ALGO', art: 'staking', menge: 1, chfWert: 0.2, zeit: T('2023-05-01T00:00:00Z') },
        { asset: 'SMR', art: 'airdrop', menge: 100, chfWert: null, zeit: T('2023-05-01T00:00:00Z') },
        { asset: 'ETH', art: 'einzahlung', menge: 0.1, chfWert: 150, einordnung: 'einkommen', zeit: T('2023-06-01T00:00:00Z') },
        { asset: 'ETH', art: 'einzahlung', menge: 1, chfWert: 1500, einordnung: 'transfer', zeit: T('2023-06-01T00:00:00Z') },
        { asset: 'ETH', art: 'staking', menge: 1, chfWert: 1500, einordnung: 'transfer', zeit: T('2023-06-01T00:00:00Z') },
        { asset: 'ALGO', art: 'staking', menge: 1, chfWert: 9, zeit: T('2024-01-01T00:00:00Z') },
    ]
    const e = einkommen(b, ...j)
    check('Staking + eingeordnetes Einkommen = 150.2', nah(e.summe, 150.2), String(e.summe))
    check('Zufluss ohne Wert wird gezählt, nicht als 0 summiert', e.ohneWert === 1)
    check('eigener Transfer ist kein Einkommen, auch als staking', e.zeilen.every((z) => z.einordnung !== 'transfer'))
    check('Folgejahr zählt nicht', e.zeilen.length === 3)
}

console.log('\nFIFO, Haltedauer, Transfers')
{
    const b = [
        { id: 1, quelle: 'i:CDC', asset: 'BTC', art: 'kauf', menge: 1, gegenAsset: 'CHF', gegenMenge: -10000, chfWert: 10000, zeit: T('2021-01-01T00:00:00Z') },
        { id: 2, quelle: 'i:CDC', asset: 'BTC', art: 'auszahlung', menge: -1, einordnung: 'transfer', gebuehrAsset: 'BTC', gebuehrMenge: 0.0005, zeit: T('2022-06-01T00:00:00Z') },
        { id: 3, quelle: 'i:Ledger', asset: 'BTC', art: 'einzahlung', menge: 1, einordnung: 'transfer', zeit: T('2022-06-01T01:00:00Z') },
        { id: 4, quelle: 'i:Ledger', asset: 'BTC', art: 'verkauf', menge: -0.5, gegenAsset: 'CHF', gegenMenge: 20000, chfWert: 20000, zeit: T('2023-03-01T00:00:00Z') },
        { id: 5, quelle: 'i:CDC', asset: 'ETH', art: 'kauf', menge: 1, gegenAsset: 'CHF', gegenMenge: -1500, chfWert: 1500, zeit: T('2023-01-01T00:00:00Z') },
        { id: 6, quelle: 'i:CDC', asset: 'ETH', art: 'verkauf', menge: -1, gegenAsset: 'CHF', gegenMenge: 1800, chfWert: 1800, zeit: T('2023-02-01T00:00:00Z') },
        { id: 7, quelle: 'i:CDC', asset: 'XRP', art: 'verkauf', menge: -100, gegenAsset: 'CHF', gegenMenge: 50, chfWert: 50, zeit: T('2023-05-01T00:00:00Z') },
    ]
    b.push({ id: 8, quelle: 'i:Verloren', asset: 'XRP', art: 'einzahlung', menge: 1000, einordnung: 'transfer', zeit: T('2023-06-01T00:00:00Z') })
    b.push({ id: 9, quelle: 'i:Verloren', asset: 'XRP', art: 'sonstiges', menge: -1000, chfWert: 729, zeit: T('2023-06-01T00:00:01Z') })
    const { abgaenge } = fifo(b, { von: T('2023-01-01T00:00:00Z'), bis: T('2023-12-31T23:59:59Z') })
    const verlust = abgaenge.find((a) => a.id === 9)
    check('Verlust (sonstiges) hat Erlös 0, nicht den CHF-Wert der Zeile', verlust && verlust.erloes === 0 && verlust.art === 'verlust', JSON.stringify(verlust))
    const btc = abgaenge.find((a) => a.id === 4)
    check('Transfer startet das Los nicht neu: BTC-Verkauf langfristig', btc.kurzfristigAnteil === 0, String(btc.kurzfristigAnteil))
    check('Einstand aus dem Kauf 2021: 0.5 × 10000 = 5000, Gewinn 15000', nah(btc.kosten, 5000) && nah(btc.gewinn, 15000))
    const eth = abgaenge.find((a) => a.id === 6)
    check('ETH nach 1 Monat verkauft = kurzfristig', eth.kurzfristigAnteil === 1)
    const xrp = abgaenge.find((a) => a.id === 7)
    check('XRP ohne Zugang: Einstand unbekannt, nicht 0', xrp.kosten === null && xrp.gewinn === null && xrp.ungedeckt === 100)
    const v = veraeusserungen(abgaenge)
    check('Summen: Erlös 21850, Gewinn 15300 (ohne XRP)', nah(v.erloes, 21850) && nah(v.gewinn, 15300) && v.ohneEinstand === 2, JSON.stringify(v))
    check('Netzgebühr des Transfers ist ein Abgang (nicht im Jahr gezählt)', !abgaenge.some((a) => a.art === 'gebuehr'))

    const k = gewerbsKriterien({ volumen: 21850 + 1500, vermoegenAnfang: 10000, kurzfristigErloes: v.kurzfristigErloes, erloes: v.erloes, futuresTrades: 12 })
    const kr = Object.fromEntries(k.map((x) => [x.id, x]))
    check('Haltedauer verletzt (ETH kurzfristig)', kr.haltedauer.erfuellt === false)
    check('Volumen 2.3× ≤ 5× erfüllt', kr.volumen.erfuellt === true && nah(kr.volumen.wert, 2.335))
    check('Futures-Handel: Derivate-Kriterium nicht erfüllt', kr.derivate.erfuellt === false)
    check('Einkommen/Fremdfinanzierung: nicht aus Daten entscheidbar', kr.einkommen.erfuellt === null && kr.fremdfinanzierung.erfuellt === null)
}

console.log('\nÜbergabe Import → Live')
{
    const bestaende = [
        { quelle: 'i:Ledger ETH', asset: 'ETH', menge: 1 }, { quelle: 'i:Ledger ETH', asset: 'USDC', menge: 0.23 },
        { quelle: 'i:Ledger BSC', asset: 'BNB', menge: 0.009 },
        { quelle: 'a7', asset: 'ETH', menge: 1.01 }, { quelle: 'a7', asset: 'BNB', menge: 0.009 },
        { quelle: 'i:Ledger BTC', asset: 'BTC', menge: 0.02 }, { quelle: 'a8', asset: 'BTC', menge: 0.021 },
        { quelle: 'i:Ledger XRP', asset: 'XRP', menge: 2277 },
    ]
    const adressen = [
        { id: 7, importOrte: '["Ledger ETH","Ledger BSC"]', liveAb: 1 },
        { id: 8, importOrte: ['Ledger BTC'], liveAb: 1 },
        { id: 9, importOrte: ['Ledger XRP'], liveAb: 1 },
    ]
    const stand = new Map([
        ['a7', { status: 'ok', stand: '{"vollstaendig":false}' }],
        ['a8', { status: 'ok', stand: '{"vollstaendig":true}' }],
        ['a9', { status: 'fehler', stand: '{}' }],
    ])
    const { ersetzt } = uebergaben(bestaende, adressen, stand)
    const rest = ohneUebernommene(bestaende, ersetzt)
    const hat = (q, a) => rest.some((b) => b.quelle === q && b.asset === a)
    check('Live meldet ETH/BNB → Import-ETH/BNB fallen weg', !hat('i:Ledger ETH', 'ETH') && !hat('i:Ledger BSC', 'BNB') && hat('a7', 'ETH'))
    check('Token, den live niemand liest (USDC ohne Schlüssel), bleibt aus dem Import', hat('i:Ledger ETH', 'USDC'))
    check('Vollständige Live-Quelle (xpub) ersetzt den Import ganz', !hat('i:Ledger BTC', 'BTC') && hat('a8', 'BTC'))
    check('Noch nie erfolgreich gelesen → Import bleibt stehen', hat('i:Ledger XRP', 'XRP'))
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
process.exit(fehlgeschlagen ? 1 : 0)
