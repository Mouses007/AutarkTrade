<script setup>
/**
 * Bibliothek — alle Strategien an einem Ort (Strategien-Modus, erster Schritt:
 * Strategie → prüfen im Labor → laufen lassen als Instanz).
 *
 *   /strategien/bibliothek                 Liste: eingebaute und eigene Strategien
 *   /strategien/bibliothek/neu             Start einer neuen Strategie: Beschreiben,
 *                                          Vorlage, Leer, Import; angefangene Gespräche
 *   /strategien/bibliothek/neu?beschreiben=1 | ?leer=1 | ?vorlage=<key> | ?entwurf=<id>
 *                                          Regel-Editor mit diesem Anfang
 *   /strategien/bibliothek/:kurzname       eigene → Regel-Editor, eingebaute → Ansicht
 *
 * Bis 01.11.2026 zwei Seiten („Strategie-Editor", „Neue Strategie") mit je
 * einem eigenen Chat; die eingebauten Strategien kamen nirgends vor.
 */
import { ref, computed, watch, onBeforeMount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import axios from 'axios'
import { useI18n } from 'vue-i18n'
import { seiteLaedt } from '../stores/ui.js'
import SeiteLaedt from '../components/SeiteLaedt.vue'
import RegelEditor from '../components/strategien/RegelEditor.vue'
import StrategyParamForm from '../components/StrategyParamForm.vue'
import { apiFehlerText } from '../utils/apiError.js'
import { logError } from '../utils/logger.js'
import { Knopf, Pille, Symbol, Hinweis } from '../components/basis'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

const PFAD = '/strategien/bibliothek'
const LABOR = '/strategien/labor'

/**
 * Eingebaute Strategien, die es als Vorlage gibt: „Als eigene Kopie
 * bearbeiten" legt eine Regelstrategie an, die sich gleich verhält (der
 * Gleichheitstest in `__selftest-rules.mjs` hält das fest).
 */
const ALS_VORLAGE = { ema_touch: 'ema_pullback' }

/**
 * Ein frisches Regelwerk, das LAUFFÄHIG startet und HANDELT: Long beim Retest
 * eines bestätigten Swing-Tiefs, Stop knapp darunter. Bis 01.11.2026 begann
 * „Leer" mit einem Swing-HOCH, das von oben berührt werden sollte — der Kurs
 * liegt bei der Bestätigung aber schon darunter, jedes Setup endete als
 * `entry_before_confirm`, kein einziger Trade.
 */
const LEER = () => ({
    timeframes: ['1h'], direction: 'long', warmupCandles: 300,
    params: [], indicators: [], signal: { type: 'pivotLow', left: 5, right: 2 },
    signalFilters: [], entryFilters: [], entry: { type: 'touch', anchor: 'signalPrice', from: 'above' },
    invalidations: [{ type: 'timeout', code: 'zu_lang', candles: 20 }],
    stopLoss: { anchor: 'signalLow', offsetPct: 0.5 },
    takeProfit: { mode: 'rr', rr: 2 },
    breakEvenAtR: 1,
})

const registry = ref({ strategies: [] })
const eigene = ref([])
const instanzen = ref([])
const vorlagen = ref([])
const versteckteVorlagen = ref([])
const entwuerfe = ref([])
const meldung = ref('')
const fehler = ref('')
const loeschFrage = ref('')

async function laden() {
    try {
        const [reg, regeln, inst, bl, ew] = await Promise.all([
            axios.get('/api/strategies/registry'),
            axios.get('/api/strategies/rules'),
            axios.get('/api/strategies/instances'),
            axios.get('/api/strategies/rules/blocks'),
            axios.get('/api/strategies/builder/drafts').catch(() => ({ data: [] })),
        ])
        registry.value = reg.data
        eigene.value = regeln.data
        instanzen.value = inst.data
        vorlagen.value = bl.data.vorlagen || []
        versteckteVorlagen.value = bl.data.versteckteVorlagen || []
        entwuerfe.value = ew.data || []
    } catch (e) {
        logError('StrategieBibliothek', 'Laden fehlgeschlagen', e)
        fehler.value = apiFehlerText(e, t('strategies.loadFailed'), t)
    }
}

onBeforeMount(async () => {
    seiteLaedt.value = true
    await laden()
    seiteLaedt.value = false
})

const eingebaute = computed(() => registry.value.strategies.filter((s) => s.eingebaut))
const instanzenVon = (sid) => instanzen.value.filter((i) => i.strategyId === sid && !Number(i.archiviert)).length

// ── Was ist offen? ──────────────────────────────────────────────────────
const id = computed(() => String(route.params.id || ''))
const ansicht = computed(() => {
    if (!id.value) return 'liste'
    if (id.value === 'neu') return Object.keys(route.query).length ? 'editor' : 'start'
    if (eigene.value.some((s) => s.strategyId === id.value)) return 'editor'
    if (eingebaute.value.some((s) => s.id === id.value)) return 'eingebaut'
    return seiteLaedt.value ? 'laedt' : 'fehlt'
})
const eingebauteOffen = computed(() => eingebaute.value.find((s) => s.id === id.value) || null)

/** Anfang für den Editor — aus der Adresse, damit Zurück/Vor funktionieren. */
const start = computed(() => {
    if (ansicht.value !== 'editor') return null
    const q = route.query
    if (id.value !== 'neu') {
        const s = eigene.value.find((x) => x.strategyId === id.value)
        return { id: s.id, strategyId: s.strategyId, name: s.name, description: s.description, rules: s.rules }
    }
    if (q.vorlage) {
        const v = vorlagen.value.find((x) => x.key === q.vorlage)
        if (!v) return null
        return { strategyId: v.key, name: v.titel, description: v.beschreibung, rules: JSON.parse(JSON.stringify(v.rules)) }
    }
    if (q.entwurf) {
        const d = entwuerfe.value.find((x) => String(x.id) === String(q.entwurf))
        if (!d) return null
        const spec = d.spec && typeof d.spec === 'object' && d.spec.timeframes ? d.spec : null
        return {
            strategyId: spec?.id || '', name: spec?.name || '', description: spec?.description || '',
            rules: spec || LEER(), beschreiben: !spec,
            gespraech: { draftId: d.id, verlauf: d.messages || [] },
        }
    }
    return { strategyId: '', name: '', description: '', rules: LEER(), beschreiben: Boolean(q.beschreiben) }
})

// Nach dem ersten Speichern wechselt die Adresse von …/neu?… auf den Kurznamen —
// der Editor soll dabei NICHT neu aufgebaut werden (Meldung, Test, Gespräch).
const umgezogen = ref({})
const editorSchluessel = computed(() => umgezogen.value[id.value] || route.fullPath)

async function gespeichert({ strategyId }) {
    const vorher = route.fullPath
    await laden()
    if (id.value === 'neu' && strategyId) {
        umgezogen.value = { ...umgezogen.value, [strategyId]: vorher }
        router.replace(`${PFAD}/${strategyId}`)
    }
}

watch(() => route.fullPath, () => { meldung.value = ''; fehler.value = ''; loeschFrage.value = '' })

// ── Aktionen der Liste ──────────────────────────────────────────────────
const importFeld = ref(null)

async function exportieren(s) {
    fehler.value = ''
    try {
        const r = await axios.get(`/api/strategies/rules/${s.id}/export`)
        const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `strategie-${s.strategyId}-v${r.data.strategie?.version || 1}.json`
        a.click()
        URL.revokeObjectURL(url)
        meldung.value = t('strategies.exported', { name: s.name })
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.exportFailed'), t)
    }
}

async function importDatei(ereignis) {
    const datei = ereignis.target.files?.[0]
    // Feld sofort leeren, sonst löst dieselbe Datei beim zweiten Mal nichts aus.
    ereignis.target.value = ''
    if (!datei) return
    fehler.value = ''
    meldung.value = ''
    try {
        let paket
        try { paket = JSON.parse(await datei.text()) } catch { throw new Error(t('strategies.importNoJson')) }
        const r = await axios.post('/api/strategies/rules/import', { paket })
        await laden()
        await router.push(`${PFAD}/${r.data.strategyId}`)
        meldung.value = r.data.umbenannt
            ? t('strategies.importedRenamed', { id: r.data.strategyId })
            : t('strategies.imported', { id: r.data.strategyId })
    } catch (e) {
        fehler.value = e.response ? apiFehlerText(e, t('strategies.importFailed'), t) : e.message
    }
}

async function kopieren(s) {
    fehler.value = ''
    try {
        const r = await axios.post(`/api/strategies/rules/${s.id}/duplicate`)
        await laden()
        meldung.value = t('strategien.bibliothek.kopiert', { id: r.data.strategyId })
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.saveFailed'), t)
    }
}

async function loeschen(s) {
    fehler.value = ''
    try {
        await axios.delete(`/api/strategies/rules/${s.id}`)
        loeschFrage.value = ''
        await laden()
        if (id.value) router.push(PFAD)
    } catch (e) {
        loeschFrage.value = ''
        fehler.value = apiFehlerText(e, t('strategies.deleteFailed'), t)
    }
}

/**
 * Vorlage aus der Auswahl nehmen. Sie steht im Code und wird nicht gelöscht —
 * eine ausgeblendete Vorlage soll später wiederkommen können.
 */
async function vorlagenSpeichern(liste) {
    try {
        await axios.put('/api/db/settings', { strategyHiddenTemplates: liste })
        await laden()
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.saveFailed'), t)
    }
}
const vorlageAusblenden = (v) => vorlagenSpeichern([...new Set([...versteckteVorlagen.value, v.key])])

async function entwurfLoeschen(d) {
    try {
        await axios.delete(`/api/strategies/builder/drafts/${d.id}`)
        loeschFrage.value = ''
        await laden()
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.deleteFailed'), t)
    }
}

/** Farbe der Marktphasen-Marke: Trend Akzent, Seitwärts gelb, Rest neutral. */
function marktTon(markt) {
    const m = String(markt || '').toLowerCase()
    if (m.startsWith('seitwärts')) return 'warn'
    if (m.startsWith('trend') || m.startsWith('bullentrend')) return 'akzent'
    return 'neutral'
}

const QUELLE = { user: 'quelleHand', chat: 'quelleChat', import: 'quelleImport' }
const quelleText = (s) => (QUELLE[s.source] ? t('strategien.bibliothek.' + QUELLE[s.source]) : '')
// Ohne Beschreibung: der Auslöser sagt am meisten (der erste Satz nennt nur die Richtung).
const kurzSatz = (s) => s.description || s.saetze?.find((x) => x.titel === 'Auslöser')?.text || s.saetze?.[0]?.text || ''
</script>

<template>
    <SeiteLaedt />
    <div v-show="!seiteLaedt" class="bibliothekSeite">

        <!-- ══ Regel-Editor ══ -->
        <RegelEditor v-if="ansicht === 'editor' && start" :key="editorSchluessel" :start="start"
            @gespeichert="gespeichert" @zurueck="router.push(PFAD)" />

        <template v-else>
            <div class="kopf">
                <Knopf v-if="ansicht !== 'liste'" klein art="leise" symbol="pfeilLinks" :to="PFAD">{{ t('strategien.bibliothek.titel') }}</Knopf>
                <h5 class="seitentitel">
                    <template v-if="ansicht === 'liste'">{{ t('strategien.bibliothek.titel') }}</template>
                    <template v-else-if="ansicht === 'start'">{{ t('strategien.bibliothek.neu') }}</template>
                    <template v-else-if="eingebauteOffen">{{ eingebauteOffen.name }}</template>
                </h5>
                <span class="platz"></span>
                <Knopf v-if="ansicht === 'liste'" klein art="haupt" symbol="plus" :to="PFAD + '/neu'">{{ t('strategien.bibliothek.neu') }}</Knopf>
            </div>

            <Hinweis v-if="meldung" art="info" class="abstand">{{ meldung }}</Hinweis>
            <Hinweis v-if="fehler" art="fehler" class="abstand">{{ fehler }}</Hinweis>
            <Hinweis v-if="ansicht === 'fehlt' || (ansicht === 'editor' && !start)" art="warn" class="abstand">
                {{ route.query.vorlage ? t('strategien.bibliothek.vorlageFehlt', { key: route.query.vorlage }) : t('strategien.bibliothek.nichtGefunden') }}
            </Hinweis>

            <!-- ══ Liste ══ -->
            <template v-if="ansicht === 'liste'">
                <p class="at-gedaempft klein">{{ t('strategien.bibliothek.hinweis') }}</p>

                <div class="journalKarte karte abstand">
                    <div class="abschnittTitel">{{ t('strategien.bibliothek.eigene') }}</div>
                    <p v-if="!eigene.length" class="at-gedaempft klein">{{ t('strategien.bibliothek.eigeneLeer') }}</p>
                    <div v-else class="at-tabelle-huelle">
                        <table class="at-tabelle dicht">
                            <tbody>
                                <tr v-for="s in eigene" :key="s.id" class="klickZeile" tabindex="0"
                                    @click="router.push(`${PFAD}/${s.strategyId}`)" @keydown.enter="router.push(`${PFAD}/${s.strategyId}`)">
                                    <td class="nameZelle">
                                        <strong>{{ s.name }}</strong>
                                        <Pille v-if="!s.geladen" ton="schlecht" class="klein abstandLinks">{{ t('strategies.notLoaded') }}</Pille>
                                        <div class="meta">
                                            <span>{{ s.strategyId }} · v{{ s.version || 1 }}</span>
                                            <span>{{ (s.rules.timeframes || []).join(', ') }}</span>
                                            <span v-if="quelleText(s)">{{ quelleText(s) }}</span>
                                            <span>{{ t('strategien.bibliothek.instanzen', { n: instanzenVon(s.strategyId) }) }}</span>
                                        </div>
                                        <div v-if="kurzSatz(s)" class="at-gedaempft klein">{{ kurzSatz(s) }}</div>
                                    </td>
                                    <td class="zahl aktionen" @click.stop @keydown.enter.stop>
                                        <Knopf klein :to="`${LABOR}?strategie=${s.strategyId}`">{{ t('strategien.bibliothek.imLabor') }}</Knopf>
                                        <Knopf klein :to="`/strategien/instanzen/neu?strategie=${s.strategyId}`">{{ t('strategien.bibliothek.instanzAnlegen') }}</Knopf>
                                        <Knopf klein nurSymbol symbol="herunterladen" :titel="t('strategies.exportTitle')" @click="exportieren(s)" />
                                        <Knopf klein nurSymbol symbol="kopieren" :titel="t('strategies.duplicate')" @click="kopieren(s)" />
                                        <template v-if="loeschFrage === s.strategyId">
                                            <Knopf art="gefahr" klein @click="loeschen(s)">{{ t('common.yes') }}</Knopf>
                                            <Knopf klein @click="loeschFrage = ''">{{ t('common.no') }}</Knopf>
                                        </template>
                                        <Knopf v-else art="gefahr" klein nurSymbol symbol="muell" :titel="t('common.delete')" @click="loeschFrage = s.strategyId" />
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <div class="journalKarte karte abstand">
                    <div class="abschnittTitel">{{ t('strategien.bibliothek.eingebaut') }}</div>
                    <div class="at-tabelle-huelle">
                        <table class="at-tabelle dicht">
                            <tbody>
                                <tr v-for="s in eingebaute" :key="s.id" class="klickZeile" tabindex="0"
                                    @click="router.push(`${PFAD}/${s.id}`)" @keydown.enter="router.push(`${PFAD}/${s.id}`)">
                                    <td class="nameZelle">
                                        <strong>{{ s.name }}</strong>
                                        <div class="meta">
                                            <span>{{ s.id }} · v{{ s.version }}</span>
                                            <span>{{ (s.supportedTimeframes || []).join(', ') }}</span>
                                            <span>{{ t('strategien.bibliothek.instanzen', { n: instanzenVon(s.id) }) }}</span>
                                        </div>
                                        <div v-if="s.description" class="at-gedaempft klein">{{ s.description }}</div>
                                    </td>
                                    <td class="zahl aktionen" @click.stop @keydown.enter.stop>
                                        <Knopf klein :to="`${LABOR}?strategie=${s.id}`">{{ t('strategien.bibliothek.imLabor') }}</Knopf>
                                        <Knopf klein :to="`/strategien/instanzen/neu?strategie=${s.id}`">{{ t('strategien.bibliothek.instanzAnlegen') }}</Knopf>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </template>

            <!-- ══ Eingebaute Strategie ══ -->
            <div v-else-if="ansicht === 'eingebaut' && eingebauteOffen" class="journalKarte karte">
                <p v-if="eingebauteOffen.description">{{ eingebauteOffen.description }}</p>
                <div class="chips abstandUnten">
                    <Pille ton="neutral">{{ t('strategien.bibliothek.eingebaut') }} · v{{ eingebauteOffen.version }}</Pille>
                    <Pille v-for="tf in eingebauteOffen.supportedTimeframes" :key="tf" ton="neutral">{{ tf }}</Pille>
                    <Pille ton="neutral">{{ t('strategien.bibliothek.instanzen', { n: instanzenVon(eingebauteOffen.id) }) }}</Pille>
                </div>
                <div class="knopfzeile abstandUnten">
                    <Knopf klein art="haupt" :to="`${LABOR}?strategie=${eingebauteOffen.id}`">{{ t('strategien.bibliothek.imLabor') }}</Knopf>
                    <Knopf klein :to="`/strategien/instanzen/neu?strategie=${eingebauteOffen.id}`">{{ t('strategien.bibliothek.instanzAnlegen') }}</Knopf>
                    <Knopf v-if="ALS_VORLAGE[eingebauteOffen.id]" klein symbol="kopieren"
                        :to="`${PFAD}/neu?vorlage=${ALS_VORLAGE[eingebauteOffen.id]}`">{{ t('strategien.bibliothek.alsKopie') }}</Knopf>
                </div>
                <p v-if="ALS_VORLAGE[eingebauteOffen.id]" class="at-gedaempft klein">
                    {{ t('strategien.bibliothek.alsKopieHinweis', { vorlage: ALS_VORLAGE[eingebauteOffen.id] }) }}
                </p>
                <div class="abschnittTitel abstand">{{ t('strategien.bibliothek.parameter') }}</div>
                <p class="at-gedaempft klein">{{ t('strategien.bibliothek.eingebautHinweis') }}</p>
                <StrategyParamForm :model-value="{}" :schema="eingebauteOffen.params || []" :groups="eingebauteOffen.paramGroups || []"
                    :i18n-prefix="'strategies.' + eingebauteOffen.id" disabled />
            </div>

            <!-- ══ Neue Strategie: wie soll sie entstehen? ══ -->
            <template v-else-if="ansicht === 'start'">
                <div class="wege">
                    <RouterLink class="weg journalKarte" :to="PFAD + '/neu?beschreiben=1'">
                        <Symbol name="nachricht" :groesse="22" />
                        <strong>{{ t('strategien.bibliothek.start.beschreiben') }}</strong>
                        <span class="at-gedaempft klein">{{ t('strategien.bibliothek.start.beschreibenText') }}</span>
                    </RouterLink>
                    <a class="weg journalKarte" href="#vorlagen">
                        <Symbol name="wuerfel" :groesse="22" />
                        <strong>{{ t('strategien.bibliothek.start.vorlage') }}</strong>
                        <span class="at-gedaempft klein">{{ t('strategien.bibliothek.start.vorlageText') }}</span>
                    </a>
                    <RouterLink class="weg journalKarte" :to="PFAD + '/neu?leer=1'">
                        <Symbol name="plus" :groesse="22" />
                        <strong>{{ t('strategien.bibliothek.start.leer') }}</strong>
                        <span class="at-gedaempft klein">{{ t('strategien.bibliothek.start.leerText') }}</span>
                    </RouterLink>
                    <button type="button" class="weg journalKarte" @click="importFeld?.click()">
                        <Symbol name="hochladen" :groesse="22" />
                        <strong>{{ t('strategien.bibliothek.start.import') }}</strong>
                        <span class="at-gedaempft klein">{{ t('strategien.bibliothek.start.importText') }}</span>
                    </button>
                    <!-- Import über ein verstecktes Dateifeld: ein Klick, kein Dialog. -->
                    <input ref="importFeld" type="file" accept="application/json,.json" class="versteckt" @change="importDatei" />
                </div>

                <div v-if="entwuerfe.length" class="journalKarte karte abstand">
                    <div class="abschnittTitel">{{ t('strategien.bibliothek.entwuerfe') }}</div>
                    <p class="at-gedaempft klein">{{ t('strategien.bibliothek.entwuerfeHinweis') }}</p>
                    <div class="at-tabelle-huelle">
                        <table class="at-tabelle dicht">
                            <tbody>
                                <tr v-for="d in entwuerfe" :key="d.id">
                                    <td class="nameZelle"><strong>{{ d.title }}</strong>
                                        <div v-if="d.sourceName" class="at-gedaempft klein">{{ d.sourceName }}</div></td>
                                    <td class="at-gedaempft klein">{{ new Date(d.updatedAt).toLocaleString() }}</td>
                                    <td class="zahl aktionen">
                                        <Knopf klein :to="`${PFAD}/neu?entwurf=${d.id}`">{{ t('strategien.bibliothek.oeffnen') }}</Knopf>
                                        <template v-if="loeschFrage === 'entwurf' + d.id">
                                            <Knopf art="gefahr" klein @click="entwurfLoeschen(d)">{{ t('common.yes') }}</Knopf>
                                            <Knopf klein @click="loeschFrage = ''">{{ t('common.no') }}</Knopf>
                                        </template>
                                        <Knopf v-else art="gefahr" klein nurSymbol symbol="muell" :titel="t('common.delete')" @click="loeschFrage = 'entwurf' + d.id" />
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <div id="vorlagen" class="abschnittTitel abstand">{{ t('strategien.bibliothek.vorlagen') }}</div>
                <Hinweis v-if="versteckteVorlagen.length" art="info" class="abstandUnten">
                    {{ t('strategies.templatesHidden', { n: versteckteVorlagen.length }) }}
                    <Knopf klein class="abstandLinks" @click="vorlagenSpeichern([])">{{ t('strategies.templatesRestore') }}</Knopf>
                </Hinweis>
                <div class="vorlagen">
                    <div v-for="v in vorlagen" :key="v.key" class="journalKarte vorlage">
                        <Knopf art="leise" klein nurSymbol symbol="schliessen" class="vorlageWeg"
                            :titel="t('strategies.templateHide')" @click="vorlageAusblenden(v)" />
                        <strong>{{ v.titel }}</strong>
                        <div v-if="v.markt"><span class="markt" :class="marktTon(v.markt)">{{ v.markt }}</span></div>
                        <p class="vorlageText">{{ v.beschreibung }}</p>
                        <Knopf klein :to="`${PFAD}/neu?vorlage=${v.key}`">{{ t('strategies.useTemplate') }}</Knopf>
                    </div>
                </div>
            </template>
        </template>
    </div>
</template>

<style scoped>
.bibliothekSeite { padding: 16px 16px 24px; max-width: 1400px; margin: 0; }   /* linksbündig wie Instanzen */
.kopf { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 12px; }
.kopf .platz { flex: 1; }
.seitentitel { margin: 0; }
.abstand { margin-top: 12px; }
.abstandUnten { margin-bottom: 12px; }
.abstandLinks { margin-left: 8px; }
.karte { padding: 16px; height: auto; }
.abschnittTitel { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin-bottom: 8px; }
.klein { font-size: 0.8rem; }
.knopfzeile, .chips { display: flex; flex-wrap: wrap; gap: 8px; }
.klickZeile { cursor: pointer; }
.klickZeile:hover td, .klickZeile:focus-visible td { background: var(--panel-soft); }
.nameZelle { min-width: 240px; }
.meta { display: flex; flex-wrap: wrap; gap: 2px 14px; font-size: 0.78rem; color: var(--muted); margin: 2px 0; }
.aktionen { white-space: nowrap; }
.aktionen > * + * { margin-left: 4px; }
.versteckt { display: none; }

.wege { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.weg {
    display: flex; flex-direction: column; gap: 6px; align-items: flex-start; text-align: left;
    padding: 16px; height: auto; color: var(--text); text-decoration: none; cursor: pointer;
    font: inherit; border: 1px solid var(--line); background: var(--panel);
}
.weg:hover, .weg:focus-visible { border-color: var(--accent); }
.weg :deep(svg) { color: var(--accent); }

.vorlagen { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.vorlage { position: relative; display: flex; flex-direction: column; gap: 6px; padding: 16px; height: auto; }
.vorlage > strong { padding-right: 28px; }
.vorlageWeg { position: absolute; top: 6px; right: 6px; }
.markt { display: inline-block; padding: 2px 9px; border-radius: var(--radius-pille); font-size: 0.75rem; border: 1px solid var(--line-stark); color: var(--muted); background: var(--panel-soft); }
.markt.akzent { color: var(--accent); border-color: var(--accent-rand); background: var(--accent-flaeche); }
.markt.warn { color: var(--warn); border-color: var(--warn); background: transparent; }
.vorlageText { flex-grow: 1; margin: 0 0 8px; font-size: 0.85rem; color: var(--muted); }

@media (max-width: 991.98px) {
    .wege { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .vorlagen { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 767.98px) {
    .bibliothekSeite { padding: 12px 12px 24px; }
    .wege, .vorlagen { grid-template-columns: 1fr; }
    /* Telefon: Knöpfe unter den Namen statt daneben — sonst schiebt die
       Knopfspalte die Tabelle seitwärts aus dem Bild. */
    .at-tabelle tr, .at-tabelle td { display: block; }
    .nameZelle { min-width: 0; border-bottom: 0; }
    .aktionen { white-space: normal; text-align: left; padding-top: 0; }
    .aktionen > * { margin: 4px 4px 0 0; }
    .aktionen > * + * { margin-left: 0; }
}
</style>
