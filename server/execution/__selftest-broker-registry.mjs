/**
 * Selbsttest der Broker-Registry — ohne Netz, ohne Datenbank.
 *
 *   node server/execution/__selftest-broker-registry.mjs
 *
 * Seit S13 rechnet die Registry nur noch für Papier- und Schattenbetrieb
 * (der scharfe Handel liegt auf `spaeter/scharfer-handel`). Zwei Dinge sollen
 * hier knallen:
 *
 * 1. Ein unbekannter Broker-Name, der still auf Bitunix zurückfällt.
 * 2. Ein Order-Verb, das wieder auftaucht — in der Registry oder irgendwo im
 *    Server. Der Rückbau soll eine Entscheidung sein, kein Versehen.
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { holeAdapter, holeAdapterListe, kenntBroker } from './index.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}
function wirft(fn) { try { fn(); return false } catch { return true } }

const ORDER_VERBEN = ['baueOrder', 'openLivePosition', 'closeLivePosition', 'getLiveEquity',
    'getLivePositionId', 'setzeZiel', 'bereiteSymbolVor', 'holeOffenePositionen']

console.log('\nKeine Order-Funktionen\n')
{
    const liste = holeAdapterListe()
    check('bitunix und pionex registriert', liste.length === 2, String(liste.length))
    for (const eintrag of liste) {
        const a = holeAdapter(eintrag.id)
        const da = ORDER_VERBEN.filter((fn) => typeof a[fn] === 'function')
        check(`${eintrag.id}: kein Order-Verb`, da.length === 0, da.join(', '))
        check(`${eintrag.id}: orderMeta ist beantwortet`, typeof eintrag.faehigkeiten.orderMeta === 'boolean')
    }
}

console.log('\nAuflösung\n')
{
    check('bitunix auflösbar', holeAdapter('bitunix').id === 'bitunix')
    check('pionex auflösbar', holeAdapter('pionex').id === 'pionex')
    check('Grossschreibung und Leerraum stören nicht', holeAdapter('  PIONEX ').id === 'pionex')
    check('leerer Broker ist Altbestand → bitunix', holeAdapter('').id === 'bitunix')
    check('null ebenso', holeAdapter(null).id === 'bitunix')
    check('unbekannter Broker WIRFT, statt auf bitunix zu fallen', wirft(() => holeAdapter('binance')))
    check('Tippfehler wirft ebenfalls', wirft(() => holeAdapter('pionx')))
    check('die Fehlermeldung nennt die bekannten Broker', (() => {
        try { holeAdapter('quatsch'); return false } catch (e) {
            return e.message.includes('bitunix') && e.message.includes('pionex')
        }
    })())
    check('kenntBroker antwortet ohne zu werfen', kenntBroker('pionex') === true && kenntBroker('binance') === false)
}

console.log('\nKein Order-Endpunkt im Server\n')
{
    // Die Order-Pfade der beiden Börsen, an die der scharfe Handel sendete.
    // Lesende Pfade (`/trade/fills`, `get_history_trades`, `get_pending_orders`)
    // bleiben erlaubt — der Journal-Import braucht sie.
    const VERBOTEN = [
        /futures\/trade\/place_order/, /flash_close_position/, /trade\/cancel_order/,
        /\/uapi\/v1\/trade\/order\b/, /orderByClientOrderId/, /trade\/isolatedMode/,
        /tpsl\/place_order/, /close_all_position/,
    ]
    const hier = path.dirname(fileURLToPath(import.meta.url))
    const wurzel = path.resolve(hier, '..', '..')
    const treffer = []
    const laufe = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name)
            if (e.isDirectory()) { if (!['node_modules', 'fixtures'].includes(e.name)) laufe(p) }
            else if (/\.(m?js)$/.test(e.name) && !e.name.startsWith('__selftest')) {
                const text = fs.readFileSync(p, 'utf8')
                for (const re of VERBOTEN) if (re.test(text)) treffer.push(`${path.relative(wurzel, p)} ${re}`)
            }
        }
    }
    laufe(path.join(wurzel, 'server'))
    laufe(path.join(wurzel, 'shared'))
    laufe(path.join(wurzel, 'scripts'))
    for (const f of ['index.mjs']) {
        const text = fs.readFileSync(path.join(wurzel, f), 'utf8')
        for (const re of VERBOTEN) if (re.test(text)) treffer.push(`${f} ${re}`)
    }
    check('kein Order-Pfad von Bitunix/Pionex in Server und Skripten', treffer.length === 0, treffer.join('; '))
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
