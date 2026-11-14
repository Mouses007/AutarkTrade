/**
 * Kursquelle des Newcomer-Radars, der Teil ohne Netz: Symbol-Kandidaten,
 * Namensvergleich, Antworten lesen.
 *
 * Das Kernproblem ist die Zuordnung. Der Stamm kennt Ticker, wie die Börsen
 * sie schreiben (`BRKB`, Bitpanda `PEG-US`, `ENT-LN`, `SAN`), die Kursquelle
 * kennt Börsensymbole (`BRK-B`, `PEG`, `ENT.L`, `SAN.PA`). Ein Ticker allein
 * ist nicht eindeutig: `SAN` ist bei Bitpanda Sanofi, an der NYSE Banco
 * Santander. Deshalb gilt ein Treffer nur, wenn der NAME passt — kennt der
 * Stamm keinen Namen (Titel nur an Krypto-Börsen), gilt der Ticker und die
 * Zuordnung heisst `ticker` statt `name`.
 */

/** Schreibweisen mit Aktiengattung: Börsen kleben den Buchstaben an, die Kursquelle trennt ihn. */
const GATTUNG = { BRKB: 'BRK-B', BRKA: 'BRK-A', BFB: 'BF-B', BFA: 'BF-A' }
/** Bitpanda-Nachsilben → Nachsilbe der Kursquelle. `US` heisst: ohne Nachsilbe. */
const NACHSILBE = { US: '', LN: '.L', GY: '.DE', FP: '.PA', NA: '.AS', SM: '.MC', IM: '.MI', SW: '.SW', SS: '.ST', DC: '.CO', FH: '.HE', NO: '.OL', BB: '.BR', AV: '.VI', CN: '.TO', AU: '.AX', HK: '.HK', JP: '.T' }

/**
 * Welche Symbole der Kursquelle kommen für diesen Ticker in Frage, in dieser Reihenfolge?
 * Leere Liste = aus dem Ticker lässt sich keines ableiten (dann hilft nur die Namenssuche).
 */
export function kursSymbolKandidaten(ticker) {
    const t = String(ticker || '').toUpperCase().trim()
    if (!t) return []
    if (GATTUNG[t]) return [GATTUNG[t]]
    const m = t.match(/^([A-Z0-9.]+)-([A-Z]{2})$/)
    if (m) return m[2] in NACHSILBE ? [m[1] + NACHSILBE[m[2]]] : []
    // Reine Zahlen sind asiatische Börsenkürzel ohne Börsenangabe — nicht ableitbar.
    if (/^\d+$/.test(t)) return []
    if (!/^[A-Z][A-Z0-9.]{0,9}$/.test(t)) return []
    return [t]
}

const FUELLWOERTER = new Set([
    'inc', 'incorporated', 'corp', 'corporation', 'co', 'company', 'plc', 'ltd', 'limited', 'ag', 'sa', 'se', 'nv', 'spa', 'ab', 'asa', 'oyj', 'as',
    'holding', 'holdings', 'group', 'the', 'and', 'class', 'a', 'b', 'c', 'adr', 'ads', 'ordinary', 'shares', 'common', 'stock', 'de', 'of', 'n', 'v', 's', 'p',
])

/** Firmenname → bedeutungstragende Wörter (klein, ohne Akzente, ohne Rechtsform). */
export function namensWoerter(name) {
    return String(name || '').toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
        .filter((w) => w && !FUELLWOERTER.has(w))
}

/**
 * Meinen zwei Namen dieselbe Firma? Die Wörter des kürzeren Namens müssen im
 * längeren vorkommen («Goldman Sachs» ⊂ «The Goldman Sachs Group, Inc.»).
 * Ein einzelnes Wort unter drei Buchstaben trägt nicht.
 */
export function nameGleich(a, b) {
    const x = namensWoerter(a), y = namensWoerter(b)
    if (!x.length || !y.length) return false
    const [kurz, lang] = x.length <= y.length ? [x, y] : [y, x]
    if (kurz.length === 1 && kurz[0].length < 3) return false
    const menge = new Set(lang)
    return kurz.every((w) => menge.has(w))
}

/** Wörter, die in zu vielen Firmennamen stehen, um zwei Namen zu verbinden. */
const ALLERWELT = new Set([
    'national', 'american', 'international', 'first', 'bank', 'banco', 'energy', 'global', 'united', 'general', 'financial', 'technologies',
    'technology', 'systems', 'pharmaceuticals', 'pharma', 'resources', 'capital', 'industries', 'entertainment', 'communications', 'motors',
    'airlines', 'insurance', 'therapeutics', 'sciences', 'solutions', 'services', 'partners', 'trust', 'china', 'japan', 'royal', 'software',
    'semiconductor', 'electric', 'power', 'mining', 'gold', 'health', 'medical', 'foods', 'brands', 'properties', 'realty', 'digital',
])
const roheWoerter = (name) => String(name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean)
const initialen = (name) => roheWoerter(name).map((w) => w[0]).join('')

/**
 * Lockerer als `nameGleich`, für den Fall, dass der TICKER schon passt und der
 * Name nur noch eine Verwechslung ausschliessen soll. Bitpanda schreibt
 * «TSMC», «AMD», «Pinduoduo», «British Petroleum»; die Kursquelle «Taiwan
 * Semiconductor Manufacturing Company Limited», «Advanced Micro Devices,
 * Inc.», «PDD Holdings Inc.», «BP p.l.c.». Es reicht EINES von:
 *   - `nameGleich`, oder beide Namen sind nach dem Bereinigen dasselbe Wort
 *   - ein Name ist das Kürzel des anderen (Anfangsbuchstaben)
 *   - der Ticker steht als Wort im Namen der Kursquelle
 *   - ein gemeinsames Wort ab fünf Buchstaben, das kein Allerweltswort ist
 *   - das erste Wort des einen ist der Anfang des ersten Worts des anderen (ExxonMobil / Exxon Mobil)
 * «Sanofi» gegen «Banco Santander» erfüllt keines davon.
 */
export function nameAehnlich(stammName, quelleName, ticker = '') {
    if (nameGleich(stammName, quelleName)) return true
    const a = roheWoerter(stammName), b = roheWoerter(quelleName)
    if (!a.length || !b.length) return false
    const x = namensWoerter(stammName), y = namensWoerter(quelleName)
    if (x.length && x.join(' ') === y.join(' ')) return true
    // Kürzel in beide Richtungen; der Rest hinter dem Kürzel darf Rechtsform sein (… Company Limited).
    const kuerzel = (kurz, lang) => kurz.length === 1 && kurz[0].length >= 2 && initialen(lang).startsWith(kurz[0])
    if (kuerzel(a, quelleName) || kuerzel(b.filter((w) => !FUELLWOERTER.has(w)), stammName)) return true
    const t = String(ticker || '').toLowerCase().replace(/-[a-z]{2}$/, '')
    if (t.length >= 2 && b.includes(t)) return true
    const menge = new Set(y)
    if (x.some((w) => w.length >= 5 && !ALLERWELT.has(w) && menge.has(w))) return true
    // Zusammengeschrieben gegen getrennt: das eine erste Wort ist der Anfang des anderen.
    // Fünf gleiche Anfangsbuchstaben reichen NICHT — Carlsberg/Carlsmed, Commerzbank/Commercial (Probelauf 14.11.2026).
    if (!x.length || !y.length) return false
    const [kurz, lang] = x[0].length <= y[0].length ? [x[0], y[0]] : [y[0], x[0]]
    return kurz.length >= 5 && !ALLERWELT.has(kurz) && lang.startsWith(kurz)
}

/** Ticker ohne Börsen-Nachsilbe, Zahlen ohne führende Nullen: `SAN.PA` → `SAN`, `0101.HK` → `101`, `PEG-US` → `PEG`. */
export function tickerStamm(symbol) {
    const t = String(symbol || '').toUpperCase().split('.')[0].replace(/-[A-Z]{2}$/, '')
    return /^\d+$/.test(t) ? String(Number(t)) : t
}

/**
 * Chart-Antwort lesen: Stammdaten und abgeschlossene Tageskerzen.
 * Wirft bei einer Fehlerantwort; Tage ohne Schlusskurs (Feiertag, Aussetzung) fallen weg.
 *
 * @returns {{meta: {symbol: string, name: string|null, boerse: string|null, waehrung: string|null,
 *            ipoDatum: number|null, typ: string|null}, kerzen: object[]}}
 */
export function ausChart(json, jetzt = Date.now()) {
    const fehler = json?.chart?.error
    if (fehler) throw new Error(fehler.description || fehler.code || 'Fehlerantwort')
    const r = json?.chart?.result?.[0]
    if (!r?.meta) throw new Error('leere Antwort')
    const m = r.meta
    const q = r.indicators?.quote?.[0] || {}
    const kerzen = []
    ;(r.timestamp || []).forEach((sek, i) => {
        const c = q.close?.[i]
        if (c == null || !(c > 0)) return
        kerzen.push({ t: sek * 1000, o: q.open?.[i] ?? c, h: q.high?.[i] ?? c, l: q.low?.[i] ?? c, c, v: q.volume?.[i] ?? 0 })
    })
    // Läuft die Sitzung noch, ist die letzte Kerze der angefangene Tag — weg damit.
    const sitzung = m.currentTradingPeriod?.regular
    if (kerzen.length && sitzung && jetzt < sitzung.end * 1000 && kerzen[kerzen.length - 1].t >= sitzung.start * 1000) kerzen.pop()
    return {
        meta: {
            symbol: m.symbol,
            name: m.longName || m.shortName || null,
            boerse: m.fullExchangeName || m.exchangeName || null,
            waehrung: m.currency || null,
            // Vor 1970 gelistete Firmen haben ein negatives Datum — auch das ist eines.
            ipoDatum: typeof m.firstTradeDate === 'number' && Number.isFinite(m.firstTradeDate) ? m.firstTradeDate * 1000 : null,
            typ: m.instrumentType || null,
        },
        kerzen,
    }
}

/**
 * Aus einer Such-Antwort die Listung der Aktie nehmen, deren Name passt.
 *
 * Eine Firma steht dort mehrfach: Heimatbörse, US-Zweitlistung, Frankfurt,
 * Düsseldorf. Bitpanda nennt den Ticker der HEIMATBÖRSE (`SAN` für Sanofi in
 * Paris, `JUVE` in Mailand, `3382` in Tokio) — die Listung mit demselben
 * Ticker ist deshalb die richtige (`heimat: true`). Gibt es sie nicht, zählt
 * die erste US-Listung, sonst der erste Treffer; deren Datum des ersten
 * Handels ist NICHT der Börsengang der Firma (`heimat: false`).
 *
 * @returns {{symbol: string, heimat: boolean}|null}
 */
export function ausSuche(json, name, ticker = '') {
    const treffer = (json?.quotes || []).filter((q) => q?.quoteType === 'EQUITY' && q.symbol && nameGleich(q.longname || q.shortname, name))
    if (!treffer.length) return null
    const stamm = tickerStamm(ticker)
    const heimat = stamm && treffer.find((q) => tickerStamm(q.symbol) === stamm)
    if (heimat) return { symbol: heimat.symbol, heimat: true }
    const us = treffer.find((q) => !q.symbol.includes('.'))
    return { symbol: (us || treffer[0]).symbol, heimat: false }
}
