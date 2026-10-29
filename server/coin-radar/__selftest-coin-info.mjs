/**
 * Selbsttest: Projekt-Infos des Coin-Radars (`coin-info.js`) je Stand des
 * Schalters „Quellen mit eingeschränkten Nutzungsbedingungen" (S15).
 *
 *   an   ohne eigenen Schlüssel über den öffentlichen CoinGecko-Endpunkt,
 *        mit Coin-Logo (`bild`) wie vor S12
 *   aus  ohne Schlüssel `QuelleAus` und kein Abruf; mit Schlüssel ohne `bild`
 *        (Stand S12, Verkaufs-Prüfung Z. 58/87)
 *
 * Ohne Netz: `fetch` ist attrappiert.
 * Aufruf: node server/coin-radar/__selftest-coin-info.mjs
 */
import { holeCoinInfo } from './coin-info.js'
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

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
if (fehler) process.exit(1)
