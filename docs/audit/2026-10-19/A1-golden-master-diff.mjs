import fs from 'node:fs'
const [fa, fb] = process.argv.slice(2)
const UM = { hasData: 'journalHatDaten', filteredTrades: 'journalTage', totalsByDate: 'summenJeTag', profitAnalysis: 'gewinnAnalyse', calendarData: 'kalenderDaten', miniCalendarsData: 'miniKalenderDaten' }
const WEG = new Set(['sec', 'taf', 'nscc', 'nasdaq', 'otherCommission'])
const a = JSON.parse(fs.readFileSync(fa, 'utf8'), function (k, v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) { const o = {}; for (const [kk, vv] of Object.entries(v)) { if (WEG.has(kk)) continue; o[UM[kk] || kk] = vv } return o }
  return v
})
const b = JSON.parse(fs.readFileSync(fb, 'utf8'))
const rest = []
function walk(x, y, p) {
  if (x && y && typeof x === 'object' && typeof y === 'object') {
    for (const k of Object.keys(x)) { if (!(k in y)) rest.push(`nurAlt ${p}.${k} = ${JSON.stringify(x[k]).slice(0, 100)}`); else walk(x[k], y[k], `${p}.${k}`) }
    for (const k of Object.keys(y)) if (!(k in x)) rest.push(`nurNeu ${p}.${k} = ${JSON.stringify(y[k]).slice(0, 100)}`)
    return
  }
  if (typeof x === 'number' && typeof y === 'number' && Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x))) return
  if (JSON.stringify(x) !== JSON.stringify(y)) rest.push(`wert ${p}: ${JSON.stringify(x)} → ${JSON.stringify(y)}`)
}
walk(a, b, '')
console.log(rest.length + ' Abweichungen nach Umbenennung und ohne sec/taf/nscc/nasdaq/otherCommission'); rest.forEach(r => console.log(' ', r))
