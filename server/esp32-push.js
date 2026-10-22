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
import { getKnex } from './database.js'
import { verschluessle, vonB64url } from './webpush.js'
import { ausloesungenAus } from './esp32-alarme.js'
import { logWarn } from './logger.js'

export const MAX_GERAETE = 5
const ZEITLIMIT_MS = 10_000

/**
 * Eingabe prüfen (rein). Die Adresse muss http(s) sein — mehr Prüfung geht
 * nicht: ntfy läuft oft selbst gehostet im eigenen Netz, ein Filter auf
 * öffentliche Adressen (net-guard) schlösse genau die aus. Wer den
 * ESP32-Schlüssel hat, kann den Server also an eine beliebige Adresse
 * POSTen lassen — mit nichts als einer verschlüsselten Alarm-Nachricht.
 */
export function pruefeGeraet(roh) {
    const endpoint = String(roh?.endpoint || '').trim()
    if (!/^https?:\/\/[^\s]+$/i.test(endpoint) || endpoint.length > 512) return { fehler: 'endpoint ungültig' }
    const p256dh = String(roh?.p256dh || '').trim()
    const auth = String(roh?.auth || '').trim()
    const pk = vonB64url(p256dh)
    if (pk.length !== 65 || pk[0] !== 0x04) return { fehler: 'p256dh ungültig' }
    if (vonB64url(auth).length < 16) return { fehler: 'auth ungültig' }
    const geraet = String(roh?.geraet || '').replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 60)
    return { daten: { endpoint, p256dh, auth, geraet } }
}

/** Gerät eintragen oder auffrischen (gleiche Adresse = gleiches Gerät); höchstens MAX_GERAETE, älteste fliegen. */
export function mitGeraet(liste, neu, jetzt = Date.now()) {
    const ohne = (liste || []).filter((g) => g.endpoint !== neu.endpoint)
    return [...ohne, { ...neu, seit: jetzt }].slice(-MAX_GERAETE)
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
 */
export async function sendeAnGeraete(alarmZeile, eintrag) {
    let geraete
    try { geraete = await ladeGeraete() } catch (e) { return { fehler: e.message } }
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
            const res = await fetch(g.endpoint, {
                method: 'POST',
                headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high' },
                body: rumpf,
                signal: AbortSignal.timeout(ZEITLIMIT_MS),
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
