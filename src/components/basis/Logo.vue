<script setup>
/**
 * Logo von AutarkTrade: Zeichen (Blüte im Kursring) und Schriftzug
 * „Autark" + „Trade" in Akzentfarbe. Das Zeichen erzeugt
 * `scripts/logo-zeichnen.mjs`; hier wird es nur eingebettet.
 *
 *   <Logo />                       Zeichen links, Schrift rechts (Kopfleiste)
 *   <Logo anordnung="unter" :groesse="220" />   Schrift unter dem Zeichen (Startseite)
 *   <Logo :schrift="false" />      nur das Zeichen
 */
import zeichen from '../../assets/design/logo-zeichen.svg?raw'

defineProps({
    groesse: { type: Number, default: 32 },
    schrift: { type: Boolean, default: true },
    anordnung: { type: String, default: 'neben' }, // neben | unter
})
</script>

<template>
    <span :class="['at-logo', anordnung]" :style="{ '--logo-groesse': groesse + 'px' }">
        <span class="zeichen" v-html="zeichen"></span>
        <span v-if="schrift" class="marke"><span class="teil1">Autark</span><span class="teil2">Trade</span></span>
    </span>
</template>

<style scoped>
.at-logo {
    display: inline-flex;
    align-items: center;
    gap: calc(var(--logo-groesse) * 0.3);
    line-height: 1;
    color: var(--text);
    text-decoration: none;
}

.at-logo.unter {
    flex-direction: column;
    gap: calc(var(--logo-groesse) * 0.08);
}

.zeichen {
    display: block;
    width: var(--logo-groesse);
    height: var(--logo-groesse);
}

.zeichen :deep(svg) {
    display: block;
    width: 100%;
    height: 100%;
}

.marke {
    font-weight: 700;
    letter-spacing: -0.02em;
    font-size: calc(var(--logo-groesse) * 0.56);
    white-space: nowrap;
}

.unter .marke {
    font-size: calc(var(--logo-groesse) * 0.16);
}

.teil1 {
    color: var(--text);
}

.teil2 {
    color: var(--accent);
}
</style>
