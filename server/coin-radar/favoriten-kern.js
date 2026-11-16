/**
 * Favoriten Coins, der Teil ohne Netz und ohne Datenbank: die bestehende
 * Favoritenliste (`hype_favoriten`) mit dem letzten Stand der beiden Radare
 * zusammenführen.
 *
 * Es gibt bewusst KEINEN neuen Favoritenbegriff. `hype_favoriten` ist die
 * Liste, an der die Sterne von Hype-Radar und Coin-Radar schon hängen und die
 * der Wachhund überwacht (`server/hype-radar/wachhund.js`). Die Chart-
 * Favoritenlisten (`chart_watchlists`) sind etwas anderes: mehrere benannte
 * Symbol-Listen je Markt zum Durchblättern im Chart, ohne Stern in den
 * Radaren und ohne Wache. Diese Seite liest nur — sie legt nichts an und
 * ändert weder Favoriten noch Alarme.
 *
 * Zwei Arten von Favoriten stehen in der Tabelle:
 *   boerse   Stern im Coin-Radar (`quelle = 'coinradar'`, kein Vertrag): ein
 *            Perp-Symbol. Stand = seine Zeile im letzten Coin-Radar-Lauf.
 *   dex      Fund des Hype-Radars (Kette + Vertrag). Stand = seine letzte Prüfung.
 *
 * Wie bei den Aktien verschwindet nichts: ein Favorit, der im letzten Lauf
 * fehlt oder an einer Hürde scheiterte, sagt das.
 *
 *   bewertet | huerde | nichtImLauf | keinLauf      (boerse)
 *   geprueft | ohnePruefung                         (dex)
 */

const istBoerse = (f) => f.quelle === 'coinradar' || (!f.chain && !f.contractAddress)

/**
 * @param {object[]} favoriten  Zeilen aus `hype_favoriten`
 * @param {object} d
 * @param {object|null} d.lauf           letzter fertiger Coin-Radar-Lauf (Krypto) oder `null`
 * @param {object[]} d.zeilen            Zeilen dieses Laufs zu den Favoriten-Symbolen, JSON-Felder gelesen
 * @param {object[]} d.pruefungen        je DEX-Favorit die jüngste Zeile aus `hype_candidates` (mit `symbol`, `chain`)
 * @param {Map<number, number>} [d.ungelesen]  Favorit-ID → Zahl ungelesener Alarme
 * @returns {object[]}  bewertete zuerst (beste Note oben), dann die übrigen nach Symbol
 */
export function coinFavoritenZeilen(favoriten = [], { lauf = null, zeilen = [], pruefungen = [], ungelesen = new Map() } = {}) {
    const jeSymbol = new Map(zeilen.map((z) => [z.symbol, z]))
    const jePruefung = new Map(pruefungen.map((p) => [`${p.symbol}|${p.chain || ''}`, p]))
    const aus = favoriten.map((f) => {
        const kopf = {
            id: f.id, symbol: f.symbol, name: f.name || '', stumm: Number(f.stumm) === 1,
            erstelltAm: Number(f.erstelltAm) || null, alarmeUngelesen: ungelesen.get(f.id) || 0,
        }
        if (!istBoerse(f)) {
            const p = jePruefung.get(`${f.symbol}|${f.chain || ''}`) || null
            return {
                ...kopf, art: 'dex', chain: f.chain || '', contractAddress: f.contractAddress || '', narrative: f.narrative || '',
                status: p ? 'geprueft' : 'ohnePruefung',
                pruefung: p ? {
                    hypeScore: p.hypeScore ?? null, safetyScore: p.safetyScore ?? null,
                    status: p.status || '', verworfenGrund: p.verworfenGrund || '', zeit: Number(p.erstelltAm) || null,
                } : null,
            }
        }
        const z = lauf ? jeSymbol.get(f.symbol) || null : null
        const status = !lauf ? 'keinLauf' : !z ? 'nichtImLauf' : z.status === 'bewertet' ? 'bewertet' : 'huerde'
        const bewertet = status === 'bewertet'
        return {
            ...kopf, art: 'boerse', status,
            huerdeGrund: status === 'huerde' ? (z.huerdeGrund || 'unbekannt') : null,
            // Eine Hürden-Zeile trägt keine Note — nur was gemessen ist.
            rang: bewertet ? (z.rang || null) : null,
            note: bewertet ? (z.note ?? null) : null,
            teilnoten: bewertet ? (z.teilnoten || null) : null,
            atrPct: bewertet ? (z.atrPct ?? null) : null,
            rvol: bewertet ? (z.rvol ?? null) : null,
            adx: bewertet ? (z.adx ?? null) : null,
            fundingJahresRate: bewertet ? (z.fundingJahresRate ?? null) : null,
            noteAusfuehrung: bewertet ? (z.noteAusfuehrung ?? null) : null,
            umsatz24h: z ? (z.umsatz24h ?? null) : null,
            spreadBp: z ? (z.spreadBp ?? null) : null,
            boersen: z?.boersen?.liste || [],
        }
    })
    const stufe = (x) => (x.status === 'bewertet' ? 0 : x.art === 'boerse' ? 1 : 2)
    return aus.sort((a, b) => stufe(a) - stufe(b) || (b.note ?? -1) - (a.note ?? -1) || a.symbol.localeCompare(b.symbol))
}

export { istBoerse as istBoersenFavorit }
