<script setup>
/**
 * Spot-Portfolio (Beta): Ansichten auf einer Route — Übersicht, DCA-Portfolio,
 * Bewegungen, Staking, Frühphase, Steuern, Totalverluste, Quellen. Das Seitenmenü schaltet über den Pfad; die Seite
 * bleibt stehen, ein laufender Abruf auch.
 */
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useKiSeitenStand } from '../composables/useKiSeitenStand.js'
import { ladeUebersicht, uebersicht, laedt, ladeFehler } from '../stores/portfolio.js'
import PortfolioUebersicht from '../components/portfolio/PortfolioUebersicht.vue'
import PortfolioBewegungen from '../components/portfolio/PortfolioBewegungen.vue'
import PortfolioStaking from '../components/portfolio/PortfolioStaking.vue'
import PortfolioDca from '../components/portfolio/PortfolioDca.vue'
import PortfolioQuellen from '../components/portfolio/PortfolioQuellen.vue'
import PortfolioSteuer from '../components/portfolio/PortfolioSteuer.vue'
import PortfolioFruehphase from '../components/portfolio/PortfolioFruehphase.vue'
import PortfolioTotalverluste from '../components/portfolio/PortfolioTotalverluste.vue'
import WaehrungSchalter from '../components/portfolio/WaehrungSchalter.vue'
import { Hinweis, Kreisel } from '../components/basis/index.js'

const { t } = useI18n()
const route = useRoute()
const reiter = computed(() => (['dca', 'bewegungen', 'staking', 'fruehphase', 'quellen', 'steuer', 'totalverluste'].includes(route.params.reiter) ? route.params.reiter : 'uebersicht'))
// Die Übersicht trägt den Währungs-Umschalter in ihrem Kopf, der Steuerbericht bleibt in CHF.
const mitWaehrung = computed(() => ['dca', 'bewegungen', 'staking', 'fruehphase', 'totalverluste'].includes(reiter.value))
useKiSeitenStand(() => ({ reiter: reiter.value }))

onMounted(ladeUebersicht)
</script>

<template>
    <div class="pf">
        <Hinweis v-if="ladeFehler" art="fehler">{{ ladeFehler }}</Hinweis>
        <div v-if="laedt && !uebersicht" class="at-mittig at-py-5"><Kreisel /></div>
        <template v-else>
            <div v-if="mitWaehrung" class="pf-waehrung"><WaehrungSchalter /></div>
            <PortfolioUebersicht v-if="reiter === 'uebersicht'" />
            <PortfolioDca v-else-if="reiter === 'dca'" />
            <PortfolioBewegungen v-else-if="reiter === 'bewegungen'" />
            <PortfolioStaking v-else-if="reiter === 'staking'" />
            <PortfolioFruehphase v-else-if="reiter === 'fruehphase'" />
            <PortfolioSteuer v-else-if="reiter === 'steuer'" />
            <PortfolioTotalverluste v-else-if="reiter === 'totalverluste'" />
            <PortfolioQuellen v-else />
        </template>
    </div>
</template>

<style scoped>
.pf { padding: 0 1rem 3rem; max-width: 1180px; }
.pf-waehrung { display: flex; justify-content: flex-end; margin-top: 0.5rem; }
@media (min-width: 768px) { .pf { padding: 0 1.5rem 3rem; } }
</style>
