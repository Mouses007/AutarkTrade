import { createApp } from 'vue'

import App from './App.vue'
import router from './router'
import i18n, { starteSprache } from './i18n'

// Seit S9 ohne Bootstrap: Grundstil und Reset stehen in basis.css, Symbole
// zeichnet src/components/basis/Symbol.vue. Quill laden Playbook.vue und
// Incoming.vue selbst (samt CSS), nicht hier — es gehört nicht ins Start-Bundle.

import './assets/design/tokens.css'
import './assets/design/uebergang.css'
import './assets/design/basis.css'
import './assets/design/hilfen.css'
import './assets/design/rahmen.css'

const app = createApp(App)

app.use(i18n)
app.use(router)

/*
 * Die gespeicherte Sprache steht VOR dem Mount fest: nur Deutsch liegt im
 * Start-Bundle, Englisch wird bei Bedarf nachgeladen. Ohne das Warten blitzte
 * kurz die deutsche Oberflaeche auf. Schlaegt das Laden fehl, startet die App
 * trotzdem — auf Deutsch.
 */
starteSprache().finally(() => app.mount('#app'))