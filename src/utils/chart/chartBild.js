/**
 * Bild eines Charts zum Teilen: Kopfstreifen (Symbol, Zeiteinheit, Börse, Zeit,
 * Kurs), darunter das Bildschirmfoto des Panels — `takeScreenshot` von
 * Lightweight Charts nimmt alle Fenster mit (Indikatoren, Zeichnungen, Momentum
 * Radar) —, optional Textzeilen (Stand der Momentum-Box) und eine Fusszeile mit
 * der Quelle der Charts.
 *
 * Dazu die Hilfen für ein eigenes Bild (Bildschirmfoto aus der Zwischenablage):
 * zu grosse Bilder werden verkleinert, damit Mail und Teilen-Menü sie nehmen.
 */

/** Grösste Kante eines eigenen Bildes, bevor es verkleinert wird. */
export const MAX_KANTE = 2560

function farbe(name, ersatz) {
    try {
        const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
        return v || ersatz
    } catch { return ersatz }
}

/**
 * @param {HTMLCanvasElement} leinwand  Bildschirmfoto des Panels
 * @param {{titel: string, unter?: string, zeilen?: string[], fuss?: string}} o
 * @returns {HTMLCanvasElement}
 */
export function baueChartBild(leinwand, { titel, unter = '', zeilen = [], fuss = '' }) {
    const w = leinwand.width
    // Schrift wächst mit der Auflösung des Fotos (Retina liefert doppelte Pixel)
    const s = Math.min(2.5, Math.max(1, w / 1100))
    const kopfH = Math.round(46 * s)
    const zeileH = Math.round(18 * s)
    const zeilenH = zeilen.length ? Math.round(zeilen.length * zeileH + 12 * s) : 0
    const fussH = Math.round(24 * s)
    const c = document.createElement('canvas')
    c.width = w
    c.height = kopfH + leinwand.height + zeilenH + fussH
    const ctx = c.getContext('2d')
    const schrift = farbe('--schrift', '-apple-system, "Segoe UI", Roboto, sans-serif')
    ctx.fillStyle = farbe('--bg', '#050607')
    ctx.fillRect(0, 0, c.width, c.height)

    // Kopf
    const rand = Math.round(12 * s)
    ctx.textBaseline = 'middle'
    ctx.fillStyle = farbe('--text', '#e8eaed')
    ctx.font = `600 ${Math.round(17 * s)}px ${schrift}`
    ctx.fillText(titel, rand, kopfH / 2)
    if (unter) {
        ctx.fillStyle = farbe('--muted', '#8a9199')
        ctx.font = `${Math.round(13 * s)}px ${schrift}`
        ctx.textAlign = 'right'
        ctx.fillText(unter, w - rand, kopfH / 2)
        ctx.textAlign = 'left'
    }
    ctx.fillStyle = farbe('--accent', '#1fd6c4')
    ctx.fillRect(0, kopfH - Math.max(1, Math.round(s)), w, Math.max(1, Math.round(s)))

    ctx.drawImage(leinwand, 0, kopfH)

    // Momentum-Zeilen
    let y = kopfH + leinwand.height
    if (zeilen.length) {
        ctx.fillStyle = farbe('--panel', '#101316')
        ctx.fillRect(0, y, w, zeilenH)
        ctx.fillStyle = farbe('--text', '#e8eaed')
        ctx.font = `${Math.round(12.5 * s)}px ${schrift}`
        zeilen.forEach((z, i) => ctx.fillText(z, rand, y + 6 * s + zeileH * (i + 0.5)))
        y += zeilenH
    }

    // Fuss
    ctx.fillStyle = farbe('--muted', '#8a9199')
    ctx.font = `${Math.round(11 * s)}px ${schrift}`
    ctx.fillText('AutarkTrade', rand, y + fussH / 2)
    if (fuss) {
        ctx.textAlign = 'right'
        ctx.fillText(fuss, w - rand, y + fussH / 2)
        ctx.textAlign = 'left'
    }
    return c
}

export function leinwandZuBlob(c, typ = 'image/png') {
    return new Promise((ok) => c.toBlob((b) => ok(b), typ))
}

/** Blob → reines Base64 (ohne `data:`-Kopf). */
export function blobZuBase64(blob) {
    return new Promise((ok, nein) => {
        const r = new FileReader()
        r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, ''))
        r.onerror = () => nein(r.error)
        r.readAsDataURL(blob)
    })
}

/**
 * Eigenes Bild (Bildschirmfoto, Datei) vorbereiten: PNG/JPEG bis `MAX_KANTE`
 * bleiben wie sie sind; grössere oder andere Formate werden als PNG neu
 * gezeichnet (verkleinert). Kein Bild → `null`.
 */
export async function eigenesBild(datei) {
    if (!datei || !String(datei.type).startsWith('image/')) return null
    const bitmap = await createImageBitmap(datei)
    const kante = Math.max(bitmap.width, bitmap.height)
    if (kante <= MAX_KANTE && ['image/png', 'image/jpeg'].includes(datei.type)) { bitmap.close?.(); return datei }
    const f = Math.min(1, MAX_KANTE / kante)
    const c = document.createElement('canvas')
    c.width = Math.round(bitmap.width * f)
    c.height = Math.round(bitmap.height * f)
    c.getContext('2d').drawImage(bitmap, 0, 0, c.width, c.height)
    bitmap.close?.()
    return leinwandZuBlob(c)
}
