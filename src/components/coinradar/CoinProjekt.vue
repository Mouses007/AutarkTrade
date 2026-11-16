<script setup>
/**
 * Coin-Ansicht, Karte «Projekt»: was der Coin ist — Beschreibung, Kategorien,
 * Start, Links. Quelle ist CoinGecko (`/api/coin-radar/coin-info`, 24 h
 * Vorrat); die Karte trägt die Pflichtzeile «Powered by CoinGecko».
 *
 * FREMDTEXT. Die Beschreibung schreibt das Projekt selbst (oder irgendwer bei
 * CoinGecko). Sie steht als reiner Text da — nie als HTML — und ist als
 * Selbstauskunft gekennzeichnet. Links gehen durch `sichereUrl`.
 *
 * CoinGecko führt kein «Team»-Feld; wie viele öffentliche Kanäle hinterlegt
 * sind, ist dafür ein nachprüfbarer Hinweis (wie in der früheren Info-Karte).
 */
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Karte from '../basis/Karte.vue'
import Pille from '../basis/Pille.vue'
import Kreisel from '../basis/Kreisel.vue'
import Symbol from '../basis/Symbol.vue'
import QuelleAus from '../quellen/QuelleAus.vue'
import RadarQuellen from '../hype/RadarQuellen.vue'
import { useCoinFormat } from '../../composables/useCoinFormat.js'
import { alterMonate } from '../../utils/coinAnsicht.js'
import { sichereUrl } from '../../utils/sanitize.js'

const props = defineProps({
    symbol: { type: String, required: true },
    /** Objekt = Treffer, `null` = CoinGecko kennt das Kürzel nicht, `undefined` = (noch) nichts. */
    info: { type: Object, default: undefined },
    laedt: { type: Boolean, default: false },
    aus: { type: Object, default: null },
    fehler: { type: String, default: '' },
})
const { t } = useI18n()
const { datum } = useCoinFormat()

const voll = ref(false)
watch(() => props.symbol, () => { voll.value = false })

const KANAELE = ['homepage', 'whitepaper', 'twitter', 'telegram', 'github']
const kanaeleText = computed(() => {
    const c = props.info
    if (!c) return ''
    // Nicht alle fünf aufzählen, sondern die fehlenden nennen — sonst bleibt offen, welcher fehlt.
    const NAMEN = { homepage: t('coinradar.coinInfoWebsite'), whitepaper: 'Whitepaper', twitter: 'X', telegram: 'Telegram', github: 'GitHub' }
    const fehlt = KANAELE.filter((k) => !c[k]).map((k) => NAMEN[k])
    const n = KANAELE.length - fehlt.length
    const kanaele = fehlt.length
        ? t('coinradar.coinInfoKanaeleFehlen', { n, gesamt: KANAELE.length, fehlt: fehlt.join(', ') })
        : t('coinradar.coinInfoKanaeleAlle', { gesamt: KANAELE.length })
    return `${kanaele} ${t(c.github ? 'coinradar.coinInfoGithubJa' : 'coinradar.coinInfoGithubNein')}`
})
const links = computed(() => {
    const c = props.info
    if (!c) return []
    return [
        { id: 'website', url: c.homepage, symbol: 'globus', name: t('coinradar.coinInfoWebsite') },
        { id: 'whitepaper', url: c.whitepaper, symbol: 'dokument', name: 'Whitepaper' },
        { id: 'x', url: c.twitter, symbol: 'nachricht', name: 'X' },
        { id: 'telegram', url: c.telegram, symbol: 'senden', name: 'Telegram' },
        { id: 'reddit', url: c.reddit, symbol: 'nachricht', name: 'Reddit' },
        { id: 'forum', url: c.forum, symbol: 'nachricht', name: t('coinAnsicht.forum') },
        { id: 'github', url: c.github, symbol: 'code', name: 'GitHub' },
        { id: 'explorer', url: c.explorer, symbol: 'suche', name: 'Explorer' },
        { id: 'coingecko', url: c.coingeckoUrl, symbol: 'extern', name: 'CoinGecko' },
    ].map((l) => ({ ...l, url: sichereUrl(l.url) })).filter((l) => l.url)
})
const alter = computed(() => {
    const m = alterMonate(props.info?.genesis)
    if (m == null) return ''
    return m < 24 ? t('coinAnsicht.alterMonate', { n: m }, m) : t('coinAnsicht.alterJahre', { n: Math.floor(m / 12) }, Math.floor(m / 12))
})
const ketten = computed(() => Object.entries(props.info?.plattformen || {}).filter(([kette, vertrag]) => kette && vertrag).map(([kette]) => kette))
</script>

<template>
    <Karte :titel="t('coinAnsicht.projekt')" :unter="info ? t('coinAnsicht.projektUnter') : ''">
        <div v-if="laedt" class="ca-laedt"><Kreisel :groesse="22" :titel="t('coinAnsicht.laedt')" /></div>
        <QuelleAus v-else-if="aus" :aus="aus" klein />
        <p v-else-if="fehler" class="ca-klein">{{ fehler }}</p>
        <p v-else-if="info === null" class="ca-klein">{{ t('coinradar.coinInfoKeineDaten', { symbol }) }}</p>
        <template v-else-if="info">
            <div v-if="info.kategorien.length" class="marken">
                <Pille v-for="k in info.kategorien.slice(0, 8)" :key="k" ton="neutral">{{ k }}</Pille>
            </div>
            <template v-if="info.beschreibung">
                <!-- Fremdtext: reiner Text, kein HTML. -->
                <p :class="['beschreibung', { gekuerzt: !voll }]">{{ info.beschreibung }}</p>
                <button v-if="info.beschreibung.length > 420" type="button" class="ca-mehr" :aria-expanded="voll ? 'true' : 'false'" @click="voll = !voll">
                    {{ voll ? t('coinradar.coinInfoWeniger') : t('coinradar.coinInfoMehr') }}
                </button>
            </template>
            <p v-else class="ca-klein">{{ t('coinAnsicht.ohneBeschreibung') }}</p>

            <dl class="ca-profil">
                <div v-if="info.marketCapRang"><dt>{{ t('coinAnsicht.rang') }}</dt><dd>{{ info.marketCapRang }}</dd></div>
                <div v-if="info.genesis"><dt>{{ t('coinAnsicht.genesis') }}</dt><dd>{{ datum(info.genesis) }}<span v-if="alter" class="ca-klein"> · {{ alter }}</span></dd></div>
                <div v-if="info.algorithmus"><dt>{{ t('coinAnsicht.algorithmus') }}</dt><dd>{{ info.algorithmus }}</dd></div>
                <div v-if="ketten.length"><dt>{{ t('coinAnsicht.ketten') }}</dt><dd>{{ ketten.slice(0, 5).join(', ') }}<template v-if="ketten.length > 5"> +{{ ketten.length - 5 }}</template></dd></div>
            </dl>

            <nav class="links" :aria-label="t('coinAnsicht.linksAria')">
                <a v-for="l in links" :key="l.id" :href="l.url" target="_blank" rel="noopener noreferrer">
                    <Symbol :name="l.symbol" :groesse="15" />{{ l.name }}
                </a>
            </nav>
            <p class="ca-klein ca-fuss">{{ kanaeleText }}</p>
            <RadarQuellen :quellen="['coingecko']" />
        </template>
    </Karte>
</template>

<style scoped>
.marken {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-bottom: 0.7rem;
}

.beschreibung {
    margin: 0;
    font-size: 0.86rem;
    line-height: 1.5;
    color: var(--muted);
    white-space: pre-line;
    overflow-wrap: anywhere;
}

.beschreibung.gekuerzt {
    display: -webkit-box;
    -webkit-line-clamp: 6;
    line-clamp: 6;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

.links {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-top: 0.8rem;
}

.links a {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.25rem 0.6rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-pille);
    background: var(--panel-soft);
    color: var(--text);
    font-size: 0.8rem;
    text-decoration: none;
}

.links a:hover,
.links a:focus-visible {
    border-color: var(--accent-rand);
    color: var(--accent);
}
</style>
