/**
 * Zeichnet das Logo von AutarkTrade und alle Dateien, die daraus entstehen.
 *
 *   node scripts/logo-zeichnen.mjs
 *
 * Das Zeichen folgt AutarkDarts: eine fünfblättrige Blüte im Kreis. Wo dort
 * die Dartscheibe steht, steht hier ein KURSRING — 30 Kerzen, radial um die
 * Blüte gelegt, deren Lage einem Kursverlauf folgt (ein Aufwärtstrend mit
 * Rücksetzern, der sich einmal um den Kreis schliesst). Die Kerzen sind grau
 * wie die Drähte der Scheibe; Farbe trägt allein die Blüte.
 *
 * Erzeugt:
 *   src/assets/design/logo-zeichen.svg   Zeichen ohne Schrift (für Logo.vue)
 *   public/favicon.svg                   vereinfacht (weniger Kerzen, dicker)
 *   public/favicon-32.png, public/apple-touch-icon.png, public/icon-512.png
 *   src/assets/icon.png, src/assets/favicon.png  (Mail-Logo, Share-Card, Setup)
 *
 * Von Hand gezeichnet, keine Vorlage — die Blütenform ist eine eigene Kurve.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

const wurzel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const r1 = (x) => Math.round(x * 100) / 100

const FARBE = {
    draht: '#5d6f78',
    drahtLeise: '#3a4a52',
    blatt1: '#5cf0e0',
    blatt2: '#1fd6c4',
    blatt3: '#0c7f74',
    kern: '#04201d',
    akzent: '#1fd6c4',
}

/** Deterministischer Kursverlauf: Trend + zwei Wellen, Ende = Anfang. */
function kurs(n) {
    const werte = []
    for (let i = 0; i < n; i++) {
        const t = i / n
        const welle = Math.sin(t * Math.PI * 6) * 0.55 + Math.sin(t * Math.PI * 14 + 1) * 0.3
        // Dreieck statt Rampe, damit der Ring sich schliesst
        const trend = (t < 0.7 ? t / 0.7 : (1 - t) / 0.3) * 1.2
        werte.push(welle + trend)
    }
    return werte
}

function kerzenRing({ n, rMitte, spanne, breite, strich, koerperMin, koerperMax }) {
    const k = kurs(n + 1)
    const min = Math.min(...k), max = Math.max(...k)
    const norm = (v) => (v - min) / (max - min) - 0.5   // −0.5 … 0.5
    const schritte = k.slice(1).map((v, i) => Math.abs(v - k[i]))
    const sMax = Math.max(...schritte)
    const teile = []
    for (let i = 0; i < n; i++) {
        const auf = k[i + 1] >= k[i]
        // Lage der Kerze: Mitte zwischen Eröffnung und Schluss
        const mitte = rMitte + norm((k[i] + k[i + 1]) / 2) * spanne
        const koerper = koerperMin + (schritte[i] / sMax) * (koerperMax - koerperMin)
        const docht = koerper * 0.45 + 2
        const winkel = (360 / n) * i
        // Lokale Koordinaten: Kerze zeigt nach oben, Ursprung = Kreismitte
        const y0 = -(mitte + koerper / 2), y1 = -(mitte - koerper / 2)
        const rect = auf
            ? `<rect x="${r1(-breite / 2)}" y="${r1(y0)}" width="${r1(breite)}" height="${r1(koerper)}" rx="${r1(breite * 0.18)}" fill="none" stroke="${FARBE.draht}" stroke-width="${strich}"/>`
            : `<rect x="${r1(-breite / 2)}" y="${r1(y0)}" width="${r1(breite)}" height="${r1(koerper)}" rx="${r1(breite * 0.18)}" fill="${FARBE.draht}"/>`
        teile.push(`<g transform="rotate(${r1(winkel)})">`
            + `<line x1="0" y1="${r1(y0 - docht)}" x2="0" y2="${r1(y0)}" stroke="${FARBE.draht}" stroke-width="${strich}"/>`
            + `<line x1="0" y1="${r1(y1)}" x2="0" y2="${r1(y1 + docht)}" stroke="${FARBE.draht}" stroke-width="${strich}"/>`
            + rect + `</g>`)
    }
    return teile.join('')
}

/** Ein Blütenblatt, Spitze aussen, Ansatz in der Mitte (lokal: nach oben). */
function blatt(l) {
    const s = l / 30
    const p = (x, y) => `${r1(x * s)},${r1(y * s)}`
    return `M${p(0, -4)} C${p(-7, -8)} ${p(-12, -20)} ${p(-9, -27)} C${p(-6, -32)} ${p(-1.5, -32)} ${p(0, -29)} C${p(1.5, -32)} ${p(6, -32)} ${p(9, -27)} C${p(12, -20)} ${p(7, -8)} ${p(0, -4)} Z`
}

function bluete(l, kernR) {
    const blaetter = []
    for (let i = 0; i < 5; i++) {
        blaetter.push(`<path d="${blatt(l)}" transform="rotate(${i * 72})" fill="url(#atBlatt)"/>`)
    }
    return blaetter.join('')
        + `<circle r="${kernR}" fill="${FARBE.kern}" stroke="${FARBE.akzent}" stroke-width="${r1(kernR * 0.28)}"/>`
}

function defs() {
    return `<defs><radialGradient id="atBlatt" cx="0" cy="0" r="34" gradientUnits="userSpaceOnUse">`
        + `<stop offset="0.15" stop-color="${FARBE.blatt1}"/><stop offset="0.6" stop-color="${FARBE.blatt2}"/>`
        + `<stop offset="1" stop-color="${FARBE.blatt3}"/></radialGradient></defs>`
}

function zeichen({ einfach = false } = {}) {
    // viewBox −100 … 100, Mitte im Ursprung
    const ring = einfach
        ? kerzenRing({ n: 12, rMitte: 70, spanne: 14, breite: 11, strich: 5, koerperMin: 12, koerperMax: 20 })
        : kerzenRing({ n: 28, rMitte: 74, spanne: 14, breite: 6.5, strich: 1.8, koerperMin: 6, koerperMax: 15 })
    const kreise = einfach
        ? `<circle r="95" fill="none" stroke="${FARBE.draht}" stroke-width="6"/>`
        : `<circle r="96" fill="none" stroke="${FARBE.draht}" stroke-width="2.4"/>`
          + `<circle r="54" fill="none" stroke="${FARBE.drahtLeise}" stroke-width="1.6"/>`
    const blume = einfach ? bluete(48, 7) : bluete(44, 5.5)
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-100 -100 200 200" role="img" aria-label="AutarkTrade">`
        + defs() + kreise + ring + blume + `</svg>\n`
}

const ziel = (...t) => path.join(wurzel, ...t)
fs.mkdirSync(ziel('public'), { recursive: true })
fs.mkdirSync(ziel('src/assets/design'), { recursive: true })

const voll = zeichen()
const einfach = zeichen({ einfach: true })
fs.writeFileSync(ziel('src/assets/design/logo-zeichen.svg'), voll)
fs.writeFileSync(ziel('public/favicon.svg'), einfach)

/** PNG mit dunklem Grund (Apple-Icon, Mail) oder durchsichtig (Favicon). */
async function png(svg, groesse, datei, { grund = null, rand = 0 } = {}) {
    const innen = Math.round(groesse * (1 - 2 * rand))
    let bild = sharp(Buffer.from(svg), { density: 600 }).resize(innen, innen)
    const puffer = await bild.png().toBuffer()
    const leinwand = sharp({
        create: { width: groesse, height: groesse, channels: 4, background: grund || { r: 0, g: 0, b: 0, alpha: 0 } },
    })
    const off = Math.round((groesse - innen) / 2)
    await leinwand.composite([{ input: puffer, left: off, top: off }]).png().toFile(datei)
}

const DUNKEL = { r: 5, g: 8, b: 10, alpha: 1 }
await png(einfach, 32, ziel('public/favicon-32.png'))
await png(einfach, 180, ziel('public/apple-touch-icon.png'), { grund: DUNKEL, rand: 0.08 })
await png(voll, 512, ziel('public/icon-512.png'), { grund: DUNKEL, rand: 0.06 })
await png(voll, 256, ziel('src/assets/icon.png'), { grund: DUNKEL, rand: 0.06 })
await png(einfach, 64, ziel('src/assets/favicon.png'))
console.log('Logo gezeichnet:', 'logo-zeichen.svg, favicon.svg, 5 PNG')
