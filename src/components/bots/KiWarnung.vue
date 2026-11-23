<script>
// Ein Stand für alle Stellen (Bot-Karte und Planer): wer dort bestätigt, sieht die Warnung auch hier nicht mehr
import { ref } from 'vue'
const SCHLUESSEL = 'at.bots.kiWarnungOk'
const lies = () => { try { return localStorage.getItem(SCHLUESSEL) === '1' } catch { return false } }
const bestaetigt = ref(lies())
</script>

<script setup>
/**
 * Warnblock vor den KI-Vorschlägen (23.11.2026): mit einem Haken «gelesen und akzeptiert» bestätigt, danach
 * ausgeblendet — gemerkt je Browser (localStorage). Eine Zeile darunter holt ihn wieder hervor; die
 * Einwilligung der Bot-Steuerung (Dialog vor dem Senden) ist davon unberührt.
 */
import { useI18n } from 'vue-i18n'
import Hinweis from '@/components/basis/Hinweis.vue'

const { t } = useI18n()
const offen = ref(false)
function setze(an) {
    bestaetigt.value = an
    if (an) offen.value = false
    try { if (an) localStorage.setItem(SCHLUESSEL, '1'); else localStorage.removeItem(SCHLUESSEL) } catch { /* ohne Speicher gilt es bis zum Neuladen */ }
}
</script>

<template>
    <Hinweis v-if="!bestaetigt || offen" art="warn" :titel="t('bots.ki.warnTitel')">
        <ul class="warnliste">
            <li>{{ t('bots.ki.warn1') }}</li>
            <li>{{ t('bots.ki.warn2') }}</li>
            <li>{{ t('bots.ki.warn3') }}</li>
            <li>{{ t('bots.ki.warn4') }}</li>
        </ul>
        <p class="warnfuss">{{ t('bots.ki.warnFuss') }}</p>
        <label class="haken"><input type="checkbox" :checked="bestaetigt" @change="setze($event.target.checked)" /> <span>{{ t('bots.ki.warnOk') }}</span></label>
    </Hinweis>
    <p v-else class="zu"><button type="button" @click="offen = true">{{ t('bots.ki.warnZeigen') }}</button></p>
</template>

<style scoped>
.warnliste { margin: 0; padding-left: 1.1em; }
.warnfuss { margin: var(--abstand-1) 0 0; }
.haken { display: flex; align-items: center; gap: 0.5em; margin-top: var(--abstand-2); cursor: pointer; font-weight: 600; }
.haken input { width: 1.05rem; height: 1.05rem; accent-color: var(--accent); }
.zu { margin: 0; }
.zu button { border: 0; background: none; padding: 0; font: inherit; font-size: 0.75rem; color: var(--muted); text-decoration: underline; cursor: pointer; }
.zu button:hover { color: var(--text); }
</style>
