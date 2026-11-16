/**
 * Selbsttest: Titel-Seite (Yahoo-Antwort lesen), gegen eine echte Antwort.
 *
 *   node server/aktien/__selftest-titel.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ausZusammenfassung, kursLinie, bewegungsFrage, pruefeBewegung, zahl, termineAus } from './titel-kern.js'

let n = 0
const ok = (bed, text) => { assert.ok(bed, text); n++ }
const roh = JSON.parse(readFileSync(new URL('../fixtures/yahoo-quotesummary-nvda.json', import.meta.url), 'utf8'))
const d = ausZusammenfassung(roh)

ok(d.profil.name === 'NVIDIA Corporation' && d.profil.sektor === 'Technology' && d.profil.waehrung === 'USD', 'Profil')
ok(d.profil.webseite?.startsWith('https://') && d.profil.mitarbeiter > 1000, 'Webseite und Mitarbeiter')
ok(d.kurs.preis === 162.85 && Math.abs(d.kurs.aenderungPct + 2.0097) < 0.001, 'Kurs; Änderung ist ein Bruch und wird Prozent')
ok(d.kurs.zeit > 1.7e12 && d.kurs.zustand === 'CLOSED' && d.kurs.nachPreis > 0, 'Zeit in ms, Zustand, nachbörslich')
ok(d.kennzahlen.marktkap > 1e12 && Math.abs(d.kennzahlen.dividendePct - 0.61) < 0.001, 'Marktkap., Dividende in Prozent')
ok(d.kennzahlen.jahrTief === 148.8 && d.kennzahlen.jahrHoch === 243.37 && d.kennzahlen.kgv > 20, '52-Wochen-Spanne, KGV')

const a = d.analysten
ok(a.anzahl === 53 && a.konsens === 'kauf' && a.zielTief === 170 && a.zielHoch === 515, 'Konsens und Kursziele')
ok(a.verteilung.starkKauf === 10 && a.verteilung.kauf === 37 && a.verteilung.halten === 14, 'Verteilung des laufenden Monats')
ok(a.liste[0].firma === 'Rosenblatt' && a.liste[0].ziel === 300 && a.liste[0].zielVorher === 390, 'Einstufung mit Kursziel')
ok(a.liste[2].aktion === 'down' && a.liste[2].stufe === 'Hold' && a.liste[2].vorher === 'Buy', 'Herabstufung')

ok(d.ertraege.length >= 4 && d.ertraege[0].eps === 1.3 && d.ertraege[0].ueberraschungPct === 3.46, 'Ertragsverlauf, Überraschung schon in Prozent')
ok(d.termin.zeit > Date.UTC(2026, 10, 16) && d.termin.geschaetzt === false && d.termin.epsSchaetzung > 2, 'nächster Zahlentermin')

// Unbekannt bleibt unbekannt.
const leer = ausZusammenfassung({ quoteSummary: { result: [{ price: { shortName: 'X', regularMarketPrice: { raw: 5 } } }] } })
ok(leer.analysten === null && leer.termin === null && leer.ertraege.length === 0, 'ohne Analysten: null statt 0')
ok(leer.kennzahlen.kgv === null && leer.kennzahlen.dividendePct === null && leer.profil.name === 'X', 'fehlende Kennzahl ist null')
const ohneZiel = ausZusammenfassung({ quoteSummary: { result: [{ upgradeDowngradeHistory: { history: [{ epochGradeDate: 1794605535, firm: 'F', toGrade: 'Buy', currentPriceTarget: 0 }] } }] } })
ok(ohneZiel.analysten.liste[0].ziel === null && ohneZiel.analysten.anzahl === null, 'Kursziel 0 heisst: keines genannt')
assert.throws(() => ausZusammenfassung({ quoteSummary: { result: null, error: { description: 'No fundamentals data' } } }), /No fundamentals/); n++
assert.throws(() => ausZusammenfassung({}), /leere Antwort/); n++
ok(zahl({ raw: NaN }) === null && zahl('5') === null && zahl(0) === 0, 'zahl: nur endliche Zahlen')

// Newcomer-Karte: Streubesitz, Leerverkäufe, Insider, Kasse (echte Antwort CoreWeave, gekürzt)
const crwv = ausZusammenfassung(JSON.parse(readFileSync(new URL('../fixtures/yahoo-quotesummary-crwv.json', import.meta.url), 'utf8')))
const e = crwv.eigentum
ok(e.streubesitz === 339637102 && Math.abs(e.streubesitzPct - 72.91) < 0.01, 'Streubesitz in Stück und Prozent der ausstehenden Aktien')
ok(Math.abs(e.shortPctStreubesitz - 23.3) < 0.001 && e.shortTage === 1.34 && e.shortStand > 1.7e12, 'Leerverkäufe: Bruch wird Prozent, Stand in ms')
ok(e.shortStueck === 74211562 && e.shortVormonatStueck === 59952639, 'Leerverkäufe jetzt und im Vormonat')
ok(Math.abs(e.insiderPct - 19.986) < 0.001 && Math.abs(e.institutionenPct - 77.288) < 0.001, 'Anteile von Insidern und Institutionen')
ok(e.insider.length === 8 && e.insider[0].art === 'verkauf' && e.insider[0].wert === 629237 && e.insider[0].rolle === 'Chief Operating Officer', 'Verkauf mit Wert und Rolle')
ok(e.insider[2].art === 'zuteilung' && e.insider[2].wert === null, 'Zuteilung ist kein Kauf; Wert 0 heisst: keiner')
ok(e.insider[1].art === 'sonstig', 'Geschäft ohne Text bleibt «sonstig»')
ok(crwv.kasse.barmittel === 4228000000 && crwv.kasse.freierCashflow < 0 && crwv.kasse.schulden > 6e10, 'Kasse, Schulden, Mittelabfluss')
ok(leer.eigentum === null && leer.kasse === null, 'nichts gemeldet: null statt lauter Nullen')
ok(d.eigentum === null || d.eigentum.insider.length === 0, 'ältere Antwort ohne diese Felder bricht nichts')

// Zahlentermine für Simulation und Radar
const te = termineAus(roh)
ok(te.naechster.zeit === Date.UTC(2026, 10, 17, 21, 0) && te.naechster.geschaetzt === false, 'nächster Termin mit Uhrzeit')
ok(te.vergangene.length === 4 && te.vergangene[0] === Date.UTC(2025, 10, 19, 21, 20) && te.vergangene[3] === Date.UTC(2026, 7, 26, 20, 20), 'vier vergangene Termine, aufsteigend')
const ohneTermin = termineAus({ quoteSummary: { result: [{ price: {} }] } })
ok(ohneTermin.naechster === null && ohneTermin.vergangene.length === 0, 'ETF ohne Termine: leer, kein Fehler')
assert.throws(() => termineAus({}), /leere Antwort/); n++

const kerzen = Array.from({ length: 1001 }, (_, i) => ({ t: i, c: i }))
const linie = kursLinie(kerzen, 500)
ok(linie.length <= 502 && linie.at(-1)[0] === 1000 && linie[0][0] === 0, 'Kurslinie ausgedünnt, letzter Punkt bleibt')
ok(kursLinie([{ t: 1, c: 2 }]).length === 1 && kursLinie().length === 0, 'kurze und leere Reihe')

const frage = bewegungsFrage({ name: 'NVIDIA', symbol: 'NVDA' })
ok(frage.includes('<<<NVIDIA>>> (NVDA)') && /Keine Anlageberatung/.test(frage) && /keine eigenen Prognosen/.test(frage) && /mit dem Namen dessen/.test(frage), 'Frage ohne Beratung und eigene Prognose, Urheber verlangt')
ok(bewegungsFrage({ symbol: 'ASML.AS', sprache: 'en' }).includes('ASML.AS') , 'englische Frage, ohne Namen')

// ── Prüfung der Recherche-Antwort (Beispielantworten NACHGEBAUT, keine echten Perplexity-Antworten) ──
const bericht = 'Am 12. November meldete CoreWeave Quartalszahlen: Umsatz 1,36 Mrd. USD, über den Erwartungen. Das Unternehmen senkte die Prognose für die Investitionen 2026. Goldman Sachs hob das Kursziel von 130 auf 150 USD und bestätigte die Einstufung «Kaufen». Analysten von JPMorgan erwarten, dass die Aktie nach Ablauf der Haltefrist nachgeben wird.'
const b1 = pruefeBewegung(bericht)
ok(b1.ok && b1.gestrichen === 0 && b1.text === bericht, 'sachlicher Bericht mit Kursziel, Prognose des Unternehmens und Analystenstimme geht ganz durch')
const b2 = pruefeBewegung(`${bericht} Die Aktie dürfte in den nächsten Wochen weiter steigen. Anleger sollten jetzt kaufen.`)
ok(b2.ok && b2.gestrichen === 2 && b2.text === bericht, 'Vorhersage ohne Urheber und Rat werden gestrichen, der Bericht bleibt')
ok(b1.text.includes('Am 12. November meldete'), 'Datum «12. November» wird nicht als Satzende getrennt')
const b3 = pruefeBewegung('Die Aktie wird bald deutlich steigen. Jetzt einsteigen!')
ok(!b3.ok && b3.grund === 'empfehlung' && b3.gestrichen === 2 && b3.text === '', 'nur Prognose und Rat: verworfen')
ok(!pruefeBewegung('').ok && pruefeBewegung(null).grund === 'leer' && pruefeBewegung('Die Aktie dürfte steigen.').grund === 'prognose', 'leer und reine Prognose')
const en = pruefeBewegung('Morgan Stanley raised its price target to $160 and kept its Overweight rating. The company cut its full-year forecast. The stock is likely to rally from here. Investors should buy now.')
ok(en.ok && en.gestrichen === 2 && en.text.endsWith('full-year forecast.') && en.text.includes('price target'), 'englisch: Bericht bleibt, Vorhersage und Rat fallen')
ok(pruefeBewegung('According to Citi analysts, the stock could fall further if demand slows.').gestrichen === 0, 'englische Vorhersage mit Urheber ist Meldung')
const liste = pruefeBewegung('- Quartalszahlen am 12. November über den Erwartungen.\n- Die Aktie könnte jetzt ausbrechen.\n- Der Finanzchef trat am 10. November zurück.')
ok(liste.ok && liste.gestrichen === 1 && liste.text.split('\n').length === 3 && !/ausbrechen/.test(liste.text), 'Aufzählung: nur der betroffene Punkt fällt')
ok(pruefeBewegung('In den letzten Tagen gab es keine kursbewegenden Meldungen zu diesem Titel.').ok, '«nichts gefunden» ist eine gültige Antwort')
const lang = pruefeBewegung('Der Kurs reagierte auf die Zahlen. '.repeat(80))
ok(lang.ok && lang.text.length <= 1502 && lang.text.endsWith('…'), 'überlange Antwort wird am Wortende gekürzt')

console.log(`✓ Titel-Seite Aktien: ${n} Prüfungen`)
