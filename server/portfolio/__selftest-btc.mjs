/**
 * Selbsttest der Bitcoin-Ableitung und der Netto-Wirkung.
 *
 *   node server/portfolio/__selftest-btc.mjs
 *
 * Die Ableitung wird gegen die Testvektoren aus BIP44/49/84 geprüft, und zwar
 * zweimal unabhängig: einmal aus dem veröffentlichten Konto-xpub, einmal frisch
 * aus der Testphrase „abandon … about" abgeleitet. Eine falsche Versionszahl
 * oder Ableitungsart ergäbe gültig aussehende Adressen — mit fremdem Geld oder
 * gar keinem. Das sieht man einer Adresse nicht an.
 */
import { HDKey } from '@scure/bip32'
import { pbkdf2 } from '@noble/hashes/pbkdf2'
import { sha512 } from '@noble/hashes/sha512'
import { leiteAb, nettoWirkung } from './btc.js'

let bestanden = 0, fehlgeschlagen = 0
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const seed = pbkdf2(sha512, PHRASE, 'mnemonic', { c: 2048, dkLen: 64 })

console.log('\nBIP84 (zpub, bc1q…)')
{
    const zpub = 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs'
    const frisch = HDKey.fromMasterSeed(seed, { private: 0x04b2430c, public: 0x04b24746 }).derive("m/84'/0'/0'").publicExtendedKey
    check('Konto-zpub aus der Phrase = Testvektor', frisch === zpub, frisch)
    const [a0, a1] = leiteAb(zpub, 0, 0, 2)
    check('Empfang 0', a0 === 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', a0)
    check('Empfang 1', a1 === 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g', a1)
    check('Wechselgeld 0', leiteAb(zpub, 1, 0, 1)[0] === 'bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el')
}

console.log('\nBIP44 (xpub, 1…)')
{
    const xpub = HDKey.fromMasterSeed(seed).derive("m/44'/0'/0'").publicExtendedKey
    check('Konto-xpub aus der Phrase = Testvektor', xpub === 'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj', xpub)
    check('Empfang 0', leiteAb(xpub, 0, 0, 1)[0] === '1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA')
}

console.log('\nBIP49 (ypub, 3…)')
{
    const ypub = HDKey.fromMasterSeed(seed, { private: 0x049d7878, public: 0x049d7cb2 }).derive("m/49'/0'/0'").publicExtendedKey
    check('Konto-ypub aus der Phrase = Testvektor', ypub === 'ypub6Ww3ibxVfGzLrAH1PNcjyAWenMTbbAosGNB6VvmSEgytSER9azLDWCxoJwW7Ke7icmizBMXrzBx9979FfaHxHcrArf3zbeJJJUZPf663zsP', ypub)
    check('Empfang 0', leiteAb(ypub, 0, 0, 1)[0] === '37VucYSaXLCAsxYyAPfbSi9eh4iEcbShgf', leiteAb(ypub, 0, 0, 1)[0])
}

console.log('\nGenerischer xpub mit erzwungener Adressart (Ledger)')
{
    // Ledger zeigt den BIP84-Kontoschlüssel als „xpub" — dieselben Bytes, andere Versionszahl.
    const xpubAus84 = HDKey.fromMasterSeed(seed).derive("m/84'/0'/0'").publicExtendedKey
    check('xpub des BIP84-Kontos + p2wpkh = bc1q-Testvektor', leiteAb(xpubAus84, 0, 0, 1, 'p2wpkh')[0] === 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu')
    check('ohne Angabe wäre es eine (falsche) Legacy-Adresse', leiteAb(xpubAus84, 0, 0, 1)[0].startsWith('1'))
}

console.log('\nNetto-Wirkung')
{
    const eigene = new Set(['A', 'B'])
    const rein = nettoWirkung({ txid: 't1', fee: 200, status: { confirmed: true, block_time: 1700000000 }, vin: [{ prevout: { scriptpubkey_address: 'X', value: 5000 } }], vout: [{ scriptpubkey_address: 'A', value: 4800 }] }, eigene)
    check('Eingang: +4800, keine Gebühr für uns', rein.netto === 4800 && rein.gebuehr === 0)
    const raus = nettoWirkung({ txid: 't2', fee: 300, status: { confirmed: true, block_time: 1700000000 }, vin: [{ prevout: { scriptpubkey_address: 'A', value: 4800 } }], vout: [{ scriptpubkey_address: 'Y', value: 3000 }, { scriptpubkey_address: 'B', value: 1500 }] }, eigene)
    check('Ausgang mit Wechselgeld: −3300 inkl. Gebühr', raus.netto === -3300 && raus.gebuehr === 300, JSON.stringify(raus))
    const intern = nettoWirkung({ txid: 't3', fee: 100, status: { confirmed: true }, vin: [{ prevout: { scriptpubkey_address: 'A', value: 1000 } }], vout: [{ scriptpubkey_address: 'B', value: 900 }] }, eigene)
    check('Umbuchung zwischen eigenen Adressen: nur die Gebühr', intern.netto === -100 && intern.gebuehr === 100)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
process.exit(fehlgeschlagen ? 1 : 0)
