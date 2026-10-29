<script setup>
/**
 * Hinweis auf neue Trade-Bewertungen (Spezifikation ansichten.md X.1–X.4).
 *
 * Hängt im Rahmen, also auf jeder Seite ausser Setup und Update-Assistent.
 * `evalMeldungen` kommt vom Server (`utils/tradePopups.js`): was dort steht,
 * ist neu und noch nicht quittiert. Das Popup öffnet, sobald etwas darin steht
 * und die Seite es zulässt; es zeigt den aktuellen Stand der Liste, auch wenn
 * während es offen ist eine weitere Meldung dazukommt.
 *
 * Nicht geöffnet wird im Live-Trading-Cockpit (`?cockpit=1`) und auf
 * „Pendente Trades" selbst. Die Meldung bleibt dort offen und erscheint auf
 * der nächsten anderen Seite. Quittiert wird nur durch Schliessen (×, Esc,
 * Hintergrund) oder „Zu Pendente Trades" — ein Popup, das niemand gesehen
 * hat, verbraucht nichts.
 *
 * Nativer <dialog> über den Baustein `Dialog` (oberste Ebene: auch über dem
 * Chart-Vollbild sichtbar).
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { evalMeldungen } from '../stores/trades.js'
import { zusammenfassen, quittiereBewertungen, holeNeueBewertungen } from '../utils/tradePopups.js'
import Dialog from '@/components/basis/Dialog.vue'
import Knopf from '@/components/basis/Knopf.vue'
import Symbol from '@/components/basis/Symbol.vue'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

const offen = ref(false)

const stand = computed(() => zusammenfassen(evalMeldungen.value))
const oeffnung = computed(() => stand.value.oeffnung)
const schluss = computed(() => stand.value.schluss)

const NAMEN = { bitunix: 'Bitunix', bitget: 'Bitget', pionex: 'Pionex' }
function brokerName(b) {
    if (!b) return '—'
    return NAMEN[b] || b.charAt(0).toUpperCase() + b.slice(1)
}

const darfZeigen = computed(() => route.query?.cockpit !== '1' && route.path !== '/incoming')

/*
 * Schliesst das Programm (Liste leer, Seite gesperrt), meldet der Dialog
 * trotzdem `zu` — das darf nicht quittieren.
 */
let stillZu = false
function zuOhneQuittung() {
    if (!offen.value) return
    stillZu = true
    offen.value = false
}

watch([evalMeldungen, darfZeigen], () => {
    if (!evalMeldungen.value.length || !darfZeigen.value) zuOhneQuittung()
    else offen.value = true
}, { immediate: true })

// Von einer gesperrten Seite weg: erst nachfragen, ob noch alles offen ist
// (dort kann eben bewertet worden sein), dann öffnet der Watch oben.
watch(darfZeigen, (jetzt, vorher) => {
    if (jetzt && !vorher && evalMeldungen.value.length) holeNeueBewertungen()
})

/** Jede Art zu schliessen (×, Esc, Hintergrund) quittiert die gezeigten Meldungen. */
function verworfen() {
    if (stillZu) { stillZu = false; return }
    offen.value = false
    quittiereBewertungen(evalMeldungen.value)
}

function zuDenTrades() {
    quittiereBewertungen(evalMeldungen.value)
    zuOhneQuittung()
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
