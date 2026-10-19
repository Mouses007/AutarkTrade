<script setup>
/**
 * „Hier gibt es nichts, und zwar aus diesem Grund" — die Gegenstelle zu
 * `{ aus: true, grund, quelle, meldung, faehigkeit }` aus
 * `server/quellen/aus.js` bzw. `server/marktdaten/index.js`.
 *
 *   <QuelleAus v-if="daten?.aus" :aus="daten" />
 *
 * Gründe: schluesselFehlt (nur mit eigenem API-Schlüssel), entfernt (aus
 * Lizenzgründen nicht mehr angebunden), aus (abgeschaltet), marktdaten
 * (die gewählte Marktdatenquelle kann das nicht). Wo der Kunde etwas tun
 * kann, verlinkt der Kasten auf Einstellungen › Datenquellen.
 *
 * Bewusst KEIN Fehlerkasten: nichts ist kaputt, die Funktion ist aus.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import Symbol from '../basis/Symbol.vue'

const props = defineProps({
    aus: { type: Object, required: true },
    /** Klein für Kacheln (eine Zeile weniger Rand). */
    klein: { type: Boolean, default: false },
})

const { t, te } = useI18n()
const router = useRouter()

/*
 * Über den gemerkten Bereich statt über einen Pfadparameter: die
 * Einstellungsseite liest `settingsBereich` aus dem localStorage, mit und
 * ohne Route `/settings/:bereich`.
 */
function oeffneEinstellungen() {
    try { localStorage.setItem('settingsBereich', 'datenquellen') } catch (_) { /* privater Modus */ }
    router.push('/settings/datenquellen').catch(() => {})
}

const grund = computed(() => props.aus?.grund || 'aus')
const titel = computed(() => {
    const k = `datenquellen.aus.${grund.value}`
    return te(k) ? t(k, { quelle: props.aus?.quelle || '' }) : (props.aus?.meldung || '')
})
const text = computed(() => {
    if (grund.value === 'marktdaten') {
        const was = props.aus?.faehigkeit && te(`datenquellen.faehigkeit.${props.aus.faehigkeit}`)
            ? t(`datenquellen.faehigkeit.${props.aus.faehigkeit}`) : (props.aus?.faehigkeit || '')
        return props.aus?.quelle === 'aus'
            ? t('datenquellen.aus.marktdatenAusText', { was })
            : t('datenquellen.aus.marktdatenText', { was, quelle: props.aus?.quelleName || props.aus?.quelle || '' })
    }
    const k = `datenquellen.aus.${grund.value}Text`
    return te(k) ? t(k, { quelle: props.aus?.quelle || '' }) : ''
})
const zuEinstellungen = computed(() => ['schluesselFehlt', 'marktdaten', 'aus'].includes(grund.value))
</script>

<template>
    <div :class="['at-quelle-aus', { klein }]" role="status" data-quelle-aus :data-grund="grund">
        <Symbol name="info" :groesse="klein ? 16 : 18" class="zeichen" />
        <div class="text">
            <strong>{{ titel }}</strong>
            <span v-if="text">{{ text }}</span>
            <a v-if="zuEinstellungen" href="/settings" class="weiter" @click.prevent="oeffneEinstellungen">
                {{ t('datenquellen.aus.zuEinstellungen') }}
            </a>
        </div>
    </div>
</template>

<style scoped>
.at-quelle-aus {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    padding: 0.75rem 0.9rem;
    border: 1px dashed var(--line-stark);
    border-radius: var(--radius-knopf);
    color: var(--muted);
    font-size: 0.85rem;
    line-height: 1.45;
}

.at-quelle-aus.klein {
    padding: 0.5rem 0.65rem;
    font-size: 0.78rem;
}

.text {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
}

strong {
    color: var(--text);
    font-weight: 600;
}

.zeichen {
    color: var(--muted);
    flex: none;
    margin-top: 0.1rem;
}

.weiter {
    color: var(--accent);
    text-decoration: none;
    align-self: flex-start;
}

.weiter:hover {
    text-decoration: underline;
}
</style>
