<script setup>
/**
 * Kopfleiste des Chart-Arbeitsplatzes. Wirkt immer auf das AKTIVE Panel
 * (blau umrandet); Raster, Synchronisation und Layouts gelten für alle.
 */
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import SymbolSuche from './SymbolSuche.vue'
import VorlagenMenue from './VorlagenMenue.vue'
import { INTERVALLE, INTERVALLE_SICHTBAR, QUELLEN_OHNE, boerseFuer, waehlbareBoersen, binanceGewaehlt } from '../../utils/chart/kerzenQuelle.js'
import { OVERLAYS, overlayAn } from '../../utils/chart/overlays/liste.js'
import { Symbol } from '../basis'

const props = defineProps({
    panel: { type: Object, required: true },
    raster: { type: String, default: '1' },
    sync: { type: Object, required: true },
    layouts: { type: Array, default: () => [] },
    layoutId: { type: Number, default: null },
    seitenleisteOffen: { type: Boolean, default: true },
    telefon: { type: Boolean, default: false },
})
const emit = defineEmits(['panel', 'indikatoren', 'raster', 'sync', 'layoutWechsel', 'layoutNeu', 'layoutUmbenennen', 'layoutLoeschen', 'seitenleiste', 'foto', 'vorlage'])
const { t } = useI18n()

const suche = ref(null)
const mehrOffen = ref(false)
const layoutOffen = ref(false)
const syncOffen = ref(false)
const rasterOffen = ref(false)

function schalteOverlay(id, an) {
    emit('panel', { overlays: { ...(props.panel.overlays || {}), [id]: an } })
}

const RASTER = [
    { id: '1', icon: 'quadrat' },
    { id: '2h', icon: 'spalten' },
    { id: '2v', icon: 'zeilen' },
    { id: '4', icon: 'raster' },
]

/*
 * Symbol je Overlay. Die Liste selbst (`overlays/liste.js`) trägt noch die alten
 * Unicons-Klassen; gezeichnet wird hier nach der id, damit sie unangetastet bleibt.
 */
const OVERLAY_SYMBOL = {
    journal: 'buch',
    positionen: 'fadenkreuz',
    strategie: 'ki',
    liquidationen: 'feuer',
    hebelzonen: 'ebenen',
    orderbuch: 'liste',
}
const SKALEN = ['normal', 'log', 'prozent']

/*
 * Favoriten: welche Zeiteinheiten direkt in der Leiste stehen. Gewählt im
 * Menü „…" per Stern; gemerkt im Browser (eine Vorliebe, kein Layout-Inhalt).
 * Mindestens eine bleibt immer stehen, sonst gäbe es nichts mehr zu klicken.
 */
const FAV_SCHLUESSEL = 'chartTfFavoriten'
function leseFavoriten() {
    try {
        const roh = JSON.parse(localStorage.getItem(FAV_SCHLUESSEL) || 'null')
        if (Array.isArray(roh)) {
            const gueltig = roh.filter((i) => INTERVALLE.includes(i))
            if (gueltig.length) return gueltig
        }
    } catch { /* kaputt oder kein Speicher */ }
    return [...INTERVALLE_SICHTBAR]
}
const favoriten = ref(leseFavoriten())
const sichtbareIntervalle = computed(() => INTERVALLE.filter((i) => favoriten.value.includes(i)))
function schalteFavorit(i) {
    const an = favoriten.value.includes(i)
    if (an && favoriten.value.length <= 1) return
    favoriten.value = an ? favoriten.value.filter((x) => x !== i) : [...favoriten.value, i]
    try { localStorage.setItem(FAV_SCHLUESSEL, JSON.stringify(favoriten.value)) } catch { /* kein Speicher */ }
}
const verborgeneIntervalle = computed(() => INTERVALLE.filter((i) => !favoriten.value.includes(i)))
/** Zeiteinheiten, die die gewählte Kursquelle nicht kennt (Bitget: kein 8h). */
const gesperrt = computed(() => new Set(QUELLEN_OHNE[aktiveBoerse.value] || []))
/*
 * Quellenwahl nach der Marktdatenquelle (S12): Binance steht nur zur Wahl,
 * wenn der Kunde Binance gewählt hat. Die Helfer lesen den `marktdaten`-Ref,
 * die Listen ziehen also nach, sobald die Wahl geladen oder geändert ist.
 */
const aktiveBoerse = computed(() => boerseFuer(props.panel))
const boersenListe = computed(() => waehlbareBoersen())
/** Spot gibt es nur bei Binance — dort ist die Wahl gesperrt. */
const quelleGesperrt = computed(() => props.panel.markt === 'spot' && binanceGewaehlt())
const aktuellesLayout = computed(() => props.layouts.find((l) => l.id === props.layoutId))

function intervall(i) {
    emit('panel', { interval: i })
    mehrOffen.value = false
}

function neuesLayout() {
    const n = window.prompt(t('chart.layoutName'), t('chart.layoutNeuVorgabe'))
    if (n) emit('layoutNeu', n)
    layoutOffen.value = false
}

function umbenennen() {
    const n = window.prompt(t('chart.layoutName'), aktuellesLayout.value?.name || '')
    if (n) emit('layoutUmbenennen', n)
    layoutOffen.value = false
}

function loeschen() {
    if (props.layouts.length <= 1) return
    if (window.confirm(t('chart.layoutLoeschenFrage', { name: aktuellesLayout.value?.name || '' }))) emit('layoutLoeschen')
    layoutOffen.value = false
}

defineExpose({ oeffneSuche: () => suche.value?.oeffne() })
</script>

<template>
    <div class="kopfleiste">
        <SymbolSuche ref="suche" :symbol="panel.symbol" :markt="panel.markt" @waehle="emit('panel', $event)" />
        <select class="quelle" :value="aktiveBoerse" :disabled="quelleGesperrt"
            :title="t('chart.quelle.titel')" @change="emit('panel', { boerse: $event.target.value, ...(panel.markt === 'spot' ? { markt: 'futures' } : {}) })">
            <option v-for="b in boersenListe" :key="b" :value="b">{{ t('chart.quelle.' + b) }}</option>
        </select>

        <div class="gruppe">
            <button v-for="i in sichtbareIntervalle" :key="i" class="tf" :class="{ an: panel.interval === i }"
                :disabled="gesperrt.has(i)" :title="gesperrt.has(i) ? t('chart.quelle.tfFehlt') : ''"
                @click="intervall(i)" :aria-label="gesperrt.has(i) ? t('chart.quelle.tfFehlt') : ''">{{ i }}</button>
            <div class="aufklapp">
                <button class="tf" :class="{ an: verborgeneIntervalle.includes(panel.interval) }" :title="t('chart.tfFavoritenTitel')"
                    @click="mehrOffen = !mehrOffen" :aria-label="t('chart.tfFavoritenTitel')">
                    {{ verborgeneIntervalle.includes(panel.interval) ? panel.interval : '…' }}
                </button>
                <div v-if="mehrOffen" class="menue tfMenue">
                    <div class="tfKopf">{{ t('chart.tfFavoriten') }}</div>
                    <div v-for="i in INTERVALLE" :key="i" class="tfZeile">
                        <button class="tf" :class="{ an: panel.interval === i }" :disabled="gesperrt.has(i)"
                            :title="gesperrt.has(i) ? t('chart.quelle.tfFehlt') : ''" @click="intervall(i)" :aria-label="gesperrt.has(i) ? t('chart.quelle.tfFehlt') : ''">{{ i }}</button>
                        <button class="stern" :class="{ an: favoriten.includes(i) }"
                            :disabled="favoriten.includes(i) && favoriten.length <= 1"
                            :title="t(favoriten.includes(i) ? 'chart.tfFavoritWeg' : 'chart.tfFavoritHinzu')"
                            @click.stop="schalteFavorit(i)" :aria-label="t(favoriten.includes(i) ? 'chart.tfFavoritWeg' : 'chart.tfFavoritHinzu')">
                            <Symbol name="stern" :gefuellt="favoriten.includes(i)" />
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <div class="gruppe">
            <button v-for="s in SKALEN" :key="s" class="tf" :class="{ an: (panel.skala || 'normal') === s }"
                :title="t('chart.skala.' + s)" @click="emit('panel', { skala: s })" :aria-label="t('chart.skala.' + s)">{{ t('chart.skalaKurz.' + s) }}</button>
            <button class="tf" :class="{ an: panel.autoSkala !== false }" :title="t(panel.autoSkala !== false ? 'chart.autoAn' : 'chart.autoAus')"
                @click="emit('panel', { autoSkala: panel.autoSkala === false })" :aria-label="t(panel.autoSkala !== false ? 'chart.autoAn' : 'chart.autoAus')">{{ t('chart.autoKurz') }}</button>
        </div>

        <div class="gruppe">
            <button class="tf" :title="t('chart.indikatorenTitel')" @click="emit('indikatoren')" :aria-label="t('chart.indikatorenTitel')">
                <Symbol name="wachstum" /> {{ t('chart.indikatoren') }}
            </button>
            <VorlagenMenue :aktuelle="panel.indikatoren || []" @anwenden="emit('vorlage', $event)" />
        </div>

        <!-- Eigene Daten als Schnellschalter: ein Klick statt Menü öffnen, Häkchen setzen, zuklicken. -->
        <div class="gruppe schnell" :title="t('chart.overlaysTitel')">
            <button v-for="o in OVERLAYS" :key="o.id" class="tf" :class="{ an: overlayAn(panel, o.id) }"
                :title="t('chart.overlay.' + o.id) + ' — ' + t(overlayAn(panel, o.id) ? 'chart.ausblenden' : 'chart.einblenden')"
                @click="schalteOverlay(o.id, !overlayAn(panel, o.id))" :aria-label="t('chart.overlay.' + o.id) + ' — ' + t(overlayAn(panel, o.id) ? 'chart.ausblenden' : 'chart.einblenden')"><Symbol :name="OVERLAY_SYMBOL[o.id] || 'ebenen'" /></button>
        </div>

        <slot />

        <div class="rechts">
            <div v-if="!telefon" class="gruppe">
                <!-- Raster im Ausklappmenü: der Knopf zeigt das aktuelle, die Leiste hat Platz für die Schnellschalter. -->
                <div class="aufklapp">
                    <button class="tf" :class="{ an: rasterOffen }" :title="t('chart.rasterTitel')" @click="rasterOffen = !rasterOffen" :aria-label="t('chart.rasterTitel')">
                        <Symbol :name="RASTER.find((r) => r.id === raster)?.icon || RASTER[0].icon" /> <Symbol name="runter" class="pfeil" />
                    </button>
                    <div v-if="rasterOffen" class="menue rechtsbuendig spalte">
                        <button v-for="r in RASTER" :key="r.id" class="eintrag" :class="{ an: raster === r.id }"
                            @click="emit('raster', r.id); rasterOffen = false"><Symbol :name="r.icon" /> {{ t('chart.raster.' + r.id) }}</button>
                    </div>
                </div>
                <div class="aufklapp">
                    <button class="tf" :class="{ an: syncOffen }" :title="t('chart.sync.titel')" @click="syncOffen = !syncOffen" :aria-label="t('chart.sync.titel')">
                        <Symbol name="verknuepfung" />
                    </button>
                    <div v-if="syncOffen" class="menue rechtsbuendig spalte">
                        <label v-for="k in ['kreuz', 'zeit', 'symbol', 'interval']" :key="k" class="schalter">
                            <input type="checkbox" :checked="sync[k]" @change="emit('sync', { [k]: $event.target.checked })" />
                            {{ t('chart.sync.' + k) }}
                        </label>
                    </div>
                </div>
            </div>

            <div class="aufklapp">
                <button class="tf layout" @click="layoutOffen = !layoutOffen" :title="t('chart.layouts')" :aria-label="t('chart.layouts')">
                    <Symbol name="fenster" /> {{ aktuellesLayout?.name || '…' }}
                </button>
                <div v-if="layoutOffen" class="menue rechtsbuendig spalte">
                    <button v-for="l in layouts" :key="l.id" class="eintrag" :class="{ an: l.id === layoutId }"
                        @click="emit('layoutWechsel', l.id); layoutOffen = false">{{ l.name }}</button>
                    <hr />
                    <button class="eintrag" @click="neuesLayout"><Symbol name="plus" /> {{ t('chart.layoutNeu') }}</button>
                    <button class="eintrag" @click="umbenennen"><Symbol name="stift" /> {{ t('chart.layoutUmbenennen') }}</button>
                    <button class="eintrag" :disabled="layouts.length <= 1" @click="loeschen"><Symbol name="muell" />
                        {{ t('chart.layoutLoeschen') }}</button>
                </div>
            </div>

            <button class="tf" :title="t('chart.foto')" @click="emit('foto')" :aria-label="t('chart.foto')"><Symbol name="kamera" /></button>
            <button class="tf" :class="{ an: seitenleisteOffen }" :title="t('chart.seitenleiste')"
                @click="emit('seitenleiste')" :aria-label="t('chart.seitenleiste')"><Symbol name="seitenleiste" /></button>
        </div>
    </div>
</template>

<style scoped>
/* Eine Zeile bis hinunter zu 1500 px mit offenem Seitenmenü: bei 10 px
   Lücke und 7 px Knopfrand fehlten ~46 px, und die rechte Gruppe (Raster,
   Sync, Layouts, Kamera, Leiste) stand allein in einer zweiten Zeile
   (Audit A4-20). Schmaler bricht die Leiste weiter um. */
.kopfleiste {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 8px;
    padding: 6px 4px;
}

.quelle {
    background: transparent;
    border: 1px solid var(--line);
    border-radius: var(--radius-klein);
    color: var(--muted);
    font-size: 12px;
    padding: 3px 6px;
}

.quelle option {
    background: var(--panel);
}

.gruppe {
    display: flex;
    align-items: center;
    gap: 2px;
    padding-left: 8px;
    border-left: 1px solid var(--line);
}

.rechts {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 6px;
}

.tf {
    background: transparent;
    border: none;
    color: var(--muted);
    font-size: 12px;
    padding: 3px 5px;
    border-radius: var(--radius-klein);
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
}

.tf:hover {
    color: var(--text);
    background: var(--panel-soft);
}

.tf:disabled {
    opacity: 0.3;
}

.tf.an {
    color: var(--accent);
    background: var(--accent-flaeche);
}

.aufklapp {
    position: relative;
}

.menue {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 30;
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    width: 170px;
    background: var(--panel);
    border: 1px solid var(--line-stark);
    border-radius: var(--radius-klein);
    padding: 6px;
    box-shadow: var(--schatten);
}

.menue.tfMenue {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 2px 6px;
    width: 246px;
}

.tfKopf {
    grid-column: 1 / -1;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    padding: 0 2px 4px;
}

.tfZeile {
    display: flex;
    align-items: center;
}

.tfZeile .tf {
    flex: 1;
    text-align: left;
}

.stern {
    background: transparent;
    border: none;
    padding: 0 4px;
    color: var(--leise);
    font-size: 13px;
    display: inline-flex;
    cursor: pointer;
}

.stern:hover:not(:disabled) {
    color: var(--warn);
}

.stern.an {
    color: var(--warn);
}

.stern:disabled {
    cursor: default;
}

.pfeil {
    font-size: 10px;
    opacity: 0.6;
    margin-left: -2px;
}

.menue.rechtsbuendig {
    left: auto;
    right: 0;
}

.menue.spalte {
    flex-direction: column;
    flex-wrap: nowrap;
    width: 210px;
}

.menue hr {
    margin: 4px 0;
    border: none;
    border-top: 1px solid var(--line-stark);
    opacity: 1;
}

.eintrag {
    background: transparent;
    border: none;
    color: var(--text);
    text-align: left;
    font-size: 12px;
    padding: 5px 8px;
    border-radius: var(--radius-klein);
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
}

.eintrag:hover:not(:disabled) {
    background: var(--panel-soft);
}

.eintrag.an {
    color: var(--accent);
}

.eintrag:disabled {
    opacity: 0.4;
}

.schalter {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 12px;
    color: var(--text);
    padding: 4px 6px;
    cursor: pointer;
}
</style>
