<script setup>
/**
 * Eine Zeile „Beschriftung — Bedienelement" in den Einstellungen.
 * Auf breiten Schirmen zweispaltig, am Telefon untereinander.
 *
 *   <Feld label="Sprache" hilfe="Gilt für die ganze App"><select …/></Feld>
 */
import { ref, useId, onMounted, onUpdated } from 'vue'

const props = defineProps({
    label: { type: String, default: '' },
    hilfe: { type: String, default: '' },
    /** Bezeichner des Bedienelements, damit ein Klick aufs Label es fokussiert. */
    fuer: { type: String, default: '' },
})

/*
 * Ohne `fuer` hatte das Bedienelement keinen zugänglichen Namen — die
 * Laufprüfung zählte so in den Einstellungen über 20 Felder ohne Label
 * (Audit A4-22). Jetzt verknüpft das Feld selbst: das erste Bedienelement im
 * rechten Teil, das noch keinen Namen trägt, bekommt `aria-labelledby` auf
 * die Beschriftung.
 */
const labelId = useId()
const rechts = ref(null)
function verknuepfe() {
    if (props.fuer || !rechts.value) return
    const label = document.getElementById(labelId)
    if (!label) return
    const felder = [...rechts.value.querySelectorAll('input:not([type=hidden]), select, textarea')].filter((el) => {
        if (el.closest('label')) return false
        if (el.getAttribute('data-feld-name') === labelId) return true
        if (el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby')) return false
        return !(el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`))
    })
    if (felder.length === 1) {
        felder[0].setAttribute('aria-labelledby', labelId)
        felder[0].setAttribute('data-feld-name', labelId)
        return
    }
    // Mehrere Felder unter einer Beschriftung (Host · Port · Sicherheit):
    // jedes bekommt „Beschriftung – Platzhalter" bzw. eine laufende Nummer.
    const text = label.textContent.trim()
    felder.forEach((el, i) => {
        el.setAttribute('aria-label', `${text} – ${el.getAttribute('placeholder') || i + 1}`)
        el.setAttribute('data-feld-name', labelId)
    })
}
onMounted(verknuepfe)
onUpdated(verknuepfe)
</script>

<template>
    <div class="ein-feld">
        <div class="links">
            <label v-if="label" :id="labelId" :for="fuer || undefined">{{ label }}</label>
            <!-- Ohne label-Prop ist der Slot die Beschriftung und trägt die id;
                 mit Prop ist er Zusatzhilfe darunter. -->
            <div v-if="$slots.label" :id="label ? undefined : labelId" class="label-slot"><slot name="label" /></div>
            <p v-if="hilfe" class="hilfe">{{ hilfe }}</p>
        </div>
        <div ref="rechts" class="rechts"><slot /></div>
    </div>
</template>

<style scoped>
.ein-feld {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
    gap: var(--abstand-2) var(--abstand-4);
    align-items: center;
    padding: var(--abstand-2) 0;
}
.links label { color: var(--text); }
.hilfe {
    margin: 0.15rem 0 0;
    color: var(--muted);
    font-size: 0.82rem;
}
.rechts { min-width: 0; }
@media (max-width: 767.98px) {
    .ein-feld { grid-template-columns: 1fr; }
}
</style>
