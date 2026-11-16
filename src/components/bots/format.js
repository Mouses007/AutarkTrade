/**
 * Formatierung der Bot-Seite. Unbekannt (null/undefined/NaN) wird „—", nie 0.
 */
const LEER = '—'
const ok = (v) => typeof v === 'number' && Number.isFinite(v)

/** Preis mit sinnvollen Stellen: grosse Preise 2, kleine bis 6 signifikante. */
export function preis(v) {
    if (!ok(v)) return LEER
    const a = Math.abs(v)
    // unter 1: sechs GÜLTIGE Stellen, nicht sechs Nachkommastellen — 0.00000876 stand sonst als «0.000009»,
    // 1.2e-7 als «0.00» (Audit UI-06)
    const stellen = a >= 1000 ? 1 : a >= 100 ? 2 : a >= 1 ? 4 : a > 0 ? Math.min(12, Math.max(6, 5 - Math.floor(Math.log10(a)))) : 6
    return new Intl.NumberFormat('de-CH', { maximumFractionDigits: stellen, minimumFractionDigits: Math.min(2, stellen) }).format(v)
}

/** Betrag in der Margin-Münze: USDT 2 Stellen, eine Coin 4. Mit Vorzeichen auf Wunsch. */
export function betrag(v, muenze = 'USDT', { vorzeichen = false } = {}) {
    if (!ok(v)) return LEER
    const stellen = muenze === 'USDT' ? 2 : 4
    if (Math.abs(v) < 0.5 * 10 ** -stellen) v = 0   // kein „−0.0000"
    const s = new Intl.NumberFormat('de-CH', { maximumFractionDigits: stellen, minimumFractionDigits: stellen }).format(v)
    return `${vorzeichen && v > 0 ? '+' : ''}${s} ${muenze}`
}

/** Anteil (0.123) als Prozent („12.3 %"). */
export function prozent(v, { stellen = 1, vorzeichen = false } = {}) {
    if (!ok(v)) return LEER
    const s = new Intl.NumberFormat('de-CH', { maximumFractionDigits: stellen, minimumFractionDigits: stellen }).format(v * 100)
    return `${vorzeichen && v > 0 ? '+' : ''}${s} %`
}

export function zahl(v, stellen = 0) {
    if (!ok(v)) return LEER
    return new Intl.NumberFormat('de-CH', { maximumFractionDigits: stellen }).format(v)
}

export function datum(ms) {
    if (!ok(ms) || ms <= 0) return LEER
    return new Date(ms).toLocaleString('de-CH', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function dauer(tage) {
    if (!ok(tage)) return LEER
    if (tage < 1) return `${Math.round(tage * 24)} h`
    return `${zahl(tage, tage < 10 ? 1 : 0)} d`
}

/** Ton für eine Zahl mit Vorzeichen: gut / schlecht / neutral. */
export function ton(v) {
    if (!ok(v) || Math.abs(v) < 1e-9) return 'neutral'
    return v > 0 ? 'gut' : 'schlecht'
}
