/**
 * Lade-Haken für `__selftest-bot-steuerung-routen.mjs`: ersetzt in
 * `steuerung-routen.js` genau drei Module durch Attrappen, alles andere bleibt
 * echt (Datenbank, Token, Einwilligung, Bausteine):
 *
 *   - `../pionex-transport.js`        → `pionexRequest` aus `globalThis.__botTest.pionex`
 *   - `./routen.js`                   → `holeBot`/`holeLaufendeBots` mit festem Bot
 *   - `../execution/pionex-meta.js`   → feste Symboltabelle
 *
 * Keine `__selftest`-Datei, damit der Läufer sie nicht als Test startet.
 */
const ATTRAPPEN = {
    'attrappe:transport': `
        export async function pionexRequest(method, pfad, k, s, params, body) {
            return globalThis.__botTest.pionex(method, pfad, body)
        }
        export const BASE_URL = 'https://attrappe'
    `,
    'attrappe:routen': `
        export async function holeBot(id) { const b = globalThis.__botTest.bot; return b && b.id === id ? { ...b } : null }
        export async function holeLaufendeBots() { return [{ ...globalThis.__botTest.bot }] }
        export function vergesseBot() { globalThis.__botTest.vergessen = (globalThis.__botTest.vergessen || 0) + 1 }
    `,
    'attrappe:meta': `
        export async function holeSymbolTabelle() { return [{ symbol: 'USDT_SOL_PERP', quotePrecision: 7 }] }
    `,
}

export async function resolve(spez, kontext, weiter) {
    if (kontext.parentURL?.endsWith('/server/bots/steuerung-routen.js')) {
        if (spez === '../pionex-transport.js') return { url: 'attrappe:transport', shortCircuit: true }
        if (spez === './routen.js') return { url: 'attrappe:routen', shortCircuit: true }
        if (spez === '../execution/pionex-meta.js') return { url: 'attrappe:meta', shortCircuit: true }
    }
    return weiter(spez, kontext)
}

export async function load(url, kontext, weiter) {
    if (ATTRAPPEN[url]) return { format: 'module', source: ATTRAPPEN[url], shortCircuit: true }
    return weiter(url, kontext)
}
