/**
 * `charts.js` (ECharts, gross) wird erst beim ersten Zeichnen geladen.
 * `geladeneDiagramme()` sagt, ob das schon passiert ist — Aufräumen ohne
 * geladene Diagramme ist ein Nichts.
 */
let modul = null

export async function ladeDiagramme() {
    if (!modul) modul = await import('./diagramme/index.js')
    return modul
}

export function geladeneDiagramme() {
    return modul
}
