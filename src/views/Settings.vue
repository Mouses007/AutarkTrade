<script setup>
/**
 * Einstellungen — schmale Hülle.
 *
 * Bereichs-Reiter oben, darunter genau eine Bereichskomponente aus
 * `views/einstellungen/`. Die Sektionen darin (je aufklappbarer Block eine
 * Datei) laden selbst, was nur sie brauchen; was mehrere Sektionen teilen,
 * liegt als Modul-Singleton unter `einstellungen/gemeinsam/`.
 *
 * Bereichswahl: Der Ref `bereich` ist die Wahrheit. Er startet aus
 * `route.params.bereich` (Route `/settings/:bereich?`), sonst aus dem
 * localStorage, sonst „allgemein"; ein unbekannter Bereich in der Adresse
 * ergibt „allgemein". Ein Wechsel schiebt die Route nach — aber nur, wenn die
 * Route den Parameter überhaupt kennt; solange der Router noch `/settings`
 * ohne Parameter führt, bleibt es beim Ref und dem localStorage.
 *
 * Früher waren alle Bereiche gleichzeitig gemountet (v-show). Jetzt mountet
 * ein Bereich erst beim Öffnen und bleibt dann per KeepAlive erhalten, damit
 * Eingaben und aufgeklappte Abschnitte einen Reiterwechsel überleben wie
 * vorher. Geteilter Zustand, den Sektionen MEHRERER Bereiche lesen (Modi,
 * Marktradar-/Lagebericht-Felder, Benachrichtigungen und Mail-Zugang), wird
 * deshalb hier geladen — bevor irgendein Bereich gemountet ist.
 */
import { onBeforeMount, onMounted, ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { useInitTooltip } from '../utils/utils'
import { currentUser } from '../stores/settings.js'
import { dbGetSettings } from '../utils/db.js'
import { ladeModi } from './einstellungen/gemeinsam/useModi.js'
import { useRadarEinstellungen } from './einstellungen/gemeinsam/useRadarEinstellungen.js'
import { ladeBrowserNotifications, ladeBenachrichtigungen } from './einstellungen/gemeinsam/useBenachrichtigungen.js'
import EinstellungenAllgemein from './einstellungen/EinstellungenAllgemein.vue'
import EinstellungenJournal from './einstellungen/EinstellungenJournal.vue'
import EinstellungenLive from './einstellungen/EinstellungenLive.vue'
import EinstellungenKi from './einstellungen/EinstellungenKi.vue'
import EinstellungenBenachrichtigungen from './einstellungen/EinstellungenBenachrichtigungen.vue'
import EinstellungenLizenz from './einstellungen/EinstellungenLizenz.vue'
import EinstellungenRechtliches from './einstellungen/EinstellungenRechtliches.vue'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { loadRadarSettings } = useRadarEinstellungen()

/**
 * Die Einstellungen sind über 1500 Zeilen lang. Ohne Gliederung findet man
 * nichts wieder — deshalb Bereiche statt einer Endlosliste. Die Wahl bleibt
 * im localStorage, damit man nach dem Speichern nicht wieder oben landet.
 */
const BEREICHE = [
    { id: 'allgemein', icon: 'uil uil-setting', komponente: EinstellungenAllgemein },
    { id: 'journal', icon: 'uil uil-book-alt', komponente: EinstellungenJournal },
    { id: 'live', icon: 'uil uil-chart-line', komponente: EinstellungenLive },
    { id: 'ki', icon: 'uil uil-brain', komponente: EinstellungenKi },
    { id: 'benachrichtigungen', icon: 'uil uil-bell', komponente: EinstellungenBenachrichtigungen },
    // Einhängepunkte für S10 (Lizenz & Vertrieb)
    { id: 'lizenz', icon: 'uil uil-key-skeleton-alt', komponente: EinstellungenLizenz },
    { id: 'rechtliches', icon: 'uil uil-file-contract', komponente: EinstellungenRechtliches },
]
const gueltig = (id) => (BEREICHE.some(b => b.id === id) ? id : null)

function gemerkterBereich() {
    try { return localStorage.getItem('settingsBereich') } catch (_) { return null }
}
function merke(id) {
    try { localStorage.setItem('settingsBereich', id) } catch (_) { /* privater Modus */ }
}

/** Bereich aus der Adresse; leer = keiner angegeben, unbekannt = „allgemein". */
function ausRoute() {
    if (route.name !== 'settings') return null
    const p = route.params?.bereich
    if (!p) return null
    return gueltig(String(p)) || 'allgemein'
}

const bereich = ref(ausRoute() || gueltig(gemerkterBereich()) || 'allgemein')
const aktiv = computed(() => BEREICHE.find(b => b.id === bereich.value)?.komponente || EinstellungenAllgemein)

// Zurück/Vor im Browser oder ein Link auf /settings/<bereich>
watch(() => route.params?.bereich, () => {
    const b = ausRoute()
    if (b && b !== bereich.value) {
        bereich.value = b
        merke(b)
    }
})

/** Kennt die Route den Parameter? Sonst verwürfe der Router ihn mit Warnung. */
function routeHatBereich() {
    try {
        return (router.getRoutes().find(r => r.name === 'settings')?.path || '').includes(':bereich')
    } catch (_) {
        return false
    }
}

function bereichWechseln(id) {
    bereich.value = id
    merke(id)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    if (!routeHatBereich() || route.params?.bereich === id) return
    try {
        // Abfrageparameter (etwa ?section=api) bleiben erhalten
        Promise.resolve(router.push({ name: 'settings', params: { bereich: id }, query: route.query }))
            .catch(() => { /* Ref und localStorage stimmen schon */ })
    } catch (_) { /* dito */ }
}

/*
 * Gemeinsamen Stand laden, bevor ein Bereich gemountet wird: Die Sektionen
 * lesen `currentUser` beim Aufbau synchron. Settings direkt von der API laden
 * (nicht auf currentUser verlassen, da das Layout's useInitParse() evtl. noch
 * nicht fertig ist).
 */
const geladen = ref(false)
onBeforeMount(async () => {
    try {
        currentUser.value = await dbGetSettings()
    } catch (error) {
        console.log(' -> Error loading settings:', error)
    }
    ladeModi()
    ladeBrowserNotifications()
    loadRadarSettings()
    geladen.value = true
    await ladeBenachrichtigungen()
})

onMounted(async () => {
    await useInitTooltip()
})
</script>

<template>
    <div class="row mt-2">
        <div class="row">
            <div class="col-12 col-md-10" style="padding-left: 2rem;">

                <!-- Bereiche: die Seite ist zu lang, um sie am Stück zu lesen -->
                <ul class="nav nav-tabs settings-nav mb-3">
                    <li v-for="b in BEREICHE" :key="b.id" class="nav-item">
                        <a class="nav-link" :class="{ active: bereich === b.id }"
                            href="#" @click.prevent="bereichWechseln(b.id)">
                            <i :class="b.icon" class="me-1"></i>{{ t('settings.area_' + b.id) }}
                        </a>
                    </li>
                </ul>

                <KeepAlive>
                    <component :is="aktiv" v-if="geladen" :key="bereich" />
                </KeepAlive>

            </div>
        </div>

    </div>
</template>
