/**
 * Selbsttest Steuerbericht als Dokument (steuer-bericht.js, rein): Abschnitte,
 * Summen je Ort, Escaping fremder Token-Namen, keine Bedienelemente.
 */
import { steuerBerichtHtml, vermoegenJeOrt, esc } from './steuer-bericht.js'
import { kanton } from '../../shared/steuer-kantone.js'

let ok = 0, fail = 0
const pruefe = (name, bed, d = '') => { if (bed) ok++; else { fail++; console.error('✗', name, d) } }

const s = {
    jahr: 2025, laufend: false, kanton: kanton('AG'), estv: { anzahl: 81 },
    vermoegen: [
        { asset: 'BTC', valor: '39714275', menge: 0.1, kursChf: 69571.988489, kursQuelle: 'ESTV-Kursliste', chf: 6957.1988489, kaufkurs: 50000,
            orte: [{ name: 'Ledger BTC', menge: 0.06, sicherheit: 'beleg' }, { name: 'Crypto.com', menge: 0.04, sicherheit: 'abgeleitet' }] },
        { asset: '<script>alert(1)</script>', token: true, menge: 5, kursChf: null, kursQuelle: 'kein Kurs', chf: null, orte: [{ name: 'MetaMask', menge: 5 }] },
        { asset: 'EPIK', token: true, menge: 100, kursChf: 0.01, kursQuelle: 'Kaufpreis (Ø-Einstand, Kanton AG erlaubt)', chf: 1, kaufkurs: 0.01, orte: [{ name: 'SafePal', menge: 100 }] },
    ],
    vermoegenSumme: 6958.1988489,
    einkommen: { summe: 98.22, ohneWert: 2, jeArt: { staking: 98.22 }, zeilen: [{ zeit: Date.parse('2025-03-01'), quelle: 'Bitpanda', art: 'staking', asset: 'ETH', menge: 0.01, chfWert: 98.22 }] },
    veraeusserungen: { erloes: 1000, kosten: 800, gewinn: 200, abgaenge: [{ zeit: Date.parse('2025-05-01'), quelle: 'Bitpanda', asset: 'SOL', menge: 5, erloes: 1000, kosten: 800, gewinn: 200, kurzfristigAnteil: 0.5 }] },
    kriterien: [{ id: 'haltedauer', erfuellt: false, wert: 0.5, monate: 6 }, { id: 'volumen', erfuellt: true, wert: 0.4, volumen: 4000, vermoegenAnfang: 10000 }, { id: 'derivate', erfuellt: false, wert: 12 }],
    futures: { guthaben: [{ name: 'Bitunix', usd: 1000, chf: 800, sicherheit: 'abgeleitet' }], guthabenChf: 800, stichtagKurs: 0.8, boersen: [], summe: { n: 0 } },
}
const html = steuerBerichtHtml(s, { erstellt: Date.parse('2026-10-26'), version: '4.2.0', rechtshinweis: 'Kein anerkanntes Tool.', totalverluste: [{ asset: 'MBTN', menge: 10, kaufkurs: 3, einstandChf: 30, abJahr: 2025 }, { asset: 'ALT', abJahr: 2026 }] })

pruefe('Token-Name wird escaped', !html.includes('<script>alert') && html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'))
pruefe('kein Inline-Skript (CSP)', !/<script>(?!<)/.test(html.replace('<script src="bericht.js" defer></script>', '')))
pruefe('Druckknopf nur über bericht.js', html.includes('id="drucken"') && html.includes('src="bericht.js"'))
pruefe('Abschnitte vorhanden', ['Zusammenfassung', '1 Vermögen', '2 Erträge', '3 Veräusserungen', 'Anhang A', 'Anhang B', 'Anhang C'].every((x) => html.includes(x)))
pruefe('Kanton und Code im Übertrag', html.includes('Kanton Aargau') && html.includes('Code KR'))
pruefe('Total inkl. Futures (6958.20 + 800)', /7[’']758\.20/.test(html), html.match(/Steuerwert total[^\n]*/)?.[0])
pruefe('Valor gedruckt', html.includes('39714275'))
pruefe('Fussnote abgeleitet', html.includes('Bestand abgeleitet'))
pruefe('Fussnote Futures zurückgerechnet', html.includes('Ein- und Auszahlungen nach dem Stichtag'))
pruefe('Coin ohne Kurs genannt, nicht im Total', html.includes('Ohne Kurs (Steuerwert nicht enthalten)'))
pruefe('Totalverlust des Jahres aufgeführt, späterer nicht', html.includes('MBTN') && !/<td>ALT<\/td>/.test(html))
pruefe('Rechtshinweis genau einmal im Kopf', (html.match(/Kein anerkanntes Tool\./g) || []).length === 1)
pruefe('keine Bedienelemente der App', !/ESTV-Kursliste neu laden|Kurs eintragen|Menü einklappen/.test(html))
pruefe('Kriterium „nicht erfüllt“', html.includes('nicht erfüllt'))

const orte = vermoegenJeOrt(s.vermoegen)
const ledger = orte.find((o) => o.name === 'Ledger BTC')
pruefe('je Ort: Menge des Orts × Kurs', Math.abs(ledger.summe - 0.06 * 69571.988489) < 1e-6)
pruefe('je Ort: Kostenbasis aus Ø-Kaufkurs', Math.abs(ledger.posten[0].kostenbasis - 3000) < 1e-9)
pruefe('je Ort: nach Wert sortiert', orte[0].name === 'Ledger BTC')
pruefe('esc: Anführungszeichen', esc(`a"b'c&`) === 'a&quot;b&#39;c&amp;')

console.log(`Steuerbericht-Dokument: ${ok} ok, ${fail} Fehler`)
if (fail) process.exit(1)
