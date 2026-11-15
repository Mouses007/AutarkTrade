/**
 * Selbsttest: Titel-Seite (Yahoo-Antwort lesen), gegen eine echte Antwort.
 *
 *   node server/aktien/__selftest-titel.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ausZusammenfassung, kursLinie, bewegungsFrage, zahl } from './titel-kern.js'

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

const kerzen = Array.from({ length: 1001 }, (_, i) => ({ t: i, c: i }))
const linie = kursLinie(kerzen, 500)
ok(linie.length <= 502 && linie.at(-1)[0] === 1000 && linie[0][0] === 0, 'Kurslinie ausgedünnt, letzter Punkt bleibt')
ok(kursLinie([{ t: 1, c: 2 }]).length === 1 && kursLinie().length === 0, 'kurze und leere Reihe')

const frage = bewegungsFrage({ name: 'NVIDIA', symbol: 'NVDA' })
ok(frage.includes('NVIDIA (NVDA)') && /Keine Anlageberatung/.test(frage) && /keine Prognosen/.test(frage), 'Frage ohne Beratung und Prognose')
ok(bewegungsFrage({ symbol: 'ASML.AS', sprache: 'en' }).includes('ASML.AS') , 'englische Frage, ohne Namen')

console.log(`✓ Titel-Seite Aktien: ${n} Prüfungen`)
