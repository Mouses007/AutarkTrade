<script setup>
/**
 * Bereich „Rechtliches": Einstieg in die Lizenzbedingungen, die NOTICE-Hinweise
 * (u. a. TradingView Lightweight Charts) und die Lizenzen fremder Software.
 * Die Texte selbst zeigt der Dialog aus S10 (`components/rechtliches/Rechtliches.vue`,
 * hängt in `App.vue`); hier nur je Reiter ein Knopf, der ihn dort öffnet.
 */
import { useI18n } from 'vue-i18n'
import { Seitenkopf, Karte, Knopf } from '@/components/basis/index.js'
import { oeffneRechtliches } from '@/stores/rechtliches.js'

const { t } = useI18n()
const REITER = [
    { id: 'lizenz', schluessel: 'rechtliches.reiterLizenz', symbol: 'waage' },
    { id: 'hinweise', schluessel: 'rechtliches.reiterHinweise', symbol: 'info' },
    { id: 'drittsoftware', schluessel: 'rechtliches.reiterDrittsoftware', symbol: 'dokument' },
]
</script>

<template>
    <div>
        <Seitenkopf :titel="t('settings.area_rechtliches')" :unter="t('settings.rechtlichesUnter')" />
        <Karte>
            <div class="knoepfe">
                <Knopf v-for="r in REITER" :key="r.id" :symbol="r.symbol" @click="oeffneRechtliches(r.id)">
                    {{ t(r.schluessel) }}
                </Knopf>
            </div>
        </Karte>
    </div>
</template>

<style scoped>
.knoepfe {
    display: flex;
    flex-wrap: wrap;
    gap: var(--abstand-2);
}
</style>
