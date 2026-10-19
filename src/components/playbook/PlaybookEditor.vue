<script setup>
/**
 * Quill-Editor einer Bewertungsnotiz (Eröffnung oder Abschluss).
 *
 * Bilder gehören in die Bildfelder, nicht in den Text (Entscheidung A-P3):
 * Früher landete ein eingefügtes Bild doppelt — als `<img src="data:…">` im
 * Editor UND über den seitenweiten Einfüge-Handler als Screenshot — und die
 * Anzeige säuberte das `src` danach weg, zurück blieb ein leeres Bild. Darum
 * hier: kein Bildknopf, der Uploader tut nichts (Einfügen/Ablegen einer Datei
 * erreicht so nur den Seiten-Handler und damit das Bildfeld), und `<img>` aus
 * eingefügtem HTML wird verworfen.
 */
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Quill from 'quill'
import 'quill/dist/quill.snow.css'
import { sanitizeHtml } from '@/utils/sanitize.js'

const props = defineProps({
    /** Element-ID, z. B. `quillPlaybook-<tradeId>-opening`. */
    id: { type: String, required: true },
    anfang: { type: String, default: '' },
})
const { t } = useI18n()
const el = ref(null)
let quill = null

const Delta = Quill.import('delta')

onMounted(() => {
    quill = new Quill(el.value, {
        theme: 'snow',
        placeholder: t('incoming.note') + '...',
        modules: {
            toolbar: [
                [{ header: [1, 2, false] }],
                ['bold', 'italic', 'underline'],
                [{ list: 'ordered' }, { list: 'bullet' }],
                ['clean'],
            ],
            uploader: { handler() { /* absichtlich leer, siehe Kopf */ } },
        },
    })
    quill.clipboard.addMatcher('IMG', () => new Delta())
    quill.root.setAttribute('spellcheck', 'true')
    // Direkt als HTML gesetzt (wie gespeichert), vorher gesäubert.
    if (props.anfang) quill.root.innerHTML = sanitizeHtml(props.anfang)
})

/** HTML des Editors unverändert — gesäubert wird bei jeder Anzeige. */
defineExpose({ html: () => (quill ? quill.root.innerHTML : undefined) })
</script>

<template>
    <div class="pb-quill">
        <div :id="id" ref="el"></div>
    </div>
</template>

<style scoped>
/*
 * Snow-Thema dunkel auf die Token gezogen. :deep, weil Quill seine Leiste
 * und den Inhalt selbst ins DOM setzt (ausserhalb des Scope-Attributs).
 */
.pb-quill :deep(.ql-toolbar.ql-snow) {
    display: flex;
    flex-wrap: wrap;
    border: 1px solid var(--line-stark);
    border-radius: var(--radius-knopf) var(--radius-knopf) 0 0;
    background: var(--panel-soft);
    font-family: var(--schrift);
}

.pb-quill :deep(.ql-container.ql-snow) {
    border: 1px solid var(--line-stark);
    border-top: none;
    border-radius: 0 0 var(--radius-knopf) var(--radius-knopf);
    background: var(--bg);
    color: var(--text);
    font-family: var(--schrift);
    font-size: 0.9rem;
}

.pb-quill :deep(.ql-editor) {
    min-height: 7rem;
}

.pb-quill :deep(.ql-editor.ql-blank::before) {
    color: var(--leise);
    font-style: normal;
}

.pb-quill :deep(.ql-snow .ql-stroke) {
    stroke: var(--muted);
}

.pb-quill :deep(.ql-snow .ql-fill) {
    fill: var(--muted);
}

.pb-quill :deep(.ql-snow .ql-picker) {
    color: var(--muted);
}

.pb-quill :deep(.ql-snow button:hover .ql-stroke),
.pb-quill :deep(.ql-snow button.ql-active .ql-stroke),
.pb-quill :deep(.ql-snow .ql-picker-label:hover .ql-stroke),
.pb-quill :deep(.ql-snow .ql-picker-label.ql-active .ql-stroke) {
    stroke: var(--accent);
}

.pb-quill :deep(.ql-snow button:hover .ql-fill),
.pb-quill :deep(.ql-snow button.ql-active .ql-fill) {
    fill: var(--accent);
}

.pb-quill :deep(.ql-snow .ql-picker-label:hover),
.pb-quill :deep(.ql-snow .ql-picker-label.ql-active),
.pb-quill :deep(.ql-snow .ql-picker-item:hover),
.pb-quill :deep(.ql-snow .ql-picker-item.ql-selected) {
    color: var(--accent);
}

.pb-quill :deep(.ql-snow .ql-picker-options) {
    border-color: var(--line-stark);
    border-radius: var(--radius-klein);
    background: var(--panel);
    box-shadow: var(--schatten);
}

.pb-quill :deep(.ql-snow .ql-picker.ql-expanded .ql-picker-label) {
    border-color: var(--line-stark);
}
</style>
