<script setup>
/**
 * Auswertung des Journals (Spezifikation ansichten.md „Auswertung", W.1–W.8):
 * Tachos, Tag-Gruppen, Zeitrahmen, Stress und Emotion, Vollständigkeit.
 *
 * Die Zahlen rechnet `components/auswertung/rechnung.js`; die Seite baut den
 * Aufbau und ruft die Diagrammfunktionen über die Element-IDs. Ein Wechsel
 * von Brutto/Netto ohne Neuladen zeichnet die Diagramme nicht neu (die
 * Tabellen schon) — Altverhalten; ein Filterwechsel lädt ohnehin neu.
 */
import { computed, ref, watch, nextTick, onBeforeMount, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { seiteLaedt, auswertungMounted } from '../stores/ui.js'
import { betragArt } from '../stores/filters.js'
import { journalTage, auswertungNotes, zufriedenheitTage, zufriedenheitTrades, tags, verfuegbareTags } from '../stores/trades.js'
import { useMountAuswertung } from '../utils/journal/ablauf.js'
import { ladeDiagramme, geladeneDiagramme } from '../utils/journal/diagrammLader.js'
import { formDatumKurz } from '../utils/journal/format.js'
import { palette, mitDeckkraft } from '../utils/journal/diagramme/gestaltung.js'
import SeiteLaedt from '../components/SeiteLaedt.vue'
import NoData from '../components/NoData.vue'
import KartenMenue from '../components/dashboard/KartenMenue.vue'
import TitelKarte from '../components/dashboard/TitelKarte.vue'
import {
    basis, tachos, tagGruppen, tagGruppenDiagramme, zeitrahmen, verlauf, quoteJeStufe, radarWerte,
} from '../components/auswertung/rechnung.js'

const { t } = useI18n()

// ── Daten ────────────────────────────────────────────────────────────────
const b = computed(() => basis({
    gefilterteTage: journalTage,
    notizen: auswertungNotes,
    tagZeilen: tags,
    katalog: verfuegbareTags,
}))
const fall = computed(() => betragArt.value)
const mitTrades = computed(() => b.value.trades.length > 0)

const tacho = computed(() => tachos(b.value, fall.value, [...zufriedenheitTage, ...zufriedenheitTrades]))
const gruppen = computed(() => tagGruppen(b.value, fall.value))
const gruppenDiagramme = computed(() => tagGruppenDiagramme(gruppen.value))
const rahmen = computed(() => zeitrahmen(b.value, fall.value))
const stress = computed(() => verlauf(b.value, 'entryStressLevel'))
const emotion = computed(() => verlauf(b.value, 'emotionLevel'))
const stressQuote = computed(() => quoteJeStufe(b.value, 'entryStressLevel', 0, 5, fall.value))
const emotionQuote = computed(() => quoteJeStufe(b.value, 'emotionLevel', 1, 10, fall.value))

// ── Karten-Menü ──────────────────────────────────────────────────────────
function leseVerborgen() {
    try {
        const l = JSON.parse(localStorage.getItem('auswertung_hidden_cards') || '[]')
        return Array.isArray(l) ? l : []
    } catch {
        return []
    }
}
const verborgen = ref(leseVerborgen())
const zeige = (k) => !verborgen.value.includes(k)

const kartenListe = computed(() => [
    { schluessel: 'longShort', titel: t('auswertung.longShortRatio') },
    { schluessel: 'satisfaction', titel: t('auswertung.satisfactionRate') },
    { schluessel: 'completeness', titel: t('auswertung.journalCompleteness') },
    { schluessel: 'timeframe', titel: t('auswertung.timeframeUsage') },
    { schluessel: 'stressTime', titel: t('auswertung.stressProgress') },
    { schluessel: 'stressPerf', titel: t('auswertung.stressVsWinRate') },
    { schluessel: 'emotionTime', titel: t('auswertung.emotionProgress') },
    { schluessel: 'emotionPerf', titel: t('auswertung.emotionVsWinRate') },
    { schluessel: 'radar', titel: t('auswertung.completenessRadar') },
])
// Gruppen werden nach Name verschlüsselt: zwei gleichnamige teilen sich einen Schalter.
const gruppenListe = computed(() => gruppen.value.map(g => ({ schluessel: 'tag_' + g.name, titel: g.name })))

async function umschalten(k) {
    const warVerborgen = verborgen.value.includes(k)
    verborgen.value = warVerborgen ? verborgen.value.filter(x => x !== k) : [...verborgen.value, k]
    try { localStorage.setItem('auswertung_hidden_cards', JSON.stringify(verborgen.value)) } catch { /* privater Modus */ }
    // Wieder eingeblendet: sonst bliebe die Karte leer bis zum nächsten Laden.
    if (warVerborgen) {
        await nextTick()
        await zeichnen()
    }
}

// ── Zeichnen ─────────────────────────────────────────────────────────────
async function gruppenZeichnen(d) {
    for (const g of gruppenDiagramme.value) {
        if (g.kategorien.length) d.useSplitBarChart(g.element, g.kategorien, g.gewinne, g.verluste)
    }
}

async function zeichnen() {
    await nextTick()
    const d = await ladeDiagramme()
    const p = palette()
    const ampel = [[0.3, mitDeckkraft(p.bad, 0.85)], [0.7, mitDeckkraft(p.warn, 0.85)], [1, mitDeckkraft(p.good, 0.85)]]
    const tc = tacho.value
    // Long/Short ist eine Richtungsanzeige, keine Bewertung: mehr Short rot, mehr Long grün.
    d.useGaugeChart('gaugeChart1', tc.longAnteil, t('auswertung.longShortRatio'), [[0.5, mitDeckkraft(p.bad, 0.85)], [1, mitDeckkraft(p.good, 0.85)]])
    d.useGaugeChart('gaugeChart2', tc.zufriedenheit, t('auswertung.satisfactionRate'), ampel)
    d.useGaugeChart('gaugeChart3', tc.vollstaendig, t('auswertung.journalCompleteness'), ampel)
    await gruppenZeichnen(d)

    if (rahmen.value.length) {
        // Gelb statt Rot: „mehr Verlierer" ist hier nur ein Hinweis.
        const farben = rahmen.value.map(r => (r.gewinner / r.anzahl >= 0.5 ? p.goodBalken : mitDeckkraft(p.warn, 0.85)))
        d.useHorizontalBarChart('hbarChart2', rahmen.value.map(r => r.name), rahmen.value.map(r => r.anzahl), farben)
    }
    if (stress.value.liste.length) {
        d.useStressLineChart('stressLineChart', stress.value.liste.map(n => formDatumKurz(n.dateUnix)),
            stress.value.liste.map(n => Number(n.entryStressLevel)), { max: 10 })
    }
    if (stressQuote.value.length) {
        d.useHorizontalBarChart('hbarChart3', stressQuote.value.map(s => `Stress ${s.stufe}`), stressQuote.value.map(s => s.quote),
            stressQuote.value.map(s => (s.quote >= 50 ? p.goodBalken : p.badBalken)))
    }
    if (emotion.value.liste.length) {
        d.useStressLineChart('emotionLineChart', emotion.value.liste.map(n => formDatumKurz(n.dateUnix)),
            emotion.value.liste.map(n => Number(n.emotionLevel)), { max: 10, color: p.good, name: t('auswertung.emotionProgress') })
    }
    if (emotionQuote.value.length) {
        d.useHorizontalBarChart('hbarChart4', emotionQuote.value.map(s => `Level ${s.stufe}`), emotionQuote.value.map(s => s.quote),
            emotionQuote.value.map(s => (s.quote >= 50 ? p.goodBalken : p.badBalken)))
    }
    d.useRadarChart('radarChart1', radarIndikatoren.value, radarWerte(b.value))
}

const radarIndikatoren = computed(() => [
    'radarPlaybook', 'radarTimeframe', 'radarStress', 'radarEmotion', 'radarNotes', 'radarTags',
].map(k => ({ name: t('auswertung.' + k), max: 100 })))

watch(auswertungMounted, async (an) => {
    if (!an || !mitTrades.value) return
    await nextTick()
    await nextTick()
    await zeichnen()
})

watch(gruppenDiagramme, async () => {
    if (!auswertungMounted.value) return
    await nextTick()
    await gruppenZeichnen(await ladeDiagramme())
}, { deep: true })

// ── Lebenszyklus ─────────────────────────────────────────────────────────
const wurzel = ref(null)
onBeforeMount(async () => {
    await useMountAuswertung()
})
onBeforeUnmount(() => {
    // Instanzen freigeben, solange die Knoten noch hängen (heute blieben sie liegen).
    const d = geladeneDiagramme()
    if (d && wurzel.value) d.disposeCharts([...wurzel.value.querySelectorAll('[id]')])
})

const vorzeichen = (x) => (x >= 0 ? '+' : '')
</script>

<template>
    <div ref="wurzel" class="aw">
        <SeiteLaedt />
        <div v-show="!seiteLaedt">
            <NoData v-if="auswertungMounted && !mitTrades" />

            <div v-else-if="auswertungMounted" class="aw-seite">
                <div class="aw-leiste">
                    <KartenMenue :karten="kartenListe" :weitere="gruppenListe" :verborgen="verborgen" :text="t('auswertung.cards')"
                        @umschalten="umschalten" />
                </div>

                <div class="aw-raster">
                    <!-- Tachos -->
                    <div v-if="zeige('longShort')" class="drittel">
                        <TitelKarte :titel="t('auswertung.longShortRatio')" info="auswertung.tooltipLongShort">
                            <div id="gaugeChart1" class="aw-tacho"></div>
                            <div class="aw-zusatz zwei">
                                <div><span class="at-gedaempft">Long ({{ tacho.long.quote }}% Win)</span><b class="at-gut">{{ tacho.long.anzahl }}</b></div>
                                <div><span class="at-gedaempft">Short ({{ tacho.short.quote }}% Win)</span><b class="at-schlecht">{{ tacho.short.anzahl }}</b></div>
                            </div>
                        </TitelKarte>
                    </div>
                    <div v-if="zeige('satisfaction')" class="drittel">
                        <TitelKarte :titel="t('auswertung.satisfactionRate')" info="auswertung.tooltipSatisfaction">
                            <div id="gaugeChart2" class="aw-tacho"></div>
                            <div class="aw-zusatz">{{ tacho.bewertungen }} {{ t('auswertung.ratings') }}</div>
                        </TitelKarte>
                    </div>
                    <div v-if="zeige('completeness')" class="drittel">
                        <TitelKarte :titel="t('auswertung.journalCompleteness')" info="auswertung.tooltipCompleteness">
                            <div id="gaugeChart3" class="aw-tacho"></div>
                            <div class="aw-zusatz">{{ tacho.anzahl }} {{ t('common.trades') }}</div>
                        </TitelKarte>
                    </div>

                    <!-- Tag-Gruppen -->
                    <template v-for="(g, i) in gruppen" :key="'tg-' + i">
                        <div v-if="zeige('tag_' + g.name)" :class="gruppen.length === 1 ? 'voll' : 'halb'">
                            <TitelKarte :titel="g.name" :punkt="g.farbe || 'var(--muted)'"
                                :info-text="t('auswertung.tooltipTagGroup', { name: g.name })">
                                <div :id="'hbarTagGroup' + i" class="diagrammFlaeche aw-diagramm"
                                    :style="{ height: Math.max(160, g.zeilen.length * 34 + 40) + 'px' }"></div>
                                <div class="at-tabelle-huelle">
                                    <table class="at-tabelle dicht">
                                        <thead>
                                            <tr>
                                                <th>{{ t('auswertung.tag') }}</th>
                                                <th class="at-mittig">{{ t('common.trades') }}</th>
                                                <th class="at-mittig">{{ t('auswertung.winPercent') }}</th>
                                                <th class="zahl">PnL</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <tr v-for="z in g.zeilen" :key="z.id">
                                                <td>{{ z.name }}</td>
                                                <td class="at-mittig">{{ z.anzahl }}</td>
                                                <td class="at-mittig" :class="z.quote >= 50 ? 'at-gut' : 'at-schlecht'">{{ z.quote }}%</td>
                                                <td class="zahl" :class="z.pnl >= 0 ? 'at-gut' : 'at-schlecht'">{{ vorzeichen(z.pnl) }}{{ z.pnl.toFixed(2) }}</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            </TitelKarte>
                        </div>
                    </template>

                    <!-- Weitere Karten -->
                    <div v-if="zeige('timeframe')" class="halb">
                        <TitelKarte :titel="t('auswertung.timeframeUsage')" info="auswertung.tooltipTimeframe">
                            <div v-if="rahmen.length" id="hbarChart2" class="diagrammFlaeche aw-diagramm"></div>
                            <p v-else class="aw-leer">{{ t('auswertung.noTimeframeData') }}</p>
                        </TitelKarte>
                    </div>
                    <div v-if="zeige('stressTime')" class="halb">
                        <TitelKarte :titel="t('auswertung.stressProgress')" info="auswertung.tooltipStressProgress">
                            <template v-if="stress.liste.length">
                                <div id="stressLineChart" class="diagrammFlaeche aw-diagramm"></div>
                                <div class="aw-schnitt">{{ t('auswertung.avgStress') }} <b class="at-warn">{{ stress.schnitt.toFixed(1) }}</b></div>
                            </template>
                            <p v-else class="aw-leer">{{ t('auswertung.noStressData') }}</p>
                        </TitelKarte>
                    </div>
                    <div v-if="zeige('stressPerf')" class="halb">
                        <TitelKarte :titel="t('auswertung.stressVsWinRate')" info="auswertung.tooltipStressVsWin">
                            <div v-if="stressQuote.length" id="hbarChart3" class="diagrammFlaeche aw-diagramm"></div>
                            <p v-else class="aw-leer">{{ t('auswertung.noStressData') }}</p>
                        </TitelKarte>
                    </div>
                    <div v-if="zeige('emotionTime')" class="halb">
                        <TitelKarte :titel="t('auswertung.emotionProgress')" info="auswertung.tooltipEmotionProgress">
                            <template v-if="emotion.liste.length">
                                <div id="emotionLineChart" class="diagrammFlaeche aw-diagramm"></div>
                                <div class="aw-schnitt">{{ t('auswertung.avgEmotion') }} <b class="at-gut">{{ emotion.schnitt.toFixed(1) }}</b></div>
                            </template>
                            <p v-else class="aw-leer">{{ t('auswertung.noEmotionData') }}</p>
                        </TitelKarte>
                    </div>
                    <div v-if="zeige('emotionPerf') && emotionQuote.length" class="halb">
                        <TitelKarte :titel="t('auswertung.emotionVsWinRate')" info="auswertung.tooltipEmotionVsWin">
                            <div id="hbarChart4" class="diagrammFlaeche aw-diagramm"></div>
                        </TitelKarte>
                    </div>
                    <div v-if="zeige('radar')" class="halb">
                        <TitelKarte :titel="t('auswertung.completenessRadar')" info="auswertung.tooltipCompletenessRadar">
                            <div id="radarChart1" class="diagrammFlaeche aw-diagramm"></div>
                        </TitelKarte>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.aw-seite {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}

.aw-leiste {
    display: flex;
    justify-content: flex-end;
}

.aw-raster {
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    gap: 0.75rem;
}

.aw-raster > * {
    grid-column: span 12;
    min-width: 0;
}

@media (min-width: 768px) {
    .aw-raster > .drittel { grid-column: span 4; }
}

@media (min-width: 992px) {
    .aw-raster > .halb { grid-column: span 6; }
}

/* Tachos haben ihre eigene Höhe: ein Halbkreis braucht weniger als ein Diagramm. */
.aw-tacho {
    width: 100%;
    height: 170px;
}

.aw-diagramm {
    width: 100%;
    height: 260px;
}

.aw-zusatz {
    margin-top: 0.3rem;
    text-align: center;
    font-size: 0.82rem;
    color: var(--muted);
}

.aw-zusatz.zwei {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.5rem;
}

.aw-zusatz.zwei > div {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.1rem;
}

.aw-schnitt {
    margin-top: 0.3rem;
    text-align: center;
    font-size: 0.85rem;
    color: var(--muted);
}

.aw-leer {
    margin: 0;
    padding: 2rem 0.5rem;
    text-align: center;
    color: var(--muted);
    font-size: 0.86rem;
}
</style>
