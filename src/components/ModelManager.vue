<script setup>
/**
 * Modelle verwalten.
 *
 * Zwei getrennte Welten hinter einer Oberfläche:
 *
 *   Cloud-Anbieter — die Liste ist reine Bequemlichkeit. Der Anbieter kennt
 *     seine Modelle, die App muss sie nur anbieten können. Darum: frei
 *     bearbeitbar, mit den eingebauten Namen als Ausgangspunkt.
 *   Ollama — die Liste ist eine Tatsache. Verfügbar ist, was auf der Platte
 *     liegt. Darum: vom Server geholt, mit Laden und Löschen.
 */
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import axios from 'axios'
import { useI18n } from 'vue-i18n'
import { apiFehlerText } from '../utils/apiError.js'
import Knopf from './basis/Knopf.vue'
import Pille from './basis/Pille.vue'
import Hinweis from './basis/Hinweis.vue'

const { t } = useI18n()

const props = defineProps({
    provider: { type: String, required: true },
    ollamaUrl: { type: String, default: '' },
    /*
     * Darf im Panel ein anderer Anbieter gewählt werden?
     *
     * Nur die Instanz unter der Hauptauswahl setzt das. Vorher war `provider`
     * fest der Hauptanbieter, und wer die Modelle von DeepSeek ansehen wollte,
     * musste die ganze App auf DeepSeek umstellen, nachsehen und
     * zurückstellen — für eine reine Leseoperation. Der Endpunkt
     * (`/api/ai/models/available?provider=…`) konnte das immer schon, nur die
     * Oberfläche gab es nicht her.
     *
     * Die Bild-Instanzen (FLUX, Gemini-Bild) bleiben fest: sie verwalten
     * genau eine Liste, eine Auswahl wäre dort sinnlos.
     */
    waehlbar: { type: Boolean, default: false },
})
const emit = defineEmits(['geaendert'])

const offen = ref(false)
const listen = ref({})
const standard = ref({})
const ohneSampling = ref([])
const ollamaModelle = ref([])
const neuerName = ref('')
const angebot = ref(null)      // vom Anbieter geholte Liste
const angebotSuche = ref('')
const holtAngebot = ref(false)
const fehler = ref('')
const meldung = ref('')
const laedt = ref(false)

// Download-Fortschritt
const download = ref(null)
let strom = null

/*
 * Welcher Anbieter gerade verwaltet wird. Startet beim übergebenen und folgt
 * ihm, solange der Nutzer nicht selbst umgeschaltet hat — wer in der
 * Hauptauswahl den Anbieter wechselt, will hier nicht die Liste von vorhin
 * sehen. Nach einer eigenen Wahl gilt sie, bis das Panel geschlossen wird.
 */
const gewaehlt = ref(props.provider)
const selbstGewaehlt = ref(false)
watch(() => props.provider, (neu) => { if (!selbstGewaehlt.value) gewaehlt.value = neu })

const aktiv = computed(() => (props.waehlbar ? gewaehlt.value : props.provider))

/** Anbieter zur Auswahl — nur solche, für die es überhaupt eine Liste gibt. */
const anbieterListe = computed(() =>
    Object.keys(listen.value).filter((id) => !['flux', 'geminiBild'].includes(id)).sort())

const istOllama = computed(() => aktiv.value === 'ollama')
const eigene = computed(() => listen.value[aktiv.value] || [])
const abweichend = computed(() => {
    const s = standard.value[aktiv.value] || []
    return eigene.value.length !== s.length || eigene.value.some((m, i) => m !== s[i])
})

const mb = (b) => (b >= 1073741824 ? (b / 1073741824).toFixed(1) + ' GB' : Math.round(b / 1048576) + ' MB')
const istOhneSampling = (m) => ohneSampling.value.some((p) => String(m).startsWith(p))

async function laden() {
    fehler.value = ''
    try {
        const r = await axios.get('/api/ai/models')
        // Bild-Anbieter (FLUX/Gemini-Bild) stehen in eigenen Feldern, damit
        // `AnbieterWahl.vue` (das `modelle` per `Object.keys()` als
        // Chat-Anbieter-Auswahl liest) sie nicht mitbekommt. Hier, als eigene
        // Instanz je Anbieter, ist das Zusammenführen unbedenklich.
        listen.value = { ...r.data.modelle, ...r.data.bildModelle }
        standard.value = { ...r.data.standard, ...r.data.bildStandard }
        ohneSampling.value = r.data.ohneSampling || []
        if (istOllama.value) await ollamaLaden()
    } catch (e) {
        fehler.value = apiFehlerText(e, t('settings.modelsLoadFailed'), t)
    }
}

async function ollamaLaden() {
    try {
        const r = await axios.get('/api/ollama/models', { params: { url: props.ollamaUrl || undefined } })
        ollamaModelle.value = r.data.models || []
    } catch (e) {
        ollamaModelle.value = []
        fehler.value = apiFehlerText(e, t('settings.ollamaUnreachable'), t)
    }
}

async function oeffnen() {
    offen.value = !offen.value
    if (offen.value) await laden()
}

watch(() => props.provider, () => { if (offen.value) laden() })
// Umschalten im Panel verwirft die geholte Katalogliste — sie gehoerte zum
// vorherigen Anbieter, und stehen zu lassen waere die schlimmere Variante:
// man uebernaehme Modellnamen in die falsche Liste.
watch(aktiv, () => { angebot.value = null; angebotSuche.value = ''; fehler.value = '' })

async function speichern(neueListe) {
    laedt.value = true
    fehler.value = ''
    try {
        // `aktiv`, nicht `props.provider` — sonst landete die Liste des
        // gerade angesehenen Anbieters unter dem Hauptanbieter.
        const ziel = aktiv.value
        const r = await axios.put(`/api/ai/models/${ziel}`, { modelle: neueListe })
        listen.value = r.data.modelle
        emit('geaendert', listen.value[ziel] || [], ziel)
    } catch (e) {
        fehler.value = apiFehlerText(e, t('settings.modelsSaveFailed'), t)
    } finally {
        laedt.value = false
    }
}

function hinzufuegen() {
    const name = neuerName.value.trim()
    if (!name) return
    if (eigene.value.includes(name)) { neuerName.value = ''; return }
    speichern([...eigene.value, name])
    neuerName.value = ''
}

const entfernen = (m) => speichern(eigene.value.filter((x) => x !== m))

/** Den Katalog des Anbieters holen — abtippen ist eine Fehlerquelle. */
async function angebotHolen() {
    holtAngebot.value = true
    fehler.value = ''
    angebotSuche.value = ''
    try {
        const r = await axios.get('/api/ai/models/available', { params: { provider: aktiv.value } })
        angebot.value = r.data.modelle || []
        if (!angebot.value.length) fehler.value = t('settings.providerNoModels')
    } catch (e) {
        angebot.value = null
        fehler.value = apiFehlerText(e, t('settings.providerFetchFailed'), t)
    } finally {
        holtAngebot.value = false
    }
}

const uebernehmen = (m) => speichern([...eigene.value, m])
const alleUebernehmen = () => speichern([...new Set([...eigene.value, ...angebotGefiltert.value])])
const zuruecksetzen = () => speichern([])

/** Bei 400+ Modellen ist Scrollen keine Suche — der Filter wirkt nur auf die
 *  bereits geholte Liste, kein zweiter Serverruf nötig. */
const angebotGefiltert = computed(() => {
    const q = angebotSuche.value.trim().toLowerCase()
    if (!q) return angebot.value || []
    return (angebot.value || []).filter((m) => m.toLowerCase().includes(q))
})

// ── Ollama: laden und löschen ───────────────────────────────────────────

/**
 * Der Download läuft über SSE, weil ein Modell etliche GB gross sein kann.
 * Ohne Fortschritt wäre minutenlang nicht zu unterscheiden, ob es lädt oder
 * hängt.
 */
function herunterladen() {
    const name = neuerName.value.trim()
    if (!name || download.value) return
    fehler.value = ''
    meldung.value = ''
    download.value = { name, status: t('settings.starting'), fertig: 0, gesamt: 0 }

    // POST mit SSE-Antwort — dafür fetch statt EventSource (das kann nur GET).
    const abbruch = new AbortController()
    strom = abbruch
    fetch('/api/ollama/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, url: props.ollamaUrl || undefined }),
        signal: abbruch.signal,
    }).then(async (r) => {
        if (!r.ok || !r.body) {
            const d = await r.json().catch(() => ({}))
            throw new Error(d.error || `HTTP ${r.status}`)
        }
        const leser = r.body.getReader()
        const dec = new TextDecoder()
        let rest = ''
        for (;;) {
            const { done, value } = await leser.read()
            if (done) break
            rest += dec.decode(value, { stream: true })
            const teile = rest.split('\n\n')
            rest = teile.pop() || ''
            for (const t2 of teile) {
                const zeile = t2.split('\n').find((z) => z.startsWith('data: '))
                if (!zeile) continue
                let o
                try { o = JSON.parse(zeile.slice(6)) } catch { continue }
                if (o.fehler) throw new Error(o.fehler)
                if (o.fertigGesamt) {
                    meldung.value = t('settings.modelDownloaded', { name })
                    neuerName.value = ''
                    await ollamaLaden()
                    emit('geaendert', ollamaModelle.value.map((m) => m.name))
                    continue
                }
                download.value = { name, status: o.status || '', fertig: o.fertig || 0, gesamt: o.gesamt || 0 }
            }
        }
    }).catch((e) => {
        if (e.name !== 'AbortError') fehler.value = e.message
    }).finally(() => {
        download.value = null
        strom = null
    })
}

function abbrechen() {
    strom?.abort()
    download.value = null
}

onBeforeUnmount(abbrechen)

const loeschFrage = ref(null)
async function ollamaLoeschen(name) {
    try {
        await axios.delete('/api/ollama/models', { data: { name, url: props.ollamaUrl || undefined } })
        loeschFrage.value = null
        await ollamaLaden()
        emit('geaendert', ollamaModelle.value.map((m) => m.name))
    } catch (e) {
        fehler.value = apiFehlerText(e, t('settings.deleteFailed'), t)
    }
}

const prozent = computed(() => {
    const d = download.value
    return d && d.gesamt > 0 ? Math.round((d.fertig / d.gesamt) * 100) : 0
})
</script>

<template>
    <div class="at-mo-2">
        <Knopf klein :symbol="offen ? 'hoch' : 'runter'" @click="oeffnen">
            {{ t('settings.manageModels') }}
        </Knopf>

        <div v-if="offen" class="modelle at-mo-2 at-p-3">
            <!-- Anbieterwahl: Nur hier, nicht bei den Bild-Instanzen. Wer die
                 Modelle eines anderen Anbieters ansehen will, musste vorher die
                 ganze App umstellen — für eine Leseoperation. -->
            <div v-if="waehlbar" class="at-flex at-mitte at-umbruch at-luecke-2 at-mu-3">
                <label class="at-klein at-gedaempft">{{ t('settings.modelsFor') }}</label>
                <select class="at-feld klein" style="max-width:14rem;"
                    :value="aktiv" @change="e => { gewaehlt = e.target.value; selbstGewaehlt = true }">
                    <option v-for="id in anbieterListe" :key="id" :value="id">{{ id }}</option>
                </select>
                <small v-if="aktiv !== provider" class="at-gedaempft">
                    {{ t('settings.modelsOtherProvider') }}
                </small>
            </div>

            <Hinweis v-if="fehler" art="fehler" class="at-mu-2">{{ fehler }}</Hinweis>
            <Hinweis v-if="meldung" art="gut" class="at-mu-2">{{ meldung }}</Hinweis>

            <!-- ══ Ollama: was auf der Platte liegt ══ -->
            <template v-if="istOllama">
                <p class="at-klein at-gedaempft at-mu-2">{{ t('settings.ollamaModelsHint') }}</p>

                <div v-if="ollamaModelle.length" class="at-tabelle-huelle at-mu-2">
                    <table class="at-tabelle dicht ohneRand">
                        <tbody>
                            <tr v-for="m in ollamaModelle" :key="m.name">
                                <td><span class="mono">{{ m.name }}</span></td>
                                <td class="at-klein at-gedaempft">{{ m.parameter }} {{ m.quantisierung }}</td>
                                <td class="at-klein at-gedaempft at-rechtsbuendig at-nowrap">{{ mb(m.groesseBytes) }}</td>
                                <td class="at-rechtsbuendig" style="white-space: nowrap; width: 6rem;">
                                    <span v-if="loeschFrage === m.name" class="at-iflex at-luecke-1">
                                        <Knopf art="gefahr" klein @click="ollamaLoeschen(m.name)">{{ t('common.yes') }}</Knopf>
                                        <Knopf art="leise" klein @click="loeschFrage = null">{{ t('common.no') }}</Knopf>
                                    </span>
                                    <Knopf v-else art="leise" klein nur-symbol symbol="muell"
                                        :titel="t('settings.deleteModel')" @click="loeschFrage = m.name" />
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p v-else class="at-klein at-gedaempft">{{ t('settings.noOllamaModels') }}</p>

                <div v-if="download" class="at-mu-2">
                    <div class="at-flex at-mitte at-umbruch at-luecke-2 at-klein">
                        <span class="at-wachsen">{{ download.name }} — {{ download.status }}</span>
                        <span v-if="download.gesamt">{{ mb(download.fertig) }} / {{ mb(download.gesamt) }}</span>
                        <Knopf art="leise" klein @click="abbrechen">{{ t('common.cancel') }}</Knopf>
                    </div>
                    <div class="fortschritt at-mo-1" role="progressbar" :aria-valuenow="prozent" aria-valuemin="0" aria-valuemax="100">
                        <div class="fortschrittBalken" :style="{ width: prozent + '%' }"></div>
                    </div>
                </div>

                <div class="at-flex at-luecke-2">
                    <input v-model="neuerName" class="at-feld klein at-wachsen"
                        :placeholder="t('settings.ollamaPullPlaceholder')"
                        :disabled="!!download" @keydown.enter.prevent="herunterladen" />
                    <Knopf art="haupt" klein symbol="herunterladen" :disabled="!!download || !neuerName.trim()"
                        @click="herunterladen">{{ t('settings.download') }}</Knopf>
                </div>
                <p class="at-hilfe">{{ t('settings.ollamaPullHint') }}</p>
            </template>

            <!-- ══ Cloud-Anbieter: freie Liste ══ -->
            <template v-else>
                <p class="at-klein at-gedaempft at-mu-2">{{ t('settings.cloudModelsHint') }}</p>

                <div v-for="m in eigene" :key="m" class="at-flex at-mitte at-luecke-2 at-mu-1">
                    <span class="mono at-wachsen">{{ m }}</span>
                    <Pille v-if="istOhneSampling(m)" ton="neutral"
                        :title="t('settings.noSamplingHint')">{{ t('settings.noSampling') }}</Pille>
                    <Knopf art="leise" klein nur-symbol symbol="schliessen" :titel="t('common.remove')" @click="entfernen(m)" />
                </div>

                <div class="at-flex at-umbruch at-luecke-2 at-mo-3">
                    <Knopf klein symbol="herunterladen" :laedt="holtAngebot" @click="angebotHolen">
                        {{ t('settings.fetchFromProvider') }}
                    </Knopf>
                    <Knopf v-if="angebot" art="leise" klein @click="angebot = null; angebotSuche = ''">
                        {{ t('common.close') }}
                    </Knopf>
                </div>

                <div v-if="angebot" class="angebot at-mo-2 at-p-2">
                    <div class="at-flex at-mitte at-luecke-2 at-mu-1">
                        <span class="at-klein at-gedaempft at-wachsen">
                            {{ angebotSuche.trim() ? t('settings.providerOffersFiltered', { n: angebotGefiltert.length, gesamt: angebot.length }) : t('settings.providerOffers', { n: angebot.length }) }}
                        </span>
                        <Knopf klein @click="alleUebernehmen">{{ t('settings.addAll') }}</Knopf>
                    </div>
                    <input v-model="angebotSuche" type="text" class="at-feld klein at-mu-2"
                        :placeholder="t('settings.searchModelsPlaceholder')" />
                    <div v-if="!angebotGefiltert.length" class="at-klein at-gedaempft at-py-1">
                        {{ t('settings.noModelsMatch') }}
                    </div>
                    <div v-for="m in angebotGefiltert" :key="m" class="at-flex at-mitte at-luecke-2 at-py-1">
                        <span class="mono at-wachsen" :class="{ 'at-gedaempft': eigene.includes(m) }">{{ m }}</span>
                        <Pille v-if="istOhneSampling(m)" ton="neutral">{{ t('settings.noSampling') }}</Pille>
                        <span v-if="eigene.includes(m)" class="at-klein at-gedaempft">{{ t('settings.alreadyInList') }}</span>
                        <Knopf v-else klein nur-symbol symbol="plus" :titel="t('settings.addModel')" @click="uebernehmen(m)" />
                    </div>
                </div>

                <div class="at-flex at-umbruch at-luecke-2 at-mo-2">
                    <input v-model="neuerName" class="at-feld klein at-wachsen"
                        :placeholder="t('settings.modelNamePlaceholder')"
                        @keydown.enter.prevent="hinzufuegen" />
                    <Knopf klein nur-symbol symbol="plus" :titel="t('settings.addModel')"
                        :disabled="laedt || !neuerName.trim()" @click="hinzufuegen" />
                    <Knopf v-if="abweichend" art="leise" klein :disabled="laedt" @click="zuruecksetzen">
                        {{ t('settings.resetList') }}
                    </Knopf>
                </div>
            </template>
        </div>
    </div>
</template>

<style scoped>
.modelle {
    border: 1px solid var(--line);
    border-radius: var(--radius-knopf);
    background: var(--panel-soft);
}

.mono {
    font-family: var(--schrift-mono);
    font-size: 0.8rem;
    overflow-wrap: anywhere;
    min-width: 0;
}

.ohneRand td {
    border-bottom: 0;
}

.angebot {
    border: 1px solid var(--line);
    border-radius: var(--radius-knopf);
    max-height: 40vh;
    overflow-y: auto;
}

.fortschritt {
    height: 6px;
    border-radius: var(--radius-pille);
    background: var(--panel-hoch);
    overflow: hidden;
}

.fortschrittBalken {
    height: 100%;
    background: var(--accent);
    transition: width 0.2s;
}
</style>
