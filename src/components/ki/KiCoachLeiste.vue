<script setup>
/**
 * KI-Coach als Seitenleiste — auf jeder Seite, über der Seite.
 *
 * Hängt einmal im Rahmen (`layouts/Rahmen.vue`) und überlebt damit jede
 * Navigation innerhalb der App. Mit jeder Frage geht mit, auf welcher Seite
 * sie offen ist und was dort gewählt ist (`leseSeitenStand`); der Server
 * prüft das und gibt es dem Modell als „was der Nutzer gerade sieht".
 *
 * Breit (ab 1200 px) rückt der Rahmen den Inhalt zur Seite, damit die Leiste
 * nichts verdeckt; darunter liegt sie über der Seite, am Telefon
 * bildschirmbreit.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import { Symbol, Pille, Hinweis } from '@/components/basis'
import KiGespraech from './KiGespraech.vue'
import KiGespraechsListe from './KiGespraechsListe.vue'
import { useKiGespraech } from '@/composables/useKiGespraech.js'
import { seitenId } from '@/stores/ui.js'
import {
    kiCoachOffen, kiCoachBreite, kiCoachSitzung, kiCoachFrage, schliesseKiCoach, setzeKiCoachBreite, setzeKiCoachSitzung,
    leseSeitenStand, merkeKiLauf, kiLaufUnterbrochen, KI_BREITE_MIN, KI_BREITE_MAX,
} from '@/stores/app/kiCoach.js'
import { leseSeitenText } from '@/utils/seitenText.js'
import { ebeneAuf, ebeneZu } from '@/composables/useZurueckGeste.js'

const { t, te } = useI18n()
const route = useRoute()

const listeEl = ref(null)
const leisteEl = ref(null)
const zeigeVerlauf = ref(false)
const unterbrochen = ref(false)
const status = ref({ provider: '', model: '', bereit: true })

function kontext() {
    const { stand, chart } = leseSeitenStand()
    // Der sichtbare Inhalt der Seite geht immer mit — so kennt der Coach auch Seiten ohne
    // eigenes Werkzeug. Einstellungen und Einrichtung ohne Eingabefelder (Schlüssel).
    const mitFeldern = !/einstellung|setup|update/i.test(`${route.path} ${String(route.name || '')}`)
    let text = ''
    try { text = leseSeitenText({ mitFeldern }) } catch { text = '' }
    return { seite: { id: seitenId.value || route.name || '', stand, text }, ...(chart ? { chart } : {}) }
}

const gespraech = useKiGespraech({
    kontext, t,
    beiSitzung: (id) => setzeKiCoachSitzung(id),
    beiFertig: () => listeEl.value?.lade(),
})
const { laeuft } = gespraech

const seitenTitel = computed(() => {
    const k = route.meta?.titleKey
    return k && te(k) ? t(k) : (route.meta?.title || '')
})
// Modellname ohne Datums-Anhang: „claude-sonnet-4-5-20250929" → „claude-sonnet-4-5"
const modell = computed(() => String(status.value.model || status.value.provider || '').replace(/[-:]\d{8,}$/, ''))
const vorschlaege = computed(() => [t('kiCoach.vorschlagSeite'), t('kiCoach.vorschlagAuffaellig')])
// Direkt gemessen statt aus `bildschirmTyp`: der ist beim Einhängen noch nicht gesetzt.
const schmal = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 991.98px)').matches

async function ladeStatus() {
    try { status.value = (await axios.get('/api/ai/agent/status')).data } catch { status.value = { provider: '', model: '', bereit: false } }
}

let gestartet = false
/** Beim ersten Öffnen: Status holen und das gemerkte Gespräch wieder laden. */
async function starte() {
    if (gestartet) return
    gestartet = true
    unterbrochen.value = kiLaufUnterbrochen()
    merkeKiLauf(false)
    ladeStatus()
    if (kiCoachSitzung.value) await gespraech.lade(kiCoachSitzung.value)
}

/** Eine von aussen mitgegebene Frage (Tagesansicht, Strategie-Instanz) senden. */
async function sendeWartendeFrage() {
    const f = kiCoachFrage.value
    if (!f || !kiCoachOffen.value) return
    kiCoachFrage.value = null
    await starte()
    zeigeVerlauf.value = false
    if (f.neu) gespraech.neu()
    await nextTick()
    gespraech.sende(f.text)
}

// Am Telefon nicht schon beim Laden über der Seite liegen, nur weil sie zuletzt offen war.
if (schmal() && kiCoachOffen.value && !kiCoachFrage.value) schliesseKiCoach()

watch(kiCoachOffen, async (offen) => {
    if (offen) {
        await starte()
        ladeStatus()
        if (schmal()) ebeneAuf(schliesseKiCoach)
        sendeWartendeFrage()
    } else {
        ebeneZu(schliesseKiCoach)
    }
    // Diagramme messen ihren Platz nur bei einem Fenster-Ereignis neu.
    await nextTick()
    window.dispatchEvent(new Event('resize'))
    setTimeout(() => window.dispatchEvent(new Event('resize')), 250)
}, { immediate: true })
watch(kiCoachFrage, sendeWartendeFrage)
// Am Telefon liegt die Leiste über der ganzen Seite: ein Seitenwechsel schliesst sie.
watch(() => route.path, () => { if (schmal() && kiCoachOffen.value) schliesseKiCoach() })
watch(laeuft, (l) => { merkeKiLauf(l); if (l) unterbrochen.value = false })

function neuerChat() {
    gespraech.neu()
    zeigeVerlauf.value = false
    unterbrochen.value = false
}
async function waehle(id) {
    await gespraech.lade(id)
    zeigeVerlauf.value = false
    unterbrochen.value = false
}
function geloescht(id) {
    if (kiCoachSitzung.value === id) gespraech.neu()
}

// ── Breite ziehen ──────────────────────────────────────────────────────────
let ziehStart = null
function ziehAnfang(e) {
    ziehStart = { x: e.clientX, breite: kiCoachBreite.value }
    window.addEventListener('pointermove', ziehen)
    window.addEventListener('pointerup', ziehEnde, { once: true })
    e.preventDefault()
}
function ziehen(e) {
    if (!ziehStart) return
    setzeKiCoachBreite(Math.min(ziehStart.breite + (ziehStart.x - e.clientX), window.innerWidth * 0.6))
}
function ziehEnde() {
    ziehStart = null
    window.removeEventListener('pointermove', ziehen)
    window.dispatchEvent(new Event('resize'))
}
function breiteTaste(e) {
    if (e.key === 'ArrowLeft') setzeKiCoachBreite(kiCoachBreite.value + 20)
    else if (e.key === 'ArrowRight') setzeKiCoachBreite(kiCoachBreite.value - 20)
    else return
    e.preventDefault()
    window.dispatchEvent(new Event('resize'))
}

function taste(e) {
    if (e.key === 'Escape' && kiCoachOffen.value && leisteEl.value?.contains(document.activeElement)) schliesseKiCoach()
}
onMounted(() => document.addEventListener('keydown', taste))
onBeforeUnmount(() => {
    document.removeEventListener('keydown', taste)
    window.removeEventListener('pointermove', ziehen)
    gespraech.abbrechen()
    ebeneZu(schliesseKiCoach)
})
</script>

<template>
    <aside v-if="kiCoachOffen" ref="leisteEl" class="kiCoachLeiste" :style="{ '--ki-breite': kiCoachBreite + 'px' }"
        :aria-label="t('kiCoach.titel')">
        <div class="griff" role="separator" aria-orientation="vertical" tabindex="0" :aria-label="t('kiCoach.breite')"
            :aria-valuemin="KI_BREITE_MIN" :aria-valuemax="KI_BREITE_MAX" :aria-valuenow="kiCoachBreite"
            @pointerdown="ziehAnfang" @keydown="breiteTaste"></div>

        <header class="kopf">
            <div class="titel">
                <Symbol name="ki" />
                <strong>{{ t('kiCoach.titel') }}</strong>
                <Pille v-if="modell" :ton="status.bereit ? 'gut' : 'schlecht'" class="modell">{{ modell }}</Pille>
            </div>
            <div class="knoepfe">
                <button type="button" class="symbolknopf" :title="t('kiCoach.neuerChat')" :aria-label="t('kiCoach.neuerChat')" @click="neuerChat">
                    <Symbol name="plus" :groesse="18" />
                </button>
                <button type="button" class="symbolknopf" :class="{ aktiv: zeigeVerlauf }" :aria-pressed="zeigeVerlauf"
                    :title="zeigeVerlauf ? t('kiCoach.zumGespraech') : t('kiCoach.verlauf')"
                    :aria-label="zeigeVerlauf ? t('kiCoach.zumGespraech') : t('kiCoach.verlauf')" @click="zeigeVerlauf = !zeigeVerlauf">
                    <Symbol name="verlauf" :groesse="18" />
                </button>
                <button type="button" class="symbolknopf" :title="t('kiCoach.schliessen')" :aria-label="t('kiCoach.schliessen')" @click="schliesseKiCoach">
                    <Symbol name="schliessen" :groesse="18" />
                </button>
            </div>
        </header>

        <div v-if="seitenTitel" class="seite">{{ t('kiCoach.seite', { seite: seitenTitel }) }}</div>

        <Hinweis v-if="!status.bereit" art="warn">{{ t('kiCoach.nichtErreichbar') }}</Hinweis>
        <Hinweis v-if="unterbrochen && !zeigeVerlauf" art="info">{{ t('kiCoach.unterbrochen') }}</Hinweis>

        <KiGespraechsListe v-show="zeigeVerlauf" ref="listeEl" class="inhalt" :aktiv="kiCoachSitzung" @waehle="waehle" @geloescht="geloescht" />
        <KiGespraech v-show="!zeigeVerlauf" class="inhalt" :gespraech="gespraech" :bereit="status.bereit" :vorschlaege="vorschlaege" />
    </aside>
</template>

<style scoped>
.kiCoachLeiste {
    position: fixed;
    top: var(--kopf-hoehe);
    right: 0;
    bottom: 0;
    /* Über „Nach oben" (1030), unter der Abdunkelung des Handy-Menüs (1040). */
    z-index: 1035;
    width: min(var(--ki-breite), 100vw);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.7rem 0.8rem 0.8rem 1rem;
    background: var(--panel);
    border-left: 1px solid var(--line);
    box-shadow: var(--schatten);
}

.griff {
    position: absolute;
    top: 0;
    bottom: 0;
    left: -3px;
    width: 8px;
    cursor: col-resize;
    touch-action: none;
}

.griff:hover,
.griff:focus-visible {
    background: var(--accent-flaeche);
    outline: none;
}

.kopf {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    flex-shrink: 0;
}

.titel {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    min-width: 0;
}

.modell {
    min-width: 0;
    max-width: 11rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.knoepfe {
    display: flex;
    gap: 0.15rem;
    flex-shrink: 0;
}

.symbolknopf {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border: none;
    border-radius: var(--radius-klein);
    background: none;
    color: var(--muted);
    cursor: pointer;
}

.symbolknopf:hover,
.symbolknopf.aktiv {
    color: var(--text);
    background: var(--panel-soft);
}

.seite {
    flex-shrink: 0;
    font-size: 0.75rem;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.inhalt {
    flex: 1 1 auto;
    min-height: 0;
}

/* Telefon: über allem ausser Dialogen, bildschirmbreit, ohne Ziehgriff. */
@media (max-width: 991.98px) {
    .kiCoachLeiste {
        top: 0;
        width: 100vw;
        z-index: 1046;
        border-left: none;
    }

    .griff {
        display: none;
    }
}
</style>
