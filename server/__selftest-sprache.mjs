/**
 * Selbsttest: Spracheingabe über den Server (`sprache-kern.js`).
 *
 *   node server/__selftest-sprache.mjs
 *
 * Geprüft wird ohne Netz: welche Einstellung angenommen wird, wohin der Ton
 * geht (und dass ohne Schlüssel bzw. Adresse nichts geht), Dateinamen nach
 * Aufnahmeformat, Sprache, Kosten und das Lesen der Antwort.
 */
import {
    normArt, spracheBasis, pruefeSpracheEinstellung, zielFuer, dateiName, sprachCode,
    kostenUsd, textAusAntwort, OPENAI_BASIS, STANDARD_MODELL, ordne404, grundAusAntwort, modelleAus,
} from './sprache-kern.js'
import { ZIEL_SETTINGS, BEHALTEN_BEIM_IMPORT } from './geheimnisse.js'
import { VALID_SETTINGS_KEYS } from './api-routes.js'

let bestanden = 0
let fehler = 0
const p = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}
const wirft = (fn) => { try { fn(); return null } catch (e) { return e.fehlerCode || e.message } }

p('Art: unbekannt → browser', normArt('quatsch') === 'browser' && normArt(undefined) === 'browser')
p('Art: openai/eigen bleiben', normArt('openai') === 'openai' && normArt('eigen') === 'eigen')

p('Basis: Endpunkt mitkopiert → abgeschnitten', spracheBasis('http://192.168.178.100:8000/v1/audio/transcriptions/') === 'http://192.168.178.100:8000/v1')
p('Basis: schon Basis', spracheBasis('https://nas.local:8443/v1') === 'https://nas.local:8443/v1')
p('Basis: ftp → leer', spracheBasis('ftp://x/v1') === '')
p('Basis: Zugangsdaten in der Adresse → leer', spracheBasis('http://a:b@x/v1') === '')
p('Basis: Abfrageteil → leer', spracheBasis('http://x/v1?key=1') === '')

p('Einstellung: eigen ohne Adresse → urlFehlt', wirft(() => pruefeSpracheEinstellung({ art: 'eigen' })) === 'urlFehlt')
p('Einstellung: kaputte Adresse → url', wirft(() => pruefeSpracheEinstellung({ art: 'openai', url: 'kein link' })) === 'url')
p('Einstellung: Modell mit Leerzeichen → modell', wirft(() => pruefeSpracheEinstellung({ art: 'openai', modell: 'a b' })) === 'modell')
{
    const e = pruefeSpracheEinstellung({ art: 'eigen', url: 'http://nas:8000/v1/', modell: 'Systran/faster-whisper-small' })
    p('Einstellung: eigen mit Adresse', e.art === 'eigen' && e.url === 'http://nas:8000/v1' && e.modell === 'Systran/faster-whisper-small')
    p('Einstellung: browser ohne alles', pruefeSpracheEinstellung({}).art === 'browser')
}

p('Ziel: browser → keins', zielFuer({ art: 'browser' }).fehlt === 'browser')
p('Ziel: openai ohne Schlüssel → fehlt schluessel', zielFuer({ art: 'openai', openaiSchluessel: '' }).fehlt === 'schluessel')
{
    const z = zielFuer({ art: 'openai', openaiSchluessel: 'sk-x', url: 'http://boese/v1' })
    p('Ziel: openai geht immer an OpenAI, nie an eine eingetragene Adresse', z.url === `${OPENAI_BASIS}/audio/transcriptions` && z.schluessel === 'sk-x')
    p('Ziel: openai Vorgabemodell', z.modell === STANDARD_MODELL.openai)
}
p('Ziel: eigen ohne Adresse → fehlt url', zielFuer({ art: 'eigen', url: '' }).fehlt === 'url')
{
    const z = zielFuer({ art: 'eigen', url: 'http://nas:8000/v1', openaiSchluessel: 'sk-x' })
    p('Ziel: eigener Dienst bekommt den OpenAI-Schlüssel NICHT', z.schluessel === '' && z.url === 'http://nas:8000/v1/audio/transcriptions')
}

p('Datei: webm mit Codec', dateiName('audio/webm;codecs=opus') === 'aufnahme.webm')
p('Datei: Safari mp4', dateiName('audio/mp4') === 'aufnahme.m4a')
p('Datei: ogg', dateiName('audio/ogg; codecs=opus') === 'aufnahme.ogg')
p('Datei: fremder Typ → null', dateiName('application/json') === null && dateiName('') === null)

p('Sprache: de-CH → de', sprachCode('de-CH') === 'de')
p('Sprache: leer → leer', sprachCode('') === '' && sprachCode('1x') === '')

p('Kosten: eigener Dienst gratis', kostenUsd({ anbieter: 'whisper', modell: 'x', sekunden: 600 }) === 0)
p('Kosten: 60 s mini = 0.003 USD', kostenUsd({ anbieter: 'openai', modell: 'gpt-4o-mini-transcribe', sekunden: 60 }) === 0.003)
p('Kosten: unbekanntes Modell → Whisper-Preis', kostenUsd({ anbieter: 'openai', modell: 'neu', sekunden: 60 }) === 0.006)
p('Kosten: ohne Dauer nach Grösse geschätzt', kostenUsd({ anbieter: 'openai', modell: 'whisper-1', bytes: 240000 }) === 0.006)

p('Antwort: JSON-Text', textAusAntwort('{"text":" Hallo "}') === 'Hallo')
p('Antwort: Objekt', textAusAntwort({ text: 'Ja' }) === 'Ja')
p('Antwort: reiner Text', textAusAntwort('Guten Tag\n') === 'Guten Tag')
p('Antwort: kaputt → leer', textAusAntwort('{kaputt') === '' && textAusAntwort(null) === '')

p('Adresse ist ein Ziel (nur eigene Route, Backup behält sie)', ZIEL_SETTINGS.includes('spracheUrl') && BEHALTEN_BEIM_IMPORT.includes('spracheUrl'))
p('nicht über die allgemeine Einstellungs-Route schreibbar',
    !VALID_SETTINGS_KEYS.includes('spracheUrl') && !VALID_SETTINGS_KEYS.includes('spracheArt'))

// 404 der Umschrift: Speaches meldet so auch ein fehlendes MODELL (16.11.2026 auf der NAS)
p('404 mit Modell-Text → modellFehlt', ordne404('{"detail":"Model \'Systran/faster-whisper-small\' is not installed locally."}') === 'modellFehlt')
p('404 ohne Modell-Text → adresse', ordne404('{"detail":"Not Found"}') === 'adresse' && ordne404('') === 'adresse')
p('Grund aus detail', grundAusAntwort('{"detail":"Model x is not installed locally."}') === 'Model x is not installed locally.')
p('Grund aus OpenAI-Fehler', grundAusAntwort('{"error":{"message":"Invalid model"}}') === 'Invalid model')
p('Grund: Text ohne Zeilenumbrüche, gekürzt', grundAusAntwort('a\n\nb') === 'a b' && grundAusAntwort('x'.repeat(500)).length === 240)
p('Modelle: Speaches/OpenAI-Form', JSON.stringify(modelleAus({ data: [{ id: 'Systran/faster-whisper-small' }, { id: 'whisper-1' }] })) === '["Systran/faster-whisper-small","whisper-1"]')
p('Modelle: Unsinn → leer', modelleAus(null).length === 0 && modelleAus({ data: [{}, 3] }).length === 0)

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler === 0 ? 0 : 1)
