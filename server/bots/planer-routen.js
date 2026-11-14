/**
 * Routen des Bot-Planers (neuer Futures-Grid-Bot von Grund auf, planer.js).
 * Hinter der Sitzung; vor setupBotRoutes einzuhängen, damit „plan" nicht als
 * Bot-ID der allgemeinen Routen gelesen wird.
 *
 *   GET  /api/bots/plan/coins     handelbare Coins (USDT-M / Coin-M) aus Pionex' Symboltabelle
 *   POST /api/bots/plan/rechnen   {coin, coinM, richtung, einsatz, hebel, tage, eigene?} → Lage + Trend + Kandidaten (kostet nichts)
 *                                 richtung „ALLE": Long, Short und Neutral zusammen (IDs L…/S…/N…, jeder
 *                                 Kandidat trägt `richtung`; eigene Varianten bringen ihre `richtung` mit)
 *   POST /api/bots/plan/ki        dieselbe Eingabe + {sprache} → KI wählt höchstens drei (kostet)
 *   GET  /api/bots/plan/ki        letzte KI-Auswahl (nur Speicher)
 *
 * Gestartet wird über die Steuerung (POST /api/bots/plan/aktion/pruefen|senden,
 * steuerung-routen.js) mit allen Planwerten in der Eingabe.
 */
import { fetchTickerPrice } from '../pionex-api.js'
import { holeSymbolTabelle } from '../execution/pionex-meta.js'
import { fehlerText } from '../boersen-status.js'
import { logWarn } from '../logger.js'
import { sendeWennAus } from '../quellen/aus.js'
import { kerzen as holeKerzen } from '../marktdaten/index.js'
import { wartungsmargeMitQuelle } from '../margin-rates.js'
import { getClosedCandles } from '../market-data.js'
import { ladeLlmConfigFuerAufgabe, callLLMJson } from '../llm.js'
import { zeitrahmenTabelle, zeitrahmenText } from '../chart-zeitrahmen.js'
import { wissenAlsText } from './pionex-wissen.js'
import { atrTag } from './kennzahlen.js'
import { marktLage, hoheZeitrahmen, pruefeKiAntwort, BOT_ZEITRAHMEN } from './bot-ki.js'
import { ladeSimKerzen } from './routen.js'
import { getKnex } from '../database.js'
import { baueKandidaten } from '../chart-kandidaten.js'
import {
    pruefePlanEingabe, pruefePlanVariante, planKandidaten, planKandidatenAlle, rechnePlan, bauePlanPrompt, planSystemText,
    langfristTrend, chartNiveaus, wochenProfile, MAX_EIGENE, RICHTUNGEN, ALLE, SINNVOLLE_GRIDS, WENIG_GRIDS,
} from './planer.js'

const COINS_MS = 30 * 60_000
let coinsCache = null
const RECHNEN_MS = 5 * 60_000
const rechnenCache = new Map()   // Schlüssel → { zeit, daten }
const laeuft = new Map()         // Schlüssel → Promise
let kiLetzte = null
let kiZuletzt = { zeit: 0, fehler: false }
let kiLaeuft = null              // { schluessel, promise }
export const PLAN_KI_PAUSE_MS = 60_000

/** Coins aus der Perp-Tabelle: `SOL_USDT_PERP` = USDT-M, `USDT_SOL_PERP` = Coin-M. Rein. */
export function coinsAusTabelle(liste) {
    const coins = new Map()
    for (const e of liste || []) {
        if (String(e?.status || '').toUpperCase() !== 'TRADING') continue
        const s = String(e.symbol || '')
        let m = s.match(/^([A-Z0-9]+)_USDT_PERP$/)
        if (m) { const c = coins.get(m[1]) || { linear: false, coinM: false }; c.linear = true; c.minLinear = Number(e.minSizeLimit) || null; coins.set(m[1], c); continue }
        m = s.match(/^USDT_([A-Z0-9]+)_PERP$/)
        if (m) { const c = coins.get(m[1]) || { linear: false, coinM: false }; c.coinM = true; c.minCoinM = Number(e.minSizeLimit) || null; coins.set(m[1], c) }
    }
    return coins
}

async function holeCoins() {
    if (coinsCache && Date.now() - coinsCache.zeit < COINS_MS) return coinsCache.coins
    const coins = coinsAusTabelle(await holeSymbolTabelle())
    if (!coins.size) throw new Error('Pionex lieferte keine Perp-Symbole')
    coinsCache = { zeit: Date.now(), coins }
    return coins
}

function eingabeAus(body, coins) {
    const e = pruefePlanEingabe(body, coins, { alle: true })
    if (e.fehler) return e
    const eigene = []
    for (const v of (Array.isArray(body?.eigene) ? body.eigene : []).slice(0, MAX_EIGENE)) {
        if (!v || typeof v !== 'object') continue
        eigene.push(v)
    }
    return { ...e, eigeneRoh: eigene }
}

/** Lage messen, Kandidaten bauen und rechnen. Ohne KI, kostet nichts. */
/** Eigene Chart-Zeichnungen zum Symbol (wie die Chart-KI sie liest). Fehler → keine. */
async function ladeZeichnungen(symbol) {
    const liste = (x) => { try { const v = typeof x === 'string' ? JSON.parse(x) : x; return Array.isArray(v) ? v : null } catch { return null } }
    try {
        const roh = await getKnex()('chart_zeichnungen').where('symbol', symbol).orderBy('geaendertAm', 'desc').orderBy('id', 'desc')
        return roh.map((z) => ({ ...z, punkte: JSON.parse(z.punkte || '[]'), stil: JSON.parse(z.stil || '{}'), sichtbarAuf: liste(z.sichtbarAuf) }))
    } catch { return [] }
}

async function rechne(e, coins) {
    const symbol = `${e.coin}USDT`
    const kurs = await fetchTickerPrice(`${e.coin}_USDT_PERP`) || await fetchTickerPrice(`${e.coin}_USDT`)
    if (!(kurs > 0)) throw Object.assign(new Error('Kein Kurs bei Pionex'), { code: 'keinKurs' })
    const ende = Date.now(), start = ende - e.tage * 86_400_000
    const [tag, sim, marge, reihen] = await Promise.all([
        holeKerzen(symbol, '1d', { markt: 'futures', limit: 45 }),
        ladeSimKerzen(symbol, start, ende),
        wartungsmargeMitQuelle(symbol).catch(() => null),
        Promise.all(BOT_ZEITRAHMEN.map((tf) => getClosedCandles(symbol, tf, 300, { market: 'futures' }).catch(() => null))),
    ])
    const zeichnungen = await ladeZeichnungen(symbol)
    const atr = atrTag(tag)
    const lage = marktLage(tag, kurs)
    if (lage) lage.atr = atr
    const zr = hoheZeitrahmen(Object.fromEntries(BOT_ZEITRAHMEN.map((tf, i) => [tf, reihen[i]])), kurs)
    const trend = langfristTrend({ zr, tagKerzen: reihen[BOT_ZEITRAHMEN.indexOf('1d')] || [], kurs })
    // Chart-Niveaus auf dem Wochenchart: Volumenprofile der Seitwärtsphasen und eigene Zeichnungen
    let chart = []
    try {
        const woche = reihen[BOT_ZEITRAHMEN.indexOf('1w')]
        // Eigene Zeichnungen messen (ohne die Profilsuche der Chart-KI), Profile aus wochenProfile
        const paket = woche?.length >= 30 ? baueKandidaten({ kerzen: woche, interval: '1w', zeichnungen, profilArten: [['rechteck', 0]] }) : null
        chart = chartNiveaus({ nutzer: paket?.nutzer || [], kandidaten: wochenProfile(woche) }, kurs)
    } catch (err) { logWarn('bots', `Planer Chart-Niveaus: ${err.message}`) }
    const mmr = marge?.pct > 0 ? marge.pct / 100 : undefined
    const c = coins.get(e.coin)
    const minMenge = e.coinM ? c?.minCoinM : c?.minLinear
    const opt = { kurs, funding: sim.funding, mmr, minMenge, trend }
    const liste = e.richtung === ALLE ? planKandidatenAlle({ kurs, atr, zr, trend, chart }) : planKandidaten({ kurs, atr, zr, richtung: e.richtung, chart })
    const kandidaten = rechnePlan(e, sim.kerzen, liste, opt)
    const eigene = []
    for (const [i, roh] of e.eigeneRoh.entries()) {
        // Im Modus ALLE bringt die eigene Variante ihre Richtung mit
        const richtung = e.richtung === ALLE ? String(roh?.richtung || '').toUpperCase() : e.richtung
        if (!RICHTUNGEN.includes(richtung)) { eigene.push({ id: `E${i + 1}`, titel: 'Eigene Variante', fehler: 'richtung' }); continue }
        const v = pruefePlanVariante(roh, kurs, richtung)
        if (v.fehler) { eigene.push({ id: `E${i + 1}`, titel: 'Eigene Variante', richtung, fehler: v.fehler }); continue }
        eigene.push(...rechnePlan(e, sim.kerzen, [{ id: `E${i + 1}`, titel: 'Eigene Variante', richtung, variante: v }], opt))
    }
    return {
        ok: true, zeit: Date.now(), kurs, eingabe: { coin: e.coin, coinM: e.coinM, richtung: e.richtung, einsatz: e.einsatz, hebel: e.hebel, tage: e.tage },
        einheit: e.coinM ? e.coin : 'USDT', markt: lage, trend, chart, zeitrahmen: sim.tf, kerzenAnzahl: sim.kerzen.length,
        von: sim.kerzen[0]?.t ?? null, bis: sim.kerzen.at(-1)?.t ?? null, mmr: mmr ?? null, mmrQuelle: marge?.quelle || 'pauschal',
        fundingSimuliert: !!sim.funding, minMenge: minMenge ?? null, grids: { sinnvoll: SINNVOLLE_GRIDS, wenig: WENIG_GRIDS },
        hohe: zr ? { tabelle: zeitrahmenTabelle(zr), marken: zr.marken.map((m) => ({ id: m.id, tf: m.tf, preis: m.preis })), treffen: zr.treffen } : null,
        kandidaten, eigene,
        _zr: zr,
    }
}

async function rechneGemerkt(e, coins) {
    const schluessel = JSON.stringify([e.coin, e.coinM, e.richtung, e.einsatz, e.hebel, e.tage, e.eigeneRoh])
    const c = rechnenCache.get(schluessel)
    if (c && Date.now() - c.zeit < RECHNEN_MS) return c.daten
    if (!laeuft.has(schluessel)) {
        laeuft.set(schluessel, rechne(e, coins)
            .then((daten) => { rechnenCache.set(schluessel, { zeit: Date.now(), daten }); for (const [k, v] of rechnenCache) if (Date.now() - v.zeit > RECHNEN_MS) rechnenCache.delete(k); return daten })
            .finally(() => laeuft.delete(schluessel)))
    }
    return laeuft.get(schluessel)
}

const ohneIntern = ({ _zr, ...d }) => d
const ohneKurve = (c) => (c?.rueckblick ? { ...c, rueckblick: { ...c.rueckblick, kurve: undefined } } : c)

async function kiFuer(e, coins, englisch) {
    const d = await rechneGemerkt(e, coins)
    const gueltig = d.kandidaten.filter((c) => !c.fehler)
    if (!gueltig.length) throw Object.assign(new Error('Keine rechenbaren Kandidaten'), { code: 'keineKandidaten' })
    const typ = e.coinM ? 'coinm_grid' : 'futures_grid'
    const zrText = d._zr ? zeitrahmenText(d._zr, (t) => new Date(t).toISOString().slice(0, 10)).replace('ZEITRAHMEN — vom Code gemessen', 'HOHE ZEITRAHMEN — vom Code gemessen') : ''
    const user = bauePlanPrompt(e, { wissen: wissenAlsText(typ), lage: d.markt ? { ...d.markt, kurs: d.kurs } : { kurs: d.kurs }, zrText, kandidaten: gueltig, tf: d.zeitrahmen, englisch, trend: d.trend, chart: d.chart || [] })
    const cfg = await ladeLlmConfigFuerAufgabe('bot-optimierung')
    cfg.maxTokens = 2500
    const antwort = await callLLMJson(cfg, {
        system: planSystemText({ alle: e.richtung === ALLE }), user, timeoutMs: 90000,
        zweck: 'bot-optimierung', ausloeser: 'manuell', bezug: { typ: 'symbol', id: `${e.coin}USDT` },
    })
    const geprueft = pruefeKiAntwort(antwort.json, { kandidaten: gueltig }, user)
    if (!geprueft) throw new Error('Die KI hat keine verwertbare Antwort geliefert')
    const nachId = new Map(gueltig.map((c) => [c.id, c]))
    // Alle Richtungen: je Richtung höchstens ein Vorschlag (der erste zählt)
    if (e.richtung === ALLE) {
        const gesehen = new Set()
        geprueft.vorschlaege = geprueft.vorschlaege.filter((v) => {
            const r = nachId.get(v.id)?.richtung
            if (gesehen.has(r)) { geprueft.verworfen.push({ id: v.id, grund: 'zweiterJeRichtung' }); return false }
            gesehen.add(r); return true
        })
    }
    for (const v of geprueft.verworfen) logWarn('bots', `Planer: KI-Vorschlag verworfen (${v.grund}): ${v.id}`)
    return {
        ok: true, kiGeneriert: true, zeit: Date.now(), anbieter: cfg.provider, modell: cfg.model, kostenUsd: antwort.costUsd ?? null,
        eingabe: d.eingabe, kurs: d.kurs, trend: d.trend,
        lage: geprueft.lage, lageUnbelegt: geprueft.lageUnbelegt, hinweis: geprueft.hinweis, verworfen: geprueft.verworfen.length,
        vorschlaege: geprueft.vorschlaege.map((v) => ({ ...ohneKurve(v), richtung: nachId.get(v.id)?.richtung || e.richtung, start: nachId.get(v.id)?.start || null, warnungen: nachId.get(v.id)?.warnungen || [] })),
    }
}

function fehler(res, e) {
    if (sendeWennAus(res, e)) return
    if (e?.code === 'keinKurs' || e?.code === 'keineKandidaten') return res.status(400).json({ ok: false, code: e.code })
    res.status(502).json({ ok: false, error: fehlerText(e) })
}

export function setupBotPlanerRoutes(app) {
    app.get('/api/bots/plan/coins', async (req, res) => {
        try {
            const coins = await holeCoins()
            res.json({ ok: true, coins: [...coins].map(([coin, c]) => ({ coin, linear: c.linear, coinM: c.coinM })).sort((a, b) => a.coin.localeCompare(b.coin)) })
        } catch (e) { fehler(res, e) }
    })

    app.post('/api/bots/plan/rechnen', async (req, res) => {
        try {
            const coins = await holeCoins()
            const e = eingabeAus(req.body, coins)
            if (e.fehler) return res.status(400).json({ ok: false, code: e.fehler })
            const d = await rechneGemerkt(e, coins)
            res.json(ohneIntern(d))
        } catch (e) {
            logWarn('bots', `Planer rechnen: ${e.message}`)
            fehler(res, e)
        }
    })

    app.get('/api/bots/plan/ki', (req, res) => res.json({ ok: true, ergebnis: kiLetzte }))

    app.post('/api/bots/plan/ki', async (req, res) => {
        try {
            const coins = await holeCoins()
            const e = eingabeAus({ ...req.body, eigene: [] }, coins)
            if (e.fehler) return res.status(400).json({ ok: false, code: e.fehler })
            const englisch = req.body?.sprache === 'en'
            const schluessel = JSON.stringify([e.coin, e.coinM, e.richtung, e.einsatz, e.hebel, e.tage, englisch])
            // Ein Lauf zur Zeit; ein zweiter Klick mit derselben Eingabe wartet mit, eine andere Eingabe nicht
            if (kiLaeuft && kiLaeuft.schluessel !== schluessel) return res.status(429).json({ ok: false, code: 'kiLaeuft' })
            if (!kiLaeuft) {
                const pause = (kiZuletzt.fehler ? 45_000 : PLAN_KI_PAUSE_MS) - (Date.now() - kiZuletzt.zeit)
                if (pause > 0) return res.status(429).json({ ok: false, code: 'kiWarten', sekunden: Math.ceil(pause / 1000) })
                const promise = kiFuer(e, coins, englisch)
                    .then((r) => { kiZuletzt = { zeit: Date.now(), fehler: false }; kiLetzte = r; return r },
                        (err) => { kiZuletzt = { zeit: Date.now(), fehler: true }; throw err })
                    .finally(() => { kiLaeuft = null })
                kiLaeuft = { schluessel, promise }
            }
            res.json({ ok: true, ergebnis: await kiLaeuft.promise })
        } catch (e) {
            logWarn('bots', `Planer KI: ${e.message}`)
            fehler(res, e)
        }
    })
}
