/**
 * Übergabe Import → Live (rein, selbstgetestet).
 *
 * Eine Wallet-Adresse kann die Historie importierter Orte fortsetzen
 * (`importOrte`, `liveAb`). Bis zum Stichtag zählt der Import, danach live.
 * Für den BESTAND heute heisst das: was die Live-Abfrage meldet, ersetzt den
 * Import. Liest die Live-Seite nicht alles (EVM ohne Explorer-Schlüssel kennt
 * nur ETH/BNB/POL, XRP und VeChain nur ihre Hauptwährung), bleiben die übrigen
 * Coins aus dem Import stehen — sonst verschwänden Token, die sich niemand
 * bewegt hat, nur weil die App sie nicht live sehen kann.
 *
 * Erst wenn die Adresse einmal erfolgreich gelesen wurde, ersetzt sie etwas;
 * vorher stünde für einen Moment gar nichts da.
 */

/**
 * @param {Array<{quelle, asset}>} bestaende
 * @param {Array<{id, importOrte, liveAb}>} adressen  importOrte als Array oder JSON
 * @param {Map<string, {status, stand}>} standVon     portfolio_quellen je quelle
 * @returns {{ ersetzt: Map<string, {adressId, liveAb, alle: boolean, assets: Set<string>}> }}
 *   Schlüssel = Import-Quelle (`i:<Ort>`)
 */
export function uebergaben(bestaende, adressen, standVon) {
    const ersetzt = new Map()
    for (const a of adressen || []) {
        let orte = a.importOrte
        if (typeof orte === 'string') { try { orte = JSON.parse(orte) } catch { orte = [] } }
        if (!Array.isArray(orte) || !orte.length) continue
        const live = `a${a.id}`
        const st = standVon.get(live)
        if (!st || st.status !== 'ok') continue
        let vollstaendig = false
        try { vollstaendig = !!JSON.parse(st.stand || '{}').vollstaendig } catch { /* */ }
        const assets = new Set(bestaende.filter((b) => b.quelle === live).map((b) => b.asset))
        for (const ort of orte) {
            ersetzt.set(`i:${ort}`, { adressId: a.id, liveAb: Number(a.liveAb) || null, alle: vollstaendig, assets })
        }
    }
    return { ersetzt }
}

/** Bestandszeilen ohne die, die eine Live-Adresse übernommen hat. */
export function ohneUebernommene(bestaende, ersetzt) {
    return bestaende.filter((b) => {
        const e = ersetzt.get(b.quelle)
        if (!e) return true
        return !(e.alle || e.assets.has(b.asset))
    })
}
