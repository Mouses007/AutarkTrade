/**
 * Selbsttest: KI-Kennzeichnung der Share-Card (S12, EU AI Act Art. 50).
 *
 * Die Leinwand im Browser verwirft alle Metadaten der Quellbilder; die eigene
 * Kennzeichnung muss deshalb nach `toDataURL` in die PNG-Datei. Geprüft wird
 * hier der reine Teil: Blöcke an der richtigen Stelle, gültige Prüfsummen,
 * die Datei bleibt ein lesbares PNG mit unverändertem Bildinhalt.
 *
 * Aufruf: node src/utils/__selftest-sharecard-ki.mjs
 */
import { deflateSync, inflateSync, crc32 as zlibCrc } from 'node:zlib'
import { pngMitKiKennzeichnung, pngTexte, IPTC_KOMPOSIT, KI_BILD_LABEL } from './shareCardBild.js'

let ok = 0, fehler = 0
const check = (name, bed, zusatz = '') => {
    if (bed) { ok++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehler++; console.log(`  \x1b[31m✗\x1b[0m ${name}${zusatz ? `\n      ${zusatz}` : ''}`) }
}

// Ein 2×1-PNG, RGBA, von Hand gebaut — ohne Bildbibliothek.
function block(typ, daten) {
    const b = Buffer.alloc(12 + daten.length)
    b.writeUInt32BE(daten.length, 0)
    b.write(typ, 4, 'ascii')
    Buffer.from(daten).copy(b, 8)
    b.writeUInt32BE(zlibCrc(b.subarray(4, 8 + daten.length)) >>> 0, 8 + daten.length)
    return b
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 6
const roh = Buffer.from([0, 255, 0, 0, 255, 0, 0, 255, 255])
const png = new Uint8Array(Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    block('IHDR', ihdr), block('IDAT', deflateSync(roh)), block('IEND', Buffer.alloc(0)),
]))

const mit = pngMitKiKennzeichnung(png, { quelle: 'FLUX.2 (Black Forest Labs) flux-2-pro' })
const texte = pngTexte(mit)

console.log('\nShare-Card: PNG-Kennzeichnung')
check('AI-Generated = true', texte['AI-Generated'] === 'true')
check('Description trägt das Label', (texte.Description || '').includes('KI-generiert - keine Anlageberatung'), texte.Description)
check('Description nennt die Quelle', (texte.Description || '').includes('FLUX.2'))
check('IPTC-Begriff als Text', texte.DigitalSourceType === IPTC_KOMPOSIT && IPTC_KOMPOSIT.includes('TrainedAlgorithmicMedia'))
check('XMP mit Iptc4xmpExt:DigitalSourceType', (texte['XML:com.adobe.xmp'] || '').includes('<Iptc4xmpExt:DigitalSourceType>'))
check('XMP behält den Gedankenstrich (UTF-8)', (texte['XML:com.adobe.xmp'] || '').includes(KI_BILD_LABEL))

// Gültigkeit: jeder Block mit richtiger CRC, IHDR zuerst, IEND zuletzt, Bilddaten unverändert.
const dv = new DataView(mit.buffer, mit.byteOffset, mit.byteLength)
const typen = []
let crcOk = true
let idat = null
for (let pos = 8; pos < mit.length;) {
    const n = dv.getUint32(pos)
    const typ = String.fromCharCode(...mit.subarray(pos + 4, pos + 8))
    typen.push(typ)
    if ((zlibCrc(mit.subarray(pos + 4, pos + 8 + n)) >>> 0) !== dv.getUint32(pos + 8 + n)) crcOk = false
    if (typ === 'IDAT') idat = mit.subarray(pos + 8, pos + 8 + n)
    pos += 12 + n
}
check('alle Prüfsummen stimmen', crcOk)
check('IHDR bleibt der erste Block', typen[0] === 'IHDR', typen.join(','))
check('IEND bleibt der letzte Block', typen[typen.length - 1] === 'IEND')
check('Textblöcke stehen vor den Bilddaten', typen.indexOf('tEXt') < typen.indexOf('IDAT'))
check('Bildinhalt unverändert', idat && Buffer.compare(inflateSync(idat), roh) === 0)
check('Signatur unverändert', [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => mit[i] === b))

let geworfen = false
try { pngMitKiKennzeichnung(new Uint8Array([1, 2, 3])) } catch { geworfen = true }
check('Nicht-PNG wird abgelehnt statt still verdorben', geworfen)

console.log(`\n${ok} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler ? 1 : 0)
