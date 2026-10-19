<script setup>
/**
 * Layout von AutarkTrade — hängt als `meta.layout` an jeder Seite.
 *
 * Kopfleiste oben, darunter Menüspalte und Inhalt mit Titelzeile. Weil alle
 * Routen dieselbe Komponente tragen, wird das Layout bei einer SPA-Navigation
 * NICHT neu aufgebaut; alles, was von der Route abhängt, beobachtet sie
 * deshalb (Seiten-ID, Journal-Start, Modus-Wache).
 *
 * Aufgaben:
 *   - Einstellungen und Sprache laden, Bildschirmart messen (auch bei
 *     Grössenänderung)
 *   - im Journal: Zeiträume, Tags, Pending-Zähler und ihr Polling, Popups,
 *     Wache für einen laufenden KI-Bericht
 *   - Wache für abgeschaltete Modi (siehe unten, warum hier und nicht im Router)
 *   - Cockpit (`?cockpit=1`) und Vollbild: ohne Kopfleiste, Menü und Titelzeile
 *   - Zensur-Modus, Zurück-Geste für das Handy-Menü
 */
import { ref, computed, watch, onBeforeMount, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'

import Kopfleiste from '../components/rahmen/Kopfleiste.vue'
import Seitenmenue from '../components/rahmen/Seitenmenue.vue'
import Titelzeile from '../components/rahmen/Titelzeile.vue'
import ScreenshotVollbild from '../components/rahmen/ScreenshotVollbild.vue'
import NachObenKnopf from '../components/NachObenKnopf.vue'
import TradeEvalPopup from '../components/TradeEvalPopup.vue'
import PageInfo from '../components/PageInfo.vue'
import BetaHinweis from '../components/BetaHinweis.vue'

import { pageId, screenType, seitenmenueMobilOffen, appMode, privacyMode } from '../stores/ui.js'
import { sideMenuEingeklappt } from '../stores/app/rahmen.js'
import { currentUser } from '../stores/settings.js'
import { ladeSystemModus } from '../stores/system.js'
import { hydrateLiveSettings } from '../stores/live.js'
import { istModusAn, ersterAktiverModus, modeHome } from '../config/menu.js'
import { useInitParse, leseZeitzone, leseBildschirmTyp, ladeZeitraeume, setzeFilterwerte, useCloseMobileMenu } from '../utils/journal/app.js'
import { ladeVerfuegbareTags } from '../utils/journal/tagebuch.js'
import { useUpdatePendingCounts, useStartGlobalPolling, useStopGlobalPolling } from '../utils/incoming.js'
import { requestNotificationPermission } from '../utils/notify.js'
import { logWarn } from '../utils/logger.js'
import { ebeneAuf, ebeneZu } from '../composables/useZurueckGeste.js'
import { useKiBerichtWache } from '../composables/useKiBerichtWache.js'
import { useImVollbild } from '../utils/geraet.js'
import { starteZensur } from '../utils/privacy.js'
import { setLocale } from '../i18n'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

/* ── Abgeleitete Zustände ─────────────────────────────── */

/**
 * Journal-Ballast (Perioden, Tags, Pending-Zähler, Popups, KI-Bericht) nur
 * dort, wo er gebraucht wird. Die Einstellungen (`any`) zählen dazu; Chart,
 * Startseite, Live, Entdecken, Agent und Lernen brauchen keine Trade-Daten.
 */
const istJournal = computed(() => {
    const m = route.meta?.mode
    return !m || m === 'journal' || m === 'any'
})
const istAgent = computed(() => route.meta?.mode === 'agent')

/**
 * Cockpit: das Live-Trading-Fenster in einem eigenen Browserfenster. Menü und
 * Titelzeile wären dort nur Wege zurück ins Journal — genau die Ablenkung,
 * gegen die eine Sitzung mit festem Plan gedacht ist. An der URL statt an
 * einer Einstellung, damit das Fenster neu laden kann und Cockpit bleibt.
 */
const istCockpit = computed(() => route.query?.cockpit === '1')
/** Vollbild räumt dieselbe Umgebung weg: wer Vollbild drückt, will die Fläche. */
const imVollbild = useImVollbild()
const ohneRahmen = computed(() => istCockpit.value || imVollbild.value)
const mitMenue = computed(() => !ohneRahmen.value && !route.meta?.ohneSeitenmenue)

const desktop = computed(() => screenType.value === 'computer')
const menueSchmal = computed(() => desktop.value && sideMenuEingeklappt.value)

/* ── Seiten-ID folgt jeder Navigation ─────────────────── */
// Früher nur beim Mount gesetzt: nach router.push blieb die alte Seite stehen.
watch(() => route.name, (name) => { pageId.value = name }, { immediate: true })

/* ── Initialisierung ──────────────────────────────────── */

let journalGestartet = false
/** Einmal je Seitenleben, sobald eine Journal-Route erreicht ist. */
async function starteJournal() {
    if (journalGestartet) return
    journalGestartet = true
    await ladeZeitraeume()
    await setzeFilterwerte()
    await ladeVerfuegbareTags()   // für das Bewertungs-Popup
    const u = currentUser.value
    // Nur eine ausdrückliche 0 schaltet ab; fehlt der Wert, gilt er als an.
    const aus = (v) => v === 0 || v === '0'
    if (!aus(u?.browserNotifications)) requestNotificationPermission()
    // Erst nach dem Laden der Einstellungen, damit die Popup-Einstellung greift.
    if (!aus(u?.showTradePopups)) {
        await useUpdatePendingCounts()
        useStartGlobalPolling()
    }
}

const grundBereit = ref(false)

onBeforeMount(async () => {
    ladeSystemModus()                       // Testbetrieb-Flag, ohne zu warten
    await useInitParse()                    // Einstellungen → currentUser
    // Nur Deutsch liegt im Start-Bundle; andere Sprachen werden nachgeladen.
    await setLocale(currentUser.value?.language || 'de')
    leseZeitzone()
    leseBildschirmTyp()
    hydrateLiveSettings()                   // auch im Journal: die Einstellungsseite zeigt die Live-Werte
    grundBereit.value = true
    if (istJournal.value) await starteJournal()
})

// Wer per SPA-Navigation aus einem anderen Modus ins Journal kommt (z. B. vom
// Chart in die Einstellungen), bekommt die Journal-Daten nachgereicht.
watch(istJournal, (jetzt) => {
    if (jetzt && grundBereit.value) starteJournal().catch((e) => logWarn('layout', 'Journal-Start fehlgeschlagen', e?.message || e))
})

/* ── Bildschirmart folgt der Fenstergrösse ────────────── */
let groesseTakt = null
function beiGroesse() {
    clearTimeout(groesseTakt)
    groesseTakt = setTimeout(() => {
        const vorher = screenType.value
        leseBildschirmTyp()
        // Vom Telefon auf den Desktop: ein ausgefahrenes Handy-Menü schliessen.
        if (vorher === 'mobile' && screenType.value === 'computer') useCloseMobileMenu()
    }, 120)
}

/* ── Wache für abgeschaltete Modi ─────────────────────── */
/*
 * Hier und nicht im Router: beim kalten Deep-Link sind die Einstellungen noch
 * nicht da, ein Router-Hook müsste raten — und jeder Aufruf von /marktradar
 * landete bei langsamem Abruf im Journal. Das Layout kann warten. Beobachtet
 * werden beide Quellen: die Einstellungen kommen verspätet (Deep-Link), eine
 * Navigation in der App (Zurück, altes Lesezeichen) kommt, wenn sie längst da
 * sind. Das Seiten-Flag `livetradingAn` prüft Livetrading.vue selbst.
 */
watch([currentUser, () => route.fullPath], () => {
    const u = currentUser.value
    if (!u) return                                   // Unwissen ist kein Nein
    const m = route.meta?.mode
    if (!m || m === 'any' || m === 'journal') return
    if (istModusAn(m, u)) return
    router.replace(modeHome(ersterAktiverModus(u)))
}, { immediate: true })

/* ── Zensur (nur Journal) ─────────────────────────────── */
const hauptEl = ref(null)
let zensurStopp = null
function bewerteZensur() {
    const an = privacyMode.value && appMode.value === 'journal' && !!hauptEl.value
    if (an && !zensurStopp) zensurStopp = starteZensur(hauptEl.value)
    else if (!an && zensurStopp) { zensurStopp(); zensurStopp = null }
}
watch([privacyMode, appMode], () => nextTick(bewerteZensur))

/* ── Zeiträume auffrischen, wenn man zurückkommt ──────── */
// Ein Monatswechsel, während der Tab verborgen war, wird so erkannt.
async function frischeZeitraeume() {
    if (!istJournal.value || !journalGestartet) return
    try {
        await ladeZeitraeume()
        await setzeFilterwerte()
    } catch (e) {
        logWarn('layout', 'Zeiträume nicht aufgefrischt', e?.message || e)
    }
}
function beiSichtbarkeit() {
    if (document.visibilityState === 'visible') frischeZeitraeume()
}

/* ── Zurück-Geste schliesst das Handy-Menü ────────────── */
// Dieselbe Funktionsreferenz an beide Aufrufe: der Ebenen-Stapel vergleicht Referenzen.
watch(seitenmenueMobilOffen, (offen) => {
    if (offen) ebeneAuf(useCloseMobileMenu)
    else ebeneZu(useCloseMobileMenu)
})

/* ── KI-Bericht ───────────────────────────────────────── */
useKiBerichtWache(istJournal, t)

/* ── Auf- und Abbau ───────────────────────────────────── */
onMounted(() => {
    bewerteZensur()
    window.addEventListener('resize', beiGroesse)
    window.addEventListener('orientationchange', beiGroesse)
    document.addEventListener('visibilitychange', beiSichtbarkeit)
    window.addEventListener('focus', frischeZeitraeume)
})

onBeforeUnmount(() => {
    useStopGlobalPolling()
    if (zensurStopp) { zensurStopp(); zensurStopp = null }
    clearTimeout(groesseTakt)
    window.removeEventListener('resize', beiGroesse)
    window.removeEventListener('orientationchange', beiGroesse)
    document.removeEventListener('visibilitychange', beiSichtbarkeit)
    window.removeEventListener('focus', frischeZeitraeume)
})
</script>

<template>
    <NachObenKnopf />
    <Kopfleiste v-if="!ohneRahmen" />

    <div class="at-rahmen" :class="{ 'ohne-menue': !mitMenue }" v-cloak>
        <!-- id="sideMenu": utils.js (schalteMobilMenue/useCloseMobileMenu) sucht diese ID. -->
        <aside v-if="mitMenue" id="sideMenu" class="at-menuespalte"
            :class="desktop ? { schmal: menueSchmal } : { mobil: true, offen: seitenmenueMobilOffen }">
            <Seitenmenue />
        </aside>

        <div class="at-inhaltsspalte">
            <div v-if="mitMenue && !desktop && seitenmenueMobilOffen" class="at-abdunkelung" aria-hidden="true"
                @click="useCloseMobileMenu()"></div>

            <Titelzeile v-if="mitMenue" />

            <main ref="hauptEl">
                <!--
                    Der Agent-Modus handelt selbstständig: die Warnung gehört auf
                    jede seiner Seiten, auch bei Direktlink. Die Anleitung hängt am
                    Layout, damit sie erreichbar bleibt, wenn der Hinweis für die
                    Sitzung weggeklickt ist.
                -->
                <div v-if="istAgent" class="at-agent-kopf">
                    <div class="innen">
                        <div class="anleitung">
                            <PageInfo section="info.agent" />
                        </div>
                        <BetaHinweis />
                    </div>
                </div>
                <slot />
            </main>
        </div>
    </div>

    <ScreenshotVollbild />
    <TradeEvalPopup v-if="istJournal" />
</template>

<style scoped>
.at-rahmen {
    display: flex;
    align-items: flex-start;
    width: 100%;
    margin: 0;
}

/* ── Menüspalte Desktop ── */
.at-menuespalte {
    position: sticky;
    top: var(--kopf-hoehe);
    flex: 0 0 16.6667%;
    min-width: 210px;
    max-width: 300px;
    height: calc(100vh - var(--kopf-hoehe));
    height: calc(100dvh - var(--kopf-hoehe));
    overflow-y: auto;
    overscroll-behavior: contain;
    background: var(--panel);
    border-right: 1px solid var(--line);
    transition: flex-basis 0.2s, min-width 0.2s;
}

.at-menuespalte.schmal {
    flex-basis: 64px;
    min-width: 64px;
}

/* ── Menüspalte Telefon: fährt von links über alles ausser Modals ── */
.at-menuespalte.mobil {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 1045;
    width: 260px;
    min-width: 0;
    max-width: 85vw;
    height: 100vh;
    height: 100dvh;
    box-shadow: var(--schatten);
    transform: translateX(-105%);
    /* Unsichtbar erst NACH dem Einfahren, damit der Übergang zu sehen ist —
       und eingefahren nicht per Tab erreichbar. */
    visibility: hidden;
    transition: transform 0.22s ease, visibility 0s linear 0.22s;
}

.at-menuespalte.mobil.offen {
    transform: none;
    visibility: visible;
    transition: transform 0.22s ease, visibility 0s;
}

/* ── Inhalt ── */
.at-inhaltsspalte {
    position: relative;
    flex: 1 1 auto;
    min-width: 0;
    min-height: calc(100vh - var(--kopf-hoehe));
}

.at-abdunkelung {
    position: fixed;
    inset: 0;
    z-index: 1040;
    background: color-mix(in srgb, var(--bg) 70%, transparent);
}

main {
    min-width: 0;
}

.at-agent-kopf {
    padding: var(--abstand-3) var(--abstand-4) 0;
}

.at-agent-kopf .anleitung {
    display: flex;
    justify-content: flex-end;
    margin-bottom: var(--abstand-2);
}

/* Gleiche Breite wie der Inhalt der Agent-Seiten (11/12 ab 1200 px). */
@media (min-width: 1200px) {
    .at-agent-kopf .innen {
        width: 91.6667%;
    }
}

@media (prefers-reduced-motion: reduce) {
    .at-menuespalte,
    .at-menuespalte.mobil {
        transition: none;
    }
}
</style>
