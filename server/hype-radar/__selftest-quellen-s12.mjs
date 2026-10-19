/**
 * Selbsttest: Quellenlage des Hype-Radars nach S12 (Verkaufs-Prüfung vom 19.10.2026).
 *
 * Ohne Netz. Geprüft wird, dass entfernte Quellen nicht mehr gefragt werden
 * und dass Quellen, die einen Kundenschlüssel brauchen oder ungeklärt sind,
 * OHNE ihn bzw. ohne Zustimmung gar nicht erst ins Netz gehen — sondern als
 * „aus" mit Begründung zurückkommen. Ein `fetch`, der jeden Aufruf
 * protokolliert und scheitert, deckt beides auf.
 *
 * Aufruf: node server/hype-radar/__selftest-quellen-s12.mjs
 */
import { ERLAUBTE_HOSTS, sammle, holeCoinGecko } from './quellen.js'
import { _setzeLeser as setzeCoinGecko } from '../quellen/coingecko.js'
import { istAus } from '../quellen/aus.js'
import { holeRugCheck, _setzeRugcheck, holeGoPlus } from './sicherheit.js'
import { smartAbruf } from './smartmoney.js'
import { VORGABEN, bereinigeEinstellungen } from './einstellungen.js'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

let fehler = 0
let bestanden = 0
const p = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}

console.log('Hype-Radar: Quellen nach S12')

const aufrufe = []
globalThis.fetch = async (url) => { aufrufe.push(String(url)); throw new Error('kein Netz im Selbsttest') }

// ── Entfernte Quellen ───────────────────────────────────────────────────
for (const host of ['frontend-api-v3.pump.fun', 'www.reddit.com', 'api.coinpaprika.com', 'api.geckoterminal.com',
    'api.upbit.com', 'www.okx.com', 'api.mexc.com', 'www.binance.com', 'api.binance.com', 'fapi.binance.com']) {
    p(`entfernt: ${host} ist kein erlaubter Host`, !ERLAUBTE_HOSTS.has(host))
}
p('Quellen-Schalter: nur CoinGecko, DexScreener, On-Chain', Object.keys(VORGABEN.quellen).sort().join() === 'coingecko,dexscreener,geckoterminal')
p('Frühphase: keine pump.fun-, Telegram- oder Reddit-Schalter',
    !['pumpfunNeu', 'pumpfunAufstieg', 'telegram', 'reddit'].some((k) => k in VORGABEN.fruehQuellen))
p('Telegram-Kanäle der Frühphase werden nicht mehr gespeichert', !('fruehTelegram' in bereinigeEinstellungen({ fruehTelegram: ['abc_def'] })))
p('RugCheck ab Werk aus', VORGABEN.rugcheckAn === false)
p('CoinGecko-Schlüssel wird nicht im Hype-Panel gepflegt', !('coingecko' in (bereinigeEinstellungen({ schluessel: { coingecko: 'x' } }) || {})))

const wurzel = path.resolve(path.dirname(fileURLToPath(import.meta.url)))
for (const datei of ['quellen.js', 'fruehphase.js', 'projekt.js', 'boersenwacht.js', 'smartmoney.js', '../radar-ergebnisse.js', '../coin-radar/coin-info.js']) {
    const text = readFileSync(path.join(wurzel, datei), 'utf8').replace(/^\s*(\*|\/\/).*$/gm, '')
    p(`${datei}: keine Adresse entfernter Quellen im Code`,
        !/frontend-api-v3\.pump\.fun|reddit\.com\/r\/|coinpaprika\.com|api\.geckoterminal\.com|mainnet-beta\.solana\.com['"`]|binance\.com|okx\.com|upbit\.com|mexc\.com/.test(text))
}

// ── CoinGecko nur mit Kundenschlüssel ───────────────────────────────────
setzeCoinGecko(async () => ({ schluessel: '', tarif: 'demo' }))
{
    let e = null
    try { await holeCoinGecko('/search/trending') } catch (x) { e = x }
    p('ohne Schlüssel: QuelleAus statt Abruf', istAus(e) && e.grund === 'schluesselFehlt' && aufrufe.length === 0, String(e?.message))
    aufrufe.length = 0
    const { quellenStand } = await sammle({ quellen: { dexscreener: false }, ketten: ['solana'] })
    p('Lauf ohne Schlüssel: CoinGecko „aus" mit Grund', quellenStand.coingecko?.aus === true && quellenStand.coingecko?.grund === 'schluesselFehlt')
    p('Lauf ohne Schlüssel: On-Chain „aus" mit Grund', quellenStand.geckoterminal?.aus === true && quellenStand.geckoterminal?.grund === 'schluesselFehlt')
    p('Lauf ohne Schlüssel: kein einziger CoinGecko-Abruf', !aufrufe.some((u) => /coingecko/.test(u)), aufrufe.join(' '))
}
setzeCoinGecko(async () => ({ schluessel: 'CG-test', tarif: 'demo' }))
{
    aufrufe.length = 0
    await holeCoinGecko('/onchain/networks/solana/new_pools?include=base_token').catch(() => {})
    p('mit Schlüssel: On-Chain über die CoinGecko-API', aufrufe[0]?.startsWith('https://api.coingecko.com/api/v3/onchain/networks/solana/new_pools'), aufrufe[0])
}

// ── RugCheck nur auf Wunsch ─────────────────────────────────────────────
_setzeRugcheck(async () => false)
{
    aufrufe.length = 0
    p('RugCheck aus: kein Bericht', (await holeRugCheck('So1111111111111111111111111111111111111111')) === null)
    // GoPlus scheitert (kein Netz) → ohne RugCheck ungeprüft, nicht bestanden.
    const r = await holeGoPlus('solana', 'So1111111111111111111111111111111111111111').catch(() => 'wurf')
    p('RugCheck aus: kein Abruf bei rugcheck.xyz', !aufrufe.some((u) => /rugcheck/.test(u)), aufrufe.join(' '))
    p('RugCheck aus, GoPlus fehlt: ungeprüft (null)', r === null, String(r))
}
_setzeRugcheck(async () => true)
{
    aufrufe.length = 0
    await holeRugCheck('So1111111111111111111111111111111111111111').catch(() => {})
    p('RugCheck an: Abruf bei rugcheck.xyz', aufrufe.some((u) => /api\.rugcheck\.xyz/.test(u)))
}

// ── Smart Money nur mit eigener RPC-Adresse ─────────────────────────────
{
    let e = null
    try { await smartAbruf({ smartWallets: [{ adresse: 'Wa11et111111111111111111111111111111111111', name: 'w' }] }, '') } catch (x) { e = x }
    p('ohne eigene RPC-Adresse: QuelleAus, kein öffentlicher Knoten', istAus(e) && e.grund === 'schluesselFehlt', String(e?.message))
}

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler === 0 ? 0 : 1)
