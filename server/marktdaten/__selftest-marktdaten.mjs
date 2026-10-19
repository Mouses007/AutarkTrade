/**
 * Selbsttest der Marktdaten-Schicht (S12, Verkaufs-Prüfung Massnahme 1).
 *
 *   node server/marktdaten/__selftest-marktdaten.mjs
 *
 * Ohne Netz und ohne Datenbank: die Wahl kommt über `_setzeLeser`, die
 * HTTP-Abrufe über eine Attrappe für `axios.get` (dasselbe Objekt, das die
 * Anbieter importieren). Geprüft wird, was eine falsche Annahme still
 * verdirbt:
 *   - Wahl und Fähigkeiten: eine abgewählte Börse darf keinen Abruf mehr
 *     bekommen, auch nicht über die Binance-only-Wege
 *   - Kerzenform beider Anbieter (Bitget liefert absteigend und ohne
 *     closeTime, `change24h` als Bruchteil, tickSize aus Stellen UND Schritt)
 *   - das Rückwärtsblättern von Bitget über `candles` → `history-candles`,
 *     das kein Fenster überschreiten und keine Kerze doppelt liefern darf
 *   - die Antwortform `{ aus: true, … }` der Routen
 *   - und dass ausserhalb von `server/marktdaten/binance.js` keine Binance-
 *     Adresse mehr im Code steht (sonst liefe eine Funktion an der Wahl vorbei)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import axios from 'axios'
import * as md from './index.js'
import * as binance from './binance.js'
import * as bitget from './bitget.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}
async function wirft(fn) {
    try { await fn(); return null } catch (e) { return e }
}

// ── HTTP-Attrappe ────────────────────────────────────────────────────────
const echtesGet = axios.get
let antworte = () => { throw new Error('kein Netz im Selbsttest') }
const aufrufe = []
axios.get = async (url, cfg = {}) => {
    aufrufe.push({ url, params: { ...(cfg.params || {}) } })
    return antworte(url, cfg.params || {})
}
const setzeWahl = (w) => md._setzeLeser(async () => w)

console.log('\nWahl normalisieren\n')
check('binance bleibt binance', md.normWahl('binance') === 'binance')
check('Grossschreibung wird geglättet', md.normWahl('BITGET') === 'bitget')
check('aus bleibt aus', md.normWahl('aus') === 'aus')
check('leer → Vorgabe binance (bestehende Installationen liefen darauf)', md.normWahl('') === 'binance' && md.normWahl(null) === 'binance')
check('Unbekanntes → Vorgabe, nicht „aus"', md.normWahl('kraken') === 'binance')
{
    md._setzeLeser(async () => { throw new Error('DB nicht bereit') })
    check('Lesefehler der Wahl fällt auf die Vorgabe', (await md.wahl()) === 'binance')
}

console.log('\nFähigkeitsmatrix\n')
{
    const alle = Object.keys(md.FAEHIGKEITEN)
    const b = md.faehigkeitenVon('binance')
    const g = md.faehigkeitenVon('bitget')
    check('Binance hat jede Fähigkeit', alle.every((f) => b.includes(f)), alle.filter((f) => !b.includes(f)).join(','))
    check('Bitget: genau der Grundbedarf',
        JSON.stringify([...g].sort()) === JSON.stringify(['funding', 'kerzen', 'orderbuch', 'spot', 'symbole', 'ticker']), g.join(','))
    for (const f of ['oiHistorie', 'takerVolumen', 'longShort', 'liquidationen', 'streams', 'listungen']) {
        check(`Bitget hat ${f} NICHT`, !g.includes(f))
    }
    check('aus hat keine Fähigkeit', md.faehigkeitenVon('aus').length === 0)
    check('jede Anbieter-Fähigkeit ist benannt',
        [...b, ...g].every((f) => md.FAEHIGKEITEN[f]))
    setzeWahl('bitget')
    check('kann(): Bitget kann Kerzen', await md.kann('kerzen'))
    check('kann(): Bitget kann keine Streams', !(await md.kann('streams')))
    const besch = await md.beschreibung()
    check('Beschreibung nennt die fehlenden Fähigkeiten', besch.fehlt.includes('oiHistorie') && besch.wahl === 'bitget')
    check('ohne Binance keine Stream-Wurzeln für den Browser', besch.streamWurzeln === null)
    setzeWahl('binance')
    const bb = await md.beschreibung()
    check('mit Binance Stream-Wurzeln für den Browser', bb.streamWurzeln?.futures?.startsWith('wss://'))
}

console.log('\nfordere / binanceRest werfen MarktdatenAus\n')
{
    setzeWahl('bitget')
    let e = await wirft(() => md.fordere('oiHistorie'))
    check('fordere(oiHistorie) bei Bitget wirft', md.istAus(e) && e.faehigkeit === 'oiHistorie' && e.quelle === 'bitget', e?.message)
    e = await wirft(() => md.binanceRest('kerzen'))
    check('binanceRest(kerzen) bei Bitget wirft — Bitget kann Kerzen, ist aber nicht Binance', md.istAus(e) && e.quelle === 'bitget')
    e = await wirft(() => md.binanceWs('futures'))
    check('binanceWs bei Bitget wirft', md.istAus(e) && e.faehigkeit === 'streams')
    aufrufe.length = 0
    e = await wirft(() => md.binanceHole('oiHistorie', 'futures', '/futures/data/openInterestHist', {}))
    check('binanceHole bei Bitget wirft VOR jedem Abruf', md.istAus(e) && aufrufe.length === 0, `${aufrufe.length} Abrufe`)

    setzeWahl('aus')
    e = await wirft(() => md.fordere('kerzen'))
    check('fordere(kerzen) bei aus wirft', md.istAus(e) && e.quelle === 'aus')
    check('Meldung bei aus nennt die Einstellung', /ausgeschaltet/.test(e?.message || ''), e?.message)
    e = await wirft(() => md.binanceRest('oiHistorie'))
    check('binanceRest bei aus wirft', md.istAus(e))
    e = await wirft(() => md.preis('BTCUSDT'))
    check('preis() bei aus wirft MarktdatenAus statt zu rufen', md.istAus(e))

    setzeWahl('binance')
    const url = await md.binanceRest('oiHistorie')
    check('binanceRest bei Binance liefert die Futures-Wurzel', typeof url === 'string' && url.startsWith('https://'))
    check('Spot-Abruf verlangt die Fähigkeit spot', md.istAus(await wirft(async () => { setzeWahl('aus'); await md.fordere('kerzen', { markt: 'spot' }) })))
    check('istAus erkennt auch eine übertragene Form (code)', md.istAus({ code: 'marktdatenAus' }))
    check('ein gewöhnlicher Fehler ist kein „aus"', !md.istAus(new Error('HTTP 500')))
}

console.log('\nKerzennormalisierung\n')
{
    const roh = [
        [1000, '10.5', '11', '10', '10.8', '123.4', 1999, '1300', 42, '60', '600', '0'],
        [2000, 'x', '11', '10', '10.8', '1', 2999],
        [3000, '10.8', '12', '10.7', '11.9', '0', 3999],
    ]
    const k = binance.kerzenAus(roh)
    check('Binance: Zahlen statt Zeichenketten', k[0].o === 10.5 && k[0].v === 123.4 && typeof k[0].c === 'number')
    check('Binance: defekte Zeile fällt weg', k.length === 2 && k[1].t === 3000)
    check('Binance: closeTime übernommen', k[0].closeTime === 1999)

    const H = 3600000
    const bg = bitget.kerzenAus([
        ['7200000', '3', '4', '2', '3.5', '10', '35'],
        ['3600000', '2', '3', '1', '2.5', '9', '22'],
        ['0', '1', '2', '0.5', '1.5', '8', '12'],
    ], H)
    check('Bitget: aufsteigend sortiert', bg.map((x) => x.t).join(',') === '0,3600000,7200000')
    check('Bitget: Basismenge als Volumen (Spalte 5)', bg[0].v === 8)
    check('Bitget: closeTime = Beginn + Länge − 1', bg[0].closeTime === H - 1)
    check('Bitget: ohne Länge closeTime 0', bitget.kerzenAus([['0', '1', '1', '1', '1', '1']])[0].closeTime === 0)

    const z = bitget.tickerAus({ symbol: 'BTCUSDT', lastPr: '100', change24h: '0.0123', bidPr: '99.9', askPr: '100.1', bidSz: '2', askSz: '3', quoteVolume: '5000', fundingRate: '0.0001', holdingAmount: '7' })
    check('Bitget: change24h ist ein Bruchteil → ×100', Math.abs(z.aenderungPct - 1.23) < 1e-12, z.aenderungPct)
    check('Bitget: Funding bleibt Bruchteil (wie Binance)', z.funding === 0.0001)
    check('Bitget: Geld/Brief samt Menge', z.bid === 99.9 && z.askMenge === 3)
}

console.log('\nBitget-Kontraktregeln\n')
{
    antworte = (url) => {
        if (url.endsWith('/api/v2/mix/market/contracts')) {
            return { data: { code: '00000', data: [
                { symbol: 'BTCUSDT', symbolStatus: 'normal', baseCoin: 'BTC', quoteCoin: 'USDT', pricePlace: '1', priceEndStep: '1', volumePlace: '4', sizeMultiplier: '0.0001', minTradeNum: '0.0001', minTradeUSDT: '5', fundInterval: '8' },
                { symbol: 'XUSDT', symbolStatus: 'normal', baseCoin: 'X', quoteCoin: 'USDT', pricePlace: '2', priceEndStep: '5', volumePlace: '0', sizeMultiplier: '1', minTradeNum: '1', minTradeUSDT: '5', fundInterval: '4' },
                { symbol: 'TOTUSDT', symbolStatus: 'off', pricePlace: '2', priceEndStep: '1' },
            ] } }
        }
        throw new Error(`unerwartet: ${url}`)
    }
    const m = await bitget.symbole({ markt: 'futures' })
    check('tickSize aus pricePlace (BTC: 0,1)', Math.abs(m.get('BTCUSDT').tickSize - 0.1) < 1e-12, m.get('BTCUSDT').tickSize)
    check('tickSize aus pricePlace UND priceEndStep (X: 0,05)', Math.abs(m.get('XUSDT').tickSize - 0.05) < 1e-12, m.get('XUSDT').tickSize)
    check('stepSize aus sizeMultiplier', m.get('BTCUSDT').stepSize === 0.0001)
    check('Funding-Takt aus fundInterval', m.get('XUSDT').fundingIntervallH === 4)
    check('nicht handelbare Kontrakte fallen weg', !m.has('TOTUSDT'))
}

console.log('\nBitget: Rückwärtsblättern candles → history-candles\n')
{
    const H = 3600000
    const T0 = 1_700_000_000_000 - (1_700_000_000_000 % H)
    const ALLE = Array.from({ length: 1500 }, (_, i) => T0 + i * H)   // die Börse hat 1500 Stunden
    const JUNG_AB = ALLE[ALLE.length - 300]                          // `candles` reicht 300 zurück
    const zeile = (t) => [String(t), '1', '2', '0.5', '1.5', '3', '4']
    const pfade = []
    antworte = (url, p) => {
        const pfad = url.split('/').pop()
        pfade.push({ pfad, endTime: Number(p.endTime), limit: Number(p.limit) })
        const bis = p.endTime === undefined ? Infinity : Number(p.endTime)
        let pool = ALLE.filter((t) => t < bis)
        if (pfad === 'candles') pool = pool.filter((t) => t >= JUNG_AB)
        else if (pfad !== 'history-candles') throw new Error(`unerwartet: ${url}`)
        // Bitget liefert die jüngsten `limit` vor dem Ende — ABSTEIGEND (wie die Live-API bei history)
        const seite = pool.slice(-Number(p.limit)).reverse().map(zeile)
        return { data: { code: '00000', data: seite } }
    }
    const start = ALLE[100] + 1000          // mitten in einer Kerze: die erste volle danach zählt
    const ende = ALLE[1400]
    const k = await bitget.kerzen('BTCUSDT', '1h', { start, ende, limit: 100000 })
    const erwartet = ALLE.filter((t) => t >= start && t < ende)
    check('genau die Kerzen im Fenster [start, ende)', k.length === erwartet.length && k[0].t === erwartet[0] && k[k.length - 1].t === erwartet[erwartet.length - 1],
        `${k.length} statt ${erwartet.length}`)
    check('aufsteigend und ohne Doppelte', k.every((x, i) => i === 0 || x.t > k[i - 1].t))
    check('erst candles, dann history-candles', pfade[0].pfad === 'candles' && pfade.some((x) => x.pfad === 'history-candles'))
    check('history-candles höchstens 200 je Seite', pfade.filter((x) => x.pfad === 'history-candles').every((x) => x.limit <= 200))
    check('kein Abruf jenseits des Fensterendes', pfade.every((x) => x.endTime <= ende))
    check('Blättern hört am Fensteranfang auf', pfade.length < 20, `${pfade.length} Abrufe`)
    check('closeTime aus der Zeiteinheit, ohne dass der Aufrufer sie nennt', k[0].closeTime === k[0].t + H - 1)

    pfade.length = 0
    const kurz = await bitget.kerzen('BTCUSDT', '1h', { start: ALLE[0] - 50 * H, ende: ALLE[60], limit: 100000 })
    check('reicht die Historie nicht so weit, endet es ohne Fehler', kurz.length === 60 && kurz[0].t === ALLE[0])

    const e = await wirft(() => bitget.kerzen('BTCUSDT', '8h', {}))
    check('8h gibt es bei Bitget nicht — Fehler statt falscher Kerzen', e && /8h/.test(e.message))

    // Über die Schicht: index.kerzen geht an Bitget, wenn Bitget gewählt ist
    setzeWahl('bitget')
    pfade.length = 0
    const ueber = await md.kerzen('btcusdt', '1h', { limit: 5 })
    check('index.kerzen: bei Wahl Bitget über Bitget, Symbol gross', ueber.length === 5 && pfade[0]?.pfad === 'candles')
    check('Kerzen-Seitengrösse je Anbieter', (await md.kerzenMax('futures')) === 1000)
}

console.log('\nmarket-data.js über die Schicht\n')
{
    const { getClosedCandles, getHistoricalCandles } = await import('../market-data.js')
    setzeWahl('aus')
    const e = await wirft(() => getClosedCandles('BTCUSDT', '1h', 10))
    check('getClosedCandles bei aus: MarktdatenAus', md.istAus(e), e?.message)
    setzeWahl('bitget')
    const H = 3600000
    const jetzt = Date.now()
    const offen = Math.floor(jetzt / H) * H
    antworte = (url, p) => {
        const bis = Number(p.endTime) || offen + H
        const ts = Array.from({ length: Number(p.limit) }, (_, i) => offen - (Number(p.limit) - 1 - i) * H).filter((t) => t < bis + H && t <= offen)
        return { data: { code: '00000', data: ts.map((t) => [String(t), '1', '2', '0.5', '1.5', '3', '4']) } }
    }
    const k = await getClosedCandles('BTCUSDT', '1h', 10, { force: true })
    check('getClosedCandles bei Bitget: 10 geschlossene, laufende verworfen', k.length === 10 && k[k.length - 1].t < offen)
    const h = await getHistoricalCandles('BTCUSDT', '1h', offen - 20 * H, offen)
    check('getHistoricalCandles bei Bitget: Fenster ohne laufende Kerze', h.length === 20 && h[h.length - 1].t === offen - H, `${h.length}`)
}

console.log('\nAntwortform für Routen\n')
{
    setzeWahl('bitget')
    const e = await wirft(() => md.fordere('streams'))
    const a = md.ausAntwort(e)
    check('ausAntwort: aus, grund, faehigkeit, quelle, quelleName, meldung',
        a.aus === true && a.grund === 'marktdaten' && a.faehigkeit === 'streams' && a.quelle === 'bitget' && a.quelleName === 'Bitget' && a.meldung.length > 0,
        JSON.stringify(a))
    let gesendet = null
    const res = { json: (x) => { gesendet = x; return res } }
    check('sendeWennAus antwortet und meldet true', md.sendeWennAus(res, e) === true && gesendet?.aus === true)
    gesendet = null
    check('sendeWennAus lässt echte Fehler durch', md.sendeWennAus(res, new Error('HTTP 502')) === false && gesendet === null)
    const { ausAntwort: quellenAntwort } = await import('../quellen/aus.js')
    check('quellen/aus.js reicht dieselbe Form durch', quellenAntwort(e).grund === 'marktdaten')
}

axios.get = echtesGet

console.log('\nKeine Binance-Adresse ausserhalb von server/marktdaten/binance.js\n')
{
    const wurzel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
    const MUSTER = /fapi\.binance|api\.binance\.com|fstream\.binance|stream\.binance/
    const ERLAUBT = new Set(['server/marktdaten/binance.js'])
    /*
     * Platz für Dateien, die eine Umstellung noch vor sich haben (Prüfung
     * bleibt für alles andere scharf). Seit 19.10.2026 leer: alle Bereiche
     * sind umgestellt. Steht hier eine Datei ohne Adresse, sagt die Prüfung es.
     */
    const NOCH_OFFEN = new Set([])
    const treffer = []
    const erledigt = []
    const durchsuche = (rel) => {
        const voll = path.join(wurzel, rel)
        for (const e of fs.readdirSync(voll, { withFileTypes: true })) {
            const r = `${rel}/${e.name}`
            if (e.isDirectory()) {
                if (e.name === 'node_modules' || e.name === 'fixtures') continue
                durchsuche(r)
                continue
            }
            if (!/\.(m?js|vue)$/.test(e.name) || e.name.startsWith('__selftest')) continue
            if (ERLAUBT.has(r)) continue
            const hat = MUSTER.test(fs.readFileSync(path.join(wurzel, r), 'utf8'))
            if (NOCH_OFFEN.has(r)) { if (!hat) erledigt.push(r); continue }
            if (hat) treffer.push(r)
        }
    }
    for (const ort of ['server', 'shared', 'src']) durchsuche(ort)
    check('keine Binance-URL im Server-, shared- und src-Code', treffer.length === 0, treffer.join(', '))
    if (erledigt.length) console.log(`  \x1b[90m(umgestellt, aus NOCH_OFFEN streichen: ${erledigt.join(', ')})\x1b[0m`)
    for (const r of NOCH_OFFEN) if (!erledigt.includes(r)) console.log(`  \x1b[90m(noch offen, anderer Bereich: ${r})\x1b[0m`)
}

console.log(`\n${fehlgeschlagen === 0 ? '\x1b[32m' : '\x1b[31m'}${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen\x1b[0m`)
if (fehlgeschlagen) { console.log('Fehlgeschlagen:'); for (const f of fehler) console.log(`  · ${f}`) }
process.exit(fehlgeschlagen ? 1 : 0)
