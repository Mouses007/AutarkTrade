<script setup>
/**
 * Gemeinsamer Onboarding-Schritt-Satz (Standardeinstellungen/KI/News/Mail) —
 * läuft sowohl nach dem Setup-Wizard (`kontext: 'setup'`) als auch als
 * eigenständiger Update-Assistent (`kontext: 'update'`) und manuell über
 * Einstellungen (`kontext: 'manuell'`). Der Kontext steuert nur den
 * Einleitungstext, der Ablauf ist identisch.
 *
 * "Fertig" und "Später" verhalten sich bewusst GLEICH: beide übernehmen die
 * bis dahin gemachten Angaben aus allen Schritten und markieren die aktuelle
 * Version als gesehen. "Später" ist kein Verwerfen — News und Mail speichern
 * ohnehin schon bei jeder Aktion sofort serverseitig; würde "Später" nur
 * diese beiden behalten und Standardeinstellungen/KI-Zugang stillschweigend
 * verwerfen, verlöre ein Nutzer ohne jeden Hinweis genau die Hälfte seiner
 * Eingaben, je nachdem auf welchem Schritt er den Assistenten verlässt.
 *
 * Ein Fehlschlag beim Übernehmen (z.B. eine vom Server abgelehnte KI-Adresse)
 * bricht den Abschluss ab, statt den Assistenten trotzdem als erledigt zu
 * markieren und die Eingabe wegzuleiten — der Nutzer bleibt auf der Seite und
 * sieht, was schiefging.
 *
 * Danach folgt ein HARTER Reload — wie Setup.vue es bereits tut — damit der
 * Router-Cache (`updateAssistantPending`) neu geholt wird statt in eine
 * Redirect-Schleife zu laufen.
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import SchrittStandardeinstellungen from './SchrittStandardeinstellungen.vue'
import SchrittKiZugang from './SchrittKiZugang.vue'
import SchrittNewsQuellen from './SchrittNewsQuellen.vue'
import SchrittMailKonfiguration from './SchrittMailKonfiguration.vue'
import Knopf from '../basis/Knopf.vue'
import Symbol from '../basis/Symbol.vue'
import Hinweis from '../basis/Hinweis.vue'
import { internerPfad } from '../../utils/interneAdresse.js'

const props = defineProps({
    kontext: { type: String, default: 'manuell' }, // 'setup' | 'update' | 'manuell'
    rueckkehrPfad: { type: String, default: '/journal' },
})

const { t } = useI18n()

const SCHRITTE = 4
const schritt = ref(1)
const beendet = ref(false)
const fehler = ref('')

const standardRef = ref(null)
const kiRef = ref(null)
const mailRef = ref(null)

function weiter() {
    if (schritt.value < SCHRITTE) schritt.value += 1
    else beenden()
}

function zurueck() {
    if (schritt.value > 1) schritt.value -= 1
}

async function beenden() {
    if (beendet.value) return
    beendet.value = true
    fehler.value = ''
    try {
        standardRef.value?.uebernehmen()
        await Promise.all([
            kiRef.value?.uebernehmen(),
            mailRef.value?.uebernehmen(),
            axios.post('/api/setup/update-assistent/gesehen'),
        ])
    } catch (e) {
        beendet.value = false
        fehler.value = e.response?.data?.error || e.message || t('onboarding.saveError')
        return
    }
    // Zweite Sperre (Audit SEC-WEB-003): auch ein künftiger Aufrufer kann hier
    // keine fremde Adresse durchreichen.
    window.location.href = internerPfad(props.rueckkehrPfad, window.location.origin) || '/journal'
}
</script>

<template>
    <div class="onboarding-card">
        <div class="onboarding-header">
            <h2>{{ t(`onboarding.intro.${kontext}Title`) }}</h2>
            <p class="at-gedaempft at-mu-0">{{ t(`onboarding.intro.${kontext}Text`) }}</p>
            <div class="step-indicator at-mo-3">
                <div v-for="n in SCHRITTE" :key="n" class="step-dot"
                    :class="{ active: schritt >= n, done: schritt > n }">{{ n }}</div>
            </div>
        </div>

        <div class="onboarding-body">
            <SchrittStandardeinstellungen v-show="schritt === 1" ref="standardRef" />
            <SchrittKiZugang v-show="schritt === 2" ref="kiRef" />
            <div v-show="schritt === 3" class="onboarding-schritt">
                <h3>{{ t('onboarding.news.title') }}</h3>
                <p class="at-gedaempft">{{ t('onboarding.news.intro') }}</p>
                <SchrittNewsQuellen />
            </div>
            <div v-show="schritt === 4" class="onboarding-schritt">
                <h3>{{ t('onboarding.mail.title') }}</h3>
                <p class="at-gedaempft">{{ t('onboarding.mail.intro') }}</p>
                <SchrittMailKonfiguration ref="mailRef" />
            </div>

            <Hinweis v-if="fehler" art="fehler" class="at-mu-3">{{ fehler }}</Hinweis>

            <div class="at-flex at-luecke-2 at-mo-4">
                <Knopf v-if="schritt > 1" symbol="pfeilLinks" @click="zurueck">{{ t('common.back') }}</Knopf>
                <Knopf art="haupt" class="at-wachsen" :disabled="beendet" @click="weiter">
                    {{ schritt < SCHRITTE ? t('common.next') : t('onboarding.finish') }}
                    <Symbol name="pfeilRechts" />
                </Knopf>
            </div>
            <p class="at-mo-3 at-mu-0 at-mittig">
                <Knopf art="leise" klein :disabled="beendet" @click="beenden">
                    {{ t('onboarding.later') }}
                </Knopf>
            </p>
        </div>
    </div>
</template>

<style scoped>
.onboarding-card {
    background: var(--panel);
    border-radius: var(--radius);
    border: 1px solid var(--line);
    max-width: 620px;
    width: 100%;
    overflow: hidden;
}

.onboarding-header {
    text-align: center;
    padding: 2rem 2rem 1rem;
    border-bottom: 1px solid var(--line);
}

.onboarding-header h2 {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--text);
    margin-bottom: 0.5rem;
}

.step-indicator {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
}

.step-dot {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.7rem;
    font-weight: 600;
    border: 2px solid var(--line-stark);
    color: var(--leise);
}

.step-dot.active {
    border-color: var(--accent);
    color: var(--accent);
    background: var(--accent-flaeche);
}

.step-dot.done {
    border-color: var(--good);
    color: var(--good);
    background: var(--good-flaeche);
}

.onboarding-body {
    padding: 2rem;
}

@media (max-width: 575px) {
    .onboarding-header {
        padding: 1.5rem 1rem 1rem;
    }

    .onboarding-body {
        padding: 1.25rem 1rem;
    }
}

.onboarding-schritt h3 {
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--text);
    margin-bottom: 0.5rem;
}
</style>
