<script setup>
/**
 * Spot-Portfolio (Beta): drei Ansichten auf einer Route — Übersicht,
 * Bewegungen, Quellen. Das Seitenmenü schaltet über den Pfad; die Seite
 * bleibt stehen, ein laufender Abruf auch.
 */
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ladeUebersicht, uebersicht, laedt, ladeFehler } from '../stores/portfolio.js'
import PortfolioUebersicht from '../components/portfolio/PortfolioUebersicht.vue'
import PortfolioBewegungen from '../components/portfolio/PortfolioBewegungen.vue'
import PortfolioQuellen from '../components/portfolio/PortfolioQuellen.vue'
import PortfolioSteuer from '../components/portfolio/PortfolioSteuer.vue'
import { Hinweis, Kreisel } from '../components/basis/index.js'

const { t } = useI18n()
const route = useRoute()
const reiter = computed(() => (['bewegungen', 'quellen', 'steuer'].includes(route.params.reiter) ? route.params.reiter : 'uebersicht'))

onMounted(ladeUebersicht)
</script>

<template>
    <div class="pf">
        <Hinweis art="warn" class="pf-test" schliessbar :titel="t('portfolio.testTitel')">{{ t('portfolio.testText') }}</Hinweis>
        <Hinweis v-if="ladeFehler" art="fehler">{{ ladeFehler }}</Hinweis>
        <div v-if="laedt && !uebersicht" class="at-mittig at-py-5"><Kreisel /></div>
        <template v-else>
            <PortfolioUebersicht v-if="reiter === 'uebersicht'" />
            <PortfolioBewegungen v-else-if="reiter === 'bewegungen'" />
            <PortfolioSteuer v-else-if="reiter === 'steuer'" />
            <PortfolioQuellen v-else />
        </template>
    </div>
</template>

<style scoped>
.pf { padding: 0 1rem 3rem; max-width: 1180px; }
@media (min-width: 768px) { .pf { padding: 0 1.5rem 3rem; } }
.pf-test { margin-bottom: 1rem; }
</style>
