/**
 * mDNS-Ansage: macht die App unter einem eigenen Namen erreichbar
 * (Vorgabe `autarktrade.local`), ohne die NAS umzubenennen.
 *
 *   node server/mdns-name.mjs
 *
 * Läuft als eigener Dienst im Compose-Projekt mit `network_mode: host` (Multicast
 * braucht das echte Netz). Hört auf 224.0.0.251:5353 neben dem mDNS-Dienst der NAS
 * (reuseAddr) und beantwortet NUR Fragen nach dem einen Namen mit der IPv4 der NAS.
 *
 * Umgebung:
 *   AT_MDNS_NAME  Name, Vorgabe autarktrade.local; leer oder „aus" = abgeschaltet
 *   AT_MDNS_IP    Adresse, die gemeldet wird; leer = automatisch (private IPv4)
 *
 * Fehlt etwas oder ist es ungültig, bleibt der Dienst untätig stehen, statt neu zu
 * starten: ein Neustart alle paar Sekunden wäre nur Lärm im Log.
 */
import dgram from 'node:dgram'
import os from 'node:os'
import { MDNS_ADRESSE, MDNS_PORT, normName, gueltigerName, leseAnfrage, fragtNach, baueAntwort, waehleIp, netzmaskeVon, imEigenenNetz } from './mdns-kern.js'

const roh = process.env.AT_MDNS_NAME ?? 'autarktrade.local'
const NAME = normName(roh)
const IP = (process.env.AT_MDNS_IP || '').trim() || waehleIp(os.networkInterfaces())
const MASKE = IP ? netzmaskeVon(os.networkInterfaces(), IP) : null

function untaetig(grund) {
    console.log(`[mdns] ${grund} — Dienst bleibt untätig`)
    setInterval(() => {}, 1 << 30)
}

if (!NAME || NAME === 'aus') untaetig('abgeschaltet (AT_MDNS_NAME leer/aus)')
else if (!gueltigerName(NAME)) untaetig(`ungültiger Name „${roh}" (erwartet z. B. autarktrade.local)`)
else if (!IP) untaetig('keine private IPv4 gefunden (AT_MDNS_IP setzen)')
else starte()

function starte() {
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    const multicast = baueAntwort(NAME, IP)
    let beantwortet = 0

    sock.on('error', (e) => console.log(`[mdns] Fehler: ${e.message}`))
    sock.on('message', (buf, rinfo) => {
        const anfrage = leseAnfrage(buf)
        if (!fragtNach(anfrage, NAME)) return
        if (rinfo.port !== MDNS_PORT) {
            // Altanfrage (einfacher Resolver, RFC 6762 §6.7): direkt an den Fragenden —
            // aber nur im eigenen Netz (RFC 6762 §11, Audit SEC-OPS-017). Eine Unicast-
            // Antwort an eine gefälschte, fremde Absenderadresse wäre ein Reflektor.
            if (!imEigenenNetz(rinfo.address, IP, MASKE)) return
            sock.send(baueAntwort(NAME, IP, { id: anfrage.id, mitFrage: true }), rinfo.port, rinfo.address)
        } else {
            sock.send(multicast, MDNS_PORT, MDNS_ADRESSE)
        }
        if (++beantwortet <= 3 || beantwortet % 100 === 0) console.log(`[mdns] ${NAME} → ${IP} (Anfrage von ${rinfo.address}, ${beantwortet}.)`)
    })
    sock.bind(MDNS_PORT, () => {
        try {
            sock.addMembership(MDNS_ADRESSE, IP)
        } catch {
            sock.addMembership(MDNS_ADRESSE)
        }
        try { sock.setMulticastInterface(IP) } catch { /* Standardschnittstelle */ }
        sock.setMulticastTTL(255)
        sock.setMulticastLoopback(true)
        console.log(`[mdns] kündige ${NAME} → ${IP} an (Altanfragen nur aus ${IP}/${MASKE})`)
        // Ankündigung beim Start (RFC 6762 §8.3: mindestens zweimal, 1 s Abstand)
        sock.send(multicast, MDNS_PORT, MDNS_ADRESSE)
        setTimeout(() => sock.send(multicast, MDNS_PORT, MDNS_ADRESSE), 1000)
    })
    const ende = () => { try { sock.close() } catch { /* zu */ } process.exit(0) }
    process.on('SIGTERM', ende)
    process.on('SIGINT', ende)
}
