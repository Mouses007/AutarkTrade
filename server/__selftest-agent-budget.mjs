/**
 * Selbsttest: Antwortlänge und Ergebnis-Deckel des KI-Coachs.
 *
 *   node server/__selftest-agent-budget.mjs
 *
 * Ohne Netz: der Modellaufruf ist eine Attrappe (`config.rufeModell`), die
 * Datenbank eine Wegwerf-SQLite (der Lauf verbucht seinen Verbrauch).
 *
 * Anlass (15.11.2026): mit „Max Tokens 1500" aus den allgemeinen
 * KI-Einstellungen verbrauchten die denkenden Modelle ihr Budget im
 * Denkschritt, es kam kein Text, und der Coach schickte den Nutzer in die
 * Einstellungen. Jetzt gilt eine Untergrenze, und eine leere Antwort wird
 * einmal von selbst mit mehr Antwortlänge wiederholt.
 * Zweiter Anlass: ein Werkzeug-Ergebnis über 15 000 Zeichen wurde mitten im
 * JSON abgeschnitten; der Gemini-Zweig warf beim Zurücklesen.
 */
process.env.AT_DB_FILE = ':memory:'

let bestanden = 0
let fehler = 0
const p = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}

const { agentMaxTokens, AGENT_MIN_TOKENS, AGENT_WIEDERHOLUNG_TOKENS, kuerzeErgebnis, leseErgebnis, ERGEBNIS_MAX } = await import('./ai-agent-kern.js')

{   // Untergrenze
    p('1500 wird angehoben', agentMaxTokens(1500) === AGENT_MIN_TOKENS)
    p('leer wird angehoben', agentMaxTokens(null) === AGENT_MIN_TOKENS && agentMaxTokens('') === AGENT_MIN_TOKENS)
    p('höherer Wert bleibt', agentMaxTokens(20000) === 20000)
}

{   // Deckel bleibt gültiges JSON
    const klein = { count: 2, zeilen: ['a', 'b'] }
    p('kleines Ergebnis unverändert', kuerzeErgebnis(klein) === JSON.stringify(klein))
    const gross = { zeilen: Array.from({ length: 4000 }, (_, i) => `Zeile ${i} mit "Anführungszeichen" und \\ Rückstrich`) }
    const text = kuerzeErgebnis(gross)
    let gelesen = null
    try { gelesen = JSON.parse(text) } catch { /* bleibt null */ }
    p('grosses Ergebnis ist gültiges JSON', gelesen !== null)
    p('… und als abgeschnitten markiert', gelesen?.abgeschnitten === true && typeof gelesen.anfang === 'string')
    p('… und gedeckelt', gelesen?.anfang.length === ERGEBNIS_MAX)
    // Gegenprobe: so sah es vorher aus
    const alt = JSON.stringify(gross).substring(0, 15000) + '... [truncated]'
    let altGueltig = true
    try { JSON.parse(alt) } catch { altGueltig = false }
    p('Gegenprobe: der alte Schnitt war kein JSON', altGueltig === false)
    p('leseErgebnis wirft auch dabei nicht', leseErgebnis(alt).text === alt)
    p('leseErgebnis liest Objekte', leseErgebnis('{"a":1}').a === 1 && Object.keys(leseErgebnis('')).length === 0)
    p('leseErgebnis verpackt Nicht-Objekte', leseErgebnis('5').wert === 5)
}

const { initDb } = await import('./database.js')
await initDb()
const { runAgentLoop, buildSystemPrompt, WERKZEUG_WEGWEISER } = await import('./ai-agent.js')
const { AGENT_TOOLS } = await import('./ai-agent-tools.js')

const usage = { totalTokens: 10, promptTokens: 6, completionTokens: 4 }
const basis = { provider: 'anthropic', model: 'attrappe', maxTokens: AGENT_MIN_TOKENS, tokenBudget: 80000 }

{   // Leere Antwort → eine Wiederholung mit mehr Antwortlänge
    const aufrufe = []
    const ereignisse = []
    const r = await runAgentLoop('Frage', [], {
        ...basis,
        rufeModell: async (_m, c) => {
            aufrufe.push(c.maxTokens)
            return aufrufe.length === 1 ? { text: '', toolCalls: [], usage } : { text: 'Antwort', toolCalls: [], usage }
        },
    }, (e) => ereignisse.push(e))
    p('zwei Aufrufe', aufrufe.length === 2, String(aufrufe.length))
    p('zweiter mit erhöhter Antwortlänge', aufrufe[1] === AGENT_WIEDERHOLUNG_TOKENS, String(aufrufe[1]))
    p('Antwort kommt an', r.answer === 'Antwort' && ereignisse.some((e) => e.type === 'answer' && e.content === 'Antwort'))
    p('Tokens beider Aufrufe gezählt', r.totalTokens === 20, String(r.totalTokens))
}

{   // Zweimal leer → Meldung ohne Verweis auf die Einstellungen
    let n = 0
    const r = await runAgentLoop('Frage', [], { ...basis, rufeModell: async () => { n++; return { text: '', toolCalls: [], usage } } }, () => {})
    p('genau eine Wiederholung', n === 2, String(n))
    p('Meldung vorhanden', r.answer.length > 20)
    p('kein Verweis auf die Einstellungen', !/Einstellung/i.test(r.answer), r.answer)
}

{   // Eine höher eingestellte Antwortlänge wird nicht gesenkt
    const aufrufe = []
    await runAgentLoop('Frage', [], {
        ...basis, maxTokens: 32000,
        rufeModell: async (_m, c) => { aufrufe.push(c.maxTokens); return aufrufe.length === 1 ? { text: '', toolCalls: [], usage } : { text: 'ok', toolCalls: [], usage } },
    }, () => {})
    p('32000 bleibt 32000', aufrufe[1] === 32000, String(aufrufe[1]))
}

{   // Systemprompt: Seitenstand und Wegweiser
    const text = buildSystemPrompt({
        seitenKontext: { seitenId: 'hypeRadar', thema: 'entdecken', themaTitel: 'Entdecken', hinweis: null },
        seitenStand: { zeilen: ['Reiter: fruehphase'], hatFremdtext: false },
    })
    p('Seite steht im Prompt', text.includes('seitenId hypeRadar') && text.includes('- Reiter: fruehphase'))
    p('ohne Seite kein Block', !buildSystemPrompt({}).includes('WAS DER NUTZER GERADE SIEHT'))
    p('Zitat-Regel steht im Prompt', text.includes('ZITIERTES MATERIAL'))
    const namen = new Set(AGENT_TOOLS.map((t) => t.name))
    const genannt = [...WERKZEUG_WEGWEISER.matchAll(/\b((?:query|get|list|run|compute|analyze|propose|recommend)_[a-z_]+)\b/g)].map((m) => m[1])
    p('Wegweiser nennt Werkzeuge', genannt.length > 15, String(genannt.length))
    for (const n of new Set(genannt)) p(`Wegweiser: Werkzeug ${n} existiert`, namen.has(n))
}

{   // FUN-R-204: Abbruch beendet den laufenden Modellabruf, der Lauf kehrt sofort zurück
    const abbruch = new AbortController()
    let gesehen = null
    const start = Date.now()
    setTimeout(() => abbruch.abort(), 30)
    const ereignisse = []
    const r = await runAgentLoop('Frage', [], {
        ...basis, signal: abbruch.signal,
        // Attrappe eines hängenden Abrufs: antwortet erst nach 5 s, ausser das Signal bricht ab
        rufeModell: (_m, c) => new Promise((ja, nein) => {
            gesehen = c.signal
            const uhr = setTimeout(() => ja({ text: 'zu spät', toolCalls: [], usage }), 5000)
            c.signal?.addEventListener('abort', () => { clearTimeout(uhr); nein(new Error('aborted')) })
        }),
    }, (e) => ereignisse.push(e), () => abbruch.signal.aborted).catch((e) => ({ fehler: e.message }))
    p('Signal erreicht den Modellabruf', gesehen === abbruch.signal)
    p('Lauf endet mit dem Abbruch, nicht mit dem Abruf', Date.now() - start < 2000, `${Date.now() - start} ms`)
    p('Abbruch ist kein Fehler und liefert keine Antwort', !r.fehler && r.answer === '' && !ereignisse.some((e) => e.type === 'answer'), JSON.stringify(r).slice(0, 200))

    // Ein Fehler OHNE Abbruch bleibt ein Fehler
    const f = await runAgentLoop('Frage', [], { ...basis, rufeModell: async () => { throw new Error('Anbieter 500') } }, () => {}).catch((e) => ({ fehler: e.message }))
    p('Anbieterfehler ohne Abbruch wird weitergereicht', f.fehler === 'Anbieter 500', JSON.stringify(f).slice(0, 120))

    // Die echten Abrufpfade geben das Signal an fetch weiter (fetch ist gestellt, kein Netz)
    const echtesFetch = globalThis.fetch
    try {
        for (const [provider, zusatz] of [['anthropic', {}], ['openai', { endpunkt: 'https://attrappe.invalid/v1/chat/completions' }], ['gemini', {}]]) {
            const ab = new AbortController()
            let signalImAbruf = null
            globalThis.fetch = (_url, init) => new Promise((_ja, nein) => {
                signalImAbruf = init?.signal
                init?.signal?.addEventListener('abort', () => nein(new Error('aborted')))
            })
            setTimeout(() => ab.abort(), 20)
            const t0 = Date.now()
            const e = await runAgentLoop('Frage', [], { ...basis, provider, apiKey: 'x', ...zusatz, signal: ab.signal }, () => {}, () => ab.signal.aborted).catch((x) => ({ fehler: x.message }))
            p(`${provider}: fetch bekommt das Abbruchsignal und der Lauf endet sofort`, signalImAbruf === ab.signal && !e.fehler && e.answer === '' && Date.now() - t0 < 2000, JSON.stringify(e).slice(0, 160))
        }
    } finally {
        globalThis.fetch = echtesFetch
    }
}

{   // BUG-R-205: OpenAI-kompatibel — Bilder erst nach ALLEN tool-Antworten eines parallelen Aufrufs
    const { buildOpenAIMessages } = await import('./ai-agent.js')
    const bild = { mediaType: 'image/png', base64: 'AAAA' }
    const verlauf = [
        { role: 'user', content: 'Zeig mir die drei Screenshots' },
        { role: 'assistant', content: '', toolCallsRaw: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
        { role: 'tool', toolCallId: 'a', toolName: 'analyze_screenshot', content: '{}', imageContent: bild },
        { role: 'tool', toolCallId: 'b', toolName: 'query_trades', content: '{}' },
        { role: 'tool', toolCallId: 'c', toolName: 'analyze_screenshot', content: '{}', imageContent: bild },
        { role: 'assistant', content: '', toolCallsRaw: [{ id: 'd' }] },
        { role: 'tool', toolCallId: 'd', toolName: 'analyze_screenshot', content: '{}', imageContent: bild },
    ]
    const m = buildOpenAIMessages(verlauf)
    const folge = m.map((x) => (x.role === 'tool' ? `tool:${x.tool_call_id}` : Array.isArray(x.content) ? 'bild' : x.role)).join(' ')
    p('tool-Antworten a, b, c folgen lückenlos, Bilder danach', folge === 'user assistant tool:a tool:b tool:c bild bild assistant tool:d bild', folge)
    p('kein Bild geht verloren', m.filter((x) => Array.isArray(x.content) && x.content.some((c) => c.type === 'image_url')).length === 3)
    const ohne = buildOpenAIMessages(verlauf.map(({ imageContent, ...rest }) => rest))
    p('ohne Bilder unverändert', ohne.map((x) => x.role).join(' ') === 'user assistant tool tool tool assistant tool')
}

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler === 0 ? 0 : 1)
