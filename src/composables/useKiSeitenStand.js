/**
 * Meldet dem KI-Coach, was auf dieser Seite gerade gewählt ist.
 *
 *   useKiSeitenStand(() => ({ reiter: reiter.value, aufgeklappt: offen.value }))
 *
 * Die Funktion wird erst gerufen, wenn der Nutzer in der Coach-Leiste eine
 * Frage sendet — sie kostet im Normalbetrieb nichts. Erlaubt sind nur die
 * Felder, die `server/ki-seitenstand.js` kennt (reiter, ansicht, symbol,
 * zeiteinheit, markt, boerse, kachel, zeitraum, datum, instanzId,
 * strategieId, berichtId, anzahl, aufgeklappt, token {kuerzel, name, kette,
 * vertrag}, filter {…}, chart {symbol, interval, markt, bis}); alles andere
 * verwirft der Server.
 */
import { onMounted, onBeforeUnmount } from 'vue'
import { meldeSeitenStand, vergissSeitenStand } from '../stores/app/kiCoach.js'

export function useKiSeitenStand(geber) {
    onMounted(() => meldeSeitenStand(geber))
    onBeforeUnmount(() => vergissSeitenStand(geber))
}
