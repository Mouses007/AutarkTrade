/**
 * Formatierung der Bot-Seite. Unbekannt (null/undefined/NaN) wird „—", nie 0.
 *
 * Vorzeichen und Farbe hängen am GERUNDETEN Wert: «-0.0 %» in Rot oder
 * «+0.00 USDT» in Grün sagten etwas, das die Zahl daneben nicht zeigt (Audit UI-12).
 */
const LEER = '—'
const ok = (v) => typeof v === 'number' && Number.isFinite(v)
const TAG_MS = 86_400_000

/** Auf `stellen` Nachkommastellen runden; aus −0 wird 0. */
function runde(v, stellen) {
    const r = Number(v.toFixed(Math.max(0, Math.min(20, stellen))))
    return r === 0 ? 0 : r
}
/** Nachkommastellen für vier GÜLTIGE Stellen unter 1 (0.00004 → 8), höchstens 8; ab 1 vier. */
function coinStellen(v) {
    const a = Math.abs(v)
    if (!(a > 0) || a >= 1) return 4
    return Math.min(8, Math.max(4, 3 - Math.floor(Math.log10(a))))
}
const stellenFuer = (v, muenze) => (muenze === 'USDT' ? 2 : coinStellen(v))

/** Preis mit sinnvollen Stellen: grosse Preise 2, kleine bis 6 signifikante. */
export function preis(v) {
    if (!ok(v)) return LEER
    const a = Math.abs(v)
    // unter 1: sechs GÜLTIGE Stellen, nicht sechs Nachkommastellen — 0.00000876 stand sonst als «0.000009»,
    // 1.2e-7 als «0.00» (Audit UI-06)
    const stellen = a >= 1000 ? 1 : a >= 100 ? 2 : a >= 1 ? 4 : a > 0 ? Math.min(12, Math.max(6, 5 - Math.floor(Math.log10(a)))) : 6
    return new Intl.NumberFormat('de-CH', { maximumFractionDigits: stellen, minimumFractionDigits: Math.min(2, stellen) }).format(v)
}

/**
 * Betrag in der Margin-Münze: USDT 2 Stellen; eine Coin 4, unter 1 aber vier GÜLTIGE
 * (0.00004 BTC sind rund 4 USD und standen als «0.0000 BTC»). Mit Vorzeichen auf Wunsch.
 */
export function betrag(v, muenze = 'USDT', { vorzeichen = false } = {}) {
    if (!ok(v)) return LEER
    const stellen = stellenFuer(v, muenze)
    const r = runde(v, stellen)
    const s = new Intl.NumberFormat('de-CH', { maximumFractionDigits: stellen, minimumFractionDigits: muenze === 'USDT' ? 2 : 4 }).format(r)
    return `${vorzeichen && r > 0 ? '+' : ''}${s}${muenze ? ` ${muenze}` : ''}`
}

/** Anteil (0.123) als Prozent („12.3 %"). */
export function prozent(v, { stellen = 1, vorzeichen = false } = {}) {
    if (!ok(v)) return LEER
    const r = runde(v * 100, stellen)
    const s = new Intl.NumberFormat('de-CH', { maximumFractionDigits: stellen, minimumFractionDigits: stellen }).format(r)
    return `${vorzeichen && r > 0 ? '+' : ''}${s} %`
}

export function zahl(v, stellen = 0) {
    if (!ok(v)) return LEER
    return new Intl.NumberFormat('de-CH', { maximumFractionDigits: stellen }).format(runde(v, stellen))
}

/**
 * Stückzahl einer Position oder Menge je Grid, mit Einheit: Stellen nach Grösse
 * (ab 1 bis 4, darunter vier gültige) — «0» für 0.0123 BTC las sich wie «keine Position» (Audit UI-07).
 */
export function menge(v, einheit = '') {
    if (!ok(v)) return LEER
    const s = zahl(v, Math.abs(v) >= 1000 ? 2 : coinStellen(v))
    return einheit ? `${s} ${einheit}` : s
}

/** Einheit der Positionsmenge: Coin-M zählt in USD-Kontrakten, USDT-M und Spot in der Coin. */
export function mengenEinheit(bot) {
    return bot?.coinM ? 'USD' : (bot?.coin || '')
}

export function datum(ms) {
    if (!ok(ms) || ms <= 0) return LEER
    return new Date(ms).toLocaleString('de-CH', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/** Dauer aus Tagen: unter einer Stunde in Minuten, unter einem Tag in Stunden; nie negativ. */
export function dauer(tage) {
    if (!ok(tage)) return LEER
    const d = Math.max(0, tage)
    if (d < 1 / 24) return `${Math.round(d * 1440)} min`
    if (d < 1) return `${Math.round(d * 24)} h`
    return `${zahl(d, d < 10 ? 1 : 0)} d`
}

/**
 * Laufzeit eines Bots in Tagen. Aus `erstellt`/`beendet`, wenn vorhanden: `kennzahlen.tage`
 * hat serverseitig eine Untergrenze von einer Stunde (für die Hochrechnung aufs Jahr),
 * ein zwei Minuten alter Bot zeigte damit «1 h».
 */
export function laufzeitTage(bot, tage = null, jetzt = Date.now()) {
    const ende = ok(bot?.beendet) && bot.beendet > 0 ? bot.beendet : (bot?.laufend ? jetzt : null)
    if (ok(bot?.erstellt) && bot.erstellt > 0 && ende != null) return Math.max(0, (ende - bot.erstellt) / TAG_MS)
    return tage
}

/**
 * Ton für einen Betrag mit Vorzeichen: gut / schlecht / neutral — nach dem Wert, wie
 * `betrag` ihn zeigt (0.004 USDT steht als «0.00 USDT» da und ist nicht grün).
 * `muenze: null` = reine Zahl ohne Rundung (Anteile).
 */
export function ton(v, muenze = 'USDT') {
    if (!ok(v)) return 'neutral'
    const r = muenze == null ? (Math.abs(v) < 1e-9 ? 0 : v) : runde(v, stellenFuer(v, muenze))
    return r === 0 ? 'neutral' : r > 0 ? 'gut' : 'schlecht'
}

/** Ton für einen Anteil, wie `prozent` ihn zeigt («0.0 %» ist neutral). */
export function tonProzent(v, stellen = 1) {
    if (!ok(v)) return 'neutral'
    const r = runde(v * 100, stellen)
    return r === 0 ? 'neutral' : r > 0 ? 'gut' : 'schlecht'
}
