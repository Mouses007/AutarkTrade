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

{   // BUG-R-209: Ereignisse eines beendeten Erkenners wirken nicht weiter (Erkenner ist eine Attrappe)
    const { useSpracheingabe } = await import('../composables/useSpracheingabe.js')
    const alle = []
    class Attrappe {
        constructor() { this.zustand = 'neu'; alle.push(this) }
        start() { this.zustand = 'laeuft' }
        stop() { this.zustand = 'gestoppt' }
        abort() { this.zustand = 'abgebrochen' }
        // wie der Browser: Ergebnis bzw. Ende melden, auch verspätet
        sage(text) { this.onresult?.({ results: [[{ transcript: text }]] }) }
        ende() { this.onend?.() }
    }
    globalThis.window = { isSecureContext: true, SpeechRecognition: Attrappe }
    const warnung = console.warn
    console.warn = () => {}     // onBeforeUnmount ausserhalb einer Komponente
    let feld = ''
    const s = useSpracheingabe({ beiText: (t) => { feld = t } })
    console.warn = warnung

    // a) Diktieren und senden: das nachgelieferte Endergebnis kehrt nicht ins Feld zurück
    s.schalte()
    alle[0].sage('wie war mein Tag')
    p('Zwischenstand landet im Feld', feld === 'wie war mein Tag' && s.hoert.value === true)
    s.stopp()                   // sendeEingabe()
    feld = ''                   // sende() leert das Feld
    alle[0].sage('wie war mein Tag heute')
    alle[0].ende()
    p('Senden bricht ab (abort, nicht stop)', alle[0].zustand === 'abgebrochen', alle[0].zustand)
    p('nach dem Senden schreibt der alte Erkenner nichts mehr ins Feld', feld === '', feld)

    // b) Mikrofon aus und sofort wieder an: das verspätete Ende des alten kippt den Zustand nicht
    s.schalte()
    alle[1].sage('erstens')
    s.schalte()                 // aus: Endergebnis darf noch kommen
    p('Mikrofon aus: stop, Knopf zeigt aus', alle[1].zustand === 'gestoppt' && s.hoert.value === false)
    alle[1].sage('erstens und zweitens')
    p('Mikrofon aus: das Endergebnis kommt noch an', feld === 'erstens und zweitens', feld)
    s.schalte()                 // sofort wieder an, bevor der alte `end` gemeldet hat
    p('neuer Erkenner läuft, der alte ist ganz beendet', alle.length === 3 && alle[2].zustand === 'laeuft' && alle[1].zustand === 'abgebrochen')
    alle[1].ende()
    p('verspätetes Ende des alten: Knopf bleibt an', s.hoert.value === true)
    alle[1].sage('alter Text')
    p('verspätetes Ergebnis des alten überschreibt nichts', feld === 'erstens und zweitens', feld)
    alle[2].sage('drittens')
    p('der neue Erkenner schreibt weiter', feld === 'drittens')
    s.schalte()
    p('der neue Erkenner ist stoppbar', alle[2].zustand === 'gestoppt' && s.hoert.value === false)
    alle[2].ende()
    s.schalte()
    p('nach regulärem Ende startet ein frischer Erkenner', alle.length === 4 && alle[3].zustand === 'laeuft' && s.hoert.value === true)
    alle[3].ende()
    p('eigenes Ende (Browser beendet von selbst): Knopf aus', s.hoert.value === false)
}
delete globalThis.window

p('Deutsch, Browser de-CH → de-CH', erkennungsSprache('de', 'de-CH') === 'de-CH')
p('Deutsch, Browser en-US → de-DE', erkennungsSprache('de', 'en-US') === 'de-DE')
p('Englisch, Browser de-CH → en-US', erkennungsSprache('en', 'de-CH') === 'en-US')
p('Englisch, Browser en-GB → en-GB', erkennungsSprache('en', 'en-GB') === 'en-GB')
p('leer → Deutsch', erkennungsSprache('', '') === 'de-DE')

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler === 0 ? 0 : 1)
