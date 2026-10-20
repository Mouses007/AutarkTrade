// node src/utils/__selftest-markdown-text.mjs — Markdown → Klartext (Dialog „Rechtliches", A4-17)
import { markdownAlsText } from './markdownText.js'
let bestanden = 0, fehler = 0
const pruefe = (b, text) => { if (b) bestanden++; else { fehler++; console.log('  ✗ ' + text) } }
const aus = markdownAlsText('# NOTICE – Herkunft\n\n> ⚠ ENTWURF `LICENSE`\n>\n> - Punkt **eins**\n\nSiehe [Quelle](https://x.y).')
pruefe(aus.startsWith('NOTICE – HERKUNFT\n'), 'Überschrift ohne #: ' + JSON.stringify(aus))
pruefe(aus.includes('\n⚠ ENTWURF LICENSE\n'), 'Zitat und Backticks entfernt')
pruefe(aus.includes('\n• Punkt eins\n'), 'Aufzählung und Fett')
pruefe(aus.includes('Siehe Quelle (https://x.y).'), 'Link mit Ziel')
pruefe(!/[#>`*]/.test(aus.replace('https://x.y', '')), 'keine Auszeichnung übrig')
console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler ? 1 : 0)
