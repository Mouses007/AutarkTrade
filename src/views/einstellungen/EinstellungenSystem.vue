<script setup>
/**
 * Bereich „System" — Passwortschutz, HTTPS, Datenbank, Sicherung (Export und
 * Import) und, ganz unten, der Speicherverbrauch mit dem Aufräumen (vorher
 * alles unter Allgemein).
 */
import Sicherheit from './system/Sicherheit.vue'
import Https from './system/Https.vue'
import Datenbank from './system/Datenbank.vue'
import Speicher from './system/Speicher.vue'
</script>

<template>
    <div>
        <Sicherheit />
        <Https />
        <Datenbank />
        <Speicher />
    </div>
</template>
