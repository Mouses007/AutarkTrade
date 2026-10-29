<script setup>
/**
 * Bereich „Rechtliches": Einstieg in Haftungsausschluss, Lizenz (AGPL-3.0), die NOTICE-Hinweise
 * (u. a. TradingView Lightweight Charts) und die Lizenzen fremder Software.
 * Die Texte selbst zeigt der Dialog aus S10 (`components/rechtliches/Rechtliches.vue`,
 * hängt in `App.vue`); hier nur je Reiter ein Knopf, der ihn dort öffnet.
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Knopf } from '@/components/basis/index.js'
import Abschnitt from './gemeinsam/Abschnitt.vue'
import { oeffneRechtliches } from '@/stores/rechtliches.js'

const { t } = useI18n()
const offen = ref(true)   // ein einziger Abschnitt: gleich offen
const REITER = [
    { id: 'haftung', schluessel: 'rechtliches.reiterHaftung', symbol: 'waage' },
    { id: 'lizenz', schluessel: 'rechtliches.reiterLizenz', symbol: 'dokument' },
    { id: 'hinweise', schluessel: 'rechtliches.reiterHinweise', symbol: 'info' },
    { id: 'drittsoftware', schluessel: 'rechtliches.reiterDrittsoftware', symbol: 'dokument' },
]
</script>

<template>
    <div>
        <!-- Dasselbe Abschnitt-Muster wie die übrigen Seiten (vorher Seitenkopf + Karte) -->
        <Abschnitt v-model:offen="offen" kennung="rechtliches" :titel="t('settings.area_rechtliches')" symbol="waage">
            <p class="einleitung">{{ t('settings.rechtlichesUnter') }}</p>
            <div class="knoepfe">
                <Knopf v-for="r in REITER" :key="r.id" :symbol="r.symbol" @click="oeffneRechtliches(r.id)">
                    {{ t(r.schluessel) }}
                </Knopf>
            </div>
        </Abschnitt>
    </div>
</template>

<style scoped>
.einleitung {
    margin: 0 0 var(--abstand-3);
    color: var(--muted);
    font-size: 0.85rem;
}
.knoepfe {
    display: flex;
    flex-wrap: wrap;
    gap: var(--abstand-2);
}
</style>
