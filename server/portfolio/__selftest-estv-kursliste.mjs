/**
 * Selbsttest ESTV-Kursliste: eigener PDF-Leser (pdf-text.js) und Auswertung
 * (leseKursliste) gegen die echten Dateien der ESTV 2023–2025
 * (server/fixtures/estv/, geholt 26.10.2026 von ictax.admin.ch).
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { pdfZeilen, leseCMap } from './pdf-text.js'
import { leseKursliste, pruefeKursliste } from './estv-kursliste.js'

let ok = 0, fail = 0
const pruefe = (name, bed, detail = '') => { if (bed) ok++; else { fail++; console.error('✗', name, detail) } }
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'estv')
const lies = (j) => leseKursliste(pdfZeilen(fs.readFileSync(path.join(dir, `token-kursliste-${j}.pdf`))))
const finde = (l, t) => l.eintraege.find((e) => e.ticker === t)

const l25 = lies(2025)
pruefe('2025: 81 Coins', l25.eintraege.length === 81, l25.eintraege.length)
pruefe('2025: Stichtag', l25.datum === '31.12.2025')
pruefe('2025: BTC Valor + Kurs', finde(l25, 'BTC')?.valor === '39714275' && finde(l25, 'BTC')?.chf === 69571.988489)
pruefe('2025: ETH', finde(l25, 'ETH')?.chf === 2364.081066 && finde(l25, 'ETH')?.valor === '41623437')
pruefe('2025: XRP, SOL, USDT', finde(l25, 'XRP')?.chf === 1.46801 && finde(l25, 'SOL')?.chf === 99.191777 && finde(l25, 'USDT')?.chf === 0.791468)
pruefe('2025: Seite 2 gelesen (SHIB, PAXG)', finde(l25, 'SHIB')?.chf === 0.0000055 && finde(l25, 'PAXG')?.chf === 3438.47388)
pruefe('2025: Kürzel mit Ziffer (1INCH)', !!finde(l25, '1INCH'))
pruefe('2025: CSPR enthalten', !!finde(l25, 'CSPR'))
pruefe('2025: Name gelesen', finde(l25, 'BTC')?.name === 'Bitcoin')
pruefe('2025: plausibel', pruefeKursliste(l25, 2025).length === 0, pruefeKursliste(l25, 2025))
pruefe('2025: falsches Jahr wird erkannt', pruefeKursliste(l25, 2024).length > 0)

const l24 = lies(2024)
pruefe('2024: 84 Coins', l24.eintraege.length === 84, l24.eintraege.length)
pruefe('2024: BTC wie im Aargauer Beispiel (85 926.49)', Math.abs(finde(l24, 'BTC')?.chf - 85926.486363) < 1e-6)
pruefe('2024: plausibel', pruefeKursliste(l24, 2024).length === 0, pruefeKursliste(l24, 2024))

const l23 = lies(2023)
pruefe('2023: 85 Coins', l23.eintraege.length === 85, l23.eintraege.length)
pruefe('2023: BTC', finde(l23, 'BTC')?.chf === 35541.630896)
pruefe('2023: plausibel', pruefeKursliste(l23, 2023).length === 0, pruefeKursliste(l23, 2023))

// Bausteine
const cm = leseCMap('begincmap 2 beginbfchar <01> <0042> <02> <0054> endbfchar 1 beginbfrange <10> <12> <0041> endbfrange endcmap')
pruefe('CMap bfchar', cm.get(1) === 'B' && cm.get(2) === 'T')
pruefe('CMap bfrange', cm.get(0x10) === 'A' && cm.get(0x12) === 'C')
pruefe('kein PDF → Fehler', (() => { try { pdfZeilen(Buffer.from('hallo')); return false } catch { return true } })())
pruefe('leere Liste unplausibel', pruefeKursliste({ datum: null, eintraege: [] }, 2025).length > 0)

console.log(`ESTV-Kursliste: ${ok} ok, ${fail} Fehler`)
if (fail) process.exit(1)
