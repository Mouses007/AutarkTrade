<script setup>
/**
 * Hinweis auf neue Trade-Bewertungen (Spezifikation ansichten.md X.1–X.4).
 *
 * `utils/incoming.js` füllt `evalNeu` mit den noch nie gemeldeten Positionen
 * und setzt `evalNotificationShown`/`evalNotificationDismissed`. Früher hing
 * das Öffnen allein am Wechsel von `evalNotificationShown` — das wird aber nie
 * wieder falsch, also erschien nach dem ersten Popup einer Seitenlebenszeit
 * keins mehr. Jetzt wird auf „nicht verworfen UND etwas Neues" beobachtet;
 * jede neue Meldung bringt ein neues `evalNeu`-Objekt und damit ein neues
 * Popup.
 *
 * Nativer <dialog> über den Baustein `Dialog` — kein Bootstrap-Objekt, das
 * ohne CDN fehlte und das Einhängen werfen liess.
 */
import { computed, ref, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { evalNeu, evalNotificationShown, evalNotificationDismissed } from '../stores/trades.js'
import Dialog from '@/components/basis/Dialog.vue'
import Knopf from '@/components/basis/Knopf.vue'
import Symbol from '@/components/basis/Symbol.vue'

const { t } = useI18n()
const router = useRouter()

const offen = ref(false)

const oeffnung = computed(() => evalNeu.value?.oeffnung || { anzahl: 0, jeBroker: {} })
const schluss = computed(() => evalNeu.value?.schluss || { anzahl: 0, jeBroker: {} })
const etwasNeues = computed(() => oeffnung.value.anzahl > 0 || schluss.value.anzahl > 0)

const NAMEN = { bitunix: 'Bitunix', bitget: 'Bitget', pionex: 'Pionex' }
function brokerName(b) {
    if (!b) return '—'
    return NAMEN[b] || b.charAt(0).toUpperCase() + b.slice(1)
}

watch([evalNotificationShown, evalNotificationDismissed, evalNeu], async () => {
    if (evalNotificationShown.value && !evalNotificationDismissed.value && etwasNeues.value) {
        await nextTick()
        offen.value = true
    }
}, { immediate: true })

/** Jede Art zu schliessen (×, Esc, Hintergrund) verwirft die Meldung. */
function verworfen() {
    evalNotificationDismissed.value = true
    offen.value = false
}

function zuDenTrades() {
    verworfen()
    router.push('/incoming')
}
</script>

<template>
    <Dialog v-model="offen" :titel="t('incoming.newTradeEvals')" breite="26rem" @zu="verworfen">
        <div class="te">
            <div class="te-glocke"><Symbol name="glocke" :groesse="22" /></div>

            <div v-if="oeffnung.anzahl > 0" class="te-block">
                <div class="te-zeile">
                    <span class="te-punkt akzent"></span>
                    <span>{{ oeffnung.anzahl }} {{ oeffnung.anzahl > 1 ? t('incoming.openingEvaluations') : t('incoming.openingEvaluation') }}</span>
                </div>
                <div class="te-broker">
                    <span v-for="(n, b) in oeffnung.jeBroker" :key="b" class="te-pille">{{ brokerName(b) }} <b>{{ n }}</b></span>
                </div>
            </div>

            <div v-if="schluss.anzahl > 0" class="te-block">
                <div class="te-zeile">
                    <span class="te-punkt warn"></span>
                    <span>{{ schluss.anzahl }} {{ schluss.anzahl > 1 ? t('incoming.closingEvaluations') : t('incoming.closingEvaluation') }}</span>
                </div>
                <div class="te-broker">
                    <span v-for="(n, b) in schluss.jeBroker" :key="b" class="te-pille">{{ brokerName(b) }} <b>{{ n }}</b></span>
                </div>
            </div>
        </div>
        <template #fuss>
            <Knopf art="haupt" symbol="pfeilRechts" class="te-knopf" @click="zuDenTrades">{{ t('incoming.goToPendingTrades') }}</Knopf>
        </template>
    </Dialog>
</template>

<style scoped>
.te {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
}

.te-glocke {
    display: inline-flex;
    align-self: center;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: var(--accent-flaeche);
    color: var(--accent);
}

.te-zeile {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: 600;
}

.te-punkt {
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 50%;
    flex: 0 0 auto;
}

.te-punkt.akzent { background: var(--accent); }
.te-punkt.warn { background: var(--warn); }

.te-broker {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin: 0.4rem 0 0 1.05rem;
}

.te-pille {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.15rem 0.6rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-pille);
    background: var(--panel-soft);
    color: var(--muted);
    font-size: 0.8rem;
}

.te-pille b {
    color: var(--text);
}

.te-knopf {
    width: 100%;
}
</style>
