/**
 * Selbsttest: Voraussetzungen der Spracheingabe (`composables/useSpracheingabe.js`).
 *
 *   node src/utils/__selftest-spracheingabe.mjs
 *
 * Die Erkennung selbst läuft nur im Browser. Geprüft wird, was entscheidet,
 * ob der Mikrofon-Knopf bedienbar ist und warum nicht: über http (kein
 * sicherer Kontext) sperrt der Browser das Mikrofon, Firefox hat keine
 * Spracherkennung. Beides muss ein benannter Grund sein, kein stiller Fehler.
 */
let bestanden = 0
let fehler = 0
const p = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}

// Ohne Fenster (Node): kein Browser
const { spracheingabeGrund, erkennungsSprache } = await import('../composables/useSpracheingabe.js')
p('ohne Fenster: keinBrowser', spracheingabeGrund() === 'keinBrowser')

globalThis.window = { isSecureContext: false, webkitSpeechRecognition: class {} }
p('http: keinHttps, auch wenn der Browser es könnte', spracheingabeGrund() === 'keinHttps')
globalThis.window = { isSecureContext: true }
p('https ohne Erkennung (Firefox): keinBrowser', spracheingabeGrund() === 'keinBrowser')
globalThis.window = { isSecureContext: true, webkitSpeechRecognition: class {} }
p('https mit webkit-Erkennung: geht', spracheingabeGrund() === null)
globalThis.window = { isSecureContext: true, SpeechRecognition: class {} }
p('https mit Standard-Erkennung: geht', spracheingabeGrund() === null)
delete globalThis.window

p('Deutsch, Browser de-CH → de-CH', erkennungsSprache('de', 'de-CH') === 'de-CH')
p('Deutsch, Browser en-US → de-DE', erkennungsSprache('de', 'en-US') === 'de-DE')
p('Englisch, Browser de-CH → en-US', erkennungsSprache('en', 'de-CH') === 'en-US')
p('Englisch, Browser en-GB → en-GB', erkennungsSprache('en', 'en-GB') === 'en-GB')
p('leer → Deutsch', erkennungsSprache('', '') === 'de-DE')

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler === 0 ? 0 : 1)
