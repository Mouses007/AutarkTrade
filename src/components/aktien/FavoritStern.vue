<script setup>
/**
 * Stern einer Aktie: auf die Merkliste setzen oder davon nehmen
 * (`stores/aktienFavoriten.js`). Eine Merkliste, kein Kaufsignal.
 */
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import Symbol from '../basis/Symbol.vue'
import { ladeAktienFavoriten, istAktienFavorit, schalteAktienFavorit } from '../../stores/aktienFavoriten.js'

const props = defineProps({
    ticker: { type: String, required: true },
    // Mit Beschriftung daneben (Titel-Seite) statt nur als Zeichen (Tabellen)
    mitText: { type: Boolean, default: false },
})
const emit = defineEmits(['fehler'])
const { t } = useI18n()

const an = computed(() => istAktienFavorit(props.ticker))
const titel = computed(() => t(an.value ? 'favoriten.entfernenTitel' : 'favoriten.hinzuTitel', { ticker: props.ticker }))
const laeuft = ref(false)

async function schalte() {
    if (laeuft.value) return
    laeuft.value = true
    try {
        await schalteAktienFavorit(props.ticker)
    } catch (e) {
        const grund = e?.response?.data?.grund
        emit('fehler', grund === 'voll' ? t('favoriten.voll', { max: e.response.data.max })
            : grund === 'nichtImStamm' ? t('favoriten.nichtImStammFehler', { ticker: props.ticker })
                : t('favoriten.schaltFehler', { fehler: e?.response?.data?.error || e.message }))
    } finally {
        laeuft.value = false
    }
}

onMounted(() => ladeAktienFavoriten())
</script>

<template>
    <button type="button" :class="['stern', { an, mitText }]" :aria-pressed="an ? 'true' : 'false'" :aria-label="titel" :title="titel"
        :disabled="laeuft" @click.stop="schalte">
        <Symbol name="stern" :gefuellt="an" />
        <span v-if="mitText">{{ t(an ? 'favoriten.istFavorit' : 'favoriten.merken') }}</span>
    </button>
</template>

<style scoped>
.stern {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.1rem;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: 0.86rem;
    line-height: 1;
    cursor: pointer;
}

.stern:hover,
.stern.an {
    color: var(--accent);
}

.stern:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
}

.stern.mitText {
    padding: 0.35rem 0.6rem;
    border: 1px solid var(--line);
}

.stern:disabled {
    opacity: 0.6;
    cursor: progress;
}
</style>
