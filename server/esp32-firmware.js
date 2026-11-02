/**
 * Firmware der ESP32-Anzeigen für das Flashen aus dem Browser (Einstellungen ›
 * Geräte › „Board flashen"). Admin-Routen hinter der Sitzung:
 *
 *   GET /api/esp32/firmware               → { boards: [manifest …] }
 *   GET /api/esp32/firmware/:id/:datei    → die .bin-Datei
 *
 * Die Dateien legt `node scripts/esp32-firmware-bauen.mjs` nach firmware/esp32/<id>/
 * (im Docker-Image nur diese vorgebauten Dateien, PlatformIO gibt es dort nicht).
 * Ausgeliefert wird nur, was in einem Manifest steht und einen bekannten Namen
 * hat — kein Pfad aus der Anfrage erreicht das Dateisystem.
 */
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { ESP32_BOARDS, FIRMWARE_DATEIEN } from '../shared/esp32-flashen.js'

const STANDARD_ORDNER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'firmware', 'esp32')

/** Manifeste aller bekannten Boards, die abgelegt sind (fehlende werden ausgelassen). */
export async function ladeFirmwareListe(ordner = STANDARD_ORDNER) {
    const boards = []
    for (const b of ESP32_BOARDS) {
        try {
            const m = JSON.parse(await fs.readFile(path.join(ordner, b.id, 'manifest.json'), 'utf8'))
            if (m.id !== b.id || !Array.isArray(m.dateien)) continue
            const dateien = m.dateien.filter((d) => FIRMWARE_DATEIEN.includes(d.datei))
            boards.push({ ...m, chip: b.chip, name: b.name, dateien })
        } catch {
            // Board nicht gebaut — fehlt in der Liste.
        }
    }
    return boards
}

/** Pfad einer ausgelieferten Datei, oder null wenn id/Datei nicht erlaubt. */
export async function firmwareDateiPfad(id, datei, ordner = STANDARD_ORDNER) {
    if (!ESP32_BOARDS.some((b) => b.id === id) || !FIRMWARE_DATEIEN.includes(datei)) return null
    const liste = await ladeFirmwareListe(ordner)
    const board = liste.find((b) => b.id === id)
    if (!board?.dateien.some((d) => d.datei === datei)) return null
    return path.join(ordner, id, datei)
}

export function setupEsp32FirmwareRoutes(app, { ordner = STANDARD_ORDNER } = {}) {
    app.get('/api/esp32/firmware', async (req, res) => {
        try {
            res.set('Cache-Control', 'no-store')
            res.json({ boards: await ladeFirmwareListe(ordner) })
        } catch (e) {
            console.error('ESP32 firmware list error:', e)
            res.status(500).json({ error: 'Interner Serverfehler' })
        }
    })

    app.get('/api/esp32/firmware/:id/:datei', async (req, res) => {
        const pfad = await firmwareDateiPfad(req.params.id, req.params.datei, ordner)
        if (!pfad) return res.status(404).json({ error: 'Firmware nicht gefunden' })
        res.set('Cache-Control', 'no-store')
        res.type('application/octet-stream')
        res.sendFile(pfad, (e) => {
            if (e && !res.headersSent) res.status(404).json({ error: 'Firmware nicht gefunden' })
        })
    })
}
