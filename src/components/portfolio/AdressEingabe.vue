<script setup>
/**
 * Ein Feld für jede Adresse: einfügen, die Kette erkennt sich selbst.
 *
 * Beim Tippen prüft `erkenneEingabe` (geteilt mit dem Server) die Form und
 * sagt sofort, was es ist — „Bitcoin-Konto, Native SegWit", „EVM-Adresse".
 * Ein Seed oder privater Schlüssel wird rot abgelehnt und das Feld geleert:
 * er soll nicht einmal im Eingabefeld stehen bleiben.
 */
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import { erkenneEingabe, EVM_NETZE, EVM_VORGABE } from '../../../shared/portfolio-adresse.js'
import { Knopf, Symbol } from '../basis/index.js'

const props = defineProps({ walletId: { type: Number, required: true }, fokus: { type: Boolean, default: false } })
const emit = defineEmits(['fertig', 'abbrechen'])
const { t } = useI18n()

const eingabe = ref('')
const label = ref('')
const netze = ref([...EVM_VORGABE])
const fehler = ref('')
const speichert = ref(false)
const feld = ref(null)

const erkannt = computed(() => erkenneEingabe(eingabe.value))
watch(erkannt, (e) => {
    if (e.grund !== 'leer') fehler.value = ''
    if (!e.ok && e.grund === 'geheim') {
        // Nicht stehen lassen — auch nicht im Feld.
        fehler.value = e.text
        eingabe.value = ''
    }
})
onMounted(() => { if (props.fokus) nextTick(() => feld.value?.focus()) })

function schalteNetz(id) {
    netze.value = netze.value.includes(id) ? netze.value.filter((n) => n !== id) : [...netze.value, id]
}

async function speichere() {
    if (!erkannt.value.ok) return
    speichert.value = true
    fehler.value = ''
    try {
        await axios.post(`/api/portfolio/wallets/${props.walletId}/adressen`, { eingabe: eingabe.value.trim(), netze: netze.value, label: label.value })
        eingabe.value = ''
        label.value = ''
        emit('fertig')
    } catch (e) {
        fehler.value = e.response?.data?.error || e.message
    } finally {
        speichert.value = false
    }
}
</script>

<template>
    <div class="ae">
        <div class="ae-feld" :class="{ ok: erkannt.ok, nein: !erkannt.ok && erkannt.grund !== 'leer' }">
            <Symbol name="schluessel" :groesse="16" class="ae-symbol" />
            <input ref="feld" v-model.trim="eingabe" type="text" autocomplete="off" spellcheck="false"
                :placeholder="t('portfolio.adressePlatzhalter')" @keydown.enter="speichere" @keydown.esc="emit('abbrechen')" />
        </div>
        <div v-if="fehler" class="ae-meldung schlecht"><Symbol name="schildWarnung" :groesse="15" />{{ fehler }}</div>
        <div v-else-if="erkannt.grund !== 'leer'" class="ae-meldung" :class="erkannt.ok ? 'gut' : 'schlecht'">
            <Symbol :name="erkannt.ok ? 'hakenKreis' : 'info'" :groesse="15" />{{ erkannt.text }}
        </div>
        <div v-else class="ae-meldung leise">{{ t('portfolio.adresseHilfe') }}</div>

        <div v-if="erkannt.ok && erkannt.kette === 'evm'" class="ae-netze">
            <span class="ae-netze-titel">{{ t('portfolio.netze') }}</span>
            <button v-for="n in EVM_NETZE" :key="n.id" type="button" class="ae-netz" :class="{ an: netze.includes(n.id) }" @click="schalteNetz(n.id)">
                {{ n.name }}
            </button>
        </div>

        <div v-if="erkannt.ok" class="ae-unten">
            <input v-model="label" type="text" maxlength="40" class="ae-label" :placeholder="t('portfolio.labelPlatzhalter')" />
            <Knopf art="haupt" klein symbol="plus" :laedt="speichert" :disabled="erkannt.kette === 'evm' && !netze.length" @click="speichere">{{ t('portfolio.hinzufuegen') }}</Knopf>
            <Knopf art="leise" klein @click="emit('abbrechen')">{{ t('common.cancel') }}</Knopf>
        </div>
        <div v-else class="ae-unten">
            <Knopf art="leise" klein @click="emit('abbrechen')">{{ t('common.cancel') }}</Knopf>
        </div>
    </div>
</template>

<style scoped>
.ae { padding: 0.75rem; border: 1px dashed var(--line-stark); border-radius: var(--radius-knopf); margin-top: 0.5rem; background: var(--panel-soft); }
.ae-feld { display: flex; align-items: center; gap: 0.5rem; background: var(--bg); border: 1px solid var(--line-stark); border-radius: var(--radius-knopf); padding: 0 0.6rem; transition: border-color 0.2s; }
.ae-feld.ok { border-color: var(--accent); }
.ae-feld.nein { border-color: var(--warn); }
.ae-feld input { flex: 1; background: none; border: 0; outline: none; color: var(--text); font-family: var(--schrift-mono); font-size: 0.85rem; padding: 0.6rem 0; min-width: 0; }
.ae-symbol { color: var(--leise); }
.ae-meldung { font-size: 0.8rem; margin-top: 0.4rem; display: flex; gap: 0.35rem; align-items: center; }
.ae-meldung.gut { color: var(--accent); }
.ae-meldung.schlecht { color: var(--warn); }
.ae-meldung.leise { color: var(--leise); }
.ae-netze { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-top: 0.6rem; align-items: center; }
.ae-netze-titel { font-size: 0.75rem; color: var(--leise); margin-right: 0.25rem; }
.ae-netz { border: 1px solid var(--line-stark); background: none; color: var(--muted); border-radius: var(--radius-pille); padding: 0.15rem 0.6rem; font: inherit; font-size: 0.75rem; cursor: pointer; }
.ae-netz.an { border-color: var(--accent); color: var(--accent); background: var(--accent-flaeche); }
.ae-unten { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.6rem; align-items: center; }
.ae-label { flex: 1 1 10rem; background: var(--bg); border: 1px solid var(--line-stark); border-radius: var(--radius-knopf); color: var(--text); padding: 0.35rem 0.6rem; font: inherit; font-size: 0.85rem; }
</style>
