/**
 * Hype-Radar, Stufe 1: Kandidaten sammeln.
 *
 * Drei Fremdquellen, die nichts voneinander wissen und unterschiedlich
 * zuverlässig sind — CoinGecko (Suchinteresse), DexScreener (Profile, Boosts,
 * Paare) und die On-Chain-Pools von CoinGecko (vormals GeckoTerminal), dazu
 * die reifen Funde der Frühphase. Zwei Regeln bestimmen den Aufbau:
 *
 * 1. **Eine Quelle darf den Lauf nicht kippen.** Jede läuft in ihrem eigenen
 *    try/catch mit Zeitgrenze; was ausfällt, vermerkt der Bericht unter
 *    `quellenStand`. Ein Lauf mit zwei von drei Quellen ist brauchbar, ein
 *    abgebrochener ist es nicht.
 *
 * 2. **Ein Fund aus einer einzigen Quelle ist kein Hype.** Deshalb wird nach
 *    Vertrag/Symbol zusammengeführt und gezählt, aus wie vielen unabhängigen
 *    Quellen ein Kandidat stammt — diese Zahl ist später der wichtigste
 *    Einzelfaktor gegen gekauften Lärm.
 *
 * Lizenzlage (Verkaufs-Prüfung vom 19.10.2026, S12): pump.fun (inoffizielles
 * Frontend-API, Bots verboten), Reddit-RSS (wird abgeschaltet, kommerziell
 * vertragspflichtig) und CoinPaprika Free (nur nicht-kommerziell) sind
 * entfernt. CoinGecko und dessen On-Chain-Endpunkte laufen NUR mit dem
 * Schlüssel des Kunden (`server/quellen/coingecko.js`) — ohne ihn sind die
 * beiden Quellen „aus" und sagen das im `quellenStand`, statt still zu fehlen.
 * DexScreener erlaubt die kommerzielle Nutzung (API-Terms Sec. 4) und läuft
 * ohne Schlüssel.
 *
 * CryptoPanic und LunarCrush standen hier bis zum 21.08.2026 und sind entfernt
 * worden, weil beide ihren Gratis-Tarif abgeschafft haben.
 */

import { logWarn } from '../logger.js'
import { cgAnfrage } from '../quellen/coingecko.js'
import { istAus, ausAntwort } from '../quellen/aus.js'

/** Zeitgrenze je Einzelabruf. Lieber eine Quelle weniger als ein hängender Lauf. */
const ABRUF_TIMEOUT_MS = 10000

/**
 * Erlaubte Gegenstellen.
 *
 * Der Radar ruft ausschliesslich diese Hosts. Anders als bei den
 * Nachrichtenquellen gibt der Nutzer hier keine Adressen ein — es gibt also
 * auch keinen Grund, beliebige zuzulassen (vgl. `net-guard.js`, das für den
 * umgekehrten Fall gebaut ist).
 */
export const ERLAUBTE_HOSTS = new Set([
    // CoinGecko nur mit Kundenschlüssel (Demo bzw. Pro), auch für die On-Chain-Pools.
    'api.coingecko.com', 'pro-api.coingecko.com',
    'api.dexscreener.com',
    'api.gopluslabs.io',
    // Nur wenn der Kunde „RugCheck nutzen" eingeschaltet hat (Bedingungen ungeklärt).
    'api.rugcheck.xyz',
    // Projektprüfung und Frühphase (07.10.2026)
    'api.github.com',
    'a.4cdn.org',
    /*
     * Börsen-Beobachter: öffentliche Marktlisten, ohne Schlüssel. Binance läuft
     * über `server/marktdaten` (Wahl der Marktdatenquelle); Upbit, OKX, MEXC und
     * Binance Alpha sind aus Lizenzgründen entfernt (Verkaufs-Prüfung Z. 76, 78,
     * 82, 83). Coinbase, Kraken, KuCoin und Gate sind ab Werk aus (Z. 77, 79–81).
     */
    'api.exchange.coinbase.com', 'api.bybit.com', 'api.kraken.com', 'api.kucoin.com',
    'api.gateio.ws', 'api.bitget.com',
])

/**
 * Einfacher Eimer je Host.
 *
 * DexScreener lässt 60 Anfragen je Minute auf die Trend-Endpunkte und 300 auf
 * Suche und Paare. Ohne Bremse rennt ein Lauf mit hundert Kandidaten sofort in
 * ein 429, und dann fehlen genau die Detaildaten, auf denen die Bewertung
 * beruht.
 */
class Eimer {
    constructor(proMinute) {
        this.abstandMs = Math.ceil(60000 / proMinute)
        this.frei = 0
    }

    async warte() {
        const jetzt = Date.now()
        const start = Math.max(jetzt, this.frei)
        this.frei = start + this.abstandMs
        const warten = start - jetzt
        if (warten > 0) await new Promise((r) => setTimeout(r, warten))
    }
}

const EIMER = {
    'api.dexscreener.com': new Eimer(50),      // Reserve zu den erlaubten 60
    /*
     * CoinGecko-Demo: 30 Abrufe je Minute für ALLE Endpunkte zusammen —
     * seit S12 laufen auch die On-Chain-Pools (vormals GeckoTerminal, dort
     * gemessen nur fünf je Minute ohne Schlüssel) über dieses Kontingent.
     * Pro-Tarife haben mindestens 500 je Minute.
     */
    'api.coingecko.com': new Eimer(25),
    'pro-api.coingecko.com': new Eimer(250),
    'api.gopluslabs.io': new Eimer(30),
    // Ohne Schlüssel 60 Anfragen je STUNDE — der Zwischenspeicher der
    // Projektprüfung (24 h) ist die eigentliche Bremse, das hier nur die Reserve.
    'api.github.com': new Eimer(10),
    // 4chan verlangt höchstens eine Anfrage je Sekunde.
    'a.4cdn.org': new Eimer(30),
}

/**
 * Abruf mit Zeitgrenze, Bremse und einer Wiederholung.
 *
 * Wiederholt wird nur einmal und nur bei Netzfehlern oder 5xx: ein 404 wird
 * beim zweiten Mal auch nicht besser, und ein 429 wäre mit sofortigem
 * Nachfassen genau die falsche Antwort.
 */
export async function holeJson(url, { timeout = ABRUF_TIMEOUT_MS, kopf = {} } = {}) {
    const ziel = new URL(url)
    if (!ERLAUBTE_HOSTS.has(ziel.hostname)) {
        throw new Error(`Host nicht erlaubt: ${ziel.hostname}`)
    }
    await EIMER[ziel.hostname]?.warte()

    let letzterFehler
    for (let versuch = 0; versuch < 2; versuch++) {
        const abbruch = new AbortController()
        const uhr = setTimeout(() => abbruch.abort(), timeout)
        try {
            const r = await fetch(url, {
                signal: abbruch.signal,
                headers: {
                    // Eigene Kennung: manche Anbieter weisen anonyme Anfragen ab.
                    'User-Agent': 'AutarkTrade/4 (Hype-Radar)',
                    Accept: 'application/json',
                    ...kopf,
                },
            })
            if (!r.ok) {
                // Der Status am Fehler: „gibt es nicht" (404) ist für den Aufrufer etwas anderes als „gerade nicht".
                const fehler = Object.assign(new Error(`HTTP ${r.status}`), { status: r.status })
                /*
                 * 429 einmal nachfassen, nach der Wartezeit, die der Dienst
                 * nennt (höchstens fünfzehn, sonst zwölf Sekunden). Das Kontingent gilt je IP —
                 * NAS und Entwicklungsrechner teilen es —, und GeckoTerminal
                 * lässt am 10.10.2026 nur fünf Abfragen kurz hintereinander durch.
                 */
                if (r.status === 429) {
                    const sagt = Number(r.headers.get('retry-after'))
                    throw Object.assign(fehler, { warteMs: Number.isFinite(sagt) && sagt > 0 ? Math.min(15000, sagt * 1000) : 12000 })
                }
                // Sonst nur bei Serverfehlern nachfassen.
                if (r.status < 500) throw Object.assign(fehler, { endgueltig: true })
                throw fehler
            }
            return await r.json()
        } catch (e) {
            letzterFehler = e
            if (e.endgueltig || versuch === 1) break
            await new Promise((r) => setTimeout(r, e.warteMs || 800))
        } finally {
            clearTimeout(uhr)
        }
    }
    throw letzterFehler
}

/**
 * GET gegen die CoinGecko-API mit dem Schlüssel des Kunden — über `holeJson`,
 * damit die Ratenbremse alle CoinGecko-Abrufe des Hauses sieht.
 *
 * @param {string} pfad  z. B. `/search/trending`, `/onchain/networks/solana/new_pools?include=base_token`
 * @throws {QuelleAus} ohne hinterlegten Schlüssel (`schluesselFehlt`)
 */
export async function holeCoinGecko(pfad, opts = {}) {
    const { url, kopf } = await cgAnfrage(pfad)
    return holeJson(url, { ...opts, kopf: { ...kopf, ...(opts.kopf || {}) } })
}

/** CoinGecko-On-Chain-Netz (GeckoTerminal-Kennung) je Kette. */
export const ONCHAIN_NETZ = { solana: 'solana', ethereum: 'eth', base: 'base', bsc: 'bsc' }

/** Symbol vereinheitlichen — „$PEPE" und „pepe" sind derselbe Fund. */
export function normSymbol(roh) {
    return String(roh || '').trim().replace(/^\$/, '').toUpperCase().slice(0, 20)
}

/** Kettenname vereinheitlichen; die Quellen schreiben sie verschieden. */
export function normChain(roh) {
    const c = String(roh || '').trim().toLowerCase()
    const karte = {
        eth: 'ethereum', ethereum: 'ethereum',
        sol: 'solana', solana: 'solana',
        bsc: 'bsc', 'binance-smart-chain': 'bsc', bnb: 'bsc',
        base: 'base', arbitrum: 'arbitrum', 'arbitrum-one': 'arbitrum',
        polygon: 'polygon', 'polygon-pos': 'polygon', avalanche: 'avalanche',
    }
    return karte[c] || c
}

/**
 * Ein Fund, wie ihn jede Quelle liefert.
 *
 * Bewusst flach und tolerant: Fremdantworten haben ständig fehlende Felder,
 * und ein Fund ohne Preis ist immer noch ein Fund.
 */
export function fund({ symbol, name = '', chain = '', contract = '', pair = '', quelle, rang = 0, url = '', markt = {}, sozial = {} }) {
    return {
        symbol: normSymbol(symbol),
        name: String(name || '').slice(0, 120),
        chain: normChain(chain),
        contract: String(contract || '').trim(),
        pair: String(pair || '').trim(),
        quelle: { quelle, rang, url, geholtAm: Date.now() },
        markt,
        sozial,
    }
}

// ── Die einzelnen Quellen ────────────────────────────────────────────────
//
// Jede liefert eine Liste von Funden und wirft im Fehlerfall. Das Auffangen
// passiert eine Ebene höher, damit hier keine Quelle den Ausfall einer anderen
// verstecken kann.

/** CoinGecko: wonach gerade gesucht wird. Nur mit Kundenschlüssel. */
export async function ausCoinGecko() {
    const j = await holeCoinGecko('/search/trending')
    return (j?.coins || []).map((c, i) => fund({
        symbol: c?.item?.symbol,
        name: c?.item?.name,
        quelle: 'coingecko',
        rang: i + 1,
        url: c?.item?.slug ? `https://www.coingecko.com/en/coins/${c.item.slug}` : '',
        markt: {
            marketCapRang: c?.item?.market_cap_rank ?? null,
            preisUsd: Number(c?.item?.data?.price) || null,
            aenderung24h: Number(c?.item?.data?.price_change_percentage_24h?.usd) || null,
        },
    })).filter((f) => f.symbol)
}

/**
 * DexScreener: bezahlte Hervorhebungen und neue Profile.
 *
 * Wichtig zur Einordnung: „geboostet" heisst, dass jemand für Sichtbarkeit
 * bezahlt hat — das ist ein Aufmerksamkeitssignal, ausdrücklich kein
 * Gütesiegel. Genau deshalb zählt später, ob eine zweite Quelle zustimmt.
 */
export async function ausDexScreener() {
    const funde = []
    const [boosts, profile] = await Promise.allSettled([
        holeJson('https://api.dexscreener.com/token-boosts/top/v1'),
        holeJson('https://api.dexscreener.com/token-profiles/latest/v1'),
    ])

    if (boosts.status === 'fulfilled') {
        const liste = Array.isArray(boosts.value) ? boosts.value : []
        liste.slice(0, 30).forEach((b, i) => funde.push(fund({
            // Kein Symbol: die Trend-Endpunkte nennen nur die Adresse. Es
            // aus ihr zu basteln wäre ein Platzhalter, der später als echtes
            // Symbol gälte und jede Zusammenführung verhinderte.
            symbol: '',
            chain: b?.chainId,
            contract: b?.tokenAddress,
            quelle: 'dexscreener-boost',
            rang: i + 1,
            url: b?.url || '',
            markt: { links: linksAusInfo(b) },
            sozial: { boostGesamt: Number(b?.totalAmount) || 0 },
        })))
    }
    if (profile.status === 'fulfilled') {
        const liste = Array.isArray(profile.value) ? profile.value : []
        liste.slice(0, 30).forEach((p, i) => funde.push(fund({
            symbol: '',
            chain: p?.chainId,
            contract: p?.tokenAddress,
            quelle: 'dexscreener-neu',
            rang: i + 1,
            url: p?.url || '',
            markt: { links: linksAusInfo(p) },
        })))
    }
    if (!funde.length && boosts.status === 'rejected' && profile.status === 'rejected') {
        throw boosts.reason || profile.reason
    }
    return funde.filter((f) => f.contract)
}

/**
 * Detaildaten zu einem Vertrag nachschlagen.
 *
 * Die Trend-Endpunkte liefern kaum mehr als eine Adresse. Erst hier kommen
 * Liquidität, Volumen, Alter und das Kauf/Verkauf-Verhältnis dazu — die Zahlen,
 * auf denen Bewertung und Sicherheitsprüfung beruhen.
 */
export async function dexDetails(contract, opts = {}) {
    const karte = await dexDetailsViele([contract], opts)
    return karte.get(String(contract).toLowerCase()) || null
}

/** Wie viele Adressen DexScreener je Abruf annimmt — und wie viele PAARE er höchstens zurückgibt. */
const SAMMEL_GROESSE = 30

/** Unsere Kette als DexScreener-Kennung; '' heisst unbekannt (dann ohne Kette fragen). */
export function dexKette(chain) {
    const c = normChain(chain)
    return c && c !== '?' && /^[a-z0-9-]+$/.test(c) ? c : ''
}

/**
 * Die Abfragen planen: je Kette in Häppchen zu dreissig, Adressen ohne
 * bekannte Kette gesammelt für den Weg ohne Kette. Doppelte zählen einmal;
 * nennt nur einer der Einträge die Kette, gilt sie.
 *
 * @param {Array<string|{contract:string, chain?:string}>} eintraege
 * @returns {Array<{kette:string, adressen:string[]}>}
 */
export function dexAbfrageGruppen(eintraege = [], groesse = SAMMEL_GROESSE) {
    const je = new Map()
    for (const e of eintraege) {
        const istObjekt = e !== null && typeof e === 'object'
        const adresse = String(istObjekt ? e.contract || '' : e || '').trim()
        if (!adresse) continue
        const kette = istObjekt ? dexKette(e.chain) : ''
        const bisher = je.get(adresse.toLowerCase())
        if (!bisher) je.set(adresse.toLowerCase(), { adresse, kette })
        else if (!bisher.kette && kette) bisher.kette = kette
    }
    const nachKette = new Map()
    for (const { adresse, kette } of je.values()) {
        if (!nachKette.has(kette)) nachKette.set(kette, [])
        nachKette.get(kette).push(adresse)
    }
    const gruppen = []
    for (const [kette, liste] of nachKette) {
        for (let i = 0; i < liste.length; i += groesse) gruppen.push({ kette, adressen: liste.slice(i, i + groesse) })
    }
    return gruppen
}

/**
 * Was nach einer Antwort noch einmal gefragt werden muss.
 *
 * DexScreener deckelt die Antwort auf DREISSIG PAARE, nicht auf dreissig
 * Token. Am 07.10.2026 gemessen: Für die 150 Token eines Frühphasen-Laufs
 * kamen über `/latest/dex/tokens` nur 67 an — ein Token mit fünf Paaren
 * verdrängt vier andere, und die fehlen still, ohne Fehler, ohne Warnung.
 * Ist die Antwort voll und fehlt etwas, werden genau die Fehlenden noch einmal
 * gefragt (das Häppchen schrumpft dabei, also endet es). Bringt eine Kette gar
 * nichts, wird einmal ohne Kette nachgefragt — die Kennung kann falsch sein.
 *
 * @returns {null|{kette:string, adressen:string[], rueckfall:boolean}}
 */
export function dexNachfassen({ kette, adressen, rueckfall = false }, paareAnzahl, gefunden, groesse = SAMMEL_GROESSE) {
    const fehlend = adressen.filter((a) => !gefunden.has(String(a).toLowerCase()))
    if (!fehlend.length) return null
    if (paareAnzahl >= groesse && fehlend.length < adressen.length) return { kette, adressen: fehlend, rueckfall }
    if (kette && fehlend.length === adressen.length && !rueckfall) return { kette: '', adressen: fehlend, rueckfall: true }
    return null
}

/**
 * Jedes Paar der angefragten Adresse zuordnen — und zwar auf DER SEITE, auf
 * der sie steht.
 *
 * `dexDetails` las früher immer `baseToken`. Live geprüft: Für drei
 * angefragte Adressen kamen vier verschiedene Basis-Token zurück, weil eine
 * der Adressen in ihrem Paar die GEGENWÄHRUNG ist. Wer blind die Basisseite
 * nimmt, schreibt einem Fund Symbol, Name und Marktwerte eines fremden Tokens
 * zu — bei jungen Token ein Vertrauensbruch.
 */
function ordnePaareZu(paare, adressen, raus) {
    const gesucht = new Set(adressen.map((a) => String(a).toLowerCase()))
    for (const p of paare) {
        const basis = String(p?.baseToken?.address || '').toLowerCase()
        const gegen = String(p?.quoteToken?.address || '').toLowerCase()
        const seite = gesucht.has(basis) ? 'base' : (gesucht.has(gegen) ? 'quote' : null)
        if (!seite) continue
        const schluessel = seite === 'base' ? basis : gegen

        // Das liquideste Paar ist das aussagekräftigste: dort findet der
        // Handel statt.
        const bisher = raus.get(schluessel)
        const liqNeu = Number(p?.liquidity?.usd) || 0
        if (bisher && bisher._liq >= liqNeu) continue
        raus.set(schluessel, { ...ausPaar(p, seite), _liq: liqNeu })
    }
}

/**
 * Detaildaten für VIELE Verträge — in Häppchen zu dreissig, je Kette.
 *
 * Der Grund ist nicht Geschwindigkeit, sondern Reihenfolge. Die
 * DexScreener-Trendlisten liefern nur Adressen: kein Symbol, kein Alter, kein
 * Volumen. In der Vorsortierung bekamen diese Funde deshalb Volumen 0,
 * Neuheit 0 und Narrativ 0 — sie fielen bei rund zehn Punkten aus den besten
 * vierzig, BEVOR die Daten geholt wurden, die sie überhaupt bewertbar machen.
 * Ausgerechnet die frischesten Funde wurden so systematisch aussortiert.
 *
 * Mit bekannter Kette über `/tokens/v1/{kette}/{adressen}`: ein Paar je
 * Token, gemessen 149 von 150. Ohne Kette über `/latest/dex/tokens`, der alle
 * Paare liefert, aber höchstens dreissig — dort fasst `dexNachfassen` nach.
 *
 * @param {Array<string|{contract:string, chain?:string}>} eintraege
 *        Adressen, am besten mit Kette
 * @param {object} opts  `{streng: true}` reicht Abruffehler weiter, statt sie
 *                       als „nichts gefunden" zu verschlucken
 * @returns {Promise<Map<string, object>>} Adresse (klein) → Details
 */
export async function dexDetailsViele(eintraege = [], opts = {}) {
    const raus = new Map()
    const offen = dexAbfrageGruppen(eintraege)

    while (offen.length) {
        const gruppe = offen.shift()
        const liste = gruppe.adressen.map(encodeURIComponent).join(',')
        let paare = []
        try {
            const j = await holeJson(gruppe.kette
                ? `https://api.dexscreener.com/tokens/v1/${encodeURIComponent(gruppe.kette)}/${liste}`
                : `https://api.dexscreener.com/latest/dex/tokens/${liste}`)
            paare = Array.isArray(j) ? j : (Array.isArray(j?.pairs) ? j.pairs : [])
        } catch (e) {
            // Eine Kennung, die DexScreener nicht kennt (400/404), ist kein
            // Ausfall: dann eben ohne Kette. Ein 429 dagegen schon.
            if (gruppe.kette && !gruppe.rueckfall && /HTTP 40[04]\b/.test(e.message)) {
                offen.push({ kette: '', adressen: gruppe.adressen, rueckfall: true })
                continue
            }
            /*
             * Ein Häppchen, das klemmt, darf die übrigen nicht mitnehmen —
             * beim Sammeln. Wer dagegen wissen will, ob es einen Fund noch
             * GIBT (Erfolgskontrolle, Wachhund), darf einen Ausfall nicht mit
             * „kein Paar mehr" verwechseln.
             */
            if (opts.streng) throw e
            logWarn('hype-radar', `DexScreener-Sammelabruf: ${e.message}`)
            continue
        }
        ordnePaareZu(paare, gruppe.adressen, raus)
        const weiter = dexNachfassen(gruppe, paare.length, raus)
        if (weiter) offen.push(weiter)
    }

    for (const d of raus.values()) delete d._liq
    return raus
}

/**
 * Ein DexScreener-Paar in unsere Form bringen.
 *
 * @param {object} p      das Paar
 * @param {string} seite  'base' oder 'quote' — auf welcher Seite der gesuchte
 *                        Token steht. Davon hängt ab, wessen Symbol und Name
 *                        übernommen werden.
 */
function ausPaar(p, seite = 'base') {
    const roh = ausPaarBasis(p, seite)
    if (seite !== 'quote') return roh
    /*
     * Gegenseite: Was DexScreener über das Paar sagt, gilt der BASIS. Bis zum
     * 07.10.2026 stand hier nur ein Vermerk, und der ging bei der
     * Zusammenführung verloren — ein Fund auf der Gegenseite bekam still den
     * Preis, die Kursänderungen und das Kauf/Verkauf-Verhältnis des anderen
     * Tokens. Umrechnen lässt sich nur der Preis (priceUsd / priceNative);
     * alles andere gehört nicht ihm und bleibt leer. Volumen und Liquidität
     * sind Dollarsummen des PAARS und gelten für beide Seiten.
     */
    const basisUsd = Number(p?.priceUsd)
    const basisInGegen = Number(p?.priceNative)
    const m = roh.markt
    return {
        ...roh,
        markt: {
            ...m,
            preisUsd: basisUsd > 0 && basisInGegen > 0 ? basisUsd / basisInGegen : null,
            aenderung24h: null, aenderung6h: null, aenderung1h: null, aenderung5m: null,
            fdv: null, marktkapitalisierung: null,
            // Wer die Basis kauft, verkauft die Gegenseite — das Verhältnis kehrt sich um.
            kaufVerkaufVerhaeltnis: umgekehrt(m.kaufVerkaufVerhaeltnis),
            kaufVerkauf1h: umgekehrt(m.kaufVerkauf1h),
            kaeufe1h: m.verkaeufe1h,
            verkaeufe1h: m.kaeufe1h,
            boosts: 0, webseiten: null, kanaele: null, links: null,
        },
    }
}

const umgekehrt = (v) => (v === null || v === undefined ? null : (v === 99 ? 0 : (v > 0 ? 1 / v : 99)))

function ausPaarBasis(p, seite) {
    const token = seite === 'quote' ? p?.quoteToken : p?.baseToken
    const kaeufe = Number(p?.txns?.h24?.buys) || 0
    const verkaeufe = Number(p?.txns?.h24?.sells) || 0
    return {
        symbol: normSymbol(token?.symbol),
        name: token?.name || '',
        chain: normChain(p?.chainId),
        pair: p?.pairAddress || '',
        url: p?.url || '',
        /*
         * Steht der gesuchte Token auf der Gegenseite, beziehen sich Preis,
         * Volumen und Liquidität des Paars NICHT auf ihn. Der Hinweis bleibt
         * am Fund, statt still falsche Zahlen zu übernehmen.
         */
        seite,
        markt: {
            // Der Handelsplatz selbst (raydium, uniswap, pancakeswap …) — die
            // Antwort auf „wo läuft das eigentlich", die sonst erst ein Klick
            // auf DexScreener beantwortet hätte. In `markt`, weil die
            // Zusammenführung nur diese Felder überträgt.
            dex: String(p?.dexId || ''),
            preisUsd: Number(p?.priceUsd) || null,
            // Fehlt die Angabe (Bindungskurven nennen keine), bleibt sie
            // unbekannt — eine 0 hiesse „Pool leer" und löste beim Wachhund
            // einen kritischen Alarm aus.
            liquiditaetUsd: zahlOderNull(p?.liquidity?.usd),
            volumen24h: Number(p?.volume?.h24) || 0,
            volumen6h: Number(p?.volume?.h6) || 0,
            volumen1h: Number(p?.volume?.h1) || 0,
            fdv: Number(p?.fdv) || 0,
            marktkapitalisierung: Number(p?.marketCap) || 0,
            aenderung24h: zahlOderNull(p?.priceChange?.h24),
            /*
             * Die kurzen Fenster sind das eigentliche Frühsignal.
             *
             * Bisher wurde nur die Tagesveränderung behalten — bei einem Coin,
             * der in der letzten Stunde um 238 % gestiegen ist, sagt die aber
             * nichts über das, was gerade passiert. DexScreener liefert alle
             * vier Fenster im selben Abruf; sie wegzuwerfen war schlicht
             * verschenkt.
             */
            aenderung6h: zahlOderNull(p?.priceChange?.h6),
            aenderung1h: zahlOderNull(p?.priceChange?.h1),
            aenderung5m: zahlOderNull(p?.priceChange?.m5),
            paarAlterStunden: p?.pairCreatedAt
                ? Math.max(0, (Date.now() - Number(p.pairCreatedAt)) / 3600000)
                : null,
            kaufVerkaufVerhaeltnis: verkaeufe > 0 ? kaeufe / verkaeufe : (kaeufe > 0 ? 99 : null),
            transaktionen24h: kaeufe + verkaeufe,
            // Ohne Fenster unbekannt, nicht 0 — die Frühphase verwirft bei 0 („still").
            transaktionen1h: p?.txns?.h1 ? (Number(p.txns.h1.buys) || 0) + (Number(p.txns.h1.sells) || 0) : null,
            // Die Erfolgskontrolle fragt „wird noch gehandelt" — dafür die letzten sechs Stunden.
            transaktionen6h: p?.txns?.h6 ? (Number(p.txns.h6.buys) || 0) + (Number(p.txns.h6.sells) || 0) : null,
            // Die letzten fünf Minuten — für die Frühphase das Mass, ob der
            // Handel innerhalb der Stunde gerade anzieht.
            transaktionen5m: p?.txns?.m5 ? (Number(p.txns.m5.buys) || 0) + (Number(p.txns.m5.sells) || 0) : null,
            kaufVerkauf1h: verhaeltnis(p?.txns?.h1),
            // Rohe Zahlen: das Verhältnis ist bei null Verkäufen 99 und taugt
            // ohne Mindestmenge nicht als Befund (Frühphase, „einseitig").
            kaeufe1h: p?.txns?.h1 ? Number(p.txns.h1.buys) || 0 : null,
            verkaeufe1h: p?.txns?.h1 ? Number(p.txns.h1.sells) || 0 : null,
            /*
             * BEZAHLTE SICHTBARKEIT — der Wert, um den es hier eigentlich geht.
             *
             * Ein „Boost" ist ein gekaufter Platz in den DexScreener-Listen.
             * Der Radar warnt an mehreren Stellen vor gekauftem Lärm und hat
             * ihn bisher nur aus dem Missverhältnis zwischen Gerede und Handel
             * ERSCHLOSSEN — dabei steht er hier als Zahl. Wer sich Reichweite
             * kauft, soll dafür keine Aufmerksamkeitspunkte bekommen.
             */
            boosts: Number(p?.boosts?.active) || 0,
            // Vorhandensein von Seite und Kanälen: kein Beweis für Substanz,
            // aber ihr Fehlen ist ein Hinweis. Nur die Anzahl, keine Adressen —
            // die Anzeige verlinkt ohnehin auf DexScreener.
            webseiten: (p?.info?.websites || []).length,
            kanaele: (p?.info?.socials || []).length,
            // Kein Token-Bild: Logos sind fremde Inhalte (Verkaufs-Prüfung Z. 58),
            // die Oberfläche zeichnet Ticker-Initialen.
            /*
             * Die Adressen selbst, nicht nur ihre Anzahl — die Projektprüfung
             * liest die Webseite und sucht das Team dahinter. Gedeckelt, damit
             * die gespeicherten Marktdaten klein bleiben.
             */
            links: linksAusInfo(p?.info),
        },
    }
}

/*
 * `Number(null)` ist 0 — und `Number.isFinite(0)` wahr. Ohne die Vorprüfung
 * wurde eine fehlende Kursänderung zu „0 %", also zu einer Messung.
 */
/**
 * Webseiten und Kanäle eines Tokens in einer Form — aus DexScreener
 * (`info.websites`/`info.socials`, Profile und Boosts `links`).
 *
 * @returns {{webseiten:string[], kanaele:Array<{typ:string, url:string}>}|null}
 */
export function linksAusInfo(info) {
    if (!info || typeof info !== 'object') return null
    const url = (u) => {
        const t = String(u || '').trim()
        return /^https?:\/\//i.test(t) ? t.slice(0, 300) : ''
    }
    const webseiten = []
    const kanaele = []
    for (const w of info.websites || []) if (url(w?.url)) webseiten.push(url(w.url))
    for (const k of info.socials || []) if (url(k?.url)) kanaele.push({ typ: String(k?.type || '').toLowerCase(), url: url(k.url) })
    // Profile und Boosts nennen ihre Links gemischt in `links`.
    for (const l of info.links || []) {
        const u = url(l?.url)
        if (!u) continue
        const typ = String(l?.type || l?.label || '').toLowerCase()
        if (!typ || typ === 'website' || typ === 'web') webseiten.push(u)
        else kanaele.push({ typ, url: u })
    }
    if (!webseiten.length && !kanaele.length) return null
    return { webseiten: [...new Set(webseiten)].slice(0, 3), kanaele: kanaele.slice(0, 6) }
}

const zahlOderNull = (w) => (w === null || w === undefined || w === ''
    ? null
    : (Number.isFinite(Number(w)) ? Number(w) : null))

const verhaeltnis = (t) => {
    const k = Number(t?.buys) || 0
    const v = Number(t?.sells) || 0
    if (v > 0) return k / v
    return k > 0 ? 99 : null
}

/**
 * On-Chain-Trend (CoinGecko `/onchain/…`, vormals die öffentliche
 * GeckoTerminal-API): was on-chain gerade läuft, je Kette. Nur mit
 * Kundenschlüssel — fehlt er, wirft der erste Abruf `QuelleAus`, und die
 * Quelle steht im Lauf als „aus".
 */
export async function ausGeckoTerminal(ketten = ['solana', 'eth', 'base', 'bsc']) {
    const funde = []
    for (const kette of ketten) {
        try {
            /*
             * `include=base_token` liefert den Basis-Token als eigenes Objekt.
             *
             * Vorher entstand das Symbol aus `poolName.split('/')[0]` — also
             * aus einer Zeichenkette, die zufällig so aussieht wie ein Symbol.
             * Zwei Folgen: Bei einem Pool wie „USDC / MEME" wurde die
             * Gegenwährung zum Fund, und es gab NIE eine Vertragsadresse.
             * Ohne Adresse kann weder der Detailabruf noch die
             * Sicherheitsprüfung etwas ausrichten — jeder GeckoTerminal-Fund
             * landete zwangsläufig bei „ungeprüft" und war damit von vornherein
             * chancenlos. Die Beziehung stand die ganze Zeit in derselben
             * Antwort.
             */
            const j = await holeCoinGecko(
                `/onchain/networks/${encodeURIComponent(ONCHAIN_NETZ[normChain(kette)] || kette)}/trending_pools?include=base_token`)
            const liste = Array.isArray(j?.data) ? j.data : []
            const tokens = new Map((Array.isArray(j?.included) ? j.included : [])
                .filter((t) => t?.type === 'token')
                .map((t) => [t.id, t.attributes || {}]))

            liste.slice(0, 15).forEach((p, i) => {
                const basisId = p?.relationships?.base_token?.data?.id
                const basis = tokens.get(basisId) || {}
                // Notfalls die erste Seite des Poolnamens — aber nur, wenn die
                // Beziehung fehlt; sie ist die verlässliche Quelle.
                const symbol = basis.symbol || String(p?.attributes?.name || '').split('/')[0]
                const a = p?.attributes || {}
                funde.push(fund({
                    symbol,
                    name: basis.name || String(symbol).trim(),
                    chain: kette,
                    contract: basis.address || '',
                    pair: a.address || '',
                    quelle: 'geckoterminal',
                    rang: i + 1,
                    markt: {
                        preisUsd: Number(a.base_token_price_usd) || null,
                        volumen24h: Number(a.volume_usd?.h24) || 0,
                        liquiditaetUsd: Number(a.reserve_in_usd) || 0,
                        // Ebenfalls in derselben Antwort und bisher liegen
                        // gelassen: Alter und Bewertung tragen unmittelbar in
                        // die Neuheits- und Sicherheitsnote.
                        fdv: Number(a.fdv_usd) || 0,
                        marktkapitalisierung: Number(a.market_cap_usd) || 0,
                        aenderung24h: zahlOderNull(a.price_change_percentage?.h24),
                        aenderung1h: zahlOderNull(a.price_change_percentage?.h1),
                        paarAlterStunden: a.pool_created_at
                            ? Math.max(0, (Date.now() - new Date(a.pool_created_at).getTime()) / 3600000)
                            : null,
                    },
                }))
            })
        } catch (e) {
            // Ohne Schlüssel ist die ganze Quelle aus — nicht je Kette weiterversuchen.
            if (istAus(e)) throw e
            // Eine Kette, die klemmt, darf die übrigen nicht mitnehmen.
            logWarn('hype-radar', `CoinGecko On-Chain ${kette}: ${e.message}`)
        }
    }
    if (!funde.length) throw new Error('keine Kette lieferte Daten')
    return funde.filter((f) => f.symbol)
}

/**
 * Funde zu Kandidaten zusammenführen.
 *
 * Zusammengeführt wird bevorzugt über die Vertragsadresse — sie ist eindeutig,
 * während Symbole sich wiederholen: „PEPE" gibt es auf vier Ketten und
 * hundertfach als Nachahmung. Nur wo keine Adresse vorliegt (CoinGecko),
 * dient Symbol samt Kette als Notbehelf (CoinGecko liefert keine Adresse).
 */
export function fuehreZusammen(funde) {
    const nachSchluessel = new Map()

    for (const f of funde) {
        /*
         * Die VERTRAGSADRESSE führt, das Symbol ist der Notbehelf.
         *
         * Bis zum Audit vom 19.08.2026 war es umgekehrt — und der
         * Kopfkommentar dieser Funktion behauptete schon damals das Richtige,
         * ohne dass der Code es tat. Der Grund für die Umkehrung ist im
         * Kommentar von damals nachlesbar und war für seine Zeit korrekt:
         * DexScreener lieferte Adressen ohne Symbol, CoinGecko Symbole ohne
         * Adresse, die Schlüssel trafen sich nie und die Quellenzahl blieb 1.
         *
         * Seit R-03 (Sammelanreicherung vor der Vorsortierung) haben die
         * DexScreener-Funde ihr Symbol, bevor zusammengeführt wird — der Grund
         * ist damit weg. Geblieben war nur die Gefahr: „PEPE" gibt es auf vier
         * Ketten und hundertfach als Nachahmung. Zwei verschiedene Verträge
         * mit gleichem Kürzel wurden zu EINEM Kandidaten, der die Quellenzahl,
         * die Marktdaten und das Sicherheitsurteil des jeweils anderen erbte.
         * Bei jungen Token ist das kein Schönheitsfehler.
         */
        const vertrag = String(f.contract || '').toLowerCase()
        const schluessel = vertrag
            ? `c:${f.chain || '?'}|${vertrag}`
            : (f.symbol ? `s:${f.symbol}|${f.chain || '?'}` : '')
        if (!schluessel) continue

        if (!nachSchluessel.has(schluessel)) {
            nachSchluessel.set(schluessel, {
                symbol: f.symbol,
                name: f.name,
                chain: f.chain,
                contract: f.contract,
                pair: f.pair,
                /*
                 * Die Seite des Paars wandert mit. Bis zum 07.10.2026 ging sie
                 * hier verloren — der Vermerk „Preis und Volumen gehören der
                 * Gegenseite" kam nie bei der Bewertung an.
                 */
                seite: f.seite,
                quellen: [],
                markt: {},
                sozial: {},
            })
        }
        const k = nachSchluessel.get(schluessel)
        // Nimmt beide Formen an: einen frischen Fund (`quelle`) und einen
        // bereits zusammengeführten Kandidaten (`quellen`). Der zweite
        // Durchgang nach dem Detailabruf braucht das.
        if (Array.isArray(f.quellen)) k.quellen.push(...f.quellen)
        if (f.quelle) k.quellen.push(f.quelle)
        // Erste brauchbare Angabe gewinnt; spätere füllen nur Lücken.
        if (!k.symbol && f.symbol) k.symbol = f.symbol
        if (!k.name && f.name) k.name = f.name
        if (!k.chain && f.chain) k.chain = f.chain
        if (!k.contract && f.contract) k.contract = f.contract
        if (!k.pair && f.pair) k.pair = f.pair
        if (!k.seite && f.seite) k.seite = f.seite
        Object.assign(k.markt, Object.fromEntries(
            Object.entries(f.markt || {}).filter(([, v]) => v !== null && v !== undefined)))
        fuegeSozialHinzu(k.sozial, f.sozial)
    }

    /*
     * Zwei Nachlesen, beide nach derselben Regel: Ein ungenauerer Eintrag
     * schliesst sich einem genaueren an — aber NUR, wenn es genau einen
     * passenden gibt. Bei mehreren bliebe es Raten, und ein falsch
     * verschmolzener Kandidat ist schlimmer als ein doppelter: er trüge die
     * Quellenzahl und das Sicherheitsurteil eines anderen Coins.
     */
    // 1. Symbol samt Kette, aber ohne Adresse → Eintrag mit Adresse.
    //    Betrifft CoinGecko, das keine Adresse nennt.
    schliesseAn(nachSchluessel,
        (sl, k) => sl.startsWith('s:') && k.chain && k.chain !== '?',
        (k, k2) => k2.contract && k2.symbol === k.symbol && k2.chain === k.chain)

    // 2. Symbol ohne Kette → irgendein Eintrag mit diesem Symbol.
    //    „PEPE ohne Kette" und „PEPE auf solana" sind mit hoher
    //    Wahrscheinlichkeit derselbe Fund — solange es nur einen gibt.
    schliesseAn(nachSchluessel,
        (sl) => sl.startsWith('s:') && sl.endsWith('|?'),
        (k, k2) => k2.symbol === k.symbol && k2.chain && k2.chain !== '?')

    return [...nachSchluessel.values()].map((k) => {
        const domaenen = evidenzDomaenen(k.quellen)
        return {
            ...k,
            /*
             * Die entscheidende Zahl: aus wie vielen unabhängigen EVIDENZ-
             * DOMÄNEN stammt der Fund — nicht aus wie vielen Anbietern.
             *
             * Bis zum Audit vom 19.08.2026 wurden Anbieter gezählt (die beiden
             * DexScreener-Endpunkte immerhin schon als einer). Nur lesen
             * DexScreener und GeckoTerminal DIESELBEN On-chain-Pools: ein
             * einzelner Pump löst beide zugleich aus und sah damit aus wie
             * zwei unabhängige Bestätigungen. Da diese Zahl der stärkste
             * Einzelfaktor gegen gekauften Lärm ist, war das die teuerste
             * Lücke der Bewertung.
             *
             * Mehrere Anbieter derselben Domäne erhöhen die Datenqualität,
             * nicht die Bestätigung.
             */
            quellenAnzahl: domaenen.length,
            evidenzDomaenen: domaenen,
            // Die Anbieterzahl bleibt sichtbar: sie erklärt, warum eine Zahl
            // kleiner ausfällt als die Liste der Quellen vermuten liesse.
            anbieterAnzahl: new Set(k.quellen.map((q) => String(q.quelle).split('-')[0])).size,
        }
    })
}

/**
 * Welcher Quelle welche Art von Beleg zuzurechnen ist.
 *
 * `discovery`  jemand hat den Fund in eine Liste gestellt (Suchinteresse,
 *              bezahlte Sichtbarkeit, neues Profil) — sagt nichts über Handel
 * `onchain`    tatsächlicher Handel in einem Pool. DexScreener und
 *              GeckoTerminal aggregieren dieselben Pools; zwei Anbieter, EIN
 *              Beleg.
 * `social`     Menschen reden darüber
 * `news`       redaktionelle Erwähnung
 */
const QUELL_DOMAENE = {
    coingecko: 'discovery',
    'dexscreener-boost': 'discovery',    // bezahlt — ausdrücklich kein Handelsbeleg
    'dexscreener-neu': 'discovery',      // frisch eingereichtes Profil
    dexscreener: 'onchain',
    geckoterminal: 'onchain',
    /*
     * Aus der Frühphase übernommen (07.10.2026): Der Token wurde dort über
     * Stunden beobachtet — das ist gehandelte Kette. Wo er auf /biz/ oder X
     * genannt wurde, zählt das als eigene Domäne `social`.
     *
     * Seit S12 (19.10.2026) ist das die EINZIGE Herkunft der Domäne `social`:
     * Reddit und die Telegram-Kanäle sind aus Lizenzgründen entfernt. Ohne
     * Frühphase gibt es im Hauptlauf keine Sozialmessung mehr — die Teilnote
     * ist dann unbekannt (`noteSozial` → null), nicht 0.
     */
    fruehphase: 'onchain',
    biz: 'social',
    // X über Grok — nur gezählte, zitierte Posts verschiedener Autoren.
    x: 'social',
}

/*
 * Wie zwei Angaben desselben Sozialfelds zusammengehen.
 *
 * Bis zum 07.10.2026 wurde jede Zahl addiert („drei Nennungen sind mehr als
 * eine") — auch der Reddit-RANG, bei dem eine kleinere Zahl besser ist. Zwei
 * Erwähnungen auf Platz 30 und 35 wurden zu Platz 65 und damit zu null
 * Punkten; ein Fund verlor Note, je öfter über ihn gesprochen wurde. Ränge
 * nehmen jetzt den besten Platz, Mengen werden gezählt, und derselbe Boost
 * aus zwei Durchgängen der Zusammenführung zählt einmal.
 */
const SOZIAL_ZUSAMMEN = {
    boostGesamt: (a, b) => Math.max(a, b),
    // Dieselbe Beobachtung, zweimal gemeldet, ist keine zweite Plattform.
    fruehPlattformen: (a, b) => Math.max(a, b),
}

export function fuegeSozialHinzu(ziel, quelle) {
    for (const [feld, wert] of Object.entries(quelle || {})) {
        if (wert === null || wert === undefined) continue
        if (typeof wert !== 'number' || !(feld in ziel)) {
            ziel[feld] = wert
            continue
        }
        const regel = SOZIAL_ZUSAMMEN[feld]
        ziel[feld] = regel ? regel(ziel[feld], wert) : ziel[feld] + wert
    }
}

/** Die belegten Domänen eines Kandidaten, ohne Wiederholung. */
export function evidenzDomaenen(quellen = []) {
    const raus = new Set()
    for (const q of quellen) {
        const name = String(q?.quelle || '')
        // Erst der volle Name (`dexscreener-boost`), dann der Anbieter.
        const d = QUELL_DOMAENE[name] || QUELL_DOMAENE[name.split('-')[0]]
        if (d) raus.add(d)
    }
    return [...raus]
}

/**
 * Einen ungenaueren Eintrag einem genaueren anschliessen — nur bei
 * Eindeutigkeit.
 *
 * @param {Map} karte     Schlüssel → Kandidat
 * @param {function} istVage   (schluessel, kandidat) → ist das ein Anwärter?
 * @param {function} passt     (vager, anderer) → gehören sie zusammen?
 */
function schliesseAn(karte, istVage, passt) {
    for (const [schluessel, k] of [...karte.entries()]) {
        if (!karte.has(schluessel) || !istVage(schluessel, k)) continue
        const treffer = [...karte.entries()]
            .filter(([s2, k2]) => s2 !== schluessel && passt(k, k2))
        if (treffer.length !== 1) continue

        const [, ziel] = treffer[0]
        ziel.quellen.push(...k.quellen)
        if (!ziel.name && k.name) ziel.name = k.name
        if (!ziel.contract && k.contract) ziel.contract = k.contract
        if (!ziel.pair && k.pair) ziel.pair = k.pair
        for (const [feld, wert] of Object.entries(k.markt)) {
            if (ziel.markt[feld] === undefined) ziel.markt[feld] = wert
        }
        if (!ziel.seite && k.seite) ziel.seite = k.seite
        fuegeSozialHinzu(ziel.sozial, k.sozial)
        karte.delete(schluessel)
    }
}

/**
 * Stufe 1 im Ganzen.
 *
 * @param {object} opts
 * @param {string[]} opts.ketten    On-Chain-Ketten
 * @param {object} opts.quellen     Schalter je Quelle
 * @returns {Promise<{kandidaten: object[], quellenStand: object}>}
 */
export async function sammle({ ketten, quellen = {} } = {}) {
    const an = (name) => quellen[name] !== false
    const aufgaben = []

    if (an('coingecko')) aufgaben.push(['coingecko', () => ausCoinGecko()])
    if (an('dexscreener')) aufgaben.push(['dexscreener', () => ausDexScreener()])
    if (an('geckoterminal')) aufgaben.push(['geckoterminal', () => ausGeckoTerminal(ketten)])

    const ergebnisse = await Promise.allSettled(aufgaben.map(([, f]) => f()))

    const quellenStand = {}
    const alleFunde = []
    ergebnisse.forEach((e, i) => {
        const name = aufgaben[i][0]
        if (e.status === 'fulfilled') {
            quellenStand[name] = { ok: true, anzahl: e.value.length }
            alleFunde.push(...e.value)
        } else if (istAus(e.reason)) {
            // Kein Ausfall, sondern ein Zustand: ohne Kundenschlüssel ist die Quelle aus.
            quellenStand[name] = { ok: false, ...ausAntwort(e.reason), fehler: e.reason.message }
        } else {
            quellenStand[name] = { ok: false, fehler: String(e.reason?.message || e.reason).slice(0, 200) }
            logWarn('hype-radar', `Quelle ${name} ausgefallen: ${quellenStand[name].fehler}`)
        }
    })

    return { kandidaten: fuehreZusammen(alleFunde), quellenStand }
}
