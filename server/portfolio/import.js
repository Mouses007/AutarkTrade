/**
 * Spot-Portfolio: Datei-Import (rein, selbstgetestet).
 *
 * Für Orte ohne API — geschlossene Konten (Crypto.com, KuCoin), Wallets ohne
 * Explorer-Schlüssel, Rekonstruktionen aus Steuerreports. Eine Datei, ein
 * Format, dieselbe Vorzeichen-Regel wie `normal.js`:
 *
 *   externe_id;datum_utc;ort;art;asset;menge;gegen_asset;gegen_menge;
 *   gebuehr_asset;gebuehr_menge;chf_wert;txhash;kette;kontrakt;
 *   einordnung;sicherheit;notiz
 *
 * `;`-getrennt, Punkt als Dezimaltrenner. Jede Zeile wird geprüft; eine
 * fehlerhafte wird NICHT still übergangen, sondern mit Zeilennummer und Grund
 * gemeldet — der Import bricht dann ab, statt halb zu buchen.
 *
 * Art `bestand` = Eröffnungsbestand eines Orts ohne Historie (zählt wie eine
 * Einzahlung, ist aber keine und erscheint nicht in der Prüfliste).
 */

import { ARTEN } from './normal.js'

export const IMPORT_ARTEN = ARTEN
export const EINORDNUNGEN = ['transfer', 'kauf', 'einkommen', 'ignorieren']
export const SICHERHEITEN = ['beleg', 'abgeleitet', 'offen']
export const SPALTEN = ['externe_id', 'datum_utc', 'ort', 'art', 'asset', 'menge', 'gegen_asset', 'gegen_menge',
    'gebuehr_asset', 'gebuehr_menge', 'chf_wert', 'txhash', 'kette', 'kontrakt', 'einordnung', 'sicherheit', 'notiz']
const PFLICHT = ['externe_id', 'datum_utc', 'ort', 'art', 'asset', 'menge']

/** Quelle-Schlüssel eines importierten Orts (in `portfolio_bewegungen.quelle`). */
export const importQuelle = (ort) => `i:${String(ort).trim()}`

/** Eine CSV-Zeile mit `;` — Anführungszeichen erlaubt (Notizen mit Semikolon). */
function felder(zeile) {
    const aus = []
    let akt = '', inQ = false
    for (let i = 0; i < zeile.length; i++) {
        const c = zeile[i]
        if (inQ) {
            if (c === '"' && zeile[i + 1] === '"') { akt += '"'; i++ }
            else if (c === '"') inQ = false
            else akt += c
        } else if (c === '"') inQ = true
        else if (c === ';') { aus.push(akt); akt = '' }
        else akt += c
    }
    aus.push(akt)
    return aus.map((f) => f.trim())
}

function zahl(s) {
    if (s === undefined || s === null || s === '') return null
    // Tausendertrennzeichen ' (Schweiz) und Leerzeichen dulden; Komma ist KEIN Dezimaltrenner hier.
    const t = String(s).replace(/['\s]/g, '')
    if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return NaN
    return Number(t)
}

/**
 * @param {string} text  Dateiinhalt
 * @returns {{ zeilen: Array, fehler: Array<{zeile:number, grund:string}>, orte: Object<string, {n, von, bis}> }}
 */
export function leseImportCsv(text) {
    const zeilenRoh = String(text || '').replace(/^﻿/, '').split(/\r?\n/)
    const fehler = []
    const kopf = felder(zeilenRoh[0] || '').map((k) => k.toLowerCase())
    const fehlend = PFLICHT.filter((p) => !kopf.includes(p))
    if (fehlend.length) return { zeilen: [], fehler: [{ zeile: 1, grund: `Kopfzeile: es fehlen ${fehlend.join(', ')}` }], orte: {} }
    const idx = Object.fromEntries(kopf.map((k, i) => [k, i]))
    const wert = (f, name) => (idx[name] === undefined ? '' : (f[idx[name]] ?? ''))

    const zeilen = []
    const gesehen = new Set()
    const orte = {}
    for (let n = 1; n < zeilenRoh.length; n++) {
        const roh = zeilenRoh[n]
        if (!roh.trim()) continue
        const f = felder(roh)
        const nr = n + 1
        const melde = (grund) => fehler.push({ zeile: nr, grund })
        const ort = wert(f, 'ort')
        const externeId = wert(f, 'externe_id')
        const art = wert(f, 'art').toLowerCase()
        const asset = wert(f, 'asset').toUpperCase()
        const zeit = Date.parse(wert(f, 'datum_utc'))
        const menge = zahl(wert(f, 'menge'))
        if (!ort) { melde('ort fehlt'); continue }
        if (!externeId) { melde('externe_id fehlt'); continue }
        if (!IMPORT_ARTEN.includes(art)) { melde(`unbekannte art „${art}"`); continue }
        if (!asset) { melde('asset fehlt'); continue }
        if (!Number.isFinite(zeit)) { melde(`datum_utc unlesbar „${wert(f, 'datum_utc')}"`); continue }
        if (!Number.isFinite(menge)) { melde(`menge unlesbar „${wert(f, 'menge')}"`); continue }
        const schluessel = `${ort}|${externeId}`
        if (gesehen.has(schluessel)) { melde(`externe_id „${externeId}" doppelt für ${ort}`); continue }
        gesehen.add(schluessel)

        const gegenAsset = wert(f, 'gegen_asset').toUpperCase() || null
        const gegenMenge = zahl(wert(f, 'gegen_menge'))
        if (gegenAsset && !Number.isFinite(gegenMenge)) { melde('gegen_menge fehlt oder unlesbar'); continue }
        const gebuehrMenge = zahl(wert(f, 'gebuehr_menge'))
        if (gebuehrMenge !== null && (!Number.isFinite(gebuehrMenge) || gebuehrMenge < 0)) { melde('gebuehr_menge muss positiv sein'); continue }
        const gebuehrAsset = wert(f, 'gebuehr_asset').toUpperCase() || (gebuehrMenge ? asset : null)
        const chfWert = zahl(wert(f, 'chf_wert'))
        if (chfWert !== null && !Number.isFinite(chfWert)) { melde('chf_wert unlesbar'); continue }
        const einordnung = wert(f, 'einordnung').toLowerCase() || null
        if (einordnung && !EINORDNUNGEN.includes(einordnung)) { melde(`unbekannte einordnung „${einordnung}"`); continue }
        const sicherheit = wert(f, 'sicherheit').toLowerCase() || 'beleg'
        if (!SICHERHEITEN.includes(sicherheit)) { melde(`unbekannte sicherheit „${sicherheit}"`); continue }

        // Vorzeichen-Plausibilität: die häufigste Fehlerquelle beim Erstellen der Datei.
        if (art === 'kauf' && menge < 0) { melde('kauf mit negativer menge (asset = was REIN kommt)'); continue }
        if (art === 'verkauf' && menge > 0) { melde('verkauf mit positiver menge (asset = was RAUS geht)'); continue }
        if (art === 'auszahlung' && menge > 0) { melde('auszahlung mit positiver menge'); continue }
        if (['einzahlung', 'bestand', 'staking', 'airdrop', 'belohnung'].includes(art) && menge < 0) { melde(`${art} mit negativer menge`); continue }
        if (['kauf', 'verkauf', 'tausch'].includes(art) && gegenAsset && Math.sign(menge) === Math.sign(gegenMenge) && menge !== 0) {
            melde(`${art}: menge und gegen_menge haben dasselbe Vorzeichen`); continue
        }

        zeilen.push({
            quelle: importQuelle(ort), ort, externeId, zeit, art, asset, menge,
            gegenAsset, gegenMenge: gegenAsset ? gegenMenge : null,
            gebuehrAsset: gebuehrMenge ? gebuehrAsset : null, gebuehrMenge: gebuehrMenge || null,
            chfWert, txHash: wert(f, 'txhash') || null, kette: wert(f, 'kette') || null,
            kontrakt: wert(f, 'kontrakt') ? wert(f, 'kontrakt').toLowerCase() : null,
            einordnung, sicherheit, notiz: wert(f, 'notiz') || null,
        })
        const o = orte[ort] || (orte[ort] = { n: 0, von: zeit, bis: zeit })
        o.n++; o.von = Math.min(o.von, zeit); o.bis = Math.max(o.bis, zeit)
    }
    return { zeilen, fehler, orte }
}
