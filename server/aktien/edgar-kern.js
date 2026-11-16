/**
 * EDGAR (Datenbank der US-Börsenaufsicht SEC): Antworten lesen und ordnen.
 * Rein — kein Netz, keine Datenbank. Das Netz steht in `edgar.js`.
 *
 * Was hier entsteht, zeigt die Karte «Einreichungen (SEC)» der Titel-Seite:
 *
 *   boersengang  S-1, S-1/A, F-1, F-1/A (Registrierung) und 424B4 (der
 *                endgültige Börsenprospekt — dort steht die Haltefrist)
 *   angebot      S-3, S-3ASR, F-3 (Regal-Registrierung: die ERLAUBNIS, Aktien
 *                auszugeben) und 424B5/424B3/424B2 (Prospekt-Nachtrag: meist
 *                ein wirkliches Angebot). Ein 424B3 kann auch zu einer Fusion
 *                gehören, 424B2 bei Banken zu Schuldpapieren — gezählt werden
 *                Einreichungen, nicht Kapitalerhöhungen.
 *   insider      Form 4 (Geschäft eines Insiders) und 144 (Anzeige eines
 *                geplanten Verkaufs)
 *   berichte     10-K, 10-Q, 8-K (Ausländer: 20-F, 40-F, 6-K) — nur gezählt
 *
 * Grundsatz wie überall: Unbekanntes bleibt `null`. `data.sec.gov` liefert in
 * `filings.recent` nur die jüngsten rund 1000 Einreichungen; ältere stehen in
 * Zusatzdateien (`filings.files`). Solange die nicht geladen sind, heisst
 * «kein Börsenprospekt gefunden» nicht «es gibt keinen» — `vollstaendig` und
 * `reichtBis` sagen, wie weit der Blick reicht.
 */
import { ohneTags, ohneBloecke } from '../html-zerlegen.js'

const TAG = 86_400_000

export const GRUPPEN = {
    boersengang: ['S-1', 'S-1/A', 'F-1', 'F-1/A', '424B4'],
    angebot: ['S-3', 'S-3/A', 'S-3ASR', 'F-3', 'F-3/A', 'F-3ASR', '424B5', '424B3', '424B2'],
    insider: ['4', '4/A', '144', '144/A'],
    berichte: ['10-K', '10-K/A', '10-Q', '10-Q/A', '8-K', '8-K/A', '20-F', '40-F', '6-K'],
}
const GRUPPE_VON = new Map(Object.entries(GRUPPEN).flatMap(([g, formen]) => formen.map((f) => [f, g])))

/** Höchstens so viele Zeilen je Liste gehen an die Karte. */
const GRENZE = { boersengang: 12, angebot: 25, insider: 15 }
/** Ältere Zusatzdateien werden nur geladen, wenn sie in dieses Fenster reichen. */
export const RUECKBLICK_TAGE = 3 * 365
export const HOECHSTENS_ZUSATZ = 3

/** In welche Gruppe gehört ein Formular? `null` = keine davon. */
export function gruppeVon(form) {
    return GRUPPE_VON.get(String(form || '').trim().toUpperCase()) || null
}

/** Kennung eines Formulars für die Übersetzung: «S-1/A» → `s1a`, «424B4» → `p424b4`, «4» → `n4`
 * (nicht `f4` — das wäre das Formular F-4). */
export function artId(form) {
    const s = String(form || '').toLowerCase().replace(/[^a-z0-9]/g, '')
    if (!s) return null
    return /^424/.test(s) ? `p${s}` : /^\d/.test(s) ? `n${s}` : s
}

/** CIK zehnstellig, wie sie in der Adresse steht; `null`, wenn es keine gültige Zahl ist. */
export function cik10(cik) {
    const n = Number(cik)
    return Number.isInteger(n) && n > 0 && n < 1e10 ? String(n).padStart(10, '0') : null
}

/**
 * Ticker so, wie er verglichen wird: gross, ohne Trennzeichen (BRK-B, BRK.B,
 * BRKB sind dasselbe). `null` bei einem Kurssymbol mit Börsen-Anhang
 * («ASML.AS», «0700.HK») — das ist keine US-Listung, und ein gleich
 * lautender US-Ticker wäre womöglich eine andere Firma.
 */
export function usTicker(symbol) {
    const s = String(symbol || '').trim().toUpperCase()
    if (!s || !/^[A-Z0-9][A-Z0-9.\-]{0,14}$/.test(s)) return null
    // Yahoo trennt Aktienklassen mit «-» (BRK-B); ein Punkt mit zwei oder mehr
    // Zeichen dahinter ist eine Börse, mit einem ein Klassenbuchstabe (BRK.B).
    if (/\.[A-Z0-9]{2,}$/.test(s)) return null
    return s.replace(/[.\-]/g, '') || null
}

/**
 * `company_tickers.json` → Map (Ticker ohne Trennzeichen → { cik, ticker, name }).
 * Die Liste ist nach Börsenwert geordnet; bei gleicher Schreibweise gewinnt der erste Eintrag.
 */
export function tickerVerzeichnis(roh) {
    if (!roh || typeof roh !== 'object') throw new Error('EDGAR: Ticker-Liste in unerwarteter Form')
    const aus = new Map()
    for (const [k, e] of Object.entries(roh)) {
        if (k.startsWith('_') || !e || typeof e !== 'object') continue
        const cik = cik10(e.cik_str)
        const t = usTicker(e.ticker)
        if (!cik || !t || aus.has(t)) continue
        aus.set(t, { cik, ticker: String(e.ticker), name: typeof e.title === 'string' ? e.title : null })
    }
    if (!aus.size) throw new Error('EDGAR: Ticker-Liste leer oder in unerwarteter Form')
    return aus
}

/** «2026-09-17» → Mitternacht UTC in ms; `null`, wenn es kein solches Datum ist. */
export function tagZuMs(text) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text || ''))
    if (!m) return null
    const ms = Date.UTC(+m[1], +m[2] - 1, +m[3])
    return Number.isFinite(ms) ? ms : null
}

/** Adresse des Dokuments bei sec.gov; ohne Hauptdokument die Übersicht der Einreichung. */
export function dokumentLink(cik, zugang, dokument) {
    const c = cik10(cik)
    if (!c || !/^\d{10}-\d{2}-\d{6}$/.test(String(zugang || ''))) return null
    const basis = `https://www.sec.gov/Archives/edgar/data/${Number(c)}/${zugang.replace(/-/g, '')}`
    // Nur harmlose Pfade übernehmen — die Adresse landet als Link in der Oberfläche.
    const d = String(dokument || '')
    return d && /^[A-Za-z0-9_\-./]+$/.test(d) && !d.includes('..') ? `${basis}/${d}` : `${basis}/${zugang}-index.htm`
}

const NICHTSSAGEND = /^(FORM\s+\S+|PRIMARY DOCUMENT|OWNERSHIP DOCUMENT)$/i

/** Spaltenweise Antwort (`filings.recent` oder eine Zusatzdatei) → Zeilen, jüngste zuerst wie geliefert. */
export function zeilenAus(spalten, cik) {
    const form = spalten?.form
    if (!Array.isArray(form)) return []
    const feld = (name, i) => (Array.isArray(spalten[name]) ? spalten[name][i] : undefined)
    const aus = []
    for (let i = 0; i < form.length; i++) {
        const f = String(form[i] || '').trim().toUpperCase()
        const zeit = tagZuMs(feld('filingDate', i))
        if (!f || zeit == null) continue
        const zugang = String(feld('accessionNumber', i) || '')
        const roh = String(feld('primaryDocDescription', i) || '').trim()
        aus.push({
            form: f, art: artId(f), gruppe: gruppeVon(f), zeit,
            zugang,
            // Die SEC nennt als Beschreibung fast immer nur das Formular selbst («424B5», «FORM 4»,
            // «PRIMARY DOCUMENT») — das ist keine. Was das Formular bedeutet, sagt die Oberfläche (`art`).
            beschreibung: roh && !NICHTSSAGEND.test(roh) && roh.toUpperCase() !== f ? roh.slice(0, 160) : null,
            link: dokumentLink(cik, zugang, feld('primaryDocument', i)),
        })
    }
    return aus
}

/**
 * Welche Zusatzdateien lohnen den Abruf? Nur solche, die ins Rückblick-Fenster
 * reichen (dort liegen Börsengang und die Angebote der letzten zwölf Monate
 * einer jungen Firma) — die Archive von NVIDIA seit 1998 bleiben liegen.
 * @returns {string[]} Dateinamen, jüngste zuerst
 */
export function zusatzDateien(roh, jetzt = Date.now()) {
    const ab = jetzt - RUECKBLICK_TAGE * TAG
    return (Array.isArray(roh?.filings?.files) ? roh.filings.files : [])
        .filter((d) => /^CIK\d{10}-submissions-\d{3}\.json$/.test(String(d?.name || '')) && (tagZuMs(d.filingTo) ?? 0) >= ab)
        .sort((a, b) => tagZuMs(b.filingTo) - tagZuMs(a.filingTo))
        .slice(0, HOECHSTENS_ZUSATZ)
        .map((d) => d.name)
}

/**
 * Einreichungen einer Firma ordnen.
 * @param {object} roh       Antwort von `data.sec.gov/submissions/CIK….json`
 * @param {object[]} zusatz  geladene Zusatzdateien (spaltenweise), beliebige Reihenfolge
 * @returns {{firma, boersengang, angebot, insider, berichte, kennzahl, prospekt, vollstaendig, reichtBis}}
 */
export function werteAus(roh, zusatz = [], jetzt = Date.now()) {
    const cik = cik10(roh?.cik)
    if (!cik || !roh?.filings?.recent) throw new Error('EDGAR: Einreichungen in unerwarteter Form')
    const alle = [roh.filings.recent, ...zusatz].flatMap((s) => zeilenAus(s, cik)).sort((a, b) => b.zeit - a.zeit)
    const dateien = Array.isArray(roh.filings.files) ? roh.filings.files.length : 0
    const vollstaendig = zusatz.length >= dateien
    const reichtBis = alle.length ? alle.at(-1).zeit : null
    // Ein Zeitraum ist nur dann ganz gesehen, wenn alles geladen ist oder die älteste geladene Zeile davor liegt.
    const gesehenAb = (ab) => vollstaendig || (reichtBis != null && reichtBis <= ab)

    const von = (g) => alle.filter((z) => z.gruppe === g)
    const karte = (z) => ({ zeit: z.zeit, form: z.form, art: z.art, beschreibung: z.beschreibung, link: z.link })
    const jahr = jetzt - 365 * TAG
    const quartal = jetzt - 90 * TAG

    const boersengang = von('boersengang')
    const angebot = von('angebot')
    const insider = von('insider')
    const berichte = von('berichte')

    const angebote12 = angebot.filter((z) => z.zeit > jahr)
    // Der ÄLTESTE 424B4 ist der Börsenprospekt; jüngere gehören zu späteren Angeboten
    // (Zweitplatzierung nach S-1) und nennen eine andere Haltefrist (Audit FUN-F-014).
    // `boersengang` ist absteigend nach Zeit geordnet.
    const prospekt = boersengang.findLast((z) => z.form === '424B4') || null
    const zaehle = (liste, ab) => {
        const aus = {}
        for (const z of liste) if (z.zeit > ab) aus[z.form] = (aus[z.form] || 0) + 1
        return aus
    }

    return {
        firma: {
            cik,
            name: typeof roh.name === 'string' ? roh.name : null,
            ticker: Array.isArray(roh.tickers) ? roh.tickers.map(String) : [],
            boersen: Array.isArray(roh.exchanges) ? roh.exchanges.filter(Boolean).map(String) : [],
            branche: typeof roh.sicDescription === 'string' && roh.sicDescription ? roh.sicDescription : null,
            uebersicht: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=&dateb=&owner=include&count=40`,
        },
        boersengang: boersengang.slice(0, GRENZE.boersengang).map(karte),
        angebot: angebot.slice(0, GRENZE.angebot).map(karte),
        insider: {
            liste: insider.slice(0, GRENZE.insider).map(karte),
            // Zähler nur, wenn der Zeitraum ganz gesehen ist — sonst wäre «3» in Wahrheit «mindestens 3».
            tage90: gesehenAb(quartal) ? zaehle(insider, quartal) : null,
            monate12: gesehenAb(jahr) ? zaehle(insider, jahr) : null,
        },
        berichte: {
            monate12: gesehenAb(jahr) ? zaehle(berichte, jahr) : null,
            juengster: berichte.length ? karte(berichte[0]) : null,
        },
        kennzahl: {
            angebote12m: gesehenAb(jahr) ? angebote12.length : null,
            juengstesAngebot: angebot.length ? angebot[0].zeit : null,
        },
        // Der Börsenprospekt: Link, Datum der Einreichung. `null` heisst nur bei `vollstaendig` «es gibt keinen».
        prospekt: prospekt ? { zeit: prospekt.zeit, form: prospekt.form, link: prospekt.link, zugang: prospekt.zugang } : null,
        vollstaendig,
        reichtBis,
        anzahl: alle.length,
    }
}

// ── Haltefrist aus dem Prospekttext ───────────────────────────────────────

/**
 * Obergrenze für einen Prospekt. Gemessen an echten 424B4 sind es wenige MB;
 * 40 MB (bis Audit SEC-S-001) hiessen 1,5 s Stillstand schon bei harmlosem HTML.
 */
export const PROSPEKT_HOECHSTENS = 12 * 1024 * 1024

/**
 * HTML → Fliesstext: Tags weg, die gängigen Zeichenverweise aufgelöst, Leerraum zusammengezogen.
 *
 * Zerlegt wird LINEAR über `html-zerlegen.js`. Bis Audit SEC-S-001 standen hier
 * `/<(script|style)[\s\S]*?<\/\1>/gi` und `/<[^>]*>/g` — auf einem Dokument mit
 * vielen `<` ohne `>` quadratisch (400 kB = 53 s Stillstand des Servers).
 */
export function textAusHtml(html) {
    return ohneTags(ohneBloecke(String(html || ''), ['script', 'style'], ' '), ' ', { leer: true })
        .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ')
        .replace(/&#8217;|&#x2019;|&rsquo;|&#39;|&apos;/gi, "'")
        .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;|&quot;/gi, '"')
        .replace(/&#8211;|&#8212;|&ndash;|&mdash;|&#173;|&shy;/gi, '-')
        .replace(/&amp;/gi, '&')
        .replace(/&[a-z]+;|&#x?[0-9a-f]+;/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

/** «N days after the date of this prospectus», auch «(180) days», «180th day», «180-day lock-up period after …», «following/from». */
const FRIST_RE = /\b(\d{2,3})\)?(?:th|st|nd|rd)?(?:\s+days?|-day(?:\s+[a-z-]+){0,3}?\s+period)\s+(?:after|following|from)\s+the\s+date\s+of\s+this\s+prospectus/gi
/** Davor muss von der Verkaufssperre die Rede sein … */
const SPERRE_RE = /lock-?\s?up|market stand-?off|restricted period|not to (?:offer|sell|dispose)|will not[^.]{0,120}(?:offer|sell|dispose|transfer)|agreed[^.]{0,160}not[^.]{0,80}(?:offer|sell|dispose|transfer)/i
/** … und nicht von den anderen Fristen, die im selben Wortlaut vorkommen (Mehrzuteilung 30 Tage, Händler 25 Tage). */
const ANDERES_RE = /option to purchase additional|over-?allotment|all dealers|dealers that (?:effect|buy|sell)|prospectus delivery/i
const VORZEITIG_RE = /early release|earlier of|released? (?:early|from the lock)|waive|blackout|earnings release/i
const UMFELD = 420
// Die allgemeine Klausel nennt, wen sie bindet (Gesellschaft, Organe, im Wesentlichen alle Inhaber) …
const HAUPT_RE = /directors|executive officers|officers and|substantially all|all of our|holders of (?:substantially|all|our)|\bwe(?:,| and) (?:our|they|each)|lock-?up agreements/i
// … eine Sonderabrede sagt «bis zu» (erster echter Lauf, CoreWeave: Aktien an OpenAI, «up to 180 days»).
const HOECHSTENS_RE = /\bup\s+to\s+(?:the\s+)?\(?$/i

/**
 * Dauer der Haltefrist aus dem Text eines Börsenprospekts — nur ein eindeutiger Fund zählt.
 *
 * @returns {{tage: number, stelle: string, treffer: number, ausnahmen: boolean}}  genau EINE Dauer genannt
 *        | {tage: null, mehrdeutig: true, werte: number[], stelle: string}        mehrere Dauern — nichts gewählt
 *        | null                                                                   nichts Eindeutiges gefunden
 */
export function leseHaltefrist(text) {
    const t = String(text || '')
    if (t.length < 200) return null
    const funde = []
    for (const m of t.matchAll(FRIST_RE)) {
        const tage = Number(m[1])
        if (!(tage >= 30 && tage <= 720)) continue
        const davor = t.slice(Math.max(0, m.index - UMFELD), m.index)
        // Nur der laufende Satz und der davor entscheiden — sonst färbt ein Nachbarabsatz ab.
        const saetze = davor.split(/(?<=[.;])\s+(?=[A-Z("])/)
        const nah = saetze.slice(-2).join(' ')
        const danach = t.slice(m.index + m[0].length, m.index + m[0].length + 260)
        if (!SPERRE_RE.test(nah) || ANDERES_RE.test((saetze.at(-1) || '') + danach.slice(0, 120))) continue
        const ab = m.index - (saetze.at(-1) || '').length
        const ende = danach.search(/[.;](?:\s|$)/)
        const stelle = (t.slice(Math.max(0, ab), m.index + m[0].length) + (ende >= 0 ? danach.slice(0, ende + 1) : '')).trim()
        // Rang 2: allgemeine Klausel, 1: Sperrfrist ohne genannten Kreis, 0: «bis zu» (Sonderabrede).
        const rang = HOECHSTENS_RE.test(davor) ? 0 : HAUPT_RE.test(saetze.at(-1) || '') ? 2 : 1
        funde.push({ tage, rang, stelle: stelle.length > 480 ? '… ' + stelle.slice(-480) : stelle, ausnahmen: VORZEITIG_RE.test(nah + ' ' + danach) })
    }
    if (!funde.length) return null
    // Sonderabreden zählen nur, wenn der Prospekt sonst keine Frist nennt — dann als «höchstens».
    const fest = funde.filter((f) => f.rang > 0)
    const hoechstens = !fest.length
    if (!hoechstens) funde.splice(0, funde.length, ...fest)
    // «eligible for sale beginning 181 days after …» ist dieselbe Frist wie 180 Tage, vom Folgetag her gesagt.
    const genannt = new Set(funde.map((f) => f.tage))
    const werte = [...genannt].filter((v) => !genannt.has(v - 1)).sort((a, b) => a - b)
    // Gezeigt wird die Stelle mit dem höchsten Rang, nicht die erste im Text.
    funde.sort((a, b) => (a.tage === werte[0] ? 0 : 1) - (b.tage === werte[0] ? 0 : 1) || b.rang - a.rang)
    if (werte.length > 1) return { tage: null, mehrdeutig: true, werte, stelle: funde[0].stelle }
    return { tage: werte[0], stelle: funde[0].stelle, treffer: funde.filter((f) => f.tage === werte[0]).length, ausnahmen: funde.some((f) => f.ausnahmen), hoechstens }
}

// ── Kontaktangabe ─────────────────────────────────────────────────────────

const UMLAUT = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss', é: 'e', è: 'e', à: 'a', ç: 'c' }

/**
 * Kontaktangabe prüfen, mit der sich die App bei der SEC ausweist.
 * Die SEC verlangt «Name Mailadresse» im User-Agent; ohne Adresse sperrt sie.
 * @returns {{ok: true, wert: string} | {ok: false, grund: 'leer'|'zuLang'|'ohneAdresse'|'zeichen'}}
 */
export function pruefeKontakt(text) {
    const wert = String(text ?? '').trim().replace(/\s+/g, ' ')
    if (!wert) return { ok: false, grund: 'leer' }
    if (wert.length > 120) return { ok: false, grund: 'zuLang' }
    // Steuerzeichen (Zeilenumbruch!) hätten in einer Kopfzeile nichts verloren.
    if (/[\u0000-\u001f\u007f]/.test(String(text))) return { ok: false, grund: 'zeichen' }
    if (!/[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}/.test(wert)) return { ok: false, grund: 'ohneAdresse' }
    return { ok: true, wert }
}

/** User-Agent aus der Kontaktangabe — und aus nichts sonst. Kopfzeilen tragen nur ASCII. */
export function userAgentAus(kontakt) {
    const p = pruefeKontakt(kontakt)
    if (!p.ok) return null
    const ascii = p.wert.replace(/[^\x20-\x7e]/g, (z) => UMLAUT[z] ?? '').replace(/\s+/g, ' ').trim()
    return pruefeKontakt(ascii).ok ? ascii : null
}
