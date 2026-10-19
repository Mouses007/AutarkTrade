#!/usr/bin/env node
/**
 * THIRD-PARTY-NOTICES aus den Paketlizenzen erzeugen (S10, VERKAUFS-PRUEFUNG.md 3.2).
 *
 *   node scripts/drittlizenzen.mjs            # schreibt THIRD-PARTY-NOTICES
 *   node scripts/drittlizenzen.mjs --pruefen  # bricht ab, wenn die Datei nicht mehr passt
 *
 * Grundlage ist `package-lock.json`: jedes Paket, das NICHT nur zur Entwicklung dient
 * (`dev`/`devOptional`), also alles, was im Container-Image (`npm prune --omit=dev`) und
 * im gebauten Frontend landet. Je Paket: Name, Fassung, Lizenzangabe und die
 * Lizenzdateien aus `node_modules` (LICENSE*, LICENCE*, COPYING*, NOTICE*, dazu ein
 * Ordner `licenses/` wie bei ECharts für d3). Gleiche Texte stehen einmal, die übrigen
 * Pakete verweisen darauf — Apache-2.0 käme sonst achtzehnmal.
 *
 * Nachgetragen werden Pflichttexte, die nicht als Datei im Paket liegen: der
 * NOTICE-Text von TradingView Lightweight Charts steht nur in dessen README
 * (Abschnitt „License") und ist laut Apache-2.0 §4(d) samt Link mitzuliefern.
 *
 * Läuft auch im Docker-Build (nach `npm ci`), damit das Image die Texte der Pakete
 * trägt, die wirklich darin sind. `--pruefen` vergleicht nur Paketliste und Fassungen
 * (nicht den Wortlaut) und braucht kein `node_modules` — so läuft es als Selbsttest.
 */
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ZIEL = path.join(WURZEL, 'THIRD-PARTY-NOTICES')
const LIZENZDATEI = /^(licen[cs]e|copying|notice)([.-].*)?$/i

/** Pflichttexte ausserhalb der Paketdateien, je Paketname. */
export const NACHTRAEGE = {
    'lightweight-charts': [
        'NOTICE (aus README.md, Abschnitt "License" — Apache-2.0 §4(d)):',
        '',
        'TradingView Lightweight Charts™',
        'Copyright (с) 2025 TradingView, Inc. https://www.tradingview.com/',
        '',
        'This license requires specifying TradingView as the product creator. In',
        'AutarkTrade: the attribution logo in every chart (attributionLogo: true) links',
        'to https://www.tradingview.com/, and this notice is shown under Legal.',
        '',
        'Lightweight Charts incorporates parts of tslib (https://github.com/Microsoft/tslib,',
        '(c) Microsoft Corporation), covered by the BSD Zero Clause License.',
    ].join('\n'),
}

/** Produktionspakete aus dem Lockfile: [{name, version, license, ort}] sortiert. */
export function produktionsPakete(lock) {
    const pakete = []
    for (const [ort, p] of Object.entries(lock.packages || {})) {
        if (!ort || p.dev || p.devOptional || p.link) continue
        const name = p.name || ort.slice(ort.lastIndexOf('node_modules/') + 'node_modules/'.length)
        pakete.push({ name, version: p.version || '?', license: lizenzText(p.license), ort })
    }
    // Dasselbe Paket in derselben Fassung an zwei Orten (verschachtelt) nur einmal.
    const gesehen = new Set()
    return pakete
        .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
        .filter((p) => { const k = `${p.name}@${p.version}`; if (gesehen.has(k)) return false; gesehen.add(k); return true })
}

function lizenzText(l) {
    if (!l) return 'UNBEKANNT'
    if (typeof l === 'string') return l
    if (Array.isArray(l)) return l.map(lizenzText).join(' OR ')
    return l.type || 'UNBEKANNT'
}

function lizenzDateien(ordner) {
    let eintraege = []
    try { eintraege = fs.readdirSync(ordner, { withFileTypes: true }) } catch { return [] }
    const dateien = eintraege
        .filter((e) => e.isFile() && LIZENZDATEI.test(e.name) && !/\.(js|ts|json|html)$/i.test(e.name))
        .map((e) => path.join(ordner, e.name))
    const unter = eintraege.find((e) => e.isDirectory() && /^licen[cs]es$/i.test(e.name))
    if (unter) {
        for (const f of fs.readdirSync(path.join(ordner, unter.name), { withFileTypes: true })) {
            if (f.isFile()) dateien.push(path.join(ordner, unter.name, f.name))
        }
    }
    return dateien.sort()
}

function kopf(pakete) {
    const zaehler = {}
    for (const p of pakete) zaehler[p.license] = (zaehler[p.license] || 0) + 1
    const liste = Object.entries(zaehler).sort((a, b) => b[1] - a[1]).map(([l, n]) => `${n} ${l}`).join(', ')
    return [
        'AutarkTrade – THIRD-PARTY-NOTICES',
        '',
        'AutarkTrade enthält die folgenden fremden Pakete. Jedes steht unter seiner eigenen',
        'Lizenz, und die geht für dieses Paket vor (Ziffer 12 der Lizenzbedingungen). Die',
        'Liste umfasst alles, was im gebauten Frontend und im Server (Container-Image) landet;',
        'Werkzeuge, die nur zum Bauen dienen, fehlen. Herkunft, Begleitprogramme und das',
        'Betriebssystem des Container-Images: NOTICE.md.',
        '',
        'Erzeugt von scripts/drittlizenzen.mjs aus package-lock.json und den Lizenzdateien',
        'der Pakete. Nicht von Hand bearbeiten.',
        '',
        `${pakete.length} Pakete: ${liste}`,
        '',
        '=' .repeat(80),
        'ÜBERSICHT',
        '='.repeat(80),
        '',
        ...pakete.map((p) => `${p.name}@${p.version}  —  ${p.license}`),
        '',
    ]
}

/** Lizenzangabe aus dem installierten package.json — das Lockfile trägt sie nicht immer. */
function installierteLizenz(modulWurzel, ort, rueckfall) {
    try {
        const pj = JSON.parse(fs.readFileSync(path.join(modulWurzel, ort, 'package.json'), 'utf8'))
        const l = pj.license ?? pj.licenses
        return l ? lizenzText(l) : rueckfall
    } catch {
        return rueckfall
    }
}

export function erzeuge(lock, modulWurzel = WURZEL) {
    const pakete = produktionsPakete(lock).map((p) => ({ ...p, license: installierteLizenz(modulWurzel, p.ort, p.license) }))
    const zeilen = kopf(pakete)
    const textErstesPaket = new Map() // sha → name@version
    const fehlend = []
    for (const p of pakete) {
        zeilen.push('='.repeat(80), `${p.name}@${p.version}`, `Lizenz: ${p.license}`, '='.repeat(80), '')
        const dateien = lizenzDateien(path.join(modulWurzel, p.ort))
        if (!dateien.length && !NACHTRAEGE[p.name]) fehlend.push(`${p.name}@${p.version}`)
        if (!dateien.length) zeilen.push(`(Das Paket bringt keine Lizenzdatei mit; massgebend ist die Angabe "${p.license}" in seinem package.json.)`, '')
        for (const datei of dateien) {
            const inhalt = fs.readFileSync(datei, 'utf8').replace(/\r\n/g, '\n').trim()
            const sha = crypto.createHash('sha256').update(inhalt).digest('hex')
            const name = path.relative(path.join(modulWurzel, p.ort), datei)
            if (textErstesPaket.has(sha)) {
                zeilen.push(`${name}: gleicher Wortlaut wie bei ${textErstesPaket.get(sha)} (oben).`, '')
                continue
            }
            textErstesPaket.set(sha, `${p.name}@${p.version}, ${name}`)
            zeilen.push(`--- ${name} ---`, '', inhalt, '')
        }
        if (NACHTRAEGE[p.name]) zeilen.push(`--- Nachtrag ---`, '', NACHTRAEGE[p.name], '')
    }
    return { text: zeilen.join('\n') + '\n', pakete, fehlend }
}

/** Paketliste aus einer bestehenden Datei (Abschnitt ÜBERSICHT). */
export function paketeAusDatei(text) {
    const teil = text.split('ÜBERSICHT')[1] || ''
    const bis = teil.indexOf('\n' + '='.repeat(80) + '\n', 90)
    return (bis > 0 ? teil.slice(0, bis) : teil)
        .split('\n')
        .map((z) => /^(\S+@[^\s]+)\s+—\s+/.exec(z)?.[1])
        .filter(Boolean)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const lock = JSON.parse(fs.readFileSync(path.join(WURZEL, 'package-lock.json'), 'utf8'))
    if (process.argv.includes('--pruefen')) {
        const soll = produktionsPakete(lock).map((p) => `${p.name}@${p.version}`)
        let ist = []
        try { ist = paketeAusDatei(fs.readFileSync(ZIEL, 'utf8')) } catch { /* fehlt */ }
        const fehlt = soll.filter((x) => !ist.includes(x))
        const zuviel = ist.filter((x) => !soll.includes(x))
        if (fehlt.length || zuviel.length) {
            console.error('THIRD-PARTY-NOTICES passt nicht zu package-lock.json — node scripts/drittlizenzen.mjs laufen lassen.')
            if (fehlt.length) console.error('  fehlt: ' + fehlt.join(', '))
            if (zuviel.length) console.error('  zu viel: ' + zuviel.join(', '))
            process.exit(1)
        }
        console.log(`THIRD-PARTY-NOTICES passt (${soll.length} Pakete).`)
        process.exit(0)
    }
    if (!fs.existsSync(path.join(WURZEL, 'node_modules'))) {
        console.error('node_modules fehlt — erst npm ci.')
        process.exit(1)
    }
    const { text, pakete, fehlend } = erzeuge(lock)
    fs.writeFileSync(ZIEL, text)
    console.log(`THIRD-PARTY-NOTICES: ${pakete.length} Pakete, ${(text.length / 1024).toFixed(0)} KB.`)
    if (fehlend.length) console.log(`Ohne Lizenzdatei (nur package.json-Angabe): ${fehlend.join(', ')}`)
}
