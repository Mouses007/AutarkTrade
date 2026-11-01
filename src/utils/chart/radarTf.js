/**
 * Auf welcher Zeitebene das Momentum Radar zu einer Chart-Zeiteinheit rechnet:
 * die eigene, wenn das Radar sie kennt (5m/15m/1h/4h/1d/1w), sonst die nächste.
 *
 * EINE Stelle für Momentum-Box und Teilen-Bild — Chart.vue hatte eine eigene
 * Kopie, die über 4h nicht hinaus kannte: ein geteiltes 1d-Bild zeigte Fenster
 * und Box auf 1d, die Textzeile aber „Momentum Radar (4h)" mit dem 4h-Geldfluss
 * (Audit FUN-F2B-005).
 */
export const RADAR_TF = ['5m', '15m', '1h', '4h', '1d', '1w']
const MIN = { '1m': 1, '3m': 3, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '2h': 120, '4h': 240, '6h': 360, '8h': 480, '12h': 720, '1d': 1440, '3d': 4320, '1w': 10080 }

export function radarTfFuer(iv) {
    if (RADAR_TF.includes(iv)) return iv
    const m = MIN[iv]
    if (m == null) return '1w'          // 1M
    if (m < 5) return '5m'
    return m <= 15 ? '15m' : m <= 60 ? '1h' : m <= 720 ? '4h' : m <= 4320 ? '1d' : '1w'
}
