/**
 * Projekt-Infos zu einem Coin: was ist das, wer steckt dahinter, wo ist die
 * Website — für den Klick auf ein Symbol im Coin-Radar.
 *
 * Quelle ist CoinGecko (`search` zum Auflösen des Handelssymbols auf eine
 * CoinGecko-Id, `coins/{id}` für die eigentlichen Angaben) — NUR mit dem
 * Schlüssel des Kunden (Verkaufs-Prüfung Z. 87, S12) oder — seit S15 mit dem
 * Schalter „Quellen mit eingeschränkten Nutzungsbedingungen" an — über den öffentlichen
 * Endpunkt wie vor S12 (zentral in `server/quellen/coingecko.js`). Ist beides
 * nicht da, wirft der Abruf `QuelleAus('CoinGecko', 'schluesselFehlt')`, und
 * die Route sagt das.
 * Gefragt wird über `holeCoinGecko` des Hype-Radars, damit die gemeinsame
 * Ratenbremse alle CoinGecko-Abrufe des Hauses sieht. Die Anzeige trägt
 * „Powered by CoinGecko" (API-Terms §4.4).
 *
 * Bild nur mit Schalter an (ID `tokenbilder`): Coin-Logos sind fremde Inhalte
 * (Terms 4(A), Verkaufs-Prüfung Z. 58). Mit Schalter AUS fehlt `bild`, und die
 * Oberfläche zeichnet Ticker-Initialen (Stand S12). Der Zwischenspeicher
 * behält das Bild immer; entfernt wird es beim Ausliefern, damit ein
 * umgelegter Schalter sofort gilt.
 *
 * Coin-Ansicht (16.11.2026): Aus DERSELBEN Antwort von `coins/{id}` — sie wird
 * seit jeher mit `market_data=true` geholt — liest `stammdatenAus` jetzt auch
 * Marktdaten, Mengen, Allzeithoch/-tief, Genesis-Datum und die übrigen Links.
 * Kein zusätzlicher Abruf, dieselbe Ratenbremse, derselbe 24-h-Vorrat. Darum
 * trägt `markt.stand`, von wann die Zahlen sind: Kurs und Umsatz sind bis zu
 * einem Tag alt und nur Massstab (Mengen, Allzeithoch) — den aktuellen Kurs
 * nimmt die Ansicht von der Börse.
 *
 * ⚠ CoinGecko führt seit Jahren KEIN strukturiertes „Team"-Feld mehr. Was
 * hier steht, ist die Projektbeschreibung plus Links — daraus lässt sich ein
 * Team allenfalls lesen, nicht zuverlässig ableiten. Kein Feld täuscht das vor.
 */

import { holeCoinGecko } from '../hype-radar/quellen.js'
import { logWarn } from '../logger.js'
import { ohneTags } from '../html-zerlegen.js'
import { quelleErlaubt } from '../quellen/freigabe.js'

/** Projektinfos ändern sich kaum — ein Tag Cache ist grosszügig, nicht knapp. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const cache = new Map()   // Basissymbol -> { ts, daten: object|null }

/** Wie bei der Listungsprüfung: USDT-Endung und 1000er-Bündelung runter. */
function basisVon(symbol) {
    return String(symbol || '').toUpperCase().replace(/USDT$/, '').replace(/^1000+/, '')
}

/**
 * @param {string} symbol  Handelssymbol, z.B. "BSBUSDT"
 * @returns {Promise<object|null>}  null = nicht gefunden, nicht „Fehler beim Abruf"
 * @throws {QuelleAus} ohne CoinGecko-Schlüssel
 */
export async function holeCoinInfo(symbol) {
    const daten = await holeCoinInfoRoh(symbol)
    if (!daten || !daten.bild || (await quelleErlaubt('tokenbilder'))) return daten
    const { bild, ...ohneBild } = daten
    return ohneBild
}

async function holeCoinInfoRoh(symbol) {
    const basis = basisVon(symbol)
    if (!basis) return null

    const alt = cache.get(basis)
    if (alt && Date.now() - alt.ts < CACHE_TTL_MS) return alt.daten

    let treffer
    try {
        const suche = await holeCoinGecko(`/search?query=${encodeURIComponent(basis)}`)
        const kandidaten = suche?.coins || []
        // Exakter Symbol-Treffer mit dem kleinsten (= bedeutendsten) Rang zuerst
        // — bei mehrdeutigen Tickern (z.B. "BSB": Rang 747 UND Rang 7004) ist das
        // Perpetual auf einer grossen Börse fast immer der prominentere.
        treffer = kandidaten
            .filter((c) => String(c?.symbol || '').toUpperCase() === basis)
            .sort((a, b) => (a.market_cap_rank ?? Infinity) - (b.market_cap_rank ?? Infinity))[0]
        /*
         * Kein exakter Treffer heisst „nicht gefunden" — nicht „der erste
         * Suchtreffer". Bis zum 07.10.2026 stand hier `|| kandidaten[0]`, und
         * die Seite zeigte die Beschreibung eines ANDEREN Projekts als
         * Auskunft über diesen Coin.
         */
    } catch (e) {
        logWarn('coin-radar', `Coin-Info: Suche nach "${basis}" fehlgeschlagen: ${e.message}`)
        throw e   // Netzfehler ≠ „nicht gefunden" — nicht cachen, nicht als leer melden
    }
    if (!treffer?.id) {
        cache.set(basis, { ts: Date.now(), daten: null })
        return null
    }

    let j
    try {
        j = await holeCoinGecko(`/coins/${encodeURIComponent(treffer.id)}`
            + '?localization=false&tickers=false&market_data=true&community_data=false'
            + '&developer_data=false&sparkline=false')
    } catch (e) {
        logWarn('coin-radar', `Coin-Info: Details zu "${treffer.id}" fehlgeschlagen: ${e.message}`)
        throw e
    }

    const daten = stammdatenAus(j, treffer, basis)
    cache.set(basis, { ts: Date.now(), daten })
    return daten
}

/** `null` bleibt `null`: `Number(null)` wäre 0 und damit eine Behauptung. */
function zahl(w) {
    if (w === null || w === undefined || w === '') return null
    const n = Number(w)
    return Number.isFinite(n) ? n : null
}
/** Wie `zahl`, aber nur echte Grössen — eine Menge oder ein Kurs von 0 ist „nicht gemeldet". */
const positiv = (w) => { const n = zahl(w); return n !== null && n > 0 ? n : null }
const zeit = (w) => { const t = w ? Date.parse(w) : NaN; return Number.isFinite(t) ? t : null }
const texte = (liste) => (Array.isArray(liste) ? liste.filter((x) => typeof x === 'string' && x.trim()) : [])

/**
 * Die Antwort von `coins/{id}` in die Form des Hauses bringen — rein, damit
 * die gelesenen Felder ohne Netz prüfbar sind (`__selftest-coin-info.mjs`
 * gegen `server/fixtures/coingecko-coin-handgeschrieben.json`).
 *
 * Alles in USD. Unbekanntes ist `null`, nie 0: Eine Höchstmenge von 0 hiesse
 * „es gibt keine Coins", gemeint ist „CoinGecko nennt keine".
 *
 * @param {object} j        Antwort von `coins/{id}`
 * @param {object} treffer  der Suchtreffer (`id`, `name`, `thumb`, `market_cap_rank`)
 * @param {string} basis    Basissymbol, z. B. "BTC"
 */
export function stammdatenAus(j, treffer = {}, basis = '') {
    const m = j?.market_data || {}
    const usd = (feld) => zahl(feld?.usd)
    const hoechst = positiv(m.max_supply)
    return {
        id: String(j?.id || treffer?.id || ''),
        name: j?.name || treffer?.name || basis,
        symbol: String(j?.symbol || basis).toUpperCase(),
        bild: j?.image?.small || treffer?.thumb || '',
        // CoinGecko liefert die Beschreibung mit HTML-Links; angezeigt wird Text.
        // Linear statt `<[^>]*>` (SEC-SRV-001: quadratisch bei `<` ohne `>`).
        beschreibung: ohneTags(String(j?.description?.en || ''), '', { leer: true }).trim(),
        kategorien: Array.isArray(j?.categories) ? j.categories.filter(Boolean) : [],
        marketCapRang: j?.market_cap_rank ?? treffer?.market_cap_rank ?? null,
        homepage: texte(j?.links?.homepage)[0] || '',
        whitepaper: typeof j?.links?.whitepaper === 'string' ? j.links.whitepaper : '',
        twitter: j?.links?.twitter_screen_name ? `https://x.com/${j.links.twitter_screen_name}` : '',
        telegram: j?.links?.telegram_channel_identifier ? `https://t.me/${j.links.telegram_channel_identifier}` : '',
        github: texte(j?.links?.repos_url?.github)[0] || '',
        explorer: texte(j?.links?.blockchain_site)[0] || '',
        reddit: typeof j?.links?.subreddit_url === 'string' ? j.links.subreddit_url : '',
        forum: texte(j?.links?.official_forum_url)[0] || '',
        coingeckoUrl: `https://www.coingecko.com/en/coins/${j?.id || treffer?.id || ''}`,
        // Verträge je Kette, wie CoinGecko sie führt — für die Tiefensuche.
        plattformen: j?.platforms && typeof j.platforms === 'object' ? j.platforms : {},
        // „2009-01-03" → ms (UTC). Fehlt bei den meisten jüngeren Token.
        genesis: zeit(j?.genesis_date),
        algorithmus: typeof j?.hashing_algorithm === 'string' ? j.hashing_algorithm : '',
        markt: {
            stand: zeit(m.last_updated || j?.last_updated),
            preisUsd: positiv(usd(m.current_price)),
            marktkapUsd: positiv(usd(m.market_cap)),
            // CoinGecko rechnet die FDV mit der Höchst-, sonst der Gesamtmenge.
            fdvUsd: positiv(usd(m.fully_diluted_valuation)),
            umsatz24hUsd: positiv(usd(m.total_volume)),
            umlauf: positiv(m.circulating_supply),
            gesamt: positiv(m.total_supply),
            hoechst,
            // Ausdrücklich unbegrenzt (ETH, DOGE) ist etwas anderes als „nicht gemeldet".
            hoechstUnbegrenzt: hoechst === null && m.max_supply_infinite === true,
            athUsd: positiv(usd(m.ath)),
            athAm: zeit(m.ath_date?.usd),
            atlUsd: positiv(usd(m.atl)),
            atlAm: zeit(m.atl_date?.usd),
            // 24 h: für die Coin-Ansicht ohne Future (Kopf und Tagesspanne kommen dann von hier).
            aenderung24hPct: zahl(m.price_change_percentage_24h),
            hoch24hUsd: positiv(usd(m.high_24h)),
            tief24hUsd: positiv(usd(m.low_24h)),
            aenderung7dPct: zahl(m.price_change_percentage_7d),
            aenderung30dPct: zahl(m.price_change_percentage_30d),
            aenderung1jPct: zahl(m.price_change_percentage_1y),
        },
    }
}
