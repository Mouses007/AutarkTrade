<script setup>
/**
 * Anbieter- und Modellwahl für EINE KI-Funktion.
 *
 * Vorher stand dieses Paar dreimal ausgeschrieben in den Einstellungen
 * (global, Lagebericht, Share-Karten) — und wäre mit der Wahl je Funktion auf
 * sechs angewachsen. Die Listen kamen dabei aus derselben Quelle, aber die
 * Sonderfälle nicht: Der Lagebericht zeigte gespeicherte Modelle, die der
 * Katalog nicht mehr führt, gar nicht mehr an, und ein Speichervorgang hätte
 * die Einstellung stillschweigend gelöscht.
 *
 * Leere Wahl heisst „nimm den global eingestellten Anbieter". Damit das nicht
 * geraten werden muss, steht der tatsächlich greifende Stand als Text daneben.
 */
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { kiAnbieter, ladeKiAnbieter, anbieterAnzeige } from '../utils/kiAnbieter.js'

const { t } = useI18n()

/*
 * Anzeigename und Pflichthinweis kommen aus dem Anbieter-Verzeichnis des
 * Servers (S12): vorher stand hier die rohe ID — „deepseek" auch dann noch,
 * als der Eintrag längst ein neutraler Endpunkt war.
 */
onMounted(ladeKiAnbieter)
const nameVon = (id) => anbieterAnzeige(id, t)
const hinweis = computed(() => {
    const id = props.provider
    const k = id ? kiAnbieter.value[id]?.hinweis : ''
    return k ? t(k) : ''
})
/** Gespeichert, aber nicht mehr angeboten (z. B. MiniMax): bleibt sichtbar statt leer. */
const ausgeblendet = computed(() => !!props.provider && !anbieter.value.includes(props.provider)
    && !props.extra.some((e) => e.wert === props.provider))

const props = defineProps({
    /** Gewählter Anbieter, '' = global */
    provider: { type: String, default: '' },
    /** Gewähltes Modell, '' = Standard des Anbieters */
    modell: { type: String, default: '' },
    /** Modell-Listen je Anbieter, wie sie `/api/ai/models` liefert */
    modellListen: { type: Object, default: () => ({}) },
    /** Was gilt, wenn nichts gewählt ist — nur zur Anzeige */
    globalProvider: { type: String, default: '' },
    globalModell: { type: String, default: '' },
    /** false blendet den „Global"-Eintrag aus (für die globale Wahl selbst) */
    erlaubeGlobal: { type: Boolean, default: true },
    /** Beschriftung des leeren Eintrags (Vorgabe „Globaler Anbieter") */
    leerText: { type: String, default: '' },
    /**
     * Weitere Einträge ohne eigenen Anbieter, je {wert, text, provider, modell}:
     * gewählt wie „leer", mit eigenem „gilt"-Stand (z. B. `allgemein` bei der
     * Zwischenmeldung, deren Leer-Eintrag „wie der Bericht" heisst).
     */
    extra: { type: Array, default: () => [] },
    disabled: { type: Boolean, default: false },
})

const emit = defineEmits(['update:provider', 'update:modell'])

const anbieter = computed(() => Object.keys(props.modellListen))

/** Gewählter Extra-Eintrag (dann kein eigener Anbieter, Modell gesperrt). */
const extraWahl = computed(() => props.extra.find((e) => e.wert === props.provider) || null)
/** Kein eigener Anbieter gewählt — leer oder ein Extra-Eintrag. */
const ohneEigenen = computed(() => (!props.provider && props.erlaubeGlobal) || !!extraWahl.value)

/**
 * Modelle des gewählten Anbieters. Ein gespeichertes Modell, das der Katalog
 * nicht (mehr) führt, bleibt vorne in der Liste — sonst stünde das Feld leer
 * da und der nächste Speichervorgang hätte die Einstellung gelöscht.
 */
const modelle = computed(() => {
    const liste = props.modellListen[props.provider] || []
    if (props.modell && !liste.includes(props.modell)) return [props.modell, ...liste]
    return liste
})

function setzeAnbieter(wert) {
    emit('update:provider', wert)
    // Modell mitziehen: ein Modellname aus einem anderen Haus wäre bei jedem
    // Aufruf ein 404. Leer lassen heisst „Standard des neuen Anbieters".
    emit('update:modell', '')
}
</script>

<template>
    <div class="at-flex at-luecke-2 at-umbruch at-mitte">
        <select class="at-feld klein" style="max-width:12rem;" :disabled="disabled"
            :value="provider" @change="setzeAnbieter($event.target.value)">
            <option v-if="erlaubeGlobal" value="">{{ leerText || t('settings.ki.useGlobal') }}</option>
            <option v-for="e in extra" :key="e.wert" :value="e.wert">{{ e.text }}</option>
            <option v-for="a in anbieter" :key="a" :value="a">{{ nameVon(a) }}</option>
            <option v-if="ausgeblendet" :value="provider">{{ nameVon(provider) }} ({{ t('settings.providerRetired') }})</option>
        </select>

        <select class="at-feld klein" style="max-width:16rem;"
            :disabled="disabled || ohneEigenen"
            :value="modell" @change="emit('update:modell', $event.target.value)">
            <option value="">{{ t('settings.ki.defaultModel') }}</option>
            <option v-for="m in modelle" :key="m" :value="m">{{ m }}</option>
        </select>

        <!-- Was tatsächlich greift. Ohne diese Zeile ist „Global" eine
             Behauptung, die man nur durch Ausprobieren prüfen kann. -->
        <small v-if="ohneEigenen" class="at-gedaempft">
            {{ t('settings.ki.currentlyGlobal', {
                anbieter: (extraWahl ? extraWahl.provider : globalProvider) ? nameVon(extraWahl ? extraWahl.provider : globalProvider) : '—',
                modell: (extraWahl ? extraWahl.modell : globalModell) || t('settings.ki.defaultModel'),
            }) }}
        </small>
        <!-- Pflichthinweis des gewählten Anbieters (server/ai-models.js `hinweis`). -->
        <small v-if="hinweis" class="at-gedaempft" style="flex-basis:100%;">{{ hinweis }}</small>
    </div>
</template>
