<script setup>
/**
 * Datenquellen › Kerzen für Exkursionen: Polygon- und Databento-Schlüssel
 * (`settings.apis`, Liste {provider, key}).
 *
 * Die Exkursionen (MFE-Preise) brauchen Minutenkerzen und verwiesen auf ein
 * Feld, das es in keiner Einstellungsseite mehr gab. Die Schlüssel verlassen
 * den Server nie: Er liefert nur `keySet`, verschlüsselt beim Speichern und
 * ruft selbst ab (`server/databento-api.js`, `polygon-api.js`). Ein leeres
 * Feld beim Speichern behält den gespeicherten Schlüssel
 * (`apisZusammenfuehren`); gelöscht wird, indem der Eintrag wegfällt.
 */
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Knopf, Hinweis, Pille } from '@/components/basis/index.js'
import Abschnitt from '../gemeinsam/Abschnitt.vue'
import { apis } from '@/stores/app/einstellungen.js'
import { appEinstellungen } from '@/stores/settings.js'
import { dbUpdateSettings } from '@/utils/db.js'

const { t } = useI18n()

const ANBIETER = [
    { id: 'polygon', name: 'Polygon.io', url: 'https://polygon.io/dashboard/keys' },
    { id: 'databento', name: 'Databento', url: 'https://databento.com/portal/keys' },
]

/** Was der Server zuletzt geliefert hat (ohne Schlüssel, nur `keySet`). */
const liste = computed(() => {
    const roh = appEinstellungen.value?.apis
    return Array.isArray(roh) ? roh : (apis.length ? [...apis] : [])
})
const hinterlegt = (id) => liste.value.some((a) => a?.provider === id && (a.keySet || a.key))

const eingabe = ref({ polygon: '', databento: '' })
const laeuft = ref('')
const meldung = ref(null)   // { art, text }

/** Liste an den Server: Eintrag ersetzen/anlegen (mit Schlüssel) oder entfernen (null). */
async function schreibe(id, schluessel) {
    laeuft.value = id
    meldung.value = null
    try {
        const ohneKey = liste.value.filter((a) => a && typeof a === 'object')
            .map(({ key, keySet, ...rest }) => rest)
        const neu = ohneKey.filter((a) => a.provider !== id)
        if (schluessel !== null) {
            const alt = ohneKey.find((a) => a.provider === id) || { provider: id }
            neu.push({ ...alt, key: schluessel })
        }
        const antwort = await dbUpdateSettings({ apis: neu })
        const gespeichert = Array.isArray(antwort?.apis) ? antwort.apis : []
        if (appEinstellungen.value) appEinstellungen.value.apis = gespeichert
        apis.length = 0
        for (const a of gespeichert) apis.push(a)
        eingabe.value[id] = ''
        meldung.value = { art: 'gut', text: t(schluessel === null ? 'datenquellen.kerzen.geloescht' : 'common.saved') }
    } catch (e) {
        meldung.value = { art: 'fehler', text: e?.response?.data?.error || e.message }
    } finally {
        laeuft.value = ''
    }
}
</script>

<template>
    <Abschnitt kennung="kerzen-schluessel" :titel="t('datenquellen.kerzen.titel')" symbol="schluessel">
        <p class="leise">{{ t('datenquellen.kerzen.unter') }}</p>
        <div v-for="a in ANBIETER" :key="a.id" class="anbieter">
            <p class="status">
                <strong>{{ a.name }}</strong>
                <Pille v-if="hinterlegt(a.id)" ton="gut">{{ t('datenquellen.kerzen.hinterlegt') }}</Pille>
                <Pille v-else ton="neutral">{{ t('datenquellen.kerzen.keiner') }}</Pille>
            </p>
            <div class="zeile">
                <input v-model="eingabe[a.id]" class="at-feld" type="password" autocomplete="off"
                    :aria-label="t('datenquellen.kerzen.schluessel', { name: a.name })"
                    :placeholder="hinterlegt(a.id) ? '••••••••' : t('datenquellen.kerzen.schluessel', { name: a.name })">
                <Knopf art="haupt" :laedt="laeuft === a.id" :disabled="!eingabe[a.id].trim() || !!laeuft"
                    @click="schreibe(a.id, eingabe[a.id].trim())">{{ t('common.save') }}</Knopf>
                <Knopf v-if="hinterlegt(a.id)" art="gefahr" :disabled="!!laeuft" @click="schreibe(a.id, null)">
                    {{ t('common.delete') }}
                </Knopf>
                <a class="extern" :href="a.url" target="_blank" rel="noopener noreferrer">{{ t('datenquellen.kerzen.holen') }}</a>
            </div>
        </div>
        <Hinweis v-if="meldung" :art="meldung.art">{{ meldung.text }}</Hinweis>
    </Abschnitt>
</template>

<style scoped>
.leise {
    font-size: 0.8rem;
    color: var(--muted);
    margin: 0 0 0.6rem;
    line-height: 1.45;
}
.anbieter { margin-top: 0.8rem; }
.status {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin: 0 0 0.35rem;
}
.zeile {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
}
.zeile input { flex: 1 1 16rem; min-width: 0; }
.extern {
    color: var(--accent);
    font-size: 0.85rem;
    text-decoration: none;
}
.extern:hover { text-decoration: underline; }
</style>
