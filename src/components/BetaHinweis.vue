<script setup>
/**
 * Warnbanner für den Agent-Modus.
 *
 * Der Modus handelt selbstständig — auch wenn zunächst nur auf dem Papier.
 * Wer ihn öffnet, muss ohne Nachfragen wissen, woran er ist: unfertig, keine
 * Anlageberatung, Live nur über die dreifache Freigabekette.
 *
 * Das Zuklappen wird pro Browser gemerkt (localStorage), aber bewusst NICHT
 * dauerhaft weggeklickt: bei jedem neuen Sitzungsstart erscheint der Hinweis
 * wieder. Eine Warnung, die man einmal wegklickt und nie wiedersieht, ist keine.
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Hinweis from './basis/Hinweis.vue'
import Pille from './basis/Pille.vue'

const { t } = useI18n()

const SCHLUESSEL = 'agentBetaHinweisSitzung'
const offen = ref(sessionStorage.getItem(SCHLUESSEL) !== 'zu')

function zuklappen() {
    offen.value = false
    try { sessionStorage.setItem(SCHLUESSEL, 'zu') } catch (e) { /* privater Modus */ }
}
</script>

<template>
    <Hinweis v-if="offen" art="warn" schliessbar class="betaHinweis" @zu="zuklappen">
        <div class="betaTitel">
            {{ t('strategies.betaTitle') }}
            <Pille ton="warn">Beta</Pille>
        </div>
        <p class="betaText">{{ t('strategies.betaBody') }}</p>
        <ul class="betaListe">
            <li>{{ t('strategies.betaPoint1') }}</li>
            <li>{{ t('strategies.betaPoint2') }}</li>
            <li>{{ t('strategies.betaPoint3') }}</li>
        </ul>
    </Hinweis>
</template>

<style scoped>
.betaHinweis {
    margin-bottom: 1rem;
    border-left-width: 3px;
}

.betaTitel {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-bottom: 0.25rem;
    font-weight: 600;
    color: var(--text);
}

.betaText {
    margin: 0 0 0.25rem;
    font-size: 0.875em;
}

.betaListe {
    margin: 0;
    padding-left: 1rem;
    font-size: 0.875em;
}
</style>
