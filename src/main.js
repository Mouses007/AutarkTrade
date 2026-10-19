import { createApp } from 'vue'

import App from './App.vue'
import router from './router'
import i18n, { starteSprache } from './i18n'

// Übergang: Bootstrap und Popper kamen bis 4.0 vom CDN (index.html). Jetzt
// gebündelt — ohne Netz fehlte sonst das halbe Layout. Bootstrap wird als
// Global gebraucht (`new bootstrap.Modal`, data-bs-toggle), bis S9 es ablöst.
// Quill laden Playbook.vue und Incoming.vue selbst (samt CSS), nicht hier —
// es gehört nicht ins Start-Bundle.
import 'bootstrap/dist/css/bootstrap.min.css'
import * as bootstrap from 'bootstrap'
window.bootstrap = bootstrap

import './assets/design/tokens.css'
import './assets/style-dark.css'
import './assets/design/basis.css'
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