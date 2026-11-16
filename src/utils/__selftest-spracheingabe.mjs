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

{   // Server-Weg: selbst aufnehmen, beim Ausschalten an /api/sprache/umschrift (Attrappen)
    const { useSpracheingabe, spracheingabeGrund: grundVon, eingestellteArt, mikroFehlerText } = await import('../composables/useSpracheingabe.js')
    const { appEinstellungen } = await import('../stores/app/rahmen.js')
    appEinstellungen.value = { spracheArt: 'openai' }
    p('Einstellung openai → Server-Weg', eingestellteArt() === 'server')
    appEinstellungen.value = { spracheArt: 'eigen' }
    p('Einstellung eigen → Server-Weg', eingestellteArt() === 'server')
    appEinstellungen.value = { spracheArt: 'irgendwas' }
    p('Unbekanntes → Browser-Weg', eingestellteArt() === 'browser')
    appEinstellungen.value = undefined
    p('Einstellungen noch nicht geladen → Browser-Weg', eingestellteArt() === 'browser')

    globalThis.window = { isSecureContext: true }          // Firefox: keine Browser-Erkennung
    p('Server-Weg ohne MediaRecorder: keinAufnahme', grundVon('server') === 'keinAufnahme')
    const rekorder = []
    class Rekorder {
        static isTypeSupported(t) { return t === 'audio/webm;codecs=opus' }
        constructor(strom, opt) { this.mimeType = opt?.mimeType || ''; this.state = 'inactive'; rekorder.push(this) }
        start() { this.state = 'recording' }
        stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob([new Uint8Array(500)]) }); this.onstop?.() }
    }
    const spuren = []
    globalThis.MediaRecorder = Rekorder
    Object.defineProperty(globalThis, 'navigator', { value: { mediaDevices: { getUserMedia: async () => {
        const spur = { an: true, stop() { this.an = false } }; spuren.push(spur)
        return { getTracks: () => [spur] }
    } } }, configurable: true })
    p('Server-Weg im Firefox mit MediaRecorder: geht', grundVon('server') === null)
    p('Browser-Weg im Firefox: keinBrowser', grundVon('browser') === 'keinBrowser')

    const anfragen = []
    let antwort = { ok: true, status: 200, json: async () => ({ text: 'Wie steht der Bot?' }) }
    globalThis.fetch = async (url, opt) => { anfragen.push({ url, opt }); return antwort }
    const warte = () => new Promise((r) => setTimeout(r, 5))
    const warnung = console.warn
    console.warn = () => {}
    let feld = ''
    const s = useSpracheingabe({ beiText: (t) => { feld = t }, art: () => 'server', sprache: () => 'de-CH' })
    console.warn = warnung

    s.schalte(); await warte()
    p('Aufnahme läuft', s.hoert.value === true && rekorder.length === 1 && rekorder[0].state === 'recording')
    p('Opus/WebM gewählt', rekorder[0].mimeType === 'audio/webm;codecs=opus')
    s.schalte(); await warte()
    p('ausschalten schickt die Aufnahme', anfragen.length === 1 && anfragen[0].url.startsWith('/api/sprache/umschrift?sprache=de-CH&sekunden='))
    p('mit dem Typ der Aufnahme', anfragen[0].opt.headers['Content-Type'] === 'audio/webm;codecs=opus')
    p('Text landet im Feld', feld === 'Wie steht der Bot?', feld)
    p('Mikrofon wieder frei', spuren.every((x) => !x.an))
    p('Knopf aus, nichts mehr unterwegs', !s.hoert.value && !s.arbeitet.value)

    // Senden während der Umschrift: die späte Antwort schreibt nichts mehr ins Feld
    let loese
    antwort = new Promise((r) => { loese = r })
    feld = ''
    s.schalte(); await warte(); s.schalte(); await warte()
    p('Umschrift unterwegs', s.arbeitet.value === true)
    s.stopp()
    loese({ ok: true, status: 200, json: async () => ({ text: 'zu spät' }) }); await warte()
    p('nach Senden kein Text mehr', feld === '', feld)
    p('nach Senden nichts mehr unterwegs', s.arbeitet.value === false)

    // Mikrofon verweigert
    navigator.mediaDevices.getUserMedia = async () => { throw Object.assign(new Error('nein'), { name: 'NotAllowedError' }) }
    s.schalte(); await warte()
    p('verweigert wird benannt', s.fehler.value === 'verweigert' && !s.hoert.value)
    navigator.mediaDevices.getUserMedia = async () => { const spur = { an: true, stop() { this.an = false } }; spuren.push(spur); return { getTracks: () => [spur] } }

    // Fehler des Servers → server_<code>
    antwort = { ok: false, status: 400, json: async () => ({ fehler: 'fehlt_schluessel' }) }
    s.schalte(); await warte(); s.schalte(); await warte()
    p('Serverfehler mit Code', s.fehler.value === 'server_fehlt_schluessel', s.fehler.value)
    antwort = { ok: false, status: 502, json: async () => ({ fehler: 'modellFehlt', grund: 'Model x is not installed locally.' }) }
    s.schalte(); await warte(); s.schalte(); await warte()
    p('Grund des Dienstes kommt mit', s.fehler.value === 'server_modellFehlt' && s.fehlerGrund.value === 'Model x is not installed locally.')

    // Ausschalten, bevor das Mikrofon freigegeben ist: Mikrofon sofort wieder frei, nichts geschickt
    let gib
    navigator.mediaDevices.getUserMedia = () => new Promise((r) => { gib = r })
    const vorher = anfragen.length
    s.schalte(); s.schalte()
    const spaet = { an: true, stop() { this.an = false } }
    gib({ getTracks: () => [spaet] }); await warte()
    p('zu früh ausgeschaltet: Mikrofon frei, nichts geschickt', !spaet.an && anfragen.length === vorher && !s.hoert.value)

    const t = (k, w) => `${k}${w ? JSON.stringify(w) : ''}`
    const te = (k) => k !== 'kiCoach.mikroServer.gibtsNicht'
    p('Fehlertext network → Hinweis auf den Server-Weg', mikroFehlerText('network', t, te) === 'kiCoach.mikroNetz')
    p('Fehlertext bekannter Servercode', mikroFehlerText('server_limit', t, te) === 'kiCoach.mikroServer.limit')
    p('Fehlertext mit Grund des Dienstes', mikroFehlerText('server_modellFehlt', t, te, 'nicht da') === 'kiCoach.mikroServer.modellFehlt kiCoach.mikroDienstSagt{"grund":"nicht da"}')
    p('Fehlertext unbekannter Servercode', mikroFehlerText('server_gibtsNicht', t, te).startsWith('kiCoach.mikroServer.unbekannt'))
    delete globalThis.MediaRecorder
}
delete globalThis.window

p('Deutsch, Browser de-CH → de-CH', erkennungsSprache('de', 'de-CH') === 'de-CH')
p('Deutsch, Browser en-US → de-DE', erkennungsSprache('de', 'en-US') === 'de-DE')
p('Englisch, Browser de-CH → en-US', erkennungsSprache('en', 'de-CH') === 'en-US')
p('Englisch, Browser en-GB → en-GB', erkennungsSprache('en', 'en-GB') === 'en-GB')
p('leer → Deutsch', erkennungsSprache('', '') === 'de-DE')

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler === 0 ? 0 : 1)
