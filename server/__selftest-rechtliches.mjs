/**
 * Selbsttest für die Lizenztexte und ihre Zustimmung (`server/rechtliches.js`) und
 * dafür, dass THIRD-PARTY-NOTICES zu package-lock.json passt.
 *
 *   node server/__selftest-rechtliches.mjs
 *
 * Warum: der Dialog verlangt eine neue Zustimmung, sobald sich die FASSUNG in LICENSE
 * ändert. Liest der Server sie nicht mehr (Zeile umformuliert), fragt die Software bei
 * jedem Start — oder nie mehr. Und eine neue Abhängigkeit ohne frisch erzeugte
 * THIRD-PARTY-NOTICES wäre eine Lizenzpflicht, die still verletzt wird.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { fassungAus, standAus, zustimmungAus, fassung, text, DOKUMENTE } from './rechtliches.js'
import { produktionsPakete, paketeAusDatei } from '../scripts/drittlizenzen.mjs'

const wurzel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let bestanden = 0
let fehler = 0
function pruefe(name, bedingung, zusatz = '') {
    if (bedingung) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}

console.log('Fassung lesen')
pruefe('Fassung aus Zeile 2', fassungAus('Titel\nFassung 1.2 vom 3. Mai 2027\n')?.fassung === '1.2')
pruefe('Datum dazu', fassungAus('Titel\nFassung 1.2 vom 3. Mai 2027\n')?.datum === '3. Mai 2027')
pruefe('ohne Fassung → null', fassungAus('Titel\nirgendwas') === null)
pruefe('Fassung tief im Text zählt nicht', fassungAus('a\nb\nc\nd\ne\nf\nFassung 9.9 vom heute') === null)
const echt = fassung('lizenz')
pruefe('LICENSE nennt eine Fassung', !!echt?.fassung, JSON.stringify(echt))
for (const name of Object.keys(DOKUMENTE)) {
    let ok = false
    try { ok = text(name).length > 200 } catch { /* fehlt */ }
    pruefe(`${DOKUMENTE[name]} liegt bei`, ok)
}
pruefe('LICENSE ist der AutarkTrade-Text, nicht mehr die GPL', /AutarkTrade Lizenzbedingungen/.test(text('lizenz')) && !/GNU GENERAL PUBLIC LICENSE/.test(text('lizenz').slice(0, 500)))

console.log('Stand')
const a = { fassung: '0.1', datum: 'x' }
pruefe('noch nie zugestimmt → nötig', standAus(null, a).noetig === true)
pruefe('… aber keine „neue Fassung"', standAus(null, a).neueFassung === false)
pruefe('dieselbe Fassung → nicht nötig', standAus({ fassung: '0.1' }, a).noetig === false)
pruefe('andere Fassung → nötig und neu', (() => { const s = standAus({ fassung: '0.0' }, a); return s.noetig && s.neueFassung })())
pruefe('ohne Pflicht nie nötig', standAus(null, a, false).noetig === false)
pruefe('LICENSE ohne Fassung → nötig (lieber fragen als schweigen)', standAus({ fassung: '0.1' }, null).noetig === true)
pruefe('kaputtes JSON → keine Zustimmung', zustimmungAus('{kaputt') === null)
pruefe('JSON ohne Fassung → keine Zustimmung', zustimmungAus('{"zeit":"x"}') === null)

console.log('THIRD-PARTY-NOTICES')
const lock = JSON.parse(fs.readFileSync(path.join(wurzel, 'package-lock.json'), 'utf8'))
const soll = produktionsPakete(lock).map((p) => `${p.name}@${p.version}`)
const ist = paketeAusDatei(fs.readFileSync(path.join(wurzel, 'THIRD-PARTY-NOTICES'), 'utf8'))
const fehlt = soll.filter((x) => !ist.includes(x))
const zuviel = ist.filter((x) => !soll.includes(x))
pruefe('jedes Produktionspaket steht drin (sonst: node scripts/drittlizenzen.mjs)', fehlt.length === 0, fehlt.join(', '))
pruefe('kein Paket zu viel', zuviel.length === 0, zuviel.join(', '))
pruefe('keine Build-Werkzeuge (vite)', !soll.some((x) => x.startsWith('vite@')))
pruefe('sharp/libvips ist nicht mehr dabei', !soll.some((x) => x.startsWith('sharp@') || x.startsWith('@img/')))
const tpn = fs.readFileSync(path.join(wurzel, 'THIRD-PARTY-NOTICES'), 'utf8')
pruefe('NOTICE von Lightweight Charts nachgetragen', tpn.includes('TradingView Lightweight Charts™'))
pruefe('NOTICE von Apache ECharts dabei', tpn.includes('Apache ECharts'))
pruefe('d3-Lizenz aus ECharts dabei', tpn.includes('licenses/LICENSE-d3'))

console.log(`\n${bestanden} bestanden, ${fehler} fehlgeschlagen`)
if (fehler) process.exit(1)
