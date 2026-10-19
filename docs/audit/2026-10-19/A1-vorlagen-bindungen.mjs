// node ctx-pruefung.mjs <wurzel>: Vorlagen-Bezeichner ohne Bindung (_ctx.X) in <script setup>-SFCs
import fs from 'node:fs'
import path from 'node:path'
import { parse, compileScript } from '@vue/compiler-sfc'
const wurzel = process.argv[2]
const ERLAUBT = new Set(['$t', '$te', '$tc', '$d', '$n', '$route', '$router', '$slots', '$attrs', '$emit', '$props', '$el', '$refs', '$i18n', '$event', '$parent', '$root', '$data', '$options', '$forceUpdate', '$nextTick', '$watch', '$store'])
const dateien = []
const lauf = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) lauf(p); else if (p.endsWith('.vue')) dateien.push(p) } }
lauf(path.join(wurzel, 'src'))
let n = 0
for (const f of dateien.sort()) {
  const { descriptor } = parse(fs.readFileSync(f, 'utf8'), { filename: f })
  if (!descriptor.scriptSetup || !descriptor.template) continue
  let code
  try { code = compileScript(descriptor, { id: 'x', inlineTemplate: true }).content } catch (e) { console.log('KOMPILIERFEHLER', path.relative(wurzel, f), e.message.split('\n')[0]); continue }
  const treffer = new Map()
  for (const m of code.matchAll(/_ctx\.([A-Za-z_$][\w$]*)/g)) if (!ERLAUBT.has(m[1])) treffer.set(m[1], (treffer.get(m[1]) || 0) + 1)
  if (treffer.size) { n++; console.log(path.relative(wurzel, f) + ': ' + [...treffer].map(([k, v]) => `${k}×${v}`).join(', ')) }
}
console.log(`-- ${n} Dateien mit ungebundenen Vorlagen-Bezeichnern`)
