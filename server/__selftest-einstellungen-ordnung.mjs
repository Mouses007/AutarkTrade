/**
 * Selbsttest der Neuordnung der Einstellungen (29.10.2026): die Umzüge, die
 * bei jedem Start laufen. Massstab ist immer „was vorher wirkte, wirkt
 * nachher" — darum rechnet der Test das wirksame Modell vor und nach dem
 * Umzug mit denselben Regeln wie der Code aus. Ohne Netz und Datenbank.
 *
 * Aufruf: node server/__selftest-einstellungen-ordnung.mjs
 */
import { seitenFeldUmzug, aufgabenWahl, feldWahl, profilUmzug, ohneSeitenZeilen, ALLGEMEIN } from './ai-task-config.js'
import { standardModell, ANBIETER_REG } from './ai-models.js'
import { profilAusShareKarte, nameAufKarte } from './migrationen/einstellungen-ordnung.js'

let ok = 0, fehler = 0
const pruefe = (bed, text) => { if (bed) { ok++; console.log('  ✓ ' + text) } else { fehler++; console.log('  ✗ ' + text) } }

/** Umzug auf eine Zeile anwenden, wie `migriereKiAufgaben`. */
const nachUmzug = (s) => ({ ...s, ...seitenFeldUmzug(s).patch })
const karte = (s) => JSON.parse(typeof s.aiTaskProviders === 'string' ? s.aiTaskProviders : JSON.stringify(s.aiTaskProviders || {}))

/** `ladeLlmConfig` nachgebaut: welches Anbieter/Modell-Paar am Ende greift. */
function lade(s, { provider, model } = {}) {
    const g = provider || s.aiProvider || 'ollama'
    const eigen = !provider || provider === s.aiProvider ? (s.aiModel || standardModell(g)) : standardModell(g)
    return `${g}/${model || eigen || ''}`
}
/** Zeile lesen wie VOR der Neuordnung (Tabelle schlug alles; unbekannter Anbieter = leer). */
function zeile(s, id) {
    const w = String(karte(s)[id] || '').trim()
    if (!w) return null
    const i = w.indexOf('/')
    const provider = i < 0 ? w : w.slice(0, i)
    if (!ANBIETER_REG[provider]) return null
    if (id === 'recherche' && !['perplexity', 'deepseek'].includes(provider)) return null
    return { provider, model: (i < 0 ? '' : w.slice(i + 1)) || standardModell(provider) }
}
const feldB = (s) => ({ provider: s.radarNewsBerichtProvider || undefined, model: s.radarNewsBerichtModell || undefined })
/** `waehleAnbieter` in ollama-api.js */
const rolle = (s, r) => {
    const p = String(s[`ai${r}Provider`] || '').trim()
    return p ? `${p}/${String(s[`ai${r}Modell`] || '').trim() || standardModell(p)}` : `${s.aiProvider || 'ollama'}/${s.aiModel || ''}`
}

/** Recherche wie `marktradar-news.js` bis 10/2026 (Schalter an und aus). */
function rechercheVorher(s) {
    const w = zeile(s, 'recherche')
    return [true, false].map((an) => {
        const ds = an && (w ? w.provider === 'deepseek' : s.radarNewsRechercheModell === 'deepseek-suche')
        const pm = w?.provider === 'perplexity' ? w.model
            : (s.radarNewsRechercheModell && s.radarNewsRechercheModell !== 'deepseek-suche' ? s.radarNewsRechercheModell : '')
        return `${ds ? 'deepseek' : 'perplexity'}|${pm || 'standard'}`
    }).join(' ')
}
/** Recherche wie `marktradar-news.js` jetzt. */
function rechercheNachher(n) {
    return [true, false].map((an) => {
        const ds = an && (Number(n.radarNewsRechercheDeepseek) === 1 || n.radarNewsRechercheModell === 'deepseek-suche')
        const pm = n.radarNewsRechercheModell && n.radarNewsRechercheModell !== 'deepseek-suche' ? n.radarNewsRechercheModell : ''
        return `${ds ? 'deepseek' : 'perplexity'}|${pm || 'standard'}`
    }).join(' ')
}

/** Wirksame Modelle VOR der Neuordnung (Stand bis 10/2026: Zeile vor Feld). */
function vorher(s) {
    const t = zeile(s, 'trade-analyse')
    return {
        bericht: lade(s, zeile(s, 'lagebericht') || feldB(s)),
        update: lade(s, zeile(s, 'lagebericht-update') || feldB(s)),
        pruefung: lade(s, zeile(s, 'lagebericht-pruefung') || zeile(s, 'lagebericht') || feldB(s)),
        trade: t ? `${t.provider}/${t.model}` : rolle(s, 'Bericht'),
        veto: lade(s, zeile(s, 'strategie-veto') || {}),
        video: zeile(s, 'video')?.model || s.radarNewsModel || '',
        recherche: rechercheVorher(s),
    }
}
/** Wirksame Modelle NACH dem Umzug, gelesen wie der Code jetzt liest. */
function nachher(n) {
    // `ladeLlmConfigFuerAufgabe`: Zeile → Seitenfeld → Rückfall des Aufrufers
    const auf = (id, rf) => lade(n, aufgabenWahl(n.aiTaskProviders, id) || feldWahl(n, id) || rf)
    return {
        bericht: auf('lagebericht', feldB(n)),
        update: auf('lagebericht-update', feldB(n)),
        pruefung: lade(n, feldWahl(n, 'lagebericht-pruefung') || feldB(n)),
        trade: String(n.aiTradeAnalyseProvider || '').trim() ? rolle(n, 'TradeAnalyse') : rolle(n, 'Bericht'),
        veto: auf('strategie-veto', {}),
        video: aufgabenWahl(n.aiTaskProviders, 'video')?.model || n.radarNewsModel || '',
        recherche: rechercheNachher(n),
    }
}
/** Abweichungen je Aufgabe als Text; leer = alles gleich. */
function gleich(a, b) {
    return Object.keys(a).filter((k) => a[k] !== b[k]).map((k) => `${k}: ${a[k]} ≠ ${b[k]}`).join('; ')
}
const ANDERER_ALLGEMEINER = { aiProvider: 'gemini', aiModel: 'gemini-3.8-flash' }

console.log('KI-Modell je Aufgabe: Umzug auf die Seiten')

// Agent: Zeile → Felder, Zeile weg
{
    const s = { aiTaskProviders: JSON.stringify({ agent: 'anthropic/claude-opus-5-5', mechanik: 'anthropic' }), aiAgentProvider: 'gemini', aiAgentModell: 'x' }
    const n = nachUmzug(s)
    pruefe(n.aiAgentProvider === 'anthropic' && n.aiAgentModell === 'claude-opus-5-5', 'Agent: Tabellen-Zeile landet im Feld der Agent-Seite')
    pruefe(!('agent' in karte(n)) && karte(n).mechanik === 'anthropic', 'Agent-Zeile weg, fremde Zeilen bleiben')
    pruefe(Object.keys(seitenFeldUmzug(n).patch).length === 0, 'zweiter Lauf ändert nichts (idempotent)')
}

// Strategie: nur „strategie-baukasten" wirkte; „regel-baukasten" nie
{
    const s = { aiTaskProviders: { 'strategie-baukasten': 'openai/gpt-6', 'regel-baukasten': 'xai/grok-4.7' }, aiStrategieProvider: '', aiStrategieModell: '' }
    const n = nachUmzug(s)
    pruefe(n.aiStrategieProvider === 'openai' && n.aiStrategieModell === 'gpt-6', 'Strategie: wirkende Zeile ins Feld')
    pruefe(Object.keys(karte(n)).length === 0, 'Gegenprobe: nie gelesene Regel-Zeile verschwindet ohne Wirkung')
}

// Ungültige Zeile: hat nie gewirkt → Feld bleibt
{
    const s = { aiTaskProviders: { 'x-suche': 'gemini/gemini-3.8-flash', video: 'erfunden/m' }, radarNewsXModell: 'grok-alt', radarNewsModel: 'gemini-alt' }
    const n = nachUmzug(s)
    pruefe(n.radarNewsXModell === 'grok-alt' && n.radarNewsModel === 'gemini-alt', 'Gegenprobe: unwirksame Zeilen ändern kein Feld')
    pruefe(Object.keys(karte(n)).length === 0, 'unwirksame Zeilen werden trotzdem entfernt')
}

// Feste Anbieter: nur das Modell zieht um
{
    const n = nachUmzug({ aiTaskProviders: { 'x-suche': 'xai/grok-4.7', video: 'gemini/gemini-3.8-flash' } })
    pruefe(n.radarNewsXModell === 'grok-4.7' && n.radarNewsModel === 'gemini-3.8-flash', 'X-Suche und Video: Modellname ins Feld')
}

/*
 * Die Konstellationen, jede mit dem Vergleich „wirksames Modell vorher =
 * nachher" über ALLE Aufgaben mit Seitenfeld — und noch einmal, nachdem der
 * allgemeine Anbieter gewechselt hat: Was vorher dem allgemeinen Anbieter
 * folgte, muss es nachher auch tun.
 */
const FAELLE = [
    { name: 'Bericht-Feld gesetzt, Bericht-Zeile', s: { aiTaskProviders: { lagebericht: 'anthropic/claude-opus-5-5' }, radarNewsBerichtProvider: 'anthropic', radarNewsBerichtModell: 'claude-haiku-5-5', aiProvider: 'ollama', aiModel: 'llama' } },
    { name: 'Bericht-Feld leer (global), Bericht-Zeile', s: { aiTaskProviders: { lagebericht: 'anthropic/claude-opus-5-5' }, radarNewsBerichtProvider: '', radarNewsBerichtModell: '', aiProvider: 'openai', aiModel: 'gpt-6' } },
    { name: 'Bericht-Feld nur Modell, Bericht-Zeile', s: { aiTaskProviders: { lagebericht: 'anthropic/claude-opus-5-5' }, radarNewsBerichtProvider: '', radarNewsBerichtModell: 'gpt-6-mini', aiProvider: 'openai', aiModel: 'gpt-6' } },
    { name: 'Bericht-Feld ohne Modell = allgemeiner Anbieter', s: { aiTaskProviders: { lagebericht: 'anthropic/claude-opus-5-5' }, radarNewsBerichtProvider: 'openai', radarNewsBerichtModell: '', aiProvider: 'openai', aiModel: 'gpt-6' } },
    { name: 'Zwischenmeldung eigene Zeile', s: { aiTaskProviders: { lagebericht: 'anthropic/claude-opus-5-5', 'lagebericht-update': 'anthropic/claude-haiku-5-5' }, radarNewsBerichtProvider: 'openai', aiProvider: 'openai', aiModel: 'gpt-6' } },
    { name: 'Zwischenmeldung unbrauchbare Zeile', s: { aiTaskProviders: { lagebericht: 'anthropic/claude-opus-5-5', 'lagebericht-update': 'erfunden/x' }, radarNewsBerichtProvider: '', aiProvider: 'openai', aiModel: 'gpt-6' } },
    { name: 'Zeile = Feld', s: { aiTaskProviders: { lagebericht: 'anthropic/claude-sonnet-5-5' }, radarNewsBerichtProvider: 'anthropic', radarNewsBerichtModell: 'claude-sonnet-5-5', aiProvider: 'anthropic' } },
    { name: 'Prüfung eigene Zeile', s: { aiTaskProviders: { 'lagebericht-pruefung': 'openai/gpt-6' }, radarNewsBerichtProvider: 'anthropic', aiProvider: 'ollama', aiModel: 'llama' } },
    { name: 'Prüfung folgt Bericht-Zeile', s: { aiTaskProviders: { lagebericht: 'xai/grok-4.7' }, radarNewsBerichtProvider: 'anthropic', aiProvider: 'ollama', aiModel: 'llama' } },
    { name: 'Trade-Analyse nur Anbieter', s: { aiTaskProviders: { 'trade-analyse': 'anthropic' }, aiBerichtProvider: 'openai', aiProvider: 'ollama' } },
    { name: 'Trade-Analyse unbrauchbare Zeile', s: { aiTaskProviders: { 'trade-analyse': 'erfunden/x' }, aiBerichtProvider: 'openai', aiBerichtModell: 'gpt-6', aiProvider: 'ollama' } },
    { name: 'Sentiment-Veto Zeile', s: { aiTaskProviders: { 'strategie-veto': 'anthropic/claude-haiku-5-5' }, aiProvider: 'openai', aiModel: 'gpt-6' } },
    { name: 'Sentiment-Veto ohne Zeile', s: { aiTaskProviders: {}, aiProvider: 'openai', aiModel: 'gpt-6' } },
    { name: 'Recherche DeepSeek-Zeile + sonar-pro', s: { aiTaskProviders: { recherche: 'deepseek/deepseek-flash' }, radarNewsRechercheModell: 'sonar-pro' } },
    { name: 'Recherche DeepSeek-Zeile + Altwert', s: { aiTaskProviders: { recherche: 'deepseek/deepseek-flash' }, radarNewsRechercheModell: 'deepseek-suche' } },
    { name: 'Recherche Perplexity-Zeile über Altwert', s: { aiTaskProviders: { recherche: 'perplexity/sonar-pro' }, radarNewsRechercheModell: 'deepseek-suche' } },
    { name: 'Recherche ohne Zeile, Altwert', s: { aiTaskProviders: {}, radarNewsRechercheModell: 'deepseek-suche' } },
    { name: 'Video-Zeile über Feld', s: { aiTaskProviders: { video: 'gemini/gemini-3.8-flash' }, radarNewsModel: 'gemini-alt' } },
]
for (const { name, s } of FAELLE) {
    const n = nachUmzug(s)
    const abw = gleich(vorher(s), nachher(n))
    pruefe(!abw, `alle Aufgaben unverändert (${name})${abw ? ' — ' + abw : ''}`)
    const abwG = gleich(vorher({ ...s, ...ANDERER_ALLGEMEINER }), nachher({ ...n, ...ANDERER_ALLGEMEINER }))
    pruefe(!abwG, `… auch nach Wechsel des allgemeinen Anbieters (${name})${abwG ? ' — ' + abwG : ''}`)
    pruefe(Object.keys(seitenFeldUmzug(n).patch).length === 0, `… zweiter Lauf ändert nichts (${name})`)
}
{
    const n = nachUmzug(FAELLE[1].s)
    pruefe(n.radarNewsUpdateProvider === ALLGEMEIN && !karte(n)['lagebericht-update'],
        'Bericht-Feld war leer: Zwischenmeldung folgt dem allgemeinen Anbieter, keine feste Zeile')
    pruefe(!nachUmzug(FAELLE[6].s).radarNewsUpdateProvider, 'Gegenprobe: kein eigenes Zwischenmeldungs-Feld, wenn sich nichts ändert')
    const r = nachUmzug(FAELLE[13].s)
    pruefe(Number(r.radarNewsRechercheDeepseek) === 1 && r.radarNewsRechercheModell === 'sonar-pro',
        'Recherche: DeepSeek-Weg gesetzt, das Perplexity-Modell bleibt')
}

/*
 * Installation, die den ersten Umzug (Agent, Bericht, Video, X, Recherche,
 * Strategie) schon hinter sich hat: Die Tabelle hält nur noch Zeilen, die
 * damals keine Seite hatten — Zwischenmeldung, Prüfung, Trade-Analyse, Veto.
 * Die ziehen jetzt in ihre Felder, ohne dass sich etwas ändert.
 */
{
    const s = {
        aiTaskProviders: { 'lagebericht-update': 'anthropic/claude-haiku-5-5', 'lagebericht-pruefung': 'openai/gpt-6',
            'trade-analyse': 'anthropic/claude-sonnet-5-5', 'strategie-veto': 'anthropic', mechanik: 'anthropic' },
        radarNewsBerichtProvider: 'anthropic', radarNewsBerichtModell: 'claude-opus-5-5',
        radarNewsRechercheModell: 'deepseek-suche', aiProvider: 'openai', aiModel: 'gpt-6',
    }
    const n = nachUmzug(s)
    const abw = gleich(vorher(s), nachher(n))
    pruefe(!abw, `schon umgezogene Installation: alle Aufgaben unverändert${abw ? ' — ' + abw : ''}`)
    pruefe(JSON.stringify(karte(n)) === JSON.stringify({ mechanik: 'anthropic' }), '… dort bleiben nur Zeilen der Tabelle unter KI › Zugang')
}

console.log('News-Profile ziehen mit')
{
    /** Profil anwenden wie `POST …/anwenden`: nur Felder, die nicht null sind. */
    const anwenden = (s, p) => {
        const z = { ...s }
        for (const [k, w] of Object.entries(p)) if (w !== null && w !== undefined) z[k] = w
        return z
    }
    const s = {
        aiTaskProviders: { lagebericht: 'anthropic/claude-opus-5-5', video: 'gemini/gemini-3.8-flash', recherche: 'deepseek/x' },
        radarNewsBerichtProvider: '', radarNewsBerichtModell: '',
        radarNewsModel: 'gemini-alt', radarNewsRechercheModell: 'sonar', aiProvider: 'openai', aiModel: 'gpt-6',
    }
    const profile = [
        { name: 'eigenes Bericht-Feld', p: { radarNewsBerichtProvider: 'xai', radarNewsBerichtModell: 'grok-4.7', radarNewsModel: 'gemini-x', radarNewsRechercheModell: 'sonar-pro', radarNewsThemen: '["crypto"]' } },
        { name: 'Bericht-Feld leer', p: { radarNewsBerichtProvider: '', radarNewsBerichtModell: '', radarNewsModel: null } },
        { name: 'Bericht-Feld wie Zeile', p: { radarNewsBerichtProvider: 'anthropic', radarNewsBerichtModell: 'claude-opus-5-5' } },
        { name: 'ohne Modellfelder', p: { radarNewsThemen: '["tech"]' } },
    ]
    const n = nachUmzug(s)
    for (const { name, p } of profile) {
        const pn = profilUmzug(p, s) || p
        const abw = gleich(vorher(anwenden(s, p)), nachher(anwenden(n, pn)))
        pruefe(!abw, `Profil „${name}" anwenden: alle Aufgaben wie vorher${abw ? ' — ' + abw : ''}`)
        const abwG = gleich(vorher(anwenden({ ...s, ...ANDERER_ALLGEMEINER }, p)), nachher(anwenden({ ...n, ...ANDERER_ALLGEMEINER }, pn)))
        pruefe(!abwG, `… auch nach Wechsel des allgemeinen Anbieters (${name})${abwG ? ' — ' + abwG : ''}`)
    }
    // Und umgekehrt: erst ein Profil, dann wieder ein anderes
    const a = profilUmzug(profile[0].p, s) || profile[0].p
    const b = profilUmzug(profile[2].p, s) || profile[2].p
    const abw = gleich(vorher(anwenden(anwenden(s, profile[0].p), profile[2].p)), nachher(anwenden(anwenden(n, a), b)))
    pruefe(!abw, `zwei Profile nacheinander: wie vorher${abw ? ' — ' + abw : ''}`)
    pruefe(profilUmzug(profile[3].p, s) === null, 'Gegenprobe: Profil ohne Modellfelder bleibt unangetastet')
    pruefe(profilUmzug(profile[1].p, s).radarNewsModel === null, 'Gegenprobe: ein Feld, das das Profil nicht führt (null), bleibt null')
    pruefe(profilUmzug(profile[0].p, { aiTaskProviders: {} }) === null, 'ohne Zeilen (schon umgezogen): Profil bleibt')
}

console.log('Schreibweg von aussen')
{
    const roh = JSON.stringify({ agent: 'anthropic/claude-opus-5-5', 'lagebericht-update': 'openai/gpt-6', mechanik: 'anthropic' })
    pruefe(ohneSeitenZeilen(roh) === JSON.stringify({ mechanik: 'anthropic' }), 'PUT: Seitenzeilen fallen weg, Tabellenzeilen bleiben')
    pruefe(ohneSeitenZeilen('{kaputt') === '{kaputt', 'PUT: unlesbarer Wert bleibt, wie er ist')
}

pruefe(Object.keys(seitenFeldUmzug({ aiTaskProviders: '{kaputt' }).patch).length === 0, 'kaputtes JSON: nichts anfassen')
pruefe(Object.keys(seitenFeldUmzug({}).patch).length === 0, 'leere Tabelle: nichts zu tun')

console.log('Share-Karte: Name und Bild aus dem Profil')
{
    const bild = 'data:image/png;base64,AAAA'
    const p = profilAusShareKarte({ username: '', avatar: '', fluxDisplayName: 'Trader X', fluxAvatar: bild, fluxUseCustomAvatar: 1 })
    pruefe(p.username === 'Trader X' && p.avatar === bild, 'leeres Profil übernimmt Name und gewähltes Bild der Karte')
    const voll = profilAusShareKarte({ username: 'Ich', avatar: 'data:image/png;base64,BBBB', fluxDisplayName: 'Trader X', fluxAvatar: bild, fluxUseCustomAvatar: 1 })
    pruefe(Object.keys(voll).length === 0, 'Gegenprobe: gesetztes Profil wird nie überschrieben')
    const nichtGewaehlt = profilAusShareKarte({ username: '', avatar: '', fluxDisplayName: '', fluxAvatar: bild, fluxUseCustomAvatar: 0 })
    pruefe(Object.keys(nichtGewaehlt).length === 0, 'Gegenprobe: ein Kartenbild, das gar nicht gezeigt wurde, zieht nicht um')
    pruefe(profilAusShareKarte({ username: '  ', fluxDisplayName: ' A ' }).username === 'A', 'Leerzeichen zählen als leer')
    // Name auf der Karte: vorher druckte sie nur einen gesetzten Kartennamen
    pruefe(nameAufKarte({ fluxDisplayName: 'Trader X' }) === 1, 'Kartenname gesetzt: Name bleibt auf der Karte')
    pruefe(nameAufKarte({ fluxDisplayName: '  ' }) === 0 && nameAufKarte({}) === 0, 'Kartenname leer: Karte bleibt ohne Namen')
}

console.log(`einstellungen-ordnung: ${ok} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler ? 1 : 0)
