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
import { PAGES, MODES, modeHome, istModusAn } from './menu.js'

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

/** Hat der Modus in diesem Markt überhaupt eine Seite? Sonst fehlt er in der Kopfleiste. */
export function modusImMarkt(modusId, markt) {
    return PAGES.some((p) => p.mode === modusId && seiteImMarkt(p, markt))
}

/** Ist die Seite unter dieser Adresse in diesem Markt erreichbar (Markt, Modus und Seiten-Schalter)? */
export function erreichbar(pfad, markt, einstellungen) {
    const seite = PAGES.find((p) => p.path === pfad)
    if (!seite || !seiteImMarkt(seite, markt)) return false
    if (seite.mode && !istModusAn(seite.mode, einstellungen)) return false
    const v = seite.flag ? einstellungen?.[seite.flag] : undefined
    return !(v === 0 || v === '0' || v === false)
}

/**
 * Wohin es geht, wenn eine Seite im aktiven Markt nicht gilt (Adresse von
 * Hand, Lesezeichen, Markt-Umschalter): zuerst ihr Gegenstück, dann die
 * Startseite ihres Modus, dann der Ersatz des Modus, zuletzt die Startseite
 * des ersten Modus, den der Markt hat. `null` = die Seite gilt, nichts zu tun.
 *
 * @param {object|null} seite          Eintrag aus `PAGES`
 * @param {string} markt               krypto | aktien
 * @param {object|null} einstellungen  die Einstellungszeile
 * @returns {string|null}
 */
export function zielImMarkt(seite, markt, einstellungen) {
    if (!seite || seiteImMarkt(seite, markt)) return null
    const modus = MODES.find((m) => m.id === seite.mode)
    const kandidaten = [seite.gegenstueck?.[markt]]
    if (modus && modusImMarkt(modus.id, markt)) kandidaten.push(modeHome(modus.id, markt))
    kandidaten.push(modus?.ersatzJeMarkt?.[markt])
    for (const pfad of kandidaten) if (pfad && erreichbar(pfad, markt, einstellungen)) return pfad
    const erster = MODES.find((m) => istModusAn(m.id, einstellungen) && modusImMarkt(m.id, markt))
    return modeHome(erster?.id || 'journal', markt)
}
