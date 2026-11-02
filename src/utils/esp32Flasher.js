/**
 * ESP32-Anzeigen über Web Serial flashen (Einstellungen › Geräte › „Board flashen").
 *
 * Dünne Hülle um esptool-js (Espressif, Apache-2.0): verbinden, Chip erkennen,
 * Partitionstabelle des Boards lesen, die Firmware-Dateien an ihre Offsets
 * schreiben — nie Erase-All, damit der NVS-Bereich (WLAN, Server, Schlüssel)
 * stehen bleibt. Welche Dateien wohin, steht im Manifest vom Server; geprüft
 * wird mit `pruefeSchreibbereiche` aus shared/esp32-flashen.js.
 *
 * Fehler kommen als `FlasherFehler` mit `code` heraus, die Oberfläche übersetzt:
 * keinPort (Auswahl abgebrochen) | portBelegt | keineVerbindung (BOOT-Taste) |
 * abgebrochen | dateiFehler | schutz | unbekannt; beim Einrichten zusätzlich
 * portWeg (Board nach dem Reset nicht wieder gefunden) | cfgKeineAntwort
 * (Firmware kann CFG nicht oder hängt) | cfgAbgelehnt (`[CFG] FEHLER <grund>`).
 */
import { ESPLoader, Transport, ESPRESSIF_VID } from 'esptool-js'
import { leseParitionstabelle, nvsBereich, pruefeSchreibbereiche, md5Hex, CFG_FRAGE, CFG_SCAN, cfgZeile, cfgAntwort, zeilenTeiler } from '../../shared/esp32-flashen.js'

/** USB-Seriell-Wandler der Boards: Espressif (S3 nativ), WCH CH340/CH9102, Silabs CP210x, FTDI. */
export const USB_FILTER = [0x303a, 0x1a86, 0x10c4, 0x0403].map((usbVendorId) => ({ usbVendorId }))

/** Verbindungsanläufe, bevor die BOOT/RESET-Anleitung kommt. esptool-js selbst nimmt 7. */
export const VERBINDUNGS_ANLAEUFE = 15

const schlafe = (ms) => new Promise((r) => setTimeout(r, ms))

/*
 * Reset-Folgen in den Bootloader für Boards mit USB-Seriell-Wandler (CYD/CH340).
 * DTR zieht IO0, RTS zieht EN — über die übliche Zwei-Transistor-Schaltung:
 * EN tief nur bei (DTR aus, RTS an), IO0 tief nur bei (DTR an, RTS aus).
 * - getrennt: erst DTR, dann RTS einzeln setzen, wie esptool.py „Classic"
 * - zugleich: beide Leitungen je Aufruf, wie esptool.py unter Linux („Tight")
 * - ohne: gar nichts tun — für ein Board, das man von Hand per BOOT/RESET in den
 *   Download-Modus gebracht hat (ein Reset würde es dort wieder herausholen)
 *
 * Grenze des Browsers (02.11.2026, Chromium serial_io_handler_posix.cc): unter
 * Linux setzt Chromium die Leitungen NIE in einem Schritt — erst TIOCMBIS, dann
 * TIOCMBIC (mit kSerialSplitDtrAndRts sogar je Leitung). Dazwischen liegt am CH340
 * ein eigener USB-Steuerbefehl, also ~1 ms, in der EN schon frei und IO0 noch hoch
 * ist. Ein Board ohne Kondensator an EN — das CYD — startet dann aus dem Flash
 * (boot:0x13, gemessen mit der getrennten Folge); esptool.py schafft es nur, weil
 * es mit TIOCMSET beide auf einmal setzt. Mit gedrückter BOOT-Taste ist IO0 beim
 * Reset trotzdem tief: dafür die Anleitung in der Oberfläche. Andere Boards (mit
 * EN-Kondensator) kommen mit den Folgen automatisch in den Bootloader.
 */
export const RESET_FOLGEN = [
    // „ohne" ZUERST: ein Board, das schon von Hand im Download-Modus steht, würde
    // jeder Reset wieder hinauswerfen.
    { name: 'ohne Reset', art: 'ohne', ms: 0 },
    { name: 'zugleich 50 ms', art: 'zugleich', ms: 50 },
    { name: 'zugleich 550 ms', art: 'zugleich', ms: 550 },
    { name: 'getrennt 50 ms', art: 'getrennt', ms: 50 },
    { name: 'zugleich 250/100 ms', art: 'zugleich', ms: 100, haltMs: 250 },
    { name: 'getrennt 550 ms', art: 'getrennt', ms: 550 },
    { name: 'zugleich 1000 ms', art: 'zugleich', ms: 1000 },
]

/** Hat der gewählte Port einen USB-Seriell-Wandler (CYD) statt nativem USB (S3)? */
export function istUsbWandler(port) {
    const v = port?.getInfo?.().usbVendorId
    return v !== undefined && v !== ESPRESSIF_VID
}

/** Eine Reset-Folge auf einem esptool-js-Transport ausführen. */
export async function fuehreResetAus(transport, folge) {
    if (folge.art === 'ohne') return
    const halt = folge.haltMs ?? 100
    if (folge.art === 'getrennt') {
        await transport.setDTR(false) // IO0 frei
        await transport.setRTS(true)  // EN tief → Reset
        await schlafe(halt)
        await transport.setDTR(true)  // IO0 tief
        await transport.setRTS(false) // EN frei → startet in den Bootloader
        await schlafe(folge.ms)
        await transport.setDTR(false) // IO0 wieder frei
        return
    }
    await transport.setSignals(false, false)
    await transport.setSignals(true, true)
    await transport.setSignals(false, true) // Reset
    await schlafe(halt)
    await transport.setSignals(true, false) // IO0 tief, EN frei
    await schlafe(folge.ms)
    await transport.setSignals(false, false)
    await transport.setDTR(false)
}

/**
 * Für esptool-js `resetConstructors.classicReset`: jedes reset() nimmt die
 * nächste Folge aus RESET_FOLGEN, egal welche Wartezeit esptool-js vorgibt.
 */
export function wechselndeResets(log = () => {}) {
    let n = 0
    return (transport) => ({
        async reset() {
            const folge = RESET_FOLGEN[n % RESET_FOLGEN.length]
            n++
            log(`Verbindungsanlauf ${n}: ${folge.name}`)
            await fuehreResetAus(transport, folge)
        },
    })
}

export class FlasherFehler extends Error {
    constructor(code, nachricht, ursache) {
        super(nachricht || code)
        this.code = code
        this.ursache = ursache
    }
}

/** Was der Browser kann: 'ok' | 'keinSerial' | 'unsicher'. */
export function browserTauglich(fenster = globalThis) {
    if (!fenster.isSecureContext) return 'unsicher'
    if (!fenster.navigator?.serial) return 'keinSerial'
    return 'ok'
}

/** Fehler aus Web Serial / esptool-js einer Klasse zuordnen. */
export function ordneFehler(e, abgebrochen = false) {
    if (e instanceof FlasherFehler) return e
    const text = String(e?.message || e || '')
    if (abgebrochen) return new FlasherFehler('abgebrochen', text, e)
    if (e?.name === 'NotFoundError' || /no port selected/i.test(text)) return new FlasherFehler('keinPort', text, e)
    if (e?.name === 'InvalidStateError' || e?.name === 'NetworkError' || /failed to open|already open|access denied/i.test(text)) {
        return new FlasherFehler('portBelegt', text, e)
    }
    if (/failed to connect|timeout|timed out|wrong boot mode|invalid head of packet/i.test(text)) return new FlasherFehler('keineVerbindung', text, e)
    if (/device has been lost|device lost|disconnected|the port is closed|readable stream/i.test(text)) return new FlasherFehler('getrennt', text, e)
    return new FlasherFehler('unbekannt', text, e)
}

async function sha256Hex(daten) {
    const h = await crypto.subtle.digest('SHA-256', daten)
    return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Firmware-Dateien eines Manifests holen und gegen SHA-256 prüfen. */
export async function ladeFirmwareDateien(manifest, holen = (url) => fetch(url, { credentials: 'same-origin' })) {
    const dateien = []
    for (const d of manifest.dateien) {
        const antwort = await holen(`/api/esp32/firmware/${encodeURIComponent(manifest.id)}/${encodeURIComponent(d.datei)}`)
        if (!antwort.ok) throw new FlasherFehler('dateiFehler', `${d.datei}: HTTP ${antwort.status}`)
        const daten = new Uint8Array(await antwort.arrayBuffer())
        if (daten.length !== d.groesse || (await sha256Hex(daten)) !== d.sha256) {
            throw new FlasherFehler('dateiFehler', `${d.datei}: Prüfsumme stimmt nicht`)
        }
        dateien.push({ ...d, daten })
    }
    return dateien
}

export class Esp32Flasher {
    /** @param {{ log?: (zeile: string) => void }} [optionen] */
    constructor({ log = () => {} } = {}) {
        this.log = log
        this.port = null
        this.transport = null
        this.loader = null
        this.abgebrochen = false
    }

    /** Port wählen lassen (muss aus einem Klick heraus aufgerufen werden). */
    async waehlePort() {
        try {
            this.port = await navigator.serial.requestPort({ filters: USB_FILTER })
        } catch (e) {
            throw ordneFehler(e)
        }
        return this.port
    }

    /**
     * Mit dem ROM-Bootloader verbinden (Auto-Reset über DTR/RTS bzw. USB-JTAG),
     * Stub laden, Chip und Flash erkennen.
     */
    async verbinden() {
        if (!this.port) throw new FlasherFehler('keinPort')
        this.abgebrochen = false
        const terminal = {
            clean: () => {},
            writeLine: (z) => this.log(String(z)),
            write: (z) => this.log(String(z)),
        }
        // Natives USB (S3): die Baudrate ist nur ein Wert, ein Wechsel öffnet den
        // Port neu und kann das Board dabei zurücksetzen — also gleich lassen.
        const nativ = this.port.getInfo?.().usbVendorId === ESPRESSIF_VID
        this.nativ = nativ
        try {
            this.transport = new Transport(this.port, false)
            this.loader = new ESPLoader({
                transport: this.transport,
                baudrate: nativ ? 115200 : 460800,
                romBaudrate: 115200,
                terminal,
                // Nur für USB-Seriell-Wandler; der S3 mit nativem USB nimmt die USB-JTAG-Folge.
                resetConstructors: { classicReset: wechselndeResets(this.log) },
            })
            const beschreibung = await this.verbindeUndStarteStub()
            const chip = this.loader.chip.CHIP_NAME
            let mac = null
            try { mac = await this.loader.chip.readMac(this.loader) } catch { /* nur Anzeige */ }
            let flashGroesse = null
            try { flashGroesse = (await this.loader.detectFlashSize()) || null } catch { /* nur Anzeige */ }
            return { chip, beschreibung, mac, flashGroesse }
        } catch (e) {
            const fehler = ordneFehler(e, this.abgebrochen)
            await this.trennen({ neustart: false })
            throw fehler
        }
    }

    /**
     * Wie `ESPLoader.main()`, aber mit VERBINDUNGS_ANLAEUFE statt der festen 7:
     * Chip erkennen, Stub laden, Baudrate erhöhen, Flash-Verbindung prüfen.
     */
    async verbindeUndStarteStub() {
        const l = this.loader
        await l.detectChip('default_reset', VERBINDUNGS_ANLAEUFE)
        let beschreibung = l.chip.CHIP_NAME
        if (!l.secureDownloadMode) {
            beschreibung = await l.chip.getChipDescription(l)
            this.log('Chip: ' + beschreibung)
            if (typeof l.chip.postConnect === 'function') await l.chip.postConnect(l)
        }
        await l.runStub()
        if (l.romBaudrate !== l.baudrate) await l.changeBaud()
        if (!l.secureDownloadMode) {
            const id = await l.readFlashId()
            if (id === 0xffffff || id === 0) this.log('Warnung: Flash-Chip antwortet nicht (ID ' + id.toString(16) + ')')
        }
        return beschreibung
    }

    /** Partitionstabelle des Boards (0x8000) lesen — null, wenn dort keine steht. */
    async lesePartitionen() {
        try {
            const bytes = await this.loader.readFlash(0x8000, 0xc00)
            return leseParitionstabelle(bytes)
        } catch (e) {
            throw ordneFehler(e, this.abgebrochen)
        }
    }

    /**
     * Dateien schreiben. Prüft vorher noch einmal gegen den geschützten Bereich.
     * @param {{datei: string, offset: number, groesse: number, daten: Uint8Array}[]} dateien
     * @param {{modus: string, frequenz: string, groesse: string}} flash
     * @param {{offset: number, groesse: number}[]} geschuetzt
     * @param {(geschrieben: number, gesamt: number) => void} fortschritt
     */
    async flashen(dateien, flash, geschuetzt, fortschritt = () => {}) {
        const fehler = pruefeSchreibbereiche(dateien, geschuetzt)
        if (fehler.length) throw new FlasherFehler('schutz', fehler.join('; '))
        const gesamt = dateien.reduce((s, d) => s + d.daten.length, 0)
        const vorher = dateien.map((_, i) => dateien.slice(0, i).reduce((s, d) => s + d.daten.length, 0))
        try {
            await this.loader.writeFlash({
                fileArray: dateien.map((d) => ({ data: d.daten, address: d.offset })),
                flashMode: flash?.modus || 'keep',
                flashFreq: flash?.frequenz || 'keep',
                flashSize: flash?.groesse || 'keep',
                eraseAll: false,
                compress: true,
                // esptool-js zählt die KOMPRIMIERTEN Bytes der Datei — als Anteil umrechnen.
                reportProgress: (i, geschrieben, von) => {
                    const anteil = von ? Math.min(1, geschrieben / von) : 0
                    fortschritt(Math.round(vorher[i] + anteil * dateien[i].daten.length), gesamt)
                },
                calculateMD5Hash: (bild) => md5Hex(bild),
            })
            fortschritt(gesamt, gesamt)
        } catch (e) {
            throw ordneFehler(e, this.abgebrochen)
        }
    }

    /**
     * Neustart in die neue Firmware (optional) und Port freigeben — in JEDEM Fall.
     * `Transport.disconnect()` wartet ohne Frist, bis die Ströme frei sind; hängt
     * es, bliebe der Port offen und der Browser hielte das Board fest, bis der Tab
     * zu ist (02.11.2026 am Waveshare-Touch passiert). Darum mit Frist und danach
     * selbst schliessen.
     */
    async trennen({ neustart = true } = {}) {
        try {
            if (neustart && this.loader) await mitFrist(this.neustart(), 3000)
        } catch { /* Board ist evtl. schon weg */ }
        await this.portFreigeben()
        this.loader = null
        this.transport = null
    }

    /**
     * In die Firmware starten. esptool-js' HardReset setzt nur RTS auf aus und
     * nimmt an, es sei vorher an gewesen — am CYD (CH340) blieb das Board so im
     * Bootloader (02.11.2026), ebenso der S3 mit nativem USB (RTS war schon aus,
     * also kein Reset; das Board blieb stumm im Loader). Darum für beide selbst:
     * RTS an bei DTR aus (Reset, IO0 frei), dann RTS aus → startet aus dem Flash.
     */
    async neustart() {
        await this.transport.setSignals(false, true) // DTR aus (IO0 frei), RTS an (EN tief)
        await schlafe(100)
        await this.transport.setSignals(false, false) // EN frei → startet aus dem Flash
    }

    async portFreigeben() {
        const transport = this.transport
        try {
            if (transport) await mitFrist(transport.disconnect(), 2500)
        } catch { /* hängt oder schon zu */ }
        if (this.port && (this.port.readable || this.port.writable)) {
            await schliessePortSicher(this.port, { reader: transport?.reader })
        }
    }

    /** Laufenden Vorgang abbrechen: den Port schliessen, esptool-js wirft dann. */
    async abbrechen() {
        this.abgebrochen = true
        await this.portFreigeben()
    }
}

const warte = (ms) => new Promise((r) => setTimeout(r, ms))

/** Promise mit Frist: wirft nach `ms`, statt ewig zu warten. */
function mitFrist(versprechen, ms) {
    let uhr
    return Promise.race([
        Promise.resolve(versprechen).finally(() => clearTimeout(uhr)),
        new Promise((_, nein) => { uhr = setTimeout(() => nein(new Error('Frist abgelaufen')), ms) }),
    ])
}

/**
 * Port schliessen, auch wenn Leser/Schreiber hängen: Leser abbrechen und lösen,
 * Schreiber abbrechen und lösen, dann `close()` — jeweils mit Frist, close()
 * mehrmals. Gibt true zurück, wenn der Port danach zu ist.
 */
export async function schliessePortSicher(port, { reader, writer } = {}) {
    if (!port) return true
    try { if (reader) await mitFrist(reader.cancel(), 1000) } catch { /* hängt */ }
    try { reader?.releaseLock() } catch { /* schon frei */ }
    try { if (writer) await mitFrist(writer.abort(), 1000) } catch { /* hängt */ }
    try { writer?.releaseLock() } catch { /* schon frei */ }
    for (let i = 0; i < 3; i++) {
        if (!port.readable && !port.writable) return true
        try { await mitFrist(port.close(), 1500) } catch { /* noch gesperrt */ }
        if (!port.readable && !port.writable) return true
        await warte(200)
    }
    return !port.readable && !port.writable
}

/**
 * Den Port nach dem Flash-Reset wieder öffnen. Ein USB-Seriell-Wandler (CYD)
 * bleibt derselbe Port; der S3 mit nativem USB meldet sich neu an und ist dann
 * ein NEUES Objekt in `getPorts()` (die Erlaubnis bleibt). Es wird probiert, bis
 * sich ein Port mit derselben USB-Kennung öffnen lässt.
 */
export async function oeffneWieder(alterPort, { serial = globalThis.navigator?.serial, wartenMs = 15000, pauseMs = 1500, log = () => {} } = {}) {
    const info = alterPort?.getInfo?.() || {}
    const passt = (p) => {
        const i = p.getInfo?.() || {}
        return i.usbVendorId === info.usbVendorId && i.usbProductId === info.usbProductId
    }
    // Gleich nach dem Reset ist beim S3 noch das ALTE USB-Gerät da und lässt sich
    // öffnen — Sekundenbruchteile später meldet es sich ab und neu an (am Board
    // gemessen 02.11.2026). Erst warten, dann suchen.
    await warte(pauseMs)
    const bis = Date.now() + wartenMs
    let letzterFehler = null
    while (Date.now() < bis) {
        const kandidaten = [alterPort, ...((await serial?.getPorts?.()) || []).filter((p) => p !== alterPort && passt(p))].filter(Boolean)
        for (const p of kandidaten) {
            try {
                await p.open({ baudRate: 115200 })
                return p
            } catch (e) {
                letzterFehler = e
            }
        }
        await warte(500)
    }
    log('Port nach dem Neustart nicht wieder gefunden: ' + (letzterFehler?.message || '—'))
    throw new FlasherFehler('portWeg', letzterFehler?.message || 'Port nicht wieder gefunden', letzterFehler)
}

/**
 * Offene CFG-Verbindung zur laufenden Firmware: `warteBereit()` (CFG? bis
 * BEREIT), `suche()` (CFG SCAN → Netzliste), `sende(cfg)` (CFG-Zeile → OK),
 * `schliessen()` — schliesst den Port in JEDEM Fall. Bleibt offen, während der
 * Nutzer das Netz wählt; die Firmware wartet so lange in ihrer normalen Schleife.
 * Fehler: getrennt (Gerät weg / Schreiben hängt) | cfgKeineAntwort | cfgAbgelehnt.
 */
export class CfgVerbindung {
    constructor(port, { log = () => {}, schreibMs = 3000 } = {}) {
        this.port = port
        this.log = log
        this.schreibMs = schreibMs
        this.reader = port.readable.getReader()
        this.writer = port.writable.getWriter()
        this.encoder = new TextEncoder()
        this.warteAuf = null
        this.zu = false
        this.geschlossen = false
        const teile = zeilenTeiler()
        const decoder = new TextDecoder()
        this.lesen = (async () => {
            try {
                for (;;) {
                    const { value, done } = await this.reader.read()
                    if (done) break
                    for (const z of teile(decoder.decode(value, { stream: true }))) {
                        if (!z.trim()) continue
                        const a = cfgAntwort(z)
                        // Die Netzliste ist lang — im Protokoll nur die Zahl
                        log('[Board] ' + (a?.art === 'netze' ? `[CFG] NETZE (${a.netze.length})` : z.trim()))
                        if (a && this.warteAuf?.arten.includes(a.art)) { const w = this.warteAuf; this.warteAuf = null; w.aufgeloest(a) }
                    }
                }
            } catch { /* Port geschlossen oder Gerät weg */ }
            this.zu = true
            if (this.warteAuf) { const w = this.warteAuf; this.warteAuf = null; w.aufgeloest(null) }
        })()
    }

    warteAufAntwort(arten, ms) {
        return new Promise((aufgeloest) => {
            if (this.zu) return aufgeloest(null)
            this.warteAuf = { arten, aufgeloest }
            setTimeout(() => { if (this.warteAuf?.aufgeloest === aufgeloest) { this.warteAuf = null; aufgeloest(null) } }, ms)
        })
    }

    // Ein Gerät, das sich gerade abmeldet, nimmt Schreibvorgänge manchmal nie an.
    async schreibe(text) {
        if (this.zu) throw new FlasherFehler('getrennt', 'Verbindung zum Board abgerissen')
        try {
            await mitFrist(this.writer.write(this.encoder.encode(text)), this.schreibMs)
        } catch (e) {
            throw new FlasherFehler('getrennt', e?.message === 'Frist abgelaufen' ? 'Schreiben hängt' : e?.message, e)
        }
    }

    /** CFG? wiederholen, bis BEREIT kommt (nach dem Start bis ~15 s im WLAN-Versuch). */
    async warteBereit({ bereitMs = 30000, frageAlleMs = 2000, signal } = {}) {
        const bis = Date.now() + bereitMs
        let bereit = null
        while (!bereit && Date.now() < bis && !this.zu) {
            if (signal?.aborted) throw new FlasherFehler('abgebrochen')
            const antwort = this.warteAufAntwort(['bereit'], frageAlleMs)
            await this.schreibe(CFG_FRAGE)
            bereit = await antwort
        }
        if (!bereit && this.zu) throw new FlasherFehler('getrennt', 'Verbindung zum Board abgerissen')
        if (!bereit) throw new FlasherFehler('cfgKeineAntwort', 'Keine Antwort auf CFG?')
        this.version = bereit.version
        this.log(`Firmware ${bereit.version || '?'} bereit`)
        return { version: bereit.version }
    }

    /** WLANs suchen lassen (2–5 s). Gibt die bereinigte Liste zurück. */
    async suche({ ms = 15000 } = {}) {
        const antwort = this.warteAufAntwort(['netze', 'fehler'], ms)
        await this.schreibe(CFG_SCAN)
        const a = await antwort
        if (!a && this.zu) throw new FlasherFehler('getrennt', 'Verbindung beim Suchen abgerissen')
        if (!a) throw new FlasherFehler('cfgKeineAntwort', 'Keine Antwort auf CFG SCAN')
        if (a.art === 'fehler') throw new FlasherFehler('cfgAbgelehnt', a.grund)
        return a.netze
    }

    /** Die eine CFG-Zeile senden. `cfg` wird nur in die Zeile übersetzt, nicht aufbewahrt. */
    async sende(cfg, { antwortMs = 6000 } = {}) {
        let zeile = cfgZeile(cfg) // wirft bei ungültigen Eingaben, bevor etwas gesendet wird
        try {
            const antwort = this.warteAufAntwort(['ok', 'fehler'], antwortMs)
            await this.schreibe(zeile)
            const a = await antwort
            if (!a && this.zu) throw new FlasherFehler('getrennt', 'Verbindung nach dem Senden abgerissen')
            if (!a) throw new FlasherFehler('cfgKeineAntwort', 'Keine Antwort auf CFG')
            if (a.art === 'fehler') throw new FlasherFehler('cfgAbgelehnt', a.grund)
            return true
        } finally {
            zeile = null
        }
    }

    /** Port in jedem Fall schliessen (auch bei hängendem Leser/Schreiber). */
    async schliessen() {
        if (this.geschlossen) return
        this.geschlossen = true
        await schliessePortSicher(this.port, { reader: this.reader, writer: this.writer })
        await Promise.race([this.lesen, warte(1000)])
    }
}

/** Kurzform ohne Netzauswahl: bereit → senden → schliessen. */
export async function sendeEinstellungen(port, cfg, { log = () => {}, bereitMs = 30000, antwortMs = 6000, frageAlleMs = 2000, schreibMs = 3000, signal } = {}) {
    cfgZeile(cfg) // ungültige Eingaben: nichts senden
    const v = new CfgVerbindung(port, { log, schreibMs })
    try {
        const { version } = await v.warteBereit({ bereitMs, frageAlleMs, signal })
        await v.sende(cfg, { antwortMs })
        return { version }
    } finally {
        await v.schliessen()
    }
}

/** Wie steht die NVS-Partition des Boards zur neuen Firmware? 'gleich' | 'leer' | 'anders'. */
export function vergleicheNvs(boardTabelle, manifest) {
    if (!boardTabelle) return 'leer'
    const alt = nvsBereich(boardTabelle)
    if (!alt) return 'leer'
    return alt.offset === manifest.nvs?.offset && alt.groesse === manifest.nvs?.groesse ? 'gleich' : 'anders'
}
