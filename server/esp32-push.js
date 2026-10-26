/**
 * Sofort-Zustellung der Chart-Alarme ans Android-Widget über UnifiedPush.
 *
 * Das Widget meldet sich bei einem UnifiedPush-Verteiler auf dem Handy an
 * (in der Praxis die ntfy-App), bekommt von ihm eine Adresse und einen
 * Web-Push-Schlüssel und trägt beides hier ein:
 *
 *   POST   /api/esp32/push   { endpoint, p256dh, auth, geraet }   (X-ESP32-Key)
 *   DELETE /api/esp32/push   { endpoint }
 *
 * Jede Auslösung geht dann sofort verschlüsselt (webpush.js) an alle
 * eingetragenen Geräte; ntfy hält auf dem Handy die Verbindung und weckt
 * das Widget, auch aus Doze. Das Abfragen von /api/esp32/alarme bleibt als
 * Rückfallebene — beide Wege tragen dieselbe Kennung `alarmId-t`, das Handy
 * meldet jede Auslösung nur einmal.
 *
 * Die Geräte stehen in `settings.esp32PushGeraete` (JSON). Die Spalte ist ein
 * Geheimnis (Auth-Geheimnis je Gerät; die Adresse selbst ist eine Berechtigung)
 * und ein Ziel-Feld — sie geht nie über die generische Settings-Route hinaus
 * und kommt nie aus einem Backup (geheimnisse.js).
 */
import dns from 'dns'
import { createHash } from 'crypto'
import net from 'net'
import { Agent } from 'undici'
import { getKnex } from './database.js'
import { verschluessle, vonB64url } from './webpush.js'
import { ausloesungenAus } from './esp32-alarme.js'
import { logWarn } from './logger.js'
import { v6Gruppen } from './net-guard.js'
import { versandGesperrt, versandSperrFehler } from './testbetrieb.js'

export const MAX_GERAETE = 5
const ZEITLIMIT_MS = 10_000

/*
 * Sperrliste für Push-Ziele (Audit SEC-SRV-003, 26.10.2026).
 *
 * Das private LAN bleibt erlaubt — ntfy läuft oft selbst gehostet im eigenen
 * Netz, ein Filter auf öffentliche Adressen (net-guard) schlösse genau die
 * aus. Gesperrt ist, was nie ein Handy-Verteiler ist, aber ein lohnendes Ziel
 * einer blinden SSRF: Loopback (dieser Server selbst, Docker-Dienste auf dem
 * Host), 169.254/16 (Cloud-Metadaten, verbindungslokal), 0.0.0.0/8, ::,
 * fe80::/10, Multicast und Broadcast. Bis dahin prüfte `pruefeGeraet` nur
 * `^https?://`, und `fetch` folgte Umleitungen.
 */
export function istGesperrtesPushZiel(adresse) {
    const a = String(adresse || '').trim().replace(/^\[|\]$/g, '')
    const typ = net.isIP(a)
    if (typ === 4) {
        const t = a.split('.').map(Number)
        const [x, y] = t
        if (x === 0 || x === 127) return true            // 0.0.0.0/8, Loopback
        if (x === 169 && y === 254) return true          // verbindungslokal, Cloud-Metadaten
        if (x >= 224) return true                         // Multicast, reserviert, Broadcast
        return false
    }
    if (typ === 6) {
        const g = v6Gruppen(a)
        if (!g) return true
        const nullBis = (n) => g.slice(0, n).every((v) => v === 0)
        if (nullBis(8)) return true                       // ::
        if (nullBis(7) && g[7] === 1) return true         // ::1
        // IPv4-mapped/-kompatibel: die eingebettete IPv4-Adresse zählt
        if (nullBis(5) && (g[5] === 0xffff || g[5] === 0)) {
            return istGesperrtesPushZiel(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`)
        }
        if ((g[0] & 0xffc0) === 0xfe80) return true       // fe80::/10
        if ((g[0] & 0xff00) === 0xff00) return true       // Multicast
        return false
    }
    return true   // keine Adresse: im Zweifel zu
}

/** Name, der ohne DNS schon als lokal feststeht. */
function istLokalerName(host) {
    const h = String(host || '').toLowerCase().replace(/\.$/, '')
    return h === 'localhost' || h.endsWith('.localhost')
}

/*
 * Verbindung nur zu geprüften Adressen: der Agent löst selbst auf und
 * verbindet mit genau der geprüften Adresse — ein Name, der erst nach der
 * Anmeldung auf 127.0.0.1 umgebogen wird, kommt so auch nicht durch.
 */
function pushLookup(hostname, optionen, rueckruf) {
    if (typeof optionen === 'function') { rueckruf = optionen; optionen = {} }
    dns.lookup(hostname, { ...optionen, all: true }, (fehler, adressen) => {
        if (fehler) return rueckruf(fehler)
        const liste = Array.isArray(adressen) ? adressen : [{ address: adressen, family: optionen?.family || 4 }]
        const gesperrt = liste.find((x) => istGesperrtesPushZiel(x.address))
        if (!liste.length || gesperrt) {
            return rueckruf(Object.assign(new Error('Push-Ziel zeigt auf eine gesperrte Adresse'), { code: 'EGESPERRT' }))
        }
        if (optionen?.all) return rueckruf(null, liste)
        return rueckruf(null, liste[0].address, liste[0].family)
    })
}
const PUSH_AGENT = new Agent({ connect: { lookup: pushLookup } })

/**
 * Eingabe prüfen (rein). Die Adresse muss http(s) sein und darf nicht auf
 * eine gesperrte Adresse zeigen (`istGesperrtesPushZiel`; Namen werden beim
 * Senden über `pushLookup` geprüft). Mehr geht nicht: wer den ESP32-Schlüssel
 * hat, kann den Server weiter an Adressen im eigenen LAN POSTen lassen — mit
 * nichts als einer verschlüsselten Alarm-Nachricht.
 */
export function pruefeGeraet(roh) {
    const endpoint = String(roh?.endpoint || '').trim()
    if (!/^https?:\/\/[^\s]+$/i.test(endpoint) || endpoint.length > 512) return { fehler: 'endpoint ungültig' }
    let url
    try { url = new URL(endpoint) } catch { return { fehler: 'endpoint ungültig' } }
    if (url.username || url.password) return { fehler: 'endpoint ungültig' }
    const host = url.hostname.replace(/^\[|\]$/g, '')
    if (istLokalerName(host) || (net.isIP(host) && istGesperrtesPushZiel(host))) return { fehler: 'endpoint gesperrt' }
    const p256dh = String(roh?.p256dh || '').trim()
    const auth = String(roh?.auth || '').trim()
    const pk = vonB64url(p256dh)
    if (pk.length !== 65 || pk[0] !== 0x04) return { fehler: 'p256dh ungültig' }
    if (vonB64url(auth).length < 16) return { fehler: 'auth ungültig' }
    const geraet = String(roh?.geraet || '').replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 60)
    return { daten: { endpoint, p256dh, auth, geraet } }
}

/**
 * Gerät eintragen oder auffrischen; höchstens MAX_GERAETE.
 *
 * Gleiche Adresse ODER gleicher Gerätename ersetzt den eigenen Eintrag —
 * sonst sperrte sich das echte Handy nach einer Neuregistrierung (neue
 * ntfy-Adresse) selbst aus. Ein NEUES Gerät bei voller Liste wird abgelehnt
 * (`{ fehler: 'voll' }`), statt das älteste zu verdrängen (Audit SEC-SRV-003:
 * fünf Fremdeinträge schoben das echte Handy unbemerkt hinaus). Platz schafft
 * man in den Einstellungen (ESP32 › Push-Geräte).
 *
 * @returns {{liste?: object[], fehler?: 'voll'}}
 */
export function mitGeraet(liste, neu, jetzt = Date.now()) {
    const name = String(neu.geraet || '')
    const gleich = (g) => g.endpoint === neu.endpoint || (name && g.geraet === name)
    const ohne = (liste || []).filter((g) => !gleich(g))
    const ersetzt = ohne.length < (liste || []).length
    if (!ersetzt && ohne.length >= MAX_GERAETE) return { fehler: 'voll' }
    return { liste: [...ohne, { ...neu, seit: jetzt }] }
}

/**
 * Geräteliste für die Einstellungen (rein): Name, Host der Adresse, Datum —
 * KEINE Schlüssel und nicht die volle Adresse (bei ntfy ist das Topic im
 * Pfad die Berechtigung). `id` ist ein Hash der Adresse zum Löschen.
 */
export function geraeteUebersicht(liste) {
    return (liste || []).map((g) => {
        let host = ''
        try { host = new URL(g.endpoint).host } catch { /* kaputter Eintrag */ }
        return { id: geraeteId(g.endpoint), geraet: g.geraet || '', host, seit: Number(g.seit) || null }
    })
}

/** Stabile, nicht umkehrbare Kennung eines Eintrags. */
export function geraeteId(endpoint) {
    return createHash('sha256').update(String(endpoint || '')).digest('hex').slice(0, 16)
}

export function ohneGeraet(liste, endpoint) {
    return (liste || []).filter((g) => g.endpoint !== endpoint)
}

function parse(text) {
    if (Array.isArray(text)) return text
    try { const v = JSON.parse(text || '[]'); return Array.isArray(v) ? v : [] } catch { return [] }
}

export async function ladeGeraete() {
    const row = await getKnex()('settings').where('id', 1).select('esp32PushGeraete').first()
    return parse(row?.esp32PushGeraete)
}

export async function speichereGeraete(liste) {
    await getKnex()('settings').where('id', 1).update({ esp32PushGeraete: JSON.stringify(liste) })
}

/**
 * Eine Auslösung an alle Geräte. Wirft nie (läuft neben dem Alarm-Takt);
 * gibt je Gerät 'ok' oder den Fehler zurück — kommt in den Verlauf des Alarms.
 * 404/410 heisst: der Verteiler kennt die Adresse nicht mehr (App abgemeldet,
 * ntfy neu installiert) — dann fliegt das Gerät aus der Liste. 507 meldet ntfy.sh,
 * wenn gerade kein Handy mit dem Thema verbunden ist (gemessen 22.10.2026, direkt
 * nach der Anmeldung, bevor die ntfy-App ihre Verbindung aufgebaut hatte): die
 * Nachricht ist dann verloren, das Gerät bleibt — der Abruf der App holt sie nach.
 *
 * Im Testbetrieb geht nichts hinaus (Gesamtaudit 26.10.2026, SEC-SRV-016):
 * die Sperre sitzt hier am Transport wie bei `sendeMail`, `melde` und dem
 * Hype-`post` — bis dahin schützte nur, dass die Alarm-Takte im Testbetrieb
 * nicht starten; ein Testknopf hätte von der V2-Testinstanz an echte Handys
 * gesendet.
 *
 * @param {object} [o]
 * @param {() => Promise<object[]>} [o.laden]  Geräteliste (Selbsttest)
 */
export async function sendeAnGeraete(alarmZeile, eintrag, { laden = ladeGeraete } = {}) {
    if (versandGesperrt()) return { fehler: versandSperrFehler().message }
    let geraete
    try { geraete = await laden() } catch (e) { return { fehler: e.message } }
    if (!geraete.length) return null
    const [nachricht] = ausloesungenAus([{ ...alarmZeile, verlauf: [eintrag] }])
    if (!nachricht) return null   // z. B. Push für diesen Alarm abgeschaltet
    const klartext = JSON.stringify(nachricht)
    const ergebnis = {}
    const weg = []
    await Promise.all(geraete.map(async (g, i) => {
        const name = g.geraet || `geraet${i + 1}`
        try {
            const rumpf = verschluessle(klartext, g)
            // Vor dem Senden noch einmal prüfen: alte Einträge stammen aus der
            // Zeit vor der Sperrliste (SEC-SRV-003).
            if (pruefeGeraet(g).fehler) { ergebnis[name] = 'Adresse gesperrt'; return }
            const res = await fetch(g.endpoint, {
                method: 'POST',
                headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high' },
                body: rumpf,
                signal: AbortSignal.timeout(ZEITLIMIT_MS),
                // Keine Umleitungen (SEC-SRV-003): eine 30x-Antwort hätte den
                // Server sonst an ein beliebiges zweites Ziel geschickt.
                redirect: 'manual',
                dispatcher: PUSH_AGENT,
            })
            if (res.status === 404 || res.status === 410) { weg.push(g.endpoint); ergebnis[name] = `abgemeldet (${res.status})` }
            else ergebnis[name] = res.ok ? 'ok' : `HTTP ${res.status}`
        } catch (e) {
            ergebnis[name] = String(e.message).slice(0, 120)
        }
    }))
    if (weg.length) {
        try { await speichereGeraete(geraete.filter((g) => !weg.includes(g.endpoint))) } catch (e) { logWarn('esp32-push', `Liste: ${e.message}`) }
    }
    return ergebnis
}
