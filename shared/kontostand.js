/**
 * Kontostand einer Börse — die Regel der Dashboard-Karte „Kontostand"
 * (Spezifikation ansichten.md B.5), hier, damit Journal und KI-Agent dieselbe
 * Funktion rechnen. Bis 10/2026 nahm der Agent bei einem Börseneintrag ohne
 * `start` die alte Sammel-Einzahlung `startBalance`, das Journal 0.
 *
 * Rein, Browser und Server.
 */
const zahl = (x) => {
    const n = Number(x)
    return Number.isFinite(n) ? n : 0
}

/**
 * Der Bonus geht nur in den angezeigten Stand ein, damit er mit dem Wallet
 * übereinstimmt; Performance bleibt bonusfrei, sonst sähe ein geschenkter
 * Bonus wie Handelserfolg aus. Ohne Start-Einzahlung: null (kein Stand).
 */
export function kontostand({ benutzer, broker, allTimeNetPnL, positionen, bonus }) {
    const b = broker || 'bitunix'
    const eintrag = benutzer?.balances?.[b]
    const start = eintrag ? zahl(eintrag.start) : zahl(benutzer?.startBalance)
    if (start === 0) return null
    let unrealisiert = 0
    for (const p of positionen || []) {
        if (p?.status !== 'open') continue
        if (p.broker && p.broker !== b) continue
        const u = Number(p.unrealizedPNL)
        if (Number.isFinite(u)) unrealisiert += u
    }
    const B = zahl(bonus)
    const aktuell = start + zahl(allTimeNetPnL) + unrealisiert + B
    const pnl = aktuell - start - B
    const performance = start > 0 ? ((aktuell - B) / start - 1) * 100 : 0
    return { start, unrealisiert, bonus: B, aktuell, pnl, performance }
}
