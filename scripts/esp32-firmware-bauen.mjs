#!/usr/bin/env node
/**
 * Firmware der ESP32-Anzeigen bauen und für das Flashen aus der Web-App ablegen.
 *
 *   node scripts/esp32-firmware-bauen.mjs                 # alle drei Boards bauen + ablegen
 *   node scripts/esp32-firmware-bauen.mjs cyd             # nur ein Board (id aus shared/esp32-flashen.js)
 *   node scripts/esp32-firmware-bauen.mjs --ohne-bauen    # vorhandene .pio-Builds nur ablegen
 *
 * Braucht PlatformIO (`pio`). Die Offsets kommen aus `pio project metadata`
 * (flash_images + application_offset) — genau das, was `pio run -t upload` an
 * esptool gibt. Abgelegt wird nach firmware/esp32/<id>/: bootloader.bin,
 * partitions.bin, boot_app0.bin, firmware.bin und manifest.json (Version aus
 * FW_VERSION in src/main.cpp, Offsets, Grössen, SHA-256, NVS-Bereich aus der
 * gebauten Partitionstabelle). Das Docker-Image hat kein PlatformIO und nimmt
 * diese vorgebauten Dateien, deshalb gehören sie ins Repo.
 *
 * Bricht ab, wenn eine Datei den NVS-Bereich berührt: das Flashen aus der App
 * soll WLAN, Server und Schlüssel auf dem Board stehen lassen.
 */
import { execFileSync } from 'child_process'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { ESP32_BOARDS, leseParitionstabelle, nvsBereich, pruefeSchreibbereiche, hex } from '../shared/esp32-flashen.js'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ZIEL = path.join(WURZEL, 'firmware', 'esp32')

const args = process.argv.slice(2)
const ohneBauen = args.includes('--ohne-bauen')
const nurIds = args.filter((a) => !a.startsWith('--'))
const unbekannt = nurIds.filter((id) => !ESP32_BOARDS.some((b) => b.id === id))
if (unbekannt.length) {
    console.error(`Unbekanntes Board: ${unbekannt.join(', ')} — bekannt: ${ESP32_BOARDS.map((b) => b.id).join(', ')}`)
    process.exit(1)
}
const boards = nurIds.length ? ESP32_BOARDS.filter((b) => nurIds.includes(b.id)) : ESP32_BOARDS

function pio(argumente, cwd) {
    return execFileSync('pio', argumente, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024 })
}

function gitStand() {
    try {
        const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: WURZEL, encoding: 'utf8' }).trim()
        return commit
    } catch {
        return null
    }
}

function ordnerGeaendert(ordner) {
    try {
        return execFileSync('git', ['status', '--porcelain', '--', ordner], { cwd: WURZEL, encoding: 'utf8' }).trim() !== ''
    } catch {
        return null
    }
}

function leseVersion(projekt) {
    const quelle = fs.readFileSync(path.join(projekt, 'src', 'main.cpp'), 'utf8')
    const m = quelle.match(/#define\s+FW_VERSION\s+"([^"]+)"/)
    return m ? m[1] : null
}

/**
 * Flash-Parameter wie `pio run -t upload` sie an esptool gibt (espressif32
 * builder/main.py): Modus qio/qout → dio, OPI-Speicher → dout, Frequenz aus
 * f_flash, Grösse aus upload.flash_size. Das Flashen aus der App schreibt
 * denselben Bootloader-Kopf.
 */
function flashParameter(projekt, env) {
    const konfig = JSON.parse(pio(['project', 'config', '--json-output'], projekt))
    const eintrag = Object.fromEntries(konfig.find(([name]) => name === `env:${env}`)?.[1] || [])
    const kern = process.env.PLATFORMIO_CORE_DIR || path.join(process.env.HOME || '', '.platformio')
    const boardDatei = path.join(kern, 'platforms', eintrag.platform, 'boards', `${eintrag.board}.json`)
    const b = JSON.parse(fs.readFileSync(boardDatei, 'utf8'))
    const speicher = b.build?.memory_type || b.build?.arduino?.memory_type || `${b.build?.flash_mode || 'dio'}_${b.build?.psram_type || 'qspi'}`
    let modus = b.build?.flash_mode || 'dio'
    if (['opi_opi', 'opi_qspi'].includes(speicher)) modus = 'dout'
    else if (['qio', 'qout'].includes(modus)) modus = 'dio'
    const frequenz = Math.round(parseInt(String(b.build?.f_flash || '40000000').replace('L', ''), 10) / 1e6) + 'm'
    return { modus, frequenz, groesse: b.upload?.flash_size || '4MB' }
}

const sha256 = (daten) => crypto.createHash('sha256').update(daten).digest('hex')

let fehlerGesamt = 0
for (const board of boards) {
    const projekt = path.join(WURZEL, board.ordner)
    console.log(`\n== ${board.name} (${board.ordner}, env ${board.env})`)
    if (!ohneBauen) {
        try {
            pio(['run', '-e', board.env], projekt)
        } catch {
            console.error(`  Build fehlgeschlagen (pio run -e ${board.env} in ${board.ordner}) — Board nicht abgelegt.`)
            fehlerGesamt++
            continue
        }
    }

    const meta = JSON.parse(pio(['project', 'metadata', '-e', board.env, '--json-output'], projekt))[board.env]
    const bilder = meta?.extra?.flash_images || []
    const appOffset = parseInt(meta?.extra?.application_offset || '0x10000', 16)
    const bauOrdner = path.dirname(meta.prog_path)

    const quellen = [
        ...bilder.map((b) => ({ von: b.path, offset: parseInt(b.offset, 16) })),
        { von: path.join(bauOrdner, 'firmware.bin'), offset: appOffset },
    ]
    const dateien = quellen.map(({ von, offset }) => {
        const datei = path.basename(von)
        const daten = fs.readFileSync(von)
        return { datei, offset, groesse: daten.length, sha256: sha256(daten), daten }
    })
    const namen = dateien.map((d) => d.datei).sort().join(',')
    if (namen !== 'boot_app0.bin,bootloader.bin,firmware.bin,partitions.bin') {
        console.error(`  Unerwartete Dateien: ${namen}`)
        fehlerGesamt++
        continue
    }

    const tabelle = leseParitionstabelle(new Uint8Array(dateien.find((d) => d.datei === 'partitions.bin').daten))
    const nvs = nvsBereich(tabelle)
    if (!nvs) {
        console.error('  Keine NVS-Partition in partitions.bin — Abbruch.')
        fehlerGesamt++
        continue
    }
    const app = tabelle.find((e) => e.typ === 0 && e.offset === appOffset)
    const fehler = pruefeSchreibbereiche(dateien, [nvs])
    if (app && dateien.find((d) => d.datei === 'firmware.bin').groesse > app.groesse) fehler.push('firmware.bin ist grösser als die App-Partition')
    if (fehler.length) {
        for (const f of fehler) console.error('  ' + f)
        fehlerGesamt++
        continue
    }

    const ziel = path.join(ZIEL, board.id)
    fs.mkdirSync(ziel, { recursive: true })
    for (const d of dateien) fs.writeFileSync(path.join(ziel, d.datei), d.daten)
    const manifest = {
        id: board.id,
        name: board.name,
        chip: board.chip,
        ordner: board.ordner,
        version: leseVersion(projekt),
        gebaut: new Date().toISOString(),
        commit: gitStand(),
        ungespeicherteAenderungen: ordnerGeaendert(board.ordner),
        flash: flashParameter(projekt, board.env),
        nvs,
        partitionen: tabelle.map(({ name, typ, untertyp, offset, groesse }) => ({ name, typ, untertyp, offset, groesse })),
        dateien: dateien.map(({ datei, offset, groesse, sha256 }) => ({ datei, offset, groesse, sha256 })),
    }
    fs.writeFileSync(path.join(ziel, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
    console.log(`  Version ${manifest.version}, Flash ${manifest.flash.modus}/${manifest.flash.frequenz}/${manifest.flash.groesse}, NVS ${hex(nvs.offset)}+${hex(nvs.groesse)} bleibt unberührt`)
    for (const d of dateien) console.log(`  ${hex(d.offset).padEnd(8)} ${d.datei.padEnd(15)} ${d.groesse} B`)
}

if (fehlerGesamt) {
    console.error(`\n${fehlerGesamt} Board(s) nicht abgelegt.`)
    process.exit(1)
}
console.log(`\nAbgelegt in ${path.relative(WURZEL, ZIEL)}/`)
