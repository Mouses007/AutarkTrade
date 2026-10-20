<script setup>
/**
 * Bereich „KI" mit zweiter Reiter-Ebene (je KI-Funktion ein Reiter).
 *
 * Lädt beim ersten Öffnen Zugang, Modelllisten und Share-Karten — die teilen
 * sich alle Unter-Reiter (useKiAnbieter, useShareCard). Ein Unter-Reiter
 * wird beim ersten Öffnen aufgebaut und danach nur noch per v-show
 * versteckt: Eingaben und aufgeklappte Abschnitte überleben einen
 * Reiterwechsel. Die Übersicht wird wie bisher bei jedem Öffnen neu
 * aufgebaut (v-if).
 *
 * Kein inneres KeepAlive: Diese Seite liegt selbst im KeepAlive von
 * Einstellungen.vue, und das verschachtelte KeepAlive warf ab dem zweiten
 * Wechsel „ctx.deactivate is not a function" — der Inhalt blieb auf dem
 * alten Reiter stehen (Audit A4-01).
 */
import { computed, onBeforeMount, reactive, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Reiter from '@/components/basis/Reiter.vue'
import KiUebersicht from '@/components/ki/KiUebersicht.vue'
import { KI_BEREICHE, kiBereich, kiBereichWechseln } from './gemeinsam/useKiBereich.js'
import { useKiAnbieter } from './gemeinsam/useKiAnbieter.js'
import { useShareCard } from './gemeinsam/useShareCard.js'
import KiZugang from './ki/KiZugang.vue'
import KiBerichte from './ki/KiBerichte.vue'
import KiNachrichten from './ki/KiNachrichten.vue'
import KiAgent from './ki/KiAgent.vue'
import KiStrategie from './ki/KiStrategie.vue'
import KiBilder from './ki/KiBilder.vue'

const { t } = useI18n()
const { ladeKiGrundlagen } = useKiAnbieter()
const { loadFluxSettings } = useShareCard()

const KI_KOMPONENTEN = {
    allgemein: KiZugang,
    berichte: KiBerichte,
    nachrichten: KiNachrichten,
    agent: KiAgent,
    strategie: KiStrategie,
    bilder: KiBilder,
}
const kiReiter = computed(() => KI_BEREICHE.map(b => ({
    id: b.id, titel: t('settings.ki.tab_' + b.id), symbol: b.symbol,
})))
/** Unter-Reiter, die schon einmal offen waren (bleiben aufgebaut). */
const besucht = reactive(new Set())
watch(kiBereich, (b) => { if (KI_KOMPONENTEN[b]) besucht.add(b) }, { immediate: true })

onBeforeMount(async () => {
    await ladeKiGrundlagen()
    await loadFluxSettings()
})
</script>

<template>
    <div>

        <!-- Zweite Reiter-Ebene: je KI-Funktion ein Bereich. Vorher lag
             das über drei obere Reiter verstreut. -->
        <Reiter class="ki-reiter" :model-value="kiBereich" :reiter="kiReiter"
            @update:model-value="kiBereichWechseln" />

        <!--=============== ÜBERSICHT ===============-->
        <div v-show="kiBereich === 'uebersicht'">
            <KiUebersicht v-if="kiBereich === 'uebersicht'" @gehe-zu="kiBereichWechseln" />
        </div>

        <template v-for="(komponente, id) in KI_KOMPONENTEN" :key="id">
            <component :is="komponente" v-if="besucht.has(id)" v-show="kiBereich === id" />
        </template>
    </div>
</template>

<style scoped>
.ki-reiter {
    margin-bottom: var(--abstand-4);
}
</style>
