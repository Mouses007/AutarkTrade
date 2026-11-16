<script setup>
/**
 * Verlauf und Eingabe eines KI-Coach-Gesprächs.
 *
 * Reine Darstellung: der Zustand kommt als `gespraech` aus
 * `useKiGespraech()`. Die Leiste und (in schmaler Form) andere Flächen
 * benutzen denselben Baustein, damit Werkzeugschritte, KI-Kennzeichnung und
 * Eingabe überall gleich aussehen.
 */
import { ref, computed, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { kiMarkdown } from '@/utils/kiMarkdown.js'
import { Symbol, Knopf, Kreisel, Hinweis } from '@/components/basis'
import { useSpracheingabe, erkennungsSprache, mikroTitelText, mikroFehlerText } from '@/composables/useSpracheingabe.js'
import { appEinstellungen } from '@/stores/settings.js'

const props = defineProps({
    gespraech: { type: Object, required: true },
    // false: Anbieter nicht erreichbar — Eingabe gesperrt
    bereit: { type: Boolean, default: true },
    platzhalter: { type: String, default: '' },
    // Fragen, die im leeren Gespräch als Knöpfe angeboten werden
    vorschlaege: { type: Array, default: () => [] },
})
const { t, te, locale } = useI18n()

const { nachrichten, schritte, eingabe, laeuft, fehler, sitzungId, sende } = props.gespraech
const offeneWerkzeuge = ref(new Set())
const listeEl = ref(null)

function schalteWerkzeug(i) {
    const s = new Set(offeneWerkzeuge.value)
    if (s.has(i)) s.delete(i)
    else s.add(i)
    offeneWerkzeuge.value = s
}

function parameterText(params) {
    if (!params) return ''
    return Object.entries(params).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(', ')
}

// Ans Ende rollen, sobald etwas dazukommt — sonst verschwindet die Antwort
// unter dem sichtbaren Bereich und man rollt nach jeder Frage von Hand nach.
watch([() => nachrichten.value.length, () => schritte.value.length, sitzungId, laeuft], async () => {
    await nextTick()
    if (listeEl.value) listeEl.value.scrollTop = listeEl.value.scrollHeight
})
watch(sitzungId, () => { offeneWerkzeuge.value = new Set() })

// ── Spracheingabe ──────────────────────────────────────────────────────────
// Was schon im Feld stand, bleibt stehen; das Gesprochene wird angehängt.
let vorAufnahme = ''
const sprache = useSpracheingabe({
    sprache: () => erkennungsSprache(locale.value),
    beiText: (text) => { eingabe.value = [vorAufnahme, text].filter(Boolean).join(' ') },
})
const mikroTitel = computed(() => mikroTitelText(sprache, t))
const mikroFehler = computed(() => mikroFehlerText(sprache.fehler.value, t, te))
// Wohin der Ton geht, hängt am gewählten Weg (Einstellungen › KI › Zugang › Spracheingabe).
const mikroHinweisText = computed(() => {
    const a = appEinstellungen.value?.spracheArt
    return a === 'openai' ? t('kiCoach.mikroHinweisOpenai') : a === 'eigen' ? t('kiCoach.mikroHinweisEigen') : t('kiCoach.mikroHinweis')
})
// Einmal sagen, wohin der Ton geht — danach nicht mehr.
const mikroHinweis = ref(false)
function schalteMikro() {
    if (sprache.grund.value) return
    if (!sprache.hoert.value) {
        vorAufnahme = eingabe.value.trim()
        let gesehen = '1'
        try { gesehen = localStorage.getItem('at.kiCoach.mikroHinweis') } catch { /* privater Modus */ }
        if (gesehen !== '1') {
            mikroHinweis.value = true
            try { localStorage.setItem('at.kiCoach.mikroHinweis', '1') } catch { /* egal */ }
        }
    }
    sprache.schalte()
}
function sendeEingabe() {
    sprache.stopp()
    mikroHinweis.value = false
    sende()
}
// Ein neues Gespräch oder ein laufender Abruf beendet die Aufnahme.
watch([sitzungId, laeuft], () => sprache.stopp())

function taste(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendeEingabe() }
}
</script>

<template>
    <div class="kiGespraech">
        <div ref="listeEl" class="verlauf">
            <div v-if="!nachrichten.length && !laeuft" class="leer">
                <Symbol name="ki" class="leerSymbol" />
                <p>{{ t('kiCoach.willkommen') }}</p>
                <Knopf v-for="v in vorschlaege" :key="v" klein class="vorschlag" :disabled="!bereit" @click="sende(v)">{{ v }}</Knopf>
            </div>

            <template v-for="(n, i) in nachrichten" :key="i">
                <div v-if="n.role === 'user'" class="chat-bubble chat-bubble-user">{{ n.content }}</div>

                <div v-else-if="n.role === 'tool'" class="werkzeugZeile">
                    <button type="button" class="werkzeugKopf" :aria-expanded="offeneWerkzeuge.has(i)" @click="schalteWerkzeug(i)">
                        <Symbol name="einstellungen" />
                        <span>{{ n.toolName }}</span>
                        <Symbol :name="offeneWerkzeuge.has(i) ? 'runter' : 'ausklappen'" />
                    </button>
                    <pre v-if="offeneWerkzeuge.has(i)" class="werkzeugInhalt">{{ n.content?.substring(0, 2000) }}</pre>
                </div>

                <div v-else-if="n.role === 'assistant'" class="chat-bubble chat-bubble-ai kiAntwort" data-ki-generiert="true"
                    v-html="kiMarkdown(n.content)"></div>
            </template>

            <div v-if="laeuft" class="laufend">
                <div v-for="(s, si) in schritte" :key="si" class="schritt">
                    <template v-if="s.type === 'tool_call'">
                        <Symbol name="einstellungen" />
                        <span>{{ s.name }}</span>
                        <span class="at-gedaempft">({{ parameterText(s.params) }})</span>
                    </template>
                    <template v-else-if="s.type === 'tool_result'">
                        <Symbol name="hakenKreis" class="at-gut" />
                        <span class="at-gut">{{ s.name }}: {{ s.resultPreview }}</span>
                    </template>
                    <template v-else-if="s.type === 'warning'">
                        <Symbol name="warnung" class="at-warn" />
                        <span class="at-warn">{{ s.content }}</span>
                    </template>
                </div>
                <div class="schritt">
                    <Kreisel still groesse="0.8rem" />
                    <span class="at-gedaempft">{{ t('kiCoach.arbeitet') }}</span>
                </div>
            </div>
        </div>

        <Hinweis v-if="fehler" art="fehler">{{ fehler }}</Hinweis>
        <Hinweis v-if="mikroFehler" art="warn">{{ mikroFehler }}</Hinweis>
        <small v-if="mikroHinweis" class="mikroHinweis">{{ mikroHinweisText }}</small>

        <div class="eingabeZeile">
            <textarea v-model="eingabe" class="at-feld klein" rows="2" :placeholder="platzhalter || t('kiCoach.platzhalter')"
                :disabled="laeuft || !bereit" @keydown="taste"></textarea>
            <div class="knoepfe">
                <button type="button" class="mikro" :class="{ hoert: sprache.hoert.value, arbeitet: sprache.arbeitet.value, aus: !!sprache.grund.value }"
                    :aria-pressed="sprache.hoert.value" :aria-disabled="!!sprache.grund.value || undefined"
                    :title="mikroTitel" :aria-label="mikroTitel" :disabled="laeuft || !bereit || sprache.arbeitet.value" @click="schalteMikro">
                    <Symbol name="mikrofon" />
                </button>
                <Knopf art="haupt" klein nur-symbol symbol="nachricht" :titel="t('kiCoach.senden')"
                    :disabled="laeuft || !bereit || !eingabe.trim()" @click="sendeEingabe" />
            </div>
        </div>
    </div>
</template>

<style scoped>
.kiGespraech {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-height: 0;
    flex: 1 1 auto;
}

.verlauf {
    flex: 1 1 auto;
    min-height: 3rem;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.leer {
    margin: auto 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
    color: var(--muted);
    text-align: center;
    padding: 1rem 0.5rem;
}

.leer p {
    margin: 0;
    font-size: 0.88rem;
}

.leerSymbol {
    font-size: 2.2rem;
    opacity: 0.35;
}

.vorschlag {
    width: 100%;
    justify-content: flex-start;
    text-align: left;
}

/* In der Leiste ist kein Platz für die breiten Ränder der Seiten-Blasen. */
.chat-bubble-user {
    margin-left: 12%;
}

.chat-bubble-ai {
    margin-right: 4%;
}

.kiAntwort :deep(h3),
.kiAntwort :deep(h4),
.kiAntwort :deep(h5) {
    font-size: 0.92rem;
    margin: 0.6rem 0 0.25rem;
    color: var(--text);
}

.kiAntwort :deep(p) {
    margin: 0 0 0.4rem;
}

.kiAntwort :deep(ul) {
    padding-left: 1.1rem;
    margin: 0 0 0.4rem;
}

.kiAntwort :deep(:last-child) {
    margin-bottom: 0;
}

.werkzeugZeile {
    border-left: 2px solid var(--line-stark);
    padding-left: 0.5rem;
    margin-left: 0.5rem;
}

.werkzeugKopf {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    font-size: 0.78rem;
    color: var(--muted);
    cursor: pointer;
}

.werkzeugInhalt {
    margin: 0.25rem 0 0;
    padding: 0.4rem;
    max-height: 200px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 0.72rem;
    color: var(--muted);
    background: var(--panel-soft);
    border-radius: var(--radius-klein);
}

.laufend {
    margin-left: 0.5rem;
    font-size: 0.78rem;
}

.schritt {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.1rem 0;
    color: var(--muted);
    overflow-wrap: anywhere;
}

.eingabeZeile {
    display: flex;
    gap: 0.4rem;
    align-items: flex-end;
    flex-shrink: 0;
}

.eingabeZeile textarea {
    resize: none;
    flex: 1 1 auto;
    min-width: 0;
}

.knoepfe {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
}

/* Mikrofon: gleiche Grösse wie der Senden-Knopf darunter. */
.mikro {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 2rem;
    min-width: 2.2rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-knopf);
    background: var(--panel-soft);
    color: var(--muted);
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s, background 0.15s;
}

.mikro:hover:not(:disabled):not(.aus) {
    color: var(--text);
    border-color: var(--accent-rand);
}

/* Nicht verfügbar (http, Firefox): sichtbar, aber ausgegraut — der Titel sagt warum. */
.mikro.aus,
.mikro:disabled {
    opacity: 0.45;
    cursor: not-allowed;
}

.mikro.hoert {
    color: var(--text);
    background: var(--bad-flaeche);
    border-color: var(--bad);
    animation: mikroPuls 1.2s ease-in-out infinite;
}

/* Server-Weg: Aufnahme ist unterwegs zur Umschrift */
.mikro.arbeitet {
    color: var(--accent);
    border-color: var(--accent);
    animation: mikroPuls 0.8s ease-in-out infinite;
}

@keyframes mikroPuls {
    50% { opacity: 0.6; }
}

@media (prefers-reduced-motion: reduce) {
    .mikro.hoert { animation: none; }
}

.mikroHinweis {
    color: var(--muted);
    font-size: 0.72rem;
}
</style>
