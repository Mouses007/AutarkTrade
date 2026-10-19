/**
 * Selbsttest: Quellenlage des Hype-Radars — Stand S12 und S15.
 *
 * Ohne Netz. Ein `fetch`, der jeden Aufruf protokolliert und scheitert, deckt
 * auf, wohin eine Anfrage gegangen WÄRE.
 *
 * Schalter „Quellen ohne Verkaufsfreigabe" AUS (Stand S12, Verkaufs-Prüfung
 * vom 19.10.2026): entfernte Quellen (pump.fun, Reddit, CoinPaprika,
 * GeckoTerminal ohne Schlüssel, Upbit, OKX, MEXC, Telegram, öffentlicher
 * Solana-Knoten) werden nicht gefragt; Quellen, die einen Kundenschlüssel
 * brauchen oder ungeklärt sind, gehen OHNE ihn bzw. ohne Zustimmung gar nicht
 * erst ins Netz, sondern kommen als „aus" mit Begründung zurück.
 *
 * Schalter AN (S15, Vorgabe): die Wege von vor S12 (`def88a3`) — CoinGecko
 * und GeckoTerminal ohne Schlüssel, pump.fun, CoinPaprika, Reddit, Telegram,
 * öffentlicher Solana-Knoten, RugCheck und die gelben Börsen ab Werk an.
 *
 * Aufruf: node server/hype-radar/__selftest-quellen-s12.mjs
 */
import {
    ERLAUBTE_HOSTS, HOST_FREIGABE, sammle, holeCoinGecko, holeJson, holeText, pumpCoin, ausReddit,
} from './quellen.js'
import { _setzeLeser as setzeCoinGecko } from '../quellen/coingecko.js'
import { _setzeLeser as setzeFreigabe, freigabeAn, QUELLEN_OHNE_FREIGABE } from '../quellen/freigabe.js'
import { istAus } from '../quellen/aus.js'
import { holeRugCheck, _setzeRugcheck, holeGoPlus } from './sicherheit.js'
import { smartAbruf, rpcAdresse, OEFFENTLICH } from './smartmoney.js'
import { VORGABEN, vorgabenFuer, bereinigeEinstellungen } from './einstellungen.js'
import { boersenFuer } from './boersenwacht-bewertung.js'
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

console.log('Hype-Radar: Quellen nach S12 / S15')

const aufrufe = []
globalThis.fetch = async (url, opts = {}) => { aufrufe.push({ url: String(url), kopf: opts.headers || {} }); throw new Error('kein Netz im Selbsttest') }
const urls = () => aufrufe.map((a) => a.url)

/** Hosts der Quellen ohne Verkaufsfreigabe, die über `holeJson`/`holeText` laufen. */
const GESPERRTE_HOSTS = ['frontend-api-v3.pump.fun', 'www.reddit.com', 'api.coinpaprika.com', 'api.geckoterminal.com',
    'api.upbit.com', 'www.okx.com', 'api.mexc.com']
const trifftGesperrt = (u) => GESPERRTE_HOSTS.some((h) => new URL(u).hostname === h)

// Jede Quelle ohne Freigabe, die über die Hype-Abrufhelfer läuft, hängt an einer ID von `freigabe.js`.
for (const host of GESPERRTE_HOSTS) {
    p(`${host}: erlaubt nur mit Freigabe-ID`, ERLAUBTE_HOSTS.has(host) && Boolean(QUELLEN_OHNE_FREIGABE[HOST_FREIGABE[host]]))
}
for (const host of ['www.binance.com', 'api.binance.com', 'fapi.binance.com']) {
    p(`${host} ist kein Host des Hype-Radars (Binance nur über server/marktdaten)`, !ERLAUBTE_HOSTS.has(host))
}

/*
 * Adressen der Quellen ohne Freigabe stehen nur dort, wo der Schalter
 * davorsteht: in quellen.js (`HOST_FREIGABE`, `PUMP`), boersenwacht.js
 * (`QUELLEN`, Abruf über `holeJson`) und smartmoney.js (`OEFFENTLICH` hinter
 * `rpcAdresse`). Binance nirgends im Hype-Radar.
 */
const wurzel = path.resolve(path.dirname(fileURLToPath(import.meta.url)))
const ohneKommentar = (datei) => readFileSync(path.join(wurzel, datei), 'utf8').replace(/^\s*(\*|\/\/).*$/gm, '')
for (const datei of ['fruehphase.js', 'projekt.js', '../radar-ergebnisse.js', '../coin-radar/coin-info.js', 'lauf.js', 'sicherheit.js']) {
    p(`${datei}: keine Adresse einer Quelle ohne Freigabe im Code`,
        !/frontend-api-v3\.pump\.fun|reddit\.com\/r\/|coinpaprika\.com|api\.geckoterminal\.com|mainnet-beta\.solana\.com['"`]|binance\.com|okx\.com|upbit\.com|mexc\.com/.test(ohneKommentar(datei)))
}
for (const datei of ['quellen.js', 'boersenwacht.js', 'smartmoney.js']) {
    p(`${datei}: keine Binance-Adresse`, !/binance\.com/.test(ohneKommentar(datei)))
}

// ═══ Schalter AUS — Stand S12 ═══════════════════════════════════════════
setzeFreigabe(async () => false)
await freigabeAn()   // auch der synchrone Stand (`freigabeAnSofort`) ist jetzt „aus"
{
    const V = vorgabenFuer(false)
    p('aus: Quellen-Schalter nur CoinGecko, DexScreener, On-Chain', Object.keys(V.quellen).sort().join() === 'coingecko,dexscreener,geckoterminal')
    p('aus: VORGABEN sind der Stand S12', V === VORGABEN)
    p('aus: Frühphase ohne pump.fun-, Telegram- oder Reddit-Schalter',
        !['pumpfunNeu', 'pumpfunAufstieg', 'telegram', 'reddit'].some((k) => k in V.fruehQuellen))
    p('aus: Telegram-Kanäle der Frühphase werden nicht gespeichert', !('fruehTelegram' in bereinigeEinstellungen({ fruehTelegram: ['abc_def'] })))
    p('aus: RugCheck ab Werk aus', V.rugcheckAn === false)
    p('aus: Coinbase, Kraken, KuCoin, Gate ab Werk aus', ['coinbase', 'kraken', 'kucoin', 'gate'].every((b) => V.boersenwachtBoersen[b] === false))
    p('aus: Upbit, OKX, MEXC, Alpha nicht in der Börsenliste',
        !boersenFuer(false).some((b) => ['upbit', 'okx', 'mexc', 'binance-alpha'].includes(b.id)))
    p('CoinGecko-Schlüssel wird nicht im Hype-Panel gepflegt', !('coingecko' in (bereinigeEinstellungen({ schluessel: { coingecko: 'x' } }) || {})))
    // Ein Speichern bei Schalter aus friert nichts ein, was nur mit Schalter an Vorgabe ist.
    p('aus: RugCheck aus = Vorgabe → nichts Eigenes gespeichert', bereinigeEinstellungen({ rugcheckAn: false }).rugcheckAn === null)
    p('aus: RugCheck an = eigene Wahl → gespeichert', bereinigeEinstellungen({ rugcheckAn: true }).rugcheckAn === true)
    const b = bereinigeEinstellungen({ boersenwachtBoersen: { ...V.boersenwachtBoersen, gate: true } }).boersenwachtBoersen
    p('aus: Börsenwahl nur als Abweichung gespeichert', JSON.stringify(b) === '{"gate":true}', JSON.stringify(b))
}

// Der Riegel am Abruf: kein einziger Host ohne Freigabe wird erreicht — gleich, wer fragt.
for (const host of GESPERRTE_HOSTS) {
    aufrufe.length = 0
    let e = null
    try { await holeJson(`https://${host}/x`) } catch (x) { e = x }
    p(`aus: ${host} → QuelleAus „ohneFreigabe", kein Abruf`, istAus(e) && e.grund === 'ohneFreigabe' && aufrufe.length === 0, String(e?.message))
}
{
    aufrufe.length = 0
    let e = null
    try { await holeText('https://www.reddit.com/r/CryptoMoonShots/hot.rss') } catch (x) { e = x }
    p('aus: Reddit-RSS (Text) gesperrt', istAus(e) && aufrufe.length === 0)
    e = null
    try { await pumpCoin('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJospump') } catch (x) { e = x }
    p('aus: pumpCoin gesperrt, nicht „gibt es nicht"', istAus(e) && aufrufe.length === 0)
}

// CoinGecko nur mit Kundenschlüssel.
setzeCoinGecko(async () => ({ schluessel: '', tarif: 'demo' }))
{
    aufrufe.length = 0
    let e = null
    try { await holeCoinGecko('/search/trending') } catch (x) { e = x }
    p('aus, ohne Schlüssel: QuelleAus statt Abruf', istAus(e) && e.grund === 'schluesselFehlt' && aufrufe.length === 0, String(e?.message))
    aufrufe.length = 0
    const { quellenStand } = await sammle({ quellen: { dexscreener: false }, ketten: ['solana'] })
    p('aus, Lauf ohne Schlüssel: CoinGecko „aus" mit Grund', quellenStand.coingecko?.aus === true && quellenStand.coingecko?.grund === 'schluesselFehlt')
    p('aus, Lauf ohne Schlüssel: On-Chain „aus" mit Grund', quellenStand.geckoterminal?.aus === true && quellenStand.geckoterminal?.grund === 'schluesselFehlt')
    p('aus, Lauf ohne Schlüssel: kein einziger Abruf', aufrufe.length === 0, urls().join(' '))
    p('aus: pump.fun, CoinPaprika und Reddit laufen gar nicht erst an',
        !['pumpfun', 'coinpaprika', 'reddit'].some((q) => q in quellenStand), JSON.stringify(Object.keys(quellenStand)))
}
setzeCoinGecko(async () => ({ schluessel: 'CG-test', tarif: 'demo' }))
{
    aufrufe.length = 0
    await holeCoinGecko('/onchain/networks/solana/new_pools?include=base_token').catch(() => {})
    p('aus, mit Schlüssel: On-Chain über die CoinGecko-API', aufrufe[0]?.url.startsWith('https://api.coingecko.com/api/v3/onchain/networks/solana/new_pools'), aufrufe[0]?.url)
}

// RugCheck nur auf Wunsch.
_setzeRugcheck(async () => false)
{
    aufrufe.length = 0
    p('RugCheck aus: kein Bericht', (await holeRugCheck('So1111111111111111111111111111111111111111')) === null)
    // GoPlus scheitert (kein Netz) → ohne RugCheck ungeprüft, nicht bestanden.
    const r = await holeGoPlus('solana', 'So1111111111111111111111111111111111111111').catch(() => 'wurf')
    p('RugCheck aus: kein Abruf bei rugcheck.xyz', !urls().some((u) => /rugcheck/.test(u)), urls().join(' '))
    p('RugCheck aus, GoPlus fehlt: ungeprüft (null)', r === null, String(r))
}
_setzeRugcheck(async () => true)
{
    aufrufe.length = 0
    await holeRugCheck('So1111111111111111111111111111111111111111').catch(() => {})
    p('RugCheck an: Abruf bei rugcheck.xyz', urls().some((u) => /api\.rugcheck\.xyz/.test(u)))
}

// Smart Money nur mit eigener RPC-Adresse.
{
    p('aus: ohne eigene Adresse keine RPC-Adresse', (await rpcAdresse('')) === '')
    let e = null
    try { await smartAbruf({ smartWallets: [{ adresse: 'Wa11et111111111111111111111111111111111111', name: 'w' }] }, '') } catch (x) { e = x }
    p('aus: ohne eigene RPC-Adresse QuelleAus, kein öffentlicher Knoten', istAus(e) && e.grund === 'schluesselFehlt', String(e?.message))
}

// ═══ Schalter AN — wie vor S12 (S15) ════════════════════════════════════
setzeFreigabe(async () => true)
await freigabeAn()
{
    const V = vorgabenFuer(true)
    p('an: pump.fun, CoinPaprika, Reddit wieder als Quellen an',
        Object.keys(V.quellen).sort().join() === 'coingecko,coinpaprika,dexscreener,geckoterminal,pumpfun,reddit'
        && ['pumpfun', 'coinpaprika', 'reddit'].every((q) => V.quellen[q] === true))
    p('an: Frühphase mit pump.fun-Listen und Telegram, Reddit aus (wie vor S12)',
        V.fruehQuellen.pumpfunNeu === true && V.fruehQuellen.pumpfunAufstieg === true
        && V.fruehQuellen.telegram === true && V.fruehQuellen.reddit === false)
    p('an: RugCheck ab Werk an', V.rugcheckAn === true)
    p('an: Coinbase, Kraken, KuCoin, Gate ab Werk an', ['coinbase', 'kraken', 'kucoin', 'gate'].every((b) => V.boersenwachtBoersen[b] === true))
    p('an: Upbit, OKX, MEXC, Alpha beobachtet', ['upbit', 'okx', 'mexc', 'binance-alpha'].every((id) => boersenFuer(true).some((b) => b.id === id)))
    const tg = bereinigeEinstellungen({ fruehTelegram: ['@abc_def', 'https://t.me/s/xyz_123', 'x'] }).fruehTelegram
    p('an: Telegram-Kanäle werden gespeichert, nur Namen', JSON.stringify(tg) === '["abc_def","xyz_123"]', JSON.stringify(tg))
    p('an: RugCheck an = Vorgabe → nichts Eigenes gespeichert', bereinigeEinstellungen({ rugcheckAn: true }).rugcheckAn === null)
    p('an: öffentlicher Solana-Knoten als Vorgabe', (await rpcAdresse('')) === OEFFENTLICH && (await rpcAdresse(' https://eigen.example ')) === 'https://eigen.example')
}

setzeCoinGecko(async () => ({ schluessel: '', tarif: 'demo' }))
{
    aufrufe.length = 0
    const { quellenStand } = await sammle({ quellen: { dexscreener: false, reddit: false }, ketten: ['solana'] })
    const u = urls()
    p('an, ohne Schlüssel: CoinGecko-Trend über den öffentlichen Endpunkt, ohne Schlüsselkopf',
        aufrufe.some((a) => a.url === 'https://api.coingecko.com/api/v3/search/trending' && !Object.keys(a.kopf).some((k) => /x-cg-/.test(k))), u.join(' '))
    p('an, ohne Schlüssel: On-Chain über api.geckoterminal.com',
        u.some((x) => x.startsWith('https://api.geckoterminal.com/api/v2/networks/solana/trending_pools')), u.join(' '))
    p('an: pump.fun und CoinPaprika werden gefragt', u.some((x) => x.startsWith('https://frontend-api-v3.pump.fun/coins?'))
        && u.some((x) => x === 'https://api.coinpaprika.com/v1/coins'))
    p('an: ein Ausfall ist ein Ausfall, kein „aus"', ['pumpfun', 'coinpaprika', 'coingecko', 'geckoterminal']
        .every((q) => quellenStand[q] && quellenStand[q].ok === false && !quellenStand[q].aus), JSON.stringify(quellenStand))
    aufrufe.length = 0
    await ausReddit(['CryptoMoonShots']).catch(() => {})
    p('an: Reddit über den RSS-Feed', urls().some((x) => x.startsWith('https://www.reddit.com/r/CryptoMoonShots/hot.rss')), urls().join(' '))
    aufrufe.length = 0
    await pumpCoin('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJospump').catch(() => {})
    p('an: pumpCoin über /coins-v2', urls()[0] === 'https://frontend-api-v3.pump.fun/coins-v2/7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJospump', urls()[0])
    p('an: kein Abruf ausserhalb der erlaubten Hosts', aufrufe.every((a) => ERLAUBTE_HOSTS.has(new URL(a.url).hostname)))
}
setzeCoinGecko(async () => ({ schluessel: 'CG-test', tarif: 'pro' }))
{
    aufrufe.length = 0
    await holeCoinGecko('/onchain/networks/solana/new_pools?include=base_token').catch(() => {})
    p('an, mit Schlüssel: der eigene Schlüssel hat Vorrang (keine GeckoTerminal-Abfrage)',
        aufrufe[0]?.url.startsWith('https://pro-api.coingecko.com/api/v3/onchain/') && !trifftGesperrt(aufrufe[0].url), aufrufe[0]?.url)
}

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler === 0 ? 0 : 1)
