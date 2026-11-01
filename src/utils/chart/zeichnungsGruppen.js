/**
 * Eigene Gruppen von Zeichnungen (Objekte-Reiter): Zeichnungen mit demselben
 * `gruppe`-Namen gehören zusammen und lassen sich gemeinsam ein-/ausblenden,
 * sperren, auflösen oder löschen. Rein.
 */

/**
 * Liste für den Reiter: Gruppen (nach Name, Gross/klein egal) zuerst, darin die
 * Zeichnungen wie sonst neueste zuerst; danach die ungruppierten.
 * @returns {{gruppen: Array<{name, zeichnungen, alleVersteckt, alleGesperrt}>, ohne: Array}}
 */
export function gruppiereZeichnungen(zeichnungen) {
    const neueste = (a, b) => (b.erstelltAm || 0) - (a.erstelltAm || 0)
    const karte = new Map()
    const ohne = []
    for (const z of zeichnungen || []) {
        const name = String(z.gruppe || '').trim()
        if (!name) { ohne.push(z); continue }
        if (!karte.has(name)) karte.set(name, [])
        karte.get(name).push(z)
    }
    const gruppen = [...karte.entries()]
        .sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: 'base' }))
        .map(([name, liste]) => ({
            name,
            zeichnungen: liste.sort(neueste),
            alleVersteckt: liste.every((z) => z.versteckt),
            alleGesperrt: liste.every((z) => z.gesperrt),
        }))
    return { gruppen, ohne: ohne.sort(neueste) }
}

/** Name säubern wie der Server (Leerraum zusammengezogen, höchstens 80 Zeichen); leer → null. */
export const gruppenName = (x) => String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) || null
