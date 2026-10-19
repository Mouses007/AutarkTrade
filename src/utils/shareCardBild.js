/**
 * Share-Card im Browser zusammensetzen (S10: ersetzt `sharp` auf dem Server).
 *
 * Der Server (`server/flux-api.js`) liefert `hintergrund` (Daten-URL des KI-Bilds oder
 * der Vorlage, beliebige Grösse) und `overlay` (SVG mit Texten und Logo, 1080×1080).
 * Hier wird der Hintergrund wie früher `sharp.resize(1080, 1080)` auf das Quadrat
 * GEFÜLLT und mittig beschnitten („cover"), darüber das SVG, heraus kommt ein PNG.
 *
 * Das SVG kommt als <img> auf die Leinwand: eingebettete Bilder sind Daten-URLs,
 * also keine fremde Herkunft — die Leinwand bleibt lesbar (`toDataURL`).
 *
 * KI-Kennzeichnung (S12, EU AI Act Art. 50, Verkaufs-Prüfung Zeile 90):
 * Eine Leinwand übernimmt KEINE Metadaten ihrer Quellbilder — was FLUX oder
 * Gemini an C2PA-Manifest oder Kennzeichnung in die Datei geschrieben hat,
 * ist nach `toDataURL` weg (ein unsichtbares Pixel-Wasserzeichen übersteht
 * das Skalieren womöglich, garantiert ist es nicht). Ein C2PA-Manifest
 * umzukopieren wäre falsch: es ist über die Bytes des ORIGINALS signiert und
 * würde am veränderten Bild als gebrochen gelten. Darum schreiben wir unsere
 * eigene Kennzeichnung — sichtbar ins Bild UND als PNG-Textblöcke:
 *   tEXt  AI-Generated        = true
 *   tEXt  Description         = Pflichtlabel (+ Quelle)
 *   tEXt  Software            = AutarkTrade
 *   tEXt  DigitalSourceType   = IPTC-Begriff (URI)
 *   iTXt  XML:com.adobe.xmp   = XMP mit Iptc4xmpExt:DigitalSourceType
 * Der IPTC-Begriff ist `compositeWithTrainedAlgorithmicMedia`: der Hintergrund
 * ist `trainedAlgorithmicMedia`, Texte und Zahlen darüber sind echte Tradedaten
 * — für genau dieses Gemisch hat IPTC den Composite-Begriff.
 */

export const GROESSE = 1080

/** Wortlaut im Bild — Deutsch, wie die übrige Pflichtkennzeichnung der App. */
export const KI_BILD_LABEL = 'KI-generiert – keine Anlageberatung'
export const IPTC_KOMPOSIT = 'http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia'

function ladeBild(src) {
    return new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error('Bild der Share-Card konnte nicht geladen werden'))
        img.src = src
    })
}

/** Ausschnitt für „cover": dasselbe Verhältnis wie das Ziel, mittig. Rein, zum Prüfen. */
export function coverAusschnitt(breite, hoehe, ziel = GROESSE) {
    const massstab = Math.max(ziel / breite, ziel / hoehe)
    const w = ziel / massstab
    const h = ziel / massstab
    return { sx: (breite - w) / 2, sy: (hoehe - h) / 2, sw: w, sh: h }
}

// ── PNG-Textblöcke (rein, ohne DOM — Selbsttest: __selftest-sharecard-ki.mjs) ──

let CRC_TABELLE = null
function crc32(bytes) {
    if (!CRC_TABELLE) {
        CRC_TABELLE = new Uint32Array(256)
        for (let n = 0; n < 256; n++) {
            let c = n
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
            CRC_TABELLE[n] = c >>> 0
        }
    }
    let c = 0xffffffff
    for (let i = 0; i < bytes.length; i++) c = CRC_TABELLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
}

const ascii = (s) => Uint8Array.from(String(s), (z) => z.charCodeAt(0) & 0xff)
const utf8 = (s) => new TextEncoder().encode(String(s))

function block(typ, daten) {
    const aus = new Uint8Array(12 + daten.length)
    const dv = new DataView(aus.buffer)
    dv.setUint32(0, daten.length)
    aus.set(ascii(typ), 4)
    aus.set(daten, 8)
    dv.setUint32(8 + daten.length, crc32(aus.subarray(4, 8 + daten.length)))
    return aus
}

/** tEXt: Latin-1 — Umlaute gehen, Gedankenstrich nicht; darum ASCII-Ersatz. */
function textBlock(schluessel, wert) {
    const latin1 = String(wert).replace(/[–—]/g, '-').replace(/[^\x20-\xff\n]/g, '?')
    return block('tEXt', Uint8Array.from([...ascii(schluessel), 0, ...ascii(latin1)]))
}

/** iTXt: UTF-8, unkomprimiert. */
function itxtBlock(schluessel, wert) {
    return block('iTXt', Uint8Array.from([...ascii(schluessel), 0, 0, 0, 0, 0, ...utf8(wert)]))
}

const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function kiXmp(beschreibung) {
    return '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>'
        + '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
        + '<rdf:Description rdf:about="" xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"'
        + ' xmlns:dc="http://purl.org/dc/elements/1.1/">'
        + `<Iptc4xmpExt:DigitalSourceType>${IPTC_KOMPOSIT}</Iptc4xmpExt:DigitalSourceType>`
        + `<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${xmlEsc(beschreibung)}</rdf:li></rdf:Alt></dc:description>`
        + '</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>'
}

/**
 * Fügt die KI-Kennzeichnung als Textblöcke direkt hinter IHDR ein.
 * @param {Uint8Array} png
 * @param {{ quelle?: string }} [o]  z. B. „FLUX.2 (Black Forest Labs) flux-2-pro"
 * @returns {Uint8Array}
 */
export function pngMitKiKennzeichnung(png, { quelle = '' } = {}) {
    const SIGNATUR = [137, 80, 78, 71, 13, 10, 26, 10]
    if (!(png instanceof Uint8Array) || png.length < 33 || SIGNATUR.some((b, i) => png[i] !== b)) {
        throw new Error('Kein PNG')
    }
    const ihdrEnde = 8 + 12 + new DataView(png.buffer, png.byteOffset).getUint32(8)
    const beschreibung = `${KI_BILD_LABEL} – Fakten prüfen.${quelle ? ` Hintergrund: ${quelle}.` : ''}`
    const bloecke = [
        textBlock('AI-Generated', 'true'),
        textBlock('Description', beschreibung),
        textBlock('Software', 'AutarkTrade'),
        textBlock('DigitalSourceType', IPTC_KOMPOSIT),
        itxtBlock('XML:com.adobe.xmp', kiXmp(beschreibung)),
    ]
    const zusatz = bloecke.reduce((n, b) => n + b.length, 0)
    const aus = new Uint8Array(png.length + zusatz)
    aus.set(png.subarray(0, ihdrEnde), 0)
    let pos = ihdrEnde
    for (const b of bloecke) { aus.set(b, pos); pos += b.length }
    aus.set(png.subarray(ihdrEnde), pos)
    return aus
}

/** Textblöcke eines PNG lesen (für den Selbsttest und zur Kontrolle). */
export function pngTexte(png) {
    const dv = new DataView(png.buffer, png.byteOffset, png.byteLength)
    const aus = {}
    for (let pos = 8; pos + 12 <= png.length;) {
        const laenge = dv.getUint32(pos)
        const typ = String.fromCharCode(...png.subarray(pos + 4, pos + 8))
        const daten = png.subarray(pos + 8, pos + 8 + laenge)
        if (typ === 'tEXt' || typ === 'iTXt') {
            const null0 = daten.indexOf(0)
            const schluessel = String.fromCharCode(...daten.subarray(0, null0))
            const rest = typ === 'tEXt' ? daten.subarray(null0 + 1) : daten.subarray(null0 + 5)
            aus[schluessel] = typ === 'tEXt' ? String.fromCharCode(...rest) : new TextDecoder().decode(rest)
        }
        if (typ === 'IEND') break
        pos += 12 + laenge
    }
    return aus
}

function datenUrlZuBytes(url) {
    const b64 = url.slice(url.indexOf(',') + 1)
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return bytes
}

function bytesZuDatenUrl(bytes) {
    let bin = ''
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return 'data:image/png;base64,' + btoa(bin)
}

/** Sichtbares Label unten rechts: halbdurchsichtiges Band, damit es auf jedem Motiv lesbar bleibt. */
function zeichneLabel(ctx, groesse) {
    const schrift = Math.round(groesse * 0.02)   // 22 px bei 1080
    ctx.save()
    ctx.font = `600 ${schrift}px system-ui, -apple-system, "Segoe UI", sans-serif`
    const text = KI_BILD_LABEL
    const rand = Math.round(schrift * 0.6)
    const breite = ctx.measureText(text).width + rand * 2
    const hoehe = schrift + rand * 1.4
    const x = groesse - breite - rand
    const y = groesse - hoehe - rand
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
    ctx.fillRect(x, y, breite, hoehe)
    ctx.fillStyle = '#ffffff'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, x + rand, y + hoehe / 2)
    ctx.restore()
}

/**
 * `{hintergrund, overlay, kiGeneriert?, kiQuelle?}` → PNG-Daten-URL.
 * Mit `kiGeneriert` (vom Server gesetzt): Label sichtbar im Bild + PNG-Metadaten.
 */
export async function zeichneShareCard({ hintergrund, overlay, kiGeneriert = false, kiQuelle = '' }, groesse = GROESSE) {
    const leinwand = document.createElement('canvas')
    leinwand.width = groesse
    leinwand.height = groesse
    const ctx = leinwand.getContext('2d')
    if (hintergrund) {
        const bg = await ladeBild(hintergrund)
        const a = coverAusschnitt(bg.naturalWidth, bg.naturalHeight, groesse)
        ctx.drawImage(bg, a.sx, a.sy, a.sw, a.sh, 0, 0, groesse, groesse)
    }
    if (overlay) {
        const svgUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(overlay)
        const ebene = await ladeBild(svgUrl)
        ctx.drawImage(ebene, 0, 0, groesse, groesse)
    }
    if (!kiGeneriert) return leinwand.toDataURL('image/png')
    zeichneLabel(ctx, groesse)
    const png = datenUrlZuBytes(leinwand.toDataURL('image/png'))
    return bytesZuDatenUrl(pngMitKiKennzeichnung(png, { quelle: kiQuelle }))
}
