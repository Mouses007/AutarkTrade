<script setup>
/** Bereich „Allgemein" — die Sektionen in der bisherigen Reihenfolge. */
import LayoutStil from './allgemein/LayoutStil.vue'
import Sicherheit from './allgemein/Sicherheit.vue'
import Https from './allgemein/Https.vue'
import Datenbank from './allgemein/Datenbank.vue'
import Speicher from './allgemein/Speicher.vue'
import Importe from './allgemein/Importe.vue'
</script>

<template>
    <div>
        <LayoutStil />
        <Sicherheit />
        <Https />
        <Datenbank />
        <Speicher />
        <Importe />
    </div>
</template>
