/**
 * Coach-Werkzeuge für die Bereiche ausserhalb des Journals.
 *
 * Eingebunden in `ai-agent-tools.js` wie `STRATEGY_TOOLS`. Ein Werkzeug mit
 * `fremdtext: true` gibt frei wählbaren oder aus fremden Quellen stammenden
 * Text zurück (Token-Namen, Lagebericht) — nach seinem ersten Ergebnis sperrt
 * `executeTool` die schreibenden Werkzeuge für den Rest des Gesprächs.
 */
import { HYPE_TOOLS, HYPE_TOOL_IMPL } from './hype.js'
import { PORTFOLIO_TOOLS, PORTFOLIO_TOOL_IMPL } from './portfolio.js'
import { WEITERE_TOOLS, WEITERE_TOOL_IMPL } from './weitere.js'

export const BEREICHS_WERKZEUGE = [...HYPE_TOOLS, ...PORTFOLIO_TOOLS, ...WEITERE_TOOLS]
export const BEREICHS_WERKZEUGE_IMPL = { ...HYPE_TOOL_IMPL, ...PORTFOLIO_TOOL_IMPL, ...WEITERE_TOOL_IMPL }
