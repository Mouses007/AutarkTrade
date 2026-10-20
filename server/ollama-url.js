/**
 * SSRF-Schutz für Ollama-Adressen.
 *
 * Steht bewusst in einem eigenen Modul: die Prüfung wird sowohl von
 * `ollama-api.js` als auch von `ai-models.js` gebraucht, und solange sie in
 * einem der beiden lag, importierten sich die Dateien gegenseitig. Ein solcher
 * Kreis fällt in ESM erst zur Laufzeit auf — als „Cannot access '…' before
 * initialization", an einer Stelle, die mit der Ursache nichts zu tun hat.
 */

import net from 'net'

/**
 * Ist `host` `localhost` oder ein IP-LITERAL aus Loopback/RFC1918 (bzw. IPv6
 * ::1, fc00::/7, fe80::/10, IPv4-mapped davon)?
 *
 * Bis F2 (Audit A2-13) war das ein Präfixvergleich auf den Text: `10.evil.
 * example.com`, `192.168.attacker.net` und `172.16.x.nip.io` galten als
 * „privat" — bei jedem Port. Jetzt zählt nur noch eine echte Adresse.
 *
 * @param {string} host Hostname ohne Klammern und Port
 */
export function istLokalesZiel(host) {
    const h = String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
    if (h === 'localhost') return true
    const typ = net.isIP(h)
    if (typ === 4) return istLokalV4(h)
    if (typ === 6) {
        if (h === '::1') return true
        const m = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
        if (m) return istLokalV4(m[1])
        const hex = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
        if (hex) {
            const a = parseInt(hex[1], 16); const b = parseInt(hex[2], 16)
            return istLokalV4(`${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`)
        }
        const kopf = parseInt(h.split(':')[0] || '0', 16)
        return (kopf & 0xfe00) === 0xfc00 || (kopf & 0xffc0) === 0xfe80
    }
    return false
}

function istLokalV4(ip) {
    const [a, b] = ip.split('.').map(Number)
    return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)
        || (a === 0 && ip === '0.0.0.0')
}

/**
 * Prüft, ob eine URL auf einen lokalen/privaten Host zeigt.
 * Erlaubt: localhost und IP-Literale aus 127/8, 10/8, 172.16/12, 192.168/16, ::1, fc00::/7
 * @param {string} url - Die zu prüfende URL
 * @returns {boolean} true wenn lokal/privat, false sonst
 */
export function isAllowedOllamaUrl(url) {
    try {
        const parsed = new URL(url)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
        if (parsed.username || parsed.password) return false
        return istLokalesZiel(parsed.hostname)
    } catch {
        return false
    }
}

/**
 * Wirft, wenn die URL nicht auf einen lokalen/privaten Host zeigt.
 * Vor jedem ausgehenden Ollama-Request aufrufen.
 */
export function assertAllowedOllamaUrl(url) {
    if (!isAllowedOllamaUrl(url)) {
        throw new Error('Nur lokale/private Hosts erlaubt für Ollama-URL')
    }
}

/**
 * Prüfung für frei eingetragene KI-Endpunkte (`aiCustomUrl`, `aiQwenUrl`).
 *
 * Bewusst NICHT „nur öffentliche Hosts" wie bei den Nachrichten-Feeds: ein
 * selbst gehostetes Modell im eigenen Netz ist genau der Zweck dieser Felder.
 * Verboten ist deshalb nur, was niemals ein Modell-Endpunkt sein kann und
 * gleichzeitig gefährlich ist — allen voran die Metadaten-Dienste der Cloud-
 * Anbieter unter 169.254.169.254, die auf simple GET-Anfragen Zugangsdaten
 * herausgeben.
 *
 * @param {string} rawUrl
 * @returns {Promise<void>} wirft mit klartextlicher Begründung
 */
export async function pruefeKiEndpunkt(rawUrl) {
    let url
    try { url = new URL(String(rawUrl || '').trim()) } catch { throw new Error('Keine gültige Adresse') }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(`Nur http und https sind erlaubt (nicht ${url.protocol.replace(':', '')})`)
    }
    if (url.username || url.password) {
        throw new Error('Zugangsdaten in der Adresse sind nicht erlaubt')
    }

    const host = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '')
    if (host.endsWith('.internal') || host === 'metadata.google.internal') {
        throw new Error(`„${host}" ist ein Metadaten-Dienst, kein Modell-Endpunkt`)
    }

    // Auch hinter einem harmlosen Namen kann eine Metadaten-Adresse stecken.
    // Schlägt die Auflösung fehl, wird NICHT blockiert: die Anfrage scheitert
    // dann ohnehin, und ein zeitweise defektes DNS soll nicht das Speichern
    // der Einstellungen verhindern.
    /*
     * Seit F2 (A2-13) sperrt eine fehlgeschlagene Auflösung: vorher ging ein
     * Name, der beim Speichern nicht auflöste, ungeprüft durch — und konnte
     * beim ersten Aufruf auf die Metadaten-Adresse zeigen.
     */
    let adressen = []
    try {
        const dns = await import('node:dns')
        adressen = await dns.promises.lookup(host, { all: true })
    } catch {
        throw new Error(`„${host}" lässt sich gerade nicht auflösen — bitte später erneut speichern`)
    }

    for (let { address, family } of adressen) {
        // IPv4-mapped IPv6 (`::ffff:a9fe:a9fe` = 169.254.169.254) auf IPv4 zurückführen
        const gemappt = String(address).toLowerCase().match(/^::ffff:(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/)
        if (gemappt) {
            if (gemappt[1]) address = gemappt[1]
            else {
                const a = parseInt(gemappt[2], 16); const b = parseInt(gemappt[3], 16)
                address = `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`
            }
            family = 4
        }
        if (family === 4) {
            const t = address.split('.').map(Number)
            if (t[0] === 169 && t[1] === 254) throw new Error(`„${host}" zeigt auf den Metadaten-Bereich (${address})`)
            if (t[0] >= 224) throw new Error(`„${host}" zeigt auf einen reservierten Bereich (${address})`)
        } else if (family === 6) {
            const s = address.toLowerCase()
            const kopf = parseInt(s.split(':')[0] || '0', 16)
            if ((kopf & 0xffc0) === 0xfe80) throw new Error(`„${host}" zeigt auf eine verbindungslokale Adresse (${address})`)
        }
    }
}
