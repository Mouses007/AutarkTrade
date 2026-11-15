/**
 * Nachtrag der Art (`roh.klassen`) an gespeicherten Bitpanda-Bewegungen — NUR die Rechnung (RAS-02).
 *
 * Seit dem 15.11.2026 hält `ausBitpandaOperationen` je Bewegung fest, ob eine
 * Seite Aktie, ETF oder belegt keine Aktie ist. Zeilen von davor tragen das
 * Feld nicht und bekommen es auch nie: `abruf.js` speichert mit
 * `onConflict(...).ignore()`, und Folgeläufe lesen nur ab der jüngsten
 * Bewegung. Solange gilt für sie der Rückfall in `aktienKlasseVon`.
 *
 * Diese Datei berechnet, was an den Bestandsdaten zu ergänzen WÄRE. Sie
 * schreibt nichts, liest keine Datenbank und fragt kein Netz; sie hängt mit
 * Absicht an keinem Abruf, Takt oder an einer Migration. Ob Bestandsdaten
 * geändert werden, entscheidet der Nutzer.
 */
import { KLASSEN } from './aktien-art.js'

/** So schreibt `bewerteBewegungen` eine Zeile, die es für eine Aktie ohne Geldseite hielt. */
export const OHNE_KURS_AKTIE = 'kein Kurs (Aktie ohne Handelsbetrag)'

const gross = (s) => String(s || '').toUpperCase()
const gleich = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) <= 1e-9 * Math.max(1, Math.abs(Number(a) || 0))

/**
 * Ergänzungen aus (gespeicherten Zeilen, frisch gelesenen Operationen). Rein.
 *
 * Zugeordnet wird über `externeId` (Bitpandas `operation_id`, bei Index-Operationen
 * `operation_id:KÜRZEL`). Ergänzt wird nur, wenn die gespeicherte Zeile dieselbe
 * Bewegung ist (Asset, Gegen-Asset und Mengen gleich) und selbst noch keine Art
 * trägt — eine Zeile, die schon `klassen` hat, bleibt, wie sie ist.
 *
 * `chfZuruecksetzen` nennt, wo die Bewertung mit der alten Zuordnung entstand
 * und neu zu rechnen wäre (`chfWert` und `chfQuelle` auf NULL, der nächste
 * Lauf von `bewerteBewegungen` bewertet sie dann):
 *   - `'coin'`:  die Zeile blieb «Aktie ohne Handelsbetrag», ist aber ein Coin (Staking-Ertrag LDO),
 *   - `'aktie'`: die Zeile ohne Geldseite trägt einen Wert über das Kürzel, ist aber eine Aktie.
 *
 * @param {Array<{id: number, externeId: string, asset: string, menge: number, gegenAsset?: string|null,
 *                gegenMenge?: number|null, roh?: string|object|null, chfWert?: number|null, chfQuelle?: string|null}>} gespeichert
 *        Zeilen aus `portfolio_bewegungen` mit `quelle = 'bitpanda'`
 * @param {Array<{externeId: string, asset: string, menge: number, gegenAsset?: string|null, gegenMenge?: number|null, roh?: object}>} frisch
 *        Ergebnis von `ausBitpandaOperationen(ops, symbole, artVon)` über die GANZE Historie
 * @returns {{ ergaenzungen: Array<{id: number, externeId: string, klassen: Record<string, string>, roh: string, chfZuruecksetzen: 'coin'|'aktie'|null}>,
 *             abweichend: Array<{id: number, externeId: string, grund: string}>,
 *             ohneGegenstueck: number, schonBelegt: number, ohneArt: number }}
 *   `abweichend` = Zeilen, deren frisch gelesenes Gegenstück nicht dieselbe Bewegung ist — nichts ergänzen, ansehen.
 *   `ohneGegenstueck` = gespeicherte Zeilen, die Bitpanda nicht (mehr) liefert; `ohneArt` = frisch gelesen, aber weiter ohne belegte Art.
 */
export function klassenNachtrag(gespeichert, frisch) {
    const neu = new Map((frisch || []).map((b) => [String(b.externeId), b]))
    const aus = { ergaenzungen: [], abweichend: [], ohneGegenstueck: 0, schonBelegt: 0, ohneArt: 0 }
    for (const z of gespeichert || []) {
        const f = neu.get(String(z.externeId))
        if (!f) { aus.ohneGegenstueck++; continue }
        let roh = z.roh
        if (typeof roh === 'string') {
            try { roh = JSON.parse(roh) } catch { aus.abweichend.push({ id: z.id, externeId: z.externeId, grund: 'Rohfeld nicht lesbar' }); continue }
        }
        roh = roh && typeof roh === 'object' ? roh : {}
        if (roh.klassen && typeof roh.klassen === 'object') { aus.schonBelegt++; continue }
        const klassen = f.roh?.klassen
        if (!klassen || typeof klassen !== 'object' || !Object.keys(klassen).length) { aus.ohneArt++; continue }
        const selbe = gross(z.asset) === gross(f.asset) && gross(z.gegenAsset) === gross(f.gegenAsset) && gleich(z.menge, f.menge) && gleich(z.gegenMenge, f.gegenMenge)
        if (!selbe) { aus.abweichend.push({ id: z.id, externeId: z.externeId, grund: 'Asset oder Menge weicht ab' }); continue }
        const art = (asset) => (asset && gross(asset) in klassen ? klassen[gross(asset)] : undefined)
        const istAktie = (asset) => KLASSEN.includes(art(asset))
        let chfZuruecksetzen = null
        if (z.chfQuelle === OHNE_KURS_AKTIE && !istAktie(z.asset) && !istAktie(z.gegenAsset) && art(z.asset) === '') chfZuruecksetzen = 'coin'
        else if (!z.gegenAsset && istAktie(z.asset) && z.chfWert != null) chfZuruecksetzen = 'aktie'
        aus.ergaenzungen.push({ id: z.id, externeId: z.externeId, klassen, roh: JSON.stringify({ ...roh, klassen }), chfZuruecksetzen })
    }
    return aus
}
