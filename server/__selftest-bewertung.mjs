/**
 * Selbsttest der Bitcoin-Bewertung.
 *
 *   node server/__selftest-bewertung.mjs
 *
 * Was hier falsch sein kann, ohne aufzufallen:
 *
 *   1. Der Rang. „Q18" sieht bei jeder Zahl plausibel aus — geprüft wird an
 *      Reihen, deren Rang man im Kopf nachrechnen kann.
 *   2. Kurze Reihen im Gesamtwert. Ein Modell mit vier Jahren Geschichte darf
 *      den Mittelwert nicht mitbestimmen.
 *   3. Fehlende Felder der Quelle. `Number(null)` ist 0 — ein Tag ohne MVRV
 *      wäre sonst ein Tag mit Realized Price unendlich.
 *   4. Die Tage vor 2012 zählen nicht mit.
 */

import {
    TAG_MS, RANG_AB, W200_TAGE, LANG_AB_TAGE,
    reihenAusCoinMetrics, reiheAusBGeometrics, gleitend, rangVon, stufeVon,
    baueBewertung, abrufAb, frischeHinweis,
} from './bewertung.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const tag = (s) => Date.parse(`${s}T00:00:00Z`)

console.log('\n\x1b[1mBitcoin-Bewertung\x1b[0m')

// ── Antworten der Quellen ───────────────────────────────────────────────
{
    const roh = [
        { asset: 'btc', time: '2026-11-13T00:00:00.000000000Z', CapMVRVCur: '1.25', PriceUSD: '70000.5' },
        { asset: 'btc', time: '2026-11-12T00:00:00.000000000Z', CapMVRVCur: '1.20', PriceUSD: '68000' },
        // Tag ohne MVRV: der Kurs zählt, das Verhältnis fehlt
        { asset: 'btc', time: '2026-11-14T00:00:00.000000000Z', PriceUSD: '71000' },
        { asset: 'btc', time: '2026-11-15T00:00:00.000000000Z', CapMVRVCur: null, PriceUSD: '' },
        { asset: 'btc', time: 'kaputt', CapMVRVCur: '1', PriceUSD: '1' },
    ]
    const { kurs, mvrv } = reihenAusCoinMetrics(roh)
    check('Coin Metrics: Kurs aufsteigend, Zeichenketten zu Zahlen',
        kurs.length === 3 && kurs[0][0] === tag('2026-11-12') && kurs[1][1] === 70000.5)
    check('Coin Metrics: Tag ohne MVRV fällt nur dort heraus', mvrv.length === 2 && mvrv[1][0] === tag('2026-11-13'))
    check('Coin Metrics: leeres Feld ist kein Nullwert', !kurs.some(k => k[0] === tag('2026-11-15')))
    check('Coin Metrics: keine Liste → leere Reihen', reihenAusCoinMetrics(null).kurs.length === 0)

    const sth = reiheAusBGeometrics([
        { d: '2026-11-08', unixTs: '1.794096E9', sthRealizedPrice: '75857.29' },
        { d: '2026-11-07', unixTs: '1.7940096E9', sthRealizedPrice: '75838.92' },
        { d: '2026-11-09', sthRealizedPrice: null },
        { d: '2026-11-10', sthRealizedPrice: '0' },
    ])
    check('BGeometrics: sortiert, ohne leere und Nullwerte',
        sth.length === 2 && sth[0][0] === tag('2026-11-07') && sth[1][1] === 75857.29)
}

// ── Bausteine ───────────────────────────────────────────────────────────
{
    const r = [[1, 2], [2, 4], [3, 6], [4, 8]]
    const g = gleitend(r, 2)
    check('gleitend: erst ab dem n-ten Eintrag', g.length === 3 && g[0][0] === 2 && g[0][1] === 3 && g[2][1] === 7)
    check('gleitend: zu kurze Reihe → leer', gleitend(r, 5).length === 0)

    const werte = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    check('Rang: kleiner als alle → 0', rangVon(werte, 0.5) === 0)
    check('Rang: grösser als alle → 100', rangVon(werte, 11) === 100)
    check('Rang: zwei von zehn kleiner → 20', rangVon(werte, 2.5) === 20)
    check('Rang: Gleichstand zählt halb', rangVon(werte, 3) === 25)
    check('Rang: leere Menge → null', rangVon([], 1) === null)

    check('Stufen', stufeVon(19) === 'guenstig' && stufeVon(20) === 'eherGuenstig'
        && stufeVon(50) === 'mittel' && stufeVon(79) === 'eherTeuer' && stufeVon(80) === 'teuer'
        && stufeVon(null) === null)
}

// ── baueBewertung ───────────────────────────────────────────────────────
{
    check('ohne Kurs → null', baueBewertung({}) === null)

    // Zwölf Jahre Tageskurs ab Mitte 2010: linear steigend, MVRV pendelt
    // zwischen 1 und 3 (Dreieck über 400 Tage). Damit ist nachrechenbar, wo
    // ein MVRV von 1.5 liegt: ein Viertel der Tage ist tiefer.
    const start = tag('2010-07-18')
    const n = 16 * 365
    const kurs = []
    const mvrv = []
    for (let i = 0; i < n; i++) {
        const t = start + i * TAG_MS
        kurs.push([t, 100 + i])
        const phase = (i % 400) / 400
        mvrv.push([t, 1 + 2 * (phase < 0.5 ? phase * 2 : 2 - phase * 2)])
    }
    // Letzter Tag: MVRV fest auf 1.5
    mvrv[mvrv.length - 1][1] = 1.5
    // Kurzfrist-Einstand nur für die letzten vier Jahre, endet eine Woche früher
    const sth = []
    for (let i = n - 4 * 365; i < n - 7; i++) sth.push([kurs[i][0], kurs[i][1] * 0.8])

    const b = baueBewertung({ kurs, mvrv, sth })
    const m = Object.fromEntries(b.modelle.map(x => [x.id, x]))
    const letzter = kurs[n - 1]

    check('Tag und Kurs sind der letzte Eintrag', b.tag === letzter[0] && b.preis === letzter[1])
    check('drei Modelle', b.modelle.length === 3 && m.realized && m.w200 && m.sth)

    check('Realized Price = Kurs / MVRV', Math.abs(m.realized.wert - letzter[1] / 1.5) < 0.01, `${m.realized.wert}`)
    check('Realized: Abstand +50 %', m.realized.abstandPct === 50)
    check('Realized: Rang rund 25', Math.abs(m.realized.rang - 25) <= 1, `${m.realized.rang}`)
    check('Realized: Rang beginnt 2012, nicht 2010', m.realized.seit === RANG_AB)
    check('Realized: zählt zum Gesamtwert', m.realized.zaehlt === true && m.realized.tage >= LANG_AB_TAGE)

    // Linear steigender Kurs: der Schnitt über 1400 Tage liegt 699.5 unter dem Kurs
    check('200 Wochen: Schnitt nachgerechnet', Math.abs(m.w200.wert - (letzter[1] - (W200_TAGE - 1) / 2)) < 0.01, `${m.w200.wert}`)
    // Das Verhältnis fällt mit steigendem Kurs stetig → der letzte Tag ist der tiefste
    check('200 Wochen: tiefstes Verhältnis → Rang 0', m.w200.rang === 0, `${m.w200.rang}`)
    check('200 Wochen: erst ab dem 1400. Tag', m.w200.seit === kurs[W200_TAGE - 1][0])

    check('Kurzfrist: Vergleichspreis ist der letzte bekannte', m.sth.wert === sth[sth.length - 1][1])
    check('Kurzfrist: Stand eine Woche vor dem Kurs', b.tag - m.sth.stand === 7 * TAG_MS, `${(b.tag - m.sth.stand) / TAG_MS}`)
    check('Kurzfrist: heutiger Kurs gegen alten Einstand', Math.abs(m.sth.verh - letzter[1] / m.sth.wert) < 0.001)
    check('Kurzfrist: vier Jahre zählen NICHT zum Gesamtwert', m.sth.zaehlt === false)

    check('Gesamtwert: Mittel der zwei langen Modelle',
        b.gesamt.anzahl === 2 && b.gesamt.rang === Math.round((m.realized.rang + m.w200.rang) / 2), `${b.gesamt.rang}`)
    check('Gesamtwert trägt eine Stufe', b.gesamt.stufe === stufeVon(b.gesamt.rang))

    check('Verlauf: Wochenpunkte, jüngster Tag dabei',
        b.verlauf[b.verlauf.length - 1][0] === b.tag && b.verlauf[1][0] - b.verlauf[0][0] === 7 * TAG_MS)
    check('Verlauf: beginnt nicht vor 2012', b.verlauf[0][0] >= RANG_AB)
    check('Verlauf: Kurzfrist-Spalte vor ihrem Beginn leer', b.verlauf[0][4] === null)

    // Ohne Kurzfrist-Reihe: zwei Modelle, Gesamtwert unverändert
    const ohne = baueBewertung({ kurs, mvrv })
    check('ohne BGeometrics: zwei Modelle, gleicher Gesamtwert',
        ohne.modelle.length === 2 && ohne.gesamt.rang === b.gesamt.rang)

    // Nur kurze Geschichte: kein Gesamtwert, aber Modelle
    const kurz = baueBewertung({ kurs: kurs.slice(-2000), mvrv: mvrv.slice(-2000) })
    check('kurze Geschichte: kein Gesamtwert', kurz.gesamt.rang === null && kurz.gesamt.stufe === null && kurz.modelle.length >= 1)
}

// ── Nachholen und Frische ───────────────────────────────────────────────
{
    check('abrufAb: leer → von Anfang an', abrufAb([]) === null)
    check('abrufAb: drei Tage vor dem letzten', abrufAb([[tag('2026-11-14'), 1]]) === '2026-11-11')
    const jetzt = tag('2026-11-15') + 10 * 60 * 60 * 1000
    check('Frische: Vortag ist in Ordnung', frischeHinweis(tag('2026-11-14'), jetzt) === null)
    check('Frische: fünf Tage alt → Hinweis', /5 Tage/.test(frischeHinweis(tag('2026-11-10'), jetzt) || ''))
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) {
    console.log(fehler.map(f => ` - ${f}`).join('\n'))
    process.exit(1)
}
