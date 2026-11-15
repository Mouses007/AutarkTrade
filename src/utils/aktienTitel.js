/**
 * Rechenhilfen der Titel-Seite einer Aktie (`components/aktien/TitelAnsicht.vue`).
 * Rein — die Seite zeigt nur, was hier gemessen wird; Unbekanntes bleibt null.
 */

/** Wo steht der Kurs in einer Spanne? 0 = am Tief, 100 = am Hoch; ausserhalb geklemmt. */
export function lageInSpanne(preis, tief, hoch) {
    if (![preis, tief, hoch].every((v) => typeof v === 'number' && Number.isFinite(v)) || !(hoch > tief)) return null
    return Math.min(100, Math.max(0, ((preis - tief) / (hoch - tief)) * 100))
}

/** Abstand eines Werts zum Kurs in Prozent (Kursziel 300 bei Kurs 150 → +100). */
export function abstandPct(wert, preis) {
    return typeof wert === 'number' && wert > 0 && typeof preis === 'number' && preis > 0 ? (wert / preis - 1) * 100 : null
}

/** Ganze Kalendertage bis zu einem Zeitpunkt (0 = heute, negativ = vorbei) in Ortszeit. */
export function tageBis(zeit, jetzt = Date.now()) {
    if (!zeit) return null
    const tag = (ms) => { const d = new Date(ms); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) }
    return Math.round((tag(zeit) - tag(jetzt)) / 86_400_000)
}

/**
 * Was die letzten Einstufungen zusammen sagen: wie viele herab- und
 * heraufgestuft haben und wie oft das Kursziel gesenkt bzw. erhöht wurde.
 * Gezählt wird nur, was die Quelle nennt — ein Eintrag ohne altes Kursziel
 * ist weder gesenkt noch erhöht.
 */
export function einstufungsBilanz(liste = []) {
    const b = { anzahl: liste.length, herab: 0, herauf: 0, zielGesenkt: 0, zielErhoeht: 0 }
    for (const e of liste) {
        if (e.aktion === 'down') b.herab++
        else if (e.aktion === 'up') b.herauf++
        if (e.ziel && e.zielVorher) {
            if (e.ziel < e.zielVorher) b.zielGesenkt++
            else if (e.ziel > e.zielVorher) b.zielErhoeht++
        }
    }
    return b
}

/**
 * Balken der Kursziele: Abstand zum Kurs je Ziel, die Breite relativ zum
 * grössten Abstand (0–100). Ziele ohne Wert fehlen.
 */
export function zielBalken(analysten, preis) {
    const zeilen = [['zielTief', analysten?.zielTief], ['zielMittel', analysten?.zielMittel], ['zielHoch', analysten?.zielHoch]]
        .map(([id, wert]) => ({ id, wert, pct: abstandPct(wert, preis) })).filter((z) => z.pct != null)
    const max = Math.max(...zeilen.map((z) => Math.abs(z.pct)), 0)
    return zeilen.map((z) => ({ ...z, breite: max ? (Math.abs(z.pct) / max) * 100 : 0 }))
}
