/**
 * Selbsttest: Trendlinien an den Kerzen vermessen (chart-trendlinien.js,
 * kandidatenTrendlinien in chart-kandidaten.js).
 *
 *   node server/__selftest-chart-trendlinien.mjs
 *
 * Anlass 18.10.2026: die KI zog die BTC-Abwärtslinie vom absoluten Hoch, und
 * die Hochs danach lagen 476 USD darüber. Anlass 20.10.2026: der CODE bot auf
 * BTC 15m eine „steigende Hochlinie (3 Berührungen)" an, die links vom ersten
 * Anker durch die Kerzen schnitt und deren Berührungen zwei Hochs derselben
 * Welle waren; auf BTC 4h stand eine Kandidatin 21 ATR über dem Kurs.
 *
 * Teil 2 läuft gegen echte Kerzen (`fixtures/chart-trendfaelle.json`, Binance
 * USDT-Perps, 20.10.2026): je Fall eine Linie, die ein Trader zieht und die
 * bleiben muss, und eine beliebige, die wegfallen muss.
 */
import { readFileSync } from 'node:fs'
import { wendepunkte, pruefeTrend, alleTrendlinien, besteTrendlinie, istAusreisser, verlaengerung, TREND } from './chart-trendlinien.js'
import { kandidatenTrendlinien, KAND } from './chart-kandidaten.js'
import { atr } from '../shared/indicators.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}
const H = 3600e3
const T0 = 1_760_000_000_000
const letzteAtr = (k) => atr(k, 14).at(-1)

// ── Teil 1: Regeln an gebauten Reihen ───────────────────────────────────

/*
 * Wie BTC 4h am 18.10.2026: ein Top bei i = 8 (132), danach eine echte
 * Abwärtslinie y = 125 − 0,85·(i − 20) mit Hochs genau darauf bei 20, 40, 60;
 * alle übrigen Hochs 6 darunter. Die Linie vom Top durch das Hoch bei 40
 * läuft bei 20 durch 123 — das Hoch dort (125) wächst hindurch.
 */
const abLinie = (i) => 125 - 0.85 * (i - 20)
function reihe() {
    const k = []
    for (let i = 0; i < 75; i++) {
        let h = abLinie(i) - 6
        if (i === 20 || i === 40 || i === 60) h = abLinie(i)
        if (i === 8) h = 132
        k.push({ t: T0 + i * H, o: h - 2, h, l: h - 3, c: h - 1 })
    }
    return k
}
const k = reihe()

console.log('\nWendepunkte und Bruch\n')
{
    const pv = wendepunkte(k, 'hoch')
    check('die drei Linien-Hochs und das Top sind die Wendepunkte', JSON.stringify(pv) === '[8,20,40,60]', JSON.stringify(pv))
    const gut = pruefeTrend(k, 20, k[20].h, 60, k[60].h, 'hoch', 0.5, pv, { atr: 2 })
    check('Linie an den Hochs 20–60 hält, drei Berührungen', gut.ok && gut.beruehrungen === 3 && gut.beruehrIdx.join() === '20,40,60', JSON.stringify(gut))
    const vomTop = pruefeTrend(k, 8, 132, 40, k[40].h, 'hoch', 0.5, pv, { atr: 2 })
    check('Gegenprobe: Linie vom Top durch 40 bricht (Hoch 20 liegt 2 darüber)', !vomTop.ok && vomTop.grund === 'bruch')
    const b = besteTrendlinie(k, 'hoch', { tol: 0.5, atr: 3, richtung: 'ab' })
    check('beste fallende Linie an den Hochs: 20 → 60', b && b.i1 === 20 && b.i2 === 60, JSON.stringify(b))
    check('steigende Linie an Hochs gibt es hier nicht', besteTrendlinie(k, 'hoch', { tol: 0.5, atr: 3, richtung: 'auf' }) === null)
}

/** Seitwärts mit Hochs bei `basis`, Tiefs 2 darunter; einzelne Kerzen überschreibbar. */
function seitwaerts(n, basis, ueber = {}) {
    return Array.from({ length: n }, (_, i) => {
        const x = ueber[i]
        if (x) return { t: T0 + i * H, ...x }
        return { t: T0 + i * H, o: basis - 1.5, h: basis, l: basis - 2, c: basis - 0.5 }
    })
}
const hochBei = (h, c = h - 1) => ({ o: c - 0.5, h, l: h - 2, c })

console.log('\nLinks vom ersten Anker (BTC 15m, 20.10.2026)\n')
{
    // Früher lagen die Hochs bei 110 (Schlüsse 109), dann Seitwärts bei 100. Eine steigende Linie an
    // den Hochs 30 (101) → 50 (102) → 70 (103) liegt bei i = 15 um 100,25 — die Schlüsse dort
    // (109) liegen 9 darüber: sie schneidet durch den Verlauf, an dem sie angeblich anliegt.
    const ueber = {}
    for (let i = 0; i < 22; i++) ueber[i] = { o: 108.5, h: 110, l: 108, c: 109 }
    ueber[30] = hochBei(101); ueber[50] = hochBei(102); ueber[70] = hochBei(103)
    const r = seitwaerts(80, 98, ueber)
    const pv = wendepunkte(r, 'hoch')
    const t = pruefeTrend(r, 30, 101, 70, 103, 'hoch', 0.6, pv, { atr: 2 })
    check('Linie, die links durch die Schlüsse schneidet → verworfen (grund links)', !t.ok && t.grund === 'links', JSON.stringify(t))
    // Gegenprobe: ohne die alten Hochs hält dieselbe Linie
    const ohne = seitwaerts(80, 98, { 30: hochBei(101), 50: hochBei(102), 70: hochBei(103) })
    const t2 = pruefeTrend(ohne, 30, 101, 70, 103, 'hoch', 0.6, wendepunkte(ohne, 'hoch'), { atr: 2 })
    check('Gegenprobe: ohne Verlauf darüber hält sie, 3 Berührungen', t2.ok && t2.beruehrungen === 3, JSON.stringify(t2))
}

console.log('\nBerührungen derselben Welle\n')
{
    // Doppelhoch 30/34 ohne Rücksetzer dazwischen (Schlüsse bleiben an der Linie) = EINE Berührung.
    const ueber = { 30: hochBei(100), 31: hochBei(99.6, 99.4), 32: hochBei(99.5, 99.3), 33: hochBei(99.6, 99.4), 34: hochBei(99.9), 60: hochBei(98.5) }
    const r = seitwaerts(75, 96, ueber)
    const pv = wendepunkte(r, 'hoch')
    const L = (i) => 100 - 1.5 * (i - 30) / 30
    const t = pruefeTrend(r, 30, 100, 60, 98.5, 'hoch', 0.6, pv, { atr: 2 })
    check('Doppelhoch ohne Rücksetzer zählt einmal (2 statt 3 Berührungen)', t.ok && t.beruehrungen === 2, JSON.stringify(t))
    check('… es zählt das Hoch näher an der Linie', t.beruehrIdx[0] === (Math.abs(r[30].h - L(30)) <= Math.abs(r[34].h - L(34)) ? 30 : 34), JSON.stringify(t.beruehrIdx))
    // Gegenprobe: mit Rücksetzer (Schlüsse 3 unter der Linie) sind es zwei Wellen
    const mit = seitwaerts(75, 96, { ...ueber, 31: hochBei(97, 96.5), 32: hochBei(96, 95.5), 33: hochBei(97, 96.5) })
    const t2 = pruefeTrend(mit, 30, 100, 60, 98.5, 'hoch', 0.6, wendepunkte(mit, 'hoch'), { atr: 2 })
    check('Gegenprobe: mit Rücksetzer ≥ 1 ATR sind es zwei Berührungen + Anker 60 = 3', t2.ok && t2.beruehrungen === 3, JSON.stringify(t2))
}

console.log('\nAusreisser-Docht\n')
{
    check('Nadel: Docht 4 bei Körper 0,5 und ATR 2 → Ausreisser', istAusreisser({ o: 100, c: 100.5, h: 104.5, l: 99.5 }, 'hoch', 2))
    check('Gegenprobe: normales Hoch (Docht 0,5) ist keiner', !istAusreisser({ o: 100, c: 103, h: 103.5, l: 99.5 }, 'hoch', 2))
    check('Tief-Seite: langer unterer Docht', istAusreisser({ o: 100, c: 99.6, h: 100.2, l: 95 }, 'tief', 2))
    // Linie durch zwei echte Hochs und eine Nadel: die Nadel zählt nicht
    const ueber = { 20: hochBei(100), 40: { o: 97.8, c: 98.2, h: 101.5, l: 97.5 }, 60: hochBei(103) }
    const r = seitwaerts(75, 95, ueber)
    const t = pruefeTrend(r, 20, 100, 60, 103, 'hoch', 0.6, wendepunkte(r, 'hoch'), { atr: 1.5 })
    check('Nadel auf der Linie zählt nicht als Berührung', t.ok && t.beruehrungen === 2 && !t.beruehrIdx.includes(40), JSON.stringify(t))
}

console.log('\nGegenlinie, Steigung, Spanne\n')
{
    // steigend an Hochs mit nur zwei Berührungen: beliebige Verbindung zweier Hochs
    const zwei = seitwaerts(80, 95, { 20: hochBei(100), 50: hochBei(102) })
    check('steigende Linie an Hochs mit 2 Berührungen → keine Kandidatin', alleTrendlinien(zwei, 'hoch', { tol: 0.6, atr: 2 }).length === 0)
    const drei = seitwaerts(80, 95, { 20: hochBei(100), 40: hochBei(101), 60: hochBei(102) })
    const d = alleTrendlinien(drei, 'hoch', { tol: 0.6, atr: 2 })
    check('Gegenprobe: mit 3 Berührungen bleibt sie', d.length >= 1 && d[0].beruehrungen === 3, JSON.stringify(d[0]))
    // fallend an Hochs, 2 Berührungen, aber nur 12 Kerzen auseinander
    const kurz = seitwaerts(80, 90, { 50: hochBei(100), 62: hochBei(98) })
    check('2 Berührungen in 12 Kerzen → zu kurz', alleTrendlinien(kurz, 'hoch', { tol: 0.6, atr: 2 }).length === 0)
    const lang = seitwaerts(80, 90, { 40: hochBei(100), 62: hochBei(98) })
    check('Gegenprobe: dieselbe Linie über 22 Kerzen bleibt', alleTrendlinien(lang, 'hoch', { tol: 0.6, atr: 2 }).length === 1)
    // steiler als MAX_STEIL_ATR: 12 in 20 Kerzen bei ATR 1 = 0,6 ATR je Kerze
    const steil = seitwaerts(80, 80, { 40: hochBei(100), 60: hochBei(88) })
    check(`steiler als ${TREND.MAX_STEIL_ATR} ATR je Kerze → keine Trendlinie`, alleTrendlinien(steil, 'hoch', { tol: 0.3, atr: 1 }).length === 0)
}

console.log('\nLänge\n')
{
    check('Verlängerung mindestens VERL_MIN', verlaengerung(150, 145) === TREND.VERL_MIN)
    check('Verlängerung höchstens VERL_MAX', verlaengerung(150, 0) === TREND.VERL_MAX)
    check('dazwischen ein Viertel der Spanne', verlaengerung(150, 109) === 10)
}

// ── Teil 2: echte Kerzen ────────────────────────────────────────────────

const FAELLE = JSON.parse(readFileSync(new URL('./fixtures/chart-trendfaelle.json', import.meta.url), 'utf8'))
const kerzenVon = (name) => FAELLE[name].kerzen.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
const kand = (name) => { const r = kerzenVon(name); return kandidatenTrendlinien(r, letzteAtr(r)) }
const hat = (liste, seite, p1, p2) => liste.some((x) => x.seite === seite && x.p1 === p1 && x.p2 === p2)
const kurz = (liste) => liste.map((x) => `${x.seite}/${x.richtung} ${x.p1}→${x.p2} ${x.beruehrungen}`).join('; ') || '—'

console.log('\nEchte Fälle: der Fall des Nutzers (BTCUSDT 15m, 20.10.2026 20:45)\n')
{
    const r = kerzenVon('btc-15m-nutzerfall')
    const A = letzteAtr(r)
    const i1 = r.findIndex((x) => x.h === 82197.7), i2 = r.findIndex((x) => x.h === 83420)
    const pv = wendepunkte(r, 'hoch')
    const t1 = pruefeTrend(r, i1, 82197.7, i2, 83420, 'hoch', TREND.TOL_ATR * A, pv, { atr: A })
    check('T1 „steigende Hochlinie" 82 198 → 83 420 schneidet links durch die Kerzen', !t1.ok && t1.grund === 'links', JSON.stringify(t1))
    const t = kand('btc-15m-nutzerfall')
    check('T1 kommt nicht mehr als Kandidatin', !hat(t, 'hoch', 82197.7, 83420), kurz(t))
    check('T2 „fallende Hochlinie" 83 420 → 82 899 (12 Kerzen, 2 Berührungen) kommt nicht mehr', !hat(t, 'hoch', 83420, 82899), kurz(t))
    check('fallende Linie an Tiefs 81 724 → 81 146 (−8 ATR) kommt nicht mehr', !hat(t, 'tief', 81724, 81146.4), kurz(t))
    check('in diesem Seitwärtsbereich bietet der Code ehrlich KEINE Trendlinie an', t.length === 0, kurz(t))
}

console.log('\nEchte Fälle: HBARUSDT 4h, Linie nach dem Pump (29.10.2026)\n')
{
    // Der Nutzer zieht die fallende Linie vom 30.09. (0.10999) über den 21.10. (0.08643) — das erste
    // tiefere Hoch nach dem Top bei 0.131. Links davon liegen die Schlüsse des Pumps über der
    // verlängerten Linie; die Prüfung nach links endet am Top.
    const r = JSON.parse(readFileSync(new URL('./fixtures/chart-hbar-4h-linie.json', import.meta.url), 'utf8')).kerzen.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
    const A = letzteAtr(r), M = Math.sqrt(400 / 150)
    const i1 = r.findIndex((x) => x.h === 0.10999), i2 = r.findIndex((x) => x.h === 0.08643)
    const pv = wendepunkte(r, 'hoch', Math.round(3 * M))
    const t = pruefeTrend(r, i1, 0.10999, i2, 0.08643, 'hoch', TREND.TOL_ATR * A * M, pv, { atr: A * M })
    check('Linie des Nutzers hält, mit mindestens 3 Berührungen', t.ok && t.beruehrungen >= 3, JSON.stringify(t))
    const k = kandidatenTrendlinien(r, A)
    check('… und der Code bietet sie an (Anker 30.09. nach dem Top)', k.some((x) => x.seite === 'hoch' && x.p1 === 0.10999 && x.beruehrungen >= 4), kurz(k))
    // Gebaute Reihe: Top bei i = 5 (Schluss 118), ab i = 10 Hochs auf einer fallenden Linie
    const hz = (i) => (i === 5 ? 120 : i < 10 ? 100.5 : 100.5 - 0.05 * (i - 10))
    const z = Array.from({ length: 40 }, (_, i) => ({ t: T0 + i * H, o: hz(i) - 0.5, h: hz(i), l: hz(i) - 1, c: i === 5 ? 118 : hz(i) - 0.5 }))
    const fallend = pruefeTrend(z, 10, 100.5, 30, 99.5, 'hoch', 0.3, [10, 30], { atr: 1 })
    check('fallende Linie nach dem Top: der Top-Schluss links stört nicht', fallend.ok, JSON.stringify(fallend))
    const gegen = pruefeTrend(z, 10, 100.5, 30, 101.5, 'hoch', 0.3, [10, 30], { atr: 1 })
    check('Gegenlinie (steigend an Hochs): Ausnahme gilt nicht', !gegen.ok && gegen.grund === 'links', JSON.stringify(gegen))
}

console.log('\nEchte Fälle: gute Linie bleibt, beliebige fällt weg\n')
const ERWARTET = [
    // [Fall, bleibt [seite, p1, p2, min. Berührungen] | null, fällt weg [seite, p1, p2]]
    ['btc-1h', ['tief', 79732.3, 81281.5, 4], ['hoch', 81686.4, 83157.9]],
    ['btc-1h', null, ['tief', 81586.5, 80622]],
    ['btc-4h', ['tief', 79732.3, 81146.4, 3], ['hoch', 84350, 87249.6]],
    ['btc-1d', ['tief', 74909.4, 79732.3, 2], ['hoch', 65597.2, 87385.1]],
    ['eth-1h', ['tief', 2327.32, 2376.18, 3], ['tief', 2392.14, 2327.32]],
    ['eth-5m', ['hoch', 2477.7, 2453.94, 2], ['tief', 2381.39, 2376.18]],
    ['eth-5m', ['tief', 2382.8, 2424.22, 2], null],
    ['sol-4h', null, ['hoch', 124.99, 121.98]],
    ['sol-4h', null, ['tief', 102.43, 100.35]],
    ['sol-1m', null, ['tief', 105.94, 105.26]],
    ['link-1h', ['hoch', 12.772, 12.47, 2], ['tief', 12.416, 11.74]],
    ['link-1h', ['tief', 11.513, 11.881, 3], ['hoch', 12.487, 12.772]],
    ['avax-4h', ['hoch', 11.726, 11.11, 2], ['hoch', 10.498, 11.11]],
    ['doge-15m', null, ['hoch', 0.07993, 0.08201]],
]
for (const [fall, bleibt, weg] of ERWARTET) {
    const t = kand(fall)
    const iv = FAELLE[fall].interval
    if (bleibt) {
        const x = t.find((c) => c.seite === bleibt[0] && c.p1 === bleibt[1] && c.p2 === bleibt[2])
        check(`${fall} (${iv}): ${bleibt[0] === 'tief' ? 'Unterstützung' : 'Widerstand'} ${bleibt[1]} → ${bleibt[2]} bleibt, ≥ ${bleibt[3]} Berührungen`, x && x.beruehrungen >= bleibt[3], kurz(t))
    }
    if (weg) check(`${fall} (${iv}): ${weg[1]} → ${weg[2]} an ${weg[0] === 'hoch' ? 'Hochs' : 'Tiefs'} fällt weg`, !hat(t, ...weg), kurz(t))
}

console.log('\nEchte Fälle: jede angebotene Linie erfüllt die Regeln\n')
{
    let n = 0
    const verstoss = []
    for (const name of Object.keys(FAELLE).filter((x) => !x.startsWith('_'))) {
        const r = kerzenVon(name)
        const A = letzteAtr(r)
        const iv = r[1].t - r[0].t
        for (const c of kandidatenTrendlinien(r, A)) {
            n++
            const i1 = r.findIndex((x) => x.t === c.t1), i2 = r.findIndex((x) => x.t === c.t2)
            const L = (i) => c.p1 + (c.p2 - c.p1) * (i - i1) / (i2 - i1)
            const ueber = (w, y, d) => (c.seite === 'hoch' ? w > y + d : w < y - d)
            const tol = TREND.TOL_ATR * A
            if (r.slice(i1).some((x, j) => ueber(x.c, L(i1 + j), tol * 0.25))) verstoss.push(`${name} ${c.p1}: Schluss jenseits`)
            const links = Math.max(0, i1 - Math.ceil(TREND.LINKS_ANTEIL * (i2 - i1)))
            if (r.slice(links, i1).some((x, j) => ueber(x.c, L(links + j), tol))) verstoss.push(`${name} ${c.p1}: links geschnitten`)
            if (Math.abs(c.abstandAtr) > KAND.TREND_MAX_ABSTAND_ATR) verstoss.push(`${name} ${c.p1}: ${c.abstandAtr.toFixed(1)} ATR weg`)
            if (c.gegen && c.beruehrungen < TREND.GEGEN_MIN_BER) verstoss.push(`${name} ${c.p1}: Gegenlinie mit ${c.beruehrungen}`)
            if (c.beruehrT.length !== c.beruehrungen) verstoss.push(`${name} ${c.p1}: Berührungszeiten ≠ Zahl`)
            const ende = (c.tEnde - r[r.length - 1].t) / iv
            if (!(ende >= TREND.VERL_MIN && ende <= TREND.VERL_MAX)) verstoss.push(`${name} ${c.p1}: Ende ${ende} Kerzen`)
            const iE = i1 + (c.tEnde - c.t1) / iv
            if (Math.abs(L(iE) - c.pEnde) > 1e-9 * Math.abs(c.pEnde)) verstoss.push(`${name} ${c.p1}: pEnde nicht auf der Linie`)
            if (Math.abs(c.p2 - c.p1) / (i2 - i1) > TREND.MAX_STEIL_ATR * A) verstoss.push(`${name} ${c.p1}: zu steil`)
        }
    }
    check(`alle ${n} Kandidaten aus ${Object.keys(FAELLE).length - 1} Fällen regelkonform`, n >= 10 && !verstoss.length, verstoss.join('; ') || `nur ${n}`)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
