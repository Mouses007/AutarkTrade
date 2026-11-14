/** Selbsttest: Markt-Umschalter Krypto ↔ Aktien (config/markt.js) und seine Menü-Einträge. */
import assert from 'node:assert/strict'
import { istAktienAn, marktAus, seiteImMarkt } from '../config/markt.js'
import { PAGES, MODES, modeHome, pagesForMode } from '../config/menu.js'

let n = 0
const gleich = (a, b, text) => { assert.deepEqual(a, b, text); n++ }

// Unwissen ist Krypto
gleich(marktAus(undefined), 'krypto', 'ohne Einstellungen')
gleich(marktAus({}), 'krypto', 'leere Einstellungen')
gleich(marktAus({ aktiverMarkt: 'aktien' }), 'krypto', 'Markt Aktien, Modus aus')
gleich(marktAus({ aktiverMarkt: 'aktien', modusAktienAn: 0 }), 'krypto', 'Modus 0')
gleich(marktAus({ aktiverMarkt: 'aktien', modusAktienAn: false }), 'krypto', 'Modus false')
gleich(marktAus({ aktiverMarkt: 'forex', modusAktienAn: 1 }), 'krypto', 'unbekannter Markt')
gleich(marktAus({ aktiverMarkt: 'krypto', modusAktienAn: 1 }), 'krypto', 'Markt Krypto')
// SQLite liefert 1, PostgreSQL true, ein altes Backup '1'
for (const an of [1, true, '1']) gleich(marktAus({ aktiverMarkt: 'aktien', modusAktienAn: an }), 'aktien', `Modus ${JSON.stringify(an)}`)
gleich([istAktienAn({ modusAktienAn: 1 }), istAktienAn({ modusAktienAn: '0' }), istAktienAn(null)], [true, false, false], 'istAktienAn')

// Seiten
gleich(seiteImMarkt({ id: 'x' }, 'aktien') && seiteImMarkt({ id: 'x' }, 'krypto'), true, 'Seite ohne Markt gilt überall')
gleich([seiteImMarkt({ markt: 'aktien' }, 'krypto'), seiteImMarkt({ markt: 'aktien' }, 'aktien')], [false, true], 'Seite mit Markt')

// Menü: im Markt Krypto sieht Research aus wie vor der Aktien-Integration
const research = pagesForMode('research')
gleich(research.filter((s) => seiteImMarkt(s, 'krypto')).map((s) => s.id),
    ['hypeRadar', 'hypeFrueh', 'hypeBoersen', 'hypeBerichte', 'coinRadar', 'coinVerlauf', 'coinAbverkauf'], 'Research im Markt Krypto unverändert')
gleich(research.filter((s) => seiteImMarkt(s, 'aktien')).map((s) => s.id), ['newcomerRadar', 'aktienRadar', 'aktienStamm'], 'Research im Markt Aktien')
// Jede Aktien-Seite hängt am Schalter, sonst stünde sie nach dem Abschalten noch im Menü
gleich(PAGES.filter((s) => s.markt === 'aktien' && s.flag !== 'modusAktienAn').map((s) => s.id), [], 'Aktien-Seiten tragen das Flag')
// Ausserhalb von Research ist (noch) keine Seite an einen Markt gebunden
gleich(PAGES.filter((s) => s.markt && s.mode !== 'research').map((s) => s.id), [], 'nur Research ist marktgebunden')

// Startadressen
gleich(modeHome('research'), '/hype-radar', 'Research ohne Markt')
gleich(modeHome('research', 'krypto'), '/hype-radar', 'Research Krypto')
gleich(modeHome('research', 'aktien'), '/newcomer-radar', 'Research Aktien')
for (const m of MODES.filter((x) => x.id !== 'research')) gleich(modeHome(m.id, 'aktien'), m.home, `${m.id} hat eine Startadresse für beide Märkte`)
// Die Startadresse je Markt ist eine Seite dieses Markts
for (const m of MODES) for (const [markt, pfad] of Object.entries(m.homeJeMarkt || {})) {
    gleich(PAGES.find((s) => s.path === pfad)?.markt, markt, `${m.id}: ${pfad} gehört zu ${markt}`)
}

console.log(`✓ Markt-Umschalter: ${n} Prüfungen`)
