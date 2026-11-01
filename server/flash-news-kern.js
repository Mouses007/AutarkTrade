/**
 * Flash-News im Chart — der reine Teil, ohne Netz und ohne Datenbank.
 *
 * Ein Klick im Chart fragt X (Grok) und das Web (Perplexity), was zum Coin in
 * der letzten Stunde (6 h, 24 h) gemeldet wurde; ein Modell listet es knapp
 * auf. Dieses Modul baut die nummerierte Quellenliste, die Eingabe für das
 * Modell und prüft dessen Antwort.
 *
 * Die eine Regel, an der alles hängt: Das Modell nennt Quellen nur als
 * NUMMER aus der Liste, die URL setzt der Code ein. Ein Modell, das eine
 * Meldung zusammenfasst, schreibt sonst gern eine plausible, aber erfundene
 * Adresse dazu — und ein Link ist genau das, worauf man in Eile klickt.
 * Ein Punkt ohne gültige Quellennummer fliegt deshalb ganz heraus: was sich
 * nicht belegen lässt, ist in einer Eilmeldung schlimmer als nichts.
 */
import { normSymbol } from '../shared/symbol.js'
import { pruefeEinordnung } from './coin-radar/einordnung.js'

export const FLASH_STUNDEN = [1, 6, 24]
export const MAX_X = 25
export const MAX_WEB = 15
export const MAX_PUNKTE = 8

/**
 * Den Coin hinter einem Futures-Symbol: `1000PEPEUSDT` → PEPE, `BTCUSDC` → BTC.
 * Gesucht wird nach dem Coin, nicht nach dem Kontrakt — auf X schreibt niemand
 * „1000PEPEUSDT".
 */
export function basisCoin(symbol) {
    let s = normSymbol(symbol)
    s = s.replace(/(USDT|USDC|BUSD|FDUSD|USD)$/, '')
    s = s.replace(/^(1000000|100000|10000|1000|1M)(?=[A-Z])/, '')
    return s
}

function domain(url) {
    try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' }
}

function sauberUrl(u) {
    const s = String(u || '').trim()
    return /^https:\/\/[^\s]+$/.test(s) ? s : ''
}

const X_HOST = /^(?:[a-z0-9-]+\.)*(?:x|twitter)\.com$/
const VERFOLGUNG = /^(?:utm_.*|fbclid|gclid|ref)$/i

/**
 * Vergleichsschlüssel einer Quelle. Rein.
 *
 * Ein Post auf x.com oder twitter.com (auch www./mobile.) ist dieselbe
 * Meldung, egal unter welcher Adresse: Schlüssel ist die Post-ID. Jede andere
 * Adresse bleibt, was sie ist — ohne Anker und Verfolgungs-Parameter (utm_*,
 * fbclid, gclid, ref), die übrigen Parameter sortiert, nur der Host klein.
 * Bis 01.11.2026 fiel der ganze Abfrageteil weg und alles wurde klein
 * geschrieben: `watch?v=AAA` und `watch?v=BBB` waren eine Quelle, der Punkt zu
 * Video B verlinkte Video A; eine Mastodon-Adresse `statuses/<id>` galt als
 * X-Post gleicher ID.
 */
function urlSchluessel(u) {
    let url
    try { url = new URL(u) } catch { return 'w:' + u }
    const id = X_HOST.test(url.hostname) && url.pathname.match(/\/status(?:es)?\/(\d+)/)
    if (id) return 'x:' + id[1]
    const parameter = [...url.searchParams].filter(([k]) => !VERFOLGUNG.test(k))
        .sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0))
    const abfrage = new URLSearchParams(parameter).toString()
    return 'w:' + url.host + url.pathname.replace(/\/$/, '') + (abfrage ? '?' + abfrage : '')
}

/**
 * Eine nummerierte, entdoppelte Quellenliste aus X-Posts und Web-Fundstellen.
 *
 * @param {object} p
 * @param {Array<{handle?,url,text?,zeit?}>} p.xPosts
 * @param {string[]} p.webZitate   Zitat-URLs von Perplexity, in IHRER Reihenfolge
 * @param {Map<string,string>} [p.webDaten]  URL → Datum (YYYY-MM-DD), soweit bekannt
 * @returns {{quellen:Array<{nr,url,titel,art,zeit,text}>, webNr:Map<number,number>}}
 *   `webNr`: Perplexitys eigene Nummer (1-basiert) → unsere Nummer
 */
export function quellenListe({ xPosts = [], webZitate = [], webDaten = new Map() } = {}) {
    const quellen = []
    const gesehen = new Map()   // Schlüssel → nr
    const webNr = new Map()
    const neu = (q) => {
        const k = urlSchluessel(q.url)
        if (gesehen.has(k)) return gesehen.get(k)
        const nr = quellen.length + 1
        quellen.push({ nr, ...q })
        gesehen.set(k, nr)
        return nr
    }
    let x = 0
    for (const p of xPosts) {
        if (x >= MAX_X) break
        const url = sauberUrl(p?.url)
        if (!url) continue
        const text = String(p?.text || '').replace(/\s+/g, ' ').trim()
        const handle = String(p?.handle || '').replace(/^@/, '')
        const vorher = quellen.length
        neu({ url, art: 'x', titel: handle ? '@' + handle : 'X', zeit: Number(p?.zeit) || null, text: text.slice(0, 500) })
        if (quellen.length > vorher) x++
    }
    let w = 0
    webZitate.forEach((roh, i) => {
        const url = sauberUrl(roh)
        if (!url || w >= MAX_WEB) return
        const vorher = quellen.length
        const datum = webDaten.get?.(roh) || ''
        const nr = neu({ url, art: 'web', titel: domain(url), zeit: datum ? Date.parse(datum) || null : null, text: '' })
        webNr.set(i + 1, nr)
        if (quellen.length > vorher) w++
    })
    return { quellen, webNr }
}

/** Perplexitys Belegnummern `[3]` im Text auf unsere Nummern umschreiben; unbekannte fallen weg. */
export function webTextUmnummerieren(text, webNr) {
    return String(text || '').replace(/\[(\d{1,3})\]/g, (_, n) => {
        const nr = webNr.get(Number(n))
        return nr ? `[${nr}]` : ''
    })
}

export function systemText(englisch = false) {
    if (englisch) {
        return `You summarise breaking news about ONE crypto coin for a futures trader who just saw an unusual move on the chart.

Rules, without exception:
- Only what the numbered sources say. Every point cites at least one source number; no number, no point.
- Cite sources ONLY as numbers from the list ("quellen": [2, 5]). Never write a URL.
- At most ${MAX_PUNKTE} points, newest and most market-relevant first: listings/delistings, hacks/exploits, unlocks, exchange announcements, regulation, partnerships, whale/ETF flows, rumours (marked as rumour).
- Skip pure price commentary, chart analysis, giveaways, shilling and posts without information.
- NO forecast, NO price target, NO trading advice.
- If nothing relevant happened, say so: "lage": "nichts".

Answer as JSON only: {"lage": "etwas"|"nichts", "kurz": "one sentence", "punkte": [{"zeit": "HH:MM or empty", "text": "max. 2 sentences", "quellen": [1]}]}`
    }
    return `Du fasst Eilmeldungen zu EINEM Krypto-Coin für einen Futures-Händler zusammen, der gerade eine ungewöhnliche Bewegung im Chart sieht.

Regeln, ausnahmslos:
- Nur, was in den nummerierten Quellen steht. Jeder Punkt nennt mindestens eine Quellennummer; ohne Nummer kein Punkt.
- Quellen NUR als Nummern aus der Liste nennen ("quellen": [2, 5]). Schreibe nie eine URL.
- Höchstens ${MAX_PUNKTE} Punkte, das Neueste und Marktrelevanteste zuerst: Listungen/Delistings, Hacks/Exploits, Token-Unlocks, Börsen-Ankündigungen, Regulierung, Partnerschaften, Wal-/ETF-Ströme, Gerüchte (als Gerücht kennzeichnen).
- Reine Kurskommentare, Chartanalysen, Gewinnspiele, Werbung und Posts ohne Information weglassen.
- KEINE Prognose, KEIN Kursziel, KEINE Handelsempfehlung.
- Ist nichts Relevantes passiert, sag das: "lage": "nichts".

Antworte NUR als JSON: {"lage": "etwas"|"nichts", "kurz": "ein Satz", "punkte": [{"zeit": "HH:MM oder leer", "text": "höchstens 2 Sätze", "quellen": [1]}]}`
}

function uhrzeit(ms, zeitzone) {
    if (!ms) return ''
    try { return new Date(ms).toLocaleString('de-CH', { timeZone: zeitzone || 'UTC', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) } catch { return '' }
}

/** Eingabe für das Modell: Coin, Zeitraum, nummerierte Quellen, die Web-Recherche mit unseren Nummern. */
export function baueEingabe({ symbol, coin, stunden, quellen, webText = '', zeitzone = 'UTC', jetzt = Date.now() }) {
    const zeilen = [
        `Coin: ${coin} (Kontrakt ${symbol})`,
        `Zeitraum: letzte ${stunden} Stunde${stunden === 1 ? '' : 'n'} bis ${uhrzeit(jetzt, zeitzone)} (${zeitzone})`,
        '',
        'Quellen:',
    ]
    for (const q of quellen) {
        const wann = uhrzeit(q.zeit, zeitzone)
        zeilen.push(`[${q.nr}] ${q.art === 'x' ? 'X' : 'Web'} ${q.titel}${wann ? ' · ' + wann : ''}${q.text ? ': ' + q.text : ''}`)
    }
    if (webText) zeilen.push('', 'Web-Recherche (Belege mit den Nummern oben):', webText.slice(0, 4000))
    return zeilen.join('\n')
}

/**
 * Antwort des Modells prüfen.
 *
 * Verworfen werden: Punkte ohne gültige Quellennummer, leere Punkte, Punkte
 * mit Prognose oder Handelsrat (dieselbe Prüfung wie Coin-Radar und
 * Chart-KI). Die Zusammenfassung oben fällt bei einer Prognose weg, die
 * Punkte bleiben — sie sind belegt, der Satz darüber ist nur die Zugabe.
 *
 * @returns {{lage:'etwas'|'nichts', kurz:string, punkte:Array<{zeit,text,quellen:number[]}>, verworfen:Array<{grund,text}>}|null}
 *   null, wenn die Antwort gar kein Objekt ist
 */
export function pruefeFlashAntwort(json, quellen) {
    if (!json || typeof json !== 'object' || Array.isArray(json)) return null
    const gueltig = new Set(quellen.map((q) => q.nr))
    const verworfen = []
    const punkte = []
    for (const p of (Array.isArray(json.punkte) ? json.punkte : [])) {
        const text = String(p?.text || '').replace(/\s+/g, ' ').trim().slice(0, 400)
        if (!text) continue
        const nrn = [...new Set((Array.isArray(p?.quellen) ? p.quellen : []).map(Number).filter((n) => gueltig.has(n)))]
        if (!nrn.length) { verworfen.push({ grund: 'ohneQuelle', text }); continue }
        const pruef = pruefeEinordnung({ text })
        if (!pruef.ok) { verworfen.push({ grund: pruef.grund, text }); continue }
        const zeit = /^\d{1,2}:\d{2}$/.test(String(p?.zeit || '').trim()) ? String(p.zeit).trim() : ''
        punkte.push({ zeit, text, quellen: nrn.slice(0, 5) })
        if (punkte.length >= MAX_PUNKTE) break
    }
    let kurz = String(json.kurz || '').replace(/\s+/g, ' ').trim().slice(0, 300)
    if (kurz && !pruefeEinordnung({ text: kurz }).ok) { verworfen.push({ grund: 'kurzPrognose', text: kurz }); kurz = '' }
    const lage = punkte.length ? 'etwas' : 'nichts'
    return { lage, kurz, punkte, verworfen }
}
