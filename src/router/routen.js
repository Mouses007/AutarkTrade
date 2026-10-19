/**
 * Routentabelle von AutarkTrade.
 *
 * Reine Daten plus die Layout-Komponente. Der Router selbst (Verlauf, Hook)
 * steht in `./index.js`.
 *
 * Meta-Felder:
 *   titleKey         i18n-Schlüssel des Seitentitels (gewinnt vor `title`)
 *   title            Rohtitel, nur Rückfall für den Dokumenttitel
 *   layout           Layout-Komponente selbst (App.vue rendert sie); fehlt bei
 *                    /setup und /update-assistent
 *   mode             Modus der Route; fehlt = Journal. `any` = modusneutral
 *                    (Einstellungen), `uebersicht` = Startseite, gehört keinem
 *                    Modus und lässt den gemerkten stehen
 *   ohneSeitenmenue  Layout zeigt weder Seitenmenü noch Titelzeile
 *   skipSetupCheck   nicht zum Setup umleiten
 *   skipUpdateCheck  nicht zum Update-Assistenten umleiten
 *
 * Alle Seiten werden erst beim Aufruf geladen; nur das Layout ist statisch,
 * weil es an jeder Route hängt.
 */
import DashboardLayout from '../layouts/Dashboard.vue'

/** Die Unterseiten der Einstellungen (`/settings/:bereich`). Ohne Angabe: die erste. */
export const EINSTELLUNGS_BEREICHE = ['allgemein', 'journal', 'ki', 'live', 'benachrichtigungen', 'datenquellen', 'lizenz', 'rechtliches']

/** Seite mit dem gemeinsamen Layout. */
function seite(path, name, laden, meta = {}, extra = {}) {
    return { path, name, component: laden, meta: { layout: DashboardLayout, ...meta }, ...extra }
}

/**
 * Wohin `/` führt. Synchron aus dem localStorage: `useInitApp()` spiegelt die
 * Einstellung `startseiteAn` dorthin, damit hier ohne Warten auf den Server
 * entschieden werden kann. Abgeschaltet heisst ausdrücklich `'0'`.
 */
function startziel() {
    let an = null
    try { an = localStorage.getItem('startseiteAn') } catch { /* privater Modus */ }
    return an === '0' ? '/dashboard' : '/chart'
}

/** Ein unbekannter Bereich fällt auf „Allgemein" — sonst stünde eine leere Einstellungsseite da. */
function pruefeBereich(to) {
    const b = to.params.bereich
    if (b && !EINSTELLUNGS_BEREICHE.includes(b)) {
        return { path: '/settings/' + EINSTELLUNGS_BEREICHE[0], query: to.query, hash: to.hash }
    }
    return true
}

export const routen = [
    { path: '/', redirect: startziel },

    // ── Start ───────────────────────────────────────────────
    seite('/chart', 'chart', () => import('../views/Chart.vue'), { title: 'Chart', titleKey: 'nav.chart', mode: 'start' }),
    seite('/start', 'start', () => import('../views/Start.vue'), { title: 'AutarkTrade', titleKey: 'app.startTitel', mode: 'uebersicht', ohneSeitenmenue: true }),
    { path: '/startseite', redirect: '/chart' },

    // ── Ohne Layout ─────────────────────────────────────────
    { path: '/setup', name: 'setup', component: () => import('../views/Setup.vue'), meta: { title: 'Setup', titleKey: 'nav.setup', skipSetupCheck: true } },
    {
        path: '/update-assistent', name: 'updateAssistent', component: () => import('../views/UpdateAssistent.vue'),
        meta: { title: 'Update', titleKey: 'onboarding.title', skipSetupCheck: true, skipUpdateCheck: true },
    },

    // ── Journal ─────────────────────────────────────────────
    seite('/dashboard', 'dashboard', () => import('../views/Dashboard.vue'), { title: 'Dashboard', titleKey: 'nav.dashboard' }),
    seite('/accounts', 'accounts', () => import('../views/Accounts.vue'), { title: 'Konten', titleKey: 'nav.accounts' }),
    seite('/calendar', 'calendar', () => import('../views/Calendar.vue'), { title: 'Kalender', titleKey: 'nav.calendar' }),
    seite('/daily', 'daily', () => import('../views/Daily.vue'), { title: 'Tagesansicht', titleKey: 'nav.dailyView' }),
    seite('/incoming', 'incoming', () => import('../views/Incoming.vue'), { title: 'Pendente Trades', titleKey: 'nav.pendingTrades' }),
    seite('/screenshots', 'screenshots', () => import('../views/Screenshots.vue'), { title: 'Screenshots', titleKey: 'nav.screenshots' }),
    seite('/playbook', 'playbook', () => import('../views/Playbook.vue'), { title: 'Playbook', titleKey: 'nav.playbook' }),
    seite('/auswertung', 'auswertung', () => import('../views/Auswertung.vue'), { title: 'Auswertung', titleKey: 'nav.evaluation' }),
    seite('/ki-coach', 'kiAgent', () => import('../views/KiAgent.vue'), { title: 'KI-Coach', titleKey: 'nav.kiAgent' }),
    seite('/addTrades', 'addTrades', () => import('../views/AddTrades.vue'), { title: 'Manueller Import', titleKey: 'nav.manualImport' }),
    seite('/addExcursions', 'addExcursions', () => import('../views/AddExcursions.vue'), { title: 'Exkursionen', titleKey: 'nav.addExcursions' }),
    // Alte Adressen
    { path: '/diary', redirect: '/incoming' },
    { path: '/addDiary', redirect: '/incoming' },
    { path: '/addPlaybook', redirect: '/daily' },
    { path: '/addScreenshot', redirect: '/screenshots' },

    // ── Einstellungen (modusübergreifend) ───────────────────
    seite('/settings/:bereich?', 'settings', () => import('../views/Settings.vue'),
        { title: 'Einstellungen', titleKey: 'nav.settings', mode: 'any' }, { beforeEnter: pruefeBereich }),
    // Die Börsen-API-Schlüssel stehen im Journal-Bereich.
    { path: '/imports', redirect: '/settings/journal' },

    // ── Live-Analyse ────────────────────────────────────────
    seite('/marktradar', 'marktradar', () => import('../views/Marktradar.vue'), { title: 'Marktradar', titleKey: 'nav.marktradar', mode: 'live' }),
    seite('/nachrichten', 'nachrichten', () => import('../views/Nachrichten.vue'), { title: 'Nachrichten', titleKey: 'nav.nachrichten', mode: 'live' }),
    seite('/openinterest', 'openinterest', () => import('../views/OpenInterest.vue'), { title: 'Open Interest', titleKey: 'nav.openInterest', mode: 'live' }),
    seite('/liquidity', 'liquidity', () => import('../views/Liquidity.vue'), { title: 'Bookmap', titleKey: 'nav.liquidity', mode: 'live' }),
    seite('/liquidations', 'liquidations', () => import('../views/Liquidations.vue'), { title: 'Liquidationskarte', titleKey: 'nav.liquidations', mode: 'live' }),
    // Ob Live-Trading eingeschaltet ist (`livetradingAn`), prüft die Seite
    // selbst: beim kalten Deep-Link sind die Einstellungen hier noch nicht da.
    seite('/livetrading', 'livetrading', () => import('../views/Livetrading.vue'), { title: 'Live-Trading', titleKey: 'nav.livetrading', mode: 'live' }),
    seite('/live-sessions', 'liveSessions', () => import('../views/LiveSessions.vue'), { title: 'Archiv', titleKey: 'nav.liveSessions', mode: 'live' }),
    seite('/live-auswertung', 'liveAuswertung', () => import('../views/LiveAuswertung.vue'), { title: 'Auswertung', titleKey: 'nav.liveAuswertung', mode: 'live' }),

    // ── Entdecken ───────────────────────────────────────────
    // Ein Parameter statt mehrerer Routen: beim Wechsel der Ansicht wird die
    // Seite nicht neu aufgebaut, ein laufender Scan (SSE) überlebt.
    seite('/hype-radar/:reiter?', 'hypeRadar', () => import('../views/HypeRadar.vue'), { title: 'Hype-Radar', titleKey: 'nav.hypeRadar', mode: 'research' }),
    seite('/coin-radar/:reiter?', 'coinRadar', () => import('../views/CoinRadar.vue'), { title: 'Coin-Radar', titleKey: 'nav.coinRadar', mode: 'research' }),

    // ── Strategien (Agent) ──────────────────────────────────
    seite('/agent/strategies', 'agentStrategies', () => import('../views/AgentStrategies.vue'), { title: 'Instanzen', titleKey: 'nav.agentStrategies', mode: 'agent' }),
    seite('/agent/setups', 'agentSetups', () => import('../views/AgentSetups.vue'), { title: 'Setups', titleKey: 'nav.agentSetups', mode: 'agent' }),
    seite('/agent/performance', 'agentPerformance', () => import('../views/AgentPerformance.vue'), { title: 'Auswertung', titleKey: 'nav.agentPerformance', mode: 'agent' }),
    seite('/agent/editor', 'agentEditor', () => import('../views/AgentEditor.vue'), { title: 'Strategie-Editor', titleKey: 'nav.agentEditor', mode: 'agent' }),
    seite('/agent/builder', 'agentBuilder', () => import('../views/AgentBuilder.vue'), { title: 'Neue Strategie', titleKey: 'nav.agentBuilder', mode: 'agent' }),
    seite('/agent/lab', 'agentLab', () => import('../views/AgentLab.vue'), { title: 'Labor', titleKey: 'nav.agentLab', mode: 'agent' }),
    seite('/agent/rangliste', 'coinRangliste', () => import('../views/CoinRangliste.vue'), { title: 'Coin-Rangliste', titleKey: 'nav.coinRangliste', mode: 'agent' }),

    // ── Lernen ──────────────────────────────────────────────
    // Ein Eintrag für Sitzung/Karten/Statistik: eine laufende Lernsitzung
    // überlebt den Wechsel.
    seite('/lernen/:reiter?', 'lernen', () => import('../views/Lernen.vue'), { title: 'Lernen', titleKey: 'nav.lernen', mode: 'lernen' }),

    // ── Unbekannte Adresse ──────────────────────────────────
    // Ohne diesen Eintrag bliebe die Seite weiss (keine Route, kein Layout).
    { path: '/:unbekannt(.*)*', redirect: '/' },
]
