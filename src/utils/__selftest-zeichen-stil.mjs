/**
 * Gemerkter Werkzeug-Stil (src/stores/zeichenStil.js): Fenster und Skala sagen,
 * WO eine Zeichnung liegt, nicht wie sie aussieht — sie dürfen nicht in die
 * nächste Zeichnung wandern. Fall 28.11.2026: eine im RSI-Fenster umgefärbte
 * Trendlinie merkte `fenster: 'rsi'`, jede neue Trendlinie im Kerzen-Chart
 * gehörte danach zum RSI-Fenster und war nirgends zu sehen.
 */
const speicher = new Map()
globalThis.localStorage = {
    getItem: (k) => (speicher.has(k) ? speicher.get(k) : null),
    setItem: (k, v) => speicher.set(k, String(v)),
    removeItem: (k) => speicher.delete(k),
}

const { letzterStil, merkeStil } = await import('../stores/zeichenStil.js')

let n = 0
function pruefe(bed, text) {
    n++
    if (!bed) { console.error('FEHLER:', text); process.exit(1) }
}

// Stiländerung an einer Zeichnung im RSI-Fenster / auf Log-Skala
merkeStil('trend', { farbe: '#ffcc00', breite: 3, fenster: 'rsi', skala: 'log', text: 'x' })
const s = letzterStil('trend')
pruefe(s.farbe === '#ffcc00' && s.breite === 3, 'Farbe und Breite werden gemerkt')
pruefe(!('fenster' in s), 'fenster wird nicht gemerkt')
pruefe(!('skala' in s), 'skala wird nicht gemerkt')
pruefe(!('text' in s), 'text wird nicht gemerkt')

// Alter Eintrag aus der Zeit vor der Regel: beim Lesen trotzdem unschädlich
speicher.set('at.chart.zeichenStil', JSON.stringify({ trend: { farbe: '#00ff00', fenster: 'macd', skala: 'log' } }))
const alt = letzterStil('trend')
pruefe(alt.farbe === '#00ff00', 'alter Eintrag: Farbe bleibt')
pruefe(!('fenster' in alt) && !('skala' in alt), 'alter Eintrag: fenster/skala fallen beim Lesen weg')

// Neue Zeichnung wie in ChartPanel.zeichnungNeu: { ...letzterStil(typ), ...vorgabeStil }
pruefe(({ ...letzterStil('trend'), ...{} }).fenster === undefined, 'Kerzen-Pane: neue Linie ohne fenster')
pruefe(({ ...letzterStil('trend'), ...{ fenster: 'rsi' } }).fenster === 'rsi', 'Indikator-Fenster: Vorgabe setzt fenster')

console.log(`${n} ok, 0 Fehler`)
