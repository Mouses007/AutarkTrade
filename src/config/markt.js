/**
 * Der Markt-Umschalter Krypto ↔ Aktien (Aktien-Integration, `docs/PLAN-AKTIEN.md`).
 *
 * Reines Datenmodul wie `menu.js` (keine Vue-Abhängigkeit): wer rendert, reicht
 * die Einstellungszeile herein.
 *
 *   settings.modusAktienAn   Aktien-Teil überhaupt eingeschaltet (Vorgabe aus)
 *   settings.aktiverMarkt    krypto | aktien
 *
 * Unwissen ist Krypto: solange die Einstellungen nicht geladen sind, der Modus
 * aus ist oder ein unbekannter Wert gespeichert wurde, verhält sich die App
 * wie vor der Aktien-Integration.
 */
export const MAERKTE = ['krypto', 'aktien']

/** Ist der Aktien-Teil eingeschaltet? */
export function istAktienAn(einstellungen) {
    const v = einstellungen?.modusAktienAn
    return v === true || Number(v) === 1
}

/** Der Markt, in dem die App gerade steht. */
export function marktAus(einstellungen) {
    return istAktienAn(einstellungen) && einstellungen?.aktiverMarkt === 'aktien' ? 'aktien' : 'krypto'
}

/** Gehört die Seite in diesen Markt? Seiten ohne `markt` gelten in beiden. */
export function seiteImMarkt(seite, markt) {
    return !seite?.markt || seite.markt === markt
}
