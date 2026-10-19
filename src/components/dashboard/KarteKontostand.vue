<script setup>
/**
 * Karte „Kontostand" (Spezifikation B.5.1): Stand, Performance, Volumen, die
 * drei Ringe und der Heute-Zähler. Der Stand aktualisiert sich über den
 * `accountBalance`-Store; der Sync-Knopf stösst nur an.
 */
import { computed, ref, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { currentUser } from '../../stores/settings.js'
import { selectedBroker, amountCase } from '../../stores/filters.js'
import { renderData, timeZoneTrade } from '../../stores/ui.js'
import { satisfactionArray, satisfactionTradeArray, profitAnalysis, filteredTradesTrades } from '../../stores/trades.js'
import { incomingPositions } from '../../stores/journal/offenePositionen.js'
import { allTimeNetPnL, allTimeVolume, last30dVolume, displayBonus, syncStartBalanceFromBroker } from '../../stores/accountBalance.js'
import { useTwoDecCurrencyFormat, useThousandCurrencyFormat } from '../../utils/journal/format.js'
import Symbol from '@/components/basis/Symbol.vue'
import InfoTipp from '@/components/InfoTipp.vue'
import TitelKarte from './TitelKarte.vue'
import { kontostand, heuteZaehler } from './rechnung.js'

const { t } = useI18n()

const stand = computed(() => kontostand({
    benutzer: currentUser.value,
    broker: selectedBroker.value,
    allTimeNetPnL: allTimeNetPnL.value,
    positionen: incomingPositions,
    bonus: displayBonus.value,
}))

/*
 * Die Bedingungen der Ringe 2 und 3 sind dieselben wie in `useECharts`
 * (verteiler.js) — weichen sie ab, steht ein leerer Ring da.
 */
const mitZufriedenheit = computed(() => satisfactionArray.length > 0 || satisfactionTradeArray.length > 0)
const mitRrr = computed(() => {
    const r = profitAnalysis[`${amountCase.value}R`]
    return !!r && !Number.isNaN(r) && r > 0
})
const ringe = computed(() => 1 + (mitZufriedenheit.value ? 1 : 0) + (mitRrr.value ? 1 : 0))

const heute = computed(() => heuteZaehler(filteredTradesTrades, timeZoneTrade.value))

const vorzeichen = (x) => (x >= 0 ? '+' : '')

// ── Sync mit dem Broker-Wallet ──────────────────────────────────────────
const syncLaeuft = ref(false)
const rueckmeldung = ref(null)   // { ok, text, zeit }
let syncTimer = null

async function synchronisieren() {
    if (syncLaeuft.value) return
    syncLaeuft.value = true
    rueckmeldung.value = null
    try {
        const r = await syncStartBalanceFromBroker()
        let text
        if (r?.ok) {
            text = t('dashboard.syncOk', { start: Number(r.start).toFixed(2) })
            if (r.bonus) text += t('dashboard.syncBonusIgnored', { bonus: Number(r.bonus).toFixed(2) })
            text += ')'
        } else {
            text = '✗ ' + (r?.error || t('dashboard.syncFehler'))
        }
        const zeit = Date.now()
        rueckmeldung.value = { ok: !!r?.ok, text, zeit }
        // Eine neuere Rückmeldung bleibt stehen: nur die eigene, mindestens
        // 6 s alte wird abgeräumt.
        clearTimeout(syncTimer)
        syncTimer = setTimeout(() => {
            if (rueckmeldung.value && Date.now() - rueckmeldung.value.zeit >= 6000) rueckmeldung.value = null
        }, 6500)
    } finally {
        syncLaeuft.value = false
    }
}
onBeforeUnmount(() => clearTimeout(syncTimer))
</script>

<template>
    <TitelKarte :titel="t('dashboard.accountBalance')">
        <template #rechts>
            <button type="button" class="kb-sync" :disabled="syncLaeuft" :title="t('dashboard.syncHint')"
                :aria-label="t('dashboard.syncHint')" @click="synchronisieren">
                <Symbol name="aktualisieren" :class="{ dreht: syncLaeuft }" />
            </button>
        </template>

        <div v-if="rueckmeldung" class="kb-rueck" :class="rueckmeldung.ok ? 'at-gut' : 'at-schlecht'">{{ rueckmeldung.text }}</div>

        <div v-if="!stand" class="kb-leer">
            <Symbol name="geldbeutel" :groesse="26" />
            <span>{{ t('dashboard.configureBalance') }}</span>
        </div>
        <div v-else class="kb-stand">
            <div class="kb-gross zahl" :class="stand.pnl >= 0 ? 'at-gut' : 'at-schlecht'">{{ useTwoDecCurrencyFormat(stand.aktuell) }}</div>
            <div class="kb-unter">{{ t('dashboard.currentBalance') }}</div>
            <div class="kb-perf zahl" :class="stand.performance >= 0 ? 'at-gut' : 'at-schlecht'">
                {{ vorzeichen(stand.performance) }}{{ stand.performance.toFixed(1) }}%
            </div>
            <div v-if="stand.bonus > 0" class="kb-bonus">
                {{ t('dashboard.bonusIncl', { betrag: useTwoDecCurrencyFormat(stand.bonus) }) }}
                <InfoTipp schluessel="dashboard.bonusHint" />
            </div>
        </div>

        <table v-if="allTimeVolume > 0" class="kb-volumen">
            <tbody>
                <tr><td>{{ t('dashboard.volume30d') }}</td><td class="zahl at-fett">{{ useThousandCurrencyFormat(last30dVolume) }}</td></tr>
                <tr><td>{{ t('dashboard.volumeTotal') }}</td><td class="zahl at-fett">{{ useThousandCurrencyFormat(allTimeVolume) }}</td></tr>
            </tbody>
        </table>

        <div class="kb-ringe" :class="'n' + ringe">
            <div id="pieChart1" :key="'r1-' + renderData" class="chartIdCardClass kb-ring"></div>
            <div v-if="mitZufriedenheit" id="pieChart2" :key="'r2-' + renderData" class="chartIdCardClass kb-ring"></div>
            <div v-if="mitRrr" id="pieChart3" :key="'r3-' + renderData" class="chartIdCardClass kb-ring"></div>
        </div>

        <div v-if="heute.anzahl > 0" class="kb-heute">
            <div class="kb-heute-titel">{{ t('common.today') }}</div>
            <div class="kb-heute-zeile">
                <span>{{ heute.anzahl }} {{ t('common.trades') }}</span>
                <span class="at-gut"><Symbol name="hoch" />{{ heute.gewinner }}</span>
                <span class="at-schlecht"><Symbol name="runter" />{{ heute.verlierer }}</span>
            </div>
            <div class="kb-heute-pnl zahl" :class="heute.pnl >= 0 ? 'at-gut' : 'at-schlecht'">
                {{ vorzeichen(heute.pnl) }}{{ useTwoDecCurrencyFormat(heute.pnl) }}
            </div>
        </div>
    </TitelKarte>
</template>

<style scoped>
.kb-sync {
    display: inline-flex;
    padding: 0.3rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-klein);
    background: var(--panel-soft);
    color: var(--muted);
    cursor: pointer;
}

.kb-sync:hover:not(:disabled) {
    color: var(--accent);
    border-color: var(--accent-rand);
}

.kb-sync:disabled {
    cursor: wait;
}

.dreht {
    animation: kb-dreh 0.9s linear infinite;
}

@keyframes kb-dreh {
    to { transform: rotate(360deg); }
}

.kb-rueck {
    margin-bottom: 0.5rem;
    font-size: 0.8rem;
}

.kb-leer {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
    padding: 0.8rem 0;
    color: var(--muted);
    text-align: center;
    font-size: 0.86rem;
}

.kb-stand {
    text-align: center;
}

.kb-gross {
    font-size: 1.7rem;
    font-weight: 700;
    line-height: 1.15;
}

.kb-unter {
    font-size: 0.78rem;
    color: var(--muted);
}

.kb-perf {
    margin-top: 0.2rem;
    font-weight: 600;
}

.kb-bonus {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    margin-top: 0.15rem;
    font-size: 0.76rem;
    color: var(--muted);
}

.kb-volumen {
    width: 100%;
    margin-top: 0.6rem;
    font-size: 0.82rem;
    border-collapse: collapse;
}

.kb-volumen td {
    padding: 0.15rem 0;
    color: var(--muted);
}

.kb-volumen td.zahl {
    text-align: right;
    color: var(--text);
}

.kb-ringe {
    display: grid;
    gap: 0.4rem;
    margin-top: 0.7rem;
    padding-top: 0.7rem;
    border-top: 1px solid var(--line);
}

.kb-ringe.n1 { grid-template-columns: 1fr; }
.kb-ringe.n2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.kb-ringe.n3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }

.kb-ring {
    width: 100%;
    height: 110px;
}

.kb-heute {
    margin-top: 0.7rem;
    padding-top: 0.6rem;
    border-top: 1px solid var(--line);
    text-align: center;
    font-size: 0.85rem;
}

.kb-heute-titel {
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--muted);
}

.kb-heute-zeile {
    display: flex;
    justify-content: center;
    flex-wrap: wrap;
    gap: 0.8rem;
    margin-top: 0.15rem;
}

.kb-heute-zeile span {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
}

.kb-heute-pnl {
    font-weight: 700;
}
</style>
