import { createApp } from 'vue'

import App from './App.vue'
import router from './router'
import i18n, { starteSprache } from './i18n'
import { starteLabelVerknuepfung } from './utils/labelVerknuepfung.js'

// Seit S9 ohne Bootstrap: Grundstil und Reset stehen in basis.css, Symbole
// zeichnet src/components/basis/Symbol.vue. Quill laden Playbook.vue und
// Incoming.vue selbst (samt CSS), nicht hier — es gehört nicht ins Start-Bundle.

// Reihenfolge: Token → thematische Klassen → Elemente (basis) → Hilfsklassen
// → Rahmen. Bei gleicher Spezifität gewinnt das Spätere, also setzen sich
// basis.css und die at-Hilfsklassen gegen kacheln/journal/quill durch.
import './assets/design/tokens.css'
import './assets/design/kacheln.css'
import './assets/design/journal.css'
import './assets/design/quill.css'
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
starteSprache().finally(() => {
    app.mount('#app')
    // Beschriftungen ohne `for` mit ihrem Feld verknüpfen (Audit A4-22)
    starteLabelVerknuepfung()
})