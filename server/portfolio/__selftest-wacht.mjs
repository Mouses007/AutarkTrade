/**
 * Selbsttest der Kontoüberwachung (`wacht.js`).
 *
 *   node server/portfolio/__selftest-wacht.mjs
 *
 * Geprüft wird, was still danebengeht:
 *   - Routine (Staking) und Spam melden NICHT, eine Spende schon;
 *   - Nachgeladenes (älter als 7 Tage) ist Historie, keine Bewegung;
 *   - ein Abgang an eine fremde Adresse ist dringend, ein eigener Transfer nicht;
 *   - die Meldung nennt den Gegenort eines Transfers und steht auch im Text
 *     (Telegram zeigt den Titel nicht);
 *   - Schalter: aus entfernt den Eintrag, Importe sind nicht überwachbar.
 */
import { wachtAus, setzeWacht, wachtbar, meldenswert, meldungFuer, zeileText, mengeText, unbekannterAbgang, NACHGELADEN_MS } from './wacht.js'

let bestanden = 0, fehlgeschlagen = 0
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}
const JETZT = Date.parse('2026-11-02T10:00:00Z')
const zeit = (ms) => new Date(ms).toISOString().slice(0, 16)

console.log('\nSchalter')
{
    const a = setzeWacht(null, 'a7', true)
    check('an', wachtAus(a).a7 === true)
    const b = setzeWacht(a, 'bitpanda', true)
    check('zweites Konto dazu, erstes bleibt', wachtAus(b).a7 && wachtAus(b).bitpanda)
    check('aus entfernt den Eintrag', !('a7' in wachtAus(setzeWacht(b, 'a7', false))))
    check('kaputtes JSON → leer', Object.keys(wachtAus('{kaputt')).length === 0 && Object.keys(wachtAus('[1]')).length === 0)
    check('Wallet-Adresse und Börse überwachbar', wachtbar('a7') && wachtbar('bitpanda'))
    check('Import und Unsinn nicht', !wachtbar('i:Crypto.com') && !wachtbar('a7; drop') && !wachtbar(''))
}

console.log('\nWas gemeldet wird')
{
    const spende = { art: 'einzahlung', zeit: JETZT - 3600e3, asset: 'BTC', menge: 0.0003 }
    check('Spende', meldenswert(spende, { jetzt: JETZT }))
    check('Staking-Ertrag nicht', !meldenswert({ ...spende, art: 'staking' }, { jetzt: JETZT }))
    check('Belohnung nicht', !meldenswert({ ...spende, art: 'belohnung' }, { jetzt: JETZT }))
    check('Spam-Airdrop nicht', !meldenswert({ ...spende, art: 'airdrop', asset: 'VISIT-XYZ.COM', kontrakt: '0xabc' }, { jetzt: JETZT, istSpam: (a) => a.includes('.COM') }))
    check('nachgeladene Historie (8 Tage alt) nicht', !meldenswert({ ...spende, zeit: JETZT - NACHGELADEN_MS - 3600e3 }, { jetzt: JETZT }))
    check('ignoriert eingeordnet nicht', !meldenswert({ ...spende, einordnung: 'ignorieren' }, { jetzt: JETZT }))
    check('Ausgang, Tausch, Gebühr (fehlgeschlagene Tx) schon', ['auszahlung', 'tausch', 'gebuehr'].every((art) => meldenswert({ ...spende, art, menge: -0.1 }, { jetzt: JETZT })))
}

console.log('\nText')
{
    check('Menge ohne Nullen, mit Vorzeichen', mengeText(0.00030000) === '+0.0003' && mengeText(-1.5) === '−1.5' && mengeText(44857.17) === '+44857.17')
    const spende = { id: 1, art: 'einzahlung', zeit: JETZT - 3600e3, asset: 'BTC', menge: 0.0003, chfWert: 19.98 }
    const z = zeileText(spende, { zeitText: zeit })
    check('Spende: „Eingang +0.0003 BTC · ≈ CHF 19.98 · von aussen“', z.startsWith('Eingang +0.0003 BTC · ≈ CHF 19.98 · von aussen'), z)
    const eigener = { id: 2, art: 'auszahlung', zeit: JETZT, asset: 'BTC', menge: -0.0003, transferMit: 9 }
    check('eigener Transfer nennt den Gegenort', zeileText(eigener, { partnerName: () => 'SafePal S1 · Bitcoin', zeitText: zeit }).includes('eigener Transfer an SafePal S1 · Bitcoin'))
    const tausch = { id: 3, art: 'kauf', zeit: JETZT, asset: 'ETH', menge: 0.02, gegenAsset: 'CHF', gegenMenge: -40 }
    check('Kauf mit Gegenseite', zeileText(tausch, { zeitText: zeit }).startsWith('Kauf +0.02 ETH (−40 CHF)'))
}

console.log('\nMeldung je Konto')
{
    const spende = { id: 1, art: 'einzahlung', zeit: JETZT - 3600e3, asset: 'BTC', menge: 0.0003, chfWert: 19.98 }
    const m = meldungFuer('SafePal S1 · Bitcoin', [spende], { zeitText: zeit })
    check('eine Bewegung: Titel nennt sie', m.titel === 'SafePal S1 · Bitcoin: Eingang +0.0003 BTC', m.titel)
    check('Titel steht auch im Text (Telegram)', m.text.startsWith(m.titel))
    check('Eingang: Schwere warnung', m.schwere === 'warnung')
    const geklaut = { id: 2, art: 'auszahlung', zeit: JETZT, asset: 'ETH', menge: -2.5, chfWert: 7500 }
    check('Abgang ohne Gegenort = fremde Adresse', unbekannterAbgang(geklaut) && !unbekannterAbgang({ ...geklaut, transferMit: 5 }) && !unbekannterAbgang({ ...geklaut, einordnung: 'transfer' }))
    const g = meldungFuer('Ledger X · EVM', [geklaut], { zeitText: zeit })
    check('fremder Abgang: dringend und mit ⚠', g.schwere === 'einstieg' && g.titel.startsWith('⚠ ') && g.text.includes('⚠ an eine fremde Adresse'))
    const viele = Array.from({ length: 11 }, (_, i) => ({ id: 10 + i, art: 'einzahlung', zeit: JETZT - i * 60e3, asset: 'BTC', menge: 0.0001 }))
    const v = meldungFuer('Ledger X · Bitcoin', viele, { zeitText: zeit })
    check('viele: gebündelt, gekürzt', v.titel.endsWith('11 neue Bewegungen') && v.text.includes('… und 3 weitere') && v.text.split('\n').length === 10)
    check('viele: älteste zuerst', v.text.split('\n')[1].includes(zeit(JETZT - 10 * 60e3)))
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
process.exit(fehlgeschlagen ? 1 : 0)
