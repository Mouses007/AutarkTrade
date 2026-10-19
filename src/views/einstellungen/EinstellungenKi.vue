<script setup>
/**
 * Bereich „KI" mit zweiter Reiter-Ebene (je KI-Funktion ein Reiter).
 *
 * Lädt beim ersten Öffnen Zugang, Modelllisten und Share-Karten — die teilen
 * sich alle Unter-Reiter (useKiAnbieter, useShareCard). Die Unter-Reiter
 * bleiben per KeepAlive erhalten, wie früher unter v-show: Eingaben und
 * aufgeklappte Abschnitte überleben einen Reiterwechsel. Die Übersicht wird
 * wie bisher bei jedem Öffnen neu aufgebaut (v-if).
 */
import { computed, onBeforeMount } from 'vue'
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
const kiKomponente = computed(() => KI_KOMPONENTEN[kiBereich.value] || null)

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

        <KeepAlive>
            <component :is="kiKomponente" v-if="kiKomponente" />
        </KeepAlive>
    </div>
</template>

<style scoped>
.ki-reiter {
    margin-bottom: var(--abstand-4);
}
</style>
