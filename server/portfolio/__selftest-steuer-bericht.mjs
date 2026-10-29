/**
 * Selbsttest Steuerbericht als Dokument (steuer-bericht.js, rein): Abschnitte,
 * Summen je Ort, Escaping fremder Token-Namen, keine Bedienelemente.
 */
import { steuerBerichtHtml, vermoegenJeOrt, esc, berichtCss } from './steuer-bericht.js'
import { kanton } from '../../shared/steuer-kantone.js'

let ok = 0, fail = 0
const pruefe = (name, bed, d = '') => { if (bed) ok++; else { fail++; console.error('✗', name, d) } }

const s = {
    jahr: 2025, laufend: false, kanton: kanton('AG'), estv: { anzahl: 81 },
    vermoegen: [
        { asset: 'BTC', name: 'Bitcoin', valor: '39714275', menge: 0.1, kursChf: 69571.988489, kursQuelle: 'ESTV-Kursliste', chf: 6957.1988489, kaufkurs: 50000,
            orte: [{ name: 'Ledger BTC', menge: 0.06, sicherheit: 'beleg' }, { name: 'Crypto.com', menge: 0.04, sicherheit: 'abgeleitet' }] },
        { asset: '<script>alert(1)</script>', token: true, menge: 5, kursChf: null, kursQuelle: 'kein Kurs', chf: null, orte: [{ name: 'MetaMask', menge: 5 }] },
        { asset: 'EPIK', token: true, menge: 100, kursChf: 0.01, kursQuelle: 'Kaufpreis', chf: 1, kaufkurs: 0.01, orte: [{ name: 'SafePal', menge: 100 }] },
    ],
    vermoegenSumme: 6958.1988489,
    einkommen: { summe: 98.22, ohneWert: 2, jeArt: { staking: 98.22 }, jeCoin: [{ asset: 'ETH', name: 'Ethereum', n: 3, menge: 0.012, chf: 98.22, ohneWert: 2 }], zeilen: [{ zeit: Date.parse('2025-03-01'), quelle: 'Bitpanda', art: 'staking', asset: 'ETH', menge: 0.01, chfWert: 98.22 }] },
    veraeusserungen: { erloes: 1000, kosten: 800, gewinn: 200, abgaenge: [{ zeit: Date.parse('2025-05-01'), quelle: 'Bitpanda', asset: 'SOL', menge: 5, erloes: 1000, kosten: 800, gewinn: 200, kurzfristigAnteil: 0.5 }] },
    kriterien: [{ id: 'haltedauer', erfuellt: false, wert: 0.5, monate: 6 }, { id: 'volumen', erfuellt: true, wert: 0.4, volumen: 4000, vermoegenAnfang: 10000 }, { id: 'derivate', erfuellt: false, wert: 12 }],
    devisen: { datum: '2025-12-31', usdChf: 0.79341, eurChf: 0.9312, quelle: 'EZB' },
    bestandesrechnung: [
        { asset: 'BTC', name: 'Bitcoin', kontrakt: null, anfang: 0.08, zugang: 0.03, abgang: 0.01, uebrige: 0, ende: 0.1 },
        { asset: 'MBTN', name: null, kontrakt: null, anfang: 10, zugang: 0, abgang: 0, uebrige: -10, ende: 0 },
    ],
    veraenderungen: [
        { id: 1, zeit: Date.parse('2025-05-01'), quelle: 'Bitpanda', art: 'Verkauf', ab: { asset: 'SOL', menge: 5, token: false }, zu: { asset: 'CHF', menge: 1000, token: false }, chfWert: 1000 },
        { id: 2, zeit: Date.parse('2025-06-01'), quelle: 'MetaMask', art: 'Einzahlung', ab: null, zu: { asset: 'PEPE', menge: 1e6, token: true }, chfWert: null },
    ],
    futures: { guthaben: [{ name: 'Bitunix', usd: 1000, chf: 800, sicherheit: 'abgeleitet' }], guthabenChf: 800, stichtagKurs: 0.8, boersen: [], summe: { n: 0 } },
}
const html = steuerBerichtHtml(s, { erstellt: Date.parse('2026-10-26'), version: '4.2.0', totalverluste: [{ asset: 'MBTN', menge: 10, kaufkurs: 3, einstandChf: 30, abJahr: 2025 }, { asset: 'ALT', menge: 1, abJahr: 2026 }, { asset: 'CHSB', menge: 0, abJahr: 2025 }] })

pruefe('Token-Name wird escaped', !html.includes('<script>alert') && html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'))
pruefe('kein Inline-Skript (CSP)', !/<script>(?!<)/.test(html.replace('<script src="bericht.js" defer></script>', '')))
pruefe('Druckknopf nur über bericht.js', html.includes('id="drucken"') && html.includes('src="bericht.js"'))
pruefe('Abschnitte vorhanden', ['Zusammenfassung', '1 Vermögen', '2 Bestandesrechnung', '3 Erträge', '4 Veränderungen', '5 Ausgebuchte Coins', 'Anhang — Methode'].every((x) => html.includes(x)))
pruefe('Coin-Name unter dem Kürzel', html.includes('<small class="name">Bitcoin</small>'))
pruefe('Bestandesrechnung mit Spalte Übrige', html.includes('<th class="z">Übrige</th>') && html.includes('-10'))
pruefe('Erträge je Coin mit Name und Fussnote', html.includes('<h3>Je Coin</h3>') && html.includes('Ethereum') && html.includes('ohne bekannten CHF-Wert (nicht im Wert)'))
pruefe('Devisenkurs als Zahl (Zusammenfassung + Anhang)', (html.match(/USD\/CHF 0\.7934/g) || []).length >= 2 && html.includes('EUR/CHF 0.9312'))
pruefe('Stil-Link trägt Jahr und Kanton', html.includes('bericht.css?jahr=2025&amp;kt=AG'))
const css = berichtCss({ jahr: 2025, kanton: 'Aargau' })
pruefe('Seitenkopf auf jeder Seite', /@top-left \{ content: "Krypto-Steuerbericht 2025 · Stichtag 31\.12\.2025 · Kanton Aargau"/.test(css))
const boese = berichtCss({ jahr: 2025, kanton: 'x"; } body { display:none } @page { x' }).match(/@top-left \{ content: "([^"]*)"; font/)
pruefe('Seitenkopf: Kantonsname kann das CSS nicht aufbrechen', !!boese && !/[{};:]/.test(boese[1]), boese?.[1])
pruefe('ohne Jahr kein Kopf', !berichtCss().includes('@top-left'))
pruefe('Kanton und Code im Übertrag', html.includes('Kanton Aargau') && html.includes('Code KR'))
pruefe('Total inkl. Futures (6958.20 + 800)', /7[’']758\.20/.test(html), html.match(/Steuerwert total[^\n]*/)?.[0])
pruefe('Valor gedruckt', html.includes('39714275'))
// Beilage fürs Steueramt: nur, was die Ämter verlangen — keine Selbsteinschätzung.
for (const [was, muster] of [['Gewerbsmässigkeit', /Gewerbsm|Kreisschreiben|KS 36/], ['Kriterien-Urteil', /nicht erfüllt|erfüllt</], ['Haltedauer', /Haltedauer|&lt; 6 Mt/],
    ['Gewinn/Einstand', /Gewinn|Einstand|Kostenbasis|Ø-Kaufkurs|FIFO/], ['Futures-Ergebnis', /Futures und Bots|Funding|Derivat/], ['Kantonsanhang', /Anhang C|Mining|Beilagen/],
    ['Anleitung an den Nutzer', /prüfen|Fussnote|abgeleitet|zurückgerechnet/], ['Rechtshinweis', /Steuerberatung|anerkannt/]]) {
    pruefe(`nicht im Bericht: ${was}`, !muster.test(html), html.match(muster)?.[0])
}
pruefe('Veränderung: Verkauf mit Ab- und Zugang', html.includes('<td>Verkauf</td>') && html.includes('5 SOL') && html.includes('1’000 CHF'))
pruefe('Veränderung: Einzahlung ohne Wert, Token markiert', html.includes('<td>Einzahlung</td>') && /1’000’000 PEPE <small>\(Token\)<\/small>/.test(html))
pruefe('Totalverlust ohne Menge nicht aufgeführt', !/<td>CHSB<\/td>/.test(html))
pruefe('Coin ohne Kurs genannt, nicht im Total', html.includes('Ohne Kurs (Steuerwert nicht enthalten)'))
pruefe('Totalverlust des Jahres aufgeführt, späterer nicht', html.includes('MBTN') && !/<td>ALT<\/td>/.test(html))
pruefe('keine Bedienelemente der App', !/ESTV-Kursliste neu laden|Kurs eintragen|Menü einklappen/.test(html))

const orte = vermoegenJeOrt(s.vermoegen)
const ledger = orte.find((o) => o.name === 'Ledger BTC')
pruefe('je Ort: Menge des Orts × Kurs', Math.abs(ledger.summe - 0.06 * 69571.988489) < 1e-6)
pruefe('je Ort: nach Wert sortiert', orte[0].name === 'Ledger BTC')
pruefe('esc: Anführungszeichen', esc(`a"b'c&`) === 'a&quot;b&#39;c&amp;')

console.log(`Steuerbericht-Dokument: ${ok} ok, ${fail} Fehler`)
if (fail) process.exit(1)
