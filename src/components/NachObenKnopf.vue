<script setup>
    import { useI18n } from 'vue-i18n'
    import Knopf from './basis/Knopf.vue'
    import { istGescrollt } from "../stores/ui.js";
    import { scrolleNachOben, pruefeGescrollt } from "../utils/journal/app.js";
    const { t } = useI18n()
    pruefeGescrollt();
</script>

<template>
    <Knopf v-show="istGescrollt" class="nachOben" art="haupt" klein nur-symbol symbol="hoch"
        :titel="t('common.nachOben')" @click="scrolleNachOben" />
</template>

<style scoped>
.nachOben {
    position: fixed;
    right: 1.5rem;
    bottom: 1.5rem;
    z-index: 1030;
}

@media (max-width: 575.98px) {
    .nachOben { right: 0.75rem; bottom: 0.75rem; }
}
</style>
