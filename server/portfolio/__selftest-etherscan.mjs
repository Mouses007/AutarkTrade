/**
 * Selbsttest Etherscan-Blättern (Audit FUN-PRT-002, 26.10.2026), mit
 * nachgebautem `fetch` — kein Netz, kein Schlüssel.
 *
 *   node server/portfolio/__selftest-etherscan.mjs
 *
 * Was hier still danebengehen würde:
 *   - eine feste Obergrenze `endblock` (bis 26.10.2026: 99 999 999) schneidet
 *     Arbitrum/Optimism ab, die längst darüber sind;
 *   - eine volle Seite ohne Weiterblättern verliert die neuesten Zeilen;
 *   - weiterblättern ab „letzter Block + 1“ verliert den Rest eines Blocks,
 *     in dem die Seite endete; ab „letzter Block“ ohne Abgleich doppelt;
 *   - greift die Seitengrenze, muss das gesagt werden (`abgeschnitten`).
 */
import { etherscanAlle } from './quellen.js'

let bestanden = 0, fehlgeschlagen = 0
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

/** Nachgebautes Etherscan: filtert nach startblock/endblock, sortiert aufsteigend, liefert `offset` Zeilen. */
let aufrufe = []
function etherscanAttrappe(zeilen) {
    aufrufe = []
    globalThis.fetch = async (url) => {
        const q = new URL(url).searchParams
        aufrufe.push(Object.fromEntries(q))
        const start = Number(q.get('startblock')), ende = Number(q.get('endblock')), offset = Number(q.get('offset'))
        const treffer = zeilen.filter((z) => Number(z.blockNumber) >= start && Number(z.blockNumber) <= ende).slice(0, offset)
        const d = treffer.length ? { status: '1', message: 'OK', result: treffer } : { status: '0', message: 'No transactions found', result: [] }
        return { ok: true, status: 200, json: async () => d }
    }
}
const zeile = (block, i) => ({ blockNumber: String(block), hash: `0x${block}-${i}`, from: '0xa', to: '0xb', value: String(i) })

console.log('\nEtherscan blättern')
{
    // Arbitrum-Blöcke über 100 Mio., eine Seite endet mitten in Block 150000003.
    const b = [150000001, 150000002, 150000003, 150000003, 150000004, 150000005, 150000006]
    etherscanAttrappe(b.map(zeile))
    const r = await etherscanAlle('k', 42161, { module: 'account', action: 'txlist', address: '0xa' }, { seite: 3, maxSeiten: 10 })
    check('alle 7 Zeilen, keine doppelt', r.zeilen.length === 7 && new Set(r.zeilen.map((z) => z.hash)).size === 7, r.zeilen.map((z) => z.hash).join(','))
    check('aufsteigend', r.zeilen.every((z, i) => i === 0 || Number(z.blockNumber) >= Number(r.zeilen[i - 1].blockNumber)))
    check('nicht abgeschnitten', r.abgeschnitten === false)
    check('Blöcke über 99 999 999 kommen an (keine feste Obergrenze)', aufrufe.every((a) => Number(a.endblock) >= 9999999999))
    check('nächste Seite beginnt beim letzten Block der vollen Seite', aufrufe[1]?.startblock === '150000003', JSON.stringify(aufrufe.map((a) => a.startblock)))
}
{
    const b = Array.from({ length: 20 }, (_, i) => 100 + i)
    etherscanAttrappe(b.map(zeile))
    const r = await etherscanAlle('k', 1, { action: 'tokentx' }, { seite: 4, maxSeiten: 2 })
    check('Seiten-Obergrenze greift → abgeschnitten', r.abgeschnitten === true && r.seiten === 2)
    check('bis dahin gelesene Zeilen bleiben', r.zeilen.length > 0 && r.zeilen.length < 20)
}
{
    // Eine volle Seite, alles in EINEM Block: weiterblättern unmöglich → abgeschnitten, nichts verloren.
    etherscanAttrappe([zeile(7, 1), zeile(7, 2), zeile(7, 3), zeile(7, 4)])
    const r = await etherscanAlle('k', 1, { action: 'txlist' }, { seite: 3, maxSeiten: 10 })
    check('ganze Seite in einem Block → abgeschnitten, Zeilen behalten', r.abgeschnitten === true && r.zeilen.length === 3)
}
{
    etherscanAttrappe([])
    const r = await etherscanAlle('k', 1, { action: 'txlistinternal' }, { seite: 3 })
    check('keine Transaktionen: leer, vollständig', r.zeilen.length === 0 && r.abgeschnitten === false && aufrufe.length === 1)
}
{
    // Genau eine volle Seite: die letzte Abfrage bringt den letzten Block noch einmal, ohne Doppel.
    etherscanAttrappe([zeile(1, 1), zeile(2, 2), zeile(3, 3)])
    const r = await etherscanAlle('k', 1, { action: 'txlist' }, { seite: 3 })
    check('volle Seite am Ende: 3 Zeilen, nicht doppelt', r.zeilen.length === 3 && r.abgeschnitten === false, r.zeilen.map((z) => z.hash).join(','))
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
process.exit(fehlgeschlagen ? 1 : 0)
