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
 *   - Schalter: aus entfernt den Eintrag, Importe sind nicht überwachbar;
 *   - Bestand ohne Bewegung (XRP, BNB Chain): ein nicht gelesenes Netz ist
 *     KEIN leergeräumtes, ein neu zugeschaltetes kein Eingang, VTHO wächst still.
 */
import { wachtAus, setzeWacht, wachtbar, meldenswert, meldungFuer, zeileText, mengeText, unbekannterAbgang, NACHGELADEN_MS, bestandsAenderungen } from './wacht.js'

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

console.log('\nBestand ohne Bewegung (XRP, BNB Chain, VeChain)')
{
    const xrp = bestandsAenderungen([{ ort: 'xrp', asset: 'XRP', menge: 100 }], [{ ort: 'xrp', asset: 'XRP', menge: 120 }], [])
    check('Spende auf XRP: +20 erkannt', xrp.length === 1 && xrp[0].delta === 20 && xrp[0].orte[0] === 'xrp', JSON.stringify(xrp))
    const leer = bestandsAenderungen([{ ort: 'evm:56', asset: 'BNB', menge: 0.0094 }, { ort: 'evm:1', asset: 'ETH', menge: 1 }],
        [{ ort: 'evm:1', asset: 'ETH', menge: 1 }], [], { gelesen: ['evm:1', 'evm:56'] })
    check('BNB Chain leergeräumt (gelesen, Saldo 0 → fehlt im Bestand): −0.0094', leer.length === 1 && leer[0].asset === 'BNB' && Math.abs(leer[0].delta + 0.0094) < 1e-12)
    const nichtGelesen = bestandsAenderungen([{ ort: 'evm:56', asset: 'BNB', menge: 0.0094 }], [], [], { gelesen: ['evm:1'] })
    check('Netzfehler (BNB Chain nicht gelesen) ist KEIN Abgang', nichtGelesen.length === 0)
    const neuesNetz = bestandsAenderungen([{ ort: 'evm:1', asset: 'ETH', menge: 1 }], [{ ort: 'evm:1', asset: 'ETH', menge: 1 }, { ort: 'evm:137', asset: 'POL', menge: 91 }], [], { gelesen: ['evm:1', 'evm:137'], gelesenVorher: ['evm:1'] })
    check('neu zugeschaltetes Netz ohne Grundstand: keine Meldung', neuesNetz.length === 0)
    const leerVorher = bestandsAenderungen([], [{ ort: 'evm:56', asset: 'BNB', menge: 0.5 }], [], { gelesen: ['evm:56'], gelesenVorher: ['evm:56'] })
    check('Netz war gelesen und leer, jetzt Eingang: gemeldet', leerVorher.length === 1 && leerVorher[0].delta === 0.5)
    const erklaert = bestandsAenderungen([{ ort: 'btc', asset: 'BTC', menge: 1 }], [{ ort: 'btc', asset: 'BTC', menge: 1.5 }], [{ art: 'einzahlung', asset: 'BTC', menge: 0.5 }])
    check('von einer neuen Bewegung erklärt: still', erklaert.length === 0)
    const teils = bestandsAenderungen([{ ort: 'btc', asset: 'BTC', menge: 1 }], [{ ort: 'btc', asset: 'BTC', menge: 1.6 }], [{ art: 'einzahlung', asset: 'BTC', menge: 0.5 }])
    check('nur teilweise erklärt: der Rest', teils.length === 1 && Math.abs(teils[0].delta - 0.1) < 1e-12)
    const gebuehr = bestandsAenderungen([{ ort: 'evm:1', asset: 'ETH', menge: 1 }], [{ ort: 'evm:1', asset: 'ETH', menge: 0.499 }], [{ art: 'auszahlung', asset: 'ETH', menge: -0.5, gebuehrAsset: 'ETH', gebuehrMenge: 0.001 }])
    check('Abgang samt Netzgebühr erklärt', gebuehr.length === 0)
    const vtho = bestandsAenderungen([{ ort: 'evm:100009', asset: 'VTHO', menge: 100 }], [{ ort: 'evm:100009', asset: 'VTHO', menge: 101 }], [])
    check('VTHO wächst von selbst: still', vtho.length === 0)
    const vthoWeg = bestandsAenderungen([{ ort: 'evm:100009', asset: 'VTHO', menge: 100 }], [{ ort: 'evm:100009', asset: 'VTHO', menge: 10 }], [])
    check('VTHO sinkt: gemeldet', vthoWeg.length === 1 && vthoWeg[0].delta === -90)
    const bots = bestandsAenderungen([{ ort: 'bots', asset: 'USDT', menge: 100 }], [{ ort: 'bots', asset: 'USDT', menge: 104 }], [])
    check('Pionex-Bots (handeln laufend): still', bots.length === 0)
    const rauschen = bestandsAenderungen([{ ort: 'evm:1', asset: 'ETH', menge: 1.234567 }], [{ ort: 'evm:1', asset: 'ETH', menge: 1.2345670000000001 }], [])
    check('Rechenrauschen: still', rauschen.length === 0)
    const token = bestandsAenderungen([{ ort: 'evm:1', asset: 'ilv', kontrakt: '0xABC', menge: 21 }], [{ ort: 'evm:1', asset: 'ILV', kontrakt: '0xabc', menge: 21 }], [])
    check('Gross/Klein bei Kürzel und Vertrag zählt nicht', token.length === 0)

    const m = meldungFuer('Ledger X · ETH MR', [], { bestand: leer, zeitText: zeit })
    check('nur Bestand: Titel „Bestand BNB −0.0094“, dringend', m.titel === '⚠ Ledger X · ETH MR: Bestand BNB −0.0094' && m.schwere === 'einstieg', m.titel)
    check('Zeile nennt Netz und „ohne Bewegungsdaten“', m.text.includes('Bestand BNB 0.0094 → 0 (−0.0094) · BNB Chain · ohne Bewegungsdaten ⚠'), m.text)
    const plus = meldungFuer('Ledger X · XRP', [], { bestand: xrp, zeitText: zeit })
    check('Spende ohne Bewegung: nicht dringend', plus.schwere === 'warnung' && !plus.titel.startsWith('⚠'))
    const beides = meldungFuer('Ledger X · EVM', [{ id: 1, art: 'einzahlung', zeit: JETZT, asset: 'ETH', menge: 0.1 }], { bestand: xrp, zeitText: zeit })
    check('Bewegung und Bestand zusammen: „2 neue Bewegungen“', beides.titel.endsWith('2 neue Bewegungen') && beides.text.split('\n').length === 3)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
process.exit(fehlgeschlagen ? 1 : 0)
