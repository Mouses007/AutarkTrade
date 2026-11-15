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

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler === 0 ? 0 : 1)
