/**
 * Selbsttest: EDGAR-Antworten lesen und ordnen.
 *
 *   node server/aktien/__selftest-edgar.mjs
 *
 * Fixtures: die Einreichungen von CoreWeave und NVIDIA sind echte, gekürzte
 * Antworten von data.sec.gov (15.11.2026). Die Ticker-Liste ist NACHGEBAUT
 * (www.sec.gov gibt sie ohne Kontaktangabe nicht heraus), ebenso die
 * Prospekt-Textstellen weiter unten — sie folgen dem üblichen Wortlaut, sind
 * aber aus keinem echten Prospekt kopiert.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
    gruppeVon, artId, cik10, usTicker, tickerVerzeichnis, tagZuMs, dokumentLink, zeilenAus,
    zusatzDateien, werteAus, textAusHtml, leseHaltefrist, pruefeKontakt, userAgentAus,
} from './edgar-kern.js'

let n = 0
const ok = (bed, text) => { assert.ok(bed, text); n++ }
const lies = (name) => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'))
const JETZT = Date.UTC(2026, 10, 15, 12)

// ── Kleinteile ──
ok(gruppeVon('424B4') === 'boersengang' && gruppeVon('s-1/a') === 'boersengang' && gruppeVon('S-3ASR') === 'angebot', 'Gruppen: Börsengang, Angebot')
ok(gruppeVon('4') === 'insider' && gruppeVon('144') === 'insider' && gruppeVon('8-K') === 'berichte', 'Gruppen: Insider, Berichte')
ok(gruppeVon('S-8') === null && gruppeVon('SCHEDULE 13G') === null && gruppeVon('') === null, 'anderes Formular: keine Gruppe')
ok(artId('S-1/A') === 's1a' && artId('424B4') === 'p424b4' && artId('4') === 'n4' && artId('F-4') === 'f4' && artId('144') === 'n144' && artId('S-3ASR') === 's3asr', 'Kennung für die Übersetzung')
ok(cik10(1045810) === '0001045810' && cik10('0001769628') === '0001769628' && cik10(0) === null && cik10('x') === null, 'CIK zehnstellig oder null')
ok(usTicker('BRK-B') === 'BRKB' && usTicker('brk.b') === 'BRKB' && usTicker('NVDA') === 'NVDA', 'Aktienklassen: eine Schreibweise')
ok(usTicker('ASML.AS') === null && usTicker('0700.HK') === null && usTicker('') === null && usTicker('A B') === null, 'Börsen-Anhang: keine US-Listung')
ok(tagZuMs('2025-03-31') === Date.UTC(2025, 2, 31) && tagZuMs('31.03.2025') === null && tagZuMs('') === null, 'Datum der Einreichung')
ok(dokumentLink('0001769628', '0001193125-25-067651', 'd899798d424b4.htm') === 'https://www.sec.gov/Archives/edgar/data/1769628/000119312525067651/d899798d424b4.htm', 'Link auf das Dokument')
ok(dokumentLink(1769628, '0001193125-25-067651', '') === 'https://www.sec.gov/Archives/edgar/data/1769628/000119312525067651/0001193125-25-067651-index.htm', 'ohne Hauptdokument: Übersicht')
ok(dokumentLink(1769628, '0001193125-25-067651', '../../x"onload=').endsWith('-index.htm') && dokumentLink(1769628, 'abc', 'a.htm') === null, 'fremde Zeichen kommen nicht in den Link')

// ── Ticker-Liste (nachgebaut) ──
const verz = tickerVerzeichnis(lies('edgar-company-tickers.json'))
ok(verz.get('NVDA').cik === '0001045810' && verz.get('CRWV').cik === '0001769628' && verz.get('CRWV').name === 'CoreWeave, Inc.', 'Ticker → CIK')
ok(verz.get(usTicker('BRK.B')).ticker === 'BRK-B' && verz.size === 4, 'BRK.B findet BRK-B; bei gleicher Schreibweise gewinnt der erste')
ok(!verz.has('_HINWEIS') && verz.get('ASML') === undefined, 'Unbekanntes fehlt')
assert.throws(() => tickerVerzeichnis('<!DOCTYPE html>'), /unerwarteter Form/); n++
assert.throws(() => tickerVerzeichnis({}), /leer/); n++

// ── CoreWeave: junge Firma, Börsenprospekt liegt in der Zusatzdatei ──
const crwv = lies('edgar-submissions-crwv.json')
const crwvAlt = lies('edgar-submissions-crwv-001.json')
ok(JSON.stringify(zusatzDateien(crwv, JETZT)) === '["CIK0001769628-submissions-001.json"]', 'Zusatzdatei reicht ins Fenster')

const ohne = werteAus(crwv, [], JETZT)
ok(ohne.firma.name === 'CoreWeave, Inc.' && ohne.firma.cik === '0001769628' && ohne.firma.ticker[0] === 'CRWV' && ohne.firma.boersen[0] === 'Nasdaq', 'Firma')
ok(ohne.vollstaendig === false && ohne.prospekt === null && ohne.boersengang.length === 0, 'ohne Zusatzdatei: kein Prospekt gesehen — und als unvollständig gekennzeichnet')
ok(ohne.reichtBis === Date.UTC(2025, 8, 3) && ohne.kennzahl.angebote12m === 2, 'reicht bis 3.9.2025 → die letzten zwölf Monate sind ganz gesehen')
ok(ohne.kennzahl.juengstesAngebot === Date.UTC(2026, 8, 17), 'jüngstes Angebot: 424B5 vom 17.9.2026')
ok(ohne.angebot.map((z) => z.form).join() === '424B5,S-3ASR,424B3', 'Angebote, jüngstes zuerst')

const mit = werteAus(crwv, [crwvAlt], JETZT)
ok(mit.vollstaendig === true && mit.prospekt.form === '424B4' && mit.prospekt.zeit === Date.UTC(2025, 2, 31), 'mit Zusatzdatei: Börsenprospekt vom 31.3.2025')
ok(mit.prospekt.link === 'https://www.sec.gov/Archives/edgar/data/1769628/000119312525067651/d899798d424b4.htm', 'Link auf den Prospekt')
ok(mit.boersengang.map((z) => z.form).join() === '424B4,S-1/A,S-1/A,S-1', 'Börsengang: Prospekt und Registrierungen')
ok(mit.boersengang.at(-1).zeit === Date.UTC(2025, 2, 3) && mit.boersengang.at(-1).art === 's1', 'erste Registrierung am 3.3.2025')
ok(mit.kennzahl.angebote12m === 2 && mit.angebot.length === 3, 'Kennzahl bleibt dieselbe')
ok(mit.insider.liste.length === 15 && mit.insider.liste.every((z) => ['4', '4/A', '144', '144/A'].includes(z.form)) && mit.insider.liste[0].link.includes('/Archives/edgar/data/1769628/'), 'Insider-Meldungen mit Link')
ok(mit.insider.liste[0].zeit >= mit.insider.liste[1].zeit && mit.insider.liste[0].beschreibung === null, 'jüngste zuerst; «FORM 4» ist keine Beschreibung')
// Die Fixture ist bei 4/144 gekürzt — geprüft wird deshalb nur, dass gezählt wird, nicht die Höhe.
ok(mit.insider.monate12['144'] >= 30 && mit.insider.tage90['144'] >= 1 && mit.insider.tage90['144'] <= mit.insider.monate12['144'], 'Insider-Zähler je Formular')
ok(mit.berichte.monate12['10-Q'] === 3 && mit.berichte.monate12['10-K'] === 1 && mit.berichte.monate12['8-K'] === 20 && mit.berichte.juengster.form === '10-Q', 'laufende Berichte nur als Zähler')

// ── NVIDIA: alte Firma, Archiv bleibt liegen ──
const nvda = lies('edgar-submissions-nvda.json')
ok(zusatzDateien(nvda, JETZT).length === 0, 'Archiv 1998–2020 wird nicht geladen')
const nv = werteAus(nvda, [], JETZT)
ok(nv.vollstaendig === false && nv.prospekt === null && nv.boersengang.length === 0, 'kein Börsenprospekt gesehen (Archiv nicht geladen)')
ok(Number.isInteger(nv.kennzahl.angebote12m) && nv.angebot.some((z) => z.form === 'S-3ASR') && nv.firma.branche.startsWith('Semiconductors'), 'Angebote und Branche')
ok(nv.angebot.every((z, i, a) => !i || a[i - 1].zeit >= z.zeit), 'nach Datum geordnet')

// ── FUN-F-014: der ÄLTESTE 424B4 ist der Börsenprospekt, nicht der einer späteren Platzierung ──
{
    const zwei = werteAus({ cik: '9', name: 'Z', filings: { files: [], recent: {
        form: ['424B4', 'S-1', '424B4', 'S-1'],
        filingDate: ['2026-06-10', '2026-06-01', '2025-03-31', '2025-03-03'],
        accessionNumber: ['0000000009-26-000002', '0000000009-26-000001', '0000000009-25-000002', '0000000009-25-000001'],
        primaryDocument: ['folge.htm', 's1b.htm', 'ipo.htm', 's1a.htm'],
    } } }, [], JETZT)
    ok(zwei.prospekt.zeit === Date.UTC(2025, 2, 31) && zwei.prospekt.link.endsWith('/ipo.htm'), 'zwei 424B4: Börsenprospekt ist der ältere')
    ok(zwei.boersengang[0].zeit === Date.UTC(2026, 5, 10), 'die Liste bleibt jüngstes zuerst')
}

// ── Unbekannt bleibt unbekannt ──
const kurz = werteAus({ cik: '5', name: 'X', filings: { recent: { form: ['4'], filingDate: ['2026-11-01'], accessionNumber: ['0000000005-26-000001'] }, files: [{ name: 'CIK0000000005-submissions-001.json', filingTo: '2026-10-01' }] } }, [], JETZT)
ok(kurz.kennzahl.angebote12m === null && kurz.insider.monate12 === null && kurz.berichte.monate12 === null, 'Zeitraum nicht ganz gesehen: null statt 0')
ok(kurz.kennzahl.juengstesAngebot === null && kurz.berichte.juengster === null && kurz.insider.liste.length === 1, 'nichts gefunden bleibt null')
const leer = werteAus({ cik: 7, name: 'Y', filings: { recent: { form: [], filingDate: [] }, files: [] } }, [], JETZT)
ok(leer.vollstaendig === true && leer.kennzahl.angebote12m === 0 && leer.reichtBis === null && leer.prospekt === null, 'alles gesehen und leer: wirklich 0')
ok(zeilenAus({ form: ['4', '', '8-K'], filingDate: ['2026-01-01', '2026-01-02', 'kaputt'] }, 5).length === 1, 'Zeilen ohne Formular oder Datum fallen weg')
assert.throws(() => werteAus({ name: 'ohne CIK', filings: { recent: {} } }), /unerwarteter Form/); n++
assert.throws(() => werteAus({ cik: 5 }), /unerwarteter Form/); n++
ok(zusatzDateien({ filings: { files: [{ name: '../../etc/passwd', filingTo: '2026-01-01' }, { name: 'CIK0000000005-submissions-001.json', filingTo: '2019-01-01' }] } }, JETZT).length === 0, 'fremde Dateinamen und alte Archive: nichts laden')

// ── Haltefrist aus dem Prospekttext (Textstellen NACHGEBAUT nach üblichem Wortlaut) ──
const fuell = 'This summary highlights information contained elsewhere in this prospectus. '.repeat(4)
const klar = textAusHtml(`<p>${fuell}</p><p>We, our directors and executive officers and the holders of substantially all of our outstanding securities have entered into lock-up agreements with the underwriters and have agreed that, subject to certain exceptions, we and they will not offer, sell or otherwise dispose of any shares of our common stock <b>for a period of 180&nbsp;days after the date of this prospectus</b> without the prior written consent of the representatives.</p>
<p>We have granted the underwriters an option to purchase additional shares, exercisable for a period of 30 days from the date of this prospectus.</p>
<p>Through and including the 25th day after the date of this prospectus, all dealers that effect transactions in these securities may be required to deliver a prospectus.</p>
<p>Shares subject to the lock-up agreements will become eligible for sale beginning 181 days after the date of this prospectus.</p>`)
const f = leseHaltefrist(klar)
ok(f.tage === 180 && f.treffer === 1 && f.stelle.includes('for a period of 180 days after the date of this prospectus') && f.stelle.endsWith('representatives.'), 'eindeutig: 180 Tage, mit Textstelle')
ok(!f.stelle.includes('30 days') && f.ausnahmen === false, 'Mehrzuteilung (30) und Händlerfrist (25) zählen nicht')

const gestaffelt = textAusHtml(`${fuell}<p>Pursuant to the lock-up agreements, our directors have agreed not to sell any shares during the period ending 180 days after the date of this prospectus; provided that the restricted period will end on the earlier of that date and the second trading day after our first earnings release.</p><p>Certain other holders are subject to market stand-off provisions and will not sell shares until the 90th day after the date of this prospectus.</p>`)
const g = leseHaltefrist(gestaffelt)
ok(g.tage === null && g.mehrdeutig === true && g.werte.join() === '90,180', 'zwei Dauern genannt: keine wird gewählt')
const vorzeitig = leseHaltefrist(textAusHtml(`${fuell}<p>Under the lock-up agreements, holders have agreed not to dispose of shares for a 180-day lock-up period after the date of this prospectus, which will end on the earlier of that date and the opening of trading after our second earnings release.</p>`))
ok(vorzeitig.tage === 180 && vorzeitig.ausnahmen === true, '«180-day lock-up period»; vorzeitige Freigabe wird vermerkt')
ok(leseHaltefrist(textAusHtml(`${fuell}<p>The underwriters may exercise their option to purchase additional shares for a period of 30 days from the date of this prospectus.</p>`)) === null, 'nur die Mehrzuteilung: kein Fund')
ok(leseHaltefrist(`${fuell} Our shares are subject to a lock-up. Details are described under "Underwriting".`) === null && leseHaltefrist('') === null && leseHaltefrist(null) === null, 'nichts Eindeutiges: null')
ok(leseHaltefrist(`${fuell} The holders have agreed to a lock-up and will not sell shares for a period of 5 days after the date of this prospectus.`) === null, 'unplausible Dauer: kein Fund')
ok(textAusHtml('<style>p{}</style><p>A&amp;B&nbsp;&#8217;s</p><script>x()</script>') === "A&B 's", 'HTML → Text')

// ── Kontaktangabe ──
ok(pruefeKontakt('  Erika   Muster erika@beispiel.ch ').wert === 'Erika Muster erika@beispiel.ch', 'Kontakt: Leerraum bereinigt')
ok(pruefeKontakt('').grund === 'leer' && pruefeKontakt(null).grund === 'leer' && pruefeKontakt('Erika Muster').grund === 'ohneAdresse', 'leer / ohne Adresse')
ok(pruefeKontakt('a@b.ch\r\nX-Böse: 1').grund === 'zeichen' && pruefeKontakt('x'.repeat(130) + '@b.ch').grund === 'zuLang', 'Zeilenumbruch und Überlänge abgewiesen')
ok(userAgentAus('Jörg Müßig joerg@beispiel.ch') === 'Joerg Muessig joerg@beispiel.ch' && userAgentAus('') === null && userAgentAus('nur ein Name') === null, 'User-Agent nur aus der Kontaktangabe, in ASCII')

console.log(`EDGAR-Kern: ${n} bestanden, 0 fehlgeschlagen`)
