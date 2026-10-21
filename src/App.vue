<script setup>
import { ref, onMounted } from 'vue'
import axios from 'axios'
import LoginGate from './components/LoginGate.vue'
import Rechtliches from './components/rechtliches/Rechtliches.vue'
import SpendenDialog from './components/rahmen/SpendenDialog.vue'
import Rahmen from './layouts/Rahmen.vue'

const authChecked = ref(false)
const needsLogin = ref(false)
const setupRequired = ref(false)
const codeNoetig = ref(false)

onMounted(async () => {
    try {
        const { data } = await axios.get('/api/auth/status')
        // setupRequired: netzgebundener Betrieb ohne Passwort — der Server
        // verteilt keine Cookies, zuerst muss ein Passwort festgelegt werden.
        setupRequired.value = !!data.setupRequired
        codeNoetig.value = !!data.codeNoetig
        needsLogin.value = setupRequired.value || (!!data.authEnabled && !data.loggedIn)
    } catch (e) {
        // Im Zweifel App normal laden (Gate ist optional)
        needsLogin.value = false
    } finally {
        authChecked.value = true
    }
})
</script>
<template>
    <LoginGate v-if="authChecked && needsLogin" :setup="setupRequired" :code-noetig="codeNoetig" />
    <!-- Seiten mit `meta.rahmen` (alle ausser Setup und Update-Assistent)
         stehen im Rahmen aus Kopfleiste und Seitenmenü. -->
    <Rahmen v-else-if="authChecked && $route.meta.rahmen">
        <RouterView />
    </Rahmen>
    <RouterView v-else-if="authChecked" />
    <!-- Zustimmung zu den Lizenzbedingungen: hier und nicht im Layout, weil der
         Setup-Assistent beim ersten Start ohne Layout läuft (S10). -->
    <Rechtliches v-if="authChecked && !needsLogin" />
    <SpendenDialog v-if="authChecked && !needsLogin" />
</template>
