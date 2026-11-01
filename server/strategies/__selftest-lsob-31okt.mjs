/**
 * Selbsttest: LSOB auf den echten BTCUSDT-15m-Kerzen vom 31.10.2026.
 *
 * Zwei Fälle, die der Owner am 01.11.2026 an der Papier-Instanz #19 gezeigt
 * hat (Fixture `server/fixtures/lsob-btc-15m-2026-10-31.json`):
 *
 *  1. Short, Box 11:45 UTC (77 558,8–77 664,9). 12:15 schliesst unter der Box,
 *     12:30 sticht der Docht durch die ganze Box bis 77 723,3. Die Box ist
 *     damit abgeholt — die Strategie hielt sie trotzdem für gültig, weil sie
 *     erst ab dem Impulsende prüfte, füllte 13:45 und verlor 1,28 R.
 *  2. Long, Box 15:00 UTC (77 333,4–77 418,3). 21:00 tippt die Kerze sauber
 *     in die Box. Mit dem 4h-Trendfilter (EMA 50 deutlich über dem Kurs) ist
 *     das kein Einstieg; abgelaufen hiess das bisher »Zone nicht erreicht«.
 *
 * Gespielt wird wie im Betrieb: Kerze für Kerze, nur geschlossene 4h-Kerzen,
 * Ereignisse werden auf die offenen Setups angewendet.
 *
 * Aufruf: node server/strategies/__selftest-lsob-31okt.mjs
 */
import fs from 'node:fs'
import lsob, { INVALID_REASONS } from './lsob.js'

const roh = JSON.parse(fs.readFileSync(new URL('../fixtures/lsob-btc-15m-2026-10-31.json', import.meta.url), 'utf8'))
const kerze = ([t, o, h, l, c]) => ({ t, o, h, l, c, v: 1 })
const K15 = roh.k15m.map(kerze)
const K4H = roh.k4h.map(kerze)
const M15 = 15 * 60e3
const H4 = 4 * 3600e3

let fehler = 0
let bestanden = 0
const pruefe = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}

const utc = (h, m, tag = 31, monat = 9) => Date.UTC(2026, monat, tag, h, m)

/** Wie die Engine: je geschlossene Kerze ein Aufruf, Ereignisse anwenden. */
function spiele(htfTrendFilter) {
    const p = {}
    for (const def of lsob.params) p[def.key] = def.default
    Object.assign(p, { htfTrendFilter, htfTimeframe: '4h' })
    const alle = []
    let offen = []
    const bekannt = []
    const ab = K15.findIndex((k) => k.t >= utc(0, 0))
    for (let i = ab; i < K15.length; i++) {
        const sicht = K15.slice(Math.max(0, i - 399), i + 1)
        const bisT = K15[i].t + M15
        const htf = htfTrendFilter ? K4H.filter((h) => h.t + H4 <= bisT) : null
        const r = lsob.detect({ candles: sicht, params: p, openSetups: offen, knownSetupKeys: bekannt, htfCandles: htf })
        for (const ev of r.events) {
            const s = alle.find((x) => x.id === ev.id)
            Object.assign(s, { status: ev.status, invalidReason: ev.invalidReason || '', endeT: ev.candleTime, ev })
            offen = offen.filter((x) => x.id !== ev.id)
        }
        for (const neu of r.setups) {
            const s = { ...neu, id: alle.length + 1, erkanntT: K15[i].t }
            alle.push(s)
            offen.push(s)
            bekannt.push(`${s.direction}|${s.obCandleTime}`)
        }
    }
    return alle
}

console.log('\nLSOB auf BTCUSDT 15m, 31.10.2026\n')

{
    const setups = spiele(true)
    const short = setups.find((s) => s.direction === 'short' && s.obCandleTime === utc(11, 45))
    pruefe('Short-Box 11:45 wird erkannt', !!short, setups.map((s) => `${s.direction}@${new Date(s.obCandleTime).toISOString()}`).join(' '))
    if (short) {
        pruefe('Short-Box: Grenzen wie im Betrieb', short.obLow === 77558.8 && short.obHigh === 77664.9,
            `${short.obLow}–${short.obHigh}`)
        pruefe('Short-Box: ungültig, kein Einstieg', short.status === 'invalidated', short.status)
        pruefe('Short-Box: Grund neuer Sweep (Docht 12:30 über das Hoch)',
            short.invalidReason === INVALID_REASONS.NEW_SWEEP && short.endeT === utc(12, 30),
            `${short.invalidReason} @ ${short.endeT && new Date(short.endeT).toISOString()}`)
    }

    const long = setups.find((s) => s.direction === 'long' && s.obCandleTime === utc(15, 0))
    pruefe('Long-Box 15:00 wird erkannt', !!long)
    if (long) {
        pruefe('Long-Box mit 4h-Filter: abgelaufen, Grund Trendfilter',
            long.status === 'expired' && long.invalidReason === INVALID_REASONS.FILTER_HTF,
            `${long.status} / ${long.invalidReason}`)
        // Gezeichnet wird bis hierher — nicht mehr pauschal 20 Kerzen (bis 20:00).
        pruefe('Long-Box: Ende nach dem Antippen um 21:00', long.endeT > utc(21, 0), String(long.endeT && new Date(long.endeT).toISOString()))
    }
}

{
    const setups = spiele(false)
    const long = setups.find((s) => s.direction === 'long' && s.obCandleTime === utc(15, 0))
    pruefe('Long-Box ohne Filter: Einstieg beim Antippen 21:00 an der Kante',
        long?.status === 'triggered' && long.ev.triggeredAt === utc(21, 0) && long.ev.entry === 77418.3,
        long ? `${long.status} @ ${long.ev?.triggeredAt && new Date(long.ev.triggeredAt).toISOString()} ${long.ev?.entry}` : 'fehlt')
}

// Nachholen nach einem Ausfall: ein einziger Aufruf über alle Kerzen bis
// 01.11. 03:00, wie der erste Lauf einer neuen Instanz. Der Long läuft am Ende
// seiner 40-Kerzen-Frist ab, nicht erst an der jüngsten Kerze — sonst zeichnete
// der Chart die Box bis zur Verarbeitung (#28 am 01.11.2026: bis 08:15).
{
    const p = {}
    for (const def of lsob.params) p[def.key] = def.default
    // Frist 30 statt 40: der Impuls endet beim Nachholen erst 17:30, das
    // Fristende läge sonst hinter der letzten Kerze der Fixture (02:45).
    Object.assign(p, { htfTrendFilter: true, htfTimeframe: '4h', retestMaxCandles: 30 })
    const sicht = K15.slice(-400)
    const htf = K4H.filter((h) => h.t + H4 <= sicht[sicht.length - 1].t + M15)
    const erst = lsob.detect({ candles: sicht, params: p, openSetups: [], knownSetupKeys: [], htfCandles: htf })
    const offen = erst.setups.map((s, i) => ({ ...s, id: i + 1 }))
    const dann = lsob.detect({ candles: sicht, params: p, openSetups: offen, knownSetupKeys: [], htfCandles: htf })
    const long = offen.find((s) => s.direction === 'long' && s.obCandleTime === utc(15, 0))
    const ev = long && dann.events.find((e) => e.id === long.id)
    pruefe('Nachholen: Long läuft am Fristende ab (Trendfilter), nicht an der jüngsten Kerze',
        ev?.status === 'expired' && ev.invalidReason === INVALID_REASONS.FILTER_HTF
        && ev.candleTime === Number(long.watchFrom) + p.retestMaxCandles * M15,
        ev ? `${ev.status}/${ev.invalidReason} @ ${new Date(ev.candleTime).toISOString()}` : 'fehlt')
}

console.log(`lsob-31okt: ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler ? 1 : 0)
