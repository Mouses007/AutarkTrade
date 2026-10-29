/**
 * ai-task-config.js — KI-Aufgaben-Definitionen.
 *
 * Jede Aufgabe (News, Trade-Analyse, Agent, etc.) hat ihre eigenen
 * Anforderungen an Modell-Qualität, Kosten, Geschwindigkeit und Features.
 * Diese Datei ist das Registry: welche Aufgabe gibt es, was braucht sie,
 * welche Modelle sind empfohlen.
 *
 * Der Agent nutzt das, um Modell-Empfehlungen zu geben.
 * Das Frontend zeigt pro Aufgabe einen Dropdown mit Modellen.
 */

/**
 * Registry aller KI-Aufgaben.
 *
 * Felder:
 *   id – technischer Name (Schlüssel in aiTaskProviders)
 *   name – Anzeigename für Oberfläche
 *   description – Was diese Aufgabe tut
 *   importance – 'high' | 'medium' | 'low' = Gewicht bei Empfehlungen
 *   maxTokens – Budget für Output (nicht Input)
 *   recommendedModels – Empfehlung als `anbieter/modell`, erste = Vorgabe
 *                    (dasselbe Format wie `settings.aiTaskProviders`)
 *   requiresToolCalling – Braucht das Modell native Tool-Unterstützung?
 *   supportedProviders – Whitelist von Anbietern, die diese Aufgabe können (optional)
 *   rueckfallFeld – das ältere Einzelfeld, das gilt, wenn die Aufgaben-Zeile leer ist
 *   seite – die Aufgabe wird auf der Seite ihrer Funktion eingestellt (Unter-
 *           Reiter `reiter` in Einstellungen › KI, Felder `provider`/`modell`,
 *           bei festem Anbieter nur `modell`). Für sie gilt KEINE Zeile der
 *           Aufgaben-Tabelle: eine Stelle je Aufgabe. Bis 10/2026 schlug die
 *           Tabelle diese Felder still; `seitenFeldUmzug` hat bestehende
 *           Zeilen in die Felder übernommen. Die übrigen Aufgaben stehen in
 *           der Tabelle unter KI › Zugang.
 *
 * Stand 18.10.2026. Faustregel der Zuordnung: Claude Haiku 5.5 für alles, was
 * automatisch und oft läuft (0,10/0,50 USD je Mio. Token — billiger als jedes
 * Gemini-Flash), Sonnet 5.5 zum Schreiben, Opus 5.5 für Agent, Code und Urteil;
 * fremde Anbieter nur dort, wo sie etwas können, das Claude nicht kann (Video,
 * X-Suche, Websuche mit Belegen).
 */

import { ANBIETER_REG, standardModell } from './ai-models.js'

export const AI_TASKS = {
    lagebericht: {
        id: 'lagebericht',
        name: 'Nachrichten-Lagebericht',
        description: 'Der tägliche Zeitungsbericht aus Beiträgen, Videos und Recherche',
        importance: 'high',
        maxTokens: 3000,
        recommendedModels: ['anthropic/claude-sonnet-5-5', 'anthropic/claude-opus-5-5'],
        requiresToolCalling: false,
        rueckfallFeld: 'radarNewsBerichtProvider/radarNewsBerichtModell',
        seite: { reiter: 'nachrichten', provider: 'radarNewsBerichtProvider', modell: 'radarNewsBerichtModell' },
    },
    lagebericht_update: {
        id: 'lagebericht-update',
        name: 'Lagebericht-Zwischenmeldung',
        description: 'Kurze Zwischenmeldung zum Lagebericht während des Tages',
        importance: 'medium',
        maxTokens: 1500,
        recommendedModels: ['anthropic/claude-haiku-5-5', 'anthropic/claude-sonnet-5-5'],
        requiresToolCalling: false,
        rueckfallFeld: 'radarNewsBerichtProvider/radarNewsBerichtModell',
        // Leer = wie der Bericht; `ALLGEMEIN` = der allgemeine Anbieter
        seite: { reiter: 'nachrichten', provider: 'radarNewsUpdateProvider', modell: 'radarNewsUpdateModell' },
    },
    lagebericht_pruefung: {
        id: 'lagebericht-pruefung',
        name: 'Lagebericht-Anweisung prüfen',
        description: 'Prüft eine eigene Anweisung, bevor sie an den Bericht geht. Leer = dasselbe Modell wie der Bericht (bewusst: wer prüft, soll später auch befolgen)',
        importance: 'low',
        maxTokens: 1500,
        recommendedModels: [],
        requiresToolCalling: false,
        rueckfallFeld: 'lagebericht',
        seite: { reiter: 'nachrichten', provider: 'radarNewsPruefProvider', modell: 'radarNewsPruefModell' },
    },
    marktradar_lage: {
        id: 'marktradar-lage',
        name: 'Marktradar-Gesamtlage',
        description: 'Einordnung aller Marktradar-Kacheln in einen Gesamtkontext',
        importance: 'high',
        maxTokens: 3000,
        recommendedModels: ['anthropic/claude-haiku-5-5', 'anthropic/claude-sonnet-5-5'],
        requiresToolCalling: false,
    },
    livetrading_handelslage: {
        id: 'livetrading-handelslage',
        name: 'Live-Trading-Handelslage',
        description: 'Was die nächsten Stunden bringen — Bedingungen statt Prognose; läuft automatisch, solange die Kachel sichtbar ist',
        importance: 'high',
        maxTokens: 3000,
        recommendedModels: ['anthropic/claude-haiku-5-5', 'anthropic/claude-sonnet-5-5'],
        requiresToolCalling: false,
    },
    chart_analyse: {
        id: 'chart-analyse',
        name: 'Chart-KI-Analyse',
        description: 'Linien, Zonen und Wenn-dann-Bedingungen für einen Chart — von Hand ausgelöst',
        importance: 'high',
        maxTokens: 3000,
        recommendedModels: ['anthropic/claude-opus-5-5', 'anthropic/claude-sonnet-5-5'],
        requiresToolCalling: false,
    },
    coin_radar: {
        id: 'coin-radar',
        name: 'Coin-Radar-Einordnung',
        description: 'Ein Absatz je Rangliste — läuft mehrere hundert Mal am Tag, darum das billigste taugliche Modell',
        importance: 'medium',
        maxTokens: 3000,
        recommendedModels: ['anthropic/claude-haiku-5-5', 'gemini/gemini-3.5-flash-lite'],
        requiresToolCalling: false,
        rueckfallFeld: 'llmRollen.editor (Hype-Radar)',
    },
    trade_analyse: {
        id: 'trade-analyse',
        name: 'Trade-Analyse',
        description: 'Schnelle Erstbewertung eines abgeschlossenen Trades',
        importance: 'medium',
        maxTokens: 800,
        recommendedModels: ['anthropic/claude-haiku-5-5', 'anthropic/claude-sonnet-5-5'],
        requiresToolCalling: false,
        rueckfallFeld: 'aiBerichtProvider/aiBerichtModell',
        seite: { reiter: 'berichte', provider: 'aiTradeAnalyseProvider', modell: 'aiTradeAnalyseModell' },
    },
    video_summary: {
        id: 'video',
        name: 'Video-Zusammenfassung',
        description: 'YouTube-Videos als Stichpunkte, dazu die Bildprüfung der Chartanalyse — nur Gemini öffnet Video-URLs',
        importance: 'medium',
        maxTokens: 600,
        recommendedModels: ['gemini/gemini-3.5-flash-lite', 'gemini/gemini-3.8-flash'],
        requiresToolCalling: false,
        supportedProviders: ['gemini'],
        rueckfallFeld: 'radarNewsModel',
        seite: { reiter: 'nachrichten', fest: 'gemini', modell: 'radarNewsModel' },
    },
    x_search: {
        id: 'x-suche',
        name: 'X (Twitter) Suche',
        description: 'Durchsucht X — nur xAI (Grok) kann das',
        importance: 'low',
        maxTokens: 1000,
        recommendedModels: ['xai/grok-4.20-0309-non-reasoning', 'xai/grok-4.7'],
        requiresToolCalling: false,
        supportedProviders: ['xai'],
        rueckfallFeld: 'radarNewsXModell',
        seite: { reiter: 'nachrichten', fest: 'xai', modell: 'radarNewsXModell' },
    },
    /*
     * Die DeepSeek-Suche (zweiter Weg seit 18.10.2026) hat keine
     * Verkaufsfreigabe: DeepSeek verbietet die Nennung seines Namens ohne
     * Erlaubnis (Verkaufs-Prüfung Z. 89d), und die Such-API gibt es nur bei
     * DeepSeek selbst. S12 hatte sie entfernt; seit S15 ist sie zurück hinter
     * dem Schalter `quellenOhneFreigabe` (ID `deepseekSuche`). `freigabe`
     * sagt, welche Teile ohne Schalter wegfallen — `ohneFreigabeSicht()`
     * nimmt sie für die Oberfläche heraus, der Bericht prüft den Schalter
     * selbst (`marktradar-news.js`).
     */
    recherche: {
        id: 'recherche',
        name: 'Web-Recherche',
        description: 'Recherche mit Belegen. Perplexity Sonar (Vorgabe, frischer, mit Bildern) oder `deepseek/deepseek-suche` — DeepSeek-Suche + Schreibmodell, rund 4× billiger, Treffer weniger tagesaktuell; die Chartanalyse bleibt bei Perplexity',
        importance: 'medium',
        maxTokens: 2000,
        recommendedModels: ['perplexity/sonar-pro', 'perplexity/sonar', 'deepseek/deepseek-suche'],
        requiresToolCalling: false,
        supportedProviders: ['perplexity', 'deepseek'],
        rueckfallFeld: 'radarNewsRechercheModell',
        // Weg (`deepseek`: Schalter-Spalte, 1 = DeepSeek-Suche) und Perplexity-
        // Modell getrennt: Die Chartanalyse und der Rückfall bei Schalter aus
        // brauchen das Perplexity-Modell auch auf dem DeepSeek-Weg. Altwert
        // `deepseek-suche` im Modellfeld wählt weiter den DeepSeek-Weg.
        seite: { reiter: 'nachrichten', modell: 'radarNewsRechercheModell', deepseek: 'radarNewsRechercheDeepseek' },
        freigabe: {
            id: 'deepseekSuche',
            description: 'Recherche mit Belegen über Perplexity Sonar',
            ohneAnbieter: ['deepseek'],
        },
    },
    recherche_schreiber: {
        id: 'recherche-schreiber',
        name: 'Recherche-Schreiber (DeepSeek-Suche)',
        description: 'Fasst die Treffer der DeepSeek-Suche mit Belegnummern zusammen — nur aktiv, wenn die Recherche über DeepSeek läuft',
        importance: 'low',
        maxTokens: 8000,
        recommendedModels: ['anthropic/claude-haiku-5-5', 'deepseek/deepseek-flash'],
        requiresToolCalling: false,
        freigabe: { id: 'deepseekSuche', ganz: true },
    },
    agent: {
        id: 'agent',
        name: 'KI-Agent (Tool-Calling Loop)',
        description: 'Autonome Analyse mit Werkzeugen',
        importance: 'high',
        maxTokens: 4000,
        recommendedModels: ['anthropic/claude-opus-5-5', 'anthropic/claude-sonnet-5-5'],
        requiresToolCalling: true,
        // Alles, wofür `ai-agent.js` einen Werkzeug-Pfad hat: Anthropic und
        // Gemini nativ, Ollama per Prompt, der Rest über die OpenAI-Schnittstelle.
        // Perplexity fehlt — Sonar ruft keine fremden Werkzeuge auf.
        supportedProviders: Object.keys(ANBIETER_REG).filter((p) => p !== 'perplexity'),
        rueckfallFeld: 'aiAgentProvider/aiAgentModell',
        seite: { reiter: 'agent', provider: 'aiAgentProvider', modell: 'aiAgentModell' },
    },
    mechanik: {
        id: 'mechanik',
        name: 'Markt-Mechanik-Einordnung',
        description: 'Analyse der Marktmechaniken — wen betrifft was, warum',
        importance: 'high',
        maxTokens: 1200,
        recommendedModels: ['anthropic/claude-haiku-5-5', 'anthropic/claude-sonnet-5-5'],
        requiresToolCalling: false,
    },
    strategie_veto: {
        id: 'strategie-veto',
        name: 'Strategie-Sentiment (Veto-Agent)',
        description: 'Schnelle Sentiment-Prüfung vor einem Strategie-Trade — die Rollen-Einstellung der Instanz hat Vorrang',
        importance: 'medium',
        maxTokens: 500,
        recommendedModels: ['anthropic/claude-haiku-5-5'],
        requiresToolCalling: false,
        // Leer = der allgemeine Anbieter (wie vorher ohne Tabellen-Zeile)
        seite: { reiter: 'strategie', provider: 'aiStrategieVetoProvider', modell: 'aiStrategieVetoModell' },
    },
    regel_baukasten: {
        id: 'regel-baukasten',
        name: 'Regel-Baukasten',
        description: 'Code-nahe Vorschläge für Trading-Regeln',
        importance: 'high',
        maxTokens: 2000,
        recommendedModels: ['anthropic/claude-opus-5-5', 'anthropic/claude-sonnet-5-5'],
        requiresToolCalling: false,
        rueckfallFeld: 'aiStrategieProvider/aiStrategieModell',
        // Beide Baukästen laden `ladeStrategieLlmConfig()` ohne Aufgabe, also
        // über „strategie-baukasten" — eine eigene Zeile hier hat nie gewirkt.
        seite: { reiter: 'strategie', provider: 'aiStrategieProvider', modell: 'aiStrategieModell' },
    },
    strategie_baukasten: {
        id: 'strategie-baukasten',
        name: 'Strategie-Baukasten',
        description: 'Code-Vorschläge für Strategien — hohe Anforderungen an Qualität',
        importance: 'high',
        maxTokens: 3000,
        recommendedModels: ['anthropic/claude-opus-5-5', 'anthropic/claude-fable-5-1'],
        requiresToolCalling: false,
        rueckfallFeld: 'aiStrategieProvider/aiStrategieModell',
        seite: { reiter: 'strategie', provider: 'aiStrategieProvider', modell: 'aiStrategieModell' },
    },
    rangliste: {
        id: 'rangliste',
        name: 'Universum-Rangliste',
        description: 'Vorschläge für das Handelsuniversum — muss zuverlässig sein',
        importance: 'high',
        maxTokens: 1000,
        recommendedModels: ['anthropic/claude-opus-5-5', 'anthropic/claude-sonnet-5-5'],
        requiresToolCalling: false,
    },
}

/**
 * Aufgaben, wie die Oberfläche sie sieht (rein): mit Schalter `an` alle wie
 * eingetragen; ohne Schalter fallen Aufgaben mit `freigabe.ganz` weg, und
 * Anbieter/Empfehlungen aus `freigabe.ohneAnbieter` werden herausgenommen —
 * die Form von S12.
 */
export function ohneFreigabeSicht(aufgaben, an) {
    if (an) return aufgaben
    const aus = []
    for (const t of aufgaben) {
        const f = t.freigabe
        if (!f) { aus.push(t); continue }
        if (f.ganz) continue
        const weg = f.ohneAnbieter || []
        const ohne = (liste) => (liste || []).filter((m) => !weg.includes(String(m).split('/')[0]))
        aus.push({
            ...t,
            description: f.description || t.description,
            recommendedModels: ohne(t.recommendedModels),
            supportedProviders: t.supportedProviders ? ohne(t.supportedProviders) : t.supportedProviders,
        })
    }
    return aus
}

/**
 * Anbieterwert der Zwischenmeldung für „der allgemeine Anbieter" (KI › Zugang).
 * Leer heisst dort „wie der Bericht"; dieser Wert hält den Fall fest, dass die
 * Zwischenmeldung vor der Neuordnung dem allgemeinen Anbieter folgte.
 */
export const ALLGEMEIN = 'allgemein'

/** Aufgabe nach ihrer `id` (Schlüssel in `aiTaskProviders`), nicht nach dem Objekt-Schlüssel. */
export function aufgabeNachId(id) {
    return Object.values(AI_TASKS).find((t) => t.id === id) || null
}

/**
 * Die eine Stelle, die eine Zeile der Aufgaben-Tabelle liest.
 *
 * Bis 18.10.2026 lasen nur fünf der fünfzehn Zeilen irgendetwas — die übrigen
 * zehn konnte man ausfüllen, gespeichert wurde es, gewirkt hat es nie. Jetzt
 * fragt jede Funktion zuerst hier und erst dann ihr altes Einzelfeld.
 *
 * Rein, ohne DB: bekommt den Rohwert von `settings.aiTaskProviders`.
 *
 * - Format `anbieter/modell` oder nur `anbieter`; getrennt wird am ERSTEN `/`,
 *   damit `openrouter/anthropic/claude-…` sein Modell behält.
 * - Nur `anbieter` → dessen Standardmodell, NICHT das globale Modell: das
 *   gehört meist einem anderen Haus und ergäbe bei jedem Aufruf einen 404.
 * - Ein unbekannter Anbieter oder einer, der die Aufgabe nicht kann (Video
 *   nur Gemini, X nur xAI …), zählt als leer — dann greift das Einzelfeld,
 *   statt dass ein Lauf mit einer Fehlkonfiguration scheitert.
 *
 * @param {string|object} roh  `settings.aiTaskProviders`
 * @param {string} aufgabenId
 * @returns {{provider: string, model: string}|null}
 */
export function aufgabenWahl(roh, aufgabenId) {
    if (!aufgabenId) return null
    // Aufgaben mit eigener Seite lesen nur ihr Feld (siehe `seite`)
    if (aufgabeNachId(aufgabenId)?.seite) return null
    return zeileLesen(karteAus(roh), aufgabenId)
}

/**
 * Das Seitenfeld einer Aufgabe mit eigenem Anbieterfeld (rein).
 *
 * Leer → null, dann entscheidet der Aufrufer (Bericht-Feld, Rollen-Feld oder
 * global). `ALLGEMEIN` → nur das Modell, der Anbieter bleibt der allgemeine.
 *
 * @param {object} s  Einstellungszeile
 * @param {string} aufgabenId
 * @returns {{provider?: string, model?: string}|null}  für `ladeLlmConfig`
 */
export function feldWahl(s, aufgabenId) {
    const f = aufgabeNachId(aufgabenId)?.seite
    if (!f?.provider) return null
    const provider = String(s?.[f.provider] || '').trim()
    if (!provider) return null
    const model = String(s?.[f.modell] || '').trim() || undefined
    return provider === ALLGEMEIN ? { model } : { provider, model }
}

/**
 * Seitenzeilen aus einer Tabelle entfernen (rein). Für Schreibwege von aussen
 * (`PUT /api/db/settings`): Ein Reiter, der noch den Stand vor der Neuordnung
 * hält, schickte sonst Zeilen zurück, die der nächste Start wieder in die
 * Felder schöbe — über das, was inzwischen auf der Seite eingestellt ist.
 *
 * @returns {string|object} wie `roh` (Text bleibt Text); unlesbar = unverändert
 */
export function ohneSeitenZeilen(roh) {
    const karte = karteAus(roh)
    if (!karte) return roh
    const neu = { ...karte }
    for (const a of Object.values(AI_TASKS)) if (a.seite) delete neu[a.id]
    return typeof roh === 'string' || roh == null ? JSON.stringify(neu) : neu
}

/** `settings.aiTaskProviders` (Text oder Objekt) → Objekt; unlesbar = null. */
function karteAus(roh) {
    if (typeof roh !== 'string') return roh && typeof roh === 'object' ? roh : {}
    try { return JSON.parse(roh || '{}') || {} } catch { return null }
}

/** Eine Zeile auswerten, ohne Rücksicht auf `seite` (für `aufgabenWahl` und den Umzug). */
function zeileLesen(karte, aufgabenId) {
    const wert = String(karte?.[aufgabenId] || '').trim()
    if (!wert) return null
    const i = wert.indexOf('/')
    const provider = (i < 0 ? wert : wert.slice(0, i)).trim()
    const model = (i < 0 ? '' : wert.slice(i + 1)).trim()
    if (!ANBIETER_REG[provider]) return null
    const nur = aufgabeNachId(aufgabenId)?.supportedProviders
    if (nur && !nur.includes(provider)) return null
    return { provider, model: model || standardModell(provider) }
}

/**
 * Umzug der Tabellen-Zeilen auf die Seiten (rein, idempotent; läuft bei jedem
 * Start, damit auch ein zurückgespieltes Backup umzieht). Zeilen von Aufgaben
 * mit eigener Seite wandern in deren Feld — was vorher wirkte, wirkt nachher.
 *
 *   - Wirkende Zeile → Feld(er) der Seite; die Zeile entfällt.
 *   - Zeile ohne Wirkung (unbekannter oder unpassender Anbieter, die nie
 *     gelesene „regel-baukasten") → entfällt, Felder bleiben.
 *   - Lagebericht: Die Zwischenmeldung fiel bisher auf das Bericht-FELD
 *     zurück, nicht auf die Bericht-Zeile. Ändert sich das Feld, bekommt sie
 *     ihr eigenes Feld mit dem bisherigen Wert — war das Bericht-Feld leer,
 *     `ALLGEMEIN`: Sie folgte dem allgemeinen Anbieter und tut es weiter,
 *     auch wenn der später wechselt. Die Anweisungsprüfung fiel auf die
 *     Bericht-Zeile, dann aufs Feld — sie landet ohne Zutun beim selben Modell.
 *   - Recherche: Eine DeepSeek-Zeile setzt nur den Weg; das Perplexity-Modell
 *     im Feld bleibt (Chartanalyse, Rückfall bei Schalter aus).
 *
 * @param {object} s  Einstellungszeile (aiTaskProviders, die Felder, aiProvider/aiModel)
 * @returns {{ patch: object, meldungen: string[] }}  patch leer = nichts zu tun
 */
export function seitenFeldUmzug(s) {
    const karte = karteAus(s?.aiTaskProviders)
    if (!karte) return { patch: {}, meldungen: [] }
    const neu = { ...karte }
    const patch = {}
    const meldungen = []
    for (const aufgabe of Object.values(AI_TASKS)) {
        const f = aufgabe.seite
        if (!f || !(aufgabe.id in neu)) continue
        const wahl = zeileLesen(karte, aufgabe.id)
        delete neu[aufgabe.id]
        if (!wahl || aufgabe.id === 'regel-baukasten') {
            meldungen.push(`${aufgabe.id}: Zeile ohne Wirkung entfernt`)
            continue
        }
        if (aufgabe.id === 'lagebericht' && !zeileLesen(karte, 'lagebericht-update')) {
            const u = AI_TASKS.lagebericht_update.seite
            if (!String(s?.[u.provider] || '').trim()) {
                const altP = String(s?.[f.provider] || '').trim()
                const altM = String(s?.[f.modell] || '').trim()
                if (!altP) {
                    // Folgte dem allgemeinen Anbieter (ein Modell ohne Anbieter blieb dabei gültig)
                    patch[u.provider] = ALLGEMEIN
                    patch[u.modell] = altM
                } else {
                    // Wie `ladeLlmConfig`: ohne Modell das globale, wenn der Anbieter der globale ist
                    const m = altM || (altP === s?.aiProvider ? String(s?.aiModel || '').trim() : '')
                        || standardModell(altP) || ''
                    // Gespeichert wird das Feld wie es war (ohne Modell bleibt ohne
                    // Modell): so folgt es weiter dem allgemeinen Modell, wenn
                    // der Anbieter der allgemeine ist.
                    if (`${altP}/${m}` !== `${wahl.provider}/${wahl.model}`) {
                        patch[u.provider] = altP
                        patch[u.modell] = altM
                    }
                }
            }
        }
        if (f.deepseek) {
            if (wahl.provider === 'deepseek') patch[f.deepseek] = 1
            else { patch[f.modell] = wahl.model; patch[f.deepseek] = 0 }
        } else {
            if (f.provider) patch[f.provider] = wahl.provider
            patch[f.modell] = wahl.model
        }
        meldungen.push(`${aufgabe.id}: ${wahl.provider}/${wahl.model} → Seite ${f.reiter}`)
    }
    if (!meldungen.length) return { patch: {}, meldungen }
    patch.aiTaskProviders = JSON.stringify(neu)
    return { patch, meldungen }
}

/**
 * Derselbe Umzug für ein gespeichertes News-Profil (rein). Die Zeilen der
 * Tabelle galten für jedes Profil; ein Profil hielt nur seine Felder, die die
 * Zeile still überstimmte. Ohne den Umzug stellte das Anwenden eines Profils
 * das früher wirkungslose Modell wieder her.
 *
 * Gerechnet wird mit den Feldern des Profils und den Zeilen/dem allgemeinen
 * Anbieter der Einstellungen. Geschrieben werden nur Felder, die das Profil
 * führt (Wert nicht null) — dazu die Begleitfelder neuer Spalten
 * (Zwischenmeldung zum Bericht-Feld, Recherche-Weg zum Recherche-Modell).
 *
 * @param {object} profil  `news_profile.einstellungen` (geparst)
 * @param {object} s       Einstellungszeile VOR dem Umzug
 * @returns {object|null}  neue `einstellungen` oder null = unverändert
 */
export function profilUmzug(profil, s) {
    if (!profil || typeof profil !== 'object') return null
    const gefuehrt = (k) => profil[k] !== undefined && profil[k] !== null
    const zusammen = { ...s }
    for (const k of Object.keys(profil)) zusammen[k] = gefuehrt(k) ? profil[k] : s?.[k]
    // Die Zwischenmeldung des Profils war leer (das Feld gab es nicht)
    const u = AI_TASKS.lagebericht_update.seite
    zusammen[u.provider] = ''
    zusammen[u.modell] = ''
    const { patch } = seitenFeldUmzug(zusammen)
    const begleit = {
        [u.provider]: 'radarNewsBerichtProvider',
        [u.modell]: 'radarNewsBerichtProvider',
        [AI_TASKS.recherche.seite.deepseek]: AI_TASKS.recherche.seite.modell,
    }
    // Zog die Bericht-Zeile ins Bericht-Feld, braucht ein Profil mit eigenem
    // Bericht-Feld auch die Zwischenmeldung ausdrücklich — sonst nähme es die
    // der Einstellungen mit, die aus einem anderen Bericht-Feld gerechnet ist.
    if ('radarNewsBerichtModell' in patch && gefuehrt('radarNewsBerichtProvider')) {
        patch[u.provider] ??= ''
        patch[u.modell] ??= ''
    }
    const neu = { ...profil }
    let geaendert = false
    for (const [k, w] of Object.entries(patch)) {
        if (!k.startsWith('radarNews')) continue
        const eigen = gefuehrt(k)
        if (!eigen && !(begleit[k] && gefuehrt(begleit[k]))) continue
        if (eigen && String(profil[k]) === String(w)) continue
        neu[k] = w
        geaendert = true
    }
    return geaendert ? neu : null
}
