<script setup>
/**
 * Bilanz zur Info (nicht für die Steuer): wie viel Bargeld hineinging und was
 * heute da ist — Spot-Portfolio plus Guthaben auf den Futures-Börsen.
 * Eine Zeile, aufklappbar zu Jahren und Orten.
 */
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import { chf, prozent } from '../../stores/portfolio.js'
import { Karte, Symbol, Kreisel } from '../basis/index.js'

const { t } = useI18n()
const b = ref(null)
const offen = ref(false)
const fehler = ref('')
onMounted(async () => {
    try { b.value = (await axios.get('/api/portfolio/bilanz')).data } catch (e) { fehler.value = e.response?.data?.error || e.message }
})
const anteil = computed(() => (b.value?.nettoChf > 0 ? b.value.differenzChf / b.value.nettoChf : null))
const jahre = computed(() => Object.entries(b.value?.jeJahr || {}).sort((x, y) => x[0] - y[0]))
const maxJahr = computed(() => Math.max(1, ...jahre.value.map(([, v]) => v.ein)))
</script>

<template>
    <Karte dicht class="bk">
        <button type="button" class="bk-kopf" :aria-expanded="offen" @click="offen = !offen">
            <span class="bk-etikett">{{ t('portfolio.biTitel') }}</span>
            <template v-if="b">
                <span class="bk-zeile">
                    <span><small>{{ t('portfolio.biRein') }}</small><b>{{ chf(b.nettoChf) }}</b></span>
                    <Symbol name="pfeilRechts" :groesse="14" class="bk-pfeil" />
                    <span><small>{{ t('portfolio.biHeute') }}</small><b>{{ chf(b.wertChf) }}</b></span>
                    <span :class="b.differenzChf >= 0 ? 'at-gut' : 'at-schlecht'"><small>{{ t('portfolio.biDifferenz') }}</small><b>{{ chf(b.differenzChf, { vorzeichen: true }) }}<template v-if="anteil != null"> ({{ (anteil * 100).toFixed(0) }} %)</template></b></span>
                </span>
            </template>
            <Kreisel v-else-if="!fehler" still />
            <span v-else class="at-gedaempft">{{ fehler }}</span>
            <Symbol name="runter" :groesse="16" class="bk-auf" :class="{ offen }" />
        </button>
        <div v-if="offen && b" class="bk-inhalt">
            <div class="bk-spalten">
                <div>
                    <h4>{{ t('portfolio.biBargeld') }}</h4>
                    <div class="bk-reihe"><span>{{ t('portfolio.biEingezahlt') }}</span><span>{{ chf(b.eingezahltChf) }}</span></div>
                    <div v-if="b.karteChf" class="bk-reihe"><span>{{ t('portfolio.biKarte') }}</span><span>{{ chf(b.karteChf) }}</span></div>
                    <div class="bk-reihe"><span>{{ t('portfolio.biAusgezahlt') }}</span><span>− {{ chf(b.ausgezahltChf) }}</span></div>
                    <div class="bk-reihe summe"><span>{{ t('portfolio.biNetto') }}</span><span>{{ chf(b.nettoChf) }}</span></div>
                    <p v-if="b.abgeleitetChf" class="bk-notiz">{{ t('portfolio.biAbgeleitet', { v: chf(b.abgeleitetChf) }) }}</p>
                </div>
                <div>
                    <h4>{{ t('portfolio.biWert') }}</h4>
                    <div class="bk-reihe"><span>{{ t('portfolio.biSpot') }}</span><span>{{ chf(b.spotChf) }}</span></div>
                    <div v-for="f in b.futures" :key="f.name" class="bk-reihe">
                        <span>{{ f.name }}<small v-if="f.hinweis" class="at-gedaempft"> · {{ f.hinweis }}</small></span>
                        <span>{{ f.chf != null ? chf(f.chf) : '—' }}</span>
                    </div>
                    <div class="bk-reihe summe"><span>{{ t('portfolio.biHeute') }}</span><span>{{ chf(b.wertChf) }}</span></div>
                </div>
            </div>
            <h4>{{ t('portfolio.biJeJahr') }}</h4>
            <div class="bk-jahre">
                <div v-for="[j, v] in jahre" :key="j" class="bk-jahr" :title="`${j}: +${chf(v.ein)}${v.aus ? ' / −' + chf(v.aus) : ''}`">
                    <span class="bk-balken"><span :style="{ height: (v.ein / maxJahr) * 100 + '%' }" /><span v-if="v.aus" class="aus" :style="{ height: (v.aus / maxJahr) * 100 + '%' }" /></span>
                    <small>{{ j }}</small>
                </div>
            </div>
            <p class="bk-notiz">{{ t('portfolio.biInfo') }}</p>
        </div>
    </Karte>
</template>

<style scoped>
.bk { margin-top: 0.75rem; }
.bk-kopf { width: 100%; display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; background: none; border: 0; color: inherit; font: inherit; cursor: pointer; text-align: left; padding: 0; }
.bk-etikett { font-size: 0.72rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--leise); }
.bk-zeile { display: flex; align-items: center; gap: 1.1rem; flex-wrap: wrap; flex: 1; font-variant-numeric: tabular-nums; }
.bk-zeile > span { display: flex; flex-direction: column; }
.bk-zeile small { font-size: 0.68rem; color: var(--leise); }
.bk-pfeil { color: var(--leise); }
.bk-auf { color: var(--leise); transition: transform 0.2s; margin-left: auto; }
.bk-auf.offen { transform: rotate(180deg); }
.bk-inhalt { margin-top: 0.75rem; border-top: 1px solid var(--line); padding-top: 0.75rem; }
.bk-spalten { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr)); gap: 1.5rem; }
.bk h4 { font-size: 0.72rem; letter-spacing: 0.05em; text-transform: uppercase; color: var(--leise); margin: 0 0 0.4rem; }
.bk-reihe { display: flex; justify-content: space-between; gap: 0.75rem; font-size: 0.85rem; padding: 0.2rem 0; font-variant-numeric: tabular-nums; }
.bk-reihe.summe { border-top: 1px solid var(--line-stark); font-weight: 700; margin-top: 0.2rem; padding-top: 0.35rem; }
.bk-notiz { font-size: 0.75rem; color: var(--leise); margin: 0.5rem 0 0; }
.bk-jahre { display: flex; gap: 0.6rem; align-items: flex-end; height: 5.5rem; margin-top: 0.4rem; }
.bk-jahr { display: flex; flex-direction: column; align-items: center; gap: 0.2rem; flex: 1; max-width: 3rem; height: 100%; }
.bk-balken { flex: 1; width: 100%; display: flex; align-items: flex-end; gap: 2px; }
.bk-balken span { flex: 1; background: var(--accent); border-radius: 3px 3px 0 0; min-height: 2px; }
.bk-balken span.aus { background: var(--bad); }
.bk-jahr small { font-size: 0.65rem; color: var(--leise); }
</style>
