/**
 * Selbsttest: KI-Vorschläge der Bot-Seite (server/bots/bot-ki.js) — ohne Netz,
 * ohne KI-Aufruf: Kandidaten, Prompt und die Prüfung einer KI-Antwort.
 *
 * Aufruf: node server/bots/__selftest-bot-ki.mjs
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalisiereBot } from './pionex-bots.js'
import { kennzahlen } from './kennzahlen.js'
import { kandidaten, rechneKandidaten, marktLage, bauePrompt, systemText, pruefeKiAntwort, kiMoeglich, MAX_VORSCHLAEGE, hoheZeitrahmen, niveausAusZeitrahmen, unbelegteZahlen } from './bot-ki.js'

let ok = 0, fehl = 0
const p = (name, bed, zusatz = '') => {
    if (bed) { ok++; console.log(`  ✓ ${name}`) }
    else { fehl++; console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`) }
}
const nahe = (a, b, tol = 1e-9) => a != null && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b))

const hier = path.dirname(fileURLToPath(import.meta.url))
const fix = JSON.parse(readFileSync(path.join(hier, '..', 'fixtures', 'pionex-bot-orders.json'), 'utf8'))
const bot = { ...normalisiereBot(fix.data.results[0]), kurs: 83.035 }
bot.kennzahlen = kennzahlen(bot, { kurs: bot.kurs })
const kerzen = []
for (let i = 0; i < 300; i++) {
    const m = 109 - (26 * i) / 299, w = Math.sin(i / 3) * 1.2
    kerzen.push({ t: 1760000000000 + i * 60000, o: m + w, h: m + Math.abs(w) + 0.4, l: m - Math.abs(w) - 0.4, c: m - w })
}
kerzen.at(-1).c = 83.035
const tage = Array.from({ length: 40 }, (_, i) => ({ t: i, o: 110 - i * 0.7, h: 112 - i * 0.7, l: 107 - i * 0.7, c: 109 - i * 0.7 }))

console.log('Marktlage')
const lage = marktLage(tage, 83)
p('7- und 30-Tage-Änderung, Hoch/Tief, Spanne', lage && lage.aenderung7 < 0 && lage.hoch30 > lage.tief30 && lage.spanneMedian > 0)
p('grösster 7-Tage-Fall negativ', lage.maxFall7 < 0)
p('zu wenig Kerzen → null', marktLage(tage.slice(0, 5), 83) === null)

console.log('Kandidaten')
const liste = kandidaten(bot, bot.kurs, 4.3)
p('mehrere Kandidaten mit fortlaufender ID', liste.length >= 8 && liste.every((k, i) => k.id === `K${i + 1}`))
p('Extra-Marge 25/50/100 %', liste.filter((k) => k.variante.extraMarge).length >= 3)
p('weniger Hebel (4 → 2 und 3)', liste.some((k) => k.variante.hebel === 2) && liste.some((k) => k.variante.hebel === 3))
p('Band um den Kurs: Kurs liegt im neuen Band', liste.filter((k) => k.variante.unten && k.variante.oben).every((k) => k.variante.unten < bot.kurs && k.variante.oben > bot.kurs))
p('Stop-Loss zwischen Liquidation und Kurs', liste.filter((k) => k.variante.stopLoss).every((k) => k.variante.stopLoss > bot.liquidation.unten && k.variante.stopLoss < bot.kurs))
p('Kombinationen vorhanden', liste.some((k) => k.variante.hebel && k.variante.unten) && liste.some((k) => k.variante.extraMarge && k.variante.stopLoss))
p('ohne ATR keine Band- und Stop-Kandidaten', kandidaten(bot, bot.kurs, null).every((k) => !k.variante.unten && !k.variante.stopLoss))
p('Neutral: keine Stops, kein Band', kandidaten({ ...bot, richtung: 'NEUTRAL' }, bot.kurs, 4.3).every((k) => !k.variante.stopLoss && !k.variante.unten))

console.log('Nachrechnen')
const g = rechneKandidaten(bot, kerzen, liste, {})
p('jeder Kandidat hat Rückblick und „jetzt"', g.kandidaten.length === liste.length && g.kandidaten.every((c) => c.rueckblick && c.abJetzt))
p('Basis und Eichung einmal dabei', g.basis && g.eichung)
const hebel2 = g.kandidaten.find((c) => c.variante.hebel === 2)
p('Hebel 2 jetzt: Position bleibt, Einsatz nachschiessen', hebel2.abJetzt.geschlossenAnteil < 0.01 && hebel2.abJetzt.zusatz > 0)

console.log('Prompt')
const prompt = bauePrompt({ ...bot, kennzahlen: bot.kennzahlen }, { ...lage, atr: 4.3 }, g)
p('nennt Typ-Wissen, Bot, Markt und alle IDs', prompt.includes('Coin-M') && prompt.includes('MARKT:') && g.kandidaten.every((c) => prompt.includes(`${c.id} |`)))
p('Systemtext verlangt JSON und verbietet Versprechen', systemText().includes('"vorschlaege"') && /garantiert/.test(systemText()))

console.log('KI-Antwort prüfen')
const antwort = {
    lage: 'Der Bot liegt unter dem Band.',
    vorschlaege: [
        { id: 'K1', titel: 'Marge', begruendung: 'Mehr Abstand zur Liquidation.', risiko: 'Kostet frisches Geld.', passtNichtWenn: 'Kein SOL vorhanden.' },
        { id: 'k1', titel: 'doppelt' },
        { id: 'K99', titel: 'erfunden' },
        { id: 'K2', titel: 'Garantiert sicher', begruendung: 'risikolos' },
        { id: 'K3', titel: 'drei' }, { id: 'K4', titel: 'vier' }, { id: 'K5', titel: 'fünf' },
    ],
    hinweis: 'Rückblick ist keine Vorhersage.',
}
const r = pruefeKiAntwort(antwort, g)
p(`höchstens ${MAX_VORSCHLAEGE} Vorschläge, doppelte ID nur einmal`, r.vorschlaege.length === MAX_VORSCHLAEGE && r.vorschlaege.filter((v) => v.id === 'K1').length === 1)
p('unbekannte ID verworfen', r.verworfen.some((v) => v.id === 'K99' && v.grund === 'unbekannteId'))
p('„garantiert/risikolos" verworfen', r.verworfen.some((v) => v.id === 'K2' && v.grund === 'wortwahl') && !r.vorschlaege.some((v) => v.id === 'K2'))
p('Vorschlag trägt die nachgerechneten Zahlen des Codes', r.vorschlaege[0].variante === g.kandidaten[0].variante && r.vorschlaege[0].rueckblick === g.kandidaten[0].rueckblick)
p('Lage und Hinweis übernommen', r.lage.startsWith('Der Bot') && r.hinweis.length > 0)
p('Lage mit „optimal" wird geleert', pruefeKiAntwort({ lage: 'Das ist optimal.', vorschlaege: [] }, g).lage === '')
p('kein JSON → null', pruefeKiAntwort(null, g) === null)
p('englische Versprechen werden verworfen (guaranteed, risk-free, recommend)', ['guaranteed profit', 'risk-free', 'I recommend this'].every((w) => pruefeKiAntwort({ vorschlaege: [{ id: 'K1', titel: 'x', begruendung: w }] }, g).vorschlaege.length === 0))
p('englischer Normaltext geht durch', pruefeKiAntwort({ vorschlaege: [{ id: 'K1', titel: 'More margin', begruendung: 'Liquidation moves away.' }] }, g).vorschlaege.length === 1)
p('Zahlen: 70.92 ist durch 70.9219 belegt, 64.5 nicht', JSON.stringify(unbelegteZahlen('Liq 70.92, neu 64.5, 3 Varianten', 'Liquidation 70.9219 und 63.7100')) === '["64.5"]')
const mitText = pruefeKiAntwort({ vorschlaege: [{ id: 'K1', titel: 'x', begruendung: 'Liquidation auf 12345.6 USD' }] }, g, 'nur 1.0 und 2.5')
p('unbelegte Zahl im Vorschlag wird markiert', mitText.vorschlaege[0].unbelegt.includes('12345.6'))

console.log('Hohe Zeitrahmen')
// Pendelnder Abwärtsmarkt mit klaren Tiefs: genug geschlossene Kerzen je Zeitrahmen
const serie = (n, schritt, start, amp, per) => Array.from({ length: n }, (_, i) => {
    const m = start - i * schritt + Math.sin(i / per) * amp
    return { t: i * 1000, o: m + amp * 0.2, h: m + amp * 0.5, l: m - amp * 0.5, c: m - amp * 0.2 }
})
const serien = { '1w': serie(120, 0.3, 120, 12, 4), '1d': serie(300, 0.12, 120, 6, 5), '4h': serie(300, 0.03, 92, 3, 6) }
const zr = hoheZeitrahmen(serien, 83)
p('drei Zeitrahmen gemessen, Marken mit IDs Z…', zr && zr.zeilen.length === 3 && zr.zeilen.every((z) => !z.unbekannt) && zr.marken.every((m, i) => m.id === `Z${i + 1}`))
p('Gleichlauf zählt Strukturen', zr.gleichlauf.auf + zr.gleichlauf.ab + zr.gleichlauf.offen === 3)
const ohne = hoheZeitrahmen({ '1w': null, '1d': serien['1d'], '4h': null }, 83)
p('fehlender Zeitrahmen bleibt „unbekannt", nie erfunden', ohne.zeilen.find((z) => z.tf === '1w').unbekannt && !ohne.zeilen.find((z) => z.tf === '1d').unbekannt)
p('gar keine Kerzen → null', hoheZeitrahmen({}, 83) === null)
p('Marken und Abstand gegen den Kurs des Bots, nicht gegen den Schluss je Zeitrahmen (FUN-R-202)', zr.zeilen.every((z) => z.kurs === 83) && zr.marken.every((m) => (m.abstandAtr > 0) === (m.preis > 83)))
p('Gegenprobe: ohne Kurs gilt der letzte Schluss je Zeitrahmen', hoheZeitrahmen(serien).zeilen.every((z) => z.kurs === z.schluss))
const nv = niveausAusZeitrahmen(zr, 83)
p('Niveaus unter und über dem Kurs getrennt', nv.unten.every((n) => n.preis < 83) && nv.oben.every((n) => n.preis > 83))
const mitZr = kandidaten(bot, bot.kurs, 4.3, zr)
const anNiveau = mitZr.filter((k) => /Niveau Z|Niveau C/.test(k.titel))
p('Kandidaten an gemessenen Niveaus, Stops zwischen Liquidation und Kurs', anNiveau.length > 0 && anNiveau.filter((k) => k.variante.stopLoss).every((k) => k.variante.stopLoss > bot.liquidation.unten && k.variante.stopLoss < bot.kurs))
const promptZr = bauePrompt({ ...bot, kennzahlen: bot.kennzahlen }, { ...lage, atr: 4.3 }, g, false, zr)
p('Prompt enthält HOHE ZEITRAHMEN mit 1w/1d/4h', promptZr.includes('HOHE ZEITRAHMEN') && ['1w:', '1d:', '4h:'].every((x) => promptZr.includes(x)))
p('Systemtext verlangt den Bezug auf Niveaus', systemText().includes('HOHEN ZEITRAHMEN'))

console.log('Wann möglich')
p('laufender Coin-M-Bot ja', kiMoeglich(bot))
p('beendeter Bot nein', !kiMoeglich({ ...bot, laufend: false }))
p('Cross-Margin nein', !kiMoeglich({ ...bot, typ: 'cross_margin_grid' }))

console.log(`\n${ok} bestanden, ${fehl} fehlgeschlagen`)
process.exit(fehl ? 1 : 0)
