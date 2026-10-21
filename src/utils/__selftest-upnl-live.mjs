/** Selbsttest: uPnL offener Positionen aus dem Live-Kurs (upnlLive in overlays/positionen.js). */
import { upnlLive } from './chart/overlays/positionen.js'

let ok = 0, fehler = 0
const pruefe = (bed, text) => { if (bed) { ok++; console.log('  ✓ ' + text) } else { fehler++; console.log('  ✗ ' + text) } }
const nahe = (a, b) => a != null && Math.abs(a - b) < 1e-9

// Das Beispiel aus dem Reiter: ENA Short 1992 @ 0.2167, Börse meldete −3.19
pruefe(nahe(upnlLive({ richtung: 'short', einstieg: 0.2167, menge: 1992 }, 0.2183), (0.2167 - 0.2183) * 1992), 'Short: (Einstieg − Kurs) × Menge')
pruefe(Math.abs(upnlLive({ richtung: 'short', einstieg: 0.2167, menge: 1992 }, 0.2183) - -3.19) < 0.01, 'ENA-Beispiel ergibt ≈ −3.19')
pruefe(nahe(upnlLive({ richtung: 'long', einstieg: 100, menge: 2 }, 103), 6), 'Long: (Kurs − Einstieg) × Menge')
pruefe(upnlLive({ richtung: 'long', einstieg: 100, menge: 2 }, undefined) === null, 'Gegenprobe: ohne Kurs → null (dann gilt die Börse)')
pruefe(upnlLive({ richtung: 'long', einstieg: 0, menge: 2 }, 100) === null, 'Gegenprobe: ohne Einstieg → null')
pruefe(upnlLive({ richtung: 'long', einstieg: 100, menge: null }, 100) === null, 'Gegenprobe: ohne Menge → null')

console.log(`upnl-live: ${ok} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler ? 1 : 0)
