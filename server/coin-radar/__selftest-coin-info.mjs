/**
 * Selbsttest: Projekt-Infos des Coin-Radars (`coin-info.js`) je Stand des
 * Schalters „Quellen mit eingeschränkten Nutzungsbedingungen" (S15).
 *
 *   an   ohne eigenen Schlüssel über den öffentlichen CoinGecko-Endpunkt,
 *        mit Coin-Logo (`bild`) wie vor S12
 *   aus  ohne Schlüssel `QuelleAus` und kein Abruf; mit Schlüssel ohne `bild`
 *        (Stand S12, Verkaufs-Prüfung Z. 58/87)
 *
 * Dazu die Felder, die die Coin-Ansicht aus derselben Antwort liest
 * (`stammdatenAus`), gegen `server/fixtures/coingecko-coin-handgeschrieben.json`
 * — eine handgeschriebene Vorlage nach der öffentlichen Feldliste, keine
 * Aufzeichnung.
 *
 * Ohne Netz: `fetch` ist attrappiert.
 * Aufruf: node server/coin-radar/__selftest-coin-info.mjs
 */
import { readFileSync } from 'node:fs'
import { holeCoinInfo, stammdatenAus } from './coin-info.js'
import { _setzeLeser as setzeFreigabe } from '../quellen/freigabe.js'
import { _setzeLeser as setzeCoinGecko } from '../quellen/coingecko.js'
import { istAus } from '../quellen/aus.js'

let bestanden = 0
let fehler = 0
const p = (name, ok, zusatz = '') => {
    if (ok) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}

const abrufe = []
globalThis.fetch = async (url, opts = {}) => {
    abrufe.push({ url: String(url), kopf: opts.headers || {} })
    const u = String(url)
    const json = (d) => ({ ok: true, status: 200, json: async () => d, text: async () => JSON.stringify(d) })
    if (u.includes('/search?')) return json({ coins: [{ id: 'aaa-coin', symbol: u.includes('BBB') ? 'BBB' : u.includes('CCC') ? 'CCC' : 'AAA', name: 'A', market_cap_rank: 5, thumb: 'https://x/thumb.png' }] })
    if (u.includes('/coins/')) return json({ name: 'A Coin', symbol: 'aaa', image: { small: 'https://x/small.png' }, links: {}, platforms: {} })
    throw new Error('unerwartete Adresse ' + u)
}

console.log('Coin-Radar: Projekt-Infos je Schalterstand')

// AN, ohne eigenen Schlüssel → öffentlicher Endpunkt, mit Bild
setzeFreigabe(async () => true)
setzeCoinGecko(async () => ({ schluessel: '', tarif: 'demo' }))
{
    const info = await holeCoinInfo('AAAUSDT')
    p('an: Infos ohne Schlüssel', info?.name === 'A Coin', JSON.stringify(info))
    p('an: öffentlicher Endpunkt ohne Schlüsselkopf', abrufe.every((a) => a.url.startsWith('https://api.coingecko.com/api/v3/') && !a.kopf['x-cg-demo-api-key']))
    p('an: Coin-Logo wie vor S12', info?.bild === 'https://x/small.png')
}

// AUS, ohne Schlüssel → QuelleAus, kein Abruf
setzeFreigabe(async () => false)
setzeCoinGecko(async () => ({ schluessel: '', tarif: 'demo' }))
{
    abrufe.length = 0
    let e = null
    try { await holeCoinInfo('BBBUSDT') } catch (x) { e = x }
    p('aus: ohne Schlüssel QuelleAus', istAus(e), String(e?.message || e))
    p('aus: kein Abruf', abrufe.length === 0, abrufe.map((a) => a.url).join(', '))
}

// AUS, mit Schlüssel → Infos, aber ohne Bild — auch aus dem Zwischenspeicher
setzeCoinGecko(async () => ({ schluessel: 'k', tarif: 'demo' }))
{
    const info = await holeCoinInfo('CCCUSDT')
    p('aus: mit Schlüssel Infos', info?.name === 'A Coin')
    p('aus: kein Bild (Stand S12)', info && !('bild' in info), JSON.stringify(info))
    const gecacht = await holeCoinInfo('AAAUSDT')
    p('aus: auch gecachte Infos ohne Bild', gecacht && !('bild' in gecacht))
}

// ── Stammdaten der Coin-Ansicht aus derselben Antwort ───────────────────
{
    const roh = JSON.parse(readFileSync(new URL('../fixtures/coingecko-coin-handgeschrieben.json', import.meta.url), 'utf8'))
    const d = stammdatenAus(roh, { id: 'beispielcoin', name: 'X', thumb: 't' }, 'BSP')
    const m = d.markt
    p('stamm: Name, Kürzel, Rang, Id', d.name === 'Beispielcoin' && d.symbol === 'BSP' && d.marketCapRang === 57 && d.id === 'beispielcoin')
    p('stamm: Beschreibung ohne HTML', !/[<>]/.test(d.beschreibung) && d.beschreibung.includes('scaling network'), d.beschreibung)
    p('stamm: Kategorien ohne Leereinträge', d.kategorien.length === 2)
    p('stamm: erste NICHT leere Homepage', d.homepage === 'https://beispielcoin.example', d.homepage)
    p('stamm: Links', d.twitter === 'https://x.com/beispielcoin' && d.telegram === 'https://t.me/beispielcoin_official'
        && d.github === 'https://github.com/beispielcoin/core' && d.explorer.startsWith('https://etherscan.io/')
        && d.reddit.endsWith('/r/beispielcoin') && d.forum === 'https://forum.beispielcoin.example' && d.whitepaper.endsWith('.pdf'))
    p('stamm: Genesis als Zeit (UTC)', d.genesis === Date.UTC(2023, 2, 23), String(d.genesis))
    p('stamm: Verträge je Kette bleiben (Tiefensuche)', d.plattformen.ethereum?.startsWith('0x1111'))
    p('stamm: Marktkap, FDV, Umsatz', m.marktkapUsd === 2e9 && m.fdvUsd === 5e9 && m.umsatz24hUsd === 1.5e8)
    p('stamm: Mengen', m.umlauf === 4e9 && m.gesamt === 1e10 && m.hoechst === 1e10 && m.hoechstUnbegrenzt === false)
    p('stamm: Allzeithoch und -tief mit Datum', m.athUsd === 2.4 && m.athAm === Date.parse('2024-01-12T12:35:41.000Z')
        && m.atlUsd === 0.25 && m.atlAm === Date.parse('2025-04-07T07:10:00.000Z'))
    p('stamm: Veränderungen 7 T / 30 T / 1 J', m.aenderung7dPct === -3.5 && m.aenderung30dPct === 12.25 && m.aenderung1jPct === -41)
    p('stamm: Stand der Marktdaten', m.stand === Date.parse('2026-11-16T08:00:00.000Z') && m.preisUsd === 0.5)

    // Unbegrenzt ist nicht „nicht gemeldet"; fehlende Zahlen bleiben null, nie 0.
    const ohne = stammdatenAus({
        name: 'O', symbol: 'o', links: {},
        market_data: { max_supply: null, max_supply_infinite: true, total_supply: 0, circulating_supply: null, market_cap: { usd: 0 }, ath: {} },
    }, {}, 'O')
    p('stamm: unbegrenzte Höchstmenge', ohne.markt.hoechst === null && ohne.markt.hoechstUnbegrenzt === true)
    p('stamm: 0 und null sind „nicht gemeldet"', ohne.markt.gesamt === null && ohne.markt.umlauf === null && ohne.markt.marktkapUsd === null
        && ohne.markt.athUsd === null && ohne.markt.athAm === null && ohne.markt.aenderung7dPct === null && ohne.genesis === null)
    const leer = stammdatenAus({}, { id: 'x', name: 'Treffer' }, 'XYZ')
    p('stamm: leere Antwort bricht nicht', leer.name === 'Treffer' && leer.symbol === 'XYZ' && leer.markt.stand === null && leer.kategorien.length === 0)
}

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
if (fehler) process.exit(1)
