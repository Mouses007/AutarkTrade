/**
 * Selbsttest der mDNS-Ansage (server/mdns-kern.js).
 * Prüft Bytes, nicht nur Verhalten: eine falsche Länge oder ein vertauschtes Bit
 * macht die Antwort für Geräte unlesbar, ohne dass irgendwo ein Fehler erscheint.
 */
import {
    normName, gueltigerName, ipBytes, leseName, leseAnfrage, schreibeName, fragtNach,
    baueAntwort, baueFrage, waehleIp, TYP_A, TTL,
} from './mdns-kern.js'

let ok = 0, fehler = 0
const pruefe = (bed, text) => { if (bed) { ok++; console.log('  ✓ ' + text) } else { fehler++; console.log('  ✗ ' + text) } }

// Namen
pruefe(normName('AutarkTrade.Local.') === 'autarktrade.local', 'Name wird normalisiert')
pruefe(gueltigerName('autarktrade.local'), 'autarktrade.local ist gültig')
pruefe(!gueltigerName('autarktrade.de') && !gueltigerName('auta_rk.local') && !gueltigerName('local') && !gueltigerName(''), 'Gegenprobe: .de, Unterstrich, nackt, leer sind ungültig')
pruefe(ipBytes('192.168.178.100').equals(Buffer.from([192, 168, 178, 100])), 'IPv4 → 4 Bytes')
pruefe(ipBytes('192.168.178') === null && ipBytes('256.1.1.1') === null && ipBytes('a.b.c.d') === null, 'Gegenprobe: ungültige IPv4 → null')

// Name schreiben/lesen
const nb = schreibeName('autarktrade.local')
pruefe(nb.equals(Buffer.from([11, ...Buffer.from('autarktrade'), 5, ...Buffer.from('local'), 0])), 'Name als Labels kodiert')
pruefe(leseName(nb, 0)?.name === 'autarktrade.local' && leseName(nb, 0).ende === nb.length, 'Name zurückgelesen, Ende stimmt')
// Kompression: zweiter Name zeigt auf den ersten (Offset 12 im Paket)
const komp = Buffer.concat([Buffer.alloc(12), nb, Buffer.from([0xc0, 12])])
pruefe(leseName(komp, 12 + nb.length)?.name === 'autarktrade.local' && leseName(komp, 12 + nb.length).ende === komp.length, 'komprimierter Name (Zeiger) wird gelesen')
const schleife = Buffer.concat([Buffer.alloc(12), Buffer.from([0xc0, 12])])
pruefe(leseName(schleife, 12) === null, 'Gegenprobe: Zeigerschleife bricht ab statt zu hängen')

// Anfrage
const frage = baueFrage('AutarkTrade.local')
const a = leseAnfrage(frage)
pruefe(a && a.fragen.length === 1 && a.fragen[0].name === 'autarktrade.local' && a.fragen[0].typ === TYP_A, 'Frage nach A gelesen')
pruefe(fragtNach(a, 'autarktrade.local'), 'eigene Frage erkannt (Gross-/Kleinschreibung egal)')
pruefe(!fragtNach(leseAnfrage(baueFrage('chefkoch-nas.local')), 'autarktrade.local'), 'Gegenprobe: fremder Name → keine Antwort')
pruefe(!fragtNach(leseAnfrage(baueFrage('autarktrade.local', { typ: 28 })), 'autarktrade.local'), 'Gegenprobe: AAAA-Frage → keine Antwort')
pruefe(fragtNach(leseAnfrage(baueFrage('autarktrade.local', { typ: 255 })), 'autarktrade.local'), 'ANY-Frage wird beantwortet')
pruefe(leseAnfrage(baueFrage('autarktrade.local', { unicast: true })).fragen[0].unicast === true, 'QU-Bit (Unicast-Antwort erbeten) wird gelesen')
const alsAntwort = Buffer.from(frage); alsAntwort.writeUInt16BE(0x8400, 2)
pruefe(leseAnfrage(alsAntwort) === null, 'Gegenprobe: Antworten anderer Geräte werden ignoriert')
pruefe(leseAnfrage(Buffer.alloc(5)) === null && leseAnfrage(frage.subarray(0, frage.length - 2)) === null, 'Gegenprobe: kurze/abgeschnittene Pakete → null')

// Antwort (Multicast)
const ant = baueAntwort('autarktrade.local', '192.168.178.100')
pruefe(ant.readUInt16BE(0) === 0 && ant.readUInt16BE(2) === 0x8400, 'Kopf: ID 0, Antwort + autoritativ')
pruefe(ant.readUInt16BE(4) === 0 && ant.readUInt16BE(6) === 1, 'Kopf: 0 Fragen, 1 Antwort')
const rr = 12 + nb.length
pruefe(ant.subarray(12, rr).equals(nb), 'Antwort trägt den Namen')
pruefe(ant.readUInt16BE(rr) === TYP_A && ant.readUInt16BE(rr + 2) === 0x8001, 'Typ A, Klasse IN mit Cache-Flush-Bit')
pruefe(ant.readUInt32BE(rr + 4) === TTL && ant.readUInt16BE(rr + 8) === 4, 'TTL 120, Datenlänge 4')
pruefe(ant.subarray(rr + 10).equals(Buffer.from([192, 168, 178, 100])) && ant.length === rr + 14, 'Adresse 192.168.178.100, nichts dahinter')

// Antwort auf Altanfrage (Unicast)
const uni = baueAntwort('autarktrade.local', '192.168.178.100', { id: 0x1234, mitFrage: true })
pruefe(uni.readUInt16BE(0) === 0x1234 && uni.readUInt16BE(4) === 1 && uni.readUInt16BE(6) === 1, 'Altanfrage: ID zurück, Frage wiederholt')
const rrU = 12 + nb.length + 4 + nb.length
pruefe(uni.readUInt16BE(rrU + 2) === 0x0001, 'Altanfrage: ohne Cache-Flush-Bit (RFC 6762 §6.7)')
let geworfen = false; try { baueAntwort('autarktrade.local', 'kaputt') } catch { geworfen = true }
pruefe(geworfen, 'Gegenprobe: ungültige IP wirft')

// IP-Wahl
const nets = {
    lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    docker0: [{ address: '172.17.0.1', family: 'IPv4', internal: false }],
    'br-abc': [{ address: '172.18.0.1', family: 'IPv4', internal: false }],
    eth0: [{ address: '192.168.178.100', family: 'IPv4', internal: false }, { address: 'fe80::1', family: 'IPv6', internal: false }],
}
pruefe(waehleIp(nets) === '192.168.178.100', 'IP-Wahl: LAN-Adresse, nicht Docker-Brücke')
pruefe(waehleIp({ docker0: nets.docker0, lo: nets.lo }) === null, 'Gegenprobe: nur Docker/Loopback → keine IP')
pruefe(waehleIp({ eth1: [{ address: '10.0.0.5', family: 4, internal: false }], eth0: nets.eth0 }) === '192.168.178.100', 'IP-Wahl: 192.168.* vor 10.*')

console.log(`mdns: ${ok} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler ? 1 : 0)
