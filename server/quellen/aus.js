/**
 * „Diese Quelle ist aus" — eine Form für alle Gründe, aus denen eine Funktion
 * keine Daten zeigt, obwohl nichts kaputt ist (Verkaufs-Prüfung S12):
 *
 *   schluesselFehlt  Quelle nur mit Kundenschlüssel (CoinGecko, CryptoQuant,
 *                    Solana-RPC …), und es ist keiner hinterlegt
 *   entfernt         Quelle wurde aus Lizenzgründen entfernt, ohne Ersatz
 *   aus              Quelle ist vom Kunden abgeschaltet
 *   ohneFreigabe     Quelle ohne Verkaufsfreigabe, Schalter „Quellen ohne
 *                    Verkaufsfreigabe" ist aus (S15, `freigabe.js`)
 *   marktdaten       Marktdatenquelle hat die Fähigkeit nicht (`marktdaten/index.js`)
 *
 * Routen antworten darauf mit HTTP 200 und `{ aus: true, grund, quelle,
 * meldung, faehigkeit? }` — kein Fehler, sondern ein Zustand, den die
 * Oberfläche (`src/components/quellen/QuelleAus.vue`) in Worte fasst.
 */

import { istAus as istMarktdatenAus, ausAntwort as marktdatenAntwort } from '../marktdaten/index.js'

export const GRUENDE = ['schluesselFehlt', 'entfernt', 'aus', 'ohneFreigabe', 'marktdaten']

export class QuelleAus extends Error {
    /**
     * @param {string} quelle  Anzeigename („CoinGecko")
     * @param {string} grund   einer aus GRUENDE
     * @param {string} [meldung]
     */
    constructor(quelle, grund, meldung) {
        super(meldung || standardMeldung(quelle, grund))
        this.code = 'quelleAus'
        this.quelle = quelle
        this.grund = grund
        this.status = 409
    }
}

function standardMeldung(quelle, grund) {
    if (grund === 'schluesselFehlt') return `${quelle}: nur mit eigenem API-Schlüssel (Einstellungen › Datenquellen)`
    if (grund === 'entfernt') return `${quelle} ist aus Lizenzgründen nicht mehr angebunden`
    if (grund === 'aus') return `${quelle} ist ausgeschaltet`
    if (grund === 'ohneFreigabe') return `${quelle} ist aus (Einstellungen › Datenquellen › Quellen ohne Verkaufsfreigabe)`
    return `${quelle} nicht verfügbar`
}

export function istAus(e) {
    return e instanceof QuelleAus || e?.code === 'quelleAus' || istMarktdatenAus(e)
}

export function ausAntwort(e) {
    if (istMarktdatenAus(e)) return marktdatenAntwort(e)
    return { aus: true, grund: e.grund, quelle: e.quelle, meldung: e.message }
}

/** In einer Route: `if (sendeWennAus(res, e)) return`. */
export function sendeWennAus(res, e) {
    if (!istAus(e)) return false
    res.json(ausAntwort(e))
    return true
}
