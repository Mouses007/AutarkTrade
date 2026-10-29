/**
 * Routentabelle von AutarkTrade.
 *
 * Reine Daten. Der Router selbst (Verlauf, Hook) steht in `./index.js`.
 *
 * Meta-Felder:
 *   titleKey         i18n-Schlüssel des Seitentitels (gewinnt vor `title`)
 *   title            Rohtitel, nur Rückfall für den Dokumenttitel
 *   rahmen           Seite steht im Rahmen (`layouts/Rahmen.vue`, App.vue);
 *                    fehlt bei /setup und /update-assistent
 *   mode             Modus der Route; fehlt = Journal. `any` = modusneutral
 *                    (Einstellungen), `uebersicht` = Startseite, gehört keinem
 *                    Modus und lässt den gemerkten stehen
 *   ohneSeitenmenue  Layout zeigt weder Seitenmenü noch Titelzeile
 *   skipSetupCheck   nicht zum Setup umleiten
 *   skipUpdateCheck  nicht zum Update-Assistenten umleiten
 *
 * Alle Seiten werden erst beim Aufruf geladen.
 */

/** Die Unterseiten der Einstellungen (`/einstellungen/:bereich`). Ohne Angabe: die erste. */
export const EINSTELLUNGS_BEREICHE = ['allgemein', 'journal', 'live', 'datenquellen', 'ki', 'benachrichtigungen', 'geraete', 'system', 'rechtliches']

/** Seite mit dem gemeinsamen Layout. */
function seite(path, name, laden, meta = {}, extra = {}) {
    return { path, name, component: laden, meta: { rahmen: true, ...meta }, ...extra }
}

/** Weiterleitung einer alten Adresse; Abfrage und Anker bleiben erhalten. */
function weiter(von, nach) {
    return { path: von, redirect: (to) => ({ path: nach, query: to.query, hash: to.hash }) }
}

/**
 * Wohin `/` führt. Synchron aus dem localStorage: `starteApp()` spiegelt die
 * Einstellung `startseiteAn` dorthin, damit hier ohne Warten auf den Server
 * entschieden werden kann. Abgeschaltet heisst ausdrücklich `'0'`.
 */
function startziel() {
    let an = null
    try { an = localStorage.getItem('startseiteAn') } catch { /* privater Modus */ }
    return an === '0' ? '/journal' : '/chart'
}

/**
 * Frühere Bereiche und Unterseiten der Einstellungen → wo sie heute stehen.
 * Bis 10/2026 gab es oben die Reiter „Agent" und „Lizenz", ESP32 stand unter
 * Journal, Sicherheit/HTTPS/Datenbank/Speicher unter Allgemein; Lesezeichen,
 * alte Links und Texte („Einstellungen › ESP32") sollen weiter treffen.
 * `ki` = Unter-Reiter im KI-Bereich.
 */
export const ALTE_BEREICHE = {
    agent: { bereich: 'ki', ki: 'agent' },
    strategie: { bereich: 'ki', ki: 'strategie' },
    strategien: { bereich: 'ki', ki: 'strategie' },
    nachrichten: { bereich: 'ki', ki: 'nachrichten' },
    lagebericht: { bereich: 'ki', ki: 'nachrichten' },
    berichte: { bereich: 'ki', ki: 'berichte' },
    bilder: { bereich: 'ki', ki: 'bilder' },
    zugang: { bereich: 'ki', ki: 'allgemein' },
    esp32: { bereich: 'geraete' },
    widget: { bereich: 'geraete' },
    android: { bereich: 'geraete' },
    sicherheit: { bereich: 'system' },
    https: { bereich: 'system' },
    datenbank: { bereich: 'system' },
    speicher: { bereich: 'system' },
    backup: { bereich: 'system' },
    importe: { bereich: 'journal' },
    konten: { bereich: 'journal' },
    boersen: { bereich: 'journal' },
    layout: { bereich: 'allgemein' },
    profil: { bereich: 'allgemein' },
    bedienung: { bereich: 'allgemein' },
    marktradar: { bereich: 'live' },
    chart: { bereich: 'live' },
    quellen: { bereich: 'datenquellen' },
    lizenz: { bereich: 'rechtliches' },
}

/**
 * Ein früherer Bereichsname führt dorthin, wo er heute steht; ein ganz
 * unbekannter fällt auf „Allgemein" — sonst stünde eine leere Seite da.
 */
function pruefeBereich(to) {
    const b = to.params.bereich
    if (!b || EINSTELLUNGS_BEREICHE.includes(b)) return true
    const ziel = ALTE_BEREICHE[String(b).toLowerCase()]
    if (ziel) {
        const query = ziel.ki ? { ...to.query, ki: ziel.ki } : to.query
        return { path: '/einstellungen/' + ziel.bereich, query, hash: to.hash }
    }
    return { path: '/einstellungen/' + EINSTELLUNGS_BEREICHE[0], query: to.query, hash: to.hash }
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
    seite('/journal', 'journalUebersicht', () => import('../views/JournalUebersicht.vue'), { title: 'Dashboard', titleKey: 'nav.dashboard' }),
    seite('/accounts', 'accounts', () => import('../views/Accounts.vue'), { title: 'Konten', titleKey: 'nav.accounts' }),
    seite('/kalender', 'kalender', () => import('../views/Kalender.vue'), { title: 'Kalender', titleKey: 'nav.calendar' }),
    seite('/tagesansicht', 'tagesansicht', () => import('../views/Tagesansicht.vue'), { title: 'Tagesansicht', titleKey: 'nav.dailyView' }),
    seite('/incoming', 'incoming', () => import('../views/Incoming.vue'), { title: 'Pendente Trades', titleKey: 'nav.pendingTrades' }),
    seite('/bilder', 'bilder', () => import('../views/Bilder.vue'), { title: 'Screenshots', titleKey: 'nav.screenshots' }),
    seite('/bewertungen', 'bewertungen', () => import('../views/Bewertungen.vue'), { title: 'Playbook', titleKey: 'nav.playbook' }),
    seite('/auswertung', 'auswertung', () => import('../views/Auswertung.vue'), { title: 'Auswertung', titleKey: 'nav.evaluation' }),
    seite('/ki-coach', 'kiAgent', () => import('../views/KiAgent.vue'), { title: 'KI-Coach', titleKey: 'nav.kiAgent' }),
    seite('/import', 'tradeImport', () => import('../views/TradeImport.vue'), { title: 'Manueller Import', titleKey: 'nav.manualImport' }),
    seite('/exkursionen', 'exkursionen', () => import('../views/Exkursionen.vue'), { title: 'Exkursionen', titleKey: 'nav.addExcursions' }),
    // Alte Adressen (Lesezeichen, Links in alten Nachrichten): Abfrage und
    // Anker gehen mit, z. B. `/playbook?tradeId=…`.
    weiter('/dashboard', '/journal'),
    weiter('/calendar', '/kalender'),
    weiter('/daily', '/tagesansicht'),
    weiter('/screenshots', '/bilder'),
    weiter('/playbook', '/bewertungen'),
    weiter('/addTrades', '/import'),
    weiter('/addExcursions', '/exkursionen'),
    weiter('/diary', '/incoming'),
    weiter('/addDiary', '/incoming'),
    weiter('/addPlaybook', '/tagesansicht'),
    weiter('/addScreenshot', '/bilder'),

    // ── Einstellungen (modusübergreifend) ───────────────────
    seite('/einstellungen/:bereich?', 'einstellungen', () => import('../views/Einstellungen.vue'),
        { title: 'Einstellungen', titleKey: 'nav.settings', mode: 'any' }, { beforeEnter: pruefeBereich }),
    // Alte Adresse der Einstellungen, samt Bereich (`/settings/ki` → `/einstellungen/ki`).
    { path: '/settings/:bereich?', redirect: (to) => ({ path: '/einstellungen' + (to.params.bereich ? '/' + to.params.bereich : ''), query: to.query, hash: to.hash }) },
    // Importe und Börsen-Konten stehen im Journal-Bereich.
    weiter('/imports', '/einstellungen/journal'),

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
    seite('/portfolio/:reiter?', 'portfolio', () => import('../views/Portfolio.vue'), { title: 'Portfolio', titleKey: 'nav.portfolio', mode: 'portfolio' }),

    // ── Unbekannte Adresse ──────────────────────────────────
    // Ohne diesen Eintrag bliebe die Seite weiss (keine Route, kein Layout).
    { path: '/:unbekannt(.*)*', redirect: '/' },
]
