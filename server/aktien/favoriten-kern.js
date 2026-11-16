/**
 * Favoriten Aktien, der Teil ohne Netz und ohne Datenbank: die Merkliste mit
 * dem letzten Aktien-Radar-Lauf zusammenführen.
 *
 * Der Aktien-Radar ist ein Momentum-Sieb — ein eingebrochener Titel fällt dort
 * an einer Hürde oder aus der Rangliste. Genau den will man im Auge behalten.
 * Deshalb verschwindet ein Favorit hier NIE; er sagt, wie er im letzten Lauf
 * stand:
 *
 *   bewertet       steht in der Rangliste (Note, Rang, Teilnoten)
 *   huerde         geprüft, an einer Hürde gescheitert (`huerdeGrund`)
 *   nichtImLauf    hat einen Future, war aber nicht im Feld des letzten Laufs
 *                  (andere Marktdatenquelle, erst danach gelistet)
 *   ohneFuture     nur als Spot/bei einem Broker handelbar — der Radar misst Futures
 *   keinLauf       es gab noch keinen Aktien-Radar-Lauf
 *   nichtImStamm   der Titel-Stamm führt den Ticker nicht mehr (nirgends handelbar)
 *
 * Eine Merkliste, kein Kaufsignal: hier wird nichts empfohlen und nichts gereiht,
 * was der Radar nicht schon gereiht hat.
 */

export const TICKER_RE = /^[A-Z0-9][A-Z0-9.\-]{0,14}$/
/** So viele Favoriten höchstens — eine Merkliste, kein zweiter Stamm. */
export const MAX_FAVORITEN = 200

/** Ticker in die Form des Stamms bringen; `null`, wenn es keiner sein kann. */
export function normTicker(wert) {
    const t = String(wert ?? '').trim().toUpperCase()
    return TICKER_RE.test(t) ? t : null
}

/** Von mehreren Zeilen desselben Titels (zwei Kontrakte) die aussagekräftigste: bewertet vor Hürde, dann der bessere Rang. */
function besteZeile(zeilen) {
    return [...zeilen].sort((a, b) => (a.status === 'bewertet' ? 0 : 1) - (b.status === 'bewertet' ? 0 : 1)
        || (a.rang || 1e9) - (b.rang || 1e9) || String(a.symbol).localeCompare(String(b.symbol)))[0] || null
}

/**
 * Tagesstand des Newcomer-Radars (läuft täglich über JEDEN Titel des Stamms)
 * als Rückfall für Titel, die der Radar-Lauf nicht bewertet hat. Gilt nur,
 * wenn er zum Kurssymbol gehört, das heute gilt — sonst sind es die Zahlen
 * einer anderen Firma.
 */
export function tagesstandAus(gemerkt, kursSymbol) {
    if (!gemerkt?.kursSymbol || !kursSymbol || gemerkt.kursSymbol !== kursSymbol) return null
    let k = null
    try { k = JSON.parse(gemerkt.kennzahlen || 'null') } catch { k = null }
    if (!k || typeof k !== 'object') return null
    const zahl = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null)
    const aus = {
        kurs: zahl(k.kurs), waehrung: typeof k.waehrung === 'string' ? k.waehrung : null,
        abstandHochPct: zahl(k.abstandHochPct), perf3m: zahl(k.perf3m), stand: Number(gemerkt.stand) || null,
    }
    return aus.kurs == null && aus.abstandHochPct == null && aus.perf3m == null ? null : aus
}

/**
 * @param {{ticker: string, name?: string|null, erstelltAm?: number|string|null}[]} favoriten  Zeilen aus `aktien_favoriten`
 * @param {object} d
 * @param {object|null} d.lauf            letzter fertiger Aktien-Radar-Lauf oder `null`
 * @param {object[]} d.zeilen             ALLE Zeilen dieses Laufs (bewertet und Hürde), JSON-Felder schon gelesen
 * @param {Map<string, object>} d.stamm   Ticker → Titel aus `leseStamm` (mit `listungen`)
 * @param {Map<string, object|null>} d.sparten      Ticker → `{sektor, branche}` | `null`
 * @param {Map<string, object|null>} [d.tagesstaende]  Ticker → `tagesstandAus(...)`
 * @returns {object[]}  bewertete zuerst (beste Note oben), danach nach Ticker
 */
export function favoritenZeilen(favoriten = [], { lauf = null, zeilen = [], stamm = new Map(), sparten = new Map(), tagesstaende = new Map() } = {}) {
    const jeTicker = new Map()
    for (const z of zeilen) {
        const ticker = z?.boersen?.ticker
        if (!ticker) continue
        if (!jeTicker.has(ticker)) jeTicker.set(ticker, [])
        jeTicker.get(ticker).push(z)
    }
    const aus = favoriten.map((f) => {
        const titel = stamm.get(f.ticker) || null
        const zeile = lauf ? besteZeile(jeTicker.get(f.ticker) || []) : null
        const listungen = titel?.listungen || []
        let status
        if (!titel) status = 'nichtImStamm'
        else if (!lauf) status = 'keinLauf'
        else if (zeile) status = zeile.status === 'bewertet' ? 'bewertet' : 'huerde'
        else status = listungen.some((l) => l.art === 'perp') ? 'nichtImLauf' : 'ohneFuture'
        const tages = zeile?.jeZeiteinheit?.tages || null
        const rueckfall = tagesstaende.get(f.ticker) || null
        return {
            ticker: f.ticker,
            name: titel?.name || f.name || null,
            unterart: titel?.unterart || null,
            erstelltAm: Number(f.erstelltAm) || null,
            status,
            huerdeGrund: status === 'huerde' ? (zeile.huerdeGrund || 'unbekannt') : null,
            // Nur was der Lauf wirklich gemessen hat — eine Hürden-Zeile trägt keine Note.
            symbol: zeile?.symbol || null,
            rang: status === 'bewertet' ? (zeile.rang || null) : null,
            note: status === 'bewertet' ? (zeile.note ?? null) : null,
            teilnoten: status === 'bewertet' ? (zeile.teilnoten || null) : null,
            staerkeRang: tages?.staerkeRang ?? null,
            zahlenIn: tages?.zahlenIn ?? null,
            zahlenZeit: tages?.zahlenZeit ?? null,
            zahlenGeschaetzt: tages?.zahlenGeschaetzt === true,
            // Abstand zum 52-Wochen-Hoch: aus dem Lauf; fehlt er dort, aus dem Tagesstand des Newcomer-Radars.
            abstandHochPct: tages?.abstandHochPct ?? rueckfall?.abstandHochPct ?? null,
            abstandHochQuelle: tages?.abstandHochPct != null ? 'lauf' : rueckfall?.abstandHochPct != null ? 'tagesstand' : null,
            tagesstand: rueckfall,
            sparte: sparten.get(f.ticker) || null,
            listungen: listungen.map((l) => ({ handelsplatz: l.handelsplatz, art: l.art, symbol: l.symbol })),
        }
    })
    return aus.sort((a, b) => (a.status === 'bewertet' ? 0 : 1) - (b.status === 'bewertet' ? 0 : 1)
        || (b.note ?? -1) - (a.note ?? -1) || a.ticker.localeCompare(b.ticker))
}
