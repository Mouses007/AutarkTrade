/**
 * Selbsttest „Board flashen" (`shared/esp32-flashen.js`, `server/esp32-firmware.js`,
 * `src/utils/esp32Flasher.js`): MD5 gegen Node, Partitionstabelle, NVS-Schutz,
 * Board-Wahl je Chip, Fehlerklassen, Routen-Whitelist und die abgelegten
 * Firmware-Manifeste (Dateien vorhanden, SHA-256 stimmt, nichts berührt NVS).
 *
 *   node shared/__selftest-esp32-flashen.mjs
 */
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { ESP32_BOARDS, FIRMWARE_DATEIEN, boardsFuerChip, leseParitionstabelle, nvsBereich, pruefeSchreibbereiche, md5Hex, cfgFehler, cfgZeile, cfgAntwort, zeilenTeiler, hostVorschlag, httpPortVorschlag, CFG_MAX_BYTES, bereinigeNetze, signalBalken, NETZE_MAX } from './esp32-flashen.js'
import { ladeFirmwareListe, firmwareDateiPfad } from '../server/esp32-firmware.js'
import { ordneFehler, vergleicheNvs, browserTauglich, FlasherFehler, Esp32Flasher, sendeEinstellungen, oeffneWieder, CfgVerbindung, schliessePortSicher, RESET_FOLGEN, wechselndeResets, VERBINDUNGS_ANLAEUFE, istUsbWandler } from '../src/utils/esp32Flasher.js'

let bestanden = 0
let fehlgeschlagen = 0
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// ── MD5 ───────────────────────────────────────────────────────
for (const n of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000, 70000]) {
    const daten = crypto.randomBytes(n)
    const soll = crypto.createHash('md5').update(daten).digest('hex')
    check(`MD5 ${n} Byte == Node`, md5Hex(new Uint8Array(daten)) === soll)
}
check('MD5 RFC-1321-Beispiel "abc"', md5Hex(new TextEncoder().encode('abc')) === '900150983cd24fb0d6963f7d28e17f72')

// ── Partitionstabelle (Arduino-Standard, von Hand gebaut) ─────
function eintrag(name, typ, untertyp, offset, groesse) {
    const b = Buffer.alloc(32)
    b.writeUInt16LE(0x50aa, 0); b[2] = typ; b[3] = untertyp
    b.writeUInt32LE(offset, 4); b.writeUInt32LE(groesse, 8)
    b.write(name, 12, 'latin1')
    return b
}
const md5Zeile = Buffer.alloc(32, 0); md5Zeile.writeUInt16LE(0xebeb, 0)
const tabelleBytes = Buffer.concat([
    eintrag('nvs', 1, 2, 0x9000, 0x5000),
    eintrag('otadata', 1, 0, 0xe000, 0x2000),
    eintrag('app0', 0, 0x10, 0x10000, 0x140000),
    eintrag('app1', 0, 0x11, 0x150000, 0x140000),
    md5Zeile,
    Buffer.alloc(3072 - 32 * 5, 0xff),
])
const tab = leseParitionstabelle(new Uint8Array(tabelleBytes))
check('Tabelle: 4 Einträge, MD5-Zeile beendet', tab?.length === 4, JSON.stringify(tab))
check('NVS bei 0x9000+0x5000', JSON.stringify(nvsBereich(tab)) === JSON.stringify({ offset: 0x9000, groesse: 0x5000 }))
check('Gelöschtes Flash (0xFF) → null', leseParitionstabelle(new Uint8Array(3072).fill(0xff)) === null)
check('Fremde Bytes → null', leseParitionstabelle(new Uint8Array(3072).fill(0x12)) === null)

// ── NVS-Schutz ────────────────────────────────────────────────
const nvs = [{ offset: 0x9000, groesse: 0x5000 }]
const normal = [
    { datei: 'bootloader.bin', offset: 0x1000, groesse: 17536 },
    { datei: 'partitions.bin', offset: 0x8000, groesse: 3072 },
    { datei: 'boot_app0.bin', offset: 0xe000, groesse: 8192 },
    { datei: 'firmware.bin', offset: 0x10000, groesse: 1099840 },
]
check('Standard-Schreibliste berührt NVS nicht', pruefeSchreibbereiche(normal, nvs).length === 0)
check('partitions.bin 4 KB lang → überschneidet NVS', pruefeSchreibbereiche([{ datei: 'x', offset: 0x8000, groesse: 0x1001 }], nvs).length === 1)
check('Datei direkt nach NVS (0xE000) ist erlaubt', pruefeSchreibbereiche([{ datei: 'x', offset: 0xe000, groesse: 1 }], nvs).length === 0)
check('Datei endet genau bei 0x9000 ist erlaubt', pruefeSchreibbereiche([{ datei: 'x', offset: 0x8000, groesse: 0x1000 }], nvs).length === 0)
check('Datei über das Flash-Ende', pruefeSchreibbereiche([{ datei: 'x', offset: 0x3f0000, groesse: 0x20000 }], [], 0x400000).length === 1)
check('Dateien überschneiden sich gegenseitig', pruefeSchreibbereiche([{ datei: 'a', offset: 0, groesse: 0x9000 }, { datei: 'b', offset: 0x8000, groesse: 16 }], []).length === 1)

// ── Board-Wahl ────────────────────────────────────────────────
check('ESP32 → genau CYD', boardsFuerChip('ESP32').map((b) => b.id).join() === 'cyd')
check('ESP32-S3 → beide Waveshare (Nutzer wählt)', boardsFuerChip('ESP32-S3').map((b) => b.id).sort().join() === 'waveshare-epaper,waveshare-touch')
check('ESP32-C3 → keins', boardsFuerChip('ESP32-C3').length === 0)
check('Ordner existieren im Repo', ESP32_BOARDS.every((b) => fs.existsSync(path.join(WURZEL, b.ordner, 'platformio.ini'))))
check('env steht in platformio.ini', ESP32_BOARDS.every((b) => fs.readFileSync(path.join(WURZEL, b.ordner, 'platformio.ini'), 'utf8').includes(`[env:${b.env}]`)))

// ── Fehlerklassen ─────────────────────────────────────────────
const dom = (name, message) => Object.assign(new Error(message), { name })
check('Auswahl geschlossen → keinPort', ordneFehler(dom('NotFoundError', 'No port selected by the user.')).code === 'keinPort')
check('Port offen woanders → portBelegt', ordneFehler(dom('NetworkError', 'Failed to open serial port.')).code === 'portBelegt')
check('Port schon offen → portBelegt', ordneFehler(dom('InvalidStateError', 'The port is already open.')).code === 'portBelegt')
check('Kein Bootloader → keineVerbindung', ordneFehler(new Error('Failed to connect with the device')).code === 'keineVerbindung')
check('Abbruch schlägt alles', ordneFehler(new Error('Failed to connect with the device'), true).code === 'abgebrochen')
check('Eigener Fehler bleibt', ordneFehler(new FlasherFehler('schutz', 'x')).code === 'schutz')
check('Unbekannt', ordneFehler(new Error('irgendwas')).code === 'unbekannt')
check('Browser: unsicher vor keinSerial', browserTauglich({ isSecureContext: false, navigator: {} }) === 'unsicher')
check('Browser: kein Serial', browserTauglich({ isSecureContext: true, navigator: {} }) === 'keinSerial')
check('Browser: ok', browserTauglich({ isSecureContext: true, navigator: { serial: {} } }) === 'ok')
check('NVS-Vergleich gleich', vergleicheNvs(tab, { nvs: { offset: 0x9000, groesse: 0x5000 } }) === 'gleich')
check('NVS-Vergleich anders', vergleicheNvs(tab, { nvs: { offset: 0x9000, groesse: 0x6000 } }) === 'anders')
check('NVS-Vergleich leeres Board', vergleicheNvs(null, { nvs: { offset: 0x9000, groesse: 0x5000 } }) === 'leer')

// ── Fortschritt und Schreibliste (Loader-Attrappe wie esptool-js) ─
{
    const f = new Esp32Flasher()
    let optionen = null
    f.loader = {
        async writeFlash(o) {
            optionen = o
            // esptool-js meldet je Datei die KOMPRIMIERTEN Bytes: hier 60 % der Grösse
            for (const [i, d] of o.fileArray.entries()) {
                const komp = Math.ceil(d.data.length * 0.6)
                o.reportProgress(i, 0, komp)
                o.reportProgress(i, Math.floor(komp / 2), komp)
                o.reportProgress(i, komp, komp)
            }
        },
    }
    const dateien = [
        { datei: 'bootloader.bin', offset: 0x0, groesse: 1000, daten: new Uint8Array(1000) },
        { datei: 'firmware.bin', offset: 0x10000, groesse: 9000, daten: new Uint8Array(9000) },
    ]
    const stand = []
    await f.flashen(dateien, { modus: 'dio', frequenz: '80m', groesse: '8MB' }, nvs, (w, n) => stand.push([w, n]))
    check('Fortschritt erreicht 100 % erst am Ende und steigt monoton',
        stand.every(([w], i) => i === 0 || w >= stand[i - 1][0]) && stand.at(-1)[0] === 10000 && stand.filter(([w]) => w === 10000).length <= 2,
        JSON.stringify(stand))
    check('Fortschritt Mitte der zweiten Datei ≈ 55 %', stand.some(([w]) => w === 1000 + 4500), JSON.stringify(stand))
    check('Kein Erase-All, Flash-Parameter durchgereicht', optionen.eraseAll === false && optionen.flashMode === 'dio' && optionen.flashSize === '8MB')
    check('MD5-Prüfung aktiv', typeof optionen.calculateMD5Hash === 'function')
    let geworfen = null
    try { await f.flashen([{ datei: 'x', offset: 0x9000, groesse: 4, daten: new Uint8Array(4) }], null, nvs) } catch (e) { geworfen = e }
    check('Datei im NVS → schutz, nichts geschrieben', geworfen?.code === 'schutz')
}

// ── CFG-Protokoll: Zeile bauen, Antworten erkennen ────────────
const gut = { ssid: 'Häusle 2.4', pass: 'geheim123', host: '192.168.178.100', port: 8080, key: 'ab'.repeat(32) }
const zeile = cfgZeile(gut)
check('CFG-Zeile: Präfix, eine Zeile, \\n am Ende', zeile.startsWith('CFG {') && zeile.endsWith('}\n') && zeile.indexOf('\n') === zeile.length - 1)
const json = JSON.parse(zeile.slice(4))
check('CFG-Zeile: genau die fünf Felder, port als String', JSON.stringify(Object.keys(json)) === '["ssid","pass","host","port","key"]' && json.port === '8080')
check('CFG-Zeile: Umlaute/Anführungszeichen sauber in JSON', JSON.parse(cfgZeile({ ...gut, ssid: 'A"b\\c ä' }).slice(4)).ssid === 'A"b\\c ä')
check('invert: nur als Bool mitgeschickt, fehlt sonst', JSON.parse(cfgZeile({ ...gut, invert: false }).slice(4)).invert === false && JSON.parse(cfgZeile({ ...gut, invert: true }).slice(4)).invert === true && !('invert' in JSON.parse(cfgZeile(gut).slice(4))) && !('invert' in JSON.parse(cfgZeile({ ...gut, invert: 'ja' }).slice(4))))
check('Offenes Netz: leeres Passwort erlaubt', cfgFehler({ ...gut, pass: '' }).length === 0)
check('WLAN-Passwort zu kurz', cfgFehler({ ...gut, pass: '1234567' }).includes('pass'))
check('SSID fehlt / > 32 Byte', cfgFehler({ ...gut, ssid: '' }).includes('ssid') && cfgFehler({ ...gut, ssid: 'ä'.repeat(17) }).includes('ssid'))
check('.local wird abgelehnt (Board kann kein mDNS)', cfgFehler({ ...gut, host: 'autarktrade.local' }).includes('hostLocal'))
check('Host mit Schema/Pfad abgelehnt', cfgFehler({ ...gut, host: 'http://1.2.3.4' }).includes('host') && cfgFehler({ ...gut, host: '1.2.3.4/x' }).includes('host'))
check('Port 0 / 70000 / Text abgelehnt', ['0', '70000', 'acht'].every((port) => cfgFehler({ ...gut, port }).includes('port')))
check('Schlüssel fehlt', cfgFehler({ ...gut, key: '' }).includes('key'))
check(`Zeile über ${CFG_MAX_BYTES} Byte abgelehnt`, cfgFehler({ ...gut, key: '"'.repeat(128), host: 'h'.repeat(250) + '.ch', pass: '"'.repeat(63), ssid: 's'.repeat(32) }).includes('laenge'))
let wirft = false
try { cfgZeile({ ...gut, port: 'x' }) } catch { wirft = true }
check('cfgZeile wirft bei ungültigen Eingaben', wirft)
check('Antwort BEREIT mit Version', JSON.stringify(cfgAntwort('[CFG] BEREIT 3.7.1-WS\r')) === '{"art":"bereit","version":"3.7.1-WS"}')
check('Antwort OK', cfgAntwort('[CFG] OK')?.art === 'ok')
check('Antwort FEHLER mit Grund', JSON.stringify(cfgAntwort('[CFG] FEHLER port')) === '{"art":"fehler","grund":"port"}')
check('Logzeilen sind keine Antwort', ['[BOOT] Start 1.3.0-EP', '[WiFi] 192.168.178.137', '[CFG] Filter synced from server: month', 'CFG?'].every((z) => cfgAntwort(z) === null))
const teile = zeilenTeiler()
check('Zeilenteiler über Stückgrenzen und \\r\\n', JSON.stringify([...teile('[BO'), ...teile('OT] a\r\n[CFG] BER'), ...teile('EIT 1\n')]) === '["[BOOT] a","[CFG] BEREIT 1"]')
check('Host-Vorschlag nur bei IPv4 in der Adresszeile', hostVorschlag({ hostname: '192.168.178.100' }) === '192.168.178.100' && hostVorschlag({ hostname: 'autarktrade.local' }) === '' && hostVorschlag({ hostname: '127.0.0.1' }) === '' && hostVorschlag({ hostname: '999.1.1.1' }) === '')
check('Port-Vorschlag: http-Port, bei https 8080', httpPortVorschlag({ protocol: 'http:', port: '8091' }) === '8091' && httpPortVorschlag({ protocol: 'https:', port: '8443' }) === '8080' && httpPortVorschlag({ protocol: 'http:', port: '' }) === '80')

// ── CFG-Ablauf gegen ein simuliertes Board ────────────────────
function boardAttrappe({ bereitNachFragen = 2, antwort = '[CFG] OK', scan = null, info = { usbVendorId: 0x303a, usbProductId: 0x1001 }, oeffnenFehlt = 0 } = {}) {
    const enc = new TextEncoder()
    const dec = new TextDecoder()
    let ctrl = null
    const port = {
        gesendet: [], offen: false, fragen: 0, oeffnenVersuche: 0,
        getInfo: () => info,
        async open() {
            port.oeffnenVersuche++
            if (port.oeffnenVersuche <= oeffnenFehlt) throw Object.assign(new Error('Failed to open serial port.'), { name: 'NetworkError' })
            port.offen = true
            port.readable = new ReadableStream({ start(c) { ctrl = c; c.enqueue(enc.encode('[BOOT] Start 1.3.0-EP\r\n[BOOT] Setup: BOOT-Taste 3 s halten\r\n')) } })
            port.writable = new WritableStream({
                write(chunk) {
                    const z = dec.decode(chunk)
                    port.gesendet.push(z)
                    if (z === 'CFG?\n' && ++port.fragen >= bereitNachFragen) setTimeout(() => ctrl.enqueue(enc.encode('[WiFi] 192.168.178.137\n[CFG] BEREIT 1.3.0-EP\n')), 5)
                    if (z.startsWith('CFG {') && antwort) setTimeout(() => ctrl.enqueue(enc.encode(antwort + '\r\n')), 5)
                    if (z === 'CFG SCAN\n' && scan) setTimeout(() => ctrl.enqueue(enc.encode('[KURS] HTTP 200\n' + scan + '\n')), 20)
                },
            })
        },
        async close() { port.offen = false },
    }
    return port
}
{
    const b = boardAttrappe()
    await b.open()
    const protokoll = []
    const erg = await sendeEinstellungen(b, gut, { log: (z) => protokoll.push(z), frageAlleMs: 30, bereitMs: 1000 })
    check('Ablauf: fragt wiederholt, bis BEREIT kommt', b.fragen === 2 && erg.version === '1.3.0-EP', JSON.stringify(b.gesendet))
    check('Ablauf: genau eine CFG-Zeile gesendet, identisch mit cfgZeile', b.gesendet.filter((z) => z.startsWith('CFG {')).length === 1 && b.gesendet.at(-1) === zeile)
    check('Ablauf: Logzeilen des Boards im Protokoll, Port danach zu', protokoll.some((z) => z.includes('[BOOT] Start')) && !b.offen)
    check('Ablauf: Schlüssel und Passwort stehen nicht im Protokoll', !protokoll.some((z) => z.includes(gut.key) || z.includes(gut.pass)))
}
{
    const b = boardAttrappe({ antwort: '[CFG] FEHLER felder' })
    await b.open()
    let f = null
    try { await sendeEinstellungen(b, gut, { frageAlleMs: 30, bereitMs: 1000 }) } catch (e) { f = e }
    check('Ablauf: FEHLER → cfgAbgelehnt mit Grund', f?.code === 'cfgAbgelehnt' && f.message === 'felder' && !b.offen)
}
{
    const b = boardAttrappe({ bereitNachFragen: 99 })
    await b.open()
    let f = null
    const t0 = Date.now()
    try { await sendeEinstellungen(b, gut, { frageAlleMs: 30, bereitMs: 200 }) } catch (e) { f = e }
    check('Ablauf: alte Firmware ohne CFG → cfgKeineAntwort nach der Frist, keine CFG-Zeile', f?.code === 'cfgKeineAntwort' && !b.gesendet.some((z) => z.startsWith('CFG {')) && Date.now() - t0 < 1000)
}
{
    const b = boardAttrappe({ antwort: null })
    await b.open()
    let f = null
    try { await sendeEinstellungen(b, gut, { frageAlleMs: 30, bereitMs: 1000, antwortMs: 100 }) } catch (e) { f = e }
    check('Ablauf: keine Antwort auf CFG → cfgKeineAntwort', f?.code === 'cfgKeineAntwort')
}
{
    const b = boardAttrappe()
    await b.open()
    let f = null, gesendet = false
    try { await sendeEinstellungen(b, { ...gut, port: 'x' }) } catch (e) { f = e; gesendet = b.gesendet.length > 0 }
    check('Ungültige Eingaben: nichts wird gesendet', !!f && !gesendet)
}
{
    // S3 natives USB: alter Port ist nach dem Reset tot, getPorts() liefert ein neues Objekt
    const alt = boardAttrappe({ oeffnenFehlt: 99 })
    const neu = boardAttrappe()
    const fremd = boardAttrappe({ info: { usbVendorId: 0x1a86, usbProductId: 0x7523 } })
    let aufrufe = 0
    const serial = { async getPorts() { aufrufe++; return aufrufe < 3 ? [alt, fremd] : [alt, fremd, neu] } }
    const p = await oeffneWieder(alt, { serial, wartenMs: 5000, pauseMs: 0 })
    check('Port wieder finden: neues Objekt gleicher USB-Kennung, fremder Port unberührt', p === neu && neu.offen && fremd.oeffnenVersuche === 0)
    const cyd = boardAttrappe({ info: { usbVendorId: 0x1a86, usbProductId: 0x7523 }, oeffnenFehlt: 1 })
    const p2 = await oeffneWieder(cyd, { serial: { async getPorts() { return [cyd] } }, wartenMs: 5000, pauseMs: 0 })
    check('Port wieder finden: USB-Seriell-Wandler bleibt derselbe Port', p2 === cyd)
    let f = null
    try { await oeffneWieder(alt, { serial: { async getPorts() { return [alt] } }, wartenMs: 600, pauseMs: 0 }) } catch (e) { f = e }
    check('Port wieder finden: Frist → portWeg', f?.code === 'portWeg')
}

{
    // Altes USB-Gerät kurz vor der Neuanmeldung: öffnet, Lesestrom endet sofort (am S3 gemessen)
    const sterbend = {
        getInfo: () => ({ usbVendorId: 0x303a, usbProductId: 0x1001 }),
        readable: new ReadableStream({ start(c) { setTimeout(() => c.close(), 20) } }),
        writable: new WritableStream({ write() {} }),
        async close() {},
    }
    let f = null
    const t0 = Date.now()
    try { await sendeEinstellungen(sterbend, gut, { frageAlleMs: 1000, bereitMs: 5000 }) } catch (e) { f = e }
    check('Lesestrom endet → getrennt, ohne die Frist abzuwarten', f?.code === 'getrennt' && Date.now() - t0 < 2500, `${f?.code} ${Date.now() - t0} ms`)
    const haengt = {
        getInfo: () => ({}),
        readable: new ReadableStream({ start() {} }),
        writable: new WritableStream({ write() { return new Promise(() => {}) } }),
        async close() {},
    }
    f = null
    try { await sendeEinstellungen(haengt, gut, { frageAlleMs: 50, bereitMs: 5000, schreibMs: 100 }) } catch (e) { f = e }
    check('Schreiben hängt → getrennt', f?.code === 'getrennt', f?.code)
}

// ── WLAN-Liste (CFG SCAN) ─────────────────────────────────────
{
    const roh = [{ ssid: 'Heim', rssi: -71, enc: 1 }, { ssid: 'Heim', rssi: -48, enc: 1 }, { ssid: '', rssi: -30, enc: 1 }, { ssid: 'Gast', rssi: -82, enc: 0 }, { ssid: 7, rssi: -1 }, null]
    const a = cfgAntwort('[CFG] NETZE ' + JSON.stringify(roh))
    check('NETZE: gelesen, je SSID der stärkste, versteckte/kaputte weg, sortiert', a?.art === 'netze' && JSON.stringify(a.netze) === '[{"ssid":"Heim","rssi":-48,"enc":1},{"ssid":"Gast","rssi":-82,"enc":0}]', JSON.stringify(a))
    check('NETZE: leeres Array ist eine gültige (leere) Liste', JSON.stringify(cfgAntwort('[CFG] NETZE []')) === '{"art":"netze","netze":[]}')
    check('NETZE: kaputtes JSON → fehler netze', JSON.stringify(cfgAntwort('[CFG] NETZE [{"ssid":')) === '{"art":"fehler","grund":"netze"}')
    check(`NETZE: höchstens ${NETZE_MAX}`, bereinigeNetze(Array.from({ length: 40 }, (_, i) => ({ ssid: 'N' + i, rssi: -i, enc: 1 }))).length === NETZE_MAX)
    check('NETZE: SSID mit Anführungszeichen/Umlauten bleibt', cfgAntwort('[CFG] NETZE ' + JSON.stringify([{ ssid: 'Mü "x"', rssi: -60, enc: 1 }])).netze[0].ssid === 'Mü "x"')
    check('Balken: -50 → 4, -60 → 3, -75 → 2, -90 → 1', [-50, -60, -75, -90].map(signalBalken).join() === '4,3,2,1')

    const liste = [{ ssid: 'Heim', rssi: -48, enc: 1 }, { ssid: 'Gast', rssi: -82, enc: 0 }]
    const b = boardAttrappe({ scan: '[CFG] NETZE ' + JSON.stringify(liste) })
    await b.open()
    const protokoll = []
    const v = new CfgVerbindung(b, { log: (z) => protokoll.push(z) })
    await v.warteBereit({ frageAlleMs: 30, bereitMs: 1000 })
    const netze = await v.suche({ ms: 1000 })
    check('Suche: Liste kommt nach Logzeilen an', JSON.stringify(netze) === JSON.stringify(liste))
    check('Suche: Protokoll zeigt nur die Zahl, nicht die ganze Liste', protokoll.includes('[Board] [CFG] NETZE (2)') && !protokoll.some((z) => z.includes('Heim')))
    await v.sende({ ...gut, ssid: 'Heim' })
    await v.schliessen()
    check('Suche → Senden → Schliessen: CFG SCAN vor der CFG-Zeile, Port zu', b.gesendet.indexOf('CFG SCAN\n') < b.gesendet.findIndex((z) => z.startsWith('CFG {')) && !b.offen)

    const alt = boardAttrappe() // Firmware ohne SCAN
    await alt.open()
    const v2 = new CfgVerbindung(alt)
    await v2.warteBereit({ frageAlleMs: 30, bereitMs: 1000 })
    let f = null
    try { await v2.suche({ ms: 150 }) } catch (e) { f = e }
    await v2.schliessen()
    check('Suche: Firmware ohne SCAN → cfgKeineAntwort (Rückfall auf freies Feld)', f?.code === 'cfgKeineAntwort' && !alt.offen)
}

// ── Port in JEDEM Fall freigeben ──────────────────────────────
{
    // Leser, dessen cancel() nie fertig wird, Schreiber mit hängendem write — close() muss trotzdem kommen
    let geschlossen = false
    const port = {
        readable: {}, writable: {},
        async close() { geschlossen = true; port.readable = null; port.writable = null },
    }
    const reader = { cancel: () => new Promise(() => {}), releaseLock() {} }
    const writer = { abort: () => new Promise(() => {}), releaseLock() {} }
    const t0 = Date.now()
    const zu = await schliessePortSicher(port, { reader, writer })
    check('Hängender Leser/Schreiber: Port wird trotzdem geschlossen (≤ 3 s)', zu && geschlossen && Date.now() - t0 < 3000, `${Date.now() - t0} ms`)

    // close() schlägt zweimal fehl (Ströme noch gesperrt), dann klappt es
    let versuche = 0
    const zaeh = { readable: {}, writable: {}, async close() { if (++versuche < 3) throw new Error('locked'); zaeh.readable = null; zaeh.writable = null } }
    check('close() wird wiederholt', (await schliessePortSicher(zaeh)) && versuche === 3)

    // Esp32Flasher.trennen: Transport.disconnect hängt ewig (waitForUnlock) → Port selbst schliessen
    const f = new Esp32Flasher()
    let portZu = false
    f.port = { readable: {}, writable: {}, async close() { portZu = true; f.port.readable = null; f.port.writable = null } }
    f.transport = { disconnect: () => new Promise(() => {}), reader: { cancel: async () => {}, releaseLock() {} } }
    f.loader = { after: () => new Promise(() => {}) }
    const t1 = Date.now()
    await f.trennen({ neustart: true })
    check('trennen(): hängendes after()/disconnect() → Port trotzdem zu (≤ 8 s)', portZu && f.transport === null && Date.now() - t1 < 8000, `${Date.now() - t1} ms`)
}

// ── Reset-Folgen in den Bootloader (CYD/CH340) ────────────────
{
    const aufrufe = []
    const transport = {
        async setDTR(v) { aufrufe.push('D' + (v ? 1 : 0)) },
        async setRTS(v) { aufrufe.push('R' + (v ? 1 : 0)) },
        async setSignals(d, r) { aufrufe.push(`DR${d ? 1 : 0}${r ? 1 : 0}`) },
    }
    const log = []
    const mache = wechselndeResets((z) => log.push(z))
    const strategie = mache(transport, 50)
    await strategie.reset()
    check('Anlauf 1 „ohne Reset": keine Leitung bewegt (Board von Hand im Boot-Modus bleibt drin)', aufrufe.length === 0 && log[0].includes('ohne'))
    await mache(transport, 550).reset() // esptool-js baut je Wartezeit eine eigene Strategie — der Zähler ist gemeinsam
    check('Anlauf 2 „zugleich": beide Leitungen je Aufruf wie esptool.py unter Linux', aufrufe.join() === 'DR00,DR11,DR01,DR10,DR00,D0', aufrufe.join())
    await strategie.reset()
    aufrufe.length = 0
    await strategie.reset()
    check('Anlauf 4 „getrennt": DTR/RTS einzeln wie esptool.py Classic', aufrufe.join() === 'D0,R1,D1,R0,D0', aufrufe.join())
    check('Folgen wechseln reihum, Protokoll zählt die Anläufe', log.length === 4 && log[3].startsWith('Verbindungsanlauf 4') && RESET_FOLGEN.length >= 5)
    check('Nur „ohne" am Anfang, nicht doppelt hintereinander', RESET_FOLGEN[0].art === 'ohne' && RESET_FOLGEN.filter((f) => f.art === 'ohne').length === 1)
    check('USB-Wandler erkannt (CH340 ja, S3 nativ nein, unbekannt nein)', istUsbWandler({ getInfo: () => ({ usbVendorId: 0x1a86 }) }) && !istUsbWandler({ getInfo: () => ({ usbVendorId: 0x303a }) }) && !istUsbWandler({ getInfo: () => ({}) }))
    check('Mehr Anläufe als esptool-js (7), jede Folge mindestens zweimal', VERBINDUNGS_ANLAEUFE > 7 && VERBINDUNGS_ANLAEUFE >= 2 * RESET_FOLGEN.length)
}

{
    // Neustart nach dem Flashen: eigener Reset (RTS an, dann aus, DTR aus) — für CYD UND S3 nativ;
    // esptool-js' HardReset setzt nur RTS aus, am S3 blieb das Board so stumm im Loader (02.11.2026)
    const aufrufe = []
    const f = new Esp32Flasher()
    f.nativ = false
    f.transport = { async setSignals(d, r) { aufrufe.push(`DR${d ? 1 : 0}${r ? 1 : 0}`) }, disconnect: async () => {} }
    f.loader = { after: async () => aufrufe.push('esptool-hard_reset') }
    await f.neustart()
    check('Neustart CYD: EN tief, dann frei, IO0 immer frei (nicht esptool-js HardReset)', aufrufe.join() === 'DR01,DR00', aufrufe.join())
    aufrufe.length = 0
    f.nativ = true
    await f.neustart()
    check('Neustart S3 nativ: derselbe Reset, nicht esptool-js HardReset', aufrufe.join() === 'DR01,DR00', aufrufe.join())
}

// ── Routen-Whitelist (Testordner) ─────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'at-fw-'))
fs.mkdirSync(path.join(tmp, 'cyd'))
fs.writeFileSync(path.join(tmp, 'cyd', 'firmware.bin'), 'x')
fs.writeFileSync(path.join(tmp, 'cyd', 'geheim.txt'), 'x')
fs.writeFileSync(path.join(tmp, 'cyd', 'manifest.json'), JSON.stringify({ id: 'cyd', dateien: [{ datei: 'firmware.bin' }, { datei: 'geheim.txt' }] }))
const liste = await ladeFirmwareListe(tmp)
check('Liste: nur abgelegte Boards', liste.map((b) => b.id).join() === 'cyd')
check('Liste: fremde Datei aus Manifest gefiltert', liste[0].dateien.map((d) => d.datei).join() === 'firmware.bin')
check('Datei erlaubt', (await firmwareDateiPfad('cyd', 'firmware.bin', tmp)) === path.join(tmp, 'cyd', 'firmware.bin'))
check('Datei nicht in Liste', (await firmwareDateiPfad('cyd', 'geheim.txt', tmp)) === null)
check('Pfad-Ausbruch', (await firmwareDateiPfad('..', 'firmware.bin', tmp)) === null && (await firmwareDateiPfad('cyd', '../manifest.json', tmp)) === null)
check('Bekanntes Board ohne Build', (await firmwareDateiPfad('waveshare-touch', 'firmware.bin', tmp)) === null)
fs.rmSync(tmp, { recursive: true, force: true })

// ── Abgelegte Firmware im Repo ────────────────────────────────
const echt = await ladeFirmwareListe()
check('Mindestens ein Board abgelegt', echt.length > 0, 'node scripts/esp32-firmware-bauen.mjs')
for (const m of echt) {
    const ordner = path.join(WURZEL, 'firmware', 'esp32', m.id)
    const namen = m.dateien.map((d) => d.datei).sort().join()
    check(`${m.id}: alle vier Dateien`, namen === [...FIRMWARE_DATEIEN].sort().join(), namen)
    const shaOk = m.dateien.every((d) => {
        const daten = fs.readFileSync(path.join(ordner, d.datei))
        return daten.length === d.groesse && crypto.createHash('sha256').update(daten).digest('hex') === d.sha256
    })
    check(`${m.id}: Grösse und SHA-256 stimmen`, shaOk)
    const tabelle = leseParitionstabelle(new Uint8Array(fs.readFileSync(path.join(ordner, 'partitions.bin'))))
    check(`${m.id}: NVS im Manifest == partitions.bin`, JSON.stringify(nvsBereich(tabelle)) === JSON.stringify(m.nvs))
    check(`${m.id}: nichts berührt NVS`, pruefeSchreibbereiche(m.dateien, [m.nvs]).length === 0)
    check(`${m.id}: Flash-Parameter gesetzt`, !!(m.flash?.modus && m.flash?.frequenz && m.flash?.groesse))
    const bootOffset = m.dateien.find((d) => d.datei === 'bootloader.bin')?.offset
    check(`${m.id}: Bootloader-Offset passt zum Chip`, bootOffset === (m.chip === 'ESP32' ? 0x1000 : 0x0), bootOffset)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
process.exit(fehlgeschlagen ? 1 : 0)
