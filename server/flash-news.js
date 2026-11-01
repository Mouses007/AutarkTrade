/**
 * Flash-News im Chart: „Was ist bei diesem Coin gerade passiert?"
 *
 * Ein Knopf im Chart-Reiter. Zwei Suchen laufen parallel — X über Grok
 * (`sucheXZuCoin`) und das Web über Perplexity Sonar (`rechercheThema`) —,
 * danach listet das Modell der Aufgabe `flash-news` die Meldungen knapp auf.
 * Der reine Teil (Quellenliste, Eingabe, Prüfung) steht in
 * `flash-news-kern.js`.
 *
 * Kostet bei jedem Klick (Suchpauschalen plus Token). Deshalb wie bei der
 * Chart-KI: GET liest nur den Speicher, nur POST erzeugt; derselbe Lauf wird
 * nicht doppelt gestartet, und nach einem Fehlschlag gibt es 45 s Pause.
 * Ausgelöst wird ausschliesslich per Knopf — auch im Testbetrieb, denn wer
 * drückt, bezahlt wissentlich.
 *
 * Fehlt ein Schlüssel, läuft die andere Quelle allein; der Hinweis steht in
 * der Antwort. Fehlen beide, gibt es einen Fehler statt eines leeren Bildes.
 */
import { getKnex } from './database.js'
import { zeitzoneAus } from '../shared/zeitzone.js'
import { logWarn } from './logger.js'
import { ladeLlmConfig, ladeLlmConfigFuerAufgabe, callLLMJson, merkeKiGuthaben, istGuthabenFehler } from './llm.js'
import { sucheXZuCoin, rechercheThema, X_STANDARDMODELL } from './news-recherche.js'
import { basisCoin, quellenListe, webTextUmnummerieren, baueEingabe, pruefeFlashAntwort, systemText, FLASH_STUNDEN } from './flash-news-kern.js'

const SYMBOL_RE = /^[A-Z0-9]{2,20}$/
const CACHE_MS = 15 * 60 * 1000
const CACHE_MAX = 20
const SPERRE_MS = 45 * 1000

const cache = new Map()          // 'SYMBOL|stunden' → {ts, payload}
const laufend = new Map()
const fehlschlaege = new Map()   // 'SYMBOL|stunden' → {ts, meldung}

export function letzteFlashNews(symbol, stunden) {
    const e = cache.get(`${symbol}|${stunden}`)
    if (!e || Date.now() - e.ts > CACHE_MS) return null
    return { ...e.payload, alterMs: Date.now() - e.ts }
}

async function sucheX({ coin, stunden, s }) {
    const cfg = await ladeLlmConfig({ provider: 'xai' })
    if (!cfg.apiKey) return { posts: [], kostenUsd: 0, hinweis: 'xOhneSchluessel' }
    try {
        const r = await sucheXZuCoin({ coin, stunden, modell: s?.radarNewsXModell || X_STANDARDMODELL, apiKey: cfg.apiKey })
        merkeKiGuthaben('xai').catch(() => { })
        return r
    } catch (e) {
        if (istGuthabenFehler(e.message)) await merkeKiGuthaben('xai', e.message).catch(() => { })
        logWarn('flash-news', `X ${coin}: ${e.message}`)
        return { posts: [], kostenUsd: 0, hinweis: 'xFehler', fehler: e.message }
    }
}

async function sucheWeb({ coin, stunden, s }) {
    // Das Modellfeld kann auch „deepseek-suche" tragen (anderer Weg) — hier immer Perplexity.
    const feld = String(s?.radarNewsRechercheModell || '')
    const modell = feld && !feld.startsWith('deepseek') ? feld : 'sonar'
    const cfg = await ladeLlmConfig({ provider: 'perplexity', model: modell })
    if (!cfg.apiKey) return { text: '', citations: [], quellenDaten: new Map(), kostenUsd: 0, hinweis: 'webOhneSchluessel' }
    const zeitraum = stunden === 1 ? 'der letzten Stunde' : `der letzten ${stunden} Stunden`
    try {
        const r = await rechercheThema({
            thema: coin,
            frage: `Was wurde in ${zeitraum} zum Krypto-Coin ${coin} gemeldet, das eine ungewöhnliche Kursbewegung erklären könnte? `
                + 'Listungen oder Delistings, Börsen-Ankündigungen, Hacks, Token-Unlocks, Partnerschaften, Regulierung, grosse Wal- oder ETF-Bewegungen. '
                + 'Nur Meldungen aus diesem Zeitraum, mit Uhrzeit, wo bekannt. Nüchtern, keine Prognose, keine Anlageberatung. '
                + 'Gibt es nichts, sag das in einem Satz.',
            apiKey: cfg.apiKey,
            modell,
            timeoutMs: 60000,
            aktualitaet: stunden <= 1 ? 'hour' : 'day',
            ausloeser: 'manuell',
            funktion: 'flash-news-web',
        })
        merkeKiGuthaben('perplexity').catch(() => { })
        return r
    } catch (e) {
        if (istGuthabenFehler(e.message)) await merkeKiGuthaben('perplexity', e.message).catch(() => { })
        logWarn('flash-news', `Web ${coin}: ${e.message}`)
        return { text: '', citations: [], quellenDaten: new Map(), kostenUsd: 0, hinweis: 'webFehler', fehler: e.message }
    }
}

export async function erzeugeFlashNews({ symbol, stunden }) {
    const schluessel = `${symbol}|${stunden}`
    if (laufend.has(schluessel)) return laufend.get(schluessel)
    const fehl = fehlschlaege.get(schluessel)
    if (fehl && Date.now() - fehl.ts < SPERRE_MS) {
        const e = new Error(`${fehl.meldung} — nächster Versuch in ${Math.ceil((SPERRE_MS - (Date.now() - fehl.ts)) / 1000)} s`)
        e.status = 429
        throw e
    }

    const lauf = (async () => {
        const s = await getKnex()('settings').select('language', 'timeZone', 'radarNewsXModell', 'radarNewsRechercheModell')
            .where('id', 1).first().catch(() => null)
        const englisch = s?.language === 'en'
        const zeitzone = zeitzoneAus(s?.timeZone)
        const coin = basisCoin(symbol)
        if (!coin) throw Object.assign(new Error('Kein Coin im Symbol'), { status: 400 })

        const [x, web] = await Promise.all([sucheX({ coin, stunden, s }), sucheWeb({ coin, stunden, s })])
        const hinweise = [x.hinweis, web.hinweis].filter(Boolean)
        if (hinweise.includes('xOhneSchluessel') && hinweise.includes('webOhneSchluessel')) {
            throw Object.assign(new Error('Weder xAI- noch Perplexity-Schlüssel hinterlegt (Einstellungen › KI)'), { status: 400 })
        }
        if (x.fehler && web.fehler) throw new Error(`Beide Suchen fehlgeschlagen — X: ${x.fehler}; Web: ${web.fehler}`)

        const { quellen, webNr } = quellenListe({ xPosts: x.posts, webZitate: web.citations, webDaten: web.quellenDaten })
        const suchKosten = (x.kostenUsd || 0) + (web.kostenUsd || 0)
        const basis = {
            symbol, coin, stunden, quellen, hinweise, erstelltAm: Date.now(), kiGeneriert: true,
        }
        let payload
        if (!quellen.length) {
            // Nichts gefunden: kein Modellaufruf — es gäbe nichts zusammenzufassen.
            payload = { ...basis, lage: 'nichts', kurz: '', punkte: [], provider: null, model: null, costUsd: suchKosten }
        } else {
            const cfg = await ladeLlmConfigFuerAufgabe('flash-news')
            cfg.maxTokens = 1500
            const user = baueEingabe({ symbol, coin, stunden, quellen, webText: webTextUmnummerieren(web.text, webNr), zeitzone })
            const antwort = await callLLMJson(cfg, {
                system: systemText(englisch), user, timeoutMs: 60000,
                zweck: 'flash-news', ausloeser: 'manuell', bezug: { typ: 'symbol', id: symbol },
            })
            const ergebnis = pruefeFlashAntwort(antwort.json, quellen)
            if (!ergebnis) throw new Error('Die KI hat keine verwertbare Antwort geliefert')
            for (const v of ergebnis.verworfen) logWarn('flash-news', `${symbol}: verworfen (${v.grund}) — ${v.text.slice(0, 120)}`)
            payload = {
                ...basis, lage: ergebnis.lage, kurz: ergebnis.kurz, punkte: ergebnis.punkte,
                provider: cfg.provider, model: cfg.model, costUsd: suchKosten + (antwort.costUsd || 0),
            }
        }
        cache.set(schluessel, { ts: Date.now(), payload })
        while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value)
        return { ...payload, alterMs: 0 }
    })()
    laufend.set(schluessel, lauf)
    try {
        const r = await lauf
        fehlschlaege.delete(schluessel)
        return r
    } catch (e) {
        if (e.status !== 429 && e.status !== 400) fehlschlaege.set(schluessel, { ts: Date.now(), meldung: e.message })
        throw e
    } finally { laufend.delete(schluessel) }
}

function stundenAus(v) {
    const n = Number(v)
    return FLASH_STUNDEN.includes(n) ? n : null
}

export function setupFlashNewsRoutes(app) {
    app.get('/api/chart/flash-news', (req, res) => {
        const symbol = String(req.query.symbol || '').toUpperCase()
        const stunden = stundenAus(req.query.stunden) || 1
        res.set('Cache-Control', 'no-store')
        if (!SYMBOL_RE.test(symbol)) return res.status(400).json({ error: 'symbol ungültig' })
        res.json(letzteFlashNews(symbol, stunden) || { leer: true, symbol, stunden })
    })

    app.post('/api/chart/flash-news', async (req, res) => {
        const symbol = String(req.body?.symbol || '').toUpperCase()
        const stunden = stundenAus(req.body?.stunden)
        if (!SYMBOL_RE.test(symbol)) return res.status(400).json({ error: 'symbol ungültig' })
        if (!stunden) return res.status(400).json({ error: `Zeitraum nur ${FLASH_STUNDEN.join(', ')} Stunden` })
        try {
            res.json(await erzeugeFlashNews({ symbol, stunden }))
        } catch (e) {
            logWarn('flash-news', `${symbol} ${stunden}h: ${e.message}`)
            res.status(e.status === 429 || e.status === 400 ? e.status : 502).json({ error: e.message })
        }
    })
}
