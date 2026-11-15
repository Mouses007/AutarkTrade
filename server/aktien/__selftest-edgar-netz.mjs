/**
 * Selbsttest: EDGAR-Netzteil (`edgar.js`) OHNE Netz — `axios.get` ist durch
 * eine Attrappe ersetzt, die Fixtures ausliefert, die Datenbank liegt im
 * Arbeitsspeicher.
 *
 *   node server/aktien/__selftest-edgar-netz.mjs
 *
 * Geprüft wird, was der Kern nicht sehen kann: dass ohne Kontaktangabe NICHTS
 * hinausgeht, dass der User-Agent genau die Kontaktangabe ist, dass nur
 * sec.gov gefragt wird, Bremse, Zwischenspeicher und die Ruhe nach einer
 * Ablehnung. Die Kontaktangabe hier ist erfunden («beispiel.ch»); der
 * Prospekttext ist nachgebaut. Ein echter Abruf findet nicht statt.
 */
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import axios from 'axios'

// Vor dem Laden der Datenbank: nichts im Projektordner anlegen (auch keine `.at-secret`).
const ordner = mkdtempSync(path.join(os.tmpdir(), 'at-edgar-'))
process.env.AT_DB_FILE = ':memory:'
process.env.AT_SECRET_FILE = path.join(ordner, 'secret')

let n = 0
const ok = (bed, text) => { assert.ok(bed, text); n++ }
const lies = (name) => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'))

const log = console.log
console.log = () => {}                // Migrationsmeldungen beim Anlegen der DB
const { initDb } = await import('../database.js')
const knex = await initDb()
console.log = log
const edgar = await import('./edgar.js')
const { BEHALTEN_BEIM_IMPORT, GEHEIME_SETTINGS } = await import('../geheimnisse.js')

// ── Attrappe ──
const abrufe = []                     // { url, ua, zeit }
let antwort = null                    // (url) => { status, data } — überschreibt die Fixtures
const PROSPEKT = `<html><body><p>${'Filler text about the business of the company. '.repeat(8)}</p><p>Our officers, directors and holders of substantially all of our shares have entered into lock-up agreements and have agreed that they will not offer, sell or otherwise dispose of any shares for a period of 180 days after the date of this prospectus without the consent of the representatives.</p></body></html>`
axios.get = async (url, cfg) => {
    abrufe.push({ url, ua: cfg?.headers?.['User-Agent'], zeit: Date.now() })
    if (antwort) return antwort(url)
    if (url === 'https://www.sec.gov/files/company_tickers.json') return { status: 200, data: lies('edgar-company-tickers.json') }
    if (url === 'https://data.sec.gov/submissions/CIK0001769628.json') return { status: 200, data: lies('edgar-submissions-crwv.json') }
    if (url === 'https://data.sec.gov/submissions/CIK0001769628-submissions-001.json') return { status: 200, data: lies('edgar-submissions-crwv-001.json') }
    if (url === 'https://data.sec.gov/submissions/CIK0001045810.json') return { status: 200, data: lies('edgar-submissions-nvda.json') }
    if (url.startsWith('https://www.sec.gov/Archives/edgar/data/1769628/')) return { status: 200, data: PROSPEKT }
    return { status: 404, data: '' }
}

// ── Einordnung der Einstellung ──
ok(BEHALTEN_BEIM_IMPORT.includes('edgarKontakt') && !GEHEIME_SETTINGS.includes('edgarKontakt'), 'edgarKontakt: kein Geheimnis, aber nie aus einem fremden Backup')

// ── Ohne Kontaktangabe geht nichts hinaus ──
ok((await edgar.kontaktStand()).hinterlegt === false, 'ab Werk keine Kontaktangabe')
await assert.rejects(() => edgar.holeEinreichungen('CRWV'), (e) => e.code === 'quelleAus' && e.grund === 'kontaktFehlt'); n++
ok(abrufe.length === 0, 'ohne Kontaktangabe: kein einziger Abruf')
await assert.rejects(() => edgar.setzeKontakt('nur ein Name'), (e) => e.grund === 'ohneAdresse'); n++
await assert.rejects(() => edgar.setzeKontakt('a@b.ch\r\nX-Fremd: 1'), (e) => e.grund === 'zeichen'); n++
ok((await knex('settings').where('id', 1).first()).edgarKontakt === '', 'ungültige Angabe wird nicht gespeichert')

// ── Mit Kontaktangabe ──
const KONTAKT = 'Erika Müster erika@beispiel.ch'
const stand = await edgar.setzeKontakt(`  ${KONTAKT} `)
ok(stand.hinterlegt && stand.kontakt === KONTAKT && stand.userAgent === 'Erika Muester erika@beispiel.ch', 'gespeichert; Kopfzeile in ASCII')

ok((await edgar.holeEinreichungen('ASML.AS')).grund === 'keinUsTicker' && abrufe.length === 0, 'Nicht-US-Titel: nicht geführt, ohne Abruf')
const fremd = await edgar.holeEinreichungen('ZZZZ')
ok(fremd.ok && fremd.gefuehrt === false && fremd.grund === 'nichtInListe' && abrufe.length === 1, 'unbekannter Ticker: nicht geführt (nur die Liste geholt)')

const r = await edgar.holeEinreichungen('CRWV')
ok(r.ok && r.gefuehrt && r.firma.name === 'CoreWeave, Inc.' && r.vollstaendig === true, 'CoreWeave samt älterer Seite')
ok(r.prospekt.link.endsWith('d899798d424b4.htm') && r.prospekt.zugang === undefined && r.kennzahl.angebote12m === 2, 'Prospekt-Link und Kennzahl')
ok(r.haltefrist.gelesen === true && r.haltefrist.fund.tage === 180 && r.haltefrist.fund.stelle.includes('180 days after the date of this prospectus') && r.haltefrist.mehrdeutig === null, 'Haltefrist als Fund mit Textstelle')
ok(abrufe.length === 4 && abrufe.every((a) => a.ua === 'Erika Muester erika@beispiel.ch'), 'User-Agent ist genau die Kontaktangabe')
ok(abrufe.every((a) => /^https:\/\/(www|data)\.sec\.gov\//.test(a.url)) && abrufe.every((a) => !a.url.includes('beispiel') && !a.url.includes('Erika')), 'nur sec.gov; die Kontaktangabe steht in keiner Adresse')
const abstaende = abrufe.slice(1).map((a, i) => a.zeit - abrufe[i].zeit)
ok(abstaende.slice(1).every((ms) => ms >= 240), `Bremse: mindestens 250 ms zwischen den Abrufen (${abstaende.slice(1).join(', ')})`)

// ── Zwischenspeicher ──
await edgar.holeEinreichungen('crwv')
ok(abrufe.length === 4, 'zweiter Aufruf kommt aus dem Speicher')
const [a, b] = await Promise.all([edgar.holeEinreichungen('NVDA'), edgar.holeEinreichungen('NVDA')])
ok(a === b && abrufe.length === 5 && a.haltefrist === null && a.prospekt === null && a.vollstaendig === false, 'gleichzeitige Aufrufe teilen sich einen Abruf; NVIDIA ohne Archiv und ohne Prospekt')
await edgar.holeEinreichungen('CRWV', { neu: true })
ok(abrufe.length === 7, 'neu=1: Einreichungen frisch (2 Abrufe), Ticker-Liste und Prospekt-Fund bleiben gemerkt')

// ── Prospekt nicht lesbar: kein Fehler der Karte ──
antwort = (url) => (url.includes('/Archives/') ? { status: 500, data: '' } : url.includes('0001045810') ? { status: 200, data: lies('edgar-submissions-nvda.json') } : { status: 404, data: '' })
ok((await edgar.holeEinreichungen('NVDA', { neu: true })).gefuehrt === true, 'Abruf mit Attrappe')
antwort = null

// ── Ablehnung: zehn Minuten Ruhe ──
const vorher = abrufe.length
antwort = () => ({ status: 403, data: '<html>Undeclared Automated Tool</html>' })
await assert.rejects(() => edgar.holeEinreichungen('NVDA', { neu: true }), edgar.EdgarAbgelehnt); n++
await assert.rejects(() => edgar.holeEinreichungen('NVDA', { neu: true }), edgar.EdgarGebremst); n++
ok(abrufe.length === vorher + 1, 'nach der Ablehnung wird nicht weitergefragt')
const test = await edgar.pruefeZugang()
ok(test.ok === false && test.grund === 'gebremst' && abrufe.length === vorher + 1, 'auch der Test-Knopf wartet')
antwort = null

// ── Löschen schaltet EDGAR aus ──
const leer = await edgar.setzeKontakt('')
ok(leer.hinterlegt === false && leer.kontakt === '', 'leer = aus')
await assert.rejects(() => edgar.holeEinreichungen('CRWV'), (e) => e.grund === 'kontaktFehlt'); n++

// ── HTML statt JSON mit Status 200 ──
await edgar.setzeKontakt(KONTAKT)     // neuer Anlauf hebt die Ruhe auf
antwort = (url) => (url.includes('company_tickers') ? { status: 200, data: lies('edgar-company-tickers.json') } : { status: 200, data: '<!DOCTYPE html><title>Request Rate Threshold Exceeded</title>' })
await assert.rejects(() => edgar.holeEinreichungen('NVDA', { neu: true }), /kein JSON/); n++

await knex.destroy()
rmSync(ordner, { recursive: true, force: true })
console.log(`EDGAR-Netzteil (ohne Netz): ${n} bestanden, 0 fehlgeschlagen`)
process.exit(0)
