/**
 * Zerlegung in Tokens für die Herkunftsprüfung (Prüfung 4, `scripts/herkunft-pruefen.mjs`),
 * dazu der Abgleich der gesichteten Ausnahmen in Gegenrichtung (`veralteteAusnahmen`).
 *
 * Eigene Datei, damit der Selbsttest (`server/__selftest-herkunft-tokens.mjs`) sie
 * ohne Netz und ohne Vergleichsstand prüfen kann — das Prüfskript selbst klont beim
 * Laden die Vergleichsquelle.
 *
 * Audit 4.3.4 (FUN-F6-001): Eine Vorlagen-Zeichenkette endete bis dahin am ersten
 * Backtick danach — auch an einem Backtick INNERHALB von `${…}`. Eine verschachtelte
 * Vorlage wie in server/database.js (`${isPg ? `"${table}"` : …}`) kehrte so die
 * Parität um: der Rest der Datei galt als Zeichenkette, war für die Token-Fenster
 * unsichtbar, und eine umbenannte Kopie dort fiel nicht auf („Ungesichtet: 0").
 * Jetzt wird `${…}` mit Klammerzähler übersprungen, darin auch Zeichenketten und
 * weitere Vorlagen; eine Vorlage zählt weiterhin als EIN Token `S`. Regex-Literale
 * werden erkannt und zählen ebenfalls als `S` (ein Backtick oder Anführungszeichen
 * darin öffnete sonst eine Zeichenkette). Was trotzdem offen bis zum Dateiende
 * läuft, meldet `zerlege` als `offen`.
 */

export const SCHLUESSELWORT = new Set(('await break case catch class const continue debugger default delete do else export extends false finally for from function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while with yield async').split(' '))
export const KONTROLLE = new Set(['if', 'for', 'while', 'switch', 'case', 'return', 'else', 'try', 'catch', 'break', 'continue', 'throw'])

/** Ende einer '…'/"…"-Zeichenkette ab dem öffnenden Zeichen (bricht wie bisher am Zeilenende ab). */
function zeichenketteEnde(s, start) {
    const c = s[start]
    let j = start + 1
    while (j < s.length && s[j] !== c) { if (s[j] === '\\') j++; if (s[j] === '\n') break; j++ }
    return j + 1
}

/**
 * Ende eines Regex-Literals ab dem öffnenden `/` (Zeichenklassen `[…]` und
 * Escapes beachtet, Flags inklusive); -1, wenn vor dem Zeilenende kein `/`
 * kommt — dann war es eine Division. Ohne diese Erkennung öffnete ein Backtick
 * oder Anführungszeichen in einem Regex (`/[#>`*]/`, `/"/g`) eine Zeichenkette.
 */
function regexEnde(s, start) {
    let j = start + 1
    let klasse = false
    while (j < s.length) {
        const c = s[j]
        if (c === '\n') return -1
        if (c === '\\') { j += 2; continue }
        if (klasse) { if (c === ']') klasse = false }
        else if (c === '[') klasse = true
        else if (c === '/') { j++; while (j < s.length && /[a-z]/.test(s[j])) j++; return j }
        j++
    }
    return -1
}

/**
 * Zeichen, nach denen ein `/` ein Regex beginnt und keine Division ist. Ohne `<`
 * und `>`: in Vorlagen und HTML ist `</div>` bzw. `/>` ein Tag, kein Regex.
 */
const VOR_REGEX = new Set('(,=:[!&|?{;+-*%~^'.split(''))
const VOR_REGEX_WORT = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await'])

/** Darf nach diesem Token ein Regex stehen? (Ein Wert davor — Name, Zahl, `)`, `]`, `}` — heisst Division.) */
function regexNach(token) {
    if (token === undefined) return true
    if (VOR_REGEX_WORT.has(token) || token === '=>') return true
    if (/^[A-Za-z_$\d]/.test(token)) return false
    return VOR_REGEX.has(token[token.length - 1])
}

/**
 * Ende einer Vorlage ab dem öffnenden Backtick: Index nach dem schliessenden,
 * -1 wenn die Datei vorher endet.
 */
function vorlageEnde(s, start) {
    let j = start + 1
    while (j < s.length) {
        const c = s[j]
        if (c === '\\') { j += 2; continue }
        if (c === '`') return j + 1
        if (c === '$' && s[j + 1] === '{') {
            j = ausdruckEnde(s, j + 2)
            if (j < 0) return -1
            continue
        }
        j++
    }
    return -1
}

/** Ende eines `${…}`-Ausdrucks ab dem Zeichen nach `{`: Index nach der passenden `}`, -1 wenn offen. */
function ausdruckEnde(s, start) {
    let tiefe = 1
    let j = start
    let vorher = '('   // letztes Zeichen ausser Leerraum: entscheidet Regex oder Division
    while (j < s.length) {
        const c = s[j]
        if (c === '`') { j = vorlageEnde(s, j); if (j < 0) return -1; vorher = 'S'; continue }
        if (c === '"' || c === "'") { j = zeichenketteEnde(s, j); vorher = 'S'; continue }
        if (s.startsWith('/*', j)) { const e = s.indexOf('*/', j + 2); if (e < 0) return -1; j = e + 2; continue }
        if (c === '/' && VOR_REGEX.has(vorher)) { const e = regexEnde(s, j); if (e > 0) { j = e; vorher = 'S'; continue } }
        if (c === '{') tiefe++
        else if (c === '}' && --tiefe === 0) return j + 1
        if (!/\s/.test(c)) vorher = c
        j++
    }
    return -1
}

/**
 * Zerlegt Quelltext in Tokens; Kommentare fallen weg, Literale werden S bzw. N.
 * @returns {{tokens: string[], offen: boolean, zeichenketteAnteil: number}} `offen`:
 *   eine Vorlage lief bis zum Dateiende; `zeichenketteAnteil`: Anteil der Zeilen,
 *   die innerhalb einer Zeichenkette beginnen (0–1)
 */
export function zerlege(quelle) {
    const aus = []
    const s = quelle
    let offen = false
    let inZeichenkette = 0
    let i = 0
    while (i < s.length) {
        const c = s[i]
        if (/\s/.test(c)) { i++; continue }
        if (s.startsWith('<!--', i)) { const e = s.indexOf('-->', i + 4); i = e < 0 ? s.length : e + 3; continue }
        if (s.startsWith('/*', i)) { const e = s.indexOf('*/', i + 2); i = e < 0 ? s.length : e + 2; continue }
        if (s.startsWith('//', i) && s[i - 1] !== ':') { const e = s.indexOf('\n', i); i = e < 0 ? s.length : e; continue }
        if (c === '"' || c === "'") { aus.push('S'); i = zeichenketteEnde(s, i); continue }
        if (c === '/' && regexNach(aus[aus.length - 1])) {
            const e = regexEnde(s, i)
            if (e > 0) { aus.push('S'); i = e; continue }
        }
        if (c === '`') {
            let e = vorlageEnde(s, i)
            if (e < 0) { offen = true; e = s.length }
            for (let k = i; k < e - 1; k++) if (s[k] === '\n') inZeichenkette++
            aus.push('S'); i = e; continue
        }
        const m = /^[A-Za-z_$][\w$-]*/.exec(s.slice(i, i + 80))
        if (m) {
            // Bindestrich nur in Vorlagen-/CSS-Namen; in JS wäre es ein Minus.
            let w = m[0]
            if (w.includes('-') && !/^[a-z][\w-]*[a-z\d]$/.test(w)) w = w.split('-')[0]
            aus.push(w); i += w.length; continue
        }
        const z = /^\d[\d._a-zA-Z]*/.exec(s.slice(i, i + 40))
        if (z) { aus.push('N'); i += z[0].length; continue }
        const op = /^(===|!==|=>|\.\.\.|&&|\|\||\?\?|\?\.|==|!=|<=|>=|\+\+|--|\+=|-=)/.exec(s.slice(i, i + 3))
        if (op) { aus.push(op[0]); i += op[0].length; continue }
        aus.push(c); i++
    }
    const zeilen = s.split('\n').length
    return { tokens: aus, offen, zeichenketteAnteil: zeilen ? inZeichenkette / zeilen : 0 }
}

/** Nur die Tokens (wie bisher `tokens()` im Prüfskript). */
export const tokens = (quelle) => zerlege(quelle).tokens

export const istName = (t) => /^[A-Za-z_$]/.test(t) && t !== 'S' && t !== 'N'
export const normal = (t) => (istName(t) && !SCHLUESSELWORT.has(t) ? 'I' : t)

/** Gemeinsame Läufe von ≥ fenster Tokens zwischen unserer Datei und dem Vergleichsstand. */
export function laeufe(eigen, fremdIndex, fenster, abbilden) {
    const reihe = eigen.map(abbilden)
    const gedeckt = new Uint8Array(reihe.length)
    const quelle = new Array(reihe.length)
    for (let i = 0; i + fenster <= reihe.length; i++) {
        const k = reihe.slice(i, i + fenster).join(' ')
        const wo = fremdIndex.get(k)
        if (wo) { for (let j = i; j < i + fenster; j++) gedeckt[j] = 1; quelle[i] = wo }
    }
    const aus = []
    let a = -1
    for (let i = 0; i <= reihe.length; i++) {
        if (i < reihe.length && gedeckt[i]) { if (a < 0) a = i; continue }
        if (a >= 0) { aus.push({ von: a, bis: i, wo: quelle[a] }); a = -1 }
    }
    return aus
}

/**
 * Ausnahmen aus `herkunft-akzeptiert.json`, zu denen kein Treffer mehr gehört
 * (Audit 4.3.4, FUN-F6-002): Code gelöscht oder verschoben. Sie blieben sonst
 * stehen, liessen die Liste grösser wirken und gälten bei Rückkehr derselben
 * Tokenfolge ohne neue Sichtung.
 * @param {{textZeilen?: object, namen?: object, laeufe?: object}} gesichtet Inhalt der JSON-Datei
 * @param {{textZeilen: Set<string>, namen: Set<string>, laeufe: Set<string>}} gefunden Schlüssel dieses Laufs
 * @returns {{art: string, schluessel: string}[]}
 */
export function veralteteAusnahmen(gesichtet, gefunden) {
    return ['textZeilen', 'namen', 'laeufe']
        .flatMap(art => Object.keys(gesichtet?.[art] || {}).filter(k => !gefunden[art]?.has(k)).map(k => ({ art, schluessel: k })))
}
