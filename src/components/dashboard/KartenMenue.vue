<script setup>
/**
 * Karten-Menü: blendet einzelne Karten einer Seite aus und ein (Dashboard B.4,
 * Auswertung W.3). Der Zustand gehört der Seite (`verborgen`, eine Liste von
 * Schlüsseln); hier wird nur angezeigt und umgeschaltet.
 *
 * Ein Klick irgendwo ausserhalb schliesst das Menü — der Lauscher hängt am
 * Dokument und wird beim Aushängen wieder abgenommen.
 */
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import Symbol from '@/components/basis/Symbol.vue'

const props = defineProps({
    /** [{ schluessel, titel }] in Anzeigereihenfolge. */
    karten: { type: Array, required: true },
    /** Zweiter, abgesetzter Block (z. B. Tag-Gruppen der Auswertung). */
    weitere: { type: Array, default: () => [] },
    verborgen: { type: Array, required: true },
    /** Beschriftung neben dem Zahnrad; leer = nur das Symbol. */
    text: { type: String, default: '' },
})
const emit = defineEmits(['umschalten'])
const { t } = useI18n()

const offen = ref(false)
const bereich = ref(null)

function aussen(e) {
    if (offen.value && bereich.value && !bereich.value.contains(e.target)) offen.value = false
}
onMounted(() => document.addEventListener('click', aussen))
onBeforeUnmount(() => document.removeEventListener('click', aussen))

const sichtbar = (k) => !props.verborgen.includes(k)
</script>

<template>
    <div ref="bereich" class="km">
        <button type="button" class="km-knopf" :class="{ offen }" :aria-expanded="offen"
            :title="t('auswertung.visibleCards')" @click="offen = !offen">
            <Symbol name="einstellungen" />
            <span v-if="text">{{ text }}</span>
        </button>
        <div v-if="offen" class="km-liste" role="menu">
            <div class="km-titel">{{ t('auswertung.visibleCards') }}</div>
            <button v-for="k in karten" :key="k.schluessel" type="button" role="menuitemcheckbox"
                :aria-checked="sichtbar(k.schluessel)" class="km-zeile" @click="emit('umschalten', k.schluessel)">
                <span class="km-kasten" :class="{ an: sichtbar(k.schluessel) }">
                    <Symbol v-if="sichtbar(k.schluessel)" name="haken" :groesse="12" :strich="2.4" />
                </span>
                <span class="km-text">{{ k.titel }}</span>
            </button>
            <template v-if="weitere.length">
                <div class="km-trenner"></div>
                <button v-for="k in weitere" :key="k.schluessel" type="button" role="menuitemcheckbox"
                    :aria-checked="sichtbar(k.schluessel)" class="km-zeile" @click="emit('umschalten', k.schluessel)">
                    <span class="km-kasten" :class="{ an: sichtbar(k.schluessel) }">
                        <Symbol v-if="sichtbar(k.schluessel)" name="haken" :groesse="12" :strich="2.4" />
                    </span>
                    <span class="km-text">{{ k.titel }}</span>
                </button>
            </template>
        </div>
    </div>
</template>

<style scoped>
.km {
    position: relative;
    flex: 0 0 auto;
}

.km-knopf {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-knopf);
    background: var(--panel-soft);
    color: var(--muted);
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
}

.km-knopf:hover,
.km-knopf.offen {
    color: var(--text);
    border-color: var(--line-stark);
}

.km-liste {
    position: absolute;
    right: 0;
    top: calc(100% + 0.35rem);
    z-index: 20;
    width: max-content;
    min-width: 14rem;
    max-width: min(20rem, calc(100vw - 2rem));
    max-height: 70vh;
    overflow-y: auto;
    padding: 0.4rem;
    border: 1px solid var(--line-stark);
    border-radius: var(--radius-knopf);
    background: var(--panel);
    box-shadow: var(--schatten);
}

.km-titel {
    padding: 0.3rem 0.5rem 0.45rem;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
}

.km-zeile {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    width: 100%;
    padding: 0.38rem 0.5rem;
    border: none;
    border-radius: var(--radius-klein);
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 0.86rem;
    text-align: left;
    cursor: pointer;
}

.km-zeile:hover {
    background: var(--panel-soft);
}

.km-kasten {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1rem;
    height: 1rem;
    flex: 0 0 auto;
    border: 1px solid var(--line-stark);
    border-radius: 4px;
    color: var(--on-accent);
}

.km-kasten.an {
    background: var(--accent);
    border-color: var(--accent);
}

.km-text {
    min-width: 0;
    overflow-wrap: anywhere;
}

.km-trenner {
    margin: 0.35rem 0.4rem;
    border-top: 1px solid var(--line);
}
</style>
