/**
 * Selbsttest: jeder Abmelde-Weg setzt den Merker gegen den YubiKey-Autostart.
 *
 *   node src/utils/__selftest-abmelden.mjs
 *
 * Die Login-Seite fragt unter einer YubiKey-fähigen Adresse beim Öffnen
 * sofort nach dem Schlüssel — nur nicht direkt nach einem Abmelden
 * (`merkeAbmeldung`/`frischAbgemeldet` in `src/utils/webauthn.js`). Sonst
 * meldet ein Antippen gleich wieder an, kaum dass man sich abgemeldet hat.
 * „Überall abmelden" in Einstellungen › Sicherheit hatte den Merker vergessen
 * (Audit 4.3.4 FUN-S1-005), Kopfleiste und „Abmelden" nicht.
 *
 * Geprüft wird im Quelltext: jede Stelle, die `/api/logout` oder
 * `/api/auth/ueberall-abmelden` aufruft, ruft vor dem nächsten
 * `location.reload()` `merkeAbmeldung()` auf. Die Gegenprobe stellt sicher,
 * dass die Suche die Abmelde-Wege überhaupt findet.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let bestanden = 0
let fehlgeschlagen = 0
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

function dateien(ordner) {
    const aus = []
    for (const e of fs.readdirSync(ordner, { withFileTypes: true })) {
        const p = path.join(ordner, e.name)
        if (e.isDirectory()) aus.push(...dateien(p))
        else if (/\.(vue|js)$/.test(e.name) && !e.name.startsWith('__selftest')) aus.push(p)
    }
    return aus
}

const ABMELDEN = /['"`]\/api\/(logout|auth\/ueberall-abmelden)['"`]/g
const fundstellen = []
for (const datei of dateien(SRC)) {
    const text = fs.readFileSync(datei, 'utf8')
    for (const m of text.matchAll(ABMELDEN)) {
        const rest = text.slice(m.index)
        const neuladen = rest.search(/location\.reload\(\)/)
        const bis = neuladen < 0 ? rest : rest.slice(0, neuladen)
        fundstellen.push({ datei: path.relative(SRC, datei), weg: m[1], merker: /merkeAbmeldung\(\)/.test(bis), neuladen: neuladen >= 0 })
    }
}

console.log('\nAbmelde-Wege setzen den Merker\n')
check('Gegenprobe: Abmelden und „Überall abmelden" werden gefunden',
    fundstellen.some((f) => f.weg === 'logout') && fundstellen.some((f) => f.weg === 'auth/ueberall-abmelden'),
    JSON.stringify(fundstellen))
for (const f of fundstellen) {
    if (!f.neuladen) continue   // ohne Neuladen bleibt die Seite stehen, die Login-Seite startet nicht
    check(`${f.datei}: /api/${f.weg} → merkeAbmeldung() vor dem Neuladen`, f.merker)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
process.exit(fehlgeschlagen ? 1 : 0)
