import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

/*
 * esptool-js lädt seinen Flash-Stub je Chip per
 * `import("./targets/stub_flasher/esp32s3.json", { with: { type: "json" } })`.
 * Mit Import-Attribut lässt der Build den Aufruf unverändert stehen — im
 * Bundle zeigt er dann auf eine Datei, die es nicht gibt („Failed to fetch
 * dynamically imported module …/assets/targets/stub_flasher/esp32s3.json",
 * 02.11.2026). Ohne Attribut wird das JSON wie jedes andere zu einem Chunk.
 */
const esptoolJsonImport = {
  name: 'esptool-json-import',
  transform(code, id) {
    if (!id.includes('esptool-js') || !id.includes('stubFlasher')) return null
    return code.replace(/,\s*\{\s*with:\s*\{\s*type:\s*["']json["']\s*\}\s*\}/g, '')
  },
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue(), esptoolJsonImport],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    // vue-i18n übersetzt Meldungen sonst per `new Function` — das verbietet
    // die Content-Security-Policy (index.mjs, Audit A2-21). Der JIT-Weg
    // kommt ohne eval aus.
    __INTLIFY_JIT_COMPILATION__: true,
    __INTLIFY_PROD_DEVTOOLS__: false,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  }
})
