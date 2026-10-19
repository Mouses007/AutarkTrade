// Inventar zweier Baeume: node inventar.mjs <alt> <neu> <ausgabe.json>
import fs from 'node:fs'
import path from 'node:path'

const [ALT, NEU, AUS] = process.argv.slice(2)

function dateien(wurzel, rel, filter) {
  const out = []
  const start = path.join(wurzel, rel)
  if (!fs.existsSync(start)) return out
  const st = fs.statSync(start)
  if (st.isFile()) return [start]
  for (const e of fs.readdirSync(start, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue
    const p = path.join(start, e.name)
    if (e.isDirectory()) out.push(...dateien(wurzel, path.relative(wurzel, p), filter))
    else if (filter(p)) out.push(p)
  }
  return out
}
const lies = (p) => fs.readFileSync(p, 'utf8')
const istCode = (p) => /\.(m?js|vue)$/.test(p) && !/__selftest|__journal-attrappen/.test(p)

function endpunkte(w) {
  const m = new Map()
  for (const f of [path.join(w, 'index.mjs'), ...dateien(w, 'server', istCode)]) {
    const t = lies(f)
    const re = /\bapp\.(get|post|put|delete|patch|all)\(\s*(['"`])([^'"`]+)\2/g
    let x
    while ((x = re.exec(t))) {
      const z = t.slice(0, x.index).split('\n').length
      m.set(`${x[1].toUpperCase()} ${x[3]}`, `${path.relative(w, f)}:${z}`)
    }
  }
  return m
}

function routen(w) {
  const m = new Map()
  for (const f of dateien(w, 'src/router', (p) => /\.js$/.test(p))) {
    const t = lies(f)
    const re = /(?:path:\s*|seite\(\s*)(['"`])([^'"`]+)\1/g
    let x
    while ((x = re.exec(t))) m.set(x[2], `${path.relative(w, f)}:${t.slice(0, x.index).split('\n').length}`)
  }
  return m
}

function menue(w) {
  const m = new Map()
  const f = path.join(w, 'src/config/menu.js')
  const t = lies(f)
  const re = /\b(to|path|route|id|pageId|key)\s*:\s*(['"`])([^'"`]+)\2/g
  let x
  while ((x = re.exec(t))) m.set(`${x[1]}=${x[3]}`, `src/config/menu.js:${t.slice(0, x.index).split('\n').length}`)
  return m
}

function takte(w) {
  const m = new Map()
  for (const f of [path.join(w, 'index.mjs'), ...dateien(w, 'server', istCode)]) {
    const t = lies(f)
    const re = /export\s+(?:async\s+)?function\s+(start\w*(?:Takt|Timer|Loop|Scheduler|Watcher|Poller)\w*)\s*\(/g
    let x
    while ((x = re.exec(t))) m.set(x[1], `${path.relative(w, f)}:${t.slice(0, x.index).split('\n').length}`)
  }
  // Aufrufe in index.mjs (inkl. starteTakte-Listen)
  const idx = lies(path.join(w, 'index.mjs'))
  const re2 = /\b(start[A-Z]\w*)\s*\(/g
  let y
  while ((y = re2.exec(idx))) {
    const k = `[index.mjs ruft] ${y[1]}`
    if (!m.has(k)) m.set(k, `index.mjs:${idx.slice(0, y.index).split('\n').length}`)
  }
  const re3 = /\[\s*['"]([\w-]+)['"]\s*,\s*\(?\)?\s*=?>?\s*(\w+)/g
  while ((y = re3.exec(idx))) m.set(`[starteTakte] ${y[1]}`, `index.mjs:${idx.slice(0, y.index).split('\n').length}`)
  return m
}

function kacheln(w) {
  const m = new Map()
  for (const n of ['marktradar.js', 'livetrading.js', 'pult.js', 'marktradar-pult.js']) {
    const f = path.join(w, 'src/config', n)
    if (!fs.existsSync(f)) continue
    const t = lies(f)
    const re = /\bid\s*:\s*(['"`])([^'"`]+)\1/g
    let x
    while ((x = re.exec(t))) m.set(`${n.replace('.js', '')}:${x[2]}`, `src/config/${n}:${t.slice(0, x.index).split('\n').length}`)
  }
  return m
}

function kiWerkzeuge(w) {
  const m = new Map()
  const f = path.join(w, 'server/ai-agent-tools.js')
  const t = lies(f)
  const re = /\bname\s*:\s*(['"`])([a-z_0-9]+)\1/g
  let x
  while ((x = re.exec(t))) m.set(x[2], `server/ai-agent-tools.js:${t.slice(0, x.index).split('\n').length}`)
  return m
}

function i18nGenutzt(w) {
  const m = new Map()
  for (const f of dateien(w, 'src', istCode)) {
    const t = lies(f)
    const re = /\b(?:\$t|t|te|\$te|i18n\.global\.t)\(\s*(['"])([a-zA-Z][\w-]*(?:\.[\w-]+)+)\1/g
    let x
    while ((x = re.exec(t))) if (!m.has(x[2])) m.set(x[2], `${path.relative(w, f)}:${t.slice(0, x.index).split('\n').length}`)
  }
  return m
}

function i18nVorhanden(w) {
  const f = dateien(w, 'src', (p) => /\/de\.json$/.test(p))[0]
  const j = JSON.parse(lies(f))
  const m = new Map()
  const lauf = (o, pre) => {
    for (const [k, v] of Object.entries(o)) {
      const key = pre ? `${pre}.${k}` : k
      if (v && typeof v === 'object') lauf(v, key)
      else m.set(key, path.relative(w, f))
    }
  }
  lauf(j, '')
  return m
}

function spalten(w) {
  const m = new Map()
  const f = path.join(w, 'server/database.js')
  const t = lies(f)
  // addColumnIfNotExists('tab', 'col'
  let re = /addColumnIfNotExists\(\s*['"](\w+)['"]\s*,\s*['"](\w+)['"]/g
  let x
  while ((x = re.exec(t))) m.set(`${x[1]}.${x[2]}`, `server/database.js:${t.slice(0, x.index).split('\n').length}`)
  // createTable('tab', (t) => { t.xxx('col') ... })
  re = /createTable\(\s*['"](\w+)['"]/g
  while ((x = re.exec(t))) {
    const tab = x[1]
    // Block bis zum naechsten createTable / bis 6000 Zeichen
    const rest = t.slice(x.index + 10)
    const ende = rest.search(/createTable\(/)
    const block = rest.slice(0, ende < 0 ? 6000 : Math.min(ende, 12000))
    const re2 = /\b\w+\.(?:increments|integer|bigInteger|string|text|float|double|decimal|boolean|date|datetime|timestamp|json|jsonb|binary|bigint|specificType)\(\s*['"](\w+)['"]/g
    let y
    while ((y = re2.exec(block))) {
      const k = `${tab}.${y[1]}`
      if (!m.has(k)) m.set(k, `server/database.js:${t.slice(0, x.index + 10 + y.index).split('\n').length}`)
    }
  }
  return m
}

function settingsGenutzt(w, spaltenMap) {
  // settings-Spalte -> wird sie in src/ (UI) erwaehnt?
  const src = dateien(w, 'src', istCode).map((f) => [f, lies(f)])
  const m = new Map()
  for (const k of spaltenMap.keys()) {
    if (!k.startsWith('settings.')) continue
    const col = k.slice(9)
    const re = new RegExp(`\\b${col}\\b`)
    const hit = src.find(([, t]) => re.test(t))
    m.set(col, hit ? path.relative(w, hit[0]) : '')
  }
  return m
}

function tabellenVue(w) {
  const m = new Map()
  for (const f of dateien(w, 'src/views', (p) => p.endsWith('.vue'))) m.set(path.relative(w, f).replace(/^src\/views\//, ''), path.relative(w, f))
  for (const f of dateien(w, 'src/components', (p) => p.endsWith('.vue'))) m.set(path.relative(w, f).replace(/^src\//, ''), path.relative(w, f))
  return m
}

function vergleiche(a, b) {
  const beide = [], nurAlt = [], nurNeu = []
  for (const [k, v] of a) (b.has(k) ? beide : nurAlt).push([k, v, b.get(k)])
  for (const [k, v] of b) if (!a.has(k)) nurNeu.push([k, v])
  return { beide: beide.length, nurAlt, nurNeu }
}

const ergebnis = {}
const fn = { endpunkte, routen, menue, takte, kacheln, kiWerkzeuge, i18nGenutzt, i18nVorhanden, spalten, tabellenVue }
const roh = {}
for (const [n, f] of Object.entries(fn)) {
  const a = f(ALT), b = f(NEU)
  roh[n] = { a, b }
  ergebnis[n] = { alt: a.size, neu: b.size, ...vergleiche(a, b) }
}
const sa = settingsGenutzt(ALT, roh.spalten.a), sb = settingsGenutzt(NEU, roh.spalten.b)
const uiVerloren = []
for (const [col, hitA] of sa) if (hitA && sb.has(col) && !sb.get(col)) uiVerloren.push([col, hitA])
ergebnis.settingsUiVerloren = uiVerloren
fs.writeFileSync(AUS, JSON.stringify(ergebnis, null, 1))
for (const [n, e] of Object.entries(ergebnis)) {
  if (Array.isArray(e)) console.log(n, e.length)
  else console.log(n.padEnd(14), 'alt', e.alt, 'neu', e.neu, 'beide', e.beide, 'nurAlt', e.nurAlt.length, 'nurNeu', e.nurNeu.length)
}
