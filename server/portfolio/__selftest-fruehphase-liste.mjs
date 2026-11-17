/**
 * Selbsttest der Frühphase-Liste des Portfolios (`fruehphase-liste.js`, reiner Teil).
 *
 *   node server/portfolio/__selftest-fruehphase-liste.mjs
 *
 * Geprüft wird, was still danebengeht:
 *   - die Adresse aus einem Link (Launchpad, DexScreener) und Gross/Klein:
 *     Solana unterscheidet, EVM nicht;
 *   - das Paar mit der grössten Liquidität zählt, ein fremder Basis-Token nie,
 *     ein Paar ohne Liquiditätsangabe (Bonding Curve) nur ohne Alternative;
 *   - ohne Kurs bleibt der Wert unbekannt (null), nie 0;
 *   - Menge von Hand vor Wallet-Bestand; Gewinn nur mit Einsatz.
 */
import fs from 'fs'
import { leseAdresse, waehlePaar, rechneZeile, verdichte, DUENN_USD } from './fruehphase-liste.js'

let bestanden = 0, fehlgeschlagen = 0
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}
const nah = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))

const MINT = 'AFkMcpbnwEg328181CCresbTTG52DexwKM7FFo9Hpump'
const EVM = '0x6982508145454Ce325dDbE47a25d4ec3d2311933'

console.log('\nAdresse lesen')
{
    check('Solana-Adresse', leseAdresse(MINT)?.art === 'sol' && leseAdresse(MINT).adresse === MINT)
    check('Solana behält Gross/Klein', leseAdresse(` ${MINT} `).adresse === MINT)
    check('Launchpad-Link', leseAdresse(`https://pump.fun/coin/${MINT}`)?.adresse === MINT)
    const paar = '8sLbNZoA1cfnvMJLPfp98ZLAnFSYCFApfJKMbiXNLwxj'
    check('Link mit zwei Adressen: die letzte', leseAdresse(`https://example.org/${paar}/${MINT}?x=1`)?.adresse === MINT)
    check('EVM kleingeschrieben', leseAdresse(EVM)?.art === 'evm' && leseAdresse(EVM).adresse === EVM.toLowerCase())
    check('EVM im Link', leseAdresse(`https://dexscreener.com/ethereum/${EVM}`)?.adresse === EVM.toLowerCase())
    check('Kürzel ist keine Adresse', leseAdresse('WHOAPED') === null)
    check('leer', leseAdresse('') === null && leseAdresse(null) === null)
    check('überlange Eingabe', leseAdresse('a'.repeat(500)) === null)
}

console.log('\nPaar wählen')
{
    const p = (o) => ({ baseToken: { address: MINT, symbol: 'WHOAPED', name: 'WhoAped' }, priceUsd: '0.00005', ...o })
    const paare = [
        p({ dexId: 'a', liquidity: { usd: 500 }, priceUsd: '0.00004' }),
        p({ dexId: 'b', liquidity: { usd: 15000 }, marketCap: 52000, priceChange: { h1: -2.5 } }),
        { baseToken: { address: 'So11111111111111111111111111111111111111112' }, priceUsd: '150', liquidity: { usd: 9e9 } },
        p({ dexId: 'c', liquidity: { usd: 99999 }, priceUsd: '0' }),
    ]
    const w = waehlePaar(paare, 'sol', MINT)
    check('grösste Liquidität gewinnt', w?.dex === 'b' && w.usd === 0.00005, JSON.stringify(w))
    check('fremder Basis-Token zählt nie', w.liq === 15000)
    check('Preis 0 zählt nicht', w.dex !== 'c')
    check('Felder: Kapitalisierung, Änderung', w.mc === 52000 && w.aenderung.h1 === -2.5 && w.aenderung.h24 === null)
    check('Solana: andere Schreibweise ist ein anderer Token', waehlePaar(paare, 'sol', MINT.toLowerCase()) === null)
    const kurve = waehlePaar([p({ dexId: 'kurve' })], 'sol', MINT)
    check('Paar ohne Liquiditätsangabe gilt, als unbekannt', kurve?.dex === 'kurve' && kurve.liq === 0 && kurve.liqBekannt === false)
    check('…verliert gegen eines mit Angabe', waehlePaar([p({ dexId: 'kurve' }), p({ dexId: 'pool', liquidity: { usd: 50 } })], 'sol', MINT).dex === 'pool')
    check('keine Liste', waehlePaar(null, 'sol', MINT) === null && waehlePaar({ fehler: 1 }, 'sol', MINT) === null)

    const fix = JSON.parse(fs.readFileSync(new URL('../fixtures/dexscreener-tokens-v1.json', import.meta.url), 'utf8'))
    const echt = waehlePaar(fix, 'evm:1', EVM.toLowerCase())
    check('echte Antwort (Fixture): EVM ohne Gross/Klein', echt?.symbol === 'PEPE' && echt.usd > 0 && echt.liq > 0 && echt.mc > 0 && echt.paarSeit > 0, JSON.stringify(echt))
    check('echte Antwort: Änderung in Prozent gelesen', typeof echt.aenderung.h24 === 'number')
}

console.log('\nZeile rechnen')
{
    const token = { id: 1, kette: 'sol', kontrakt: MINT, symbol: 'ALT', createdAt: 1000, kursBeiAufnahme: 0.00004, mcBeiAufnahme: 40000, einsatzUsd: 21, menge: null, notiz: '' }
    const paar = { usd: 0.00005, liq: 15000, liqBekannt: true, mc: 50000, symbol: 'WHOAPED', name: 'WhoAped', aenderung: { h1: 1 } }
    const z = rechneZeile(token, paar, 400000, 0.8)
    check('Menge aus dem Wallet', z.menge === 400000 && z.mengeVonHand === false)
    check('Wert in USD und CHF', nah(z.wertUsd, 20) && nah(z.wertChf, 16))
    check('Gewinn gegen den Einsatz', nah(z.gewinnUsd, -1) && nah(z.gewinnAnteil, 20 / 21 - 1))
    check('Einstiegskurs = Einsatz / Menge', nah(z.einstiegUsd, 21 / 400000))
    check('seit Aufnahme', nah(z.seitAufnahme, 0.25))
    check('Kürzel vom Paar', z.symbol === 'WHOAPED')
    check('15k Liquidität ist nicht dünn', z.duenn === false && DUENN_USD === 10000)

    const hand = rechneZeile({ ...token, menge: 1000 }, paar, 400000, 0.8)
    check('Menge von Hand geht vor', hand.menge === 1000 && hand.mengeVonHand && hand.walletMenge === 400000)

    const ohne = rechneZeile(token, null, 400000, 0.8)
    check('ohne Kurs: Wert unbekannt, nicht 0', ohne.usd === null && ohne.wertUsd === null && ohne.wertChf === null && ohne.gewinnUsd === null && ohne.ohneKurs)
    check('ohne Kurs: gespeichertes Kürzel', ohne.symbol === 'ALT')

    const ohneMenge = rechneZeile({ ...token, einsatzUsd: null }, paar, 0, 0.8)
    check('ohne Menge: Kurs ja, Wert nein', ohneMenge.usd === 0.00005 && ohneMenge.menge === null && ohneMenge.wertUsd === null)
    check('ohne Einsatz: kein Gewinn', rechneZeile({ ...token, einsatzUsd: null }, paar, 400000, 0.8).gewinnUsd === null)
    check('dünner Pool markiert', rechneZeile(token, { ...paar, liq: 800 }, 1, 0.8).duenn === true)
    check('ohne Wechselkurs kein CHF-Wert', rechneZeile(token, paar, 400000, 0).wertChf === null)
}

console.log('\nVerlauf verdichten')
{
    const p = Array.from({ length: 1000 }, (_, i) => [i, i])
    const v = verdichte(p, 96)
    check('höchstens 96 Punkte', v.length === 96)
    check('erster und letzter bleiben', v[0][0] === 0 && v[95][0] === 999)
    check('kurzer Verlauf unverändert', verdichte(p.slice(0, 10), 96).length === 10)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
process.exit(fehlgeschlagen ? 1 : 0)
