<script setup>
/**
 * Datei-Import für Orte ohne API (geschlossene Konten, Wallets ohne
 * Explorer-Schlüssel, Rekonstruktionen). Zwei Schritte: Datei wählen →
 * Vorschau (Orte, Zeilen, Bestand je Ort, Fehler mit Zeilennummer) →
 * Importieren. Ein erneuter Import derselben Datei überspringt bekannte
 * Zeilen; ein Ort lässt sich als Ganzes wieder entfernen.
 */
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import { uebersicht, ladeUebersicht, menge, chf, vorZeit } from '../../stores/portfolio.js'
import { Karte, Knopf, Hinweis, Symbol, Pille } from '../basis/index.js'

const { t } = useI18n()
const text = ref('')
const dateiName = ref('')
const pruefung = ref(null)
const laedt = ref(false)
const ergebnis = ref(null)
const loeschFrage = ref(null)
const feld = ref(null)
const ersetzen = ref(false)
const hatVorhandene = computed(() => (pruefung.value?.vorschau || []).some((o) => o.vorhanden))

// Aktive zuerst; nicht mehr genutzte (Konto aufgelöst) ausgegraut am Ende.
const importe = computed(() => (uebersicht.value?.quellen || []).filter((q) => q.gruppe === 'import')
    .sort((a, b) => Number(!!a.beendet) - Number(!!b.beendet)))
const isoTag = (ms) => (ms ? new Date(ms).toLocaleDateString('sv-SE', { timeZone: 'Europe/Zurich' }) : '')
async function setzeGenutztBis(q, datum) {
    await axios.put('/api/portfolio/quellen/genutzt-bis', { quelle: q.quelle, datum: datum || null })
    await ladeUebersicht()
}

async function waehle(e) {
    const f = e.target.files?.[0]
    if (!f) return
    dateiName.value = f.name
    text.value = await f.text()
    ergebnis.value = null
    await pruefe()
    e.target.value = ''
}
async function pruefe() {
    laedt.value = true
    try { pruefung.value = (await axios.post('/api/portfolio/import', { text: text.value, nurPruefen: true })).data }
    catch (e) { pruefung.value = { ok: false, fehler: [{ zeile: 0, grund: e.response?.data?.error || e.message }] } }
    finally { laedt.value = false }
}
async function importiere() {
    laedt.value = true
    try {
        ergebnis.value = (await axios.post('/api/portfolio/import', { text: text.value, ersetzen: ersetzen.value })).data
        pruefung.value = null
        text.value = ''
        await ladeUebersicht()
    } catch (e) { ergebnis.value = { ok: false, fehler: [{ zeile: 0, grund: e.response?.data?.error || e.message }] } }
    finally { laedt.value = false }
}
async function entferne(q) {
    const ort = q.quelle.slice(2)
    if (loeschFrage.value !== q.quelle) { loeschFrage.value = q.quelle; setTimeout(() => { if (loeschFrage.value === q.quelle) loeschFrage.value = null }, 4000); return }
    await axios.delete(`/api/portfolio/import/${encodeURIComponent(ort)}`)
    loeschFrage.value = null
    await ladeUebersicht()
}
const datum = (ms) => new Date(ms).toLocaleDateString('de-CH')
</script>

<template>
    <Karte dicht class="ik">
        <div class="ik-kopf">
            <b>{{ t('portfolio.imTitel') }}</b>
            <Knopf klein symbol="hochladen" :laedt="laedt" @click="feld.click()">{{ t('portfolio.imWaehlen') }}</Knopf>
            <input ref="feld" type="file" accept=".csv,text/csv,text/plain" hidden @change="waehle" />
        </div>
        <p class="at-gedaempft ik-klein">{{ t('portfolio.imText') }}</p>

        <!-- Vorschau -->
        <div v-if="pruefung" class="ik-vorschau">
            <div class="ik-datei"><Symbol name="dokument" :groesse="15" />{{ dateiName }}</div>
            <Hinweis v-if="!pruefung.ok" art="fehler" :titel="t('portfolio.imFehler', { n: pruefung.anzahlFehler || pruefung.fehler.length })">
                <span v-for="f in pruefung.fehler.slice(0, 12)" :key="f.zeile + f.grund" class="ik-fehler">{{ f.zeile ? t('portfolio.imZeile', { n: f.zeile }) + ': ' : '' }}{{ f.grund }}</span>
                <span v-if="pruefung.fehler.length > 12" class="ik-fehler">…</span>
            </Hinweis>
            <template v-else>
                <div v-for="o in pruefung.vorschau" :key="o.ort" class="ik-ort">
                    <div class="ik-ort-kopf">
                        <b>{{ o.ort }}</b>
                        <span class="at-gedaempft">{{ t('portfolio.imZeilen', { n: o.n }) }} · {{ datum(o.von) }} – {{ datum(o.bis) }}</span>
                        <Pille v-if="o.vorhanden" ton="neutral">{{ t('portfolio.imVorhanden') }}</Pille>
                        <Pille v-if="o.negativ.length" ton="schlecht">{{ t('portfolio.imNegativ', { n: o.negativ.length }) }}</Pille>
                    </div>
                    <div class="ik-bestand">
                        <span v-for="b in o.bestand.filter((x) => Math.abs(x.menge) > 0)" :key="b.asset" :class="{ neg: b.menge < 0 }">{{ b.asset }} {{ menge(b.menge) }}</span>
                        <span v-if="!o.bestand.length" class="at-gedaempft">{{ t('portfolio.imLeer') }}</span>
                    </div>
                </div>
                <label v-if="hatVorhandene" class="ik-ersetzen">
                    <input v-model="ersetzen" type="checkbox" />
                    <span>{{ t('portfolio.imErsetzen') }}</span>
                </label>
                <div class="ik-aktionen">
                    <Knopf art="haupt" :laedt="laedt" @click="importiere">{{ t('portfolio.imImportieren', { n: pruefung.zeilen }) }}</Knopf>
                    <Knopf art="leise" @click="pruefung = null; text = ''">{{ t('common.cancel') }}</Knopf>
                </div>
                <p class="at-gedaempft ik-klein">{{ t('portfolio.imDoppelt') }}</p>
            </template>
        </div>
        <Hinweis v-if="ergebnis?.ok" art="gut" class="at-mo-2">{{ t('portfolio.imFertig', { neu: ergebnis.neu, alt: ergebnis.uebersprungen }) }}</Hinweis>
        <Hinweis v-else-if="ergebnis && !ergebnis.ok" art="fehler" class="at-mo-2">{{ ergebnis.fehler?.[0]?.grund }}</Hinweis>

        <!-- Vorhandene Importe -->
        <div v-if="importe.length" class="ik-liste">
            <div v-for="q in importe" :key="q.quelle" class="ik-eintrag" :class="{ beendet: q.beendet }">
                <span><b>{{ q.name }}</b> <small class="at-gedaempft">{{ q.meldung }} · {{ vorZeit(q.letzterAbruf) }}</small>
                    <small v-if="q.beendet" class="ik-beendet">{{ t('portfolio.genutztBisVorbei', { d: datum(q.genutztBis) }) }}</small></span>
                <label class="ik-bis" :title="t('portfolio.genutztBisInfo')">
                    <span>{{ t('portfolio.genutztBis') }}</span>
                    <input type="date" :value="isoTag(q.genutztBis)" @change="setzeGenutztBis(q, $event.target.value)" />
                </label>
                <span class="ik-wert">{{ q.beendet ? '—' : chf(q.chf) }}</span>
                <Knopf art="leise" klein nur-symbol :symbol="loeschFrage === q.quelle ? 'warnung' : 'muell'"
                    :titel="loeschFrage === q.quelle ? t('portfolio.nochmalLoeschen') : t('portfolio.imEntfernen')" @click="entferne(q)" />
            </div>
        </div>
    </Karte>
</template>

<style scoped>
.ik { margin-top: 0.75rem; }
.ik-eintrag.beendet { opacity: 0.55; }
.ik-beendet { display: block; font-size: 0.72rem; color: var(--leise); }
.ik-bis { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.72rem; color: var(--leise); white-space: nowrap; }
.ik-bis input { background: var(--bg); border: 1px solid var(--line-stark); border-radius: var(--radius-knopf); color: var(--text); padding: 0.15rem 0.35rem; font: inherit; font-size: 0.78rem; color-scheme: dark; }
.ik-kopf { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; }
.ik-klein { font-size: 0.8rem; margin: 0.4rem 0; }
.ik-vorschau { margin-top: 0.6rem; padding: 0.75rem; border: 1px dashed var(--line-stark); border-radius: var(--radius-knopf); background: var(--panel-soft); }
.ik-datei { display: flex; gap: 0.35rem; align-items: center; font-size: 0.82rem; color: var(--muted); margin-bottom: 0.5rem; }
.ik-fehler { display: block; font-size: 0.8rem; }
.ik-ort { padding: 0.45rem 0; border-bottom: 1px solid var(--line); }
.ik-ort-kopf { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; font-size: 0.86rem; }
.ik-bestand { display: flex; flex-wrap: wrap; gap: 0.2rem 0.8rem; font-size: 0.75rem; color: var(--muted); margin-top: 0.25rem; font-variant-numeric: tabular-nums; }
.ik-bestand .neg { color: var(--bad); }
.ik-aktionen { display: flex; gap: 0.5rem; margin-top: 0.75rem; flex-wrap: wrap; }
.ik-liste { margin-top: 0.6rem; }
.ik-ersetzen { display: flex; gap: 0.45rem; align-items: flex-start; font-size: 0.82rem; margin-top: 0.6rem; color: var(--muted); cursor: pointer; }
.ik-ersetzen input { accent-color: var(--accent); margin-top: 0.15rem; }
.ik-eintrag { display: grid; grid-template-columns: minmax(0, 1fr) auto auto auto; gap: 0.6rem; align-items: center; padding: 0.4rem 0; border-top: 1px solid var(--line); font-size: 0.85rem; }
.ik-wert { font-variant-numeric: tabular-nums; }
</style>
