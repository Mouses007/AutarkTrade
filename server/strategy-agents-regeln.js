/**
 * Regeln des Agenten-Vetos, rein (kein Netz, keine DB) — damit der Selbsttest
 * sie ohne Modell und ohne Datenbank festhalten kann.
 */

/**
 * Welcher Tagesdeckel gilt.
 *
 * Der Regler in den Einstellungen (`strategyLlmBudgetUsd`) ist die Grenze, die
 * der Nutzer sieht — er gilt. Bis 24.10.2026 schlug der Instanzwert ihn: jede
 * Instanz bekam beim Anlegen `dailyBudgetUsd: 1.0` mitgespeichert, und der
 * Regler wurde nur gelesen, wenn dieser Wert 0 war. Ein Regler auf 0,20 USD
 * liess die Agenten bis 1 USD laufen, einer auf 5 USD stoppte sie bei 1 USD.
 * Die Oberfläche kennt keinen Instanzwert; er zählt nur noch, wenn die
 * Einstellung fehlt.
 *
 * @returns {number} Deckel in USD; 0 heisst: kein Budget, keine Agentenläufe
 */
export function budgetDeckel(einstellung, instanzWert) {
    const e = einstellung == null || einstellung === '' ? NaN : Number(einstellung)
    if (Number.isFinite(e)) return Math.max(0, e)
    const i = Number(instanzWert)
    return Number.isFinite(i) && i > 0 ? i : 1
}

/**
 * Verkleinerungsfaktor aus der Antwort des Vetos.
 *
 * `Number(x) || 1` machte aus einer 0 — „Grösse null" — die volle Grösse. Eine
 * 0 bleibt jetzt 0 (der Aufrufer behandelt sie als Ablehnung); nur ein
 * fehlender oder unlesbarer Faktor heisst „nicht verkleinert".
 */
export function vetoFaktor(roh) {
    if (roh == null || roh === '') return 1
    const f = Number(roh)
    if (!Number.isFinite(f)) return 1
    return Math.min(Math.max(f, 0), 1)
}
