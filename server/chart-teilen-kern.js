/**
 * Chart teilen per Mail — der reine Teil: Eingaben des Teilen-Dialogs prüfen.
 *
 * Das Bild baut der Browser (Chart-Bild oder ein eingefügtes Bildschirmfoto);
 * hier wird nur geprüft, ob es ein PNG/JPEG in vernünftiger Grösse ist und ob
 * die Adressen gültig sind. Der Versand selbst läuft über den SMTP-Zugang der
 * Benachrichtigungen (`sendeBildMail`).
 */
import { empfaengerPruefung } from '../shared/empfaenger.js'

/** Grösste Bildlänge als Base64 (≈ 6 MB Datei) — ein 2560-px-PNG eines Charts liegt bei 1–3 MB. */
export const BILD_MAX_ZEICHEN = 8_000_000
export const MAX_EMPFAENGER = 5
const TYPEN = { 'image/png': 'png', 'image/jpeg': 'jpg' }
// PNG beginnt mit 89 50 4E 47, JPEG mit FF D8 FF — der Typ muss zum Inhalt passen
const SIGNATUR = { 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/jpeg': [0xff, 0xd8, 0xff] }

/** Kopf- und Betreffzeile säubern: keine Zeilenumbrüche (Header-Injektion), Länge begrenzt. */
const zeile = (x, max) => String(x ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max)

/**
 * @returns {{fehler: string} | {an: string[], betreff: string, text: string, bild: Buffer, dateiname: string, mediaType: string}}
 */
export function pruefeTeilenMail(roh) {
    if (!roh || typeof roh !== 'object') return { fehler: 'eingabe' }
    const { gueltig, verworfen } = empfaengerPruefung(roh.an, { max: MAX_EMPFAENGER })
    if (verworfen.length) return { fehler: 'adresse', verworfen }
    if (!gueltig.length) return { fehler: 'keinEmpfaenger' }
    const mediaType = String(roh.bild?.mediaType || '')
    const base64 = typeof roh.bild?.base64 === 'string' ? roh.bild.base64 : ''
    if (!TYPEN[mediaType]) return { fehler: 'bildTyp' }
    if (base64.length < 100) return { fehler: 'bildLeer' }
    if (base64.length > BILD_MAX_ZEICHEN) return { fehler: 'bildZuGross' }
    if (!/^[A-Za-z0-9+/]+=*$/.test(base64)) return { fehler: 'bildKaputt' }
    const bild = Buffer.from(base64, 'base64')
    if (!SIGNATUR[mediaType].every((b, i) => bild[i] === b)) return { fehler: 'bildKaputt' }
    const betreff = zeile(roh.betreff, 150) || 'Chart aus AutarkTrade'
    const text = String(roh.text ?? '').slice(0, 2000)
    const name = zeile(roh.dateiname, 80).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/\.(png|jpe?g)$/i, '').replace(/^[._-]+/, '') || 'chart'
    return { an: gueltig, betreff, text, bild, dateiname: `${name}.${TYPEN[mediaType]}`, mediaType }
}
