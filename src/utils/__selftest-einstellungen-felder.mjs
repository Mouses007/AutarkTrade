/**
 * Selbsttest: Einstellungsfelder, die gespeichert werden wollen, kommen auch an.
 *
 * Gefunden am 29.10.2026: Der Lagen-Schalter und sein Symbol riefen
 * `radarSpeichern('…')` mit einem Feld auf, das in der Speichertabelle fehlte
 * (gespeichert wurde `undefined`), und acht Felder der Live-Ansicht hatten
 * weder Spalte noch Whitelist-Eintrag — beides fiel nur auf, weil nach dem
 * Neuladen wieder der alte Wert dastand. Dazu die gemeinsamen Vorgaben
 * (Zeitzone, Kalenderländer) und die Umleitung alter Einstellungsbereiche.
 *
 * Ohne Netz und Datenbank; liest Quelltexte, wo ein Import die DB nachzöge.
 *
 * Aufruf: node src/utils/__selftest-einstellungen-felder.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ZEITZONE_VORGABE, zeitzoneAus, zeitzoneGueltig } from '../../shared/zeitzone.js'
import { kalenderLaenderVorgabe } from '../../shared/kalender-laender.js'
import { ALTE_BEREICHE, EINSTELLUNGS_BEREICHE } from '../router/routen.js'

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const lies = (p) => readFileSync(join(WURZEL, p), 'utf8')

let ok = 0, fehler = 0
const pruefe = (bed, text) => { if (bed) { ok++; console.log('  ✓ ' + text) } else { fehler++; console.log('  ✗ ' + text) } }

function dateien(ordner, endung) {
    const aus = []
    for (const n of readdirSync(join(WURZEL, ordner))) {
        const p = join(ordner, n)
        if (statSync(join(WURZEL, p)).isDirectory()) aus.push(...dateien(p, endung))
        else if (p.endsWith(endung)) aus.push(p)
    }
    return aus
}

console.log('radarSpeichern: jedes Feld steht in der Speichertabelle')
{
    const quelle = lies('src/views/einstellungen/gemeinsam/useRadarEinstellungen.js')
    const tabelle = quelle.slice(quelle.indexOf('const alle = {'), quelle.indexOf('const daten = feld'))
    const inTabelle = new Set([...tabelle.matchAll(/^\s+(\w+):/gm)].map((m) => m[1]))
    const aufrufe = new Set()
    for (const p of [...dateien('src/views', '.vue'), ...dateien('src/components', '.vue')]) {
        for (const m of lies(p).matchAll(/radarSpeichern\('(\w+)'\)/g)) aufrufe.add(m[1])
    }
    pruefe(aufrufe.size > 20, `Aufrufe gefunden (${aufrufe.size})`)
    const fehlt = [...aufrufe].filter((f) => !inTabelle.has(f))
    pruefe(!fehlt.length, `kein Aufruf ohne Eintrag${fehlt.length ? ': ' + fehlt.join(', ') : ''}`)
    pruefe(inTabelle.has('radarNewsLagenAn') && inTabelle.has('radarNewsLagenSymbol'), 'Lagen-Schalter und -Symbol werden gespeichert')
}

console.log('Live-Ansicht: jedes gespeicherte Feld hat Whitelist und Spalte')
{
    const live = lies('src/stores/live.js')
    const block = live.slice(live.indexOf('const FIELDS = {'), live.indexOf('}', live.indexOf('const FIELDS = {')))
    const felder = [...block.matchAll(/\b(live\w+|levMap\w+)\b/g)].map((m) => m[1])
    const routen = lies('server/api-routes.js')
    const valid = routen.slice(routen.indexOf('export const VALID_SETTINGS_KEYS'), routen.indexOf('].filter(', routen.indexOf('export const VALID_SETTINGS_KEYS')))
    const spalten = lies('server/database.js') + lies('server/migrationen/einstellungen-ordnung.js')
    pruefe(felder.length >= 30, `Felder gefunden (${felder.length})`)
    const ohneValid = felder.filter((f) => !valid.includes(`'${f}'`))
    pruefe(!ohneValid.length, `alle in VALID_SETTINGS_KEYS${ohneValid.length ? ' — fehlt: ' + ohneValid.join(', ') : ''}`)
    const ohneSpalte = felder.filter((f) => !spalten.includes(`'settings', '${f}'`))
    pruefe(!ohneSpalte.length, `alle als Spalte angelegt${ohneSpalte.length ? ' — fehlt: ' + ohneSpalte.join(', ') : ''}`)
    pruefe(/'liveFremdBuch', \(t\) => t\.integer\('liveFremdBuch'\)\.nullable\(\)/.test(spalten),
        'liveFremdBuch ohne Vorgabe (leer = der Schalter entscheidet)')
}

console.log('Zeitzone: ein Rückfall')
{
    pruefe(ZEITZONE_VORGABE === 'Europe/Brussels', 'Vorgabe = Spaltenvorgabe')
    pruefe(lies('server/database.js').includes(`t.text('timeZone').defaultTo('${ZEITZONE_VORGABE}')`), 'database.js hat dieselbe Vorgabe')
    pruefe(zeitzoneAus('America/New_York') === 'America/New_York', 'gültige Zone bleibt')
    pruefe(zeitzoneAus('') === ZEITZONE_VORGABE && zeitzoneAus(null) === ZEITZONE_VORGABE, 'leer → Vorgabe')
    pruefe(zeitzoneAus('Mond/Krater') === ZEITZONE_VORGABE && !zeitzoneGueltig('Mond/Krater'), 'unbekannt → Vorgabe')
    // Keine Stelle mehr mit eigenem Rückfall
    const stellen = ['server/esp32-api.js', 'server/chart-ki.js', 'server/ai-agent-tools.js', 'server/benachrichtigungen.js', 'src/utils/journal/app.js']
    for (const p of stellen) {
        pruefe(!/timeZone\s*(\|\||\?\?)\s*'/.test(lies(p)) && !lies(p).includes("'America/New_York'"), `${p}: kein eigener Rückfall`)
    }
}

console.log('Kalenderländer: eine Regel')
{
    pruefe(kalenderLaenderVorgabe(true) === 'USD,JPY', 'Schalter an → USD,JPY (wie S15)')
    pruefe(kalenderLaenderVorgabe(false) === 'USD,EUR', 'Schalter aus → USD,EUR (wie S12)')
    const ui = lies('src/views/einstellungen/gemeinsam/useRadarEinstellungen.js')
    pruefe(ui.includes('kalenderLaenderVorgabe(freigabeAn())') && !ui.includes("|| 'USD,JPY'"), 'Einstellungsseite nutzt dieselbe Regel')
}

console.log('Alte Einstellungsbereiche führen zum heutigen Ort')
{
    const kiIds = [...lies('src/views/einstellungen/gemeinsam/useKiBereich.js').matchAll(/\{ id: '(\w+)'/g)].map((m) => m[1])
    for (const [alt, ziel] of Object.entries(ALTE_BEREICHE)) {
        pruefe(EINSTELLUNGS_BEREICHE.includes(ziel.bereich) && (!ziel.ki || kiIds.includes(ziel.ki)) && !EINSTELLUNGS_BEREICHE.includes(alt),
            `${alt} → ${ziel.bereich}${ziel.ki ? ' › ' + ziel.ki : ''}`)
    }
    pruefe(ALTE_BEREICHE.esp32?.bereich === 'geraete' && ALTE_BEREICHE.agent?.ki === 'agent', 'esp32 → Geräte, agent → KI › Agent')
}

console.log(`einstellungen-felder: ${ok} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler ? 1 : 0)
