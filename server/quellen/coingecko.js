/**
 * CoinGecko nur mit Kundenschlüssel (Verkaufs-Prüfung Zeilen 21, 29, 55, 59, 87).
 *
 * CoinGecko erlaubt die Nutzung in Bezahlprodukten (API-Terms §4.1.6) und
 * verlangt „Powered by CoinGecko" an jeder Anzeige (§4.4). Ob der Gratis-
 * (Demo-)Tarif im verkauften Produkt erlaubt ist, ist offen — darum gibt es
 * keinen Abruf ohne den Schlüssel des KUNDEN: Ohne ihn wirft `cgHole` ein
 * `QuelleAus('CoinGecko', 'schluesselFehlt')`, und die Funktion sagt das.
 *
 * Auch GeckoTerminal läuft hierüber: dieselben On-Chain-Daten gibt es unter
 * `/onchain/…` der CoinGecko-API mit demselben Schlüssel, und die
 * GeckoTerminal-Website-Bedingungen (nur persönlich, kein Scraping) gelten
 * dann nicht.
 *
 * Schlüssel: `settings.hypeKeyCoingecko` (verschlüsselt, Spaltenname aus der
 * Zeit, als nur der Hype-Radar ihn kannte), Tarif in `settings.coingeckoTarif`
 * (`demo` | `pro`). Demo → api.coingecko.com + `x-cg-demo-api-key`,
 * Pro → pro-api.coingecko.com + `x-cg-pro-api-key`.
 *
 * S15: Ohne Schlüssel läuft CoinGecko wieder über den öffentlichen Endpunkt
 * wie im alten Journal, solange der Schalter „Quellen ohne Verkaufsfreigabe"
 * an ist (`freigabe.js`, IDs `coingeckoOeffentlich` und `geckoterminal`).
 * Die `/onchain/…`-Pfade gehen dann an api.geckoterminal.com/api/v2 — die
 * On-Chain-API von CoinGecko ist dieselbe GeckoTerminal-API mit gleichem
 * Pfad, braucht aber einen Schlüssel. Ein eingetragener Schlüssel hat immer
 * Vorrang.
 */

import axios from 'axios'
import { QuelleAus } from './aus.js'
import { quelleErlaubt } from './freigabe.js'

export const NAME = 'CoinGecko'
/** Pflichtzeile für `Quellenhinweis` (Wortlaut von CoinGecko vorgegeben). */
export const ATTRIBUTION = { name: 'CoinGecko', url: 'https://www.coingecko.com/', art: 'powered' }

const BASIS = { demo: 'https://api.coingecko.com/api/v3', pro: 'https://pro-api.coingecko.com/api/v3' }
const KOPF = { demo: 'x-cg-demo-api-key', pro: 'x-cg-pro-api-key' }
const GECKOTERMINAL = 'https://api.geckoterminal.com/api/v2'

let gemerkt = { zugang: undefined, ts: 0 }
const MERKEN_MS = 30000

let leser = async () => {
    const { getKnex } = await import('../database.js')
    const { decrypt } = await import('../crypto.js')
    const z = await getKnex()('settings').select('hypeKeyCoingecko', 'coingeckoTarif').where('id', 1).first()
    const schluessel = z?.hypeKeyCoingecko ? decrypt(z.hypeKeyCoingecko) : ''
    return { schluessel, tarif: z?.coingeckoTarif }
}

/** Nur für Selbsttests. */
export function _setzeLeser(fn) {
    leser = fn
    gemerkt = { zugang: undefined, ts: 0 }
}

/** Nach dem Speichern des Schlüssels. */
export function vergiss() {
    gemerkt = { zugang: undefined, ts: 0 }
}

/** `{ schluessel, tarif, basis, kopf }` oder `null`, wenn kein Schlüssel hinterlegt ist. */
export async function eigenerZugang() {
    if (gemerkt.zugang !== undefined && Date.now() - gemerkt.ts < MERKEN_MS) return gemerkt.zugang
    let z = null
    try {
        const roh = await leser()
        const schluessel = String(roh?.schluessel || '').trim()
        if (schluessel) {
            const tarif = roh?.tarif === 'pro' ? 'pro' : 'demo'
            z = { schluessel, tarif, basis: BASIS[tarif], kopf: { [KOPF[tarif]]: schluessel } }
        }
    } catch { z = null }
    gemerkt = { zugang: z, ts: Date.now() }
    return z
}

/**
 * Eigener Schlüssel, sonst — mit Schalter an — der öffentliche Endpunkt
 * (`tarif: 'oeffentlich'`, kein Kopf), sonst `null`.
 */
export async function zugang() {
    const z = await eigenerZugang()
    if (z) return z
    if (await quelleErlaubt('coingeckoOeffentlich')) {
        return { schluessel: '', tarif: 'oeffentlich', basis: BASIS.demo, kopf: {} }
    }
    return null
}

/** Ist CoinGecko nutzbar (eigener Schlüssel oder öffentlicher Endpunkt)? */
export async function hatSchluessel() {
    return Boolean(await zugang())
}

/** Nur der eigene Schlüssel (Einstellungsseite). */
export async function hatEigenenSchluessel() {
    return Boolean(await eigenerZugang())
}

/** Zugang oder `QuelleAus` — für Wege mit eigenem HTTP-Client (Ratenbremse des Hype-Radars). */
export async function fordereZugang() {
    const z = await zugang()
    if (!z) throw new QuelleAus(NAME, 'schluesselFehlt')
    return z
}

/**
 * GET gegen die CoinGecko-API. `pfad` beginnt mit `/` (z. B. `/global`,
 * `/onchain/networks/solana/new_pools`).
 */
export async function cgHole(pfad, params = {}, opts = {}) {
    const z = await fordereZugang()
    const { data } = await axios.get(await urlFuer(pfad, z), {
        params, headers: { accept: 'application/json', ...z.kopf }, timeout: opts.timeout || 15000,
    })
    return data
}

/**
 * Volle URL für einen Pfad. Ohne eigenen Schlüssel gehen `/onchain/…`-Pfade
 * an GeckoTerminal (Schalter-ID `geckoterminal`), alles andere an den
 * öffentlichen CoinGecko-Endpunkt.
 */
async function urlFuer(pfad, z) {
    if (z.tarif === 'oeffentlich' && pfad.startsWith('/onchain/')) {
        if (!(await quelleErlaubt('geckoterminal'))) throw new QuelleAus(NAME, 'schluesselFehlt')
        return `${GECKOTERMINAL}${pfad.slice('/onchain'.length)}`
    }
    return `${z.basis}${pfad}`
}

/** Volle URL + Kopf für fremde HTTP-Helfer: `{ url, kopf }`. */
export async function cgAnfrage(pfad) {
    const z = await fordereZugang()
    return { url: await urlFuer(pfad, z), kopf: { accept: 'application/json', ...z.kopf } }
}
