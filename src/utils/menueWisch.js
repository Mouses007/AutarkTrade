/**
 * Seitenmenü auf dem Handy per Wischen: vom linken Rand nach rechts öffnet es,
 * nach links wischen schliesst es. Rein und ohne DOM — Rahmen.vue reicht die
 * Fingerpositionen herein und führt das Ergebnis aus.
 *
 * Nur vom RAND, damit waagrechtes Wischen im Inhalt (Tabellen, Charts,
 * Kalender) nicht das Menü aufreisst; und nur überwiegend waagrecht, damit
 * senkrechtes Scrollen am Rand nichts auslöst.
 */
export const RAND_PX = 24        // Start so nah am linken Rand öffnet
export const WEG_PX = 50         // so weit muss der Finger waagrecht wandern

/**
 * @param {{x:number,y:number}} start  Fingerposition beim Aufsetzen
 * @param {{x:number,y:number}} jetzt  aktuelle Fingerposition
 * @param {boolean} offen              Menü gerade offen?
 * @returns {'oeffnen'|'schliessen'|null}
 */
export function wischErgebnis(start, jetzt, offen) {
    const dx = jetzt.x - start.x
    const dy = jetzt.y - start.y
    if (Math.abs(dx) < WEG_PX || Math.abs(dy) > Math.abs(dx) * 0.7) return null
    if (!offen && dx > 0 && start.x <= RAND_PX) return 'oeffnen'
    if (offen && dx < 0) return 'schliessen'
    return null
}
