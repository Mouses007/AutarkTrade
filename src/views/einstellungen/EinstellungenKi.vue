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
        <ul class="nav nav-tabs settings-nav mb-3">
            <li v-for="b in KI_BEREICHE" :key="b.id" class="nav-item">
                <a class="nav-link" :class="{ active: kiBereich === b.id }"
                    href="#" @click.prevent="kiBereichWechseln(b.id)">
                    <i :class="b.icon" class="me-1"></i>{{ t('settings.ki.tab_' + b.id) }}
                </a>
            </li>
        </ul>

        <!--=============== ÜBERSICHT ===============-->
        <div v-show="kiBereich === 'uebersicht'">
            <KiUebersicht v-if="kiBereich === 'uebersicht'" @gehe-zu="kiBereichWechseln" />
        </div>

        <KeepAlive>
            <component :is="kiKomponente" v-if="kiKomponente" />
        </KeepAlive>
    </div>
</template>
