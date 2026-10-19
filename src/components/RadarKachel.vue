<script setup>
/**
 * Rahmen einer Marktradar-Kachel.
 *
 * Kümmert sich um alles, was jede Kachel gleich hat: Überschrift, Zustandspunkt,
 * Stand-Zeit, Griff zum Umsortieren, Lupe, Lade- und Fehlerzustand. Der Inhalt
 * kommt als Slot — die Kachel-Komponenten kennen dadurch weder Zustände noch
 * Bedienung, sie zeichnen nur.
 *
 * Seit S12 (Verkaufs-Prüfung) zwei Dinge mehr, beide hier statt in jeder
 * Kachel, damit Marktradar und Live-Trading sie gleich haben:
 *
 *   aus      `{ aus: true, grund, quelle, … }` vom Server → statt des Inhalts
 *            steht `QuelleAus` da (warum leer, und wo man es ändert).
 *   quellen  Herkunft und Pflicht-Attributionen (`[{ name, url, art }]`) als
 *            kleine Zeile unter dem Inhalt. Anbieter wie alternative.me
 *            verlangen die Quellenangabe „gut sichtbar direkt neben den
 *            Daten" — die Gross-Ansicht allein reicht dafür nicht.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import dayjs from '../utils/journal/zeit.js'
import InfoTipp from './InfoTipp.vue'
import Symbol from '@/components/basis/Symbol.vue'
import Kreisel from '@/components/basis/Kreisel.vue'
import Quellenhinweis from '@/components/basis/Quellenhinweis.vue'
import QuelleAus from '@/components/quellen/QuelleAus.vue'

const props = defineProps({
    titel: { type: String, required: true },
    /** Symbolname aus `components/basis/Symbol.vue`. */
    icon: { type: String, default: '' },
    /** 'idle' | 'loading' | 'ready' | 'veraltet' | 'error' */
    zustand: { type: String, default: 'idle' },
    /** Zeitpunkt der angezeigten Daten in ms, 0 = noch nichts */
    stand: { type: Number, default: 0 },
    fehler: { type: String, default: '' },
    /** Hat die Kachel Daten? Steuert, ob der Inhalt oder ein Platzhalter kommt. */
    hatDaten: { type: Boolean, default: false },
    /**
     * Kachel versorgt sich selbst (rechnet im Browser oder hängt an einem
     * eigenen Strom) und hat deshalb nie eine `daten`-Nutzlast. Ohne dieses
     * Kennzeichen bliebe sie für immer im Ladezustand stehen. Die Stand-Zeit
     * entfällt dann ebenfalls — „Stand 15:12" wäre bei einer Kachel, die
     * sekündlich selbst rechnet, eine Falschaussage.
     */
    eigenstaendig: { type: Boolean, default: false },
    /**
     * Der Inhalt wird bedient (geschoben, gezoomt, angetippt). Dann darf ein
     * Klick in den Körper NICHT die Gross-Ansicht öffnen — bei einem Canvas,
     * das man mit der Maus schiebt, wäre das unbenutzbar. Die Lupe entfällt
     * ebenfalls, denn eine zweite Instanz würde eine zweite Datenverbindung
     * aufbauen.
     */
    interaktiv: { type: Boolean, default: false },
    /**
     * Schlüssel des Erklärtexts (das kleine „i" neben dem Titel). Kommt aus
     * der Kachel-Registry, die ihn aus dem `titleKey` ableitet. Leer oder ohne
     * hinterlegten Text → kein Symbol, siehe `InfoTipp.vue`.
     */
    infoKey: { type: String, default: '' },
    /** Antwort `{ aus: true, … }`, wenn die Quelle abgeschaltet ist — sonst null. */
    aus: { type: Object, default: null },
    /** Aufgelöste Quellenliste (`loeseQuellen` in useKachelRaster.js). */
    quellen: { type: Array, default: () => [] },
})

const emit = defineEmits(['gross', 'neuladen', 'groesseStart', 'groesseZurueck'])

const { t } = useI18n()

/** Was in der kleinen Kachel steht: alles ausser Einträgen mit `klein: false`. */
const quellenKlein = computed(() => (props.quellen || []).filter(q => q && q.klein !== false))

const standText = computed(() => {
    if (props.aus) return ''
    if (!props.stand) return t('marktradar.never')
    return t('marktradar.asOf', { zeit: dayjs(props.stand).format('HH:mm') })
})
</script>

<template>
    <div class="radarCard" :class="{ 'radarCard--fehler': zustand === 'error' }">
        <div class="radarCardHead">
            <!-- Eigener Griff: auf dem Handy dürfen sich Ziehen und Antippen nicht beissen -->
            <span class="radarGriff" :title="t('marktradar.drag')"><Symbol name="ziehgriff" /></span>
            <Symbol v-if="icon" :name="icon" class="radarCardIcon" />
            <span class="radarCardTitle">{{ titel }}</span>
            <InfoTipp v-if="infoKey" :schluessel="infoKey" />
            <span :class="['liveDot', 'dot-' + zustand]" :title="t('marktradar.status_' + zustand)"></span>
            <!--
                Bedienung in der Kopfzeile. Nur für die paar Regler, die man
                WÄHREND des Handelns anfasst — alles Übrige gehört auf die
                eigene Seite, sonst ist die Zeile nach drei Kacheln zu.

                Die Kopfzeile IST der Ziehgriff (`cursor: grab`,
                `touch-action: none`). Ein Regler darin muss beides abfangen,
                sonst schiebt jeder Klick die Kachel durchs Raster statt den
                Wert zu ändern.
            -->
            <span v-if="$slots.steuerung" class="radarCardSteuerung"
                @pointerdown.stop @mousedown.stop @touchstart.stop @click.stop @dblclick.stop>
                <slot name="steuerung"></slot>
            </span>
            <span v-if="!eigenstaendig" class="radarCardStand">{{ standText }}</span>
            <span v-else class="radarCardStand"></span>
            <button type="button" class="radarCardBtn" :title="t('marktradar.refresh')" @click="emit('neuladen')">
                <Symbol name="aktualisieren" />
            </button>
            <button v-if="!interaktiv" type="button" class="radarCardBtn" :title="t('marktradar.enlarge')"
                @click="emit('gross')">
                <Symbol name="vergroessern" />
            </button>
        </div>

        <div class="radarCardBody" @click="!aus && !interaktiv && (hatDaten || eigenstaendig) && emit('gross')">
            <div v-if="aus" class="radarAus" @click.stop>
                <QuelleAus :aus="aus" klein />
            </div>

            <slot v-else-if="hatDaten || eigenstaendig"></slot>

            <div v-else-if="zustand === 'error'" class="radarLeer">
                <Symbol name="warnung" class="at-mu-1" />
                <span>{{ fehler || t('marktradar.status_error') }}</span>
                <button type="button" class="ctl-pill at-mo-2" @click.stop="emit('neuladen')">
                    {{ t('marktradar.retry') }}
                </button>
            </div>

            <div v-else class="radarLeer">
                <Kreisel />
            </div>
        </div>

        <!-- Herkunft und Pflicht-Attribution, immer sichtbar (nicht erst in der
             Gross-Ansicht). Auch bei `aus`: dann nennt die Zeile, woher die
             Daten kämen. -->
        <div v-if="quellenKlein.length" class="radarCardQuelle" @click.stop @pointerdown.stop>
            <Quellenhinweis :quellen="quellenKlein" class="at-m-0" />
        </div>

        <!-- Anfasser unten rechts: ziehen ändert Breite (in Rasterspalten) und
             Höhe, Doppelklick setzt auf die Vorgabe zurück. -->
        <span class="radarGroesse" :title="t('marktradar.resize')"
            @pointerdown.stop.prevent="emit('groesseStart', $event)"
            @dblclick.stop="emit('groesseZurueck')"></span>
    </div>
</template>

<style scoped>
.radarAus {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.5rem;
    cursor: default;
}

.radarCardQuelle {
    flex: 0 0 auto;
    /* Rechts Platz lassen für den Grössen-Anfasser in der Ecke */
    padding: 0 1.1rem 0.3rem 0.55rem;
    cursor: default;
}

.radarCardQuelle :deep(.at-quellenhinweis) {
    margin: 0;
    font-size: 0.66rem;
}

/* Kein Punkt-Farbcode für „aus" in design/kacheln.css — grau: weder gut noch kaputt */
:deep(.liveDot.dot-aus),
.liveDot.dot-aus {
    background: var(--muted);
}
</style>
