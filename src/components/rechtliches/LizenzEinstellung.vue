<script setup>
/**
 * Einstellungen › Allgemein › Lizenz (Auftrag S10).
 *
 * Zeigt den Stand des Lizenzschlüssels (`server/lizenz.js`), nimmt einen neuen an und
 * öffnet den Dialog „Rechtliches". Eigene Komponente, weil `Settings.vue` in S9 zerlegt
 * wird — dort steht nur der Einhängepunkt.
 *
 * Der Schlüsseltext kommt nie zurück in die Oberfläche (er kann Zugangsdaten zur
 * Paketquelle tragen), nur der geprüfte Stand.
 */
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import Karte from '../basis/Karte.vue'
import Knopf from '../basis/Knopf.vue'
import Hinweis from '../basis/Hinweis.vue'
import Pille from '../basis/Pille.vue'
import Eingabe from '../basis/Eingabe.vue'
import { oeffneRechtliches } from '../../stores/rechtliches.js'

const { t } = useI18n()

const stand = ref(null)
const eingabe = ref('')
const fehler = ref('')
const beschaeftigt = ref(false)
const eingabeOffen = ref(false)

const tag = (iso) => (iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString('de-CH') : '–')

const modusText = computed(() => t('lizenz.modus_' + (stand.value?.modus || 'test')))
const pillenArt = computed(() => (stand.value?.modus === 'voll' ? 'gut' : 'warn'))

async function laden() {
    try {
        const { data } = await axios.get('/api/lizenz')
        stand.value = data
    } catch (e) {
        fehler.value = e.response?.data?.error || e.message
    }
}

async function speichern() {
    beschaeftigt.value = true
    fehler.value = ''
    try {
        const { data } = await axios.post('/api/lizenz', { schluessel: eingabe.value })
        stand.value = data
        eingabe.value = ''
        eingabeOffen.value = false
    } catch (e) {
        const code = e.response?.data?.fehler
        fehler.value = code ? t('lizenz.fehler_' + code) : (e.response?.data?.error || e.message)
    } finally {
        beschaeftigt.value = false
    }
}

async function entfernen() {
    if (!confirm(t('lizenz.entfernenFrage'))) return
    beschaeftigt.value = true
    try {
        const { data } = await axios.delete('/api/lizenz')
        stand.value = data
    } finally {
        beschaeftigt.value = false
    }
}

onMounted(laden)
</script>

<template>
    <Karte class="at-lizenz mb-4" :titel="t('lizenz.titel')">
        <template #aktionen>
            <Pille v-if="stand" :ton="pillenArt">{{ modusText }}</Pille>
        </template>

        <Hinweis art="warn" :titel="t('rechtliches.betaTitel')" class="mb-3">{{ t('rechtliches.betaText') }}</Hinweis>

        <dl v-if="stand && stand.modus !== 'test' && stand.modus !== 'ungueltig'" class="angaben">
            <dt>{{ t('lizenz.kaeufer') }}</dt><dd>{{ stand.kaeufer }}</dd>
            <dt>{{ t('lizenz.edition') }}</dt><dd>{{ t('lizenz.edition_' + stand.edition) }}</dd>
            <dt>{{ t('lizenz.nummer') }}</dt><dd>{{ stand.id }}</dd>
            <dt>{{ t('lizenz.updatesBis') }}</dt>
            <dd :class="{ abgelaufen: !stand.updatesAktiv }">
                {{ tag(stand.updatesBis) }}<span v-if="!stand.updatesAktiv"> · {{ t('lizenz.updatesAbgelaufen') }}</span>
            </dd>
            <template v-if="stand.gueltigBis"><dt>{{ t('lizenz.gueltigBis') }}</dt><dd>{{ tag(stand.gueltigBis) }}</dd></template>
        </dl>

        <p v-if="stand?.testmodus" class="leise">{{ t('lizenz.testmodusText') }}</p>
        <Hinweis v-if="stand?.modus === 'ungueltig'" art="fehler">{{ t('lizenz.fehler_' + (stand.fehler || 'format')) }}</Hinweis>

        <div v-if="eingabeOffen" class="eingabe">
            <Eingabe v-model="eingabe" art="mehrzeilig" :zeilen="4" :label="t('lizenz.eingabeLabel')"
                :hilfe="t('lizenz.eingabeHilfe')" :fehler="fehler" platzhalter="AT1.…" />
            <div class="knoepfe">
                <Knopf art="haupt" :disabled="!eingabe.trim()" :laedt="beschaeftigt" @click="speichern">{{ t('lizenz.speichern') }}</Knopf>
                <Knopf art="leise" @click="eingabeOffen = false; fehler = ''">{{ t('common.cancel') }}</Knopf>
            </div>
        </div>
        <div v-else class="knoepfe">
            <Knopf :art="stand?.modus === 'voll' ? 'normal' : 'haupt'" @click="eingabeOffen = true">
                {{ stand?.modus === 'voll' ? t('lizenz.ersetzen') : t('lizenz.eintragen') }}
            </Knopf>
            <Knopf v-if="stand && stand.modus !== 'test'" art="leise" :laedt="beschaeftigt" @click="entfernen">{{ t('lizenz.entfernen') }}</Knopf>
            <Knopf art="leise" @click="oeffneRechtliches()">{{ t('rechtliches.anzeigen') }}</Knopf>
        </div>
        <Hinweis v-if="fehler && !eingabeOffen" art="fehler" class="mt-2">{{ fehler }}</Hinweis>
    </Karte>
</template>

<style scoped>
.angaben {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.3rem 1rem;
    margin: 0 0 0.8rem;
    font-size: 0.92rem;
}

.angaben dt {
    color: var(--muted);
    font-weight: 400;
}

.angaben dd {
    margin: 0;
}

.abgelaufen {
    color: var(--warn);
}

.leise {
    color: var(--muted);
    font-size: 0.9rem;
}

.eingabe {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
}

.knoepfe {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
}
</style>
