/**
 * Selbsttest: Kennzahlen der Bot-Seite (server/bots/kennzahlen.js).
 * Gegen die echte Feldstruktur in server/fixtures/pionex-bot-orders.json.
 *
 * Aufruf: node server/bots/__selftest-bot-kennzahlen.mjs
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalisiereBot } from './pionex-bots.js'
import { kennzahlen, gewinn, lageImBand, liquidationsAbstand, zeitImBand, atrTag, LIQ_NAH } from './kennzahlen.js'

let ok = 0, fehl = 0
const p = (name, bed, zusatz = '') => {
    if (bed) { ok++; console.log(`  ✓ ${name}`) }
    else { fehl++; console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`) }
}
const nahe = (a, b, tol = 1e-9) => a != null && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b))

const hier = path.dirname(fileURLToPath(import.meta.url))
const fix = JSON.parse(readFileSync(path.join(hier, '..', 'fixtures', 'pionex-bot-orders.json'), 'utf8'))
const [lauf, sui, neutral] = fix.data.results.map(normalisiereBot)

console.log('Laufender Coin-M-Bot bei SOL 83,2 USD')
const d = fix.data.results[0].buOrderData
const kurs = 83.2
const erwRealisiert = Number(d.marginBalance) - (Number(d.quoteInvestment) + Number(d.extraMargin || 0))
const erwSchwebend = Number(d.position) * (1 / kurs - Number(d.positionOpenPrice))
const g = gewinn(lauf, kurs)
p('realisiert = Marge − (Einsatz + Extra-Marge)', nahe(g.realisiert, erwRealisiert))
p('schwebend invers = Position × (1/Kurs − Einstieg roh)', nahe(g.schwebend, erwSchwebend, 1e-9))
p('gesamt = realisiert + schwebend', nahe(g.gesamt, erwRealisiert + erwSchwebend, 1e-9))
const k = kennzahlen(lauf, { kurs, atrTag: 6 }, 1794375879428)
p('Kurs unter dem Band', k.band.lage === 'darunter' && k.band.abstandUnten < 0)
p('Liquidation unten, Abstand ≈ 14,8 %', k.liquidation.seite === 'unten' && nahe(k.liquidation.abstand, (kurs - 1 / 0.0141000087195626) / kurs, 1e-6))
p('Abstand in ATR = USD-Abstand / ATR', nahe(k.liquidation.inAtr, (kurs - 1 / 0.0141000087195626) / 6, 1e-6))
for (const h of ['unterBand', 'liqNah', 'ohneStop', 'keineTrades24h']) p(`Hinweis ${h}`, k.hinweise.includes(h), k.hinweise.join(','))
p('kein Hinweis „über Band" / „liquidiert"', !k.hinweise.includes('ueberBand') && !k.hinweise.includes('liquidiert'))
p('Laufzeit in Tagen > 0, Zyklen pro Tag gerechnet', k.tage > 0 && nahe(k.zyklenProTag, 2356 / k.tage))
p('Verlust über −100 % aufs Jahr → keine Hochrechnung', k.tage >= 7 && k.rendite.gesamt / k.tage * 365 < -1 && k.rendite.jahr === null)
p('Grid-Rendite aufs Jahr = Rendite / Tage × 365 (Laufzeit ≥ 7 Tage)', nahe(k.gridRendite.jahr, k.gridRendite.gesamt / k.tage * 365))
p('unter 7 Tagen keine Hochrechnung', kennzahlen(sui, {}).rendite.jahr === null && kennzahlen(sui, {}).gridRendite.jahr === null)
p('ohne Kurs: schwebend und gesamt unbekannt', gewinn(lauf, null).gesamt === null && gewinn(lauf, null).schwebend === null)
p('ohne Kurs keine Lage im Band', kennzahlen(lauf, {}).band === null)

console.log('Beendeter SUI-Bot (liquidiert)')
const ks = kennzahlen(sui, {})
p('Gewinn = totalRealizedProfit', nahe(ks.gewinn.gesamt, sui.ergebnis.gesamt))
p('Hinweis liquidiert, keine Lage-Hinweise', ks.hinweise.includes('liquidiert') && !ks.hinweise.includes('unterBand') && ks.band === null)

console.log('Beendeter Coin-M-Bot')
const kn = kennzahlen(neutral, {})
p('Coin-M beendet: Gewinn aus der Marge', nahe(kn.gewinn.gesamt, neutral.einsatz.marge - (neutral.einsatz.aktuell + (neutral.einsatz.extraMarge || 0))))

console.log('Bausteine')
const l = lageImBand(150, 100, 200)
p('Lage innen, Anteil 0,5', l.lage === 'innen' && nahe(l.anteil, 0.5))
p('Lage darüber', lageImBand(210, 100, 200).lage === 'darueber')
p('ungültiges Band → null', lageImBand(150, 200, 100) === null)
const kurzBot = { richtung: 'SHORT', liquidation: { unten: null, oben: 120, preis: null } }
p('Short liquidiert oben', liquidationsAbstand(kurzBot, 100).seite === 'oben' && nahe(liquidationsAbstand(kurzBot, 100).abstand, 0.2))
p('Short mit nur unterer Schätzung → keine Seite', liquidationsAbstand({ richtung: 'SHORT', liquidation: { unten: 80 } }, 100) === null)
const neut = { richtung: 'NEUTRAL', liquidation: { unten: 90, oben: 105 } }
p('Neutral: die nähere Seite zählt', liquidationsAbstand(neut, 100).seite === 'oben')
p(`Grenze „nah" ist ${LIQ_NAH * 100} %`, LIQ_NAH === 0.15)
const kerzen = [95, 120, 150, 210, 205].map((c, i) => ({ t: i * 1000, o: c, h: c + 5, l: c - 5, c }))
const z = zeitImBand(kerzen, 100, 200)
p('Zeit im Band: 2 innen, 1 darunter, 2 darüber', nahe(z.innen, 0.4) && nahe(z.darunter, 0.2) && nahe(z.darueber, 0.4) && z.kerzen === 5)
p('Zeit im Band ab Startzeit', zeitImBand(kerzen, 100, 200, 3000).kerzen === 2)
const tage = Array.from({ length: 20 }, (_, i) => ({ t: i, o: 100, h: 104, l: 96, c: 100 }))
p('ATR flacher Kerzen = Spanne 8', nahe(atrTag(tage), 8))
p('zu wenig Kerzen → null', atrTag(tage.slice(0, 5)) === null)

console.log(`\n${ok} bestanden, ${fehl} fehlgeschlagen`)
process.exit(fehl ? 1 : 0)
