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

    const daten = {
        name: j?.name || treffer.name || basis,
        symbol: String(j?.symbol || basis).toUpperCase(),
        bild: j?.image?.small || treffer.thumb || '',
        // CoinGecko liefert die Beschreibung mit HTML-Links; angezeigt wird Text.
        // Linear statt `<[^>]*>` (SEC-SRV-001: quadratisch bei `<` ohne `>`).
        beschreibung: ohneTags(String(j?.description?.en || ''), '', { leer: true }).trim(),
        kategorien: Array.isArray(j?.categories) ? j.categories.filter(Boolean) : [],
        marketCapRang: j?.market_cap_rank ?? treffer.market_cap_rank ?? null,
        homepage: (j?.links?.homepage || []).find(Boolean) || '',
        whitepaper: j?.links?.whitepaper || '',
        twitter: j?.links?.twitter_screen_name ? `https://x.com/${j.links.twitter_screen_name}` : '',
        telegram: j?.links?.telegram_channel_identifier ? `https://t.me/${j.links.telegram_channel_identifier}` : '',
        github: (j?.links?.repos_url?.github || []).find(Boolean) || '',
        explorer: (j?.links?.blockchain_site || []).find(Boolean) || '',
        coingeckoUrl: `https://www.coingecko.com/en/coins/${treffer.id}`,
        // Verträge je Kette, wie CoinGecko sie führt — für die Tiefensuche.
        plattformen: j?.platforms && typeof j.platforms === 'object' ? j.platforms : {},
    }
    cache.set(basis, { ts: Date.now(), daten })
    return daten
}
