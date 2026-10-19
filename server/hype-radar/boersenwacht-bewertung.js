/**
 * Börsen-Beobachter — die reine Rechnung.
 *
 * Das Ziel ist nicht „handelbar auf der eigenen Börse", sondern: VOR dem
 * Listing einer grossen Börse investiert sein. Junge Projekte starten fast nie
 * auf einer zentralen Börse; sie steigen eine Leiter hinauf — DEX, dann
 * mittlere Börsen (Gate, KuCoin, Bitget), dann die grossen (Binance,
 * Coinbase, Bybit, Kraken). Ein Listing ganz oben ist meist das Ende des
 * leichten Teils der Bewegung, nicht der Anfang.
 *
 * Seit S12 (Verkaufs-Prüfung vom 19.10.2026) ohne Upbit, OKX und MEXC (deren
 * Bedingungen verbieten Drittprogramme bzw. kommerzielle Nutzung der
 * Marktdaten) und ohne Binance Alpha (undokumentierter `bapi`-Endpunkt des
 * Web-Frontends). Die Sprosse „Alpha" gibt es damit nicht mehr.
 *
 * S15 (19.10.2026): Mit dem Schalter „Quellen ohne Verkaufsfreigabe" sind sie
 * wieder da wie vor S12 — `ALLE_BOERSEN` mit `freigabe` (ID in
 * `server/quellen/freigabe.js`), `boersenFuer(ohneFreigabe)` wählt die Liste.
 * Die Leiter lautet dann wieder: DEX, Binance Alpha oder mittlere Börsen
 * (MEXC, Gate, KuCoin, Bitget), dann die grossen (Binance, Coinbase, Upbit,
 * OKX, Bybit, Kraken). Die Rechnung hier bleibt rein: was nicht in `staende`
 * steht, zählt nicht — der Aufrufer lädt nur die Stände der geltenden Liste.
 *
 * Drei Fragen, drei Funktionen:
 *   neueEintraege   was ist seit dem letzten guten Stand dazugekommen?
 *   ordneZu         kannte der Radar den Token vorher — und seit wann?
 *   leiterFuer      auf welcher Sprosse steht ein Radar-Token gerade?
 *
 * Rein: Antworten und Stände hinein, Ereignisse heraus. Kein Netz, keine DB.
 */

/** Die beobachteten Börsen. `stufe` ist die Sprosse der Leiter. */
export const BOERSEN = [
    { id: 'binance-spot', name: 'Binance Spot', stufe: 'gross' },
    { id: 'binance-futures', name: 'Binance Futures', stufe: 'gross' },
    { id: 'coinbase', name: 'Coinbase', stufe: 'gross' },
    { id: 'bybit', name: 'Bybit', stufe: 'gross' },
    { id: 'kraken', name: 'Kraken', stufe: 'gross' },
    { id: 'kucoin', name: 'KuCoin', stufe: 'mittel' },
    { id: 'gate', name: 'Gate', stufe: 'mittel' },
    { id: 'bitget', name: 'Bitget', stufe: 'mittel' },
]

/**
 * Alle Börsen inklusive derer ohne Verkaufsfreigabe (S15) — Reihenfolge wie
 * vor S12. `freigabe` ist die ID in `QUELLEN_OHNE_FREIGABE`.
 */
export const ALLE_BOERSEN = [
    { id: 'binance-alpha', name: 'Binance Alpha', stufe: 'alpha', freigabe: 'binanceAlpha' },
    { id: 'binance-spot', name: 'Binance Spot', stufe: 'gross' },
    { id: 'binance-futures', name: 'Binance Futures', stufe: 'gross' },
    { id: 'coinbase', name: 'Coinbase', stufe: 'gross' },
    { id: 'upbit', name: 'Upbit', stufe: 'gross', freigabe: 'upbit' },
    { id: 'okx', name: 'OKX', stufe: 'gross', freigabe: 'okx' },
    { id: 'bybit', name: 'Bybit', stufe: 'gross' },
    { id: 'kraken', name: 'Kraken', stufe: 'gross' },
    { id: 'kucoin', name: 'KuCoin', stufe: 'mittel' },
    { id: 'gate', name: 'Gate', stufe: 'mittel' },
    { id: 'mexc', name: 'MEXC', stufe: 'mittel', freigabe: 'mexc' },
    { id: 'bitget', name: 'Bitget', stufe: 'mittel' },
]

/** Die beobachteten Börsen je Schalter: an → alle (wie vor S12), aus → `BOERSEN` (S12). */
export const boersenFuer = (ohneFreigabe) => (ohneFreigabe ? ALLE_BOERSEN : BOERSEN)

/** Name und Stufe jeder Börse, die es je gab — auch für gespeicherte Zeilen. */
export const BOERSE_NACH_ID = new Map(ALLE_BOERSEN.map((b) => [b.id, b]))

/**
 * Unterhalb dieser Bewertung ist ein gleichnamiger DEX-Token fast sicher ein
 * Namensvetter des gelisteten — dieselbe Regel wie `listungen.js`.
 */
export const MIN_BEWERTUNG_KUERZEL = 5_000_000

/** Ein neuer Stand, der so viel kleiner ist als der alte, ist eine halbe Antwort. */
const MIN_VOLLSTAENDIG = 0.8

/** Mehr „neue" Listungen auf einmal heisst: das Antwortformat hat sich geändert. */
export const MAX_NEU_JE_ABRUF = 40

// ── Kürzel ──────────────────────────────────────────────────────────────

/**
 * Gegenwährungen, die von Paarnamen ohne Trennzeichen abgeschnitten werden
 * (Binance, MEXC). Längste zuerst, damit FDUSD nicht als USD endet.
 */
const GEGEN = ['FDUSD', 'USDT', 'USDC', 'TUSD', 'BUSD', 'USDE', 'AEUR', 'EURI', 'DAI', 'TRY', 'EUR', 'BRL', 'JPY',
    'ARS', 'MXN', 'PLN', 'RON', 'ZAR', 'UAH', 'COP', 'CZK', 'IDR', 'BTC', 'ETH', 'BNB', 'USD']

/** Multiplikator-Präfixe der Futures-Kontrakte (1000PEPE ist PEPE). */
const VIELFACHES = /^(1000000|100000|10000|1000|1M)(?=[A-Z])/

/** Kraken-Eigenheiten — XBT ist BTC, XDG ist DOGE. */
const KRAKEN = { XBT: 'BTC', XDG: 'DOGE' }

export function kuerzel(roh) {
    return String(roh || '').trim().toUpperCase().replace(VIELFACHES, '')
}

/** Basis aus einem Paarnamen ohne Trennzeichen („PEPEUSDT" → „PEPE"). */
export function basisAusPaar(paar) {
    const p = String(paar || '').toUpperCase()
    for (const g of GEGEN) {
        if (p.length > g.length && p.endsWith(g)) return kuerzel(p.slice(0, -g.length))
    }
    return ''
}

const eindeutig = (liste) => [...new Set(liste.filter(Boolean))].sort()

// ── Parser je Börse (öffentliche Marktlisten, ohne Schlüssel) ──────────
/*
 * ⚠ Gegen die Live-Endpunkte nicht geprüft (keine Verbindung aus der
 * Entwicklungsumgebung am 07.10.2026). Die Formen sind die dokumentierten;
 * jeder Parser liefert bei fremder Form eine LEERE Liste, und eine leere
 * Liste überschreibt nie den letzten guten Stand (`pruefeStand`).
 */
export const LESER = {
    'binance-spot': (j) => eindeutig((Array.isArray(j) ? j : []).map((x) => basisAusPaar(x?.symbol))),
    // `exchangeInfo` (seit 12.10.2026, wegen der Startzeiten); die alte Form von
    // `ticker/price` (ein Array) wird weiter gelesen.
    'binance-futures': (j) => eindeutig((Array.isArray(j) ? j : (Array.isArray(j?.symbols) ? j.symbols : []))
        .filter((x) => !x?.status || x.status === 'TRADING').map((x) => basisAusPaar(x?.symbol))),
    // S15, nur mit Schalter an (Leser sind rein; welche Börsen gefragt werden, entscheidet `boersenFuer`).
    'binance-alpha': (j) => {
        const liste = Array.isArray(j?.data) ? j.data : (Array.isArray(j) ? j : [])
        const raus = new Map()
        for (const t of liste) {
            const symbol = kuerzel(t?.symbol)
            if (!symbol) continue
            const chain = alphaKette(t?.chainId)
            const contract = normVertrag(chain, t?.contractAddress)
            const schluessel = contract ? `${chain}|${contract}` : `sym|${symbol}`
            raus.set(schluessel, { schluessel, symbol, chain, contract })
        }
        return [...raus.values()].sort((a, b) => a.schluessel.localeCompare(b.schluessel))
    },
    coinbase: (j) => eindeutig((Array.isArray(j) ? j : [])
        .filter((p) => String(p?.status || 'online') === 'online' && p?.trading_disabled !== true)
        .map((p) => kuerzel(p?.base_currency))),
    upbit: (j) => eindeutig((Array.isArray(j) ? j : []).map((m) => kuerzel(String(m?.market || '').split('-')[1]))),
    okx: (j) => eindeutig((Array.isArray(j?.data) ? j.data : [])
        .filter((x) => String(x?.state || 'live') === 'live').map((x) => kuerzel(x?.baseCcy))),
    bybit: (j) => eindeutig((Array.isArray(j?.result?.list) ? j.result.list : [])
        .filter((x) => String(x?.status || 'Trading') === 'Trading').map((x) => kuerzel(x?.baseCoin))),
    kraken: (j) => eindeutig(Object.values(j?.result || {}).map((x) => {
        const b = kuerzel(String(x?.wsname || '').split('/')[0])
        return KRAKEN[b] || b
    })),
    kucoin: (j) => eindeutig((Array.isArray(j?.data) ? j.data : [])
        .filter((x) => x?.enableTrading !== false).map((x) => kuerzel(x?.baseCurrency))),
    gate: (j) => eindeutig((Array.isArray(j) ? j : [])
        .filter((x) => String(x?.trade_status || 'tradable') === 'tradable').map((x) => kuerzel(x?.base))),
    mexc: (j) => eindeutig((Array.isArray(j?.data) ? j.data : []).map((s) => basisAusPaar(s))),
    bitget: (j) => eindeutig((Array.isArray(j?.data) ? j.data : [])
        .filter((x) => String(x?.status || 'online') === 'online').map((x) => kuerzel(x?.baseCoin))),
}

// ── Handelsstart ────────────────────────────────────────────────────────
/*
 * Drei Börsen (mit dem Schalter „Quellen ohne Verkaufsfreigabe" vier) nennen in derselben Liste, WANN ein Paar zu handeln beginnt —
 * auch für Paare, die angelegt, aber noch nicht offen sind. Geprüft gegen die
 * Live-Antworten am 12.10.2026:
 *
 *   Binance Futures  `onboardDate` (ms), `status: PENDING_TRADING` vor dem Start
 *                    (GAIBUSDT stand fünf Wochen vorher drin)
 *   OKX              `listTime` (ms), `state: preopen` vor dem Start (S15, nur
 *                    mit dem Schalter „Quellen ohne Verkaufsfreigabe")
 *   Gate             `buy_start` (s), `trade_status: sellable` bis Kaufstart
 *   Bitget           `openTime` (ms); angekündigte Paare stehen nicht drin
 *
 * Coinbase, Bybit, Kraken und Binance Spot führen keinen Zeitpunkt (OKX bis S12).
 * Ein Zeitpunkt vor 2015 ist ein Lesefehler (0, Sekunden statt ms), kein Start.
 */
const NACH_2015 = Date.UTC(2015, 0, 1)
const ms = (w, faktor = 1) => {
    const z = Number(w) * faktor
    return Number.isFinite(z) && z > NACH_2015 ? z : null
}

/**
 * @returns {{laufend: Map<string, number>, angekuendigt: Array<{symbol:string, start:number|null}>}}
 *          laufend: Kürzel → Handelsstart der offenen Paare (frühestes Paar je Kürzel)
 */
export const STARTS = {
    'binance-futures': (j, jetzt = Date.now()) => sammleStarts((Array.isArray(j?.symbols) ? j.symbols : []).map((x) => ({
        symbol: basisAusPaar(x?.symbol), start: ms(x?.onboardDate),
        offen: x?.status === 'TRADING', vorher: x?.status === 'PENDING_TRADING',
    })), jetzt),
    okx: (j, jetzt = Date.now()) => sammleStarts((Array.isArray(j?.data) ? j.data : []).map((x) => ({
        symbol: kuerzel(x?.baseCcy), start: ms(x?.listTime),
        offen: x?.state === 'live', vorher: x?.state === 'preopen',
    })), jetzt),
    gate: (j, jetzt = Date.now()) => sammleStarts((Array.isArray(j) ? j : []).map((x) => {
        const start = ms(x?.buy_start, 1000)
        return {
            symbol: kuerzel(x?.base), start,
            offen: x?.trade_status === 'tradable',
            // `untradable` heisst auch „abgekündigt" — angekündigt nur mit Start in der Zukunft
            vorher: x?.trade_status !== 'tradable' && start !== null && start > jetzt,
        }
    }), jetzt),
    bitget: (j, jetzt = Date.now()) => sammleStarts((Array.isArray(j?.data) ? j.data : []).map((x) => {
        const start = ms(x?.openTime)
        return { symbol: kuerzel(x?.baseCoin), start, offen: x?.status === 'online' && !(start > jetzt), vorher: start !== null && start > jetzt }
    }), jetzt),
}

/**
 * Länger als das vorbei und noch immer nicht offen ist keine Ankündigung mehr,
 * sondern eine Leiche: GAIBUSDT stand am 12.10.2026 als PENDING_TRADING mit
 * Start 20.11.2025 in der Binance-Liste.
 */
export const ANGEKUENDIGT_VERFALL_MS = 7 * 86400e3

function sammleStarts(zeilen, jetzt = Date.now()) {
    const laufend = new Map()
    const vorher = new Map()
    for (const z of zeilen) {
        if (!z.symbol) continue
        if (z.offen && z.start !== null) {
            const a = laufend.get(z.symbol)
            if (a === undefined || z.start < a) laufend.set(z.symbol, z.start)
        } else if (z.vorher && !(z.start !== null && z.start < jetzt - ANGEKUENDIGT_VERFALL_MS)) {
            const a = vorher.get(z.symbol)
            if (a === undefined || (z.start !== null && (a === null || z.start < a))) vorher.set(z.symbol, z.start)
        }
    }
    // Wer schon unter einem anderen Paar handelt, ist nicht angekündigt (BTC-USDC neu, BTC-USDT läuft).
    const angekuendigt = [...vorher.entries()].filter(([sym]) => !laufend.has(sym))
        .map(([symbol, start]) => ({ symbol, start }))
        .sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity))
    return { laufend, angekuendigt }
}

/** Binance-Alpha-Ketten-Kennung → unsere Kette. */
function alphaKette(id) {
    const s = String(id || '')
    if (s === '56') return 'bsc'
    if (s === '1') return 'ethereum'
    if (s === '8453') return 'base'
    if (/^CT_501$|^501$|sol/i.test(s)) return 'solana'
    return s.toLowerCase()
}

export function normVertrag(chain, contract) {
    const c = String(contract || '').trim()
    if (!c) return ''
    return chain === 'solana' ? c : c.toLowerCase()
}

/** Schlüssel eines Eintrags — bei Alpha (S15, Schalter an) das Objekt, sonst das Kürzel selbst. */
export const eintragSchluessel = (e) => (typeof e === 'string' ? e : e?.schluessel || '')

// ── Neue Listungen ──────────────────────────────────────────────────────

/**
 * Taugt der neue Stand als Vergleich — und was ist neu?
 *
 * Drei Fälle, in denen NICHTS als neu gilt:
 *   - es gibt noch keinen alten Stand (erste Grundlinie; sonst wäre beim
 *     ersten Abruf jede Listung „neu"),
 *   - der neue Stand ist leer oder deutlich kleiner (halbe Antwort — der alte
 *     bleibt stehen, sonst kämen beim nächsten vollständigen Abruf hunderte
 *     scheinbar neue Listungen),
 *   - es wären mehr als `MAX_NEU_JE_ABRUF` neue (das Format hat sich geändert,
 *     etwa andere Schreibweise der Kürzel — die Grundlinie wird neu gesetzt).
 *
 * @returns {{uebernehmen:boolean, neu:Array, hinweis:string}}
 */
export function neueEintraege(alt, neu) {
    const neuListe = Array.isArray(neu) ? neu : []
    if (!neuListe.length) return { uebernehmen: false, neu: [], hinweis: 'leere Antwort' }
    if (!Array.isArray(alt) || !alt.length) return { uebernehmen: true, neu: [], hinweis: 'Grundlinie gesetzt' }
    if (neuListe.length < alt.length * MIN_VOLLSTAENDIG) {
        return { uebernehmen: false, neu: [], hinweis: `Antwort unvollständig (${neuListe.length} statt ${alt.length})` }
    }
    const bekannt = new Set(alt.map(eintragSchluessel))
    const dazu = neuListe.filter((e) => !bekannt.has(eintragSchluessel(e)))
    if (dazu.length > MAX_NEU_JE_ABRUF) {
        return { uebernehmen: true, neu: [], hinweis: `${dazu.length} auf einmal neu — Grundlinie neu gesetzt` }
    }
    return { uebernehmen: true, neu: dazu, hinweis: '' }
}

// ── Kannte der Radar den Token vorher? ──────────────────────────────────

/**
 * Eine neue Listung dem Wissen des Radars zuordnen.
 *
 * Nach VERTRAG ist das sicher (bis S12 nannte ihn Binance Alpha; die
 * verbliebenen Börsenlisten führen nur Kürzel). Nach Kürzel nur,
 * wenn der gleichnamige Radar-Token gross genug ist, um überhaupt gelistet zu
 * werden — sonst ist es ein Namensvetter, und dann zählt er nicht als
 * „rechtzeitig erkannt". Das würde die Vorlaufstatistik schönen.
 *
 * Zwei Zeitpunkte, getrennt: `radarGesehen` (irgendwann beobachtet — der
 * Radar sieht Tausende) und `radarSeit` (erstmals GEMELDET). Nur der zweite
 * ist ein Verdienst.
 *
 * @param {{symbol, chain?, contract?}} listung
 * @param {Array<{symbol, chain, contract, ersterBlick, ersteMeldung, quelle, bewertungUsd}>} wissen
 */
export function ordneZu(listung, wissen = []) {
    const leer = { radarSeit: null, radarGesehen: null, radarQuelle: '', treffer: '', bewertungUsd: null,
        chain: listung.chain || '', contract: listung.contract || '' }
    const zusammen = (liste, treffer) => {
        const min = (feld) => {
            const w = liste.map((x) => Number(x[feld])).filter((x) => Number.isFinite(x) && x > 0)
            return w.length ? Math.min(...w) : null
        }
        const radarSeit = min('ersteMeldung')
        const erster = liste.find((x) => Number(x.ersteMeldung) === radarSeit)
            || liste.find((x) => Number(x.ersterBlick) === min('ersterBlick')) || liste[0]
        return {
            ...leer, treffer, radarSeit, radarGesehen: min('ersterBlick'), radarQuelle: erster.quelle || '',
            bewertungUsd: maxBewertung(liste), chain: erster.chain || leer.chain, contract: erster.contract || leer.contract,
        }
    }

    if (listung.contract) {
        const v = normVertrag(listung.chain, listung.contract)
        const treffer = v ? wissen.filter((w) => normVertrag(w.chain, w.contract) === v) : []
        if (treffer.length) return zusammen(treffer, 'vertrag')
    }
    const symbol = kuerzel(listung.symbol)
    const gleich = wissen.filter((w) => kuerzel(w.symbol) === symbol)
    if (!gleich.length) return leer
    const gross = gleich.filter((w) => Number(w.bewertungUsd) >= MIN_BEWERTUNG_KUERZEL || w.quelle === 'favorit')
    return gross.length ? zusammen(gross, 'kuerzel') : zusammen(gleich, 'namensgleich')
}

function maxBewertung(liste) {
    const w = liste.map((x) => Number(x.bewertungUsd)).filter((x) => Number.isFinite(x) && x > 0)
    return w.length ? Math.max(...w) : null
}

/** Zählt als „rechtzeitig erkannt"? Nur sichere und plausible Treffer. */
export const istTreffer = (z) => z.treffer === 'vertrag' || z.treffer === 'kuerzel'

// ── Die Leiter ──────────────────────────────────────────────────────────

/**
 * Auf welchen Börsen steht ein Token gerade?
 *
 * @param {{symbol, chain, contract, bewertungUsd}} token
 * @param {Map<string, Set<string>>} staende  Börse → Schlüssel (Kürzel; bei Alpha `chain|contract`)
 * @param {Array} boersen  die geltende Liste (`boersenFuer`, S15) — nur ihre Stände zählen
 * @returns {{alpha?:boolean, mittel:string[], gross:string[]}}  `alpha` nur, wenn die Liste Alpha führt
 */
export function leiterFuer(token, staende, boersen = ALLE_BOERSEN) {
    // Nur Börsen der geltenden Liste (S15: `boersenFuer`) — ein liegengebliebener Stand zählt sonst mit.
    const gilt = new Set(boersen.map((b) => b.id))
    const mitAlpha = boersen.some((b) => b.stufe === 'alpha')
    const raus = mitAlpha ? { alpha: false, mittel: [], gross: [] } : { mittel: [], gross: [] }
    const symbol = kuerzel(token.symbol)
    const v = normVertrag(token.chain, token.contract)
    // Ein kleiner DEX-Token mit gleichem Kürzel wie ein CEX-Coin ist ein
    // Namensvetter — die Kürzel-Treffer zählen erst ab der Listungsgrösse.
    const kuerzelZaehlt = Number(token.bewertungUsd) >= MIN_BEWERTUNG_KUERZEL
    for (const [id, eintraege] of staende || []) {
        const b = BOERSE_NACH_ID.get(id)
        if (!b || !gilt.has(id)) continue
        if (b.stufe === 'alpha') {
            if (v && eintraege.has(`${token.chain}|${v}`)) raus.alpha = true
            continue
        }
        if (kuerzelZaehlt && eintraege.has(symbol)) raus[b.stufe].push(b.name)
    }
    return raus
}

/**
 * Auf welchen ANDEREN Börsen steht dasselbe Kürzel schon? Für eine neue oder
 * angekündigte Listung: ist sie ein Erstauftritt oder zieht sie nach?
 *
 * Über das Kürzel, also ohne Gewähr: QI auf MEXC und QI auf einer anderen
 * Börse können verschiedene Token sein. Binance Alpha zählt nur über den
 * Vertrag, weil es dort Schlüssel aus Kette und Vertrag führt.
 *
 * @returns {string[]} Börsennamen in der Reihenfolge von `BOERSEN`
 */
export function auchGelistetAuf(listung, staende, boersen = ALLE_BOERSEN) {
    const symbol = kuerzel(listung.symbol)
    const v = normVertrag(listung.chain, listung.contract)
    const raus = []
    for (const b of boersen) {
        if (b.id === listung.boerse) continue
        const eintraege = staende?.get(b.id)
        if (!eintraege) continue
        const da = b.stufe === 'alpha'
            ? (v && eintraege.has(`${listung.chain}|${v}`)) || eintraege.has(`sym|${symbol}`)
            : eintraege.has(symbol)
        if (da) raus.push(b.name)
    }
    return raus
}

// ── Vorlauf ─────────────────────────────────────────────────────────────

/**
 * Wie früh war der Radar? Je Sprosse: wie viele neue Listungen, wie viele der
 * Radar vorher kannte, und der Median des Vorlaufs in Tagen.
 */
export function vorlaufStatistik(listungen = [], boersen = ALLE_BOERSEN) {
    const raus = {}
    // Je Schalter (S15) die geltende Liste: Sprosse „alpha" und Listungen von Upbit, OKX, MEXC nur mit Schalter an.
    const gilt = new Set(boersen.map((b) => b.id))
    const stufen = ['alpha', 'mittel', 'gross'].filter((st) => boersen.some((b) => b.stufe === st))
    for (const stufe of stufen) {
        const l = listungen.filter((z) => gilt.has(z.boerse) && BOERSE_NACH_ID.get(z.boerse)?.stufe === stufe)
        const erkannt = l.filter((z) => istTreffer(z) && Number(z.radarSeit) > 0 && Number(z.radarSeit) <= Number(z.gesehenAm))
        const tage = erkannt.map((z) => (Number(z.gesehenAm) - Number(z.radarSeit)) / 86400e3).sort((a, b) => a - b)
        const m = Math.floor(tage.length / 2)
        raus[stufe] = {
            neu: l.length,
            erkannt: erkannt.length,
            medianVorlaufTage: tage.length ? (tage.length % 2 ? tage[m] : (tage[m - 1] + tage[m]) / 2) : null,
        }
    }
    return raus
}
