/**
 * Coin-Ansicht, Karte «Projekt-Lage» — der Teil ohne Netz und ohne Datenbank
 * (`__selftest-lage.mjs`).
 *
 * WARUM ES DIE KARTE GIBT. Hivemapper (HONEY) stand in der Ansicht mit guter
 * Projektnote da; dass die Bee-App seit August 2026 in USDC statt in HONEY
 * auszahlt und den Vertrag mit der Hivemapper Foundation gekündigt hat — der
 * eigentliche Grund für −84 % in einem Jahr —, sagte keine Karte. Stammdaten
 * (CoinGecko) beschreiben, was ein Projekt sein WILL; was sich geändert hat,
 * steht in den Meldungen. Diese Karte sammelt sie und hebt hervor, was den
 * Nutzen des Tokens berührt.
 *
 *   googleNewsUrl        Suchadresse der Google-News-RSS-Suche (ein Jahr)
 *   leseGoogleNews       RSS → Meldungen, Titel ohne angehängte « - Quelle»
 *   bereinigeTitel       dasselbe für einen einzelnen Titel
 *   ordneEin             Schlagzeile → Warnsignal-Arten (en + de)
 *   passtZuProjekt       trifft ein Text das Projekt (Name, eindeutiges Kürzel)?
 *   symbolEindeutig      taugt das Kürzel allein als Suchwort?
 *   fasseZusammen        Dubletten weg, Warnungen zuerst behalten, nach Datum
 *   rechercheFrage       die feste Frage an die KI-Recherche
 *   leseRecherche        deren Antwort → {befunde, fazit, quellen} (auch kaputt)
 *
 * Die Karte beschreibt. Ein Warnsignal heisst «dazu gibt es eine Meldung mit
 * diesem Wortlaut», nicht «das Projekt ist schlecht» — und schon gar keine
 * Empfehlung.
 */

import { leseFeed } from '../feed-parser.js'
import { bloeckeVon, elementInhalt, ohneTags } from '../html-zerlegen.js'
import { ohneUnsichtbares, ohneUnsichtbaresFuerJson, saeubereJson } from '../../shared/unsichtbar.js'

const TAG_MS = 86_400_000

/** Wie weit die Karte zurückblickt. */
export const LAGE_TAGE = 365
/** So viele Meldungen zeigt die Karte höchstens. */
export const LAGE_MAX = 15

// ── Suche ────────────────────────────────────────────────────────────────

/**
 * Adresse der Google-News-RSS-Suche nach einem Projektnamen, ein Jahr zurück.
 * Anführungszeichen im Namen fallen weg — sie würden die Phrasensuche brechen.
 * @param {string} begriff  Projektname (oder ein eindeutiges Kürzel)
 * @param {{zusatz?: string}} [opt]  z. B. «crypto», wenn nur das Kürzel bekannt ist
 */
export function googleNewsUrl(begriff, { zusatz = '' } = {}) {
    const rein = String(begriff || '').replace(/["“”„«»]/g, ' ').replace(/\s+/g, ' ').trim()
    if (!rein) return ''
    const q = `"${rein}"${zusatz ? ` ${zusatz}` : ''} when:1y`
    return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`
}

// ── Titel ────────────────────────────────────────────────────────────────

/**
 * Google News hängt die Quelle an den Titel: «Titel - Fortune». Die Quelle
 * steht separat (`<source>`); im Titel ist sie doppelt.
 *
 * Kennt man die Quelle, fällt genau sie weg. Sonst nur ein kurzes letztes
 * Glied (bis 40 Zeichen, höchstens sechs Wörter) — ein Gedankenstrich mitten
 * in einer echten Schlagzeile soll stehen bleiben.
 *
 * @returns {{titel: string, quelle: string}}
 */
export function bereinigeTitel(roh, quelle = '') {
    const titel = String(roh || '').replace(/\s+/g, ' ').trim()
    const q = String(quelle || '').replace(/\s+/g, ' ').trim()
    if (q) {
        for (const trenner of [' - ', ' – ', ' — ', ' | ']) {
            if (titel.toLowerCase().endsWith((trenner + q).toLowerCase())) {
                return { titel: titel.slice(0, titel.length - trenner.length - q.length).trim(), quelle: q }
            }
        }
        return { titel, quelle: q }
    }
    const i = titel.lastIndexOf(' - ')
    if (i > 0) {
        const rest = titel.slice(i + 3).trim()
        if (rest && rest.length <= 40 && rest.split(/\s+/).length <= 6) return { titel: titel.slice(0, i).trim(), quelle: rest }
    }
    return { titel, quelle: '' }
}

/**
 * Die Antwort der Google-News-RSS-Suche lesen. Rein.
 * @returns {{titel, url, zeit, quelle, herkunft: 'googleNews'}[]}
 */
export function leseGoogleNews(xml) {
    const eintraege = leseFeed(xml)
    // Die Quelle steht in `<source url="…">Name</source>` — `leseFeed` kennt das
    // Feld nicht. Zugeordnet über den Verweis, der je Eintrag eindeutig ist.
    const quelleJeLink = new Map()
    for (const block of bloeckeVon(String(xml || ''), 'item', 200)) {
        const link = entities(elementInhalt(block, 'link') || '').trim()
        const quelle = entities(ohneTags(elementInhalt(block, 'source') || '', '')).trim()
        if (link) quelleJeLink.set(link, quelle)
    }
    return eintraege.map((e) => {
        const { titel, quelle } = bereinigeTitel(e.titel, quelleJeLink.get(e.link) || '')
        return { titel, url: nurHttp(e.link), zeit: e.zeit, quelle, herkunft: 'googleNews' }
    }).filter((e) => e.titel && e.url)
}

function entities(s) {
    return String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
        .replace(/&apos;|&#39;/g, "'").replace(/&amp;/g, '&')
}

/** Nur http(s) — ein `javascript:`-Verweis aus einem Feed wird nie ein Link. */
export function nurHttp(url) {
    const u = String(url || '').trim()
    return /^https?:\/\/[^\s]+$/i.test(u) ? u : ''
}

// ── Warnsignale ──────────────────────────────────────────────────────────

/**
 * Warnmuster je Art, englisch und deutsch. Reihenfolge = Vorrang, wenn ein
 * Titel mehrere trifft (`art` ist die erste, `arten` alle).
 *
 * Bewusst eng: jede Art verlangt ein Wort, das in Kurskommentaren nicht
 * zufällig vorkommt. «Token-Zweck» ist die Art, um die es bei Hivemapper ging
 * — Auszahlung in Stablecoins statt im eigenen Token, Ersatz, Umzug, Ende von
 * Verträgen.
 */
export const WARNMUSTER = {
    sicherheit: [
        /\b(hack(s|ed|er|ers)?|exploit(s|ed)?|drain(s|ed|er)?|rug[- ]?pull(s|ed)?|rugged|stolen|breach(es|ed)?|vulnerabilit(y|ies))\b/i,
        /\b(gehackt|hackerangriff|angriff|gestohlen|sicherheitslücke|diebstahl)\b/i,
        /\bRug\b/,
    ],
    delisting: [
        /\bdelist(s|ed|ing)?\b/i,
        /\b(remov(e|es|ed|al|ing)|drop(s|ped)?)\b[^.]{0,40}\b(listing|trading pairs?|from (binance|coinbase|okx|bybit|kraken|upbit|bitget|kucoin|gate))\b/i,
        /\bmonitoring tag\b/i,
        /\bsuspend(s|ed|ing)?\b[^.]{0,30}\b(trading|deposits?|withdrawals?)\b/i,
        /\b(dekotier\w*|vom handel genommen|handel (wird )?eingestellt)\b/i,
    ],
    recht: [
        /\bSEC\b|\bCFTC\b|\bDOJ\b|\bFINMA\b|\bBaFin\b/,
        /\b(lawsuits?|sued|sues|suing|class action|indict(ed|ment)?|charged with|fraud|subpoena|wells notice|bankrupt(cy)?|insolven(t|cy)|chapter 11)\b/i,
        /\b(klage|verklagt|anklage|konkurs|insolvenz|betrug|strafverfahren)\b/i,
    ],
    tokenZweck: [
        // Auszahlung/Belohnung in Stablecoin statt im eigenen Token
        /\b(rewards?|payouts?|payments?|pays?|paid|paying|auszahl\w*|belohnung\w*|vergütung\w*)\b[^.]{0,60}\b(usdc|usdt|stablecoins?|dollars?|dollar)\b/i,
        /\b(usdc|usdt|stablecoins?)\b[^.]{0,40}\b(instead of|rather than|statt|anstelle)\b/i,
        /\bno longer\b|\bnicht mehr\b/i,
        /\breplac(e|es|ed|ing|ement)\b[^.]{0,40}\btokens?\b|\btokens?\b[^.]{0,40}\breplac(e|es|ed|ing|ement)\b/i,
        /\b(token[- ]?)?migrat(e|es|ed|ing|ion)\b|\bmigration\b/i,
        /\btoken[- ]?swap\b|\bswap\b[^.]{0,30}\bnew tokens?\b|\btokentausch\b|\bumtausch\b/i,
        /\brebrand(s|ed|ing)?\b|\bumbenenn\w*|\bneuer name\b/i,
        /\b(sunset(s|ting)?|discontinu(e|es|ed|ing)|shut(s|ting)? down|shutdown|wind(s|ing)? down|eingestellt|abgeschaltet)\b/i,
        /\bterminat(e|es|ed|ing|ion)\b/i,
        /\b(ends?|ended|ending|cancel(s|led|ed|ing)?|exits?)\b[^.]{0,40}\b(agreement|partnership|contract|deal)\b/i,
        /\b(gekündigt|kündig\w*)\b|\bbeendet\b[^.]{0,40}\b(vertrag|partnerschaft|zusammenarbeit)\b/i,
    ],
    angebot: [
        /\b(token )?unlock(s|ed|ing)?\b|\bvesting\b|\bcliff\b/i,
        /\binflation(ary)?\b|\bemission(s)?\b|\bdilut(e|es|ed|ion)\b|\bsupply (increase|expansion)\b/i,
        /\b(entsperr\w*|freischalt\w*|verwässer\w*)\b/i,
    ],
}

export const WARNARTEN = Object.keys(WARNMUSTER)

/** Rot = trifft den Token selbst; gelb = beobachten. */
export const SCHWERE = { sicherheit: 'rot', delisting: 'rot', tokenZweck: 'rot', recht: 'gelb', angebot: 'gelb' }

/**
 * Welche Warnsignale trägt eine Schlagzeile?
 * @returns {{art: string|null, arten: string[]}}
 */
export function ordneEin(titel) {
    const t = String(titel || '')
    const arten = WARNARTEN.filter((art) => WARNMUSTER[art].some((re) => re.test(t)))
    return { art: arten[0] || null, arten }
}

// ── Treffer aufs Projekt ─────────────────────────────────────────────────

/**
 * Kürzel, die zugleich gewöhnliche Wörter oder Abkürzungen sind. Als
 * alleiniges Suchwort lieferten sie Meldungen über etwas ganz anderes
 * («HONEY» ist auch Honig, «ONE» auch eins).
 */
const MEHRDEUTIG = new Set(`
AND THE FOR NEW NOW ALL ANY ONE TWO TEN BIG RED SKY SUN GAS OIL GOLD FIRE BLUE
CAT DOG DOGS DUCK APE BAT ACE ARK BAND BOND EDGE FUN GOAT HOOK KEY LINK LIT
MAGIC MASK MEME MOVE NEAR ORDER PEOPLE PUMP REAL RARE SAFE SAGA SAND SOUL
TRUMP TRUTH WIN HONEY HOME HIGH POWER QUICK SIGN WAVE WAVES MAJOR EPIC BANK
COOKIE DEGEN CHESS PROM RAY RUNE TON TRU UMA UNI USD USDC USDT NOT AI AGI
BIT COIN TOKEN CRYPTO CEO ETF FED IPO API APP NFT DAO WEB DEFI LAYER OPEN
`.split(/\s+/).filter(Boolean))

/** Taugt das Kürzel allein als Suchwort? Mindestens drei Zeichen, kein gewöhnliches Wort. */
export function symbolEindeutig(basis) {
    const s = String(basis || '').toUpperCase().trim()
    if (s.length < 3 || /^\d+$/.test(s) || !/^[A-Z0-9]+$/.test(s)) return false
    return !MEHRDEUTIG.has(s)
}

const regexText = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Trifft ein Text das Projekt? Der Name ohne Rücksicht auf Gross/Klein, als
 * ganzes Wort; das Kürzel nur in Grossbuchstaben (oder mit `$`), nur wenn es
 * eindeutig ist, und nicht in einer Schlagzeile ganz in Grossbuchstaben —
 * dort ist jedes Wort gross.
 */
export function passtZuProjekt(text, { name = '', basis = '' } = {}) {
    const t = String(text || '')
    if (!t) return false
    const n = String(name || '').trim()
    if (n.length >= 3) {
        const re = new RegExp(`(^|[^\\p{L}\\p{N}])${regexText(n)}([^\\p{L}\\p{N}]|$)`, 'iu')
        if (re.test(t)) return true
    }
    const b = String(basis || '').toUpperCase().trim()
    if (!symbolEindeutig(b)) return false
    const buchstaben = t.replace(/[^A-Za-z]/g, '')
    const gross = buchstaben.replace(/[^A-Z]/g, '').length
    if (buchstaben.length >= 12 && gross / buchstaben.length > 0.8) return false
    return new RegExp(`(^|[^A-Za-z0-9])\\$?${regexText(b)}([^A-Za-z0-9]|$)`).test(t)
}

// ── Zusammenfassen ───────────────────────────────────────────────────────

/** Schlüssel für Dubletten: dieselbe Meldung bei zwei Verlagen oder zweimal im Feed. */
export function titelSchluessel(titel) {
    return String(titel || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, ' ').trim().split(' ').slice(0, 12).join(' ')
}

/**
 * Meldungen beider Herkünfte zu einer Liste: einordnen, Dubletten
 * zusammenfassen (gleicher Verweis oder gleicher Titelanfang — die erste
 * gewinnt, weitere Quellen werden mitgezählt), Älteres als `tage` weg, auf
 * `max` kürzen — Warnungen zuerst behalten, denn um sie geht es —, neueste oben.
 *
 * @param {Array<{titel, url, zeit, quelle, herkunft}>} roh
 */
export function fasseZusammen(roh, { max = LAGE_MAX, tage = LAGE_TAGE, jetzt = Date.now() } = {}) {
    const ab = jetzt - tage * TAG_MS
    const nachSchluessel = new Map()
    const nachUrl = new Map()
    const liste = []
    for (const e of Array.isArray(roh) ? roh : []) {
        const titel = ohneUnsichtbares(String(e?.titel || '')).replace(/\s+/g, ' ').trim()
        const url = nurHttp(e?.url)
        if (!titel || !url) continue
        const zeit = Number.isFinite(Number(e?.zeit)) && Number(e.zeit) > 0 ? Number(e.zeit) : null
        if (zeit !== null && (zeit < ab || zeit > jetzt + TAG_MS)) continue
        const schluessel = titelSchluessel(titel)
        const da = nachUrl.get(url) || (schluessel ? nachSchluessel.get(schluessel) : null)
        if (da) {
            const quelle = String(e?.quelle || '').trim()
            if (quelle && quelle !== da.quelle && !da.weitere.includes(quelle)) da.weitere.push(quelle)
            if (zeit !== null && (da.zeit === null || zeit < da.zeit)) da.zeit = zeit   // die erste Meldung zählt
            continue
        }
        const { art, arten } = ordneEin(titel)
        const eintrag = {
            titel: titel.slice(0, 300), url, zeit, quelle: String(e?.quelle || '').trim().slice(0, 80),
            herkunft: e?.herkunft === 'eigene' ? 'eigene' : 'googleNews',
            art, arten, schwere: art ? SCHWERE[art] : null, weitere: [],
        }
        liste.push(eintrag)
        nachUrl.set(url, eintrag)
        if (schluessel) nachSchluessel.set(schluessel, eintrag)
    }
    const nachDatum = (a, b) => (b.zeit ?? 0) - (a.zeit ?? 0)
    const warn = liste.filter((e) => e.art).sort(nachDatum)
    const rest = liste.filter((e) => !e.art).sort(nachDatum)
    return [...warn.slice(0, max), ...rest.slice(0, Math.max(0, max - warn.length))].sort(nachDatum)
}

/** Wie viele Meldungen je Warnart. */
export function zaehleWarnungen(eintraege) {
    const z = {}
    for (const e of eintraege || []) if (e?.art) z[e.art] = (z[e.art] || 0) + 1
    return z
}

// ── KI-Recherche ─────────────────────────────────────────────────────────

/** Arten der Recherche-Befunde: die Warnarten plus zwei neutrale. */
export const BEFUND_ARTEN = ['tokenZweck', 'delisting', 'sicherheit', 'recht', 'angebot', 'partner', 'sonstiges']

/** Die feste Frage. Englischer Suchraum, deutsche Antwort. */
export function rechercheFrage({ name = '', basis = '', heute = new Date() } = {}) {
    const wer = name && basis && name.toUpperCase() !== basis.toUpperCase() ? `${name} (${basis})` : (name || basis)
    const stichtag = new Date(heute).toISOString().slice(0, 10)
    return `Heute ist ${stichtag}. Was hat sich in den letzten 12 Monaten am Krypto-Projekt ${wer} geändert? `
        + 'Besonders: am Nutzen des Tokens (Auszahlungen oder Belohnungen in einem anderen Token oder Stablecoin, Burn/Mint, '
        + 'Tokenomics, Ersatz oder Migration des Tokens, Rebrand), an Verträgen und Partnern (Stiftung, Firma, App, Kündigungen), '
        + 'an Börsen-Listungen (Delistings, neue Listungen), an der Sicherheit (Hacks, Exploits) und an der Rechtslage '
        + '(Behörden, Klagen, Konkurs). Nur belegte Tatsachen mit Datum, nüchtern, keine Prognose, keine Anlageberatung.\n'
        + 'Antworte NUR mit einem JSON-Objekt, ohne Text davor oder danach, auf Deutsch:\n'
        + '{"befunde": [{"art": "tokenZweck|delisting|sicherheit|recht|angebot|partner|sonstiges", '
        + '"text": "ein Satz", "datum": "JJJJ-MM-TT oder JJJJ-MM", "quelleUrl": "https://…"}], '
        + '"fazit": "1–2 Sätze: was sich für den Token geändert hat"}\n'
        + 'Höchstens 10 Befunde, neueste zuerst. Findest du nichts Belegtes, gib eine leere Liste und sag das im Fazit.'
}

const ART_SYNONYME = {
    token: 'tokenZweck', tokenzweck: 'tokenZweck', tokennutzen: 'tokenZweck', tokenomics: 'tokenZweck', nutzen: 'tokenZweck',
    listung: 'delisting', listing: 'delisting', boerse: 'delisting', börse: 'delisting', delisting: 'delisting',
    sicherheit: 'sicherheit', security: 'sicherheit', hack: 'sicherheit',
    recht: 'recht', legal: 'recht', regulierung: 'recht', regulation: 'recht',
    angebot: 'angebot', supply: 'angebot', unlock: 'angebot',
    partner: 'partner', vertrag: 'partner', vertraege: 'partner', verträge: 'partner', partnerschaft: 'partner',
}

function artAus(w) {
    const s = String(w || '').trim()
    if (BEFUND_ARTEN.includes(s)) return s
    return ART_SYNONYME[s.toLowerCase()] || 'sonstiges'
}

/** Erstes JSON-Objekt aus einer Antwort (Modelle setzen gern Zäune oder Sätze drumherum). */
function jsonObjekt(text) {
    const roh = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
    const versuche = [roh]
    const von = roh.indexOf('{')
    const bis = roh.lastIndexOf('}')
    if (von !== -1 && bis > von) versuche.push(roh.slice(von, bis + 1))
    for (const v of versuche) {
        for (const kandidat of [v, ohneUnsichtbaresFuerJson(v)]) {
            try {
                const j = JSON.parse(kandidat)
                if (j && typeof j === 'object' && !Array.isArray(j)) return saeubereJson(j)
            } catch { /* nächster Versuch */ }
        }
    }
    return null
}

const ohneBelegnummern = (s) => String(s || '').replace(/\[\d{1,2}\](\[\d{1,2}\])*/g, '').replace(/\s+/g, ' ').trim()

/**
 * Antwort der Recherche lesen. Rein.
 *
 * Belege: `quelleUrl` nur https; steht dort eine Nummer («[2]», «2») oder
 * fehlt sie und der Text trägt eine Belegnummer, gilt das Zitat dieser Nummer.
 * Ist das JSON kaputt, bleibt der Text als `rohText` (ohne Formatierung) —
 * bezahlt ist bezahlt, und die Quellen stimmen trotzdem.
 *
 * @param {string} text        Antworttext der KI
 * @param {string[]} citations Zitate der Suche
 * @param {Map<string,string>} [quellenDaten]  URL → Datum
 * @returns {{befunde, fazit, quellen, kaputt: boolean, rohText: string}}
 */
export function leseRecherche(text, citations = [], quellenDaten = new Map()) {
    const zitate = (Array.isArray(citations) ? citations : []).map((u) => String(u || '')).filter((u) => /^https:\/\//i.test(u))
    const quellen = zitate.slice(0, 12).map((url) => ({ url, datum: String(quellenDaten?.get?.(url) || '').slice(0, 10) }))
    const belegNr = (s) => {
        const m = String(s || '').match(/\[(\d{1,2})\]/) || String(s || '').match(/^\s*(\d{1,2})\s*$/)
        const n = m ? Number(m[1]) : 0
        return n >= 1 && n <= zitate.length ? zitate[n - 1] : ''
    }
    const j = jsonObjekt(text)
    if (!j || (!Array.isArray(j.befunde) && typeof j.fazit !== 'string')) {
        const rohText = ohneUnsichtbares(String(text || '')).replace(/```(?:json)?/gi, '').replace(/[*#_`>]/g, '').trim().slice(0, 1500)
        return { befunde: [], fazit: '', quellen, kaputt: true, rohText }
    }
    const befunde = (Array.isArray(j.befunde) ? j.befunde : []).map((b) => {
        const roherText = String(b?.text || '')
        const satz = ohneBelegnummern(roherText).slice(0, 400)
        const url = String(b?.quelleUrl || b?.quelle || b?.url || '').trim()
        const quelleUrl = /^https:\/\/\S+$/i.test(url) ? url : (belegNr(url) || belegNr(roherText))
        const d = String(b?.datum || '').trim()
        const datum = /^\d{4}-\d{2}(-\d{2})?$/.test(d) ? d : ''
        return { art: artAus(b?.art), text: satz, datum, quelleUrl }
    }).filter((b) => b.text).slice(0, 12)
    return {
        befunde,
        fazit: ohneBelegnummern(j.fazit).slice(0, 500),
        quellen,
        kaputt: false,
        rohText: '',
    }
}
