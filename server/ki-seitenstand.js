/**
 * ki-seitenstand.js — was der Nutzer gerade vor sich hat, für den KI-Coach.
 *
 * Die Seitenleiste schickt mit jeder Frage mit, auf welcher Seite sie offen
 * ist und was dort gewählt ist (Reiter, aufgeklappte Zeile, Filter). Der
 * Server kannte bis dahin nur den Routennamen und machte daraus ein
 * Hilfe-Thema — auf „Warum ist der kein Kandidat?" konnte er nicht wissen,
 * wer „der" ist.
 *
 * Der Stand kommt aus dem BROWSER und landet im Systemprompt. Deshalb gilt
 * hier eine Positivliste: nur bekannte Schlüssel, jeder mit festem Typ und
 * fester Länge. Alles andere fällt stillschweigend weg. Zwei Felder sind
 * Fremdtext (Kürzel und Name eines Tokens — beliebig benennbar) und werden
 * als Zitat markiert; `hatFremdtext` sagt dem Aufrufer, dass die Zitat-Regel
 * in den Prompt gehört.
 *
 * Rein: keine Datenbank, kein Netz. Selbsttest `__selftest-ki-seitenstand.mjs`.
 */

import { zitatZeile } from './fremdtext.js'

const WORT = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/
const BOERSEN_SYMBOL = /^[A-Z0-9]{2,20}$/
const ZEITEINHEIT = /^\d{1,2}[mhdwM]$/
const KETTE = /^[a-z0-9-]{1,24}$/
const VERTRAG = /^[A-Za-z0-9]{20,80}$/
const DATUM = /^\d{4}-\d{2}-\d{2}$/
// Anzeigetext der App selbst (Zeitraum-Zeile der Titelzeile, Filterwerte):
// Buchstaben, Ziffern und die Satzzeichen, die dort vorkommen.
const ANZEIGE = /^[\p{L}\p{N} .,:·–\-+/%()]{1,80}$/u

const wort = (w) => (typeof w === 'string' && WORT.test(w) ? w : null)
const zahl = (w) => (Number.isFinite(Number(w)) && w !== '' && w !== null && typeof w !== 'boolean' ? Number(w) : null)
const ganz = (w) => { const n = zahl(w); return n !== null && Number.isInteger(n) && n > 0 && n < 1e12 ? n : null }
const anzeige = (w) => (typeof w === 'string' && ANZEIGE.test(w.trim()) ? w.trim() : null)

/** Filterwerte: Wort, Zahl, Wahrheitswert, Anzeigetext oder eine kurze Liste davon. */
function filterWert(w) {
    if (typeof w === 'boolean') return w ? 'ja' : 'nein'
    if (typeof w === 'number') return Number.isFinite(w) ? String(w) : null
    if (typeof w === 'string') return anzeige(w)
    if (Array.isArray(w)) {
        const teile = w.slice(0, 8).map((x) => (typeof x === 'string' ? anzeige(x) : null)).filter(Boolean)
        return teile.length ? teile.join(', ') : null
    }
    return null
}

/**
 * Jeder Eintrag: Schlüssel im Stand → Funktion, die daraus eine Promptzeile
 * macht oder `null`, wenn der Wert nicht passt.
 */
const FELDER = {
    reiter: (w) => (wort(w) ? `Reiter: ${w}` : null),
    ansicht: (w) => (wort(w) ? `Ansicht: ${w}` : null),
    symbol: (w) => (typeof w === 'string' && BOERSEN_SYMBOL.test(w) ? `Symbol: ${w}` : null),
    zeiteinheit: (w) => (typeof w === 'string' && ZEITEINHEIT.test(w) ? `Zeiteinheit: ${w}` : null),
    markt: (w) => (['spot', 'futures', 'krypto', 'aktien'].includes(w) ? `Markt: ${w}` : null),
    boerse: (w) => (wort(w) ? `Börse: ${w}` : null),
    kachel: (w) => (wort(w) ? `Geöffnete Kachel: ${w}` : null),
    zeitraum: (w) => (anzeige(w) ? `Zeitraum/Filter der Seite: ${anzeige(w)}` : null),
    datum: (w) => (typeof w === 'string' && DATUM.test(w) ? `Gewählter Tag: ${w}` : null),
    instanzId: (w) => (ganz(w) ? `Geöffnete Strategie-Instanz: instanceId ${ganz(w)}` : null),
    strategieId: (w) => (wort(w) ? `Geöffnete Strategie: ${w}` : null),
    berichtId: (w) => (ganz(w) ? `Geöffneter Bericht: id ${ganz(w)}` : null),
    anzahl: (w) => (zahl(w) !== null && zahl(w) >= 0 && zahl(w) < 1e7 ? `Zeilen in der Liste: ${zahl(w)}` : null),
    aufgeklappt: (w) => (typeof w === 'string' && BOERSEN_SYMBOL.test(w) ? `Aufgeklappte Zeile: ${w}` : null),
}

/** Aufgeklappter Token des Hype-Radars. Kürzel und Name sind Fremdtext. */
function tokenZeile(t) {
    if (!t || typeof t !== 'object') return null
    const teile = []
    if (typeof t.kuerzel === 'string' && t.kuerzel.trim()) teile.push(`Kürzel ${zitatZeile(t.kuerzel, 24)}`)
    if (typeof t.name === 'string' && t.name.trim()) teile.push(`Name ${zitatZeile(t.name, 40)}`)
    const kette = typeof t.kette === 'string' && KETTE.test(t.kette) ? t.kette : null
    const vertrag = typeof t.vertrag === 'string' && VERTRAG.test(t.vertrag) ? t.vertrag : null
    if (kette) teile.push(`Kette ${kette}`)
    if (vertrag) teile.push(`Vertrag ${vertrag}`)
    if (!vertrag && !teile.length) return null
    return { zeile: `Aufgeklappter Token: ${teile.join(', ')}`, fremd: teile.some((x) => x.includes('<<<')) }
}

/**
 * Prüft den Seitenstand aus dem Browser und macht Promptzeilen daraus.
 *
 * @param {unknown} roh  `{ reiter, token: {kuerzel, name, kette, vertrag}, filter: {…}, … }`
 * @returns {{ zeilen: string[], hatFremdtext: boolean }}
 */
export function pruefeSeitenStand(roh) {
    const aus = { zeilen: [], hatFremdtext: false }
    if (!roh || typeof roh !== 'object' || Array.isArray(roh)) return aus

    for (const [schluessel, macheZeile] of Object.entries(FELDER)) {
        if (!Object.hasOwn(roh, schluessel)) continue
        const zeile = macheZeile(roh[schluessel])
        if (zeile) aus.zeilen.push(zeile)
    }

    const token = tokenZeile(roh.token)
    if (token) {
        aus.zeilen.push(token.zeile)
        aus.hatFremdtext = token.fremd
    }

    if (roh.filter && typeof roh.filter === 'object' && !Array.isArray(roh.filter)) {
        const teile = []
        for (const [k, w] of Object.entries(roh.filter).slice(0, 10)) {
            if (!wort(k)) continue
            const wert = filterWert(w)
            if (wert !== null) teile.push(`${k} = ${wert}`)
        }
        if (teile.length) aus.zeilen.push(`Filter: ${teile.join('; ')}`)
    }
    return aus
}
