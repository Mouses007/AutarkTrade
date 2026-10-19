<script setup>
/**
 * Pflichtlabel an jedem KI-Ergebnis: „KI-generiert – keine Anlageberatung –
 * Fakten prüfen“ (Verkaufs-Prüfung Massnahme 9, EU AI Act Art. 50).
 *
 *   <KiHinweis :anbieter="daten.provider" :modell="daten.model" />
 *   <KiHinweis klein />                       (Kachel, Chat-Blase)
 *
 * Warum ein eigener Baustein und nicht `Quellenhinweis` mit `art: 'ki'`:
 * jener nennt nur Herkunft („KI-generiert · Claude“); hier steht eine
 * Pflichtaussage in festem Wortlaut, die nicht mit Datenquellen zu einer
 * Zeile zusammenfallen darf. Optik und Zeichen sind dieselben, damit beide
 * nebeneinander wie ein System aussehen.
 *
 * Maschinenlesbar: das Element trägt `data-ki-generiert="true"`. Der
 * Container des KI-Textes trägt dasselbe Attribut an der Fundstelle — dieses
 * hier markiert zusätzlich das Label selbst, damit ein Werkzeug, das nur die
 * Fussnote findet, nicht rät.
 *
 * Anbieter und Modell dürfen genannt werden (als Text), Anbieter-Logos nie —
 * die Anbieter verbieten ihre Marken ohne Zustimmung (2.8).
 *
 * Nie ausblendbar, auch nicht über `erweiterteInfos`: eine Kennzeichnung, die
 * man abschalten kann, ist keine.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Symbol from '../basis/Symbol.vue'

const props = defineProps({
    /** Anbieter-ID oder -Name (z. B. 'anthropic'); leer = nicht nennen. */
    anbieter: { type: String, default: '' },
    /** Modellkennung (z. B. 'claude-sonnet-5-5'); leer = nicht nennen. */
    modell: { type: String, default: '' },
    /** Kleinere Schrift, kein oberer Abstand — für Kacheln und Chat-Blasen. */
    klein: { type: Boolean, default: false },
    /** Rechtsbündig (unter Diagrammen). */
    rechts: { type: Boolean, default: false },
    /**
     * Inline in einer einzeiligen Leiste (Pult-Fuss, Kompakt-Zeile): eine
     * Spanne statt eines Absatzes, ohne Umbruch. Der Wortlaut bleibt voll —
     * gekürzt wäre es nicht mehr die Kennzeichnung.
     */
    zeile: { type: Boolean, default: false },
})

const { t } = useI18n()

/*
 * Neutrale Anzeige der internen ID `deepseek`: seit S12 ist das der zweite
 * OpenAI-kompatible Endpunkt. Den Markennamen zeigen wir nicht (89d).
 */
const NEUTRAL = { deepseek: 'kiHinweis.namen.endpunkt2', custom: 'kiHinweis.namen.endpunkt' }

const herkunft = computed(() => {
    const a = String(props.anbieter || '').trim()
    const name = NEUTRAL[a] ? t(NEUTRAL[a]) : a
    const m = String(props.modell || '').trim()
    // Das Modell eines neutralen Endpunkts heisst oft wie der Hersteller — dann nur der Endpunkt.
    const modell = NEUTRAL[a] ? '' : m
    return [name, modell].filter(Boolean).join(' · ')
})
</script>

<template>
    <component :is="zeile ? 'span' : 'p'" :class="['at-ki-hinweis', { klein, rechts, zeile }]"
        data-ki-generiert="true" role="note" :title="t('kiHinweis.titel')">
        <Symbol name="ki" class="zeichen" />
        <span class="label">{{ t('kiHinweis.label') }}</span>
        <span v-if="herkunft" class="herkunft">({{ herkunft }})</span>
    </component>
</template>

<style scoped>
.at-ki-hinweis {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.15rem 0.35rem;
    margin: 0.5rem 0 0;
    font-size: 0.72rem;
    line-height: 1.4;
    color: var(--muted);
}

.at-ki-hinweis.klein {
    margin-top: 0.25rem;
    font-size: 0.66rem;
}

.at-ki-hinweis.zeile {
    display: inline-flex;
    flex-wrap: nowrap;
    flex: none;
    margin: 0;
    font-size: 0.66rem;
    white-space: nowrap;
}

.at-ki-hinweis.rechts {
    justify-content: flex-end;
    text-align: right;
}

/* Die Kennzeichnung ist eine Aussage über den Text: Akzent wie im Quellenhinweis. */
.zeichen,
.label {
    color: var(--accent);
}

.herkunft {
    color: var(--leise);
}
</style>
