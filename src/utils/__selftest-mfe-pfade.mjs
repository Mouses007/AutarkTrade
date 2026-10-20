/**
 * Golden-Master-Test der MFE-/OHLCV-Pfade und der Import-Vorschau.
 *
 *   node src/utils/__selftest-mfe-pfade.mjs                 # vergleichen
 *   JOURNAL_GOLDEN_SCHREIBEN=1 node src/utils/__selftest-mfe-pfade.mjs   # Stand einfrieren
 *
 * Der zweite Golden Master neben `__selftest-journal.mjs`. Jener deckt den
 * Journal-Kern ab, ausdrücklich NICHT aber, was in `utils/journal/import.js` und
 * `tagesrechnung.js` steht (bis S7 `journal-alt.js`, bis S3 `addTrades.js`):
 *
 *   - `kerzenAusCsv`   Databento-CSV → Kerzen (Tagesansicht)
 *   - `holeImportKerzen`      Kerzen für alle Symbole holen, Polygon und Databento
 *                        (Exkursionen nachtragen)
 *   - `berechneMfePreise`  MFE-Preis je Trade aus 1-Minuten-Kerzen
 *   - `speichereMfePreise` MFE-Preise als Exkursionszeilen speichern
 *   - `baueBlotter`/`bauePnL`/`ladeVorhandeneTradeTage`/
 *     `speichereImport` — die Vorschau und das Speichern des API-Imports in
 *     `AddTrades.vue`
 *
 * Wie der erste friert er ein, was der Code HEUTE tut, nicht was richtig ist.
 * Mit eingefroren (19.10.2026):
 *   - `mfeListe` ist ein Modulspeicher, der nie geleert wird: jeder Aufruf
 *     von `berechneMfePreise` hängt an und liefert die ganze Liste zurück, und
 *     `speichereMfePreise` schreibt die ganze Liste. Im Browser heisst das:
 *     wer in derselben Sitzung zweimal Exkursionen nachträgt, legt die
 *     ersten ein zweites Mal an — und `speichereImport` schreibt sie beim
 *     nächsten API-Import noch einmal. Die Vorschau läuft hier deshalb ZUERST.
 *   - `holeImportKerzen` löst nach dem ERSTEN Symbol auf, die übrigen laufen
 *     danach weiter. Der Test wartet, bis alle da sind, und hält die Zahl
 *     beim Auflösen getrennt fest.
 *   - Ein Trade, dessen Symbol gar nicht in den Kerzen steht, wirft in
 *     `berechneMfePreise` (`ohlcv[-1].ohlcv`) und das Promise bleibt für immer
 *     offen. Dieser Fall ist deshalb NICHT im Datensatz; geprüft wird der
 *     Fall „Symbol da, Kerzen fehlen".
 *
 * Datensatz synthetisch und deterministisch: Zufallspfad aus 1-Minuten-Kerzen
 * über volle UTC-Tage vor und nach den Sommerzeitwechseln von USA und EU,
 * dazu Trades mit Ein-/Ausstieg genau auf und neben Kerzengrenzen, in
 * derselben Minute, ausserhalb der Historie, Long/Short, Gewinn/Verlust.
 * Ausgewertet in zwei Handelszeitzonen, weil der Marktschluss (16:00) in der
 * Zeitzone des Handels gerechnet wird.
 *
 * Attrappen wie im ersten Golden Master: `__journal-attrappen.mjs`.
 */

process.env.TZ = 'Europe/Zurich'

import { register } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

register('./__journal-attrappen.mjs', import.meta.url)

const GOLDEN = fileURLToPath(new URL('./fixtures/mfe-pfade-golden.json', import.meta.url))
const SCHREIBEN = process.env.JOURNAL_GOLDEN_SCHREIBEN === '1'

// ---------------------------------------------------------------------------
// Browser-Umgebung, soweit die Pfade sie anfassen
// ---------------------------------------------------------------------------

const ablage = new Map()
globalThis.localStorage = {
    getItem: (k) => (ablage.has(k) ? ablage.get(k) : null),
    setItem: (k, v) => { ablage.set(k, String(v)) },
    removeItem: (k) => { ablage.delete(k) },
}
globalThis.window = { addEventListener() {}, removeEventListener() {}, location: { href: '/import' } }
globalThis.document = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    documentElement: { setAttribute() {} },
    createElement: () => ({ setAttribute() {}, content: {}, style: {} }),
}
globalThis.alert = (text) => { meldungen.push(String(text)) }
const meldungen = []

// ---------------------------------------------------------------------------
// Deterministischer Datensatz
// ---------------------------------------------------------------------------

function zufall(keim) {
    let a = keim >>> 0
    return () => {
        a = (a + 0x6D2B79F5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}
const r = zufall(20261020)
const runde = (x, n) => Math.round(x * 10 ** n) / 10 ** n
const ms = (iso) => Date.parse(iso)
const MINUTE = 60_000

// Volle UTC-Tage: vor dem US-Wechsel (08.03.), zwischen US- und EU-Wechsel
// (29.03.) und danach. Lücke zwischen den Tagen ist Absicht — ein Fenster,
// das über einen fehlenden Tag läuft, muss die nächste VORHANDENE Kerze nehmen.
const TAGE = ['2026-03-06', '2026-03-10', '2026-03-31']
const SYMBOLE = [['BTCUSDT', 60000, 1], ['SOLUSDT', 150, 3]]

function kerzenFuer(basis, stellen) {
    const kerzen = []
    let preis = basis
    for (const tag of TAGE) {
        const start = ms(`${tag}T00:00:00Z`)
        for (let i = 0; i < 1440; i++) {
            const o = runde(preis, stellen)
            const c = runde(o * (1 + (r() - 0.5) * 0.004), stellen)
            const h = runde(Math.max(o, c) * (1 + r() * 0.0015), stellen)
            const l = runde(Math.min(o, c) * (1 - r() * 0.0015), stellen)
            kerzen.push({ t: start + i * MINUTE, o, h, l, c, v: runde(r() * 50, 3) })
            preis = c
        }
    }
    return kerzen
}
const KERZEN = Object.fromEntries(SYMBOLE.map(([s, b, st]) => [s, kerzenFuer(b, st)]))

function tradesFuer(symbol, stellen) {
    const kerzen = KERZEN[symbol]
    const liste = []
    let n = 0
    for (const [ti] of TAGE.entries()) {
        for (let k = 0; k < 10; k++) {
            const lang = r() < 0.5
            // 06:00–20:00 UTC, damit Marktschluss in beiden Zonen dahinter liegen kann
            const einIdx = ti * 1440 + 360 + Math.floor(r() * 840)
            const art = k % 5
            const einSek = Math.floor(kerzen[einIdx].t / 1000) + (art === 0 || art === 3 ? 0 : 1 + Math.floor(r() * 58))
            let ausSek
            if (art === 1) ausSek = einSek + Math.floor(r() * 3)                       // dieselbe Minute
            else if (art === 2) ausSek = Math.floor(kerzen[einIdx + 30].t / 1000)       // Ausstieg auf Grenze
            else ausSek = einSek + 120 + Math.floor(r() * 4 * 3600)
            const ausIdx = Math.min(kerzen.length - 1, Math.floor((ausSek * 1000 - kerzen[0].t) / MINUTE))
            const einPreis = runde(kerzen[einIdx].o * (1 + (r() - 0.5) * 0.001), stellen)
            // Gewinn, Verlust und genau Einstand gemischt
            const ausPreis = k % 7 === 6 ? einPreis : runde(kerzen[Math.max(einIdx, Math.min(ausIdx, (ti + 1) * 1440 - 1))].c, stellen)
            n++
            const td = Math.floor(ms(`${TAGE[ti]}T00:00:00Z`) / 1000)
            liste.push({
                id: `t${td}_${n}_${symbol}`, td, symbol, strategy: lang ? 'long' : 'short',
                entryTime: einSek, exitTime: ausSek, entryPrice: einPreis, exitPrice: ausPreis, openPosition: false,
            })
        }
    }
    // Ausserhalb der Historie: Einstieg nach der letzten Kerze, Ausstieg nach der letzten Kerze
    const letzte = Math.floor(kerzen[kerzen.length - 1].t / 1000)
    const td = Math.floor(ms(`${TAGE[2]}T00:00:00Z`) / 1000)
    liste.push({ id: `t${td}_spaet_${symbol}`, td, symbol, strategy: 'long', entryTime: letzte + 600, exitTime: letzte + 1200, entryPrice: 1, exitPrice: 2, openPosition: false })
    liste.push({ id: `t${td}_ueber_${symbol}`, td, symbol, strategy: 'short', entryTime: letzte - 600, exitTime: letzte + 600, entryPrice: kerzen.at(-11).o, exitPrice: kerzen.at(-1).c, openPosition: false })
    // Über die Tageslücke: Einstieg am Abend, Ausstieg nach der Lücke
    const abend = Math.floor(kerzen[1440 - 30].t / 1000) + 7
    liste.push({ id: `t${Math.floor(ms(`${TAGE[0]}T00:00:00Z`) / 1000)}_luecke_${symbol}`, td: Math.floor(ms(`${TAGE[0]}T00:00:00Z`) / 1000), symbol, strategy: 'long',
        entryTime: abend, exitTime: Math.floor(ms(`2026-03-08T12:00:00Z`) / 1000), entryPrice: kerzen[1440 - 30].o, exitPrice: kerzen[1440 + 5].c, openPosition: false })
    return liste
}
const TRADES = SYMBOLE.flatMap(([s, , st]) => tradesFuer(s, st))
// Symbol, das der Kerzenanbieter kennt, aber ohne Kerzen beantwortet
const OHNE_KERZEN = { id: 't_ohne_XYZUSDT', td: TRADES[0].td, symbol: 'XYZUSDT', strategy: 'long', entryTime: TRADES[0].entryTime, exitTime: TRADES[0].exitTime, entryPrice: 1, exitPrice: 1.1, openPosition: false }

function databentoCsv(kerzen, von = 0, bis = kerzen.length) {
    const zeilen = ['ts_event,rtype,publisher_id,instrument_id,open,high,low,close,volume,symbol']
    for (const k of kerzen.slice(von, bis)) zeilen.push(`${new Date(k.t).toISOString()},33,1,42,${k.o},${k.h},${k.l},${k.c},${k.v},X`)
    return zeilen.join('\n') + '\n'
}

function bitunixPosition(n) {
    const [symbol, basis, stellen] = SYMBOLE[n % 2]
    const ein = runde(basis * (0.95 + r() * 0.1), stellen)
    const aus = runde(ein * (1 + (r() - 0.5) * 0.03), stellen)
    const lang = r() < 0.5
    const menge = runde(1000 / ein * (0.5 + r() * 2), 3)
    const gebuehr = runde(menge * (ein + aus) * 0.0006, 6)
    const funding = n % 3 === 0 ? runde((r() - 0.5) * 2, 6) : 0
    const auf = ms(`${TAGE[n % 3]}T00:00:00Z`) + Math.floor(r() * 20 * 3600_000)
    return {
        positionId: String(7700000000000000000n + BigInt(n) * 104729n), symbol,
        side: lang ? 'LONG' : 'SHORT', entryPrice: String(ein), closePrice: String(aus), maxQty: String(menge),
        fee: String(-gebuehr), funding: String(funding),
        realizedPNL: String(runde((lang ? aus - ein : ein - aus) * menge - gebuehr + funding, 8)),
        ctime: String(auf), mtime: String(auf + Math.floor(60_000 + r() * 3 * 3600_000)),
    }
}

// ---------------------------------------------------------------------------
// Vergleich (wie im ersten Golden Master)
// ---------------------------------------------------------------------------

const sauber = (x) => JSON.parse(JSON.stringify(x, (_k, v) => (typeof v === 'function' ? undefined : v)))

function gleichZahl(a, b) {
    if (a === b) return true
    if (Number.isNaN(a) && Number.isNaN(b)) return true
    if (Number.isInteger(a) && Number.isInteger(b)) return false
    return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))
}

function vergleiche(ist, soll, pfad, fehler) {
    if (fehler.length >= 25) return
    if (typeof soll === 'number' && typeof ist === 'number') {
        if (!gleichZahl(ist, soll)) fehler.push(`${pfad}: ${ist} statt ${soll}`)
        return
    }
    if (soll === null || typeof soll !== 'object' || ist === null || typeof ist !== 'object') {
        if (ist !== soll) fehler.push(`${pfad}: ${JSON.stringify(ist)?.slice(0, 80)} statt ${JSON.stringify(soll)?.slice(0, 80)}`)
        return
    }
    if (Array.isArray(soll) !== Array.isArray(ist)) { fehler.push(`${pfad}: Art geändert (Liste ↔ Objekt)`); return }
    const schluessel = new Set([...Object.keys(soll), ...Object.keys(ist)])
    for (const k of schluessel) {
        if (!(k in ist)) { fehler.push(`${pfad}.${k}: fehlt`); continue }
        if (!(k in soll)) { fehler.push(`${pfad}.${k}: neu hinzugekommen`); continue }
        vergleiche(ist[k], soll[k], `${pfad}.${k}`, fehler)
    }
}

/** Kerzenreihen nicht ausschreiben — sie sind Eingabe. Länge, Ränder, Summen genügen. */
function kerzenAuszug(liste) {
    if (!Array.isArray(liste)) return liste === undefined ? '—undefined—' : liste
    const summe = (f) => liste.reduce((s, k) => s + Number(k[f]), 0)
    return { n: liste.length, erste: liste[0] ?? null, letzte: liste.at(-1) ?? null, o: summe('o'), h: summe('h'), l: summe('l'), c: summe('c'), v: summe('v') }
}
const ohlcvAuszug = (ohlcv) => ohlcv.map(e => ({ symbol: e.symbol, ohlcv: kerzenAuszug(e.ohlcv) }))
const warte = () => new Promise(res => setTimeout(res, 20))
const kopie = (x) => JSON.parse(JSON.stringify(x))

// ---------------------------------------------------------------------------
// Lauf
// ---------------------------------------------------------------------------

const stilleLog = console.log
const fehlerMeldungen = []
console.log = () => {}
console.warn = () => {}
console.error = (...a) => { fehlerMeldungen.push(a.map(x => (x instanceof Error ? x.stack : String(x))).join(' ')) }

const ui = await import('../stores/ui.js')
const filter = await import('../stores/filters.js')
const st = await import('../stores/trades.js')
const { appEinstellungen } = await import('../stores/settings.js')
const quick = await import('./quickImport.js')
const alt = {
    ...(await import('./journal/import.js')),
    ...(await import('./journal/tagesrechnung.js')),
}

globalThis.__journalDaten = {
    trades: [], excursions: [],
    settings: [{ objectId: '1', accounts: [{ value: 'bitunix', label: 'bitunix' }] }],
}
appEinstellungen.value = {
    accounts: [{ value: 'bitunix', label: 'bitunix' }],
    apis: [{ provider: 'polygon', key: 'poly-test' }, { provider: 'databento', key: 'db-test' }],
}
ui.tradeZeitzone.value = 'America/New_York'
filter.gewaehlteBoerse.value = 'bitunix'

const ergebnis = {}

// --- 1. Import-Vorschau und Speichern (AddTrades.vue, importFromApi) --------
{
    // Ein bereits importierter Tag, damit die Vorschau ihn aussortiert
    const vorhandenTd = Math.floor(ms(`${TAGE[1]}T00:00:00Z`) / 1000)
    globalThis.__journalDaten.trades.push({ objectId: '1', date: TAGE[1], dateUnix: vorhandenTd, broker: 'bitunix', trades: [], executions: [], blotter: {}, pAndL: {}, openPositions: false })
    await alt.ladeVorhandeneTradeTage()
    const vorhanden = [...st.vorhandeneTradeTage]

    const positionen = Array.from({ length: 14 }, (_, i) => bitunixPosition(i))
    for (const k in st.executions) delete st.executions[k]
    const tage = {}
    st.vorhandeneImporte.length = 0
    positionen.forEach((pos, i) => {
        const t = quick.createBitunixTradeObj(pos, i)
        ;(tage[t.td] ||= []).push(t)
        ;(st.executions[t.td] ||= []).push({ ...t, trade: t.id })
    })
    const vorhandenSet = new Set(st.vorhandeneTradeTage)
    for (const key of Object.keys(tage)) {
        const datum = new Date(Number(key) * 1000).toISOString().slice(0, 10)
        if (vorhandenSet.has(datum)) { st.vorhandeneImporte.push(Number(key)); delete tage[key]; delete st.executions[key] }
    }
    for (const k in st.trades) delete st.trades[k]
    Object.assign(st.trades, tage)

    await alt.baueBlotter()
    await alt.bauePnL()
    const vorschau = sauber({ blotter: st.blotter, pAndL: st.pAndL, vorhandeneImporte: st.vorhandeneImporte })

    await alt.speichereImport()
    await warte()
    ergebnis.vorschau = {
        vorhanden,
        ...vorschau,
        gespeichert: sauber(globalThis.__journalDaten.trades.filter(z => z.objectId !== '1').map(({ objectId, ...z }) => z)),
        weiter: window.location.href,
        exkursionen: globalThis.__journalDaten.excursions.length,
    }
    // Blotter mit Parameter: aus `gefilterteTradesFlach` (so ruft trades.js)
    st.gefilterteTradesFlach.length = 0
    st.gefilterteTradesFlach.push(...Object.values(tage).flat().slice(0, 6))
    await alt.baueBlotter(true)
    await alt.bauePnL()
    ergebnis.vorschauGefiltert = sauber({ blotter: st.blotter, pAndL: st.pAndL })
}

// --- 2. Databento-CSV → Kerzen (Tagesansicht) --------------------------------
{
    const temp = { symbol: 'BTCUSDT', ohlcv: [] }
    const csv = databentoCsv(KERZEN.BTCUSDT, 600, 640)
    const res = await alt.kerzenAusCsv(csv, temp)
    ergebnis.databentoCsv = { gleichesObjekt: res === temp, symbol: res.symbol, ohlcv: sauber(res.ohlcv) }
    // ohne Leerzeile am Ende: die letzte Zeile trägt Daten
    const res2 = await alt.kerzenAusCsv(csv.trimEnd(), { symbol: 'SOLUSDT', ohlcv: [] })
    ergebnis.databentoCsvOhneLeerzeile = kerzenAuszug(res2.ohlcv)
}

// --- 3. Kerzen holen (AddExcursions.vue) -----------------------------------
const symbole = [...SYMBOLE.map(([s]) => ({ symbol: s, secType: 'crypto' })), { symbol: 'XYZUSDT', secType: 'crypto' }]
const vonSek = Math.floor(ms(`${TAGE[0]}T00:00:00Z`) / 1000)
const bisSek = Math.floor(ms(`${TAGE[2]}T18:00:00Z`) / 1000)

const anfragen = []
globalThis.__journalNetz = {
    '/api/polygon/aggs': (konfig) => {
        anfragen.push(sauber({ url: '/api/polygon/aggs', ...konfig }))
        const kerzen = KERZEN[konfig.params.ticker]
        return kerzen ? { results: kopie(kerzen) } : { resultsCount: 0 }
    },
    '/api/databento': (rumpf) => {
        anfragen.push(sauber({ url: '/api/databento', rumpf }))
        const kerzen = KERZEN[rumpf.symbols] || KERZEN.BTCUSDT
        return databentoCsv(kerzen, 0, 1440)
    },
}
{
    const polygon = await alt.holeImportKerzen('polygon', 'manual', symbole, vonSek, bisSek)
    const beimAufloesen = polygon.length
    await warte()
    ergebnis.ohlcvPolygon = { beimAufloesen, ohlcv: ohlcvAuszug(polygon) }

    const databento = await alt.holeImportKerzen('databento', 'manual', symbole.slice(0, 2).map(s => ({ ...s, secType: 'stock' })), vonSek, bisSek)
    const beimAufloesenDb = databento.length
    await warte()
    ergebnis.ohlcvDatabento = { beimAufloesen: beimAufloesenDb, ohlcv: ohlcvAuszug(databento) }
    ergebnis.anfragen = anfragen
}

// --- 4. MFE je Trade, zwei Handelszeitzonen --------------------------------
{
    const kerzenSatz = [...SYMBOLE.map(([s]) => ({ symbol: s, ohlcv: KERZEN[s] })), { symbol: 'XYZUSDT', ohlcv: undefined }]
    ergebnis.mfe = {}
    let vorher = 0
    for (const zone of ['America/New_York', 'Europe/Zurich']) {
        ui.tradeZeitzone.value = zone
        const trades = kopie([...TRADES, OHNE_KERZEN])
        let mfe
        for (const t of trades) mfe = await alt.berechneMfePreise(t, t.entryTime, t.entryPrice, t, kerzenSatz)
        ergebnis.mfe[zone] = {
            anzahlImSpeicher: mfe.length,
            preise: sauber(mfe.slice(vorher)),
            exkursionen: Object.fromEntries(trades.map(t => [t.id, t.excursions ?? null])),
        }
        vorher = mfe.length
    }
    // Einen Marktschluss, der früher liegt, sieht man nur am Ausdehnen nach dem Ausstieg
    st.marktSchluss.value = '11:00:00'
    ui.tradeZeitzone.value = 'Europe/Zurich'
    const trades = kopie(TRADES.slice(0, 12))
    let mfe
    for (const t of trades) mfe = await alt.berechneMfePreise(t, t.entryTime, t.entryPrice, t, kerzenSatz)
    ergebnis.mfe.schluss11 = sauber(mfe.slice(vorher))
    st.marktSchluss.value = '16:00:00'
}

// --- 5. MFE-Preise speichern --------------------------------------------------
{
    globalThis.__journalDaten.excursions.length = 0
    st.exkursionTradeId.value = 'exk-42'
    await alt.speichereMfePreise()
    ergebnis.gespeicherteExkursionen = {
        anzahl: globalThis.__journalDaten.excursions.length,
        erste: globalThis.__journalDaten.excursions.slice(0, 5),
        letzte: globalThis.__journalDaten.excursions.slice(-5),
        summeMfe: globalThis.__journalDaten.excursions.reduce((s, z) => s + Number(z.mfePrice), 0),
        tradeId: st.tradeId.value,
    }
}
ergebnis.meldungen = meldungen

console.log = stilleLog

// ---------------------------------------------------------------------------
// Auswertung
// ---------------------------------------------------------------------------

let ok = 0, schlecht = 0
const pruefe = (name, bedingung, detail = '') => {
    if (bedingung) { ok++; console.log(`  ✓ ${name}`) } else { schlecht++; console.log(`  ✗ ${name}${detail ? '\n      ' + detail : ''}`) }
}

console.log('MFE-/OHLCV-Pfade (Golden Master)')

pruefe('keine Fehlermeldung während des Laufs', fehlerMeldungen.length === 0, fehlerMeldungen.slice(0, 3).join('\n      '))
pruefe('Vorschau hat Tage gespeichert', ergebnis.vorschau.gespeichert.length >= 2, `${ergebnis.vorschau.gespeichert.length} Tage`)
pruefe('Vorschau sortiert den vorhandenen Tag aus', ergebnis.vorschau.vorhandeneImporte.length === 1)
pruefe('Databento-CSV ergibt 40 Kerzen', ergebnis.databentoCsv.ohlcv.length === 40)
pruefe('Polygon: alle drei Symbole nach dem Warten', ergebnis.ohlcvPolygon.ohlcv.length === 3)
{
    const einstieg = new Map(TRADES.map(t => [t.id, t.entryPrice]))
    const preise = ergebnis.mfe['America/New_York'].preise
    const bewegt = preise.filter(p => p.mfePrice !== einstieg.get(p.tradeId)).length
    pruefe('MFE weicht bei vielen Trades vom Einstieg ab', bewegt > 10, `${bewegt} von ${preise.length}`)
    const ny = new Map(preise.map(p => [p.tradeId, p.mfePrice]))
    const anders = ergebnis.mfe['Europe/Zurich'].preise.filter(p => ny.get(p.tradeId) !== p.mfePrice).length
    pruefe('Handelszeitzone verschiebt den Marktschluss (Zürich ≠ New York)', anders > 0, `${anders} Trades verschieden`)
}
pruefe('MFE-Preise gespeichert', ergebnis.gespeicherteExkursionen.anzahl > 40, `${ergebnis.gespeicherteExkursionen.anzahl}`)

if (SCHREIBEN) {
    mkdirSync(dirname(GOLDEN), { recursive: true })
    writeFileSync(GOLDEN, JSON.stringify(ergebnis) + '\n')
    console.log(`  → Golden Master geschrieben: ${GOLDEN}`)
} else {
    let soll
    try { soll = JSON.parse(readFileSync(GOLDEN, 'utf8')) } catch {
        pruefe('Golden Master vorhanden', false, 'erst mit JOURNAL_GOLDEN_SCHREIBEN=1 erzeugen')
    }
    if (soll) {
        const teile = [
            ['Import-Vorschau und Speichern', 'vorschau'],
            ['Blotter aus gefilterten Trades', 'vorschauGefiltert'],
            ['Databento-CSV → Kerzen', 'databentoCsv'],
            ['Databento-CSV ohne Leerzeile', 'databentoCsvOhneLeerzeile'],
            ['Kerzen über Polygon', 'ohlcvPolygon'],
            ['Kerzen über Databento', 'ohlcvDatabento'],
            ['Anfragen an die Kerzenanbieter', 'anfragen'],
            ['MFE New York', 'mfe.America/New_York'],
            ['MFE Zürich', 'mfe.Europe/Zurich'],
            ['MFE mit Marktschluss 11:00', 'mfe.schluss11'],
            ['Exkursionszeilen', 'gespeicherteExkursionen'],
            ['Meldungen an den Nutzer', 'meldungen'],
        ]
        const hole = (o, pfad) => pfad.split('.').reduce((x, k) => x?.[k], o)
        for (const [name, pfad] of teile) {
            const fehler = []
            vergleiche(hole(ergebnis, pfad), hole(soll, pfad), pfad, fehler)
            pruefe(`${name} unverändert`, fehler.length === 0, fehler.join('\n      '))
        }
    }
}

console.log(`\nmfe-pfade: ${ok} bestanden, ${schlecht} fehlgeschlagen`)
process.exit(schlecht ? 1 : 0)
