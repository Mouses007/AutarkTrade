<script setup>
/**
 * Playbook (`/bewertungen`): trotz des Namens die Liste der TRADE-BEWERTUNGEN —
 * je Trade mit einer Notiz eine aufklappbare Karte mit Eröffnungsbewertung,
 * Füllungen/SL/TP und Abschlussbewertung, bearbeitbar. Die Tabelle `playbooks`
 * benutzt die Seite nicht.
 *
 * Neubau nach `ansichten.md (Beleg)`, Teil „Playbook“. Die Seite hält nur den
 * Rahmen (Laden, Deep-Link, Einfügen, Vollbild, Verlassen-Schutz); Zustand und
 * Abläufe liegen in `components/playbook/usePlaybook.js`, die Regeln in
 * `playbookDaten.js`.
 */
import { computed, onMounted, onBeforeUnmount, provide } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import Seitenkopf from '@/components/basis/Seitenkopf.vue'
import Hinweis from '@/components/basis/Hinweis.vue'
import Dialog from '@/components/basis/Dialog.vue'
import KeineDaten from '@/components/KeineDaten.vue'
import SeiteLaedt from '@/components/SeiteLaedt.vue'
import PlaybookKarte from '@/components/playbook/PlaybookKarte.vue'
import { erzeugePlaybook, PLAYBOOK_SCHLUESSEL } from '@/components/playbook/usePlaybook.js'
import { seiteLaedt } from '@/stores/app/laden.js'
import { useVerlassenSchutz } from '@/composables/useVerlassenSchutz.js'

const { t } = useI18n()
const route = useRoute()
const pb = erzeugePlaybook()
provide(PLAYBOOK_SCHLUESSEL, pb)

// Nach Speichern/Abbrechen ist die Bedingung von selbst falsch.
useVerlassenSchutz(() => !!pb.bearbeitenId.value, () => t('common.unsavedLeave'))

const vollbildOffen = computed(() => !!pb.vollbild.value)
function vollbildZu() {
    pb.vollbild.value = null
}

// Die Liste lädt schon vor dem Einhängen an; der Einfüge-Handler hängt am
// Fenster, weil Strg/Cmd+V überall auf der Seite das Bildfeld treffen soll.
pb.start(route.query.tradeId).catch(fehler => console.error('Playbook: Laden fehlgeschlagen', fehler))
onMounted(() => window.addEventListener('paste', pb.beiEinfuegen))
onBeforeUnmount(() => window.removeEventListener('paste', pb.beiEinfuegen))
</script>

<template>
    <div class="playbook">
        <SeiteLaedt />
        <Seitenkopf :titel="t('playbook.tradeEvaluations')" />

        <Hinweis v-if="pb.nichtGefunden.value" art="warn" :titel="t('playbook.tradeNichtGefunden')" schliessbar
            @zu="pb.nichtGefunden.value = ''">
            {{ t('playbook.tradeNichtGefundenText', { id: pb.nichtGefunden.value }) }}
        </Hinweis>

        <template v-if="!seiteLaedt">
            <div v-if="pb.eintraege.length" class="liste">
                <PlaybookKarte v-for="e in pb.eintraege" :key="e.tradeId" :eintrag="e" />
            </div>
            <KeineDaten v-else />
        </template>

        <!-- Eigene Überlagerung statt BildVollbild: ein einzelnes Bild,
             kein Blättern. Esc und Klick daneben schliessen (nativer Dialog). -->
        <Dialog :model-value="vollbildOffen" :titel="t('incoming.screenshot')" breite="96vw" @zu="vollbildZu">
            <div v-if="pb.vollbild.value" class="vollbild">
                <span class="rahmen">
                    <img :src="pb.vollbild.value.basis" alt="" />
                    <img v-if="pb.vollbild.value.ebene" :src="pb.vollbild.value.ebene" alt="" class="ebene" />
                </span>
            </div>
        </Dialog>
    </div>
</template>

<style scoped>
.playbook {
    display: flex;
    flex-direction: column;
    gap: var(--abstand-3);
    min-width: 0;
}

.liste {
    display: flex;
    flex-direction: column;
    gap: var(--abstand-3);
}

.vollbild {
    display: flex;
    justify-content: center;
}

/* Die Ebene muss genau über dem Bild liegen, nicht über der ganzen Breite. */
.rahmen {
    position: relative;
    display: inline-block;
    max-width: 100%;
}

.vollbild img {
    display: block;
    max-width: 100%;
    max-height: calc(100dvh - 8rem);
    object-fit: contain;
}

.vollbild img.ebene {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
}
</style>
