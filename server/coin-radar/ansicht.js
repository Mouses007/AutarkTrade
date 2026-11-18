/**
 * Coin-Ansicht: was der Steckbrief eines Coins vom Server braucht und nicht
 * schon woanders bekommt.
 *
 *   GET /api/coin-radar/ansicht/verlauf?symbol=   Tageskerzen (bis 800 Tage) des Coins und von BTC
 *   GET /api/coin-radar/ansicht/kontext?symbol=   wo der Coin im Haus sonst steht — nur Datenbank
 *   GET /api/coin-radar/ansicht/lage?symbol=      Projekt-Lage: Meldungen eines Jahres (Google News,
 *                                                 eigene Nachrichten), Warnsignale — kostenlos (`lage.js`)
 *   POST /api/coin-radar/ansicht/lage/recherche   KI-Recherche dazu, kostet, nur per Knopf
 *
 * Alles andere holt die Ansicht über bestehende Routen: die Messung
 * (`/api/coin-radar/einzel`), die Stammdaten (`/api/coin-radar/coin-info`),
 * Funding-Verlauf (`/api/chart/funding`), Long/Short und Open Interest
 * (`/api/marktradar/ls-oi`), die Tiefensuche (`/api/coin-radar/tiefensuche`).
 *
 * VERLAUF. Kein neuer Anbieter: Führt die Marktdatenquelle das Paar, kommen
 * die Tageskerzen von dort (`getHistoricalCandles`, bei Binance über die
 * Gewichtsbremse; ein Abruf je Symbol). Führt es nur Bitunix, von Bitunix —
 * derselbe Zweiweg wie in der Einzelprüfung (`einzel.js`), und die Antwort
 * sagt, woher. Zwischengespeichert 30 min je Symbol über `ausCache` (mit
 * Zusammenfassen gleichzeitiger Anfragen und Altstand bei Störung); BTC als
 * Vergleichslinie teilt sich einen Eintrag über alle Coins.
 *
 * KONTEXT. Liest nur die eigene Datenbank: letzte Läufe des Coin-Radars,
 * Abverkaufs-Wache, neue Listungen des Börsen-Beobachters, Favorit und
 * dessen Alarme, aktive Chart-Alarme, eigene Trades. Kein Abruf nach aussen,
 * kein Schreiben. Jeder Teil fällt für sich aus (`null`), die Karte zeigt
 * dann den Rest.
 */

import { getKnex } from '../database.js'
import { getHistoricalCandles } from '../market-data.js'
import { ausCache, sendeRadar, holeJson as radarJson } from '../marktradar-api.js'
import * as marktdaten from '../marktdaten/index.js'
import { holeHandelbar, holeTestbar } from '../coin-universum.js'
import { sendeWennAus, istAus } from '../quellen/aus.js'
import { tradesAusZeilen } from '../chart-journal.js'
import { logWarn } from '../logger.js'
import { kerzenAusBitunix } from './einzel.js'
import { BTC_REFERENZ } from './btc-vergleich.js'
import { holeLage, starteRecherche } from './lage.js'
import {
    tageKompakt, ersterHandelstag, rangVerlauf, eigeneTrades, VERLAUF_TAGE, RANG_LAEUFE,
} from './ansicht-kern.js'

const SYMBOL_RE = /^[A-Z0-9]{2,24}$/
const TAG_MS = 86_400_000
const VERLAUF_TTL_MS = 30 * 60 * 1000
const BITUNIX = 'https://fapi.bitunix.com'
/** Bitunix gibt je Abruf höchstens 200 Kerzen heraus (gemessen, siehe `einzel.js`). */
const BITUNIX_SEITE = 200

/** Bitunix-Tageskerzen, rückwärts geblättert bis `tage` zurück oder bis nichts Älteres kommt. */
async function bitunixTage(symbol, jetzt, tage) {
    const alle = []
    let ende = 0
    for (let seite = 0; seite < Math.ceil(tage / BITUNIX_SEITE); seite++) {
        const j = await radarJson(`${BITUNIX}/api/v1/futures/market/kline?symbol=${encodeURIComponent(symbol)}`
            + `&interval=1d&limit=${BITUNIX_SEITE}${ende ? `&endTime=${ende}` : ''}`)
        const kerzen = kerzenAusBitunix(j?.data, '1d', jetzt)
        const neu = kerzen.filter((k) => !ende || k.t < ende)
        if (!neu.length) break
        alle.unshift(...neu)
        ende = neu[0].t
        if (neu.length < BITUNIX_SEITE - 1 || ende <= jetzt - tage * TAG_MS) break
    }
    return alle.filter((k) => k.t >= jetzt - tage * TAG_MS)
}

/**
 * Tagesverlauf eines Symbols und von BTC.
 *
 * @param {string} symbol
 * @param {object} [quellen]  einspeisbare Abrufe — nur für Tests
 * @returns {Promise<object>} `{gefunden:false}` oder
 *   `{gefunden, symbol, quelle, quelleName, tage, kerzen, ersterTag, btc, stand, veraltet}`
 */
export async function holeTagesverlauf(symbol, quellen = {}) {
    const jetzt = quellen.jetzt || Date.now()
    const [handelbar, testbar] = await Promise.all([
        (quellen.handelbar || holeHandelbar)(),
        (quellen.testbar || holeTestbar)(),
    ])
    const beiQuelle = testbar.has(symbol)
    if (!beiQuelle && !handelbar.has(symbol)) return { gefunden: false, symbol }

    const zwischen = quellen.ausCache || ausCache
    const ausMarktdaten = (s) => zwischen(`coinansicht_tage|md|${s}`, VERLAUF_TTL_MS, async () => ({
        kerzen: tageKompakt(await (quellen.marktdatenTage
            || ((sym, von, bis) => getHistoricalCandles(sym, '1d', von, bis)))(s, jetzt - VERLAUF_TAGE * TAG_MS, jetzt)),
    }))
    const ausBitunix = (s) => zwischen(`coinansicht_tage|bx|${s}`, VERLAUF_TTL_MS, async () => ({
        kerzen: tageKompakt(await (quellen.bitunixTage || bitunixTage)(s, jetzt, VERLAUF_TAGE)),
    }))

    const eigene = await (beiQuelle ? ausMarktdaten(symbol) : ausBitunix(symbol))
    let quelleName = 'Bitunix'
    if (beiQuelle) {
        try { quelleName = (await (quellen.anbieter || (() => marktdaten.fordere('kerzen')))()).name } catch { quelleName = '' }
    }

    // BTC als Vergleichslinie: ein Zusatz. Fällt er aus, steht der Verlauf ohne ihn da.
    let btc = null
    if (symbol !== BTC_REFERENZ) {
        try {
            btc = (await ausMarktdaten(BTC_REFERENZ)).kerzen.map((k) => [k[0], k[3]])
        } catch (e) {
            if (!istAus(e)) logWarn('coin-radar', `Coin-Ansicht: BTC-Vergleich nicht abrufbar: ${e.message}`)
        }
    }

    return {
        gefunden: true,
        symbol,
        quelle: beiQuelle ? 'marktdaten' : 'bitunix',
        quelleName,
        tage: VERLAUF_TAGE,
        kerzen: eigene.kerzen,
        ersterTag: ersterHandelstag(eigene.kerzen, jetzt),
        btc,
        stand: eigene.stand || jetzt,
        veraltet: Boolean(eigene.veraltet),
        _cache: eigene._cache,
    }
}

const basisVon = (symbol) => symbol.replace(/USDT$|USDC$|USD$/, '').replace(/^1000+/, '')

/**
 * Wo der Coin im Haus sonst steht. Nur Lesen, nur die eigene Datenbank.
 * @returns {Promise<object>} je Teil ein Objekt oder `null` (nicht lesbar)
 */
export async function leseKontext(symbol, knex = getKnex(), jetzt = Date.now()) {
    const teil = async (name, fn) => {
        try { return await fn() } catch (e) {
            logWarn('coin-radar', `Coin-Ansicht Kontext (${name}) ${symbol}: ${e.message}`)
            return null
        }
    }
    const basis = basisVon(symbol)

    const [coinRadar, abverkauf, listungen, favorit, chartAlarme, trades] = await Promise.all([
        teil('coin-radar', async () => {
            const laeufe = await knex('coinradar_laeufe').where({ status: 'fertig', anlageklasse: 'krypto' })
                .orderBy('id', 'desc').limit(RANG_LAEUFE).select('id', 'erstelltAm', 'beendetAm', 'gesamt')
            if (!laeufe.length) return { laeufe: 0, bewertet: 0, top10: 0, punkte: [], letzter: null }
            // `uq_coinradar_zeile` (laufId, symbol) trägt die Abfrage — kein Scan über die grosse Tabelle.
            const zeilen = await knex('coinradar_zeilen').whereIn('laufId', laeufe.map((l) => l.id)).where('symbol', symbol)
                .select('laufId', 'rang', 'note', 'status', 'huerdeGrund')
            return rangVerlauf(laeufe.map((l) => ({ id: l.id, zeit: Number(l.beendetAm || l.erstelltAm) || 0, gesamt: l.gesamt })), zeilen)
        }),
        teil('abverkauf', async () => {
            const z = await knex('abverkauf_stand').where('symbol', symbol).first()
            // Älter als ein Tag ist kein Stand mehr, sondern eine Erinnerung.
            if (!z || jetzt - Number(z.aktualisiertAm) > TAG_MS) return { beobachtet: false }
            return {
                beobachtet: true, phase: z.phase || 'keine', note: Number(z.note) || 0,
                anstieg24h: Number.isFinite(Number(z.anstieg24h)) && z.anstieg24h !== null ? Number(z.anstieg24h) : null,
                phaseSeit: Number(z.phaseSeit) || null, aktualisiertAm: Number(z.aktualisiertAm) || null,
            }
        }),
        teil('listungen', async () => (await knex('hype_listungen_neu')
            .whereIn('symbol', [...new Set([basis, symbol])]).where('gesehenAm', '>', jetzt - 30 * TAG_MS)
            .orderBy('gesehenAm', 'desc').limit(8).select('boerse', 'gesehenAm', 'handelsStart', 'treffer'))
            // Namensgleiche Treffer sind ein anderer Token mit demselben Kürzel.
            .filter((l) => l.treffer !== 'namensgleich')
            .map((l) => ({ boerse: l.boerse, gesehenAm: Number(l.gesehenAm) || null, handelsStart: Number(l.handelsStart) || null }))),
        teil('favorit', async () => {
            const f = await knex('hype_favoriten').where({ symbol, chain: '', contractAddress: '' }).first()
            if (!f) return { an: false }
            const [{ n } = { n: 0 }] = await knex('hype_alarme').where({ favoritId: f.id, gelesen: 0 }).count({ n: '*' })
            const letzter = await knex('hype_alarme').where('favoritId', f.id).orderBy('erstelltAm', 'desc').first('regel', 'schwere', 'erstelltAm')
            return {
                an: true, id: f.id, stumm: Number(f.stumm) === 1, seit: Number(f.erstelltAm) || null,
                alarmeUngelesen: Number(n) || 0,
                letzterAlarm: letzter ? { regel: letzter.regel, schwere: letzter.schwere, zeit: Number(letzter.erstelltAm) || null } : null,
            }
        }),
        teil('chart-alarme', async () => {
            const [{ n } = { n: 0 }] = await knex('chart_alarme').where({ symbol, aktiv: 1 }).count({ n: '*' })
            return { aktiv: Number(n) || 0 }
        }),
        teil('trades', async () => {
            const von = jetzt - 90 * TAG_MS
            const zeilen = await knex('trades').select('dateUnix', 'broker', 'trades')
                .where('dateUnix', '>=', Math.floor(von / 1000) - 7 * 86400)
            return { tage: 90, ...eigeneTrades(tradesAusZeilen(zeilen, symbol, von, jetzt)) }
        }),
    ])
    return { symbol, coinRadar, abverkauf, listungen, favorit, chartAlarme, trades }
}

export function setupCoinAnsichtRoutes(app) {
    const symbolAus = (req, res) => {
        const symbol = String(req.query.symbol || '').trim().toUpperCase()
        if (!SYMBOL_RE.test(symbol)) { res.status(400).json({ error: 'Symbol fehlt oder ist ungültig' }); return '' }
        return symbol
    }

    app.get('/api/coin-radar/ansicht/verlauf', async (req, res) => {
        const symbol = symbolAus(req, res)
        if (!symbol) return
        try {
            sendeRadar(res, await holeTagesverlauf(symbol))
        } catch (e) {
            // Marktdatenquelle aus: 200 mit `{aus: true, …}` — ein Zustand, kein Fehler.
            if (sendeWennAus(res, e)) return
            logWarn('coin-radar', `Coin-Ansicht Verlauf ${symbol}: ${e.message}`)
            res.status(502).json({ error: 'Der Kursverlauf konnte nicht geladen werden' })
        }
    })

    app.get('/api/coin-radar/ansicht/lage', async (req, res) => {
        const symbol = symbolAus(req, res)
        if (!symbol) return
        try {
            // Liest nur: Google News (6 h Vorrat), eigene Meldungen, gespeicherte Recherche. Nie ein bezahlter Abruf.
            res.json(await holeLage(symbol))
        } catch (e) {
            logWarn('coin-radar', `Coin-Ansicht Projekt-Lage ${symbol}: ${e.message}`)
            res.status(502).json({ error: 'Die Projekt-Lage konnte nicht geladen werden' })
        }
    })

    app.post('/api/coin-radar/ansicht/lage/recherche', async (req, res) => {
        const symbol = String(req.body?.symbol || '').trim().toUpperCase()
        if (!SYMBOL_RE.test(symbol)) return res.status(400).json({ error: 'Symbol fehlt oder ist ungültig' })
        try {
            res.json(await starteRecherche(symbol))
        } catch (e) {
            const status = e.status && e.status < 500 ? e.status : 502
            if (status === 502) logWarn('coin-radar', `Coin-Ansicht Recherche ${symbol}: ${e.message}`)
            res.status(status).json({ error: status === 502 ? `Die Recherche ist fehlgeschlagen: ${String(e.message).slice(0, 200)}` : e.message })
        }
    })

    app.get('/api/coin-radar/ansicht/kontext', async (req, res) => {
        const symbol = symbolAus(req, res)
        if (!symbol) return
        try {
            res.json(await leseKontext(symbol))
        } catch (e) {
            logWarn('coin-radar', `Coin-Ansicht Kontext ${symbol}: ${e.message}`)
            res.status(500).json({ error: 'Der Kontext konnte nicht gelesen werden' })
        }
    })
}
