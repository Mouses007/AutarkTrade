/**
 * Selbsttest des ETF-Fluss-Moduls.
 *
 *   node server/__selftest-etf-fluss.mjs
 *
 * Drei Dinge müssen stimmen, weil sie im Betrieb plausibel aussehen, wenn sie
 * falsch sind:
 *
 *   1. Der erste bekannte Tag hat KEINEN Fluss (`null`, nicht 0). Mit 0 zeigte
 *      jede frische Installation am ersten Balken einen erfundenen Nullfluss.
 *   2. Eine Lücke in der Reihe wird nicht zusammengeschoben. Sonst steckten
 *      zwei Tage Bewegung in einem Balken und sähen aus wie ein Grossereignis.
 *   3. Die Gesamtsumme kommt aus `all_symbol` und nie aus der Addition der
 *      abgefragten Fonds — sonst fehlten die nicht abgefragten unsichtbar.
 */

import {
    reiheAusAntwort, flussAusBestand, summeUeber, verdichteFonds,
    baueNutzlast, frischeHinweis, tagesBeginn, abrufLimit, verdichtePremium,
} from './etf-fluss.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const tag = (s) => Date.parse(`${s}T00:00:00Z`)

console.log('\n\x1b[1mETF-Fluss\x1b[0m')

// ── reiheAusAntwort ─────────────────────────────────────────────────────
{
    // CryptoQuant liefert neueste zuerst
    const roh = [
        { date: '2026-08-20', digital_asset_holdings: 1250000 },
        { date: '2026-08-19', digital_asset_holdings: 1248000 },
        { date: '2026-08-18', digital_asset_holdings: 1249000 },
    ]
    const r = reiheAusAntwort(roh)
    check('sortiert aufsteigend', r[0][0] === tag('2026-08-18') && r[2][0] === tag('2026-08-20'))
    check('Werte bleiben zugeordnet', r[0][1] === 1249000 && r[2][1] === 1250000)

    check('Datum ohne Zeitzone gilt als UTC', r[0][0] === tagesBeginn(tag('2026-08-18')))

    const schmutzig = reiheAusAntwort([
        { date: '2026-08-20', digital_asset_holdings: 100 },
        { date: '2026-08-20', digital_asset_holdings: 111 },   // Nachkorrektur
        { date: null, digital_asset_holdings: 5 },
        { date: '2026-08-21', digital_asset_holdings: null },
        { date: '2026-08-22', digital_asset_holdings: 'abc' },
    ])
    check('doppelter Tag: letzter gewinnt', schmutzig.length === 1 && schmutzig[0][1] === 111)
    check('null-Bestand wird nicht zu 0', !schmutzig.some(([, v]) => v === 0))
    check('kein Datum, kein Punkt', reiheAusAntwort(null).length === 0)
}

// ── flussAusBestand ─────────────────────────────────────────────────────
{
    const reihe = [
        [tag('2026-08-18'), 1000],
        [tag('2026-08-19'), 1010],
        [tag('2026-08-20'), 995],
    ]
    const p = flussAusBestand(reihe)
    check('erster Tag hat KEINEN Fluss', p[0].fluss === null)
    check('Zufluss ist die Differenz', p[1].fluss === 10)
    check('Abfluss ist negativ', p[2].fluss === -15)

    const mitLuecke = flussAusBestand([
        [tag('2026-08-18'), 1000],
        [tag('2026-08-21'), 1300],   // zwei Tage fehlen
    ])
    check('Lücke wird markiert', mitLuecke[1].luecke === true)
    check('über eine Lücke wird kein Fluss behauptet', mitLuecke[1].fluss === null)
}

// ── summeUeber ──────────────────────────────────────────────────────────
{
    const punkte = flussAusBestand([
        [tag('2026-08-15'), 100],
        [tag('2026-08-16'), 110],
        [tag('2026-08-17'), 130],
        [tag('2026-08-18'), 125],
    ])
    // Fenster = die letzten drei KALENDERTAGE (16., 17., 18.), also 10+20−5
    const s3 = summeUeber(punkte, 3)
    check('Summe über die letzten 3 Tage', s3.summe === 25, `bekam ${s3.summe}`)
    check('zählt, worauf sie beruht', s3.bekannt === 3 && s3.moeglich === 3)

    const nurEiner = summeUeber(flussAusBestand([[tag('2026-08-18'), 100]]), 7)
    check('ohne bekannten Fluss ist die Summe null, nicht 0', nurEiner.summe === null)
    check('Fenster meldet die fehlenden Tage', nurEiner.bekannt === 0 && nurEiner.moeglich === 1)
}

// ── baueNutzlast ────────────────────────────────────────────────────────
{
    const reihen = new Map([
        ['all_symbol', [[tag('2026-08-19'), 1000], [tag('2026-08-20'), 1040]]],
        ['ibit', [[tag('2026-08-19'), 600], [tag('2026-08-20'), 630]]],
        ['fbtc', [[tag('2026-08-19'), 200], [tag('2026-08-20'), 205]]],
        // 'gbtc' fehlt absichtlich: nicht jeder Fonds hat immer Daten
    ])
    const liste = [
        { id: 'all_symbol', name: 'Alle Fonds' },
        { id: 'ibit', name: 'iShares' },
        { id: 'fbtc', name: 'Fidelity' },
        { id: 'gbtc', name: 'Grayscale' },
    ]
    const n = baueNutzlast(reihen, liste)

    check('Gesamtbestand kommt aus all_symbol', n.gesamt.bestand === 1040)
    check('Gesamtfluss ist nicht die Summe der Einzelnen', n.gesamt.fluss1 === 40)
    check('Rest deckt die nicht abgefragten Fonds ab', n.rest === 1040 - 630 - 205)
    check('Fonds absteigend nach Bestand', n.fonds[0].id === 'ibit' && n.fonds[1].id === 'fbtc')
    check('Fonds ohne Daten fallen raus', !n.fonds.some(f => f.id === 'gbtc'))
    check('Anteil in Prozent', n.fonds[0].anteilPct === Math.round((630 / 1040) * 1000) / 10)
    check('Reihe trägt Tag, Bestand und Fluss', n.reihe[1][0] === tag('2026-08-20')
        && n.reihe[1][1] === 1040 && n.reihe[1][2] === 40)
    check('erster Reihenpunkt hat null als Fluss', n.reihe[0][2] === null)

    const leer = baueNutzlast(new Map(), liste)
    check('ohne Daten kein Absturz', leer.gesamt.bestand === null && leer.fonds.length === 0)
    check('ohne Gesamtbestand kein erfundener Rest', leer.rest === null)
}

// ── verdichteFonds ──────────────────────────────────────────────────────
{
    const v = verdichteFonds('ibit', 'iShares', [
        [tag('2026-08-18'), 500], [tag('2026-08-19'), 520], [tag('2026-08-20'), 515],
    ])
    check('letzter Tag zählt', v.bestand === 515 && v.fluss1 === -5)
    check('7-Tage-Fenster kennt seine Basis', v.fluss7.bekannt === 2 && v.fluss7.moeglich === 3)
}

// ── frischeHinweis ──────────────────────────────────────────────────────
{
    const jetzt = tag('2026-08-21') + 13 * 60 * 60 * 1000
    check('gestern ist frisch', frischeHinweis(tag('2026-08-20'), jetzt) === null)
    check('vorgestern ist noch frisch (Wochenende)', frischeHinweis(tag('2026-08-19'), jetzt) === null)
    check('drei Tage sind ein Hinweis', /3 Tage/.test(frischeHinweis(tag('2026-08-18'), jetzt) || ''))
    check('ohne Stand kein Hinweis', frischeHinweis(null, jetzt) === null)
}

// ── Coinbase-Premium: anderes Wertfeld, negative Werte ──────────────────
{
    const roh = [
        { date: '2026-08-20', coinbase_premium_index: -0.0606, coinbase_premium_gap: -39.8 },
        { date: '2026-08-19', coinbase_premium_index: 0.02 },
        { date: '2026-08-18', coinbase_premium_index: null },
        { date: '2026-08-17', coinbase_premium_index: 0 },
    ]
    const reihe = reiheAusAntwort(roh, 'coinbase_premium_index')
    check('Premium: Wertfeld wird gelesen', reihe.length === 3 && reihe[2][1] === -0.0606)
    check('Premium: echte Null bleibt, null fällt weg', reihe[0][1] === 0 && reihe[0][0] === tag('2026-08-17'))
    check('Premium: Fondsfeld greift hier nicht', reiheAusAntwort(roh).length === 0)

    const p = verdichtePremium(reihe)
    check('Premium: letzter Tag und Wert', p.tag === tag('2026-08-20') && p.wert === -0.0606)
    check('Premium: 7-Tage-Mittel über die vorhandenen Tage',
        Math.abs(p.mittel7 - (0 + 0.02 - 0.0606) / 3) < 1e-4, String(p.mittel7))
    check('Premium: leere Reihe ist null', verdichtePremium([]) === null)

    // Das Fenster zählt Kalendertage, nicht Einträge
    const lang = [[tag('2026-08-01'), 1], [tag('2026-08-19'), 0.1], [tag('2026-08-20'), 0.3]]
    check('Premium: alter Wert fällt aus dem 7-Tage-Mittel', Math.abs(verdichtePremium(lang).mittel7 - 0.2) < 1e-9)
}

// ── abrufLimit ──────────────────────────────────────────────────────────
{
    const jetzt = tag('2026-08-21') + 13 * 60 * 60 * 1000
    check('ohne Bestand der volle Monat', abrufLimit([], jetzt) === 35)
    check('Stand von gestern: vier Zeilen', abrufLimit([[tag('2026-08-20'), 1]], jetzt) === 4)
    check('Stand von heute: drei Zeilen', abrufLimit([[tag('2026-08-21'), 1]], jetzt) === 3)
    check('eine Woche Pause schliesst die Lücke', abrufLimit([[tag('2026-08-14'), 1]], jetzt) === 10)
    check('nie mehr als der Tarif hergibt', abrufLimit([[tag('2026-01-01'), 1]], jetzt) === 35)

    // Budget: zwölf Reihen, vier Läufe am Tag, 31 Tage — muss unter 10'000 bleiben
    const proMonat = 12 * abrufLimit([[tag('2026-08-20'), 1]], jetzt) * 4 * 31
    check(`Monatsverbrauch im Normalbetrieb unter 10'000 Zeilen (${proMonat})`, proMonat < 10000)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log(fehler.map(f => `  - ${f}`).join('\n')); process.exit(1) }
