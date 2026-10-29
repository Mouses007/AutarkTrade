/**
 * Anzeigewährung für Kosten (KI-Verbrauch, Budgets).
 *
 * Die Anbieter rechnen in USD. Angezeigt wird in der Währung, die unter
 * Einstellungen › Allgemein › Profil & Sprache gewählt ist (`waehrungCode`:
 * USD, CHF oder EUR). Bis 10/2026 stand dort fest CHF mit dem Faktor 0.8.
 *
 * Der Kurs kommt aus derselben Quelle wie im Portfolio (`fxHeute` in
 * `portfolio/kurse.js`: EZB-Referenzkurs über Frankfurter, eine Stunde im
 * Speicher, jeder Abruf in `portfolio_kurse` gemerkt). Fällt die aus und gibt
 * es keinen gemerkten Kurs, gilt für CHF der gespeicherte `waehrungFaktor`
 * (er stammt aus der Zeit, als fest CHF galt) — und fehlt auch der, oder ist
 * EUR gewählt, wird in USD angezeigt statt mit einer erfundenen Zahl. Ein EUR-
 * Kurs, der in Wahrheit der CHF-Kurs ist (`eurAusChf`), zählt nicht.
 *
 * Die Anzeige wartet höchstens `ANZEIGE_WARTEN_MS` auf Frankfurter; danach
 * gilt sofort der gemerkte Kurs (`nachliefern: true`), und der Abruf läuft im
 * Hintergrund weiter — der Browser fragt später noch einmal.
 *
 * Nur Anzeige: Das Portfolio und der Steuerbericht rechnen weiter selbst mit
 * `fxHeute`/`fxAm` in CHF und lesen nichts von hier.
 */

export const WAEHRUNGEN = ['USD', 'CHF', 'EUR']

/** Gespeicherter Code → einer aus WAEHRUNGEN; leer/unbekannt = USD. */
export function normWaehrung(code) {
    const c = String(code || '').trim().toUpperCase()
    return WAEHRUNGEN.includes(c) ? c : 'USD'
}

/**
 * Wirksamer Anzeigekurs (rein).
 *
 * @param {string} code             gespeicherter `waehrungCode`
 * @param {object|null} fx          Ergebnis von `fxHeute()` ({ chf, eur, quelle, datum }) oder null
 * @param {number} gespeichert      gespeicherter `waehrungFaktor` (Rückfall)
 * @returns {{ code, faktor, quelle, datum }}  faktor = USD → code; quelle null bei USD
 */
export function anzeigeKursAus(code, fx, gespeichert) {
    const c = normWaehrung(code)
    if (c === 'USD') return { code: 'USD', faktor: 1, quelle: null, datum: null }
    // `fxHeute` greift zuletzt selbst auf die Einstellung (mit 0.8 als Not-
    // nagel) zurück — das ist hier nicht gemeint, darum nur echte Kurse.
    const kurs = c === 'EUR' && fx?.eurAusChf ? NaN : Number(c === 'EUR' ? fx?.eur : fx?.chf)
    if (fx && fx.quelle !== 'Einstellung' && Number.isFinite(kurs) && kurs > 0) {
        return { code: c, faktor: kurs, quelle: fx.quelle || 'EZB', datum: fx.datum || null }
    }
    // Der gespeicherte Faktor ist ein CHF-Faktor
    const f = Number(gespeichert)
    if (c === 'CHF' && Number.isFinite(f) && f > 0) return { code: c, faktor: f, quelle: 'einstellung', datum: null }
    return { code: 'USD', faktor: 1, quelle: null, datum: null }
}

/** So lange wartet die Anzeige auf den Abruf, dann gilt der gemerkte Kurs. */
export const ANZEIGE_WARTEN_MS = 2500

/** Mit Abruf: Einstellungszeile → wirksamer Anzeigekurs. Wirft nie. */
export async function anzeigeWaehrung(zeile) {
    const code = normWaehrung(zeile?.waehrungCode)
    let fx = null
    let nachliefern = false
    if (code !== 'USD') {
        try {
            // Erst hier laden: `portfolio/kurse.js` zieht Datenbank und Marktdaten nach.
            const { fxHeute, fxGemerkt } = await import('./portfolio/kurse.js')
            const abruf = fxHeute().catch(() => null)
            let uhr
            const zuLang = new Promise((r) => { uhr = setTimeout(() => r(ZU_LANG), ANZEIGE_WARTEN_MS) })
            fx = await Promise.race([abruf, zuLang])
            clearTimeout(uhr)
            if (fx === ZU_LANG) {
                nachliefern = true
                fx = await fxGemerkt().catch(() => null)
            }
        } catch { fx = null }
    }
    const kurs = anzeigeKursAus(code, fx, zeile?.waehrungFaktor)
    return nachliefern ? { ...kurs, nachliefern } : kurs
}
const ZU_LANG = Symbol('zuLang')
