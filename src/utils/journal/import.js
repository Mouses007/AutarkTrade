/**
 * Import-Vorschau speichern, vorhandene Tage, Kerzen holen und MFE-Preise
 * daraus bestimmen (Spezifikation journal-kern.md §4.2).
 *
 * Modulzustand: Symbolliste mit Zeitfenster für `useGetOHLCV`, die Kerzenliste
 * und die MFE-Preisliste. Letztere wird bewusst NIE geleert (Altfehler §7.5).
 */
import axios from 'axios'
import dayjs from './zeit.js'
import { dbFind, dbCreate } from '../db.js'
import { currentUser, timeZoneTrade, queryLimitExistingTrades } from '../../stores/app/rahmen.js'
import { spinnerLoadingPage } from '../../stores/app/laden.js'
import { selectedBroker } from '../../stores/journal/filter.js'
import { blotter, pAndL, executions, trades, tradeId, existingTradesArray, gotExistingTradesArray, marketCloseTime } from '../../stores/journal/import.js'
import { tradeExcursionId } from '../../stores/journal/tagebuch.js'

const anfrage = { symbole: [], von: undefined, bis: undefined }
let kerzen = []          // Liste {symbol, ohlcv}
const mfePreise = []     // Altfehler §7.5: wächst über alle Aufrufe

// PapaParse nur bei Bedarf laden (Bundle-Grösse)
let papa = null
async function ladePapa() {
    if (!papa) papa = (await import('papaparse')).default
    return papa
}

const schluesselVon = (anbieter) => currentUser.value?.apis?.find(a => a.provider === anbieter)?.key
const nieErfuellt = () => new Promise(() => {})

// ── Vorhandene Tage ────────────────────────────────────────────────────────

export function useGetExistingTradesArray(_param99, _param0) {
    // Altfehler §7.6: bei DB-Fehler bleibt das Promise unerfüllt.
    return new Promise((erfuellt) => {
        existingTradesArray.length = 0
        dbFind('trades', { descending: 'dateUnix', limit: queryLimitExistingTrades.value })
            .then((zeilen) => {
                for (const z of zeilen) existingTradesArray.push(z.date)
                gotExistingTradesArray.value = true
                erfuellt()
            })
            .catch((e) => console.warn('Vorhandene Tage nicht lesbar:', e))
    })
}

// ── Kerzen ─────────────────────────────────────────────────────────────────

/** Databento-CSV → Kerzen in `ziel.ohlcv`; erfüllt mit `ziel`. */
export async function useCreateOHLCV(csv, ziel) {
    const Papa = await ladePapa()
    const { data } = Papa.parse(csv, { header: true, skipEmptyLines: false })
    // Altfehler §7.6: ohne eine einzige Zeile bleibt das Promise unerfüllt.
    if (!data.length) return nieErfuellt()
    for (const zeile of data) {
        if (!zeile.ts_event) continue
        ziel.ohlcv.push({
            v: Number(zeile.volume),
            o: Number(zeile.open),
            c: Number(zeile.close),
            h: Number(zeile.high),
            l: Number(zeile.low),
            t: dayjs.utc(zeile.ts_event).unix() * 1000,
        })
    }
    kerzen.push(ziel)
    return ziel
}

function databentoRumpf(eintrag, endeSek) {
    const art = eintrag.secType
    return {
        dataset: art === 'future' ? 'GLBX.MDP3' : art === 'stock' ? 'XNAS.ITCH' : undefined,
        stype_in: art === 'future' ? 'continuous' : 'raw_symbol',
        symbols: art === 'future' ? eintrag.symbol + '.c.0' : eintrag.symbol,
        schema: 'ohlcv-1m',
        // gewöhnliche Number-Multiplikation, kein BigInt (§4.2)
        start: anfrage.von * 1000000000,
        end: endeSek * 1000000000,
        encoding: 'csv',
        pretty_px: 'true',
        pretty_ts: 'true',
        map_symbols: 'true',
        username: schluesselVon('databento'),
    }
}

/** Polygon: 429 → warten und erneut; andere Fehler melden. */
function polygonFehler(fehler) {
    const konfig = fehler.config
    if (!konfig || !konfig.retry) return Promise.reject(fehler)
    if (fehler.response?.status !== 429) {
        alert('Error getting OHLCV with message: ' + fehler.message)
        return Promise.reject(fehler)
    }
    konfig.retry -= 1
    return new Promise(r => setTimeout(r, konfig.retryDelay || 1000)).then(() => axios(konfig))
}

/**
 * Kerzen für alle Symbole holen. Altfehler §7.7: erfüllt nach dem ERSTEN
 * Symbol, die übrigen laufen danach weiter.
 */
export async function useGetOHLCV(quelle, modus, symbole, von, bis) {
    if (symbole) anfrage.symbole = symbole
    if (von) anfrage.von = von
    if (bis) anfrage.bis = bis
    kerzen = []   // neue Liste: eine von aussen übergebene (useGetMFEPrices) bleibt unberührt
    const endeSek = dayjs.unix(anfrage.bis).endOf('day').unix()

    if (quelle === 'databento') {
        return new Promise((erfuellt, abgelehnt) => {
            for (const eintrag of anfrage.symbole) {
                const rumpf = databentoRumpf(eintrag, endeSek)
                if (modus === 'api') {
                    const auth = globalThis.Buffer.from(rumpf.username + ':').toString('base64')
                    axios.post('https://hist.databento.com/v0/timeseries.get_range', new URLSearchParams(rumpf).toString(), {
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + auth },
                    }).then(async (antwort) => {
                        await useCreateOHLCV(antwort.data, { symbol: eintrag.symbol, ohlcv: [] })
                        erfuellt()
                    }).catch(abgelehnt)
                } else {
                    // nicht abwarten: alle Anfragen gehen sofort raus
                    axios.post('/api/databento', rumpf).then(async (antwort) => {
                        await useCreateOHLCV(antwort.data, { symbol: eintrag.symbol, ohlcv: [] })
                        erfuellt(kerzen)
                    }).catch(abgelehnt)
                }
            }
        })
    }

    if (quelle === 'polygon') {
        return new Promise((erfuellt, abgelehnt) => {
            (async () => {
                let erstes = true
                for (const eintrag of anfrage.symbole) {
                    if (window._polygonInterceptorId !== undefined) axios.interceptors.response.eject(window._polygonInterceptorId)
                    window._polygonInterceptorId = axios.interceptors.response.use(undefined, polygonFehler)
                    const antwort = await axios.get('/api/polygon/aggs', {
                        params: {
                            ticker: eintrag.symbol, from: anfrage.von * 1000, to: endeSek * 1000,
                            interval: 1, span: 'minute', adjusted: true, sort: 'asc', limit: 50000,
                        },
                        headers: { 'x-polygon-api-key': schluesselVon('polygon') },
                        retry: 5,
                        retryDelay: 60000,
                    })
                    kerzen.push({ symbol: eintrag.symbol, ohlcv: antwort.data.results })
                    erfuellt(kerzen)
                    // der Aufrufer läuft mit dem ersten Symbol weiter, der Rest im nächsten Takt
                    if (erstes) { erstes = false; await new Promise(r => setTimeout(r, 0)) }
                }
            })().catch(abgelehnt)
        })
    }
}

// ── MFE ────────────────────────────────────────────────────────────────────

/**
 * Höchster günstiger Preis zwischen Ein- und Ausstieg, bei Gewinnern bis zum
 * Marktschluss verlängert. Hängt an die Modulliste an und gibt sie GANZ zurück.
 */
export async function useGetMFEPrices(ausf, einstiegZeit, einstiegPreis, trade, kerzenSatz) {
    if (kerzenSatz) kerzen = kerzenSatz
    const eintrag = kerzen.find(k => k.symbol == ausf.symbol)
    // Altfehler §7.6: Symbol unbekannt → das Promise bleibt für immer offen.
    if (!eintrag) return nieErfuellt()
    const reihe = eintrag.ohlcv
    if (reihe === undefined) return mfePreise

    const E = einstiegZeit * 1000
    const X = trade.exitTime * 1000
    const i0 = reihe.findIndex(k => k.t >= E)
    const j0 = reihe.findIndex(k => k.t >= X)
    if (i0 < 0 || j0 < 0) return mfePreise

    const s = reihe[i0].t === E ? i0 + 1 : i0
    const f = reihe[j0].t === X ? j0 : j0 - 1
    if (!reihe[s] || !reihe[f]) return mfePreise
    const Ts = reihe[s].t
    const Tf = reihe[f].t

    const zone = timeZoneTrade.value
    const schlussTag = dayjs(Tf).tz(zone).format('YYYY-MM-DD')
    const schluss = dayjs.tz(`${schlussTag} ${marketCloseTime.value}`, zone).valueOf()
    const k = reihe.findIndex(x => x.t >= schluss) - 1   // keiner → -2

    if (Tf < Ts) {
        mfePreise.push({ tradeId: trade.id, dateUnix: ausf.td, mfePrice: einstiegPreis })
        return mfePreise
    }

    const lang = trade.strategy === 'long'
    const kurz = trade.strategy === 'short'
    let m = einstiegPreis
    for (let i = s; i <= f; i++) {
        if (lang && reihe[i].h > trade.exitPrice && reihe[i].h > m) m = reihe[i].h
        if (kurz && reihe[i].l < trade.exitPrice && reihe[i].l < m) m = reihe[i].l
    }

    const differenz = lang ? trade.exitPrice - einstiegPreis : kurz ? einstiegPreis - trade.exitPrice : undefined
    if (einstiegPreis != trade.exitPrice && differenz > 0) {
        // Gewinner: bis Marktschluss weiter suchen. Die Bedingung prüft den
        // Preis des VORIGEN Schritts.
        let p = lang ? reihe[f].h : reihe[f].l
        let i = f
        while ((lang ? p > einstiegPreis : p < einstiegPreis) && i <= k) {
            p = lang ? reihe[i].h : reihe[i].l
            if (lang ? (p > einstiegPreis && p > m) : (p < einstiegPreis && p < m)) m = p
            i++
        }
    }

    if (lang && m < einstiegPreis) m = einstiegPreis
    if (kurz && m > einstiegPreis) m = einstiegPreis

    trade.excursions = { stopLoss: null, maePrice: null, mfePrice: m }
    mfePreise.push({ tradeId: trade.id, dateUnix: ausf.td, mfePrice: m })
    return mfePreise
}

/** Schreibt die GANZE Modulliste als Exkursionszeilen (Altfehler §7.5). */
export function useUpdateMfePrices(_param99, _param0, _param2) {
    // Altfehler §7.6: leere Liste → das Promise bleibt unerfüllt.
    return new Promise((erfuellt, abgelehnt) => {
        (async () => {
            for (let i = 0; i < mfePreise.length; i++) {
                const e = mfePreise[i]
                try {
                    await dbCreate('excursions', { mfePrice: e.mfePrice, dateUnix: e.dateUnix, tradeId: e.tradeId })
                    tradeId.value = tradeExcursionId.value
                } catch {
                    abgelehnt()
                }
                if (i === mfePreise.length - 1) erfuellt()
            }
        })()
    })
}

// ── Speichern der Vorschau ─────────────────────────────────────────────────

export async function useUploadTrades(_param99, _param0) {
    spinnerLoadingPage.value = true
    const tage = Object.keys(executions)
    const fehler = []
    let gespeichert = 0
    for (const k of tage) {
        const datum = dayjs.unix(Number(k)).format('YYYY-MM-DD')
        // Altfehler §7.8: ohne Tagesliste wird openPositions true.
        const offen = trades[k] ? trades[k].some(t => t.openPosition == true) : true
        try {
            await dbCreate('trades', {
                date: datum,
                dateUnix: Number(k),
                openPositions: offen,
                broker: selectedBroker.value || 'bitunix',
                executions: executions[k],
                trades: trades[k],
                blotter: blotter[k],
                pAndL: pAndL[k],
            })
            gespeichert++
        } catch (e) {
            fehler.push({ datum, grund: e?.response?.data?.error || e?.message || String(e) })
        }
    }
    if (fehler.length) {
        alert(`${gespeichert} Handelstag(e) importiert, ${fehler.length} fehlgeschlagen:\n` + fehler.map(f => `${f.datum}: ${f.grund}`).join('\n'))
    }
    if (tage.length > 0 && mfePreise.length > 0) await useUpdateMfePrices()
    window.location.href = '/dashboard'
}
