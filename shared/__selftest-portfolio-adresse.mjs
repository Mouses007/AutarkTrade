/**
 * Selbsttest Wallet-Feld (`erkenneEingabe`) — Audit FUN-PRT-004, 26.10.2026.
 *
 *   node shared/__selftest-portfolio-adresse.mjs
 *
 * In beide Richtungen: alles, was die Coins aus der Hand gibt (Seed in jeder
 * üblichen Schreibweise, WIF auch im Testnetz, XRP-Secret), wird ABGELEHNT;
 * echte öffentliche Adressen und xpubs gehen weiter durch. Dazu die Adressen,
 * die bis zum Audit als Solana galten (Litecoin, Dogecoin, Testnetz).
 */
import crypto from 'node:crypto'
import { erkenneEingabe } from './portfolio-adresse.js'

let bestanden = 0, fehlgeschlagen = 0
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}
const geheim = (s) => erkenneEingabe(s).grund === 'geheim'

// Base58Check selbst bauen (Version + 20 Bytes + Prüfsumme) — echte Formen ohne echte Adressen.
const ALPHA = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
function b58(buf) {
    let n = BigInt('0x' + (buf.toString('hex') || '0'))
    let s = ''
    while (n > 0n) { s = ALPHA[Number(n % 58n)] + s; n /= 58n }
    for (const b of buf) { if (b === 0) s = '1' + s; else break }
    return s
}
function base58check(version, nutz = crypto.randomBytes(20)) {
    const roh = Buffer.concat([Buffer.from([version]), nutz])
    const pruef = crypto.createHash('sha256').update(crypto.createHash('sha256').update(roh).digest()).digest().subarray(0, 4)
    return b58(Buffer.concat([roh, pruef]))
}

const BIP = 'abandon ability able about above absent absorb abstract absurd abuse access accident account accuse achieve acid acoustic acquire across act action actor actress actual'.split(' ')

console.log('\nSeed in allen Schreibweisen → abgelehnt')
check('12 Wörter mit Leerzeichen', geheim(BIP.slice(0, 12).join(' ')))
check('24 Wörter', geheim(BIP.slice(0, 24).join(' ')))
check('mit Kommas', geheim(BIP.slice(0, 12).join(', ')))
check('mit Kommas ohne Leerzeichen', geheim(BIP.slice(0, 12).join(',')))
check('nummeriert „1. abandon“', geheim(BIP.slice(0, 12).map((w, i) => `${i + 1}. ${w}`).join(' ')))
check('nummeriert „1)abandon“ ohne Leerzeichen', geheim(BIP.slice(0, 12).map((w, i) => `${i + 1})${w}`).join(' ')))
check('eine Zeile je Wort', geheim(BIP.slice(0, 12).join('\n')))
check('eine Zeile je Wort, nummeriert, Windows-Zeilenende', geheim(BIP.slice(0, 12).map((w, i) => `${i + 1} ${w}`).join('\r\n')))
check('11 Wörter (eins vergessen)', geheim(BIP.slice(0, 11).join(' ')))
check('13 Wörter (Passphrase-Wort dazu)', geheim(BIP.slice(0, 13).join(' ')))
check('25 Wörter', geheim([...BIP.slice(0, 24), 'zoo'].join(' ')))
check('Gross geschrieben', geheim(BIP.slice(0, 12).join(' ').toUpperCase()))
check('spanische Wortliste mit Akzenten', geheim('ábaco abdomen abeja abierto abogado abono aborto abrazo abrir abuelo abuso acabar'))
check('französische Wortliste mit Akzenten', geheim('abaisser abandon abdiquer abeille abolir aborder aboutir aboyer abrasif abreuver abriter abroger'))

console.log('\nPrivate Schlüssel → abgelehnt')
check('WIF Hauptnetz (K/L)', geheim('L1aW4aubDFB7yfras2S1mN3bqg9nwySY8nkoLmJebSLD5BWv3ENZ'))
check('WIF Testnetz komprimiert (c…, 52)', geheim('c' + 'V'.repeat(51)))
check('WIF Testnetz (9…, 51)', geheim('9' + '2'.repeat(50)))
check('XRP-Secret s… (29)', geheim('snoPBrXtMeMyMHUVTgbuqAfg1SUTb'))
check('XRP-Secret Ed25519 sEd… (31)', geheim('sEdTM1uX8pu2do5XvTnutH6HsouMaM2'))
check('64 Hex', geheim('ab'.repeat(32)))
check('xprv', geheim('xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi'))

console.log('\nÖffentliche Adressen → gehen durch')
const ok = (s, kette) => { const e = erkenneEingabe(s); return e.ok && e.kette === kette }
check('zpub', ok('zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs', 'btc'))
check('xpub', ok('xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8', 'btc'))
check('bc1q', ok('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', 'btc'))
check('Legacy 1…', ok('1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA', 'btc'))
check('P2SH 3…', ok(base58check(0x05), 'btc'))
check('EVM 0x…', ok('0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe', 'evm'))
check('XRP r…', ok('rMvrBkEo82kLYTYYgSBE74LXc9ZKqV68Rm', 'xrp'))
for (const sol of ['7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    'So11111111111111111111111111111111111111112']) {
    check(`Solana ${sol.slice(0, 8)}…`, ok(sol, 'sol'), JSON.stringify(erkenneEingabe(sol)))
}
check('Legacy 1… (Base58Check, zufällig)', ok(base58check(0x00), 'btc'))
check('einzelnes Wort ist kein Seed', !geheim('abandon'))
check('zehn Wörter sind kein Seed', !geheim(BIP.slice(0, 10).join(' ')))

console.log('\nNicht abgefragte Ketten → nicht als Solana')
for (const [name, v] of [['Litecoin L…', 0x30], ['Dogecoin D…', 0x1e], ['Bitcoin-Testnetz m/n…', 0x6f]]) {
    const a = base58check(v)
    const e = erkenneEingabe(a)
    check(`${name} (${a.slice(0, 6)}…) nicht Solana`, !(e.ok && e.kette === 'sol'), JSON.stringify(e))
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
process.exit(fehlgeschlagen ? 1 : 0)
