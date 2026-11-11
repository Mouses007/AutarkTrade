/**
 * Selbsttest: Simulationsvergleich der Bot-Seite (server/bots/simulation.js).
 *
 * Aufruf: node server/bots/__selftest-bot-simulation.mjs
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalisiereBot } from './pionex-bots.js'
import { vergleiche, pruefeVariante, gebuehrenFuer, MAX_VARIANTEN } from './simulation.js'

let ok = 0, fehl = 0
const p = (name, bed, zusatz = '') => {
    if (bed) { ok++; console.log(`  ✓ ${name}`) }
    else { fehl++; console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`) }
}
const nahe = (a, b, tol = 1e-9) => a != null && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b))

const hier = path.dirname(fileURLToPath(import.meta.url))
const fix = JSON.parse(readFileSync(path.join(hier, '..', 'fixtures', 'pionex-bot-orders.json'), 'utf8'))
const bot = { ...normalisiereBot(fix.data.results[0]), kurs: 83.035 }

// Kurs von 109 auf 83 mit Pendeln, 300 Kerzen
const kerzen = []
for (let i = 0; i < 300; i++) {
    const mitte = 109 - (26 * i) / 299
    const w = Math.sin(i / 3) * 1.2
    const o = mitte + w, c = mitte - w
    kerzen.push({ t: 1760000000000 + i * 60000, o, h: Math.max(o, c) + 0.4, l: Math.min(o, c) - 0.4, c })
}
kerzen[kerzen.length - 1].c = 83.035

console.log('Eingaben prüfen')
const pv = (v) => pruefeVariante(v, bot)
p('Band + Grids gültig', pv({ unten: 75, oben: 150, anzahl: 160 }).anzahl === 160)
p('nur Obergrenze: Untergrenze von heute', nahe(pv({ oben: 150 }).unten, bot.grid.unten) && pv({ oben: 150 }).oben === 150)
p('Art geometric bleibt, sonst arithmetic', pv({ art: 'geometric' }).art === 'geometric' && pv({ art: 'x' }).art === 'arithmetic')
p('oben ≤ unten → band', pv({ unten: 150, oben: 75 }).fehler === 'band')
p('1 Grid → anzahl', pv({ anzahl: 1 }).fehler === 'anzahl')
p('1001 Grids → anzahl', pv({ anzahl: 1001 }).fehler === 'anzahl')
p('Tippfehler 7500–15000 bei Kurs 83 → weitWeg', pv({ unten: 7500, oben: 15000 }).fehler === 'weitWeg')
p('Text → band', pv({ unten: 'x', oben: 150 }).fehler === 'band')
p('Hebel 0 und 200 → hebel', pv({ hebel: 0 }).fehler === 'hebel' && pv({ hebel: 200 }).fehler === 'hebel')
p('Einsatz ≤ 0 → einsatz', pv({ einsatz: -1 }).fehler === 'einsatz')
p('Long: Stop-Loss über dem Kurs → stopLoss', pv({ stopLoss: 90 }).fehler === 'stopLoss')
p('Long: Take-Profit unter dem Kurs → takeProfit', pv({ takeProfit: 80 }).fehler === 'takeProfit')
p('Long: SL 70 und TP 120 gültig', pv({ stopLoss: 70, takeProfit: 120 }).stopLoss === 70)
p('Neutral: Stops nicht abbildbar', pruefeVariante({ stopLoss: 70 }, { ...bot, richtung: 'NEUTRAL' }).fehler === 'neutralStop')
p('alles leer → leer (wird übergangen)', pv({ unten: '', oben: '' }).fehler === 'leer')

console.log('Vergleich am Coin-M-Bot')
const v = vergleiche(bot, kerzen, [{ unten: 75, oben: 150, anzahl: 320, art: 'arithmetic' }, { unten: 70, oben: 120, anzahl: 100, art: 'arithmetic' }])
const gb = gebuehrenFuer(bot)
p('Gebühr: Grid-Orders höchstens Maker 0,02 %, Markt Taker 0,05 %', gb.gebuehr <= 0.0002 && gb.gebuehr > 0 && gb.gebuehrMarkt === 0.0005)
p('Basis gerechnet, Einheit SOL', v.basis && v.einheit === 'SOL')
p('Basis = heutige Einstellung 95–200', nahe(v.basis.einstellung.unten, 95.00014250021374, 1e-9) && v.basis.einstellung.oben === 200)
p('zwei Varianten', v.varianten.length === 2 && v.varianten[0].einstellung.unten === 75)
p('Kurve ausgedünnt, letzter Punkt dabei', v.basis.kurve.length <= 401 && v.basis.kurve.at(-1)[0] === kerzen.at(-1).t)
p('Eichung: echt = Pionex-Gewinn ohne Funding', nahe(v.eichung.echt, v.eichung.simuliert - v.eichung.abweichung))
p('Eichung nennt Zyklen und Position', v.eichung.zyklenEcht === 2356 && typeof v.eichung.zyklenSim === 'number' && v.eichung.positionEcht === bot.position.menge)
p('Eichung mit synthetischen Kerzen ist unsicher markiert oder nicht', typeof v.eichung.unsicher === 'boolean')
p('ohne Funding-Verlauf: vermerkt, Vergleich ohne Funding', v.hinweise.fundingSimuliert === false && v.eichung.fundingSim === null)
const fundingListe = kerzen.filter((_, i) => i % 50 === 0).map((k) => ({ t: k.t, rate: 0.0001 }))
const vf2 = vergleiche(bot, kerzen, [], { funding: fundingListe })
p('mit Funding: Long der Coin zahlt bei positivem Satz', vf2.hinweise.fundingSimuliert && vf2.basis.funding < 0)
p('Eichung mit Funding vergleicht das ganze Ergebnis', nahe(vf2.eichung.echt, v.eichung.echt + (bot.ergebnis.funding || 0)))
p('laufender Bot: Liquidationsschätzung unter dem Kurs', vf2.eichung.liqSim > 0 && vf2.eichung.liqSim < bot.kurs && nahe(vf2.eichung.liqEcht, bot.liquidation.unten))

console.log('Umstellen zum heutigen Kurs')
const a = v.abJetzt[0]
p('Zielposition kleiner als heute (Long der Coin, Band bis 150)', Math.abs(a.ziel) < Math.abs(a.aktuell) && Math.sign(a.ziel) === Math.sign(a.aktuell))
p('geschlossener Anteil = 1 − |Ziel| / |heute|', nahe(a.geschlossenAnteil, 1 - Math.abs(a.ziel) / Math.abs(a.aktuell)))
p('realisiert ≈ Anteil × schwebender Gewinn (negativ)', a.realisiertCa < 0)
p('neue Liquidationsschätzung unter dem Kurs, heutige mitgeliefert', a.liqNeu > 0 && a.liqNeu < bot.kurs && nahe(a.liqHeute, bot.liquidation.unten))
const mehr = vergleiche(bot, kerzen, [{ unten: 75, oben: 150, einsatz: bot.einsatz.aktuell * 2 }]).abJetzt[0]
p('doppelter Einsatz: doppelte Zielposition, Liquidation nicht näher', nahe(Math.abs(mehr.ziel), 2 * Math.abs(a.ziel), 1e-6) && mehr.liqNeu <= a.liqNeu + 1e-9 && mehr.zusatz > 0)
const hebel = vergleiche(bot, kerzen, [{ unten: 75, oben: 150, hebel: bot.hebel * 2 }]).abJetzt[0]
p('doppelter Hebel: doppelte Position, Liquidation näher am Kurs', nahe(Math.abs(hebel.ziel), 2 * Math.abs(a.ziel), 1e-6) && hebel.liqNeu > a.liqNeu)
const sl = vergleiche(bot, kerzen, [{ stopLoss: 100 }])
p('Stop-Loss 100 im Fall von 109 auf 83: Ausstieg bei 100, Position 0', sl.varianten[0].ausstieg?.art === 'stopLoss' && nahe(sl.varianten[0].ausstieg.preis, 100, 1e-9) && sl.varianten[0].position === 0)
const gleich = vergleiche(bot, kerzen, [{ unten: bot.grid.unten, oben: bot.grid.oben, anzahl: bot.grid.anzahl, art: 'arithmetic' }])
p('gleiche Einstellung: Ziel ≈ heutige Position (± 1 Zelle)', Math.abs(Math.abs(gleich.abJetzt[0].ziel) - Math.abs(bot.position.menge)) <= bot.grid.mengeJeGrid + 1e-9,
    `${gleich.abJetzt[0].ziel} / ${bot.position.menge}`)

console.log('Grenzen')
p(`höchstens ${MAX_VARIANTEN} Varianten`, vergleiche(bot, kerzen, Array(5).fill({ unten: 75, oben: 150, anzahl: 50 })).varianten.length === MAX_VARIANTEN)
p('Cross-Margin ist nicht simulierbar', vergleiche({ ...bot, typ: 'cross_margin_grid' }, kerzen).fehler === 'typ')
p('ohne Kerzen → Fehlercode', vergleiche(bot, []).fehler === 'kerzen')
const fertig = { ...normalisiereBot(fix.data.results[1]), kurs: null }
const vf = vergleiche(fertig, kerzen.map((k) => ({ ...k, o: k.o / 80, h: k.h / 80, l: k.l / 80, c: k.c / 80 })), [])
p('beendeter Bot: kein „ab jetzt"', vf.abJetzt === null && vf.basis)

console.log(`\n${ok} bestanden, ${fehl} fehlgeschlagen`)
process.exit(fehl ? 1 : 0)
