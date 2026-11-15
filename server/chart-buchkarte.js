/**
 * Orderbuch-Heatmap im Chart (BTC/ETH): liest das Fernfeld (`live_recordings`,
 * Art `fern`, `server/fern-buch.js`) und liefert
 *   - `spalten`  je Kerze die mittlere ruhende Menge je Preiszeile (Coins)
 *   - `profil`   das aktuelle Buch je Zone, Bids/Asks getrennt, mit „steht seit"
 *
 * GET /api/chart/buchkarte?symbol=BTCUSDT&quellen=futures,spot&iv=900000&von&bis&lo&hi
 *
 * Speicher: abgeschlossene Stunden werden als Viertelstunden-Mittel gemerkt
 * (`viertelAus`, 15× kleiner) — für Kerzen ab 15 min genau das, was die Spalte
 * braucht. Unter 15 min liest die Route die Minuten-Frames, dann aber höchstens
 * 24 h. Der Browser fragt nach dem ersten Laden nur noch ab der letzten Spalte.
 */
import zlib from 'zlib'
import { promisify } from 'util'
import { getKnex } from './database.js'
import { logWarn } from './logger.js'
import { normSymbol } from '../shared/symbol.js'
import { fernFramesImSpeicher } from './live-recorder.js'
import {
    FERN_SYMBOLE, FERN_MAERKTE, dekodiereStunde, mischeFrames, summiereFrames,
    spaltenAus, profilAus, viertelAus, anzeigeStufe,
} from '../shared/fernBuch.js'

const gunzip = promisify(zlib.gunzip)
const STUNDE = 3_600_000
const MAX_SPANNE_MS = 72 * STUNDE
const MAX_SPANNE_FEIN_MS = 24 * STUNDE
const PROFIL_RUECK_MS = 24 * STUNDE

const viertelCache = new Map()   // `${symbol}|${market}|${hourStart}` → viertel[]
const VIERTEL_MAX = 400

function merke(k, v) {
    viertelCache.set(k, v)
    while (viertelCache.size > VIERTEL_MAX) viertelCache.delete(viertelCache.keys().next().value)
}

/** Eingabe prüfen (pur, im Selbsttest). */
export function pruefeBuchkarteAnfrage(q, jetzt = Date.now()) {
    const symbol = normSymbol(q.symbol)
    if (!FERN_SYMBOLE.includes(symbol)) return { nichtErfasst: true, symbol }
    const quellen = String(q.quellen || 'futures').split(',').map((s) => (s === 'perp' ? 'futures' : s))
        .filter((s, i, a) => FERN_MAERKTE.includes(s) && a.indexOf(s) === i)
    if (!quellen.length) return { fehler: 'quellen fehlt' }
    const iv = Math.max(60_000, Math.min(7 * 24 * STUNDE, Number(q.iv) || 900_000))
    const bis = Math.min(jetzt, Number(q.bis) || jetzt)
    const grenze = iv < 900_000 ? MAX_SPANNE_FEIN_MS : MAX_SPANNE_MS
    const von = Math.max(bis - grenze, Number(q.von) || bis - grenze)
    const lo = Number(q.lo), hi = Number(q.hi)
    return {
        symbol, quellen, iv, von, bis,
        lo: Number.isFinite(lo) && lo > 0 ? lo : 0,
        hi: Number.isFinite(hi) && hi > lo ? hi : Infinity,
        mitProfil: q.profil !== '0',
    }
}

async function zeilen(symbol, market, von, bis, spalten) {
    return getKnex()('live_recordings').select(spalten)
        .where({ symbol, market, kind: 'fern' })
        .andWhere('hourStart', '>=', Math.floor(von / STUNDE) * STUNDE)
        .andWhere('hourStart', '<=', bis)
        .orderBy('hourStart')
}

const dekodiere = async (payload) => dekodiereStunde((await gunzip(payload)).toString('utf8'))

/**
 * Frames eines Markts im Fenster: laufende Stunde als Minuten (Speicher, sonst DB),
 * ältere als Viertel (gemerkt) — oder, mit `fein`, alles in Minuten.
 */
async function framesVon(symbol, market, von, bis, fein) {
    const jetztStunde = Math.floor(Date.now() / STUNDE) * STUNDE
    const kopf = await zeilen(symbol, market, von, bis, ['hourStart'])
    const out = []
    const offen = []
    for (const z of kopf) {
        const h = Number(z.hourStart)
        const k = `${symbol}|${market}|${h}`
        if (!fein && h < jetztStunde && viertelCache.has(k)) out.push(...viertelCache.get(k))
        else offen.push(h)
    }
    for (let i = 0; i < offen.length; i += 24) {
        const teil = offen.slice(i, i + 24)
        const rows = await getKnex()('live_recordings').select('hourStart', 'payload')
            .where({ symbol, market, kind: 'fern' }).whereIn('hourStart', teil)
        for (const r of rows) {
            const h = Number(r.hourStart)
            let frames = await dekodiere(r.payload)
            if (h === jetztStunde) {
                frames = mischeFrames(frames, fernFramesImSpeicher(symbol, market, h))
                out.push(...frames)
            } else if (fein) {
                out.push(...frames)
            } else {
                const v = viertelAus(frames)
                merke(`${symbol}|${market}|${h}`, v)
                out.push(...v)
            }
        }
    }
    // Laufende Stunde noch nicht in der DB (erste Minute): nur Speicher
    if (!kopf.some((z) => Number(z.hourStart) === jetztStunde)) out.push(...fernFramesImSpeicher(symbol, market, jetztStunde))
    return out.filter((f) => f.t >= von - (fein ? 0 : 900_000) && f.t <= bis).sort((x, y) => x.t - y.t)
}

export function setupChartBuchkarteRoutes(app) {
    app.get('/api/chart/buchkarte', async (req, res) => {
        const a = pruefeBuchkarteAnfrage(req.query)
        if (a.fehler) return res.status(400).json({ error: a.fehler })
        if (a.nichtErfasst) return res.json({ verfuegbar: false, grund: 'symbol', symbole: FERN_SYMBOLE })
        try {
            const fein = a.iv < 900_000
            const jeMarkt = []
            for (const m of a.quellen) jeMarkt.push(await framesVon(a.symbol, m, a.von, a.bis, fein))
            const frames = summiereFrames(jeMarkt)
            if (!frames.length) return res.json({ verfuegbar: false, grund: 'keineAufnahme', symbole: FERN_SYMBOLE })
            const letzt = frames[frames.length - 1]
            const stufe = anzeigeStufe(Number.isFinite(a.hi) ? a.hi - a.lo : letzt.mid * 0.3, letzt.s, 300)
            const spalten = spaltenAus(frames, { ivMs: a.iv, stufe, lo: a.lo, hi: a.hi })
            let profil = null
            if (a.mitProfil) {
                // „Steht seit" braucht Vorlauf: mit grober Auflösung zurück bis 24 h, auch wenn der Chart weniger zeigt
                const ruck = []
                for (const m of a.quellen) ruck.push(await framesVon(a.symbol, m, Date.now() - PROFIL_RUECK_MS, Date.now(), false))
                profil = profilAus(summiereFrames(ruck))
            }
            res.set('Cache-Control', 'no-store')
            res.json({
                verfuegbar: true, symbol: a.symbol, quellen: a.quellen, iv: a.iv, stufe,
                erfasstVon: frames[0].t, seit: letzt.seit, lo: letzt.lo, hi: letzt.hi, mid: letzt.mid,
                spalten, profil,
            })
        } catch (e) {
            logWarn('chart-buchkarte', `${a.symbol}: ${e.message}`)
            res.status(500).json({ error: 'Orderbuch-Aufnahme konnte nicht gelesen werden' })
        }
    })
}
