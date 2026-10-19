/**
 * Selbsttest: Schalter „Quellen ohne Verkaufsfreigabe" (S15, `freigabe.js`).
 *
 * Ohne Netz und ohne DB. Geprüft wird:
 *   - der Schalter liest sich robust (Vorgabe AN bei fehlender Spalte,
 *     Lesefehler, null) und AUS nur bei einem echten Aus-Wert,
 *   - jede Quelle der Liste verweist auf eine Zeile, die es in
 *     `docs/VERKAUFS-PRUEFUNG.md` wirklich gibt,
 *   - jede ID, nach der der Code fragt, steht in der Liste (ein Tippfehler
 *     hiesse sonst still „erlaubt" oder still „aus"),
 *   - `fordereQuelle` wirft bei AUS ein `QuelleAus` mit Grund `ohneFreigabe`,
 *     das `sendeWennAus` als Zustand beantwortet,
 *   - CoinGecko: eigener Schlüssel hat Vorrang; ohne Schlüssel bei AN der
 *     öffentliche Endpunkt (On-Chain an GeckoTerminal), bei AUS „Schlüssel fehlt".
 *
 * Aufruf: node server/quellen/__selftest-freigabe.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
    QUELLEN_OHNE_FREIGABE, IDS, VORGABE, normSchalter, freigabeAn, freigabeAnSofort,
    quelleErlaubt, quelleErlaubtSofort, fordereQuelle, freigabeStand, _setzeLeser,
} from './freigabe.js'
import { istAus, ausAntwort, sendeWennAus } from './aus.js'
import * as cg from './coingecko.js'

let fehler = 0
let bestanden = 0
const p = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}
const wirft = async (fn) => { try { await fn(); return null } catch (e) { return e } }

console.log('Quellen ohne Verkaufsfreigabe (S15)')

// ── Schalter lesen ──────────────────────────────────────────────────────
p('Vorgabe ist AN', VORGABE === true)
for (const w of [undefined, null, '', 1, '1', true, 'true', 'ja']) p(`normSchalter(${JSON.stringify(w)}) = an`, normSchalter(w) === true)
for (const w of [0, '0', false, 'false', 'FALSE']) p(`normSchalter(${JSON.stringify(w)}) = aus`, normSchalter(w) === false)

_setzeLeser(async () => { throw new Error('DB noch nicht bereit') })
p('Lesefehler → Vorgabe AN', (await freigabeAn()) === true)
_setzeLeser(async () => undefined)
p('Spalte fehlt → AN', (await freigabeAn()) === true)

_setzeLeser(async () => 0)
p('vor dem ersten Lesen: sofort = Vorgabe', freigabeAnSofort() === true)
p('DB 0 → AUS', (await freigabeAn()) === false)
p('danach sofort = AUS', freigabeAnSofort() === false && quelleErlaubtSofort('yahoo') === false)

let gelesen = 0
_setzeLeser(async () => { gelesen++; return 1 })
await freigabeAn(); await freigabeAn(); await quelleErlaubt('pumpfun')
p('30 s im Speicher: eine DB-Abfrage für drei Fragen', gelesen === 1, `gelesen ${gelesen}`)

// ── Unbekannte ID ───────────────────────────────────────────────────────
p('unbekannte ID wirft (async)', (await wirft(() => quelleErlaubt('yahooo'))) instanceof Error)
p('unbekannte ID wirft (sofort)', (() => { try { quelleErlaubtSofort('gibtsnicht'); return false } catch { return true } })())

// ── fordereQuelle / QuelleAus ───────────────────────────────────────────
_setzeLeser(async () => 1)
p('AN: fordereQuelle wirft nicht', (await wirft(() => fordereQuelle('forexfactory'))) === null)
_setzeLeser(async () => 0)
const e = await wirft(() => fordereQuelle('forexfactory'))
p('AUS: fordereQuelle wirft QuelleAus', e && istAus(e))
p('AUS: Grund ohneFreigabe, Name aus der Liste', e?.grund === 'ohneFreigabe' && e?.quelle === 'ForexFactory')
const a = e ? ausAntwort(e) : {}
p('ausAntwort ist ein Zustand', a.aus === true && a.grund === 'ohneFreigabe' && /Verkaufsfreigabe/.test(a.meldung))
let gesendet = null
const res = { json: (d) => { gesendet = d } }
p('sendeWennAus antwortet (HTTP 200)', sendeWennAus(res, e) === true && gesendet?.grund === 'ohneFreigabe')
p('sendeWennAus lässt echte Fehler durch', sendeWennAus(res, new Error('kaputt')) === false)

// ── Liste und Prüfungszeilen ────────────────────────────────────────────
const hier = path.dirname(fileURLToPath(import.meta.url))
const wurzel = path.resolve(hier, '../..')
const pruefung = readFileSync(path.join(wurzel, 'docs/VERKAUFS-PRUEFUNG.md'), 'utf8')
const zeilen = new Set([...pruefung.matchAll(/^\| (\d+[a-z]?) \|/gm)].map((m) => m[1]))
p('Prüfung hat Zeilen', zeilen.size > 80, `${zeilen.size}`)
for (const id of IDS) {
    const q = QUELLEN_OHNE_FREIGABE[id]
    p(`${id}: Name und Beschreibung`, q.name && q.was)
    p(`${id}: mindestens eine Prüfungszeile`, Array.isArray(q.zeilen) && q.zeilen.length > 0)
    for (const z of q.zeilen) p(`${id}: Zeile ${z} gibt es in VERKAUFS-PRUEFUNG.md`, zeilen.has(String(z)))
}
_setzeLeser(async () => 1)
const stand = await freigabeStand()
p('freigabeStand: an + alle Quellen', stand.an === true && stand.quellen.length === IDS.length)

// ── Jede ID im Code steht in der Liste ──────────────────────────────────
const gefragt = new Map()
function durchsuche(ordner) {
    for (const name of readdirSync(ordner)) {
        if (name === 'node_modules' || name.startsWith('.')) continue
        const voll = path.join(ordner, name)
        if (statSync(voll).isDirectory()) { durchsuche(voll); continue }
        if (!/\.(m?js|vue)$/.test(name) || name.startsWith('__selftest')) continue
        const text = readFileSync(voll, 'utf8')
        for (const m of text.matchAll(/(?:quelleErlaubt|quelleErlaubtSofort|fordereQuelle)\(\s*['"]([^'"]+)['"]/g)) {
            gefragt.set(m[1], path.relative(wurzel, voll))
        }
    }
}
for (const o of ['server', 'shared', 'src']) durchsuche(path.join(wurzel, o))
p('der Code fragt den Schalter', gefragt.size > 0)
for (const [id, datei] of gefragt) p(`ID „${id}" (${datei}) steht in der Liste`, IDS.includes(id))

// ── CoinGecko ohne/mit Schlüssel ────────────────────────────────────────
cg._setzeLeser(async () => ({ schluessel: '', tarif: 'demo' }))
_setzeLeser(async () => 1)
let z = await cg.zugang()
p('AN, kein Schlüssel: öffentlicher Endpunkt', z?.tarif === 'oeffentlich' && z.basis === 'https://api.coingecko.com/api/v3' && !Object.keys(z.kopf).length)
p('AN, kein Schlüssel: nutzbar, aber kein eigener', (await cg.hatSchluessel()) === true && (await cg.hatEigenenSchluessel()) === false)
let an = await cg.cgAnfrage('/global')
p('AN: /global an api.coingecko.com', an.url === 'https://api.coingecko.com/api/v3/global' && !an.kopf['x-cg-demo-api-key'])
an = await cg.cgAnfrage('/onchain/networks/solana/new_pools?include=base_token')
p('AN: /onchain → GeckoTerminal', an.url === 'https://api.geckoterminal.com/api/v2/networks/solana/new_pools?include=base_token', an.url)

_setzeLeser(async () => 0)
cg.vergiss()
z = await cg.zugang()
p('AUS, kein Schlüssel: kein Zugang', z === null)
const e2 = await wirft(() => cg.cgAnfrage('/global'))
p('AUS, kein Schlüssel: QuelleAus schluesselFehlt', istAus(e2) && e2.grund === 'schluesselFehlt')

cg._setzeLeser(async () => ({ schluessel: 'CG-abc123', tarif: 'demo' }))
for (const schalter of [0, 1]) {
    _setzeLeser(async () => schalter)
    an = await cg.cgAnfrage('/onchain/networks/eth/pools/0x1')
    p(`Schlüssel hat Vorrang (Schalter ${schalter})`, an.url === 'https://api.coingecko.com/api/v3/onchain/networks/eth/pools/0x1' && an.kopf['x-cg-demo-api-key'] === 'CG-abc123')
}

console.log(`\n${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler ? 1 : 0)
