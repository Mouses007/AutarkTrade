/**
 * Schutzwall für Abrufe an URLs, die der NUTZER einträgt.
 *
 * Das Projekt hat bereits `isAllowedOllamaUrl` und `isAllowedDbHost` — beide
 * lassen NUR lokale und private Ziele zu. Hier ist es genau umgekehrt: Feeds
 * liegen im Internet, und alles Interne ist verboten. Ohne diese Prüfung wäre
 * das Eintragen einer Feed-Adresse ein bequemer Weg, den Server als Sonde ins
 * eigene Netz zu schicken — inklusive der Metadaten-Adresse von Cloud-Anbietern
 * (169.254.169.254), die dort Zugangsdaten herausgibt.
 *
 * DNS-Rebinding ist seit F2 (20.10.2026, Audit A2-04) gelöst: bis dahin
 * prüfte `pruefeOeffentlicheUrl` die Auflösung, und `fetch` löste danach NEU
 * auf — ein Name mit kurzer TTL zeigte beim zweiten Mal auf 127.0.0.1. Das
 * war nicht nur theoretisch: die Projektprüfung des Hype-Radars ruft Webseiten
 * ab, die ein Token-Ersteller bei DexScreener/CoinGecko einträgt, also ohne
 * Zutun des Nutzers. Jetzt geht jeder Abruf über einen eigenen Agenten, dessen
 * `lookup` dieselbe Prüfung macht und die Verbindung auf die geprüfte Adresse
 * festnagelt (`GESCHUETZT`).
 */

import dns from 'dns'
import net from 'net'
import { Agent } from 'undici'
import { logWarn } from './logger.js'

/*
 * Fehler mit Kennung: `art` (gesperrt, dns, netz, zeit, zuGross, umleitung),
 * dazu `code` und `adresse` wo bekannt. Der Text bleibt, wie er war — er
 * landet in der Oberfläche; die Kennung braucht, wer Fehler EINORDNEN muss
 * (Projektprüfung: ist die Seite tot oder nur von hier aus nicht lesbar?).
 */
const fehlerMit = (text, felder) => Object.assign(new Error(text), felder)

const HTTP_TIMEOUT = 10000
const MAX_BYTES = 2 * 1024 * 1024
const MAX_UMLEITUNGEN = 3

/**
 * Eigene Quellen — fest verdrahtet, brauchen keine Namensauflösung.
 * Die Binance-Hosts stehen seit S12 nicht mehr hier: kein Abruf über diesen
 * Wächter geht an Binance (Marktdaten laufen über `server/marktdaten/`).
 */
export const FESTE_HOSTS = new Set([
    'api.alternative.me',
    'api.coingecko.com',
    'api.blockchain.info',
    'nfs.faireconomy.media',
    'www.youtube.com',
])

/** Netzbereiche, die niemals Ziel eines Abrufs sein dürfen. */
export function istPrivatV4(ip) {
    const t = ip.split('.').map(Number)
    if (t.length !== 4 || t.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true
    const [a, b, c] = t
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true          // Cloud-Metadaten
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    // 192.0.0.0/24 sind die IETF-Protokollzuweisungen, 192.0.2.0/24 ist
    // TEST-NET-1 — beide je ein /24, NICHT das ganze 192.0.0.0/16. Vorher stand
    // hier `b === 0` ohne dritten Block und sperrte damit 254 reguläre
    // öffentliche Netze mit: `192.0.66.0/24` gehört Automattic und beherbergt
    // TechCrunch samt allem, was auf WordPress.com VIP liegt. Der Abruf schlug
    // mit „zeigt auf eine interne Adresse" fehl, was die Fehlersuche in die
    // völlig falsche Richtung schickte.
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return true
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT / Tailscale
    if (a === 198 && (b === 18 || b === 19)) return true
    if (a >= 224) return true                         // Multicast und reserviert
    return false
}

/**
 * IPv6-Adresse in ihre acht 16-Bit-Gruppen zerlegen (`::` aufgefüllt, eine
 * IPv4-Endung in zwei Gruppen umgerechnet). `null` bei Unsinn.
 */
export function v6Gruppen(ip) {
    let s = String(ip).toLowerCase().split('%')[0]
    const v4 = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/)
    if (v4) {
        const t = v4[2].split('.').map(Number)
        if (t.some((n) => !Number.isInteger(n) || n > 255)) return null
        s = v4[1] + ((t[0] << 8) | t[1]).toString(16) + ':' + ((t[2] << 8) | t[3]).toString(16)
    }
    const teile = s.split('::')
    if (teile.length > 2) return null
    const vorn = teile[0] ? teile[0].split(':') : []
    const hinten = teile.length === 2 && teile[1] ? teile[1].split(':') : []
    const fehlt = 8 - vorn.length - hinten.length
    if (teile.length === 1 ? fehlt !== 0 : fehlt < 1) return null
    const gruppen = [...vorn, ...Array(teile.length === 2 ? fehlt : 0).fill('0'), ...hinten]
    if (gruppen.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null
    return gruppen.map((g) => parseInt(g, 16))
}

export function istPrivatV6(ip) {
    /*
     * Über die Gruppen, nicht über den Text (Audit A2-04, F2). Der URL-Parser
     * schreibt `[::ffff:127.0.0.1]` zu `::ffff:7f00:1` um — die Punktform, die
     * der alte Regex erwartete, kam hier nie an, und Loopback, LAN und
     * Cloud-Metadaten (`::ffff:a9fe:a9fe`) gingen durch.
     */
    const g = v6Gruppen(ip)
    if (!g) return true                                // Unsinn: im Zweifel zu
    const v4aus = (a, b) => `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`
    const nullBis = (n) => g.slice(0, n).every((x) => x === 0)
    if (nullBis(8)) return true                        // ::
    if (nullBis(7) && g[7] === 1) return true          // ::1
    // IPv4-mapped (::ffff:a.b.c.d) und IPv4-kompatibel (::a.b.c.d)
    if (nullBis(5) && (g[5] === 0xffff || g[5] === 0)) return istPrivatV4(v4aus(g[6], g[7]))
    // NAT64 (64:ff9b::/96) zeigt auf eine IPv4-Adresse
    if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return istPrivatV4(v4aus(g[6], g[7]))
    /*
     * Zwei weitere Präfixe mit eingebetteter IPv4 (Gesamtaudit 26.10.2026,
     * SEC-SRV-020) — vorher gingen `[::ffff:0:7f00:1]` und `64:ff9b:1::…` als
     * „öffentlich" durch. Linux bildet sie nicht auf IPv4 ab, ein NAT64- oder
     * SIIT-Gateway im Netz aber sehr wohl.
     *
     * ::ffff:0:0/96 — IPv4-übersetzt (SIIT, RFC 7915), IPv4 in den letzten 32 Bit.
     */
    if (nullBis(4) && g[4] === 0xffff && g[5] === 0) return istPrivatV4(v4aus(g[6], g[7]))
    /*
     * 64:ff9b:1::/48 — lokales NAT64 (RFC 8215). Wo die IPv4 steht, hängt an
     * der Präfixlänge, die der Betreiber wählt (RFC 6052: /48, /56, /64, /96).
     * Die kennen wir nicht — also jede Lage prüfen, die die Adresse zulässt
     * (Byte 8 frei und alles hinter der IPv4 null; /96 passt immer). Ist eine
     * davon intern, ist die Adresse zu.
     */
    if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) {
        const b = g.flatMap((x) => [x >> 8, x & 255])
        const nullAb = (i) => b.slice(i).every((x) => x === 0)
        const lagen = [
            [[6, 7, 9, 10], b[8] === 0 && nullAb(11)],      // /48
            [[7, 9, 10, 11], b[8] === 0 && nullAb(12)],     // /56
            [[9, 10, 11, 12], b[8] === 0 && nullAb(13)],    // /64
            [[12, 13, 14, 15], true],                       // /96
        ]
        return lagen.some(([l, moeglich]) => moeglich && istPrivatV4(l.map((i) => b[i]).join('.')))
    }
    if ((g[0] & 0xfe00) === 0xfc00) return true        // fc00::/7 eindeutig lokal
    if ((g[0] & 0xffc0) === 0xfe80) return true        // fe80::/10 verbindungslokal
    if ((g[0] & 0xffc0) === 0xfec0) return true        // fec0::/10 site-local (veraltet)
    if ((g[0] & 0xff00) === 0xff00) return true        // Multicast
    return false
}

/** Ist diese (aufgelöste oder literale) Adresse intern? */
export function istInterneAdresse(adresse) {
    const typ = net.isIP(String(adresse))
    if (typ === 4) return istPrivatV4(String(adresse))
    if (typ === 6) return istPrivatV6(String(adresse))
    return true
}

/**
 * `lookup` für den Abruf-Agenten: löst auf, prüft JEDE Adresse und gibt nur
 * geprüfte zurück. Weil der Agent genau damit verbindet, gibt es zwischen
 * Prüfung und Verbindung keine zweite Auflösung mehr.
 */
export function sichererLookup(hostname, optionen, rueckruf) {
    if (typeof optionen === 'function') { rueckruf = optionen; optionen = {} }
    dns.lookup(hostname, { ...optionen, all: true }, (fehler, adressen) => {
        if (fehler) return rueckruf(fehler)
        const liste = Array.isArray(adressen) ? adressen : [{ address: adressen, family: optionen?.family || 4 }]
        if (!liste.length) return rueckruf(fehlerMit(`Name „${hostname}" liefert keine Adresse`, { art: 'dns', code: 'ENODATA' }))
        const intern = liste.find((a) => istInterneAdresse(a.address))
        if (intern) {
            return rueckruf(fehlerMit(`„${hostname}" zeigt auf eine interne Adresse`, { art: 'gesperrt', adresse: intern.address, code: 'EINTERN' }))
        }
        if (optionen?.all) return rueckruf(null, liste)
        return rueckruf(null, liste[0].address, liste[0].family)
    })
}

/** Abruf-Agent mit festgenageltem, geprüftem Ziel — für jeden Abruf an Fremd-URLs. */
export const GESCHUETZT = new Agent({ connect: { lookup: sichererLookup } })

const VERBOTENE_ENDUNGEN = ['.local', '.internal', '.home.arpa', '.lan', '.localdomain']

/**
 * Prüft eine vom Nutzer eingetragene URL. Wirft mit klartextlicher Begründung —
 * die Meldung landet in der Oberfläche, also soll sie erklären statt abweisen.
 */
export async function pruefeOeffentlicheUrl(rawUrl) {
    let url
    try {
        url = new URL(String(rawUrl || '').trim())
    } catch {
        throw fehlerMit('Keine gültige Adresse', { art: 'gesperrt' })
    }

    if (!['http:', 'https:'].includes(url.protocol)) {
        throw fehlerMit(`Nur http und https sind erlaubt (nicht ${url.protocol.replace(':', '')})`, { art: 'gesperrt' })
    }
    if (url.username || url.password) {
        throw fehlerMit('Zugangsdaten in der Adresse sind nicht erlaubt', { art: 'gesperrt' })
    }
    if (url.port && !['80', '443'].includes(url.port)) {
        // Ein freier Port machte den Server zum Portscanner im eigenen Netz
        throw fehlerMit(`Nur Port 80 und 443 sind erlaubt (nicht ${url.port})`, { art: 'gesperrt' })
    }

    // IPv6 steht in der URL in eckigen Klammern — die muss der Namensauflöser
    // nicht sehen, sonst scheitert er mit „nicht auflösbar" statt die Adresse
    // als intern zu erkennen.
    const host = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '')
    if (host === 'localhost' || VERBOTENE_ENDUNGEN.some(e => host.endsWith(e))) {
        throw fehlerMit(`„${host}" zeigt ins eigene Netz`, { art: 'gesperrt' })
    }

    if (FESTE_HOSTS.has(host)) return { ok: true, host, adressen: [] }

    let adressen
    try {
        adressen = await dns.promises.lookup(host, { all: true })
    } catch (e) {
        // ENOTFOUND heisst „Name gibt es nicht", EAI_AGAIN „Namensdienst gerade nicht
        // erreichbar" — für den Aufrufer ein Unterschied zwischen tot und unbekannt.
        throw fehlerMit(`Name „${host}" nicht auflösbar`, { art: 'dns', code: e.code })
    }
    if (!adressen.length) throw fehlerMit(`Name „${host}" liefert keine Adresse`, { art: 'dns', code: 'ENODATA' })

    // JEDE Adresse prüfen: ein Name kann auf mehrere zeigen, und es genügt
    // eine interne, um den Abruf zum Einfallstor zu machen.
    for (const { address } of adressen) {
        const privat = istInterneAdresse(address)
        // Die Adresse steht im Feld, nicht im Text (A2-33): der Text landet in
        // der Oberfläche und verriete sonst die Belegung des eigenen Netzes.
        if (privat) throw fehlerMit(`„${host}" zeigt auf eine interne Adresse`, { art: 'gesperrt', adresse: address })
    }

    return { ok: true, host, adressen: adressen.map(a => a.address) }
}

/**
 * Antwortstatus, bei denen sich ein zweiter Anlauf lohnt.
 *
 * Dass hier **404** steht, sieht falsch aus und ist es nicht: YouTube liefert
 * für `feeds/videos.xml` in etwa der Hälfte aller Abrufe einen 404, dessen
 * Rumpf Googles allgemeine Fehlerseite mit dem Titel „Error 500 (Server
 * Error)" enthält — ein Fehler ihrer Zustellschicht, kein „gibt es nicht".
 * Gemessen am 19.08.2026: zehn Abrufe desselben, gültigen Kanals ergaben
 * 200/500/200/404/404/404/200/200/200/404, unabhängig vom User-Agent.
 * Ein einzelner Anlauf liess deshalb reihum Quellen als kaputt erscheinen,
 * die es nicht sind.
 *
 * Nicht dabei sind 401/403/410: ein fehlender Zugang oder eine gelöschte
 * Adresse wird durch Wiederholen nicht besser, sie kostet nur Zeit.
 */
const WIEDERHOLBAR = new Set([404, 408, 425, 429, 500, 502, 503, 504])

/**
 * Wartezeiten zwischen den Anläufen; der letzte Wert gilt für alle weiteren.
 *
 * Nicht kürzer: die Fehlschläge kommen in Serie, nicht unabhängig voneinander
 * (vermutlich derselbe Endpunkt über dieselbe offene Verbindung). Gemessen am
 * YouTube-Feed bei 50 % Fehlerquote je Einzelabruf — mit 400/1200 ms kamen
 * 18 von 22 Abrufen durch, mit längeren Pausen 12 von 12. Beide Stichproben
 * sind klein; deshalb die Mitte statt der Bestwert-Einstellung.
 */
const WARTEN_MS = [800, 2500]

/**
 * Text abrufen — mit Prüfung, eigener Umleitungsverfolgung und Grössengrenze.
 *
 * Vorübergehende Fehler werden bis zu `versuche` Mal wiederholt (siehe
 * `WIEDERHOLBAR`). Endgültiges — gesperrtes Ziel, zu grosse Antwort, 403 —
 * fliegt sofort, ohne zweiten Anlauf.
 */
export async function holeText(rawUrl, { timeout = HTTP_TIMEOUT, versuche = 3 } = {}) {
    const anlaeufe = Math.max(1, Number(versuche) || 1)
    let letzter
    for (let versuch = 0; versuch < anlaeufe; versuch++) {
        if (versuch) {
            const warten = WARTEN_MS[versuch - 1] ?? WARTEN_MS[WARTEN_MS.length - 1]
            await new Promise(r => setTimeout(r, warten))
        }
        try {
            return await einAbruf(rawUrl, timeout)
        } catch (e) {
            if (!e.wiederholbar) throw e
            letzter = e
        }
    }
    throw letzter
}

/**
 * Binärdaten (Bilder) abrufen — dieselben Riegel wie `holeText`: Prüfung,
 * festgenageltes Ziel, eigene Umleitungsverfolgung, Grössen- und Zeitgrenze.
 *
 * Seit F2 (Audit A2-12) für die Chartbilder der Perplexity-Bildersuche: deren
 * URLs sind Fremddaten und wurden bis dahin mit rohem `fetch` geholt —
 * Umleitungen gefolgt, jeder Port, ohne Grössengrenze.
 *
 * @param {string} rawUrl
 * @param {{timeout?:number, maxBytes?:number, typ?:RegExp}} [opt]
 * @returns {Promise<{daten: Buffer, typ: string}>}
 */
export async function holeBinaer(rawUrl, { timeout = HTTP_TIMEOUT, maxBytes = 8 * 1024 * 1024, typ = null } = {}) {
    return einAbruf(rawUrl, timeout, { binaer: true, maxBytes, typ, accept: 'image/*' })
}

/**
 * Ein einzelner Anlauf.
 *
 * Die Umleitungen werden selbst verfolgt, weil `fetch` sonst still einer
 * Weiterleitung auf 127.0.0.1 folgen würde und die Prüfung damit umgangen wäre.
 */
async function einAbruf(rawUrl, timeout, {
    binaer = false,
    maxBytes = MAX_BYTES,
    typ = null,
    accept = 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
} = {}) {
    let ziel = String(rawUrl || '').trim()

    for (let sprung = 0; sprung <= MAX_UMLEITUNGEN; sprung++) {
        await pruefeOeffentlicheUrl(ziel)

        /*
         * Die Zeitgrenze gilt bis zum letzten Byte, nicht nur bis zu den
         * Kopfzeilen (A2-33): ein Host, der 2 MB im Schneckentempo tröpfeln
         * lässt, hielt den Abruf sonst beliebig lange offen.
         */
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), timeout)
        try {
            let antwort
            try {
                antwort = await fetch(ziel, {
                    signal: ctrl.signal,
                    redirect: 'manual',
                    dispatcher: GESCHUETZT,
                    headers: {
                        'User-Agent': 'AutarkTrade (Marktradar)',
                        Accept: accept,
                    },
                })
            } catch (e) {
                // Das festgenagelte Ziel war intern: endgültig, nicht wiederholen.
                const ursache = e?.cause
                if (ursache?.art === 'gesperrt') throw ursache
                // Abbruch durch die Zeitgrenze und Netzfehler sind beide
                // vorübergehend — der nächste Anlauf darf sie sehen.
                e.wiederholbar = true
                e.art = e.name === 'AbortError' ? 'zeit' : 'netz'
                // Der Abbruch ist eine DOMException, deren `code` nur einen Getter
                // hat — eine Zuweisung würfe hier einen NEUEN Fehler, ohne `wiederholbar`.
                if (e.code === undefined && e.cause?.code) {
                    try { e.code = e.cause.code } catch { /* nur lesbar */ }
                }
                throw e
            }

            if ([301, 302, 303, 307, 308].includes(antwort.status)) {
                const ort = antwort.headers.get('location')
                if (!ort) throw fehlerMit(`Umleitung ohne Ziel (HTTP ${antwort.status})`, { art: 'umleitung' })
                ziel = new URL(ort, ziel).toString()
                continue
            }

            if (!antwort.ok) {
                const e = new Error(`HTTP ${antwort.status}`)
                e.status = antwort.status
                e.wiederholbar = WIEDERHOLBAR.has(antwort.status)
                throw e
            }

            const inhaltsTyp = String(antwort.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
            if (typ && !typ.test(inhaltsTyp)) throw fehlerMit(`Unerwarteter Inhaltstyp (${inhaltsTyp || 'keiner'})`, { art: 'gesperrt' })

            const laenge = Number(antwort.headers.get('content-length') || 0)
            if (laenge > maxBytes) throw fehlerMit(`Antwort zu gross (${Math.round(laenge / 1024)} kB)`, { art: 'zuGross' })

            /*
             * Strömend lesen und beim Überschreiten abbrechen.
             *
             * Der `content-length`-Kopf allein genügt nicht: bei chunked Transfer
             * fehlt er, und `antwort.text()` liest dann ERST alles in den Speicher
             * und prüft danach. Ein bösartiger Feed-Host kann in den zehn Sekunden
             * Zeitgrenze hunderte MB schicken — auf dem NAS-Container reicht das
             * für einen Speicher-Engpass.
             */
            if (!antwort.body) return binaer ? { daten: Buffer.alloc(0), typ: inhaltsTyp } : ''
            const leser = antwort.body.getReader()
            const stuecke = []
            let bytes = 0
            try {
                for (;;) {
                    const { done, value } = await leser.read()
                    if (done) break
                    bytes += value.byteLength
                    if (bytes > maxBytes) {
                        throw fehlerMit(`Antwort zu gross (über ${Math.round(maxBytes / 1024)} kB)`, { art: 'zuGross' })
                    }
                    stuecke.push(Buffer.from(value))
                }
            } catch (e) {
                if (e?.name === 'AbortError') throw fehlerMit('Zeitgrenze beim Lesen überschritten', { art: 'zeit', wiederholbar: true })
                throw e
            } finally {
                try { await leser.cancel() } catch { /* Strom schon zu */ }
            }
            const daten = Buffer.concat(stuecke)
            return binaer ? { daten, typ: inhaltsTyp } : new TextDecoder('utf-8').decode(daten)
        } finally {
            clearTimeout(timer)
        }
    }

    throw fehlerMit(`Mehr als ${MAX_UMLEITUNGEN} Umleitungen`, { art: 'umleitung' })
}
