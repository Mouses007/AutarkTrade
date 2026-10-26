/**
 * Selbsttest des Alarm-Auszugs für das Android-Widget (`esp32-alarme.js`).
 *
 *   node server/__selftest-esp32-alarme.mjs
 *
 * Zu jedem Fall, der eine Meldung liefert, steht einer, der KEINE liefern darf:
 * ein Handy, das dieselbe Auslösung zweimal meldet oder einen Hinweis als Alarm
 * ausgibt, wird stummgeschaltet — und meldet dann auch den echten nicht mehr.
 */
import { ausloesungenAus, leseArten, ARTEN, MAX_ANTWORT } from './esp32-alarme.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const T = 1_761_100_000_000
const preis = {
    id: 1, art: 'preis', symbol: 'BTCUSDT', markt: 'futures', notiz: '', kanaele: null,
    verlauf: JSON.stringify([
        { t: T, p: 65010, niveau: 65000, titel: 'BTCUSDT steigt über 65’000', text: 'BTCUSDT steigt über 65’000 — jetzt 65’010' },
        { t: T + 60_000, p: 64990, niveau: 65000 },   // Altbestand ohne Text
    ]),
}
const linie = {
    id: 2, art: 'linie', symbol: 'SOLUSDT', markt: 'spot', notiz: 'Ausbruch?', kanaele: '{"push":true,"mail":false}',
    verlauf: [
        { t: T + 30_000, p: 150.5, niveau: 150, titel: 'SOLUSDT Spot steigt über 150', text: 'SOLUSDT Spot steigt über 150 (Trendlinie) — jetzt 150.5' },
        { t: T + 90_000, p: 149, hinweis: 'geometrieEndet' },
    ],
}
const stumm = {
    id: 3, art: 'zone', symbol: 'ETHUSDT', markt: 'futures', kanaele: '{"push":false,"mail":true}',
    verlauf: JSON.stringify([{ t: T + 10_000, p: 2500, titel: 'ETHUSDT läuft in die Zone', text: '…' }]),
}
const momentum = {
    id: 4, art: 'momentum', symbol: '', markt: 'futures', notiz: '',
    verlauf: JSON.stringify([
        { t: T + 120_000, p: 3.21, treffer: [
            { symbol: 'XRPUSDT', markt: 'futures', tf: '15m', seite: 'long', stark: true, preis: 3.21, kerzeT: T },
            { symbol: 'ADAUSDT', markt: 'futures', tf: '1h', seite: 'short', stark: false, preis: 0.71, kerzeT: T },
        ] },
        { t: T + 180_000, p: 0.7, titel: 'Momentum ADAUSDT 1h: kleiner Short-Punkt', text: 'ADAUSDT 1h: kleiner Short-Punkt — 0.7',
            treffer: [{ symbol: 'ADAUSDT', markt: 'spot', tf: '1h', seite: 'short', stark: false, preis: 0.7, kerzeT: T }] },
    ]),
}
const zeilen = [preis, linie, stumm, momentum]

console.log('\nAuszug\n')
{
    const alle = ausloesungenAus(zeilen)
    check('fünf Auslösungen (Hinweis und stummer Alarm fehlen)', alle.length === 5, `${alle.length}`)
    check('neueste zuerst', alle.every((a, i) => i === 0 || alle[i - 1].zeit >= a.zeit))
    check('Kennung ist alarmId-t', alle.find((a) => a.alarmId === 1 && a.zeit === T)?.id === `1-${T}`)
    check('Kennungen eindeutig', new Set(alle.map((a) => a.id)).size === alle.length)
    check('gespeicherter Text wird unverändert übernommen', alle.find((a) => a.id === `1-${T}`)?.text.endsWith('jetzt 65’010'))
    check('Hinweis „geometrieEndet" ist KEINE Auslösung', !alle.some((a) => a.id === `2-${T + 90_000}`))
    check('Alarm mit push:false liefert nichts', !alle.some((a) => a.alarmId === 3))
    check('push:true + mail:false liefert', alle.some((a) => a.alarmId === 2))
    const sol = alle.find((a) => a.alarmId === 2)
    check('Spot-Markt bleibt erhalten (für den Chart-Link)', sol.markt === 'spot' && sol.symbol === 'SOLUSDT')
}

console.log('\nseit\n')
{
    check('seit = T schliesst die Auslösung bei genau T aus', !ausloesungenAus(zeilen, { seit: T }).some((a) => a.zeit === T))
    check('seit = T − 1 nimmt sie mit', ausloesungenAus(zeilen, { seit: T - 1 }).some((a) => a.zeit === T))
    check('seit nach allem → leer', ausloesungenAus(zeilen, { seit: T + 999_999 }).length === 0)
}

console.log('\nArten\n')
{
    check('leere Angabe → alle Arten', leseArten('').size === ARTEN.length)
    check('nur Unbekanntes → alle Arten (nie still nichts)', leseArten('foo,bar').size === ARTEN.length)
    check('„preis, momentum" mit Leerzeichen', [...leseArten('preis, momentum')].sort().join() === 'momentum,preis')
    const nurMomentum = ausloesungenAus(zeilen, { arten: leseArten('momentum') })
    check('nur Momentum → keine Preisalarme', nurMomentum.length === 2 && nurMomentum.every((a) => a.art === 'momentum'))
    check('ohne Momentum → keine Momentum-Meldung', !ausloesungenAus(zeilen, { arten: leseArten('preis,linie,zone') }).some((a) => a.art === 'momentum'))
}

console.log('\nAltbestand ohne Text\n')
{
    const alle = ausloesungenAus(zeilen)
    const alt = alle.find((a) => a.id === `1-${T + 60_000}`)
    check('Preisalarm ohne Text bekommt einen mit Symbol und Niveau', alt.titel.includes('BTCUSDT') && alt.titel.includes('65'), alt.titel)
    check('… und nennt den Preis', alt.text.includes('64'), alt.text)
    const mom = alle.find((a) => a.id === `4-${T + 120_000}`)
    check('Momentum ohne Text: aus den Treffern nachgebaut (2 Signale)', mom.titel === 'Momentum: 2 Signale', mom.titel)
    check('… grosser Long-Punkt steht im Text', mom.text.includes('XRPUSDT 15m: grosser Long-Punkt'), mom.text)
    check('Momentum: Symbol = erster Treffer, alle in symbole', mom.symbol === 'XRPUSDT' && mom.symbole.join() === 'XRPUSDT,ADAUSDT')
    const spot = alle.find((a) => a.id === `4-${T + 180_000}`)
    check('Momentum-Markt aus dem Treffer (spot)', spot.markt === 'spot')
}

console.log('\nDringlichkeit\n')
{
    const mit = (bedingung) => ausloesungenAus([{ id: 9, art: 'preis', symbol: 'X', bedingung, verlauf: [{ t: 5, p: 1 }] }])[0].schwere
    check('Dringlichkeit aus der Bedingung (Text-JSON)', mit('{"schwere":"einstieg"}') === 'einstieg')
    check('… auch als Objekt', mit({ schwere: 'info' }) === 'info')
    check('altes „kritisch“ heisst jetzt „einstieg“', mit({ schwere: 'kritisch' }) === 'einstieg')
    check('ohne Angabe: warnung', mit(undefined) === 'warnung' && mit({ schwere: 'quatsch' }) === 'warnung')
}

console.log('\nRobustheit\n')
{
    check('kaputter Verlauf wirft nicht', ausloesungenAus([{ id: 9, art: 'preis', symbol: 'X', verlauf: '{kaputt' }]).length === 0)
    check('null-Einträge werden übersprungen', ausloesungenAus([{ id: 9, art: 'preis', symbol: 'X', verlauf: [null, { t: 5, p: 1 }] }]).length === 1)
    check('Eintrag ohne Zeit zählt nicht', ausloesungenAus([{ id: 9, art: 'preis', symbol: 'X', verlauf: [{ p: 1 }] }]).length === 0)
    check('unbekannte Art wird nicht geliefert', ausloesungenAus([{ id: 9, art: 'fremd', symbol: 'X', verlauf: [{ t: 5, p: 1 }] }]).length === 0)
    const viele = [{ id: 7, art: 'preis', symbol: 'X', verlauf: Array.from({ length: 80 }, (_, i) => ({ t: T + i, p: 1 })) }]
    check(`höchstens ${MAX_ANTWORT} je Antwort`, ausloesungenAus(viele).length === MAX_ANTWORT)
    check('… und zwar die neuesten', ausloesungenAus(viele)[0].zeit === T + 79)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehlgeschlagen:', fehler.join(' | ')); process.exit(1) }
