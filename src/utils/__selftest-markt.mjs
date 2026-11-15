/** Selbsttest: Markt-Umschalter Krypto ↔ Aktien (config/markt.js) und seine Menü-Einträge. */
import assert from 'node:assert/strict'
import { istAktienAn, marktAus, seiteImMarkt, modusImMarkt, zielImMarkt } from '../config/markt.js'
import { PAGES, MODES, modeHome, pagesForMode, pageById } from '../config/menu.js'

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
gleich(research.filter((s) => seiteImMarkt(s, 'aktien')).map((s) => s.id), ['newcomerRadar', 'aktienRadar', 'aktienMarktlage', 'aktienStamm'], 'Research im Markt Aktien')
// Jede Aktien-Seite hängt am Schalter, sonst stünde sie nach dem Abschalten noch im Menü
gleich(PAGES.filter((s) => s.markt === 'aktien' && s.flag !== 'modusAktienAn').map((s) => s.id), [], 'Aktien-Seiten tragen das Flag')
// Ausserhalb von Research ist nur die Live-Analyse marktgebunden — und zwar ganz: jede ihrer Seiten ist Krypto
// (Funding, Liquidationen, Open Interest, Krypto-Feeds). Journal, Chart, Strategien, Lernen, Portfolio gelten in beiden.
gleich(PAGES.filter((s) => s.markt && s.mode !== 'research').map((s) => s.mode + ':' + s.markt).filter((x) => x !== 'live:krypto'), [], 'ausser Research ist nur Live marktgebunden')
gleich(PAGES.filter((s) => s.mode === 'live' && s.markt !== 'krypto').map((s) => s.id), [], 'jede Live-Seite ist Krypto')
gleich(PAGES.filter((s) => ['journal', 'start', 'agent', 'lernen', 'portfolio', null].includes(s.mode) && s.markt).map((s) => s.id), [], 'Journal, Chart, Strategien, Lernen, Portfolio, Einstellungen gelten in beiden Märkten')

// Modi je Markt: im Krypto-Markt alle wie bisher, im Aktien-Markt fehlt die Live-Analyse
gleich(MODES.filter((m) => !modusImMarkt(m.id, 'krypto')).map((m) => m.id), [], 'Krypto-Markt: jeder Modus hat Seiten')
gleich(MODES.filter((m) => !modusImMarkt(m.id, 'aktien')).map((m) => m.id), ['live'], 'Aktien-Markt: nur die Live-Analyse fehlt')
// Im Krypto-Markt steht das Menü der Live-Analyse wie vor der Trennung
gleich(pagesForMode('live').filter((s) => seiteImMarkt(s, 'krypto')).map((s) => s.id),
    ['marktradar', 'nachrichten', 'openinterest', 'liquidity', 'liquidations', 'livetrading', 'liveSessions', 'liveAuswertung'], 'Live im Markt Krypto unverändert')

// Startadressen
gleich(modeHome('research'), '/hype-radar', 'Research ohne Markt')
gleich(modeHome('research', 'krypto'), '/hype-radar', 'Research Krypto')
gleich(modeHome('research', 'aktien'), '/newcomer-radar', 'Research Aktien')
for (const m of MODES.filter((x) => x.id !== 'research')) gleich(modeHome(m.id, 'aktien'), m.home, `${m.id} hat eine Startadresse für beide Märkte`)
// Was die Kopfleiste im Aktien-Markt als Startadresse anbietet, gilt dort auch (sonst leitete die Wache gleich wieder um)
for (const m of MODES.filter((x) => modusImMarkt(x.id, 'aktien'))) {
    gleich(seiteImMarkt(PAGES.find((s) => s.path === modeHome(m.id, 'aktien')), 'aktien'), true, `${m.id}: Startadresse gilt im Aktien-Markt`)
}
// Die Startadresse je Markt ist eine Seite dieses Markts
for (const m of MODES) for (const [markt, pfad] of Object.entries(m.homeJeMarkt || {})) {
    gleich(PAGES.find((s) => s.path === pfad)?.markt, markt, `${m.id}: ${pfad} gehört zu ${markt}`)
}

// ── Umleitung: wohin eine Seite des anderen Markts führt (`zielImMarkt`) ──
const AN = { modusAktienAn: 1, aktiverMarkt: 'aktien' }
gleich(zielImMarkt(pageById('journalUebersicht'), 'aktien', AN), null, 'Seite beider Märkte: keine Umleitung')
gleich(zielImMarkt(pageById('chart'), 'aktien', AN), null, 'Chart: keine Umleitung')
gleich(zielImMarkt(null, 'aktien', AN), null, 'unbekannte Seite: keine Umleitung')
gleich(zielImMarkt(pageById('marktradar'), 'krypto', {}), null, 'Marktradar im Krypto-Markt bleibt')
gleich(zielImMarkt(pageById('marktradar'), 'aktien', AN), '/aktien-marktlage', 'Marktradar → Marktlage')
gleich(zielImMarkt(pageById('aktienMarktlage'), 'krypto', AN), '/marktradar', 'Marktlage → Marktradar')
gleich(zielImMarkt(pageById('coinRadar'), 'aktien', AN), '/aktien-radar', 'Coin-Radar → Aktien-Radar')
gleich(zielImMarkt(pageById('aktienRadar'), 'krypto', AN), '/coin-radar', 'Aktien-Radar → Coin-Radar')
gleich(zielImMarkt(pageById('hypeRadar'), 'aktien', AN), '/newcomer-radar', 'Hype-Radar → Startseite von Research im Aktien-Markt')
gleich(zielImMarkt(pageById('newcomerRadar'), 'krypto', AN), '/hype-radar', 'Newcomer-Radar → Startseite von Research im Krypto-Markt')
for (const id of ['nachrichten', 'openinterest', 'liquidity', 'liquidations', 'livetrading', 'liveSessions', 'liveAuswertung']) {
    gleich(zielImMarkt(pageById(id), 'aktien', AN), '/aktien-marktlage', `${id} → Ersatz des Modus Live`)
}
// Research abgeschaltet: das Gegenstück ist nicht erreichbar → erster Modus, den der Markt hat
gleich(zielImMarkt(pageById('marktradar'), 'aktien', { ...AN, modusResearchAn: 0 }), '/journal', 'ohne Research geht es ins Journal')
// Live abgeschaltet: die Marktlage führt im Krypto-Markt nicht auf den abgeschalteten Marktradar
gleich(zielImMarkt(pageById('aktienMarktlage'), 'krypto', { modusLiveAn: 0 }), '/hype-radar', 'ohne Live zur Startseite von Research')
// Jedes Ziel gilt im Zielmarkt — sonst liefe die Umleitung im Kreis
for (const markt of ['krypto', 'aktien']) for (const s of PAGES) {
    const ziel = zielImMarkt(s, markt, AN)
    if (ziel) gleich(seiteImMarkt(PAGES.find((x) => x.path === ziel), markt), true, `${s.id} → ${ziel} gilt im Markt ${markt}`)
}
// Gegenstücke und Ersatzadressen sind echte Seiten des genannten Markts
for (const s of PAGES) for (const [markt, pfad] of Object.entries(s.gegenstueck || {})) {
    gleich(PAGES.find((x) => x.path === pfad)?.markt, markt, `${s.id}: Gegenstück ${pfad} gehört zu ${markt}`)
}
for (const m of MODES) for (const [markt, pfad] of Object.entries(m.ersatzJeMarkt || {})) {
    gleich(PAGES.find((x) => x.path === pfad)?.markt, markt, `${m.id}: Ersatz ${pfad} gehört zu ${markt}`)
}

console.log(`✓ Markt-Umschalter: ${n} Prüfungen`)
