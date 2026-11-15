/**
 * Bitpandas öffentliche Asset-Liste (`/v3/assets`): ohne Schlüssel, ohne Konto.
 *
 * Zwei Abnehmer:
 *   - der Stamm-Abgleich (`stamm.js`, nur bei eingeschaltetem Aktien-Modus)
 *     liest sie roh über `holeBitpandaListe`;
 *   - das Spot-Portfolio (`portfolio/quellen.js`) bestimmt daraus, ob eine
 *     Bitpanda-Position eine Aktie oder ein ETF ist — auch bei AUSGESCHALTETEM
 *     Aktien-Modus, in dem der Stamm leer bleibt (Audit FUN-P-002). Dafür
 *     `bitpandaListeGemerkt`: zwölf Stunden im Arbeitsspeicher, und fällt der
 *     Abruf aus, gilt die alte Liste weiter (Kennungen ändern sich nicht).
 *
 * Abgerufen wird nur, wenn der Nutzer Bitpanda selbst eingerichtet hat
 * (Portfolio) oder den Aktien-Modus eingeschaltet hat (Stamm). In der Anfrage
 * steht nichts über den Nutzer.
 */

const BITPANDA_LISTE = 'https://api.bitpanda.com/v3/assets'
const GILT_MS = 12 * 3600e3

/** Öffentliche JSON-Liste mit Frist. Pionex und Bitpanda stehen nicht in der Host-Liste des Hype-Radars. */
export async function holeOeffentlich(url, timeout = 20000) {
    const steuerung = new AbortController()
    const wecker = setTimeout(() => steuerung.abort(), timeout)
    try {
        const antwort = await fetch(url, { signal: steuerung.signal, headers: { accept: 'application/json' } })
        if (!antwort.ok) throw new Error(`HTTP ${antwort.status}`)
        return await antwort.json()
    } finally {
        clearTimeout(wecker)
    }
}

/** Die ganze Liste, seitenweise: `attributes` je Eintrag (`pid`, `id`, `symbol`, `name`, `group`). Wirft bei einem Fehler. */
export async function holeBitpandaListe(hole = holeOeffentlich) {
    const alle = []
    for (let seite = 1; seite <= 20; seite++) {
        const zeilen = (await hole(`${BITPANDA_LISTE}?page_size=500&page=${seite}`))?.data || []
        for (const z of zeilen) if (z?.attributes) alle.push(z.attributes)
        if (zeilen.length < 500) break
    }
    return alle
}

let merk = null      // { zeit, liste }
let laeuft = null

/**
 * Die Liste aus dem Speicher, höchstens zwölf Stunden alt. Scheitert der Abruf
 * (oder kommt eine leere Liste), bleibt die alte; gibt es keine, `null` —
 * «unbekannt», nicht «keine Aktien».
 * @param {{hole?: Function, jetzt?: number}} [o]  `hole` nur für den Selbsttest
 * @returns {Promise<object[]|null>}
 */
export async function bitpandaListeGemerkt({ hole = holeOeffentlich, jetzt = Date.now() } = {}) {
    if (merk && jetzt - merk.zeit < GILT_MS) return merk.liste
    laeuft ||= (async () => {
        try {
            const liste = await holeBitpandaListe(hole)
            if (liste.length) merk = { zeit: jetzt, liste }
        } catch { /* alte Liste bleibt, sonst unbekannt */ } finally { laeuft = null }
        return merk ? merk.liste : null
    })()
    return laeuft
}

/** Nur für den Selbsttest: Speicher leeren. */
export function vergissBitpandaListe() {
    merk = null
}
