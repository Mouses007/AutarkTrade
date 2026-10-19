<script setup>
/**
 * Dialog „Rechtliches" (Auftrag S10, Muster AutarkDarts `Lizenzbedingungen.svelte`).
 *
 * Hängt einmal im Layout. Von sich aus erscheint er nur, wenn der Server `noetig`
 * meldet — beim ersten Start und bei jeder neuen Fassung von LICENSE
 * (`server/rechtliches.js`). Dann liegt er über jeder Seite, ohne Schliessen-Knopf
 * und ohne Esc, bis zugestimmt ist. Zum Nachlesen öffnen ihn Seitenmenü und
 * Einstellungen über `stores/rechtliches.js`; dann ist er schliessbar.
 *
 * Bewusst kein `basis/Dialog.vue`: der schliesst bei Esc und Klick daneben, und genau
 * das darf eine fällige Zustimmung nicht.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import Reiter from '../basis/Reiter.vue'
import Knopf from '../basis/Knopf.vue'
import Hinweis from '../basis/Hinweis.vue'
import Symbol from '../basis/Symbol.vue'
import { rechtlichesOffen, rechtlichesReiter } from '../../stores/rechtliches.js'

const { t } = useI18n()

const stand = ref(null)
const texte = ref({})
const gelesen = ref(false)
const fehler = ref('')
const beschaeftigt = ref(false)

const pflichtOffen = computed(() => !!stand.value?.noetig)
const sichtbar = computed(() => pflichtOffen.value || rechtlichesOffen.value)
const fassung = computed(() => stand.value?.fassung?.fassung || '')

const reiterListe = computed(() => [
    { id: 'lizenz', titel: t('rechtliches.reiterLizenz') },
    { id: 'hinweise', titel: t('rechtliches.reiterHinweise') },
    { id: 'drittsoftware', titel: t('rechtliches.reiterDrittsoftware') },
])

async function laden() {
    try {
        const { data } = await axios.get('/api/rechtliches')
        stand.value = data
    } catch {
        // Ein Server ohne die Route (älterer Stand) oder gerade stumm: nichts zeigen.
        stand.value = null
    }
}

async function zeigen(name) {
    rechtlichesReiter.value = name
    if (texte.value[name] !== undefined) return
    try {
        const { data } = await axios.get(`/api/rechtliches/text/${name}`, { responseType: 'text', transformResponse: (r) => r })
        texte.value = { ...texte.value, [name]: data }
    } catch (e) {
        texte.value = { ...texte.value, [name]: t('rechtliches.textFehler', { fehler: e.response?.data?.error || e.message }) }
    }
}

async function akzeptieren() {
    beschaeftigt.value = true
    fehler.value = ''
    try {
        const { data } = await axios.post('/api/rechtliches/akzeptieren', { fassung: fassung.value })
        stand.value = data
        rechtlichesOffen.value = false
        gelesen.value = false
    } catch (e) {
        fehler.value = e.response?.data?.error || e.message
        await laden()
    } finally {
        beschaeftigt.value = false
    }
}

function schliessen() {
    if (pflichtOffen.value) return
    rechtlichesOffen.value = false
}

function taste(e) {
    if (e.key === 'Escape') schliessen()
}

// Den Text erst holen, wenn der Dialog aufgeht — sonst lüde jede Seite ihn umsonst.
watch(sichtbar, (offen) => { if (offen) zeigen(rechtlichesReiter.value || 'lizenz') })
watch(rechtlichesReiter, (r) => { if (sichtbar.value) zeigen(r) })

onMounted(async () => {
    await laden()
    if (sichtbar.value) zeigen('lizenz')
})
</script>

<template>
    <Teleport to="body">
        <div v-if="sichtbar" class="at-rechtliches" role="dialog" aria-modal="true"
            aria-labelledby="rechtliches-titel" @keydown="taste" @click.self="schliessen">
            <div class="kasten">
                <header class="kopf">
                    <h2 id="rechtliches-titel">{{ t('rechtliches.titel') }}</h2>
                    <button v-if="!pflichtOffen" type="button" class="zu" :aria-label="t('rechtliches.schliessen')" @click="schliessen">
                        <Symbol name="schliessen" :groesse="18" />
                    </button>
                </header>

                <p v-if="pflichtOffen && !stand?.neueFassung" class="erklaerung">{{ t('rechtliches.erklaerung') }}</p>
                <Hinweis v-if="stand?.neueFassung" art="warn">
                    {{ t('rechtliches.neueFassung', { fassung, bisher: stand?.akzeptiert?.fassung || '–' }) }}
                </Hinweis>
                <Hinweis v-if="stand?.beta" art="warn" :titel="t('rechtliches.betaTitel')">
                    {{ t('rechtliches.betaText') }}
                </Hinweis>

                <Reiter :model-value="rechtlichesReiter" :reiter="reiterListe" @update:model-value="zeigen" />
                <div class="text" role="tabpanel" tabindex="0">{{ texte[rechtlichesReiter] ?? t('rechtliches.laedt') }}</div>

                <template v-if="pflichtOffen">
                    <label class="haken">
                        <input v-model="gelesen" type="checkbox">
                        <span>{{ t('rechtliches.zustimmung', { fassung }) }}</span>
                    </label>
                    <Hinweis v-if="fehler" art="fehler">{{ fehler }}</Hinweis>
                    <footer class="fuss">
                        <Knopf art="haupt" :disabled="!gelesen" :laedt="beschaeftigt" @click="akzeptieren">
                            {{ t('rechtliches.akzeptieren') }}
                        </Knopf>
                    </footer>
                </template>
                <footer v-else class="fuss">
                    <span v-if="stand?.akzeptiert" class="bestaetigt">
                        {{ t('rechtliches.bestaetigt', { fassung: stand.akzeptiert.fassung, tag: new Date(stand.akzeptiert.zeit).toLocaleDateString('de-CH') }) }}
                    </span>
                    <Knopf @click="schliessen">{{ t('rechtliches.schliessen') }}</Knopf>
                </footer>
            </div>
        </div>
    </Teleport>
</template>

<style scoped>
.at-rechtliches {
    position: fixed;
    inset: 0;
    z-index: 3000; /* über Bootstrap-Modals (1055) und dem Testbetrieb-Banner */
    display: grid;
    place-items: center;
    padding: 1rem;
    background: rgba(2, 4, 5, 0.78);
    backdrop-filter: blur(2px);
}

.kasten {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    width: min(48rem, 100%);
    max-height: calc(100dvh - 2rem);
    padding: 1.1rem 1.2rem;
    border: 1px solid var(--line-stark);
    border-radius: var(--radius);
    background: var(--panel);
    color: var(--text);
    box-shadow: var(--schatten);
}

.kopf {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
}

h2 {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 700;
}

.zu {
    display: inline-flex;
    padding: 0.35rem;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
}

.zu:hover {
    color: var(--text);
    background: var(--panel-soft);
}

.erklaerung {
    margin: 0;
    color: var(--muted);
    font-size: 0.93rem;
}

/* Die Texte sind als Klartext gesetzt (Absätze, eingerückte Ziffern) — so bleiben sie. */
.text {
    flex: 1 1 auto;
    min-height: 10rem;
    overflow-y: auto;
    padding: 0.8rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-knopf);
    background: var(--bg);
    font-family: var(--schrift-mono);
    font-size: 0.8rem;
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}

.haken {
    display: flex;
    gap: 0.6rem;
    align-items: flex-start;
    font-size: 0.93rem;
    cursor: pointer;
}

.haken input {
    flex: none;
    width: 1.15rem;
    height: 1.15rem;
    margin-top: 0.15rem;
    accent-color: var(--accent);
}

.fuss {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.75rem;
}

.bestaetigt {
    margin-right: auto;
    color: var(--muted);
    font-size: 0.85rem;
}
</style>
