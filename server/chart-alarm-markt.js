/**
 * Zu welchem Markt (Krypto | Aktien) gehört ein Chart-Alarm? Rein, ohne
 * Datenbank — `chart-alarme.js` holt die Zutaten und fragt hier.
 *
 * Die Klasse folgt dem, WAS überwacht wird, nicht dem Markt, in dem die
 * Oberfläche gerade steht:
 *
 *   Watchlist-Alarm  → Markt seiner Watchlists (`chart_watchlists.anlageklasse`).
 *                      Listen aus beiden Märkten in einem Alarm sind ein Fehler:
 *                      der Alarm stünde in keiner der beiden Listen richtig.
 *   Symbol-Alarm     → Aktien, wenn der Titel-Stamm das Symbol als Aktien-Future
 *                      führt (`anlageklasseVon`), sonst Krypto. Spot ist immer
 *                      Krypto — Aktien gibt es im Chart nur als Future.
 *
 * Unbekanntes (leerer Stamm, keine Datenbank) ist Krypto, wie vor der
 * Aktien-Integration.
 *
 * Die Alarm-ARTEN (Preis, Linie, Zone, Momentum, LSOB) gelten in beiden
 * Märkten: sie lesen nur Kurs und Kerzen. Eine Art, die Krypto-Marktstruktur
 * braucht (Funding, Liquidationen, Open Interest), gibt es bei den
 * Chart-Alarmen nicht — käme eine dazu, gehört sie in `NUR_KRYPTO`, und
 * `artImMarkt` lehnt sie für Aktien ab.
 */
import { normMarkt } from './migrationen/aktien.js'

/** Alarm-Arten, die nur im Krypto-Markt etwas bedeuten (derzeit keine). */
export const NUR_KRYPTO = []

/** Darf diese Alarm-Art in diesem Markt angelegt werden? */
export function artImMarkt(art, klasse) {
    return klasse !== 'aktien' || !NUR_KRYPTO.includes(art)
}

/**
 * @param {object} p
 * @param {'futures'|'spot'} p.markt             Futures oder Spot des Alarms
 * @param {string|null} p.symbolKlasse            Klasse des Symbols laut Stamm (`krypto` | `aktien`), null = nicht gefragt/unbekannt
 * @param {Array<string|null>} p.watchlistKlassen `anlageklasse` der gewählten Watchlists (leer = Symbol-Alarm)
 * @returns {{klasse: 'krypto'|'aktien'} | {fehler: string}}
 */
export function alarmKlasse({ markt = 'futures', symbolKlasse = null, watchlistKlassen = [] } = {}) {
    if (watchlistKlassen.length) {
        const klassen = new Set(watchlistKlassen.map(normMarkt))
        if (klassen.size > 1) return { fehler: 'Die gewählten Watchlists gehören zu verschiedenen Märkten (Krypto und Aktien) — je Markt einen eigenen Alarm anlegen' }
        return { klasse: [...klassen][0] }
    }
    if (markt === 'spot') return { klasse: 'krypto' }
    return { klasse: normMarkt(symbolKlasse) }
}

/**
 * Filter der Liste: `krypto` | `aktien`, alles andere (fehlend, leer) = kein
 * Filter. Bewusst NICHT `normMarkt`: ohne Angabe liefert die Liste alles, wie
 * vor der Trennung (ESP32, ältere Aufrufer, Aktien-Teil aus).
 */
export function listenFilter(wert) {
    return wert === 'krypto' || wert === 'aktien' ? wert : null
}

/** Gehört die Zeile in die Liste dieses Markts? Zeilen ohne Angabe sind Krypto. */
export function zeileImMarkt(zeile, filter) {
    return !filter || normMarkt(zeile?.anlageklasse) === filter
}
