/**
 * Coin-Ansicht, Karte «Projekt-Lage»: was sich am Projekt geändert hat.
 *
 *   GET  /api/coin-radar/ansicht/lage?symbol=          kostenlos, lädt mit der Ansicht
 *   POST /api/coin-radar/ansicht/lage/recherche {symbol}   KI-Recherche, kostet, nur per Knopf
 *
 * KOSTENLOS (GET). Zwei Herkünfte, jede fällt für sich aus:
 *   - Google News (RSS-Suche nach dem Projektnamen, ein Jahr zurück). Die
 *     Bedingungen des Feeds erlauben nur den persönlichen, nicht-kommerziellen
 *     Gebrauch — darum hinter dem Schalter «Quellen mit eingeschränkten
 *     Nutzungsbedingungen» (`freigabe.js`, ID `googleNews`). Aus: Zustand
 *     `aus` mit Grund, wie bei den anderen Quellen. Abruf über `net-guard.js`
 *     (öffentliche Adresse, Grössen- und Zeitgrenze). 6 h zwischengespeichert
 *     (`api_cache`, Schlüssel `coinlage_gn|<Name>`), gleichzeitige Anfragen
 *     teilen sich einen Abruf.
 *   - die eigenen Meldungen der App (`news_items` der Nachrichten-Quellen,
 *     30 Tage Aufbewahrung), durchsucht nach Projektname und — nur wenn es
 *     eindeutig ist — Kürzel. Abgeschaltete Quellenarten (Telegram bei
 *     Schalter aus) bleiben draussen.
 * Name und CoinGecko-Id kommen aus `holeCoinInfo` (24 h Vorrat). Ohne
 * CoinGecko wird nur mit einem eindeutigen Kürzel gesucht.
 *
 * BEZAHLT (POST). Perplexity Sonar über `rechercheThema` mit dem Schlüssel
 * des Kunden und dem Modell der Nachrichten-Recherche (wie die Flash-News),
 * eine feste Frage nach den Änderungen der letzten 12 Monate, Antwort als JSON.
 * Verbucht unter der Funktion `coin-lage` (Kostenzeile «Recherche»). Das
 * Ergebnis bleibt 24 h je Coin (`api_cache`, `coinlage_ki|<Basis>`), GET
 * liefert es mit — ein erneutes Öffnen kostet nichts. Wie bei den anderen
 * Knöpfen: derselbe Lauf startet nicht doppelt, nach einem Fehlschlag 45 s
 * Pause; im Testbetrieb läuft er ebenfalls nur per Knopf (wer drückt, zahlt
 * wissentlich). GET löst NIE einen bezahlten Abruf aus.
 */

import { getKnex } from '../database.js'
import { logWarn } from '../logger.js'
import { holeText } from '../net-guard.js'
import { quelleErlaubt, QUELLEN_OHNE_FREIGABE } from '../quellen/freigabe.js'
import { QuelleAus, istAus, ausAntwort } from '../quellen/aus.js'
import { holeCoinInfo } from './coin-info.js'
import {
    googleNewsUrl, leseGoogleNews, fasseZusammen, zaehleWarnungen, passtZuProjekt, symbolEindeutig,
    rechercheFrage, leseRecherche, LAGE_TAGE,
} from './lage-kern.js'

const TAG_MS = 86_400_000
export const GN_TTL_MS = 6 * 60 * 60 * 1000
export const KI_TTL_MS = 24 * 60 * 60 * 1000
const SPERRE_MS = 45 * 1000

/** Wie in `coin-info.js`: USDT-Endung und 1000er-Bündel runter. */
export const basisVon = (symbol) => String(symbol || '').toUpperCase().replace(/USDT$|USDC$|USD$/, '').replace(/^1000+/, '')

// ── api_cache ────────────────────────────────────────────────────────────

async function leseCache(knex, key, ttl, jetzt = Date.now()) {
    try {
        const z = await knex('api_cache').where({ key }).first()
        if (!z?.payload || jetzt - Number(z.ts) >= ttl) return null
        return { ts: Number(z.ts), daten: JSON.parse(z.payload) }
    } catch (e) {
        logWarn('coin-radar', `Projekt-Lage: Zwischenspeicher ${key} nicht lesbar: ${e.message}`)
        return null
    }
}

async function schreibeCache(knex, key, daten, ts = Date.now()) {
    try {
        await knex('api_cache').insert({ key, ts, payload: JSON.stringify(daten) })
            .onConflict('key').merge(['ts', 'payload'])
    } catch (e) {
        logWarn('coin-radar', `Projekt-Lage: Zwischenspeicher ${key} nicht schreibbar: ${e.message}`)
    }
}

// ── Suchbegriff ──────────────────────────────────────────────────────────

/**
 * Name und Kürzel des Projekts. CoinGecko aus oder ohne Treffer: nur das
 * Kürzel, und das nur, wenn es eindeutig ist.
 * @returns {Promise<{basis, name, cgId, begriff, zusatz, cgAus}>}
 */
async function suchbegriff(symbol, deps) {
    const basis = basisVon(symbol)
    let info = null
    let cgAus = null
    try {
        info = await (deps.coinInfo || holeCoinInfo)(symbol)
    } catch (e) {
        if (istAus(e)) cgAus = ausAntwort(e)
        else logWarn('coin-radar', `Projekt-Lage ${symbol}: Coin-Info nicht abrufbar: ${e.message}`)
    }
    const name = String(info?.name || '').trim()
    if (name) return { basis, name, cgId: info?.id || null, begriff: name, zusatz: '', cgAus }
    if (symbolEindeutig(basis)) return { basis, name: '', cgId: null, begriff: basis, zusatz: 'crypto', cgAus }
    return { basis, name: '', cgId: null, begriff: '', zusatz: '', cgAus }
}

// ── Google News ──────────────────────────────────────────────────────────

const gnLaufend = new Map()

async function googleNews({ begriff, zusatz }, deps, jetzt) {
    if (!begriff) return { zustand: 'ohneName', eintraege: [] }
    if (!(await (deps.erlaubt || quelleErlaubt)('googleNews'))) {
        return { zustand: 'aus', aus: ausAntwort(new QuelleAus(QUELLEN_OHNE_FREIGABE.googleNews.name, 'ohneFreigabe')), eintraege: [] }
    }
    const knex = deps.knex || getKnex()
    const key = `coinlage_gn|${begriff.toLowerCase()}|${zusatz}`
    const alt = await leseCache(knex, key, GN_TTL_MS, jetzt)
    if (alt) return { zustand: 'ok', eintraege: alt.daten.eintraege || [], stand: alt.ts }
    if (gnLaufend.has(key)) return gnLaufend.get(key)
    const lauf = (async () => {
        try {
            const xml = await (deps.holeText || holeText)(googleNewsUrl(begriff, { zusatz }), { timeout: 12000, versuche: 2 })
            const eintraege = leseGoogleNews(xml).slice(0, 60)
            await schreibeCache(knex, key, { eintraege }, jetzt)
            return { zustand: 'ok', eintraege, stand: jetzt }
        } catch (e) {
            logWarn('coin-radar', `Projekt-Lage: Google News "${begriff}": ${e.message}`)
            return { zustand: 'fehler', fehler: 'Google News nicht erreichbar', eintraege: [] }
        } finally {
            gnLaufend.delete(key)
        }
    })()
    gnLaufend.set(key, lauf)
    return lauf
}

// ── Eigene Meldungen ─────────────────────────────────────────────────────

async function eigeneMeldungen({ name, basis }, deps, jetzt) {
    const suchworte = [name, symbolEindeutig(basis) ? basis : ''].filter((w) => w && w.length >= 3)
    if (!suchworte.length) return { zustand: 'ohneName', eintraege: [] }
    try {
        const knex = deps.knex || getKnex()
        const entfernt = deps.artenEntfernt
            ? await deps.artenEntfernt()
            : await (await import('../marktradar-news.js')).artenEntfernt()
        const quellen = (await knex('news_sources').select('id', 'name', 'art')).filter((q) => !entfernt.includes(q.art))
        if (!quellen.length) return { zustand: 'ok', eintraege: [] }
        const nachId = new Map(quellen.map((q) => [q.id, q]))
        const zeilen = await knex('news_items')
            .whereIn('sourceId', quellen.map((q) => q.id))
            .where('publishedAt', '>=', jetzt - LAGE_TAGE * TAG_MS)
            .where((b) => {
                for (const w of suchworte) {
                    const muster = `%${w.toLowerCase()}%`
                    b.orWhereRaw('LOWER(titel) LIKE ?', [muster]).orWhereRaw('LOWER(inhalt) LIKE ?', [muster])
                }
            })
            .orderBy('publishedAt', 'desc').limit(200)
            .select('sourceId', 'titel', 'url', 'inhalt', 'publishedAt')
        const eintraege = zeilen
            // LIKE findet auch Wortteile («HONEY» in «honeypot») — die Prüfung danach nicht.
            .filter((z) => passtZuProjekt(`${z.titel || ''}\n${z.inhalt || ''}`, { name, basis }))
            .map((z) => ({
                titel: z.titel, url: z.url, zeit: Number(z.publishedAt) || null,
                quelle: nachId.get(z.sourceId)?.name || '', herkunft: 'eigene',
            }))
        return { zustand: 'ok', eintraege }
    } catch (e) {
        logWarn('coin-radar', `Projekt-Lage: eigene Meldungen ${basis}: ${e.message}`)
        return { zustand: 'fehler', fehler: 'Eigene Meldungen nicht lesbar', eintraege: [] }
    }
}

// ── KI-Recherche ─────────────────────────────────────────────────────────

/** Modell der Nachrichten-Recherche; trägt das Feld den DeepSeek-Weg, hier immer Perplexity (wie Flash-News). */
async function rechercheZugang(deps) {
    const knex = deps.knex || getKnex()
    const s = await knex('settings').select('radarNewsRechercheModell').where('id', 1).first().catch(() => null)
    const feld = String(s?.radarNewsRechercheModell || '')
    const modell = feld && !feld.startsWith('deepseek') ? feld : 'sonar'
    const { ladeLlmConfig } = deps.llm || await import('../llm.js')
    const cfg = await ladeLlmConfig({ provider: 'perplexity', model: modell }).catch(() => ({ apiKey: '' }))
    return { modell, apiKey: cfg.apiKey || '' }
}

const kiKey = (basis) => `coinlage_ki|${basis}`

async function gespeicherteRecherche(basis, deps, jetzt) {
    const alt = await leseCache(deps.knex || getKnex(), kiKey(basis), KI_TTL_MS, jetzt)
    return alt ? { ...alt.daten, alterMs: Math.max(0, jetzt - alt.ts) } : null
}

/**
 * Die kostenlose Lage eines Coins plus die gespeicherte Recherche.
 * @param {string} symbol
 * @param {object} [deps]  einspeisbar — nur für Tests (`knex`, `coinInfo`, `holeText`, `erlaubt`, `artenEntfernt`, `llm`, `jetzt`)
 */
export async function holeLage(symbol, deps = {}) {
    const jetzt = deps.jetzt || Date.now()
    const such = await suchbegriff(symbol, deps)
    const [gn, eigene, recherche, zugang] = await Promise.all([
        googleNews(such, deps, jetzt),
        eigeneMeldungen(such, deps, jetzt),
        gespeicherteRecherche(such.basis, deps, jetzt).catch(() => null),
        rechercheZugang(deps).catch(() => ({ apiKey: '' })),
    ])
    const eintraege = fasseZusammen([...gn.eintraege, ...eigene.eintraege], { jetzt })
    const warnungen = zaehleWarnungen(eintraege)
    return {
        symbol,
        basis: such.basis,
        name: such.name,
        cgId: such.cgId,
        suchbegriff: such.begriff,
        cgAus: such.cgAus,
        googleNews: { zustand: gn.zustand, aus: gn.aus || null, fehler: gn.fehler || '', anzahl: gn.eintraege.length, stand: gn.stand || null },
        eigene: { zustand: eigene.zustand, fehler: eigene.fehler || '', anzahl: eigene.eintraege.length },
        eintraege,
        warnungen,
        warnAnzahl: Object.values(warnungen).reduce((a, b) => a + b, 0),
        recherche: {
            moeglich: Boolean(zugang.apiKey) && Boolean(such.begriff),
            grund: !zugang.apiKey ? 'ohneSchluessel' : (!such.begriff ? 'ohneName' : ''),
            ergebnis: recherche,
        },
        stand: jetzt,
    }
}

const kiLaufend = new Map()
const kiFehler = new Map()   // Basis → {ts, meldung}

/**
 * KI-Recherche starten (kostet). Nur über POST, nur per Knopf.
 * @returns {Promise<object>} das gespeicherte Ergebnis mit `alterMs: 0`
 */
export async function starteRecherche(symbol, deps = {}) {
    const jetzt = deps.jetzt || Date.now()
    const basis = basisVon(symbol)
    if (kiLaufend.has(basis)) return kiLaufend.get(basis)
    const fehl = kiFehler.get(basis)
    if (fehl && jetzt - fehl.ts < SPERRE_MS) {
        throw Object.assign(new Error(`${fehl.meldung} — nächster Versuch in ${Math.ceil((SPERRE_MS - (jetzt - fehl.ts)) / 1000)} s`), { status: 429 })
    }
    const lauf = (async () => {
        const such = await suchbegriff(symbol, deps)
        if (!such.begriff) throw Object.assign(new Error('Für dieses Kürzel ist kein Projektname bekannt'), { status: 400 })
        const zugang = await rechercheZugang(deps)
        if (!zugang.apiKey) throw Object.assign(new Error('Kein Perplexity-Schlüssel hinterlegt (Einstellungen › KI)'), { status: 400 })
        const recherche = deps.rechercheThema || (await import('../news-recherche.js')).rechercheThema
        const { merkeKiGuthaben, istGuthabenFehler } = deps.llm || await import('../llm.js')
        let r
        try {
            r = await recherche({
                thema: such.basis,
                frage: rechercheFrage({ name: such.name, basis: such.basis, heute: new Date(jetzt) }),
                apiKey: zugang.apiKey,
                modell: zugang.modell,
                timeoutMs: 90000,
                // Kein Aktualitätsfilter: Perplexity kennt «Jahr» nicht sicher; der Zeitraum steht in der Frage.
                aktualitaet: '',
                ausloeser: 'manuell',
                funktion: 'coin-lage',
            })
            merkeKiGuthaben?.('perplexity')?.catch?.(() => { })
        } catch (e) {
            if (istGuthabenFehler?.(e.message)) await merkeKiGuthaben('perplexity', e.message).catch(() => { })
            throw e
        }
        const gelesen = leseRecherche(r.text, r.citations, r.quellenDaten)
        const ergebnis = {
            ...gelesen,
            name: such.name, basis: such.basis, modell: zugang.modell,
            kostenUsd: Number(r.kostenUsd) || 0, erstelltAm: jetzt, kiGeneriert: true,
        }
        await schreibeCache(deps.knex || getKnex(), kiKey(such.basis), ergebnis, jetzt)
        kiFehler.delete(basis)
        return { ...ergebnis, alterMs: 0 }
    })()
    kiLaufend.set(basis, lauf)
    try {
        return await lauf
    } catch (e) {
        if (!e.status || e.status >= 500) kiFehler.set(basis, { ts: Date.now(), meldung: String(e.message || 'Fehler').slice(0, 200) })
        throw e
    } finally {
        kiLaufend.delete(basis)
    }
}

/** Nur für Selbsttests. */
export function _vergiss() {
    gnLaufend.clear()
    kiLaufend.clear()
    kiFehler.clear()
}
