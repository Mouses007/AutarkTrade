/**
 * Selbsttest: Fremdbücher der Buch-Leiter (`fremdbuch.js`) je Stand des
 * Schalters „Quellen ohne Verkaufsfreigabe" (S15).
 *
 *   aus  nur Bybit, und KEIN Abruf an okx.com (Stand S12, Verkaufs-Prüfung Z. 38)
 *   an   Bybit + OKX wie vor S12; OKX-Mengen in Kontrakten × ctVal
 *
 * Ohne Netz: axios ist attrappiert.
 * Aufruf: node server/__selftest-fremdbuch.mjs
 */
import axios from 'axios'
import { holeFremdbuecher } from './fremdbuch.js'
import { _setzeLeser } from './quellen/freigabe.js'

let bestanden = 0
let fehler = 0
const pruefe = (name, ok, zusatz = '') => {
    if (ok) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}

const abrufe = []
axios.get = async (url) => {
    abrufe.push(url)
    if (url.includes('api.bybit.com')) {
        return { data: { result: { b: [['99.9', '2']], a: [['100.1', '3']] } } }
    }
    if (url.includes('okx.com/api/v5/public/instruments')) return { data: { data: [{ ctVal: '0.01' }] } }
    if (url.includes('okx.com/api/v5/market/books')) {
        return { data: { data: [{ bids: [['99.8', '100']], asks: [['100.2', '200']] }] } }
    }
    throw new Error('unerwartete Adresse ' + url)
}

console.log('Fremdbuch je Schalterstand')

_setzeLeser(async () => false)
{
    const d = await holeFremdbuecher('AAAUSDT', 100)
    pruefe('aus: nur Bybit', d.boersen.map((b) => b.name).join() === 'Bybit', d.boersen.map((b) => b.name).join())
    pruefe('aus: kein Abruf an okx.com', !abrufe.some((u) => u.includes('okx.com')), abrufe.join(', '))
}

// Der Zwischenspeicher hält 5 s je Symbol — darum ein anderes Symbol.
_setzeLeser(async () => true)
{
    abrufe.length = 0
    const d = await holeFremdbuecher('BBBUSDT', 100)
    pruefe('an: Bybit + OKX (wie vor S12)', d.boersen.map((b) => b.name).sort().join() === 'Bybit,OKX', d.boersen.map((b) => b.name).join())
    const okx = d.boersen.find((b) => b.name === 'OKX')
    pruefe('an: OKX in Coins (Kontrakte × ctVal)', okx?.bids?.[0]?.[1] === 1 && okx?.asks?.[0]?.[1] === 2, JSON.stringify(okx?.bids))
    pruefe('an: OKX wird gefragt', abrufe.some((u) => u.includes('okx.com/api/v5/market/books')))
}

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
if (fehler) process.exit(1)
