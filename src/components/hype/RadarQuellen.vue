<script setup>
/**
 * Quellenzeile für Hype- und Coin-Radar — die Pflicht-Attributionen an einer
 * Stelle (Verkaufs-Prüfung S12):
 *
 *   coingecko    „Powered by CoinGecko" (API-Terms §4.4, auch für die
 *                On-Chain-Pools, die über die CoinGecko-API laufen)
 *   goplus       „Powered by GoPlus Security" mit Link (Lizenzvertrag, Z. 65)
 *   biz          „Quelle: 4chan /biz/" mit Link (4chan-API-Regeln, Z. 62)
 *   dexscreener  „Daten: DexScreener" (keine Pflicht, Z. 57)
 *   rugcheck     „Daten: RugCheck" (nur wenn eingeschaltet)
 *
 *   <RadarQuellen :quellen="['dexscreener', 'coingecko']" />
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Quellenhinweis from '../basis/Quellenhinweis.vue'

const props = defineProps({
    /** Kennungen in der gewünschten Reihenfolge; unbekannte fallen weg. */
    quellen: { type: Array, default: () => [] },
    rechts: { type: Boolean, default: false },
})

const { t } = useI18n()

const RADAR_QUELLEN = {
    coingecko: { name: 'CoinGecko', url: 'https://www.coingecko.com/', art: 'powered' },
    goplus: { name: 'GoPlus Security', url: 'https://gopluslabs.io/', art: 'powered' },
    biz: { name: '4chan /biz/', url: 'https://boards.4chan.org/biz/', art: 'quelle' },
    dexscreener: { name: 'DexScreener', url: 'https://dexscreener.com/', art: 'daten' },
    rugcheck: { name: 'RugCheck', url: 'https://rugcheck.xyz/', art: 'daten' },
}

const liste = computed(() => [...new Set(props.quellen || [])].map((q) => RADAR_QUELLEN[q]).filter(Boolean))
const worte = computed(() => ({ daten: t('hype.quelleDaten'), quelle: t('hype.quelleQuelle') }))
</script>

<template>
    <Quellenhinweis v-if="liste.length" :quellen="liste" :worte="worte" :rechts="rechts" />
</template>
