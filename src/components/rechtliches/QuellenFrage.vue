<script setup>
/**
 * Einmalige Frage beim ersten Start einer NEUEN Installation (Rechtsaudit 10/2026,
 * B-2, Variante B): Sollen die Quellen ohne Freigabe laufen? Ihre Bedingungen
 * erlauben das automatische Abfragen nicht oder nur eingeschränkt — das soll der
 * Nutzer selbst entscheiden, statt es ab Werk eingeschaltet vorzufinden.
 *
 * Bis zur Antwort ist der Schalter aus (`server/database.js`, v33). Bestehende
 * Installationen gelten als gefragt und sehen diesen Dialog nie. Erscheint erst,
 * wenn der Haftungsausschluss bestätigt ist, und ohne Schliessen-Knopf: eine der
 * beiden Antworten ist nötig. Ändern geht später unter Einstellungen › Datenquellen.
 */
import { ref, computed, watch } from 'vue'
import axios from 'axios'
import { useI18n } from 'vue-i18n'
import { Dialog, Knopf } from '../basis'
import { rechtlichesGeladen, rechtlichesPflichtOffen } from '../../stores/rechtliches.js'

const { t } = useI18n()
const stand = ref(null)
const beschaeftigt = ref(false)
const fehler = ref('')

async function lade() {
    try { stand.value = (await axios.get('/api/quellen/ohne-freigabe')).data } catch { stand.value = null }
}
lade()

const offen = computed(() => !!stand.value && stand.value.gefragt === false
    && rechtlichesGeladen.value && !rechtlichesPflichtOffen.value)

// Nach der Zustimmung zum Haftungsausschluss frisch nachsehen
watch(rechtlichesPflichtOffen, (v, vorher) => { if (vorher && !v) lade() })

async function antworte(an) {
    beschaeftigt.value = true
    fehler.value = ''
    try {
        stand.value = (await axios.put('/api/quellen/ohne-freigabe', { an })).data
    } catch (e) {
        fehler.value = e.response?.data?.error || e.message
    } finally {
        beschaeftigt.value = false
    }
}
</script>

<template>
    <Dialog :model-value="offen" :titel="t('quellenFrage.titel')" breite="38rem" :aussen-schliesst="false">
        <p class="text">{{ t('quellenFrage.text') }}</p>
        <ul class="liste">
            <li v-for="q in stand?.quellen || []" :key="q.id"><strong>{{ q.name }}</strong> – {{ q.was }}</li>
        </ul>
        <p class="hinweis">{{ t('quellenFrage.hinweis') }}</p>
        <p v-if="fehler" class="fehler">{{ fehler }}</p>
        <template #fuss>
            <Knopf art="leise" :disabled="beschaeftigt" @click="antworte(false)">{{ t('quellenFrage.aus') }}</Knopf>
            <Knopf art="haupt" :disabled="beschaeftigt" @click="antworte(true)">{{ t('quellenFrage.an') }}</Knopf>
        </template>
    </Dialog>
</template>

<style scoped>
.text {
    margin: 0 0 10px;
    line-height: 1.5;
}

.liste {
    margin: 0 0 10px;
    padding-left: 18px;
    max-height: 38vh;
    overflow-y: auto;
    font-size: 12px;
    color: var(--muted);
}

.liste strong {
    color: var(--text);
    font-weight: 600;
}

.hinweis {
    margin: 0;
    font-size: 12px;
    color: var(--muted);
}

.fehler {
    margin: 8px 0 0;
    color: var(--bad);
}
</style>
