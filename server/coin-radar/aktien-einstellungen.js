/**
 * Einstellungen des Aktien-Radars prüfen (rein — kein Netz, keine Datenbank).
 *
 * `huerdenAktien` und `gewichteAktien` wurden vom Lauf gelesen, hatten aber
 * weder Oberfläche noch Prüfung — und standen nicht in den `VORGABEN`, sodass
 * ein gespeicherter Wert nie gelesen worden wäre. Hier steht, was als Eingabe
 * gilt. Die Regeln sind dieselben wie beim Coin-Radar, wo es welche gibt:
 * Gewichte müssen nicht auf 100 summieren (die Note normiert selbst), dürfen
 * aber nicht alle null sein.
 *
 * `null` für einen ganzen Block heisst «Vorgabe wiederherstellen»: es wird
 * `null` gespeichert, und `leseEinstellungen` nimmt dann die Vorgabe — auch
 * eine, die sich später ändert. Gleiches gilt, wenn die Eingabe der Vorgabe
 * entspricht: Vorgaben sollen nicht in der Datenbank einfrieren.
 */
import { STANDARD_HUERDEN_AKTIEN } from './bewertung.js'
import { GEWICHTE_AKTIEN } from './aktien-kennzahlen.js'
import { bereinigeZeitplan, ZEITPLAN_VORGABE } from './aktien-zeitplan.js'

/** Grenzen der Hürden. `ganz` = nur ganze Zahlen. */
export const HUERDEN_GRENZEN = Object.freeze({
    minUmsatz24hUsd: { min: 0, max: 100_000_000_000 },
    maxSpreadBp: { min: 0.1, max: 1000 },
    minTiefeUsd: { min: 0, max: 1_000_000_000 },
    minKerzen: { min: 20, max: 500, ganz: true },
})

export const GEWICHT_GRENZEN = Object.freeze({ min: 0, max: 100 })

/** Was der Aktien-Radar an eigenen Schlüsseln hat. */
export const AKTIEN_SCHLUESSEL = ['huerdenAktien', 'gewichteAktien', 'aktienZeitplan']

const istObjekt = (w) => w && typeof w === 'object' && !Array.isArray(w)

/** Zahl aus Eingabe; Komma als Dezimaltrenner gilt. Leer, Text, NaN, Unendlich → null. */
export function zahlAus(w) {
    if (typeof w === 'number') return Number.isFinite(w) ? w : null
    if (typeof w !== 'string') return null
    const s = w.trim().replace(/['’\s]/g, '').replace(',', '.')
    if (s === '' || !/^-?\d+(\.\d+)?$/.test(s)) return null
    return Number(s)
}

const gleich = (a, b) => Object.keys(b).every((k) => a[k] === b[k]) && Object.keys(a).every((k) => k in b)

/**
 * @returns {{wert: object|null}|{fehler: string, feld?: string}}
 */
export function bereinigeHuerdenAktien(roh) {
    if (roh === null) return { wert: null }
    if (!istObjekt(roh)) return { fehler: 'form' }
    const wert = { ...STANDARD_HUERDEN_AKTIEN }
    for (const [feld, g] of Object.entries(HUERDEN_GRENZEN)) {
        if (roh[feld] === undefined) continue
        const n = zahlAus(roh[feld])
        if (n === null) return { fehler: 'keineZahl', feld }
        if (n < g.min || n > g.max) return { fehler: 'bereich', feld }
        if (g.ganz && !Number.isInteger(n)) return { fehler: 'ganzzahl', feld }
        wert[feld] = n
    }
    return { wert: gleich(wert, STANDARD_HUERDEN_AKTIEN) ? null : wert }
}

/**
 * @returns {{wert: object|null}|{fehler: string, feld?: string}}
 */
export function bereinigeGewichteAktien(roh) {
    if (roh === null) return { wert: null }
    if (!istObjekt(roh)) return { fehler: 'form' }
    const wert = { ...GEWICHTE_AKTIEN }
    for (const feld of Object.keys(GEWICHTE_AKTIEN)) {
        if (roh[feld] === undefined) continue
        const n = zahlAus(roh[feld])
        if (n === null) return { fehler: 'keineZahl', feld }
        if (n < GEWICHT_GRENZEN.min || n > GEWICHT_GRENZEN.max) return { fehler: 'bereich', feld }
        wert[feld] = n
    }
    if (!(Object.values(wert).reduce((a, b) => a + b, 0) > 0)) return { fehler: 'gewichteNull' }
    return { wert: gleich(wert, GEWICHTE_AKTIEN) ? null : wert }
}

/**
 * Die Aktien-Schlüssel einer Eingabe prüfen. Andere Schlüssel bleiben
 * unberührt (sie gehören dem Coin-Radar).
 *
 * @returns {{neu: object}|{fehler: string, feld?: string, block: string}}
 */
export function bereinigeAktienEinstellungen(eingabe = {}) {
    const neu = {}
    if ('huerdenAktien' in eingabe) {
        const r = bereinigeHuerdenAktien(eingabe.huerdenAktien)
        if (r.fehler) return { ...r, block: 'huerdenAktien' }
        neu.huerdenAktien = r.wert
    }
    if ('gewichteAktien' in eingabe) {
        const r = bereinigeGewichteAktien(eingabe.gewichteAktien)
        if (r.fehler) return { ...r, block: 'gewichteAktien' }
        neu.gewichteAktien = r.wert
    }
    if ('aktienZeitplan' in eingabe) {
        if (eingabe.aktienZeitplan === null) neu.aktienZeitplan = null
        else {
            const r = bereinigeZeitplan(eingabe.aktienZeitplan)
            if (r.fehler) return { fehler: r.fehler, block: 'aktienZeitplan' }
            neu.aktienZeitplan = gleich(r.plan, ZEITPLAN_VORGABE) ? null : r.plan
        }
    }
    return { neu }
}

/** Fehlertext für die Antwort (deutsch; die Oberfläche übersetzt über das Kürzel). */
export function fehlerText({ fehler, feld }) {
    const wo = feld ? ` (${feld})` : ''
    return {
        form: 'Die Eingabe hat nicht die erwartete Form.',
        keineZahl: `Bitte eine Zahl eingeben${wo}.`,
        bereich: `Der Wert liegt ausserhalb des erlaubten Bereichs${wo}.`,
        ganzzahl: `Hier ist nur eine ganze Zahl erlaubt${wo}.`,
        gewichteNull: 'Die Gewichte dürfen nicht alle null sein.',
        zeitplanAbstand: 'Der Abstand zur Eröffnung bzw. zum Schluss muss zwischen 5 und 180 Minuten liegen.',
    }[fehler] || 'Die Eingabe ist ungültig.'
}
