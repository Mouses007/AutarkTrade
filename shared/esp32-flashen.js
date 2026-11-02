/**
 * ESP32-Anzeigen aus der Web-App flashen — was Build-Skript, Server und Browser
 * gemeinsam wissen müssen.
 *
 * - `ESP32_BOARDS`: die drei Firmware-Projekte im Repo, mit dem Chip, den esptool-js
 *   meldet. Zwei Boards haben einen ESP32-S3; die lassen sich über den Chip nicht
 *   unterscheiden, also wählt der Nutzer (`boardsFuerChip`), nie die App.
 * - `leseParitionstabelle`: die Partitionstabelle (0x8000) eines Builds oder des
 *   Boards. Daraus kommt der NVS-Bereich, in dem die Firmware WLAN, Server und
 *   Schlüssel ablegt (Preferences).
 * - `pruefeSchreibbereiche`: keine Datei darf NVS (oder ausserhalb des Flashs)
 *   berühren — das Flashen schreibt nur Bootloader, Tabelle, otadata und App.
 * - `md5Hex`: esptool-js prüft das Geschriebene nur mit einer MD5-Funktion, und
 *   `crypto.subtle` kennt kein MD5.
 */

/** Firmware-Projekte; `id` ist zugleich der Ordner unter firmware/esp32/. */
export const ESP32_BOARDS = [
    { id: 'cyd', ordner: 'ESP32-2432S028', env: 'esp32dev', chip: 'ESP32', name: 'ESP32-2432S028 (Cheap Yellow Display)' },
    { id: 'waveshare-touch', ordner: 'ESP32-Waveshare', env: 'esp32dev', chip: 'ESP32-S3', name: 'Waveshare ESP32-S3-Touch-LCD-2.8' },
    { id: 'waveshare-epaper', ordner: 'ESP32-Waveshare-ePaper', env: 'esp32s3epaper', chip: 'ESP32-S3', name: 'Waveshare ESP32-S3-ePaper-3.97' },
]

/** Erlaubte Dateinamen einer Firmware (Server liefert nur diese aus). */
export const FIRMWARE_DATEIEN = ['bootloader.bin', 'partitions.bin', 'boot_app0.bin', 'firmware.bin']

/** Boards, die zum gemeldeten Chip passen (esptool-js `chip.CHIP_NAME`). */
export function boardsFuerChip(chipName, liste = ESP32_BOARDS) {
    return liste.filter((b) => b.chip === chipName)
}

const PARTITION_MAGIC = 0x50aa // 0xAA 0x50 little-endian
const PARTITION_MD5_MAGIC = 0xebeb

/**
 * Partitionstabelle lesen (Einträge zu 32 Byte ab Offset 0). Gibt `null` zurück,
 * wenn am Anfang keine Tabelle steht (leeres oder fremd beschriebenes Board).
 * @param {Uint8Array} bytes
 * @returns {{name: string, typ: number, untertyp: number, offset: number, groesse: number}[] | null}
 */
export function leseParitionstabelle(bytes) {
    const eintraege = []
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    for (let pos = 0; pos + 32 <= bytes.length; pos += 32) {
        const magic = dv.getUint16(pos, true)
        if (magic === PARTITION_MD5_MAGIC || magic === 0xffff) break
        if (magic !== PARTITION_MAGIC) return eintraege.length ? eintraege : null
        let name = ''
        for (let i = 0; i < 16; i++) {
            const c = bytes[pos + 12 + i]
            if (!c) break
            name += String.fromCharCode(c)
        }
        eintraege.push({
            name,
            typ: bytes[pos + 2],
            untertyp: bytes[pos + 3],
            offset: dv.getUint32(pos + 4, true),
            groesse: dv.getUint32(pos + 8, true),
        })
    }
    return eintraege.length ? eintraege : null
}

/** NVS-Partition (Typ data = 1, Untertyp nvs = 2) oder null. */
export function nvsBereich(tabelle) {
    const p = (tabelle || []).find((e) => e.typ === 1 && e.untertyp === 2)
    return p ? { offset: p.offset, groesse: p.groesse } : null
}

/**
 * Prüft die Schreibliste gegen den geschützten NVS-Bereich und die Flash-Grösse.
 * @param {{offset: number, groesse: number, datei?: string}[]} dateien
 * @param {{offset: number, groesse: number}[]} geschuetzt
 * @param {number} [flashBytes]
 * @returns {string[]} Fehler (leer = in Ordnung)
 */
export function pruefeSchreibbereiche(dateien, geschuetzt, flashBytes) {
    const fehler = []
    const sortiert = [...dateien].sort((a, b) => a.offset - b.offset)
    for (let i = 0; i < sortiert.length; i++) {
        const d = sortiert[i]
        const ende = d.offset + d.groesse
        for (const g of geschuetzt) {
            if (d.offset < g.offset + g.groesse && ende > g.offset) {
                fehler.push(`${d.datei || hex(d.offset)} überschneidet geschützten Bereich ${hex(g.offset)}–${hex(g.offset + g.groesse)}`)
            }
        }
        if (flashBytes && ende > flashBytes) fehler.push(`${d.datei || hex(d.offset)} reicht über das Flash-Ende (${hex(flashBytes)})`)
        const naechste = sortiert[i + 1]
        if (naechste && ende > naechste.offset) fehler.push(`${d.datei || hex(d.offset)} überschneidet ${naechste.datei || hex(naechste.offset)}`)
    }
    return fehler
}

export function hex(n) {
    return '0x' + Number(n).toString(16).padStart(4, '0')
}

/* ── MD5 (RFC 1321) ─────────────────────────────────────────── */

const MD5_S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21]
const MD5_K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0)

/** MD5 als Hex-Text. @param {Uint8Array} daten */
export function md5Hex(daten) {
    const laenge = daten.length
    const bloecke = ((laenge + 8) >>> 6) + 1
    const puffer = new Uint8Array(bloecke * 64)
    puffer.set(daten)
    puffer[laenge] = 0x80
    const dv = new DataView(puffer.buffer)
    dv.setUint32(puffer.length - 8, (laenge * 8) >>> 0, true)
    dv.setUint32(puffer.length - 4, Math.floor(laenge / 0x20000000), true)

    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476
    const m = new Uint32Array(16)
    for (let blk = 0; blk < bloecke; blk++) {
        for (let i = 0; i < 16; i++) m[i] = dv.getUint32(blk * 64 + i * 4, true)
        let a = a0, b = b0, c = c0, d = d0
        for (let i = 0; i < 64; i++) {
            const runde = i >>> 4
            let f, g
            if (runde === 0) { f = (b & c) | (~b & d); g = i }
            else if (runde === 1) { f = (d & b) | (~d & c); g = (5 * i + 1) & 15 }
            else if (runde === 2) { f = b ^ c ^ d; g = (3 * i + 5) & 15 }
            else { f = c ^ (b | ~d); g = (7 * i) & 15 }
            const summe = (a + f + MD5_K[i] + m[g]) >>> 0
            const s = MD5_S[runde * 4 + (i & 3)]
            a = d; d = c; c = b
            b = (b + ((summe << s) | (summe >>> (32 - s)))) >>> 0
        }
        a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0
    }
    let aus = ''
    for (const w of [a0, b0, c0, d0]) {
        for (let i = 0; i < 4; i++) aus += ((w >>> (8 * i)) & 0xff).toString(16).padStart(2, '0')
    }
    return aus
}

/* ── Einstellungen mitgeben (serielles CFG-Protokoll der Firmwares) ───────
 *
 * Nach dem Flash-Reset läuft die normale Firmware. Sie beantwortet `CFG?` mit
 * `[CFG] BEREIT <FW_VERSION>` und nimmt dann EINE Zeile
 * `CFG {"ssid","pass","host","port","key"}` (kompaktes JSON, ≤ 600 Byte)
 * an: `[CFG] OK` → speichert und startet neu, `[CFG] FEHLER json|felder|port`.
 * Andere Einstellungen der Anzeige bleiben, wie sie sind.
 * Optional `"invert": true|false` (nur CYD ab 3.8.2: Farbumkehr der Anzeige; die
 * anderen Firmwares ignorieren es) — fehlt es, bleibt die Einstellung des Boards.
 * `CFG SCAN` → das Board sucht WLANs (2–5 s) und antwortet mit EINER Zeile
 * `[CFG] NETZE [{"ssid","rssi","enc"}, …]` (stärkstes zuerst, enc 1 = Passwort).
 */

export const CFG_MAX_BYTES = 600
export const CFG_FRAGE = 'CFG?\n'
export const CFG_SCAN = 'CFG SCAN\n'
export const NETZE_MAX = 20

const utf8Laenge = (s) => new TextEncoder().encode(s).length

/**
 * Eingaben prüfen, bevor etwas gesendet wird. Gibt Fehlercodes zurück (leer = gut):
 * ssid | pass | host | hostLocal | port | key | laenge.
 */
export function cfgFehler(cfg) {
    const f = []
    const ssid = String(cfg?.ssid ?? '')
    const pass = String(cfg?.pass ?? '')
    const host = String(cfg?.host ?? '').trim()
    const port = String(cfg?.port ?? '').trim()
    const key = String(cfg?.key ?? '')
    if (!ssid || utf8Laenge(ssid) > 32) f.push('ssid')
    // WPA2 verlangt 8–63 Zeichen; leer = offenes Netz
    if (pass && (pass.length < 8 || utf8Laenge(pass) > 63)) f.push('pass')
    if (!host || /\s|\/|:\/\//.test(host) || host.length > 253) f.push('host')
    else if (/\.local\.?$/i.test(host)) f.push('hostLocal') // das Board löst kein mDNS auf
    if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) f.push('port')
    if (!key || /\s/.test(key) || key.length > 128) f.push('key')
    if (!f.length && utf8Laenge(cfgZeileRoh({ ssid, pass, host, port, key, invert: cfg?.invert })) > CFG_MAX_BYTES) f.push('laenge')
    return f
}

function cfgZeileRoh({ ssid, pass, host, port, key, invert }) {
    const daten = { ssid, pass, host, port: String(port), key }
    if (typeof invert === 'boolean') daten.invert = invert
    return 'CFG ' + JSON.stringify(daten)
}

/** Die zu sendende Zeile (mit \n). Wirft bei ungültigen Eingaben. */
export function cfgZeile(cfg) {
    const fehler = cfgFehler(cfg)
    if (fehler.length) throw new Error('CFG ungültig: ' + fehler.join(', '))
    return cfgZeileRoh({
        ssid: String(cfg.ssid),
        pass: String(cfg.pass ?? ''),
        host: String(cfg.host).trim(),
        port: String(cfg.port).trim(),
        key: String(cfg.key),
        invert: cfg.invert,
    }) + '\n'
}

/**
 * Netzliste des Boards säubern: nur gültige Einträge, je SSID der stärkste,
 * stärkstes zuerst, höchstens NETZE_MAX. Versteckte Netze (leere SSID) fallen weg —
 * dafür gibt es „Anderes Netz".
 */
export function bereinigeNetze(liste) {
    if (!Array.isArray(liste)) return null
    const je = new Map()
    for (const n of liste) {
        if (!n || typeof n.ssid !== 'string' || !n.ssid || utf8Laenge(n.ssid) > 32) continue
        const rssi = Number.isFinite(Number(n.rssi)) ? Math.round(Number(n.rssi)) : -100
        const netz = { ssid: n.ssid, rssi, enc: Number(n.enc) === 0 ? 0 : 1 }
        const alt = je.get(n.ssid)
        if (!alt || netz.rssi > alt.rssi) je.set(n.ssid, netz)
    }
    return [...je.values()].sort((a, b) => b.rssi - a.rssi).slice(0, NETZE_MAX)
}

/** Signalstärke als 1–4 Balken (RSSI in dBm). */
export function signalBalken(rssi) {
    const r = Number(rssi)
    if (r >= -55) return 4
    if (r >= -67) return 3
    if (r >= -78) return 2
    return 1
}

/**
 * Eine empfangene Zeile einordnen: {art:'bereit', version} | {art:'ok'} |
 * {art:'fehler', grund} | {art:'netze', netze} | null (Logausgabe, nicht gemeint).
 */
export function cfgAntwort(zeile) {
    const z = String(zeile).replace(/\r$/, '').trim()
    const netze = z.match(/^\[CFG\]\s+NETZE\s+(.*)$/)
    if (netze) {
        try {
            const liste = bereinigeNetze(JSON.parse(netze[1]))
            return liste ? { art: 'netze', netze: liste } : { art: 'fehler', grund: 'netze' }
        } catch {
            return { art: 'fehler', grund: 'netze' }
        }
    }
    let m = z.match(/^\[CFG\]\s+BEREIT(?:\s+(\S+))?\s*$/)
    if (m) return { art: 'bereit', version: m[1] || null }
    if (/^\[CFG\]\s+OK\s*$/.test(z)) return { art: 'ok' }
    m = z.match(/^\[CFG\]\s+FEHLER(?:\s+(\S+))?/)
    if (m) return { art: 'fehler', grund: m[1] || 'unbekannt' }
    return null
}

/** Zerlegt einen Zeichenstrom in Zeilen (\n oder \r\n); `teile(text)` gibt fertige Zeilen zurück. */
export function zeilenTeiler() {
    let rest = ''
    return function teile(text) {
        rest += text
        const zeilen = rest.split(/\r?\n/)
        rest = zeilen.pop()
        if (rest.length > 4096) rest = rest.slice(-4096) // Müll ohne Zeilenende nicht ewig sammeln
        return zeilen
    }
}

/** Server-Adresse vorschlagen: nur eine IPv4 aus der Adresszeile — ein Name (.local, DNS) hilft dem Board nicht sicher. */
export function hostVorschlag(ort) {
    const h = String(ort?.hostname || '')
    return /^(\d{1,3})(\.\d{1,3}){3}$/.test(h) && h.split('.').every((t) => Number(t) <= 255) && !h.startsWith('127.') ? h : ''
}

/** HTTP-Port der App vorschlagen: das Board spricht HTTP, also nicht 8443. */
export function httpPortVorschlag(ort) {
    if (ort?.protocol === 'http:') return String(ort.port || '80')
    return '8080'
}
