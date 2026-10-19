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
 */

export const GROESSE = 1080

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

/** `{hintergrund, overlay}` → PNG-Daten-URL. */
export async function zeichneShareCard({ hintergrund, overlay }, groesse = GROESSE) {
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
    return leinwand.toDataURL('image/png')
}
