/**
 * Unsichtbare Zeichen aus Modelltext entfernen — rein, ohne Abhängigkeiten.
 *
 * Lag bis 01.11.2026 in `server/news-recherche.js` und galt nur für die X-Suche.
 * Ausgelagert, weil `server/llm.js` denselben Filter für Grok-Textantworten
 * braucht (Chart-KI, Flash-News) und `news-recherche.js` seinerseits aus
 * `llm.js` importiert — ein Import in die andere Richtung wäre ein Kreis.
 * `news-recherche.js` reicht die Funktion unter dem alten Namen weiter.
 *
 * xAI kennzeichnet Grok-Texte ab dem 07.11.2026 mit einem Wasserzeichen; wie,
 * steht nirgends (Stand 01.11.2026). Steckt es in der Wortwahl, ändert sich
 * hier nichts. Sind es unsichtbare Zeichen, bricht ohne jede Fehlermeldung,
 * wovon die X-Suche lebt: eines in „$PEPE" oder in einer Vertragsadresse, und
 * `erwaehnungenIn` findet sie nicht; eines in der Status-URL, und der Post
 * fällt durch die Zitat-Kontrolle; eines zwischen den JSON-Teilen, und
 * `parseJsonListe` liefert nichts — bezahlt ist die Suche trotzdem.
 */
/*
 * Was wegfällt: alle Formatzeichen (Cf) und alle laut Unicode „standardmässig
 * zu übergehenden" Zeichen (Default_Ignorable_Code_Point). Bis 01.11.2026 nur
 * Cf und eine Handvoll Variantenwähler — durch kamen die Hangul-Füller
 * (U+3164, U+115F/1160, U+FFA0), die mongolischen Variantenwähler, die
 * Khmer-Vokale U+17B4/17B5, U+2065, U+FFF0–FFF8 und die Variantenwähler-
 * Ergänzung ab U+E0080: eines davon in „$PEPE", und gezählt wurde „$PE".
 */
const UNSICHTBAR = /[\p{Cf}\p{Default_Ignorable_Code_Point}]/gu
// U+2800 (Braille leer) ist kein Default-Ignorable, sieht aber aus wie ein Leerzeichen.
const ANDERE_LEERZEICHEN = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000\u2800]/g
const ANDERE_ZEILENENDEN = /[\u2028\u2029]/g

/*
 * Ausnahmen, in denen ein solches Zeichen Teil der Schrift ist und bleibt:
 *  - Wortverbinder (U+200D) und Nichtverbinder (U+200C) zwischen zwei
 *    Buchstaben einer Schrift, die sie braucht (Persisch, Arabisch, die
 *    indischen Schriften, Singhalesisch, Khmer …) — dort ändern sie die
 *    Schreibung, nicht nur das Bild;
 *  - der Wortverbinder zwischen zwei Emoji (👩‍💻, 🏳️‍🌈) und der Variantenwähler
 *    U+FE0F direkt nach einem Emoji oder vor dem Tasten-Rahmen (1️⃣);
 *  - die mongolischen Variantenwähler direkt nach einem mongolischen Buchstaben.
 * Massgeblich sind die Nachbarn im UNGEFILTERTEN Text: steht ein zweites
 * unsichtbares Zeichen daneben, ist der Nachbar kein Buchstabe, und beide
 * fallen weg. Zwischen lateinischen Buchstaben und Ziffern — dort, wo Kürzel,
 * Adressen und Post-IDs stehen — gibt es keine Ausnahme.
 */
const SCHRIFTEN = '\\p{scx=Arabic}\\p{scx=Syriac}\\p{scx=Nko}\\p{scx=Devanagari}\\p{scx=Bengali}\\p{scx=Gurmukhi}'
    + '\\p{scx=Gujarati}\\p{scx=Oriya}\\p{scx=Tamil}\\p{scx=Telugu}\\p{scx=Kannada}\\p{scx=Malayalam}'
    + '\\p{scx=Sinhala}\\p{scx=Tibetan}\\p{scx=Myanmar}\\p{scx=Khmer}'
const SCHRIFT_DAVOR = new RegExp(`(?=[\\p{L}\\p{M}])[${SCHRIFTEN}]$`, 'u')
const SCHRIFT_DANACH = new RegExp(`^(?=[\\p{L}\\p{M}])[${SCHRIFTEN}]`, 'u')
const EMOJI_DAVOR = /\p{Extended_Pictographic}[\u{1F3FB}-\u{1F3FF}]?\uFE0F?$/u
const EMOJI_DANACH = /^\p{Extended_Pictographic}/u
const EMOJI_VOR_FE0F = /\p{Extended_Pictographic}[\u{1F3FB}-\u{1F3FF}]?$/u
const MONGOLISCH_DAVOR = /(?=\p{L})\p{scx=Mongolian}$/u

/** Gehört das unsichtbare Zeichen `z` an Stelle `pos` von `s` zur Schrift? */
function gehoertZurSchrift(z, pos, s) {
    const davor = s.slice(Math.max(0, pos - 6), pos)
    const danach = s.slice(pos + 1, pos + 3)
    if (z === '\u200C' || z === '\u200D') {
        if (SCHRIFT_DAVOR.test(davor) && SCHRIFT_DANACH.test(danach)) return true
        return z === '\u200D' && EMOJI_DAVOR.test(davor) && EMOJI_DANACH.test(danach)
    }
    if (z === '\uFE0F') return EMOJI_VOR_FE0F.test(davor) || (/[0-9#*]$/.test(davor) && danach[0] === '\u20E3')
    if (z >= '\u180B' && z <= '\u180F' && z !== '\u180E') return MONGOLISCH_DAVOR.test(davor)
    return false
}

/**
 * Unsichtbare Zeichen aus Grok-Text entfernen. Rein.
 *
 * Formatzeichen (Nullbreite, Wortverbinder, BOM, Bidi-Steuerung,
 * Tag-Zeichen), Variantenwähler, Füllzeichen und alles übrige
 * Default-Ignorable fallen weg — ausser in den Schriften und Emoji, die sie
 * brauchen (oben). Andere Leerzeichen und Zeilenenden werden zu den
 * gewöhnlichen, die die Suchmuster kennen. Für Text, der danach noch durch
 * `JSON.parse` geht, `ohneUnsichtbaresFuerJson` nehmen.
 *
 * @param {string} text
 * @returns {string}
 */
export function ohneUnsichtbares(text) {
    return String(text ?? '')
        .replace(UNSICHTBAR, (z, pos, s) => (gehoertZurSchrift(z, pos, s) ? z : ''))
        .replace(ANDERE_LEERZEICHEN, ' ')
        .replace(ANDERE_ZEILENENDEN, '\n')
}

/**
 * Wie `ohneUnsichtbares`, aber für Text, der noch durch `JSON.parse` geht:
 * U+2028/2029 werden zu Leerzeichen statt zu Zeilenenden. Roh im String ist
 * U+2028 gültiges JSON, ein echtes Zeilenende nicht — bis 01.11.2026 machte
 * der Filter daraus eines, und die ganze X-Antwort war unlesbar (bezahlt).
 * Nur als Rückfall gedacht, wenn der ungefilterte Text sich nicht parsen
 * lässt; danach die Felder mit `saeubereJson` nachziehen.
 */
export function ohneUnsichtbaresFuerJson(text) {
    return ohneUnsichtbares(String(text ?? '').replace(ANDERE_ZEILENENDEN, ' '))
}

/**
 * Jede Zeichenkette in einem geparsten JSON ohne unsichtbare Zeichen — auch
 * die, die erst `JSON.parse` aus einem `\u200B`-Escape gemacht hat. Rein.
 */
export function saeubereJson(x) {
    if (typeof x === 'string') return ohneUnsichtbares(x)
    if (Array.isArray(x)) return x.map(saeubereJson)
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [ohneUnsichtbares(k), saeubereJson(v)]))
    return x
}
